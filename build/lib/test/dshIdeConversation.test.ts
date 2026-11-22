/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 结构化会话投影单测：follow 帧 → 协议白名单内的 DshIdeConversationNode。
// 每个投影结果都过一遍 validateDshIdeSnapshot，确保真源协议始终认得。
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshIdeConversation.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	DSH_IDE_WIRE_REVISION,
	validateDshIdeSnapshot,
	type DshIdeConversationView,
} from '../../../src/vs/platform/dshClient/protocol/dshIdeProtocol.ts';
import {
	attachmentsOf,
	createDshIdeConversationState,
	deliverablesOf,
	projectDshIdeConversation,
	quotaNoticeOf,
} from '../../../src/vs/platform/dshClient/protocol/dshIdeConversation.ts';

type ConversationState = ReturnType<typeof createDshIdeConversationState>;

/** 投影并过协议校验；frame 原样放进 view.frame，满足 ready 快照的最小形状。 */
function project(state: ConversationState, frame: Record<string, unknown>): DshIdeConversationView {
	const conversation = projectDshIdeConversation(state, frame);
	assert.ok(conversation !== undefined, 'frame should produce a conversation view');
	validateDshIdeSnapshot({
		wireRevision: DSH_IDE_WIRE_REVISION,
		channelId: 'c1',
		binding: { viewId: 'c1', generation: 1, sessionId: null },
		version: 1,
		state: { state: 'ready', view: { frame, conversation } },
	});
	return conversation;
}

/** 投影节点一律不携带原始帧；协议白名单也不接受 raw。 */
function assertNoRaw(view: DshIdeConversationView): void {
	for (const node of view.nodes) {
		assert.ok(!('raw' in node), 'projected nodes must not carry a raw field');
	}
}

test('snapshot 帧投影 user 消息，hasMore false 透传到视图', () => {
	const state = createDshIdeConversationState();
	const frame = {
		type: 'snapshot',
		hasMore: false,
		records: [
			{
				type: 'event',
				event: {
					type: 'user/message',
					seq: 1,
					time: 1,
					data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] },
				},
			},
		],
	};
	const view = project(state, frame);
	assert.equal(view.hasMore, false);
	assert.equal(view.nodes.length, 1);
	assert.equal(view.nodes[0].kind, 'user');
	const user = view.nodes[0];
	if (user.kind === 'user') {
		assert.deepEqual(user.content, [{ type: 'text', text: 'hi' }]);
		// 官方 UserMessageNode.source（records.ts）。缺了渲染层无法区分真人消息和注入。
		assert.deepEqual(user.source, { kind: 'user' });
	}
	assertNoRaw(view);
});

test('next-step 认领过的人类消息投影为 steering', () => {
	const state = createDshIdeConversationState();
	const claim = (seq: number, data: Record<string, unknown>) => project(state, {
		type: 'event',
		event: { type: 'agent/inbox/spliced', seq, time: seq, data },
	});
	claim(1, {
		target: 'next-step',
		start: 0,
		removedCount: 0,
		inserted: [{ id: 'm-steer', source: { kind: 'user' } }],
	});
	claim(2, { target: 'next-step', start: 0, removedCount: 1, inserted: [] });
	const steered = project(state, {
		type: 'event',
		event: {
			type: 'user/message',
			seq: 3,
			time: 3,
			turn: 4,
			data: { id: 'm-steer', source: { kind: 'user' }, content: [{ type: 'text', text: 'while running' }] },
		},
	});
	assert.equal(steered.nodes.at(-1)?.kind, 'steering');
	const node = steered.nodes.at(-1);
	if (node?.kind === 'steering') {
		assert.equal(node.messageId, 'm-steer');
		assert.equal(node.turn, 4);
	}
	const plain = project(state, {
		type: 'event',
		event: {
			type: 'user/message',
			seq: 4,
			time: 4,
			data: { id: 'm-plain', source: { kind: 'user' }, content: [{ type: 'text', text: 'new turn' }] },
		},
	});
	assert.equal(plain.nodes.at(-1)?.kind, 'user');
});

test('非人类 user/message 投影为 context 并带上 source 与 producer', () => {
	const state = createDshIdeConversationState();
	const source = { kind: 'skill-invocation', name: 'dsh-doc', form: 'instructions' };
	const view = project(state, {
		type: 'event',
		event: {
			type: 'user/message',
			seq: 8,
			time: 8,
			data: { source, content: [{ type: 'text', text: 'use the skill' }] },
		},
	});
	assert.equal(view.nodes[0]?.kind, 'context');
	const node = view.nodes[0];
	if (node?.kind === 'context') {
		assert.deepEqual(node.source, source);
		assert.equal(node.producer?.role, 'inject');
		assert.equal(node.producer?.label, 'dsh-doc');
		assert.equal(node.form, 'instructions');
	}
});

test('subagent/catalog 走 subagentCatalog 投影通道，不进入节点树', () => {
	const state = createDshIdeConversationState();
	const frame = {
		type: 'event',
		event: {
			type: 'subagent/catalog',
			seq: 2,
			time: 2,
			data: { childId: 'child-1', childCreatedAt: 5, mode: 'continuable', label: 'reviewer', name: 'reviewer', version: 3 },
		},
	};
	const view = project(state, frame);
	// 官方把它放在 SessionProjectionMap['subagentCatalog']，不是 chat 节点 kind。
	assert.equal(view.nodes.length, 0, 'a catalog fact must not become a chat node');
	assert.equal(view.subagentCatalog?.length, 1);
	const entry = view.subagentCatalog![0];
	assert.equal(entry.name, 'reviewer');
	assert.equal(entry.version, 3);
	assert.equal(entry.childId, 'child-1');
	assert.equal(entry.childCreatedAt, 5);
	assert.equal(entry.mode, 'continuable');
	assertNoRaw(view);
});

test('catalog 缺字段时不臆造，也不产生节点', () => {
	const state = createDshIdeConversationState();
	const view = project(state, {
		type: 'event',
		event: { type: 'subagent/catalog', seq: 4, time: 4, data: {} },
	});
	assert.equal(view.nodes.length, 0);
	assert.deepEqual(view.subagentCatalog, [{ seq: 4, time: 4 }]);
});

test('subagent-settled 未被认领为唤醒时按普通消息归类，不画成 turn-trigger', () => {
	const state = createDshIdeConversationState();
	const frame = {
		type: 'event',
		event: {
			type: 'user/message',
			seq: 3,
			time: 3,
			data: { source: { kind: 'subagent-settled', form: 'notice' }, content: [{ type: 'text', text: 'relay' }] },
		},
	};
	const view = project(state, frame);
	assert.equal(view.nodes.length, 1);
	// 官方 message.ts 只在 waking 或空 content 的 retry 时产出 turn-trigger；
	// 其余非人类 source 走 context。
	assert.equal(view.nodes[0].kind, 'context');
	const node = view.nodes[0];
	if (node.kind === 'context') {
		assert.deepEqual(node.content, [{ type: 'text', text: 'relay' }]);
		assert.equal(node.form, 'notice');
	}
	assertNoRaw(view);
});

test('被认领为唤醒的 subagent-settled 投影为官方 turn-trigger', () => {
	const state = createDshIdeConversationState();
	const view = project(state, {
		type: 'event',
		event: {
			type: 'user/message',
			seq: 5,
			time: 5,
			turn: 2,
			data: {
				waking: true,
				source: { kind: 'subagent-settled', form: 'notice', stopReason: 'completed' },
				content: [{ type: 'text', text: 'child finished' }],
			},
		},
	});
	assert.equal(view.nodes.length, 1);
	assert.equal(view.nodes[0].kind, 'turn-trigger');
	const node = view.nodes[0];
	if (node.kind === 'turn-trigger') {
		assert.deepEqual(node.content, [{ type: 'text', text: 'child finished' }]);
		assert.equal(node.turn, 2);
		assert.equal(node.form, 'notice');
		// source 原样保留：渲染层要按 source.kind / stopReason 选图标与标题。
		assert.deepEqual(node.source, { kind: 'subagent-settled', form: 'notice', stopReason: 'completed' });
		assert.equal(node.producer?.role, 'inject');
		assert.equal(node.producer?.label, 'subagent-settled');
	}
	assertNoRaw(view);
});

