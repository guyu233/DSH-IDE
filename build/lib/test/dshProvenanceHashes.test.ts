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
import { execFileSync } from 'node:child_process';
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

// ---------------------------------------------------------------------------
// 第 30 轮：`build/dsh/chat-render/PROVENANCE.md` 的可复算校验。
// 该文件是第二份法律/许可凭据（AGENTS §5），其 20 个源文件哈希 + tree digest
// + LICENSE-DSH 哈希都应能从只读源与仓库内文件复算出来。
// ---------------------------------------------------------------------------

const chatRenderRoot = path.join(repoRoot, 'build/dsh/chat-render');
const upstreamRoot = 'E:/deepseek-harness-0.2.2-rc.1';
const chatRenderProvenance = fs.readFileSync(path.join(chatRenderRoot, 'PROVENANCE.md'), 'utf8');

/** 第 2 节「复制的源码文件」表：序号 / rel / sha256。 */
function copiedSourceRows() {
	const rows = [];
	for (const line of chatRenderProvenance.split(/\r?\n/)) {
		const m = /^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|\s*`([0-9a-f]{64})`\s*\|\s*$/.exec(line);
		if (m !== null) { rows.push({ index: Number(m[1]), rel: m[2], sha: m[3] }); }
	}
	return rows;
}

test('chat-render PROVENANCE lists 20 copied sources whose hashes match the read-only upstream', { skip: !fs.existsSync(upstreamRoot) }, () => {
	const rows = copiedSourceRows();
	assert.equal(rows.length, 20, `expected 20 copied source rows, got ${rows.length}`);
	// 序号连续 1..20，防止漏行或重编号。
	assert.deepEqual(rows.map(r => r.index), [...Array(20).keys()].map(i => i + 1), 'row indexes must be 1..20');

	const uiRoot = path.join(upstreamRoot, 'packages/client/ui-chat');
	for (const row of rows) {
		// 表格里的 rel 形如 `src/client/<path>`；上游按同样相对路径读取。
		const abs = path.join(uiRoot, row.rel);
		assert.ok(fs.existsSync(abs), `upstream source ${row.rel} must exist in the read-only tree`);
		const sha = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
		assert.equal(sha, row.sha, `${row.rel} sha256 must match the recorded upstream hash`);
	}
});

