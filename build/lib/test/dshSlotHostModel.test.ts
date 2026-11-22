/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// dshSlotHost：按 toHistory 的分段收成一个引用，工具行带上视图家族。
// 运行：node --experimental-strip-types --test build/lib/test/dshSlotHostModel.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatTokens, workflowStatusText } from '../../../src/vs/workbench/contrib/dsh/browser/vscode/dshTokenFormat.ts';
import { applyDshSlotHost, dshResponseNodeIds, dshSlotHostRef, dshSlotHostSame, planKeysForTurn, presentDshNode } from '../../../src/vs/workbench/contrib/dsh/browser/vscode/dshSlotHostModel.ts';
import { DSH_ASIDE_SLOT, DSH_ASSISTANT_ACTIONS_SLOT, DSH_MARKDOWN_FENCE_SLOT, DSH_NODE_SLOT, DSH_TEXT_INTERACTION_SLOT, DSH_USER_BEFORE_SLOT, dshAsideText, dshAssistantActions, dshChatSlotRegistry, dshMarkdownFenceOverride, dshNodeRowOverride, dshTextInteractions, dshUserBeforeDecoration } from '../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatSlots.ts';
import type { DshIndexedNode } from '../../../src/vs/workbench/contrib/dsh/browser/vscode/dshConversationNodeTree.ts';

function node(partial: DshIndexedNode & { text?: string; name?: string; argsRaw?: string; blocks?: readonly { kind: string; text: string }[] }): DshIndexedNode {
	return partial;
}

test('user boundaries and nested calls become one id list per response', () => {
	const ids = dshResponseNodeIds([
		node({ kind: 'user', seq: 1, messageId: 'u1' }),
		node({ kind: 'assistant', seq: 2, messageId: 'a1', blocks: [{ kind: 'text', text: 'hi' }] }),
		node({
			kind: 'tool-result',
			seq: 3,
			callId: 'c1',
			name: 'bash',
			subCalls: [node({ kind: 'tool-call', seq: 4, callId: 'c2', name: 'read' })],
		}),
		node({ kind: 'user', seq: 5, messageId: 'u2' }),
		node({ kind: 'turn-error', seq: 6, turn: 2, message: 'nope' } as DshIndexedNode),
	]);
	assert.deepEqual(ids, [
		['assistant:a1', 'tool-result:c1', 'tool-call:c2'],
		[],
	]);
});

test('a user plugin block joins that response and plain text still does not', () => {
	const ids = dshResponseNodeIds([
		node({ kind: 'user', seq: 1, messageId: 'u1', content: [{ type: 'plugin' }] } as DshIndexedNode),
		node({ kind: 'assistant', seq: 2, messageId: 'a1' }),
		node({ kind: 'user', seq: 3, messageId: 'u2', content: [{ type: 'text' }] } as DshIndexedNode),
		node({ kind: 'assistant', seq: 4, messageId: 'a2' }),
	]);
	assert.deepEqual(ids, [
		['user:u1', 'assistant:a1'],
		['assistant:a2'],
	]);
});

test('a user attachment is on that response and plain text users are not repeated', () => {
	const ids = dshResponseNodeIds([
		node({ kind: 'user', seq: 1, messageId: 'u1', content: [{ type: 'image' }] } as DshIndexedNode),
		node({ kind: 'assistant', seq: 2, messageId: 'a1' }),
		node({ kind: 'user', seq: 3, messageId: 'u2' }),
		node({ kind: 'assistant', seq: 4, messageId: 'a2' }),
	]);
	assert.deepEqual(ids, [
		['user:u1', 'assistant:a1'],
		['assistant:a2'],
	]);
});

test('assistant actions are addressed by the closing message id, not the assistant row', () => {
	// 官方 `TurnTailNodeView` 在 turn tail 内用 `closing.finalNode.messageId` 给动作行寻址。
	const first = dshChatSlotRegistry.register(DSH_ASSISTANT_ACTIONS_SLOT, {
		id: 'copy',
		props: { title: '复制', command: 'dsh.copyAnswer' },
	});
	try {
		assert.equal(dshAssistantActions('s1', 'msg-1').length, 1);
		// 中断冻结的部分回复没有 messageId：不寻址，也就不给动作行。
		assert.deepEqual(dshAssistantActions('s1', undefined), []);
	} finally {
		first.dispose();
	}
});

test('the aside single slot renders only when an occupant supplies text', () => {
	assert.equal(dshAsideText('s1'), undefined);
	const registration = dshChatSlotRegistry.register(DSH_ASIDE_SLOT, { id: 'aside', priority: 0, props: { text: '本次运行的临时说明' } });
	try {
		assert.equal(dshAsideText('s1'), '本次运行的临时说明');
		// session 作用域：没有会话 id 时不渲染。
		assert.equal(dshAsideText(undefined), undefined);
	} finally {
		registration.dispose();
	}
	assert.equal(dshAsideText('s1'), undefined);
});

