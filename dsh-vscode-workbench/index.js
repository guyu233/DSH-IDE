/**
 * Host half of @local/dsh-vscode-workbench.
 *
 * 形态（按最终需求）：DSH 侧栏不再有「VS Code」按钮、也没有内嵌面板；
 * 而是在会话的「对话/轨迹/上下文/编队」这排 Tab 后追加一个「DSH-IDE」入口，
 * 点击后由 Host 拉起一个**独立的原生 IDE 窗口**（dsh-ide：复用 DSH 自带 Electron
 * 运行时 + 我们编译好的 VS Code 桌面版，见 E:\vscode-dsh\dsh-ide）。
 *
 * Host 职责：
 *  1. POST /dsh-ide-launch  -> 以干净 env 分离启动 dsh-ide 的 Electron 窗口（单实例：重复调用即置前）
 *  2. GET  /dsh-ide-status  -> 返回窗口是否在运行
 *  3. POST /vscode-ai       -> 让 IDE 内 dsh-bridge 扩展调用 DSH 的 DeepSeek（同源，进程内 llm 服务）
 *  4. GET  /vscode-changes  -> 工作区根信息
 *  5. （可选，默认关闭）enableCodeServer=true 时仍会起 code-server 并反代 /vscode*，作为后备
 */
import * as http from 'node:http';
import * as net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { createIdeBridge, registerIdeTools } from './ide-tools.js';

// Host 端可能运行在 DSH 的 Electron 主进程内——那样就能直接开「DSH 自己的窗口」。
// 用 createRequire 探测 electron API 是否可用（纯 Node 模式下 require('electron') 只返回路径字符串）。
const hostRequire = createRequire(import.meta.url);
let electronApi = null;
try {
	const mod = hostRequire('electron');
	if (mod && typeof mod === 'object' && typeof mod.BrowserWindow === 'function') {
		electronApi = mod;
	}
} catch { /* 纯 Node 模式下不可用 */ }

const DEFAULTS = {
	// 独立 IDE 窗口（复用 DSH Electron 运行时的那份拷贝）
	ideExe: 'E:\\vscode-dsh\\dsh-ide\\DeepSeek Harness.exe',
	// dev 模式下需显式给出 app 路径占位（见 launchIde 注释）
	ideAppPath: 'E:\\vscode-dsh\\dsh-ide\\resources\\app',
	ideWorkdir: 'E:\\vscode-dsh',
	ideUserDataDir: 'E:\\vscode-dsh\\.dsh-ide-data',
	ideExtensionsDir: 'E:\\vscode-dsh\\.dsh-ide-ext',
	// 旧的 code-server 网页后备（默认关闭）
	enableCodeServer: false,
	serverMain: 'E:\\vscode-dsh\\vscode-1.143.1\\out\\server-main.js',
	repoRoot: 'E:\\vscode-dsh\\vscode-1.143.1',
	port: 9899,
	basePath: '/vscode',
	folder: 'E:\\vscode-dsh',
	dshFocusScript: 'E:\\vscode-dsh\\tools\\dsh-focus.ps1',
	dshExe: 'C:\\Users\\guyu\\AppData\\Local\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe',
};

/** 检测 pid 是否存活（Windows）。 */
function isAlive(pid) {
	if (!pid) return false;
	try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; }
}

/**
 * 分离启动 DSH IDE 原生窗口。
 * 关键：必须剔除 ELECTRON_RUN_AS_NODE —— 否则 Electron 会以纯 Node 模式运行并以
 * "Cannot find module <argv0>" 崩溃；同时去掉可能继承的控制台附着变量。
 *
 * targetFolder（第 1 期新需求）：本次要打开的「当前工作区」绝对路径。
 *  - 若给定：用 `--folder-uri file:///...` 精确打开该目录（而不是写死 cfg.ideWorkdir）；
 *    并带 --reuse-window，让单实例下重复点击把同一窗口切到新目录，而不是分家成多窗口。
 *  - 未给定：回退 cfg.ideWorkdir（保持既有行为）。
 */
