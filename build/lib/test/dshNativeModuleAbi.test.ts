/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// D23 前置（第 38 轮）：5 个随包原生模块的 `.node` 产物必须是 **NAPI** 模块。
//
// 背景：手册第 3 章 P6 ⑥ 断言「随包 5 个原生模块全部走 NAPI，重编降级为 ABI/NAPI
// 加载冒烟」——但此前这只是文档说法，没有任何可执行证据。第 38 轮逐个读取
// `node_modules` 里的 `.node` 二进制并检查 `napi_*` 符号，确认五者**全部**是 NAPI
// （node-pty 的 `conpty` / `conpty_console_list`、`@vscode/spdlog`、`@vscode/sqlite3`、
// `@vscode/windows-process-tree`、`@parcel/watcher`）。
//
// 本测试把这一结论钉死：
//   - 若某模块被换成 ABI 构建（不含 `napi_` 符号），测试失败 → 提醒重编或换源；
//   - 若模块缺失（未安装），本测试**跳过而不失败**——因为「未安装」不是 NAPI 回退，
//     真正的加载结果仍须真机 U06 / D23 判定。
//
// 边界：NAPI 与 ABI 解耦只说明「不因 Electron 主版本不同而必须重编」，
// **不等于**已验证在宿主 Electron 44.7.0 下加载成功；后者归 §0.2 U06 / D23。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const nodeModules = path.join(repoRoot, 'node_modules');

/** 随包 5 个原生模块：包名 → 期望存在的绑定文件所在目录。 */
const NATIVE_MODULES = [
	{ pkg: 'node-pty', expect: ['conpty', 'conpty_console_list'] },
	{ pkg: '@vscode/spdlog', expect: ['spdlog'] },
	{ pkg: '@vscode/sqlite3', expect: ['vscode-sqlite3'] },
	{ pkg: '@vscode/windows-process-tree', expect: ['windows_process_tree'] },
	{ pkg: '@parcel/watcher', expect: ['watcher'] },
];

/** 递归找出目录下全部 `.node` 文件。 */
function findBindings(dir) {
	const found = [];
	const walk = (current) => {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) { walk(full); continue; }
			if (entry.name.endsWith('.node')) { found.push(full); }
		}
	};
	walk(dir);
	return found;
}

test('D23 the five shipped native modules are NAPI builds, not ABI-only', () => {
	const checked = [];
	const missing = [];

	for (const mod of NATIVE_MODULES) {
		const pkgDir = path.join(nodeModules, mod.pkg);
		if (!fs.existsSync(pkgDir)) { missing.push(mod.pkg); continue; }

		const bindings = findBindings(pkgDir);
		if (bindings.length === 0) { missing.push(`${mod.pkg} (no .node)`); continue; }

		for (const binding of bindings) {
			// NAPI 模块会导入 napi_* ；纯 ABI 模块只有 node:: / v8:: 符号。
			const content = fs.readFileSync(binding).toString('latin1');
			assert.match(content, /napi_/, `${mod.pkg}: ${path.basename(binding)} must import napi_* symbols (NAPI build)`);
			checked.push(`${mod.pkg}:${path.basename(binding)}`);
		}

		// 期望的主绑定文件确实在其中（防止只剩一个无关的 .node）。
		for (const expected of mod.expect) {
			const hit = bindings.some(binding => path.basename(binding) === `${expected}.node`);
			assert.ok(hit, `${mod.pkg} must ship ${expected}.node`);
		}
	}

	assert.ok(checked.length >= 5, `expected at least five NAPI bindings verified, got ${checked.length}: ${checked.join(', ')}`);
	// 未安装不算失败（真正的加载结论归真机），但要在测试名/输出里可见。
	if (missing.length > 0) {
		console.log(`[D23] not installed, skipped: ${missing.join(', ')} — real load result belongs to U06/D23`);
	}
});

