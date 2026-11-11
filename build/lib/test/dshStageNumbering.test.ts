/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// D28：旧阶段编号残留的回归守护（AGENTS.md §1.2、开发手册第 7 章 §7.1）。
//
// 全仓只承认 P0–P7 / K1–K8 / T1–T9。旧文档里的 `2.1` / `2.2a` / `2.2b` /
// `2.5` / `S0` / `阶段 N` / `第 N 批` 编号已废止，仅允许在：
//   - PROVENANCE.md / LICENSE / NOTICE.md（法律与来源凭据，AGENTS §5 不得删改，
//     其「阶段3第三批」是删除前快照的历史事实）；
//   - 开发手册 §7.1 / §7.3 / §3 第 5 章的登记表（记录历史，不是代码）；
//   - 其它文件里作为章节号引用（如「第 2 章 §2.1」）或普通数值（如 2.5 秒）。
// 本测试只扫 DSH-IDE 代码/脚本/测试文件里**注释与字符串字面量中的旧阶段标记**，
// 防止后续提交把旧路线编号重新写回源码。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

/** 只扫 DSH-IDE 自有作用域（不含上游 VS Code 源码、node_modules、out、dist）。 */
const roots = [
	'build/lib/dsh/verify/dshIdeVerify.mjs',
	'build/lib/test/dshBundleStaging.test.ts',
	'build/lib/test/dshIdeProtocol.test.ts',
	'build/lib/test/dshIdeProjection.test.ts',
	'build/gulpfile.vscode.ts',
	'src/vs/platform/dshClient',
	'src/vs/workbench/contrib/dsh',
];

/** 真正被废止的阶段编号写法（不含章节号 §N.N 与合法 P/K/T 编号）。 */
const FORBIDDEN = [
	/阶段\s*[0-9]/,                 // 阶段 2.1 / 阶段3第三批（PROVENANCE 除外）
	/\b2\.2a\b|\b2\.2b\b/,         // 旧 Spike / 子阶段
	/2\.1-2\.5/,                   // 旧区间
	/PENDING\([0-9]/,              // PENDING(2.5)（现为 PENDING(P6)）
	/\bS0\b/,                      // 旧阶段 S0
	/\bphase\s*2\b/i,              // phase 2.x pending
	/第[一二三四五六七八九]批/,     // 第三批
];

const files = [];
const walk = p => {
	const abs = path.join(repoRoot, p);
	let st;
	try { st = fs.statSync(abs); } catch { return; }
	if (st.isFile()) {
		if (/\.(ts|js|mjs|css)$/.test(abs)) { files.push(abs); }
		return;
	}
	if (st.isDirectory()) {
		for (const n of fs.readdirSync(abs)) {
			if (n === 'node_modules' || n === 'out' || n === 'dist' || n === '.build') { continue; }
			// PROVENANCE.md / LICENSE / NOTICE.md 是法律凭据，按 AGENTS §5 不扫、不改。
			if (/^(PROVENANCE\.md|LICENSE|NOTICE\.md)$/.test(n)) { continue; }
			walk(path.join(p, n));
		}
	}
};
for (const r of roots) { walk(r); }

test('D28 old stage numbers are absent from DSH-IDE source comments and strings', () => {
	assert.ok(files.length >= 20, `expected a meaningful source scan, got ${files.length} files`);
	const hits = [];
	for (const file of files) {
		const lines = fs.readFileSync(file, 'utf8').split('\n');
		lines.forEach((line, i) => {
			for (const re of FORBIDDEN) {
				if (re.test(line)) {
					hits.push(`${path.relative(repoRoot, file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
					break;
				}
			}
		});
	}
	assert.deepEqual(hits, [], `old stage numbering must use P0–P7 / K1–K8 / T1–T9:\n${hits.join('\n')}`);
});

test('D28 verify script uses P-numbered PENDING markers only', () => {
	const verify = fs.readFileSync(path.join(repoRoot, 'build/lib/dsh/verify/dshIdeVerify.mjs'), 'utf8');
	// 允许 PENDING(P6) / PENDING(上游升级)；不允许 PENDING(2.5) 等旧编号。
	assert.doesNotMatch(verify, /PENDING\([0-9]/, 'PENDING must carry a P-numbered or descriptive reason');
	assert.match(verify, /PENDING\(P6\)/, 'projection-golden must keep its P6 calibration note');
});

test('D28 legal PROVENANCE retains its historical deletion snapshot (must not be rewritten)', () => {
	// AGENTS §5：PROVENANCE 保留且不得删改；这里反向钉住它仍含历史快照，
	// 防止有人借「清理旧编号」之名改写法律凭据。
	const provenance = fs.readFileSync(path.join(repoRoot, 'src/vs/platform/dshClient/PROVENANCE.md'), 'utf8');
	assert.match(provenance, /删除前/, 'PROVENANCE must keep its pre-deletion snapshot');
	assert.match(provenance, /sha256/, 'PROVENANCE must keep its per-file digests');
});
