/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 通道 B（ide_* 执行）的 VS Code 渲染器侧实现。
//
// Host 侧 dsh-ide/host/tools.js 的写/LSP/终端/Git 操作经私有管道转发为
//   { v, chan:'B', id, op, args }  -> VS Code 执行 -> { v, chan:'B', id, ok, result?|error?, auditToken? }
// 本文件把 op 映射到真实 VS Code API：
//   - writeFile / editFile ：workspace.fs / 文本模型（可见编辑）
//   - diagnostics          ：IMarkerService（等价 vscode.languages.getDiagnostics）
//   - lsp                  ：语言特性注册表（等价 vscode.execute*Provider 命令）
//   - runCommand / terminal：受控集成终端（ITerminalService，绝不 shell:true）
//   - git                  ：内置 git 扩展 API（vscode.extensions.getExtension('vscode.git')）
//
// 安全：所有 path 必须位于工作区根内（path.relative + realpath 双重校验），拒绝绝对逃逸。
// 注：审批（approval/*）已在 Host 侧 turn 内完成；本端只负责执行与审计留痕。

import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { isAbsolute, relative, resolve, sep } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import { CodeActionTriggerType } from '../../../../editor/common/languages.js';
import type { CodeActionList, DocumentSymbol, Hover, Location, LocationLink } from '../../../../editor/common/languages.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IMarkerService } from '../../../../platform/markers/common/markers.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
/** 通道 B 执行处理器的本地类型（避免 workbench 依赖 electron-main 模块）。 */
export type IdeExecHandler = (op: string, args: unknown) => Promise<{ ok: boolean; result?: unknown; error?: string; auditToken?: string }>;

/** op 执行结果。 */
interface IExecResult { ok: boolean; result?: unknown; error?: string }

/** 内置 git 扩展 API 的最小结构（只取我们用到的部分）。 */
interface IGitChange { readonly uri: URI; readonly status: number }
interface IGitRepository {
	readonly rootUri: URI;
	readonly state: {
		readonly HEAD: { readonly name?: string; readonly commit?: string } | undefined;
		readonly workingTreeChanges: readonly IGitChange[];
		readonly indexChanges: readonly IGitChange[];
		readonly untrackedChanges: readonly IGitChange[];
	};
	status(): Promise<void>;
	log(options?: { maxEntries?: number }): Promise<Array<{ hash: string; message: string; authorName?: string; authorDate?: Date }>>;
	diff(cached?: boolean): Promise<string>;
	diffWith(ref: string): Promise<IGitChange[]>;
	diffWith(ref: string, path: string): Promise<string>;
}
interface IGitAPI {
	readonly repositories: readonly IGitRepository[];
	getRepository(uri: URI): IGitRepository | null;
}

/**
 * 通道 B 执行器：把 (op,args) 映射到 VS Code API。
 * 依赖注入由调用方（contribution）提供，便于在 workbench 生命周期内构造。
 */
export class DshIdeExec {

	constructor(
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageFeaturesService private readonly languageFeatures: ILanguageFeaturesService,
		@IMarkerService private readonly markerService: IMarkerService,
		@ITerminalService private readonly terminalService: ITerminalService,
	) { }

	/** 工作区根（取第一个文件夹）；无工作区则抛错。 */
	private root(): string {
		const folder = this.workspaceService.getWorkspace().folders[0];
		if (!folder) { throw new Error('no workspace folder open'); }
		return folder.uri.fsPath;
	}

	/**
	 * 根包含校验：把（Host 传来的绝对）path 解析为受约束的绝对路径。
	 * 拒绝非绝对路径、拒绝越出根、realpath 防符号链接逃逸（目标不存在时跳过 realpath）。
	 */
	private async resolveInRoot(p: unknown): Promise<{ abs: string; uri: URI }> {
		if (typeof p !== 'string' || p.length === 0) { throw new Error('path is required'); }
		const rootAbs = resolve(this.root());
		const rootWithSep = rootAbs.endsWith(sep) ? rootAbs : rootAbs + sep;
		const abs = isAbsolute(p) ? resolve(p) : resolve(rootAbs, p);
		if (abs !== rootAbs && !abs.startsWith(rootWithSep)) { throw new Error('path escapes workspace root'); }
		const uri = URI.file(abs);
		// realpath 防符号链接逃逸：目标存在时校验真实路径仍在根内。
		try {
			const real = await this.fileService.realpath(uri);
			if (real) {
				const realRootUri = await this.fileService.realpath(URI.file(rootAbs));
				const realRoot = (realRootUri ?? URI.file(rootAbs)).fsPath;
				const realRootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
				const realPath = real.fsPath;
				if (realPath !== realRoot && !realPath.startsWith(realRootWithSep)) { throw new Error('path escapes workspace root via symlink'); }
			}
		} catch (e) {
			if (e instanceof Error && /escapes workspace root/.test(e.message)) { throw e; }
			// 目标不存在（writeFile 新文件）等：忽略，交由后续操作决定。
		}
		return { abs, uri };
	}

