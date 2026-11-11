/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P3：`DshIdeBackend` 的唯一真实端口——IDE 侧官方客户端传输适配。
//
// 为什么在这里：`boundary` 门禁要求 `platform/dshClient/common` 与 `electron-main` 零
// `@deepseek-ai/*` 引用（第 1 章 §3 分层）。本文件放在 `platform/dshClient/transport/`。
//
// 为什么不 import `@deepseek-ai/dsh-client-connection`：手册 §8.2.5 已实测插件 `runtime/app`
// **不含** `@deepseek-ai/*` 包（它们只在 DSH 宿主 asar 里，IDE 进程不可达）。因此这里按
// 官方线协议（第 2 章 §2.2.1 冻结的四个形态）手写最小客户端，只依赖 fetch/WebSocket，
// 不复制业务逻辑、不引入第二套协议。
//
// 它只做传输，不做业务：连接 / 一元调用 / 流式调用 / waterfall 决议四条原语，
// 事件翻译与投影仍由 `common/translator.ts` + `IdeViewProjector` 完成（单一实现）。
//
// 线上形态见 docs/DEVELOPMENT.md 第 2 章 §2.2.1：
//   鉴权   GET /?token=…            → 303 + set-cookie（官方 launch token 交换）
//   一元   POST /api/<ns>/<method>  → { type:'client-request', rpcId, method, payload:{args} }
//   流式   WS  /api/remote.mux      → { type:'open', streamId, endpoint, payload:{args} }
//   waterfall WS item → POST /api/$events/result → { clientId, eventId, outcome }
//
// **`args` 的键必须等于服务方法的形参名**（Typert 按 descriptor 逐字段校验，不是自由对象）：
// 例如 `session/list(_request, signal)` 要传 `{ _request: {...} }`，`session/prompt(request, signal)`
// 要传 `{ request: {...} }`。`signal` 由 Host 侧注入，客户端不传。真机实测：
// 传自由字段会得到 `gateway/arguments-invalid: missing "_request"`。

import type { DshIdeBackend, DshIdeMethod, DshIdeOpenSpec, IDshIdeSessionSummary } from '../common/dshIdeProtocol.js';
import { projectDshIdeSessionList } from '../common/dshIdeSessionList.js';
import { projectDshIdeCommandList } from '../common/dshIdeCommandList.js';
import { buildDshIdeCommandLine, mapDshIdeCommandExecution } from '../common/dshIdeCommandLine.js';
import { projectDshIdeArchiveSet } from '../common/dshIdeArchiveSet.js';
import { safeErrorText } from '../common/dshIdeAuthRedaction.js';

/** 通道 id：由 Host 侧绑定生成，这里只做透传。 */
type ChannelBinding = { readonly channelId: string; readonly sessionId?: string };

/** 一条打开的 WebSocket 连接（只取本适配用到的四个能力）。 */
export interface DshIdeWebSocket {
	readonly readyState: number;
	send(data: string): void;
	close(code?: number, reason?: string): void;
	addEventListener(event: 'open' | 'error' | 'close', listener: (payload: unknown) => void): void;
	addEventListener(event: 'message', listener: (payload: { readonly data: unknown }) => void): void;
}

/** 官方传输的最小原生能力：fetch 与 WebSocket（IDE 主进程用 Electron/Node 全局）。 */
export interface DshIdeTransportPrimitives {
	readonly fetch: (input: string | URL, init: RequestInit) => Promise<Response>;
	readonly WebSocket: new (url: string, options?: { headers?: Record<string, string> }) => DshIdeWebSocket;
}

/** 连接配置：Host origin + 已换取的 cookie。 */
export interface DshIdeTransportOptions {
	/** Host origin，例如 `http://127.0.0.1:51234`。 */
	readonly origin: string;
	/** 官方 launch token 交换后得到的 cookie（`name=value`）。 */
	readonly cookie: string;
	/** 原生传输能力；默认取全局 fetch / WebSocket。 */
	readonly primitives?: DshIdeTransportPrimitives;
}

