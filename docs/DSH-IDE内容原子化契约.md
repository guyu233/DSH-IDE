# DSH-IDE 内容原子化契约

> 状态：设计契约与实施计划  
> 适用：DSH-IDE chat 面板内容渲染、折叠、组合、待处理交互  
> 原则：以 DSH HEAD 的 slot / node / tool view / pending 契约为标准；VS Code 原生优先；原生不足则改造；确需自研时组件必须像 VS Code 原生 Chat。  
> 说明：本文是执行契约，不是完成报告。未标注完成的项不得视为已实现。
>
> 证据纪律：所有事实性结论必须同时给出 DSH 在线源码证据（仓库路径 / commit / HEAD / 类型 / 注册点）与 DSH-IDE 本地证据（`src/**` / `build/**` / 测试 / 实测输出）。只有计划、博客、历史缓存或本地已删除目录的内容不得写成事实。状态必须区分 `已实现` / `部分实现` / `未实现` / `PENDING`；界面不可见、不可点、未回读的一律不得记为已实现。详细规则见 `../AGENTS.md` 总纪律第 5 条。

## 1. 冻结原则

1. **DSH 语义是真源**：不因为 VS Code 原生没有对应组件，就把 DSH 节点降级为 `info` / `warning` / `markdown`。
2. **原生优先**：优先复用 VS Code Chat content parts、折叠容器、hover、context menu、editor、diff、可访问性与生命周期。
3. **能改就改**：原生组件差一点时，优先扩展原生 part model 或分派机制，不堆 DSH 特例分支。
4. **自研原生化**：自研组件在视觉、键盘、焦点、折叠、主题、高对比度、可访问性和 dispose 生命周期上必须像 VS Code 原生 Chat。
5. **不用文本模拟卡片**：plan、goal、skills、compaction、system prompt、approval、question、file、image、deliverables、usage 不得用文本行作为最终态。
6. **一个 Chat 面板**：不另起 Webview 聊天页，不做第二套输入、草稿、滚动、附件、快捷键和可访问性体系。
7. **迁移期兼容**：旧 `toHistory()` 在全量稳定前保留为兼容序列化路径；这不是并行开发路线，稳定后按 PR-12 删除文本模拟。
8. **业务事实单一真源**：DSH-IDE 是 DSH core 的 UI 投影层，不是第二个响应生成器。所有会话事实必须来自 DSH core/Host：用户消息、assistant 正文、thinking、工具调用与结果、approval/question/plan 终态、usage、quota、deliverables、turn/process/tail。IDE 侧只允许本地处理输入草稿、optimistic running、卡片临时隐藏/恢复、折叠状态、滚动位置、失败提示和结构化内容的原生化投影。禁止本地生成 assistant 回复、工具结果、审批结果、问卷答复节点、plan discuss 终态，或任何伪装成 DSH 会话事实的 response。
9. **本地 UI 与业务事实分离**：`hidePending`、`restorePending`、`rememberSettled`、`TRUNCATION_NOTICE`、输入清空、running 乐观态、extras 文案、reference/quota/error 的原生适配只能作为 UI 状态或投影呈现，不得被后续逻辑当成 DSH core 已产生的新消息或新结算。终态必须由 Host 快照、waterfall、状态帧或 RPC 成功确认驱动。

## 2. 目标架构

### 当前链路

```text
DSH snapshot
  -> DshChatModel
  -> dshChatHistory.toHistory()
  -> IChatSessionHistoryItem[]
  -> RemoteChatSessionRestorer
  -> ChatListItemRenderer
  -> 线性 info / warning / markdown / tool part
```

### 目标链路

```text
DSH snapshot
  -> DshChatProjector
  -> DshContentStore（按 key 的增量可观察存储）
  -> DshSlotRegistry
  -> DshChatNodeRendererRegistry
  -> DshToolViewRegistry
  -> DshSlotHostContentPart（按 nodeId 订阅各自 source）
  -> 原生 ChatListItemRenderer 容器
```

### 关键要求

- nodeId、turnId、groupId、callId、eventId、status、version 全部保留。
- DSH slot 语义完整实现：5 种基数 × 3 种作用域。
- Chat renderer 只增加一个稳定扩展点 `dshSlotHost`。
- DSH 节点树由 DSH content store 持有，history part 只携带引用。
- **按 key 增量更新**：`get` / `source` / `bottomSource` / `turnDataSource` / `processSource` 语义对齐真源，不做整树重绘。
- 旧 `toHistory()` 从最终渲染真源降级为兼容序列化器。

## 3. 已确认取舍

| 编号 | 取舍 | 结论 |
|---|---|---|
| Q1 | 以交互行为对齐 DSH 网页端 | 采用；继续 Monaco + VS Code 原生 Chat 输入 |
| Q2 | 第一批会话控件可交付 | 采用；可见、可点、可回读才算完成 |
| Q3 | 发送时锁定本次草稿 | 采用；Host 确认前锁定，确认后清对应草稿 |
| Q4 | 文件引用与上传明确选择 | 采用；第一批图片/引用，通用文件等协议 |
| Q5 | DSH 要求时暂停普通输入 | 采用；审批/问卷/计划审阅按 Host 阻塞状态 |
| Q6 | Agent 预设从已绑定空白会话生效 | 采用；锁定状态显示当前值与原因 |
| Q7 | 发送结果未知先核对会话 | 采用；显示“发送结果待确认”，不自动重发 |
| Q8 | 生成期间 Enter 默认入队 | 采用；IME 与补全候选优先，Host 确认后提示 |
| Q9 | `/` 与 `@` 首版入口 | 采用；命令恢复、工作区引用；候选校验会话/草稿/位置 |
| Q10 | 通用文件用上传回执衔接 | 采用；第二期 `saveFileAttachment` + `submit.fileAttachments` |
| Q11 | 讨论计划结束审阅并回草稿 | 采用；必须 Host 明确结算，不本地隐藏卡片 |

## 4. 当前基线与差距

### 4.1 当前能显示

下表是**2026-11-22 实测**的当前形态，不是设计目标。证据：`dshNativePartAdapters.ts` 的 `adapter` 取值与 `dshChatHistory.ts` 的 part 构造。

| 内容 | 当前形态 | 结论 |
|---|---|---|
| 文本 | `markdownContent` | 可用 |
| reasoning | `thinking`（可被 `conversation.chat.reasoning.body` 覆盖正文） | 可用 |
| tool-call/result | `toolInvocationSerialized`，按 tool view 家族分开 input | 可用 |
| todo / plan / goal / skills / worktrees / team | `progressTaskSerialized`（可收起，逐项进 progress） | 可用，非 info 文本 |
| deliverables | `dshDeliverables` + 原生 `reference` 双轨（绝对路径可打开） | 可用 |
| approval | 任务行 + `dsh.answerApproval` 命令按钮（原生 confirmation 会另发请求） | 部分实现 |
| question | 原生 `ChatQuestionCarouselPart` 整份提交；作答后 `dshQuestionReply` 回执 | 可用 |
| plan（计划卡） | `submitted-plan` → `dshSubmittedPlan`，归到该 Turn 的 tail | 可用 |
| image | `dshImageGallery` | 可用 |
| file | `dshFileCard` | 可用 |
| usage | `turn-tail.tokenUsage` → `dshUsage`，助手行不重复 | 可用 |
| compaction / manual-compaction | `dshCompaction` + 命令行 | 可用 |
| model-retry / context / inherited-history / max-tokens / unknown | 各自的 `dsh*` 卡 | 可用 |

### 4.2 已消除的根本差距（原 7 条）

原表列的 7 条差距，逐条核对现状：

| 原差距 | 现状 | 证据 |
|---|---|---|
| 顺序混排，不是自由组合 | 已消除：节点进 `DshConversationNodeTree`，按 `parentCallId` 成树，槽位按 key 取 | `dshConversationNodeTree.ts`、`dshSlotHostContentPart.ts` |
| 节点身份在 `toHistory()` 中丢失 | 已消除：`kind + messageId` / `kind + callId` / `seq` 三级 key | `dshConversationNodeTree.ts` 的 `dshNodeKey` |
| 没有 DSH slot 语义 | 已消除：`DshSlotRegistry` 五种基数、三种作用域；9 个槽有消费点 | `dshSlotRegistry.ts`、`dshChatSlots.ts` |
| 没有 keyed node renderer 与 tool view registry | 已消除：`conversation.chat.node` 与 `tool.call.toolview` 都是 keyed 且已消费 | `dshChatSlots.ts` 的 `dshNodeRowOverride` / `dshToolViewOverride` |
| 没有语义级折叠体系 | 已消除：Turn 级 `(turn, answerStep)` + 节点级 disclosure | `dshExpansionStateStore.ts`、`dshProcessGroup.ts` |
| 复杂卡片靠文本模拟 | 已消除（除 §7 逐项标注的两处 command / warning 承载） | `dshNativePartAdapters.ts` 的 29 个 adapter |
| 原生 renderer 分派硬编码 | 已消除：先查槽位 occupant，缺省才内置分派 | `dshNativePartAdapters.ts`（29 个 adapter）、`chatListRenderer.ts` |

## 5. 目标模块清单

**路径校订（2026-11-22）**：原清单把模块分到 `browser/content/`、`browser/contentParts/`、`browser/toolViews/` 三个目录，实际实现全部落在 `src/vs/workbench/contrib/dsh/browser/vscode/`（43 个文件，扁平）。按「文档迁就代码」改成本节的实际清单；括号里是原设计名，仅用于追溯。

### 5.1 契约与机制层（`browser/vscode/`）

```text
dshSlotTypes.ts            槽位的两个轴与声明形状
dshSlotRegistry.ts         single/list/keyed/chain/hoc 裁决 + 作用域 + inject + dispose
dshChatSlots.ts            Chat 层槽位声明、运行期单例与 9 个消费点
dshChatModel.ts            线协议节点 → DshChatNode（不翻译形状）
dshConversationNodeTree.ts 按稳定 key 存节点、成树、per-key source
dshContentStore.ts         treeId → 会话节点树绑定
dshExpansionStateStore.ts  Turn 级 (turn, answerStep) + 节点级 disclosure
```

原设计名对照：`dshChatContentTypes.ts` → `dshChatModel.ts`；`dshNodeTypes.ts` → `dshChatModel.ts` 内的节点联合；`dshChatContentContribution.ts` → `dsh.contribution.ts`；`dshChatProjector.ts` → `src/vs/platform/dshClient/protocol/dshIdeConversation.ts`（投影在协议侧，不在 workbench）；`dshNodeIdentity.ts` → `dshConversationNodeTree.ts` 的 `dshNodeKey`。

**`dshSlotContext.ts` 已删除（2026-11-22）**：`DshSlotContext` / `DshSlotNodeRef` / `createDshSlotContext` 全仓零引用，槽位渲染直接用 `IDshSlotHostContent.treeId` 与 `DshSlotOwner`，不需要中间上下文对象。

### 5.2 Renderer 桥接层（`browser/vscode/`）

```text
dshSlotHostContentPart.ts   ChatList 里的 DSH 入口：按 nodeId 画行、折叠、侧栏、动作、手势
dshSlotHostModel.ts         槽位引用、节点行呈现、计划卡归尾部
dshNativePartAdapters.ts    DSH 节点 → 原生 chat part 形状（29 个 adapter）
dshQuestionCarouselContentPart.ts  原生问卷轮播
dshQuestionCarouselAdapter.ts / dshQuestionCarouselController.ts  问卷投影与提交
```

原设计名对照：`dshChatNodeSeatContentPart.ts` 与 `dshCompositeContentPart.ts` 未实现（由 `dshSlotHostContentPart` 直接按 key 渲染）；`dshSlotHostRenderer.ts` → `chatListRenderer.ts` 里的 `renderDshAdaptedPart`。

### 5.3 自研内容组件（内联在 `dshSlotHostContentPart.ts`）

原清单列的 14 个独立 `*ContentPart.ts` 没有落地。实际分工是：`dshNativePartAdapters.ts` 产出 `DshNativePart`；`chatListRenderer.renderDshAdaptedPart` 只认 8 类原生 part（`markdownContent`、`thinking`、`toolInvocationSerialized`、`warning`、`progressTaskSerialized`、`treeData`、`multiDiffData`、`reference`/`dshFileCard`/`dshDeliverables`、`errorDetails`）；其余 `dsh*` part 由 `dshSlotHostContentPart.renderAdaptedFallback` 画回退行。

**2026-11-22 更正**：适配层 20 处 `reuse` 字段曾写着 `DshImageGalleryContentPart`、`DshCompactionContentPart` 等类名，但**这些类在全仓都不存在**（`grep "class Dsh*ContentPart"` 命中 0）。它们已被改成 `dshSlotHostContentPart:renderAdaptedFallback`，并在 `DshNativeAdaptation.reuse` 的注释里写明「原生 part 写类名，没有等价物写回退渲染器」。同时新增测试断言：任何 `reuse` 要么是真实存在的原生类名，要么是回退渲染器，不允许出现第三种。

**优化机会已落地（2026-11-22）**：图片与文件卡两处的回退 `reason` 原本写「原生没有 DSH 图片画廊 / 文件卡」，**该说法不成立**。本仓 VS Code 源码已有 `ImageAttachmentWidget`（`chat/browser/attachments/chatAttachmentWidgets.ts:499`）、`FileAttachmentWidget`（同文件 `:253`）、`ChatAttachmentsContentPart`（`chatContentParts/chatAttachmentsContentPart.ts:39`），后者接受 `IChatRequestVariableEntry[]`，`IImageVariableEntry` 的 `id` / `name` / `value: URI` / `mimeType` 与我们的 `DshImageRef` 可直接对应。

落地时遇到一个真实阻塞：`ChatAttachmentsContentPart` **不实现 `IChatContentPart`**（缺 `hasSameContent`），直接返回会 `tsc` 报错。已新增 `dshAttachmentListContentPart.ts` 作为适配器补上这一层，`dshImageGallery` 现在走原生部件——缩略图、点击打开、hover 预览、主题适配全部复用，回退渲染器里的图片分支已删除。**文件卡为什么没跟着改**：`FileAttachmentWidget` 的构造签名第一个参数是 `resource: URI`，它靠这个 URI 打开文件、取图标与 hover 预览。但 DSH 的文件块只带 `attachmentId` / `name` / `bytes`（`DshIdeFileAttachmentRef`），**没有任何文件系统路径**。硬塞一个 URI 只能编造路径，属于伪造数据；因此 `dshFileCard` 仍走原生 `reference` 列表（名字可显示、点击行为由 reference 决定），不改。若将来 Host 在文件块上补出真实路径，这条才具备落地条件。
因此下列卡当前是**回退行**（文本 + 主题色），不是独立组件：`dshFileCard`、`dshDeliverables`（有原生 reference 列表）、`dshTurnTail`、`dshUsage`、`dshCompaction`、`dshSystemPrompt`、`dshCommand`、`dshCommandInput`、`dshQuestionReply`、`dshSubmittedPlan`、`dshWorkflowRun`、`dshTurnTrigger`、`dshContext`、`dshAssistantMeta`、`dshModelRetry`、`dshInheritedHistory`、`dshMaxTokens`、`dshUnknown`、`dshTurnTailExtra`。`dshFileCard` 与 `dshDeliverables` 会走原生 `ChatUsedReferencesListContentPart`（点击可打开）。

`dshChangedFilesContentPart.ts` 未实现；变更文件走原生 `multiDiffData`。

### 5.4 Tool Views（`browser/vscode/dshToolViewRegistry.ts`）

原设计是 14 个独立 `*ToolView.ts` 文件，实际是单一注册表按 wire 名分派到视图家族，DOM 仍由原生 `toolInvocationSerialized` 承载：`bash`、`read`、`readImage`、`fileMutation`、`search`、`web`、`todo`、`details`、`askQuestion`、`office`、`skill`、`present`、`generic`。家族清单与真源 `ui-tool/src/client/tool/toolviews/*.tsx` 的注册点对应；具体 key 覆盖 60+。

## 6. DSH Slot 机制清单

必须完整实现，不做残版。DSH 的槽位有**两个独立轴**：基数与作用域。

基数（cardinality）：

| 能力 | 要求 |
|---|---|
| `single` | 一个单元，优先级最高者渲染；需要累加时用子槽而不是当列表用 |
| `list` | 按必填 `id` 寻址，`order` 排序，再按注册顺序 |
| `keyed` | owner 传 `entryKey` 分发；**复用已占用的 key 即替换该 occupant** |
| `chain` | 每项提供纯函数 `select(owner)`，按 priority 首个非空结果渲染并作为 `matched`；全空则 owner fallback |
| `hoc` | 包裹 owner 的 `children` 层层嵌套，最低 order 在最外层；可带 `key` 按 `entryKey` 选层 |

作用域（scope）：

| 能力 | 要求 |
|---|---|
| `root` | 全局单例组件与 store |
| `session-maybe` | 继承外层绑定，但无绑定时仍可渲染，会话值为可选 |
| `session` | 必须有已解析的会话绑定，会话值为确定值 |

注册与裁决：

| 能力 | 要求 |
|---|---|
| `priority` | `single`/`list`/`keyed`/`hoc` 的遮蔽等级，`chain` 的选举顺序；**低值先渲染或先执行** |
| `order` | `list` 与 `hoc` 的排序 |
| `key` | `keyed` 与 `hoc` 的分发键；key 空间运行时开放，`SlotMap` 只声明槽不声明 key |
| owner props | host 锁定的 props 不允许 occupant 覆盖 |
| inject | 注册期工厂，收 `sessionId`（`session-maybe` 为可选），返回该 entry 私有数据与回调 |
| 声明即依赖 | 子槽只能在真正渲染该位置的组件里声明；其它包用 `ctx.slots.inject()` 等待声明生命周期 |
| dispose | 随 Cordis effect 生命周期释放；entry 销毁递归折叠其声明的子槽 |
| introspection | 生成的 client catalog 覆盖全部键；运行时可查询 live 树与精确键 |
| change event | `slots/changed` 触发聊天区刷新 |

### 6.1 Slot Context

renderer 不能只拿 payload，必须拿到完整上下文：

- sessionId / sessionResource
- turnId / nodeId / groupId
- input facade：草稿、插入、提交、阻塞状态
- conversation facade：snapshot、node lookup、turn lookup
- actions：answerApproval / answerQuestion / cancelRequest / openAttachment
- store：session scoped state
- expansion：折叠状态
- services：VS Code DI / command / hover / context menu / editor services

### 6.2 Slot 与 DSH 概念对应

真源为 `ui-chat/contract/slots.ts` 的 `SlotMap` 声明合并。完整清单与逐项差异见 本文附录 A「当前状态矩阵」第 2 节。

