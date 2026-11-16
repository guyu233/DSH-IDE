# DSH-IDE 改造开发手册（第一阶段：承接 DSH 官方聊天页基线）

> 编写日期：2026-11-16。依据：`docs/DSH-IDE承接DSH桌面端聊天页面的路线草稿.md`（16:00 更新版）、本目录其余三份分析文档，以及只读核对的 DSH 源码 `E:/deepseek-harness`、DSH-IDE 源码 `E:/DSH-IDE/src/`。
>
> 本文是静态源码证据推导的实施方案，不是真机观测结论；所有 `file:line` 以快照为准，动手前复核。真机 GUI 验证由用户执行，AI 不代跑。

---

## 0. 最终决策与目标基线

### 0.1 选定路线（已替换旧版“轻量 slot”方案）

**在现有原生 chat 面板（`dshChatSession.ts` / `dshChatModel.ts`）上改造，只承接 DSH 源码内置的官方聊天内容。**

- 不用 WebviewView，不在 IDE 里跑 DSH Web renderer。
- **不做 slot 化，不做描述性 slot registry，不做规则表。**
- 不扫描非官方插件资源，不做插件内容告警。
- 非官方插件产生的额外效果一律在内核桥层过滤，不在 IDE chat 中显示，IDE 不感知也不告警。

### 0.2 唯一参照系

> **以“DSH 原版在不装任何非官方插件时，聊天页正常显示的内容”作为唯一参照系；这些内容在 DSH-IDE chat 面板里也要正常显示和使用。**

承接方式固定为：**Host 侧拿官方 event/projection 数据 → 写死投影 → 唯一 `dshIde` 通道 → IDE chat 写死渲染器**。

官方插件（approval / deliverables / tool 等 DSH 源码内置插件）贡献的 UI 通过它们在 Host 侧产生的**数据效果**承接，不运行它们的 React 组件；非官方插件的独有数据形状一律过滤。

### 0.3 明确不做（红线）

| 排除项 | 原因 |
|---|---|
| 非官方插件的 UI 效果 / 独有数据效果 | 超出目标基线，主动过滤 |
| 插件资源扫描 / `clientModules` 软依赖 / slot 名静态扫描 | 复杂度高，收益不在目标内 |
| Cordis inspect 活页面查询 slot / props | 需跑 client runtime，与选定路线冲突 |
| WebviewView 承载 DSH Web UI（重版 B） | 等于新建第二套前端运行时，放弃 |
| 轻量 slot / 描述性 slot 投影 / 通用卡片规则表 | **旧版手册中这部分已作废**，改为逐类写死 |

### 0.4 三层判别标准

1. **数据承接**：Host 侧拿到 DSH core 产生的官方内容。
2. **投影承接**：经唯一 `dshIde` 通道，以契约允许的形状送到 renderer。
3. **UI 承接**：IDE chat 视图把它渲染出来并提供交互。

三层都满足才算承接住。

### 0.5 与上一版手册的差异（本次更新要点）

| 维度 | 上一版手册（作废） | 本次更新 |
|---|---|---|
| 插件 UI | 描述性 slot 投影 + 通用卡片规则表 + manifest 扫描，新插件自动扩展 | **全部删除**；非官方插件过滤，官方插件只取数据效果，逐类写死 |
| 参照系 | “聊天闭环 + 轻量可扩展 slot” | “DSH 零非官方插件原版聊天页”唯一参照系 |
| 实施顺序 | 先做 `ui-approval` 轻量 B 样板，再扩规则表 | **无样板/无规则表**；按 §3 官方入口逐类写死 |
| 工程顺序 | 契约 → Host → renderer → UI → slot 样板 → 规则表扩展 | 契约 → Host → renderer → UI（四层，无 slot 阶段） |

---

## 1. 身份前提与架构基线

### 1.1 身份前提（不可动摇）

1. DSH-IDE 是 DSH 应用内的 bundle 插件，不是独立应用，不产出独立安装包，不新增第二 Cordis 根、第二套会话或第二套协议。
2. DSH-IDE 对 DSH 而言就是一个 Cordis 插件：跑在 DSH Host 进程、复用同一个 `dshCtx`，天然共享事件总线、session 服务、工具、审批、模型目录等 Host 侧能力。
3. DSH-IDE 内部为 VS Code 扩展保留的扩展宿主，是其作为 VS Code 外壳的内部层次，不是 DSH-IDE 相对 DSH 的身份。
4. Host 半身 / IDE 窗口之间只走官方客户端传输与唯一 `dshIde` 通道。

证据：`index.js:19` inject、`:29` `ctx.plugin`、`:54` `ctx.inject`；`ide-view-host.js:308-309`、`:317-325`；`ide-service.js:26-44`。

### 1.2 当前桥链路（不要重造）

```text
DSH Host（dshCtx）
  │ sessionController.follow / approval·question waterfall / api-session 事件
  ▼
Host 半身 ide-view-host.js（跟一次流、裁剪字段、method → 官方服务）
  │ ide-service.js @Remote ide.followSession / ide.dispatch
  ▼
DshIdeTransport（HTTP / WS 官方线协议 /api/remote.mux）
  ▼
electron-main: DshIdeViewService.receive（raw → waterfall / session-notice / frame）
  ▼
DshIdeChannel（listen 白名单 3 事件 + ctx 归属 + version 过滤；call 统一分发）
  ▼
DshClientService（原样转发，不校验）
  ▼
DshIdeConsumer（结构校验 + 连续性 + 16ms 合并，fail-closed）
  ▼
DshChatSession.accept / acceptWaterfall → DshChatModel（节点树）
```

关键文件：契约 `common/dshIdeProtocol.ts`、Host 桥 `host/ide-view-host.js`、帧分流 `electron-main/ide-view-service.ts`、transport `transport/dshIdeTransport.ts`、renderer 消费 `workbench/contrib/dsh/browser/dsh.contribution.ts:60-88`。

### 1.3 frame 与 typed 投影并存（wireRevision 4）

`DshIdeViewSnapshot` 仍保留 `frame: Readonly<Record<string, unknown>>`（`dshIdeProtocol.ts:86-100`）作为兼容字段，同时可带 11 个 typed 字段：`conversation`、`deliverables`、`attachments`、`plan`、`goal`、`todos`、`skills`、`tokenUsageDelta`、`quotaNotice`、`composer`、`pending`。字段全部可选；一旦出现，未知字段或未知节点种类 fail-closed 拒绝。

**当前实现已切到 typed 字段**（层 3 完成）：renderer 的 `DshChatModel.acceptConversation` 只吃 `conversation` 节点树，裸帧解析路径已删除（`accept(frame)` 为兼容空壳）。四条独立通路的状态：

- nodes：`DshIdeViewSnapshot.conversation` 的 `DshIdeConversationNode[]`（`dshIdeConversation.ts` 投影，Host 侧产出）；
- pending：快照 `pending` 字段（`waterfall` 仍用于运行中的增量帧）；
- modelMenu：仍走独立的 `composerState` 一元调用（`dshLanguageModelProvider`、`dshComposerSource`、`dshChatSession` 三条消费方在用，合并进快照属后续工作）；
- session 状态：独立 `subscribeSessionNotice`。

`ide-view-service.ts` 现在把 `conversation` / `deliverables` / `attachments` / `plan` / `goal` / `todos` / `skills` / `quotaNotice` / `pending` 一并挂到快照上。

### 1.4 当前承接能力

**能承接（层 1 已落地）：** `session/follow` 事件流（快照式）；`submit` 带图片附件（Host 写成官方 `{ type: 'image', attachment }`）；审批/问卷富字段投影（`displayReason`、`detail/header`、选项 `description`、`multiSelect`、`intent`，`dshIdeRequestView.js`）；waterfall 阶段状态；`listSessions`/`searchSessions`/`resume`/`fork.point`/`loadOlder{throughSeq,beforeSeq,maxMessages}`；模型/effort/权限/团队/preset 投影；开窗绑定会话。

**不能承接（改造目标，层 4 已逐类补齐）：** 协议已定义但 Host 未填的 typed 字段——**现已全部有 Host 来源**（见 §8.11）；4 个无官方 remote 的 `missing()` method（`addAttachment`、`removeAttachment`、`openInApp`、`dismissQuotaNotice`，见 §1.5）明确失败；`fetchRowDetail` 明确抛 `FEATURE_UNAVAILABLE`（官方无对应只读端点）；`runCommand` 附件已支持图片；chat 逐类写死渲染器——**现已全部落地**（见 §8.12–§8.18）。

### 1.5 协议现状（改动前记住这些数字）

- `DSH_IDE_WIRE_REVISION = 4`（`dshIdeProtocol.ts`）。保留 `frame` 并增加 typed 投影后，由 3 升到 4。
- `DshIdeMethodArgs` 共 **36 个 method**。相对动手前的 30 个，新增且 Host 仍 `missing()` 的是 `addAttachment`、`removeAttachment`、`setGoal`、`listSkills`、`openInApp`、`dismissQuotaNotice`。
- 旧稿点名要新增的 `searchSessions` / `resumeSession` / `forkAt` / `loadThrough` **不另增**：`searchSessions` 与 `resume` 已在白名单；`fork.point` 已映射官方 `atSeq`；`loadOlder.throughSeq` 已是官方切点。
- `validateDshIdeSnapshot`（`:755-778`）、`assertSnapshotContinuity`（`:797-816`，version 严格 +1）、`validateDshIdeInvokeOutput` 只允许 `{value}`（`:592-596`）。
- `DshIdeWaterfallNotice`（`:671-706`）、`DshIdeSessionNotice`（`:667-669`）形状固定；扩展 listen 事件面必须先改契约并同步测试（`:209-221`）。
- consumer 当前只处理 snapshot，测试钉死不处理 waterfall（`dshIdeEndpoints.test.ts:301-312`）。

---

## 2. 范围：要承接的官方聊天内容

依据 `docs/DSH-core内容进入桌面前端的全部入口.md` 第 4 节，按“官方零插件基线”取舍：

> **完整承接：§4.1、§4.2、§4.3、§4.4、§4.5、§4.6、§4.7、§4.9、§4.10。**
>
> **部分承接：§4.8 只取账号失效、模型登录、quota、必要凭据状态；§4.11 只取文件打开/外链/预览联动。**
>
> **不承接：完整设置页、插件市场/管理 UI、桌面原生 IPC、HMR/SSE。**

