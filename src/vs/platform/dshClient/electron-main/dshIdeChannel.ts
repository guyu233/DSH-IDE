/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P3：唯一 DSH-IDE 通道实现（`IServerChannel<string>`，token 恒为 `dshIde`）。
//
// 通道只依赖 `IdeViewHost` 窄接口（见 dshIdeProtocol.ts），不持有插件宿主上下文，
// 也不直连 electron API；DSH 能力的真实实现由插件 Host 层的视图宿主提供。
//
// 三个职责：
//   call()         —— 控制命令（open / close）与 22 个 DTO method 的唯一分发入口；
//   listen()       —— 只发布本条连接所属视图的快照（三层过滤）；
//   disposeOwner() —— 窗口断开时只清理该连接持有的订阅，不代用户取消 DSH 会话。

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import {
	DSH_IDE_CHANNEL,
	DSH_IDE_FEATURE_UNAVAILABLE,
	DSH_IDE_INVALID_ARGUMENT,
	exactRecord,
	validateDshIdeInput,
	validateDshIdeInvokeOutput,
	type DshIdeSessionNotice,
	type DshIdeSnapshot,
	type DshIdeWaterfallNotice,
	type DshRemoteError,
	type IdeViewHost,
} from '../common/dshIdeProtocol.js';

/** 通道控制命令：负责建立/释放一条连接，不属于 22 个 DTO method 白名单。 */
export const DSH_IDE_CONTROL_OPEN = 'open';
export const DSH_IDE_CONTROL_CLOSE = 'close';
/** 换会话控制命令：停掉旧流，按新会话重开。 */
export const DSH_IDE_CONTROL_REBIND = 'rebind';
/**
 * 开窗控制命令（P5）：由 DSH 主窗口的按钮触发，在本进程内打开/唤起 IDE 窗口。
 *
 * 只做「开窗」这一件事，不携带 token、不建第二条通道（第 4 章 T1 边界）。
 */
export const DSH_IDE_CONTROL_LAUNCH = 'launch';

/**
 * 开窗宿主：由 `app.ts` 注入（那里持有 `windowsMainService`）。
 *
 * 通道层不直接依赖 electron，保持 `App.ts` 之外的可测试性；实现由主进程提供。
 */
export interface DshIdeLauncher {
	/** 打开或唤起 IDE 窗口；返回是否成功（失败不抛，由调用方给出确定提示）。 */
	launch(spec: { workspace?: string; sessionId?: string }): Promise<{ ok: true } | { ok: false; message: string }>;
}

/** 快照事件名（`listen` 白名单之一）。 */
export const DSH_IDE_SNAPSHOT_EVENT = 'snapshot';
/** waterfall 事件名（审批 / 问卷；`listen` 白名单之二）。 */
export const DSH_IDE_WATERFALL_EVENT = 'waterfall';
/** 会话状态事件名。不进快照 version。 */
export const DSH_IDE_SESSION_NOTICE_EVENT = 'session-notice';

interface DshIdeConnection {
	/**
	 * 该连接独占的视图宿主。
	 *
	 * 为什么一个连接一个视图：窗口之间共享一个视图时，第二个窗口 `open` 会复用第一个窗口的
	 * 绑定与订阅，两个窗口于是跟同一条会话。视图随连接创建、随连接释放，DSH 会话本身不因此取消。
	 */
	readonly view: IdeViewHost;
	/** 该连接绑定的窗口级通道 id，守恒。 */
	readonly channelId: string;
	/** 该连接上最近一次发布的快照。 */
	last: DshIdeSnapshot;
	/** 快照流订阅句柄。 */
	readonly subscription: { dispose(): void };
	/** waterfall 订阅句柄。与快照分开，不参与 version 过滤。 */
	readonly waterfall: { dispose(): void };
	readonly sessionNotice: { dispose(): void };
}

function toDshIdeError(error: unknown, code: string): DshRemoteError {
	const message = error instanceof Error ? error.message : String(error);
	return { code, message };
}

export class DshIdeChannel extends Disposable implements IServerChannel<string> {
	private readonly _onDidSnapshot = this._register(new Emitter<{ readonly ctx: string; readonly snapshot: DshIdeSnapshot }>());
	private readonly _onDidWaterfall = this._register(new Emitter<{ readonly ctx: string; readonly notice: DshIdeWaterfallNotice }>());
	private readonly _onDidSessionNotice = this._register(new Emitter<{ readonly ctx: string; readonly notice: DshIdeSessionNotice }>());
	private readonly _connections = new Map<string, DshIdeConnection>();
	/** 每个连接已发出的最大 version：丢弃重复/倒退帧，保证消费者看到严格 +1。 */
	private readonly _lastSentVersion = new Map<string, number>();

