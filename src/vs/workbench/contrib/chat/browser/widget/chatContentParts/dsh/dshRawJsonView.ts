/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../../../base/common/themables.js';
import { localize } from '../../../../../../../nls.js';
import { DshNodeViewInput, IDshNodeView } from './dshNodeTypes.js';

/**
 * 「原始载荷」详情。
 *
 * 每个 DSH 节点都会挂一个本视图，内容**逐字**取自 `input.encoded`（源载荷 canonical）。
 * 它的存在是渲染完整性的兜底：专用视图可以只展开部分字段，但只要本区域存在，
 * 就没有任何源字段会从界面上消失。
 *
 * 折叠状态只是 UI 状态，不写回 encoded，因此不违反无损性。
 */
export class DshRawJsonView implements IDshNodeView {
	readonly domNode: HTMLElement;

	constructor(input: DshNodeViewInput, stores: DisposableStore) {
		const details = dom.$('details.chat-dsh-raw');
		const summary = dom.append(details, dom.$('summary.chat-dsh-raw-summary'));

		const icon = dom.append(summary, dom.$('span.chat-dsh-raw-icon'));
		icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.json));
		icon.setAttribute('aria-hidden', 'true');

		const label = dom.append(summary, dom.$('span.chat-dsh-raw-label'));
		label.textContent = localize('chat.dshNode.rawPayload', "Raw payload");

		const pre = dom.append(details, dom.$('pre.chat-dsh-raw-json'));
		// 逐字显示 encoded：不解码、不重排、不裁剪。
		pre.textContent = input.encoded;

		this.domNode = details;
		void stores;
	}
}
