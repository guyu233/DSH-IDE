/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH-IDE 连接层协议真源（P1 冻结，当前 wireRevision 5）。
//
// 模式直接从 dsh-TUI 的 `tui-profile/protocols/tui-channel.js` + `src/adapter/channel/{provider,consumer}.ts`
// 平移：校验原语（exactRecord / jsonValue）、双向校验器（输入/快照）、Consumer 连续性 fail-closed。
// 与 dsh-TUI 的差异：DSH-IDE 用「命名参数对象 + per-method exactRecord」而非位置参数 unknown[]，
// 且 method 直接作为 IServerChannel.call 的 command（无外层 invoke 包裹）。
//
// 本文件是协议唯一真源：所有类型/常量/校验器只在此声明；dshIdeContract.ts 单向引用本文件常量，
// 本文件绝不反向引用 contract。插件侧零 electron 直接引用（仅用平台接口）。

/** 唯一 DSH-IDE IPC 频道名（token 恒为 `dshIde`；全仓只有这一条通道）。 */
export const DSH_IDE_CHANNEL = 'dshIde';

/** API 版本（与 `dshIdeContract.UPSTREAM_VALIDATED_VERSION` 同值，由契约单测核对）。 */
export const DSH_IDE_API_VERSION = '0.2.2-rc.1';

/**
 * 两半共用的线协议修订号。5 将窗口绑定及代次带到官方 Remote 与 IPC 快照；
 * 任一半未声明该修订号，业务调用不得降级到不带身份的形状。
 */
export const DSH_IDE_WIRE_REVISION = 5;
export const DSH_IDE_INCOMPATIBLE_WIRE = 'dsh-ide/incompatible-wire';
export const DSH_IDE_VIEW_BOUND_FRAME = 'ide-view-bound';

/** 由 IDE 主进程捕获的逻辑视图。窗口身份不代替 Gateway 的认证主体。 */
export interface DshIdeViewBinding {
	readonly viewId: string;
	readonly generation: number;
	readonly sessionId: string | null;
}

export function requireDshIdeWireRevision(value: unknown): void {
	if (value !== DSH_IDE_WIRE_REVISION) {
		throw Object.assign(new TypeError(`DSH-IDE wireRevision mismatch: expected ${DSH_IDE_WIRE_REVISION}`), { code: DSH_IDE_INCOMPATIBLE_WIRE });
	}
}

export function validateDshIdeViewBinding(value: unknown): DshIdeViewBinding {
	const binding = exactRecord(value, ['viewId', 'generation', 'sessionId'], 'DshIdeViewBinding');
	const viewId = nonEmptyString(binding['viewId'], 'DshIdeViewBinding.viewId');
	const generation = nonNegativeInteger(binding['generation'], 'DshIdeViewBinding.generation');
	const sessionId = binding['sessionId'] === null ? null : nonEmptyString(binding['sessionId'], 'DshIdeViewBinding.sessionId');
	return { viewId, generation, sessionId };
}

/**
 * `deleteSession` 依赖的社区插件版本（§8.10.8（4）版本绑定）。
 *
 * DSH 官方 0.2.2-rc.1 不存在会话永久删除入口（§8.10.7 已定论），因此该 method 的唯一
 * 实现路径是调用本插件在官方 `workspaceRegistry` 实例上 overlay 的 `deleteSession`。
 * 插件升级必须重新验证 endpoint 存在性、入参 wire 与返回形态（`{ deleted: true }`）。
 * **只调用其公开方法，不复制其删除链代码**（批准范围见 §8.10.8（1））。
 */
export const DSH_IDE_DELETE_SESSION_PLUGIN = '@michengai/dsh-archive-manager';
export const DSH_IDE_DELETE_SESSION_PLUGIN_VERSION = '1.3.1';
/** 插件注册的 Typert endpoint（`workspace.ts:359-378`：namespace/method 同名，wire = `sessionId`）。 */
export const DSH_IDE_DELETE_SESSION_ENDPOINT = 'workspaceRegistry/deleteSession';

/** 功能暂不可用的统一错误码：method 不在白名单，或宿主端口尚未接线。 */
export const DSH_IDE_FEATURE_UNAVAILABLE = 'dsh-ide/feature-unavailable';
/** 入参校验失败的统一错误码（对应 dsh-TUI 的 TypeError 协议违规）。 */
export const DSH_IDE_INVALID_ARGUMENT = 'dsh-ide/invalid-argument';

/** waterfall 已被另一窗口 resolve，本窗口操作无效（P3 落地）。 */
export const DSH_IDE_ALREADY_RESOLVED = 'ALREADY_RESOLVED';

/** 目标会话已切换，本次操作上下文失效（P3 落地）。 */
export const DSH_IDE_SESSION_SWITCHED = 'SESSION_SWITCHED';

/** 本地快照落后过多，需 `refreshSnapshot`（消费点在 P4 的 DshIdeConsumer）。 */
export const DSH_IDE_SNAPSHOT_STALE = 'SNAPSHOT_STALE';

/** 旧 client 错误类型，随 DshRemoteError 一同迁到此处（保证 IDshClientService 消费方类型不破）。 */
export interface DshRemoteError {
	readonly code: string;
	readonly message: string;
	readonly details?: unknown;
}

/**
 * 当前绑定工作区的会话列表项（P4，DSH_IDE_API_VERSION 绑定官方 SessionSummary）。
 * 只取 sessionController.list 与 workspaceRegistry 交集；标题取 projections.values.title。
 * 不增加独立运行时校验器，兼容性由版本绑定与两套 backend 的契约单测守护。
 */
export interface IDshIdeSessionSummary {
	readonly sessionId: string;
	readonly workspaceId: string;
	readonly title?: string;
	readonly updatedAt: number;
	readonly running: boolean;
	readonly blank: boolean;
	readonly agentAvailable: boolean;
	readonly formatStatus?: 'current' | 'migration-required';
	readonly cwd?: string;
	readonly parentSessionId?: string;
	readonly origin?: 'subagent';
}

/**
 * 一帧跟会话的结果。形状就是 `sessionController.follow` 给出的帧，
 * 或内核转发的批准 / 问卷帧。通道不把它折成另一套行。
 */
export interface DshIdeViewSnapshot {
	/** 跟会话的原始帧。typed 字段未齐时渲染器仍可读它；齐了以后以 typed 字段为准。 */
	readonly frame: Readonly<Record<string, unknown>>;
	readonly conversation?: DshIdeConversationView;
	readonly deliverables?: readonly DshIdeDeliverableView[];
	readonly attachments?: readonly DshIdeImageAttachmentRef[];
	/**
	 * 计划 / 目标 / Todo 投影的**共同语义**：
	 *
	 * 字段缺席 = 本帧没带，保留上一次的值（投影只在 `snapshot` 帧下发，内容帧不带）；
	 * 关闭/取消用显式空值形态表达（`plan: { active: false, pending: false }`、`todos: []`），
	 * 不靠省略字段。
	 */
	readonly plan?: DshIdePlanView;
	readonly goal?: DshIdeGoalView;
	readonly todos?: readonly DshIdeTodoView[];
	readonly skills?: readonly DshIdeSkillView[];
	/** 共享任务板（官方 `agentTeam` 投影）；缺席表示本帧没带。 */
	readonly team?: DshIdeTeamView;
	/** 本会话记录的工作树（官方 `worktree` 投影）；缺席表示本帧没带。 */
	readonly worktrees?: readonly DshIdeWorktreeView[];
	readonly tokenUsageDelta?: DshIdeTokenUsageDelta;
	readonly quotaNotice?: DshIdeQuotaNotice;
	readonly composer?: DshIdeComposerView;
	readonly pending?: readonly DshIdePendingItem[];
}

/**
 * 依赖插件能力快照。四项全必填布尔；由 Host 探测官方服务的实际装载状态后下发。
 * - `rewind`：`dsh-rewind-plugin`（命令 `rewind-plugin`）。
 * - `sessionFavorite` / `sessionMove` / `sessionDelete`：`@michengai/dsh-archive-manager`
 *   （`workspaceRegistry.setSessionFavorite` / `moveSessionToWorkspace` / overlay `deleteSession`）。
 */
export interface DshIdeCapabilities {
	readonly rewind: boolean;
	readonly sessionFavorite: boolean;
	readonly sessionMove: boolean;
	readonly sessionDelete: boolean;
}

/** 渲染器消费的视图状态：骨架状态 + 可选投影载荷。 */
export interface DshIdeViewState {
	readonly state: 'starting' | 'ready' | 'rebuild';
	readonly message?: string;
	/** 跟会话的一帧；`state === 'ready'` 时必填。 */
	readonly view?: DshIdeViewSnapshot;
}

/** 单帧快照：wireRevision + channelId + 单调递增 version + 视图状态。 */
export interface DshIdeSnapshot {
	readonly wireRevision: number;
	readonly channelId: string;
	readonly version: number;
	readonly binding: DshIdeViewBinding;
	readonly state: DshIdeViewState;
}

/**
 * DSH `ImageAttachmentRef`（`packages/attachment/attachment/src/types.ts:11-32`）。
 * attachmentId 是不透明存储 id，**不是**文件路径或 URL；媒体类型字段叫 mediaType。
 */
export interface DshIdeImageAttachmentRef {
	readonly attachmentId: string;
	readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
	readonly bytes: number;
	readonly width: number;
	readonly height: number;
	readonly name?: string;
	/** 官方 `ImageAttachmentRef.originalDimensions`：归一化缩小之后才出现。 */
	readonly originalDimensions?: { readonly width: number; readonly height: number };
}

/** 官方 `FileAttachmentRef`（`packages/attachment/attachment/src/types.ts`）。`attachmentId` 不是路径。 */
export interface DshIdeFileAttachmentRef {
	readonly attachmentId: string;
	readonly name: string;
	readonly bytes: number;
}

/** 官方 `ContentBlock` 里 IDE 要画的子集。未知 `type` 不进本视图（由投影层丢掉）。 */
export type DshIdeContentBlock =
	| { readonly type: 'text'; readonly text: string }
	| { readonly type: 'reasoning'; readonly text: string }
	| { readonly type: 'image'; readonly attachment: DshIdeImageAttachmentRef }
	| { readonly type: 'file'; readonly attachment: DshIdeFileAttachmentRef }
	| { readonly type: 'tool-call'; readonly id: string; readonly name: string; readonly arguments: string }
	| { readonly type: 'tool-addition' | 'tool-removal'; readonly toolName: string };

/** 官方 `AssistantBlock`：text / reasoning / image / tool-call / other。 */
export type DshIdeAssistantBlock =
	| { readonly kind: 'text'; readonly text: string }
	| { readonly kind: 'reasoning'; readonly text: string }
	| { readonly kind: 'image'; readonly attachment: DshIdeImageAttachmentRef }
	| { readonly kind: 'tool-call'; readonly callId: string; readonly name: string; readonly argsRaw: string }
	| { readonly kind: 'other'; readonly block: unknown };

interface DshIdeNodeBase {
	readonly seq: number;
	readonly time: number;
	readonly messageId?: string;
	/** 位置坐标，不是节点 kind：官方 `ConversationLocation` 的 turn。 */
	readonly turn?: number;
}

/** 官方 `subagentCatalog` 投影的一条目录事实（父会话拥有的子代理成员记录）。 */
export interface DshIdeSubagentCatalogEntry {
	readonly seq: number;
	readonly time: number;
	readonly childId?: string;
	readonly childCreatedAt?: number;
	readonly mode?: string;
	readonly label?: string;
	readonly name?: string;
	readonly version?: number;
}

/**
 * 结构化会话：Host 投影后的节点，不再由渲染器从裸帧拼装。
 *
 * `subagentCatalog` 是**投影通道**，不是节点 kind：官方把它放在
 * `SessionProjectionMap['subagentCatalog']`，由 `ui-subagent` 通过
 * `useProjection('subagentCatalog')` 读取，不进入 `conversation.chat.node` 的
 * kind 空间。因此这里与 `nodes` 并列，而不是混进节点列表。
 */
export interface DshIdeConversationView {
	readonly nodes: readonly DshIdeConversationNode[];
	readonly hasMore: boolean;
	readonly subagentCatalog?: readonly DshIdeSubagentCatalogEntry[];
	/**
	 * 官方 `inbox` 投影里的 `next-turn`（排队等下一个 Turn 的输入）。
	 *
	 * 数据来自 `agent/inbox/spliced` 的 `inserted`——官方类型是 `UserMessage[]`，
	 * 每项带完整 `content`（text / image / file 块），不是只有 id。
	 * 顺序即排队顺序；空数组省略。
	 */
	readonly inboxNextTurn?: readonly DshIdeInboxMessage[];
	/** 官方 `inbox` 投影里的 `next-step`（排队等下一个 step 的转向输入）。 */
	readonly inboxNextStep?: readonly DshIdeInboxMessage[];
}

/**
 * 排队中的一条输入（官方 `UserMessage` 的投影）。
 *
 * 只保留渲染需要的字段：稳定 `id`、来源 kind、以及**内容块**。
 * 内容块原样保留（text / image / file），渲染层据此画出与官方 `QueueDock` 同形的行；
 * 不在这里翻译成某种本地结构，避免丢失官方块类型。
 */
export interface DshIdeInboxMessage {
	readonly id: string;
	readonly sourceKind: string;
	readonly content: readonly DshIdeInboxBlock[];
}

/**
 * 排队消息里的一个内容块（官方 `ContentBlock` 的 JSON 面）。
 *
 * **不做本地联合收窄**：官方块类型是运行时开放的（`text` / `image` / `file` / 其它），
 * 收窄会让官方新增类型被静默丢掉，也会让「原样透传」变成一句空话。
 * 只要求是可 JSON 化的对象且 `type` 非空——这正是渲染层分派所需的最小事实。
 */
export type DshIdeInboxBlock = Readonly<Record<string, unknown>> & { readonly type: string };

/**
 * 修改排队输入的动作（官方 `QueueAction` 的线协议投影）。
 *
 * `edit` 只接受**非空纯文本**：官方类型就是 `readonly TextBlock[]`，
 * 附件不参与编辑——把它们塞进编辑会造出官方没有的形状。
 */
export type DshIdeQueueAction =
	| { readonly kind: 'edit'; readonly text: string }
	| { readonly kind: 'remove' }
	| { readonly kind: 'steer' };

/** 官方 `ui-user-questions` 的 `QuestionReplyQuestion`：回答回执里被问到的题。 */
export interface DshIdeQuestionReplyQuestion {
	readonly id: string;
	readonly question: string;
	readonly header?: string;
}

/** 官方 `QuestionReplyAnswer`：一题的结构化答案。空 `selected` 且无 `custom` 表示用户跳过。 */
export interface DshIdeQuestionReplyAnswer {
	readonly id: string;
	readonly selected: readonly string[];
	readonly custom?: string;
}

/** 官方 `ui-chat` 的 `turn-process`：一个 Turn 的过程锚点与计数（过程组行的数据）。 */
export interface DshIdeTurnProcessNode extends DshIdeNodeBase {
	readonly kind: 'turn-process';
	readonly turn: number;
	readonly controlAnchorSeq?: number;
	readonly processStartSeq?: number;
	readonly answerAnchorSeq?: number;
	readonly answerStep: number;
	/** 节点层看不到 assistant 块里的 reasoning，官方同样固定 false。 */
	readonly inlineReasoning: false;
	readonly messageCount: number;
	readonly toolCallCount: number;
	readonly subagentCount: number;
	/**
	 * `turn/end.reason.kind`（`completed | aborted | interrupted | error | ...`）。
	 *
	 * 官方 `turnProcessAlwaysOpen(node)` 读的是 `location.turn.status === 'open'` 与
	 * `location.turn.end.data.reason.kind`：进行中、被中止、被中断、失败的 Turn
	 * **不允许整段收起**。本仓的节点层看不到 `turn.status`，因此把已结算的原因带在节点上；
	 * 没有该字段即表示这个 Turn 还没有 `turn/end`（仍在进行）。
	 */
	readonly endReason?: string;
}

