/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 官方客户端传输（Node / Electron 主进程）：dsh-client-connection 的载体实现。
//
// 复刻官方 dsh-client-connection 的浏览器/Node 语义（源码见 app.asar:
//   dsh-client-connection/lib/types/client/rpc.js + connect-protocol.js）：
//   1) 用 launch token 调 GET <origin>/connect?token=&interactions=<none|answer>，
//      拿到 302 + 签名 cookie（API Peer）。
//   2) 每次一元调用 POST <origin>/api/<namespace>/<method>，带 cookie + 官方信封。
//   3) 401 时重新 /connect 换 cookie 一次再重试。
//
// 这是 R1 smoke 所需的最小官方传输；/api/remote.mux（WebSocket 流，session.follow）在 R2 接入。
// 不引入任何自造通道；不缓存/记录 token 或 cookie 到日志。

import { randomUUID } from 'node:crypto';
import { DSH_IDE_ENDPOINT_ENV, DSH_IDE_TOKEN_ENV, DshUnaryResult, DshRemoteError, makeClientRequest, parseClientResponse } from '../common/dshClientProtocol.js';

export interface DshClientTransportOptions {
	readonly endpoint: string;              // 例如 http://127.0.0.1:56188
	readonly token: string;                 // 进程内 launch token
	readonly interactions?: 'none' | 'answer';
	readonly requestTimeoutMs?: number;
}

/** 带 Host 错误码的错误。 */
export class DshRemoteErrorInstance extends Error implements DshRemoteError {
	constructor(public readonly code: string, message: string, public readonly details?: unknown) {
		super(message);
		this.name = 'DshRemoteError';
	}
}

export class DshClientTransport {
	private cookie: string | undefined;
	private readonly interactions: 'none' | 'answer';
	private readonly timeoutMs: number;

	constructor(private readonly options: DshClientTransportOptions) {
		this.interactions = options.interactions ?? 'none';
		this.timeoutMs = options.requestTimeoutMs ?? 15000;
	}

	/** 从注入的环境变量构造；未配置则返回 undefined。 */
	static fromEnv(): DshClientTransport | undefined {
		const endpoint = (process.env[DSH_IDE_ENDPOINT_ENV] || '').trim();
		const token = (process.env[DSH_IDE_TOKEN_ENV] || '').trim();
		if (!endpoint || !token) { return undefined; }
		const interactions = (process.env['DSH_IDE_INTERACTIONS'] === 'answer') ? 'answer' : 'none';
		return new DshClientTransport({ endpoint: endpoint.replace(/\/+$/, ''), token, interactions });
	}

	get endpoint(): string { return this.options.endpoint; }

	/** 用 launch token 换取 API Peer cookie（官方 /connect）。 */
	async exchangeToken(): Promise<void> {
		const url = new URL(this.options.endpoint + '/connect');
		url.searchParams.set('token', this.options.token);
		url.searchParams.set('interactions', this.interactions);
		const res = await this.fetchWithTimeout(url.href, { method: 'GET', redirect: 'manual' });
		// 官方返回 302 + set-cookie（不可自动跟随；跟随后 cookie 会被丢弃）。
		const setCookie = getSetCookies(res);
		if (res.status !== 302 || setCookie.length === 0) {
			throw new DshRemoteErrorInstance('dsh-client/connect-failed', `official /connect did not return a session cookie (HTTP ${res.status})`);
		}
		const pair = setCookie[0].split(';', 1)[0]?.trim();
		if (!pair || !pair.includes('=')) { throw new DshRemoteErrorInstance('dsh-client/connect-failed', 'malformed session cookie from /connect'); }
		this.cookie = pair;
	}

	/** 确保已持有 cookie（懒交换）。 */
	async ensureCookie(): Promise<string> {
		if (this.cookie === undefined) { await this.exchangeToken(); }
		return this.cookie!;
	}

	/**
	 * 官方一元调用：POST /api/<endpoint>，返回 value；Host 返回 ok:false 时抛 DshRemoteErrorInstance。
	 * @param endpoint 形如 "session/list"（namespace/method）。
	 * @param args 命名参数对象。
	 */
	async callUnary<T = unknown>(endpoint: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
		let res = await this.postOnce(endpoint, args, signal);
		if (res.status === 401) {
			// cookie 过期/失效：重新 /connect 换一次再重试。
			this.cookie = undefined;
			await this.exchangeToken();
			res = await this.postOnce(endpoint, args, signal);
		}
		if (!res.ok) {
			throw new DshRemoteErrorInstance('dsh-client/transport', `HTTP ${res.status} for ${endpoint}`);
		}
		const ct = (res.headers.get('content-type') || '').toLowerCase();
		if (ct.includes('multipart/form-data')) {
			throw new DshRemoteErrorInstance('dsh-client/unsupported', `binary response for ${endpoint} not supported in R1 smoke`);
		}
		const json = await res.json();
		const parsed: DshUnaryResult<T> = parseClientResponse(json, res.rpcId) as DshUnaryResult<T>;
		if (!parsed.ok) { throw new DshRemoteErrorInstance(parsed.error.code, parsed.error.message, parsed.error.details); }
		return parsed.value as T;
	}

	private async postOnce(endpoint: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<Response & { rpcId: string }> {
		const cookie = await this.ensureCookie();
		const rpcId = randomUUID();
		const body = JSON.stringify(makeClientRequest(rpcId, endpoint, args));
		const res = await this.fetchWithTimeout(`${this.options.endpoint}/api/${endpoint}`, {
			method: 'POST',
			redirect: 'manual',
			headers: { 'content-type': 'application/json', cookie },
			body,
		}, signal) as Response & { rpcId?: string };
		res.rpcId = rpcId;
		return res as Response & { rpcId: string };
	}

	private fetchWithTimeout(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
		if (signal) { signal.addEventListener('abort', () => ctrl.abort(), { once: true }); }
		return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
	}
}

/** 从响应读取所有 Set-Cookie（兼容 undici 的 getSetCookie）。 */
function getSetCookies(res: Response): string[] {
	const h = res.headers as unknown as { getSetCookie?: () => string[] };
	if (typeof h.getSetCookie === 'function') { return h.getSetCookie(); }
	const single = res.headers.get('set-cookie');
	return single ? [single] : [];
}
