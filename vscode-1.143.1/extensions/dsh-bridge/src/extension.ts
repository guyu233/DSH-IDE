/*---------------------------------------------------------------------------------------------
 *  DSH Bridge — DeepSeek Harness 深度集成扩展
 *
 *  1) AI 桥：把选中的代码/问题交给 DSH 的 DeepSeek（经由同源 /vscode-ai 桥），输出面板显示回复。
 *  2) 自动 diff：轮询 DSH Host 的 /dsh-ide-changes，发现 Agent 改动后，
 *     用 hunks 重建"改前/改后"两侧文本，并调用 vscode.changes 打开原生「变更审查」多文件 diff。
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

interface AiBridgeResponse {
	text?: string;
	error?: string;
}

interface DshSessionSummary { sessionId: string; cwd: string; running: boolean; blank: boolean; updatedAt: number; title: string; }
interface DshHistoryTurn { role: 'user' | 'assistant'; text: string; }
interface DshModelCatalog {
	default?: { provider: string; model: string; reasoningEffort?: string };
	groups?: Array<{ id: string; name: string; models: Array<{ id: string; name: string; reasoning?: { efforts: Array<{ id: string; name: string }>; defaultEffort?: string } }> }>;
}

interface ChangeFile { index: number; path: string; added: number; deleted: number; }
interface ChangeItem { changeId: number; sessionId: string; seq: number; turn?: number; files: ChangeFile[]; }
interface HunkLine { kind?: string; text?: string; }
interface Hunk { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: (string | HunkLine)[]; }
interface DiffPayload {
	path: string; display?: string; kind: string;
	beforeExists: boolean; afterExists: boolean;
	hunks: Hunk[] | null; added?: number; deleted?: number;
}

function dshBase(): string {
	const cfg = vscode.workspace.getConfiguration('dsh');
	const base = cfg.get<string>('aiBaseUrl') || 'http://127.0.0.1:59602';
	return base.replace(/\/$/, '');
}

async function callDshAi(prompt: string, system?: string): Promise<string> {
	const url = dshBase() + '/vscode-ai';
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 60000);
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ prompt, system }),
			signal: controller.signal,
		});
		const data = await res.json() as AiBridgeResponse;
		if (!res.ok || data.error) {
			throw new Error(data.error || `HTTP ${res.status}`);
		}
		return data.text ?? '';
	} finally {
		clearTimeout(timer);
	}
}

let output: vscode.OutputChannel | undefined;
function show(text: string): void {
	if (!output) { output = vscode.window.createOutputChannel('DSH · DeepSeek'); }
	output.clear();
	output.appendLine('— DSH DeepSeek 回答 —');
	output.appendLine('');
	output.appendLine(text);
	output.show(true);
}

/** 从 hunks 重建两侧文本（hunk 内行首 '-' 属改前，'+' 属改后，' ' 两侧都有）。 */
function reconstruct(hunks: Hunk[]): { before: string; after: string } {
	const before: string[] = [];
	const after: string[] = [];
	for (const h of hunks) {
		for (const raw of h.lines) {
			const line = typeof raw === 'string' ? raw : (raw.text ?? '');
			const marker = typeof raw === 'string' ? line.charAt(0) : ((raw.kind === 'add' ? '+' : raw.kind === 'delete' ? '-' : ' '));
			const body = typeof raw === 'string' ? line.slice(1) : line;
			if (marker === '-') { before.push(body); }
			else if (marker === '+') { after.push(body); }
			else { before.push(body); after.push(body); }
		}
	}
	return { before: before.join('\n') + '\n', after: after.join('\n') + '\n' };
}

/** 本地的改前/改后内容缓存：key = session:seq:index */
const diffCache = new Map<string, { before: vscode.Uri; after: vscode.Uri }>();

async function fetchJson<T>(url: string): Promise<T | undefined> {
	try {
		const res = await fetch(url);
		if (!res.ok) { return undefined; }
		return await res.json() as T;
	} catch { return undefined; }
}

