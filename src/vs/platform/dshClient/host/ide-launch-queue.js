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
 * 已报到的 IDE 进程登记表 + 报到前的开窗暂存队列。
 *
 * 单个客户端的生命周期：`register` 建立回调 → `launch` 投递请求（有回调直接调用，
 * 否则暂存于客户端队列）→ `poll` 取走；`dispose` 标记失效并从登记表移除。
 */
export class IdeLaunchQueue {
	constructor() {
		/** @type {Map<string, { alive: boolean, launch: (spec: IdeLaunchSpec) => void, poll: () => { requests: IdeLaunchSpec[] }, setLaunchHandler: (handler: (spec: IdeLaunchSpec) => void) => { ok: boolean }, dispose: () => void }>} */
		this.clients = new Map();
		/** @type {IdeLaunchSpec[]} */
		this.pending = [];
	}

	/**
	 * 登记一个已报到的 IDE 进程。重复报到只刷新 alive，不重建回调（避免丢请求）。
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
			return { ok: true, alreadyRegistered: true };
		}
		/** @type {((spec: IdeLaunchSpec) => void) | undefined} */
		let onLaunch;
		/** @type {IdeLaunchSpec[]} */
		const pending = [];
		const client = {
			alive: true,
			launch(spec) {
				if (onLaunch === undefined) {
					pending.push(spec);
					return;
				}
				onLaunch(spec);
			},
			/** IDE 侧每次轮询取走待处理的开窗请求（长轮询式，不建第二条通道）。 */
			poll() {
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
				this.alive = false;
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
	 * 把开窗请求交给一个在线的 IDE 进程。
	 * @param {IdeLaunchSpec} spec
	 * @returns {boolean} 是否有在线进程接收
	 */
	dispatch(spec) {
		for (const client of this.clients.values()) {
			if (client.alive) {
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