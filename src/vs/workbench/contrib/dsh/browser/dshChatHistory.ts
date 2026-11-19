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

import { isAbsolute } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import type { DshChatNode, DshToolResultNode } from './dshChatModel.js';

/**
 * 原生 chat 进度部件的窄形状：只声明本文件产出的几种。
 *
 * 只保留结构字段：真正渲染时由原生 `ChatListItemRenderer` 按 `kind` 分派，
 * 本文件不 import 渲染层，也不构造原生类（保持纯映射、可单测）。
 */
export type DshHistoryPart =
	| { readonly kind: 'markdownContent'; readonly content: { readonly value: string } }
	| { readonly kind: 'thinking'; readonly value: string }
	| { readonly kind: 'warning'; readonly content: { readonly value: string } }
	| { readonly kind: 'info'; readonly content: { readonly value: string } }
	| { readonly kind: 'reference'; readonly reference: string | URI; readonly options?: { readonly status?: { readonly description: string; readonly kind: number } } }
	| { readonly kind: 'command'; readonly command: { readonly id: string; readonly title: string; readonly arguments?: readonly unknown[] } }
	| DshProgressTaskPart
	| DshToolInvocationPart;

/**
 * 原生 `progressTaskSerialized` 的窄形状（`chatService.ts:396-400`）。
 *
 * 用于 Todo 清单：原生渲染成可收起的任务行，进度项走 `progress`。
 * 历史里没有运行态，`progress` 直接给出全部条目；`content` 是任务标题。
 */
export interface DshProgressTaskPart {
	readonly kind: 'progressTaskSerialized';
	readonly content: { readonly value: string };
	readonly progress: readonly { readonly kind: 'warning'; readonly content: { readonly value: string } }[];
}

/**
 * 原生 `toolInvocationSerialized` 的窄形状（`chatService.ts:1216-1236`）。
 *
 * 历史里没有运行中状态：序列化形态一律 `isComplete: true`。工具输入输出走
 * `toolSpecificData.kind === 'simpleToolInvocation'`，因为 `resultDetails` 只接受
 * URI / Location / 输入输出详情，塞不下 DSH 的纯文本结果。
 */
export interface DshToolInvocationPart {
	readonly kind: 'toolInvocationSerialized';
	readonly toolCallId: string;
	readonly toolId: string;
	readonly source: { readonly type: 'internal'; readonly label: string };
	readonly invocationMessage: string;
	readonly originMessage: undefined;
	readonly pastTenseMessage: string;
	readonly isComplete: true;
	readonly isConfirmed: undefined;
	readonly presentation: undefined;
	readonly toolSpecificData?: { readonly kind: 'simpleToolInvocation'; readonly input: string; readonly output: string };
	readonly resultError?: string | true;
}

/**
 * `ToolDataSource.Internal` 的原样形状（`languageModelToolsService.ts:139`）。
 *
 * 不 import 那个模块：本文件是零 UI 依赖的纯映射，单测要能在没有 workbench 服务
 * 的环境里直接跑；形状对不上时由 `dshChatHistoryNative.test.ts` 兜住。
 */
const INTERNAL_TOOL_SOURCE = { type: 'internal' as const, label: 'Built-In' };

/** 原生 `IChatResponseErrorDetails` 的窄形状（`chatService.ts:70-86`）。 */
export interface DshHistoryErrorDetails {
	readonly message: string;
	readonly code?: string;
	readonly isQuotaExceeded?: boolean;
}

/** 原生 `IChatSessionHistoryItem` 的窄形状。 */
export type DshHistoryItem =
	| { readonly type: 'request'; readonly prompt: string; readonly participant: string; readonly timestamp?: number }
	| { readonly type: 'response'; readonly parts: readonly DshHistoryPart[]; readonly participant: string; readonly errorDetails?: DshHistoryErrorDetails };

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
	/** 共享任务板；`enabled` 为 false 时只显示开关状态，不展示任务。 */
	readonly worktrees?: readonly { readonly path: string; readonly branch: string; readonly created: boolean }[];
	readonly team?: { readonly enabled: boolean; readonly tasks: readonly { readonly id: string; readonly subject: string; readonly status: string; readonly ready: boolean; readonly ownerName?: string }[]; readonly failure?: string };
	readonly quotaNotice?: { readonly code: string; readonly seq: number };
	readonly attachments?: readonly { readonly attachmentId: string; readonly name?: string; readonly mediaType: string }[];
	readonly deliverables?: readonly DshHistoryDeliverable[];
}

