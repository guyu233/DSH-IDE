/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 聊天面板的会话状态：把内核 follow 的帧、输入框目录、待决批准合成一份只读状态，
// 并把发送 / 停止 / 换模型 / 回答批准交给内核。面板只订阅这里，不碰通道细节。
//
// 边界：零 `@deepseek-ai/*`；不自己开 session/follow；不改写帧。

import { localize } from '../../../../../nls.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { VSBuffer, encodeBase64 } from '../../../../../base/common/buffer.js';
import { IDshClientService } from '../../../../../platform/dshClient/common/dshClientService.js';
import { dshErrorText, DSH_IDE_FEATURE_UNAVAILABLE, DSH_IDE_HISTORY_MAX_MESSAGES, DSH_IDE_HISTORY_TURN_WINDOW, validateDshIdeLoadOlderResult, type DshIdeConversationView, type DshIdeDeliverableView, type DshIdeGoalView, type DshIdeContextBreakdown, type DshIdeContextPressure, type DshIdeImageAttachmentRef, type DshIdeInboxMessage, type DshIdePresentationSettings, type DshIdeQueueAction, type DshIdeLoadOlderResult, type DshIdePendingItem, type DshIdePlanView, type DshIdeQuotaNotice, type DshIdeSkillView, type DshIdeTeamView, type DshIdeTodoView, type DshIdeWorktreeView, type DshIdeViewSnapshot, type DshIdeWaterfallNotice } from '../../../../../platform/dshClient/protocol/dshIdeProtocol.js';
import { DshChatModel, type DshChatNode, type DshHistoryStatus } from './dshChatModel.js';
import { settleApproval, settleQuestion, type DshQuestionDraft, type DshSettlementIntent } from './dshPendingSettlement.js';
import { retainQuotaNotice } from './dshQuotaNotice.js';
import { getDshComposerSource } from './dshComposerRegistry.js';

/** 下拉里的一个模型选项。 */
export interface DshChatModelOption {
	readonly provider: string;
	readonly model: string;
	readonly name: string;
}

/**
 * 问卷里的一题。
 *
 * 为什么整题保留：官方问卷可以是多题、多选、无选项。只取第一题与单选会把用户
 * 实际看到的业务问卷悄悄缩写，答案因此不完整。
 */
export interface DshChatQuestion {
	readonly id: string;
	readonly question?: string;
	readonly detail?: string;
	readonly header?: string;
	readonly options: readonly { readonly label: string; readonly description?: string }[];
	readonly multiSelect: boolean;
	readonly intent?: DshSettlementIntent;
}

/** 正在等用户决定的批准 / 问卷。 */
export interface DshChatPending {
	readonly eventId: string;
	readonly kind: 'approval' | 'question';
	readonly title: string;
	readonly options: readonly string[];
	readonly questionId?: string;
	/** 问卷的全部题目（批准为空）。原生面板只用第一题做摘要，提交时用完整清单。 */
	readonly questions: readonly DshChatQuestion[];
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
	/**
	 * 官方 `contextPressure` 投影（composer `activity` 项的数据源）。
	 *
	 * 与 `tokenUsage()`（流式增量累计）不同：这是 Host 按官方 `tokenMeter` 折叠出的
	 * 「最新 provider 报告的 prompt 大小 + 路由容量」，**只在投影里**，不在流式帧上。
	 * 缺省表示这帧没带（保留上一次）。
	 */
	contextPressure(): DshIdeContextPressure | undefined;
	/** 官方 `contextBreakdown` 投影：上下文**构成**（启发式，不是总量）。 */
	contextBreakdown(): DshIdeContextBreakdown | undefined;
	models(): readonly DshChatModelOption[];
	currentModel(): { readonly provider: string; readonly model: string } | undefined;
	pending(): readonly DshChatPending[];
	running(): boolean;
	/** 当前目标；`undefined` 表示未创建目标（不伪造空目标）。 */
	goal(): DshIdeGoalView | undefined;
	/** 共享任务板；`undefined` 表示本帧没带该投影。 */
	team(): DshIdeTeamView | undefined;
	/** 当前绑定的会话 id；未绑定时为 undefined。 */
	readonly activeSessionId: string | undefined;
	/** 发送一句话；成功即交给内核。 */
	submit(text: string, attachments?: readonly DshIdeImageAttachmentRef[]): Promise<boolean>;
	/** 最近一次 `submit` 失败的原因；成功后清空。 */
	submitFailure(): string | undefined;
	/** 最近一次绑定失败的可读原因；成功绑定后清空。 */
	bindFailure(): string | undefined;
	/** 向更早的历史要一页。true 表示这次真的插入了新节点。 */
	loadOlder(): Promise<boolean>;
	hasMore(): boolean;
	/** 排队等下一个 Turn 的输入（官方 `inbox['next-turn']`，含内容块）。 */
	inboxNextTurn(): readonly DshIdeInboxMessage[];
	/** 排队等下一个 step 的转向输入（官方 `inbox['next-step']`）。 */
	inboxNextStep(): readonly DshIdeInboxMessage[];
	/**
	 * 读 Host 的表现偏好（官方 `presentationSettings`）。
	 *
	 * 四项都是**表现**而非会话事实：`transcriptView` 决定整个 Turn 的默认折叠，
	 * `collapseTiming` / `foldedReplies` / `developerTools` 同理。Host 侧早已实现，
	 * IDE 侧此前从未调用——「数据存在但界面未显示」。
	 */
	presentationSettings(): Promise<DshIdePresentationSettings | undefined>;
	/**
	 * 已读到的表现偏好（同步）。首次 `presentationSettings()` 成功后填入。
	 *
	 * composer 的统计行在**每次渲染**时都要知道 `performanceUsage`，不能为它再发一次异步请求；
	 * 读到之前返回 `undefined`，调用方按官方默认（`detailed`）处理。
	 */
	presentationSettingsCache(): DshIdePresentationSettings | undefined;
	firstSeq(): number | undefined;
	historyStatus(): DshHistoryStatus;
	selectModel(provider: string, model: string): Promise<void>;
	/** 切换推理档；未绑定时是空操作。 */
	selectEffort(effort: string): Promise<void>;
	/**
	 * 修改一条仍在排队的输入（官方 `session.updateQueue`）。
	 *
	 * 返回 `true` 表示 Host 已接受；失败原因经 `dshErrorText` 保留官方码
	 * （`session/queue-item-not-found` 等），调用方据此给出可区分的提示。
	 */
	updateQueue(itemId: string, action: DshIdeQueueAction): Promise<boolean>;
	cancel(): Promise<boolean>;
	answerApproval(eventId: string, decision: 'approve' | 'reject'): Promise<void>;
	answerQuestion(eventId: string, label: string): Promise<void>;
	/** Host 侧会话状态通知（`api-session/status`）：回合结束的唯一复位来源。 */
	acceptSessionStatus(sessionId: string, running: boolean): void;
}

