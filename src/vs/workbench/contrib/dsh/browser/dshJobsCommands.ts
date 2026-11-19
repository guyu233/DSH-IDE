/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 后台作业入口。
//
// 只覆盖 DSH 自己注册的后台作业（`jobController`）。IDE 的 TaskService、
// 终端任务、问题匹配器与扩展任务执行是另一套，服务普通构建与调试，不因本命令而替换。

import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { localize, localize2 } from '../../../../nls.js';
import { IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import { dshChatSessionFor } from './dshChatSession.js';

/** 官方 `JobView` 的线协议子集。 */
interface DshJobView {
	readonly id: string;
	readonly kind: string;
	readonly label: string;
	readonly status: string;
	readonly progress?: string;
	readonly detail?: string;
}

/** 把作业状态合成一行描述；缺省字段不显示，不补占位。 */
function describeJob(job: DshJobView): string {
	const parts: string[] = [job.status];
	if (job.progress !== undefined && job.progress !== '') {
		parts.push(job.progress);
	}
	if (job.detail !== undefined && job.detail !== '') {
		parts.push(job.detail);
	}
	return parts.join(' · ');
}

/** 注册 `dsh.jobs`：列出当前会话的后台作业，并可终止其中一个。 */
export function registerDshJobsCommand(
	client: IDshClientService,
	quickInputService: IQuickInputService,
	notifications: INotificationService,
): { dispose(): void } {
	const disposables = new DisposableStore();
	disposables.add(CommandsRegistry.registerCommand('dsh.jobs', async () => {
		const sessionId = dshChatSessionFor(client).activeSessionId;
		if (sessionId === undefined) {
			notifications.warn(localize('dsh.jobs.noSession', "当前没有绑定 DSH 会话，无法读取后台作业。"));
			return;
		}
		const listed = await client.call<readonly DshJobView[]>('jobList', { sessionId });
		if (!listed.ok) {
			notifications.error(localize('dsh.jobs.listFailed', "读取后台作业失败：{0}", listed.error.message));
			return;
		}
		const jobs = Array.isArray(listed.value) ? listed.value : [];
		if (jobs.length === 0) {
			notifications.info(localize('dsh.jobs.empty', "当前会话没有后台作业。"));
			return;
		}
		const picked = await quickInputService.pick(
			jobs.map(job => ({
				label: job.label,
				description: describeJob(job),
				job,
			})),
			{ placeHolder: localize('dsh.jobs.pick', "选择一个后台作业进行终止") },
		);
		if (picked === undefined) {
			return;
		}
		const killed = await client.call('jobKill', { sessionId, jobId: picked.job.id });
		if (!killed.ok) {
			notifications.error(localize('dsh.jobs.killFailed', "终止后台作业失败：{0}", killed.error.message));
		}
	}));
	return disposables;
}

/** 命令面板入口：`dsh.jobs`。 */
export function registerDshJobsAction(): { dispose(): void } {
	const action = registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'dsh.jobs.palette',
				title: localize2('dsh.jobs.title', "查看 DSH 后台作业"),
				menu: { id: MenuId.CommandPalette },
			});
		}
		async run(accessor: ServicesAccessor): Promise<void> {
			await accessor.get(ICommandService).executeCommand('dsh.jobs');
		}
	});
	return { dispose: () => action.dispose() };
}