let tmpDir: vscode.Uri | undefined;
async function ensureTmpDir(): Promise<vscode.Uri> {
	if (!tmpDir) {
		const root = vscode.Uri.file((process.env.TEMP || process.env.TMP || 'C:/Windows/Temp') + '\\dsh-ide-diffs');
		try { await vscode.workspace.fs.createDirectory(root); } catch { /* ignore */ }
		tmpDir = root;
	}
	return tmpDir;
}

/** 取某个文件在本轮的改前/改后临时文件 URI（缓存，按 session:seq:index）。 */
async function getDiffUris(item: ChangeItem, f: ChangeFile): Promise<{ before: vscode.Uri; after: vscode.Uri } | undefined> {
	const cacheKey = `${item.sessionId}:${item.seq}:${f.index}`;
	let uris = diffCache.get(cacheKey);
	if (uris) { return uris; }
	const payload = await fetchJson<DiffPayload>(dshBase() + `/dsh-ide-diff?session=${encodeURIComponent(item.sessionId)}&seq=${item.seq}&index=${f.index}`);
	if (!payload || payload.kind !== 'text') { return undefined; }
	const { before, after } = reconstruct(payload.hunks || []);
	const dir = await ensureTmpDir();
	const base = (f.path.split(/[\\/]/).pop() || 'file').replace(/[^\w.\-]/g, '_');
	const beforeUri = vscode.Uri.joinPath(dir, `${item.seq}-${f.index}-${base}.before`);
	const afterUri = vscode.Uri.joinPath(dir, `${item.seq}-${f.index}-${base}.after`);
	await vscode.workspace.fs.writeFile(beforeUri, Buffer.from(before, 'utf8'));
	await vscode.workspace.fs.writeFile(afterUri, Buffer.from(after, 'utf8'));
	uris = { before: beforeUri, after: afterUri };
	diffCache.set(cacheKey, uris);
	return uris;
}

/** 展示某一轮改动的原生「变更审查」多文件 diff。 */
async function presentReview(item: ChangeItem): Promise<void> {
	const triples: [vscode.Uri, vscode.Uri | undefined, vscode.Uri | undefined][] = [];
	for (const f of item.files) {
		const uris = await getDiffUris(item, f);
		if (!uris) { continue; }
		// label 用真实文件路径（作为左/右的标识），left=改前，right=改后
		const label = vscode.Uri.file(f.path);
		triples.push([label, uris.before, uris.after]);
	}
	if (triples.length === 0) { return; }
	const title = `DSH 变更审查 · 第 ${item.turn ?? '?'} 轮 · ${triples.length} 个文件`;
	await vscode.commands.executeCommand('vscode.changes', title, triples);
}

// ---- SCM：把该轮改动列成一个源代码管理提供者的资源组（除「变更审查」外单独可见）----
let scm: vscode.SourceControl | undefined;
let scmGroup: vscode.SourceControlResourceGroup | undefined;
let statusBar: vscode.StatusBarItem | undefined;

function ensureScm(context: vscode.ExtensionContext): void {
	if (!scm) {
		scm = vscode.scm.createSourceControl('dsh-agent', 'DSH Agent 改动');
		scmGroup = scm.createResourceGroup('changes', '最近一轮 Agent 改动');
		scmGroup.hideWhenEmpty = true;
		context.subscriptions.push(scm);
	}
	if (!statusBar) {
		statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
		statusBar.name = 'DSH Agent 改动';
		statusBar.command = 'dsh.reviewChanges';
		context.subscriptions.push(statusBar);
	}
}

