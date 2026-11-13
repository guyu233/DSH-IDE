/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Workbench 集成。
//
// 唯一 `dshIde` 通道由主进程分发（P3）。本文件注册两样东西：
//   1. DSH 聊天面板（`workbench.view.dshIdeChat`）：聊天视图容器里的主内容区，
//      画面是 DSH 自己的（抄来的 `build/dsh/chat-render` 单接缝），帧来自内核那一次 follow；
//   2. DSH 会话面板（`workbench.view.dshIdeSessions`）：列表 / 点开 / 新建 / 归档 / 搜索 / 删除。
// 另外保留行内补全注册（通道未接线时优雅降级为无补全，不报错）。

import { localize, localize2 } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IDshClientService, DshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';import { DSH_IDE_SESSION_ENV, DSH_IDE_COMPOSER_ENV } from '../../../../platform/dshClient/common/env.js';
import { env } from '../../../../base/common/process.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import {
	Extensions as ViewExtensions,
	IViewContainersRegistry,
	IViewsRegistry,
	ViewContainer,
	ViewContainerLocation,
} from '../../../common/views.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { registerDshInlineCompletions } from './inlineCompletion.js';
import { DshIdeConsumer } from './dshIdeConsumer.js';
import { DshChatSession } from './dshChatSession.js';
import { DshChatPanel, dshChatSessionFor } from './dshChatPanel.js';
import { registerDshLanguageModelProvider } from './dshLanguageModelProvider.js';
import { DshComposerSource } from './dshComposerSource.js';
import { setDshComposerSource } from './dshComposerRegistry.js';
import { ILanguageModelsService } from '../../chat/common/languageModels.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { DshIdeSessionsService, IDshIdeSessionsService } from './dshIdeSessionsService.js';
import { DshIdeSessionsView } from './dshIdeSessionsView.js';

registerSingleton(IDshClientService, DshClientService, InstantiationType.Delayed);
registerSingleton(IDshIdeSessionsService, DshIdeSessionsService, InstantiationType.Delayed);

const DSH_IDE_SESSIONS_CONTAINER_ID = 'workbench.view.dshIdeSessions';
const DSH_IDE_SESSIONS_VIEW_ID = 'workbench.view.dshIdeSessions.list';
const sessionsViewIcon = registerIcon('dsh-ide-sessions-view-icon', Codicon.listTree, localize('dsh.sessions.viewIcon', 'View icon of the DSH-IDE sessions view.'));

const sessionsViewContainer: ViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: DSH_IDE_SESSIONS_CONTAINER_ID,
	title: localize2('dsh.sessions.container', "DSH 会话"),
	icon: sessionsViewIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [DSH_IDE_SESSIONS_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: DSH_IDE_SESSIONS_CONTAINER_ID,
	hideIfEmpty: false,
	order: 2,
}, ViewContainerLocation.Sidebar, { doNotRegisterOpenCommand: true });

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: DSH_IDE_SESSIONS_VIEW_ID,
	name: localize2('dsh.sessions.view', "会话"),
	containerIcon: sessionsViewIcon,
	canToggleVisibility: false,
	canMoveView: false,
	ctorDescriptor: new SyncDescriptor(DshIdeSessionsView),
}], sessionsViewContainer);

// 聊天面板与会话面板是 DSH-IDE 自己的两个面板（各自独立容器，不改原生 Chat）。
// 面板里的元素与消息流渲染抄 DSH 的聊天页；聊天内容来自内核那一次 follow。
const DSH_IDE_CHAT_CONTAINER_ID = 'workbench.view.dshIdeChat';
const DSH_IDE_CHAT_VIEW_ID = 'workbench.view.dshIdeChat.panel';
const chatViewIcon = registerIcon('dsh-ide-chat-view-icon', Codicon.commentDiscussion, localize('dsh.chat.viewIcon', 'View icon of the DSH-IDE chat view.'));

