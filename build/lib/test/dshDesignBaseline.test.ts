/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// D46：Chat 容器设计基线「契约与文档先行」（§8.10.4 批次 A①）的回归守护。
//
// A① 五个子项在第 17–29 轮已逐项落地，本测试把它们钉成可执行凭据，防止
// 后续接线把设计基线写散：
//   ① 官方事件名只在 translator.ts 有一份映射，index.js 订阅官方 4 类事件；
//   ② deleteSession 语义（直接删除 / 不入回收站）在契约与 §2 §4 表一致；
//   ③ 第 2 章 §2–§6 表格齐全（快照 / DTO / method 白名单 / 校验契约 / 错误码）；
//   ④ 第 3 章 §6 状态表 P0–P7 依据列非空；
//   ⑤ 20→22 计数校正已生效，源码零「20 method」残留。
// 本测试只做静态核对，不声称 waterfall 已接线（D50 仍待 U10 / U12 探针）。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
const protocol = read('src/vs/platform/dshClient/common/dshIdeProtocol.ts');
const translator = read('src/vs/platform/dshClient/common/translator.ts');
const entry = read('src/vs/platform/dshClient/index.js');
const dev = read('docs/DEVELOPMENT.md');

test('D46 A① official event names have a single translator mapping', () => {
	// 官方线上事件名（斜杠）→ 中立 IdeEventType（点号）只此一份。
	assert.match(translator, /DSH_WIRE_EVENT_TYPES\s*:\s*Readonly<Record<string, IdeEventType>>/, 'translator must own the wire-event map');
	assert.equal((translator.match(/const DSH_WIRE_EVENT_TYPES/g) ?? []).length, 1, 'no second event-name map');
	for (const name of ['turn/start', 'user/message', 'assistant/message', 'tool/result']) {
		assert.ok(translator.includes(`'${name}'`), `wire event ${name} must be mapped`);
	}
	// 入口只订阅官方 4 类事件，不另造名字。
	for (const name of ['session/event', 'agent/assistant-stream', 'approval/request', 'user-questions/request']) {
		assert.ok(entry.includes(name), `entry must subscribe to ${name}`);
	}
});

test('D46 A① deleteSession semantics are consistent across contract and chapter-2', () => {
	// 契约真源：直接物理删除、不入回收站。
	assert.match(protocol, /删除会话（直接删除，不入回收站）|deleteSession/, 'protocol must declare deleteSession');
	assert.match(protocol, /deleteSession:\s*\{\s*sessionId: string\s*\}/, 'deleteSession args must stay { sessionId }');
	// §8.2.4 语义与 §2 §4 表一致。
	assert.match(dev, /直接物理删除、\s*不进入任何回收站/, '§8.2.4 must keep direct-physical-delete semantics');
	assert.match(dev, /\|\s*20\s*\|\s*`deleteSession`\s*\|/, '§2 §4 table must list deleteSession as method 20');
});

test('D46 A① chapter-2 §2–§6 tables are all present', () => {
	for (const heading of [
		'### 2. 通道快照与视图宿主',
		'### 3. 适配层的中立 DTO',
		'### 4. 方法白名单（24 个',
		'### 5. 校验契约',
		'### 6. 错误码',
	]) {
		assert.ok(dev.includes(heading), `chapter-2 section missing: ${heading}`);
	}
	// §3 中立 DTO 表的 51 项封闭联合口径。
	assert.match(dev, /`IdeEventType`\s*\|[^\n]*51[^\n]*个成员/, '§3 must keep the 51-member union note');
});

test('D46 A① state-table basis column is filled for all 8 phases', () => {
	const start = dev.indexOf('### 6. 当前进度（唯一状态表）');
	const end = dev.indexOf('「最后实测」是最后一次核对的日期与', start);
	assert.ok(start > 0 && end > start, 'state table must exist');
	const block = dev.slice(start, end);
	for (const phase of ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']) {
		const re = new RegExp(`\\|\\s*${phase}\\s*\\|[^|]+\\|([^|]+)\\|`);
		const m = re.exec(block);
		assert.ok(m !== null, `${phase} must have a basis column`);
		assert.ok(m[1].trim().length > 10, `${phase} basis column must not be empty`);
	}
});

test('D46 A① method-count correction has no stale "20 method" claim in source', () => {
	// 历史记录（§7.7 / P3 依据列）允许追述「当时 20」；源码与规格正文不得再写 20 method。
	for (const [name, text] of [['protocol', protocol], ['translator', translator], ['entry', entry]]) {
		assert.doesNotMatch(text, /20\s*(个)?\s*method|20\s*个方法|methods?\s*[:=]\s*20\b/i, `${name} must not claim 20 methods`);
	}
	// 白名单本身恰好 24 个 key（正则抽取 DSH_IDE_METHOD_KEYS 块；第 19 轮新增 2 个归档 method）。
	const block = /const DSH_IDE_METHOD_KEYS[\s\S]*?\n\};/.exec(protocol);
	assert.ok(block !== null, 'DSH_IDE_METHOD_KEYS must exist');
	const keys = [...block[0].matchAll(/^\s*([a-zA-Z]+):/gm)].map(m => m[1]);
	assert.equal(keys.length, 24, `expected 24 methods, got ${keys.length}`);
});
