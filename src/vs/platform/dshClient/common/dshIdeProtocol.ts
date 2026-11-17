/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH-IDE 连接层协议真源（P1 冻结，P3 升级到 wireRevision 2）。
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
 * 线协议修订号（快照连续性校验依据；wireRevision 不变则协议相容）。
 * 4：`DshIdeViewSnapshot` 在保留 `frame` 的同时增加官方聊天页 typed 投影。
 * 5：新增 `capabilities`（依赖插件能力门控：rewind / 会话管理）。
 * 这些字段都可缺省；一旦出现就必须命中白名单，否则 fail-closed。
 */
export const DSH_IDE_WIRE_REVISION = 5;

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
	readonly plan?: DshIdePlanView;
	readonly goal?: DshIdeGoalView;
	readonly todos?: readonly DshIdeTodoView[];
	readonly skills?: readonly DshIdeSkillView[];
	readonly tokenUsageDelta?: DshIdeTokenUsageDelta;
	readonly quotaNotice?: DshIdeQuotaNotice;
	readonly composer?: DshIdeComposerView;
	readonly pending?: readonly DshIdePendingItem[];
	/** 依赖插件能力门控；缺插件时对应功能在 UI 隐藏。缺省一律视为全 false。 */
	readonly capabilities?: DshIdeCapabilities;
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

/** 读取一张 durable 图片附件的字节（base64）与媒体类型。 */
export interface DshIdeImageAttachmentValue {
	readonly mediaType: DshIdeImageAttachmentRef['mediaType'];
	readonly data: string;
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
	readonly turn?: number;
}

/** 结构化会话：Host 投影后的节点，不再由渲染器从裸帧拼装。 */
export interface DshIdeConversationView {
	readonly nodes: readonly DshIdeConversationNode[];
	readonly hasMore: boolean;
}