### 2.1 取舍总表

| 小节 | 内容类别 | 是否承接 | 承接方式 |
|---|---|---|---|
| §4.1 | 会话/消息正文 | 必须 | 结构化 conversation snapshot；节点树渲染 |
| §4.2 | 会话列表/元数据/搜索 | 必须 | `listSessions`/`searchSessions`/`loadOlder{throughSeq,beforeSeq,maxMessages}`/`resume`/`fork.point`；切换、分页、搜索 |
| §4.3 | 工具调用与结果 | 必须 | `tool/call`、`tool/result` → 工具节点/树 |
| §4.4 | Deliverables | 必须 | 交付物数据 → 文件/交付物卡，VS Code opener 打开 |
| §4.5 | Attachments | 必须 | 提交带附件 ref、读取附件、消息图片展示 |
| §4.6 | 审批/问卷 | 必须 | 全字段 pending 卡；`answerApproval/answerQuestion` |
| §4.7 | 模型目录/选择 | 必须 | composer 全量投影；模型/effort/permission/preset |
| §4.8 | Settings/Credentials/Identity | 部分 | 登录过期、模型登录、账号通知、必要凭据状态 |
| §4.9 | 通知/进度/状态 | 必须 | session status、running/unread、quota、token usage |
| §4.10 | Plan/Goal/Todo/Skill | 必须 | 投影成列表/表格/计划卡 |
| §4.11 | 其它 UI 包群 | 最小子集 | 文件打开、外链、必要预览联动 |

### 2.2 必须完整承接的入口

**§4.1 会话/消息正文**：核心。接 opening snapshot、assistant stream frame、session entry、projections、cursor/hasMore、assistant revision/event seq。内核桥走官方 `session.follow`，投影成结构化 conversation，renderer 用 VS Code DOM 节点树渲染。

**§4.2 会话列表/元数据/搜索**：会话列表、元数据、新建/切换、搜索、历史分页、`resume`/`fork.point`/`rewind`（rewind 见 §8 待确认）、`loadOlder.throughSeq`。协议已有 `listSessions`/`searchSessions`/`loadOlder{throughSeq,beforeSeq,maxMessages}`/`resume`/`fork.point`，Host 已按官方 `atSeq` 与 `session/page` 实现，缺的是 chat 内搜索/历史分页 UI 接线；不另造 `loadThrough`/`forkAt`/`resumeSession`。

**§4.3 工具调用与结果**：`tool/call`、`tool/result`、tool delta、callId、工具状态、结果摘要、关联审批的 callId。投影成通用工具节点，用 VS Code tree/details 渲染；todo/skill 结构化结果归约到列表/表格卡。

**§4.4 Deliverables**：`deliverables/presented`、`workspace/changes`、`changes.summary`、`changes.diff/open`、`present.open/host`。投影成文件卡/变更卡/交付物卡，`openFile` 接 VS Code 编辑器/文件服务。

**§4.5 Attachments**：上传附件、消息图片、文件引用、prompt 与 receipt 绑定、历史附件读取。`submit` 带附件 ref，`readAttachment` 读取，图片用 DOM `<img>`/themed icon。协议已有 `DshIdeImageAttachmentRef`（`:109-122`），不重新发明。不接 DSH 拖动上传组件与 native clipboard/file IPC。

**§4.6 审批/问卷**：审批视图保留 `toolName/callId/reason/displayReason`；问卷保留 `id/question/detail/header/options[].label/description/multiSelect/intent`。`agent` 对象与 `AbortSignal` 不进线协议（`agentId` 在通知信封、`signal` 留在 Host 等待句柄）。回答走 `answerApproval/answerQuestion`，多选答案是 `DshIdeQuestionAnswer.answers[].selected` 多项；UI 为确认/拒绝卡、问卷卡。

**§4.7 模型目录/选择**：看/切模型、effort、permission preset、team/agent preset，models/adapters 更新后刷新。当前只投影 4 组（model/permission/team/preset），需补 catalog 失效刷新、provider/model/effort 可靠选择、失败明确提示。用 VS Code quick pick/dropdown 承接，不接 DSH `/model` React popup。

**§4.9 通知/进度/状态**：`api-session/added/removed/status/error/activity`、running/pending/unread、assistant stream 状态、quota notice、token usage。补全 quota/account quota、model sign in required、running 头部稳定展示，错误不吞。

**§4.10 Plan/Goal/Todo/Skill**：plan/goal projection、todo、skill catalog、goal activation changed、skill remote verbs。投影成 Plan 计划卡、Goal 状态卡、Todo 列表/表格、Skill 行/详情卡；交互走 `ide/dispatch` 对应官方 remote。

### 2.3 部分承接

**§4.8 Settings/Credentials/Identity** — 只取影响聊天可用性的状态，在 chat 顶部/notice 区显示，不打开 DSH 设置页：

- `deepseek-account/session-expired`：登录过期提示。
- `deepseek-account/model-sign-in-required`：模型需额外登录。
- quota / account quota：额度拦截提示。
- credential reference 状态：判断模型/服务可用性。
- `settings/document-updated` 中与聊天有关的部分（展示模式、work-details mode、performance/usage）。

**§4.11 其它 UI 包群** — 最小联动：工作区/文件（文件提及、打开文件、交付物路径打开）；文档预览（在 VS Code 编辑器打开，不接 DSH 预览侧栏）；浏览器侧栏（外链用 `IOpenerService`）；终端/工作区侧栏完整 UI、插件管理/市场/遥测 UI 不接。

### 2.4 明确不承接

- DSH 完整设置页、凭据编辑页、插件管理/市场 UI。
- DSH Electron native IPC（window/store/update/locale/license/download/directory-picker）。
- DSH Web HMR/SSE `/plugins/events`。
- 非官方插件的独有 slot / UI 组件 / 数据形状，一律过滤。
- 独立 Cordis 根、第二套协议、第二个前端。

---

## 3. 四层改造路线（按顺序落地）

顺序不可颠倒：**契约 → Host 投影 → renderer 状态 → UI**。每步都跑 `tsc --noEmit` 与相关测试；测试失败先修，不把 PENDING 当 PASS。

### 3.1 层 1：契约真源先行

文件：`src/vs/platform/dshClient/common/dshIdeProtocol.ts`。

1. 保持 `frame` 兼容字段，同时新增 typed 字段：`conversation`、`deliverables`、`attachments`、`plan` / `goal` / `todos` / `skills`、`tokenUsageDelta`、`quotaNotice`、`composer`、`pending`。字段可缺省；出现则必须命中白名单。**这一步已落地**（`wireRevision` 4）。
2. `DshIdeMethodArgs` / `DSH_IDE_METHOD_KEYS` 的扩充以动手前复核为准，不重复添加已有方法：
   - `submit` 增加可选 `attachments: DshIdeImageAttachmentRef[]`（已落地，Host 把它们写成官方 `image` content）；
   - `answerQuestion.answer` 收成官方 `AskUserQuestionAnswer`（`selected: string[]`，多选就是多项）；
   - `answerApproval` 增加可选 `agentId` / `callId`。`Agent` 对象和 `AbortSignal` 不进线协议：`agentId` 已在通知信封上，`signal` 留在 Host 等待句柄里；审批视图另保留 `displayReason`（已落地，`dshIdeRequestView.js`）；
   - 尚无核对到官方 remote、Host 保持 `missing()` 的：`addAttachment`、`removeAttachment`、`openInApp`、`dismissQuotaNotice`（`setGoal` / `listSkills` 已按官方 `goals` / `skills` 服务接线，见 §8.15）；
   - **不新增** `searchSessions`、`resumeSession`、`forkAt`、`loadThrough`（见 §1.5）。
3. 形状变化已经把 `DSH_IDE_WIRE_REVISION` 升到 4，并同步了 `validateDshIdeView` / `validateDshIdeSnapshot` / `assertSnapshotContinuity`。
4. 三条不变量：`exactRecord` 白名单（拒绝未知字段与显式 `undefined`，`:306-324`）、`version` 严格 +1、gap/倒退 fail-closed。
5. 门禁已改到 36 个 method。listen 白名单仍是 snapshot / waterfall / session-notice 这 3 个事件。

**本层完成标志（已实测，2026-11-16）**：协议/通道/waterfall/Host 桥测试 PASS（133），dshIdeConsumer 与 endpoints 本轮断言 PASS。`src/tsconfig.json` 全量 `tsc --noEmit` 仍 FAIL，但报错在既有 VS Code 文件里，本轮改过的协议文件无类型错误——不把既有 FAIL 记成 PASS。

### 3.2 层 2：内核桥投影（Host 侧）

文件：`src/vs/platform/dshClient/host/ide-view-host.js`、`ide-service.js`、`electron-main/ide-view-service.ts`、`common/dshIdeComposer.js`。

**原则：复用官方 Host 侧数据，写死投影；非官方插件的独有数据形状一律过滤。**

具体修点：

1. 审批的 `displayReason` 已由 `dshIdeRequestView.js` 保留；层 2 要把它连同 `toolName/callId/reason` 一起填进 typed `pending`（`agent`/`signal` 仍不进协议）。
2. 问卷的 `detail/header/options[].description/multiSelect/intent` 已由 `dshIdeRequestView.js` 保留；层 2 要把它填进 typed `pending` 并支持多选答案。
3. `fetchRowDetail` 从 `return null`（`:788-791`）改为走官方取真实全文/行详情。
4. `runCommand` 传真实附件，去掉恒 `[]`（`:505,520`）。
5. composer 从 4 组投影扩到官方全量（`common/dshIdeComposer.js:6-39`），并订阅 `llm/models-updated`、`permission-presets/catalog-changed` 等失效事件刷新（新增 listen 必须先改契约）。
6. 新增 method handler 全部经 `dshCtx` 调官方服务；`@Remote` 面（`ide-service.js:375-391`）不新增第二条传输通道。
7. `ide-view-service.receive`（`:190-235`）从裸帧 publish 扩为按 typed 视图分流后 publish；waterfall / session-notice 仍走各自订阅，不混进内容帧。
8. 非官方插件过滤：只白名单官方 event/projection 名与官方数据形状；未知 contributor 的独有字段不投影、不转发、不告警。

**本层完成标志**：官方零插件聊天页的每类内容都能在 Host 侧拿到并投影成层 1 定义的 typed 形状；非官方插件额外效果在 Host 侧被丢弃。

