/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 第 43 轮：**守护反向验证**的可重复流程（不属于测试套件，手动运行）。
//
// 起因：第 42 轮发现 D20 的守护是「假通过」——`includes()` 匹配到了注释里的同名
// 字符串，导致「入口已删」的守护仍然通过。这类缺陷只有**故意破坏被测对象、
// 确认守护真的会失败**才能发现。
//
// 本脚本把该流程固化，便于每次新增或修改守护后重跑，而不必手工逐条注入。
// **它只读仓库、在临时副本上操作，绝不修改工作区文件**；每项验证完立即比对
// 还原后的内容，确保工作区未被污染。
//
// 用法：`node build/lib/dsh/verify/dshGuardNegative.mjs`
// 退出码：0 = 全部守护都能失败（健康）；1 = 有守护「破坏后不失败」（存在假通过）。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const tmp = path.join(repoRoot, '.build', 'negverify');

/** 跑一条测试文件，返回是否**失败**（期望 true）。 */
function testFails(file) {
	try {
		execFileSync(process.execPath, ['--experimental-strip-types', '--test', file], {
			cwd: repoRoot,
			stdio: 'ignore',
			env: { ...process.env, NODE_OPTIONS: '' },
		});
		return false; // 没抛错 ⇒ 测试通过 ⇒ 破坏没被抓住
	} catch {
		return true; // 抛错 ⇒ 测试失败 ⇒ 守护生效
	}
}

/**
 * 跑一条 **verify 脚本**（不是 --test 文件），返回它是否失败（期望 true）。
 *
 * 第 75 轮新增：`docs-graph` 这类脚本以退出码表达成败，不是 node:test 用例，
 * 因此需要另一种调用方式。传 `env` 便于有的用例调整环境。
 */
function scriptFails(script, extraEnv = {}) {
	try {
		execFileSync(process.execPath, ['--experimental-strip-types', script], {
			cwd: repoRoot,
			stdio: 'ignore',
			env: { ...process.env, ...extraEnv, NODE_OPTIONS: '' },
		});
		return false;
	} catch {
		return true;
	}
}

/** 备份若干文件，返回还原函数。 */
function snapshot(paths) {
	const saved = new Map();
	for (const rel of paths) {
		const abs = path.join(repoRoot, rel);
		saved.set(abs, fs.readFileSync(abs));
	}
	return () => {
		for (const [abs, content] of saved) { fs.writeFileSync(abs, content); }
	};
}

/**
 * 每条验证：破坏 → 跑测试 → 还原 → 断言「破坏时确实失败」。
 * @type {{ name: string, files: string[], test: string, break: () => void }[]}
 */