test('text interactions are keyed by surface and skip entries without a command', () => {
	assert.deepEqual(dshTextInteractions('s1', 'assistant-markdown'), []);
	const explain = dshChatSlotRegistry.register(DSH_TEXT_INTERACTION_SLOT, {
		id: 'explain',
		key: 'assistant-markdown',
		order: 10,
		props: { title: '解释选中内容', command: 'dsh.explainSelection' },
	});
	const other = dshChatSlotRegistry.register(DSH_TEXT_INTERACTION_SLOT, {
		id: 'other',
		key: 'user-markdown',
		props: { title: '不应出现', command: 'dsh.other' },
	});
	const broken = dshChatSlotRegistry.register(DSH_TEXT_INTERACTION_SLOT, {
		id: 'broken',
		key: 'assistant-markdown-plain',
		props: { title: '缺命令' },
	});
	try {
		// 只有同 key 且字段齐全的条目出现；不同 surface 的不串。
		assert.deepEqual(dshTextInteractions('s1', 'assistant-markdown').map(item => item.id), ['explain']);
		assert.deepEqual(dshTextInteractions('s1', 'user-markdown').map(item => item.id), ['other']);
		assert.deepEqual(dshTextInteractions('s1', 'assistant-markdown')[0].command, 'dsh.explainSelection');
		// 缺 command 的 occupant 不成行，不画空按钮。
		assert.deepEqual(dshTextInteractions('s1', 'assistant-markdown-plain'), []);
	} finally {
		explain.dispose();
		other.dispose();
		broken.dispose();
	}
	assert.deepEqual(dshTextInteractions('s1', 'assistant-markdown'), []);
});

test('the user.before chain elects the first occupant that claims the message', () => {
	assert.equal(dshUserBeforeDecoration('s1', 'user', 'user'), undefined);
	const declines = dshChatSlotRegistry.register(DSH_USER_BEFORE_SLOT, {
		id: 'skill',
		select: () => null,
	});
	const claims = dshChatSlotRegistry.register(DSH_USER_BEFORE_SLOT, {
		id: 'user-tag',
		select: owner => owner.props?.['kind'] === 'user' ? '来自插件' : null,
	});
	try {
		assert.deepEqual(dshUserBeforeDecoration('s1', 'user', 'user'), { id: 'user-tag', label: '来自插件' });
		// 官方 `slots.ts`：steering 与 pending 行不渲染这个槽，即使 occupant 愿意认领。
		assert.equal(dshUserBeforeDecoration('s1', 'steering', 'user'), undefined);
	} finally {
		declines.dispose();
		claims.dispose();
	}
	assert.equal(dshUserBeforeDecoration('s1', 'user', 'user'), undefined);
});

test('assistant actions come from the list slot in order and skip incomplete entries', () => {
	assert.deepEqual(dshAssistantActions('s1', 'm1'), []);
	// 没有 messageId 的助手行不查槽位，避免把动作挂到无法识别的消息上。
	const first = dshChatSlotRegistry.register(DSH_ASSISTANT_ACTIONS_SLOT, {
		id: 'copy',
		order: 20,
		props: { title: '复制', command: 'dsh.copyAnswer', arguments: ['m1'] },
	});
	const second = dshChatSlotRegistry.register(DSH_ASSISTANT_ACTIONS_SLOT, {
		id: 'retry',
		order: 10,
		props: { title: '重试', command: 'dsh.retryTurn' },
	});
	const broken = dshChatSlotRegistry.register(DSH_ASSISTANT_ACTIONS_SLOT, { id: 'empty', order: 30, props: { title: '' } });
	try {
		assert.deepEqual(dshAssistantActions('s1', 'm1').map(action => action.id), ['retry', 'copy']);
		const copy = dshAssistantActions('s1', 'm1').find(action => action.id === 'copy');
		assert.deepEqual(copy?.arguments, ['m1']);
		assert.equal(dshAssistantActions('s1', undefined).length, 0);
	} finally {
		first.dispose();
		second.dispose();
		broken.dispose();
	}
	assert.deepEqual(dshAssistantActions('s1', 'm1'), []);
});

test('token counts use the official compact K/M form', () => {
	// 官方 `chat/token-format.ts` 的 `formatTokens`：<1000 原样，<1e6 用 K，否则 M；
	// 缩放后 >=100 取整，否则保留一位小数（12.2K / 517K / 1.2M）。
	assert.equal(formatTokens(0), '0');
	assert.equal(formatTokens(517), '517');
	assert.equal(formatTokens(999), '999');
	assert.equal(formatTokens(1000), '1K');
	assert.equal(formatTokens(12200), '12.2K');
	assert.equal(formatTokens(517000), '517K');
	assert.equal(formatTokens(1200000), '1.2M');
});

