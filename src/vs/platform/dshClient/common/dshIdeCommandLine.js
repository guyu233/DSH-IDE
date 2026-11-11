/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * 两套 backend 共用的斜杠命令 line 构造与结果判定（第 34 轮契约决定，§8.10.10）。
 *
 * 契约真源 `dshIdeProtocol.ts` 已约束 `command` 为不带前导斜杠的命令名、
 * `args` 每项不含空白/斜杠；这里只做「拼接」与「官方 CommandExecution 结果」
 * 到 IDE 动作类语义的映射，不复制校验器、不建第二份 schema。
 *
 * 官方 `commands.execute` 返回 `CommandExecution | undefined`
 * （`undefined` = 语法不匹配 / 未知命令）与 `CommandResult{kind:'success'|'error'}`；
 * IDE 动作类固定 `{accepted:true}`，未接纳一律走错误码（第 2 章 §4）。
 */

/**
 * 由契约参数拼出官方 `parseCommand` 要求的完整 line：`/<name>` + 单空格分隔的 args。
 * @param {string} command - 不带前导斜杠的命令名。
 * @param {readonly string[] | undefined} args - 已由契约校验的参数。
 * @returns {string} 例如 `('permission', ['workspace-write'])` → `/permission workspace-write`。
 */
export function buildDshIdeCommandLine(command, args) {
	const parts = args === undefined ? [] : args;
	return parts.length === 0 ? `/${command}` : `/${command} ${parts.join(' ')}`;
}

/**
 * 把官方 `commands.execute` 结果收敛为 IDE 动作类判定（fail-closed）。
 *
 * @param {unknown} execution - 官方 `CommandExecution | undefined`。
 * @returns {{ accepted: true } | { error: 'invalid-argument' | 'feature-unavailable'; message: string }}
 */
export function mapDshIdeCommandExecution(execution) {
	if (execution === undefined || execution === null || typeof execution !== 'object') {
		// 语法不匹配 / 未知命令：官方不接纳，IDE 侧按 INVALID_ARGUMENT 明确拒绝。
		return { error: 'invalid-argument', message: 'command was not admitted (unknown or malformed)' };
	}
	const result = execution.result;
	if (result === null || typeof result !== 'object') {
		return { error: 'feature-unavailable', message: 'command execution returned no result' };
	}
	const kind = result.kind;
	if (kind === 'success') {
		return { accepted: true };
	}
	const text = typeof result.text === 'string' && result.text !== '' ? result.text : 'command handler reported an error';
	// handler 的 error 是官方已接纳但执行失败，按 FEATURE_UNAVAILABLE 带确定文案上报。
	return { error: 'feature-unavailable', message: text };
}
