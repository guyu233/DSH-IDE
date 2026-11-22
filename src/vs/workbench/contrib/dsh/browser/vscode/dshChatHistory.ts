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

import { localize } from '../../../../../nls.js';
import { isAbsolute } from '../../../../../base/common/path.js';
import { URI } from '../../../../../base/common/uri.js';
import type { DshChatNode, DshToolResultNode } from './dshChatModel.js';
import { questionUsesSingleClick } from './dshPendingSettlement.js';

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
	| { readonly kind: 'reference'; readonly reference: string | URI; readonly options?: { readonly status?: { readonly description: string; readonly kind: number } } }
	| { readonly kind: 'command'; readonly command: { readonly id: string; readonly title: string; readonly arguments?: readonly unknown[] } }
	| DshToolInvocationPart
	| DshProgressTaskPart;

/**
 * 一条工具调用 → 原生 `toolInvocationSerialized` 的形状。
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
 * `ToolDataSource.Internal` 的原样形状（`languageModelToolsService.ts:139`）。
 *
 * 不 import 那个模块：本文件是零 UI 依赖的纯映射，单测要能在没有 workbench 服务
 * 的环境里直接跑；形状对不上时由 `dshChatHistoryNative.test.ts` 兜住。
 */

/** 原生 `IChatResponseErrorDetails` 的窄形状（`chatService.ts:70-86`）。 */
export interface DshHistoryErrorDetails {
	readonly message: string;
	readonly code?: string;
	readonly isQuotaExceeded?: boolean;
}

/** 原生 `IChatSessionHistoryItem` 的窄形状。 */
export type DshHistoryItem =
	/**
	 * `id` 是稳定的原生 request 标识（契约 §19 S3）：原生 restorer 用它在刷新时
	 * 原地更新同一条 request，而不是 remove/add。优先取 DSH `messageId`；没有时
	 * 用 `turn + seq` 派生。禁止用时间戳或随机数。
	 */
	| { readonly type: 'request'; readonly id?: string; readonly prompt: string; readonly participant: string; readonly timestamp?: number }
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
	readonly questions?: readonly {
		readonly id: string;
		readonly question?: string;
		readonly multiSelect: boolean;
		readonly options: readonly { readonly label: string }[];
		readonly intent?: { readonly kind: string };
	}[];
}

/** 交付物：官方 `deliverables/presented` 的投影。 */
export interface DshHistoryDeliverable {
	readonly turn: number;
	readonly callId: string;
	readonly files: readonly { readonly path: string; readonly description?: string }[];
}

