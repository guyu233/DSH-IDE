/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 官方客户端 IPC 频道（主进程注册为 'dshClient'，渲染器 IDshClientService 消费）。
//
// 渲染器（workbench）--IPC--> DshClientChannel(main) --官方 /api--> DSH Host
// 只有一元调用（session/list 等，R1 smoke）。流（session.follow via /api/remote.mux）在 R2 接入。
//
// 只依赖 base/common + 官方协议类型，主进程/渲染器共用，避免层级耦合。

import { Emitter, Event } from '../../base/common/event.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { IServerChannel } from '../../base/parts/ipc/common/ipc.js';
import { DshRemoteError } from '../common/dshClientProtocol.js';

/** 带官方传输能力的最小客户端（DshClientTransport 结构化满足）。 */
export interface IDshClientTransportLike {
	readonly endpoint: string;
	ensureCookie(): Promise<string>;
	callUnary<T = unknown>(endpoint: string, args?: Record<string, unknown>, signal?: AbortSignal): Promise<T>;
}

/** 一元调用折叠结果（渲染器消费）。 */
export type DshClientCallResult<T = unknown> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: DshRemoteError };

export class DshClientChannel extends Disposable implements IServerChannel<string> {
	private readonly _onStateChange = this._register(new Emitter<{ connected: boolean }>());

	constructor(private readonly transport: IDshClientTransportLike | undefined) { super(); }

	listen(_ctx: string, event: string): Event<unknown> {
		if (event === 'state') { return this._onStateChange.event as Event<unknown>; }
		throw new Error(`Invalid listen: ${event}`);
	}

	async call(_ctx: string, command: string, args?: any): Promise<any> {
		switch (command) {
			case 'status': {
				if (!this.transport) { return { connected: false }; }
				try { await this.transport.ensureCookie(); return { connected: true, endpoint: this.transport.endpoint }; }
				catch { return { connected: false, endpoint: this.transport.endpoint }; }
			}
			case 'call': {
				if (!this.transport) { return { ok: false, error: { code: 'dsh-client/no-endpoint', message: 'DSH_IDE_ENDPOINT/DSH_IDE_TOKEN not injected' } }; }
				const { endpoint, payload } = args as { endpoint: string; payload?: Record<string, unknown> };
				try {
					const value = await this.transport.callUnary(endpoint, payload ?? {});
					this._onStateChange.fire({ connected: true });
					return { ok: true, value };
				} catch (e) {
					const err = e as { code?: string; message?: string; details?: unknown };
					this._onStateChange.fire({ connected: false });
					return { ok: false, error: { code: err.code ?? 'dsh-client/call-failed', message: err.message ?? String(e), details: err.details } };
				}
			}
			case 'connect': {
				if (!this.transport) { return { ok: false, error: { code: 'dsh-client/no-endpoint', message: 'no endpoint' } }; }
				try { await this.transport.ensureCookie(); return { ok: true, endpoint: this.transport.endpoint }; }
				catch (e) { const err = e as { code?: string; message?: string }; return { ok: false, error: { code: err.code ?? 'dsh-client/connect-failed', message: err.message ?? String(e) } }; }
			}
			default: throw new Error(`Invalid call: ${command}`);
		}
	}
}
