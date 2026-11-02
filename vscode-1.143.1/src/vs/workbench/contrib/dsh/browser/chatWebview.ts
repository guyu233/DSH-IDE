/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH 聊天容器（Workbench WebviewView）：加载 chat-only DSH 子应用（contrib/dsh/chatapp 构建产物），
// 并与子应用做 postMessage 握手；历史经通道 A session.page 渲染，实时经 session.follow 推入。
//
// 数据来自私有管道（IDshChatClient），绝不走 http。
// 该容器只负责「承载 + 桥接」；真正的 UI 由子应用（复用 DSH client-ui 包）渲染。
//
// 说明：把 DSH index shell 导出映射成 window.__DSH_CHATAPP_STATIC__（React/cordis/单例）这一步
// 依赖 index-*.js 的导出符号抽取，属集成接缝（见 build-chatapp manifest.react.strategy）。
// 本文件先注入该全局（若主页面已提供）与 import map，并在缺失时由子应用回退到诊断面板，保证事件管线可验证。

import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWebviewViewService, WebviewView } from '../../../webviewView/browser/webviewViewService.js';
import { IDshChatClient, IDshPipeFrame } from '../../../../platform/dshPipe/common/dshChatClient.js';

export const DSH_CHAT_VIEW_ID = 'workbench.view.dshChat';

interface ChatappMessage { __dsh?: boolean; kind?: string;[k: string]: unknown }

/** 把本地文件路径映射为渲染器 webview 可加载的资源 URL。 */
function toWebviewUri(fsPath: string): string {
	let p = fsPath.replace(/\\/g, '/');
	if (!/^[A-Za-z]:/.test(p) && !p.startsWith('/')) { p = '/' + p; }
	else if (/^[A-Za-z]:/.test(p)) { p = '/' + p; }
	return 'https://file+.vscode-resource.vscode-cdn.net' + encodeURI(p);
}

/** DSH 聊天 WebviewView 提供者（Workbench 贡献）。 */
export class DshChatWebviewProvider {

	constructor(
		@IWebviewViewService private readonly webviewViewService: IWebviewViewService,
		@IDshChatClient private readonly client: IDshChatClient,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@ILogService private readonly log: ILogService,
	) {
		// 注册 view 解析器（renderer 侧 WebviewView）。注册句柄由调用方在 workbench 作用域持有。
		this.webviewViewService.register(DSH_CHAT_VIEW_ID, {
			resolve: (view, token) => this.resolve(view, token),
		});
	}

	private get cwd(): string { return this.workspace.getWorkspace().folders[0]?.uri.fsPath ?? ''; }

