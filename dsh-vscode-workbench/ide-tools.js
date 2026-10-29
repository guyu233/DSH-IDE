/**
 * ide-tools.js — 把 VS Code 的能力注册成 DSH 全局工具（ide_*），供 DSH 的 agent 直接调用。
 *
 * 分工（按设计 R2）：
 *  - Host 直读文件系统：ide_readFile / ide_listDir / ide_glob / ide_search / ide_terminal
 *  - 经命令桥交由 VS Code 扩展执行（可见、可触发编辑器行为）：ide_writeFile / ide_editFile / ide_diagnostics
 *
 * 命令桥：Host 侧排队 `{id, command, args}`，扩展侧轮询 `GET /ide-cmd/poll` 取任务执行，
 * 再 `POST /ide-cmd/result {id, ok, result|error}` 回填。
 *
 * 工具定义：直接手写 ToolDefinition（不依赖 @deepseek-ai/dsh-tools 的 defineTool），
 * 因为该包在插件侧不可解析；register() 只校验 output.schema 属于受支持的 JSON Schema 子集。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'out', '.dsh-ide-data', '.dsh-ide-ext', '__pycache__', '.venv', 'target']);

/** 建立命令桥（Host 侧）：排队、轮询、回填。返回 { waitForResult, registerEndpoints }。 */
export function createIdeBridge(log) {
	const pending = new Map(); // id -> { resolve, reject, timer }
	const queue = []; // { id, command, args }

	function waitForResult(id, timeoutMs) {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`ide bridge timeout after ${timeoutMs}ms (extension not responding)`));
			}, timeoutMs);
			pending.set(id, { resolve, reject, timer });
		});
	}

	function enqueue(command, args, timeoutMs) {
		const id = randomUUID();
		const p = waitForResult(id, timeoutMs || 20000);
		queue.push({ id, command, args });
		return p;
	}

	function settle(id, ok, result, error) {
		const entry = pending.get(id);
		if (!entry) return false;
		pending.delete(id);
		clearTimeout(entry.timer);
		if (ok) entry.resolve(result); else entry.reject(new Error(error || 'ide command failed'));
		return true;
	}

	function registerEndpoints(ctx) {
		// 测试/自动化：把任意 {command,args} 交给扩展执行（例如驱动 Local 聊天发送）
		ctx.effect(() => ctx.webServer.register({
			kind: 'exact',
			path: '/ide-cmd/exec',
			handler: async (req, res) => {
				try {
					const body = await readBody(req);
					const result = await enqueue(String(body.command || 'runCommand'), body.args || {}, Number(body.timeoutMs) || 30000);
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ ok: true, result }));
				} catch (e) {
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
				}
			},
		}), 'dsh-vscode-workbench: /ide-cmd/exec');

		// 扩展轮询取任务
		ctx.effect(() => ctx.webServer.register({
			kind: 'exact',
			path: '/ide-cmd/poll',
			handler: (req, res) => {
				const job = queue.shift() || null;
				res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
				res.end(JSON.stringify({ job }));
			},
		}), 'dsh-vscode-workbench: /ide-cmd/poll');

		// 扩展回填结果
		ctx.effect(() => ctx.webServer.register({
			kind: 'exact',
			path: '/ide-cmd/result',
			handler: async (req, res) => {
				try {
					if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
					const body = await readBody(req);
					settle(body.id, !!body.ok, body.result, body.error);
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ accepted: true }));
				} catch (e) {
					res.writeHead(500, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: String(e && e.message || e) }));
				}
			},
		}), 'dsh-vscode-workbench: /ide-cmd/result');
	}

	return { enqueue, registerEndpoints };
}

function readBody(req, limit = 2 * 1024 * 1024) {
	return new Promise((resolve, reject) => {
		let data = '';
		let size = 0;
		req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); return; } data += c; });
		req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
		req.on('error', reject);
	});
}

/** 受支持子集范围内的通用输出 schema：{ ok: boolean, output: string }。 */
const OUTPUT_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	properties: {
		ok: { type: 'boolean' },
		output: { type: 'string' },
	},
	required: ['ok', 'output'],
};

function makeTool(name, description, parameters, execute) {
	return {
		name,
		description,
		parameters,
		output: {
			schema: OUTPUT_SCHEMA,
			render: (_args, value) => [{ type: 'text', text: (value && typeof value.output === 'string') ? value.output : String(value && value.output) }],
		},
		async execute(args) {
			const out = await execute(args || {});
			return { ok: true, output: typeof out === 'string' ? out : String(out) };
		},
	};
}

