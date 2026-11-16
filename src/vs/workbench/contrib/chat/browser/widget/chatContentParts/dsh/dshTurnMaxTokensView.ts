/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { DshNodeViewInput, IDshNodeView, isRecord } from './dshNodeTypes.js';
import { createCard, createField, createTitleRow } from './dshViewParts.js';

/**
 * `turn-max-tokens` 视图。
 *
 * 只显示载荷里真实存在的 `turn` / `step`。**不**添加载荷没有的 token 数字或解释性文本。
 */
export class DshTurnMaxTokensView implements IDshNodeView {
	readonly domNode: HTMLElement;

	constructor(input: DshNodeViewInput, stores: DisposableStore) {
		const card = createCard('warning');
		card.classList.add('chat-dsh-max-tokens');
		card.appendChild(createTitleRow(Codicon.warning, input.kind));

		const body = dom.append(card, dom.$('.chat-dsh-max-tokens-body'));
		body.appendChild(createField('turn', readValue(input.parsed, 'turn')));
		body.appendChild(createField('step', readValue(input.parsed, 'step')));

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