export type DshIdeConversationNode =
	| (DshIdeNodeBase & { readonly kind: 'user' | 'steering'; readonly content: readonly DshIdeContentBlock[] })
	| (DshIdeNodeBase & { readonly kind: 'context'; readonly content: readonly DshIdeContentBlock[]; readonly form?: string | null })
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
	| (DshIdeNodeBase & {
		readonly kind: 'subagent-catalog';
		readonly childId?: string;
		readonly childCreatedAt?: number;
		readonly mode?: string;
		readonly label?: string;
		readonly name?: string;
		readonly version?: number;
	})
	| (DshIdeNodeBase & { readonly kind: 'subagent-notice'; readonly content: readonly DshIdeContentBlock[] });

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
	/** 提交一条用户消息。图片附件跟在正文后面，形状是官方 `ImageAttachmentRef`。 */
	submit: { text: string; attachments?: readonly DshIdeImageAttachmentRef[] };
	/** 中断当前生成。 */
	interrupt: Record<string, never>;
	/** 恢复一个会话（可选指定）。 */
	resume: { sessionId?: string };
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
	 *
	 * 返回值是 `DshIdeLoadOlderResult`。`session/page` 是独立只读端点，不重推
	 * `follow` 的 opening snapshot，所以分页内容必须随 `call` 返回，不能等 snapshot。
	 * 下一页游标用已加载记录的最小 `seq` 作为 `beforeSeq`，协议不传官方 `cursor`。
	 */
	loadOlder: { sessionId: string; throughSeq?: number; beforeSeq?: number; maxMessages?: number };
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
	setModel: { model: string };
	/** 设置 effort。 */
	setEffort: { effort: string };
	/** 设置权限预设；预设名作为 `/permission <preset>` 的唯一参数（§8.10.10 前置②，禁空白/斜杠）。 */
	setPermissionPreset: { preset: string };
	/** 运行斜杠命令；`command` 为不带前导 `/` 的命令名，`args` 以单空格拼成 rawInput（§8.10.10 前置①②）。 */
	runCommand: { command: string; args?: readonly string[]; attachments?: readonly DshIdeImageAttachmentRef[] };
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
	composerState: Record<string, never>;
	/** 开关当前根会话的智能体团队。`enabled` 必须是布尔值。 */
	setTeamEnabled: { enabled: boolean };
	/** 在会话尚未开始前切换智能体预设。已开聊时官方拒绝，原样透传。 */
	setAgentPreset: { preset: string };
	/** 列出可用模型。 */
	listModels: { workspace?: string };
	/** 列出可用命令。 */
	listCommands: { workspace?: string };
	/** 取某行的完整内容（折叠行回 Host 取详情）。 */
	fetchRowDetail: { rowId: string };
	/**
	 * 读取一张 durable 图片附件的字节（官方 `session/attachment` 的进程内等价物）。
	 * 只按 attachmentId 授权读取，不接受路径/URL；返回 base64，绝不返回本地文件路径。
	 */
	readAttachment: { attachment: DshIdeImageAttachmentRef };
	/** 主动刷新快照。 */
	refreshSnapshot: Record<string, never>;
	/** 读取 DeepSeek 账号投影（登录态）；`client` 为官方 `AccountClientMetadata` 三元组。 */
	accountGetState: { client: IDshAccountClientMetadataArgs };
	/** 读取账号资料（显示名 / 联系方式 / 头像 URL）；仅在 `accountGetState` 为已登录时调用。 */
	accountGetProfile: { client: IDshAccountClientMetadataArgs };
	/**
	 * 把一张已入库的图片放进待发送附件。
	 * 官方没有独立的 addAttachment remote（附件随 `session/prompt` 的 content 提交），
	 * 在落点核对完成前 Host 以 FEATURE_UNAVAILABLE 拒绝。
	 */
	addAttachment: { attachment: DshIdeImageAttachmentRef };
	/** 从待发送附件里拿掉一张图片。落点未核对前同样 fail-closed。 */
	removeAttachment: { attachmentId: string };
	/**
	 * 官方 goal 服务的写操作（`goal/create|edit|pause|resume|complete|clear`）。
	 * `create` 只带 objective；其余动作带 `id` + `revision`（官方 GoalRef）。
	 * Host 在接线前 fail-closed，不猜测服务名。
	 */
	setGoal: {
		action: 'create' | 'edit' | 'pause' | 'resume' | 'complete' | 'clear';
		objective?: string;
		maxGoalRounds?: number;
		id?: string;
		revision?: number;
	};
	/** 列出当前会话可见的技能摘要。落点未核对前 fail-closed。 */
	listSkills: Record<string, never>;
	/**
	 * 在 DSH 里打开一个目标。官方没有已核对的 open remote，Host fail-closed。
	 * IDE 自己用编辑器 / `IOpenerService` 打开文件和外链，不走这个 method。
	 */
	openInApp: { target: string };
	/** 关掉一条额度通知。官方 dismiss 是网页客户端本地状态，Host 在有 remote 之前 fail-closed。 */
	dismissQuotaNotice: { seq: number };
	/** 官方 `session/rename`。 */
	renameSession: { sessionId: string; title: string };
	/** 归档管理器 `setSessionFavorite`。只传会话，Host 按当前收藏状态切换。 */
	setSessionFavorite: { sessionId: string };
	/** 官方 `workspace/pinSession` 与 `unpinSession`。只传会话，Host 按当前置顶状态切换。 */
	setSessionPinned: { sessionId: string };
	/** 官方工作区名单，供「移动到工作区」。 */
	listWorkspaces: Record<string, never>;
	/** 归档管理器 `workspaceRegistry.moveSessionToWorkspace`。 */
	moveSession: { sessionId: string; workspaceId: string };
	/** 官方 `session/openWorkspacePath`，打开该会话的工作区目录。 */
	openSessionPath: { sessionId: string };
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

