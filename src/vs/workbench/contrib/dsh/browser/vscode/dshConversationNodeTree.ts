/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 按稳定 key 保存会话节点，而不是每次快照整树换新对象。
// 身份用 kind + messageId，工具节点用 kind + callId，都没有时退回 seq/turn/step。
// 每个 key 的 source 对象保持不变：内容变了通知，节点消失后 get() 变成 undefined。
// turnDataSource 只在该 turn 的该 kind 变化时通知，其它 turn 不跟着响。

/** 建 key 和按 turn 索引时要读的字段。其余载荷原样放在节点上。 */
export interface DshIndexedNode {
	readonly kind: string;
	readonly seq: number;
	readonly messageId?: string;
	readonly turn?: number;
	readonly step?: number;
	readonly callId?: string;
	/** 工具结果里的嵌套调用。只在索引时展开，不改变顶层顺序。 */
	readonly subCalls?: readonly DshIndexedNode[];
}

/** 一个 key 的稳定观察点。节点被删掉之后 get() 返回 undefined，对象本身还在。 */
export interface DshNodeSource<T extends DshIndexedNode> {
	get(): T | undefined;
	subscribe(listener: () => void): { dispose(): void };
	readonly version: number;
}

/** 一组节点的稳定观察点。数组是当前快照，调用方不要改它。 */
export interface DshNodeListSource<T extends DshIndexedNode> {
	get(): readonly T[];
	subscribe(listener: () => void): { dispose(): void };
	readonly version: number;
}

export interface DshNodeChange<T extends DshIndexedNode> {
	readonly changed: readonly string[];
	readonly removed: readonly string[];
	readonly orderChanged: boolean;
	readonly nodes: readonly T[];
}

/** 一个已载入 turn 的导航锚点。prompt / response 缺了就不写。 */
export interface DshTurnNavigationItem {
	readonly turn: number;
	readonly anchorKey: string;
	readonly promptKey?: string;
	readonly responseKey?: string;
}

interface SourceState<T extends DshIndexedNode> {
	node: T | undefined;
	version: number;
	readonly listeners: Set<() => void>;
}

interface ListState<T extends DshIndexedNode> {
	nodes: readonly T[];
	version: number;
	readonly listeners: Set<() => void>;
}

const PROMPT_KINDS = new Set(['user', 'steering', 'turn-trigger', 'command-input']);
const RESPONSE_KINDS = new Set(['assistant', 'assistant-step']);

/**
 * 一个会话的节点索引。
 *
 * accept() 用 key 对齐新旧快照：没变的 key 不通知，变了的 key 只通知自己的 source。
 */
export class DshConversationNodeTree<T extends DshIndexedNode = DshIndexedNode> {
	private readonly nodes = new Map<string, T>();
	private readonly sources = new Map<string, SourceState<T>>();
	private readonly slices = new Map<string, ListState<T>>();
	private readonly processes = new Map<string, ListState<T>>();
	private order: string[] = [];
	private parents = new Map<string, string>();
	private childKeys = new Map<string, readonly string[]>();
	private treeVersion = 0;
	private readonly listeners = new Set<() => void>();

	readonly sessionId: string;

	constructor(sessionId: string) {
		this.sessionId = sessionId;
	}

	get version(): number {
		return this.treeVersion;
	}

	onDidChange(listener: () => void): { dispose(): void } {
		this.listeners.add(listener);
		return { dispose: () => { this.listeners.delete(listener); } };
	}

