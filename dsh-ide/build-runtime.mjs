#!/usr/bin/env node
// dsh-ide/build-runtime.mjs
// 生成 dsh-ide bundle 的自包含 IDE 运行时载荷（runtime/）。
//
// 布局（自带 Electron，--electron-from <含exe目录>）：
//   runtime/electron/                    = Electron dist（exe + paks + dlls + icudtl + locales，跳过既有 resources 与体积型许可证）
//   runtime/electron/resources/app/      = 我们编译后的 VS Code 应用（Electron 依 exe 旁 resources/app 加载）
//   runtime/electron/resources/app/chatapp/ = chat-only DSH 子应用产物（来自 build-chatapp.mjs，--chatapp 指定）
// 无 --electron-from 时退回 runtime/app（仅供本机核对 app 内容，不可独立启动）。
//
// 应用内容：package.json + product.json + out/（剥离编译测试）+ resources/ + 裁剪内置扩展 + 生产依赖闭包 + chatapp。
// 关键事实（见 docs/dsh-ide-facts.md / docs/runtime-strategy.md）：
//   - 生产依赖闭包必须用 `npm ls --omit=dev --all --parseable` 精确枚举（不能手写，会漏 @vscode/policy-watcher 等）。
//   - 内置扩展的 node_modules 内符号链接必须原样保留（fs.cpSync(dereference:true) 会产出断链）。
//   - out/ 必须剥离测试目录（省 ~196MB）。
//   - 绝不复制 DSH 的 app.asar：这个 app 是我们自己的 VS Code 构建。
//
// 用法：
//   node dsh-ide/build-runtime.mjs \
//     --src ../vscode-1.143.1 \
//     --out  ./dsh-ide/runtime \
//     --electron-from "C:/Users/guyu/AppData/Local/Programs/DeepSeek Harness" \
//     --chatapp ./dsh-ide/runtime/chatapp
//
// 纯 Node ESM，无外部依赖；`node --check` 可验。
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PKG_DIR = path.dirname(fileURLToPath(import.meta.url)); // 即 dsh-ide/
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };

const srcRoot = path.resolve(opt('--src', path.join(PKG_DIR, '..', 'vscode-1.143.1')));
const outRuntime = path.resolve(opt('--out', path.join(PKG_DIR, 'runtime')));
const electronFrom = opt('--electron-from', '');
const chatappFrom = opt('--chatapp', '');
const electronDir = path.join(outRuntime, 'electron');
const appDir = electronFrom ? path.join(electronDir, 'resources', 'app') : path.join(outRuntime, 'app');

const log = (m) => console.log('[build-runtime] ' + m);
const warn = (m) => console.warn('[build-runtime] WARN ' + m);
const ensureDir = (d) => fs.mkdirSync(d, { recursive: true });

/** 递归复制目录树（保留符号链接解引用；depth0 可跳过顶层项；可剥离 test 目录）。返回复制文件数。 */
function copyTree(s, d, { skipTop = new Set(), stripTest = false } = {}) {
	let count = 0;
	const walk = (cs, cd, depth) => {
		for (const e of fs.readdirSync(cs, { withFileTypes: true })) {
			if (depth === 0 && skipTop.has(e.name)) continue;
			if (stripTest && e.isDirectory() && e.name === 'test') continue;
			const sp = path.join(cs, e.name); const dp = path.join(cd, e.name);
			if (e.isSymbolicLink()) {
				try {
					const r = fs.realpathSync(sp);
					if (fs.existsSync(r)) {
						if (fs.statSync(r).isDirectory()) { ensureDir(dp); walk(r, dp, depth + 1); }
						else { ensureDir(path.dirname(dp)); fs.copyFileSync(r, dp); count++; }
					}
				} catch { /* 断链跳过 */ }
				continue;
			}
			if (e.isDirectory()) { ensureDir(dp); walk(sp, dp, depth + 1); }
			else if (e.isFile()) { ensureDir(path.dirname(dp)); fs.copyFileSync(sp, dp); count++; }
		}
	};
	walk(s, d, 0);
	return count;
}