/** 每个 method 的 exactRecord 允许字段（与 DshIdeMethodArgs 同步；空数组=无字段）。 */
const DSH_IDE_METHOD_KEYS: Record<DshIdeMethod, readonly string[]> = {
	submit: ['text', 'attachments'],
	interrupt: [],
	resume: ['sessionId'],
	newSession: ['workspace', 'options'],
	fork: ['sessionId', 'point'],
	rewind: ['sessionId', 'to'],
	loadOlder: ['sessionId', 'throughSeq', 'beforeSeq', 'maxMessages'],
	answerApproval: ['requestId', 'decision', 'reason', 'agentId', 'callId'],
	answerQuestion: ['requestId', 'answer'],
	cancelRequest: ['requestId'],
	setModel: ['model'],
	setEffort: ['effort'],
	setPermissionPreset: ['preset'],
	runCommand: ['command', 'args', 'attachments'],
	listSessions: ['workspace'],
	presentationSettings: [],
	deleteSession: ['sessionId'],
	archiveSession: ['sessionId'],
	unarchiveSession: ['sessionId'],
	searchSessions: ['query'],
	composerState: [],
	setTeamEnabled: ['enabled'],
	setAgentPreset: ['preset'],
	listModels: ['workspace'],
	listCommands: ['workspace'],
	fetchRowDetail: ['rowId'],
	readAttachment: ['attachment'],
	refreshSnapshot: [],
	accountGetState: ['client'],
	accountGetProfile: ['client'],
	addAttachment: ['attachment'],
	removeAttachment: ['attachmentId'],
	setGoal: ['action', 'objective', 'maxGoalRounds', 'id', 'revision'],
	listSkills: [],
	openInApp: ['target'],
	dismissQuotaNotice: ['seq'],
	renameSession: ['sessionId', 'title'],
	setSessionFavorite: ['sessionId'],
	setSessionPinned: ['sessionId'],
	listWorkspaces: [],
	moveSession: ['sessionId', 'workspaceId'],
	openSessionPath: ['sessionId'],
};

// ---------------------------------------------------------------------------
// 校验原语（平移自 dsh-TUI tui-channel.js，保持行为一致）
// ---------------------------------------------------------------------------

