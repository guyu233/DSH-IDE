// src/vs/platform/dshClient/host/ide-view-host.js
// DSH-IDE Host 半身：在 DSH Host 进程内把官方事件与官方服务桥接给 IDE 主进程。
//
// 职责边界（第 1 章 §3）：本文件是唯一允许持有插件上下文、订阅 DSH 官方事件的插件侧代码。
// 它只做三件事：订阅四类官方事件并原样转发、注册唯一的交互式 answerer、把 22 个 DTO method
// 映射到已核对的官方服务调用。投影与快照版本计数在 electron-main 的 `DshIdeViewService`
// （两者共用 common/ 的 translator + projector，与 golden 门禁同一份实现）。
//
// 传输端口：`transport` 由 P5 真机接线提供。未注入时本文件不伪造任何事件或决议：
// `follow` 只登记监听，answerer 一律 `next()` 委托给 DSH 自己的 answerer。
//
// 已核对的服务与方法（E:/deepseek-harness-0.2.2-rc.1）：
//   sessions: get(id) / list()
//   sessionController: list / create / selectModel / modelCatalog / prompt / cancel / fork / state
//   approval/request 结果值：'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

import { randomUUID } from 'node:crypto';
import { projectDshIdeSessionList } from '../common/dshIdeSessionList.js';
import { projectDshIdeCommandList } from '../common/dshIdeCommandList.js';
import { buildDshIdeCommandLine, mapDshIdeCommandExecution } from '../common/dshIdeCommandLine.js';
import { projectDshIdeArchiveSet } from '../common/dshIdeArchiveSet.js';
import { safeErrorText } from '../common/dshIdeAuthRedaction.js';

/** 与 common/dshIdeProtocol.ts 同值的错误码（Host 半身为纯 JS，不跨层 import TS）。 */
export const FEATURE_UNAVAILABLE = 'dsh-ide/feature-unavailable';
export const INVALID_ARGUMENT = 'dsh-ide/invalid-argument';
export const ALREADY_RESOLVED = 'ALREADY_RESOLVED';
export const SESSION_SWITCHED = 'SESSION_SWITCHED';

/**
 * 本桥接依赖的官方服务（缺任一即按 feature-unavailable 拒绝）。
 * 入口的顶层 inject 与延迟 ctx.inject 共同满足本表；延迟注入直接复用本表，避免清单漂移。
 */
