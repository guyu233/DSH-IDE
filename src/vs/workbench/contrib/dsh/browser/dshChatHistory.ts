/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// `DshChatNode[]` → 原生 `IChatSessionHistoryItem[]` 的纯映射。
//
// 独立成零 UI 依赖的模块：`dshChatSessionContent.ts` 要拿它填原生会话 history，
// 单元测试也要能直接跑（不抢 `chatSessionsService` 的 CSS / DOM 依赖）。
//
// 原生 history 是「request / response」成对的行：用户消息开启一条 request，
// 其后的助手 / 工具内容并进对应的 response；没有 turn 坐标的内容并入当前 response。

import type { DshChatNode } from './dshChatModel.js';

/** 原生 chat 进度部件的窄形状（只声明本文件产出的几种）。 */
export type DshHistoryPart =
	| { readonly kind: 'markdownContent'; readonly content: { readonly value: string } }
	| { readonly kind: 'thinking'; readonly value: string }
	| { readonly kind: 'warning'; readonly content: { readonly value: string } }
	| { readonly kind: 'info'; readonly content: { readonly value: string } }
	| { readonly kind: 'reference'; readonly reference: string; readonly options?: { readonly status?: { readonly description: string; readonly kind: number } } }
	| { readonly kind: 'command'; readonly command: { readonly id: string; readonly title: string; readonly arguments?: readonly unknown[] } };

/** 原生 `IChatSessionHistoryItem` 的窄形状。 */
export type DshHistoryItem =
	| { readonly type: 'request'; readonly prompt: string; readonly participant: string; readonly timestamp?: number }
	| { readonly type: 'response'; readonly parts: readonly DshHistoryPart[]; readonly participant: string };

/** 只需要 `nodes()` 的会话视图，便于单测注入。 */
export interface DshHistorySource {
	nodes(): readonly DshChatNode[];
}

/** 待决议项（与 `DshChatPending` 同形），用于在 history 尾部渲染审批 / 问卷卡。 */
export interface DshHistoryPending {
	readonly eventId: string;
	readonly kind: 'approval' | 'question';
	readonly title: string;
	readonly options: readonly string[];
	readonly questionId?: string;
}

/** 交付物：官方 `deliverables/presented` 的投影。 */
export interface DshHistoryDeliverable {
	readonly turn: number;
	readonly callId: string;
	readonly files: readonly { readonly path: string; readonly description?: string }[];
}

/** 计划 / 目标 / Todo / Skill / 额度提示：来自快照 typed 字段。 */
export interface DshHistoryExtras {
	readonly plan?: { readonly active: boolean; readonly pending: boolean };
	readonly goal?: {
		readonly goal: { readonly objective: string; readonly phase: string };
		readonly roundsStarted: number;
	};
	readonly todos?: readonly { readonly content: string; readonly status: string }[];
	readonly skills?: readonly { readonly name: string; readonly description: string }[];
	readonly quotaNotice?: { readonly code: string; readonly seq: number };
	readonly attachments?: readonly { readonly attachmentId: string; readonly name?: string; readonly mediaType: string }[];
	readonly deliverables?: readonly DshHistoryDeliverable[];
}

/**
 * 把结构化节点树折成原生 history。
 *
 * `pending` 是当前待决议项：它们渲染成 history 尾部的 warning + 命令按钮，
 * 按钮调用 `dsh.answerApproval` / `dsh.answerQuestion`（不是再发一条 prompt）。
 */
