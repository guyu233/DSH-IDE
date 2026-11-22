/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 会话搜索的命令入口（手册 §3.4「会话切换/搜索/历史 → 会话控制器 quick pick」）。
//
// 服务层 `DshIdeSessionsService.search()` 早就实现（走官方 `session/search`），
// 但没有 UI 调用方。这里用 VS Code 原生 quick pick 承接：输入关键字 → 列出命中会话
// → 选中即打开对应 `dsh:/<id>` 原生聊天视图。

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { CommandsRegistry, ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { localize2 } from '../../../../../nls.js';
import { IQuickInputService, IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { localize } from '../../../../../nls.js';
import { IDshClientService } from '../../../../../platform/dshClient/common/dshClientService.js';
import { openSessionByResource } from '../../../chat/browser/agentSessions/agentSessionsOpener.js';
import { IDshIdeSessionsService } from './dshIdeSessionsService.js';
import { dshChatSessionFor } from './dshChatSession.js';
import { dshSessionResource } from './dshAgentSessionsController.js';
import { dshDone, dshFail } from '../dshNotice.js';

/** quick pick 里的一行：会话 id 藏在 `sessionId` 上，`label` 显示摘要。 */
interface IDshSessionSearchPick extends IQuickPickItem {
	readonly sessionId: string;
}

/**
 * 注册 `dsh.searchSessions`。
 *
 * 空关键字直接返回（不把「没输入」当成「搜索全部」，避免一次调用拉全量会话）。
 * 选中后先把聊天面板绑到该会话，再打开聊天视图——与 `dsh.newSession` 同一条绑定路径。
 */
export function registerDshSessionSearchCommands(
	client: IDshClientService,
	sessions: IDshIdeSessionsService,
	quickInputService: IQuickInputService,
	instantiationService: IInstantiationService,
	notifications: INotificationService,
): { dispose(): void } {
	const disposables = new DisposableStore();
	disposables.add(CommandsRegistry.registerCommand('dsh.searchSessions', async () => {
		const query = await quickInputService.input({
			placeHolder: localize('dsh.searchSessions.placeholder', "Search DSH sessions (title or body)"),
			prompt: localize('dsh.searchSessions.prompt', "Type a keyword and press Enter"),
		});
		if (query === undefined || query.trim() === '') {
			return;
		}
		const result = await sessions.search(query.trim());
		if (!result.ok) {
			dshFail(notifications, localize('dsh.searchSessions.failed', "DSH-IDE: session search failed: {0}", result.error));
			return;
		}
		if (result.items.length === 0) {
			dshDone(notifications, localize('dsh.searchSessions.empty', "No matching DSH sessions."));
			return;
		}
		// 官方单批上限 20 条：还有下一批时必须说明，否则用户以为这就是全部命中。
		if (result.hasMore) {
			dshDone(notifications, localize('dsh.searchSessions.truncated', "More than {0} sessions matched; only the first {0} are listed. Narrow the search with a more specific keyword.", result.items.length));
		}
		const picks: IDshSessionSearchPick[] = result.items.map(item => ({
			sessionId: item.sessionId,
			label: item.sessionId,
			description: item.snippet,
		}));
		const picked = await quickInputService.pick(picks, {
			placeHolder: localize('dsh.searchSessions.pick', "Pick a DSH session to open"),
		});
		if (picked === undefined) {
			return;
		}
		const bound = await dshChatSessionFor(client).bind(picked.sessionId);
		if (!bound) {
			dshFail(notifications, localize('dsh.searchSessions.bindFailed', "DSH-IDE: could not bind the session. Try again."));
			return;
		}
		sessions.bind(picked.sessionId);
		// 必须按会话资源打开：`workbench.action.chat.open` 只打开面板，不带 `dsh:/<id>`，
		// 原生面板会停在当前会话而不是用户选中的那个。
		await instantiationService.invokeFunction(openSessionByResource, dshSessionResource(picked.sessionId));
	}));
	return disposables;
}
/** 命令面板入口：`dsh.searchSessions`。 */
export function registerDshSessionSearchAction(): { dispose(): void } {
	const action = registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'dsh.searchSessions.palette',
				title: localize2('dsh.search.title', "Search DSH sessions"),
				menu: { id: MenuId.CommandPalette },
			});
		}
		async run(accessor: ServicesAccessor): Promise<void> {
			await accessor.get(ICommandService).executeCommand('dsh.searchSessions');
		}
	});
	return { dispose: () => action.dispose() };
}