/** 计划 / 目标 / Todo / Skill / 额度提示：来自快照 typed 字段。 */
export interface DshHistoryExtras {
	/** 附件所属会话：构造只读附件 URI 时必须带会话身份（Host 会核对归属）。 */
	readonly sessionId?: string;
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
	readonly activeSessionId: string | undefined;
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
		sessionId: source.activeSessionId,
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
 * extras 的内容指纹：用于判断「这一帧有没有改变 history 尾部」。
 *
 * 逐条取**会显示**的字段（内容而不是条数）：只记长度的话，同一位置换内容时
 * 界面会停在旧文案（契约 §19 S4）。不整体 `JSON.stringify`——那会把不参与渲染的
 * 内部字段也算进来，且字段顺序一变就误触发重建。分隔符用控制字符，正常文案里不会出现。
 */
export function extrasFingerprint(extras: DshHistoryExtras): string {
	const goal = extras.goal?.goal;
	const plan = extras.plan;
	const team = extras.team;
	return [
		extras.sessionId ?? '',
		goal === undefined ? '' : `${goal.objective}|${goal.phase}|${extras.goal?.roundsStarted ?? 0}`,
		plan === undefined ? '' : `${plan.active ? 'a' : ''}${plan.pending ? 'p' : ''}`,
		// 逐条取会显示的字段：只记条数的话，同一位置换了内容（待办改文案、
		// 目标从「进行中」变「已完成」、技能列表替换）界面会停在旧文本。
		(extras.todos ?? []).map(todo => `${todo.status}\u0001${todo.content}`).join('\u0002'),
		(extras.skills ?? []).map(skill => skill.name).join('\u0002'),
		(extras.deliverables ?? []).map(delivery => `${delivery.turn}\u0001${delivery.callId}\u0001${delivery.files.map(file => `${file.path}\u0003${file.description ?? ''}`).join('\u0003')}`).join('\u0002'),
		(extras.attachments ?? []).map(attachment => `${attachment.attachmentId}\u0001${attachment.name ?? ''}\u0001${attachment.mediaType}`).join('\u0002'),
		(extras.worktrees ?? []).map(worktree => `${worktree.branch}\u0001${worktree.created ? '1' : '0'}`).join('\u0002'),
		team === undefined ? '' : `${team.enabled === true ? '1' : '0'}\u0001${team.failure ?? ''}\u0001${team.tasks.map(task => `${task.id}\u0001${task.subject}\u0001${task.status}\u0001${task.ready ? '1' : '0'}\u0001${task.ownerName ?? ''}`).join('\u0002')}`,
		extras.quotaNotice === undefined ? '' : `${extras.quotaNotice.code}\u0001${extras.quotaNotice.seq}`,
	].join('|');
}

/**
 * 原生 request 的稳定标识（契约 §19 S3）。
 *
 * 优先 DSH `messageId`（会话内唯一且跨帧稳定）；没有时用 `turn + seq` 派生。
 * 同一节点每次重建都必须得到同一个 id，因此不能带时间戳、随机数或数组下标。
 */
export function dshRequestId(node: { readonly kind: string; readonly seq: number; readonly messageId?: string; readonly turn?: number }): string {
	if (node.messageId !== undefined && node.messageId !== '') {
		return `dsh:${node.messageId}`;
	}
	return `dsh:${node.turn ?? ''}:${node.seq}`;
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
	let pending: { id?: string; prompt: string; participant: string; timestamp?: number } | undefined;
	let parts: DshHistoryPart[] = [];
	/** 本 response 的 turn-error（渲染成原生 response 级错误，不再埋进 markdown）。 */
	let turnError: DshHistoryErrorDetails | undefined;
	const nodes = session.nodes();
	/** 已经有结果的 callId：工具调用块与工具结果只画一行，避免同一调用出现两张卡。 */
	const settledCallIds = collectSettledCallIds(nodes);
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
			...(pending.id === undefined ? {} : { id: pending.id }),
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
		drawnCallIds = new Set<string>();
		turnError = undefined;
	};

