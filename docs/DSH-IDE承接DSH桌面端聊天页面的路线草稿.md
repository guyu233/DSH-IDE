# DSH-IDE 承接 DSH 官方聊天页面的路线草稿

> 本文为基于静态源码分析的路线草稿，不代表真机观测结论。所有 `file:line` 以分析时快照为准，定位时以实际文件为准。
>
> 分析日期：2026-11-16。
>
> 参考：`docs/DSH-core内容进入桌面前端的全部入口.md`、DSH 源码 `E:/deepseek-harness/`、当前 DSH-IDE 源码 `E:/DSH-IDE/src/`。

---

## 0. 最终决策与目标基线

### 0.1 选定路线

**在现有原生 chat 面板（`dshChatSession.ts` / `dshChatModel.ts`）上改造，只承接 DSH 源码内置的官方聊天内容。**

- 不用 WebviewView，不在 IDE 里跑 DSH Web renderer。
- 不做 slot 化，不做描述性 slot registry，不做规则表。
- 不扫描非官方插件资源，不做插件内容告警。
- 非官方插件产生的额外效果一律过滤，不在 IDE chat 中显示。

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
| 轻量 slot / 描述性 slot 投影 / 通用卡片规则表 | 放弃自动扩展，改为逐类写死 |

### 0.4 判别标准

三层都满足才算承接住：

1. **数据承接**：Host 侧拿到 DSH core 产生的官方内容。
2. **投影承接**：经唯一 `dshIde` 通道，以契约允许的形状送到 renderer。
3. **UI 承接**：IDE chat 视图把它渲染出来并提供交互。

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
- `forkAt(seq)` / `loadThrough(seq)`、`search(query)`、`resume/fork/rewind`
- `deliverables()`、`plan()/goal()/skills()`、`tokenUsageDelta()`
- 全量 `pending()` 与多选支持

移除 renderer 自己从裸 follow 帧拼节点的旧逻辑，直接消费层 1 的结构化会话视图。代码遵循 VS Code 风格：制表符、单引号、分号、`I` 前缀接口、`_` 前缀私有成员、`DisposableStore`/`this._register`、错误走 `onUnexpectedError`。

### 4.4 层 4：chat 视图补 UI

目录：`src/vs/workbench/contrib/dsh/browser/` 及 chat contribution。

按 §3 逐类写死渲染器（不做通用规则表）：附件缩略图/上传/移除、交付物与工作区变更卡、Plan/Goal/Todo/Skill 卡、reasoning 展开体、turn 级 token/usage 面板、quota notice、命令卡、完整审批/问卷（多选）。`forkAt`/`openFile`/`openExternal` 接 VS Code `IOpenerService` / `IWorkbenchFileService`。复用 codicons、主题样式、列表/树组件；Mermaid 与 Markdown 完整保留。

### 4.5 门禁同步

- `build/lib/test/dshIdeEndpoints.test.ts`：当前钉死 method 数 30（`:100-108`）、listen 白名单 3 个（`:209-220`）、endpoint 断言表（`:46-94`）；扩能力后同步更新。
- 新增/修改代码通过 `tsc --noEmit` 与相关测试。
- 真机 GUI 验证由用户执行，AI 不代跑。

---

## 5. 实施顺序与优先级

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
4. chat 视图按 §3 逐类补渲染器（层 4）。
5. 每步跑 `tsc --noEmit` 和相关测试；真机验证由用户执行。

---

## 6. 不变量与边界

- **身份**：bundle 插件、共用 `dshCtx`、唯一 `dshIde` 通道，不新建 Cordis 根/会话/协议。
- **契约**：契约先行；`exactRecord` 白名单、`version` 严格 +1、gap 倒退 fail-closed 三条不变量不动。
- **复用**：内核侧复用官方会话装配器；UI 复用 VS Code 组件与 codicons；保留原许可证与版权头。
- **风格**：VS Code 既有约定（制表符、单引号、分号、`I`/`_` 命名、`DisposableStore`、`onUnexpectedError`）。
- **资源**：Mermaid 与 Markdown 完整保留；native 模块按 Electron 44.7.0 的 `NODE_MODULE_VERSION` 编译。
- **过滤**：非官方插件独有内容在内核桥层过滤，IDE 不感知、不告警。

---

## 7. 待确认问题

- `rewind` 当前官方落点为 null（`build/lib/test/dshIdeEndpoints.test.ts:48-52`），本阶段是否必须实现？若必须，需先在 DSH 侧确认可用的官方 remote/事件，不能凭 IDE 侧臆造。
- §4.2 的 `resume/fork/rewind` 若官方基线本就不可用，IDE 侧是否只保留入口禁用态而不做实际调用？