/** 官方 `ui-chat` 的 `manual-compaction`：`/compact` 命令行与它产生的压缩检查点。 */
export interface DshIdeManualCompactionNode extends DshIdeNodeBase {
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

/** 官方 `ui-chat` 的 `turn-tail`：已完成 Turn 的动作行与扩展尾部。 */
export interface DshIdeTurnTailNode extends DshIdeNodeBase {
	readonly kind: 'turn-tail';
	readonly turn: number;
	/** 收尾答复的正文；没有带正文的收尾答复时省略。 */
	readonly closing?: string;
	/**
	 * 收尾答复那条 durable 消息的 messageId。
	 *
	 * 官方 `TurnTailNodeView` 用 `closing.finalNode.messageId` 给
	 * `conversation.chat.assistant-actions` 寻址；中断冻结的部分回复没有 messageId，
	 * 此时官方不给动作行，这里同样省略。
	 */
	readonly closingMessageId?: string;
	/** 收尾答复之后仍有工具/重试/错误，或没有收尾答复（官方同一判据）。 */
	readonly branchUnavailable?: true;
	/** 该 Turn 的聚合用量（官方 `deriveTurnTokenUsage`）；没有任何增量时省略。 */
	readonly tokenUsage?: {
		readonly input?: number;
		readonly output?: number;
		readonly cacheRead?: number;
		readonly cacheWrite?: number;
		readonly reasoning?: number;
	};
}

/** 官方 `ui-chat` 的 `system-prompt`：一次模型请求的完整系统提示，或历史内的提示更新。 */
export interface DshIdeSystemPromptNode extends DshIdeNodeBase {
	readonly kind: 'system-prompt';
	readonly text: string;
	/** 历史内的提示更新（对齐官方 `SystemPromptState.introduced.update`）。 */
	readonly update?: true;
}

/** 官方 `ui-workflow-run` 的 `workflow-run`：顶层运行与实际启动的成员。 */
export interface DshIdeWorkflowRunNode extends DshIdeNodeBase {
	readonly kind: 'workflow-run';
	readonly runId: string;
	readonly name: string;
	readonly status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
	readonly phases: readonly {
		readonly key: string;
		readonly phase: string | null;
		readonly members: readonly {
			readonly seq: number;
			readonly label: string;
			readonly childId: string;
			readonly status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
		}[];
	}[];
}

/** 官方 `ui-plan` 的 `submitted-plan`：`exit_plan_mode` 提交的完整计划。 */
export interface DshIdeSubmittedPlanNode extends DshIdeNodeBase {
	readonly kind: 'submitted-plan';
	readonly callId: string;
	readonly title: string;
	readonly markdown: string;
	readonly turn?: number;
}

/** 官方 `ui-goal` 的 `command-input`：人工输入的 `/goal` 命令行，不是模型回合。 */
export interface DshIdeCommandInputNode extends DshIdeNodeBase {
	readonly kind: 'command-input';
	readonly commandId: string;
	/** 命令原文，去掉尾部解析空白。 */
	readonly text: string;
}

/**
 * 一次已作答问卷的回执（官方 Chat 层 `question-reply`）。
 *
 * 官方有两种来源：`ask_user_question` 的工具结果（同一次等待内作答），以及
 * `source.kind === 'user-question-reply'` 的迟到人工回复。两者都要求回执覆盖整份题目，
 * 否则该调用保留普通工具卡。
 */
export interface DshIdeQuestionReplyNode extends DshIdeNodeBase {
	readonly kind: 'question-reply';
	readonly callId: string;
	readonly questions: readonly DshIdeQuestionReplyQuestion[];
	readonly answers: readonly DshIdeQuestionReplyAnswer[];
	/** 模型可见的原始文本；回执读不出来时按纯文本显示。 */
	readonly text: string;
}

export type DshIdeConversationNode =
	| (DshIdeNodeBase & { readonly kind: 'user' | 'steering'; readonly content: readonly DshIdeContentBlock[]; readonly source?: unknown })
	| (DshIdeNodeBase & {
		readonly kind: 'context';
		readonly content: readonly DshIdeContentBlock[];
		readonly source?: unknown;
		readonly producer?: { readonly role: string; readonly label: string | null };
		readonly form?: string | null;
	})
	| (DshIdeNodeBase & {
		readonly kind: 'assistant';
		readonly turn: number;
		readonly step: number;
		readonly blocks: readonly DshIdeAssistantBlock[];
		readonly usage?: DshIdeTokenUsageDelta;
		readonly providerMetadata?: { readonly provider: string; readonly model: string };
		readonly interrupted?: true;
	})
	| (DshIdeNodeBase & {
		readonly kind: 'tool-call';
		readonly callId: string;
		readonly parentCallId?: string;
		readonly name: string;
		readonly phase: 'preparing' | 'start';
		readonly step?: number;
		readonly argsRaw?: string;
		readonly args?: unknown;
	})
	| (DshIdeNodeBase & {
		readonly kind: 'tool-result';
		readonly callId: string;
		readonly parentCallId?: string;
		/**
		 * Wire 工具名。**允许空串**：官方 `ToolResultNode.name` 的语义是
		 * "empty when that call left the loaded window"（`ui-conversation/src/client/contract/records.ts:163-176`）——
		 * 视图从会话中途打开、配对 `tool/call` 不在窗口内时官方本来就给 `''`
		 * （`ui-chat/src/client/conversation-nodes/tool.ts` 的 `rootResult`：`name: previous?.name ?? ''`）。
		 * 真机验证时这条被过严的校验器拒成了 `dsh-ide/invalid-argument`（见手册 2-E 记录）。
		 */
		readonly name: string;
		readonly args: unknown;
		readonly call?: { readonly name: string; readonly argsRaw: string } | null;
		readonly callTime?: number | null;
		readonly content: readonly DshIdeContentBlock[];
		readonly isError: boolean;
		readonly error?: { readonly name: string; readonly code: string; readonly reason?: string };
		readonly subCalls: readonly DshIdeConversationNode[];
	})
	| (DshIdeNodeBase & {
		readonly kind: 'command';
		readonly commandId: string;
		readonly name: string | null;
		readonly args: string | null;
		readonly outcome: { readonly kind: 'success' | 'error'; readonly text?: string } | null;
	})
	| (DshIdeNodeBase & {
		readonly kind: 'compaction';
		readonly summary: string | null;
		readonly summaryEventSeq?: number | null;
		readonly shadowedItemCount?: number | null;
		readonly shadowedTokenCount?: number | null;
	})
	| (DshIdeNodeBase & {
		readonly kind: 'model-retry';
		readonly retry?: number;
		readonly maxRetries?: number;
		readonly delayMs?: number;
		readonly mode?: 'normal' | 'always';
		readonly retryState?: 'scheduled' | 'started' | 'cancelled';
		readonly failure?: { readonly message: string; readonly code?: string };
	})
	| (DshIdeNodeBase & { readonly kind: 'turn-error'; readonly turn: number; readonly step: number; readonly message: string; readonly code?: string })
	| (DshIdeNodeBase & { readonly kind: 'turn-max-tokens'; readonly turn: number; readonly step: number })
	| (DshIdeNodeBase & { readonly kind: 'inherited-history' })
	// 官方 `turn-trigger`：非人类消息被认领为开启一个 Turn 时的呈现。
	// 真源 `message.ts` 的 `buildViewNode` 只在 `waking === true` 或
	// `source.kind === 'retry'` 且 content 为空时产出它；`source` 原样保留，
	// 由渲染层按 `source.kind` 选图标（见 `turn-trigger.ts` 的 `turnTriggerDetails`）。
	| (DshIdeNodeBase & {
		readonly kind: 'turn-trigger';
		readonly content: readonly DshIdeContentBlock[];
		readonly source?: unknown;
		readonly producer?: { readonly role: string; readonly label: string | null };
		readonly form?: string | null;
	})
	| DshIdeQuestionReplyNode
	| DshIdeCommandInputNode
	| DshIdeSubmittedPlanNode
	| DshIdeWorkflowRunNode
	| DshIdeSystemPromptNode
	| DshIdeTurnTailNode
	| DshIdeManualCompactionNode
	| DshIdeTurnProcessNode;

/** 官方 `deliverables/presented`。 */
export interface DshIdeDeliverableView {
	readonly turn: number;
	readonly callId: string;
	readonly files: readonly { readonly path: string; readonly description?: string }[];
}

/** 官方 `PlanProjection`。 */
export interface DshIdePlanView {
	readonly active: boolean;
	readonly pending: boolean;
}

/** 官方 `GoalProjection`，外加实时视图才有的 `activation`。 */
export interface DshIdeGoalView {
	readonly goal: {
		readonly id: string;
		readonly revision: number;
		readonly objective: string;
		readonly phase: 'active' | 'paused' | 'blocked' | 'complete';
		readonly maxGoalRounds: number;
		readonly blockedReason?: { readonly code: string; readonly message: string };
	};
	readonly roundsStarted: number;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly activation?: 'armed' | 'disarmed';
}

/** 官方 `WorktreeCreation` 的一行：这个会话创建或继承的工作树。 */
export interface DshIdeWorktreeView {
	readonly path: string;
	readonly branch: string;
	readonly baseCommit: string;
	readonly repositoryRoot: string;
	/** false 表示它来自 fork 继承的前缀，不是本会话创建的。 */
	readonly created: boolean;
}

/** 官方 `TeamTaskView`（共享任务板的一行）。 */
export interface DshIdeTeamTaskView {
	readonly id: string;
	readonly revision: number;
	readonly subject: string;
	readonly description: string;
	readonly status: string;
	readonly ready: boolean;
	readonly ownerName?: string;
}

/** 官方 `agentTeam` 投影：是否启用与当前任务板。 */
export interface DshIdeTeamView {
	readonly enabled: boolean;
	readonly tasks: readonly DshIdeTeamTaskView[];
	readonly failure?: string;
}

/** 官方 `TodoItem`。 */
export interface DshIdeTodoView {
	readonly content: string;
	readonly status: 'pending' | 'in_progress' | 'completed';
}

/**
 * 会话技能目录的一行。对齐官方 `SkillEntry`（`session-controller` 的 `skills/list`）：
 * 该目录只有 name / description / whenToUse / modelInvocable，没有 provider。
 * `userInvocable` 恒为 true（官方目录已按 `isUserInvocable` 过滤）。
 * `provider` 只在调用方另外带了来源时出现。
 */
export interface DshIdeSkillView {
	readonly name: string;
	readonly description: string;
	readonly whenToUse?: string;
	readonly modelInvocable: boolean;
	readonly userInvocable: boolean;
	readonly provider?: string;
}

/** 官方 `TokenUsage`：单次调用的增量，不是会话累加。 */
export interface DshIdeTokenUsageDelta {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly totalTokens?: number;
	readonly cacheReadTokens?: number;
	readonly cacheWriteTokens?: number;
	readonly reasoningTokens?: number;
}

/** 官方 `QuotaNoticeState`。`message` 由 Host 填好当前语言的句子，缺省时界面自己用 code。 */
export interface DshIdeQuotaNotice {
	readonly code: 'QUOTA' | 'ACCOUNT_QUOTA';
	readonly seq: number;
	readonly message?: string;
}

/** 与 `projectDshIdeComposer` 的返回值同形，可随快照下发。 */
export interface DshIdeComposerView {
	readonly model: {
		readonly current: { readonly provider: string; readonly model: string; readonly effort?: string } | null;
		readonly groups: readonly {
			readonly id: string;
			readonly name: string;
			readonly models: readonly {
				readonly id: string;
				readonly name: string;
				readonly efforts: readonly { readonly id: string; readonly name: string }[];
				readonly defaultEffort?: string;
			}[];
		}[];
	};
	readonly permission: { readonly current: string | null; readonly options: readonly { readonly value: string; readonly name: string }[] } | null;
	readonly team: { readonly enabled: boolean; readonly confirmDisable: boolean } | null;
	readonly preset: { readonly current: string | null; readonly options: readonly { readonly id: string; readonly name: string }[] } | null;
}

/** 官方 `AskUserQuestionAnswer`。多选就是 `selected` 里多于一项。 */
export interface DshIdeQuestionAnswerItem {
	readonly id: string;
	readonly selected: readonly string[];
	readonly custom?: string;
}

export interface DshIdeQuestionAnswer {
	readonly answers: readonly DshIdeQuestionAnswerItem[];
}

/**
 * 每个 DshIdeMethod 的命名参数 schema。TS 类型侧（这是唯一真源，union 由其派生）。
 * 运行侧用 `DSH_IDE_METHOD_KEYS` 同一份 key 列表做 exactRecord。
 */
export interface DshIdeMethodArgs {
	/**
	 * 提交一条用户消息。sessionId 是点击时绑定的会话，不跟随之后换上的会话。
	 * `requestId` 由 IDE 生成并在重试/核对时保持不变：Host 用它作为内核请求 id，
	 * 断线后可以用同一个 id 判断这次提交是否已经到达。
	 */
	submit: { text: string; sessionId: string; requestId?: string; attachments?: readonly DshIdeImageAttachmentRef[] };
	/** 中断点击时绑定的那条会话，不跟随之后换上的会话。 */
	interrupt: { sessionId: string };
	/**
	 * 修改一条**仍在排队**的输入（官方 `session.updateQueue`，`@Remote('updateQueue')`）。
	 *
	 * 对齐官方 `SessionUpdateQueueRequest`（`api/session-controller/src/types.ts`）：
	 * `itemId` 是排队消息的 `MessageId`，`action` 是三选一——
	 * `edit`（**非空纯文本**替换内容）、`remove`、`steer`（立刻插队到当前 Turn）。
	 * 官方失败码：`session/queue-item-not-found`、`session/steer-unavailable`。
	 */
	updateQueue: { sessionId: string; itemId: string; action: DshIdeQueueAction };
	/** 恢复点击时绑定的会话。 */
	resume: { sessionId: string };
	/** 开新会话。 */
	newSession: { workspace?: string; options?: unknown };
	/** 从某点 fork 会话。 */
	fork: { sessionId: string; point?: string };
	/**
	 * 把模型可见上下文退到某条用户消息。
	 * core 没有这个 remote；Host 在装了 `dsh-rewind-plugin` 之后调用它的 `rewind-plugin` 命令。
	 * `to` 是该用户消息的绝对 seq（可带 `@`）。
	 */
	rewind: { sessionId: string; to: string };
	/**
	 * 向前读取一页历史（官方 `session/page`，只读）。
	 *
	 * 形状对齐官方 `SessionPageRequest{address, beforeSeq?, maxMessages?}`
	 * （`api/session-controller/src/types.ts:469-478`）：`beforeSeq` 是**数值**游标
	 * （不是旧的字符串 `before`），`maxMessages` 限定本页条数。省略 `beforeSeq`
	 * 时官方按观察到的日志末端取页。
	 * `throughSeq` 是**包含式日志切点**：给出时只读该 seq 及之前的历史（「按固定切点
	 * 只读查看」的官方支撑）；省略时按观察到的日志末端取页。三者可组合：
	 * `throughSeq` 定切点、`beforeSeq` 定向后翻页、`maxMessages` 限本页条数。
	 * `turnWindow` 对齐官方历史窗：凑满 `minMessages` 且跨过 `minTurns` 个 `turn/start`
	 * 才截断，上限仍是 `maxMessages`。不传时官方只按消息条数截，一页会停在同一个回合内部。
	 *
	 * 返回值是 `DshIdeLoadOlderResult`。`session/page` 是独立只读端点，不重推
	 * `follow` 的 opening snapshot，所以分页内容必须随 `call` 返回，不能等 snapshot。
	 * 下一页游标用已加载记录的最小 `seq` 作为 `beforeSeq`，协议不传官方 `cursor`。
	 */
	loadOlder: {
		sessionId: string;
		throughSeq?: number;
		beforeSeq?: number;
		maxMessages?: number;
		turnWindow?: { readonly minMessages: number; readonly minTurns: number };
	};
	/**
	 * 决议审批请求。
	 * `agentId` / `callId` 只用于和通知对上号；真正的 `Agent` 对象与 `AbortSignal` 不进线协议。
	 */
	answerApproval: { requestId: string; decision: 'approve' | 'reject'; reason?: string; agentId?: string; callId?: string };
	/** 决议问卷。`answer` 是官方 `AskUserQuestionAnswer`，多选放在 `selected` 数组里。 */
	answerQuestion: { requestId: string; answer: DshIdeQuestionAnswer };
	/** 取消一个进行中的请求（审批/问卷/生成等）。 */
	cancelRequest: { requestId: string };
	/** 设置模型。 */
	setModel: { sessionId: string; model: string };
	/** 设置 effort。 */
	setEffort: { sessionId: string; effort: string };
	/** 设置权限预设；预设名作为 `/permission <preset>` 的唯一参数（§8.10.10 前置②，禁空白/斜杠）。 */
	setPermissionPreset: { sessionId: string; preset: string };
	/** 运行斜杠命令；`command` 为不带前导 `/` 的命令名，`args` 以单空格拼成 rawInput（§8.10.10 前置①②）。 */
	runCommand: { sessionId: string; command: string; args?: readonly string[]; attachments?: readonly DshIdeImageAttachmentRef[] };
	/**
	 * 列出一个工作区的可见会话，返回 readonly IDshIdeSessionSummary[]。
	 * workspace 是 IDE 当前打开的文件夹。没给出时才退回已绑定会话所在工作区；
	 * 两条都对不上，或工作区归属不明，返回空数组。
	 */
	listSessions: { workspace?: string };
	/** 桌面端聊天展示设置：工作步骤、收起时机、收起后的回复、代码工作视图。 */
	presentationSettings: Record<string, never>;
	/** 删除会话（直接删除，不入回收站）。 */
	deleteSession: { sessionId: string };
	/** 归档一个已知会话（官方 `workspaceRegistry.archiveSession`）；返回**完整**归档集合。 */
	archiveSession: { sessionId: string };
	/** 恢复一个已归档会话（官方 `workspaceRegistry.unarchiveSession`）；返回**完整**归档集合。 */
	unarchiveSession: { sessionId: string };
	/**
	 * 分批检索会话（官方 `session/search`，只读）。
	 *
	 * 形状对齐官方 `SessionSearchRequest{query}` → `SessionSearchValue{items, hasMore}`
	 * （`api/session-controller/src/types.ts:255-263`）：每项为 `{sessionId, snippet}`
	 * （`:168-171`），`hasMore` 表示还有下一批。官方单批上限 20 条
	 * （`SESSION_SEARCH_RESULT_LIMIT`）、snippet 上限 240 码点。
	 * 该能力依赖宿主挂载 `@deepseek-ai/dsh-session-query`；未挂载时官方抛
	 * `gateway/internal`，本契约原样透传该失败，不伪造空结果。
	 */
	searchSessions: { query: string };
	/**
	 * 读取输入框控件状态（只读）。
	 *
	 * 一次取齐模型目录与当前选择、权限预设、团队开关、开聊前的智能体预设。
	 * 缺哪一项，投影里对应字段就是 `null`，界面藏起该控件，不伪造选项。
	 */
	composerState: { sessionId: string };
	/** 开关当前根会话的智能体团队。`enabled` 必须是布尔值。 */
	setTeamEnabled: { sessionId: string; enabled: boolean };
	/** 在会话尚未开始前切换智能体预设。已开聊时官方拒绝，原样透传。 */
	setAgentPreset: { sessionId: string; preset: string };
	/** 列出可用模型。 */
	listModels: { workspace?: string };
	/** 列出当前绑定会话的 DSH 命令（agent-scoped）。 */
	listCommands: { sessionId: string; workspace?: string };
	/** 取某行的完整内容（折叠行回 Host 取详情）。 */
	fetchRowDetail: { rowId: string };
	/**
	 * 读取一张 durable 图片附件的字节（官方 `session/attachment` 的进程内等价物）。
	 * 只按 attachmentId 授权读取，不接受路径/URL；返回 base64，绝不返回本地文件路径。
	 */
	readAttachment: { sessionId: string; attachment: DshIdeImageAttachmentRef };
	/** 主动刷新快照。 */
	refreshSnapshot: Record<string, never>;
	/** 读取 DeepSeek 账号投影（登录态）；`client` 为官方 `AccountClientMetadata` 三元组。 */
	accountGetState: { client: IDshAccountClientMetadataArgs };
	/** 读取账号资料（显示名 / 联系方式 / 头像 URL）；仅在 `accountGetState` 为已登录时调用。 */
	accountGetProfile: { client: IDshAccountClientMetadataArgs };
	/** 开始官方浏览器授权登录；返回包含 `attempt.authorizeUrl` 的账号视图。 */
	accountStartSignIn: { client: IDshAccountClientMetadataArgs; callbackOrigin: string; loginSource: 'web' | 'desktop' };
	/** 取消一次进行中的登录尝试。 */
	accountCancelSignIn: { attemptId: string };
	/** 官方 `session/rename`。 */
	renameSession: { sessionId: string; title: string };
	/** 归档管理器 `setSessionFavorite`。只传会话，Host 按当前收藏状态切换。 */
	setSessionFavorite: { sessionId: string };
	/**
	 * 官方 `workspace/pinSession` 与 `unpinSession`。
	 * `pinned` 缺省时按当前状态切换；给出布尔值时设成该状态（已经是该状态则不再打一次）。
	 */
	setSessionPinned: { sessionId: string; pinned?: boolean };
	/** 官方工作区名单，供「移动到工作区」。 */
	listWorkspaces: Record<string, never>;
	/** 归档管理器 `workspaceRegistry.moveSessionToWorkspace`。 */
	moveSession: { sessionId: string; workspaceId: string };
	/** 官方 `session/openWorkspacePath`，打开该会话的工作区目录。 */
	openSessionPath: { sessionId: string };
	/** 依赖插件能力探测：Host 读官方服务/命令的实际装载状态后返回四项布尔。 */
	capabilities: Record<string, never>;
	/** 读取官方 `speech/catalog`：provider、当前选择和录音上限。不选择后备识别器。 */
	speechCatalog: Record<string, never>;
	/**
	 * 把一段 WAV 交给官方 `speech/transcribe`。
	 * `request` 对齐官方 `TranscriptionRequest`，不带 Agent，也不提交会话。
	 */
	speechTranscribe: { request: { audioBase64: string; providerId?: string; language?: string } };
	/**
	 * 把一张尚未入库的图片交给官方 `attachments.saveImages` 入库，返回可提交的引用。
	 * 只接受受支持的图片媒体类型；调用方不得自行伪造 attachmentId。
	 */
	saveImageAttachment: { mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string; name?: string };
}

/**
 * 官方 `AccountClientMetadata`（账号接口的调用方身份）。
 *
 * 依据 DSH `deepseekAccount` 服务（`cordis_inspect_query` Service.listService 实测）与
 * `packages/credentials/deepseek-account-platform`：Host 用它派生 Platform 请求头
 * （`x-client-version` / `x-client-locale` / `x-client-timezone-offset`）。
 * 三字段**都必填**，且不含任何密钥——账号凭据只存在于 Host，IDE 侧永远拿不到。
 */
export interface IDshAccountClientMetadataArgs {
	/** 客户端版本号，映射到 `x-client-version`。 */
	readonly version: string;
	/** 语言/地区，映射到 `x-client-locale`（如 `zh-CN`）。 */
	readonly locale: string;
	/** 相对 UTC 的时区偏移秒数，映射到 `x-client-timezone-offset`。 */
	readonly timezoneOffsetSeconds: number;
}

/** 客户端版本号的兜底值：无构建注入时也要给出非空串，否则 Host 会拒绝该身份。 */
const DSH_IDE_FALLBACK_CLIENT_VERSION = 'dsh-ide';

/**
 * 构造官方 `AccountClientMetadata` 调用方身份（D18：归并入协议真源，不再有第二份文件）。
 *
 * 依据（只读核对 DSH `packages/client/ui-settings-account/src/client/client-metadata.ts`）：
 * `Date.getTimezoneOffset()` 返回「UTC 以西的分钟数」，Platform 要的是「UTC 以东的秒数」，
 * 故取负再乘 60。三字段都必填、不含任何密钥——账号凭据只存在于 Host。
 *
 * @param locale 当前界面语言（如 `zh-CN`）；Host 会再收敛成 Platform 的线上 locale。
 * @param version 客户端构建版本；缺省时用本插件标识兜底。
 */
export function dshAccountClientMetadata(locale?: string, version?: string): IDshAccountClientMetadataArgs {
	return {
		version: typeof version === 'string' && version !== '' ? version : DSH_IDE_FALLBACK_CLIENT_VERSION,
		locale: typeof locale === 'string' && locale !== '' ? locale : 'zh-CN',
		// 与官方实现同一口径：偏移取反、分钟转秒。
		timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
	};
}

/** 方法白名单（由 DshIdeMethodArgs 键派生，单一真源）。 */
export type DshIdeMethod = keyof DshIdeMethodArgs;

/** 必须匹配发起视图的会话；带显式可见行 ID 的操作不在这组。 */
export const DSH_IDE_VIEW_BOUND_METHODS: readonly DshIdeMethod[] = [
	'submit', 'interrupt', 'resume', 'rewind', 'loadOlder', 'setModel', 'setEffort',
	'setPermissionPreset', 'runCommand', 'composerState', 'setTeamEnabled', 'setAgentPreset',
	'readAttachment',
];

/** 每个 method 的 exactRecord 允许字段（与 DshIdeMethodArgs 同步；空数组=无字段）。 */
/**
 * 官方历史窗（session-controller README）：
 * 开窗和向更早翻页都至少覆盖 50 条 `user/message`+`assistant/message`，
 * 并且跨过 2 个 `turn/start`；单页上限 500，避免一个全是工具步骤的回合
 * 把人类提问和更早的回合挡在第一屏外面。
 */
export const DSH_IDE_HISTORY_MAX_MESSAGES = 500;
export const DSH_IDE_HISTORY_TURN_WINDOW = { minMessages: 50, minTurns: 2 } as const;

const DSH_IDE_METHOD_KEYS: Record<DshIdeMethod, readonly string[]> = {
	submit: ['text', 'sessionId', 'requestId', 'attachments'],
	interrupt: ['sessionId'],
	updateQueue: ['sessionId', 'itemId', 'action'],
	resume: ['sessionId'],
	newSession: ['workspace', 'options'],
	fork: ['sessionId', 'point'],
	rewind: ['sessionId', 'to'],
	loadOlder: ['sessionId', 'throughSeq', 'beforeSeq', 'maxMessages', 'turnWindow'],
	answerApproval: ['requestId', 'decision', 'reason', 'agentId', 'callId'],
	answerQuestion: ['requestId', 'answer'],
	cancelRequest: ['requestId'],
	setModel: ['sessionId', 'model'],
	setEffort: ['sessionId', 'effort'],
	setPermissionPreset: ['sessionId', 'preset'],
	runCommand: ['sessionId', 'command', 'args', 'attachments'],
	listSessions: ['workspace'],
	presentationSettings: [],
	deleteSession: ['sessionId'],
	archiveSession: ['sessionId'],
	unarchiveSession: ['sessionId'],
	searchSessions: ['query'],
	composerState: ['sessionId'],
	setTeamEnabled: ['sessionId', 'enabled'],
	setAgentPreset: ['sessionId', 'preset'],
	listModels: ['workspace'],
	listCommands: ['sessionId', 'workspace'],
	fetchRowDetail: ['rowId'],
	readAttachment: ['sessionId', 'attachment'],
	refreshSnapshot: [],
	accountGetState: ['client'],
	accountGetProfile: ['client'],
	accountStartSignIn: ['client', 'callbackOrigin', 'loginSource'],
	accountCancelSignIn: ['attemptId'],
	renameSession: ['sessionId', 'title'],
	setSessionFavorite: ['sessionId'],
	setSessionPinned: ['sessionId', 'pinned'],
	listWorkspaces: [],
	moveSession: ['sessionId', 'workspaceId'],
	openSessionPath: ['sessionId'],
	capabilities: [],
	speechCatalog: [],
	speechTranscribe: ['request'],
	saveImageAttachment: ['mediaType', 'data', 'name'],
};

// ---------------------------------------------------------------------------
// 校验原语（平移自 dsh-TUI tui-channel.js，保持行为一致）
// ---------------------------------------------------------------------------

/** 拒绝未知字段（仅允许 `x-` 前缀扩展），要求纯对象、非数组、非 null。 */
export function exactRecord(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object`);
	}
	// 必须是纯对象：带原型的对象（`Object.create({...})`、class 实例）会有「不在自有键里、
	// 但 `record['field']` 读得到」的属性。`Object.keys` 只列自有键，于是 `exactRecord`
	// 放行之后，调用方读 `record['sessionId']` 会拿到原型上的值——等于绕过「字段必须显式提供」
	// 的检查，可以伪造会话 id、绕过必填校验。与 `jsonValue` 的 plain-object 要求保持一致。
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${label} must be a plain object`);
	}
	const obj = value as Record<string, unknown>;
	// 显式 undefined 一律省略：线协议不允许出现值为 undefined 的字段（JSON 会静默丢弃，
	// 其存在即说明生产端未省略），fail-closed 拒绝。先于未知字段检查，保证判据确定。
	for (const key of Object.keys(obj)) {
		if (obj[key] === undefined) {
			throw new TypeError(`${label} must omit explicit undefined field ${JSON.stringify(key)}`);
		}
	}
	const unknown = Object.keys(obj).filter(key => !allowed.includes(key) && !key.startsWith('x-'));
	if (unknown.length > 0) {
		throw new TypeError(`${label} contains unknown field ${JSON.stringify(unknown[0])}`);
	}
	// `x-` 是留给客户端扩展的命名空间（见 `dshAccountClientMetadata`），但扩展值必须是
	// 短标量。不设限的话，一个 10 MB 的 `x-anything` 字段会通过校验并随帧跨进程传输——
	// 扩展点不该变成绕过所有大小检查的后门。
	const extensions = Object.keys(obj).filter(key => key.startsWith('x-'));
	if (extensions.length > MAX_EXTENSION_FIELDS) {
		throw new TypeError(`${label} carries ${extensions.length} "x-" fields, at most ${MAX_EXTENSION_FIELDS} allowed`);
	}
	for (const key of extensions) {
		const item = obj[key];
		if (typeof item === 'string') {
			if (item.length > MAX_EXTENSION_CHARS) {
				throw new TypeError(`${label}.${key} exceeds ${MAX_EXTENSION_CHARS} characters`);
			}
		} else if (typeof item !== 'number' && typeof item !== 'boolean' && item !== null) {
			throw new TypeError(`${label}.${key} must be a short scalar`);
		}
	}
	return obj;
}

