/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// Sessions 面板的数据口：直接调用 Host 的 listSessions，行上只放契约已有的字段。
// 点一行走现成的 rebind，不另建会话模型，也不把帧折成另一套行。

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import type { IDshIdeSessionSummary } from '../../../../platform/dshClient/common/dshIdeProtocol.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IChatSessionTiming } from '../../chat/common/chatService/chatService.js';
import { ChatSessionStatus, IChatSessionItem, IChatSessionItemController, IChatSessionItemsDelta, IChatSessionProviderOptionGroup, IChatSessionsService } from '../../chat/common/chatSessionsService.js';
import { ChatViewId, ChatViewPaneTarget, IChatWidgetService } from '../../chat/browser/chat.js';
import { sessionOpenerRegistry } from '../../chat/browser/agentSessions/agentSessionsOpener.js';
import { ChatViewPane } from '../../chat/browser/widgetHosts/viewPane/chatViewPane.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { getDshComposerSource } from './dshComposerRegistry.js';
import { toPermissionItems } from './dshComposerProjection.js';
import { archiveIdsFromResult, buildSessionTree, flattenTree, isCurrentRefresh, mapTreeItem, sameTreeItem, sessionReadState } from './dshSessionTree.js';

export const DSH_CHAT_SESSION_TYPE = 'dsh';

export function dshSessionResource(sessionId: string): URI {
	return URI.from({ scheme: DSH_CHAT_SESSION_TYPE, path: `/${encodeURIComponent(sessionId)}` });
}