export class DshChatSession extends Disposable implements IDshChatSession {
	private readonly model = this._register(new DshChatModel());
	private readonly _onDidChangeModelMenu = this._register(new Emitter<void>());
	private readonly _onDidChangePending = this._register(new Emitter<readonly DshChatPending[]>());
	private readonly _onDidNeedDesktopQuestion = this._register(new Emitter<string>());
	/** typed extras（交付物 / 附件 / 额度）变化：内容没变也会 fire，渲染层自行判重。 */
	private readonly _onDidChangeExtras = this._register(new Emitter<void>());
	private readonly _onDidChangeRunning = this._register(new Emitter<boolean>());
	private readonly _onDidFailAction = this._register(new Emitter<string>());
	/** 模型、推理档等写回被拒绝：界面不能只停在用户刚点的选项上。 */
	readonly onDidFailAction = this._onDidFailAction.event;
	private readonly _onDidChangeNodes = this._register(new Emitter<readonly [readonly DshChatNode[], boolean]>());
	private readonly _onDidChangeHistory = this._register(new Emitter<void>());
	/** bind 换会话时递增。过期的 loadOlder / rebind / composer 结果不得写入新会话。 */
	private generation = 0;
	/** 正在进行的 bind 代次。同一目标在它完成前不能短路成成功。 */
	private _bindInFlight: number | undefined;
	private _disposed = false;
	private readonly pendingItems = new Map<string, DshChatPending>();
	private readonly _questionSubmissions = new Map<string, object>();
	private _models: readonly DshChatModelOption[] = [];
	private _current: { provider: string; model: string } | undefined;
	private _running = false;
	/** 已读到的表现偏好（官方 `presentationSettings` 的缓存，供同步读取）。 */
	private _presentationSettings: DshIdePresentationSettings | undefined;
	/** 官方 `contextPressure` 投影（「缺省=保留」：旧 Host 帧不带该字段时不误清）。 */
	private _contextPressure: DshIdeContextPressure | undefined;
	/** 官方 `contextBreakdown` 投影（「缺省=保留」）。 */
	private _contextBreakdown: DshIdeContextBreakdown | undefined;
	private boundSessionId: string | undefined;

	/** 当前绑定会话（只读）。模型目录等会话投影的读取方据此带上发起会话。 */
	get activeSessionId(): string | undefined {
		return this.boundSessionId;
	}
	/**
	 * 绑定已「脏」：上一次 bind 已经把模型清空但 rebind 失败。
	 *
	 * 没有这个标志时，失败回滚 `boundSessionId = previous` 会让下一次 `bind(previous)`
	 * 命中开头的「相同 id 直接 return true」短路，模型永远停在空状态。
	 */
	private _boundDirty = false;
	/** 最近一次绑定失败的原因；成功绑定后清空。 */
	private _bindFailure: string | undefined;
	/** 同一会话在途的技能目录读取；并发触发复用同一次请求。 */
	private _skillsInFlight: { readonly sessionId: string; readonly work: Promise<void> } | undefined;
	/** 同一会话在途的输入框目录读取；并发触发复用同一次请求。 */
	private _composerInFlight: { readonly sessionId: string; readonly work: Promise<void> } | undefined;
	/** typed 视图里的交付物 / 附件 / 额度提示（单一真源，面板只读）。 */
	private _deliverables: readonly DshIdeDeliverableView[] = [];
	private _attachments: readonly DshIdeImageAttachmentRef[] = [];
	private _quotaNotice: DshIdeQuotaNotice | undefined;
	/** typed 视图里的计划 / 目标 / Todo / 技能（单一真源，面板只读）。 */
	private _plan: DshIdePlanView | undefined;
	private _goal: DshIdeGoalView | undefined;
	private _team: DshIdeTeamView | undefined;
	private _worktrees: readonly DshIdeWorktreeView[] = [];
	private _todos: readonly DshIdeTodoView[] = [];
	private _skills: readonly DshIdeSkillView[] = [];

	readonly onDidChangeModelMenu: Event<void> = this._onDidChangeModelMenu.event;
	readonly onDidChangePending: Event<readonly DshChatPending[]> = this._onDidChangePending.event;
	/** 问卷需要桌面入口才能完整回答。 */
	readonly onDidNeedDesktopQuestion: Event<string> = this._onDidNeedDesktopQuestion.event;
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

	contextPressure(): DshIdeContextPressure | undefined {
		return this._contextPressure;
	}

