/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P5 开窗的 IDE 侧接单器：让 DSH 主窗口的「DSH-IDE」按钮真的能开窗。
//
// 问题（真机实测）：`dshIde` 是 **IDE 自己的** IPC 通道，Host 在另一个进程，无法跨进程调用它。
// 所以「按钮 → 开窗」不能由 Host 直接完成，必须由 IDE 自己接单。
//
// 方案（不引入私有管道，遵守第 7 章 §3.1 裁定）：
//   1. IDE 启动后经**官方 Typert Gateway** 调 `ide.registerIdeClient(clientId)` 报到；
//   2. IDE 定时调 `ide.pollLaunch(clientId)` 取待处理的开窗请求；
//   3. 取到后在本进程内调用注入的 `onLaunch`（主进程的开窗入口）。
//
// 轮询而非推送：官方客户端传输已提供流式能力，但「开窗」是极低频事件（用户点一次），
// 用长轮询换取实现简单与无需额外订阅登记，属于合理取舍；若将来要改成流，只需换这一层。

import { Disposable } from '../../../base/common/lifecycle.js';

/** 轮询间隔：开窗是低频操作，1.5s 足够，且不打扰 Host。 */
export const DSH_IDE_LAUNCH_POLL_MS = 1500;

/** IDE 侧与 Host 的最小调用面（由 `DshIdeTransport` 提供，避免依赖具体实现）。 */
export interface DshIdeLaunchHostCaller {
	call(namespace: string, method: string, args: Record<string, unknown>): Promise<unknown>;
}

/** 开窗请求（由 Host 转来）。 */
export interface DshIdeLaunchRequest {
	readonly workspace?: string;
}

/**
 * 接单器：报到 + 轮询 + 分发到真实开窗入口。
 *
 * 失败策略：报到/轮询失败都**不抛出**（静默重试），因为它们只影响「按钮能否开窗」，
 * 不应影响 IDE 其他功能；但会在第一次失败后记录一次原因，便于排查。
 */
export class DshIdeLaunchListener extends Disposable {
	private readonly caller: DshIdeLaunchHostCaller;
	private readonly clientId: string;
	private readonly onLaunch: (request: DshIdeLaunchRequest) => void;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private registered = false;
	private disposed = false;
	private lastError: string | undefined;

	constructor(caller: DshIdeLaunchHostCaller, clientId: string, onLaunch: (request: DshIdeLaunchRequest) => void) {
		super();
		this.caller = caller;
		this.clientId = clientId;
		this.onLaunch = onLaunch;
	}

	/** 最近一次失败原因（未失败为 undefined）。 */
	get lastFailure(): string | undefined {
		return this.lastError;
	}

	/** 开始接单（幂等）。 */
	start(): void {
		if (this.disposed || this.timer !== undefined) {
			return;
		}
		this.schedule(0);
	}

	override dispose(): void {
		const wasRegistered = this.registered;
		this.disposed = true;
		this.registered = false;
		if (this.timer !== undefined) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		// 关窗时立刻向 Host 注销。不注销的话，旧登记项要等 15s 心跳超时才失效；
		// 这期间再点入口，Host 会把开窗请求投给已死的回调并返回成功，
		// 用户看到的就是「点了没反应，要等很久再点一次才打开」。
		if (wasRegistered) {
			void this.caller.call('ide', 'unregisterIdeClient', { clientId: this.clientId }).catch(() => {
				// 注销失败不影响进程退出：Host 侧仍会按心跳超时清理。
			});
		}
		super.dispose();
	}

	private schedule(delayMs: number): void {
		if (this.disposed) {
			return;
		}
		this.timer = setTimeout(() => {
			this.timer = undefined;
			void this.tick();
		}, delayMs);
	}

	private async tick(): Promise<void> {
		if (this.disposed) {
			return;
		}
		try {
			if (!this.registered) {
				await this.caller.call('ide', 'registerIdeClient', { clientId: this.clientId });
				this.registered = true;
				this.lastError = undefined;
			}
			const result = await this.caller.call('ide', 'pollLaunch', { clientId: this.clientId });
			this.dispatch(result);
			this.lastError = undefined;
		} catch (error) {
			// 报到失败通常是 Host 还没准备好端点：记录一次并继续重试。
			this.registered = false;
			this.lastError = error instanceof Error ? error.message : String(error);
		}
		this.schedule(DSH_IDE_LAUNCH_POLL_MS);
	}

	private dispatch(result: unknown): void {
		if (typeof result !== 'object' || result === null) {
			return;
		}
		const requests = (result as { requests?: unknown }).requests;
		if (!Array.isArray(requests)) {
			return;
		}
		for (const request of requests) {
			if (typeof request !== 'object' || request === null) {
				continue;
			}
			const workspace = (request as { workspace?: unknown }).workspace;
			// 开窗失败不能打断轮询循环：交给调用方处理，这里只保证不抛。
			try {
				this.onLaunch({ ...(typeof workspace === 'string' ? { workspace } : {}) });
			} catch (error) {
				this.lastError = error instanceof Error ? error.message : String(error);
			}
		}
	}
}
