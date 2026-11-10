/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P2：DSH → 中立 IdeEvent translator（插件侧 common 层）。
//
// 平移自 e:/dsh-TUI/src/dsh-adapter/backend/translate.ts 的 dshEmits() 穷举 switch
// （translate.ts:63-129）与「DSH 私有知识全部留在 translator、投影器只见中立事件」的边界。
// 本模块自包含：不 import @deepseek-ai/*、不 require 官方运行时包、不接收 Cordis Context、
// 不直连 electron。运行时只做结构窄化，丢弃 DSH 私有 payload（token / tools registry /
// attachments / usage 私有形状等），只保留中立 DTO 字段。

/** 行类别（中立，供投影器决定 row kind）。 */
export type IdeRowKind = 'user' | 'assistant' | 'tool' | 'system' | 'notice';

/**
 * DSH Agent Domain 事件类型的封闭联合。新增事件类型时 `dshEmits()` 的
 * `never` 收口会让 tsc 报错，迫使适配层显式决定「emit / 不 emit」。
 */
export type IdeEventType =
	// translator 负责翻译（true）
	| 'session.title' | 'session.color' | 'session.cwd' | 'session.status'
	| 'turn.start' | 'turn.end' | 'step.start' | 'step.end'
	| 'user.message' | 'pending.changed'
	| 'assistant.attempt.start' | 'assistant.delta' | 'assistant.attempt.end' | 'assistant.message'
	| 'tool.call' | 'tool.result'
	| 'task.start' | 'task.output'
	| 'compaction.start' | 'compaction.progress' | 'compaction.end'
	| 'context.capacity' | 'goal.change' | 'todo.write' | 'preset.selected'
	| 'system.prompt' | 'request.header' | 'custom'
	// 由别处持有 / 非 DSH 概念（false）
	| 'agent.message' | 'session.ready' | 'session.reset'
	| 'tool.progress' | 'tool.output'
	| 'permission.request' | 'permission.settled'
	| 'question.request' | 'question.settled'
	| 'subagent.start' | 'subagent.progress' | 'subagent.end'
	| 'task.update' | 'task.end' | 'tasks.snapshot'
	| 'usage' | 'context.usage'
	| 'model.changed' | 'effort.changed' | 'mode.changed' | 'commands.changed'
	| 'notice' | 'rate-limit';

/**
 * 中立事件：投影器唯一可见的形状。所有字段可选但显式 undefined 一律省略。
 *
 * `attemptId` / `streamRevision` 只出现在**瞬时流帧**（`agent/assistant-stream`）翻译出的事件上：
 * 瞬时帧没有会话 `seq`（它不进日志），因此幂等必须按「同一 attempt 的 revision 单调」判定，
 * 不能借用会话序号。两个字段同时缺省即表示这是**durable 日志事件**，按 `seq` 幂等。
 * 这与 dsh-TUI 的 `AgentEvent`（`attemptId` + `revision`）同一口径，不是新约定。
 */
export interface IdeEvent {
	readonly type: IdeEventType;
	readonly seq: number;
	readonly callId?: string;
	readonly turn?: number;
	readonly step?: number;
	readonly text?: string;
	readonly title?: string;
	readonly kind?: IdeRowKind;
	readonly streaming?: boolean;
	/** 瞬时流帧所属的 attempt；缺席＝durable 事件。 */
	readonly attemptId?: string;
	/** 瞬时流帧的 attempt 内 revision；用来丢弃重连重放的同一条 chunk。 */
	readonly streamRevision?: number;
	/**
	 * 只有 `assistant.attempt.end` 带：该 attempt 的结局。
	 *
	 * `abandoned` 表示这次尝试没有落成可见消息（流错误、重试、取消，或结算为
	 * `assistant/attempt`），投影器必须丢弃它留下的临时行；`committed` 表示已有
	 * durable 结算（`assistant/message` 或 `assistant/attempt`）接着到达。
	 * 与 dsh-TUI `assistant.attempt.end` 的 `outcome` 同一口径。
	 */
	readonly outcome?: 'committed' | 'abandoned';
}

/** translator 只接受纯对象（结构窄化，不引用 DSH 包类型），逐字段白名单拷贝。 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 真实 DSH 会话事件的线上类型名（斜杠命名）→ 中立 `IdeEventType`（点号命名）。
 *
 * 依据 `E:/deepseek-harness-0.2.2-rc.1/packages/core/session/src/types.ts:SessionEventMap`：
 * 真实事件形如 `{ type: 'user/message', seq, time, data: {...} }`，与 dsh-TUI 抽象出来的点号
 * 名字不是同一套。两边都收，避免适配层再复制一份映射。
 */