function launchIde(cfg, log, targetFolder) {
	const exe = cfg.ideExe;
	if (!fs.existsSync(exe)) {
		throw new Error(`IDE executable not found: ${exe}`);
	}
	try { fs.mkdirSync(cfg.ideUserDataDir, { recursive: true }); } catch { /* ignore */ }
	try { fs.mkdirSync(cfg.ideExtensionsDir, { recursive: true }); } catch { /* ignore */ }

	const env = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE;
	delete env.ELECTRON_NO_ATTACH_CONSOLE;
	delete env.ELECTRON_ENABLE_LOGGING;
	env.VSCODE_DEV = '1';
	env.VSCODE_SKIP_PRELAUNCH = '1';
	env.NODE_ENV = 'development';

	const folder = targetFolder && fs.existsSync(targetFolder) ? targetFolder : cfg.ideWorkdir;

	// app 路径占位：本构建以 VSCODE_DEV=1 运行，main 进程的 parseMainProcessArgv 会把
	// 「第一个非选项参数」当作 app 路径剥掉。若不留这个占位，它会把我们第一个选项吃掉。
	const appPath = cfg.ideAppPath || path.join(path.dirname(exe), 'resources', 'app');

	// 目录用 `--folder-uri`（选项形式）传；配合 --reuse-window：
	//  - 无窗口（冷启动）：直接打开该目录；
	//  - 已有窗口（单实例转发）：把同一窗口切到该目录，而不是分家成多窗口/多根。
	const args = [
		appPath,
		`--folder-uri=${pathToFileURL(folder).href}`,
		`--user-data-dir=${cfg.ideUserDataDir}`,
		`--extensions-dir=${cfg.ideExtensionsDir}`,
		`--reuse-window`,
	];
	const child = spawn(exe, args, {
		cwd: folder,
		env,
		detached: true,      // 独立进程组，DSH 结束也不带走窗口
		stdio: 'ignore',     // 不占用 Host 的 stdio
		windowsHide: false,
	});
	child.on('error', err => log('IDE spawn error: ' + (err && err.message ? err.message : err)));
	child.on('exit', code => log('IDE exited code=' + code));
	try { child.unref(); } catch { /* ignore */ }

	// 说明：IDE 窗口与 DSH 主窗口是**平级**的、互不依赖的两个 DSH 窗口
	// （不做 owner 主从关系：任一窗口关闭，另一个照常工作）。
	log('IDE launched pid=' + child.pid + ' folder=' + folder);
	return { pid: child.pid, folder };
}

/**
 * 解析某个 DSH 会话的当前工作目录。
 *  1. 优先 ctx.get('workingDirectory').get(session)（同一 owner 下的权威目录）；
 *  2. 其次 session.header.cwd（会话创建时冻结的目录，冷会话也可读）；
 *  3. 再次 sessionController.inspect(sessionId).meta.cwd（未激活 Agent 的持久化头部）；
 *  4. 都取不到返回 undefined，由调用方回退 cfg.folder。
 */
async function resolveSessionFolder(ctx, log, sessionId) {
	if (!sessionId) return undefined;
	const candidates = [];
	// 1) live session + workingDirectory
	try {
		const session = ctx.get('sessions')?.get?.(sessionId);
		if (session) {
			try { const wd = ctx.get('workingDirectory')?.get?.(session); if (wd) candidates.push(wd); } catch { /* ignore */ }
			try { const cwd = session.header?.cwd; if (cwd) candidates.push(cwd); } catch { /* ignore */ }
		}
	} catch (error) { log('resolveSessionFolder(live) failed: ' + (error?.message || error)); }
	// 2) 冷会话：sessionController.inspect
	if (candidates.length === 0) {
		try {
			const sc = ctx.get('sessionController');
			if (sc && typeof sc.inspect === 'function') {
				const insp = await sc.inspect(sessionId);
				const cwd = insp?.meta?.cwd;
				if (cwd) candidates.push(cwd);
			}
		} catch (error) { log('resolveSessionFolder(inspect) failed: ' + (error?.message || error)); }
	}
	for (const c of candidates) {
		if (c && typeof c === 'string' && fs.existsSync(c)) return c;
	}
	// 兜底：即使目录暂不存在也返回第一个候选，交给 IDE 自己处理
	return candidates.find(c => c && typeof c === 'string');
}

function readStatus(port) {
	return new Promise(resolve => {
		const req = http.request({ host: '127.0.0.1', port, path: '/', method: 'GET', timeout: 2000 }, res => {
			res.resume();
			resolve(res.statusCode === 200 || res.statusCode === 302);
		});
		req.on('error', () => resolve(false));
		req.on('timeout', () => { req.destroy(); resolve(false); });
		req.end();
	});
}

async function waitReady(port, timeoutMs = 90000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await readStatus(port)) return true;
		await new Promise(r => setTimeout(r, 800));
	}
	return false;
}

export const inject = ['subprocess', 'webServer', 'tools'];

