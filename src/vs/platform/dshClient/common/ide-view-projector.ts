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
	/** attemptId → 已处理的最大流帧 revision；瞬时帧的重放按它丢弃。 */
	const streamRevisions = new Map<string, number>();
	/** attemptId → 正在流式输出的行；`end` / 结算事件到达时解除绑定。 */
	const streamingByAttempt = new Map<string, MutableRow>();
	/** 已被结局判定为不可见（失败 / 取消）的 attempt；迟到的增量不得把它们复活。 */
	const discardedAttempts = new Set<string>();
	/** attemptId → 该 attempt 的 (turn, step)；durable 的失败结算只有 turn/step，靠它收敛残留行。 */
	const attemptSteps = new Map<string, { readonly turn: number; readonly step: number }>();
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

	/** 为某个 attempt 开出（或取回）它的流式占位行；重连漏收 `start` 时由增量补建。 */
	function openAttemptRow(attemptId: string, event: IdeEvent): MutableRow {
		const existing = streamingByAttempt.get(attemptId);
		if (existing !== undefined) {
			return existing;
		}
		const row: MutableRow = { id: `attempt:${attemptId}`, revision: 1, kind: 'assistant', text: '', folded: false };
		append(event, row);
		streamingByAttempt.set(attemptId, row);
		if (event.turn !== undefined && event.step !== undefined) {
			attemptSteps.set(attemptId, { turn: event.turn, step: event.step });
		}
		streaming = row;
		return row;
	}

	/**
	 * 按 (turn, step) 收敛残留的临时行。
	 *
	 * durable 的 `assistant/attempt` 结算**不带** `attemptId`（上游形状只有 turn/step/stream），
	 * 它表示这次尝试没有可见消息。若连接在瞬时 `end` 帧之前断开，重连后只会收到这条 durable
	 * 事件，失败尝试的半截文本就会留在投影里；这里按 (turn, step) 把对应 attempt 一并丢弃。
	 */
	function discardAttemptsOfStep(turn: number, step: number): void {
		for (const [attemptId, position] of attemptSteps) {
			if (position.turn !== turn || position.step !== step) {
				continue;
			}
			discardedAttempts.add(attemptId);
			discardAttemptRow(attemptId);
			attemptSteps.delete(attemptId);
		}
	}

	/** 丢弃某个 attempt 留下的临时行：失败 / 取消的尝试不该在投影里留下半截文本。 */
	function discardAttemptRow(attemptId: string): void {
		const row = streamingByAttempt.get(attemptId);
		streamingByAttempt.delete(attemptId);
		if (row === undefined) {
			return;
		}
		const index = rows.indexOf(row);
		if (index !== -1) {
			rows.splice(index, 1);
		}
		if (byId.get(row.id) === row) {
			byId.delete(row.id);
		}
		fullText.delete(row.id);
		if (streaming === row) {
			streaming = undefined;
		}
		version += 1;
	}

	function apply(event: IdeEvent): void {
		// 幂等分两套（口径见 translator.ts 的 `attemptId` / `streamRevision` 注释）：
		//   - durable 日志事件按会话 `seq`；
		//   - 瞬时流帧没有 `seq`（不进日志），按同一 attempt 的 revision 单调丢弃重放。
		// 混用会让不同批次里都从 0 起编号的瞬时帧互相吞掉——实测正是如此（同一段回答只剩首帧）。
		if (event.attemptId !== undefined && event.streamRevision !== undefined) {
			const seen = streamRevisions.get(event.attemptId);
			if (seen !== undefined && event.streamRevision <= seen) {
				return;
			}
			streamRevisions.set(event.attemptId, event.streamRevision);
		} else {
			if (seenSeq.has(event.seq)) {
				return;
			}
			seenSeq.add(event.seq);
		}

		const text = event.text ?? '';
		switch (event.type) {
			case 'user.message':
				append(event, { id: `row:${event.seq}`, revision: 1, kind: 'user', text, folded: false, seq: event.seq });
				break;
			case 'assistant.attempt.start':
				// 带 attemptId 的瞬时帧：立刻开出该 attempt 的占位行，后续增量稳定合并到同一 id。
				// 老形状（dsh-TUI mock，无 attemptId）保持原行为：只记日志。
				if (event.attemptId !== undefined) {
					openAttemptRow(event.attemptId, event);
				}
				break;
			case 'assistant.delta': {
				// 已判为不可见的 attempt 不再接受增量：否则迟到的 chunk 会把刚丢弃的行复活成半截回答。
				if (event.attemptId !== undefined && discardedAttempts.has(event.attemptId)) {
					return;
				}
				// 带 attemptId 的增量只认**本 attempt** 的行：重连时可能漏掉 `start`，
				// 此时另起一行，绝不把新 attempt 的文字接进上一 attempt 的行里。
				const existing = event.attemptId !== undefined
					? (streamingByAttempt.get(event.attemptId) ?? openAttemptRow(event.attemptId, event))
					: ((event.callId !== undefined ? byCallId.get(event.callId) : undefined) ?? streaming);
				if (existing !== undefined && !existing.folded) {
					existing.text = (existing.text ?? '') + text;
					touch(existing);
				} else {
					append(event, { id: `row:${event.seq}`, revision: 1, kind: 'assistant', text, folded: false, seq: event.seq, ...(event.callId !== undefined ? { callId: event.callId } : {}) });
				}
				break;
			}
			case 'assistant.message': {
				// 结算事件携带该步骤的完整文本：落到正在流式的那一行时**替换**而不是追加，
				// 否则同一段回答会出现两遍（流式增量 + 结算全文）。与上游
				// `assistant/message` 的「settlement owns the text」同一口径。
				const target = (event.attemptId !== undefined ? streamingByAttempt.get(event.attemptId) : undefined) ?? streaming;
				if (target !== undefined && !target.folded) {
					target.text = text;
					touch(target);
				} else {
					append(event, { id: `row:${event.seq}`, revision: 1, kind: 'assistant', text, folded: false, seq: event.seq, ...(event.callId !== undefined ? { callId: event.callId } : {}) });
				}
				streaming = undefined;
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
				// 该 attempt 结算：占位行不再接受增量，否则下一个 attempt 会接在旧行后面继续拼接。
				// 结局为不可见（失败 / 取消 / 结算为 `assistant/attempt`）时还要**丢弃**临时行：
				// 上游语义是「这次尝试没有可见消息」，留下半截文本会让重试后的回答看起来被截断。
				if (event.attemptId !== undefined) {
					if (event.type === 'assistant.attempt.end' && event.outcome === 'abandoned') {
						// 先丢弃再解绑：`discardAttemptRow` 自己会清掉绑定，顺序反了就找不到行。
						discardedAttempts.add(event.attemptId);
						discardAttemptRow(event.attemptId);
					} else {
						// 已结算的 attempt 只解绑，行保留（正文由 durable 结算接管）。
						streamingByAttempt.delete(event.attemptId);
					}
				} else if (event.type === 'assistant.attempt.end' && event.turn !== undefined && event.step !== undefined) {
					// durable `assistant/attempt`：这次尝试同样没有可见消息（失败 / 取消），
					// 但事件不带 attemptId，只能按 (turn, step) 收敛它留下的临时行。
					discardAttemptsOfStep(event.turn, event.step);
				}
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
