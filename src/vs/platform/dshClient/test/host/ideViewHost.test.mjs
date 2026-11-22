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
} from '../../../../../../out/vs/platform/dshClient/host/bridge/ide-view-host.js';
import { redactAuthMaterial, safeErrorText } from '../../../../../../out/vs/platform/dshClient/protocol/dshIdeAuthRedaction.js';

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
		// D52：默认桩为「已停止的冷会话」，让既有删除用例走通；活动 / 读不到状态的用例各自覆盖。
		state: async request => { calls.push({ name: 'state', request }); return { running: false }; },
		selectModel: record('selectModel'),
		projections: record('projections'),
		async *follow() {},
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

test('two favorite toggles for one session apply in order', async () => {
	let favorite = false;
	const writes = [];
	const { bridge } = bridgeWith({
		workspaceRegistry: {
			list: () => [{ id: 'w-1', sessionIds: ['s-1'] }],
			async favoriteSessions() {
				await new Promise(resolve => setImmediate(resolve));
				return { favoriteSessionIds: favorite ? ['s-1'] : [] };
			},
			async setSessionFavorite(args) {
				writes.push(args.favorite);
				favorite = args.favorite;
			},
			moveSessionToWorkspace() { },
			deleteSession() { },
			resolveByPath() { return undefined; },
		},
	});
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	await Promise.all([
		bridge.invoke('setSessionFavorite', { sessionId: 's-1' }),
		bridge.invoke('setSessionFavorite', { sessionId: 's-1' }),
	]);
	assert.deepEqual(writes, [true, false]);
	assert.equal(favorite, false);
});

