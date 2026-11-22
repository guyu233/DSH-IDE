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
