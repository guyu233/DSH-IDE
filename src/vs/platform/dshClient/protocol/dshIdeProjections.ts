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
	DshIdeTeamTaskView,
	DshIdeTeamView,
	DshIdeWorktreeView,
	DshIdeTodoView,
	DshIdeViewSnapshot,
} from './dshIdeProtocol.js';

/** `projectDshIdeProjections` 的返回值：只含本次真的读到的字段。 */
export type DshIdeProjectionFields = Pick<
	DshIdeViewSnapshot,
	'plan' | 'goal' | 'todos' | 'team' | 'worktrees' | 'tokenUsageDelta' | 'tokenUsageTotal' | 'contextPressure' | 'contextBreakdown' | 'skills' | 'deliverables' | 'attachments' | 'quotaNotice' | 'composer' | 'pending'
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
	const team = teamOf(values['agentTeam']);
	const worktrees = worktreesOf(values['worktree']);
	// 官方 `tokenUsage` 投影：整会话累加用量，四桶互不相交（reasoning 已含在 outputTokens）。
	const usage = isRecord(values['tokenUsage']) ? values['tokenUsage'] : undefined;
	const tokenUsageTotal = usage === undefined ? undefined : {
		uncachedInputTokens: typeof usage['uncachedInputTokens'] === 'number' ? usage['uncachedInputTokens'] : 0,
		outputTokens: typeof usage['outputTokens'] === 'number' ? usage['outputTokens'] : 0,
		cacheReadTokens: typeof usage['cacheReadTokens'] === 'number' ? usage['cacheReadTokens'] : 0,
		cacheWriteTokens: typeof usage['cacheWriteTokens'] === 'number' ? usage['cacheWriteTokens'] : 0,
	};
	// 官方 `contextPressure`：三项都是**可选**、各自 last-wins——缺哪项就不写哪项（不补 0）。
	const pressure = isRecord(values['contextPressure']) ? values['contextPressure'] : undefined;
	const contextPressure = pressure === undefined ? undefined : {
		...(typeof pressure['pressureTokens'] === 'number' ? { pressureTokens: pressure['pressureTokens'] } : {}),
		...(typeof pressure['projectedTokens'] === 'number' ? { projectedTokens: pressure['projectedTokens'] } : {}),
		...(typeof pressure['contextWindow'] === 'number' ? { contextWindow: pressure['contextWindow'] } : {}),
	};
	// 官方 `contextBreakdown`：三项**全必填**（启发式估算，0 是合法值——没有 system 就是 0）。
	const breakdown = isRecord(values['contextBreakdown']) ? values['contextBreakdown'] : undefined;
	const contextBreakdown = breakdown === undefined ? undefined : {
		systemTokens: typeof breakdown['systemTokens'] === 'number' ? breakdown['systemTokens'] : 0,
		toolsTokens: typeof breakdown['toolsTokens'] === 'number' ? breakdown['toolsTokens'] : 0,
		messageTokens: typeof breakdown['messageTokens'] === 'number' ? breakdown['messageTokens'] : 0,
	};
	// 只把真的读到的字段放进返回值；字段就缺席，不写 undefined。
	return {
		...(tokenUsageTotal === undefined ? {} : { tokenUsageTotal }),
		...(contextPressure === undefined || Object.keys(contextPressure).length === 0 ? {} : { contextPressure }),
		...(contextBreakdown === undefined ? {} : { contextBreakdown }),
		...(plan === undefined ? {} : { plan }),
		...(goal === undefined ? {} : { goal }),
		...(todos === undefined ? {} : { todos }),
		...(team === undefined ? {} : { team }),
		...(worktrees === undefined ? {} : { worktrees }),
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

function worktreesOf(value: unknown): readonly DshIdeWorktreeView[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const worktrees: DshIdeWorktreeView[] = [];
	for (const item of value) {
		if (!isRecord(item)) {
			return undefined;
		}
		const worktree = isRecord(item['worktree']) ? item['worktree'] : undefined;
		if (worktree === undefined) {
			return undefined;
		}
		const path = nonEmpty(worktree['path']);
		const branch = nonEmpty(worktree['branch']);
		const baseCommit = nonEmpty(worktree['baseCommit']);
		const repositoryRoot = nonEmpty(worktree['repositoryRoot']);
		if (path === undefined || branch === undefined || baseCommit === undefined || repositoryRoot === undefined) {
			return undefined;
		}
		worktrees.push({ path, branch, baseCommit, repositoryRoot, created: item['created'] === true });
	}
	return worktrees;
}

function teamOf(value: unknown): DshIdeTeamView | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const enabled = value['enabled'];
	const list = value['tasks'];
	if (typeof enabled !== 'boolean' || !Array.isArray(list)) {
		return undefined;
	}
	const tasks: DshIdeTeamTaskView[] = [];
	for (const item of list) {
		if (!isRecord(item)) {
			return undefined;
		}
		const id = nonEmpty(item['id']);
		const subject = typeof item['subject'] === 'string' ? item['subject'] : undefined;
		const description = typeof item['description'] === 'string' ? item['description'] : undefined;
		const status = nonEmpty(item['status']);
		const revision = item['revision'];
		const ready = item['ready'];
		if (id === undefined || subject === undefined || description === undefined || status === undefined) {
			return undefined;
		}
		if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0 || typeof ready !== 'boolean') {
			return undefined;
		}
		const ownerName = nonEmpty(item['ownerName']);
		tasks.push({ id, revision, subject, description, status, ready, ...(ownerName === undefined ? {} : { ownerName }) });
	}
	const failure = nonEmpty(value['failure']);
	return { enabled, tasks, ...(failure === undefined ? {} : { failure }) };
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
