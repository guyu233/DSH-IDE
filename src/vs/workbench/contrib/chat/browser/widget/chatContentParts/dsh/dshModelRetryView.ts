/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { DshNodeViewInput, IDshNodeView, asNumber, asRecordAt, asString, isRecord } from './dshNodeTypes.js';
import { createBadge, createCard, createDisclosure, createField, createTitleRow } from './dshViewParts.js';

/**
 * `model-retry` 视图。
 *
 * `retryState` 三态（scheduled / started / cancelled）用不同徽标；`failure.message` 与
 * `failure.code` 完整显示；`delayMs` 只显示载荷中的数值，不做倒计时推算
 * （推算会引入载荷里不存在的时间信息）。
 */
export class DshModelRetryView implements IDshNodeView {
	readonly domNode: HTMLElement;

	constructor(input: DshNodeViewInput, stores: DisposableStore) {
		const state = asString(readValue(input.parsed, 'retryState'));
		const card = createCard(state === 'cancelled' ? 'warning' : 'default');
		card.classList.add('chat-dsh-retry');

		const titleRow = createTitleRow(Codicon.debugRestart, input.kind);
		if (state !== undefined) {
			titleRow.appendChild(createBadge(state, state === 'cancelled' ? 'warning' : 'default'));
		}
		card.appendChild(titleRow);

		const body = dom.append(card, dom.$('.chat-dsh-retry-body'));
		for (const key of ['retry', 'maxRetries', 'delayMs', 'mode', 'retryState', 'turn']) {
			const value = readValue(input.parsed, key);
			if (value !== undefined) {
				body.appendChild(createField(key, value));
			}
		}

		const failure = readValue(input.parsed, 'failure');
		if (isRecord(failure)) {
			const { root, body: failBody } = createDisclosure(stores, 'failure', Codicon.error);
			failBody.appendChild(createField('failure.message', failure['message']));
			failBody.appendChild(createField('failure.code', failure['code']));
			card.appendChild(root);
		} else if (failure !== undefined) {
			card.appendChild(createField('failure', failure));
		}

		this.domNode = card;
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

void asNumber;
void asRecordAt;