| DSH 概念 | 基数 / 作用域 | DSH-IDE 目标实现 |
|---|---|---|
| `conversation.chat.flow` | single / session | 由 VS Code ChatList 承载 |
| `conversation.chat.node` | keyed / session | `DshChatNodeRendererRegistry`，keyed by node kind |
| `conversation.chat.commandview` | keyed / session | command row renderer |
| `conversation.chat.reasoning.body` | single / session | 原生 thinking 复用 |
| `conversation.chat.turnTail` | list / session | turn 尾部扩展席 |
| `conversation.chat.assistant-actions` | list / session | 消息动作行 |
| `conversation.chat.user.before` | chain / session | 用户消息上方装饰 |
| `conversation.chat.user.images` | single / session | `DshImageGalleryContentPart` |
| `conversation.chat.message.images` | single / session | `DshImageGalleryContentPart` |
| `conversation.chat.aside` | single / session | 侧栏席位 |
| `conversation.chat.text-interaction` | keyed / session | 文本手势 |
| `conversation.chat.markdown.fence` | hoc / session | 围栏层 |
| `tool.call.toolview` | keyed / session | `DshToolViewRegistry`，keyed by wire 工具名 |
| `tool.call.images` | single / session | 工具图片画廊 |
| `shell.quota-notice` | chain / root | 配额通知链 |
| `conversation.approval.detail` | session | 审批详情席 |
| `conversation.plan-review.actions` | session | 计划审阅动作席 |
| `conversation.input.dock` | list / session | 输入卡上方整行（含 `id=queue`） |
| `conversation.composer.dock` | list / session | 输入卡下方环境区 |
| `conversation.view` | list / session | 由 VS Code Chat 面板承载 |

**校订**：`TurnUsagePanel` 是 `TurnTailNodeView` 内部的 React 组件（`CHAT/chat/TurnUsagePanel.tsx`），**不是 slot**。usage 数据由 `TurnTailChatData.tokenUsage` 提供，经 `conversation.chat.turnTail` 席位渲染；DSH-IDE 侧应做成 turn tail 内的自研 part，不为它单开槽位。

## 7. Conversation Node 清单

真源为 `ChatNodeDataMap`（**声明合并注册表**）：`ChatNodeKind = Extract<keyof ChatNodeDataMap, string>`，kind 空间运行时开放，不是固定枚举。逐项差异见 本文附录 A「当前状态矩阵」第 3 节。

**分层校订（2026-11-22）**：`packages/client/ui-conversation/src/client/contract/records.ts`（master `f20f24e0`）的 `ConversationNode` 联合只有 11 个 kind：`UserMessageNode`、`AssistantMessageNode`、`SteeringMessageNode`、`ContextMessageNode`、`ModelRetryNode`、`TurnErrorNode`、`TurnMaxTokensNode`、`ToolResultNode`、`CommandNode`、`CompactionSummaryNode`、`UnknownSurfaceNode`。`submitted-plan`、`command-input`、`question-reply`、`workflow-run` 是别的客户端包往 `ChatNodeDataMap` 合并注册的 **Chat 层** kind（`ui-plan`、`ui-user-questions`、`ui-workflow-run` 等），不在会话线的 `ConversationNode` 里。`assistant-step`、`turn-tail`、`turn-process`、`system-prompt`、`manual-compaction` 同理，是 Chat 层由多个 durable 节点合成的行，不是单独的事件节点。

DSH-IDE 的线协议只投影 `ConversationNode`（`src/vs/platform/dshClient/protocol/dshIdeProtocol.ts` 的 `DshIdeConversationNode`）。因此 Chat 层 kind 只有在 Host 增加对应投影后才能进入节点树；本文件把它们列为**目标**，不当作「已有数据没画」。

必须保留并投影的官方 `ConversationNode` kind：

| kind | 关键字段 |
|---|---|
| `user` | messageId、seq、time、content、source、referenceLabels、skillNames |
| `steering` | 同上 + batchStart |
| `context` | seq、time、content、source、producer、form |
| `turn-trigger` | ContextMessageNode |
| `assistant` | messageId、turn、step、blocks、time、usage、providerMetadata、requestConfig、timing、interrupted |
| `tool-call` | root: ToolCallBlock（含递归 subCalls） |
| `command` | commandId、name、args、outcome |
| `compaction` | `summary`、`summaryEventSeq`、`shadowedItemCount`、`shadowedTokenCount`。**真源注记（2026-11-23 在线核对 `ac11a30a`「restore compaction summaries by event address」）**：官方 `CompactionSummaryNode` 本身**没有** `summary` 字段，摘要由 `compaction/summary` 事件的 `data.summary`（**内容块数组** `[{type:'text',text}]`）按 seq 读回；本仓线协议保留 `summary` 作为投影结果（从事件里抽文本），不是照抄节点字段。 |
| `model-retry` | retry、maxRetries、delayMs、mode、retryState、failure |
| `turn-error` | TurnErrorNode |
| `turn-max-tokens` | TurnMaxTokensNode |
| `inherited-history` | 无载荷，锚点为标记 seq（`session/end-seed` 合成） |
| `unknown` | UnknownSurfaceNode（未认领的 append-surface 事件） |

Chat 层目标 kind（Host 投影到位前不进入节点树）：

| kind | 所属包 | 数据形状 |
|---|---|---|
| `assistant-step` | `ui-chat` | status、turn、step、blocks、time、usage、finalNode |
| `turn-tail` | `ui-chat` | turn、seq、time、closing、branchUnavailable、tokenUsage |
| `turn-process` | `ui-chat` | turn、controlAnchorSeq、processStartSeq、answerAnchorSeq、answerStep、inlineReasoning、messageCount、toolCallCount、subagentCount |
| `system-prompt` | `ui-chat` | text、update? |
| `manual-compaction` | `ui-chat` | command + compaction |
| `submitted-plan` | `ui-plan` | SubmittedPlan（callId、title、markdown） |
| `command-input` | `ui-goal` | GoalCommandInputData（commandId、text、time） |
| `question-reply` | `ui-user-questions` | QuestionReplyData（callId、outcome、questions、answers、text） |
| `workflow-run` | `ui-workflow-run` | WorkflowRunChatData（顶层运行及实际启动的成员） |

**已进线协议（2026-11-22）**：

- `submitted-plan`：`tool/call`（名称 `exit_plan_mode`）解析参数 JSON 的 `plan`，要求以 `# 标题` 开头（对齐官方 `submittedPlan` 的标题正则），另生成节点，通用工具行保留。渲染为 `dshSubmittedPlan`，并像官方一样把计划卡归到 turn tail：flow 里不单独成行，槽位在尾部按 Turn 收集并渲染。
- `command-input`：`name === 'goal'` 的 `command/run` 除通用 `command` 节点外另生成一行，文本是 `/${name}` 加去掉尾部空白的 `rawInput`（对齐官方 `goalCommandText`）。其它命令不生成。渲染为 `dshCommandInput`。
- `question-reply`：`ask_user_question` 工具结果里覆盖整份题目的 JSON 回执，或迟到人工回复（`source.kind === 'user-question-reply'` 且 `outcome === 'answered'`）。缺答案、带 `plan-review` intent 或多块正文时保留普通工具卡。渲染为 `dshQuestionReply`，按题面回显所选值与自由回答，被跳过的题显示 `(skipped)`。
- `workflow-run`：折叠 `tool-workflow/run-start`、`agent-start`、`agent-end`、`run-end`，按 `runId` 就地重写。阶段键对齐官方 `workflowPhaseKey`（`null` 是 `missing`，空串保留独立身份），成员状态取自身 outcome，未结算成员是 `running`。Turn 被中断 / fork 且没有 run-end 时，按官方 `turnAbandoned` 把运行与未结算成员转成 `interrupted`。渲染为 `dshWorkflowRun`。
- `turn-tail`：`turn/end` 时产出 `turn-tail` 节点，带 turn、`closing`（该回合最后一条带正文的助手答复，按官方 `chat/turn-assistant.ts` 的 `assistantText` 用 `join('')` 直接拼接多块正文、不加分隔符）、`branchUnavailable`、`closingMessageId`（官方 `closing.finalNode.messageId`）与 `tokenUsage`。渲染为 `dshTurnTail` + `dshUsage`；助手行不再重复一份用量。**口径（2026-11-23，CHK-328）**：官方 token-meter 的 `usageOf()` 同时接受 `assistant/message`（`data.usage`）与 `assistant/attempt`（stream 里最后一个 `usage` chunk），同一 `(turn, step)` 再报样本时 `addReplacing` 先扣后加、`llm/retry-started` 清空替换槽；本仓两条入口都已接上并共用 `noteTurnUsage`，不再是「只按 assistant 节点累加」。与官方 `deriveTurnTokenUsage` 的比较目前只差「返回值证明强度」（官方用完整生命周期证据判定，异常时整份不给；本仓按事件增量累计，不额外证明一致性），这一点记在 §17 剩余工作里。

**turn-tail 的真源核对（2026-11-22，`packages/client/ui-chat/src/client/chat/TurnTailNodeView.tsx` @ master）**：官方该视图做三件事——① `branchUnavailable={data.branchUnavailable || hasLaterChatNode}`，其中 `hasLaterChatNode` 是「同 Turn 内存在 `anchorSeq > closing.finalNode.seq` 的节点，跳过 `turn-max-tokens`」；② `messageId = closing.finalNode.messageId`，`undefined` 时**不给动作行**；③ 动作行与 `TurnUsagePanel` 都在 tail 内，`usageAction` 只在 `detailed` 模式下出现。

据此两条差异均已收口（2026-11-22）：

- `conversation.chat.assistant-actions` 改为挂在 **turn tail** 内，owner 是新增的 `turn-tail.closingMessageId`（投影取 `closing.finalNode.messageId`，中断冻结的部分回复没有 messageId 时不写该字段，因而不给动作行）。协议、校验器、投影、客户端与测试五处同步。
- `branchUnavailable` 现在等于「closing 为空 / 该 Turn 出错 / **同 Turn 内还有 `anchorSeq` 大于收尾答复 seq 的节点**」。后者按官方 `lastContent(snapshot, turn, skipWarning = true)` 实现：`lastTurnContentSeq` 遍历该 Turn 的节点，跳过 `turn-tail`、`turn-process` 与 `turn-max-tokens`，取最大 seq 与收尾答复 seq 比较。原先按「转写位置」（工具/重试/错误）判定的 `latestTranscriptSeq` 已删除——它是这条判据的死字段。

**已知差异（仅剩粒度）**：官方在渲染期按实时快照算 `hasLaterChatNode`，本仓在 `turn/end` 投影时算一次；Turn 结束后的 fork 新增节点不会回溯改写已产出的 `turn-tail`。

**`TurnProcessSpec` 计数口径（2026-11-22 按官方 `contract/turn-process.ts` 对齐）**：`toolCallCount` 是「**Durable non-subagent** Tool calls recorded by this Turn」——子代理委派只进 `subagentCount`，**不得同时计入 `toolCallCount`**。此前投影两处都加，导致一次 `subagent` 调用被数成「1 个工具 + 1 个子代理」。已改为按 `isSubagent` 分流。

`messageCount` 官方定义是「Reply-bearing durable Assistant messages **before the final answer**」。2026-11-22 已按此对齐两处：投影层改为记录 `assistantCount` 并在输出时减 1（排除最终答复），input 节点不再计入；客户端 `describeTurnProcess` 改为收集助手 seq、取 `length - 1`。同一批还修正了客户端 `toolCallCount` 的重叠计数——`subagent` 调用只进 `subagentCount`，不再同时计入 `toolCallCount`。

**用量桶语义（2026-11-22 按官方 `TurnTokenUsage` 修正）**：`cacheReadTokens` / `cacheWriteTokens` / `reasoningTokens` **只在每个已计入的尝试都报告了该桶时才存在**；任一次缺失，整桶作废，不是记 0。此前实现把所有缺失桶当 0 累加并恒写五个字段，等于伪造「缓存为 0」，已改为用 `cacheReadComplete` / `cacheWriteComplete` / `reasoningComplete` 记账，缺失时整桶省略，且这些记账字段不上线（`tokenUsageView` 只输出协议字段）。

`turn-max-tokens` 不计入「其后有内容」这一点两边一致：投影只在 `tool/call`、`tool/result`（append）、`llm/retry` 处记转写位置。
- `system-prompt`：`system/message` 的每次非空 append 拥有一张提示卡（对齐官方「each nonempty append owns a prompt card」）；文本与上一份不同时标 `update: true`。非 append 的替换不产卡。渲染为 `dshSystemPrompt`。

- `manual-compaction`：命令结算带 `outcome.sourceEventSeq` 且指向某个压缩检查点（按节点 seq 或 `summaryEventSeq` 匹配）时，命令行与压缩卡合成一个 `manual-compaction` 节点，两张旧卡删除，避免同一动作画两遍；先到后到都能配对。适配层产出命令行 + 压缩卡两段。

- `turn-process`：`turn/end` 时与尾部同批产出 `turn-process` 节点，带过程锚点（控制锚点、过程起点、答复锚点）、`answerStep`、`inlineReasoning`（固定 false）与三类计数。收起时槽位**优先读这个节点**画计数行（`dshProcessGroup.processLineFromSnapshot`），节点缺失才回退到按现有节点现算；该节点本身不再单独画一行。**已知差异**：折叠与否仍由客户端的 `dshProcessGroup` 判定（它还需要 `hasInterleavedInput` 等节点级信息），没有把官方那个独立的「过程组 DOM」整块搬过来。

**已无剩余差异项**：`submitted-plan` 现在与官方一致——`tool/call`（`exit_plan_mode`）带 `# 标题` 时另成节点，槽位把它按 Turn 收到 turn tail 渲染，flow 里不再单独成行；通用工具行仍保留。

DSH-IDE 现有私有节点（真源无对应 kind，PR-02 需裁定）：`subagent-catalog`、`subagent-notice`。

## 8. Tool View 清单

真源为 `tool.call.toolview`（keyed / session），key 是 **wire 工具名**；无注册时回落 `GenericToolCard`。逐项差异见 本文附录 A「当前状态矩阵」第 6 节。

DSH 实际注册点覆盖 60+ 个 key。按呈现家族归并：

| 家族 | 覆盖的 key | DSH-IDE 目标 renderer |
|---|---|---|
| 终端命令 | `bash` | `bashToolView.ts` |
| 文件读取 | `read` | `readToolView.ts` |
| 图片读取 | `read_image` | `readImageToolView.ts` |
| 文件改写 | `apply_patch`、`edit`、`write` | `fileMutationToolView.ts` |
| 搜索 | `grep`、`glob` | `searchToolView.ts` |
| 网络 | `web_search`、`web_fetch` | `webToolView.ts` |
| 待办 | `todo_write` | `todoToolView.ts` |
| 问答 | `ask_user_question` | `askQuestionToolView.ts` |
| 办公文档 | `office_render`、`office_convert`、`office_recalculate` | `officeToolView.ts` |
| 技能 | `skill` | `skillToolView.ts` |
| 交付物 | `present` | `presentToolView.ts` |
| 记录型详情（共享紧凑行） | `create_goal`、`get_goal`、`update_goal`、`schedule_create`、`schedule_list`、`schedule_view`、`schedule_edit`、`schedule_delete`、`schedule_update`、`cordis_inspect`、`cordis_inspect_list`、`cordis_inspect_query`、`cordis_inspect_self`、`workflow`、`ralph`、`session_event_read`、`session_event_search`、`session_event_trace`、`session_search`、`session_trace`、`list_subagent_models`、`subagent`、`subagent_fork`、`list_agents`、`send_message`、`interrupt_agent`、`wait_agent`、`job_list`、`job_output`、`job_kill`、`terminal_open`、`terminal_read`、`terminal_list`、`terminal_signal`、`terminal_close`、`lsp`、`spawn_teammate`、`team_task_create`、`team_task_get`、`team_task_update`、`team_task_list` | `detailsToolView.ts` |
| Cordis 运行时 | `cordis_stop`、`cordis_undefine` | `detailsToolView.ts`（复用） |
| 时间线 | `timeline_tasks` | `detailsToolView.ts`（复用） |
| 未注册 | 任意其它 wire 名 | `genericToolView.ts` |

**要点**：`details-row` 不是「DSH details keys」的特例，而是**记录型工具的统一紧凑详情行**，一个 renderer 承载 42 个 key。DSH-IDE 不应为每个 key 造独立组件。

## 9. 原生复用 / 改造 / 自研矩阵

| DSH 内容 | 策略 | 说明 |
|---|---|---|
| 文本 | 复用 | `ChatMarkdownContentPart` |
| reasoning | 复用 | `ChatThinkingContentPart` |
| 普通 tool | 复用 + 扩展 | `ChatToolInvocationPart`，补 DSH metadata |
| todo/task | 复用 | `ChatTaskContentPart` |
| reference | 复用 | `ChatUsedReferencesListContentPart` |
| plan review | 优先扩展原生 | `ChatPlanReviewPart`；缺 discuss 则扩展 model/actions |
| question | 优先扩展原生 | `ChatQuestionCarouselPart`；缺 custom/multi 则扩展 |
| approval | 优先扩展原生 | `ChatConfirmationContentPart`；缺 always/reason/subject 则扩展 |
| error/quota | 复用 | `ChatErrorContentPart` / `ChatQuotaExceededPart` |
| diff/tree | 复用 | `ChatMultiDiffContentPart` / `ChatTreeContentPart` |
| process group | 自研原生化 | 继承/复用 `ChatCollapsibleContentPart` |
| tool tree | 自研原生化 | DSH 特有能力 |
| image gallery | 自研原生化 | 原生没有完整 DSH 画廊 |
| file card | 自研原生化 | 原生没有等价 file card |
| deliverables/changed files | 自研原生化 | DSH turn tail 语义 |
| usage panel | 自研原生化 | 数据有，UI 缺 |
| compaction | 自研原生化 | 原生没有 DSH compaction 语义 |
| system prompt row | 自研原生化 | 原生没有专用 row |
| plan discuss | 改造 + 自研动作 | 必须结构化结算 |
| 多题问卷完整答复 | 改造 + 自研动作 | 不支持半份答案 |

## 10. 必须修改的现有机制

| 文件/模块 | 修改内容 |
|---|---|
| `chatListRenderer.ts` | 硬编码 `if/else` 改为 content part renderer registry；增加 `dshSlotHost` 总入口 |
| `chatService.ts` | 增加内部 serialized progress `dshSlotHost` |
| `chatSessionsService.ts` | 支持 DSH slot host history part 的内部形状 |
| `remoteChatSessionRestorer.ts` | 回放 `dshSlotHost` 引用，不将 DSH 树压成文本 |
| `dshChatHistory.ts` | 从最终渲染真源降级为兼容序列化器 |
| `dshChatSessionContent.ts` | 同时提供 node tree、pending、extras、usage、dshSlotHost 引用 |
| `dshChatSession.ts` | 暴露完整 answerApproval / answerQuestion / cancelRequest / plan discuss / node lookup / actions |
| `dshIdeProtocol.ts` | 补齐 node identity、version、toolKey、full answer、plan discuss 等字段 |
| `ide-view-host.js` | 从 DSH session controller 投影完整字段 |

### 10.1 渲染扩展点

`chatListRenderer.ts` 当前通过硬编码分派：

```ts
if (content.kind === 'treeData') ...
else if (content.kind === 'markdownContent') ...
else if (content.kind === 'planReview') ...
...
```

目标：

- 引入 `IChatContentPartRenderer` registry；
- 原生 kind 也逐步注册为 renderer；
- DSH 只注册一个总入口：

