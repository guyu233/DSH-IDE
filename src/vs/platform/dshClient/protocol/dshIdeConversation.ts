/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 把 `sessionController.follow` 的内容帧投影成协议里的结构化会话。
//
// 投影规则依据 DSH 官方 `ui-chat/src/client/conversation-nodes/**` 的节点装配：
// 只产出 `DshIdeConversationNode` 白名单内的节点；官方内部事件（turn/start、attempt、
// boundary 等）保留为原始帧，不凭空产出可见行。字段缺失一律省略，不写显式 undefined。
//
// 子代理事实分两条通道，都不引入私有节点 kind：
//   - `subagent/catalog` 是**投影键**（官方 `SessionProjectionMap['subagentCatalog']`），
//     走 `DshIdeConversationView.subagentCatalog`，不进入节点树。
//   - `user/message` 的 `source.kind` 为 `subagent-settled` / `agent-message` 时，
//     官方 `message.ts` 只在「被 inbox 认领为唤醒」或「`retry` 且 content 为空」时
//     才画成 `turn-trigger`；其余情况按普通消息归类。

import type {
	DshIdeAssistantBlock,
	DshIdeContentBlock,
	DshIdeConversationNode,
	DshIdeConversationView,
	DshIdeDeliverableView,
	DshIdeImageAttachmentRef,
	DshIdeSubagentCatalogEntry,
	DshIdeTokenUsageDelta,
} from './dshIdeProtocol.js';

/** 投影器持有的会话状态：换会话时由调用方整体重置。 */
export interface DshIdeConversationState {
	/** 按节点身份保存，最终按 seq 升序输出。 */
	readonly nodes: Map<string, DshIdeConversationNode>;
	/** 进行中的流式 attempt；durable 消息到达后清理。 */
	readonly attempts: Map<string, DshIdeStreamAttempt>;
	/** 已结算的 attempt：防止重放同一流。 */
	readonly settledAttempts: Set<string>;
	/**
	 * 已经 end、但还没被同回合 `assistant/message` 接管的临时节点。
	 * end 会先把 attempt 移出 `attempts`，正式消息若只扫进行中的 attempt，就清不掉这个节点。
	 */
	readonly endedStreamNodes: Map<number, Set<string>>;
	/** 官方分页是否还有更早记录。 */
	hasMore: boolean;
	/** 官方 `deliverables/presented` 的累计结果，按事件顺序。 */
	readonly deliverables: Map<number, DshIdeDeliverableView>;
	/** 最近一次额度失败（官方 `turn/end.reason.error.code` 为 QUOTA/ACCOUNT_QUOTA）。 */
	quotaNotice?: { readonly code: 'QUOTA' | 'ACCOUNT_QUOTA'; readonly seq: number };
	/**
	 * 官方 `subagentCatalog` 投影：父会话拥有的子代理成员事实。
	 * 它不是 chat 节点，单独存放，按 seq 输出。
	 */
	readonly subagentCatalog: Map<number, DshIdeSubagentCatalogEntry>;
	/**
	 * 官方 `inbox-next-step`（`conversation-nodes/inbox.ts` 的 `nextStepInboxDefinition`）。
	 * `currentClaimed` 里的人类消息是 `steering`，不是新的 `user`。
	 */
	inboxNextStep: DshIdeInboxClaim;
	/** 上一个 `inherited-history` 分界行的 key：官方只保留最新一个标记处的分界。 */
	lastInheritedHistoryKey?: string;
	/**
	 * 官方 `inbox-next-turn`。被它认领的非人类消息是 `waking`，投影成 `turn-trigger`。
	 */
	inboxNextTurn: DshIdeInboxClaim;
	/** 官方 `tool-workflow/*` 折叠出的运行状态，按 runId 索引。 */
	readonly workflows: Map<string, DshIdeWorkflowState>;
	/** 最近一次系统提示文本：判断后续 `system/message` 是更新还是首份。 */
	lastSystemPrompt?: string;
	/** 按 turn 收集 Turn 尾部事实（官方 `turnTailDefinition` 的 Turn 级数据）。 */
	readonly turnTails: Map<number, DshIdeTurnTailState>;
}

/** 一个 turn 的尾部事实：收尾答复、最后一条转写位置、是否分支不可用。 */
interface DshIdeTurnTailState {
	lastAssistantSeq?: number;
	lastAssistantText?: string;
	/** 收尾答复那条 durable 消息的 messageId（官方 `closing.finalNode.messageId`）。 */
	lastAssistantMessageId?: string;
	/** 过程组锚点与计数（官方 `turn-process` 的输入）。 */
	controlAnchorSeq?: number;
	processStartSeq?: number;
	answerAnchorSeq?: number;
	answerStep: number;
	/** 最终答复**之前**的带答复助手消息数（官方 `messageCount` 口径）。 */
	messageCount: number;
	/** 本 Turn 的助手消息总数；`messageCount` 由它减去最终答复得出。 */
	assistantCount: number;
	/** 上一次计入用量的 `(step, 样本)`：同一 step 的新样本要替换它，不是叠加（官方 `addReplacing`）。 */
	lastUsageStep?: number;
	lastUsageSample?: { input: number; output: number; cacheRead?: number; cacheWrite?: number; reasoning?: number };
	toolCallCount: number;
	subagentCount: number;
	/** 该 Turn 的聚合用量（官方 `deriveTurnTokenUsage` 的等价累计）。 */
	/**
	 * 该 Turn 的聚合用量。
	 *
	 * 官方 `TurnTokenUsage` 规定 `cacheReadTokens` / `cacheWriteTokens` / `reasoningTokens`
	 * **只在每次尝试都报告了该桶时才存在**；任一次缺失，整桶就是 undefined，不是 0。
	 * 这里用 `complete` 记录「是否每个已计入的尝试都报过」，缺一次就清掉该桶。
	 */
	usage?: { input: number; output: number; cacheRead?: number; cacheWrite?: number; reasoning?: number; cacheReadComplete: boolean; cacheWriteComplete: boolean; reasoningComplete: boolean };
	/**
	 * 这份 Turn 的 `turn/start` 是否在已加载窗口里（官方 `turnStarted`）。
	 *
	 * 官方 README「Turn token usage」：只有 loaded window **包含 `turn/start`** 时才显示用量行。
	 * 窗口从中间切进来时（比如翻页只拿到 turn 尾部），本仓拿不到该 Turn 的起点，
	 * 累计值可能缺头部样本；此时整份用量必须隐藏，而不是给一个偏小的数字。
	 */
	turnStarted?: true;
	/**
	 * `turn/end.reason.kind`（官方 `turnProcessAlwaysOpen` 的判据之一）。
	 *
	 * 进行中（无该字段）、`aborted`、`interrupted`、`error` 的 Turn 不允许整段收起。
	 */
	endReason?: string;
	/** 已计入用量的 attempt 数（官方「every started model attempt reports safe, exact usage」的分子）。 */
	usageAttempts: number;
	/**
	 * 已开始但**没有**报告可用用量的 attempt 数。
	 *
	 * 只要 > 0，官方要求整份用量隐藏（incomplete accounting），而不是把缺的那次当 0。
	 */
	usageAttemptsMissing: number;
}

/** 一次工作流运行的折叠状态（官方 `WorkflowState`）。 */
interface DshIdeWorkflowState {
	name: string;
	stopReason?: 'completed' | 'cancelled' | 'error';
	/** Turn 被中断 / fork 且没有 run-end：官方把未结束的运行与成员标成 interrupted。 */
	interrupted?: true;
	readonly members: {
		readonly seq: number;
		readonly label: string;
		readonly childId: string;
		readonly phase?: string;
		outcome?: 'completed' | 'cancelled' | 'failed';
	}[];
	readonly seq: number;
	readonly time: number;
	readonly turn: number;
}

/** 一条 inbox 身份。`sourceKind` 对应官方 `InboxIdentity.source.kind`。 */
interface DshIdeInboxIdentity {
	readonly id: string;
	readonly sourceKind: string;
	/**
	 * 官方 `UserMessage.content` 原样保留。
	 *
	 * 历史实现只取 `id` + `sourceKind`，把 `agent/inbox/spliced` 里**已经带下来的**
	 * 完整 `UserMessage[]` 丢掉了——于是「排队队列」看起来像「数据源没给正文」，
	 * 实际是本仓自己丢的。这里按官方形状留住内容块，渲染层才可能画出与官方
	 * `QueueDock` 同形的行。
	 */
	readonly content: readonly unknown[];
}

/** 官方 `InboxState` 里投影要用的部分。pending 始终是物化后的队列。 */
interface DshIdeInboxClaim {
	pending: DshIdeInboxIdentity[];
	currentClaimed: Set<string>;
	claimSeq: number;
	firstClaimedHuman?: string;
}

function emptyInbox(): DshIdeInboxClaim {
	return { pending: [], currentClaimed: new Set(), claimSeq: -1 };
}

interface DshIdeStreamAttempt {
	readonly turn: number;
	readonly step: number;
	revision: number;
	readonly blocks: DshIdeAssistantBlock[];
	readonly id: string;
}

/** 新建一个空投影状态。 */
export function createDshIdeConversationState(): DshIdeConversationState {
	return {
		nodes: new Map(),
		attempts: new Map(),
		settledAttempts: new Set(),
		endedStreamNodes: new Map(),
		hasMore: true,
		deliverables: new Map(),
		subagentCatalog: new Map(),
		inboxNextStep: emptyInbox(),
		inboxNextTurn: emptyInbox(),
		workflows: new Map(),
		turnTails: new Map(),
	};
}

/**
 * 投影一帧 follow 结果。
 *
 * - `snapshot`：整份重建，`records` 逐条投影。
 * - `event`：只投影这一条 durable 事件。
 * - `assistant-stream`：流式 start / chunk / end。
 * 其它帧（waterfall、session-status 等）返回 `undefined`，状态不变。
 */