export function toHistory(
	session: DshHistorySource,
	pendingItems: readonly DshHistoryPending[] = [],
	extras: DshHistoryExtras = {},
): readonly DshHistoryItem[] {
	const history: DshHistoryItem[] = [];
	let pending: { prompt: string; participant: string; timestamp?: number } | undefined;
	let parts: DshHistoryPart[] = [];

	const flush = () => {
		if (pending === undefined) {
			return;
		}
		history.push({
			type: 'request',
			prompt: pending.prompt,
			participant: pending.participant,
			...(pending.timestamp === undefined ? {} : { timestamp: pending.timestamp }),
		});
		history.push({ type: 'response', parts, participant: pending.participant });
		pending = undefined;
		parts = [];
	};

	for (const node of session.nodes()) {
		if (node.kind === 'user') {
			flush();
			pending = { prompt: textOf(node.content), participant: 'dsh', timestamp: node.time };
			continue;
		}
		if (node.kind === 'steering') {
			// 运行中插入的人类消息：并进当前 response 的引用文本。
			parts.push({ kind: 'markdownContent', content: { value: `**Steering:** ${textOf(node.content)}` } });
			continue;
		}
		if (node.kind === 'subagent-notice') {
			parts.push({ kind: 'markdownContent', content: { value: `> 子智能体：${textOf(node.content)}` } });
			continue;
		}
		if (pending === undefined) {
			// 没有前置用户消息的内容（例如 fork 继承历史）：开一条内容行。
			pending = { prompt: '', participant: 'dsh' };
		}
		appendNode(node, parts);
	}
	flush();
	appendDeliverables(extras.deliverables ?? [], history);
	appendExtras(extras, history);
	appendPending(pendingItems, history);
	return history;
}

/**
 * 计划 / 目标 / Todo / Skill / 额度 / 附件 → 追加到最后一条 response（没有就单开）。
 *
 * 这些是快照级状态，不属于某一条消息；放在尾部保证用户一眼能看到当前进度与提醒。
 */
function appendExtras(extras: DshHistoryExtras, history: DshHistoryItem[]): void {
	const parts: DshHistoryPart[] = [];
	const push = (part: DshHistoryPart) => parts.push(part);

	if (extras.quotaNotice !== undefined) {
		push({ kind: 'warning', content: { value: `额度不足（${extras.quotaNotice.code}），请检查账号额度。` } });
	}
	if (extras.plan !== undefined) {
		const state = extras.plan.active ? (extras.plan.pending ? '计划模式（等待确认）' : '计划模式已启用') : '计划模式未启用';
		push({ kind: 'info', content: { value: state } });
	}
	if (extras.goal !== undefined) {
		push({
			kind: 'info',
			content: { value: `目标：${extras.goal.goal.objective}（${extras.goal.goal.phase}，已进行 ${extras.goal.roundsStarted} 轮）` },
		});
	}
	if (extras.todos !== undefined && extras.todos.length > 0) {
		const lines = extras.todos.map(todo => {
			const mark = todo.status === 'completed' ? '[x]' : todo.status === 'in_progress' ? '[-]' : '[ ]';
			return `${mark} ${todo.content}`;
		});
		push({ kind: 'markdownContent', content: { value: lines.join('\n') } });
	}
	if (extras.skills !== undefined && extras.skills.length > 0) {
		push({ kind: 'info', content: { value: `可用技能：${extras.skills.map(skill => skill.name).join('、')}` } });
	}
	if (extras.attachments !== undefined && extras.attachments.length > 0) {
		push({ kind: 'info', content: { value: `会话附件 ${extras.attachments.length} 个` } });
	}
	if (parts.length === 0) {
		return;
	}
	const last = history[history.length - 1];
	if (last !== undefined && last.type === 'response') {
		history[history.length - 1] = { ...last, parts: [...last.parts, ...parts] };
		return;
	}
	history.push({ type: 'response', parts, participant: 'dsh' });
}

/**
 * 交付物 → 每条单独一条 response，文件用 `reference` 部件（VS Code 打开器接管）。
 */
function appendDeliverables(deliverables: readonly DshHistoryDeliverable[], history: DshHistoryItem[]): void {
	for (const delivery of deliverables) {
		const parts: DshHistoryPart[] = [];
		for (const file of delivery.files) {
			parts.push({
				kind: 'reference',
				reference: file.path,
				...(file.description === undefined ? {} : { options: { status: { description: file.description, kind: 0 } } }),
			});
		}
		if (parts.length > 0) {
			history.push({ type: 'response', parts, participant: 'dsh' });
		}
	}
}

