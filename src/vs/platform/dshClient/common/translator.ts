/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 阶段 2.2a：DSH → 中立 IdeEvent translator（插件侧 common 层）。
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

/** 中立事件：投影器唯一可见的形状。所有字段可选但显式 undefined 一律省略。 */
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
}

/** translator 只接受纯对象（结构窄化，不引用 DSH 包类型），逐字段白名单拷贝。 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
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
	const type = raw['type'] as IdeEventType;
	if (dshEmits(type) !== true) {
		return undefined;
	}
	const event: IdeEvent = {
		type,
		seq: safeInteger(raw['seq']) ?? fallbackSeq,
		...(nonEmptyString(raw['callId']) !== undefined ? { callId: nonEmptyString(raw['callId'])! } : {}),
		...(safeInteger(raw['turn']) !== undefined ? { turn: safeInteger(raw['turn'])! } : {}),
		...(safeInteger(raw['step']) !== undefined ? { step: safeInteger(raw['step'])! } : {}),
		...(nonEmptyString(raw['text']) !== undefined ? { text: nonEmptyString(raw['text'])! } : {}),
		...(nonEmptyString(raw['title']) !== undefined ? { title: nonEmptyString(raw['title'])! } : {}),
		...(rowKindOf(type) !== undefined ? { kind: rowKindOf(type)! } : {}),
	};
	return event;
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