	/** 用一份已经投影好的节点替换当前索引。返回这次真正变化的 key。 */
	accept(nodes: readonly T[]): DshNodeChange<T> {
		const collected = collectNodes(nodes);
		const next = collected.nodes;
		const nextOrder = collected.order;
		const changed: string[] = [];
		const removed: string[] = [];
		const dirtyTurns = new Set<number>();
		for (const key of collected.keys) {
			const node = next.get(key);
			if (node === undefined) {
				continue;
			}
			const previous = this.nodes.get(key);
			if (previous !== undefined && sameNode(previous, node)) {
				continue;
			}
			if (previous?.turn !== undefined) {
				dirtyTurns.add(previous.turn);
			}
			if (node.turn !== undefined) {
				dirtyTurns.add(node.turn);
			}
			this.nodes.set(key, node);
			this.touch(key, node);
			changed.push(key);
		}
		for (const key of [...this.nodes.keys()]) {
			if (next.has(key)) {
				continue;
			}
			const previous = this.nodes.get(key);
			if (previous?.turn !== undefined) {
				dirtyTurns.add(previous.turn);
			}
			this.nodes.delete(key);
			this.touch(key, undefined);
			removed.push(key);
		}
		const orderChanged = !sameOrder(this.order, nextOrder);
		this.order = nextOrder;
		this.parents = collected.parents;
		this.childKeys = collected.children;
		this.publishSlices();
		this.publishProcesses(dirtyTurns, removed);
		if (changed.length > 0 || removed.length > 0 || orderChanged) {
			this.treeVersion++;
			for (const listener of [...this.listeners]) {
				listener();
			}
		}
		return { changed, removed, orderChanged, nodes: this.list() };
	}

	get(key: string): T | undefined {
		return this.nodes.get(key);
	}

	/** 嵌套工具调用的父 key。顶层节点没有父 key。 */
	parentKey(key: string): string | undefined {
		return this.parents.get(key);
	}

	/** 直接子调用的 key，顺序与 subCalls 一致。 */
	childKeysOf(key: string): readonly string[] {
		return this.childKeys.get(key) ?? [];
	}

	keys(): readonly string[] {
		return this.order;
	}

	list(): readonly T[] {
		const nodes: T[] = [];
		for (const key of this.order) {
			const node = this.nodes.get(key);
			if (node !== undefined) {
				nodes.push(node);
			}
		}
		return nodes;
	}

	/** 顶层顺序展开 subCalls 之后的全部节点。 */
	private visibleNodes(): readonly T[] {
		const nodes: T[] = [];
		const visit = (key: string): void => {
			const node = this.nodes.get(key);
			if (node === undefined) {
				return;
			}
			nodes.push(node);
			for (const child of this.childKeys.get(key) ?? []) {
				visit(child);
			}
		};
		for (const key of this.order) {
			visit(key);
		}
		return nodes;
	}

	/** 该 key 的观察点。第一次取和以后取是同一个对象。 */
	source(key: string): DshNodeSource<T> {
		const state = this.sourceState(key);
		return {
			get: () => state.node,
			subscribe: listener => subscribe(state.listeners, listener),
			get version() { return state.version; },
		};
	}

	/**
	 * 一个节点的局部 revision（契约 §19 局部 revision）。
	 *
	 * 用 `source(key).version`，也就是「这个 key 自己被通知过几次」，而不是整棵树的
	 * `treeVersion`——后者任何节点变化都会 +1，拿它做 response 身份等于让所有历史行跟着变旧。
	 * 节点不在树里时返回 0；节点从无到有同样是 0→1 的变化，因此「新增」也会被判定为不同。
	 */
	revisionOf(nodeId: string): number {
		return this.sourceState(nodeId).version;
	}

	/**
	 * 一组节点合起来的局部 revision（契约 §19 局部 revision）。
	 *
	 * 只是按成员顺序拼一个稳定字符串：`dshSlotHostRef` 把它原样带进身份比较。
	 * 不用求和/异或——那会让 `[a,b]` 与 `[b,a]` 或两个各自变化的成员产生碰撞。
	 * 成员列表本身由 `nodeIds` 单独比较，这里只负责「成员内容变没变」。
	 */
	revisionFor(nodeIds: readonly string[]): string {
		return nodeIds.map(nodeId => `${nodeId}:${this.revisionOf(nodeId)}`).join('|');
	}

	/** 一个 turn 里某一种 kind 的有序节点。别的 turn 或别的 kind 变化不通知这里。 */
	turnDataSource(turn: number, kind: string): DshNodeListSource<T> {
		const state = this.sliceState(sliceId(turn, kind));
		return {
			get: () => state.nodes,
			subscribe: listener => subscribe(state.listeners, listener),
			get version() { return state.version; },
		};
	}