test('chat-render tree digest is recomputable from the recorded rows', () => {
	// 生成器（gen-provenance.mjs）的算法：每行 `<rel-without-src/client>\0<sha>`，
	// 用 `\n` 连接后取 sha256。这里用同一算法复算并比对文档记录值。
	const rows = [...chatRenderProvenance.matchAll(/^\|\s*\d+\s*\|\s*`src\/client\/([^`]+)`\s*\|\s*`([0-9a-f]{64})`\s*\|\s*$/gm)];
	assert.equal(rows.length, 20, 'the digest must cover exactly the 20 copied sources');
	const lines = rows.map(m => `${m[1]}\0${m[2]}`);
	const digest = crypto.createHash('sha256').update(Buffer.from(lines.join('\n'))).digest('hex');
	const recorded = /### 整组 tree digest[\s\S]*?```\s*\n([0-9a-f]{64})\s*\n```/.exec(chatRenderProvenance)?.[1];
	assert.ok(recorded !== undefined, 'PROVENANCE must record the tree digest');
	assert.equal(digest, recorded, 'the tree digest must equal the recomputed value');
});

test('chat-render LICENSE-DSH hash matches the recorded value', () => {
	const recorded = /sha256 `([0-9a-f]{64})`/.exec(chatRenderProvenance)?.[1];
	assert.ok(recorded !== undefined, 'PROVENANCE must record the LICENSE-DSH sha256');
	const license = fs.readFileSync(path.join(chatRenderRoot, 'LICENSE-DSH'));
	const digest = crypto.createHash('sha256').update(license).digest('hex');
	assert.equal(digest, recorded, 'LICENSE-DSH sha256 must match; the license text itself must not be edited');
	assert.match(license.toString('utf8'), /MIT License/, 'LICENSE-DSH must keep the MIT license text');
});

test('regenerating chat-render PROVENANCE is idempotent (no self-inflicted diff)', { skip: !fs.existsSync(upstreamRoot) }, () => {
	// 第 30 轮修复：生成器模板曾把 `` `docs/DEVELOPMENT.md` 第 1 章 `` 拼成
	// `` `docs/DEVELOPMENT.md 第 1 章` ``，导致每次重新生成都产生一行无关差异。
	const generator = fs.readFileSync(path.join(chatRenderRoot, 'gen-provenance.mjs'), 'utf8');
	assert.ok(generator.includes('\\`docs/DEVELOPMENT.md\\` 第 1 章资源复用章节'),
		'the generator template must keep the backticks around the document name only');
});

// ---------------------------------------------------------------------------
// 第 31 轮：法律/许可文件完整性（D31 原文核对的静态部分）。
//
// 关键纪律：`NOTICE.md` 里出现 `vscode-1.143.1/` 这类**扁平化前的历史路径**，
// 是手册第 7 章 §4 明确裁定「按 AGENTS §5 不得改写、以注记说明差异」的有意保留，
// **不是缺陷**。本测试同时钉住两件事，防止后来者两头做错：
//   ① 不得为了「修路径」去改 `NOTICE.md`；
//   ② 也不得删掉手册里那条说明差异的注记（否则历史表述失去解释）。
// ---------------------------------------------------------------------------

const legalFiles = ['NOTICE.md', 'LICENSE', 'LICENSE.txt', 'ThirdPartyNotices.txt', 'build/dsh/chat-render/LICENSE-DSH'];

test('D31 legal/license files exist and keep their upstream text', () => {
	for (const rel of legalFiles) {
		const abs = path.join(repoRoot, rel);
		assert.ok(fs.existsSync(abs), `${rel} must exist`);
		assert.ok(fs.statSync(abs).size > 0, `${rel} must not be empty`);
	}

	// LICENSE-DSH 必须是上游 LICENSE 的逐字副本（MIT，DeepSeek 版权）。
	const licenseDsh = fs.readFileSync(path.join(repoRoot, 'build/dsh/chat-render/LICENSE-DSH'));
	assert.match(licenseDsh.toString('utf8'), /MIT License/, 'LICENSE-DSH must keep the MIT text');
	const upstreamLicense = 'E:/deepseek-harness-0.2.2-rc.1/LICENSE';
	if (fs.existsSync(upstreamLicense)) {
		assert.ok(Buffer.compare(fs.readFileSync(upstreamLicense), licenseDsh) === 0,
			'LICENSE-DSH must stay byte-identical to the upstream LICENSE');
	}

	// LICENSE.txt 是 VS Code 上游 MIT 版权声明。
	const vscodeLicense = fs.readFileSync(path.join(repoRoot, 'LICENSE.txt'), 'utf8');
	assert.match(vscodeLicense, /MIT License/, 'LICENSE.txt must keep the MIT text');
	assert.match(vscodeLicense, /Copyright \(c\) 2015 - present Microsoft Corporation/,
		'LICENSE.txt must keep the Microsoft copyright line verbatim');

	// NOTICE.md 保留来源与商标声明（不得被删减）。
	const notice = fs.readFileSync(path.join(repoRoot, 'NOTICE.md'), 'utf8');
	for (const token of ['Visual Studio Code', 'DeepSeek Harness', 'Trademarks', 'MIT License', 'unofficial']) {
		assert.ok(notice.includes(token), `NOTICE.md must keep "${token}"`);
	}
});

test('NOTICE.md historical vscode-1.143.1/ paths are intentionally preserved, not a defect', () => {
	const notice = fs.readFileSync(path.join(repoRoot, 'NOTICE.md'), 'utf8');
	const dev = fs.readFileSync(path.join(repoRoot, 'docs/DEVELOPMENT.md'), 'utf8');

	// 历史路径仍在 NOTICE.md 里（有意保留，不得「顺手修掉」）。
	assert.ok(notice.includes('vscode-1.143.1/LICENSE.txt'),
		'NOTICE.md must keep the historical vscode-1.143.1/ path verbatim (AGENTS §5 forbids rewriting it)');
	// 该目录确实不存在（扁平化已删除）——所以那条注记必须存在来解释差异。
	assert.equal(fs.existsSync(path.join(repoRoot, 'vscode-1.143.1')), false,
		'the vscode-1.143.1/ directory must stay absent after flattening');
	assert.match(dev, /`NOTICE\.md` 为定稿时保留原文的法律文件[\s\S]{0,160}?扁平化前的历史表述/,
		'handbook must keep the note explaining the historical paths in NOTICE.md');
	assert.match(dev, /不得改写[\s\S]{0,40}?`NOTICE\.md`/,
		'handbook must keep the rule that NOTICE.md is not to be rewritten');
});

test('D31 no legal file is modified in the working tree', () => {
	// 与手册第 7 章 §4 的定稿核验命令同义：这些文件不得有未提交改动。
	const result = execFileSync('git', ['status', '--short', '--', '*LICENSE*', '*COPYING*', '*NOTICE*', '*ThirdPartyNotices*'], { cwd: repoRoot, encoding: 'utf8' });
	assert.equal(result.trim(), '', `legal files must stay untouched, got:\n${result}`);
});
