// chatapp/stubs/sessions.ts
// sessions 桩（TestSessions 模式）。
//
// 关键契约：sessions.binding(id) -> { sessionId, session, eventSource: MutableSessionEventSource, ctx }
//   - ui-chat / ui-conversation / ui-session 全部经此读取会话与事件窗口。
//   - 事件经父窗口（chatWebview）的 postMessage 桥喂入 eventSource（append/replace/prepend/settleAssistant），**不走 http**。
//   - session.loadOlder/loadThrough 经桥 action 请求 Host 分页（结果回 events/prepend）。
//
// 每个会话拥有一个 Agent 作用域 ctx（sessions.scope(id)），插件注册随该作用域释放；binding.ctx 指向它。

import type {
	SessionsService, SessionBinding, ChatappContext, SessionListRow, ChatappSession, IMutableSessionEventSource,
} from '../types.js';
import { createStore, type Store } from './store.js';
import { createSessionEventSource } from './eventsource.js';
import type { ChatappBridge } from '../bridge.js';

interface ScopeRecord {
	ctx: ChatappContext;
	eventSource: IMutableSessionEventSource;
	binding: SessionBinding;
	session: ChatappSession;
	row: SessionListRow;
}

export interface SessionsStub extends SessionsService {
	/** 由 root 在收到 init/events/settle 帧时调用，把事件灌入对应会话窗口。 */
	applyInit(sessionId: string, row: SessionListRow, entries: Parameters<IMutableSessionEventSource['replace']>[0], hasMore: boolean): void;
	applyEvents(sessionId: string, mode: 'append' | 'replace' | 'prepend', entries: Parameters<IMutableSessionEventSource['replace']>[0], hasMore: boolean): void;
	applySettle(sessionId: string, attemptId: string, entry?: Parameters<IMutableSessionEventSource['settleAssistant']>[1]): void;
	applyTransient(sessionId: string, entry: Parameters<IMutableSessionEventSource['append']>[0]): void;
}

/**
 * 创建 sessions 桩。
 * @param bridge postMessage 桥（用于 loadOlder/loadThrough/fork 等动作）。
 * @param makeScopeCtx 由 root 提供的「作用域 ctx 工厂」（继承根 ctx 并把 sessions/remote/… 挂上）。
 */
export function createSessionsStub(
	bridge: ChatappBridge,
	makeScopeCtx: (sessionId: string, record: () => ScopeRecord | undefined) => ChatappContext,
): SessionsStub {
	const scopes = new Map<string, ScopeRecord>();
	const list: Store<{ byId: Record<string, SessionListRow> }> = createStore({ byId: {} });

	function materialize(sessionId: string): ScopeRecord {
		const eventSource = createSessionEventSource();
		const session: ChatappSession = {
			id: sessionId,
			eventSource,
			loadOlder: () => bridge.loadOlder(),
			loadThrough: (seq: number) => bridge.loadThrough(seq),
		};
		const row: SessionListRow = list.getSnapshot().byId[sessionId] ?? { id: sessionId };
		let recordRef: ScopeRecord | undefined;
		const ctx = makeScopeCtx(sessionId, () => recordRef);
		const binding: SessionBinding = { sessionId, session, eventSource, ctx };
		const record: ScopeRecord = { ctx, eventSource, binding, session, row };
		recordRef = record;
		scopes.set(sessionId, record);
		return record;
	}

	function upsertRow(row: SessionListRow): void {
		const byId = { ...list.getSnapshot().byId, [row.id]: row };
		list.set({ byId });
	}

	const stub: SessionsStub = {
		binding(id: string): SessionBinding | undefined {
			return (scopes.get(id) ?? materialize(id)).binding;
		},
		scope(id: string): ChatappContext | undefined {
			return (scopes.get(id) ?? materialize(id)).ctx;
		},
		list: {
			getSnapshot: () => list.getSnapshot(),
		},
		retainInfo(): unknown { return undefined; },
		async fork(id: string, seq?: number): Promise<{ sessionId: string }> {
			return bridge.rpc<{ sessionId: string }>('session.fork', { sessionId: id, ...(seq === undefined ? {} : { seq }) });
		},

		applyInit(sessionId, row, entries, hasMore): void {
			upsertRow({ ...row, id: sessionId });
			const record = materialize(sessionId);
			record.row = { ...row, id: sessionId };
			record.eventSource.replace(entries, hasMore);
		},
		applyEvents(sessionId, mode, entries, hasMore): void {
			const record = materialize(sessionId);
			if (mode === 'replace') { record.eventSource.replace(entries, hasMore); }
			else if (mode === 'prepend') { record.eventSource.prepend(entries, hasMore); }
			else { for (const entry of entries) { record.eventSource.append(entry); } }
		},
		applySettle(sessionId, attemptId, entry): void {
			materialize(sessionId).eventSource.settleAssistant(attemptId, entry);
		},
		applyTransient(sessionId, entry): void {
			materialize(sessionId).eventSource.append(entry);
		},
	};
	return stub;
}
