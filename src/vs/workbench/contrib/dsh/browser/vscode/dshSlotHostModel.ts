/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 一条原生 response 只放一个 dshSlotHost 引用。
// 用户气泡仍走 request；回复里的 markdown / thinking / tool 不再各占一个 part。
// 审批按钮、目标、待办这些快照级 part 留在引用后面。

import { dshNodeRowOverride } from './dshChatSlots.js';
import { dshNodeKey, type DshIndexedNode } from './dshConversationNodeTree.js';
import { dshToolViewId, type DshToolViewId } from './dshToolViewRegistry.js';

export interface DshSlotHostRef {
	readonly kind: 'dshSlotHost';
	readonly treeId: string;
	readonly nodeIds: readonly string[];
	readonly questionIds?: readonly string[];
	/** 问卷结构指纹：同一 eventId 的题目内容变了也要重画。 */
	readonly questionSignature?: string;
}

export interface DshSlotRow {
	readonly key: string;
	readonly title: string;
	readonly detail: string;
	readonly icon: string;
	readonly nested: boolean;
	readonly toolView: DshToolViewId | undefined;
}

// 快照级 part：留在 slot host 引用后面。`info` 不在其中——`toHistory` 已不再产出 info 行
// （PR-12 删掉了文本模拟），留着它只会让「还有文本兜底」看起来仍被允许。
const KEPT_PART_KINDS = new Set(['command', 'progressTaskSerialized', 'warning', 'reference']);

interface HistoryResponse {
	readonly type: 'response';
	readonly parts: readonly { readonly kind: string }[];
}

/** 与 toHistory 的 flush 对齐：user 开新组，连续 turn-error 先结算上一组。turn-error 本身留给原生 errorDetails。 */
export function dshResponseNodeIds(nodes: readonly DshIndexedNode[]): string[][] {
	const groups: string[][] = [];
	let current: string[] | undefined;
	let sawTurnError = false;
	const flush = () => {
		if (current === undefined) {
			return;
		}
		groups.push(current);
		current = undefined;
		sawTurnError = false;
	};
	const ensure = () => {
		if (current === undefined) {
			current = [];
		}
	};
	for (const node of nodes) {
		if (node.kind === 'user') {
			flush();
			current = [];
			if (hasMedia(node)) {
				current.push(dshNodeKey(node));
			}
			continue;
		}
		if (node.kind === 'turn-error') {
			if (sawTurnError) {
				flush();
			}
			ensure();
			sawTurnError = true;
			continue;
		}
		ensure();
		current!.push(dshNodeKey(node));
		for (const child of node.subCalls ?? []) {
			current!.push(dshNodeKey(child));
		}
	}
	flush();
	return groups;
}

export function hasMedia(node: DshIndexedNode): boolean {
	const content = (node as { readonly content?: readonly { readonly type?: string; readonly kind?: string }[] }).content;
	return content?.some(block => {
		const type = block.type ?? block.kind;
		return type !== undefined && type !== '' && type !== 'text';
	}) === true;
}

export function dshSlotHostRef(treeId: string, nodeIds: readonly string[]): DshSlotHostRef {
	return { kind: 'dshSlotHost', treeId, nodeIds };
}

/**
 * 两段 slot host 引用是否可视为同一个。
 *
 * 只比 `treeId` 与 `nodeIds`：真正决定这一行画什么的是成员列表，成员变了就该重建；
 * 成员内部内容的变化由 part 里按 key 的订阅处理。
 *
 * 这里**没有** `version` 字段。历史上它带的是整棵树的版本，任何节点变化都会 +1，
 * 一旦参与身份比较就等于「任何节点变化 → 所有 response 全部重建」，正是契约要避免的
 * 整树重绘；取消比较之后它已无任何读取方，2026-11-22 连同 `IDshSlotHostContent` 的
 * 同名字段一起删除。
 */
export function dshSlotHostSame(left: DshSlotHostRef, right: DshSlotHostRef): boolean {
	if (left.treeId !== right.treeId || left.nodeIds.length !== right.nodeIds.length) {
		return false;
	}
	for (let index = 0; index < left.nodeIds.length; index++) {
		if (left.nodeIds[index] !== right.nodeIds[index]) {
			return false;
		}
	}
	return JSON.stringify(left.questionIds ?? []) === JSON.stringify(right.questionIds ?? [])
		&& (left.questionSignature ?? '') === (right.questionSignature ?? '');
}

/**
 * 把每一段对话 response 收成一个 slot host。
 * 组比 response 少时，多出来的尾部（交付物、pending）保持原样。
 */