/** 统一的传输错误：保留官方错误码，便于上层映射 FEATURE_UNAVAILABLE / INVALID_ARGUMENT。 */
export class DshIdeTransportError extends Error {
	readonly code: string;
	readonly details: unknown;

	constructor(code: string, message: string, details?: unknown) {
		super(message);
		this.name = 'DshIdeTransportError';
		this.code = code;
		this.details = details;
	}
}

interface RpcEnvelope {
	readonly type: 'server-response';
	readonly rpcId: string;
	readonly result: { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: { code: string; message: string; details?: unknown } };
}

/** 官方 launch token 交换：`GET /?token=…` → `303` + `set-cookie`。 */
export async function authenticateHost(origin: string, launchUrl: string, primitives?: DshIdeTransportPrimitives): Promise<string> {
	const doFetch = primitives?.fetch ?? ((input: string | URL, init: RequestInit) => fetch(input, init));
	let status: number;
	let cookie: string | null;
	try {
		// D55：异常路径必须脱敏——fetch 抛出的错误可能含完整 launchUrl（带 token）。
		const response = await doFetch(launchUrl, { redirect: 'manual' });
		status = response.status;
		cookie = response.headers.get('set-cookie');
		await response.body?.cancel();
	} catch (error) {
		throw new DshIdeTransportError('dsh-ide/host-authentication-failed',
			`Host authentication failed at ${safeErrorText(origin)}: ${safeErrorText(error)}`);
	}
	if (status !== 303 || cookie === null) {
		// D55：错误文案只带脱敏 origin 与状态码，绝不回显 launchUrl / token。
		throw new DshIdeTransportError('dsh-ide/host-authentication-failed', `Host authentication failed at ${safeErrorText(origin)} (status ${status})`);
	}
	const end = cookie.indexOf(';');
	return end < 0 ? cookie : cookie.slice(0, end);
}

/**
 * 事件流帧：`session/follow`、`workspace/follow` 的 item，或 Gateway 转发的 waterfall / 取消帧。
 * 全部 shape 按线上原样保留（翻译在 common/translator.ts）。
 */
export type DshIdeStreamFrame =
	| { readonly type: 'snapshot' | 'event' | 'assistant-stream'; readonly [key: string]: unknown }
	| { readonly type: 'baseline'; readonly value: { readonly items: readonly { readonly workspaceId: string; readonly sessionIds: readonly string[] }[] } }
	| { readonly type: 'waterfall'; readonly eventId: string; readonly event: string; readonly agentId: string; readonly request: Readonly<Record<string, unknown>> }
	| { readonly type: 'cancel'; readonly eventId: string }
	| { readonly type: 'ready'; readonly clientId: string; readonly host?: Readonly<Record<string, unknown>> };

/** 界面决议：`next` 交还下一个 answerer，`result` 提交答案。 */
export type DshIdeDecision = { readonly kind: 'next' } | { readonly kind: 'result'; readonly value?: unknown };

/**
 * 官方客户端传输适配。一个实例对应一个 Host origin + 一条 cookie；
 * 所有方法都只用官方端点，不存在私有握手（第 7 章 §3.1 裁定）。
 */
export class DshIdeTransport {
	private readonly origin: string;
	private readonly cookie: string;
	private readonly primitives: DshIdeTransportPrimitives;
	private socket: DshIdeWebSocket | undefined;
	/** socket 已 open 前暂存的出站帧：`send()` 在 CONNECTING 状态会抛 InvalidStateError。 */
	private outbox: string[] = [];
	/** 每个 streamId 的下行回调。 */
	private readonly streams = new Map<string, { onFrame: (frame: DshIdeStreamFrame) => void; onError: (error: DshIdeTransportError) => void; onEnd?: () => void }>();
	/** 显式可取消的读取；断线或释放时连同未完成的响应读取一起结算。 */
	private readonly _pendingCalls = new Set<AbortController>();
	/** `$events` 流的 clientId（waterfall 决议要用它回投）。 */
	private eventClientId: string | undefined;