/** 会话状态里 extras 的最小读取面（`DshChatSession` 满足它，单测可注入假对象）。 */
export interface DshHistoryExtrasSource {
	deliverables(): readonly DshHistoryDeliverable[];
	attachments(): readonly { readonly attachmentId: string; readonly name?: string; readonly mediaType: string }[];
	quotaNotice(): { readonly code: string; readonly seq: number } | undefined;
	plan(): DshHistoryExtras['plan'];
	goal(): DshHistoryExtras['goal'];
	todos(): readonly { readonly content: string; readonly status: string }[];
	skills(): readonly { readonly name: string; readonly description: string }[];
	team(): DshHistoryExtras['team'];
	worktrees(): DshHistoryExtras['worktrees'];
}

/**
 * 把会话状态里的七项 typed extras 收成一份。
 *
 * 唯一装配入口：content provider 的两处构造历史上曾各写一遍，漏传过
 * `plan/goal/todos/skills`（手册 §9.5 的 2-A 记录的真缺陷）。下沉成纯函数后
 * 单测可以直接注入假来源，不必实例化 content provider。
 */
export function extrasOf(source: DshHistoryExtrasSource): DshHistoryExtras {
	return {
		deliverables: source.deliverables(),
		attachments: source.attachments(),
		quotaNotice: source.quotaNotice(),
		plan: source.plan(),
		goal: source.goal(),
		todos: source.todos(),
		skills: source.skills(),
		team: source.team(),
		worktrees: source.worktrees(),
	};
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
	/** 本 response 的 turn-error（渲染成原生 response 级错误，不再埋进 markdown）。 */
	let turnError: DshHistoryErrorDetails | undefined;
	/** 已经有结果的 callId：工具调用块与工具结果只画一行，避免同一调用出现两张卡。 */
	const settledCallIds = collectSettledCallIds(session.nodes());
	/**
	 * 本 response 里已经画过的 callId（含 assistant 块 / 独立 tool-call 节点 / tool-result）。
	 *
	 * `settledCallIds` 只能解决「调用 ↔ 结果」的去重；同一次调用还可能同时以
	 * assistant 内容块**和**独立 running `tool-call` 节点出现（模型层不按 callId 合并），
	 * 结果到达前会画出两张卡。这里按 response 记账，任何来源画过就不再画。
	 */
	let drawnCallIds = new Set<string>();

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
		history.push({
			type: 'response',
			parts,
			participant: pending.participant,
			...(turnError === undefined ? {} : { errorDetails: turnError }),
		});
		pending = undefined;
		parts = [];
		turnError = undefined;
		drawnCallIds = new Set<string>();
	};

	for (const node of session.nodes()) {
		if (node.kind === 'user') {
			flush();
			pending = { prompt: textOf(node.content), participant: 'dsh', timestamp: node.time };
			continue;
		}
		if (node.kind === 'steering' || node.kind === 'subagent-notice') {
			// 还没有用户消息时也要开一条 response。否则末尾 flush 因 pending 为空直接返回，这段文字被丢掉。
			if (pending === undefined) {
				pending = { prompt: '', participant: 'dsh' };
			}
			const value = node.kind === 'steering'
				? `**Steering:** ${textOf(node.content)}`
				: `> 子智能体：${textOf(node.content)}`;
			parts.push({ kind: 'markdownContent', content: { value } });
			continue;
		}
		if (node.kind === 'turn-error') {
			// 原生 response 自带 errorDetails（含 code 与配额升级入口），比 markdown 引用块准确。
			// 原生 errorDetails 只有一个对象：同一 response 内出现第二次失败时先把上一段结算掉，
			// 否则前一轮的错误会被静默覆盖（goal 续轮会产生没有用户消息分隔的连续失败 turn）。
			if (turnError !== undefined) {
				flush();
			}
			if (pending === undefined) {
				pending = { prompt: '', participant: 'dsh' };
			}
			turnError = { message: node.message, ...(node.code === undefined ? {} : { code: node.code }) };
			continue;
		}
		if (pending === undefined) {
			// 没有前置用户消息的内容（例如 fork 继承历史）：开一条内容行。
			pending = { prompt: '', participant: 'dsh' };
		}
		appendNode(node, parts, settledCallIds, drawnCallIds);
	}
	flush();
	// 配额提示是「本回合」的 response 级状态：必须在追加交付物 / extras / pending 之前落到
	// 对话的末尾 response 上，否则会挂到 appendDeliverables 新开的那条（不带 prompt 的）行上。
	applyQuotaNotice(extras.quotaNotice, history);
	appendDeliverables(extras.deliverables ?? [], history);
	appendExtras(extras, history);
	appendPending(pendingItems, history);
	return history;
}

