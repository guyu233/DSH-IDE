/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 第二阶段 2-A 的单测：`plan/goal/todos/skills` 必须从 typed 视图一路走到 history extras。
//
// 手册 §9.5 阶段 2-A 记录的真缺陷是「映射函数写好了，但数据从未到达它」：
// `DshChatSession.acceptView` 没保存这四个字段、content provider 也没传。
// 本测试同时锁住状态层（保存 / 判重 / 换会话清空）与 content provider（extras 装配）。
//
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshChatSessionExtras.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DshChatSession } from '../../../out/vs/workbench/contrib/dsh/browser/dshChatSession.js';
import { extrasOf, toHistory } from '../../../out/vs/workbench/contrib/dsh/browser/dshChatHistory.js';

/** 只实现 `DshChatSession` 用到的调用：这些单测不碰通道。 */
function fakeClient() {
	return {
		call: async () => ({ ok: false, error: { code: 'FEATURE_UNAVAILABLE', message: 'test' } }),
		rebindView: async () => ({ ok: true }),
	} as never;
}

/** 空对话视图：`acceptView` 需要 `conversation` 才走 typed 路径。 */
function view(extras: Record<string, unknown>) {
	return {
		frame: { type: 'noop' },
		conversation: { nodes: [], hasMore: false },
		...extras,
	} as never;
}

const PLAN = { active: true, pending: false };
const GOAL = {
	goal: { id: 'g1', revision: 2, objective: '完成手册', phase: 'active', maxGoalRounds: 256 },
	roundsStarted: 3,
	createdAt: 1,
	updatedAt: 2,
};
const TODOS = [
	{ content: '写测试', status: 'completed' },
	{ content: '跑门禁', status: 'in_progress' },
];
const SKILLS = [
	{ name: 'dsh-doc', description: 'DSH 文档', modelInvocable: true, userInvocable: true, provider: 'bundled' },
];

test('2-A: acceptView stores plan/goal/todos/skills and exposes them', () => {
	const session = new DshChatSession(fakeClient());
	try {
		session.acceptView(view({ plan: PLAN, goal: GOAL, todos: TODOS, skills: SKILLS }));
		assert.deepEqual(session.plan(), PLAN);
		assert.equal(session.goal()?.goal.objective, '完成手册');
		assert.deepEqual(session.todos(), TODOS);
		assert.deepEqual(session.skills(), SKILLS);
	} finally {
		session.dispose();
	}
});

test('2-A: identical extras do not fire onDidChangeExtras twice', () => {
	const session = new DshChatSession(fakeClient());
	let fired = 0;
	session.onDidChangeExtras(() => fired++);
	try {
		session.acceptView(view({ plan: PLAN, todos: TODOS }));
		assert.equal(fired, 1, 'first frame changes the extras');
		session.acceptView(view({ plan: PLAN, todos: TODOS }));
		assert.equal(fired, 1, 'same extras must not rebuild history again');
		session.acceptView(view({ plan: { active: false, pending: false }, todos: TODOS }));
		assert.equal(fired, 2, 'a real plan change must notify');
	} finally {
		session.dispose();
	}
});

test('follow frames without skills keep a catalog loaded by listSkills', async () => {
	const skills = [{ name: 'dsh-doc', description: 'DSH 文档', modelInvocable: true, userInvocable: true }];
	const session = new DshChatSession({
		call: async (method: string) => method === 'listSkills'
			? { ok: true, value: skills }
			: { ok: false, error: { code: 'FEATURE_UNAVAILABLE', message: 'test' } },
		rebindView: async () => ({ ok: true }),
	} as never);
	try {
		await session.attach('session-1');
		assert.deepEqual(session.skills(), skills);
		session.acceptView(view({ plan: PLAN }));
		assert.deepEqual(session.skills(), skills, 'a content frame must not wipe the skill catalog');
	} finally {
		session.dispose();
	}
});

