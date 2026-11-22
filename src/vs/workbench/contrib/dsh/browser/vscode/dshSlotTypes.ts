/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH slot 的两个轴：基数与作用域。
// 真源是 ui-chat 的 SlotMap 声明合并；这里只放类型，裁决在 dshSlotRegistry.ts。
// priority 低值先执行；order 低值在 list 里更靠前，在 hoc 里是更外层。

/** 一个槽位能同时容纳多少 occupant，以及怎么从中选出要渲染的那个。 */
export type DshSlotCardinality = 'single' | 'list' | 'keyed' | 'chain' | 'hoc';

/** 槽位要不要会话绑定。 */
export type DshSlotScope = 'root' | 'session-maybe' | 'session';

/** 声明一个槽。key 空间不在声明里，运行时由 occupant 的 key 打开。 */
export interface DshSlotDeclaration {
	readonly name: string;
	readonly cardinality: DshSlotCardinality;
	readonly scope: DshSlotScope;
	/** host 锁定的 prop 名。occupant 同名字段不能覆盖这些值。 */
	readonly ownerProps?: readonly string[];
}

/** 注册期工厂的返回。value 是该 entry 的私有数据。 */
export interface DshSlotInjection {
	readonly value: unknown;
	dispose?(): void;
}

/** 一次注册。list 必须有 id；keyed / hoc 用 key 分发；chain 用 select。 */
export interface DshSlotEntry {
	readonly id?: string;
	readonly priority?: number;
	readonly order?: number;
	readonly key?: string;
	readonly props?: Readonly<Record<string, unknown>>;
	readonly select?: (owner: DshSlotOwner) => unknown;
	readonly inject?: (sessionId: string | undefined) => DshSlotInjection;
}

/** resolve 时 host 交给槽位的上下文。 */
export interface DshSlotOwner {
	readonly sessionId?: string;
	readonly entryKey?: string;
	readonly props?: Readonly<Record<string, unknown>>;
	readonly fallback?: unknown;
	readonly children?: unknown;
}

/** 选中的一个 occupant。props 已经用 owner 锁定字段盖过 entry。 */
export interface DshSlotOccupant {
	readonly id?: string;
	readonly key?: string;
	readonly priority: number;
	readonly order: number;
	readonly props: Readonly<Record<string, unknown>>;
	readonly injected: unknown;
	readonly selected?: unknown;
}

export interface DshSlotResolution {
	readonly name: string;
	readonly cardinality: DshSlotCardinality;
	readonly status: 'rendered' | 'fallback' | 'unbound' | 'empty';
	readonly occupants: readonly DshSlotOccupant[];
	readonly fallback?: unknown;
	readonly children?: unknown;
}

export interface DshSlotCatalogEntry {
	readonly name: string;
	readonly cardinality: DshSlotCardinality;
	readonly scope: DshSlotScope;
	readonly ownerProps: readonly string[];
	readonly entryCount: number;
	readonly childSlots: readonly string[];
}

export interface DshSlotCatalog {
	readonly slots: readonly DshSlotCatalogEntry[];
}

/** snapshot() 里的一个 occupant。active 表示它是该 cell 当前胜出的登记。 */
export interface DshSlotLiveOccupant {
	readonly id?: string;
	readonly key?: string;
	readonly priority: number;
	readonly order: number;
	readonly active: boolean;
}

/** 一棵已声明槽的活树。children 只含这个槽的 entry 声明出来的子槽。 */
export interface DshSlotLiveNode {
	readonly name: string;
	readonly cardinality: DshSlotCardinality;
	readonly scope: DshSlotScope;
	readonly occupants: readonly DshSlotLiveOccupant[];
	readonly children: readonly DshSlotLiveNode[];
}