	contextBreakdown(): DshIdeContextBreakdown | undefined {
		return this._contextBreakdown;
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

	/** 共享任务板；`undefined` 表示本帧没带该投影。 */
	team(): DshIdeTeamView | undefined {
		return this._team;
	}

	/** 本会话记录的工作树；空表示没有或本帧没带。 */
	worktrees(): readonly DshIdeWorktreeView[] {
		return this._worktrees;
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
		// 面板已销毁：在途帧回来时不再动状态，也不 fire（监听方都已释放）。
		if (this._disposed) {
			return;
		}
		// 元素来自 Host 进程：数组里可能混进 null / 非对象。先过滤再动状态——
		// 原实现在循环**之前**就 `clear()`，中途抛错会留下一份被清空的清单（数据丢失），
		// 而调用方没有 try/catch，异常还会继续冒泡中断整条帧链。
		const items = Array.isArray(pending)
			? pending.filter((item): item is DshIdePendingItem => typeof item === 'object' && item !== null)
			: [];
		// 先留一份旧的 id → 标题，用于判断这一帧是否真的改变了卡片。
		const beforeItems = new Map<string, string>();
		for (const [eventId, item] of this.pendingItems) {
			beforeItems.set(eventId, JSON.stringify(item));
			if (item.kind === 'question' && !items.some(incoming => incoming.eventId === eventId)) {
				this.rememberSettled(eventId);
			}
		}
		this.pendingItems.clear();
		for (const item of items) {
			// Host 已广播过终态的请求不再画卡：迟到清单或重放帧都不能让它复活。
			if (this.settledPending.has(item.eventId)) {
				continue;
			}
			// `request` 来自 Host：可能是 undefined / 非对象，`in` 运算符对它一律抛错。
			const request: Record<string, unknown> | undefined =
				typeof item.request === 'object' && item.request !== null ? item.request as unknown as Record<string, unknown> : undefined;
			if (request === undefined) {
				continue;
			}
			if (item.event === 'approval/request' && 'toolName' in request) {
				const reason = request.reason;
				const toolName = String(request.toolName);
				this.pendingItems.set(item.eventId, {
					eventId: item.eventId,
					kind: 'approval',
					title: reason === undefined
						? localize('dsh.pending.approvalTitle', "DSH requests to run {0}", toolName)
						: localize('dsh.pending.approvalTitleWithReason', "DSH requests to run {0}: {1}", toolName, String(reason)),
					options: [],
					questions: [],
				});
			} else if (item.event === 'user-questions/request' && 'questions' in request) {
				const questions = Array.isArray(request.questions) ? request.questions : [];
				this.pendingItems.set(item.eventId, projectQuestionPending(item.eventId, questions as Parameters<typeof projectQuestionPending>[1]));
			}
		}
		// 每帧都下发 pending，但内容没变就不必让面板重画。
		// 原先比的是把 key 拼成一个大字符串：每帧都要构造两次全量字符串，
		// 而且只比 id 不比内容——同一 eventId 的标题变了也不会通知。
		// 改成按条目比 id 与标题，既不拼字符串也不会漏掉内容变化。
		if (samePendingItems(this.pendingItems, beforeItems)) {
			return;
		}
		this._onDidChangePending.fire(this.pending());
	}

	running(): boolean {
		return this._running;
	}

	/**
	 * 换会话：清空旧记录、重读目录、重开跟进流。
	 *
	 * @returns 绑定是否成功。通道 rebind 失败时返回 false，调用方必须据此提示用户，
	 *          不能假装绑定成功继续打开视图。
	 */
	async bind(sessionId: string | undefined): Promise<boolean> {		// 有绑定尚未完成时，不能因为 id 已经写上就返回成功：那次 rebind 仍可能失败。
		if (sessionId === this.boundSessionId && !this._boundDirty && this._bindInFlight === undefined) {
			return true;
		}
		this.generation++;
		const generation = this.generation;
		this._bindInFlight = generation;
		const previous = this.boundSessionId;
		this.boundSessionId = sessionId;
		this.model.clear();
		// 换绑时两个集合一起清：`acceptPending` 会重建 `pendingItems`，
		// 但终态 id 属于上一个会话，留着会误压制新会话里同名事件。
		this.pendingItems.clear();
		this.settledPending.clear();
		this._questionSubmissions.clear();
		this._deliverables = [];
		this._attachments = [];
		this._quotaNotice = undefined;
		this._plan = undefined;
		this._goal = undefined;
		this._todos = [];
		this._skills = [];
		this._team = undefined;
		this._worktrees = [];
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
				// 永远不再重绑。模型已经被 clear()，只回滚 id 会让上一会话的面板停在空白。
				// 有上一会话时立刻把它的视图再绑回来；这次恢复也失败才置脏，留给下一次重试。
				const bindDetail = dshErrorText(rebound.error, rebound.error.code);
				this._bindFailure = localize('dsh.bind.rejected', "Could not open this session: {0}", bindDetail);
				this.boundSessionId = previous;
				this._boundDirty = true;
				if (typeof previous === 'string' && previous !== '' && previous !== sessionId) {
					const restored = await this.client.rebindView(previous);
					if (generation !== this.generation) {
						return false;
					}
					if (restored.ok) {
						this._boundDirty = false;
						const restoredView = restored.value?.state?.state === 'ready' ? restored.value.state.view : undefined;
						if (restoredView !== undefined) {
							this.acceptView(restoredView);
						}
						getDshComposerSource()?.setSession(previous);
					}
				}
				return false;
			}
			this._boundDirty = false;
			this._bindFailure = undefined;
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
			// 输入框数据源跟随绑定：不跟着换，切到别的会话后模型/权限/预设仍是旧会话的目录，
			// 未绑定过的窗口更是永远读不到目录（refresh 会因「没有会话」直接返回）。
			const composer = getDshComposerSource();
			composer?.setSession(sessionId);
			await composer?.refresh();
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
		// 用户已经点过别的会话时，开窗回包不能把绑定改回去。
		if (this.generation !== 0 || this.boundSessionId !== undefined || this._bindInFlight !== undefined) {
			return;
		}
		const generation = this.generation;
		this.boundSessionId = sessionId;
		await this.refreshComposer();
		if (generation !== this.generation || this.boundSessionId !== sessionId) {
			return;
		}
		// 与 `bind` 同一口径：输入框目录必须跟着当前会话，否则选择器读不到 DSH 的模型与预设。
		const composer = getDshComposerSource();
		composer?.setSession(sessionId);
		await composer?.refresh();
		await this.refreshSkills();
	}

	/**
	 * 收一帧完整 typed 视图。
	 *
	 * 有 `conversation` 时直接用结构化节点树重建；没有（旧 Host 或非内容帧）才退回裸 `frame`。
	 * `pending` / `deliverables` / `quotaNotice` / `attachments` 同样以 typed 字段为唯一真源。
	 */
	acceptView(view: DshIdeViewSnapshot | undefined): void {
		// 同样来自 Host 进程：`undefined` 是「这帧没有视图」的正常情况，
		// `null` / 非对象则是畸形帧——保持上一状态直接返回，别让取属性抛异常
		// （本方法在事件回调里被直接调用，抛错会中断整条帧处理链）。
		if (typeof view !== 'object' || view === null) {
			return;
		}
		// `conversation` 来自 Host 进程，类型只在编译期成立：运行时可能是任何东西。
		// `acceptConversation` 里直接 `for (const node of conversation.nodes)`，
		// 畸形帧会抛 `is not iterable`——而本方法由事件回调直接调用、没有 try/catch，
		// 异常会中断整条帧处理链。这里先做形状检查，不合格就退回裸 `frame`
		// （与旧 Host 不带 typed 字段时同一条降级路径）。
		if (isConversationView(view.conversation)) {
			this.model.acceptConversation(view.conversation);
		} else {
			this.model.accept(view.frame);
		}
		// 待决议项以 Host 的完整清单为唯一真源：`pending` 现在每帧都在（含空清单），
		// 所以缺省只可能出现在旧 Host 帧上——那种情况保留上一次，不误清。
		if (view.pending !== undefined) {
			this.acceptPending(view.pending);
		}
		// `contextPressure` 三项都是可选的 last-wins 记录；缺省表示这帧没带，保留上一次。
		// 上下文统计每帧都可能变：**变了就要通知**，否则 composer 的 activity/构成行停在首帧。
		// 与其它 extras 分开 fire：它们只喂统计行，不该触发 history 的全量重建。
		if (view.contextPressure !== undefined && !sameContextPressure(this._contextPressure, view.contextPressure)) {
			this._contextPressure = view.contextPressure;
			this._onDidChangeExtras.fire();
		}
		if (view.contextBreakdown !== undefined && !sameContextBreakdown(this._contextBreakdown, view.contextBreakdown)) {
			this._contextBreakdown = view.contextBreakdown;
			this._onDidChangeExtras.fire();
		}
		// extras 每帧都可能带同样的值：内容不变就不通知，避免渲染层每帧全量重建 history。
		const nextDeliverables = view.deliverables ?? [];
		const nextAttachments = view.attachments ?? [];
		const nextQuota = retainQuotaNotice(this._quotaNotice, view.quotaNotice);
		const nextPlan = view.plan !== undefined ? view.plan : this._plan;
		const nextGoal = view.goal !== undefined ? view.goal : this._goal;
		const nextTodos = view.todos !== undefined ? view.todos : this._todos;
		// follow 快照没有 skills 字段（技能走 `listSkills`）。缺省表示「这帧没带」，
		// 不能当成空目录，否则每一次内容帧都会把刚读到的技能清掉。
		const nextSkills = view.skills !== undefined ? view.skills : this._skills;
		const nextTeam = view.team !== undefined ? view.team : this._team;
		const nextWorktrees = view.worktrees !== undefined ? view.worktrees : this._worktrees;
		const extrasChanged = !sameDeliverables(this._deliverables, nextDeliverables)
			|| !sameAttachments(this._attachments, nextAttachments)
			|| !sameQuota(this._quotaNotice, nextQuota)
			|| !samePlan(this._plan, nextPlan)
			|| !sameGoal(this._goal, nextGoal)
			|| !sameTodos(this._todos, nextTodos)
			|| !sameSkills(this._skills, nextSkills)
			|| !sameTeam(this._team, nextTeam)
			|| !sameWorktrees(this._worktrees, nextWorktrees);
		this._deliverables = nextDeliverables;
		this._attachments = nextAttachments;
		this._quotaNotice = nextQuota;
		this._plan = nextPlan;
		this._goal = nextGoal;
		this._todos = nextTodos;
		this._skills = nextSkills;
		this._team = nextTeam;
		this._worktrees = nextWorktrees;
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
		// 面板已销毁：在途帧回来时不再登记卡片，也不再 fire。
		if (this._disposed) {
			return;
		}
		if (notice.kind === 'cancel') {
			// 终态可能在卡片已被提交隐藏之后到达：那时本表已经没有它，
			// 仍要记下这条终态，避免随后任何路径把同一张卡再画回来。
			this.rememberSettled(notice.eventId);
			if (this.pendingItems.delete(notice.eventId)) {
				this._onDidChangePending.fire(this.pending());
			}
			return;
		}
		// 已经收到终态的请求不得因为重放或迟到帧重新出现。
		if (this.settledPending.has(notice.eventId)) {
			return;
		}
		if (notice.event === 'approval/request' && 'toolName' in notice.request) {
			const reason = notice.request.reason;
			const title = reason === undefined
				? localize('dsh.pending.approvalTitle', "DSH requests to run {0}", notice.request.toolName)
				: localize('dsh.pending.approvalTitleWithReason', "DSH requests to run {0}: {1}", notice.request.toolName, reason);
			// 同一张卡片重复到达（重放、迟到帧）且标题没变时不重画。
			const existing = this.pendingItems.get(notice.eventId);
			if (existing !== undefined && existing.kind === 'approval' && existing.title === title) {
				return;
			}
			this.pendingItems.set(notice.eventId, {
				eventId: notice.eventId,
				kind: 'approval',
				title,
				options: [],
				questions: [],
			});
		} else if (notice.event === 'user-questions/request' && 'questions' in notice.request) {
			const next = projectQuestionPending(notice.eventId, notice.request.questions);
			const existing = this.pendingItems.get(notice.eventId);
			if (existing !== undefined && JSON.stringify(existing) === JSON.stringify(next)) {
				return;
			}
			this.pendingItems.set(notice.eventId, next);
		}
		this._onDidChangePending.fire(this.pending());
	}