// ---------- 路径解析 ----------
function makeResolveRoot(root) {
	return function resolve(p) {
		if (!p || typeof p !== 'string') throw new Error('path is required');
		const abs = path.isAbsolute(p) ? p : path.join(root, p);
		return path.normalize(abs);
	};
}

// ---------- 文件读取 ----------
function readFileTool(resolve) {
	return makeTool(
		'ide_readFile',
		'Read a UTF-8 text file from the workspace and return line-numbered content. Use offset/limit for large files.',
		{
			type: 'object', additionalProperties: false,
			properties: {
				path: { type: 'string', description: 'File path (absolute, or relative to the workspace root).' },
				offset: { type: 'number', description: '1-based first line to return. Defaults to 1.' },
				limit: { type: 'number', description: 'Max number of lines to return. Defaults to 2000.' },
			},
			required: ['path'],
		},
		async ({ path: p, offset, limit }) => {
			const abs = resolve(p);
			const st = fs.statSync(abs);
			if (st.size > 8 * 1024 * 1024) throw new Error(`file too large (${st.size} bytes): ${abs}`);
			const text = fs.readFileSync(abs, 'utf8');
			const all = text.split(/\r?\n/);
			const start = Math.max(1, Math.floor(offset || 1));
			const max = Math.max(1, Math.floor(limit || 2000));
			const slice = all.slice(start - 1, start - 1 + max);
			const body = slice.map((line, i) => `${start + i}: ${line}`).join('\n');
			const endLine = start + slice.length - 1;
			const footer = all.length > endLine ? `\n(Showing lines ${start}-${endLine} of ${all.length}. Use offset=${endLine + 1} to continue.)` : `\n(End of file - total ${all.length} lines)`;
			return `<path>${abs}</path>\n<content>\n${body}${footer}\n</content>`;
		},
	);
}

// ---------- 列目录 ----------
function listDirTool(resolve) {
	return makeTool(
		'ide_listDir',
		'List entries of a directory in the workspace (name + type + size).',
		{
			type: 'object', additionalProperties: false,
			properties: { path: { type: 'string', description: 'Directory path (absolute or relative to workspace root). Defaults to workspace root.' } },
			required: [],
		},
		async ({ path: p }) => {
			const abs = p ? resolve(p) : resolve('.');
			const entries = fs.readdirSync(abs, { withFileTypes: true });
			const lines = entries.map(e => {
				let size = '';
				try { if (e.isFile()) size = ' ' + fs.statSync(path.join(abs, e.name)).size + 'B'; } catch { /* ignore */ }
				return `${e.isDirectory() ? 'DIR ' : 'FILE'} ${e.name}${size}`;
			});
			return `<dir>${abs}</dir>\n${lines.join('\n') || '(empty)'}`;
		},
	);
}