export function apply(ctx, config = {}) {
	const cfg = { ...DEFAULTS, ...config };
	const port = Number(cfg.port) || DEFAULTS.port;
	const basePath = cfg.basePath || DEFAULTS.basePath;
	const log = msg => { try { console.error('[dsh-vscode-workbench] ' + msg); } catch { /* ignore */ } };

	// ---- P1：把 VS Code 能力注册成 DSH 工具 ide_*，并建立 Host↔扩展 命令桥 ----
	try {
		const bridge = createIdeBridge(log);
		bridge.registerEndpoints(ctx);
		// 工具的文件根：当前 IDE 工作区（cfg.folder/ideWorkdir）
		const toolRoot = cfg.ideWorkdir || cfg.folder || process.cwd();
		registerIdeTools(ctx, { log, root: toolRoot, bridge });
		log('ide-tools initialized (root=' + toolRoot + ')');
	} catch (e) {
		log('ide-tools init failed: ' + (e && e.message || e));
	}

	let child = null;
	let stopped = false;
	let idePid = 0;

	// ---- 独立 IDE 窗口：启动 / 状态 ----
	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: '/dsh-ide-launch',
		handler: async (req, res) => {
			if (req.method !== 'POST') {
				res.writeHead(405, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'method not allowed' }));
				return;
			}
			try {
				let body = {};
				try { body = await readJsonBody(req); } catch { /* 允许空 body */ }
				const sessionId = body && typeof body.sessionId === 'string' ? body.sessionId : undefined;
				let folder = await resolveSessionFolder(ctx, log, sessionId);
				let folderSource = folder ? (sessionId ? 'session' : 'config') : 'config';
				if (!folder) { folder = cfg.folder || cfg.ideWorkdir; folderSource = 'config'; }
				const result = launchIde(cfg, log, folder);   // 单实例：同 user-data-dir 再启动只会转发给已有窗口
				idePid = result.pid;
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ launched: true, pid: result.pid, folder: result.folder, folderSource, sessionId: sessionId ?? null }));
			} catch (error) {
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: String(error && error.message ? error.message : error) }));
			}
		},
	}), 'dsh-vscode-workbench: /dsh-ide-launch');

	// ---- 把 DSH 桌面主窗口切到前台（IDE 内「Open in Agents」按钮调用）----
	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: '/dsh-ide-focus-dsh',
		handler: async (req, res) => {
			let folder = '';
			try {
				if (req.method === 'POST') { const b = await readJsonBody(req); folder = b && typeof b.folder === 'string' ? b.folder : ''; }
				else { folder = new URL(req.url ?? '/', 'http://x').searchParams.get('folder') || ''; }
			} catch { /* ignore */ }
			const script = cfg.dshFocusScript || DEFAULTS.dshFocusScript;
			try {
				const out = await new Promise((resolve, reject) => {
					execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, folder], { timeout: 15000, windowsHide: true }, (err, stdout) => {
						if (err) reject(err); else resolve(String(stdout || '').trim());
					});
				});
				let parsed = {};
				try { parsed = JSON.parse(out); } catch { /* ignore */ }
				// 只有在「完全没有 DSH 进程」时才启动；窗口标题变化、启动中(no-window) 都不重复启动，
				// 避免多实例把已有窗口关掉/重开。
				if (parsed && parsed.reason === 'not-running') {
					try {
						const dshExe = cfg.dshExe || DEFAULTS.dshExe;
						if (fs.existsSync(dshExe)) {
							const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
							const c = spawn(dshExe, [], { detached: true, stdio: 'ignore', windowsHide: false, env });
							try { c.unref(); } catch { /* ignore */ }
							res.writeHead(200, { 'Content-Type': 'application/json' });
							res.end(JSON.stringify({ focused: true, launched: true, detail: out }));
							return;
						}
					} catch { /* ignore */ }
				}
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ focused: !!(parsed && parsed.ok), launched: false, reason: parsed && parsed.reason, detail: out }));
			} catch (error) {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ focused: false, error: String(error && error.message ? error.message : error) }));
			}
		},
	}), 'dsh-vscode-workbench: /dsh-ide-focus-dsh');

	// ================= 第3期：原生 Chat 面板 ↔ DSH 会话 =================
	// IDE 内 dsh-bridge 扩展用 ChatSessionContentProvider 把 DSH 会话渲染进原生 Chat；
	// 这些端点把 DSH 的 sessionController 暴露成简单 HTTP，供扩展调用。
	const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : 'req-' + Date.now() + '-' + Math.random().toString(16).slice(2));

	async function sc() {
		const s = ctx.get('sessionController');
		if (!s) throw new Error('sessionController unavailable');
		return s;
	}

	// 当前工作区的“活动会话”映射：cwd(normalized) -> sessionId。
	// IDE 的 Local 聊天桥在发消息前会用它决定绑定哪个 DSH 会话（受“会话列表”选择影响）；为空则新建。
	const dshActiveByCwd = new Map();
	const normCwd = p => String(p || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');

	// 列出可展示的 DSH 会话（当前工作区优先）
	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: '/dsh-sessions',
		handler: async (req, res) => {
			try {
				const url = new URL(req.url ?? '/', 'http://x');
				const cwdFilter = url.searchParams.get('cwd') || '';
				const controller = await sc();
				const value = await controller.list({}, new AbortController().signal);
				let items = (value?.items || []).map(s => ({
					sessionId: String(s.sessionId),
					cwd: s.cwd || '',
					running: !!s.running,
					blank: !!s.blank,
					updatedAt: s.updatedAt || 0,
					title: (s.projections?.values && (s.projections.values.title || s.projections.values.sessionTitle)) || '',
				}));
				if (cwdFilter) {
					items = items.filter(i => normCwd(i.cwd) === normCwd(cwdFilter));
				}
				res.writeHead(200, { 'Content-Type': 'application/json', ...DSH_CORS_HEADERS });
				res.end(JSON.stringify({ items }));
			} catch (error) {
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: String(error?.message || error) }));
			}
		},
	}), 'dsh-vscode-workbench: /dsh-sessions');

	// 设置/清除/查询某工作区的活动 DSH 会话（IDE 会话列表里“选择历史会话/新建”时调用）
	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: '/dsh-session/activate',
		handler: async (req, res) => {
			if (handlePreflight(req, res)) return;
			try {
				if (req.method === 'GET') {
					const url = new URL(req.url ?? '/', 'http://x');
					const cwd = normCwd(url.searchParams.get('cwd') || '');
					res.writeHead(200, { 'Content-Type': 'application/json', ...DSH_CORS_HEADERS });
					res.end(JSON.stringify({ cwd, session: dshActiveByCwd.get(cwd) || null }));
					return;
				}
				const body = req.method === 'POST' ? await readJsonBody(req) : {};
				const cwd = normCwd(body.cwd);
				const sid = body.session ? String(body.session) : '';
				if (!cwd) throw new Error('cwd required');
				if (sid) { dshActiveByCwd.set(cwd, sid); }
				else { dshActiveByCwd.delete(cwd); }
				res.writeHead(200, { 'Content-Type': 'application/json', ...DSH_CORS_HEADERS });
				res.end(JSON.stringify({ ok: true, cwd, session: sid || null }));
			} catch (error) {
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: String(error?.message || error) }));
			}
		},
	}), 'dsh-vscode-workbench: /dsh-session/activate');

	// 新建一个 DSH 会话（若带 cwd，则把它设为该工作区的活动会话）
	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: '/dsh-session/create',
		handler: async (req, res) => {
			if (handlePreflight(req, res)) return;
			try {
				const body = req.method === 'POST' ? await readJsonBody(req) : {};
				const controller = await sc();
				const value = await controller.create({ ...(body.cwd ? { cwd: String(body.cwd) } : {}), ...(body.agentPreset ? { agentPreset: String(body.agentPreset) } : {}) });
				const sid = String(value.sessionId);
				if (body.cwd) { dshActiveByCwd.set(normCwd(body.cwd), sid); }
				res.writeHead(200, { 'Content-Type': 'application/json', ...DSH_CORS_HEADERS });
				res.end(JSON.stringify({ sessionId: sid }));
			} catch (error) {
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: String(error?.message || error) }));
			}
		},
	}), 'dsh-vscode-workbench: /dsh-session/create');

	// 读取会话历史（转成 IDE 侧可用的 turn 列表）
	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: '/dsh-session/page',
		handler: async (req, res) => {
			if (handlePreflight(req, res)) return;
			try {
				const url = new URL(req.url ?? '/', 'http://x');
				const sessionId = url.searchParams.get('session') || '';
				if (!sessionId) throw new Error('session required');
				const controller = await sc();
				// 用 inspect 直接取事件前缀（比 page 的 throughSeq 游标更稳，不受游标上限影响）
				const insp = await controller.inspect(sessionId, new AbortController().signal);
				const events = Array.isArray(insp?.events) ? insp.events : [];
				const turns = [];
				const tools = [];
				const toolSeen = new Set();
				for (const ev of events) {
					if (!ev) continue;
					if (ev.type === 'user/message') {
						const text = extractText(ev.data?.content);
						if (text) turns.push({ role: 'user', text });
					} else if (ev.type === 'assistant/message') {
						const text = extractText(ev.data?.message?.content);
						if (text) turns.push({ role: 'assistant', text });
					} else if (ev.type === 'tool/ptc-dispatch') {
						const nm = ev.data?.name;
						if (nm && !toolSeen.has(nm)) { toolSeen.add(nm); tools.push(nm); }
					}
				}
				res.writeHead(200, { 'Content-Type': 'application/json', ...DSH_CORS_HEADERS });
				res.end(JSON.stringify({ turns, tools }));
			} catch (error) {
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: String(error?.message || error) }));
			}
		},
	}), 'dsh-vscode-workbench: /dsh-session/page');

	// 发消息
	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: '/dsh-session/prompt',
		handler: async (req, res) => {
			if (handlePreflight(req, res)) return;
			if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
			try {
				const body = await readJsonBody(req);
				const sessionId = String(body.session || '');
				const text = String(body.text || '');
				if (!sessionId || !text) throw new Error('session and text required');
				const controller = await sc();
				await controller.prompt({ requestId: uuid(), sessionId, mode: 'queue', content: [{ type: 'text', text }] }, new AbortController().signal);
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ accepted: true }));
			} catch (error) {
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: String(error?.message || error) }));
			}
		},
	}), 'dsh-vscode-workbench: /dsh-session/prompt');

	// 取消当前 turn
	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: '/dsh-session/cancel',
		handler: async (req, res) => {
			if (handlePreflight(req, res)) return;
			try {
				const body = req.method === 'POST' ? await readJsonBody(req) : {};
				const controller = await sc();
				controller.cancel({ sessionId: String(body.session || '') });
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ accepted: true }));
			} catch (error) {
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: String(error?.message || error) }));
			}
		},
	}), 'dsh-vscode-workbench: /dsh-session/cancel');

	// ---- 旧的 code-server 网页后备（默认关闭）----
	if (cfg.enableCodeServer) {
		ctx.effect(() => {
			stopped = false;
			let restarts = 0;
			const MAX_RESTARTS = 5;
			const launch = () => {
				const spec = {
					argv: [
						process.execPath,
						cfg.serverMain,
						'--host', '127.0.0.1',
						'--port', String(port),
						'--server-base-path', basePath,
						'--without-connection-token',
						'--accept-server-license-terms',
						'--disable-workspace-trust',
						...(cfg.folder ? ['--default-folder', cfg.folder] : []),
					],
					cwd: cfg.repoRoot,
					env: { ...process.env, VSCODE_DEV: '1' },
					stdio: { stdin: 'ignore', stdout: { maxBytes: 64 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
					graceMs: 5000,
				};
				try {
					child = ctx.subprocess.spawn(spec);
					child.done.then(outcome => {
						if (stopped) return;
						log('code-server exited ' + JSON.stringify(outcome));
						if (restarts < MAX_RESTARTS) { restarts += 1; setTimeout(() => { if (!stopped) launch(); }, 1500); }
					}).catch(err => log('code-server failed ' + err));
				} catch (error) { log('spawn failed ' + error); }
			};
			launch();
			return () => { stopped = true; try { child?.terminate?.(); } catch { /* ignore */ } };
		}, 'dsh-vscode-workbench: code-server process');

		ctx.effect(() => ctx.webServer.register({
			kind: 'prefix',
			path: basePath,
			handler: (req, res) => {
				const proxyReq = http.request({
					host: '127.0.0.1', port, method: req.method, path: req.url,
					headers: {
						...req.headers,
						host: `127.0.0.1:${port}`,
						'x-forwarded-prefix': basePath,
						'x-forwarded-host': req.headers.host ?? '127.0.0.1',
					},
				}, proxyRes => {
					res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
					proxyRes.pipe(res);
				});
				proxyReq.on('error', () => {
					if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
					res.end('code-server unavailable');
				});
				req.pipe(proxyReq);
			},
		}), 'dsh-vscode-workbench: /vscode http proxy');

		const productSegments = ['oss-dev', 'oss', 'stable', 'insider', 'dev'];
		const upgradePaths = new Set([basePath, basePath + '/', '/', '']);
		for (const seg of productSegments) { upgradePaths.add(`${basePath}/${seg}`); upgradePaths.add(`${basePath}/${seg}/`); }
		for (const p of upgradePaths) {
			ctx.effect(() => ctx.webServer.registerUpgrade({
				path: p,
				handler: (req, socket, head) => {
					const upstream = net.connect(port, '127.0.0.1', () => {
						const headerLines = [`GET ${req.url} HTTP/1.1`];
						const headers = { ...req.headers, host: `127.0.0.1:${port}` };
						for (const [k, v] of Object.entries(headers)) {
							if (Array.isArray(v)) { for (const vv of v) headerLines.push(`${k}: ${vv}`); }
							else if (v !== undefined) headerLines.push(`${k}: ${v}`);
						}
						headerLines.push('', '');
						upstream.write(headerLines.join('\r\n'));
						if (head && head.length) upstream.write(head);
						upstream.pipe(socket); socket.pipe(upstream);
					});
					const destroy = () => { try { upstream.destroy(); } catch { /* ignore */ } try { socket.destroy(); } catch { /* ignore */ } };
					upstream.on('error', destroy);
					socket.on('error', destroy);
					socket.on('close', () => { try { upstream.end(); } catch { /* ignore */ } });
				},
			}), `dsh-vscode-workbench: ws proxy ${p}`);
		}

		waitReady(port).then(ready => { if (!ready) log('code-server not ready in time'); });
	}

	// ---- AI 桥：IDE 内 dsh-bridge 扩展 -> DSH DeepSeek ----
	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: '/vscode-ai',
		handler: async (req, res) => {
			if (req.method !== 'POST') {
				res.writeHead(405, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'method not allowed' }));
				return;
			}
			try {
				const body = await readJsonBody(req);
				const text = await askDeepSeek(ctx, body);
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ text }));
			} catch (error) {
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: String(error && error.message ? error.message : error) }));
			}
		},
	}), 'dsh-vscode-workbench: /vscode-ai link to DSH llm');

	// ================= 第2期：自动 diff =================
	// 监听任意会话的 workspace/changes 事件，记录每个 turn 的改动摘要；
	// IDE 内的 dsh-bridge 扩展轮询 /dsh-ide-changes 获取待展示的 diff，并在原生 diff 编辑器中打开。
	// 记录表：key = "<sessionId>:<seq>"，value = { sessionId, seq, turn, files:[{index,path,added,deleted}] }
	const changeLog = new Map();      // 最近若干轮的改动摘要（供轮询）
	let changeSeqCounter = 0;         // 单调递增，便于客户端增量拉取
	const CHANGE_KEEP = 50;           // 最多保留条数
	const debug = { events: 0, wc: 0, lastType: '', lastError: '' };   // 诊断计数

	try {
		ctx.on('session/event', (session, event) => {
			try {
				debug.events += 1;
				debug.lastType = String(event?.type || '');
				if (!event || event.type !== 'workspace/changes') return;
				debug.wc += 1;
				const wc = ctx.get('workspaceChanges');
				const summary = wc?.summary?.(session?.id, event.seq);
				const files = Array.isArray(summary?.files)
					? summary.files.map((f, index) => ({
						index,
						path: String(f?.path || f?.display || ''),
						added: Number(f?.added) || 0,
						deleted: Number(f?.deleted) || 0,
					})).filter(f => f.path)
					: [];
				if (files.length === 0) return;
				const key = String(session.id) + ':' + String(event.seq);
				changeSeqCounter += 1;
				changeLog.set(key, {
					changeId: changeSeqCounter,
					sessionId: String(session.id),
					seq: Number(event.seq),
					turn: typeof summary?.turn === 'number' ? summary.turn : undefined,
					files,
				});
				// 裁剪
				while (changeLog.size > CHANGE_KEEP) {
					const first = changeLog.keys().next().value;
					changeLog.delete(first);
				}
			} catch (error) {
				debug.lastError = String(error && error.message ? error.message : error);
				log('session/event handler error: ' + debug.lastError);
			}
		});
	} catch (error) {
		log('failed to subscribe session/event: ' + (error && error.message ? error.message : error));
	}

	// 列出改动（客户端传 since=<changeId> 做增量；不传则返回全部）
	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: '/dsh-ide-changes',
		handler: async (req, res) => {
			try {
				const url = new URL(req.url ?? '/', 'http://x');
				const since = Number(url.searchParams.get('since') || 0);
				const items = [...changeLog.values()].filter(c => c.changeId > since);
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ root: cfg.folder, lastId: changeSeqCounter, items, debug }));
			} catch (error) {
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: String(error && error.message ? error.message : error) }));
			}
		},
	}), 'dsh-vscode-workbench: /dsh-ide-changes');


	// 取某个改动里第 index 个文件的 diff 内容（before/after 文本或 hunk 补丁）
	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: '/dsh-ide-diff',
		handler: async (req, res) => {
			try {
				const url = new URL(req.url ?? '/', 'http://x');
				const sessionId = url.searchParams.get('session') || '';
				const seq = Number(url.searchParams.get('seq') || -1);
				const index = Number(url.searchParams.get('index') || 0);
				const entry = changeLog.get(sessionId + ':' + seq);
				const file = entry?.files?.[index];
				if (!entry || !file) {
					res.writeHead(404, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'change not found' }));
					return;
				}
				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), 5000);
				let diff;
				try {
					diff = await ctx.get('workspaceChanges').diff(sessionId, seq, index, controller.signal);
				} finally {
					clearTimeout(timeout);
				}
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({
					path: file.path,
					display: diff?.display ?? file.path,
					kind: diff?.kind ?? 'unknown',        // 'text' | 'binary' | 'oversized' | 'refusal'
					beforeExists: diff?.before !== false, // false 表示新建文件
					afterExists: diff?.after !== false,   // false 表示删除文件
					hunks: diff?.hunks ?? null,
					added: file.added,
					deleted: file.deleted,
				}));
			} catch (error) {
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: String(error && error.message ? error.message : error) }));
			}
		},
	}), 'dsh-vscode-workbench: /dsh-ide-diff');

	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: '/dsh-account',
		handler: async (req, res) => {
			if (handlePreflight(req, res)) return;
			applyCors(res);
			if (req.method !== 'GET') {
				res.writeHead(405, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'method not allowed' }));
				return;
			}
			try {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(await readDeepSeekAccount(ctx)));
			} catch (error) {
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ signedIn: false, error: String(error && error.message ? error.message : error) }));
			}
		},
	}), 'dsh-vscode-workbench: /dsh-account');

	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: '/dsh-account/sign-in',
		handler: async (req, res) => {
			if (handlePreflight(req, res)) return;
			applyCors(res);
			if (req.method !== 'POST') {
				res.writeHead(405, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'method not allowed' }));
				return;
			}
			try {
				const account = ctx.get('deepseekAccount');
				if (!account) throw new Error('deepseekAccount 不可用');
				let origin = 'http://127.0.0.1:59602';
				try {
					const advertised = ctx.webServer.getOrigin();
					if (advertised) origin = new URL(advertised).origin;
				} catch { /* 使用本机默认来源 */ }
				await account.startSignIn(accountClient(), origin, 'desktop');
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(await readDeepSeekAccount(ctx)));
			} catch (error) {
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: String(error && error.message ? error.message : error) }));
			}
		},
	}), 'dsh-vscode-workbench: /dsh-account/sign-in');

	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: '/dsh-account/sign-out',
		handler: async (req, res) => {
			if (handlePreflight(req, res)) return;
			applyCors(res);
			if (req.method !== 'POST') {
				res.writeHead(405, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'method not allowed' }));
				return;
			}
			try {
				const account = ctx.get('deepseekAccount');
				if (!account) throw new Error('deepseekAccount 不可用');
				await account.signOut(accountClient());
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(await readDeepSeekAccount(ctx)));
			} catch (error) {
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: String(error && error.message ? error.message : error) }));
			}
		},
	}), 'dsh-vscode-workbench: /dsh-account/sign-out');
}

