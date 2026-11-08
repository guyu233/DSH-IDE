/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 聊天渲染「单接缝」适配层。
//
// 目标（用户最终锁定）：改造 VS Code 现有 AI 聊天侧边栏，使其按需接待复用的 DSH ui-chat
// 渲染件；不是另建接待层、独立页面或启动整套 DSH React/Cordis 框架。
//
// 本文件是 VS Code src 侧唯一的接缝实现：
//   - **零 React / JSX import**：上游 src/tsconfig 无 jsx、无 @types/react；React 全部封装在
//     `build/dsh/chat-render/dist/dsh-chat.js` sidecar（唯一一份 React 18.3.1）里，运行时经
//     dynamic import() 加载。该制品由官方 gulp `prepare-dsh-chat-render` 任务现编后写入
//     `out/vs/workbench/contrib/dsh/browser/chatRender/`（见 gulpfile.vscode.ts），不入库。
//   - 一个 `IChatContentPart` ⇔ 一个 `createRoot`（由 sidecar 的 mountDshChatPart 持有），
//     `hasSameContent` 命中时走 `handle.update(props)` 增量渲染，绝不每个流式 token 建 root。
//   - 仅接管 DSH 展示部件（thinking / markdownContent / progressMessage 中的 DSH 前缀 / working）；
//     其余一切内容返回 undefined 交回原生 renderContentPart，行为与纯净 VS Code 一致。
//   - 工具调用（toolInvocation）**保留 VS Code 现有渲染件**：DSH ui-chat 的
//     AssistantMarkdown 明确跳过 tool-call 块，真正的 ToolRow 属于另一个包，不谎称已复用。
//
// 数据契约：DSH session/follow 原始事件映射为 `DshTurnPart`。旧映射实现（chatClient 下）已在阶段 3 第三批删除，由新连接层重建。
// 中立回合部件（DshTurnPart），再由本适配层转成 DshPartProps 交给 sidecar 组件。

import { Disposable } from '../../../../base/common/lifecycle.js';
import { FileAccess } from '../../../../base/common/network.js';
import { IMarkdownString, MarkdownString } from '../../../../base/common/htmlContent.js';
import { IMarkdownRenderer } from '../../../../platform/markdown/browser/markdownRenderer.js';
import { IChatContentPart } from '../../chat/browser/widget/chatContentParts/chatContentParts.js';
import { IChatRendererContent } from '../../chat/common/model/chatViewModel.js';
import type { ChatTreeItem } from '../../chat/browser/chat.js';

/** sidecar 导出的最小契约（与 build/dsh/chat-render/index.tsx 的 DshPartProps 对齐，结构化避免类型依赖）。 */
type DshPartProps =
	| { kind: 'reasoning'; text: string; running?: boolean }
	| { kind: 'markdown'; blocks: readonly unknown[]; streaming?: boolean }
	| { kind: 'user'; content: { text: string } }
	| { kind: 'stats'; usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } }
	| { kind: 'running'; startTime?: number; label?: string };

interface DshChatHandle {
	update(props: DshPartProps): void;
	dispose(): void;
	readonly domNode: HTMLElement;
}

interface DshChatSidecar {
	mountDshChatPart(domNode: HTMLElement, props: DshPartProps): DshChatHandle;
	setMarkdownDomRenderer(renderer: ((options: { text: string; streaming: boolean }) => Node | string | void) | null): void;
	setLocale(locale: string): void;
}

/** DSH progressMessage 的前缀（与历史 dshPartsContract.ts 一致；数据面由 DSH Host 权威提供）。 */
export const DSH_TOOL_PREFIX = 'dsh-tool:';
export const DSH_STEP_PREFIX = 'dsh-step:';
export const DSH_USAGE_ID = 'dsh-usage';

/** 是否处于 DSH 渲染模式（仅当本进程由 DSH Host 拉起且已连上 Host 时由 contribution 打开）。 */
let dshChatRenderEnabled = false;
export function setDshChatRenderEnabled(v: boolean): void { dshChatRenderEnabled = v; }
export function isDshChatRenderEnabled(): boolean { return dshChatRenderEnabled; }

/** VS Code 官方 Markdown 渲染器（由 chatListRenderer 在构造时注入一次）。未注入时 sidecar 降级转义纯文本。 */
let markdownRenderer: IMarkdownRenderer | undefined;
export function setDshMarkdownRenderer(renderer: IMarkdownRenderer | undefined): void { markdownRenderer = renderer; }

/**
 * 把 VS Code 的 IMarkdownRenderer 适配为 sidecar 的 DOM 渲染器：产出真实 DOM Node，
 * 保留 Mermaid/Markdown/代码高亮等 VS Code 既有能力，不把 VS Code src 模块图拉进 bundle。
 */
function vscodeMarkdownDomRenderer(options: { text: string; streaming: boolean }): Node | void {
	if (!markdownRenderer) { return; }
	const rendered = markdownRenderer.render(new MarkdownString(options.text));
	return rendered.element;
}

/** sidecar 只加载一次（同一份 React、同一份 CSS 注入）。 */
let sidecarPromise: Promise<DshChatSidecar | undefined> | undefined;