	/** 这个节点所属 turn 的全部节点。节点还没有 turn 时，只包含它自己。 */
	processSource(key: string): DshNodeListSource<T> {
		const state = this.processState(key);
		return {
			get: () => state.nodes,
			subscribe: listener => subscribe(state.listeners, listener),
			get version() { return state.version; },
		};
	}

	getTurn(turn: number): readonly T[] {
		return this.visibleNodes().filter(node => node.turn === turn);
	}

	/** 已载入 turn 的导航项，按 turn 升序。 */
	navigationItems(): readonly DshTurnNavigationItem[] {
		const groups = new Map<number, T[]>();
		for (const node of this.list()) {
			if (node.turn === undefined) {
				continue;
			}
			const group = groups.get(node.turn) ?? [];
			group.push(node);
			groups.set(node.turn, group);
		}
		return [...groups.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([turn, group]) => {
				const prompt = group.find(node => PROMPT_KINDS.has(node.kind));
				const response = group.find(node => RESPONSE_KINDS.has(node.kind));
				return {
					turn,
					anchorKey: dshNodeKey(group[0]),
					...(prompt === undefined ? {} : { promptKey: dshNodeKey(prompt) }),
					...(response === undefined ? {} : { responseKey: dshNodeKey(response) }),
				};
			});
	}

	/**
	 * 当前树的只读快照。没有 timeline / legacy。
	 * 返回的 Map 是副本，改它不会改树。
	 */
	snapshot(): {
		readonly order: readonly string[];
		readonly nodes: ReadonlyMap<string, T>;
		readonly locations: readonly { readonly turn: number; readonly step?: number; readonly key: string }[];
		readonly navigation: readonly DshTurnNavigationItem[];
	} {
		const locations = this.visibleNodes().flatMap(node => node.turn === undefined ? [] : [{
			turn: node.turn,
			...(node.step === undefined ? {} : { step: node.step }),
			key: dshNodeKey(node),
		}]);
		return {
			order: [...this.order],
			nodes: new Map(this.nodes),
			locations,
			navigation: this.navigationItems(),
		};
	}

	private sourceState(key: string): SourceState<T> {
		let state = this.sources.get(key);
		if (state === undefined) {
			state = { node: this.nodes.get(key), version: 0, listeners: new Set() };
			this.sources.set(key, state);
		}
		return state;
	}

	private sliceState(id: string): ListState<T> {
		let state = this.slices.get(id);
		if (state === undefined) {
			state = { nodes: [], version: 0, listeners: new Set() };
			this.slices.set(id, state);
		}
		return state;
	}

	private processState(key: string): ListState<T> {
		let state = this.processes.get(key);
		if (state === undefined) {
			state = { nodes: this.processNodes(key), version: 0, listeners: new Set() };
			this.processes.set(key, state);
		}
		return state;
	}

	private touch(key: string, node: T | undefined): void {
		const state = this.sources.get(key);
		if (state === undefined) {
			this.sources.set(key, { node, version: 1, listeners: new Set() });
			return;
		}
		state.node = node;
		state.version++;
		for (const listener of [...state.listeners]) {
			listener();
		}
	}

	private publishSlices(): void {
		const grouped = new Map<string, T[]>();
		for (const node of this.visibleNodes()) {
			if (node.turn === undefined) {
				continue;
			}
			const id = sliceId(node.turn, node.kind);
			const group = grouped.get(id) ?? [];
			group.push(node);
			grouped.set(id, group);
		}
		const seen = new Set<string>();
		for (const [id, group] of grouped) {
			seen.add(id);
			this.replaceSlice(id, group);
		}
		for (const id of [...this.slices.keys()]) {
			if (!seen.has(id)) {
				this.replaceSlice(id, []);
			}
		}
	}

	private replaceSlice(id: string, nodes: readonly T[]): void {
		const state = this.slices.get(id);
		if (state === undefined) {
			this.slices.set(id, { nodes, version: 1, listeners: new Set() });
			return;
		}
		if (sameList(state.nodes, nodes)) {
			return;
		}
		state.nodes = nodes;
		state.version++;
		for (const listener of [...state.listeners]) {
			listener();
		}
	}

