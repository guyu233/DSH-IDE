/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// Sessions 面板的数据口：直接调用 Host 的 listSessions，行上只放契约已有的字段。
// 点一行走现成的 rebind，不另建会话模型，也不把帧折成另一套行。

import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { onUnexpectedError } from '../../../../../base/common/errors.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IDshClientService } from '../../../../../platform/dshClient/common/dshClientService.js';
import { dshErrorText, type IDshIdeSessionSummary } from '../../../../../platform/dshClient/protocol/dshIdeProtocol.js';
import { dshFail, dshLink } from '../dshNotice.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../common/contributions.js';
import { IChatSessionTiming } from '../../../chat/common/chatService/chatService.js';
import { ChatSessionStatus, IChatSessionItem, IChatSessionItemController, IChatSessionItemsDelta, IChatSessionProviderOptionGroup, IChatSessionsService } from '../../../chat/common/chatSessionsService.js';
import { ChatViewId, ChatViewPaneTarget, IChatWidgetService } from '../../../chat/browser/chat.js';
import { sessionOpenerRegistry } from '../../../chat/browser/agentSessions/agentSessionsOpener.js';
import { ChatViewPane } from '../../../chat/browser/widgetHosts/viewPane/chatViewPane.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { getDshComposerSource } from './dshComposerRegistry.js';
import { toPermissionItems } from './dshComposerProjection.js';
import { archiveIdsFromResult, buildSessionTree, dropSession, flattenTree, isCurrentRefresh, mapTreeItem, sameTreeItem, sessionReadState } from './dshSessionTree.js';
// 会话类型的唯一定义在 `dshSessionType.ts`：这里原先另有一份同名常量，
// 两份可以各自漂移，而 scheme 一旦不一致，会话资源就认不出来。
import { DSH_CHAT_SESSION_TYPE } from './dshSessionType.js';
import { shouldWriteBackSessionOption } from './dshSessionOptionSync.js';

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
	/**
	 * 归档写回的序号。
	 *
	 * 回包是**完整集合**，所以只能整体采纳；两次写回乱序返回时，较旧的那次会把
	 * 较新的结果覆盖掉，界面就会显示成「刚归档的又回来了」。只采纳序号最新的那一次。
	 */
	private archiveEpoch = 0;
	/** 后发起的 refresh 作废先发起的回包。 */
	private refreshEpoch = 0;
	/** 空列表上已经提示过的失败原文，避免连接抖动时重复弹窗。 */
	private _lastRefreshError: string | undefined;
	/** 控制器已释放：在途回包不再写列表、不再 fire。 */
	private _disposed = false;
	/** 在途的刷新；同一时刻只跑一轮 listSessions。 */
	private _refreshInFlight: Promise<void> | undefined;

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
		// 程序投影（打开/换绑时补当前值）不算用户选择，必须跳过，否则会把 Host 的值再写回去。
		this._register(chatSessionsService.onDidChangeSessionOptions(event => {
			if (event.sessionResource.scheme !== DSH_CHAT_SESSION_TYPE) {
				return;
			}
			if (!shouldWriteBackSessionOption()) {
				return;
			}
			for (const [optionId, value] of event.updates) {
				const raw = typeof value === 'string' ? value : value?.id;
				if (typeof raw === 'string' && raw !== '') {
					// 选项事件带的是它自己的会话：写回必须落在那个会话上，而不是写回时当前绑定的会话。
					void this.applySessionOption(optionId, raw, dshSessionIdFromResource(event.sessionResource));
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
				name: localize('dsh.optionGroup.permission', "Permissions"),
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
				name: localize('dsh.optionGroup.preset', "Mode"),
				...(selectedPreset === undefined ? {} : { selected: { id: selectedPreset.id, name: selectedPreset.name } }),
				items: presets.options.map(option => ({ id: option.id, name: option.name })),
			});
		}
		return groups.length === 0 ? undefined : groups;
	}

	/** 用户在新会话输入框里改了选项：写回 DSH 的权限 / 预设。 */
	applySessionOption(optionId: string, value: string, sessionId?: string): Promise<void> {
		const source = getDshComposerSource();
		if (source === undefined) {
			return Promise.resolve();
		}
		if (optionId === 'dsh.permission') {
			return source.selectPermission(value, sessionId);
		}
		if (optionId === 'dsh.preset') {
			return source.selectPreset(value, sessionId);
		}
		return Promise.resolve();
	}

	/**
	 * 后台刷新入口：`refresh()` 在 listSessions 失败时会 throw（原生 `IChatSessionItemController`
	 * 需要感知失败），但所有「连接状态变化 / 工作区变化 / 定时合并」的触发点都是 fire-and-forget，
	 * 必须自己收口，否则会变成 unhandled rejection。列表里已经有行时只记日志；
	 * 列表是空的时用户会以为没有会话，所以同一种失败只提示一次。
	 */
	override dispose(): void {
		this._disposed = true;
		super.dispose();
	}

	private refreshNow(): void {
		// 启动时会连着触发几次（构造、getStatus、连接状态变化），工作区切换也可能连发。
		// 不合并的话每次都是一整轮 listSessions（按工作区目录数还要翻倍）。
		// 在途期间再来的触发直接复用同一次刷新，回包到了就自然带上最新名单。
		if (this._refreshInFlight !== undefined) {
			return;
		}
		const work = this.refresh(CancellationToken.None).then(() => {
			this._lastRefreshError = undefined;
		}, error => {
			if (flattenTree(this._items).length === 0) {
				const message = error instanceof Error && error.message !== '' ? error.message : String(error);
				if (message !== this._lastRefreshError) {
					this._lastRefreshError = message;
					dshLink(this._notifications, localize('dsh.sessions.refreshFailed', "DSH-IDE: the session list did not load: {0}", message));
				}
			}
			onUnexpectedError(error);
		}).finally(() => {
			this._refreshInFlight = undefined;
		});
		this._refreshInFlight = work;
	}

	async refresh(token: CancellationToken): Promise<void> {
		if (token.isCancellationRequested) {
			return;
		}
		const epoch = ++this.refreshEpoch;
		const folders = this.workspace.getWorkspace().folders.map(folder => folder.uri.fsPath);
		const queries = folders.length === 0 ? [undefined] : folders;
		// 每个工作区目录各要一次 listSessions。串行等的话，多根工作区要叠加 N 次往返；
		// 并发发出去，总耗时接近一次。取消与过期判定在每步之间照旧检查。
		const stale = (): boolean => token.isCancellationRequested || !isCurrentRefresh(epoch, this.refreshEpoch);
		// 并发之后，多个目录可能同时发现「视图没开」。共用一个在途 openView，
		// 否则多根工作区会同时开多次视图。
		let opening: Promise<{ readonly ok: boolean; readonly error?: { readonly code: string; readonly message?: string } }> | undefined;
		const ensureViewOpen = (): Promise<{ readonly ok: boolean; readonly error?: { readonly code: string; readonly message?: string } }> => {
			opening ??= this.client.openView({ view: 'chat', params: {} });
			return opening;
		};
		const listed = await Promise.all(queries.map(async folder => {
			const args = folder === undefined ? {} : { workspace: folder };
			let result = await this.client.call<readonly IDshIdeSessionSummary[]>('listSessions', args);
			if (stale()) {
				return undefined;
			}
			if (!result.ok && dshErrorText(result.error, '').includes('is not open')) {
				const opened = await ensureViewOpen();
				if (stale()) {
					return undefined;
				}
				if (!opened.ok) {
					const openedError = opened.error;
					throw Object.assign(new Error(dshErrorText(openedError, openedError?.code ?? '')), { code: openedError?.code ?? '' });
				}
				result = await this.client.call<readonly IDshIdeSessionSummary[]>('listSessions', args);
				if (stale()) {
					return undefined;
				}
			}
			if (!result.ok) {
				throw Object.assign(new Error(dshErrorText(result.error, result.error.code)), { code: result.error.code });
			}
			if (!Array.isArray(result.value)) {
				throw Object.assign(new Error('listSessions must return an array'), { code: 'dsh-ide/invalid-argument' });
			}
			return result.value;
		}));
		if (stale()) {
			return;
		}
		const summaries: IDshIdeSessionSummary[] = [];
		for (const value of listed) {
			if (value !== undefined) {
				summaries.push(...value);
			}
		}

		// 子智能体会话按原生 children 树承接：只有 origin==='subagent' 且父在列表里才挂子项。
		const oldAll = flattenTree(this._items);
		const beforeByKey = new Map(oldAll.map(item => [item.resource.toString(), item]));
		// 本轮名单里出现过的会话 id。`liveRunning` 只增不清会让删掉/归档的会话
		// 一直留在内存里；每轮按当前名单剪一次，长会话不会越积越多。
		const liveIds = new Set(summaries.map(summary => summary.sessionId));
		if (this.liveRunning.size > liveIds.size) {
			for (const sessionId of [...this.liveRunning.keys()]) {
				if (!liveIds.has(sessionId)) {
					this.liveRunning.delete(sessionId);
				}
			}
		}
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
	/**
	 * 原生删除入口。成功后只从当前树拿掉这一行，不立刻 listSessions。
	 * 名单是最终一致的，刚删完就刷新会把还在旧名单里的行画回来。
	 */
	async deleteChatSessionItem(resource: URI, token: CancellationToken): Promise<void> {
		if (token.isCancellationRequested) {
			return;
		}
		const sessionId = dshSessionIdFromResource(resource);
		if (sessionId === undefined) {
			return;
		}
		const result = await this.client.call('deleteSession', { sessionId });
		// 控制器已释放：回包回来时不能再动列表。
		if (this._disposed) {
			return;
		}
		if (!result.ok) {
			throw new Error(dshErrorText(result.error, result.error.code));
		}
		// 删除已经在 Host 生效。即使调用方这时取消，行也要拿掉。
		const key = dshSessionResource(sessionId).toString();
		const next = dropSession(this._items, key);
		if (next === this._items) {
			return;
		}
		this._items = next;
		this._onDidChangeChatSessionItems.fire({ removed: [resource] });
	}

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
		const epoch = ++this.archiveEpoch;
		const result = archived
			? await this.client.call('archiveSession', { sessionId })
			: await this.client.call('unarchiveSession', { sessionId });
		// 控制器已释放：回包回来时不再改行状态，也不 fire。
		if (this._disposed) {
			return;
		}
		if (!result.ok) {
			// 失败只提示，不改状态；序号已经前进，较旧的成功回包也不会再覆盖更新的意图。
			const detail = dshErrorText(result.error, result.error.code);
			// 归档/恢复是用户这次操作没做成，走失败框。
			dshFail(this._notifications, archived
				? localize('dsh.sessions.archiveFailed', "DSH-IDE: could not archive the session: {0}", detail)
				: localize('dsh.sessions.unarchiveFailed', "DSH-IDE: could not restore the session: {0}", detail));
			return;
		}
		if (!isCurrentRefresh(epoch, this.archiveEpoch)) {
			// 期间有更新的归档请求：这次回包描述的是旧意图，整体丢弃。
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