export function projectDshIdeConversation(state: DshIdeConversationState, frame: unknown): DshIdeConversationView | undefined {
	if (!isRecord(frame)) {
		return undefined;
	}
	const type = frame['type'];
	if (type === 'snapshot') {
		return applySnapshot(state, frame);
	}
	if (type === 'event' && isRecord(frame['event'])) {
		applyDurable(state, frame['event']);
		return viewOf(state);
	}
	if (type === 'assistant-stream' && isRecord(frame['frame'])) {
		applyStream(state, frame['frame']);
		return viewOf(state);
	}
	return undefined;
}

function viewOf(state: DshIdeConversationState): DshIdeConversationView {
	const nodes = [...state.nodes.values()].sort((a, b) => a.seq - b.seq);
	const subagentCatalog = [...state.subagentCatalog.values()].sort((a, b) => a.seq - b.seq);
	return {
		nodes,
		hasMore: state.hasMore,
		...(state.inboxNextTurn.pending.length === 0 ? {} : { inboxNextTurn: state.inboxNextTurn.pending.map(inboxMessageView) }),
		...(state.inboxNextStep.pending.length === 0 ? {} : { inboxNextStep: state.inboxNextStep.pending.map(inboxMessageView) }),
		...(subagentCatalog.length === 0 ? {} : { subagentCatalog }),
	};
}

