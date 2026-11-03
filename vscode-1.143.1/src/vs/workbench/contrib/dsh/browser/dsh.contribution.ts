/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH-IDE Workbench 贡献装配（v2 / R1）。
//
// v2 定稿：DSH-IDE 是运行中 DSH Host 的「第二个官方客户端」，全官方传输。
// R1 只装配「官方客户端服务 + 最小连通 smoke」：
//   - 始终注册 IDshClientService 单例（主进程经 'dshClient' 频道持 cookie）。
//   - 当由 dsh-ide 拉起（注入 DSH_IDE_ENDPOINT）时，启动后自动做一次官方连通 smoke：
//     打印 `session/list` 结果并弹出通知 —— 证明「同一 Host + 官方 /api」可达（G1 的 R1 子集）。
//
// 说明：v1 的私有管道贡献（聊天 WebviewView / 通道 B ideExec 桥 / 内联补全）将在 R2 改为官方 connection 并删除。

import { localize } from '../../../../nls.js';
import { registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IDshClientService, DshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

// 官方客户端服务单例（始终注册；未注入 endpoint 时 getStatus 返回未连接，安全降级）。
registerSingleton(IDshClientService, DshClientService, InstantiationType.Delayed);

if (typeof process !== 'undefined' && process.env && process.env.DSH_IDE_ENDPOINT) {
	// R1 连通 smoke：启动后对同一 Host 调官方 session/list，证明官方 /api 通路可用。
	class DshClientSmokeContribution implements IWorkbenchContribution {
		constructor(
			@IDshClientService private readonly client: IDshClientService,
			@INotificationService private readonly notifications: INotificationService,
		) {
			void this.run();
		}

		private async run(): Promise<void> {
			const status = await this.client.getStatus();
			if (!status.connected) {
				this.notifications.warn(localize('dsh.smoke.notConnected', "DSH-IDE: 未连上 DSH Host（官方 /connect 失败）。请确认 DSH 桌面 App 正在运行，并从其「在 IDE 中打开」启动本窗口。"));
				return;
			}
			const res = await this.client.call<{ items?: Array<{ sessionId?: string }> }>('session/list', {});
			if (res.ok) {
				const n = Array.isArray(res.value?.items) ? res.value.items.length : 0;
				console.log('[dsh-ide][smoke] session/list OK', res.value);
				this.notifications.info(localize('dsh.smoke.ok', "DSH-IDE 已连通 DSH Host（官方传输）。当前可见会话数：{0}", n));
			} else {
				console.error('[dsh-ide][smoke] session/list failed', res.error);
				this.notifications.error(localize('dsh.smoke.failed', "DSH-IDE 官方 session/list 失败：{0}", res.error?.message ?? 'unknown'));
			}
		}
	}
	registerWorkbenchContribution2('workbench.contrib.dshClientSmoke', DshClientSmokeContribution, WorkbenchPhase.AfterRestored);
}
