/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 官方 Session 投影值 → 快照 typed 字段的单测。
// 依据：plan-mode / goal / tool-todo 各自的 SessionProjectionMap 声明；
// 基线形状是 `{ asOfSeq, values }`（`api/session-controller/src/types.ts:63-68`）。
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshIdeProjections.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	DSH_IDE_WIRE_REVISION,
	validateDshIdeSnapshot,
} from '../../../src/vs/platform/dshClient/protocol/dshIdeProtocol.ts';
import { projectDshIdeProjections } from '../../../src/vs/platform/dshClient/protocol/dshIdeProjections.ts';

/** 把投影字段挂进 ready 快照，确认协议真源认这些字段。 */
function assertValidView(fields: ReturnType<typeof projectDshIdeProjections>): void {
	assert.doesNotThrow(() => validateDshIdeSnapshot({
		wireRevision: DSH_IDE_WIRE_REVISION,
		channelId: 'c1',
		binding: { viewId: 'c1', generation: 1, sessionId: null },
		version: 1,
		state: { state: 'ready', view: { frame: { type: 'snapshot' }, ...fields } },
	}));
}

/** 官方基线形状：typed 值在 values 里，asOfSeq 是事件游标。 */
function baseline(values: Record<string, unknown>): { asOfSeq: number; values: Record<string, unknown> } {
	return { asOfSeq: 7, values };
}

test('plan 与 todos 从投影值读出并过协议校验', () => {
	const fields = projectDshIdeProjections(baseline({
		plan: { active: true, pending: false },
		todos: [
			{ content: '投影 plan', status: 'completed' },
			{ content: '投影 todos', status: 'in_progress' },
		],
	}));
	assert.deepEqual(fields.plan, { active: true, pending: false });
	assert.deepEqual(fields.todos, [
		{ content: '投影 plan', status: 'completed' },
		{ content: '投影 todos', status: 'in_progress' },
	]);
	assertValidView(fields);
});

test('goal 从投影值读出，必填字段逐项透传，blocked 时保留原因', () => {
	const fields = projectDshIdeProjections(baseline({
		goal: {
			goal: {
				id: 'g-1',
				revision: 2,
				objective: '完成手册',
				phase: 'blocked',
				maxGoalRounds: 8,
				blockedReason: { code: 'need-input', message: '等待确认' },
			},
			roundsStarted: 3,
			createdAt: 100,
			updatedAt: 200,
		},
	}));
	// 协议 validateGoal 的必填字段逐项核对。
	assert.equal(fields.goal?.goal.id, 'g-1');
	assert.equal(fields.goal?.goal.revision, 2);
	assert.equal(fields.goal?.goal.objective, '完成手册');
	assert.equal(fields.goal?.goal.phase, 'blocked');
	assert.equal(fields.goal?.goal.maxGoalRounds, 8);
	assert.deepEqual(fields.goal?.goal.blockedReason, { code: 'need-input', message: '等待确认' });
	assert.equal(fields.goal?.roundsStarted, 3);
	assert.equal(fields.goal?.createdAt, 100);
	assert.equal(fields.goal?.updatedAt, 200);
	assertValidView(fields);
});

test('goal 非 blocked 时不产出 blockedReason', () => {
	const fields = projectDshIdeProjections(baseline({
		goal: {
			goal: { id: 'g-2', revision: 1, objective: '继续', phase: 'active', maxGoalRounds: 4 },
			roundsStarted: 1,
			createdAt: 10,
			updatedAt: 20,
		},
	}));
	assert.equal(fields.goal?.goal.blockedReason, undefined);
	assertValidView(fields);
});

test('会话累加 tokenUsage 不塞进单次增量字段', () => {
	// `tokenUsage` 投影是整个会话的累加值，协议 `tokenUsageDelta` 是单次调用增量，
	// 语义不同：这里必须不产出该字段，避免把累加值当成增量。
	const fields = projectDshIdeProjections(baseline({
		tokenUsage: { uncachedInputTokens: 120, outputTokens: 30, cacheReadTokens: 5, cacheWriteTokens: 7 },
	}));
	assert.equal(fields.tokenUsageDelta, undefined);
	assertValidView(fields);
});

test('缺失或形状不合的投影值不产生字段，绝不伪造', () => {
	assert.deepEqual(projectDshIdeProjections({}), {});
	assert.deepEqual(projectDshIdeProjections(null), {});
	// 直接传 values（漏掉基线外壳）时不应误读。
	assert.deepEqual(projectDshIdeProjections({ plan: { active: true, pending: false } }), {});
	assert.deepEqual(projectDshIdeProjections(baseline({
		plan: { active: 'yes', pending: false },
		todos: [{ content: '', status: 'pending' }],
		goal: { goal: { id: 'g', revision: 0, objective: 'x', phase: 'active', maxGoalRounds: 1 }, roundsStarted: 0, createdAt: 0, updatedAt: 0 },
	})), {});
});

