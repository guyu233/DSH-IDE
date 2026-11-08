/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 渲染器（workbench）侧的官方客户端访问器（platform 层，common 可用）。
//
// 阶段 3 第三批：旧 dshClient IPC 频道已删除，本服务改为消费新的 'dshIde' 骨架频道。
// 当前骨架对所有调用返回 FEATURE_UNAVAILABLE / 「重建中」快照，使 AI 面板显示明确的
// 「连接层重建中」状态而非静默失败或崩溃。真源投影在阶段 2.1-2.5 填充。

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { IChannel } from '../../../base/parts/ipc/common/ipc.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';
import { DSH_IDE_CHANNEL, DSH_IDE_FEATURE_UNAVAILABLE, type DshRemoteError } from './dshIdeProtocol.js';

export type DshClientCallResult<T = unknown> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: DshRemoteError };

/** 推送给渲染器的流帧。 */
export interface IDshStreamFrame {
	readonly streamId: string;
	readonly type: 'item' | 'end' | 'error';
	readonly value?: unknown;
	readonly error?: DshRemoteError;
}

/** 可写逻辑流句柄（对齐官方 ClientStreamHandle / chatapp WritableRemoteStream）。 */
export interface WritableRemoteStream {
	readonly streamId: string;
	/** 上行一个 item（C→H {type:'item'}）；返回的 Promise 在该帧 IPC 落定/失败后结算（可等待的背压）。 */
	send(value: unknown): Promise<void>;
	/** 上行半关闭（C→H {type:'end'}）；下行继续。 */
	end(): Promise<void>;
	/** 终止（C→H {type:'cancel'}）。 */
	cancel(): Promise<void>;
	/** 本地清理（等同 cancel）。 */
	close(): Promise<void>;
}

/** 渲染器侧官方客户端访问器。 */
export interface IDshClientService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeState: Event<{ connected: boolean }>;
	readonly onDidStreamFrame: Event<IDshStreamFrame>;
	getStatus(): Promise<{ connected: boolean; endpoint?: string }>;
	connect(): Promise<{ ok: boolean; endpoint?: string; error?: DshRemoteError }>;
	/** 一元调用；当前骨架返回 FEATURE_UNAVAILABLE。 */
	call<T = unknown>(endpoint: string, args?: Record<string, unknown>, signal?: AbortSignal): Promise<DshClientCallResult<T>>;
	/**
	 * 打开一条逻辑流。当前骨架立即回传 error 帧（「重建中」），绝不静默。
	 */
	follow(endpoint: string, args: Record<string, unknown>, onFrame: (frame: IDshStreamFrame) => void): { streamId: string; close: () => void };
}

/** 具备可写双向流能力的客户端切片（阶段 2.x 填充真实 uplink）。 */
export interface IDshStreamClient extends IDshClientService {
	openWritableStream(endpoint: string, args: Record<string, unknown>, signal: AbortSignal | undefined, onFrame: (frame: IDshStreamFrame) => void): WritableRemoteStream;
}

export const IDshClientService = createDecorator<IDshClientService>('dshClientService');

const REBUILD_ERROR: DshRemoteError = {
	code: DSH_IDE_FEATURE_UNAVAILABLE,
	message: 'DSH-IDE connection layer is being rebuilt',
};

export class DshClientService extends Disposable implements IDshStreamClient {
	declare readonly _serviceBrand: undefined;

	private readonly channel: IChannel;
	private readonly _onDidChangeState = this._register(new Emitter<{ connected: boolean }>());
	private readonly _onDidStreamFrame = this._register(new Emitter<IDshStreamFrame>());

	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		super();
		this.channel = mainProcessService.getChannel(DSH_IDE_CHANNEL);
		// 骨架频道暂无 state/stream 事件；阶段 2.x 接入真实投影。
		this._register(this.channel.listen<{ connected: boolean }>('state')(() => undefined));
		this._register(this.channel.listen<IDshStreamFrame>('stream')(() => undefined));
	}

	async getStatus(): Promise<{ connected: boolean; endpoint?: string }> {
		return { connected: false };
	}

	connect(): Promise<{ ok: boolean; endpoint?: string; error?: DshRemoteError }> {
		return Promise.resolve({ ok: false, error: REBUILD_ERROR });
	}

	call<T = unknown>(_endpoint: string, _args?: Record<string, unknown>, _signal?: AbortSignal): Promise<DshClientCallResult<T>> {
		return Promise.resolve({ ok: false, error: REBUILD_ERROR });
	}

	follow(_endpoint: string, _args: Record<string, unknown>, onFrame: (frame: IDshStreamFrame) => void): { streamId: string; close: () => void } {
		const streamId = generateUuid();
		// 立即以 error 帧通知调用方：连接层重建中，绝不静默。
		onFrame({ streamId, type: 'error', error: REBUILD_ERROR });
		return { streamId, close: () => undefined };
	}

	openWritableStream(_endpoint: string, _args: Record<string, unknown>, _signal: AbortSignal | undefined, onFrame: (frame: IDshStreamFrame) => void): WritableRemoteStream {
		const streamId = generateUuid();
		const fail = () => onFrame({ streamId, type: 'error', error: REBUILD_ERROR });
		// 异步触发一次 error，避免同步抛到 UI。
		Promise.resolve().then(fail);
		return {
			streamId,
			send: () => Promise.resolve(),
			end: () => Promise.resolve(),
			cancel: () => Promise.resolve(),
			close: () => Promise.resolve(),
		};
	}

	readonly onDidChangeState: Event<{ connected: boolean }> = this._onDidChangeState.event;
	readonly onDidStreamFrame: Event<IDshStreamFrame> = this._onDidStreamFrame.event;
}
