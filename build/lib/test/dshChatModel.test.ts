/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH 聊天模型单测：模型层只消费 Host 投影好的结构化会话（手册 §5.4）。
// 裸 follow 帧由 `dshIdeConversation` 投影，本文件用同一个投影器构造输入，
// 断言的是模型层的节点树、定位、分页与 token 累加。
// 运行：node --experimental-strip-types --test build/lib/test/dshChatModel.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DshChatModel } from '../../../out/vs/workbench/contrib/dsh/browser/dshChatModel.js';
import {
	createDshIdeConversationState,
	projectDshIdeConversation,
} from '../../../src/vs/platform/dshClient/common/dshIdeConversation.ts';

/** 用 Host 同款投影器把一串官方事件投影成模型输入。 */
function conversationOf(events: readonly Record<string, unknown>[], hasMore = false) {
	const state = createDshIdeConversationState();
	for (const event of events) {
		projectDshIdeConversation(state, { type: 'event', event });
	}
	return { hasMore, nodes: [...state.nodes.values()].sort((a, b) => a.seq - b.seq) };
}

function event(seq: number, type: string, data: Record<string, unknown> = {}): Record<string, unknown> {
	return { seq, time: seq, type, data };
}

function accept(model: DshChatModel, events: readonly Record<string, unknown>[], hasMore = false) {
	return model.acceptConversation(conversationOf(events, hasMore) as never);
}

test('user and assistant events become DSH nodes on the typed path', () => {
	const model = new DshChatModel();
	accept(model, [
		event(1, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }),
		event(2, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'hello' }] } }),
	]);
	assert.deepEqual(model.list.map(node => node.kind), ['user', 'assistant']);
	assert.equal(model.hasMore(), false);
});

test('injected user/message with a non-user source becomes a context row', () => {
	const model = new DshChatModel();
	accept(model, [
		event(1, 'user/message', {
			source: { kind: 'time-context' },
			content: [{ type: 'text', text: 'now' }],
		}),
	]);
	assert.equal(model.list.length, 1);
	assert.equal(model.list[0].kind, 'context');
});

test('assistant blocks keep reasoning and tool-call kinds verbatim', () => {
	const model = new DshChatModel();
	accept(model, [
		event(1, 'assistant/message', {
			turn: 1,
			step: 1,
			message: {
				content: [
					{ type: 'reasoning', text: 'think' },
					{ type: 'tool-call', id: 'call-1', name: 'read', arguments: '{"path":"a"}' },
					{ type: 'text', text: 'done' },
				],
			},
		}),
	]);
	const node = model.list[0];
	assert.equal(node.kind, 'assistant');
	if (node.kind === 'assistant') {
		assert.deepEqual(node.blocks.map(block => block.kind), ['reasoning', 'tool-call', 'text']);
	}
});

test('subagent/catalog becomes a catalog node and does not invent missing fields', () => {
	const model = new DshChatModel();
	accept(model, [
		event(1, 'subagent/catalog', { childId: 'c-1', childCreatedAt: 5, mode: 'continuable', label: 'reviewer', name: 'reviewer', version: 3 }),
	]);
	assert.equal(model.list.length, 1);
	const node = model.list[0];
	assert.equal(node.kind, 'subagent-catalog');
	if (node.kind === 'subagent-catalog') {
		assert.equal(node.name, 'reviewer');
		assert.equal(node.version, 3);
	}
});

test('subagent-settled user messages are notices, not user bubbles', () => {
	const model = new DshChatModel();
	accept(model, [
		event(1, 'user/message', { source: { kind: 'subagent-settled' }, content: [{ type: 'text', text: 'relay' }] }),
	]);
	assert.equal(model.list.length, 1);
	assert.equal(model.list[0].kind, 'subagent-notice');
});

test('session/end-seed(inherited) becomes an inherited-history marker', () => {
	const model = new DshChatModel();
	accept(model, [event(1, 'session/end-seed', { inherited: true })]);
	assert.equal(model.list.length, 1);
	assert.equal(model.list[0].kind, 'inherited-history');
});