// 扩展：剔除源码/测试/仓库元数据；保留该扩展的运行依赖 node_modules（去掉开发产物）。
const EXT_SKIP = new Set(['src', 'test', '.git', '.github', '.vscode', '.vscode-test', 'out-test']);
const NM_SKIP = new Set(['test', 'tests', '__tests__', 'example', 'examples', 'doc', 'docs']);
function isDevArtifact(name) {
	return name.endsWith('.ts') || name.endsWith('.tsbuildinfo') || name.endsWith('.map') ||
		name.endsWith('.d.ts') || name.endsWith('.d.mts') || name.endsWith('.d.cts') ||
		name === '.eslintrc' || name === '.eslintrc.json' || name === '.eslintrc.js' || name === 'tsconfig.json';
}
function copyExt(s, d) {
	let count = 0;
	let inNodeModules = false;
	const walk = (cs, cd) => {
		for (const e of fs.readdirSync(cs, { withFileTypes: true })) {
			if (!inNodeModules && EXT_SKIP.has(e.name)) continue;
			if (isDevArtifact(e.name)) continue;
			const sp = path.join(cs, e.name); const dp = path.join(cd, e.name);
			if (e.isSymbolicLink()) {
				try {
					const real = fs.realpathSync(sp);
					// 关键：node_modules 内的符号链接（pnpm 绝对路径链接）原样保留，否则 copy 会变成断链。
					if (inNodeModules && fs.existsSync(real)) {
						ensureDir(path.dirname(dp));
						try { fs.symlinkSync(fs.readlinkSync(sp), dp); }
						catch { if (fs.statSync(real).isDirectory()) { ensureDir(dp); walk(real, dp); } else { ensureDir(path.dirname(dp)); fs.copyFileSync(real, dp); count++; } }
						continue;
					}
					if (fs.statSync(real).isDirectory()) { ensureDir(dp); walk(real, dp); } else { ensureDir(path.dirname(dp)); fs.copyFileSync(real, dp); count++; }
				} catch { /* 断链跳过 */ }
				continue;
			}
			if (e.isDirectory()) {
				if (e.name === '@types') continue;
				if (NM_SKIP.has(e.name)) continue;
				ensureDir(dp);
				const prev = inNodeModules;
				if (e.name === 'node_modules') inNodeModules = true;
				walk(sp, dp);
				inNodeModules = prev;
			}
			else if (e.isFile()) { ensureDir(path.dirname(dp)); fs.copyFileSync(sp, dp); count++; }
		}
	};
	walk(s, d);
	return count;
}

// 生产依赖闭包：返回相对 root node_modules 的路径列表（含嵌套）。
function prodDepPaths() {
	const nm = path.join(srcRoot, 'node_modules');
	const parse = (out) => out.split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith(nm + path.sep)).map(l => path.relative(nm, l));
	try {
		// 在 srcRoot 内执行（无需传路径，规避带空格路径的转义问题）；Windows 下由 shell 解析 npm.cmd。
		const out = execSync('npm ls --omit=dev --all --parseable', { cwd: srcRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 128 * 1024 * 1024 });
		return parse(out);
	} catch (e) {
		// npm 在存在 peer 警告时以非零退出，但 stdout 仍含完整闭包。
		const out = (e && e.stdout) ? String(e.stdout) : '';
		const rels = parse(out);
		if (rels.length) { log('  npm ls 非零退出，但已从 stdout 解析 ' + rels.length + ' 个目录'); return rels; }
		log('npm ls 失败: ' + e.message);
		return [];
	}
}

