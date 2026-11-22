/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH slot 裁决。基数和作用域是两个轴，对齐
// packages/client/ui-slots 的 SlotCore（低 priority 先渲染；同 cell 同 priority 拒绝）。
// list / hoc 的展示序用 order，低值更靠前；hoc 低 order 在最外层。
// 同 key 的 keyed occupant 不删旧登记，靠 priority 选出当前胜者，胜者即替换展示。
// entry 销毁时折叠它声明的子槽，并停掉 inject() 等在该声明上的效果。

import type {
	DshSlotCatalog,
	DshSlotDeclaration,
	DshSlotEntry,
	DshSlotLiveNode,
	DshSlotOccupant,
	DshSlotOwner,
	DshSlotResolution,
} from './dshSlotTypes.js';

interface LiveInjection {
	readonly sessionId: string | undefined;
	readonly value: unknown;
	dispose?(): void;
}

interface LiveEntry {
	readonly spec: DshSlotEntry;
	readonly index: number;
	readonly childSlots: string[];
	readonly injections: LiveInjection[];
	released: boolean;
}

interface LiveSlot {
	readonly declaration: DshSlotDeclaration;
	readonly entries: LiveEntry[];
	childOf?: string;
}

interface DeclarationWaiter {
	readonly effect: () => { dispose(): void } | void;
	running?: { dispose(): void } | void;
	started: boolean;
	disposed: boolean;
}

export interface DshSlotRegistration {
	/** 这个 entry 声明的子槽。子槽名必须还没被声明；entry dispose 时子槽一起拆掉。 */
	declare(declaration: DshSlotDeclaration): void;
	dispose(): void;
}

/** 槽位注册表。变更通过 onDidChange 通知，不在这里刷新聊天区。 */
export class DshSlotRegistry {
	private readonly slots = new Map<string, LiveSlot>();
	private readonly listeners = new Set<() => void>();
	private readonly waiters = new Map<string, Set<DeclarationWaiter>>();
	private nextIndex = 0;

	/** 槽位声明、注册或释放后触发。监听方自己决定要不要重绘。 */
	onDidChange(listener: () => void): { dispose(): void } {
		this.listeners.add(listener);
		return { dispose: () => { this.listeners.delete(listener); } };
	}

	/**
	 * 等一个槽的声明生命周期。
	 *
	 * 槽已经声明时立刻跑 effect；还没声明时挂起，声明出现后再跑。
	 * 声明被折叠时停掉 effect，同一名字再次声明时重新跑。
	 * 返回的 dispose 只取消这一次等待，不折叠槽本身。
	 */
	inject(name: string, effect: () => { dispose(): void } | void): { dispose(): void } {
		const waiter: DeclarationWaiter = { effect, started: false, disposed: false };
		let group = this.waiters.get(name);
		if (group === undefined) {
			group = new Set();
			this.waiters.set(name, group);
		}
		group.add(waiter);
		if (this.slots.has(name)) {
			this.startWaiter(waiter);
		}
		return {
			dispose: () => {
				if (waiter.disposed) {
					return;
				}
				waiter.disposed = true;
				group.delete(waiter);
				this.stopWaiter(waiter);
			},
		};
	}

	/** 声明根槽。同名同基数同作用域再声明是空操作；形状不同则抛错。 */
	declare(declaration: DshSlotDeclaration): void {
		const existing = this.slots.get(declaration.name);
		if (existing !== undefined) {
			if (existing.declaration.cardinality !== declaration.cardinality || existing.declaration.scope !== declaration.scope) {
				throw new Error(`slot ${declaration.name} is already declared with a different cardinality or scope`);
			}
			return;
		}
		this.slots.set(declaration.name, { declaration, entries: [] });
		this.startWaiters(declaration.name);
		this.emit();
	}