/**
 * sidecar 相对 `out/` 的资源路径（由官方 gulp `prepare-dsh-chat-render` 任务写入）。
 * 用 FileAccess.asBrowserUri 而不是相对 import()：bundle 后的模块 URL 是
 * `out/vs/workbench/`，相对路径会解析到错误目录（历史上 sidecar 因此从未真正加载）。
 */
export const DSH_CHAT_SIDECAR_PATH = 'vs/workbench/contrib/dsh/browser/chatRender/dsh-chat.js';

function loadSidecar(): Promise<DshChatSidecar | undefined> {
	if (!sidecarPromise) {
		// 加载失败时安全降级（返回 undefined → 交回原生渲染）。
		let sidecarUrl: string;
		try {
			sidecarUrl = FileAccess.asBrowserUri(DSH_CHAT_SIDECAR_PATH).toString(true);
		} catch {
			return Promise.resolve(undefined);
		}
		sidecarPromise = import(/* webpackIgnore: true */ sidecarUrl)
			.then((m: unknown) => {
				const sidecar = (m as { default?: DshChatSidecar }).default ?? (m as DshChatSidecar);
				// 注入一次：真实 VS Code Markdown 渲染（不是转义纯文本）。
				try { sidecar.setMarkdownDomRenderer(vscodeMarkdownDomRenderer); } catch { /* 旧制品无此导出时降级 */ }
				try { sidecar.setLocale(typeof navigator !== 'undefined' ? navigator.language : 'en'); } catch { /* ignore */ }
				return sidecar;
			})
			.catch(() => undefined);
	}
	return sidecarPromise;
}

function markdownText(v: IMarkdownString | string | undefined): string {
	if (v === undefined || v === null) { return ''; }
	if (typeof v === 'string') { return v; }
	return v.value ?? '';
}

/**
 * 把一个 IChatRendererContent 转成 DshPartProps；返回 undefined 表示该部件不由 DSH 接管。
 * 纯函数、可单测（无需 DOM）。
 */
export function toDshPartProps(content: IChatRendererContent, isComplete: boolean): DshPartProps | undefined {
	if (content.kind === 'thinking') {
		const v = content.value;
		const text = Array.isArray(v) ? v.join('') : (v ?? '');
		return { kind: 'reasoning', text, running: !isComplete };
	}
	if (content.kind === 'markdownContent') {
		const text = markdownText(content.content);
		return { kind: 'markdown', blocks: [{ type: 'text', text }], streaming: !isComplete };
	}
	if (content.kind === 'progressMessage') {
		const id = content.id;
		const text = markdownText(content.content);
		if (id === DSH_USAGE_ID || id?.startsWith(DSH_TOOL_PREFIX) || id?.startsWith(DSH_STEP_PREFIX)) {
			// DSH 工具/步骤/用量：统一折叠成一条 DSH 风格进度行（工具主体仍由 VS Code 原生渲染）。
			return { kind: 'running', label: text };
		}
		return undefined;
	}
	if (content.kind === 'working') {
		return { kind: 'running', startTime: Date.now() };
	}
	return undefined;
}

/**
 * 单接缝 ContentPart：内部持有 sidecar 的一个 React root。
 * 加载是异步的；加载完成前 domNode 已存在（空容器），完成后挂载/更新。
 */
export class DshChatContentPart extends Disposable implements IChatContentPart {
	readonly domNode: HTMLElement;
	private handle: DshChatHandle | undefined;
	private props: DshPartProps;
	private disposed = false;

	constructor(props: DshPartProps) {
		super();
		this.props = props;
		this.domNode = document.createElement('div');
		this.domNode.classList.add('dsh-chat-part');
		void this.mount();
	}

	private async mount(): Promise<void> {
		const sidecar = await loadSidecar();
		if (this.disposed || !sidecar) { return; }
		this.handle = sidecar.mountDshChatPart(this.domNode, this.props);
	}

	/** 流式增量：同一 root 重新 render，不新建 root。 */
	setProps(props: DshPartProps): void {
		this.props = props;
		this.handle?.update(props);
	}

	hasSameContent(other: IChatRendererContent, _followingContent: IChatRendererContent[], element: ChatTreeItem): boolean {
		const next = toDshPartProps(other, element.isComplete);
		if (!next) { return false; }
		// 同一类部件复用已有 React root；内容变化走 update（避免流式重建）。
		if (next.kind !== this.props.kind) { return false; }
		this.setProps(next);
		return true;
	}

	override dispose(): void {
		if (this.disposed) { return; }
		this.disposed = true;
		try { this.handle?.dispose(); } catch { /* root 可能尚未挂载完成 */ }
		this.handle = undefined;
		super.dispose();
	}
}

/**
 * 给 chatListRenderer.renderContentPart 用的**唯一入口**：
 * 返回 DshChatContentPart 时由 DSH 渲染；返回 undefined 时交回原生逻辑。
 */
export function tryRenderDshChatPart(content: IChatRendererContent, element: ChatTreeItem): IChatContentPart | undefined {
	if (!dshChatRenderEnabled) { return undefined; }
	const props = toDshPartProps(content, element.isComplete);
	if (!props) { return undefined; }
	return new DshChatContentPart(props);
}

/** 暴露给单测：重置模块级状态（不影响真实运行）。 */
export function resetDshChatSeamForTest(): void {
	dshChatRenderEnabled = false;
	sidecarPromise = undefined;
	markdownRenderer = undefined;
}