test('空 content 的 retry 投影为 turn-trigger，非空 content 的 retry 不是', () => {
	const state = createDshIdeConversationState();
	const emptyRetry = project(state, {
		type: 'event',
		event: { type: 'user/message', seq: 6, time: 6, data: { source: { kind: 'retry' }, content: [] } },
	});
	assert.equal(emptyRetry.nodes[0]?.kind, 'turn-trigger');

	const state2 = createDshIdeConversationState();
	const withText = project(state2, {
		type: 'event',
		event: { type: 'user/message', seq: 7, time: 7, data: { source: { kind: 'retry' }, content: [{ type: 'text', text: 'again' }] } },
	});
	assert.notEqual(withText.nodes[0]?.kind, 'turn-trigger');
});

test('私有 kind 不出现在正式节点白名单里', async () => {
	const { readFileSync } = await import('node:fs');
	const protocol = readFileSync(new URL('../../../src/vs/platform/dshClient/protocol/dshIdeProtocol.ts', import.meta.url), 'utf8');
	assert.ok(!protocol.includes("'subagent-notice'"), 'subagent-notice must not be an official node kind');
	assert.ok(!protocol.includes("'subagent-catalog'"), 'subagent-catalog must not be an official node kind');
});

test('协议校验器运行期拒绝私有 kind，接受 turn-trigger 与 subagentCatalog', () => {
	// 静态源码里没有这些字符串还不够：契约可能是拼接出来的，或被 default 放行。
	// 这里用真实校验器跑一遍接受/拒绝矩阵。
	const snapshot = (nodes: readonly unknown[], extra: Record<string, unknown> = {}) => ({
		wireRevision: DSH_IDE_WIRE_REVISION,
		channelId: 'c1',
		binding: { viewId: 'c1', generation: 1, sessionId: null },
		version: 1,
		state: { state: 'ready', view: { frame: { type: 'event' }, conversation: { hasMore: true, nodes, ...extra } } },
	});

	for (const kind of ['subagent-notice', 'subagent-catalog']) {
		assert.throws(
			() => validateDshIdeSnapshot(snapshot([{ kind, seq: 1, time: 1, content: [] }]) as never),
			/kind is not an official conversation node/,
			`the validator must reject the retired private kind ${kind}`,
		);
	}

	assert.doesNotThrow(() => validateDshIdeSnapshot(snapshot([
		{ kind: 'turn-trigger', seq: 2, time: 2, content: [{ type: 'text', text: 'x' }], source: { kind: 'subagent-settled' } },
	]) as never), 'turn-trigger must be an accepted official kind');

	assert.doesNotThrow(() => validateDshIdeSnapshot(snapshot([], {
		subagentCatalog: [{ seq: 3, time: 3, childId: 'c', name: 'n', version: 3 }],
	}) as never), 'the subagentCatalog projection channel must be accepted');

	// 投影通道同样要严格：未知字段不能被静默吞掉。
	assert.throws(
		() => validateDshIdeSnapshot(snapshot([], { subagentCatalog: [{ seq: 3, time: 3, bogus: 1 }] }) as never),
		/contains unknown field/,
		'the catalog channel must reject unknown fields',
	);
});

test('未知事件类型（turn/start 无 surfaceOp）不产生节点', () => {
	const state = createDshIdeConversationState();
	const frame = {
		type: 'event',
		event: { type: 'turn/start', seq: 4, time: 4, data: { turn: 1 } },
	};
	const view = project(state, frame);
	assert.deepEqual(view.nodes, []);
	assertNoRaw(view);
});

test('deliverables/presented 累计为交付物字段并过协议校验', () => {
	const state = createDshIdeConversationState();
	const frame = {
		type: 'event',
		event: {
			type: 'deliverables/presented',
			seq: 6,
			time: 6,
			data: { turn: 2, callId: 'present-1', files: [{ path: 'docs/a.md', description: '说明' }, { path: 'docs/b.md' }] },
		},
	};
	project(state, frame);
	const deliverables = deliverablesOf(state);
	assert.equal(deliverables.length, 1);
	assert.deepEqual(deliverables[0], {
		turn: 2,
		callId: 'present-1',
		files: [{ path: 'docs/a.md', description: '说明' }, { path: 'docs/b.md' }],
	});
	// 交付物字段也必须过协议校验。
	validateDshIdeSnapshot({
		wireRevision: DSH_IDE_WIRE_REVISION,
		channelId: 'c1',
		binding: { viewId: 'c1', generation: 1, sessionId: null },
		version: 1,
		state: { state: 'ready', view: { frame, deliverables } },
	});
});

test('没有 callId 或没有文件的 presented 事件不产生交付物', () => {
	const state = createDshIdeConversationState();
	project(state, {
		type: 'event',
		event: { type: 'deliverables/presented', seq: 7, time: 7, data: { turn: 1, files: [{ path: 'x.md' }] } },
	});
	project(state, {
		type: 'event',
		event: { type: 'deliverables/presented', seq: 8, time: 8, data: { turn: 1, callId: 'c', files: [] } },
	});
	assert.deepEqual(deliverablesOf(state), []);
});

test('quotaNotice 只在 turn/end 的 error.code 为 QUOTA/ACCOUNT_QUOTA 时记录', () => {
	const state = createDshIdeConversationState();
	project(state, {
		type: 'event',
		event: {
			type: 'turn/end',
			seq: 10,
			time: 10,
			data: { turn: 1, step: 1, reason: { kind: 'error', error: { code: 'ACCOUNT_QUOTA', name: 'QuotaError', message: '额度已用尽' } } },
		},
	});
	assert.deepEqual(quotaNoticeOf(state), { code: 'ACCOUNT_QUOTA', seq: 10 });
	// 额度提示必须过协议校验。
	validateDshIdeSnapshot({
		wireRevision: DSH_IDE_WIRE_REVISION,
		channelId: 'c1',
		binding: { viewId: 'c1', generation: 1, sessionId: null },
		version: 1,
		state: { state: 'ready', view: { frame: { type: 'event' }, quotaNotice: quotaNoticeOf(state) } },
	});

	const other = createDshIdeConversationState();
	project(other, {
		type: 'event',
		event: { type: 'turn/end', seq: 11, time: 11, data: { turn: 1, step: 1, reason: { kind: 'error', error: { code: 'INTERNAL', name: 'Boom' } } } },
	});
	assert.equal(quotaNoticeOf(other), undefined);
});

test('/compact 命令行与压缩检查点合成 manual-compaction，先到后到都能配对', () => {
	const compactThenCommand = (order: 'command-first' | 'compaction-first') => {
		const state = createDshIdeConversationState();
		const send = (event: Record<string, unknown>) => project(state, { type: 'event', event });
		const commandRun = { type: 'command/run', seq: 80, time: 80, data: { commandId: 'cmd-1', name: 'compact', rawInput: '' } };
		const commandDone = { type: 'command/done', seq: 81, time: 81, data: { commandId: 'cmd-1', ok: true, sourceEventSeq: 79 } };
		// 官方 `compaction/summary` 的 `summary` 是内容块数组（master `records.ts:CompactionSummaryNode`
		// 已无 summary 字段，摘要改由 `compaction/summary` 事件的 `data.summary` 按 seq 读回）。
		const compaction = { type: 'compaction/summary', seq: 79, time: 79, data: { summary: [{ type: 'text', text: '摘要' }], shadowedItemCount: 3, shadowedTokenCount: 40 } };
		let view = order === 'command-first' ? send(commandRun) : send(compaction);
		if (order === 'command-first') { send(compaction); view = send(commandDone); } else { send(commandRun); view = send(commandDone); }
		return view;
	};
	for (const order of ['command-first', 'compaction-first'] as const) {
		const view = compactThenCommand(order);
		assert.deepEqual(view.nodes.map(node => node.kind), ['manual-compaction'], order);
		const node = view.nodes[0] as { command: { commandId: string; name: string | null }; compaction: { summary: string | null; shadowedItemCount?: number } };
		assert.equal(node.command.commandId, 'cmd-1');
		assert.equal(node.command.name, 'compact');
		assert.equal(node.compaction.summary, '摘要');
		assert.equal(node.compaction.shadowedItemCount, 3);
	}
	// 没有 sourceEventSeq 的普通命令不配对，保持各自的行。
	const plain = createDshIdeConversationState();
	project(plain, { type: 'event', event: { type: 'command/run', seq: 90, time: 90, data: { commandId: 'cmd-2', name: 'help', rawInput: '' } } });
	const done = project(plain, { type: 'event', event: { type: 'command/done', seq: 91, time: 91, data: { commandId: 'cmd-2', ok: true } } });
	assert.deepEqual(done.nodes.map(node => node.kind), ['command']);
});

