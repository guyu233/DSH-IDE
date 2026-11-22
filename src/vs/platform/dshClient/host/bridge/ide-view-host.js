// src/vs/platform/dshClient/host/bridge/ide-view-host.js
// DSH-IDE Host 半身：在 DSH Host 进程内把官方事件与官方服务桥接给 IDE 主进程。
//
// 职责边界（第 1 章 §3）：本文件是唯一允许持有插件上下文、订阅 DSH 官方事件的插件侧代码。
// 它只做三件事：跟随会话（`sessionController.follow`，同一会话只跟一次）、接住批准 / 问卷
// 并让 IDE 与桌面都能答（先到的生效）、把 DTO method 映射到已核对的官方服务调用。
// 帧原样送到窗口，不翻译成另一套行；快照版本计数在 electron-main 的 `DshIdeViewService`。
//
// 传输端口：`transport` 由 P5 真机接线提供。未注入时本文件不伪造任何事件或决议：
// `follow` 只登记监听，answerer 一律 `next()` 委托给 DSH 自己的 answerer。
//
// 已核对的服务与方法（https://github.com/deepseek-ai/deepseek-harness，0.2.2-rc.1）：
//   sessions: get(id) / list()
//   sessionController: list / create / selectModel / modelCatalog / prompt / cancel / fork / state
//   approval/request 结果值：'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

import { randomUUID } from 'node:crypto';
import { projectDshIdeSessionList, projectDshIdeWorkspaceSessions } from '../../protocol/dshIdeSessionList.js';
import { projectDshIdeCommandList } from '../../protocol/dshIdeCommandList.js';
import { buildDshIdeCommandLine, mapDshIdeCommandExecution } from '../../protocol/dshIdeCommandLine.js';
import { projectDshIdeArchiveSet } from '../../protocol/dshIdeArchiveSet.js';
import { projectDshIdeSessionSearch } from '../../protocol/dshIdeSessionSearch.js';
import { projectDshIdeComposer } from '../../protocol/dshIdeComposer.js';
import { projectApprovalRequest, projectQuestionRequest } from '../../protocol/dshIdeRequestView.js';
import { safeErrorText } from '../../protocol/dshIdeAuthRedaction.js';
// 共享契约真源：Host 与 IDE 用同一份字段白名单与方法校验，不再各自复制一套规则。
import {
	DSH_IDE_HISTORY_MAX_MESSAGES,
	DSH_IDE_HISTORY_TURN_WINDOW,
	DSH_IDE_VIEW_BOUND_FRAME,
	requireDshIdeWireRevision,
	resolveDshSessionPin,
	validateDshIdeViewBinding,
} from '../../protocol/dshIdeProtocol.js';

/** 与 common/dshIdeProtocol.ts 同值的错误码（Host 半身为纯 JS，不跨层 import TS）。 */
export const FEATURE_UNAVAILABLE = 'dsh-ide/feature-unavailable';
export const INVALID_ARGUMENT = 'dsh-ide/invalid-argument';
export const ALREADY_RESOLVED = 'ALREADY_RESOLVED';
export const SESSION_SWITCHED = 'SESSION_SWITCHED';

/**
 * 校验对端声明的线协议修订号。
 *
 * 为什么不靠包版本号：同一个包里的两半仍可能被开发启动或旧安装拆开使用。协议修订号是
 * 两半共同声明、且由共享校验器核对的事实；不一致就拒绝，不按旧形状继续调用。
 * @param {unknown} value
 */
function requirePeerWireRevision(value) {
	requireDshIdeWireRevision(value);
}

/**
 * 从本次调用的运行时上下文读出可信主体。
 *
 * 为什么不用请求里的字段：调用方可以在 DTO 里写任何值。官方 Gateway 在调用上下文上提供
 * `this.ctx.invocation.peer`，其 `principal` 由 Host 在建立连接时固定，线协议字段无法设置。
 * @param {object} ctx
 * @returns {boolean} 是否为本地所有者（owner）主体
 */
function isTrustedOwnerCaller(ctx) {
	const invocation = ctx && typeof ctx === 'object' ? ctx.invocation : undefined;
	const peer = invocation && typeof invocation === 'object' ? invocation.peer : undefined;
	const principal = peer && typeof peer === 'object' ? peer.principal : undefined;
	return principal !== null && typeof principal === 'object' && principal.kind === 'owner';
}

/**
 * 调用方取消信号：官方把 carrier 取消注入到最后一个参数。
 * 没有调用上下文（本地直接调用）时给一个独立信号，保持既有行为。
 * @param {object} ctx
 */
function callerAbortSignal(ctx) {
	const invocation = ctx && typeof ctx === 'object' ? ctx.invocation : undefined;
	const signal = invocation && typeof invocation === 'object' ? invocation.signal : undefined;
	return signal !== undefined && typeof signal.aborted === 'boolean' ? signal : callerSignal();
}

/**
 * 本桥接的**核心**依赖：缺任一即无法跟随会话，桥接拒绝建立。
 *
 * `workspaceRegistry` 故意不在本表里：它只被归档 / 取消归档 / 删除这三条边角方法用到，
 * 而会话跟随、发送、批准、提问、模型切换都不需要它。把它列成硬依赖的后果是——
 * 一旦某套 profile 没装载提供该服务的 `@deepseek-ai/dsh-workspace`，整个桥接永远不就绪，
 * `ide/dispatch` 全量返回 "host bridge is not attached"，连聊天都开不了（真机实测）。
 * 那三条边角方法改为调用时按需校验：缺服务只让该能力失败，不拖垮整个桥接。
 */
export const REQUIRED_SERVICES = Object.freeze(['sessions', 'sessionController']);

/**
 * 官方 `sessionController` 的读取方法把 `AbortSignal` 当第二参。
 * 不传时实现里的 `signal.throwIfAborted()` / `signal.aborted` 会抛
 * `Cannot read properties of undefined (reading 'aborted')`，调用方只看到 gateway/internal。
 * 真机 `composerState` 已复现。这里给每次调用一个独立信号：取消发生在视图关闭，不靠这条信号。
 */
function callerSignal() {
	return new AbortController().signal;
}

function coded(code, message, details) {
	const error = new Error(message);
	error.code = code;
	if (details !== undefined) {
		error.details = details;
	}
	return error;
}

function service(ctx, name) {
	const value = typeof ctx.get === 'function' ? ctx.get(name) : undefined;
	if (value === undefined || value === null) {
		throw coded(FEATURE_UNAVAILABLE, `DSH service "${name}" is not available`, { service: name });
	}
	return value;
}

/** 可选服务：没挂上就当没有，不把输入框的其余控件一起藏掉。 */
function optionalService(ctx, name) {
	const value = typeof ctx.get === 'function' ? ctx.get(name) : undefined;
	return value === undefined || value === null ? undefined : value;
}

/**
 * 探测依赖插件的实际装载能力，供 UI 隐藏用不了的功能。
 *
 * 只看官方服务/命令是否真的在，不读插件清单、不猜版本：没装或没启用就是 false。
 * - rewind：`dsh-rewind-plugin` 注册的命令 `rewind-plugin`。
 * - sessionFavorite / sessionMove：`@michengai/dsh-archive-manager` 覆盖的 workspaceRegistry。
 * - sessionDelete：同一插件覆盖的 `deleteSession`。
 * @param {string} [sessionId] 绑定会话；有 live agent 时命令目录按该 agent 查，查不到再用无参目录。
 */
function probeDshIdeCapabilities(ctx, sessionId) {
	const registry = optionalService(ctx, 'workspaceRegistry');
	const sessionFavorite = registry !== undefined
		&& typeof registry.setSessionFavorite === 'function'
		&& typeof registry.favoriteSessions === 'function';
	const sessionMove = registry !== undefined && typeof registry.moveSessionToWorkspace === 'function';
	const sessionDelete = registry !== undefined && typeof registry.deleteSession === 'function';
	const hasRewind = listed => Array.isArray(listed)
		&& listed.some(item => item !== null && typeof item === 'object' && item.name === 'rewind-plugin');
	let rewind = false;
	try {
		const commands = optionalService(ctx, 'commands');
		if (commands !== undefined && typeof commands.list === 'function') {
			let listed;
			const agents = optionalService(ctx, 'agents');
			const agent = typeof sessionId === 'string' && sessionId !== '' && agents !== undefined && typeof agents.get === 'function'
				? agents.get(sessionId)
				: undefined;
			if (agent !== undefined && agent !== null) {
				listed = commands.list(agent);
			}
			if (!hasRewind(listed)) {
				// 没有绑定会话（或该 agent 查不到）时退回无参目录；两个来源任一命中即视为已装。
				listed = commands.list();
			}
			rewind = hasRewind(listed);
		}
	} catch {
		// 命令目录读不到就当没装；能力探测本身不能把整个视图打成失败。
		rewind = false;
	}
	return { rewind, sessionFavorite, sessionMove, sessionDelete };
}

function sectionValue(rows, namespace) {
	if (!Array.isArray(rows)) {
		return {};
	}
	const row = rows.find(item => item && (item.ns === namespace || item.namespace === namespace));
	const value = row && typeof row.value === 'object' && row.value !== null ? row.value : {};
	return value;
}

function transcriptViewOf(value) {
	if (value === 'compact' || value === 'standard' || value === 'detailed' || value === 'verbose') {
		return value;
	}
	if (value === 'normal' || value === 'expanded') {
		return 'detailed';
	}
	return 'standard';
}

function optionalCall(ctx, name, method) {
	const target = optionalService(ctx, name);
	if (target === undefined || typeof target[method] !== 'function') {
		return null;
	}
	try {
		return target[method]();
	} catch {
		return null;
	}
}

async function optionalCallAsync(ctx, name, method) {
	const target = optionalService(ctx, name);
	if (target === undefined || typeof target[method] !== 'function') {
		return null;
	}
	try {
		return await target[method]();
	} catch {
		return null;
	}
}

/**
 * 单条流的待送帧上限。
 *
 * 慢消费者（窗口卡顿、渲染阻塞）会让队列无限增长；到上限时丢弃旧增量并插入
 * 一条 `follow-overflow` 控制帧，让上层重读基线，而不是把内存耗光或静默错位。
 */
const DSH_IDE_FOLLOW_BUFFER_LIMIT = 512;

/** 审批结果映射：DTO 的两个字面量 → DSH 的 ApprovalOutcome。 */
export function approvalOutcome(decision) {
	if (decision === 'approve') {
		return 'allowed-once';
	}
	if (decision === 'reject') {
		return 'rejected';
	}
	throw coded(INVALID_ARGUMENT, `unknown approval decision ${JSON.stringify(decision)}`);
}

