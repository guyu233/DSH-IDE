# DSH-IDE 承接 DSH 官方聊天页面的路线草稿

> 本文为基于静态源码分析的路线草稿，不代表真机观测结论。所有 `file:line` 以分析时快照为准，定位时以实际文件为准。
>
> 分析日期：2026-11-16。
>
> 参考：`docs/DSH-core内容进入桌面前端的全部入口.md`、`docs/DSH-IDE内容接收与ChatSession面板架构分析.md`、`docs/DSH聊天页面全量构成与插件显示机制.md`、DSH 源码 `E:/deepseek-harness/`、当前 DSH-IDE 源码 `E:/DSH-IDE/src/`。

---

## 0. 最终决策与目标基线

### 0.1 选定路线

**在现有原生 chat 面板（`dshChatSession.ts` / `dshChatModel.ts`）上改造，只承接 DSH 源码内置的官方聊天内容。**

- 不用 WebviewView，不在 IDE 里跑 DSH Web renderer。
- 不引入 DSH 的 React slot 运行时，不加载插件 UI bundle。
- 不扫描非官方插件资源，不做插件内容告警。
- 非官方插件产生的额外效果一律过滤，不在 IDE chat 中显示。
- **渲染采用"翻译层"方案**：把 DSH 节点数据翻译成 VS Code 原生 content kind，用 VS Code 原生模具显示，保留 VS Code 原生视觉风格（详见第 5 章）。

### 0.2 目标基线

> **以"DSH 原版在不装任何非官方插件时，聊天页正常显示的内容"作为唯一参照系；这些内容在 DSH-IDE chat 面板里也要正常显示和使用。**

官方聊天内容的承接方式是：**Host 侧拿官方 event/projection 数据 → 写死投影 → 唯一 `dshIde` 通道 → IDE chat 写死渲染器**。官方插件（如 approval、deliverables、tool）贡献的 UI 通过它们在 Host 侧产生的数据效果承接，不运行它们的 React 组件。

### 0.3 明确不做

| 排除项 | 原因 |
|---|---|
| 非官方插件的 UI 效果 / 独有数据效果 | 超出目标基线，主动过滤 |
| 插件资源扫描 / `clientModules` 软依赖 / slot 名静态扫描 | 复杂度高，收益不在目标内 |
| Cordis inspect 活页面查询 slot / props | 需跑 client runtime，与选定路线冲突 |
| WebviewView 承载 DSH Web UI（重版 B） | 等于新建第二套前端运行时，放弃 |
| 轻量 slot / 描述性 slot 投影 / 通用卡片规则表 | 不引入第二套 UI 运行时 |
| 把 VS Code 渲染工厂重写成 slot 等价注册表 | 用户目标是"原生风格正确渲染"而非"像素级还原/插件可扩展"，注册表属过度设计（见 5.4） |
| 卡片像素级还原 DSH 外观 | 用户明确不做，保留 VS Code 原生风格更好 |

### 0.4 判别标准

三层都满足才算承接住：

1. **数据承接**：Host 侧拿到 DSH core 产生的官方内容。
2. **投影承接**：经唯一 `dshIde` 通道，以契约允许的形状送到 renderer。
3. **UI 承接**：翻译层把 DSH 节点映射成原生 content kind，原生列表渲染出来并提供交互。

### 0.5 关键澄清：渲染目标是"原生风格"，不是"像素级还原"

用户已明确：

> "让卡片长得和 DSH 一模一样不是我的目标……相反要是保留一些 VS Code 原生的风格更好。"

因此本方案的核心不是"改造模具"，而是"**把 DSH 的数据翻译成 VS Code 模具认识的格式**"。改的是**数据层（driver / 翻译层）**，不是 UI 层。验收标准是"不丢内容、能交互、不串不卡"，而不是"长得像"。

DSH 特有但 VS Code 无对应的纯装饰（鲸鱼运行动画、TurnNavigator、PixelWhale、onboarding 等）本轮不做，详见第 6 章。图标全局替换是独立议题，见第 7 章。

---

## 1. 身份前提

1. **DSH-IDE 是 DSH 应用内的 bundle 插件**，不是独立应用，不产出独立安装包，不新增第二个 Cordis 根、第二套会话或第二套协议。
2. **DSH-IDE 对 DSH 而言就是一个 Cordis 插件**：跑在 DSH Host 进程、复用同一个 `dshCtx`，天然共享事件总线、session 服务、工具、审批、模型目录等 Host 侧能力。
3. DSH-IDE 内部为 VS Code 扩展保留的扩展宿主，是其作为 VS Code 外壳的内部层次，**不是 DSH-IDE 相对 DSH 的身份**。相对 DSH，身份只有一个：Cordis 插件。
4. Host 半身 / IDE 窗口之间只走官方客户端传输与唯一 `dshIde` 通道。

证据：

- `src/vs/platform/dshClient/index.js:19`：`export const inject = ['sessions']`。
- `src/vs/platform/dshClient/index.js:29`：`ctx.plugin(IdeRemoteService, { root, pluginRoot })`。
- `src/vs/platform/dshClient/index.js:54`：`ctx.inject(REQUIRED_SERVICES, bridgeCtx => createDshIdeHostBridge(...))`。
- `src/vs/platform/dshClient/host/ide-view-host.js:308-309`：订阅 `approval/request` / `user-questions/request`。
- `src/vs/platform/dshClient/host/ide-view-host.js:317-325`：订阅 `api-session/status` / `added` / `removed`。
- `src/vs/platform/dshClient/host/ide-service.js:26-44`：`IdeRemoteService extends Service`，`bindTypertRemote(this, 'ide', ...)`，`ctx.effect` 做卸载清理。