function accountClient() {
	return {
		version: '1.0.0',
		locale: 'zh-CN',
		timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
	};
}

function safeAvatarUrl(value) {
	if (typeof value !== 'string' || !value) return '';
	try {
		const url = new URL(value);
		if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
	} catch { /* 忽略非法头像地址 */ }
	return '';
}

/** 给 IDE 账号按钮用。只返回显示信息，不返回登录 token。 */
async function readDeepSeekAccount(ctx) {
	const account = ctx.get('deepseekAccount');
	if (!account) return { signedIn: false, unavailable: true, name: '', contact: '', avatarUrl: '' };
	const state = await account.getState();
	if (!state || state.status !== 'credential-stored') {
		return { signedIn: false, name: '', contact: '', avatarUrl: '' };
	}
	let name = '';
	let contact = '';
	let avatarUrl = '';
	try {
		const profile = await account.getProfile(accountClient());
		const value = profile && profile.status === 'ready' ? profile.value : null;
		if (value) {
			name = typeof value.name === 'string' ? value.name : '';
			contact = typeof value.contact === 'string' ? value.contact : '';
			avatarUrl = safeAvatarUrl(value.avatarUrl);
		}
	} catch { /* 已登录但资料暂时取不到 */ }
	return { signedIn: true, name: name || contact || 'DeepSeek', contact, avatarUrl };
}

