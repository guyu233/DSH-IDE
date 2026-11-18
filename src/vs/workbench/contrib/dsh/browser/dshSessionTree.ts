/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 子智能体会话树的纯函数层：把扁平的 session summary 列表拼成
// `IChatSessionItem.children` 树，交给 VS Code 原生会话树渲染。
//
// 规则参照官方 `flattenLineage()`（https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/api/session-controller/
// src/client/sessions/lineage.ts:54-96）：只有 origin==='subagent' 且 parentSessionId
// 在列表里才挂为子项；普通 fork 即便带 parent 也不挂；孤儿降级 root；visited 防环，
// 不可达的环成员补为 root；保持输入顺序，不按 updatedAt 重排。
//
// 独立成零 UI / DI 依赖的模块，便于单测直接跑。
// 不写 `parentSession`（那是 VS Code 内部字段，由嵌套关系注入），不写 `depth`。

import type { IChatSessionTiming } from '../../chat/common/chatService/chatService.js';
import { ChatSessionStatus, type IChatSessionItem } from '../../chat/common/chatSessionsService.js';
import type { IDshIdeSessionSummary } from '../../../../platform/dshClient/common/dshIdeProtocol.js';

/** 单条 summary 映射成 item 的回调（控制器提供，负责 resource/label/timing 等）。 */
export type DshSessionItemFactory<T extends IChatSessionItem> = (summary: IDshIdeSessionSummary) => T | undefined;

/** item 的最小可比较形状（`IChatSessionItem` 的子集，含嵌套 children）。 */
export interface DshSessionTreeNode {
	readonly resource: { toString(): string };
	readonly label: string;
	readonly description?: unknown;
	readonly status?: ChatSessionStatus;
	readonly timing: IChatSessionTiming;
	readonly archived?: boolean;
	readonly isRead?: boolean;
	readonly children?: readonly DshSessionTreeNode[];
}

/**
 * 扁平 summary 列表 → 带 children 的 root 列表。
 *
 * 只消费 `sessionId` / `parentSessionId` / `origin`；其余字段交给 `toItem` 映射。
 * 重复 sessionId 只保留第一次（与控制器原有 seen 语义一致）。
 */
export function buildSessionTree<T extends IChatSessionItem>(
	summaries: readonly IDshIdeSessionSummary[],
	toItem: DshSessionItemFactory<T>,
): T[] {
	const byId = new Map<string, IDshIdeSessionSummary>();
	for (const summary of summaries) {
		if (typeof summary?.sessionId === 'string' && summary.sessionId !== '' && !byId.has(summary.sessionId)) {
			byId.set(summary.sessionId, summary);
		}
	}

	// 只有 subagent 且父在列表里才挂子项；其余（含孤儿）为 root。
	const childIds = new Map<string, string[]>();
	const rootIds: string[] = [];
	for (const summary of byId.values()) {
		const parent = summary.parentSessionId;
		if (summary.origin === 'subagent' && typeof parent === 'string' && byId.has(parent)) {
			const list = childIds.get(parent) ?? [];
			list.push(summary.sessionId);
			childIds.set(parent, list);
		} else {
			rootIds.push(summary.sessionId);
		}
	}

	const cache = new Map<string, T | undefined>();
	const makeItem = (id: string): T | undefined => {
		const cached = cache.get(id);
		if (cached !== undefined || cache.has(id)) {
			return cached;
		}
		const item = toItem(byId.get(id)!);
		cache.set(id, item);
		return item;
	};

	const visited = new Set<string>();
	const build = (id: string): T | undefined => {
		if (visited.has(id)) {
			return undefined; // 环：跳过这条边，环成员在末尾按 root 补发
		}
		const item = makeItem(id);
		if (item === undefined) {
			return undefined;
		}
		visited.add(id);
		const kids = childIds.get(id) ?? [];
		const children: T[] = [];
		for (const kid of kids) {
			const child = build(kid);
			if (child !== undefined) {
				children.push(child);
			}
		}
		return children.length === 0 ? item : withChildren(item, children);
	};

	const roots: T[] = [];
	for (const root of rootIds) {
		const item = build(root);
		if (item !== undefined) {
			roots.push(item);
		}
	}
	// 不可达的环成员补为 root，保证不丢会话。
	for (const id of byId.keys()) {
		if (!visited.has(id)) {
			const item = build(id);
			if (item !== undefined) {
				roots.push(item);
			}
		}
	}
	return roots;
}

