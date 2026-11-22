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
	/**
	 * 这组成员的局部 revision（契约 §19 局部 revision）。
	 *
	 * 只由 `DshConversationNodeTree.revisionFor(nodeIds)` 生成：同一段 response 的成员内容没变，
	 * 它就不变；别的 Turn 的节点变化不会让它变。历史实现曾用整棵树的 `treeVersion` 当身份，
	 * 任何节点变化都会让所有 response 判为不同——那正是「整段重绘」的根因。
	 *
	 * 缺省表示调用方还没提供 revision（例如单测里手写的旧形状）；此时只比成员列表，
	 * 与旧行为一致，不假装知道内容有没有变。
	 */
	readonly revision?: string;
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

export function dshSlotHostRef(treeId: string, nodeIds: readonly string[], revision?: string): DshSlotHostRef {
	return { kind: 'dshSlotHost', treeId, nodeIds, ...(revision === undefined ? {} : { revision }) };
}

/**
 * 两段 slot host 引用是否可视为同一个。
 *
 * 比较四项（契约 §19 局部 revision）：`treeId`、`nodeIds`、**局部 revision**、问卷身份。
 *
 * `revision` 是这组成员的局部版本，不是整棵树的版本：别的 Turn 变了不会让这一段变旧。
 * 只有双方都带了 revision 才比较——旧形状（无 revision）退回只比成员列表，
 * 不因为「一边不知道」就判成不同，避免把一次普通刷新当成整段重建。
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
	if (left.revision !== undefined && right.revision !== undefined && left.revision !== right.revision) {
		return false;
	}
	return JSON.stringify(left.questionIds ?? []) === JSON.stringify(right.questionIds ?? [])
		&& (left.questionSignature ?? '') === (right.questionSignature ?? '');
}

/**
 * 把每一段对话 response 收成一个 slot host。
 * 组比 response 少时，多出来的尾部（交付物、pending）保持原样。
 */
export function applyDshSlotHost<T>(items: readonly T[], groups: readonly (readonly string[])[], treeId: string, revisionFor?: (nodeIds: readonly string[]) => string): T[] {
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
		const parts = ids.length === 0 ? kept : [dshSlotHostRef(treeId, ids, revisionFor?.(ids)), ...kept];
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

/** 一行的身份与显示签名（不含 DOM）。 */
export interface DshSlotRowSignature {
	readonly key: string;
	readonly signature: string;
}

/**
 * 增量渲染的行级差异计划（契约 §19 S2）。
 *
 * 纯函数：只比较「上一帧的行」与「这一帧的行」，给出要删的行、要重建的行与最终顺序。
 * DOM 生命周期由 `DshSlotHostContentPart` 执行；把判定抽出来的原因是它必须能单测——
 * 契约要求的「1 个节点变化只替换 1 行」「无可见变化不重建」只能在这一层证明。
 */
export interface DshSlotRowDiff {
	/** 需要从 DOM 移除并释放的行 key。 */
	readonly removed: readonly string[];
	/** 需要重建 DOM 的行 key（新增行或签名变化）。 */
	readonly rebuild: readonly string[];
	/** 下一帧的行顺序。 */
	readonly order: readonly string[];
	/** 是否有任何可见变化；false 时调用方不得 fire 高度事件。 */
	readonly changed: boolean;
}

/** 计算行级差异。签名相同即视为同一行，可原样复用。 */
export function diffDshSlotRows(previous: readonly DshSlotRowSignature[], next: readonly DshSlotRowSignature[]): DshSlotRowDiff {
	const previousByKey = new Map(previous.map(row => [row.key, row.signature]));
	const nextByKey = new Map(next.map(row => [row.key, row.signature]));
	const removed: string[] = [];
	const rebuild: string[] = [];
	for (const key of previousByKey.keys()) {
		if (!nextByKey.has(key)) {
			removed.push(key);
		}
	}
	for (const row of next) {
		const before = previousByKey.get(row.key);
		if (before === undefined || before !== row.signature) {
			rebuild.push(row.key);
		}
	}
	const order = next.map(row => row.key);
	const sameOrder = previous.length === next.length && previous.every((row, index) => row.key === next[index].key);
	return {
		removed,
		rebuild,
		order,
		changed: removed.length > 0 || rebuild.length > 0 || !sameOrder,
	};
}

/**
 * 从「该 Turn 的 turn-process 节点列表」里取过程计数（契约 §19 S6 的消费面）。
 *
 * 为什么抽成纯函数：槽位渲染在 DOM 里跑、`node --test` 起不来，而这条判定
 * 「计数行到底用 Host 给的权威值还是退化成现算」只能靠单测钉住。
 *
 * 语义（对齐官方 `ChatNodeStore.turnDataSource(turn, 'turn-process')`）：
 * 数据源是**整个 Turn** 的该 kind 节点，不是本段 response 的 `nodeIds`——
 * 计数行属于 Turn，不属于某一段引用。空列表返回 undefined，由调用方退化成现算。
 */
export interface DshTurnProcessCountSnapshot {
	readonly toolCallCount: number;
	readonly subagentCount: number;
	readonly messageCount: number;
}

export function turnProcessCounts(rows: readonly unknown[]): DshTurnProcessCountSnapshot | undefined {
	const first = rows[0];
	if (first === null || typeof first !== 'object') {
		return undefined;
	}
	// 节点来自线协议，字段可选；不猜缺失值为非零，缺就当 0（与 `processLineFromSnapshot` 同口径）。
	const record = first as { readonly toolCallCount?: unknown; readonly subagentCount?: unknown; readonly messageCount?: unknown };
	const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;
	return {
		toolCallCount: count(record.toolCallCount),
		subagentCount: count(record.subagentCount),
		messageCount: count(record.messageCount),
	};
}
