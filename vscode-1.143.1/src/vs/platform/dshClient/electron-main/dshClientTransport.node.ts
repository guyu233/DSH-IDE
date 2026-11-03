/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 官方客户端传输（Node / Electron 主进程）：dsh-client-connection 的完整载体实现。
//
// 复刻官方 dsh-client-connection（源码见 app.asar: lib/types/client/rpc.js,
// connect-protocol.js, socket.js; lib/types/stream-protocol.js）：
//   - 认证：GET <origin>/?token=<launchToken>（authorizeIndex）-> 303 + 签名 browser cookie（共享 browserPeer）。
//     该 cookie 同时用于 /api 一元 与 /api/remote.mux WebSocket（服务端同一 browserPeer）。
//   - 一元：POST <origin>/api/<ns>/<method>，带 cookie + 官方 client-request 信封。
//   - 流：WS 连 <origin>/api/remote.mux（带同一 cookie），发 {type:'open',streamId,endpoint,payload:{args}}，
//     收 {type:'item',streamId,value} / {type:'end',streamId} / {type:'error',streamId,error}；发 {type:'cancel'|'end',streamId}。
//
// 不引入任何自造通道；token/cookie 不落日志。ws 为仓库既有依赖（VS Code 亦用 ws）。

import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { DSH_IDE_ENDPOINT_ENV, DSH_IDE_TOKEN_ENV, DshUnaryResult, DshRemoteError, makeClientRequest, parseClientResponse } from '../common/dshClientProtocol.js';

export interface DshClientTransportOptions {
	readonly endpoint: string;              // 例如 http://127.0.0.1:56188
	readonly token: string;                 // 进程内 launch token
	readonly interactions?: 'none' | 'answer';
	readonly requestTimeoutMs?: number;
}

export class DshRemoteErrorInstance extends Error implements DshRemoteError {
	constructor(public readonly code: string, message: string, public readonly details?: unknown) {
		super(message);
		this.name = 'DshRemoteError';
	}
}

/** 一条逻辑流的帧回调。 */
export interface DshStreamHandlers<T = unknown> {
	onItem?(value: T): void;
	onEnd?(): void;
	onError?(error: DshRemoteError): void;
}

export class DshClientTransport {
	private cookie: string | undefined;
	private readonly interactionMode: 'none' | 'answer';
	private readonly timeoutMs: number;

	constructor(private readonly options: DshClientTransportOptions) {
		this.interactionMode = options.interactions ?? 'answer';
		this.timeoutMs = options.requestTimeoutMs ?? 15000;
	}

	/** 从注入的环境变量构造；未配置则返回 undefined。 */
	static fromEnv(): DshClientTransport | undefined {
		const endpoint = (process.env[DSH_IDE_ENDPOINT_ENV] || '').trim();
		const token = (process.env[DSH_IDE_TOKEN_ENV] || '').trim();
		if (!endpoint || !token) { return undefined; }
		const interactions = (process.env['DSH_IDE_INTERACTIONS'] === 'none') ? 'none' : 'answer';
		return new DshClientTransport({ endpoint: endpoint.replace(/\/+$/, ''), token, interactions });
	}

	get endpoint(): string { return this.options.endpoint; }

	/**
	 * 用 launch token 换取浏览器会话 cookie（官方 authorizeIndex: GET /?token= -> 303 + cookie）。
	 * 该 cookie 同时服务 /api 一元与 /api/remote.mux WebSocket。
	 */
	async exchangeToken(): Promise<void> {
		const url = new URL(this.options.endpoint + '/');
		url.searchParams.set('token', this.options.token);
		let res = await this.fetchWithTimeout(url.href, { method: 'GET', redirect: 'manual' });
		// 已持有效 cookie 时官方也会 303 到 ./（无 set-cookie）；此时沿用现有 cookie。
		const setCookie = getSetCookies(res);
		if (setCookie.length > 0) {
			const pair = setCookie[0].split(';', 1)[0]?.trim();
			if (pair && pair.includes('=')) { this.cookie = pair; return; }
		}
		if (res.status === 303 && this.cookie) { return; }
		throw new DshRemoteErrorInstance('dsh-client/connect-failed', `official token exchange did not mint a session cookie (HTTP ${res.status})`);
	}

	async ensureCookie(): Promise<string> {
		if (this.cookie === undefined) { await this.exchangeToken(); }
		return this.cookie!;
	}