	private publishProcesses(dirtyTurns: ReadonlySet<number>, removed: readonly string[]): void {
		for (const key of removed) {
			this.replaceProcess(key);
		}
		for (const key of this.processes.keys()) {
			const node = this.nodes.get(key);
			if (node === undefined) {
				continue;
			}
			if (node.turn === undefined || dirtyTurns.has(node.turn)) {
				this.replaceProcess(key);
			}
		}
	}

	private replaceProcess(key: string): void {
		const nodes = this.processNodes(key);
		const state = this.processes.get(key);
		if (state === undefined) {
			return;
		}
		if (sameList(state.nodes, nodes)) {
			return;
		}
		state.nodes = nodes;
		state.version++;
		for (const listener of [...state.listeners]) {
			listener();
		}
	}

	private processNodes(key: string): readonly T[] {
		const node = this.nodes.get(key);
		if (node === undefined) {
			return [];
		}
		if (node.turn === undefined) {
			return [node];
		}
		return this.getTurn(node.turn);
	}

}

/** 节点身份。工具走 callId，有 messageId 走 messageId，否则用 seq 和位置。 */
export function dshNodeKey(node: DshIndexedNode): string {
	if ((node.kind === 'tool-call' || node.kind === 'tool-result') && node.callId !== undefined && node.callId !== '') {
		return `${node.kind}:${node.callId}`;
	}
	if (node.messageId !== undefined && node.messageId !== '') {
		return `${node.kind}:${node.messageId}`;
	}
	const turn = node.turn === undefined ? '' : String(node.turn);
	const step = node.step === undefined ? '' : String(node.step);
	return `${node.kind}:${node.seq}:${turn}:${step}`;
}

function sliceId(turn: number, kind: string): string {
	return `${turn}\u0000${kind}`;
}

function subscribe(listeners: Set<() => void>, listener: () => void): { dispose(): void } {
	listeners.add(listener);
	return { dispose: () => { listeners.delete(listener); } };
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
}

function sameList<T extends DshIndexedNode>(left: readonly T[] | undefined, right: readonly T[]): boolean {
	if (left === undefined || left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index++) {
		if (!sameNode(left[index], right[index])) {
			return false;
		}
	}
	return true;
}

/**
 * 节点内容是否值得通知订阅者。
 *
 * 为什么不再用 `JSON.stringify(left) === JSON.stringify(right)`：
 *   1. `raw` 是整帧源载荷，同一段内容在流式帧里会被重新序列化（字段顺序、内部
 *      时间戳都会变），把它算进相等性会让「界面上一模一样的节点」每帧都判为变化，
 *      正是契约 §19 要消除的整段重绘。
 *   2. `JSON.stringify` 对字段顺序敏感：Host 换个序列化顺序就触发一次假更新。
 *   3. 它要遍历整棵原始载荷，长会话里比逐字段比较贵得多。
 *
 * 因此只比**会改变这一行显示**的字段（契约 §19 S1 的 display signature）。
 * `raw` / `requestConfig` / `timing` 不参与：它们不出现在任何渲染路径上
 * （`dshNativePartAdapters.ts` 只读 `providerMetadata`、`interrupted`、`usage`、
 * `tokenUsage` 与正文块）。以后若某个新渲染字段进上下文，必须在这里补一行，
 * 否则该字段的更新不会触发重绘。
 */
function sameNode(left: DshIndexedNode, right: DshIndexedNode): boolean {
	if (left === right) {
		return true;
	}
	return dshNodeDisplaySignature(left) === dshNodeDisplaySignature(right);
}

/**
 * 一个节点参与显示比较的签名。
 *
 * 导出给 slot host 判断「这一行要不要重建」：同一个签名表示这一行的可见内容没变，
 * 不必替换 DOM（契约 §19 S2）。
 */
export function dshNodeDisplaySignature(node: DshIndexedNode): string {
	return displaySignature(node);
}

