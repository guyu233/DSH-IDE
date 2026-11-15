/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH 聊天帧解码：follow 帧 → DSH 自己的 UserMessageNode / AssistantMessageNode。
// 不翻译、不投影：断言的就是 DSH 的字段名与 block kind。
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

test('a snapshot opening turns DSH user and assistant messages into DSH nodes', () => {
	const model = new DshChatModel();
	const changes = model.accept(snapshot([
		entry(1, { type: 'user/message', data: { content: [{ type: 'text', text: 'hi' }] } }),
		entry(2, { type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'hello' }] } } }),
	]));
	assert.equal(changes.length, 2);
	const nodes = model.list;
	assert.equal(nodes.length, 2);
	assert.equal(nodes[0].kind, 'user');
	assert.equal(nodes[1].kind, 'assistant');
	// 用户侧保留 DSH 的 ContentBlock（type: 'text'）。
	const user = nodes[0];
	if (user.kind === 'user') {
		assert.deepEqual(user.content, [{ type: 'text', text: 'hi' }]);
	}
	// 助手侧是 DSH 的 AssistantBlock（kind: 'text'），不是 VS Code 的 markdownContent。
	const assistant = nodes[1];
	if (assistant.kind === 'assistant') {
		assert.deepEqual(assistant.blocks, [{ kind: 'text', text: 'hello' }]);
		assert.equal(assistant.turn, 1);
		assert.equal(assistant.step, 1);
	}
});

test('injected user/message with a non-user source becomes a context row, not a user bubble', () => {
	const model = new DshChatModel();
	const text = 'Time sampled while preparing turn 11, step 40: 2026-11-15T20:47:01+08:00[Asia/Shanghai]\nBrowser time zone for this request: Asia/Shanghai.\nElapsed since the preceding step context: unavailable.';
	model.accept(snapshot([
		entry(1, { type: 'user/message', data: { content: [{ type: 'text', text }], source: { kind: 'time-context' } } }),
		entry(2, { type: 'user/message', data: { content: [{ type: 'text', text: 'hi' }] } }),
	]));
	const nodes = model.list;
	assert.equal(nodes.length, 2);
	assert.equal(nodes[0].kind, 'context', 'time-context injection must not be a user bubble');
	if (nodes[0].kind === 'context') {
		assert.deepEqual(nodes[0].producer, { role: 'inject', label: 'time-context' });
		assert.equal(nodes[0].form, null);
		assert.deepEqual(nodes[0].content, [{ type: 'text', text }]);
	}
	assert.equal(nodes[1].kind, 'user', 'a real human message stays a user row');
});

test('known context sources keep DSH producer roles and forms', () => {
	const model = new DshChatModel();
	model.accept(snapshot([
		entry(1, { type: 'user/message', data: { content: [{ type: 'text', text: 'skill' }], source: { kind: 'skill-invocation', name: 'grep', form: 'catalog' } } }),
		entry(2, { type: 'user/message', data: { content: [{ type: 'text', text: 'recall' }], source: { kind: 'session-reference', references: [{ label: 'chat A' }], form: 'recall' } } }),
		entry(3, { type: 'user/message', data: { content: [{ type: 'text', text: 'human' }], source: { kind: 'user' } } }),
	]));
	const nodes = model.list;
	assert.deepEqual(nodes.map(n => n.kind), ['context', 'context', 'user']);
	if (nodes[0].kind === 'context') {
		assert.deepEqual(nodes[0].producer, { role: 'inject', label: 'grep' });
		assert.equal(nodes[0].form, 'catalog');
	}
	if (nodes[1].kind === 'context') {
		assert.deepEqual(nodes[1].producer, { role: 'recall', label: 'chat A' });
		assert.equal(nodes[1].form, 'recall');
	}
});

test('a completed turn marks only its last assistant node for the single turn-tail usage row', () => {
	const model = new DshChatModel();
	model.accept(snapshot([
		entry(1, { type: 'user/message', data: { content: [{ type: 'text', text: 'hi' }] } }),
		entry(2, { type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'part A' }] }, usage: { inputTokens: 10, outputTokens: 2 } } }),
		entry(3, { type: 'assistant/message', data: { turn: 1, step: 2, message: { content: [{ type: 'text', text: 'part B' }] }, usage: { inputTokens: 20, outputTokens: 3 } } }),
		entry(4, { type: 'turn/end', data: { turn: 1, step: 2, reason: { kind: 'completed' } } }),
	]));
	const assistants = model.list.filter(n => n.kind === 'assistant') as { turnEnded?: boolean }[];
	assert.equal(assistants.length, 2);
	assert.equal(assistants[0].turnEnded, undefined, 'earlier response fragment must not render a usage row');
	assert.equal(assistants[1].turnEnded, true, 'only the closing response renders the turn-tail usage row');
});