/**
 * 待决议请求表：waterfall 上每个请求注册一条等待中的 Promise；首个 `answerApproval` /
 * `answerQuestion` 生效后立即从表中移除，重复决议得到 ALREADY_RESOLVED（第 2 章 E5）。
 */
export class PendingRequests {
	constructor() {
		/** @type {Map<string, { kind: 'approval' | 'question', resolve: (value: unknown) => void }>} */
		this.entries = new Map();
	}

	/** 登记一条请求并返回它的等待句柄。 */
	register(kind, requestId) {
		let resolve;
		const promise = new Promise(settle => { resolve = settle; });
		const entry = { kind, resolve };
		this.entries.set(requestId, entry);
		return { requestId, promise, entry };
	}

	/**
	 * 决议一条请求。
	 *
	 * 种类必须一致：批准不能结算问卷，反之亦然。否则一次误投的决议会把另一种请求
	 * 当成已答复，而真正等待它的界面再也收不到终态。
	 * @param {string} requestId
	 * @param {unknown} value
	 * @param {'approval' | 'question'} [expectedKind]
	 * @returns {true | false | 'kind-mismatch'} 重复/未知返回 false，种类不符返回 'kind-mismatch'
	 */
	settle(requestId, value, expectedKind) {
		const entry = this.entries.get(requestId);
		if (entry === undefined) {
			return false;
		}
		if (expectedKind !== undefined && entry.kind !== expectedKind) {
			return 'kind-mismatch';
		}
		this.entries.delete(requestId);
		entry.resolve(value);
		return true;
	}

	/**
	 * 结算本表全部等待者并清空。
	 *
	 * 为什么必须逐个 resolve：等待中的 `_share` 只有在 Promise 结算后才会返回，
	 * 直接清 Map 会让那条 waterfall 永远挂住，DSH 侧等不到任何答复。
	 * @param {unknown} value 交还给下一个 answerer 的值
	 */
	settleAll(value) {
		const pending = [...this.entries.entries()];
		this.entries.clear();
		for (const [, entry] of pending) {
			entry.resolve(value);
		}
		return pending.length;
	}

	/** 界面未接管：撤销登记，交还给下一个 answerer（DSH 的 next() 语义）。 */
	delegate(requestId, entry) {
		if (this.entries.get(requestId) === entry) {
			this.entries.delete(requestId);
			entry.resolve(undefined);
		}
	}

	size() {
		return this.entries.size;
	}
}

/**
 * Host 侧桥接。`transport` 为 P5 的传输端口；未注入时所有出站动作都是 no-op，
 * 因此本桥接可以独立单测，也不会在未接线时伪造数据。
 */
export class DshIdeHostBridge {
	constructor(ctx, options = {}) {
		this.ctx = ctx;
		this.transport = options.transport;
		this.pending = new PendingRequests();
		/** 视图绑定的会话 id；undefined 表示由 DSH 决定。 */
		this.sessionId = undefined;
		this.channelId = undefined;
		this.disposers = [];
		this.seq = 0;
		this.methods = createMethodHandlers(this);
		/** 模型目录短缓存（见 cachedModelCatalog）；桥销毁时随实例一起丢弃。 */
		this._modelCatalogCache = undefined;
		this._sessionReads = new Set();
		/** @type {Map<string, { abort: AbortController, listeners: Set<(frame: unknown) => void>, ref: number }>} */
		this._follows = new Map();
		/** 没有绑定会话的窗口也要收到状态变化，不能只塞进某一次 follow。 */
		this._statusListeners = new Set();
		/** 同一会话的收藏/置顶切换必须串行，否则两次读取会看到同一状态。 */
		this._toggles = new Map();
		/** 最近一次采纳的绑定代次；只允许前进。 */
		this._generation = 0;
		/** 每个视图各自已采纳的最大代次：代次只允许在该视图内前进。 */
		this._views = new Map();
		this._armWaterfalls();
		this._armSessionStatus();
	}

	/**
	 * 把同一把钥匙上的切换排成队。前一次失败也放行下一次，避免队列卡死。
	 * @param {string} key
	 * @param {() => Promise<unknown>} task
	 */
	enqueueToggle(key, task) {
		const previous = this._toggles.get(key) ?? Promise.resolve();
		const run = previous.then(task, task);
		this._toggles.set(key, run);
		void run.then(() => {
			if (this._toggles.get(key) === run) {
				this._toggles.delete(key);
			}
		}, () => {
			if (this._toggles.get(key) === run) {
				this._toggles.delete(key);
			}
		});
		return run;
	}

	open(spec) {
		if (this.channelId !== undefined) {
			return { channelId: this.channelId, sessionId: this.sessionId };
		}
		const params = (spec && spec.params) || {};
		if (typeof params.sessionId === 'string' && params.sessionId !== '') {
			this.sessionId = params.sessionId;
		}
		this.channelId = `dsh-ide:${randomUUID()}`;
		return { channelId: this.channelId, sessionId: this.sessionId };
	}

	/** 本桥当前的绑定形状：视图 id 即通道 id，代次由 IDE 主进程推进后随调用上行。 */
	bindingOf(generation) {
		return { viewId: this.channelId, generation, sessionId: this.sessionId ?? null };
	}

	/**
	 * 按调用方声明的绑定推进本桥的绑定。
	 *
	 * 为什么以调用方为准：同一 Host 服务多个窗口，每个窗口各自持有自己的视图与代次。
	 * 绑定是「这次调用代表哪个视图的哪一代」的事实，必须随调用上行，不能由 Host 猜。
	 * 代次只允许前进：迟到或重放的旧代调用不得把绑定退回去。
	 * @param {{ viewId: string, generation: number, sessionId: string | null }} binding
	 */
	adoptBinding(binding) {
		// 一个 Host 桥服务多个窗口：每个视图各自持有自己的代次与会话。
		// 不能把桥钉在第一个窗口的视图上——那会让第二个窗口的所有调用都被拒绝。
		const known = this._views.get(binding.viewId);
		if (known !== undefined && binding.generation < known) {
			throw coded(SESSION_SWITCHED, `DSH-IDE view ${binding.viewId} generation ${binding.generation} is older than ${known}`);
		}
		this._views.set(binding.viewId, binding.generation);
		// 本次调用代表哪个视图、哪条会话：处理器读的就是这份当次状态。
		this.channelId = binding.viewId;
		this._generation = binding.generation;
		this.sessionId = binding.sessionId === null ? undefined : binding.sessionId;
		return binding;
	}

	/**
	 * 跟随一个会话。同一个会话只调用一次 `sessionController.follow`，
	 * 多个视图收同一份帧。没有会话地址时不听。
	 */
	follow(binding, onEvent) {
		if (binding !== undefined && typeof binding === 'object') {
			this.adoptBinding(validateDshIdeViewBinding(binding));
		} else if (typeof binding === 'string' || binding === undefined) {
			// 兼容进程内直调：第一参是会话 id 时按当前视图绑定处理。
			if (typeof binding === 'string' && binding !== '') {
				this.sessionId = binding;
			}
			return this._followBound(onEvent);
		}
		const sessionId = this.sessionId;
		if (typeof sessionId !== 'string' || sessionId === '') {
			this._statusListeners.add(onEvent);
			return { dispose: () => { this._statusListeners.delete(onEvent); } };
		}
		return this._attachFollow(sessionId, onEvent);
	}

	/**
	 * 已确定会话 id 时挂上共享跟随。
	 *
	 * 同一会话仍只开一条官方流，但每位订阅者都必须拿到**一致的首帧**：
	 * 后来者若只收到之后的增量，它就没有基线，画面会缺掉开头那段。
	 * 因此先重放已记录的 opening 帧，再加入实时分发。
	 * @param {string} sessionId
	 * @param {(frame: unknown) => void} onEvent
	 */
	_attachFollow(sessionId, onEvent) {
		const shared = this._ensureFollow(sessionId);
		shared.listeners.add(onEvent);
		shared.ref += 1;
		// 基线重放：只给新订阅者，不影响已经收到过它的老订阅者。
		for (const frame of shared.opening) {
			try {
				onEvent(frame);
			} catch {
				// 单个订阅者抛错不影响其它订阅者。
			}
		}
		return {
			dispose: () => {
				if (!shared.listeners.delete(onEvent)) {
					return;
				}
				shared.ref -= 1;
				if (shared.ref > 0) {
					return;
				}
				// 最后一个订阅者释放：结束共享流。
				// 只删「自己这一份」——期间若已换成新的一条，不能把新的删掉。
				shared.abort.abort();
				if (this._follows.get(sessionId) === shared) {
					this._follows.delete(sessionId);
				}
			},
		};
	}

	/** 给官方流式 remote 用：帧原样送出，不改写成行。 */
	/** 进程内直调：没有远程绑定形状时按当前会话跟随。 */
	_followBound(onEvent) {
		const sessionId = this.sessionId;
		if (typeof sessionId !== 'string' || sessionId === '') {
			this._statusListeners.add(onEvent);
			return { dispose: () => { this._statusListeners.delete(onEvent); } };
		}
		return this._attachFollow(sessionId, onEvent);
	}

	async *followSession(binding, signal) {
		const adopted = validateDshIdeViewBinding(binding);
		const queue = [];
		let wake = () => undefined;
		let closed = false;
		let ended = false;
		const handle = this.follow(adopted, frame => {
			// 慢消费者不得无界增长：超过上限时丢掉最旧的增量帧，并明确告知
			// 「你落后了、需要重读基线」，而不是静默截断成一条错误的会话。
			if (queue.length >= DSH_IDE_FOLLOW_BUFFER_LIMIT) {
				queue.length = 0;
				queue.push({ type: 'follow-overflow' });
			}
			queue.push(frame);
			if (frame !== null && typeof frame === 'object' && frame.type === 'follow-ended') {
				ended = true;
			}
			const notify = wake;
			wake = () => undefined;
			notify();
		});
		const stop = () => {
			closed = true;
			handle.dispose();
			// 唤醒正在等待的循环：否则 abort 后循环永远停在 await 上。
			const notify = wake;
			wake = () => undefined;
			notify();
		};
		// 身份先于内容：先确认这次流属于哪个视图的哪一代，再送会话帧。
		// 顺序反过来的话，窗口会把「还没确认归属」的帧当成自己的内容。
		yield { type: DSH_IDE_VIEW_BOUND_FRAME, binding: adopted };
		if (signal && typeof signal.addEventListener === 'function') {
			if (signal.aborted) {
				stop();
				return;
			}
			signal.addEventListener('abort', stop, { once: true });
		}
		try {
			while (!closed && (signal === undefined || signal.aborted !== true)) {
				if (queue.length === 0) {
					if (ended) {
						// 源已经结束且没有待送帧：正常收尾，不再等待。
						return;
					}
					await new Promise(resolve => { wake = resolve; });
					continue;
				}
				while (queue.length > 0) {
					yield queue.shift();
				}
			}
		} finally {
			stop();
		}
	}

