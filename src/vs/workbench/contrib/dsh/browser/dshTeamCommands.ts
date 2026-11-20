/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 团队开关的命令入口。
//
// 原生模型选择器承接了模型与 effort，但 DSH 的「团队」开关在原生选择器里没有对应控件；
// 这里用命令 + quick pick 承接，写回仍走既有 `setTeamEnabled`（`DshComposerSource.setTeam`），不另造接口。

import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { localize2 } from '../../../../nls.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { localize } from '../../../../nls.js';
import { getDshComposerSource } from './dshComposerRegistry.js';

/**
 * 注册 `dsh.toggleTeam`：读取当前团队状态，让用户选择开启或关闭。
 *
 * 官方 `setTeamEnabled(agent, enabled, signal)` 在会话已开聊时可能拒绝；
 * 这种情况把失败如实告诉用户，不假装切换成功。
 */
export function registerDshTeamCommands(
	quickInputService: IQuickInputService,
	notifications: INotificationService,
): { dispose(): void } {
	const disposables = new DisposableStore();
	disposables.add(CommandsRegistry.registerCommand('dsh.toggleTeam', async () => {
		const source = getDshComposerSource();
		const team = source?.state.team;
		if (source === undefined || team === null || team === undefined) {
			notifications.warn(localize('dsh.team.unavailable', "当前会话没有可用的团队设置。"));
			return;
		}
		const enable = localize('dsh.team.enable', "开启团队");
		const disable = localize('dsh.team.disable', "关闭团队");
		const picked = await quickInputService.pick(
			[
				// 标记必须落在与 enabled 相同的那一项。标反时，用户点「开启」会被当成没变化直接返回。
				{ label: enable, description: team.enabled === true ? localize('dsh.team.current', "当前状态") : undefined },
				{ label: disable, description: team.enabled === false ? localize('dsh.team.current', "当前状态") : undefined },
			],
			{
				placeHolder: team.enabled
					? localize('dsh.team.currentOn', "团队当前已开启，选择要切换到的状态")
					: localize('dsh.team.currentOff', "团队当前已关闭，选择要切换到的状态"),
			},
		);
		if (picked === undefined) {
			return;
		}
		const next = picked.label === enable;
		if (next === team.enabled) {
			notifications.info(next
				? localize('dsh.team.alreadyOn', "团队已经是开启状态。")
				: localize('dsh.team.alreadyOff', "团队已经是关闭状态。"));
			return;
		}
		await source.setTeam(next);
		// 写回后 refresh() 会更新 state；这里再读一次，只报真实结果。
		const after = getDshComposerSource()?.state.team;
		if (after !== null && after !== undefined && after.enabled !== next) {
			notifications.error(localize('dsh.team.failed', "团队设置未能切换，请稍后重试。"));
			return;
		}
		notifications.info(next
			? localize('dsh.team.turnedOn', "团队已开启。")
			: localize('dsh.team.turnedOff', "团队已关闭。"));
	}));
	return disposables;
}
/** 命令面板入口：`dsh.toggleTeam`。 */
export function registerDshTeamAction(): { dispose(): void } {
	const action = registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'dsh.toggleTeam.palette',
				title: localize2('dsh.team.title', "切换 DSH 团队模式"),
				menu: { id: MenuId.CommandPalette },
			});
		}
		async run(accessor: ServicesAccessor): Promise<void> {
			await accessor.get(ICommandService).executeCommand('dsh.toggleTeam');
		}
	});
	return { dispose: () => action.dispose() };
}
