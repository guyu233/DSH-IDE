/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P4：IDE 消费层——把 `dshIde` 通道上的快照帧变成 Chat 侧栏可渲染的行。
//
// 职责（第 4 章 T7）：
//   accept() 依次做 快照校验 → 连续性 fail-closed → 16ms 合并 → rows 按稳定 id diff。
//
// 边界（第 1 章 §3）：本文件在 `workbench/**`，**零 `@deepseek-ai/*`**，只消费 DTO；
// 不理解 DSH 内部模型，不复制会话状态，不做乐观插入。
//
// fail-closed 纪律（第 2 章 §5.1）：`version` 断号、倒退、`channelId`/`wireRevision` 变化
// 一律拒绝该帧，且**不改变**已渲染状态——绝不「凑合渲染」。

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import {
	DSH_IDE_SNAPSHOT_STALE,
	assertSnapshotContinuity,
	validateDshIdeSnapshot,
	type DshIdeRow,
	type DshIdeRowKind,
	type DshIdeSnapshot,
	type DshRemoteError,
} from '../../../../platform/dshClient/common/dshIdeProtocol.js';

/** 行级差异：消费者只关心「新增」与「变更」，删除由 `applyRows` 整体收敛。 */
export interface DshIdeRowDiff {
	readonly added: readonly DshIdeRow[];
	readonly changed: readonly DshIdeRow[];
}

/** 消费者对外暴露的渲染状态。 */
export interface DshIdeConsumerState {
	readonly rows: readonly DshIdeRow[];
	/** 已接受快照的 version；未接受过为 -1。 */
	readonly version: number;
	readonly channelId: string | undefined;
	/** 最近一次被接受帧的整体状态（starting/ready/rebuild）。 */
	readonly phase: 'starting' | 'ready' | 'rebuild' | 'none';
}

/** 合并窗口：一帧内到达的多次 accept 合并成一次渲染（第 4 章 T7 的 16ms）。 */
export const DSH_IDE_MERGE_WINDOW_MS = 16;

/**
 * 快照消费者。`accept()` 是唯一入口；渲染经 `onDidChangeRows` 单向通知。
 *
 * 用法：`const consumer = new DshIdeConsumer(); consumer.onDidChangeRows(...); consumer.accept(frame)`。
 */
export class DshIdeConsumer extends Disposable {
	private readonly _onDidChangeRows = this._register(new Emitter<{ readonly state: DshIdeConsumerState; readonly diff: DshIdeRowDiff }>());
	private readonly _onDidFail = this._register(new Emitter<DshRemoteError>());

	/** 已接受的最新快照（未接受过为 undefined）。 */
	private last: DshIdeSnapshot | undefined;
	/** 按 id 索引的行（复用对象引用，diff 才能按引用判等）。 */
	private rows = new Map<string, DshIdeRow>();
	/** 合并窗口内待处理的帧：只保留最后一帧（version 严格递增，最后一帧最全）。 */
	private pending: DshIdeSnapshot | undefined;
	private mergeTimer: ReturnType<typeof setTimeout> | undefined;
	/** 是否已经因为连续性错误进入 fail-closed（拒绝后续帧直到 reset）。 */
	private failed = false;

	readonly onDidChangeRows: Event<{ readonly state: DshIdeConsumerState; readonly diff: DshIdeRowDiff }> = this._onDidChangeRows.event;
	readonly onDidFail: Event<DshRemoteError> = this._onDidFail.event;

	/** 当前渲染状态（不做任何校验，仅供读取）。 */
	get state(): DshIdeConsumerState {
		return {
			rows: [...this.rows.values()],
			version: this.last?.version ?? -1,
			channelId: this.last?.channelId,
			phase: this.last?.state.state ?? 'none',
		};
	}

