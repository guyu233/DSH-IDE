/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 自己的 MCP 管理入口。
//
// 这里只管理 DeepSeek Harness 的 `mcpManager`：列出服务器状态、重启单个服务器。
// IDE 原有的 MCP 扩展栈（McpRegistry / McpService / McpWorkbenchService）是另一套，
// 服务普通扩展与工作区配置，不因本命令而删除或替换。

import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { localize, localize2 } from '../../../../nls.js';
import { IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import { dshErrorText } from '../../../../platform/dshClient/common/dshIdeProtocol.js';
import { dshMcpChoices } from './dshRuntimeLists.js';

/** 注册 `dsh.mcp`：列出 DSH 管理的 MCP 服务器并可重启其中一个。 */
export function registerDshMcpCommand(
	client: IDshClientService,
	quickInputService: IQuickInputService,
	notifications: INotificationService,
): { dispose(): void } {
	const disposables = new DisposableStore();
	disposables.add(CommandsRegistry.registerCommand('dsh.mcp', async () => {
		const listed = await client.call('mcpListServers', {});
		if (!listed.ok) {
			const detail = dshErrorText(listed.error, localize('dsh.mcp.listFailedUnknown', "未知原因"));
			notifications.error(localize('dsh.mcp.listFailed', "读取 DSH MCP 服务器失败：{0}", detail));
			return;
		}
		const raw = Array.isArray(listed.value) ? listed.value : [];
		const servers = dshMcpChoices(raw);
		if (servers.length === 0) {
			notifications.info(raw.length === 0
				? localize('dsh.mcp.empty', "DeepSeek Harness 当前没有配置 MCP 服务器。")
				: localize('dsh.mcp.unreadable', "MCP 服务器列表无法识别，没有可重启的条目。"));
			return;
		}
		const picked = await quickInputService.pick(
			servers.map(server => ({
				label: server.name,
				description: server.description,
				picked: false,
			})),
			{ placeHolder: localize('dsh.mcp.pick', "选择一个 DSH MCP 服务器进行重启") },
		);
		if (picked === undefined) {
			return;
		}
		const restarted = await client.call('mcpRestartServer', { name: picked.label });
		if (!restarted.ok) {
			const detail = dshErrorText(restarted.error, localize('dsh.mcp.restartFailedUnknown', "未知原因"));
			notifications.error(localize('dsh.mcp.restartFailed', "重启 MCP 服务器失败：{0}", detail));
			return;
		}
		notifications.info(localize('dsh.mcp.restarted', "已重启 MCP 服务器 {0}", picked.label));
	}));
	return disposables;
}

/** 命令面板入口：`dsh.mcp`。 */
export function registerDshMcpAction(): { dispose(): void } {
	const action = registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'dsh.mcp.palette',
				title: localize2('dsh.mcp.title', "管理 DSH MCP 服务器"),
				menu: { id: MenuId.CommandPalette },
			});
		}
		async run(accessor: ServicesAccessor): Promise<void> {
			await accessor.get(ICommandService).executeCommand('dsh.mcp');
		}
	});
	return { dispose: () => action.dispose() };
}
