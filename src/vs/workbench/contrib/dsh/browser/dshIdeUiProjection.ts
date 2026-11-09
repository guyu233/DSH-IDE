/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P4：DTO → UI 投影层（`DshIdeRow` → Chat 侧栏可渲染的部件）。
//
// 职责边界（第 1 章 §3）：本文件在 `workbench/**`，**零 `@deepseek-ai/*`**，只消费中立 DTO。
// 它与 `dshIdeConsumer.ts` 分开：消费者负责「校验 / fail-closed / 合并 / diff」，
// 本文件负责「行 → 渲染部件」的纯映射，两者都不持有会话状态。
//
// 映射规则（与 `dshChatSeam.ts` 的 `DshPartProps` 对齐）：
//   user              → { kind: 'user', content: { text } }
//   assistant         → { kind: 'markdown', blocks: [{ type:'text', text }], streaming }
//   tool              → { kind: 'markdown', ... }（保留 VS Code 原生工具渲染，不谎称复用 ToolRow）
//   system / notice   → { kind: 'markdown', ... }（系统提示与通知按文本呈现）
// 折叠行（`folded`）用 `preview` 代替全文；全文由 `fetchRowDetail` 按需回取（第 2 章 E9）。

import type { DshIdeRow } from '../../../../platform/dshClient/common/dshIdeProtocol.js';

/** 与 `dshChatSeam.ts` 的 `DshPartProps` 结构对齐的渲染部件（避免跨文件类型耦合）。 */
export type DshUiPart =
	| { readonly kind: 'user'; readonly content: { readonly text: string } }
	| { readonly kind: 'markdown'; readonly blocks: readonly DshUiBlock[]; readonly streaming?: boolean }
	| { readonly kind: 'running'; readonly label?: string };

/** 与 sidecar 的 block 形状对齐的最小结构（当前只用文本块）。 */
export interface DshUiBlock {
	readonly type: 'text';
	readonly text: string;
}

/** 一行是否可渲染（没有文本也没有 preview 的行不产生部件，避免空壳）。 */
export function isRenderableRow(row: DshIdeRow): boolean {
	return rowText(row) !== undefined;
}

/** 取一行的展示文本：折叠行优先用 `preview`（全文已移出快照，见第 2 章 E10）。 */
export function rowText(row: DshIdeRow): string | undefined {
	if (row.folded) {
		return row.preview ?? row.text;
	}
	return row.text ?? row.preview;
}

/**
 * 把一行 DTO 投影成 UI 部件；不可渲染时返回 undefined（调用方过滤，不渲染空行）。
 *
 * @param row - 消费者已接受的行（`revision` 稳定，可安全用于增量更新判断）
 * @param streaming - 该行是否仍在流式产出（最后一行 assistant 才为 true）
 */
export function projectRowToUi(row: DshIdeRow, streaming = false): DshUiPart | undefined {
	const text = rowText(row);
	if (text === undefined) {
		return undefined;
	}
	switch (row.kind) {
		case 'user':
			return { kind: 'user', content: { text } };
		case 'assistant':
			return { kind: 'markdown', blocks: [{ type: 'text', text }], ...(streaming ? { streaming: true } : {}) };
		case 'tool':
		case 'system':
		case 'notice':
			// 工具行保留 VS Code 原生渲染：这里只给出文本内容，不伪造 ToolRow 组件。
			return { kind: 'markdown', blocks: [{ type: 'text', text }] };
		default:
			return undefined;
	}
}

/**
 * 把整个行序列投影成 UI 部件列表（顺序 = 快照顺序）。
 *
 * 流式判定：只有**最后一个 assistant 行**被视为仍在流式，其余均为完成态——
 * 与 DSH 的「回合结束才落 final message」一致，避免历史行永久显示光标。
 */
export function projectRowsToUi(rows: readonly DshIdeRow[]): readonly { readonly row: DshIdeRow; readonly part: DshUiPart }[] {
	const lastAssistant = lastIndex(rows, row => row.kind === 'assistant');
	const result: { row: DshIdeRow; part: DshUiPart }[] = [];
	rows.forEach((row, index) => {
		const part = projectRowToUi(row, index === lastAssistant);
		if (part !== undefined) {
			result.push({ row, part });
		}
	});
	return result;
}

function lastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
	for (let i = items.length - 1; i >= 0; i--) {
		if (predicate(items[i])) {
			return i;
		}
	}
	return -1;
}

/**
 * 增量更新判定：同一 `id` 的行在 UI 侧是否可以复用节点。
 * 只有 `revision` 变化时才需要更新（与消费者的 diff 口径一致）。
 */
export function canReuseUiNode(previous: DshIdeRow, next: DshIdeRow): boolean {
	return previous.id === next.id && previous.revision === next.revision;
}
