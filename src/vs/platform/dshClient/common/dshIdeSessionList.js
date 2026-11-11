/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * 两套 backend 共用的会话列表投影；只保留绑定工作区与官方可见名单的交集。
 * 官方 SessionSummary 的版本由 dshIdeProtocol.ts 绑定；这里只做中立字段映射，不建第二套 schema。
 *
 * @param {string | undefined} sessionId - 当前视图绑定的会话。
 * @param {readonly { readonly id: string; readonly sessionIds: readonly string[] }[]} workspaces - 官方工作区记账。
 * @param {readonly (Omit<import('./dshIdeProtocol.js').IDshIdeSessionSummary, 'workspaceId' | 'title'> & { readonly projections?: { readonly values: { readonly title?: string | null } } })[]} items - 官方会话列表，保留调用上下文中的官方可见性。
 * @returns {import('./dshIdeProtocol.js').IDshIdeSessionSummary[]}
 */
export function projectDshIdeSessionList(sessionId, workspaces, items) {
	if (sessionId === undefined || sessionId === '' || !items.some(item => item.sessionId === sessionId)) {
		return [];
	}
	const owners = workspaces.filter(workspace => workspace.sessionIds.includes(sessionId));
	// 未登记或多重归属都不能证明当前工作区，禁止扩大到其它工作区。
	if (owners.length !== 1) {
		return [];
	}
	const owner = owners[0];
	const sessionIds = new Set(owner.sessionIds);
	return items.filter(item => sessionIds.has(item.sessionId)).map(item => {
		const title = item.projections?.values.title;
		return {
			sessionId: item.sessionId,
			workspaceId: owner.id,
			...(title === undefined || title === null ? {} : { title }),
			updatedAt: item.updatedAt,
			running: item.running,
			blank: item.blank,
			agentAvailable: item.agentAvailable,
			...(item.formatStatus === undefined ? {} : { formatStatus: item.formatStatus }),
			...(item.cwd === undefined ? {} : { cwd: item.cwd }),
			...(item.parentSessionId === undefined ? {} : { parentSessionId: item.parentSessionId }),
			...(item.origin === undefined ? {} : { origin: item.origin }),
		};
	});
}