/** 收集所有已有工具结果（含子调用）的 callId。 */
function collectSettledCallIds(nodes: readonly DshChatNode[]): ReadonlySet<string> {
	const settled = new Set<string>();
	const visit = (node: DshChatNode) => {
		if (node.kind === 'tool-result') {
			settled.add(node.callId);
			for (const child of node.subCalls) {
				visit(child);
			}
			return;
		}
		if (node.kind === 'tool-call') {
			for (const child of node.subCalls ?? []) {
				visit(child);
			}
		}
	};
	for (const node of nodes) {
		visit(node);
	}
	return settled;
}

/**
 * 额度提示 → 最后一条**对话** response 的 `errorDetails.isQuotaExceeded`。
 *
 * 原生错误详情带配额升级入口；继续用 warning 会把可操作的配额问题降级成一条普通告警。
 * 两条边界：
 *   - 交付物行是独立追加的 response，配额不是它的错误，不能挂到那一行；
 *   - 已有非配额 errorDetails（真实 turn-error）时只追加 warning，不覆盖真实错误码。
 */
function applyQuotaNotice(quotaNotice: DshHistoryExtras['quotaNotice'], history: DshHistoryItem[]): void {
	if (quotaNotice === undefined) {
		return;
	}
	const message = `额度不足（${quotaNotice.code}），请检查账号额度。`;
	// 交付物行不带 prompt，这里用「结构上由 appendDeliverables 追加的行」无法区分，
	// 因此只在末尾 response 没有 errorDetails 时把配额写进去；否则降级为 warning 部件。
	const last = history[history.length - 1];
	if (last !== undefined && last.type === 'response' && last.errorDetails === undefined) {
		history[history.length - 1] = { ...last, errorDetails: { message, isQuotaExceeded: true } };
		return;
	}
	if (last !== undefined && last.type === 'response' && last.errorDetails?.isQuotaExceeded === true) {
		return;
	}
	if (last !== undefined && last.type === 'response') {
		history[history.length - 1] = { ...last, parts: [...last.parts, { kind: 'warning', content: { value: message } }] };
		return;
	}
	history.push({ type: 'response', parts: [], participant: 'dsh', errorDetails: { message, isQuotaExceeded: true } });
}

/**
 * 计划 / 目标 / Todo / Skill / 附件 → 追加到最后一条 response（没有就单开）。
 *
 * 这些是快照级状态，不属于某一条消息；放在尾部保证用户一眼能看到当前进度与提醒。
 * 额度提示不在这里：它是 response 级 `errorDetails.isQuotaExceeded`（见 `applyQuotaNotice`）。
 */
