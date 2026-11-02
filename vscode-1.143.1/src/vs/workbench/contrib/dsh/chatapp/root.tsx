// chatapp/root.tsx
// chat-only DSH 子应用的根装配：搭桩上下文 → 接线 sessions.binding(id) → 把父窗口事件喂进
// MutableSessionEventSource → 挂载复用的 DSH chat/conversation UI（uiRenderer）。
//
// 设计要点（对照 .build/rc5-contract.md）：
//  - binding 权威形状：{ sessionId, session, eventSource: MutableSessionEventSource, ctx }（见 materializeScope）。
//  - 事件源由 stubs/eventsource.ts 构造（官方 contract/events.js 优先，本地等价兜底）。
//  - 事件经 bridge（postMessage）到达：init→replace、events append/prepend/replace、
//    settle→settleAssistant、transient→append；**全程不触碰 http**。
//  - UI 挂载依赖两样由宿主页面（chatWebview / index shell）注入的全局：
//      window.__DSH_CHATAPP_STATIC__   : { react, 'react/jsx-runtime', 'react-dom', 'react-dom/client',
//                                          '@deepseek-ai/cordis', zod, '@tanstack/react-virtual',
//                                          '@deepseek-ai/dsh-client-store', ui-slots, ui-primitives, ui-dockkit }
//        （这些是 DSH 唯一一份 React 18.3.1 + cordis + 共享单例；子应用只引用，不复制。）
//      window.__ModuleLoader__         : client-modules 的 HTML 启动门面（加载 modules/client-modules.js 后即存在）。
//    缺失时进入 fallback（渲染事件计数面板并打印精确诊断），保证会话事件管线可独立验证。

import type {
	ChatappContext, RemoteService, ConnectionService, ConfigFormsService,
	UiWorkspaceService, UiSessionService, LocaleService, FileDragService, RemoteAccessService,
	SessionListRow, ConnectionSnapshot,
} from './types.js';
import { ChatappBridge, type ChatappInit } from './bridge.js';
import { createSessionsStub, type SessionsStub } from './stubs/sessions.js';
import { createRemoteStub } from './stubs/remote.js';
import { createConnectionStub } from './stubs/connection.js';
import { createConfigFormsStub } from './stubs/configForms.js';
import { createUiWorkspaceStub } from './stubs/uiWorkspace.js';
import { createFileDragStub } from './stubs/fileDrag.js';
import { createLocaleStub } from './stubs/locale.js';
import { createStore } from './stubs/store.js';

/* ------------------------------------------------------------------ *
 * 宿主注入的静态单例（DSH 唯一一份 React 18.3.1 + cordis + 共享包）
 * ------------------------------------------------------------------ */
interface DshStaticModules {
	react: unknown;
	'react/jsx-runtime': unknown;
	'react-dom': unknown;
	'react-dom/client': unknown;
	'@deepseek-ai/cordis': { Context: new () => unknown } & Record<string, unknown>;
	zod?: unknown;
	'@tanstack/react-virtual'?: unknown;
	'@deepseek-ai/dsh-client-store'?: unknown;
	'@deepseek-ai/dsh-client-ui-slots'?: unknown;
	'@deepseek-ai/dsh-client-ui-primitives'?: unknown;
	'@deepseek-ai/dsh-client-ui-dockkit'?: unknown;
}

interface ChatappAssets {
	/** 已加载/待加载的模块 URL 映射（由 build-chatapp 产物路径决定）。 */
	modulesUrl?: string;
	contractEventsUrl?: string;
	/** 每个包 id -> 其 client.js URL（用于构造 __DSH_BOOT__ entries/batches）。 */
	packages?: Record<string, string>;
	/** 该子应用要启动的包 id 列表（含依赖顺序由 boot manifest batches 决定）。 */
	bootPackages?: string[];
}

interface ModuleLoaderFacade {
	mode: string;
	load(reg: { id: string; factory: (require: (s: string) => unknown) => unknown }): void;
	create(options: { boot: unknown; staticModules: DshStaticModules; [k: string]: unknown }): DshModuleSystem;
}

interface DshModuleSystem {
	manifest: { plugins: Array<{ id: string; immediately?: boolean }> };
	prefetch(id: string): Promise<unknown>;
}

/* ------------------------------------------------------------------ *
 * 根上下文（桩）——供 sessions.binding(id).ctx 与 UI 组件读取服务
 * ------------------------------------------------------------------ */
export interface RootContextBundle {
	ctx: ChatappContext;
	sessions: SessionsStub;
	connection: { service: ConnectionService; set(c: ConnectionSnapshot): void };
	/** 设置当前工作会话（binding 兜底目标）。 */
	setActiveSession(id: string): void;
}

