/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 配额通知没有 keepOpen 回调。缺省帧表示「这帧没带」，不能把已经显示的通知清掉。
// 序号更小的通知是旧帧，也不覆盖更新的一条。

export function retainQuotaNotice<T extends { readonly seq: number }>(current: T | undefined, incoming: T | undefined): T | undefined {
	if (incoming === undefined) {
		return current;
	}
	if (current !== undefined && incoming.seq < current.seq) {
		return current;
	}
	return incoming;
}
