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
} from '../../../src/vs/platform/dshClient/common/dshIdeProtocol.ts';
import {
	attachmentsOf,
	createDshIdeConversationState,
	deliverablesOf,
	projectDshIdeConversation,
	quotaNoticeOf,
} from '../../../src/vs/platform/dshClient/common/dshIdeConversation.ts';

type ConversationState = ReturnType<typeof createDshIdeConversationState>;

/** 投影并过协议校验；frame 原样放进 view.frame，满足 ready 快照的最小形状。 */
function project(state: ConversationState, frame: Record<string, unknown>): DshIdeConversationView {
	const conversation = projectDshIdeConversation(state, frame);
	assert.ok(conversation !== undefined, 'frame should produce a conversation view');
	validateDshIdeSnapshot({
		wireRevision: DSH_IDE_WIRE_REVISION,
		channelId: 'c1',
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
	}
	assertNoRaw(view);
});

test('subagent/catalog version 3 投影为 catalog 节点且保留 name', () => {
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
	assert.equal(view.nodes.length, 1);
	assert.equal(view.nodes[0].kind, 'subagent-catalog');
	const catalog = view.nodes[0];
	if (catalog.kind === 'subagent-catalog') {
		assert.equal(catalog.name, 'reviewer');
		assert.equal(catalog.version, 3);
		assert.equal(catalog.childId, 'child-1');
		assert.equal(catalog.childCreatedAt, 5);
		assert.equal(catalog.mode, 'continuable');
	}
	assertNoRaw(view);
});

test('subagent-settled 的 user/message 投影为 notice 而非用户气泡', () => {
	const state = createDshIdeConversationState();
	const frame = {
		type: 'event',
		event: {
			type: 'user/message',
			seq: 3,
			time: 3,
			data: { source: { kind: 'subagent-settled' }, content: [{ type: 'text', text: 'relay' }] },
		},
	};
	const view = project(state, frame);
	assert.equal(view.nodes.length, 1);
	assert.equal(view.nodes[0].kind, 'subagent-notice');
	const notice = view.nodes[0];
	if (notice.kind === 'subagent-notice') {
		assert.deepEqual(notice.content, [{ type: 'text', text: 'relay' }]);
	}
	assertNoRaw(view);
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
		version: 1,
		state: { state: 'ready', view: { frame: { type: 'snapshot' }, attachments } },
	});
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
