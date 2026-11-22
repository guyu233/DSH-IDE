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
import { formatTokens, workflowStatusText } from './dshTokenFormat.js';
import { dshAsideText, dshAssistantActions, dshTextInteractions, dshUserBeforeDecoration, type DshAssistantAction, type DshTextInteraction } from './dshChatSlots.js';
import { dshContentStore } from './dshContentStore.js';
import { adaptDshNode, type DshNativePart } from './dshNativePartAdapters.js';
import { groupTurnProcesses, hiddenProcessLine, processLineFromSnapshot, visibleProcessKeys } from './dshProcessGroup.js';
import { dshSlotHostSame, planKeysForTurn, presentDshNode, type DshSlotHostRef } from './dshSlotHostModel.js';

export interface DshNativePartRenderer {
	render(part: DshNativePart): IChatContentPart | undefined;
	renderQuestion?(eventId: string): (IChatContentPart & { readonly onDidChangeHeight?: Event<void> }) | undefined;
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

export class DshSlotHostContentPart extends Disposable implements IChatContentPart {
	readonly domNode: HTMLElement;
	private readonly body: HTMLElement;
	private readonly refs: DisposableStore;
	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;
	/** 每次 render 重建的文本手势同步回调；document 上只挂一个监听。 */
	private readonly selectionSyncs = new Set<() => void>();

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
		this.refs = this._register(new DisposableStore());
		// 选区变化只影响手势条显隐，统一在 part 级处理，不为每行各挂一个监听。
		const doc = this.domNode.ownerDocument;
		const onSelectionChange = () => {
			for (const sync of this.selectionSyncs) {
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
		}
	}

	hasSameContent(other: IChatRendererContent, _followingContent: IChatRendererContent[], _element: ChatTreeItem): boolean {
		return other.kind === 'dshSlotHost' && dshSlotHostSame(this.content, other as DshSlotHostRef);
	}