export function dshSessionIdFromResource(resource: URI): string | undefined {
	if (resource.scheme !== DSH_CHAT_SESSION_TYPE) {
		return undefined;
	}
	const encoded = resource.path.replace(/^\//, '');
	if (encoded === '') {
		return undefined;
	}
	try {
		const sessionId = decodeURIComponent(encoded);
		return sessionId === '' ? undefined : sessionId;
	} catch {
		return undefined;
	}
}

export class DshAgentSessionsController extends Disposable implements IChatSessionItemController, IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.dshAgentSessionsController';

	readonly chatSessionType = DSH_CHAT_SESSION_TYPE;

	private readonly _onDidChangeChatSessionItems = this._register(new Emitter<IChatSessionItemsDelta>());
	readonly onDidChangeChatSessionItems = this._onDidChangeChatSessionItems.event;

	private _items: readonly IChatSessionItem[] = [];

	/** 多名单一同增减时合成一次 listSessions，平时不轮询。 */
	private readonly _listRefresh = this._register(new RunOnceScheduler(() => {
		this.refreshNow();
	}, 50));
	/** api-session/status 比名单里的 running 新。后台子任务不会把父会话标成还在跑。 */
	private readonly liveRunning = new Map<string, boolean>();
	/** 最近一次归档/恢复回包里的完整集合。listSessions 摘要没有 archived 字段。 */
	private readonly archivedIds = new Set<string>();
	/** 后发起的 refresh 作废先发起的回包。 */
	private refreshEpoch = 0;

	get items(): readonly IChatSessionItem[] {
		return this._items;
	}

	constructor(
		@IDshClientService private readonly client: IDshClientService,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@IChatSessionsService chatSessionsService: IChatSessionsService,
		@INotificationService private readonly _notifications: INotificationService,
	) {
		super();

		this._register(chatSessionsService.registerChatSessionItemController(this.chatSessionType, this));
		// 用户在输入框里改了权限 / 预设：写回 DSH。只有 dsh 会话类型的选项才归这里管。
		this._register(chatSessionsService.onDidChangeSessionOptions(event => {
			if (event.sessionResource.scheme !== DSH_CHAT_SESSION_TYPE) {
				return;
			}
			for (const [optionId, value] of event.updates) {
				const raw = typeof value === 'string' ? value : value?.id;
				if (typeof raw === 'string' && raw !== '') {
					void this.applySessionOption(optionId, raw);
				}
			}
		}));
		this._register(this.workspace.onDidChangeWorkspaceFolders(() => {
			this.refreshNow();
		}));
		// 登记控制器时窗口通道还没 open，第一次 listSessions 会失败。连上之后再取一次。
		this._register(this.client.onDidChangeState(state => {
			if (state.connected) {
				this.refreshNow();
			}
		}));
		void this.client.getStatus().then(status => {
			if (status.connected) {
				this.refreshNow();
			}
		}, onUnexpectedError);
		this._register(this.client.onDidSessionNotice(notice => {
			if (notice.kind === 'list') {
				this._listRefresh.schedule();
				return;
			}
			this.applyRunning(notice.sessionId, notice.running);
		}));
		this._register(sessionOpenerRegistry.registerParticipant({
			handleOpenSession: async (accessor, session) => {
				if (dshSessionIdFromResource(session.resource) === undefined) {
					return false;
				}
				// 直接在该 Chat 视图里加载会话：`openSession` 会在 `canResolveChatSession` 未就绪时
				// 降级成编辑器标签，落点就不是 Sessions 旁边的 Chat 了。
				const views = accessor.get(IViewsService);
				const pane = await views.openView<ChatViewPane>(ChatViewId, true) ?? views.getViewWithId<ChatViewPane>(ChatViewId) ?? undefined;
				if (pane !== undefined) {
					await pane.loadSession(session.resource);
					pane.focus();
				} else {
					await accessor.get(IChatWidgetService).openSession(session.resource, ChatViewPaneTarget, { pinned: true });
				}
				return true;
			},
		}));
	}

	/**
	 * 新会话输入框的选项组：DSH 的权限预设与 agent 预设。
	 *
	 * 这是 `dshComposerProjection` 里 `toPermissionItems` 的生产入口；
	 * 没有它，权限与预设这两个选择器在原生输入框里根本不出现。
	 */
	async getNewChatSessionInputState(_sessionResource: URI, _token: CancellationToken): Promise<readonly IChatSessionProviderOptionGroup[] | undefined> {
		const source = getDshComposerSource();
		if (source === undefined) {
			return undefined;
		}
		const state = source.state;
		const groups: IChatSessionProviderOptionGroup[] = [];
		const permissionItems = toPermissionItems(state);
		if (permissionItems.length > 0) {
			const current = state.permission?.current;
			const selected = permissionItems.find(item => item.id === current);
			groups.push({
				id: 'dsh.permission',
				name: '权限',
				...(selected === undefined ? {} : { selected }),
				items: permissionItems,
				kind: 'permissions',
			});
		}
		const presets = state.presets;
		if (presets !== null && presets.options.length > 0) {
			const selectedPreset = presets.options.find(option => option.id === presets.current);
			groups.push({
				id: 'dsh.preset',
				name: '模式',
				...(selectedPreset === undefined ? {} : { selected: { id: selectedPreset.id, name: selectedPreset.name } }),
				items: presets.options.map(option => ({ id: option.id, name: option.name })),
			});
		}
		return groups.length === 0 ? undefined : groups;
	}

	/** 用户在新会话输入框里改了选项：写回 DSH 的权限 / 预设。 */
	applySessionOption(optionId: string, value: string): Promise<void> {
		const source = getDshComposerSource();
		if (source === undefined) {
			return Promise.resolve();
		}
		if (optionId === 'dsh.permission') {
			return source.selectPermission(value);
		}
		if (optionId === 'dsh.preset') {
			return source.selectPreset(value);
		}
		return Promise.resolve();
	}

	/**
	 * 后台刷新入口：`refresh()` 在 listSessions 失败时会 throw（原生 `IChatSessionItemController`
	 * 需要感知失败），但所有「连接状态变化 / 工作区变化 / 定时合并」的触发点都是 fire-and-forget，
	 * 必须自己收口，否则会变成 unhandled rejection。失败只记日志，不弹通知。
	 */
	private refreshNow(): void {
		void this.refresh(CancellationToken.None).catch(onUnexpectedError);
	}

	async refresh(token: CancellationToken): Promise<void> {
		if (token.isCancellationRequested) {
			return;
		}
		const epoch = ++this.refreshEpoch;
		const folders = this.workspace.getWorkspace().folders.map(folder => folder.uri.fsPath);
		const queries = folders.length === 0 ? [undefined] : folders;
		const summaries: IDshIdeSessionSummary[] = [];
		for (const folder of queries) {
			if (token.isCancellationRequested || !isCurrentRefresh(epoch, this.refreshEpoch)) {
				return;
			}
			let result = await this.client.call<readonly IDshIdeSessionSummary[]>('listSessions', folder === undefined ? {} : { workspace: folder });
			if (token.isCancellationRequested || !isCurrentRefresh(epoch, this.refreshEpoch)) {
				return;
			}
			if (!result.ok && result.error.message.includes('is not open')) {
				const opened = await this.client.openView({ view: 'chat', params: {} });
				if (token.isCancellationRequested || !isCurrentRefresh(epoch, this.refreshEpoch)) {
					return;
				}
				if (!opened.ok) {
					throw Object.assign(new Error(opened.error.message), { code: opened.error.code });
				}
				result = await this.client.call<readonly IDshIdeSessionSummary[]>('listSessions', folder === undefined ? {} : { workspace: folder });
				if (token.isCancellationRequested || !isCurrentRefresh(epoch, this.refreshEpoch)) {
					return;
				}
			}
			if (!result.ok) {
				throw Object.assign(new Error(result.error.message), { code: result.error.code });
			}
			if (!Array.isArray(result.value)) {
				throw Object.assign(new Error('listSessions must return an array'), { code: 'dsh-ide/invalid-argument' });
			}
			summaries.push(...result.value);
		}
		if (token.isCancellationRequested || !isCurrentRefresh(epoch, this.refreshEpoch)) {
			return;
		}

		// 子智能体会话按原生 children 树承接：只有 origin==='subagent' 且父在列表里才挂子项。
		const oldAll = flattenTree(this._items);
		const beforeByKey = new Map(oldAll.map(item => [item.resource.toString(), item]));
		const roots = buildSessionTree(summaries, summary => toSessionItem(summary, this.liveRunning, this.archivedIds, beforeByKey.get(dshSessionResource(summary.sessionId).toString())));
		const allItems = flattenTree(roots);
		const seen = new Set(allItems.map(item => item.resource.toString()));
		const previous = new Set(oldAll.map(item => item.resource.toString()));
		const removed = oldAll
			.filter(item => !seen.has(item.resource.toString()))
			.map(item => item.resource);
		const addedOrUpdated = allItems.filter(item => {
			const before = beforeByKey.get(item.resource.toString());
			return before === undefined || !sameTreeItem(before, item);
		});
		this._items = roots;
		if (addedOrUpdated.length > 0 || removed.length > 0 || previous.size !== seen.size) {
			this._onDidChangeChatSessionItems.fire({ addedOrUpdated, removed });
		}
	}

	/**
	 * 原生归档入口：`IChatSessionItemController.setChatSessionItemArchived`。
	 *
	 * 声明这个方法后，原生 agentSessions 的归档/恢复菜单才会把 DSH 会话交给这里；
	 * 写回走官方 `archiveSession` / `unarchiveSession`，回读以 Host 的归档集合为准。
	 */
	setChatSessionItemArchived(resource: URI, archived: boolean): void {
		const sessionId = dshSessionIdFromResource(resource);
		if (sessionId === undefined) {
			return;
		}
		void this.applyArchived(sessionId, archived);
	}

	/**
	 * 原生已读入口：`IChatSessionItemController.setChatSessionItemRead`。
	 *
	 * DSH 没有已读持久化端点，这里只改本地行状态（明确不假装写回 Host）。
	 */
	setChatSessionItemRead(resource: URI, isRead: boolean): void {
		const key = resource.toString();
		const next = mapTreeItem(this._items, key, item => item.isRead === isRead ? undefined : { ...item, isRead });
		if (next === this._items) {
			return;
		}
		const updated = flattenTree(next).find(item => item.resource.toString() === key);
		this._items = next;
		if (updated !== undefined) {
			this._onDidChangeChatSessionItems.fire({ addedOrUpdated: [updated] });
		}
	}

	/** 归档 / 恢复：成功后就地把行状态改掉，失败保留原状并如实提示。 */
	private async applyArchived(sessionId: string, archived: boolean): Promise<void> {
		const result = archived
			? await this.client.call('archiveSession', { sessionId })
			: await this.client.call('unarchiveSession', { sessionId });
		if (!result.ok) {
			this._notifications.warn(localize('dsh.sessions.archiveFailed', "DSH 会话归档失败：{0}", result.error.message));
			return;
		}
		// 回包是完整归档集合。不能只改这一行：下一次 listSessions 没有 archived 字段，刷新会把标志清掉。
		const nextIds = archiveIdsFromResult(result.value, sessionId, archived, this.archivedIds);
		this.archivedIds.clear();
		for (const id of nextIds) {
			this.archivedIds.add(id);
		}
		const key = dshSessionResource(sessionId).toString();
		const archivedNow = this.archivedIds.has(sessionId);
		const next = mapTreeItem(this._items, key, item => item.archived === archivedNow ? undefined : { ...item, archived: archivedNow || undefined });
		if (next === this._items) {
			return;
		}
		const updated = flattenTree(next).find(item => item.resource.toString() === key);
		this._items = next;
		if (updated !== undefined) {
			this._onDidChangeChatSessionItems.fire({ addedOrUpdated: [updated] });
		}
	}

	/** 官方 api-session/status：只改这一行的运行状态，不重新拉名单。 */
	private applyRunning(sessionId: string, running: boolean): void {
		this.liveRunning.set(sessionId, running);
		const key = dshSessionResource(sessionId).toString();
		const current = flattenTree(this._items).find(item => item.resource.toString() === key);
		if (current === undefined) {
			return;
		}
		const status = running ? ChatSessionStatus.InProgress : ChatSessionStatus.Completed;
		if (current.status === status) {
			return;
		}
		const next = mapTreeItem(this._items, key, item => ({
			...item,
			status,
			timing: {
				created: item.timing.created,
				lastRequestStarted: running ? item.timing.lastRequestStarted ?? item.timing.created : item.timing.lastRequestStarted,
				lastRequestEnded: running ? undefined : item.timing.lastRequestEnded ?? item.timing.created,
			},
		}));
		const updated = flattenTree(next).find(item => item.resource.toString() === key);
		this._items = next;
		if (updated !== undefined) {
			this._onDidChangeChatSessionItems.fire({ addedOrUpdated: [updated] });
		}
	}
}