test('non-inherited session/end-seed produces no marker', () => {
	const model = new DshChatModel();
	accept(model, [event(1, 'session/end-seed', { inherited: false })]);
	assert.equal(model.list.length, 0);
});

test('internal non-surface events produce no visible node', () => {
	const model = new DshChatModel();
	accept(model, [event(1, 'turn/start', { turn: 1 })]);
	assert.equal(model.list.length, 0);
});

test('tool-result keeps args/subCalls/isError required', () => {
	const model = new DshChatModel();
	accept(model, [
		event(1, 'tool/result', {
			message: { source: { callId: 'call-1' }, content: [{ type: 'text', text: 'body' }], isError: false },
			call: { name: 'read', argsRaw: '{"path":"a"}' },
			args: { path: 'a' },
			subCalls: [],
		}),
	]);
	const node = model.list[0];
	assert.equal(node.kind, 'tool-result');
	if (node.kind === 'tool-result') {
		assert.deepEqual(node.args, { path: 'a' });
		assert.equal(node.isError, false);
		assert.deepEqual(node.subCalls, []);
	}
});

test('clear drops the old session so a switch cannot leak nodes', () => {
	const model = new DshChatModel();
	accept(model, [event(1, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'old' }] })]);
	assert.equal(model.list.length, 1);
	model.clear();
	assert.equal(model.list.length, 0);
	assert.equal(model.firstSeq(), undefined);
});

test('a later conversation drops nodes from the previous session window', () => {
	const model = new DshChatModel();
	accept(model, [event(1, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'first' }] })]);
	accept(model, [event(9, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'second' }] })]);
	assert.equal(model.list.length, 1);
	assert.equal(model.list[0].seq, 9);
});

test('acceptConversation builds the node tree straight from typed nodes', () => {
	const model = new DshChatModel();
	model.acceptConversation({
		hasMore: true,
		nodes: [
			{ kind: 'user', seq: 3, time: 3, content: [{ type: 'text', text: 'typed' }] },
			{ kind: 'subagent-catalog', seq: 4, time: 4, childId: 'c-1', mode: 'continuable', name: 'reviewer', version: 3 },
			{ kind: 'assistant', seq: 5, time: 5, turn: 1, step: 1, blocks: [{ kind: 'text', text: 'ok' }] },
			{ kind: 'tool-result', seq: 6, time: 6, callId: 'call-1', name: 'read', args: { path: 'a' }, content: [{ type: 'text', text: 'body' }], isError: false, subCalls: [] },
		],
	} as never);
	assert.deepEqual(model.list.map(node => node.kind), ['user', 'subagent-catalog', 'assistant', 'tool-result']);
	assert.equal(model.hasMore(), true);
	const catalog = model.list[1];
	assert.equal(catalog.kind, 'subagent-catalog');
	if (catalog.kind === 'subagent-catalog') {
		assert.equal(catalog.name, 'reviewer');
		assert.equal(catalog.childId, 'c-1');
	}
});

test('acceptConversation keeps command nodes keyed by commandId', () => {
	const model = new DshChatModel();
	model.acceptConversation({
		hasMore: false,
		nodes: [{ kind: 'command', seq: 7, time: 7, commandId: 'cmd-1', name: 'plan', args: null, outcome: { kind: 'success' } }],
	} as never);
	assert.equal(model.list.length, 1);
	const command = model.list[0];
	assert.equal(command.kind, 'command');
	if (command.kind === 'command') {
		assert.equal(command.commandId, 'cmd-1');
		assert.equal(command.outcome?.kind, 'success');
	}
});