test('workflow statuses translate only the five known values', () => {
	// 未知状态原样显示：猜一个词比露出原词更容易误导。
	for (const status of ['running', 'completed', 'cancelled', 'failed', 'interrupted']) {
		assert.equal(workflowStatusText(status).length > 0, true, status);
	}
	assert.equal(workflowStatusText('paused'), 'paused');
});
test('a markdown fence occupant can take over one language', () => {
	// 官方 `conversation.chat.markdown.fence` 是 hoc 槽，key 是围栏 info。
	assert.equal(dshMarkdownFenceOverride('s1', 'mermaid'), undefined);
	const registration = dshChatSlotRegistry.register(DSH_MARKDOWN_FENCE_SLOT, {
		id: 'mermaid-layer',
		key: 'mermaid',
		props: { replacement: '（由插件渲染的图表）' },
	});
	try {
		assert.equal(dshMarkdownFenceOverride('s1', 'mermaid'), '（由插件渲染的图表）');
		// 其它语言不受影响，仍走原生 markdown。
		assert.equal(dshMarkdownFenceOverride('s1', 'typescript'), undefined);
		// session 作用域：无会话 id 时不接管。
		assert.equal(dshMarkdownFenceOverride(undefined, 'mermaid'), undefined);
	} finally {
		registration.dispose();
	}
	assert.equal(dshMarkdownFenceOverride('s1', 'mermaid'), undefined);
});
test('a plugin occupant of the keyed node slot overrides the built-in row', () => {
	const before = presentDshNode({ kind: 'compaction', seq: 1, summary: '摘要' } as DshIndexedNode, false, 's1');
	assert.equal(before.title, 'compaction');
	assert.equal(dshNodeRowOverride('compaction', 's1'), undefined);
	const registration = dshChatSlotRegistry.register(DSH_NODE_SLOT, {
		id: 'compact-row',
		key: 'compaction',
		props: { title: '上下文压缩', detail: '摘要', icon: 'archive' },
	});
	try {
		const after = presentDshNode({ kind: 'compaction', seq: 1, summary: '摘要' } as DshIndexedNode, false, 's1');
		assert.equal(after.title, '上下文压缩');
		assert.equal(after.icon, 'archive');
		assert.deepEqual(dshNodeRowOverride('compaction', 's1'), { title: '上下文压缩', detail: '摘要', icon: 'archive' });
		// 其它 kind 不走这条 occupant；没有会话时 session 槽为 unbound，也不覆盖。
		assert.equal(presentDshNode({ kind: 'turn-trigger', seq: 3 } as DshIndexedNode, false, 's1').title, 'turn-trigger');
		assert.equal(presentDshNode({ kind: 'compaction', seq: 2 } as DshIndexedNode).title, 'compaction');
	} finally {
		registration.dispose();
	}
	assert.equal(presentDshNode({ kind: 'compaction', seq: 4, summary: '摘要' } as DshIndexedNode, false, 's1').title, 'compaction');
});

test('plans are collected per turn for the tail, not for the flow', () => {
	const nodes = [
		{ key: 'p1', kind: 'submitted-plan', turn: 1 },
		{ key: 'p2', kind: 'submitted-plan', turn: 2 },
		{ key: 'a', kind: 'assistant', turn: 1 },
	];
	assert.deepEqual(planKeysForTurn(nodes, 1), ['p1']);
	assert.deepEqual(planKeysForTurn(nodes, 3), []);
	// 有 tail 的 Turn 才会把计划卡收进尾部；没有 tail 的 Turn（仍在进行）要留在原位，
	// 否则渲染循环里被跳过之后就再也画不出来。
	assert.deepEqual(planKeysForTurn([...nodes, { key: 't1', kind: 'turn-tail', turn: 1 }], 1), ['p1']);
});

test('applyDshSlotHost replaces simulated parts and keeps snapshot parts', () => {
	const history = [
		{ type: 'request', prompt: 'hi' },
		{
			type: 'response',
			parts: [
				{ kind: 'markdownContent', content: { value: 'old' } },
				{ kind: 'toolInvocationSerialized', toolCallId: 'c1' },
				{ kind: 'progressTaskSerialized', content: { value: 'Goal: x' } },
				{ kind: 'command', command: { id: 'dsh.answerApproval', title: 'Allow' } },
			],
		},
		{ type: 'response', parts: [{ kind: 'warning', content: { value: 'tail' } }] },
	];
	const next = applyDshSlotHost(history, [['assistant:a1']], 's1');
	assert.equal(next[1].parts[0].kind, 'dshSlotHost');
	assert.deepEqual(next[1].parts[0].nodeIds, ['assistant:a1']);
	assert.equal(next[1].parts[1].kind, 'progressTaskSerialized');
	assert.equal(next[1].parts[2].kind, 'command');
	assert.equal(next[2].parts[0].kind, 'warning');
	assert.equal(dshSlotHostSame(next[1].parts[0], { kind: 'dshSlotHost', treeId: 's1', nodeIds: ['assistant:a1'] }), true);
});

test('slot host identity is the member list, not a tree version', () => {
	// 身份只由 treeId + nodeIds 决定：成员变了才重建，成员内容变化由 part 内部按 key 订阅处理。
	const base = { kind: 'dshSlotHost' as const, treeId: 's1', nodeIds: ['assistant:a1'] };
	assert.equal(dshSlotHostSame(base, { ...base }), true);
	assert.equal(dshSlotHostSame(base, { ...base, nodeIds: ['assistant:a2'] }), false);
	assert.equal(dshSlotHostSame(base, { ...base, nodeIds: [] }), false);
	assert.equal(dshSlotHostSame(base, { ...base, treeId: 's2' }), false);
	// 问卷结构变化也算内容变化，要重建。
	assert.equal(dshSlotHostSame(base, { ...base, questionSignature: 'q1' }), false);
});

