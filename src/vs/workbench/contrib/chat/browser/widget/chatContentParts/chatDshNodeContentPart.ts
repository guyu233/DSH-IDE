/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { renderAsPlaintext } from '../../../../../../base/browser/markdownRenderer.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { localize } from '../../../../../../nls.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IMarkdownRenderer } from '../../../../../../platform/markdown/browser/markdownRenderer.js';
import { IChatDshNodePart } from '../../../common/chatService/chatService.js';
import { IChatRendererContent } from '../../../common/model/chatViewModel.js';
import { IChatContentPart } from './chatContentParts.js';

/**
 * DSH 会话节点的原生渲染部件。
 *
 * 纯度约束（「不增不减」的渲染侧保证）：
 * - **唯一**数据源是 `part.encoded`；本文件不读任何其它状态，也不认识 `DshChatNode` 类型。
 * - 渲染结果必须是 `decode(encoded)` 的函数：同样的 encoded 必然得到同样的 DOM 内容。
 * - 任何解码失败都降级为**原样**显示 encoded 文本，绝不丢弃、绝不猜造标签。
 *
 * 之所以先落一个"结构化 JSON 视图"而不是逐类子视图：先把无损通路打通并可证，
 * 逐类组件（UserBubble / ToolCallTree / TurnUsagePanel…）只需替换本文件内部的
 * `renderNode` 分派，`encoded` 契约不变。
 */
export class ChatDshNodeContentPart extends Disposable implements IChatContentPart {
	readonly domNode: HTMLElement;

	constructor(
		private readonly part: IChatDshNodePart,
		renderer: IMarkdownRenderer,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		void instantiationService;
		void renderer;
		this.domNode = this._renderNode(part);
	}

	private _renderNode(part: IChatDshNodePart): HTMLElement {
		let parsed: unknown;
		let ok = true;
		try {
			parsed = JSON.parse(part.encoded);
		} catch {
			ok = false;
		}

		const container = dom.$('.chat-dsh-node');
		container.setAttribute('data-dsh-node-id', part.id);

		if (!ok) {
			// 解码失败：原样显示 encoded，不丢信息。
			const fallback = dom.append(container, dom.$('.chat-dsh-node-raw'));
			fallback.textContent = part.encoded;
			return container;
		}

		const kind = this._kindOf(parsed);
		container.setAttribute('data-dsh-node-kind', kind);

		const header = dom.append(container, dom.$('.chat-dsh-node-header'));
		const icon = dom.append(header, dom.$('span.chat-dsh-node-icon'));
		icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.json));
		icon.setAttribute('aria-hidden', 'true');
		const label = dom.append(header, dom.$('span.chat-dsh-node-label'));
		// 标签只写 kind 本身（来自 encoded），不添加任何原文没有的措辞。
		label.textContent = kind;

		const body = dom.append(container, dom.$('.chat-dsh-node-body'));
		const pre = dom.append(body, dom.$('pre.chat-dsh-node-json'));
		// 逐字呈现 canonical JSON：这是"完整呈现、无伪造、无遗漏"的当前形态。
		pre.textContent = JSON.stringify(parsed, null, 2);

		container.setAttribute('aria-label', localize('chat.dshNode.label', "DSH node {0}", kind));
		return container;
	}

	/** 只从 encoded 派生：取节点自身的判别字段，取不到就是 `unknown`。 */
	private _kindOf(parsed: unknown): string {
		if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
			const record = parsed as Record<string, unknown>;
			const kind = record['kind'];
			if (typeof kind === 'string' && kind !== '') {
				return kind;
			}
			const type = record['type'];
			if (typeof type === 'string' && type !== '') {
				return type;
			}
		}
		return 'unknown';
	}

	hasSameContent(other: IChatRendererContent): boolean {
		return other.kind === 'dshNode' && other.id === this.part.id && other.encoded === this.part.encoded;
	}
}

/** 供无障碍视图/纯文本导出使用：把 encoded 还原为可读文本，不引入新语义。 */
export function dshNodePartPlaintext(part: IChatDshNodePart): string {
	try {
		return renderAsPlaintext(new MarkdownString(JSON.stringify(JSON.parse(part.encoded), null, 2)));
	} catch {
		return part.encoded;
	}
}