```ts
if (content.kind === 'dshSlotHost') {
	return this.dshSlotHostRenderer.render(content, context, templateData);
}
```

禁止无止境增加 DSH `else if`。

### 10.2 DSH Slot Host 引用

serialized part 只携带引用：

```ts
interface IDshSlotHostSerialized {
	kind: 'dshSlotHost';
	treeId: string;
	nodeIds: readonly string[];
	version: number;
}
```

真正 node tree 存储在 session-scoped DSH content store，避免 history 膨胀。

## 11. 自研组件原生化标准

所有自研 DSH content part 必须满足：

### 11.1 视觉

- 使用 VS Code CSS 变量；
- 使用 codicon / ThemeIcon；
- 沿用 Chat 间距、字号、圆角、边框；
- 支持浅色、深色、高对比度主题；
- 不引入 DSH Web 专用色板、字体、按钮样式；
- 不手抄近似 Logo / icon。

### 11.2 交互

- Tab / Shift+Tab 可达；
- Enter / Space 激活按钮；
- 支持 focus-visible；
- 支持 hover tooltip；
- 支持 context menu；
- 折叠交互像原生 disclosure；
- 文件打开走原生 editor / diff / reveal；
- 图片预览走原生 hover/lightbox 能力；
- 不使用自定义 modal 替代 VS Code modal。

### 11.3 生命周期

- 实现标准 `IChatContentPart`；
- 所有监听进入 `DisposableStore`；
- `hasSameContent()` 按 `nodeId + version + rendererId`；
- 折叠状态外部化；
- 支持虚拟化重绘；
- 不做全局 DOM 引用。

### 11.4 可访问性

- `aria-label`
- `role`
- `aria-expanded`
- `aria-controls`
- tooltip
- live region（状态变化）
- screen reader 可读状态文字

## 12. 折叠与组合机制

### 12.1 折叠状态外部化

真源里折叠是**两层**，不是一个五段 key。逐项差异见 本文附录 A「当前状态矩阵」第 4 节。

**第一层：Turn 过程折叠**（`ChatStoreState.turnProcesses`）

```text
key = turn + answerStep
value = { collapsed?: true }   // 缺省表示显式展开
```

- 每个会话一份 store，切会话隔离；
- 刷新快照不丢；
- 只决定「整个 turn 的过程是否折叠」，不记录节点级展开。

**第二层：节点级 disclosure**（`useDisclosure`）

- 每次调用拥有**独立**的展开状态；
- 随所属 Turn 重置而复位（`disclosureReset`）；
- 展示模式变化不重置；
- 状态随组件生命周期，不落 DOM，也不跨会话共享。

判定「能否折叠」不靠状态，靠语义：

| 判定 | 语义 |
|---|---|
| `turnProcessAlwaysOpen(node)` | turn 为 `open`，或 end reason 为 `aborted` / `interrupted` / `error` 时不可整体折叠 |
| `ChatGroupTree` | `exchange` / `input` / `turn` / `process` 四级位置决定节点归哪一层 |
| `isAtOrOutside(node, position)` | 位置深度比较，判断节点是否在某层之外。**本仓未实现独立函数**：等价判断由 `groupPositionOf` + `visibleProcessKeys` 完成（原实现零调用，2026-11-22 删除） |
| `TurnProcessSpec` | 提供 `controlAnchorSeq` / `processStartSeq` / `answerAnchorSeq` 等锚点 |
| `ChatTurnProcessPresentation` | `turnStarted` / `turnClosed` / `hasExternalProcess` / `hasNonReplyProcess` / `hasInterleavedInput` |

**已证伪**：原设计的 `sessionId:turnId:groupId:nodeId:rendererId` 五段 key 在真源中不存在。按它实现会与 DSH 的「Turn 重置即复位」语义冲突——DSH 故意不让节点级展开跨 turn 存活。

### 12.2 组合靠 composite part

DSH 的卡片内嵌工具行、图片、状态徽标、操作按钮，不靠 `response.parts.push()` 表达。

必须通过：

```ts
DshCompositeContentPart
  -> 内部渲染 children
  -> 内部注册子 slot
  -> 内部持有 DisposableStore
  -> 内部管理 expansion
  -> 对外只暴露一个 domNode
```

包括：

- process group
- tool tree
- message
- turn tail
- deliverables
- image gallery
- approval/question panel

### 12.3 增量更新，不是整树重绘

真源的 `ChatSnapshot` 是**按 key 的可观察存储**，不是「整棵树重建后整体 diff」。这是原设计最需要修正的一点。

| 接口 | 语义 |
|---|---|
| `nodes.get(key)` | 取当前节点 |
| `nodes.source(key)` | 该 key 的身份稳定 observable |
| `nodes.bottomSource(key)` | 是否属于最新已载入 exchange |
| `nodes.turnDataSource(turn, kind)` | 单 turn 单 kind 的有序数据源，其它 turn/kind 不通知 |
| `nodes.processSource(key)` | 该节点所属 turn 的过程展示源 |
| `locations.getTurn(turn)` / `getStep(turn, step)` | 位置索引 |
| `navigation.items()` | 已载入 turn 的导航项 |

因此 `DshSlotHostContentPart` 内部必须按 nodeId 订阅各自的 source，而不是靠外层整体刷新。否则流式更新与虚拟化重绘都会退化。

## 13. 分阶段 PR 计划

### PR-01：契约冻结

- 在线核对 DSH HEAD：`slots.ts`、`snapshot.ts`、`types.ts`、`commands.ts`、`controller.ts`。
- 校订本文 slot / node / tool view / pending / plan / question 清单。
- 产出契约差异表。
- 验收：不存在“先用文本代替”的最终态。

### PR-02：协议字段补齐

- 修改 `dshIdeProtocol.ts`、`ide-view-host.js`、validators 与 bridge 测试。
- 新增字段：nodeId、turnId、groupId、parentId、callId、eventId、version、toolKey、status、display metadata、full question answer、plan discuss、usage。
- 验收：字段可稳定拿到；旧 Host 缺字段时 fail-closed 或明确 fallback；不伪造缺省值。

### PR-03：DshSlotRegistry

- 实现 `dshSlotTypes.ts`、`dshSlotRegistry.ts` 与单测。原计划的 `dshSlotContext.ts` 已确认零引用并删除（2026-11-22），槽位渲染直接用 `treeId` 与 `DshSlotOwner`。
- 验收：single/list/keyed/chain、root/session-maybe/session、owner props、inject、priority/order/key、dispose、introspection 全部通过测试。

### PR-04：Node Tree 与 Projector

- 实现 `DshChatProjector`、`DshConversationNodeTree`、`DshNodeIdentity`。
- `DshChatSessionContent` 同时提供 node tree。
- 旧 `toHistory()` 保留 fallback。
- 验收：复杂 snapshot 保留所有身份和层级；快照刷新不重建无关节点；`toHistory()` 不再新增模拟卡片。

### PR-05：Renderer 扩展点

- 改 `chatListRenderer.ts`，引入 content part renderer registry。
- 增加 `dshSlotHost`。
- 改 restorer / serialized types。
- 实现 `dshSlotHostContentPart.ts`。
- 验收：ChatList 只看到一个 DSH part；DSH 内部节点独立 diff；切会话不串树；dispose 无泄漏。

### PR-06：Native Adapters

- 实现 markdown、thinking、tool generic、task、reference、error、quota、diff、tree adapter。
- 必要时扩展原生 part model。
- 验收：每个 adapter 标注复用组件、改造点、原因；不再用 info/warning/markdown 模拟这些节点。

### PR-07：Composite Parts 基础

- 实现 `DshCompositeContentPart`、`DshProcessGroupContentPart`、`DshExpansionStateStore`、`DshToolTreeContentPart` 骨架。
- 验收：turn/process/tool tree 可折叠；刷新快照保留折叠状态；折叠状态不在 DOM 上。

### PR-08：Tool Views

- 实现第 8 节全部 tool views 与 `DshToolViewRegistry`。
- 验收：不同 toolName 显示不同 tool view；generic fallback 只兜底未知工具。

### PR-09：图片、文件、交付物、Turn Tail

- 实现 `DshImageGalleryContentPart`、`DshFileCardContentPart`、`DshDeliverablesContentPart`、`DshChangedFilesContentPart`、`DshTurnTailContentPart`、`DshUsageContentPart`。
- 验收：图片、文件、diff、交付物、usage 可见可操作；打开行为走 VS Code 原生服务；符合原生化标准。

### PR-10：Pending / Plan / Question 闭环

- approval：approve/reject/always/reason/subject。
- question：多题、多选、custom answer、一次提交、reply bubble。
- plan：accept/reject/discuss；discuss 结束请求并恢复草稿。
- inputBlocked；stale 请求撤销；Host cancel 后撤入口。
- 验收：多题问卷完整提交；plan discuss 不留下悬挂 pending；草稿和附件保留并恢复。

### PR-11：Compaction / System Prompt / Command / Error Cards

- 实现 `DshCompactionContentPart`、`DshSystemPromptContentPart`、`DshCommandContentPart`、retry/max tokens/turn error 结构化卡。
- 验收：不再有 markdown 引用块模拟结构化节点。

### PR-12：旧路径清理

- 删除 info/warning/markdown hack。
- 删除 `File: xxx` / `Image: xxx` 文本标签。
- 删除单题按钮 fallback。
- `toHistory()` 降级为兼容层或退场。
- 验收：没有结构化节点继续靠文本模拟。

### PR-13：硬化与文档

- 更新文档、整理测试结果、跑完整门禁、整理真机验收结果。
- 验收：`tsc --noEmit` PASS；相关测试 PASS；真机项由用户确认；未跑项严格 PENDING。

## 14. 测试门禁

| 模块 | 测试内容 |
|---|---|
| `DshSlotRegistry` | cardinality、scope、priority、order、key、owner props、inject、dispose、introspection |
| `DshConversationNodeTree` | turn/group/parent-child、lookup、version、session 隔离 |
| `DshChatProjector` | snapshot -> node tree、tool-call/result 合并、subCalls、pending/extras 关联 |
| `DshExpansionStateStore` | session scoped、刷新保留、切会话隔离、清理 |
| `DshSlotHostContentPart` | hasSameContent、dispose、子 renderer 生命周期 |
| native adapters | DSH payload -> native content model |
| self parts | 键盘、折叠、dispose、aria 基础断言 |
| tool views | keyed 匹配、generic fallback、status/output/error |
| protocol validators | 新字段校验、缺字段 fail-closed |
| Host bridge | controller 字段投影、requestId/eventId/callId 保持 |

门禁状态只允许：

- `PASS`
- `PENDING`
- `FAIL`

不得把未跑门禁写成 PASS。

## 15. 真机验收清单

真机验证由用户执行；AI 不代跑 GUI，不模拟 DSH 会话。

### 15.1 内容渲染

- 文本、reasoning、tool、image、file、reference 均按结构化节点显示。
- plan/goal/skills/compaction/system prompt 不再是 info/markdown 文本；计划卡出现在该 Turn 的尾部，对应 Turn 的 flow 里只有工具行。
- approval/question 有完整卡片；问卷用原生轮播（多题、多选、自由回答），作答后出现问答回执并按题面回显。
- deliverables/usage/turnTail 在 turn 尾部可见；用量只在尾部出现一份，助手行不再重复。
- `/goal` 人工输入单独成行；`/compact` 显示为命令行 + 压缩卡。
- 工作流显示阶段与成员状态；Turn 被中断后未结束的运行显示为 interrupted。
- 工具按 toolName 显示不同 tool view。

### 15.2 折叠

- turn 可折叠；收起后同一位置显示一行过程计数（`tools N, subagents M, messages K`）。
- process group 可折叠；交错输入（工具后又有人类消息）的 Turn 不允许整体收起。
- reasoning 可折叠。
- tool tree 可折叠。
- system prompt 可折叠。
- compaction 可展开摘要。
- 刷新快照后折叠状态保留。

### 15.3 交互

- approval 可 approve/reject/always。
- question 支持多题、多选、custom answer，一次提交。
- plan 支持 accept/reject/discuss；discuss 结束审阅并回到输入框。
- 问卷提交在一次在途请求期间不可重复点击；失败时草稿保留、卡片不消失。
- 文件、图片、diff 可用原生方式打开。
- stale 请求按钮不会出现或不可点。
- 多会话切换不串内容、不串草稿、不串折叠状态。

### 15.4 原生化

- 使用 VS Code 主题变量。
- 深浅主题、高对比度主题正常。
- 键盘可操作。
- hover/tooltip/context menu 像原生 Chat。
- 无网页风格按钮、字体、颜色、图标。
- 无第二套滚动或输入框。

## 16. 退出条件

只有以下条件全部满足，内容原子化改造才算完成：

1. DSH slot、node、tool view、pending、plan、question、deliverables 语义与 DSH 对齐。
2. 每个节点都能说明：用了哪个原生组件、或改造了哪个原生组件、或为什么必须自研。
3. 自研组件在视觉、交互、键盘、主题、高对比度、可访问性、生命周期上像 VS Code 原生 Chat。
4. 没有结构化节点继续靠 info/warning/markdown 文本模拟。
5. turn、process group、reasoning、tool tree、system prompt、compaction、turn tail 均可按 DSH 语义折叠/展开。
6. 快照刷新、会话切换、虚拟化重绘不丢失折叠状态、草稿、pending 入口和节点身份。
7. `tsc --noEmit` PASS，相关测试 PASS，真机验收由用户确认；未跑项严格标注 PENDING。

## 17. 当前立刻开始项

**当前剩余工作（2026-11-22 收盘，按可执行性排序）**：

1. 输入区两席（`conversation.input.dock` / `conversation.composer.dock`）已于 2026-11-23 接上消费点：`dshInputDock.ts` 把 occupant 投影成行，`dshChatInputDock.ts` 在原生输入卡上下方各渲染一个宿主，`dshChatInputDockContribution.ts` 用 `IChatWidgetService.onDidAddWidget` 挂到每个原生 chat widget（不改上游 `ChatInputPart`），并由 `DshSlotRegistry.onDidChange` 驱动重画。状态仍是 `部分实现`：真机未验收；且 `conversation.input.dock` 的 owner `input`（输入机状态）本仓没有建模，如实留空而不是伪造一个假值。
2. ~~待处理提交 dock（`pendingInputs` / `InboxState['next-step']`）：当前被数据源阻塞~~ **已实现（2026-11-23，CHK-337）**——**原判断是错的**：官方 `SessionEventMap['agent/inbox/spliced']` 的 `inserted` 就是完整 `UserMessage[]`（含 `content` 的 text/image/file 块），`inbox` 投影原样上线，官方 `QueueDock` 直接读它。本仓真正的问题是投影层 `inboxIdentities()` 只取 `{id, sourceKind}`、**自己把 content 丢了**。现已保留内容块并逐层下发到 `conversation.input.dock`（`dshQueueDockRows`，`order: 20` 与官方一致）；编辑/删除/转向仍缺 Host 方法，本轮只做只读展示。以下为历史记录（错误结论）——线协议里 inbox 只有 `agent/inbox/spliced` 事件，投影出的 `pending` 每项仅含 `id` 与 `sourceKind`（`DshIdeInboxIdentity`），**没有正文与附件**；原生 Chat 也没有输入队列机制（全仓无 `queuedMessages` / `pendingRequests` 之类状态）。只凭身份渲染队列会变成「有 2 条排队」这种空壳，属于用文本模拟，故不实现。要做需要 Host 先下发排队项的正文/附件，或由客户端自建本地队列并自行承担与 Host 的一致性。
3. 问答面板：官方 `userQuestionPanels.reveal/review` 可把已答问卷重新打开；本仓只有就地 `question-reply` 回执（在 transcript 里按题面回显答案），没有可重新打开的独立面板。要补需要宿主提供 `reveal` / `review` 入口与面板宿主，属新增 UI 面，不只是接线。
4. 两条渲染层已知差异：~~`turn-tail` 的用量按 assistant 节点累加（官方按计量事件）~~ **已修（2026-11-23，CHK-328）**：官方 `usageOf()` 同时接受 `assistant/message` 与 `assistant/attempt`（后者读 stream 里最后一个 usage chunk），且 `llm/retry-started` 会清空同 `(turn, step)` 的替换槽让重试重新计入——两处本仓都已接上并共用同一个 `noteTurnUsage`。~~剩下一条：折叠判定仍在客户端 `dshProcessGroup`（官方是 `turn-process` 驱动的过程组 DOM）~~ **已修（2026-11-23，CHK-336）**：本仓本来就按 `turn-process` 节点取计数（CHK-334），真正的问题是**折叠判据拿不到官方原因**——`groupTurnProcesses` 的 `reasonByTurn` 在生产调用点从不传，永远走 fallback（`sawSignal || !sawAnswer`）；同时 `describeTurnProcess.turnClosed` 用「有答复」当「已关闭」，而官方 `turnProcessAlwaysOpen(node)` 用 `location.turn.status === 'open'` + `turn.end.data.reason.kind`。结果：已正常结束但有信号节点的 Turn 被误判为不可收起，而「已出答复但仍在跑」的 Turn 又可能被当成可收起。现补：线协议 `turn-process` 新增可选 `endReason`（= `turn/end.reason.kind`，含 validator fail-closed）、投影记录并下发、`dshProcessGroup` 用 `endReason` 判 `turnClosed`、`DshSlotHostContentPart` 从每个 Turn 的 `turn-process` 节点取 `reasonByTurn` 传给 `groupTurnProcesses`。~~② 用量只差「返回值证明强度」~~ **已修（2026-11-23，CHK-335）**：官方 README「Turn token usage」写明两条硬条件——loaded window 必须包含 `turn/start`，且**每个已开始的模型 attempt 都报过安全、精确的用量**；任一不满足就整份隐藏（incomplete or contradictory accounting hides the complete disclosure）。本仓此前既没有 `turn/start` 分支（无法判定窗口是否含起点），也没有 attempt 计数（无法发现「有 attempt 没报」），因此会无条件显示一个可能残缺的用量。现补：`turn/start` 分支记录 `turnStarted`；`assistant/attempt` 与 `assistant/message` 各自记 `usageAttempts` / `usageAttemptsMissing`；`usageDisclosureOf()` 只在 `turnStarted === true && usageAttemptsMissing === 0` 时返回值，否则不写 `tokenUsage` 字段。
5. 真机验收：§15 清单由用户执行；AI 不代跑 GUI。

已接消费点的槽（2026-11-22）：`conversation.chat.node`（keyed，行覆盖）、`tool.call.toolview`（keyed，视图家族）、`conversation.chat.turnTail`（list，尾部追加行）、`shell.quota-notice`（chain，配额文案与 keepOpen）、`conversation.chat.reasoning.body`（single，思考正文）、`conversation.chat.assistant-actions`（list，动作按钮）、`conversation.chat.user.before`（chain，用户行上方装饰）、`conversation.chat.text-interaction`（keyed，选中手势）、`conversation.chat.aside`（single，侧栏文本）、`conversation.chat.markdown.fence`（hoc，围栏接管）、`conversation.input.dock`（list，输入卡上方行）、`conversation.composer.dock`（list，输入卡下方行）。

历史记录（PR-01/PR-02 的回改与裁定）保留在下方，不重复。

