/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P3 验收单测：IDE 侧官方客户端传输适配（`platform/dshClient/transport/`）。
//
// 用假 fetch / 假 WebSocket 验证官方线协议形状（第 2 章 §2.2.1），不需要真实 Host：
//   - 鉴权：GET /?token=… → 303 + set-cookie → 返回 cookie；
//   - 一元：POST /api/<ns>/<method>，信封 { type, rpcId, method, payload:{args} }；
//   - 流式：WS /api/remote.mux，{ type:'open', streamId, endpoint, payload:{args} }；
//   - waterfall：$events 流 ready → clientId，决议经 POST /api/$events/result；
//   - 未核对的 method 明确 feature-unavailable，绝不猜端点。
//
// 运行：node --experimental-strip-types --test build/lib/test/dshIdeTransport.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import {
	DSH_IDE_FEATURE_UNAVAILABLE,
	DSH_IDE_SESSION_SWITCHED,
	type DshIdeMethod,
} from '../../../src/vs/platform/dshClient/common/dshIdeProtocol.ts';
import {
	DshIdeTransport,
	DshIdeTransportBackend,
	DshIdeTransportError,
	authenticateHost,
	type DshIdeStreamFrame,
} from '../../../src/vs/platform/dshClient/transport/dshIdeTransport.ts';

interface RecordedRequest {
	readonly url: string;
	readonly init: RequestInit;
	readonly body: unknown;
}

interface FakeHostResponse {
	readonly status?: number;
	readonly json?: unknown;
	readonly headers?: Record<string, string>;
}

/** 假 Host：按路由返回预设响应，并记录每个请求。 */
function fakeHost(routes: (url: string, body: unknown) => FakeHostResponse | Promise<FakeHostResponse>) {
	const requests: RecordedRequest[] = [];
	const primitives = {
		fetch: async (input: string | URL, init: RequestInit) => {
			const url = String(input);
			const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
			requests.push({ url, init, body });
			const answer = await routes(url, body);
			const status = answer.status ?? 200;
			const headers = new Headers(answer.headers ?? {});
			return new Response(answer.json === undefined ? null : JSON.stringify(answer.json), { status, headers });
		},
		WebSocket: FakeWebSocket as never,
	};
	return { requests, primitives };
}

/** 假 WebSocket：记录发出的帧，并可程序化地下行消息。 */
class FakeWebSocket {
	static instances: FakeWebSocket[] = [];
	readonly url: string;
	readyState = 0;
	sent: unknown[] = [];
	private readonly listeners = new Map<string, ((payload: unknown) => void)[]>();

	constructor(url: string) {
		this.url = url;
		FakeWebSocket.instances.push(this);
	}

	send(data: string): void {
		this.sent.push(JSON.parse(data));
	}

	close(): void {
		this.readyState = 3;
		for (const listener of this.listeners.get('close') ?? []) {
			listener({});
		}
	}

	addEventListener(event: string, listener: (payload: unknown) => void): void {
		const bucket = this.listeners.get(event) ?? [];
		bucket.push(listener);
		this.listeners.set(event, bucket);
	}

	/** 模拟只有 error 事件、尚未收到 close 的网络故障。 */
	fail(): void {
		for (const listener of this.listeners.get('error') ?? []) {
			listener({});
		}
	}

	/** 模拟 Host 下行一条文本帧。 */
	deliver(message: unknown): void {
		for (const listener of this.listeners.get('message') ?? []) {
			listener({ data: JSON.stringify(message) });
		}
	}

	/** 模拟连接建立。 */
	open(): void {
		this.readyState = 1;
		for (const listener of this.listeners.get('open') ?? []) {
			listener({});
		}
	}
}

/** 每次用例前清空假 socket 记录。 */
function resetSockets(): void {
	FakeWebSocket.instances = [];
}

function userMessageRpc(method: string, value: unknown) {
	return (url: string) => {
		if (!url.endsWith(`/api/${method}`)) {
			return { status: 404 };
		}
		return { json: { type: 'server-response', rpcId: 'ignored', result: { ok: true, value } } };
	};
}

// ---------------------------------------------------------------------------
// 鉴权
// ---------------------------------------------------------------------------

test('authenticateHost exchanges the launch token for a cookie', async () => {
	const { requests, primitives } = fakeHost(url => {
		assert.match(url, /\?token=t0ken$/);
		return { status: 303, headers: { 'set-cookie': 'dsh.sid=abc123; Path=/; HttpOnly' } };
	});
	const cookie = await authenticateHost('http://127.0.0.1:9', 'http://127.0.0.1:9/?token=t0ken', primitives);
	assert.equal(cookie, 'dsh.sid=abc123', 'cookie must drop attributes after the first semicolon');
	assert.equal(requests[0].init.redirect, 'manual', 'authentication must not follow the redirect');
});

test('authenticateHost fails loudly on a non-303 answer', async () => {
	const { primitives } = fakeHost(() => ({ status: 401 }));
	await assert.rejects(
		() => authenticateHost('http://127.0.0.1:9', 'http://127.0.0.1:9/?token=bad', primitives),
		(error: DshIdeTransportError) => error.code === 'dsh-ide/host-authentication-failed',
	);
});

// D55：异常路径负向测试——fetch 抛出的错误若含完整 launchUrl / token，
// 对外错误文案必须脱敏，不能把认证材料投影给 renderer（§8.8.7）。
test('D55 authenticateHost redacts a token-bearing fetch failure', async () => {
	const primitives = {
		fetch: async () => { throw new Error('network error at http://127.0.0.1:9/?token=t0ken: refused'); },
		WebSocket: FakeWebSocket as never,
	};
	await assert.rejects(
		() => authenticateHost('http://127.0.0.1:9', 'http://127.0.0.1:9/?token=t0ken', primitives),
		(error: DshIdeTransportError) => {
			assert.equal(error.code, 'dsh-ide/host-authentication-failed');
			assert.ok(!error.message.includes('t0ken'), 'the launch token must not leak into the error message');
			assert.ok(!error.message.includes('?token'), 'the query must not leak into the error message');
			return true;
		},
	);
});

// ---------------------------------------------------------------------------
// 一元 RPC：信封形状 + rpcId 回显 + 错误传播
// ---------------------------------------------------------------------------

