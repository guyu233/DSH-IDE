#!/usr/bin/env node
/**
 * 插件包完整性审计。
 *
 * 打包产物一旦有「引用了不存在的文件」或「声明了没用的依赖」，
 * 静态检查与单元测试都发现不了——只有真机加载时才炸。这里把三件事变成可复算的检查：
 *
 *   1. 插件层每个 `.js` 的相对 import 都必须指向包内真实存在的文件。
 *   2. 插件层不得 import 任何未在 `peerDependencies` 里声明的外部包
 *      （`node:*` 内置模块不算）。
 *   3. `package.json` 的 `exports` 每条目标都必须存在。
 *
 * `runtime/app` 是 VS Code 自己的载荷，不属插件层，整目录跳过。
 *
 * 用法：node build/lib/dsh/verify/dshBundleIntegrity.mjs [--verbose]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const verbose = process.argv.includes('--verbose');

const manifest = JSON.parse(readFileSync(join(repoRoot, 'build', 'lib', 'dsh', 'package.json'), 'utf8'));
const tgz = join(repoRoot, 'dist', `${manifest.name}-${manifest.version}.tgz`);
if (!existsSync(tgz)) {
	console.error(`STATUS: FAIL  [bundle-integrity] 找不到产物 ${tgz}，先跑 gulp dsh-ide-pack`);
	process.exit(1);
}

const staging = join(repoRoot, 'out', 'dsh-bundle-integrity');
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
execFileSync('tar', ['-xzf', tgz, '-C', staging], { stdio: 'ignore' });
const pkgRoot = join(staging, 'package');

const problems = [];
const declaredPeers = new Set(Object.keys(manifest.peerDependencies ?? {}));
const declaredDeps = new Set(Object.keys(manifest.dependencies ?? {}));
let relativeImports = 0;
let externalImports = 0;
const externals = new Set();

/** 遍历插件层（跳过 runtime/app）。 */
function walk(dir, visit) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'runtime') {
				continue;
			}
			walk(full, visit);
			continue;
		}
		visit(full);
	}
}

walk(pkgRoot, file => {
	if (!file.endsWith('.js')) {
		return;
	}
	const raw = readFileSync(file, 'utf8');
	// 注释里提到 `require('…')` 是说明文字，不是真的依赖：先剔除块注释与行注释。
	const source = raw
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split(/\r?\n/)
		.filter(line => !/^\s*\/\//.test(line))
		.join('\n');
	const label = file.slice(pkgRoot.length + 1);

	// 1) 相对 import 必须存在。
	for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
		relativeImports++;
		const target = resolve(dirname(file), match[1]);
		if (!existsSync(target)) {
			problems.push(`${label}: 相对 import 指向不存在的文件 ${match[1]}`);
		}
	}

	// 2) 外部依赖必须在 peerDependencies / dependencies 里声明。
	// 注意 `client.js` 走 DSH 的 `__ModuleLoader__`，用 `require("react")` 而不是 `import`，
	// 只匹配 import 会漏掉它，进而误判「声明了却没用到」。
	for (const match of source.matchAll(/(?:from|import|require)\s*\(?\s*['"]([^.'"][^'"]*)['"]/g)) {
		const specifier = match[1];
		if (specifier.startsWith('node:')) {
			continue;
		}
		externalImports++;
		// `@scope/pkg/sub` → `@scope/pkg`；`pkg/sub` → `pkg`。
		const parts = specifier.split('/');
		const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
		externals.add(name);
		if (!declaredPeers.has(name) && !declaredDeps.has(name)) {
			problems.push(`${label}: import 了未声明的外部包 ${name}`);
		}
	}
});

// 3) exports 的每条目标必须存在。
for (const [key, value] of Object.entries(manifest.exports ?? {})) {
	if (typeof value !== 'string' || value.includes('*')) {
		continue;
	}
	if (!existsSync(join(pkgRoot, value))) {
		problems.push(`package.json: exports["${key}"] 指向不存在的文件 ${value}`);
	}
}

// 4) 每个 peer 都必须真的被用到（声明了不用的 peer 会误导安装方）。
for (const peer of declaredPeers) {
	if (!externals.has(peer)) {
		problems.push(`package.json: 声明了 peerDependency ${peer} 但代码里没有 import`);
	}
}

if (verbose) {
	console.log(`产物        : ${tgz} (${statSync(tgz).size} B)`);
	console.log(`相对 import : ${relativeImports}`);
	console.log(`外部 import : ${externalImports}（去重 ${externals.size} 个：${[...externals].sort().join(', ')}）`);
	console.log(`peer 依赖   : ${[...declaredPeers].sort().join(', ') || '(none)'}`);
}

if (problems.length > 0) {
	for (const problem of problems) {
		console.error(`  ✗ ${problem}`);
	}
	console.error(`STATUS: FAIL  [bundle-integrity] ${problems.length} 处问题`);
	process.exit(1);
}

console.log(`STATUS: PASS  [bundle-integrity] ${relativeImports} 个相对 import 全部可达、外部依赖与声明一致、exports 目标齐全`);