### 17.1 历史记录：PR-01 核对回改与 PR-02 裁定

**2026-11-22 补记：节点渲染扩展点已接线。** `conversation.chat.node`（官方 keyed / session，key 是 node kind）现在有运行期声明与消费点：`dshChatSlots.dshNodeRowOverride(kind, sessionId)` 用会话 id 解析该槽，胜出的 occupant 可覆盖 `title` / `detail` / `icon`；`presentDshNode` 先问它，没有 occupant 才走内置标题与图标。槽位作用域是 `session`，没有会话 id 时为 `unbound`、不覆盖。

**同一批接线：`tool.call.toolview`。** `dshToolViewOverride(toolName, sessionId)` 让插件按 wire 工具名指定视图家族；`adaptDshNode(node, sessionId)` 先问它，缺省才按内置 wire 名分派。

**第三处：`conversation.chat.turnTail`（list）。** `dshTurnTailExtras(sessionId, turn, seq)` 按 `order` 取 occupant 的 `label`，作为 `dshTurnTailExtra` 行追加到尾部；只收可读文本，没有为此假装做出独立 DOM 席位。

**第四处：`shell.quota-notice`（chain / root）。** `dshQuotaNoticeOverride(code)` 按官方 chain 语义选首个返回非空 `select` 的 occupant；认领成功可覆盖通知文案（`label`）并要求保持显示（`keepOpen`，配合 `retainQuotaNotice` 的缺省/旧 seq 不覆盖）。没有 occupant 认领时用内置文案。

**第五处：`conversation.chat.reasoning.body`（single）。** `dshReasoningBodyOverride(sessionId)` 允许 occupant 覆盖思考正文文本；缺省用节点的 reasoning。只换文本，不另造 reasoning DOM。

**第六处：`conversation.chat.assistant-actions`（list）。** `dshAssistantActions(sessionId, messageId)` 按 `order` 取 occupant 的 `title` / `command` / `arguments`，助手行下渲染按钮条；点击走 `DshNativePartRenderer.executeCommand`（宿主 `ICommandService`）。缺 `title` 或 `command` 的 occupant 被跳过；没有 `messageId` 的助手行不查槽位。

**第七处：`conversation.chat.user.before`（chain）。** `dshUserBeforeDecoration(sessionId, kind, source)` 按 chain 语义选首个返回非空 `select` 的 occupant，其返回值作为用户行上方的一行装饰文本；无人认领时不显示任何装饰。

**第八处：`conversation.chat.text-interaction`（keyed）。** `dshTextInteractions(sessionId, surface)` 按 surface 取 occupant；助手行在有选中文本时显示手势条，点击把选中文本作为最后一个参数传给插件命令。选中判定用 `selectionchange`，不接管原生选择。

前四处只在有会话 id 时生效（配额链是 root 作用域，不需要会话）。`dshSlotHostModel.test.ts` 10 项、`dshNativePartAdapters.test.ts` 28 项通过。真机未验证。

PR-01 已完成，结论见本文附录 A「当前状态矩阵」。核对发现原契约有 6 处与 DSH 真源不符，已在本轮回改：

1. 槽位基数漏掉 `hoc`，且把作用域混进基数清单。
2. `TurnUsagePanel` 槽位不存在，usage 经 `turn-tail` 承载。
3. 节点清单混写了 `ConversationNode`（11 个）与客户端包合并注册的 Chat 层 kind，且未说明 kind 空间运行时开放。已在 §7 拆成两张表。
4. Tool view 清单只列 13 个 key，真源覆盖 60+，其中 `details-row` 一个 renderer 承载 42 个。
5. 折叠状态设计成五段 key，与真源「Turn 级 `(turn, answerStep)` + 节点级 `useDisclosure`」两层模型冲突。
6. 目标链路只描述整树重绘，漏掉按 key 的增量可观察存储。

PR-02 状态：**部分实现**。

已实现（DSH `packages/client/ui-conversation/src/client/contract/records.ts` @ `2e39e70496aa02986ca6a820c5d497e816b69d7e`；本地 `dshIdeProtocol.ts` / `dshIdeConversation.ts`）：

- `subagent-catalog` 不是 `ChatNodeDataMap` 的 kind，已移出节点树，走 `subagentCatalog`。
- `subagent-settled` / `agent-message` 只在 `waking` 或空 content 的 `retry` 时投影为 `turn-trigger`，不保留私有 kind。
- `user` / `context` 携带官方 `source`；`context` 还带 `producer`（role + label）和 `form`。`callId` / `parentCallId` / `messageId` / `seq` / `turn` / `step` 已在对应节点上。

未实现：

- `steering` 已按 `inbox.ts` 的 `applySplice` 实现：`agent/inbox/spliced` 且 `target === 'next-step'`、`removedCount > 0` 且不是 `canceled` 时，被移出的 id 进入 `currentClaimed`；随后 `source.kind === 'user'` 且 id 在认领集里的 `user/message` 投影为 `steering`。`batchStart`（要 `followsProcessEvidence`）和 idle steer 仍未实现。
- `records.ts` 的节点身份是 `messageId` + `seq` + `turn`/`step` + `callId`。文档早先写的 `nodeId` / `turnId` / `groupId` 在这份真源接口里不存在，不加入协议。
PR-03 状态：**部分实现**（机制完整、12 个槽全部有生产消费点；`onDidChange` 已由输入区两个 dock 宿主消费，但聊天流本身仍不因槽位注册变化重画——ChatList 侧没有对应刷新入口，故不记 `已实现`）。

本地证据：`src/vs/workbench/contrib/dsh/browser/vscode/dshSlotRegistry.ts`、`dshSlotTypes.ts`、`dshChatSlots.ts`（12 个槽声明，消费点见 §17 清单）。DSH 语义来自 `packages/client/ui-slots` 的 `SlotCore` 与 `docs/subsystems/slots.md`（低 priority 先渲染；同 cell 同 priority 拒绝；hoc 精确 key 替换同 id 通配层）。`node --experimental-strip-types --import build/lib/test/strip-ts-resolver.mjs --test build/lib/test/dshSlotRegistry.test.ts` 13 项通过。9 个槽已有生产消费点（见 §17 清单），`onDidChange` 仍未驱动 ChatList，所以这一项在差异表里是 `部分实现`。

PR-04 状态：**部分实现**。

已实现：

- `dshConversationNodeTree.ts`：按 `kind + messageId` / `kind + callId` 索引；`source(key)` 身份稳定；`turnDataSource` 不通知其它 turn；`bottomSource`；`processSource`；`navigationItems`；`getTurn` / `getStep`；`snapshot()` 给出 order、nodes 副本、locations、navigation。没有 timeline / legacy。`subCalls` 记为子 key，不进顶层顺序。
- `DshChatSessionContent.nodeTree` 随 `session.nodes()` 更新。回复正文收成 `dshSlotHost`（见 PR-05）。

未实现：

- ~~协议里还没有 `assistant-step` / `turn-tail` / `turn-process` / `system-prompt` / `submitted-plan` / `workflow-run` 等官方 kind~~ **已补（2026-11-22）**：这些 kind 全部进了线协议（见 §7 的两张表）。仍缺 `turn-process` 的独立过程组 DOM 与 `snapshot` 的 timeline / legacy 两段。

`node --experimental-strip-types --import ./build/lib/test/strip-ts-resolver.mjs --test build/lib/test/dshConversationNodeTree.test.ts` 8 项通过。`parentCallId` 会把同级工具挂到已存在的父调用下，成环时后一个留在顶层。`dshProcessGroup.test.ts` 8 项通过。

PR-07 折叠：**部分实现**。

- `dshExpansionStateStore.ts`：Turn 键是 `(turn, answerStep)`，缺省展开。节点 disclosure 随 `resetTurn` 清掉。`DshChatSessionContent.expansion` 按会话持有。
- `dshProcessGroup.ts`：同一 turn 分成 prompt / process / answer。`turnProcessAlwaysOpen` 在没有结束原因、`open`、`aborted`、`interrupted`、`error` 时为真。没有显式原因时，出现 `turn-error` / `model-retry` / `turn-max-tokens`，或还没有 assistant，也保持展开。`hasInterleavedInput` 为真时也不收起。收起且允许折叠时，`visibleProcessKeys` 丢掉 process，`hiddenProcessLine` 在答复前写一行活动计数。`describeTurnProcess` 给出锚点、计数和呈现字段；`inlineReasoning` 固定 false。
- ~~`buildToolTree` 按 `parentKey` 组工具树~~ **已删除（2026-11-22）**：工具嵌套由 `dshConversationNodeTree` 按 `parentCallId` 处理，`buildToolTree` 是重复实现且零调用。
- `DshSlotHostContentPart` 画行前用这个结果滤掉被收起的过程节点，收起时优先用 `turn-process` 节点的计数画一行（`processLineFromSnapshot`），缺失才回退 `hiddenProcessLine`。没有单独的 `DshProcessGroupContentPart` DOM 类。

PR-08 工具视图：**部分实现**。`dshToolViewId` 把 wire 名分到 13 个家族。details 覆盖契约点名的 41 个记录型名字，再加上 `cordis_stop`、`cordis_undefine`、`timeline_tasks`，共 44。`adaptDshNode` 已按家族写不同的 `input`（bash 是命令，read 是路径，search 是 pattern 并附路径树，file-mutation 附 diff 路径，todo 附任务行）。还没有每个家族一份独立 DOM 部件。

`node --experimental-strip-types --test build/lib/test/dshExpansionAndToolView.test.ts` 3 项通过。

PR-05 状态：**部分实现**。

已实现：

- `IDshSlotHostContent`（`kind: 'dshSlotHost'`）进了 `IChatProgress` 和 history response 联合。`chatListRenderer.ts` 只对这个 kind 分支一次，不按 DSH 节点再加 `else if`。
- `DshChatSessionContent.historyFrom` 用 `applyDshSlotHost` 把一段回复里的 markdown / thinking / tool part 收成一个引用（`treeId`、`nodeIds`；`version` 已于 2026-11-22 删除，见下）。`command` / `info` / `warning` / `progressTaskSerialized` / `reference` 留在引用后面。`toHistory()` 本身不改，旧测试仍对它断言。
- `DshSlotHostContentPart` 按 nodeId 画行，子调用缩进，工具行带 `dshToolViewId`。树和折叠 store 经 `dshContentStore` 按会话取。`turn-error` 仍走原生 `errorDetails`，不进 nodeIds。

未实现：

- ~~`hasSameContent` 比的是整段引用；流式更新靠树的 `onDidChange` 重画这一段~~ **已改（2026-11-22）**：`dshSlotHostSame` 只比 `treeId` + `nodeIds`（不再比整棵树的 `version`），`DshSlotHostContentPart` 对 `nodeIds` 每个成员 `source(key).subscribe(...)`，任意节点变化不再重画所有 response。
- 真机看面板 PENDING。

`renderDshAdaptedPart` 已把 task、tree、绝对路径 diff、reference、文件卡和交付物交给对应的原生构造。相对路径 diff 仍是文本回退。

`node --experimental-strip-types --import ./build/lib/test/strip-ts-resolver.mjs --test build/lib/test/dshSlotHostModel.test.ts` 5 项通过。

PR-06 状态：**部分实现**。

`dshNativePartAdapters.ts` 的 `adaptDshNode`：

- 助手 `text` → `markdownContent`，复用 `ChatMarkdownContentPart`。
- 助手 `reasoning` → `thinking`，复用 `ChatThinkingContentPart`。
- 工具 → `toolInvocationSerialized`，复用 `ChatToolInvocationPart`，input 按 view 家族分。
- `todo_write` 另给 `progressTaskSerialized`（`ChatTaskContentPart`）。
- 搜索命中另给 `treeData`（`ChatTreeContentPart`）。
- 文件改写另给 `multiDiffData` 路径（`ChatMultiDiffContentPart`）。
- 文件块 → `reference`。
- `turn-error` / `model-retry` / `turn-max-tokens` → `warning`（`ChatErrorContentPart`）；`code` 为 `QUOTA` / `ACCOUNT_QUOTA` 时 → `errorDetails.isQuotaExceeded`（`ChatQuotaExceededPart`）。

`chatListRenderer.renderDshAdaptedPart` 把 markdown、thinking、tool、warning、quota、task、tree、diff、reference、文件卡、交付物交给对应原生构造。task 用 `ChatTaskContentPart`，搜索命中用 `ChatTreeContentPart`，绝对路径 diff 用 `ChatMultiDiffContentPart`，文件名和交付物用 `ChatUsedReferencesListContentPart`。相对路径 diff 仍回退成文本，避免编出残缺 file URI。真机 PENDING。

`node --experimental-strip-types --import ./build/lib/test/strip-ts-resolver.mjs --test build/lib/test/dshNativePartAdapters.test.ts` 24 项通过（当前计数，随新增卡更新）。

PR-09 状态：**部分实现**。

`adaptDshNode` 现在产出这些卡，槽位回退按卡的字段画，不再写 `Image:` / `File:`：

- 图片 → `dshImageGallery`（attachmentId、mediaType、宽高、名字）。自研，因为原生没有 DSH 画廊。
- 文件块 → `dshFileCard`（名字、attachmentId、字节数）。
- `turn-tail.files` → `dshDeliverables`。快照级交付物仍同时留着 history 里的原生 `reference`，绝对路径可以打开。
- `turn-tail` 的 `tokenUsage` → `dshUsage`（input / output / total / cache / reasoning）；助手行不再重复用量。
- `exit_plan_mode` 的计划节点 → `dshSubmittedPlan`，槽位把它收到 turn tail 渲染。

还没有独立的 `DshImageGalleryContentPart` 文件，也没有点击后走原生编辑器的接线。真机 PENDING。

PR-11 状态：**部分实现**。

- `compaction` → `dshCompaction`（summary、shadowedItemCount、shadowedTokenCount），不再是 `> Context compacted`。
- `manual-compaction` → 命令行 + 压缩卡合成一个节点（`outcome.sourceEventSeq` 配对），不再两块重复。
- `command` → `dshCommand`（commandId、name、args、outcome）。
- `command-input` → `dshCommandInput`（`/goal` 人工输入单独成行）。
- `system-prompt` → `dshSystemPrompt`（每次非空 append 一张卡，文本变化标 `update`）。
- `question-reply` → `dshQuestionReply`（按题面回显已作答的答案）。
- `workflow-run` → `dshWorkflowRun`（阶段与成员状态；Turn 中断转 `interrupted`）。
- `turn-tail` → `dshTurnTail`（closing / branchUnavailable / tokenUsage）。
- `turn-process` → 收起时优先用它的计数画行，节点本身不单独成行。
- 回合错误仍走 PR-06 的 warning / quota。

`toHistory()` 里的引用块还在，给旧测试用。面板回复正文走 slot host，这些节点由 `adaptDshNode` 画。真机 PENDING。

PR-10 状态：**部分实现**。

`dshPendingSettlement.ts`：

- `settleQuestion` 要求每题恰好出现一次。未知 id、重复 id、未知选项、单选多选都返回空。空 `selected` 只有草稿显式标了 `skipped` 才允许；它会变成线协议的 `{ id, selected: [] }`。多选可以只靠非空 custom（官方 QuestionComposer 行为）。
- `settleApproval` 只接受 approve / reject，reason 去掉空白。`always` 不是线协议 decision。
- **已删除（2026-11-22）**：`settleApprovalIntent` 与 `settlePlan` 在 `src/` 里**零调用**，只有测试引用它们，属于死代码。计划题的 accept / reject 实际由 `settleQuestion` 直接完成（计划题的选项就是 approve / reject 标签），discuss 由 `DshChatSession.discussQuestion` → `cancelRequest` 完成——两者都不经过 `settlePlan`。`DshPlanSettlement` 类型一并删除。
- `DshChatSession.submitQuestionDraft` 走 `settleQuestion` 再调 `answerQuestion`。在途 token 互斥；成功或 Host 终态才 `rememberSettled` 并移除卡片；瞬时失败保留草稿。`answerApproval` 可以带 reason。问卷投影保留 `intent`。
- `answerQuestion(eventId, label)` 旧入口只负责把一次点击变成草稿，然后委托 `submitQuestionDraft`。它不再单独发送，因此不会和原生表单并发提交同一个请求。
- 协议校验允许 `selected: []` 且无 `custom`（官方 `AskUserQuestionAnswerItem` 的 skip 语义）；整份题目覆盖和选项归属由 `settleQuestion` 校验。

原生问卷入口：`dshQuestionCarouselAdapter.ts` 把 `DshIdeQuestionItemView` 映成原生 `IChatQuestion`（选项值保留原始标签），提交用 `fromDshCarouselAnswers` 生成整份草稿。`DshQuestionCarouselController` 按 eventId 持有 `ChatQuestionCarouselData`，同结构帧不重建；`DshQuestionCarouselContentPart` 复用原生 `ChatQuestionCarouselPart`，提交回调走 DSH `answerQuestion`，不调用 `ChatService.sendRequest`。`dshSlotHost` 带 `questionIds` / `questionSignature`，题目内容改变也会重画。

已修：讨论不再只返回 `{ action: 'discuss' }`。`dsh.discussQuestion` 走 `cancelRequest` 由 Host 结算；只有在途 token 释放、成功才移除卡片。草稿恢复仍由输入框自行保留，没有协议方法把「已讨论」写回草稿。

真机 PENDING。

`dshPendingSettlement.test.ts` 6 项、`dshQuestionCarousel.test.ts` 6 项、`dshQuestionSession.test.ts` 5 项通过（含真实 `DshChatSession` 的一次 RPC、在途互斥、终态不复活、非法草稿不发、discuss 结算）。

PR-12 状态：**部分实现**。

- 用户气泡不再拼 `File:` / `Image:`。附件只留名字或 id，图片 URI 仍挂在该回合的 `reference` 上。文件不编 `dsh-attachment` URI。
- 带图片或文件的用户节点进入该段 `dshSlotHost` 的 nodeIds，由 `dshImageGallery` / `dshFileCard` 画。纯文本用户不重复进回复。
- `toHistory()` 不再为 command、compaction、model-retry、turn-max-tokens、inherited-history、context 正文推 markdown 引用块。context 只保留图片 reference。这些节点由 slot host 的结构化卡画。触发器行不再带 `>`。`adaptDshNode` 对 `turn-trigger` 产出 `dshTurnTrigger`（按 `source.kind` 取标题，未知 source 只留正文）。`steering` 只留正文，不加 `**Steering:**`。`toHistory()` 里的触发器标签仍走 `localize`，但默认文案没有引用前缀。

`build/lib/test/dshChatHistoryNative.test.ts` 的三条附件断言已改成无前缀。`dshSlotHostModel.test.ts` 增加「用户附件进本组」。

PR-13 状态：**部分实现**。

2026-11-22 重新用官方转译 `node build/next/index.ts transpile --out out` 生成 ESM 产物后跑的门禁。

协议校验单测 52 项通过：新增的 `question-reply`、`command-input`、`submitted-plan`、`workflow-run`、`system-prompt`、`turn-tail`、`manual-compaction` 都有「合法通过、坏数据拒绝」的用例。投影与内容层合计 166 项通过（`dshIdeConversation` 30、`dshIdeProtocol` 52、`dshChatSessionContent`/`dshChatHistoryNative`/`dshQuestionSession`/`dshQuestionCarousel` 55、`dshNativePartAdapters`/`dshSlotHostModel` 29）。