/** 累计的 `deliverables/presented`，按 turn/callId 顺序输出。 */
export function deliverablesOf(state: DshIdeConversationState): readonly DshIdeDeliverableView[] {
	return [...state.deliverables.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(entry => entry[1]);
}

/** 当前会话最近一次额度失败；没有则为 undefined。 */
export function quotaNoticeOf(state: DshIdeConversationState): DshIdeConversationState['quotaNotice'] {
	return state.quotaNotice;
}

/**
 * 会话里出现过的图片附件引用，按节点顺序去重。
 *
 * 官方没有「会话附件列表」投影键；`attachments` 字段的语义是消息里引用的图片，
 * 所以从已投影的 `user` / `context` / `turn-trigger` 节点的 content 里收集。
 */
export function attachmentsOf(state: DshIdeConversationState): readonly DshIdeImageAttachmentRef[] {
	const seen = new Set<string>();
	const images: DshIdeImageAttachmentRef[] = [];
	for (const node of [...state.nodes.values()].sort((a, b) => a.seq - b.seq)) {
		if (node.kind !== 'user' && node.kind !== 'context' && node.kind !== 'turn-trigger') {
			continue;
		}
		for (const block of node.content) {
			if (block.type !== 'image' || seen.has(block.attachment.attachmentId)) {
				continue;
			}
			seen.add(block.attachment.attachmentId);
			images.push(block.attachment);
		}
	}
	return images;
}

function applySnapshot(state: DshIdeConversationState, frame: Record<string, unknown>): DshIdeConversationView {
	state.nodes.clear();
	state.attempts.clear();
	state.settledAttempts.clear();
	state.endedStreamNodes.clear();
	state.deliverables.clear();
	state.quotaNotice = undefined;
	state.subagentCatalog.clear();
	state.inboxNextStep = emptyInbox();
	state.inboxNextTurn = emptyInbox();
	state.workflows.clear();
	state.lastSystemPrompt = undefined;
	state.turnTails.clear();
	state.hasMore = typeof frame['hasMore'] === 'boolean' ? frame['hasMore'] : true;
	const records = Array.isArray(frame['records']) ? frame['records'] : [];
	for (const record of records) {
		if (isRecord(record) && record['type'] === 'event' && isRecord(record['event'])) {
			applyDurable(state, record['event']);
		}
	}
	// 流式基线：恢复进行中的 attempt。
	const baseline = isRecord(frame['assistantStream']) ? frame['assistantStream'] : undefined;
	const active = baseline !== undefined && isRecord(baseline['activeAttempt']) ? baseline['activeAttempt'] : undefined;
	// revision 的权威位置在 `assistantStream` **外层**（官方 `AssistantStreamFrame`：
	// 单调、替换时重置为 1）。`activeAttempt` 里的是同一份数据的镜像，
	// 读内层会在嵌套形状变化时静默退化成 0，使后续 chunk 全被判为「不新」而丢弃。
	const baselineRevision = baseline !== undefined ? numberOf(baseline['revision']) : undefined;
	if (active !== undefined) {
		const attemptId = stringOf(active['attemptId']);
		const stream = Array.isArray(active['stream']) ? active['stream'] : [];
		if (attemptId !== undefined) {
			const blocks: DshAssistantBlock[] = [];
			for (const chunk of stream) {
				if (isRecord(chunk)) {
					appendChunk(blocks, chunk);
				}
			}
			const attempt: DshIdeStreamAttempt = {
				turn: numberOf(active['turn']) ?? 0,
				step: numberOf(active['step']) ?? 0,
				revision: baselineRevision ?? numberOf(active['revision']) ?? 0,
				blocks,
				id: `stream:${attemptId}`,
			};
			state.attempts.set(attemptId, attempt);
			state.nodes.set(attempt.id, streamNode(state, attempt));
		}
	}
	return viewOf(state);
}

type DshAssistantBlock = DshIdeAssistantBlock;

/**
 * 消费官方 `surfaceOp`。
 *
 * 官方 `replace` 用 `{ op:'replace', startSeq, endSeq }`（**闭区间**、按当前 surface 顺序）
 * 表示「这一段被新事件取代」。投影器原来只按 seq 追加，忽略这个字段，
 * 于是被替换掉的旧节点会一直留在画面上——表现为重复内容或过期内容不消失。
 * @param state 投影状态
 * @param event 带 `surfaceOp` 的 durable 事件
 * @param seq 本事件自己的 seq（替换后的新节点不得被自己删掉）
 */
function applySurfaceOp(state: DshIdeConversationState, event: Record<string, unknown>, seq: number): void {
	const op = isRecord(event['surfaceOp']) ? event['surfaceOp'] : undefined;
	if (op === undefined || stringOf(op['op']) !== 'replace') {
		return;
	}
	const start = numberOf(op['startSeq']);
	const end = numberOf(op['endSeq']);
	if (start === undefined || end === undefined || start > end) {
		return;
	}
	for (const [id, node] of [...state.nodes]) {
		if (id.startsWith('stream:')) {
			continue;
		}
		// 只删落在被替换区间内的旧节点；本事件自己的 seq 不在其中（它比区间更新）。
		if (node.seq >= start && node.seq <= end && node.seq !== seq) {
			state.nodes.delete(id);
		}
	}
}

/**
 * 官方 `inbox.ts` 的 `applySplice`。
 * `removedCount > 0` 且不是 `canceled` 才是一次认领：被移出的 id 进入 `currentClaimed`。
 * 只插入、或取消，不产生新的认领，并从当前认领里去掉新插入的 id。
 */
function applyInboxSplice(previous: DshIdeInboxClaim, data: Record<string, unknown>, seq: number): DshIdeInboxClaim {
	const start = numberOf(data['start']) ?? 0;
	const removedCount = numberOf(data['removedCount']) ?? 0;
	const inserted = inboxIdentities(data['inserted']);
	const pending = previous.pending.slice();
	if (removedCount > 0 && stringOf(data['outcome']) !== 'canceled') {
		const removed = pending.splice(start, removedCount, ...inserted);
		return {
			pending,
			currentClaimed: new Set(removed.map(item => item.id)),
			claimSeq: seq,
			...(removed.find(item => item.sourceKind === 'user')?.id === undefined
				? {}
				: { firstClaimedHuman: removed.find(item => item.sourceKind === 'user')?.id }),
		};
	}
	pending.splice(start, removedCount, ...inserted);
	const currentClaimed = new Set(previous.currentClaimed);
	for (const item of inserted) {
		currentClaimed.delete(item.id);
	}
	return {
		pending,
		currentClaimed,
		claimSeq: previous.claimSeq,
		...(previous.firstClaimedHuman === undefined ? {} : { firstClaimedHuman: previous.firstClaimedHuman }),
	};
}

function inboxIdentities(value: unknown): DshIdeInboxIdentity[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const identities: DshIdeInboxIdentity[] = [];
	for (const item of value) {
		if (!isRecord(item)) {
			continue;
		}
		const id = stringOf(item['id']);
		const source = isRecord(item['source']) ? stringOf(item['source']['kind']) : undefined;
		if (id === undefined || source === undefined) {
			continue;
		}
		identities.push({ id, sourceKind: source, content: Array.isArray(item['content']) ? item['content'] : [] });
	}
	return identities;
}

/** 一条 durable 事件 → 零到多个节点，原地写入 state。 */
function applyDurable(state: DshIdeConversationState, event: Record<string, unknown>): void {
	const seq = numberOf(event['seq']);
	if (seq === undefined) {
		return;
	}
	// 先应用替换语义，再写入本事件：顺序反过来会把自己刚写的节点删掉。
	applySurfaceOp(state, event, seq);
	const type = stringOf(event['type']);
	const data = isRecord(event['data']) ? event['data'] : {};
	const time = numberOf(event['time']) ?? 0;
	const turn = numberOf(event['turn']) ?? numberOf(data['turn']) ?? 0;
	const messageId = stringOf(data['messageId']);

	if (type === 'agent/inbox/spliced') {
		const target = stringOf(data['target']);
		if (target === 'next-step') {
			state.inboxNextStep = applyInboxSplice(state.inboxNextStep, data, seq);
		} else if (target === 'next-turn') {
			state.inboxNextTurn = applyInboxSplice(state.inboxNextTurn, data, seq);
		}
		return;
	}

	if (type === 'user/message') {
		const source = data['source'];
		const sourceKind = isRecord(source) ? stringOf(source['kind']) : undefined;
		const content = contentBlocksOf(data['content']);
		// 官方 `questionReplyDefinition`：迟到的问卷回执由问题域认领，不进普通消息分类。
		if (sourceKind === 'user-question-reply' && isRecord(source)) {
			const late = lateQuestionReplyOf(seq, time, turn, source, content);
			if (late !== undefined) {
				put(state, `seq:${seq}`, late);
				return;
			}
		}
		const claimedId = stringOf(data['id']) ?? messageId;
		// 官方 `message.ts` 的 `buildViewNode`：非人类消息只有在被认领为唤醒
		// （`waking === true`）时才画成 `turn-trigger`；`retry` 且 content 为空时
		// 才画成续跑触发器。其余 `subagent-settled` / `agent-message` 走普通消息分类，
		// 不在这里自造 kind。
		// 官方 waking 不是事件字段：`message.ts` 用 `inbox-next-turn.currentClaimed` 判断。
		// `data.waking` 只留给已经算好的投影；线上事件靠 inbox splice。
		const waking = data['waking'] === true
			|| (claimedId !== undefined && state.inboxNextTurn.currentClaimed.has(claimedId));
		if (waking || (sourceKind === 'retry' && content.length === 0)) {
			put(state, `seq:${seq}`, {
				kind: 'turn-trigger',
				...(messageId === undefined ? {} : { messageId }),
				seq,
				time,
				turn,
				content,
				...(source === undefined ? {} : { source }),
				producer: contextProducerOf(source),
				form: contextFormOf(source),
			});
			return;
		}
		if (content.length === 0) {
			return;
		}
		if (sourceKind !== undefined && sourceKind !== 'user') {
			// 插件注入的模型可见上下文：折叠为 context 行，不画成用户气泡。
			put(state, `seq:${seq}`, {
				kind: 'context',
				...(messageId === undefined ? {} : { messageId }),
				seq,
				time,
				turn,
				content,
				...(source === undefined ? {} : { source }),
				producer: contextProducerOf(source),
				form: contextFormOf(source),
			});
			return;
		}
		const steered = claimedId !== undefined && state.inboxNextStep.currentClaimed.has(claimedId);
		const durableId = messageId ?? claimedId;
		put(state, `seq:${seq}`, {
			kind: steered ? 'steering' : 'user',
			...(durableId === undefined ? {} : { messageId: durableId }),
			seq,
			time,
			...(steered ? { turn } : {}),
			content,
			...(source === undefined ? {} : { source }),
		});
		if (steered) {
			// 被认领的 steering 属于正在跑的 Turn：计入控制锚点与消息数。
			noteTurnInput(state, turn, seq);
		}
		return;
	}

	if (type === 'turn/start') {
		// 官方 `ChatBuilder` 用 `turn/start` 判定「这个 Turn 的起点在已加载窗口里」（`turnStarted`）。
		// 用量行的显示前提之一就是它：窗口从中间切进来时，累计值缺头部样本，不能当完整值展示。
		// 这里只记录事实，不产出节点（`turn/start` 不在节点白名单内）。
		turnTailOf(state, turn).turnStarted = true;
		return;
	}

	if (type === 'assistant/attempt') {
		// 官方 `usageOf()` 对 `assistant/attempt` 同样生效：它读 `data.stream` 里最后一个 `usage`
		// chunk（`lastAssistantStreamChunk(stream, 'usage')`）。重试链里被覆盖的那次 attempt 只有这个
		// 入口，漏接会让「重试的同一 step」少算一次、总数比官方偏小。
		const step = numberOf(data['step']) ?? 0;
		const usage = streamUsageOf(data['stream']);
		// 官方「every started model attempt reports safe, exact usage」：每一次已开始的 attempt
		// 都要么报了一份可用样本，要么被记为「缺失」——后者会让整份用量隐藏（不是当 0）。
		const attemptTail = turnTailOf(state, turn);
		if (usage === undefined) {
			attemptTail.usageAttemptsMissing += 1;
		} else {
			attemptTail.usageAttempts += 1;
		}
		if (usage !== undefined) {
			const tail = attemptTail;
			const value = (input: unknown): number => typeof input === 'number' && Number.isFinite(input) ? input : 0;
			const maybe = (input: unknown): number | undefined => typeof input === 'number' && Number.isFinite(input) ? input : undefined;
			const delta = {
				input: value(usage.input ?? usage.inputTokens),
				output: value(usage.output ?? usage.outputTokens),
				cacheRead: maybe(usage.cacheRead ?? usage.cacheReadTokens),
				cacheWrite: maybe(usage.cacheWrite ?? usage.cacheWriteTokens),
				reasoning: maybe(usage.reasoning ?? usage.reasoningTokens),
			};
			if (delta.input + delta.output + (delta.cacheRead ?? 0) + (delta.cacheWrite ?? 0) + (delta.reasoning ?? 0) > 0) {
				noteTurnUsage(tail, step, delta);
			}
		}
		noteTurnStep(state, turn, step);
		return;
	}

	if (type === 'assistant/message') {
		const message = isRecord(data['message']) ? data['message'] : {};
		const step = numberOf(data['step']) ?? numberOf(message['step']) ?? 0;
		const blocks = assistantBlocksOf(message['content']);
		const usage = isRecord(data['usage']) ? tokenUsageOf(data['usage']) : isRecord(message['usage']) ? tokenUsageOf(message['usage']) : undefined;
		if (blocks.length === 0) {
			return;
		}
		put(state, `seq:${seq}`, {
			kind: 'assistant',
			...(messageId === undefined ? {} : { messageId }),
			seq,
			time,
			turn,
			step,
			blocks,
			...(usage === undefined ? {} : { usage }),
			...(providerMetadataOf(message['providerMetadata']) === undefined ? {} : { providerMetadata: providerMetadataOf(message['providerMetadata']) }),
			...(data['interrupted'] === true || message['interrupted'] === true ? { interrupted: true as const } : {}),
		});
		if (usage === undefined) {
			turnTailOf(state, turn).usageAttemptsMissing += 1;
		} else {
			turnTailOf(state, turn).usageAttempts += 1;
		}
		noteTurnAssistant(state, turn, seq, blocks, usage as Parameters<typeof noteTurnAssistant>[4], messageId, step);
		noteTurnStep(state, turn, step);
		// durable 消息接管同回合的流式临时节点，包括已经 end、但节点还留着的那次。
		retireTurnStreams(state, turn);
		return;
	}

	if (type === 'tool/call') {
		const callId = stringOf(data['callId']);
		const name = stringOf(data['name']);
		if (callId === undefined || name === undefined) {
			return;
		}
		// 官方 `ui-plan` 的 `planDefinition`：`exit_plan_mode` 的完整计划另成一节点。
		const plan = submittedPlanOf(seq, time, turn, String(callId), name, typeof data['arguments'] === 'string' ? data['arguments'] : undefined);
		if (plan !== undefined) {
			put(state, `plan:${callId}`, plan);
		}
		put(state, `seq:${seq}`, {
			kind: 'tool-call',
			seq,
			time,
			turn,
			callId,
			name,
			phase: data['phase'] === 'preparing' ? 'preparing' : 'start',
			step: numberOf(data['step']) ?? 0,
			...(typeof data['arguments'] === 'string' ? { argsRaw: data['arguments'] } : {}),
		});
		// 官方 `TurnProcessSpec`：`toolCallCount` 只数**非子代理**工具调用，
		// 子代理委派单独进 `subagentCount`。两者不能重叠计数。
		const isSubagent = name === 'subagent' || name.startsWith('subagent_');
		noteTurnTranscript(state, turn, seq, !isSubagent);
		if (isSubagent) {
			noteTurnSubagent(state, turn);
		}
		return;
	}

	if (type === 'tool/result') {
		const message = isRecord(data['message']) ? data['message'] : {};
		const source = isRecord(message['source']) ? message['source'] : {};
		const callId = stringOf(source['callId']);
		if (callId === undefined) {
			return;
		}
		const call = isRecord(data['call']) ? data['call'] : undefined;
		// 官方 `rootResult`（`ui-chat/.../conversation-nodes/tool.ts`）：`name: previous?.name ?? ''`，
		// `call: previous === undefined ? null : { name, argsRaw }`。配对调用不在加载窗口内时
		// `name` 就是空串、`call` 为 null——这是官方的正常形态，不是坏数据。
		const callName = call === undefined ? '' : stringOf(call['name']) ?? '';
		// 官方 `ui-user-questions` 的 `answeredQuestionDefinition`：`ask_user_question` 的结果
		// 若带一条覆盖整份题目的 JSON 回执，就取代普通工具卡，变成 `question-reply`。
		const reply = callName === 'ask_user_question'
			? questionReplyOf(seq, time, turn, callId, typeof call?.['argsRaw'] === 'string' ? call['argsRaw'] : undefined, contentOf(message['content']))
			: undefined;
		if (reply !== undefined) {
			put(state, `seq:${seq}`, reply);
			return;
		}
		const subCalls = Array.isArray(data['subCalls']) ? data['subCalls'].flatMap(child => decodeToolCallBlock(child)) : [];
		put(state, `seq:${seq}`, {
			kind: 'tool-result',
			seq,
			time,
			turn,
			callId,
			name: callName,
			args: data['args'] ?? null,
			...(call === undefined || callName === ''
				? { call: null }
				: { call: { name: callName, argsRaw: stringOf(call['argsRaw']) ?? '' } }),
			...(numberOf(data['callTime']) === undefined ? {} : { callTime: numberOf(data['callTime']) }),
			content: contentBlocksOf(message['content']),
			isError: message['isError'] === true,
			subCalls,
			...(errorOf(data['error']) === undefined ? {} : { error: errorOf(data['error']) }),
		});
		if (event['surfaceOp'] === 'append' || event['surfaceOp'] === undefined) {
			noteTurnTranscript(state, turn, seq);
		}
		return;
	}

	if (type === 'turn/end') {
		const reason = isRecord(data['reason']) ? data['reason'] : {};
		const kind = stringOf(reason['kind']);
		const step = numberOf(data['step']) ?? 0;
		if (kind !== undefined) {
			// 折叠判定要用官方的结算原因：进行中 / aborted / interrupted / error 的 Turn 不允许收起。
			turnTailOf(state, turn).endReason = kind;
		}
		// 官方 `turnAbandoned`：Turn 中断 / fork 时，没有 run-end 的工作流算中断。
		noteTurnAbandoned(state, turn, kind);
		if (kind === 'error' || kind === 'aborted' || kind === 'interrupted') {
			const failure = isRecord(reason['failure']) ? reason['failure'] : {};
			// 官方 `turn/end.reason.error.code` 是额度提示的唯一来源
			// （`ui-chat/src/client/apply.ts:108-116`）：只有 QUOTA / ACCOUNT_QUOTA 才记。
			const error = isRecord(reason['error']) ? reason['error'] : undefined;
			const errorCode = error === undefined ? undefined : stringOf(error['code']);
			if (errorCode === 'QUOTA' || errorCode === 'ACCOUNT_QUOTA') {
				state.quotaNotice = { code: errorCode, seq };
			}
			const message = typeof failure['message'] === 'string' && failure['message'] !== ''
				? failure['message']
				: (typeof reason['message'] === 'string' && reason['message'] !== '' ? reason['message'] : kind);
			put(state, `seq:${seq}`, {
				kind: 'turn-error',
				seq,
				time,
				turn,
				step,
				message,
				...(stringOf(failure['code']) === undefined ? {} : { code: stringOf(failure['code']) }),
			});
			// 尾部事实先写：错误本身留在 errorDetails / turn-error，尾部只报分支是否可用。
			putTurnTail(state, turn, seq, time, true);
			return;
		}
		if (kind === 'max-tokens') {
			put(state, `seq:${seq}`, { kind: 'turn-max-tokens', seq, time, turn, step });
		}
		putTurnTail(state, turn, seq, time, false);
		return;
	}

	if (type === 'llm/retry-started') {
		// 官方 `tokenUsageProjectionDefinition.apply`：`llm/retry-started` 把**同 (turn, step)** 的
		// 替换槽清空，使重试的 attempt 重新计入总量（而不是被当成「同一 step 再报一次」替换掉）。
		// 漏接这一步时，「同 step 重试」会先扣掉旧样本再加新样本，总量比官方偏小。
		const step = numberOf(data['step']) ?? 0;
		const tail = turnTailOf(state, turn);
		if (tail.lastUsageStep === step) {
			tail.lastUsageStep = undefined;
			tail.lastUsageSample = undefined;
		}
		return;
	}

	if (type === 'llm/retry') {
		put(state, `seq:${seq}`, {
			kind: 'model-retry',
			seq,
			time,
			turn,
			retryState: 'scheduled',
			...(numberOf(data['retry']) === undefined ? {} : { retry: numberOf(data['retry']) }),
			...(numberOf(data['maxRetries']) === undefined ? {} : { maxRetries: numberOf(data['maxRetries']) }),
			...(numberOf(data['delayMs']) === undefined ? {} : { delayMs: numberOf(data['delayMs']) }),
			...(data['mode'] === 'normal' || data['mode'] === 'always' ? { mode: data['mode'] } : {}),
			...(failureOf(data['failure']) === undefined ? {} : { failure: failureOf(data['failure']) }),
		});
		noteTurnTranscript(state, turn, seq);
		return;
	}

	if (type === 'command/run' || type === 'command/done') {
		const commandId = stringOf(data['commandId']);
		if (commandId === undefined) {
			return;
		}
		const previous = state.nodes.get(`cmd:${commandId}`);
		const base = previous !== undefined && previous.kind === 'command' ? previous : undefined;
		put(state, `cmd:${commandId}`, {
			kind: 'command',
			seq: base?.seq ?? seq,
			time: base?.time ?? time,
			commandId,
			name: type === 'command/run' ? (stringOf(data['name']) ?? null) : (base?.name ?? null),
			args: type === 'command/run' ? (typeof data['rawInput'] === 'string' ? data['rawInput'] : null) : (base?.args ?? null),
			outcome: type === 'command/done'
				? {
					kind: data['ok'] === false ? 'error' : 'success',
					...(typeof data['text'] === 'string' ? { text: data['text'] } : {}),
					// 官方 `CommandNode.outcome.sourceEventSeq`：命令结算指向更早的权威事件（如压缩检查点）。
					...(numberOf(data['sourceEventSeq']) === undefined ? {} : { sourceEventSeq: numberOf(data['sourceEventSeq']) }),
				}
				: (base?.outcome ?? null),
		});
		if (type === 'command/done') {
			pairManualCompaction(state, commandId);
		}
		// 官方 `ui-goal` 的 `goalCommandInputDefinition`：`/goal` 的人工输入单独成行，
		// 通用命令节点仍保留持久结果行。
		if (type === 'command/run' && stringOf(data['name']) === 'goal') {
			const rawInput = typeof data['rawInput'] === 'string' ? data['rawInput'] : '';
			put(state, `seq:${seq}`, {
				kind: 'command-input',
				seq,
				time,
				commandId,
				text: `/goal${rawInput.trimEnd()}`,
			});
		}
		return;
	}

	if (type === 'system/message') {
		// 官方 `systemMessageDefinition`：只有 append 的非空系统消息拥有提示卡；
		// 文本与上一份不同即视为历史内的提示更新。
		const text = contentOf(data['content']) ?? textOfContent(data['content']);
		if (event['surfaceOp'] === 'append' || event['surfaceOp'] === undefined) {
			if (text !== undefined && text !== '') {
				const update = state.lastSystemPrompt !== undefined && state.lastSystemPrompt !== text;
				state.lastSystemPrompt = text;
				put(state, `sys:${seq}`, {
					kind: 'system-prompt',
					seq,
					time,
					text,
					...(update ? { update: true } : {}),
				} as DshIdeConversationNode);
			}
		}
		return;
	}

	if (type !== undefined && type.startsWith('tool-workflow/')) {
		applyWorkflowEvent(state, type, data, seq, time, turn);
		return;
	}

	if (type === 'compaction/summary' || type === 'user/message#compaction') {
		put(state, `seq:${seq}`, {
			kind: 'compaction',
			seq,
			time,
			// 官方 `compaction/summary` 的 `data.summary` 是**内容块数组**（`[{type:'text',text}]`），
			// 不是字符串：只认字符串会让每张压缩卡都变成空摘要（TypeError 被吞成 null）。
			// 这里按同一套内容块抽取；两种形状都接受，缺字段才是 null。
			summary: typeof data['summary'] === 'string' ? data['summary'] : textOfContent(data['summary']) ?? null,
			...(numberOf(data['summaryEventSeq']) === undefined ? {} : { summaryEventSeq: numberOf(data['summaryEventSeq']) }),
			...(numberOf(data['shadowedItemCount']) === undefined ? {} : { shadowedItemCount: numberOf(data['shadowedItemCount']) }),
			...(numberOf(data['shadowedTokenCount']) === undefined ? {} : { shadowedTokenCount: numberOf(data['shadowedTokenCount']) }),
		});
		// 压缩检查点可能后到：先记下它，再尝试把已到的 `/compact` 命令行配对。
		for (const key of [...state.nodes.keys()]) {
			if (key.startsWith('cmd:')) {
				pairManualCompaction(state, key.slice(4));
			}
		}
		return;
	}

	if (type === 'deliverables/presented') {
		// 官方 `deliverables/presented`（`tool-present/src/types.ts:15`）：
		// 每个 turn 的 present 调用带一份文件清单，按 seq 累计。
		const callId = stringOf(data['callId']);
		const turnOfDelivery = numberOf(data['turn']) ?? turn;
		const files = presentedFilesOf(data['files']);
		if (callId !== undefined && files.length > 0) {
			state.deliverables.set(seq, { turn: turnOfDelivery, callId, files });
		}
		return;
	}

	if (type === 'subagent/catalog') {
		// 父会话上的子代理发现事实（`subagent/src/catalog.ts`）。官方把它放在
		// `SessionProjectionMap['subagentCatalog']`，不进入 chat 节点树。字段缺了就不写。
		state.subagentCatalog.set(seq, {
			seq,
			time,
			...(stringOf(data['childId']) === undefined ? {} : { childId: stringOf(data['childId']) }),
			...(numberOf(data['childCreatedAt']) === undefined ? {} : { childCreatedAt: numberOf(data['childCreatedAt']) }),
			...(stringOf(data['mode']) === undefined ? {} : { mode: stringOf(data['mode']) }),
			...(stringOf(data['label']) === undefined ? {} : { label: stringOf(data['label']) }),
			...(stringOf(data['name']) === undefined ? {} : { name: stringOf(data['name']) }),
			...(numberOf(data['version']) === undefined ? {} : { version: numberOf(data['version']) }),
		});
		return;
	}

	if (type === 'session/end-seed' && data['inherited'] === true) {
		// 官方 `inheritedHistoryDefinition.buildViewNode` 取 `context.matches.at(-1)`：
		// **只在最新的 inherited seed 标记处放一个分界行**，不是每个标记各放一个。
		// 历史分页会把更早的标记也载入；每个都画会在长 fork 历史里叠出一串重复分界。
		if (state.lastInheritedHistoryKey !== undefined) {
			state.nodes.delete(state.lastInheritedHistoryKey);
		}
		const key = `seq:${seq}`;
		put(state, key, { kind: 'inherited-history', seq, time, turn });
		state.lastInheritedHistoryKey = key;
	}
}

/** `assistant-stream`：start / chunk / end，按 revision 单调去重。 */
function applyStream(state: DshIdeConversationState, frame: Record<string, unknown>): void {
	const type = stringOf(frame['type']);
	const attemptId = stringOf(frame['attemptId']);
	const revision = numberOf(frame['revision']);
	if (attemptId === undefined || revision === undefined) {
		return;
	}
	if (type === 'start') {
		if (state.attempts.has(attemptId) || state.settledAttempts.has(attemptId)) {
			return;
		}
		const attempt: DshIdeStreamAttempt = {
			turn: numberOf(frame['turn']) ?? 0,
			step: numberOf(frame['step']) ?? 0,
			revision,
			blocks: [],
			id: `stream:${attemptId}`,
		};
		state.attempts.set(attemptId, attempt);
		state.nodes.set(attempt.id, streamNode(state, attempt));
		return;
	}
	if (type === 'chunk') {
		const attempt = state.attempts.get(attemptId);
		const chunk = isRecord(frame['chunk']) ? frame['chunk'] : undefined;
		if (attempt === undefined || chunk === undefined || revision <= attempt.revision) {
			return;
		}
		attempt.revision = revision;
		appendChunk(attempt.blocks, chunk);
		state.nodes.set(attempt.id, streamNode(state, attempt));
		return;
	}
	if (type === 'end') {
		const attempt = state.attempts.get(attemptId);
		if (attempt === undefined) {
			return;
		}
		const outcome = isRecord(frame['outcome']) ? frame['outcome'] : {};
		state.attempts.delete(attemptId);
		state.settledAttempts.add(attemptId);
		if (outcome['kind'] === 'abandoned') {
			// 没有落成可见消息：丢弃这次尝试留下的临时节点。
			state.nodes.delete(attempt.id);
			return;
		}
		// 正式消息可能晚于 end。先记住节点，等同回合 assistant/message 再删。
		let ids = state.endedStreamNodes.get(attempt.turn);
		if (ids === undefined) {
			ids = new Set();
			state.endedStreamNodes.set(attempt.turn, ids);
		}
		ids.add(attempt.id);
	}
}

/** 同回合的流式临时节点交给 durable 消息后删除，避免和正式回复各画一条。 */
function retireTurnStreams(state: DshIdeConversationState, turn: number): void {
	for (const [attemptId, attempt] of [...state.attempts]) {
		if (attempt.turn !== turn) {
			continue;
		}
		state.attempts.delete(attemptId);
		state.settledAttempts.add(attemptId);
		state.nodes.delete(attempt.id);
	}
	const ended = state.endedStreamNodes.get(turn);
	if (ended === undefined) {
		return;
	}
	for (const id of ended) {
		state.nodes.delete(id);
	}
	state.endedStreamNodes.delete(turn);
}

function streamNode(state: DshIdeConversationState, attempt: DshIdeStreamAttempt): DshIdeConversationNode {
	let max = 0;
	for (const node of state.nodes.values()) {
		if (node.seq > max) {
			max = node.seq;
		}
	}
	return {
		kind: 'assistant',
		seq: max + 1,
		time: Date.now(),
		turn: attempt.turn,
		step: attempt.step,
		blocks: attempt.blocks,
	};
}

/** 把 `/compact` 命令行与它指向的压缩检查点合成一个节点（官方 `manual-compaction`）。 */
function pairManualCompaction(state: DshIdeConversationState, commandId: string): void {
	const commandNode = state.nodes.get(`cmd:${commandId}`);
	if (commandNode === undefined || commandNode.kind !== 'command' || commandNode.outcome === null) {
		return;
	}
	const sourceSeq = (commandNode.outcome as { readonly sourceEventSeq?: unknown }).sourceEventSeq;
	if (typeof sourceSeq !== 'number') {
		return;
	}
	for (const [key, node] of [...state.nodes]) {
		if (node.kind !== 'compaction' || (node.seq !== sourceSeq && node.summaryEventSeq !== sourceSeq)) {
			continue;
		}
		put(state, `manual:${commandId}`, {
			kind: 'manual-compaction',
			seq: commandNode.seq,
			time: commandNode.time,
			command: {
				commandId: commandNode.commandId,
				name: commandNode.name,
				args: commandNode.args,
				outcome: commandNode.outcome,
			},
			compaction: {
				summary: node.summary,
				...(node.shadowedItemCount === undefined ? {} : { shadowedItemCount: node.shadowedItemCount }),
				...(node.shadowedTokenCount === undefined ? {} : { shadowedTokenCount: node.shadowedTokenCount }),
			},
		} as DshIdeConversationNode);
		// 两张旧卡由合成卡取代，避免同一动作画两遍。
		state.nodes.delete(`cmd:${commandId}`);
		state.nodes.delete(key);
		return;
	}
}

/** 一个 Turn 的尾部与过程状态。 */
function turnTailOf(state: DshIdeConversationState, turn: number): DshIdeTurnTailState {
	const existing = state.turnTails.get(turn);
	if (existing !== undefined) {
		return existing;
	}
	const created: DshIdeTurnTailState = { answerStep: 0, messageCount: 0, assistantCount: 0, toolCallCount: 0, subagentCount: 0, usageAttempts: 0, usageAttemptsMissing: 0 };
	state.turnTails.set(turn, created);
	return created;
}

/**
 * 记一条 turn 内的转写位置（工具、重试、错误等），供过程组的锚点与计数。
 *
 * `countsToolCall` 为真才计入 `toolCallCount`：官方只数**非子代理**工具调用。
 */
function noteTurnTranscript(state: DshIdeConversationState, turn: number, seq: number, countsToolCall = true): void {
	const tail = turnTailOf(state, turn);
	tail.processStartSeq ??= seq;
	if (countsToolCall) {
		tail.toolCallCount += 1;
	}
}

/** 记该 turn 最后一条带正文的助手答复，并累计用量。 */
function noteTurnAssistant(state: DshIdeConversationState, turn: number, seq: number, blocks: readonly { readonly kind?: string; readonly text?: string }[], usage?: { readonly input?: unknown; readonly output?: unknown; readonly cacheRead?: unknown; readonly cacheWrite?: unknown; readonly reasoning?: unknown; readonly inputTokens?: unknown; readonly outputTokens?: unknown; readonly cacheReadTokens?: unknown; readonly cacheWriteTokens?: unknown; readonly reasoningTokens?: unknown }, messageId?: string, step = 0): void {
	// 官方 `chat/turn-assistant.ts` 的 `assistantText` 是 `blocks.filter(text).map(text).join('')`：
	// 直接拼接、不加分隔符。用 '\n' 会让 closing 与官方文本不一致（多出换行）。
	// 同时按官方口径保留空串块（只有 `trim() === ''` 才算「没有正文」）。
	const textBlocks = blocks.flatMap(block => block.kind === 'text' && typeof block.text === 'string' ? [block.text] : []);
	const text = textBlocks.join('');
	const hasProse = text.trim() !== '';
	const tail = turnTailOf(state, turn);
	if (hasProse) {
		tail.lastAssistantSeq = seq;
		tail.lastAssistantText = text;
		// 只有带正文的答复才是官方意义上的 closing，它的 messageId 才有意义。
		if (messageId === undefined || messageId === '') {
			delete tail.lastAssistantMessageId;
		} else {
			tail.lastAssistantMessageId = messageId;
		}
	}
	tail.answerAnchorSeq ??= seq;
	tail.assistantCount += 1;
	const add = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;
	const optional = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
	const delta = {
		input: add(usage?.input ?? usage?.inputTokens),
		output: add(usage?.output ?? usage?.outputTokens),
		cacheRead: optional(usage?.cacheRead ?? usage?.cacheReadTokens),
		cacheWrite: optional(usage?.cacheWrite ?? usage?.cacheWriteTokens),
		reasoning: optional(usage?.reasoning ?? usage?.reasoningTokens),
	};
	if (delta.input + delta.output + (delta.cacheRead ?? 0) + (delta.cacheWrite ?? 0) + (delta.reasoning ?? 0) > 0) {
		noteTurnUsage(tail, step, delta);
	}
	state.turnTails.set(turn, tail);
}


/**
 * 把一次用量样本计入该 Turn 的总量（官方 `tokenUsageProjectionDefinition.apply`）。
 *
 * 官方 `usageOf()` 对 **`assistant/message` 与 `assistant/attempt` 都生效**：前者读 `data.usage`，
 * 后者读 `data.stream` 里最后一个 `usage` chunk。两者必须共用这一套 `addReplacing` 语义，
 * 否则「重试的同一 step」会被算两遍。抽取成函数正是为了让两条入口不可能走偏。
 */
function noteTurnUsage(tail: DshIdeTurnTailState, step: number, delta: {
	readonly input: number;
	readonly output: number;
	readonly cacheRead?: number;
	readonly cacheWrite?: number;
	readonly reasoning?: number;
}): void {
	if (delta.input + delta.output + (delta.cacheRead ?? 0) + (delta.cacheWrite ?? 0) + (delta.reasoning ?? 0) > 0) {
		const current = tail.usage ?? { input: 0, output: 0, cacheReadComplete: true, cacheWriteComplete: true, reasoningComplete: true };
		// 官方 `tokenUsageProjectionDefinition`：同一 `(turn, step)` 再来一个样本时用 `addReplacing`
		// 先扣掉上一次，再计入新样本；`llm/retry-started` 会清掉那个槽，使重试的 attempt 重新计入。
		// 纯累加会把被重试覆盖的那次也算进总量，比官方偏大。
		const sameStep = tail.lastUsageStep !== undefined && tail.lastUsageStep === step && tail.lastUsageSample !== undefined;
		const previous = sameStep ? tail.lastUsageSample! : undefined;
		const replaced = {
			input: current.input - (previous?.input ?? 0) + delta.input,
			output: current.output - (previous?.output ?? 0) + delta.output,
		};
		tail.lastUsageStep = step;
		tail.lastUsageSample = {
			input: delta.input,
			output: delta.output,
			...(delta.cacheRead === undefined ? {} : { cacheRead: delta.cacheRead }),
			...(delta.cacheWrite === undefined ? {} : { cacheWrite: delta.cacheWrite }),
			...(delta.reasoning === undefined ? {} : { reasoning: delta.reasoning }),
		};
		// 任一尝试缺该桶，整桶作废（官方「every attempt reported the bucket」）。
		const merge = (previous: number | undefined, next: number | undefined, complete: boolean): { value: number | undefined; complete: boolean } => {
			if (!complete || next === undefined) {
				return { value: undefined, complete: false };
			}
			return { value: (previous ?? 0) + next, complete: true };
		};
		const cacheRead = merge(current.cacheRead, delta.cacheRead, current.cacheReadComplete);
		const cacheWrite = merge(current.cacheWrite, delta.cacheWrite, current.cacheWriteComplete);
		const reasoning = merge(current.reasoning, delta.reasoning, current.reasoningComplete);
		tail.usage = {
			input: replaced.input,
			output: replaced.output,
			...(cacheRead.value === undefined ? {} : { cacheRead: cacheRead.value }),
			...(cacheWrite.value === undefined ? {} : { cacheWrite: cacheWrite.value }),
			...(reasoning.value === undefined ? {} : { reasoning: reasoning.value }),
			cacheReadComplete: cacheRead.complete,
			cacheWriteComplete: cacheWrite.complete,
			reasoningComplete: reasoning.complete,
		};
	}
}

/** 记录该 Turn 的 answerStep（过程组要用最大 step）。 */
function noteTurnStep(state: DshIdeConversationState, turn: number, step: number): void {
	const tail = turnTailOf(state, turn);
	tail.answerStep = Math.max(tail.answerStep, step);
}

/** 记录该 Turn 的控制锚点（第一条人类输入）与消息计数。 */
function noteTurnInput(state: DshIdeConversationState, turn: number, seq: number): void {
	const tail = turnTailOf(state, turn);
	tail.controlAnchorSeq ??= seq;
}

/** 记录一次子代理委派（官方 `subagentCount`）。 */
function noteTurnSubagent(state: DshIdeConversationState, turn: number): void {
	turnTailOf(state, turn).subagentCount += 1;
}

/** 官方 `turnAbandoned`：Turn 被中断或 fork 后，没有 run-end 的工作流算中断。 */
function noteTurnAbandoned(state: DshIdeConversationState, turn: number, reason: string | undefined): void {
	if (reason !== 'interrupted' && reason !== 'forked') {
		return;
	}
	for (const [runId, workflow] of state.workflows) {
		if (workflow.turn !== turn || workflow.stopReason !== undefined || workflow.interrupted === true) {
			continue;
		}
		workflow.interrupted = true;
		put(state, `workflow:${runId}`, workflowNodeOf(runId, workflow));
	}
}

/** 官方 `turn-process`：把已收集的锚点与计数写成过程组节点。 */
function putTurnProcess(state: DshIdeConversationState, turn: number, seq: number, time: number): void {
	const tail = turnTailOf(state, turn);
	if (tail.answerAnchorSeq === undefined) {
		return;
	}
	put(state, `process:${turn}`, {
		kind: 'turn-process',
		turn,
		seq,
		time,
		...(tail.controlAnchorSeq === undefined ? {} : { controlAnchorSeq: tail.controlAnchorSeq }),
		...(tail.processStartSeq === undefined ? {} : { processStartSeq: tail.processStartSeq }),
		answerAnchorSeq: tail.answerAnchorSeq,
		answerStep: tail.answerStep,
		inlineReasoning: false,
		messageCount: tail.assistantCount === 0 ? 0 : tail.assistantCount - 1,
		toolCallCount: tail.toolCallCount,
		subagentCount: tail.subagentCount,
		...(tail.endReason === undefined ? {} : { endReason: tail.endReason }),
	} as DshIdeConversationNode);
}

/**
 * 把内部聚合状态转成线协议形状。
 *
 * `cacheReadComplete` 之类的记账字段不上线：协议只表达「有这个桶」或「没有」。
 */
function tokenUsageView(usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number; reasoning?: number; cacheReadComplete: boolean; cacheWriteComplete: boolean; reasoningComplete: boolean }): {
	input: number;
	output: number;
	cacheRead?: number;
	cacheWrite?: number;
	reasoning?: number;
} {
	return {
		input: usage.input,
		output: usage.output,
		...(usage.cacheRead === undefined ? {} : { cacheRead: usage.cacheRead }),
		...(usage.cacheWrite === undefined ? {} : { cacheWrite: usage.cacheWrite }),
		...(usage.reasoning === undefined ? {} : { reasoning: usage.reasoning }),
	};
}

