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
import { IDshClientService, DshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
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
import { ILogService } from '../../../../platform/log/common/log.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import './dshAgentSessionsController.js';

registerSingleton(IDshClientService, DshClientService, InstantiationType.Delayed);

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
	) {
		super();
		// 聊天画面由 DshChatModelDriver 把 DSH 帧直接写进原生 ChatModel。
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
		this._register(consumer.onDidChangeFrame(({ state }) => {
				this._chat.accept(state.frame);
		}));
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
