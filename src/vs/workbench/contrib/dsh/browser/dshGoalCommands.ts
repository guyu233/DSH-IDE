/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 目标的命令入口。
//
// Host 的 `setGoal` 已实际调用官方 `goals.create/edit/pause/resume/complete/clear`，
// 但窗口里一直没有调用方。这里用命令 + quick pick 承接，写回仍走唯一通道 `setGoal`，
// 不另建目标存储，也不猜服务名。

import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { localize2 } from '../../../../nls.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { localize } from '../../../../nls.js';
import { IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import { dshErrorText, type DshIdeGoalView } from '../../../../platform/dshClient/common/dshIdeProtocol.js';
import { dshChatSessionFor } from './dshChatSession.js';

/** 读取当前绑定会话的目标；没有会话或未创建时返回 undefined。 */
function currentGoal(client: IDshClientService): DshIdeGoalView | undefined {
	return dshChatSessionFor(client).goal();
}

/**
 * 注册 `dsh.goal`：创建目标，或在已有目标上暂停 / 恢复 / 完成 / 清除。
 *
 * 每个动作都把 Host 的真实返回或失败原样告诉用户，不在本地假装状态已变。
 */
export function registerDshGoalCommand(
	client: IDshClientService,
	quickInputService: IQuickInputService,
	notifications: INotificationService,
): { dispose(): void } {
	const disposables = new DisposableStore();
	disposables.add(CommandsRegistry.registerCommand('dsh.goal', async () => {
		const session = dshChatSessionFor(client);
		const sessionId = session.activeSessionId;
		if (sessionId === undefined) {
			notifications.warn(localize('dsh.goal.noSession', "当前没有绑定 DSH 会话，无法设置目标。"));
			return;
		}
		const goal = currentGoal(client)?.goal;
		if (goal === undefined) {
			const objective = await quickInputService.input({
				placeHolder: localize('dsh.goal.objectivePlaceholder', "输入这个会话要达成的目标"),
				prompt: localize('dsh.goal.objectivePrompt', "目标描述（留空取消）"),
			});
			if (objective === undefined || objective.trim() === '') {
				return;
			}
			const result = await client.call('setGoal', { sessionId, action: 'create', objective: objective.trim() });
			if (!result.ok) {
				const detail = dshErrorText(result.error, localize('dsh.goal.createFailedUnknown', "未知原因"));
				notifications.error(localize('dsh.goal.createFailed', "创建目标失败：{0}", detail));
				return;
			}
			notifications.info(localize('dsh.goal.created', "已创建目标。"));
			return;
		}
		// 只列出当前阶段真能生效的动作。全列的话，已暂停的目标点「暂停」、已完成的目标
		// 点「恢复」都会被 Host 拒绝，用户看到的是失败提示而不是「这个选项不该出现」。
		// 契约 phase：active | paused | blocked | complete。
		const actions = [
			{ id: 'pause' as const, label: localize('dsh.goal.pause', "暂停目标"), when: ['active'] },
			{ id: 'resume' as const, label: localize('dsh.goal.resume', "恢复目标"), when: ['paused', 'blocked'] },
			{ id: 'complete' as const, label: localize('dsh.goal.complete', "标记完成"), when: ['active', 'paused', 'blocked'] },
			{ id: 'clear' as const, label: localize('dsh.goal.clear', "清除目标"), when: ['active', 'paused', 'blocked', 'complete'] },
		].filter(action => action.when.includes(goal.phase));
		if (actions.length === 0) {
			// 不认识的阶段（Host 比本版本新）：不乱猜动作，明确告知而不是给一张全被拒的菜单。
			notifications.warn(localize('dsh.goal.unknownPhase', "这个目标的阶段无法识别（{0}），没有可用的操作。", goal.phase));
			return;
		}
		const picked = await quickInputService.pick(actions.map(action => ({ label: action.label, id: action.id })), {
			placeHolder: localize('dsh.goal.current', "当前目标：{0}", goal.objective),
		});
		if (picked === undefined) {
			return;
		}
		const action = (picked as { id: string }).id;
		const result = await client.call('setGoal', { sessionId, action, id: goal.id, revision: goal.revision });
		if (!result.ok) {
			const detail = dshErrorText(result.error, localize('dsh.goal.actionFailedUnknown', "未知原因"));
			notifications.error(localize('dsh.goal.actionFailed', "目标操作失败：{0}", detail));
			return;
		}
		notifications.info(localize('dsh.goal.updated', "目标已更新。"));
	}));
	return disposables;
}
/** 命令面板入口：`dsh.goal`。 */
export function registerDshGoalAction(): { dispose(): void } {
	const action = registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'dsh.goal.palette',
				title: localize2('dsh.goal.title', "设置 DSH 目标"),
				menu: { id: MenuId.CommandPalette },
			});
		}
		async run(accessor: ServicesAccessor): Promise<void> {
			await accessor.get(ICommandService).executeCommand('dsh.goal');
		}
	});
	return { dispose: () => action.dispose() };
}