/**
 * 官方 `TurnTailNodeView.lastContent(snapshot, turn, skipWarning = true)` 的等价物。
 *
 * 取该 Turn 内最后一个不算「尾部元数据」的节点 seq：跳过 `turn-tail`、`turn-process`，
 * 并跳过 `turn-max-tokens`（官方传 `skipWarning` 时也跳过它）。没有这样的节点时返回 undefined。
 */
function lastTurnContentSeq(state: DshIdeConversationState, turn: number): number | undefined {
	let latest: number | undefined;
	for (const node of state.nodes.values()) {
		if (node.turn !== turn) {
			continue;
		}
		const kind = node.kind;
		if (kind === 'turn-tail' || kind === 'turn-process' || kind === 'turn-max-tokens') {
			continue;
		}
		if (latest === undefined || node.seq > latest) {
			latest = node.seq;
		}
	}
	return latest;
}

/** 官方 `turnTailDefinition` 的 buildViewNode：turn/end 后给出尾部事实。 */
function putTurnTail(state: DshIdeConversationState, turn: number, seq: number, time: number, error: boolean): void {
	const tail = state.turnTails.get(turn);
	const closing = tail?.lastAssistantText;
	// 官方 `branchUnavailable = data.branchUnavailable || hasLaterChatNode`：
	// hasLaterChatNode 是「同 Turn 内还有 anchorSeq 大于收尾答复 seq 的节点」。
	const laterContent = tail?.lastAssistantSeq === undefined
		? false
		: (lastTurnContentSeq(state, turn) ?? -1) > tail.lastAssistantSeq;
	const branchUnavailable = closing === undefined || error || laterContent;
	put(state, `tail:${turn}`, {
		kind: 'turn-tail',
		turn,
		seq,
		time,
		...(closing === undefined ? {} : { closing }),
		...(tail?.lastAssistantMessageId === undefined ? {} : { closingMessageId: tail.lastAssistantMessageId }),
		...(branchUnavailable ? { branchUnavailable: true } : {}),
		...(usageDisclosureOf(tail) === undefined ? {} : { tokenUsage: tokenUsageView(usageDisclosureOf(tail)!) }),
	} as DshIdeConversationNode);
	// 过程组节点与尾部同批产出（官方两个 Definition 各自独立，都在 Turn 结束时成形）。
	putTurnProcess(state, turn, seq, time);
}