	inboxNextTurn(): readonly DshIdeInboxMessage[] {
		return this.model.inboxNextTurn();
	}

	inboxNextStep(): readonly DshIdeInboxMessage[] {
		return this.model.inboxNextStep();
	}

	presentationSettingsCache(): DshIdePresentationSettings | undefined {
		return this._presentationSettings;
	}

	async presentationSettings(): Promise<DshIdePresentationSettings | undefined> {
		const result = await this.client.call<DshIdePresentationSettings>('presentationSettings', {});
		if (!result.ok) {
			// 偏好读不到不是错误：退回 store 的默认（standard）。不要用一条 toast
			// 打断用户——这不是他们发起的操作。
			return undefined;
		}
		this._presentationSettings = result.value;
		return result.value;
	}

	hasMore(): boolean {
		return this.model.hasMore();
	}

	firstSeq(): number | undefined {
		return this.model.firstSeq();
	}

	/** 下一次翻页的游标（durable 边界，不受实时窗口滑动影响）。 */
	pagingCursor(): number | undefined {
		return this.model.pagingCursor();
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
		// 游标用 durable 边界，不用可见窗口的最小 seq：旧页被实时帧挤出画面后，
		// 从可见窗口取会漏掉中间那段记录。
		const beforeSeq = this.model.pagingCursor();
		if (beforeSeq === undefined) {
			return false;
		}
		const generation = this.generation;
		const sessionId = this.boundSessionId;
		this.model.setHistoryStatus('loading');
		try {
			const result = await this.client.call<DshIdeLoadOlderResult>('loadOlder', {
				sessionId,
				beforeSeq,
				maxMessages: DSH_IDE_HISTORY_MAX_MESSAGES,
				turnWindow: DSH_IDE_HISTORY_TURN_WINDOW,
			});
			if (generation !== this.generation) {
				return false;
			}
			if (!result.ok) {
				this.model.setHistoryStatus('error');
				const detail = dshErrorText(result.error, result.error.code);
				this.fail(localize('dsh.history.loadFailed', "Earlier history did not load: {0}", detail));
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
		} catch (error) {
			if (generation === this.generation) {
				this.model.setHistoryStatus('error');
				const detail = error instanceof Error && error.message !== '' ? error.message : localize('dsh.history.loadFailedUnknown', "Read failed");
				this.fail(localize('dsh.history.loadFailed', "Earlier history did not load: {0}", detail));
			}
			return false;
		}
	}

	/**
	 * 发送一句话（可带已入库的图片）。
	 *
	 * 成功后交给内核，不做乐观插入。附件只接受已入库的 `ImageAttachmentRef`：
	 * 契约里 `submit.attachments` 就是这个形状，未入库的图片没有可提交的身份。
	 */
	/**
	 * 把一张尚未入库的图片交给 Host 入库，返回可提交的引用。
	 *
	 * 剪贴板/拖入的图片只有字节，没有 attachmentId；Host 用官方 saveImages
	 * 完成入库后返回值就是 `submit.attachments` 需要的形状。失败返回 undefined，
	 * 由调用方保留草稿并明确告知，不伪造引用。
	 */
	private _imageFailure: string | undefined;

	imageFailure(): string | undefined {
		return this._imageFailure;
	}

	async saveImage(data: Uint8Array, mediaType: string, name?: string): Promise<DshIdeImageAttachmentRef | undefined> {
		if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp' && mediaType !== 'image/gif') {
			this._imageFailure = localize('dsh.image.unsupported', "This image format cannot be stored.");
			return undefined;
		}
		// 契约对 `saveImageAttachment.data` 没有长度上限，Host 也只校验非空。
		// 不在这里挡一道的话，超大图会先整份 base64 编码、再跨进程传输、最后才被内核拒绝——
		// 中间三步都在吃内存。上限按常见聊天客户端的 20 MiB 取，足够放下相机原图。
		if (data.byteLength > DshChatSession.MAX_IMAGE_BYTES) {
			// 审计器会把「实参里的括号运算」误算成嵌套调用，先算好再传。
			const actualMb = (data.byteLength / (1024 * 1024)).toFixed(1);
			const limitMb = DshChatSession.MAX_IMAGE_BYTES / (1024 * 1024);
			this._imageFailure = localize('dsh.image.tooLarge', "The image is too large ({0} MB); the limit is {1} MB.", actualMb, limitMb);
			return undefined;
		}
		const result = await this.client.call<DshIdeImageAttachmentRef>('saveImageAttachment', {
			mediaType,
			data: encodeBase64(VSBuffer.wrap(data)),
			...(name === undefined || name === '' ? {} : { name }),
		});
		if (!result.ok) {
			const detail = dshErrorText(result.error, result.error.code);
			this._imageFailure = localize('dsh.image.rejected', "Image ingestion failed: {0}", detail);
			return undefined;
		}
		this._imageFailure = undefined;
		return result.value;
	}

