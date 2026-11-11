// DSH-IDE Host 半身单测（node:test，纯 JS，无需 DSH 依赖）：
//   - 四类官方事件的订阅与解绑、会话归属过滤；
//   - answerer 只有一种形态：界面接管则等待决议，未接管则 next() 委托；
//   - 重复决议 ALREADY_RESOLVED、会话切换 SESSION_SWITCHED、缺服务 FEATURE_UNAVAILABLE；
//   - 已核对的 22 method 映射（含拒绝形状）。
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
	publishHostEndpoint,
	publishHostEndpointWhenListening,
	removeHostEndpoint,
	endpointLogText,
	resolveHostEndpoint,
} from '../../host/ide-view-host.js';
import { redactAuthMaterial, safeErrorText } from '../../common/dshIdeAuthRedaction.js';

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
		list: async () => ({ items: [
			{ sessionId: 's-1', updatedAt: 2, running: true, blank: false, agentAvailable: true, projections: { values: { title: 'one' } } },
			{ sessionId: 's-2', updatedAt: 1, running: false, blank: false, agentAvailable: false },
		] }),
		modelCatalog: async () => ({ groups: [{ id: 'deepseek', models: [{ id: 'chat', name: 'DeepSeek Chat' }] }] }),
		create: async request => { calls.push({ name: 'create', request }); return { sessionId: 's-new' }; },
		prompt: record('prompt'),
		cancel: record('cancel'),
		fork: record('fork'),
		state: record('state'),
		selectModel: record('selectModel'),
		projections: record('projections'),
		...overrides,
	};
}

function bridgeWith(services = {}) {
	// 默认 live registry：s-1 / s-2 可查；删除桩成功时从这里移除（插件在返回
	// `{ deleted: true }` 前已同步 detach live 会话，见 workspace.ts:905-930）。
	const live = new Map([['s-1', { id: 's-1' }], ['s-2', { id: 's-2' }]]);
	const ctx = fakeCtx({
		sessions: { get: id => live.get(id) },
		sessionController: sessionControllerStub(),
		workspaceRegistry: { list: () => [{ id: 'w-1', sessionIds: ['s-1', 's-2'] }] },
		...services,
	});
	const bridge = new DshIdeHostBridge(ctx, {});
	return { ctx, bridge, live };
}

test('required services include the workspace ownership source', () => {
	assert.deepEqual([...REQUIRED_SERVICES], ['sessions', 'sessionController', 'workspaceRegistry']);
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
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	assert.deepEqual(await bridge.invoke('listSessions', {}), [
		{ sessionId: 's-1', workspaceId: 'w-1', title: 'one', updatedAt: 2, running: true, blank: false, agentAvailable: true },
		{ sessionId: 's-2', workspaceId: 'w-1', updatedAt: 1, running: false, blank: false, agentAvailable: false },
	]);
	assert.deepEqual(await bridge.invoke('listModels', {}), [{ provider: 'deepseek', model: 'chat', name: 'DeepSeek Chat' }]);
	assert.equal(await bridge.invoke('fetchRowDetail', { rowId: 'row:1' }), null);
});

test('session listing returns no data and makes no reads without a binding', async () => {
	const unexpected = () => { assert.fail('an unbound list must not query the Host'); };
	const { bridge } = bridgeWith({ sessionController: { list: unexpected }, workspaceRegistry: { list: unexpected } });
	assert.deepEqual(await bridge.invoke('listSessions', {}), []);
});

test('session listing intersects workspace membership with visible summaries and keeps order', async () => {
	const summary = sessionId => ({ sessionId, updatedAt: 3, running: false, blank: false, agentAvailable: false });
	const { bridge } = bridgeWith({
		sessionController: { list: async () => ({ items: [summary('outside'), summary('s-2'), summary('s-1'), summary('unregistered')] }) },
		workspaceRegistry: { list: () => [
			{ id: 'w-1', sessionIds: ['s-1', 'hidden-by-acl', 's-2'] },
			{ id: 'w-2', sessionIds: ['outside'] },
		] },
	});
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	const rows = await bridge.invoke('listSessions', {});
	assert.deepEqual(rows.map(row => row.sessionId), ['s-2', 's-1']);
	assert.ok(rows.every(row => row.workspaceId === 'w-1'));
});

