/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 聊天渲染 sidecar 的加载与挂载。
//
// 画面是 DSH 自己的：部件形状 `DshPartProps` 与 `build/dsh/chat-render/index.tsx` 同名同义。
// **零 React / JSX import**：React 全部封装在 sidecar（唯一一份 React 18.3.1），运行时动态加载。
// 每个聊天条目 ⇔ 一个 root；流式增量走 `handle.update(props)`，不重建 root。
//
// 本文件不做任何 DSH 事件 → 行的翻译：帧的解码在 `dshChatModel.ts`，这里只负责把部件交给
// 抄来的渲染件。

import { Disposable } from '../../../../base/common/lifecycle.js';
import { FileAccess } from '../../../../base/common/network.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { IMarkdownRenderer } from '../../../../platform/markdown/browser/markdownRenderer.js';

/** sidecar 导出的最小契约（与 build/dsh/chat-render/index.tsx 的 DshPartProps 对齐，结构化避免类型依赖）。 */
export type DshPartProps =
	| { kind: 'reasoning'; text: string; running?: boolean }
	| { kind: 'markdown'; blocks: readonly unknown[]; streaming?: boolean; interrupted?: boolean }
	| { kind: 'user'; content: { text: string } }
	| { kind: 'stats'; usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } }
	| { kind: 'running'; startTime?: number; label?: string; paused?: boolean };

export interface DshChatHandle {
	update(props: DshPartProps): void;
	dispose(): void;
	readonly domNode: HTMLElement;
}

interface DshChatSidecar {
	mountDshChatPart(domNode: HTMLElement, props: DshPartProps): DshChatHandle;
	setMarkdownDomRenderer(renderer: ((options: { text: string; streaming: boolean }) => Node | string | void) | null): void;
	setLocale(locale: string): void;
}

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

/**
 * sidecar 相对 `out/` 的资源路径（由官方 gulp `prepare-dsh-chat-render` 任务写入）。
 * 用 FileAccess.asBrowserUri 而不是相对 import()：bundle 后的模块 URL 是
 * `out/vs/workbench/`，相对路径会解析到错误目录（历史上 sidecar 因此从未真正加载）。
 */
export const DSH_CHAT_SIDECAR_PATH = 'vs/workbench/contrib/dsh/browser/chatRender/dsh-chat.js';

/** sidecar 只加载一次（同一份 React、同一份 CSS 注入）。 */
let sidecarPromise: Promise<DshChatSidecar | undefined> | undefined;

export function loadDshChatSidecar(): Promise<DshChatSidecar | undefined> {
	if (!sidecarPromise) {
		// 加载失败时安全降级（返回 undefined → 调用方不挂载）。
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

/**
 * 一个聊天条目的渲染件：内部持有 sidecar 的一个 React root。
 * 加载是异步的；加载完成前 domNode 已存在（空容器），完成后挂载/更新。
 */
export class DshChatEntryPart extends Disposable {
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
		const sidecar = await loadDshChatSidecar();
		if (this.disposed || !sidecar) { return; }
		this.handle = sidecar.mountDshChatPart(this.domNode, this.props);
	}

	/** 流式增量：同一 root 重新 render，不新建 root。 */
	setProps(props: DshPartProps): void {
		this.props = props;
		this.handle?.update(props);
	}

	override dispose(): void {
		if (this.disposed) { return; }
		this.disposed = true;
		try { this.handle?.dispose(); } catch { /* root 可能尚未挂载完成 */ }
		this.handle = undefined;
		super.dispose();
	}
}

/** 暴露给单测：重置模块级状态（不影响真实运行）。 */
export function resetDshChatSeamForTest(): void {
	sidecarPromise = undefined;
	markdownRenderer = undefined;
}
