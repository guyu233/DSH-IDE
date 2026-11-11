/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// D49：IDE renderer 侧的会话列表状态机（第 8 章 §8.10.2「正常 / 未绑定」两态）。
//
// 唯一刷新入口 refresh()：手动刷新、窗口聚焦、删除成功后都由它主动重查，不定时轮询。
// 只消费中立 DTO `IDshIdeSessionSummary`，零 @deepseek-ai/*、不持有第二份会话真源——
// 每次刷新都以 Host 返回的可见名单为准（第 1 章 I4 / §8.2.4 有边界最终一致）。
//
// fail-closed：未绑定时既不取数、也不允许 delete；迟到响应按 generation 作废，
// 绝不让旧绑定的列表回写新绑定（第 8 章 §8.10.2、§8.10.5 降级规则）。
// 删除成功后只重查，不设「已删除 / 未知」两态；刷新失败保留旧列表并报告原因。

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type { IDshIdeSessionSummary } from '../../../../platform/dshClient/common/dshIdeProtocol.js';

/** 列表两态：绑定了会话即 normal（名单可为空），否则 unbound。 */
export type DshIdeSessionListPhase = 'unbound' | 'normal';

/** 对外只读快照。lastError 只是刷新失败提示，不构成第三种列表状态。 */
export interface IDshIdeSessionListState {
	readonly phase: DshIdeSessionListPhase;
	/** 已绑定时当前可见会话；未绑定恒为空数组。 */
	readonly items: readonly IDshIdeSessionSummary[];
	/** 最近一次刷新失败原因；成功刷新后清空。 */
	readonly lastError: string | undefined;
}

/** 状态机只依赖这两个 Host 调用，便于离线单测，也不绑死具体通道实现。 */
export interface IDshIdeSessionListSource {
	list(): Promise<readonly IDshIdeSessionSummary[]>;
	remove(sessionId: string): Promise<void>;
}

export type DshIdeSessionListResult =
	| { readonly ok: true }
	| { readonly ok: false; readonly error: string };

/**
 * 会话列表状态机。`refresh()` 是唯一的取数入口：focus / 手动刷新 / 删除成功后都汇到这里。
 * 用法：`const m = new DshIdeSessionListModel(source, sessionId); m.onDidChangeState(...); m.refresh()`。
 */
export class DshIdeSessionListModel extends Disposable {
	private readonly _onDidChangeState = this._register(new Emitter<IDshIdeSessionListState>());
	readonly onDidChangeState: Event<IDshIdeSessionListState> = this._onDidChangeState.event;

	private _bound: string | undefined;
	private _items: readonly IDshIdeSessionSummary[] = [];
	private _lastError: string | undefined;
	/** 每次 bind / refresh 递增；迟到响应发现自己过时即作废。 */
	private _generation = 0;
	/** 合并同一时刻的重复触发；删除成功后会被显式作废以强制重查。 */
	private _inFlight: Promise<void> | undefined;
	private _inFlightGeneration = 0;

	constructor(
		private readonly source: IDshIdeSessionListSource,
		boundSessionId: string | undefined,
	) {
		super();
		this._bound = normalizeBinding(boundSessionId);
	}

	get state(): IDshIdeSessionListState {
		return {
			phase: this._bound === undefined ? 'unbound' : 'normal',
			items: this._items,
			lastError: this._lastError,
		};
	}

	get isBound(): boolean {
		return this._bound !== undefined;
	}

	get boundSessionId(): string | undefined {
		return this._bound;
	}

	/** 绑定 / 重绑 / 解绑；任何变化都作废在途刷新，避免旧工作区数据回写。 */
	bind(sessionId: string | undefined): void {
		const next = normalizeBinding(sessionId);
		if (next === this._bound) {
			return;
		}
		this._generation += 1;
		this._inFlight = undefined;
		this._bound = next;
		this._items = [];
		this._lastError = undefined;
		this._onDidChangeState.fire(this.state);
	}

	/** 单一取数入口：手动刷新、窗口聚焦、删除成功后都调用它。 */
	refresh(): Promise<void> {
		if (this._bound === undefined) {
			// 未绑定：零取数、零请求（fail-closed，禁止降级显示全部会话）。
			return Promise.resolve();
		}
		if (this._inFlight !== undefined) {
			return this._inFlight;
		}
		const generation = ++this._generation;
		const work = (async () => {
			try {
				const items = await this.source.list();
				if (generation !== this._generation) {
					return;
				}
				this._items = items;
				this._lastError = undefined;
				this._onDidChangeState.fire(this.state);
			} catch (error) {
				if (generation !== this._generation) {
					return;
				}
				// 刷新失败：保留旧列表并明确报告，绝不伪造空列表或「已删除」态。
				this._lastError = errorMessage(error);
				this._onDidChangeState.fire(this.state);
			}
		})().finally(() => {
			if (this._inFlightGeneration === generation) {
				this._inFlight = undefined;
			}
		});
		this._inFlight = work;
		this._inFlightGeneration = generation;
		return work;
	}

	/**
	 * 删除会话：先走 Host 公开 deleteSession，成功后作废在途旧读并主动重查；
	 * 本地不标记删除态，列表由刷新后的 Host 真源自然收敛（§8.10.4 B⑧）。
	 */
	async deleteSession(sessionId: string): Promise<DshIdeSessionListResult> {
		if (this._bound === undefined) {
			return { ok: false, error: 'unbound' };
		}
		try {
			await this.source.remove(sessionId);
		} catch (error) {
			this._lastError = errorMessage(error);
			this._onDidChangeState.fire(this.state);
			return { ok: false, error: this._lastError };
		}
		// 删除已生效：作废可能的在途旧读，强制以 Host 真源重查。
		// 重查失败时 refresh 会保留旧列表并报告「刷新失败」（§8.10.5 降级规则）。
		this._generation += 1;
		this._inFlight = undefined;
		await this.refresh();
		return { ok: true };
	}

	override dispose(): void {
		// 作废所有在途读取，窗口关闭后不允许迟到响应改动状态。
		this._generation += 1;
		this._inFlight = undefined;
		super.dispose();
	}
}

function normalizeBinding(sessionId: string | undefined): string | undefined {
	return typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined;
}

/** 把通道错误收敛成可读文案：优先官方 code，其次 message，最后兜底字符串。 */
function errorMessage(error: unknown): string {
	if (typeof error === 'object' && error !== null) {
		const coded = error as { readonly code?: unknown; readonly message?: unknown };
		if (typeof coded.code === 'string') {
			return coded.code;
		}
		if (typeof coded.message === 'string') {
			return coded.message;
		}
	}
	return error instanceof Error ? error.message : String(error);
}
