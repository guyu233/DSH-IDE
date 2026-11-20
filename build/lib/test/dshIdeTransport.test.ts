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
	DSH_IDE_INCOMPATIBLE_WIRE,
	DSH_IDE_SESSION_SWITCHED,
	DSH_IDE_WIRE_REVISION,
	type DshIdeMethod,
} from '../../../src/vs/platform/dshClient/common/dshIdeProtocol.ts';
import {
	DshIdeTransport,
	DshIdeTransportBackend,
	DshIdeTransportError,
	authenticateHost,
	type DshIdeStreamFrame,
} from '../../../out/vs/platform/dshClient/transport/dshIdeTransport.js';

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
// DshIdeBackend 适配：窗口只把操作交给内核，自己不再重写 session/* 请求
// ---------------------------------------------------------------------------

const BINDING = { viewId: 'v-1', generation: 1, sessionId: 's-1' } as const;

function backendWithHost(handler: (url: string, body: unknown) => FakeHostResponse | Promise<FakeHostResponse>) {
	resetSockets();
	const host = fakeHost(handler);
	const transport = new DshIdeTransport({ origin: 'http://127.0.0.1:9', cookie: 'c', primitives: host.primitives });
	const backend = new DshIdeTransportBackend(transport);
	backend.open({ view: 'chat', params: { sessionId: 's-1' } });
	return { backend, transport, requests: host.requests };
}

const OK = (url: string, body: unknown) => ({
	json: {
		type: 'server-response',
		rpcId: (body as { rpcId: string }).rpcId,
		// 建连后第一次业务调用前会先 `ide/ping` 核对修订号：假 Host 必须如实声明同一修订号，
		// 否则后端按「两半不兼容」拒绝，这正是新门禁要保护的行为。
		result: { ok: true, value: url.endsWith('/ide/ping') ? { ok: true, wireRevision: DSH_IDE_WIRE_REVISION } : { accepted: true } },
	},
});

/** 过滤掉契约核对的 ping：业务断言只关心真正的业务端点。 */
function endpointsOf(requests: readonly RecordedRequest[]): string[] {
	return requests.map(request => request.url.split('/api/')[1]).filter(endpoint => endpoint !== 'ide/ping');
}

test('backend sends every operation to ide/dispatch with the method and payload', async () => {
	const { backend, transport, requests } = backendWithHost(OK);

	await backend.invoke('submit', { text: 'hi', sessionId: 's-1' }, BINDING);
	await backend.invoke('interrupt', { sessionId: 's-1' }, BINDING);
	await backend.invoke('setModel', { sessionId: 's-1', model: 'deepseek/deepseek-chat' }, BINDING);

	assert.deepEqual(endpointsOf(requests), ['ide/dispatch', 'ide/dispatch', 'ide/dispatch']);
	assert.equal(requests.filter(request => request.url.endsWith('/ide/ping')).length, 1, 'the contract check runs once per connection, not per call');
	const first = requests.find(request => request.url.endsWith('/ide/dispatch'))!.body as { payload: { args: { method: string; payload: Record<string, unknown> } } };
	assert.equal(first.payload.args.method, 'submit');
	assert.deepEqual(first.payload.args.payload, { text: 'hi', sessionId: 's-1' });
	assert.deepEqual(first.payload.args.binding, BINDING, 'every dispatch carries the originating view binding');
	const second = requests.filter(request => request.url.endsWith('/ide/dispatch'))[1].body as { payload: { args: { method: string; payload: Record<string, unknown> } } };
	assert.equal(second.payload.args.method, 'interrupt');
	assert.deepEqual(second.payload.args.payload, { sessionId: 's-1' });
	transport.dispose();
});

test('backend forwards rewind to the kernel, which refuses it', async () => {
	const { backend, transport, requests } = backendWithHost(OK);
	// 窗口只把 rewind 交给内核；内核再决定调不调 dsh-rewind-plugin。
	await backend.invoke('rewind', { sessionId: 's-1', to: '0' }, BINDING);
	assert.deepEqual(endpointsOf(requests), ['ide/dispatch']);
	const payload = requests.find(request => request.url.endsWith('/ide/dispatch'))!.body as { payload: { args: { method: string } } };
	assert.equal(payload.payload.args.method, 'rewind');
	transport.dispose();
});

test('backend opens one ide/followSession stream and closes it', () => {
	const { backend, transport } = backendWithHost(OK);
	const seen: unknown[] = [];
	const binding = { viewId: 'v-1', generation: 1, sessionId: 's-1' };
	const handle = backend.follow('s-1', event => seen.push(event), undefined, binding);
	const socket = FakeWebSocket.instances[0];
	socket.open();
	const opened = socket.sent as { endpoint: string; streamId: string; payload?: { args?: Record<string, unknown> } }[];
	assert.deepEqual(opened.map(s => s.endpoint), ['ide/followSession']);
	// Host 的 `followSession(binding, wireRevision, signal)` 只有两个 wire 字段：
	// `binding` 已带会话 id；再发 `sessionId` 会被 Gateway 的 assertExactArguments 判成多余字段。
	assert.deepEqual(opened[0]!.payload?.args, { binding, wireRevision: DSH_IDE_WIRE_REVISION });

	// 身份先于内容：Host 先确认绑定，之后才是会话帧。
	socket.deliver({ type: 'item', streamId: opened[0]!.streamId, value: { type: 'ide-view-bound', binding } });
	socket.deliver({ type: 'item', streamId: opened[0]!.streamId, value: { type: 'event', event: { type: 'user/message', seq: 1 } } });
	assert.equal(seen.length, 1, 'only the content frame reaches the view');

	handle.dispose();
	const cancels = (socket.sent as { type: string }[]).filter(s => s.type === 'cancel');
	assert.equal(cancels.length, 1, 'dispose must close the single stream');
	transport.dispose();
});