test('an info part is not treated as a snapshot part worth keeping', () => {
	// `toHistory` 不再产出 info 行；即使外部传进来，也不该被当成「必须保留的快照级 part」。
	const history = [{ type: 'response', parts: [{ kind: 'info', content: { value: 'legacy' } }] }];
	const next = applyDshSlotHost(history, [['assistant:a1']], 's1');
	assert.deepEqual(next[0].parts.map(part => part.kind), ['dshSlotHost']);
});

test('tool rows carry the view family instead of a generic card title only', () => {
	const row = presentDshNode(node({ kind: 'tool-call', seq: 1, callId: 'c', name: 'grep', argsRaw: 'pattern' }));
	assert.equal(row.toolView, 'search');
	assert.equal(row.title, 'grep');
	assert.equal(row.detail, 'pattern');
	const text = presentDshNode(node({ kind: 'assistant', seq: 2, messageId: 'a', blocks: [{ kind: 'text', text: 'hello' }] }));
	assert.equal(text.detail, 'hello');
	assert.equal(text.toolView, undefined);
});

test('row diff only rebuilds rows whose display signature changed', async () => {
	const { diffDshSlotRows } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshSlotHostModel.ts');
	const before = [
		{ key: 'node:a', signature: 'text=hello' },
		{ key: 'node:b', signature: 'text=world' },
	];
	const unchanged = diffDshSlotRows(before, [{ ...before[0] }, { ...before[1] }]);
	assert.deepEqual(unchanged.removed, []);
	assert.deepEqual(unchanged.rebuild, []);
	assert.equal(unchanged.changed, false, 'identical rows must not report a visible change');

	const oneRow = diffDshSlotRows(before, [before[0], { key: 'node:b', signature: 'text=changed' }]);
	assert.deepEqual(oneRow.rebuild, ['node:b'], 'only the changed row is rebuilt');
	assert.deepEqual(oneRow.removed, []);
	assert.equal(oneRow.changed, true);

	const added = diffDshSlotRows(before, [before[0], before[1], { key: 'node:c', signature: 'text=new' }]);
	assert.deepEqual(added.rebuild, ['node:c']);
	assert.deepEqual(added.removed, []);
	assert.deepEqual(added.order, ['node:a', 'node:b', 'node:c']);

	const removed = diffDshSlotRows(before, [before[0]]);
	assert.deepEqual(removed.removed, ['node:b']);
	assert.equal(removed.changed, true);
});

test('row diff reports an order-only change as a visible change', async () => {
	const { diffDshSlotRows } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshSlotHostModel.ts');
	const before = [{ key: 'a', signature: '1' }, { key: 'b', signature: '2' }];
	const moved = diffDshSlotRows(before, [{ key: 'b', signature: '2' }, { key: 'a', signature: '1' }]);
	assert.deepEqual(moved.rebuild, [], 'a pure move rebuilds no DOM');
	assert.deepEqual(moved.removed, []);
	assert.deepEqual(moved.order, ['b', 'a']);
	assert.equal(moved.changed, true, 'a reorder must still notify the list to re-measure');
});

test('a slot host whose rows all keep their signature never fires a height event', async () => {
	// 契约 §19 S2 的验收：没有可见变化时 height event 计数必须为 0。
	// 行级判定在 `diffDshSlotRows` 里；这里用一个最小 DOM 桩复现 part 的对齐循环，
	// 证明「签名全同 → 不比较、不重建、不发事件」这条路径确实可达。
	const { diffDshSlotRows } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshSlotHostModel.ts');
	const rows = [
		{ key: 'node:user:m1', signature: 'node\u0000kind=user' },
		{ key: 'node:assistant:a1', signature: 'node\u0000kind=assistant' },
	];
	let heightEvents = 0;
	const frames = [rows, rows.map(row => ({ ...row })), rows.map(row => ({ ...row }))];
	for (const frame of frames) {
		const plan = diffDshSlotRows(rows, frame);
		if (plan.changed) {
			heightEvents++;
		}
	}
	assert.equal(heightEvents, 0, 'identical frames must not fire height');
});

test('a local revision only invalidates the response it belongs to', async () => {
	// 契约 §19 S0：`dshSlotHostSame` 必须比局部 revision，而不是整棵树的版本。
	// 这里用一个最小的树桩：两段 response 各有自己的成员组，只让第二段变化。
	const { DshConversationNodeTree } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshConversationNodeTree.ts');
	const tree = new DshConversationNodeTree('s1');
	tree.accept([
		{ kind: 'user', seq: 1, messageId: 'u1', turn: 1 },
		{ kind: 'assistant', seq: 2, messageId: 'a1', turn: 1, text: 'first' },
		{ kind: 'user', seq: 3, messageId: 'u2', turn: 2 },
		{ kind: 'assistant', seq: 4, messageId: 'a2', turn: 2, text: 'second' },
	]);
	const firstIds = ['user:u1', 'assistant:a1'];
	const secondIds = ['user:u2', 'assistant:a2'];
	const firstBefore = dshSlotHostRef('s1', firstIds, tree.revisionFor(firstIds));
	const secondBefore = dshSlotHostRef('s1', secondIds, tree.revisionFor(secondIds));
	tree.accept([
		{ kind: 'user', seq: 1, messageId: 'u1', turn: 1 },
		{ kind: 'assistant', seq: 2, messageId: 'a1', turn: 1, text: 'first' },
		{ kind: 'user', seq: 3, messageId: 'u2', turn: 2 },
		{ kind: 'assistant', seq: 4, messageId: 'a2', turn: 2, text: 'second updated' },
	]);
	const firstAfter = dshSlotHostRef('s1', firstIds, tree.revisionFor(firstIds));
	const secondAfter = dshSlotHostRef('s1', secondIds, tree.revisionFor(secondIds));
	assert.equal(dshSlotHostSame(firstBefore, firstAfter), true, 'the untouched response must keep its identity');
	assert.equal(dshSlotHostSame(secondBefore, secondAfter), false, 'the changed response must be recognized');
});