---

## 2. 当前承接架构与现状

### 2.1 桥链路

当前不是直连 DSH Web app 的几十个原生 RPC 端点，而是收敛成"一个内核桥 + 三类前端投影"：

- **入站（core → IDE）**：`ide-view-service` / `ide-view-host` 订阅会话流与 Host 事件，经 `dshIde` 通道把快照推给 renderer。
- **出站（IDE → core）**：renderer 调 `IDshClientService.call(method, args)`，transport 统一发 `ide/dispatch`，由内核决定调哪个官方端点；IDE 不直连 `session/*`、`modelCatalog`、`settings` 等端点。
- **UI 落点**：`DshClientContribution` 接 snapshot / waterfall / sessionNotice，交给 `DshChatSession` 渲染。

关键文件：

- 契约真源：`src/vs/platform/dshClient/common/dshIdeProtocol.ts`
- Host 桥：`src/vs/platform/dshClient/host/ide-view-host.js`
- electron-main 投影：`src/vs/platform/dshClient/electron-main/ide-view-service.ts`
- transport：`src/vs/platform/dshClient/transport/dshIdeTransport.ts`
- renderer 消费：`src/vs/workbench/contrib/dsh/browser/dsh.contribution.ts:60-88`

### 2.2 frame 的真实形状

当前没有 `DshIdeFrame` 这个类型。真实形状是：

- `DshIdeViewSnapshot.frame: Readonly<Record<string, unknown>>`（`dshIdeProtocol.ts:85-87`），是 opaque 裸 follow 帧；`validateDshIdeView` 只校验 `type` 非空字符串（`:780-790`）。
- nodes / pending / modelMenu / sessionNotice 是四条独立通路在 renderer 拼装：
  - nodes：从 frame 的 `snapshot/event/assistant-stream` 累积（`dshChatModel.ts:388-403`）。
  - pending：独立 `listen('waterfall')`（协议 `:583-590, :671-705`）。
  - modelMenu：独立 `composerState` 一元调用（协议 `:202`）。
  - session 状态：独立 `subscribeSessionNotice`（协议 `:870-871`，notice 形状 `:667-669`）。
- `ide-view-service.ts:190-235` 的 `receive` 只做三件分流：waterfall → 独立订阅者（`:195-200`）；`session-status`/`session-list` → sessionNotice（`:206-216`）；其他裸帧 → `publish({ frame: raw })`（`:217`，`publish` 零字段投影，`:220-235`）。

### 2.3 现状：能承接 / 不能承接

**能承接：**

| 能力 | 状态 | 方式 |
|---|---|---|
| `session/follow` 会话事件流 | 能 | Host 订阅流，转 `DshIdeFrame` 推 chat 面板 |
| 消息正文 / 工具调用 | 能（快照式） | `consumer.onDidChangeFrame → chat.accept(state.frame)` |
| 审批 / 问卷 | 能（受限） | `approval/request` / `user-questions/request` → `DshChatPending` |
| waterfall 阶段状态 | 能 | `client.onDidWaterfall → chat.acceptWaterfall`（`dsh.contribution.ts:73`） |
| 会话列表 / 切换 | 部分能 | `listSessions` + `DshIdeSessionsService` + `DshAgentSessionsController` |
| 提交用户输入 | 能 | `submit{text}` 经 `ide/dispatch` 转发 |
| 模型 / effort / 权限 / 团队 / preset | 能（仅 UI 投影字段） | `composerState` 经 `projectDshIdeComposer`（`dshIdeComposer.js:21-38`） |
| 开窗绑定会话、预置目录 | 能 | env 中 `sessionId` / `DSH_IDE_COMPOSER`（`dsh.contribution.ts:75-88,105-115`） |

**不能承接（改造目标）：**

| 内容 | 原因 |
|---|---|
| 账户、设置、展示偏好 UI | renderer 无 UI 消费 |
| `loadOlder` 高级参数、`resume/fork/rewind`、`searchSessions`、`fetchRowDetail`、`listCommands`、`readAttachment` 完整入口 | 多数只有契约或 backend 分支，无 UI；部分桥层裁掉（`fetchRowDetail` 直接 `return null`，`ide-view-host.js:788-791`） |
| 审批/问卷富字段 | 审批只留 `toolName/callId/reason`（`:460-467`），问卷只取 `questions[0]`（`:469-477`），`multiSelect` 未处理 |
| 附件、交付物、Plan/Goal/Todo/Skill 卡片 | 无投影、无渲染器 |
| token delta 流式渲染 | frame 是快照式 |
| DSH 原生事件 allowlist 任意订阅、Electron IPC | 只消费过滤后的 frame/notice；IDE 跑在 VS Code Electron 外壳 |

**最关键的一条现状**（见 `DSH-IDE内容接收与ChatSession面板架构分析.md:14`）：**DSH 消息正文当前不显示**——`dshChatModelDriver.ts:6-7` 明确停用，节点模型没有对应的 DOM part；当前聊天列表渲染消费的是原生 `IChatViewModel`，不是 `DshChatNode`。这正是第 5 章翻译层要解决的核心问题。

