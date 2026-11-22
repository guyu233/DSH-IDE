/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 「哪些命令行不该出现在聊天流里」的判据（官方 `ui-chat/README.md`「Hidden Chat rows」）。
//
// 单独成文件的原因：这条判据只由纯数据决定，不需要 DOM、不需要服务、不需要整个 Chat 模型；
// 放在 `dshChatModel.ts` 里会让任何想单测它的代码被迫拉起整条依赖链。

/**
 * 官方「Hidden Chat rows」要求的命令行过滤。
 *
 * 原文：「Chat omits system-prompt and `permission` command rows in every work-details mode.
 * It also hides pending and successful `/team on` and `/team off` receipts, identified by their
 * recorded name and trimmed arguments; **failures and commands with missing or unrecognized
 * arguments remain visible**.」
 *
 * 三条边界必须同时成立才隐藏，缺一条就照常显示：
 *   ① 是 `permission` 命令（按 `commandId` 或记录名，任一命中即算）；
 *   ② 或记录名是 `team` 且参数（去空白后）正好是 `on` / `off`；
 *   ③ 且**不是失败**（`outcome.kind !== 'error'`）。
 *
 * 参数不可识别（空、缺、`on extra` 之类）时**不隐藏**：官方明说「missing or unrecognized
 * arguments remain visible」，猜一个「大概是 /team 的变体」会把用户的回执吞掉。
 *
 * @param node 命令节点
 * @returns 是否应从聊天流里省略
 */
export function isHiddenCommandRow(node: {
	readonly commandId: string;
	readonly name: string | null;
	readonly args: string | null;
	readonly outcome: { readonly kind: 'success' | 'error' } | null;
}): boolean {
	// 失败永远可见：它是用户唯一能看到的错误反馈。
	if (node.outcome?.kind === 'error') {
		return false;
	}
	const name = (node.name ?? '').trim();
	if (node.commandId === 'permission' || name === 'permission') {
		return true;
	}
	if (name !== 'team') {
		return false;
	}
	const args = (node.args ?? '').trim();
	return args === 'on' || args === 'off';
}