test('2-A: bind clears plan/goal/todos/skills and notifies', async () => {
	const session = new DshChatSession(fakeClient());
	try {
		session.acceptView(view({ plan: PLAN, goal: GOAL, todos: TODOS, skills: SKILLS }));
		let fired = 0;
		session.onDidChangeExtras(() => fired++);
		assert.equal(await session.bind('another-session'), true);
		assert.equal(session.plan(), undefined);
		assert.equal(session.goal(), undefined);
		assert.deepEqual(session.todos(), []);
		assert.deepEqual(session.skills(), []);
		assert.equal(fired, 1, 'clearing must notify so the panel drops stale cards');
	} finally {
		session.dispose();
	}
});

test('2-A: a skill permission change fires even when the name is unchanged', () => {
	const session = new DshChatSession(fakeClient());
	let fired = 0;
	session.onDidChangeExtras(() => fired++);
	try {
		session.acceptView(view({ skills: [{ name: 'dsh-doc', description: 'x', modelInvocable: true, userInvocable: true, provider: 'bundled' }] }));
		assert.equal(fired, 1);
		// 只改 modelInvocable：若 sameSkills 漏字段，这里不会 fire（真缺陷）。
		session.acceptView(view({ skills: [{ name: 'dsh-doc', description: 'x', modelInvocable: false, userInvocable: true, provider: 'bundled' }] }));
		assert.equal(fired, 2, 'a permission/provider change must not be swallowed');
	} finally {
		session.dispose();
	}
});

test('2-A: extrasOf reads all seven typed extras from the session (the provider wiring itself)', () => {
	const session = new DshChatSession(fakeClient());
	try {
		session.acceptView(view({
			plan: PLAN,
			goal: GOAL,
			todos: TODOS,
			skills: SKILLS,
			quotaNotice: { code: 'ACCOUNT_QUOTA', seq: 9 },
			deliverables: [{ turn: 1, callId: 'p1', files: [{ path: 'a.md' }] }],
			attachments: [{ attachmentId: 'att-1', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }],
		}));
		const extras = extrasOf(session);
		// 逐项断言，任何一项被 provider 漏掉都会红（历史上漏过 plan/goal/todos/skills）。
		assert.deepEqual(extras.plan, PLAN);
		assert.equal(extras.goal?.goal.objective, '完成手册');
		assert.deepEqual(extras.todos, TODOS);
		assert.deepEqual(extras.skills, SKILLS);
		assert.equal(extras.quotaNotice?.seq, 9);
		assert.equal(extras.deliverables?.[0].callId, 'p1');
		assert.equal(extras.attachments?.[0].attachmentId, 'att-1');
	} finally {
		session.dispose();
	}
});

test('2-A: the four fields reach history parts through the same extras shape the provider uses', () => {
	// content provider 只做一件事：把 getter 原样交给 toHistory。这里用同一形状验证映射可达。
	const session = new DshChatSession(fakeClient());
	try {
		session.acceptView(view({ plan: PLAN, goal: GOAL, todos: TODOS, skills: SKILLS }));
		const history = toHistory(session, session.pending(), {
			plan: session.plan(),
			goal: session.goal(),
			todos: session.todos(),
			skills: session.skills(),
		});
		const response = history.find(item => item.type === 'response');
		assert.ok(response !== undefined && response.type === 'response');
		if (response?.type === 'response') {
			const infos = response.parts.filter(part => part.kind === 'info') as { content: { value: string } }[];
			assert.ok(infos.some(part => part.content.value.includes('计划模式已启用')));
			assert.ok(infos.some(part => part.content.value.includes('完成手册') && part.content.value.includes('3 轮')));
			assert.ok(infos.some(part => part.content.value.includes('dsh-doc')));
			// Todo 用原生任务行承接：标题是完成数，逐项在 progress 里。
			const tasks = response.parts.filter(part => part.kind === 'progressTaskSerialized') as { content: { value: string }; progress: { content: { value: string } }[] }[];
			assert.equal(tasks.length, 1, 'todos must render as one native progress task');
			assert.ok(tasks[0].content.value.includes('待办'));
			assert.ok(tasks[0].progress.some(part => part.content.value.includes('[x] 写测试')));
		}
	} finally {
		session.dispose();
	}
});