function appendExtras(extras: DshHistoryExtras, history: DshHistoryItem[]): void {
	const parts: DshHistoryPart[] = [];
	const push = (part: DshHistoryPart) => parts.push(part);

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
		// Todo 用原生任务行承接：标题给出完成数，逐项进 progress，保持可收起。
		const done = extras.todos.filter(todo => todo.status === 'completed').length;
		push({
			kind: 'progressTaskSerialized',
			content: { value: `待办 ${done}/${extras.todos.length}` },
			progress: extras.todos.map(todo => {
				const mark = todo.status === 'completed' ? '[x]' : todo.status === 'in_progress' ? '[-]' : '[ ]';
				return { kind: 'warning' as const, content: { value: `${mark} ${todo.content}` } };
			}),
		});
	}
	if (extras.skills !== undefined && extras.skills.length > 0) {
		push({ kind: 'info', content: { value: `可用技能：${extras.skills.map(skill => skill.name).join('、')}` } });
	}
	if (extras.worktrees !== undefined && extras.worktrees.length > 0) {
		push({ kind: 'info', content: { value: `工作树 ${extras.worktrees.length} 个：${extras.worktrees.map(worktree => `${worktree.branch}${worktree.created ? '' : '（继承）'}`).join('、')}` } });
	}
	if (extras.team !== undefined && extras.team.tasks.length > 0) {
		const done = extras.team.tasks.filter(task => task.status === 'completed').length;
		push({
			kind: 'progressTaskSerialized',
			content: { value: `共享任务 ${done}/${extras.team.tasks.length}` },
			progress: extras.team.tasks.map(task => ({
				kind: 'warning' as const,
				content: { value: `[${task.status}] ${task.subject}${task.ownerName === undefined ? '' : `（${task.ownerName}）`}` },
			})),
		});
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
				reference: deliverableReference(file.path),
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
/** 绝对路径才能交给原生打开器。相对路径留成字符串，避免编成残缺的 file URI。 */
function deliverableReference(filePath: string): string | URI {
	if (filePath === '' || !isAbsolute(filePath)) {
		return filePath;
	}
	return URI.file(filePath);
}

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

function appendNode(node: DshChatNode, parts: DshHistoryPart[], settledCallIds: ReadonlySet<string>, drawnCallIds: Set<string>): void {
	switch (node.kind) {
		case 'assistant': {
			for (const block of node.blocks) {
				if (block.kind === 'text') {
					parts.push({ kind: 'markdownContent', content: { value: block.text } });
				} else if (block.kind === 'reasoning') {
					parts.push({ kind: 'thinking', value: block.text });
				} else if (block.kind === 'tool-call') {
					// 已经有结果的调用由 tool-result 节点画成完整工具卡；同一 response 内任何来源
					// 画过一次就不再画（running 阶段 assistant 块与独立节点会同时存在）。
					if (!settledCallIds.has(block.callId) && !drawnCallIds.has(block.callId)) {
						drawnCallIds.add(block.callId);
						parts.push(toolInvocationOf(block.callId, block.name, block.argsRaw, undefined));
					}
				}
			}
			return;
		}
		case 'tool-call':
			if (!settledCallIds.has(node.callId) && !drawnCallIds.has(node.callId)) {
				drawnCallIds.add(node.callId);
				parts.push(toolInvocationOf(node.callId, node.name, argsTextOf(node.argsRaw, node.args), undefined));
			}
			return;
		case 'tool-result':
			drawnCallIds.add(node.callId);
			// 官方 `ToolResultNode.name` 允许空串（配对调用不在加载窗口内）；
			// 此时官方卡片头部显示 callId（`records.ts:167` 的注释：「card head shows callId」）。
			parts.push(toolInvocationOf(node.callId, node.name === '' ? node.callId : node.name, argsTextOf(node.call?.argsRaw, node.args), node));
			for (const child of node.subCalls) {
				appendNode(child, parts, settledCallIds, drawnCallIds);
			}
			return;
		case 'command': {
			const line = [node.name ?? '', node.args ?? ''].filter(part => part !== '').join(' ');
			parts.push({ kind: 'markdownContent', content: { value: `\`/${line}\`` } });
			return;
		}
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

/**
 * 一条工具调用 → 原生 `toolInvocationSerialized`。
 *
 * 历史没有运行中状态，一律 `isComplete: true`；输入输出塞进 `simpleToolInvocation`
 * （`resultDetails` 只收 URI / Location / 输入输出详情，放不下纯文本）。
 */
function toolInvocationOf(callId: string, name: string, input: string, result: DshToolResultNode | undefined): DshToolInvocationPart {
	const output = result === undefined ? '' : textOf(result.content);
	return {
		kind: 'toolInvocationSerialized',
		toolCallId: callId,
		toolId: name,
		source: INTERNAL_TOOL_SOURCE,
		invocationMessage: name,
		originMessage: undefined,
		pastTenseMessage: result !== undefined && result.isError ? `${name} 失败` : `${name} 完成`,
		isComplete: true,
		isConfirmed: undefined,
		presentation: undefined,
		...(input === '' && output === ''
			? {}
			: { toolSpecificData: { kind: 'simpleToolInvocation' as const, input, output } }),
		...(result?.isError === true ? { resultError: result.error?.reason ?? result.error?.code ?? true } : {}),
	};
}

/** 工具参数文本：优先用原始 JSON 字符串，否则把已解析的 args 序列化。 */
function argsTextOf(argsRaw: string | undefined, args: unknown): string {
	if (typeof argsRaw === 'string' && argsRaw !== '') {
		return argsRaw;
	}
	if (args === undefined) {
		return '';
	}
	try {
		return JSON.stringify(args);
	} catch {
		return '';
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
