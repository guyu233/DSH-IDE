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
 * `subagent-catalog`：父会话上的发现事实。
 * 只列出载荷字段。没有 childId / name 就显示缺失，不编造。
 */
export class DshSubagentCatalogView implements IDshNodeView {
	readonly domNode: HTMLElement;

	constructor(input: DshNodeViewInput, stores: DisposableStore) {
		const card = createCard('default');
		card.classList.add('chat-dsh-subagent-catalog');
		card.appendChild(createTitleRow(Codicon.account, input.kind));
		const body = dom.append(card, dom.$('.chat-dsh-subagent-body'));
		for (const key of ['childId', 'name', 'label', 'mode', 'childCreatedAt', 'version'] as const) {
			body.appendChild(createField(key, readValue(input.parsed, key)));
		}
		this.domNode = card;
		void stores;
	}
}

/** `subagent-notice`：source.kind 原样显示，stopReason 缺失就显示缺失。 */
export class DshSubagentNoticeView implements IDshNodeView {
	readonly domNode: HTMLElement;

	constructor(input: DshNodeViewInput, stores: DisposableStore) {
		const card = createCard('default');
		card.classList.add('chat-dsh-subagent-notice');
		card.appendChild(createTitleRow(Codicon.account, input.kind));
		const body = dom.append(card, dom.$('.chat-dsh-subagent-body'));
		const source = readValue(input.parsed, 'source');
		body.appendChild(createField('source.kind', isRecord(source) ? source['kind'] : undefined));
		body.appendChild(createField('stopReason', isRecord(source) ? source['stopReason'] : undefined));
		body.appendChild(createField('source', source));
		body.appendChild(createField('content', readValue(input.parsed, 'content')));
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
