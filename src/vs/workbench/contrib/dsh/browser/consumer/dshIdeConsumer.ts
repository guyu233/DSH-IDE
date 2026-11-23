/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 会话帧的读取口：直接读 `sessionController.follow` 的帧，不翻译成另一套行。
//
// 边界（第 1 章 §3）：本文件在 `workbench/**`，**零 `@deepseek-ai/*`**，只消费帧；
// 不理解 DSH 内部模型，也不复制会话状态。
//
// fail-closed 纪律（第 2 章 §5.1）：`version` 断号、倒退、`channelId` / `wireRevision` 变化
// 一律拒绝该帧，且**不改变**已渲染状态。

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import {
	DSH_IDE_SNAPSHOT_STALE,
	assertSnapshotContinuity,
	validateDshIdeSnapshot,
	type DshIdeSnapshot,
	type DshIdeViewBinding,
	type DshIdeViewSnapshot,
	type DshRemoteError,
} from '../../../../../platform/dshClient/protocol/dshIdeProtocol.js';

/** 消费者对外暴露的帧状态。 */
export interface DshIdeConsumerState {
	/** 最近一帧跟会话结果；未收到为 undefined。 */
	readonly frame: Readonly<Record<string, unknown>> | undefined;
	/**
	 * 最近一帧的完整 typed 视图（`conversation` / `pending` / `deliverables` 等）。
	 *
	 * 渲染层读这个；`frame` 只作为兼容回退保留，稳定路径不再依赖裸帧。
	 */
	readonly view: DshIdeViewSnapshot | undefined;
	/** 已接受快照的 version；未接受过为 -1。 */
	readonly version: number;
	readonly channelId: string | undefined;
	/** 最近一次被接受帧的整体状态（starting/ready/rebuild）。 */
	readonly phase: 'starting' | 'ready' | 'rebuild' | 'none';
	/** 该帧声明的视图绑定：渲染层据此判断内容是否仍属于当前资源与代次。 */
	readonly binding: DshIdeViewBinding | undefined;
}

/** 合并窗口：一帧内到达的多次 accept 合并成一次渲染（第 4 章 T7 的 16ms）。 */
export const DSH_IDE_MERGE_WINDOW_MS = 16;

/**
 * 把新视图叠到上一次的视图上。
 *
 * 契约规定「字段缺席 = 本帧没带，保留上一次的值」。合并窗口会把同一窗口内的多帧
 * 折成最后一帧，中间帧独有的字段（例如只在 opening baseline 里出现的 `plan`）
 * 因此会缺席——这时必须从上一份视图补回来，否则合并本身造成丢字段。
 * 空值形态（`todos: []`、`pending: []`）是显式表达，照原样覆盖。
 * @param previous 上一次已应用的视图；换绑后为 undefined
 * @param next 本帧带来的视图
 */
function mergeViewSnapshot(previous: DshIdeViewSnapshot | undefined, next: DshIdeViewSnapshot): DshIdeViewSnapshot {
	if (previous === undefined) {
		return next;
	}
	const merged: Record<string, unknown> = { ...previous, ...next };
	// 逐字段判定：只有「本帧没有这个键」时才沿用上一份。
	for (const key of DSH_IDE_VIEW_OPTIONAL_KEYS) {
		if (!Object.hasOwn(next, key) && Object.hasOwn(previous, key)) {
			merged[key] = (previous as unknown as Record<string, unknown>)[key];
		}
	}
	return merged as unknown as DshIdeViewSnapshot;
}

/**
 * 合并窗口内两帧合成一帧。
 *
 * 只有「同绑定、且后一帧仍是 ready」才合并视图：换绑或退出 ready 时后一帧就是新事实，
 * 前一帧的视图必须丢弃，不能把上一个会话的内容带进新状态。
 */
function mergeSnapshot(previous: DshIdeSnapshot, next: DshIdeSnapshot): DshIdeSnapshot {
	const sameBinding = previous.binding.viewId === next.binding.viewId
		&& previous.binding.generation === next.binding.generation;
	if (!sameBinding || next.state.state !== 'ready' || next.state.view === undefined) {
		return next;
	}
	if (previous.state.state !== 'ready' || previous.state.view === undefined) {
		return next;
	}
	return { ...next, state: { ...next.state, view: mergeViewSnapshot(previous.state.view, next.state.view) } };
}

/** `DshIdeViewSnapshot` 里「缺席表示保留上一次」的可选投影字段。 */
const DSH_IDE_VIEW_OPTIONAL_KEYS = [
	'conversation', 'deliverables', 'attachments', 'plan', 'goal', 'todos', 'skills', 'team', 'worktrees',
	'tokenUsageDelta', 'tokenUsageTotal', 'contextPressure', 'quotaNotice', 'composer', 'pending',
] as const;