/** 有限数、纯对象、无环；class 实例（非 Object.prototype）一律拒绝。 */
export function jsonValue(value: unknown, label: string, ancestors: Set<object>): void {
	jsonValueAt(value, label, ancestors, 0);
}

/**
 * 嵌套深度上限。
 *
 * `jsonValue` 是递归校验；不设限时一个十万层嵌套的对象会让它自己栈溢出
 * （`RangeError: Maximum call stack size exceeded`），把「校验失败」变成「进程崩溃」。
 * 32 层足够任何真实配置（官方 options 通常是两三层）。
 */
const MAX_JSON_DEPTH = 32;

/**
 * JSON 值里单个对象/数组的条目数上限。
 *
 * 不设限时十万个键的对象也能通过；校验本身要遍历它们，之后还要序列化。
 * 10000 远大于任何真实配置。
 */
const MAX_JSON_ITEMS = 10000;

/** JSON 对象的单个键名长度上限（完整路径也会随之膨胀，所以键名也要有界）。 */
const MAX_JSON_KEY_CHARS = 256;

/**
 * 任意单个字符串字段的长度上限。
 *
 * `nonEmptyString` / `optionalString` 是所有字符串字段的统一入口，在这里挡一道即可
 * 覆盖全部方法。不设限时 50 MB 的 `submit.text` 能通过校验并跨进程传输。
 * 1 MiB 远大于任何真实字符串字段。
 */
const MAX_STRING_CHARS = 1024 * 1024;

function jsonValueAt(value: unknown, label: string, ancestors: Set<object>, depth: number): void {
	if (depth > MAX_JSON_DEPTH) {
		throw new TypeError(`${label} exceeds ${MAX_JSON_DEPTH} levels of nesting`);
	}
	if (value === null || typeof value === 'boolean' || typeof value === 'string') {
		return;
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			throw new TypeError(`${label} must contain only finite numbers`);
		}
		return;
	}
	if (typeof value !== 'object') {
		throw new TypeError(`${label} must be a JSON value`);
	}
	const obj = value as object;
	if (ancestors.has(obj)) {
		throw new TypeError(`${label} must not contain cycles`);
	}
	ancestors.add(obj);
	try {
		if (Array.isArray(value)) {
			if (value.length > MAX_JSON_ITEMS) {
				throw new TypeError(`${label} exceeds ${MAX_JSON_ITEMS} array items`);
			}
			value.forEach((item, index) => jsonValueAt(item, `${label}[${index}]`, ancestors, depth + 1));
		} else {
			const prototype = Object.getPrototypeOf(obj);
			if (prototype !== Object.prototype && prototype !== null) {
				throw new TypeError(`${label} must contain only plain objects`);
			}
			const entries = Object.entries(obj);
			if (entries.length > MAX_JSON_ITEMS) {
				throw new TypeError(`${label} exceeds ${MAX_JSON_ITEMS} object keys`);
			}
			for (const [key, item] of entries) {
				if (key.length > MAX_JSON_KEY_CHARS) {
					throw new TypeError(`${label}.${key.slice(0, 16)}… key exceeds ${MAX_JSON_KEY_CHARS} characters`);
				}
				jsonValueAt(item, `${label}.${key}`, ancestors, depth + 1);
			}
		}
	} finally {
		ancestors.delete(obj);
	}
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new TypeError(`${label} must be a non-negative integer`);
	}
	return value as number;
}

/** 官方 `llm/retry.delayMs` 是有限非负实数（含小数），不是整数。 */
function nonNegativeFinite(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new TypeError(`${label} must be a non-negative finite number`);
	}
	return value;
}