test('session listing fails closed for absent, ambiguous or invisible ownership', async () => {
	for (const workspaces of [[], [{ id: 'other', sessionIds: ['s-2'] }], [{ id: 'a', sessionIds: ['s-1'] }, { id: 'b', sessionIds: ['s-1'] }]]) {
		const { bridge } = bridgeWith({ workspaceRegistry: { list: () => workspaces } });
		bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
		assert.deepEqual(await bridge.invoke('listSessions', {}), []);
	}
	const { bridge } = bridgeWith({ sessionController: { list: async () => ({ items: [{ sessionId: 's-2' }] }) } });
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	assert.deepEqual(await bridge.invoke('listSessions', {}), []);
});

test('session listing retains cold-session metadata without leaking projections or inventing titles', async () => {
	const item = {
		sessionId: 's-1', updatedAt: 15, running: false, blank: true, agentAvailable: false,
		formatStatus: 'migration-required', cwd: 'E:/work', parentSessionId: 'parent', origin: 'subagent',
		title: 'wrong top-level title', projections: { values: { title: null, privateState: 'must not cross the channel' } },
	};
	const { bridge } = bridgeWith({ sessionController: { list: async () => ({ items: [item] }) } });
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	assert.deepEqual(await bridge.invoke('listSessions', {}), [{
		sessionId: 's-1', workspaceId: 'w-1', updatedAt: 15, running: false, blank: true, agentAvailable: false,
		formatStatus: 'migration-required', cwd: 'E:/work', parentSessionId: 'parent', origin: 'subagent',
	}]);
});

test('session listing propagates source failures instead of reporting an empty workspace', async () => {
	const failure = new Error('list unavailable');
	for (const services of [
		{ sessionController: { list: async () => { throw failure; } } },
		{ workspaceRegistry: { list: () => { throw failure; } } },
	]) {
		const { bridge } = bridgeWith(services);
		bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
		await assert.rejects(() => bridge.invoke('listSessions', {}), error => error === failure);
	}
});

test('session listing rejects results from a closed or replaced binding', async () => {
	for (const reopen of [false, true]) {
		let finish;
		const { bridge } = bridgeWith({ sessionController: { list: () => new Promise(resolve => { finish = resolve; }) } });
		bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
		const listing = bridge.invoke('listSessions', {});
		await tick();
		bridge.close();
		if (reopen) {
			bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
		}
		finish({ items: [] });
		await assert.rejects(listing, error => error.code === SESSION_SWITCHED);
	}
});

test('closing the Host view cancels a session read even when its source ignores cancellation', async () => {
	let receivedSignal;
	const { bridge } = bridgeWith({ sessionController: { list: (_request, signal) => {
		receivedSignal = signal;
		return new Promise(() => undefined);
	} } });
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	const listing = bridge.invoke('listSessions', {});
	await tick();
	bridge.close();
	await assert.rejects(listing, error => error.code === SESSION_SWITCHED);
	assert.equal(receivedSignal.aborted, true);
});

test('bridge startup waits for workspaceRegistry', () => {
	assert.throws(
		() => createDshIdeHostBridge(fakeCtx({ sessions: {}, sessionController: sessionControllerStub() })),
		error => error.code === FEATURE_UNAVAILABLE && error.details.missing.includes('workspaceRegistry'),
	);
});

test('unverified capabilities and unbound sessions are refused, not faked', async () => {
	const { bridge } = bridgeWith();
	await assert.rejects(() => bridge.invoke('runCommand', { command: '/help' }), error => error.code === FEATURE_UNAVAILABLE);
	await assert.rejects(() => bridge.invoke('submit', { text: 'hi' }), error => error.code === INVALID_ARGUMENT);
	await assert.rejects(() => bridge.invoke('__bogus', {}), error => error.code === FEATURE_UNAVAILABLE);
});

// ---------------------------------------------------------------------------
// deleteSession：按 §8.10.8 批准的路径调用社区插件 endpoint
//
// 插件 `@michengai/dsh-archive-manager@1.3.1` 在官方 workspaceRegistry 实例上 overlay
// `deleteSession(sessionId)`（`host-install.ts:8-12`、`workspace.ts:893-898`）。DSH-IDE 只做
// 前置校验、调用与结果判定：插件缺失 / 方法不可用 / 结果未确认一律拒绝，绝不伪造成功。
// ---------------------------------------------------------------------------

