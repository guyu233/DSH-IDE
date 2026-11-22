/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 依赖插件能力的 context key：会话菜单用它决定入口是否出现。
//
// 值的唯一来源是 Host 独立 `capabilities` method 的返回值（官方服务/命令的实际装载状态）。
// 缺省按 false 处理：拿不到能力时隐藏入口，而不是让用户点了才报错。

import { RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';
import type { DshIdeCapabilities } from '../../../../../platform/dshClient/protocol/dshIdeProtocol.js';

/** 四项能力各一个布尔 context key，初始 false（fail-closed）。 */
export const dshRewindAvailable = new RawContextKey<boolean>('dsh.hasRewind', false, 'dsh-ide: 消息回退可用');
export const dshSessionFavoriteAvailable = new RawContextKey<boolean>('dsh.hasSessionFavorite', false, 'dsh-ide: 会话收藏可用');
export const dshSessionMoveAvailable = new RawContextKey<boolean>('dsh.hasSessionMove', false, 'dsh-ide: 会话移动可用');
export const dshSessionDeleteAvailable = new RawContextKey<boolean>('dsh.hasSessionDelete', false, 'dsh-ide: 会话删除可用');

export type DshCapabilityName = keyof DshIdeCapabilities;

/** 按能力名取对应 context key，供菜单 `when` 条件使用。 */
export function dshCapsContext(name: DshCapabilityName): RawContextKey<boolean> {
	switch (name) {
		case 'rewind': return dshRewindAvailable;
		case 'sessionFavorite': return dshSessionFavoriteAvailable;
		case 'sessionMove': return dshSessionMoveAvailable;
		case 'sessionDelete': return dshSessionDeleteAvailable;
	}
}

/** 把一次能力快照写进各 context key。 */
export function applyDshCapabilities(caps: DshIdeCapabilities | undefined, set: (key: RawContextKey<boolean>, value: boolean) => void): void {
	set(dshRewindAvailable, caps?.rewind === true);
	set(dshSessionFavoriteAvailable, caps?.sessionFavorite === true);
	set(dshSessionMoveAvailable, caps?.sessionMove === true);
	set(dshSessionDeleteAvailable, caps?.sessionDelete === true);
}