test('call posts the official client-request envelope with the cookie', async () => {
	const { requests, primitives } = fakeHost((url, body) => ({
		json: { type: 'server-response', rpcId: (body as { rpcId: string }).rpcId, result: { ok: true, value: { items: [] } } },
	}));
	const transport = new DshIdeTransport({ origin: 'http://127.0.0.1:9', cookie: 'dsh.sid=abc', primitives });
	const value = await transport.call('session', 'list', {});

	assert.deepEqual(value, { items: [] });
	const request = requests[0];
	assert.ok(request.url.endsWith('/api/session/list'), `endpoint must be /api/<ns>/<method>, got ${request.url}`);
	assert.equal((request.init.headers as Record<string, string>)['cookie'], 'dsh.sid=abc');
	const body = request.body as Record<string, unknown>;
	assert.equal(body['type'], 'client-request');
	assert.equal(body['method'], 'session/list');
	assert.deepEqual(body['payload'], { args: {} }, 'payload must carry exactly the args object');
	transport.dispose();
});

test('call propagates the official error code and details', async () => {
	const { primitives } = fakeHost((_url, body) => ({
		json: {
			type: 'server-response',
			rpcId: (body as { rpcId: string }).rpcId,
			result: { ok: false, error: { code: 'session/provider-models-unavailable', message: 'no models', details: { provider: 'x' } } },
		},
	}));
	const transport = new DshIdeTransport({ origin: 'http://127.0.0.1:9', cookie: 'c', primitives });
	await assert.rejects(
		() => transport.call('session', 'modelCatalog', {}),
		(error: DshIdeTransportError) => error.code === 'session/provider-models-unavailable' && (error.details as { provider?: string }).provider === 'x',
	);
	transport.dispose();
});

test('call rejects a mismatched rpcId instead of trusting the body', async () => {
	const { primitives } = fakeHost(() => ({
		json: { type: 'server-response', rpcId: 'someone-elses', result: { ok: true, value: 1 } },
	}));
	const transport = new DshIdeTransport({ origin: 'http://127.0.0.1:9', cookie: 'c', primitives });
	await assert.rejects(() => transport.call('session', 'list', {}), (error: DshIdeTransportError) => error.code === 'dsh-ide/transport-corrupt');
	transport.dispose();
});

// ---------------------------------------------------------------------------
// 流式：remote.mux 的 open / item / end 形态
// ---------------------------------------------------------------------------

test('openStream sends the official open frame and delivers items', () => {
	resetSockets();
	const { primitives } = fakeHost(() => ({ json: null }));
	const transport = new DshIdeTransport({ origin: 'http://127.0.0.1:9', cookie: 'c', primitives });
	const frames: DshIdeStreamFrame[] = [];
	const stream = transport.openStream('session/follow', {
		address: { kind: 'session', sessionId: 's-1' },
		assistantStream: true,
	}, frame => frames.push(frame));

	const socket = FakeWebSocket.instances[0];
	assert.match(socket.url, /^ws:\/\/127\.0\.0\.1:9\/api\/remote\.mux$/, 'stream socket must use the official mux path');
	// CONNECTING 期间不得直接 send（真机实测会抛 InvalidStateError: Sent before connected），
	// 帧必须先入队，等 open 事件后按序 flush。
	assert.equal(socket.sent.length, 0, 'no frame may be sent before the socket is open');
	socket.open();
	assert.equal(socket.sent.length, 1, 'the queued open frame flushes on open');
	const open = socket.sent[0] as Record<string, unknown>;
	assert.equal(open['type'], 'open');
	assert.equal(open['endpoint'], 'session/follow');
	assert.equal(open['streamId'], stream.streamId);
	// 传输层原样转发调用方给的 args（形参名约定由 backend 负责）。
	assert.deepEqual(open['payload'], { args: { address: { kind: 'session', sessionId: 's-1' }, assistantStream: true } });

	socket.deliver({ type: 'item', streamId: stream.streamId, value: { type: 'snapshot', cursor: 3 } });
	socket.deliver({ type: 'item', streamId: stream.streamId, value: { type: 'event', event: { type: 'user/message', seq: 1 } } });
	assert.deepEqual(frames.map(frame => frame.type), ['snapshot', 'event']);

	stream.close();
	assert.deepEqual(socket.sent.at(-1), { type: 'cancel', streamId: stream.streamId });
	transport.dispose();
});

test('stream errors surface as transport errors and drop the stream', () => {
	resetSockets();
	const { primitives } = fakeHost(() => ({ json: null }));
	const transport = new DshIdeTransport({ origin: 'http://127.0.0.1:9', cookie: 'c', primitives });
	const errors: DshIdeTransportError[] = [];
	transport.openStream('session/follow', {}, () => undefined, error => errors.push(error));
	const socket = FakeWebSocket.instances[0];
	socket.open();
	const streamId = (socket.sent[0] as { streamId: string }).streamId;
	socket.deliver({ type: 'error', streamId, error: { code: 'gateway/arguments-invalid', message: 'bad args', details: {} } });
	assert.equal(errors.length, 1);
	assert.equal(errors[0].code, 'gateway/arguments-invalid');
	transport.dispose();
});

// ---------------------------------------------------------------------------
// waterfall：ready → clientId，决议回投 $events/result
// ---------------------------------------------------------------------------

test('waterfall decisions post clientId + eventId + outcome', async () => {
	resetSockets();
	const { requests, primitives } = fakeHost((url, body) => {
		if (url.endsWith('/api/$events/result')) {
			return { json: { type: 'server-response', rpcId: (body as { rpcId: string }).rpcId, result: { ok: true, value: undefined } } };
		}
		return { json: null };
	});
	const transport = new DshIdeTransport({ origin: 'http://127.0.0.1:9', cookie: 'c', primitives });
	const frames: DshIdeStreamFrame[] = [];
	transport.openStream('$events', {}, frame => frames.push(frame));
	const socket = FakeWebSocket.instances[0];
	socket.open();
	const streamId = (socket.sent[0] as { streamId: string }).streamId;

	socket.deliver({ type: 'item', streamId, value: { type: 'ready', clientId: 'client-1', host: { home: '/home' } } });
	socket.deliver({ type: 'item', streamId, value: { type: 'waterfall', eventId: 'ev-1', event: 'approval/request', agentId: 'a1', request: { toolName: 'bash' } } });
	assert.deepEqual(frames.map(frame => frame.type), ['ready', 'waterfall']);

	await transport.answerWaterfall('ev-1', { kind: 'result', value: 'allowed-once' });
	const result = requests.find(request => request.url.endsWith('/api/$events/result'));
	assert.ok(result !== undefined, 'the decision must be posted to $events/result');
	assert.deepEqual((result.body as { payload: unknown }).payload, {
		args: { clientId: 'client-1', eventId: 'ev-1', outcome: { kind: 'result', value: 'allowed-once' } },
	});
	transport.dispose();
});

