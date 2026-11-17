// src/vs/platform/dshClient/host/ide-view-host.js
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
import { projectDshIdeSessionList, projectDshIdeWorkspaceSessions } from '../common/dshIdeSessionList.js';
import { projectDshIdeCommandList } from '../common/dshIdeCommandList.js';
import { buildDshIdeCommandLine, mapDshIdeCommandExecution } from '../common/dshIdeCommandLine.js';
import { projectDshIdeArchiveSet } from '../common/dshIdeArchiveSet.js';
import { projectDshIdeSessionSearch } from '../common/dshIdeSessionSearch.js';
import { projectDshIdeComposer } from '../common/dshIdeComposer.js';
import { projectApprovalRequest, projectQuestionRequest } from '../common/dshIdeRequestView.js';
import { safeErrorText } from '../common/dshIdeAuthRedaction.js';

/** 与 common/dshIdeProtocol.ts 同值的错误码（Host 半身为纯 JS，不跨层 import TS）。 */
export const FEATURE_UNAVAILABLE = 'dsh-ide/feature-unavailable';
export const INVALID_ARGUMENT = 'dsh-ide/invalid-argument';
export const ALREADY_RESOLVED = 'ALREADY_RESOLVED';
export const SESSION_SWITCHED = 'SESSION_SWITCHED';

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

	/** 决议一条请求：返回 true 表示本次决议生效，false 表示重复或未知请求。 */
	settle(requestId, value) {
		const entry = this.entries.get(requestId);
		if (entry === undefined) {
			return false;
		}
		this.entries.delete(requestId);
		entry.resolve(value);
		return true;
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
		this._sessionReads = new Set();
		/** @type {Map<string, { abort: AbortController, listeners: Set<(frame: unknown) => void>, ref: number }>} */
		this._follows = new Map();
		/** 没有绑定会话的窗口也要收到状态变化，不能只塞进某一次 follow。 */
		this._statusListeners = new Set();
		this._armWaterfalls();
		this._armSessionStatus();
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

	/**
	 * 跟随一个会话。同一个会话只调用一次 `sessionController.follow`，
	 * 多个视图收同一份帧。没有会话地址时不听。
	 */
	follow(sessionId, onEvent) {
		if (typeof sessionId !== 'string' || sessionId === '') {
			this._statusListeners.add(onEvent);
			return { dispose: () => { this._statusListeners.delete(onEvent); } };
		}
		this.sessionId = sessionId;
		const shared = this._ensureFollow(sessionId);
		shared.listeners.add(onEvent);
		shared.ref += 1;
		return {
			dispose: () => {
				if (!shared.listeners.delete(onEvent)) {
					return;
				}
				shared.ref -= 1;
				if (shared.ref <= 0) {
					shared.abort.abort();
					this._follows.delete(sessionId);
				}
			},
		};
	}

	/** 给官方流式 remote 用：帧原样送出，不改写成行。 */
	async *followSession(sessionId, signal) {
		const queue = [];
		let wake = () => undefined;
		let closed = false;
		const handle = this.follow(typeof sessionId === 'string' ? sessionId : '', frame => {
			queue.push(frame);
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

	_ensureFollow(sessionId) {
		const existing = this._follows.get(sessionId);
		if (existing !== undefined) {
			return existing;
		}
		const abort = new AbortController();
		const shared = { abort, listeners: new Set(), ref: 0 };
		this._follows.set(sessionId, shared);
		const controller = service(this.ctx, 'sessionController');
		const pump = async () => {
			try {
				const frames = controller.follow({
					address: { kind: 'session', sessionId },
					assistantStream: true,
				}, abort.signal);
				for await (const frame of frames) {
					for (const listener of [...shared.listeners]) {
						try {
							listener(frame);
						} catch {
							// 单个视图抛错不影响同一条流上的其它视图。
						}
					}
				}			} catch (error) {
				if (abort.signal.aborted) {
					return;
				}
				const message = error && error.message ? error.message : String(error);
				console.warn(`[dsh-ide] session follow ended: ${message}`);
			} finally {
				// 官方流结束（或被传输层断掉）后必须摘掉缓存条目：否则后续窗口
				// `_ensureFollow` 会拿到这条已经死掉的流，加监听收不到任何帧，
				// 表现为「连上了 Host、会话列表也在，但聊天永远空白且不报错」。
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

	/**
	 * 唯一的交互式 answerer。请求登记后交给界面；界面未接管则 `next()` 委托给下一个 answerer，
	 * 因此不会与 DSH 自己的 answerer 争抢，也不会出现第二套答案形态。
	 */
	async answer(kind, request, next) {
		const requestId = request && request.requestId;
		if (typeof requestId !== 'string' || requestId === '') {
			return typeof next === 'function' ? next() : undefined;
		}
		const handle = this.pending.register(kind, requestId);
		this.emitToUi({ type: 'request', kind, requestId, request: describeRequest(kind, request) });
		const transport = this.transport;
		if (transport === undefined || typeof transport.post !== 'function') {
			// 界面未接线：撤销登记并交还给下一个 answerer，绝不伪造决议。
			this.pending.delegate(requestId, handle.entry);
			return typeof next === 'function' ? next() : undefined;
		}
		const decision = await handle.promise;
		if (decision === undefined) {
			return typeof next === 'function' ? next() : undefined;
		}
		return decision;
	}

	emitToUi(message) {
		if (this.transport !== undefined && typeof this.transport.post === 'function') {
			this.transport.post(message);
		}
	}

	async invoke(method, args) {
		const handler = this.methods[method];
		if (handler === undefined) {
			throw coded(FEATURE_UNAVAILABLE, `DshIdeHostBridge: method ${JSON.stringify(method)} is not defined`);
		}
		return handler(args || {});
	}

	/** 会话归属校验（第 2 章 E6）。 */
	assertOwnership(requested) {
		if (requested === undefined || this.sessionId === undefined || requested === this.sessionId) {
			return;
		}
		throw coded(SESSION_SWITCHED, `DSH-IDE session switched: bound ${this.sessionId}, requested ${requested}`);
	}

	close() {
		for (const cancel of this._sessionReads) {
			cancel();
		}
		this._sessionReads.clear();
		for (const shared of this._follows.values()) {
			shared.abort.abort();
		}
		this._follows.clear();
		this.disposeSubscriptions();
		this.pending.entries.clear();
		this.channelId = undefined;
		this.sessionId = undefined;
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
	// 账号域是独立服务：官方服务名是 `deepseekAccount`（`accountController` 只是 Remote 包装类，
	// 不是注册进 ctx 的服务名；用错会把调用打到一个不存在的服务上）。
	const account = () => service(bridge.ctx, 'deepseekAccount');
	const sessionIdOf = args => args.sessionId ?? bridge.sessionId;
	const requireSession = () => {
		if (bridge.sessionId === undefined) {
			throw coded(INVALID_ARGUMENT, 'DSH-IDE view has no bound session');
		}
		return bridge.sessionId;
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
	const executeCommandLine = async (line, attachments = []) => {
		const sessionId = requireSession();
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
			const attachments = Array.isArray(args.attachments) ? args.attachments : [];
			await controller().prompt({
				requestId: randomUUID(),
				sessionId: requireSession(),
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
		async interrupt() {
			await controller().cancel({ sessionId: requireSession() });
			return { accepted: true };
		},
		async resume(args) {
			bridge.assertOwnership(args.sessionId);
			if (args.sessionId !== undefined) {
				await controller().state({ sessionId: args.sessionId }, callerSignal());
				bridge.sessionId = args.sessionId;
			}
			return { accepted: true };
		},
		async newSession(args) {
			const created = await controller().create({
				...(args.workspace === undefined ? {} : { cwd: args.workspace }),
			});
			const sessionId = created && created.sessionId;
			if (typeof sessionId === 'string') {
				bridge.sessionId = sessionId;
			}
			return { accepted: true, ...(typeof sessionId === 'string' ? { sessionId } : {}) };
		},
		async fork(args) {
			bridge.assertOwnership(args.sessionId);
			const created = await controller().fork({
				sessionId: args.sessionId,
				...(args.point === undefined || args.point === '' ? {} : { atSeq: forkSeq(args.point) }),
			});
			const sessionId = created && (created.sessionId || created.childSessionId);
			if (typeof sessionId === 'string') {
				bridge.sessionId = sessionId;
			}
			return { accepted: true, ...(typeof sessionId === 'string' ? { sessionId } : {}) };
		},
		async rewind(args) {
			// core 没有 rewind remote。装上 dsh-rewind-plugin 后，Host 上的命令名是
			// `rewind-plugin`（插件自己的 ENGINE_COMMAND）。入参是 `@<seq> chat|both`；
			// 契约只有消息切点，没有文件恢复，所以模式固定为 chat。
			bridge.assertOwnership(args.sessionId);
			const point = rewindPoint(args.to);
			const sessionId = requireSession();
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
			return executeCommandLine(buildDshIdeCommandLine('rewind-plugin', [point, 'chat']));
		},
		async loadOlder(args) {
			// 官方 `session/page` 是独立只读端点，返回值就是这一页；
			// follow 只在开头推一次 snapshot，page() 不会重推，所以必须把页带回去。
			// 只投影 records + hasMore，丢掉官方 cursor（下一页用最小 seq 当 beforeSeq）。
			const sessionId = args.sessionId ?? requireSession();
			bridge.assertOwnership(sessionId);
			const page = await controller().page({
				address: { kind: 'session', sessionId },
				...(args.throughSeq === undefined ? {} : { throughSeq: args.throughSeq }),
				...(args.beforeSeq === undefined ? {} : { beforeSeq: args.beforeSeq }),
				...(args.maxMessages === undefined ? {} : { maxMessages: args.maxMessages }),
			}, callerSignal());
			if (!page || !Array.isArray(page.records) || typeof page.hasMore !== 'boolean') {
				throw coded(FEATURE_UNAVAILABLE, 'sessionController.page returned a page without records and hasMore', { capability: 'loadOlder' });
			}
			return { accepted: true, page: { records: page.records, hasMore: page.hasMore } };
		},
		async answerApproval(args) {
			const outcome = approvalOutcome(args.decision);
			if (!bridge.pending.settle(args.requestId, outcome)) {
				throw coded(ALREADY_RESOLVED, `approval request ${args.requestId} is already resolved or unknown`);
			}
			return { accepted: true };
		},
		async answerQuestion(args) {
			if (!bridge.pending.settle(args.requestId, args.answer)) {
				throw coded(ALREADY_RESOLVED, `question request ${args.requestId} is already resolved or unknown`);
			}
			return { accepted: true };
		},
		async cancelRequest(args) {
			if (!bridge.pending.settle(args.requestId, 'cancelled')) {
				throw coded(ALREADY_RESOLVED, `request ${args.requestId} is already resolved or unknown`);
			}
			return { accepted: true };
		},
		async setModel(args) {
			const sessionId = requireSession();
			const [provider, model] = splitModel(args.model);
			await controller().selectModel({ sessionId, provider, model });
			return { accepted: true };
		},
		async setEffort(args) {
			// D13/D16：官方无独立 setEffort remote；effort 是 session/selectModel 的
			// reasoningEffort 字段（§8.10.9）。当前 provider/model 从 session/projections
			// 的 modelSelection.next wire view 读取，避免凭记忆猜路由。
			const sessionId = requireSession();
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
			return executeCommandLine(buildDshIdeCommandLine('permission', [args.preset]));
		},
		async runCommand(args) {
			// 契约 `command` 为不带前导斜杠的命令名，`args` 单空格拼入 rawInput；
			// 附件按官方 `CommandSubmitAttachment` 传给命令执行器。
			return executeCommandLine(buildDshIdeCommandLine(args.command, args.args), Array.isArray(args.attachments) ? args.attachments : []);
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
		async composerState() {
			// 输入框一次读齐：模型目录、当前选择、权限目录、预设名单。
			// 权限 / 预设服务没挂上时对应控件为 null，不把整条读取打成失败。
			const sessionId = requireSession();
			const projected = await controller().projections({ sessionId }, callerSignal());
			const values = projected && typeof projected === 'object' ? projected.values : undefined;
			const catalog = await controller().modelCatalog();
			return projectDshIdeComposer({
				values,
				catalog,
				permission: optionalCall(bridge.ctx, 'permissionPresets', 'catalog'),
				presets: await optionalCallAsync(bridge.ctx, 'agentPresets', 'list'),
			});
		},
		async setTeamEnabled(args) {
			// 官方 agentTeams.setEnabled(agent, enabled, signal)：只改根会话的团队开关。
			const sessionId = requireSession();
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
			const sessionId = requireSession();
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
			const catalog = await controller().modelCatalog();
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
		async listCommands() {
			// D13（第 32 轮）：官方 `commands.list(agent)` 是 agent-scoped remote
			// （§8.10.9 第 31 轮核实的 wire 形状）。Host 半身进程内经官方 `agents`
			// 服务把绑定 sessionId 解析为 Agent，再调 `commands.list`，只投影中立字段。
			const sessionId = requireSession();
			const agents = service(bridge.ctx, 'agents');
			const agent = typeof agents.get === 'function' ? agents.get(sessionId) : undefined;
			if (agent === undefined || agent === null) {
				// 绑定会话没有 live Agent 时无法列出该 agent 的命令：明确拒绝，不伪造全局列表。
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
		async archiveSession(args) {
			// 官方 remote 是 `workspaceController.archiveSession({ sessionId })`，返回完整归档集合。
			// `workspaceRegistry.archiveSession` 是另一套签名：第一参是 sessionId 字符串，返回 void。
			// 不传 stopActivity：是否强停运行中的会话由调用方显式决定，缺省保留官方拒绝。
			return changeArchive(bridge, 'archiveSession', args.sessionId);
		},
		async unarchiveSession(args) {
			return changeArchive(bridge, 'unarchiveSession', args.sessionId);
		},
		addAttachment: missing('addAttachment'),
		removeAttachment: missing('removeAttachment'),
		async setGoal(args) {
			// 官方 `goals` 服务（`packages/goal/goal/src/index.ts`）：create/edit/pause/resume/complete/clear。
			// agent 从绑定会话解析；edit/pause/resume/complete/clear 需要 { id, revision } 这一 CAS 引用。
			const sessionId = requireSession();
			const agents = service(bridge.ctx, 'agents');
			const agent = typeof agents.get === 'function' ? agents.get(sessionId) : undefined;
			if (agent === undefined || agent === null) {
				throw coded(FEATURE_UNAVAILABLE, `no live agent for bound session ${sessionId}`, { capability: 'setGoal' });
			}
			const goals = service(bridge.ctx, 'goals');
			switch (args.action) {
				case 'create': {
					// `remoteExportCreate` 是线协议，只回 `{ ref }`。界面要的是 GoalView，
					// 所以走进程内 `create`，再投影成契约形状。
					const request = {
						...(typeof args.objective === 'string' ? { objective: args.objective } : {}),
						...(typeof args.maxGoalRounds === 'number' ? { maxGoalRounds: args.maxGoalRounds } : {}),
					};
					if (typeof goals.create !== 'function') {
						throw coded(FEATURE_UNAVAILABLE, 'DSH goals service has no create()', { capability: 'setGoal' });
					}
					return requireGoalView(projectGoalView(goals.create(agent, request)));
				}
				case 'edit': {
					const ref = { id: args.id, revision: args.revision };
					const request = {
						...(typeof args.objective === 'string' ? { objective: args.objective } : {}),
						...(typeof args.maxGoalRounds === 'number' ? { maxGoalRounds: args.maxGoalRounds } : {}),
					};
					return requireGoalView(projectGoalView(goals.edit(agent, ref, request)));
				}
				case 'pause':
					return requireGoalView(projectGoalView(goals.pause(agent, { id: args.id, revision: args.revision })));
				case 'resume':
					return requireGoalView(projectGoalView(goals.resume(agent, { id: args.id, revision: args.revision })));
				case 'complete':
					return requireGoalView(projectGoalView(goals.complete(agent, { id: args.id, revision: args.revision })));
				case 'clear':
					// 官方 `clear` 返回 `GoalRef`（tombstone），不是 `GoalView`：原样透出引用，
					// 不拿去套 `projectGoalView`（那样只会得到 undefined）。
					return goals.clear(agent, { id: args.id, revision: args.revision });
				default:
					throw coded(INVALID_ARGUMENT, `unknown setGoal action ${JSON.stringify(args.action)}`);
			}
		},
		async renameSession(args) {
			bridge.assertOwnership(args.sessionId);
			await controller().rename({ sessionId: args.sessionId, title: args.title });
			return { accepted: true };
		},
		async setSessionFavorite(args) {
			bridge.assertOwnership(args.sessionId);
			const registry = service(bridge.ctx, 'workspaceRegistry');
			if (typeof registry.setSessionFavorite !== 'function' || typeof registry.favoriteSessions !== 'function') {
				throw coded(FEATURE_UNAVAILABLE, 'session favorite is unavailable: install and enable @michengai/dsh-archive-manager', { capability: 'setSessionFavorite' });
			}
			const current = await registry.favoriteSessions();
			const ids = current && Array.isArray(current.favoriteSessionIds) ? current.favoriteSessionIds : [];
			await registry.setSessionFavorite({ sessionId: args.sessionId, favorite: !ids.includes(args.sessionId) });
			return { accepted: true };
		},
		async setSessionPinned(args) {
			bridge.assertOwnership(args.sessionId);
			const workspaces = service(bridge.ctx, 'workspaceController');
			const registry = optionalService(bridge.ctx, 'workspaceRegistry');
			const pinned = registry && Array.isArray(registry.pinnedSessionIds) ? registry.pinnedSessionIds.includes(args.sessionId) : false;
			const method = pinned ? 'unpinSession' : 'pinSession';
			if (typeof workspaces[method] !== 'function') {
				throw coded(FEATURE_UNAVAILABLE, `DSH workspaceController has no ${method}()`, { capability: 'setSessionPinned' });
			}
			await workspaces[method]({ sessionId: args.sessionId });
			return { accepted: true };
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
			bridge.assertOwnership(args.sessionId);
			const registry = service(bridge.ctx, 'workspaceRegistry');
			if (typeof registry.moveSessionToWorkspace !== 'function') {
				throw coded(FEATURE_UNAVAILABLE, 'moving a session is unavailable: install and enable @michengai/dsh-archive-manager', { capability: 'moveSession' });
			}
			await registry.moveSessionToWorkspace({ sessionId: args.sessionId, targetWorkspaceId: args.workspaceId });
			return { accepted: true };
		},
		async openSessionPath(args) {
			bridge.assertOwnership(args.sessionId);
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
		listSkills: async () => {
			// 官方落点是 `sessionSkillCatalog.list({ sessionId }, signal)`（`skills` Remote），
			// 不是 `ctx.skills.list({ scope })`。scope 是 ScopeKey，把 sessionId 塞进去读不到会话目录。
			// 返回的 `SkillEntry` 没有 provider：只投影官方字段，userInvocable 恒为 true
			// （该目录已按 isUserInvocable 过滤）。
			const sessionId = requireSession();
			const catalog = service(bridge.ctx, 'sessionSkillCatalog');
			if (typeof catalog.list !== 'function') {
				throw coded(FEATURE_UNAVAILABLE, 'DSH sessionSkillCatalog has no list()', { capability: 'listSkills' });
			}
			const value = await catalog.list({ sessionId }, callerSignal());
			const summaries = value && Array.isArray(value.skills) ? value.skills : [];
			return summaries.flatMap(skill => {
				if (skill === null || typeof skill !== 'object') {
					return [];
				}
				const name = typeof skill.name === 'string' ? skill.name : '';
				const description = typeof skill.description === 'string' ? skill.description : '';
				if (name === '' || description === '') {
					return [];
				}
				const provider = typeof skill.provider === 'string' && skill.provider !== '' ? skill.provider : undefined;
				return [{
					name,
					description,
					...(typeof skill.whenToUse === 'string' && skill.whenToUse !== '' ? { whenToUse: skill.whenToUse } : {}),
					modelInvocable: skill.modelInvocable === true,
					userInvocable: true,
					...(provider === undefined ? {} : { provider }),
				}];
			});
		},
		openInApp: missing('openInApp'),
		dismissQuotaNotice: missing('dismissQuotaNotice'),
		async deleteSession(args) {
			bridge.assertOwnership(args.sessionId);
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
function changeArchive(bridge, method, sessionId) {
	bridge.assertOwnership(sessionId);
	const controller = optionalService(bridge.ctx, 'workspaceController');
	if (controller !== undefined && typeof controller[method] === 'function') {
		return Promise.resolve(controller[method]({ sessionId })).then(projectDshIdeArchiveSet);
	}
	const registry = service(bridge.ctx, 'workspaceRegistry');
	if (typeof registry[method] !== 'function') {
		throw coded(FEATURE_UNAVAILABLE, `DSH workspaceRegistry has no ${method}()`, { capability: method });
	}
	return Promise.resolve(registry[method](sessionId)).then(() => {
		const ids = Array.isArray(registry.archivedSessionIds) ? registry.archivedSessionIds : [];
		return projectDshIdeArchiveSet({ archivedSessionIds: ids });
	});
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
export function resolveHostEndpoint(ctx) {
	const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined;
	const connection = typeof ctx.get === 'function' ? ctx.get('connection') : undefined;
	if (webServer === undefined || connection === undefined) {
		return undefined;
	}
	const port = typeof webServer.port === 'number' ? webServer.port : undefined;
	if (port === undefined) {
		return undefined;
	}
	const protocol = typeof webServer.protocol === 'string' ? webServer.protocol : 'http:';
	const host = typeof webServer.host === 'string' && webServer.host !== '' && webServer.host !== '0.0.0.0'
		? webServer.host
		: '127.0.0.1';
	const origin = `${protocol.replace(/:$/, '')}://${host}:${port}`;
	const launchUrl = typeof connection.authenticatedUrl === 'function'
		? connection.authenticatedUrl(`${origin}/`)
		: undefined;
	return { origin, port, ...(typeof launchUrl === 'string' ? { launchUrl } : {}) };
}

/**
 * 把 Host 端点写进插件目录下的 `runtime/host-endpoint.json`，供 IDE 侧读取。
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
 * 端点文件由插件运行期写入 `<plugin>/runtime/`，不进版本库、不进打包产物。
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