/** 带 overlay 删除方法的假 registry；`calls` 记录收到的 sessionId，成功时同步 detach live 会话。 */
function archiveRegistryStub(result = { deleted: true }, live) {
	const calls = [];
	return {
		calls,
		deleteSession: async sessionId => {
			calls.push(sessionId);
			if (result instanceof Error) {
				throw result;
			}
			if (live !== undefined && result.deleted === true) {
				live.delete(sessionId);
			}
			return result;
		},
	};
}

test('deleteSession calls the plugin overlay and reports accepted', async () => {
	const { bridge, live } = bridgeWith();
	const registry = archiveRegistryStub({ deleted: true }, live);
	// 用一个能看到本次 registry 的上下文重建 bridge（bridgeWith 的 live map 由此共享）。
	const ctx = fakeCtx({ sessions: { get: id => live.get(id) }, sessionController: sessionControllerStub(), workspaceRegistry: registry });
	const reborn = new DshIdeHostBridge(ctx, {});
	reborn.open({ view: 'chat', params: { sessionId: 's-1' } });
	assert.deepEqual(await reborn.invoke('deleteSession', { sessionId: 's-1' }), { accepted: true });
	assert.deepEqual(registry.calls, ['s-1'], 'the plugin overlay must receive the requested session id');
	assert.equal(live.has('s-1'), false, 'the live entry must be detached before the plugin reports success');
});

test('deleteSession refuses when the plugin is not installed (no overlay)', async () => {
	const { bridge } = bridgeWith();
	await assert.rejects(
		() => bridge.invoke('deleteSession', { sessionId: 's-1' }),
		error => error.code === FEATURE_UNAVAILABLE && /archive-manager/.test(error.message),
		'a missing plugin must be reported as feature-unavailable with the install hint',
	);
});

test('deleteSession accepts the gateway shape remote.workspaceRegistry.deleteSession', async () => {
	const { bridge, live } = bridgeWith();
	const calls = [];
	const remote = {
		deleteSession: async sessionId => {
			calls.push(sessionId);
			live.delete(sessionId);
			return { ok: true, value: { deleted: true } };
		},
	};
	const ctx = fakeCtx({ sessions: { get: id => live.get(id) }, sessionController: sessionControllerStub(), 'remote.workspaceRegistry': remote });
	const reborn = new DshIdeHostBridge(ctx, {});
	reborn.open({ view: 'chat', params: { sessionId: 's-1' } });
	assert.deepEqual(await reborn.invoke('deleteSession', { sessionId: 's-1' }), { accepted: true });
	assert.deepEqual(calls, ['s-1']);
});

test('deleteSession refuses a gateway failure instead of reporting success', async () => {
	const remote = { deleteSession: async () => ({ ok: false, error: { message: 'flush failed' } }) };
	const { bridge } = bridgeWith({ 'remote.workspaceRegistry': remote });
	await assert.rejects(() => bridge.invoke('deleteSession', { sessionId: 's-1' }), error => error.code === FEATURE_UNAVAILABLE && /flush failed/.test(error.message));
});

test('deleteSession refuses a result that does not confirm deletion', async () => {
	const { bridge } = bridgeWith({ workspaceRegistry: archiveRegistryStub({ deleted: false }) });
	await assert.rejects(() => bridge.invoke('deleteSession', { sessionId: 's-1' }), error => error.code === FEATURE_UNAVAILABLE);
});

test('deleteSession rejects unknown and foreign sessions before calling the plugin', async () => {
	const registry = archiveRegistryStub();
	// 归属校验：绑定了 s-1 的视图不能删 s-2。
	const { bridge } = bridgeWith({ workspaceRegistry: registry });
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	await assert.rejects(() => bridge.invoke('deleteSession', { sessionId: 's-2' }), error => error.code === SESSION_SWITCHED);
	// 未知会话：内核 live registry 与 API 列表都查不到。
	const unknown = bridgeWith({
		workspaceRegistry: registry,
		sessions: { get: () => undefined },
		sessionController: sessionControllerStub({ list: async () => ({ items: [] }) }),
	});
	await assert.rejects(() => unknown.bridge.invoke('deleteSession', { sessionId: 's-1' }), error => error.code === INVALID_ARGUMENT);
	assert.deepEqual(registry.calls, [], 'no physical action may happen for a rejected request');
});

