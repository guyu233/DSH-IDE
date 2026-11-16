/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { IMarkdownRenderer } from '../../../../../../../platform/markdown/browser/markdownRenderer.js';
import { DshNodeViewInput, IDshNodeView, asString, isRecord } from './dshNodeTypes.js';
import { createCard, createField, createTitleRow, renderMarkdown } from './dshViewParts.js';

/**
 * `turn-error` 视图。
 *
 * `message` 与 `code` 完整显示。标题文字是 UI chrome（固定的人类可读标签），
 * 不冒充数据；数据只在字段区。
 */
export class DshTurnErrorView implements IDshNodeView {
	readonly domNode: HTMLElement;

	constructor(input: DshNodeViewInput, renderer: IMarkdownRenderer, stores: DisposableStore) {
		const card = createCard('error');
		card.classList.add('chat-dsh-error');
		card.appendChild(createTitleRow(Codicon.error, input.kind));

		const body = dom.append(card, dom.$('.chat-dsh-error-body'));
		body.appendChild(createField('turn', readValue(input.parsed, 'turn')));
		body.appendChild(createField('step', readValue(input.parsed, 'step')));

		const message = asString(readValue(input.parsed, 'message'));
		if (message !== undefined && message !== '') {
			body.appendChild(renderMarkdown(stores, renderer, message));
		} else {
			body.appendChild(createField('message', readValue(input.parsed, 'message')));
		}
		body.appendChild(createField('code', readValue(input.parsed, 'code')));

		this.domNode = card;
	}
}

/** turn-error 的字段在 `data.reason.failure` 下（事件是 turn/end）。 */
function readValue(node: unknown, key: string): unknown {
	if (!isRecord(node)) {
		return undefined;
	}
	const data = isRecord(node['data']) ? node['data'] : undefined;
	if (data !== undefined) {
		if (key in data) {
			return data[key];
		}
		const reason = isRecord(data['reason']) ? data['reason'] : undefined;
		if (reason !== undefined) {
			if (key in reason) {
				return reason[key];
			}
			const failure = isRecord(reason['failure']) ? reason['failure'] : undefined;
			if (failure !== undefined && key in failure) {
				return failure[key];
			}
		}
	}
	return key in node ? node[key] : undefined;
}
