/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 团队开关的命令入口。
//
// 原生模型选择器承接了模型与 effort，但 DSH 的「团队」开关在原生选择器里没有对应控件；
// 这里用命令 + quick pick 承接，写回仍走既有 `setTeamEnabled`（`DshComposerSource.setTeam`），不另造接口。

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { CommandsRegistry, ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { localize2 } from '../../../../../nls.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { localize } from '../../../../../nls.js';
import { dshCurrentSessionId, getDshComposerSource } from './dshComposerRegistry.js';
import { DSH_CHAT_SESSION_TYPE } from './dshSessionType.js';
import { dshDone, dshFail } from '../dshNotice.js';

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
			dshFail(notifications, localize('dsh.team.unavailable', "DSH-IDE: this session has no team settings available."));
			return;
		}
		const enable = localize('dsh.team.enable', "Turn team mode on");
		const disable = localize('dsh.team.disable', "Turn team mode off");
		// 把这次切换绑定到打开选择器时的会话：确认前换绑不能写到另一个会话。
		const sessionId = dshCurrentSessionId();
		const picked = await quickInputService.pick(
			[
				// 标记必须落在与 enabled 相同的那一项。标反时，用户点「开启」会被当成没变化直接返回。
				{ label: enable, description: team.enabled === true ? localize('dsh.team.current', "Current state") : undefined },
				{ label: disable, description: team.enabled === false ? localize('dsh.team.current', "Current state") : undefined },
			],
			{
				placeHolder: team.enabled
					? localize('dsh.team.currentOn', "Team mode is on; pick the state to switch to")
					: localize('dsh.team.currentOff', "Team mode is off; pick the state to switch to"),
			},
		);
		if (picked === undefined) {
			return;
		}
		const next = picked.label === enable;
		if (next === team.enabled) {
			dshDone(notifications, next
				? localize('dsh.team.alreadyOn', "Team mode is already on.")
				: localize('dsh.team.alreadyOff', "Team mode is already off."));
			return;
		}
		if (team.confirmDisable && next === false) {
			// 投影要求关闭团队前再确认一次：多问一步，而不是替用户决定或直接拒绝。
			const confirmed = await quickInputService.pick(
				[
					{ label: localize('dsh.team.confirmYes', "Turn team mode off") },
					{ label: localize('dsh.team.confirmNo', "Cancel") },
				],
				{ placeHolder: localize('dsh.team.confirmPlaceholder', "Turning team mode off changes how this session collaborates. Continue?") },
			);
			if (confirmed === undefined || confirmed.label !== localize('dsh.team.confirmYes', "Turn team mode off")) {
				return;
			}
		}
		await source.setTeam(next, sessionId);
		// 写回后 refresh() 会更新 state；这里再读一次，只报真实结果。
		const after = getDshComposerSource()?.state.team;
		if (after === null || after === undefined) {
			dshFail(notifications, localize('dsh.team.unreadable', "DSH-IDE: team state could not be read, so the switch cannot be confirmed."));
			return;
		}
		if (after.enabled !== next) {
			dshFail(notifications, localize('dsh.team.failed', "DSH-IDE: team mode did not switch. Try again later."));
			return;
		}
		dshDone(notifications, next
			? localize('dsh.team.turnedOn', "Team mode is on.")
			: localize('dsh.team.turnedOff', "Team mode is off."));
	}));
	return disposables;
}
/** 命令面板入口：`dsh.toggleTeam`。 */
export function registerDshTeamAction(): { dispose(): void } {
	const action = registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'dsh.toggleTeam.palette',
				title: localize2('dsh.team.title', "Toggle DSH team mode"),
				menu: { id: MenuId.CommandPalette },
			});
		}
		async run(accessor: ServicesAccessor): Promise<void> {
			await accessor.get(ICommandService).executeCommand('dsh.toggleTeam');
		}
	});
	return { dispose: () => action.dispose() };
}

/**
 * 输入区「更多」里的团队开关。
 *
 * 与命令面板共用同一个 `dsh.toggleTeam`，不另写一套切换逻辑。
 * 只在 DSH 会话出现；没有团队目录的会话点开后会明确说「当前会话没有可用的团队设置」。
 */
export function registerDshTeamInputAction(): { dispose(): void } {
	const action = registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'dsh.toggleTeam.input',
				title: localize2('dsh.team.inputTitle', "Team mode"),
				tooltip: localize('dsh.team.inputTooltip', "Toggle DSH team mode"),
				f1: false,
				precondition: ContextKeyExpr.equals('chatSessionType', DSH_CHAT_SESSION_TYPE),
				menu: {
					id: MenuId.ChatInputSecondary,
					order: 3,
					group: 'navigation',
					when: ContextKeyExpr.equals('chatSessionType', DSH_CHAT_SESSION_TYPE),
				},
			});
		}
		async run(accessor: ServicesAccessor): Promise<void> {
			await accessor.get(ICommandService).executeCommand('dsh.toggleTeam');
		}
	});
	return { dispose: () => action.dispose() };
}