---

## 3. 范围：要承接的官方聊天内容

依据 `docs/DSH-core内容进入桌面前端的全部入口.md` 第 4 节，按"官方零插件基线"取舍：

> **完整承接：§4.1、§4.2、§4.3、§4.4、§4.5、§4.6、§4.7、§4.9、§4.10。**
>
> **部分承接：§4.8 只取账号失效、模型登录、quota、必要凭据状态；§4.11 只取文件打开/外链/预览联动。**
>
> **不承接：完整设置页、插件市场/管理 UI、桌面原生 IPC、HMR/SSE。**

### 3.1 取舍总表

| 小节 | 内容类别 | 是否承接 | 承接方式 |
|---|---|---|---|
| §4.1 | 会话/消息正文 | 必须 | 结构化 conversation snapshot；节点树渲染 |
| §4.2 | 会话列表/元数据/搜索 | 必须 | list/search/loadOlder/loadThrough；切换、分页、搜索 |
| §4.3 | 工具调用与结果 | 必须 | `tool/call`、`tool/result` → 工具节点/树 |
| §4.4 | Deliverables | 必须 | 交付物数据 → 文件/交付物卡，VS Code opener 打开 |
| §4.5 | Attachments | 必须 | 提交带附件 ref、读取附件、消息图片展示 |
| §4.6 | 审批/问卷 | 必须 | 全字段 pending 卡；`answerApproval/answerQuestion` |
| §4.7 | 模型目录/选择 | 必须 | composer 全量投影；模型/effort/permission/preset |
| §4.8 | Settings/Credentials/Identity | 部分 | 登录过期、模型登录、账号通知、必要凭据状态 |
| §4.9 | 通知/进度/状态 | 必须 | session status、running/unread、quota、token usage |
| §4.10 | Plan/Goal/Todo/Skill | 必须 | 投影成列表/表格/计划卡 |
| §4.11 | 其它 UI 包群 | 最小子集 | 文件打开、外链、必要预览联动 |

### 3.2 必须完整承接的入口

**§4.1 会话/消息正文**：核心。接 opening snapshot、assistant stream frame、session entry、projections、cursor/hasMore、assistant revision/event seq。内核桥走官方 `session.follow`，投影成结构化 conversation，renderer 用 VS Code DOM 节点树渲染。

**§4.2 会话列表/元数据/搜索**：会话列表、元数据、新建/切换、搜索、历史分页、`resume/fork/rewind`、`loadThrough(seq)`。当前已有 `listSessions`、会话控制器、部分 `loadOlder`，缺 chat 内搜索、`loadThrough`、完整 resume/fork/rewind UI、`maxMessages`/`throughSeq` 参数暴露。

**§4.3 工具调用与结果**：`tool/call`、`tool/result`、tool delta、callId、工具状态、结果摘要、关联审批的 callId。投影成通用工具节点，用 VS Code tree/details 渲染；todo/skill 结构化结果归约到列表/表格卡。

**§4.4 Deliverables**：`deliverables/presented`、`workspace/changes`、`changes.summary`、`changes.diff/open`、`present.open/host`。投影成文件卡/变更卡/交付物卡，`openFile` 接 VS Code 编辑器/文件服务。

**§4.5 Attachments**：上传附件、消息图片、文件引用、prompt 与 receipt 绑定、历史附件读取。`submit` 带附件 ref，`readAttachment` 读取，图片用 DOM `<img>`/themed icon。协议已有 `DshIdeImageAttachmentRef`（`:109-122`），不重新发明。不接 DSH 拖动上传组件与 native clipboard/file IPC。

**§4.6 审批/问卷**：补全审批的 `toolName/callId/reason/displayReason/signal` 与决策；问卷的全部 `questions/options/multiSelect/id`；回答走现有 `answerApproval/answerQuestion`；UI 为确认/拒绝卡、问卷卡（多选）。

**§4.7 模型目录/选择**：看/切模型、effort、permission preset、team/agent preset，models/adapters 更新后刷新。当前只投影 4 组（model/permission/team/preset），需补 catalog 失效刷新、provider/model/effort 可靠选择、失败明确提示。用 VS Code quick pick/dropdown 承接，不接 DSH `/model` React popup。

**§4.9 通知/进度/状态**：`api-session/added/removed/status/error/activity`、running/pending/unread、assistant stream 状态、quota notice、token usage。补全 quota/account quota、model sign in required、running 头部稳定展示，错误不吞。

**§4.10 Plan/Goal/Todo/Skill**：plan/goal projection、todo、skill catalog、goal activation changed、skill remote verbs。投影成 Plan 计划卡、Goal 状态卡、Todo 列表/表格、Skill 行/详情卡；交互走 `ide/dispatch` 对应官方 remote。

### 3.3 部分承接

**§4.8 Settings/Credentials/Identity** — 只取影响聊天可用性的状态，在 chat 顶部/notice 区显示，不打开 DSH 设置页：

- `deepseek-account/session-expired`：登录过期提示。
- `deepseek-account/model-sign-in-required`：模型需额外登录。
- quota / account quota：额度拦截提示。
- credential reference 状态：判断模型/服务可用性。
- `settings/document-updated` 中与聊天有关的部分（展示模式、work-details mode、performance/usage）。