	/**
	 * 通知这条共享流的订阅者：源已结束。
	 *
	 * 用一条显式的控制帧而不是静默删表：删表只影响「下一次订阅」，
	 * 已经在等的订阅者收不到任何信号，表现为聊天永久停在最后一帧。
	 * @param {{ listeners: Set<(frame: unknown) => void> }} shared
	 */
	_notifyFollowEnded(shared) {
		const frame = { type: 'follow-ended' };
		for (const listener of [...shared.listeners]) {
			try {
				listener(frame);
			} catch {
				// 单个订阅者抛错不影响其它订阅者。
			}
		}
	}

	_ensureFollow(sessionId) {
		const existing = this._follows.get(sessionId);
		if (existing !== undefined) {
			return existing;
		}
		const abort = new AbortController();
		// `opening` 记下第一条 snapshot（基线）；`ended` 让后来者知道源已经结束，
		// 而不是无限等待一条永远不会再来的流。
		const shared = { abort, listeners: new Set(), ref: 0, opening: [], ended: false };
		this._follows.set(sessionId, shared);
		const controller = service(this.ctx, 'sessionController');
		const pump = async () => {
			try {
				const frames = controller.follow({
					address: { kind: 'session', sessionId },
					assistantStream: true,
					// 官方历史窗。只给默认的 50 条时，一个全是工具步骤的回合会占满第一屏，
					// 人类提问和更早的回合都进不来。
					maxMessages: DSH_IDE_HISTORY_MAX_MESSAGES,
					turnWindow: DSH_IDE_HISTORY_TURN_WINDOW,
				}, abort.signal);
				for await (const frame of frames) {
					// 基线只记第一条 snapshot：后来订阅者靠它得到一致的首帧。
					if (shared.opening.length === 0 && frame !== null && typeof frame === 'object'
						&& (frame.type === 'snapshot' || frame.type === 'snapshot-required')) {
						shared.opening.push(frame);
					}
					for (const listener of [...shared.listeners]) {
						try {
							listener(frame);
						} catch {
							// 单个视图抛错不影响同一条流上的其它视图。
						}
					}
				}			} catch (error) {
				if (abort.signal.aborted) {
					// 主动释放：这是预期结束，不当作故障上报。
					shared.ended = true;
					this._notifyFollowEnded(shared);
					return;
				}
				const message = safeErrorText(error);
				console.warn(`[dsh-ide] session follow ended: ${message}`);
				// 异常结束同样要通知：订阅者必须知道这条流不会再来了，
				// 不能让它一直停在等待上。
				shared.ended = true;
				this._notifyFollowEnded(shared);
			} finally {
				// 正常结束（生成器自然返回）与异常结束都走这里：先通知订阅者，
				// 再摘掉缓存条目。只通知一次，避免 catch 与 finally 重复广播。
				if (!shared.ended) {
					shared.ended = true;
					this._notifyFollowEnded(shared);
				}
				// 官方流结束后必须摘掉缓存条目：否则后续窗口 `_ensureFollow` 会拿到
				// 这条已经死掉的流，加监听收不到任何帧，表现为「连上了 Host、
				// 会话列表也在，但聊天永远空白且不报错」。
				if (this._follows.get(sessionId) === shared) {
					this._follows.delete(sessionId);
				}
			}
		};
		void pump();
		return shared;
	}

	/** 批准和提问：IDE 与桌面都能答，先到的生效。帧同时送给正在听的视图。 */
	_armWaterfalls() {
		if (typeof this.ctx.on !== 'function') {
			return;
		}
		this.disposers.push(this.ctx.on('approval/request', (request, next) => this._share('approval', request, next)));
		this.disposers.push(this.ctx.on('user-questions/request', (request, next) => this._share('question', request, next)));
	}

	/** 官方 api-session 事件。状态变化只转发 sessionId 和 running，不重拉名单。 */
	_armSessionStatus() {
		if (typeof this.ctx.on !== 'function') {
			return;
		}
		this.disposers.push(this.ctx.on('api-session/status', (sessionId, running) => {
			if (typeof sessionId !== 'string' || sessionId === '') {
				return;
			}
			this._fanout({ type: 'session-status', sessionId, running: running === true });
		}));
		const listChanged = () => this._fanout({ type: 'session-list' });
		this.disposers.push(this.ctx.on('api-session/added', listChanged));
		this.disposers.push(this.ctx.on('api-session/removed', listChanged));
	}

	/**
	 * 交互式 answerer：登记请求、广播给所有视图、把决定交回官方。
	 *
	 * 界面未接管时 `next()` 委托给下一个 answerer，因此不会与 DSH 自己的 answerer 争抢，
	 * 也不会出现第二套答案形态。`approval/request` 与 `user-questions/request`
	 * 两个事件都接到这里（见构造函数里的 `ctx.on`）。
	 */
	async _share(kind, request, next) {
		const requestId = request && request.requestId;
		if (typeof requestId !== 'string' || requestId === '') {
			return typeof next === 'function' ? next() : undefined;
		}
		const handle = this.pending.register(kind, requestId);
		const described = describeRequest(kind, request);
		this.emitToUi({ type: 'request', kind, requestId, request: described });
		this._fanout({
			type: 'waterfall',
			kind: 'request',
			eventId: requestId,
			event: kind === 'approval' ? 'approval/request' : 'user-questions/request',
			agentId: typeof request.agentId === 'string' ? request.agentId : requestId,
			request: described,
		});
		let ideSettled = false;
		const ide = handle.promise.then(value => {
			if (value !== undefined) {
				ideSettled = true;
			}
			return value;
		});
		const desktop = Promise.resolve().then(() => typeof next === 'function' ? next() : undefined);
		const first = await Promise.race([
			ide.then(value => ({ source: 'ide', value })),
			desktop.then(value => ({ source: 'desktop', value })),
		]);
		// 不论哪一侧先答，都要把终态广播给其余视图：否则别处的卡片会一直停在「待批准」。
		if (first.source === 'desktop') {
			if (first.value !== undefined && !ideSettled) {
				this.pending.entries.delete(requestId);
				this._fanout({ type: 'waterfall', kind: 'cancel', eventId: requestId });
				return first.value;
			}
			return ide;
		}
		if (first.value === undefined) {
			return desktop;
		}
		// IDE 先答：本表登记已在 settle 时移除，其余视图仍需收到同一条终态。
		this._fanout({ type: 'waterfall', kind: 'cancel', eventId: requestId });
		return first.value;
	}

	_fanout(frame) {
		const listeners = [...this._statusListeners];
		for (const shared of this._follows.values()) {
			listeners.push(...shared.listeners);
		}
		for (const listener of listeners) {
			try {
				listener(frame);
			} catch {
				// 同 _ensureFollow：一个视图失败不打断其它视图。
			}
		}
	}

	emitToUi(message) {
		if (this.transport !== undefined && typeof this.transport.post === 'function') {
			this.transport.post(message);
		}
	}

	/**
	 * 执行一次 DTO method。
	 *
	 * `binding` 是这次调用的发起视图与代次：采纳它之后，本桥的会话归属校验才有确定目标。
	 * 入参已由共享校验器核对过字段白名单。
	 * @param {string} method
	 * @param {unknown} args
	 * @param {{ viewId: string, generation: number, sessionId: string | null }} binding
	 */
	async invoke(method, args, binding) {
		const handler = this.methods[method];
		if (handler === undefined) {
			throw coded(FEATURE_UNAVAILABLE, `DshIdeHostBridge: method ${JSON.stringify(method)} is not defined`);
		}
		// 进程内本地调用（Host 单测、插件内部直调）没有远程视图身份，沿用本桥当前绑定；
		// 远程入口 `ide/dispatch` 总是带上已校验的绑定，因此远程路径不存在「省略身份」的形态。
		if (binding !== undefined) {
			this.adoptBinding(validateDshIdeViewBinding(binding));
		}
		return handler(args || {});
	}

	/**
	 * 会话归属校验。
	 *
	 * 缺 `sessionId` 一律拒绝：没有「默认当前会话」的回退，否则换绑之后到达的旧调用会写进
	 * 新会话。显式行操作不经过这里，改由 `assertVisibleRow` 按可见对象校验。
	 * @param {unknown} requested
	 */
	assertOwnership(requested) {
		if (typeof requested !== 'string' || requested === '') {
			throw coded(INVALID_ARGUMENT, 'sessionId must be a non-empty string');
		}
		if (this.sessionId === undefined) {
			throw coded(INVALID_ARGUMENT, 'DSH-IDE view has no bound session');
		}
		if (requested !== this.sessionId) {
			throw coded(SESSION_SWITCHED, `DSH-IDE session switched: bound ${this.sessionId}, requested ${requested}`);
		}
	}

	/**
	 * 显式可见行校验：用户点了某一行的菜单，就不要求那一行是当前绑定的会话。
	 *
	 * 仍必须确认这一行对该主体可见——不能凭一个任意 id 直接操作存储。
	 * @param {unknown} sessionId
	 * @param {readonly { sessionId?: unknown }[]} visibleRows
	 */
	assertVisibleRow(sessionId, visibleRows) {
		if (typeof sessionId !== 'string' || sessionId === '') {
			throw coded(INVALID_ARGUMENT, 'sessionId must be a non-empty string');
		}
		if (!Array.isArray(visibleRows) || !visibleRows.some(row => row !== null && typeof row === 'object' && row.sessionId === sessionId)) {
			throw coded(SESSION_SWITCHED, `DSH-IDE row ${sessionId} is not visible to this view`);
		}
		return sessionId;
	}

	close() {
		for (const cancel of this._sessionReads) {
			cancel();
		}
		this._sessionReads.clear();
		// 换绑/重建时模型目录可能已变：不能让下一个会话读到上一轮的缓存。
		this._modelCatalogCache = undefined;
		for (const shared of this._follows.values()) {
			shared.abort.abort();
		}
		this._follows.clear();
		this.disposeSubscriptions();
		// 视图代次表也要清：桥重启后旧窗口的代次不再有意义，
		// 留着只会在内存里攒下历史上出现过的每个 viewId。
		this._views.clear();
		// 关闭的窗口不再需要广播：留着的话，后续每次 `_fanout` 都会调到
		// 已经关掉的窗口回调，白做一轮遍历还可能往死掉的 transport 写帧。
		this._statusListeners.clear();
		// 串行化队列也要清：未完成的任务随桥一起作废，条目不该留到下一轮。
		this._toggles.clear();
		// 桥要消失了：本桥等待中的决议全部交还给下一个 answerer，不留悬空 Promise。
		this.pending.settleAll(undefined);
		this.channelId = undefined;
		this.sessionId = undefined;
		this._generation = 0;
	}

