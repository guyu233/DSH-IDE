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
import { validateDshIdeLoadOlderResult, type DshIdeDeliverableView, type DshIdeGoalView, type DshIdeImageAttachmentRef, type DshIdeLoadOlderResult, type DshIdePendingItem, type DshIdePlanView, type DshIdeQuotaNotice, type DshIdeSkillView, type DshIdeTodoView, type DshIdeViewSnapshot, type DshIdeWaterfallNotice } from '../../../../platform/dshClient/common/dshIdeProtocol.js';
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
	readonly onDidChangeExtras: Event<void>;
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
	/** Host 侧会话状态通知（`api-session/status`）：回合结束的唯一复位来源。 */
	acceptSessionStatus(sessionId: string, running: boolean): void;
}

export class DshChatSession extends Disposable implements IDshChatSession {
	private readonly model = this._register(new DshChatModel());
	private readonly _onDidChangeModelMenu = this._register(new Emitter<void>());
	private readonly _onDidChangePending = this._register(new Emitter<readonly DshChatPending[]>());
	/** typed extras（交付物 / 附件 / 额度）变化：内容没变也会 fire，渲染层自行判重。 */
	private readonly _onDidChangeExtras = this._register(new Emitter<void>());
	private readonly _onDidChangeRunning = this._register(new Emitter<boolean>());
	private readonly _onDidChangeNodes = this._register(new Emitter<readonly [readonly DshChatNode[], boolean]>());
	private readonly _onDidChangeHistory = this._register(new Emitter<void>());
	/** bind 换会话时递增。过期的 loadOlder / rebind / composer 结果不得写入新会话。 */
	private generation = 0;
	/** 正在进行的 bind 代次。同一目标在它完成前不能短路成成功。 */
	private _bindInFlight: number | undefined;
	private _disposed = false;
	private readonly pendingItems = new Map<string, DshChatPending>();
	private _models: readonly DshChatModelOption[] = [];
	private _current: { provider: string; model: string } | undefined;
	private _running = false;
	private boundSessionId: string | undefined;
	/**
	 * 绑定已「脏」：上一次 bind 已经把模型清空但 rebind 失败。
	 *
	 * 没有这个标志时，失败回滚 `boundSessionId = previous` 会让下一次 `bind(previous)`
	 * 命中开头的「相同 id 直接 return true」短路，模型永远停在空状态。
	 */
	private _boundDirty = false;
	/** typed 视图里的交付物 / 附件 / 额度提示（单一真源，面板只读）。 */
	private _deliverables: readonly DshIdeDeliverableView[] = [];
	private _attachments: readonly DshIdeImageAttachmentRef[] = [];
	private _quotaNotice: DshIdeQuotaNotice | undefined;
	/** typed 视图里的计划 / 目标 / Todo / 技能（单一真源，面板只读）。 */
	private _plan: DshIdePlanView | undefined;
	private _goal: DshIdeGoalView | undefined;
	private _todos: readonly DshIdeTodoView[] = [];
	private _skills: readonly DshIdeSkillView[] = [];

	readonly onDidChangeModelMenu: Event<void> = this._onDidChangeModelMenu.event;
	readonly onDidChangePending: Event<readonly DshChatPending[]> = this._onDidChangePending.event;
	readonly onDidChangeExtras: Event<void> = this._onDidChangeExtras.event;
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

	deliverables(): readonly DshIdeDeliverableView[] {
		return this._deliverables;
	}

	attachments(): readonly DshIdeImageAttachmentRef[] {
		return this._attachments;
	}

	quotaNotice(): DshIdeQuotaNotice | undefined {
		return this._quotaNotice;
	}

	/** 计划模式状态；`undefined` 表示这次 follow 没带投影。 */
	plan(): DshIdePlanView | undefined {
		return this._plan;
	}

	/** 当前目标；`undefined` 表示未创建目标（不伪造空目标）。 */
	goal(): DshIdeGoalView | undefined {
		return this._goal;
	}

	todos(): readonly DshIdeTodoView[] {
		return this._todos;
	}

	skills(): readonly DshIdeSkillView[] {
		return this._skills;
	}