test('D23 on win32 the node-pty binding is conpty (not pty)', () => {
	const release = path.join(nodeModules, 'node-pty', 'build', 'Release');
	if (!fs.existsSync(release)) { return; }

	// 依据 node-pty 自身的加载分支：win32 用 conpty，非 win32 用 pty。
	const index = fs.readFileSync(path.join(nodeModules, 'node-pty', 'lib', 'index.js'), 'utf8');
	assert.match(index, /process\.platform !== 'win32'[\s\S]{0,60}loadNativeModule\)\('pty'\)/,
		'node-pty must only load pty.node off win32; on win32 conpty is the binding');

	const bindings = fs.readdirSync(release).filter(name => name.endsWith('.node'));
	if (process.platform === 'win32') {
		assert.ok(bindings.includes('conpty.node'), 'win32 builds must ship conpty.node');
		assert.ok(!bindings.includes('pty.node'), 'win32 builds must not be expected to ship pty.node');
	}
});

// ---------------------------------------------------------------------------
// 第 52 轮（D56 静态部分）：NAPI 模块**不依赖** `NODE_MODULE_VERSION`。
//
// D56 原文要求「逐模块记录 … 构建参数、`NODE_MODULE_VERSION` 与实际加载结果」。
// 但对 NAPI 模块这一项**不适用**：它们通过 `napi_register_module_v1` 注册，
// 二进制里**不含** `NODE_MODULE_VERSION` 字符串/常量，因此不会因宿主 Electron
// 的 ABI 版本不同而失配——这正是第 38 轮「五者全是 NAPI」结论能成立的原因。
//
// 本测试把这条技术事实钉住：任何「NAPI 模块却内嵌 NODE_MODULE_VERSION」的情况
// 都会失败（那意味着它其实是 ABI 模块，ABI 校验将重新变成必需项）。
// ---------------------------------------------------------------------------

test('D56 NAPI modules register via napi_register_module_v1 and carry no NODE_MODULE_VERSION', () => {
	const checked = [];

	for (const mod of NATIVE_MODULES) {
		const pkgDir = path.join(nodeModules, mod.pkg);
		if (!fs.existsSync(pkgDir)) { continue; }
		for (const binding of findBindings(pkgDir)) {
			const content = fs.readFileSync(binding).toString('latin1');
			const name = `${mod.pkg}:${path.basename(binding)}`;
			// NAPI 的注册入口存在（第 38 轮已断言 napi_* 符号；这里再钉注册函数本身）。
			assert.match(content, /napi_register_module_v1/,
				`${name} must register via napi_register_module_v1`);
			// 且不含 ABI 版本串——有它说明不是纯 NAPI，ABI 校验会成为必需。
			assert.doesNotMatch(content, /NODE_MODULE_VERSION/,
				`${name} must not embed NODE_MODULE_VERSION; a NAPI build has no such dependency`);
			checked.push(name);
		}
	}

	assert.ok(checked.length >= 5, `expected at least five NAPI bindings checked, got ${checked.length}`);
});

// ---------------------------------------------------------------------------
// 第 39 轮：5 个原生模块必须由**生产依赖**随包，否则打包后运行时找不到。
//
// 发现的真实缺陷：`node-pty` 原先声明在 `devDependencies`，而打包用
// `npm ls --all --omit=dev` 收集生产依赖 → 它被排除，产物里缺 node-pty，
// 终端在打包版里无法启动。其余 4 个模块一直在 `dependencies`。
// 本测试把「5 个模块都在 dependencies、且都不在 devDependencies」钉死。
// ---------------------------------------------------------------------------

test('the five native modules are declared as production dependencies', () => {
	const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};
	for (const mod of NATIVE_MODULES) {
		assert.ok(pkg.dependencies?.[mod.pkg] !== undefined,
			`${mod.pkg} must be a production dependency, otherwise "npm ls --omit=dev" drops it from the package`);
		assert.equal(pkg.devDependencies?.[mod.pkg], undefined,
			`${mod.pkg} must not also be listed in devDependencies`);
	}
	// @parcel/watcher 在源码里以 scoped 名声明；这里额外确认未被写成别的名字。
	assert.ok(pkg.dependencies?.['@parcel/watcher'] !== undefined, '@parcel/watcher must stay a production dependency');
});
