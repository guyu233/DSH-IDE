/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Sessions 面板行状态的纯变换：归档 / 已读 / 运行态。
//
// 独立成零 UI 依赖的模块：`dshAgentSessionsController.ts` 要拿它改行状态，
// 单测也要能在没有 DI 容器的环境里直接跑（与 `dshChatHistory.ts` 同一模式）。
//
// 只用 `IChatSessionItem` 的最小形状：resource / status / timing / archived / isRead。

/** 本模块需要的最小行形状（`IChatSessionItem` 的子集）。 */
export interface DshSessionItemLike {
	readonly resource: { toString(): string };
	readonly label: string;
	readonly status?: number;
	readonly timing: { readonly created: number; readonly lastRequestStarted?: number; readonly lastRequestEnded?: number };
	readonly archived?: boolean;
	readonly isRead?: boolean;
}

/** 把某一行标成归档 / 取消归档；找不到该行时原样返回。 */
export function withArchived<T extends DshSessionItemLike>(items: readonly T[], resourceKey: string, archived: boolean): readonly T[] {
	let changed = false;
	const next = items.map(item => {
		if (item.resource.toString() !== resourceKey || item.archived === archived) {
			return item;
		}
		changed = true;
		return { ...item, archived };
	});
	return changed ? next : items;
}

/**
 * 把某一行标成已读 / 未读；找不到该行时原样返回。
 *
 * 未读只在控制器自己拥有已读状态时才有意义（`setChatSessionItemRead` 可选实现），
 * 这里只做值变换，不决定何时调用。
 */
export function withRead<T extends DshSessionItemLike>(items: readonly T[], resourceKey: string, isRead: boolean): readonly T[] {
	let changed = false;
	const next = items.map(item => {
		if (item.resource.toString() !== resourceKey || item.isRead === isRead) {
			return item;
		}
		changed = true;
		return { ...item, isRead };
	});
	return changed ? next : items;
}

/** 行运行态需要的计时字段（按 `IChatSessionTiming` 的两个端点计算）。 */
export function timingForRunning(
	created: number,
	running: boolean,
): { readonly created: number; readonly lastRequestStarted?: number; readonly lastRequestEnded?: number } {
	return {
		created,
		lastRequestStarted: running ? created : undefined,
		lastRequestEnded: running ? undefined : created,
	};
}