	/** 每条连接一个视图实例；同一条连接内重复 `open` 仍复用该实例。 */
	private readonly createView: () => IdeViewHost;
	private readonly launcher: DshIdeLauncher | undefined;
	/**
	 * 通道整体释放时关闭共享传输。
	 *
	 * 传输是进程级资源（一条 cookie、一个 origin），不能由任一窗口关闭：窗口关闭只释放它自己的
	 * 视图订阅，否则另一个窗口会被连坐断流。
	 */
	private readonly disposeBackend: (() => void) | undefined;

	constructor(createView: () => IdeViewHost, launcher?: DshIdeLauncher, disposeBackend?: () => void) {
		super();
		this.createView = createView;
		this.launcher = launcher;
		this.disposeBackend = disposeBackend;
	}

	/**
	 * 三层过滤：① 事件名白名单只放行 `snapshot` 与 `waterfall`；② 归属过滤只把本连接（ctx）
	 * 所属视图的帧发出去；③ 快照连续性过滤丢弃 `version` 未严格递增的重复/倒退帧。
	 * waterfall 没有 version，不做第③层。
	 */
	listen<T>(ctx: string, event: string, _arg?: unknown): Event<T> {
		if (event !== DSH_IDE_SNAPSHOT_EVENT && event !== DSH_IDE_WATERFALL_EVENT && event !== DSH_IDE_SESSION_NOTICE_EVENT) {
			return Event.None as Event<T>;
		}
		if (event === DSH_IDE_SESSION_NOTICE_EVENT) {
			return Event.map(
				Event.filter(this._onDidSessionNotice.event, emitted => emitted.ctx === ctx),
				emitted => emitted.notice as unknown as T,
			);
		}
		if (event === DSH_IDE_WATERFALL_EVENT) {
			return Event.map(
				Event.filter(this._onDidWaterfall.event, emitted => emitted.ctx === ctx),
				emitted => emitted.notice as unknown as T,
			);
		}
		// 第二代过滤（连接归属）在 listen 上完成，第三代（version 严格递增）在发布侧按 ctx 去重，
		// 两级都用平台既有的 Event.filter / Event.map，避免自造事件适配层。
		return Event.map(
			Event.filter(this._onDidSnapshot.event, emitted => emitted.ctx === ctx),
			emitted => emitted.snapshot as unknown as T,
		);
	}

	async call<T>(ctx: string, command: string, arg?: unknown): Promise<T> {
		if (command === DSH_IDE_CONTROL_OPEN) {
			return this.open(ctx, arg) as unknown as T;
		}
		if (command === DSH_IDE_CONTROL_CLOSE) {
			this.disposeOwner(ctx);
			return { closed: true } as unknown as T;
		}
		if (command === DSH_IDE_CONTROL_REBIND) {
			return this.rebind(ctx, arg) as unknown as T;
		}
		if (command === DSH_IDE_CONTROL_LAUNCH) {
			return this.launch(arg) as unknown as T;
		}
		return this.invoke<T>(ctx, command, arg);
	}

