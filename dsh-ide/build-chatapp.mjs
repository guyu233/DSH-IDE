#!/usr/bin/env node
// dsh-ide/build-chatapp.mjs
// 从已安装 DSH 的 app.asar 提取 chat-only DSH 子应用所需的前端资产，并组装到目标目录。
//
// 产物布局（默认 <out>/chatapp/）：
//   assets/vendor-<hash>.js        第三方 chunk（KaTeX/Shiki/highlight/ansi 等）
//   assets/vendor-<hash>.css       第三方样式
//   assets/index-<hash>.js         DSH Web shell：React 18.3.1 + react-dom + cordis + dsh-client-store
//                                  + ui-slots/ui-primitives/ui-dockkit 的 **唯一一份** React 单例 + 应用外壳
//   assets/index-<hash>.css        应用样式
//   modules/client-modules.js      @deepseek-ai/dsh-client-modules/lib/client.js（惰性 CJS 模块表 + 启动契约）
//   packages/ui-chat.js            @deepseek-ai/dsh-client-ui-chat/lib/client.js
//   packages/ui-conversation.js    @deepseek-ai/dsh-client-ui-conversation/lib/client.js
//   packages/<其它 chat 子集>.js    （ui-renderer/ui-session/ui-theme/ui-permission-presets/ui-model-selection/
//                                    ui-agent-preset/ui-approval/ui-goal/ui-layout…；缺失仅告警）
//   contract/events.js             @deepseek-ai/dsh-api-session-controller/lib/types/client/contract/events.js
//                                  （MutableSessionEventSource 的权威实现）
//   theme/*.css, theme/*.woff2     @deepseek-ai/dsh-client-ui-theme/lib/styles/（品牌字体 + token 样式）
//   boot/boot.js, boot/root.js     chatapp 薄 boot/root（来自 vscode-1.143.1 out 或 src；缺失告警）
//   manifest.json                  真实来源路径 + 版本 + 每项状态
//
// 重要事实（已用 tools/asar-read.cjs 在 0.2.1-rc.5 上核验）：
//   - vendor-*.js 是第三方 chunk（KaTeX/Shiki…），**不是** React+cordis！
//   - React 18.3.1 / react-dom / cordis / dsh-client-store / ui-slots / ui-primitives / ui-dockkit
//     全部内联进 index-*.js（dsh-client-web 外壳），并且以 staticModules 形式被 __ModuleLoader__ 注入。
//     -> 因此**不单独复制 React**：index-*.js 内的那份即“单一 React 18.3.1 副本”。
//   - dsh-client-store / ui-primitives / ui-slots / ui-dockkit 在 asar 中无独立 lib/client.js，只存在于 index-*.js。
//
// 用法：
//   node dsh-ide/build-chatapp.mjs --asar "<.../resources/app.asar>" --out "./dsh-ide/runtime/chatapp"
//   可选：--src <vscode-1.143.1>（boot/root 源根，默认自动探测）
//
// 纯 Node ESM；app.asar 用只读 fs 直接解析头（无需第三方 asar 库）。
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_DIR = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };

const asarPath = opt('--asar', 'C:/Users/guyu/AppData/Local/Programs/DeepSeek Harness/resources/app.asar');
const outDir = path.resolve(opt('--out', path.join(PKG_DIR, 'runtime', 'chatapp')));
const srcHint = opt('--src', '');

const log = (m) => console.log('[build-chatapp] ' + m);
const warn = (m) => console.warn('[build-chatapp] WARN ' + m);
const ensureDir = (d) => fs.mkdirSync(d, { recursive: true });