```text
node --experimental-strip-types --test build/lib/test/dshIdeProtocol.test.ts
```

**全量 `dsh*.test.ts` 不能用一条裸命令当门禁。** 直接 `node --experimental-strip-types --test $(ls build/lib/test/dsh*.test.ts)` 会在两类文件上失败，都与内容层改动无关：

- 需要 strip-ts 解析器的文件（`dshNativePartAdapters`、`dshSlotHostModel` 等）——裸跑缺少 `strip-ts-resolver.mjs`，`.js` 说明符解析不到 `src` 同名 `.ts`。
- 依赖根 `package.json` 的测试（native 模块声明、NOTICE 追加、`test-dsh:all` 注册）——当前根清单是 `@deepseek-ai/dsh-desktop-runtime`，没有 `scripts`/`dependencies`。

**已确认的既有失败（与内容层无关，状态 FAIL）**：

- `dshIdeChannel.test.ts`「view service emits starting first and reuses channelId on repeated open」：测试仍连旧的 `dshIdeChannel` 路径；视图服务现在在 `src/vs/platform/dshClient/ide/`。
- `dshIdeEndpoints.test.ts`「D27 CI aggregate entry exists…」与「every project dsh test file is registered in test-dsh:all」：要求根 `package.json` 的 `test-dsh:all` 脚本。

因此下面按「定向套件」记录，这才是可复现的门禁。两组合计 **348 项全通过**（2026-11-22 实测，含本轮新增的计划卡归尾部、turn-process 计数行、用量归尾部、discuss 结算）。

内容层（需 `strip-ts-resolver` 的 59 项）：

```text
node --experimental-strip-types --import ./build/lib/test/strip-ts-resolver.mjs --test build/lib/test/dshSlotRegistry.test.ts build/lib/test/dshConversationNodeTree.test.ts build/lib/test/dshExpansionAndToolView.test.ts build/lib/test/dshSlotHostModel.test.ts build/lib/test/dshNativePartAdapters.test.ts build/lib/test/dshQuestionCarousel.test.ts
```

会话、history、协议与纯单测（289 项）：

```text
node --experimental-strip-types --test --test-force-exit build/lib/test/dshChatSessionExtras.test.ts build/lib/test/dshChatHistoryNative.test.ts build/lib/test/dshChatSessionContent.test.ts build/lib/test/dshChatModel.test.ts build/lib/test/dshQuestionSession.test.ts build/lib/test/dshComposerOptions.test.ts build/lib/test/dshIdeConversation.test.ts build/lib/test/dshIdeProtocol.test.ts build/lib/test/dshPendingSettlement.test.ts build/lib/test/dshProcessGroup.test.ts build/lib/test/dshQuotaNotice.test.ts build/lib/test/dshIdeConsumer.test.ts build/lib/test/dshIdeValidationBehavior.test.ts build/lib/test/dshIdeProjections.test.ts build/lib/test/dshIdeWaterfallNotice.test.ts build/lib/test/dshChatSubmitRouting.test.ts build/lib/test/dshAttachmentFileSystem.test.ts
```

DoD 追加：问卷与讨论动作新增的 NLS 键已补进 `dsh.nls.json`、`dsh.nls.zh-cn.json` 与 `dsh.nls.modules.json`；`dshComposerOptions.test.ts` 的中英词典审计通过。

`tsc --noEmit` PASS（TypeScript 原生检查器）：

```text
node node_modules/@typescript/native/bin/tsc -p src/tsconfig.json --noEmit --pretty false --incremental false
```

修过的类型错误：`dshSlotHostContentPart.ts` 的 `base` 导入多了一层；配额部件只在回复视图上构造，请求视图改走 `ChatErrorContentPart`。

不要手改 `out/**`：官方转译输出 ESM，并会清空整个 `out`。旧记录里「out 是 CJS、要加 out/package.json」的说法已作废。

未跑，保持 PENDING：

- 真机验收清单

`steering` 的 history 文案改成只保留正文，键 `dsh.history.steering` 还在。

## 17.5 文档更新纪律

改代码必须同步改文档，顺序固定：

1. 线协议（`dshIdeProtocol.ts`）先定节点/字段的形状与校验；
2. 投影（`dshIdeConversation.ts`）写事件来源与判据，并在注释里点名对照的官方 Definition；
3. 客户端（`dshChatModel.ts` / `dshNativePartAdapters.ts` / 槽位）接上渲染；
4. 本文件 §7 与 **附录 A**（原差异表）第 2/3/4/7 节改状态；
5. 新增用户可见字符串必须同时进 `dsh.nls.json`、`dsh.nls.zh-cn.json`、`dsh.nls.modules.json`（`dshComposerOptions.test.ts` 会拒未登记的键）；
6. 测试计数只写实跑结果，且要写明命令；未跑的门禁写 PENDING，不许写成通过。

状态只使用 `已实现` / `部分实现` / `未实现` / `PENDING`。文档里出现「已知差异」时，必须写清差异具体在哪一层（数据、判据、还是渲染位置），不能只写「还不完全一致」。

## 18. 正常显示所有内容：专项验收索引

本节不重复第 13 节的 PR 计划。第 13 节的 `PR-01`–`PR-13` 是唯一实施计划；本节只给出“正常显示所有内容”的验收索引与目标定义。

目标：**chat 面板能正常显示 DSH 会话中出现的所有内容**。  
“正常显示”的定义是：

1. 内容出现在 DSH 真源规定的层：chat 节点树、session projection、turn tail、tool view、pending 或 input dock。
2. 内容使用 DSH 真源规定的身份：`nodeId`、`turnId`、`step`、`seq`、`callId`、`eventId`、`source`、`form`、`producer`、`version`。
3. 内容按 VS Code 原生优先的策略渲染：能复用则复用，能改造则改造，确需自研时原生化。
4. 不再用 `info` / `warning` / `markdownContent` / `File: xxx` / `Image: xxx` 作为最终完成态。
5. 快照刷新、流式追加、虚拟化重绘、会话切换后内容仍稳定。

### 18.1 内容分层清单

#### A. 必须进入 chat 节点树的内容

以下必须成为 `DshConversationNodeTree` 中的正式节点，并由 `conversation.chat.node` keyed renderer 渲染：

- `user`
- `steering`
- `context`
- `turn-trigger`
- `assistant`（Chat 层的 `assistant-step` 是它的同义行）
- `tool-call`
- `command`
- `compaction`（Chat 层的 `manual-compaction` 是命令行 + 压缩卡）
- `model-retry`
- `turn-error`
- `turn-max-tokens`
- `inherited-history`
- `unknown`

Chat 层目标 kind，主机投影到位前不进入节点树：

- `assistant-step`
- `turn-tail`
- `turn-process`
- `system-prompt`
- `manual-compaction`
- `question-reply`（已进线协议）
- `command-input`（已进线协议）
- `submitted-plan`（已进线协议，flow 内可见）
- `workflow-run`（已进线协议）

`AssistantBlock` 的 `text / reasoning / tool-call / image` 作为 `assistant` 的子块投影，不独立成为顶层 node kind。

#### B. 不进入 chat 节点树的内容

以下内容必须从 chat 节点树中移出，走 session projection 或 input dock：

| 内容 | 正确层 |
|---|---|
| `subagentCatalog` | `DshIdeConversationView.subagentCatalog` / session projection |
| `context(form='catalog')` 中的技能目录 | skill/projection，非正文 |
| goal / plan / todo / team / worktree 当前状态 | session projection / turn tail / dock |
| usage 数值 | `turn-tail.tokenUsage` 内部组件，不单开 slot |
| token usage 明细 | turn tail 内部 `TurnUsagePanel` 等价组件 |
| queue | `conversation.input.dock`，不是 chat 正文 |

#### C. 工具内容

工具内容必须进入 `tool-call` 节点，并按 `tool.call.toolview` keyed renderer 渲染。  
不允许所有工具都只显示通用 `simpleToolInvocation(input, output)`。

需要正常显示的 tool view 家族：

- `bash`
- `read`
- `read_image`
- `apply_patch` / `edit` / `write`
- `grep` / `glob`
- `web_search` / `web_fetch`
- `todo_write`
- `ask_user_question`
- `office_render` / `office_convert` / `office_recalculate`
- `skill`
- `present`
- `detailsToolView` 覆盖的记录型工具（42 个 key）
- `timeline_tasks`
- `cordis_stop` / `cordis_undefine`
- `genericToolView` 兜底

### 18.2 显示优先级

按“用户是否能看到完整会话”排序：

1. 基础正文：user / assistant / reasoning / image / file / reference。
2. 注入内容：context / system-prompt / turn-trigger / steering。
3. 工具内容：tool-call 树 + keyed tool views。
4. 控制/状态节点：command / compaction / model-retry / turn-error / turn-max-tokens / inherited / unknown。
5. Turn 结构：turn-process / turn-tail / usage / assistant actions。
6. Session projection：subagentCatalog / skills / goal / plan / todo / team / worktree。
7. 待处理交互：approval / question / plan review / question reply。
8. 工作流与交付物：workflow-run / deliverables / changed files / presented files。
9. 输入 dock：queue / 输入区状态。
10. 旧路径清理：删除所有文本模拟。

### 18.3 计划映射

第 18 节不新增实施阶段；所有工作按第 13 节 PR 执行。对应关系如下：

| 第 13 节 PR | 覆盖的“正常显示”工作 |
|---|---|
| PR-01 | 冻结 DSH slot/node/tool/pending 真源 |
| PR-02 | 补 node 身份、form/source、toolKey、full pending、usage、deliverables、subagentCatalog 投影字段 |
| PR-03 | 实现五基数、三作用域的完整 slot 机制 |
| PR-04 | `DshChatProjector` / `DshConversationNodeTree`，官方 21 kind 全部投影，form/source 分派，私有 kind 退场 |
| PR-05 | `dshSlotHost` 与 renderer 扩展点 |
| PR-06 | markdown / thinking / tool / task / reference / error / quota / diff / tree 的原生 adapter |
| PR-07 | process group、tool tree、两层折叠、composite part 基础 |
| PR-08 | 60+ tool key 的 keyed tool views，`detailsToolView` 覆盖 42 个记录型 key |
| PR-09 | 图片、文件、交付物、changed files、usage、turn tail |
| PR-10 | approval/question/plan/question reply 完整交互与结算 |
| PR-11 | system prompt、context、turn trigger、command、compaction、retry、max tokens、inherited、unknown 专用卡 |
| PR-12 | 删除所有 `info` / `warning` / `markdownContent` / `File: xxx` / `Image: xxx` 文本模拟 |
| PR-13 | 门禁、文档、真机截图复核 |

### 18.4 显示清单验收矩阵

| 内容 | 完成标准 |
|---|---|
| user | 文本 + 附件/引用按节点渲染 |
| assistant text | markdown 正常显示 |
| reasoning | 可折叠 thinking |
| image | 内联/画廊，不是文本标签 |
| file | 文件卡，不是 `File: xxx` |
| context | 按 form 专用渲染，默认折叠 |
| system prompt | 折叠行，不裸贴 |
| turn-trigger | 图标 + 标题 + 可展开 |
| steering | 专用行 |
| tool-call | keyed tool view + 工具树 |
| command | command row |
| compaction | 可展开摘要卡 |
| model-retry | 重试链卡 |
| turn-error | 原生错误卡 |
| max tokens | 上限卡 |
| turn-tail | 可见且含 usage |
| turn-process | 可折叠 |
| inherited history | 分隔线 |
| unknown | 兜底卡，不静默丢弃 |
| submitted plan | 计划卡 |
| command input | 命令输入卡 |
| question reply | 已回答气泡 |
| workflow run | 工作流卡 |
| approval | 完整审批卡 |
| question | 多题/多选/custom 一次提交 |
| plan review | 完整正文 + accept/reject/discuss |
| deliverables | turn tail 交付物区 |
| changed files | diff/open |
| usage | turn tail 内 usage |
| subagentCatalog | session projection，不进 chat tree |
| skills/goal/todo/team/worktree | 正确 projection/dock/tail，不裸贴正文 |
| queue | input dock |
| truncation | 专用状态行，不伪装 response |

### 18.5 完成定义

“能正常显示所有内容”仅在以下条件全部满足时成立：

1. 第 18.4 节矩阵全部通过。
2. 21 个官方 chat node kind 均有 renderer 或明确 generic fallback。
3. 60+ tool key 均有 keyed renderer 或 generic fallback。
4. `subagentCatalog` 不在 chat tree 中。
5. 截图中所有 context/system-reminder/skill catalog 文本不再裸贴。
6. 旧 `dshChatHistory.ts` 只保留兼容序列化职责，不再产生任何结构化卡片的文本替身。
7. 真机截图复核由用户确认。

## 19. 运行时稳定性专项：频繁重建与高频滚动

本节记录 2026-11-22 对“会话运行中 chat 内容快速滚动、无法正常阅读”的专项分析与修复计划。  
本节不新增与第二套并行路线，所有修复仍归属第 13 节 PR：主要是 `PR-04`、`PR-05`、`PR-07`、`PR-12`，并新增一个运行稳定性验收门禁。

### 19.1 双证据基线与问题定义

#### DSH 真源证据

- 在线核对 DSH HEAD `2e39e70496aa02986ca6a820c5d497e816b69d7e` 的 `packages/client/ui-chat/src/client/contract/snapshot.ts`。
- DSH 的聊天快照体系是按 key 的 observable store：`get` / `source` / `bottomSource` / `turnDataSource` / `processSource`。
- DSH 更新语义是局部 patch、按 id 更新、按 slice 通知，不是全局 treeVersion 广播。

#### DSH-IDE 本地证据

- `src/vs/workbench/contrib/chat/browser/widget/chatListWidget.ts`
  - `scrollToEnd()` / `revealLastItem()`：1263-1282
  - `_withPersistedAutoScroll()`：1299-1307
  - `_updateElementHeight()`：1088-1112
- `src/vs/workbench/contrib/dsh/browser/vscode/dshChatSessionContent.ts`
  - 多事件经 `queueMicrotask` 合并，但每次仍执行 `toHistory()` 全量重建。
- `src/vs/workbench/contrib/dsh/browser/vscode/dshConversationNodeTree.ts`
  - `accept()`：106-157
  - 任意节点变化触发全局 `treeVersion++`：151-155
  - `sameNode()` 用 `JSON.stringify`：520-522
- `src/vs/workbench/contrib/dsh/browser/vscode/dshSlotHostModel.ts`
  - `dshSlotHostRef()`：92-94
  - `dshSlotHostSame()` 把 `version` 作为相等条件：96-107
  - `applyDshSlotHost()` 把当前全局 tree version 写到每个 response：113-128
- `src/vs/workbench/contrib/dsh/browser/vscode/dshSlotHostContentPart.ts`
  - 订阅全局 `tree.onDidChange` / `expansion.onDidChange`：44-48
  - `render()` 执行 `refs.clear()` + `body.replaceChildren()` 全块重建：55-58
  - 每次 render 末尾 `_onDidChangeHeight.fire()`：130

#### 问题定义

DSH-IDE 当前把上游高频增量流实现成了：

```text
高频 DSH 帧
  -> 全量 toHistory / 全局 treeVersion
  -> 所有历史 response 的 dshSlotHost.version 改变
  -> DshSlotHostContentPart 全块 replaceChildren
  -> onDidChangeHeight 高频触发
  -> 原生 ChatListWidget 自动跟随到底
  -> 用户看到快速滚动，无法阅读
```

这不是 VS Code 原生滚动组件错误，而是 DSH-IDE 投影与渲染层制造了过多高度变化。

### 19.2 根因分层

| 层 | 根因 | 影响 |
|---|---|---|
| 事件合并 | `queueMicrotask` 只合并次数，不缩小范围 | 一帧一次，但仍全量 rebuild |
| fingerprint | `historyFingerprint` 太粗，pending 一变即全量，数组内容变化只看长度 | 有时漏更新，有时过度更新 |
| node tree | 全局 `treeVersion++` | 一个节点变化让所有历史 host 变旧 |
| sameNode | `JSON.stringify` 全字段比较 | raw/metadata/字段顺序变化都被当成显示变化 |
| slot host | 订阅全局 tree change 且整块 `replaceChildren` | 稳定历史也重建并重测高度 |
| identity | request/response 没有稳定 id，未启用 preserve identity | restorer 更容易 remove/add |
| 原生滚动 | 在底部时高度变化即 revealLastItem | 把上游高度抖动转成滚动条跳动 |

### 19.3 修复计划

> **2026-11-23 落地状态（CHK-320/321/322/324/327/334）**：S0（局部 revision）、S1（display signature）、S2（slot host 行级增量渲染）、S3（稳定 request 身份）、S4（fingerprint 精确化）、S5（自动滚动 hold）、S6（按 key observable store 的消费面）已实现并有单测。S0 的落地方式：`DshConversationNodeTree.revisionOf(nodeId)` 取该 key 自己的 `source().version`，`revisionFor(nodeIds)` 按成员顺序拼稳定串，`dshSlotHostRef` 带上 `revision`、`dshSlotHostSame` 在双方都有时比较它；整棵树的 `treeVersion` 只留作 diagnostics。S5 的落地方式：`dshScrollFollow.ts` 是纯状态机（following / reading），`dshChatAutoScrollHold.ts` 在阅读锁期间持有原生 `IChatWidget.holdAutoScroll()`（= `ChatListWidget.acquireAutoScrollHold()` 的引用计数暂停），发送与「回到底部」是两条显式出口；不改上游文件。下面各小节保留原始计划原文，不再逐段改写成完成报告。

#### S0：局部 revision 替代全局 treeVersion

归属：`PR-05`

目标：让每个 `dshSlotHost` 只关心自己 `nodeIds` 对应的内容。

必须做：

1. `dshSlotHostRef` 增加 `revision`，不再直接使用全局 `treeVersion` 作为所有 response 的相等条件。
2. `DshConversationNodeTree` 提供：
   - `revisionOf(nodeId)`
   - `revisionFor(nodeIds)`
   - `source(nodeId)` 的真实按 key 通知。
3. `dshSlotHostSame()` 比较：
   - treeId；
   - nodeIds；
   - local revision；
   - questionIds / questionSignature。
4. 全局 `treeVersion` 保留作 diagnostics，不再进入 history equality。

验收：

- 修改第 N 轮节点，只第 N 轮 `dshSlotHost` revision 变化；
- 第 1–N-1 轮 `hasSameContent()` 返回 true；
- 单测覆盖“其它 turn 变化不影响旧 host”。

#### S1：display signature 替代 JSON.stringify

归属：`PR-04`

目标：只把会影响界面的字段变化计入 rebuild。

必须做：

1. 给 `DshConversationNodeTree.sameNode()` 增加按 kind 的 display signature。
2. 忽略不参与显示的内部字段：
   - `raw`
   - `providerMetadata`
   - 不影响渲染的 usage 细节
   - 字段顺序差异