### 3.3 层 3：renderer 状态层换成结构化会话

文件：`src/vs/workbench/contrib/dsh/browser/dshChatSession.ts`、`dshChatModel.ts`。

1. `IDshChatSession`（`:39-74`）接口按契约 36 method 对齐：`submit(text, attachments)`、`answerApproval/answerQuestion`（多选答案）、`listSessions/searchSessions/loadOlder{throughSeq,beforeSeq,maxMessages}`、`resume`/`fork.point`/`rewind`（rewind 落点见路线草稿 §7 待确认，本手册 §8.2）、`deliverables`、`plan/goal/todos/skills`、`tokenUsageDelta`、`quotaNotice`、`pending`。对 4 个无官方 remote 的 `missing()` method 只暴露禁用态或明确失败提示，不伪造成功。
2. 移除 renderer 从裸 follow 帧拼节点的逻辑（`dshChatModel.ts:388-403,516-941`），直接消费层 1 的结构化 conversation。
3. `tokenUsage` 唯一真源在 `DshChatModel`（`:318-320,375-386`），`pending` 在 `DshChatSession.pendingItems`（`:86`），`running` 在 `_running`（`:89`）；扩展时**保持单一真源**。
4. 风格：tab、单引号、分号、`I` 接口前缀、`_` 私有、`this._register`/`DisposableStore`，错误走 `onUnexpectedError`。

**本层完成标志**：chat 状态层不再依赖裸帧拼装，所有官方内容都有单一真源。

### 3.4 层 4：chat 视图容器补 UI

目录：`src/vs/workbench/contrib/dsh/browser/` 及 chat contribution。

逐类写死渲染器（**没有通用 slot 规则表**）：

| 内容 | UI 落点 |
|---|---|
| 正文 / assistant 增量 | 启用 `DshChatNode → IChatViewModel` 桥接（`dshChatModelDriver.ts:6-7` 当前停用），通过 ChatListWidget/ChatListItemRenderer 或新 provider 渲染 |
| 工具调用/结果 | 工具节点/树/详情卡，复用 VS Code tree/details |
| 审批/问卷 | 确认/拒绝卡、问卷卡（多选），查询状态走 `answerApproval/answerQuestion` |
| 附件 | composer 附件缩略图/上传/移除；历史图片 DOM `<img>`/`readAttachment` |
| 交付物 | 变更文件/已呈现文件卡，接 VS Code opener |
| Plan/Goal/Todo/Skill | 计划卡、目标状态条、Todo 列表、Skill 行/详情卡 |
| token/usage/quota/account notice | chat 头部 running + token usage 面板 + 顶部 notice 区 |
| 模型/effort/permission/preset | composer 区 quick pick/dropdown |
| 会话切换/搜索/历史 | 会话控制器 quick pick、chat 内搜索、`loadOlder{throughSeq,beforeSeq,maxMessages}` |
| 最小联动 | 文件打开、外链（`IOpenerService`）、预览联动 |

三个关键接线点：

1. 启用 `DshChatNode → IChatViewModel` 桥接（`dshChatModelDriver.ts:6-7` 明确停用）。
2. `ChatWidget.acceptInput()` 发送目标切到 `DshChatSession.submit()`（当前无 UI 调用，`dshChatSession.ts:264-275`；原生链路 `chatWidget.ts:3415-3479`）。
3. New Session 接 `DshIdeSessionsService.createSession()`（当前 `chatServiceImpl.ts:407-413` 只执行 `workbench.action.chat.open`，`dshIdeSessionsService.ts:98-110` 有 createSession 未接）。

复用 VS Code 既有 codicons、主题样式、列表/树组件；Mermaid 与 Markdown 完整保留。

**本层完成标志**：DSH 零非官方插件基线里聊天页正常显示的内容，在 IDE chat 中有对应的写死渲染器与交互。

### 3.5 门禁同步

- 测试入口：`package.json:85-94` 的 `build-dsh-tests`、`test-dsh`、`test-dsh:all`、`verify:dsh-ide-*`、`verify:dsh-ide-ci`；`dshIdeEndpoints.test.ts` 在 `test-dsh:all` 显式列表内。
- 每次提交前跑：`tsc --noEmit`（`node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit -p src/tsconfig.json`）+ `npm run test-dsh:all` + 相关 verify 门禁。
- 提交信息写清「做了什么 / 门禁实测结果 / 未完成项」；PENDING 不计入通过；真机验证由用户执行。

---

## 4. 非官方插件数据过滤规则

更新后的路线明确：**非官方插件的额外效果在内核桥层过滤，IDE 不感知、不告警。**

过滤边界：

| 位置 | 规则 |
|---|---|
| Host 桥事件订阅 | 只订阅白名单内的官方 event/projection 名；未收录的 event/projection 名直接丢弃 |
| Host 桥 method dispatch | 只转发官方 `dshCtx` 服务方法；非官方插件注册的 remote 方法不转发 |
| 内核桥 frame 投影 | 只投影官方 conversation/tool/approval/deliverables/attachment/plan/goal/todo/skill 数据形状；额外字段（`contributor` 等）在白名单投影时丢弃 |
| renderer | 不渲染未知形状；收到未知 typed 字段直接走 fail-closed（协议校验拒绝） |
| 告警 | 不向用户提示非官方插件效果被过滤，因为目标基线是“零非官方插件” |

实现方式：在投影函数里用 `exactRecord` 白名单构造返回值，而非 `...spread` 整个事件对象；不匹配官方形状的事件/projection 返回 `null`/跳过。

---

## 5. 交付冻结契约（本项目余下工作只剩 chat 视图容器前端改造）

> 这一章是硬性要求：**层 1（契约）+ 层 2（Host 投影）+ 层 3（renderer 状态层）必须全部完成并冻结后，才把工作交给 chat 视图容器前端改造。** 交付时下游只需要写渲染器和绑定 view，不再触碰协议、通道、Host 桥、会话状态模型。

### 5.1 冻结边界：前端改造只允许改这些文件

交付后，chat 容器前端改造只允许新增/修改 chat 视图容器与渲染器文件（例如 `workbench/contrib/dsh/browser/` 下的 view/renderer 及 `dshChatModelDriver.ts` 的启用接线），**不得再改**：

- `src/vs/platform/dshClient/common/dshIdeProtocol.ts` 及契约校验（`dshIdeContract.ts`、`dshIdeEndpoints.test.ts`）；
- `src/vs/platform/dshClient/host/*`（`ide-view-host.js`、`ide-service.js`、投影函数）；
- `src/vs/platform/dshClient/electron-main/ide-view-service.ts`、`dshIdeChannel.ts`；
- `src/vs/workbench/contrib/dsh/browser/dshChatSession.ts`、`dshChatModel.ts`（层 3 状态层已冻结）；
- `dshIdeConsumer.ts`（消费与合并逻辑已冻结）。

若前端改造中发现上述冻结文件必须改，说明本手册的层 1–3 没做完整，退回补齐，不得在前端绕过。

### 5.2 层 1 冻结条件（契约已完成，不再变）

1. `DSH_IDE_WIRE_REVISION = 4` 固定；冻结后非全局重开不允许再 bump。
2. `DshIdeViewSnapshot` 的 11 个 typed 字段（`conversation`、`deliverables`、`attachments`、`plan`、`goal`、`todos`、`skills`、`tokenUsageDelta`、`quotaNotice`、`composer`、`pending`）形状锁定；前端按这些类型写渲染器，不再等字段变更。
3. 36 个 `DshIdeMethodArgs` 锁定；4 个无官方 remote 的 `missing()` method 语义锁定为「调用即 `FEATURE_UNAVAILABLE`」，前端按禁用态处理，不期待它们成功（`setGoal` / `listSkills` 已接线，见 §8.15）。
4. 三条不变量（白名单、`version` 严格 +1、fail-closed）和 listen 白名单 3 事件冻结。

### 5.3 层 2 冻结条件（Host 投影已完成，不再变）

1. **follow 帧 → `conversation` 的投影由 Host 完成**：renderer 收到的 snapshot 里 `conversation.nodes` 已是官方装配后的节点数组（`user/steering/context/assistant/tool-call/tool-result/command/compaction/model-retry/turn-error/turn-max-tokens/inherited-history/subagent-catalog/subagent-notice`），前端只管画，不再从裸 frame 拼。
2. **其余 typed 字段由 Host 填齐**：`deliverables`、`attachments`、`plan`、`goal`、`todos`、`skills`、`tokenUsageDelta`、`quotaNotice`、`composer`、`pending`；字段缺省只能表示「该会话没有此内容」，不能表示「Host 还没实现」。
3. **审批/问卷的富字段投影冻结**：`displayReason`、`detail/header/description/multiSelect/intent` 已在 typed `pending` 里；`agent`/`signal` 永久不进协议。
4. **`fetchRowDetail` 不再返回 `null`**（或明确文档化为官方不可用并给禁用态）；`runCommand` 不再传恒空附件。
5. **非官方插件过滤冻结**：白名单外的 event/projection 在 Host 丢弃，前端不会收到未知形状。
6. `ide-view-service.receive` 把 typed 视图连同 `frame` 一起 publish；`frame` 只是兼容回退，前端稳定路径不依赖它。

### 5.4 层 3 冻结条件（renderer 状态层已完成，不再变）

1. `DshChatSession` / `DshChatModel` 已改成消费 typed 字段，`DshChatModel.accept()` 直接从 `snapshot.conversation` 建节点树，不再解析裸帧。
2. 四类独立通路已合并到 typed 字段和统一 state：`nodes`（conversation）、`pending`、`composer`（modelMenu）、session notice；前端通过统一会话状态读取，不再各自订阅裸事件。
3. 单一真源明确：`tokenUsage` 在模型层、`pending` 在会话层、`running` 在会话层；前端只读，不再累加或二次推导。
4. `IDshChatSession` 暴露前端所需的全部读接口与 36 method 的调用入口（含 4 个禁用）；接口冻结后前端只调用，不改签名。
5. `DshIdeConsumer` 已把 16ms 合并、version 连续性、fail-closed 处理完，前端不再做协议校验。

### 5.5 冻结验收（移交前端前的 gate）

移交前必须同时满足：