	/** 执行一个通道 B op，返回 { ok,result?,error? }。 */
	async execute(op: string, args: unknown): Promise<IExecResult> {
		const a = (args && typeof args === 'object') ? args as Record<string, unknown> : {};
		try {
			switch (op) {
				case 'writeFile': return await this.writeFile(a);
				case 'editFile': return await this.editFile(a);
				case 'diagnostics': return await this.diagnostics(a);
				case 'lsp': return await this.lsp(a);
				case 'runCommand': return await this.runCommand(a);
				case 'terminal': return await this.terminal(a);
				case 'git': return await this.git(a);
				default: return { ok: false, error: `disabled: unknown ide op '${op}'` };
			}
		} catch (e) {
			return { ok: false, error: String((e && (e as Error).message) || e) };
		}
	}

	// ---- writeFile / editFile：可见编辑 ----

	private async writeFile(a: Record<string, unknown>): Promise<IExecResult> {
		const { abs, uri } = await this.resolveInRoot(a.path);
		const content = typeof a.content === 'string' ? a.content : '';
		await this.fileService.writeFile(uri, VSBuffer.fromString(content));
		return { ok: true, result: { wrote: abs, bytes: content.length } };
	}

	private async editFile(a: Record<string, unknown>): Promise<IExecResult> {
		const { abs, uri } = await this.resolveInRoot(a.path);
		const oldString = typeof a.oldString === 'string' ? a.oldString : '';
		const newString = typeof a.newString === 'string' ? a.newString : '';
		const replaceAll = a.replaceAll === true;
		if (oldString.length === 0) { return { ok: false, error: 'oldString is required' }; }
		// 优先走已打开的文本模型（可见编辑 + 撤销栈）；否则读文件内容做替换后写回。
		const model = this.modelService.getModel(uri);
		const original = model ? model.getValue() : (await this.fileService.readFile(uri)).value.toString();

		if (!original.includes(oldString)) { return { ok: false, error: 'oldString not found in file' }; }
		let occurrences = 0;
		for (let i = original.indexOf(oldString); i >= 0; i = original.indexOf(oldString, i + oldString.length)) { occurrences++; }
		if (occurrences > 1 && !replaceAll) { return { ok: false, error: `oldString is not unique (${occurrences} matches); pass replaceAll to replace all` }; }
		const updated = replaceAll ? original.split(oldString).join(newString) : original.replace(oldString, newString);

		if (model) {
			model.pushEditOperations([], [{ range: model.getFullModelRange(), text: updated }], () => null);
		} else {
			await this.fileService.writeFile(uri, VSBuffer.fromString(updated));
		}
		return { ok: true, result: { edited: abs, replacements: replaceAll ? occurrences : 1 } };
	}

	// ---- diagnostics：语言服务器诊断（等价 vscode.languages.getDiagnostics） ----

	private async diagnostics(a: Record<string, unknown>): Promise<IExecResult> {
		let filter: { resource?: URI } = {};
		if (typeof a.path === 'string' && a.path.length > 0) {
			const { uri } = await this.resolveInRoot(a.path);
			filter = { resource: uri };
		}
		const markers = this.markerService.read(filter);
		const diagnostics = markers.map(m => ({
			path: m.resource.fsPath,
			severity: m.severity,
			message: m.message,
			source: m.source,
			code: typeof m.code === 'object' ? m.code.value : m.code,
			startLineNumber: m.startLineNumber,
			startColumn: m.startColumn,
			endLineNumber: m.endLineNumber,
			endColumn: m.endColumn,
		}));
		return { ok: true, result: { diagnostics } };
	}

	// ---- lsp：语言特性（等价 vscode.execute*Provider 命令，直接用注册表避开 vscode 命名空间） ----

