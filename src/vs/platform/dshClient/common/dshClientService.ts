/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 渲染器（workbench）侧的官方客户端访问器（platform 层，common 可用）。
//
// P4：旧 dshClient IPC 频道已删除，本服务消费唯一的 'dshIde' 频道。
//
// 两条路径严格分开（第 2 章 §5.1）：
//   - 状态变化只走 `listen('snapshot')`：本服务把快照原样转发给 `onDidSnapshot`，
//     **不做**校验（校验是 `DshIdeConsumer.accept()` 的职责，避免两处实现漂移）；
//   - 调用只走 `call(method, args)`，返回 `{ value }`，绝不回推快照。
//
// 快照是 `DshIdeSnapshot`（wireRevision 2，`ready` 时携带 `state.view` 投影载荷）。

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { IChannel } from '../../../base/parts/ipc/common/ipc.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';
import {
	DSH_IDE_CHANNEL,
	DSH_IDE_FEATURE_UNAVAILABLE,
	DSH_IDE_INVALID_ARGUMENT,
	type DshIdeSnapshot,
	type DshRemoteError,
} from './dshIdeProtocol.js';

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
	/** 唯一快照流：`listen('snapshot')` 的原样转发（校验由 DshIdeConsumer 负责）。 */
	readonly onDidSnapshot: Event<DshIdeSnapshot>;
	/** 建立连接（控制命令 `open`），返回首帧；失败返回错误而非伪造状态。 */
	openView(spec: { view: string; params?: Record<string, unknown> }): Promise<DshClientCallResult<DshIdeSnapshot>>;
	/** 释放连接（控制命令 `close`）；不取消 DSH 会话。 */
	closeView(): Promise<void>;
	getStatus(): Promise<{ connected: boolean; endpoint?: string }>;
	connect(): Promise<{ ok: boolean; endpoint?: string; error?: DshRemoteError }>;
	/** 一元调用；当前骨架返回 FEATURE_UNAVAILABLE。 */
	call<T = unknown>(endpoint: string, args?: Record<string, unknown>, signal?: AbortSignal): Promise<DshClientCallResult<T>>;
	/**
	 * 打开一条逻辑流。当前骨架立即回传 error 帧（「重建中」），绝不静默。
	 */
	follow(endpoint: string, args: Record<string, unknown>, onFrame: (frame: IDshStreamFrame) => void): { streamId: string; close: () => void };
}

/** 具备可写双向流能力的客户端切片（P5 接入真实上行流）。 */
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
	private readonly _onDidSnapshot = this._register(new Emitter<DshIdeSnapshot>());

	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		super();
		this.channel = mainProcessService.getChannel(DSH_IDE_CHANNEL);
		// 快照流只在视图打开后由宿主推送；先注册监听，避免漏帧。
		// 这里**不做**结构/连续性校验：那是 DshIdeConsumer.accept() 的唯一职责。
		this._register(this.channel.listen<DshIdeSnapshot>('snapshot')(snapshot => this._onDidSnapshot.fire(snapshot)));
	}

	readonly onDidSnapshot: Event<DshIdeSnapshot> = this._onDidSnapshot.event;

	async getStatus(): Promise<{ connected: boolean; endpoint?: string }> {
		// 状态由快照流体现（未收到 ready 帧即视为未连接），这里不伪造 endpoint。
		return { connected: false };
	}

	async openView(spec: { view: string; params?: Record<string, unknown> }): Promise<DshClientCallResult<DshIdeSnapshot>> {
		try {
			const snapshot = await this.channel.call<DshIdeSnapshot>('open', spec);
			return { ok: true, value: snapshot };
		} catch (error) {
			return { ok: false, error: toRemoteError(error, DSH_IDE_INVALID_ARGUMENT) };
		}
	}

	async closeView(): Promise<void> {
		try {
			await this.channel.call('close', {});
		} catch {
			// 关闭失败不影响用户体验：连接可能已被宿主清理（窗口断开）。
		}
	}

	connect(): Promise<{ ok: boolean; endpoint?: string; error?: DshRemoteError }> {
		return Promise.resolve({ ok: false, error: REBUILD_ERROR });
	}

	async call<T = unknown>(endpoint: string, args?: Record<string, unknown>): Promise<DshClientCallResult<T>> {
		try {
			// method 直接作为命令名（第 2 章 §4：method 就是 IServerChannel 的 command）。
			const output = await this.channel.call<{ value: T }>(endpoint, args ?? {});
			return { ok: true, value: output.value };
		} catch (error) {
			return { ok: false, error: toRemoteError(error, DSH_IDE_FEATURE_UNAVAILABLE) };
		}
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

/** 把通道抛出的错误收敛成 `DshRemoteError`；未知形状按给定默认码处理。 */
function toRemoteError(error: unknown, fallbackCode: string): DshRemoteError {
	if (typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code: unknown }).code === 'string') {
		const coded = error as { code: string; message?: unknown; details?: unknown };
		return {
			code: coded.code,
			message: typeof coded.message === 'string' ? coded.message : String(error),
			...(coded.details === undefined ? {} : { details: coded.details }),
		};
	}
	return { code: fallbackCode, message: error instanceof Error ? error.message : String(error) };
}