/** 拒绝未知字段（仅允许 `x-` 前缀扩展），要求纯对象、非数组、非 null。 */
export function exactRecord(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object`);
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
	return obj;
}

/** 有限数、纯对象、无环；class 实例（非 Object.prototype）一律拒绝。 */
export function jsonValue(value: unknown, label: string, ancestors: Set<object>): void {
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
			value.forEach((item, index) => jsonValue(item, `${label}[${index}]`, ancestors));
		} else {
			const prototype = Object.getPrototypeOf(obj);
			if (prototype !== Object.prototype && prototype !== null) {
				throw new TypeError(`${label} must contain only plain objects`);
			}
			for (const [key, item] of Object.entries(obj)) {
				jsonValue(item, `${label}.${key}`, ancestors);
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

function nonEmptyString(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new TypeError(`${label} must be a non-empty string`);
	}
	return value;
}

function optionalString(value: unknown, label: string): void {
	if (value !== undefined) {
		nonEmptyString(value, label);
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
	switch (command) {
		case 'submit':
			nonEmptyString(record['text'], 'DshIdeInput.submit.text');
			if (record['attachments'] !== undefined) {
				if (!Array.isArray(record['attachments'])) {
					throw new TypeError('DshIdeInput.submit.attachments must be an array');
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
			optionalString(record['workspace'], 'DshIdeInput.listCommands.workspace');
			break;
		case 'fetchRowDetail':
			nonEmptyString(record['rowId'], 'DshIdeInput.fetchRowDetail.rowId');
			break;
		case 'readAttachment':
			// 逐字段对齐 DSH ImageAttachmentRef；拒绝路径/URL 形状的混入。
			imageAttachmentRef(record['attachment'], 'DshIdeInput.readAttachment.attachment');
			break;
		case 'addAttachment':
			imageAttachmentRef(record['attachment'], 'DshIdeInput.addAttachment.attachment');
			break;
		case 'removeAttachment':
			nonEmptyString(record['attachmentId'], 'DshIdeInput.removeAttachment.attachmentId');
			break;
		case 'setGoal':
			validateSetGoal(record);
			break;
		case 'openInApp':
			nonEmptyString(record['target'], 'DshIdeInput.openInApp.target');
			break;
		case 'dismissQuotaNotice':
			nonNegativeInteger(record['seq'], 'DshIdeInput.dismissQuotaNotice.seq');
			break;
		case 'renameSession':
			nonEmptyString(record['sessionId'], 'DshIdeInput.renameSession.sessionId');
			nonEmptyString(record['title'], 'DshIdeInput.renameSession.title');
			break;
		case 'setSessionFavorite':
		case 'setSessionPinned':
			nonEmptyString(record['sessionId'], `DshIdeInput.${command}.sessionId`);
			break;
		case 'moveSession':
			nonEmptyString(record['sessionId'], 'DshIdeInput.moveSession.sessionId');
			nonEmptyString(record['workspaceId'], 'DshIdeInput.moveSession.workspaceId');
			break;
		case 'openSessionPath':
			nonEmptyString(record['sessionId'], 'DshIdeInput.openSessionPath.sessionId');
			break;
		case 'accountGetState':
		case 'accountGetProfile':
			// 官方 `AccountClientMetadata` 四字段必填；缺一个就会让 Host 派生出错误的请求身份。
			accountClientMetadata(record['client'], `DshIdeInput.${command}.client`);
			break;
		case 'archiveSession':
		case 'unarchiveSession':
			// 归档类 method 只接受一个会话标识；官方形状见 §8.10.11 `{ sessionId }`。
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
		case 'composerState':
		case 'interrupt':
		case 'presentationSettings':
		case 'refreshSnapshot':
		case 'listSkills':
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
 * **不**进入 `DshIdeSnapshot`（wireRevision 保持 2）。
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
	const request = exactRecord(value, ['questions'], 'DshIdeWaterfallNotice.request');
	if (!Array.isArray(request['questions']) || request['questions'].length === 0) {
		throw new TypeError('DshIdeWaterfallNotice.request.questions must be a non-empty array');
	}
	const questions = request['questions'].map((item, index) => validateQuestionItem(item, index));
	return { questions };
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
	const s = exactRecord(value, ['wireRevision', 'channelId', 'version', 'state'], 'DshIdeSnapshot');
	if (s['wireRevision'] !== DSH_IDE_WIRE_REVISION) {
		throw new TypeError(`DshIdeSnapshot.wireRevision mismatch: expected ${DSH_IDE_WIRE_REVISION}`);
	}
	nonEmptyString(s['channelId'], 'DshIdeSnapshot.channelId');
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
	'frame', 'conversation', 'deliverables', 'attachments', 'plan', 'goal', 'todos', 'skills',
	'tokenUsageDelta', 'quotaNotice', 'composer', 'pending', 'capabilities',
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
	if (view['capabilities'] !== undefined) {
		validateCapabilities(view['capabilities']);
	}
}

/** 能力快照校验：四项必填布尔，exactRecord 拒绝未知字段与显式 undefined。 */
export function validateCapabilities(value: unknown): asserts value is DshIdeCapabilities {
	const caps = exactRecord(value,
		['rewind', 'sessionFavorite', 'sessionMove', 'sessionDelete'],
		'DshIdeSnapshot.state.view.capabilities');
	for (const key of ['rewind', 'sessionFavorite', 'sessionMove', 'sessionDelete'] as const) {
		if (typeof caps[key] !== 'boolean') {
			throw new TypeError(`DshIdeSnapshot.state.view.capabilities.${key} must be a boolean`);
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

function mustOmit(record: Record<string, unknown>, key: string, label: string): void {
	if (record[key] !== undefined) {
		throw new TypeError(`${label} must omit ${key}`);
	}
}

function validateSetGoal(record: Record<string, unknown>): void {
	const action = record['action'];
	if (action !== 'create' && action !== 'edit' && action !== 'pause' && action !== 'resume' && action !== 'complete' && action !== 'clear') {
		throw new TypeError('DshIdeInput.setGoal.action must be create, edit, pause, resume, complete, or clear');
	}
	if (record['objective'] !== undefined) {
		nonEmptyString(record['objective'], 'DshIdeInput.setGoal.objective');
	}
	if (record['maxGoalRounds'] !== undefined) {
		positiveInteger(record['maxGoalRounds'], 'DshIdeInput.setGoal.maxGoalRounds');
	}
	if (record['id'] !== undefined) {
		nonEmptyString(record['id'], 'DshIdeInput.setGoal.id');
	}
	if (record['revision'] !== undefined) {
		positiveInteger(record['revision'], 'DshIdeInput.setGoal.revision');
	}
	if (action === 'create') {
		nonEmptyString(record['objective'], 'DshIdeInput.setGoal.objective');
		mustOmit(record, 'id', 'DshIdeInput.setGoal');
		mustOmit(record, 'revision', 'DshIdeInput.setGoal');
		return;
	}
	nonEmptyString(record['id'], 'DshIdeInput.setGoal.id');
	if (record['revision'] === undefined) {
		throw new TypeError('DshIdeInput.setGoal.revision must be a positive integer');
	}
	if (action === 'edit') {
		if (record['objective'] === undefined && record['maxGoalRounds'] === undefined) {
			throw new TypeError('DshIdeInput.setGoal edit requires objective and/or maxGoalRounds');
		}
		return;
	}
	mustOmit(record, 'objective', 'DshIdeInput.setGoal');
	mustOmit(record, 'maxGoalRounds', 'DshIdeInput.setGoal');
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
		if (record['selected'].length === 0 && record['custom'] === undefined) {
			throw new TypeError(`${itemLabel} must select an option or provide custom text`);
		}
	});
}

function localeMap(value: unknown, label: string): Readonly<Record<string, string>> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object`);
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
	return value as Record<string, unknown>;
}

