/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 聊天面板的会话状态：把内核 follow 的帧、输入框目录、待决批准合成一份只读状态，
// 并把发送 / 停止 / 换模型 / 回答批准交给内核。面板只订阅这里，不碰通道细节。
//
// 边界：零 `@deepseek-ai/*`；不自己开 session/follow；不改写帧。

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import { validateDshIdeLoadOlderResult, type DshIdeLoadOlderResult, type DshIdeWaterfallNotice } from '../../../../platform/dshClient/common/dshIdeProtocol.js';
import { DshChatModel, type DshChatNode, type DshHistoryStatus } from './dshChatModel.js';

/** 下拉里的一个模型选项。 */
export interface DshChatModelOption {
	readonly provider: string;
	readonly model: string;
	readonly name: string;
}

/** 正在等用户决定的批准 / 问卷。 */
export interface DshChatPending {
	readonly eventId: string;
	readonly kind: 'approval' | 'question';
	readonly title: string;
	readonly options: readonly string[];
	readonly questionId?: string;
}

/** 输入框目录里的一个模型（`projectDshIdeComposer` 的 `model.groups[].models[]`）。 */
interface ComposerModelCatalog {
	readonly id?: string;
	readonly name?: string;
}

export interface IDshChatSession {
	readonly onDidChangeNodes: Event<readonly [readonly DshChatNode[], boolean]>;
	readonly onDidChangeHistory: Event<void>;
	readonly onDidChangeModelMenu: Event<void>;
	readonly onDidChangePending: Event<readonly DshChatPending[]>;
	readonly onDidChangeRunning: Event<boolean>;
	nodes(): readonly DshChatNode[];
	/**
	 * 每个节点的 Turn 坐标，与 `nodes()` 同序。
	 *
	 * `user/message` 事件不带 turn，只有按 seq 顺序扫过 turn/start 才能定位；
	 * 这份坐标来自 `DshChatModel.located`，界面不再自己推断回合。
	 */
	locatedTurns(): readonly (number | undefined)[];
	/**
	 * 整个会话的 token 用量（Host 的 `tokenUsage` 投影）。
	 *
	 * `undefined` 表示这次 follow 没带投影 —— 用量条据此隐藏，绝不显示伪造的 0。
	 */
	tokenUsage(): { uncachedInputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number } | undefined;
	models(): readonly DshChatModelOption[];
	currentModel(): { readonly provider: string; readonly model: string } | undefined;
	pending(): readonly DshChatPending[];
	running(): boolean;
	/** 发送一句话；成功即交给内核。 */
	submit(text: string): Promise<boolean>;
	/** 向更早的历史要一页。true 表示这次真的插入了新节点。 */
	loadOlder(): Promise<boolean>;
	hasMore(): boolean;
	firstSeq(): number | undefined;
	historyStatus(): DshHistoryStatus;
	selectModel(provider: string, model: string): Promise<void>;
	cancel(): Promise<void>;
	answerApproval(eventId: string, decision: 'approve' | 'reject'): Promise<void>;
	answerQuestion(eventId: string, label: string): Promise<void>;
}

export class DshChatSession extends Disposable implements IDshChatSession {
	private readonly model = this._register(new DshChatModel());
	private readonly _onDidChangeModelMenu = this._register(new Emitter<void>());
	private readonly _onDidChangePending = this._register(new Emitter<readonly DshChatPending[]>());
	private readonly _onDidChangeRunning = this._register(new Emitter<boolean>());
	private readonly _onDidChangeNodes = this._register(new Emitter<readonly [readonly DshChatNode[], boolean]>());
	private readonly _onDidChangeHistory = this._register(new Emitter<void>());
	/** bind 换会话时递增。过期的 loadOlder 结果不得写入新会话。 */
	private generation = 0;
	private _disposed = false;
	private readonly pendingItems = new Map<string, DshChatPending>();
	private _models: readonly DshChatModelOption[] = [];
	private _current: { provider: string; model: string } | undefined;
	private _running = false;
	private boundSessionId: string | undefined;

	readonly onDidChangeModelMenu: Event<void> = this._onDidChangeModelMenu.event;
	readonly onDidChangePending: Event<readonly DshChatPending[]> = this._onDidChangePending.event;
	readonly onDidChangeRunning: Event<boolean> = this._onDidChangeRunning.event;
	readonly onDidChangeNodes: Event<readonly [readonly DshChatNode[], boolean]> = this._onDidChangeNodes.event;
	readonly onDidChangeHistory: Event<void> = this._onDidChangeHistory.event;

