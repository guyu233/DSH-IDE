// chatapp/stubs/eventsource.ts
// 事件源工厂：优先用 build-chatapp 产出的**官方** contract/events.js（权威实现），
// 解析不到时退回本地等价实现 LocalMutableSessionEventSource。
//
// 两种实现均满足 IMutableSessionEventSource；window.__DSH_CHATAPP_ASSETS__ 由 boot 注入
// （见 boot.ts），给出 contract/events.js 的相对 URL。

import type { IMutableSessionEventSource } from '../types.js';
import { LocalMutableSessionEventSource } from '../eventSource.js';

interface ChatappAssets { contractEventsUrl?: string; }

let ctor: (new () => IMutableSessionEventSource) | undefined;
let loading: Promise<void> | undefined;

/** 尝试加载官方 MutableSessionEventSource；失败静默退回本地实现（版本容错）。 */
async function loadOfficial(): Promise<void> {
	if (ctor !== undefined) { return; }
	const assets = (globalThis as unknown as { __DSH_CHATAPP_ASSETS__?: ChatappAssets }).__DSH_CHATAPP_ASSETS__;
	const url = assets?.contractEventsUrl;
	if (!url) { return; }
	try {
		const mod = await import(/* @vite-ignore */ url) as { MutableSessionEventSource?: new () => IMutableSessionEventSource };
		if (mod && typeof mod.MutableSessionEventSource === 'function') { ctor = mod.MutableSessionEventSource; }
	} catch { /* 退回本地实现 */ }
}

/** 预加载（boot 可在 mount 前 await；非必需）。 */
export async function preloadEventSource(): Promise<void> { await loadOfficial(); }

/** 创建事件源实例（官方优先，本地兜底）。 */
export function createSessionEventSource(): IMutableSessionEventSource {
	return ctor ? new ctor() : new LocalMutableSessionEventSource();
}