test('waterfall decision before ready fails with a defined code', async () => {
	resetSockets();
	const { primitives } = fakeHost(() => ({ json: null }));
	const transport = new DshIdeTransport({ origin: 'http://127.0.0.1:9', cookie: 'c', primitives });
	await assert.rejects(
		() => transport.answerWaterfall('ev-1', { kind: 'next' }),
		(error: DshIdeTransportError) => error.code === 'dsh-ide/event-stream-not-ready',
	);
	transport.dispose();
});

// ---------------------------------------------------------------------------
// DshIdeBackend 适配：method → 官方端点映射
// ---------------------------------------------------------------------------

function backendWithHost(handler: (url: string, body: unknown) => FakeHostResponse | Promise<FakeHostResponse>) {
	resetSockets();
	const host = fakeHost(handler);
	const transport = new DshIdeTransport({ origin: 'http://127.0.0.1:9', cookie: 'c', primitives: host.primitives });
	const backend = new DshIdeTransportBackend(transport);
	backend.open({ view: 'chat', params: { sessionId: 's-1' } });
	return { backend, transport, requests: host.requests };
}

const OK = (url: string, body: unknown) => ({
	json: { type: 'server-response', rpcId: (body as { rpcId: string }).rpcId, result: { ok: true, value: { accepted: true } } },
});

test('backend maps submit/interrupt/setModel to verified session endpoints', async () => {
	const { backend, transport, requests } = backendWithHost(OK);

	await backend.invoke('submit', { text: 'hi' });
	await backend.invoke('interrupt', {});
	await backend.invoke('setModel', { model: 'deepseek/deepseek-chat' });

	assert.deepEqual(requests.map(request => request.url.split('/api/')[1]), ['session/prompt', 'session/cancel', 'session/selectModel']);
	// 参数键必须等于服务方法形参名：prompt(request, signal) / cancel(request)
	const prompt = requests[0].body as { payload: { args: { request: Record<string, unknown> } } };
	assert.equal(prompt.payload.args.request['sessionId'], 's-1');
	assert.equal(prompt.payload.args.request['mode'], 'queue');
	assert.deepEqual(prompt.payload.args.request['content'], [{ type: 'text', text: 'hi' }]);
	const cancel = requests[1].body as { payload: { args: { request: Record<string, unknown> } } };
	assert.equal(cancel.payload.args.request['sessionId'], 's-1');
	const select = requests[2].body as { payload: { args: { request: Record<string, unknown> } } };
	assert.deepEqual(
		{ provider: select.payload.args.request['provider'], model: select.payload.args.request['model'] },
		{ provider: 'deepseek', model: 'deepseek-chat' },
	);
	transport.dispose();
});

test('backend refuses unverified capabilities with feature-unavailable', async () => {
	const { backend, transport, requests } = backendWithHost(OK);
	const refusing: DshIdeMethod[] = ['rewind', 'loadOlder'];
	for (const method of refusing) {
		await assert.rejects(
			() => backend.invoke(method, {}),
			(error: DshIdeTransportError) => error.code === DSH_IDE_FEATURE_UNAVAILABLE,
			`${method} must be refused, never guessed`,
		);
	}
	assert.equal(requests.length, 0, 'refused capabilities must not hit the Host at all');
	transport.dispose();
});

// D13：setEffort（§8.10.9 已核对落点：session/projections → session/selectModel）。
test('backend maps setEffort to projections then selectModel with reasoningEffort', async () => {
	const { backend, transport, requests } = backendWithHost((url, body) => {
		const rpcId = (body as { rpcId: string }).rpcId;
		if (url.endsWith('/api/session/projections')) {
			return { json: { type: 'server-response', rpcId, result: { ok: true, value: { values: { modelSelection: { next: { provider: 'deepseek', model: 'chat' } } } } } } };
		}
		return OK(url, body);
	});
	await backend.invoke('setEffort', { effort: 'high' });
	assert.deepEqual(requests.map(r => r.url.split('/api/')[1]), ['session/projections', 'session/selectModel']);
	const projections = requests[0].body as { payload: { args: { request: Record<string, unknown> } } };
	assert.deepEqual(projections.payload.args.request, { sessionId: 's-1' });
	const select = requests[1].body as { payload: { args: { request: Record<string, unknown> } } };
	assert.deepEqual(select.payload.args.request, { sessionId: 's-1', provider: 'deepseek', model: 'chat', reasoningEffort: 'high' });
	transport.dispose();
});

test('backend refuses setEffort with an empty effort without hitting the Host', async () => {
	const { backend, transport, requests } = backendWithHost(OK);
	await assert.rejects(
		() => backend.invoke('setEffort', { effort: '' }),
		(error: DshIdeTransportError) => error.code === 'dsh-ide/invalid-argument',
	);
	assert.equal(requests.length, 0);
	transport.dispose();
});

test('backend refuses setEffort when projections carry no current model', async () => {
	const { backend, transport, requests } = backendWithHost((url, body) => {
		const rpcId = (body as { rpcId: string }).rpcId;
		return { json: { type: 'server-response', rpcId, result: { ok: true, value: { values: { modelSelection: { next: null } } } } } };
	});
	await assert.rejects(
		() => backend.invoke('setEffort', { effort: 'high' }),
		(error: DshIdeTransportError) => error.code === DSH_IDE_FEATURE_UNAVAILABLE,
	);
	assert.equal(requests.length, 1, 'must read projections once, then refuse without re-selecting');
	transport.dispose();
});

// ---------------------------------------------------------------------------
// P4 会话列表：官方工作区首帧、可见名单交集与读取生命周期
// ---------------------------------------------------------------------------

function sessionItem(sessionId: string, fields: Record<string, unknown> = {}) {
	return { sessionId, updatedAt: 123, running: false, blank: false, agentAvailable: true, ...fields };
}

function listReply(body: unknown, items: unknown[]): FakeHostResponse {
	return { json: { type: 'server-response', rpcId: (body as { rpcId: string }).rpcId, result: { ok: true, value: { items } } } };
}

function workspaceOpen(socket: FakeWebSocket, index = 0): { streamId: string; payload: { args: unknown } } {
	const frames = socket.sent.filter(frame => (frame as { type: string; endpoint?: string }).type === 'open' && (frame as { endpoint?: string }).endpoint === 'workspace/follow');
	assert.ok(frames[index], 'listSessions must open the official workspace/follow endpoint');
	return frames[index] as { streamId: string; payload: { args: unknown } };
}

function deliverWorkspaceBaseline(socket: FakeWebSocket, streamId: string, items = [{ workspaceId: 'w-1', sessionIds: ['s-1'] }]): void {
	socket.deliver({ type: 'item', streamId, value: { type: 'baseline', value: { items, archivedSessionIds: [], pinnedSessionIds: [] } } });
}