**§4.11 其它 UI 包群** — 最小联动：

| UI 包群 | 是否用 | 做法 |
|---|---|---|
| 工作区/文件 | 最小用 | 文件提及、打开文件、交付物路径打开；VS Code 文件服务/编辑器 |
| 文档预览 | 最小用 | DSH 生成/引用文档在 VS Code 编辑器打开，不接 DSH 预览侧栏 |
| 浏览器侧栏 | 最小用 | 外链用 `IOpenerService`，不接 DSH browser sidebar |
| 终端 / 工作区侧栏完整 UI | 不用 | VS Code 已有 |
| 插件管理/市场/遥测 UI | 不用 | 与 chat 容器无关 |

### 3.4 明确不承接

- DSH 完整设置页、凭据编辑页、插件管理/市场 UI。
- DSH Electron native IPC（window/store/update/locale/license/download/directory-picker）。
- DSH Web HMR/SSE `/plugins/events`。
- 非官方插件的独有 slot / UI 组件 / 数据形状，一律过滤。
- 独立 Cordis 根、第二套协议、第二个前端。

---

## 4. 改造方案（四层）

### 4.1 层 1：契约真源先行

文件：`src/vs/platform/dshClient/common/dshIdeProtocol.ts`

- 保持"契约先行"，先改协议真源再改实现。
- 把 opaque frame 升级为**结构化、带版本的会话视图载荷**。保留 `frame` 兼容字段，新增 typed 字段：`conversation`（nodes + turns + locatedTurns）、`deliverables`、`plan/goal/todo/skill` projections、`tokenUsageDelta`/`quotaNotice`、全量 `composer`、`attachments`、完整 `pending`。
- 形状变了必须 bump `DSH_IDE_WIRE_REVISION`（当前 3，`:26`）。
- 方法扩充以《DSH-IDE改造开发手册》§1.5 / §3.1 / §7 为准。`searchSessions`、`resume`、`fork.point`、`loadOlder.throughSeq` 已经存在，不另增 `resumeSession` / `forkAt` / `loadThrough`。
- 保持三条不变量：`exactRecord` 白名单、`version` 严格 +1、gap/倒退 fail-closed。

### 4.2 层 2：内核桥做完整投影

文件：

- `src/vs/platform/dshClient/host/ide-view-host.js`
- `src/vs/platform/dshClient/host/ide-service.js`
- `src/vs/platform/dshClient/electron-main/ide-view-service.ts`

原则：**不在 renderer 重写官方节点装配器**。复用官方 `ConversationNodeAssembler` / `chat-snapshot-builder` 在内核侧产出结构化 conversation，经 `ide/followSession` 下发，保证只有一套会话装配逻辑。

需补：

- 审批保留 `agent/signal/callId/reason/displayReason`（当前 `:460-467`）；问卷保留全部 `questions[]/multiSelect/id`（当前 `:469-477`）。
- `fetchRowDetail` 由 `return null`（`:788-791`）改为走官方 `session/page` 取真实全文。
- `runCommand` 传真实 attachments，去掉恒 `[]`（`:505,520`）。
- composer 从 4 组投影（`dshIdeComposer.js:33-38`）扩到官方全量。
- 非官方插件产生的、不属于官方基线的数据形状在此层过滤，不投影。
- 新 method handler 全部经内核 `dshCtx` 调官方服务；`ide-service.js` 的 `@Remote` 面（现 8 个，`:380-389`）不新增第二条传输通道。

### 4.3 层 3：renderer 状态层换成结构化会话

文件：

- `src/vs/workbench/contrib/dsh/browser/dshChatSession.ts`
- `src/vs/workbench/contrib/dsh/browser/dshChatModel.ts`

当前 `IDshChatSession` 只有 13 个方法（`:39-74`），需补：

- `submit(text, attachments)`、`addAttachment/removeAttachment`
- `resume/fork/rewind`、`search(query)`、历史分页（`loadOlder` / `throughSeq`）
- `deliverables()`、`plan()/goal()/skills()`、`tokenUsageDelta()`
- 全量 `pending()` 与多选支持

方法命名以《DSH-IDE改造开发手册》与层 1 契约为准，不另造 `forkAt` / `loadThrough` 别名。

移除 renderer 自己从裸 follow 帧拼节点的旧逻辑，直接消费层 1 的结构化会话视图。代码遵循 VS Code 风格：制表符、单引号、分号、`I` 前缀接口、`_` 前缀私有成员、`DisposableStore`/`this._register`、错误走 `onUnexpectedError`。

### 4.4 层 4：chat 视图接原生渲染（翻译层，非自绘）

目录：`src/vs/workbench/contrib/dsh/browser/` 及 chat contribution。

**核心**：恢复 `dshChatModelDriver.ts` 那条线，但做对一件事——把 `DshChatNode[]` **翻译**成原生 `ChatModel` 的 request/response + content kind，用原生 content part 显示。不改原生渲染器、不写新模具、不注册表。详细映射表与验收标准见第 5 章。

要点：

- 订阅 `DshChatSession.onDidChangeNodes`；
- 写翻译函数 `DshChatNode[] → IChatRendererContent[]`（对照 5.3 映射表）；
- 把翻译结果写进原生 ChatModel 的 response；
- 输入发送入口从原生 `IChatService.sendRequest()` 切到 `DshChatSession.submit()`；
- 附件走 `IChatAttachmentWidgetRegistry`；
- 图标替换见第 7 章。

