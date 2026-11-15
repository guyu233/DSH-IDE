/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 会话帧 → 聊天记录。**不翻译、不转换、不投影**：形状就是 DSH 自己的。
//
// 依据（E:/deepseek-harness/packages/client/ui-conversation/src/client/contract/records.ts）：
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
import { indexLocations } from '../../../../platform/dshClient/common/dshIdeLocationIndex.js';

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
	| DshInheritedHistoryNode;

/** 渲染层只需要 `AssistantBlock` 的窄形状（与 DSH 定义同构）。 */
export type AssistantBlockLike = DshAssistantBlock;

export interface DshChatChange {
	readonly node: DshChatNode;
	/** true = 新节点，false = 同 identity 原位更新。 */
	readonly added: boolean;
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

	/** 按 seq 升序的**原始事件流**：定位索引要从头扫，不能只看节点。 */
	private readonly rawEvents: { seq: number; type: string; data: unknown }[] = [];

	/** 按 identity 索引：durable 用 `seq:<n>`，流式用 `stream:<attemptId>`。 */
	private readonly nodes = new Map<string, DshChatNode>();
	/** 进行中的 attempt：revision 去重 + 已拼好的 blocks。 */
	private readonly attempts = new Map<string, { turn: number; step: number; revision: number; blocks: DshAssistantBlock[]; id: string }>();
	/** 已经结算的 attempt：durable 消息到达后丢弃临时节点。 */
	private readonly settledAttempts = new Set<string>();