	private fail(message: string): void {
		this._onDidFailAction.fire(message);
	}

	private _submitFailure: string | undefined;

	submitFailure(): string | undefined {
		return this._submitFailure;
	}

	/** 最近一次绑定失败的可读原因；成功绑定后清空。 */
	bindFailure(): string | undefined {
		return this._bindFailure;
	}

	/**
	 * 提交一条消息。
	 *
	 * `requestId` 由调用方生成并在核对/重试时保持同一个值：Host 把它当作内核请求 id。
	 * 不带时由这里补一个，保证每条提交都有稳定的关联标识。
	 */
	async submit(text: string, attachments?: readonly DshIdeImageAttachmentRef[], requestId?: string): Promise<boolean> {
		const generation = this.generation;
		const sessionId = this.boundSessionId;
		if (sessionId === undefined) {
			this._submitFailure = localize('dsh.submit.noSession', "No DSH session is bound, so the message was not sent.");
			return false;
		}
		this.setRunning(true);
		// 纯图片消息的 `text` 是空串，而契约对 `submit.text` 用 `nonEmptyString`。
		// 直接把空串发过去会被校验拒绝，用户看到「发送失败：…」却不知道原因。
		// 这里补一个最小的占位文本，让图片能单独发出去（与桌面端行为一致）。
		const hasAttachments = attachments !== undefined && attachments.length > 0;
		const body = text.trim() === '' && hasAttachments ? DshChatSession.IMAGE_ONLY_TEXT : text;
		const id = requestId !== undefined && requestId !== '' ? requestId : nextDshSubmitId();
		const args = {
			text: body,
			sessionId,
			requestId: id,
			...(hasAttachments ? { attachments } : {}),
		};
		const result = await this.client.call('submit', args);
		// 等待期间换了会话：失败不能把新会话的 running 清掉，成功也不该让调用方以为这条发送还属于当前会话。
		if (generation !== this.generation || sessionId !== this.boundSessionId) {
			this._submitFailure = localize('dsh.submit.switched', "The session changed while sending, so this message was not sent.");
			return false;
		}
		if (!result.ok) {
			this.setRunning(false);
			const detail = dshErrorText(result.error, result.error.code);
			this._submitFailure = localize('dsh.submit.rejected', "Send failed: {0}", detail);
			return false;
		}
		this._submitFailure = undefined;
		return true;
	}

	async cancel(): Promise<boolean> {
		const generation = this.generation;
		const sessionId = this.boundSessionId;
		if (sessionId === undefined) {
			this.fail(localize('dsh.cancel.noSession', "No DSH session is bound, so there is nothing to stop."));
			return false;
		}
		// 带上点击时的会话。Host 若已换绑，会拒绝，从而不停新会话。
		const result = await this.client.call('interrupt', { sessionId });
		if (generation !== this.generation || sessionId !== this.boundSessionId) {
			return false;
		}
		if (!result.ok) {
			const detail = dshErrorText(result.error, result.error.code);
			this.fail(localize('dsh.cancel.rejected', "Stop failed: {0}", detail));
			return false;
		}
		return true;
	}

	async updateQueue(itemId: string, action: DshIdeQueueAction): Promise<boolean> {
		const sessionId = this.boundSessionId;
		if (sessionId === undefined) {
			this.fail(localize('dsh.queue.noSession', "No DSH session is bound, so the queue was not changed."));
			return false;
		}
		const result = await this.client.call('updateQueue', { sessionId, itemId, action });
		if (!result.ok) {
			// 官方码原样带出：`queue-item-not-found`（已经不在队列）与
			// `steer-unavailable`（当前不能转向）对用户的处置完全不同。
			this.fail(localize('dsh.queue.rejected', "Could not change the queued message: {0}", dshErrorText(result.error, result.error.code)));
			return false;
		}
		// 队列本身由 Host 的 `inbox` 投影下一帧带来；这里不本地改列表，避免与真源分叉。
		return true;
	}

	async selectModel(provider: string, model: string): Promise<void> {
		const generation = this.generation;
		const sessionId = this.boundSessionId;
		if (sessionId === undefined) {
			this.fail(localize('dsh.model.noSession', "No DSH session is bound, so the model was not changed."));
			return;
		}
		const result = await this.client.call('setModel', { sessionId, model: `${provider}/${model}` });
		if (generation !== this.generation || sessionId !== this.boundSessionId) {
			return;
		}
		if (!result.ok) {
			const detail = dshErrorText(result.error, result.error.code);
			this.fail(localize('dsh.model.rejected', "Could not change the model: {0}", detail));
			await this.refreshComposer();
			return;
		}
		// 写回成功。选的本来就是当前模型时不必重建菜单。
		if (sameCurrentModel(this._current, { provider, model })) {
			return;
		}
		this._current = { provider, model };
		this._onDidChangeModelMenu.fire();
	}

	/**
	 * 切换推理档（DSH 的 `setEffort`）。
	 *
	 * 原生选择器把推理强度画成模型配置项；配置项改动只有写回内核才真的生效，
	 * 否则界面显示 high、实际仍用旧档。
	 * @param effort DSH 推理档 id
	 */
	async selectEffort(effort: string): Promise<void> {
		const generation = this.generation;
		const sessionId = this.boundSessionId;
		if (sessionId === undefined) {
			this.fail(localize('dsh.effort.noSession', "No DSH session is bound, so the reasoning level was not changed."));
			return;
		}
		const result = await this.client.call('setEffort', { sessionId, effort });
		if (generation !== this.generation || sessionId !== this.boundSessionId) {
			return;
		}
		if (!result.ok) {
			const detail = dshErrorText(result.error, result.error.code);
			this.fail(localize('dsh.effort.rejected', "Could not change the reasoning level: {0}", detail));
			return;
		}
		// 档位是模型目录的一部分：重读一次，让界面与内核一致（不回写假值）。
		await this.refreshComposer();
	}