	for (const node of nodes) {
		if (node.kind === 'user') {
			flush();
			pending = { id: dshRequestId(node), prompt: textWithFiles(node.content), participant: 'dsh', timestamp: node.time };
			// 用户消息的图片**不**在这里出 reference：该节点会进本段 slot host，
			// 由 `dshImageGallery` 画（官方只有一个 `conversation.chat.user.images` 席位）。
			// 两边都画的话，同一张图会显示两次。
			continue;
		}
		if (node.kind === 'steering') {
			// 还没有用户消息时也要开一条 response。否则末尾 flush 因 pending 为空直接返回，这段文字被丢掉。
			if (pending === undefined) {
				pending = { id: dshRequestId(node), prompt: '', participant: 'dsh' };
			}
			continue;
		}
		if (node.kind === 'turn-trigger') {
			// 标题由 adaptDshNode 的 dshTurnTrigger 画。这里只保证没有用户消息时也有一条 response。
			if (pending === undefined) {
				pending = { id: dshRequestId(node), prompt: '', participant: 'dsh' };
			}
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
				pending = { id: dshRequestId(node), prompt: '', participant: 'dsh' };
			}
			turnError = { message: node.message, ...(node.code === undefined ? {} : { code: node.code }) };
			continue;
		}
		if (pending === undefined) {
			// 没有前置用户消息的内容（例如 fork 继承历史）：开一条内容行。
			pending = { id: dshRequestId(node), prompt: '', participant: 'dsh' };
		}
		appendNode(node, parts, settledCallIds, drawnCallIds, extras.sessionId);
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
	const message = localize('dsh.history.quotaExceeded', "Quota exhausted ({0}); check your account quota.", quotaNotice.code);
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
/**
 * 目标阶段 → 中文标签。
 *
 * 契约里是  /  /  /  四值枚举；直接拼进中文句子
 * 会让用户看到英文原词。未知值原样显示，不猜含义。
 */
function goalPhaseText(phase: string): string {
	switch (phase) {
		case 'active': return localize('dsh.history.goalActive', "In progress");
		case 'paused': return localize('dsh.history.goalPaused', "Paused");
		case 'blocked': return localize('dsh.history.goalBlocked', "Blocked");
		case 'complete': return localize('dsh.history.goalComplete', "Completed");
		default: return phase;
	}
}

/**
 * 共享任务状态 → 中文标签。
 *
 * 契约里 `status` 只要求非空字符串（官方任务板状态会随版本增加），所以这里只翻
 * 已知的三种，其余原样显示——猜一个中文词比露出原词更容易误导。
 */
function taskStatusText(status: string): string {
	switch (status) {
		case 'pending': return localize('dsh.history.taskPending', "Pending");
		case 'in_progress': return localize('dsh.history.taskInProgress', "In progress");
		case 'completed': return localize('dsh.history.taskCompleted', "Completed");
		default: return status;
	}
}

function snapshotTask(value: string, lines: readonly string[] = []): DshHistoryPart {
	return {
		kind: 'progressTaskSerialized',
		content: { value },
		progress: lines.filter(line => line !== '').map(line => ({ kind: 'warning' as const, content: { value: line } })),
	};
}

function appendExtras(extras: DshHistoryExtras, history: DshHistoryItem[]): void {
	const parts: DshHistoryPart[] = [];
	const push = (part: DshHistoryPart) => parts.push(part);

	if (extras.plan !== undefined) {
		const state = extras.plan.active
			? (extras.plan.pending ? localize('dsh.history.planPending', "Plan mode (waiting for confirmation)") : localize('dsh.history.planActive', "Plan mode is on"))
			: localize('dsh.history.planOff', "Plan mode is off");
		push(snapshotTask(state));
	}
	if (extras.goal !== undefined) {
		const phase = goalPhaseText(extras.goal.goal.phase);
		push(snapshotTask(localize('dsh.history.goal', "Goal: {0} ({1}, {2} rounds so far)", extras.goal.goal.objective, phase, extras.goal.roundsStarted)));
	}
	// 下列数组的元素都来自 Host：`filter` 掉 null / 非对象，避免渲染期抛错
	// （这些 getter 的返回值最终由原生面板在 rebuild 时消费，那里没有 try/catch）。
	const todos = asObjects(extras.todos);
	if (todos.length > 0) {
		// Todo 用原生任务行承接：标题给出完成数，逐项进 progress，保持可收起。
		const done = todos.filter(todo => todo.status === 'completed').length;
		push({
			kind: 'progressTaskSerialized',
			content: { value: localize('dsh.history.todos', "Todos {0}/{1}", done, todos.length) },
			progress: todos.map(todo => {
				const mark = todo.status === 'completed' ? '[x]' : todo.status === 'in_progress' ? '[-]' : '[ ]';
				return { kind: 'warning' as const, content: { value: `${mark} ${String(todo.content ?? '')}` } };
			}),
		});
	}
	const skills = asObjects(extras.skills);
	if (skills.length > 0) {
		push(snapshotTask(
			localize('dsh.history.skills', "Available skills: {0}", skills.map(skill => String(skill.name ?? '')).join('、')),
			skills.map(skill => String(skill.name ?? '')),
		));
	}
	const worktrees = asObjects(extras.worktrees);
	if (worktrees.length > 0) {
		push(snapshotTask(
			localize('dsh.history.worktrees', "Worktrees: {0} — {1}", worktrees.length, worktrees.map(worktree => `${String(worktree.branch ?? '')}${worktree.created ? '' : ` ${localize('dsh.history.worktreeInherited', "(inherited)")}`}`).join(', ')),
			worktrees.map(worktree => String(worktree.branch ?? '')),
		));
	}
	// 团队关闭时不该列出任务：那些任务是上一次开启时的残留，画出来会让用户以为还开着。
	// 设置失败也要说明，否则开关看起来生效了、实际没写进内核。
	const team = extras.team;
	if (team !== undefined) {
		if (team.enabled !== true) {
			push(snapshotTask(localize('dsh.history.teamOff', "Shared tasks are off")));
		} else {
			const teamTasks = asObjects(team.tasks);
			if (teamTasks.length > 0) {
				const done = teamTasks.filter(task => task.status === 'completed').length;
				push({
					kind: 'progressTaskSerialized',
					content: { value: localize('dsh.history.teamTasks', "Shared tasks {0}/{1}", done, teamTasks.length) },
					progress: teamTasks.map(task => ({
						kind: 'warning' as const,
						content: { value: `[${taskStatusText(String(task.status ?? ''))}] ${String(task.subject ?? '')}${task.ownerName === undefined ? '' : `（${String(task.ownerName)}）`}` },
					})),
				});
			}
		}
		if (typeof team.failure === 'string' && team.failure !== '') {
			push({ kind: 'warning', content: { value: localize('dsh.history.teamFailed', "Shared task setup failed: {0}", team.failure) } });
		}
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
		const questions = item.questions ?? [];
		const lines = questions.map(question => {
			const head = question.question || question.id;
			const labels = question.options.map(option => option.label).filter(label => label !== '').join(', ');
			return labels === '' ? head : `${head}: ${labels}`;
		});
		parts.push(snapshotTask(item.title, lines));
		if (item.kind === 'approval') {
			parts.push({
				kind: 'command',
				command: { id: 'dsh.answerApproval', title: localize('dsh.history.allow', "Allow"), arguments: [item.eventId, 'approve'] },
			});
			parts.push({
				kind: 'command',
				command: { id: 'dsh.answerApproval', title: localize('dsh.history.reject', "Reject"), arguments: [item.eventId, 'reject'] },
			});
			continue;
		}
		const only = questions[0];
		const labels = questions.length === 0
			? item.options
			: (only !== undefined && questionUsesSingleClick(questions) ? only.options.map(option => option.label) : []);
		for (const option of labels) {
			parts.push({
				kind: 'command',
				command: { id: 'dsh.answerQuestion', title: option, arguments: [item.eventId, option] },
			});
		}
		// 官方 `conversation.plan-review.actions` 的 discuss：结束审阅并回到输入框。
		const planReview = questions.some(question => question.intent?.kind === 'plan-review');
		if (planReview) {
			parts.push({
				kind: 'command',
				command: { id: 'dsh.discussQuestion', title: localize('dsh.history.discuss', "Discuss"), arguments: [item.eventId] },
			});
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

/** `ToolDataSource.Internal` 的原样形状（`languageModelToolsService.ts:139`）。 */
const INTERNAL_TOOL_SOURCE = { type: 'internal' as const, label: 'Built-In' };
/** 收集所有已有工具结果（含子调用）的 callId。 */
function collectSettledCallIds(nodes: readonly DshChatNode[]): ReadonlySet<string> {
	const settled = new Set<string>();
	const visit = (node: DshChatNode): void => {
		if (node.kind === 'tool-result') {
			settled.add(node.callId);
			for (const child of node.subCalls) {
				visit(child);
			}
			return;
		}
		if (node.kind === 'assistant') {
			for (const block of node.blocks) {
				if (block.kind === 'tool-call') {
					// assistant 块里的调用不算「已有结果」。
					continue;
				}
			}
		}
	};
	for (const node of nodes) {
		visit(node);
	}
	return settled;
}

/** 工具错误 → `resultError`：有名字/码/原因就拼起来，否则 `true`。 */
function toolErrorText(error: { readonly name?: string; readonly code?: string; readonly reason?: string } | undefined): string | true {
	const parts = [error?.name, error?.code, error?.reason].filter((part): part is string => typeof part === 'string' && part !== '');
	return parts.length === 0 ? true : parts.join(': ');
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
		pastTenseMessage: name,
		isComplete: true,
		isConfirmed: undefined,
		presentation: undefined,
		toolSpecificData: { kind: 'simpleToolInvocation', input, output },
		...(result?.isError === true ? { resultError: toolErrorText(result.error) } : {}),
	};
}

/** 参数文本：优先原始 JSON 字符串，否则把已解析的 args 序列化。 */
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

/** 把一个节点折进当前 response 的 parts；已由 slot host 画的节点直接跳过。 */
function appendNode(node: DshChatNode, parts: DshHistoryPart[], settledCallIds: ReadonlySet<string>, drawnCallIds: Set<string>, sessionId: string | undefined): void {
	switch (node.kind) {
		case 'assistant': {
			for (const block of node.blocks) {
				if (block.kind === 'text') {
					parts.push({ kind: 'markdownContent', content: { value: block.text } });
				} else if (block.kind === 'reasoning') {
					parts.push({ kind: 'thinking', value: block.text });
				} else if (block.kind === 'image') {
					// 助手块里的图片由 slot host 的 `dshImageGallery` 画，history 不再重复引用。
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
				appendNode(child, parts, settledCallIds, drawnCallIds, sessionId);
			}
			return;
		case 'command':
		case 'turn-max-tokens':
		case 'compaction':
		case 'model-retry':
		case 'inherited-history':
			// 这些节点由 dshSlotHost 的 adaptDshNode 画成结构化卡，不再塞 markdown 引用块。
			return;
		case 'context':
			// 上下文节点的图片同样由 slot host 的画廊画，history 不重复引用。
			return;
		default:
			return;
	}
}




/** 文本加上同一内容里的文件名和图片标签。都没有时与 `textOf` 相同。 */
/**
 * 用户气泡的 prompt 文本。
 *
 * 附件（图片/文件）由该段 slot host 的画廊与文件卡渲染，**不再**拼进正文——
 * 拼进去就是「用文本模拟附件」，而且没有名字时会露出 `att-1` 这种内部 id。
 * 唯一的例外是正文为空：原生 request 需要非空 prompt，否则整条消息连同附件一起消失，
 * 这时才退回附件名当作占位。
 */
function textWithFiles(content: readonly { readonly type: string }[]): string {
	const texts: string[] = [];
	const fallbackLabels: string[] = [];
	for (const block of content) {
		if (typeof block !== 'object' || block === null) {
			continue;
		}
		const record = block as { type?: unknown; kind?: unknown; text?: unknown; attachment?: unknown };
		if (typeof record.text === 'string' && record.text !== '') {
			texts.push(record.text);
			continue;
		}
		if (record.type === 'file') {
			const name = fileNameOf(record.attachment);
			if (name !== undefined) {
				fallbackLabels.push(name);
			}
			continue;
		}
		if (record.type === 'image' || record.kind === 'image') {
			const label = imageLabelOf(record.attachment);
			if (label !== '') {
				fallbackLabels.push(label);
			}
		}
	}
	const text = texts.join('\n');
	return text === '' ? fallbackLabels.join('\n') : text;
}

/** 文件附件的可读名；没有名字时退回 attachmentId。 */
function fileNameOf(attachment: unknown): string | undefined {
	if (typeof attachment !== 'object' || attachment === null) {
		return undefined;
	}
	const ref = attachment as { name?: unknown; attachmentId?: unknown };
	if (typeof ref.name === 'string' && ref.name !== '') {
		return ref.name;
	}
	return typeof ref.attachmentId === 'string' && ref.attachmentId !== '' ? ref.attachmentId : undefined;
}

/** 图片气泡只留名字或 id，不再加 Image: 前缀。都没有时返回空串。 */
function imageLabelOf(attachment: unknown): string {
	if (typeof attachment !== 'object' || attachment === null) {
		return '';
	}
	const ref = attachment as { name?: unknown; attachmentId?: unknown };
	if (typeof ref.name === 'string' && ref.name !== '') {
		return ref.name;
	}
	return typeof ref.attachmentId === 'string' ? ref.attachmentId : '';
}


/**
 * 把来源数组收敛成「只含非 null 对象」的数组。
 *
 * 这些字段跨进程而来，运行时可能是任何东西（`undefined` 已由调用方判空）。
 * 统一在这里过滤，避免每个消费点各写一遍 `filter`。
 */
function asObjects<T>(value: readonly T[] | undefined): readonly Record<string, unknown>[] {
	return Array.isArray(value)
		? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
		: [];
}