export const REQUIRED_SERVICES = Object.freeze(['sessions', 'sessionController', 'workspaceRegistry']);

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
	 * 订阅四类官方事件。会话归属过滤只在本视图绑定会话时生效（第 1 章 §4.2 异会话隔离）。
	 * 返回的解绑句柄只清理本视图的订阅，不取消 DSH 会话。
	 */
	follow(sessionId, onEvent) {
		this.sessionId = sessionId;
		const forward = event => {
			this.seq += 1;
			onEvent(event);
		};
		this.disposers.push(this.ctx.on('session/event', (subject, event) => {
			const id = subject && subject.id;
			if (sessionId !== undefined && typeof id === 'string' && id !== sessionId) {
				return;
			}
			forward(event);
		}));
		this.disposers.push(this.ctx.on('agent/assistant-stream', payload => {
			const agent = payload && payload.agent;
			const id = agent && agent.session && agent.session.id;
			if (sessionId !== undefined && typeof id === 'string' && id !== sessionId) {
				return;
			}
			const frame = payload && payload.frame;
			const text = frame && frame.type === 'chunk' && frame.chunk && typeof frame.chunk.text === 'string' ? frame.chunk.text : undefined;
			if (text === undefined) {
				return;
			}
			forward({ type: 'assistant.delta', text });
		}));
		this.disposers.push(this.ctx.on('approval/request', (request, next) => this.answer('approval', request, next)));
		this.disposers.push(this.ctx.on('user-questions/request', (request, next) => this.answer('question', request, next)));
		return { dispose: () => this.disposeSubscriptions() };
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

/** 只把界面需要的字段送出去，DSH 私有对象（agent / signal / provider 流）不透传。 */
function describeRequest(kind, request) {
	if (kind === 'approval') {
		return {
			toolName: typeof request.toolName === 'string' ? request.toolName : '',
			...(typeof request.callId === 'string' ? { callId: request.callId } : {}),
			...(typeof request.reason === 'string' ? { reason: request.reason } : {}),
		};
	}
	const questions = Array.isArray(request.questions) ? request.questions : [];
	return {
		questions: questions.map(question => ({
			id: String(question.id ?? ''),
			...(typeof question.question === 'string' ? { question: question.question } : {}),
			...(Array.isArray(question.options) ? { options: question.options.map(option => ({ label: String(option.label ?? '') })) } : {}),
			...(question.multiSelect === true ? { multiSelect: true } : {}),
		})),
	};
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
	 * Host 半身进程内直调 `commands.execute(agent, line, [], signal)`：
	 * `agent` 经 `agents.get(sessionId)` 解析，`signal` 自给（Gateway 路径由框架注入，
	 * 进程内直调无框架信号），attachments 恒 `[]`（§8.10.10 前置④⑤）。
	 * 结果经共享 `mapDshIdeCommandExecution` 收敛为动作类语义，不静默 accepted。
	 */
	const executeCommandLine = async line => {
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
		const signal = new AbortController().signal;
		const execution = await commands.execute(agent, line, [], signal);
		const outcome = mapDshIdeCommandExecution(execution);
		if ('error' in outcome) {
			throw coded(outcome.error === 'invalid-argument' ? INVALID_ARGUMENT : FEATURE_UNAVAILABLE, outcome.message, { capability: 'runCommand' });
		}
		return { accepted: true };
	};

	return {
		async submit(args) {
			await controller().prompt({
				requestId: randomUUID(),
				sessionId: requireSession(),
				mode: 'queue',
				content: [{ type: 'text', text: args.text }],
			});
			return { accepted: true };
		},
		async interrupt() {
			await controller().cancel({ sessionId: requireSession() });
			return { accepted: true };
		},
		async resume(args) {
			bridge.assertOwnership(args.sessionId);
			if (args.sessionId !== undefined) {
				await controller().state({ sessionId: args.sessionId });
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
			return { accepted: true };
		},
		async fork(args) {
			bridge.assertOwnership(args.sessionId);
			await controller().fork({ sessionId: args.sessionId });
			return { accepted: true };
		},
		rewind: missing('rewind'),
		loadOlder: missing('loadOlder'),
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
			const value = await controller().projections({ sessionId });
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
			// 契约 `command` 为不带前导斜杠的命令名，`args` 单空格拼入 rawInput。
			return executeCommandLine(buildDshIdeCommandLine(args.command, args.args));
		},
		async listSessions() {
			const sessionId = bridge.sessionId;
			const channelId = bridge.channelId;
			if (sessionId === undefined || sessionId === '') {
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
				if (bridge.sessionId !== sessionId || bridge.channelId !== channelId) {
					throw coded(SESSION_SWITCHED, 'DSH-IDE session changed while listing sessions');
				}
				return projectDshIdeSessionList(sessionId, service(bridge.ctx, 'workspaceRegistry').list(), value.items);
			} finally {
				bridge._sessionReads.delete(cancel);
			}
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
			// 折叠行全文由 IDE 侧投影器缓存（第 2 章 E9）；Host 侧不持有第二份全文。
			return null;
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
			// §8.10.11：官方 workspace-controller 的公开 remote，不需第三方插件批准。
			// 不传 stopActivity：是否强停运行中的会话由调用方显式决定，缺省时保留官方的
			// `workspace/session-active` 拒绝并原样透传，DSH-IDE 不自行决定强停。
			bridge.assertOwnership(args.sessionId);
			const registry = service(bridge.ctx, 'workspaceRegistry');
			if (typeof registry.archiveSession !== 'function') {
				throw coded(FEATURE_UNAVAILABLE, 'DSH workspaceRegistry has no archiveSession()', { capability: 'archiveSession' });
			}
			return projectDshIdeArchiveSet(await registry.archiveSession({ sessionId: args.sessionId }));
		},
		async unarchiveSession(args) {
			bridge.assertOwnership(args.sessionId);
			const registry = service(bridge.ctx, 'workspaceRegistry');
			if (typeof registry.unarchiveSession !== 'function') {
				throw coded(FEATURE_UNAVAILABLE, 'DSH workspaceRegistry has no unarchiveSession()', { capability: 'unarchiveSession' });
			}
			return projectDshIdeArchiveSet(await registry.unarchiveSession({ sessionId: args.sessionId }));
		},
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

function splitModel(model) {
	const slash = model.indexOf('/');
	return slash <= 0 ? ['deepseek', model] : [model.slice(0, slash), model.slice(slash + 1)];
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
 * 官方信号：`sessionController.state({ sessionId })` 返回 `SessionState.running`
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
		const value = await controller.state({ sessionId });
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
 * 依据（E:/deepseek-harness-0.2.2-rc.1）：
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