	async answerApproval(eventId: string, decision: 'approve' | 'reject', reason?: string): Promise<void> {
		const generation = this.generation;
		const sessionId = this.boundSessionId;
		const item = this.pendingItems.get(eventId);
		// 卡片已经不属于当前会话（换绑时 pendingItems 会清空）：不能把这次批准发给新会话。
		// Host 按 requestId 结算，这里放过去会让另一个会话的请求被误批。
		if (item === undefined) {
			this.fail(localize('dsh.answer.stale', "This card no longer belongs to the current session, so no answer was sent."));
			return;
		}
		const settled = settleApproval(decision, reason);
		if (settled === undefined) {
			return;
		}
		this.hidePending(eventId);
		const result = await this.client.call('answerApproval', {
			requestId: eventId,
			decision: settled.decision,
			...(settled.reason === undefined ? {} : { reason: settled.reason }),
		});
		this.restorePending(generation, sessionId, eventId, item, result);
	}

	/**
	 * 提交问卷答案。
	 *
	 * 原生面板一次只显示一题，所以 `label` 是用户点的那一项；其余题目从卡片里已投影的
	 * 完整问卷取。若这份问卷无法完整承接（多题、多选、无选项），不提交半份答案冒充全部：
	 * 明确拒绝，把决定交还桌面入口（DEC-005 的能力边界）。
	 */
	async answerQuestion(eventId: string, label: string): Promise<void> {
		this.lastQuestionFallback = undefined;
		const item = this.pendingItems.get(eventId);
		if (item === undefined) {
			this.fail(localize('dsh.answer.staleQuestion', "This question no longer belongs to the current session, so no answer was sent."));
			return;
		}
		const answers = dshQuestionAnswers(item, label);
		if (answers === undefined) {
			this.lastQuestionFallback = eventId;
			return;
		}
		await this.submitQuestionDraft(eventId, answers);
	}

	/**
	 * 结束一次计划审阅并回到输入框（官方 plan-review 的 discuss 动作）。
	 *
	 * 官方 discuss 由请求方结束审阅、把决定交回输入框；线协议里对应的唯一动作是
	 * `cancelRequest`。它同样是 Host 结算，不是本地隐藏卡片。
	 */
	async discussQuestion(eventId: string): Promise<boolean> {
		const item = this.pendingItems.get(eventId);
		if (this._disposed || item === undefined) {
			this.fail(localize('dsh.answer.staleQuestion', "This question no longer belongs to the current session, so no answer was sent."));
			return false;
		}
		if (this._questionSubmissions.has(eventId)) {
			return false;
		}
		const token = {};
		this._questionSubmissions.set(eventId, token);
		try {
			const result = await this.client.call('cancelRequest', { requestId: eventId });
			if (this._disposed) {
				return false;
			}
			if (result.ok) {
				this.rememberSettled(eventId);
				this.hidePending(eventId);
				return true;
			}
			this.fail(localize('dsh.discuss.rejected', "Could not end the plan review: {0}", dshErrorText(result.error, result.error.code)));
			return false;
		} catch {
			if (!this._disposed) {
				this.fail(localize('dsh.discuss.unconfirmed', "Could not confirm that the plan review ended. The card is kept."));
			}
			return false;
		} finally {
			if (this._questionSubmissions.get(eventId) === token) {
				this._questionSubmissions.delete(eventId);
			}
		}
	}

	/** 整份提交。提交期间保留卡片并互斥；成功或 Host 终态后才移除。 */
	async submitQuestionDraft(eventId: string, draft: readonly DshQuestionDraft[]): Promise<boolean> {
		const generation = this.generation;
		const sessionId = this.boundSessionId;
		const item = this.pendingItems.get(eventId);
		if (this._disposed || item?.kind !== 'question' || this._questionSubmissions.has(eventId) || this.settledPending.has(eventId)) {
			return false;
		}
		const answer = settleQuestion(item.questions, draft);
		if (answer === undefined) {
			this.fail(localize('dsh.question.invalid', 'Review every question before submitting. An answer contains an invalid or missing choice.'));
			return false;
		}
		const token = {};
		this._questionSubmissions.set(eventId, token);
		try {
			const result = await this.client.call('answerQuestion', { requestId: eventId, answer });
			if (this._disposed || generation !== this.generation || sessionId !== this.boundSessionId) {
				return false;
			}
			if (result.ok) {
				this.rememberSettled(eventId);
				this.hidePending(eventId);
				return true;
			}
			if (!isRetryableAnswerFailure(result.error.code)) {
				this.rememberSettled(eventId);
				this.hidePending(eventId);
			}
			this.fail(localize('dsh.answer.rejected', 'The answer was not delivered: {0}', dshErrorText(result.error, result.error.code)));
			return false;
		} catch {
			if (!this._disposed && generation === this.generation && sessionId === this.boundSessionId) {
				this.fail(localize('dsh.question.unconfirmed', 'Could not confirm delivery of the answers. The draft is kept.'));
			}
			return false;
		} finally {
			if (this._questionSubmissions.get(eventId) === token) {
				this._questionSubmissions.delete(eventId);
			}
		}
	}

	/**
	 * 这份问卷是否只能由桌面入口回答（原生面板承接不了它的形状）。
	 * 命令入口据此给出明确提示，而不是假装已经提交。
	 */
	questionNeedsDesktop(eventId: string): boolean {
		const item = this.pendingItems.get(eventId);
		return item !== undefined && item.kind === 'question' && item.questions.length > 0
			&& dshQuestionAnswers(item, item.options[0] ?? '') === undefined;
	}

	/** 先拿掉卡片，避免同一次批准被点两次。 */
	private hidePending(eventId: string): void {
		if (!this.pendingItems.delete(eventId)) {
			return;
		}
		this._onDidChangePending.fire(this.pending());
	}

	/** 已收到终态的请求 id：防止迟到的请求帧把已结束的卡片重新画回来。 */
	/**
	 * 已收到终态的请求 id。只增不减会让长会话一直攒着旧 id，
	 * 所以设上限：超了就丢最早的一半——迟到的重放帧早已不在 Host 的待决议表里，
	 * 丢掉旧 id 不会让已结束的卡片重新出现。
	 */
	private readonly settledPending = new Set<string>();
	private static readonly SETTLED_PENDING_LIMIT = 256;
	/**
	 * 单张图片入库上限。
	 *
	 * 契约对 `saveImageAttachment.data` 不设长度上限，Host 也只校验非空。不在这里挡一道，
	 * 超大图会先整份 base64 编码、再跨进程传输、最后才被内核拒绝——中间三步都在吃内存。
	 * 20 MiB 足够放下相机原图。
	 */
	private static readonly MAX_IMAGE_BYTES = 20 * 1024 * 1024;
	/**
	 * 纯图片消息的占位正文。
	 *
	 * 契约对 submit.text 用 nonEmptyString：只发图片时正文是空串，会被直接拒绝。
	 * 补一句最小说明，图片才能单独发出去。
	 */
	private static readonly IMAGE_ONLY_TEXT = localize('dsh.submit.imageOnly', "(image)");

	private rememberSettled(eventId: string): void {
		this.settledPending.add(eventId);
		if (this.settledPending.size <= DshChatSession.SETTLED_PENDING_LIMIT) {
			return;
		}
		// Set 保持插入顺序：删掉最早的一半，保留最近的那批。
		const drop = Math.ceil(this.settledPending.size / 2);
		let removed = 0;
		for (const id of this.settledPending) {
			this.settledPending.delete(id);
			if (++removed >= drop) {
				break;
			}
		}
	}