test('a retried attempt replaces the same step usage instead of stacking it', () => {
	// 官方 `tokenUsageProjectionDefinition`：同一 `(turn, step)` 再来一个样本时用 `addReplacing`
	// 先扣掉上一次再计入新的。纯累加会把被覆盖的那次也算进总量，比官方偏大。
	const state = createDshIdeConversationState();
	const send = (event: Record<string, unknown>) => project(state, { type: 'event', event });
	// 官方显示前提之一：loaded window 必须包含该 Turn 的 `turn/start`。
	send({ type: 'turn/start', seq: 199, time: 199, data: { turn: 30 } });
	send({ type: 'assistant/message', seq: 200, time: 200, turn: 30, data: { turn: 30, step: 1, message: { content: [{ type: 'text', text: 'a' }], usage: { inputTokens: 10, outputTokens: 1 } } } });
	send({ type: 'assistant/message', seq: 201, time: 201, turn: 30, data: { turn: 30, step: 1, message: { content: [{ type: 'text', text: 'a' }], usage: { inputTokens: 20, outputTokens: 2 } } } });
	const view = send({ type: 'turn/end', seq: 202, time: 202, data: { turn: 30, step: 1, reason: { kind: 'completed' } } });
	const tail = view.nodes.find(node => node.kind === 'turn-tail') as { tokenUsage?: { input?: number; output?: number } };
	assert.equal(tail.tokenUsage?.input, 20, 'the second sample replaces the first');
	assert.equal(tail.tokenUsage?.output, 2);
});
test('turn/end 给出 turn-tail：收尾答复之后的工具使分支不可用', () => {
	const state = createDshIdeConversationState();
	const send = (event: Record<string, unknown>) => project(state, { type: 'event', event });
	send({ type: 'assistant/message', seq: 70, time: 70, turn: 1, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '答复' }] } } });
	let view = send({ type: 'turn/end', seq: 71, time: 71, data: { turn: 1, step: 1, reason: { kind: 'completed' } } });
	let tail = view.nodes.find(node => node.kind === 'turn-tail') as { turn: number; closing?: string; branchUnavailable?: true };
	assert.equal(tail.turn, 1);
	assert.equal(tail.closing, '答复');
	assert.equal(tail.branchUnavailable, undefined);
	// 同一 Turn 的两条答复增量在尾部聚合成一份用量。
	const usageTail = (() => {
		const state = createDshIdeConversationState();
		const send = (event: Record<string, unknown>) => project(state, { type: 'event', event });
		send({ type: 'turn/start', seq: 89, time: 89, data: { turn: 9 } });
		send({ type: 'assistant/message', seq: 90, time: 90, turn: 9, data: { turn: 9, step: 1, message: { content: [{ type: 'text', text: 'a' }], usage: { inputTokens: 2, outputTokens: 3 } } } });
		send({ type: 'assistant/message', seq: 91, time: 91, turn: 9, data: { turn: 9, step: 2, message: { content: [{ type: 'text', text: 'b' }], usage: { inputTokens: 4, outputTokens: 5, cacheReadTokens: 1 } } } });
		return send({ type: 'turn/end', seq: 92, time: 92, data: { turn: 9, step: 2, reason: { kind: 'completed' } } })
			.nodes.find(node => node.kind === 'turn-tail') as { tokenUsage?: { input?: number; output?: number; cacheRead?: number } };
	})();
	// 第一条答复没报缓存桶，按官方「每次尝试都报告才存在」，整桶作废。
	assert.deepEqual(usageTail.tokenUsage, { input: 6, output: 8 });
	// 官方 `TurnTokenUsage`：缓存/推理桶「只有每次尝试都报告时才存在」，任一次缺失整桶作废。
	const bucketDropped = (() => {
		const state = createDshIdeConversationState();
		const send = (event: Record<string, unknown>) => project(state, { type: 'event', event });
		send({ type: 'turn/start', seq: 99, time: 99, data: { turn: 20 } });
		send({ type: 'assistant/message', seq: 100, time: 100, turn: 20, data: { turn: 20, step: 1, message: { content: [{ type: 'text', text: 'a' }], usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 5, reasoningTokens: 2 } } } });
		send({ type: 'assistant/message', seq: 101, time: 101, turn: 20, data: { turn: 20, step: 2, message: { content: [{ type: 'text', text: 'b' }], usage: { inputTokens: 1, outputTokens: 1 } } } });
		return send({ type: 'turn/end', seq: 102, time: 102, data: { turn: 20, step: 2, reason: { kind: 'completed' } } })
			.nodes.find(node => node.kind === 'turn-tail') as { tokenUsage?: { cacheRead?: number; reasoning?: number } };
	})();
	assert.equal(bucketDropped.tokenUsage?.cacheRead, undefined, '一次缺缓存桶，整桶不该出现');
	assert.equal(bucketDropped.tokenUsage?.reasoning, undefined, '一次缺推理桶，整桶不该出现');
	// 官方 `TurnTailNodeView` 用 `closing.finalNode.messageId` 给动作行寻址。
	const closingId = (() => {
		const state = createDshIdeConversationState();
		const send = (event: Record<string, unknown>) => project(state, { type: 'event', event });
		send({ type: 'assistant/message', seq: 120, time: 120, turn: 11, data: { messageId: 'msg-1', turn: 11, step: 1, message: { content: [{ type: 'text', text: '答复' }] } } });
		return send({ type: 'turn/end', seq: 121, time: 121, data: { turn: 11, step: 1, reason: { kind: 'completed' } } })
			.nodes.find(node => node.kind === 'turn-tail') as { closingMessageId?: string };
	})();
	assert.equal(closingId.closingMessageId, 'msg-1');
	// 中断冻结的部分回复没有 messageId：官方此时不给动作行，这里也不给。
	const noClosingId = (() => {
		const state = createDshIdeConversationState();
		const send = (event: Record<string, unknown>) => project(state, { type: 'event', event });
		send({ type: 'assistant/message', seq: 122, time: 122, turn: 12, data: { turn: 12, step: 1, message: { content: [{ type: 'text', text: '半句' }] }, interrupted: true } });
		return send({ type: 'turn/end', seq: 123, time: 123, data: { turn: 12, step: 1, reason: { kind: 'interrupted' } } })
			.nodes.find(node => node.kind === 'turn-tail') as { closingMessageId?: string };
	})();
	assert.equal(noClosingId.closingMessageId, undefined);
	// 官方 `chat/turn-assistant.ts` 的 `assistantText` 是 `join('')`：多块正文直接拼接，不加分隔符。
	const multiBlock = (() => {
		const state = createDshIdeConversationState();
		const send = (event: Record<string, unknown>) => project(state, { type: 'event', event });
		send({ type: 'assistant/message', seq: 124, time: 124, turn: 15, data: { messageId: 'm15', turn: 15, step: 1, message: { content: [{ type: 'text', text: '前半' }, { type: 'reasoning', text: '想一下' }, { type: 'text', text: '后半' }] } } });
		return send({ type: 'turn/end', seq: 125, time: 125, data: { turn: 15, step: 1, reason: { kind: 'completed' } } })
			.nodes.find(node => node.kind === 'turn-tail') as { closing?: string };
	})();
	assert.equal(multiBlock.closing, '前半后半');
	// 官方 `hasLaterChatNode`：收尾答复之后若还有同 Turn 的实质节点，分支不可用；
	// `turn-max-tokens` 与 `turn-tail` / `turn-process` 本身不算（官方 skipWarning 同样跳过）。
	const laterNode = (() => {
		const state = createDshIdeConversationState();
		const send = (event: Record<string, unknown>) => project(state, { type: 'event', event });
		send({ type: 'assistant/message', seq: 130, time: 130, turn: 13, data: { messageId: 'm13', turn: 13, step: 1, message: { content: [{ type: 'text', text: '答复' }] } } });
		send({ type: 'turn/end', seq: 131, time: 131, data: { turn: 13, step: 1, reason: { kind: 'max-tokens' } } });
		return send({ type: 'turn/end', seq: 132, time: 132, data: { turn: 13, step: 1, reason: { kind: 'completed' } } })
			.nodes.find(node => node.kind === 'turn-tail') as { branchUnavailable?: true };
	})();
	assert.equal(laterNode.branchUnavailable, undefined, '只有 turn-max-tokens 时分支仍可用');
	// 过程组节点与尾部同批产出：锚点、计数与固定 false 的 inlineReasoning。
	const processTail = (() => {
		const state = createDshIdeConversationState();
		const send = (event: Record<string, unknown>) => project(state, { type: 'event', event });
		send({ type: 'user/message', seq: 95, time: 95, data: { id: 'm', source: { kind: 'user' }, content: [{ type: 'text', text: 'q' }] } });
		send({ type: 'assistant/message', seq: 96, time: 96, turn: 10, data: { turn: 10, step: 1, message: { content: [{ type: 'text', text: 'a' }] } } });
		send({ type: 'tool/call', seq: 97, time: 97, data: { turn: 10, callId: 'c1', name: 'subagent', phase: 'start', arguments: '{}' } });
		send({ type: 'assistant/message', seq: 98, time: 98, turn: 10, data: { turn: 10, step: 2, message: { content: [{ type: 'text', text: 'b' }] } } });
		return send({ type: 'turn/end', seq: 99, time: 99, data: { turn: 10, step: 2, reason: { kind: 'completed' } } })
			.nodes.find(node => node.kind === 'turn-process') as {
				processStartSeq?: number; answerAnchorSeq?: number; answerStep: number;
				inlineReasoning: boolean; messageCount: number; toolCallCount: number; subagentCount: number;
			};
	})();
	assert.equal(processTail.processStartSeq, 97);
	assert.equal(processTail.answerAnchorSeq, 96);
	assert.equal(processTail.answerStep, 2);
	assert.equal(processTail.inlineReasoning, false);
	// 官方 `messageCount` 只数最终答复**之前**的助手消息：该 Turn 有 2 条助手，
	// 最后一条是最终答复，所以是 1。
	assert.equal(processTail.messageCount, 1);
	// 该 Turn 只调了一次 `subagent`：按官方「non-subagent」口径，toolCallCount 是 0。
	assert.equal(processTail.toolCallCount, 0);
	assert.equal(processTail.subagentCount, 1);
	// 官方 `TurnProcessSpec.toolCallCount` 是「Durable **non-subagent** Tool calls」：
	// 子代理委派只进 subagentCount，不能同时算成普通工具调用。
	const overlap = (() => {
		const state = createDshIdeConversationState();
		const send = (event: Record<string, unknown>) => project(state, { type: 'event', event });
		send({ type: 'assistant/message', seq: 140, time: 140, turn: 14, data: { turn: 14, step: 1, message: { content: [{ type: 'text', text: 'a' }] } } });
		send({ type: 'tool/call', seq: 141, time: 141, data: { turn: 14, callId: 's1', name: 'subagent', phase: 'start', arguments: '{}' } });
		send({ type: 'tool/call', seq: 142, time: 142, data: { turn: 14, callId: 'r1', name: 'read', phase: 'start', arguments: '{}' } });
		return send({ type: 'turn/end', seq: 143, time: 143, data: { turn: 14, step: 1, reason: { kind: 'completed' } } })
			.nodes.find(node => node.kind === 'turn-process') as { toolCallCount: number; subagentCount: number };
	})();
	assert.equal(overlap.subagentCount, 1);
	assert.equal(overlap.toolCallCount, 1, '只有 read 计入 toolCallCount');
	// 答复之后又有工具：分支不可用。
	send({ type: 'assistant/message', seq: 72, time: 72, turn: 2, data: { turn: 2, step: 1, message: { content: [{ type: 'text', text: '第二答' }] } } });
	send({ type: 'tool/call', seq: 73, time: 73, data: { turn: 2, callId: 'c1', name: 'read', phase: 'start', arguments: '{}' } });
	view = send({ type: 'turn/end', seq: 74, time: 74, data: { turn: 2, step: 1, reason: { kind: 'completed' } } });
	tail = view.nodes.find(node => node.kind === 'turn-tail' && (node as { turn: number }).turn === 2) as { closing?: string; branchUnavailable?: true };
	assert.equal(tail.closing, '第二答');
	assert.equal(tail.branchUnavailable, true);
	// 没有答复的 Turn：分支必然不可用。
	view = send({ type: 'turn/end', seq: 75, time: 75, data: { turn: 3, step: 1, reason: { kind: 'completed' } } });
	const bare = view.nodes.find(node => node.kind === 'turn-tail' && (node as { turn: number }).turn === 3) as { closing?: string; branchUnavailable?: true };
	assert.equal(bare.closing, undefined);
	assert.equal(bare.branchUnavailable, true);
	// 出错的 Turn 同样不可用。
	view = send({ type: 'turn/end', seq: 76, time: 76, data: { turn: 4, step: 1, reason: { kind: 'error', failure: { message: 'boom' } } } });
	const failed = view.nodes.find(node => node.kind === 'turn-tail' && (node as { turn: number }).turn === 4) as { branchUnavailable?: true };
	assert.equal(failed.branchUnavailable, true);
});