	private async resolve(view: WebviewView, token: { isCancellationRequested: boolean }): Promise<void> {
		view.title = localize('dsh.chat.title', "DSH");
		const webview = view.webview;
		const status = await this.client.getStatus();
		if (!status.connected || !status.chatappDir) {
			webview.contentOptions = { allowScripts: false };
			webview.setHtml(this.diagnosticHtml('DSH Host 未连接。请从 DeepSeek Harness 的「DSH-IDE」入口启动 IDE（会注入 DSH_IDE_PIPE）。'));
			return;
		}
		if (token.isCancellationRequested) { return; }

		webview.contentOptions = { allowScripts: true, localResourceRoots: [URI.file(status.chatappDir)] };

		// 选一个会话（当前工作区最近；否则新建）。
		let sessionId = '';
		try {
			const list = await this.client.callA<{ items: Array<{ sessionId: string; cwd?: string; updatedAt?: number }> }>('session.list', {});
			const norm = (p?: string) => (p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
			const mine = (list.items || []).filter(i => norm(i.cwd) === norm(this.cwd)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
			sessionId = mine[0]?.sessionId || '';
			if (!sessionId) { sessionId = (await this.client.callA<{ sessionId: string }>('session.create', { cwd: this.cwd })).sessionId; }
		} catch (e) {
			webview.setHtml(this.diagnosticHtml('无法获取 DSH 会话列表：' + String((e && (e as Error).message) || e)));
			return;
		}

		const disposables = new DisposableStore();
		view.onDispose(() => disposables.dispose());
		let followId = '';
		const send = (msg: Record<string, unknown>) => { void webview.postMessage({ __dsh: true, ...msg }); };

		disposables.add(webview.onMessage(async (raw) => {
			const msg = (raw && (raw as { message?: unknown }).message) as ChatappMessage;
			if (!msg || msg.__dsh !== true) { return; }
			try {
				if (msg.kind === 'ready') {
					// 首帧历史：projections 取游标 + page 取窗口。
					const proj = await this.client.callA<{ asOfSeq: number } | null>('session.projections', { sessionId });
					const throughSeq = proj && Number.isSafeInteger(proj.asOfSeq) ? proj.asOfSeq : -1;
					const page = await this.client.callA<{ records: unknown[]; hasMore: boolean }>('session.page', { address: { kind: 'session', sessionId }, throughSeq, maxMessages: 100 });
					send({ kind: 'init', sessionId, session: { id: sessionId }, snapshot: { entries: page.records ?? [], hasMore: page.hasMore === true }, connection: { status: 'connected' } });
					// 实时：session.follow 原样帧 -> events/transient。
					if (followId) { void this.client.cancel(followId); }
					const f = this.client.follow('session.follow', { address: { kind: 'session', sessionId } }, (frame) => this.forwardFollow(send, frame));
					followId = f.streamId;
					disposables.add({ dispose: () => { void this.client.cancel(followId).catch(() => undefined); } });
				} else if (msg.kind === 'rpc') {
					const id = String(msg.id ?? '');
					try {
						const result = await this.client.callA(String(msg.method), msg.payload);
						send({ kind: 'rpc-result', id, ok: true, result });
					} catch (e) {
						send({ kind: 'rpc-result', id, ok: false, error: String((e && (e as Error).message) || e) });
					}
				} else if (msg.kind === 'action') {
					// 轻量动作：目前仅透传为一次 rpc（openSession 等可后续细化）。
					this.log.trace('[dsh] chatapp action', msg.action);
				}
			} catch (e) {
				this.log.warn('[dsh] chatWebview message failed', e);
			}
		}));

		webview.setHtml(this.shellHtml(status.chatappDir, sessionId));
	}

	private forwardFollow(send: (m: Record<string, unknown>) => void, frame: IDshPipeFrame['frame']): void {
		const p = frame.payload as { type?: string; records?: unknown[]; event?: unknown; hasMore?: boolean; frame?: unknown } | undefined;
		if (!p) { return; }
		if (p.type === 'snapshot') {
			send({ kind: 'events', mode: 'replace', entries: Array.isArray(p.records) ? p.records : [], hasMore: p.hasMore === true });
		} else if (p.type === 'event' && p.event) {
			send({ kind: 'events', mode: 'append', entries: [{ type: 'event', event: p.event }], hasMore: false });
		} else if (p.type === 'assistant-stream' && p.frame) {
			send({ kind: 'transient', entry: { type: 'transient', event: { type: 'assistant/live-chunk', data: p.frame } } });
		}
	}

	/** 子应用 HTML 外壳：import map + 静态单例注入 + 载入 client-modules + boot。 */
	private shellHtml(chatappDir: string, sessionId: string): string {
		const u = (rel: string) => toWebviewUri(chatappDir.replace(/[\\/]+$/, '') + '/' + rel);
		// 资产生成于 build-chatapp：assets/、modules/、packages/、boot/、contract/。
		const importMap = JSON.stringify({
			imports: {
				'react': u('shim/react.js'),
				'react/jsx-runtime': u('shim/react-jsx-runtime.js'),
				'react-dom': u('shim/react-dom.js'),
				'react-dom/client': u('shim/react-dom-client.js'),
				'@deepseek-ai/cordis': u('shim/cordis.js'),
				'@tanstack/react-virtual': u('shim/react-virtual.js'),
				'@deepseek-ai/dsh-client-store': u('shim/dsh-client-store.js'),
				'@deepseek-ai/dsh-client-ui-slots': u('shim/ui-slots.js'),
				'@deepseek-ai/dsh-client-ui-primitives': u('shim/ui-primitives.js'),
				'@deepseek-ai/dsh-client-ui-dockkit': u('shim/ui-dockkit.js'),
			},
		});
		const csp = `default-src 'none'; img-src https: data:; font-src https: data:; style-src https: 'unsafe-inline'; script-src https: 'unsafe-inline' 'unsafe-eval'; connect-src https:;`;
		return `<!DOCTYPE html><html><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="${u('assets/index.css')}" />
<link rel="stylesheet" href="${u('theme/brand-font.css')}" />
<script type="importmap">${importMap}</script>
</head><body>
<div id="root" style="position:absolute;inset:0;"></div>
<script>
  window.__DSH_CHATAPP_SESSION_ID__ = ${JSON.stringify(sessionId)};
  window.__DSH_CHATAPP_ASSETS__ = { base: ${JSON.stringify(chatappDir)}, modulesUrl: ${JSON.stringify(u('modules/client-modules.js'))}, packages: {} };
  // 静态单例（React/cordis/共享包）应由 index shell 导出并注入；此集成接缝若缺失，子应用回退诊断面板。
  window.__DSH_CHATAPP_STATIC__ = window.__DSH_CHATAPP_STATIC__ || undefined;
</script>
<script type="module" src="${u('modules/client-modules.js')}"></script>
<script type="module" src="${u('boot/boot.js')}"></script>
</body></html>`;
	}

	private diagnosticHtml(message: string): string {
		return `<!DOCTYPE html><html><head><meta charset="utf-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" /></head>
<body style="font:13px/1.5 var(--vscode-font-family);padding:16px;color:var(--vscode-foreground);">
<h3 style="margin:0 0 8px;">DSH</h3><p style="color:var(--vscode-descriptionForeground);white-space:pre-wrap;">${message.replace(/</g, '&lt;')}</p>
</body></html>`;
	}
}
