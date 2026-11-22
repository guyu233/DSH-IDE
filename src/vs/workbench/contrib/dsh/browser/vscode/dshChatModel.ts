/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 会话帧 → 聊天记录。**不翻译、不转换、不投影**：形状就是 DSH 自己的。
//
// 依据（https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/client/ui-conversation/src/client/contract/records.ts）：
//   - 用户消息 = `UserMessageNode`：{ kind:'user', seq, time, content: readonly ContentBlock[] }
//   - 助手消息 = `AssistantMessageNode`：{ kind:'assistant', seq, time, turn, step,
//     blocks: readonly AssistantBlock[], usage?, providerMetadata?, requestConfig? }
//   - `AssistantBlock` = text | reasoning | image | tool-call | other
//
// 帧来自内核那一次 `sessionController.follow`：`snapshot`（历史）+ `event`（增量）+
// `assistant-stream`（正在吐的字）。这里只做「同 identity 合并 / 按 revision 去重」，
// 字段一个不改、一个不加。读不懂的帧丢弃。
//
// 边界：零 `@deepseek-ai/*` import（workbench 层），只按 DSH 的公开类型形状窄化。

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { createDshIdeConversationState, projectDshIdeConversation } from '../../../../../platform/dshClient/protocol/dshIdeConversation.js';
import type { DshIdeConversationNode, DshIdeConversationView, DshIdeInboxMessage, DshIdeLoadOlderPage } from '../../../../../platform/dshClient/protocol/dshIdeProtocol.js';

/**
 * DSH 的全部会话节点与内容块。
 *
 * **一个都不丢**：真源是
 *   - `packages/llm/llm/src/types.ts`（`ContentBlock`：text / reasoning / image / file /
 *     tool-call / tool-addition / tool-removal）
 *   - `packages/client/ui-conversation/src/client/contract/records.ts`（会话节点）
 *   - `packages/client/ui-chat/src/client/contract/chat-nodes.ts`（Chat 渲染单元）
 * 未知形状一律落 `other` / `unknown` 原样保留，绝不因为读不懂就把内容从画面上抹掉。
 */

/** DSH `ContentBlock`：文本。 */
export interface DshTextBlock { readonly type: 'text'; readonly text: string }
/** DSH `ContentBlock`：思考。 */
export interface DshReasoningBlock { readonly type: 'reasoning'; readonly text: string }
/** DSH `ContentBlock`：图片附件。 */
export interface DshImageBlock { readonly type: 'image'; readonly attachment: unknown }
/** DSH `ContentBlock`：文件附件（`FileBlock`）。 */
export interface DshFileBlock { readonly type: 'file'; readonly attachment: unknown }
/** DSH `ContentBlock`：工具调用（内容块，区别于下面的工具节点）。 */
export interface DshToolCallContentBlock { readonly type: 'tool-call'; readonly id: string; readonly name: string; readonly arguments: string }
/** DSH `ContentBlock`：工具定义增删（developer 消息用，不直接画）。 */
export interface DshToolChangeBlock { readonly type: 'tool-addition' | 'tool-removal'; readonly toolName: string }
/**
 * 未识别的内容块：原样保留。
 *
 * 真源 `ContentBlockMap` 是 merge-extensible（插件可扩），未知 `type` 不能被丢弃。
 * 用**独立**的 `plugin` 判别值承载真实 `type`，而不是把 `type` 放宽成 `string`——
 * 后者会破坏整个 `ContentBlock` 判别联合的收窄，让所有 `case` 分支失去类型。
 */
export interface DshPluginBlock { readonly type: 'plugin'; readonly pluginType: string; readonly block: unknown }

/** DSH `ContentBlock` 全集（`plugin` 是本地为 merge-extensible 未知块保留的判别值）。 */
export type DshContentBlock =
	| DshTextBlock
	| DshReasoningBlock
	| DshImageBlock
	| DshFileBlock
	| DshToolCallContentBlock
	| DshToolChangeBlock
	| DshPluginBlock;

/**
 * DSH `AssistantBlock`（`ui-conversation/.../contract/records.ts:34-39`）：已定型的助手内容块。
 *
 * 逐字对齐真源：真源只有 text / reasoning / image / tool-call / other 五类，
 * **没有** `file`（`file` 只出现在 `ContentBlock`，经 `toAssistantBlock` 落进 `other`）。
 * `tool-call` 的 `callId`/`argsRaw` 也是真源自己的命名（`event-projection.ts:119`），
 * 不是本层擅自改名。
 */
export type DshAssistantBlock =
	| { readonly kind: 'text'; readonly text: string }
	| { readonly kind: 'reasoning'; readonly text: string }
	| { readonly kind: 'image'; readonly attachment: unknown }
	| { readonly kind: 'tool-call'; readonly callId: string; readonly name: string; readonly argsRaw: string }
	| { readonly kind: 'other'; readonly block: unknown };