### 4.5 门禁同步

- `build/lib/test/dshIdeEndpoints.test.ts`：当前钉死 method 数 30（`:100-108`）、listen 白名单 3 个（`:209-220`）、endpoint 断言表（`:46-94`）；扩能力后同步更新。
- 新增/修改代码通过 `tsc --noEmit` 与相关测试。
- 真机 GUI 验证由用户执行，AI 不代跑。

---

## 5. Chat / Session 面板改造详述（翻译层方案）

本章是本次讨论的核心产出：解释"两边渲染体系的差别是什么、为什么选翻译层、具体怎么映射、怎么验收、session 面板怎么改"。

### 5.1 两边渲染体系的本质差别

用"搭积木 vs 固定模具"来理解：

**DSH = 自由拼装（无限积木）**

DSH 用 React + slot 系统渲染聊天页。规则是"想显示一种新东西，写一个 React 卡片组件注册进 slot 就行"：

- 读文件工具 → 注册 `ReadRow`；运行命令 → `BashRow`；审批 → `ApprovalCard`；思考折叠 → `ReasoningRow`。
- keyed slot `conversation.chat.node`（按节点类型）、`tool.call.toolview`（按工具名）负责派发（`DSH聊天页面全量构成与插件显示机制.md:881-889`）。
- 卡片可任意嵌套、折叠、定制外观，因为每个卡就是一个 React 组件，组件里可以再放组件。

**VS Code = 固定模具（写死的抽屉）**

VS Code 的聊天渲染链是封闭的：

- VM item 只有三种：request / response / pending divider（`chatViewModel.ts:96`、`:386-388`）。
- 内容类型是封闭联合 `IChatRendererContent`（`chatViewModel.ts:203`），没有 `custom` / `part` 字段。
- 渲染是硬编码 `if (content.kind === '...')` 工厂（`chatListRenderer.ts:4568-4653`），未知 kind 落到 `renderNoContent`（`:4653`）。
- 全仓搜不到 `registerChatRenderer` / `IChatRenderer` / `registerContentPart` 注册表。

一句话：**DSH 想画什么画什么；VS Code 只能用提前定好的那几种模具，加新种类要改 VS Code 自己的代码。**

### 5.2 一个具体例子：审批卡

**在 DSH 里**：

```
收到 approval/request 事件
  → ui-approval 插件写一个 ApprovalCard（React 组件）
  → 注册到审批 slot
  → 界面出现一张审批卡，长什么样由插件决定
```

**在 DSH-IDE（VS Code 原生）里**：

```
收到审批数据
  → 判断是审批
  → 翻译成原生 confirmation kind（chatListRenderer.ts:4585）
  → 用 VS Code 已有的确认卡显示
```

显示出来是 **VS Code 风格的确认卡**，不是 DSH 的 `ApprovalCard`。这正是用户想要的（保留 VS Code 原生风格）。

### 5.3 翻译层映射表（DshChatNode → 原生 content kind）

这是要实现的全部映射。标"已接"的两项当前已工作，不用动；其余是翻译层要做的事。

| DSH-Core 入口内容 | DshChatNode / 数据 | 原生 content kind | 显示效果 | file:line |
|---|---|---|---|---|
| §4.1 正文 | `DshAssistantMessageNode` / `DshUserMessageNode` | `markdownContent` | 原生 Markdown 气泡 | `chatListRenderer.ts:4593` |
| §4.1 思考 | assistant block 里的 reasoning | `thinking` | 原生可折叠思考卡 | `:4638` |
| §4.3 工具调用 | `DshToolCallBlock` / `DshToolResultNode` | `toolInvocation` | 原生工具卡，自带展开 | `:4603` |
| §4.6 审批 | waterfall pending | `confirmation` | 原生确认卡，可点允许/拒绝 | `:4585` |
| §4.6 问卷 | waterfall pending | `questionCarousel` | 原生多选卡 | `:4615` |
| §4.7 模型/权限 | `composerState` | 原生模型选择器 | 已接（DshLanguageModelProvider） | `dshLanguageModelProvider.ts:131-170` |
| §4.4 变更文件 | deliverables | `changesSummary` / `multiDiffData` | 原生变更摘要 | `:4619` / `:4570` |
| §4.9 错误/状态 | `DshTurnErrorNode` | `errorDetails` / `warning` | 原生错误行 | `:4611` / `:4587` |
| §4.9 running | session status | `working` | 原生进度提示 | `:4577` |
| §4.10 Plan | plan projection | `planReview` | 原生计划卡 | `:4617` |
| §4.10 Todo | todo 工具结果 | 原生 todo 列表 | 原生列表 | `chatTodoListWidget.ts:59` |
| §4.5 附件 | attachment ref | `IChatAttachmentWidgetRegistry` | 原生附件 chip | `chatAttachmentWidgetRegistry.ts:35-43` |
| §4.2 会话列表 | `listSessions` | `DshAgentSessionsController` | 已接 | `dshAgentSessionsController.ts:75` |

### 5.4 为什么不做"注册表重构"

讨论中曾提出：把 VS Code 硬编码工厂改造成"内容部件渲染器注册表"（renderer registry / content part factory registry），使其像 DSH slot 一样可注册拼装。这在专业上叫"注册表 + 工厂方法模式"。