	/**
	 * 用 typed `pending` 覆盖待决议列表。
	 *
	 * typed 字段是唯一真源：Host 已经按 eventId 聚合过，前端不再自己累加或去重。
	 */
	private acceptPending(pending: readonly DshIdePendingItem[]): void {
		const before = this.pendingItems.size;
		const beforeIds = [...this.pendingItems.keys()].join('\u0000');
		this.pendingItems.clear();
		for (const item of pending) {
			if (item.event === 'approval/request' && 'toolName' in item.request) {
				const reason = item.request.reason;
				this.pendingItems.set(item.eventId, {
					eventId: item.eventId,
					kind: 'approval',
					title: reason === undefined
						? `DSH 请求运行 ${item.request.toolName}`
						: `DSH 请求运行 ${item.request.toolName}：${reason}`,
					options: [],
				});
			} else if (item.event === 'user-questions/request' && 'questions' in item.request) {
				const question = item.request.questions[0];
				this.pendingItems.set(item.eventId, {
					eventId: item.eventId,
					kind: 'question',
					title: question?.question ?? 'DSH 提问',
					options: (question?.options ?? []).map(option => option.label),
					questionId: question?.id ?? '',
				});
			}
		}
		// 每帧都下发 pending，但内容没变就不必让面板重画。
		const afterIds = [...this.pendingItems.keys()].join('\u0000');
		if (before !== this.pendingItems.size || beforeIds !== afterIds) {
			this._onDidChangePending.fire(this.pending());
		}
	}

	running(): boolean {
		return this._running;
	}

	/** 换会话：清空旧记录、重读目录、重开跟进流。 */
	/**
	 * 换会话：清空旧记录、重读目录、重开跟进流。
	 *
	 * @returns 绑定是否成功。通道 rebind 失败时返回 false，调用方必须据此提示用户，
	 *          不能假装绑定成功继续打开视图。
	 */
	async bind(sessionId: string | undefined): Promise<boolean> {
		// 有绑定尚未完成时，不能因为 id 已经写上就返回成功：那次 rebind 仍可能失败。
		if (sessionId === this.boundSessionId && !this._boundDirty && this._bindInFlight === undefined) {
			return true;
		}
		this.generation++;
		const generation = this.generation;
		this._bindInFlight = generation;
		const previous = this.boundSessionId;
		this.boundSessionId = sessionId;
		this.model.clear();
		this.pendingItems.clear();
		this._deliverables = [];
		this._attachments = [];
		this._quotaNotice = undefined;
		this._plan = undefined;
		this._goal = undefined;
		this._todos = [];
		this._skills = [];
		this._onDidChangePending.fire([]);
		// extras 也被清空：必须通知，否则复用同一个共享会话的 content 会一直显示旧交付物。
		this._onDidChangeExtras.fire();
		this.setRunning(false);
		try {
			if (sessionId === undefined) {
				return true;
			}
			const rebound = await this.client.rebindView(sessionId);
			// 更新的 bind 已经接过这条会话。迟到的成功不能覆盖它，迟到的失败也不能把它回滚。
			if (generation !== this.generation) {
				return false;
			}
			if (!rebound.ok) {
				// 失败必须回滚绑定：否则下一次 `bind(同一 id)` 会因「相等」直接返回 true，
				// 永远不再重绑，面板停在空状态。但模型已经被 clear()，只回滚 id 不够——
				// 同时置脏，让下一次同 id 的 bind 仍会真正重跑 rebind。
				this.boundSessionId = previous;
				this._boundDirty = true;
				return false;
			}
			this._boundDirty = false;
			// `rebind` 返回的快照就是这次绑定的首屏内容：不喂给 model，面板会一直是空的，
			// 只能等后续流帧；已结束的会话根本不会再推帧。
			const view = rebound.value?.state?.state === 'ready' ? rebound.value.state.view : undefined;
			if (view !== undefined) {
				this.acceptView(view);
			}
			await this.refreshComposer();
			if (generation !== this.generation) {
				return false;
			}
			await this.refreshSkills();
			if (generation !== this.generation) {
				return false;
			}
			return true;
		} finally {
			if (this._bindInFlight === generation) {
				this._bindInFlight = undefined;
			}
		}
	}