/**
 * 所有节点共有的定位字段。
 *
 * `raw` 是**源载荷原样**（DSH 事件信封 `{ seq, time, type, data }`，或流式帧本体）。
 * 它是「不增不减」的唯一真值：任何渲染、校验、回读都以 `raw` 的 canonical 序列化为准，
 * 而不是以本层重建出来的 typed 字段为准——typed 字段只是给渲染层用的便捷投影，
 * 一旦两者不一致，以 `raw` 为准。
 */
interface DshNodeBase {
	readonly seq: number;
	readonly time: number;
	readonly messageId?: string;
	/** 源载荷原样；undefined 仅用于本层合成的流式临时节点。 */
	readonly raw?: unknown;
}

/** DSH `UserMessageNode`：人写的消息。 */
export interface DshUserMessageNode extends DshNodeBase {
	readonly kind: 'user';
	readonly content: readonly DshContentBlock[];
	readonly source?: unknown;
	readonly turn?: number;
}

/** DSH `SteeringMessageNode`：运行中被插入的消息。 */
export interface DshSteeringMessageNode extends DshNodeBase {
	readonly kind: 'steering';
	readonly content: readonly DshContentBlock[];
	readonly source?: unknown;
	readonly turn?: number;
}

/** DSH `ContextMessageNode`：注入的上下文（指令 / 目录 / 回放 / 通知…）。 */
export interface DshContextMessageNode extends DshNodeBase {
	readonly kind: 'context';
	readonly content: readonly DshContentBlock[];
	readonly source?: unknown;
	readonly producer?: unknown;
	readonly form?: string | null;
	readonly turn?: number;
}

/** DSH `AssistantMessageNode`：助手消息（含中断冻结的前缀）。 */
export interface DshAssistantMessageNode extends DshNodeBase {
	readonly kind: 'assistant';
	readonly turn: number;
	readonly step: number;
	readonly blocks: readonly DshAssistantBlock[];
	readonly usage?: unknown;
	readonly providerMetadata?: { readonly provider: string; readonly model: string };
	readonly requestConfig?: unknown;
	readonly timing?: unknown;
	readonly interrupted?: true;
}

/** DSH `ToolResultNode`：工具结果（含递归子调用）。 */
export interface DshToolResultNode extends DshNodeBase {
	readonly kind: 'tool-result';
	readonly callId: string;
	readonly parentCallId?: string;
	readonly name: string;
	/** 真源必填（`records.ts:174` `ToolArgs`）；缺窗口时为空视图而不是省略字段。 */
	readonly args: unknown;
	readonly call?: { readonly name: string; readonly argsRaw: string } | null;
	readonly callTime?: number | null;
	readonly content: readonly DshContentBlock[];
	readonly isError: boolean;
	readonly error?: { readonly name: string; readonly code: string; readonly reason?: string };
	readonly meta?: unknown;
	readonly subCalls: readonly DshToolCallBlock[];
	readonly turn?: number;
}

/** 运行中的工具调用（preparing / start）。DSH `RunningToolCall`。 */
export interface DshRunningToolCall extends DshNodeBase {
	readonly kind: 'tool-call';
	readonly callId: string;
	readonly parentCallId?: string;
	readonly name: string;
	readonly phase: 'preparing' | 'start';
	readonly argsRaw?: string;
	readonly args?: unknown;
	readonly turn?: number;
	readonly step?: number;
	readonly subCalls?: readonly DshToolCallBlock[];
}

/** 工具调用块全集（运行中或已结果）。 */
export type DshToolCallBlock = DshRunningToolCall | DshToolResultNode;

/** DSH `CommandNode`：斜杠命令的生命周期。 */
export interface DshCommandNode extends DshNodeBase {
	readonly kind: 'command';
	readonly commandId: string;
	readonly name: string | null;
	readonly args: string | null;
	readonly outcome: { readonly kind: 'success' | 'error'; readonly text?: string } | null;
	readonly turn?: number;
}

/** DSH `CompactionSummaryNode`：压缩检查点。 */
export interface DshCompactionNode extends DshNodeBase {
	readonly kind: 'compaction';
	readonly summary: string | null;
	readonly summaryEventSeq?: number | null;
	readonly shadowedItemCount?: number | null;
	readonly shadowedTokenCount?: number | null;
	readonly turn?: number;
}

/** DSH `ModelRetryNode`：模型重试链的一环（字段对齐 `llm-retry/src/types.ts:15-40`）。 */
export interface DshModelRetryNode extends DshNodeBase {
	readonly kind: 'model-retry';
	readonly retry?: number;
	readonly maxRetries?: number;
	readonly delayMs?: number;
	/** 真源只有 `normal` / `always` 两种；旧的 `infinite` 是本地误写。 */
	readonly mode?: 'normal' | 'always';
	readonly retryState?: 'scheduled' | 'started' | 'cancelled';
	readonly failure?: { readonly message: string; readonly code?: string };
	readonly turn?: number;
}