/**
 * 帧消费者。`accept()` 是唯一入口；渲染经 `onDidChangeFrame` 单向通知。
 */
export class DshIdeConsumer extends Disposable {
	private readonly _onDidChangeFrame = this._register(new Emitter<{ readonly state: DshIdeConsumerState }>());
	private readonly _onDidFail = this._register(new Emitter<DshRemoteError>());

	private last: DshIdeSnapshot | undefined;
	private current: Readonly<Record<string, unknown>> | undefined;
	private currentView: DshIdeViewSnapshot | undefined;
	private pending: DshIdeSnapshot | undefined;
	private mergeTimer: ReturnType<typeof setTimeout> | undefined;
	private failed = false;
	private failReason: string | undefined;

	readonly onDidChangeFrame: Event<{ readonly state: DshIdeConsumerState }> = this._onDidChangeFrame.event;
	readonly onDidFail: Event<DshRemoteError> = this._onDidFail.event;

	get state(): DshIdeConsumerState {
		return {
			frame: this.current,
			view: this.currentView,
			version: this.last?.version ?? -1,
			channelId: this.last?.channelId,
			phase: this.last?.state.state ?? 'none',
			binding: this.last?.binding,
		};
	}

	/** 接受一帧快照。结构校验 → 连续性 → 入合并窗口。 */
	accept(frame: unknown): boolean {
		if (this.failed) {
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
			assertSnapshotContinuity(this.pending ?? this.last, validated);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			// 三种不连续都意味着「本地序列已经跟不上 Host」：gap（丢帧）、倒退（Host 重开序列）、
			// 持平（重复帧）。三者都只能靠重新拉一次快照恢复；只把 gap 归为 stale 的话，
			// 另外两种会把界面永久钉死（`failed` 只能由 `reset()` 解除），用户看不到任何恢复入口。
			const stale = /version gap|version went backwards|version did not advance/.test(message);
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
		this.current = undefined;
		this.currentView = undefined;
		this.failed = false;
		this.failReason = undefined;
	}

	/**
	 * 是否因帧被拒绝而熔断（只能靠 `reset()` 解除）。
	 *
	 * `fail()` 之后 `accept()` 一律返回 false。恢复走 `onDidFail` → `refreshSnapshot` →
	 * `reset()`；本属性只用于**诊断与断言**，不触发任何动作，别当成恢复入口。
	 */
	get needsRefresh(): boolean {
		return this.failed;
	}

	override dispose(): void {
		if (this.mergeTimer !== undefined) {
			clearTimeout(this.mergeTimer);
			this.mergeTimer = undefined;
		}
		super.dispose();
	}

	private schedule(frame: DshIdeSnapshot): void {
		// 合并发生在窗口内：先到的帧可能带着后续帧没有的字段（opening baseline），
		// 直接覆盖 `pending` 会让这些字段在渲染前就丢掉。这里把它们并进待应用帧。
		this.pending = this.pending === undefined ? frame : mergeSnapshot(this.pending, frame);
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

	private apply(frame: DshIdeSnapshot): void {
		// 换绑或重建：上一代的内容不再属于本视图，必须先丢掉。
		// 否则新会话的 starting 帧会让界面继续显示上一个会话的 ready 视图。
		const previous = this.last;
		const rebound = previous !== undefined && (
			previous.binding.viewId !== frame.binding.viewId
			|| previous.binding.generation !== frame.binding.generation
		);
		if (rebound || frame.state.state !== 'ready' || frame.state.view === undefined) {
			this.current = undefined;
			this.currentView = undefined;
		}
		if (frame.state.state === 'ready' && frame.state.view !== undefined) {
			// 合并窗口里被折掉的中间帧可能只带部分字段：缺席表示「本帧没带」，
			// 保留上一次的值，不能因为合并就把基线字段擦掉。
			const merged = mergeViewSnapshot(rebound ? undefined : this.currentView, frame.state.view);
			this.current = merged.frame;
			this.currentView = merged;
		}
		// 版本没前进、状态也没变时不必再通知：内核会周期性重发同一份快照，
		// 每帧都让渲染层重建一次是纯开销。`version` 只允许递增，用它判重最省。
		const unchanged = previous !== undefined
			&& !rebound
			&& previous.version === frame.version
			&& previous.state.state === frame.state.state;
		this.last = frame;
		if (unchanged) {
			return;
		}
		this._onDidChangeFrame.fire({ state: this.state });
	}

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