	/** 启动时连接已由 `openView` 按开窗参数建好：只登记绑定并补读目录，不重开流。 */
	async attach(sessionId: string | undefined): Promise<void> {
		this.boundSessionId = sessionId;
		await this.refreshComposer();
		await this.refreshSkills();
	}

	/**
	 * 收一帧完整 typed 视图。
	 *
	 * 有 `conversation` 时直接用结构化节点树重建；没有（旧 Host 或非内容帧）才退回裸 `frame`。
	 * `pending` / `deliverables` / `quotaNotice` / `attachments` 同样以 typed 字段为唯一真源。
	 */
	acceptView(view: DshIdeViewSnapshot | undefined): void {
		if (view === undefined) {
			return;
		}
		if (view.conversation !== undefined) {
			this.model.acceptConversation(view.conversation);
		} else {
			this.model.accept(view.frame);
		}
		if (view.pending !== undefined) {
			this.acceptPending(view.pending);
		}
		// extras 每帧都可能带同样的值：内容不变就不通知，避免渲染层每帧全量重建 history。
		const nextDeliverables = view.deliverables ?? [];
		const nextAttachments = view.attachments ?? [];
		const nextQuota = view.quotaNotice;
		const nextPlan = view.plan !== undefined ? view.plan : this._plan;
		const nextGoal = view.goal !== undefined ? view.goal : this._goal;
		const nextTodos = view.todos !== undefined ? view.todos : this._todos;
		// follow 快照没有 skills 字段（技能走 `listSkills`）。缺省表示「这帧没带」，
		// 不能当成空目录，否则每一次内容帧都会把刚读到的技能清掉。
		const nextSkills = view.skills !== undefined ? view.skills : this._skills;
		const extrasChanged = !sameDeliverables(this._deliverables, nextDeliverables)
			|| !sameAttachments(this._attachments, nextAttachments)
			|| !sameQuota(this._quotaNotice, nextQuota)
			|| !samePlan(this._plan, nextPlan)
			|| !sameGoal(this._goal, nextGoal)
			|| !sameTodos(this._todos, nextTodos)
			|| !sameSkills(this._skills, nextSkills);
		this._deliverables = nextDeliverables;
		this._attachments = nextAttachments;
		this._quotaNotice = nextQuota;
		this._plan = nextPlan;
		this._goal = nextGoal;
		this._todos = nextTodos;
		this._skills = nextSkills;
		if (extrasChanged) {
			this._onDidChangeExtras.fire();
		}
	}

	/**
	 * 收一条 Host 侧的会话状态通知（`api-session/status`）。
	 *
	 * 这是 `_running` 唯一的正常复位来源：`submit()` 只负责乐观置 true，
	 * 回合结束时官方不会推内容帧，只有这条状态帧会带 `running: false`。
	 * 会话 id 不匹配（后台会话变化）直接忽略。
	 */
	acceptSessionStatus(sessionId: string, running: boolean): void {
		if (sessionId !== this.boundSessionId) {
			return;
		}
		this.setRunning(running);
	}