结论：**不做**。理由：

- 用户目标是"正确渲染各类消息、保留 VS Code 原生风格"，不是"像素级还原"或"插件可扩展"。
- 注册表是为"便于扩展新卡类型"服务的；本路线只承接固定的官方内容类型，映射表（5.3）写死即可，不需要运行时注册机制。
- 注册表要改 `chatViewModel.ts:203` 联合类型 + `chatListRenderer.ts:4568-4653` 工厂，属高侵入，破坏上游 diff。

因此采用最小方案：**只写翻译层，不动渲染器**。若将来用户改主意要"插件可扩展/像素还原"，再重新评估注册表。

### 5.5 验收标准：什么叫"正确渲染"

不是长得像，而是三条：

1. **不丢内容**：DSH 里有的消息、工具、审批、计划，IDE 里都出现（哪怕外观不同）。
2. **能交互**：审批能点、工具能展开、问卷能选，且操作能回传 DSH core（走 `answerApproval` / `answerQuestion` 等）。
3. **不串不卡**：滚动/重渲染不错位，断线时保持上次一致状态（现有 `DshIdeConsumer.fail-closed` 已保证）。

### 5.6 实施顺序（翻译层）

1. 恢复 `dshChatModelDriver.ts`，订阅 `DshChatSession.onDidChangeNodes`。
2. 写翻译函数 `DshChatNode[] → IChatRendererContent[]`（对照 5.3）。
3. 把翻译结果写进原生 `ChatModel` 的 response。
4. 发送入口从原生 `IChatService.sendRequest()` 切到 `DshChatSession.submit()`（`dshChatSession.ts:264-275` 已有实现，当前无 UI 调用方）。
5. 附件接 `IChatAttachmentWidgetRegistry`。
6. 逐类验收：正文 → 工具 → 审批 → 计划。
7. 跑 `tsc --noEmit` + 相关测试；真机 GUI 由用户验证。

### 5.7 Session 面板改造

**现状**：Session 面板已能工作。`DshAgentSessionsController` 把 `listSessions` 转成 `dsh` scheme 的 `IChatSessionItem`，原生 `AgentSessionsControl` 渲染，点击 rebind（`DSH-IDE内容接收与ChatSession面板架构分析.md:10.3`、`dshAgentSessionsController.ts:75,97-106`）。

**要改的缺口**（都是数据接线 + 控件替换，无渲染体系问题）：

| 缺口 | 改法 | 依据 |
|---|---|---|
| New Session 按钮名不副实 | 接到 `DshIdeSessionsService.createSession()`，当前只执行 `workbench.action.chat.open` | `chatViewPane.ts:904-912`、`dshIdeSessionsService.ts:99-110` |
| 会话图标是 `Codicon.comment` | 换 DSH 图标（见第 7 章） | `dshAgentSessionsController.ts:189-209` |
| 搜索 | 接 `searchSessions`，用原生 `AgentSessionsFilter` | `dshIdeSessionsService.ts:130-139` |
| running/unread 状态 | 已有 `onDidSessionNotice → applyRunning`，补 unread 展示 | `dshAgentSessionsController.ts:90-96` |
| 归档/恢复 | 接 `archiveSession` / `unarchiveSession` 到会话右键菜单 | 协议已有 method |

**两套会话链的取舍**：当前显示走 `DshAgentSessionsController → IChatSessionsService → AgentSessionsControl`；另有 `DshIdeSessionsService + DshIdeSessionListModel + DshClientSessionListSource` 完整链未被 UI 消费（`DSH-IDE内容接收与ChatSession面板架构分析.md:10.4`）。翻译层路线以 `DshAgentSessionsController` 为显示主链，用 `DshIdeSessionsService` 补 create/search/archive 等操作。

---

## 6. DSH 特有内容分级（对翻译层的影响）

按"VS Code 原生有没有对应模具"分级，决定哪些写新 kind、哪些复用、哪些放弃。

### 6.1 A 级：VS Code 完全没有，本轮放弃或降级

| DSH 特有 | 是什么 | 处理 | 出处 |
|---|---|---|---|
| TurnNavigator / TurnMark | 右侧虚拟 turn 导轨 | 放弃（纯装饰） | `DSH聊天页面全量构成与插件显示机制.md:240` |
| RunningWhaleTail + RunningStatus 动画 | 鲸尾运行动画 | 降级为原生 `working`，放弃动画 | 同上 `:245,335` |
| PixelWhale canvas | 首页鲸鱼逐帧动画 | 放弃（纯装饰） | 同上 `:202,332` |
| onboarding 全套步骤 | 首次引导 9 步 | 放弃（非聊天内容） | 同上 `:340,557-571` |
| ReviewTab 评审侧栏 | 右侧栏看 turn 前后 diff | 放弃（可用 diff 编辑器替代） | 同上 `:465` |
| ImageGallery / ImageLightbox | 图片画廊/大图灯箱 | 降级为原生图片展示 | 同上 `:360,446` |
| ContextMeter | 上下文用量条/环 | 可后续做，非 P0 | 同上 `:285` |
| TurnUsagePanel 明细 | token 用量明细 | 可后续做，非 P0 | 同上 `:244` |
| KaTeX 公式渲染 | 行内/块级公式 | 可后续做，非 P0；**注意不是 Mermaid** | 同上 `:640-645` |

