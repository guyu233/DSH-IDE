/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH-IDE Workbench 贡献装配：注册渲染器侧管道客户端单例、聊天 WebviewView、通道 B 执行桥、内联补全。
//
// 这是 DSH-IDE 在 VS Code 侧「接线」的单一入口，仅在由 dsh-ide 拉起（注入 DSH_IDE_PIPE）的 IDE 实例内
// 注册可视化贡献；IDshChatClient 单例始终注册（内建聊天的 DshChatBridge 依赖它，未连接时安全降级）。

import { Codicon } from '../../../../base/common/codicons.js';
import { localize2 } from '../../../../nls.js';
import { registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import {
	Extensions as ViewContainerExtensions, IViewContainersRegistry, IViewDescriptor, IViewsRegistry, ViewContainerLocation,
} from '../../../common/views.js';
import { WebviewViewPane } from '../../../contrib/webviewView/browser/webviewViewPane.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IWebviewViewService } from '../../../contrib/webviewView/browser/webviewViewService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IDshChatClient, DshChatClient } from '../../../../platform/dshPipe/common/dshChatClient.js';
import { DshChatWebviewProvider, DSH_CHAT_VIEW_ID } from './chatWebview.js';
import { DshIdeExecBridge } from './dshIdeExecBridge.js';
import { registerDshInlineCompletions } from './inlineCompletion.js';

// 渲染器管道客户端单例（始终注册；未连接时所有调用安全失败/降级）。
registerSingleton(IDshChatClient, DshChatClient, InstantiationType.Delayed);

const DSH_CONTAINER_ID = 'workbench.view.dshContainer';

/** 仅当由 dsh-ide 拉起（注入 DSH_IDE_PIPE）时注册可视化贡献。 */
if (typeof process !== 'undefined' && process.env && process.env.DSH_IDE_PIPE) {
	const viewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
	const viewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);

	const container = viewContainersRegistry.registerViewContainer({
		id: DSH_CONTAINER_ID,
		title: localize2('dsh.container', "DSH-IDE"),
		icon: Codicon.commentDiscussion,
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [DSH_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
		storageId: DSH_CONTAINER_ID,
		hideIfEmpty: false,
		order: 5,
	}, ViewContainerLocation.Sidebar);

	const viewDescriptor: IViewDescriptor = {
		id: DSH_CHAT_VIEW_ID,
		name: localize2('dsh.chat', "DSH"),
		containerIcon: Codicon.commentDiscussion,
		ctorDescriptor: new SyncDescriptor(WebviewViewPane),
		canToggleVisibility: true,
		canMoveView: true,
		type: 'webview',
	};
	viewsRegistry.registerViews([viewDescriptor], container);

	// 通道 B 执行桥（Host 的 ide_* 写/LSP/终端/Git 经此在渲染器执行）。
	class DshIdeExecContribution implements IWorkbenchContribution {
		constructor(@IInstantiationService instantiationService: IInstantiationService, @IDshChatClient client: IDshChatClient) {
			instantiationService.createInstance(DshIdeExecBridge, instantiationService, client);
		}
	}
	registerWorkbenchContribution2('workbench.contrib.dshIdeExec', DshIdeExecContribution, WorkbenchPhase.AfterRestored);

	// 聊天 WebviewView 提供者。
	class DshChatContribution implements IWorkbenchContribution {
		constructor(
			@IWebviewViewService webviewViewService: IWebviewViewService,
			@IDshChatClient client: IDshChatClient,
			@IWorkspaceContextService workspace: IWorkspaceContextService,
			@ILogService log: ILogService,
		) {
			new DshChatWebviewProvider(webviewViewService, client, workspace, log);
		}
	}
	registerWorkbenchContribution2('workbench.contrib.dshChat', DshChatContribution, WorkbenchPhase.AfterRestored);

	// 内联补全（DSH 后端）。种子注册；无 DSH 后端时优雅降级。
	class DshInlineCompletionContribution implements IWorkbenchContribution {
		constructor(@ILanguageFeaturesService languageFeatures: ILanguageFeaturesService, @IDshChatClient client: IDshChatClient) {
			registerDshInlineCompletions(languageFeatures, client);
		}
	}
	registerWorkbenchContribution2('workbench.contrib.dshInlineCompletion', DshInlineCompletionContribution, WorkbenchPhase.AfterRestored);
}
