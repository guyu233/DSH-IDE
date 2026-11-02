// chatapp/boot.ts
// 极薄启动器：读取配置 → 预加载事件源 → 动态载入 root → 挂载 chat-only 子应用。
//
// 这是 webview 文档的入口脚本。它刻意保持“薄”：
//   - 不渲染任何 UI；真正的挂载在 root.tsx 的 mountChatApp。
//   - 参数从 URL（?sessionId=… 或 #sessionId=…）与全局注入读取。
//
// 与宿主页面（chatWebview.ts）的契约：
//   1. HTML <head> 内含 import map：把 "react"/"react-dom"/"react/jsx-runtime"/"react-dom/client"
//      "@deepseek-ai/cordis"/"@tanstack/react-virtual"/"@deepseek-ai/dsh-client-store"
//      "@deepseek-ai/dsh-client-ui-slots"/"-primitives"/"-dockkit" 映射到 DSH 单一副本的 shim
//      （这些 shim 从 window.__DSH_CHATAPP_STATIC__ 导出，即 index shell 里那份 React 18.3.1）。
//   2. 加载 modules/client-modules.js（其执行 `window.__ModuleLoader__ = { mode:'queue', … }`）。
//   3. 设置 window.__DSH_CHATAPP_STATIC__（静态单例）与 window.__DSH_CHATAPP_ASSETS__（资产表）。
//   4. 设置 window.__DSH_CHATAPP_SESSION_ID__ 或 URL 查询参数。
// 任一前置缺失时，mountChatApp 会渲染可见诊断，不会白屏。

import { preloadEventSource } from './stubs/eventsource.js';

interface ChatappAssets {
	modulesUrl?: string;
	contractEventsUrl?: string;
	packages?: Record<string, string>;
	bootPackages?: string[];
}

function readSessionId(): string | undefined {
	const g = globalThis as unknown as { __DSH_CHATAPP_SESSION_ID__?: string };
	if (typeof g.__DSH_CHATAPP_SESSION_ID__ === 'string' && g.__DSH_CHATAPP_SESSION_ID__) { return g.__DSH_CHATAPP_SESSION_ID__; }
	try {
		const params = new URLSearchParams(location.search);
		const fromQuery = params.get('sessionId');
		if (fromQuery) { return fromQuery; }
		if (location.hash) {
			const hp = new URLSearchParams(location.hash.replace(/^#/, ''));
			const fromHash = hp.get('sessionId');
			if (fromHash) { return fromHash; }
		}
	} catch { /* 非浏览器环境 */ }
	return undefined;
}

function ensureContainer(): HTMLElement {
	const existing = document.getElementById('root');
	if (existing) { return existing; }
	const el = document.createElement('div');
	el.id = 'root';
	el.style.cssText = 'position:absolute;inset:0;';
	document.body.appendChild(el);
	return el;
}

function showFatal(message: string): void {
	try {
		const el = document.createElement('div');
		el.setAttribute('data-dsh-chatapp-error', '');
		el.style.cssText = 'font:12px/1.5 ui-monospace,monospace;padding:12px;color:#f88;white-space:pre-wrap;';
		el.textContent = `[DSH chatapp] boot failed:\n${message}`;
		(document.body || document.documentElement).appendChild(el);
	} catch { /* 忽略 */ }
}

/**
 * 启动。无副作用导出；被 HTML 以 `<script type="module" src="boot/boot.js">` 直接加载。
 */
export async function boot(): Promise<void> {
	const g = globalThis as unknown as {
		__DSH_CHATAPP_STATIC__?: { react?: unknown };
		__DSH_CHATAPP_ASSETS__?: ChatappAssets;
		React?: unknown;
	};

	// 便捷：把注入的 React 暴露为全局，便于个别依赖 window.React 的身影（无害）。
	if (g.__DSH_CHATAPP_STATIC__?.react && !g.React) { g.React = g.__DSH_CHATAPP_STATIC__.react; }

	const sessionId = readSessionId();
	if (!sessionId) { showFatal('缺少 sessionId（设置 window.__DSH_CHATAPP_SESSION_ID__ 或 URL ?sessionId=）。'); return; }

	// 预加载事件源（官方 contract/events.js 优先；失败静默，本地实现兜底）。
	await preloadEventSource();

	// 动态载入 root（此时 import map 已生效，'react' 等解析到 DSH 单一副本）。
	let mountChatApp: (opts: { sessionId: string; container: HTMLElement; assets?: ChatappAssets }) => Promise<() => void>;
	try {
		const mod = await import('./root.js');
		mountChatApp = mod.mountChatApp;
	} catch (e) {
		showFatal(`无法载入 root 模块: ${e instanceof Error ? e.message : String(e)}（检查 import map 与 'react' 单例映射）`);
		return;
	}

	const container = ensureContainer();
	try {
		const dispose = await mountChatApp({ sessionId, container, assets: g.__DSH_CHATAPP_ASSETS__ });
		(globalThis as unknown as { addEventListener?: (t: string, cb: () => void) => void })
			.addEventListener?.('beforeunload', () => { try { dispose(); } catch { /* 忽略 */ } });
	} catch (e) {
		showFatal(e instanceof Error ? e.message : String(e));
	}
}

// 直接执行（HTML 直接加载本模块时）。
void boot();