/** 用某一轮改动刷新 SCM 资源组与状态栏。每个资源点击即打开该文件的原生 diff。 */
function refreshScm(item: ChangeItem): void {
	if (!scm || !scmGroup) { return; }
	const resources: vscode.SourceControlResourceState[] = item.files.map(f => {
		const resourceUri = vscode.Uri.file(f.path);
		return {
			resourceUri,
			decorations: {
				tooltip: `${f.path}  +${f.added} -${f.deleted}`,
			},
			command: {
				title: '打开变更 diff',
				command: 'dsh.openFileDiff',
				arguments: [item, f],
			},
		};
	});
	scmGroup.resourceStates = resources;
	scm.count = resources.length;
	scm.acceptInputCommand = { title: '查看本轮变更审查', command: 'dsh.reviewChanges' };
	if (statusBar) {
		statusBar.text = `$(diff) DSH: ${resources.length} 个文件改动`;
		statusBar.tooltip = `最近一轮 Agent 改动（第 ${item.turn ?? '?'} 轮），点击查看变更审查`;
		statusBar.show();
	}
}

	let pollTimer: NodeJS.Timeout | undefined;
	let lastItem: ChangeItem | undefined;

// ===================== P1：IDE 命令泵（Host -> VS Code） =====================
// DSH 通过 Host 的工具 ide_writeFile/ide_editFile/ide_diagnostics 触发；
// Host 排队，本扩展轮询执行（真正在 VS Code 里改文件/取 LSP 诊断），再把结果回填。
let idePumpTimer: NodeJS.Timeout | undefined;

function startIdeCommandPump(context: vscode.ExtensionContext): void {
	if (idePumpTimer) { return; }
	let busy = false;
	const tick = async () => {
		if (busy) { return; }
		busy = true;
		try {
			const res = await fetch(dshBase() + '/ide-cmd/poll');
			if (res.ok) {
				const data = await res.json() as { job?: { id: string; command: string; args?: any } };
				const job = data.job;
				if (job && job.id) {
					let ok = true; let result: any = {}; let error = '';
					try {
						result = await executeIdeCommand(job.command, job.args || {});
					} catch (e) {
						ok = false; error = e instanceof Error ? e.message : String(e);
					}
					await fetch(dshBase() + '/ide-cmd/result', {
						method: 'POST', headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ id: job.id, ok, result, error }),
					}).catch(() => { /* ignore */ });
				}
			}
		} catch { /* Host 未就绪，忽略 */ }
		finally { busy = false; }
	};
	idePumpTimer = setInterval(() => { void tick(); }, 600);
	context.subscriptions.push({ dispose: () => { if (idePumpTimer) { clearInterval(idePumpTimer); idePumpTimer = undefined; } } });
}

