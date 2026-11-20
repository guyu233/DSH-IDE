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
import { localize } from '../../../../nls.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { observableFromEvent, IObservable } from '../../../../base/common/observable.js';
import { URI } from '../../../../base/common/uri.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IChatSession, IChatSessionContentProvider, IChatSessionHistoryItem, IChatSessionProviderOptionItem, IChatSessionsService } from '../../chat/common/chatSessionsService.js';
import { DshChatSession, dshChatSessionFor } from './dshChatSession.js';
import { toHistory, extrasOf, extrasFingerprint, type DshHistoryExtras } from './dshChatHistory.js';
import { DSH_EFFORT_PROPERTY } from './dshComposerProjection.js';
import { IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import type { DshIdeImageAttachmentRef } from '../../../../platform/dshClient/common/dshIdeProtocol.js';
import { dshSessionIdFromResource } from './dshAgentSessionsController.js';
import { DSH_CHAT_SESSION_TYPE } from './dshSessionType.js';

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
		// 本对象只代表这一个会话资源。共享会话被换绑到别的会话之后，
		// 它的事件仍会触发，但那时共享状态已经不是本资源的内容——必须拒绝重建，
		// 否则缓存里的 A 会显示 B 的历史。
		this._sessionId = dshSessionIdFromResource(sessionResource);
		// 一帧内容会连发 pending / extras / nodes 三个事件。每个都全量重建 history 的话，
		// 同一帧要跑三遍 O(节点数) 的投影。合并到一次微任务里，一帧只重建一次。
		let rebuildScheduled = false;
		const rebuild = () => {
			if (rebuildScheduled) {
				return;
			}
			rebuildScheduled = true;
			queueMicrotask(() => {
				rebuildScheduled = false;
				if (!this.isActiveBinding()) {
					return;
				}
				// 节点数 + 首尾 seq + 待决议条数 + extras 版本作为廉价指纹：
				// 都没变就不重建、不通知。`toHistory` 每次返回新数组，比引用没意义。
				//
				// extras（目标 / 计划 / 待办 / 技能 / 团队 / 交付物）不体现在节点上，
				// 但它们会改变 history 的尾部内容——不纳入指纹的话，目标从「进行中」
				// 变成「已完成」时界面会停在旧文案。
				const extras = extrasOf(session);
				const fingerprint = historyFingerprintOf(session, extras);
				if (fingerprint === this._historyFingerprint) {
					return;
				}
				this._historyFingerprint = fingerprint;
				const rebuilt = toHistory(session, session.pending(), extras) as readonly IChatSessionHistoryItem[];
				// 截断警告是「这次加载没到底」的说明，不属于 Host 投影。
				// 重建时必须拼回去，否则新内容一到它就消失了。
				this._history = this._truncationFolded
					? [...rebuilt, TRUNCATION_NOTICE]
					: rebuilt;
				this._onDidChangeHistory.fire(this._history);
			});
		};
		const initialExtras = extrasOf(session);
		this._history = toHistory(session, session.pending(), initialExtras) as readonly IChatSessionHistoryItem[];
		// 初始化时就要记下指纹：否则第一次 rebuild 会因为「上次指纹为空」而白重建一次。
		this._historyFingerprint = historyFingerprintOf(session, initialExtras);
		this._register(session.onDidChangeNodes(rebuild));
		this._register(session.onDidChangeHistory(rebuild));
		// 待决议项也必须进 history，否则审批 / 问卷卡在原生面板里根本不出现。
		this._register(session.onDidChangePending(rebuild));
		// 交付物 / 附件 / 额度变化同样要重建 history。
		this._register(session.onDidChangeExtras(rebuild));
	}

	/** 本内容对象代表的会话 id（资源里解析出来的那个）。 */
	private readonly _sessionId: string | undefined;

	/**
	 * 共享会话此刻是否仍代表本资源。
	 *
	 * 资源与绑定必须同时匹配：只有「共享会话当前绑的就是我这条」时，它的事件才是我的内容。
	 */
	private isActiveBinding(): boolean {
		return this._sessionId !== undefined && this._session.activeSessionId === this._sessionId;
	}

	get history(): readonly IChatSessionHistoryItem[] {
		return this._history;
	}

	/**
	 * 原生面板的完成态：`false` 表示还在生成。
	 *
	 * 不接这个 observable 时，面板无法把响应标成完成、也不会显示可用的停止按钮。
	 * 真源仍是 `DshChatSession.running()`，这里只是把它转成原生认的 observable。
	 */
	private _isCompleteObs: IObservable<boolean> | undefined;

	get isCompleteObs(): IObservable<boolean> {
		this._isCompleteObs ??= observableFromEvent(
			this,
			this._session.onDidChangeRunning,
			() => !this._session.running(),
		);
		return this._isCompleteObs;
	}

	/**
	 * 原生面板把输入框内容交给会话：直接走 `DshChatSession.submit`。
	 *
	 * 返回 `true` 表示已交给内核。失败时保留输入，并由 `submitFailure()` 给出原因，
	 * 调用方必须把它显示出来——只 return false 会让发送按钮看起来没反应。
	 */
	async submit(text: string, attachments?: readonly DshIdeImageAttachmentRef[]): Promise<boolean> {
		// 陈旧内容不得把文字发进当前绑定到的另一个会话。
		if (!this.isActiveBinding()) {
			this._submitFailure = localize('dsh.submit.stale', "这条聊天页已经不是当前会话，消息没有发出。");
			return false;
		}
		this._submitFailure = undefined;
		return this._session.submit(text, attachments);
	}

	private _submitFailure: string | undefined;

	submitFailure(): string | undefined {
		return this._submitFailure ?? this._session.submitFailure();
	}

	/**
	 * 面板上的停止按钮：走官方 `interrupt`。
	 *
	 * 返回 false 表示没有可中断的运行；原生面板据此决定是否继续显示停止态。
	 */
	async interruptActiveResponseCallback(): Promise<boolean> {
		// 陈旧内容不得停掉当前绑定到的另一个会话。
		if (!this.isActiveBinding()) {
			return false;
		}
		if (!this._session.running()) {
			return false;
		}
		// false：Host 拒绝或会话已换。原生停止按钮会保持可点，而不是当成已经停掉。
		return this._session.cancel();
	}

	/**
	 * 原生模型选择器的写回入口。
	 *
	 * 原生选择器只改本地状态；`chatInputPart._writeModelSelectionToSession` 通过这个可选方法
	 * 把用户的选择交给内核。不实现它，界面会显示 A 而实际仍用 B（写入静默跳过）。
	 * @param provider DSH 供应商 id（模型的真实路由）
	 * @param model 供应商内的模型 id
	 */
	async selectModel(provider: string, model: string): Promise<void> {
		// 陈旧内容不得把选择写到当前绑定到的另一个会话。
		if (!this.isActiveBinding()) {
			return;
		}
		await this._session.selectModel(provider, model);
	}

	/**
	 * 推理档写回：原生配置项的键就是 `reasoningEffort`（见 `toLanguageModel` 的 schema）。
	 * @param effort DSH 推理档 id
	 */
	async selectEffort(effort: string): Promise<void> {
		if (!this.isActiveBinding()) {
			return;
		}
		await this._session.selectEffort(effort);
	}

	/**
	 * 原生模型配置项 → DSH 会话的通用入口。
	 *
	 * 会话当前只认推理档；其余配置键（上下文窗口、tier 等）属于 VS Code 本地语义，
	 * 原样忽略，不把不认识的值当成已生效。
	 * @param configuration 原生配置项快照
	 */
	async applyModelConfiguration(configuration: Readonly<Record<string, unknown>>): Promise<void> {
		const effort = configuration[DSH_EFFORT_PROPERTY];
		if (typeof effort === 'string' && effort !== '') {
			await this.selectEffort(effort);
		}
	}

	/**
	 * 剪贴板 / 拖入图片的入库入口。
	 *
	 * 缺这个方法时 `chatWidget` 会走「这条会话只能发送已入库的图片附件」的拒绝分支，
	 * 用户无法粘贴截图。入库仍由 Host 的官方 `saveImages` 完成，这里只做转发。
	 */
	private _imageFailure: string | undefined;

	imageFailure(): string | undefined {
		return this._imageFailure ?? this._session.imageFailure();
	}

	async saveImage(data: Uint8Array, mediaType: string, name?: string): Promise<DshIdeImageAttachmentRef | undefined> {
		if (!this.isActiveBinding()) {
			this._imageFailure = localize('dsh.image.stale', "这条聊天页已经不是当前会话，图片没有入库。");
			return undefined;
		}
		this._imageFailure = undefined;
		return this._session.saveImage(data, mediaType, name);
	}

	override dispose(): void {
		this._onWillDispose.fire();
		super.dispose();
	}

	/** 已被调用方释放：后台补历史要据此停下，不能再往已释放的对象上推。 */
	get isDisposed(): boolean {
		return this._store.isDisposed;
	}

	/**
	 * 后台补历史到了页数上限、但 Host 仍说还有更多。
	 *
	 * 不能静默停下：用户会以为历史完整。这里在末尾追加一条说明，
	 * 让「还没到底」这件事在面板上可见。
	 */
	reportOlderHistoryTruncated(): void {
		if (this._store.isDisposed) {
			return;
		}
		// 只提示一次：同一个会话反复打开都会走到 40 页上限，每次都追加的话，
		// history 尾部会堆出一串一模一样的警告。
		if (this._truncationReported) {
			return;
		}
		this._truncationReported = true;
		this._history = [...this._history, TRUNCATION_NOTICE];
		// 追加后要让后续 rebuild 知道「这条警告已经并进 history」。
		// 不标记的话，下一次内容变化触发的 rebuild 会用 toHistory 重建，
		// 把这条警告整条抹掉——而 `_truncationReported` 已是 true，再也不会补回来。
		this._truncationFolded = true;
		this._onDidChangeHistory.fire(this._history);
	}

	/** 截断警告只追加一次，见 `reportOlderHistoryTruncated`。 */
	private _truncationReported = false;

	/**
	 * 截断警告已并进当前 history。
	 *
	 * rebuild 重建时要把它重新拼回去，否则新内容一到，这条警告就消失了。
	 */
	private _truncationFolded = false;

	/** 上一次重建 history 时的内容指纹，见 rebuild。 */
	private _historyFingerprint: string | undefined;
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

	/**
	 * 给真实会话补一次选项组。
	 *
	 * 原生 `chatSessionsService` 只在 `/untitled-*` 资源上调用
	 * `getNewChatSessionInputState`，而 `dsh:` 会话从创建起就是真实资源。不补这一步，
	 * `getOptionGroupsForSessionType('dsh')` 永远是空数组，模型选择器判定「无可用模型」、
	 * 权限与预设选择器则完全不渲染。
	 *
	 * 失败不抛：选项组是增强，不是会话内容；读不到就保持空（选择器隐藏），
	 * 不影响 history 与发送。
	 * @param sessionResource 会话资源（`dsh:/<id>`）
	 */
	private async registerSessionOptions(sessionResource: URI): Promise<void> {
		try {
			const groups = await this.chatSessionsService.getNewChatSessionInputState(DSH_CHAT_SESSION_TYPE, sessionResource);
			if (groups === undefined || groups.length === 0) {
				return;
			}
			// 组只是「有哪些选项」，具体选中值保存在会话的 options 上：
			// 不写这一份，`getVisibleOptionGroups` 的 `sessionHasOption` 判据仍为 false。
			const options = new Map<string, string | IChatSessionProviderOptionItem>();
			for (const group of groups) {
				const selected = group.selected ?? group.items.find(item => item.default) ?? group.items[0];
				if (selected !== undefined) {
					options.set(group.id, selected);
				}
			}
			if (options.size > 0) {
				this.chatSessionsService.updateSessionOptions(sessionResource, options);
			}
		} catch {
			// 目录暂不可用（Host 还没就绪）：保持隐藏，下一次打开会话会再试。
		}
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
			// 带上 Host 的真实原因：只写 sessionId 的话，用户看到的是一个内部标识符。
			throw new Error(session.bindFailure() ?? `failed to bind dsh session ${sessionId}`);
		}
		// 选项组只对 untitled 会话由 chatSessionsService 自动拉取；`dsh:` 是真实资源，
		// 不主动补一次，模型/权限/预设三个选择器会永远读不到组（`chatSessionHasModels` 恒假）。
		void this.registerSessionOptions(sessionResource);
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
		// 到上限时 Host 仍说还有更多：不能装作已经到底。
		// 这里的静默停止会让用户以为历史完整，实际上更早的记录还在 Host 上。
		if (!content.isDisposed && session.hasMore()) {
			content.reportOlderHistoryTruncated();
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
		const session = dshChatSessionFor(client);
		await session.answerQuestion(eventId, label);
		if (session.questionFellBackToDesktop(eventId)) {
			// 原生面板只能显示一题：这份问卷需要多题或多选答案，必须由桌面入口完整回答。
			// 明确告知，不让用户以为已经提交成功。
			session.notifyQuestionNeedsDesktop(eventId);
		}
	}));
	return disposables;
}

/**
 * 到页数上限但 Host 仍说还有更多时的说明。
 *
 * 它不属于 Host 投影，`toHistory` 不会生成；重建 history 时要重新拼回去。
 */
const TRUNCATION_NOTICE: IChatSessionHistoryItem = {
	type: 'response',
	participant: 'dsh',
	parts: [{ kind: 'warning', content: { value: localize('dsh.history.truncated', "更早的历史还有更多，已先加载到本次上限。") } }],
};

/**
 * history 的内容指纹：判断「这一帧有没有改变 history」。
 *
 * 节点部分取「条数 + 首尾 seq」，足以识别新增、替换与清空；
 * extras 部分由 `extrasFingerprint` 提供，覆盖不体现在节点上的尾部内容。
 */
function historyFingerprintOf(session: DshChatSession, extras: DshHistoryExtras): string {
	const nodes = session.nodes();
	const first = nodes[0]?.seq ?? -1;
	const last = nodes[nodes.length - 1]?.seq ?? -1;
	return `${nodes.length}:${first}:${last}:${session.pending().length}:${extrasFingerprint(extras)}`;
}
