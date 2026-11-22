/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 问卷提交的真实状态层测试：只走 DshChatSession 的公开接口，断言 RPC 次数与卡片去留。
// 运行前先 `node build/next/index.ts transpile --out out`。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DshChatSession } from '../../../out/vs/workbench/contrib/dsh/browser/vscode/dshChatSession.js';

/** 可挂起的 answerQuestion 客户端；其它方法一律失败。 */
function deferredClient() {
	const calls: { method: string; args: unknown }[] = [];
	let resolve: ((value: unknown) => void) | undefined;
	const client = {
		call: async (method: string, args: unknown) => {
			calls.push({ method, args });
			if (method !== 'answerQuestion') {
				return { ok: false, error: { code: 'dsh-ide/feature-unavailable' } };
			}
			return new Promise(done => { resolve = done; });
		},
		rebindView: async () => ({ ok: true }),
	};
	return {
		client,
		calls,
		answer: () => resolve?.({ ok: true }),
		fail: (code: string) => resolve?.({ ok: false, error: { code } }),
	};
}

const questions = [
	{ id: 'a', question: '第一题', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] },
	{ id: 'b', question: '第二题', multiSelect: true, options: [{ label: 'X' }, { label: 'Y' }] },
];

function view() {
	return {
		frame: { type: 'noop' },
		conversation: { nodes: [], hasMore: false },
		pending: [{ eventId: 'q1', event: 'user-questions/request', agentId: 'a', request: { questions } }],
	} as never;
}

test('discuss ends the plan review through the host and removes the card', async () => {
	const calls: { method: string; args: unknown }[] = [];
	let resolve: ((value: unknown) => void) | undefined;
	const session = new DshChatSession({
		call: async (method: string, args: unknown) => {
			calls.push({ method, args });
			return new Promise(done => { resolve = done; });
		},
		rebindView: async () => ({ ok: true }),
	} as never);
	try {
		session.acceptView({
			frame: { type: 'noop' },
			conversation: { nodes: [], hasMore: false },
			pending: [{
				eventId: 'plan-1', event: 'user-questions/request', agentId: 'a',
				request: { questions: [{ id: 'p', question: '批准计划？', detail: '# 计划', multiSelect: false, options: [{ label: 'Approve' }], intent: { kind: 'plan-review', approve: 'Approve' } }] },
			}],
		} as never);
		const work = session.discussQuestion('plan-1');
		assert.equal(calls[0].method, 'cancelRequest');
		assert.deepEqual((calls[0].args as { requestId: string }).requestId, 'plan-1');
		assert.equal(session.pending().length, 1, 'the card stays until the host confirms');
		resolve?.({ ok: true });
		assert.equal(await work, true);
		assert.equal(session.pending().length, 0);
		// 已结束的审阅不能再讨论第二次。
		assert.equal(await session.discussQuestion('plan-1'), false);
	} finally {
		session.dispose();
	}
});

test('a whole questionnaire goes out exactly once and the card stays until success', async () => {
	const fake = deferredClient();
	const session = new DshChatSession(fake.client as never);
	try {
		session.acceptView(view());
		assert.equal(session.pending().length, 1);
		const first = session.submitQuestionDraft('q1', [
			{ id: 'a', selected: ['A'] },
			{ id: 'b', selected: ['X', 'Y'] },
		]);
		// 第二个点击必须被在途锁挡下，不产生第二次 answerQuestion。
		assert.equal(await session.submitQuestionDraft('q1', [{ id: 'a', selected: ['B'] }, { id: 'b', selected: ['X'] }]), false);
		assert.equal(fake.calls.filter(call => call.method === 'answerQuestion').length, 1);
		const payload = fake.calls[0].args as { requestId: string; answer: { answers: { id: string; selected: string[] }[] } };
		assert.equal(payload.requestId, 'q1');
		assert.deepEqual(payload.answer.answers, [
			{ id: 'a', selected: ['A'] },
			{ id: 'b', selected: ['X', 'Y'] },
		]);
		assert.equal(session.pending().length, 1, 'the card must stay while the answer is in flight');
		fake.answer();
		assert.equal(await first, true);
		assert.equal(session.pending().length, 0);
	} finally {
		session.dispose();
	}
});

test('a retryable failure keeps the draft card and an explicit skip is a valid answer', async () => {
	const fake = deferredClient();
	const session = new DshChatSession(fake.client as never);
	try {
		session.acceptView(view());
		const work = session.submitQuestionDraft('q1', [
			{ id: 'a', selected: ['B'] },
			{ id: 'b', selected: [], skipped: true },
		]);
		const payload = fake.calls[0].args as { answer: { answers: { id: string; selected: string[] }[] } };
		assert.deepEqual(payload.answer.answers, [{ id: 'a', selected: ['B'] }, { id: 'b', selected: [] }]);
		fake.fail('dsh-ide/transport-closed');
		assert.equal(await work, false);
		assert.equal(session.pending().length, 1, 'a transient failure must put the card back for retry');
	} finally {
		session.dispose();
	}
});

test('an already resolved request is final and never reopens', async () => {
	const fake = deferredClient();
	const session = new DshChatSession(fake.client as never);
	try {
		session.acceptView(view());
		const work = session.submitQuestionDraft('q1', [{ id: 'a', selected: ['A'] }, { id: 'b', selected: ['X'] }]);
		fake.fail('dsh-ide/already-resolved');
		assert.equal(await work, false);
		assert.equal(session.pending().length, 0, 'a terminal answer must not restore the card');
		assert.equal(await session.submitQuestionDraft('q1', [{ id: 'a', selected: ['A'] }, { id: 'b', selected: ['X'] }]), false);
	} finally {
		session.dispose();
	}
});

test('an incomplete draft never reaches the host', async () => {
	const fake = deferredClient();
	const session = new DshChatSession(fake.client as never);
	try {
		session.acceptView(view());
		assert.equal(await session.submitQuestionDraft('q1', [{ id: 'a', selected: ['A'] }]), false);
		assert.equal(await session.submitQuestionDraft('q1', [{ id: 'a', selected: ['C'] }, { id: 'b', selected: ['X'] }]), false);
		assert.equal(fake.calls.length, 0, 'invalid drafts must not be sent');
		assert.equal(session.pending().length, 1);
	} finally {
		session.dispose();
	}
});
