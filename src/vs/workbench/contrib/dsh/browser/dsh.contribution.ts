/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// Workbench 集成（阶段 3 第三批后）。
//
// 旧官方客户端连接层已整删，新 DshIdeChannel 骨架返回「重建中」。本文件保留行内补全注册
// （连接层重建中时优雅降级为无补全，不报错），并显式告知用户 AI 连接层正在重建中。

import { localize } from '../../../../nls.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IDshClientService, DshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { registerDshInlineCompletions } from './inlineCompletion.js';
import { env } from '../../../../base/common/process.js';

registerSingleton(IDshClientService, DshClientService, InstantiationType.Delayed);

if (env.DSH_IDE_ENDPOINT) {
	class DshClientContribution implements IWorkbenchContribution {
		constructor(
			@IDshClientService client: IDshClientService,
			@INotificationService private readonly notifications: INotificationService,
			@ILanguageFeaturesService languageFeatures: ILanguageFeaturesService,
		) {
			// R5：行内补全（DSH 后端；连接层重建中时优雅降级为无补全，不报错）。
			registerDshInlineCompletions(languageFeatures, client);
			// AI 连接层重建中：明确告知用户，不静默失败。
			this.notifications.info(localize('dsh.rebuild', "DSH-IDE AI 连接层正在重建中，Chat / 账号 / 语音暂不可用。"));
		}
	}

	registerWorkbenchContribution2('workbench.contrib.dshClient', DshClientContribution, WorkbenchPhase.AfterRestored);
}