	disposeSubscriptions() {
		for (const dispose of this.disposers.splice(0)) {
			try {
				if (typeof dispose === 'function') {
					dispose();
				} else if (dispose && typeof dispose.dispose === 'function') {
					dispose.dispose();
				}
			} catch {
				// 解绑失败不影响其它订阅，也不会取消 DSH 会话。
			}
		}
	}
}

/**
 * 显式行操作的前置：该行必须出现在当前主体可见的官方名单里。
 *
 * 为什么不要求它就是当前绑定会话：用户点了另一行的菜单，那一行不是「当前会话」，
 * 但仍是用户可见的对象。也不能只凭一个 id 直接操作存储——所以先按官方名单核对可见性。
 * @param {DshIdeHostBridge} bridge
 * @param {unknown} sessionId
 */
async function assertVisibleRowForBridge(bridge, sessionId) {
	const controller = service(bridge.ctx, 'sessionController');
	const listed = await controller.list({}, callerSignal());
	const items = listed && Array.isArray(listed.items) ? listed.items : [];
	bridge.assertVisibleRow(sessionId, items);
}

/** 只把界面需要的字段送出去。agent 对象与 AbortSignal 不进线协议。 */
function describeRequest(kind, request) {
	if (kind === 'approval') {
		return projectApprovalRequest(request) ?? {
			toolName: typeof request?.toolName === 'string' ? request.toolName : '',
		};
	}
	return projectQuestionRequest(request) ?? { questions: [] };
}

/**
 * 22 个 DTO method → 官方服务调用（唯一分发点，入参已过 validateDshIdeInput）。
 *
 * 结果语义（第 2 章 §4）：动作类 `{ accepted: true }`；列表类数组；详情类 `string | null`。
 * 尚未核对到官方公开接口的能力以 feature-unavailable 明确拒绝并写明缺口，不猜方法名。
 */