/**
 * base64 载荷的字符数上限（约 140 MB）。
 *
 * 不是业务上限——图片与音频的合理大小由各调用方按场景决定。
 * 这里只挡明显失控的输入：Host 侧 `Buffer.from(data, 'base64')` 会为任意长度的
 * 字符串先分配内存，没有这道闸，一个坏掉的调用方就能让 Host 申请几个 GB。
 */
const MAX_BASE64_CHARS = 140 * 1024 * 1024;

/**
 * 单条提交的附件数量上限。
 *
 * Host 侧对每个附件各起一次读取与编码；超长数组等于把一次提交放大成任意多次 IO。
 * 64 足够任何真实消息（聊天客户端通常个位数）。
 */
const MAX_SUBMIT_ATTACHMENTS = 64;

/**
 * `x-` 扩展字段的字符串长度上限。
 *
 * 扩展点只用于客户端标识（版本、语言、时区偏移），256 字符足够；
 * 不设限会让它变成绕过所有大小检查的后门。
 */
const MAX_EXTENSION_CHARS = 256;

/**
 * 单个对象允许的 `x-` 扩展字段数量。
 *
 * 8 个足够客户端标识（版本/语言/时区/构建号等）；不设限时一万个 `x-` 键也能通过，
 * 每帧都要序列化它们。
 */
const MAX_EXTENSION_FIELDS = 8;

function nonEmptyString(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new TypeError(`${label} must be a non-empty string`);
	}
	// 统一长度上限：`nonEmptyString` / `optionalString` 是所有字符串字段的入口，
	// 在这里挡一道就能覆盖全部方法。不设限时 50 MB 的 `submit.text`、
	// `renameSession.title`、`searchSessions.query` 都能通过校验并跨进程传输。
	// 1 MiB 远大于任何真实字符串字段（最长的 `submit.text` 也远小于此）。
	if (value.length > MAX_STRING_CHARS) {
		throw new TypeError(`${label} exceeds ${MAX_STRING_CHARS} characters`);
	}
	return value;
}

function optionalString(value: unknown, label: string): void {
	if (value !== undefined) {
		nonEmptyString(value, label);
	}
}

function optionalBoolean(value: unknown, label: string): void {
	if (value !== undefined && typeof value !== 'boolean') {
		throw new TypeError(`${label} must be a boolean`);
	}
}

/**
 * 置顶的下一状态。
 *
 * 调用方给出 `pinned` 时以它为准，这样 IDE 列表上的钉子和 Host 记账不会各翻一次。
 * 缺省仍是切换，旧调用只传 sessionId 时行为不变。
 */
export function resolveDshSessionPin(currentlyPinned: boolean, requested: boolean | undefined): boolean {
	return typeof requested === 'boolean' ? requested : !currentlyPinned;
}

/**
 * 通道错误的可读文案。
 *
 * `DshRemoteError.message` 允许为空串（Host 只带 code 时）：此时退回 code，
 * 否则用户会看到一句只有冒号的「发送失败：」。
 */
export function dshErrorText(error: { readonly code?: string; readonly message?: string } | undefined, fallback: string): string {
	const message = typeof error?.message === 'string' ? error.message.trim() : '';
	if (message !== '') {
		return message;
	}
	const code = typeof error?.code === 'string' ? error.code.trim() : '';
	return code === '' ? fallback : code;
}

/** 有长度上限的字符串。optional 为真时允许缺省，但仍拒绝非字符串。 */
function boundedString(value: unknown, label: string, max: number, optional = false): void {
	if (value === undefined && optional) {
		return;
	}
	if (typeof value !== 'string') {
		throw new TypeError(`${label} must be a string`);
	}
	if (value.length > max) {
		throw new TypeError(`${label} exceeds ${max} characters`);
	}
}

/** 可选的绝对值整数（官方游标类字段：`SessionSeq` 等）。 */
function optionalNonNegativeInteger(value: unknown, label: string): void {
	if (value === undefined) {
		return;
	}
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`${label} must be a non-negative safe integer`);
	}
}

/** 可选的正整数（官方分页预算类字段：`maxMessages` 等）。 */
function optionalPositiveInteger(value: unknown, label: string): void {
	if (value === undefined) {
		return;
	}
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		throw new TypeError(`${label} must be a positive safe integer`);
	}
}

/**
 * 斜杠命令名 / 命令参数的中立约束（第 34 轮契约决定，§8.10.10 前置① ② ⑤）。
 * 官方 `parseCommand` 要求 `^/([a-z][a-z0-9_-]*)(\s|$)`（`interaction/commands/src/index.ts:125-131`）；
 * IDE 契约的 `command` 为**不带前导斜杠的命令名**，`args` 每项以单空格拼进 `rawInput`。
 * 因此两处都禁空白与 `/`，防止注入换行 / 多余斜杠把一次调用变成多次或越权命令。
 */
function commandToken(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(value)) {
		throw new TypeError(`${label} must be a lowercase slash-command token (no leading slash, no whitespace)`);
	}
	return value;
}

/**
 * 校验官方 `AccountClientMetadata`：三个非空/有限数字段，且不额外放宽。
 * 账号凭据不在此结构里（只在 Host），这里只描述「调用方身份」。
 */
function accountClientMetadata(value: unknown, label: string): void {
	const record = exactRecord(value, ['version', 'locale', 'timezoneOffsetSeconds'], label);
	for (const key of ['version', 'locale'] as const) {
		nonEmptyString(record[key], `${label}.${key}`);
	}
	const offset = record['timezoneOffsetSeconds'];
	if (typeof offset !== 'number' || !Number.isFinite(offset)) {
		throw new TypeError(`${label}.timezoneOffsetSeconds must be a finite number`);
	}
}

// ---------------------------------------------------------------------------
// 双向校验器
// ---------------------------------------------------------------------------

/**
 * 入参校验：在 `DshIdeChannel.call()` 入口使用。未知 method 抛错（绝不静默 no-op）。
 * 返回按 method 收窄的强类型参数；调用方可直接交给强类型 handler。
 */
export function validateDshIdeInput<K extends DshIdeMethod>(command: K, args: unknown): DshIdeMethodArgs[K] {
	if (!Object.prototype.hasOwnProperty.call(DSH_IDE_METHOD_KEYS, command)) {
		throw new TypeError(`DshIdeInput: method ${JSON.stringify(command)} is not defined (FEATURE_UNAVAILABLE)`);
	}
	const keys = DSH_IDE_METHOD_KEYS[command];
	const record = exactRecord(args, keys, `DshIdeInput.${command}`);
	if (DSH_IDE_VIEW_BOUND_METHODS.includes(command)) {
		nonEmptyString(record['sessionId'], `DshIdeInput.${command}.sessionId`);
	}
	switch (command) {
		case 'submit':
			nonEmptyString(record['text'], 'DshIdeInput.submit.text');
			nonEmptyString(record['sessionId'], 'DshIdeInput.submit.sessionId');
			optionalString(record['requestId'], 'DshIdeInput.submit.requestId');
			if (record['requestId'] !== undefined) {
				boundedString(record['requestId'], 'DshIdeInput.submit.requestId', 128);
			}
			if (record['attachments'] !== undefined) {
				if (!Array.isArray(record['attachments'])) {
					throw new TypeError('DshIdeInput.submit.attachments must be an array');
				}
				// 附件数量也要有上限：Host 侧会对每项各起一次读取与编码，
				// 一个超长数组等于把一次提交放大成任意多次 IO。64 足够任何真实消息。
				if (record['attachments'].length > MAX_SUBMIT_ATTACHMENTS) {
					throw new TypeError(`DshIdeInput.submit.attachments exceeds ${MAX_SUBMIT_ATTACHMENTS} items`);
				}
				record['attachments'].forEach((item, index) => imageAttachmentRef(item, `DshIdeInput.submit.attachments[${index}]`));
			}
			break;
		case 'resume':
			optionalString(record['sessionId'], 'DshIdeInput.resume.sessionId');
			break;
		case 'newSession':
			optionalString(record['workspace'], 'DshIdeInput.newSession.workspace');
			if (record['options'] !== undefined) {
				jsonValue(record['options'], 'DshIdeInput.newSession.options', new Set());
			}
			break;
		case 'fork':
			nonEmptyString(record['sessionId'], 'DshIdeInput.fork.sessionId');
			optionalString(record['point'], 'DshIdeInput.fork.point');
			break;
		case 'rewind':
			nonEmptyString(record['sessionId'], 'DshIdeInput.rewind.sessionId');
			nonEmptyString(record['to'], 'DshIdeInput.rewind.to');
			break;
		case 'loadOlder':
			nonEmptyString(record['sessionId'], 'DshIdeInput.loadOlder.sessionId');
			optionalNonNegativeInteger(record['beforeSeq'], 'DshIdeInput.loadOlder.beforeSeq');
			optionalPositiveInteger(record['maxMessages'], 'DshIdeInput.loadOlder.maxMessages');
			optionalNonNegativeInteger(record['throughSeq'], 'DshIdeInput.loadOlder.throughSeq');
			if (record['turnWindow'] !== undefined) {
				const window = exactRecord(record['turnWindow'], ['minMessages', 'minTurns'], 'DshIdeInput.loadOlder.turnWindow');
				positiveInteger(window['minMessages'], 'DshIdeInput.loadOlder.turnWindow.minMessages');
				positiveInteger(window['minTurns'], 'DshIdeInput.loadOlder.turnWindow.minTurns');
			}
			break;
		case 'answerApproval':
			nonEmptyString(record['requestId'], 'DshIdeInput.answerApproval.requestId');
			if (record['decision'] !== 'approve' && record['decision'] !== 'reject') {
				throw new TypeError('DshIdeInput.answerApproval.decision must be "approve" or "reject"');
			}
			optionalString(record['reason'], 'DshIdeInput.answerApproval.reason');
			optionalString(record['agentId'], 'DshIdeInput.answerApproval.agentId');
			optionalString(record['callId'], 'DshIdeInput.answerApproval.callId');
			break;
		case 'answerQuestion':
			nonEmptyString(record['requestId'], 'DshIdeInput.answerQuestion.requestId');
			validateQuestionAnswer(record['answer'], 'DshIdeInput.answerQuestion.answer');
			break;
		case 'cancelRequest':
			nonEmptyString(record['requestId'], 'DshIdeInput.cancelRequest.requestId');
			break;
		case 'setModel':
			nonEmptyString(record['model'], 'DshIdeInput.setModel.model');
			break;
		case 'setEffort':
			nonEmptyString(record['effort'], 'DshIdeInput.setEffort.effort');
			break;
		case 'setPermissionPreset':
			// §8.10.10 前置②：preset 是 `/permission` 的唯一参数，按命令参数约束（禁空白/斜杠）。
			commandToken(record['preset'], 'DshIdeInput.setPermissionPreset.preset');
			break;
		case 'runCommand':
			// §8.10.10 前置①②：`command` 为不带前导斜杠的命令名，`args` 每项单空格拼入 rawInput。
			commandToken(record['command'], 'DshIdeInput.runCommand.command');
			if (record['args'] !== undefined) {
				if (!Array.isArray(record['args']) || record['args'].some(a => typeof a !== 'string')) {
					throw new TypeError('DshIdeInput.runCommand.args must be an array of strings');
				}
				for (const [index, arg] of (record['args'] as readonly string[]).entries()) {
					// 参数允许任意非空字符串内容，但不得含空白或 `/`（注入防护）。
					if (arg === '' || /[\s/]/.test(arg)) {
						throw new TypeError(`DshIdeInput.runCommand.args[${index}] must not be empty or contain whitespace/slash`);
					}
				}
			}
			if (record['attachments'] !== undefined) {
				if (!Array.isArray(record['attachments'])) {
					throw new TypeError('DshIdeInput.runCommand.attachments must be an array');
				}
				record['attachments'].forEach((attachment, index) => imageAttachmentRef(attachment, `DshIdeInput.runCommand.attachments[${index}]`));
			}
			break;
		case 'listModels':
			optionalString(record['workspace'], 'DshIdeInput.listModels.workspace');
			break;
		case 'listCommands':
			nonEmptyString(record['sessionId'], 'DshIdeInput.listCommands.sessionId');
			optionalString(record['workspace'], 'DshIdeInput.listCommands.workspace');
			break;
		case 'fetchRowDetail':
			nonEmptyString(record['rowId'], 'DshIdeInput.fetchRowDetail.rowId');
			break;
		case 'readAttachment':
			// 逐字段对齐 DSH ImageAttachmentRef；拒绝路径/URL 形状的混入。
			imageAttachmentRef(record['attachment'], 'DshIdeInput.readAttachment.attachment');
			break;
		case 'renameSession':
			nonEmptyString(record['sessionId'], 'DshIdeInput.renameSession.sessionId');
			nonEmptyString(record['title'], 'DshIdeInput.renameSession.title');
			break;
		case 'setSessionFavorite':
			nonEmptyString(record['sessionId'], `DshIdeInput.${command}.sessionId`);
			break;
		case 'setSessionPinned':
			nonEmptyString(record['sessionId'], `DshIdeInput.${command}.sessionId`);
			optionalBoolean(record['pinned'], 'DshIdeInput.setSessionPinned.pinned');
			break;
		case 'moveSession':
			nonEmptyString(record['sessionId'], 'DshIdeInput.moveSession.sessionId');
			nonEmptyString(record['workspaceId'], 'DshIdeInput.moveSession.workspaceId');
			break;
		case 'openSessionPath':
			nonEmptyString(record['sessionId'], 'DshIdeInput.openSessionPath.sessionId');
			break;
		case 'capabilities':
		case 'speechCatalog':
			break;
		case 'speechTranscribe': {
			const request = exactRecord(record['request'], ['audioBase64', 'providerId', 'language'], 'DshIdeInput.speechTranscribe.request');
			// 业务上限由 IDE 侧按官方 `maxAudioBytes` 动态限制（见 `dshSpeech.ts`）；
			// 这里只挡明显失控的输入，理由同 `saveImageAttachment.data`。
			nonEmptyString(request['audioBase64'], 'DshIdeInput.speechTranscribe.request.audioBase64');
			boundedString(request['audioBase64'], 'DshIdeInput.speechTranscribe.request.audioBase64', MAX_BASE64_CHARS);
			optionalString(request['providerId'], 'DshIdeInput.speechTranscribe.request.providerId');
			optionalString(request['language'], 'DshIdeInput.speechTranscribe.request.language');
			break;
		}
		case 'saveImageAttachment': {
			const mediaType = record['mediaType'];
			if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp' && mediaType !== 'image/gif') {
				throw new TypeError('DshIdeInput.saveImageAttachment.mediaType must be a supported image media type');
			}
			// 这里不设业务上限（合理大小由调用方按场景决定，见 `dshChatSession.ts` 的 20 MiB 守卫），
			// 只挡明显失控的输入：base64 后约 140 MB 对应约 105 MB 原始字节。
			// 不挡的话 Host 侧 `Buffer.from(data,'base64')` 会为任意长度的字符串先分配内存。
			nonEmptyString(record['data'], 'DshIdeInput.saveImageAttachment.data');
			boundedString(record['data'], 'DshIdeInput.saveImageAttachment.data', MAX_BASE64_CHARS);
			optionalString(record['name'], 'DshIdeInput.saveImageAttachment.name');
			break;
		}
		case 'accountStartSignIn':
			accountClientMetadata(record['client'], 'DshIdeInput.accountStartSignIn.client');
			nonEmptyString(record['callbackOrigin'], 'DshIdeInput.accountStartSignIn.callbackOrigin');
			if (record['loginSource'] !== 'web' && record['loginSource'] !== 'desktop') {
				throw new TypeError('DshIdeInput.accountStartSignIn.loginSource must be web or desktop');
			}
			break;
		case 'accountCancelSignIn':
			nonEmptyString(record['attemptId'], 'DshIdeInput.accountCancelSignIn.attemptId');
			break;
		case 'accountGetState':
		case 'accountGetProfile':
			// 官方 `AccountClientMetadata` 四字段必填；缺一个就会让 Host 派生出错误的请求身份。
			accountClientMetadata(record['client'], `DshIdeInput.${command}.client`);
			break;
		case 'archiveSession':
		case 'unarchiveSession':
		case 'deleteSession':
			// 归档/删除类 method 只接受一个会话标识；官方形状见 §8.10.11 `{ sessionId }`。
			// `deleteSession` 原先漏了这一条：空串能过协议边界，只靠 Host 的可见性检查兜住——
			// 契约真源必须自己拒绝，不能把「不越权」寄托在下游实现上。
			nonEmptyString(record['sessionId'], `DshIdeInput.${command}.sessionId`);
			break;
		case 'searchSessions':
			// 官方 `search(query)` 只接受一个非空查询串。
			nonEmptyString(record['query'], 'DshIdeInput.searchSessions.query');
			break;
		case 'setTeamEnabled':
			if (typeof record['enabled'] !== 'boolean') {
				throw new TypeError('DshIdeInput.setTeamEnabled.enabled must be a boolean');
			}
			break;
		case 'setAgentPreset':
			// 预设 id 由注册表决定，不套斜杠命令的 token 规则；仍拒绝空白和斜杠。
			nonEmptyString(record['preset'], 'DshIdeInput.setAgentPreset.preset');
			if (/[\s/]/.test(String(record['preset']))) {
				throw new TypeError('DshIdeInput.setAgentPreset.preset must not contain whitespace or slash');
			}
			break;
		case 'listSessions':
			if (record['workspace'] !== undefined) {
				nonEmptyString(record['workspace'], 'DshIdeInput.listSessions.workspace');
			}
			break;
		case 'interrupt':
			nonEmptyString(record['sessionId'], 'DshIdeInput.interrupt.sessionId');
			break;
		case 'updateQueue': {
			nonEmptyString(record['sessionId'], 'DshIdeInput.updateQueue.sessionId');
			nonEmptyString(record['itemId'], 'DshIdeInput.updateQueue.itemId');
			const action = asRecord(record['action'], 'DshIdeInput.updateQueue.action');
			const kind = nonEmptyString(action['kind'], 'DshIdeInput.updateQueue.action.kind');
			if (kind === 'edit') {
				// 官方 `QueueAction.edit` 只接受非空纯文本（`readonly TextBlock[]`）。
				nonEmptyString(action['text'], 'DshIdeInput.updateQueue.action.text');
				exactRecord(action, ['kind', 'text'], 'DshIdeInput.updateQueue.action');
			} else if (kind === 'remove' || kind === 'steer') {
				exactRecord(action, ['kind'], 'DshIdeInput.updateQueue.action');
			} else {
				throw new TypeError(`DshIdeInput.updateQueue.action.kind must be edit|remove|steer (got ${String(kind)})`);
			}
			break;
		}
		case 'composerState':
		case 'presentationSettings':
		case 'refreshSnapshot':
		case 'listWorkspaces':
			// 无字段，exactRecord 已确保空对象。
			break;
	}
	return record as DshIdeMethodArgs[K];
}

