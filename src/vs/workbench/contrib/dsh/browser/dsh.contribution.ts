/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Workbench 集成。
//
// 唯一 `dshIde` 通道由主进程分发（P3）。
// 聊天和 Sessions 都在 VS Code 的 Chat 视图容器里（ChatViewPane，见
// chatParticipant.contribution.ts）。不再注册左侧自建会话视图。
// 另外保留行内补全注册（通道未接线时优雅降级为无补全，不报错）。

import { localize } from '../../../../nls.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IDshClientService, DshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { DSH_IDE_SESSION_ENV, DSH_IDE_COMPOSER_ENV } from '../../../../platform/dshClient/common/env.js';
import { env } from '../../../../base/common/process.js';
import { registerDshInlineCompletions } from './inlineCompletion.js';
import { DshIdeConsumer } from './dshIdeConsumer.js';
import { DshChatSession, dshChatSessionFor } from './dshChatSession.js';
import { registerDshLanguageModelProvider } from './dshLanguageModelProvider.js';
import { DshComposerSource } from './dshComposerSource.js';
import { setDshComposerSource } from './dshComposerRegistry.js';
import { ILanguageModelsService } from '../../chat/common/languageModels.js';
import { IChatSessionsService } from '../../chat/common/chatSessionsService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerDshChatSessionContent, registerDshAnswerCommands } from './dshChatSessionContent.js';
import { IDshIdeSessionsService, DshIdeSessionsService } from './dshIdeSessionsService.js';
import { registerDshSessionSearchCommands } from './dshSessionSearchCommands.js';
import { registerDshSessionMenu } from './dshSessionMenu.js';
import { applyDshCapabilities } from './dshCapabilities.js';
import { validateCapabilities, type DshIdeCapabilities } from '../../../../platform/dshClient/common/dshIdeProtocol.js';
import { registerDshTeamCommands } from './dshTeamCommands.js';
import { registerDshIconReplacement } from './dshIconReplacement.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { openSessionByResource } from '../../chat/browser/agentSessions/agentSessionsOpener.js';
import { dshSessionResource } from './dshAgentSessionsController.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import './dshAgentSessionsController.js';

registerSingleton(IDshClientService, DshClientService, InstantiationType.Delayed);
registerSingleton(IDshIdeSessionsService, DshIdeSessionsService, InstantiationType.Delayed);

/** 消费 `dshIde` 通道的唯一快照流：`DshIdeConsumer` 负责校验与 fail-closed，
 * 本贡献点负责把帧交给 DSH 聊天面板，并把失败如实提示给用户。
 */
class DshClientContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IDshClientService client: IDshClientService,
		@INotificationService private readonly notifications: INotificationService,
		@ILanguageModelsService languageModels: ILanguageModelsService,
		@IChatSessionsService chatSessionsService: IChatSessionsService,
		@IDshIdeSessionsService private readonly _sessions: IDshIdeSessionsService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ILogService logService: ILogService,
	) {
		super();
		// 把 DSH 模型目录注册成 Chat 的模型提供方。
		this._register({ dispose: registerDshLanguageModelProvider(languageModels, client, logService).dispose });
		// `dsh:/<id>` 会话的聊天内容：没有这个 content provider，原生 ChatWidget
		// 打开 DSH 会话时拿不到任何 history（「选中会话后消息不显示」的根因）。
		this._register(registerDshChatSessionContent(client, chatSessionsService));
		// 原生 history 里的审批 / 问卷按钮调这两个命令，真正走 answerApproval/answerQuestion。
		this._register(registerDshAnswerCommands(client));
		registerDshSessionMenu();
		// 会话搜索：服务层早就实现，这里补上 quick pick 入口。
		this._register(registerDshSessionSearchCommands(client, this._sessions, this.quickInputService, this.instantiationService, this.notifications));
		// DSH 团队开关：原生模型选择器没有对应控件，用命令承接。
		this._register(registerDshTeamCommands(this.quickInputService, this.notifications));
		// DSH 图标：把语义对得上的 codicon 换成官方产品图形（混合状态，未命中保留 codicon）。
		this._register(registerDshIconReplacement());
		const preset = readComposerPreset();
		const composer = this._register(new DshComposerSource(client, logService, preset));
		setDshComposerSource(composer);
		this._register({ dispose: () => setDshComposerSource(undefined) });
		this._register(client.onDidSnapshot(() => { void composer.refresh(); }));
		if (preset === undefined) {
			void composer.refresh();
		}
		// 行内补全**不注册**：`ide/inlineComplete` 不在唯一通道白名单里，注册后永远拿不到结果。
		// 恢复条件见 `inlineCompletion.ts` 的说明；在此之前不假装可用，也不另开旁路。
		// 因此本贡献点也不再注入 `ILanguageFeaturesService`——留着只为传一个不用的参数是噪音。
		void registerDshInlineCompletions;
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
		this._register(consumer.onDidChangeFrame(({ state }) => {
			// 稳定路径读 typed 视图；`frame` 只作兼容回退（旧 Host 不带 typed 字段时）。
			this._chat.acceptView(state.view);
		}));
		this._register(client.onDidSnapshot(snapshot => consumer.accept(snapshot)));
		this._register(client.onDidWaterfall(notice => this._chat.acceptWaterfall(notice)));
		// 原生面板一次只画一题：这份问卷需要多题/多选答案时，明确告诉用户去桌面入口完成。
		this._register(this._chat.onDidNeedDesktopQuestion(() => {
			this.notifications.info(localize(
				'dsh.questionNeedsDesktop',
				"这条问卷需要在 DSH 桌面端完整回答；IDE 面板只显示第一题，未提交任何部分答案。",
			));
		}));
		// 回合结束只由 `api-session/status` 通知（`session-status`）：内容帧不带 running，
		// 不消费它的话 `running()` 会永远停在 true，面板永远显示「生成中」。
		this._register(client.onDidSessionNotice(notice => {
			if (notice.kind === 'status') {
				this._chat.acceptSessionStatus(notice.sessionId, notice.running);
			}
		}));

		// 依赖插件能力走独立 method：菜单按 context key 决定入口是否出现。
		// 旧 Host 没有这个 method、或调用失败时一律写全 false（fail-closed），不报错。
		const applyCaps = (caps: DshIdeCapabilities | undefined): void => {
			applyDshCapabilities(caps, (key, value) => { key.bindTo(contextKeyService).set(value); });
		};
		const refreshCapabilities = async (): Promise<void> => {
			const result = await client.call('capabilities', {});
			if (!result.ok) {
				applyCaps(undefined);
				return;
			}
			try {
				validateCapabilities(result.value);
				applyCaps(result.value);
			} catch {
				applyCaps(undefined);
			}
		};
		void refreshCapabilities();
		// 运行中安装/卸载插件不会发事件：连接期间低频重查，避免入口长期停在旧状态。
		const capabilityPoll = setInterval(() => {
			void client.getStatus().then(status => {
				if (status.connected) {
					void refreshCapabilities();
				}
			});
		}, 30_000);
		this._register({ dispose: () => clearInterval(capabilityPoll) });
		this._register(client.onDidChangeState(state => {
			if (state.connected) {
				// 重连后必须清掉熔断与旧版本基线：否则一次 stale 帧会让 consumer 永久拒帧，
				// 只能靠重载窗口恢复。
				consumer.reset();
				void refreshCapabilities();
			}
		}));

		const sessionId = env[DSH_IDE_SESSION_ENV];
		const boundSessionId = sessionId === undefined || sessionId === '' ? undefined : sessionId;
		// 输入框的读取与写回同样带会话身份：未绑定时不发请求，换绑后不跟随新会话。
		composer.setSession(boundSessionId);
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
		// 覆盖 common 层只「打开聊天面板」的同名命令：真正经内核建会话并切过去。
		this._register(CommandsRegistry.registerCommand('dsh.newSession', async () => {
			const created = await this._sessions.createSession();
			if (!created.ok) {
				this.notifications.warn(localize('dsh.newSessionFailed', "新建 DSH 会话失败：{0}", created.error));
				return;
			}
			if (created.sessionId !== undefined) {
				const bound = await this._chat.bind(created.sessionId);
				if (!bound) {
					this.notifications.warn(localize('dsh.bindFailed', "DSH 会话已创建，但绑定失败，请重新打开该会话。"));
					return;
				}
				// 按会话资源打开：`workbench.action.chat.open` 不带 `dsh:/<id>`，会停在当前会话。
				await this.instantiationService.invokeFunction(openSessionByResource, dshSessionResource(created.sessionId));
			}
		}));
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
