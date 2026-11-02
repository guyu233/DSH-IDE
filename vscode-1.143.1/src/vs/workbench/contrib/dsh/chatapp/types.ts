// chatapp/types.ts
// chat-only DSH 子应用的共享类型。全部按已装 DSH 0.2.1-rc.5 的真实契约定义（见 .build/rc5-contract.md）。
//
// 本文件不含运行时代码，仅类型/接口，供 boot、root 与 stubs 共用。

/** rc.5 SessionEvent 信封（wire-safe，原样渲染，绝不新增 type）。 */
export interface SessionEvent {
	/** 事件类型，如 'user/message' | 'assistant/message' | 'tool/call' | 'turn/end' … */
	type: string;
	/** 单调递增的会话序列号。 */
	seq: number;
	/** 事件时间戳（ms）。 */
	time: number;
	/** 事件负载（按 type 变化）。 */
	data: Record<string, unknown>;
	/** 未知类型读者可忽略的标记（仅存储层可写；子应用只读）。 */
	ignorable?: true;
	surfaceOp?: unknown;
	sourceEventSeqs?: number[];
}

/** 事件窗口条目：持久 event 或临时 assistant-live-chunk。 */
export type SessionEventLikeEntry =
	| { type: 'event'; event: SessionEvent }
	| { type: 'transient'; event: AssistantLiveChunkEvent };

/** assistant 实时流 chunk（transient，不入日志；settleAssistant 时按 attemptId 收敛）。 */
export interface AssistantLiveChunkEvent {
	type: 'assistant/live-chunk';
	data: Record<string, unknown> & { attemptId?: string };
}

/** MutableSessionEventSource 的窗口快照。 */
export interface SessionEventWindowSnapshot {
	readonly entries: SessionEventLikeEntry[];
	readonly hasMore: boolean;
	readonly revision: number;
	readonly change: unknown;
}

/** 会话事件源的最小契约（与 @deepseek-ai/dsh-api-session-controller 的 MutableSessionEventSource 一致）。 */
export interface IMutableSessionEventSource {
	getSnapshot(): SessionEventWindowSnapshot;
	subscribe(listener: () => void): () => void;
	replace(entries: SessionEventLikeEntry[], hasMore: boolean): void;
	prepend(entries: SessionEventLikeEntry[], hasMore: boolean): void;
	append(entry: SessionEventLikeEntry): void;
	settleAssistant(attemptId: string, entry?: SessionEventLikeEntry): void;
}

/** 子应用读取的会话面（binding.session）。ui-conversation/ui-chat 需要 loadOlder/loadThrough 等。 */
export interface ChatappSession {
	readonly id: string;
	readonly eventSource: IMutableSessionEventSource;
	/** 加载更早的历史分页（由 sessions 桩经 postMessage 请求 Host，再 prepend）。 */
	loadOlder(): void;
	/** 加载到指定 seq（回看/定位用）。 */
	loadThrough(seq: number): void;
}

/** sessions.binding(id) 的返回形状——这是 ui-chat / ui-conversation 消费的权威形状。 */
export interface SessionBinding {
	readonly sessionId: string;
	readonly session: ChatappSession;
	readonly eventSource: IMutableSessionEventSource;
	/** 该会话作用域的 client ctx（插件注册随其释放）。 */
	readonly ctx: ChatappContext;
}

/** 极简 client ctx 视图（只暴露 ui-* 用到的成员；其余通过 get(name) 取服务）。 */
export interface ChatappContext {
	get(name: string): unknown;
	effect(fn: () => void | (() => void), label?: string): () => void;
	on(event: string, listener: (...args: unknown[]) => void): () => void;
	plugin(plugin: unknown): { ctx: ChatappContext; dispose(): void };
	inject(deps: string[], fn: (ctx: ChatappContext) => void): void;
	reflect: { provide(name: string, value: unknown): void };
	/** 服务直挂（供 ui-* 以 ctx.<name> 读取）。 */
	sessions: SessionsService;
	remote: RemoteService;
	remoteAccess: RemoteAccessService;
	connection: ConnectionService;
	configForms: ConfigFormsService;
	uiWorkspace: UiWorkspaceService;
	uiSession: UiSessionService;
	locale: LocaleService;
	[key: string]: unknown;
}

/** sessions 服务面。 */
export interface SessionsService {
	binding(id: string): SessionBinding | undefined;
	list: { getSnapshot(): { byId: Record<string, SessionListRow> } };
	scope(id: string): ChatappContext | undefined;
	retainInfo(id: string): unknown;
	fork(id: string, seq?: number): Promise<{ sessionId: string }>;
}

export interface SessionListRow {
	id: string;
	displayTitle?: string;
	cwd?: string;
	running?: boolean;
	blank?: boolean;
	updatedAt?: number;
}

/** remote：载体无关的远程方法通道（经 webview postMessage，NOT http）。 */
export interface RemoteService {
	/** 调用一个 Host 侧方法（如 'session.list' / 'session.prompt'）。 */
	invoke<Req = unknown, Res = unknown>(method: string, payload?: Req): Promise<Res>;
}

/** remoteAccess：按 (session, action) 订阅远程源。 */
export interface RemoteAccessService {
	source(kind: string, sessionId: string, action: string): RemoteSource;
}

export interface RemoteSource {
	getSnapshot(): unknown;
	subscribe(listener: () => void): () => void;
}

/** connection：与 Host 的连接状态（经 postMessage 桥）。 */
export interface ConnectionService {
	getSnapshot(): ConnectionSnapshot;
	subscribe(listener: () => void): () => void;
	reconnect(): void;
}

export interface ConnectionSnapshot {
	status: 'connected' | 'connecting' | 'disconnected';
	hostPid?: number;
	pipe?: string;
}

/** configForms：配置表单服务（只读桩，developerTools 用于调试页）。 */
export interface ConfigFormsService {
	get(key: string): unknown;
	developerTools: { getSnapshot(): boolean; subscribe(listener: () => void): () => void };
}

/** uiWorkspace：工作区动作（经 postMessage 转 Host）。 */
export interface UiWorkspaceService {
	openSession(sessionId: string): void;
}

/** uiSession：会话级 UI 状态提供。 */
export interface UiSessionService {
	provide(key: string, value: unknown): void;
}

/** locale：本地化。 */
export interface LocaleService {
	locale: string;
	t(key: string, params?: Record<string, unknown>): string;
	bind(ns: string): (key: string, params?: Record<string, unknown>) => string;
}

/** fileDrag：拖拽文件到聊天时，经 postMessage 请 IDE 打开/定位。 */
export interface FileDragService {
	/** 收到拖入文件的绝对路径列表；返回处理结果。 */
	drop(paths: string[], sessionId: string): Promise<{ handled: boolean }>;
}