	constructor(private readonly client: IDshClientService) {
		super();
		this._register(this.model.onDidReset(() => this._onDidChangeNodes.fire([[], true])));
		this._register(this.model.onDidChange(changes => {
			if (changes.length > 0) {
				this._onDidChangeNodes.fire([this.model.list, false]);
			}
		}));
		this._register(this.model.onDidChangeHistory(() => this._onDidChangeHistory.fire()));
	}

	nodes(): readonly DshChatNode[] {
		return this.model.list;
	}

	locatedTurns(): readonly (number | undefined)[] {
		return this.model.located.map(entry => entry.turn);
	}

	tokenUsage(): { uncachedInputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number } | undefined {
		return this.model.tokenUsage();
	}

	models(): readonly DshChatModelOption[] {
		return this._models;
	}

	currentModel(): { readonly provider: string; readonly model: string } | undefined {
		return this._current;
	}

	pending(): readonly DshChatPending[] {
		return [...this.pendingItems.values()];
	}

	running(): boolean {
		return this._running;
	}

	boundId(): string | undefined {
		return this.boundSessionId;
	}

	/** 换会话：清空旧记录、重读目录、重开跟进流。 */
	async bind(sessionId: string | undefined): Promise<void> {
		if (sessionId === this.boundSessionId) {
			return;
		}
		this.generation++;
		this.boundSessionId = sessionId;
		this.model.clear();
		this.pendingItems.clear();
		this._onDidChangePending.fire([]);
		this._running = false;
		this._onDidChangeRunning.fire(false);
		if (sessionId === undefined) {
			return;
		}
		const rebound = await this.client.rebindView(sessionId);
		if (!rebound.ok) {
			return;
		}
		await this.refreshComposer();
	}

	/** 启动时连接已由 `openView` 按开窗参数建好：只登记绑定并补读目录，不重开流。 */
	async attach(sessionId: string | undefined): Promise<void> {
		this.boundSessionId = sessionId;
		await this.refreshComposer();
	}

	/** 收一帧内核送来的 follow 结果 / 批准帧。 */
	accept(snapshotView: Readonly<Record<string, unknown>> | undefined): void {
		if (snapshotView !== undefined) {
			this.model.accept(snapshotView);
		}
	}

	/** 批准 / 问卷帧：登记成本地面的卡片，不再走通知。 */
	acceptWaterfall(notice: DshIdeWaterfallNotice): void {
		if (notice.kind === 'cancel') {
			if (this.pendingItems.delete(notice.eventId)) {
				this._onDidChangePending.fire(this.pending());
			}
			return;
		}
		if (notice.event === 'approval/request' && 'toolName' in notice.request) {
			const reason = notice.request.reason;
			this.pendingItems.set(notice.eventId, {
				eventId: notice.eventId,
				kind: 'approval',
				title: reason === undefined
					? `DSH 请求运行 ${notice.request.toolName}`
					: `DSH 请求运行 ${notice.request.toolName}：${reason}`,
				options: [],
			});
		} else if (notice.event === 'user-questions/request' && 'questions' in notice.request) {
			const question = notice.request.questions[0];
			this.pendingItems.set(notice.eventId, {
				eventId: notice.eventId,
				kind: 'question',
				title: question?.question ?? 'DSH 提问',
				options: (question?.options ?? []).map(option => option.label),
				questionId: question?.id ?? '',
			});
		}
		this._onDidChangePending.fire(this.pending());
	}

	hasMore(): boolean {
		return this.model.hasMore();
	}

	firstSeq(): number | undefined {
		return this.model.firstSeq();
	}

	historyStatus(): DshHistoryStatus {
		return this.model.historyStatus();
	}