/**
 * `invoke` 输出契约：只返回 `{ value }`（或错误），**绝不返回快照**。
 * 所有状态变化只走 `listen('snapshot')` 一条路。
 * `DshIdeChannel.call()` 组装输出时调用。
 *
 * 关于 `listen` 的事件面：白名单是 `snapshot` 与 `waterfall`。
 * `DshIdeChannel.listen()` 对其它名字返回 `Event.None`。
 * `waterfall` 承载官方 `$events` 的审批 / 问卷请求与取消，帧形状是
 * `DshIdeWaterfallNotice`，由独立消费者 `validateDshIdeWaterfallNotice` 校验，
 * **不**进入 `DshIdeSnapshot`（wireRevision 保持 4）。
 * 若将来要再增加官方事件名，须**先改本契约**（新增事件名常量 + 帧形状 + 独立消费者）
 * 并按第 2 章 §9 走完手续；在此之前不得在实现里私自增加事件名，
 * 也不得改用自建出站通道（§8.10.2 的「允许增加」以「先改契约」为前提）。
 */
export function validateDshIdeInvokeOutput(value: unknown): { readonly value: unknown } {
	const output = exactRecord(value, ['value'], 'DshIdeInvokeOutput');
	jsonValue(output['value'], 'DshIdeInvokeOutput.value', new Set());
	return output as { readonly value: unknown };
}

/**
 * 官方 `SessionPage` 的 IDE 投影：只要 `records` 与 `hasMore`。
 * 不声明 `cursor`——翻页游标由调用方用已加载最小 seq 推导。
 * `records` 保持 JSON 对象，不在协议层复制 DSH 的 `SessionHistoryRecord`。
 *
 * `conversation` 是 Host 顺手把这一页投影好的结构化节点：renderer 直接并入节点树，
 * 不必再解析 `records` 里的裸事件。字段缺省表示该页没有可投影内容。
 */
export interface DshIdeLoadOlderPage {
	readonly records: readonly Readonly<Record<string, unknown>>[];
	readonly hasMore: boolean;
	readonly conversation?: DshIdeConversationView;
}

/** `loadOlder` 的 `call` 返回值。`accepted` 只允许 `true`；失败走错误，不走 `accepted: false`。 */
export interface DshIdeLoadOlderResult {
	readonly accepted: true;
	readonly page: DshIdeLoadOlderPage;
}

/** 校验 `loadOlder` 的返回值。未知字段、缺页、非数组 records、非布尔 hasMore 一律拒绝。 */
export function validateDshIdeLoadOlderResult(value: unknown): DshIdeLoadOlderResult {
	const result = exactRecord(value, ['accepted', 'page'], 'DshIdeLoadOlderResult');
	if (result['accepted'] !== true) {
		throw new TypeError('DshIdeLoadOlderResult.accepted must be true');
	}
	const page = exactRecord(result['page'], ['records', 'hasMore', 'conversation'], 'DshIdeLoadOlderResult.page');
	if (!Array.isArray(page['records'])) {
		throw new TypeError('DshIdeLoadOlderResult.page.records must be an array');
	}
	page['records'].forEach((record, index) => {
		const label = `DshIdeLoadOlderResult.page.records[${index}]`;
		if (typeof record !== 'object' || record === null || Array.isArray(record)) {
			throw new TypeError(`${label} must be an object`);
		}
		jsonValue(record, label, new Set());
	});
	if (typeof page['hasMore'] !== 'boolean') {
		throw new TypeError('DshIdeLoadOlderResult.page.hasMore must be a boolean');
	}
	if (page['conversation'] !== undefined) {
		validateConversation(page['conversation']);
	}
	return result as unknown as DshIdeLoadOlderResult;
}

/**
 * 审批请求的中立视图。
 * `agent` 对象与 `AbortSignal` 不进线协议；`displayReason` 是官方本地化文案（必须含 `en`）。
 */
export interface DshIdeApprovalRequestView {
	readonly toolName: string;
	readonly callId?: string;
	readonly reason?: string;
	readonly displayReason?: Readonly<Record<string, string>>;
}

/** 问卷选项：标签，以及官方可选的说明。 */
export interface DshIdeQuestionOptionView {
	readonly label: string;
	readonly description?: string;
}

/** 一条问卷。字段对齐官方 `AskUserQuestionItem` 里能进 JSON 的部分。 */
export interface DshIdeQuestionItemView {
	readonly id: string;
	readonly question?: string;
	readonly detail?: string;
	readonly header?: string;
	readonly options?: readonly DshIdeQuestionOptionView[];
	readonly multiSelect?: boolean;
	readonly intent?: DshIdeQuestionIntent;
}

/** 官方 `AskUserQuestionIntent`。不认识的 kind 不进视图。 */
export type DshIdeQuestionIntent =
	| { readonly kind: 'plan-review'; readonly approve: string; readonly callId?: string }
	| {
		readonly kind: 'approval';
		readonly approve: string;
		readonly reject: string;
		readonly always?: string;
		readonly subject?: { readonly name: string; readonly icon?: string };
		readonly display?: {
			readonly question: Readonly<Record<string, string>>;
			readonly detail?: Readonly<Record<string, string>>;
			readonly approve?: Readonly<Record<string, string>>;
		};
	};

/** 问卷请求的中立视图。 */
export interface DshIdeQuestionRequestView {
	readonly questions: readonly DshIdeQuestionItemView[];
	/**
	 * 这张问卷卡片被 keyed 的那个 tool call（官方 `AskUserQuestionRequestEvent.wait.callId`）。
	 *
	 * 官方 `ui-user-questions` 的 `reveal(sessionId, callId)` 靠它把已隐藏的卡片重新发布到
	 * 输入区；没有它就只能按 `eventId` 找，而 `eventId` 是请求身份、不是工具调用身份。
	 * 官方类型里 `wait` 是可选（不定长等待没有），所以这里也 optional。
	 */
	readonly callId?: string;
}

/** 快照里的待决议项。形状与 waterfall 的 request 帧相同，但是快照的一部分。 */
export type DshIdePendingItem =
	| {
		readonly eventId: string;
		readonly event: 'approval/request';
		readonly agentId: string;
		readonly request: DshIdeApprovalRequestView;
	}
	| {
		readonly eventId: string;
		readonly event: 'user-questions/request';
		readonly agentId: string;
		readonly request: DshIdeQuestionRequestView;
	};

/**
 * `listen('waterfall')` 的帧。请求与取消分开，不并进快照。
 * `event` 只允许官方两条 waterfall：`approval/request` 与 `user-questions/request`。
 */
/** 官方 api-session 事件：状态只改一行；名单变化才重新 listSessions。 */
export type DshIdeSessionNotice =
	| { readonly kind: 'status'; readonly sessionId: string; readonly running: boolean }
	| { readonly kind: 'list' };

export type DshIdeWaterfallNotice =
	| {
		readonly kind: 'request';
		readonly eventId: string;
		readonly event: 'approval/request' | 'user-questions/request';
		readonly agentId: string;
		readonly request: DshIdeApprovalRequestView | DshIdeQuestionRequestView;
	}
	| {
		readonly kind: 'cancel';
		readonly eventId: string;
	};

/** waterfall 帧校验（独立消费者入口，不复用快照校验）。 */
export function validateDshIdeWaterfallNotice(value: unknown): DshIdeWaterfallNotice {
	const notice = exactRecord(value, ['kind', 'eventId', 'event', 'agentId', 'request'], 'DshIdeWaterfallNotice');
	const eventId = nonEmptyString(notice['eventId'], 'DshIdeWaterfallNotice.eventId');
	if (notice['kind'] === 'cancel') {
		const extra = ['event', 'agentId', 'request'].filter(key => notice[key] !== undefined);
		if (extra.length > 0) {
			throw new TypeError(`DshIdeWaterfallNotice cancel must omit ${extra[0]}`);
		}
		return { kind: 'cancel', eventId };
	}
	if (notice['kind'] !== 'request') {
		throw new TypeError('DshIdeWaterfallNotice.kind must be request or cancel');
	}
	const agentId = nonEmptyString(notice['agentId'], 'DshIdeWaterfallNotice.agentId');
	if (notice['event'] === 'approval/request') {
		return { kind: 'request', eventId, event: 'approval/request', agentId, request: validateApprovalView(notice['request']) };
	}
	if (notice['event'] === 'user-questions/request') {
		return { kind: 'request', eventId, event: 'user-questions/request', agentId, request: validateQuestionView(notice['request']) };
	}
	throw new TypeError('DshIdeWaterfallNotice.event must be approval/request or user-questions/request');
}

function validateApprovalView(value: unknown): DshIdeApprovalRequestView {
	const request = exactRecord(value, ['toolName', 'callId', 'reason', 'displayReason'], 'DshIdeWaterfallNotice.request');
	const toolName = nonEmptyString(request['toolName'], 'DshIdeWaterfallNotice.request.toolName');
	optionalString(request['callId'], 'DshIdeWaterfallNotice.request.callId');
	optionalString(request['reason'], 'DshIdeWaterfallNotice.request.reason');
	const displayReason = request['displayReason'] === undefined
		? undefined
		: localeMap(request['displayReason'], 'DshIdeWaterfallNotice.request.displayReason');
	return {
		toolName,
		...(typeof request['callId'] === 'string' ? { callId: request['callId'] } : {}),
		...(typeof request['reason'] === 'string' ? { reason: request['reason'] } : {}),
		...(displayReason !== undefined ? { displayReason } : {}),
	};
}

function validateQuestionView(value: unknown): DshIdeQuestionRequestView {
	const request = exactRecord(value, ['questions', 'callId'], 'DshIdeWaterfallNotice.request');
	if (!Array.isArray(request['questions']) || request['questions'].length === 0) {
		throw new TypeError('DshIdeWaterfallNotice.request.questions must be a non-empty array');
	}
	const questions = request['questions'].map((item, index) => validateQuestionItem(item, index));
	if (request['callId'] !== undefined) {
		optionalString(request['callId'], 'DshIdeWaterfallNotice.request.callId');
	}
	return { questions, ...(request['callId'] === undefined ? {} : { callId: request['callId'] as string }) };
}

function validateQuestionItem(value: unknown, index: number): DshIdeQuestionItemView {
	const label = `DshIdeWaterfallNotice.request.questions[${index}]`;
	const item = exactRecord(value, ['id', 'question', 'detail', 'header', 'options', 'multiSelect', 'intent'], label);
	const id = nonEmptyString(item['id'], `${label}.id`);
	optionalString(item['question'], `${label}.question`);
	optionalString(item['detail'], `${label}.detail`);
	optionalString(item['header'], `${label}.header`);
	let options: readonly DshIdeQuestionOptionView[] | undefined;
	if (item['options'] !== undefined) {
		if (!Array.isArray(item['options'])) {
			throw new TypeError(`${label}.options must be an array`);
		}
		options = item['options'].map((option, optionIndex) => {
			const record = exactRecord(option, ['label', 'description'], `${label}.options[${optionIndex}]`);
			optionalString(record['description'], `${label}.options[${optionIndex}].description`);
			return {
				label: nonEmptyString(record['label'], `${label}.options[${optionIndex}].label`),
				...(typeof record['description'] === 'string' ? { description: record['description'] } : {}),
			};
		});
	}
	if (item['multiSelect'] !== undefined && typeof item['multiSelect'] !== 'boolean') {
		throw new TypeError(`${label}.multiSelect must be a boolean`);
	}
	const intent = item['intent'] === undefined ? undefined : validateQuestionIntent(item['intent'], `${label}.intent`);
	return {
		id,
		...(typeof item['question'] === 'string' ? { question: item['question'] } : {}),
		...(typeof item['detail'] === 'string' ? { detail: item['detail'] } : {}),
		...(typeof item['header'] === 'string' ? { header: item['header'] } : {}),
		...(options !== undefined ? { options } : {}),
		...(typeof item['multiSelect'] === 'boolean' ? { multiSelect: item['multiSelect'] } : {}),
		...(intent !== undefined ? { intent } : {}),
	};
}

/** 快照结构校验（在 `DshIdeConsumer.accept()` 入口使用）。 */
export function validateDshIdeSnapshot(value: unknown): DshIdeSnapshot {
	const s = exactRecord(value, ['wireRevision', 'channelId', 'version', 'binding', 'state'], 'DshIdeSnapshot');
	requireDshIdeWireRevision(s['wireRevision']);
	const channelId = nonEmptyString(s['channelId'], 'DshIdeSnapshot.channelId');
	if (validateDshIdeViewBinding(s['binding']).viewId !== channelId) {
		throw new TypeError('DshIdeSnapshot binding must belong to its channel');
	}
	nonNegativeInteger(s['version'], 'DshIdeSnapshot.version');
	const state = exactRecord(s['state'], ['state', 'message', 'view'], 'DshIdeSnapshot.state');
	if (state['state'] !== 'starting' && state['state'] !== 'ready' && state['state'] !== 'rebuild') {
		throw new TypeError('DshIdeSnapshot.state.state must be starting|ready|rebuild');
	}
	if (state['message'] !== undefined) {
		nonEmptyString(state['message'], 'DshIdeSnapshot.state.message');
	}
	const view = state['view'];
	if (state['state'] === 'ready') {
		validateDshIdeView(view);
	} else if (view !== undefined) {
		throw new TypeError(`DshIdeSnapshot.state.view is only allowed when state is ready (got ${String(state['state'])})`);
	}
	jsonValue(state, 'DshIdeSnapshot.state', new Set());
	return s as unknown as DshIdeSnapshot;
}

const DSH_IDE_VIEW_KEYS = [
	'frame', 'conversation', 'deliverables', 'attachments', 'plan', 'goal', 'todos', 'skills', 'team', 'worktrees',
	'tokenUsageDelta', 'quotaNotice', 'composer', 'pending',
] as const;

/** 跟会话帧校验：`frame` 必填，typed 字段出现时按官方形状 fail-closed。 */
function validateDshIdeView(value: unknown): asserts value is DshIdeViewSnapshot {
	const view = exactRecord(value, DSH_IDE_VIEW_KEYS, 'DshIdeSnapshot.state.view');
	const frame = view['frame'];
	if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) {
		throw new TypeError('DshIdeSnapshot.state.view.frame must be an object');
	}
	if (typeof (frame as Record<string, unknown>)['type'] !== 'string' || (frame as Record<string, unknown>)['type'] === '') {
		throw new TypeError('DshIdeSnapshot.state.view.frame.type must be a non-empty string');
	}
	if (view['conversation'] !== undefined) {
		validateConversation(view['conversation']);
	}
	if (view['deliverables'] !== undefined) {
		validateDeliverables(view['deliverables']);
	}
	if (view['attachments'] !== undefined) {
		validateAttachmentList(view['attachments']);
	}
	if (view['plan'] !== undefined) {
		validatePlan(view['plan']);
	}
	if (view['goal'] !== undefined) {
		validateGoal(view['goal']);
	}
	if (view['todos'] !== undefined) {
		validateTodos(view['todos']);
	}
	if (view['skills'] !== undefined) {
		validateSkills(view['skills']);
	}
	if (view['team'] !== undefined) {
		validateTeam(view['team']);
	}
	if (view['worktrees'] !== undefined) {
		validateWorktrees(view['worktrees']);
	}
	if (view['tokenUsageDelta'] !== undefined) {
		validateTokenUsage(view['tokenUsageDelta'], 'DshIdeSnapshot.state.view.tokenUsageDelta');
	}
	if (view['quotaNotice'] !== undefined) {
		validateQuotaNotice(view['quotaNotice']);
	}
	if (view['composer'] !== undefined) {
		validateComposer(view['composer']);
	}
	if (view['pending'] !== undefined) {
		validatePending(view['pending']);
	}
}

