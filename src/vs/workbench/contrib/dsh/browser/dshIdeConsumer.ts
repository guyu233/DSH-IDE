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

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import {
	DSH_IDE_SNAPSHOT_STALE,
	assertSnapshotContinuity,
	validateDshIdeSnapshot,
	type DshIdeSnapshot,
	type DshRemoteError,
} from '../../../../platform/dshClient/common/dshIdeProtocol.js';

/** 消费者对外暴露的帧状态。 */
export interface DshIdeConsumerState {
	/** 最近一帧跟会话结果；未收到为 undefined。 */
	readonly frame: Readonly<Record<string, unknown>> | undefined;
	/** 已接受快照的 version；未接受过为 -1。 */
	readonly version: number;
	readonly channelId: string | undefined;
	/** 最近一次被接受帧的整体状态（starting/ready/rebuild）。 */
	readonly phase: 'starting' | 'ready' | 'rebuild' | 'none';
}

/** 合并窗口：一帧内到达的多次 accept 合并成一次渲染（第 4 章 T7 的 16ms）。 */
export const DSH_IDE_MERGE_WINDOW_MS = 16;

/**
 * 帧消费者。`accept()` 是唯一入口；渲染经 `onDidChangeFrame` 单向通知。
 */
export class DshIdeConsumer extends Disposable {
	private readonly _onDidChangeFrame = this._register(new Emitter<{ readonly state: DshIdeConsumerState }>());
	private readonly _onDidFail = this._register(new Emitter<DshRemoteError>());

	private last: DshIdeSnapshot | undefined;
	private current: Readonly<Record<string, unknown>> | undefined;
	private pending: DshIdeSnapshot | undefined;
	private mergeTimer: ReturnType<typeof setTimeout> | undefined;
	private failed = false;
	private failReason: string | undefined;

	readonly onDidChangeFrame: Event<{ readonly state: DshIdeConsumerState }> = this._onDidChangeFrame.event;
	readonly onDidFail: Event<DshRemoteError> = this._onDidFail.event;

	get state(): DshIdeConsumerState {
		return {
			frame: this.current,
			version: this.last?.version ?? -1,
			channelId: this.last?.channelId,
			phase: this.last?.state.state ?? 'none',
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
		this.current = undefined;
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

	private schedule(frame: DshIdeSnapshot): void {
		this.pending = frame;
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
		this.last = frame;
		if (frame.state.state === 'ready' && frame.state.view !== undefined) {
			this.current = frame.state.view.frame;
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
