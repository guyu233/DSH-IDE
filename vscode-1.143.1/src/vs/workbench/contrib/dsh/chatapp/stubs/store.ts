// chatapp/stubs/store.ts
// 极小可订阅快照容器（等价于 DSH 的 store 语义：getSnapshot/subscribe，set 时同步通知）。
// 供 connection/configForms/remoteAccess 等桩复用；被引用方按“最小快照”消费。

export interface Store<T> {
	getSnapshot(): T;
	subscribe(listener: () => void): () => void;
	set(next: T): void;
}

export function createStore<T>(initial: T): Store<T> {
	let value = initial;
	const listeners = new Set<() => void>();
	return {
		getSnapshot: () => value,
		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		set(next: T): void {
			if (next === value) { return; }
			value = next;
			for (const l of [...listeners]) { try { l(); } catch { /* ignore */ } }
		},
	};
}
