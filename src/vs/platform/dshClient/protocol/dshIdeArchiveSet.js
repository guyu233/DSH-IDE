/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * 两套 backend 共用的归档集合中立投影（第 19 轮 / §8.10.11）。
 *
 * 官方 `workspaceController.archiveSession` / `unarchiveSession` 返回
 * `WorkspaceArchiveValue { archivedSessionIds: readonly SessionId[] }`
 * （`api/workspace-controller/src/types.ts:133-135`）——是**完整归档集合**，
 * 不是 `{ accepted: true }`。IDE 契约按第 2 章 §4「列表类 `value` 为数组」
 * 投影为 `readonly string[]`，不新增 DTO、不透传官方包装对象。
 *
 * @param {unknown} value - 官方返回值，形状未知时按空数组 fail-closed。
 * @returns {readonly string[]}
 */
export function projectDshIdeArchiveSet(value) {
	if (value === null || typeof value !== 'object') {
		return [];
	}
	const ids = value.archivedSessionIds;
	if (!Array.isArray(ids)) {
		return [];
	}
	const sessions = [];
	// 去重：同一 id 出现两次时，投影结果不该带重复项。
	// 消费方（`archiveIdsFromResult`）用 Set 兜住了，但投影层也不该产出脏数据——
	// 否则任何直接比较数组相等的地方都会误判「归档集合变了」。
	const seen = new Set();
	for (const id of ids) {
		if (typeof id === 'string' && id !== '' && !seen.has(id)) {
			seen.add(id);
			sessions.push(id);
		}
	}
	return sessions;
}