- `tsc --noEmit`：本轮改动涉及的协议/Host/renderer 状态层文件零类型错误；若全量 `tsc` 因既有 VS Code 文件失败，记录在案但不阻塞移交（不得写成 PASS）。
- 测试：协议、通道、waterfall、Host 桥、dshIdeConsumer、endpoints 全 PASS；新增的 typed 投影往返测试全 PASS。
- `test-dsh:all` 登记完整；若 `dshSlotRegistry.test.ts` 仍未登记，按 §0.3 不接回 slot 路线，保持未登记并记录（不因为 slot 遗留测试阻塞本路线）。
- 真机界面显示仍属前端改造完成后的用户验证项，AI 不代跑。

### 5.6 前端改造的最终输入（前端只需要这些）

冻结后，chat 视图容器前端拿到的稳定输入只有：

- `DshIdeViewSnapshot` 的 11 个 typed 字段（§5.2）；
- `DshChatSession` / `DshChatModel` 的只读接口（§5.4）；
- 36 个 `ide/dispatch` method 的调用入口，其中 32 个可用、4 个禁用态（§5.2）。

前端不需要也不允许知道：裸 follow 帧形状、官方 event 名、Host 服务名、投影函数、wireRevision、channel 白名单、version 合并。

---

## 6. 验收与防回归

### 6.1 验收三层

1. **数据承接**：Host 侧拿到官方 event/projection 数据。
2. **投影承接**：经唯一 `dshIde` 通道，wireRevision/version/channelId 正确，fail-closed 生效。
3. **UI 承接**：IDE chat 用写死渲染器显示并提供交互。

三层都满足才算承接住。

### 6.2 关键不要清单

- 不要新建第二 Cordis 根 / 第二套会话 / 第二套协议。
- 不要让 renderer 直连 `session/*`、`modelCatalog`、`settings` 等官方端点；只经 `ide/dispatch`。
- 不要新增 IPC / HTTP / WS / SSE 通道。
- 不要在 IDE 跑 React slot / 加载插件 UI bundle / 做规则表或 manifest 扫描。
- 不要扫描非官方插件资源，不要显示插件内容告警。
- 不要在 renderer 重写官方节点装配；不要多处累加 token usage / pending / running。
- 不要伪造数据：未核对 method 以 `FEATURE_UNAVAILABLE` 明确拒绝；断线只发 rebuild 状态，不推伪造内容。
- 不要删除或改写许可证凭据：`PROVENANCE.md` 四份 + `LICENSE-DSH` 两份 + `NOTICE.md` / `LICENSE.txt`。

### 6.3 建议实施顺序

1. 契约扩字段 + bump revision + 同步测试。
2. Host 官方数据投影 + 非官方过滤。
3. renderer 状态层改消费结构化 conversation。
4. chat UI 逐类写死渲染器。
5. 每步跑 `tsc --noEmit` + 相关测试；真机验证由用户执行。

---

## 7. 附录：关键文件索引

| 类别 | 文件 |
|---|---|
| 契约真源 | `src/vs/platform/dshClient/common/dshIdeProtocol.ts` |
| Host 桥 | `host/ide-view-host.js`、`ide-service.js` |
| composer 投影 | `common/dshIdeComposer.js` |
| 帧分流 | `electron-main/ide-view-service.ts` |
| 唯一通道 | `electron-main/dshIdeChannel.ts` |
| transport/开窗 | `transport/dshIdeTransport.ts`、`dshIdeLaunchListener.ts` |
| renderer 总装 | `workbench/contrib/dsh/browser/dsh.contribution.ts` |
| 帧消费 | `workbench/contrib/dsh/browser/dshIdeConsumer.ts` |
| 聊天状态 | `workbench/contrib/dsh/browser/dshChatSession.ts`、`dshChatModel.ts` |
| 停用的 driver | `workbench/contrib/dsh/browser/dshChatModelDriver.ts` |
| 会话控制器 | `workbench/contrib/dsh/browser/dshAgentSessionsController.ts` |
| 未接 UI 的会话链 | `workbench/contrib/dsh/browser/dshIdeSessionsService.ts`、`dshIdeSessionListModel.ts` |
| Chat 容器 | `workbench/contrib/chat/browser/chatParticipant.contribution.ts` |
| Chat 面板 | `workbench/contrib/chat/browser/widgetHosts/viewPane/chatViewPane.ts` |
| 门禁测试 | `build/lib/test/dshIdeEndpoints.test.ts` |

---

## 8. 第一轮已落地（2026-11-16）

层 1 契约和它直接带着走的投影已经进代码。层 2 其余投影、层 3、层 4 还没做。

已落地：

- `DshIdeViewSnapshot` 在 `frame` 之外接受官方 typed 投影；未知 kind / 未知字段 fail-closed。
- 审批投影保留 `displayReason`；问卷投影保留 `detail` / `header` / `description` / `multiSelect` / `intent`。`agent` 与 `signal` 继续不进线协议。
- `submit` 可带图片附件，Host 按官方 `{ type: 'image', attachment }` 交给 `sessionController.prompt`。
- 尚无官方 remote 的四个 method 在契约里，Host 显式 `missing()`（`setGoal` / `listSkills` 已接线，见 §8.15）。

尚未落地（下一轮按层 2 继续）：

- Host 把 follow 帧投影成 `conversation`，并填 `deliverables` / `plan` / `goal` / `todos` / `skills` / `tokenUsageDelta` / `quotaNotice` / `composer` / `pending`。
- `fetchRowDetail` 仍返回 `null`；`runCommand` 的附件仍是空数组。
- renderer 仍从裸 `frame` 拼节点。chat UI 还没有逐类写死渲染器。

### 8.1 本轮门禁实测（如实记录）

| 项 | 结果 |
|---|---|
| 协议、通道、waterfall、Host 桥测试 | **PASS**（133） |
| `dshIdeConsumer` 与 endpoints 本轮相关断言 | **PASS** |
| `src/tsconfig.json` 全量 `tsc --noEmit` | **FAIL**，报错在既有 VS Code 文件；本轮改过的协议文件无类型错误 |
| `dshIdeEndpoints.test.ts`「每个 dsh 测试都登记进 `test-dsh:all`」 | **FAIL**，既有 `dshSlotRegistry.test.ts` 未登记；slot 路线已取消，本轮不接回 |

门禁状态只允许 PASS / PENDING / FAIL；以上 FAIL 原样记录，不写成 PASS，也不因 slot 遗留测试阻塞本路线（见 §5.5）。

### 8.2 手册与代码的一致性

- 手册 §1.5 / §3.1 / §7 的 method 列表以代码为准：`searchSessions`、`resume`、`fork.point`、`loadOlder.throughSeq` 本就在，不另增 `resumeSession`/`forkAt`/`loadThrough`。
- 下一轮从层 2 开始：Host 把 follow 帧投影成 `conversation` 和其余 typed 字段（`attachments` 也需随快照下发）。渲染器和逐类 UI 在层 2、层 3 完成后做（见 §5 交付冻结契约）。
- 真机界面显示由用户验证，AI 不代跑。

### 8.3 第二轮已落地（2026-11-16，层 2 起步）

本轮按 §3.2 在 Host 侧把 follow 内容帧投影成结构化会话：

- 新增 `src/vs/platform/dshClient/common/dshIdeConversation.ts`：`createDshIdeConversationState()` + `projectDshIdeConversation()`，覆盖 `snapshot` / `event` / `assistant-stream` 三类内容帧。
- 节点集合严格落在协议白名单内：`user` / `steering` / `context` / `assistant` / `tool-call` / `tool-result` / `command` / `compaction` / `model-retry` / `turn-error` / `turn-max-tokens` / `inherited-history` / `subagent-catalog` / `subagent-notice`。
- 子代理两处事实按官方形状投影：`subagent/catalog`（`subagent/src/catalog.ts` 的 version 0–3 字段）落 `subagent-catalog`；`user/message` 且 `source.kind` 为 `subagent-settled` / `agent-message` 落 `subagent-notice`。
- `electron-main/ide-view-service.ts` 在 `open` / `rebind` / `close` 重置投影状态；`receive()` 对内容帧附带 `conversation`，投影抛错时只发裸 `frame`，不把坏形状送进通道。
- 投影节点不携带 `raw`，显式 `undefined` 一律省略，未知事件不产生可见节点。

**本轮门禁实测（如实记录）：**

| 项 | 结果 |
|---|---|
| `build/lib/test/dshIdeConversation.test.ts` | **PASS**（5） |
| `dshIdeConversation` + `dshIdeChannel` + `dshIdeProtocol` 三文件联跑 | **PASS**（60） |
| `src/tsconfig.json` 全量 `tsc --noEmit` | **FAIL**，报错仍在既有 VS Code 文件（`argv.ts`、`tunnelProxy.ts`、`chat/**` 等）；本轮新增/修改文件无类型错误 |

### 8.4 第三轮已落地（2026-11-16，层 2 继续）

- 新增 `src/vs/platform/dshClient/common/dshIdeProjections.ts`：`projectDshIdeProjections(baseline)` 从官方 `SessionProjectionBaseline{asOfSeq, values}` 里读 `plan` / `goal` / `todos`，产出快照 typed 字段。
- `electron-main/ide-view-service.ts` 的 `snapshot` 帧附带上述投影字段；`pending` 由 waterfall 通知按 `eventId` 聚合（request 加入、cancel 移除），每帧随快照下发；`open` / `rebind` / `close` 一并清空。
- 明确一条语义红线：官方 `tokenUsage` 投影是**整个会话的累加值**，协议 `tokenUsageDelta` 是**单次调用增量**，两者不可互相顶替；累加值不写入该字段，单次增量由 `assistant` 节点携带。
- 子智能体复核（按模型目录分工）发现并修正两处问题：`projections` 基线未取 `.values` 导致字段读不出；把会话累加 `tokenUsage` 误当增量。

**本轮门禁实测（如实记录）：**

| 项 | 结果 |
|---|---|
| `build/lib/test/dshIdeProjections.test.ts` | **PASS**（6） |
| `dshIdeProjections` + `dshIdeConversation` + `dshIdeChannel` 联跑 | **PASS**（36） |
| 四文件联跑（含 `dshIdeProtocol`） | **PASS**（66） |
| `src/tsconfig.json` 全量 `tsc --noEmit` | **FAIL**，报错在既有 VS Code 文件；本轮新增/修改文件零类型错误（首轮报的只读属性赋值已修） |

