// chatapp/stubs/connection.ts
// connection 桩：与 Host 的连接状态。
// 状态经父窗口 postMessage 桥推送（{ kind:'connection', connection }），**不走 http**。

import type { ConnectionService, ConnectionSnapshot } from '../types.js';
import { createStore, type Store } from './store.js';

export function createConnectionStub(): { service: ConnectionService; set(connection: ConnectionSnapshot): void } {
	const store: Store<ConnectionSnapshot> = createStore<ConnectionSnapshot>({ status: 'connecting' });
	const service: ConnectionService = {
		getSnapshot: () => store.getSnapshot(),
		subscribe: (listener: () => void) => store.subscribe(listener),
		reconnect(): void { store.set({ ...store.getSnapshot(), status: 'connecting' }); },
	};
	return { service, set: (c) => store.set(c) };
}