// ---------- glob ----------
function globTool(resolve) {
	return makeTool(
		'ide_glob',
		'Find files by glob pattern (e.g. "**/*.ts"). Returns matching file paths.',
		{
			type: 'object', additionalProperties: false,
			properties: {
				pattern: { type: 'string', description: 'Glob pattern, e.g. "src/**/*.ts".' },
				cwd: { type: 'string', description: 'Base directory (absolute or relative to workspace root). Defaults to workspace root.' },
			},
			required: ['pattern'],
		},
		async ({ pattern, cwd }) => {
			const base = cwd ? resolve(cwd) : resolve('.');
			let matches = [];
			try {
				// Node 22+ 提供 fs.globSync
				matches = fs.globSync(pattern, { cwd: base });
			} catch {
				// 兜底：简单递归 + 扩展名/子串匹配
				const needle = pattern.replace(/^\*\*\//, '').replace(/^\*\./, '.');
				const walk = (dir, depth) => {
					if (depth > 8) return;
					let ents = [];
					try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
					for (const e of ents) {
						if (e.name === '.' || e.name === '..') continue;
						if (e.isDirectory()) { if (!IGNORE_DIRS.has(e.name)) walk(path.join(dir, e.name), depth + 1); }
						else if (e.name.endsWith(needle) || e.name === needle) matches.push(path.relative(base, path.join(dir, e.name)));
					}
				};
				walk(base, 0);
			}
			if (matches.length === 0) return `(no files match "${pattern}" under ${base})`;
			return matches.slice(0, 500).map(m => path.isAbsolute(m) ? m : path.join(base, m)).join('\n');
		},
	);
}

// ---------- 内容搜索 ----------
function searchTool(resolve) {
	return makeTool(
		'ide_search',
		'Search file contents for a literal string or regular expression across the workspace. Returns "path:line: text".',
		{
			type: 'object', additionalProperties: false,
			properties: {
				query: { type: 'string', description: 'Text to search for.' },
				path: { type: 'string', description: 'Subdirectory to search (absolute or relative). Defaults to workspace root.' },
				regex: { type: 'boolean', description: 'Treat query as a regular expression. Default false (literal).' },
				maxResults: { type: 'number', description: 'Max matches to return. Default 200.' },
			},
			required: ['query'],
		},
		async ({ query, path: p, regex, maxResults }) => {
			const base = p ? resolve(p) : resolve('.');
			const re = regex ? new RegExp(query, 'i') : null;
			const needle = regex ? '' : String(query).toLowerCase();
			const cap = Math.max(1, Math.floor(maxResults || 200));
			const out = [];
			const walk = (dir, depth) => {
				if (out.length >= cap || depth > 10) return;
				let ents = [];
				try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
				for (const e of ents) {
					if (out.length >= cap) return;
					if (e.name === '.' || e.name === '..') continue;
					const full = path.join(dir, e.name);
					if (e.isDirectory()) { if (!IGNORE_DIRS.has(e.name)) walk(full, depth + 1); continue; }
					let st; try { st = fs.statSync(full); } catch { continue; }
					if (st.size > 1024 * 1024) continue;
					let text; try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
					if (text.indexOf('\u0000') !== -1) continue; // 跳过二进制
					const lines = text.split(/\r?\n/);
					for (let i = 0; i < lines.length && out.length < cap; i++) {
						const line = lines[i];
						const hit = re ? re.test(line) : line.toLowerCase().includes(needle);
						if (hit) out.push(`${path.relative(base, full)}:${i + 1}: ${line.trim().slice(0, 300)}`);
					}
				}
			};
			walk(base, 0);
			if (out.length === 0) return `(no matches for "${query}" under ${base})`;
			return out.join('\n');
		},
	);
}

// ---------- 终端（Host 侧执行并捕获输出） ----------
function terminalTool(resolve) {
	return makeTool(
		'ide_terminal',
		'Run a shell command in the workspace and return its stdout/stderr and exit code.',
		{
			type: 'object', additionalProperties: false,
			properties: {
				command: { type: 'string', description: 'Shell command to run.' },
				cwd: { type: 'string', description: 'Working directory (absolute or relative). Defaults to workspace root.' },
			},
			required: ['command'],
		},
		async ({ command, cwd }) => {
			const dir = cwd ? resolve(cwd) : resolve('.');
			return await new Promise(resolveP => {
				execFile(command, { cwd: dir, shell: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
					const code = err && typeof err.code === 'number' ? err.code : (err ? 1 : 0);
					const parts = [];
					parts.push(`$ ${command}  (cwd: ${dir})`);
					if (stdout) parts.push(String(stdout).slice(0, 20000));
					if (stderr) parts.push('[stderr]\n' + String(stderr).slice(0, 8000));
					parts.push(`[exit code: ${code}]`);
					resolveP(parts.join('\n'));
				});
			});
		},
	);
}

// ---------- 写文件（经命令桥，VS Code 内可见） ----------
function writeFileTool(bridge, resolve) {
	return makeTool(
		'ide_writeFile',
		'Create or fully replace a file via VS Code (the editor updates and the change is visible). Returns the operation performed.',
		{
			type: 'object', additionalProperties: false,
			properties: {
				path: { type: 'string', description: 'File path (absolute or relative to workspace root).' },
				content: { type: 'string', description: 'Full file content to write.' },
			},
			required: ['path', 'content'],
		},
		async ({ path: p, content }) => {
			const abs = resolve(p);
			const res = await bridge.enqueue('writeFile', { path: abs, content: String(content ?? '') }, 20000);
			return res && res.output ? res.output : `wrote ${abs}`;
		},
	);
}

// ---------- 编辑文件（经命令桥） ----------
function editFileTool(bridge, resolve) {
	return makeTool(
		'ide_editFile',
		'Replace an exact block of text in a file via VS Code (visible edit). Fails if old_string is not found or not unique (unless replace_all).',
		{
			type: 'object', additionalProperties: false,
			properties: {
				path: { type: 'string', description: 'File path (absolute or relative).' },
				old_string: { type: 'string', description: 'Exact text to replace.' },
				new_string: { type: 'string', description: 'Replacement text.' },
				replace_all: { type: 'boolean', description: 'Replace all occurrences. Default false.' },
			},
			required: ['path', 'old_string', 'new_string'],
		},
		async ({ path: p, old_string, new_string, replace_all }) => {
			const abs = resolve(p);
			const res = await bridge.enqueue('editFile', { path: abs, oldText: String(old_string ?? ''), newText: String(new_string ?? ''), replaceAll: !!replace_all }, 20000);
			return res && res.output ? res.output : `edited ${abs}`;
		},
	);
}

// ---------- 诊断（经命令桥，用 VS Code LSP） ----------
function diagnosticsTool(bridge, resolve) {
	return makeTool(
		'ide_diagnostics',
		'Get language diagnostics (errors/warnings) for a file or the whole workspace from VS Code\'s language servers.',
		{
			type: 'object', additionalProperties: false,
			properties: { path: { type: 'string', description: 'File path to check. Omit to get all workspace diagnostics.' } },
			required: [],
		},
		async ({ path: p }) => {
			const abs = p ? resolve(p) : '';
			const res = await bridge.enqueue('diagnostics', { path: abs }, 20000);
			return res && res.output ? res.output : '(no diagnostics)';
		},
	);
}

// ---------- P2：LSP 只读导航工具（经命令桥，VS Code 内建 LSP） ----------
function lspTool(bridge, resolve, name, description, op, extraProps, toBridgeArgs) {
	const properties = {
		path: { type: 'string', description: 'File path (absolute or relative to workspace root).' },
		...extraProps,
	};
	const required = ['path'];
	if (op !== 'workspaceSymbols' && op !== 'documentSymbols') { properties.line = { type: 'number', description: '1-based line.' }; properties.column = { type: 'number', description: '1-based column.' }; required.push('line', 'column'); }
	return makeTool(
		name, description,
		{ type: 'object', additionalProperties: false, properties, required },
		async (a) => {
			const abs = resolve(a.path);
			const payload = { op, path: abs, ...(toBridgeArgs ? toBridgeArgs(a) : { line: a.line, column: a.column, query: a.query }) };
			const res = await bridge.enqueue('lsp', payload, 20000);
			return res && res.output ? res.output : '(no result)';
		},
	);
}

function hoverTool(bridge, resolve) {
	return lspTool(bridge, resolve, 'ide_hover', 'Get hover information (type/docs) at a position from the language server.', 'hover', {}, a => ({ line: a.line, column: a.column }));
}
function definitionTool(bridge, resolve) {
	return lspTool(bridge, resolve, 'ide_definition', 'Find the definition location of the symbol at a position.', 'definition', {}, a => ({ line: a.line, column: a.column }));
}
function referencesTool(bridge, resolve) {
	return lspTool(bridge, resolve, 'ide_references', 'Find all references of the symbol at a position.', 'references', {}, a => ({ line: a.line, column: a.column }));
}
function documentSymbolsTool(bridge, resolve) {
	return lspTool(bridge, resolve, 'ide_documentSymbols', 'List symbols (outline) in a file via the language server.', 'documentSymbols', {}, a => ({}));
}
function workspaceSymbolsTool(bridge, resolve) {
	return lspTool(bridge, resolve, 'ide_workspaceSymbols', 'Search workspace symbols by name via the language server.', 'workspaceSymbols', { query: { type: 'string', description: 'Symbol name query.' } }, a => ({ query: a.query }));
}
function codeActionsTool(bridge, resolve) {
	return lspTool(bridge, resolve, 'ide_codeActions', 'List available code actions (quick fixes/refactors) at a position. Lists only; does not apply.', 'codeActions', {}, a => ({ line: a.line, column: a.column }));
}

/**
 * 注册全部 P1 工具。ctx 需已 inject 'tools'。
 * @returns dispose 函数集合的数组（交回调用方挂到 ctx.effect）。
 */
/** 构建全部 P1 工具定义（不注册，供注册与验收共用）。 */
export function buildToolList(resolve, bridge) {
	return [
		readFileTool(resolve),
		listDirTool(resolve),
		globTool(resolve),
		searchTool(resolve),
		terminalTool(resolve),
		writeFileTool(bridge, resolve),
		editFileTool(bridge, resolve),
		diagnosticsTool(bridge, resolve),
		hoverTool(bridge, resolve),
		definitionTool(bridge, resolve),
		referencesTool(bridge, resolve),
		documentSymbolsTool(bridge, resolve),
		workspaceSymbolsTool(bridge, resolve),
		codeActionsTool(bridge, resolve),
	];
}

export function registerIdeTools(ctx, { log, root, bridge }) {
	const tools = ctx.get('tools');
	if (!tools || typeof tools.register !== 'function') {
		log('tools service unavailable; skip ide_* registration');
		return;
	}
	const resolve = makeResolveRoot(root);
	const tools_ = buildToolList(resolve, bridge);
	for (const t of tools_) {
		try {
			const dispose = tools.register(t);
			if (typeof ctx.effect === 'function') ctx.effect(() => dispose);
			log('registered tool: ' + t.name);
		} catch (e) {
			log('register ' + t.name + ' failed: ' + (e && e.message || e));
		}
	}
}