function createMethodHandlers(bridge) {
	const controller = () => service(bridge.ctx, 'sessionController');
	// 重命名、移动、新建、收藏、置顶不一定发出 api-session/added|removed。
	// 不发这帧的话，面板要等到下次连接或工作区变化才看得到结果。
	// 删除不发：名单是最终一致的，刚删完就刷新会把还在名单里的旧行又画出来。
	const notifySessionList = () => bridge._fanout({ type: 'session-list' });

	/**
	 * 模型目录的短 TTL 缓存。
	 *
	 * `composerState` 与 `listModels` 要的是同一份目录，而它在一次输入框刷新里会被
	 * 连着问好几次（模型表 + 当前选择）。目录由内核按配置生成，几秒内不会变；
	 * 缓存 2 秒能把一轮刷新的多次内核查询压成一次。失败不缓存，下次重试。
	 */
	const cachedModelCatalog = async () => {
		const now = Date.now();
		if (bridge._modelCatalogCache !== undefined && now - bridge._modelCatalogCache.at < 2000) {
			return bridge._modelCatalogCache.value;
		}
		const value = await controller().modelCatalog();
		bridge._modelCatalogCache = { at: Date.now(), value };
		return value;
	};
	// 账号域是独立服务：官方服务名是 `deepseekAccount`（`accountController` 只是 Remote 包装类，
	// 不是注册进 ctx 的服务名；用错会把调用打到一个不存在的服务上）。
	const account = () => service(bridge.ctx, 'deepseekAccount');
	/**
	 * 会话范围内的调用必须自带发起时的会话 id，并仍匹配本视图的绑定。
	 *
	 * 为什么不再回退到「当前绑定」：换绑之后到达的旧调用会写进新会话。身份由发起方固定，
	 * Host 只做核对，不改写目标。
	 * @param {object} args
	 */
	const sessionIdOf = args => {
		const requested = args && args.sessionId;
		bridge.assertOwnership(requested);
		return requested;
	};
	const missing = capability => () => {
		throw coded(FEATURE_UNAVAILABLE, `DSH-IDE capability "${capability}" has no verified DSH method yet`, { capability });
	};
	/**
	 * D13（第 34 轮）：`runCommand` / `setPermissionPreset` 共用的官方命令执行。
	 * Host 半身进程内直调 `commands.execute(agent, line, attachments, signal)`：
	 * `agent` 经 `agents.get(sessionId)` 解析，`signal` 自给（Gateway 路径由框架注入，
	 * 进程内直调无框架信号）。
	 * 附件按官方 `CommandSubmitAttachment` 的形状传：线上给的是 `ImageAttachmentRef`，
	 * 这里经 `attachments.readImage()` 取出字节转成 `{ type:'image', mediaType, data }`
	 * （官方 `EncodedImageAttachment`，`attachment/src/types.ts:85-92`）。
	 * 结果经共享 `mapDshIdeCommandExecution` 收敛为动作类语义，不静默 accepted。
	 */
	const executeCommandLine = async (sessionId, line, attachments = []) => {
		const agents = service(bridge.ctx, 'agents');
		const agent = typeof agents.get === 'function' ? agents.get(sessionId) : undefined;
		if (agent === undefined || agent === null) {
			throw coded(FEATURE_UNAVAILABLE, `no live agent for bound session ${sessionId}`, { capability: 'runCommand' });
		}
		const commands = service(bridge.ctx, 'commands');
		if (typeof commands.execute !== 'function') {
			throw coded(FEATURE_UNAVAILABLE, 'DSH commands service has no execute()', { capability: 'runCommand' });
		}
	const submitted = attachments.length === 0 ? [] : await Promise.all(attachments.map(attachment => toCommandSubmitAttachment(bridge.ctx, attachment)));
		const signal = new AbortController().signal;
		const execution = await commands.execute(agent, line, submitted, signal);
		const outcome = mapDshIdeCommandExecution(execution);
		if ('error' in outcome) {
			throw coded(outcome.error === 'invalid-argument' ? INVALID_ARGUMENT : FEATURE_UNAVAILABLE, outcome.message, { capability: 'runCommand' });
		}
		return { accepted: true };
	};

	return {
		async submit(args) {
			// 视图已经换到别的会话时，不能把这句话写进新会话。
			const sessionId = sessionIdOf(args);
			const attachments = Array.isArray(args.attachments) ? args.attachments : [];
			// IDE 生成的 requestId 在重试/核对时保持不变：同一个 id 再提交一次，内核按同一个请求结算。
			// 没带时沿用随机 id（旧窗口兼容），不伪造「已去重」。
			const requestId = typeof args.requestId === 'string' && args.requestId !== '' ? args.requestId : randomUUID();
			await controller().prompt({
				requestId,
				sessionId,
				mode: 'queue',
				content: [
					{ type: 'text', text: args.text },
					// 进程内 admit 认的是已入库图片：`{ type:'image', attachment, encodedBytes }`。
					// 缺 encodedBytes 时官方限额把字节数加成 NaN，限额检查会失效。
					...attachments.map(attachment => ({
						type: 'image',
						attachment: imagePromptRef(attachment),
						encodedBytes: attachment.bytes,
					})),
				],
			}, callerSignal());
			return { accepted: true };
		},
		async interrupt(args) {
			// 视图已经换到别的会话时，不能停掉新会话。
			const sessionId = sessionIdOf(args);
			await controller().cancel({ sessionId });
			return { accepted: true };
		},
		async resume(args) {
			// 只读确认该会话仍可解析。绑定由 IDE 主进程推进后随下一次调用上行，
			// 这里不改本桥的绑定：迟到或并发的旧调用不得把绑定改回去。
			const sessionId = sessionIdOf(args);
			await controller().state({ sessionId }, callerSignal());
			return { accepted: true };
		},
		async newSession(args) {
			const created = await controller().create({
				...(args.workspace === undefined ? {} : { cwd: args.workspace }),
			});
			const sessionId = created && created.sessionId;
			// 不在这里改绑定：IDE 主进程收到回包后自行换绑，下一次调用再带上新绑定。
			notifySessionList();
			return { accepted: true, ...(typeof sessionId === 'string' ? { sessionId } : {}) };
		},
		async fork(args) {
			const requested = sessionIdOf(args);
			const created = await controller().fork({
				sessionId: requested,
				...(args.point === undefined || args.point === '' ? {} : { atSeq: forkSeq(args.point) }),
			});
			const sessionId = created && (created.sessionId || created.childSessionId);
			notifySessionList();
			return { accepted: true, ...(typeof sessionId === 'string' ? { sessionId } : {}) };
		},
		async rewind(args) {
			// core 没有 rewind remote。装上 dsh-rewind-plugin 后，Host 上的命令名是
			// `rewind-plugin`（插件自己的 ENGINE_COMMAND）。入参是 `@<seq> chat|both`；
			// 契约只有消息切点，没有文件恢复，所以模式固定为 chat。
			const point = rewindPoint(args.to);
			const sessionId = sessionIdOf(args);
			const agents = service(bridge.ctx, 'agents');
			const agent = typeof agents.get === 'function' ? agents.get(sessionId) : undefined;
			if (agent === undefined || agent === null) {
				throw coded(FEATURE_UNAVAILABLE, `no live agent for bound session ${sessionId}`, { capability: 'rewind' });
			}
			const commands = service(bridge.ctx, 'commands');
			const listed = typeof commands.list === 'function' ? commands.list(agent) : undefined;
			const installed = Array.isArray(listed) && listed.some(item => item !== null && typeof item === 'object' && item.name === 'rewind-plugin');
			if (!installed) {
				throw coded(FEATURE_UNAVAILABLE, 'message rewind is unavailable: install and enable dsh-rewind-plugin', { capability: 'rewind' });
			}
			return executeCommandLine(sessionId, buildDshIdeCommandLine('rewind-plugin', [point, 'chat']));
		},
		async loadOlder(args) {
			// 官方 `session/page` 是独立只读端点，返回值就是这一页；
			// follow 只在开头推一次 snapshot，page() 不会重推，所以必须把页带回去。
			// 只投影 records + hasMore，丢掉官方 cursor（下一页用最小 seq 当 beforeSeq）。
			const sessionId = sessionIdOf(args);
			const page = await controller().page({
				address: { kind: 'session', sessionId },
				...(args.throughSeq === undefined ? {} : { throughSeq: args.throughSeq }),
				...(args.beforeSeq === undefined ? {} : { beforeSeq: args.beforeSeq }),
				...(args.maxMessages === undefined ? {} : { maxMessages: args.maxMessages }),
				...(args.turnWindow === undefined ? {} : { turnWindow: args.turnWindow }),
			}, callerSignal());
			if (!page || !Array.isArray(page.records) || typeof page.hasMore !== 'boolean') {
				throw coded(FEATURE_UNAVAILABLE, 'sessionController.page returned a page without records and hasMore', { capability: 'loadOlder' });
			}
			return { accepted: true, page: { records: page.records, hasMore: page.hasMore } };
		},
		async answerApproval(args) {
			const outcome = approvalOutcome(args.decision);
			const settled = bridge.pending.settle(args.requestId, outcome, 'approval');
			if (settled === 'kind-mismatch') {
				throw coded(INVALID_ARGUMENT, `request ${args.requestId} is not an approval request`);
			}
			if (settled !== true) {
				throw coded(ALREADY_RESOLVED, `approval request ${args.requestId} is already resolved or unknown`);
			}
			// 与 `cancelRequest` 同一口径：答复也是终态，其余视图必须一起收卡，
			// 否则别的窗口会一直显示一张已经答过的卡片。
			bridge._fanout({ type: 'waterfall', kind: 'cancel', eventId: args.requestId });
			return { accepted: true };
		},
		async answerQuestion(args) {
			const settled = bridge.pending.settle(args.requestId, args.answer, 'question');
			if (settled === 'kind-mismatch') {
				throw coded(INVALID_ARGUMENT, `request ${args.requestId} is not a question request`);
			}
			if (settled !== true) {
				throw coded(ALREADY_RESOLVED, `question request ${args.requestId} is already resolved or unknown`);
			}
			// 问卷答案同样是终态，其余视图要一起收卡。
			bridge._fanout({ type: 'waterfall', kind: 'cancel', eventId: args.requestId });
			return { accepted: true };
		},
		async cancelRequest(args) {
			if (bridge.pending.settle(args.requestId, 'cancelled') !== true) {
				throw coded(ALREADY_RESOLVED, `request ${args.requestId} is already resolved or unknown`);
			}
			// 取消也是终态：其余视图必须一起收卡，否则旧窗会一直显示一条已经结束的请求。
			bridge._fanout({ type: 'waterfall', kind: 'cancel', eventId: args.requestId });
			return { accepted: true };
		},
		async setModel(args) {
			const sessionId = sessionIdOf(args);
			const [provider, model] = splitModel(args.model);
			await controller().selectModel({ sessionId, provider, model });
			return { accepted: true };
		},
		async setEffort(args) {
			// D13/D16：官方无独立 setEffort remote；effort 是 session/selectModel 的
			// reasoningEffort 字段（§8.10.9）。当前 provider/model 从 session/projections
			// 的 modelSelection.next wire view 读取，避免凭记忆猜路由。
			const sessionId = sessionIdOf(args);
			if (typeof args.effort !== 'string' || args.effort === '') {
				throw coded(INVALID_ARGUMENT, 'setEffort.effort must be a non-empty string');
			}
			const value = await controller().projections({ sessionId }, callerSignal());
			const selection = value && value.values && value.values.modelSelection
				? value.values.modelSelection.next
				: undefined;
			if (!selection || typeof selection.provider !== 'string' || typeof selection.model !== 'string') {
				// 无当前模型则无法只改 effort：明确拒绝，不伪造默认路由，不悄悄降级成 setModel。
				throw coded(FEATURE_UNAVAILABLE, 'setEffort requires a current model selection');
			}
			await controller().selectModel({
				sessionId,
				provider: selection.provider,
				model: selection.model,
				reasoningEffort: args.effort,
			});
			return { accepted: true };
		},
		async setPermissionPreset(args) {
			// §8.10.9：官方无独立 setter，`/permission <preset>` 是注册的斜杠命令。
			return executeCommandLine(sessionIdOf(args), buildDshIdeCommandLine('permission', [args.preset]));
		},
		async runCommand(args) {
			// 契约 `command` 为不带前导斜杠的命令名，`args` 单空格拼入 rawInput；
			// 附件按官方 `CommandSubmitAttachment` 传给命令执行器。
			return executeCommandLine(sessionIdOf(args), buildDshIdeCommandLine(args.command, args.args), Array.isArray(args.attachments) ? args.attachments : []);
		},
		async searchSessions(args) {
			// D59 分批检索：官方 `session/search`，只读。依赖宿主挂载
			// `@deepseek-ai/dsh-session-query`；未挂载时官方抛 gateway/internal，原样透传。
			return projectDshIdeSessionSearch(await controller().search({ query: args.query }, callerSignal()));
		},
		async presentationSettings() {
			const settings = optionalService(bridge.ctx, 'settings');
			const rows = settings !== undefined && typeof settings.describe === 'function'
				? settings.describe({ redactSecrets: true })
				: [];
			const chat = sectionValue(rows, 'ui-chat');
			const tools = sectionValue(rows, 'ui-settings');
			return {
				transcriptView: transcriptViewOf(chat.transcriptView),
				collapseTiming: chat.collapseTiming === 'next-input' ? 'next-input' : 'completion',
				foldedReplies: chat.foldedReplies === 'final' ? 'final' : 'all',
				developerTools: tools.enabled !== false,
			};
		},
		async capabilities() {
			// 依赖插件能力：UI 拿它决定收藏/移动/删除/回退入口是否出现。
			// 缺插件只返回 false，不抛错——这是能力探测，不是一次业务调用。
			return probeDshIdeCapabilities(bridge.ctx, bridge.sessionId);
		},
		async listSessions(args) {
			const sessionId = bridge.sessionId;
			const channelId = bridge.channelId;
			const workspacePath = args && typeof args.workspace === 'string' && args.workspace !== '' ? args.workspace : undefined;
			if ((sessionId === undefined || sessionId === '') && workspacePath === undefined) {
				return [];
			}
			const abort = new AbortController();
			let cancel;
			const cancelled = new Promise((_, reject) => {
				cancel = () => {
					const error = coded(SESSION_SWITCHED, 'DSH-IDE view closed while listing sessions');
					abort.abort(error);
					reject(error);
				};
			});
			bridge._sessionReads.add(cancel);
			try {
				// 复用官方可见名单，不绕过 controller 直读持久层；Host 本机调用沿用官方 owner 语义。
				// 同时结算取消 Promise，即使上游未及时响应 signal，关闭视图也不会留下待定调用。
				const value = await Promise.race([Promise.resolve().then(() => {
					abort.signal.throwIfAborted();
					return controller().list({}, abort.signal);
				}), cancelled]);
				if (bridge.channelId !== channelId || (workspacePath === undefined && bridge.sessionId !== sessionId)) {
					throw coded(SESSION_SWITCHED, 'DSH-IDE session changed while listing sessions');
				}
				// workspaceRegistry 是可选服务：没装时退化为「只按绑定会话投影」。
				// 列表本身来自官方 session/list，没有它也照样能列出来。
				const registry = optionalService(bridge.ctx, 'workspaceRegistry');
				if (registry === undefined) {
					return projectDshIdeSessionList(sessionId, [], value.items);
				}
				if (workspacePath !== undefined && typeof registry.resolveByPath === 'function') {
					const workspace = await registry.resolveByPath(workspacePath);
					return projectDshIdeWorkspaceSessions(workspace, value.items);
				}
				return projectDshIdeSessionList(sessionId, registry.list(), value.items);
			} finally {
				bridge._sessionReads.delete(cancel);
			}
		},
		async composerState(args) {
			// 输入框一次读齐：模型目录、当前选择、权限目录、预设名单。
			// 权限 / 预设服务没挂上时对应控件为 null，不把整条读取打成失败。
			const sessionId = sessionIdOf(args);
			const projected = await controller().projections({ sessionId }, callerSignal());
			const values = projected && typeof projected === 'object' ? projected.values : undefined;
			const catalog = await cachedModelCatalog();
			return projectDshIdeComposer({
				values,
				catalog,
				permission: optionalCall(bridge.ctx, 'permissionPresets', 'catalog'),
				presets: await optionalCallAsync(bridge.ctx, 'agentPresets', 'list'),
			});
		},
		async setTeamEnabled(args) {
			// 官方 agentTeams.setEnabled(agent, enabled, signal)：只改根会话的团队开关。
			const sessionId = sessionIdOf(args);
			if (typeof args.enabled !== 'boolean') {
				throw coded(INVALID_ARGUMENT, 'setTeamEnabled.enabled must be a boolean');
			}
			const agents = service(bridge.ctx, 'agents');
			const agent = typeof agents.get === 'function' ? agents.get(sessionId) : undefined;
			if (agent === undefined || agent === null) {
				throw coded(FEATURE_UNAVAILABLE, `no live agent for bound session ${sessionId}`, { capability: 'setTeamEnabled' });
			}
			const teams = service(bridge.ctx, 'agentTeams');
			if (typeof teams.setEnabled !== 'function') {
				throw coded(FEATURE_UNAVAILABLE, 'DSH agentTeams service has no setEnabled()', { capability: 'setTeamEnabled' });
			}
			const abort = new AbortController();
			await teams.setEnabled(agent, args.enabled, abort.signal);
			return { accepted: true };
		},
		async setAgentPreset(args) {
			// 官方 agentPresets.select(agent, agentPreset)：会话已开聊时由官方拒绝。
			const sessionId = sessionIdOf(args);
			if (typeof args.preset !== 'string' || args.preset === '' || /[\s/]/.test(args.preset)) {
				throw coded(INVALID_ARGUMENT, 'setAgentPreset.preset must be a non-empty id without whitespace or slash');
			}
			const agents = service(bridge.ctx, 'agents');
			const agent = typeof agents.get === 'function' ? agents.get(sessionId) : undefined;
			if (agent === undefined || agent === null) {
				throw coded(FEATURE_UNAVAILABLE, `no live agent for bound session ${sessionId}`, { capability: 'setAgentPreset' });
			}
			const presets = service(bridge.ctx, 'agentPresets');
			if (typeof presets.select !== 'function') {
				throw coded(FEATURE_UNAVAILABLE, 'DSH agentPresets service has no select()', { capability: 'setAgentPreset' });
			}
			await presets.select(agent, args.preset);
			return { accepted: true };
		},
		async listModels() {
			const catalog = await cachedModelCatalog();
			const groups = Array.isArray(catalog && catalog.groups) ? catalog.groups : [];
			const models = [];
			for (const group of groups) {
				const provider = String(group.id ?? '');
				for (const model of (Array.isArray(group.models) ? group.models : [])) {
					models.push({ provider, model: String(model.id ?? ''), ...(typeof model.name === 'string' ? { name: model.name } : {}) });
				}
			}
			return models;
		},
		async listCommands(args) {
			// 官方 `commands.list(agent)` 是 agent-scoped：绑定会话没有 live Agent 时明确拒绝，
			// 不伪造全局命令表。投影只保留中立字段（name / description）。
			const sessionId = sessionIdOf(args);
			const agents = service(bridge.ctx, 'agents');
			const agent = typeof agents.get === 'function' ? agents.get(sessionId) : undefined;
			if (agent === undefined || agent === null) {
				throw coded(FEATURE_UNAVAILABLE, `no live agent for bound session ${sessionId}`, { capability: 'listCommands' });
			}
			const commands = service(bridge.ctx, 'commands');
			if (typeof commands.list !== 'function') {
				throw coded(FEATURE_UNAVAILABLE, 'DSH commands service has no list()', { capability: 'listCommands' });
			}
			return projectDshIdeCommandList(commands.list(agent));
		},
		async fetchRowDetail() {
			// 官方没有对应的只读「行详情」端点：折叠行全文由 IDE 侧投影器缓存
			// （第 2 章 E9）。按手册 §5.3 第 4 条，这里明确拒绝而不是返回 null，
			// 让前端按禁用态处理，不把「没有实现」伪装成「没有内容」。
			throw coded(FEATURE_UNAVAILABLE, 'DSH has no official read-only row-detail endpoint; folded-row text stays in the IDE projection cache', { capability: 'fetchRowDetail' });
		},
		async readAttachment(args) {
			// 官方 `session/attachment` 的进程内等价物：只按 attachmentId 读字节，
			// 不接受路径/URL。依据 packages/api/session-controller/src/commands.ts:427-433。
			// 会话身份先核对：附件必须属于本次发起视图仍在跟的会话，不能只凭 id 直接读存储。
			sessionIdOf(args);
			const attachments = service(bridge.ctx, 'attachments');
			if (typeof attachments.readImage !== 'function') {
				throw coded(FEATURE_UNAVAILABLE, 'DSH attachments service has no readImage()', { capability: 'readAttachment' });
			}
			const stored = await attachments.readImage(args.attachment);
			const bytes = stored && stored.data;
			if (!bytes || typeof bytes.length !== 'number') {
				throw coded(FEATURE_UNAVAILABLE, 'DSH attachments service returned no image bytes', { capability: 'readAttachment' });
			}
			return {
				mediaType: (stored.ref && stored.ref.mediaType) || args.attachment.mediaType,
				data: Buffer.from(bytes).toString('base64'),
			};
		},
		async refreshSnapshot() {
			bridge.emitToUi({ type: 'refresh' });
			return { accepted: true };
		},
		async accountGetState() {
			// 官方 `accountController.getState()`：无参，返回 AccountView（status/links/attempt）。
			return account().getState();
		},
		async accountGetProfile(args) {
			// 官方 `accountController.getProfile(client)`：Host 依据 client 派生 Platform 请求头。
			return account().getProfile(args.client);
		},
		async accountStartSignIn(args) {
			// 官方 `deepseekAccount.startSignIn(client, callbackOrigin, loginSource)`：返回带 authorizeUrl 的视图。
			const service = account();
			if (typeof service.startSignIn !== 'function') {
				throw coded(FEATURE_UNAVAILABLE, 'DSH deepseekAccount has no startSignIn()', { capability: 'accountStartSignIn' });
			}
			return service.startSignIn(args.client, args.callbackOrigin, args.loginSource);
		},
		async accountCancelSignIn(args) {
			const service = account();
			if (typeof service.cancelSignIn !== 'function') {
				throw coded(FEATURE_UNAVAILABLE, 'DSH deepseekAccount has no cancelSignIn()', { capability: 'accountCancelSignIn' });
			}
			return service.cancelSignIn(args.attemptId);
		},
		async archiveSession(args) {
			// 官方 remote 是 `workspaceController.archiveSession({ sessionId })`，返回完整归档集合。
			// `workspaceRegistry.archiveSession` 是另一套签名：第一参是 sessionId 字符串，返回 void。
			// 不传 stopActivity：是否强停运行中的会话由调用方显式决定，缺省保留官方拒绝。
			return changeArchive(bridge, 'archiveSession', args.sessionId);
		},
		async unarchiveSession(args) {
			return changeArchive(bridge, 'unarchiveSession', args.sessionId);
		},
		async saveImageAttachment(args) {
			// 官方 `attachments.saveImages([{ data, mediaType, name? }])`：入库并返回 `ImageAttachmentRef`。
			// 只接受 base64 解码后的真实字节，媒体类型由官方按字节复核。
			const attachments = service(bridge.ctx, 'attachments');
			if (typeof attachments.saveImages !== 'function') {
				throw coded(FEATURE_UNAVAILABLE, 'DSH attachments service has no saveImages()', { capability: 'saveImageAttachment' });
			}
			const bytes = Buffer.from(args.data, 'base64');
			if (bytes.length === 0) {
				throw coded(INVALID_ARGUMENT, 'saveImageAttachment.data decoded to no bytes');
			}
			const refs = await attachments.saveImages([{ data: bytes, mediaType: args.mediaType, ...(args.name === undefined ? {} : { name: args.name }) }]);
			const ref = Array.isArray(refs) ? refs[0] : undefined;
			if (ref === undefined) {
				throw coded(FEATURE_UNAVAILABLE, 'DSH attachments service returned no image reference', { capability: 'saveImageAttachment' });
			}
			return ref;
		},
		async renameSession(args) {
			await assertVisibleRowForBridge(bridge, args.sessionId);
			await controller().rename({ sessionId: args.sessionId, title: args.title });
			notifySessionList();
			return { accepted: true };
		},
		async setSessionFavorite(args) {
			await assertVisibleRowForBridge(bridge, args.sessionId);
			const registry = service(bridge.ctx, 'workspaceRegistry');
			if (typeof registry.setSessionFavorite !== 'function' || typeof registry.favoriteSessions !== 'function') {
				throw coded(FEATURE_UNAVAILABLE, 'session favorite is unavailable: install and enable @michengai/dsh-archive-manager', { capability: 'setSessionFavorite' });
			}
			return bridge.enqueueToggle(`favorite:${args.sessionId}`, async () => {
				// 排队期间视图可能已经换绑：执行前必须重新核对这一行仍然可见，
				// 否则会把一次旧窗口的意图作用到别处。
				await assertVisibleRowForBridge(bridge, args.sessionId);
				const current = await registry.favoriteSessions();
				const ids = current && Array.isArray(current.favoriteSessionIds) ? current.favoriteSessionIds : [];
				const favorite = !ids.includes(args.sessionId);
				await registry.setSessionFavorite({ sessionId: args.sessionId, favorite });
				notifySessionList();
				return { accepted: true, favorite };
			});
		},
		async setSessionPinned(args) {
			await assertVisibleRowForBridge(bridge, args.sessionId);
			const workspaces = service(bridge.ctx, 'workspaceController');
			return bridge.enqueueToggle(`pin:${args.sessionId}`, async () => {
				// 同 setSessionFavorite：排队期间换绑后不能再按旧意图执行。
				await assertVisibleRowForBridge(bridge, args.sessionId);
				const registry = optionalService(bridge.ctx, 'workspaceRegistry');
				const currently = registry && Array.isArray(registry.pinnedSessionIds) ? registry.pinnedSessionIds.includes(args.sessionId) : false;
				const pinned = resolveDshSessionPin(currently, args.pinned);
				if (pinned !== currently) {
					const method = pinned ? 'pinSession' : 'unpinSession';
					if (typeof workspaces[method] !== 'function') {
						throw coded(FEATURE_UNAVAILABLE, `DSH workspaceController has no ${method}()`, { capability: 'setSessionPinned' });
					}
					await workspaces[method]({ sessionId: args.sessionId });
					notifySessionList();
				}
				return { accepted: true, pinned };
			});
		},
		async listWorkspaces() {
			const registry = optionalService(bridge.ctx, 'workspaceRegistry');
			const items = registry && typeof registry.list === 'function' ? registry.list() : [];
			return (Array.isArray(items) ? items : []).flatMap(workspace => {
				if (workspace === null || typeof workspace !== 'object') {
					return [];
				}
				const id = typeof workspace.id === 'string' ? workspace.id : typeof workspace.workspaceId === 'string' ? workspace.workspaceId : '';
				if (id === '') {
					return [];
				}
				const path = typeof workspace.path === 'string' ? workspace.path : '';
				const title = typeof workspace.title === 'string' && workspace.title !== '' ? workspace.title : (path || id);
				return [{ id, title, ...(path === '' ? {} : { path }) }];
			});
		},
		async moveSession(args) {
			await assertVisibleRowForBridge(bridge, args.sessionId);
			const registry = service(bridge.ctx, 'workspaceRegistry');
			if (typeof registry.moveSessionToWorkspace !== 'function') {
				throw coded(FEATURE_UNAVAILABLE, 'moving a session is unavailable: install and enable @michengai/dsh-archive-manager', { capability: 'moveSession' });
			}
			await registry.moveSessionToWorkspace({ sessionId: args.sessionId, targetWorkspaceId: args.workspaceId });
			notifySessionList();
			return { accepted: true };
		},
		async openSessionPath(args) {
			await assertVisibleRowForBridge(bridge, args.sessionId);
			const listed = await controller().list({}, callerSignal());
			const items = listed && Array.isArray(listed.items) ? listed.items : [];
			const item = items.find(entry => entry && entry.sessionId === args.sessionId);
			const cwd = item && (typeof item.cwd === 'string' ? item.cwd : undefined);
			if (cwd === undefined || cwd === '') {
				throw coded(FEATURE_UNAVAILABLE, 'session has no workspace path to open', { capability: 'openSessionPath' });
			}
			if (typeof controller().openWorkspacePath !== 'function') {
				throw coded(FEATURE_UNAVAILABLE, 'DSH sessionController has no openWorkspacePath()', { capability: 'openSessionPath' });
			}
			await controller().openWorkspacePath({ path: cwd }, callerSignal());
			return { accepted: true };
		},
		async speechCatalog() {
			const speech = service(bridge.ctx, 'speechController');
			if (typeof speech.catalog !== 'function') {
				throw coded(FEATURE_UNAVAILABLE, 'DSH speechController has no catalog()', { capability: 'speechCatalog' });
			}
			return speech.catalog();
		},
		async speechTranscribe(args) {
			const speech = service(bridge.ctx, 'speechController');
			if (typeof speech.transcribe !== 'function') {
				throw coded(FEATURE_UNAVAILABLE, 'DSH speechController has no transcribe()', { capability: 'speechTranscribe' });
			}
			return speech.transcribe(args.request, callerAbortSignal(bridge.ctx));
		},
		async deleteSession(args) {
			await assertVisibleRowForBridge(bridge, args.sessionId);
			// 删除链由社区插件承担（§8.10.8 批准的端点），DSH-IDE 只做前置校验、调用与结果判定。
			// 插件缺失或未 overlay 出该方法时明确拒绝：不回退到 rmSync / 归档 / 隐藏列表行。
			const remove = resolveDeleteSessionMethod(bridge.ctx);
			if (remove === undefined) {
				throw coded(FEATURE_UNAVAILABLE, 'session delete endpoint is unavailable: install and enable @michengai/dsh-archive-manager', { capability: 'deleteSession' });
			}
			if (!(await sessionExists(bridge.ctx, args.sessionId))) {
				throw coded(INVALID_ARGUMENT, `unknown session ${args.sessionId}`);
			}
			// D52 / §8.10.5（2）：活动会话必须先被证明已停止且资源已释放才允许删除。
			// DSH-IDE 不自行 flush / detach（那是插件的删除链），因此只做**fail-closed 前置判定**：
			// 能读到 running 且为 true → 拒绝；读不到状态 → 无法证明安全 → 同样拒绝。
			// 不接受固定 sleep 代替判据，也不把 best-effort 写成完整支持。
			const readRunning = await sessionRunning(bridge.ctx, args.sessionId);
			if (readRunning !== false) {
				throw coded(FEATURE_UNAVAILABLE, readRunning === true
					? `session ${args.sessionId} is still running; stop it before deleting`
					: `cannot prove session ${args.sessionId} is stopped; refusing to delete`, { capability: 'deleteSession', running: readRunning });
			}
			const result = await remove(args.sessionId);
			// 插件在物理删除完成、记账清理后才返回 `{ deleted: true }`；其余形态一律视为未完成。
			if (result === null || typeof result !== 'object' || result.deleted !== true) {
				throw coded(FEATURE_UNAVAILABLE, `session delete did not confirm deletion for ${args.sessionId}`, { capability: 'deleteSession' });
			}
			// 删除后核验（§8.10.1（3）8）：只核「live registry 已移除」这一**确定**判据——
			// 插件在返回 `{ deleted: true }` 前已同步 detach live 会话（`workspace.ts:905-930`），
			// live 会话此刻必须查不到。不复查 `sessionController.list`：列表按 §8.2.4 是
			// 「有边界的最终一致」，同步复查会把列表滞后误报成删除失败。
			const sessions = typeof bridge.ctx.get === 'function' ? bridge.ctx.get('sessions') : undefined;
			if (sessions !== undefined && typeof sessions.get === 'function' && sessions.get(args.sessionId) !== undefined) {
				throw coded(FEATURE_UNAVAILABLE, `session delete reported success but ${args.sessionId} is still live`, { capability: 'deleteSession' });
			}
			return { accepted: true };
		},
	};
}

