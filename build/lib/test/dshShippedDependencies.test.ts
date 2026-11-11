/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 第 40 轮：**交付物引用的模块必须在 `dependencies`**，不能只在 `devDependencies`。
//
// 背景：第 39 轮发现 `node-pty` 被错放在 `devDependencies`——打包脚本用
// `npm ls --all --omit=dev` 收集生产依赖，`devDependencies` 会被整体排除，
// 于是产物里没有该模块，终端在打包版里无法启动。
//
// 本测试把这类缺陷变成**可自动发现**：扫描会进入交付物的源码（排除 test /
// fixtures / server——DSH-IDE 是 bundle 插件，不产出 VS Code server），
// 收集所有裸模块 import，若某模块「被引用、且只在 devDependencies」则判失败。
//
// 边界的两次校准（第 40 轮实测得出，写进注释避免后来者重新踩）：
//   ① Node 内置模块（`util` / `path` …）常被写成不带 `node:` 前缀，必须按
//      `module.builtinModules` 排除，否则误报；
//   ② `src/vs/server/**` 只被 `serverEntryPoints`（server target）使用，
//      desktop 构建不包含它，故其中的 `cookie` 等依赖留在 devDependencies 是对的。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import builtin from 'node:module';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const vsRoot = path.join(repoRoot, 'src/vs');

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
};
const deps = new Set(Object.keys(pkg.dependencies ?? {}));
const devDeps = new Set(Object.keys(pkg.devDependencies ?? {}));
const builtins = new Set(builtin.builtinModules);

/** 不进入桌面交付物的路径：测试、fixtures、以及仅 server target 使用的代码。 */
const NOT_SHIPPED = /\/test\/|\/fixtures\/|\/server\//;

/**
 * 收集进入交付物的源码里出现的裸模块名。
 * @returns {Map<string, string[]>} 模块名 → 引用它的文件（最多留几个便于定位）
 */
function shippedBareImports() {
	/** @type {Map<string, string[]>} */
	const hits = new Map();
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) { walk(full); continue; }
			if (!/\.(ts|tsx)$/.test(entry.name)) { continue; }
			const normalized = full.replace(/\\/g, '/');
			if (NOT_SHIPPED.test(normalized)) { continue; }
			const text = fs.readFileSync(full, 'utf8');
			for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
				const spec = match[1];
				if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) { continue; }
				const parts = spec.split('/');
				const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
				if (name === 'vscode' || builtins.has(name)) { continue; }
				const list = hits.get(name) ?? [];
				if (list.length < 3) { list.push(path.relative(repoRoot, full)); }
				hits.set(name, list);
			}
		}
	};
	walk(vsRoot);
	return hits;
}

test('every module imported by shipped code is a production dependency', () => {
	const imports = shippedBareImports();
	assert.ok(imports.size >= 50, `expected the shipped import surface, got ${imports.size}`);

	const dropped = [];
	for (const [name, files] of imports) {
		// 只关心「声明了但只声明在 devDependencies」这一类；完全未声明的由上游校验负责。
		if (devDeps.has(name) && !deps.has(name)) {
			dropped.push(`${name} (used by ${files[0]})`);
		}
	}
	assert.deepEqual(dropped.sort(), [],
		`these modules are imported by shipped code but only declared in devDependencies, so "npm ls --omit=dev" drops them from the package: ${dropped.join('; ')}`);
});

test('node-pty stays a production dependency (the round-39 regression case)', () => {
	// 具体回归点：node-pty 被生产代码引用，必须在 dependencies。
	assert.ok(deps.has('node-pty'), 'node-pty must stay a production dependency');
	assert.ok(!devDeps.has('node-pty'), 'node-pty must not be duplicated into devDependencies');

	const ptyUsers = [...shippedBareImports().keys()].includes('node-pty');
	assert.ok(ptyUsers, 'node-pty must still be imported by shipped code (terminal layer)');
});
