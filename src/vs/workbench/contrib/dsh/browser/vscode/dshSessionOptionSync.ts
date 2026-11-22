/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 会话选项初始化与用户点击共用 `onDidChangeSessionOptions`。
//
// 打开或换绑会话时，程序会把 Host 的当前值投影进会话选项；这一次变化只应更新界面，
// 绝不能再写回 Host。用户主动点选才写回。用一个同步深度标记区分两种来源：
// `updateSessionOptions` 同步触发事件，投影期间的事件一律跳过写回。

let suppressDepth = 0;

/** 在「只投影、不写回」的区间内执行。 */
export function runWithoutSessionOptionWriteBack<T>(fn: () => T): T {
	suppressDepth++;
	try {
		return fn();
	} finally {
		suppressDepth--;
	}
}

/** 当前事件是否来自用户选择（而不是程序投影）。 */
export function shouldWriteBackSessionOption(): boolean {
	return suppressDepth === 0;
}
