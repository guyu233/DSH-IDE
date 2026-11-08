/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// IdeViewHost 最小空实现（阶段 3 第三批占位）：open 返回 starting 快照、subscribe 返回
// no-op、invoke 返回 FEATURE_UNAVAILABLE、close 返回 {closed:true}。阶段 2.x 替换为真实视图。

import { Disposable } from '../../../base/common/lifecycle.js';
import { DSH_IDE_FEATURE_UNAVAILABLE, DSH_IDE_WIRE_REVISION, type DshIdeSnapshot, type IdeViewHost } from '../common/dshIdeProtocol.js';

export class EmptyIdeViewHost extends Disposable implements IdeViewHost {
	open(_args: Record<string, unknown>): DshIdeSnapshot {
		return {
			wireRevision: DSH_IDE_WIRE_REVISION,
			channelId: 'empty',
			version: 1,
			state: { state: 'starting', message: 'DSH-IDE connection layer is being rebuilt' },
		};
	}

	subscribe(_onSnapshot: (s: DshIdeSnapshot) => void): { dispose(): void } {
		// 阶段 2.x 接入真实投影流；当前无快照推送。
		return { dispose() { /* no-op */ } };
	}

	async invoke(_method: string, _args: Record<string, unknown>): Promise<unknown> {
		throw { code: DSH_IDE_FEATURE_UNAVAILABLE, message: 'DSH-IDE connection layer is being rebuilt' };
	}

	close(): { closed: true } {
		return { closed: true };
	}
}