	private render(): void {
		this.refs.clear();
		// 上一轮的手势条已随 DOM 移除，对应的同步回调不能再指向旧节点。
		this.selectionSyncs.clear();
		this.body.replaceChildren();
		const binding = dshContentStore.get(this.content.treeId);
		if (binding === undefined) {
			return;
		}
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
		const summaryBefore = new Map<string, string>();
		// 计划卡正常随 turn tail 画；但 Turn 还没结束（没有 `turn-tail`）时它也会被跳过，
		// 于是整张卡消失。这里记下「哪些 Turn 已有 tail」，剩下的计划卡就地画在原位。
		const turnsWithTail = new Set<number>();
		for (const node of grouped) {
			if (node.kind === 'turn-tail' && node.turn !== undefined) {
				turnsWithTail.add(node.turn);
			}
		}
		for (const group of groupTurnProcesses(grouped)) {
			const collapsed = binding.expansion.isTurnCollapsed(group.turn, group.answerStep);
			for (const key of visibleProcessKeys(group, collapsed)) {
				visible.add(key);
			}
			if (group.alwaysOpen || !collapsed || group.processKeys.length === 0) {
				continue;
			}
			const byKey = new Map(grouped.map(node => [node.key, node]));
			// 优先用线协议里的 turn-process 计数（官方过程组行的数据）；缺失时才现算。
			const snapshotKey = grouped.find(node => node.kind === 'turn-process' && node.turn === group.turn)?.key;
			const snapshot = snapshotKey === undefined ? undefined : binding.tree.get(snapshotKey) as {
				readonly toolCallCount?: number; readonly subagentCount?: number; readonly messageCount?: number;
			} | undefined;
			const line = (snapshot === undefined ? undefined : processLineFromSnapshot({
				toolCallCount: snapshot.toolCallCount ?? 0,
				subagentCount: snapshot.subagentCount ?? 0,
				messageCount: snapshot.messageCount ?? 0,
			})) ?? hiddenProcessLine(group.processKeys.flatMap(key => {
				const node = byKey.get(key);
				if (node === undefined) {
					return [];
				}
				const named = binding.tree.get(key) as { readonly name?: string; readonly callId?: string } | undefined;
				return [{
					kind: node.kind,
					...(typeof named?.name === 'string' ? { name: named.name } : {}),
					...(named?.callId === undefined ? {} : { callId: named.callId }),
				}];
			}));
			// 锚点必须是真正会画出来的那一行：`turn-process` 也被算进 answerKeys（位置是 turn），
			// 但它在渲染时会被跳过，挂到它上面的计数行就永远不显示。
			const anchor = group.answerKeys.find(key => {
				const node = binding.tree.get(key) as { readonly kind?: string } | undefined;
				return node !== undefined && node.kind !== 'turn-process';
			});
			if (line !== undefined && anchor !== undefined) {
				summaryBefore.set(anchor, line);
			}
		}
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
					this.body.appendChild(this.renderNode(planKey, binding, false));
				}
			}
			const line = summaryBefore.get(nodeId);
			if (line !== undefined) {
				this.body.appendChild(processSummaryRow(line));
			}
			this.body.appendChild(this.renderNode(nodeId, binding, false));
		}
		for (const eventId of this.content.questionIds ?? []) {
			const part = this.native?.renderQuestion?.(eventId);
			if (part?.domNode !== undefined) {
				this.refs.add(part);
				if (part.onDidChangeHeight !== undefined) {
					this.refs.add(part.onDidChangeHeight(() => this._onDidChangeHeight.fire()));
				}
				this.body.appendChild(part.domNode);
			} else {
				part?.dispose();
			}
		}
		// 侧栏席位：官方 single 槽，插件给一段文本时在尾部渲染。
		const aside = dshAsideText(this.content.treeId);
		if (aside !== undefined) {
			const panel = $('.dsh-aside');
			panel.textContent = aside;
			// 官方把 aside 描述为「beside the transcript」的会话级席位，语义上是补充说明。
			panel.setAttribute('role', 'note');
			panel.style.color = 'var(--vscode-descriptionForeground)';
			panel.style.borderLeft = '2px solid var(--vscode-editorWidget-border)';
			panel.style.paddingLeft = '8px';
			this.body.appendChild(panel);
		}
		this._onDidChangeHeight.fire();
	}

	private renderActions(actions: readonly DshAssistantAction[]): HTMLElement {
		const bar = $('.dsh-assistant-actions');
		bar.style.display = 'flex';
		bar.style.gap = '6px';
		bar.style.paddingLeft = '0';
		// `role="toolbar"` 必须有可访问名，否则读屏只念「工具栏」而不知道是哪一组。
		bar.setAttribute('role', 'toolbar');
		bar.setAttribute('aria-label', localize('dsh.actions.label', "Message actions"));
		for (const action of actions) {
			const button = $('button.dsh-assistant-action') as HTMLButtonElement;
			button.type = 'button';
			button.textContent = action.title;
			button.title = action.title;
			// 与原生 chat 的次按钮一致：无边框、无背景，靠主题色与焦点环。
			button.style.border = 'none';
			button.style.background = 'transparent';
			button.style.color = 'var(--vscode-textLink-foreground)';
			button.style.font = 'inherit';
			button.style.cursor = 'pointer';
			button.style.padding = '0';
			this.refs.add(addClick(button, () => {
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
	private renderTextInteractions(host: HTMLElement, interactions: readonly DshTextInteraction[]): HTMLElement {
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
		this.selectionSyncs.add(sync);
		for (const interaction of interactions) {
			const button = $('button.dsh-text-interaction') as HTMLButtonElement;
			button.type = 'button';
			button.textContent = interaction.title;
			button.title = interaction.title;
			button.style.border = 'none';
			button.style.background = 'transparent';
			button.style.color = 'var(--vscode-textLink-foreground)';
			button.style.font = 'inherit';
			button.style.cursor = 'pointer';
			button.style.padding = '0';
			this.refs.add(addClick(button, () => {
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

	private renderNode(nodeId: string, binding: NonNullable<ReturnType<typeof dshContentStore.get>>, nested: boolean): HTMLElement {
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
					this.refs.add(nativePart);
					row.appendChild(nativePart.domNode);
					continue;
				}
				nativePart?.dispose();
				row.appendChild(renderAdaptedFallback(item.part));
			}
			for (const child of binding.tree.childKeysOf(nodeId)) {
				row.appendChild(this.renderNode(child, binding, true));
			}
			if (node.kind === 'assistant') {
				// 文本手势只挂在助手正文上（surface 是 assistant-markdown）：
				// 放到通用分支会让工具行、用户行也长出同一排按钮。
				const interactions = dshTextInteractions(this.content.treeId, 'assistant-markdown');
				if (interactions.length > 0) {
					row.appendChild(this.renderTextInteractions(row, interactions));
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
		header.style.border = 'none';
		header.style.background = 'transparent';
		header.style.color = 'var(--vscode-foreground)';
		header.style.font = 'inherit';
		header.style.textAlign = 'left';
		header.style.cursor = 'pointer';
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
			header.disabled = true;
			header.style.cursor = 'default';
			header.removeAttribute('aria-expanded');
		} else {
			header.setAttribute('aria-expanded', open ? 'true' : 'false');
		}
		const detail = $('pre');
		detail.textContent = presented.detail;
		detail.style.margin = '0 0 0 22px';
		detail.style.whiteSpace = 'pre-wrap';
		detail.style.fontFamily = 'var(--monaco-monospace-font)';
		detail.style.color = 'var(--vscode-descriptionForeground)';
		detail.hidden = !open;
		this.refs.add(addClick(header, () => {
			if (presented.detail === '') {
				return;
			}
			binding.expansion.setDisclosed(node.turn ?? 0, nodeId, !binding.expansion.isDisclosed(node.turn ?? 0, nodeId));
		}));
		row.appendChild(header);
		row.appendChild(detail);
		for (const child of binding.tree.childKeysOf(nodeId)) {
			row.appendChild(this.renderNode(child, binding, true));
		}
		// 动作行挂在 turn tail 内，owner 是收尾答复的 messageId（官方 `TurnTailNodeView`）：
		// 中断冻结的部分回复没有 messageId，此时不给动作行。
		if (node.kind === 'turn-tail') {
			const actions = dshAssistantActions(this.content.treeId, (node as { readonly closingMessageId?: string }).closingMessageId);
			if (actions.length > 0) {
				row.appendChild(this.renderActions(actions));
			}
		}
		return row;
	}
}


function processSummaryRow(line: string): HTMLElement {
	const row = document.createElement('div');
	row.className = 'dsh-process-summary';
	row.textContent = line;
	return row;
}

function renderAdaptedFallback(part: DshNativePart): HTMLElement {
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
	} else if (part.kind === 'dshFileCard') {
		block.textContent = part.files.map(file => file.bytes === undefined ? file.name : `${file.name} (${file.bytes})`).join('\n');
	} else if (part.kind === 'dshCompaction') {
		const counts = [part.shadowedItemCount, part.shadowedTokenCount].filter((value): value is number => typeof value === 'number');
		block.textContent = [part.summary ?? '', ...counts.map(value => String(value))].filter(line => line !== '').join('\n');
	} else if (part.kind === 'dshCommand') {
		block.textContent = ['/' + (part.name || part.commandId), part.args ?? '', part.outcome ?? ''].filter(line => line !== '').join(' ');
	} else if (part.kind === 'dshTurnTailExtra') {
		block.textContent = part.lines.join('\n');
	} else if (part.kind === 'dshWorkflowRun') {
		block.textContent = [
			`${part.name} (${workflowStatusText(part.status)})`,
			...part.phases.map(phase => {
				const head = phase.phase === null ? phase.key : phase.phase;
				return [`${head}:`, ...phase.members.map(member => `  ${member.label} (${workflowStatusText(member.status)})`)].join('\n');
			}),
		].join('\n');
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
	} else if (part.kind === 'dshDeliverables') {
		block.textContent = part.files.map(file => file.description === undefined ? file.path : `${file.path} ${file.description}`).join('\n');
	} else if (part.kind === 'dshSystemPrompt') {
		block.textContent = part.update === undefined || part.update === '' ? part.text : `${part.text}\n${part.update}`;
	} else if (part.kind === 'dshTurnTrigger') {
		block.textContent = part.title;
	} else if (part.kind === 'dshMaxTokens') {
		block.textContent = [localize('dsh.fallback.maxTokens', "output limit"), part.turn, part.step].filter(line => line !== undefined).join(' ');
	} else if (part.kind === 'dshInheritedHistory') {
		block.textContent = localize('dsh.fallback.inheritedHistory', "Inherited history");
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
