// src/vs/platform/dshClient/host/ide-launch-queue.js
// Host 侧 IDE 客户端登记与开窗请求队列（由 host/ide-service.js 的 @Remote 方法调用）。
//
// 为什么单独成文件：`launch` / `registerIdeClient` / `pollLaunch` 的行为需要可单测，
// 而 ide-service.js 依赖 @deepseek-ai/cordis 与 Typert 协议，仓库内无法直接加载。
// 本文件只做纯数据与队列，不引任何 @deepseek-ai/* 依赖（boundary 纪律）。
//
// 纪律（见 docs/DEVELOPMENT.md 第 7 章 §3.1 裁定）：`dshIde` 是 IDE 自己的 IPC 通道，
// Host 在另一个进程无法跨进程调用它；因此由 IDE 主动报到，Host 只保存回调并在轮询时
// 交还开窗请求。本文件不引入任何私有管道或第二套传输。

/**
 * 一次开窗请求（工作区由调用方传入，Host 不猜）。
 * @typedef {{ workspace?: string }} IdeLaunchSpec
 */

/**
 * 判定登记项是否仍然在线的轮询超时。
 *
 * 为什么需要它：IDE 进程被任务管理器结束 / 崩溃时不会调用 `dispose`，登记项会一直
 * `alive: true`，Host 于是把开窗请求投递给一个已死的进程并仍返回 `ok:true`——用户看到
 * 「点了没反应」而 Host 认为成功（2026-11-09 真机踩过）。IDE 侧轮询间隔是 1.5s，
 * 超过这个阈值没轮询即视为离线，由 `dispatch` 跳过并清理。
 */
export const IDE_CLIENT_POLL_TIMEOUT_MS = 15000;

/**
 * 已报到的 IDE 进程登记表 + 报到前的开窗暂存队列。
 *
 * 单个客户端的生命周期：`register` 建立回调 → `launch` 投递请求（有回调直接调用，
 * 否则暂存于客户端队列）→ `poll` 取走（同时刷新心跳）；`dispose` 标记失效并移除。
 */
export class IdeLaunchQueue {
	/**
	 * @param {() => number} [now] 时钟（测试注入；默认 `Date.now`）
	 */
	constructor(now = Date.now) {
		this.now = now;
		/** @type {Map<string, { alive: boolean, lastPollAt: number, launch: (spec: IdeLaunchSpec) => void, poll: () => { requests: IdeLaunchSpec[] }, setLaunchHandler: (handler: (spec: IdeLaunchSpec) => void) => { ok: boolean }, dispose: () => void }>} */
		this.clients = new Map();
		/** @type {IdeLaunchSpec[]} */
		this.pending = [];
	}

	/**
	 * 登记一个已报到的 IDE 进程。重复报到只刷新存活与心跳，不重建回调（避免丢请求）。
	 * @param {string} clientId IDE 侧生成的标识（用于注销）
	 * @returns {{ ok: boolean, alreadyRegistered?: boolean, dispose?: () => void, message?: string }}
	 */
	register(clientId) {
		if (typeof clientId !== 'string' || clientId === '') {
			return { ok: false, message: 'clientId must be a non-empty string' };
		}
		const existing = this.clients.get(clientId);
		if (existing !== undefined) {
			existing.alive = true;
			existing.lastPollAt = this.now();
			return { ok: true, alreadyRegistered: true };
		}
		/** @type {((spec: IdeLaunchSpec) => void) | undefined} */
		let onLaunch;
		/** @type {IdeLaunchSpec[]} */
		const pending = [];
		// 捕获队列的时钟：`client.poll` 是在 client 对象上调用的，`this` 不是队列。
		const clock = this.now;
		const client = {
			alive: true,
			lastPollAt: clock(),
			launch(spec) {
				if (onLaunch === undefined) {
					pending.push(spec);
					return;
				}
				onLaunch(spec);
			},
			/** IDE 侧每次轮询取走待处理的开窗请求（长轮询式，不建第二条通道），同时刷新心跳。 */
			poll() {
				client.lastPollAt = clock();
				const requests = pending.splice(0, pending.length);
				return { requests };
			},
			/** IDE 侧提供实际开窗入口（在它的渲染进程里执行）。 */
			setLaunchHandler(handler) {
				onLaunch = handler;
				while (pending.length > 0) {
					const spec = pending.shift();
					if (spec !== undefined) {
						handler(spec);
					}
				}
				return { ok: true };
			},
			dispose() {
				client.alive = false;
			},
		};
		this.clients.set(clientId, client);
		return {
			ok: true,
			dispose: () => {
				client.dispose();
				this.clients.delete(clientId);
			},
		};
	}

	/**
	 * 该登记项是否可以在本轮投递（在线且心跳未超时）。超时的登记项就地清理。
	 * @param {string} clientId
	 * @returns {boolean}
	 */
	isUsable(clientId) {
		const client = this.clients.get(clientId);
		if (client === undefined) {
			return false;
		}
		if (!client.alive || this.now() - client.lastPollAt > IDE_CLIENT_POLL_TIMEOUT_MS) {
			this.clients.delete(clientId);
			return false;
		}
		return true;
	}

	/**
	 * 把开窗请求交给一个在线且心跳有效的 IDE 进程。
	 * @param {IdeLaunchSpec} spec
	 * @returns {boolean} 是否有可用进程接收
	 */
	dispatch(spec) {
		for (const clientId of [...this.clients.keys()]) {
			if (!this.isUsable(clientId)) {
				continue;
			}
			const client = this.clients.get(clientId);
			if (client !== undefined) {
				client.launch(spec);
				return true;
			}
		}
		return false;
	}

	/**
	 * 暂存首次开窗请求：IDE 尚未报到时由 Host 拉起进程，报到后经 `poll` 取走。
	 * @param {IdeLaunchSpec} spec
	 */
	enqueue(spec) {
		this.pending.push(spec);
	}

	/**
	 * IDE 侧轮询待开窗请求：先取报到前暂存的，再取本客户端队列。
	 * @param {string} clientId
	 * @returns {{ ok: boolean, requests: IdeLaunchSpec[] }}
	 */
	poll(clientId) {
		const client = this.clients.get(clientId);
		if (client === undefined) {
			return { ok: false, requests: [] };
		}
		const outOfBand = this.pending.splice(0, this.pending.length);
		const own = client.poll();
		return { ok: true, requests: [...outOfBand, ...own.requests] };
	}
}