test('2-A: 内容帧不带 plan/goal/todos 时保留上一次的值（不被清空）', () => {
	const session = new DshChatSession(fakeClient());
	let fired = 0;
	session.onDidChangeExtras(() => fired++);
	try {
		session.acceptView(view({ plan: PLAN, goal: GOAL, todos: TODOS }));
		assert.equal(fired, 1);
		// 后续内容帧只带 conversation：projections 是空对象，三者必须原样保留。
		session.acceptView(view({}));
		assert.deepEqual(session.plan(), PLAN, 'a content frame must not wipe the plan');
		assert.equal(session.goal()?.goal.objective, '完成手册', 'a content frame must not wipe the goal');
		assert.deepEqual(session.todos(), TODOS, 'a content frame must not wipe the todos');
		assert.equal(fired, 1, 'nothing changed, so no rebuild');
	} finally {
		session.dispose();
	}
});

test('2-A: rebind 失败后同一 id 仍可重试（绑定回滚）', async () => {
	let attempts = 0;
	const session = new DshChatSession({
		call: async () => ({ ok: false, error: { code: 'FEATURE_UNAVAILABLE', message: 'test' } }),
		rebindView: async () => {
			attempts += 1;
			return attempts === 1
				? { ok: false, error: { code: 'dsh-ide/not-ready', message: 'first attempt fails' } }
				: { ok: true };
		},
	} as never);
	try {
		assert.equal(await session.bind('session-1'), false, 'first bind must report failure');
		assert.equal(attempts, 1);
		assert.equal(await session.bind('session-1'), true, 'the same id must be retried instead of short-circuiting');
		assert.equal(attempts, 2);
	} finally {
		session.dispose();
	}
});

test('2-A: A 已绑定 → bind(B) 失败 → 再 bind(A) 必须真正重绑（面板不能永久空白）', async () => {
	let rebindCalls: string[] = [];
	let failB = true;
	const session = new DshChatSession({
		call: async () => ({ ok: false, error: { code: 'FEATURE_UNAVAILABLE', message: 'test' } }),
		rebindView: async (sessionId: string) => {
			rebindCalls.push(sessionId);
			if (sessionId === 'B' && failB) {
				return { ok: false, error: { code: 'dsh-ide/not-ready', message: 'B fails' } };
			}
			return { ok: true, value: { state: { state: 'ready', view: { frame: { type: 'noop' }, conversation: { nodes: [], hasMore: false } } } } };
		},
	} as never);
	try {
		assert.equal(await session.bind('A'), true);
		rebindCalls = [];
		assert.equal(await session.bind('B'), false, 'B must fail');
		assert.equal(await session.bind('A'), true, 'binding back to A must succeed');
		assert.deepEqual(rebindCalls, ['B', 'A'], 'A must be rebound, not short-circuited');
	} finally {
		session.dispose();
	}
});

