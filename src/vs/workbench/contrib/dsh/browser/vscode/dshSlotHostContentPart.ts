/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ChatList 看到的 DSH 入口。内部按 nodeId 画行，折叠状态走会话 store，不写在 DOM 数据集上。

import { $ } from '../../../../../base/browser/dom.js';
import { Emitter, type Event } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import type { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import type { IChatContentPart } from '../../../chat/browser/widget/chatContentParts/chatContentParts.js';
import type { IChatRendererContent } from '../../../chat/common/model/chatViewModel.js';
import type { ChatTreeItem } from '../../../chat/browser/chat.js';
import type { IDshSlotHostContent } from '../../../chat/common/chatService/chatService.js';
import { formatTokens } from './dshTokenFormat.js';
import { dshAsideText, dshAssistantActions, dshTextInteractions, dshUserBeforeDecoration, type DshAssistantAction, type DshTextInteraction } from './dshChatSlots.js';
import { dshContentStore } from './dshContentStore.js';
import { adaptDshNode, type DshNativePart } from './dshNativePartAdapters.js';
import { groupTurnProcesses, hiddenProcessLine, latestExchangeTurns, processLineFromSnapshot, visibleProcessKeys, type DshTurnProcess } from './dshProcessGroup.js';
import { diffDshSlotRows, dshSlotHostSame, planKeysForTurn, presentDshNode, turnProcessCounts, type DshSlotHostRef } from './dshSlotHostModel.js';
import { dshNodeDisplaySignature } from './dshConversationNodeTree.js';
import { dshCardSpec, type DshCardSpec } from './dshCardSpec.js';
import { applyDshButtonChrome, applyDshStaticRowChrome } from './dshButtonChrome.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { createStyleSheet } from '../../../../../base/browser/domStylesheets.js';

export interface DshNativePartRenderer {
	render(part: DshNativePart): IChatContentPart | undefined;
	renderQuestion?(eventId: string): (IChatContentPart & { readonly onDidChangeHeight?: Event<void> }) | undefined;
	/**
	 * 官方 `userQuestionPanels.review(sessionId, callId, record)`：用已结算的
	 * questions + answers 开一张只读回看卡片。
	 */
	reviewQuestion?(callId: string, questions: readonly { readonly id: string; readonly question?: string; readonly header?: string }[], answers: readonly { readonly id: string; readonly selected: readonly string[]; readonly custom?: string }[]): void;
	/** 执行插件注册在 `conversation.chat.assistant-actions` 上的命令。 */
	executeCommand?(command: string, args: readonly unknown[]): void;
	/**
	 * 读附件字节。
	 *
	 * `dsh-attachment:` 是自定义 scheme，浏览器不会自己去取；必须经文件服务读字节后
	 * 转成 blob URL 才能画进 `<img>`。返回 undefined 表示取不到（回退成名字）。
	 */
	loadImage?(uri: URI): Promise<Uint8Array | undefined>;
}

/** 一帧里的一行：`node` 是节点行，其余是过程计数行 / 问卷 / 侧栏这类附加行。 */
type DshSlotRowSpec =
	| { readonly key: string; readonly kind: 'node'; readonly nodeKey: string; readonly signature?: string }
	| {
		readonly key: string;
		readonly kind: 'summary';
		readonly line: string;
		/**
		 * 组头交互（官方「Group-title rules」）：**category icon**，hover/键盘聚焦时换成 **down arrow**，
		 * 展开时显示 **up arrow**。`expanded`/`onToggle` 缺省表示该行不可交互（只读计数）。
		 */
		readonly turn?: number;
		readonly expanded?: boolean;
		readonly onToggle?: () => void;
		/** `aria-controls` 的目标 id：由同一 Turn 的锚点 node 行承载（渲染时设上）。 */
		readonly controlledId?: string;
		readonly signature?: string;
	}
	| { readonly key: string; readonly kind: 'question'; readonly eventId: string; readonly signature?: string }
	| { readonly key: string; readonly kind: 'aside'; readonly text: string; readonly signature?: string };

export class DshSlotHostContentPart extends Disposable implements IChatContentPart {
	readonly domNode: HTMLElement;
	private readonly body: HTMLElement;
	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;
	/**
	 * 已经画出来的行，按稳定 key 索引（契约 §19 S2）。
	 *
	 * 增量渲染的做法：每帧先算出「这一帧应该有哪些行、每行的显示签名是什么」，
	 * 再与这张表逐 key 对齐——签名没变就原样保留 DOM（连高度都不重测），
	 * 只有变了的行才重建。这样单个节点变化不会重建整段 slot host。
	 */
	private readonly rows = new Map<string, { signature: string; dom: HTMLElement; refs: DisposableStore }>();
	/**
	 * 本 part 的 DOM id 前缀（`generateUuid()`，与原生 `chatSubagentContentPart` 同一做法）。
	 *
	 * `aria-controls` 必须指向一个**真实存在且唯一**的元素 id：用固定字符串会在同屏多行
	 * 之间撞车，用行下标会在虚拟化重绘后错位。part 实例级前缀 + 节点稳定 key 派生，
	 * 既唯一又在重绘之间稳定。
	 */
	private readonly domIdPrefix = `dsh-slot-${generateUuid()}`;
	/** 文本手势条的同步回调，按行 key 登记；行销毁时一并移除。 */
	private readonly selectionSyncs = new Map<string, () => void>();
	/**
	 * 供单测观察增量渲染的计数器（只读）。
	 *
	 * 为什么要有：契约 §19 S2 的验收是「1 个节点变化只替换 1 行」「无可见变化不 fire height」，
	 * 这两条只能从渲染行为上观察，不能靠断言源码文本。生产环境里这些计数只增不减，
	 * 不参与逻辑判断。
	 */
	readonly renderStats = { renders: 0, rebuiltRows: 0, heightEvents: 0 };

	constructor(private content: IDshSlotHostContent, private readonly native?: DshNativePartRenderer) {
		super();
		this.domNode = $('.dsh-slot-host');
		this.domNode.style.display = 'flex';
		this.domNode.style.flexDirection = 'column';
		this.domNode.style.gap = '2px';
		this.domNode.setAttribute('role', 'group');
		this.domNode.setAttribute('aria-label', 'DSH');
		this.body = $('.dsh-slot-host-body');
		this.domNode.appendChild(this.body);
		// 选区变化只影响手势条显隐，统一在 part 级处理，不为每行各挂一个监听。
		const doc = this.domNode.ownerDocument;
		const onSelectionChange = () => {
			for (const sync of this.selectionSyncs.values()) {
				sync();
			}
		};
		doc.addEventListener('selectionchange', onSelectionChange);
		this._register({ dispose: () => doc.removeEventListener('selectionchange', onSelectionChange) });
		this.render();
		const binding = dshContentStore.get(content.treeId);
		if (binding !== undefined) {
			// 按 key 订阅：只有本段引用的那些节点变了才重画。
			// 订阅整棵树的 `onDidChange` 会让任意一条流式增量都重画所有 response。
			for (const nodeId of content.nodeIds) {
				this._register(binding.tree.source(nodeId).subscribe(() => this.render()));
			}
			// 段内新增/删除节点会改变 `nodeIds` 本身，那由外层 `hasSameContent` 触发重建；
			// 这里只兜「引用没变但成员内容变了」。折叠状态仍走会话 store。
			this._register(binding.expansion.onDidChange(() => this.render()));

			// 契约 §19 S6 的消费面（一）：本段涉及的 Turn 各自订阅 `processSource`。
			//
			// 为什么需要它：过程分组（`groupTurnProcesses`）会读同一 Turn 内**不在
			// `nodeIds` 里**的节点（例如已收起的过程行、`turn-process` 计数行）。
			// 只订阅 `source(nodeId)` 的话，这些节点变化不会触发重画，计数行会停在旧值。
			// 而订阅整棵树的 `onDidChange` 又会让别的 Turn 的变化也重画本段。
			// `processSource(key)` 恰好是「该节点所属 Turn 的全部节点」的按 Turn 观察点：
			// 别的 Turn 变化不通知这里。
			for (const turn of this.processTurns(binding)) {
				const anchor = this.processAnchorOf(binding, turn);
				if (anchor === undefined) {
					continue;
				}
				this._register(binding.tree.processSource(anchor).subscribe(() => this.render()));
			}
		}
	}

	/** 本段 nodeIds 覆盖到的 Turn 集合（按首次出现顺序；无 turn 的节点不参与）。 */
	private processTurns(binding: NonNullable<ReturnType<typeof dshContentStore.get>>): readonly number[] {
		const turns: number[] = [];
		const seen = new Set<number>();
		for (const nodeId of this.content.nodeIds) {
			const turn = binding.tree.get(nodeId)?.turn;
			if (turn === undefined || seen.has(turn)) {
				continue;
			}
			seen.add(turn);
			turns.push(turn);
		}
		return turns;
	}

	/** 一个 Turn 里用来取 `processSource` 的任一节点 key；该 Turn 没有任何本段节点时返回 undefined。 */
	private processAnchorOf(binding: NonNullable<ReturnType<typeof dshContentStore.get>>, turn: number): string | undefined {
		return this.content.nodeIds.find(nodeId => binding.tree.get(nodeId)?.turn === turn);
	}

	hasSameContent(other: IChatRendererContent, _followingContent: IChatRendererContent[], _element: ChatTreeItem): boolean {
		return other.kind === 'dshSlotHost' && dshSlotHostSame(this.content, other as DshSlotHostRef);
	}

	/**
	 * 增量渲染入口（契约 §19 S2）。
	 *
	 * 每次只重算「哪一行该在哪个位置、显示签名是什么」，然后与已画的 DOM 对齐：
	 *   - 签名没变 → 保留原来的行（连高度都不重测）；
	 *   - 签名变了 → 只重建那一行；
	 *   - 新增/删除 → 只 append / dispose 对应的行；
	 *   - 顺序变化 → DOM move（`insertBefore`），不重建。
	 *
	 * 只有行集合或行内容真的变了才 `fire onDidChangeHeight`；没有可见变化时一次都不发，
	 * 避免把上游高频增量放大成原生 ChatList 的自动滚动。
	 */
	private render(): void {
		this.renderStats.renders++;
		const binding = dshContentStore.get(this.content.treeId);
		if (binding === undefined) {
			return;
		}
		const rowsToRender = this.collectRows(binding).map(row => ({ ...row, signature: this.rowSignature(row, binding) }));
		const previous = [...this.rows].map(([key, row]) => ({ key, signature: row.signature }));
		const plan = diffDshSlotRows(previous, rowsToRender);
		if (!plan.changed) {
			// 没有可见变化：一次高度事件都不发，避免把上游高频增量放大成自动滚动。
			return;
		}

		// 先收掉不再存在的行（含它们持有的原生部件与事件）。
		for (const key of plan.removed) {
			const row = this.rows.get(key);
			if (row === undefined) {
				continue;
			}
			row.refs.dispose();
			row.dom.remove();
			this.rows.delete(key);
			this.selectionSyncs.delete(key);
		}

		// 再按目标顺序逐行对齐。
		let cursor: HTMLElement | undefined = this.body.firstElementChild as HTMLElement | undefined;
		for (const row of rowsToRender) {
			let entry = this.rows.get(row.key);
			if (entry === undefined || entry.signature !== row.signature) {
				const refs = new DisposableStore();
				const dom = this.renderRow(row, binding, refs);
				if (entry === undefined) {
					this.selectionSyncs.delete(row.key);
				} else {
					entry.refs.dispose();
					entry.dom.replaceWith(dom);
					this.selectionSyncs.delete(row.key);
				}
				entry = { signature: row.signature, dom, refs };
				this.rows.set(row.key, entry);
				this.renderStats.rebuiltRows++;
			}
			if (cursor === entry.dom) {
				cursor = cursor.nextElementSibling as HTMLElement | undefined;
			} else {
				this.body.insertBefore(entry.dom, cursor ?? null);
			}
		}
		this.renderStats.heightEvents++;
		this._onDidChangeHeight.fire();
	}

	/** 这一帧应该画哪些行（顺序即 DOM 顺序）以及每行的显示签名。 */
	private collectRows(binding: NonNullable<ReturnType<typeof dshContentStore.get>>): readonly DshSlotRowSpec[] {
		const grouped = this.content.nodeIds.flatMap(nodeId => {
			const node = binding.tree.get(nodeId);
			if (node === undefined) {
				return [];
			}
			return [{
				key: nodeId,
				kind: node.kind,
				seq: node.seq,
				...(node.turn === undefined ? {} : { turn: node.turn }),
				...(node.step === undefined ? {} : { step: node.step }),
				...(binding.tree.parentKey(nodeId) === undefined ? {} : { parentKey: binding.tree.parentKey(nodeId) }),
			}];
		});
		const visible = new Set<string>();
		const summaryBefore = new Map<string, readonly { readonly line: string; readonly turn: number; readonly expanded: boolean; readonly onToggle: () => void }[]>();
		// 计划卡正常随 turn tail 画；但 Turn 还没结束（没有 `turn-tail`）时它也会被跳过，
		// 于是整张卡消失。这里记下「哪些 Turn 已有 tail」，剩下的计划卡就地画在原位。
		const turnsWithTail = new Set<number>();
		for (const node of grouped) {
			if (node.kind === 'turn-tail' && node.turn !== undefined) {
				turnsWithTail.add(node.turn);
			}
		}
		// 折叠判定要用官方的结算原因（`turn/end.reason.kind`）。旧写法不传 `reasonByTurn`，
		// `groupTurnProcesses` 永远走 fallback（`sawSignal || !sawAnswer`）——已正常结束、
		// 但过程中有信号节点的 Turn 会被误判成不可收起；反过来「已出答复但仍在跑」的 Turn
		// 又可能被当成可收起。这里从每个 Turn 的 `turn-process` 节点取权威原因。
		const reasonByTurn = new Map<number, string>();
		for (const nodeId of this.content.nodeIds) {
			const node = binding.tree.get(nodeId) as { readonly turn?: number; readonly kind?: string; readonly endReason?: string } | undefined;
			if (node?.kind !== 'turn-process' || node.turn === undefined || node.endReason === undefined) {
				continue;
			}
			reasonByTurn.set(node.turn, node.endReason);
		}
		const groups = groupTurnProcesses(grouped, reasonByTurn);
		// `next-input` 时机：把「最新 exchange」的 Turn 标成豁免，让它们保持运行中的呈现。
		// 官方定义见 `latestExchangeTurns`；`completion` 时机下传空集合即无豁免。
		binding.expansion.setExemptTurns(binding.expansion.collapseTiming() === 'next-input' ? latestExchangeTurns(groups) : []);
		for (const group of groups) {
			// `eligible` = 官方可折叠条件：`alwaysOpen` 为真（未结束 / 失败 / 有可见输入）
			// 时该 Turn 不允许整段收起，模式默认不能覆盖这条。
			const collapsed = binding.expansion.isTurnCollapsed(group.turn, group.answerStep, !group.alwaysOpen);
			for (const key of visibleProcessKeys(group, collapsed, binding.expansion.foldedReplies())) {
				visible.add(key);
			}
			if (group.alwaysOpen || !collapsed || group.processKeys.length === 0) {
				continue;
			}
			const byKey = new Map(grouped.map(node => [node.key, node]));
			// 优先用线协议里的 turn-process 计数（官方过程组行的数据）；缺失时才现算。
			//
			// 契约 §19 S6 的消费面（二）：改用 `turnDataSource(turn, 'turn-process')` 而不是
			// 在 `grouped` 里找。`grouped` 只有本段 `nodeIds` 的成员，而计数行属于整个 Turn——
			// 当 turn-process 节点不在本段引用里时，旧写法会静默退化成现算，
			// 页面上的「N 个工具」与 Host 给的权威计数不一致。
			// `turnDataSource` 是「该 Turn 该 kind 的全部节点」的按 Turn 观察点，正好是这份数据的真源。
			const snapshot = turnProcessCounts(binding.tree.turnDataSource(group.turn, 'turn-process').get());
			const line = (snapshot === undefined ? undefined : processLineFromSnapshot({
				toolCallCount: snapshot.toolCallCount ?? 0,
				subagentCount: snapshot.subagentCount ?? 0,
				messageCount: snapshot.messageCount ?? 0,
			})) ?? hiddenProcessLine(group.processKeys.flatMap(key => {
				const node = byKey.get(key);
				if (node === undefined) {
					return [];
				}
				const named = binding.tree.get(key) as { readonly name?: string; readonly callId?: string; readonly argsRaw?: string } | undefined;
				// 官方「Live activity and detail」要的是**参数对象**；节点上存的是原始 JSON 串
				// （流式中可能还不完整）。解析失败就不传，让 `dshLiveDetailOf` 退回工具名。
				const parsed = parsedArgsOf(named?.argsRaw);
				return [{
					kind: node.kind,
					...(typeof named?.name === 'string' ? { name: named.name } : {}),
					...(named?.callId === undefined ? {} : { callId: named.callId }),
					...(parsed === undefined ? {} : { args: parsed }),
				}];
			}));
			if (line === undefined) {
				continue;
			}
			// 官方「Process grouping」：一个 Turn 内按边界切成多个组，**每组有自己的组头**。
			// 所以不能只在整个 Turn 的收尾处挂一行——要按段找各自的锚点。
			// 锚点规则：段内最后一个节点之后、下一个边界之前会画出来的那一行；
			// 整 Turn 折叠时若段后没有可见行，就挂在 Turn 的收尾答复前。
			//
			// 注意 `turn-process` 也被算进 answerKeys（位置是 turn），但它在渲染时会被跳过，
			// 挂到它上面的计数行永远不显示——所以锚点必须过滤掉它。
			// 组头是可交互披露（官方：icon → hover 变 down arrow、展开时 up arrow）。
			// 展开状态用节点级 disclosure，键是「这个组头的稳定 key」，与单个 reasoning/tool 的 disclosure 同一层。
			const headerId = `process:${group.turn}:${group.answerStep}`;
			const expanded = binding.expansion.isDisclosed(group.turn, headerId);
			const onToggle = () => binding.expansion.setDisclosed(group.turn, headerId, !binding.expansion.isDisclosed(group.turn, headerId));
			// **展开真的生效**：组头展开时把该 Turn 的过程节点放回可见集合。
			// 没有这一步，点组头只会翻箭头——那是假装可交互（CHK-368 遗留）。
			// 放在行内是因为 `visible` 是本次 collect 的局部集合，而组头的展开状态属于「这一帧」。
			if (expanded) {
				for (const key of group.processKeys) {
					visible.add(key);
				}
			}
			const spec = { line, turn: group.turn, expanded, onToggle } as const;
			const anchors = this.segmentAnchors(group, binding);
			if (anchors.length === 0) {
				const fallback = group.answerKeys.find(key => {
					const node = binding.tree.get(key) as { readonly kind?: string } | undefined;
					return node !== undefined && node.kind !== 'turn-process';
				});
				if (fallback !== undefined) {
					summaryBefore.set(fallback, [...(summaryBefore.get(fallback) ?? []), spec]);
				}
				continue;
			}
			for (const anchor of anchors) {
				summaryBefore.set(anchor, [...(summaryBefore.get(anchor) ?? []), spec]);
			}
		}
		const rows: DshSlotRowSpec[] = [];
		for (const nodeId of this.content.nodeIds) {
			const node = binding.tree.get(nodeId);
			if (node === undefined || binding.tree.parentKey(nodeId) !== undefined) {
				continue;
			}
			if (node.turn !== undefined && !visible.has(nodeId)) {
				continue;
			}
			// `turn-process` 是过程组的元数据，由上面那行计数代表，不再单独画一行。
			if (node.kind === 'turn-process') {
				continue;
			}
			// 计划卡属于 turn tail（官方把它在 flow 里隐藏、在尾部成卡），这里随尾部一起画。
			// 该 Turn 还没有 tail（仍在进行）时不能跳过，否则计划卡无处可去、整张消失。
			if (node.kind === 'submitted-plan' && node.turn !== undefined && turnsWithTail.has(node.turn)) {
				continue;
			}
			if (node.kind === 'turn-tail') {
				for (const planKey of planKeysForTurn(grouped, node.turn ?? -1)) {
					rows.push({ key: `plan:${planKey}`, kind: 'node', nodeKey: planKey });
				}
			}
			const headers = summaryBefore.get(nodeId);
			// 一个锚点前可能有多段各自的组头（同 Turn 多段时），按序各画一行。
			headers?.forEach((header, index) => {
				rows.push({ key: `summary:${nodeId}:${index}`, kind: 'summary', line: header.line, turn: header.turn, expanded: header.expanded, onToggle: header.onToggle });
			});
			rows.push({ key: `node:${nodeId}`, kind: 'node', nodeKey: nodeId });
		}
		for (const eventId of this.content.questionIds ?? []) {
			rows.push({ key: `question:${eventId}`, kind: 'question', eventId });
		}
		const aside = dshAsideText(this.content.treeId);
		if (aside !== undefined) {
			rows.push({ key: 'aside', kind: 'aside', text: aside });
		}
		return rows;
	}

	/** 一行的显示签名：只由这一行真正画出来的内容决定。 */
	private rowSignature(row: DshSlotRowSpec, binding: NonNullable<ReturnType<typeof dshContentStore.get>>): string {
		switch (row.kind) {
			case 'summary':
				// 展开状态参与签名：否则切换后增量渲染认为「没变」而不重画箭头。
				return `summary\u0000${row.line}\u0000${row.expanded === true ? '1' : '0'}`;
			case 'question':
				return `question\u0000${binding.questions?.get(row.eventId)?.signature ?? row.eventId}`;
			case 'aside':
				return `aside\u0000${row.text}`;
			case 'node': {
				const node = binding.tree.get(row.nodeKey);
				if (node === undefined) {
					return 'missing';
				}
				const expanded = binding.expansion.isDisclosed(node.turn ?? 0, row.nodeKey) ? '1' : '0';
				return `node\u0000${dshNodeDisplaySignature(node)}\u0000${expanded}`;
			}
		}
	}

	/** 按行类型构造 DOM；每行自己的监听进该行的 `refs`。 */
	private renderRow(row: DshSlotRowSpec, binding: NonNullable<ReturnType<typeof dshContentStore.get>>, refs: DisposableStore): HTMLElement {
		switch (row.kind) {
			case 'summary': {
				const button = processSummaryRow(row.line, row.expanded === true);
				if (row.onToggle !== undefined) {
					button.disabled = false;
					button.style.cursor = 'pointer';
					const click = (event: MouseEvent) => {
						event.stopPropagation();
						row.onToggle?.();
					};
					button.addEventListener('click', click);
					refs.add({ dispose: () => button.removeEventListener('click', click) });
					// **不设 `aria-expanded` / `aria-controls`**：本仓的组头目前只切换图标，
					// 并不真的隐藏/显示一块独立 DOM 容器（过程内容由 slot host 整体重绘）。
					// 只设 `aria-expanded` 会让读屏以为存在一个可展开区域，而 `aria-controls`
					// 又找不到真实目标——那是**假装有 disclosure**，比不设更糟。
					// 等组内容有独立容器后再一起补（届时成对设置）。
					button.title = row.line;
				}
				return button;
			}
			case 'aside': {
				const panel = $('.dsh-aside');
				panel.textContent = row.text;
				// 官方把 aside 描述为「beside the transcript」的会话级席位，语义上是补充说明。
				panel.setAttribute('role', 'note');
				panel.style.color = 'var(--vscode-descriptionForeground)';
				panel.style.borderLeft = '2px solid var(--vscode-editorWidget-border)';
				panel.style.paddingLeft = '8px';
				return panel;
			}
			case 'question': {
				const part = this.native?.renderQuestion?.(row.eventId);
				if (part?.domNode !== undefined) {
					refs.add(part);
					if (part.onDidChangeHeight !== undefined) {
						refs.add(part.onDidChangeHeight(() => this._onDidChangeHeight.fire()));
					}
					return part.domNode;
				}
				part?.dispose();
				return document.createElement('div');
			}
			case 'node':
				return this.renderNode(row.nodeKey, binding, false, refs, row.key);
		}
	}

	private renderActions(actions: readonly DshAssistantAction[], refs: DisposableStore): HTMLElement {
		const bar = $('.dsh-assistant-actions');
		bar.style.display = 'flex';
		bar.style.gap = '6px';
		bar.style.paddingLeft = '0';
		// `role="toolbar"` 必须有可访问名，否则读屏只念「工具栏」而不知道是哪一组。
		bar.setAttribute('role', 'toolbar');
		bar.setAttribute('aria-label', localize('dsh.actions.label', "Message actions"));
		for (const action of actions) {
			const button = $('button.dsh-assistant-action') as HTMLButtonElement;
			// 统一走 `applyDshButtonChrome`：`border: none` 会抹掉默认焦点环，
			// 必须由共享样式表补回 `:focus-visible`（§11.2），否则键盘用户看不到焦点。
			applyDshButtonChrome(button, 'link');
			button.textContent = action.title;
			button.title = action.title;
			refs.add(addClick(button, () => {
				this.native?.executeCommand?.(action.command, action.arguments ?? []);
			}));
			bar.appendChild(button);
		}
		return bar;
	}

	/**
	 * 文本手势条：只在行内有选中文本时显示。
	 *
	 * 选中判定用 `selectionchange`，不接管原生选择行为；点击把选中文本作为最后一个参数传给插件命令。
	 */
	private renderTextInteractions(host: HTMLElement, interactions: readonly DshTextInteraction[], refs: DisposableStore, rowKey: string): HTMLElement {
		const bar = $('.dsh-text-interactions');
		bar.style.display = 'none';
		bar.style.gap = '6px';
		bar.setAttribute('role', 'toolbar');
		bar.setAttribute('aria-label', localize('dsh.textInteraction.label', "Text actions"));
		const selected = (): string => {
			const selection = this.domNode.ownerDocument.defaultView?.getSelection();
			if (selection === null || selection === undefined || selection.rangeCount === 0) {
				return '';
			}
			const anchor = selection.getRangeAt(0).commonAncestorContainer;
			// 选中手势条自身（按钮文字）不算选中正文，否则点完按钮后条会一直亮着。
			if (!host.contains(anchor) || bar.contains(anchor)) {
				return '';
			}
			return selection.toString().trim();
		};
		const sync = () => {
			const hasSelection = selected() !== '';
			bar.style.display = hasSelection ? 'flex' : 'none';
		};
		// 每个助手行都往 document 上挂一个 `selectionchange` 的话，长会话里会有 N 个监听
		// 在每次选区变化时各自重算一遍。这里只登记回调，document 上始终只有本 part 的一个监听。
		this.selectionSyncs.set(rowKey, sync);
		for (const interaction of interactions) {
			const button = $('button.dsh-text-interaction') as HTMLButtonElement;
			applyDshButtonChrome(button, 'link');
			button.textContent = interaction.title;
			button.title = interaction.title;
			refs.add(addClick(button, () => {
				const text = selected();
				if (text === '') {
					return;
				}
				this.native?.executeCommand?.(interaction.command, [...(interaction.arguments ?? []), text]);
			}));
			bar.appendChild(button);
		}
		return bar;
	}

	/**
	 * 一个 Turn 里各过程段的「组头锚点」（官方：每个组有自己的组头）。
	 *
	 * 段的组头挂在**该段之后**会画出来的那一行前：这样读者看到的是「一堆工具 → [N 个工具] → 答复」。
	 * 找不到后续可见行时返回空数组，调用方退回「挂在 Turn 收尾答复前」。
	 *
	 * @param group 该 Turn 的过程组（含 `segments`）
	 * @param binding 当前内容绑定
	 * @returns 每段一个锚点 key（按段序；段内无可见锚点的段被跳过）
	 */
	private segmentAnchors(group: DshTurnProcess, binding: NonNullable<ReturnType<typeof dshContentStore.get>>): readonly string[] {
		if (group.segments.length <= 1) {
			// 单段没有「按段分行」的意义：交给调用方走原来的整 Turn 锚点路径。
			return [];
		}
		const anchors: string[] = [];
		for (const segment of group.segments) {
			const lastKey = segment.processKeys.at(-1);
			if (lastKey === undefined) {
				continue;
			}
			// 段后第一个「会画出来」的节点：优先答复，其次 turn-tail（收尾行），最后任意非 turn-process 的 answerKey。
			const after = group.answerKeys.find(key => {
				const node = binding.tree.get(key) as { readonly kind?: string; readonly seq?: number } | undefined;
				if (node === undefined || node.kind === 'turn-process') {
					return false;
				}
				const lastNode = binding.tree.get(lastKey) as { readonly seq?: number } | undefined;
				return (node.seq ?? 0) > (lastNode?.seq ?? 0);
			});
			if (after !== undefined) {
				anchors.push(after);
			}
		}
		return anchors;
	}

	private renderNode(nodeId: string, binding: NonNullable<ReturnType<typeof dshContentStore.get>>, nested: boolean, refs: DisposableStore, rowKey = nodeId): HTMLElement {
		const node = binding.tree.get(nodeId);
		const row = document.createElement('div');
		row.className = 'dsh-slot-row';
		row.style.display = 'flex';
		row.style.flexDirection = 'column';
		row.style.paddingLeft = nested ? '16px' : '0';
		if (node === undefined) {
			return row;
		}
		const adapted = adaptDshNode(node, this.content.treeId);
		// 用户消息上方的装饰：官方 chain 槽，首个认领的 occupant 生效。
		// 官方 `slots.ts` 明确「steering and pending rows do not render this slot」，因此只认 `user`。
		if (node.kind === 'user') {
			const decoration = dshUserBeforeDecoration(this.content.treeId, node.kind, (node as { readonly source?: { readonly kind?: string } }).source?.kind);
			if (decoration !== undefined) {
				const label = $('.dsh-user-before');
				label.textContent = decoration.label;
				label.style.color = 'var(--vscode-descriptionForeground)';
				label.style.fontSize = '0.9em';
				row.appendChild(label);
			}
		}
		if (adapted.length > 0) {
			for (const item of adapted) {
				const nativePart = this.native?.render(item.part);
				if (nativePart?.domNode !== undefined) {
					refs.add(nativePart);
					row.appendChild(nativePart.domNode);
					continue;
				}
				nativePart?.dispose();
				row.appendChild(renderAdaptedFallback(item.part, this.native));
			}
			for (const child of binding.tree.childKeysOf(nodeId)) {
				row.appendChild(this.renderNode(child, binding, true, refs));
			}
			if (node.kind === 'assistant') {
				// 文本手势只挂在助手正文上（surface 是 assistant-markdown）：
				// 放到通用分支会让工具行、用户行也长出同一排按钮。
				const interactions = dshTextInteractions(this.content.treeId, 'assistant-markdown');
				if (interactions.length > 0) {
					row.appendChild(this.renderTextInteractions(row, interactions, refs, rowKey));
				}
			}
			return row;
		}
		const presented = presentDshNode(node, nested, this.content.treeId);
		const header = $('button.dsh-slot-row-header') as HTMLButtonElement;
		header.style.display = 'flex';
		header.style.alignItems = 'center';
		header.style.gap = '6px';
		header.style.padding = '2px 0';
		header.style.background = 'transparent';
		header.style.color = 'var(--vscode-foreground)';
		header.style.textAlign = 'left';
		// 行头是链接式按钮：同样要有 `:focus-visible`，否则 Tab 上来只剩一片空白。
		applyDshButtonChrome(header, 'link');
		header.style.display = 'flex';
		header.style.alignItems = 'center';
		header.style.gap = '6px';
		header.style.padding = '2px 0';
		const icon = $('span');
		icon.className = `codicon codicon-${presented.icon}`;
		const title = $('span');
		title.textContent = presented.toolView === undefined ? presented.title : `${presented.toolView} · ${presented.title}`;
		header.appendChild(icon);
		header.appendChild(title);
		header.setAttribute('aria-label', presented.title);
		const open = presented.detail !== '' && binding.expansion.isDisclosed(node.turn ?? 0, nodeId);
		// 没有 detail 时这行不可展开：不要再留一个可聚焦、点了没反应的按钮。
		if (presented.detail === '') {
			applyDshStaticRowChrome(header);
		} else {
			header.setAttribute('aria-expanded', open ? 'true' : 'false');
		}
		const detail = $('pre');
		// `aria-controls` 指向的必须是真实存在的元素：不可展开时 detail 为空、不给 id。
		if (presented.detail !== '') {
			// 节点 key 形如 `tool-call:callId`，含冒号。HTML5 允许，但为了不依赖
			// 「调用方永远用 getElementById 而不是 CSS 选择器」这一假设，统一编码成安全字符。
			detail.id = `${this.domIdPrefix}-detail-${nodeId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
			header.setAttribute('aria-controls', detail.id);
		}
		detail.textContent = presented.detail;
		detail.style.margin = '0 0 0 22px';
		detail.style.whiteSpace = 'pre-wrap';
		detail.style.fontFamily = 'var(--monaco-monospace-font)';
		detail.style.color = 'var(--vscode-descriptionForeground)';
		detail.hidden = !open;
		refs.add(addClick(header, () => {
			if (presented.detail === '') {
				return;
			}
			binding.expansion.setDisclosed(node.turn ?? 0, nodeId, !binding.expansion.isDisclosed(node.turn ?? 0, nodeId));
		}));
		row.appendChild(header);
		row.appendChild(detail);
		for (const child of binding.tree.childKeysOf(nodeId)) {
			row.appendChild(this.renderNode(child, binding, true, refs));
		}
		// 动作行挂在 turn tail 内，owner 是收尾答复的 messageId（官方 `TurnTailNodeView`）：
		// 中断冻结的部分回复没有 messageId，此时不给动作行。
		if (node.kind === 'turn-tail') {
			const actions = dshAssistantActions(this.content.treeId, (node as { readonly closingMessageId?: string }).closingMessageId);
			if (actions.length > 0) {
				row.appendChild(this.renderActions(actions, refs));
			}
		}
		return row;
	}
}


/**
 * 过程组的组头行（官方「Group-title rules」的交互部分）。
 *
 * 官方：「Group headers show a **category icon**, replace it with a **down arrow on hover or keyboard focus**,
 * and show an **up arrow while open**.」
 *
 * 实现用 `codicon` + CSS 的 `:hover` / `:focus-visible` 切换图标，不自绘 SVG、不用脚本监听 hover：
 *   - 默认显示 `codicon-list-unordered`（类别图标）；
 *   - hover / 键盘聚焦时换成 `codicon-chevron-down`；
 *   - 展开时换成 `codicon-chevron-up`（优先级最高）。
 * 不可交互（`onToggle` 缺省）时保持类别图标、`disabled`，不留「点了没反应」的入口。
 *
 * @param line 组头文案
 * @param expanded 该组当前是否展开
 */
function processSummaryRow(line: string, expanded: boolean): HTMLButtonElement {
	const row = document.createElement('button');
	// 与原生 chat 的次按钮一致：无边框、无背景、继承字号 + `:focus-visible` 焦点环。
	applyDshButtonChrome(row, 'link');
	row.className = 'dsh-process-summary';
	row.disabled = true;
	const icon = document.createElement('span');
	icon.className = `codicon ${expanded ? 'codicon-chevron-up' : 'codicon-list-unordered'} dsh-process-summary-icon`;
	icon.setAttribute('aria-hidden', 'true');
	icon.style.marginRight = '4px';
	// hover / focus 时的箭头切换交给这张一次性注入的样式表（见 `ensureProcessSummaryStyles`）。
	ensureProcessSummaryStyles();
	const text = document.createElement('span');
	text.textContent = line;
	row.appendChild(icon);
	row.appendChild(text);
	row.style.color = 'var(--vscode-descriptionForeground)';
	return row;
}

let processSummaryStyles: HTMLStyleElement | undefined;

/**
 * 组头图标的 hover / focus 切换（一次性注入）。
 *
 * 为什么用 CSS 而不是监听 hover：图标切换是纯呈现，交给 `:hover` / `:focus-visible` 更可靠
 * （不用管 pointerenter/leave 的边界情况），也不会给每行挂两个监听。
 */
function ensureProcessSummaryStyles(): void {
	if (processSummaryStyles !== undefined && processSummaryStyles.isConnected) {
		return;
	}
	processSummaryStyles = createStyleSheet(undefined, style => {
		style.textContent = `
			.dsh-process-summary .dsh-process-summary-icon::before { content: '\\ea75'; }
			.dsh-process-summary:hover .dsh-process-summary-icon::before,
			.dsh-process-summary:focus-visible .dsh-process-summary-icon::before { content: '\\eab4'; }
			.dsh-process-summary[aria-expanded="true"] .dsh-process-summary-icon::before { content: '\\eab5'; }
		`;
	});
}

function renderAdaptedFallback(part: DshNativePart, host?: { reviewQuestion?: (callId: string, questions: readonly { readonly id: string; readonly question?: string; readonly header?: string }[], answers: readonly { readonly id: string; readonly selected: readonly string[]; readonly custom?: string }[]) => void }): HTMLElement {
	// 先把「确实需要自研」的部件交给结构化卡片（契约 §16 退出条件 4）。
	// 这一步必须在文本拼接之前：否则 compaction / system prompt 会又退回一串 textContent。
	const card = dshCardSpec(part);
	if (card !== undefined) {
		return renderDshCard(part.kind, card);
	}
	const block = document.createElement('div');
	block.className = `dsh-adapted dsh-adapted-${part.kind}`;
	block.style.color = 'var(--vscode-foreground)';
	block.style.whiteSpace = 'pre-wrap';
	if (part.kind === 'markdownContent' || part.kind === 'thinking' || part.kind === 'warning') {
		block.textContent = part.kind === 'thinking' ? part.value : part.content.value;
	} else if (part.kind === 'toolInvocationSerialized') {
		block.textContent = `${part.invocationMessage}\n${part.toolSpecificData.input}`;
	} else if (part.kind === 'reference') {
		block.textContent = part.label;
	} else if (part.kind === 'progressTaskSerialized') {
		block.textContent = [part.content.value, ...part.items].join('\n');
	} else if (part.kind === 'treeData') {
		block.textContent = part.labels.join('\n');
	} else if (part.kind === 'multiDiffData') {
		block.textContent = part.files.map(file => file.path).join('\n');

	} else if (part.kind === 'dshCommand') {
		// `conversation.chat.commandview` 的 occupant 可覆盖标题/说明/图标；
		// 没有 occupant 时保持原样（命令名 + 参数 + 结果）。
		const line = ['/' + (part.name || part.commandId), part.args ?? '', part.outcome ?? ''].filter(text => text !== '').join(' ');
		block.textContent = part.detail ?? line;
		if (part.title !== undefined) {
			const title = document.createElement('div');
			title.textContent = part.title;
			block.prepend(title);
		}
	} else if (part.kind === 'dshTurnTailExtra') {
		block.textContent = part.lines.join('\n');

	} else if (part.kind === 'dshSubmittedPlan') {
		block.textContent = `# ${part.title}\n${part.markdown}`;
	} else if (part.kind === 'dshCommandInput') {
		block.textContent = part.text;
	} else if (part.kind === 'dshQuestionReply') {
		const byId = new Map(part.answers.map(answer => [answer.id, answer]));
		block.textContent = part.questions.length === 0 ? part.text : part.questions.map(question => {
			const answer = byId.get(question.id);
			const values = [...(answer?.selected ?? []), ...(answer?.custom === undefined || answer.custom === '' ? [] : [answer.custom])];
			const head = question.header === undefined || question.header === question.question
				? question.question : `${question.header} — ${question.question}`;
			return `${head}\n${values.length === 0 ? localize('dsh.fallback.skipped', "(skipped)") : values.join(', ')}`;
		}).join('\n\n');
		// 官方 `userQuestionPanels.review`：已结算问卷可**只读重开**。
		// 这里只加入口按钮；真正的只读卡片由 `review()` 建出的 entry 渲染，不在回退文本里伪造。
		if (part.callId !== '' && part.questions.length > 0 && host?.reviewQuestion !== undefined) {
			const review = document.createElement('button');
			applyDshButtonChrome(review, 'link');
			review.className = 'dsh-question-review';
			review.textContent = localize('dsh.question.viewAnswers', "View answers");
			review.style.alignSelf = 'flex-start';
			review.setAttribute('aria-label', localize('dsh.question.viewAnswersLabel', "View the recorded answers"));
			const click = (event: MouseEvent) => {
				event.stopPropagation();
				host?.reviewQuestion?.(part.callId, part.questions, part.answers);
			};
			review.addEventListener('click', click);
			block.appendChild(review);
		}
	} else if (part.kind === 'dshTurnTail') {
		block.textContent = [part.closing, part.branchUnavailable === true ? localize('dsh.fallback.branchUnavailable', "branch unavailable") : undefined]
			.filter((line): line is string => line !== undefined && line !== '')
			.join('\n');
	} else if (part.kind === 'dshUsage') {
		block.textContent = [
			localize('dsh.usage.inputOutput', "in {0} out {1}", formatTokens(part.input ?? 0), formatTokens(part.output ?? 0)),
			part.cacheRead === undefined ? '' : localize('dsh.usage.cacheRead', "cache-read {0}", formatTokens(part.cacheRead)),
			part.cacheWrite === undefined ? '' : localize('dsh.usage.cacheWrite', "cache-write {0}", formatTokens(part.cacheWrite)),
			part.reasoning === undefined ? '' : localize('dsh.usage.reasoning', "reasoning {0}", formatTokens(part.reasoning)),
		].filter(line => line !== '').join(' ');
	} else if (part.kind === 'dshTurnTrigger') {
		block.textContent = part.title;
	} else if (part.kind === 'dshMaxTokens') {
		block.textContent = [localize('dsh.fallback.maxTokens', "output limit"), part.turn, part.step].filter(line => line !== undefined).join(' ');
	} else if (part.kind === 'dshInheritedHistory') {
		// 官方 `ui-chat/README.md`「Inherited history divider」：文案是 "Inherited history above"，
		// 且「The caption starts with the **branch glyph that the branch action uses**」。
		// 用 codicon 的 `git-branch`（与 VS Code 分支动作同一图标族），不自绘 SVG。
		block.textContent = '';
		const glyph = document.createElement('span');
		glyph.className = 'codicon codicon-git-branch';
		glyph.setAttribute('aria-hidden', 'true');
		glyph.style.marginRight = '4px';
		block.appendChild(glyph);
		block.appendChild(document.createTextNode(localize('dsh.fallback.inheritedHistory', "Inherited history above")));
	} else if (part.kind === 'dshModelRetry') {
		block.textContent = [part.retry, part.maxRetries, part.delayMs, part.mode, part.retryState, part.code, part.message]
			.filter(line => line !== undefined && line !== '')
			.join(' ');
	} else if (part.kind === 'dshAssistantMeta') {
		block.textContent = [part.provider, part.model, part.interrupted === true ? localize('dsh.meta.interrupted', "interrupted") : undefined].filter((line): line is string => line !== undefined && line !== '').join(' ');
	} else if (part.kind === 'dshContext') {
		block.textContent = [part.producer, part.form, part.text].filter((line): line is string => line !== null && line !== '').join('\n');
	} else if (part.kind === 'dshUnknown') {
		block.textContent = part.data === '' ? part.type : `${part.type}\n${part.data}`;
	} else if (part.kind === 'errorDetails') {
		block.textContent = part.message;
	}
	return block;
}

function addClick(element: HTMLElement, run: () => void): { dispose(): void } {
	const listener = () => run();
	element.addEventListener('click', listener);
	return { dispose: () => element.removeEventListener('click', listener) };
}

/**
 * 把结构化描述画成卡片。
 *
 * 用原生 `<details>` / `<summary>`：折叠、键盘（Enter/Space）、高对比度、读屏全部由浏览器
 * 与 VS Code 主题接管，不自绘折叠箭头、不自己管 aria-expanded。
 * 不可折叠时改为静态标题行（没有 `details` 就没有「点了没反应」的入口）。
 */
function renderDshCard(kind: string, spec: DshCardSpec): HTMLElement {
	const card = document.createElement('div');
	card.className = `dsh-card dsh-card-${kind}`;
	card.style.color = 'var(--vscode-foreground)';
	card.style.borderLeft = '2px solid var(--vscode-editorWidget-border)';
	card.style.paddingLeft = '8px';
	if (!spec.collapsible) {
		const title = document.createElement('div');
		title.textContent = spec.title;
		title.style.color = 'var(--vscode-descriptionForeground)';
		card.appendChild(title);
		for (const line of spec.lines) {
			card.appendChild(cardLine(line));
		}
		return card;
	}
	const details = document.createElement('details');
	details.open = spec.open;
	const summary = document.createElement('summary');
	summary.textContent = spec.title;
	summary.style.cursor = 'pointer';
	summary.style.color = 'var(--vscode-descriptionForeground)';
	details.appendChild(summary);
	for (const line of spec.lines) {
		details.appendChild(cardLine(line));
	}
	card.appendChild(details);
	return card;
}

/** 一行卡片内容：用 `white-space: pre-wrap` 保留换行，不丢正文格式。 */
function cardLine(line: DshCardSpec['lines'][number]): HTMLElement {
	const element = document.createElement(line.role === 'body' ? 'div' : 'div');
	element.textContent = line.text;
	element.style.whiteSpace = 'pre-wrap';
	if (line.role !== 'body') {
		element.style.color = 'var(--vscode-descriptionForeground)';
		element.style.fontSize = '0.9em';
	}
	return element;
}

/**
 * 把工具节点的 `argsRaw`（原始 JSON 串）解析成参数对象。
 *
 * 流式中的参数可能还不完整——解析失败返回 `undefined`，让调用方退回工具名，
 * 而不是抛错或猜测半截内容。
 */
function parsedArgsOf(raw: string | undefined): unknown {
	if (raw === undefined || raw === '') {
		return undefined;
	}
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return undefined;
	}
}