/**
 * 该 Turn 的用量是否**可以展示**（官方 README「Turn token usage」的两条硬条件）。
 *
 * > "A completed Turn shows an expandable usage row only when the loaded window includes
 * >  `turn/start` and every started model attempt reports safe, exact usage.
 * >  Incomplete or contradictory accounting hides the complete disclosure instead of
 * >  presenting a partial total."
 *
 * 因此：
 *   1. `turnStarted` 必须为真——窗口从中间切进来时累计值缺头部样本；
 *   2. `usageAttemptsMissing` 必须为 0——有 attempt 没报用量时，整份隐藏而不是当 0。
 *
 * 任一不满足返回 undefined，调用方据此**不写** `tokenUsage` 字段（协议层 optional），
 * 渲染层就不会出现一个偏小或残缺的用量行。
 */
function usageDisclosureOf(tail: DshIdeTurnTailState | undefined): DshIdeTurnTailState['usage'] | undefined {
	if (tail === undefined || tail.usage === undefined) {
		return undefined;
	}
	if (tail.turnStarted !== true || tail.usageAttemptsMissing > 0) {
		return undefined;
	}
	return tail.usage;
}

/**
 * 排队消息 → 线协议形状。
 *
 * `content` 只保留可 JSON 化的块；非对象块丢弃（线协议必须 JSON 安全）。
 * 不认识的 `type` 原样带上，避免把官方新增的块类型悄悄吃掉。
 */