/**
 * 创建根桩上下文。可传入真实 cordis ctx（base）用于透传未改写的服务（uiConversation/slots/…）。
 * 未传 base 时，未覆盖的服务返回 undefined（fallback 模式）。
 */
export function createRootContext(bridge: ChatappBridge, base?: unknown): RootContextBundle {
	const baseGet = (name: string): unknown => {
		const b = base as { get?: (n: string) => unknown } | undefined;
		return b && typeof b.get === 'function' ? b.get(name) : undefined;
	};

	// 具体桩服务。
	const connection = createConnectionStub();
	const configForms: ConfigFormsService = createConfigFormsStub();
	const uiWorkspace: UiWorkspaceService = createUiWorkspaceStub(bridge);
	const fileDrag: FileDragService = createFileDragStub(bridge);
	const locale: LocaleService = createLocaleStub();
	const remote: RemoteService = createRemoteStub(bridge);
	const uiSession: UiSessionService = { provide(): void { /* 无状态桩 */ } };

	const remoteAccess: RemoteAccessService = {
		source(_kind: string, _sessionId: string, _action: string) {
			const store = createStore<unknown>(undefined);
			return { getSnapshot: () => store.getSnapshot(), subscribe: (l: () => void) => store.subscribe(l) };
		},
	};

	// 会话作用域 ctx 工厂（每个会话一个，继承根 ctx 的服务视图）。
	const scopeCtxCache = new Map<string, ChatappContext>();
	const makeScopeCtx = (sessionId: string): ChatappContext => {
		const cached = scopeCtxCache.get(sessionId);
		if (cached) { return cached; }
		const scoped = makeCtx(() => sessionId);
		scopeCtxCache.set(sessionId, scoped);
		return scoped;
	};

	let activeSessionId: string | undefined;
	const sessions = createSessionsStub(bridge, (sessionId) => makeScopeCtx(sessionId));

	// 根 ctx：sessions/remote/connection/configForms/uiWorkspace/uiSession/locale/fileDrag/remoteAccess。
	const rootCtx: ChatappContext = makeCtx(() => activeSessionId);

	function makeCtx(activeId: () => string | undefined): ChatappContext {
		const overrides: Record<string, unknown> = {
			sessions,
			remote,
			connection: connection.service,
			configForms,
			uiWorkspace,
			uiSession,
			locale,
			fileDrag,
			remoteAccess,
			// sidebarRight：ui-chat 用它打开资源/标签页；子应用里转成 IDE 动作。
			sidebarRight: {
				openResource: (url: string, _opts?: unknown): void => { bridge.action('openResourceUrl', { url, sessionId: activeId() }); },
				openTab: (tab: string, opts?: unknown): void => { bridge.action('openTab', { tab, opts, sessionId: activeId() }); },
			},
		};
		const ctx: ChatappContext = {
			get(name: string): unknown {
				if (name in overrides) { return overrides[name]; }
				return baseGet(name);
			},
			effect(fn: () => void | (() => void)): () => void {
				try { const d = fn(); return typeof d === 'function' ? d : () => { /* noop */ }; }
				catch { return () => { /* noop */ }; }
			},
			on(_event: string, _listener: (...args: unknown[]) => void): () => void { return () => { /* noop */ }; },
			plugin(): { ctx: ChatappContext; dispose(): void } { return { ctx, dispose(): void { /* noop */ } }; },
			inject(_deps: string[], fn: (c: ChatappContext) => void): void { try { fn(ctx); } catch { /* noop */ } },
			reflect: { provide(): void { /* noop（真服务由 DSH 侧提供） */ } },
			sessions,
			remote,
			remoteAccess,
			connection: connection.service,
			configForms,
			uiWorkspace,
			uiSession,
			locale,
		};
		// 便于 `ctx.fileDrag` 之类直读。
		(ctx as unknown as Record<string, unknown>).fileDrag = fileDrag;
		(ctx as unknown as Record<string, unknown>).sidebarRight = overrides['sidebarRight'];
		return ctx;
	}

	return {
		ctx: rootCtx,
		sessions,
		connection,
		setActiveSession(id: string): void { activeSessionId = id; },
	};
}