test('a revision participates only when both sides carry one', () => {
	// 旧形状（没有 revision）不能被当成「一定不同」：那会让每次刷新都整段重建。
	const legacy = { kind: 'dshSlotHost' as const, treeId: 's1', nodeIds: ['assistant:a1'] };
	assert.equal(dshSlotHostSame(legacy, { ...legacy, revision: 'r1' }), true);
	assert.equal(dshSlotHostSame({ ...legacy, revision: 'r1' }, { ...legacy, revision: 'r2' }), false);
});

test('turn process counts come from the whole turn, not from this response\'s node list', async () => {
	// 契约 §19 S6 的消费面：槽位用 turnDataSource(turn,'turn-process') 取计数，
	// 数据源是整个 Turn 的该 kind 节点——不是本段 response 的 nodeIds。
	// 这条测试钉住「计数行优先用 Host 权威值」，防止退回「在 grouped 里找、找不到就现算」。
	const { turnProcessCounts } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshSlotHostModel.ts');
	const { DshConversationNodeTree } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshConversationNodeTree.ts');
	const tree = new DshConversationNodeTree('s1');
	// turn-process 节点**不在**本段 nodeIds 里（本段只有 tool-call），但它属于同一个 Turn。
	tree.accept([
		{ kind: 'tool-call', seq: 1, turn: 1, callId: 'c1' },
		{ kind: 'turn-process', seq: 2, turn: 1, toolCallCount: 7, subagentCount: 2, messageCount: 1 },
	]);
	const ownNodeIds = ['tool-call:c1'];
	assert.equal(ownNodeIds.some(id => id.startsWith('turn-process:')), false, 'the count row is outside this response');
	// 旧写法（在 ownNodeIds 对应的 grouped 里找）会得到 undefined → 退化成现算；
	// 新写法从 turnDataSource 拿到 Host 的权威计数。
	const counts = turnProcessCounts(tree.turnDataSource(1, 'turn-process').get());
	assert.deepEqual(counts, { toolCallCount: 7, subagentCount: 2, messageCount: 1 });
	// 别的 Turn 没有计数行时返回 undefined（调用方据此退化成现算，不编造 0）。
	assert.equal(turnProcessCounts(tree.turnDataSource(2, 'turn-process').get()), undefined);
});

test('a compaction card is a collapsible structure, not a text blob', async () => {
	// 契约 §16 退出条件 4：不得用 info/warning/markdown 文本模拟结构化节点。
	// compaction 原来被拼成「摘要 + 两个数字」的 textContent，没有可折叠结构。
	const { dshCardSpec } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshCardSpec.ts');
	const spec = dshCardSpec({ kind: 'dshCompaction', summary: 'summary text', shadowedItemCount: 3, shadowedTokenCount: 40 });
	assert.ok(spec !== undefined);
	assert.equal(spec.title, 'Compaction');
	assert.equal(spec.collapsible, true, 'a summary must be collapsible');
	assert.equal(spec.open, false, 'background material starts collapsed');
	assert.deepEqual(spec.lines, [
		{ role: 'body', text: 'summary text' },
		{ role: 'meta', text: '3 items · 40 tokens' },
	]);
	// 没有摘要也没有计数时不画一个点了没反应的折叠头。
	const empty = dshCardSpec({ kind: 'dshCompaction', summary: null });
	assert.equal(empty?.collapsible, false);
});

test('result cards are expanded and non-collapsible; native parts are not taken over', async () => {
	const { dshCardSpec } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshCardSpec.ts');
	const deliverables = dshCardSpec({ kind: 'dshDeliverables', files: [{ path: 'a.ts' }, { path: 'b.ts', description: 'why' }] });
	assert.equal(deliverables?.open, true);
	assert.equal(deliverables?.collapsible, false, 'a short list has nothing to fold');
	assert.deepEqual(deliverables?.lines.map(line => line.text), ['a.ts', 'b.ts — why']);
	// markdown / thinking / toolInvocation 有原生等价物，不该被这张表接管。
	assert.equal(dshCardSpec({ kind: 'markdownContent', content: { value: 'x' } }), undefined);
	assert.equal(dshCardSpec({ kind: 'thinking', id: 't', value: 'x' }), undefined);
});