/**
 * 归档 / 取消归档。
 *
 * 优先 `workspaceController`：入参是 `{ sessionId }`，返回 `{ archivedSessionIds }`。
 * 没有这层 remote 时退到 `workspaceRegistry`，第一参必须是 sessionId 字符串，
 * 返回值是 void，集合从 `archivedSessionIds` 读。
 *
 * @param {'archiveSession' | 'unarchiveSession'} method
 * @param {string} sessionId
 */
async function changeArchive(bridge, method, sessionId) {
	await assertVisibleRowForBridge(bridge, sessionId);
	const controller = optionalService(bridge.ctx, 'workspaceController');
	if (controller !== undefined && typeof controller[method] === 'function') {
		return Promise.resolve(controller[method]({ sessionId })).then(value => {
			// 归档集合变了，名单归属也就变了：其它窗口必须一起刷新，
			// 否则它们会继续把这一行画在原来的分组里。
			notifySessionListOf(bridge);
			return projectDshIdeArchiveSet(value);
		});
	}
	const registry = service(bridge.ctx, 'workspaceRegistry');
	if (typeof registry[method] !== 'function') {
		throw coded(FEATURE_UNAVAILABLE, `DSH workspaceRegistry has no ${method}()`, { capability: method });
	}
	return Promise.resolve(registry[method](sessionId)).then(() => {
		const ids = Array.isArray(registry.archivedSessionIds) ? registry.archivedSessionIds : [];
		notifySessionListOf(bridge);
		return projectDshIdeArchiveSet({ archivedSessionIds: ids });
	});
}