	private async lsp(a: Record<string, unknown>): Promise<IExecResult> {
		const op = typeof a.op === 'string' ? a.op : '';
		const { uri } = await this.resolveInRoot(a.path);

		if (op === 'workspaceSymbols') {
			const query = typeof a.query === 'string' ? a.query : '';
			// 工作区符号不绑定单个文件，用全局注册表（等价命令 vscode.executeWorkspaceSymbolProvider）。
			const symbols = await this.workspaceSymbols(query);
			return { ok: true, result: { symbols } };
		}

		const model = await this.getModel(uri);
		if (!model) { return { ok: false, error: `no text model for ${uri.fsPath}` }; }
		const line = Math.max(1, typeof a.line === 'number' ? Math.trunc(a.line) : 1);
		const column = Math.max(1, typeof a.column === 'number' ? Math.trunc(a.column) : 1);
		const position = new Position(line, column);
		const token = new CancellationTokenSource().token;

		switch (op) {
			case 'definition': {
				const res: Array<Location | LocationLink> = [];
				for (const provider of this.languageFeatures.definitionProvider.ordered(model)) {
					const value = await provider.provideDefinition(model, position, token);
					if (Array.isArray(value)) { res.push(...value); } else if (value) { res.push(value); }
				}
				return { ok: true, result: { definitions: res.map(toLocationJson) } };
			}
			case 'references': {
				const res: Location[] = [];
				for (const provider of this.languageFeatures.referenceProvider.ordered(model)) {
					const value = await provider.provideReferences(model, position, { includeDeclaration: true }, token);
					if (Array.isArray(value)) { res.push(...value); }
				}
				return { ok: true, result: { references: res.map(toLocationJson) } };
			}
			case 'hover': {
				const hovers: Hover[] = [];
				for (const provider of this.languageFeatures.hoverProvider.ordered(model)) {
					const value = await provider.provideHover(model, position, token);
					if (value) { hovers.push(value); }
				}
				return { ok: true, result: { hovers: hovers.map(h => ({ contents: h.contents.map(c => c.value), range: h.range ? rangeJson(h.range) : undefined })) } };
			}
			case 'documentSymbols': {
				const symbols: DocumentSymbol[] = [];
				for (const provider of this.languageFeatures.documentSymbolProvider.ordered(model)) {
					const value = await provider.provideDocumentSymbols(model, token);
					if (Array.isArray(value)) { symbols.push(...value); }
				}
				return { ok: true, result: { symbols: symbols.map(toSymbolJson) } };
			}
			case 'codeActions': {
				const range = new Range(line, column, line, column);
				const actions: Array<Record<string, unknown>> = [];
				for (const provider of this.languageFeatures.codeActionProvider.ordered(model)) {
					const list: CodeActionList | undefined = await provider.provideCodeActions(model, range, { trigger: CodeActionTriggerType.Invoke }, token);
					if (list) {
						try {
							for (const action of list.actions) { actions.push({ title: action.title, kind: action.kind?.value, isPreferred: action.isPreferred === true }); }
						} finally { list.dispose?.(); }
					}
				}
				return { ok: true, result: { actions } };
			}
			default:
				return { ok: false, error: `disabled: unsupported lsp op '${op}'` };
		}
	}

	/**
	 * 工作区符号：直接用搜索服务的全局注册表（等价 vscode.executeWorkspaceSymbolProvider）。
	 * 这里避免跨 contrib 依赖，通过动态导入 search 注册表；失败则返回空集（可接受降级）。
	 */
	private async workspaceSymbols(query: string): Promise<Array<Record<string, unknown>>> {
		try {
			const mod = await import('../../../search/common/search.js');
			const items = await mod.getWorkspaceSymbols(query);
			return items.map(i => ({ name: i.symbol.name, containerName: i.symbol.containerName, kind: i.symbol.kind, location: toLocationJson(i.symbol.location) }));
		} catch {
			return [];
		}
	}

	private async getModel(uri: URI) {
		const existing = this.modelService.getModel(uri);
		if (existing) { return existing; }
		// 打开文件以创建文本模型（只读用于 LSP 查询）。
		const content = (await this.fileService.readFile(uri)).value.toString();
		return this.modelService.createModel(content, null, uri);
	}

	// ---- runCommand / terminal：受控集成终端（绝不 shell:true） ----

	private async runCommand(a: Record<string, unknown>): Promise<IExecResult> {
		const command = typeof a.command === 'string' ? a.command : '';
		if (!command) { return { ok: false, error: 'command is required' }; }
		const argv = Array.isArray(a.args) ? a.args.map(String) : [];
		const cwd = typeof a.cwd === 'string' && a.cwd.length > 0 ? (await this.resolveInRoot(a.cwd)).abs : this.root();
		const commandLine = argv.length ? `${command} ${argv.map(quoteArg).join(' ')}` : command;
		const instance = await this.terminalService.createTerminal({ cwd });
		await instance.sendText(commandLine, true);
		instance.show?.(true);
		return { ok: true, result: { terminalId: instance.instanceId, cwd, sent: commandLine } };
	}

