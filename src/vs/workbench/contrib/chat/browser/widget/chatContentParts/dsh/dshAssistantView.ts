/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { IMarkdownRenderer } from '../../../../../../../platform/markdown/browser/markdownRenderer.js';
import { DshNodeViewInput, IDshNodeView, asArray, asBoolean, asString, isRecord, jsonText } from './dshNodeTypes.js';
import { createBadge, createCard, createDisclosure, createField, createTitleRow, renderMarkdown } from './dshViewParts.js';

/**
 * `assistant` 视图。
 *
 * 处理 `blocks[]`（text / reasoning / image / tool-call / other）与
 * `turn`/`step`/`usage`/`providerMetadata`/`requestConfig`/`timing`/`interrupted`。
 *
 * `interrupted` 只显示"已中断"这一状态；该状态来自载荷布尔值，不是编造。
 */
export class DshAssistantView implements IDshNodeView {
	readonly domNode: HTMLElement;

	constructor(input: DshNodeViewInput, renderer: IMarkdownRenderer, stores: DisposableStore) {
		const card = createCard('default');
		card.classList.add('chat-dsh-assistant');

		const titleRow = createTitleRow(Codicon.sparkle, input.kind);
		if (asBoolean(readField(input, 'interrupted')) === true) {
			titleRow.appendChild(createBadge('interrupted', 'warning'));
		}
		card.appendChild(titleRow);

		const body = dom.append(card, dom.$('.chat-dsh-assistant-body'));
		const blocks = asArray(readField(input, 'blocks'));
		if (blocks === undefined) {
			body.appendChild(createField('blocks', undefined));
		} else {
			for (const block of blocks) {
				body.appendChild(this._renderBlock(block, renderer, stores));
			}
		}

		// usage / providerMetadata / requestConfig / timing：有则展示，无则显式缺失。
		const meta = dom.append(card, dom.$('.chat-dsh-assistant-meta'));
		for (const key of ['turn', 'step', 'usage', 'providerMetadata', 'requestConfig', 'timing', 'messageId', 'time', 'seq']) {
			const value = readField(input, key);
			if (value !== undefined) {
				meta.appendChild(createField(key, value));
			}
		}

		this.domNode = card;
	}

	private _renderBlock(block: unknown, renderer: IMarkdownRenderer, stores: DisposableStore): HTMLElement {
		if (!isRecord(block)) {
			return createField('block', block);
		}
		const kind = asString(block['kind']);
		switch (kind) {
			case 'text': {
				const text = asString(block['text']);
				return text === undefined ? createField('text', block) : renderMarkdown(stores, renderer, text);
			}
			case 'reasoning': {
				const text = asString(block['text']);
				const { root, body } = createDisclosure(stores, 'reasoning', Codicon.lightbulb);
				if (text === undefined) {
					body.appendChild(createField('text', block));
				} else {
					body.appendChild(renderMarkdown(stores, renderer, text));
				}
				return root;
			}
			case 'image': {
				const box = dom.$('.chat-dsh-attachment');
				const name = dom.append(box, dom.$('.chat-dsh-attachment-name'));
				name.textContent = 'image';
				const detail = dom.append(box, dom.$('.chat-dsh-attachment-detail'));
				detail.textContent = jsonText(block['attachment']);
				return box;
			}
			case 'tool-call': {
				const { root, body } = createDisclosure(stores, asString(block['name']) ?? 'tool-call', Codicon.tools);
				body.appendChild(createField('callId', block['callId']));
				body.appendChild(createField('argsRaw', block['argsRaw']));
				return root;
			}
			default:
				return createField(kind ?? 'block', block);
		}
	}
}

/** 从 projection 的 data 层（assistant 的字段在 data 与 data.message 两处）读取。 */
function readField(input: DshNodeViewInput, key: string): unknown {
	const root = input.parsed;
	if (!isRecord(root)) {
		return undefined;
	}
	const data = isRecord(root['data']) ? root['data'] : undefined;
	if (data !== undefined && key in data) {
		return data[key];
	}
	const message = data !== undefined && isRecord(data['message']) ? data['message'] : undefined;
	if (message !== undefined && key in message) {
		return message[key];
	}
	if (key in root) {
		return root[key];
	}
	return undefined;
}