### 6.2 B 级：VS Code 有近似模具，改一改（复用原生 kind）

| DSH 卡 | 原生模具 | 差别 |
|---|---|---|
| 思考折叠卡 `ReasoningRow` | `thinking`（`:4638`） | 原生已有折叠，DSH 分组标题更丰富 |
| 步骤分组 `ChatGroupSeat` | `ChatCollapsibleContentPart`（`:31`）+ 嵌套（`:3542-3563`） | 原生能嵌套，DSH 按 14 类活动组合文案 |
| 工具卡 12 种 | `toolInvocation`（`:4603`）+ `ToolDetails` | 原生通用工具卡，DSH 视觉不同（用户接受） |
| 审批卡 `ApprovalCard` | `confirmation`（`:4585`） | 原生无 DSH 警告条/始终允许 |
| 计划卡 `PlanCard` | `planReview`（`:4617`） | 原生有 plan，DSH 多 plan mode chip |
| 变更文件 `ChangedFiles` | `changesSummary`（`:4619`）+ `multiDiffData`（`:4570`） | 原生有聚合变更 |
| 问卷 `QuestionComposer` | `questionCarousel`（`:4615`） | 原生有多选轮播 |
| 附件 `FileCard/MessageImage` | `IChatAttachmentWidgetRegistry` | 原生有附件 chip 注册点 |

### 6.3 C 级：VS Code 已有，直接映射（工作量最小）

正文 Markdown → `markdownContent`（`:4593`）；代码块/diff → `codeBlockPart` / `DiffEditorPool`；用户消息 → request VM；错误/警告 → `errorDetails`（`:4611`）/ `warning`（`:4587`）。

### 6.4 重要澄清：Mermaid 不是 DSH 聊天页特性

之前草稿写过"保留 Mermaid"，需纠正：**DSH 聊天页 Markdown 不含 Mermaid，公式用 KaTeX**（`DSH聊天页面全量构成与插件显示机制.md:647`、附录 C `:1091`）。VS Code 自身的 Mermaid 支持要保留（AGENTS.md 构建约束），但不属于"要承接的 DSH 内容"；真正要从 DSH 搬的是 KaTeX，列为 A 级可后续项。

### 6.5 非卡片的特有内容（不进翻译层，但影响实现）

- **i18n**：DSH 100% 走 `t('key')`（`:503`），VS Code 用 `localize`。新代码文案用 `localize`，内容可参考 DSH 字典（`:526-588`）。
- **图标**：DSH 的 `dsw-icon-*` sprite 不引入，采用第 7 章全局 SVG mask 替换。
- **子智能体递归**：DSH `ToolCallTree` 递归子调用（`:393`），VS Code 也有 subagent part（`:4555`），折叠策略不同，属 B 级最复杂项。

---

## 7. 图标全局替换方案（改 getCSS + SVG mask）

用户明确："把所有图标换成 DSH 的，这个难也要做。" 本章给出系统方案，不去逐处改按钮。

### 7.1 现状与机制

**VS Code codicon = 字体字符**：

- `codicon.css:6-10`：`@font-face` 加载 `codicon.ttf`。
- `codicon.css:12-23`：`.codicon[class*='codicon-']` 用 16px codicon 字体渲染。
- codicon 的可见字形来自动态生成的 `::before content`（PUA 码点），由 `iconsStyleSheet.ts:52` 生成规则。

**DSH 图标 = SVG sprite**：

- `artwork.ts:22` 的 `ICON_ARTWORK` 定义每个 glyph 的 `svg: (strokeWidth) => string`。
- 描边风格（`<path stroke="currentColor">`），不是填充字形。
- DSH-IDE 当前**没有** `dsw-icon-*` sprite 注入代码，src 里只有 `dsh-whale.svg` 等少数品牌资产。

**全局单点**：所有 codicon CSS 都从 `getIconsStyleSheet().getCSS()` 生成，注入到 `<style id="codiconStyles">`（`workbenchThemeService.ts:187-196`、`iconsStyleSheet.ts:31-74`）。**改这一处即可全局替换，业务代码零改动。**

### 7.2 方案选择：SVG mask，不换字体文件

| 方案 | 做法 | 判断 |
|---|---|---|
| 换 `codicon.ttf` | SVG 转字体字形 | DSH 是 stroke 描边，字体是 fill 轮廓，转换易失真，不推荐 |
| **改 `getCSS()` 用 SVG mask（选定）** | `::before` 用 `mask-image: url(data URI)` | 直接用 DSH SVG 原样，stroke 正常，颜色跟主题，推荐 |

### 7.3 生成的 CSS 规则

`iconsStyleSheet.ts:52` 原本：

```css
.codicon-search:before { content: '\e???'; font-family: codicon; }
```

命中 DSH 映射时改为：

```css
.codicon-search:before {
  content: '';
  display: inline-block;
  width: 1em;
  height: 1em;
  background-color: currentColor;
  -webkit-mask: url("data:image/svg+xml,...") center / contain no-repeat;
  mask: url("data:image/svg+xml,...") center / contain no-repeat;
  vertical-align: middle;
}
```

两个关键细节：

1. **SVG 内联成 data URI**：`getCSS()` 返回的是注入 `<style>` 的字符串，写文件路径会按文档 URL 解析而失效，必须用 `data:image/svg+xml,...`。
2. **尺寸用 `1em` 不用固定 16px**：codicon 很多地方用 `font-size` 缩放图标，用 `1em` 才能继承缩放。