	constructor(options: DshIdeTransportOptions) {
		this.origin = options.origin.replace(/\/$/, '');
		this.cookie = options.cookie;
		this.primitives = options.primitives ?? {
			fetch: (input, init) => fetch(input, init),
			WebSocket: WebSocket as unknown as DshIdeTransportPrimitives['WebSocket'],
		};
	}

	/**
	 * 一元调用：官方 `client-request` 信封 + cookie，返回 `result.value`。
	 * @param args - **形参名 → 值**的映射（不是自由字段）；见文件头说明。
	 */
	async call(namespace: string, method: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
		if (signal === undefined) {
			return this._callRemote(namespace, method, args);
		}
		signal.throwIfAborted();
		const controller = new AbortController();
		const cancel = () => controller.abort(signal.reason);
		let rejectCancellation: (reason: unknown) => void = () => undefined;
		const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
		const onAbort = () => rejectCancellation(controller.signal.reason);
		controller.signal.addEventListener('abort', onAbort, { once: true });
		signal.addEventListener('abort', cancel, { once: true });
		this._pendingCalls.add(controller);
		try {
			return await Promise.race([this._callRemote(namespace, method, args, controller.signal), cancellation]);
		} finally {
			this._pendingCalls.delete(controller);
			signal.removeEventListener('abort', cancel);
			controller.signal.removeEventListener('abort', onAbort);
		}
	}

