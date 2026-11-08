/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 阶段 2.2a 验收单测：golden 回放一致、dshEmits() 分类、私有 payload 不透传、
// 重复 seq 幂等、row 稳定 id 与行级 revision、有界 600 行折叠 preview、P95 字节数度量脚手架。
// 运行：node --experimental-strip-types --test build/lib/test/dshIdeProjection.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dshEmits, translateAll, translateDshEvent, wireEventType } from '../../../src/vs/platform/dshClient/common/translator.ts';
import {
	MAX_ROWS,
	ROWS_P95_BYTE_LIMIT,
	createIdeViewProjector,
	projectIdeView,
} from '../../../src/vs/platform/dshClient/common/ide-view-projector.ts';

interface GoldenFixture {
	readonly events: readonly unknown[];
	readonly expected: { readonly rows: readonly unknown[]; readonly version: number };
}

const golden = JSON.parse(readFileSync(new URL('../dsh/verify/golden/basic-session.json', import.meta.url), 'utf8')) as GoldenFixture;

// ---------------------------------------------------------------------------
// golden 回放
// ---------------------------------------------------------------------------

test('golden replay: projectIdeView(translateAll(events)) matches frozen snapshot', () => {
	const snapshot = projectIdeView(translateAll(golden.events));
	assert.deepEqual(snapshot, golden.expected);
});

test('golden replay is deterministic across two independent projections', () => {
	const a = projectIdeView(translateAll(golden.events));
	const b = projectIdeView(translateAll(golden.events));
	assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// translator 边界（穷举分类 / 私有 payload / 结构窄化）
// ---------------------------------------------------------------------------

test('dshEmits classifies translated vs owned-elsewhere events', () => {
	assert.equal(dshEmits('user.message'), true);
	assert.equal(dshEmits('assistant.delta'), true);
	assert.equal(dshEmits('tool.call'), true);
	assert.equal(dshEmits('notice'), false);
	assert.equal(dshEmits('permission.request'), false);
	assert.equal(dshEmits('question.settled'), false);
});

test('translateDshEvent drops DSH private payload and non-emitted events', () => {
	const translated = translateDshEvent({ type: 'user.message', seq: 42, text: 'hi', attachments: ['secret'], dshPrivateToken: 'x' }, 0);
	assert.deepEqual(translated, { type: 'user.message', seq: 42, text: 'hi', kind: 'user' });
	assert.equal(translateDshEvent({ type: 'notice', seq: 43, text: 'x' }, 0), undefined);
	assert.equal(translateDshEvent({ type: '__unknown.dsh.event', seq: 44 }, 0), undefined);
	assert.equal(translateDshEvent(null, 0), undefined);
	assert.equal(translateDshEvent('not-an-object', 0), undefined);
});

// ---------------------------------------------------------------------------
// 真实 DSH 线上事件（斜杠命名 + data 信封）
//
// 依据 E:/deepseek-harness-0.2.2-rc.1/packages/core/session/src/types.ts:SessionEventMap：
// 线上事件是 { type: 'user/message', seq, time, data: {...} }，与 dsh-TUI 抽象出的点号名字不是同一套。
// 本组用例守护「真实事件能被翻译」，避免只有 mock golden 通过而真机流全丢。
// ---------------------------------------------------------------------------

test('wireEventType maps every DSH slash-named session event to a neutral type', () => {
	assert.equal(wireEventType('user/message'), 'user.message');
	assert.equal(wireEventType('assistant/message'), 'assistant.message');
	assert.equal(wireEventType('tool/call'), 'tool.call');
	assert.equal(wireEventType('tool/result'), 'tool.result');
	assert.equal(wireEventType('system/message'), 'system.prompt');
	assert.equal(wireEventType('request/header'), 'request.header');
	assert.equal(wireEventType('turn/start'), 'turn.start');
	assert.equal(wireEventType('__unknown/x'), undefined);
});

test('translates a real DSH user/message (content blocks under data)', () => {
	const translated = translateDshEvent({
		type: 'user/message', seq: 7, time: 1_700_000_000_000,
		data: { id: 'm1', content: [{ type: 'text', text: 'list files' }], source: { kind: 'user' } },
	}, 0);
	assert.deepEqual(translated, { type: 'user.message', seq: 7, text: 'list files', kind: 'user' });
});

test('translates a real DSH assistant/message (nested message.content)', () => {
	const translated = translateDshEvent({
		type: 'assistant/message', seq: 9, time: 1,
		data: { turn: 1, step: 2, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'done' }] }, usage: {} },
	}, 0);
	assert.deepEqual(translated, { type: 'assistant.message', seq: 9, turn: 1, step: 2, text: 'done', kind: 'assistant' });
});

