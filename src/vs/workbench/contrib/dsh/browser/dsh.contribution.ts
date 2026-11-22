/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Workbench 集成。
//
// 唯一 `dshIde` 通道由主进程分发（P3）。
// 聊天和 Sessions 都在 VS Code 的 Chat 视图容器里（ChatViewPane，见
// chatParticipant.contribution.ts）。不再注册左侧自建会话视图。
// 聊天主路径是开窗、跟随、发送和停止。目标、作业、MCP、斜杠命令和行内补全不在这条路径上。

import { localize } from '../../../../nls.js';
import { IChatWidgetService } from '../../chat/browser/chat.js';
import { dshDone, dshFail, dshLink } from './dshNotice.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IDshClientService, DshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { DSH_IDE_SESSION_ENV, DSH_IDE_COMPOSER_ENV } from '../../../../platform/dshClient/common/env.js';
import { env } from '../../../../base/common/process.js';
import { DshIdeConsumer } from './consumer/dshIdeConsumer.js';
import { DshChatSession, dshChatSessionFor } from './vscode/dshChatSession.js';
import { registerDshLanguageModelProvider } from './vscode/dshLanguageModelProvider.js';
import { DshComposerSource } from './vscode/dshComposerSource.js';
import { setDshComposerSource } from './vscode/dshComposerRegistry.js';
import { ILanguageModelsService } from '../../chat/common/languageModels.js';
import { IChatSessionsService, type IChatSessionsExtensionPoint } from '../../chat/common/chatSessionsService.js';
import { IChatSlashCommandService } from '../../chat/common/participants/chatSlashCommands.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerDshChatSessionContent, registerDshAnswerCommands } from './vscode/dshChatSessionContent.js';
import { IDshIdeSessionsService, DshIdeSessionsService } from './vscode/dshIdeSessionsService.js';
import { registerDshSessionSearchAction, registerDshSessionSearchCommands } from './vscode/dshSessionSearchCommands.js';
import { registerDshSessionMenu } from './vscode/dshSessionMenu.js';
import { applyDshCapabilities } from './vscode/dshCapabilities.js';
import { DSH_IDE_SNAPSHOT_STALE, validateCapabilities, type DshIdeCapabilities } from '../../../../platform/dshClient/protocol/dshIdeProtocol.js';
import { registerDshTeamAction, registerDshTeamCommands, registerDshTeamInputAction } from './vscode/dshTeamCommands.js';
import { registerDshIconReplacement } from './vscode/dshIconReplacement.js';
import { registerDshSlashCommands } from './vscode/dshSlashCommands.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { openSessionByResource } from '../../chat/browser/agentSessions/agentSessionsOpener.js';
import { dshSessionResource } from './vscode/dshAgentSessionsController.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { DshAttachmentFileSystemProvider } from './vscode/dshAttachmentFileSystem.js';
import { DshChatInputDockContribution } from './vscode/dshChatInputDockContribution.js';
import { DshChatAutoScrollHoldContribution } from './vscode/dshChatAutoScrollHold.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import './vscode/dshAgentSessionsController.js';

registerSingleton(IDshClientService, DshClientService, InstantiationType.Delayed);
registerSingleton(IDshIdeSessionsService, DshIdeSessionsService, InstantiationType.Delayed);

/**
 * `dsh` 会话类型的内置声明。
 *
 * 为什么必须显式登记：原生 Chat 的「会话级」行为（锁定到代理、显示模型/权限/预设选择器、
 * 会话类型图标与名称）都由 `chatSessionsService.getChatSessionContribution(type)` 驱动；
 * 没有这条声明，`dsh:` 会话会被当成 `local`，选择器不渲染、锁状态也不成立。
 *
 * `requiresCustomModels` 让模型列表只用 DSH 目录（不混入 VS Code 自带模型）；
 * `supportsAutoModel: false` 表示 DSH 没有合成「Auto」模型，缺目录时如实显示无模型。
 */
const DshChatSessionContribution: IChatSessionsExtensionPoint = {
	type: 'dsh',
	name: 'dsh',
	displayName: 'DSH-IDE',
	description: localize('dsh.chatSession.description', "DeepSeek Harness session"),
	requiresCustomModels: true,
	supportsAutoModel: false,
	supportsDelegation: false,
};

/** 消费 `dshIde` 通道的唯一快照流：`DshIdeConsumer` 负责校验与 fail-closed，
 * 本贡献点负责把帧交给 DSH 聊天面板，并把失败如实提示给用户。
 */
class DshClientContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IDshClientService client: IDshClientService,
		@INotificationService private readonly notifications: INotificationService,
		@ILanguageModelsService languageModels: ILanguageModelsService,
		@IChatSessionsService chatSessionsService: IChatSessionsService,
		@IChatWidgetService chatWidgetService: IChatWidgetService,
		@IDshIdeSessionsService private readonly _sessions: IDshIdeSessionsService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ILogService logService: ILogService,
		@IFileService fileService: IFileService,
		@IChatSlashCommandService slashCommandService: IChatSlashCommandService,
	) {
		super();
		// 把 DSH 模型目录注册成 Chat 的模型提供方。
		// 保留 provider 句柄：模型表只在目录变化时重新拉取，注册时那一次还没有会话，
		// 之后必须由快照/绑定驱动刷新，否则选择器会一直显示「无可用模型」。
		const modelProvider = registerDshLanguageModelProvider(languageModels, client, logService);
		this._register({ dispose: modelProvider.dispose });
		// `dsh:/<id>` 会话的聊天内容：没有这个 content provider，原生 ChatWidget
		// 打开 DSH 会话时拿不到任何 history（「选中会话后消息不显示」的根因）。
		this._register(registerDshChatSessionContent(client, chatSessionsService, chatWidgetService));
		// 会话类型声明：原生 Chat 只在 `getChatSessionContribution(type)` 非空时才锁到该代理、
		// 才显示会话级选择器（模型/权限/预设）。缺这条声明，DSH 会话被当成「本地会话」，
		// 三个选择器全部不渲染——这不是样式问题，是注册缺失。
		this._register(chatSessionsService.registerChatSessionContribution(DshChatSessionContribution));
		// 原生 history 里的审批 / 问卷按钮调这两个命令，真正走 answerApproval/answerQuestion。
		this._register(registerDshAnswerCommands(client));
		registerDshSessionMenu();
		// 会话搜索：服务层早就实现，这里补上 quick pick 入口。
		this._register(registerDshSessionSearchCommands(client, this._sessions, this.quickInputService, this.instantiationService, this.notifications));
		this._register(registerDshSessionSearchAction());
		// DSH 团队开关：原生模型选择器没有对应控件，用命令承接。
		this._register(registerDshTeamCommands(this.quickInputService, this.notifications));
		this._register(registerDshTeamAction());
		// 输入区「更多」里的团队开关：与命令面板共用同一个切换命令。
		this._register(registerDshTeamInputAction());
		// DSH 图标：把语义对得上的 codicon 换成官方产品图形（混合状态，未命中保留 codicon）。
		this._register(registerDshIconReplacement());
		// 输入区两个官方 dock 槽（`conversation.input.dock` / `conversation.composer.dock`）：
		// 它们是 DSH 输入区的一部分，但本仓的输入区是原生 ChatInputPart，没有消费点。
		// 由贡献点挂在每个原生 chat widget 的输入卡上下方，无 occupant 时不占位。
		this._register(instantiationService.createInstance(DshChatInputDockContribution));
		// 自动滚动归属（契约 §19 S5）：用户上滚阅读时持有原生 `holdAutoScroll()`，
		// 流式高度变化不再把视口拉回底部；发送或点回到底部时释放。
		this._register(instantiationService.createInstance(DshChatAutoScrollHoldContribution));
		// 会话附件的只读 URI 方案：原生 Chat 没有图片进度部件，附件以 `dsh-attachment:` 引用
		// 出现，由 VS Code 自己的查看器经 Host 官方附件服务读字节。
		this._register(new DshAttachmentFileSystemProvider(client, fileService));
		// DSH 自己的斜杠命令：`listCommands` 按会话取目录，执行只走 `runCommand`。
		// 不注册的话，IDE 输入框敲 `/` 永远看不到 DSH 命令。
		const slashCommandsBridge = this._register(registerDshSlashCommands(slashCommandService, client, logService));
		const preset = readComposerPreset();
		const composer = this._register(new DshComposerSource(client, logService, preset));
		setDshComposerSource(composer);
		this._register({ dispose: () => setDshComposerSource(undefined) });
		this._register(client.onDidSnapshot(() => {
			// 两处都要的是同一份 `composerState`（模型目录 + 当前选择）。各打一次的话，
			// 每帧快照就是两次跨进程调用。先刷 composer，再刷模型目录——后者读的是
			// 同一会话的同一接口，Host 侧已有短 TTL 缓存，不会重复问内核。
			void composer.refresh().then(() => modelProvider.provider.refresh(), () => modelProvider.provider.refresh());
		}));
		if (preset === undefined) {
			void composer.refresh();
		}
		const consumer = this._register(new DshIdeConsumer());
		this._register(consumer.onDidFail((error: { readonly code: string }) => {
			// 丢帧后 consumer 会熔断，只能靠一次显式重建恢复。`refreshSnapshot` 是契约里
			// 为此准备的唯一入口；不调用它，界面会永久停更（用户只能重载窗口）。
			if (error.code === DSH_IDE_SNAPSHOT_STALE) {
				void client.call('refreshSnapshot', {}).then(result => {
					if (result.ok) {
						consumer.reset();
					}
				}, () => undefined);
			}
			dshLink(this.notifications, localize(
				'dsh.snapshotFailed',
				"DSH-IDE: frame rejected ({0}); the UI keeps the last consistent state.",
				error.code,
			));
		}));
		// 帧直接交给聊天面板的会话状态；批准 / 问卷帧也走同一处，不弹通知。
		this._chat = dshChatSessionFor(client);
		this._register(this._chat.onDidFailAction(message => dshFail(this.notifications, message)));
		if (composer.onDidReject !== undefined) {
			this._register(composer.onDidReject(message => dshFail(this.notifications, message)));
		}
		this._register(consumer.onDidChangeFrame(({ state }) => {
			// 稳定路径读 typed 视图；`frame` 只作兼容回退（旧 Host 不带 typed 字段时）。
			this._chat.acceptView(state.view);
		}));
		this._register(client.onDidSnapshot(snapshot => consumer.accept(snapshot)));
		this._register(client.onDidWaterfall(notice => this._chat.acceptWaterfall(notice)));
		// 原生面板一次只画一题：这份问卷需要多题/多选答案时，明确告诉用户去桌面入口完成。
		this._register(this._chat.onDidNeedDesktopQuestion(() => {
			dshDone(this.notifications, localize(
				'dsh.questionNeedsDesktop',
				"This question must be answered completely in the DSH desktop app; the IDE panel shows only the first question and submits no partial answer.",
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
		// 性能：窗口在后台/最小化时不再轮询——那期间用户看不到菜单，重查纯属白耗 CPU 与
		// 一次跨进程调用。恢复可见时先补查一次，再继续计时，所以状态不会停在旧值。
		/** 断线只提示一次；重连成功后再复位，避免反复重试刷屏。 */
		let sawDisconnect = false;
		const CAPABILITY_POLL_MS = 60_000;
		let capabilityPoll: ReturnType<typeof setInterval> | undefined;
		const stopPoll = (): void => {
			if (capabilityPoll !== undefined) {
				clearInterval(capabilityPoll);
				capabilityPoll = undefined;
			}
		};
		const startPoll = (): void => {
			if (capabilityPoll !== undefined) {
				return;
			}
			capabilityPoll = setInterval(() => {
				void client.getStatus().then(status => {
					if (status.connected) {
						void refreshCapabilities();
					}
				});
			}, CAPABILITY_POLL_MS);
		};
		// 初始也要按可见性决定是否起轮询：窗口可能一启动就是隐藏的（例如在后台标签恢复），
		// 无条件 startPoll 会在用户根本没看的时候先转一圈。
		if (document.visibilityState === 'visible') {
			startPoll();
		}
		this._register({ dispose: stopPoll });
		// `document.visibilityState` 直接反映窗口是否在前台：比自建定时器判定更准，也更省。
		const onVisibilityChange = (): void => {
			if (document.visibilityState === 'visible') {
				void refreshCapabilities();
				startPoll();
			} else {
				stopPoll();
			}
		};
		document.addEventListener('visibilitychange', onVisibilityChange);
		this._register({ dispose: () => document.removeEventListener('visibilitychange', onVisibilityChange) });
		this._register(client.onDidChangeState(state => {
			if (state.connected) {
				// 重连后必须清掉熔断与旧版本基线：否则一次 stale 帧会让 consumer 永久拒帧，
				// 只能靠重载窗口恢复。
				consumer.reset();
				void refreshCapabilities();
				if (sawDisconnect) {
					sawDisconnect = false;
					dshLink(this.notifications, localize('dsh.reconnected', "DSH-IDE: reconnected to DeepSeek Harness."));
				}
				return;
			}
			// 断线时输入框仍可打字，但发送一定失败。不提示的话，用户会以为是自己按错了。
			// 只提示一次：连接层会反复重试，每次都弹就成了噪音。
			if (!sawDisconnect) {
				sawDisconnect = true;
				dshLink(this.notifications, localize('dsh.disconnected', "DSH-IDE: the connection to DeepSeek Harness is closed and retrying. Sending will fail in the meantime."));
			}
		}));

		const sessionId = env[DSH_IDE_SESSION_ENV];
		const boundSessionId = sessionId === undefined || sessionId === '' ? undefined : sessionId;
		// 输入框的读取与写回同样带会话身份：未绑定时不发请求，换绑后不跟随新会话。
		composer.setSession(boundSessionId);
		// 斜杠命令清单是 agent-scoped：绑定会话后立刻拉一次，否则 `/` 菜单永远为空。
		void slashCommandsBridge.setSession(boundSessionId);
		void client.openView({ view: 'chat', params: boundSessionId === undefined ? {} : { sessionId: boundSessionId } }).then(result => {
			if (!result.ok) {
				dshLink(this.notifications, localize(
					'dsh.connectionUnavailable',
					"DSH-IDE: the connection is not ready ({0}); chat is unavailable.",
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
				dshFail(this.notifications, localize('dsh.newSessionFailed', "DSH-IDE: could not create the session: {0}", created.error));
				return;
			}
			if (created.sessionId === undefined) {
				dshFail(this.notifications, localize('dsh.newSessionNoId', "DSH-IDE: the session was created but no session id was returned, so it cannot be opened."));
				return;
			}
				const bound = await this._chat.bind(created.sessionId);
				if (!bound) {
					dshFail(this.notifications, localize('dsh.bindFailed', "DSH-IDE: the session was created but binding failed. Reopen that session."));
					return;
				}
				// 按会话资源打开：`workbench.action.chat.open` 不带 `dsh:/<id>`，会停在当前会话。
				await this.instantiationService.invokeFunction(openSessionByResource, dshSessionResource(created.sessionId));
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