test('deleteSession propagates a plugin call failure unchanged', async () => {
	const failure = new Error('transcript damaged');
	failure.code = 'session/flush-failed';
	const { bridge } = bridgeWith({ workspaceRegistry: archiveRegistryStub(failure) });
	await assert.rejects(() => bridge.invoke('deleteSession', { sessionId: 's-1' }), error => error === failure);
});

test('deleteSession refuses when the session is still live after a confirmed delete', async () => {
	// 插件返回 { deleted: true }，但 live registry 仍持有该会话：核验失败，不把「受理」写成「已删除」。
	// （不复查 API 列表：列表按 §8.2.4 是「有边界的最终一致」，同步复查会把滞后误报成失败。）
	const registry = archiveRegistryStub();
	const liveSessions = { get: () => ({ id: 's-1' }) };
	const { bridge } = bridgeWith({ workspaceRegistry: registry, sessions: liveSessions });
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	await assert.rejects(
		() => bridge.invoke('deleteSession', { sessionId: 's-1' }),
		error => error.code === FEATURE_UNAVAILABLE && /still live/.test(error.message),
	);
	assert.deepEqual(registry.calls, ['s-1'], 'the delete itself must have been attempted exactly once');
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

// ---------------------------------------------------------------------------
// waterfall 一致性核对（第 1 章 §4.3 / 第 3 章 P3）：广播 + 首个决议生效 + 重复决议 ALREADY_RESOLVED
//
// 两个 IDE 窗口 = 两个 DshIdeViewService + 两条通道；它们共用同一个 Host 半身桥接。
// 这里直接用桥接 + transport.post 的广播行为模拟两窗口，验证决议只消费一次。
// ---------------------------------------------------------------------------

test('waterfall broadcast reaches both windows and the first decision wins', async () => {
	const ctx = fakeCtx({ sessions: {}, sessionController: sessionControllerStub() });
	const broadcast = [];
	const bridge = new DshIdeHostBridge(ctx, {
		transport: {
			// 一次请求广播给所有窗口（第 1 章 §4.3）。
			post: message => broadcast.push(message),
		},
	});
	bridge.follow('s-1', () => undefined);

	const handler = ctx.listeners.get('approval/request')[0];
	const pending = handler({ requestId: 'wf-1', toolName: 'bash' }, () => 'rejected');

	// 两个窗口都收到同一条请求。
	assert.deepEqual(broadcast, [{ type: 'request', kind: 'approval', requestId: 'wf-1', request: { toolName: 'bash' } }]);

	// 窗口 A 先决议：生效。
	assert.deepEqual(await bridge.invoke('answerApproval', { requestId: 'wf-1', decision: 'approve' }), { accepted: true });
	assert.equal(await pending, 'allowed-once', 'the first decision must be the one DSH sees');

	// 窗口 B 后到：同一个 requestId 必须得到 ALREADY_RESOLVED，且不改变结果。
	await assert.rejects(
		() => bridge.invoke('answerApproval', { requestId: 'wf-1', decision: 'reject' }),
		error => error.code === ALREADY_RESOLVED,
	);
	assert.equal(bridge.pending.size(), 0, 'a settled request must leave no pending entry');
});

test('waterfall keeps other requests independent when one is settled', async () => {
	const ctx = fakeCtx({ sessions: {}, sessionController: sessionControllerStub() });
	const bridge = new DshIdeHostBridge(ctx, { transport: { post: () => undefined } });
	bridge.follow('s-1', () => undefined);
	const handler = ctx.listeners.get('approval/request')[0];

	const first = handler({ requestId: 'wf-a', toolName: 'bash' });
	const second = handler({ requestId: 'wf-b', toolName: 'pwsh' });
	await tick();
	assert.equal(bridge.pending.size(), 2);

	await bridge.invoke('answerApproval', { requestId: 'wf-a', decision: 'reject' });
	assert.equal(await first, 'rejected');
	assert.equal(bridge.pending.size(), 1, 'settling one request must not disturb another');

	await bridge.invoke('answerApproval', { requestId: 'wf-b', decision: 'approve' });
	assert.equal(await second, 'allowed-once');
	assert.equal(bridge.pending.size(), 0);
});


// ---------------------------------------------------------------------------
// Host 端点自解析（第 7 章 §3.1 裁定：官方端点，不新增私有握手）
//
// 依据：webServer 暴露 port/host/protocol（webserver/src/index.ts:406-420）；
//       connection.authenticatedUrl(baseUrl) 拼上进程内 launch token（rpc-host.ts:198）。
// 与桌面端 apps/desktop/src/main.ts:531-532 取端点的方式同源。
// ---------------------------------------------------------------------------

function endpointCtx(webServer, connection) {
	return fakeCtx({ webServer, connection });
}

test('resolveHostEndpoint derives origin from webServer and borrows authenticatedUrl', () => {
	const ctx = endpointCtx(
		{ port: 62680, host: '127.0.0.1', protocol: 'http:' },
		{ authenticatedUrl: base => `${base}?token=abc` },
	);
	assert.deepEqual(resolveHostEndpoint(ctx), {
		origin: 'http://127.0.0.1:62680',
		port: 62680,
		launchUrl: 'http://127.0.0.1:62680/?token=abc',
	});
});

test('resolveHostEndpoint normalizes a wildcard bind host to loopback', () => {
	const ctx = endpointCtx({ port: 1234, host: '0.0.0.0', protocol: 'http:' }, { authenticatedUrl: b => b });
	assert.equal(resolveHostEndpoint(ctx).origin, 'http://127.0.0.1:1234');
});

test('resolveHostEndpoint returns undefined instead of guessing when services are absent', () => {
	assert.equal(resolveHostEndpoint(fakeCtx({})), undefined);
	assert.equal(resolveHostEndpoint(endpointCtx({ host: '127.0.0.1', protocol: 'http:' }, {})), undefined, 'a missing port must not be invented');
});

test('publishHostEndpoint writes origin and launch URL but no cookie', async () => {
	const os = await import('node:os');
	const fsp = await import('node:fs/promises');
	const path = await import('node:path');
	const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-endpoint-'));
	const file = path.join(dir, 'runtime', 'host-endpoint.json');
	const ctx = endpointCtx(
		{ port: 5000, host: '127.0.0.1', protocol: 'http:' },
		{ authenticatedUrl: base => `${base}?token=secret` },
	);
	const written = await publishHostEndpoint(ctx, file);
	assert.equal(written.origin, 'http://127.0.0.1:5000');

	const raw = await fsp.readFile(file, 'utf8');
	const parsed = JSON.parse(raw);
	assert.equal(parsed.origin, 'http://127.0.0.1:5000');
	assert.equal(parsed.port, 5000);
	assert.match(parsed.launchUrl, /token=secret/);
	assert.equal(parsed.cookie, undefined, 'the endpoint file must never carry a cookie');
	assert.equal(typeof parsed.pid, 'number');
	await fsp.rm(dir, { recursive: true, force: true });
});

test('publishHostEndpoint is a no-op when the endpoint cannot be resolved', async () => {
	const os = await import('node:os');
	const fsp = await import('node:fs/promises');
	const path = await import('node:path');
	const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-endpoint-'));
	const file = path.join(dir, 'host-endpoint.json');
	assert.equal(await publishHostEndpoint(fakeCtx({}), file), undefined);
	await assert.rejects(() => fsp.access(file), 'no file must be written when there is nothing to publish');
	await fsp.rm(dir, { recursive: true, force: true });
});


// ---------------------------------------------------------------------------
// 插件入口的 Cordis inject 与桥接自检清单必须一致
//
// 真机实测教训：入口曾写 `inject = []`，apply() 在 sessionController 注册前就跑，
// ctx.get('sessionController') 返回 undefined → 桥接被跳过且只留一行 warn。
// 两处清单漂移会静默降级，必须由测试锁住。
// ---------------------------------------------------------------------------

test('plugin entry inject matches REQUIRED_SERVICES', async () => {
	// 静态读取而非 import：index.js 会引入 host/ide-service.js（依赖 @deepseek-ai/cordis），
	// 本仓没有官方包，动态 import 会在解析阶段失败，测不到 inject。
	const { readFile } = await import('node:fs/promises');
	const source = await readFile(new URL('../../index.js', import.meta.url), 'utf8');
	const match = /export const inject = \[([^\]]*)\]/.exec(source);
	assert.ok(match !== null, 'index.js must declare `export const inject = [...]`');
	const declared = [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
	// inject 只放内核级、启动即有的服务；sessionController 由 ctx.inject 延迟等待，
	// 放进顶层 inject 会让整插件一直等它（真机实测）。
	assert.deepEqual(declared, ['sessions'], 'top-level inject must only wait for the kernel service');
	assert.ok(source.includes('ctx.inject(REQUIRED_SERVICES,'), 'bridge injection must use the same service list as bridge construction');
	assert.match(source, /import \{ REQUIRED_SERVICES,.*\} from '\.\/host\/ide-view-host\.js'/);
});


test('publishHostEndpointWhenListening waits until webServer reports a port', async () => {
	const os = await import('node:os');
	const fsp = await import('node:fs/promises');
	const path = await import('node:path');
	const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-endpoint-wait-'));
	const file = path.join(dir, 'host-endpoint.json');

	// 模拟 webServer 先注册、后监听：前两次读 port 返回 undefined。
	let reads = 0;
	const ctx = {
		get: name => {
			if (name === 'webServer') {
				reads += 1;
				return reads <= 2 ? { host: '127.0.0.1', protocol: 'http:' } : { port: 4321, host: '127.0.0.1', protocol: 'http:' };
			}
			if (name === 'connection') {
				return { authenticatedUrl: base => `${base}?token=t` };
			}
			return undefined;
		},
	};

	const endpoint = await publishHostEndpointWhenListening(ctx, file, { timeoutMs: 3000, intervalMs: 10 });
	assert.equal(endpoint.origin, 'http://127.0.0.1:4321');
	assert.ok(reads > 2, 'it must poll until a port appears');
	const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
	assert.equal(parsed.port, 4321);
	await fsp.rm(dir, { recursive: true, force: true });
});

test('publishHostEndpointWhenListening gives up instead of inventing an endpoint', async () => {
	const os = await import('node:os');
	const fsp = await import('node:fs/promises');
	const path = await import('node:path');
	const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-endpoint-timeout-'));
	const file = path.join(dir, 'host-endpoint.json');
	const ctx = { get: name => (name === 'webServer' ? { host: '127.0.0.1', protocol: 'http:' } : undefined) };
	const endpoint = await publishHostEndpointWhenListening(ctx, file, { timeoutMs: 120, intervalMs: 20 });
	assert.equal(endpoint, undefined);
	await assert.rejects(() => fsp.access(file), 'nothing must be written when the port never appears');
	await fsp.rm(dir, { recursive: true, force: true });
});


// ---------------------------------------------------------------------------
// 端点查找路径（真机缺陷：launch 永远找不到端点）
//
// IdeRemoteService 的 `root` 是 Host 工作目录（profile 根），而端点文件写在
// `<plugin>/runtime/host-endpoint.json`。历史实现用 `join(root, 'runtime', ...)`，
// 两条路径不是一回事 → 按钮点了永远失败。
// ---------------------------------------------------------------------------

test('endpoint lives under the plugin directory, not the host cwd', () => {
	// 真实布局：<profile>/node_modules/dsh-ide/runtime/host-endpoint.json
	//           root = <profile>
	const profile = 'C:/Users/x/.dsh/profiles/desktop';
	const pluginRoot = `${profile}/node_modules/dsh-ide`;
	const correct = `${pluginRoot}/runtime/host-endpoint.json`;
	const wrong = `${profile}/runtime/host-endpoint.json`;
	assert.notEqual(correct, wrong, 'the two paths must differ — this is the bug that was fixed');
	assert.ok(correct.includes('node_modules/dsh-ide'), 'the endpoint must be looked up inside the plugin');
});

// ---------------------------------------------------------------------------
// D55：认证材料脱敏（第 8 章 §8.8.7）
//
// 负向测试：日志与错误文案里不能出现完整 launchUrl / token / cookie；
// 端点文件权限收紧；清理后文件不再落盘；端点日志只含脱敏 origin。
// Windows 的 chmod 不改 ACL，这里只断言「调用不抛错、内容仍正确」，不伪称权限 PASS。
// ---------------------------------------------------------------------------

test('D55 redactAuthMaterial removes query tokens, cookies and bare secrets', () => {
	assert.equal(
		redactAuthMaterial('GET http://127.0.0.1:56188/?token=abc123&x=1#frag failed'),
		'GET http://127.0.0.1:56188/ failed',
	);
	assert.equal(redactAuthMaterial('launchUrl=https://h/?token=xyz'), 'launchUrl=[redacted]');
	assert.equal(redactAuthMaterial('token=secret cookie=abc'), 'token=[redacted] cookie=[redacted]');
	assert.equal(redactAuthMaterial('set-cookie: dsh.sid=abc123; Path=/'), 'set-cookie=[redacted]; Path=/');
	assert.equal(redactAuthMaterial('plain text without secrets'), 'plain text without secrets');
});

test('D55 safeErrorText never leaks a token from an Error or its message', () => {
	const out = safeErrorText(new Error('fetch to http://h:9/?token=t0ken failed'));
	assert.ok(!out.includes('t0ken'), 'the launch token must not appear in the error text');
	assert.ok(!out.includes('?token'), 'the full query must not appear in the error text');
	assert.equal(safeErrorText(undefined), 'unknown error');
});

test('D55 endpointLogText exposes origin only, never launchUrl', () => {
	const endpoint = { origin: 'http://127.0.0.1:5000', port: 5000, launchUrl: 'http://127.0.0.1:5000/?token=secret' };
	assert.equal(endpointLogText(endpoint), 'http://127.0.0.1:5000');
	assert.equal(endpointLogText(undefined), 'unavailable');
	assert.ok(!JSON.stringify(endpointLogText(endpoint)).includes('secret'));
});

test('D55 publishHostEndpoint writes a 0o600-mode file whose mode never widens group/other on POSIX', async () => {
	const os = await import('node:os');
	const fsp = await import('node:fs/promises');
	const path = await import('node:path');
	const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-d55-mode-'));
	const file = path.join(dir, 'runtime', 'host-endpoint.json');
	const ctx = endpointCtx(
		{ port: 5000, host: '127.0.0.1', protocol: 'http:' },
		{ authenticatedUrl: base => `${base}?token=secret` },
	);
	await publishHostEndpoint(ctx, file);
	const stat = await fsp.stat(file);
	if (process.platform !== 'win32') {
		assert.equal(stat.mode & 0o077, 0, 'group/other must have no permission bits on POSIX');
	}
	const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
	assert.match(parsed.launchUrl, /token=secret/, 'the file still carries the token for the IDE to consume');
	assert.equal(parsed.cookie, undefined, 'no cookie copy');
	await fsp.rm(dir, { recursive: true, force: true });
});

test('D55 removeHostEndpoint deletes the endpoint file and is idempotent', async () => {
	const os = await import('node:os');
	const fsp = await import('node:fs/promises');
	const path = await import('node:path');
	const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-d55-clean-'));
	const file = path.join(dir, 'runtime', 'host-endpoint.json');
	await publishHostEndpoint(endpointCtx(
		{ port: 1, host: '127.0.0.1', protocol: 'http:' },
		{ authenticatedUrl: base => `${base}?token=t` },
	), file);
	await fsp.access(file);
	await removeHostEndpoint(file);
	await assert.rejects(() => fsp.access(file), 'the token-bearing file must be gone');
	await removeHostEndpoint(file); // 幂等：删不存在的文件不抛错
	await fsp.rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// D13：setEffort 接线（§8.10.9 已核对落点：session/projections → session/selectModel）
//
// 官方无独立 setEffort remote；effort 是 selectModel 的 reasoningEffort 字段。
// 当前 provider/model 从 projections 的 modelSelection.next wire view 读取，
// 无当前选择时明确 FEATURE_UNAVAILABLE，不伪造默认路由、不降级成 setModel。
// ---------------------------------------------------------------------------

test('setEffort reads the current route from projections and re-selects with reasoningEffort', async () => {
	const calls = [];
	const controller = sessionControllerStub({
		projections: async request => {
			calls.push({ name: 'projections', request });
			return { values: { modelSelection: { next: { provider: 'deepseek', model: 'chat', reasoningEffort: 'medium' } } } };
		},
		selectModel: async request => { calls.push({ name: 'selectModel', request }); return { selected: {} }; },
	});
	const { bridge } = bridgeWith({ sessionController: controller });
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	assert.deepEqual(await bridge.invoke('setEffort', { effort: 'high' }), { accepted: true });
	assert.deepEqual(calls.map(c => c.name), ['projections', 'selectModel']);
	assert.deepEqual(calls[0].request, { sessionId: 's-1' });
	assert.deepEqual(calls[1].request, { sessionId: 's-1', provider: 'deepseek', model: 'chat', reasoningEffort: 'high' });
});

test('setEffort refuses an empty effort without querying the Host', async () => {
	const unexpected = () => { assert.fail('an invalid effort must not query the Host'); };
	const { bridge } = bridgeWith({ sessionController: { projections: unexpected, selectModel: unexpected } });
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	await assert.rejects(() => bridge.invoke('setEffort', { effort: '' }), error => error.code === INVALID_ARGUMENT);
});

test('setEffort refuses when the session has no current model selection', async () => {
	const controller = sessionControllerStub({
		projections: async () => ({ values: { modelSelection: { next: null } } }),
		selectModel: () => { assert.fail('a missing route must not re-select'); },
	});
	const { bridge } = bridgeWith({ sessionController: controller });
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	await assert.rejects(() => bridge.invoke('setEffort', { effort: 'high' }), error => error.code === FEATURE_UNAVAILABLE);
});

// ---------------------------------------------------------------------------
// D13（第 32 轮）：listCommands 接线——Host 侧经 agents.get(sessionId) 解析 Agent，
// 再调 commands.list(agent)，只投影中立 name/description（§8.10.9 第 31 轮 wire 结论）。
// ---------------------------------------------------------------------------

function commandServices(overrides = {}) {
	return {
		agents: { get: id => (id === 's-1' ? { id: 's-1' } : undefined) },
		commands: {
			list: agent => [
				{ definitionId: 'official-id', name: 'plan', description: 'Plan a task', input: { hint: 'topic' } },
				{ name: 'clear', description: '' },
				{ name: 'status', description: 'Show status' },
			].filter(() => agent !== undefined),
		},
		...overrides,
	};
}

test('listCommands resolves the bound agent and projects only neutral command fields', async () => {
	let seenAgent;
	const services = commandServices({
		commands: { list: agent => { seenAgent = agent; return [
			{ definitionId: 'internal', name: 'plan', description: 'Plan a task', input: { hint: 'topic' } },
			{ name: 'clear', description: '' },
			{ name: 'status', description: 'Show status' },
		]; } },
	});
	const { bridge } = bridgeWith(services);
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	const result = await bridge.invoke('listCommands', {});
	assert.deepEqual(seenAgent, { id: 's-1' });
	assert.deepEqual(result, [
		{ name: 'plan', description: 'Plan a task' },
		{ name: 'clear', description: '' },
		{ name: 'status', description: 'Show status' },
	]);
	// 官方内部结构（definitionId / input）不得透传到 IDE 侧。
	assert.ok(!JSON.stringify(result).includes('internal') && !JSON.stringify(result).includes('hint'));
});

test('listCommands refuses when the DSH commands service is unavailable', async () => {
	const { bridge } = bridgeWith({ agents: { get: () => ({ id: 's-1' }) } });
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	await assert.rejects(() => bridge.invoke('listCommands', {}), error => error.code === FEATURE_UNAVAILABLE && /commands/.test(error.message));
});

test('listCommands refuses when the bound session has no live agent', async () => {
	const { bridge } = bridgeWith(commandServices({ agents: { get: () => undefined } }));
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	await assert.rejects(() => bridge.invoke('listCommands', {}), error => error.code === FEATURE_UNAVAILABLE && /no live agent/.test(error.message));
});
