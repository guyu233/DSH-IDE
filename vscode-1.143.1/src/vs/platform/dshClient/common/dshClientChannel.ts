/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 官方客户端 IPC 频道（主进程注册为 'dshClient'，渲染器 IDshClientService 消费）。
//
// 渲染器（workbench）--IPC--> DshClientChannel(main) --官方 /api 与 /api/remote.mux--> DSH Host
//   - 一元：session/list、session/page、session/prompt 等（POST /api/<ns>/<method>）。
//   - 流：session/follow 等（WebSocket /api/remote.mux），逐帧经 'stream' 事件回推渲染器。
//
// 只依赖 base/common + 官方协议类型，主进程/渲染器共用。

import { Emitter, Event } from '../../base/common/event.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { IServerChannel } from '../../base/parts/ipc/common/ipc.js';
import { DshRemoteError } from '../common/dshClientProtocol.js';
import { DshStreamHandlers } from './dshClientTransport.node.js';

/** 带官方传输能力的最小客户端（DshClientTransport 结构化满足）。 */
export interface IDshClientTransportLike {
	readonly endpoint: string;
	ensureCookie(): Promise<string>;
	callUnary<T = unknown>(endpoint: string, args?: Record<string, unknown>, signal?: AbortSignal): Promise<T>;
	openStream<T = unknown>(endpoint: string, args: Record<string, unknown>, handlers: DshStreamHandlers<T>, signal?: AbortSignal): { streamId: string; close: () => void };
}

export type DshClientCallResult<T = unknown> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: DshRemoteError };

/** 推送渲染器的流帧。 */
export interface IDshStreamFrame { readonly streamId: string; readonly type: 'item' | 'end' | 'error'; readonly value?: unknown; readonly error?: DshRemoteError }

export class DshClientChannel extends Disposable implements IServerChannel<string> {
	private readonly _onStateChange = this._register(new Emitter<{ connected: boolean }>());
	private readonly _onStream = this._register(new Emitter<IDshStreamFrame>());
	private readonly streams = new Map<string, { close: () => void }>();

	constructor(private readonly transport: IDshClientTransportLike | undefined) { super(); }

	listen(_ctx: string, event: string): Event<unknown> {
		if (event === 'state') { return this._onStateChange.event as Event<unknown>; }
		if (event === 'stream') { return this._onStream.event as Event<unknown>; }
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
			case 'follow': {
				if (!this.transport) { return { ok: false, error: { code: 'dsh-client/no-endpoint', message: 'no endpoint' } }; }
				const { streamId, endpoint, payload } = args as { streamId: string; endpoint: string; payload?: Record<string, unknown> };
				try {
					const handle = this.transport.openStream(endpoint, payload ?? {}, {
						onItem: (value) => this._onStream.fire({ streamId, type: 'item', value }),
						onEnd: () => { this.streams.delete(streamId); this._onStream.fire({ streamId, type: 'end' }); },
						onError: (error) => { this.streams.delete(streamId); this._onStream.fire({ streamId, type: 'error', error }); },
					});
					// 用调用方提供的 streamId 关联；transport 内部另有 uuid，但我们以 renderer 的为准推送。
					this.streams.set(streamId, { close: handle.close });
					return { ok: true, streamId };
				} catch (e) {
					const err = e as { code?: string; message?: string };
					return { ok: false, error: { code: err.code ?? 'dsh-client/stream-failed', message: err.message ?? String(e) } };
				}
			}
			case 'streamCancel': {
				const s = this.streams.get(args.streamId); if (s) { this.streams.delete(args.streamId); try { s.close(); } catch { /* ignore */ } }
				return;
			}
			default: throw new Error(`Invalid call: ${command}`);
		}
	}

	override dispose(): void {
		for (const s of this.streams.values()) { try { s.close(); } catch { /* ignore */ } }
		this.streams.clear();
		super.dispose();
	}
}
