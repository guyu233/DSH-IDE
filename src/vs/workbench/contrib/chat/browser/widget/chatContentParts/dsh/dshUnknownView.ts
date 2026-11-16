/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { DshNodeViewInput, IDshNodeView, asString, isRecord, jsonText } from './dshNodeTypes.js';
import { createCard, createField, createTitleRow } from './dshViewParts.js';

/**
 * `unknown` 视图。
 *
 * 显示 `type`、完整 `data`、完整 `raw`（raw 由外层「原始载荷」详情统一承担）。
 * **禁止**静默返回空节点——未知事件恰恰是最需要被看见的。
 */
export class DshUnknownView implements IDshNodeView {
	readonly domNode: HTMLElement;

	constructor(input: DshNodeViewInput, stores: DisposableStore) {
		const card = createCard('warning');
		card.classList.add('chat-dsh-unknown');

		const type = asString(readValue(input.parsed, 'type')) ?? asString(readValue(input.encodedParsed, 'type')) ?? 'unknown';
		card.appendChild(createTitleRow(Codicon.question, type));

		const body = dom.append(card, dom.$('.chat-dsh-unknown-body'));
		body.appendChild(createField('type', type));
		body.appendChild(createField('data', readValue(input.parsed, 'data')));

		// 完整 data 的原文（便于复制/比对），与字段区并存而不是二选一。
		const pre = dom.append(body, dom.$('pre.chat-dsh-unknown-json'));
		pre.textContent = jsonText(readValue(input.parsed, 'data'));

		this.domNode = card;
		void stores;
	}
}

function readValue(node: unknown, key: string): unknown {
	if (!isRecord(node)) {
		return undefined;
	}
	const data = isRecord(node['data']) ? node['data'] : undefined;
	if (data !== undefined && key in data) {
		return data[key];
	}
	return key in node ? node[key] : undefined;
}