test('system/message 的 append 生成 system-prompt，文本变化标成更新', () => {
	const state = createDshIdeConversationState();
	const send = (seq: number, text: string) => project(state, {
		type: 'event',
		event: { type: 'system/message', seq, time: seq, surfaceOp: 'append', data: { content: [{ type: 'text', text }] } },
	});
	let view = send(60, '规则一');
	assert.deepEqual(view.nodes.map(node => node.kind), ['system-prompt']);
	assert.equal((view.nodes[0] as { update?: true }).update, undefined);
	view = send(61, '规则一');
	// 官方的每一次非空 append 都拥有一张提示卡；文本没变时不算更新。
	assert.equal(view.nodes.length, 2);
	assert.equal(view.nodes.every(node => (node as { update?: true }).update === undefined), true);
	view = send(62, '规则二');
	const latest = view.nodes.at(-1) as { text: string; update?: true };
	assert.equal(latest.text, '规则二');
	assert.equal(latest.update, true);
	// 非 append 的替换不产生新卡片。
	const replaced = project(createDshIdeConversationState(), {
		type: 'event',
		event: { type: 'system/message', seq: 63, time: 63, surfaceOp: 'replace', data: { content: [{ type: 'text', text: '替换' }] } },
	});
	assert.deepEqual(replaced.nodes, []);
});

test('tool-workflow 事件折叠成 workflow-run，成员状态随结算更新', () => {
	const state = createDshIdeConversationState();
	const run = (event: Record<string, unknown>) => project(state, { type: 'event', event });
	run({ type: 'tool-workflow/run-start', seq: 50, time: 50, data: { runId: 'r1', name: 'audit' } });
	let view = run({ type: 'tool-workflow/agent-start', seq: 51, time: 51, data: { runId: 'r1', seq: 1, label: '扫描', childId: 'child-1', phase: 'a' } });
	assert.equal(view.nodes.length, 1);
	assert.equal(view.nodes[0].kind, 'workflow-run');
	run({ type: 'tool-workflow/agent-start', seq: 52, time: 52, data: { runId: 'r1', seq: 2, label: '复核', childId: 'child-2' } });
	run({ type: 'tool-workflow/agent-end', seq: 53, time: 53, data: { runId: 'r1', seq: 1, outcome: 'completed' } });
	view = run({ type: 'tool-workflow/run-end', seq: 54, time: 54, data: { runId: 'r1', stopReason: 'completed' } });
	const node = view.nodes[0] as { name: string; status: string; phases: { phase: string | null; members: { label: string; status: string }[] }[] };
	assert.equal(node.name, 'audit');
	assert.equal(node.status, 'completed');
	assert.deepEqual(node.phases.map(phase => phase.phase), ['a', null]);
	assert.deepEqual(node.phases[0].members, [{ seq: 1, label: '扫描', childId: 'child-1', status: 'completed' }]);
	assert.equal(node.phases[1].members[0].status, 'running');
	// Turn 被中断且没有 run-end：未结束的运行与成员转成 interrupted（官方 turnAbandoned）。
	const interrupted = createDshIdeConversationState();
	const runInterrupted = (event: Record<string, unknown>) => project(interrupted, { type: 'event', event });
	runInterrupted({ type: 'tool-workflow/run-start', seq: 55, time: 55, turn: 3, data: { runId: 'r2', name: 'audit' } });
	runInterrupted({ type: 'tool-workflow/agent-start', seq: 56, time: 56, turn: 3, data: { runId: 'r2', seq: 1, label: '扫描', childId: 'child' } });
	const afterInterrupt = runInterrupted({ type: 'turn/end', seq: 57, time: 57, data: { turn: 3, step: 1, reason: { kind: 'interrupted' } } });
	const interruptedNode = afterInterrupt.nodes.find(item => item.kind === 'workflow-run') as { status: string; phases: { members: { status: string }[] }[] };
	assert.equal(interruptedNode.status, 'interrupted');
	assert.equal(interruptedNode.phases[0].members[0].status, 'interrupted');
});