const chatViewContainer: ViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: DSH_IDE_CHAT_CONTAINER_ID,
	title: localize2('dsh.chat.container', "DSH 聊天"),
	icon: chatViewIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [DSH_IDE_CHAT_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: DSH_IDE_CHAT_CONTAINER_ID,
	hideIfEmpty: false,
	order: 1,
}, ViewContainerLocation.AuxiliaryBar, { doNotRegisterOpenCommand: true });

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: DSH_IDE_CHAT_VIEW_ID,
	name: localize2('dsh.chat.view', "聊天"),
	containerIcon: chatViewIcon,
	canToggleVisibility: false,
	canMoveView: false,
	ctorDescriptor: new SyncDescriptor(DshChatPanel),
}], chatViewContainer);
// 手动刷新 / 删除：命令经服务单一入口，不另建第二套取数或删除路径。
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'dshIde.sessions.refresh',
			title: localize2('dsh.sessions.refresh', "刷新 DSH 会话列表"),
			icon: Codicon.refresh,
			f1: true,
			menu: { id: MenuId.ViewTitle, when: ContextKeyExpr.equals('view', DSH_IDE_SESSIONS_VIEW_ID), group: 'navigation' },
		});
	}
	run(accessor: ServicesAccessor): void {
		void accessor.get(IDshIdeSessionsService).refresh();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'dshIde.sessions.new',
			title: localize2('dsh.sessions.new', "新建 DSH 会话"),
			icon: Codicon.add,
			f1: true,
			menu: { id: MenuId.ViewTitle, when: ContextKeyExpr.equals('view', DSH_IDE_SESSIONS_VIEW_ID), group: 'navigation' },
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IDshIdeSessionsService).createSession();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'dshIde.sessions.search',
			title: localize2('dsh.sessions.search', "搜索 DSH 会话"),
			icon: Codicon.search,
			f1: true,
			menu: { id: MenuId.ViewTitle, when: ContextKeyExpr.equals('view', DSH_IDE_SESSIONS_VIEW_ID), group: 'navigation' },
		});
	}
	async run(accessor: ServicesAccessor, query: unknown): Promise<void> {
		await accessor.get(IDshIdeSessionsService).search(typeof query === 'string' ? query : undefined);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'dshIde.sessions.delete',
			title: localize2('dsh.sessions.deleteAction', "删除 DSH 会话"),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor, sessionId: unknown): Promise<void> {
		if (typeof sessionId !== 'string' || sessionId === '') {
			return;
		}
		const result = await accessor.get(IDshIdeSessionsService).deleteSession(sessionId);
		if (!result.ok) {
			accessor.get(INotificationService).warn(localize('dsh.sessions.deleteFailed', "删除会话失败（{0}），列表保持不变。", result.error));
		}
	}
});

/** 消费 `dshIde` 通道的唯一快照流：`DshIdeConsumer` 负责校验与 fail-closed，
 * 本贡献点负责把帧交给 DSH 聊天面板，并把失败如实提示给用户。
 */
class DshClientContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IDshClientService client: IDshClientService,
		@INotificationService private readonly notifications: INotificationService,
		@ILanguageFeaturesService languageFeatures: ILanguageFeaturesService,
		@ILanguageModelsService languageModels: ILanguageModelsService,
		@ILogService logService: ILogService,
		@IDshIdeSessionsService sessions: IDshIdeSessionsService,
	) {
		super();
		// 会话服务是 Delayed 单例：由本贡献点主动取一次，保证首次取数接线不依赖用户是否打开会话视图。
		void sessions;
		// 把 DSH 模型目录注册成 Chat 的模型提供方。
		this._register({ dispose: registerDshLanguageModelProvider(languageModels, client, logService).dispose });
		const preset = readComposerPreset();
		const composer = this._register(new DshComposerSource(client, logService, preset));
		setDshComposerSource(composer);
		this._register({ dispose: () => setDshComposerSource(undefined) });
		this._register(client.onDidSnapshot(() => { void composer.refresh(); }));
		if (preset === undefined) {
			void composer.refresh();
		}
		registerDshInlineCompletions(languageFeatures, client);

		const consumer = this._register(new DshIdeConsumer());
		this._register(consumer.onDidFail((error: { readonly code: string }) => {
			this.notifications.warn(localize(
				'dsh.snapshotFailed',
				"DSH-IDE 帧被拒绝（{0}），界面保持上一次一致状态。",
				error.code,
			));
		}));
		// 帧直接交给聊天面板的会话状态；批准 / 问卷帧也走同一处，不弹通知。
		this._chat = dshChatSessionFor(client);
		this._register(consumer.onDidChangeFrame(({ state }) => this._chat.accept(state.frame)));
		this._register(client.onDidSnapshot(snapshot => consumer.accept(snapshot)));
		this._register(client.onDidWaterfall(notice => this._chat.acceptWaterfall(notice)));

		const sessionId = env[DSH_IDE_SESSION_ENV];
		const boundSessionId = sessionId === undefined || sessionId === '' ? undefined : sessionId;
		void client.openView({ view: 'chat', params: boundSessionId === undefined ? {} : { sessionId: boundSessionId } }).then(result => {
			if (!result.ok) {
				this.notifications.info(localize(
					'dsh.connectionUnavailable',
					"DSH-IDE AI 连接层尚未就绪（{0}），聊天暂不可用。",
					result.error.code,
				));
				return;
			}
			// 连接已按开窗参数建好：登记绑定并补读输入框目录，不重开流。
			void this._chat.attach(boundSessionId);
		});
	}

	private readonly _chat: DshChatSession;

	get chat(): DshChatSession {
		return this._chat;
	}
}

registerWorkbenchContribution2(DshClientContribution.name, DshClientContribution, WorkbenchPhase.AfterRestored);

/**
 * 读取开窗时由 Host 预置的输入框目录（`DSH_IDE_COMPOSER`）。
 *
 * 解析失败一律当作没有：宁可退回正常读取，也不能因为一段坏 JSON 让输入框不可用。
 */
function readComposerPreset(): unknown {
	const raw = env[DSH_IDE_COMPOSER_ENV];
	if (typeof raw !== 'string' || raw === '') {
		return undefined;
	}
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}