尚未落地（层 2 余下）：`deliverables` / `attachments` / `skills` / `quotaNotice` / `composer` 的 Host 投影；`fetchRowDetail` 仍返回 `null`；`runCommand` 附件仍为空数组。层 3、层 4 未动。

### 8.5 第四轮已落地（2026-11-16，层 2 收尾）

- `deliverables`：`dshIdeConversation.ts` 收集官方 `deliverables/presented`（`tool-present/src/types.ts:15`），按 seq 累计，`deliverablesOf()` 供通道读取；view service 每帧随快照下发。
- `quotaNotice`：只在 `turn/end` 且 `reason.kind === 'error'`、`reason.error.code` 为 `QUOTA` / `ACCOUNT_QUOTA` 时记录（依据 `ui-chat/src/client/apply.ts:108-116` 的唯一来源），`quotaNoticeOf()` 供通道读取。
- `skills`：`listSkills` 从 `missing()` 改为真调官方 `skills.list({ scope: sessionId })`（`skill/src/index.ts:473`；scope 用法对齐 `ui-skill/src/client/index.ts:129`），只投影 `name` / `description` / `whenToUse` / `modelInvocable` / `userInvocable` / `provider`，不带绝对路径。
- `runCommand` 附件：契约加可选 `attachments`（逐项按 `ImageAttachmentRef` 校验），Host 经 `attachments.readImage()` 取出字节转成官方 `CommandSubmitAttachment`（`{type:'image'} & EncodedImageAttachment`，`commands/src/types.ts:14-17`、`attachment/src/types.ts:85-92`）后传给 `commands.execute(agent, line, submitted, signal)`（`commands/src/index.ts:360-366`）；取不到字节明确 `FEATURE_UNAVAILABLE`，不伪造。
- `composer`：确认已由 `composerState` 独立通道服务（`dshLanguageModelProvider.ts`、`dshComposerSource.ts`、`dshChatSession.ts` 三处消费），本轮不改其通路；合并到快照属层 3。

**本轮门禁实测（如实记录）：**

| 项 | 结果 |
|---|---|
| `build/lib/test/dshIdeConversation.test.ts` | **PASS**（8） |
| `build/lib/test/dshIdeProtocol.test.ts` | **PASS**（31，含新增 runCommand 附件用例） |
| 投影/会话/协议/通道四文件联跑 | **PASS**（69） |
| 含 Host 桥与 consumer 的六文件联跑 | **PASS**（153） |
| `dshIdeEndpoints.test.ts` 的「每个 dsh 测试都登记进 `test-dsh:all`」 | **FAIL**，仅 `dshSlotRegistry.test.ts` 未登记；slot 路线已取消（§0.3、§5.5），沿用既有记录，不接回 |
| `src/tsconfig.json` 全量 `tsc --noEmit` | **FAIL**，报错在既有 VS Code 文件；本轮新增/修改文件零类型错误 |

**子智能体复核记录（按模型目录分工）：**

- `glm-5.3-flash` 复核 deliverables / skills：实现与官方一致，未发现字段错位。
- `hy4flash` 复核 runCommand 附件：四参顺序、`CommandSubmitAttachment` 形状、失败拒绝均正确；指出 `runCommand.args` 的 token 约束比官方 `parseCommand` 更严——按 token 传参、单空格拼接是本路线既定的注入防护设计（§8.10.10 前置①②），`['a','b']` 与官方 `'a b'` 得到同一行，属有意收紧，不是能力缺失。
- `hy4flash-free` 复核接线：`pending` 聚合、`snapshot` 投影字段、`open`/`rebind`/`close` 重置均正确。

仍未落地（层 2 真正剩余）：`attachments` 字段的 Host 投影；`fetchRowDetail` 仍返回 `null`（官方无对应只读端点，按 §5.3 第 4 条需文档化为不可用并给禁用态）。层 3、层 4 未动。

### 8.6 第五轮已落地（2026-11-16，层 2 收尾完成）

- `attachments`：`dshIdeConversation.ts` 新增 `attachmentsOf(state)`，从已投影的 `user` / `context` / `subagent-notice` 节点 content 里收集图片引用并按 `attachmentId` 去重；view service 每帧随快照下发。官方没有「会话附件列表」投影键，消息 content 里的引用是唯一 durable 来源。
- `fetchRowDetail`：从 `return null` 改为明确 `FEATURE_UNAVAILABLE`。官方没有对应的只读「行详情」端点，按手册 §5.3 第 4 条给禁用态，不把「没有实现」伪装成「没有内容」。Host 桥测试同步改为断言该错误码。
- 层 2 的 11 个 typed 字段至此全部有 Host 侧来源：`conversation` / `deliverables` / `attachments` / `plan` / `goal` / `todos` / `skills` / `tokenUsageDelta` / `quotaNotice` / `composer` / `pending`。其中 `composer` 仍走既有 `composerState` 独立通道（三条消费方在用），合并进快照属层 3。

**本轮门禁实测（如实记录）：**

| 项 | 结果 |
|---|---|
| `build/lib/test/dshIdeConversation.test.ts` | **PASS**（9） |
| `build/lib/test/dshIdeProjections.test.ts` | **PASS**（8，含 skills/pending/tokenUsageDelta 正向断言） |
| `src/vs/platform/dshClient/test/host/ideViewHost.test.mjs` | **PASS**（76，含 listSkills 两条用例） |
| 投影/会话/协议/通道/waterfall/consumer/Host 桥七文件联跑 | **PASS**（160） |
| `src/tsconfig.json` 全量 `tsc --noEmit` | **FAIL**，报错在既有 VS Code 文件；本轮新增/修改文件零类型错误 |

**子智能体验收审计（按模型目录分工，`layer2-acceptance`）：**

- `glm-5.3-flash` 审计 11 个 typed 字段的 Host 来源。
- `hy4flash` 审计测试覆盖，指出五个缺口：`skills` 无投影结果校验、`tokenUsageDelta` 缺正向断言、`composer` 无投影断言、`pending` 无投影断言、`listSkills` 无 Host 用例。
- `hy4flash-free` 审计接线。
- 已按审计补齐：`listSkills` 两条 Host 用例（含 scope 用法与失败拒绝）、`skills`/`pending`/`tokenUsageDelta` 的协议校验断言。`composer` 未加投影断言，因为它走独立 `composerState` 通道、本就不进快照（层 3 才合并）。

### 8.7 第六轮已落地（2026-11-16，层 3 起步：renderer 改消费 typed 字段）

- `DshIdeConsumerState` 增加 `view`（完整 `DshIdeViewSnapshot`），`frame` 保留为兼容回退；`reset()` 一并清空。
- `DshChatModel.acceptConversation(conversation)`：直接吃 Host 投影好的 `DshIdeConversationNode[]`，只做节点类型机械映射，不再解析裸帧、不再自己拼装。身份键与裸帧路径一致（命令按 `commandId`，其余按 `seq`），保证 `loadOlder` 前插与流式接管不错位。
- `DshChatSession.acceptView(view)`：有 `conversation` 走结构化路径，没有才退回 `frame`；`pending` / `deliverables` / `attachments` / `quotaNotice` 以 typed 字段为唯一真源，暴露 `pendingItemsView()` / `deliverables()` / `attachments()` / `quotaNotice()` 只读接口。
- `dsh.contribution.ts` 的接线从 `_chat.accept(state.frame)` 改为 `_chat.acceptView(state.view)`——这是层 3 的关键断点，此前 typed 字段在消费者层就被丢掉了。

**本轮门禁实测（如实记录）：**

| 项 | 结果 |
|---|---|
| `build/lib/test/dshIdeConsumer.test.ts` | **PASS**（8，含 typed view 保留断言） |
| `build/lib/test/dshChatModel.test.ts` | **PASS**（31，含 acceptConversation 三条用例） |
| 消费者/模型/会话/投影/协议/通道/Host 桥七文件联跑 | **PASS**（188） |
| `src/tsconfig.json` 全量 `tsc --noEmit` | **FAIL**，报错在既有 VS Code 文件；本轮新增/修改文件零类型错误（含 `out/` 重建后复跑） |

层 3 起步时的遗留项（已在第七轮收尾删除）：`DshChatModel` 的裸帧解析路径。

**子智能体复核（`layer3-review`，按模型目录分工）发现并已修正的缺陷：**

- `hy4flash` 指出 typed 路径三处下游缺口：`firstSeq()` 只读 `rawEvents` → `loadOlder` 游标失真；`located()` 只读 `rawEvents` → 定位退化；`tokenUsage()` 只在裸帧路径累加 → typed 路径用量条恒空。
- 修法：`firstSeq()` 同时扫描已投影节点（跳过 `stream:` 合成节点）；`located()` 在无坐标时回退到节点自带的 turn/step；`acceptConversation()` 从 assistant 节点的 `usage` 累加。
- `hy4flash-free` 指出 `DshChatSession.accept()` 已成生产死代码，已删除，避免双入口漂移。
- `hy4flash` 另指出 `acceptPending` 每帧都 fire；已加变更检测，内容不变不重画。`bind()` 换会话时同步清空 typed 字段。

**复核后补充门禁：**

| 项 | 结果 |
|---|---|
| `build/lib/test/dshChatModel.test.ts` | **PASS**（33，含 typed 路径 firstSeq/usage/located 用例） |
| 消费者/模型/会话/投影/协议/通道/waterfall/Host 桥八文件联跑 | **PASS**（194） |

### 8.8 第七轮已落地（2026-11-16，层 3 收尾：删除裸帧解析）

按手册 §5.4 第 1 条完成层 3 冻结：

- `DshChatModel` 删除 `applySnapshot` / `applyDurable` / `applyStream` / 流式 attempt 合并 / `rawEvents` 等裸帧解析主体（约 450 行），模型层只剩结构化节点路径。
- `accept()` 保留为兼容入口但不再解析裸帧：传入裸帧一律返回空变更，并新增测试钉死该行为。
- `prependPage()` 改为用 Host 同一套 `projectDshIdeConversation` 把分页记录投影成 typed 节点再并入；去重改为按已加载节点的 seq 判重。
- `firstSeq()` / `located()` 改为纯节点来源（不再依赖 `rawEvents`）；`tokenUsage()` 由 `acceptConversation` 从节点 `usage` 累加。
- 协议 `DshIdeLoadOlderPage` 增加可选 `conversation` 字段（为后续 Host 侧整页投影预留），`validateDshIdeLoadOlderResult` 同步校验。
- `dshChatModel.test.ts` 整体重写：原 28 个裸帧用例改为「投影器 + acceptConversation」等价覆盖，保留 19 个用例。