test('an aborted turn does not mark a closing assistant node', () => {
	const model = new DshChatModel();
	model.accept(snapshot([
		entry(1, { type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'half' }] } } }),
		entry(2, { type: 'turn/end', data: { turn: 1, step: 1, reason: { kind: 'interrupted', failure: { message: 'x' } } } }),
	]));
	assert.equal((model.list.find(n => n.kind === 'assistant') as { turnEnded?: boolean } | undefined)?.turnEnded, undefined);
	assert.ok(model.list.some(n => n.kind === 'turn-error'));
});

test('DSH assistant blocks keep reasoning and tool-call kinds verbatim', () => {
	const model = new DshChatModel();
	model.accept(snapshot([
		entry(1, {
			type: 'assistant/message',
			data: {
				turn: 1, step: 1,
				message: {
					content: [
						{ type: 'reasoning', text: 'thinking' },
						{ type: 'text', text: 'answer' },
						{ type: 'tool-call', id: 'c1', name: 'bash', arguments: '{"x":1}' },
					],
				},
			},
		}),
	]));
	const node = model.list[0];
	assert.equal(node.kind, 'assistant');
	if (node.kind === 'assistant') {
		assert.deepEqual(node.blocks.map(block => block.kind), ['reasoning', 'text', 'tool-call']);
		assert.deepEqual(node.blocks[2], { kind: 'tool-call', callId: 'c1', name: 'bash', argsRaw: '{"x":1}' });
	}
});