/** `changeArchive` 在方法处理器之外，拿不到 `createMethodHandlers` 里的闭包。 */
function notifySessionListOf(bridge) {
	bridge._fanout({ type: 'session-list' });
}

/** 提交给官方 prompt 的图片引用：只留 ImageAttachmentRef 字段，不带 x- 扩展。 */
function imagePromptRef(attachment) {
	return {
		attachmentId: attachment.attachmentId,
		mediaType: attachment.mediaType,
		bytes: attachment.bytes,
		width: attachment.width,
		height: attachment.height,
		...(typeof attachment.name === 'string' && attachment.name !== '' ? { name: attachment.name } : {}),
		...(attachment.originalDimensions && typeof attachment.originalDimensions === 'object'
			? { originalDimensions: { width: attachment.originalDimensions.width, height: attachment.originalDimensions.height } }
			: {}),
	};
}

/**
 * 官方 `GoalView` → 契约 `DshIdeGoalView`。
 * 两者字段同形；`activation` 是进程内的可选扩展，官方视图本来就带，原样透出即可。
 * 形状不合就返回 undefined，让调用方按「没有目标」处理，不伪造。
 */
function projectGoalView(view) {
	if (view === null || typeof view !== 'object' || typeof view.id !== 'string' || view.id === '') {
		return undefined;
	}
	const blocked = view.blockedReason !== null && typeof view.blockedReason === 'object'
		? { code: String(view.blockedReason.code ?? ''), message: String(view.blockedReason.message ?? '') }
		: undefined;
	return {
		goal: {
			id: view.id,
			revision: view.revision,
			objective: view.objective,
			phase: view.phase,
			maxGoalRounds: view.maxGoalRounds,
			...(blocked === undefined ? {} : { blockedReason: blocked }),
		},
		roundsStarted: view.roundsStarted,
		createdAt: view.createdAt,
		updatedAt: view.updatedAt,
		...(view.activation === 'armed' || view.activation === 'disarmed' ? { activation: view.activation } : {}),
	};
}

/** `projectGoalView` 的形状守卫：投影失败时明确报错，不让 `undefined` 混进线协议。 */
function requireGoalView(view) {
	if (view === undefined) {
		throw coded(FEATURE_UNAVAILABLE, 'DSH goals service returned an unrecognized GoalView', { capability: 'setGoal' });
	}
	return view;
}

/**
 * 插件 `rewind-plugin` 的切点。UI 按钮发的是 `@<seq>`（绝对日志序号）。
 * 纯数字按同一含义补上 `@`；别的形状拒绝，不把裸数字当成「第几条」。
 */
function rewindPoint(to) {
	if (typeof to !== 'string') {
		throw coded(INVALID_ARGUMENT, 'rewind.to must be a user-message seq');
	}
	const seq = to.startsWith('@') ? to.slice(1) : to;
	if (!/^\d+$/.test(seq)) {
		throw coded(INVALID_ARGUMENT, 'rewind.to must be a non-negative integer seq');
	}
	return `@${seq}`;
}

/** 官方 `SessionForkRequest.atSeq` 是非负整数。非数字不能变成 NaN 再被 JSON 收成 null。 */
function forkSeq(point) {
	if (typeof point !== 'string' || !/^\d+$/.test(point)) {
		throw coded(INVALID_ARGUMENT, 'fork.point must be a non-negative integer seq');
	}
	return Number(point);
}

function splitModel(model) {
	const slash = model.indexOf('/');
	return slash <= 0 ? ['deepseek', model] : [model.slice(0, slash), model.slice(slash + 1)];
}

/**
 * 线上 `ImageAttachmentRef` → 官方 `CommandSubmitAttachment`。
 *
 * 官方只接受编码后的图片（`{ type:'image', mediaType, data, name? }`，
 * `attachment/src/types.ts:85-92`），所以必须经 `attachments.readImage()` 取字节；
 * 取不到就明确拒绝，不拿空数据顶替。
 */
async function toCommandSubmitAttachment(ctx, attachment) {
	const store = service(ctx, 'attachments');
	if (typeof store.readImage !== 'function') {
		throw coded(FEATURE_UNAVAILABLE, 'DSH attachments service has no readImage()', { capability: 'runCommand' });
	}
	const stored = await store.readImage(attachment);
	const bytes = stored && stored.data;
	if (!bytes || typeof bytes.length !== 'number') {
		throw coded(FEATURE_UNAVAILABLE, 'DSH attachments service returned no image bytes', { capability: 'runCommand' });
	}
	return {
		type: 'image',
		mediaType: (stored.ref && stored.ref.mediaType) || attachment.mediaType,
		data: Buffer.from(bytes).toString('base64'),
		...(typeof attachment.name === 'string' && attachment.name !== '' ? { name: attachment.name } : {}),
	};
}
/**
 * 取社区插件 overlay 到官方 `workspaceRegistry` 实例上的 `deleteSession`。
 *
 * 两种形态都只调公开方法（§8.10.8 批准范围）：
 *   ① 进程内直调：插件在官方实例上 overlay 出 `deleteSession(sessionId)`（`host-install.ts:8-12`）；
 *   ② 经官方 Typert Gateway 的 `remote.workspaceRegistry.deleteSession`（插件自造 remote）。
 * 两者都要求宿主已安装并启用插件；方法缺失时返回 undefined，由调用方明确拒绝。
 *
 * 加载时序（§8.10.8（3）2）：插件与 DSH-IDE 是两条独立行，overlay 与本次取值的先后
 * 未在源码中定义，因此这里每次都重新取，不在模块加载期缓存结果。
 *
 * @returns `(sessionId) => Promise<unknown>` 或 undefined
 */