/** 把 bridge 的入站帧接到 sessions 桩（事件窗口更新）。返回取消订阅集合。 */
function wireBridgeToSessions(bridge: ChatappBridge, bundle: RootContextBundle, sessionId: string): void {
	bridge.onInit((init: ChatappInit) => {
		bundle.setActiveSession(init.sessionId);
		bundle.connection.set(init.connection);
		bundle.sessions.applyInit(init.sessionId, init.session as SessionListRow, init.snapshot.entries, init.snapshot.hasMore);
	});
	bridge.onEvents((mode, entries, hasMore) => { bundle.sessions.applyEvents(sessionId, mode, entries, hasMore); });
	bridge.onSettle((attemptId, entry) => { bundle.sessions.applySettle(sessionId, attemptId, entry); });
	bridge.onTransient((entry) => { bundle.sessions.applyTransient(sessionId, entry); });
	bridge.onConnection((c) => { bundle.connection.set(c); });
}

/* ------------------------------------------------------------------ *
 * UI 挂载
 * ------------------------------------------------------------------ */
/** 由 __DSH_CHATAPP_STATIC__ 与 __ModuleLoader__ 构造并挂载真实 DSH UI（版本容错）。 */
async function mountDshUi(container: HTMLElement, assets: ChatappAssets | undefined): Promise<() => void> {
	const g = globalThis as unknown as {
		__DSH_CHATAPP_STATIC__?: DshStaticModules;
		__DSH_BOOT__?: unknown;
		__ModuleLoader__?: ModuleLoaderFacade;
	};
	const statics = g.__DSH_CHATAPP_STATIC__;
	const loader = g.__ModuleLoader__;
	if (!statics || !loader) {
		throw new Error('chatapp: missing __DSH_CHATAPP_STATIC__/__ModuleLoader__ (host page must inject DSH static singletons + client-modules)');
	}
	if (!assets?.packages || !assets.bootPackages || assets.bootPackages.length === 0) {
		throw new Error('chatapp: missing package asset map (build-chatapp manifest not wired into __DSH_CHATAPP_ASSETS__)');
	}

	// 构造 __DSH_BOOT__（wire 形态，见 client-modules parseBootManifest）。
	const entries = assets.bootPackages.map((id) => ({
		id, url: assets.packages![id], rev: '0', inject: [], external: [],
	}));
	const boot = {
		rev: 'chatapp-0',
		release: { version: '0.2.1-rc.5' },
		entries,
		batches: [{ phase: 'bootstrap', url: 'chatapp-batch', rev: '0', entries: assets.bootPackages }],
	};
	g.__DSH_BOOT__ = boot;

	const modules = loader.create({ boot, staticModules: statics });
	const cordis = statics['@deepseek-ai/cordis'];
	const rootCtx = new cordis.Context() as unknown as {
		inject(deps: string[], cb: (ctx: { uiRenderer: { mount(c: HTMLElement): () => void } }) => void): Promise<void>;
		plugin(p: unknown): unknown;
		fiber?: { dispose(): Promise<void> };
	};

	// 逐包注册工厂（惰性 CJS 表要求先 load 再 materialize）。
	for (const id of assets.bootPackages) {
		await modules.prefetch(id).catch(() => { /* 缺失仅跳过 */ });
	}
	void modules.manifest;

	// 通过 Loader 的内部契约加载插件通常由 client-modules 的 apply(loader) 完成；
	// 此处依赖 DSH 侧已把 modules 挂到 loader.internal（由 client-modules apply 提供）。
	// 若宿主未提供 loader 集成，则退化为直接使用 uiRenderer（若已有）。
	let disposeMount: (() => void) | undefined;
	await rootCtx.inject(['uiRenderer'], (c) => {
		c.uiRenderer.mount(container);
		disposeMount = () => { /* 卸载由 fiber.dispose 负责 */ };
	});

	return () => { disposeMount?.(); void rootCtx.fiber?.dispose?.(); };
}

/** 降级面板：无宿主静态单例时，仍渲染已接线会话的事件计数（用于管线自检）。 */
function renderFallback(container: HTMLElement, bundle: RootContextBundle, sessionId: string, reason: string): () => void {
	const binding = bundle.sessions.binding(sessionId);
	const el = document.createElement('div');
	el.setAttribute('data-dsh-chatapp-fallback', '');
	el.style.cssText = 'font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:12px;color:#c8c8c8;white-space:pre-wrap;';
	const paint = (): void => {
		const snap = binding?.eventSource.getSnapshot();
		el.textContent =
			`[DSH chatapp fallback] ${reason}\n` +
			`session: ${sessionId}\n` +
			`events: ${snap ? snap.entries.length : 0} (hasMore=${snap ? snap.hasMore : '?'}, rev=${snap ? snap.revision : '?'})\n` +
			`connection: ${bundle.connection.service.getSnapshot().status}`;
	};
	paint();
	const unsub = binding?.eventSource.subscribe(paint);
	container.appendChild(el);
	return () => { unsub?.(); el.remove(); };
}