test('streaming chunks accumulate into one assistant node until the message settles', () => {
	const model = new DshChatModel();
	model.accept(snapshot([]));
	model.accept({ type: 'assistant-stream', frame: { type: 'start', attemptId: 'a1', revision: 1, turn: 3, step: 1 } });
	model.accept({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a1', revision: 2, index: 0, time: 1, chunk: { type: 'text-delta', text: 'Hel' } } });
	model.accept({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a1', revision: 3, index: 1, time: 2, chunk: { type: 'text-delta', text: 'lo' } } });

	const streaming = model.list;
	assert.equal(streaming.length, 1);
	assert.equal(streaming[0].kind, 'assistant');
	if (streaming[0].kind === 'assistant') {
		assert.deepEqual(streaming[0].blocks, [{ kind: 'text', text: 'Hello' }]);
	}

	// durable 结算接管：流式临时节点消失，只剩稳定记录。
	model.accept({ type: 'event', event: { type: 'assistant/message', seq: 9, time: 3, turn: 3, step: 1, data: { message: { content: [{ type: 'text', text: 'Hello' }] } } } });
	assert.deepEqual(model.list.map(node => node.seq), [9]);
});

test('a replayed chunk with an older revision is dropped', () => {
	const model = new DshChatModel();
	model.accept(snapshot([]));
	model.accept({ type: 'assistant-stream', frame: { type: 'start', attemptId: 'a1', revision: 1, turn: 1, step: 1 } });
	model.accept({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a1', revision: 3, index: 1, time: 1, chunk: { type: 'text-delta', text: 'AB' } } });
	model.accept({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a1', revision: 2, index: 0, time: 1, chunk: { type: 'text-delta', text: 'X' } } });
	const node = model.list.find(item => item.kind === 'assistant');
	assert.equal(node?.kind, 'assistant');
	if (node?.kind === 'assistant') {
		assert.deepEqual(node.blocks, [{ kind: 'text', text: 'AB' }]);
	}
});

test('an abandoned attempt leaves no visible node', () => {
	const model = new DshChatModel();
	model.accept(snapshot([]));
	model.accept({ type: 'assistant-stream', frame: { type: 'start', attemptId: 'a1', revision: 1, turn: 1, step: 1 } });
	model.accept({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a1', revision: 2, index: 0, time: 1, chunk: { type: 'text-delta', text: 'half' } } });
	model.accept({ type: 'assistant-stream', frame: { type: 'end', attemptId: 'a1', revision: 3, index: 1, outcome: { kind: 'abandoned' } } });
	assert.deepEqual(model.list, []);
});

test('reasoning deltas stay in a reasoning block, never mixed into text', () => {
	const model = new DshChatModel();
	model.accept(snapshot([]));
	model.accept({ type: 'assistant-stream', frame: { type: 'start', attemptId: 'a1', revision: 1, turn: 1, step: 1 } });
	model.accept({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a1', revision: 2, index: 0, time: 1, chunk: { type: 'reasoning-delta', text: 'think' } } });
	const node = model.list[0];
	assert.equal(node.kind, 'assistant');
	if (node.kind === 'assistant') {
		assert.deepEqual(node.blocks, [{ kind: 'reasoning', text: 'think' }]);
	}
});

test('unknown frames are ignored instead of guessed at', () => {
	const model = new DshChatModel();
	assert.deepEqual(model.accept({ type: 'mystery' }), []);
	assert.deepEqual(model.accept({ type: 'event' }), []);
	assert.deepEqual(model.accept({ type: 'assistant-stream', frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'x' } } }), []);
	assert.deepEqual(model.list, []);
});

test('clear drops the old session so a switch cannot leak nodes', () => {
	const model = new DshChatModel();
	model.accept(snapshot([entry(1, { type: 'user/message', data: { content: [{ type: 'text', text: 'old' }] } })]));
	assert.equal(model.list.length, 1);
	model.clear();
	assert.deepEqual(model.list, []);
});

// ---- 解码保真（Step 1-A）：以下用例锁定"不增不减"在解码层的实证 ----

test('每个 durable 节点都携带 raw，且 raw 就是源事件信封', () => {
	const model = new DshChatModel();
	const event = entry(7, { type: 'user/message', data: { content: [{ type: 'text', text: 'hi' }] } });
	model.accept(snapshot([event]));
	const node = model.list[0] as { raw?: unknown };
	assert.ok(node.raw !== undefined, 'durable 节点必须带 raw');
	const raw = node.raw as Record<string, unknown>;
	assert.equal(raw['seq'], 7);
	assert.equal(raw['type'], 'user/message');
	// raw 是原对象本身，不是重建的副本：data 引用同一份内容。
	assert.deepEqual(raw['data'], { content: [{ type: 'text', text: 'hi' }] });
});

test('session/end-seed(inherited) 落成 inherited-history 分界节点', () => {
	const model = new DshChatModel();
	model.accept(snapshot([
		entry(1, { type: 'session/end-seed', data: { inherited: true } }),
		entry(2, { type: 'user/message', data: { content: [{ type: 'text', text: 'after' }] } }),
	]));
	assert.deepEqual(model.list.map(n => n.kind), ['inherited-history', 'user']);
});

test('非 inherited 的 session/end-seed 不产生分界节点', () => {
	const model = new DshChatModel();
	model.accept(snapshot([entry(1, { type: 'session/end-seed', data: { inherited: false } })]));
	assert.deepEqual(model.list, []);
});

test('未认领的 append-surface 事件落 unknown 节点且保留原文', () => {
	const model = new DshChatModel();
	model.accept(snapshot([
		entry(5, { type: 'plugin/something', data: { surfaceOp: 'append', payload: { a: 1 } } }),
	]));
	const node = model.list[0];
	assert.equal(node.kind, 'unknown');
	if (node.kind === 'unknown') {
		assert.equal(node.type, 'plugin/something');
		assert.deepEqual(node.data, { surfaceOp: 'append', payload: { a: 1 } });
	}
});

test('非 surface 的内部事件不产生可见节点（避免凭空多出界面行）', () => {
	const model = new DshChatModel();
	model.accept(snapshot([entry(1, { type: 'turn/start', data: { turn: 1 } })]));
	assert.deepEqual(model.list, []);
});

test('tool-result 的 args/subCalls/isError 是必填，不被省略', () => {
	const model = new DshChatModel();
	model.accept(snapshot([
		entry(3, {
			type: 'tool/result',
			data: {
				message: { source: { callId: 'c1' }, content: [{ type: 'text', text: 'ok' }], isError: false },
				call: { name: 'bash', argsRaw: '{}' },
				args: { command: 'ls' },
				subCalls: [],
			},
		}),
	]));
	const node = model.list[0];
	assert.equal(node.kind, 'tool-result');
	if (node.kind === 'tool-result') {
		assert.deepEqual(node.args, { command: 'ls' });
		assert.deepEqual(node.subCalls, []);
		assert.equal(node.isError, false);
	}
});

test('assistant 的 timing/interrupted 不再被丢弃', () => {
	const model = new DshChatModel();
	model.accept(snapshot([
		entry(4, {
			type: 'assistant/message',
			data: {
				message: {
					content: [{ type: 'text', text: 'x' }],
					timing: { stepStartTime: 1, firstTokenTime: 2, completedTime: 3 },
					interrupted: true,
				},
			},
		}),
	]));
	const node = model.list[0];
	if (node.kind === 'assistant') {
		assert.deepEqual(node.timing, { stepStartTime: 1, firstTokenTime: 2, completedTime: 3 });
		assert.equal(node.interrupted, true);
	}
});

test('file 块落 assistant 的 other（真源 AssistantBlock 无 file kind）', () => {
	const model = new DshChatModel();
	model.accept(snapshot([
		entry(1, {
			type: 'assistant/message',
			data: { message: { content: [{ type: 'file', attachment: { name: 'a.txt' } }] } },
		}),
	]));
	const node = model.list[0];
	if (node.kind === 'assistant') {
		assert.equal(node.blocks[0].kind, 'other');
	}
});

test('非记录内容块不被丢弃（落 plugin 块并保留原值）', () => {
	const model = new DshChatModel();
	model.accept(snapshot([
		entry(1, { type: 'user/message', data: { content: ['raw-string-block'] } }),
	]));
	const node = model.list[0];
	if (node.kind === 'user') {
		assert.equal(node.content.length, 1);
		assert.equal(node.content[0].type, 'plugin');
	}
});
