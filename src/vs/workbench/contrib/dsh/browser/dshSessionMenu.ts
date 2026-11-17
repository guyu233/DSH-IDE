/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 会话行的右键菜单，条目与桌面端会话菜单对齐。
// 只对 `chatSessionType == dsh` 出现。原生「Open as Editor / Mark as Done」由调用方滤掉。

import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { URI } from '../../../../base/common/uri.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import { ChatContextKeys } from '../../chat/common/actions/chatContextKeys.js';
import { openSessionByResource } from '../../chat/browser/agentSessions/agentSessionsOpener.js';
import { dshSessionIdFromResource, dshSessionResource } from './dshAgentSessionsController.js';
import { dshCapsContext } from './dshCapabilities.js';

const DSH_SESSION = ChatContextKeys.agentSessionType.isEqualTo('dsh');

function sessionIdFromArg(arg: unknown): string | undefined {
	if (arg === null || typeof arg !== 'object' || !('session' in arg)) {
		return undefined;
	}
	const session = (arg as { session?: { resource?: URI } }).session;
	const resource = session?.resource;
	if (!URI.isUri(resource)) {
		return undefined;
	}
	return dshSessionIdFromResource(resource);
}

async function fail(notifications: INotificationService, error: { message?: string } | undefined, fallback: string): Promise<void> {
	notifications.warn(error?.message && error.message !== '' ? error.message : fallback);
}

function registerSessionAction(options: {
	readonly id: string;
	/** 已由调用方 `localize2` 解析好的标题（NLS 的 key 必须是字面量，不能在此处动态拼）。 */
	readonly title: ReturnType<typeof localize2>;
	readonly order: number;
	readonly group: string;
	readonly icon?: typeof Codicon.star;
	readonly capability?: 'rewind' | 'sessionFavorite' | 'sessionMove' | 'sessionDelete';
	readonly keybinding?: number;
	readonly run: (accessor: ServicesAccessor, sessionId: string) => Promise<void>;
}): void {
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: options.id,
				title: options.title,
				icon: options.icon,
				...(options.keybinding === undefined ? {} : {
					keybinding: {
						primary: options.keybinding,
						weight: KeybindingWeight.WorkbenchContrib + 1,
						when: ContextKeyExpr.and(ChatContextKeys.agentSessionsViewerFocused, DSH_SESSION),
					},
				}),
				menu: {
					id: MenuId.AgentSessionsContext,
					group: options.group,
					order: options.order,
					when: ContextKeyExpr.and(DSH_SESSION, options.capability === undefined ? undefined : dshCapsContext(options.capability)),
				},
			});
		}
		async run(accessor: ServicesAccessor, arg: unknown): Promise<void> {
			const sessionId = sessionIdFromArg(arg);
			if (sessionId === undefined) {
				return;
			}
			await options.run(accessor, sessionId);
		}
	});
}