test('exit_plan_mode 的带标题计划另成 submitted-plan，坏参数保留工具行', () => {
	const state = createDshIdeConversationState();
	const plan = '# 迁移计划\n先做 A。';
	const view = project(state, {
		type: 'event',
		event: {
			type: 'tool/call',
			seq: 40,
			time: 40,
			data: { callId: 'call-p', name: 'exit_plan_mode', phase: 'start', arguments: JSON.stringify({ plan }) },
		},
	});
	assert.deepEqual(view.nodes.map(node => node.kind).sort(), ['submitted-plan', 'tool-call']);
	const node = view.nodes.find(item => item.kind === 'submitted-plan') as { title: string; markdown: string; callId: string };
	assert.equal(node.title, '迁移计划');
	assert.equal(node.markdown, plan);
	assert.equal(node.callId, 'call-p');
	// 没有一级标题、或参数不是 JSON 的计划读不出来，保留普通工具行。
	for (const args of ['{"plan":"没有标题"}', '不是 JSON']) {
		const other = createDshIdeConversationState();
		const fallback = project(other, {
			type: 'event',
			event: { type: 'tool/call', seq: 41, time: 41, data: { callId: 'call-q', name: 'exit_plan_mode', phase: 'start', arguments: args } },
		});
		assert.deepEqual(fallback.nodes.map(item => item.kind), ['tool-call'], args);
	}
});

test('/goal 的人工输入另出 command-input，通用 command 行保留结果', () => {
	const state = createDshIdeConversationState();
	const view = project(state, {
		type: 'event',
		event: { type: 'command/run', seq: 30, time: 30, data: { commandId: 'c1', name: 'goal', rawInput: ' 完成目标  ' } },
	});
	assert.deepEqual(view.nodes.map(node => node.kind).sort(), ['command', 'command-input']);
	const input = view.nodes.find(node => node.kind === 'command-input') as { text: string; commandId: string };
	assert.equal(input.text, '/goal 完成目标');
	assert.equal(input.commandId, 'c1');
	// 其它命令不产生 command-input，避免把普通斜杠命令伪装成目标输入。
	const other = createDshIdeConversationState();
	const plain = project(other, {
		type: 'event',
		event: { type: 'command/run', seq: 31, time: 31, data: { commandId: 'c2', name: 'help', rawInput: '' } },
	});
	assert.deepEqual(plain.nodes.map(node => node.kind), ['command']);
});

test('ask_user_question 的整份回执取代工具卡，成为 question-reply', () => {
	const state = createDshIdeConversationState();
	const text = JSON.stringify({
		questions: [{ id: 'a', question: '继续吗', header: '确认' }],
		answers: [{ id: 'a', selected: ['继续'] }],
	});
	const view = project(state, {
		type: 'event',
		event: {
			type: 'tool/result',
			seq: 20,
			time: 20,
			turn: 1,
			data: {
				message: { source: { callId: 'call-1' }, content: [{ type: 'text', text }], isError: false },
				call: { name: 'ask_user_question', argsRaw: JSON.stringify({ questions: [{ id: 'a', question: '继续吗', header: '确认' }] }) },
			},
		},
	});
	assert.deepEqual(view.nodes.map(node => node.kind), ['question-reply']);
	const node = view.nodes[0] as { callId: string; questions: unknown[]; answers: unknown[]; text: string };
	assert.equal(node.callId, 'call-1');
	assert.equal(node.questions.length, 1);
	assert.deepEqual(node.answers, [{ id: 'a', selected: ['继续'] }]);
	assert.equal(node.text, text);
});

test('回执缺题、带 plan-review 或多块正文时保留普通工具卡', () => {
	const cases: readonly { args: unknown; text: string; blocks?: number }[] = [
		{ args: { questions: [{ id: 'a', question: 'q' }] }, text: JSON.stringify({ answers: [] }) },
		{ args: { questions: [{ id: 'p', question: 'q', intent: { kind: 'plan-review', approve: 'ok' } }] }, text: JSON.stringify({ answers: [{ id: 'p', selected: ['ok'] }] }) },
		{ args: { questions: [{ id: 'a', question: 'q' }] }, text: JSON.stringify({ answers: [{ id: 'a', selected: [] }], pending: true }) },
	];
	for (const item of cases) {
		const state = createDshIdeConversationState();
		const view = project(state, {
			type: 'event',
			event: {
				type: 'tool/result',
				seq: 21,
				time: 21,
				turn: 1,
				data: {
					message: { source: { callId: 'call-2' }, content: [{ type: 'text', text: item.text }], isError: false },
					call: { name: 'ask_user_question', argsRaw: JSON.stringify(item.args) },
				},
			},
		});
		assert.deepEqual(view.nodes.map(node => node.kind), ['tool-result'], JSON.stringify(item));
	}
});

test('迟到的人工回执也投影为 question-reply，不冒充普通用户消息', () => {
	const state = createDshIdeConversationState();
	const text = JSON.stringify({
		questions: [{ id: 'b', question: '第二题' }],
		answers: [{ id: 'b', selected: [], custom: '自己写的' }],
	});
	const view = project(state, {
		type: 'event',
		event: {
			type: 'user/message',
			seq: 22,
			time: 22,
			data: {
				id: 'm-1',
				source: { kind: 'user-question-reply', callId: 'call-3', outcome: 'answered' },
				content: [{ type: 'text', text }],
			},
		},
	});
	assert.deepEqual(view.nodes.map(node => node.kind), ['question-reply']);
	// 没有 outcome=answered 的迟到消息不得被认领；非 user 来源按既有规则归入 context。
	const other = createDshIdeConversationState();
	const fallback = project(other, {
		type: 'event',
		event: {
			type: 'user/message',
			seq: 23,
			time: 23,
			data: { id: 'm-2', source: { kind: 'user-question-reply', callId: 'call-4' }, content: [{ type: 'text', text }] },
		},
	});
	assert.deepEqual(fallback.nodes.map(node => node.kind), ['context']);
});

test('attachments 从消息 content 收集图片引用并去重', () => {
	const image = { attachmentId: 'img-1', mediaType: 'image/png', bytes: 3, width: 1, height: 1 };
	const state = createDshIdeConversationState();
	project(state, {
		type: 'snapshot',
		hasMore: false,
		records: [
			{
				type: 'event',
				event: {
					type: 'user/message',
					seq: 20,
					time: 20,
					data: { source: { kind: 'user' }, content: [{ type: 'text', text: '看图' }, { type: 'image', attachment: image }] },
				},
			},
			{
				type: 'event',
				event: {
					type: 'user/message',
					seq: 21,
					time: 21,
					data: { source: { kind: 'user' }, content: [{ type: 'image', attachment: image }] },
				},
			},
		],
	});
	const attachments = attachmentsOf(state);
	assert.equal(attachments.length, 1, 'same attachmentId must be deduplicated');
	assert.deepEqual(attachments[0], image);
	// 附件字段也必须过协议校验。
	validateDshIdeSnapshot({
		wireRevision: DSH_IDE_WIRE_REVISION,
		channelId: 'c1',
		binding: { viewId: 'c1', generation: 1, sessionId: null },
		version: 1,
		state: { state: 'ready', view: { frame: { type: 'snapshot' }, attachments } },
	});
});

