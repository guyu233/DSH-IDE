/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH-IDE（R32 / T11-10）：本文件是被 R30 误删后又恢复的上游文件，恢复时按 T11-04 的删除面**只摘掉
// 与自带 AgentHost 相关的 4 处引用**，其余注册（24 个 Agent Sessions 专属 action、3 处菜单项、
// LocalAgentsSessionsController、externalSessionsFilterMenu、IAgentSessionsService 单例）保持上游原样：
//   - `./experiments/agentSessionsExperiments.contribution.js`（其依赖链需再恢复 4 个 experiments 文件）
//   - `./agentHost/agentHostPermissionUiContribution.js`（依赖已删的 platform/agentHost 契约）
//   - `./agentHost/agentHostChatInputPicker.contribution.js`、`./agentHost/agentHostModeSynchronizer.js`（同上）
// 之所以必须恢复本文件：`chatViewPane.ts:413` 仍在无条件创建 `AgentSessionsControl`，而它的 tool-bar /
// 右键菜单命令与 `LocalAgentsSessionsController` 的会话列表都只在此注册；缺注册会让侧栏变成「可见但无命令」。

import { Codicon } from '../../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize2 } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';
import { AgentSessionsViewerOrientation, AgentSessionsViewerPosition } from './agentSessions.js';
import { IAgentSessionsService, AgentSessionsService } from './agentSessionsService.js';
import { LocalAgentsSessionsController } from './localAgentSessionsController.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../common/contributions.js';
import { ISubmenuItem, MenuId, MenuRegistry, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { OpenAgentSessionInEditorGroupAction, OpenAgentSessionInNewEditorGroupAction, OpenAgentSessionInNewWindowAction, ShowAgentSessionsSidebar, HideAgentSessionsSidebar, ToggleAgentSessionsSidebar, RefreshAgentSessionsViewerAction, FindAgentSessionInViewerAction, MarkAgentSessionUnreadAction, MarkAgentSessionReadAction, FocusAgentSessionsAction, SetAgentSessionsOrientationStackedAction, SetAgentSessionsOrientationSideBySideAction, MarkAllAgentSessionsReadAction, RenameAgentSessionAction, DeleteAgentSessionAction, DeleteAllLocalSessionsAction, MarkAgentSessionSectionReadAction, ToggleShowAgentSessionsAction, PinAgentSessionAction, UnpinAgentSessionAction, CollapseAllAgentSessionSectionsAction, getAgentSessionArchiveActionConstructors } from './agentSessionsActions.js';
import { registerExternalSessionsFilterMenu } from './externalSessionsFilterMenu.js';
import { ChatSessionArchiveActionWordingSettingId, getChatSessionArchiveActionWording } from '../../../../../platform/chat/common/sessionArchiveActions.js';

//#region Actions and Menus

registerAction2(FocusAgentSessionsAction);
registerAction2(MarkAllAgentSessionsReadAction);
registerAction2(MarkAgentSessionSectionReadAction);
registerAction2(CollapseAllAgentSessionSectionsAction);
registerAction2(PinAgentSessionAction);
registerAction2(UnpinAgentSessionAction);
registerAction2(RenameAgentSessionAction);
registerAction2(DeleteAgentSessionAction);
registerAction2(DeleteAllLocalSessionsAction);
registerAction2(MarkAgentSessionUnreadAction);
registerAction2(MarkAgentSessionReadAction);
registerAction2(OpenAgentSessionInNewWindowAction);
registerAction2(OpenAgentSessionInEditorGroupAction);
registerAction2(OpenAgentSessionInNewEditorGroupAction);
registerAction2(RefreshAgentSessionsViewerAction);
registerAction2(FindAgentSessionInViewerAction);
registerExternalSessionsFilterMenu(MenuId.AgentSessionsViewerFilterSubMenu, MenuId.AgentSessionsExternalFilterSubMenu, '2_external');
registerAction2(ShowAgentSessionsSidebar);
registerAction2(HideAgentSessionsSidebar);

class AgentSessionArchiveActionsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.agentSessionArchiveActions';

	private readonly actionRegistrations = this._register(new DisposableStore());

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		this.registerActions();
		this._register(this.configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(ChatSessionArchiveActionWordingSettingId)) {
				this.registerActions();
			}
		}));
	}

	private registerActions(): void {
		this.actionRegistrations.clear();
		const wording = getChatSessionArchiveActionWording(this.configurationService);
		for (const action of getAgentSessionArchiveActionConstructors(wording)) {
			this.actionRegistrations.add(registerAction2(action));
		}
	}
}

registerWorkbenchContribution2(AgentSessionArchiveActionsContribution.ID, AgentSessionArchiveActionsContribution, WorkbenchPhase.BlockStartup);
registerAction2(ToggleAgentSessionsSidebar);
registerAction2(ToggleShowAgentSessionsAction);
registerAction2(SetAgentSessionsOrientationStackedAction);
registerAction2(SetAgentSessionsOrientationSideBySideAction);

