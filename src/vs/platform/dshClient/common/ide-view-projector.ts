/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P2：IdeViewProjector（增量 reducer，插件侧 common 层）。
//
// 平移自 e:/dsh-TUI/src/channel/projection.ts：会话日志为唯一真源、row 稳定 id、
// callId 关联、seq 幂等、有界窗口与折叠 preview；常量搬自
// e:/dsh-TUI/src/channel/transcript.ts:19（MAX_ROWS = 600）与其 preview()/trimLocalRows()。
//
// 边界：投影器出口**不做运行时校验**（由第三步 golden 门禁守护）；不 import @deepseek-ai/*、
// 不接收插件宿主上下文、不直连 electron。translator 只以 `import type` 引入（strip-types 擦除），
// 运行时零跨模块解析。

import type { IdeEvent, IdeRowKind } from './translator.js';

/** 内存有界窗口行数。占位配置常量，搬自 dsh-TUI `src/channel/transcript.ts:19`。 */
export const MAX_ROWS = 600;

/** 参数 / 结果折叠 preview 上限，搬自 dsh-TUI `src/channel/transcript.ts:4,6`。 */
export const ARGS_PREVIEW_LIMIT = 160;
export const RESULT_PREVIEW_LIMIT = 240;

/** P95 校准阈值（见 verification.md §3.2）：rows 序列化后字节数超过即校准参数。 */
export const ROWS_P95_BYTE_LIMIT = 512 * 1024;

export interface IdeRow {
	/** 稳定 id：`call:<callId>` 或 `row:<seq>`；两次投影之间不变。 */
	readonly id: string;
	/** 行级 revision：仅该行内容变化时 +1。 */
	readonly revision: number;
	readonly kind: IdeRowKind;
	readonly text?: string;
	readonly preview?: string;
	readonly folded: boolean;
	readonly seq?: number;
	readonly callId?: string;
}

export interface IdeViewSnapshot {
	readonly rows: readonly IdeRow[];
	readonly version: number;
}

export interface IdeViewProjectorDeps {
	/** 折叠行回 Host 取完整内容；由真实 IdeViewHost 提供，未接线时可选。 */
	fetchRowDetail?(rowId: string): Promise<string>;
}

interface MutableRow {
	id: string;
	revision: number;
	kind: IdeRowKind;
	text?: string;
	preview?: string;
	folded: boolean;
	seq?: number;
	callId?: string;
}