const DSH_WIRE_EVENT_TYPES: Readonly<Record<string, IdeEventType>> = {
	'turn/start': 'turn.start',
	'turn/end': 'turn.end',
	'step/start': 'step.start',
	'step/end': 'step.end',
	'user/message': 'user.message',
	'system/message': 'system.prompt',
	'assistant/message': 'assistant.message',
	'assistant/attempt': 'assistant.attempt.end',
	'tool/call': 'tool.call',
	'tool/result': 'tool.result',
	'request/header': 'request.header',
	'request/context': 'context.capacity',
	'session/title': 'session.title',
	'goal/change': 'goal.change',
	'compaction/start': 'compaction.start',
	'compaction/end': 'compaction.end',
};

/** 真实 DSH 事件的线上类型名；不是线上名时返回 undefined。 */
export function wireEventType(raw: string): IdeEventType | undefined {
	return DSH_WIRE_EVENT_TYPES[raw];
}

/** 把内容块数组或纯字符串统一成投影用的文本（多段文本按出现顺序拼接）。 */
function textOfContent(value: unknown): string | undefined {
	if (typeof value === 'string') {
		return value;
	}
	if (!Array.isArray(value)) {
		return undefined;
	}
	const parts: string[] = [];
	for (const block of value) {
		if (isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string') {
			parts.push(block['text']);
		}
	}
	return parts.length === 0 ? undefined : parts.join('');
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function safeInteger(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

/**
 * DSH 后端对每种事件类型的决定：本 translator 是否 emit 它。
 * 穷举 switch 是关键：新增 `IdeEventType` 成员时 `const unhandled: never = type`
 * 会导致 tsc 报错，直到适配层分类完毕。
 */
export function dshEmits(type: IdeEventType): boolean {
	switch (type) {
		case 'session.title':
		case 'session.color':
		case 'session.cwd':
		case 'session.status':
		case 'turn.start':
		case 'turn.end':
		case 'step.start':
		case 'step.end':
		case 'user.message':
		case 'pending.changed':
		case 'assistant.attempt.start':
		case 'assistant.delta':
		case 'assistant.attempt.end':
		case 'assistant.message':
		case 'tool.call':
		case 'tool.result':
		case 'task.start':
		case 'task.output':
		case 'compaction.start':
		case 'compaction.progress':
		case 'compaction.end':
		case 'context.capacity':
		case 'goal.change':
		case 'todo.write':
		case 'preset.selected':
		case 'system.prompt':
		case 'request.header':
		case 'custom':
			return true;
		// Owned elsewhere on DSH (subagent/job extensions, approval and question
		// stores, model/mode actions) or not a DSH concept.
		case 'agent.message':
		case 'session.ready':
		case 'session.reset':
		case 'tool.progress':
		case 'tool.output':
		case 'permission.request':
		case 'permission.settled':
		case 'question.request':
		case 'question.settled':
		case 'subagent.start':
		case 'subagent.progress':
		case 'subagent.end':
		case 'task.update':
		case 'task.end':
		case 'tasks.snapshot':
		case 'usage':
		case 'context.usage':
		case 'model.changed':
		case 'effort.changed':
		case 'mode.changed':
		case 'commands.changed':
		case 'notice':
		case 'rate-limit':
			return false;
		default: {
			// Exhaustiveness: a new AgentEvent variant must be classified above.
			const unhandled: never = type;
			return unhandled;
		}
	}
}

function rowKindOf(type: IdeEventType): IdeRowKind | undefined {
	if (type === 'user.message') {
		return 'user';
	}
	if (type.startsWith('assistant.')) {
		return 'assistant';
	}
	if (type.startsWith('tool.')) {
		return 'tool';
	}
	if (type === 'task.start' || type === 'task.output' || type === 'system.prompt' || type === 'custom') {
		return 'system';
	}
	return undefined;
}

/**
 * 把一条 DSH 原始事件翻译为中立 IdeEvent。
 * - 结构不合、类型不在联合内、或 `dshEmits()` 判定不 emit → 返回 undefined（丢弃）。
 * - 未知事件类型会走 dshEmits 的 default，返回非 boolean 值；`!== true` 判定将其丢弃，
 *   避免运行时输入越界污染投影器。
 * - 只拷贝白名单中立字段，DSH 私有 payload 一律不透传。
 */
export function translateDshEvent(raw: unknown, fallbackSeq: number): IdeEvent | undefined {
	if (!isRecord(raw) || typeof raw['type'] !== 'string') {
		return undefined;
	}
	const wire = raw['type'];
	const type = wireEventType(wire) ?? (wire as IdeEventType);
	if (dshEmits(type) !== true) {
		return undefined;
	}
	// 真实 DSH 事件把所有载荷放在 `data` 下；dsh-TUI 的抽象事件把字段平铺。
	// 两种形状都要能读，且只取白名单字段（DSH 私有 payload 一律不透传）。
	const data = isRecord(raw['data']) ? raw['data'] : undefined;
	const seq = safeInteger(raw['seq']) ?? fallbackSeq;
	const callId = nonEmptyString(raw['callId'])
		?? (data !== undefined ? nonEmptyString(data['callId']) ?? nonEmptyString((isRecord(data['message']) && isRecord(data['message']['source']) ? data['message']['source']['callId'] : undefined)) : undefined);
	const turn = safeInteger(raw['turn']) ?? (data !== undefined ? safeInteger(data['turn']) : undefined);
	const step = safeInteger(raw['step']) ?? (data !== undefined ? safeInteger(data['step']) : undefined);
	// 瞬时流帧的两个身份字段只在**已由 unwrapFollowFrame 归一**的中立形状上出现：
	// 线上帧本身没有 `seq`（不进日志），幂等只能按 attempt + revision 判定。
	const attemptId = nonEmptyString(raw['attemptId']);
	const streamRevision = safeInteger(raw['streamRevision']);
	// 结局只认两个上游字面量；其它取值一律不带该字段（不猜）。
	const rawOutcome = raw['outcome'];
	const outcome = rawOutcome === 'committed' || rawOutcome === 'abandoned' ? rawOutcome : undefined;

	const event: IdeEvent = {
		type,
		seq,
		...(callId !== undefined ? { callId } : {}),
		...(turn !== undefined ? { turn } : {}),
		...(step !== undefined ? { step } : {}),
		...textField(type, raw, data),
		...titleField(type, raw, data),
		...(rowKindOf(type) !== undefined ? { kind: rowKindOf(type)! } : {}),
		...(attemptId !== undefined ? { attemptId } : {}),
		...(streamRevision !== undefined ? { streamRevision } : {}),
		...(outcome !== undefined ? { outcome } : {}),
	};
	return event;
}

/** 按事件类型从线上形状取文本；取不到就不带该字段（显式 undefined 一律省略）。 */
function textField(type: IdeEventType, raw: Record<string, unknown>, data: Record<string, unknown> | undefined): { text?: string } {
	// 抽象形状（dsh-TUI mock / 回放）：字段平铺在顶层。
	const flat = nonEmptyString(raw['text']);
	if (flat !== undefined) {
		return { text: flat };
	}
	if (data === undefined) {
		return {};
	}
	switch (type) {
		case 'user.message': {
			const text = textOfContent(data['content']);
			return text !== undefined ? { text } : {};
		}
		case 'assistant.message': {
			const message = isRecord(data['message']) ? data['message'] : undefined;
			const text = message !== undefined ? textOfContent(message['content']) : undefined;
			return text !== undefined ? { text } : {};
		}
		case 'assistant.delta': {
			const text = nonEmptyString(data['text']) ?? nonEmptyString(data['delta']);
			return text !== undefined ? { text } : {};
		}
		case 'tool.call': {
			const name = nonEmptyString(data['name']);
			return name !== undefined ? { text: name } : {};
		}
		case 'tool.result': {
			const message = isRecord(data['message']) ? data['message'] : undefined;
			const text = message !== undefined ? textOfContent(message['content']) : undefined;
			return text !== undefined ? { text } : {};
		}
		case 'system.prompt': {
			const message = isRecord(data['message']) ? data['message'] : undefined;
			const text = message !== undefined ? textOfContent(message['content']) : undefined;
			return text !== undefined ? { text } : {};
		}
		default:
			return {};
	}
}

/** 按事件类型从线上形状取标题（工具名 / 会话标题）；取不到就不带该字段。 */
function titleField(type: IdeEventType, raw: Record<string, unknown>, data: Record<string, unknown> | undefined): { title?: string } {
	const flat = nonEmptyString(raw['title']);
	if (flat !== undefined) {
		return { title: flat };
	}
	if (data === undefined) {
		return {};
	}
	if (type === 'tool.call') {
		const name = nonEmptyString(data['name']);
		return name !== undefined ? { title: name } : {};
	}
	if (type === 'session.title') {
		const title = nonEmptyString(data['title']);
		return title !== undefined ? { title } : {};
	}
	return {};
}

/** 批量翻译（回放脚本 / golden 脚手架入口）。 */
export function translateAll(rawEvents: readonly unknown[]): readonly IdeEvent[] {
	const events: IdeEvent[] = [];
	rawEvents.forEach((raw, index) => {
		const event = translateDshEvent(raw, index);
		if (event !== undefined) {
			events.push(event);
		}
	});
	return events;
}