function copyProdDeps() {
	const srcNm = path.join(srcRoot, 'node_modules');
	const dstNm = path.join(appDir, 'node_modules'); ensureDir(dstNm);
	let rels = prodDepPaths();
	let via = 'npm-ls';
	if (rels.length === 0) {
		via = 'fallback';
		warn('npm ls 未产出闭包，退回 package.json dependencies 顶层（可能漏嵌套包）');
		try {
			const pkg = JSON.parse(fs.readFileSync(path.join(srcRoot, 'package.json'), 'utf8'));
			rels = Object.keys(pkg.dependencies || {});
		} catch { rels = []; }
	}
	let copied = 0, skipped = 0;
	// 去重：若某路径的祖先已在列表中，跳过（祖先的递归复制已包含它）。
	const sorted = rels.slice().sort((a, b) => a.length - b.length);
	const chosen = [];
	for (const rel of sorted) {
		if (chosen.some(a => rel === a || rel.startsWith(a + path.sep))) continue;
		chosen.push(rel);
	}
	for (const rel of chosen) {
		const s = path.join(srcNm, rel);
		if (!fs.existsSync(s)) { skipped++; continue; }
		try { const d = path.join(dstNm, rel); ensureDir(path.dirname(d)); fs.cpSync(s, d, { recursive: true, dereference: true }); copied++; }
		catch { skipped++; }
	}
	log(`  prod deps (${via}): copied ${copied}, skipped ${skipped}, unique ${chosen.length}/${rels.length}`);
}

const ELECTRON_SKIP = new Set([
	'resources', // 由我们自己的 app 填充（resources/app）
	'Uninstall DeepSeek Harness.exe',
	'Uninstall.exe',
	'debug.log',
	'7zip-installer-COPYING.txt',
	'7zip-installer-LICENSE.txt',
	'LICENSES.chromium.html', // ~20MB 纯文本许可证
]);

function copyElectron() {
	const se = path.resolve(electronFrom);
	if (!fs.existsSync(se)) throw new Error('--electron-from 不存在: ' + se);
	log('复制 Electron 运行时 <- ' + se);
	fs.rmSync(electronDir, { recursive: true, force: true }); ensureDir(electronDir);
	for (const e of fs.readdirSync(se, { withFileTypes: true })) {
		if (ELECTRON_SKIP.has(e.name)) continue;
		const sp = path.join(se, e.name); const dp = path.join(electronDir, e.name);
		if (e.isDirectory()) { ensureDir(dp); fs.cpSync(sp, dp, { recursive: true, dereference: true }); }
		else if (e.isFile()) fs.copyFileSync(sp, dp);
	}
	const exe = path.join(electronDir, 'DeepSeek Harness.exe');
	if (!fs.existsSync(exe)) {
		// exe 名随品牌可能变化；给出清晰告警但不至于中断（便于其它品牌 exe 复用）。
		const anyExe = fs.readdirSync(electronDir).filter(n => n.toLowerCase().endsWith('.exe'));
		warn('未找到 "DeepSeek Harness.exe"；目录内 exe: ' + (anyExe.join(', ') || '(none)'));
	}
	log('Electron 运行时已复制');
}

function buildApp() {
	ensureDir(appDir);
	for (const f of ['package.json', 'product.json']) {
		const s = path.join(srcRoot, f);
		if (fs.existsSync(s)) { fs.copyFileSync(s, path.join(appDir, f)); log('  + ' + f); }
		else warn('缺少根文件: ' + s);
	}
	const outSrc = path.join(srcRoot, 'out');
	if (!fs.existsSync(path.join(outSrc, 'main.js'))) throw new Error('缺少 out/main.js（先在 vscode-1.143.1 下 npm install + 编译）: ' + outSrc);
	log('  out/ ...');
	log('  out/ files: ' + copyTree(outSrc, path.join(appDir, 'out'), { skipTop: new Set(['node_modules', 'src', '.git']), stripTest: true }));

	if (fs.existsSync(path.join(srcRoot, 'resources'))) {
		log('  resources/ ...');
		copyTree(path.join(srcRoot, 'resources'), path.join(appDir, 'resources'));
	} else warn('缺少 resources/: ' + path.join(srcRoot, 'resources'));

	const srcExt = path.join(srcRoot, 'extensions');
	if (fs.existsSync(srcExt)) {
		const extDir = path.join(appDir, 'extensions'); ensureDir(extDir);
		// 裁剪：仅删 github / github-authentication / microsoft-authentication（F3 冻结决策）；测试/示例扩展不分发。
		const EXCLUDE_EXT = new Set(['github', 'github-authentication', 'microsoft-authentication']);
		const SKIP_EXT = new Set(['vscode-api-tests', 'vscode-colorize-tests', 'vscode-colorize-perf-tests', 'vscode-test-resolver', 'vscode-test']);
		const skipped = [];
		let n = 0;
		for (const e of fs.readdirSync(srcExt, { withFileTypes: true })) {
			if (!e.isDirectory()) continue;
			if (EXCLUDE_EXT.has(e.name) || SKIP_EXT.has(e.name)) { skipped.push(e.name); continue; }
			copyExt(path.join(srcExt, e.name), path.join(extDir, e.name)); n++;
		}
		log('  extensions copied: ' + n + (skipped.length ? ' (excluded: ' + skipped.join(', ') + ')' : ''));
	} else warn('缺少 extensions/: ' + srcExt);

	log('  node_modules (prod closure) ...');
	copyProdDeps();

	if (chatappFrom) {
		const caSrc = path.resolve(chatappFrom);
		if (fs.existsSync(path.join(caSrc, 'manifest.json')) || fs.existsSync(caSrc)) {
			log('  chatapp/ <- ' + caSrc);
			log('  chatapp/ files: ' + copyTree(caSrc, path.join(appDir, 'chatapp')));
		} else warn('--chatapp 目录不存在: ' + caSrc);
	} else {
		warn('未提供 --chatapp；app 内不含 chat-only 子应用资源（先运行 build-chatapp.mjs）');
	}
}

