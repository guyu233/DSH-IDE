/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH 视觉渲染部件（Q13-B，逐部件，低风险）。
//
// 数据面：DshChatBridge 把 DSH 官方 session/follow 事件翻译成「原生安全」部件
//   —— thinking / markdownContent / progressMessage(id 带 dsh- 前缀区分工具/步骤/用量)。
// 渲染面：本文件对「思考 / 工具调用 / 步骤 / 用量」提供 DSH 风格原生 ContentPart，
//   严格跟随 ui-chat 的 transcriptView(compact|standard|detailed|verbose) 与
//   collapseTiming(completion|next-input)（compact 隐藏步骤/用量；detailed/verbose 展开思考）。
//   正文 markdown 仍走原生。逐部件渲染天然适配虚拟化与流式增量。

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IMarkdownRenderer } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { ChatTreeItem } from '../../chat.js';
import { IChatRendererContent } from '../../../common/model/chatViewModel.js';
import { IChatContentPart } from './chatContentParts.js';
import * as dom from '../../../../../base/browser/dom.js';
import { IMarkdownString } from '../../../../../base/common/htmlContent.js';
import { DSH_TOOL_PREFIX, DSH_STEP_PREFIX, DSH_USAGE_ID } from '../../../common/chatService/dshPartsContract.js';
import './media/dshChatParts.css';

export type TranscriptView = 'compact' | 'standard' | 'detailed' | 'verbose';
export type CollapseTiming = 'completion' | 'next-input';

/** 仅当本进程已连到 DSH Host 时由 dsh.contribution 打开，避免影响纯净 VS Code。 */
export let dshTranscriptEnabled = false;
export function setDshTranscriptEnabled(v: boolean): void { dshTranscriptEnabled = v; }

/** DSH 显示设置快照（来自 ui-chat 命名空间 settings/describe）。 */
export let dshTranscriptSettings: { transcriptView: TranscriptView; collapseTiming: CollapseTiming } = {
	transcriptView: 'standard', collapseTiming: 'completion',
};
export function setDshTranscriptSettings(s: { transcriptView: TranscriptView; collapseTiming: CollapseTiming }): void {
	dshTranscriptSettings = { transcriptView: s.transcriptView, collapseTiming: s.collapseTiming };
}

function toPlain(md: IMarkdownString | string | undefined): string {
	if (md === undefined || md === null) { return ''; }
	if (typeof md === 'string') { return md; }
	return md.value ?? '';
}

abstract class DshBasePart extends Disposable implements IChatContentPart {
	readonly domNode: HTMLElement;
	protected constructor(root: HTMLElement) { super(); this.domNode = root; }
	abstract hasSameContent(other: IChatRendererContent, followingContent: IChatRendererContent[], element: ChatTreeItem): boolean;
}

/** 思考块：DSH 的「思考」折叠块，是否展开跟随 transcriptView。 */
class DshThinkingPart extends DshBasePart {
	private readonly _value: string;
	constructor(value: string, markdown: IMarkdownRenderer) {
		const root = dom.$('details.dsh-thinking');
		const view = dshTranscriptSettings.transcriptView;
		(root as HTMLDetailsElement).open = view === 'verbose' || view === 'detailed';
		super(root);
		this._value = value;
		root.appendChild(dom.$('summary.dsh-thinking-summary', undefined, '思考'));
		const body = dom.$('.dsh-thinking-body');
		const rendered = markdown.render({ value: value || '' });
		body.appendChild(rendered.element);
		this._register(rendered);
		root.appendChild(body);
	}
	hasSameContent(other: IChatRendererContent): boolean {
		return other.kind === 'thinking' && toPlain((other as { value?: string }).value as string) === this._value;
	}
}

/** 一行 DSH 风格的文本行（工具 / 步骤 / 用量复用；图标字形已含在文本里）。 */
class DshLinePart extends DshBasePart {
	private readonly _id: string;
	private readonly _text: string;
	constructor(cls: string, content: IChatRendererContent) {
		const text = toPlain((content as { content?: IMarkdownString }).content);
		const row = dom.$(`.${cls}`);
		if (text) { row.textContent = text; }
		super(row);
		this._id = String((content as { id?: string }).id ?? '');
		this._text = text;
	}
	hasSameContent(other: IChatRendererContent): boolean {
		return other.kind === 'progressMessage'
			&& String((other as { id?: string }).id ?? '') === this._id
			&& toPlain((other as { content?: IMarkdownString }).content) === this._text;
	}
}

/**
 * 单接缝工厂：启用且为该响应里的 DSH 展示部件时返回 DSH 风格部件；否则 undefined（原生渲染）。
 * progressMessage 按 id 前缀区分：工具/步骤/用量。
 */
export function renderDshPart(content: IChatRendererContent, markdown: IMarkdownRenderer): IChatContentPart | undefined {
	if (!dshTranscriptEnabled || !content) { return undefined; }
	const view = dshTranscriptSettings.transcriptView;
	switch (content.kind) {
		case 'thinking':
			return new DshThinkingPart(toPlain((content as { value?: string }).value as string), markdown);
		case 'progressMessage': {
			const id = String((content as { id?: string }).id ?? '');
			if (id.startsWith(DSH_TOOL_PREFIX)) { return new DshLinePart('dsh-tool', content); }
			if (id.startsWith(DSH_STEP_PREFIX)) { return view === 'compact' ? undefined : new DshLinePart('dsh-step', content); }
			if (id === DSH_USAGE_ID) { return view === 'compact' ? undefined : new DshLinePart('dsh-usage', content); }
			return undefined; // 非 DSH 的 progressMessage 交回原生
		}
		default:
			return undefined;
	}
}