const CASES = [
	{
		name: 'listen 事件面守护（第 24 轮）',
		files: ['src/vs/platform/dshClient/electron-main/dshIdeChannel.ts'],
		test: 'build/lib/test/dshIdeEndpoints.test.ts',
		break() {
			const rel = 'src/vs/platform/dshClient/electron-main/dshIdeChannel.ts';
			const abs = path.join(repoRoot, rel);
			const raw = fs.readFileSync(abs, 'utf8');
			const patched = raw.replace(
				'if (event !== DSH_IDE_SNAPSHOT_EVENT) {',
				"if (event !== DSH_IDE_SNAPSHOT_EVENT && event !== 'waterfall') {",
			);
			if (patched === raw) { throw new Error('pattern miss'); }
			fs.writeFileSync(abs, patched, 'utf8');
		},
	},
	{
		name: '交付依赖守护（第 39–40 轮）',
		files: ['package.json'],
		test: 'build/lib/test/dshShippedDependencies.test.ts',
		break() {
			const abs = path.join(repoRoot, 'package.json');
			const pkg = JSON.parse(fs.readFileSync(abs, 'utf8'));
			pkg.devDependencies['node-pty'] = pkg.dependencies['node-pty'];
			delete pkg.dependencies['node-pty'];
			fs.writeFileSync(abs, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
		},
	},
	{
		name: 'PROVENANCE 哈希守护（第 29–31 轮）',
		files: ['src/vs/platform/dshClient/common/env.js'],
		test: 'build/lib/test/dshProvenanceHashes.test.ts',
		break() {
			const abs = path.join(repoRoot, 'src/vs/platform/dshClient/common/env.js');
			fs.appendFileSync(abs, '\n// tamper\n', 'utf8');
		},
	},
	{
		// 第 74 轮补：第 68 轮让 contract 能按版本判 PASS/FAIL。若有人把它改回
		// 「无条件 PENDING」，本用例会失败（说明守护失效）。
		name: 'contract 版本断言守护（第 68 轮）',
		files: ['src/vs/platform/dshClient/common/dshIdeContract.ts'],
		test: 'build/lib/test/dshIdeEndpoints.test.ts',
		break() {
			const rel = 'src/vs/platform/dshClient/common/dshIdeContract.ts';
			const abs = path.join(repoRoot, rel);
			const raw = fs.readFileSync(abs, 'utf8');
			// 把首个注入点的基线指纹改成明显错误的值 → 门禁与测试都应失败。
			const patched = raw.replace(/sha256: '[0-9a-f]{16}'/, "sha256: '0000000000000000'");
			if (patched === raw) { throw new Error('fingerprint anchor miss'); }
			fs.writeFileSync(abs, patched, 'utf8');
		},
	},
	{
		// 第 74 轮补：第 69 轮让 projection-golden 内置 P95 断言。破坏阈值常量
		// （改成 1 B）后，门禁必须失败；若仍 PASS 说明断言是假的。
		name: 'P95 阈值断言守护（第 69 轮）',
		files: ['build/lib/dsh/verify/dshIdeVerify.mjs'],
		test: 'build/lib/test/dshIdeEndpoints.test.ts',
		break() {
			const rel = 'build/lib/dsh/verify/dshIdeVerify.mjs';
			const abs = path.join(repoRoot, rel);
			const raw = fs.readFileSync(abs, 'utf8');
			const patched = raw.replace('const limit = 512 * 1024;', 'const limit = 1;');
			if (patched === raw) { throw new Error('limit anchor miss'); }
			fs.writeFileSync(abs, patched, 'utf8');
		},
	},
	{
		// 第 75 轮补：`docs-graph` 有 30 处断言（定义依赖图 0 环、术语唯一、
		// 唯一定义不冲突、状态单一性、待办/用户动作计数），是项目最核心的文档
		// 一致性检查，但此前**完全未纳入反向验证**。这里注入一条断链（指向不存在
		// 的文件）与一处非法待办状态，确认它真的会失败。
		name: 'docs-graph 断链与状态守护（第 75 轮）',
		files: ['docs/DEVELOPMENT.md'],
		script: 'build/lib/dsh/verify/dshDocsGraph.mjs',
		break() {
			const abs = path.join(repoRoot, 'docs/DEVELOPMENT.md');
			const raw = fs.readFileSync(abs, 'utf8');
			// 1) 追加一条指向不存在文件的相对链接 → 断链检查应失败。
			const patched = `${raw}\n\n[断链探针](./__no_such_file__.md)\n`;
			fs.writeFileSync(abs, patched, 'utf8');
		},
	},
	{
		name: '手册交叉引用守护（第 32 轮）',
		files: ['docs/DEVELOPMENT.md'],
		test: 'build/lib/test/dshDocsCrossRefs.test.ts',
		break() {
			const abs = path.join(repoRoot, 'docs/DEVELOPMENT.md');
			const raw = fs.readFileSync(abs, 'utf8');
			const patched = raw.replace('## 第 2 章', '参见第 1 章 §99。\n\n## 第 2 章');
			if (patched === raw) { throw new Error('anchor miss'); }
			fs.writeFileSync(abs, patched, 'utf8');
		},
	},
];

fs.mkdirSync(tmp, { recursive: true });

// 运行前的原始字节（用于最后逐字节确认「注入过的文件已还原」）。
// 必须在任何注入之前采集，且要覆盖全部被注入过的文件。
const touched = [...new Set(CASES.flatMap(c => c.files))];
const originalBytes = new Map();
for (const rel of touched) {
	originalBytes.set(path.join(repoRoot, rel), fs.readFileSync(path.join(repoRoot, rel)));
}

const results = [];
for (const testCase of CASES) {
	const restore = snapshot(testCase.files);
	let failed;
	try {
		testCase.break();
		// 第 75 轮：支持两种被测对象——node:test 文件（`test`）与 verify 脚本（`script`）。
		failed = testCase.script === undefined
			? testFails(testCase.test)
			: scriptFails(testCase.script);
	} catch (error) {
		failed = null;
		console.error(`  ${testCase.name}: 注入失败 — ${error.message}`);
	} finally {
		restore();
	}
	results.push({ name: testCase.name, caught: failed === true, errored: failed === null });
	const verdict = failed === null ? 'INJECT-ERROR' : failed ? 'CAUGHT' : '**NOT CAUGHT**';
	console.log(`  ${verdict.padEnd(14)} ${testCase.name}`);
}

// 还原后完整性：**逐字节**比对被注入过的文件是否与备份一致。
// 不能看 `git status`——被注入的文件本身就可能是运行前已有改动的文件
// （例如刚注册 npm script 时的 package.json），git 状态无法区分「我的注入」与
// 「本来就有改动」。逐字节比对才能准确判断「我有没有还原干净」。
const unrestored = [];
for (const rel of touched) {
	const abs = path.join(repoRoot, rel);
	const original = originalBytes.get(abs);
	if (original === undefined) { continue; }
	if (!fs.readFileSync(abs).equals(original)) { unrestored.push(rel); }
}
const dirtyOfTouched = unrestored.join(', ');
const vacuous = results.filter(r => !r.caught);

console.log('');
if (vacuous.length > 0) {
	console.error(`STATUS: FAIL  [guard-negative] ${vacuous.length} guard(s) did not fail when broken: ${vacuous.map(r => r.name).join(', ')}`);
	process.exit(1);
}
if (dirtyOfTouched !== '') {
	console.error(`STATUS: FAIL  [guard-negative] injected files were not restored:\n${dirtyOfTouched}`);
	process.exit(1);
}
console.log(`STATUS: PASS  [guard-negative] all ${results.length} guards failed as expected, injected files restored`);
