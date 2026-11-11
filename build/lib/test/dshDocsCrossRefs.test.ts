/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 第 32 轮：`docs/DEVELOPMENT.md` 内部交叉引用不得指向不存在的章节/小节。
//
// 背景：手册以「第 N 章 §M[.K]」的形式互相引用，共 361 处。第 32 轮审计发现
// 6 处指向**不存在的锚点**（多为历史小节被合并后遗留，如 `第 7 章 §3.1`
// 原为第 3 章内一段加粗标题，早已按澄清删除），全部改为指向真实裁定位置。
//
// 本测试把「引用必须可解析」变成可执行判据，防止后续编辑再次留下悬空引用。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const handbook = fs.readFileSync(path.join(repoRoot, 'docs/DEVELOPMENT.md'), 'utf8');

/**
 * 建立「章号 → 该章内出现的全部小节号」索引。
 * 小节号同时登记 `M`、`M.K`、`M.K.L` 三种粒度，因为正文会按任意粒度引用。
 * @returns {Map<string, Set<string>>}
 */
function sectionIndex() {
	/** @type {Map<string, Set<string>>} */
	const index = new Map();
	/** @type {string | null} */
	let current = null;
	for (const line of handbook.split(/\r?\n/)) {
		const chapter = /^##\s*第\s*(\d+)\s*章/.exec(line);
		if (chapter !== null) {
			current = chapter[1];
			if (!index.has(current)) { index.set(current, new Set()); }
			continue;
		}
		// 其它二级标题（含章前的总述）结束当前章范围。
		if (/^##\s/.test(line)) { current = null; continue; }
		if (current === null) { continue; }
		const heading = /^#{3,5}\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?[.\s]/.exec(line);
		if (heading === null) { continue; }
		const set = index.get(current);
		set.add(heading[1]);
		if (heading[2] !== undefined) {
			set.add(`${heading[1]}.${heading[2]}`);
			if (heading[3] !== undefined) { set.add(`${heading[1]}.${heading[2]}.${heading[3]}`); }
		}
	}
	return index;
}

test('every "第 N 章 §M" cross reference resolves to a real heading', () => {
	const index = sectionIndex();
	assert.ok(index.size >= 8, `expected all chapters to be indexed, got ${index.size}`);

	const refs = [...handbook.matchAll(/第\s*(\d+)\s*章\s*§\s*([0-9]+(?:\.[0-9]+)*)/g)];
	assert.ok(refs.length >= 300, `expected the handbook's cross references, got ${refs.length}`);

	const unresolved = [];
	for (const ref of refs) {
		const sections = index.get(ref[1]);
		if (sections === undefined || !sections.has(ref[2])) {
			unresolved.push(`第 ${ref[1]} 章 §${ref[2]}`);
		}
	}
	assert.deepEqual([...new Set(unresolved)], [],
		'cross references must not point at removed/renamed sections; retarget them at the real ruling');
});

test('the retargeted references point at the single-channel invariant (I2)', () => {
	// 第 32 轮把 4 处「第 7 章 §3.1」（历史小节，已删除）改指第 1 章 §1 的 I2；
	// 这些句子描述的都是「跨进程只有官方传输一条链路」，I2 是它的真身。
	const retargeted = handbook.match(/第 1 章 §1 的 I2/g) ?? [];
	assert.ok(retargeted.length >= 4, `expected the retargeted I2 references, got ${retargeted.length}`);
	// I2 的定义确实在第一章第一节。
	const chapter1 = handbook.slice(handbook.indexOf('## 第 1 章'), handbook.indexOf('## 第 2 章'));
	assert.match(chapter1, /### 1\. 四条不变量/, 'chapter 1 §1 must still be the invariants section');
	assert.match(chapter1, /\|\s*I2\s*\|\s*唯一通道/, 'I2 must stay the single-channel invariant');
});

// ---------------------------------------------------------------------------
// 第 33 轮：第 5 章 §2「唯一命令真源」必须覆盖所有 verify / test 脚本。
//
// 发现：该表标称「唯一命令真源」，却漏登 `verify:docs-graph`——而 AGENTS §6
// 要求每次文档变更都跑它。补齐后本测试钉住「表里不能漏任何 verify/test 脚本」。
// ---------------------------------------------------------------------------

const repoPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };

test('chapter-5 §2 command table covers every verify/test script in package.json', () => {
	const lines = handbook.split(/\r?\n/);
	const start = lines.findIndex(line => line.startsWith('### 2. 命令清单'));
	assert.ok(start > 0, 'chapter 5 §2 command table must exist');
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (/^#### 2\.1/.test(lines[i])) { end = i; break; }
	}
	const table = lines.slice(start, end).join('\n');
	const documented = new Set([...table.matchAll(/npm run ([a-zA-Z0-9:_-]+)/g)].map(m => m[1]));

	// 所有 CI 相关脚本（verify:* / test-dsh*）都必须在「唯一命令真源」里出现。
	const required = Object.keys(repoPkg.scripts).filter(name => /^(verify:|test-dsh)/.test(name));
	assert.ok(required.length >= 8, `expected the CI script family, got ${required.length}`);
	const missing = required.filter(name => !documented.has(name));
	assert.deepEqual(missing, [], `every verify/test script must be documented in §2, missing: ${missing.join(', ')}`);
});

test('the handbook registers verify:docs-graph where AGENTS §6 requires it', () => {
	// AGENTS §6：任何文档变更后必须跑引用图脚本。表中登记 + 正文引用两处都要在。
	assert.match(handbook, /npm run verify:docs-graph/, 'the command must be registered in the handbook');
	assert.match(handbook, /文档引用图（§10\.1）/, 'the table row must name the reference-graph purpose');
});
