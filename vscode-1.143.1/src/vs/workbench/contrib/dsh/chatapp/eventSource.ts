// chatapp/eventSource.ts
// 本地实现 SessionEvent 的可变窗口事件源，语义严格对齐已安装 DSH 的权威实现
// @deepseek-ai/dsh-api-session-controller/lib/types/client/contract/events.js（见 .build/rc5-contract.md §Client-side event source）。
//
// 为什么自带一份而不是直接 import 官方 .js：
//   - 子应用是 webview 内独立文档；官方 events.js 依赖 @deepseek-ai/dsh-client-store 的 notifySubscribers，
//     而该包在 asar 中无独立文件（被内联进 index shell）。为免引入该依赖，这里用等价的本地订阅通知。
//   - 一旦 build-chatapp 能解析到官方 contract/events.js（见产物 contract/events.js），root 会优先用它，
//     此文件作为稳健兜底，保证窗口语义逐字段一致（replace/prepend/append/settleAssistant 的行为与官方完全相同）。
import type { SessionEventLikeEntry, SessionEventWindowSnapshot, IMutableSessionEventSource } from './types.js';

interface LeafNode { kind: 'leaf'; entries: SessionEventLikeEntry[]; length: number; }
interface ConcatNode { kind: 'concat'; left: Node; right: Node; length: number; }
type Node = LeafNode | ConcatNode;
interface Change { kind: string; [k: string]: unknown; }

function leaf(entries: SessionEventLikeEntry[]): LeafNode {
	return { kind: 'leaf', entries, length: entries.length };
}
function concat(left: Node, right: Node): ConcatNode {
	return { kind: 'concat', left, right, length: left.length + right.length };
}
function materialize(node: Node): SessionEventLikeEntry[] {
	if (node.kind === 'leaf') { return node.entries; }
	const entries = new Array<SessionEventLikeEntry>(node.length);
	const pending: Node[] = [node];
	let index = 0;
	while (pending.length > 0) {
		const current = pending.pop()!;
		if (current.kind === 'concat') { pending.push(current.right, current.left); continue; }
		for (const entry of current.entries) { entries[index] = entry; index += 1; }
	}
	return entries;
}
function windowSnapshot(node: Node, hasMore: boolean, revision: number, change: Change): SessionEventWindowSnapshot {
	let entries: SessionEventLikeEntry[] | undefined;
	return {
		get entries() { entries ??= materialize(node); return entries; },
		hasMore,
		revision,
		change,
	};
}

/** 与官方 MutableSessionEventSource 行为一致的最简实现（纯本地订阅）。 */
export class LocalMutableSessionEventSource implements IMutableSessionEventSource {
	private listeners = new Set<() => void>();
	private window: Node = leaf([]);
	private snapshot: SessionEventWindowSnapshot = windowSnapshot(this.window, false, 0, { kind: 'replace', entries: [] });

	getSnapshot(): SessionEventWindowSnapshot { return this.snapshot; }

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	}

	replace(entries: SessionEventLikeEntry[], hasMore: boolean): void {
		this.window = leaf(entries);
		this.publish(hasMore, { kind: 'replace', entries });
	}

	prepend(entries: SessionEventLikeEntry[], hasMore: boolean): void {
		this.window = concat(leaf(entries), this.window);
		this.publish(hasMore, { kind: 'prepend', entries });
	}

	append(entry: SessionEventLikeEntry): void {
		const entries = [entry];
		this.window = concat(this.window, leaf(entries));
		this.publish(this.snapshot.hasMore, { kind: 'append', entries });
	}

	settleAssistant(attemptId: string, entry?: SessionEventLikeEntry): void {
		const entries = materialize(this.window).filter(candidate =>
			candidate.type !== 'transient' || (candidate.event as { data?: { attemptId?: string } }).data?.attemptId !== attemptId);
		if (entry !== undefined) {
			const seqOf = (c: SessionEventLikeEntry): number => (c.type === 'event' ? c.event.seq : Number.POSITIVE_INFINITY);
			const entrySeq = seqOf(entry);
			const index = entries.findIndex(candidate => seqOf(candidate) > entrySeq);
			if (index < 0) { entries.push(entry); }
			else { entries.splice(index, 0, entry); }
		}
		this.window = leaf(entries);
		this.publish(this.snapshot.hasMore, {
			kind: 'settle-assistant',
			attemptId,
			...(entry === undefined ? {} : { entry }),
		});
	}

	private publish(hasMore: boolean, change: Change): void {
		this.snapshot = windowSnapshot(this.window, hasMore, this.snapshot.revision + 1, change);
		for (const listener of [...this.listeners]) {
			try { listener(); } catch { /* 订阅方异常不影响窗口 */ }
		}
	}
}