test('a workflow card localizes its status through the shared token formatter', async () => {
	const { dshCardSpec } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshCardSpec.ts');
	const spec = dshCardSpec({
		kind: 'dshWorkflowRun', runId: 'r1', name: 'flow', status: 'completed',
		phases: [{ key: 'p1', phase: 'Phase 1', members: [{ label: 'm', status: 'done' }] }],
	});
	assert.equal(spec?.title, 'flow');
	assert.equal(spec?.lines[0].text, workflowStatusText('completed'));
	assert.equal(spec?.collapsible, true);
});

test('every custom button goes through the shared focus-visible chrome', async () => {
	// 契约 §11.2：Tab/Shift+Tab 可达、focus-visible。`border: none` 会抹掉浏览器默认焦点环，
	// 所以每个自研按钮都必须经过 `applyDshButtonChrome`（或静态行头的 `applyDshStaticRowChrome`）。
	// 这是一条源码级不变量：新增按钮绕过它就会在这里失败。
	const { readFileSync } = await import('node:fs');
	const { readdirSync } = await import('node:fs');
	const dir = new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/', import.meta.url);
	const offenders: string[] = [];
	for (const name of readdirSync(dir)) {
		if (!name.endsWith('.ts')) {
			continue;
		}
		const source = readFileSync(new URL(name, dir), 'utf8');
		for (const pattern of [/\$\('button[^']*'\)/g, /createElement\('button'\)/g]) {
			for (const match of source.matchAll(pattern)) {
				const context = source.slice(match.index, match.index + 600);
				if (!context.includes('applyDshButtonChrome') && !context.includes('applyDshStaticRowChrome')) {
					offenders.push(`${name}: ${match[0]}`);
				}
			}
		}
	}
	assert.deepEqual(offenders, [], 'a custom button bypasses the shared focus-visible chrome');
});

test('the shared chrome stylesheet uses the theme focus variable, not a literal color', async () => {
	// 高对比度主题下焦点环必须跟随 `--vscode-focusBorder`；写死颜色会在 HC 下不可见。
	const { readFileSync } = await import('node:fs');
	const source = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshButtonChrome.ts', import.meta.url), 'utf8');
	assert.match(source, /:focus-visible/, 'the sheet must define :focus-visible, not :focus (mouse clicks would show a ring)');
	assert.match(source, /var\(--vscode-focusBorder\)/, 'the ring must use the theme variable');
	assert.doesNotMatch(source, /outline:\s*1px solid #[0-9a-fA-F]{3,6}/, 'no literal hex color for the ring');
});

test('a disclosure header points aria-controls at a real, uniquely named region', async () => {
	// 契约 §11.4 要求 aria-controls。`aria-expanded` 单独存在时，读屏只知道「能展开」，
	// 不知道展开的是哪块内容。这里做源码级核对：设 aria-expanded 就必须同时设 aria-controls，
	// 且被指向的元素真的拿到 id。
	const { readFileSync } = await import('node:fs');
	const source = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshSlotHostContentPart.ts', import.meta.url), 'utf8');
	const expanded = (source.match(/setAttribute\('aria-expanded'/g) ?? []).length;
	const controls = (source.match(/setAttribute\('aria-controls'/g) ?? []).length;
	assert.ok(expanded > 0, 'the disclosure must still announce its state');
	assert.equal(controls, expanded, 'every aria-expanded must be paired with an aria-controls');
	// 被指向的元素必须有 id，且 id 用 part 级前缀（虚拟化重绘之间稳定、同屏多行不撞车）。
	assert.match(source, /detail\.id = `\$\{this\.domIdPrefix\}/, 'the controlled region needs a stable id');
	assert.match(source, /domIdPrefix = `dsh-slot-\$\{generateUuid\(\)\}`/, 'the prefix must be per-part, not per-row-index');
});

test('commandview is a keyed slot and only the named command is overridden', async () => {
	const { DSH_COMMAND_VIEW_SLOT, dshChatSlotRegistry, dshCommandRowOverride } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatSlots.ts');
	const catalog = new Map(dshChatSlotRegistry.catalog().slots.map(entry => [entry.name, entry]));
	const declared = catalog.get(DSH_COMMAND_VIEW_SLOT);
	assert.equal(declared?.cardinality, 'keyed');
	assert.deepEqual(declared?.ownerProps, ['node', 'compaction']);

	const entry = dshChatSlotRegistry.register(DSH_COMMAND_VIEW_SLOT, { key: 'goal', props: { title: 'Goal command', detail: 'creates a goal' } });
	try {
		assert.equal(dshCommandRowOverride('other', 's1'), undefined, 'a different command key must not be overridden');
		const override = dshCommandRowOverride('goal', 's1');
		assert.equal(override?.title, 'Goal command');
		assert.equal(override?.detail, 'creates a goal');
		// 没有命令名时不查 keyed 槽（没有 key 可查）。
		assert.equal(dshCommandRowOverride(null), undefined);
		assert.equal(dshCommandRowOverride(''), undefined);
	} finally {
		entry.dispose();
	}
	assert.equal(dshCommandRowOverride('goal', 's1'), undefined, 'disposing the occupant restores the built-in card');
});



test('the fence slot keys on the lowercased language and carries code/streaming/meta', () => {
	// 官方 ui-chat/README「Reference previews」：entryKey 是**小写化的围栏语言**，
	// owner props 带 lang / code / streaming / meta。历史实现只传一个 info 且只读 replacement，
	// 插件既拿不到正文也拿不到流式状态。
	const registration = dshChatSlotRegistry.register(DSH_MARKDOWN_FENCE_SLOT, {
		id: 'mermaid-layer',
		key: 'mermaid',
		props: { replacement: 'rendered' },
	});
	try {
		// 大写语言与「语言 + meta」都要能命中同一层：entryKey 是小写化的语言部分。
		assert.equal(dshMarkdownFenceOverride('s1', 'MERMAID', 'graph TD;', true), 'rendered', 'the entry key must be the lowercased language');
		assert.equal(dshMarkdownFenceOverride('s1', 'mermaid title="x"', 'x', false), 'rendered', 'meta must not break the key match');
		assert.equal(dshMarkdownFenceOverride('s1', 'typescript', 'x', false), undefined);
	} finally {
		registration.dispose();
	}
});

test('work-details modes drive the default whole-Turn folding', async () => {
	// 官方 conversation-nodes/README「Display modes」：Compact/Standard/Detailed 对合格的历史
	// Turn **初始折叠**；Verbose **永不折叠**（Always open; duration/status header cannot collapse it）。
	const { DshExpansionStateStore, turnFoldingPolicy, hidesRunningGroupHeaders, showsLiveGroupDetail } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshExpansionStateStore.ts');

	for (const view of ['compact', 'standard', 'detailed']) {
		assert.equal(turnFoldingPolicy(view as never), 'collapsed-by-default', `${view} must fold completed turns`);
	}
	assert.equal(turnFoldingPolicy('verbose'), 'never', 'verbose never folds');
	// Detailed 在运行中隐藏组头；Compact 的组头不带实时细节。
	assert.equal(hidesRunningGroupHeaders('detailed'), true);
	assert.equal(hidesRunningGroupHeaders('standard'), false);
	assert.equal(showsLiveGroupDetail('compact'), false);
	assert.equal(showsLiveGroupDetail('standard'), true);

	const store = new DshExpansionStateStore('s1');
	assert.equal(store.transcriptView(), 'standard', 'the default is standard');
	assert.equal(store.isTurnCollapsed(1, 0), true, 'a standard completed turn starts collapsed');
	// 不可折叠的 Turn（运行中 / 失败）永远不因模式而收起。
	assert.equal(store.isTurnCollapsed(2, 0, false), false, 'an ineligible turn stays open');
	// 用户手动展开压过模式默认。
	store.setTurnCollapsed(1, 0, false);
	assert.equal(store.isTurnCollapsed(1, 0), false, 'a manual choice wins over the mode default');
	// Verbose 下即使没手动设过也不折叠。
	store.setTranscriptView('verbose');
	assert.equal(store.isTurnCollapsed(3, 0), false, 'verbose never folds');
});

test('presentationSettings carries the four preference fields and applies transcriptView', async () => {
	// Host 早已实现 presentationSettings（ide-view-host.js），但 IDE 侧此前从未调用——
	// 「数据存在但界面未显示」。这条确认四个字段的形状与 transcriptView 的应用。
	const { DshExpansionStateStore } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshExpansionStateStore.ts');
	const settings = { transcriptView: 'verbose', collapseTiming: 'next-input', foldedReplies: 'final', developerTools: true } as const;
	const store = new DshExpansionStateStore('s1');
	// 应用前按默认 standard：合格历史 Turn 初始折叠。
	assert.equal(store.isTurnCollapsed(1, 0), true);
	store.setTranscriptView(settings.transcriptView);
	assert.equal(store.transcriptView(), 'verbose');
	assert.equal(store.isTurnCollapsed(1, 0), false, 'verbose from Host must stop folding');
});

test('collapseTiming=next-input exempts the latest exchange from folding', async () => {
	// 官方 ui-chat.collapseTiming：On next message 时最新 exchange 保持运行中的呈现。
	const { DshExpansionStateStore } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshExpansionStateStore.ts');
	const store = new DshExpansionStateStore('s1');
	store.setCollapseTiming('next-input');
	assert.equal(store.collapseTiming(), 'next-input');
	store.setExemptTurns([3, 4]);
	// 豁免集合里的 Turn 不折叠。
	assert.equal(store.isTurnCollapsed(3, 0), false);
	assert.equal(store.isTurnCollapsed(4, 0), false);
	// 更早的 exchange 照常折叠。
	assert.equal(store.isTurnCollapsed(1, 0), true);
	// 用户手动收起压过豁免（手动优先）。
	store.setTurnCollapsed(3, 0, true);
	assert.equal(store.isTurnCollapsed(3, 0), true, 'a manual collapse wins even inside the exempt exchange');
	// 回到 completion 时机：豁免不再生效。
	store.setCollapseTiming('completion');
	assert.equal(store.isTurnCollapsed(4, 0), true, 'completion timing ignores the exemption');
});

test('the paging anchor is wired end to end, not just declared', async () => {
	// CHK-357 只做了基础设施、没有接线。这条不变量保证接线不退回「声明了但没人调」：
	// ① fillOlderHistory 必须在 loadOlder 前后成对调用；② 钩子必须真的被 content 带进 binding；
	// ③ IChatWidget 必须把 capture/restore 转发到 listWidget。
	const { readFileSync } = await import('node:fs');
	const read = (rel: string) => readFileSync(new URL('../../../src/vs/workbench/contrib/' + rel, import.meta.url), 'utf8');

	const content = read('dsh/browser/vscode/dshChatSessionContent.ts');
	assert.ok(content.includes('pagingAnchor?.begin()'), 'fillOlderHistory must capture an anchor before loading');
	assert.ok(content.includes('restoreAnchor?.();'), 'and restore right after the page lands');
	assert.match(content, /pagingAnchor: this\.pagingAnchor/, 'the binding must carry the injected hook');

	const chatWidget = read('chat/browser/widget/chatWidget.ts');
	assert.ok(chatWidget.includes('return this.listWidget.captureScrollAnchor();'), 'the widget must forward capture');
	assert.ok(chatWidget.includes('this.listWidget.restoreScrollAnchor('), 'the widget must forward restore');

	// 基础设施本身：ObjectTree 用 firstVisibleIndex + getRelativeTop 采样。
	const tree = readFileSync(new URL('../../../src/vs/base/browser/ui/tree/objectTree.ts', import.meta.url), 'utf8');
	assert.ok(tree.includes('this.view.firstVisibleIndex'), 'the anchor must start from the first visible row');
	assert.ok(tree.includes('this.getRelativeTop(element)'), 'and measure its viewport offset');
});

test('the renderer consumes multi-segment groups instead of one line per turn', async () => {
	// CHK-364 建了 segments 模型但没消费。这条不变量保证渲染层真的按段分行：
	// ① 必须调用 segmentAnchors；② 单段时退回整 Turn 锚点（不产生重复行）；
	// ③ 一个锚点前允许挂多行（同 Turn 多段）。
	const { readFileSync } = await import('node:fs');
	const source = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshSlotHostContentPart.ts', import.meta.url), 'utf8');
	assert.ok(source.includes('this.segmentAnchors(group, binding)'), 'the renderer must consult segment anchors');
	assert.ok(source.includes('group.segments.length <= 1'), 'a single segment must fall back to the turn anchor');
	assert.ok(source.includes('key: `summary:${nodeId}:${index}`'), 'multiple summaries per anchor must be rendered');
	// 组头必须是真 disclosure：`aria-expanded` 与 `aria-controls` 成对，且目标 id 由同一派生函数生成。
	assert.ok(source.includes("button.setAttribute('aria-controls', row.controlledId)"), 'the header must point at a real target');
	assert.ok(source.includes("button.setAttribute('aria-expanded'"), 'and announce its expanded state');
	assert.ok(source.includes('element.id = this.groupHostId(row.nodeKey)'), 'the target row must actually carry that id');
	assert.ok(source.includes('controlledId: this.groupHostId(nodeId)'), 'both sides must use the same derivation');
	// summaryBefore 必须能存多行（否则多段会被覆盖成一行）。
	// 组头现在是结构化的（含 line/expanded/onToggle），不再是纯字符串数组。
	assert.ok(source.includes('const summaryBefore = new Map<string, readonly {'), 'the summary map must hold structured headers');
	assert.ok(source.includes('onToggle: header.onToggle'), 'and forward the toggle callback to the row');
});

test('toggling a group header actually reveals its process content', async () => {
	// CHK-368 的组头只切图标、不影响渲染——那是「假装可交互」。这条不变量保证展开真的生效：
	// 组头展开时必须把该 Turn 的 processKeys 放回 visible 集合。
	const { readFileSync } = await import('node:fs');
	const source = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshSlotHostContentPart.ts', import.meta.url), 'utf8');
	const index = source.indexOf('if (expanded) {');
	assert.ok(index > 0, 'the header expansion must have a visible-effect branch');
	const body = source.slice(index, index + 300);
	assert.ok(body.includes('for (const key of group.processKeys)'), 'expanding must iterate the segment keys');
	assert.ok(body.includes('visible.add(key)'), 'and add them to the visible set');
	// 展开状态必须参与显示签名（否则切换不重绘）。
	assert.ok(source.includes("row.expanded === true ? '1' : '0'"), 'the expanded state must be part of the row signature');
});

test('process rows use the official spacing scale', async () => {
	// 官方「Grouped rendering」：ordinary flow rows 4px apart；an expanded group title has 8px
	// before its content；Assistant responses have 12px from adjacent process rows；
	// completed-Turn controls（turn-tail）have 16px from their input。
	const { readFileSync } = await import('node:fs');
	const source = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshSlotHostContentPart.ts', import.meta.url), 'utf8');
	assert.ok(source.includes("row.style.marginBottom = expanded ? '8px' : '4px'"), 'group title: 8px expanded, 4px ordinary');
	assert.ok(source.includes("row.style.marginTop = '12px'"), 'assistant replies: 12px');
	assert.ok(source.includes("row.style.marginTop = '16px'"), 'turn tail controls: 16px');
});
