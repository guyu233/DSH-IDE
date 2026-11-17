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

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDshIdeConversationState, projectDshIdeConversation } from '../../../../platform/dshClient/common/dshIdeConversation.js';
import type { DshIdeConversationNode, DshIdeConversationView, DshIdeLoadOlderPage } from '../../../../platform/dshClient/common/dshIdeProtocol.js';

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
 * 父会话上的 `subagent/catalog` 发现事实。
 * 只保留事件 data 里真实有的字段，不补名字、耗时或子会话正文。
 */
export interface DshSubagentCatalogNode extends DshNodeBase {
	readonly kind: 'subagent-catalog';
	readonly childId?: string;
	readonly childCreatedAt?: number;
	readonly mode?: string;
	readonly label?: string;
	readonly name?: string;
	readonly version?: number;
	readonly turn?: number;
}

/**
 * `user/message` 且 `source.kind` 为 `subagent-settled` 或 `agent-message`。
 * DSH 把它们画成 turn trigger，不是用户气泡。`source` 原样保留。
 */
export interface DshSubagentNoticeNode extends DshNodeBase {
	readonly kind: 'subagent-notice';
	readonly content: readonly DshContentBlock[];
	readonly source: unknown;
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
	| DshSubagentCatalogNode
	| DshSubagentNoticeNode;

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
	 * snapshot / prependPage 用官方 `hasMore` 覆盖；空页强制 false，避免死循环。
	 */
	private _hasMore = true;
	/** 翻页请求的状态。模型不发请求，只记下会话层报来的状态。 */
	private _historyStatus: DshHistoryStatus = 'idle';
	private readonly _onDidChangeHistory = this._register(new Emitter<void>());
	readonly onDidChangeHistory: Event<void> = this._onDidChangeHistory.event;

	/** 按 identity 索引：durable 用 `seq:<n>`，流式用 `stream:<attemptId>`。 */
	private readonly nodes = new Map<string, DshChatNode>();

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

	/** 按 seq 升序（DSH 的会话日志顺序）。 */
	get list(): readonly DshChatNode[] {
		return [...this.nodes.values()].sort((a, b) => a.seq - b.seq);
	}

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
		this.clear();
		this._hasMore = conversation.hasMore;
		const changes: DshChatChange[] = [];
		for (const node of conversation.nodes) {
			const mapped = fromConversationNode(node);
			if (mapped === undefined) {
				continue;
			}
			this.nodes.set(identityOf(node), mapped);
			// typed 路径从节点自带的 usage 累加 token 用量。
			if (node.kind === 'assistant' && node.usage !== undefined) {
				this.usageSeen = true;
				this.usage.inputTokens += node.usage.inputTokens;
				this.usage.outputTokens += node.usage.outputTokens;
				this.usage.cacheReadTokens += node.usage.cacheReadTokens ?? 0;
				this.usage.cacheWriteTokens += node.usage.cacheWriteTokens ?? 0;
			}
			changes.push({ node: mapped, added: true });
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
		for (const [id, node] of this.nodes) {
			// 流式临时节点的 seq 是合成值（`stream:` 前缀），不参与历史游标。
			if (id.startsWith(STREAM_NODE_PREFIX)) {
				continue;
			}
			if (min === undefined || node.seq < min) {
				min = node.seq;
			}
		}
		return min;
	}

	/** 官方分页是否还有更早的记录。 */
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
			if (!this.nodes.has(identity)) {
				this.nodes.set(identity, mapped);
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
		this._hasMore = true;
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
		case 'subagent-notice':
			return {
				...base,
				kind: node.kind,
				content: node.content as readonly DshContentBlock[],
				...(node.turn === undefined ? {} : { turn: node.turn }),
			} as DshChatNode;
		case 'context':
			return {
				...base,
				kind: 'context',
				content: node.content as readonly DshContentBlock[],
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
		case 'subagent-catalog':
			return {
				...base,
				kind: 'subagent-catalog',
				...(node.childId === undefined ? {} : { childId: node.childId }),
				...(node.childCreatedAt === undefined ? {} : { childCreatedAt: node.childCreatedAt }),
				...(node.mode === undefined ? {} : { mode: node.mode }),
				...(node.label === undefined ? {} : { label: node.label }),
				...(node.name === undefined ? {} : { name: node.name }),
				...(node.version === undefined ? {} : { version: node.version }),
				...(node.turn === undefined ? {} : { turn: node.turn }),
			};
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

