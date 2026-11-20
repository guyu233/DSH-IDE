/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 会话行的右键菜单，条目与桌面端会话菜单对齐。
// 只对 `chatSessionType == dsh` 出现。原生「Open as Editor / Mark as Done」由调用方滤掉。

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { URI } from '../../../../base/common/uri.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ContextKeyExpr, ContextKeyExpression } from '../../../../platform/contextkey/common/contextkey.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import { dshErrorText } from '../../../../platform/dshClient/common/dshIdeProtocol.js';
import { IChatSessionsService } from '../../chat/common/chatSessionsService.js';
import { ChatContextKeys } from '../../chat/common/actions/chatContextKeys.js';
import { openSessionByResource } from '../../chat/browser/agentSessions/agentSessionsOpener.js';
import { dshSessionIdFromResource, dshSessionResource } from './dshAgentSessionsController.js';
import { dshMoveChoices, dshRewindSeq } from './dshSessionMove.js';
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
	// 会话操作失败是「用户刚才那一下没做成」，与目标 / 作业 / MCP 命令同一级别用 error。
	// 用 warn 的话提示更弱、也更容易被当成非致命提醒而忽略。
	notifications.error(dshErrorText(error, fallback));
}

/**
 * 把置顶写到 Host，成功后再改列表上的钉子。
 *
 * 原生 Pin 被 DSH 菜单滤掉了。只调 Host 的话，行还停在原处，用户会以为没点上。
 */
