/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 第 41 轮：`NOTICE.md` 的**追加触发条件**必须可执行。
//
// 规则（README §1 + AGENTS §5）：
//   - `NOTICE.md` 不得重写、不得删改原文；
//   - **仅当**新增第三方依赖或素材时，才允许在末尾**追加**条目，原文一字不动；
//   - 定稿时未新增任何依赖或素材，故 `NOTICE.md` 保持原文（三段：Upstream components /
//     Trademarks / License）。
//
// 第 31 轮的守护只保证「法律文件零改动」，但**没有守护触发条件**——若将来真新增了
// 第三方依赖却忘记追加 NOTICE，那种「该改而未改」不会被发现。本测试补上这一环：
//   ① 现有三段必须完整保留（不得删减/重写）；
//   ② 若 `package.json` 的依赖集合相对定稿基线**新增**了条目，则 `NOTICE.md` 必须
//      出现「追加」段落（第四个 `##` 小节）——否则失败并提示该补什么。
//
// 基线取「定稿时的依赖集合」：这里不硬编码 238 个包名（无法维护），而是取
// `NOTICE.md` 的最后一次提交作为定稿点，比较该提交与当前 HEAD 的依赖差异。

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const noticePath = path.join(repoRoot, 'NOTICE.md');
const pkgPath = path.join(repoRoot, 'package.json');

const notice = fs.readFileSync(noticePath, 'utf8');

/** 读出 `## ` 级小节标题。 */
function sections(text) {
	return [...text.matchAll(/^##\s+(.+)$/gm)].map(m => m[1].trim());
}

/** `git` 辅助：返回某文件最后一次改动的提交（无则 HEAD）。 */
function lastCommitOf(file) {
	try {
		return execFileSync('git', ['log', '-1', '--format=%H', '--', file], { cwd: repoRoot, encoding: 'utf8' }).trim();
	} catch {
		return '';
	}
}

/** 从一份 package.json 文本里取出全部依赖名。 */
function dependencyNamesOf(text) {
	const pkg = JSON.parse(text) as Record<string, Record<string, string> | undefined>;
	const names = new Set();
	for (const key of ['dependencies', 'devDependencies', 'optionalDependencies']) {
		for (const name of Object.keys(pkg[key] ?? {})) { names.add(name); }
	}
	return names;
}

/** 读出指定 revision 里 package.json 的依赖名。 */
function dependencyNamesAt(revision) {
	const spec = revision === '' ? 'HEAD:package.json' : `${revision}:package.json`;
	return dependencyNamesOf(execFileSync('git', ['show', spec], { cwd: repoRoot, encoding: 'utf8' }));
}

/**
 * 读出**当前工作区**的 package.json 依赖名。
 *
 * 必须读工作区文件而不是 `HEAD:package.json`：新增依赖往往先在未提交状态下出现，
 * 若只比对 HEAD，未提交的新增依赖会被漏掉（第 41 轮反向测试发现并修正了这个盲区）。
 */
function dependencyNamesNow() {
	return dependencyNamesOf(fs.readFileSync(pkgPath, 'utf8'));
}

test('NOTICE keeps its three original sections verbatim', () => {
	const titles = sections(notice);
	for (const required of ['Upstream components', 'Trademarks', 'License']) {
		assert.ok(titles.includes(required), `NOTICE.md must keep the "${required}" section`);
	}
	// 原文声明不得删改：保留 VS Code 与 DSH 两处上游、商标与 MIT 许可范围。
	for (const token of ['Visual Studio Code', 'DeepSeek Harness', 'trademarks', 'MIT License']) {
		assert.ok(notice.includes(token), `NOTICE.md must keep "${token}"`);
	}
});

test('NOTICE is appended to whenever new third-party dependencies appear', () => {
	const baseline = lastCommitOf('NOTICE.md');
	assert.ok(baseline !== '', 'NOTICE.md must be tracked by git');

	const then = dependencyNamesAt(baseline);
	const now = dependencyNamesNow();
	const added = [...now].filter(name => !then.has(name)).sort();

	const titles = sections(notice);
	// 定稿三段之外的任何 `##` 小节都视为「追加段」。
	const appended = titles.filter(t => !['Upstream components', 'Trademarks', 'License'].includes(t));

	if (added.length === 0) {
		assert.deepEqual(appended, [],
			'no new dependencies were added, so NOTICE.md must still be the original text without appended sections');
		return;
	}

	// 有新增依赖 → 必须已经追加声明（至少多出一个 `##` 小节）。
	assert.ok(appended.length > 0,
		`${added.length} new dependency/dependencies appeared since NOTICE.md was last updated (${added.slice(0, 5).join(', ')}${added.length > 5 ? ', …' : ''}); append the required third-party notice instead of leaving NOTICE.md stale`);
});