test('acceptConversation keeps firstSeq and token usage correct on the typed path', () => {
	const model = new DshChatModel();
	model.acceptConversation({
		hasMore: true,
		nodes: [
			{ kind: 'user', seq: 12, time: 12, content: [{ type: 'text', text: 'q' }] },
			{
				kind: 'assistant', seq: 13, time: 13, turn: 2, step: 1,
				blocks: [{ kind: 'text', text: 'a' }],
				usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 5 },
			},
		],
	} as never);
	assert.equal(model.firstSeq(), 12);
	assert.deepEqual(model.tokenUsage(), {
		uncachedInputTokens: 65,
		cacheReadTokens: 30,
		cacheWriteTokens: 5,
		outputTokens: 20,
	});
	assert.deepEqual(model.located.map(entry => [entry.turn, entry.step]), [[undefined, undefined], [2, 1]]);
});

test('acceptConversation resets previous token usage instead of accumulating across sessions', () => {
	const model = new DshChatModel();
	model.acceptConversation({
		hasMore: false,
		nodes: [{ kind: 'assistant', seq: 1, time: 1, turn: 1, step: 1, blocks: [{ kind: 'text', text: 'a' }], usage: { inputTokens: 10, outputTokens: 1 } }],
	} as never);
	assert.ok(model.tokenUsage() !== undefined);
	model.acceptConversation({ hasMore: false, nodes: [] } as never);
	assert.equal(model.tokenUsage(), undefined);
	assert.equal(model.firstSeq(), undefined);
});

test('prependPage merges an older page through the projector, keeping seq order', () => {
	const model = new DshChatModel();
	accept(model, [event(9, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'newer' }] })]);
	const page = {
		hasMore: true,
		records: [
			{ type: 'event', event: event(2, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'older' }] }) },
		],
	};
	const result = model.prependPage(page as never);
	assert.equal(result.added, 1);
	assert.equal(result.firstSeq, 2);
	assert.deepEqual(model.list.map(node => node.seq), [2, 9]);
});

test('prependPage skips records that are not strictly older', () => {
	const model = new DshChatModel();
	accept(model, [event(5, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'current' }] })]);
	const result = model.prependPage({
		hasMore: false,
		records: [{ type: 'event', event: event(5, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'dup' }] }) }],
	} as never);
	assert.equal(result.added, 0);
	assert.equal(model.list.length, 1);
});

test('the sorted node list is reused until the nodes actually change', () => {
	// `list` 每帧被 `toHistory` 读一次，内部要合并两份 Map 再全量排序。
	// 节点没变时必须复用上一次的结果，否则长会话每帧都在重复排序。
	const model = new DshChatModel();
	const first = model.list;
	assert.equal(model.list, first, 'an unchanged model must return the same array instance');
	const read = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/dshChatModel.ts', import.meta.url), 'utf8');
	assert.match(read, /private _nodesVersion = 0/, 'mutations must bump a version');
	assert.match(read, /this\._listVersion === this\._nodesVersion/, 'the cache must be keyed on that version');
	// firstSeq 不得为了一次比较复制整份节点表。
	assert.doesNotMatch(read, /const merged = new Map<string, DshChatNode>\(this\.olderNodes\);\s*\n\s*for \(const \[id, node\] of this\.nodes\) \{\s*\n\s*merged\.set\(id, node\);\s*\n\s*\}\s*\n\s*for \(const \[id, node\] of merged\)/, 'firstSeq must not copy the whole node table');
});

test('an empty history page forces hasMore false', () => {
	const model = new DshChatModel();
	accept(model, [event(3, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'x' }] })], true);
	assert.equal(model.hasMore(), true);
	model.prependPage({ hasMore: true, records: [] } as never);
	assert.equal(model.hasMore(), false);
});

test('the model no longer parses bare follow frames', () => {
	const model = new DshChatModel();
	// 手册 §5.4：模型层只吃 typed conversation；裸帧一律不产生变更。
	assert.deepEqual(model.accept({ type: 'snapshot', records: [] }), []);
	assert.deepEqual(model.accept({ type: 'event', event: event(1, 'user/message', {}) }), []);
	assert.deepEqual(model.accept({ type: 'assistant-stream', frame: { type: 'start', attemptId: 'a1', revision: 1 } }), []);
	assert.equal(model.list.length, 0);
});