3. 参与显示的最小集合：
   - kind；
   - seq / turn / step；
   - status；
   - text / title / name；
   - toolName / callId / input / output / error；
   - context form / producer / source；
   - approval / question / plan 必要字段；
   - media attachment identity。
4. 每个节点保存 `displayRevision`。

验收：

- providerMetadata 变化不触发 node change；
- 文本/tool/output/status 变化触发 node change；
- 旧节点 displayRevision 稳定。

#### S2：DshSlotHostContentPart 改增量渲染

归属：`PR-07`

目标：不再任何 tree change 都整块清 DOM。

必须做：

1. 不再订阅全局 `tree.onDidChange` 触发整块 `render()`。
2. 按 nodeId 维持 row 映射：
   - `Map<nodeId, { revision, part, domNode }>`。
3. 只处理：
   - 新增 nodeId → append；
   - 删除 nodeId → dispose + remove；
   - revision 变化 → 替换该 row；
   - 顺序变化 → DOM move，不重建。
4. 只有真实 DOM 高度变化时 fire `_onDidChangeHeight`。
5. expansion 变化只影响对应 turn 的 rows。

验收：

- 同一 host 内 1 个节点变化，只替换 1 行；
- 没有可见变化时 height event 计数为 0；
- 折叠状态变化不重建无关行。

#### S3：稳定 request/response identity

归属：`PR-04` / `PR-05`

目标：让 native restorer 原地更新，而不是 remove/add。

必须做：

1. `toHistory()` 生成的 request 使用稳定 id：
   - 优先 DSH `messageId`；
   - 无 messageId 时用 `turn + seq` 的稳定派生 id。
2. response 使用稳定 `turnId`。
3. 让 DSH content provider 启用 native 的 preserve identity 语义；若原生字段不够，则扩展内部 serialized identity。
4. 禁止用时间戳参与 identity。

验收：

- 同一 turn 多次刷新保持同一个 response id；
- restorer 不再 remove/add 当前 turn；
- list refresh 次数下降。

#### S4：fingerprint 精确化

归属：`PR-04`

目标：history 重建只在真正需要时发生。

必须做：

1. 不再用 `节点数 + 首尾 seq + pending JSON + 粗略 extras 摘要` 作为唯一指纹。
2. history fingerprint 应基于：
   - 节点 display revision 列表；
   - pending eventId + settlement signature；
   - extras 的 display signature，而不是数组长度。
3. 同一帧内 microtask 合并保留。

验收：

- extras 内容变化但数量不变时 history 能更新；
- 无关字段变化不触发 history 重建；
- pending JSON 字段顺序变化不误触发。

#### S5：自动滚动 hold 与运行态策略

归属：`PR-05`

目标：减少“用户正在阅读时被拖走”。

必须做：

1. 对 DSH 流式更新，使用 `acquireAutoScrollHold()` 区分：
   - 用户主动发送后的短暂跟随；
   - 用户手动上滚后的阅读锁定。
2. 当用户不在底部时，不因 DSH 内部节点高度变化强制 revealLastItem。
3. 保留“回到底部”按钮作为显式恢复方式。

验收：

- 用户上滚后，流式高度变化不把视口拉回底部；
- 新用户消息发送后可恢复一次跟随；
- 点回到底部后恢复自动跟随。

**落地（2026-11-23，CHK-327）**：`dshScrollFollow.ts` 是纯状态机（`following` / `reading`），
`dshChatAutoScrollHold.ts` 在 `reading` 期间持有原生 `IChatWidget.holdAutoScroll()`
（即 `ChatListWidget.acquireAutoScrollHold()` 的引用计数暂停），在 `onDidAcceptInput`
与「滚动回到底部」两个出口释放。**不改上游 `ChatListWidget` / `chatWidget`**。
三条验收各有单测（`dshScrollFollow.test.ts` 5 项）。**一处与原始计划的偏差**：计划写的是
「当用户不在底部时，不因 DSH 内部节点高度变化强制 revealLastItem」——本仓没有自己的
reveal 调用点，`revealLastItem` 完全由原生在 `_withPersistedAutoScroll` 里做，因此实现手段是
**让原生 `isAutoScrollHeld` 为真**，而不是去改 DSH 的渲染代码。真机 PENDING。

#### S6：按 key observable store

归属：`PR-04` / `PR-07`

目标：对齐 DSH 真源。

必须做：

1. `DshConversationNodeTree.source(nodeId)`
2. `turnDataSource(turnId)`
3. `processSource(nodeId / turnId)`
4. `bottomSource`
5. slot host 按自己 nodeIds 订阅 source，而不是全局 tree change。

验收：

- 一个 turn 更新不影响其它 turn 的订阅计数；
- 无订阅的旧节点不计算 display signature；
- 虚拟化重绘只读取当前可见 key。

**落地（2026-11-23，CHK-334）**：五项能力（`source` / `turnDataSource` / `processSource` / `bottomSource`
+ slot host 按 nodeIds 订阅）此前**代码都在、但 `turnDataSource` / `processSource` / `bottomSource`
零生产消费点**，属「有实现没接线」的死代码。本轮补上两处真实消费面，都落在
`DshSlotHostContentPart`：
1. **`processSource`**：构造时对本段涉及的每个 Turn 订阅 `processSource(anchor)`。
   过程分组（`groupTurnProcesses`）会读同一 Turn 内**不在本段 `nodeIds` 里**的节点
   （已收起的过程行、`turn-process` 计数行）；只订阅 `source(nodeId)` 时这些变化不触发重画，
   计数行会停在旧值。`processSource` 恰好是「该 Turn 全部节点」的按 Turn 观察点，
   别的 Turn 变化不通知这里（对应验收第一条）。
2. **`turnDataSource`**：`collectRows` 取过程计数行改用
   `turnDataSource(turn, 'turn-process')`，不再在 `grouped`（只有本段 nodeIds）里找。
   旧写法在「计数行不在本段引用里」时会**静默退化成现算**，页面上的「N 个工具」与
   Host 给的权威计数不一致。
辅助判定抽成纯函数 `turnProcessCounts(rows)`（放在 `dshSlotHostModel.ts`，因为槽位渲染
在 DOM 里跑、`node --test` 起不来），并有单测 + 变异验证（把 `subagentCount`/`messageCount`
置 0 → 测试 fail 1；恢复后 23/23 绿）。
**`bottomSource` 仍是契约保留项、没有生产消费点**：官方语义是「该可见节点是否属于
最新已加载 exchange」，与本仓渲染层已有的 `isAtBottom`（滚动位置在底部）**不是同一件事**，
强行拼用会引入判据混淆；如实标注而不是为了「消掉死代码」而错接。
真机 PENDING。

### 19.4 测试与度量

必须新增：

| 测试 | 断言 |
|---|---|
| local revision test | 其它 turn 变化不改变旧 host revision |
| display signature test | raw/metadata 变化不触发 node change |
| incremental render test | 单节点变化只替换 1 个 row |
| height event test | 无可见变化时不 fire height |
| stable identity test | 同一 turn 多次 refresh 的 id 不变 |
| fingerprint test | extras 内容变化但数量不变能触发 history |
| auto scroll hold test | 用户上滚后内部高度变化不 revealLastItem |
| observable source test | turn A 变化不通知 turn B |

运行时度量：

- 每帧 `toHistory()` 调用次数；
- 每帧 `onDidChangeHeight` 次数；
- 每帧 `replaceChildren` 次数；
- `hasSameContent()` 为 false 的历史 response 数；
- 用户上滚后被强制 revealLastItem 的次数。

### 19.5 完成定义

运行时稳定性问题只有在以下条件全部满足时才算解决：

1. 单个节点变化不再导致所有历史 response 判为不同。
2. `DshSlotHostContentPart` 不再对任何 tree change 全块 `replaceChildren`。
3. 无可见变化时不触发 `onDidChangeHeight`。
4. 同一 turn 多次刷新保持稳定 native identity。
5. 用户上滚阅读时，内部流式高度变化不强制拉回底部。
6. 真机会话运行 5 分钟，用户能稳定阅读任意历史段落，无快速滚动。
7. 度量项中有明确的前后对比，未测项标 `PENDING`。

### 19.6 与第 13 节 PR 的关系

| 第 13 节 PR | 纳入本专项的工作 |
|---|---|
| PR-04 | display signature、fingerprint、stable identity、按 key source |
| PR-05 | 局部 revision、auto scroll hold、renderer 扩展点 |
| PR-07 | DshSlotHostContentPart 增量渲染、折叠增量 |
| PR-12 | 清理会造成频繁高度变化的文本模拟 |
| PR-13 | 运行时度量、真机验收、文档回写 |

本专项不产生独立 PR 序列，避免与第 13 节形成第二套计划。

## 20. 每轮适配性检查与优化机会评估

目标：DSH-IDE 必须持续适配 DSH 与 VS Code 上游变化，不能依赖一次性快照。DSH 可能出现破坏性更新；VS Code 多数是小更新，但 Chat / editor input / theme / a11y 的小变化也可能影响本仓。

同时，上游更新也可能让当前 DSH-IDE 中的自研补丁、文本模拟、兼容层、降级实现获得更优替代。每一轮检查必须同时评估两类结果：

1. **风险**：破坏性更新、字段变化、事件变化、API 退化；
2. **优化机会**：官方能力已经出现，可以替换当前本地实现，使内容更正确、更原生、更稳定、更少自研。

不能只检查“会不会坏”，也必须检查“有没有新的官方做法让当前实现更优”。

### 20.1 强制检查时机

每一轮开发、评审、PR 计划更新、契约修改、门禁调整开始前，必须先完成在线只读检查：

1. DSH：
   - 在线 GitHub 最新提交、Release/CHANGELOG、最近 commit 差异；
   - 重点检查协议、事件名、session API、composer、attachment、context/form/producer、pending、approval/question/plan、slot/node/tool view、turn/process/tail、model catalog、usage、quota、deliverables。
2. VS Code：
   - 在线更新日志/Release Notes、Chat/editor input/theme/a11y/scroll/tree renderer 相关变更；
   - 本项目 `src/**` 是 VS Code 工作副本，可直接读本地源码，但“最新更新日志”必须在线核对。
3. 已安装 DSH 的 `resources/app.asar` 只能作为只读参考，不替代在线最新源码。

### 20.2 检查输出

每轮必须记录：

| 项 | 内容 |
|---|---|
| 检查日期 | 本地日期 |
| DSH 来源 | GitHub URL、HEAD/commit 或 release tag |
| VS Code 来源 | Release Notes / commit / changelog URL |
| DSH 结论 | 无变化 / 小变化 / 破坏性变化；列出具体影响点 |
| VS Code 结论 | 无影响 / 小更新 / 需要适配；列出具体影响点 |
| 优化机会 | 官方新能力可替换的自研补丁 / 文本模拟 / 兼容层 / 降级实现；如无可写“无”并给依据 |
| 本仓动作 | 无需调整 / 协议改 / 投影改 / 渲染改 / 测试改 / 文档改 / 优化替换 |
| 门禁 | 本轮实测结果，未跑写 PENDING |

“无需调整”也必须记录来源和结论。禁止写“检查过，无变化”但不给证据。

### 20.3 风险优先级

| 上游 | 风险 | 处理优先级 |
|---|---|---|
| DSH | 协议 revision / 方法名 / DTO 字段变化 | P0 |
| DSH | event / projection / context form / producer 变化 | P0 |
| DSH | slot / node kind / tool view 注册点变化 | P0 |
| DSH | pending / approval / question / plan settlement 变化 | P0 |
| DSH | usage / quota / deliverables / turn tail 字段变化 | P1 |
| DSH | composer / model catalog / preset 变化 | P1 |
| VS Code | Chat renderer / content part / serialized history 结构变化 | P1 |
| VS Code | input / picker / theme / a11y / scroll / tree 小变化 | P2 |
| VS Code | 与 Chat/input/editor 无关的常规更新 | 记录即可 |

### 20.4 适配动作

发现变化后按以下顺序处理：

1. 先判断是否影响协议真源 `src/vs/platform/dshClient/protocol/dshIdeProtocol.ts`；影响则先改协议。
2. 再判断 Host bridge / projection 是否要改；不得在 IDE renderer 中伪造缺失事实。
3. 再判断 DSH-IDE 投影、slot/node、tool view、pending、composer、history 是否要改。
4. 最后更新测试、契约状态矩阵、审计台账和真机验收项。
5. 若上游变化造成破坏性不兼容，必须明确写出：旧行为、新行为、迁移策略、验收状态。禁止静默兼容或本地伪造旧数据。
6. 若发现优化机会，必须逐项登记：
   - 当前 DSH-IDE 的旧实现或降级实现；
   - 上游新增的官方能力；
   - 可替换范围；
   - 是否仍符合“业务事实单一真源”和“原生优先”；
   - 目标 PR 或测试；
   - 验收状态。
7. 优化替换优先级：官方 event/projection > 官方协议字段 > 官方 slot/node/tool view > VS Code 原生 content part/API > 受控改造 > 自研组件。不得因为“已有自研实现”而拒绝更优官方能力。

### 20.5 禁止事项

- 禁止用本地 `E:/deepseek-harness`、旧历史汇编或旧 PR 记录代替在线检查。
- 禁止从记忆推断“上游没变”。
- 禁止把 DSH 破坏性更新降级为“样式问题”。
- 禁止为兼容上游而让 DSH-IDE 自己生成业务事实。
- 禁止把未检查写成 PASS；未检查就是 PENDING。
- 禁止只检查破坏性风险而忽略优化机会；上游新能力可替换自研实现时必须登记，不登记视为本轮检查不完整。
- 禁止为保住已有自研实现而拒绝官方更优实现；自研只能是当前无官方能力时的过渡或必要补充。

---

# 附录 A：当前状态矩阵（原 DSH-IDE内容原子化差异表.md）

# DSH-IDE 内容原子化差异表

> 状态：PR-01 产出物（契约核对结论）
> 依据：DSH HEAD `2e39e70496aa02986ca6a820c5d497e816b69d7e`（在线只读核对，未下载整仓）
> 说明：本表逐项记录「DSH 契约 → 当前 DSH-IDE 实现 → 目标实现」。实现状态与门禁状态分开标注。
>
> 证据纪律：每行必须以 DSH 在线源码路径/HEAD（或 commit）与 DSH-IDE 当前 `src/**` / `build/**` / 测试输出为依据。没有双边证据的结论只能写成待核对，不得写成事实；只有数据投影、只有协议方法或只有计划，不等于界面已显示。详细规则见 `docs/DSH-IDE改造开发手册.md` §0.0.2。

## 0. 核对范围

| 契约真源 | 路径 | 核对方式 |
|---|---|---|
| Chat 槽位声明 | `packages/client/ui-chat/src/client/contract/slots.ts` | 全文 |
| Chat 快照与 keyed store | `packages/client/ui-chat/src/client/contract/snapshot.ts` | 全文 |
| Chat 节点 kind 注册表 | `packages/client/ui-chat/src/client/contract/chat-nodes.ts` | 全文 |
| Turn 过程规格 | `packages/client/ui-chat/src/client/contract/turn-process.ts` | 全文 |
| 过程分组活动 | `packages/client/ui-chat/src/client/contract/process-groups.ts` | 全文 |
| 分组树与折叠位置 | `packages/client/ui-chat/src/client/contract/group-tree.ts` | 全文 |
| 每会话视图状态 | `packages/client/ui-chat/src/client/contract/store.ts` | 全文 |
| 工具槽位声明 | `packages/client/ui-tool/src/client/contract/slots.ts` | 全文 |
| 工具视图注册点 | `packages/client/ui-tool/src/client/tool/toolviews/*.tsx` | 注册表全文 |
| 槽位机制标准 | `docs/subsystems/slots.md` | 全文 |
| 会话槽位层级 | `docs/subsystems/slots.md` 第 4 节 | 全文 |

## 1. 槽位机制差异

DSH 的槽位有两个**独立轴**：基数（cardinality）与作用域（scope）。原契约把两者混成一张能力清单，并漏掉 `hoc`。

| 契约项 | DSH 语义 | 当前 DSH-IDE | 目标实现 | 策略 | 实现状态 |
|---|---|---|---|---|---|
| 基数 `single` | 一个单元，优先级最高者渲染 | `dshSlotRegistry.ts` `resolve` | `DshSlotRegistry` single | 自研机制 | 已实现 |
| 基数 `list` | 按 `id` 寻址，`order` 排序 | 同文件；同 id 不同 priority 共存，低值胜出后再按 order | list | 自研机制 | 已实现 |
| 基数 `keyed` | owner 传 `entryKey` 分发；同 key 的低 priority 胜出并替换展示 | 同文件；同 priority 拒绝，不删旧登记 | keyed | 自研机制 | 已实现 |
| 基数 `chain` | 每项提供 `select(owner)`，首个非空结果渲染并作为 `matched` | 同文件 `selected` | chain | 自研机制 | 已实现 |
| 基数 `hoc` | 包裹 owner 内容层层嵌套，低 order 在外；精确 key 替换同 id 通配层 | 同文件 `hocLayers` | hoc | 自研机制 | 已实现 |
| 作用域 `root` | 全局单例组件与 store | 同文件；inject 不带 sessionId | root | 自研机制 | 已实现 |
| 作用域 `session-maybe` | 继承外层绑定，无绑定仍可渲染 | 同文件 | session-maybe | 自研机制 | 已实现 |
| 作用域 `session` | 必须有已解析会话绑定 | 无 sessionId 时 `status: unbound` | session | 自研机制 | 已实现 |
| `priority` | `single`/`list`/`keyed`/`hoc` 的遮蔽等级，`chain` 的选举顺序；**低值先渲染** | 同文件 `cellWinners` | 同语义 | 自研机制 | 已实现 |
| `order` | list 与 hoc 的排序 | list 胜者按 order；hoc 低 order 在外 | 同语义 | 自研机制 | 已实现 |
| owner props | 由渲染点给定，occupant 不可覆盖 | `ownerProps` 锁定 | 同语义 | 自研机制 | 已实现 |
| `inject` | 注册期工厂，收 `sessionId`，返回该 entry 私有数据与回调 | entry.`inject` 按 session 缓存 | 同语义 | 自研机制 | 已实现 |
| 声明即依赖 | 子槽只能由登记方 `declare`；`inject(name)` 等待声明生命周期 | `register().declare` 与 `inject()` | 同语义 | 自研机制 | 已实现 |
| dispose | entry 销毁递归折叠其子槽 | `dispose` 拆子槽并释放 inject | 同语义 | 自研机制 | 已实现 |
| introspection | 运行时可查询 live 树 | `catalog()` 与 `snapshot()` | 同语义 | 自研机制 | 已实现 |
| 变更事件 | 注册变化通知刷新 | `onDidChange`；尚未接到 ChatList | 同语义 | 自研机制 | 部分实现 |

**校订**：原契约 §6 的清单里 `root` / `session-maybe` / `session` 属于作用域，不是基数；`hoc` 是缺失的第五种基数。此项已在契约文档修正。

## 2. Chat 槽位清单差异

真源：`ui-chat/contract/slots.ts` 的 `SlotMap` 声明合并。

