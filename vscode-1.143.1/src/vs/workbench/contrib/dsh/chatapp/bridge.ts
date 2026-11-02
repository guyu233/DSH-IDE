// chatapp/bridge.ts
// webview ↔ 父窗口（chatWebview.ts）的 postMessage 桥。
//
// 所有 remote/connection/sessions 数据都经此桥收发（**绝不走 http**）。
// 协议（双向均带 __dsh:true 标记，便于与 VS Code webview 其它消息区分）：
//
//   webview → host:
//     { kind:'ready', sessionId }                       载入完成后握手，索取 init 快照
//     { kind:'rpc', id, method, payload }               Host-Remote 语义调用（session.list/prompt/selectModel…）
//     { kind:'action', action, payload }                轻量动作（openResource/openExternal/openSession/loadOlder…）
//
//   host → webview:
//     { kind:'init', sessionId, session, snapshot, connection }   握手应答（首帧历史窗口）
//     { kind:'events', mode:'append'|'replace'|'prepend', entries, hasMore }   会话事件窗口更新
//     { kind:'transient', entry }                       assistant 实时 chunk（transient）
//     { kind:'settle', attemptId, entry? }              某 attempt 收敛为持久 settlement
//     { kind:'connection', connection }                 连接状态变化
//     { kind:'rpc-result', id, ok, result?, error? }    rpc 应答
import type { SessionEventLikeEntry, ConnectionSnapshot, SessionListRow } from './types.js';

export interface ChatappInit {
	sessionId: string;
	session: SessionListRow;
	snapshot: { entries: SessionEventLikeEntry[]; hasMore: boolean };
	connection: ConnectionSnapshot;
}

type InitHandler = (init: ChatappInit) => void;
type EventsHandler = (mode: 'append' | 'replace' | 'prepend', entries: SessionEventLikeEntry[], hasMore: boolean) => void;
type SettleHandler = (attemptId: string, entry?: SessionEventLikeEntry) => void;
type TransientHandler = (entry: SessionEventLikeEntry) => void;
type ConnectionHandler = (connection: ConnectionSnapshot) => void;

interface PendingRpc { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; }

const TAG = '__dsh';

export class ChatappBridge {
	private readonly win: Window;
	private readonly sessionId: string;
	private readonly initTimeoutMs: number;
	private readonly pending = new Map<string, PendingRpc>();
	private seq = 0;
	private handlers = {
		init: [] as InitHandler[],
		events: [] as EventsHandler[],
		settle: [] as SettleHandler[],
		transient: [] as TransientHandler[],
		connection: [] as ConnectionHandler[],
	};

	constructor(win: Window, sessionId: string, initTimeoutMs = 15000) {
		this.win = win;
		this.sessionId = sessionId;
		this.initTimeoutMs = initTimeoutMs;
		this.win.addEventListener('message', this.onMessage as EventListener);
	}

	/** 判断消息是否属于本桥（供 chatWebview 侧复用）。 */
	static isBridgeMessage(data: unknown): boolean {
		return typeof data === 'object' && data !== null && (data as Record<string, unknown>)[TAG] === true;
	}

	/** 发送握手并等待 init；超时则 reject（调用方 showError）。 */
	ready(): Promise<ChatappInit> {
		return new Promise<ChatappInit>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.handlers.init = this.handlers.init.filter(h => h !== onInit);
				reject(new Error('chatapp: handshake timeout (parent did not answer ready)'));
			}, this.initTimeoutMs);
			const onInit: InitHandler = (init) => { clearTimeout(timer); this.handlers.init = this.handlers.init.filter(h => h !== onInit); resolve(init); };
			this.handlers.init.push(onInit);
			// 无父窗口（独立调试页）：以空快照放行，rpc 将明确失败。
			if (this.win.parent === this.win) {
				clearTimeout(timer);
				this.handlers.init = this.handlers.init.filter(h => h !== onInit);
				resolve({ sessionId: this.sessionId, session: { id: this.sessionId }, snapshot: { entries: [], hasMore: false }, connection: { status: 'disconnected' } });
				return;
			}
			this.post({ kind: 'ready', sessionId: this.sessionId });
		});
	}

	onInit(h: InitHandler): void { this.handlers.init.push(h); }
	onEvents(h: EventsHandler): void { this.handlers.events.push(h); }
	onSettle(h: SettleHandler): void { this.handlers.settle.push(h); }
	onTransient(h: TransientHandler): void { this.handlers.transient.push(h); }
	onConnection(h: ConnectionHandler): void { this.handlers.connection.push(h); }

	/** Host-Remote 语义调用：发 rpc 帧并等待 rpc-result。 */
	rpc<Res = unknown>(method: string, payload?: unknown): Promise<Res> {
		if (this.win.parent === this.win) { return Promise.reject(new Error(`chatapp: no host for rpc "${method}" (standalone page)`)); }
		const id = `r${++this.seq}`;
		return new Promise<Res>((resolve, reject) => {
			const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`chatapp: rpc timeout "${method}"`)); }, 30000);
			this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
			this.post({ kind: 'rpc', id, method, payload });
		});
	}

	/** 轻量动作（不等待结果）。 */
	action(action: string, payload?: unknown): void {
		if (this.win.parent === this.win) { return; }
		this.post({ kind: 'action', action, payload });
	}

	/** 请求更早的历史分页（由 Host 侧回 events/prepend）。 */
	loadOlder(): void { this.action('loadOlder', { sessionId: this.sessionId }); }
	/** 加载到指定 seq。 */
	loadThrough(seq: number): void { this.action('loadThrough', { sessionId: this.sessionId, seq }); }

	dispose(): void {
		this.win.removeEventListener('message', this.onMessage as EventListener);
		for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('chatapp: bridge disposed')); }
		this.pending.clear();
		this.handlers = { init: [], events: [], settle: [], transient: [], connection: [] };
	}

	private post(msg: Record<string, unknown>): void {
		try { (this.win.parent || this.win).postMessage({ [TAG]: true, ...msg }, '*'); } catch { /* 忽略 */ }
	}

	private onMessage = (event: MessageEvent): void => {
		const data = event.data;
		if (!ChatappBridge.isBridgeMessage(data)) { return; }
		const msg = data as Record<string, unknown>;
		switch (msg.kind) {
			case 'init': for (const h of this.handlers.init) { try { h(msg as unknown as ChatappInit); } catch { /* ignore */ } } break;
			case 'events': for (const h of this.handlers.events) { try { h(msg.mode as 'append', (msg.entries as SessionEventLikeEntry[]) ?? [], !!msg.hasMore); } catch { /* ignore */ } } break;
			case 'settle': for (const h of this.handlers.settle) { try { h(String(msg.attemptId), msg.entry as SessionEventLikeEntry | undefined); } catch { /* ignore */ } } break;
			case 'transient': for (const h of this.handlers.transient) { try { h(msg.entry as SessionEventLikeEntry); } catch { /* ignore */ } } break;
			case 'connection': for (const h of this.handlers.connection) { try { h(msg.connection as ConnectionSnapshot); } catch { /* ignore */ } } break;
			case 'rpc-result': {
				const p = this.pending.get(String(msg.id));
				if (!p) { break; }
				this.pending.delete(String(msg.id));
				clearTimeout(p.timer);
				if (msg.ok) { p.resolve(msg.result); } else { p.reject(new Error(String(msg.error ?? 'rpc failed'))); }
				break;
			}
			default: break;
		}
	};
}