export function applyDshSlotHost<T>(items: readonly T[], groups: readonly (readonly string[])[], treeId: string): T[] {
	let responseIndex = 0;
	return items.map(item => {
		const response = item as T & Partial<HistoryResponse>;
		if (response.type !== 'response' || !Array.isArray(response.parts)) {
			return item;
		}
		const ids = groups[responseIndex];
		responseIndex++;
		if (ids === undefined) {
			return item;
		}
		const kept = response.parts.filter(part => KEPT_PART_KINDS.has(part.kind));
		const parts = ids.length === 0 ? kept : [dshSlotHostRef(treeId, ids), ...kept];
		return { ...response, parts } as T;
	});
}

/** 问卷只挂最后一条回复；空会话也能显示，旧回复不重复挂载。 */
export function attachDshQuestions<T>(items: readonly T[], treeId: string, questionIds: readonly string[], questionSignature = ''): T[] {
	if (questionIds.length === 0) { return [...items]; }
	const result = [...items];
	let last = result.length - 1;
	while (last >= 0 && (result[last] as Partial<HistoryResponse>).type !== 'response') { last--; }
	const response = last < 0 ? { type: 'response' as const, participant: 'dsh', parts: [] } : result[last] as T & HistoryResponse;
	const existing = response.parts.find(part => part.kind === 'dshSlotHost') as DshSlotHostRef | undefined;
	const host: DshSlotHostRef = { ...(existing ?? dshSlotHostRef(treeId, [])), questionIds: [...questionIds], questionSignature };
	const parts = existing === undefined ? [...response.parts, host] : response.parts.map(part => part === existing ? host : part);
	const updated = { ...response, parts } as T;
	if (last < 0) { result.push(updated); } else { result[last] = updated; }
	return result;
}

/** 官方把计划卡放在 turn tail：按 Turn 收集 `submitted-plan` 的 key，供槽位在尾部渲染。 */
export function planKeysForTurn(nodes: readonly { readonly key: string; readonly kind: string; readonly turn?: number }[], turn: number): readonly string[] {
	return nodes.filter(node => node.kind === 'submitted-plan' && node.turn === turn).map(node => node.key);
}

/** 一个节点在 slot host 里的一行。正文从节点自己的字段取，不读 history 文本。 */
export function presentDshNode(node: DshIndexedNode, nested = false, sessionId?: string): DshSlotRow {
	const key = dshNodeKey(node);
	const record = node as DshIndexedNode & {
		readonly text?: string;
		readonly content?: readonly { readonly type?: string; readonly text?: string; readonly name?: string }[];
		readonly blocks?: readonly { readonly kind?: string; readonly text?: string; readonly name?: string; readonly argsRaw?: string }[];
		readonly name?: string;
		readonly argsRaw?: string;
		readonly summary?: string | null;
		readonly message?: string;
		readonly commandId?: string;
		readonly args?: unknown;
		readonly isError?: boolean;
	};
	if (node.kind === 'tool-call' || node.kind === 'tool-result') {
		const toolName = record.name ?? '';
		const detail = typeof record.argsRaw === 'string' ? record.argsRaw : textOf(record.content) || textOf(record.blocks);
		return {
			key,
			title: toolName === '' ? node.kind : toolName,
			detail,
			icon: 'tools',
			nested,
			toolView: dshToolViewId(toolName),
		};
	}
	const detail = textOf(record.blocks) || textOf(record.content) || record.text || record.summary || record.message || '';
	// 官方 keyed 槽 `conversation.chat.node`：插件注册的 occupant 优先于内置行。
	const override = dshNodeRowOverride(node.kind, sessionId);
	return {
		key,
		title: override?.title ?? titleOf(node.kind, record),
		detail: override?.detail ?? detail,
		icon: override?.icon ?? iconOf(node.kind),
		nested,
		toolView: undefined,
	};
}

function titleOf(kind: string, record: { readonly commandId?: string; readonly name?: string | null }): string {
	if (kind === 'command') {
		return record.name || record.commandId || kind;
	}
	return kind;
}

function iconOf(kind: string): string {
	switch (kind) {
		case 'assistant':
		case 'assistant-step':
			return 'comment';
		case 'steering':
		case 'turn-trigger':
			return 'arrow-right';
		case 'context':
			return 'note';
		case 'reasoning':
			return 'lightbulb';
		case 'compaction':
		case 'manual-compaction':
			return 'fold';
		case 'command':
			return 'terminal';
		case 'model-retry':
		case 'turn-max-tokens':
			return 'warning';
		default:
			return 'circle-filled';
	}
}

function textOf(blocks: readonly { readonly type?: string; readonly kind?: string; readonly text?: string }[] | undefined): string {
	if (blocks === undefined) {
		return '';
	}
	const lines: string[] = [];
	for (const block of blocks) {
		if (typeof block.text === 'string' && block.text !== '') {
			lines.push(block.text);
		}
	}
	return lines.join('\n');
}