	/**
	 * 带 Turn/Step 坐标的节点列表。
	 *
	 * 顺序就是 DSH 的画面顺序：先按 seq 升序，再用定位索引给每个节点算出 Turn。
	 * `user/message` 事件本身不带 turn，只能按 seq 顺序扫 turn/start 才能定位；
	 * 不这么做就会把用户消息全部推到末尾（真机现象）。
	 */
	get located(): readonly { node: DshChatNode; turn?: number; step?: number }[] {
		const coordinates = indexLocations(this.rawEvents);
		return this.list.map(node => {
			const at = coordinates.get(node.seq);
			return {
				node,
				...(at?.turn === undefined ? {} : { turn: at.turn }),
				...(at?.step === undefined ? {} : { step: at.step }),
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

	/** 接受一帧 follow 结果。 */
	accept(frame: Readonly<Record<string, unknown>>): readonly DshChatChange[] {
		const type = frame['type'];
		let changes: readonly DshChatChange[] = [];
		if (type === 'snapshot') {
			changes = this.applySnapshot(frame);
		} else if (type === 'event' && isRecord(frame['event'])) {
			changes = this.applyDurable(frame['event']);
		} else if (type === 'assistant-stream' && isRecord(frame['frame'])) {
			changes = this.applyStream(frame['frame']);
		}
		if (changes.length > 0) {
			this._onDidChange.fire(changes);
		}
		return changes;
	}

	/** 换会话：旧会话的记录与流式状态全部作废。 */
	clear(): void {
		this.usage.inputTokens = 0;
		this.usage.outputTokens = 0;
		this.usage.cacheReadTokens = 0;
		this.usage.cacheWriteTokens = 0;
		this.usageSeen = false;
		this.nodes.clear();
		this.attempts.clear();
		this.settledAttempts.clear();
		this._onDidReset.fire();
	}

	private applySnapshot(frame: Readonly<Record<string, unknown>>): readonly DshChatChange[] {
		this.clear();
		const records = Array.isArray(frame['records']) ? frame['records'] : [];
		const changes: DshChatChange[] = [];
		for (const record of records) {
			if (isRecord(record) && record['type'] === 'event' && isRecord(record['event'])) {
				changes.push(...this.applyDurable(record['event']));
			}
		}
		// 流式基线：恢复进行中的 attempt。
		const baseline = isRecord(frame['assistantStream']) ? frame['assistantStream'] : undefined;
		const active = baseline !== undefined && isRecord(baseline['activeAttempt']) ? baseline['activeAttempt'] : undefined;
		if (active !== undefined) {
			const attemptId = stringOf(active['attemptId']);
			const stream = Array.isArray(active['stream']) ? active['stream'] : [];
			if (attemptId !== undefined) {
				this.attempts.set(attemptId, {
					turn: numberOf(active['turn']) ?? 0,
					step: numberOf(active['step']) ?? 0,
					revision: numberOf(active['revision']) ?? 0,
					blocks: streamToBlocks(stream),
					id: `stream:${attemptId}`,
				});
			}
		}
		return changes;
	}

	/** durable 事件：按 DSH 自己的事件类型分派；**任何**事件都先留 `raw`，再决定投影形状。 */
	private applyDurable(event: Record<string, unknown>): readonly DshChatChange[] {
		const seq = numberOf(event['seq']);
		if (seq === undefined) {
			return [];
		}
		const type = stringOf(event['type']);
		const data = isRecord(event['data']) ? event['data'] : {};
		const time = numberOf(event['time']) ?? 0;
		// 原始事件留档：定位索引要按 seq 顺序重扫（user/message 自己不带 turn）。
		if (typeof type === 'string' && type !== '') {
			this.rawEvents.push({ seq, type, data });
		}
		const turn = numberOf(event['turn']) ?? numberOf(data['turn']) ?? 0;
		// 源载荷原样：所有节点的 `raw` 都是这一个对象，解码层不得改写它。
		const raw = event;

		if (type === 'user/message') {
			const content = contentBlocksOf(data['content']);
			if (content.length === 0) {
				return [];
			}
			// 逐条对照 DSH `conversation-nodes/message.ts:96`：user/message 里
			// source.kind !== 'user' 的是插件注入的模型可见上下文（time-context、
			// skill-invocation、agent-instructions …），不是人发的消息。
			// 这类事件要归到 ContextMessageNode 折叠行，不能画成右侧用户气泡。
			const source = data['source'];
			const sourceKind = isRecord(source) ? stringOf(source['kind']) : undefined;
			if (sourceKind !== undefined && sourceKind !== 'user') {
				const contextNode: DshContextMessageNode = {
					kind: 'context',
					...(stringOf(data['messageId']) === undefined ? {} : { messageId: stringOf(data['messageId'])! }),
					seq,
					time,
					content,
					source,
					producer: contextProducerOf(source, sourceKind),
					form: contextFormOf(source),
					turn,
					raw,
				};
				return this.put(`seq:${seq}`, contextNode);
			}
			const node: DshUserMessageNode = {
				kind: 'user',
				...(stringOf(data['messageId']) === undefined ? {} : { messageId: stringOf(data['messageId'])! }),
				seq,
				time,
				content,
				...(source === undefined ? {} : { source }),
				raw,
			};
			const changes = this.put(`seq:${seq}`, node);
			return changes;
		}

		if (type === 'assistant/message') {
			const message = isRecord(data['message']) ? data['message'] : {};
			const step = numberOf(data['step']) ?? numberOf(message['step']) ?? 0;
			const blocks = assistantBlocksOf(message['content']);
			// `usage` 在**事件级**（`AssistantMessage` 事件的字段），不是 message 上；
			// 两处都读一次以兼容历史 log。整个会话的 token 用量在这里累加。
			const usage = isRecord(data['usage']) ? data['usage'] : isRecord(message['usage']) ? message['usage'] : undefined;
			if (usage !== undefined) {
				this.usageSeen = true;
				this.usage.inputTokens += numberOf(usage['inputTokens']) ?? 0;
				this.usage.outputTokens += numberOf(usage['outputTokens']) ?? 0;
				this.usage.cacheReadTokens += numberOf(usage['cacheReadTokens']) ?? 0;
				this.usage.cacheWriteTokens += numberOf(usage['cacheWriteTokens']) ?? 0;
			}
			if (blocks.length === 0) {
				return [];
			}
			const node: DshAssistantMessageNode = {
				kind: 'assistant',
				...(stringOf(data['messageId']) === undefined ? {} : { messageId: stringOf(data['messageId'])! }),
				seq,
				time,
				turn,
				step,
				blocks,
				...(usage === undefined ? {} : { usage }),
				...(message['providerMetadata'] === undefined ? {} : { providerMetadata: message['providerMetadata'] as DshAssistantMessageNode['providerMetadata'] }),
				...(message['requestConfig'] === undefined ? {} : { requestConfig: message['requestConfig'] }),
				...(message['timing'] === undefined ? {} : { timing: message['timing'] }),
				...(data['interrupted'] === true || message['interrupted'] === true ? { interrupted: true as const } : {}),
				raw,
			};
			const changes = this.put(`seq:${seq}`, node);
			// durable 消息接管同回合的流式临时节点。
			for (const [attemptId, attempt] of [...this.attempts]) {
				if (attempt.turn === turn) {
					this.attempts.delete(attemptId);
					this.settledAttempts.add(attemptId);
					this.nodes.delete(attempt.id);
				}
			}
			return changes;
		}

		// ---- 其余全部 DSH 会话事件：一个都不丢 ----

		if (type === 'tool/call') {
			const callId = stringOf(data['callId']);
			const name = stringOf(data['name']);
			if (callId === undefined || name === undefined) {
				return [];
			}
			const node: DshRunningToolCall = {
				kind: 'tool-call',
				callId,
				name,
				phase: 'start',
				argsRaw: typeof data['arguments'] === 'string' ? data['arguments'] : '',
				turn,
				step: numberOf(data['step']) ?? 0,
				time,
				seq,
				raw,
			};
			return this.put(`seq:${seq}`, node as unknown as DshChatNode);
		}

		if (type === 'tool/result') {
			const message = isRecord(data['message']) ? data['message'] : {};
			const source = isRecord(message['source']) ? message['source'] : {};
			const callId = stringOf(source['callId']);
			if (callId === undefined) {
				return [];
			}
			// 上游 `ToolResultNode` 的形状：`call` 带工具名与原始参数，`subCalls` 是
			// PTC 递归子调用（子调用要缩进嵌在父调用下面，不能丢）。
			const call = isRecord(data['call']) ? data['call'] : undefined;
			const callName = call === undefined ? '' : stringOf(call['name']) ?? '';
			const callArgsRaw = call === undefined ? undefined : stringOf(call['argsRaw']);
			const subCalls = Array.isArray(data['subCalls'])
				? data['subCalls'].flatMap(child => decodeToolCallBlock(child))
				: [];
			const node: DshToolResultNode = {
				kind: 'tool-result',
				seq,
				time,
				callId,
				name: callName,
				...(typeof data['parentCallId'] === 'string' ? { parentCallId: data['parentCallId'] } : {}),
				args: data['args'],
				...(call === undefined ? {} : { call: { name: callName, argsRaw: callArgsRaw ?? '' } }),
				...(typeof data['callTime'] === 'number' ? { callTime: data['callTime'] } : {}),
				content: contentBlocksOf(message['content']),
				isError: message['isError'] === true,
				subCalls,
				...(data['error'] === undefined ? {} : { error: data['error'] as DshToolResultNode['error'] }),
				...(data['meta'] === undefined ? {} : { meta: data['meta'] }),
				turn,
				raw,
			};
			return this.put(`seq:${seq}`, node as unknown as DshChatNode);
		}

		if (type === 'turn/end') {
			const reason = isRecord(data['reason']) ? data['reason'] : {};
			const kind = stringOf(reason['kind']);
			const step = numberOf(data['step']) ?? 0;
			const changes: DshChatChange[] = [];
			if (kind === 'error' || kind === 'aborted' || kind === 'interrupted') {
				const failure = isRecord(reason['failure']) ? reason['failure'] : {};
				const node: DshTurnErrorNode = {
					kind: 'turn-error',
					seq,
					time,
					turn,
					step,
					message: typeof failure['message'] === 'string' ? failure['message'] : '',
					...(typeof failure['code'] === 'string' ? { code: failure['code'] } : {}),
					raw,
				};
				changes.push(...this.put(`seq:${seq}`, node as unknown as DshChatNode));
			} else if (kind === 'max-tokens') {
				const node: DshTurnMaxTokensNode = { kind: 'turn-max-tokens', seq, time, turn, step, raw };
				changes.push(...this.put(`seq:${seq}`, node as unknown as DshChatNode));
			} else {
				// 正常收尾：DSH `TurnTailNodeView` 只在回合结束后画一次 IconActions/用量。
				// 给该回合最后一个助手节点打标记，渲染层据此避免每个回复分片都画一条 Usage。
				let closing: DshChatNode | undefined;
				for (const node of this.nodes.values()) {
					if (node.kind === 'assistant' && node.seq < seq && (closing === undefined || node.seq > closing.seq)) {
						closing = node;
					}
				}
				if (closing !== undefined) {
					(closing as { turnEnded?: boolean }).turnEnded = true;
				}
			}
			return changes;
		}

		if (type === 'llm/retry') {
			const node: DshModelRetryNode = {
				kind: 'model-retry',
				seq,
				time,
				retryState: 'scheduled',
				turn,
				...(numberOf(data['retry']) === undefined ? {} : { retry: numberOf(data['retry'])! }),
				...(numberOf(data['maxRetries']) === undefined ? {} : { maxRetries: numberOf(data['maxRetries'])! }),
				...(numberOf(data['delayMs']) === undefined ? {} : { delayMs: numberOf(data['delayMs'])! }),
				...(data['mode'] === 'normal' || data['mode'] === 'always' ? { mode: data['mode'] } : {}),
				...(isRecord(data['failure']) ? { failure: { message: typeof data['failure']['message'] === 'string' ? data['failure']['message'] : '', ...(typeof data['failure']['code'] === 'string' ? { code: data['failure']['code'] } : {}) } } : {}),
				raw,
			};
			return this.put(`seq:${seq}`, node as unknown as DshChatNode);
		}

		if (type === 'command/run' || type === 'command/done') {
			const commandId = stringOf(data['commandId']);
			if (commandId === undefined) {
				return [];
			}
			const previous = this.nodes.get(`cmd:${commandId}`);
			const base = previous !== undefined && previous.kind === 'command' ? previous : undefined;
			const node: DshCommandNode = {
				kind: 'command',
				seq: base?.seq ?? seq,
				time: base?.time ?? time,
				commandId,
				name: type === 'command/run' ? (stringOf(data['name']) ?? null) : (base?.name ?? null),
				args: type === 'command/run' ? (typeof data['rawInput'] === 'string' ? data['rawInput'] : null) : (base?.args ?? null),
				outcome: type === 'command/done'
					? { kind: data['ok'] === false ? 'error' : 'success', ...(typeof data['text'] === 'string' ? { text: data['text'] } : {}) }
					: (base?.outcome ?? null),
				turn,
				raw,
			};
			return this.put(`cmd:${commandId}`, node as unknown as DshChatNode);
		}

		if (type === 'compaction/summary' || type === 'user/message#compaction') {
			const node: DshCompactionNode = {
				kind: 'compaction',
				seq,
				time,
				summary: typeof data['summary'] === 'string' ? data['summary'] : null,
				...(numberOf(data['summaryEventSeq']) === undefined ? {} : { summaryEventSeq: numberOf(data['summaryEventSeq'])! }),
				...(numberOf(data['shadowedItemCount']) === undefined ? {} : { shadowedItemCount: numberOf(data['shadowedItemCount'])! }),
				...(numberOf(data['shadowedTokenCount']) === undefined ? {} : { shadowedTokenCount: numberOf(data['shadowedTokenCount'])! }),
				turn,
				raw,
			};
			return this.put(`seq:${seq}`, node as unknown as DshChatNode);
		}

		if (type === 'session/end-seed' && data['inherited'] === true) {
			// ui-chat 的合成节点（`conversation-nodes/inherited-history.ts`）：fork 继承历史的分界。
			const node: DshInheritedHistoryNode = { kind: 'inherited-history', seq, time, turn, raw };
			return this.put(`seq:${seq}`, node as unknown as DshChatNode);
		}

		if (type === 'assistant/attempt') {
			// 结算为 attempt：流式文本在原处转正，不另起节点。
			const attemptId = stringOf(data['attemptId']);
			if (attemptId === undefined) {
				return [];
			}
			const attempt = this.attempts.get(attemptId);
			if (attempt === undefined) {
				return [];
			}
			this.attempts.delete(attemptId);
			this.settledAttempts.add(attemptId);
			const existing = this.nodes.get(attempt.id);
			if (existing === undefined || existing.kind !== 'assistant') {
				return [];
			}
			return [{ node: existing, added: false }];
		}

		// 未知事件不能一律画成可见行：真源兜底只收 **append-origin 的 surface 事件**
		// （`conversation-nodes/fallback.ts:23` 的 `isAppendSurfaceEvent`，其判定为
		// `surfaceOp === 'append'`，见 `core/session/src/surface.ts:89-93`）。
		// 非 surface 的内部事件（turn/start、attempt、boundary 等）留在 rawEvents 供定位，
		// 不产生可见节点——否则就是凭空「增」出界面行。
		if (data['surfaceOp'] === 'append') {
			const unknownNode: DshUnknownSurfaceNode = {
				kind: 'unknown',
				seq,
				time,
				type: type ?? '',
				data,
				turn,
				raw,
			};
			return this.put(`seq:${seq}`, unknownNode as unknown as DshChatNode);
		}

		return [];
	}

	/** `assistant-stream`：start / chunk / end，按 revision 单调去重。 */
	private applyStream(frame: Record<string, unknown>): readonly DshChatChange[] {
		const type = stringOf(frame['type']);
		const attemptId = stringOf(frame['attemptId']);
		const revision = numberOf(frame['revision']);
		if (attemptId === undefined || revision === undefined) {
			return [];
		}
		if (type === 'start') {
			if (this.attempts.has(attemptId) || this.settledAttempts.has(attemptId)) {
				return [];
			}
			const attempt = {
				turn: numberOf(frame['turn']) ?? 0,
				step: numberOf(frame['step']) ?? 0,
				revision,
				blocks: [] as DshAssistantBlock[],
				id: `stream:${attemptId}`,
			};
			this.attempts.set(attemptId, attempt);
			const node = this.streamNode(attemptId, attempt);
			this.nodes.set(attempt.id, node);
			return [{ node, added: true }];
		}
		if (type === 'chunk') {
			const attempt = this.attempts.get(attemptId);
			const chunk = isRecord(frame['chunk']) ? frame['chunk'] : undefined;
			if (attempt === undefined || chunk === undefined || revision <= attempt.revision) {
				return [];
			}
			attempt.revision = revision;
			appendChunk(attempt.blocks, chunk);
			const node = this.streamNode(attemptId, attempt);
			this.nodes.set(attempt.id, node);
			return [{ node, added: false }];
		}
		if (type === 'end') {
			const attempt = this.attempts.get(attemptId);
			if (attempt === undefined) {
				return [];
			}
			const outcome = isRecord(frame['outcome']) ? frame['outcome'] : {};
			this.attempts.delete(attemptId);
			this.settledAttempts.add(attemptId);
			if (outcome['kind'] === 'abandoned') {
				// 没有落成可见消息：丢弃这次尝试留下的临时节点。
				this.nodes.delete(attempt.id);
				this._onDidReset.fire();
				return [];
			}
			// committed：等 durable `assistant/message` 接管；先把流式标记去掉。
			const existing = this.nodes.get(attempt.id);
			if (existing === undefined) {
				return [];
			}
			return [{ node: existing, added: false }];
		}
		return [];
	}

	private streamNode(attemptId: string, attempt: { turn: number; step: number; revision: number; blocks: DshAssistantBlock[]; id: string }): DshAssistantMessageNode {
		return {
			kind: 'assistant',
			seq: this.streamSeq(attemptId),
			time: Date.now(),
			turn: attempt.turn,
			step: attempt.step,
			blocks: attempt.blocks,
		};
	}

	/** 流式节点没有 durable seq：用已有序号之后的值，保证排在历史之后。 */
	private streamSeq(attemptId: string): number {
		let max = 0;
		for (const node of this.nodes.values()) {
			if (node.seq > max) {
				max = node.seq;
			}
		}
		void attemptId;
		return max + 1;
	}

	private put(id: string, node: DshChatNode): readonly DshChatChange[] {
		const existed = this.nodes.has(id);
		this.nodes.set(id, node);
		return [{ node, added: !existed }];
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOf(value: unknown): string | undefined {
	return typeof value === 'string' && value !== '' ? value : undefined;
}

function numberOf(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** DSH `ContentBlock[]` 原样读取（不改造型，只过滤出可识别的）。 */
/**
 * 递归解码一个工具调用块（`RunningToolCall` 或 `ToolResultNode`）。
 *
 * 上游 `ToolCallBlock` 是自递归的：PTC 子调用挂在父调用的 `subCalls` 上。
 * 这里按同一形状递归，深度不设人为上限（上游也没有）。
 */
function decodeToolCallBlock(value: unknown): DshToolCallBlock[] {
	if (!isRecord(value)) {
		return [];
	}
	const callId = stringOf(value['callId']);
	if (callId === undefined) {
		return [];
	}
	const subCalls = Array.isArray(value['subCalls'])
		? value['subCalls'].flatMap(child => decodeToolCallBlock(child))
		: [];
	const seq = numberOf(value['seq']) ?? 0;
	const time = numberOf(value['time']) ?? 0;
	const hasResult = value['kind'] === 'tool-result' || value['content'] !== undefined;
	if (hasResult) {
		const call = isRecord(value['call']) ? value['call'] : undefined;
		const name = call === undefined ? stringOf(value['name']) ?? '' : stringOf(call['name']) ?? '';
		const block: DshToolResultNode = {
			kind: 'tool-result',
			seq,
			time,
			callId,
			name,
			args: value['args'],
			...(call === undefined ? {} : { call: { name, argsRaw: stringOf(call['argsRaw']) ?? '' } }),
			content: contentBlocksOf(value['content']),
			isError: value['isError'] === true,
			subCalls,
			raw: value,
		};
		return [block];
	}
	const phase = value['phase'] === 'preparing' ? 'preparing' : 'start';
	const block: DshRunningToolCall = {
		kind: 'tool-call',
		seq,
		time,
		callId,
		name: stringOf(value['name']) ?? '',
		phase,
		...(typeof value['argsRaw'] === 'string' ? { argsRaw: value['argsRaw'] } : {}),
		...(subCalls.length === 0 ? {} : { subCalls }),
		raw: value,
	};
	return [block];
}

/** DSH `event-projection.ts:47-53`：只放行 Chat 认得的 form，其余保持不透明。 */
const KNOWN_CONTEXT_FORMS: readonly string[] = ['instructions', 'catalog', 'snapshot', 'notice', 'relay', 'recall'];

function contextFormOf(source: unknown): string | null {
	const record = isRecord(source) ? source : undefined;
	const form = record === undefined ? undefined : stringOf(record['form']);
	return form !== undefined && KNOWN_CONTEXT_FORMS.includes(form) ? form : null;
}

/** DSH `event-projection.ts:60-76`：把注入源投影为折叠行的 producer 标签。 */
function contextProducerOf(source: unknown, kind: string): { readonly role: string; readonly label: string | null } {
	const record = isRecord(source) ? source : undefined;
	if (record === undefined) {
		return { role: 'inject', label: null };
	}
	if (kind === 'session-reference') {
		const refs = Array.isArray(record['references']) ? record['references'] : [];
		const labels = refs.flatMap(entry => isRecord(entry) && typeof entry['label'] === 'string' ? [entry['label']] : []);
		return { role: 'recall', label: labels.join(', ') || kind };
	}
	if (kind === 'agent-instructions') {
		const changes = Array.isArray(record['changes']) ? record['changes'] : [];
		const paths = changes.flatMap(entry => isRecord(entry) && typeof entry['path'] === 'string' ? [entry['path']] : []);
		return { role: 'inject', label: paths.join(', ') || kind };
	}
	if (kind === 'skill-invocation') {
		return { role: 'inject', label: stringOf(record['name']) ?? kind };
	}
	// MessageSourceMap 可合并扩展；未知 producer 用它的 durable kind 可见，例如 time-context。
	return { role: 'inject', label: kind };
}

function contentBlocksOf(value: unknown): DshContentBlock[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const blocks: DshContentBlock[] = [];
	for (const block of value) {
		if (!isRecord(block)) {
			// 非记录块也要留痕：落成带原值的 plugin 块，绝不 continue 丢掉。
			blocks.push({ type: 'plugin', pluginType: 'non-record', block });
			continue;
		}
		const type = stringOf(block['type']);
		if (type === 'text' && typeof block['text'] === 'string') {
			blocks.push({ type: 'text', text: block['text'] });
		} else if (type === 'reasoning' && typeof block['text'] === 'string') {
			blocks.push({ type: 'reasoning', text: block['text'] });
		} else if (type === 'image') {
			blocks.push({ type: 'image', attachment: block['attachment'] });
		} else if (type === 'file') {
			blocks.push({ type: 'file', attachment: block['attachment'] });
		} else if (type === 'tool-call' && typeof block['id'] === 'string' && typeof block['name'] === 'string') {
			// `arguments` 真源是 string，但历史日志可能出现非字符串；保留原值而不是伪造成空串。
			blocks.push({ type: 'tool-call', id: block['id'], name: block['name'], arguments: block['arguments'] as string });
		} else if (type === 'tool-addition' || type === 'tool-removal') {
			blocks.push({ type, toolName: String(block['toolName'] ?? '') });
		} else {
			// 未知块原样保留：DSH 用 `other` 把它画成 JSON 卡片，我们同样不能丢。
			// 真实 `type` 存在 `pluginType`，不覆盖判别值，canonical 仍能还原源载荷。
			blocks.push({ type: 'plugin', pluginType: type ?? 'non-record', block });
		}
	}
	return blocks;
}

/** DSH `toAssistantBlocks`（`event-projection.ts:105`）同一份映射。 */
function assistantBlocksOf(value: unknown): DshAssistantBlock[] {
	return contentBlocksOf(value).map(toAssistantBlock);
}

/** DSH `toAssistantBlock`（`event-projection.ts:114-121`）逐字对应，含 `file` 落 `other`。 */
function toAssistantBlock(block: DshContentBlock): DshAssistantBlock {
	switch (block.type) {
		case 'text': return { kind: 'text', text: block.text };
		case 'reasoning': return { kind: 'reasoning', text: block.text };
		case 'image': return { kind: 'image', attachment: block.attachment };
		case 'tool-call': return { kind: 'tool-call', callId: block.id, name: block.name, argsRaw: block.arguments };
		// 真源 `AssistantBlock` 没有 `file`，`file` 与所有插件块一起落 `other` 原样保留。
		default: return { kind: 'other', block };
	}
}

/** 流式 chunk 追加：对应 DSH `StreamChunk` 的 text-delta / reasoning-delta。 */
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

/** 快照里的流式基线：`readonly JsonValue[]`，按 chunk 形状追加。 */
function streamToBlocks(stream: readonly unknown[]): DshAssistantBlock[] {
	const blocks: DshAssistantBlock[] = [];
	for (const chunk of stream) {
		if (isRecord(chunk)) {
			appendChunk(blocks, chunk);
		}
	}
	return blocks;
}
