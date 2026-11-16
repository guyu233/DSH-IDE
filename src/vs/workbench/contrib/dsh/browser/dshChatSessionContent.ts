/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// `dsh` 会话类型的聊天内容提供者。
//
// 这是「选中会话后消息不显示」的补齐点：会话列表控制器只注册了 item controller，
// 没有 content provider，原生 ChatWidget 打开 `dsh:/<id>` 时拿不到任何 history。
// 本文件把 `DshChatSession` 的结构化节点树映射成原生 `IChatSession` 的 history：
//   - 节点层：`DshChatNode[]`（Host 投影好的 typed conversation）
//   - 组件层：`IChatProgress[]`（VS Code 原生 chat 渲染器认的进度部件）
//
// 边界：零 `@deepseek-ai/*`；只读 `DshChatSession` 的公开接口。

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IChatSession, IChatSessionContentProvider, IChatSessionHistoryItem, IChatSessionsService } from '../../chat/common/chatSessionsService.js';
import { DshChatSession, dshChatSessionFor } from './dshChatSession.js';
import { toHistory, extrasOf } from './dshChatHistory.js';
import { IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import { dshSessionIdFromResource } from './dshAgentSessionsController.js';

/**
 * 一个 `DshChatSession` 对应的原生会话内容。
 *
 * 首次打开时先从已投影的节点树取一次 history；之后跟随 `onDidChangeNodes`
 * 增量刷新，保证运行中的流式消息也能进原生面板。
 */
export class DshChatSessionContent extends Disposable implements IChatSession {

	private readonly _onWillDispose = this._register(new Emitter<void>());
	readonly onWillDispose: Event<void> = this._onWillDispose.event;

	private readonly _onDidChangeHistory = this._register(new Emitter<readonly IChatSessionHistoryItem[]>());
	readonly onDidChangeHistory: Event<readonly IChatSessionHistoryItem[]> = this._onDidChangeHistory.event;

	private _history: readonly IChatSessionHistoryItem[];
	private readonly _session: DshChatSession;

	constructor(
		readonly sessionResource: URI,
		session: DshChatSession,
	) {
		super();
		this._session = session;
		const rebuild = () => {
			this._history = toHistory(session, session.pending(), extrasOf(session)) as readonly IChatSessionHistoryItem[];
			this._onDidChangeHistory.fire(this._history);
		};
		this._history = toHistory(session, session.pending(), extrasOf(session)) as readonly IChatSessionHistoryItem[];
		this._register(session.onDidChangeNodes(rebuild));
		this._register(session.onDidChangeHistory(rebuild));
		// 待决议项也必须进 history，否则审批 / 问卷卡在原生面板里根本不出现。
		this._register(session.onDidChangePending(rebuild));
		// 交付物 / 附件 / 额度变化同样要重建 history。
		this._register(session.onDidChangeExtras(rebuild));
	}

	get history(): readonly IChatSessionHistoryItem[] {
		return this._history;
	}

	/**
	 * 原生面板把输入框内容交给会话：直接走 `DshChatSession.submit`。
	 *
	 * 返回 `true` 表示已交给内核；失败时原生面板保留输入并提示。
	 */
	async submit(text: string): Promise<boolean> {
		return this._session.submit(text);
	}

	override dispose(): void {
		this._onWillDispose.fire();
		super.dispose();
	}

	/** 已被调用方释放：后台补历史要据此停下，不能再往已释放的对象上推。 */
	get isDisposed(): boolean {
		return this._store.isDisposed;
	}
}

/**
 * `dsh` 会话类型的 content provider。
 *
 * 每个 `dsh:/<sessionId>` 复用一个 `DshChatSession`（全局单例，见 `dshChatSessionFor`），
 * 先把视图绑到该会话再产出内容，避免拿上一个会话的节点。
 */
export class DshChatSessionContentProvider implements IChatSessionContentProvider {

	constructor(
		private readonly client: IDshClientService,
		private readonly chatSessionsService: IChatSessionsService,
	) { }

	register(): { dispose(): void } {
		return this.chatSessionsService.registerChatSessionContentProvider('dsh', this);
	}

	async provideChatSessionContent(sessionResource: URI, token: CancellationToken): Promise<IChatSession> {
		const sessionId = dshSessionIdFromResource(sessionResource);
		if (sessionId === undefined) {
			throw new Error(`invalid dsh session resource: ${sessionResource.toString()}`);
		}
		// 取消必须在 bind 之前判：`bind` 会改共享 DshChatSession 的绑定状态且不可回滚，
		// 一旦开始就不能因为调用方取消而假装没发生。
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
		const session = dshChatSessionFor(this.client);
		// 绑定会话：切走旧流、重开跟进、补读输入框目录。
		const bound = await session.bind(sessionId);
		if (!bound) {
			// 绑定失败必须让上层看到，否则原生面板会显示一个空会话。
			throw new Error(`failed to bind dsh session ${sessionId}`);
		}
		if (token.isCancellationRequested) {
			// bind 已生效：此时取消只表示调用方不再需要内容，绑定本身保留（它就是该会话的状态）。
			throw new CancellationError();
		}
		// 原生 chat 的 `IChatSession` 只有 `historyStatus`，没有「加载更多」回调，
		// 不会自己翻页。先交出首屏内容，再在后台把更早历史拉齐并推送。
		const content = new DshChatSessionContent(sessionResource, session);
		void this.fillOlderHistory(session, content, token);
		return content;
	}

	/**
	 * 循环 `loadOlder` 直到没有更多（或已达页数上限）。
	 *
	 * 不阻塞首屏：每并入一页，content 的节点事件会推一次新 history。
	 * 上限用于避免坏 `hasMore` 造成无限拉取。
	 */
	private async fillOlderHistory(session: DshChatSession, content: DshChatSessionContent, token: CancellationToken): Promise<void> {
		const MAX_PAGES = 40;
		for (let page = 0; page < MAX_PAGES; page++) {
			if (token.isCancellationRequested || content.isDisposed || !session.hasMore()) {
				return;
			}
			const before = session.firstSeq();
			const progressed = await session.loadOlder();
			if (!progressed || session.firstSeq() === before) {
				return;
			}
		}
	}
}

/** 供 `dsh.contribution.ts` 注册用。 */
export function registerDshChatSessionContent(client: IDshClientService, chatSessionsService: IChatSessionsService): { dispose(): void } {
	return new DshChatSessionContentProvider(client, chatSessionsService).register();
}

/**
 * 应答命令：原生 history 里的审批 / 问卷按钮点击后走这里。
 *
 * 参数由 `toHistory` 生成：`[eventId, 'approve'|'reject'|选项文本]`。
 * 命令只调 `DshChatSession.answerApproval/answerQuestion`，不重发 prompt。
 */
export function registerDshAnswerCommands(client: IDshClientService): { dispose(): void } {
	const disposables = new DisposableStore();
	disposables.add(CommandsRegistry.registerCommand('dsh.answerApproval', async (_accessor, eventId: unknown, decision: unknown) => {
		if (typeof eventId !== 'string' || (decision !== 'approve' && decision !== 'reject')) {
			return;
		}
		await dshChatSessionFor(client).answerApproval(eventId, decision);
	}));
	disposables.add(CommandsRegistry.registerCommand('dsh.answerQuestion', async (_accessor, eventId: unknown, label: unknown) => {
		if (typeof eventId !== 'string' || typeof label !== 'string') {
			return;
		}
		await dshChatSessionFor(client).answerQuestion(eventId, label);
	}));
	return disposables;
}
