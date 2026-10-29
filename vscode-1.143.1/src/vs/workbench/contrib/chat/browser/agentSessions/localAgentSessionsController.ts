/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { coalesce } from '../../../../../base/common/arrays.js';
import { raceCancellation, Throttler } from '../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { onUnexpectedError } from '../../../../../base/common/errors.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableResourceMap, DisposableStore, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { ResourceMap, ResourceSet } from '../../../../../base/common/map.js';
import { equals } from '../../../../../base/common/objects.js';
import { autorun, observableSignalFromEvent } from '../../../../../base/common/observable.js';
import { isEqual } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { convertLegacyChatSessionTiming, IChatDetail, IChatService, IChatSessionTiming } from '../../common/chatService/chatService.js';
import { chatModelToChatDetail } from '../../common/chatService/chatServiceImpl.js';
import { ChatSessionStatus, IChatSessionItem, IChatSessionItemController, IChatSessionItemMetadata, IChatSessionItemsDelta, IChatSessionsService, localChatSessionType } from '../../common/chatSessionsService.js';
import { IChatModel } from '../../common/model/chatModel.js';
import { getChatSessionType } from '../../common/model/chatUri.js';
import { LocalChatSessionUri } from '../../common/model/chatUri.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { DshChatBridge } from '../../common/chatService/dshChatBridge.js';
import { getInProgressSessionDescription } from '../chatSessions/chatSessionDescription.js';
import { chatResponseStateToSessionStatus, getSessionStatusForModel } from '../chatSessions/chatSessions.contribution.js';
import { Schemas } from '../../../../../base/common/network.js';