	/**
	 * 接受一帧快照。返回是否真的被接受（合并窗口内的帧先返回 true，实际渲染稍后发生）。
	 *
	 * 顺序固定：结构校验 → 连续性 → 入合并窗口。任一步失败即 fail-closed：
	 * 不改变 `rows`、不推进 `version`，并经 `onDidFail` 报出确定错误码。
	 */
	accept(frame: unknown): boolean {
		if (this.failed) {
			// 已经 fail-closed：后续帧一律拒绝，直到 `reset()`。
			return false;
		}
		let validated: DshIdeSnapshot;
		try {
			validated = validateDshIdeSnapshot(frame);
		} catch (error) {
			this.fail('dsh-ide/invalid-argument', error);
			return false;
		}
		try {
			// 连续性必须对照「最近的已知帧」：合并窗口内已接受但还没渲染的帧也算已知，
			// 否则窗口内的第 2、3 帧会相对于已渲染帧出现假断号。
			assertSnapshotContinuity(this.pending ?? this.last, validated);
		} catch (error) {
			// 连续性违规：E4，流程级 STF；若只是「落后过多」则给出 SNAPSHOT_STALE 供上层刷新。
			const message = error instanceof Error ? error.message : String(error);
			const stale = /version gap/.test(message);
			this.fail(stale ? DSH_IDE_SNAPSHOT_STALE : 'dsh-ide/snapshot-continuity', error);
			return false;
		}
		this.schedule(validated);
		return true;
	}

	/** 清空失败标志与渲染状态（新一轮流程实例或 `refreshSnapshot` 之后调用）。 */
	reset(): void {
		if (this.mergeTimer !== undefined) {
			clearTimeout(this.mergeTimer);
			this.mergeTimer = undefined;
		}
		this.pending = undefined;
		this.last = undefined;
		this.rows = new Map();
		this.failed = false;
		this.failReason = undefined;
	}

	override dispose(): void {
		if (this.mergeTimer !== undefined) {
			clearTimeout(this.mergeTimer);
			this.mergeTimer = undefined;
		}
		super.dispose();
	}

	/** 16ms 合并：窗口内只保留最后一帧，避免逐 token 重排。 */
	private schedule(frame: DshIdeSnapshot): void {
		this.pending = frame;
		// pending 在窗口内代表「已接受的最新帧」，连续性校验以它为准（见 accept()）。
		if (this.mergeTimer !== undefined) {
			return;
		}
		this.mergeTimer = setTimeout(() => {
			this.mergeTimer = undefined;
			const next = this.pending;
			this.pending = undefined;
			if (next !== undefined) {
				this.apply(next);
			}
		}, DSH_IDE_MERGE_WINDOW_MS);
	}

	/** 真正落帧：按稳定 id diff，只把新增/变更行交给渲染方。 */
	private apply(frame: DshIdeSnapshot): void {
		this.last = frame;
		if (frame.state.state !== 'ready' || frame.state.view === undefined) {
			// starting / rebuild：不携带投影载荷，保持现有行不变（rebuild 由上层刷新全量）。
			this._onDidChangeRows.fire({ state: this.state, diff: { added: [], changed: [] } });
			return;
		}

		const previous = this.rows;
		const next = new Map<string, DshIdeRow>();
		const added: DshIdeRow[] = [];
		const changed: DshIdeRow[] = [];
		for (const row of frame.state.view.rows) {
			next.set(row.id, row);
			const old = previous.get(row.id);
			if (old === undefined) {
				added.push(row);
			} else if (!sameRow(old, row)) {
				changed.push(row);
			}
		}
		this.rows = next;
		this._onDidChangeRows.fire({ state: this.state, diff: { added, changed } });
	}

	/** 已发出的失败原因：同一原因只报一次，避免逐帧刷屏（后续帧静默拒绝即可）。 */
	private failReason: string | undefined;

	private fail(code: string, error: unknown): void {
		this.failed = true;
		const message = error instanceof Error ? error.message : String(error);
		const reason = `${code}: ${message}`;
		if (this.failReason === reason) {
			return;
		}
		this.failReason = reason;
		this._onDidFail.fire({ code, message });
	}
}

/** 行内容是否相同（revision 已由投影器维护，这里以它为准，避免逐字段深比较）。 */
function sameRow(a: DshIdeRow, b: DshIdeRow): boolean {
	return a.revision === b.revision && a.kind === b.kind && a.folded === b.folded && a.text === b.text && a.preview === b.preview;
}

/** 行类别的展示顺序权重（供 Chat 侧栏按 kind 分组渲染时复用）。 */
export const DSH_IDE_ROW_KIND_ORDER: readonly DshIdeRowKind[] = ['system', 'notice', 'user', 'assistant', 'tool'];