	/**
	 * 往已声明的槽注册一个 occupant。
	 * list / hoc 必须带 id，keyed 必须带 key，chain 必须带 select。
	 * 同一 cell 上 priority 相同直接抛错；不同 priority 共存，低值胜出。
	 */
	register(name: string, entry: DshSlotEntry): DshSlotRegistration {
		const slot = this.requireSlot(name);
		this.assertEntry(name, slot, entry);
		const live: LiveEntry = { spec: entry, index: this.nextIndex++, childSlots: [], injections: [], released: false };
		slot.entries.push(live);
		this.emit();
		let disposed = false;
		return {
			declare: declaration => {
				if (disposed || live.released) {
					throw new Error(`slot entry on ${name} is disposed`);
				}
				if (this.slots.has(declaration.name)) {
					throw new Error(`slot ${declaration.name} is already declared`);
				}
				this.declare(declaration);
				const child = this.slots.get(declaration.name);
				if (child !== undefined) {
					child.childOf = name;
					live.childSlots.push(declaration.name);
				}
			},
			dispose: () => {
				if (disposed) {
					return;
				}
				disposed = true;
				this.disposeEntry(name, live);
			},
		};
	}

	/** 按 host 的 owner 选出要渲染的 occupant。session 槽没有 sessionId 时是 unbound。 */
	resolve(name: string, owner: DshSlotOwner = {}): DshSlotResolution {
		const slot = this.requireSlot(name);
		if (slot.declaration.scope === 'session' && (owner.sessionId === undefined || owner.sessionId === '')) {
			return { name, cardinality: slot.declaration.cardinality, status: 'unbound', occupants: [] };
		}
		const occupants = this.occupantsOf(slot, owner);
		if (occupants.length === 0) {
			const fallback = slot.declaration.cardinality === 'chain' || slot.declaration.cardinality === 'hoc';
			return {
				name,
				cardinality: slot.declaration.cardinality,
				status: fallback ? 'fallback' : 'empty',
				occupants: [],
				...(fallback && owner.fallback !== undefined ? { fallback: owner.fallback } : {}),
				...(slot.declaration.cardinality === 'hoc' && owner.children !== undefined ? { children: owner.children } : {}),
			};
		}
		return {
			name,
			cardinality: slot.declaration.cardinality,
			status: 'rendered',
			occupants,
			...(slot.declaration.cardinality === 'hoc' && owner.children !== undefined ? { children: owner.children } : {}),
		};
	}

	/** 运行时目录：已声明的槽、occupant 数量、子槽名。 */
	catalog(): DshSlotCatalog {
		const slots = [...this.slots.values()].map(slot => ({
			name: slot.declaration.name,
			cardinality: slot.declaration.cardinality,
			scope: slot.declaration.scope,
			ownerProps: slot.declaration.ownerProps ?? [],
			entryCount: slot.entries.length,
			childSlots: unique(slot.entries.flatMap(entry => entry.childSlots)),
		}));
		slots.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
		return { slots };
	}

	/**
	 * 当前声明树。occupants 里 active 表示该 cell 的胜者。
	 * root 省略时返回全部没有父槽的根。
	 */
	snapshot(root?: string): readonly DshSlotLiveNode[] {
		const build = (name: string, seen: ReadonlySet<string>): DshSlotLiveNode | undefined => {
			const slot = this.slots.get(name);
			if (slot === undefined || seen.has(name)) {
				return undefined;
			}
			const branch = new Set(seen);
			branch.add(name);
			const active = new Set(this.cellWinners(slot));
			const childNames = unique(slot.entries.flatMap(entry => entry.childSlots));
			const children: DshSlotLiveNode[] = [];
			for (const childName of childNames) {
				const child = build(childName, branch);
				if (child !== undefined) {
					children.push(child);
				}
			}
			return {
				name,
				cardinality: slot.declaration.cardinality,
				scope: slot.declaration.scope,
				occupants: slot.entries.map(entry => ({
					...(entry.spec.id === undefined ? {} : { id: entry.spec.id }),
					...(entry.spec.key === undefined ? {} : { key: entry.spec.key }),
					priority: entry.spec.priority ?? 0,
					order: entry.spec.order ?? 0,
					active: active.has(entry),
				})),
				children,
			};
		};
		if (root !== undefined) {
			const node = build(root, new Set());
			return node === undefined ? [] : [node];
		}
		const roots: DshSlotLiveNode[] = [];
		for (const [name, slot] of this.slots) {
			if (slot.childOf !== undefined) {
				continue;
			}
			const node = build(name, new Set());
			if (node !== undefined) {
				roots.push(node);
			}
		}
		roots.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
		return roots;
	}