export class LocalAgentsSessionsController extends Disposable implements IChatSessionItemController, IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.localAgentsSessionsController';

	readonly chatSessionType = localChatSessionType;

	readonly _onDidChangeChatSessionItems = this._register(new Emitter<IChatSessionItemsDelta>());
	readonly onDidChangeChatSessionItems = this._onDidChangeChatSessionItems.event;

	private readonly _modelListeners = this._register(new DisposableResourceMap<DisposableStore>());
	private readonly _refreshThrottler = this._register(new Throttler());
	private readonly _refreshCancellation = this._register(new MutableDisposable<CancellationTokenSource>());

	constructor(
		@IChatService private readonly chatService: IChatService,
		@IChatSessionsService private readonly chatSessionsService: IChatSessionsService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		this._register(this.chatSessionsService.registerChatSessionItemController(this.chatSessionType, this));

		this.registerListeners();
	}

	/** DSH 桥（懒建）。DSH 会话作为 local 会话条目展示在这里，会话 id 即 DSH sessionId。 */
	private _dshBridge: DshChatBridge | undefined;
	private get dshBridge(): DshChatBridge {
		if (!this._dshBridge) { this._dshBridge = this._register(this.instantiationService.createInstance(DshChatBridge)); }
		return this._dshBridge;
	}

	private _items = new ResourceMap<LocalChatSessionItem>();
	get items(): readonly IChatSessionItem[] {
		return Array.from(this._items.values());
	}

	/** Caller cancellation stops waiting without cancelling the shared refresh. */
	refresh(token: CancellationToken): Promise<void> {
		if (token.isCancellationRequested) {
			return Promise.resolve();
		}

		return raceCancellation(this._refreshThrottler.queue(lifetimeToken => this.doRefresh(lifetimeToken)), token);
	}

	private async doRefresh(token: CancellationToken): Promise<void> {
		const cancellation = this._refreshCancellation.value = new CancellationTokenSource(token);
		let newItems: LocalChatSessionItem[];
		try {
			newItems = await this.provideChatSessionItems(cancellation.token);
		} finally {
			this._refreshCancellation.clear();
		}
		if (cancellation.token.isCancellationRequested) {
			return;
		}

		const newResources = new ResourceSet(newItems.map(i => i.resource));
		const addedOrUpdated: LocalChatSessionItem[] = [];
		const removed: URI[] = [];

		for (const item of newItems) {
			if (!this._items.get(item.resource)?.isEqual(item)) {
				addedOrUpdated.push(item);
			}
		}
		for (const resource of this._items.keys()) {
			if (!newResources.has(resource)) {
				removed.push(resource);
			}
		}

		this._items.clear();
		for (const item of newItems) {
			this._items.set(item.resource, item);
		}

		if (addedOrUpdated.length > 0 || removed.length > 0) {
			this._onDidChangeChatSessionItems.fire({
				...(addedOrUpdated.length > 0 ? { addedOrUpdated } : undefined),
				...(removed.length > 0 ? { removed } : undefined),
			});
		}
	}

	private registerListeners(): void {
		const addModelListeners = async (model: IChatModel) => {
			if (getChatSessionType(model.sessionResource) !== this.chatSessionType) {
				return;
			}

			const modelListeners = new DisposableStore();
			this._modelListeners.set(model.sessionResource, modelListeners);
			await this.refresh(CancellationToken.None);
			if (modelListeners.isDisposed || this.chatService.getSession(model.sessionResource) !== model) {
				return;
			}

			const requestChangeListener = model.lastRequestObs.map(last => last?.response && observableSignalFromEvent('chatSessions.modelRequestChangeListener', last.response.onDidChange));
			const modelChangeListener = observableSignalFromEvent('chatSessions.modelChangeListener', model.onDidChange);
			modelListeners.add(autorun(reader => {
				requestChangeListener.read(reader)?.read(reader);
				modelChangeListener.read(reader);

				this.tryUpdateLiveSessionItem(model, modelListeners).catch(onUnexpectedError);
			}));
		};

		this._register(this.chatService.onDidCreateModel(model => addModelListeners(model).catch(onUnexpectedError)));
		for (const model of this.chatService.chatModels.get()) {
			addModelListeners(model).catch(onUnexpectedError);
		}

		this._register(this.chatService.onDidDisposeSession(e => {
			for (const sessionResource of e.sessionResources) {
				this._modelListeners.deleteAndDispose(sessionResource);
			}

			const localSessionResources = e.sessionResources.filter(resource => getChatSessionType(resource) === this.chatSessionType);
			if (!localSessionResources.length) {
				return;
			}

			// Invalidate snapshots captured before the model was unloaded or its history was deleted.
			this._refreshCancellation.value?.cancel();
			if (e.reason === 'cleared') {
				for (const resource of localSessionResources) {
					this._items.delete(resource);
				}
				this._onDidChangeChatSessionItems.fire({ removed: localSessionResources });
			}
			this.refresh(CancellationToken.None).catch(onUnexpectedError);
		}));
	}

	private async tryUpdateLiveSessionItem(model: IChatModel, modelListeners: DisposableStore): Promise<void> {
		const updated = this.toChatSessionItem(await chatModelToChatDetail(model));
		if (modelListeners.isDisposed || this.chatService.getSession(model.sessionResource) !== model) {
			return;
		}

		if (!updated) {
			// The session no longer qualifies as a list item (e.g. it has no requests
			// yet, or its requests were removed). Drop any stale item we were showing.
			if (this._items.has(model.sessionResource)) {
				this._items.delete(model.sessionResource);
				this._onDidChangeChatSessionItems.fire({ removed: [model.sessionResource] });
			}
			return;
		}

		const existing = this._items.get(updated.resource);
		if (existing?.isEqual(updated)) {
			return;
		}

		this._items.set(updated.resource, updated);
		this._onDidChangeChatSessionItems.fire({ addedOrUpdated: [updated] });
	}

	private async provideChatSessionItems(token: CancellationToken): Promise<LocalChatSessionItem[]> {
		const sessions: LocalChatSessionItem[] = [];
		const sessionsByResource = new ResourceSet();

		for (const sessionDetail of await this.chatService.getLiveSessionItems()) {
			const editorSession = this.toChatSessionItem(sessionDetail);
			if (!editorSession) {
				continue;
			}

			sessionsByResource.add(sessionDetail.sessionResource);
			sessions.push(editorSession);
		}

		if (!token.isCancellationRequested) {
			const history = await this.getHistoryItems();
			sessions.push(...history.filter(historyItem => !sessionsByResource.has(historyItem.resource)));
		}

		// DSH 集成：把当前工作区的 DSH 会话列进 Sessions 面板。
		// 资源 id 直接用 DSH 的 sessionId（LocalChatSessionUri 编解码），桥发送时也是这个 id。
		if (!token.isCancellationRequested) {
			try {
				const dshSessions = await this.dshBridge.listSessions();
				for (const s of dshSessions) {
					const resource = LocalChatSessionUri.forSession(s.sessionId);
					if (sessionsByResource.has(resource)) { continue; }
					sessionsByResource.add(resource);
					sessions.push(new DshSessionItem(s));
				}
			} catch (e) { this.logService.warn('[dsh] 列取 DSH 会话失败: ' + String(e)); }
		}

		return sessions;
	}

	private async getHistoryItems(): Promise<LocalChatSessionItem[]> {
		try {
			const historyItems = await this.chatService.getHistorySessionItems();

			return coalesce(historyItems.map(history => this.toChatSessionItem(history)));
		} catch (error) {
			return [];
		}
	}

	private toChatSessionItem(chat: IChatDetail): LocalChatSessionItem | undefined {
		const model = this.chatService.getSession(chat.sessionResource);

		if (model) {
			if (!model.hasRequests) {
				return undefined; // ignore sessions without requests
			}
		} else if (chat.isActive) {
			// Sessions that are active but don't have a chat model are ultimately untitled with no requests
			return undefined;
		}

		return new LocalChatSessionItem(chat, model);
	}
}