	/**
	 * 用当前最小 seq 作为 beforeSeq，向 Host 要一页更早的记录。
	 * 单飞、无游标、没有更多、换会话之后的回包，都直接丢掉。
	 */
	async loadOlder(): Promise<boolean> {
		if (this._disposed || this.boundSessionId === undefined) {
			return false;
		}
		if (this.model.historyStatus() === 'loading' || !this.model.hasMore()) {
			return false;
		}
		const beforeSeq = this.model.firstSeq();
		if (beforeSeq === undefined) {
			return false;
		}
		const generation = this.generation;
		const sessionId = this.boundSessionId;
		this.model.setHistoryStatus('loading');
		try {
			const result = await this.client.call<DshIdeLoadOlderResult>('loadOlder', { sessionId, beforeSeq });
			if (generation !== this.generation) {
				return false;
			}
			if (!result.ok) {
				this.model.setHistoryStatus('error');
				return false;
			}
			const output = validateDshIdeLoadOlderResult(result.value);
			if (generation !== this.generation) {
				return false;
			}
			const outcome = this.model.prependPage(output.page);
			if (generation !== this.generation) {
				return false;
			}
			this.model.setHistoryStatus('idle');
			return outcome.added > 0;
		} catch {
			if (generation === this.generation) {
				this.model.setHistoryStatus('error');
			}
			return false;
		}
	}

	/** 发送一句话。成功后交给内核，不做乐观插入。 */
	async submit(text: string): Promise<boolean> {
		this._running = true;
		this._onDidChangeRunning.fire(true);
		const result = await this.client.call('submit', { text });
		if (!result.ok) {
			this._running = false;
			this._onDidChangeRunning.fire(false);
			return false;
		}
		return true;
	}

	async cancel(): Promise<void> {
		await this.client.call('interrupt', {});
	}

	async selectModel(provider: string, model: string): Promise<void> {
		const result = await this.client.call('setModel', { model: `${provider}/${model}` });
		if (result.ok) {
			this._current = { provider, model };
			this._onDidChangeModelMenu.fire();
		}
	}

	async answerApproval(eventId: string, decision: 'approve' | 'reject'): Promise<void> {
		this.pendingItems.delete(eventId);
		this._onDidChangePending.fire(this.pending());
		await this.client.call('answerApproval', { requestId: eventId, decision });
	}

	async answerQuestion(eventId: string, label: string): Promise<void> {
		const item = this.pendingItems.get(eventId);
		this.pendingItems.delete(eventId);
		this._onDidChangePending.fire(this.pending());
		// 答案里的 id 是问卷题号（官方 `{ answers: [{ id, selected }] }`），不是 eventId。
		await this.client.call('answerQuestion', {
			requestId: eventId,
			answer: { answers: [{ id: item?.questionId ?? '', selected: [label] }] },
		});
	}

	/** 重读输入框目录：模型列表与当前选择（形状由 `projectDshIdeComposer` 决定）。 */
	async refreshComposer(): Promise<void> {
		const result = await this.client.call<{
			readonly model?: {
				readonly current?: { readonly provider?: string; readonly model?: string; readonly effort?: string } | null;
				readonly groups?: readonly { readonly id?: string; readonly models?: readonly ComposerModelCatalog[] }[];
			};
		}>('composerState', {});
		if (!result.ok) {
			return;
		}
		const options: DshChatModelOption[] = [];
		for (const group of result.value.model?.groups ?? []) {
			const provider = typeof group.id === 'string' && group.id !== '' ? group.id : '';
			for (const model of group.models ?? []) {
				if (typeof model.id !== 'string' || model.id === '') {
					continue;
				}
				options.push({ provider, model: model.id, name: typeof model.name === 'string' && model.name !== '' ? model.name : model.id });
			}
		}
		this._models = options;
		const provider = result.value.model?.current?.provider;
		const model = result.value.model?.current?.model;
		this._current = typeof provider === 'string' && provider !== '' && typeof model === 'string' && model !== ''
			? { provider, model }
			: undefined;
		this._onDidChangeModelMenu.fire();
	}

	/** 运行态由 Stream 帧以外的信号也能确认：有流式条目即算在跑。 */
	noteRunning(running: boolean): void {
		if (this._running === running) {
			return;
		}
		this._running = running;
		this._onDidChangeRunning.fire(running);
	}

	override dispose(): void {
		this._disposed = true;
		this.generation++;
		super.dispose();
	}
}

/** 进程内唯一的聊天会话状态：贡献点与聊天视图共用同一份（帧只喂一次）。 */
let sharedChatSession: DshChatSession | undefined;

export function dshChatSessionFor(client: IDshClientService): DshChatSession {
	if (sharedChatSession === undefined) {
		sharedChatSession = new DshChatSession(client);
	}
	return sharedChatSession;
}
