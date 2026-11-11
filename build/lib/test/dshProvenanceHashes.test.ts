/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// D31/D32（第 29 轮）：`src/vs/platform/dshClient/PROVENANCE.md` 的逐文件 sha256 可复算校验。
//
// 背景：该文件是**法律/来源凭据**（AGENTS §5 保留且不得删改原文），但手册第 5 章 §7
// 要求上游升级时更新「版本 / commit / 逐文件 sha256」。第 29 轮发现「本仓库内的落地文件」
// 表里两个**仍存在**的文件记录已陈旧（`common/dshClientService.ts` 11606→9027 B、
// `common/env.js` 590→713 B），说明凭据会随实现演进悄悄失准。
//
// 本测试把该表的可复算部分钉死：
//   - 仍存在的落地文件：字节数与 sha256 必须与磁盘一致；
//   - 标注「⚠已删」的行：只校验格式，不要求文件存在（它们是删除前快照）；
//   - 上游对应文件表：只校验格式（上游源不在本仓库内，不能在此断言其内容）。
// 这样既不会让凭据再次悄悄陈旧，也不会越权改动来源/许可文本。

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const provenancePath = path.join(repoRoot, 'src/vs/platform/dshClient/PROVENANCE.md');
const provenance = fs.readFileSync(provenancePath, 'utf8');

/** 取出「本仓库内的落地文件」小节里的表格行。 */
function landedRows() {
	const start = provenance.indexOf('## 3. 本仓库内的落地文件');
	assert.ok(start > 0, 'PROVENANCE must contain section 3');
	const rest = provenance.slice(start);
	const end = rest.indexOf('\n## ', 4);
	const block = end < 0 ? rest : rest.slice(0, end);
	const rows = [];
	for (const line of block.split(/\r?\n/)) {
		const m = /^\|\s*`([^`]+)`([^|]*)\|\s*(\d+)\s*\|\s*`([0-9a-f]{64})`\s*\|\s*$/.exec(line);
		if (m === null) { continue; }
		rows.push({ file: m[1], note: m[2].trim(), bytes: Number(m[3]), sha: m[4] });
	}
	return rows;
}

test('D31 landed-file hashes in PROVENANCE match the files on disk', () => {
	const rows = landedRows();
	assert.ok(rows.length >= 2, `expected the landed-file table, got ${rows.length} rows`);

	const live = rows.filter(row => !row.note.includes('已删'));
	assert.ok(live.length >= 1, 'at least one landed file must still exist and be verified');

	for (const row of live) {
		const abs = path.join(repoRoot, 'src/vs/platform/dshClient', row.file);
		assert.ok(fs.existsSync(abs), `PROVENANCE lists ${row.file} without the "已删" marker, so it must exist`);
		const buffer = fs.readFileSync(abs);
		const sha = crypto.createHash('sha256').update(buffer).digest('hex');
		assert.equal(buffer.length, row.bytes, `${row.file} byte count must match PROVENANCE (${row.bytes})`);
		assert.equal(sha, row.sha, `${row.file} sha256 must match PROVENANCE; recompute and update the table when the file changes`);
	}
});

test('D32 deleted-file rows stay as pre-deletion snapshots and are marked as such', () => {
	const deleted = landedRows().filter(row => row.note.includes('已删'));
	assert.ok(deleted.length >= 1, 'the pre-deletion snapshot rows must be kept, not deleted');
	for (const row of deleted) {
		// 删除前快照只要求格式完整（字节 + 64 位 sha256），不要求文件存在。
		assert.ok(row.bytes > 0, `${row.file} snapshot must record a byte count`);
		assert.match(row.sha, /^[0-9a-f]{64}$/, `${row.file} snapshot must record a full sha256`);
		// 快照行不得悄悄指向一个仍然存在的文件（那说明标记与事实不符）。
		const abs = path.join(repoRoot, 'src/vs/platform/dshClient', row.file);
		assert.equal(fs.existsSync(abs), false, `${row.file} is marked 已删 but still exists on disk; fix the marker or the table`);
	}
});

test('D31 PROVENANCE records the validated upstream version and source commit', () => {
	// 版本与 sourceCommit 是上游核对的锚点，必须存在且格式正确（值本身由上游核对轮次负责）。
	const version = /\|\s*版本\s*\|\s*`([^`]+)`/.exec(provenance)?.[1];
	const commit = /`sourceCommit`\s*\|\s*`([0-9a-f]{40})`/.exec(provenance)?.[1];
	assert.ok(version !== undefined && version !== '', 'PROVENANCE must record the upstream version');
	assert.ok(commit !== undefined && commit !== '', 'PROVENANCE must record a full 40-hex sourceCommit');
});