function inboxMessageView(message: DshIdeInboxIdentity): { readonly id: string; readonly sourceKind: string; readonly content: readonly (Readonly<Record<string, unknown>> & { readonly type: string })[] } {
	// 只留「有非空 type 的对象」：块类型是渲染分派的唯一依据，缺它就不是可用块。
	const content = message.content.flatMap(block => isRecord(block) && typeof block['type'] === 'string' && block['type'] !== ''
		? [block as Readonly<Record<string, unknown>> & { readonly type: string }]
		: []);
	return { id: message.id, sourceKind: message.sourceKind, content };
}

/** 官方 `submittedPlan`：只认 `exit_plan_mode` 的参数里带标题的完整 plan。 */
function submittedPlanOf(
	seq: number,
	time: number,
	turn: number,
	callId: string,
	name: string,
	argsRaw: string | undefined,
): DshIdeConversationNode | undefined {
	if (name !== 'exit_plan_mode' || argsRaw === undefined) {
		return undefined;
	}
	let args: unknown;
	try {
		args = JSON.parse(argsRaw);
	} catch {
		return undefined;
	}
	if (!isRecord(args) || typeof args['plan'] !== 'string') {
		return undefined;
	}
	const markdown = args['plan'];
	const title = /^#\s+(\S[^\r\n]*)/.exec(markdown.trim())?.[1];
	if (title === undefined) {
		return undefined;
	}
	return { kind: 'submitted-plan', seq, time, turn, callId, title, markdown } as DshIdeConversationNode;
}

