/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 移动会话时的目标工作区。
//
// 名单里经常包含会话现在所在的工作区。选中它时 Host 仍返回成功，列表却不动，
// 看起来像没点上。当前工作区必须从候选项里拿掉；没有 id 的行也不能进选择器。

export interface DshMoveChoice {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
}

export function dshMoveChoices(
	workspaces: readonly { readonly id?: string; readonly title?: string; readonly path?: string }[],
	currentWorkspaceId: string | undefined,
): readonly DshMoveChoice[] {
	const choices: DshMoveChoice[] = [];
	// Host 侧 `listWorkspaces` 不去重：registry 返回重复 id 时，选择器会出现两行
	// 一模一样的目标，用户分不清该点哪个。这里按 id 保留第一份。
	const seen = new Set<string>();
	for (const workspace of workspaces) {
		if (typeof workspace.id !== 'string' || workspace.id === '') {
			continue;
		}
		if (seen.has(workspace.id)) {
			continue;
		}
		if (currentWorkspaceId !== undefined && currentWorkspaceId !== '' && workspace.id === currentWorkspaceId) {
			continue;
		}
		seen.add(workspace.id);
		const label = typeof workspace.title === 'string' && workspace.title !== '' ? workspace.title : workspace.id;
		const path = typeof workspace.path === 'string' && workspace.path !== '' ? workspace.path : undefined;
		choices.push({ id: workspace.id, label, ...(path === undefined ? {} : { description: path }) });
	}
	return choices;
}

/**
 * 回退切点。
 *
 * Host 只接受 `@` 加非负整数。纯数字按同一含义补上 `@`；空串和别的形状返回 undefined，不发给 Host。
 */
export function dshRewindSeq(raw: string): string | undefined {
	const trimmed = raw.trim();
	const seq = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
	if (!/^\d+$/.test(seq)) {
		return undefined;
	}
	return `@${seq}`;
}
