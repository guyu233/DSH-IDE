// DSH-IDE Host 半身单测（node:test，纯 JS，无需 DSH 依赖）：
//   - 四类官方事件的订阅与解绑、会话归属过滤；
//   - answerer 只有一种形态：界面接管则等待决议，未接管则 next() 委托；
//   - 重复决议 ALREADY_RESOLVED、会话切换 SESSION_SWITCHED、缺服务 FEATURE_UNAVAILABLE；
//   - 已核对的 20 method 映射（含拒绝形状）。
//
// 运行：node --test src/vs/platform/dshClient/test/host/ideViewHost.test.mjs
// 位置说明：放在 test/host/ 而非 test/node/，避免与 mocha 的 `out/.../test/node/*.test.mjs` glob 重叠。

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	ALREADY_RESOLVED,
	DshIdeHostBridge,
	FEATURE_UNAVAILABLE,
	INVALID_ARGUMENT,
	PendingRequests,
	REQUIRED_SERVICES,
	SESSION_SWITCHED,
	approvalOutcome,
	createDshIdeHostBridge,
} from '../../host/ide-view-host.js';

/** 最小假上下文：记录监听、支持 emit，并按名字返回服务。 */
function fakeCtx(services = {}) {
	const listeners = new Map();
	return {
		listeners,
		get: name => services[name],
		on: (name, handler) => {
			const bucket = listeners.get(name) ?? [];
			bucket.push(handler);
			listeners.set(name, bucket);
			return () => {
				const current = listeners.get(name) ?? [];
				listeners.set(name, current.filter(item => item !== handler));
			};
		},
		emit(name, ...args) {
			for (const handler of [...(listeners.get(name) ?? [])]) {
				void handler(...args);
			}
		},
		count(name) {
			return (listeners.get(name) ?? []).length;
		},
	};
}

function sessionControllerStub(overrides = {}) {
	const calls = [];
	const record = name => async request => { calls.push({ name, request }); return {}; };
	return {
		calls,
		list: async () => ({ items: [{ sessionId: 's-1', title: 'one' }, { sessionId: 's-2' }] }),
		modelCatalog: async () => ({ groups: [{ id: 'deepseek', models: [{ id: 'chat', name: 'DeepSeek Chat' }] }] }),
		create: async request => { calls.push({ name: 'create', request }); return { sessionId: 's-new' }; },
		prompt: record('prompt'),
		cancel: record('cancel'),
		fork: record('fork'),
		state: record('state'),
		selectModel: record('selectModel'),
		...overrides,
	};
}

function bridgeWith(services = {}) {
	const ctx = fakeCtx({ sessions: { get: id => ({ id }) }, sessionController: sessionControllerStub(), ...services });
	const bridge = new DshIdeHostBridge(ctx, {});
	return { ctx, bridge };
}

test('required services are the verified pair', () => {
	assert.deepEqual([...REQUIRED_SERVICES], ['sessions', 'sessionController']);
});

test('createDshIdeHostBridge rejects when a required service is missing', () => {
	const ctx = fakeCtx({ sessions: {} });
	assert.throws(() => createDshIdeHostBridge(ctx), error => error.code === FEATURE_UNAVAILABLE && /sessionController/.test(error.message));
});

test('open reuses the channel id and binds the requested session', () => {
	const { bridge } = bridgeWith();
	const first = bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	assert.equal(first.sessionId, 's-1');
	const again = bridge.open({ view: 'chat', params: { sessionId: 's-2' } });
	assert.equal(again.channelId, first.channelId, 'repeated open must not mint a second channel id');
	assert.equal(again.sessionId, 's-1', 'repeated open keeps the original binding');
});

test('follow subscribes all four official sources and filters by session', () => {
	const { ctx, bridge } = bridgeWith();
	const seen = [];
	bridge.follow('s-1', event => seen.push(event));
	assert.equal(ctx.count('session/event'), 1);
	assert.equal(ctx.count('agent/assistant-stream'), 1);
	assert.equal(ctx.count('approval/request'), 1);
	assert.equal(ctx.count('user-questions/request'), 1);

	ctx.emit('session/event', { id: 's-1' }, { type: 'user.message', seq: 1 });
	ctx.emit('session/event', { id: 's-2' }, { type: 'user.message', seq: 2 });
	assert.deepEqual(seen.map(event => event.seq), [1], 'other sessions must not leak into this view');
});

test('follow forwards assistant-stream text deltas only', () => {
	const { ctx, bridge } = bridgeWith();
	const seen = [];
	bridge.follow('s-1', event => seen.push(event));
	ctx.emit('agent/assistant-stream', { agent: { session: { id: 's-1' } }, frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'hi' } } });
	ctx.emit('agent/assistant-stream', { agent: { session: { id: 's-1' } }, frame: { type: 'start' } });
	ctx.emit('agent/assistant-stream', { agent: { session: { id: 's-2' } }, frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'no' } } });
	assert.deepEqual(seen, [{ type: 'assistant.delta', text: 'hi' }]);
});

test('dispose only removes this view subscriptions', () => {
	const { ctx, bridge } = bridgeWith();
	const handle = bridge.follow('s-1', () => undefined);
	assert.equal(ctx.count('session/event'), 1);
	handle.dispose();
	for (const name of ['session/event', 'agent/assistant-stream', 'approval/request', 'user-questions/request']) {
		assert.equal(ctx.count(name), 0, `${name} listener must be released`);
	}
});