/** 目录体积统计（MB / 文件数）。 */
function dirSize(dir) {
	let bytes = 0, files = 0;
	const walk = (d) => {
		let ents;
		try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
		for (const e of ents) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) walk(p);
			else if (e.isFile()) { try { bytes += fs.statSync(p).size; files++; } catch { /* ignore */ } }
		}
	};
	if (fs.existsSync(dir)) walk(dir);
	return { mb: +(bytes / (1024 * 1024)).toFixed(2), files };
}

function logSizes() {
	const parts = [
		['electron dist', electronFrom ? electronDir : ''],
		['  app/out', path.join(appDir, 'out')],
		['  app/node_modules', path.join(appDir, 'node_modules')],
		['  app/extensions', path.join(appDir, 'extensions')],
		['  app/resources', path.join(appDir, 'resources')],
		['  app/chatapp', path.join(appDir, 'chatapp')],
	];
	log('---- 体积 ----');
	let totalMb = 0, totalFiles = 0;
	for (const [label, dir] of parts) {
		if (!dir) continue;
		const s = dirSize(dir);
		if (dir !== electronDir) { totalMb += s.mb; totalFiles += s.files; }
		log(`  ${label}: ${s.mb} MB / ${s.files} files`);
	}
	log(`  => app 合计 ≈ ${totalMb.toFixed(2)} MB / ${totalFiles} files`);
}

function main() {
	if (!fs.existsSync(srcRoot)) throw new Error('--src 不存在: ' + srcRoot);
	if (!fs.existsSync(path.join(srcRoot, 'out', 'main.js'))) throw new Error('缺少 out/main.js（未编译）: ' + srcRoot + '\n  请在 vscode-1.143.1 下执行 npm install 并编译后再运行本脚本。');
	log('src       = ' + srcRoot);
	log('out       = ' + outRuntime);
	log('appDir    = ' + appDir);
	log('electron? = ' + (electronFrom ? electronFrom : '(none)'));
	if (electronFrom) copyElectron();
	fs.rmSync(appDir, { recursive: true, force: true });
	buildApp();
	const manifest = {
		builtAt: new Date().toISOString(),
		srcRoot,
		appDir,
		electron: !!electronFrom,
		chatapp: chatappFrom ? path.resolve(chatappFrom) : null,
	};
	ensureDir(outRuntime);
	fs.writeFileSync(path.join(outRuntime, 'BUILD-MANIFEST.json'), JSON.stringify(manifest, null, 2));
	logSizes();
	log('done');
}

try { main(); }
catch (e) { console.error('[build-runtime] FATAL: ' + (e && e.message ? e.message : e)); process.exit(1); }