test('translates a real DSH tool/call and tool/result by callId', () => {
	const call = translateDshEvent({
		type: 'tool/call', seq: 11, time: 1,
		data: { turn: 1, step: 2, callId: 'c1', name: 'terminal', arguments: '{"command":"ls"}' },
	}, 0);
	assert.deepEqual(call, { type: 'tool.call', seq: 11, callId: 'c1', turn: 1, step: 2, text: 'terminal', title: 'terminal', kind: 'tool' });

	const result = translateDshEvent({
		type: 'tool/result', seq: 12, time: 1,
		data: { turn: 1, step: 2, message: { role: 'tool', source: { kind: 'tool', callId: 'c1' }, toolCallId: 'c1', content: [{ type: 'text', text: 'a.txt' }] } },
	}, 0);
	assert.deepEqual(result, { type: 'tool.result', seq: 12, callId: 'c1', turn: 1, step: 2, text: 'a.txt', kind: 'tool' });
});

test('translates a real DSH system/message into system.prompt', () => {
	const translated = translateDshEvent({
		type: 'system/message', seq: 1, time: 1,
		data: { message: { id: 's1', role: 'system', content: [{ type: 'text', text: 'You are helpful.' }], source: { kind: 'system-prompt' } } },
	}, 0);
	assert.deepEqual(translated, { type: 'system.prompt', seq: 1, text: 'You are helpful.', kind: 'system' });
});

test('real DSH event stream projects into transcript rows end-to-end', () => {
	const rows = projectIdeView(translateAll([
		{ type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: 'ls?' }], source: { kind: 'user' } } },
		{ type: 'assistant/message', seq: 2, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'sure' }] } } },
		{ type: 'tool/call', seq: 3, data: { turn: 1, step: 1, callId: 'c1', name: 'terminal', arguments: '{}' } },
		{ type: 'tool/result', seq: 4, data: { turn: 1, step: 1, message: { source: { callId: 'c1' }, content: [{ type: 'text', text: 'a.txt' }] } } },
	])).rows;
	assert.deepEqual(rows.map(row => row.kind), ['user', 'assistant', 'tool']);
	assert.equal(rows[2].id, 'call:c1');
	assert.equal(rows[2].text, 'a.txt');
});

test('unknown wire types are dropped, never fabricated', () => {
	assert.equal(translateDshEvent({ type: 'plugin/something', seq: 1 }, 0), undefined);
	assert.equal(translateDshEvent({ type: 'user/message', seq: 1, data: {} }, 0)?.text, undefined);
});

test('translateAll assigns fallbackSeq for missing seq', () => {
	const events = translateAll([{ type: 'user.message', text: 'a' }, { type: 'custom', text: 'b' }]);
	assert.deepEqual(events.map(e => e.seq), [0, 1]);
});

// ---------------------------------------------------------------------------
// 连续投影：稳定 id、行级 revision、seq 幂等
// ---------------------------------------------------------------------------

test('row ids are stable between two projections and revision only advances on changed rows', () => {
	const projector = createIdeViewProjector();
	const events = translateAll(golden.events);
	for (const event of events) {
		projector.apply(event);
	}
	const first = projector.snapshot();
	const ids = first.rows.map(r => r.id);

	// 追加一条不影响既有行的事件：已有行 id 与 revision 都不变。
	projector.apply({ type: 'custom', seq: 100, text: 'later' });
	const second = projector.snapshot();
	const stillThere = second.rows.filter(r => ids.includes(r.id));
	assert.deepEqual(stillThere.map(r => r.id), ids);
	assert.deepEqual(stillThere.map(r => r.revision), first.rows.map(r => r.revision));
	assert.equal(second.rows.at(-1)?.id, 'row:100');
});

