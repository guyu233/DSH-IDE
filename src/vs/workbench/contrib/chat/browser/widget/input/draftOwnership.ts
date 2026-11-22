/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 提交前捕获的草稿归属：只有「当前草稿仍是发起时那一份」才允许清理。
//
// 两处调用方共用一个判定：`/fork prompt` 的源草稿清理，与 DSH 提交被接受后的清稿。
// 规则只有一条——文本与附件都没变；会话身份由调用方另行核对（各自知道自己的来源）。
//
// 为什么不能只看文本：用户可能在等待期间删掉附件、或换上另一个同名文本；
// 只看文本会把用户新写的草稿当成旧稿清掉。

import { structuralEquals } from '../../../../../../base/common/equals.js';
import type { IChatRequestVariableEntry } from '../../../common/attachments/chatVariableEntries.js';
import type { IInputModel } from '../../../common/model/chatModel.js';

/**
 * 当前草稿是否仍是发起时捕获的那一份。
 * @param inputModel 发起时的输入模型；拿不到时视为「无法证明」，返回 false
 * @param text 发起时的文本
 * @param attachments 发起时的附件快照
 */
export function isOwnedDraftUnchanged(
	inputModel: IInputModel | undefined,
	text: string,
	attachments: readonly IChatRequestVariableEntry[],
): boolean {
	const state = inputModel?.state.get();
	if (state === undefined) {
		return false;
	}
	return state.inputText === text && structuralEquals(state.attachments ?? [], attachments);
}

/**
 * 清掉仍是原稿的草稿；已经被用户改过就不动。
 *
 * 只做「模型层清空」，不碰编辑器光标与历史：需要写历史的调用方仍走
 * `acceptInput`，它自己会清编辑器，不要在这里重复清一次。
 * @returns 是否真的清了
 */
export function clearOwnedDraft(
	inputModel: IInputModel | undefined,
	text: string,
	attachments: readonly IChatRequestVariableEntry[],
): boolean {
	if (!isOwnedDraftUnchanged(inputModel, text, attachments)) {
		return false;
	}
	inputModel?.setState({ inputText: '', attachments: [] });
	return true;
}