**本轮门禁实测（如实记录）：**

| 项 | 结果 |
|---|---|
| `build/lib/test/dshChatModel.test.ts` | **PASS**（19） |
| 模型/消费者/会话/投影/协议/通道/waterfall/Host 桥八文件联跑 | **PASS**（180） |
| `src/tsconfig.json` 全量 `tsc --noEmit` | **FAIL**，报错在既有 VS Code 文件；本轮新增/修改文件零类型错误（含 `out/` 重建后复跑） |

层 3 已冻结。`DshChatSession` / `DshChatModel` 只消费 typed 字段，`DshIdeConsumer` 负责合并与 fail-closed，前端拿到的是 §5.6 规定的稳定输入。

### 8.9 第八轮已落地（2026-11-16，层 4 起步：补上会话内容提供者）

层 4 第一个关键断点已接上——**「选中会话后消息不显示」的根因是 `dsh` 会话类型只注册了 item controller，没有 content provider**。

- 新增 `dshChatSessionContent.ts`：`DshChatSessionContentProvider` 向 `IChatSessionsService` 注册 `dsh` 会话类型的内容提供者，`provideChatSessionContent` 先 `bind(sessionId)` 再产出 `IChatSession`。
- 新增 `dshChatHistory.ts`：纯函数 `toHistory()` 把 `DshChatNode[]` 折成原生 `IChatSessionHistoryItem[]`（用户消息开 request，助手/工具/错误内容进 response）。独立成零 UI 依赖模块，便于单测直接跑。
- `dshChatSessionContent.ts` 的 `DshChatSessionContent` 跟随 `onDidChangeNodes` / `onDidChangeHistory` 增量刷新 history；`submit()` 直接走 `DshChatSession.submit`。
- `dsh.contribution.ts` 注入 `IChatSessionsService` 并注册该 provider。

**本轮门禁实测（如实记录）：**

| 项 | 结果 |
|---|---|
| `build/lib/test/dshChatSessionContent.test.ts` | **PASS**（6，history 映射） |
| 内容/模型/消费者/会话/投影/协议/通道/waterfall/Host 桥九文件联跑 | **PASS**（186） |
| `src/tsconfig.json` 全量 `tsc --noEmit` | **FAIL**，报错在既有 VS Code 文件；本轮新增/修改文件零类型错误 |

层 4 尚未落地（手册 §3.4 余下项）：`ChatWidget.acceptInput()` 发送目标切到 `DshChatSession.submit()`（当前仍走原生 chat 链路）；New Session 接 `DshIdeSessionsService.createSession()`；审批/问卷卡、附件、交付物、计划/目标/Todo/Skill、token/额度提示、模型选择、会话切换/搜索/历史的逐类渲染与交互。

**子智能体复核（`layer4-review`，按模型目录分工）发现并已修正的缺陷：**

- `hy4flash-free` 指出 `provideChatSessionContent` 在 `await session.bind()` 期间被取消时：`bind` 对共享单例的副作用不可回滚，且抛出的是普通 `Error('cancelled')` 而非框架期待的 `CancellationError`。
- 修法：取消判定提前到 `bind` 之前；`bind` 之后仍取消的，统一抛 `CancellationError`（`base/common/errors.ts:226`），让上层按取消语义处理而不是记成错误。
- `glm-5.3-flash` 与 `hy4flash` 分别核了 provider 契约与 history 映射，未发现其它事实问题；`hy4flash` 同时核对了 `DshChatNode` 联合类型的覆盖完整性。

**复核后门禁：**

| 项 | 结果 |
|---|---|
| 内容/模型/消费者/会话/投影/协议/通道/Host 桥八文件联跑 | **PASS**（182） |
| `src/tsconfig.json` 全量 `tsc --noEmit` | **FAIL**，报错在既有 VS Code 文件；`dshChatSessionContent.ts` / `dshChatHistory.ts` / `dsh.contribution.ts` 零类型错误 |

### 8.10 第九轮已落地（2026-11-16，层 4 接线：发送入口与新建会话）

层 4 的两个关键接线点按 §3.4 接上：

- **发送入口**：`ChatWidget._acceptInput` 在调用 `chatService.sendRequest` 之前先问 `_dshSessionContentForSubmit`。会话类型注册了 content provider 且内容对象带 `submit` 时，直接走 `submit(text)`（最终是 `DshChatSession.submit`）；原生会话、无 `submit`、取内容失败三种情况一律退回原链路，不把一次发送变成硬失败。
- **New Session**：`dsh.contribution.ts` 覆盖 common 层只「打开聊天面板」的 `dsh.newSession`，改为调用 `DshIdeSessionsService.createSession()`，成功后 `bind` 新会话再打开。
- `DshIdeSessionsService` 补 `registerSingleton`（此前只声明了装饰器，注入会失败）。

**本轮门禁实测（如实记录）：**

| 项 | 结果 |
|---|---|
| `build/lib/test/dshChatSubmitRouting.test.ts` | **PASS**（4，分流判定） |
| 分流/内容/模型/消费者/会话/投影/协议/通道/Host 桥九文件联跑 | **PASS**（186） |
| `src/tsconfig.json` 全量 `tsc --noEmit` | **FAIL**，报错在既有 VS Code 文件；本轮改动文件零类型错误（`chatWidget.ts` 的两条 TS6133 经 stash 对比确认为改动前既有） |

层 4 尚未落地：审批/问卷卡、附件、交付物、计划/目标/Todo/Skill、token/额度提示、模型选择、会话切换/搜索/历史的逐类渲染与交互（§3.4 表余下行）。

**子智能体复核（`layer4-wiring-review`，按模型目录分工）发现并已修正的缺陷：**

- `hy4flash` 首轮报「命令覆盖时序不保证」，复核启动链路后自行撤回：`ChatService` 由 `ChatForegroundSessionCountContribution`（同为 AfterRestored）经 `IChatWidgetService` 提前实例化，旧 handler 先注册，新的后注册且 `CommandsRegistry` unshift 到头部，覆盖确定生效。
- `hy4flash` 保留的真缺陷：`dsh.newSession` 里 `await this._chat.bind(...)` 不检查结果，`bind` 内部 `rebindView` 失败时静默 return，命令仍无条件打开聊天视图——用户会看到空白/旧会话且无提示。
- 修法：`DshChatSession.bind()` 改为返回 `Promise<boolean>`；`dsh.newSession` 绑定失败时 `notifications.warn` 并中止打开；`dshChatSessionContent.provideChatSessionContent` 绑定失败时抛错，避免原生面板显示空会话。

**复核后门禁：**

| 项 | 结果 |
|---|---|
| 分流/内容/模型/消费者/会话/投影/协议/通道/Host 桥九文件联跑 | **PASS**（186） |
| `src/tsconfig.json` 全量 `tsc --noEmit` | **FAIL**，报错在既有 VS Code 文件；本轮改动文件零类型错误 |

### 8.11 第十轮已落地（2026-11-16，层 4：审批 / 问卷卡承接）

- `dshChatHistory.ts` 的 `toHistory(session, pendingItems)` 新增待决议项渲染：待决议卡**并进最后一条 response**（`warning` 标题 + `command` 按钮）。
  - 为什么不能单开一条 response：原生 chat 把历史恢复出来的 response 标为 `isStale`（`chatModel.ts:1607`），陈旧 response 里的命令按钮会被禁用（`chatCommandContentPart.ts:31`），卡片会点不动。
- 审批卡两个按钮：`dsh.answerApproval(eventId, 'approve' | 'reject')`；问卷卡每个选项一个 `dsh.answerQuestion(eventId, label)` 按钮。
- `dshChatSessionContent.ts` 新增 `registerDshAnswerCommands()`：两个命令真的调 `DshChatSession.answerApproval` / `answerQuestion`，**不重发 prompt**；`DshChatSessionContent` 同时订阅 `onDidChangePending`，待决议项变化即时刷新 history。
- 刻意没有复用原生 `IChatConfirmation`：它的点击处理器固定走 `chatService.sendRequest`（`chatConfirmationContentPart.ts:57`），会把一次审批变成一条新的用户消息，语义错误。
- 核对过 `IChatCommandButton` 的参数传递：`chatCommandContentPart.ts:53` 用 `executeCommand(command.id, ...(command.arguments ?? []))` 展开，事件 id 与选项都能到命令。

**本轮门禁实测（如实记录）：**

| 项 | 结果 |
|---|---|
| `build/lib/test/dshChatSessionContent.test.ts` | **PASS**（10，含审批/问卷 pending 渲染与挂靠位置） |
| 分流/内容/模型/消费者/会话/投影/协议/通道/waterfall/Host 桥十文件联跑 | **PASS**（194） |
| `src/tsconfig.json` 全量 `tsc --noEmit` | **FAIL**，报错在既有 VS Code 文件；本轮改动文件零类型错误 |

层 4 尚未落地：附件（composer 上传/移除/历史图片）、交付物卡、计划/目标/Todo/Skill 卡、token/额度提示、模型选择下拉、会话切换/搜索/历史分页的逐类 UI。

### 8.12 第十一轮已落地（2026-11-16，层 4：交付物 / 计划 / Goal / Todo / Skill / 额度）

- `dshChatHistory.ts` 扩展 `DshHistoryExtras`：`plan` / `goal` / `todos` / `skills` / `quotaNotice` / `attachments` / `deliverables` 全部进 history。
- 交付物：每个 present 调用一条 response，文件用 `reference` 部件（`IChatContentReference`，`chatService.ts:149-161`），由 VS Code 打开器接管，可点开文件。
- 计划 / 目标 / Todo / 技能 / 额度：并进最后一条 response（`info` / `warning` / `markdownContent`）；Todo 用 `[x]` / `[-]` / `[ ]` 标记状态。
- 额度提示用 `warning` 部件，Todo 用 markdown 列表，避免自造部件类型（`IChatProgress` 是封闭联合）。
- `DshChatSession` 新增 `onDidChangeExtras` 事件：`acceptView` 更新 typed extras 后触发，content 据此重建 history。

**本轮门禁实测（如实记录）：**

