/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// history 里的 dshSlotHost 只有 treeId。渲染时从这里取那一棵树，不把节点再序列化进 part。

import type { DshConversationNodeTree } from './dshConversationNodeTree.js';
import type { DshExpansionStateStore } from './dshExpansionStateStore.js';
import type { DshQuestionCarouselController } from './dshQuestionCarouselController.js';

export interface DshContentBinding {
	readonly tree: DshConversationNodeTree;
	readonly expansion: DshExpansionStateStore;
	readonly questions?: DshQuestionCarouselController;
	/**
	 * 在「历史前插」前后保持读者位置的钩子（官方 `ui-chat` 的 paging anchor）。
	 *
	 * 为什么由渲染层注册而不是 dsh 层自己做：只有渲染层看得到滚动容器与行 DOM。
	 * `fillOlderHistory` 在拉页前后各调一次：`begin` 返回一个 restore 闭包，
	 * 前插完成后调用它把读者放回原处。
	 *
	 * 未注册时（例如没有挂载的 widget）返回 `undefined`，调用方直接跳过补偿。
	 */
	readonly pagingAnchor?: {
		begin(): (() => void) | undefined;
	};
}

class DshContentStore {
	private readonly sessions = new Map<string, DshContentBinding>();

	bind(sessionId: string, binding: DshContentBinding): void {
		if (sessionId === '') {
			return;
		}
		this.sessions.set(sessionId, binding);
	}

	get(sessionId: string): DshContentBinding | undefined {
		return this.sessions.get(sessionId);
	}

	unbind(sessionId: string, binding: DshContentBinding): void {
		if (this.sessions.get(sessionId) === binding) {
			this.sessions.delete(sessionId);
		}
	}
}

export const dshContentStore = new DshContentStore();