function toSessionItem(summary: IDshIdeSessionSummary, liveRunning: ReadonlyMap<string, boolean>, archivedIds: ReadonlySet<string>, previous: IChatSessionItem | undefined): IChatSessionItem | undefined {
	if (typeof summary?.sessionId !== 'string' || summary.sessionId === '') {
		return undefined;
	}
	const updatedAt = typeof summary.updatedAt === 'number' && Number.isFinite(summary.updatedAt) ? summary.updatedAt : undefined;
	const running = liveRunning.get(summary.sessionId) ?? summary.running === true;
	const timing: IChatSessionTiming = {
		created: updatedAt ?? 0,
		lastRequestStarted: running ? updatedAt : undefined,
		lastRequestEnded: running ? undefined : updatedAt,
	};
	const title = typeof summary.title === 'string' && summary.title !== '' ? summary.title : summary.sessionId;
	const isRead = sessionReadState(updatedAt, previous);
	return {
		resource: dshSessionResource(summary.sessionId),
		label: title,
		description: typeof summary.cwd === 'string' && summary.cwd !== '' ? summary.cwd : undefined,
		status: running ? ChatSessionStatus.InProgress : ChatSessionStatus.Completed,
		timing,
		iconPath: Codicon.comment,
		...(archivedIds.has(summary.sessionId) ? { archived: true } : {}),
		...(isRead === undefined ? {} : { isRead }),
	};
}

registerWorkbenchContribution2(DshAgentSessionsController.ID, DshAgentSessionsController, WorkbenchPhase.AfterRestored);
