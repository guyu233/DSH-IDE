/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 把官方的 Session 投影值投影成快照里的 typed 字段。
//
// 依据官方 `session-projection` 的投影键（各领域包 `SessionProjectionMap` 声明）：
//   - `plan`（`packages/plan/plan-mode/src/types.ts`）
//   - `goal`（`packages/goal/goal/src/types.ts`）
//   - `todos`（`packages/todo/tool-todo/src/types.ts`）
//   - `tokenUsage`（`packages/llm/token-meter/src/projection.ts`）
// 只读取、只投影官方字段；未知键与形状不合的值一律跳过，不发明数据。

import type {
	DshIdeGoalView,
	DshIdePlanView,
	DshIdeTodoView,
	DshIdeViewSnapshot,
} from './dshIdeProtocol.js';

/** `projectDshIdeProjections` 的返回值：只含本次真的读到的字段。 */
export type DshIdeProjectionFields = Pick<
	DshIdeViewSnapshot,
	'plan' | 'goal' | 'todos' | 'tokenUsageDelta' | 'skills' | 'deliverables' | 'attachments' | 'quotaNotice' | 'composer' | 'pending'
>;

/**
 * 从一帧 `snapshot` 的投影基线里读出 typed 字段。
 *
 * 官方基线形状是 `{ asOfSeq, values }`（`api/session-controller/src/types.ts:63-68`），
 * typed 投影值在 `values` 里。
 *
 * 注意：`tokenUsage` 投影是**整个会话的累加值**，而协议里的 `tokenUsageDelta`
 * 是单次调用的增量，两者语义不同，不能互相顶替；单次增量由会话投影在每条
 * `assistant/message` 节点上携带。
 *
 * @param baseline - 官方 `SessionProjectionBaseline`（`{ asOfSeq, values }`）。
 * @returns 只有确实存在的字段；缺省表示该会话没有此内容。
 */
export function projectDshIdeProjections(baseline: unknown): DshIdeProjectionFields {
	const values = isRecord(baseline) && isRecord(baseline['values']) ? baseline['values'] : undefined;
	if (values === undefined) {
		return {};
	}
	const plan = planOf(values['plan']);
	const goal = goalOf(values['goal']);
	const todos = todosOf(values['todos']);
	// 只把真的读到的字段放进返回值；字段就缺席，不写 undefined。
	return {
		...(plan === undefined ? {} : { plan }),
		...(goal === undefined ? {} : { goal }),
		...(todos === undefined ? {} : { todos }),
	};
}

function planOf(value: unknown): DshIdePlanView | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const active = value['active'];
	const pending = value['pending'];
	return typeof active === 'boolean' && typeof pending === 'boolean' ? { active, pending } : undefined;
}

function goalOf(value: unknown): DshIdeGoalView | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const goal = isRecord(value['goal']) ? value['goal'] : undefined;
	if (goal === undefined) {
		return undefined;
	}
	const id = nonEmpty(goal['id']);
	const objective = typeof goal['objective'] === 'string' ? goal['objective'] : undefined;
	const phase = goal['phase'];
	const maxGoalRounds = goal['maxGoalRounds'];
	if (id === undefined || objective === undefined) {
		return undefined;
	}
	if (phase !== 'active' && phase !== 'paused' && phase !== 'blocked' && phase !== 'complete') {
		return undefined;
	}
	if (typeof maxGoalRounds !== 'number' || !Number.isSafeInteger(maxGoalRounds) || maxGoalRounds <= 0) {
		return undefined;
	}
	const revision = goal['revision'];
	if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0) {
		return undefined;
	}
	const roundsStarted = value['roundsStarted'];
	const createdAt = value['createdAt'];
	const updatedAt = value['updatedAt'];
	if (!nonNegative(roundsStarted) || !nonNegative(createdAt) || !nonNegative(updatedAt)) {
		return undefined;
	}
	const blocked = isRecord(goal['blockedReason']) ? goal['blockedReason'] : undefined;
	const blockedCode = blocked === undefined ? undefined : nonEmpty(blocked['code']);
	const blockedMessage = blocked === undefined ? undefined : nonEmpty(blocked['message']);
	return {
		goal: {
			id,
			revision,
			objective,
			phase,
			maxGoalRounds,
			...(phase === 'blocked' && blockedCode !== undefined && blockedMessage !== undefined
				? { blockedReason: { code: blockedCode, message: blockedMessage } }
				: {}),
		},
		roundsStarted,
		createdAt,
		updatedAt,
	};
}

function todosOf(value: unknown): readonly DshIdeTodoView[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const todos: DshIdeTodoView[] = [];
	for (const item of value) {
		if (!isRecord(item)) {
			return undefined;
		}
		const content = nonEmpty(item['content']);
		const status = item['status'];
		if (content === undefined || (status !== 'pending' && status !== 'in_progress' && status !== 'completed')) {
			return undefined;
		}
		todos.push({ content, status });
	}
	return todos;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): string | undefined {
	return typeof value === 'string' && value !== '' ? value : undefined;
}

function nonNegative(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