/** DSH 会话在 Sessions 面板中的条目：id = DSH sessionId。 */
class DshSessionItem implements IChatSessionItem {
	readonly resource: URI;
	readonly iconPath = Codicon.commentDiscussion;
	readonly label: string;
	readonly description: string;
	readonly status: ChatSessionStatus | undefined;
	readonly timing: IChatSessionTiming;
	readonly changes: IChatSessionItem['changes'] = undefined;
	readonly metadata: IChatSessionItemMetadata | undefined;

	constructor(private readonly dsh: { sessionId: string; title: string; cwd: string; running: boolean; updatedAt: number }) {
		this.resource = LocalChatSessionUri.forSession(dsh.sessionId);
		this.label = (dsh.title || '').trim() || 'DSH 会话';
		this.description = this.label !== dsh.sessionId ? dsh.sessionId : '';
		this.status = dsh.running ? ChatSessionStatus.InProgress : ChatSessionStatus.Completed;
		const ts = dsh.updatedAt || Date.now();
		this.timing = { created: ts, lastRequestStarted: ts, lastRequestEnded: ts };
		this.metadata = dsh.cwd ? { workingDirectoryPath: dsh.cwd } : undefined;
	}

	isEqual(other: DshSessionItem): boolean {
		return this.label === other.label && this.status === other.status && this.timing.lastRequestEnded === other.timing.lastRequestEnded;
	}
}

class LocalChatSessionItem implements IChatSessionItem {
	readonly resource: URI;
	readonly iconPath = Codicon.chatSparkle;

	readonly label: string;
	readonly description: string | undefined;
	readonly status: ChatSessionStatus | undefined;
	readonly timing: IChatSessionTiming;
	readonly changes: IChatSessionItem['changes'];
	readonly metadata: IChatSessionItemMetadata | undefined;

	constructor(chatDetail: IChatDetail, model: IChatModel | undefined) {
		this.resource = chatDetail.sessionResource;
		this.label = chatDetail.title;
		this.description = model ? getInProgressSessionDescription(model) : undefined;
		this.status = (model && getSessionStatusForModel(model)) ?? chatResponseStateToSessionStatus(chatDetail.lastResponseState);
		this.timing = convertLegacyChatSessionTiming(chatDetail.timing);
		this.changes = chatDetail.stats ? {
			insertions: chatDetail.stats.added,
			deletions: chatDetail.stats.removed,
			files: chatDetail.stats.fileCount,
		} : undefined;
		const workingDirectoryPath = chatDetail.workingDirectory?.scheme === Schemas.file ? chatDetail.workingDirectory.fsPath : undefined;
		this.metadata = workingDirectoryPath ? { workingDirectoryPath: workingDirectoryPath } : undefined;
	}

	isEqual(other: LocalChatSessionItem): boolean {
		return isEqual(this.resource, other.resource)
			&& this.label === other.label
			&& this.description === other.description
			&& this.status === other.status
			&& this.timing.created === other.timing.created
			&& this.timing.lastRequestStarted === other.timing.lastRequestStarted
			&& this.timing.lastRequestEnded === other.timing.lastRequestEnded
			&& equals(this.changes, other.changes)
			&& equals(this.metadata, other.metadata);
	}
}
