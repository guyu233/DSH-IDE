/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// D27（第 28 轮）：CI 聚合入口——把第 5 章 §2「唯一命令真源」里 CI 必须执行的
// 那组命令按固定顺序跑一遍，任一失败即退出非 0。
//
// 设计边界（重要）：
//   - 本脚本**不选 CI 平台**、不新建 `.github/` 或 `build/azure-pipelines/`。
//     平台选择属项目决定（§7.4 记录 `.github/` 已于 2026-11-09 删除），
//     因此这里只提供「无论接哪个平台都只需调用一次」的单一入口。
//   - 本脚本**不改写任何单条门禁的语义与退出码**：它只顺序调用既有 npm scripts，
//     透传各自输出，并聚合退出码。门禁状态语义仍见第 5 章 §9。
//   - `contract` 当前为 `PENDING`（退出 0）。按 §9 语义 `PENDING` 不计通过，
//     因此本脚本对 `PENDING` **不视为通过**：它把「非 PASS」记为未通过并以退出 1
//     结束，与 §9.4 发布聚合口径一致（`release-gate` 已单独实现该聚合，这里
//     只是把同一判断放进 CI 入口，不新增语义）。
//
// 用法：`npm run verify:dsh-ide-ci`

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();

// ---------------------------------------------------------------------------
// 第 60 轮：前置构建检查（干净 CI 环境的真实缺口）。
//
// `test-dsh` 从 `out/` 加载测试与模块（`package.json` 的 mocha glob 指向
// `out/vs/...`，`dshIdeChannel.test.ts` 也 import `out/` 下的产物）。在干净
// checkout 上直接跑本聚合会以「找不到 out/...」失败，而**失败点在下游**，
// 报错信息不会告诉使用者「要先构建」。
//
// 因此在跑门禁前先确认 `out/` 存在；缺失则以**可操作的提示**退出，而不是让
// 下游抛出难以定位的模块缺失错误。同理确认 `node_modules/` 存在（CI 需先
// `npm ci`）。
// ---------------------------------------------------------------------------
const PREREQUISITES = Object.freeze([
	{ dir: 'node_modules', hint: 'npm ci' },
	{ dir: 'out', hint: 'npm run build-dsh-tests' },
]);

const missingPrerequisites = PREREQUISITES.filter(p => !fs.existsSync(path.join(repoRoot, p.dir)));
if (missingPrerequisites.length > 0) {
	console.error('STATUS: FAIL  [dsh-ide-ci] 前置条件缺失，未开始跑门禁：');
	for (const p of missingPrerequisites) {
		console.error(`  ✗ 缺少 ${p.dir}/ —— 先执行: ${p.hint}`);
	}
	console.error('  说明：`test-dsh` 从 `out/` 加载测试与模块，干净 checkout 必须先构建。');
	process.exit(1);
}

/** CI 必须执行的命令序列（顺序固定，取自第 5 章 §2）。 */
const STEPS = Object.freeze([
	{ name: 'protocol-single-source', script: 'verify:dsh-ide-protocol-single-source' },
	{ name: 'boundary', script: 'verify:dsh-ide-boundary' },
	{ name: 'projection-golden', script: 'verify:dsh-ide-projection-golden' },
	{ name: 'contract', script: 'verify:dsh-ide-contract' },
	{ name: 'test-dsh:all', script: 'test-dsh:all' },
	{ name: 'docs-graph', script: 'verify:docs-graph' },
]);

/**
 * 跑一条 npm script，返回退出码与输出。
 * @param {string} script - package.json 里的 script 名。
 * @returns {{ code: number; out: string }}
 */
function run(script) {
	try {
		const out = execFileSync('npm', ['run', '--silent', script], {
			cwd: repoRoot,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			shell: process.platform === 'win32',
		});
		return { code: 0, out };
	} catch (error) {
		const out = `${error && error.stdout ? error.stdout : ''}${error && error.stderr ? error.stderr : ''}`;
		const code = typeof error?.status === 'number' ? error.status : 1;
		return { code, out };
	}
}

const failures = [];
const results = [];

for (const step of STEPS) {
	const { code, out } = run(step.script);
	// 门禁类步骤的输出里有 `STATUS: <PASS|PENDING|FAIL>`；测试类步骤看退出码。
	const status = /^STATUS:\s*(\S+)/m.exec(out)?.[1];
	const passed = code === 0 && (status === undefined || status === 'PASS');
	results.push({ name: step.name, code, status, passed });
	if (!passed) {
		failures.push({ name: step.name, code, status });
	}
	// 透传原始输出，便于 CI 日志定位（不裁剪、不美化）。
	if (out !== '') {
		process.stdout.write(out.endsWith('\n') ? out : `${out}\n`);
	}
}

console.log('\n=== DSH-IDE CI aggregate ===');
for (const result of results) {
	console.log(`  ${result.passed ? 'PASS' : 'NOT-PASS'}  ${result.name}${result.status === undefined ? ` (exit ${result.code})` : ` (STATUS: ${result.status}, exit ${result.code})`}`);
}

if (failures.length > 0) {
	// 按第 5 章 §9：PENDING 不计通过；这里如实以退出 1 结束，不写「门禁全过」。
	console.error(`\nSTATUS: FAIL  [dsh-ide-ci] ${failures.length} step(s) did not pass: ${failures.map(f => f.name).join(', ')}`);
	process.exit(1);
}

console.log('\nSTATUS: PASS  [dsh-ide-ci] all steps passed');
