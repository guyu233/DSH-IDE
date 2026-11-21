// src/vs/platform/dshClient/host/ide-launch-queue.js
// Host 侧 IDE 客户端登记与开窗请求队列（由 host/ide-service.js 的 @Remote 方法调用）。
//
// 为什么单独成文件：`launch` / `registerIdeClient` / `pollLaunch` 的行为需要可单测，
// 而 ide-service.js 依赖 @deepseek-ai/cordis 与 Typert 协议，仓库内无法直接加载。
// 本文件只做纯数据与队列，不引任何 @deepseek-ai/* 依赖（boundary 纪律）。
//
// 纪律：`dshIde` 是 IDE 自己的 IPC 通道，
// Host 在另一个进程无法跨进程调用它；因此由 IDE 主动报到，Host 只保存回调并在轮询时
// 交还开窗请求。本文件不引入任何私有管道或第二套传输。

/**
 * 一次开窗请求（工作区与会话都由调用方传入，Host 不猜）。
 * @typedef {{ workspace?: string, sessionId?: string }} IdeLaunchSpec
 */

/**
 * 判定登记项是否仍然在线的轮询超时。
 *
 * 为什么需要它：IDE 进程被任务管理器结束 / 崩溃时不会调用 `dispose`，登记项会一直
 * `alive: true`，Host 于是把开窗请求投递给一个已死的进程并仍返回 `ok:true`——用户看到
 * 「点了没反应」而 Host 认为成功（2026-11-09 真机踩过）。IDE 侧一次长轮询最多挂 8s，
 * 超过这个阈值没轮询即视为离线，由 `dispatch` 跳过并清理。
 *
 * IDE 侧用长轮询把这次心跳撑满：一次 `poll` 可以挂起，但挂起时间必须短于本阈值，
 * 否则「正在等请求」会被当成进程已死。
 */
export const IDE_CLIENT_POLL_TIMEOUT_MS = 15000;

/**
 * 单次长轮询允许挂起的上限。
 *
 * 8s < 15s 心跳：等待期间 `lastPollAt` 仍算活着，用户点击能立刻唤醒，
 * 而不是每 1.5s 空打一次跨进程调用。调用方传更大的值会被夹到这里。
 */
export const IDE_CLIENT_LONG_POLL_MS = 8000;

/**
 * 把调用方给的等待时间收成「立即返回」或「不超过长轮询上限」的毫秒数。
 * 非数字、NaN、非正数都视为立即返回，避免把轮询挂死。
 * @param {unknown} waitMs
 * @returns {number}
 */
export function normalizeLaunchWait(waitMs) {
	if (typeof waitMs !== 'number' || !Number.isFinite(waitMs) || waitMs <= 0) {
		return 0;
	}
	return Math.min(Math.floor(waitMs), IDE_CLIENT_LONG_POLL_MS);
}

/**
 * 首次拉起 IDE 时传给 Electron 的位置参数。
 *
 * Electron 把以 `-` 开头的参数当成开关。工作区来自会话 cwd，必须放在 `--` 后面，
 * 否则这段字符串会变成启动开关而不是要打开的目录。正常路径同样放在 `--` 后面，
 * VS Code 的 argv 解析会把它收进位置参数。
 * @param {string | undefined} workspace
 * @returns {string[]}
 */