/** 可控响应故意不自行响应 abort，用于确认关闭不依赖晚到的网络结果。 */
function deferredListBackend() {
	let release!: (value: FakeHostResponse) => void;
	const reply = new Promise<FakeHostResponse>(resolve => { release = resolve; });
	const fixture = backendWithHost(() => reply);
	return { ...fixture, release: (items: unknown[]) => release(listReply(fixture.requests[0].body, items)) };
}

test('listSessions projects official fields and the visible workspace intersection without disturbing Chat', async () => {
	const { backend, requests } = backendWithHost((_url, body) => listReply(body, [
		sessionItem('foreign', { cwd: '/same' }),
		sessionItem('s-1', { title: 'ignored legacy title', projections: { values: { title: 'Official title' } }, cwd: '/same', formatStatus: 'current' }),
		sessionItem('s-2', { updatedAt: 456, running: true, blank: true, agentAvailable: false, formatStatus: 'migration-required', parentSessionId: 's-1', origin: 'subagent', projections: { values: { title: '' } } }),
		sessionItem('untitled'),
		sessionItem('null-title', { projections: { values: { title: null } } }),
		sessionItem('unregistered', { cwd: '/same' }),
	]));
	const seen: unknown[] = [];
	const chat = backend.follow('s-1', frame => seen.push(frame));
	const socket = FakeWebSocket.instances[0];
	socket.open();
	const chatId = (socket.sent[0] as { streamId: string }).streamId;
	const result = backend.invoke('listSessions', {});
	const open = workspaceOpen(socket);
	assert.deepEqual(open.payload, { args: {} }, 'follow has no caller-supplied signal or request argument');
	assert.equal(requests.length, 1);
	assert.ok(requests[0].url.endsWith('/api/session/list'));
	assert.deepEqual((requests[0].body as { payload: unknown }).payload, { args: { _request: {} } });
	deliverWorkspaceBaseline(socket, open.streamId, [
		{ workspaceId: 'w-1', sessionIds: ['s-1', 's-2', 'untitled', 'null-title', 'acl-denied', 'removed'] },
		{ workspaceId: 'w-2', sessionIds: ['foreign'] },
	]);
	assert.deepEqual(await result, [
		{ sessionId: 's-1', workspaceId: 'w-1', title: 'Official title', updatedAt: 123, running: false, blank: false, agentAvailable: true, cwd: '/same', formatStatus: 'current' },
		{ sessionId: 's-2', workspaceId: 'w-1', title: '', updatedAt: 456, running: true, blank: true, agentAvailable: false, formatStatus: 'migration-required', parentSessionId: 's-1', origin: 'subagent' },
		{ sessionId: 'untitled', workspaceId: 'w-1', updatedAt: 123, running: false, blank: false, agentAvailable: true },
		{ sessionId: 'null-title', workspaceId: 'w-1', updatedAt: 123, running: false, blank: false, agentAvailable: true },
	]);
	assert.deepEqual(socket.sent.filter(frame => (frame as { type: string }).type === 'cancel'), [{ type: 'cancel', streamId: open.streamId }]);
	assert.equal(socket.readyState, 1, 'reading the baseline must not close the shared socket');
	socket.deliver({ type: 'item', streamId: open.streamId, value: { type: 'upsert', workspace: { workspaceId: 'w-1', sessionIds: ['foreign'] } } });
	socket.deliver({ type: 'item', streamId: chatId, value: { type: 'event', event: { type: 'user/message', seq: 4 } } });
	assert.equal(seen.length, 1, 'the Chat stream remains active and never receives workspace frames');
	chat.dispose();
	assert.deepEqual(socket.sent.at(-1), { type: 'cancel', streamId: chatId });
	backend.close();
});

test('listSessions does not request the Host when no session is bound', async () => {
	for (const sessionId of [undefined, '']) {
		resetSockets();
		const host = fakeHost(() => { throw new Error('unexpected request'); });
		const transport = new DshIdeTransport({ origin: 'http://127.0.0.1:9', cookie: 'c', primitives: host.primitives });
		const backend = new DshIdeTransportBackend(transport);
		assert.deepEqual(await backend.invoke('listSessions', {}), []);
		backend.open({ view: 'chat', params: sessionId === undefined ? {} : { sessionId } });
		assert.deepEqual(await backend.invoke('listSessions', {}), []);
		backend.close();
		assert.deepEqual(await backend.invoke('listSessions', {}), []);
		assert.equal(host.requests.length, 0);
		assert.equal(FakeWebSocket.instances.length, 0);
	}
});

for (const scope of ['missing-workspace', 'multiple-owners', 'bound-session-not-visible', 'workspace-membership-not-visible'] as const) {
	test(`listSessions fails closed for ${scope}`, async () => {
		const items = scope === 'bound-session-not-visible' ? [sessionItem('s-2')] : [sessionItem('s-1'), sessionItem('s-2')];
		const { backend } = backendWithHost((_url, body) => listReply(body, items));
		const result = backend.invoke('listSessions', {});
		const socket = FakeWebSocket.instances[0];
		socket.open();
		const workspaces = scope === 'missing-workspace' ? [] : scope === 'workspace-membership-not-visible'
			? [{ workspaceId: 'w-1', sessionIds: ['s-2'] }]
			: [{ workspaceId: 'w-1', sessionIds: ['s-1', 's-2'] }];
		if (scope === 'multiple-owners') {
			workspaces.push({ workspaceId: 'w-2', sessionIds: ['s-1'] });
		}
		deliverWorkspaceBaseline(socket, workspaceOpen(socket).streamId, workspaces);
		assert.deepEqual(await result, []);
		backend.close();
	});
}

test('listSessions refreshes both official sources and never serves a prior membership', async () => {
	let items = [sessionItem('s-1'), sessionItem('s-2')];
	const { backend, requests } = backendWithHost((_url, body) => listReply(body, items));
	const first = backend.invoke('listSessions', {});
	const socket = FakeWebSocket.instances[0];
	socket.open();
	deliverWorkspaceBaseline(socket, workspaceOpen(socket).streamId, [{ workspaceId: 'w-1', sessionIds: ['s-1', 's-2'] }]);
	assert.equal((await first as unknown[]).length, 2);
	items = [sessionItem('s-1', { updatedAt: 999 }), sessionItem('s-2')];
	const second = backend.invoke('listSessions', {});
	deliverWorkspaceBaseline(socket, workspaceOpen(socket, 1).streamId);
	assert.deepEqual(await second, [{ sessionId: 's-1', workspaceId: 'w-1', updatedAt: 999, running: false, blank: false, agentAvailable: true }]);
	assert.equal(requests.length, 2);
	assert.equal(socket.sent.filter(frame => (frame as { type: string }).type === 'cancel').length, 2);
	backend.close();
});

