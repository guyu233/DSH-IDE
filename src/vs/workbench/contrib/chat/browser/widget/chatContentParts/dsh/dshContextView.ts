/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { IMarkdownRenderer } from '../../../../../../../platform/markdown/browser/markdownRenderer.js';
import { DshNodeViewInput, IDshNodeView, asArray, asString, isRecord } from './dshNodeTypes.js';
import { createCard, createDisclosure, createField, createTitleRow, renderMarkdown } from './dshViewParts.js';

/**
 * `context` 视图（上下文注入折叠行）。
 *
 * 折叠行只显示 producer/form 这类来自载荷的标识；正文与所有字段都在展开区。
 * `form` 不转译、不美化——原样显示载荷里的值。
 */
export class DshContextView implements IDshNodeView {
	readonly domNode: HTMLElement;

	constructor(input: DshNodeViewInput, renderer: IMarkdownRenderer, stores: DisposableStore) {
		const card = createCard('default');
		card.classList.add('chat-dsh-context');

		const producer = readField(input, 'producer');
		const form = readField(input, 'form');
		const producerLabel = isRecord(producer) ? asString(producer['label']) : undefined;
		const summaryText = producerLabel ?? input.kind;

		const { root, body } = createDisclosure(stores, summaryText, Codicon.archive);
		card.appendChild(root);

		body.appendChild(createField('producer', producer));
		body.appendChild(createField('form', form));
		body.appendChild(createField('turn', readField(input, 'turn')));
		body.appendChild(createField('source', readField(input, 'source')));

		const content = asArray(readField(input, 'content'));
		if (content === undefined) {
			body.appendChild(createField('content', undefined));
		} else {
			const contentBox = dom.append(body, dom.$('.chat-dsh-context-content'));
			for (const block of content) {
				if (!isRecord(block)) {
					contentBox.appendChild(createField('block', block));
					continue;
				}
				const type = asString(block['type']);
				if (type === 'text') {
					const text = asString(block['text']);
					contentBox.appendChild(text === undefined ? createField('text', block) : renderMarkdown(stores, renderer, text));
				} else {
					contentBox.appendChild(createField(type ?? 'block', block));
				}
			}
		}

		this.domNode = card;
	}
}

function readField(input: DshNodeViewInput, key: string): unknown {
	const root = input.parsed;
	if (!isRecord(root)) {
		return undefined;
	}
	const data = isRecord(root['data']) ? root['data'] : undefined;
	if (data !== undefined && key in data) {
		return data[key];
	}
	return key in root ? root[key] : undefined;
}

void createTitleRow;