	/**
	 * 开窗（P5）：委派给主进程注入的 launcher。
	 * 未注入时明确拒绝（feature-unavailable），不伪造「已开窗」。
	 */
	private async launch(arg: unknown): Promise<{ ok: true } | { ok: false; message: string; code?: string }> {
		if (this.launcher === undefined) {
			return { ok: false, code: DSH_IDE_FEATURE_UNAVAILABLE, message: 'DSH-IDE launcher is not wired in this process' };
		}
		let spec: Record<string, unknown>;
		try {
			// 只把 `undefined`（调用方省略参数）当成空规格；`null` 是畸形输入，
			// 必须交给 exactRecord 拒绝。原先写 `arg ?? {}` 会把 null 也吞成 {}，
			// 让一次畸形调用被当成「打开当前工作区」而静默成功。
			spec = exactRecord(arg === undefined ? {} : arg, ['workspace', 'sessionId'], 'DshIdeChannel.launch');
		} catch (error) {
			// 参数形状违规：按契约返回确定错误码，不让异常穿透通道（与 22 method 口径一致）。
			return { ok: false, code: DSH_IDE_INVALID_ARGUMENT, message: error instanceof Error ? error.message : String(error) };
		}
		const workspace = spec['workspace'];
		const sessionId = spec['sessionId'];
		if (workspace !== undefined && (typeof workspace !== 'string' || workspace.trim() === '')) {
			return { ok: false, code: DSH_IDE_INVALID_ARGUMENT, message: 'DshIdeChannel.launch.workspace must be a non-empty string' };
		}
		if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId.trim() === '')) {
			return { ok: false, code: DSH_IDE_INVALID_ARGUMENT, message: 'DshIdeChannel.launch.sessionId must be a non-empty string' };
		}
		return this.launcher.launch({
			...(typeof workspace === 'string' ? { workspace } : {}),
			...(typeof sessionId === 'string' ? { sessionId } : {}),
		});
	}

	/** 建立（或复用）一条连接：同一 ctx 重复 open 不产生第二个 channelId。 */
	private open(ctx: string, arg: unknown): DshIdeSnapshot {
		const existing = this._connections.get(ctx);
		if (existing !== undefined) {
			return existing.last;
		}
		const spec = exactRecord(arg, ['view', 'params'], 'DshIdeChannel.open');
		const viewName = spec['view'];
		if (typeof viewName !== 'string' || viewName.trim() === '') {
			throw toDshIdeError(new TypeError('DshIdeChannel.open.view must be a non-empty string'), DSH_IDE_INVALID_ARGUMENT);
		}
		const view = this.createView();
		const first = view.open(spec as { view: string; params?: Record<string, unknown> });
		const waterfall = view.subscribeWaterfall(notice => {
			if (!this._connections.has(ctx)) {
				return;
			}
			this._onDidWaterfall.fire({ ctx, notice });
		});
		const sessionNotice = view.subscribeSessionNotice(notice => {
			if (!this._connections.has(ctx)) {
				return;
			}
			this._onDidSessionNotice.fire({ ctx, notice });
		});
		const subscription = view.subscribe(snapshot => {
			const connection = this._connections.get(ctx);
			if (connection === undefined || snapshot.channelId !== connection.channelId) {
				// 归属过滤：别的视图的帧不会经由本连接发出。
				return;
			}
			const sent = this._lastSentVersion.get(ctx) ?? -1;
			if (snapshot.version <= sent) {
				// 连续性过滤：重复或倒退帧一律丢弃（第 2 章 §5.1 第 1 条）。
				return;
			}
			this._lastSentVersion.set(ctx, snapshot.version);
			connection.last = snapshot;
			this._onDidSnapshot.fire({ ctx, snapshot });
		});
		this._connections.set(ctx, { view, channelId: first.channelId, last: first, subscription, waterfall, sessionNotice });
		return first;
	}

	/** 换会话：同一条连接上停旧流、按新会话重开；channelId 不变。 */
	private rebind(ctx: string, arg: unknown): DshIdeSnapshot {
		this.assertOpen(ctx);
		const spec = exactRecord(arg, ['sessionId'], 'DshIdeChannel.rebind');
		const sessionId = spec['sessionId'];
		if (typeof sessionId !== 'string' || sessionId === '') {
			throw toDshIdeError(new TypeError('DshIdeChannel.rebind.sessionId must be a non-empty string'), DSH_IDE_INVALID_ARGUMENT);
		}
		return this.assertOpen(ctx).view.rebind(sessionId);
	}

	/** 22 个 DTO method 的唯一分发路径：入参校验 → 宿主调用 → 出参校验。 */
	private async invoke<T>(ctx: string, method: string, arg: unknown): Promise<T> {
		const connection = this.assertOpen(ctx);
		let validated: unknown;
		try {
			validated = validateDshIdeInput(method as never, arg);
		} catch (error) {
			const code = error instanceof TypeError
				? (String((error as Error).message).includes('is not defined') ? DSH_IDE_FEATURE_UNAVAILABLE : DSH_IDE_INVALID_ARGUMENT)
				: DSH_IDE_INVALID_ARGUMENT;
			throw toDshIdeError(error, code);
		}
		let value: unknown;
		try {
			value = await connection.view.invoke(method, validated);
		} catch (error) {
			throw (typeof error === 'object' && error !== null && 'code' in error) ? error : toDshIdeError(error, DSH_IDE_FEATURE_UNAVAILABLE);
		}
		try {
			return validateDshIdeInvokeOutput({ value }) as T;
		} catch (error) {
			throw toDshIdeError(error, DSH_IDE_INVALID_ARGUMENT);
		}
	}

	private assertOpen(ctx: string): DshIdeConnection {
		const connection = this._connections.get(ctx);
		if (connection === undefined) {
			throw { code: DSH_IDE_FEATURE_UNAVAILABLE, message: `${DSH_IDE_CHANNEL}: connection ${ctx} is not open` } satisfies DshRemoteError;
		}
		return connection;
	}

	/** 清理某窗口（ctx）拥有的资源；返回被清理的连接数。 */
	disposeOwner(ctx: string): number {
		const connection = this._connections.get(ctx);
		if (connection === undefined) {
			return 0;
		}
		this._connections.delete(ctx);
		this._lastSentVersion.delete(ctx);
		connection.subscription.dispose();
		connection.waterfall.dispose();
		connection.sessionNotice.dispose();
		// 只释放本窗口的视图与订阅；不停止 DSH 会话，也不关闭共享传输。
		connection.view.close();
		return 1;
	}

	override dispose(): void {
		for (const ctx of [...this._connections.keys()]) {
			this.disposeOwner(ctx);
		}
		// 所有窗口都已释放：共享传输在这里关闭一次。
		this.disposeBackend?.();
		super.dispose();
	}
}