/** DSH `TurnErrorNode`：回合终态错误。 */
export interface DshTurnErrorNode extends DshNodeBase {
	readonly kind: 'turn-error';
	readonly turn: number;
	readonly step: number;
	readonly message: string;
	readonly code?: string;
}

/** DSH `TurnMaxTokensNode`：回合因输出上限结束。 */
export interface DshTurnMaxTokensNode extends DshNodeBase {
	readonly kind: 'turn-max-tokens';
	readonly turn: number;
	readonly step: number;
}

/** DSH `UnknownSurfaceNode`：未识别但必须保留的会话事件。 */
export interface DshUnknownSurfaceNode extends DshNodeBase {
	readonly kind: 'unknown';
	readonly type: string;
	readonly data: unknown;
	readonly turn?: number;
}

/**
 * DSH `inherited-history`：fork 会话的分界行。
 *
 * 不是 `ConversationNode` 成员（真源 `records.ts:258-270` 只有 11 类），而是 ui-chat 层
 * 由 `session/end-seed`（`inherited === true`）合成的 Chat 节点
 * （`conversation-nodes/inherited-history.ts:18-33`）。单列一类以便校验基准分层。
 */
export interface DshInheritedHistoryNode extends DshNodeBase {
	readonly kind: 'inherited-history';
	readonly turn?: number;
}

/**
 * 官方 `turn-trigger`：非人类消息被认领为开启一个 Turn 时的呈现。
 *
 * 真源 `message.ts` 的 `buildViewNode` 只在 `waking === true` 或
 * `source.kind === 'retry'` 且 content 为空时产出它。`source` 原样保留，
 * 渲染层按 `source.kind` 选图标（`turn-trigger.ts` 的 `turnTriggerDetails`）。
 */
export interface DshTurnTriggerNode extends DshNodeBase {
	readonly kind: 'turn-trigger';
	readonly content: readonly DshContentBlock[];
	readonly source?: unknown;
	readonly producer?: { readonly role: string; readonly label: string | null };
	readonly form?: string | null;
	readonly turn?: number;
}

/** DSH `manual-compaction`（官方 `ui-chat`）：`/compact` 命令行与它产生的压缩检查点。 */
export interface DshManualCompactionNode extends DshNodeBase {
	readonly kind: 'manual-compaction';
	readonly command: {
		readonly commandId: string;
		readonly name: string | null;
		readonly args: string | null;
		readonly outcome: { readonly kind: 'success' | 'error'; readonly text?: string } | null;
	};
	readonly compaction: {
		readonly summary: string | null;
		readonly shadowedItemCount?: number | null;
		readonly shadowedTokenCount?: number | null;
	};
}

/** DSH `turn-tail`（官方 `ui-chat`）：已完成 Turn 的动作行与尾部事实。 */
export interface DshTurnTailNode extends DshNodeBase {
	readonly kind: 'turn-tail';
	readonly turn: number;
	readonly closing?: string;
	/** 收尾答复那条 durable 消息的 messageId；官方用它给动作行寻址。 */
	readonly closingMessageId?: string;
	readonly branchUnavailable?: true;
}

/** DSH `system-prompt`（官方 `ui-chat`）：一次请求的完整系统提示，或历史内的提示更新。 */
export interface DshSystemPromptNode extends DshNodeBase {
	readonly kind: 'system-prompt';
	readonly text: string;
	readonly update?: true;
}

/** DSH `workflow-run`（官方 `ui-workflow-run`）：顶层运行与实际启动的成员。 */
export interface DshWorkflowRunNode extends DshNodeBase {
	readonly kind: 'workflow-run';
	readonly runId: string;
	readonly name: string;
	readonly status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
	readonly phases: readonly {
		readonly key: string;
		readonly phase: string | null;
		readonly members: readonly { readonly seq: number; readonly label: string; readonly childId: string; readonly status: string }[];
	}[];
	readonly turn?: number;
}

/** DSH `submitted-plan`（官方 `ui-plan`）：`exit_plan_mode` 提交的完整计划。 */
export interface DshSubmittedPlanNode extends DshNodeBase {
	readonly kind: 'submitted-plan';
	readonly callId: string;
	readonly title: string;
	readonly markdown: string;
	readonly turn?: number;
}

/** DSH `command-input`（官方 `ui-goal`）：人工输入的 `/goal` 命令行。 */
export interface DshCommandInputNode extends DshNodeBase {
	readonly kind: 'command-input';
	readonly commandId: string;
	readonly text: string;
}

/** DSH `question-reply`（官方 `ui-user-questions`）：一次已作答问卷的回执。 */
export interface DshQuestionReplyNode extends DshNodeBase {
	readonly kind: 'question-reply';
	readonly callId: string;
	readonly questions: readonly { readonly id: string; readonly question: string; readonly header?: string }[];
	readonly answers: readonly { readonly id: string; readonly selected: readonly string[]; readonly custom?: string }[];
	readonly text: string;
	readonly turn?: number;
}