export function ideWorkspaceArgs(workspace) {
	if (typeof workspace !== 'string' || workspace === '') {
		return [];
	}
	return ['--', workspace];
}

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
		/** @type {Set<{ clientId: string, timer: ReturnType<typeof setTimeout>, resolve: (value: { ok: boolean, requests: IdeLaunchSpec[] }) => void }>} */
		this._waiters = new Set();
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
		const queue = this;
		const client = {
			alive: true,
			lastPollAt: clock(),
			launch(spec) {
				if (onLaunch === undefined) {
					pending.push(spec);
					// 有人正挂在长轮询上：立刻交还，不要干等下一次超时。
					queue._wake();
					return;
				}
				onLaunch(spec);
			},
			/** 本客户端还没被 poll 取走的请求数。长轮询用它判断要不要提前返回。 */
			pendingCount() {
				return pending.length;
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
				this._dropWaiters(clientId);
			},
		};
	}

	/**
	 * 注销一个登记项（IDE 进程正常退出时调用）。
	 *
	 * 与 `register` 返回的 `dispose` 等价，但按 clientId 寻址：IDE 退出路径拿不到
	 * 当初返回的闭包，只能用自己的标识注销。已不存在时是空操作。
	 * @param {string} clientId
	 * @returns {{ ok: boolean }}
	 */
	unregister(clientId) {
		const client = this.clients.get(clientId);
		if (client !== undefined) {
			client.dispose();
			this.clients.delete(clientId);
		}
		this._dropWaiters(clientId);
		return { ok: true };
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
			this._dropWaiters(clientId);
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
	 *
	 * **只保留一条**：`launch()` 在 IDE 启动的数秒内会反复进来（用户会连点，
	 * 防抖只是不再重复 spawn，但仍会走到 enqueue）。若每次 push，等 IDE 报到时
	 * 会把 N 条陈年请求一次性投给它，开出 N 个窗口。
	 *
	 * 语义上这段时间只可能有「当前这一次首点」有意义：后到的请求覆盖前一条
	 * （用户最后一次点的会话/工作区就是要打开的那个）。
	 * @param {IdeLaunchSpec} spec
	 */
	enqueue(spec) {
		this.pending.length = 0;
		this.pending.push(spec);
		this._wake();
	}

	/**
	 * IDE 侧轮询待开窗请求：先取报到前暂存的，再取本客户端队列。
	 *
	 * `waitMs === 0`（缺省）立刻返回，既有调用与测试保持同步。
	 * `waitMs > 0` 且当前没有请求时挂起，直到有请求、登记被注销，或到达上限。
	 * 已经有请求时即使给了 waitMs 也立刻返回，不空等。
	 * @param {string} clientId
	 * @param {number} [waitMs]
	 * @returns {{ ok: boolean, requests: IdeLaunchSpec[] } | Promise<{ ok: boolean, requests: IdeLaunchSpec[] }>}
	 */
	poll(clientId, waitMs = 0) {
		const client = this.clients.get(clientId);
		if (client === undefined) {
			return { ok: false, requests: [] };
		}
		const wait = normalizeLaunchWait(waitMs);
		if (this._hasWork(client) || wait === 0) {
			return this._collect(client);
		}
		// 挂起本身就是一次心跳：否则等到返回时 lastPollAt 已经旧了 8 秒，
		// 中间插进来的 dispatch 会把还活着的窗口当成崩溃。
		client.lastPollAt = this.now();
		return new Promise(resolve => {
			/** @type {{ clientId: string, timer: ReturnType<typeof setTimeout>, resolve: (value: { ok: boolean, requests: IdeLaunchSpec[] }) => void }} */
			const entry = {
				clientId,
				timer: /** @type {ReturnType<typeof setTimeout>} */ (undefined),
				resolve: value => {
					this._waiters.delete(entry);
					clearTimeout(entry.timer);
					resolve(value);
				},
			};
			entry.timer = setTimeout(() => {
				entry.resolve(this._collectIfPresent(clientId));
			}, wait);
			this._waiters.add(entry);
		});
	}

	/**
	 * 这个客户端或全局暂存里是否已经有请求。
	 * @param {{ pendingCount: () => number }} client
	 */
	_hasWork(client) {
		return this.pending.length > 0 || client.pendingCount() > 0;
	}

	/**
	 * 取走当前能交还的请求，并刷新心跳。
	 * @param {{ poll: () => { requests: IdeLaunchSpec[] } }} client
	 * @returns {{ ok: true, requests: IdeLaunchSpec[] }}
	 */
	_collect(client) {
		const outOfBand = this.pending.splice(0, this.pending.length);
		const own = client.poll();
		return { ok: true, requests: [...outOfBand, ...own.requests] };
	}

	/**
	 * @param {string} clientId
	 * @returns {{ ok: boolean, requests: IdeLaunchSpec[] }}
	 */
	_collectIfPresent(clientId) {
		const client = this.clients.get(clientId);
		if (client === undefined) {
			return { ok: false, requests: [] };
		}
		return this._collect(client);
	}

	/** 把已经在等的 poll 叫醒。没有请求的等待者继续挂着。 */
	_wake() {
		for (const entry of [...this._waiters]) {
			const client = this.clients.get(entry.clientId);
			if (client === undefined) {
				entry.resolve({ ok: false, requests: [] });
				continue;
			}
			if (!this._hasWork(client)) {
				continue;
			}
			entry.resolve(this._collect(client));
		}
	}

	/**
	 * 登记消失时不能把长轮询留到超时：IDE 已经退出，RPC 应立刻结束。
	 * @param {string} clientId
	 */
	_dropWaiters(clientId) {
		for (const entry of [...this._waiters]) {
			if (entry.clientId === clientId) {
				entry.resolve({ ok: false, requests: [] });
			}
		}
	}
}