async function executeIdeCommand(command: string, args: any): Promise<any> {
	if (command === 'runCommand') {
		// 测试/自动化用：在 IDE 内执行任意命令（例如驱动 Local 聊天发送）
		const result = await vscode.commands.executeCommand(String(args.command), ...(Array.isArray(args.args) ? args.args : []));
		return { output: `ran ${args.command}` + (result !== undefined ? ` -> ${typeof result === 'string' ? result : JSON.stringify(result)}` : '') };
	}
	if (command === 'writeFile') {
		const uri = vscode.Uri.file(args.path);
		await vscode.workspace.fs.writeFile(uri, Buffer.from(String(args.content ?? ''), 'utf8'));
		try {
			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc, { preview: false });
		} catch { /* ignore */ }
		return { output: `wrote ${args.path}` };
	}
	if (command === 'editFile') {
		const uri = vscode.Uri.file(args.path);
		let doc: vscode.TextDocument;
		try { doc = await vscode.workspace.openTextDocument(uri); }
		catch { throw new Error(`cannot open file: ${args.path}`); }
		const text = doc.getText();
		const oldText = String(args.oldText ?? '');
		if (!oldText) { throw new Error('old_string is empty'); }
		const idx = text.indexOf(oldText);
		if (idx < 0) { throw new Error('old_string not found in file'); }
		const edit = new vscode.WorkspaceEdit();
		if (args.replaceAll) {
			let from = 0;
			while (true) {
				const i = text.indexOf(oldText, from);
				if (i < 0) { break; }
				const start = doc.positionAt(i); const end = doc.positionAt(i + oldText.length);
				edit.replace(uri, new vscode.Range(start, end), String(args.newText ?? ''));
				from = i + oldText.length;
			}
		} else {
			const start = doc.positionAt(idx); const end = doc.positionAt(idx + oldText.length);
			edit.replace(uri, new vscode.Range(start, end), String(args.newText ?? ''));
		}
		const applied = await vscode.workspace.applyEdit(edit);
		if (!applied) { throw new Error('applyEdit failed'); }
		try { await doc.save(); } catch { /* ignore */ }
		try { await vscode.window.showTextDocument(doc, { preview: false }); } catch { /* ignore */ }
		return { output: `edited ${args.path}` };
	}
	if (command === 'diagnostics') {
		const target: string = String(args.path || '');
		const all = vscode.languages.getDiagnostics();
		const rows: string[] = [];
		for (const [uri, diags] of all) {
			if (target && uri.fsPath.toLowerCase() !== target.toLowerCase()) { continue; }
			for (const d of diags) {
				const sev = vscode.DiagnosticSeverity[d.severity] || String(d.severity);
				rows.push(`${uri.fsPath}:${d.range.start.line + 1}:${d.range.start.character + 1} [${sev}] ${d.message}`);
			}
		}
		if (rows.length === 0) { return { output: target ? `(no diagnostics for ${target})` : '(no diagnostics)' }; }
		return { output: rows.slice(0, 500).join('\n') };
	}
	// ===== P2 LSP 只读导航工具 =====
	if (command === 'lsp') {
		return await executeLsp(String(args.op || ''), args);
	}
	throw new Error('unknown ide command: ' + command);
}

/** 把 URI/位置转成 "path:line:col"（1-based）。 */
function fmtLocation(loc: vscode.Location | vscode.LocationLink): string {
	const uri = 'targetUri' in loc ? loc.targetUri : loc.uri;
	const range = 'targetRange' in loc ? loc.targetRange : loc.range;
	const p = uri.fsPath || uri.toString();
	return `${p}:${range.start.line + 1}:${range.start.character + 1}-${range.end.line + 1}:${range.end.character + 1}`;
}

/** P2：调用 VS Code 内建 LSP 命令（只读导航）。 */
async function executeLsp(op: string, args: any): Promise<any> {
	const uri = vscode.Uri.file(String(args.path || ''));
	const pos = new vscode.Position(Math.max(0, (Number(args.line) || 1) - 1), Math.max(0, (Number(args.column) || 1) - 1));
	if (op === 'hover') {
		const hs = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, pos) || [];
		const parts: string[] = [];
		for (const h of hs) {
			for (const c of h.contents) {
				parts.push(typeof c === 'string' ? c : c.value);
			}
		}
		return { output: parts.length ? parts.join('\n---\n') : '(no hover information)' };
	}
	if (op === 'definition') {
		const res = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>('vscode.executeDefinitionProvider', uri, pos) || [];
		return { output: res.length ? res.map(fmtLocation).join('\n') : '(no definition found)' };
	}
	if (op === 'references') {
		const res = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', uri, pos) || [];
		return { output: res.length ? res.map(fmtLocation).join('\n') : '(no references found)' };
	}
	if (op === 'documentSymbols') {
		const res = await vscode.commands.executeCommand<Array<vscode.DocumentSymbol | vscode.SymbolInformation>>('vscode.executeDocumentSymbolProvider', uri) || [];
		const rows: string[] = [];
		const pushSym = (s: vscode.DocumentSymbol | vscode.SymbolInformation, depth: number) => {
			const loc = 'location' in s ? s.location.range.start : s.range.start;
			rows.push(`${'  '.repeat(depth)}${vscode.SymbolKind[s.kind] || s.kind} ${s.name}  (${loc.line + 1}:${loc.character + 1})`);
			if ('children' in s && Array.isArray(s.children)) { for (const c of s.children) { pushSym(c, depth + 1); } }
		};
		for (const s of res) { pushSym(s, 0); }
		return { output: rows.length ? rows.slice(0, 2000).join('\n') : '(no symbols)' };
	}
	if (op === 'workspaceSymbols') {
		const q = String(args.query || '');
		const res = await vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', q) || [];
		const rows = res.slice(0, 300).map(s => {
			const p = s.location.uri.fsPath || s.location.uri.toString();
			return `${s.name} [${vscode.SymbolKind[s.kind] || s.kind}] ${p}:${s.location.range.start.line + 1}`;
		});
		return { output: rows.length ? rows.join('\n') : '(no symbols)' };
	}
	if (op === 'codeActions') {
		const range = new vscode.Range(pos, pos);
		const ctx: vscode.CodeActionContext = { diagnostics: [], only: undefined, triggerKind: vscode.CodeActionTriggerKind.Invoke };
		const res = await vscode.commands.executeCommand<Array<vscode.CodeAction | vscode.Command>>('vscode.executeCodeActionProvider', uri, range, undefined) || [];
		const rows = res.map((a: any) => {
			const kind = a && a.kind ? (typeof a.kind === 'string' ? a.kind : (a.kind.value || '')) : '';
			return `- ${a.title}${kind ? ' (' + kind + ')' : ''}`;
		});
		return { output: rows.length ? rows.join('\n') : '(no code actions)' };
	}
	throw new Error('unknown lsp op: ' + op);
}