| 槽位键 | 基数 | 作用域 | owner props | 当前 DSH-IDE | 目标实现 | 实现状态 |
|---|---|---|---|---|---|---|
| `conversation.chat.flow` | single | session | `ChatFlowOwnerProps` | ChatList 里每段回复一个 `dshSlotHost` | flow renderer | 部分实现 |
| `conversation.chat.node` | keyed | session | `ChatNodeOwnerProps` + 每 kind 的 `{ node }` | 行渲染先问 `dshChatSlotRegistry` 的 keyed occupant（可覆盖 title/detail/icon），没有才用内置 `adaptDshNode` | 节点渲染注册表 | 部分实现 |
| `conversation.chat.commandview` | keyed | session | `CommandRowOwnerProps` | `dshCommand` 卡，没有 keyed 槽 | command row | 部分实现 |
| `conversation.chat.reasoning.body` | single | session | `ReasoningBodyOwnerProps` | 复用原生 thinking；single 槽由 `dshReasoningBodyOverride(sessionId)` 消费，occupant 可覆盖正文文本，缺省用节点的 reasoning | 原生 thinking 复用 | 部分实现 |
| `conversation.chat.turnTail` | list | session | `TurnTailOwnerProps` | `dshTurnTail` + `dshUsage` + `dshDeliverables`；计划卡也按 Turn 收到尾部。list 槽由 `dshTurnTailExtras` 消费：插件按 `order` 追加行（`dshTurnTailExtra`），没有独立席位 DOM | turn 尾部扩展 | 部分实现 |
| `conversation.chat.assistant-actions` | list | session | `AssistantActionOwnerProps` | list 槽由 `dshAssistantActions(sessionId, messageId)` 消费，按钮条渲染在 **turn tail 内**，owner 是 `turn-tail.closingMessageId`；无该字段（中断冻结的部分回复）时不画条 | 消息动作行 | 部分实现 |
| `conversation.chat.user.before` | chain | session | `UserBeforeOwnerProps` | chain 槽由 `dshUserBeforeDecoration(sessionId, kind, source)` 消费：首个认领的 occupant 给一行装饰文本，渲染在用户行上方；**只认 `kind === 'user'`**（官方 `slots.ts` 写明 steering 与 pending 行不渲染此槽），无人认领则不显示 | 用户消息上方装饰 | 部分实现 |
| `conversation.chat.user.images` | single | session | `MessageImagesOwnerProps` | 用户消息的图片由该段 slot host 的 `dshImageGallery` 画（`dsh-attachment:` 读字节转 blob URL）；history **不再**同时产 `dsh-attachment:` reference（2026-11-22 去重，此前同一张图显示两次） | 图片画廊 | 部分实现 |
| `conversation.chat.message.images` | single | session | `MessageImagesOwnerProps` | `dshImageGallery`，气泡不再写 `Image:` | 图片画廊 | 部分实现 |
| `conversation.chat.aside` | single | session | — | single 槽由 `dshAsideText(sessionId)` 消费：occupant 给 `text` 时在槽位尾部渲染一段侧栏文本，无 occupant 不显示 | 侧栏席位 | 部分实现 |
| `conversation.chat.text-interaction` | keyed | session | `TextInteractionSurface` | keyed 槽由 `dshTextInteractions(sessionId, surface)` 消费：选中正文后出现手势条，点击把选中文本作为最后一个参数交给插件命令；缺 `command` 的条目不出现 | 文本手势 | 部分实现 |
| `conversation.chat.markdown.fence` | hoc | session | `MarkdownDelegateFenceInfo` | hoc 槽由 `dshMarkdownFenceOverride(sessionId, info)` 消费：occupant 按围栏 info 接管该段（`ChatMarkdownContentPart` 的 `codeBlockRendererSync` 里优先查它）；无 occupant 时完全走原生渲染 | 围栏层 | 部分实现 |
| `tool.call.toolview` | keyed | session | `ToolCallOwnerProps` | 槽位由 `dshToolViewOverride(toolName, sessionId)` 消费（occupant 可指定家族），缺省才用内置 `dshToolViewId`；DOM 仍是一条 `toolInvocationSerialized` | 工具视图注册表 | 部分实现 |
| `tool.call.images` | single | session | `ToolImagesOwnerProps` | 工具结果里的图片块进 `dshImageGallery`，没有单独席位 | 工具图片画廊 | 部分实现 |
| `shell.quota-notice` | chain | root | `QuotaNoticeOwnerProps` | 回复视图上的 `ChatQuotaExceededPart`；chain 槽由 `dshQuotaNoticeOverride(code)` 消费：首个非空 select 生效，可覆盖文案、可要求保持显示；`retainQuotaNotice` 保证缺省帧与更小 seq 不覆盖 | 配额通知链 | 部分实现 |
| `conversation.approval.detail` | — | session | — | `settleApproval`；标题是任务行，允许/拒绝仍走命令（原生 confirmation 会另发请求） | 审批详情席 | 部分实现 |
| `conversation.plan-review.actions` | — | session | — | 计划题按普通问卷走 `settleQuestion`（选项即 approve / reject 标签）；计划卡归 turn tail，题目按钮之后追加 `Discuss`（`cancelRequest` 结算） | 计划审阅动作 | 部分实现 |
| `conversation.input.dock` | list | session | `InputZone { session, input }` | `dshInputDock.ts` 投影 occupant 行；`dshChatInputDock.ts` 渲染在原生输入卡**上方**，`dshChatInputDockContribution.ts` 按 widget 挂载并随 `DshSlotRegistry.onDidChange` 重画；无 occupant 时宿主 `display:none` 不占位 | 输入区 dock（含 `id=queue`） | 部分实现 |
| `conversation.composer.dock` | list | session | — | 同一套投影/宿主，渲染在原生输入卡**下方**；无 occupant 不占位 | 输入条 dock | 部分实现 |

**校订**：原契约 §6.2 把 `TurnUsagePanel` 当成独立槽位，真源中它是 `TurnTailNodeView` 内部的 React 组件（`ui-chat/src/client/chat/TurnUsagePanel.tsx`），usage 数据由 `TurnTailChatData.tokenUsage` 提供、经 `conversation.chat.turnTail` 席位渲染。DSH-IDE 侧做成 turn tail 内的自研 part，不单开槽位。已修正。

## 3. 节点 kind 注册表差异

真源：`ChatNodeDataMap` 是**声明合并注册表**，`ChatNodeKind = Extract<keyof ChatNodeDataMap, string>`。kind 空间是运行时开放的，不是固定枚举。

| kind | 数据形状 | 当前 DSH-IDE 渲染 | 目标渲染 | 实现状态 |
|---|---|---|---|---|
| `user` | `ReferencedUserMessageNode`（含 `referenceLabels`、`skillNames`） | 原生 user 消息 | 原生复用 | 部分 |
| `steering` | 同上 + `batchStart` | 正文，无 `**Steering:**`；`batchStart` 未投影 | 原生 user 消息变体 | 部分实现 |
| `context` | `ContextMessageNode`（含 `producer`、`form`） | `dshContext` 带正文、form、producer（优先 label，否则 role），外加文件卡 | context 卡 | 部分实现 |
| `turn-trigger` | `ContextMessageNode` | `dshTurnTrigger` 按 `source.kind` 取标题，非文本块另走适配，无 `>` | 触发行 | 部分实现 |
| `assistant`（Chat 层 `assistant-step`） | `AssistantChatData`（status/turn/step/blocks/time/usage/finalNode） | 拆成 text+thinking；有 provider/model 或 interrupted 时另出 `dshAssistantMeta` | 原生 assistant 复用 | 部分实现 |
| `tool-call` | `ToolChatData`（root 含递归 `subCalls`） | 扁平 `toolInvocationSerialized`；嵌套由 `dshConversationNodeTree` 按 `parentCallId` 成树、`renderNode` 缩进 | 工具树 | 部分实现 |
| `command` | `CommandNode`（commandId/name/args/outcome） | `dshCommand`；`toHistory()` 不再推反引号 | command row | 部分实现 |
| `manual-compaction` | 官方 `ui-chat`：`/compact` 命令行与它产生的压缩检查点合成一行 | 协议新增 `manual-compaction`：命令结算带 `outcome.sourceEventSeq` 且指向某个压缩检查点时，两卡合成一个节点（先到后到都能配对）；无 `sourceEventSeq` 的普通命令保持原样。适配产出命令行 + 压缩卡两段 | 命令行 + 压缩卡 | 部分实现 |
| `compaction` | `CompactionSummaryNode`（summary/shadowedItemCount/shadowedTokenCount） | `dshCompaction` | 压缩卡 | 部分实现 |
| `model-retry` | Chat 层 `RetryChatData`（attempts/current） | `dshModelRetry` 带 retry、maxRetries、delayMs、mode、retryState、failure。不是引用块 | 重试链卡 | 部分实现 |
| `turn-error` | `TurnErrorNode` | `warning` / quota | 原生错误卡 | 部分实现 |
| `turn-max-tokens` | `TurnMaxTokensNode` | `dshMaxTokens` 带 turn 和 step，不是 warning | 上限卡 | 部分实现 |
| `turn-tail` | 官方 `ui-chat` 的 `turnTailDefinition`：Completed-turn 动作行与尾部事实 | 协议新增 `turn-tail`：`turn/end` 时给出 turn、closing、branchUnavailable 与 `tokenUsage`（该 Turn 的增量聚合）。用量只在尾部出卡，助手行不再重复 | turn 尾部；`TurnUsagePanel` 为其内部组件 | 部分实现 |
| `turn-process` | 官方 `ui-chat`：一个 Turn 的过程锚点与计数（过程组行的数据） | 协议新增 `turn-process`；收起时槽位优先用它画计数行（`tools N, subagents M, messages K`），缺节点才回退现算。该节点本身不再单独画行 | turn 过程折叠 | 部分实现 |
| `system-prompt` | 官方 `ui-chat` 的 `systemMessageDefinition` / `requestPromptDefinition` | 协议新增 `system-prompt`：`system/message` 的每次非空 append 拥有一张提示卡，文本与上一份不同时标 `update`；非 append 替换不产卡。`dshSystemPrompt` 显示 text 与 update | 系统提示卡 | 部分实现 |
| `inherited-history` | `session/end-seed` 合成行 | `dshInheritedHistory` 分隔行，没有引用块 | 分隔行 | 部分实现 |
| `unknown` | `UnknownSurfaceNode` | 节点和认不出的助手块都走 `dshUnknown`，保留 type 和截断后的 data | 兜底卡 | 部分实现 |
| `submitted-plan` | 官方 `ui-plan`：`exit_plan_mode` 的完整计划（官方在 flow 里隐藏、在 turn tail 里成卡） | 协议 `submitted-plan`：`tool/call` 名为 `exit_plan_mode`、参数 JSON 带 `# 标题` 时另成节点；槽位把计划卡按 Turn 收到尾部渲染，flow 里不再单独成行 | 计划卡 | 部分实现 |
| `command-input` | 官方 `ui-goal`：`/goal` 的 `command/run` 另建一行，通用命令节点保留结果行 | 协议新增 `command-input`：`name === 'goal'` 的 `command/run` 生成命令行（`/goal` + 去掉尾部空白的参数）；`dshCommandInput` 单独回显 | 命令输入行 | 部分实现 |
| `question-reply` | 官方 Chat 层回执：工具结果或迟到人工回复里的整份答案 | 协议新增 `question-reply`：`ask_user_question` 的整份 JSON 回执取代普通工具卡；迟到 `source.kind='user-question-reply'` 也认领。`dshQuestionReply` 按题面回显答案 | 问答回复卡 | 部分实现 |
| `workflow-run` | 官方 `ui-workflow-run`：`tool-workflow/*` 事件折叠出的顶层运行与成员 | 协议 `workflow-run`：run-start 建节点，agent-start/agent-end/run-end 就地更新；阶段按首次出现分组。Turn 被中断 / fork 且没有 run-end 时（官方 `turnAbandoned`），运行与未结算成员转成 `interrupted` | 工作流卡 | 部分实现 |

**分层校订（2026-11-22）**：`packages/client/ui-conversation/src/client/contract/records.ts`（master `f20f24e0`）的 `ConversationNode` 联合只有 11 个 kind，`submitted-plan` / `command-input` / `question-reply` / `workflow-run` 不在其中；它们是客户端包往 `ChatNodeDataMap` 合并注册的 Chat 层 kind。这四项已于 2026-11-22 全部进线协议（`dshIdeProtocol.ts` 各自的 Node 类型 + `dshIdeConversation.ts` 的投影），状态为「部分实现」——数据与渲染已就位，真机未验证。

**DSH-IDE 现有私有节点已全部退场（PR-02 完成）**：`subagent-catalog` 与 `subagent-notice` 都不是官方 kind，已按裁定改为：

- `subagent-catalog` → **移出 chat 节点树**，改走 `DshIdeConversationView.subagentCatalog` 投影通道（对应官方 `SessionProjectionMap['subagentCatalog']`）。
- `subagent-notice` → **投影为官方 `turn-trigger`**，且只在 `waking === true` 或 `source.kind === 'retry'` 且 content 为空时产出（对齐 `message.ts` 的 `buildViewNode`）；其余非人类消息归入 `context`。

真源依据：`register.ts` 的注册清单里没有处理 `subagent/catalog` 的 Definition；`fallback.ts` 的 `unknown-surface` 才会兜住它；`ui-subagent/SubagentCatalog.tsx` 通过 `useProjection('subagentCatalog')` 读取，与 chat 节点树无关。因此把它塞进 `context` 会伪造 DSH 没有的语义。

`turn` / `step` 仅作位置坐标保留，不构成私有节点 kind。

## 4. Turn 过程与折叠差异

| 契约项 | DSH 语义 | 当前 DSH-IDE | 目标实现 | 实现状态 |
|---|---|---|---|---|
| `TurnProcessSpec` | controlAnchorSeq / processStartSeq / answerAnchorSeq / answerStep / inlineReasoning / messageCount / toolCallCount / subagentCount | 线协议 `turn-process` 节点已带这些字段（`DshIdeTurnProcessNode`）；客户端 `describeTurnProcess` 仍从节点现算供折叠判定，`inlineReasoning` 固定 false | 完整投影 | 部分实现 |
| `ChatTurnProcessPresentation` | turnStarted / turnClosed / hasExternalProcess / hasNonReplyProcess / hasInterleavedInput | `describeTurnProcess`。`hasInterleavedInput` 为真时 `groupTurnProcesses` 不允许收起 | 折叠判定输入 | 部分实现 |
| `turnProcessAlwaysOpen` | `open` / `aborted` / `interrupted` / `error` 的 turn 不可整体折叠 | `dshProcessGroup.turnProcessAlwaysOpen` | 同语义 | 部分实现 |
| `isSubagentDelegationTool` | `subagent` 或 `subagent_*` | `isSubagentDelegationTool` | 同语义 | 部分实现 |
| `ChatGroupTree` | `exchange` / `input` / `turn` / `process` 四级位置 | `groupPositionOf`；exchange 不是节点 kind | 位置驱动折叠 | 部分实现 |
| `isAtOrOutside` | 位置深度比较 | 由 `groupPositionOf` + `visibleProcessKeys` 完成（原独立函数零调用，已删） | 同语义 | 部分实现 |
| 折叠状态存储 | `ChatStoreState.turnProcesses: TurnProcessViewEntry[]`，键为 `turn + answerStep`，`collapsed?: true` | `dshExpansionStateStore`，按会话一份 | session 作用域 store | 部分实现 |
| 节点级展开 | `useDisclosure()`，每次调用独立状态，随 enclosing Turn 重置 | `disclosure` + `resetTurn` | 同语义 | 部分实现 |
| 过程分组活动 | `ProcessActivity` 14 类（read/readImage/search/write/edit/commands/code/webSearch/webFetch/subagents/plan/questions/tools/context） | `processActivityOf` 覆盖全部 14 类，逐条对照官方 `conversation-nodes/process-activity.ts` 的 `activity()`；`processActivityText` 提供本地化文案 | 分组摘要 | 部分实现 |
| 活动摘要的 context 语义 | `processActivity()`：**全部成员都是 context** 时报一个 `context` 类、计成员数；context 与其它成员混在一起时**不计数** | `summarizeProcess` 已按此实现：`allContext` 为真才记 `counts.context = nodes.length`，否则跳过 context | 同语义 | 部分实现 |
| 活动摘要 | `ProcessActivitySummary`（counts/running/runningDetail/preparing?） | `summarizeProcess`；收起行优先用 `turn-process` 节点计数（`processLineFromSnapshot`），缺失才回退 `hiddenProcessLine` | 同语义 | 部分实现 |

**校订**：原契约 §12.1 设计 `key = sessionId:turnId:groupId:nodeId:rendererId` 的展开存储。真源中折叠是**两层**：Turn 级只有 `(turn, answerStep)` 一个布尔，节点级由 `useDisclosure` 自持并在 Turn 重置时清空。按原设计会与 DSH 语义冲突，已改为对齐真源。

**2026-11-22 补记**：`turn-process` 节点已进线协议，收起行的计数优先取它；客户端 `describeTurnProcess` 仍保留，因为折叠还需要 `hasInterleavedInput` 这类节点级信息。

## 5. 快照与增量更新差异

| 契约项 | DSH 语义 | 当前 DSH-IDE | 目标实现 | 实现状态 |
|---|---|---|---|---|
| `ChatSnapshot` | `order` + `nodes` + `locations` + `navigation` + `timeline` + `legacy` | `snapshot()` 有前四项，Map 是副本。没有 timeline / legacy | 同构投影 | 部分实现 |
| `ChatNodeStore.get/source` | 按稳定 key 取节点与 observable source | `DshConversationNodeTree.get` / `source(key)` 已存在；`DshSlotHostContentPart` **已改为按 key 订阅**（每个 `nodeIds` 成员一个 `source(key).subscribe`），不再订阅整树 | per-key observable | 部分实现 |
| `bottomSource` | 该节点是否属于最新已载入 exchange | `bottomSource(key)` | 同语义 | 部分实现 |
| `turnDataSource(turn, kind)` | 单 turn 单 kind 的有序数据源，其它 turn/kind 不通知 | `turnDataSource(turn, kind)` | 同语义 | 部分实现 |
| `processSource` | 单节点所属 turn 过程展示源 | `processSource(key)` | 同语义 | 部分实现 |
| `ChatLocationNodeIndex` | `getTurn(turn)` / `getStep(turn, step)` | `getTurn(turn)` 与 `getStep(turn, step)` | 同语义 | 部分实现 |
| `ChatTurnNavigationIndex.items()` | 已载入 turn 的导航项（anchorKey/prompt/response） | `navigationItems()` | 同语义 | 部分实现 |

**这是与原契约最大的架构差异**：原契约描述的是「快照 → 树 → 整树重渲染」，真源是**按 key 的增量可观察存储**。若按原设计实现，虚拟化重绘与流式更新都会退化。

**2026-11-22 运行现象补充**：会话运行时出现快速滚动、无法稳定阅读，已确认是本节差异的直接后果。完整双证据、根因分层、修复计划与验收标准见 `docs/DSH-IDE内容原子化契约.md` §19「运行时稳定性专项：频繁重建与高频滚动」。

## 6. 工具视图差异