/** 工作树列表校验：路径、分支与仓库根必须非空。 */
function validateWorktrees(value: unknown): void {
	if (!Array.isArray(value)) {
		throw new TypeError('DshIdeSnapshot.state.view.worktrees must be an array');
	}
	value.forEach((item, index) => {
		const label = `DshIdeSnapshot.state.view.worktrees[${index}]`;
		const worktree = exactRecord(item, ['path', 'branch', 'baseCommit', 'repositoryRoot', 'created'], label);
		for (const key of ['path', 'branch', 'baseCommit', 'repositoryRoot'] as const) {
			nonEmptyString(worktree[key], label + '.' + key);
		}
		if (typeof worktree['created'] !== 'boolean') {
			throw new TypeError(label + '.created must be a boolean');
		}
	});
}

/** 共享任务板校验；未知 status 允许（官方是开放状态集），但 id/revision/subject 必须合法。 */
function validateTeam(value: unknown): void {
	const team = exactRecord(value, ['enabled', 'tasks', 'failure'], 'DshIdeSnapshot.state.view.team');
	if (typeof team['enabled'] !== 'boolean') {
		throw new TypeError('DshIdeSnapshot.state.view.team.enabled must be a boolean');
	}
	optionalString(team['failure'], 'DshIdeSnapshot.state.view.team.failure');
	if (!Array.isArray(team['tasks'])) {
		throw new TypeError('DshIdeSnapshot.state.view.team.tasks must be an array');
	}
	team['tasks'].forEach((item, index) => {
		const label = `DshIdeSnapshot.state.view.team.tasks[${index}]`;
		const task = exactRecord(item, ['id', 'revision', 'subject', 'description', 'status', 'ready', 'ownerName'], label);
		nonEmptyString(task['id'], label + '.id');
		positiveInteger(task['revision'], label + '.revision');
		if (typeof task['subject'] !== 'string' || typeof task['description'] !== 'string') {
			throw new TypeError(label + '.subject/description must be strings');
		}
		nonEmptyString(task['status'], label + '.status');
		if (typeof task['ready'] !== 'boolean') {
			throw new TypeError(label + '.ready must be a boolean');
		}
		optionalString(task['ownerName'], label + '.ownerName');
	});
}

/** 能力快照校验（`capabilities` method 的返回值）：四项必填布尔，exactRecord 拒绝未知字段与显式 undefined。 */
export function validateCapabilities(value: unknown): asserts value is DshIdeCapabilities {
	const caps = exactRecord(value,
		['rewind', 'sessionFavorite', 'sessionMove', 'sessionDelete'],
		'DshIdeCapabilities');
	for (const key of ['rewind', 'sessionFavorite', 'sessionMove', 'sessionDelete'] as const) {
		if (typeof caps[key] !== 'boolean') {
			throw new TypeError(`DshIdeCapabilities.${key} must be a boolean`);
		}
	}
}

function imageAttachmentRef(value: unknown, label: string): void {
	const attachment = exactRecord(value,
		['attachmentId', 'mediaType', 'bytes', 'width', 'height', 'name', 'originalDimensions'],
		label);
	nonEmptyString(attachment['attachmentId'], `${label}.attachmentId`);
	const mediaType = attachment['mediaType'];
	if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp' && mediaType !== 'image/gif') {
		throw new TypeError(`${label}.mediaType must be a supported image media type`);
	}
	for (const key of ['bytes', 'width', 'height'] as const) {
		positiveInteger(attachment[key], `${label}.${key}`);
	}
	optionalString(attachment['name'], `${label}.name`);
	if (attachment['originalDimensions'] !== undefined) {
		const dims = exactRecord(attachment['originalDimensions'], ['width', 'height'], `${label}.originalDimensions`);
		positiveInteger(dims['width'], `${label}.originalDimensions.width`);
		positiveInteger(dims['height'], `${label}.originalDimensions.height`);
	}
}

function fileAttachmentRef(value: unknown, label: string): void {
	const attachment = exactRecord(value, ['attachmentId', 'name', 'bytes'], label);
	nonEmptyString(attachment['attachmentId'], `${label}.attachmentId`);
	nonEmptyString(attachment['name'], `${label}.name`);
	positiveInteger(attachment['bytes'], `${label}.bytes`);
}

function positiveInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		throw new TypeError(`${label} must be a positive integer`);
	}
	return value;
}

function anyString(value: unknown, label: string): string {
	if (typeof value !== 'string') {
		throw new TypeError(`${label} must be a string`);
	}
	return value;
}

function validateQuestionAnswer(value: unknown, label: string): void {
	const answer = exactRecord(value, ['answers'], label);
	if (!Array.isArray(answer['answers']) || answer['answers'].length === 0) {
		throw new TypeError(`${label}.answers must be a non-empty array`);
	}
	answer['answers'].forEach((item, index) => {
		const itemLabel = `${label}.answers[${index}]`;
		const record = exactRecord(item, ['id', 'selected', 'custom'], itemLabel);
		nonEmptyString(record['id'], `${itemLabel}.id`);
		if (!Array.isArray(record['selected'])) {
			throw new TypeError(`${itemLabel}.selected must be an array`);
		}
		record['selected'].forEach((selected, selectedIndex) => {
			nonEmptyString(selected, `${itemLabel}.selected[${selectedIndex}]`);
		});
		optionalString(record['custom'], `${itemLabel}.custom`);
		// 官方 QuestionComposer 用空 selected 且不带 custom 表示用户显式跳过。
		// 此处只校验线协议形状，整份题目覆盖和选项归属由结算端校验。
	});
}

function localeMap(value: unknown, label: string): Readonly<Record<string, string>> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object`);
	}
	// 同 `exactRecord`：`record['en']` 会沿原型链读，不拒原型对象时
	// `Object.create({en:'x'})` 能通过「必须含 en」的检查。
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${label} must be a plain object`);
	}
	const record = value as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (record[key] === undefined) {
			throw new TypeError(`${label} must omit explicit undefined field ${JSON.stringify(key)}`);
		}
	}
	if (typeof record['en'] !== 'string' || record['en'].trim() === '') {
		throw new TypeError(`${label}.en must be a non-empty string`);
	}
	const out: Record<string, string> = {};
	for (const key of Object.keys(record)) {
		if (key.trim() === '' || /\s/.test(key)) {
			throw new TypeError(`${label} has an invalid locale key ${JSON.stringify(key)}`);
		}
		const item = record[key];
		if (typeof item !== 'string' || item.trim() === '') {
			throw new TypeError(`${label}.${key} must be a non-empty string`);
		}
		out[key] = item;
	}
	return out;
}

function validateQuestionIntent(value: unknown, label: string): DshIdeQuestionIntent {
	const preview = asRecord(value, label);
	if (preview['kind'] === 'plan-review') {
		const intent = exactRecord(value, ['kind', 'approve', 'callId'], label);
		optionalString(intent['callId'], `${label}.callId`);
		return {
			kind: 'plan-review',
			approve: nonEmptyString(intent['approve'], `${label}.approve`),
			...(typeof intent['callId'] === 'string' ? { callId: intent['callId'] } : {}),
		};
	}
	if (preview['kind'] === 'approval') {
		const intent = exactRecord(value, ['kind', 'approve', 'reject', 'always', 'subject', 'display'], label);
		optionalString(intent['always'], `${label}.always`);
		let subject: { readonly name: string; readonly icon?: string } | undefined;
		if (intent['subject'] !== undefined) {
			const record = exactRecord(intent['subject'], ['name', 'icon'], `${label}.subject`);
			optionalString(record['icon'], `${label}.subject.icon`);
			subject = {
				name: nonEmptyString(record['name'], `${label}.subject.name`),
				...(typeof record['icon'] === 'string' ? { icon: record['icon'] } : {}),
			};
		}
		let display: { readonly question: Readonly<Record<string, string>>; readonly detail?: Readonly<Record<string, string>>; readonly approve?: Readonly<Record<string, string>> } | undefined;
		if (intent['display'] !== undefined) {
			const record = exactRecord(intent['display'], ['question', 'detail', 'approve'], `${label}.display`);
			const detail = record['detail'] === undefined ? undefined : localeMap(record['detail'], `${label}.display.detail`);
			const approve = record['approve'] === undefined ? undefined : localeMap(record['approve'], `${label}.display.approve`);
			display = {
				question: localeMap(record['question'], `${label}.display.question`),
				...(detail !== undefined ? { detail } : {}),
				...(approve !== undefined ? { approve } : {}),
			};
		}
		return {
			kind: 'approval',
			approve: nonEmptyString(intent['approve'], `${label}.approve`),
			reject: nonEmptyString(intent['reject'], `${label}.reject`),
			...(typeof intent['always'] === 'string' ? { always: intent['always'] } : {}),
			...(subject !== undefined ? { subject } : {}),
			...(display !== undefined ? { display } : {}),
		};
	}
	throw new TypeError(`${label}.kind must be plan-review or approval`);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object`);
	}
	// 同 `exactRecord`：调用方随后会读 `record['field']`，原型上的值会被读到。
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${label} must be a plain object`);
	}
	return value as Record<string, unknown>;
}

function validateConversation(value: unknown): void {
	const view = exactRecord(value, ['nodes', 'hasMore', 'subagentCatalog', 'inboxNextTurn', 'inboxNextStep'], 'DshIdeSnapshot.state.view.conversation');
	if (!Array.isArray(view['nodes'])) {
		throw new TypeError('DshIdeSnapshot.state.view.conversation.nodes must be an array');
	}
	const seen = new Set<object>();
	view['nodes'].forEach((node, index) => validateConversationNode(node, `DshIdeSnapshot.state.view.conversation.nodes[${index}]`, seen));
	if (typeof view['hasMore'] !== 'boolean') {
		throw new TypeError('DshIdeSnapshot.state.view.conversation.hasMore must be a boolean');
	}
	for (const key of ['inboxNextTurn', 'inboxNextStep'] as const) {
		validateInboxMessages(view[key], `DshIdeSnapshot.state.view.conversation.${key}`);
	}
	if (view['subagentCatalog'] !== undefined) {
		if (!Array.isArray(view['subagentCatalog'])) {
			throw new TypeError('DshIdeSnapshot.state.view.conversation.subagentCatalog must be an array');
		}
		view['subagentCatalog'].forEach((entry, index) => {
			const label = `DshIdeSnapshot.state.view.conversation.subagentCatalog[${index}]`;
			const record = exactRecord(entry, ['seq', 'time', 'childId', 'childCreatedAt', 'mode', 'label', 'name', 'version'], label);
			nonNegativeInteger(record['seq'], `${label}.seq`);
			nonNegativeInteger(record['time'], `${label}.time`);
			for (const key of ['childId', 'mode', 'label', 'name'] as const) {
				optionalString(record[key], `${label}.${key}`);
			}
			if (record['childCreatedAt'] !== undefined) {
				nonNegativeInteger(record['childCreatedAt'], `${label}.childCreatedAt`);
			}
			if (record['version'] !== undefined) {
				nonNegativeInteger(record['version'], `${label}.version`);
			}
		});
	}
}

function workflowStatus(value: unknown, label: string): void {
	if (value !== 'running' && value !== 'completed' && value !== 'failed' && value !== 'cancelled' && value !== 'interrupted') {
		throw new TypeError(`${label} must be a workflow status`);
	}
}

/**
 * 排队消息列表：`id` 非空、`sourceKind` 非空、`content` 是块数组。
 *
 * 块只要求「有非空 `type` 的对象」——官方块类型运行时开放，收窄等于替上游做决定。
 * 重复 `id` 拒绝：同一条消息不能在一个队列里出现两次（官方 inbox fold 同样拒绝）。
 */
function validateInboxMessages(value: unknown, label: string): void {
	if (value === undefined) {
		return;
	}
	if (!Array.isArray(value)) {
		throw new TypeError(`${label} must be an array`);
	}
	const ids = new Set<string>();
	value.forEach((entry, index) => {
		const itemLabel = `${label}[${index}]`;
		const record = exactRecord(entry, ['id', 'sourceKind', 'content'], itemLabel);
		const id = nonEmptyString(record['id'], `${itemLabel}.id`);
		nonEmptyString(record['sourceKind'], `${itemLabel}.sourceKind`);
		if (ids.has(id)) {
			throw new TypeError(`${itemLabel}.id duplicates an earlier queued message`);
		}
		ids.add(id);
		if (!Array.isArray(record['content'])) {
			throw new TypeError(`${itemLabel}.content must be an array`);
		}
		record['content'].forEach((block, blockIndex) => {
			const blockLabel = `${itemLabel}.content[${blockIndex}]`;
			const blockRecord = asRecord(block, blockLabel);
			nonEmptyString(blockRecord['type'], `${blockLabel}.type`);
		});
	});
}