function displaySignature(node: DshIndexedNode): string {
	const record = node as DshIndexedNode & Record<string, unknown>;
	const fields: string[] = [];
	for (const key of Object.keys(record)) {
		if (DISPLAY_IGNORED_FIELDS.has(key)) {
			continue;
		}
		const value = record[key];
		if (value === undefined) {
			continue;
		}
		fields.push(`${key}=${stableValue(value)}`);
	}
	fields.sort();
	return fields.join('\u0000');
}

/**
 * 稳定序列化：对象按键名排序，数组保持顺序。
 *
 * 只用于 display signature，不用于持久化；循环引用返回 `[cycle]` 而不是抛错。
 */
function stableValue(value: unknown, seen = new Set<unknown>()): string {
	if (value === null) {
		return 'null';
	}
	if (typeof value !== 'object') {
		return typeof value === 'string' ? JSON.stringify(value) : String(value);
	}
	if (seen.has(value)) {
		return '[cycle]';
	}
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			return `[${value.map(item => stableValue(item, seen)).join(',')}]`;
		}
		const entries = Object.keys(value as Record<string, unknown>).sort()
			.map(key => `${key}:${stableValue((value as Record<string, unknown>)[key], seen)}`);
		return `{${entries.join(',')}}`;
	} finally {
		seen.delete(value);
	}
}

/** 不参与显示比较的字段：源载荷、请求配置、计时等只用于内部核对。 */
const DISPLAY_IGNORED_FIELDS: ReadonlySet<string> = new Set(['raw', 'requestConfig', 'timing']);

interface CollectedNodes<T extends DshIndexedNode> {
	readonly nodes: Map<string, T>;
	readonly order: string[];
	readonly keys: readonly string[];
	readonly parents: Map<string, string>;
	readonly children: Map<string, readonly string[]>;
}

/** 顶层按 seq 排序；subCalls 保持原顺序，并记到父 key 下面。重复 key 只留先出现的。 */
function collectNodes<T extends DshIndexedNode>(nodes: readonly T[]): CollectedNodes<T> {
	const map = new Map<string, T>();
	const order: string[] = [];
	const keys: string[] = [];
	const parents = new Map<string, string>();
	const children = new Map<string, string[]>();
	const seen = new Set<string>();
	const walk = (items: readonly T[], parent: string | undefined, top: boolean): void => {
		const sequence = top ? [...items].sort((left, right) => left.seq - right.seq) : items;
		for (const node of sequence) {
			const key = dshNodeKey(node);
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			map.set(key, node);
			keys.push(key);
			if (top) {
				order.push(key);
			}
			if (parent !== undefined) {
				parents.set(key, parent);
				const list = children.get(parent);
				if (list === undefined) {
					children.set(parent, [key]);
				} else {
					list.push(key);
				}
			}
			if (node.subCalls !== undefined && node.subCalls.length > 0) {
				walk(node.subCalls as readonly T[], key, false);
			}
		}
	};
	walk(nodes, undefined, true);
	for (const key of [...order]) {
		if (parents.has(key)) {
			continue;
		}
		const current = map.get(key) as (T & { readonly parentCallId?: unknown }) | undefined;
		const callId = current === undefined || typeof current.parentCallId !== 'string' ? '' : current.parentCallId;
		if (callId === '') {
			continue;
		}
		const callKey = `tool-call:${callId}`;
		const resultKey = `tool-result:${callId}`;
		const parent = callKey !== key && map.has(callKey) ? callKey : (resultKey !== key && map.has(resultKey) ? resultKey : undefined);
		if (parent === undefined || parentChainHas(parents, parent, key)) {
			continue;
		}
		parents.set(key, parent);
		const list = children.get(parent);
		if (list === undefined) {
			children.set(parent, [key]);
		} else {
			list.push(key);
		}
		const index = order.indexOf(key);
		if (index >= 0) {
			order.splice(index, 1);
		}
	}
	return { nodes: map, order, keys, parents, children };
}

function parentChainHas(parents: ReadonlyMap<string, string>, start: string, key: string): boolean {
	let cursor: string | undefined = start;
	const seen = new Set<string>();
	while (cursor !== undefined) {
		if (cursor === key || seen.has(cursor)) {
			return true;
		}
		seen.add(cursor);
		cursor = parents.get(cursor);
	}
	return false;
}
