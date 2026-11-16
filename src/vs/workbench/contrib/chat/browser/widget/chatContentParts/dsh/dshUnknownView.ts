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
 * 显示真实 `type`（没有就不编造）、`data`，以及整份投影。
 * 插件块的字段可能不在 `data` 下，因此投影原文必须可见，且不补缺省字段。
 * `encoded` 由外层「原始载荷」逐字显示并可复制。
 * **禁止**静默返回空节点——未知事件恰恰是最需要被看见的。
 */
export class DshUnknownView implements IDshNodeView {
	readonly domNode: HTMLElement;

	constructor(input: DshNodeViewInput, stores: DisposableStore) {
		const card = createCard('warning');
		card.classList.add('chat-dsh-unknown');

		const type = asString(readValue(input.parsed, 'type')) ?? asString(readValue(input.encodedParsed, 'type'));
		card.appendChild(createTitleRow(Codicon.question, type ?? input.kind));

		const body = dom.append(card, dom.$('.chat-dsh-unknown-body'));
		body.appendChild(createField('type', type));
		body.appendChild(createField('data', readValue(input.parsed, 'data')));

		// 插件块等未知载荷原样展开，不假设字段名，也不改写值。
		const pre = dom.append(body, dom.$('pre.chat-dsh-unknown-json'));
		pre.textContent = jsonText(input.parsed);

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
