/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { DshNodeViewInput, IDshNodeView, asString, asStringOrNull, isRecord } from './dshNodeTypes.js';
import { createBadge, createCard, createField, createTitleRow } from './dshViewParts.js';

/**
 * `command` 视图（斜杠命令生命周期）。
 *
 * `name === null` / `args === null` / `outcome === null` 都原样显示 null 状态，
 * 绝不填默认文案。成功/失败视觉由 `outcome.kind` 决定。
 */
export class DshCommandView implements IDshNodeView {
	readonly domNode: HTMLElement;

	constructor(input: DshNodeViewInput, stores: DisposableStore) {
		const outcomeValue = readValue(input.parsed, 'outcome');
		const outcomeRecord = isRecord(outcomeValue) ? outcomeValue : undefined;
		const outcomeKind = outcomeRecord === undefined ? undefined : asString(outcomeRecord['kind']);
		const failed = outcomeKind === 'error';

		const card = createCard(failed ? 'error' : 'default');
		card.classList.add('chat-dsh-command');

		const name = asStringOrNull(readValue(input.parsed, 'name'));
		const titleRow = createTitleRow(Codicon.terminal, name ?? 'command');
		if (outcomeKind !== undefined) {
			titleRow.appendChild(createBadge(outcomeKind, failed ? 'error' : 'success'));
		}
		card.appendChild(titleRow);

		const body = dom.append(card, dom.$('.chat-dsh-command-body'));
		body.appendChild(createField('commandId', readValue(input.parsed, 'commandId')));
		body.appendChild(createField('name', name));
		body.appendChild(createField('args', asStringOrNull(readValue(input.parsed, 'args'))));
		body.appendChild(createField('turn', readValue(input.parsed, 'turn')));

		if (outcomeRecord !== undefined) {
			body.appendChild(createField('outcome.kind', outcomeRecord['kind']));
			body.appendChild(createField('outcome.text', outcomeRecord['text']));
		} else {
			body.appendChild(createField('outcome', null));
		}

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

