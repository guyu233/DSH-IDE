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
import { IChannel } from '../../../base/parts/ipc/common/ipc.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';
import {
	DSH_IDE_CHANNEL,
	DSH_IDE_FEATURE_UNAVAILABLE,
	DSH_IDE_INVALID_ARGUMENT,
	type DshIdeSessionNotice,
	type DshIdeSnapshot,
	type DshIdeWaterfallNotice,
	type DshRemoteError,
} from '../protocol/dshIdeProtocol.js';

export type DshClientCallResult<T = unknown> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: DshRemoteError };

/** 渲染器侧官方客户端访问器。 */
export interface IDshClientService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeState: Event<{ connected: boolean }>;
	/** 唯一快照流：`listen('snapshot')` 的原样转发（校验由 DshIdeConsumer 负责）。 */
	readonly onDidSnapshot: Event<DshIdeSnapshot>;
	/** waterfall 流：`listen('waterfall')` 的原样转发（校验由独立消费者负责，不进快照）。 */
	readonly onDidWaterfall: Event<DshIdeWaterfallNotice>;
	/** 官方 api-session 状态。不经过快照，也不附带会话正文。 */
	readonly onDidSessionNotice: Event<DshIdeSessionNotice>;
	/** 建立连接（控制命令 `open`），返回首帧；失败返回错误而非伪造状态。 */
	openView(spec: { view: string; params?: Record<string, unknown> }): Promise<DshClientCallResult<DshIdeSnapshot>>;
	/** 换一个会话继续跟（停旧流、按新地址重开）。 */
	rebindView(sessionId: string): Promise<DshClientCallResult<DshIdeSnapshot>>;
	/** 释放连接（控制命令 `close`）；不取消 DSH 会话。 */
	closeView(): Promise<void>;
	getStatus(): Promise<{ connected: boolean; endpoint?: string }>;
	connect(): Promise<{ ok: boolean; endpoint?: string; error?: DshRemoteError }>;
	/** 一元调用；当前骨架返回 FEATURE_UNAVAILABLE。 */
	call<T = unknown>(endpoint: string, args?: Record<string, unknown>, signal?: AbortSignal): Promise<DshClientCallResult<T>>;
}

export const IDshClientService = createDecorator<IDshClientService>('dshClientService');

const REBUILD_ERROR: DshRemoteError = {
	code: DSH_IDE_FEATURE_UNAVAILABLE,
	message: 'DSH-IDE connection layer is being rebuilt',
};

export class DshClientService extends Disposable implements IDshClientService {
	declare readonly _serviceBrand: undefined;

	private readonly channel: IChannel;
	/** 连接态：任一 `open` 成功或收到快照帧即为已连接（账号头像据此判断能否读账号）。 */
	private _connected = false;
	private readonly _onDidChangeState = this._register(new Emitter<{ connected: boolean }>());
	private readonly _onDidSnapshot = this._register(new Emitter<DshIdeSnapshot>());
	private readonly _onDidWaterfall = this._register(new Emitter<DshIdeWaterfallNotice>());
	private readonly _onDidSessionNotice = this._register(new Emitter<DshIdeSessionNotice>());

	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		super();
		this.channel = mainProcessService.getChannel(DSH_IDE_CHANNEL);
		// 快照流只在视图打开后由宿主推送；先注册监听，避免漏帧。
		// 这里**不做**结构/连续性校验：那是 DshIdeConsumer.accept() 的唯一职责。
		this._register(this.channel.listen<DshIdeSnapshot>('snapshot')(snapshot => {
			// Host 的 `rebuild` 快照是「传输断开、正在重连」的唯一信号：
			// 不在这里把连接态翻回 false，`onDidChangeState({connected:true})` 每窗口只会触发一次，
			// 重连后「清熔断」等依赖它的逻辑就永远不会再跑。
			if (snapshot.state.state === 'rebuild') {
				this.markDisconnected();
			} else {
				this.markConnected();
			}
			this._onDidSnapshot.fire(snapshot);
		}));
		// 事件名与通道常量 DSH_IDE_WATERFALL_EVENT 同值。common 不引用 electron-main。
		this._register(this.channel.listen<DshIdeWaterfallNotice>('waterfall')(notice => {
			this.markConnected();
			this._onDidWaterfall.fire(notice);
		}));
		this._register(this.channel.listen<DshIdeSessionNotice>('session-notice')(notice => {
			this._onDidSessionNotice.fire(notice);
		}));
	}

	readonly onDidSnapshot: Event<DshIdeSnapshot> = this._onDidSnapshot.event;
	readonly onDidWaterfall: Event<DshIdeWaterfallNotice> = this._onDidWaterfall.event;
	readonly onDidSessionNotice: Event<DshIdeSessionNotice> = this._onDidSessionNotice.event;

	async getStatus(): Promise<{ connected: boolean; endpoint?: string }> {
		// 连接态 = 已经有过一次成功的 `open`（宿主回了首帧快照）。
		// 不再硬编码 false：那会让账号头像永远落在「不可用」分支（真机现象）。
		// 这里不伪造 endpoint：端点由 Host 自解析后写文件，渲染器不持有它。
		return { connected: this._connected };
	}

	async openView(spec: { view: string; params?: Record<string, unknown> }): Promise<DshClientCallResult<DshIdeSnapshot>> {
		try {
			const snapshot = await this.channel.call<DshIdeSnapshot>('open', spec);
			this.markConnected();
			return { ok: true, value: snapshot };
		} catch (error) {
			return { ok: false, error: toRemoteError(error, DSH_IDE_INVALID_ARGUMENT) };
		}
	}

	async rebindView(sessionId: string): Promise<DshClientCallResult<DshIdeSnapshot>> {
		try {
			const snapshot = await this.channel.call<DshIdeSnapshot>('rebind', { sessionId });
			this.markConnected();
			return { ok: true, value: snapshot };
		} catch (error) {
			return { ok: false, error: toRemoteError(error, DSH_IDE_INVALID_ARGUMENT) };
		}
	}

	/** 置为已连接并广播；仅在状态真正翻转时发事件，避免轮询刷出重复帧。 */
	private markConnected(): void {
		if (this._connected) {
			return;
		}
		this._connected = true;
		this._onDidChangeState.fire({ connected: true });
	}

	/** 置为断开并广播；由 Host 的 `rebuild` 快照驱动，重连成功后再次 `markConnected()`。 */
	private markDisconnected(): void {
		if (!this._connected) {
			return;
		}
		this._connected = false;
		this._onDidChangeState.fire({ connected: false });
	}

	async closeView(): Promise<void> {
		try {
			await this.channel.call('close', {});
		} catch {
			// 关闭失败不影响用户体验：连接可能已被宿主清理（窗口断开）。
		}
		// 不管通道是否还在，本窗口的连接态都要落下。否则界面会停在「已连接」。
		this.markDisconnected();
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

	readonly onDidChangeState: Event<{ connected: boolean }> = this._onDidChangeState.event;
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
