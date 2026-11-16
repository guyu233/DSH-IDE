/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// Sessions 面板的数据口：直接调用 Host 的 listSessions，行上只放契约已有的字段。
// 点一行走现成的 rebind，不另建会话模型，也不把帧折成另一套行。

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import type { IDshIdeSessionSummary } from '../../../../platform/dshClient/common/dshIdeProtocol.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IChatSessionTiming } from '../../chat/common/chatService/chatService.js';
import { ChatSessionStatus, IChatSessionItem, IChatSessionItemController, IChatSessionItemsDelta, IChatSessionProviderOptionGroup, IChatSessionsService } from '../../chat/common/chatSessionsService.js';
import { sessionOpenerRegistry } from '../../chat/browser/agentSessions/agentSessionsOpener.js';
import { dshChatSessionFor } from './dshChatSession.js';
import { getDshComposerSource } from './dshComposerRegistry.js';
import { toPermissionItems } from './dshComposerProjection.js';

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
		void this.refresh(CancellationToken.None);
	}, 50));
	/** api-session/status 比名单里的 running 新。后台子任务不会把父会话标成还在跑。 */
	private readonly liveRunning = new Map<string, boolean>();

	get items(): readonly IChatSessionItem[] {
		return this._items;
	}

	constructor(
		@IDshClientService private readonly client: IDshClientService,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@IChatSessionsService chatSessionsService: IChatSessionsService,
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
			void this.refresh(CancellationToken.None);
		}));
		// 登记控制器时窗口通道还没 open，第一次 listSessions 会失败。连上之后再取一次。
		this._register(this.client.onDidChangeState(state => {
			if (state.connected) {
				void this.refresh(CancellationToken.None);
			}
		}));
		void this.client.getStatus().then(status => {
			if (status.connected) {
				void this.refresh(CancellationToken.None);
			}
		});
		this._register(this.client.onDidSessionNotice(notice => {
			if (notice.kind === 'list') {
				this._listRefresh.schedule();
				return;
			}
			this.applyRunning(notice.sessionId, notice.running);
		}));
		this._register(sessionOpenerRegistry.registerParticipant({
			handleOpenSession: async (_accessor, session) => {
				const sessionId = dshSessionIdFromResource(session.resource);
				if (sessionId === undefined) {
					return false;
				}
				await dshChatSessionFor(this.client).bind(sessionId);
				return true;
			},
		}));
	}

	/**
	 * 新会话输入框的选项组：DSH 的权限预设与 agent 预设。
	 *
	 * 这是 `dshComposerProjection` 里 `toPermissionItems` / `observeModes` 的生产入口；
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

	async refresh(token: CancellationToken): Promise<void> {
		if (token.isCancellationRequested) {
			return;
		}
		const folders = this.workspace.getWorkspace().folders.map(folder => folder.uri.fsPath);
		const queries = folders.length === 0 ? [undefined] : folders;
		const summaries: IDshIdeSessionSummary[] = [];
		for (const folder of queries) {
			if (token.isCancellationRequested) {
				return;
			}
			let result = await this.client.call<readonly IDshIdeSessionSummary[]>('listSessions', folder === undefined ? {} : { workspace: folder });
			if (!result.ok && result.error.message.includes('is not open')) {
				const opened = await this.client.openView({ view: 'chat', params: {} });
				if (!opened.ok) {
					throw Object.assign(new Error(opened.error.message), { code: opened.error.code });
				}
				result = await this.client.call<readonly IDshIdeSessionSummary[]>('listSessions', folder === undefined ? {} : { workspace: folder });
			}
			if (!result.ok) {
				throw Object.assign(new Error(result.error.message), { code: result.error.code });
			}
			if (!Array.isArray(result.value)) {
				throw Object.assign(new Error('listSessions must return an array'), { code: 'dsh-ide/invalid-argument' });
			}
			summaries.push(...result.value);
		}

		const next: IChatSessionItem[] = [];
		const seen = new Set<string>();
		for (const summary of summaries) {
			const item = toSessionItem(summary, this.liveRunning);
			if (item === undefined || seen.has(item.resource.toString())) {
				continue;
			}
			seen.add(item.resource.toString());
			next.push(item);
		}

		const previous = new Set(this._items.map(item => item.resource.toString()));
		const removed = this._items
			.filter(item => !seen.has(item.resource.toString()))
			.map(item => item.resource);
		const addedOrUpdated = next.filter(item => {
			const key = item.resource.toString();
			const before = this._items.find(existing => existing.resource.toString() === key);
			return before === undefined || !sameItem(before, item);
		});
		this._items = next;
		if (addedOrUpdated.length > 0 || removed.length > 0 || previous.size !== seen.size) {
			this._onDidChangeChatSessionItems.fire({ addedOrUpdated, removed });
		}
	}

	/** 官方 api-session/status：只改这一行的运行状态，不重新拉名单。 */
	private applyRunning(sessionId: string, running: boolean): void {
		this.liveRunning.set(sessionId, running);
		const key = dshSessionResource(sessionId).toString();
		const current = this._items.find(item => item.resource.toString() === key);
		if (current === undefined) {
			return;
		}
		const status = running ? ChatSessionStatus.InProgress : ChatSessionStatus.Completed;
		if (current.status === status) {
			return;
		}
		const updated: IChatSessionItem = {
			...current,
			status,
			timing: {
				created: current.timing.created,
				lastRequestStarted: running ? current.timing.lastRequestStarted ?? current.timing.created : current.timing.lastRequestStarted,
				lastRequestEnded: running ? undefined : current.timing.lastRequestEnded ?? current.timing.created,
			},
		};
		this._items = this._items.map(item => item.resource.toString() === key ? updated : item);
		this._onDidChangeChatSessionItems.fire({ addedOrUpdated: [updated] });
	}
}

function toSessionItem(summary: IDshIdeSessionSummary, liveRunning: ReadonlyMap<string, boolean>): IChatSessionItem | undefined {
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
	return {
		resource: dshSessionResource(summary.sessionId),
		label: title,
		description: typeof summary.cwd === 'string' && summary.cwd !== '' ? summary.cwd : undefined,
		status: running ? ChatSessionStatus.InProgress : ChatSessionStatus.Completed,
		timing,
		iconPath: Codicon.comment,
	};
}

function sameItem(left: IChatSessionItem, right: IChatSessionItem): boolean {
	return left.label === right.label
		&& left.description === right.description
		&& left.status === right.status
		&& left.timing.created === right.timing.created
		&& left.timing.lastRequestStarted === right.timing.lastRequestStarted
		&& left.timing.lastRequestEnded === right.timing.lastRequestEnded;
}

registerWorkbenchContribution2(DshAgentSessionsController.ID, DshAgentSessionsController, WorkbenchPhase.AfterRestored);