/** 注册与 DSH 会话菜单对齐的命令。 */
export function registerDshSessionMenu(): void {
	registerSessionAction({
		id: 'dsh.session.favorite',
		title: localize2('dsh.session.favorite', "收藏"),
		order: 1,
		group: '1_dsh',
		capability: 'sessionFavorite',
		icon: Codicon.star,
		run: async (accessor, sessionId) => {
			const result = await accessor.get(IDshClientService).call('setSessionFavorite', { sessionId });
			if (!result.ok) {
				await fail(accessor.get(INotificationService), result.error, localize('dsh.session.favoriteFailed', "收藏会话失败"));
			}
		},
	});
	registerSessionAction({
		id: 'dsh.session.pin',
		title: localize2('dsh.session.pin', "置顶会话"),
		order: 2,
		group: '1_dsh',
		run: async (accessor, sessionId) => {
			const result = await accessor.get(IDshClientService).call('setSessionPinned', { sessionId });
			if (!result.ok) {
				await fail(accessor.get(INotificationService), result.error, localize('dsh.session.pinFailed', "置顶会话失败"));
			}
		},
	});
	registerSessionAction({
		id: 'dsh.session.rename',
		title: localize2('dsh.session.rename', "重命名"),
		order: 1,
		group: '2_dsh',
		keybinding: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyG,
		run: async (accessor, sessionId) => {
			const title = await accessor.get(IQuickInputService).input({
				prompt: localize('dsh.session.renamePrompt', "会话标题"),
				placeHolder: localize('dsh.session.renamePlaceholder', "输入新标题"),
			});
			if (title === undefined || title.trim() === '') {
				return;
			}
			const result = await accessor.get(IDshClientService).call('renameSession', { sessionId, title: title.trim() });
			if (!result.ok) {
				await fail(accessor.get(INotificationService), result.error, localize('dsh.session.renameFailed', "重命名失败"));
			}
		},
	});
	registerSessionAction({
		id: 'dsh.session.fork',
		title: localize2('dsh.session.fork', "分叉会话"),
		order: 2,
		group: '2_dsh',
		keybinding: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyF,
		run: async (accessor, sessionId) => {
			const client = accessor.get(IDshClientService);
			const result = await client.call<{ readonly sessionId?: string }>('fork', { sessionId });
			if (!result.ok) {
				await fail(accessor.get(INotificationService), result.error, localize('dsh.session.forkFailed', "分叉会话失败"));
				return;
			}
			if (typeof result.value.sessionId === 'string' && result.value.sessionId !== '') {
				await accessor.get(IInstantiationService).invokeFunction(openSessionByResource, dshSessionResource(result.value.sessionId));
			}
		},
	});
	registerSessionAction({
		id: 'dsh.session.copyId',
		title: localize2('dsh.session.copyId', "复制 Session ID"),
		order: 3,
		group: '2_dsh',
		run: async (accessor, sessionId) => {
			await accessor.get(IClipboardService).writeText(sessionId);
		},
	});
	registerSessionAction({
		id: 'dsh.session.openPath',
		title: localize2('dsh.session.openPath', "在应用中打开"),
		order: 1,
		group: '3_dsh',
		run: async (accessor, sessionId) => {
			const result = await accessor.get(IDshClientService).call('openSessionPath', { sessionId });
			if (!result.ok) {
				await fail(accessor.get(INotificationService), result.error, localize('dsh.session.openPathFailed', "无法打开会话所在目录"));
			}
		},
	});
	registerSessionAction({
		id: 'dsh.session.move',
		title: localize2('dsh.session.move', "移动到工作区"),
		order: 2,
		group: '3_dsh',
		capability: 'sessionMove',
		run: async (accessor, sessionId) => {
			const client = accessor.get(IDshClientService);
			const notifications = accessor.get(INotificationService);
			const listed = await client.call<readonly { readonly id?: string; readonly title?: string; readonly path?: string }[]>('listWorkspaces', {});
			if (!listed.ok || !Array.isArray(listed.value) || listed.value.length === 0) {
				await fail(notifications, listed.ok ? undefined : listed.error, localize('dsh.session.moveEmpty', "没有可移动到的工作区"));
				return;
			}
			const picked = await accessor.get(IQuickInputService).pick(
				listed.value.flatMap(workspace => {
					if (typeof workspace.id !== 'string' || workspace.id === '') {
						return [];
					}
					const title = typeof workspace.title === 'string' && workspace.title !== '' ? workspace.title : workspace.id;
					return [{ id: workspace.id, label: title, description: workspace.path }];
				}),
				{ placeHolder: localize('dsh.session.movePlaceholder', "选择目标工作区") },
			);
			if (picked === undefined || typeof picked.id !== 'string') {
				return;
			}
			const moved = await client.call('moveSession', { sessionId, workspaceId: picked.id });
			if (!moved.ok) {
				await fail(notifications, moved.error, localize('dsh.session.moveFailed', "移动会话失败"));
			}
		},
	});
	registerSessionAction({
		id: 'dsh.session.archive',
		title: localize2('dsh.session.archive', "归档会话"),
		order: 1,
		group: '4_dsh',
		keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyA,
		run: async (accessor, sessionId) => {
			const result = await accessor.get(IDshClientService).call('archiveSession', { sessionId });
			if (!result.ok) {
				await fail(accessor.get(INotificationService), result.error, localize('dsh.session.archiveFailed', "归档会话失败"));
			}
		},
	});
	registerSessionAction({
		id: 'dsh.session.delete',
		title: localize2('dsh.session.delete', "删除会话"),
		order: 1,
		group: '5_dsh',
		capability: 'sessionDelete',
		run: async (accessor, sessionId) => {
			const confirmed = await accessor.get(IDialogService).confirm({
				message: localize('dsh.session.deleteConfirm', "删除这个会话？此操作不能撤销。"),
				primaryButton: localize('dsh.session.deleteButton', "删除"),
			});
			if (!confirmed.confirmed) {
				return;
			}
			const result = await accessor.get(IDshClientService).call('deleteSession', { sessionId });
			if (!result.ok) {
				await fail(accessor.get(INotificationService), result.error, localize('dsh.session.deleteFailed', "删除会话失败"));
			}
		},
	});
}