真源：`tool.call.toolview` 为 keyed，key 是 **wire 工具名**；无注册时回落 `GenericToolCard`。

| key | DSH 注册文件 | 当前 DSH-IDE | 实现状态 |
|---|---|---|---|
| `bash` | `bash-sample.tsx` | `$ command`，仍是 `toolInvocationSerialized` | 部分实现 |
| `read` | `read-row.tsx` | 标题用路径，没有 read-row DOM | 部分实现 |
| `read_image` | `read-image-row.tsx` | 标题用路径，没有图片行 DOM | 部分实现 |
| `apply_patch` / `edit` / `write` | `file-mutation-row.tsx` | 标题用路径；绝对路径另走 multiDiff | 部分实现 |
| `grep` / `glob` | `search-row.tsx` | pattern 作标题，命中最多 20 行 | 部分实现 |
| `web_search` / `web_fetch` | `web-row.tsx` | url 或 query 作标题 | 部分实现 |
| `todo_write` | `todo-row.tsx` | `progressTaskSerialized` | 部分实现 |
| `ask_user_question` | `ask-question-row.tsx` | 工具卡用 question；待决问卷仍是命令按钮 | 部分实现 |
| `office_render` / `office_convert` / `office_recalculate` | `office-row.tsx` | 标题用 path，没有 office-row DOM | 部分实现 |
| `skill` | `ui-skill` 包 | 标题用 name | 部分实现 |
| `present` | `ui-deliverables` 包 | 标题用 path 或 name；交付物另有 reference | 部分实现 |
| `create_goal` / `get_goal` / `update_goal` | `details-row.tsx` | details 一行，会话级 goal 仍是 info | 部分实现 |
| `schedule_create` / `_list` / `_view` / `_edit` / `_delete` / `_update` | `details-row.tsx` | details 一行 | 部分实现 |
| `cordis_inspect` / `_list` / `_query` / `_self` | `details-row.tsx` | details 一行 | 部分实现 |
| `cordis_stop` / `cordis_undefine` | `ui-cordis` 包 | details 一行 | 部分实现 |
| `workflow` / `ralph` | `details-row.tsx` | details 一行 | 部分实现 |
| `session_event_read` / `_search` / `_trace` / `session_search` / `session_trace` | `details-row.tsx` | details 一行 | 部分实现 |
| `subagent` / `subagent_fork` / `list_subagent_models` / `list_agents` / `send_message` / `interrupt_agent` / `wait_agent` / `spawn_teammate` | `details-row.tsx` | details 一行 | 部分实现 |
| `job_list` / `job_output` / `job_kill` | `details-row.tsx` | details 一行 | 部分实现 |
| `terminal_open` / `_read` / `_list` / `_signal` / `_close` | `details-row.tsx` | details 一行 | 部分实现 |
| `lsp` | `details-row.tsx` | details 一行 | 部分实现 |
| `team_task_create` / `_get` / `_update` / `_list` | `details-row.tsx` | details 一行 | 部分实现 |
| `timeline_tasks` | `experimental/timeline` | details 一行 | 部分实现 |
| 未注册 | `GenericToolCard` | 通用卡 | 已对齐 |

**校订**：原契约 §8 只列了 13 个 tool view，真源实际注册点覆盖 **60+ 个 key**（`details-row.tsx` 一个文件就注册 42 个）。原契约把 `detailsToolView` 写成「DSH details keys」，实际它是**共享紧凑详情行**，承载记录型工具的统一呈现。

补充：`submitted-plan`、`command-input`、`question-reply`、`workflow-run` 已在 2026-11-22 进线协议（`dshIdeProtocol.ts` 的对应 Node 类型 + `dshIdeConversation.ts` 的投影），状态从「未实现」改为「部分实现」；真机仍未验证。

## 7. 待处理交互差异

| 契约项 | DSH 语义 | 当前 DSH-IDE | 实现状态 |
|---|---|---|---|
| 待处理提交 | `PendingSubmission`、`InboxState['next-step']` 与 `conversation.chat.flow` 的 `pendingInputs` 一起渲染 | `agent/inbox/spliced` 的 `inserted` 本来就是完整 `UserMessage[]`（含 text/image/file 的 `content`），原先只投影成 `DshIdeInboxIdentity` 是**本仓丢弃了 content**。2026-11-23（CHK-337）已在协议补 `DshIdeInboxMessage` / `DshIdeInboxBlock` 与 `inboxNextTurn` / `inboxNextStep`，投影保留内容块，`dshInputDock` 把它投影成 `conversation.input.dock` 的队列行（按会话、可点击定位，不伪造发送）。真机 PENDING | 部分实现 |
| 审批详情 | `conversation.approval.detail` 席位 | `settleApproval` 可带 reason；标题是任务行，允许/拒绝仍是 command，因为原生 confirmation 会另发一条请求 | 部分实现 |
| 计划审阅 | `submitted-plan` 节点 + `conversation.plan-review.actions` 席位 | 计划题目的选项按钮之外再给 `Discuss`：`dsh.discussQuestion` 调 `cancelRequest` 结束审阅（Host 结算，不是本地隐藏卡片），成功才移除卡片；在途互斥、终态记录。尚无独立动作行 DOM | 部分实现 |
| 问答记录 | `UserQuestionRecord { questions, answers }`；答案可来自 call result 或 `userQuestions` 投影 | 作答走 `dshQuestionCarousel`（整份提交）；作答后线协议产出 `question-reply` 回执，按题面回显答案 | 部分实现 |
| 问答面板 | `userQuestionPanels.reveal(sessionId, callId)` / `.review(sessionId, callId, record)` | 无独立面板；待决问卷就地渲染在 transcript 尾部，已答的在 `question-reply` 回执里按题面回显。缺 `reveal` / `review` 入口与面板宿主 | 未实现 |
| 配额通知 | `shell.quota-notice` chain，`QuotaNoticeOwnerProps.keepOpen()` 可阻止后续覆盖 | 回复视图上的 `ChatQuotaExceededPart`。`retainQuotaNotice`：缺省帧不清除，更小的 seq 不覆盖。没有 keepOpen 回调 | 部分实现 |
| 输入阻塞 | `inputBlocked` 与 `isTranscriptProgressActive` | `DshChatSessionContent.isInputBlocked` 已把「有待决交互」映射成原生 observable（`pending().length > 0`，随 `onDidChangePending` 变化）；原生 `ChatWidget` 已把它接到 `ChatContextKeys.inputBlocked` 与提交门禁 | 部分实现 |

## 8. 验收结论

PR-01 的验收项是「不存在『先用文本代替』的最终态」。分两层判定：

| 层面 | 结论 | 依据 |
|---|---|---|
| 契约文档是否仍认可文本代替 | **PASS** | 契约 §1.5 明确禁止。本表把仍在用文本的地方写成「部分实现」或「未实现」，不把它们写成已实现 |
| 当前实现是否已无文本代替 | **部分实现** | 依据第 3–7 节逐项矩阵。**2026-11-22 实测**：结构节点已全部走 `dsh*` 结构化卡或原生 part；仍以非结构化形态承载的只剩两处——① 审批 / 单题问卷的选项按钮是 `command`（原生 confirmation 不能调用 `dsh.answerApproval`）；② team 设置失败提示是 `warning`。`progressTaskSerialized` 的 `progress` 子项虽形如 `warning`，但那是原生任务行的标准形状，不算文本模拟 |

当前实现状态按第 3–7 节逐项矩阵判定，不再用单一 PASS/FAIL 概括。文本代替的清除按第 13 节 PR 执行：

- PR-04/PR-05：节点身份与渲染扩展点。**已完成**（按 key 订阅，见 §17 已接清单）。
- PR-06/PR-08：原生 adapter 与 tool views。**已完成**（`DshNativeAdapterId` 实测 29 个；tool view 家族 13 个）。
- PR-11/PR-12：压缩、系统提示、命令、错误卡落地，删除文本模拟。**已完成**（`dshCompaction` / `dshSystemPrompt` / `dshCommand` / `dshCommandInput` / `manual-compaction` 等均已落地）。

运行时稳定性问题（高频滚动/频繁重建）见契约 §19；它不改变本表的节点状态，但影响验收。

## 8.1 PR-02 私有 kind 裁定的落地结果

| 私有 kind | 裁定 | 落地位置 | 门禁 |
|---|---|---|---|
| `subagent-catalog` | 移出 chat 节点树，走 `subagentCatalog` 投影 | `dshIdeProtocol.ts` 的 `DshIdeSubagentCatalogEntry` + `DshIdeConversationView.subagentCatalog`；`dshIdeConversation.ts` 写入 `state.subagentCatalog` | 校验器放行 `subagentCatalog` 数组；节点白名单不含该 kind |
| `subagent-notice` | 投影为官方 `turn-trigger`（仅 waking 或空 content retry） | `dshIdeConversation.ts` 的 `user/message` 分支；`dshChatModel.ts` 的 `DshTurnTriggerNode`；`dshNativePartAdapters.ts` 的 `dshTurnTriggerTitle`（`toHistory` 已不再自带触发器标题） | 未认领的 `subagent-settled` 断言为 `context`；认领的断言为 `turn-trigger` |

新增正式字段：`turn-trigger` 携带 `content` / `source` / `producer`（role + label）/ `form`，`producer` 对应官方 `contextProducer` 的 role/label 投影。`turn` 仍是位置坐标。

验证方式（运行期，不只是静态检查）：`dshIdeConversation.test.ts` 用真实 `validateDshIdeSnapshot` 跑接受/拒绝矩阵——两个私有 kind 必须被拒（`kind is not an official conversation node`），`turn-trigger` 与 `subagentCatalog` 必须被接受，投影通道里的未知字段必须报错。静态断言（源码不含私有 kind 字符串）单独保留，两条互为补充。

## 9. 对契约文档的修正清单

本表核对后，需回改契约文档以下条目（已在文档中执行）：

1. §6 能力清单：区分基数（single/list/keyed/chain/**hoc**）与作用域（root/session-maybe/session）；补 `hoc`。
2. §6.2 概念对应：`TurnUsagePanel` 不是槽位而是 `TurnTailNodeView` 内部组件，改由 `conversation.chat.turnTail` 承载；补 `conversation.chat.commandview`、`conversation.chat.reasoning.body`、`conversation.chat.turnTail`、`conversation.chat.assistant-actions`、`conversation.chat.user.before`、`conversation.chat.aside`、`conversation.chat.text-interaction`、`conversation.chat.markdown.fence`、`shell.quota-notice`。
3. §7 节点清单：拆成两张表——`ConversationNode` 的 11 个官方 kind（必须投影）与客户端包合并注册的 Chat 层 kind（`assistant-step`、`turn-tail`、`turn-process`、`system-prompt`、`manual-compaction`、`submitted-plan`、`command-input`、`question-reply`、`workflow-run`，已逐一进线协议）。kind 空间运行时开放。
4. §8 Tool View 清单：补 `details-row` 承载的 42 个 key、`cordis_*`、`schedule_*`、`session_*`、`job_*`、`terminal_*`、`lsp`、`team_task_*`、`workflow`、`ralph`。
5. §12.1 折叠状态：改为对齐真源的两层模型（Turn 级 `(turn, answerStep)` + 节点级 `useDisclosure`），删除自造的五段 key。
6. §2 目标链路：补「按 key 增量可观察存储」，不再只描述整树重绘。

---

# 附录 B：真机验收执行表（原 真机验收清单.md）

# DSH-IDE 真机验收清单

> 本文列出**必须由人工在真实 DSH 环境执行**的验证项。代码层证据见 `PROJECT_AUDIT.md` 最新轮次，不在本文重复硬编码测试数或门禁数。
>
> 每一项都给出：**怎么做** / **期望看到什么** / **不合格长什么样**。
>
> 全部通过后，「全可用」与「UI 美观」两项才算达标。

## 0. 前置

1. 安装插件：把 `dist/dsh-ide-2.0.0.tgz` 装进 `~/.dsh/profiles/desktop`。
2. 重启 DSH。
3. 确认插件在插件列表里为**已启用**。

## 1. 插件详情页（合规范 + UI）

| # | 怎么做 | 期望 | 不合格 |
|---|---|---|---|
| 1.1 | 打开插件详情页 | 显示 **DSH-IDE** 名称 | 空白或显示包名 `dsh-ide` |
| 1.2 | 同上 | **显示鲸鱼图标**（蓝底圆角矩形 + 白鲸） | 图标缺失 / 破图 |
| 1.3 | 同上 | 描述文案完整（中文应显示中文描述） | 显示英文 / 显示 `{...}` 占位符 |
| 1.4 | 点「详情」 | 打开 `DETAIL.zh.md`，三个章节齐全 | 404 / 空文件 |

## 2. 入口按钮（全可用 + UI）

| # | 怎么做 | 期望 | 不合格 |
|---|---|---|---|
| 2.1 | 打开任意 DSH 会话 | 会话头部「…」菜单**右侧**出现鲸鱼按钮 | 找不到按钮 |
| 2.2 | 观察按钮默认态 | 文案「在 DSH-IDE 中打开当前工作区」 | 英文 / 乱码 |
| 2.3 | 悬停 | 有 tooltip | 无提示 |
| 2.4 | **点击** | 按钮变「正在启动 DSH-IDE…」→ 弹出新窗口 | 无反应 / 一直转圈 |
| 2.5 | 等窗口出现 | 窗口加载出 VS Code 界面 | 白屏 / 报错 |
| 2.6 | **再点一次** | **复用已有窗口**（聚焦），不新开第二个 | 开出第二个窗口 |
| 2.7 | 关掉 IDE 窗口后立刻再点 | 能重新打开（不必等 15 秒） | 点了没反应、要等很久 |

## 3. 主题与观感（UI 美观）

| # | 怎么做 | 期望 | 不合格 |
|---|---|---|---|
| 3.1 | 切到**浅色**主题 | 鲸鱼图标为深色，清晰可见 | 与背景同色看不见 |
| 3.2 | 切到**深色**主题 | 鲸鱼图标为浅色，清晰可见 | 同上 |
| 3.3 | 观察按钮与相邻控件 | 高度、圆角、间距一致 | 明显错位 / 撑破布局 |
| 3.4 | 拉窄窗口 | 按钮不挤压其它控件、不溢出 | 布局错乱 |

## 4. 对话能力（全可用）

| # | 怎么做 | 期望 | 不合格 |
|---|---|---|---|
| 4.1 | 在 IDE 窗口里发一条消息 | 消息出现在 DSH 会话里，模型正常回复 | 无回复 / 报错 |
| 4.2 | **发一张图片** | 图片被接收并显示 | 报错 / 图片丢失 |
| 4.3 | 发一张 **>20 MB** 的图片 | 提示大小超限，**不崩溃** | 崩溃 / 无提示 |
| 4.4 | 在 IDE 里切换会话 | 会话随之切换，历史正确 | 显示上一个会话的内容 |
| 4.5 | 观察 token 用量 | 数字随对话增长，切换会话后归零重算 | 切换后仍显示旧数字 |

## 5. 各类操作反馈（全可用 + UI）

> **2026-11-22 口径更正**：本表原列 MCP / 后台作业 / 目标三项，但当前线协议（`dshIdeProtocol.ts` 的 `DshIdeMethodArgs`，42 个方法）**没有** `mcpListServers` / `mcpRestartServer` / `jobList` / `jobKill` / `setGoal`，`src/vs/workbench/contrib/dsh/browser/` 也没有对应的命令模块——这些能力在历史重构中被移除，IDE 输入区与命令面板不再提供入口。本表只保留协议与界面都存在的项；要恢复必须先加回协议方法 + Host 实现 + 界面入口，不属于真机验收范围。

| # | 怎么做 | 期望 | 不合格 |
|---|---|---|---|
| 5.1 | 收藏一个会话 | 出现收藏成功提示 | 无提示 / 报错 |
| 5.2 | 置顶一个会话 | 出现 pin 指示 | 无指示 |
| 5.3 | 重命名会话 | 出现成功提示，名称更新 | 无提示 / 名称不变 |
| 5.4 | 移动会话到其它工作区 | 出现成功提示 | 无提示 |
| 5.5 | 在团队选择器里选团队 | 出现选中标记 | 无标记 |
| 5.6 | 执行 rewind | 会话回退到指定位置 | 无反应 |

## 6. 内联补全（未实现 / 不提供入口）

> **2026-11-22 口径更正**：当前线协议 `DshIdeMethodArgs`（42 个方法）**没有** `inlineComplete`；`src/vs/workbench/contrib/dsh/browser/inlineCompletion.ts` 与 `dshConfiguration.ts` 已随历史重构移除，README 也写明「行内补全：不在聊天主路径上，不注册」。因此本节**没有任何可验收项**，状态为 `未实现`，不是 `PENDING`。要恢复必须先按官方 DSH 源码重新确认 `inlineComplete` 的 Host 白名单与契约形状，再加协议方法、Host 实现、provider 注册与开关；在那之前不得把本节当作「装好就能用」。

## 7. 断线与重连（全可用）

| # | 怎么做 | 期望 | 不合格 |
|---|---|---|---|
| 7.1 | 停掉 DSH 后端 | 出现「连接已断开，正在重试」提示**一次**（不重复弹） | 无提示 / 弹很多次 |
| 7.2 | 重启 DSH 后端 | 自动重连，出现「已重新连上」提示 | 不重连 / 无提示 |
| 7.3 | 重连后发消息 | 正常工作 | 报错 |

## 8. 安装漂移门禁（合规范）

```bash
# 装好插件后：
export DSH_PROFILE_DIR="$HOME/.dsh/profiles/desktop"
npm run verify:dsh-install-drift
```

| 期望 | 不合格 |
|---|---|
| `STATUS: PASS`（产物与已安装副本逐字节一致） | `STATUS: FAIL` 并列出漂移文件 |

## 9. 内容原子化与运行时稳定性（PENDING）

以下项目前只在代码层有实现或测试，必须按真机结果判定；状态默认 `PENDING`：

| # | 验收项 | 通过标准 |
|---|---|---|
| 9.1 | 打开含 tool / context / compaction / retry / plan / question 的历史会话 | 各类内容按结构化卡片显示，不再以 `info` / `warning` / 裸 markdown 冒充 |
| 9.2 | 运行一个会产生工具调用和 usage 更新的任务 | 历史区域不快速滚动；用户上滚阅读时不被拖回底部 |
| 9.3 | 多次快照刷新 / 重新打开同一会话 | 已展开/折叠状态不丢失，稳定历史不整块闪动 |
| 9.4 | 多题 / 多选 / custom 问卷 | 可完整作答一次提交，不只显示单题按钮 |
| 9.5 | plan review | 正文完整，accept/reject/discuss 有明确结果 |
| 9.6 | 图片 / 文件 / 交付物 | 结构化卡片显示并可打开，不再显示 `Image: xxx` / `File: xxx` 文本标签 |

详细验收矩阵和稳定性计划见 `DSH-IDE内容原子化契约.md` §15、§18、§19。

## 记录结果

把每项的通过/失败记下来（可以直接在本文勾选）。状态只允许 `PASS` / `FAIL` / `PENDING`；**任何一项失败，请把「不合格」一列的观察结果告诉我**，我据此定位修复。