test('required services are only the ones session following needs', () => {
	// workspaceRegistry 只在归档 / 删除用得到；把它列成硬依赖会让整条桥接在本就
	// 没有该服务的 profile 里永远不就绪，`ide/dispatch` 全量拒绝（真机实测）。
	assert.deepEqual([...REQUIRED_SERVICES], ['sessions', 'sessionController']);
	assert.ok(!REQUIRED_SERVICES.includes('workspaceRegistry'),
		'workspaceRegistry must stay optional so the bridge still attaches without it');
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

test('BUG-016: a later subscriber receives the same opening baseline', () => {
	let release;
	const frames = (async function* () {
		yield { type: 'snapshot', seq: 1 };
		await new Promise(resolve => { release = resolve; });
		yield { type: 'event', seq: 2 };
	})();
	const { bridge } = bridgeWith({
		sessionController: { ...sessionControllerStub(), follow: () => frames },
	});
	const first = [];
	const second = [];
	bridge.follow({ viewId: 'v-1', generation: 1, sessionId: 's-1' }, frame => first.push(frame));
	// 第一位订阅者先拿到 opening；第二位是后来者，必须同样拿到它，否则没有基线。
	return (async () => {
		await new Promise(resolve => setImmediate(resolve));
		bridge.follow({ viewId: 'v-1', generation: 1, sessionId: 's-1' }, frame => second.push(frame));
		assert.deepEqual(second.map(frame => frame.type), ['snapshot'], 'the later subscriber must receive the opening baseline');
		assert.deepEqual(first.map(frame => frame.type), ['snapshot'], 'the first subscriber is not re-sent the baseline');
		release();
		await new Promise(resolve => setImmediate(resolve));
	})();
});

test('BUG-016: ending the source tells every subscriber instead of going silent', async () => {
	const { bridge } = bridgeWith({
		sessionController: {
			...sessionControllerStub(),
			follow: () => (async function* () { yield { type: 'snapshot', seq: 1 }; })(),
		},
	});
	const seen = [];
	bridge.follow({ viewId: 'v-1', generation: 1, sessionId: 's-1' }, frame => seen.push(frame.type));
	await new Promise(resolve => setImmediate(resolve));
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(seen, ['snapshot', 'follow-ended'], 'a finished stream must announce its end');
});

test('BUG-016: releasing an old handle never deletes a newer subscription', async () => {
	let opened = 0;
	const { bridge } = bridgeWith({
		sessionController: {
			...sessionControllerStub(),
			follow: () => { opened += 1; return (async function* () { await new Promise(() => undefined); })(); },
		},
	});
	const first = bridge.follow({ viewId: 'v-1', generation: 1, sessionId: 's-1' }, () => undefined);
	assert.equal(opened, 1);
	first.dispose();
	// 新订阅建立后再释放旧句柄：不能把新的那条删掉。
	const second = bridge.follow({ viewId: 'v-1', generation: 1, sessionId: 's-1' }, () => undefined);
	first.dispose();
	assert.equal(bridge._follows.has('s-1'), true, 'a stale handle must not delete the live follow');
	second.dispose();
	assert.equal(bridge._follows.has('s-1'), false, 'the last owner releases the shared follow');
});

test('a decision of the wrong kind does not settle the waiting request', async () => {
	const { bridge } = bridgeWith();
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	// 登记一条问卷，再用批准去结算它：种类不符必须拒绝，且原请求仍在等待。
	const handle = bridge.pending.register('question', 'req-kind');
	assert.equal(bridge.pending.settle('req-kind', 'allowed-once', 'approval'), 'kind-mismatch');
	assert.equal(bridge.pending.size(), 1, 'a mismatched decision must leave the request waiting');
	assert.equal(bridge.pending.settle('req-kind', { answers: [] }, 'question'), true);
	await handle.promise;
	assert.equal(bridge.pending.size(), 0);
});

test('closing the bridge settles its waiting requests instead of stranding them', async () => {
	const { bridge } = bridgeWith();
	const first = bridge.pending.register('approval', 'req-a');
	const second = bridge.pending.register('question', 'req-b');
	assert.equal(bridge.pending.size(), 2);
	bridge.close();
	// 每个等待者都必须结算：直接清 Map 会让 waterfall 永远挂住。
	assert.deepEqual(await Promise.all([first.promise, second.promise]), [undefined, undefined]);
	assert.equal(bridge.pending.size(), 0);
});

test('an IDE-first decision broadcasts the terminal state to the other views', async () => {
	const { bridge } = bridgeWith();
	const seen = [];
	bridge.follow({ viewId: 'v-1', generation: 1, sessionId: 's-1' }, frame => seen.push(frame));
	bridge.follow({ viewId: 'v-2', generation: 1, sessionId: 's-1' }, frame => seen.push(frame));
	const handle = bridge.pending.register('approval', 'req-ide');
	assert.equal(bridge.pending.settle('req-ide', 'allowed-once', 'approval'), true);
	bridge._fanout({ type: 'waterfall', kind: 'cancel', eventId: 'req-ide' });
	await handle.promise;
	// 两个视图各收到一次终态：否则别处的卡片会一直停在「待批准」。
	assert.deepEqual(seen.filter(frame => frame.kind === 'cancel').map(frame => frame.eventId), ['req-ide', 'req-ide']);
});

test('capabilities method returns the dependency capability snapshot', async () => {
	// 两个插件都没装：四项全 false（fail-closed）。
	const bare = bridgeWith();
	assert.deepEqual(await bare.bridge.invoke('capabilities', {}), { rewind: false, sessionFavorite: false, sessionMove: false, sessionDelete: false });

	// 归档管理器覆盖的三个方法都在：对应三项为 true。
	const withRegistry = bridgeWith({
		workspaceRegistry: {
			setSessionFavorite() { }, favoriteSessions() { }, moveSessionToWorkspace() { }, deleteSession() { }, list() { return []; }, resolveByPath() { return undefined; },
		},
	});
	const caps = await withRegistry.bridge.invoke('capabilities', {});
	assert.equal(caps.sessionFavorite, true);
	assert.equal(caps.sessionMove, true);
	assert.equal(caps.sessionDelete, true);
	assert.equal(caps.rewind, false);
});


test('follow calls sessionController.follow once per session and fans the same frames out', async () => {
	const requests = [];
	let push = () => undefined;
	const queue = [];
	const { bridge } = bridgeWith({
		sessionController: {
			...sessionControllerStub(),
			follow(request, signal) {
				requests.push(request);
				return (async function* () {
					while (signal.aborted !== true) {
						const frame = await new Promise(resolve => { push = resolve; });
						if (frame === undefined || signal.aborted === true) {
							return;
						}
						yield frame;
					}
				})();
			},
		},
	});
	const first = [];
	const second = [];
	const a = bridge.follow('s-1', frame => first.push(frame));
	const b = bridge.follow('s-1', frame => second.push(frame));
	assert.equal(requests.length, 1, 'one session is one follow');
	assert.deepEqual(requests[0], {
		address: { kind: 'session', sessionId: 's-1' },
		assistantStream: true,
		maxMessages: 500,
		turnWindow: { minMessages: 50, minTurns: 2 },
	});
	push({ type: 'event', event: { type: 'user/message', seq: 1 } });
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(first.length, 1);
	assert.equal(second.length, 1);
	assert.equal(first[0].event.seq, 1);
	a.dispose();
	b.dispose();
	void queue;
});

test('follow without a session address does not call sessionController.follow', () => {
	let calls = 0;
	const { bridge } = bridgeWith({
		sessionController: { ...sessionControllerStub(), follow() { calls += 1; return (async function* () {})(); } },
	});
	const handle = bridge.follow(undefined, () => undefined);
	handle.dispose();
	assert.equal(calls, 0);
});

test('dispose of the last listener stops that session follow', () => {
	let aborted = false;
	const { bridge } = bridgeWith({
		sessionController: {
			...sessionControllerStub(),
			follow(_request, signal) {
				signal.addEventListener('abort', () => { aborted = true; });
				return (async function* () { await new Promise(() => undefined); })();
			},
		},
	});
	const handle = bridge.follow('s-1', () => undefined);
	assert.equal(aborted, false);
	handle.dispose();
	assert.equal(aborted, true);
});

test('followSession delivers frames until aborted and then returns', async () => {
	const { bridge } = bridgeWith({
		sessionController: {
			...sessionControllerStub(),
			follow() { return (async function* () { await new Promise(() => undefined); })(); },
		},
	});
	const abort = new AbortController();
	const seen = [];
	const reading = (async () => {
		for await (const frame of bridge.followSession({ viewId: 'v-1', generation: 1, sessionId: 's-1' }, abort.signal)) {
			seen.push(frame);
		}
	})();
	// 流在等待时也必须能被 abort 唤醒，否则关窗会挂住。
	await new Promise(resolve => setImmediate(resolve));
	abort.abort();
	await Promise.race([
		reading,
		new Promise((_resolve, reject) => setTimeout(() => reject(new Error('abort did not wake the stream')), 1000)),
	]);
	// 身份先于内容：第一帧只确认归属，之后才是会话内容；这里没有内容，所以只有确认帧。
	assert.deepEqual(seen.map(frame => frame.type), ['ide-view-bound'], 'identity is confirmed before any session content');
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

	assert.equal(delegated, 1, 'desktop is offered the same request');
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

test('rewind calls dsh-rewind-plugin and refuses a missing install', async () => {
	const calls = [];
	const agent = { id: 's-1' };
	const { bridge } = bridgeWith({
		agents: { get: id => id === 's-1' ? agent : undefined },
		commands: {
			list: () => [{ name: 'rewind-plugin', description: 'engine' }],
			execute: async (who, line, attachments, signal) => {
				calls.push({ who, line, attachments, hasSignal: signal instanceof AbortSignal });
				return { commandId: 'c', result: { kind: 'success', text: 'ok' } };
			},
		},
	});
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	assert.deepEqual(await bridge.invoke('rewind', { sessionId: 's-1', to: '42' }), { accepted: true });
	assert.deepEqual(await bridge.invoke('rewind', { sessionId: 's-1', to: '@7' }), { accepted: true });
	assert.deepEqual(calls.map(call => call.line), ['/rewind-plugin @42 chat', '/rewind-plugin @7 chat']);
	assert.equal(calls[0].who, agent);
	assert.equal(calls[0].hasSignal, true);
	await assert.rejects(
		() => bridge.invoke('rewind', { sessionId: 's-1', to: 'p0' }),
		error => error.code === INVALID_ARGUMENT,
	);
	const bare = bridgeWith({
		agents: { get: () => agent },
		commands: { list: () => [{ name: 'rewind' }], execute: async () => ({ result: { kind: 'success' } }) },
	});
	bare.bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	await assert.rejects(
		() => bare.bridge.invoke('rewind', { sessionId: 's-1', to: '1' }),
		error => error.code === FEATURE_UNAVAILABLE && /dsh-rewind-plugin/.test(error.message),
	);
});

test('fork passes a numeric atSeq and rejects a non-numeric point', async () => {
	const controller = sessionControllerStub();
	const { bridge } = bridgeWith({ sessionController: controller });
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	await bridge.invoke('fork', { sessionId: 's-1', point: '42' });
	assert.deepEqual(controller.calls.find(call => call.name === 'fork').request, { sessionId: 's-1', atSeq: 42 });
	await assert.rejects(
		() => bridge.invoke('fork', { sessionId: 's-1', point: 'head' }),
		error => error.code === INVALID_ARGUMENT,
	);
});

test('submit and interrupt use the verified sessionController shapes', async () => {
	const controller = sessionControllerStub();
	const { bridge } = bridgeWith({ sessionController: controller });
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	const image = { attachmentId: 'img-1', mediaType: 'image/png', bytes: 3, width: 1, height: 1 };
	await bridge.invoke('submit', { text: 'hi', sessionId: 's-1', attachments: [image] });
	await bridge.invoke('interrupt', { sessionId: 's-1' });
	const prompt = controller.calls.find(call => call.name === 'prompt');
	assert.equal(prompt.request.sessionId, 's-1');
	assert.equal(prompt.request.mode, 'queue');
	assert.deepEqual(prompt.request.content, [
		{ type: 'text', text: 'hi' },
		{ type: 'image', attachment: image, encodedBytes: 3 },
	]);
	assert.equal(controller.calls.find(call => call.name === 'cancel').request.sessionId, 's-1');
	bridge.follow('s-2', () => undefined);
	await assert.rejects(
		() => bridge.invoke('interrupt', { sessionId: 's-1' }),
		error => error.code === SESSION_SWITCHED,
	);
	assert.equal(controller.calls.filter(call => call.name === 'cancel').length, 1);
	await assert.rejects(
		() => bridge.invoke('submit', { text: 'late', sessionId: 's-1' }),
		error => error.code === SESSION_SWITCHED,
	);
	assert.equal(controller.calls.filter(call => call.name === 'prompt').length, 1);
});

test('readAttachment projects only image bytes through the official attachment service', async () => {
	const ref = { attachmentId: 'img-1', mediaType: 'image/png', bytes: 3, width: 1, height: 1 };
	const { bridge } = bridgeWith({ attachments: {
		readImage: async request => {
			assert.deepEqual(request, ref, 'Host must read by the opaque attachment ref, never a path');
			return { ref, data: Uint8Array.from([1, 2, 3]) };
		},
	} });
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	assert.deepEqual(await bridge.invoke('readAttachment', { sessionId: 's-1', attachment: ref }), { mediaType: 'image/png', data: 'AQID' });
});

test('readAttachment refuses when the official attachment service is unavailable', async () => {
	const { bridge } = bridgeWith();
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	await assert.rejects(() => bridge.invoke('readAttachment', { sessionId: 's-1', attachment: {
		attachmentId: 'img-1', mediaType: 'image/png', bytes: 1, width: 1, height: 1,
	} }), error => error.code === FEATURE_UNAVAILABLE && /attachments/.test(error.message));
});

test('list methods project only neutral fields', async () => {
	const { bridge } = bridgeWith();
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	assert.deepEqual(await bridge.invoke('listSessions', {}), [
		{ sessionId: 's-1', workspaceId: 'w-1', title: 'one', updatedAt: 2, running: true, blank: false, agentAvailable: true },
		{ sessionId: 's-2', workspaceId: 'w-1', updatedAt: 1, running: false, blank: false, agentAvailable: false },
	]);
	assert.deepEqual(await bridge.invoke('listModels', {}), [{ provider: 'deepseek', model: 'chat', name: 'DeepSeek Chat' }]);
	// 手册 §5.3 第 4 条：官方无只读行详情端点，必须明确 FEATURE_UNAVAILABLE，不返回 null。
	await assert.rejects(bridge.invoke('fetchRowDetail', { rowId: 'row:1' }), error => error.code === 'dsh-ide/feature-unavailable');
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

test('bridge startup does not require workspaceRegistry', () => {
	// 没有 workspaceRegistry 时桥接必须照常建立：会话跟随 / 发送 / 批准都不需要它。
	const bridge = createDshIdeHostBridge(fakeCtx({ sessions: {}, sessionController: sessionControllerStub() }));
	assert.ok(bridge !== undefined, 'the bridge must attach without the optional workspace registry');
});

test('workspace-registry capabilities fail alone, not the whole bridge', async () => {
	const bridge = createDshIdeHostBridge(fakeCtx({ sessions: {}, sessionController: sessionControllerStub() }));
	await assert.rejects(
		() => bridge.invoke('archiveSession', { sessionId: 's-1' }),
		error => error.code === FEATURE_UNAVAILABLE,
		'archiving still refuses when the registry is absent, but only that call',
	);
});

test('unverified capabilities and unbound sessions are refused, not faked', async () => {
	const { bridge } = bridgeWith();
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
	// 显式行操作不要求等于当前绑定会话，但该行必须对当前主体可见：
	// 绑定了 s-1 的视图可以删同一名单里的 s-2，不能删名单外的 s-9。
	const { bridge } = bridgeWith({ workspaceRegistry: registry });
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	await assert.rejects(() => bridge.invoke('deleteSession', { sessionId: 's-9' }), error => error.code === SESSION_SWITCHED);
	// 未知会话：内核 live registry 与 API 列表都查不到。
	const unknown = bridgeWith({
		workspaceRegistry: registry,
		sessions: { get: () => undefined },
		sessionController: sessionControllerStub({ list: async () => ({ items: [] }) }),
	});
	// 名单里查不到的行不进入任何物理动作：按不可见拒绝。
	await assert.rejects(() => unknown.bridge.invoke('deleteSession', { sessionId: 's-1' }), error => error.code === SESSION_SWITCHED);
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
	assert.match(source, /import \{ REQUIRED_SERVICES,.*\} from '\.\/host\/bridge\/ide-view-host\.js'/);
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
// 端点文件必须和本次 DSH 可执行文件同一块盘。
// 写进插件包目录会在 pnpm link 跨盘时让硬链接失败，按钮点了没窗口。
// ---------------------------------------------------------------------------

test('endpoint file stays on the exe volume, not inside a cross-volume plugin link', async () => {
	const { hostEndpointFile } = await import('../../common/dshLocations.js');
	const previous = {
		DSH_HOME: process.env.DSH_HOME,
		DSH_PROFILE_DIR: process.env.DSH_PROFILE_DIR,
		LOCALAPPDATA: process.env.LOCALAPPDATA,
	};
	const missing = 'D:\\missing-dsh-home';
	const local = 'C:\\Users\\x\\AppData\\Local';
	process.env.DSH_HOME = missing;
	delete process.env.DSH_PROFILE_DIR;
	process.env.LOCALAPPDATA = local;
	try {
		const file = hostEndpointFile('C:\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe', target => {
			const value = String(target);
			if (value === missing) {
				throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
			}
			if (value.startsWith('D:')) {
				return { dev: 2, isDirectory: () => true };
			}
			return { dev: 1, isDirectory: () => !value.endsWith('.exe') };
		});
		assert.equal(file, 'C:\\Users\\x\\AppData\\Local\\dsh-ide\\host-endpoint.json');
		assert.equal(file.includes('node_modules'), false);
	} finally {
		for (const key of Object.keys(previous)) {
			if (previous[key] === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = previous[key];
			}
		}
	}
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
	assert.deepEqual(await bridge.invoke('setEffort', { sessionId: 's-1', effort: 'high' }), { accepted: true });
	assert.deepEqual(calls.map(c => c.name), ['projections', 'selectModel']);
	assert.deepEqual(calls[0].request, { sessionId: 's-1' });
	assert.deepEqual(calls[1].request, { sessionId: 's-1', provider: 'deepseek', model: 'chat', reasoningEffort: 'high' });
});

test('setEffort refuses an empty effort without querying the Host', async () => {
	const unexpected = () => { assert.fail('an invalid effort must not query the Host'); };
	const { bridge } = bridgeWith({ sessionController: { projections: unexpected, selectModel: unexpected } });
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	await assert.rejects(() => bridge.invoke('setEffort', { sessionId: 's-1', effort: '' }), error => error.code === INVALID_ARGUMENT);
});

test('setEffort refuses when the session has no current model selection', async () => {
	const controller = sessionControllerStub({
		projections: async () => ({ values: { modelSelection: { next: null } } }),
		selectModel: () => { assert.fail('a missing route must not re-select'); },
	});
	const { bridge } = bridgeWith({ sessionController: controller });
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	await assert.rejects(() => bridge.invoke('setEffort', { sessionId: 's-1', effort: 'high' }), error => error.code === FEATURE_UNAVAILABLE);
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

test('D52 deleteSession refuses a session that is still running', async () => {
	let pluginCalled = false;
	const { bridge } = bridgeWith({
		sessionController: { ...sessionControllerStub(), state: async () => ({ running: true }) },
		workspaceRegistry: { list: () => [{ id: 'w-1', sessionIds: ['s-1'] }], deleteSession: async () => { pluginCalled = true; return { deleted: true }; } },
	});
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	await assert.rejects(
		() => bridge.invoke('deleteSession', { sessionId: 's-1' }),
		error => error.code === FEATURE_UNAVAILABLE && /still running/.test(error.message),
	);
	assert.equal(pluginCalled, false, 'a running session must never reach the delete endpoint');
});

test('D52 deleteSession refuses when the running state cannot be proven', async () => {
	let pluginCalled = false;
	const { bridge } = bridgeWith({
		sessionController: { ...sessionControllerStub(), state: async () => { throw new Error('state unavailable'); } },
		workspaceRegistry: { list: () => [{ id: 'w-1', sessionIds: ['s-1'] }], deleteSession: async () => { pluginCalled = true; return { deleted: true }; } },
	});
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	await assert.rejects(
		() => bridge.invoke('deleteSession', { sessionId: 's-1' }),
		error => error.code === FEATURE_UNAVAILABLE && /cannot prove/.test(error.message),
	);
	assert.equal(pluginCalled, false, 'an unprovable state must never reach the delete endpoint');
});

test('D52 deleteSession proceeds only when the session is provably stopped', async () => {
	// 复用 success 用例的 registry 桩：它在返回 { deleted: true } 前 detach live 会话，
	// 这样 D52 前置判据与删除后核验（§8.10.1（3）8）同时得到验证。
	const { live } = bridgeWith();
	const registry = archiveRegistryStub({ deleted: true }, live);
	const ctx = fakeCtx({ sessions: { get: id => live.get(id) }, sessionController: { ...sessionControllerStub(), state: async () => ({ running: false }) }, workspaceRegistry: registry });
	const bridge = new DshIdeHostBridge(ctx, {});
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	assert.deepEqual(await bridge.invoke('deleteSession', { sessionId: 's-1' }), { accepted: true });
	assert.deepEqual(registry.calls, ['s-1'], 'a provably stopped session reaches the delete endpoint');
});

// ---------------------------------------------------------------------------
// D59（第 19 轮）：archiveSession / unarchiveSession 接线（§8.10.11）。
// 官方 workspace-controller 的公开 remote，不需第三方批准；返回完整归档集合，
// 契约按列表类投影为 string[]（不是 { accepted: true }）。
// ---------------------------------------------------------------------------

test('archiveSession calls workspaceController and returns the projected archive set', async () => {
	const calls = [];
	const { bridge } = bridgeWith({
		workspaceController: {
			archiveSession: async request => { calls.push(['archive', request]); return { archivedSessionIds: ['s-1', 's-2'] }; },
			unarchiveSession: async request => { calls.push(['unarchive', request]); return { archivedSessionIds: ['s-2'] }; },
		},
	});
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	assert.deepEqual(await bridge.invoke('archiveSession', { sessionId: 's-1' }), ['s-1', 's-2']);
	assert.deepEqual(calls[0], ['archive', { sessionId: 's-1' }]);
	assert.deepEqual(await bridge.invoke('unarchiveSession', { sessionId: 's-1' }), ['s-2']);
	assert.deepEqual(calls[1], ['unarchive', { sessionId: 's-1' }]);
});

test('archiveSession falls back to workspaceRegistry with a session id string', async () => {
	const calls = [];
	const registry = {
		list: () => [{ id: 'w-1', sessionIds: ['s-1'] }],
		archivedSessionIds: ['s-1'],
		archiveSession: async sessionId => { calls.push(sessionId); },
		unarchiveSession: async sessionId => { calls.push(sessionId); registry.archivedSessionIds = []; },
	};
	const { bridge } = bridgeWith({ workspaceRegistry: registry });
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	assert.deepEqual(await bridge.invoke('archiveSession', { sessionId: 's-1' }), ['s-1']);
	assert.deepEqual(calls, ['s-1']);
	assert.deepEqual(await bridge.invoke('unarchiveSession', { sessionId: 's-1' }), []);
	assert.deepEqual(calls, ['s-1', 's-1']);
});

test('archiveSession refuses when the registry lacks the official method', async () => {
	const { bridge } = bridgeWith({ workspaceRegistry: { list: () => [{ id: 'w-1', sessionIds: ['s-1'] }] } });
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	await assert.rejects(() => bridge.invoke('archiveSession', { sessionId: 's-1' }),
		error => error.code === FEATURE_UNAVAILABLE && /archiveSession/.test(error.message));
	await assert.rejects(() => bridge.invoke('unarchiveSession', { sessionId: 's-1' }),
		error => error.code === FEATURE_UNAVAILABLE && /unarchiveSession/.test(error.message));
});

test('archiveSession keeps ownership checks and propagates the official active-session refusal', async () => {
	let called = false;
	const { bridge } = bridgeWith({
		workspaceRegistry: {
			list: () => [{ id: 'w-1', sessionIds: ['s-1', 's-2'] }],
			archiveSession: async () => { called = true; const e = new Error('workspace/session-active'); e.code = 'workspace/session-active'; throw e; },
		},
	});
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	// 名单外的会话被拒绝，且不触达官方端点；名单内的行即使不是当前会话也允许操作。
	await assert.rejects(() => bridge.invoke('archiveSession', { sessionId: 's-9' }),
		error => error.code === SESSION_SWITCHED);
	assert.equal(called, false, 'an invisible session must not reach archiveSession');
	// 官方拒绝原样透传（不吞成 accepted、不自行决定强停）。
	await assert.rejects(() => bridge.invoke('archiveSession', { sessionId: 's-1' }),
		error => /workspace\/session-active/.test(error.message));
});

// ---------------------------------------------------------------------------
// loadOlder：Host 调 sessionController.page()，并把官方 SessionPage 投影成
// { accepted: true, page: { records, hasMore } }。cursor 不进返回值。
// ---------------------------------------------------------------------------

test('loadOlder calls sessionController.page with the official request shape', async () => {
	const calls = [];
	const older = { records: [{ seq: 3, type: 'user/message', time: 1, data: { text: 'earlier' } }], hasMore: true };
	const tail = { records: [], hasMore: false, cursor: 9 };
	const { bridge } = bridgeWith({
		sessionController: { ...sessionControllerStub(), page: async request => { calls.push(request); return calls.length === 1 ? older : tail; } },
	});
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	assert.deepEqual(await bridge.invoke('loadOlder', { sessionId: 's-1', throughSeq: 9, beforeSeq: 7, maxMessages: 20 }), { accepted: true, page: older });
	assert.deepEqual(calls[0], { address: { kind: 'session', sessionId: 's-1' }, throughSeq: 9, beforeSeq: 7, maxMessages: 20 });
	// 省略可选字段时不传该键；官方 cursor 被丢掉，只留 records + hasMore。
	assert.deepEqual(await bridge.invoke('loadOlder', { sessionId: 's-1' }), { accepted: true, page: { records: [], hasMore: false } });
	assert.deepEqual(calls[1], { address: { kind: 'session', sessionId: 's-1' } });
});

test('loadOlder refuses a page that is not records plus hasMore', async () => {
	const { bridge } = bridgeWith({
		sessionController: { ...sessionControllerStub(), page: async () => ({ cursor: 1, events: [] }) },
	});
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	await assert.rejects(() => bridge.invoke('loadOlder', { sessionId: 's-1' }), error => error.code === FEATURE_UNAVAILABLE);
});

test('loadOlder refuses a foreign session before touching the Host', async () => {
	const calls = [];
	const { bridge } = bridgeWith({
		sessionController: { ...sessionControllerStub(), page: async request => { calls.push(request); return { cursor: 1, events: [] }; } },
	});
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	await assert.rejects(() => bridge.invoke('loadOlder', { sessionId: 's-2' }), error => error.code === SESSION_SWITCHED);
	assert.equal(calls.length, 0, 'a foreign session must not reach sessionController.page');
});

// ---------------------------------------------------------------------------
// D59（第 22 轮）：searchSessions 接线——官方 session/search，只读；
// 返回 { items:{sessionId,snippet}[], hasMore }，依赖宿主挂载 dsh-session-query。
// ---------------------------------------------------------------------------

test('searchSessions calls sessionController.search and returns the neutral projection', async () => {
	const calls = [];
	const { bridge } = bridgeWith({
		sessionController: { ...sessionControllerStub(), search: async request => {
			calls.push(request);
			return { items: [{ sessionId: 's-1', snippet: 'found', score: 1 }], hasMore: true };
		} },
	});
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	assert.deepEqual(await bridge.invoke('searchSessions', { query: 'found' }), {
		items: [{ sessionId: 's-1', snippet: 'found' }],
		hasMore: true,
	});
	assert.deepEqual(calls[0], { query: 'found' });
});

test('renameSession tells open views to refresh the session list', async () => {
	const frames = [];
	const { bridge } = bridgeWith({
		sessionController: {
			...sessionControllerStub(),
			rename: async () => ({ accepted: true }),
			follow() { return (async function* () { await new Promise(() => undefined); })(); },
		},
	});
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	const handle = bridge.follow('s-1', frame => frames.push(frame));
	await bridge.invoke('renameSession', { sessionId: 's-1', title: '新标题' });
	assert.ok(frames.some(frame => frame.type === 'session-list'), 'rename must fan out session-list');
	handle.dispose();
});

test('a failed rename does not fan out a session-list refresh', async () => {
	const frames = [];
	const { bridge } = bridgeWith({
		sessionController: {
			...sessionControllerStub(),
			rename: async () => { throw new Error('rename failed'); },
		},
	});
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	const handle = bridge.follow('s-1', frame => frames.push(frame));
	await assert.rejects(() => bridge.invoke('renameSession', { sessionId: 's-1', title: '新标题' }));
	assert.equal(frames.some(frame => frame.type === 'session-list'), false);
	handle.dispose();
});

test('searchSessions propagates the official unavailable-provider failure', async () => {
	const { bridge } = bridgeWith({
		sessionController: { ...sessionControllerStub(), search: async () => {
			const error = new Error('session search is unavailable: this deployment does not mount @deepseek-ai/dsh-session-query');
			error.code = 'gateway/internal';
			throw error;
		} },
	});
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	// 不把「未挂载检索 provider」伪造成空结果。
	await assert.rejects(() => bridge.invoke('searchSessions', { query: 'x' }), error => /session search is unavailable/.test(error.message));
});

// ---------------------------------------------------------------------------
// U05 验收口径补强：取消请求与双窗口决议的关系。
// `cancelRequest` 此前只有形状校验、没有行为测试；这里钉住
// 「取消使请求结算为 cancelled、且后续决议必须得到 ALREADY_RESOLVED」。
// ---------------------------------------------------------------------------

test('cancelRequest settles the request as cancelled and blocks a later decision', async () => {
	const ctx = fakeCtx({ sessions: {}, sessionController: sessionControllerStub() });
	const bridge = new DshIdeHostBridge(ctx, { transport: { post: () => undefined } });
	bridge.follow('s-1', () => undefined);

	const handler = ctx.listeners.get('approval/request')[0];
	const pending = handler({ requestId: 'c-1', toolName: 'bash' }, () => 'rejected');

	// 取消即结算：settle 原样 resolve，所以 DSH 侧收到明确的 'cancelled'（不是批准、也不是 handler 默认值）。
	assert.deepEqual(await bridge.invoke('cancelRequest', { requestId: 'c-1' }), { accepted: true });
	assert.equal(await pending, 'cancelled', 'cancelling must settle the request with an explicit cancelled value');
	assert.equal(bridge.pending.size(), 0, 'cancelling must leave no pending entry');

	// 取消后再决议：同一个 requestId 必须得到 ALREADY_RESOLVED，且不改变结果。
	await assert.rejects(
		() => bridge.invoke('answerApproval', { requestId: 'c-1', decision: 'approve' }),
		error => error.code === ALREADY_RESOLVED,
	);
	// 未知 requestId 同样按 ALREADY_RESOLVED 处理（不静默成功）。
	await assert.rejects(
		() => bridge.invoke('cancelRequest', { requestId: 'nope' }),
		error => error.code === ALREADY_RESOLVED,
	);
});

test('closing the bridge drops the per-view generation table', async () => {
	// `_views` 每个出现过的 viewId 一条记录，由 adoptBinding 写入。桥关闭后旧代次
	// 不再有意义，不清就会在内存里攒下历史上每个窗口的 id。
	const { bridge } = bridgeWith({ sessionController: sessionControllerStub({}) });
	bridge.adoptBinding({ viewId: 'view-1', generation: 1, sessionId: null });
	assert.ok(bridge._views.has('view-1'), 'the view must be tracked while bound');
	bridge.close();
	assert.equal(bridge._views.size, 0, 'close must drop the whole table');
});

test('the model catalog is read once per refresh, not once per call', async () => {
	// composerState 与 listModels 要的是同一份目录。一次输入框刷新会连着问好几次，
	// 每次都向内核要一遍是纯浪费；2 秒内的重复调用应复用同一次结果。
	let reads = 0;
	const controller = sessionControllerStub({
		projections: async () => ({ values: {} }),
		modelCatalog: async () => {
			reads += 1;
			return { groups: [{ id: 'xai', models: [{ id: 'm', name: 'M' }] }] };
		},
	});
	const { bridge } = bridgeWith({ sessionController: controller });
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	await bridge.invoke('composerState', { sessionId: 's-1' });
	await bridge.invoke('composerState', { sessionId: 's-1' });
	await bridge.invoke('listModels', {});
	assert.equal(reads, 1, 'three reads within the window must hit the kernel once');
	// 关窗后缓存必须失效：不能让下一个会话读到上一轮的目录。
	bridge.close();
	await bridge.invoke('listModels', {});
	assert.equal(reads, 2, 'a close must drop the cached catalog');
});

test('composerState keeps only the fields the input bar renders', async () => {
	const controller = sessionControllerStub({
		projections: async () => ({ values: {
			modelSelection: { next: { provider: 'xai', model: 'grok-4.7', reasoningEffort: 'xhigh' }, lastUsed: { provider: 'xai' } },
			permissions: { currentValue: 'workspace-write' },
			agentTeam: { enabled: true, tasks: [{ id: 'hidden' }] },
			agentPreset: 'create',
		} }),
		modelCatalog: async () => ({ groups: [{
			id: 'xai',
			name: 'xAI',
			models: [{ id: 'grok-4.7', name: 'grok-4.7', reasoning: { efforts: [{ id: 'xhigh', name: 'Xhigh' }], defaultEffort: 'xhigh' }, badge: 'secret' }],
		}] }),
	});
	const { bridge } = bridgeWith({
		sessionController: controller,
		permissionPresets: { catalog: () => ({ options: [{ value: 'workspace-write', name: '工作区写入' }, { value: 'custom', name: '自定义' }] }) },
		agentPresets: { list: async () => [{ id: 'create', name: '创造模式' }, { id: 'bad', name: '坏的', broken: 'no' }] },
	});
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	assert.deepEqual(await bridge.invoke('composerState', { sessionId: 's-1' }), {
		model: {
			current: { provider: 'xai', model: 'grok-4.7', effort: 'xhigh' },
			groups: [{ id: 'xai', name: 'xAI', models: [{ id: 'grok-4.7', name: 'grok-4.7', efforts: [{ id: 'xhigh', name: 'Xhigh' }], defaultEffort: 'xhigh' }] }],
		},
		permission: { current: 'workspace-write', options: [{ value: 'workspace-write', name: '工作区写入' }] },
		team: { enabled: true, confirmDisable: true },
		preset: { current: 'create', options: [{ id: 'create', name: '创造模式' }] },
	});
});

test('setTeamEnabled and setAgentPreset call the official services on the live agent', async () => {
	const agent = { id: 's-1' };
	const calls = [];
	const { bridge } = bridgeWith({
		agents: { get: id => id === 's-1' ? agent : undefined },
		agentTeams: { setEnabled: async (who, enabled) => { calls.push(['team', who, enabled]); } },
		agentPresets: { select: async (who, preset) => { calls.push(['preset', who, preset]); return preset; } },
	});
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	assert.deepEqual(await bridge.invoke('setTeamEnabled', { sessionId: 's-1', enabled: true }), { accepted: true });
	assert.deepEqual(await bridge.invoke('setAgentPreset', { sessionId: 's-1', preset: 'create' }), { accepted: true });
	assert.deepEqual(calls, [['team', agent, true], ['preset', agent, 'create']]);
	await assert.rejects(() => bridge.invoke('setAgentPreset', { sessionId: 's-1', preset: 'has space' }), error => error.code === INVALID_ARGUMENT);
});

test('archiving fans out the session list so other windows re-group the row', async () => {
	// 归档会改变名单归属。不 fanout 的话，其它窗口会继续把这一行画在原来的分组里，
	// 只有发起归档的那个窗口靠返回值更新了自己。
	const frames = [];
	const { bridge } = bridgeWith({
		sessionController: {
			...sessionControllerStub(),
			follow() { return (async function* () { await new Promise(() => undefined); })(); },
		},
		workspaceController: {
			archiveSession: async () => ({ archivedSessionIds: ['s-1'] }),
			unarchiveSession: async () => ({ archivedSessionIds: [] }),
		},
	});
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	const handle = bridge.follow('s-1', frame => frames.push(frame));
	frames.length = 0;
	await bridge.invoke('archiveSession', { sessionId: 's-1' });
	assert.ok(frames.some(frame => frame && frame.type === 'session-list'), 'archive must fan out session-list');
	frames.length = 0;
	await bridge.invoke('unarchiveSession', { sessionId: 's-1' });
	assert.ok(frames.some(frame => frame && frame.type === 'session-list'), 'unarchive must fan out session-list');
	handle.dispose();
});

test('answering an approval or a question tells the other views to drop the card', async () => {
	// 答复是终态。只结算本表不广播的话，别的窗口会一直显示一张已经答过的卡片。
	// `cancelRequest` 早就这么做了，答复路径漏了。
	for (const [method, args] of [
		['answerApproval', { requestId: 'r-1', decision: 'approve' }],
		['answerQuestion', { requestId: 'r-2', answer: { answers: [{ id: 'q1', selected: ['a'] }] } }],
	]) {
		const frames = [];
		const { bridge } = bridgeWith({
			sessionController: {
				...sessionControllerStub(),
				follow() { return (async function* () { await new Promise(() => undefined); })(); },
			},
		});
		bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
		const handle = bridge.follow('s-1', frame => frames.push(frame));
		// 先登记一条待决议请求，settle 才可能成功。
		bridge.pending.register(method === 'answerApproval' ? 'approval' : 'question', args.requestId);
		frames.length = 0;
		await bridge.invoke(method, args);
		assert.ok(
			frames.some(frame => frame && frame.type === 'waterfall' && frame.eventId === args.requestId),
			`${method} must broadcast the terminal state to the other views`,
		);
		handle.dispose();
	}
});

test('closing the bridge drops its broadcast listeners', async () => {
	// 关掉的窗口不该继续收到广播：留着的话，后续每次 `_fanout` 都会调到
	// 已经关掉的窗口回调，白做一轮遍历还可能往死掉的 transport 写帧。
	const frames = [];
	const { bridge } = bridgeWith({ sessionController: sessionControllerStub({}) });
	// 未绑定会话的视图走 `_statusListeners`（绑定后的视图走 follow 流，另一条路径）。
	const handle = bridge.follow(undefined, frame => frames.push(frame));
	assert.ok(bridge._statusListeners.size > 0, 'an unbound view must be listening');
	bridge.close();
	assert.equal(bridge._statusListeners.size, 0, 'close must drop the broadcast listeners');
	frames.length = 0;
	bridge._fanout({ type: 'session-list' });
	assert.deepEqual(frames, [], 'a closed view must not receive frames');
	handle.dispose();
});

test('close clears every per-bridge collection', async () => {
	// 桥是长生命周期对象，五个集合各自累积一类状态。少清一个就会在
	// 反复开关窗口后留下越积越多的条目。
	const { bridge } = bridgeWith({ sessionController: sessionControllerStub({}) });
	bridge.open({ view: 'chat', params: { sessionId: 's-1' } });
	bridge.follow(undefined, () => undefined);
	bridge.enqueueToggle('pin:s-1', async () => undefined);
	bridge.adoptBinding({ viewId: 'v-1', generation: 1, sessionId: null });
	bridge._modelCatalogCache = { at: Date.now(), value: {} };
	bridge.close();
	for (const name of ['_sessionReads', '_follows', '_statusListeners', '_toggles', '_views']) {
		const value = bridge[name];
		const size = typeof value?.size === 'number' ? value.size : undefined;
		assert.equal(size, 0, `${name} must be empty after close`);
	}
	assert.equal(bridge._modelCatalogCache, undefined, '_modelCatalogCache must be dropped after close');
});