| 项 | 结果 |
|---|---|
| `build/lib/test/dshChatSessionContent.test.ts` | **PASS**（13，含交付物/额度/Todo/计划/目标） |
| 分流/内容/模型/消费者/会话/投影/协议/通道/waterfall/Host 桥十文件联跑 | **PASS**（197） |
| `src/tsconfig.json` 全量 `tsc --noEmit` | **FAIL**，报错在既有 VS Code 文件；本轮改动文件零类型错误 |

层 4 尚未落地：模型选择下拉（`composerState` 已有数据源，需接 composer 控件）、会话切换/搜索/历史分页 UI、附件上传/移除交互。

**子智能体复核（`layer4-extras-review`，按模型目录分工）发现并已修正的缺陷：**

- `hy4flash-free` 指出 `acceptView` 每帧无条件 fire extras，且渲染层无判重 → 每个 applied 快照至少两次全量 `toHistory`（`nodes()` 每次全量排序重建）。
- 修法：`acceptView` 对 `deliverables` / `attachments` / `quotaNotice` 做内容比较，只有真的变化才 fire `onDidChangeExtras`。
- `hy4flash-free` 另指出 `bind()` 清空 extras 时没有通知，复用同一共享会话的 content 会一直显示旧交付物。已补 `_onDidChangeExtras.fire()`。
- `glm-5.3-flash` 核交付物 reference、`hy4flash` 核部件 kind，未返回结构化结论。

**复核后门禁：**

| 项 | 结果 |
|---|---|
| 分流/内容/模型/消费者/会话/投影/协议/通道/Host 桥九文件联跑 | **PASS**（193） |
| `src/tsconfig.json` 全量 `tsc --noEmit` | **FAIL**，报错在既有 VS Code 文件；本轮改动文件零类型错误 |

### 8.13 第十二轮已落地（2026-11-16，层 4：权限 / 预设选项组）

- `dshAgentSessionsController` 实现 `getNewChatSessionInputState`：把 DSH 的权限预设与 agent 预设暴露为原生聊天输入框的 `IChatSessionProviderOptionGroup`（权限组带 `kind: 'permissions'`，直接进原生权限选择器）。
- 这是 `dshComposerProjection.toPermissionItems` / `observeModes` 的**首个生产调用方**——此前它们是死代码，权限与预设选择器在原生输入框里根本不出现。
- 写回：controller 订阅 `IChatSessionsService.onDidChangeSessionOptions`，只处理 `dsh` scheme 的变更，路由到 `DshComposerSource.selectPermission` / `selectPreset`。
- 顺带修掉 `dshComposerSource.ts` 里 `selectEffort` 与 `selectPreset` 挤在同一行的格式问题。
- 模型目录本身已由 `dshLanguageModelProvider`（`toLanguageModel`）进原生模型选择器，本轮不动。

**本轮门禁实测（如实记录）：**

| 项 | 结果 |
|---|---|
| `build/lib/test/dshComposerOptions.test.ts` | **PASS**（2，权限项映射） |
| 选项/分流/内容/模型/消费者/会话/投影/协议/通道/Host 桥十文件联跑 | **PASS**（195） |
| `src/tsconfig.json` 全量 `tsc --noEmit` | **FAIL**，报错在既有 VS Code 文件；本轮改动文件零类型错误 |

层 4 尚未落地：会话切换/搜索/历史分页 UI、附件上传/移除交互、模型选择器的 DSH 风格菜单（`dshModelMenu.ts` 仍无调用方，原生选择器已可用）。

**子智能体复核（`layer4-options-review`，按模型目录分工）：**

- `glm-5.3-flash` 核选项组契约、`hy4flash` 核写回链路、`hy4flash-free` 核生命周期与注册顺序；该轮三路均未返回结构化结论。
- 主智能体自行核对：`selectPermission` / `selectPreset` 写回后只 `refresh()` 刷新状态，不会反向触发 `onDidChangeSessionOptions`，无写回环路；`setPermissionPreset` 的 `preset` 参数名与契约一致（`dshIdeProtocol.ts:388,531,754-756`）；`kind: 'permissions'` 只有权限组一个使用者，符合「每个 provider 至多一个」的约束。

### 8.14 第十三轮已落地（2026-11-16，层 4：会话搜索 quick pick）

- 新增 `dshSessionSearchCommands.ts`：`dsh.searchSessions` 用原生 quick pick 承接会话搜索（§3.4「会话切换/搜索/历史 → 会话控制器 quick pick」）。
- 服务层 `DshIdeSessionsService.search()` 此前已实现（走官方 `session/search`）但**无任何 UI 调用方**，本轮补上入口。
- 行为约束：空关键字直接返回（不把「没输入」当成「搜索全部」）；搜索失败提示而不显示空列表；无命中提示；选中后先 `bind` 再打开聊天视图，绑定失败明确提示。
- 没有改用 `vscode.open` 打开 `dsh:/` 资源——自定义 scheme 的打开由 DSH 自己的绑定路径负责。

**本轮门禁实测（如实记录）：**

| 项 | 结果 |
|---|---|
| `build/lib/test/dshSessionSearchCommand.test.ts` | **PASS**（5，空/失败/无命中/命中/取消） |
| 搜索/选项/分流/内容/模型/消费者/会话/投影/协议/通道/Host 桥十一文件联跑 | **PASS**（200） |
| `src/tsconfig.json` 全量 `tsc --noEmit` | **FAIL**，报错在既有 VS Code 文件；本轮改动文件零类型错误 |

层 4 尚未落地：历史分页 UI（`loadOlder` 已有服务能力）、附件上传/移除交互、`dshModelMenu` 的 DSH 风格菜单接线。

**自查发现并已修正的缺陷：**

- `dsh.searchSessions` 与 `dsh.newSession` 原先都用 `workbench.action.chat.open` 打开聊天面板——该命令**不接受会话资源**，面板会停在当前会话而不是用户选中的那个。content provider 是按 `dsh:/<id>` 资源提供内容的，必须按资源打开。
- 修法：两处都改用 `openSessionByResource(resource)`（`agentSessionsOpener.ts:173`，会话列表点击走的就是这条），并传入 `dshSessionResource(sessionId)`。
- 顺带移除 `dsh.contribution.ts` 里因此不再使用的 `ICommandService` 注入。

**复核后门禁：**

| 项 | 结果 |
|---|---|
| 搜索/选项/分流/内容/模型/消费者/会话/投影/协议/通道/Host 桥十一文件联跑 | **PASS**（200） |
| `src/tsconfig.json` 全量 `tsc --noEmit` | **FAIL**，报错在既有 VS Code 文件；本轮改动文件零类型错误 |

### 8.15 第十四轮已落地（2026-11-16，层 4：历史补齐与 setGoal）

- **历史分页**：原生 `IChatSession` 只有 `historyStatus`、没有「加载更多」回调，不会自己翻页。`provideChatSessionContent` 先交出首屏内容，再后台 `fillOlderHistory` 循环 `loadOlder` 直到没有更多（上限 40 页，防坏 `hasMore` 死循环），每并入一页由节点事件推送新 history。不阻塞首屏。
- **`setGoal`**：从 `missing()` 改为真接官方 `goals` 服务（`packages/goal/goal/src/index.ts`）的 `remoteExportCreate` / `edit` / `pause` / `resume` / `complete` / `clear`；`agent` 由绑定会话解析，变更类动作带 `{ id, revision }` CAS 引用；新增 `projectGoalView()` 把官方 `GoalView` 转成契约 `DshIdeGoalView`（含可选 `activation`）。
- **`addAttachment` / `removeAttachment` 保持禁用**：官方附件是在 prompt / 命令提交时内联admit，没有独立的「加入/移除附件」端点；按 §5.3 第 4 条明确 `FEATURE_UNAVAILABLE`，不伪造。

**本轮门禁实测（如实记录）：**

| 项 | 结果 |
|---|---|
| `src/vs/platform/dshClient/test/host/ideViewHost.test.mjs` | **PASS**（78，含 setGoal 六动作与无 agent 拒绝） |
| 搜索/选项/分流/内容/模型/消费者/会话/投影/协议/通道/Host 桥十一文件联跑 | **PASS**（202） |
| `src/tsconfig.json` 全量 `tsc --noEmit` | **FAIL**，报错在既有 VS Code 文件；本轮改动文件零类型错误 |

层 4 尚未落地：附件上传/移除交互（受官方能力限制，只能随 prompt 内联）、`dshModelMenu` 的 DSH 风格菜单接线（原生模型选择器已可用）。

**自查发现并已修正的缺陷：**

- `goals.clear` 返回的是 `GoalRef`（tombstone，`goal/src/index.ts:436-449`），不是 `GoalView`。原实现套用 `projectGoalView` 只会得到 `undefined`，已改为原样透出引用。
- `projectGoalView` 在形状不合时返回 `undefined`，而 `validateDshIdeInvokeOutput` 的 `jsonValue` 不接受 `undefined`（`dshIdeProtocol.ts:863-867`）。已加 `requireGoalView` 守卫：投影失败明确抛 `FEATURE_UNAVAILABLE`，不让非法值混进线协议。

**复核后门禁：**

| 项 | 结果 |
|---|---|
| 搜索/选项/分流/内容/模型/消费者/会话/投影/协议/通道/Host 桥十一文件联跑 | **PASS**（202） |
| `src/tsconfig.json` 全量 `tsc --noEmit` | **FAIL**，报错在既有 VS Code 文件；本轮改动文件零类型错误 |

### 8.16 第十五轮已落地（2026-11-16，§5.5 移交验收门禁转 PASS）

本轮清掉了 §5.5 验收的两处遗留阻塞：

- **删除死测试** `build/lib/test/dshSlotRegistry.test.ts`：它 import 的 `chatContentParts/dsh/dshSlotRegistry.ts` 早已随 slot 路线取消而删除，文件跑起来是 `ERR_MODULE_NOT_FOUND`，且全仓生产代码零引用。删除后「每个 dsh 测试都登记进 `test-dsh:all`」由 FAIL 转 **PASS**。
- **同步过期断言** `dshIdeEndpoints.test.ts`：先前有两条护栏要求 `setGoal` / `listSkills` 必须保持 `missing(...)`；两者现在都已按官方服务核对接线（`goals` 的 `@Remote` 六动作、`skills.list()`），护栏列表随之收敛到真正没有官方端点的四项（`addAttachment` / `removeAttachment` / `openInApp` / `dismissQuotaNotice`），并新增一条断言钉住 `setGoal` / `listSkills` 已接线。