// --- Agent Sessions Toolbar

MenuRegistry.appendMenuItem(MenuId.AgentSessionsToolbar, {
	submenu: MenuId.AgentSessionsViewerFilterSubMenu,
	title: localize2('filterAgentSessions', "Filter Agent Sessions"),
	group: 'navigation',
	order: 3,
	icon: Codicon.filter,
} satisfies ISubmenuItem);

MenuRegistry.appendMenuItem(MenuId.AgentSessionsToolbar, {
	command: {
		id: ShowAgentSessionsSidebar.ID,
		title: ShowAgentSessionsSidebar.TITLE,
		icon: Codicon.layoutSidebarRightOff,
	},
	group: 'navigation',
	order: 5,
	when: ContextKeyExpr.and(
		ChatContextKeys.agentSessionsViewerOrientation.isEqualTo(AgentSessionsViewerOrientation.Stacked),
		ChatContextKeys.agentSessionsViewerPosition.isEqualTo(AgentSessionsViewerPosition.Right)
	)
});

MenuRegistry.appendMenuItem(MenuId.AgentSessionsToolbar, {
	command: {
		id: ShowAgentSessionsSidebar.ID,
		title: ShowAgentSessionsSidebar.TITLE,
		icon: Codicon.layoutSidebarLeftOff,
	},
	group: 'navigation',
	order: 5,
	when: ContextKeyExpr.and(
		ChatContextKeys.agentSessionsViewerOrientation.isEqualTo(AgentSessionsViewerOrientation.Stacked),
		ChatContextKeys.agentSessionsViewerPosition.isEqualTo(AgentSessionsViewerPosition.Left)
	)
});

MenuRegistry.appendMenuItem(MenuId.AgentSessionsToolbar, {
	command: {
		id: HideAgentSessionsSidebar.ID,
		title: HideAgentSessionsSidebar.TITLE,
		icon: Codicon.layoutSidebarRight,
	},
	group: 'navigation',
	order: 5,
	when: ContextKeyExpr.and(
		ChatContextKeys.agentSessionsViewerOrientation.isEqualTo(AgentSessionsViewerOrientation.SideBySide),
		ChatContextKeys.agentSessionsViewerPosition.isEqualTo(AgentSessionsViewerPosition.Right)
	)
});

MenuRegistry.appendMenuItem(MenuId.AgentSessionsToolbar, {
	command: {
		id: HideAgentSessionsSidebar.ID,
		title: HideAgentSessionsSidebar.TITLE,
		icon: Codicon.layoutSidebarLeft,
	},
	group: 'navigation',
	order: 5,
	when: ContextKeyExpr.and(
		ChatContextKeys.agentSessionsViewerOrientation.isEqualTo(AgentSessionsViewerOrientation.SideBySide),
		ChatContextKeys.agentSessionsViewerPosition.isEqualTo(AgentSessionsViewerPosition.Left)
	)
});

// --- Sessions Title Toolbar

MenuRegistry.appendMenuItem(MenuId.ChatViewSessionTitleToolbar, {
	command: {
		id: ShowAgentSessionsSidebar.ID,
		title: ShowAgentSessionsSidebar.TITLE,
		icon: Codicon.layoutSidebarLeftOff,
	},
	group: 'navigation',
	order: 1,
	when: ContextKeyExpr.and(
		ContextKeyExpr.or(
			ChatContextKeys.agentSessionsViewerVisible.negate(),
			ChatContextKeys.agentSessionsViewerOrientation.isEqualTo(AgentSessionsViewerOrientation.Stacked),
		),
		ChatContextKeys.agentSessionsViewerPosition.isEqualTo(AgentSessionsViewerPosition.Left)
	)
});

MenuRegistry.appendMenuItem(MenuId.ChatViewSessionTitleToolbar, {
	command: {
		id: ShowAgentSessionsSidebar.ID,
		title: ShowAgentSessionsSidebar.TITLE,
		icon: Codicon.layoutSidebarRightOff,
	},
	group: 'navigation',
	order: 1,
	when: ContextKeyExpr.and(
		ContextKeyExpr.or(
			ChatContextKeys.agentSessionsViewerVisible.negate(),
			ChatContextKeys.agentSessionsViewerOrientation.isEqualTo(AgentSessionsViewerOrientation.Stacked),
		),
		ChatContextKeys.agentSessionsViewerPosition.isEqualTo(AgentSessionsViewerPosition.Right)
	)
});

//#endregion

//#region Workbench Contributions

registerWorkbenchContribution2(LocalAgentsSessionsController.ID, LocalAgentsSessionsController, WorkbenchPhase.AfterRestored);

registerSingleton(IAgentSessionsService, AgentSessionsService, InstantiationType.Delayed);

//#endregion
