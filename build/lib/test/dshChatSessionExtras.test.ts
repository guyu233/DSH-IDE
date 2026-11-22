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
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DshChatSession } from '../../../out/vs/workbench/contrib/dsh/browser/vscode/dshChatSession.js';
import { extrasOf, toHistory } from '../../../out/vs/workbench/contrib/dsh/browser/vscode/dshChatHistory.js';

/** 只实现 `DshChatSession` 用到的调用：这些单测不碰通道。 */
function fakeClient() {
	return {
		call: async () => ({ ok: false, error: { code: 'dsh-ide/feature-unavailable', message: 'test' } }),
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

test('follow frames do not fetch a separate skill catalog', async () => {
	const session = new DshChatSession({
		call: async () => ({ ok: false, error: { code: 'dsh-ide/feature-unavailable', message: 'test' } }),
		rebindView: async () => ({ ok: true }),
	} as never);
	try {
		await session.attach('session-1');
		assert.deepEqual(session.skills(), []);
		session.acceptView(view({ plan: PLAN }));
		assert.deepEqual(session.skills(), []);
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

test('2-A: a shared task status is shown in Chinese, not as a kernel enum', () => {
	const empty = { nodes: () => [] } as never;
	const textOf = (status: string) => {
		const history = toHistory(empty, [], { team: { enabled: true, tasks: [{ id: 't1', subject: '写测试', status, ready: false }] } });
		return history.flatMap(item => item.type === 'response' ? (item.parts ?? []).map(part => (part as { progress?: { content?: { value?: string } }[] }).progress?.map(p => p.content?.value ?? '').join('\n') ?? '') : []).join('\n');
	};
	assert.ok(textOf('pending').includes('[Pending] 写测试'));
	assert.ok(textOf('in_progress').includes('[In progress] 写测试'));
	assert.ok(textOf('completed').includes('[Completed] 写测试'));
	// 官方任务板会加新状态：未知值原样显示，不猜中文词。
	assert.ok(textOf('cancelled').includes('[cancelled] 写测试'));
});

test('2-A: the goal phase is shown in Chinese, not as a kernel enum', () => {
	const empty = { nodes: () => [] } as never;
	const textOf = (phase: string) => {
		const history = toHistory(empty, [], { goal: { goal: { id: 'g', revision: 1, objective: '做完', phase, maxGoalRounds: 10 } as never, roundsStarted: 2 } });
		return history.flatMap(item => item.type === 'response' ? (item.parts ?? []).map(part => (part as { content?: { value?: string } }).content?.value ?? '') : []).join('\n');
	};
	assert.ok(textOf('active').includes('In progress'));
	assert.ok(textOf('paused').includes('Paused'));
	assert.ok(textOf('blocked').includes('Blocked'));
	assert.ok(textOf('complete').includes('Completed'));
	// 未知值原样显示，不猜含义，也不吞掉。
	assert.ok(textOf('weird').includes('weird'));
});

test('2-A: a disabled or failed team never looks like it is on', () => {
	const empty = { nodes: () => [] } as never;
	const textsOf = (history: readonly { type: string; parts?: readonly { kind: string; content?: { value?: string } }[] }[]) =>
		history.flatMap(item => item.type === 'response' ? (item.parts ?? []).map(part => part.content?.value ?? '') : []).join('\n');

	// 关闭时即使还留着旧任务，也不能画成「共享任务 x/y」。
	const off = toHistory(empty, [], {
		team: { enabled: false, tasks: [{ id: 't1', subject: '旧任务', status: 'completed', ready: false }] },
	});
	assert.ok(textsOf(off).includes('Shared tasks are off'));
	assert.ok(!textsOf(off).includes('Shared tasks 1/1'), 'a disabled team must not list stale tasks');

	// 开启时才列任务。
	const on = toHistory(empty, [], {
		team: { enabled: true, tasks: [{ id: 't1', subject: '写测试', status: 'completed', ready: false }] },
	});
	assert.ok(textsOf(on).includes('Shared tasks 1/1'));

	// 设置失败必须说明，否则开关看着生效、实际没写进内核。
	const failed = toHistory(empty, [], { team: { enabled: true, tasks: [], failure: '拒绝写入' } });
	assert.ok(textsOf(failed).includes('Shared task setup failed: 拒绝写入'));
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
			const tasks = response.parts.filter(part => part.kind === 'progressTaskSerialized') as { content: { value: string }; progress: { content: { value: string } }[] }[];
			assert.ok(tasks.some(part => part.content.value.includes('Plan mode is on')));
			assert.ok(tasks.some(part => part.content.value.includes('完成手册') && part.content.value.includes('3 rounds')));
			assert.ok(tasks.some(part => part.content.value.includes('dsh-doc')));
			// Todo 用原生任务行承接：标题是完成数，逐项在 progress 里。
			const todos = tasks.filter(part => part.content.value.includes('Todos'));
			assert.equal(todos.length, 1, 'todos must render as one native progress task');
			assert.ok(todos[0].progress.some(part => part.content.value.includes('[x] 写测试')));
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

test('2-A: rebind 失败后同一 id 仍可重试（绑定回滚）', async () => {	let attempts = 0;
	const session = new DshChatSession({
		call: async () => ({ ok: false, error: { code: 'dsh-ide/feature-unavailable', message: 'test' } }),
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
		// 面板拿到的必须是 Host 的真实原因，不是内部会话标识符。
		assert.ok((session.bindFailure() ?? '').includes('first attempt fails'), 'the panel needs the host reason');
		assert.equal(await session.bind('session-1'), true, 'the same id must be retried instead of short-circuiting');
		assert.equal(attempts, 2);
		assert.equal(session.bindFailure(), undefined, 'a successful bind clears the previous reason');
	} finally {
		session.dispose();
	}
});

test('2-A: A 已绑定 → bind(B) 失败 → 再 bind(A) 必须真正重绑（面板不能永久空白）', async () => {
	let rebindCalls: string[] = [];
	let failB = true;
	const session = new DshChatSession({
		call: async () => ({ ok: false, error: { code: 'dsh-ide/feature-unavailable', message: 'test' } }),
		rebindView: async (sessionId: string) => {
			rebindCalls.push(sessionId);
			if (sessionId === 'B' && failB) {
				return { ok: false, error: { code: 'dsh-ide/not-ready', message: 'B fails' } };
			}
			const nodes = sessionId === 'A'
				? [{ seq: 1, time: 1, kind: 'user', messageId: 'm1', content: [{ kind: 'text', text: 'kept' }] }]
				: [];
			return { ok: true, value: { state: { state: 'ready', view: { frame: { type: 'noop' }, conversation: { nodes, hasMore: false } } } } };
		},
	} as never);
	try {
		assert.equal(await session.bind('A'), true);
		rebindCalls = [];
		assert.equal(await session.bind('B'), false, 'B must fail');
		assert.deepEqual(rebindCalls, ['B', 'A'], 'the previous session must be put back before the failure returns');
		assert.equal(session.nodes().length > 0, true, 'A\'s history must still be on screen');
		assert.equal(await session.bind('A'), true, 'A is already bound again');
		assert.deepEqual(rebindCalls, ['B', 'A'], 'the follow-up bind must not open a third stream');
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

const unavailable = { ok: false, error: { code: 'dsh-ide/feature-unavailable', message: 'test' } };

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

test('a rejected model switch reports the host reason and keeps the previous model', async () => {
	const session = new DshChatSession({
		call: async (method: string) => method === 'setModel'
			? { ok: false, error: { code: 'busy', message: 'model locked' } }
			: unavailable,
		rebindView: async (sessionId: string) => readySnapshot(sessionId),
	} as never);
	const reasons: string[] = [];
	const listener = session.onDidFailAction(message => reasons.push(message));
	try {
		assert.equal(await session.bind('A'), true);
		await session.selectModel('unit', 'A');
		assert.deepEqual(reasons, ['Could not change the model: model locked']);
		assert.equal(session.currentModel(), undefined);
	} finally {
		listener.dispose();
		session.dispose();
	}
});

test('a rejected submit keeps a reason the panel can show', async () => {
	const session = new DshChatSession({
		call: async () => ({ ok: false, error: { code: 'busy', message: 'agent is busy' } }),
		rebindView: async (sessionId: string) => readySnapshot(sessionId),
	} as never);
	try {
		assert.equal(await session.bind('A'), true);
		assert.equal(await session.submit('hello'), false);
		assert.equal(session.submitFailure(), 'Send failed: agent is busy');
		assert.equal(session.running(), false);
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
		const submits = calls.filter(call => call.method === 'submit');
		assert.equal(submits.length, 1);
		assert.deepEqual(Object.keys(submits[0].args as object).sort(), ['requestId', 'sessionId', 'text']);
		assert.equal((submits[0].args as { sessionId: string }).sessionId, 'A');
		assert.equal((submits[0].args as { text: string }).text, 'hello');
		// 关联标识必须真的下发：断线核对与重试都靠它对齐同一个内核请求。
		assert.match((submits[0].args as { requestId: string }).requestId, /\S/);
	} finally {
		session.dispose();
	}
});

test('a rejected image save keeps the host reason', async () => {
	const session = new DshChatSession({
		call: async () => ({ ok: false, error: { code: 'busy', message: 'store full' } }),
	} as never);
	try {
		const saved = await session.saveImage(new Uint8Array([1, 2, 3]), 'image/png', 'shot.png');
		assert.equal(saved, undefined);
		assert.equal(session.imageFailure(), 'Image ingestion failed: store full');
	} finally {
		session.dispose();
	}
});

test('a rejected older-history load reports the host reason', async () => {
	const session = new DshChatSession({
		call: async (method: string) => method === 'loadOlder'
			? { ok: false, error: { code: 'busy', message: 'page missing' } }
			: unavailable,
		rebindView: async () => ({
			ok: true,
			value: {
				state: {
					state: 'ready',
					view: {
						frame: { type: 'noop' },
						conversation: {
							hasMore: true,
							nodes: [{ seq: 4, time: 1, kind: 'user', messageId: 'm1', content: [{ kind: 'text', text: 'q' }] }],
						},
					},
				},
			},
		}),
	} as never);
	const reasons: string[] = [];
	const listener = session.onDidFailAction(message => reasons.push(message));
	try {
		assert.equal(await session.bind('A'), true);
		assert.equal(session.hasMore(), true);
		assert.equal(await session.loadOlder(), false);
		assert.equal(session.historyStatus(), 'error');
		assert.deepEqual(reasons, ['Earlier history did not load: page missing']);
	} finally {
		listener.dispose();
		session.dispose();
	}
});

test('a rejected stop reports the host reason and does not claim success', async () => {
	const session = new DshChatSession({
		call: async (method: string) => method === 'interrupt'
			? { ok: false, error: { code: 'busy', message: 'still running' } }
			: unavailable,
		rebindView: async (sessionId: string) => readySnapshot(sessionId),
	} as never);
	const reasons: string[] = [];
	const listener = session.onDidFailAction(message => reasons.push(message));
	try {
		assert.equal(await session.bind('A'), true);
		assert.equal(await session.cancel(), false);
		assert.deepEqual(reasons, ['Stop failed: still running']);
	} finally {
		listener.dispose();
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

test('a stale question card tells the user instead of answering silently', async () => {
	// 换绑时 pendingItems 会被清空。此时点问卷卡片：不能把答案发给新会话，
	// 也不能像原先那样只记一个内部标记——用户会以为已经答过了。
	const session = new DshChatSession(fakeClient());
	const failures: string[] = [];
	session.onDidFailAction(message => failures.push(message));
	try {
		await session.answerQuestion('gone', '选项一');
		assert.equal(failures.length, 1, 'the user must be told the card is stale');
		assert.match(failures[0], /question/, 'the notice must name the question card');
	} finally {
		session.dispose();
	}
	const read = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatSession.ts', import.meta.url), 'utf8');
	assert.match(read, /dsh\.answer\.staleQuestion/, 'the stale-question notice must exist');
});

test('selecting the model that is already active does not rebuild the menu', async () => {
	// 写回成功但选的本来就是当前模型时，没有变化可画；无条件 fire 会让菜单白重建。
	const session = new DshChatSession({
		call: async (method: string) => {
			if (method === 'composerState') {
				return { ok: true, value: { model: { groups: [{ id: 'p', models: [{ id: 'm', name: 'M' }] }], current: { provider: 'p', model: 'm' } } } };
			}
			return { ok: true };
		},
		rebindView: async () => ({ ok: true }),
	} as never);
	try {
		await session.bind('A');
		let fires = 0;
		const listener = session.onDidChangeModelMenu(() => fires++);
		await session.selectModel('p', 'm');
		assert.equal(fires, 0, 're-selecting the active model must not rebuild the menu');
		await session.selectModel('p', 'other');
		assert.equal(fires, 1, 'a real change must still rebuild the menu');
		listener.dispose();
	} finally {
		session.dispose();
	}
});

test('a changed approval title still repaints the card', async () => {
	// 原先只比 eventId 拼成的字符串：同一个 eventId 的原因变了，面板会停在旧文案。
	// 现在按 id + 标题比较，内容变了必须通知。
	const session = new DshChatSession(fakeClient());
	let fires = 0;
	const listener = session.onDidChangePending(() => fires++);
	try {
		const request = (toolName: string, reason?: string) => ({
			kind: 'request', eventId: 'e1', event: 'approval/request',
			request: reason === undefined ? { toolName } : { toolName, reason },
		});
		session.acceptWaterfall(request('bash') as never);
		const afterFirst = fires;
		assert.ok(afterFirst >= 1, 'the first card must publish');
		// 完全相同的清单：不该再通知。
		session.acceptWaterfall(request('bash') as never);
		assert.equal(fires, afterFirst, 'an identical list must not repaint');
		// 同一 eventId、原因变了：必须通知。
		session.acceptWaterfall(request('bash', '需要写入') as never);
		assert.ok(fires > afterFirst, 'a changed title must repaint the card');
	} finally {
		listener.dispose();
		session.dispose();
	}
	const read = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatSession.ts', import.meta.url), 'utf8');
	assert.match(read, /function samePendingItems\(/, 'pending must compare per entry');
	assert.match(read, /JSON\.stringify\(item\) !== fingerprint/, 'the whole pending entry must take part in the comparison');
});

test('an unchanged model catalog does not rebuild the menu', async () => {
	// 目录每收到一次通知，菜单就要重建一次。composerState 回来的内容与上一次相同时
	// 必须不通知，否则每次换绑/写回都会白重建一次。
	let calls = 0;
	const session = new DshChatSession({
		call: async (method: string) => {
			if (method === 'composerState') {
				calls += 1;
				return { ok: true, value: { model: { groups: [{ id: 'p', models: [{ id: 'm', name: 'M' }] }], current: { provider: 'p', model: 'm' } } } };
			}
			return unavailable;
		},
		rebindView: async () => ({ ok: true }),
	} as never);
	let fires = 0;
	const listener = session.onDidChangeModelMenu(() => fires++);
	try {
		await session.bind('A');
		const afterBind = fires;
		assert.ok(afterBind >= 1, 'the first read must publish the catalog');
		await session.refreshComposer();
		assert.ok(calls >= 2, 'the second read must actually reach the host');
		assert.equal(fires, afterBind, 'an identical catalog must not rebuild the menu');
	} finally {
		listener.dispose();
		session.dispose();
	}
	const read = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatSession.ts', import.meta.url), 'utf8');
	assert.match(read, /private _composerInFlight/, 'the in-flight read must be tracked');
	assert.match(read, /function sameModelOptions\(/, 'the catalog must be compared before firing');
});

test('concurrent skill reads for one session share a single request', async () => {
	// `bind` 与 `attach` 都会触发 refreshSkills。同一会话的并发读取没有意义，
	// 必须复用同一次在途请求；不同会话则各自发一次（目录本来就不一样）。
	let calls = 0;
	const session = new DshChatSession({
		call: async (method: string) => {
			if (method === 'listSkills') {
				calls += 1;
			}
			return unavailable;
		},
		rebindView: async () => ({ ok: true }),
	} as never);
	try {
		await Promise.all([
			session.bind('A'),
			session.bind('A'),
		]);
		assert.ok(calls <= 1, `one session must not read its skill catalog twice (saw ${calls})`);
	} finally {
		session.dispose();
	}
	const read = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatSession.ts', import.meta.url), 'utf8');
	assert.match(read, /private _skillsInFlight/, 'the in-flight read must be tracked');
	assert.match(read, /pending\.sessionId === sessionId/, 'only the same session may reuse it');
});

test('AGENTS 1.6: the IDE layer never fabricates session facts', () => {
	// DSH-IDE 是 DSH core 的 UI 投影层，不是第二个响应生成器。允许本地处理的只有：
	// 输入草稿、optimistic running、卡片临时隐藏、折叠状态、滚动位置、失败提示。
	// 这里用源码断言守住边界：IDE 侧不得自己造 assistant 正文 / 工具结果 / 待决终态。
	const read = (name: string) => readFileSync(new URL(`../../../src/vs/workbench/contrib/dsh/browser/vscode/${name}`, import.meta.url), 'utf8');
	const session = read('dshChatSession.ts');
	// 乐观 running 只能由 Host 的 api-session/status 复位。
	assert.match(session, /acceptSessionStatus/, 'running must be reset by the Host status frame');
	assert.match(session, /this\.client\.call\('cancelRequest'/, 'discuss must settle through the Host');
	// 卡片隐藏只发生在 Host 确认之后：hidePending 调用点必须在 result.ok 分支里。
	const okBranch = session.slice(session.indexOf('if (result.ok)'), session.indexOf('if (result.ok)') + 400);
	assert.match(okBranch, /this\.hidePending\(/, 'cards may only disappear after the Host confirms');
	// 投影层所有节点都来自 Host 事件分支。
	const projection = readFileSync(new URL('../../../src/vs/platform/dshClient/protocol/dshIdeConversation.ts', import.meta.url), 'utf8');
	assert.doesNotMatch(projection, /function makeAssistant|function synthesize|fakeAssistant/, 'no local assistant synthesis');
	const eventBranches = (projection.match(/if \(type === '/g) ?? []).length;
	assert.ok(eventBranches >= 25, `every projection node must hang off a Host event branch, saw ${eventBranches}`);
});
test('the settled-request set does not grow without bound', async () => {
	// 每张卡片的终态 id 都要记住（防重放），但长会话会一直攒。设上限后旧的被淘汰，
	// 新的仍能挡住重放——这比「记住一切」省内存，也不改变可观察行为。
	const session = new DshChatSession(fakeClient());
	try {
		const cancel = (eventId: string) => session.acceptWaterfall({ kind: 'cancel', eventId } as never);
		for (let i = 0; i < 600; i++) {
			cancel(`e-${i}`);
		}
		// 最近的一条仍然被记住：重放它不会重新长出卡片。
		session.acceptWaterfall({ kind: 'request', eventId: 'e-599', event: 'approval/request', request: { toolName: 'bash' } } as never);
		assert.deepEqual(session.pending(), [], 'a recent settled id must still block a replay');
		// 最早的一条已被淘汰，允许重新出现——这是有界化的代价，且只影响早已结束的请求。
		session.acceptWaterfall({ kind: 'request', eventId: 'e-0', event: 'approval/request', request: { toolName: 'bash' } } as never);
		assert.equal(session.pending().length, 1);
	} finally {
		session.dispose();
	}
});

test('an approval card that no longer belongs to this session is never sent', async () => {
	// 换绑会清空 pendingItems。此时点旧卡片若不拦，Host 会按 requestId 结算——
	// 那是另一个会话的请求，等于替别人点了批准。
	let calls = 0;
	const session = new DshChatSession({
		call: async (method: string) => {
			if (method === 'answerApproval') {
				calls += 1;
				return { ok: true };
			}
			return unavailable;
		},
		rebindView: async () => ({ ok: true }),
	} as never);
	const failures: string[] = [];
	session.onDidFailAction(message => failures.push(message));
	try {
		session.acceptWaterfall({ kind: 'request', eventId: 'e1', event: 'approval/request', request: { toolName: 'bash' } } as never);
		assert.equal(await session.bind('other-session'), true, 'binding another session clears the card');
		assert.deepEqual(session.pending(), [], 'the stale card must be gone');
		await session.answerApproval('e1', 'approve');
		assert.equal(calls, 0, 'a stale card must not reach the Host');
		assert.equal(failures.length, 1, 'the user must be told why nothing happened');
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

// ---------------------------------------------------------------------------
// 模型 / 推理档 / 图片的写回入口：这三个方法缺一个，原生输入框就会「显示成功但没生效」。
// ---------------------------------------------------------------------------

test('selectEffort writes the effort to the bound session', async () => {
	const writes: { method: string; args: Record<string, unknown> }[] = [];
	const session = new DshChatSession({
		call: async (method: string, args: Record<string, unknown>) => {
			writes.push({ method, args });
			return method === 'composerState' ? { ok: true, value: { model: { current: null, groups: [] } } } : { ok: true, value: {} };
		},
		rebindView: async () => ({ ok: true }),
	} as never);
	try {
		assert.equal(await session.bind('s-1'), true);
		await session.selectEffort('high');
		const effort = writes.find(write => write.method === 'setEffort');
		assert.deepEqual(effort?.args, { sessionId: 's-1', effort: 'high' });
	} finally {
		session.dispose();
	}
});

test('saveImage forwards bytes to the Host attachment store and keeps the reference', async () => {
	const ref = { attachmentId: 'a-1', width: 1, height: 1, bytes: 4 };
	const writes: { method: string; args: Record<string, unknown> }[] = [];
	const session = new DshChatSession({
		call: async (method: string, args: Record<string, unknown>) => {
			writes.push({ method, args });
			if (method === 'saveImageAttachment') {
				return { ok: true, value: ref };
			}
			return { ok: true, value: { model: { current: null, groups: [] } } };
		},
		rebindView: async () => ({ ok: true }),
	} as never);
	try {
		await session.bind('s-1');
		const saved = await session.saveImage(new Uint8Array([1, 2, 3, 4]), 'image/png', 'shot.png');
		assert.deepEqual(saved, ref);
		const write = writes.find(entry => entry.method === 'saveImageAttachment');
		assert.equal(write?.args['mediaType'], 'image/png');
		assert.equal(write?.args['name'], 'shot.png');
		assert.equal(typeof write?.args['data'], 'string');
		// 未支持的类型必须直接拒绝，不伪造一个引用。
		assert.equal(await session.saveImage(new Uint8Array([1]), 'image/svg+xml'), undefined);
	} finally {
		session.dispose();
	}
});

test('acceptView survives malformed frames from the Host process', () => {
	// `view` 与 `conversation` 都来自另一个进程：类型只在编译期成立。
	// `acceptView` 由事件回调直接调用、没有 try/catch，抛错会中断整条帧处理链，
	// 所以畸形输入必须安全降级（保持上一状态），而不是抛异常。
	const session = new DshChatSession();
	const malformed: { label: string; value: unknown }[] = [
		{ label: 'null', value: null },
		{ label: 'array', value: [] },
		{ label: 'empty object', value: {} },
		{ label: 'conversation is a string', value: { conversation: 'x' } },
		{ label: 'conversation has no nodes', value: { conversation: { hasMore: false } } },
		{ label: 'conversation.nodes is not an array', value: { conversation: { nodes: 5, hasMore: false } } },
		{ label: 'attachments is a string', value: { attachments: 'x' } },
		{ label: 'deliverables holds junk', value: { deliverables: [null, 1, 'x'] } },
	];
	for (const item of malformed) {
		assert.doesNotThrow(() => session.acceptView(item.value as never), `${item.label} must not throw`);
	}
	session.dispose();
});

test('deeply malformed Host payloads degrade instead of throwing', () => {
	// 每一项都来自真实探测：Host 是另一个进程，`pending`/`todos`/`team` 等字段
	// 在运行时不守类型。消费点若直接 `item.request`、`questions.map`、`task.content`，
	// 就会在事件回调或面板 rebuild 里抛错（两处都没有 try/catch）。
	const cases: { label: string; view: unknown }[] = [
		{ label: 'approval without request', view: { pending: [{ eventId: 'e1', event: 'approval/request' }] } },
		{ label: 'approval with non-object request', view: { pending: [{ eventId: 'e1', event: 'approval/request', request: 'x' }] } },
		{ label: 'questions is not an array', view: { pending: [{ eventId: 'e2', event: 'user-questions/request', request: { questions: 'x' } }] } },
		{ label: 'questions holds null', view: { pending: [{ eventId: 'e3', event: 'user-questions/request', request: { questions: [null] } }] } },
		{ label: 'todos hold non-objects', view: { todos: [null, 1, 'x'] } },
		{ label: 'team.tasks is not an array', view: { team: { enabled: true, tasks: 'x' } } },
		{ label: 'worktrees hold null', view: { worktrees: [null] } },
		{ label: 'goal misses its payload', view: { goal: { roundsStarted: 1 } } },
		{ label: 'quotaNotice misses fields', view: { quotaNotice: {} } },
	];
	for (const item of cases) {
		const session = new DshChatSession();
		try {
			assert.doesNotThrow(() => session.acceptView(item.view as never), `${item.label} must not throw`);
		} finally {
			session.dispose();
		}
	}
});

test('switching sessions clears pending and settled state', () => {
	// `dshChatSessionFor` 是窗口级单例：多个 dsh 会话共享同一个 DshChatSession。
	// 换绑时必须清空待决议与已结算集合，否则上一个会话的卡片会漂到新会话上。
	const session = new DshChatSession();
	session.acceptView({
		pending: [{ eventId: 'e1', event: 'approval/request', request: { toolName: 'bash' } }],
	});
	assert.equal(session.pending().length, 1, 'the approval must be tracked');
	assert.equal(session.pending()[0].eventId, 'e1');
	// 不经过真实 client 直接看状态：bind 会走 refreshComposer，这里只验证 acceptView 的隔离语义。
	session.acceptView({ pending: [] });
	assert.equal(session.pending().length, 0, 'an empty pending list must clear the previous cards');
	session.dispose();
});

test('a frame arriving after dispose is dropped instead of repopulating the tables', async () => {
	// 面板销毁后，在途的 follow 帧仍可能回来。不挡住的话，会把卡片重新写进
	// 已经清空的表里，并 fire 到已经释放的监听方。
	const session = new DshChatSession(fakeClient());
	session.acceptWaterfall({ kind: 'request', eventId: 'e1', event: 'approval/request', request: { toolName: 'bash' } } as never);
	assert.equal(session.pending().length, 1, 'the card must register while alive');
	session.dispose();
	session.acceptWaterfall({ kind: 'request', eventId: 'e2', event: 'approval/request', request: { toolName: 'bash' } } as never);
	assert.deepEqual(session.pending(), [], 'a disposed session must not accept new cards');
});

test('an oversized image is refused before it is encoded and sent', async () => {
	// 契约对 data 不设上限、Host 只校验非空。不在这里挡一道，超大图会先整份 base64
	// 编码、再跨进程传输、最后才被内核拒绝——中间三步都在吃内存。
	let imageCalls = 0;
	const session = new DshChatSession({
		call: async (method: string) => { if (method === 'saveImageAttachment') { imageCalls += 1; } return unavailable; },
		rebindView: async () => ({ ok: true }),
	} as never);
	try {
		const tooBig = new Uint8Array(21 * 1024 * 1024);
		const ref = await session.saveImage(tooBig, 'image/png');
		assert.equal(ref, undefined, 'an oversized image must be refused');
		assert.equal(imageCalls, 0, 'it must be refused before any saveImageAttachment call');
		const failure = session.imageFailure() ?? '';
		assert.ok(failure.includes('too large'), `the failure must explain the size limit, saw: ${failure}`);
	} finally {
		session.dispose();
	}
});

test('an image-only message is not sent with empty text', async () => {
	// 契约对 submit.text 用 nonEmptyString。只发图片时正文是空串，
	// 直接发过去会被校验拒绝，用户看到「发送失败」却不知道原因。
	const sent = [];
	const session = new DshChatSession({
		call: async (method: string, args: unknown) => {
			if (method === 'submit') { sent.push(args); return { ok: true }; }
			return unavailable;
		},
		rebindView: async () => ({ ok: true }),
	} as never);
	try {
		await session.bind('A');
		await session.submit('   ', [{ attachmentId: 'a-1', mediaType: 'image/png' }]);
		assert.equal(sent.length, 1, 'the message must be sent');
		const text = (sent[0] as { text?: string }).text ?? '';
		assert.notEqual(text.trim(), '', 'an image-only message must carry a placeholder body');
		// 有正文时不得被占位文本顶替。
		await session.submit('真正的正文', [{ attachmentId: 'a-2', mediaType: 'image/png' }]);
		assert.equal((sent[1] as { text?: string }).text, '真正的正文', 'real text must pass through unchanged');
	} finally {
		session.dispose();
	}
});