	private async terminal(a: Record<string, unknown>): Promise<IExecResult> {
		const command = typeof a.command === 'string' ? a.command : '';
		if (!command) { return { ok: false, error: 'command is required' }; }
		const cwd = typeof a.cwd === 'string' && a.cwd.length > 0 ? (await this.resolveInRoot(a.cwd)).abs : this.root();
		const instance = await this.terminalService.createTerminal({ cwd });
		await instance.sendText(command, true);
		instance.show?.(true);
		return { ok: true, result: { terminalId: instance.instanceId, cwd } };
	}

	// ---- git：内置 git 扩展 API ----

	/**
	 * 取内置 git 扩展 API。渲染器侧没有 `vscode` 命名空间，无法直接 getExtension。
	 * 生产接入点应放在 electron-main 侧（`vscode.extensions.getExtension('vscode.git')?.exports.getAPI(1)`）。
	 * 在渲染器尚未接线前，返回 undefined 触发清晰的 disabled 错误（fail-closed）。
	 */
	private async getGitApi(): Promise<IGitAPI | undefined> {
		// TODO(build): 渲染器侧经扩展宿主桥接 git API；当前返回 undefined（disabled）。
		return undefined;
	}

	private async git(a: Record<string, unknown>): Promise<IExecResult> {
		const op = typeof a.op === 'string' ? a.op : '';
		const gitArgs = (a.args && typeof a.args === 'object') ? a.args as Record<string, unknown> : {};
		const api = await this.getGitApi();
		if (!api) { return { ok: false, error: 'disabled: git extension API unavailable' }; }
		const repo = api.repositories[0] ?? api.getRepository(URI.file(this.root()));
		if (!repo) { return { ok: false, error: 'disabled: no git repository in workspace' }; }
		switch (op) {
			case 'status': {
				await repo.status();
				const map = (cs: readonly IGitChange[]) => cs.map(c => ({ path: relative(repo.rootUri.fsPath, c.uri.fsPath).split(sep).join('/'), status: c.status }));
				return { ok: true, result: { root: repo.rootUri.fsPath, head: repo.state.HEAD, workingTreeChanges: map(repo.state.workingTreeChanges), indexChanges: map(repo.state.indexChanges), untrackedChanges: map(repo.state.untrackedChanges) } };
			}
			case 'log': {
				const maxEntries = typeof gitArgs.maxEntries === 'number' ? gitArgs.maxEntries : 20;
				const commits = await repo.log({ maxEntries });
				return { ok: true, result: { commits: commits.map(c => ({ hash: c.hash, message: c.message, authorName: c.authorName, authorDate: c.authorDate })) } };
			}
			case 'diff': {
				const diff = await repo.diff(gitArgs.cached === true);
				return { ok: true, result: { diff } };
			}
			default:
				return { ok: false, error: `disabled: unsupported git op '${op}'` };
		}
	}
}

/**
 * 生成通道 B 执行处理器（供主进程经由 IPC 调用的渲染器侧执行）。
 * 返回 (op,args)=>Promise<{ok,result?|error?}> 形式的函数，交由上层接线注册。
 */
export function createExecHandler(exec: DshIdeExec): IdeExecHandler {
	return (op, args) => exec.execute(op, args);
}

function toLocationJson(loc: Location | LocationLink): Record<string, unknown> {
	if ('targetUri' in loc) {
		return { uri: loc.targetUri.fsPath, range: loc.targetSelectionRange ? rangeJson(loc.targetSelectionRange) : loc.targetRange ? rangeJson(loc.targetRange) : undefined };
	}
	return { uri: loc.uri.fsPath, range: rangeJson(loc.range) };
}

function rangeJson(r: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }): Record<string, number> {
	return { startLineNumber: r.startLineNumber, startColumn: r.startColumn, endLineNumber: r.endLineNumber, endColumn: r.endColumn };
}

function toSymbolJson(s: DocumentSymbol): Record<string, unknown> {
	return { name: s.name, detail: s.detail, kind: s.kind, range: s.range ? rangeJson(s.range) : undefined, selectionRange: s.selectionRange ? rangeJson(s.selectionRange) : undefined, children: Array.isArray(s.children) ? s.children.map(toSymbolJson) : undefined };
}

function quoteArg(a: string): string {
	return /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}