test('unbound follow opens one status-only stream and closes it on dispose', () => {
	const { backend, transport } = backendWithHost(OK);
	const handle = backend.follow(undefined, () => undefined, undefined, { viewId: 'v-2', generation: 1, sessionId: null });
	// 没有绑定会话时仍要收 api-session/status，否则未开聊的窗口收不到会话状态变化。
	assert.equal(FakeWebSocket.instances.length, 1, 'unbound follow must open one status stream');
	const socket = FakeWebSocket.instances[0];
	socket.open();
	assert.ok((socket.sent as { type: string }[]).some(s => s.type === 'open'), 'the stream must be opened');
	handle.dispose();
	assert.ok((socket.sent as { type: string }[]).some(s => s.type === 'cancel'), 'dispose must close the status stream');
	transport.dispose();
});

test('backend refuses a Host that declares a different wire revision', async () => {
	resetSockets();
	const host = fakeHost((url, body) => ({
		json: {
			type: 'server-response',
			rpcId: (body as { rpcId: string }).rpcId,
			result: { ok: true, value: url.endsWith('/ide/ping') ? { ok: true, wireRevision: 4 } : { accepted: true } },
		},
	}));
	const transport = new DshIdeTransport({ origin: 'http://127.0.0.1:9', cookie: 'c', primitives: host.primitives });
	const backend = new DshIdeTransportBackend(transport);
	backend.open({ view: 'chat', params: { sessionId: 's-1' } });
	await assert.rejects(
		() => backend.invoke('submit', { text: 'hi', sessionId: 's-1' }, BINDING),
		(error: DshIdeTransportError) => error.code === DSH_IDE_INCOMPATIBLE_WIRE,
		'a mismatched Host must be rejected before any business call',
	);
	assert.equal(host.requests.filter(request => request.url.includes('/ide/dispatch')).length, 0, 'no business call may reach an incompatible Host');
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
	const transport = new DshIdeTransport({ origin: 'http://127.0.0.1:9', cookie: 'c', primitives });
	transport.openStream('ide/followSession', { sessionId: 's-1' }, () => undefined);
	const socket = FakeWebSocket.instances[0];
	assert.equal(socket.sent.length, 0, 'the open frame must wait for the socket');
	socket.open();
	assert.equal(socket.sent.length, 1);
	transport.dispose();
});

test('openStream notifies normal end once and does not affect another stream', () => {
	resetSockets();
	const { primitives } = fakeHost(() => ({ json: null }));
	const transport = new DshIdeTransport({ origin: 'http://127.0.0.1:9', cookie: 'c', primitives });
	let ends = 0;
	const first = transport.openStream('ide/followSession', { sessionId: 'a' }, () => undefined, undefined, () => { ends += 1; });
	transport.openStream('ide/followSession', { sessionId: 'b' }, () => undefined);
	const socket = FakeWebSocket.instances[0];
	socket.open();
	socket.deliver({ type: 'end', streamId: first.streamId });
	socket.deliver({ type: 'end', streamId: first.streamId });
	assert.equal(ends, 1);
	transport.dispose();
});

test('a transient contract failure is retryable; only incompatibility is cached', () => {
	// `checkContract()` 失败有两种：网络抖动（临时）与 wireRevision 不匹配（永久）。
	// 原实现用 `??=` 把两者都缓存，一次偶发故障就把连接钉死到 `close()` 为止，
	// 用户只能重载窗口。这里钉住三条语义。
	const DSH_IDE_INCOMPATIBLE_WIRE = 'dsh-ide/incompatible-wire';

	class Gate {
		contract: Promise<void> | undefined;
		calls = 0;
		private readonly check: () => Promise<void>;
		constructor(check: () => Promise<void>) {
			this.check = check;
		}
		ensureContract(): Promise<void> {
			if (this.contract !== undefined) {
				return this.contract;
			}
			const pending = this.check().catch((error: unknown) => {
				const code = error !== null && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
				if (code === DSH_IDE_INCOMPATIBLE_WIRE) {
					this.contract = pending;
				} else if (this.contract === pending) {
					this.contract = undefined;
				}
				throw error;
			});
			this.contract = pending;
			return pending;
		}
	}

	// 临时失败后必须能重试
	let attempt = 0;
	const transient = new Gate(async () => {
		attempt += 1;
		if (attempt === 1) {
			const error = Object.assign(new Error('network'), { code: 'ECONNRESET' });
			throw error;
		}
	});
	return transient.ensureContract().catch(() => undefined)
		.then(() => transient.ensureContract())
		.then(() => {
			assert.equal(attempt, 2, 'a transient failure must allow a retry');

			// 不兼容必须只问一次
			let incompatibleCalls = 0;
			const incompatible = new Gate(async () => {
				incompatibleCalls += 1;
				throw Object.assign(new Error('wire'), { code: DSH_IDE_INCOMPATIBLE_WIRE });
			});
			return incompatible.ensureContract().catch(() => undefined)
				.then(() => incompatible.ensureContract().catch(() => undefined))
				.then(() => incompatible.ensureContract().catch(() => undefined))
				.then(() => {
					assert.equal(incompatibleCalls, 1, 'an incompatible peer must not be re-asked');

					// 并发只发一次
					let parallel = 0;
					const concurrent = new Gate(async () => {
						parallel += 1;
						await new Promise<void>(resolve => setTimeout(resolve, 5));
					});
					return Promise.all([concurrent.ensureContract(), concurrent.ensureContract(), concurrent.ensureContract()])
						.then(() => assert.equal(parallel, 1, 'concurrent callers must share one check'));
				});
		});
});