	private assertEntry(name: string, slot: LiveSlot, entry: DshSlotEntry): void {
		const cardinality = slot.declaration.cardinality;
		if ((cardinality === 'list' || cardinality === 'hoc') && (entry.id === undefined || entry.id === '')) {
			throw new Error(`${cardinality} slot ${name} requires an id`);
		}
		if (cardinality === 'keyed' && (entry.key === undefined || entry.key === '')) {
			throw new Error(`keyed slot ${name} requires a key`);
		}
		if (cardinality === 'chain' && entry.select === undefined) {
			throw new Error(`chain slot ${name} requires options.select`);
		}
		if (cardinality === 'chain') {
			return;
		}
		const cell = cellOf(cardinality, entry);
		const priority = entry.priority ?? 0;
		const occupant = slot.entries.find(live => !live.released && cellOf(cardinality, live.spec) === cell && (live.spec.priority ?? 0) === priority);
		if (occupant !== undefined) {
			throw new Error(`${cardinality} slot ${name} already has a registration at priority ${priority} — register at a different priority to shadow it (lowest renders)`);
		}
	}

	private requireSlot(name: string): LiveSlot {
		const slot = this.slots.get(name);
		if (slot === undefined) {
			throw new Error(`slot ${name} is not declared`);
		}
		return slot;
	}

	/** 每个 cell 的最低 priority 胜者，按登记序里 priority 升序第一次出现。 */
	private cellWinners(slot: LiveSlot): LiveEntry[] {
		if (slot.declaration.cardinality === 'chain') {
			return [...slot.entries].filter(entry => !entry.released).sort(byPriority);
		}
		const ordered = slot.entries.filter(entry => !entry.released).sort(byPriority);
		const heads: LiveEntry[] = [];
		const seen = new Set<string>();
		for (const entry of ordered) {
			const cell = cellOf(slot.declaration.cardinality, entry.spec);
			if (seen.has(cell)) {
				continue;
			}
			seen.add(cell);
			heads.push(entry);
		}
		return heads;
	}

	private occupantsOf(slot: LiveSlot, owner: DshSlotOwner): DshSlotOccupant[] {
		const cardinality = slot.declaration.cardinality;
		const winners = this.cellWinners(slot);
		if (cardinality === 'single') {
			const winner = winners[0];
			return winner === undefined ? [] : [this.materialize(slot, winner, owner)];
		}
		if (cardinality === 'list') {
			return [...winners].sort(byOrder).map(entry => this.materialize(slot, entry, owner));
		}
		if (cardinality === 'keyed') {
			const match = winners.find(entry => entry.spec.key === owner.entryKey);
			return match === undefined ? [] : [this.materialize(slot, match, owner)];
		}
		if (cardinality === 'chain') {
			for (const entry of winners) {
				const selected = entry.spec.select?.(owner);
				if (selected !== undefined && selected !== null) {
					return [this.materialize(slot, entry, owner, selected)];
				}
			}
			return [];
		}
		return this.hocLayers(winners, owner.entryKey).map(entry => this.materialize(slot, entry, owner));
	}

	/** 精确 key 替换同一 id 的通配层；结果从外到内，低 order 在前。 */
	private hocLayers(winners: readonly LiveEntry[], entryKey: string | undefined): LiveEntry[] {
		const byId = new Map<string, { exact?: LiveEntry; wildcard?: LiveEntry }>();
		for (const entry of winners) {
			const id = entry.spec.id;
			if (id === undefined) {
				continue;
			}
			const group = byId.get(id) ?? {};
			if (entry.spec.key === undefined) {
				group.wildcard = entry;
			} else if (entryKey !== undefined && entry.spec.key === entryKey) {
				group.exact = entry;
			}
			byId.set(id, group);
		}
		const layers: LiveEntry[] = [];
		for (const group of byId.values()) {
			const winner = group.exact ?? group.wildcard;
			if (winner !== undefined) {
				layers.push(winner);
			}
		}
		layers.sort(byOrder);
		return layers;
	}