test('duplicate seq is idempotent (no row duplication, no revision bump)', () => {
	const projector = createIdeViewProjector();
	const events = translateAll(golden.events);
	for (const event of events) {
		projector.apply(event);
	}
	const before = projector.snapshot();
	for (const event of events) {
		projector.apply(event);
	}
	assert.deepEqual(projector.snapshot(), before);
});

test('assistant deltas merge by callId into one row with incremental revision', () => {
	const projector = createIdeViewProjector();
	for (const event of translateAll([
		{ type: 'assistant.delta', seq: 1, callId: 'a1', text: 'A' },
		{ type: 'assistant.delta', seq: 2, callId: 'a1', text: 'B' },
		{ type: 'assistant.delta', seq: 3, callId: 'a1', text: 'C' },
	])) {
		projector.apply(event);
	}
	const rows = projector.snapshot().rows;
	assert.equal(rows.length, 1);
	assert.equal(rows[0].text, 'ABC');
	assert.equal(rows[0].revision, 3);
});

// ---------------------------------------------------------------------------
// 有界窗口 / 折叠 preview / 回 Host 取全文
// ---------------------------------------------------------------------------

test('bounded window folds rows beyond MAX_ROWS while keeping stable ids and preview', async () => {
	assert.equal(MAX_ROWS, 600);
	const raw = Array.from({ length: MAX_ROWS + 50 }, (_, i) => ({
		type: 'user.message', seq: i + 1, text: `message-${i + 1}-${'x'.repeat(300)}`,
	}));
	const snapshot = projectIdeView(translateAll(raw));
	assert.equal(snapshot.rows.length, MAX_ROWS + 50);
	const folded = snapshot.rows.filter(r => r.folded);
	assert.equal(folded.length, 50);
	for (const row of folded) {
		assert.match(row.id, /^row:\d+$/);
		assert.ok(row.preview, 'folded row must keep preview');
		assert.ok(row.preview!.endsWith('…'), 'long text preview must be clipped');
		assert.equal(row.text, undefined, 'folded row must drop full text');
	}

	// 折叠行全文可经 fetchRowDetail 回取；deps 为 2.3 真实 IdeViewHost 预留的窄接口。
	const projector = createIdeViewProjector({
		fetchRowDetail: async (rowId) => `host:${rowId}`,
	});
	for (const event of translateAll(raw)) {
		projector.apply(event);
	}
	assert.equal(await projector.fetchRowDetail(folded[0].id), raw[0].text);
	assert.equal(await projector.fetchRowDetail('missing'), 'host:missing');
});

// ---------------------------------------------------------------------------
// P95 参数校准脚手架（mock 样本；真实样本到位后替换并更新 golden）
// ---------------------------------------------------------------------------

test('P95 rows byte-size calibration scaffold: mock sample is under the 512 KiB threshold', () => {
	const rows = projectIdeView(translateAll(golden.events)).rows;
	const bytes = Buffer.byteLength(JSON.stringify(rows), 'utf8');
	assert.ok(bytes < ROWS_P95_BYTE_LIMIT, `mock rows ${bytes} bytes must stay under ${ROWS_P95_BYTE_LIMIT}`);
	// 标注：真实事件流 P95 实测超阈值时按 verification.md §3.2 有序序列校准
	// （① 下调 MAX_ROWS → ② 收紧 preview → ③ 更新 golden），属参数校准而非架构回退。
	assert.equal(ROWS_P95_BYTE_LIMIT, 512 * 1024);
});

// ---------------------------------------------------------------------------
// 架构边界：插件侧零 DSH 运行时包
// ---------------------------------------------------------------------------

test('projector/translator sources carry no @deepseek-ai or electron imports', () => {
	const translator = readFileSync(new URL('../../../src/vs/platform/dshClient/common/translator.ts', import.meta.url), 'utf8');
	const projector = readFileSync(new URL('../../../src/vs/platform/dshClient/common/ide-view-projector.ts', import.meta.url), 'utf8');
	for (const source of [translator, projector]) {
		assert.doesNotMatch(source, /from\s+['"]@deepseek-ai\//);
		assert.doesNotMatch(source, /from\s+['"]electron['"]/);
	}
	// projector 只以 import type 引入 translator，运行时零跨模块解析。
	assert.match(projector, /import type \{ IdeEvent, IdeRowKind \} from '\.\/translator\.js'/);
	assert.doesNotMatch(projector, /^import \{[^}]*\} from '\.\/translator\.js'/m);
});