/** 聊天里的全部节点（DSH 的完整集合，一个都不丢）。 */
export type DshChatNode =
	| DshUserMessageNode
	| DshSteeringMessageNode
	| DshContextMessageNode
	| DshAssistantMessageNode
	| DshToolCallBlock
	| DshCommandNode
	| DshCompactionNode
	| DshModelRetryNode
	| DshTurnErrorNode
	| DshTurnMaxTokensNode
	| DshUnknownSurfaceNode
	| DshInheritedHistoryNode
	| DshTurnTriggerNode
	| DshQuestionReplyNode
	| DshCommandInputNode
	| DshSubmittedPlanNode
	| DshWorkflowRunNode
	| DshSystemPromptNode
	| DshTurnTailNode
	| DshManualCompactionNode;

export interface DshChatChange {
	readonly node: DshChatNode;
	/** true = 新节点，false = 同 identity 原位更新。 */
	readonly added: boolean;
}

/** 历史翻页请求的状态。模型不发请求，只保存会话层写入的值。 */
export type DshHistoryStatus = 'idle' | 'loading' | 'error';

/** `prependPage` 的结果。`conflicts` 是同 seq 载荷不一致、因而未替换的条数。 */
export interface DshHistoryPrepend {
	readonly added: number;
	readonly firstSeq?: number;
	readonly hasMore: boolean;
	readonly conflicts: number;
}

/**
 * 会话帧解码器：produce DSH 的 `UserMessageNode` / `AssistantMessageNode`。
 *
 * 唯一的加工是流式合并：同一个 attempt 的 token 追加到同一条 assistant 节点，
 * 结算后由 durable `assistant/message` 接管。除此之外不改任何字段。
 */