test('assistant 节点的单次 usage 能过协议校验（tokenUsageDelta 的正向断言）', () => {
	// `tokenUsageDelta` 的合法来源是 assistant 节点的 usage（单次调用增量），
	// 不是会话累加投影。这里直接验证该形状能过协议。
	assert.doesNotThrow(() => validateDshIdeSnapshot({
		wireRevision: DSH_IDE_WIRE_REVISION,
		channelId: 'c1',
		binding: { viewId: 'c1', generation: 1, sessionId: null },
		version: 1,
		state: {
			state: 'ready',
			view: {
				frame: { type: 'event' },
				tokenUsageDelta: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 1 },
			},
		},
	}));
});

test('skills 与 pending 的形状能过协议校验', () => {
	assert.doesNotThrow(() => validateDshIdeSnapshot({
		wireRevision: DSH_IDE_WIRE_REVISION,
		channelId: 'c1',
		binding: { viewId: 'c1', generation: 1, sessionId: null },
		version: 1,
		state: {
			state: 'ready',
			view: {
				frame: { type: 'event' },
				skills: [{ name: 'dsh-doc', description: 'DSH 文档', modelInvocable: true, userInvocable: false, provider: 'local' }],
				pending: [{
					eventId: 'e-1',
					event: 'user-questions/request',
					agentId: 'agent-1',
					request: {
						questions: [{
							id: 'q1',
							question: '继续吗',
							options: [{ label: '继续' }],
							multiSelect: false,
							intent: { kind: 'approval', approve: '继续', reject: '停止' },
						}],
					},
				}],
			},
		},
	}));
	// 缺必填字段的 skills 条目必须被协议拒绝。
	assert.throws(() => validateDshIdeSnapshot({
		wireRevision: DSH_IDE_WIRE_REVISION,
		channelId: 'c1',
		binding: { viewId: 'c1', generation: 1, sessionId: null },
		version: 1,
		state: {
			state: 'ready',
			view: { frame: { type: 'event' }, skills: [{ name: 'x', description: 'y', provider: 'z' }] },
		},
	}), /invocation flags must be booleans/);
});

test('goal 为 null（未创建）时不产出字段', () => {
	assert.deepEqual(projectDshIdeProjections(baseline({ goal: null })), {});
});
test('agentTeam 投影读出任务板并过协议校验', () => {
	const fields = projectDshIdeProjections(baseline({
		agentTeam: {
			enabled: true,
			tasks: [
				{ id: 't-1', revision: 1, subject: '接入 Host', description: '把服务接上', status: 'completed', ready: true, ownerName: 'lead' },
				{ id: 't-2', revision: 2, subject: '删旧实现', description: '清理残留', status: 'in_progress', ready: false },
			],
		},
	}));
	assert.equal(fields.team?.enabled, true);
	assert.equal(fields.team?.tasks.length, 2);
	assert.deepEqual(fields.team?.tasks[0], {
		id: 't-1', revision: 1, subject: '接入 Host', description: '把服务接上', status: 'completed', ready: true, ownerName: 'lead',
	});
	assert.equal(fields.team?.tasks[1].ownerName, undefined);
	assertValidView(fields);
});

test('agentTeam 形状不合时整条丢弃', () => {
	assert.equal(projectDshIdeProjections(baseline({ agentTeam: { enabled: 'yes', tasks: [] } })).team, undefined);
	assert.equal(projectDshIdeProjections(baseline({ agentTeam: { enabled: true, tasks: [{ id: '' }] } })).team, undefined);
});

test('worktree 投影读出创建与继承记录并过协议校验', () => {
	const fields = projectDshIdeProjections(baseline({
		worktree: [
			{ worktree: { path: '/w/one', branch: 'feat-a', baseCommit: 'abc', repositoryRoot: '/repo' }, created: true },
			{ worktree: { path: '/w/two', branch: 'feat-b', baseCommit: 'def', repositoryRoot: '/repo' }, created: false },
		],
	}));
	assert.deepEqual(fields.worktrees, [
		{ path: '/w/one', branch: 'feat-a', baseCommit: 'abc', repositoryRoot: '/repo', created: true },
		{ path: '/w/two', branch: 'feat-b', baseCommit: 'def', repositoryRoot: '/repo', created: false },
	]);
	assertValidView(fields);
});

test('worktree 形状不合时整条丢弃', () => {
	assert.equal(projectDshIdeProjections(baseline({ worktree: [{ worktree: { path: '', branch: 'b', baseCommit: 'c', repositoryRoot: 'r' } }] })).worktrees, undefined);
	assert.equal(projectDshIdeProjections(baseline({ worktree: 'not-an-array' })).worktrees, undefined);
});
