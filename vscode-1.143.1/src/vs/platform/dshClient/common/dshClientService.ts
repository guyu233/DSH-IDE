/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 渲染器（workbench）侧的官方客户端访问器（platform 层，common 可用）。
//
// 真正的官方传输在 Electron 主进程（DshClientTransport，经 'dshClient' IPC 频道）。
// 渲染器经 IDshClientService 调一元官方方法（session/list 等），R1 smoke 用。
// 流（session/follow via /api/remote.mux）在 R2 接入此服务。
//
// 无 HTTP、无私有管道；一律经官方 /api（主进程持有 cookie）。

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IChannel } from '../../../base/parts/ipc/common/ipc.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';
import { DshRemoteError } from './dshClientProtocol.js';

/** 主进程 'dshClient' 频道名。 */
export const DSH_CLIENT_CHANNEL = 'dshClient';

export type DshClientCallResult<T = unknown> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: DshRemoteError };

/** 渲染器侧官方客户端访问器。 */
export interface IDshClientService {
	readonly _serviceBrand: undefined;
	/** 连接状态变化（connected: 是否已拿到并可用 API Peer cookie）。 */
	readonly onDidChangeState: Event<{ connected: boolean }>;
	/** 是否已连到运行中的 Host（官方 /connect 成功）。 */
	getStatus(): Promise<{ connected: boolean; endpoint?: string }>;
	/** 触发一次 /connect（拿/刷新 cookie）。 */
	connect(): Promise<{ ok: boolean; endpoint?: string; error?: DshRemoteError }>;
	/** 官方一元调用：endpoint 形如 "session/list"，args 命名参数；折叠为 {ok,value|error}。 */
	call<T = unknown>(endpoint: string, args?: Record<string, unknown>): Promise<DshClientCallResult<T>>;
}

export const IDshClientService = createDecorator<IDshClientService>('dshClientService');

/** 对主进程 DshClientTransport 的薄代理（单例）。 */
export class DshClientService extends Disposable implements IDshClientService {
	declare readonly _serviceBrand: undefined;

	private readonly channel: IChannel;
	private readonly _onDidChangeState = this._register(new Emitter<{ connected: boolean }>());

	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		super();
		this.channel = mainProcessService.getChannel(DSH_CLIENT_CHANNEL);
		this._register(this.channel.listen<{ connected: boolean }>('state')((e) => this._onDidChangeState.fire(e)));
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

	readonly onDidChangeState: Event<{ connected: boolean }> = this._onDidChangeState.event;
}
