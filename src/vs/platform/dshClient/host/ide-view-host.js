// src/vs/platform/dshClient/host/ide-view-host.js
// DSH-IDE Host 半身：在 DSH Host 进程内把官方事件与官方服务桥接给 IDE 主进程。
//
// 职责边界（第 1 章 §3）：本文件是唯一允许持有插件上下文、订阅 DSH 官方事件的插件侧代码。
// 它只做三件事：订阅四类官方事件并原样转发、注册唯一的交互式 answerer、把 20 个 DTO method
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

/** 与 common/dshIdeProtocol.ts 同值的错误码（Host 半身为纯 JS，不跨层 import TS）。 */
export const FEATURE_UNAVAILABLE = 'dsh-ide/feature-unavailable';
export const INVALID_ARGUMENT = 'dsh-ide/invalid-argument';
export const ALREADY_RESOLVED = 'ALREADY_RESOLVED';
export const SESSION_SWITCHED = 'SESSION_SWITCHED';

/** 本桥接依赖的官方服务（缺任一即按 feature-unavailable 拒绝）。 */
export const REQUIRED_SERVICES = Object.freeze(['sessions', 'sessionController']);

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
 * 20 个 DTO method → 官方服务调用（唯一分发点，入参已过 validateDshIdeInput）。
 *
 * 结果语义（第 2 章 §4）：动作类 `{ accepted: true }`；列表类数组；详情类 `string | null`。
 * 尚未核对到官方公开接口的能力以 feature-unavailable 明确拒绝并写明缺口，不猜方法名。
 */
function createMethodHandlers(bridge) {
	const controller = () => service(bridge.ctx, 'sessionController');
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
		setEffort: missing('setEffort'),
		setPermissionPreset: missing('setPermissionPreset'),
		runCommand: missing('runCommand'),
		async listSessions() {
			const value = await controller().list({});
			const items = Array.isArray(value && value.items) ? value.items : [];
			return items.map(item => ({
				sessionId: String(item.sessionId ?? ''),
				...(typeof item.title === 'string' ? { title: item.title } : {}),
			}));
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
		listCommands: missing('listCommands'),
		async fetchRowDetail() {
			// 折叠行全文由 IDE 侧投影器缓存（第 2 章 E9）；Host 侧不持有第二份全文。
			return null;
		},
		async refreshSnapshot() {
			bridge.emitToUi({ type: 'refresh' });
			return { accepted: true };
		},
		async deleteSession(args) {
			bridge.assertOwnership(args.sessionId);
			const sessions = service(bridge.ctx, 'sessions');
			const target = typeof sessions.get === 'function' ? sessions.get(args.sessionId) : undefined;
			if (target === undefined) {
				throw coded(INVALID_ARGUMENT, `unknown session ${args.sessionId}`);
			}
			// DSH 的会话生命周期由拥有它的 fiber 决定：没有公开的物理删除接口时明确拒绝，
			// 不做「关闭视图冒充删除」。
			throw coded(FEATURE_UNAVAILABLE, 'DSH has no public physical session delete; refusing to fake it', { capability: 'deleteSession' });
		},
	};
}

function splitModel(model) {
	const slash = model.indexOf('/');
	return slash <= 0 ? ['deepseek', model] : [model.slice(0, slash), model.slice(slash + 1)];
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