	/** 官方一元调用：POST /api/<endpoint>，返回 value；Host 返回 ok:false 时抛 DshRemoteErrorInstance。 */
	async callUnary<T = unknown>(endpoint: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
		let res = await this.postOnce(endpoint, args, signal);
		if (res.status === 401) {
			this.cookie = undefined;
			await this.exchangeToken();
			res = await this.postOnce(endpoint, args, signal);
		}
		if (!res.ok) { throw new DshRemoteErrorInstance('dsh-client/transport', `HTTP ${res.status} for ${endpoint}`); }
		const ct = (res.headers.get('content-type') || '').toLowerCase();
		if (ct.includes('multipart/form-data')) { throw new DshRemoteErrorInstance('dsh-client/unsupported', `binary response for ${endpoint} not supported`); }
		const json = await res.json();
		const parsed: DshUnaryResult<T> = parseClientResponse(json, (res as Response & { rpcId: string }).rpcId) as DshUnaryResult<T>;
		if (!parsed.ok) { throw new DshRemoteErrorInstance(parsed.error.code, parsed.error.message, parsed.error.details); }
		return parsed.value as T;
	}

	private async postOnce(endpoint: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<Response & { rpcId: string }> {
		const cookie = await this.ensureCookie();
		const rpcId = randomUUID();
		const body = JSON.stringify(makeClientRequest(rpcId, endpoint, args));
		const res = await this.fetchWithTimeout(`${this.options.endpoint}/api/${endpoint}`, {
			method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', cookie }, body,
		}, signal) as Response & { rpcId?: string };
		res.rpcId = rpcId;
		return res as Response & { rpcId: string };
	}

	/**
	 * 打开一条官方逻辑流（/api/remote.mux）。返回 { streamId, close }。
	 * @param endpoint 形如 "session/follow"。
	 * @param args 命名参数对象（放在 payload.args）。
	 */
	openStream<T = unknown>(endpoint: string, args: Record<string, unknown>, handlers: DshStreamHandlers<T>, signal?: AbortSignal): { streamId: string; close: () => void } {
		const streamId = randomUUID();
		let closed = false;
		const wsUrl = this.options.endpoint.replace(/^http/, 'ws') + '/api/remote.mux';
		const finish = (fn?: () => void) => { if (closed) { return; } closed = true; try { fn?.(); } catch { /* ignore */ } try { ws.close(); } catch { /* ignore */ } };

		void Promise.resolve(this.ensureCookie()).then((cookie) => {
			if (closed) { return; }
			const ws = new WebSocket(wsUrl, { headers: { cookie } });
			ws.on('open', () => {
				ws.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args: args ?? {} } }));
			});
			ws.on('message', (data: unknown) => {
				let msg: any;
				try { msg = JSON.parse(String(data)); } catch { return; }
				if (!msg || msg.streamId !== streamId) { return; }
				if (msg.type === 'item') { try { handlers.onItem?.(msg.value as T); } catch { /* consumer */ } }
				else if (msg.type === 'end') { finish(handlers.onEnd); }
				else if (msg.type === 'error') { const err = msg.error ?? {}; finish(() => handlers.onError?.({ code: err.code ?? 'gateway/internal', message: err.message ?? 'stream error', details: err.details })); }
			});
			ws.on('error', (e: Error) => { finish(() => handlers.onError?.({ code: 'dsh-client/ws', message: String(e && e.message || e) })); });
			ws.on('close', () => { if (!closed) { finish(handlers.onEnd); } });
			if (signal) { signal.addEventListener('abort', () => { try { ws.send(JSON.stringify({ type: 'cancel', streamId })); } catch { /* ignore */ } finish(); }, { once: true }); }
		}).catch((e) => { finish(() => handlers.onError?.({ code: 'dsh-client/connect-failed', message: String(e && e.message || e) })); });

		return { streamId, close: () => finish() };
	}

	private fetchWithTimeout(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
		if (signal) { signal.addEventListener('abort', () => ctrl.abort(), { once: true }); }
		return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
	}
}

function getSetCookies(res: Response): string[] {
	const h = res.headers as unknown as { getSetCookie?: () => string[] };
	if (typeof h.getSetCookie === 'function') { return h.getSetCookie(); }
	const single = res.headers.get('set-cookie');
	return single ? [single] : [];
}
