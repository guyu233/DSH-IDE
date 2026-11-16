/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { IMarkdownRenderer } from '../../../../../../../platform/markdown/browser/markdownRenderer.js';
import { DshNodeViewInput, IDshNodeView, asNumber, asString, isRecord } from './dshNodeTypes.js';
import { createCard, createDisclosure, createField, createTitleRow, renderMarkdown } from './dshViewParts.js';

/**
 * `compaction` 视图（压缩检查点）。
 *
 * `summary === null` 显示 null 状态（不可展开）；统计数值缺失时显示缺失，
 * **绝不伪造 0**。
 */
export class DshCompactionView implements IDshNodeView {
	readonly domNode: HTMLElement;

	constructor(input: DshNodeViewInput, renderer: IMarkdownRenderer, stores: DisposableStore) {
		const card = createCard('default');
		card.classList.add('chat-dsh-compaction');
		card.appendChild(createTitleRow(Codicon.archive, input.kind));

		const summary = readNullableString(input.parsed, 'summary');
		if (typeof summary === 'string') {
			const { root, body } = createDisclosure(stores, 'summary', Codicon.book);
			body.appendChild(renderMarkdown(stores, renderer, summary));
			card.appendChild(root);
		} else {
			// null 是真实值：显式呈现，不当作"没有摘要"而隐藏。
			card.appendChild(createField('summary', summary));
		}

		const body = dom.append(card, dom.$('.chat-dsh-compaction-stats'));
		body.appendChild(createField('summaryEventSeq', readValue(input.parsed, 'summaryEventSeq')));
		body.appendChild(createField('shadowedItemCount', readValue(input.parsed, 'shadowedItemCount')));
		body.appendChild(createField('shadowedTokenCount', readValue(input.parsed, 'shadowedTokenCount')));
		body.appendChild(createField('turn', readValue(input.parsed, 'turn')));

		this.domNode = card;
	}
}

/** 读取可能为 null 的字符串：区分 null（真实 null）与缺失（undefined）。 */
function readNullableString(node: unknown, key: string): string | null | undefined {
	const value = readValue(node, key);
	if (value === null) {
		return null;
	}
	return asString(value);
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