	/** 最近一次因形状不支持而交还桌面的问卷（命令入口据此提示）。 */
	private lastQuestionFallback: string | undefined;

	/** 这条问卷是否刚被交还桌面：命令入口据此给出明确提示，而不是静默什么都不做。 */
	questionFellBackToDesktop(eventId: string): boolean {
		return this.lastQuestionFallback === eventId;
	}

	/**
	 * 告知用户这份问卷需要桌面入口。
	 *
	 * 用通知而不是静默返回：原生卡片只显示一题，用户点了却什么都没发生会被读成故障。
	 * @param {string} eventId
	 */
	notifyQuestionNeedsDesktop(eventId: string): void {
		this._onDidNeedDesktopQuestion.fire(eventId);
	}

	/**
	 * 通道拒绝时把卡片放回去。
	 *
	 * 只有「请求仍在等待、且失败可能是瞬时的」才恢复：已经结算（`ALREADY_RESOLVED`）、
	 * 目标不属于本视图（`SESSION_SWITCHED`）或请求种类不符（`INVALID_ARGUMENT`）都是终态，
	 * 恢复卡片只会让用户对着一条已经结束的请求反复点击。
	 */
	private restorePending(
		generation: number,
		sessionId: string | undefined,
		eventId: string,
		item: DshChatPending | undefined,
		result: { readonly ok: boolean; readonly error?: { readonly code: string; readonly message?: string } },
	): void {
		if (result.ok || item === undefined) {
			return;
		}
		if (generation !== this.generation || sessionId !== this.boundSessionId || this.pendingItems.has(eventId)) {
			return;
		}
		const detail = dshErrorText(result.error, localize('dsh.answer.rejectedUnknown', "Unknown reason"));
		this.fail(localize('dsh.answer.rejected', "The answer was not delivered: {0}", detail));
		// 已经收到终态（桌面先答 / 取消）的请求不能再恢复：那已经不是「仍待决」的卡片。
		if (this.settledPending.has(eventId)) {
			return;
		}
		if (!isRetryableAnswerFailure(result.error?.code)) {
			return;
		}
		this.pendingItems.set(eventId, item);
		this._onDidChangePending.fire(this.pending());
	}

	/**
	 * 技能目录不单独向 Host 要。未绑定时清空；已绑定则保持空列表。
	 */
	private async refreshSkills(): Promise<void> {
		const generation = this.generation;
		const sessionId = this.boundSessionId;
		if (sessionId === undefined) {
			// 未绑定：清空目录。本来就空时不必通知——`bind` 会连清多个字段，
			// 每次都 fire 会让渲染层白重建 history。
			if (this._skills.length === 0) {
				return;
			}
			this._skills = [];
			this._onDidChangeExtras.fire();
			return;
		}
		// `bind` 与 `attach` 都可能触发，同一会话的并发读取没有意义：复用同一次在途请求。
		// 不同会话各自发一次——它们的目录本来就不一样。
		const pending = this._skillsInFlight;
		if (pending !== undefined && pending.sessionId === sessionId) {
			return pending.work;
		}
		const work = this.loadSkills(generation, sessionId).finally(() => {
			if (this._skillsInFlight?.sessionId === sessionId) {
				this._skillsInFlight = undefined;
			}
		});
		this._skillsInFlight = { sessionId, work };
		return work;
	}

	private async loadSkills(generation: number, sessionId: string): Promise<void> {
		// 技能目录不在聊天主路径上，不再单独拉一份。
		void generation;
		void sessionId;
	}

	/** 重读输入框目录：模型列表与当前选择（形状由 `projectDshIdeComposer` 决定）。 */
	async refreshComposer(): Promise<void> {
		const generation = this.generation;
		const sessionId = this.boundSessionId;
		if (sessionId === undefined) {
			// 还没有绑定会话：不猜「当前会话」，保持已有目录。
			return;
		}
		// 换绑、写回被拒、开窗都会触发它；同一会话的并发读取没有意义，复用同一次在途请求。
		const pending = this._composerInFlight;
		if (pending !== undefined && pending.sessionId === sessionId) {
			return pending.work;
		}
		const work = this.loadComposer(generation, sessionId).finally(() => {
			if (this._composerInFlight?.sessionId === sessionId) {
				this._composerInFlight = undefined;
			}
		});
		this._composerInFlight = { sessionId, work };
		return work;
	}

	private async loadComposer(generation: number, sessionId: string): Promise<void> {
		const result = await this.client.call<{
			readonly model?: {
				readonly current?: { readonly provider?: string; readonly model?: string; readonly effort?: string } | null;
				readonly groups?: readonly { readonly id?: string; readonly models?: readonly ComposerModelCatalog[] }[];
			};
		}>('composerState', { sessionId });
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
		const provider = result.value.model?.current?.provider;
		const model = result.value.model?.current?.model;
		const nextCurrent = typeof provider === 'string' && provider !== '' && typeof model === 'string' && model !== ''
			? { provider, model }
			: undefined;
		// 目录没变就不通知：菜单每收到一次都要重建，重复通知是纯开销。
		if (sameModelOptions(this._models, options) && sameCurrentModel(this._current, nextCurrent)) {
			return;
		}
		this._models = options;
		this._current = nextCurrent;
		this._onDidChangeModelMenu.fire();
	}

	override dispose(): void {
		this._disposed = true;
		this.generation++;
		// 面板已经销毁：在途的 follow 帧回来时不能再往这两个表里写。
		// 清空后 `acceptPending` / `acceptWaterfall` 会因 `_disposed` 直接返回。
		this.pendingItems.clear();
		this.settledPending.clear();
		this._questionSubmissions.clear();
		super.dispose();
	}
}