	private async _callRemote(namespace: string, method: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
		const endpoint = `${namespace}/${method}`;
		const rpcId = crypto.randomUUID();
		const body = JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } });
		const response = await this.primitives.fetch(`${this.origin}/api/${endpoint}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', cookie: this.cookie },
			body,
			signal,
		});
		if (!response.ok) {
			throw new DshIdeTransportError('dsh-ide/transport-failure', `transport failure for ${endpoint}: HTTP ${response.status}`);
		}
		const envelope = (await response.json()) as RpcEnvelope;
		if (envelope.type !== 'server-response' || envelope.rpcId !== rpcId) {
			throw new DshIdeTransportError('dsh-ide/transport-corrupt', `rpcId mismatch for ${endpoint}`);
		}
		if (!envelope.result.ok) {
			throw new DshIdeTransportError(envelope.result.error.code, envelope.result.error.message, envelope.result.error.details);
		}
		return envelope.result.value;
	}

	/** 打开一条逻辑流（`session/follow` 等），帧经 `onFrame` 原样回调。 */
	openStream(endpoint: string, args: Record<string, unknown>, onFrame: (frame: DshIdeStreamFrame) => void, onError?: (error: DshIdeTransportError) => void, onEnd?: () => void): { streamId: string; close(): void } {
		const streamId = crypto.randomUUID();
		// 建立 socket（若尚未建立）；具体发送由 sendWhenOpen 排队，不直接用返回值。
		this.ensureSocket();
		this.streams.set(streamId, { onFrame, onError: onError ?? (() => undefined), onEnd });
		try {
			this.sendWhenOpen(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args } }));
		} catch (error) {
			this.streams.delete(streamId);
			throw error;
		}
		return {
			streamId,
			close: () => {
				if (!this.streams.delete(streamId)) {
					return;
				}
				this.sendWhenOpen(JSON.stringify({ type: 'cancel', streamId }));
			},
		};
	}

	/** waterfall 决议回投：`next` 或具体结果，经 `$events/result` 一元端点。 */
	async answerWaterfall(eventId: string, decision: DshIdeDecision): Promise<void> {
		if (this.eventClientId === undefined) {
			throw new DshIdeTransportError('dsh-ide/event-stream-not-ready', 'forwarded-event stream has no clientId yet');
		}
		await this.call('$events', 'result', {
			clientId: this.eventClientId,
			eventId,
			outcome: decision,
		});
	}

	/** 关闭全部逻辑流与物理 socket。 */
	dispose(): void {
		const socket = this.socket;
		this.socket = undefined;
		this._failPending(new DshIdeTransportError('dsh-ide/stream-closed', 'DSH-IDE transport disposed'));
		socket?.close(1000, 'dsh-ide transport disposed');
	}

	private _failPending(error: DshIdeTransportError): void {
		const streams = [...this.streams.values()];
		this.streams.clear();
		this.outbox = [];
		this.eventClientId = undefined;
		for (const controller of this._pendingCalls) {
			controller.abort(error);
		}
		for (const sink of streams) {
			sink.onError(error);
		}
	}

	private ensureSocket(): DshIdeWebSocket {
		if (this.socket !== undefined && this.socket.readyState <= 1) {
			return this.socket;
		}
		if (this.socket !== undefined) {
			// 关闭事件可能尚未送达；替换前先结算旧代，避免旧流被新 socket 遗留。
			this.socket = undefined;
			this._failPending(new DshIdeTransportError('dsh-ide/stream-closed', 'Remote stream socket is no longer open'));
		}
		const url = `${this.origin.replace(/^http/, 'ws')}/api/remote.mux`;
		const socket = new this.primitives.WebSocket(url, { headers: { cookie: this.cookie } });
		const disconnect = (error: DshIdeTransportError) => {
			if (this.socket !== socket) {
				return;
			}
			this.socket = undefined;
			this._failPending(error);
		};
		socket.addEventListener('open', () => {
			if (this.socket === socket) {
				this.flushOutbox();
			}
		});
		socket.addEventListener('message', payload => {
			if (this.socket === socket) {
				this.receive(payload.data);
			}
		});
		socket.addEventListener('error', () => {
			disconnect(new DshIdeTransportError('dsh-ide/stream-error', 'Remote stream socket failed'));
			socket.close();
		});
		socket.addEventListener('close', () => disconnect(new DshIdeTransportError('dsh-ide/stream-closed', 'Remote stream socket closed')));
		this.socket = socket;
		return socket;
	}

	/** 已 open 就直接发；CONNECTING 时入队，等 open 事件后按序 flush。 */
	private sendWhenOpen(frame: string): void {
		const socket = this.socket;
		if (socket !== undefined && socket.readyState === 1) {
			socket.send(frame);
			return;
		}
		this.outbox.push(frame);
	}

	private flushOutbox(): void {
		const socket = this.socket;
		if (socket === undefined || socket.readyState !== 1) {
			return;
		}
		const pending = this.outbox;
		this.outbox = [];
		for (const frame of pending) {
			socket.send(frame);
		}
	}

	private receive(data: unknown): void {
		if (typeof data !== 'string') {
			return;
		}
		let message: Record<string, unknown>;
		try {
			message = JSON.parse(data) as Record<string, unknown>;
		} catch {
			return;
		}
		const streamId = message['streamId'];
		if (typeof streamId !== 'string') {
			return;
		}
		const sink = this.streams.get(streamId);
		if (sink === undefined) {
			return;
		}
		if (message['type'] === 'item') {
			const value = message['value'];
			if (isFrame(value)) {
				if (value.type === 'ready') {
					this.eventClientId = value.clientId;
				}
				sink.onFrame(value);
			}
			return;
		}
		if (message['type'] === 'end') {
			this.streams.delete(streamId);
			sink.onEnd?.();
			return;
		}
		if (message['type'] === 'error') {
			this.streams.delete(streamId);
			const error = message['error'];
			const code = isRecord(error) && typeof error['code'] === 'string' ? error['code'] : 'dsh-ide/stream-error';
			const text = isRecord(error) && typeof error['message'] === 'string' ? error['message'] : 'Remote stream failed';
			sink.onError(new DshIdeTransportError(code, text, isRecord(error) ? error['details'] : undefined));
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFrame(value: unknown): value is DshIdeStreamFrame {
	if (!isRecord(value) || typeof value['type'] !== 'string') {
		return false;
	}
	if (value['type'] === 'waterfall') {
		return typeof value['eventId'] === 'string' && typeof value['event'] === 'string';
	}
	if (value['type'] === 'ready') {
		return typeof value['clientId'] === 'string';
	}
	return true;
}

/**
 * 把官方传输包装成 `DshIdeBackend`：`open` 绑定会话、`follow` 打开 `session/follow` 逻辑流、
 * `invoke` 按 method 映射到官方一元端点、`close` 释放本视图的流。
 *
 * 映射表与 Host 半身（`host/ide-view-host.js`）保持同一组官方方法名；未核对的 method
 * 明确抛 `dsh-ide/feature-unavailable`，与 Host 侧口径一致，不猜端点。
 */
export class DshIdeTransportBackend implements DshIdeBackend {
	private readonly transport: DshIdeTransport;
	private channelId: string | undefined;
	private sessionId: string | undefined;
	/** 绑定会话期间同时存在的两条逻辑流：`$events`（waterfall 入口）与 `session/follow`（会话内容）。 */
	private readonly streams = new Set<{ streamId: string; close(): void }>();
	private readonly _sessionListReads = new Set<AbortController>();

	constructor(transport: DshIdeTransport) {
		this.transport = transport;
	}

	open(spec: DshIdeOpenSpec): ChannelBinding {
		if (this.channelId !== undefined) {
			return { channelId: this.channelId, sessionId: this.sessionId };
		}
		const params = spec.params ?? {};
		this.sessionId = typeof params['sessionId'] === 'string' ? params['sessionId'] : undefined;
		this.channelId = `dsh-ide:${crypto.randomUUID()}`;
		return { channelId: this.channelId, sessionId: this.sessionId };
	}

	follow(sessionId: string | undefined, onEvent: (raw: unknown) => void): { dispose(): void } {
		// §8.10.3 缺口②：有绑定会话时**两条流都要开**——`$events` 承载 Gateway 转发的
		// waterfall（审批 / 问卷）与取消帧，`session/follow` 承载会话内容；只开后者会让
		// 审批 / 问卷请求永远到不了 IDE。两流各自保留官方 Gateway ACL。
		const events = this.followEvents(onEvent);
		if (sessionId === undefined) {
			return events;
		}
		// `follow(request, signal)`：形参名是 `request`。
		const content = this.transport.openStream('session/follow', {
			request: {
				address: { kind: 'session', sessionId },
				assistantStream: true,
			},
		}, frame => onEvent(frame));
		this.streams.add(content);
		return {
			dispose: () => {
				content.close();
				this.streams.delete(content);
				events.dispose();
			},
		};
	}

	/** 只订阅 Gateway 转发的事件（waterfall 决议入口在这里）。 */
	followEvents(onEvent: (raw: unknown) => void): { dispose(): void } {
		const stream = this.transport.openStream('$events', {}, frame => onEvent(frame));
		this.streams.add(stream);
		return {
			dispose: () => {
				stream.close();
				this.streams.delete(stream);
			},
		};
	}

	async invoke(method: DshIdeMethod, args: unknown): Promise<unknown> {
		const record = isRecord(args) ? args : {};
		const sessionId = this.sessionId;
		// 每个调用的键名 = 服务方法的形参名（见文件头：传自由字段会被 gateway/arguments-invalid 拒绝）。
		switch (method) {
			case 'submit':
				await this.transport.call('session', 'prompt', {
					request: {
						requestId: crypto.randomUUID(),
						sessionId,
						mode: 'queue',
						content: [{ type: 'text', text: String(record['text'] ?? '') }],
					},
				});
				return { accepted: true };
			case 'interrupt':
				await this.transport.call('session', 'cancel', { request: { sessionId } });
				return { accepted: true };
			case 'resume':
				return this.transport.call('session', 'state', {
					request: { address: { kind: 'session', sessionId: record['sessionId'] ?? sessionId } },
				});
			case 'newSession':
				return this.transport.call('session', 'create', {
					request: {
						...(typeof record['workspace'] === 'string' ? { cwd: record['workspace'] } : {}),
					},
				});
			case 'fork':
				return this.transport.call('session', 'fork', {
					request: {
						sessionId: record['sessionId'] ?? sessionId,
						...(typeof record['point'] === 'string' && record['point'] !== '' ? { atSeq: Number(record['point']) } : {}),
					},
				});
			case 'answerApproval':
				await this.transport.answerWaterfall(String(record['requestId']), {
					kind: 'result',
					value: record['decision'] === 'approve' ? 'allowed-once' : 'rejected',
				});
				return { accepted: true };
			case 'answerQuestion':
				await this.transport.answerWaterfall(String(record['requestId']), { kind: 'result', value: record['answer'] });
				return { accepted: true };
			case 'cancelRequest':
				await this.transport.answerWaterfall(String(record['requestId']), { kind: 'next' });
				return { accepted: true };
			case 'setModel': {
				const [provider, model] = splitModel(String(record['model'] ?? ''));
				return this.transport.call('session', 'selectModel', { request: { sessionId, provider, model } });
			}
			case 'setEffort': {
				// D13/D16：官方无独立 setEffort remote；effort 是 session/selectModel 的
				// reasoningEffort 字段（§8.10.9）。当前 provider/model 从 session/projections
				// 的 modelSelection.next wire view 读取，避免凭记忆猜路由。
				const effort = String(record['effort'] ?? '');
				if (effort === '') {
					throw new DshIdeTransportError('dsh-ide/invalid-argument', 'setEffort.effort must be a non-empty string');
				}
				const projected = await this.transport.call('session', 'projections', { request: { sessionId } });
				const values = isRecord(projected) && isRecord(projected['values']) ? projected['values'] : undefined;
				const modelSelection = values !== undefined && isRecord(values['modelSelection']) ? values['modelSelection'] : undefined;
				const selection = modelSelection !== undefined && isRecord(modelSelection['next']) ? modelSelection['next'] : undefined;
				if (selection === undefined || typeof selection['provider'] !== 'string' || typeof selection['model'] !== 'string') {
					// 无当前模型则无法只改 effort：明确拒绝，不伪造默认路由，不悄悄降级成 setModel。
					throw new DshIdeTransportError('dsh-ide/feature-unavailable', 'setEffort requires a current model selection');
				}
				return this.transport.call('session', 'selectModel', {
					request: {
						sessionId,
						provider: selection['provider'],
						model: selection['model'],
						reasoningEffort: effort,
					},
				});
			}
			case 'listSessions':
				return this._listSessions();
			case 'listModels': {
				// `modelCatalog()` 无参数；Host 给 `{ groups: [{ id, models: [...] }] }`。
				const catalog = await this.transport.call('session', 'modelCatalog', {});
				const groups = isRecord(catalog) && Array.isArray(catalog['groups']) ? catalog['groups'] : [];
				const models: { provider: string; model: string; name?: string }[] = [];
				for (const group of groups) {
					if (!isRecord(group)) {
						continue;
					}
					const provider = String(group['id'] ?? '');
					for (const model of (Array.isArray(group['models']) ? group['models'] : [])) {
						if (!isRecord(model)) {
							continue;
						}
						models.push({
							provider,
							model: String(model['id'] ?? ''),
							...(typeof model['name'] === 'string' ? { name: model['name'] } : {}),
						});
					}
				}
				return models;
			}
			case 'listCommands': {
				// D13（第 32 轮）：`commands/list` 是 agent-scoped remote，wire 形状
				// 由 §8.10.9 第 31 轮核实——args 精确为 { agentId: sessionId }，
				// `agentId` = 绑定 sessionId（core/agent 的 agent Context identity）。
				// 无绑定会话时不发请求，返回空列表（与 listSessions 的 fail-closed 口径一致）。
				if (this.sessionId === undefined) {
					return [];
				}
				const descriptors = await this.transport.call('commands', 'list', { agentId: this.sessionId });
				return projectDshIdeCommandList(descriptors);
			}
			case 'fetchRowDetail':
				return null;
			case 'accountGetState':
				// 官方 `account/getState`：无参，返回 `AccountView`（status/links/attempt）。
				return this.transport.call('account', 'getState', {});
			case 'accountGetProfile':
				// 官方 `account/getProfile(client)`：形参名是 `client`（不是 request）。
				return this.transport.call('account', 'getProfile', { client: record['client'] });
			case 'refreshSnapshot':
				return { accepted: true };
			case 'deleteSession':
				// 删除由社区插件 `@michengai/dsh-archive-manager@1.3.1` 注册的
				// `workspaceRegistry/deleteSession` 承担（§8.10.8 批准范围）；DSH-IDE 只调用，
				// 不复制其删除链、不直接删 DSH 会话目录。
				return this.deleteSessionViaPlugin(String(record['sessionId'] ?? ''));
			case 'archiveSession':
				// §8.10.11：官方 workspace-controller 的公开 remote；不传 stopActivity，
				// 保留官方 `workspace/session-active` 拒绝并原样透传。
				return projectDshIdeArchiveSet(await this.transport.call('workspaceRegistry', 'archiveSession', {
					request: { sessionId: String(record['sessionId'] ?? '') },
				}));
			case 'unarchiveSession':
				return projectDshIdeArchiveSet(await this.transport.call('workspaceRegistry', 'unarchiveSession', {
					request: { sessionId: String(record['sessionId'] ?? '') },
				}));
			case 'setPermissionPreset': {
				// §8.10.9：官方无独立 setter，`/permission <preset>` 是注册的斜杠命令。
				return this._runCommandLine(buildDshIdeCommandLine('permission', [String(record['preset'] ?? '')]));
			}
			case 'runCommand': {
				const args = Array.isArray(record['args']) ? record['args'].map(String) : undefined;
				return this._runCommandLine(buildDshIdeCommandLine(String(record['command'] ?? ''), args));
			}
			case 'rewind':
			case 'loadOlder':
				throw new DshIdeTransportError('dsh-ide/feature-unavailable', `DSH-IDE capability "${method}" has no verified DSH endpoint yet`, { capability: method });
			default:
				throw new DshIdeTransportError('dsh-ide/feature-unavailable', `DSH-IDE method ${JSON.stringify(method)} is not mapped`);
		}
	}

	/** P4：每次读取官方可见会话与工作区首帧，归属和字段映射复用共享投影。 */
	private async _listSessions(): Promise<readonly IDshIdeSessionSummary[]> {
		const sessionId = this.sessionId;
		const channelId = this.channelId;
		if (channelId === undefined || sessionId === undefined || sessionId === '') {
			return [];
		}
		const read = new AbortController();
		this._sessionListReads.add(read);
		let stream: ReturnType<DshIdeTransport['openStream']> | undefined;
		let cancelBaseline: () => void = () => undefined;
		try {
			const baseline = new Promise<Extract<DshIdeStreamFrame, { type: 'baseline' }>['value']['items']>((resolve, reject) => {
				cancelBaseline = () => reject(read.signal.reason);
				read.signal.addEventListener('abort', cancelBaseline, { once: true });
				stream = this.transport.openStream('workspace/follow', {}, frame => {
					if (frame.type !== 'baseline') {
						reject(new DshIdeTransportError('dsh-ide/transport-corrupt', 'Workspace stream did not begin with a baseline'));
						return;
					}
					resolve(frame.value.items);
				}, reject, () => reject(new DshIdeTransportError('dsh-ide/stream-ended', 'Workspace stream ended before its baseline')));
			}).finally(() => stream?.close());
			// 两个官方端点各自保留 Gateway ACL；临时流不占用 Chat 的 this.stream。
			const [value, workspaces] = await Promise.all([
				this.transport.call('session', 'list', { _request: {} }, read.signal),
				baseline,
			]);
			read.signal.throwIfAborted();
			if (this.channelId !== channelId || this.sessionId !== sessionId) {
				throw new DshIdeTransportError('SESSION_SWITCHED', 'Session list binding changed during the read');
			}
			// 版本绑定承担官方载荷兼容性，不在这里另建运行时 schema。
			const { items } = value as { readonly items: Parameters<typeof projectDshIdeSessionList>[2] };
			return projectDshIdeSessionList(sessionId, workspaces.map(workspace => ({ id: workspace.workspaceId, sessionIds: workspace.sessionIds })), items);
		} finally {
			this._sessionListReads.delete(read);
			read.signal.removeEventListener('abort', cancelBaseline);
			read.abort();
			stream?.close();
		}
	}

	/**
	 * 调用社区插件暴露的删除端点，并把「插件缺失 / 方法不可用」映射为契约错误码。
	 *
	 * 端点名与插件版本以 `common/dshIdeProtocol.ts` 的 `DSH_IDE_DELETE_SESSION_ENDPOINT` /
	 * `DSH_IDE_DELETE_SESSION_PLUGIN_VERSION` 为真源；本文件只用字面量发起调用，因为
	 * `transport/` 由 node --experimental-strip-types 直接加载（值导入 `.js` 说明符无法解析），
	 * 漂移由 `dshIdeProtocol.test.ts` 的端点一致性断言兜住。
	 *
	 * 三种降级都不伪造成功：网关报 `gateway/invocation-unavailable`（插件未注册该 endpoint）
	 * 或结果不是 `{ deleted: true }` 时一律拒绝，由调用方保留列表项并报告原因。
	 */
	/**
	 * D13（第 34 轮）：`runCommand` / `setPermissionPreset` 共用的官方命令执行。
	 * `commands/execute` 是 agent-scoped remote，wire 形状由 §8.10.9 第 31 轮核实：
	 * args 精确为 `{ agentId: sessionId, line, submittedAttachments: [] }`，
	 * `signal` 由 Gateway cancellation 承载、不入 args（§8.10.10 前置④⑤）。
	 * 结果经共享 `mapDshIdeCommandExecution` 收敛为动作类语义，不静默 accepted。
	 */
	private async _runCommandLine(line: string): Promise<{ accepted: true }> {
		if (this.sessionId === undefined) {
			throw new DshIdeTransportError('dsh-ide/invalid-argument', 'command execution requires a bound session', { capability: 'runCommand' });
		}
		const execution = await this.transport.call('commands', 'execute', {
			agentId: this.sessionId,
			line,
			submittedAttachments: [],
		});
		const outcome = mapDshIdeCommandExecution(execution);
		if ('error' in outcome) {
			throw new DshIdeTransportError(
				outcome.error === 'invalid-argument' ? 'dsh-ide/invalid-argument' : 'dsh-ide/feature-unavailable',
				outcome.message,
				{ capability: 'runCommand' },
			);
		}
		return { accepted: true };
	}

	private async deleteSessionViaPlugin(sessionId: string): Promise<{ accepted: true }> {
		let value: unknown;
		try {
			value = await this.transport.call('workspaceRegistry', 'deleteSession', { sessionId });
		} catch (error) {
			if (error instanceof DshIdeTransportError && error.code.startsWith('gateway/')) {
				throw new DshIdeTransportError(
					'dsh-ide/feature-unavailable',
					'session delete endpoint is unavailable: install and enable @michengai/dsh-archive-manager@1.3.1',
					{ capability: 'deleteSession', cause: error.code },
				);
			}
			throw error;
		}
		if (!isRecord(value) || value['deleted'] !== true) {
			throw new DshIdeTransportError('dsh-ide/feature-unavailable', `session delete did not confirm deletion for ${sessionId}`, { capability: 'deleteSession' });
		}
		return { accepted: true };
	}

	close(): void {
		this.channelId = undefined;
		this.sessionId = undefined;
		for (const read of this._sessionListReads) {
			read.abort(new DshIdeTransportError('SESSION_SWITCHED', 'Session list binding closed during the read'));
		}
		this._sessionListReads.clear();
		for (const stream of this.streams) {
			stream.close();
		}
		this.streams.clear();
		this.transport.dispose();
	}
}

function splitModel(model: string): [string, string] {
	const slash = model.indexOf('/');
	return slash <= 0 ? ['deepseek', model] : [model.slice(0, slash), model.slice(slash + 1)];
}