/** 官方 `workflowRunDefinition`：run-start 建节点，agent-start/agent-end/run-end 就地更新。 */
function applyWorkflowEvent(
	state: DshIdeConversationState,
	type: string,
	data: Record<string, unknown>,
	seq: number,
	time: number,
	turn: number,
): void {
	const runId = stringOf(data['runId']);
	if (runId === undefined) {
		return;
	}
	if (type === 'tool-workflow/run-start') {
		state.workflows.set(runId, {
			name: stringOf(data['name']) ?? runId,
			members: [],
			seq,
			time,
			turn,
		});
	} else {
		const current = state.workflows.get(runId);
		if (current === undefined) {
			return;
		}
		if (type === 'tool-workflow/agent-start') {
			current.members.push({
				seq: numberOf(data['seq']) ?? 0,
				label: stringOf(data['label']) ?? '',
				childId: stringOf(data['childId']) ?? '',
				...(stringOf(data['phase']) === undefined ? {} : { phase: stringOf(data['phase']) }),
			});
		} else if (type === 'tool-workflow/agent-end') {
			const member = current.members.find(item => item.seq === numberOf(data['seq']));
			const outcome = stringOf(data['outcome']);
			if (member !== undefined && (outcome === 'completed' || outcome === 'cancelled' || outcome === 'failed')) {
				member.outcome = outcome;
			}
		} else if (type === 'tool-workflow/run-end') {
			const stop = stringOf(data['stopReason']);
			if (stop === 'completed' || stop === 'cancelled' || stop === 'error') {
				current.stopReason = stop;
			}
		}
	}
	const workflow = state.workflows.get(runId);
	if (workflow !== undefined) {
		put(state, `workflow:${runId}`, workflowNodeOf(runId, workflow));
	}
}

/** 折叠成官方 `WorkflowRunChatData`：阶段按首次出现分组，成员状态来自自身结算。 */
function workflowNodeOf(runId: string, workflow: DshIdeWorkflowState): DshIdeConversationNode {
	const status = workflow.stopReason === undefined
		? (workflow.interrupted === true ? 'interrupted' : 'running')
		: workflow.stopReason === 'completed' ? 'completed' : workflow.stopReason === 'cancelled' ? 'cancelled' : 'failed';
	const phases = new Map<string, { phase: string | null; members: { seq: number; label: string; childId: string; status: string }[] }>();
	for (const member of workflow.members) {
		const phase = member.phase === undefined ? null : member.phase;
		const key = phase === null ? 'missing' : `value:${phase.length}:${phase}`;
		const group = phases.get(key) ?? { phase, members: [] };
		phases.set(key, group);
		group.members.push({
			seq: member.seq,
			label: member.label,
			childId: member.childId,
			status: member.outcome === undefined ? (workflow.interrupted === true ? 'interrupted' : 'running') : member.outcome === 'failed' ? 'failed' : member.outcome,
		});
	}
	return {
		kind: 'workflow-run',
		seq: workflow.seq,
		time: workflow.time,
		turn: workflow.turn,
		runId,
		name: workflow.name,
		status,
		phases: [...phases].map(([key, group]) => ({ key, phase: group.phase, members: group.members })),
	} as DshIdeConversationNode;
}

/** 内容块里的纯文本；系统消息没有块时退回 `text` 字段。 */
function textOfContent(blocks: unknown): string | undefined {
	if (!Array.isArray(blocks)) {
		return undefined;
	}
	const texts = blocks.flatMap(block => isRecord(block) && typeof block['text'] === 'string' && block['text'] !== '' ? [block['text']] : []);
	return texts.length === 0 ? undefined : texts.join('\n');
}

/** `question-reply` 的题目：只留 id、题面与可选标题；带 plan-review intent 的整批交回普通工具卡。 */
function replyQuestionsOf(value: unknown): { readonly id: string; readonly question: string; readonly header?: string }[] | undefined {
	if (!isRecord(value) || !Array.isArray(value['questions']) || value['questions'].length === 0) {
		return undefined;
	}
	const ids = new Set<string>();
	const questions: { id: string; question: string; header?: string }[] = [];
	for (const item of value['questions']) {
		if (!isRecord(item)) {
			return undefined;
		}
		const id = stringOf(item['id']);
		const question = typeof item['question'] === 'string' ? item['question'] : undefined;
		const intent = isRecord(item['intent']) ? stringOf(item['intent']['kind']) : undefined;
		if (id === undefined || question === undefined || ids.has(id) || intent === 'plan-review') {
			return undefined;
		}
		ids.add(id);
		questions.push({ id, question, ...(stringOf(item['header']) === undefined ? {} : { header: stringOf(item['header']) }) });
	}
	return questions;
}

/** 回执正文：单条 text 块里的 JSON，且 `answers` 恰好覆盖整份题目、没有 `pending`。 */
function replyAnswersOf(
	text: string,
	questions: readonly { readonly id: string }[],
): readonly { readonly id: string; readonly selected: readonly string[]; readonly custom?: string }[] | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!isRecord(parsed) || parsed['pending'] === true || !Array.isArray(parsed['answers'])) {
		return undefined;
	}
	if (parsed['answers'].length !== questions.length) {
		return undefined;
	}
	const remaining = new Set(questions.map(question => question.id));
	const answers: { id: string; selected: readonly string[]; custom?: string }[] = [];
	for (const item of parsed['answers']) {
		if (!isRecord(item)) {
			return undefined;
		}
		const id = stringOf(item['id']);
		if (id === undefined || !remaining.delete(id) || !Array.isArray(item['selected']) || !item['selected'].every(selected => typeof selected === 'string')) {
			return undefined;
		}
		const custom = item['custom'];
		if (custom !== undefined && typeof custom !== 'string') {
			return undefined;
		}
		answers.push({ id, selected: item['selected'] as readonly string[], ...(custom === undefined ? {} : { custom }) });
	}
	return answers;
}

/** 单条 text 块的正文；多种块或没有正文都读不出回执。 */
function contentOf(blocks: unknown): string | undefined {
	if (!Array.isArray(blocks) || blocks.length !== 1) {
		return undefined;
	}
	const block = blocks[0];
	return isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string' ? block['text'] : undefined;
}

/** 同一次等待内作答：`tool/result` 的 JSON 回执。 */
function questionReplyOf(
	seq: number,
	time: number,
	turn: number,
	callId: string,
	argsRaw: string | undefined,
	text: string | undefined,
): DshIdeConversationNode | undefined {
	if (argsRaw === undefined || text === undefined) {
		return undefined;
	}
	let args: unknown;
	try {
		args = JSON.parse(argsRaw);
	} catch {
		return undefined;
	}
	const questions = replyQuestionsOf(args);
	if (questions === undefined) {
		return undefined;
	}
	const answers = replyAnswersOf(text, questions);
	if (answers === undefined) {
		return undefined;
	}
	return {
		kind: 'question-reply',
		seq,
		time,
		turn,
		callId,
		questions,
		answers,
		text,
	} as DshIdeConversationNode;
}

/** 迟到的人工回执：`source.kind === 'user-question-reply'` 的消息。 */
function lateQuestionReplyOf(
	seq: number,
	time: number,
	turn: number,
	source: Record<string, unknown>,
	content: readonly { readonly type?: string; readonly text?: string }[],
): DshIdeConversationNode | undefined {
	const callId = stringOf(source['callId']);
	if (callId === undefined || source['outcome'] !== 'answered' || content.length !== 1 || content[0]?.type !== 'text') {
		return undefined;
	}
	const text = content[0].text;
	if (typeof text !== 'string') {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}
	const questions = replyQuestionsOf(parsed);
	if (questions === undefined) {
		return undefined;
	}
	const answers = replyAnswersOf(text, questions);
	if (answers === undefined) {
		return undefined;
	}
	return { kind: 'question-reply', seq, time, turn, callId, questions, answers, text } as DshIdeConversationNode;
}

function put(state: DshIdeConversationState, id: string, node: DshIdeConversationNode): void {
	state.nodes.set(id, node);
}

// ---------------------------------------------------------------------------
// 形状读取
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 官方 `PresentedFile[]`：至少要有 `path`，`description` 可选。 */
function presentedFilesOf(value: unknown): { readonly path: string; readonly description?: string }[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const files: { readonly path: string; readonly description?: string }[] = [];
	for (const file of value) {
		if (!isRecord(file)) {
			continue;
		}
		const path = stringOf(file['path']);
		if (path === undefined) {
			continue;
		}
		const description = stringOf(file['description']);
		files.push({ path, ...(description === undefined ? {} : { description }) });
	}
	return files;
}

function stringOf(value: unknown): string | undefined {
	return typeof value === 'string' && value !== '' ? value : undefined;
}