export class DshChatModel extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<readonly DshChatChange[]>());
	private readonly _onDidReset = this._register(new Emitter<void>());
	readonly onDidChange: Event<readonly DshChatChange[]> = this._onDidChange.event;
	readonly onDidReset: Event<void> = this._onDidReset.event;

	/** 全会话 token 用量累加（来自每条 `assistant/message` 的 `usage`）。 */
	private readonly usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
	/** 是否见过任何一条带 `usage` 的助手消息（区分「0」与「没有投影」）。 */
	private usageSeen = false;


	/**
	 * 开口 snapshot 之前未知，允许再要一页。
	 *
	 * 只在「确知没有更早记录」时置 false，并且**不再翻回 true**：已经读到头的会话
	 * 不会因为后续实时帧自称还有更多而重新开始翻页。换绑（`clear`）才复位。
	 */
	private _hasMore = true;
	/** 官方 `inbox` 投影的 `next-turn`：排队等下一个 Turn 的输入（含内容块）。 */
	private _inboxNextTurn: readonly DshIdeInboxMessage[] = [];
	/** 官方 `inbox` 投影的 `next-step`：排队等下一个 step 的转向输入。 */
	private _inboxNextStep: readonly DshIdeInboxMessage[] = [];
	/**
	 * 已读到的最早 durable seq（含已被实时窗口替换掉的旧页）。
	 *
	 * 分页游标不能只看当前可见节点：实时窗口会把旧页挤出画面，若游标随之下移，
	 * 下一次 `loadOlder` 会从更晚的位置重取，已读内容看起来「消失」了。
	 * 这个边界只前进（变小），换绑时复位。
	 */
	private durableFloor: number | undefined;
	/** 翻页请求的状态。模型不发请求，只记下会话层报来的状态。 */
	private _historyStatus: DshHistoryStatus = 'idle';
	private readonly _onDidChangeHistory = this._register(new Emitter<void>());
	readonly onDidChangeHistory: Event<void> = this._onDidChangeHistory.event;

	/** 按 identity 索引：durable 用 `seq:<n>`，流式用 `stream:<attemptId>`。 */
	private readonly nodes = new Map<string, DshChatNode>();
	/**
	 * 由 `loadOlder` 读入的旧页。
	 *
	 * 与实时窗口分开存放：实时帧只替换「当前这一段」，翻页读到的更早记录不随之消失。
	 * 两者在 `list` 里按 seq 合并，identity 冲突时实时窗口优先。
	 */
	private readonly olderNodes = new Map<string, DshChatNode>();

	/**
	 * 带 Turn/Step 坐标的节点列表。
	 *
	 * 顺序就是 DSH 的画面顺序：按 seq 升序。Turn/Step 直接读节点自带值——
	 * Host 投影器已经把官方事件装配成带坐标的节点，本层不再扫原始事件。
	 */
	get located(): readonly { node: DshChatNode; turn?: number; step?: number }[] {
		return this.list.map(node => {
			const ownTurn = (node as { turn?: unknown }).turn;
			const ownStep = (node as { step?: unknown }).step;
			return {
				node,
				...(typeof ownTurn === 'number' ? { turn: ownTurn } : {}),
				...(typeof ownStep === 'number' ? { step: ownStep } : {}),
			};
		});
	}

	/** 按 seq 升序（DSH 的会话日志顺序）。实时窗口与已读旧页合并，同 identity 以实时窗口为准。 */
	get list(): readonly DshChatNode[] {
		// 这个 getter 每帧会被 `toHistory` 读一次，而它内部要合并两份 Map 再全量排序。
		// 节点没变时复用上一次的结果：会话越长，排序越贵。
		if (this._listCache !== undefined && this._listVersion === this._nodesVersion) {
			return this._listCache;
		}
		const merged = new Map<string, DshChatNode>(this.olderNodes);
		for (const [id, node] of this.nodes) {
			merged.set(id, node);
		}
		const sorted = [...merged.values()].sort((a, b) => a.seq - b.seq);
		this._listCache = sorted;
		this._listVersion = this._nodesVersion;
		return sorted;
	}

	/** 节点集合每变一次就递增；`list` 据此判断能否复用缓存。 */
	private _nodesVersion = 0;
	private _listVersion = -1;
	private _listCache: readonly DshChatNode[] | undefined;

	/**
	 * 整个会话的 token 用量。
	 *
	 * 逐条累加 `assistant/message.usage`（DSH 的 `TokenUsage`），
	 * `uncachedInputTokens` 按 DSH 投影的定义拆出来：
	 * `inputTokens - cacheReadTokens - cacheWriteTokens`（三个桶互斥）。
	 * 没有任何一条消息带 usage 时返回 undefined —— 用量条据此隐藏，
	 * 而不是显示一个假的 0。
	 */
	tokenUsage(): { uncachedInputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number } | undefined {
		if (!this.usageSeen) {
			return undefined;
		}
		const cached = this.usage.cacheReadTokens + this.usage.cacheWriteTokens;
		return {
			uncachedInputTokens: Math.max(0, this.usage.inputTokens - cached),
			cacheReadTokens: this.usage.cacheReadTokens,
			cacheWriteTokens: this.usage.cacheWriteTokens,
			outputTokens: this.usage.outputTokens,
		};
	}

	/**
	 * 兼容入口：只接受已经投影好的结构化会话。
	 *
	 * 按手册 §5.4，模型层不再解析裸 follow 帧。传入裸帧会返回空变更，
	 * 由调用方改走 `acceptView(snapshot.conversation)`。
	 */
	accept(frame: Readonly<Record<string, unknown>>): readonly DshChatChange[] {
		void frame;
		return [];
	}

	/**
	 * 接受 Host 投影好的结构化会话。
	 *
	 * Host 已经把官方事件装配成 `DshIdeConversationNode[]`，这里只做节点类型到
	 * `DshChatNode` 的机械映射，不再解析裸帧、不再自己拼装。
	 */
	acceptConversation(conversation: DshIdeConversationView): readonly DshChatChange[] {
		// 实时窗口是「当前这一段」，不是整条日志：已读的更早页必须留下。
		// 只有严格早于实时窗口最小 seq 的节点才保留；窗口内的旧版本一律被新帧替换。
		const mappedLive: { identity: string; node: DshChatNode; usage?: DshIdeConversationNode & { readonly kind: 'assistant' } }[] = [];
		let liveMin: number | undefined;
		for (const node of conversation.nodes) {
			const mapped = fromConversationNode(node);
			if (mapped === undefined) {
				continue;
			}
			mappedLive.push({
				identity: identityOf(node),
				node: mapped,
				...(node.kind === 'assistant' ? { usage: node } : {}),
			});
			if (liveMin === undefined || mapped.seq < liveMin) {
				liveMin = mapped.seq;
			}
		}
		// 实时窗口整体替换上一窗口；只有 `loadOlder` 读入的旧页跨帧保留。
		// 两者分开存放正是为了区分「窗口内容」与「翻页历史」。
		// 用量随实时窗口重算：旧页只影响画面，不参与这次累加。
		this.usage.inputTokens = 0;
		this.usage.outputTokens = 0;
		this.usage.cacheReadTokens = 0;
		this.usage.cacheWriteTokens = 0;
		this.usageSeen = false;
		this.nodes.clear();
		this._nodesVersion++;
		// 已经读到日志开头就不再翻页：实时帧自称「还有更多」不能把它翻回 true。
		this._hasMore = this._hasMore && conversation.hasMore;
		// 队列随每次会话帧整体替换（官方 `inbox` 是 fold 出来的完整值，不是增量）。
		this._inboxNextTurn = conversation.inboxNextTurn ?? [];
		this._inboxNextStep = conversation.inboxNextStep ?? [];
		// 分页边界只前进：实时窗口把旧页挤出画面时，游标仍停在已读到的最早 seq。
		if (liveMin !== undefined && (this.durableFloor === undefined || liveMin < this.durableFloor)) {
			this.durableFloor = liveMin;
		}
		const changes: DshChatChange[] = [];
		for (const live of mappedLive) {
			const replaced = this.nodes.has(live.identity);
			this.nodes.set(live.identity, live.node);
			this._nodesVersion++;
			if (live.usage !== undefined && live.usage.usage !== undefined) {
				this.usageSeen = true;
				this.usage.inputTokens += live.usage.usage.inputTokens;
				this.usage.outputTokens += live.usage.usage.outputTokens;
				this.usage.cacheReadTokens += live.usage.usage.cacheReadTokens ?? 0;
				this.usage.cacheWriteTokens += live.usage.usage.cacheWriteTokens ?? 0;
			}
			changes.push({ node: live.node, added: !replaced });
		}
		if (changes.length > 0) {
			this._onDidChange.fire(changes);
		}
		return changes;
	}

	/**
	 * 已加载内容里最小的 seq。没有内容时为 undefined，调用方省略 beforeSeq。
	 *
	 * 只看已投影的节点：模型层不再持有原始事件，节点 seq 就是分页游标的唯一来源。
	 */
	firstSeq(): number | undefined {
		let min: number | undefined;
		// 流式临时节点的 seq 是合成值，不参与历史游标：按 identity 过滤。
		// 不在这里合并成新 Map：这个方法在补历史时每页要问两次，合并一份全量副本
		// 是纯浪费。两处各自遍历，取更小的那个即可。
		const consider = (id: string, node: DshChatNode): void => {
			if (id.startsWith(STREAM_NODE_PREFIX)) {
				return;
			}
			if (min === undefined || node.seq < min) {
				min = node.seq;
			}
		};
		for (const [id, node] of this.olderNodes) {
			consider(id, node);
		}
		for (const [id, node] of this.nodes) {
			consider(id, node);
		}
		return min;
	}

	/**
	 * 下一次翻页要用的游标：已读到的最早 durable seq。
	 *
	 * 与 `firstSeq()` 的区别是本值不受实时窗口滑动影响——旧页被挤出画面后，
	 * 从 `firstSeq()` 重新取会漏掉中间那段记录。
	 */
	pagingCursor(): number | undefined {
		return this.durableFloor;
	}

	/** 官方分页是否还有更早的记录。 */
	/** 当前排队等下一个 Turn 的输入（官方 `inbox['next-turn']`）。 */
	inboxNextTurn(): readonly DshIdeInboxMessage[] {
		return this._inboxNextTurn;
	}

	/** 当前排队等下一个 step 的转向输入（官方 `inbox['next-step']`）。 */
	inboxNextStep(): readonly DshIdeInboxMessage[] {
		return this._inboxNextStep;
	}

	hasMore(): boolean {
		return this._hasMore;
	}

	historyStatus(): DshHistoryStatus {
		return this._historyStatus;
	}

	/** 会话层在发出 loadOlder 前后写入。相同状态不重复通知。 */
	setHistoryStatus(status: DshHistoryStatus): void {
		if (this._historyStatus === status) {
			return;
		}
		this._historyStatus = status;
		this._onDidChangeHistory.fire();
	}

	/**
	 * 把一页更早的官方历史并进当前模型。
	 *
	 * `records` 是官方 `{ type:'event', event }` 分页记录。这里用 Host 同一套
	 * `projectDshIdeConversation` 把这一页投影成结构化节点再并入，**不解析裸 follow 帧**。
	 * 只收 seq 严格小于当前最小 seq 的记录；已有 seq 不覆盖，载荷不同只计数。
	 */
	prependPage(page: DshIdeLoadOlderPage): DshHistoryPrepend {
		const floor = this.firstSeq();
		const accepted: Record<string, unknown>[] = [];
		let conflicts = 0;
		const seenSeq = new Set<number>();
		for (const record of page.records) {
			if (!isRecord(record) || record['type'] !== 'event' || !isRecord(record['event'])) {
				continue;
			}
			const event = record['event'];
			const seq = numberOf(event['seq']);
			const type = stringOf(event['type']);
			if (seq === undefined || type === undefined) {
				continue;
			}
			if (floor !== undefined && seq >= floor) {
				continue;
			}
			// 同页内重复 seq：载荷不一致只计冲突，不重复并入。
			if (seenSeq.has(seq)) {
				conflicts++;
				continue;
			}
			seenSeq.add(seq);
			accepted.push(event);
		}
		accepted.sort((a, b) => (numberOf(a['seq']) ?? 0) - (numberOf(b['seq']) ?? 0));
		// 边界随已并入的最早 seq 前进；空页不改边界（没有新证据）。
		for (const event of accepted) {
			const seq = numberOf(event['seq']);
			if (seq !== undefined && (this.durableFloor === undefined || seq < this.durableFloor)) {
				this.durableFloor = seq;
			}
		}
		// 这一页交给 Host 同款投影器；投影结果是 typed 节点，直接并入节点树。
		const changes: DshChatChange[] = [];
		const pageState = createDshIdeConversationState();
		for (const event of accepted) {
			projectDshIdeConversation(pageState, { type: 'event', event });
		}
		for (const node of pageState.nodes.values()) {
			const mapped = fromConversationNode(node);
			if (mapped === undefined) {
				continue;
			}
			const identity = identityOf(node);
			// 旧页只补画面：不覆盖实时窗口里同 identity 的节点。
			if (!this.nodes.has(identity) && !this.olderNodes.has(identity)) {
				this.olderNodes.set(identity, mapped);
				this._nodesVersion++;
				changes.push({ node: mapped, added: true });
			}
		}
		const hasMore = page.records.length === 0 ? false : page.hasMore;
		const historyChanged = hasMore !== this._hasMore || this._historyStatus !== 'idle';
		this._hasMore = hasMore;
		this._historyStatus = 'idle';
		if (changes.length > 0) {
			this._onDidChange.fire(changes);
		}
		if (historyChanged) {
			this._onDidChangeHistory.fire();
		}
		return {
			added: changes.reduce((count, change) => count + (change.added ? 1 : 0), 0),
			...(this.firstSeq() === undefined ? {} : { firstSeq: this.firstSeq() }),
			hasMore: this._hasMore,
			conflicts,
		};
	}

	/** 换会话：旧会话的记录与流式状态全部作废。 */
	clear(): void {
		this.usage.inputTokens = 0;
		this.usage.outputTokens = 0;
		this.usage.cacheReadTokens = 0;
		this.usage.cacheWriteTokens = 0;
		this.usageSeen = false;
		this.nodes.clear();
		this._nodesVersion++;
		this.olderNodes.clear();
		this._hasMore = true;
		this.durableFloor = undefined;
		this._historyStatus = 'idle';
		this._onDidReset.fire();
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 流式临时节点的身份前缀：seq 是合成值，不参与历史游标。 */
const STREAM_NODE_PREFIX = 'stream:';

/**
 * 结构化节点在模型里的身份键。
 *
 * 命令按 `commandId` 原地更新；其余按 seq。和裸帧路径的键保持一致，
 * 这样 `loadOlder` 前插和流式接管不会因为换路径而错位。
 */
function identityOf(node: DshIdeConversationNode): string {
	return node.kind === 'command' ? `cmd:${node.commandId}` : `seq:${node.seq}`;
}

/**
 * Host 投影的 `DshIdeConversationNode` → 本层 `DshChatNode`。
 *
 * 纯机械映射：只做类型收窄与 `raw` 的补位，不改写任何字段语义。
 * `raw` 在 typed 路径下没有原始事件，按 undefined 处理（协议本就不让线上传 raw）。
 */
function fromConversationNode(node: DshIdeConversationNode): DshChatNode | undefined {
	const base = {
		seq: node.seq,
		time: node.time,
		...(node.messageId === undefined ? {} : { messageId: node.messageId }),
	};
	switch (node.kind) {
		case 'user':
		case 'steering':
			return {
				...base,
				kind: node.kind,
				content: node.content as readonly DshContentBlock[],
				...(node.source === undefined ? {} : { source: node.source }),
				...(node.turn === undefined ? {} : { turn: node.turn }),
			} as DshChatNode;
		case 'turn-trigger':
			return {
				...base,
				kind: 'turn-trigger',
				content: node.content as readonly DshContentBlock[],
				...(node.source === undefined ? {} : { source: node.source }),
				...(node.producer === undefined ? {} : { producer: node.producer }),
				...(node.form === undefined ? {} : { form: node.form }),
				...(node.turn === undefined ? {} : { turn: node.turn }),
			} as DshChatNode;
		case 'context':
			return {
				...base,
				kind: 'context',
				content: node.content as readonly DshContentBlock[],
				...(node.source === undefined ? {} : { source: node.source }),
				...(node.producer === undefined ? {} : { producer: node.producer }),
				...(node.form === undefined ? {} : { form: node.form }),
				...(node.turn === undefined ? {} : { turn: node.turn }),
			} as DshChatNode;
		case 'assistant':
			return {
				...base,
				kind: 'assistant',
				turn: node.turn,
				step: node.step,
				blocks: node.blocks as readonly DshAssistantBlock[],
				...(node.usage === undefined ? {} : { usage: node.usage }),
				...(node.providerMetadata === undefined ? {} : { providerMetadata: node.providerMetadata }),
				...(node.interrupted === true ? { interrupted: true as const } : {}),
			};
		case 'tool-call':
			return {
				...base,
				kind: 'tool-call',
				callId: node.callId,
				...(node.parentCallId === undefined ? {} : { parentCallId: node.parentCallId }),
				name: node.name,
				phase: node.phase,
				...(node.step === undefined ? {} : { step: node.step }),
				...(node.argsRaw === undefined ? {} : { argsRaw: node.argsRaw }),
				...(node.args === undefined ? {} : { args: node.args }),
				...(node.turn === undefined ? {} : { turn: node.turn }),
			} as DshChatNode;
		case 'tool-result':
			return {
				...base,
				kind: 'tool-result',
				callId: node.callId,
				...(node.parentCallId === undefined ? {} : { parentCallId: node.parentCallId }),
				name: node.name,
				args: node.args,
				...(node.call === undefined ? {} : { call: node.call }),
				...(node.callTime === undefined ? {} : { callTime: node.callTime }),
				content: node.content as readonly DshContentBlock[],
				isError: node.isError,
				...(node.error === undefined ? {} : { error: node.error }),
				subCalls: node.subCalls.map(fromConversationNode).filter((child): child is DshToolCallBlock => child !== undefined && (child.kind === 'tool-call' || child.kind === 'tool-result')),
				...(node.turn === undefined ? {} : { turn: node.turn }),
			} as DshChatNode;
		case 'command':
			return {
				...base,
				kind: 'command',
				commandId: node.commandId,
				name: node.name,
				args: node.args,
				outcome: node.outcome,
				...(node.turn === undefined ? {} : { turn: node.turn }),
			};
		case 'compaction':
			return {
				...base,
				kind: 'compaction',
				summary: node.summary,
				...(node.summaryEventSeq === undefined ? {} : { summaryEventSeq: node.summaryEventSeq }),
				...(node.shadowedItemCount === undefined ? {} : { shadowedItemCount: node.shadowedItemCount }),
				...(node.shadowedTokenCount === undefined ? {} : { shadowedTokenCount: node.shadowedTokenCount }),
				...(node.turn === undefined ? {} : { turn: node.turn }),
			};
		case 'model-retry':
			return {
				...base,
				kind: 'model-retry',
				...(node.retry === undefined ? {} : { retry: node.retry }),
				...(node.maxRetries === undefined ? {} : { maxRetries: node.maxRetries }),
				...(node.delayMs === undefined ? {} : { delayMs: node.delayMs }),
				...(node.mode === undefined ? {} : { mode: node.mode }),
				...(node.retryState === undefined ? {} : { retryState: node.retryState }),
				...(node.failure === undefined ? {} : { failure: node.failure }),
				...(node.turn === undefined ? {} : { turn: node.turn }),
			} as DshChatNode;
		case 'turn-error':
			return {
				...base,
				kind: 'turn-error',
				turn: node.turn,
				step: node.step,
				message: node.message,
				...(node.code === undefined ? {} : { code: node.code }),
			} as DshChatNode;
		case 'turn-max-tokens':
			return { ...base, kind: 'turn-max-tokens', turn: node.turn, step: node.step } as DshChatNode;
		case 'inherited-history':
			return { ...base, kind: 'inherited-history', ...(node.turn === undefined ? {} : { turn: node.turn }) };
		case 'question-reply':
			return {
				...base,
				kind: 'question-reply',
				callId: node.callId,
				questions: node.questions,
				answers: node.answers,
				text: node.text,
				...(node.turn === undefined ? {} : { turn: node.turn }),
			} as DshChatNode;
		case 'command-input':
			return { ...base, kind: 'command-input', commandId: node.commandId, text: node.text } as DshChatNode;
		case 'submitted-plan':
			return {
				...base,
				kind: 'submitted-plan',
				callId: node.callId,
				title: node.title,
				markdown: node.markdown,
				...(node.turn === undefined ? {} : { turn: node.turn }),
			} as DshChatNode;
		case 'workflow-run':
			return {
				...base,
				kind: 'workflow-run',
				runId: node.runId,
				name: node.name,
				status: node.status,
				phases: node.phases,
				...(node.turn === undefined ? {} : { turn: node.turn }),
			} as DshChatNode;
		case 'system-prompt':
			return { ...base, kind: 'system-prompt', text: node.text, ...(node.update === true ? { update: true as const } : {}) } as DshChatNode;
		case 'turn-tail':
			return {
				...base,
				kind: 'turn-tail',
				turn: node.turn,
				...(node.closing === undefined ? {} : { closing: node.closing }),
				...(node.closingMessageId === undefined ? {} : { closingMessageId: node.closingMessageId }),
				...(node.branchUnavailable === true ? { branchUnavailable: true as const } : {}),
				...(node.tokenUsage === undefined ? {} : { tokenUsage: node.tokenUsage }),
			} as DshChatNode;
		case 'manual-compaction':
			return {
				...base,
				kind: 'manual-compaction',
				command: node.command,
				compaction: node.compaction,
			} as DshChatNode;
		default:
			return undefined;
	}
}

function stringOf(value: unknown): string | undefined {
	return typeof value === 'string' && value !== '' ? value : undefined;
}

function numberOf(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