test('answerer delegates with next() when no transport is wired', async () => {
	const { ctx, bridge } = bridgeWith();
	bridge.follow('s-1', () => undefined);
	let delegated = 0;
	const outcome = await Promise.resolve().then(() => {
		const handler = ctx.listeners.get('approval/request')[0];
		return handler({ requestId: 'r1', toolName: 'bash' }, () => { delegated += 1; return 'rejected'; });
	});
	assert.equal(delegated, 1);
	assert.equal(outcome, 'rejected');
	assert.equal(bridge.pending.size(), 0, 'delegated request must not stay pending');
});

test('answerer waits for the UI decision when transport is wired', async () => {
	const ctx = fakeCtx({ sessions: {}, sessionController: sessionControllerStub() });
	const posts = [];
	const bridge = new DshIdeHostBridge(ctx, { transport: { post: message => posts.push(message), awaitDecisionChange: () => undefined } });
	bridge.follow('s-1', () => undefined);

	let delegated = 0;
	const handler = ctx.listeners.get('approval/request')[0];
	const promise = handler({ requestId: 'r2', toolName: 'bash', reason: 'needs write' }, () => { delegated += 1; });
	await tick();

	assert.equal(delegated, 0, 'the UI answerer must be the one that resolves');
	assert.deepEqual(posts.at(-1), { type: 'request', kind: 'approval', requestId: 'r2', request: { toolName: 'bash', reason: 'needs write' } });
	assert.deepEqual(await bridge.invoke('answerApproval', { requestId: 'r2', decision: 'approve' }), { accepted: true });
	assert.equal(await promise, 'allowed-once');
	await assert.rejects(() => bridge.invoke('answerApproval', { requestId: 'r2', decision: 'approve' }), error => error.code === ALREADY_RESOLVED);
});

test('question waterfall resolves with the raw answer payload', async () => {
	const ctx = fakeCtx({ sessions: {}, sessionController: sessionControllerStub() });
	const bridge = new DshIdeHostBridge(ctx, { transport: { post: () => undefined } });
	bridge.follow('s-1', () => undefined);
	const handler = ctx.listeners.get('user-questions/request')[0];
	const promise = handler({ requestId: 'q1', questions: [{ id: 'a', question: 'ok?', options: [{ label: 'yes' }] }] });
	await tick();
	const answer = { answers: [{ id: 'a', selected: ['yes'] }] };
	await bridge.invoke('answerQuestion', { requestId: 'q1', answer });
	assert.deepEqual(await promise, answer);
});

test('approval outcome mapping uses DSH literals and rejects unknown decisions', () => {
	assert.equal(approvalOutcome('approve'), 'allowed-once');
	assert.equal(approvalOutcome('reject'), 'rejected');
	assert.throws(() => approvalOutcome('maybe'), error => error.code === INVALID_ARGUMENT);
});

test('session ownership mismatch returns SESSION_SWITCHED', async () => {
	const { bridge } = bridgeWith();
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	await assert.rejects(() => bridge.invoke('resume', { sessionId: 's-2' }), error => error.code === SESSION_SWITCHED);
});

test('submit and interrupt use the verified sessionController shapes', async () => {
	const controller = sessionControllerStub();
	const { bridge } = bridgeWith({ sessionController: controller });
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	await bridge.invoke('submit', { text: 'hi' });
	await bridge.invoke('interrupt', {});
	const prompt = controller.calls.find(call => call.name === 'prompt');
	assert.equal(prompt.request.sessionId, 's-1');
	assert.equal(prompt.request.mode, 'queue');
	assert.deepEqual(prompt.request.content, [{ type: 'text', text: 'hi' }]);
	assert.equal(controller.calls.find(call => call.name === 'cancel').request.sessionId, 's-1');
});

test('list methods project only neutral fields', async () => {
	const { bridge } = bridgeWith();
	assert.deepEqual(await bridge.invoke('listSessions', {}), [{ sessionId: 's-1', title: 'one' }, { sessionId: 's-2' }]);
	assert.deepEqual(await bridge.invoke('listModels', {}), [{ provider: 'deepseek', model: 'chat', name: 'DeepSeek Chat' }]);
	assert.equal(await bridge.invoke('fetchRowDetail', { rowId: 'row:1' }), null);
});

test('unverified capabilities and unbound sessions are refused, not faked', async () => {
	const { bridge } = bridgeWith();
	await assert.rejects(() => bridge.invoke('runCommand', { command: '/help' }), error => error.code === FEATURE_UNAVAILABLE);
	await assert.rejects(() => bridge.invoke('submit', { text: 'hi' }), error => error.code === INVALID_ARGUMENT);
	await assert.rejects(() => bridge.invoke('deleteSession', { sessionId: 's-1' }), error => error.code === FEATURE_UNAVAILABLE);
	await assert.rejects(() => bridge.invoke('__bogus', {}), error => error.code === FEATURE_UNAVAILABLE);
});

test('PendingRequests settles once and reports duplicates', () => {
	const pending = new PendingRequests();
	const handle = pending.register('approval', 'r1');
	assert.equal(pending.size(), 1);
	assert.equal(pending.settle('r1', 'allowed-once'), true);
	assert.equal(pending.settle('r1', 'allowed-once'), false);
	assert.equal(pending.size(), 0);
	pending.delegate('never', handle.entry);
});

async function tick() {
	for (let i = 0; i < 4; i++) {
		await Promise.resolve();
	}
}