function numberOf(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** 官方 `ContentBlock[]` → 协议子集；未知或形状不合的块直接丢弃。 */
function contentBlocksOf(value: unknown): DshIdeContentBlock[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const blocks: DshIdeContentBlock[] = [];
	for (const block of value) {
		if (!isRecord(block)) {
			continue;
		}
		const type = stringOf(block['type']);
		if (type === 'text' || type === 'reasoning') {
			const text = block['text'];
			if (typeof text === 'string') {
				blocks.push({ type, text });
			}
		} else if (type === 'image') {
			const attachment = imageRefOf(block['attachment']);
			if (attachment !== undefined) {
				blocks.push({ type: 'image', attachment });
			}
		} else if (type === 'file') {
			const attachment = fileRefOf(block['attachment']);
			if (attachment !== undefined) {
				blocks.push({ type: 'file', attachment });
			}
		} else if (type === 'tool-call') {
			const id = stringOf(block['id']);
			const name = stringOf(block['name']);
			if (id !== undefined && name !== undefined && typeof block['arguments'] === 'string') {
				blocks.push({ type: 'tool-call', id, name, arguments: block['arguments'] });
			}
		} else if (type === 'tool-addition' || type === 'tool-removal') {
			const toolName = stringOf(block['toolName']);
			if (toolName !== undefined) {
				blocks.push({ type, toolName });
			}
		}
	}
	return blocks;
}

/** 源 `ContentBlock[]` → `AssistantBlock[]`；`file` 与插件块一起落 `other`。 */
function assistantBlocksOf(value: unknown): DshIdeAssistantBlock[] {
	const blocks: DshIdeAssistantBlock[] = [];
	if (!Array.isArray(value)) {
		return blocks;
	}
	for (const block of value) {
		if (!isRecord(block)) {
			continue;
		}
		const type = stringOf(block['type']);
		if (type === 'text' || type === 'reasoning') {
			const text = block['text'];
			if (typeof text === 'string') {
				blocks.push({ kind: type, text });
			}
		} else if (type === 'image') {
			const attachment = imageRefOf(block['attachment']);
			if (attachment !== undefined) {
				blocks.push({ kind: 'image', attachment });
			}
		} else if (type === 'tool-call') {
			const id = stringOf(block['id']);
			const name = stringOf(block['name']);
			if (id !== undefined && name !== undefined && typeof block['arguments'] === 'string') {
				blocks.push({ kind: 'tool-call', callId: id, name, argsRaw: block['arguments'] });
			}
		} else {
			// 真源 `AssistantBlock` 没有 `file`，`file` 与所有插件块一起落 `other` 原样保留。
			blocks.push({ kind: 'other', block });
		}
	}
	return blocks;
}

function imageRefOf(value: unknown): DshIdeImageAttachmentRef | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const attachmentId = stringOf(value['attachmentId']);
	const mediaType = value['mediaType'];
	if (attachmentId === undefined) {
		return undefined;
	}
	if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp' && mediaType !== 'image/gif') {
		return undefined;
	}
	const bytes = value['bytes'];
	const width = value['width'];
	const height = value['height'];
	if (typeof bytes !== 'number' || typeof width !== 'number' || typeof height !== 'number') {
		return undefined;
	}
	if (!Number.isSafeInteger(bytes) || bytes <= 0 || !Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
		return undefined;
	}
	const name = stringOf(value['name']);
	const original = isRecord(value['originalDimensions']) ? value['originalDimensions'] : undefined;
	const originalWidth = original === undefined ? undefined : original['width'];
	const originalHeight = original === undefined ? undefined : original['height'];
	return {
		attachmentId,
		mediaType,
		bytes,
		width,
		height,
		...(name === undefined ? {} : { name }),
		...(typeof originalWidth === 'number' && typeof originalHeight === 'number'
			&& Number.isSafeInteger(originalWidth) && originalWidth > 0 && Number.isSafeInteger(originalHeight) && originalHeight > 0
			? { originalDimensions: { width: originalWidth, height: originalHeight } }
			: {}),
	};
}

function fileRefOf(value: unknown): { attachmentId: string; name: string; bytes: number } | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const attachmentId = stringOf(value['attachmentId']);
	const name = stringOf(value['name']);
	const bytes = value['bytes'];
	if (attachmentId === undefined || name === undefined) {
		return undefined;
	}
	if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0) {
		return undefined;
	}
	return { attachmentId, name, bytes };
}

/** DSH `event-projection.ts:47-53`：只放行 Chat 认得的 form，其余保持不透明。 */
const KNOWN_CONTEXT_FORMS: readonly string[] = ['instructions', 'catalog', 'snapshot', 'notice', 'relay', 'recall'];

function contextFormOf(source: unknown): string | null {
	const record = isRecord(source) ? source : undefined;
	const form = record === undefined ? undefined : stringOf(record['form']);
	return form !== undefined && KNOWN_CONTEXT_FORMS.includes(form) ? form : null;
}

/**
 * 对应官方 `event-projection.ts` 的 `contextProducer`：把 durable `source.kind`
 * 投影成渲染层的角色与标签。未知 producer 保留其 kind 作标签，不隐藏。
 */
function contextProducerOf(source: unknown): { readonly role: string; readonly label: string | null } {
	const record = isRecord(source) ? source : undefined;
	const kind = record === undefined ? undefined : stringOf(record['kind']);
	if (record === undefined || kind === undefined) {
		return { role: 'inject', label: null };
	}
	switch (kind) {
		case 'session-reference': {
			const labels = collectLabels(record['references']);
			return { role: 'recall', label: labels.length > 0 ? labels.join(', ') : kind };
		}
		case 'agent-instructions': {
			const labels = collectLabels(record['changes'], 'path');
			return { role: 'inject', label: labels.length > 0 ? labels.join(', ') : kind };
		}
		case 'skill-invocation':
			return { role: 'inject', label: stringOf(record['name']) ?? kind };
		default:
			return { role: 'inject', label: kind };
	}
}

/** 取一组记录里的 `label`（缺省回落到 `field`）并去重，对应官方 `collect()`。 */
function collectLabels(value: unknown, field = 'label'): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const seen: string[] = [];
	for (const entry of value) {
		const record = isRecord(entry) ? entry : undefined;
		const text = record === undefined ? undefined : stringOf(record[field]);
		if (text !== undefined && !seen.includes(text)) {
			seen.push(text);
		}
	}
	return seen;
}

function tokenUsageOf(value: Record<string, unknown>): DshIdeTokenUsageDelta | undefined {
	const inputTokens = numberOf(value['inputTokens']);
	const outputTokens = numberOf(value['outputTokens']);
	if (inputTokens === undefined || outputTokens === undefined) {
		return undefined;
	}
	return {
		inputTokens,
		outputTokens,
		...(numberOf(value['totalTokens']) === undefined ? {} : { totalTokens: numberOf(value['totalTokens']) }),
		...(numberOf(value['cacheReadTokens']) === undefined ? {} : { cacheReadTokens: numberOf(value['cacheReadTokens']) }),
		...(numberOf(value['cacheWriteTokens']) === undefined ? {} : { cacheWriteTokens: numberOf(value['cacheWriteTokens']) }),
		...(numberOf(value['reasoningTokens']) === undefined ? {} : { reasoningTokens: numberOf(value['reasoningTokens']) }),
	};
}

/**
 * 官方 `lastAssistantStreamChunk(stream, 'usage')?.usage`：取流里**最后**一个 usage chunk。
 *
 * 为什么必须是最后一个：`assistant/attempt` 的 stream 会带若干 sampling 片段，用量只随
 * 最终 settlement 更新；取第一个会把中途样本当成总量。
 * 形状（官方 `AssistantStreamChunk`）：`[{ type: 'usage', usage: {...} }, ...]`；
 * 也接受已被包成 `{ chunk: {...} }` 的变体，两种都在 `stream` 数组里见到过。
 */
function streamUsageOf(stream: unknown): Record<string, unknown> | undefined {
	if (!Array.isArray(stream)) {
		return undefined;
	}
	for (let index = stream.length - 1; index >= 0; index--) {
		const chunk = stream[index];
		const candidate = isRecord(chunk) && isRecord(chunk['chunk']) ? chunk['chunk'] : chunk;
		if (!isRecord(candidate) || candidate['type'] !== 'usage') {
			continue;
		}
		const usage = candidate['usage'];
		if (isRecord(usage)) {
			return usage;
		}
	}
	return undefined;
}

function providerMetadataOf(value: unknown): { provider: string; model: string } | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const provider = stringOf(value['provider']);
	const model = stringOf(value['model']);
	return provider === undefined || model === undefined ? undefined : { provider, model };
}

function failureOf(value: unknown): { message: string; code?: string } | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const message = typeof value['message'] === 'string' && value['message'] !== '' ? value['message'] : 'unknown';
	return {
		message,
		...(stringOf(value['code']) === undefined ? {} : { code: stringOf(value['code']) }),
	};
}

function errorOf(value: unknown): { name: string; code: string; reason?: string } | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const name = stringOf(value['name']);
	const code = stringOf(value['code']);
	if (name === undefined || code === undefined) {
		return undefined;
	}
	return {
		name,
		code,
		...(stringOf(value['reason']) === undefined ? {} : { reason: stringOf(value['reason']) }),
	};
}

/** PTC 子调用挂在父调用的 `subCalls` 上；按同一形状递归解码。 */
function decodeToolCallBlock(value: unknown): DshIdeConversationNode[] {
	if (!isRecord(value)) {
		return [];
	}
	const callId = stringOf(value['callId']);
	if (callId === undefined) {
		return [];
	}
	const subCalls = Array.isArray(value['subCalls']) ? value['subCalls'].flatMap(child => decodeToolCallBlock(child)) : [];
	const seq = numberOf(value['seq']) ?? 0;
	const time = numberOf(value['time']) ?? 0;
	const hasResult = value['kind'] === 'tool-result' || value['content'] !== undefined;
	if (hasResult) {
		const call = isRecord(value['call']) ? value['call'] : undefined;
		const name = call === undefined ? stringOf(value['name']) ?? '' : stringOf(call['name']) ?? '';
		return [{
			kind: 'tool-result',
			seq,
			time,
			callId,
			name,
			args: value['args'] ?? null,
			...(call === undefined || name === '' ? { call: null } : { call: { name, argsRaw: stringOf(call['argsRaw']) ?? '' } }),
			content: contentBlocksOf(value['content']),
			isError: value['isError'] === true,
			subCalls,
		}];
	}
	const phase = value['phase'] === 'preparing' ? 'preparing' : 'start';
	return [{
		kind: 'tool-call',
		seq,
		time,
		callId,
		name: stringOf(value['name']) ?? '',
		phase,
		...(typeof value['argsRaw'] === 'string' ? { argsRaw: value['argsRaw'] } : {}),
	}];
}

/** 流式 chunk 追加：`text-delta` / `reasoning-delta`。 */
function appendChunk(blocks: DshAssistantBlock[], chunk: Record<string, unknown>): void {
	const type = stringOf(chunk['type']);
	const text = typeof chunk['text'] === 'string' ? chunk['text'] : undefined;
	if (text === undefined) {
		return;
	}
	const kind = type === 'reasoning-delta' ? 'reasoning' : type === 'text-delta' ? 'text' : undefined;
	if (kind === undefined) {
		return;
	}
	const last = blocks[blocks.length - 1];
	if (last !== undefined && last.kind === kind) {
		blocks[blocks.length - 1] = { kind, text: last.text + text };
		return;
	}
	blocks.push({ kind, text });
}