test('2-A: 会话状态通知按 sessionId 过滤，且结束后能复位 running', async () => {
	const session = new DshChatSession(fakeClient());
	const fired: boolean[] = [];
	session.onDidChangeRunning(value => fired.push(value));
	try {
		assert.equal(await session.bind('session-1'), true);
		session.acceptSessionStatus('other-session', true);
		assert.equal(session.running(), false, 'a background session must not affect this one');
		assert.deepEqual(fired, [], 'a foreign status must not fire');
		session.acceptSessionStatus('session-1', true);
		assert.equal(session.running(), true);
		session.acceptSessionStatus('session-1', false);
		assert.equal(session.running(), false, 'the status frame is the only normal reset source');
		session.acceptSessionStatus('session-1', false);
		assert.deepEqual(fired, [true, false], 'repeat values must not fire');
	} finally {
		session.dispose();
	}
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve: (value: T) => void = () => undefined;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}

const unavailable = { ok: false, error: { code: 'FEATURE_UNAVAILABLE', message: 'test' } };

function readySnapshot(label: string) {
	return {
		ok: true,
		value: {
			state: {
				state: 'ready',
				view: {
					frame: { type: 'noop' },
					conversation: { nodes: [], hasMore: false },
					todos: [{ content: label, status: 'pending' }],
				},
			},
		},
	};
}

test('a late rebind cannot overwrite or roll back a newer bind', async () => {
	const late = deferred<ReturnType<typeof readySnapshot> | typeof unavailable>();
	const session = new DshChatSession({
		call: async () => unavailable,
		rebindView: async (sessionId: string) => sessionId === 'A' ? late.promise : readySnapshot(sessionId),
	} as never);
	try {
		await session.bind('base');
		const pending = session.bind('A');
		assert.equal(await session.bind('B'), true);
		assert.equal(session.todos()[0]?.content, 'B');
		session.acceptSessionStatus('B', true);
		late.resolve(readySnapshot('A'));
		assert.equal(await pending, false, 'the superseded bind must not report success');
		assert.equal(session.todos()[0]?.content, 'B', 'the late snapshot must not replace B');
		session.acceptSessionStatus('B', false);
		assert.equal(session.running(), false, 'the late failure path must not roll B back');
	} finally {
		session.dispose();
	}
});

test('a second bind of the same id waits for the real result', async () => {
	const pending = deferred<typeof unavailable>();
	const session = new DshChatSession({
		call: async () => unavailable,
		rebindView: () => pending.promise,
	} as never);
	try {
		const first = session.bind('A');
		const second = session.bind('A');
		pending.resolve(unavailable);
		assert.deepEqual(await Promise.all([first, second]), [false, false]);
	} finally {
		session.dispose();
	}
});

test('a late composerState cannot overwrite the session bound while it was in flight', async () => {
	const late = deferred<{ ok: true; value: { model: { current: { provider: string; model: string }; groups: [] } } }>();
	let reads = 0;
	const session = new DshChatSession({
		call: async (method: string) => {
			if (method !== 'composerState') {
				return unavailable;
			}
			reads += 1;
			// 1：bind('A') 的首屏目录；2：换绑前发出的旧读取（挂起）；3：bind('B') 的目录。
			return reads === 2
				? late.promise
				: { ok: true, value: { model: { current: { provider: 'unit', model: reads === 1 ? 'A' : 'B' }, groups: [] } } };
		},
		rebindView: async (sessionId: string) => readySnapshot(sessionId),
	} as never);
	try {
		assert.equal(await session.bind('A'), true);
		const oldRefresh = session.refreshComposer();
		assert.equal(await session.bind('B'), true);
		assert.equal(session.currentModel()?.model, 'B');
		late.resolve({ ok: true, value: { model: { current: { provider: 'unit', model: 'A' }, groups: [] } } });
		await oldRefresh;
		assert.equal(session.currentModel()?.model, 'B');
	} finally {
		session.dispose();
	}
});

test('a late setModel cannot overwrite the model selected for the newer session', async () => {
	const late = deferred<{ ok: true }>();
	const session = new DshChatSession({
		call: async (method: string) => {
			if (method === 'setModel') {
				return late.promise;
			}
			if (method === 'composerState') {
				return { ok: true, value: { model: { current: { provider: 'unit', model: 'B' }, groups: [] } } };
			}
			return unavailable;
		},
		rebindView: async (sessionId: string) => readySnapshot(sessionId),
	} as never);
	try {
		const pending = session.selectModel('unit', 'A');
		assert.equal(await session.bind('B'), true);
		assert.equal(session.currentModel()?.model, 'B');
		late.resolve({ ok: true });
		await pending;
		assert.equal(session.currentModel()?.model, 'B');
	} finally {
		session.dispose();
	}
});

test('a late failed submit does not clear running on the session bound meanwhile', async () => {
	const late = deferred<typeof unavailable>();
	const session = new DshChatSession({
		call: async (method: string) => method === 'submit' ? late.promise : unavailable,
		rebindView: async (sessionId: string) => readySnapshot(sessionId),
	} as never);
	try {
		assert.equal(await session.bind('A'), true);
		const pending = session.submit('hello');
		assert.equal(await session.bind('B'), true);
		session.acceptSessionStatus('B', true);
		late.resolve(unavailable);
		assert.equal(await pending, false);
		assert.equal(session.running(), true, 'the failed submit belonged to A and must not stop B');
	} finally {
		session.dispose();
	}
});

test('submit sends the session that was bound when the text was sent', async () => {
	const calls: { method: string; args: unknown }[] = [];
	const session = new DshChatSession({
		call: async (method: string, args: unknown) => {
			calls.push({ method, args });
			return { ok: true, value: { accepted: true } };
		},
		rebindView: async (sessionId: string) => readySnapshot(sessionId),
	} as never);
	try {
		assert.equal(await session.bind('A'), true);
		assert.equal(await session.submit('hello'), true);
		assert.deepEqual(calls.filter(call => call.method === 'submit'), [{ method: 'submit', args: { text: 'hello', sessionId: 'A' } }]);
	} finally {
		session.dispose();
	}
});

test('cancel sends the session that was bound when stop was clicked', async () => {
	const calls: { method: string; args: unknown }[] = [];
	const session = new DshChatSession({
		call: async (method: string, args: unknown) => {
			calls.push({ method, args });
			return { ok: true, value: { accepted: true } };
		},
		rebindView: async (sessionId: string) => readySnapshot(sessionId),
	} as never);
	try {
		assert.equal(await session.bind('A'), true);
		await session.cancel();
		assert.deepEqual(calls.filter(call => call.method === 'interrupt'), [{ method: 'interrupt', args: { sessionId: 'A' } }]);
	} finally {
		session.dispose();
	}
});

test('attach does not replace a session the user already bound', async () => {
	let rebinds = 0;
	const session = new DshChatSession({
		call: async () => unavailable,
		rebindView: async (sessionId: string) => {
			rebinds++;
			return readySnapshot(sessionId);
		},
	} as never);
	try {
		assert.equal(await session.bind('B'), true);
		await session.attach('A');
		assert.equal(await session.bind('B'), true);
		assert.equal(rebinds, 1, 'attach must not move the binding back to the launch session');
	} finally {
		session.dispose();
	}
});

test('a rejected approval puts the card back', async () => {
	const session = new DshChatSession({
		call: async () => unavailable,
		rebindView: async () => ({ ok: true }),
	} as never);
	try {
		session.acceptWaterfall({
			kind: 'request',
			eventId: 'e1',
			event: 'approval/request',
			request: { toolName: 'bash' },
		} as never);
		await session.answerApproval('e1', 'approve');
		assert.deepEqual(session.pending().map(item => item.eventId), ['e1']);
	} finally {
		session.dispose();
	}
});

test('a rejected approval does not restore the card onto a session bound meanwhile', async () => {
	const late = deferred<typeof unavailable>();
	const session = new DshChatSession({
		call: async (method: string) => method === 'answerApproval' ? late.promise : unavailable,
		rebindView: async (sessionId: string) => readySnapshot(sessionId),
	} as never);
	try {
		assert.equal(await session.bind('A'), true);
		session.acceptWaterfall({
			kind: 'request',
			eventId: 'e1',
			event: 'approval/request',
			request: { toolName: 'bash' },
		} as never);
		const pending = session.answerApproval('e1', 'reject');
		assert.equal(await session.bind('B'), true);
		late.resolve(unavailable);
		await pending;
		assert.deepEqual(session.pending().map(item => item.eventId), []);
	} finally {
		session.dispose();
	}
});