function validateConversationNode(value: unknown, label: string, seen: Set<object>): void {
	const preview = asRecord(value, label);
	if (seen.has(preview)) {
		throw new TypeError(`${label} must not contain cycles`);
	}
	seen.add(preview);
	try {
		const kind = preview['kind'];
		switch (kind) {
			case 'user':
			case 'steering': {
				const node = exactRecord(value, ['kind', 'seq', 'time', 'messageId', 'turn', 'content', 'source'], label);
				readNodeBase(node, label, false);
				validateContentBlocks(node['content'], `${label}.content`);
				return;
			}
			case 'turn-trigger': {
				const node = exactRecord(value, ['kind', 'seq', 'time', 'messageId', 'turn', 'content', 'source', 'producer', 'form'], label);
				readNodeBase(node, label, false);
				validateContentBlocks(node['content'], `${label}.content`);
				if (node['producer'] !== undefined) {
					const producer = exactRecord(node['producer'], ['role', 'label'], `${label}.producer`);
					nonEmptyString(producer['role'], `${label}.producer.role`);
					if (producer['label'] !== null) {
						nonEmptyString(producer['label'], `${label}.producer.label`);
					}
				}
				if (node['form'] !== undefined && node['form'] !== null) {
					nonEmptyString(node['form'], `${label}.form`);
				}
				return;
			}
			case 'context': {
				const node = exactRecord(value, ['kind', 'seq', 'time', 'messageId', 'turn', 'content', 'source', 'producer', 'form'], label);
				readNodeBase(node, label, false);
				validateContentBlocks(node['content'], `${label}.content`);
				if (node['producer'] !== undefined) {
					const producer = exactRecord(node['producer'], ['role', 'label'], `${label}.producer`);
					nonEmptyString(producer['role'], `${label}.producer.role`);
					if (producer['label'] !== null) {
						nonEmptyString(producer['label'], `${label}.producer.label`);
					}
				}
				if (node['form'] !== undefined && node['form'] !== null) {
					nonEmptyString(node['form'], `${label}.form`);
				}
				return;
			}
			case 'question-reply': {
				// 回执必须覆盖整份题目；缺答案的调用保留普通工具卡，由投影端判断。
				const node = exactRecord(value, ['kind', 'seq', 'time', 'messageId', 'turn', 'callId', 'questions', 'answers', 'text'], label);
				readNodeBase(node, label, false);
				nonEmptyString(node['callId'], `${label}.callId`);
				if (!Array.isArray(node['questions']) || node['questions'].length === 0) {
					throw new TypeError(`${label}.questions must be a non-empty array`);
				}
				node['questions'].forEach((item, index) => {
					const itemLabel = `${label}.questions[${index}]`;
					const record = exactRecord(item, ['id', 'question', 'header'], itemLabel);
					nonEmptyString(record['id'], `${itemLabel}.id`);
					nonEmptyString(record['question'], `${itemLabel}.question`);
					optionalString(record['header'], `${itemLabel}.header`);
				});
				if (!Array.isArray(node['answers']) || node['answers'].length !== node['questions'].length) {
					throw new TypeError(`${label}.answers must cover every question exactly once`);
				}
				node['answers'].forEach((item, index) => {
					const itemLabel = `${label}.answers[${index}]`;
					const record = exactRecord(item, ['id', 'selected', 'custom'], itemLabel);
					nonEmptyString(record['id'], `${itemLabel}.id`);
					if (!Array.isArray(record['selected'])) {
						throw new TypeError(`${itemLabel}.selected must be an array`);
					}
					record['selected'].forEach((selected, selectedIndex) => nonEmptyString(selected, `${itemLabel}.selected[${selectedIndex}]`));
					optionalString(record['custom'], `${itemLabel}.custom`);
				});
				jsonValue(node['text'], `${label}.text`, new Set());
				return;
			}
			case 'turn-process': {
				const node = exactRecord(value, ['kind', 'seq', 'time', 'turn', 'controlAnchorSeq', 'processStartSeq', 'answerAnchorSeq', 'answerStep', 'inlineReasoning', 'messageCount', 'toolCallCount', 'subagentCount', 'endReason'], label);
				readNodeBase(node, label, true);
				for (const key of ['controlAnchorSeq', 'processStartSeq', 'answerAnchorSeq'] as const) {
					if (node[key] !== undefined) {
						nonNegativeInteger(node[key], `${label}.${key}`);
					}
				}
				nonNegativeInteger(node['answerStep'], `${label}.answerStep`);
				if (node['inlineReasoning'] !== false) {
					throw new TypeError(`${label}.inlineReasoning must be false`);
				}
				for (const key of ['messageCount', 'toolCallCount', 'subagentCount'] as const) {
					nonNegativeInteger(node[key], `${label}.${key}`);
				}
				if (node['endReason'] !== undefined) {
					nonEmptyString(node['endReason'], `${label}.endReason`);
				}
				return;
			}
			case 'manual-compaction': {
				const node = exactRecord(value, ['kind', 'seq', 'time', 'messageId', 'command', 'compaction'], label);
				readNodeBase(node, label, false);
				const command = exactRecord(node['command'], ['commandId', 'name', 'args', 'outcome'], `${label}.command`);
				nonEmptyString(command['commandId'], `${label}.command.commandId`);
				if (command['name'] !== null) {
					nonEmptyString(command['name'], `${label}.command.name`);
				}
				// 与 `command` 节点同一口径：args 可以是空串（`/compact` 没有参数）。
				if (command['args'] !== null && typeof command['args'] !== 'string') {
					throw new TypeError(`${label}.command.args must be a string or null`);
				}
				if (command['outcome'] !== null) {
					const outcome = exactRecord(command['outcome'], ['kind', 'text', 'sourceEventSeq'], `${label}.command.outcome`);
					if (outcome['kind'] !== 'success' && outcome['kind'] !== 'error') {
						throw new TypeError(`${label}.command.outcome.kind must be success or error`);
					}
					optionalString(outcome['text'], `${label}.command.outcome.text`);
					if (outcome['sourceEventSeq'] !== undefined) {
						nonNegativeInteger(outcome['sourceEventSeq'], `${label}.command.outcome.sourceEventSeq`);
					}
				}
				const compaction = exactRecord(node['compaction'], ['summary', 'shadowedItemCount', 'shadowedTokenCount'], `${label}.compaction`);
				if (compaction['summary'] !== null && typeof compaction['summary'] !== 'string') {
					throw new TypeError(`${label}.compaction.summary must be a string or null`);
				}
				return;
			}
			case 'turn-tail': {
				const node = exactRecord(value, ['kind', 'seq', 'time', 'turn', 'closing', 'closingMessageId', 'branchUnavailable', 'tokenUsage'], label);
				readNodeBase(node, label, true);
				optionalString(node['closing'], `${label}.closing`);
				optionalString(node['closingMessageId'], `${label}.closingMessageId`);
				if (node['branchUnavailable'] !== undefined && node['branchUnavailable'] !== true) {
					throw new TypeError(`${label}.branchUnavailable must be true when present`);
				}
				if (node['tokenUsage'] !== undefined) {
					const usage = exactRecord(node['tokenUsage'], ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'], `${label}.tokenUsage`);
					for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'] as const) {
						if (usage[key] !== undefined) {
							nonNegativeFinite(usage[key], `${label}.tokenUsage.${key}`);
						}
					}
				}
				return;
			}
			case 'system-prompt': {
				const node = exactRecord(value, ['kind', 'seq', 'time', 'text', 'update'], label);
				readNodeBase(node, label, false);
				nonEmptyString(node['text'], `${label}.text`);
				if (node['update'] !== undefined && node['update'] !== true) {
					throw new TypeError(`${label}.update must be true when present`);
				}
				return;
			}
			case 'workflow-run': {
				const node = exactRecord(value, ['kind', 'seq', 'time', 'turn', 'runId', 'name', 'status', 'phases'], label);
				readNodeBase(node, label, false);
				nonEmptyString(node['runId'], `${label}.runId`);
				nonEmptyString(node['name'], `${label}.name`);
				workflowStatus(node['status'], `${label}.status`);
				if (!Array.isArray(node['phases'])) {
					throw new TypeError(`${label}.phases must be an array`);
				}
				node['phases'].forEach((item, index) => {
					const phaseLabel = `${label}.phases[${index}]`;
					const phase = exactRecord(item, ['key', 'phase', 'members'], phaseLabel);
					nonEmptyString(phase['key'], `${phaseLabel}.key`);
					// 空字符串是独立的阶段身份，null 表示字段缺席；两者都不等于「非空字符串」。
					if (phase['phase'] !== null && phase['phase'] !== undefined && typeof phase['phase'] !== 'string') {
						throw new TypeError(`${phaseLabel}.phase must be a string or null`);
					}
					if (!Array.isArray(phase['members'])) {
						throw new TypeError(`${phaseLabel}.members must be an array`);
					}
					phase['members'].forEach((member, memberIndex) => {
						const memberLabel = `${phaseLabel}.members[${memberIndex}]`;
						const record = exactRecord(member, ['seq', 'label', 'childId', 'status'], memberLabel);
						nonNegativeInteger(record['seq'], `${memberLabel}.seq`);
						nonEmptyString(record['childId'], `${memberLabel}.childId`);
						// 成员标签允许空串（宿主没填名字时仍要画成员行）。
						if (record['label'] !== undefined && typeof record['label'] !== 'string') {
							throw new TypeError(`${memberLabel}.label must be a string`);
						}
						workflowStatus(record['status'], `${memberLabel}.status`);
					});
				});
				return;
			}
			case 'submitted-plan': {
				const node = exactRecord(value, ['kind', 'seq', 'time', 'turn', 'callId', 'title', 'markdown'], label);
				readNodeBase(node, label, false);
				nonEmptyString(node['callId'], `${label}.callId`);
				nonEmptyString(node['title'], `${label}.title`);
				nonEmptyString(node['markdown'], `${label}.markdown`);
				return;
			}
			case 'command-input': {
				const node = exactRecord(value, ['kind', 'seq', 'time', 'commandId', 'text'], label);
				readNodeBase(node, label, false);
				nonEmptyString(node['commandId'], `${label}.commandId`);
				nonEmptyString(node['text'], `${label}.text`);
				return;
			}
			case 'assistant': {
				const node = exactRecord(value, ['kind', 'seq', 'time', 'messageId', 'turn', 'step', 'blocks', 'usage', 'providerMetadata', 'interrupted'], label);
				readNodeBase(node, label, true);
				nonNegativeInteger(node['step'], `${label}.step`);
				validateAssistantBlocks(node['blocks'], `${label}.blocks`);
				if (node['usage'] !== undefined) {
					validateTokenUsage(node['usage'], `${label}.usage`);
				}
				if (node['providerMetadata'] !== undefined) {
					const meta = exactRecord(node['providerMetadata'], ['provider', 'model'], `${label}.providerMetadata`);
					nonEmptyString(meta['provider'], `${label}.providerMetadata.provider`);
					nonEmptyString(meta['model'], `${label}.providerMetadata.model`);
				}
				if (node['interrupted'] !== undefined && node['interrupted'] !== true) {
					throw new TypeError(`${label}.interrupted must be true when present`);
				}
				return;
			}
			case 'tool-call': {
				const node = exactRecord(value, ['kind', 'seq', 'time', 'messageId', 'turn', 'step', 'callId', 'parentCallId', 'name', 'phase', 'argsRaw', 'args'], label);
				readNodeBase(node, label, false);
				if (node['step'] !== undefined) {
					nonNegativeInteger(node['step'], `${label}.step`);
				}
				nonEmptyString(node['callId'], `${label}.callId`);
				optionalString(node['parentCallId'], `${label}.parentCallId`);
				nonEmptyString(node['name'], `${label}.name`);
				if (node['phase'] !== 'preparing' && node['phase'] !== 'start') {
					throw new TypeError(`${label}.phase must be preparing or start`);
				}
				if (node['argsRaw'] !== undefined) {
					anyString(node['argsRaw'], `${label}.argsRaw`);
				}
				if (node['args'] !== undefined) {
					jsonValue(node['args'], `${label}.args`, new Set());
				}
				return;
			}
			case 'tool-result': {
				const node = exactRecord(value, ['kind', 'seq', 'time', 'messageId', 'turn', 'callId', 'parentCallId', 'name', 'args', 'call', 'callTime', 'content', 'isError', 'error', 'subCalls'], label);
				readNodeBase(node, label, false);
				nonEmptyString(node['callId'], `${label}.callId`);
				optionalString(node['parentCallId'], `${label}.parentCallId`);
				// 允许空串：官方 `ToolResultNode.name` 明确是「配对调用已离开加载窗口时为空」
				// （`ui-conversation/src/client/contract/records.ts:169`）。真实会话第一次加载时
				// `messages[0]` 常常不是 tool/call，官方 `rootResult` 就给 `''`。
				anyString(node['name'], `${label}.name`);
				jsonValue(node['args'], `${label}.args`, new Set());
				validateToolCallRef(node['call'], `${label}.call`);
				if (node['callTime'] !== undefined && node['callTime'] !== null) {
					nonNegativeInteger(node['callTime'], `${label}.callTime`);
				}
				validateContentBlocks(node['content'], `${label}.content`);
				if (typeof node['isError'] !== 'boolean') {
					throw new TypeError(`${label}.isError must be a boolean`);
				}
				if (node['error'] !== undefined) {
					const error = exactRecord(node['error'], ['name', 'code', 'reason'], `${label}.error`);
					nonEmptyString(error['name'], `${label}.error.name`);
					nonEmptyString(error['code'], `${label}.error.code`);
					optionalString(error['reason'], `${label}.error.reason`);
				}
				if (!Array.isArray(node['subCalls'])) {
					throw new TypeError(`${label}.subCalls must be an array`);
				}
				node['subCalls'].forEach((child, index) => {
					const childLabel = `${label}.subCalls[${index}]`;
					validateConversationNode(child, childLabel, seen);
					const childKind = asRecord(child, childLabel)['kind'];
					if (childKind !== 'tool-call' && childKind !== 'tool-result') {
						throw new TypeError(`${childLabel} must be a tool-call or tool-result`);
					}
				});
				return;
			}
			case 'command': {
				const node = exactRecord(value, ['kind', 'seq', 'time', 'messageId', 'turn', 'commandId', 'name', 'args', 'outcome'], label);
				readNodeBase(node, label, false);
				nonEmptyString(node['commandId'], `${label}.commandId`);
				if (node['name'] !== null) {
					nonEmptyString(node['name'], `${label}.name`);
				}
				if (node['args'] !== null && typeof node['args'] !== 'string') {
					throw new TypeError(`${label}.args must be a string or null`);
				}
				validateCommandOutcome(node['outcome'], `${label}.outcome`);
				return;
			}
			case 'compaction': {
				const node = exactRecord(value, ['kind', 'seq', 'time', 'messageId', 'turn', 'summary', 'summaryEventSeq', 'shadowedItemCount', 'shadowedTokenCount'], label);
				readNodeBase(node, label, false);
				if (node['summary'] !== null && typeof node['summary'] !== 'string') {
					throw new TypeError(`${label}.summary must be a string or null`);
				}
				for (const key of ['summaryEventSeq', 'shadowedItemCount', 'shadowedTokenCount'] as const) {
					if (node[key] !== undefined && node[key] !== null) {
						nonNegativeInteger(node[key], `${label}.${key}`);
					}
				}
				return;
			}
			case 'model-retry': {
				const node = exactRecord(value, ['kind', 'seq', 'time', 'messageId', 'turn', 'retry', 'maxRetries', 'delayMs', 'mode', 'retryState', 'failure'], label);
				readNodeBase(node, label, false);
				for (const key of ['retry', 'maxRetries'] as const) {
					if (node[key] !== undefined) {
						nonNegativeInteger(node[key], `${label}.${key}`);
					}
				}
				if (node['delayMs'] !== undefined) {
					nonNegativeFinite(node['delayMs'], `${label}.delayMs`);
				}
				if (node['mode'] !== undefined && node['mode'] !== 'normal' && node['mode'] !== 'always') {
					throw new TypeError(`${label}.mode must be normal or always`);
				}
				if (node['retryState'] !== undefined && node['retryState'] !== 'scheduled' && node['retryState'] !== 'started' && node['retryState'] !== 'cancelled') {
					throw new TypeError(`${label}.retryState must be scheduled, started, or cancelled`);
				}
				if (node['failure'] !== undefined) {
					const failure = exactRecord(node['failure'], ['message', 'code'], `${label}.failure`);
					nonEmptyString(failure['message'], `${label}.failure.message`);
					optionalString(failure['code'], `${label}.failure.code`);
				}
				return;
			}
			case 'turn-error': {
				const node = exactRecord(value, ['kind', 'seq', 'time', 'messageId', 'turn', 'step', 'message', 'code'], label);
				readNodeBase(node, label, true);
				nonNegativeInteger(node['step'], `${label}.step`);
				nonEmptyString(node['message'], `${label}.message`);
				optionalString(node['code'], `${label}.code`);
				return;
			}
			case 'turn-max-tokens': {
				const node = exactRecord(value, ['kind', 'seq', 'time', 'messageId', 'turn', 'step'], label);
				readNodeBase(node, label, true);
				nonNegativeInteger(node['step'], `${label}.step`);
				return;
			}
			case 'inherited-history': {
				const node = exactRecord(value, ['kind', 'seq', 'time', 'messageId', 'turn'], label);
				readNodeBase(node, label, false);
				return;
			}
			default:
				throw new TypeError(`${label}.kind is not an official conversation node`);
		}
	} finally {
		seen.delete(preview);
	}
}

function readNodeBase(node: Record<string, unknown>, label: string, turnRequired: boolean): void {
	nonNegativeInteger(node['seq'], `${label}.seq`);
	nonNegativeInteger(node['time'], `${label}.time`);
	optionalString(node['messageId'], `${label}.messageId`);
	if (turnRequired || node['turn'] !== undefined) {
		nonNegativeInteger(node['turn'], `${label}.turn`);
	}
}

function validateContentBlocks(value: unknown, label: string): void {
	if (!Array.isArray(value)) {
		throw new TypeError(`${label} must be an array`);
	}
	value.forEach((block, index) => validateContentBlock(block, `${label}[${index}]`));
}

function validateContentBlock(value: unknown, label: string): void {
	const type = asRecord(value, label)['type'];
	switch (type) {
		case 'text':
		case 'reasoning': {
			const block = exactRecord(value, ['type', 'text'], label);
			anyString(block['text'], `${label}.text`);
			return;
		}
		case 'image': {
			const block = exactRecord(value, ['type', 'attachment'], label);
			imageAttachmentRef(block['attachment'], `${label}.attachment`);
			return;
		}
		case 'file': {
			const block = exactRecord(value, ['type', 'attachment'], label);
			fileAttachmentRef(block['attachment'], `${label}.attachment`);
			return;
		}
		case 'tool-call': {
			const block = exactRecord(value, ['type', 'id', 'name', 'arguments'], label);
			nonEmptyString(block['id'], `${label}.id`);
			nonEmptyString(block['name'], `${label}.name`);
			anyString(block['arguments'], `${label}.arguments`);
			return;
		}
		case 'tool-addition':
		case 'tool-removal': {
			const block = exactRecord(value, ['type', 'toolName'], label);
			nonEmptyString(block['toolName'], `${label}.toolName`);
			return;
		}
		default:
			throw new TypeError(`${label}.type is not an official content block`);
	}
}

function validateAssistantBlocks(value: unknown, label: string): void {
	if (!Array.isArray(value)) {
		throw new TypeError(`${label} must be an array`);
	}
	value.forEach((block, index) => validateAssistantBlock(block, `${label}[${index}]`));
}