export function activate(context: vscode.ExtensionContext): void {
	ensureScm(context);
	// 打开 DeepSeek Harness 桌面主窗口（IDE 内「Open in Agents」按钮改指向这里）。
	// 由扩展发起 HTTP 到 Host，Host 再拉起 powershell 把 DSH 桌面窗口切到前台，
	// 避免 renderer 的 CSP 限制直连 localhost。
	context.subscriptions.push(vscode.commands.registerCommand('dsh.openHarness', async (arg?: { folder?: string }) => {
		const folder = typeof arg === 'string' ? arg : (arg && arg.folder) || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
		try {
			const res = await fetch(dshBase() + '/dsh-ide-focus-dsh', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ folder }),
			});
			const data = await res.json() as { focused?: boolean; error?: string };
			if (!data.focused) {
				vscode.window.showWarningMessage('DSH: 未能把 DeepSeek Harness 窗口切到前台' + (data.error ? '（' + data.error + '）' : ''));
			}
		} catch (error) {
			vscode.window.showErrorMessage('DSH: ' + (error instanceof Error ? error.message : String(error)));
		}
	}));

	// 打开原生 Chat 面板（DSH 是唯一后端，Local 会话即 DSH）
	context.subscriptions.push(vscode.commands.registerCommand('dsh.openChat', async () => {
		try {
			await vscode.commands.executeCommand('workbench.action.chat.open', { isPartialQuery: true });
		} catch (e) {
			vscode.window.showErrorMessage('DSH: 打开 Chat 失败：' + (e instanceof Error ? e.message : String(e)));
		}
	}));

	// P1：IDE 命令泵 —— 轮询 Host 的 /ide-cmd/poll，执行 DSH 发来的 VS Code 动作（写/改/诊断）
	startIdeCommandPump(context);


	// 打开单个文件的原生 diff（SCM 资源点击入口）
	context.subscriptions.push(vscode.commands.registerCommand('dsh.openFileDiff', async (item: ChangeItem, f: ChangeFile) => {
		try {
			const uris = await getDiffUris(item, f);
			if (!uris) { vscode.window.showInformationMessage('DSH: 该文件无文本 diff（二进制或已跳过）。'); return; }
			await vscode.commands.executeCommand('vscode.diff', uris.before, uris.after,
				`${f.path} (DSH 第 ${item.turn ?? '?'} 轮)`, { preview: true } as vscode.TextDocumentShowOptions);
		} catch (error) {
			vscode.window.showErrorMessage('DSH: ' + (error instanceof Error ? error.message : String(error)));
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('dsh.askSelection', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showInformationMessage('DSH: 请先打开一个文件并选中代码。');
			return;
		}
		const selection = editor.selection;
		const selected = editor.document.getText(selection);
		if (!selected.trim()) {
			vscode.window.showInformationMessage('DSH: 当前没有选中的代码。');
			return;
		}
		const lang = editor.document.languageId;
		const prompt = `请解释并改进下面这段 ${lang} 代码：\n\n\`\`\`${lang}\n${selected}\n\`\`\``;
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'DSH DeepSeek 思考中…' }, async () => {
			try {
				const text = await callDshAi(prompt, '你是资深工程师，回答简洁、给出可执行改进。');
				show(text);
			} catch (error) {
				vscode.window.showErrorMessage('DSH: ' + (error instanceof Error ? error.message : String(error)));
			}
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('dsh.askCustom', async () => {
		const q = await vscode.window.showInputBox({ prompt: '向 DSH 的 DeepSeek 提问', placeHolder: '例如：这段代码有什么潜在 bug？' });
		if (!q) { return; }
		const editor = vscode.window.activeTextEditor;
		const ctxText = editor ? `\n\n当前文件：${editor.document.fileName}\n\`\`\`${editor.document.languageId}\n${editor.document.getText(editor.selection) || editor.document.getText().slice(0, 4000)}\n\`\`\`` : '';
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'DSH DeepSeek 思考中…' }, async () => {
			try {
				const text = await callDshAi(q + ctxText);
				show(text);
			} catch (error) {
				vscode.window.showErrorMessage('DSH: ' + (error instanceof Error ? error.message : String(error)));
			}
		});
	}));

	// 手动触发查看最近一轮改动
	context.subscriptions.push(vscode.commands.registerCommand('dsh.reviewChanges', async () => {
		const data = await fetchJson<{ items: ChangeItem[] }>(dshBase() + '/dsh-ide-changes');
		const item = data?.items?.[data.items.length - 1];
		if (!item) { vscode.window.showInformationMessage('DSH: 暂无改动记录。'); return; }
		lastItem = item;
		refreshScm(item);
		await presentReview(item);
	}));

	// 自动 diff：轮询 /dsh-ide-changes，发现新改动就打开变更审查
	const autoReview = vscode.workspace.getConfiguration('dsh').get<boolean>('autoReviewChanges', true);
	if (autoReview) {
		let lastId = 0;
		const tick = async () => {
			const data = await fetchJson<{ lastId: number; items: ChangeItem[] }>(dshBase() + `/dsh-ide-changes?since=${lastId}`);
			if (data) {
				for (const item of data.items) {
					if (item.changeId > lastId) {
						lastId = item.changeId;
						lastItem = item;
						try {
							refreshScm(item);              // 先列出改动（SCM + 状态栏）
							await presentReview(item);     // 再自动开原生多文件变更审查
						} catch (e) {
							output?.appendLine('[auto-diff] ' + String(e && (e as Error).message || e));
						}
					}
				}
				if (data.lastId > lastId) { lastId = data.lastId; }
			}
		};
		pollTimer = setInterval(() => { void tick(); }, 2500);
		context.subscriptions.push({ dispose: () => { if (pollTimer) { clearInterval(pollTimer); } } });
	}

	// 注：内建 Local 聊天已在内核层由 DSH 接管（chatServiceImpl → DshChatBridge），
	// 不再需要扩展注册自定义的 “dsh” 会话类型 / 内容提供者。
}


export function deactivate(): void {
	if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined; }
	statusBar?.dispose(); statusBar = undefined;
	scm?.dispose(); scm = undefined; scmGroup = undefined;
	lastItem = undefined;
	output?.dispose();
	output = undefined;
}