function preview(text: string, limit: number): string {
	const flat = text.replace(/\s+/g, ' ').trim();
	return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`;
}

function frozen(row: MutableRow): IdeRow {
	return {
		id: row.id,
		revision: row.revision,
		kind: row.kind,
		...(row.text !== undefined ? { text: row.text } : {}),
		...(row.preview !== undefined ? { preview: row.preview } : {}),
		folded: row.folded,
		...(row.seq !== undefined ? { seq: row.seq } : {}),
		...(row.callId !== undefined ? { callId: row.callId } : {}),
	};
}

export interface IdeViewProjector {
	/** 增量折叠一条中立事件；重复 seq 幂等丢弃。 */
	apply(event: IdeEvent): void;
	snapshot(): IdeViewSnapshot;
	/** 折叠行的完整内容：优先本地缓存，否则经 deps 回 Host 取。 */
	fetchRowDetail(rowId: string): Promise<string | undefined>;
}

/**
 * 创建增量投影器。日志是唯一真源；rows 是它的投影，不整树替换。
 * 超出 MAX_ROWS 时把最老的行折叠为 preview（保留 id/kind/revision），
 * 全文留在 fullText 中供 fetchRowDetail 回取。
 */
export function createIdeViewProjector(deps: IdeViewProjectorDeps = {}): IdeViewProjector {
	const log: IdeEvent[] = [];
	const rows: MutableRow[] = [];
	const byCallId = new Map<string, MutableRow>();
	const byId = new Map<string, MutableRow>();
	const fullText = new Map<string, string>();
	const seenSeq = new Set<number>();
	let version = 0;
	let streaming: MutableRow | undefined;

	function append(event: IdeEvent, row: MutableRow): void {
		rows.push(row);
		byId.set(row.id, row);
		if (event.callId !== undefined) {
			byCallId.set(event.callId, row);
		}
		if (row.kind === 'assistant') {
			streaming = row;
		}
		version += 1;
		log.push(event);
	}

	function touch(row: MutableRow): void {
		row.revision += 1;
		version += 1;
	}

	function foldOldest(): void {
		let unfolded = 0;
		for (const row of rows) {
			if (!row.folded) {
				unfolded += 1;
			}
		}
		if (unfolded <= MAX_ROWS) {
			return;
		}
		let toFold = unfolded - MAX_ROWS;
		for (const row of rows) {
			if (toFold === 0) {
				break;
			}
			if (row.folded) {
				continue;
			}
			const text = row.text ?? '';
			fullText.set(row.id, text);
			row.text = undefined;
			row.preview = preview(text, RESULT_PREVIEW_LIMIT);
			row.folded = true;
			toFold -= 1;
		}
	}

	function apply(event: IdeEvent): void {
		if (seenSeq.has(event.seq)) {
			return;
		}
		seenSeq.add(event.seq);

		const text = event.text ?? '';
		switch (event.type) {
			case 'user.message':
				append(event, { id: `row:${event.seq}`, revision: 1, kind: 'user', text, folded: false, seq: event.seq });
				break;
			case 'assistant.delta':
			case 'assistant.attempt.start':
			case 'assistant.message': {
				const existing = event.callId !== undefined ? byCallId.get(event.callId) : streaming;
				if (existing !== undefined && !existing.folded) {
					existing.text = (existing.text ?? '') + text;
					touch(existing);
				} else {
					append(event, { id: `row:${event.seq}`, revision: 1, kind: 'assistant', text, folded: false, seq: event.seq, ...(event.callId !== undefined ? { callId: event.callId } : {}) });
				}
				break;
			}
			case 'tool.call': {
				const id = event.callId !== undefined ? `call:${event.callId}` : `row:${event.seq}`;
				append(event, { id, revision: 1, kind: 'tool', text: event.title ?? text, folded: false, seq: event.seq, ...(event.callId !== undefined ? { callId: event.callId } : {}) });
				break;
			}
			case 'tool.result': {
				const row = event.callId !== undefined ? byCallId.get(event.callId) : undefined;
				if (row !== undefined && !row.folded) {
					row.text = preview(text, RESULT_PREVIEW_LIMIT);
					touch(row);
					if (event.callId !== undefined) {
						byCallId.delete(event.callId);
					}
				}
				break;
			}
			case 'task.start':
			case 'task.output':
			case 'system.prompt':
			case 'custom':
				append(event, { id: `row:${event.seq}`, revision: 1, kind: 'system', text, folded: false, seq: event.seq });
				break;
			case 'turn.end':
			case 'step.end':
			case 'assistant.attempt.end':
				streaming = undefined;
				break;
			default:
				// 其余 emit 事件（session.* / goal / todo / preset / request.header /
				// context.capacity / compaction.* / turn.start / step.start / pending.changed）
				// 记入日志但不产生 row，留给 P4 / P6 的投影扩展。
				log.push(event);
				break;
		}
		foldOldest();
	}

	return {
		apply,
		snapshot(): IdeViewSnapshot {
			return { rows: rows.map(frozen), version };
		},
		async fetchRowDetail(rowId: string): Promise<string | undefined> {
			const cached = fullText.get(rowId);
			if (cached !== undefined) {
				return cached;
			}
			const row = byId.get(rowId);
			if (row !== undefined && row.text !== undefined) {
				return row.text;
			}
			return deps.fetchRowDetail ? deps.fetchRowDetail(rowId) : undefined;
		},
	};
}

/**
 * golden 回放入口：中立事件流 → 增量投影 → 快照。
 * 原始 DSH 事件须先经 `translateAll()`（回放脚本组合），投影器只认中立事件。
 * 出口**不做运行时校验**（由 golden 门禁守护）。
 */
export function projectIdeView(events: readonly IdeEvent[], deps: IdeViewProjectorDeps = {}): IdeViewSnapshot {
	const projector = createIdeViewProjector(deps);
	for (const event of events) {
		projector.apply(event);
	}
	return projector.snapshot();
}