function validateAssistantBlock(value: unknown, label: string): void {
	const kind = asRecord(value, label)['kind'];
	switch (kind) {
		case 'text':
		case 'reasoning': {
			const block = exactRecord(value, ['kind', 'text'], label);
			anyString(block['text'], `${label}.text`);
			return;
		}
		case 'image': {
			const block = exactRecord(value, ['kind', 'attachment'], label);
			imageAttachmentRef(block['attachment'], `${label}.attachment`);
			return;
		}
		case 'tool-call': {
			const block = exactRecord(value, ['kind', 'callId', 'name', 'argsRaw'], label);
			nonEmptyString(block['callId'], `${label}.callId`);
			nonEmptyString(block['name'], `${label}.name`);
			anyString(block['argsRaw'], `${label}.argsRaw`);
			return;
		}
		case 'other': {
			const block = exactRecord(value, ['kind', 'block'], label);
			jsonValue(block['block'], `${label}.block`, new Set());
			return;
		}
		default:
			throw new TypeError(`${label}.kind is not an official assistant block`);
	}
}

function validateToolCallRef(value: unknown, label: string): void {
	if (value === undefined || value === null) {
		return;
	}
	const call = exactRecord(value, ['name', 'argsRaw'], label);
	nonEmptyString(call['name'], `${label}.name`);
	anyString(call['argsRaw'], `${label}.argsRaw`);
}

function validateCommandOutcome(value: unknown, label: string): void {
	if (value === null) {
		return;
	}
	const outcome = exactRecord(value, ['kind', 'text'], label);
	if (outcome['kind'] !== 'success' && outcome['kind'] !== 'error') {
		throw new TypeError(`${label}.kind must be success or error`);
	}
	if (outcome['text'] !== undefined) {
		anyString(outcome['text'], `${label}.text`);
	}
}

function validateTokenUsage(value: unknown, label: string): void {
	const usage = exactRecord(value, ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'], label);
	nonNegativeInteger(usage['inputTokens'], `${label}.inputTokens`);
	nonNegativeInteger(usage['outputTokens'], `${label}.outputTokens`);
	for (const key of ['totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) {
		if (usage[key] !== undefined) {
			nonNegativeInteger(usage[key], `${label}.${key}`);
		}
	}
}

function validateDeliverables(value: unknown): void {
	if (!Array.isArray(value)) {
		throw new TypeError('DshIdeSnapshot.state.view.deliverables must be an array');
	}
	value.forEach((item, index) => {
		const label = `DshIdeSnapshot.state.view.deliverables[${index}]`;
		const delivery = exactRecord(item, ['turn', 'callId', 'files'], label);
		nonNegativeInteger(delivery['turn'], `${label}.turn`);
		nonEmptyString(delivery['callId'], `${label}.callId`);
		if (!Array.isArray(delivery['files']) || delivery['files'].length === 0) {
			throw new TypeError(`${label}.files must be a non-empty array`);
		}
		delivery['files'].forEach((file, fileIndex) => {
			const fileLabel = `${label}.files[${fileIndex}]`;
			const record = exactRecord(file, ['path', 'description'], fileLabel);
			nonEmptyString(record['path'], `${fileLabel}.path`);
			optionalString(record['description'], `${fileLabel}.description`);
		});
	});
}

function validateAttachmentList(value: unknown): void {
	if (!Array.isArray(value)) {
		throw new TypeError('DshIdeSnapshot.state.view.attachments must be an array');
	}
	value.forEach((item, index) => imageAttachmentRef(item, `DshIdeSnapshot.state.view.attachments[${index}]`));
}

function validatePlan(value: unknown): void {
	const plan = exactRecord(value, ['active', 'pending'], 'DshIdeSnapshot.state.view.plan');
	if (typeof plan['active'] !== 'boolean' || typeof plan['pending'] !== 'boolean') {
		throw new TypeError('DshIdeSnapshot.state.view.plan active and pending must be booleans');
	}
}

function validateGoal(value: unknown): void {
	const label = 'DshIdeSnapshot.state.view.goal';
	const view = exactRecord(value, ['goal', 'roundsStarted', 'createdAt', 'updatedAt', 'activation'], label);
	const goal = exactRecord(view['goal'], ['id', 'revision', 'objective', 'phase', 'maxGoalRounds', 'blockedReason'], `${label}.goal`);
	nonEmptyString(goal['id'], `${label}.goal.id`);
	positiveInteger(goal['revision'], `${label}.goal.revision`);
	nonEmptyString(goal['objective'], `${label}.goal.objective`);
	if (goal['phase'] !== 'active' && goal['phase'] !== 'paused' && goal['phase'] !== 'blocked' && goal['phase'] !== 'complete') {
		throw new TypeError(`${label}.goal.phase must be active, paused, blocked, or complete`);
	}
	positiveInteger(goal['maxGoalRounds'], `${label}.goal.maxGoalRounds`);
	if (goal['phase'] === 'blocked') {
		const reason = exactRecord(goal['blockedReason'], ['code', 'message'], `${label}.goal.blockedReason`);
		nonEmptyString(reason['code'], `${label}.goal.blockedReason.code`);
		nonEmptyString(reason['message'], `${label}.goal.blockedReason.message`);
	} else if (goal['blockedReason'] !== undefined) {
		throw new TypeError(`${label}.goal.blockedReason is only allowed when phase is blocked`);
	}
	nonNegativeInteger(view['roundsStarted'], `${label}.roundsStarted`);
	nonNegativeInteger(view['createdAt'], `${label}.createdAt`);
	nonNegativeInteger(view['updatedAt'], `${label}.updatedAt`);
	if (view['activation'] !== undefined && view['activation'] !== 'armed' && view['activation'] !== 'disarmed') {
		throw new TypeError(`${label}.activation must be armed or disarmed`);
	}
}

function validateTodos(value: unknown): void {
	if (!Array.isArray(value)) {
		throw new TypeError('DshIdeSnapshot.state.view.todos must be an array');
	}
	value.forEach((item, index) => {
		const label = `DshIdeSnapshot.state.view.todos[${index}]`;
		const todo = exactRecord(item, ['content', 'status'], label);
		nonEmptyString(todo['content'], `${label}.content`);
		if (todo['status'] !== 'pending' && todo['status'] !== 'in_progress' && todo['status'] !== 'completed') {
			throw new TypeError(`${label}.status must be pending, in_progress, or completed`);
		}
	});
}

function validateSkills(value: unknown): void {
	if (!Array.isArray(value)) {
		throw new TypeError('DshIdeSnapshot.state.view.skills must be an array');
	}
	value.forEach((item, index) => {
		const label = `DshIdeSnapshot.state.view.skills[${index}]`;
		const skill = exactRecord(item, ['name', 'description', 'whenToUse', 'modelInvocable', 'userInvocable', 'provider'], label);
		nonEmptyString(skill['name'], `${label}.name`);
		nonEmptyString(skill['description'], `${label}.description`);
		optionalString(skill['whenToUse'], `${label}.whenToUse`);
		if (typeof skill['modelInvocable'] !== 'boolean' || typeof skill['userInvocable'] !== 'boolean') {
			throw new TypeError(`${label} invocation flags must be booleans`);
		}
		// 官方 `SkillEntry` 没有 provider；出现时才要求非空。
		if (skill['provider'] !== undefined) {
			nonEmptyString(skill['provider'], `${label}.provider`);
		}
	});
}

function validateQuotaNotice(value: unknown): void {
	const notice = exactRecord(value, ['code', 'seq', 'message'], 'DshIdeSnapshot.state.view.quotaNotice');
	if (notice['code'] !== 'QUOTA' && notice['code'] !== 'ACCOUNT_QUOTA') {
		throw new TypeError('DshIdeSnapshot.state.view.quotaNotice.code must be QUOTA or ACCOUNT_QUOTA');
	}
	nonNegativeInteger(notice['seq'], 'DshIdeSnapshot.state.view.quotaNotice.seq');
	optionalString(notice['message'], 'DshIdeSnapshot.state.view.quotaNotice.message');
}

function validateComposer(value: unknown): void {
	const label = 'DshIdeSnapshot.state.view.composer';
	const composer = exactRecord(value, ['model', 'permission', 'team', 'preset'], label);
	validateComposerModel(composer['model'], `${label}.model`);
	validateNullableOptions(composer['permission'], `${label}.permission`, 'value');
	validateComposerTeam(composer['team'], `${label}.team`);
	validateNullableOptions(composer['preset'], `${label}.preset`, 'id');
}

function validateComposerModel(value: unknown, label: string): void {
	const model = exactRecord(value, ['current', 'groups'], label);
	if (model['current'] !== null) {
		const current = exactRecord(model['current'], ['provider', 'model', 'effort'], `${label}.current`);
		nonEmptyString(current['provider'], `${label}.current.provider`);
		nonEmptyString(current['model'], `${label}.current.model`);
		optionalString(current['effort'], `${label}.current.effort`);
	}
	if (!Array.isArray(model['groups'])) {
		throw new TypeError(`${label}.groups must be an array`);
	}
	model['groups'].forEach((group, groupIndex) => {
		const groupLabel = `${label}.groups[${groupIndex}]`;
		const record = exactRecord(group, ['id', 'name', 'models'], groupLabel);
		nonEmptyString(record['id'], `${groupLabel}.id`);
		nonEmptyString(record['name'], `${groupLabel}.name`);
		if (!Array.isArray(record['models'])) {
			throw new TypeError(`${groupLabel}.models must be an array`);
		}
		record['models'].forEach((entry, modelIndex) => {
			const modelLabel = `${groupLabel}.models[${modelIndex}]`;
			const item = exactRecord(entry, ['id', 'name', 'efforts', 'defaultEffort'], modelLabel);
			nonEmptyString(item['id'], `${modelLabel}.id`);
			nonEmptyString(item['name'], `${modelLabel}.name`);
			optionalString(item['defaultEffort'], `${modelLabel}.defaultEffort`);
			if (!Array.isArray(item['efforts'])) {
				throw new TypeError(`${modelLabel}.efforts must be an array`);
			}
			item['efforts'].forEach((effort, effortIndex) => {
				const effortLabel = `${modelLabel}.efforts[${effortIndex}]`;
				const effortRecord = exactRecord(effort, ['id', 'name'], effortLabel);
				nonEmptyString(effortRecord['id'], `${effortLabel}.id`);
				nonEmptyString(effortRecord['name'], `${effortLabel}.name`);
			});
		});
	});
}

function validateNullableOptions(value: unknown, label: string, idKey: 'value' | 'id'): void {
	if (value === null) {
		return;
	}
	const record = exactRecord(value, ['current', 'options'], label);
	if (record['current'] !== null) {
		nonEmptyString(record['current'], `${label}.current`);
	}
	if (!Array.isArray(record['options'])) {
		throw new TypeError(`${label}.options must be an array`);
	}
	record['options'].forEach((option, index) => {
		const optionLabel = `${label}.options[${index}]`;
		const item = exactRecord(option, [idKey, 'name'], optionLabel);
		nonEmptyString(item[idKey], `${optionLabel}.${idKey}`);
		nonEmptyString(item['name'], `${optionLabel}.name`);
	});
}

function validateComposerTeam(value: unknown, label: string): void {
	if (value === null) {
		return;
	}
	const team = exactRecord(value, ['enabled', 'confirmDisable'], label);
	if (typeof team['enabled'] !== 'boolean' || typeof team['confirmDisable'] !== 'boolean') {
		throw new TypeError(`${label} flags must be booleans`);
	}
}

function validatePending(value: unknown): void {
	if (!Array.isArray(value)) {
		throw new TypeError('DshIdeSnapshot.state.view.pending must be an array');
	}
	value.forEach((item, index) => {
		const label = `DshIdeSnapshot.state.view.pending[${index}]`;
		const record = exactRecord(item, ['eventId', 'event', 'agentId', 'request'], label);
		nonEmptyString(record['eventId'], `${label}.eventId`);
		nonEmptyString(record['agentId'], `${label}.agentId`);
		if (record['event'] === 'approval/request') {
			validateApprovalView(record['request']);
			return;
		}
		if (record['event'] === 'user-questions/request') {
			validateQuestionView(record['request']);
			return;
		}
		throw new TypeError(`${label}.event must be approval/request or user-questions/request`);
	});
}

/**
 * 快照连续性 fail-closed（平移自 dsh-TUI consumer.accept）：
 * channelId / wireRevision 不变；version 严格 +1；gap 或倒退一律抛错。
 * 返回 void，违反即抛 TypeError（协议违规）。
 */
export function assertSnapshotContinuity(prev: DshIdeSnapshot | undefined, next: DshIdeSnapshot): void {
	if (prev === undefined) {
		return;
	}
	if (next.channelId !== prev.channelId) {
		throw new TypeError(`DshIdeSnapshot channel id changed: ${prev.channelId} -> ${next.channelId}`);
	}
	if (next.wireRevision !== prev.wireRevision) {
		throw new TypeError(`DshIdeSnapshot wire revision changed: ${prev.wireRevision} -> ${next.wireRevision}`);
	}
	if (next.version < prev.version) {
		throw new TypeError(`DshIdeSnapshot version went backwards: ${prev.version} -> ${next.version}`);
	}
	if (next.version === prev.version) {
		throw new TypeError(`DshIdeSnapshot version did not advance: ${prev.version}`);
	}
	if (next.version !== prev.version + 1) {
		throw new TypeError(`DshIdeSnapshot version gap: expected ${prev.version + 1}, got ${next.version}`);
	}
}

/** `open` 的规格：视图名 + 会话/工作区参数。 */
export interface DshIdeOpenSpec {
	readonly view: string;
	readonly params?: Record<string, unknown>;
}

/**
 * DSH 能力端口：由 IDE 侧的官方客户端传输适配实现（`platform/dshClient/transport/`）。
 * 四个方法逐一对应 `IdeViewHost` 的四个语义，不承载任何传输细节，因此不存在第二条协议。
 * 定义在 common 层是为了让 `transport/` 与 `electron-main/` 都只依赖本文件，避免反向依赖。
 */
export interface DshIdeBackend {
	/** 绑定会话并返回该视图的通道 id（一次打开一个，守恒）。 */
	open(spec: DshIdeOpenSpec): { readonly channelId: string; readonly sessionId?: string };
	/** 订阅会话真源（历史回放 + 实时流）；返回解绑句柄。 */
	/**
	 * 订阅会话真源。
	 *
	 * 回调收到的是**传输层的原始帧**（`session/follow` 的 `snapshot` / `event` / `assistant-stream`），
	 * 不是展开后的单条事件：解包由 `IdeViewHost` 实现负责（`unwrapFollowFrame`），
	 * 这样端口两侧的职责边界只划一次，不出现「一半帧、一半事件」的混合契约。
	 */
	follow(
		sessionId: string | undefined,
		onFrame: (frame: unknown) => void,
		/**
		 * 订阅因传输原因中断（DSH 重启、socket 断开）时的回调。
		 *
		 * 为什么端口要暴露它：DSH 每次重启都会换 pid/端口，物理连接必然断一次。
		 * 若端口只把「断线」当普通错误吞掉，上层就永远不知道该重新 `follow`——
		 * 界面会停在最后一帧，用户看到的是「不动了」而不是「重连中」。
		 * 上层据此重新发现端点并重建订阅，不把断线当业务失败。
		 */
		onDisconnect: ((error: unknown) => void) | undefined,
		binding: DshIdeViewBinding,
	): { dispose(): void };
	/** 执行一个 DTO method（参数已过 `validateDshIdeInput`）。 */
	invoke(method: DshIdeMethod, args: unknown, binding: DshIdeViewBinding): Promise<unknown>;
	/** 释放传输资源；不取消 DSH 会话。 */
	close(): void;
}

/**
 * 宿主侧视图宿主窄接口：DshIdeChannel 只依赖这四个方法，由 `DshIdeViewService`
 * （electron-main）实现，DSH 能力经 `DshIdeBackend` 端口注入。
 */
export interface IdeViewHost {
	open(spec: { view: string; params?: Record<string, unknown> }): DshIdeSnapshot;
	/** 换一个会话继续跟：停旧流、按新地址重开。 */
	rebind(sessionId: string): DshIdeSnapshot;
	subscribe(onSnapshot: (snapshot: DshIdeSnapshot) => void): { dispose(): void };
	/** 订阅官方 waterfall 通知。与快照流分开，不推进 version。 */
	subscribeWaterfall(onNotice: (notice: DshIdeWaterfallNotice) => void): { dispose(): void };
	/** 订阅会话状态。只含官方 api-session 事件，不推进 version，也不进聊天帧。 */
	subscribeSessionNotice(onNotice: (notice: DshIdeSessionNotice) => void): { dispose(): void };
	invoke(method: DshIdeMethod | string, args?: unknown): Promise<unknown>;
	close(): { closed: true };
}

// 注：账号能力的**端点名**是本协议的正式 method（`accountGetState` / `accountGetProfile`），
// 「调用方身份」元数据（官方 `AccountClientMetadata` 三字段）及其构造器
// `dshAccountClientMetadata` 也同在本文件（D18 归并），协议侧只留唯一真源。
