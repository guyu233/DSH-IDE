/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../../../base/common/themables.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../../../nls.js';
import { DshNodeViewInput, IDshNodeView } from './dshNodeTypes.js';
import { createField, createTitleRow } from './dshViewParts.js';

/**
 * `inherited-history` 视图（fork 继承历史的分界）。
 *
 * 位置由 seq 决定（排序在驱动层完成），此处只画分隔线。
 * 分隔文字是 UI chrome（固定的人类可读标签），不是数据。
 */
export class DshInheritedHistoryView implements IDshNodeView {
	readonly domNode: HTMLElement;

	constructor(input: DshNodeViewInput, stores: DisposableStore) {
		const root = dom.$('.chat-dsh-inherited');
		root.setAttribute('role', 'separator');
		root.setAttribute('aria-orientation', 'horizontal');

		const lineBefore = dom.append(root, dom.$('span.chat-dsh-inherited-line'));
		lineBefore.setAttribute('aria-hidden', 'true');

		const label = dom.append(root, dom.$('span.chat-dsh-inherited-label'));
		label.textContent = localize('chat.dshNode.inheritedHistory', "Inherited history");
		const icon = dom.append(label, dom.$('span.chat-dsh-inherited-icon'));
		icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.history));
		icon.setAttribute('aria-hidden', 'true');

		const lineAfter = dom.append(root, dom.$('span.chat-dsh-inherited-line'));
		lineAfter.setAttribute('aria-hidden', 'true');

		root.setAttribute('aria-label', localize('chat.dshNode.inheritedHistoryLabel', "Inherited history boundary"));

		// turn 是可选字段：有则显示，无则显式缺失，不伪造。
		const meta = dom.append(root, dom.$('.chat-dsh-inherited-meta'));
		meta.appendChild(createField('turn', readTurn(input.parsed)));

		this.domNode = root;
		void stores;
		void createTitleRow;
	}
}

function readTurn(node: unknown): unknown {
	if (typeof node !== 'object' || node === null) {
		return undefined;
	}
	const record = node as Record<string, unknown>;
	const data = typeof record['data'] === 'object' && record['data'] !== null ? record['data'] as Record<string, unknown> : undefined;
	if (data !== undefined && 'turn' in data) {
		return data['turn'];
	}
	return 'turn' in record ? record['turn'] : undefined;
}


