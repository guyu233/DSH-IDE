/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 渲染器（workbench）侧的 DSH 管道访问器（platform 层，common 可用）。
//
// 真正的 net 连接在 Electron 主进程（DshPipeClient，见 platform/dshPipe/electron-main 接线）。
// 渲染器通过 IMainProcessService 的主进程 IPC 频道 `dshPipe` 远程调用它：
//   - callA(method,payload)  -> 通道 A 一元方法（session.page / session.prompt / ...）
//   - follow(method,payload) -> 通道 A 流方法（session.follow），逐帧经 'a-event' 事件回推
//   - execB(op,args)         -> 通道 B 执行（一般由 Host 主动发起，这里仅对称/调试用）
//   - onDidExecRequest       -> 主进程 'b-exec' 推来的通道 B 执行请求（ideExec 执行后 replyExec 回填）
//
// 无 HTTP、无 cookie。所有 DSH 连接都在 Host 进程内完成。

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { IChannel } from '../../../base/parts/ipc/common/ipc.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';

/** 主进程 `dshPipe` 频道名（与 electron-main 注册一致）。 */
export const DSH_PIPE_CHANNEL = 'dshPipe';

/** 通道 A 流式帧回调载荷（'a-event' 事件）。 */
export interface IDshPipeFrame {
	readonly streamId: string;
	readonly frame: { id: string; event: 'snapshot' | 'data' | 'end' | 'error'; payload?: unknown };
}

/** Host 发起的通道 B 执行请求（主进程 'b-exec' 事件）。 */
export interface IDshExecRequest {
	readonly id: string;
	readonly op: string;
	readonly args: unknown;
}

/** 渲染器侧 DSH 管道访问器（DI 服务）。 */
export interface IDshChatClient {
	readonly _serviceBrand: undefined;
	readonly onDidFrame: Event<IDshPipeFrame>;
	/** 主进程经 'b-exec' 推来的通道 B 执行请求（由 ideExec 执行后 replyExec 回填）。 */
	readonly onDidExecRequest: Event<IDshExecRequest>;
	isConnected(): Promise<boolean>;
	/** 连接状态与 chatapp 资源目录（主进程报告）。 */
	getStatus(): Promise<{ connected: boolean; chatappDir?: string }>;
	callA<T = unknown>(method: string, payload?: unknown): Promise<T>;
	follow(method: string, payload: unknown, onFrame: (frame: IDshPipeFrame['frame']) => void, token?: CancellationToken): { streamId: string; done: Promise<void> };
	cancel(streamId: string): Promise<void>;
	execB<T = unknown>(op: string, args: unknown): Promise<{ ok: boolean; result?: T; error?: string; auditToken?: string }>;
	/** 回填一次通道 B 执行结果给主进程（再转 Host）。 */
	replyExec(id: string, ok: boolean, result?: unknown, error?: string, auditToken?: string): Promise<void>;
}

export const IDshChatClient = createDecorator<IDshChatClient>('dshChatClient');

/** 对主进程 DshPipeClient 的薄代理（单例）。 */
export class DshChatClient extends Disposable implements IDshChatClient {
	declare readonly _serviceBrand: undefined;

	private readonly channel: IChannel;
	private readonly _onDidFrame = this._register(new Emitter<IDshPipeFrame>());
	private readonly _onDidExecRequest = this._register(new Emitter<IDshExecRequest>());

	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		super();
		this.channel = mainProcessService.getChannel(DSH_PIPE_CHANNEL);
		// 单一底层监听：主进程把每帧包成 { streamId, frame } 经 'a-event' 回推。
		this._register(this.channel.listen<IDshPipeFrame>('a-event')((e) => this._onDidFrame.fire(e)));
		// 通道 B：主进程把 Host 的 ide_* 请求经 'b-exec' 推来。
		this._register(this.channel.listen<IDshExecRequest>('b-exec')((e) => this._onDidExecRequest.fire(e)));
	}

	/** 是否已连到 Host（由主进程报告）。 */
	async isConnected(): Promise<boolean> {
		try {
			const res = await this.channel.call<{ connected: boolean }>('status');
			return res?.connected === true;
		} catch {
			return false;
		}
	}

	/** 连接状态与 chatapp 资源目录。 */
	async getStatus(): Promise<{ connected: boolean; chatappDir?: string }> {
		try { return await this.channel.call<{ connected: boolean; chatappDir?: string }>('status'); }
		catch { return { connected: false }; }
	}

	/** 通道 A 一元调用：解析为 Host 返回的 result。 */
	callA<T = unknown>(method: string, payload?: unknown): Promise<T> {
		return this.channel.call<T>('callA', { method, payload });
	}

	/**
	 * 通道 A 流调用（如 session.follow）。
	 * 返回 streamId 与 done（流结束/出错时结算）；每帧经 onFrame 回调。
	 */
	follow(method: string, payload: unknown, onFrame: (frame: IDshPipeFrame['frame']) => void, token: CancellationToken = CancellationToken.None): { streamId: string; done: Promise<void> } {
		const streamId = generateUuid();
		const sub = this.onDidFrame((e) => {
			if (e.streamId === streamId) { onFrame(e.frame); }
		});
		const disposeSub: IDisposable = token.isCancellationRequested
			? Disposable.None
			: token.onCancellationRequested(() => { sub.dispose(); void this.channel.call('cancel', { streamId }).catch(() => undefined); });
		const done = this.channel.call<void>('follow', { streamId, method, payload }).finally(() => {
			sub.dispose();
			disposeSub.dispose();
		});
		return { streamId, done };
	}

	/** 取消一个进行中的流。 */
	cancel(streamId: string): Promise<void> {
		return this.channel.call<void>('cancel', { streamId });
	}

	/** 通道 B 执行（对称/调试用；生产由 Host 主动发起）。 */
	execB<T = unknown>(op: string, args: unknown): Promise<{ ok: boolean; result?: T; error?: string; auditToken?: string }> {
		return this.channel.call('execB', { op, args });
	}

	/** 回填一次通道 B 执行结果（主进程转 Host）。 */
	replyExec(id: string, ok: boolean, result?: unknown, error?: string, auditToken?: string): Promise<void> {
		return this.channel.call<void>('b-reply', { id, ok, result, error, auditToken });
	}

	readonly onDidFrame: Event<IDshPipeFrame> = this._onDidFrame.event;
	readonly onDidExecRequest: Event<IDshExecRequest> = this._onDidExecRequest.event;
}

/** 便于测试/兜底：生成一个以给定 channel 支撑的客户端（不常用）。 */
export function toDisposableClient(client: IDshChatClient): IDisposable {
	return toDisposable(() => { /* no-op：单例生命周期由 DI 管理 */ void client; });
}