**§5.5 验收门禁实测（如实记录）：**

| 门禁项 | 结果 |
|---|---|
| 协议 `dshIdeProtocol.test.ts` | **PASS** |
| 通道 `dshIdeChannel.test.ts` | **PASS** |
| waterfall `dshIdeWaterfallNotice.test.ts` | **PASS** |
| transport `dshIdeTransport.test.ts` | **PASS** |
| endpoints `dshIdeEndpoints.test.ts`（含「每个 dsh 测试都登记」） | **PASS**（22） |
| consumer `dshIdeConsumer.test.ts` | **PASS** |
| typed 投影往返（`dshIdeConversation` / `dshIdeProjections`） | **PASS** |
| Host 桥 `ideViewHost.test.mjs` | **PASS**（78） |
| 以上全套联跑 | **PASS**（245） |
| `src/tsconfig.json` 全量 `tsc --noEmit` | **FAIL**，报错在既有 VS Code 文件；本轮改动文件零类型错误 |

§5.5 的验收条件（协议/通道/waterfall/Host 桥/消费者/endpoints 全 PASS、新增 typed 投影往返全 PASS、`test-dsh:all` 登记完整）**均已满足**。真机界面显示仍属用户验证项，AI 不代跑。

### 8.17 第十六轮已落地（2026-11-16，CI 聚合门禁转 PASS）

本轮把 `verify:dsh-ide-ci` 从 FAIL 推到 **全步骤 PASS**，逐项清理阻塞：

- **`projection-golden` 从 PENDING 转 PASS**：原来的空壳只是打印 PENDING。改为真正的替代断言——用一组金标准事件回放 `dshIdeConversation` 投影器，断言四个节点（用户 / 助手 / 子代理发现 / 结算通知）全部通过 `validateDshIdeSnapshot`，并核对子代理名字与「节点不带 raw」。`release-gate` 随之四条全 PASS。
- **删除两个死测试**：`dshSlotRegistry.test.ts`、`dshNodeViews.test.ts` 都 import 早已随 slot 路线删除的模块（`ERR_MODULE_NOT_FOUND`），生产代码零引用。
- **同步过期断言**：`dshStageNumbering` 的 P6 注释断言、`dshIdeEndpoints` 的 D69 PENDING 断言、`dshBundleStaging` 的 `dshChatModelDriver` 注册断言——三者钉的都是已被取代的旧路线，改为钉住现行实现。
- **补 staging 登记**：`dshIdeRequestView.js` 是 Host 桥实际依赖的 common 模块，之前漏登记会导致打包缺文件；已加入 `gulpfile.vscode.ts` 的 copyList。
- **修正 `test-dsh` glob**：`out/vs/workbench/contrib/dsh/test/browser/chatClient/*.test.{js,mjs}` 指向已清空的目录，去掉这两条无效 glob。
- **移除悬空 CI 步骤**：`verify:dsh-ide-ci` 的 `docs-graph` 步骤引用 `verify:docs-graph`，该 script 从未在 `package.json` 里存在过，也没有实现文件；手册 §7.4 亦未要求。移除步骤并同步测试。

**§5.5 / CI 聚合门禁实测（如实记录）：**

| 门禁项 | 结果 |
|---|---|
| `verify:dsh-ide-protocol-single-source` | **PASS** |
| `verify:dsh-ide-boundary` | **PASS** |
| `verify:dsh-ide-projection-golden` | **PASS**（金标准回放） |
| `verify:dsh-ide-contract` | **PASS**（`DSH_INSTALLED_VERSION=0.2.2-rc.1`，4 注入点指纹一致） |
| `verify:dsh-ide-release-gate` | **PASS**（四条聚合全 PASS） |
| `test-dsh:all` | **PASS**（352 项，含 mocha 7 项 + node:test 345 项） |
| `verify:dsh-ide-ci` | **PASS**（all steps passed） |
| `src/tsconfig.json` 全量 `tsc --noEmit` | **FAIL**，报错在既有 VS Code 文件；本轮改动文件零类型错误 |

**手册 §5.5 移交验收条件全部满足**：协议/通道/waterfall/Host 桥/消费者/endpoints 全 PASS、typed 投影往返全 PASS、`test-dsh:all` 登记完整、release-gate 四条全 PASS。真机界面显示仍属用户验证项，AI 不代跑。

### 8.18 第十七轮已落地（2026-11-16，团队开关 + 清理死代码）

- **新增 `dshTeamCommands.ts`**：`dsh.toggleTeam` 用 quick pick 承接 DSH 的团队开关。这是 `dshModelMenu.ts` 唯一独有的能力（原生模型选择器有模型与 effort，没有团队开关），此前**没有任何 UI 入口**。
- 写回仍走既有 `setTeamEnabled`（`DshComposerSource.setTeam`），不新造接口。约束：无团队设置时明确拒绝；选中当前值不重复写；写回后回读 `state.team` 确认，未生效则明确提示，不假装成功。
- **删除 `dshModelMenu.ts`（330 行）**：全仓零引用的死代码。它画的模型与推理等级原生选择器已具备，团队开关本轮已由命令承接，按「同一能力只保留一处实现和一个公共入口」删除。

**本轮门禁实测（如实记录）：**

| 项 | 结果 |
|---|---|
| `build/lib/test/dshTeamCommand.test.ts` | **PASS**（5，无设置/取消/同值/切换/被拒） |
| `verify:dsh-ide-ci`（四门禁 + test-dsh:all） | **PASS**（all steps passed） |
| `src/tsconfig.json` 全量 `tsc --noEmit` | **FAIL**，报错在既有 VS Code 文件；本轮改动文件零类型错误 |

层 4 现只剩附件交互受官方能力限制（官方只在 prompt / 命令提交时内联 admit，无独立加/移除端点），已按要求 `FEATURE_UNAVAILABLE` fail-closed。层 4 的逐类 UI 至此全部有对应实现。

**同步更新的基线描述（AGENTS.md §1.4「文档迁就代码」）：**

- §1.3「当前实现仍以 frame 为准」→ 改为已切到 typed 字段（`acceptConversation` 只吃 `conversation` 节点树，裸帧解析已删除），并写明 `composerState` 仍走独立通道。
- §1.4「不能承接」→ 改为「层 4 已逐类补齐」：11 个 typed 字段全部有 Host 来源、仅剩 4 个无官方 remote 的 `missing()`、`fetchRowDetail` 明确抛 `FEATURE_UNAVAILABLE`、`runCommand` 已支持图片附件。
- §1.5 / §3.2 的 `missing()` 清单从 6 项收敛到 4 项（`setGoal` / `listSkills` 已接线）。

**同轮附带清理（旧路线死代码）：**

- 删除 `dshHistoryPager.ts`：自建 DOM 滚动条与 loadOlder 触发器，全仓零引用。历史补齐改由 provider 侧 `fillOlderHistory` 完成，原生 ChatWidget 自带滚动。
- 删除 `dshMappingVerifier.ts` 及其测试：服务于已取消的 `ChatDshNodeContentPart` 双射校验路线，零生产引用。
- 删除 `dsh.contribution.ts` 里指向已停用 `DshChatModelDriver` 的过期注释。

清理后 `verify:dsh-ide-ci` 仍全 PASS，改动 540 行删除、1 行插入。

### 8.19 子智能体工作流（按模型目录组织）

- 子智能体插件已启用，`workflow` 与 `subagent` 工具可用；子智能体模型目录（`list_subagent_models`）可用路由为 `workbuddylocal` 的 `hy4flash-free`、`glm-5.3-flash`、`hy4flash`。
- 工作流 `ide-conversation-projection` 按目录里的三个模型分工：`glm-5.3-flash` 负责投影、`hy4flash` 负责测试、`hy4flash-free` 负责接线；测试未通过时不进入接线阶段。
- 工作流 `projection-review` 按目录分工做只读交叉复核：`glm-5.3-flash` 核形状、`hy4flash` 核测试覆盖、`hy4flash-free` 核接线；三路并发。
- 工作流 `layer2-review-round3` 按目录分工复核第四轮改动：`glm-5.3-flash` 核 deliverables/skills、`hy4flash` 核 runCommand 附件、`hy4flash-free` 核接线，三路并发。
- 工作流 `layer2-acceptance` 按目录分工做层 2 验收审计：`glm-5.3-flash` 审 11 个 typed 字段来源、`hy4flash` 审测试覆盖、`hy4flash-free` 审接线，三路并发。
- 工作流 `layer3-review` 按目录分工复核层 3：`glm-5.3-flash` 核节点映射、`hy4flash` 核消费者与状态、`hy4flash-free` 核接线与回退，三路并发；`hy4flash` 报出的三处 typed 路径缺陷已修并补测试。
- 工作流 `layer4-review` 按目录分工复核层 4：`glm-5.3-flash` 核 provider 契约、`hy4flash` 核 history 映射、`hy4flash-free` 核生命周期；`hy4flash-free` 报出的取消语义缺陷已修。
- 工作流 `layer4-wiring-review` 按目录分工复核发送入口与 New Session：`glm-5.3-flash` 核分流、`hy4flash` 核新建、`hy4flash-free` 核回退；`hy4flash` 报出的 bind 静默失败已修并补提示。
- 工作流 `layer4-pending-review` 按目录分工复核审批/问卷承接（`glm-5.3-flash` 核应答链路、`hy4flash` 核渲染、`hy4flash-free` 核刷新）；该轮子智能体未返回结构化结论，主智能体自行核对并修掉「待决议卡挂在陈旧 response 上按钮被禁用」的缺陷。
- 工作流 `layer4-extras-review` 按目录分工复核 extras 渲染：`glm-5.3-flash` 核交付物引用、`hy4flash` 核部件形状、`hy4flash-free` 核刷新链路；`hy4flash-free` 报出的「每帧无判重重建」与「bind 清空不通知」两处已修。
- 工作流 `layer4-options-review`、`layer4-search-review` 按目录分工复核选项组与搜索接线；两轮子智能体均未返回结构化结论，主智能体自行核对并修掉「用 `workbench.action.chat.open` 打开会话会停在当前会话」的缺陷。
- 投影阶段子智能体未落文件，由主智能体按 §3.2 补写；测试阶段由 `hy4flash` 子智能体完成并通过；接线与 `pending` 聚合由主智能体完成并复跑门禁。