**为什么能跟随主题色**：SVG 作为 mask 只取 alpha 通道形成形状，实际颜色来自 `background-color: currentColor`，它继承按钮文字色，自动适配浅色/深色/高对比度主题（HC 需实测）。

### 7.4 实施步骤

1. **构建脚本**：从 `artwork.ts:22` 的 `ICON_ARTWORK` 读每个 glyph，用 `strokeWidth=1`（regular）生成 SVG → URL-encoded data URI，产出 `dshIconDataUris.ts`（`{ glyphName: dataUri }`）。这是复用官方资源，不手绘，符合 AGENTS.md 资源复用优先。
2. **映射表** `dshCodiconMap.ts`：`codicon id → DSH glyph`，如 `search→search-outline`、`plus→plus-outline`、`close→close-outline`、`copy→copy-outline`、`branch→branch-outline`、`check→check-outline`。只映射语义对得上的。
3. **改 `getCSS()`**：查映射，命中输出 mask 规则，未命中保留原字体规则（fallback）。用 `css.inline` + `css.stringValue` 保证 data URI 特殊字符正确编码。
4. **保留** `codicon.css:12-23` 的 `.codicon` 基础布局，只覆盖 `::before`。
5. **验证**：浅色/深色/高对比度主题 + spin 动画 + 不同 `font-size` 场景。
6. **门禁**：`tsc --noEmit` + 主题相关测试；改 `iconsStyleSheet.ts` 需同步 `dshIdeContract.ts:48-77` patch 点哈希。

### 7.5 必须接受的事实

- **混合状态**：codicon 有几百个（git/debug/scm/terminal…），DSH artwork 只有 100+ 个（聊天/会话/工具场景）。DSH 没有的图标保留 codicon 原样，最终是"DSH 图标 + 少量残留 codicon"，不是 100% 纯 DSH。
- **stroke 风格统一**：替换后整款产品图标观感统一变成 DSH 细线风格，包括 VS Code 原生按钮。
- **上游 diff**：改 `iconsStyleSheet.ts` 是核心文件，改动要最小化（只加查表分支），并同步契约门禁哈希。
- **高对比度**：mask + currentColor 通常跟随，但要实测 HC 主题与 spin 动画。

---

## 8. 实施顺序与优先级

**P0 — 聊天主闭环（不做则基本不可用）**

1. §4.1 会话/消息正文
2. §4.3 工具调用与结果
3. §4.6 审批/问卷
4. §4.7 模型目录/选择
5. §4.9 通知/进度/状态
6. §4.8 中登录过期/模型登录/quota 最小提醒

**P1 — 完整聊天页**

7. §4.2 会话列表/搜索/历史分页
8. §4.5 附件上传/读取/展示
9. §4.4 交付物展示/打开
10. §4.10 Plan/Goal/Todo/Skill

**P2 — 轻量联动**

11. §4.11 中文件打开、文档预览联动、外链打开、必要工作区路径解析。

**工程顺序**

1. 契约真源扩字段（层 1），同步 bump wire revision 与 endpoint 测试断言。
2. 内核桥投影结构化会话（层 2），复用官方 assembler，不重写第二套。
3. `DshChatSession` / `DshChatModel` 改消费结构化会话（层 3）。
4. 恢复翻译层（层 4）：`DshChatNode → IChatRendererContent`（见 5.6），输入切到 `submit()`。
5. Session 面板缺口接线（见 5.7）。
6. 图标全局替换（第 7 章）：构建脚本 → 映射表 → 改 `getCSS()` → 主题验证。
7. 每步跑 `tsc --noEmit` 和相关测试；真机 GUI 验证由用户执行。

---

## 9. 不变量与边界

- **身份**：bundle 插件、共用 `dshCtx`、唯一 `dshIde` 通道，不新建 Cordis 根/会话/协议。
- **契约**：契约先行；`exactRecord` 白名单、`version` 严格 +1、gap 倒退 fail-closed 三条不变量不动。
- **复用**：内核侧复用官方会话装配器；UI 复用 VS Code 原生 content part；图标复用 DSH 官方 artwork（第 7 章）；保留原许可证与版权头。
- **风格**：VS Code 既有约定（制表符、单引号、分号、`I`/`_` 命名、`DisposableStore`、`onUnexpectedError`）。
- **资源**：VS Code 自身 Mermaid / Markdown 支持完整保留（构建约束）；DSH 聊天页用 KaTeX 而非 Mermaid（见 6.4）；native 模块按 Electron 44.7.0 的 `NODE_MODULE_VERSION` 编译。
- **过滤**：非官方插件独有内容在内核桥层过滤，IDE 不感知、不告警。
- **视觉**：卡片保留 VS Code 原生风格，不像素级还原 DSH；图标按第 7 章全局替换为 DSH SVG（混合状态，DSH 无对应者保留 codicon）。

---

## 10. 待确认问题

- `rewind` 当前官方落点为 null（`build/lib/test/dshIdeEndpoints.test.ts:48-52`），本阶段是否必须实现？若必须，需先在 DSH 侧确认可用的官方 remote/事件，不能凭 IDE 侧臆造。
- §4.2 的 `resume/fork/rewind` 若官方基线本就不可用，IDE 侧是否只保留入口禁用态而不做实际调用？