test('listSessions releases its baseline before the unary response finishes', async () => {
	const { backend, release } = deferredListBackend();
	const result = backend.invoke('listSessions', {});
	const socket = FakeWebSocket.instances[0];
	socket.open();
	const { streamId } = workspaceOpen(socket);
	deliverWorkspaceBaseline(socket, streamId);
	await Promise.resolve();
	assert.deepEqual(socket.sent.at(-1), { type: 'cancel', streamId });
	release([sessionItem('s-1')]);
	assert.equal((await result as unknown[]).length, 1);
	assert.equal(socket.sent.filter(frame => (frame as { type: string }).type === 'cancel').length, 1);
	backend.close();
});

test('listSessions cancels the temporary stream on unary failure and leaves Chat running', async () => {
	const { backend } = backendWithHost((_url, body) => ({
		json: { type: 'server-response', rpcId: (body as { rpcId: string }).rpcId, result: { ok: false, error: { code: 'session/list-failed', message: 'read failed', details: { retry: false } } } },
	}));
	const seen: unknown[] = [];
	backend.follow('s-1', frame => seen.push(frame));
	const socket = FakeWebSocket.instances[0];
	socket.open();
	const chatId = (socket.sent[0] as { streamId: string }).streamId;
	const result = backend.invoke('listSessions', {});
	const { streamId } = workspaceOpen(socket);
	await assert.rejects(result, (error: DshIdeTransportError) => error.code === 'session/list-failed' && (error.details as { retry: boolean }).retry === false);
	assert.deepEqual(socket.sent.at(-1), { type: 'cancel', streamId });
	socket.deliver({ type: 'item', streamId: chatId, value: { type: 'event', event: { type: 'user/message', seq: 1 } } });
	assert.equal(seen.length, 1);
	backend.close();
});

for (const outcome of ['error', 'end', 'increment-before-baseline'] as const) {
	test(`listSessions rejects ${outcome} and cancels an unfinished unary read`, async () => {
		const { backend, requests, release } = deferredListBackend();
		const result = backend.invoke('listSessions', {});
		const socket = FakeWebSocket.instances[0];
		socket.open();
		const { streamId } = workspaceOpen(socket);
		const code = outcome === 'error' ? 'gateway/invocation-unavailable' : outcome === 'end' ? 'dsh-ide/stream-ended' : 'dsh-ide/transport-corrupt';
		const rejected = assert.rejects(result, (error: DshIdeTransportError) => error.code === code && (outcome !== 'error' || (error.details as { endpoint: string }).endpoint === 'workspace/follow'));
		if (outcome === 'error') {
			socket.deliver({ type: 'error', streamId, error: { code, message: 'unavailable', details: { endpoint: 'workspace/follow' } } });
		} else if (outcome === 'end') {
			socket.deliver({ type: 'end', streamId });
		} else {
			socket.deliver({ type: 'item', streamId, value: { type: 'order', workspaceIds: [] } });
		}
		await rejected;
		assert.equal(requests[0].init.signal?.aborted, true);
		assert.equal(socket.readyState, 1, 'a logical stream failure must not close the Chat socket');
		release([sessionItem('s-1')]);
		backend.close();
	});
}

for (const action of ['socket-close', 'socket-error', 'transport-dispose', 'backend-close'] as const) {
	for (const phase of ['before-baseline', 'after-baseline'] as const) {
		test(`listSessions settles ${action} ${phase} while the unary response is pending`, async () => {
			const { backend, transport, requests, release } = deferredListBackend();
			const result = backend.invoke('listSessions', {});
			const socket = FakeWebSocket.instances[0];
			socket.open();
			const { streamId } = workspaceOpen(socket);
			if (phase === 'after-baseline') {
				deliverWorkspaceBaseline(socket, streamId);
				await Promise.resolve();
				assert.deepEqual(socket.sent.at(-1), { type: 'cancel', streamId });
			}
			const code = action === 'socket-error' ? 'dsh-ide/stream-error' : action === 'backend-close' ? DSH_IDE_SESSION_SWITCHED : 'dsh-ide/stream-closed';
			const rejected = assert.rejects(result, (error: DshIdeTransportError) => error.code === code);
			switch (action) {
				case 'socket-close': socket.close(); break;
				case 'socket-error': socket.fail(); break;
				case 'transport-dispose': transport.dispose(); break;
				case 'backend-close': backend.close(); break;
			}
			await rejected;
			assert.equal(requests[0].init.signal?.aborted, true, 'the HTTP read must be cancelled even after its baseline stream is gone');
			release([sessionItem('s-1')]);
			backend.close();
		});
	}
}

test('listSessions settles a close before the socket opens', async () => {
	const { backend, requests, release } = deferredListBackend();
	const result = backend.invoke('listSessions', {});
	const socket = FakeWebSocket.instances[0];
	const rejected = assert.rejects(result, (error: DshIdeTransportError) => error.code === DSH_IDE_SESSION_SWITCHED);
	backend.close();
	await rejected;
	assert.equal(requests[0].init.signal?.aborted, true);
	socket.open();
	assert.deepEqual(socket.sent, [], 'a retired socket cannot flush queued streams');
	release([sessionItem('s-1')]);
});

test('listSessions rejects an old binding and ignores its late socket events after reopening', async () => {
	let release!: (value: FakeHostResponse) => void;
	const firstReply = new Promise<FakeHostResponse>(resolve => { release = resolve; });
	let count = 0;
	const { backend, requests } = backendWithHost((_url, body) => ++count === 1 ? firstReply : listReply(body, [sessionItem('s-2')]));
	const oldBinding = backend.open({ view: 'chat' });
	const first = backend.invoke('listSessions', {});
	const oldSocket = FakeWebSocket.instances[0];
	oldSocket.open();
	const oldStreamId = workspaceOpen(oldSocket).streamId;
	deliverWorkspaceBaseline(oldSocket, oldStreamId);
	await Promise.resolve();
	const rejected = assert.rejects(first, (error: DshIdeTransportError) => error.code === DSH_IDE_SESSION_SWITCHED);
	backend.close();
	const newBinding = backend.open({ view: 'chat', params: { sessionId: 's-2' } });
	assert.notEqual(newBinding.channelId, oldBinding.channelId);
	const second = backend.invoke('listSessions', {});
	const socket = FakeWebSocket.instances[1];
	socket.open();
	const { streamId } = workspaceOpen(socket);
	oldSocket.close();
	oldSocket.fail();
	oldSocket.deliver({ type: 'end', streamId });
	release(listReply(requests[0].body, [sessionItem('s-1')]));
	deliverWorkspaceBaseline(socket, streamId, [{ workspaceId: 'w-2', sessionIds: ['s-2'] }]);
	await rejected;
	assert.deepEqual(await second, [{ sessionId: 's-2', workspaceId: 'w-2', updatedAt: 123, running: false, blank: false, agentAvailable: true }]);
	assert.equal(socket.readyState, 1);
	backend.close();
});

