/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// Workbench 集成。
//
// 旧官方客户端连接层已整删，唯一的 `dshIde` 通道由主进程分发（P3）。本文件保留行内补全注册
// （通道未接线时优雅降级为无补全，不报错），并显式告知用户 AI 连接层尚未接线。

import { localize, localize2 } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IDshClientService, DshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { DSH_IDE_SESSION_ENV } from '../../../../platform/dshClient/common/env.js';
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
import { DshIdeConsumer, type DshIdeConsumerState } from './dshIdeConsumer.js';
import { setDshChatRenderEnabled } from './dshChatSeam.js';
import { registerDshChatAgent } from './dshChatAgent.js';
import { IChatAgentService } from '../../chat/common/participants/chatAgents.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { DshIdeSessionsService, IDshIdeSessionsService } from './dshIdeSessionsService.js';
import { DshIdeSessionsView } from './dshIdeSessionsView.js';

registerSingleton(IDshClientService, DshClientService, InstantiationType.Delayed);
registerSingleton(IDshIdeSessionsService, DshIdeSessionsService, InstantiationType.Delayed);

// D49：会话列表视图容器（§8.10.2 两态）。自带容器，不改 contrib/chat/**、不接 AgentHost 会话服务。
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

// 手动刷新 / 删除：命令经服务单一入口，不另建第二套取数或删除路径（§8.10.2）。
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
 * 本贡献点负责「开视图 → 订阅 → 把行交给渲染方」，并把失败如实提示给用户。
 *
 * 无论是否配置了远端端点都要注册：`DshClientService` 在未接线时会明确返回
 * `feature-unavailable`（不伪造状态），用户应看到确定提示而不是「什么都没有」。
 */
class DshClientContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IDshClientService client: IDshClientService,
		@INotificationService private readonly notifications: INotificationService,
		@ILanguageFeaturesService languageFeatures: ILanguageFeaturesService,
		@IChatAgentService chatAgents: IChatAgentService,
		@IDshIdeSessionsService sessions: IDshIdeSessionsService,
	) {
		super();
		// 会话服务是 Delayed 单例：由本贡献点（AfterRestored 时创建）主动取一次，
		// 保证首次取数与窗口聚焦重拉接线不依赖用户是否打开会话视图（§8.10.2）。
		void sessions;
		// 行内补全（DSH 后端；未接线时优雅降级为无补全，不报错）。
		registerDshInlineCompletions(languageFeatures, client);

		// 启用单接缝：只有在收到第一份来自 dshIde 的 ready 快照后才打开，
		// 保证纯净 VS Code 窗口（无 DSH 快照）的渲染行为零变化（第 8 章 §8.3.2）。
		// 历史上 `setDshChatRenderEnabled` 全仓无调用方，接缝恒休眠——这是 P4 要修的实质缺陷。
		const consumer = this._register(new DshIdeConsumer());

		// 唯一 Chat Agent：Chat 面板只在真实 request 的 response 里渲染内容，
		// 没有 Agent 就没有 request，面板必然空白。用户消息交给 DSH，回显只来自 DTO 快照。
		const agentRegistration = this._register(registerDshChatAgent(chatAgents, client, () => this._rows.map(row => row)));
		void agentRegistration;
		this._register(consumer.onDidFail((error: { readonly code: string }) => {
			// 连续性失败必须让用户知道，不能静默丢弃帧（第 2 章 E4 / E7）。
			this.notifications.warn(localize(
				'dsh.snapshotFailed',
				"DSH-IDE 快照被拒绝（{0}），界面保持上一次一致状态。",
				error.code,
			));
		}));
		this._register(consumer.onDidChangeRows(({ state }: { state: DshIdeConsumerState }) => {
			if (state.phase === 'ready' && state.rows.length > 0) {
				// 有真实 DTO 投影内容时才启用接缝，避免空面板也走 DSH 渲染件。
				setDshChatRenderEnabled(true);
			}
			// 这里只维护可读快照，不直接写 Chat 模型：DSH-IDE 的 Chat 容器没有 DSH 会话，
			// 伪造一个 request 往模型里塞 progress 会让会话状态与 DSH 真源不一致（第 1 章 §4.5）。
			this._lastState = state;
			this._rows = state.rows;
		}));
		this._register(client.onDidSnapshot(snapshot => consumer.accept(snapshot)));

		// 打开视图：必须带要跟随的会话 id，否则后端只订阅 `$events`（拿不到会话内容），
		// Chat 面板永远没有行。会话由 DSH 决定，经开窗方的 `userEnv` 传进来，IDE 不自己猜。
		const sessionId = env[DSH_IDE_SESSION_ENV];
		void client.openView({ view: 'chat', params: sessionId === undefined || sessionId === '' ? {} : { sessionId } }).then(result => {
			if (!result.ok) {
				this.notifications.info(localize(
					'dsh.connectionUnavailable',
					"DSH-IDE AI 连接层尚未就绪（{0}），Chat 暂不可用。",
					result.error.code,
				));
			}
		});

		// 会话列表绑定由服务构造时经开窗参数自行完成，绑定值不在贡献点重复推断。
	}

	private _lastState: DshIdeConsumerState | undefined;
	private _rows: readonly import('../../../../platform/dshClient/common/dshIdeProtocol.js').DshIdeRow[] = [];

	/** 最近一次被接受的渲染状态。 */
	get lastState(): DshIdeConsumerState | undefined {
		return this._lastState;
	}
}

registerWorkbenchContribution2('workbench.contrib.dshClient', DshClientContribution, WorkbenchPhase.AfterRestored);