/**
 * 待决议项 → 追加到最后一条 response 的尾部。
 *
 * 为什么必须并进最后一条 response 而不是新增一条：原生 chat 把历史里恢复出来的
 * response 标记为 `isStale`（`chatModel.ts:1607`），陈旧 response 里的命令按钮会被
 * 禁用（`chatCommandContentPart.ts:31`）。待决议卡必须落在当前活跃的尾部响应上才可点。
 */
function appendPending(pending: readonly DshHistoryPending[], history: DshHistoryItem[]): void {
	if (pending.length === 0) {
		return;
	}
	const parts: DshHistoryPart[] = [];
	for (const item of pending) {
		parts.push({ kind: 'warning', content: { value: item.title } });
		if (item.kind === 'approval') {
			parts.push({
				kind: 'command',
				command: { id: 'dsh.answerApproval', title: '允许', arguments: [item.eventId, 'approve'] },
			});
			parts.push({
				kind: 'command',
				command: { id: 'dsh.answerApproval', title: '拒绝', arguments: [item.eventId, 'reject'] },
			});
		} else {
			for (const option of item.options) {
				parts.push({
					kind: 'command',
					command: { id: 'dsh.answerQuestion', title: option, arguments: [item.eventId, option] },
				});
			}
		}
	}
	const last = history[history.length - 1];
	if (last !== undefined && last.type === 'response') {
		history[history.length - 1] = { ...last, parts: [...last.parts, ...parts] };
		return;
	}
	// 没有可挂靠的 response（空会话刚发起审批）：单开一条。
	history.push({ type: 'response', parts, participant: 'dsh' });
}

function appendNode(node: DshChatNode, parts: DshHistoryPart[]): void {
	switch (node.kind) {
		case 'assistant': {
			for (const block of node.blocks) {
				if (block.kind === 'text') {
					parts.push({ kind: 'markdownContent', content: { value: block.text } });
				} else if (block.kind === 'reasoning') {
					parts.push({ kind: 'thinking', value: block.text });
				} else if (block.kind === 'tool-call') {
					parts.push({ kind: 'markdownContent', content: { value: `\`${block.name}\`` } });
				}
			}
			return;
		}
		case 'tool-call':
			parts.push({ kind: 'markdownContent', content: { value: `\`${node.name}\`` } });
			return;
		case 'tool-result': {
			const text = textOf(node.content);
			parts.push({ kind: 'markdownContent', content: { value: text === '' ? `工具 ${node.name} 已完成` : text } });
			return;
		}
		case 'command': {
			const line = [node.name ?? '', node.args ?? ''].filter(part => part !== '').join(' ');
			parts.push({ kind: 'markdownContent', content: { value: `\`/${line}\`` } });
			return;
		}
		case 'turn-error':
			parts.push({ kind: 'markdownContent', content: { value: `> 出错：${node.message}` } });
			return;
		case 'turn-max-tokens':
			parts.push({ kind: 'markdownContent', content: { value: '> 本轮达到 token 上限' } });
			return;
		case 'compaction':
			parts.push({ kind: 'markdownContent', content: { value: '> 上下文已压缩' } });
			return;
		case 'model-retry':
			parts.push({ kind: 'markdownContent', content: { value: '> 模型重试' } });
			return;
		case 'context':
			if (node.content.length > 0) {
				parts.push({ kind: 'markdownContent', content: { value: `> 上下文：${textOf(node.content)}` } });
			}
			return;
		case 'inherited-history':
			parts.push({ kind: 'markdownContent', content: { value: '> 继承自上游会话的历史' } });
			return;
		case 'subagent-catalog':
			parts.push({ kind: 'markdownContent', content: { value: `> 子智能体：${node.name ?? node.label ?? node.childId ?? ''}` } });
			return;
		default:
			return;
	}
}

/** 内容块里可读文本的拼接。 */
function textOf(content: readonly { readonly type: string }[]): string {
	const texts: string[] = [];
	for (const block of content) {
		const text = (block as { text?: unknown }).text;
		if (typeof text === 'string' && text !== '') {
			texts.push(text);
		}
	}
	return texts.join('\n');
}
