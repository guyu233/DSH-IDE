/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH 聊天帧解码：follow 帧 → DSH 聊天条目（user / markdown），不做另一套行。
// 运行：node --experimental-strip-types --test build/lib/test/dshChatModel.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DshChatModel } from '../../../out/vs/workbench/contrib/dsh/browser/dshChatModel.js';

function snapshot(records: unknown[], assistantStream?: unknown): Record<string, unknown> {
	return {
		type: 'snapshot',
		header: { version: 1, id: 's-1', createdAt: 0, isSeeded: false },
		cursor: records.length,
		records,
		hasMore: false,
		projections: { asOfSeq: -1, values: {} },
		...(assistantStream === undefined ? {} : { assistantStream }),
	};
}

function entry(seq: number, event: Record<string, unknown>): unknown {
	return { type: 'event', event: { seq, time: seq, ...event } };
}

test('a snapshot opening turns user and assistant messages into DSH parts', () => {
	const model = new DshChatModel();
	const patches = model.accept(snapshot([
		entry(1, { type: 'user/message', data: { content: [{ type: 'text', text: 'hi' }] } }),
		entry(2, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'hello' }] } } }),
	]));
	assert.equal(patches.length, 2);
	assert.deepEqual(model.list.map(item => item.part.kind), ['user', 'markdown']);
	assert.deepEqual(model.list[0].part, { kind: 'user', content: { text: 'hi' } });
	assert.equal((model.list[1].part as { blocks: readonly { text: string }[] }).blocks[0].text, 'hello');
});

test('streaming chunks accumulate into one markdown entry until the message settles', () => {
	const model = new DshChatModel();
	model.accept(snapshot([]));
	model.accept({ type: 'assistant-stream', frame: { type: 'start', attemptId: 'a1', revision: 1, turn: 3, step: 1 } });
	model.accept({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a1', revision: 2, index: 0, time: 1, chunk: { type: 'text-delta', text: 'Hel' } } });
	model.accept({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a1', revision: 3, index: 1, time: 2, chunk: { type: 'text-delta', text: 'lo' } } });

	const streaming = model.list.filter(item => item.streaming);
	assert.equal(streaming.length, 1);
	assert.equal((streaming[0].part as { blocks: readonly { text: string }[] }).blocks[0].text, 'Hello');

	// durable 结算接管：流式临时条目消失，只剩稳定记录。
	model.accept({ type: 'event', event: { type: 'assistant/message', seq: 9, time: 3, turn: 3, data: { message: { content: [{ type: 'text', text: 'Hello' }] } } } });
	assert.equal(model.list.filter(item => item.streaming).length, 0);
	assert.deepEqual(model.list.map(item => item.id), ['seq:9']);
});

test('a replayed chunk with an older revision is dropped', () => {
	const model = new DshChatModel();
	model.accept(snapshot([]));
	model.accept({ type: 'assistant-stream', frame: { type: 'start', attemptId: 'a1', revision: 1, turn: 1, step: 1 } });
	model.accept({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a1', revision: 3, index: 1, time: 1, chunk: { type: 'text-delta', text: 'AB' } } });
	model.accept({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a1', revision: 2, index: 0, time: 1, chunk: { type: 'text-delta', text: 'X' } } });
	const streaming = model.list.find(item => item.streaming);
	assert.equal((streaming?.part as { blocks: readonly { text: string }[] }).blocks[0].text, 'AB');
});

test('an abandoned attempt leaves no visible entry', () => {
	const model = new DshChatModel();
	model.accept(snapshot([]));
	model.accept({ type: 'assistant-stream', frame: { type: 'start', attemptId: 'a1', revision: 1, turn: 1, step: 1 } });
	model.accept({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a1', revision: 2, index: 0, time: 1, chunk: { type: 'text-delta', text: 'half' } } });
	model.accept({ type: 'assistant-stream', frame: { type: 'end', attemptId: 'a1', revision: 3, index: 1, outcome: { kind: 'abandoned' } } });
	assert.deepEqual(model.list, []);
});

test('reasoning chunks never mix into the answer text', () => {
	const model = new DshChatModel();
	model.accept(snapshot([]));
	model.accept({ type: 'assistant-stream', frame: { type: 'start', attemptId: 'a1', revision: 1, turn: 1, step: 1 } });
	model.accept({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a1', revision: 2, index: 0, time: 1, chunk: { type: 'reasoning-delta', text: 'thinking' } } });
	const streaming = model.list.find(item => item.streaming);
	assert.deepEqual((streaming?.part as { blocks: readonly unknown[] }).blocks, []);
});

test('unknown frames are ignored instead of guessed at', () => {
	const model = new DshChatModel();
	assert.deepEqual(model.accept({ type: 'mystery' }), []);
	assert.deepEqual(model.accept({ type: 'event' }), []);
	assert.deepEqual(model.accept({ type: 'assistant-stream', frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'x' } } }), []);
	assert.deepEqual(model.list, []);
});

test('clear drops the old session so a switch cannot leak entries', () => {
	const model = new DshChatModel();
	model.accept(snapshot([entry(1, { type: 'user/message', data: { content: [{ type: 'text', text: 'old' }] } })]));
	assert.equal(model.list.length, 1);
	model.clear();
	assert.deepEqual(model.list, []);
});