test('listSessions reports SESSION_SWITCHED when closed after the unary response but before the baseline', async () => {
	const { backend } = backendWithHost((_url, body) => listReply(body, [sessionItem('s-1')]));
	const result = backend.invoke('listSessions', {});
	const socket = FakeWebSocket.instances[0];
	socket.open();
	// 让 HTTP 与 JSON 读取先完成，关闭只能通过 baseline 的读取生命周期结算。
	await setImmediate();
	const rejected = assert.rejects(result, (error: DshIdeTransportError) => error.code === DSH_IDE_SESSION_SWITCHED);
	backend.close();
	await rejected;
});

for (const readyState of [2, 3]) {
	test(`listSessions settles the retired socket at readyState ${readyState} before its close event arrives`, async () => {
		const { backend, requests } = backendWithHost((_url, body) => listReply(body, [sessionItem('s-1')]));
		const first = backend.invoke('listSessions', {});
		const rejected = assert.rejects(first, (error: DshIdeTransportError) => error.code === 'dsh-ide/stream-closed');
		const oldSocket = FakeWebSocket.instances[0];
		oldSocket.open();
		await setImmediate();
		oldSocket.readyState = readyState;
		const second = backend.invoke('listSessions', {});
		const socket = FakeWebSocket.instances[1];
		socket.open();
		const { streamId } = workspaceOpen(socket);
		await rejected;
		assert.equal(requests[1].init.signal?.aborted, false, 'replacing the socket must not cancel the new read');
		oldSocket.close();
		oldSocket.fail();
		oldSocket.deliver({ type: 'end', streamId });
		deliverWorkspaceBaseline(socket, streamId);
		assert.deepEqual(await second, [{ sessionId: 's-1', workspaceId: 'w-1', updatedAt: 123, running: false, blank: false, agentAvailable: true }]);
		assert.equal(socket.readyState, 1, 'retired events must not close the replacement socket');
		backend.close();
	});
}

test('a list stream disconnect does not cancel an ordinary in-flight submit', async () => {
	let release!: (value: FakeHostResponse) => void;
	const reply = new Promise<FakeHostResponse>(resolve => { release = resolve; });
	const { backend, requests } = backendWithHost((url, body) => url.endsWith('/api/session/prompt') ? reply : listReply(body, [sessionItem('s-1')]));
	const submitted = backend.invoke('submit', { text: 'pending prompt' });
	const listed = backend.invoke('listSessions', {});
	const rejected = assert.rejects(listed, (error: DshIdeTransportError) => error.code === 'dsh-ide/stream-closed');
	const socket = FakeWebSocket.instances[0];
	socket.open();
	socket.close();
	await rejected;
	assert.equal(requests[0].init.signal, undefined, 'ordinary writes keep their own response lifecycle');
	release(OK(requests[0].url, requests[0].body));
	assert.deepEqual(await submitted, { accepted: true });
	backend.close();
});

test('openStream notifies normal end once and does not affect another stream', () => {
	resetSockets();
	const { primitives } = fakeHost(() => ({ json: null }));
	const transport = new DshIdeTransport({ origin: 'http://127.0.0.1:9', cookie: 'c', primitives });
	let ended = 0;
	const frames: DshIdeStreamFrame[] = [];
	const first = transport.openStream('workspace/follow', {}, () => undefined, undefined, () => ended++);
	const second = transport.openStream('session/follow', {}, frame => frames.push(frame));
	const socket = FakeWebSocket.instances[0];
	socket.open();
	socket.deliver({ type: 'end', streamId: first.streamId });
	socket.deliver({ type: 'end', streamId: first.streamId });
	first.close();
	assert.equal(ended, 1);
	assert.equal(socket.sent.length, 2, 'an ended stream needs no cancellation');
	socket.deliver({ type: 'item', streamId: second.streamId, value: { type: 'snapshot' } });
	assert.equal(frames.length, 1);
	transport.dispose();
});

// ---------------------------------------------------------------------------
// deleteSession：按 §8.10.8 批准的路径调用社区插件 endpoint（四类契约结果）
//
// 插件 `@michengai/dsh-archive-manager@1.3.1` 在官方 workspaceRegistry 实例上 overlay
// `deleteSession(sessionId)`，并经 Typert 注册 `workspaceRegistry/deleteSession`
// （`src/workspace.ts:359-378`，入参 wire = `sessionId`，结果 codec 要求 `deleted: true`）。
// ---------------------------------------------------------------------------

test('deleteSession calls the plugin endpoint and maps { deleted: true } to accepted', async () => {
	const host = fakeHost((_url, body) => ({
		json: { type: 'server-response', rpcId: (body as { rpcId: string }).rpcId, result: { ok: true, value: { deleted: true } } },
	}));
	const transport = new DshIdeTransport({ origin: 'http://127.0.0.1:9', cookie: 'c', primitives: host.primitives });
	const backend = new DshIdeTransportBackend(transport);
	backend.open({ view: 'chat', params: { sessionId: 's-1' } });

	assert.deepEqual(await backend.invoke('deleteSession', { sessionId: 's-1' }), { accepted: true });
	assert.equal(host.requests.length, 1, 'the plugin endpoint must actually be called exactly once');
	assert.equal(host.requests[0].url.split('/api/')[1], 'workspaceRegistry/deleteSession');
	// 入参键 = 服务方法形参名：deleteSession(sessionId) → { sessionId }
	const body = host.requests[0].body as { payload: { args: Record<string, unknown> } };
	assert.deepEqual(body.payload.args, { sessionId: 's-1' });
	transport.dispose();
});