test('assistant-stream end then assistant/message keeps one node for that turn', () => {
	const state = createDshIdeConversationState();
	project(state, { type: 'assistant-stream', frame: { type: 'start', attemptId: 'a1', revision: 1, turn: 1, step: 0 } });
	const streaming = project(state, {
		type: 'assistant-stream',
		frame: { type: 'chunk', attemptId: 'a1', revision: 2, chunk: { type: 'text-delta', text: '临时' } },
	});
	assert.equal(streaming.nodes.filter(node => node.kind === 'assistant').length, 1);
	const ended = project(state, {
		type: 'assistant-stream',
		frame: { type: 'end', attemptId: 'a1', revision: 3, outcome: { kind: 'completed' } },
	});
	assert.equal(ended.nodes.filter(node => node.kind === 'assistant').length, 1, 'text stays visible until the durable message arrives');
	const done = project(state, {
		type: 'event',
		event: {
			type: 'assistant/message',
			seq: 5,
			time: 5,
			data: { turn: 1, step: 0, message: { content: [{ type: 'text', text: '正式回复' }] } },
		},
	});
	const assistants = done.nodes.filter(node => node.kind === 'assistant');
	assert.equal(assistants.length, 1);
	const only = assistants[0];
	assert.ok(only !== undefined && only.kind === 'assistant');
	if (only !== undefined && only.kind === 'assistant') {
		assert.deepEqual(only.blocks, [{ kind: 'text', text: '正式回复' }]);
	}
});

test('an abandoned assistant-stream removes its temporary node', () => {
	const state = createDshIdeConversationState();
	project(state, { type: 'assistant-stream', frame: { type: 'start', attemptId: 'a2', revision: 1, turn: 2, step: 0 } });
	project(state, {
		type: 'assistant-stream',
		frame: { type: 'chunk', attemptId: 'a2', revision: 2, chunk: { type: 'text-delta', text: '丢掉' } },
	});
	const view = project(state, {
		type: 'assistant-stream',
		frame: { type: 'end', attemptId: 'a2', revision: 3, outcome: { kind: 'abandoned' } },
	});
	assert.equal(view.nodes.length, 0);
});

test('assistant/message 带 text content 投影为 assistant 节点且 step 为数字', () => {
	const state = createDshIdeConversationState();
	const frame = {
		type: 'event',
		event: {
			type: 'assistant/message',
			seq: 5,
			time: 5,
			data: { turn: 1, step: 2, message: { content: [{ type: 'text', text: 'hello' }] } },
		},
	};
	const view = project(state, frame);
	assert.equal(view.nodes.length, 1);
	assert.equal(view.nodes[0].kind, 'assistant');
	const assistant = view.nodes[0];
	if (assistant.kind === 'assistant') {
		assert.equal(assistant.turn, 1);
		assert.equal(typeof assistant.step, 'number');
		assert.equal(assistant.step, 2);
		assert.deepEqual(assistant.blocks, [{ kind: 'text', text: 'hello' }]);
	}
	assertNoRaw(view);
});

test('2-E 真机缺陷回归：配对调用不在窗口内时 tool-result 的 name 为空串仍须通过校验', () => {
	// 真机现象：开发板连上 Host 后通知「DSH-IDE 帧被拒绝（dsh-ide/invalid-argument :
	// DshIdeSnapshot.state.view.conversation.nodes[3].name must be a non-empty string）」。
	// 官方语义：`ToolResultNode.name` 是「配对 tool/call 已离开加载窗口时为空」
	// （`ui-conversation/src/client/contract/records.ts:169`）；`rootResult` 也给 `name: previous?.name ?? ''`。
	// 这条用例直接钉住：官方合法形态必须过校验，且 call 降级为 null。
	const state = createDshIdeConversationState();
	const frame = {
		type: 'event',
		event: {
			type: 'tool/result',
			seq: 4,
			time: 4,
			data: { message: { source: { callId: 'orphan-1' }, content: [{ type: 'text', text: 'done' }], isError: false } },
		},
	};
	const view = project(state, frame);
	assert.equal(view.nodes.length, 1);
	const node = view.nodes[0];
	assert.equal(node.kind, 'tool-result');
	if (node.kind === 'tool-result') {
		assert.equal(node.name, '', 'empty name is the official shape when the call head left the window');
		assert.equal(node.call, null, 'no call head to backfill when the call left the window');
	}
});

test('2-E 真机缺陷回归：有配对调用时 tool-result 仍带 name 与 call 头', () => {
	const state = createDshIdeConversationState();
	const frame = {
		type: 'event',
		event: {
			type: 'tool/result',
			seq: 5,
			time: 5,
			data: {
				call: { name: 'read', argsRaw: '{"path":"a"}' },
				message: { source: { callId: 'c9' }, content: [{ type: 'text', text: 'ok' }], isError: false },
			},
		},
	};
	const view = project(state, frame);
	const node = view.nodes[0];
	assert.equal(node.kind, 'tool-result');
	if (node.kind === 'tool-result') {
		assert.equal(node.name, 'read');
		assert.deepEqual(node.call, { name: 'read', argsRaw: '{"path":"a"}' });
	}
});

test('llm/retry 的 delayMs 可以是小数，整帧仍能通过校验', () => {
	const state = createDshIdeConversationState();
	const frame = {
		type: 'event',
		event: {
			type: 'llm/retry',
			seq: 8,
			time: 8,
			data: { retry: 1, maxRetries: 5, delayMs: 459.98018830311815, mode: 'normal' },
		},
	};
	const view = project(state, frame);
	const node = view.nodes[0];
	assert.equal(node.kind, 'model-retry');
	if (node.kind === 'model-retry') {
		assert.equal(node.delayMs, 459.98018830311815);
	}
});

test('a compaction summary given as content blocks is not dropped', () => {
	// 官方 `compaction/summary` 的 `data.summary` 是 `[{type:'text',text}]`。
	// 旧实现只认字符串，导致压缩卡永远没有摘要（`typeof data.summary === 'string'` 恒假）。
	const state = createDshIdeConversationState();
	const project = (event: Record<string, unknown>) => projectDshIdeConversation(state, { type: 'event', event });
	const view = project({
		type: 'compaction/summary', seq: 5, time: 5,
		data: { summary: [{ type: 'text', text: '第一段' }, { type: 'image' }, { type: 'text', text: '第二段' }], shadowedItemCount: 2 },
	});
	const node = view.nodes.find(entry => entry.kind === 'compaction') as { summary: string | null } | undefined;
	assert.ok(node !== undefined, 'the compaction node must exist');
	assert.equal(node.summary, '第一段\n第二段', 'block text must be joined, non-text blocks skipped');
	// 缺 summary 时仍是 null，不编造空字符串。
	const second = project({ type: 'compaction/summary', seq: 6, time: 6, data: { shadowedItemCount: 1 } });
	const empty = second.nodes.find(entry => entry.kind === 'compaction' && entry.seq === 6) as { summary: string | null } | undefined;
	assert.equal(empty?.summary, null);
});

test('assistant/attempt usage chunks are counted, not only assistant/message', () => {
	// 官方 `usageOf()` 同时对 `assistant/attempt` 生效：读 `data.stream` 里最后一个 usage chunk。
	// 漏接时，只有 attempt 的用量（重试链里被覆盖的那次）会整个丢掉。
	const state = createDshIdeConversationState();
	const project = (event: Record<string, unknown>) => projectDshIdeConversation(state, { type: 'event', event });
	project({ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } });
	project({
		type: 'assistant/attempt', seq: 2, time: 2, data: {
			turn: 1, step: 0,
			stream: [
				{ chunk: { type: 'text', text: 'x' } },
				// 最后一个 usage 才是最终样本；前面的中途样本不能算总量。
				{ chunk: { type: 'usage', usage: { inputTokens: 3, outputTokens: 1 } } },
				{ chunk: { type: 'usage', usage: { inputTokens: 7, outputTokens: 2, cacheReadTokens: 5 } } },
			],
		},
	});
	project({ type: 'turn/end', seq: 3, time: 3, data: { turn: 1, reason: { kind: 'completed' } } });
	const tail = project({ type: 'turn/end', seq: 3, time: 3, data: { turn: 1, reason: { kind: 'completed' } } })
		.nodes.find(node => node.kind === 'turn-tail') as { tokenUsage?: { input?: number; output?: number; cacheRead?: number } } | undefined;
	assert.equal(tail?.tokenUsage?.input, 7, 'the last usage chunk must win, not the first');
	assert.equal(tail?.tokenUsage?.output, 2);
	assert.equal(tail?.tokenUsage?.cacheRead, 5);
});

