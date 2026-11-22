/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 把原生 `ChatAttachmentsContentPart` 包成 `IChatContentPart`。
//
// 为什么需要这一层：原生那个类只继承 `Disposable`，没有实现 `IChatContentPart`
// （缺 `hasSameContent`），而 `renderDshAdaptedPart` 的返回类型要求它。
// 有了这层，DSH 的图片与文件卡就能直接复用原生的缩略图、点击打开、hover 预览与主题适配，
// 不必再用「列出附件名」的回退行（AGENTS §1.7 记录的优化机会）。

import { Disposable } from '../../../../../base/common/lifecycle.js';
import type { IChatContentPart } from '../../../chat/browser/widget/chatContentParts/chatContentParts.js';
import type { IChatRendererContent } from '../../../chat/common/model/chatViewModel.js';
import type { ChatTreeItem } from '../../../chat/browser/chat.js';
import type { ChatAttachmentsContentPart } from '../../../chat/browser/widget/chatContentParts/chatAttachmentsContentPart.js';

export class DshAttachmentListContentPart extends Disposable implements IChatContentPart {
	readonly domNode: HTMLElement | undefined;

	constructor(inner: ChatAttachmentsContentPart) {
		super();
		this._register(inner);
		this.domNode = inner.domNode;
	}

	/**
	 * 附件列表的内容只由构造时的变量决定，之后不再变化。
	 *
	 * 这里返回 `false`（与原生 `ChatAgentCommandContentPart` 同策略）：DSH 侧每次重建
	 * 都会给出新的 part 实例，重绘一次比「误判相同后不更新」安全。
	 */
	hasSameContent(_other: IChatRendererContent, _followingContent: IChatRendererContent[], _element: ChatTreeItem): boolean {
		return false;
	}
}