function validateConversation(value: unknown): void {
	const view = exactRecord(value, ['nodes', 'hasMore'], 'DshIdeSnapshot.state.view.conversation');
	if (!Array.isArray(view['nodes'])) {
		throw new TypeError('DshIdeSnapshot.state.view.conversation.nodes must be an array');
	}
	const seen = new Set<object>();
	view['nodes'].forEach((node, index) => validateConversationNode(node, `DshIdeSnapshot.state.view.conversation.nodes[${index}]`, seen));
	if (typeof view['hasMore'] !== 'boolean') {
		throw new TypeError('DshIdeSnapshot.state.view.conversation.hasMore must be a boolean');
	}
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
			case 'steering':
			case 'subagent-notice': {
				const node = exactRecord(value, ['kind', 'seq', 'time', 'messageId', 'turn', 'content'], label);
				readNodeBase(node, label, false);
				validateContentBlocks(node['content'], `${label}.content`);
				return;
			}
			case 'context': {
				const node = exactRecord(value, ['kind', 'seq', 'time', 'messageId', 'turn', 'content', 'form'], label);
				readNodeBase(node, label, false);
				validateContentBlocks(node['content'], `${label}.content`);
				if (node['form'] !== undefined && node['form'] !== null) {
					nonEmptyString(node['form'], `${label}.form`);
				}
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
			case 'subagent-catalog': {
				const node = exactRecord(value, ['kind', 'seq', 'time', 'messageId', 'turn', 'childId', 'childCreatedAt', 'mode', 'label', 'name', 'version'], label);
				readNodeBase(node, label, false);
				for (const key of ['childId', 'mode', 'label', 'name'] as const) {
					optionalString(node[key], `${label}.${key}`);
				}
				if (node['childCreatedAt'] !== undefined) {
					nonNegativeInteger(node['childCreatedAt'], `${label}.childCreatedAt`);
				}
				if (node['version'] !== undefined) {
					nonNegativeInteger(node['version'], `${label}.version`);
				}
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
	open(spec: DshIdeOpenSpec): { readonly channelId: string; readonly sessionId?: string; readonly capabilities?: DshIdeCapabilities };
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
		onDisconnect?: (error: unknown) => void,
	): { dispose(): void };
	/** 执行一个 DTO method（参数已过 `validateDshIdeInput`）。 */
	invoke(method: DshIdeMethod, args: unknown): Promise<unknown>;
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