	private materialize(slot: LiveSlot, entry: LiveEntry, owner: DshSlotOwner, selected?: unknown): DshSlotOccupant {
		const sessionId = slot.declaration.scope === 'root' ? undefined : owner.sessionId;
		const injected = this.injectionFor(entry, sessionId);
		return {
			...(entry.spec.id === undefined ? {} : { id: entry.spec.id }),
			...(entry.spec.key === undefined ? {} : { key: entry.spec.key }),
			priority: entry.spec.priority ?? 0,
			order: entry.spec.order ?? 0,
			props: mergeProps(slot.declaration.ownerProps ?? [], owner.props ?? {}, entry.spec.props ?? {}),
			injected,
			...(selected === undefined ? {} : { selected }),
		};
	}

	private injectionFor(entry: LiveEntry, sessionId: string | undefined): unknown {
		const cached = entry.injections.find(item => item.sessionId === sessionId);
		if (cached !== undefined) {
			return cached.value;
		}
		if (entry.spec.inject === undefined) {
			return undefined;
		}
		const created = entry.spec.inject(sessionId);
		entry.injections.push({ sessionId, value: created.value, dispose: created.dispose });
		return created.value;
	}

	private disposeEntry(name: string, entry: LiveEntry): void {
		const slot = this.slots.get(name);
		if (slot !== undefined) {
			const index = slot.entries.indexOf(entry);
			if (index >= 0) {
				slot.entries.splice(index, 1);
			}
		}
		for (const childName of [...entry.childSlots]) {
			this.disposeSlot(childName);
		}
		this.release(entry);
		this.emit();
	}

	private disposeSlot(name: string): void {
		const slot = this.slots.get(name);
		if (slot === undefined) {
			return;
		}
		this.slots.delete(name);
		this.stopWaiters(name);
		for (const entry of [...slot.entries]) {
			for (const childName of [...entry.childSlots]) {
				this.disposeSlot(childName);
			}
			this.release(entry);
		}
	}

	private release(entry: LiveEntry): void {
		if (entry.released) {
			return;
		}
		entry.released = true;
		for (const injection of entry.injections) {
			injection.dispose?.();
		}
		entry.injections.splice(0, entry.injections.length);
	}

	private startWaiters(name: string): void {
		const group = this.waiters.get(name);
		if (group === undefined) {
			return;
		}
		for (const waiter of [...group]) {
			this.startWaiter(waiter);
		}
	}

	private stopWaiters(name: string): void {
		const group = this.waiters.get(name);
		if (group === undefined) {
			return;
		}
		for (const waiter of [...group]) {
			this.stopWaiter(waiter);
		}
	}

	private startWaiter(waiter: DeclarationWaiter): void {
		if (waiter.disposed || waiter.started) {
			return;
		}
		waiter.started = true;
		const running = waiter.effect();
		if (waiter.disposed) {
			running?.dispose();
			return;
		}
		waiter.running = running;
	}

	private stopWaiter(waiter: DeclarationWaiter): void {
		const running = waiter.running;
		waiter.running = undefined;
		waiter.started = false;
		running?.dispose();
	}

	private emit(): void {
		for (const listener of [...this.listeners]) {
			listener();
		}
	}
}

function cellOf(cardinality: DshSlotDeclaration['cardinality'], entry: DshSlotEntry): string {
	if (cardinality === 'keyed') {
		return `k:${entry.key ?? ''}`;
	}
	if (cardinality === 'list') {
		return `id:${entry.id ?? ''}`;
	}
	if (cardinality === 'hoc') {
		return entry.key === undefined ? `*:${entry.id ?? ''}` : `${entry.key}:${entry.id ?? ''}`;
	}
	return '*';
}

function byPriority(a: LiveEntry, b: LiveEntry): number {
	return (a.spec.priority ?? 0) - (b.spec.priority ?? 0) || a.index - b.index;
}

function byOrder(a: LiveEntry, b: LiveEntry): number {
	return (a.spec.order ?? 0) - (b.spec.order ?? 0) || a.index - b.index;
}

function mergeProps(
	locked: readonly string[],
	owner: Readonly<Record<string, unknown>>,
	entry: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	const props: Record<string, unknown> = { ...owner, ...entry };
	for (const key of locked) {
		if (Object.prototype.hasOwnProperty.call(owner, key)) {
			props[key] = owner[key];
		} else {
			delete props[key];
		}
	}
	return props;
}

function unique(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		if (seen.has(value)) {
			continue;
		}
		seen.add(value);
		result.push(value);
	}
	return result;
}
