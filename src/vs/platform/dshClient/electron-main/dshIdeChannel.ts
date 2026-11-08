/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH-IDE 新连接层骨架（阶段 3 第三批）：实现 IServerChannel<string>，但当前所有方法
// 返回 FEATURE_UNAVAILABLE / 空快照。真实现在阶段 2.1-2.5 填充（桥接 Host Typert Gateway）。

import { Disposable } from '../../../base/common/lifecycle.js';
import { Event } from '../../../base/common/event.js';
import { IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { DSH_IDE_FEATURE_UNAVAILABLE, type IdeViewHost } from '../common/dshIdeProtocol.js';

export class DshIdeChannel extends Disposable implements IServerChannel<string> {
	constructor(private readonly view: IdeViewHost) {
		super();
	}

	listen<T>(_ctx: string, _event: string, _arg?: any): Event<T> {
		// 阶段 2.x 改为转发真实投影事件（state / stream）。
		return Event.None as Event<T>;
	}

	call<T>(_ctx: string, _command: string, _arg?: any): Promise<T> {
		// TODO 2.2-2.5：按 method 桥接 Host Typert Gateway；当前一律拒绝为「重建中」。
		return Promise.reject({
			code: DSH_IDE_FEATURE_UNAVAILABLE,
			message: 'DSH-IDE connection layer is being rebuilt (phase 2.x pending)',
		}) as unknown as Promise<T>;
	}

	/** 清理某窗口（ctx）拥有的资源；骨架无状态，返回 0。 */
	disposeOwner(_ctx: string): number {
		return 0;
	}

	override dispose(): void {
		this.view.close();
		super.dispose();
	}
}
