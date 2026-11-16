/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 按槽位挑选贡献。同一 slot 内按 priority 降序存放，缺省为 0。
//
// 选择顺序：
// 1. 调用方给了 key：只用 key 精确相等的贡献，取 priority 最高的一条；
// 2. 否则：只用 key === undefined 的贡献，取 priority 最高的一条；
// 3. 都没有：调用 fallback。
// 精确 key 不会退回无 key 的贡献。不返回 null，也不吞掉 create / fallback 抛出的异常。
// 重复 register 允许；dispose 只摘掉对应那一条。同优先级保持注册先后，先注册者排在前面。

import type { DshSlotContextBase, DshSlotContribution, DshSlotId } from './dshSlotTypes.js';

interface IDshSlotRegistration<TContext> {
	readonly contribution: DshSlotContribution<TContext>;
	readonly priority: number;
}

export class DshSlotRegistry<TContext extends DshSlotContextBase = DshSlotContextBase> {
	private readonly _entries = new Map<DshSlotId, IDshSlotRegistration<TContext>[]>();

	register(entry: DshSlotContribution<TContext>): { dispose(): void } {
		const priority = entry.priority ?? 0;
		const record: IDshSlotRegistration<TContext> = { contribution: entry, priority };
		let list = this._entries.get(entry.slot);
		if (!list) {
			list = [];
			this._entries.set(entry.slot, list);
		}
		let insertAt = list.length;
		for (let i = 0; i < list.length; i++) {
			if (list[i].priority < priority) {
				insertAt = i;
				break;
			}
		}
		list.splice(insertAt, 0, record);
		return {
			dispose: () => {
				const current = this._entries.get(entry.slot);
				if (!current) {
					return;
				}
				const index = current.indexOf(record);
				if (index >= 0) {
					current.splice(index, 1);
				}
			},
		};
	}

	renderSlot<TView extends { readonly domNode: unknown }>(
		slot: DshSlotId,
		context: TContext,
		options: { readonly key?: string; readonly fallback: (context: TContext) => TView },
	): TView | { readonly domNode: unknown } {
		const contribution = this._select(slot, options.key);
		const view = contribution ? contribution.create(context) : options.fallback(context);
		if (view === null || view === undefined) {
			throw new Error('DshSlotRegistry.renderSlot must not return null');
		}
		return view;
	}

	/** 列表已按 priority 降序，命中的第一条就是最高优先级。 */
	private _select(slot: DshSlotId, key: string | undefined): DshSlotContribution<TContext> | undefined {
		const list = this._entries.get(slot);
		if (!list || list.length === 0) {
			return undefined;
		}
		if (key !== undefined) {
			for (const record of list) {
				if (record.contribution.key === key) {
					return record.contribution;
				}
			}
			return undefined;
		}
		for (const record of list) {
			if (record.contribution.key === undefined) {
				return record.contribution;
			}
		}
		return undefined;
	}
}