	private setRunning(running: boolean): void {
		if (this._running === running) {
			return;
		}
		this._running = running;
		this._onDidChangeRunning.fire(running);
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
		this.setRunning(true);
		const result = await this.client.call('submit', { text });
		if (!result.ok) {
			this.setRunning(false);
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

	/**
	 * 重读当前会话的技能目录。follow 帧不带 skills，只能走 `listSkills`。
	 * 读失败保持上一次的列表（首次为空），不把失败写成空目录。
	 */
	private async refreshSkills(): Promise<void> {
		const generation = this.generation;
		const sessionId = this.boundSessionId;
		if (sessionId === undefined) {
			return;
		}
		const result = await this.client.call<readonly DshIdeSkillView[]>('listSkills', {});
		if (generation !== this.generation || sessionId !== this.boundSessionId || !result.ok || !Array.isArray(result.value)) {
			return;
		}
		if (sameSkills(this._skills, result.value)) {
			return;
		}
		this._skills = result.value;
		this._onDidChangeExtras.fire();
	}

	/** 重读输入框目录：模型列表与当前选择（形状由 `projectDshIdeComposer` 决定）。 */
	async refreshComposer(): Promise<void> {
		const generation = this.generation;
		const sessionId = this.boundSessionId;
		const result = await this.client.call<{
			readonly model?: {
				readonly current?: { readonly provider?: string; readonly model?: string; readonly effort?: string } | null;
				readonly groups?: readonly { readonly id?: string; readonly models?: readonly ComposerModelCatalog[] }[];
			};
		}>('composerState', {});
		// 等待期间换了会话：这份目录属于旧绑定，不能写到新会话上。
		if (generation !== this.generation || sessionId !== this.boundSessionId || !result.ok) {
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

/** 交付物是否与上一帧相同（用于避免无变化时重建 history）。 */
function sameDeliverables(
	left: readonly DshIdeDeliverableView[],
	right: readonly DshIdeDeliverableView[],
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	for (let i = 0; i < left.length; i++) {
		const a = left[i];
		const b = right[i];
		if (a.turn !== b.turn || a.callId !== b.callId || a.files.length !== b.files.length) {
			return false;
		}
		for (let j = 0; j < a.files.length; j++) {
			if (a.files[j].path !== b.files[j].path || a.files[j].description !== b.files[j].description) {
				return false;
			}
		}
	}
	return true;
}

/** 附件列表是否与上一帧相同。 */
function sameAttachments(
	left: readonly DshIdeImageAttachmentRef[],
	right: readonly DshIdeImageAttachmentRef[],
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return left.every((item, index) => item.attachmentId === right[index].attachmentId);
}

/** 额度提示是否与上一帧相同。 */
function sameQuota(
	left: DshIdeQuotaNotice | undefined,
	right: DshIdeQuotaNotice | undefined,
): boolean {
	if (left === undefined || right === undefined) {
		return left === right;
	}
	return left.code === right.code && left.seq === right.seq;
}

/** 计划状态是否与上一帧相同。 */
function samePlan(left: DshIdePlanView | undefined, right: DshIdePlanView | undefined): boolean {
	if (left === undefined || right === undefined) {
		return left === right;
	}
	return left.active === right.active && left.pending === right.pending;
}

/** 目标是否与上一帧相同（逐字段比较，避免目标进度变化被静默吞掉）。 */
function sameGoal(left: DshIdeGoalView | undefined, right: DshIdeGoalView | undefined): boolean {
	if (left === undefined || right === undefined) {
		return left === right;
	}
	return left.roundsStarted === right.roundsStarted
		&& left.createdAt === right.createdAt
		&& left.updatedAt === right.updatedAt
		&& left.activation === right.activation
		&& left.goal.id === right.goal.id
		&& left.goal.revision === right.goal.revision
		&& left.goal.objective === right.goal.objective
		&& left.goal.phase === right.goal.phase
		&& left.goal.maxGoalRounds === right.goal.maxGoalRounds
		&& left.goal.blockedReason?.code === right.goal.blockedReason?.code
		&& left.goal.blockedReason?.message === right.goal.blockedReason?.message;
}

/** Todo 列表是否与上一帧相同。 */
function sameTodos(left: readonly DshIdeTodoView[], right: readonly DshIdeTodoView[]): boolean {
	if (left.length !== right.length) {
		return false;
	}
	for (let i = 0; i < left.length; i++) {
		if (left[i].content !== right[i].content || left[i].status !== right[i].status) {
			return false;
		}
	}
	return true;
}

/** 技能列表是否与上一帧相同（六个字段全比较，避免权限/来源变化被静默吞掉）。 */
function sameSkills(left: readonly DshIdeSkillView[], right: readonly DshIdeSkillView[]): boolean {
	if (left.length !== right.length) {
		return false;
	}
	for (let i = 0; i < left.length; i++) {
		const a = left[i];
		const b = right[i];
		if (a.name !== b.name
			|| a.description !== b.description
			|| a.whenToUse !== b.whenToUse
			|| a.modelInvocable !== b.modelInvocable
			|| a.userInvocable !== b.userInvocable
			|| a.provider !== b.provider) {
			return false;
		}
	}
	return true;
}