test('deleteSession refuses when the plugin endpoint is missing (gateway error)', async () => {
	const host = fakeHost((_url, body) => ({
		json: {
			type: 'server-response',
			rpcId: (body as { rpcId: string }).rpcId,
			result: { ok: false, error: { code: 'gateway/invocation-unavailable', message: 'no active Remote method exports this endpoint' } },
		},
	}));
	const transport = new DshIdeTransport({ origin: 'http://127.0.0.1:9', cookie: 'c', primitives: host.primitives });
	const backend = new DshIdeTransportBackend(transport);
	backend.open({ view: 'chat', params: { sessionId: 's-1' } });
	await assert.rejects(
		() => backend.invoke('deleteSession', { sessionId: 's-1' }),
		(error: DshIdeTransportError) => error.code === DSH_IDE_FEATURE_UNAVAILABLE,
		'a missing plugin endpoint must map to feature-unavailable, never to success',
	);
	transport.dispose();
});

test('deleteSession refuses a call result that does not confirm deletion', async () => {
	const host = fakeHost((_url, body) => ({
		json: { type: 'server-response', rpcId: (body as { rpcId: string }).rpcId, result: { ok: true, value: { deleted: false } } },
	}));
	const transport = new DshIdeTransport({ origin: 'http://127.0.0.1:9', cookie: 'c', primitives: host.primitives });
	const backend = new DshIdeTransportBackend(transport);
	backend.open({ view: 'chat', params: { sessionId: 's-1' } });
	await assert.rejects(
		() => backend.invoke('deleteSession', { sessionId: 's-1' }),
		(error: DshIdeTransportError) => error.code === DSH_IDE_FEATURE_UNAVAILABLE,
		'only { deleted: true } may be reported as accepted',
	);
	transport.dispose();
});

test('deleteSession propagates a plugin call failure unchanged', async () => {
	const host = fakeHost((_url, body) => ({
		json: {
			type: 'server-response',
			rpcId: (body as { rpcId: string }).rpcId,
			result: { ok: false, error: { code: 'session/flush-failed', message: 'could not flush' } },
		},
	}));
	const transport = new DshIdeTransport({ origin: 'http://127.0.0.1:9', cookie: 'c', primitives: host.primitives });
	const backend = new DshIdeTransportBackend(transport);
	backend.open({ view: 'chat', params: { sessionId: 's-1' } });
	// 插件内部失败不是「能力缺失」：保留官方错误码，便于上层如实报告原因。
	await assert.rejects(
		() => backend.invoke('deleteSession', { sessionId: 's-1' }),
		(error: DshIdeTransportError) => error.code === 'session/flush-failed',
	);
	transport.dispose();
});

test('backend opens $events and session/follow together and closes both', () => {
	const { backend, transport } = backendWithHost(OK);
	const seen: unknown[] = [];
	const handle = backend.follow('s-1', event => seen.push(event));
	const socket = FakeWebSocket.instances[0];
	socket.open();
	// §8.10.3 缺口②：有绑定会话时两条流都开——$events（waterfall 入口）+ session/follow（会话内容）。
	const opened = socket.sent as { endpoint: string; streamId: string; payload?: { args?: Record<string, unknown> } }[];
	assert.deepEqual(opened.map(s => s.endpoint), ['$events', 'session/follow']);
	const content = opened[1]!;
	// follow(request, signal)：形参名是 request
	assert.deepEqual(content.payload?.args?.['request'], { address: { kind: 'session', sessionId: 's-1' }, assistantStream: true });

	socket.deliver({ type: 'item', streamId: content.streamId, value: { type: 'event', event: { type: 'user/message', seq: 1 } } });
	assert.equal(seen.length, 1);
	// $events 转发的 waterfall 帧同样进入同一条回调（审批 / 问卷到达 IDE 的唯一入口）。
	socket.deliver({ type: 'item', streamId: opened[0]!.streamId, value: { type: 'waterfall', eventId: 'e1', event: 'approval/request', agentId: 's-1', request: {} } });
	assert.equal(seen.length, 2);

	handle.dispose();
	const cancels = (socket.sent as { type: string }[]).filter(s => s.type === 'cancel');
	assert.equal(cancels.length, 2, 'dispose must close both streams');
	transport.dispose();
});

test('backend reuses the channel id on repeated open', () => {
	const { backend, transport } = backendWithHost(OK);
	const first = backend.open({ view: 'chat', params: { sessionId: 's-1' } });
	const second = backend.open({ view: 'chat', params: { sessionId: 's-2' } });
	assert.equal(second.channelId, first.channelId);
	assert.equal(second.sessionId, 's-1', 'the first binding wins');
	transport.dispose();
});


test('openStream never sends before the socket is connected', () => {
	resetSockets();
	const { primitives } = fakeHost(() => ({ json: null }));
	const realSend = FakeWebSocket.prototype.send;
	FakeWebSocket.prototype.send = function (this: FakeWebSocket, data: string) {
		if (this.readyState !== 1) {
			throw new Error('InvalidStateError: Sent before connected');
		}
		realSend.call(this, data);
	};
	try {
		const transport = new DshIdeTransport({ origin: 'http://127.0.0.1:9', cookie: 'c', primitives });
		assert.doesNotThrow(() => transport.openStream('session/follow', { request: {} }, () => undefined));
		const socket = FakeWebSocket.instances[0];
		assert.equal(socket.sent.length, 0);
		assert.doesNotThrow(() => socket.open(), 'the queued frame must flush cleanly once connected');
		assert.equal(socket.sent.length, 1);
		transport.dispose();
	} finally {
		FakeWebSocket.prototype.send = realSend;
	}
});

// ---------------------------------------------------------------------------
// D13（第 32 轮）：listCommands 接线——`commands/list` args 精确为
// { agentId: sessionId }（§8.10.9 第 31 轮 wire 结论），返回中立投影。
// ---------------------------------------------------------------------------

test('backend maps listCommands to commands/list with agentId and neutral projection', async () => {
	const { backend, transport, requests } = backendWithHost((url, body) => {
		const rpcId = (body as { rpcId: string }).rpcId;
		if (url.endsWith('/api/commands/list')) {
			return { json: { type: 'server-response', rpcId, result: { ok: true, value: [
				{ definitionId: 'internal', name: 'plan', description: 'Plan a task', input: { hint: 'topic' } },
				{ name: 'clear', description: '' },
			] } } };
		}
		return OK(url, body);
	});
	const value = await backend.invoke('listCommands', {});
	assert.equal(requests.length, 1);
	assert.equal(requests[0]!.url.split('/api/')[1], 'commands/list');
	const body = requests[0]!.body as { payload: { args: Record<string, unknown> } };
	assert.deepEqual(body.payload.args, { agentId: 's-1' });
	assert.deepEqual(value, [{ name: 'plan', description: 'Plan a task' }, { name: 'clear', description: '' }]);
	// 官方内部结构（definitionId / input）不得透传到 IDE 侧。
	assert.ok(!JSON.stringify(value).includes('internal') && !JSON.stringify(value).includes('hint'));
	transport.dispose();
});