async function setPinned(accessor: ServicesAccessor, sessionId: string, arg: unknown, pinned: boolean): Promise<void> {
	const notifications = accessor.get(INotificationService);
	const result = await accessor.get(IDshClientService).call<{ readonly pinned?: boolean }>('setSessionPinned', { sessionId, pinned });
	if (!result.ok) {
		await fail(notifications, result.error, pinned
			? localize('dsh.session.pinFailed', "置顶会话失败")
			: localize('dsh.session.unpinFailed', "取消置顶失败"));
		return;
	}
	const applied = typeof result.value.pinned === 'boolean' ? result.value.pinned : pinned;
	if (arg !== null && typeof arg === 'object' && 'session' in arg) {
		const session = (arg as { session?: { setPinned?: (value: boolean) => void } }).session;
		session?.setPinned?.(applied);
	}
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
	readonly when?: ContextKeyExpression;
	readonly run: (accessor: ServicesAccessor, sessionId: string, arg: unknown) => Promise<void>;
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
					when: ContextKeyExpr.and(DSH_SESSION, options.when, options.capability === undefined ? undefined : dshCapsContext(options.capability)),
				},
			});
		}
		async run(accessor: ServicesAccessor, arg: unknown): Promise<void> {
			const sessionId = sessionIdFromArg(arg);
			if (sessionId === undefined) {
				return;
			}
			await options.run(accessor, sessionId, arg);
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
		when: ChatContextKeys.isArchivedAgentSession.negate(),
		capability: 'sessionFavorite',
		icon: Codicon.star,
		run: async (accessor, sessionId) => {
			const notifications = accessor.get(INotificationService);
			const result = await accessor.get(IDshClientService).call<{ readonly favorite?: boolean }>('setSessionFavorite', { sessionId });
			if (!result.ok) {
				await fail(notifications, result.error, localize('dsh.session.favoriteFailed', "收藏会话失败"));
				return;
			}
			// 列表没有收藏标记。不说一声的话，点了跟没点一样。
			notifications.info(result.value.favorite === false
				? localize('dsh.session.unfavorited', "已取消收藏")
				: localize('dsh.session.favorited', "已收藏"));
		},
	});
	registerSessionAction({
		id: 'dsh.session.pin',
		title: localize2('dsh.session.pin', "置顶会话"),
		order: 2,
		group: '1_dsh',
		when: ContextKeyExpr.and(
			ChatContextKeys.isPinnedAgentSession.negate(),
			ChatContextKeys.isArchivedAgentSession.negate(),
		),
		run: async (accessor, sessionId, arg) => {
			await setPinned(accessor, sessionId, arg, true);
		},
	});
	registerSessionAction({
		id: 'dsh.session.unpin',
		title: localize2('dsh.session.unpin', "取消置顶"),
		order: 2,
		group: '1_dsh',
		when: ContextKeyExpr.and(
			ChatContextKeys.isPinnedAgentSession,
			ChatContextKeys.isArchivedAgentSession.negate(),
		),
		run: async (accessor, sessionId, arg) => {
			await setPinned(accessor, sessionId, arg, false);
		},
	});
	registerSessionAction({
		id: 'dsh.session.rename',
		title: localize2('dsh.session.rename', "重命名"),
		order: 1,
		group: '2_dsh',
		when: ChatContextKeys.isArchivedAgentSession.negate(),
		keybinding: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyG,
		run: async (accessor, sessionId) => {
			const title = await accessor.get(IQuickInputService).input({
				prompt: localize('dsh.session.renamePrompt', "会话标题"),
				placeHolder: localize('dsh.session.renamePlaceholder', "输入新标题"),
			});
			if (title === undefined || title.trim() === '') {
				return;
			}
			const notifications = accessor.get(INotificationService);
			const result = await accessor.get(IDshClientService).call('renameSession', { sessionId, title: title.trim() });
			if (!result.ok) {
				await fail(notifications, result.error, localize('dsh.session.renameFailed', "重命名失败"));
				return;
			}
			notifications.info(localize('dsh.session.renamed', "已重命名。"));
		},
	});
	registerSessionAction({
		id: 'dsh.session.fork',
		title: localize2('dsh.session.fork', "分叉会话"),
		order: 2,
		group: '2_dsh',
		when: ChatContextKeys.isArchivedAgentSession.negate(),
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
				return;
			}
			// Host 接受了分叉但没给出新会话。不提示的话，用户只能以为按钮没反应。
			accessor.get(INotificationService).info(localize('dsh.session.forkedNoId', "会话已分叉，但没有返回新会话编号。请从列表打开。"));
		},
	});
	registerSessionAction({
		id: 'dsh.session.rewind',
		title: localize2('dsh.session.rewind', "回退到某条消息"),
		order: 4,
		group: '2_dsh',
		capability: 'rewind',
		run: async (accessor, sessionId) => {
			const notifications = accessor.get(INotificationService);
			const raw = await accessor.get(IQuickInputService).input({
				prompt: localize('dsh.session.rewindPrompt', "回退到这条消息序号（只回退消息，不改文件）"),
				placeHolder: localize('dsh.session.rewindPlaceholder', "例如 12 或 @12"),
			});
			if (raw === undefined) {
				return;
			}
			const to = dshRewindSeq(raw);
			if (to === undefined) {
				notifications.warn(localize('dsh.session.rewindBad', "回退序号必须是非负整数。"));
				return;
			}
			const result = await accessor.get(IDshClientService).call('rewind', { sessionId, to });
			if (!result.ok) {
				await fail(notifications, result.error, localize('dsh.session.rewindFailed', "回退失败"));
				return;
			}
			notifications.info(localize('dsh.session.rewound', "已回退到 {0}。", to));
		},
	});
	registerSessionAction({
		id: 'dsh.session.copyId',
		title: localize2('dsh.session.copyId', "复制 Session ID"),
		order: 3,
		group: '2_dsh',
		run: async (accessor, sessionId) => {
			await accessor.get(IClipboardService).writeText(sessionId);
			accessor.get(INotificationService).info(localize('dsh.session.copied', "已复制会话编号。"));
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
				await fail(accessor.get(INotificationService), result.error, localize('dsh.session.openPathFailed', "无法打开会话所在目录。"));
			}
		},
	});
	registerSessionAction({
		id: 'dsh.session.move',
		title: localize2('dsh.session.move', "移动到工作区"),
		order: 2,
		group: '3_dsh',
		when: ChatContextKeys.isArchivedAgentSession.negate(),
		capability: 'sessionMove',
		run: async (accessor, sessionId) => {
			const client = accessor.get(IDshClientService);
			const notifications = accessor.get(INotificationService);
			const listed = await client.call<readonly { readonly id?: string; readonly title?: string; readonly path?: string }[]>('listWorkspaces', {});
			const sessions = await client.call<readonly { readonly sessionId?: string; readonly workspaceId?: string }[]>('listSessions', {});
			const current = sessions.ok && Array.isArray(sessions.value)
				? sessions.value.find(item => item.sessionId === sessionId)?.workspaceId
				: undefined;
			const choices = dshMoveChoices(listed.ok && Array.isArray(listed.value) ? listed.value : [], current);
			if (!listed.ok || choices.length === 0) {
				await fail(notifications, listed.ok ? undefined : listed.error, localize('dsh.session.moveEmpty', "没有可移动到的工作区。"));
				return;
			}
			const picked = await accessor.get(IQuickInputService).pick(
				choices.map(choice => ({ id: choice.id, label: choice.label, description: choice.description })),
				{ placeHolder: localize('dsh.session.movePlaceholder', "选择目标工作区") },
			);
			if (picked === undefined || typeof picked.id !== 'string') {
				return;
			}
			const moved = await client.call('moveSession', { sessionId, workspaceId: picked.id });
			if (!moved.ok) {
				await fail(notifications, moved.error, localize('dsh.session.moveFailed', "移动会话失败"));
				return;
			}
			notifications.info(localize('dsh.session.moved', "已移动到 {0}", picked.label));
		},
	});
	registerSessionAction({
		id: 'dsh.session.archive',
		title: localize2('dsh.session.archive', "归档会话"),
		order: 1,
		group: '4_dsh',
		keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyA,
		when: ChatContextKeys.isArchivedAgentSession.negate(),
		run: async (accessor, sessionId) => {
			// 必须走会话控制器：直接 call 不会写入 archivedIds，刷新后归档标志丢失，
			// 而且 DSH 右键菜单滤掉了原生 unarchive，这里不更新就再也无法恢复。
			accessor.get(IChatSessionsService).setChatSessionItemArchived(dshSessionResource(sessionId), true);
		},
	});
	registerSessionAction({
		id: 'dsh.session.unarchive',
		title: localize2('dsh.session.unarchive', "恢复会话"),
		order: 2,
		group: '4_dsh',
		keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyA,
		when: ChatContextKeys.isArchivedAgentSession,
		run: async (accessor, sessionId) => {
			accessor.get(IChatSessionsService).setChatSessionItemArchived(dshSessionResource(sessionId), false);
		},
	});
	registerSessionAction({
		id: 'dsh.session.delete',
		title: localize2('dsh.session.delete', "删除会话"),
		order: 1,
		group: '5_dsh',
		when: ChatContextKeys.isArchivedAgentSession.negate(),
		capability: 'sessionDelete',
		run: async (accessor, sessionId) => {
			const confirmed = await accessor.get(IDialogService).confirm({
				message: localize('dsh.session.deleteConfirm', "删除这个会话？此操作不能撤销。"),
				primaryButton: localize('dsh.session.deleteButton', "删除"),
			});
			if (!confirmed.confirmed) {
				return;
			}
			try {
				// 走控制器：成功后本地拿掉这一行。不要在这里再 listSessions。
				await accessor.get(IChatSessionsService).deleteChatSessionItem(dshSessionResource(sessionId), CancellationToken.None);
			} catch (error) {
				const message = error instanceof Error ? error.message : undefined;
				await fail(accessor.get(INotificationService), message === undefined ? undefined : { message }, localize('dsh.session.deleteFailed', "删除会话失败"));
			}
		},
	});
}