test('llm/retry-started clears the replacement slot so the retried attempt counts again', () => {
	// 官方：`llm/retry-started` 清空同 (turn, step) 的 last 槽；否则「同 step 重试」会被当成
	// 「同一 step 再报一次」而替换掉，总量比官方偏小。
	const state = createDshIdeConversationState();
	const project = (event: Record<string, unknown>) => projectDshIdeConversation(state, { type: 'event', event });
	project({ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } });
	project({ type: 'assistant/message', seq: 2, time: 2, data: { turn: 1, step: 0, message: { content: [{ type: 'text', text: 'first' }] }, usage: { inputTokens: 10, outputTokens: 1 } } });
	// 同 step 的 retry-started：槽清空，下一次样本应「新增」而不是「替换」。
	project({ type: 'llm/retry-started', seq: 3, time: 3, data: { turn: 1, step: 0 } });
	project({ type: 'assistant/message', seq: 4, time: 4, data: { turn: 1, step: 0, message: { content: [{ type: 'text', text: 'second' }] }, usage: { inputTokens: 20, outputTokens: 2 } } });
	const tail = project({ type: 'turn/end', seq: 5, time: 5, data: { turn: 1, reason: { kind: 'completed' } } })
		.nodes.find(node => node.kind === 'turn-tail') as { tokenUsage?: { input?: number; output?: number } } | undefined;
	assert.equal(tail?.tokenUsage?.input, 30, 'after a retry-started, both attempts count');
	assert.equal(tail?.tokenUsage?.output, 3);
});

test('an attempt sample and the same step\'s message sample replace instead of stacking', () => {
	// 官方为什么需要 `addReplacing`：`assistant/attempt` 与随后同 step 的 `assistant/message`
	// 会各报一次用量，纯累加会把同一次尝试算两遍。同 (turn, step) 的后者必须**替换**前者。
	const state = createDshIdeConversationState();
	const project = (event: Record<string, unknown>) => projectDshIdeConversation(state, { type: 'event', event });
	project({ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } });
	project({
		type: 'assistant/attempt', seq: 2, time: 2,
		data: { turn: 1, step: 0, stream: [{ chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 1 } } }] },
	});
	project({
		type: 'assistant/message', seq: 3, time: 3,
		data: { turn: 1, step: 0, message: { content: [{ type: 'text', text: 'final' }] }, usage: { inputTokens: 12, outputTokens: 2 } },
	});
	const tail = project({ type: 'turn/end', seq: 4, time: 4, data: { turn: 1, reason: { kind: 'completed' } } })
		.nodes.find(node => node.kind === 'turn-tail') as { tokenUsage?: { input?: number; output?: number } } | undefined;
	assert.equal(tail?.tokenUsage?.input, 12, 'the message sample replaces the attempt sample, not adds to it');
	assert.equal(tail?.tokenUsage?.output, 2);
});

test('usage is hidden when the loaded window has no turn/start', () => {
	// 官方 README「Turn token usage」：只有 loaded window **包含 turn/start** 时才有展开用量行。
	// 窗口从中间切进来时累计值缺头部样本，必须整份隐藏而不是给一个偏小的数字。
	const state = createDshIdeConversationState();
	const project = (event: Record<string, unknown>) => projectDshIdeConversation(state, { type: 'event', event });
	// 故意不发 turn/start。
	project({ type: 'assistant/message', seq: 2, time: 2, data: { turn: 1, step: 0, message: { content: [{ type: 'text', text: 'a' }] }, usage: { inputTokens: 10, outputTokens: 1 } } });
	const tail = project({ type: 'turn/end', seq: 3, time: 3, data: { turn: 1, reason: { kind: 'completed' } } })
		.nodes.find(node => node.kind === 'turn-tail') as { tokenUsage?: unknown } | undefined;
	assert.equal(tail?.tokenUsage, undefined, 'without turn/start the whole usage disclosure must be hidden');
});

test('usage is hidden when a started attempt reports no usage at all', () => {
	// 官方：「every started model attempt reports safe, exact usage」——有 attempt 没报用量时
	// 整份隐藏，而不是把缺的那次当 0（那会给出一个偏小的总数）。
	const state = createDshIdeConversationState();
	const project = (event: Record<string, unknown>) => projectDshIdeConversation(state, { type: 'event', event });
	project({ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } });
	// 第一条报用量；第二条是已开始的 attempt 但 stream 里没有 usage。
	project({ type: 'assistant/message', seq: 2, time: 2, data: { turn: 1, step: 0, message: { content: [{ type: 'text', text: 'a' }] }, usage: { inputTokens: 10, outputTokens: 1 } } });
	project({ type: 'assistant/attempt', seq: 3, time: 3, data: { turn: 1, step: 1, stream: [{ chunk: { type: 'text', text: 'partial' } }] } });
	const tail = project({ type: 'turn/end', seq: 4, time: 4, data: { turn: 1, reason: { kind: 'completed' } } })
		.nodes.find(node => node.kind === 'turn-tail') as { tokenUsage?: unknown } | undefined;
	assert.equal(tail?.tokenUsage, undefined, 'incomplete accounting must hide the whole disclosure');
});

test('usage is shown when turn/start is present and every attempt reports usage', () => {
	// 反向确认：两条条件都满足时必须**照常显示**，不能因为加了守卫就永远隐藏。
	const state = createDshIdeConversationState();
	const project = (event: Record<string, unknown>) => projectDshIdeConversation(state, { type: 'event', event });
	project({ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } });
	project({ type: 'assistant/message', seq: 2, time: 2, data: { turn: 1, step: 0, message: { content: [{ type: 'text', text: 'a' }] }, usage: { inputTokens: 10, outputTokens: 1 } } });
	project({ type: 'assistant/message', seq: 3, time: 3, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'b' }] }, usage: { inputTokens: 5, outputTokens: 2 } } });
	const tail = project({ type: 'turn/end', seq: 4, time: 4, data: { turn: 1, reason: { kind: 'completed' } } })
		.nodes.find(node => node.kind === 'turn-tail') as { tokenUsage?: { input?: number; output?: number } } | undefined;
	assert.equal(tail?.tokenUsage?.input, 15);
	assert.equal(tail?.tokenUsage?.output, 3);
});

test('turn/end reason reaches the turn-process node so folding can use it', () => {
	// 折叠判定要用官方 `turn.end.data.reason.kind`（`turnProcessAlwaysOpen` 的判据）。
	// 投影层必须把它带到 `turn-process` 节点上，否则渲染层只能猜（旧实现就是永远走 fallback）。
	const state = createDshIdeConversationState();
	const project = (event: Record<string, unknown>) => projectDshIdeConversation(state, { type: 'event', event });
	project({ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } });
	project({ type: 'tool/call', seq: 2, time: 2, data: { turn: 1, step: 0, callId: 'c1', name: 'read' } });
	// `turn-process` 只在有答复锚点时成形（官方同样以最终答复为界），所以这里要有 assistant。
	project({ type: 'assistant/message', seq: 3, time: 3, data: { turn: 1, step: 0, message: { content: [{ type: 'text', text: 'done' }] } } });
	const ended = project({ type: 'turn/end', seq: 4, time: 4, data: { turn: 1, reason: { kind: 'completed' } } });
	const turnProcess = ended.nodes.find(node => node.kind === 'turn-process') as { endReason?: string } | undefined;
	assert.equal(turnProcess?.endReason, 'completed', 'the settled reason must ride on the turn-process node');

	// 仍在进行（没有 turn/end）的 Turn 不带该字段——渲染层据此判「不可收起」。
	const running = createDshIdeConversationState();
	const projectRunning = (event: Record<string, unknown>) => projectDshIdeConversation(running, { type: 'event', event });
	projectRunning({ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } });
	projectRunning({ type: 'assistant/message', seq: 2, time: 2, data: { turn: 1, step: 0, message: { content: [{ type: 'text', text: 'partial' }] } } });
	const live = projectRunning({ type: 'assistant/attempt', seq: 3, time: 3, data: { turn: 1, step: 1, stream: [] } });
	assert.equal((live.nodes.find(node => node.kind === 'turn-process') as { endReason?: string } | undefined)?.endReason, undefined,
		'a running turn must not carry an end reason');
});