/** 从消息 content（字符串 / 文本块数组）提取纯文本。 */
function extractText(content) {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) return content.map(p => (p && typeof p.text === 'string') ? p.text : '').join('');
	return '';
}

// DSH 内建 Local 聊天由 IDE（renderer，origin=vscode-file:// 或 file://）直接调用本插件的 /dsh-session/* 端点，
// 属跨源请求；必须回 CORS 头并处理 OPTIONS 预检，否则浏览器/Electron renderer 侧 fetch 报 "Failed to fetch"。
const DSH_CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Accept',
	'Access-Control-Max-Age': '86400',
};

function applyCors(res) {
	try { for (const k of Object.keys(DSH_CORS_HEADERS)) res.setHeader(k, DSH_CORS_HEADERS[k]); } catch { /* ignore */ }
	return true;
}
/** 处理 CORS 预检；若是 OPTIONS 则已回响应并返回 true。 */
function handlePreflight(req, res) {
	applyCors(res);
	if (req.method === 'OPTIONS') {
		try { res.writeHead(204); res.end(); } catch { /* ignore */ }
		return true;
	}
	return false;
}


function readJsonBody(req, limitBytes = 1024 * 1024) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on('data', c => {
			size += c.length;
			if (size > limitBytes) { reject(new Error('payload too large')); req.destroy(); return; }
			chunks.push(c);
		});
		req.on('end', () => {
			try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
			catch (error) { reject(error); }
		});
		req.on('error', reject);
	});
}

