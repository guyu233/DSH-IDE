/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH-IDE Workbench 贡献装配（v2）。
//
// v2 定稿：DSH-IDE 是运行中 DSH Host 的「第二个官方客户端」，全官方传输。
//   - 始终注册 IDshClientService 单例（主进程经 'dshClient' 频道持官方 cookie）。
//   - 当由 dsh-ide 拉起（注入 DSH_IDE_ENDPOINT）时：
//       · R1 启动 smoke：官方 session/list 证明连通；
//       · R5 行内补全：注册 InlineCompletionItemProvider（后端 Host ide/inlineComplete）。
//   - 聊天由内建 Local 聊天承载，回答经 DshChatBridge → 官方 /api + /api/remote.mux。

import { localize } from '../../../../nls.js';
import { registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IDshClientService, DshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { registerDshInlineCompletions } from './inlineCompletion.js';

// 官方客户端服务单例（始终注册；未注入 endpoint 时 getStatus 返回未连接，安全降级）。
registerSingleton(IDshClientService, DshClientService, InstantiationType.Delayed);

if (typeof process !== 'undefined' && process.env && process.env.DSH_IDE_ENDPOINT) {
	// R1 连通 smoke + R5 行内补全。
	class DshClientContribution implements IWorkbenchContribution {
		constructor(
			@IDshClientService private readonly client: IDshClientService,
			@INotificationService private readonly notifications: INotificationService,
			@ILanguageFeaturesService languageFeatures: ILanguageFeaturesService,
		) {
			// R5：行内补全（DSH 后端；Host 未实现时优雅降级）。
			registerDshInlineCompletions(languageFeatures, client);
			void this.smoke();
		}

		private async smoke(): Promise<void> {
			const status = await this.client.getStatus();
			if (!status.connected) {
				this.notifications.warn(localize('dsh.smoke.notConnected', "DSH-IDE: 未连上 DSH Host（官方 token 交换失败）。请确认 DSH 桌面 App 正在运行，并从其「在 IDE 中打开」启动本窗口。"));
				return;
			}
			const res = await this.client.call<{ items?: Array<{ sessionId?: string }> }>('session/list', {});
			if (res.ok) {
				const n = Array.isArray(res.value?.items) ? res.value.items.length : 0;
				console.log('[dsh-ide][smoke] session/list OK', res.value);
				this.notifications.info(localize('dsh.smoke.ok', "DSH-IDE 已连通 DSH Host（官方传输）。当前可见会话数：{0}", n));
			} else {
				this.notifications.error(localize('dsh.smoke.failed', "DSH-IDE 官方 session/list 失败：{0}", res.error?.message ?? 'unknown'));
			}
		}
	}
	registerWorkbenchContribution2('workbench.contrib.dshClient', DshClientContribution, WorkbenchPhase.AfterRestored);
}