/* ------------------------------------------------------------------ *
 * 对外：挂载 chat-only 子应用
 * ------------------------------------------------------------------ */
export interface MountOptions {
	sessionId: string;
	container: HTMLElement;
	assets?: ChatappAssets;
}

/**
 * 挂载 chat-only DSH 子应用：
 *  1) 建 postMessage 桥并握手（拿 init 快照）；
 *  2) 建根桩上下文，接线 sessions.binding + 事件喂入；
 *  3) 尝试挂载真实 DSH UI；失败则渲染降级面板。
 * 返回 dispose。
 */
export async function mountChatApp(opts: MountOptions): Promise<() => void> {
	const { sessionId, container } = opts;
	const bridge = new ChatappBridge(window, sessionId);

	let bundle: RootContextBundle | undefined;
	let disposeUi: (() => void) | undefined;
	try {
		const init = await bridge.ready();
		bundle = createRootContext(bridge);
		wireBridgeToSessions(bridge, bundle, init.sessionId);
		bundle.setActiveSession(init.sessionId);
		bundle.connection.set(init.connection);
		bundle.sessions.applyInit(init.sessionId, init.session as SessionListRow, init.snapshot.entries, init.snapshot.hasMore);

		try {
			disposeUi = await mountDshUi(container, opts.assets);
		} catch (uiErr) {
			const reason = uiErr instanceof Error ? uiErr.message : String(uiErr);
			// eslint-disable-next-line no-console
			console.warn('[chatapp] DSH UI mount unavailable, using fallback:', reason);
			disposeUi = renderFallback(container, bundle, init.sessionId, reason);
		}
	} catch (e) {
		// 握手失败：仍需给出可见错误。
		const msg = e instanceof Error ? e.message : String(e);
		// eslint-disable-next-line no-console
		console.error('[chatapp] mount failed:', msg);
		const el = document.createElement('div');
		el.setAttribute('data-dsh-chatapp-error', '');
		el.style.cssText = 'font:12px/1.5 ui-monospace,monospace;padding:12px;color:#f88;white-space:pre-wrap;';
		el.textContent = `[DSH chatapp] mount failed:\n${msg}`;
		container.appendChild(el);
		return () => { el.remove(); bridge.dispose(); };
	}

	return () => { disposeUi?.(); bridge.dispose(); };
}

/**
 * 根 React 组件（备用/嵌入用）：挂载时调用 mountChatApp，卸载时 dispose。
 *
 * 说明：为在**无 @types/react 的仓库内也能编译**，本文件不静态 import 'react'、不使用 JSX；
 * React 从宿主注入的单一单例（window.__DSH_CHATAPP_STATIC__.react，即 DSH 的 React 18.3.1）在运行时取得，
 * 经 createElement 构造元素。正常启动请走 boot.ts 的 mountChatApp（纯 DOM，不依赖 React）。
 */
interface RuntimeReact {
	useRef<T>(initial: T): { current: T };
	useState<T>(initial: T): [T, (next: T) => void];
	useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
	createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown;
}

function getRuntimeReact(): RuntimeReact | undefined {
	const statics = (globalThis as unknown as { __DSH_CHATAPP_STATIC__?: { react?: RuntimeReact } }).__DSH_CHATAPP_STATIC__;
	return statics?.react;
}

/** 根组件工厂：仅当宿主已注入 React 单例时可用（否则返回 undefined，调用方应直接用 mountChatApp）。 */
export function createRootComponent(): ((props: { sessionId: string; assets?: ChatappAssets }) => unknown) | undefined {
	const React = getRuntimeReact();
	if (!React) { return undefined; }

	function Root(props: { sessionId: string; assets?: ChatappAssets }): unknown {
		const ref = React!.useRef<HTMLDivElement | null>(null);
		const [error, setError] = React!.useState<string | undefined>(undefined);
		React!.useEffect(() => {
			let dispose: (() => void) | undefined;
			let cancelled = false;
			if (ref.current) {
				mountChatApp({ sessionId: props.sessionId, container: ref.current, assets: props.assets })
					.then((d) => { if (cancelled) { d(); } else { dispose = d; } })
					.catch((e: unknown) => { if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); } });
			}
			return () => { cancelled = true; dispose?.(); };
		}, [props.sessionId, props.assets]);
		const children: unknown[] = [];
		if (error) { children.push(React!.createElement('div', { key: 'err', style: { color: '#f88', font: '12px ui-monospace,monospace', padding: 12 } }, error)); }
		return React!.createElement('div', { ref, style: { width: '100%', height: '100%' } }, ...children);
	}
	return Root;
}

export default mountChatApp;