/** 调用 DSH 的 llm 服务（进程内，使用默认 provider/model）。 */
async function askDeepSeek(ctx, body) {
	const llm = ctx.get('llm') || ctx.llm;
	if (!llm || typeof llm.stream !== 'function') throw new Error('DSH llm service not available');
	let provider; let model; let reasoningEffort;
	try {
		const sel = ctx.get('agentDefaultModel')?.currentSelection?.();
		if (sel) { provider = sel.provider; model = sel.model; reasoningEffort = sel.reasoningEffort; }
	} catch { /* ignore */ }
	const toText = (content) => {
		if (typeof content === 'string') return content;
		if (Array.isArray(content)) return content.map(p => (p && typeof p.text === 'string') ? p.text : '').join('');
		return '';
	};
	const messages = Array.isArray(body.messages) && body.messages.length
		? body.messages.map(m => ({
			role: m.role === 'assistant' ? 'assistant' : (m.role === 'system' ? 'system' : 'user'),
			content: [{ type: 'text', text: toText(m.content) }],
		}))
		: [{ role: 'user', content: [{ type: 'text', text: String(body.prompt ?? '') }] }];
	const options = {
		...(provider ? { provider } : {}),
		...(model ? { model } : {}),
		...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
		...(body.system ? { system: String(body.system) } : {}),
		messages,
		...(body.maxTokens ? { maxTokens: Number(body.maxTokens) } : {}),
	};
	let reply = '';
	const stream = await llm.stream(options);
	for await (const chunk of stream) {
		if (chunk && chunk.type === 'text-delta') reply += chunk.text;
	}
	return reply;
}

export const Config = z.object({
	ideExe: z.string().default(DEFAULTS.ideExe),
	ideAppPath: z.string().default(DEFAULTS.ideAppPath),
	ideWorkdir: z.string().default(DEFAULTS.ideWorkdir),
	ideUserDataDir: z.string().default(DEFAULTS.ideUserDataDir),
	ideExtensionsDir: z.string().default(DEFAULTS.ideExtensionsDir),
	enableCodeServer: z.boolean().default(DEFAULTS.enableCodeServer),
	serverMain: z.string().default(DEFAULTS.serverMain),
	repoRoot: z.string().default(DEFAULTS.repoRoot),
	port: z.number().default(DEFAULTS.port),
	basePath: z.string().default(DEFAULTS.basePath),
	folder: z.string().default(DEFAULTS.folder),
	dshFocusScript: z.string().default(DEFAULTS.dshFocusScript),
	dshExe: z.string().default(DEFAULTS.dshExe),
});