/** 迷你 asar 读取器：解析头，find(re)->[{path,off,size}] / read(entry)->Buffer。 */
function openAsar(file) {
	const fd = fs.openSync(file, 'r');
	const head = Buffer.alloc(16); fs.readSync(fd, head, 0, 16, 0);
	const headerSize = head.readUInt32LE(12);
	const headerBuf = Buffer.alloc(headerSize); fs.readSync(fd, headerBuf, 0, headerSize, 16);
	const header = JSON.parse(headerBuf.toString('utf8').replace(/\0+$/, ''));
	const base = 16 + headerSize;
	function all() {
		const out = [];
		(function walk(node, prefix) {
			if (!node.files) return;
			for (const key of Object.keys(node.files)) {
				const p = prefix + '/' + key; const c = node.files[key];
				if (c.files) walk(c, p);
				else out.push({ path: p, off: Number(c.offset), size: Number(c.size) });
			}
		})(header, '');
		return out;
	}
	let cache = null;
	const list = () => (cache ??= all());
	function find(re) { return list().filter(e => re.test(e.path)); }
	function read(entry) { const buf = Buffer.alloc(entry.size); fs.readSync(fd, buf, 0, entry.size, base + entry.off); return buf; }
	function close() { try { fs.closeSync(fd); } catch { /* ignore */ } }
	return { find, read, list, close };
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 抓取单个精确路径；返回 {ok, buf, path, size}。 */
function grab(asar, exactPath) {
	const hits = asar.find(new RegExp('^' + escRe(exactPath) + '$'));
	if (!hits.length) return { ok: false, path: exactPath };
	const e = hits[0];
	return { ok: true, path: e.path, size: e.size, buf: asar.read(e) };
}

function writeBuf(rel, buf) { const dst = path.join(outDir, rel); ensureDir(path.dirname(dst)); fs.writeFileSync(dst, buf); return dst; }

/** chat 子应用所需 packet 明细：packages/<short>.js <- exact asar path */
const CLIENT_UI_SUBSET = [
	['ui-conversation', '/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js'],
	['ui-chat', '/dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js'],
	['ui-renderer', '/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js'],
	['ui-session', '/dsh/node_modules/@deepseek-ai/dsh-client-ui-session/lib/client.js'],
	['ui-theme', '/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js'],
	['ui-permission-presets', '/dsh/node_modules/@deepseek-ai/dsh-client-ui-permission-presets/lib/client.js'],
	['ui-model-selection', '/dsh/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js'],
	['ui-agent-preset', '/dsh/node_modules/@deepseek-ai/dsh-client-ui-agent-preset/lib/client.js'],
	['ui-approval', '/dsh/node_modules/@deepseek-ai/dsh-client-ui-approval/lib/client.js'],
	['ui-goal', '/dsh/node_modules/@deepseek-ai/dsh-client-ui-goal/lib/client.js'],
	['ui-layout', '/dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js'],
	['ui-input-trigger', '/dsh/node_modules/@deepseek-ai/dsh-client-ui-input-trigger/lib/client.js'],
	['ui-attachment', '/dsh/node_modules/@deepseek-ai/dsh-client-ui-attachment/lib/client.js'],
];

function detectFrontendAssets(asar) {
	// 精确锁定 dist 顶层产物（hash 随版本变化，用模式匹配）。
	const js = asar.find(/^\/dsh\/node_modules\/@deepseek-ai\/dsh-web-frontend\/dist\/assets\/index-[^/]+\.js$/);
	const css = asar.find(/^\/dsh\/node_modules\/@deepseek-ai\/dsh-web-frontend\/dist\/assets\/index-[^/]+\.css$/);
	const vjs = asar.find(/^\/dsh\/node_modules\/@deepseek-ai\/dsh-web-frontend\/dist\/assets\/vendor-[^/]+\.js$/);
	const vcss = asar.find(/^\/dsh\/node_modules\/@deepseek-ai\/dsh-web-frontend\/dist\/assets\/vendor-[^/]+\.css$/);
	return { js: js[0], css: css[0], vjs: vjs[0], vcss: vcss[0] };
}

function main() {
	log('asar = ' + asarPath);
	log('out  = ' + outDir);
	if (!fs.existsSync(asarPath)) throw new Error('找不到 app.asar: ' + asarPath + '\n  传入 --asar "<DeepSeek Harness>/resources/app.asar"。');

	const asar = openAsar(asarPath);
	ensureDir(outDir);
	const manifest = { builtAt: new Date().toISOString(), asar: asarPath, assets: {}, packages: {}, contract: null, theme: [], boot: {}, react: {}, warnings: [] };

	// 1) 前端外壳资产（index/vendor js+css）——index-*.js 内含唯一 React 18.3.1 单例。
	const fe = detectFrontendAssets(asar);
	if (!fe.js) throw new Error('未找到 dsh-web-frontend/dist/assets/index-*.js（asar 内 web frontend 缺失）');
	for (const [key, entry] of [['index.js', fe.js], ['index.css', fe.css], ['vendor.js', fe.vjs], ['vendor.css', fe.vcss]]) {
		if (!entry) { warn('缺少前端资产: ' + key); manifest.warnings.push('missing asset ' + key); continue; }
		const rel = 'assets/' + path.basename(entry.path);
		writeBuf(rel, asar.read(entry));
		manifest.assets[key] = { from: entry.path, to: rel, size: entry.size };
		log('  asset ' + rel + ' <- ' + entry.path);
	}

	// 2) client-modules 启动契约（惰性 CJS 表 + createClientModuleSystem）。
	const mod = grab(asar, '/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js');
	if (mod.ok) { writeBuf('modules/client-modules.js', mod.buf); manifest.assets['client-modules'] = { from: mod.path, to: 'modules/client-modules.js', size: mod.size }; log('  modules/client-modules.js'); }
	else { warn('缺少 dsh-client-modules/lib/client.js —— 子应用无法启动'); manifest.warnings.push('missing client-modules'); }

	// 3) MutableSessionEventSource 的权威实现（contract/events.js）。
	const ev = grab(asar, '/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/contract/events.js');
	if (ev.ok) { writeBuf('contract/events.js', ev.buf); manifest.contract = { from: ev.path, to: 'contract/events.js', size: ev.size }; log('  contract/events.js'); }
	else { warn('缺少 contract/events.js —— session 事件源不可用'); manifest.warnings.push('missing contract/events.js'); }

	// 4) chat 子集 ui-*.client.js（版本容错：缺失仅告警并继续）。
	const seen = new Set();
	for (const [shortName, asarExact] of CLIENT_UI_SUBSET) {
		if (seen.has(asarExact)) continue; seen.add(asarExact);
		const g = grab(asar, asarExact);
		if (!g.ok) { warn('缺失 UI 包（跳过）: ' + asarExact); manifest.warnings.push('missing ' + shortName); manifest.packages[shortName] = null; continue; }
		const rel = 'packages/' + shortName + '.js';
		writeBuf(rel, g.buf);
		manifest.packages[shortName] = { from: g.path, to: rel, size: g.size };
		log('  ' + rel);
	}

	// 5) 主题样式 + 品牌字体（token 样式与字体）。
	const themeFiles = asar.find(/^\/dsh\/node_modules\/@deepseek-ai\/dsh-client-ui-theme\/lib\/styles\/[^/]+$/);
	for (const e of themeFiles) {
		const rel = 'theme/' + path.basename(e.path);
		writeBuf(rel, asar.read(e));
		manifest.theme.push({ from: e.path, to: rel, size: e.size });
	}
	log('  theme/*: ' + themeFiles.length + ' 个文件');

	// 6) 薄 boot/root（优先 vscode-1.143.1 的**编译产物** out/**.js；仅当无编译产物时退回 src *.ts 并明确告警）。
	const roots = [];
	if (srcHint) roots.push(path.resolve(srcHint));
	roots.push(path.join(PKG_DIR, '..', 'vscode-1.143.1'));
	const CHATAPP_REL = 'src/vs/workbench/contrib/dsh/chatapp';
	const bootSpecs = [
		['boot/boot.js', 'boot.ts'],
		['boot/root.js', 'root.tsx'],
	];
	let sawRoot = false;
	for (const root of roots) {
		if (!fs.existsSync(root)) continue;
		sawRoot = true;
		for (const [outRel, tsName] of bootSpecs) {
			const compiled = path.join(root, 'out', CHATAPP_REL, tsName.replace(/\.(ts|tsx)$/, '.js'));
			const source = path.join(root, CHATAPP_REL, tsName);
			if (fs.existsSync(compiled)) {
				ensureDir(path.dirname(path.join(outDir, outRel)));
				fs.copyFileSync(compiled, path.join(outDir, outRel));
				manifest.boot[outRel] = { from: compiled, compiled: true };
				log('  ' + outRel + ' <- ' + compiled);
			} else if (fs.existsSync(source)) {
				// 未编译：以 .ts 原名保留（不改名为 .js，避免“伪编译产物”误载入）；告警提示先编译。
				const rawRel = 'boot/' + tsName;
				ensureDir(path.dirname(path.join(outDir, rawRel)));
				fs.copyFileSync(source, path.join(outDir, rawRel));
				manifest.boot[rawRel] = { from: source, compiled: false };
				manifest.warnings.push('boot/root 未编译（拷贝了 ' + tsName + ' 源码，需先 tsc 生成 out/**.js）');
				warn('boot/root 仅找到未编译源码: ' + source + '（请先编译 vscode-1.143.1 的 chatapp，再重跑本脚本）');
			}
		}
		break; // 用第一个存在的 root
	}
	if (!sawRoot || Object.keys(manifest.boot).length === 0) {
		warn('未找到 chatapp boot/root（需先编译 vscode-1.143.1 的 chatapp，或提供 --src）；产物不含 boot/root。');
		if (!manifest.warnings.includes('missing boot/root')) manifest.warnings.push('missing boot/root');
	}

	// 7) 单一 React 说明：index-*.js 内内联 React 18.3.1（含 react-dom），此处仅记录，不单独复制任何 React。
	manifest.react = {
		strategy: 'single-copy-in-index-shell',
		note: 'React 18.3.1 + react-dom + cordis + dsh-client-store/ui-slots/ui-primitives/ui-dockkit 均内联于 ' +
			(fe.js ? path.basename(fe.js.path) : 'index-*.js') + '，以 staticModules 注入 __ModuleLoader__。子应用只引用这一份，不另复制 React。',
	};
	log('React: 单一副本 -> ' + (fe.js ? path.basename(fe.js.path) : '(index shell)'));

	asar.close();
	fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
	log('manifest: ' + path.join(outDir, 'manifest.json'));
	if (manifest.warnings.length) log('warnings: ' + manifest.warnings.length + ' 项（见 manifest.json）');
	log('done');
}

try { main(); }
catch (e) { console.error('[build-chatapp] FATAL: ' + (e && e.message ? e.message : e)); process.exit(1); }