test('backend listCommands sends nothing and returns an empty list without a binding', async () => {
	// 直接构造一个 open 时不带 sessionId 的 backend；不复用已绑定的 backendWithHost。
	const host = fakeHost(OK);
	const transport = new DshIdeTransport({ origin: 'http://127.0.0.1:9', cookie: 'c', primitives: host.primitives });
	const backend = new DshIdeTransportBackend(transport);
	backend.open({ view: 'chat' });
	assert.deepEqual(await backend.invoke('listCommands', {}), []);
	assert.equal(host.requests.length, 0, 'an unbound listCommands must not query the Host');
	transport.dispose();
});

test('backend listCommands projects a malformed Host reply to an empty list', async () => {
	const { backend, transport } = backendWithHost((_url, body) => (
		{ json: { type: 'server-response', rpcId: (body as { rpcId: string }).rpcId, result: { ok: true, value: 'not-an-array' } } }
	));
	assert.deepEqual(await backend.invoke('listCommands', {}), []);
	transport.dispose();
});

// ---------------------------------------------------------------------------
// D13（第 34 轮）：runCommand / setPermissionPreset 接线——`commands/execute`
// args 精确为 { agentId, line, submittedAttachments: [] }，结果经共享映射收敛。
// ---------------------------------------------------------------------------

test('backend maps runCommand to commands/execute with the exact wire shape', async () => {
	const { backend, transport, requests } = backendWithHost((url, body) => {
		const rpcId = (body as { rpcId: string }).rpcId;
		if (url.endsWith('/api/commands/execute')) {
			return { json: { type: 'server-response', rpcId, result: { ok: true, value: { commandId: 'c1', result: { kind: 'success' } } } } };
		}
		return OK(url, body);
	});
	assert.deepEqual(await backend.invoke('runCommand', { command: 'plan', args: ['a', 'b-c'] }), { accepted: true });
	assert.equal(requests.length, 1);
	assert.equal(requests[0]!.url.split('/api/')[1], 'commands/execute');
	const body = requests[0]!.body as { payload: { args: Record<string, unknown> } };
	assert.deepEqual(body.payload.args, { agentId: 's-1', line: '/plan a b-c', submittedAttachments: [] });
	transport.dispose();
});

test('backend maps setPermissionPreset to the /permission slash command', async () => {
	const { backend, transport, requests } = backendWithHost((_url, body) => (
		{ json: { type: 'server-response', rpcId: (body as { rpcId: string }).rpcId, result: { ok: true, value: { commandId: 'c1', result: { kind: 'success' } } } } }
	));
	assert.deepEqual(await backend.invoke('setPermissionPreset', { preset: 'workspace-write' }), { accepted: true });
	const body = requests[0]!.body as { payload: { args: Record<string, unknown> } };
	assert.equal(body.payload.args['line'], '/permission workspace-write');
	transport.dispose();
});

test('backend refuses a non-admitted or error command result instead of faking accepted', async () => {
	{
		const { backend, transport } = backendWithHost((_url, body) => (
			{ json: { type: 'server-response', rpcId: (body as { rpcId: string }).rpcId, result: { ok: true, value: undefined } } }
		));
		await assert.rejects(() => backend.invoke('runCommand', { command: 'nope' }),
			(error: DshIdeTransportError) => error.code === 'dsh-ide/invalid-argument');
		transport.dispose();
	}
	{
		const { backend, transport } = backendWithHost((_url, body) => (
			{ json: { type: 'server-response', rpcId: (body as { rpcId: string }).rpcId, result: { ok: true, value: { commandId: 'c1', result: { kind: 'error', text: 'unknown preset "x"' } } } } }
		));
		await assert.rejects(() => backend.invoke('setPermissionPreset', { preset: 'x' }),
			(error: DshIdeTransportError) => error.code === DSH_IDE_FEATURE_UNAVAILABLE && /unknown preset/.test(error.message));
		transport.dispose();
	}
});

// ---------------------------------------------------------------------------
// D59（第 19 轮）：archiveSession / unarchiveSession（§8.10.11）。
// 官方 remote，args 形参名是 request；返回完整归档集合 → 投影为 string[]。
// ---------------------------------------------------------------------------

test('backend maps archiveSession/unarchiveSession to the official registry remotes', async () => {
	const { backend, transport, requests } = backendWithHost((url, body) => {
		const rpcId = (body as { rpcId: string }).rpcId;
		if (url.endsWith('/api/workspaceRegistry/archiveSession')) {
			return { json: { type: 'server-response', rpcId, result: { ok: true, value: { archivedSessionIds: ['s-1', 's-2'] } } } };
		}
		if (url.endsWith('/api/workspaceRegistry/unarchiveSession')) {
			return { json: { type: 'server-response', rpcId, result: { ok: true, value: { archivedSessionIds: ['s-2'] } } } };
		}
		return OK(url, body);
	});
	assert.deepEqual(await backend.invoke('archiveSession', { sessionId: 's-1' }), ['s-1', 's-2']);
	assert.deepEqual(await backend.invoke('unarchiveSession', { sessionId: 's-1' }), ['s-2']);
	assert.deepEqual(requests.map(r => r.url.split('/api/')[1]), ['workspaceRegistry/archiveSession', 'workspaceRegistry/unarchiveSession']);
	// 形参名是 request（Typert 按 descriptor 逐字段校验）。
	const archive = requests[0]!.body as { payload: { args: Record<string, unknown> } };
	assert.deepEqual(archive.payload.args, { request: { sessionId: 's-1' } });
	transport.dispose();
});

test('backend archiveSession projects a malformed Host reply to an empty list', async () => {
	const { backend, transport } = backendWithHost((_url, body) => (
		{ json: { type: 'server-response', rpcId: (body as { rpcId: string }).rpcId, result: { ok: true, value: 'not-an-object' } } }
	));
	assert.deepEqual(await backend.invoke('archiveSession', { sessionId: 's-1' }), []);
	transport.dispose();
});

test('backend archiveSession propagates the official active-session refusal', async () => {
	const { backend, transport } = backendWithHost((_url, body) => (
		{ json: { type: 'server-response', rpcId: (body as { rpcId: string }).rpcId, result: { ok: false, error: { code: 'workspace/session-active', message: 'session is active' } } } }
	));
	await assert.rejects(() => backend.invoke('archiveSession', { sessionId: 's-1' }),
		(error: DshIdeTransportError) => /session-active|session is active/.test(`${error.code} ${error.message}`));
	transport.dispose();
});
