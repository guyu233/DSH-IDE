/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 渲染器（workbench）侧的官方客户端访问器（platform 层，common 可用）。
//
// 真正的官方传输在 Electron 主进程（DshClientTransport，经 'dshClient' IPC 频道）。
// 渲染器经 IDshClientService 调官方一元方法（session/list/page/prompt…）与官方流（session/follow
// 经 /api/remote.mux）。无 HTTP、无私有管道；一律经官方 /api。

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { IChannel } from '../../../base/parts/ipc/common/ipc.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';
import { DshRemoteError } from './dshClientProtocol.js';

export const DSH_CLIENT_CHANNEL = 'dshClient';

export type DshClientCallResult<T = unknown> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: DshRemoteError };

/** 推送给渲染器的官方流帧。 */
export interface IDshStreamFrame {
	readonly streamId: string;
	readonly type: 'item' | 'end' | 'error';
	readonly value?: unknown;
	readonly error?: DshRemoteError;
}

/** 渲染器侧官方客户端访问器。 */
export interface IDshClientService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeState: Event<{ connected: boolean }>;
	readonly onDidStreamFrame: Event<IDshStreamFrame>;
	getStatus(): Promise<{ connected: boolean; endpoint?: string }>;
	connect(): Promise<{ ok: boolean; endpoint?: string; error?: DshRemoteError }>;
	call<T = unknown>(endpoint: string, args?: Record<string, unknown>): Promise<DshClientCallResult<T>>;
	/**
	 * 打开一条官方逻辑流（如 session/follow）。每帧经 onDidStreamFrame 回推；返回句柄。
	 */
	follow(endpoint: string, args: Record<string, unknown>, onFrame: (frame: IDshStreamFrame) => void): { streamId: string; close: () => void };
}

export const IDshClientService = createDecorator<IDshClientService>('dshClientService');

export class DshClientService extends Disposable implements IDshClientService {
	declare readonly _serviceBrand: undefined;

	private readonly channel: IChannel;
	private readonly _onDidChangeState = this._register(new Emitter<{ connected: boolean }>());
	private readonly _onDidStreamFrame = this._register(new Emitter<IDshStreamFrame>());

	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		super();
		this.channel = mainProcessService.getChannel(DSH_CLIENT_CHANNEL);
		this._register(this.channel.listen<{ connected: boolean }>('state')((e) => this._onDidChangeState.fire(e)));
		this._register(this.channel.listen<IDshStreamFrame>('stream')((e) => this._onDidStreamFrame.fire(e)));
	}

	async getStatus(): Promise<{ connected: boolean; endpoint?: string }> {
		try { return await this.channel.call<{ connected: boolean; endpoint?: string }>('status'); }
		catch { return { connected: false }; }
	}

	connect(): Promise<{ ok: boolean; endpoint?: string; error?: DshRemoteError }> {
		return this.channel.call('connect');
	}

	call<T = unknown>(endpoint: string, args: Record<string, unknown> = {}): Promise<DshClientCallResult<T>> {
		return this.channel.call<DshClientCallResult<T>>('call', { endpoint, payload: args });
	}

	follow(endpoint: string, args: Record<string, unknown>, onFrame: (frame: IDshStreamFrame) => void): { streamId: string; close: () => void } {
		const streamId = generateUuid();
		const sub = this.onDidStreamFrame((f) => { if (f.streamId === streamId) { onFrame(f); } });
		void this.channel.call('follow', { streamId, endpoint, payload: args }).catch(() => { /* handled via error frame? */ });
		return {
			streamId,
			close: () => { sub.dispose(); void this.channel.call('streamCancel', { streamId }).catch(() => undefined); },
		};
	}

	readonly onDidChangeState: Event<{ connected: boolean }> = this._onDidChangeState.event;
	readonly onDidStreamFrame: Event<IDshStreamFrame> = this._onDidStreamFrame.event;
}