/** 生成一次提交的关联标识：Host 把它当作内核请求 id，重试/核对时复用同一个值。 */
function nextDshSubmitId(): string {
	try {
		return globalThis.crypto.randomUUID();
	} catch {
		// 旧运行时没有 randomUUID 时退回时间戳+随机数；只要求进程内唯一，不用于安全用途。
		return `dsh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
/**
 * 把官方问卷投影成一张待决议卡片。
 *
 * 标题与选项只用于原生面板的摘要（原生只能显示一题），但 `questions` 保留**全部**题目：
 * 提交时按整份问卷作答，不做「只答第一题」的静默缩写。
 * @param {string} eventId
 */
function isSettlementIntent(value: unknown): value is DshSettlementIntent {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const record = value as { kind?: unknown; approve?: unknown; reject?: unknown };
	if (record.kind === 'plan-review') {
		return typeof record.approve === 'string' && record.approve !== '';
	}
	return record.kind === 'approval' && typeof record.approve === 'string' && typeof record.reject === 'string';
}

function projectQuestionPending(
	eventId: string,
	questions: readonly {
		readonly id: string;
		readonly question?: string;
		readonly detail?: string;
		readonly header?: string;
		readonly options?: readonly { readonly label: string; readonly description?: string }[];
		readonly multiSelect?: boolean;
		readonly intent?: DshSettlementIntent;
	}[],
): DshChatPending {
	// `questions` 同样来自 Host：不是数组就当作没有问题（面板显示「无题」而不是崩掉）。
	const list = Array.isArray(questions) ? questions : [];
	const projected: readonly DshChatQuestion[] = list
		.filter((question): question is typeof questions[number] => typeof question === 'object' && question !== null)
		.map(question => ({
		id: question.id,
		...(question.question === undefined ? {} : { question: question.question }),
		...(question.detail === undefined ? {} : { detail: question.detail }),
		...(question.header === undefined ? {} : { header: question.header }),
		options: (question.options ?? []).map(option => ({
			label: option.label,
			...(option.description === undefined ? {} : { description: option.description }),
		})),
		multiSelect: question.multiSelect === true,
		...(!isSettlementIntent(question.intent) ? {} : { intent: question.intent }),
	}));
	const first = projected[0];
	return {
		eventId,
		kind: 'question',
		title: first?.question ?? localize('dsh.pending.questionTitle', "DSH question"),
		options: (first?.options ?? []).map(option => option.label),
		questionId: first?.id ?? '',
		questions: projected,
	};
}

/**
 * 把一次点击展开成官方 `answers` 数组。
 *
 * 只有「单题、单选、有选项」才能由原生面板完整承接：那时用户点的就是该题唯一的答案。
 * 其余形状（多题、多选、无选项）返回 undefined，调用方必须交还桌面入口，
 * 不允许提交一份看起来成功、实际缺项的回答。
 * @param {DshChatPending} item
 * @param {string} label
 * @returns {readonly { readonly id: string; readonly selected: readonly string[] }[] | undefined}
 */
function dshQuestionAnswers(item: DshChatPending, label: string): readonly { readonly id: string; readonly selected: readonly string[] }[] | undefined {
	if (item.kind !== 'question' || item.questions.length !== 1) {
		return undefined;
	}
	const question = item.questions[0];
	if (question === undefined || question.multiSelect || question.options.length === 0) {
		return undefined;
	}
	if (!question.options.some(option => option.label === label)) {
		return undefined;
	}
	return [{ id: question.id, selected: [label] }];
}

/**
 * 这条失败是否可能仍待决、值得把卡片放回去。
 *
 * 结算类与身份类错误是终态：请求已经结束，或本次调用不代表本视图。
 * 传输/通道类错误才可能是瞬时失败，用户可以重试同一次决议。
 * @param {string | undefined} code
 */
function isRetryableAnswerFailure(code: string | undefined): boolean {
	// 只认「确认仍可重试」的两类：通道尚未接好（请求没送达）与传输层瞬时失败。
	// 其余一律按终态处理——包括未知错误码：没被证明仍待决的失败，不该把卡片放回去。
	if (code === undefined) {
		return false;
	}
	return code === DSH_IDE_FEATURE_UNAVAILABLE || code.startsWith('dsh-ide/transport');
}

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
/** 任务板比较：启用位、失败原因与逐项 (id, revision, status, ready) 相同即视为未变。 */
/** 工作树比较：逐项比路径与分支，顺序也参与判定。 */
function sameWorktrees(left: readonly DshIdeWorktreeView[], right: readonly DshIdeWorktreeView[]): boolean {
	if (left === right) {
		return true;
	}
	if (left.length !== right.length) {
		return false;
	}
	return left.every((worktree, index) => {
		const other = right[index];
		return other !== undefined && worktree.path === other.path && worktree.branch === other.branch && worktree.created === other.created;
	});
}

function sameTeam(left: DshIdeTeamView | undefined, right: DshIdeTeamView | undefined): boolean {
	if (left === right) {
		return true;
	}
	if (left === undefined || right === undefined) {
		return false;
	}
	if (left.enabled !== right.enabled || left.failure !== right.failure || left.tasks.length !== right.tasks.length) {
		return false;
	}
	return left.tasks.every((task, index) => {
		const other = right.tasks[index];
		return other !== undefined && task.id === other.id && task.revision === other.revision
			&& task.status === other.status && task.ready === other.ready && task.ownerName === other.ownerName
			&& task.subject === other.subject;
	});
}

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
/** 模型目录是否与上一次相同（菜单据此决定要不要重建）。 */
function sameModelOptions(left: readonly DshChatModelOption[], right: readonly DshChatModelOption[]): boolean {
	if (left === right) {
		return true;
	}
	if (left.length !== right.length) {
		return false;
	}
	for (let i = 0; i < left.length; i++) {
		if (left[i].provider !== right[i].provider || left[i].model !== right[i].model || left[i].name !== right[i].name) {
			return false;
		}
	}
	return true;
}

/** 当前选中的模型是否与上一次相同。 */
function sameCurrentModel(
	left: { readonly provider: string; readonly model: string } | undefined,
	right: { readonly provider: string; readonly model: string } | undefined,
): boolean {
	if (left === right) {
		return true;
	}
	return left !== undefined && right !== undefined && left.provider === right.provider && left.model === right.model;
}

/**
 * 两张待决议清单是否等价：条数、id 顺序与标题都要一致。
 *
 * 标题也算：同一个 eventId 的审批原因可能随帧更新，只比 id 会让面板停在旧文案。
 */
function samePendingItems(
	next: ReadonlyMap<string, { readonly title: string }>,
	before: ReadonlyMap<string, string>,
): boolean {
	if (next.size !== before.size) {
		return false;
	}
	for (const [eventId, fingerprint] of before) {
		const item = next.get(eventId);
		if (item === undefined || JSON.stringify(item) !== fingerprint) {
			return false;
		}
	}
	return true;
}

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

/**
 * `conversation` 的运行时形状判定。
 *
 * 只要求 `nodes` 是数组：单个节点是否合法由 `fromConversationNode` 自己兜底
 * （它对未知 kind 返回 undefined 并跳过），这里不重复那套逻辑。
 * @param value Host 帧里的 `conversation` 字段
 */
function isConversationView(value: unknown): value is DshIdeConversationView {
	return typeof value === 'object'
		&& value !== null
		&& Array.isArray((value as { nodes?: unknown }).nodes);
}

/** 官方 `contextPressure` 三项都是可选 last-wins 记录：逐项比；左值缺省视为「已变」。 */
function sameContextPressure(left: DshIdeContextPressure | undefined, right: DshIdeContextPressure): boolean {
	if (left === undefined) {
		return false;
	}
	return left.pressureTokens === right.pressureTokens
		&& left.projectedTokens === right.projectedTokens
		&& left.contextWindow === right.contextWindow;
}

/** 官方 `contextBreakdown` 三项全必填：逐项比；左值缺省视为「已变」。 */
function sameContextBreakdown(left: DshIdeContextBreakdown | undefined, right: DshIdeContextBreakdown): boolean {
	if (left === undefined) {
		return false;
	}
	return left.systemTokens === right.systemTokens
		&& left.toolsTokens === right.toolsTokens
		&& left.messageTokens === right.messageTokens;
}
