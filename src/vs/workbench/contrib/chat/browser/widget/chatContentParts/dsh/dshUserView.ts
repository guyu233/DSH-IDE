/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { IMarkdownRenderer } from '../../../../../../../platform/markdown/browser/markdownRenderer.js';
import { DshNodeViewInput, IDshNodeView, asArray, asString, dataOf, isRecord, jsonText } from './dshNodeTypes.js';
import { createCard, createField, createTitleRow, renderMarkdown } from './dshViewParts.js';
import { Codicon } from '../../../../../../../base/common/codicons.js';

/**
 * `user` / `steering` 视图。
 *
 * 字段全部从 `projectionEncoded` 读：`content[]`、`source`、`turn`、`messageId`、`time`、`seq`。
 * `steering` 的形态差异只体现在卡片语义上；**不**添加源载荷里没有的说明性文案。
 */
export class DshUserView implements IDshNodeView {
	readonly domNode: HTMLElement;

	constructor(input: DshNodeViewInput, renderer: IMarkdownRenderer, stores: DisposableStore) {
		const steering = input.kind === 'steering';
		const card = createCard('default');
		card.classList.add('chat-dsh-user');
		if (steering) {
			card.classList.add('chat-dsh-steering');
		}

		// 标题：只显示 kind 本身（来自 hint），不写"用户说"之类的编造措辞。
		card.appendChild(createTitleRow(steering ? Codicon.arrowRight : Codicon.account, input.kind));

		const body = dom.append(card, dom.$('.chat-dsh-user-body'));
		const content = asArray(readField(input, 'content'));
		if (content === undefined) {
			body.appendChild(createField('content', undefined));
		} else {
			for (const block of content) {
				body.appendChild(this._renderBlock(block, renderer, stores));
			}
		}

		const meta = dom.append(card, dom.$('.chat-dsh-user-meta'));
		meta.appendChild(createField('turn', readField(input, 'turn')));
		meta.appendChild(createField('messageId', readField(input, 'messageId')));
		meta.appendChild(createField('time', readField(input, 'time')));
		meta.appendChild(createField('seq', readField(input, 'seq')));

		const source = readField(input, 'source');
		if (source !== undefined) {
			meta.appendChild(createField('source', source));
		}

		this.domNode = card;
	}

	/** 逐类渲染 content block；未识别的块显示原始 JSON，绝不丢弃。 */
	private _renderBlock(block: unknown, renderer: IMarkdownRenderer, stores: DisposableStore): HTMLElement {
		if (!isRecord(block)) {
			return createField('block', block);
		}
		const type = asString(block['type']);
		switch (type) {
			case 'text': {
				const text = asString(block['text']);
				if (text === undefined) {
					return createField('text', block);
				}
				return renderMarkdown(stores, renderer, text);
			}
			case 'image':
			case 'file': {
				const box = dom.$('.chat-dsh-attachment');
				const name = attachmentName(block['attachment']);
				const label = dom.append(box, dom.$('.chat-dsh-attachment-name'));
				label.textContent = name ?? type;
				const detail = dom.append(box, dom.$('.chat-dsh-attachment-detail'));
				detail.textContent = jsonText(block['attachment']);
				return box;
			}
			case 'tool-call':
			case 'tool-addition':
			case 'tool-removal':
			case 'other':
			default: {
				// 未识别/非文本块：原始 JSON，不猜测语义。
				return createField(type ?? 'block', block);
			}
		}
	}
}

/** attachment 的显示名只从载荷读；读不到返回 undefined（由调用方回退到 type，不编造）。 */
function attachmentName(attachment: unknown): string | undefined {
	if (!isRecord(attachment)) {
		return undefined;
	}
	const name = asString(attachment['name']);
	if (name !== undefined && name !== '') {
		return name;
	}
	const id = asString(attachment['attachmentId']);
	return id !== undefined && id !== '' ? id : undefined;
}

/** 从 projection 的 data 层或顶层读字段（两种形状都容忍，不伪造）。 */
function readField(input: DshNodeViewInput, key: string): unknown {
	const data = dataOf(input.parsed);
	if (data !== undefined && key in data) {
		return data[key];
	}
	if (isRecord(input.parsed) && key in input.parsed) {
		return input.parsed[key];
	}
	return undefined;
}