test('protocol rejects an empty endReason on turn-process', async () => {
	// 新字段必须和协议其它字符串一样 fail-closed：空串不是「没有」，而是坏数据。
	// 用真实投影产出做基底，避免手写 snapshot 缺字段导致「因别的原因抛错」的假绿。
	const { validateDshIdeSnapshot } = await import('../../../src/vs/platform/dshClient/protocol/dshIdeProtocol.ts');
	const state = createDshIdeConversationState();
	const project = (event: Record<string, unknown>) => projectDshIdeConversation(state, { type: 'event', event });
	project({ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } });
	project({ type: 'assistant/message', seq: 2, time: 2, data: { turn: 1, step: 0, message: { content: [{ type: 'text', text: 'done' }] } } });
	const view = project({ type: 'turn/end', seq: 3, time: 3, data: { turn: 1, reason: { kind: 'completed' } } });
	const node = view.nodes.find(entry => entry.kind === 'turn-process');
	assert.ok(node !== undefined, 'the projection must produce a turn-process node');
	const snapshot = (endReason: string | undefined) => ({
		wireRevision: 5, channelId: 'c1', version: 1,
		binding: { viewId: 'c1', generation: 1, sessionId: 's1' },
		state: { state: 'ready', view: { frame: { type: 'snapshot' }, conversation: { ...view, nodes: [{ ...node, ...(endReason === undefined ? {} : { endReason }) }] } } },
	});
	assert.doesNotThrow(() => validateDshIdeSnapshot(snapshot('completed')), 'a non-empty endReason must be accepted');
	assert.throws(() => validateDshIdeSnapshot(snapshot('')), /endReason/, 'an empty endReason must be rejected');
});

test('queued inbox messages keep their content blocks, not just ids', () => {
	// 官方 `agent/inbox/spliced` 的 `inserted` 是完整 `UserMessage[]`（`packages/core/agent/src/types.ts`
	// 的 `SessionEventMap['agent/inbox/spliced']`），每项带 `content`。历史实现只取 `id` + `sourceKind`，
	// 把已经拿到的正文/附件丢掉，于是「排队队列」看起来像数据源不足。
	const state = createDshIdeConversationState();
	const project = (event: Record<string, unknown>) => projectDshIdeConversation(state, { type: 'event', event });
	const view = project({
		type: 'agent/inbox/spliced', seq: 1, time: 1,
		data: {
			target: 'next-turn', start: 0, inserted: [
				{ id: 'm1', content: [{ type: 'text', text: '排队的问题' }], source: { kind: 'user' } },
				{ id: 'm2', content: [{ type: 'image', attachment: { attachmentId: 'a1', mediaType: 'image/png', name: 'shot.png' } }], source: { kind: 'user' } },
			],
		},
	});
	assert.equal(view.inboxNextTurn?.length, 2);
	assert.equal(view.inboxNextTurn?.[0].id, 'm1');
	assert.deepEqual(view.inboxNextTurn?.[0].content, [{ type: 'text', text: '排队的问题' }]);
	// 图片块原样保留（含 attachment 结构），不在投影层翻译成字符串。
	assert.equal(view.inboxNextTurn?.[1].content[0]['type'], 'image');
	assert.deepEqual((view.inboxNextTurn?.[1].content[0] as { attachment: unknown }).attachment,
		{ attachmentId: 'a1', mediaType: 'image/png', name: 'shot.png' });
	// 空队列省略字段，不写空数组。
	assert.equal(view.inboxNextStep, undefined);
});

test('a canceled splice does not invent queued rows, and next-step stays separate', () => {
	const state = createDshIdeConversationState();
	const project = (event: Record<string, unknown>) => projectDshIdeConversation(state, { type: 'event', event });
	project({ type: 'agent/inbox/spliced', seq: 1, time: 1, data: { target: 'next-turn', start: 0, inserted: [{ id: 'm1', content: [{ type: 'text', text: 'a' }], source: { kind: 'user' } }] } });
	const afterCancel = project({ type: 'agent/inbox/spliced', seq: 2, time: 2, data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' } });
	assert.equal(afterCancel.inboxNextTurn, undefined, 'a canceled removal must not leave a phantom row');
	const step = project({ type: 'agent/inbox/spliced', seq: 3, time: 3, data: { target: 'next-step', start: 0, inserted: [{ id: 'm2', content: [{ type: 'text', text: 'steer' }], source: { kind: 'user' } }] } });
	assert.equal(step.inboxNextStep?.length, 1);
	assert.equal(step.inboxNextTurn, undefined, 'the two queues stay separate');
});

test('protocol rejects a queued message without content blocks or with a duplicate id', async () => {
	const { validateDshIdeSnapshot } = await import('../../../src/vs/platform/dshClient/protocol/dshIdeProtocol.ts');
	const state = createDshIdeConversationState();
	const project = (event: Record<string, unknown>) => projectDshIdeConversation(state, { type: 'event', event });
	const view = project({ type: 'agent/inbox/spliced', seq: 1, time: 1, data: { target: 'next-turn', start: 0, inserted: [{ id: 'm1', content: [{ type: 'text', text: 'a' }], source: { kind: 'user' } }] } });
	const snapshot = (conversation: unknown) => ({
		wireRevision: 5, channelId: 'c1', version: 1,
		binding: { viewId: 'c1', generation: 1, sessionId: 's1' },
		state: { state: 'ready', view: { frame: { type: 'snapshot' }, conversation } },
	});
	assert.doesNotThrow(() => validateDshIdeSnapshot(snapshot(view)));
	// 块缺 type：拒绝。
	assert.throws(() => validateDshIdeSnapshot(snapshot({
		...view, inboxNextTurn: [{ id: 'm2', sourceKind: 'user', content: [{ text: 'no type' }] }],
	})), /type/, 'a block without a type must be rejected');
	// 重复 id：拒绝。
	assert.throws(() => validateDshIdeSnapshot(snapshot({
		...view, inboxNextTurn: [
			{ id: 'dup', sourceKind: 'user', content: [{ type: 'text', text: 'a' }] },
			{ id: 'dup', sourceKind: 'user', content: [{ type: 'text', text: 'b' }] },
		],
	})), /duplicates/, 'a duplicate queued id must be rejected');
});

test('only the latest inherited seed leaves one divider', () => {
	// 官方 `inheritedHistoryDefinition.buildViewNode` 取 `context.matches.at(-1)`：
	// 只在**最新**的 inherited seed 标记处放一个分界行，不是每个标记各放一个。
	// 历史分页会把更早的标记也载入；每个都画会在长 fork 历史里叠出一串重复分界。
	const state = createDshIdeConversationState();
	const project = (event: Record<string, unknown>) => projectDshIdeConversation(state, { type: 'event', event });
	project({ type: 'session/end-seed', seq: 1, time: 1, data: { inherited: true } });
	const second = project({ type: 'session/end-seed', seq: 2, time: 2, data: { inherited: true } });
	const dividers = second.nodes.filter(node => node.kind === 'inherited-history');
	assert.equal(dividers.length, 1, 'only one divider must survive');
	assert.equal(dividers[0].seq, 2, 'and it is the latest marker');
	// 非 inherited 的 seed 不产生分界行。
	const plain = project({ type: 'session/end-seed', seq: 3, time: 3, data: { inherited: false } });
	assert.equal(plain.nodes.filter(node => node.kind === 'inherited-history').length, 1, 'a plain seed adds no divider');
});

test('an interrupted turn is marked structurally and carries no failure code', () => {
	// 官方「Command and failure rows」：restart recovery 关闭的 interrupted Turn 渲染本地化停止行，
	// 且**不带 code chip**——它不是内核报的错，给错误码只会误导用户去查不存在的失败。
	// 协议层零运行时依赖，不做本地化：只带结构化 interrupted 标记，由渲染层出文案。
	const state = createDshIdeConversationState();
	const project = (event: Record<string, unknown>) => projectDshIdeConversation(state, { type: 'event', event });
	project({ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } });
	const view = project({
		type: 'turn/end', seq: 2, time: 2,
		data: { turn: 1, step: 0, reason: { kind: 'interrupted', failure: { message: 'provider said x', code: 'ETIMEDOUT' } } },
	});
	const failed = view.nodes.find(node => node.kind === 'turn-error') as { interrupted?: true; code?: string; message?: string } | undefined;
	assert.equal(failed?.interrupted, true, 'the structural marker must be set');
	assert.equal(failed?.code, undefined, 'an interrupted turn must not carry a failure code');
	// 普通的 error 仍保留 code 与原消息。
	const state2 = createDshIdeConversationState();
	const project2 = (event: Record<string, unknown>) => projectDshIdeConversation(state2, { type: 'event', event });
	project2({ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } });
	const err = project2({ type: 'turn/end', seq: 2, time: 2, data: { turn: 1, step: 0, reason: { kind: 'error', failure: { message: 'boom', code: 'E1' } } } })
		.nodes.find(node => node.kind === 'turn-error') as { interrupted?: true; code?: string } | undefined;
	assert.equal(err?.interrupted, undefined);
	assert.equal(err?.code, 'E1');
});