function withChildren<T extends IChatSessionItem>(item: T, children: readonly T[]): T {
	return { ...item, children };
}

/** 递归收集整棵树里所有 item（含 root），便于状态更新与比较。 */
export function flattenTree<T extends DshSessionTreeNode>(items: readonly T[]): T[] {
	const out: T[] = [];
	const walk = (list: readonly T[]): void => {
		for (const item of list) {
			out.push(item);
			if (item.children !== undefined) {
				walk(item.children as readonly T[]);
			}
		}
	};
	walk(items);
	return out;
}

/** 递归更新某一行（按 resource.toString() 命中），未命中或值未变时原样返回。 */
export function mapTreeItem<T extends DshSessionTreeNode>(
	items: readonly T[],
	resourceKey: string,
	update: (item: T) => T | undefined,
): readonly T[] {
	const map = (list: readonly T[]): readonly T[] => {
		let changed = false;
		const next = list.map(item => {
			let mapped = item;
			if (item.resource.toString() === resourceKey) {
				const updated = update(item);
				if (updated !== undefined && updated !== item) {
					mapped = updated;
					changed = true;
				}
			}
			if (item.children !== undefined) {
				const nextChildren = map(item.children as readonly T[]);
				// 内层 `map` 在无变化时返回原数组，因此这里的引用判等才成立。
				if (nextChildren !== item.children) {
					mapped = { ...mapped, children: nextChildren } as T;
					changed = true;
				}
			}
			return mapped;
		});
		return changed ? next : list;
	};
	return map(items);
}

/** 递归比较两个 item（含 children 顺序与内容）。 */
export function sameTreeItem<T extends DshSessionTreeNode>(left: T, right: T): boolean {
	return left.label === right.label
		&& left.description === right.description
		&& left.status === right.status
		&& left.archived === right.archived
		&& left.isRead === right.isRead
		&& left.timing.created === right.timing.created
		&& left.timing.lastRequestStarted === right.timing.lastRequestStarted
		&& left.timing.lastRequestEnded === right.timing.lastRequestEnded
		&& sameChildren(left.children, right.children);
}

function sameChildren(left: readonly DshSessionTreeNode[] | undefined, right: readonly DshSessionTreeNode[] | undefined): boolean {
	const l = left ?? [];
	const r = right ?? [];
	if (l.length !== r.length) {
		return false;
	}
	for (let i = 0; i < l.length; i++) {
		if (!sameTreeItem(l[i], r[i])) {
			return false;
		}
	}
	return true;
}

/** 后发起的 refresh 递增代次后，先发起的回包不再是当前代次。 */
export function isCurrentRefresh(epoch: number, latest: number): boolean {
	return epoch === latest;
}

/**
 * 归档/恢复回包是完整 id 集合。不是数组时只改这一条，避免一次坏回包把已知集合清掉。
 */
export function archiveIdsFromResult(value: unknown, sessionId: string, archived: boolean, previous: ReadonlySet<string>): Set<string> {
	const next = new Set<string>();
	if (Array.isArray(value)) {
		for (const id of value) {
			if (typeof id === 'string' && id !== '') {
				next.add(id);
			}
		}
		return next;
	}
	for (const id of previous) {
		next.add(id);
	}
	if (archived) {
		next.add(sessionId);
	} else {
		next.delete(sessionId);
	}
	return next;
}

/**
 * 刷新后的已读状态。
 *
 * 第一次出现不写 `isRead`（原生把缺省当成已读）。时间戳变大才标未读。
 * 时间戳没变则保留用户刚才点过的已读/未读，避免刷新把本地状态冲掉。
 */
export function sessionReadState(updatedAt: number | undefined, previous: { readonly timing: { readonly created: number }; readonly isRead?: boolean } | undefined): boolean | undefined {
	if (previous === undefined) {
		return undefined;
	}
	const nextStamp = updatedAt ?? 0;
	if (nextStamp > previous.timing.created) {
		return false;
	}
	return previous.isRead;
}