export function resolveDeleteSessionMethod(ctx) {
	const registry = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : undefined;
	if (registry !== undefined && registry !== null && typeof registry.deleteSession === 'function') {
		return sessionId => registry.deleteSession(sessionId);
	}
	const remote = typeof ctx.get === 'function' ? ctx.get('remote.workspaceRegistry') : undefined;
	if (remote !== undefined && remote !== null && typeof remote.deleteSession === 'function') {
		// 网关包装返回 `{ ok, value }` 或 `{ ok:false, error }`；这里统一成「值或抛出」，
		// 让调用方只看删除结果，不关心两种形态的差异。
		return async sessionId => {
			const result = await remote.deleteSession(sessionId);
			if (result === null || typeof result !== 'object') {
				return result;
			}
			if (result.ok === false) {
				throw coded(FEATURE_UNAVAILABLE, `session delete failed: ${result.error && result.error.message ? result.error.message : 'unknown error'}`, { capability: 'deleteSession' });
			}
			return result.ok === true ? result.value : result;
		};
	}
	return undefined;
}

/**
 * 会话是否存在：优先问内核 live registry（`sessions.get`），其次问 API 列表。
 *
 * 为什么两处都问：`sessions.get` 只认 live 会话，冷会话必须问 `sessionController.list`。
 * 两处都查不到即判「未知会话」，与删除链「未知会话不做物理动作」的口径一致。
 *
 * @returns 布尔值；查询本身失败时抛错（不把查询失败当成「不存在」）
 */
/**
 * 读取会话当前是否仍有活动 turn（D52 前置判据）。
 *
 * 官方信号：`sessionController.state({ sessionId }, signal)` 返回 `SessionState.running`
 * （`api/session-controller/src/types.ts:608-611`）。返回三态：
 *   - `true`  —— 明确仍在运行；
 *   - `false` —— 明确已停止；
 *   - `undefined` —— 读不到状态（服务缺失 / 调用失败 / 字段非布尔），无法证明安全。
 * 调用方按 §8.10.5 只接受 `false`，其余一律拒绝（fail-closed）。
 *
 * @param {object} ctx - 插件上下文。
 * @param {string} sessionId - 目标会话。
 * @returns {Promise<boolean | undefined>}
 */
async function sessionRunning(ctx, sessionId) {
	const controller = typeof ctx.get === 'function' ? ctx.get('sessionController') : undefined;
	if (controller === undefined || typeof controller.state !== 'function') {
		return undefined;
	}
	try {
		const value = await controller.state({ sessionId }, callerSignal());
		const running = value && typeof value === 'object' ? value.running : undefined;
		return typeof running === 'boolean' ? running : undefined;
	} catch {
		// 读状态失败不得被解释成「已停止」：交回 undefined 由调用方拒绝。
		return undefined;
	}
}

async function sessionExists(ctx, sessionId) {
	const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined;
	if (sessions !== undefined && typeof sessions.get === 'function' && sessions.get(sessionId) !== undefined) {
		return true;
	}
	const controller = typeof ctx.get === 'function' ? ctx.get('sessionController') : undefined;
	if (controller === undefined || typeof controller.list !== 'function') {
		return false;
	}
	const value = await controller.list({});
	const items = value && Array.isArray(value.items) ? value.items : [];
	return items.some(item => item && item.sessionId === sessionId);
}

/**
 * 由 Host 自己推导 IDE 可用的官方端点与 launch URL（不新增私有端点）。
 *
 * 依据（https://github.com/deepseek-ai/deepseek-harness，0.2.2-rc.1）：
 *   - `webServer` 暴露 `port` / `host` / `protocol`（packages/host/webserver/src/index.ts:406-420）；
 *   - `connection.authenticatedUrl(baseUrl)` 把进程内 launch token 拼到干净 URL 上
 *     （packages/client/connection/src/rpc-host.ts:198）。
 * 因此这与桌面端 `apps/desktop/src/main.ts:531-532` 取端点的方式同源，不是第二套握手。
 *
 * @returns { origin, launchUrl } 或 undefined（服务缺失时明确返回 undefined，不伪造）。
 */
/**
 * 优先用 DSH 自己公布的地址（`webApp.getAdvertisedUrl` / `webServer.getOrigin`），
 * 没有时才用 port/host 拼。不写死 127.0.0.1 以外的主机名。
 * @param {object} ctx
 * @param {object | undefined} webServer
 * @returns {string | undefined}
 */
function advertisedOrigin(ctx, webServer) {
	const webApp = typeof ctx.get === 'function' ? ctx.get('webApp') : undefined;
	const candidates = [];
	if (webApp !== undefined && typeof webApp.getAdvertisedUrl === 'function') {
		try {
			const url = webApp.getAdvertisedUrl();
			if (typeof url === 'string' && url !== '') {
				candidates.push(url);
			}
		} catch {
			// 公布地址抛错时退回 port/host，不让发现过程本身失败。
		}
	}
	if (webServer !== undefined && typeof webServer.getOrigin === 'function') {
		try {
			const url = webServer.getOrigin();
			if (typeof url === 'string' && url !== '') {
				candidates.push(url);
			}
		} catch {
			// 同上。
		}
	}
	for (const value of candidates) {
		try {
			return new URL(value).origin;
		} catch {
			// 不是合法 URL 就试下一个。
		}
	}
	return undefined;
}

export function resolveHostEndpoint(ctx) {
	const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined;
	const connection = typeof ctx.get === 'function' ? ctx.get('connection') : undefined;
	if (webServer === undefined || connection === undefined) {
		return undefined;
	}
	let origin = advertisedOrigin(ctx, webServer);
	const portFromOrigin = origin === undefined ? undefined : Number(new URL(origin).port);
	const port = Number.isInteger(portFromOrigin) && portFromOrigin > 0
		? portFromOrigin
		: (typeof webServer.port === 'number' ? webServer.port : undefined);
	if (origin === undefined) {
		if (port === undefined) {
			return undefined;
		}
		const protocol = typeof webServer.protocol === 'string' ? webServer.protocol : 'http:';
		const host = typeof webServer.host === 'string' && webServer.host !== '' && webServer.host !== '0.0.0.0'
			? webServer.host
			: '127.0.0.1';
		origin = `${protocol.replace(/:$/, '')}://${host}:${port}`;
	}
	if (port === undefined) {
		return undefined;
	}
	const launchUrl = typeof connection.authenticatedUrl === 'function'
		? connection.authenticatedUrl(`${origin}/`)
		: undefined;
	return { origin, port, ...(typeof launchUrl === 'string' ? { launchUrl } : {}) };
}

/**
 * 把 Host 端点写进调用方给出的文件（正常是与本次 DSH 同卷的状态目录里的 `host-endpoint.json`），供 IDE 侧读取。
 *
 * 为什么用文件：IDE 进程由操作系统单独拉起（不是 Host 的子进程），环境变量无法传递；
 * 手册第 7 章 §3.1 裁定禁止私有管道/私有握手，而「写一份只读端点描述」既不是传输
 * 也不是握手——传输仍是官方 HTTP/WS，文件只解决「怎么找到端口」这一引导问题。
 *
 * 内容只含 origin / port / launchUrl（launch token 在 URL 里，由 Host 自己生成），
 * 与桌面端把 `ready.url` 交给自己的窗口等价；不写 cookie、不写凭据副本。
 *
 * D55：launchUrl 里的 query token 是认证材料，文件按 0o600 建、写入后立刻 chmod 收紧
 * 到「仅所有者可读写」（POSIX 生效；Windows 的 chmod 不改 ACL，见本函数注释，不伪称 PASS）。
 * 端点文件由插件运行期写入状态目录，不进版本库、不进打包产物。
 */
export async function publishHostEndpoint(ctx, targetPath) {
	const endpoint = resolveHostEndpoint(ctx);
	if (endpoint === undefined) {
		return undefined;
	}
	try {
		const { mkdir, writeFile, chmod } = await import('node:fs/promises');
		const { dirname } = await import('node:path');
		await mkdir(dirname(targetPath), { recursive: true });
		// mode 在文件新建时生效；chmod 兜住「旧文件已存在且权限较宽」的情形。
		await writeFile(targetPath, JSON.stringify({ ...endpoint, pid: process.pid, writtenAt: Date.now() }, null, 2), { encoding: 'utf8', mode: 0o600 });
		await chmod(targetPath, 0o600);
		return endpoint;
	} catch {
		// 写失败不影响插件加载：IDE 会按「无端点」明确降级，不伪造。
		// D55：不记录异常原文——它可能含完整路径或端点内容。
		return undefined;
	}
}

/**
 * D55：凭据清理。窗口关闭 / Host 重启 / 插件卸载时删除端点文件，
 * 使一次性 query token 不再落盘。清理失败静默：文件本身已随进程退出失去 reader，
 * 不因删不掉而伪造「已轮换」结论（真机轮换由 U12 复核）。
 *
 * @param {string} targetPath - 端点文件路径
 * @returns {Promise<void>}
 */
export async function removeHostEndpoint(targetPath) {
	try {
		const { unlink } = await import('node:fs/promises');
		await unlink(targetPath);
	} catch {
		// 文件不存在或已清理都算完成，不暴露路径与异常内容。
	}
}

/** D55：把端点（含 launchUrl）安全地转成可日志输出的 origin-only 文案。 */
export function endpointLogText(endpoint) {
	return endpoint === undefined ? 'unavailable' : safeErrorText(endpoint.origin);
}



/**
 * 等 `webServer.port` 出现后再发布端点。
 *
 * 为什么不能只等 `ctx.inject(['webServer'])`：服务注册与 HTTP 监听是两件事，
 * `port` 由 `server.listen()` 回调回填（webserver/src/index.ts:624），apply 阶段为 undefined。
 * 这里按固定间隔轮询有限次数，超时就明确记录并放弃，绝不伪造端点。
 *
 * @param ctx - 插件上下文
 * @param targetPath - 端点文件路径
 * @param options - `timeoutMs` 总等待时长，`intervalMs` 轮询间隔
 * @returns 端点或 undefined
 */
export async function publishHostEndpointWhenListening(ctx, targetPath, options = {}) {
	const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 30_000;
	const intervalMs = typeof options.intervalMs === 'number' ? options.intervalMs : 250;
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const endpoint = resolveHostEndpoint(ctx);
		if (endpoint !== undefined) {
			const written = await publishHostEndpoint(ctx, targetPath);
			if (written !== undefined) {
				return written;
			}
		}
		await new Promise(resolve => setTimeout(resolve, intervalMs));
	}
	return undefined;
}

/** 插件入口与单测共用：核对必需服务后创建桥接。 */
export function createDshIdeHostBridge(ctx, options = {}) {
	const absent = REQUIRED_SERVICES.filter(name => (typeof ctx.get === 'function' ? ctx.get(name) : undefined) === undefined);
	if (absent.length > 0) {
		throw coded(FEATURE_UNAVAILABLE, `DSH-IDE requires services: ${absent.join(', ')}`, { missing: absent });
	}
	return new DshIdeHostBridge(ctx, options);
}

export default DshIdeHostBridge;
