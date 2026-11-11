/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * 两套 backend 共用的会话检索结果中立投影（第 22 轮 / D59 分批检索）。
 *
 * 官方 `session/search` 返回 `SessionSearchValue { items: SessionSearchItem[], hasMore }`
 * （`api/session-controller/src/types.ts:255-263`），每项 `{ sessionId, snippet }`
 * （`:168-171`）。IDE 侧按「列表类」投影为
 * `{ items: { sessionId, snippet }[], hasMore }`——只保留这两个中立字段，
 * 不透传官方包装，也不新增第二份 schema。
 *
 * 形状未知时返回 `{ items: [], hasMore: false }`（fail-closed）；
 * 不把「无法解析」伪装成「检索无结果」以外的任何成功语义，调用方仍按
 * 官方失败路径处理真正的错误。
 *
 * @param {unknown} value - 官方返回值。
 * @returns {{ readonly items: readonly { readonly sessionId: string; readonly snippet: string }[]; readonly hasMore: boolean }}
 */
export function projectDshIdeSessionSearch(value) {
	if (value === null || typeof value !== 'object') {
		return { items: [], hasMore: false };
	}
	const rawItems = value.items;
	const items = [];
	if (Array.isArray(rawItems)) {
		for (const item of rawItems) {
			if (item === null || typeof item !== 'object') {
				continue;
			}
			const sessionId = item.sessionId;
			const snippet = item.snippet;
			// 两个字段都是官方必填；缺任一即视为不可用项，跳过而不是补默认值。
			if (typeof sessionId !== 'string' || sessionId === '' || typeof snippet !== 'string') {
				continue;
			}
			items.push({ sessionId, snippet });
		}
	}
	return { items, hasMore: value.hasMore === true };
}
