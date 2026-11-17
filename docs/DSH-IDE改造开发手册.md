# DSH-IDE 改造开发手册（第一阶段已落地；第二阶段 2-A/2-B/2-C/2-D 已落地，2-E 真机验收待用户执行）

> 编写日期：2026-11-16。依据：`docs/DSH-IDE承接DSH桌面端聊天页面的路线草稿.md`（22:23 更新版）、`docs/DSH-core内容进入桌面前端的全部入口.md`、`docs/DSH-IDE内容接收与ChatSession面板架构分析.md`、`docs/DSH聊天页面全量构成与插件显示机制.md`，以及只读核对的 DSH 源码 `E:/deepseek-harness`、DSH-IDE 源码 `E:/DSH-IDE/src/`。
>
> 本文是静态源码证据推导的实施方案，不是真机观测结论；所有 `file:line` 以快照为准，动手前复核。真机 GUI 验证由用户执行，AI 不代跑。
>
> **阅读顺序**：§0–§7 是目标、基线与冻结边界；§8 是已完成内容的压缩摘要；§9 是第二阶段状态与计划（2-A~2-D 已落地，2-E 真机验收待用户执行）。

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

承接方式固定为：**Host 侧拿官方 event/projection 数据 → 写死投影 → 唯一 `dshIde` 通道 → 翻译层把 DSH 节点映射成 VS Code 原生 content kind → 原生 chat 渲染**。

官方插件（approval / deliverables / tool 等 DSH 源码内置插件）贡献的 UI 通过它们在 Host 侧产生的**数据效果**承接，不运行它们的 React 组件；非官方插件的独有数据形状一律过滤。

### 0.2.1 渲染目标：原生风格，不是像素级还原（草稿 §0.5 更新）

用户已明确："让卡片长得和 DSH 一模一样不是我的目标……保留一些 VS Code 原生的风格更好"。因此：

- **改的是数据层（翻译层），不是渲染模具**：把 DSH 节点翻译成 VS Code 原生 `IChatRendererContent` 的 content kind，用原生 content part 显示；不改 `chatListRenderer.ts` 的硬编码工厂，不写新模具。
- 验收标准是"**不丢内容、能交互、不串不卡**"，不是"长得像 DSH"。
- DSH 特有而 VS Code 无对应的纯装饰（鲸鱼动画、TurnNavigator、PixelWhale、onboarding）不做；图标按 §9.5 阶段 2-D 的独立工作流全局替换。

### 0.3 明确不做（红线）

| 排除项 | 原因 |
|---|---|
| 非官方插件的 UI 效果 / 独有数据效果 | 超出目标基线，主动过滤 |
| 插件资源扫描 / `clientModules` 软依赖 / slot 名静态扫描 | 复杂度高，收益不在目标内 |
| Cordis inspect 活页面查询 slot / props | 需跑 client runtime，与选定路线冲突 |
| WebviewView 承载 DSH Web UI（重版 B） | 等于新建第二套前端运行时，放弃 |
| 轻量 slot / 描述性 slot 投影 / 通用卡片规则表 | **旧版手册中这部分已作废**，改为逐类写死 |
| 把 VS Code 渲染工厂重写成注册表（renderer registry / content part factory registry） | 用户目标是原生风格正确渲染，不是像素还原或插件扩展；映射表写死即可，改 `chatViewModel.ts:203` + `chatListRenderer.ts` 工厂属高侵入（草稿 §5.4） |
| 卡片像素级还原 DSH 外观 | 用户明确不做，保留 VS Code 原生风格更好 |

### 0.4 三层判别标准

1. **数据承接**：Host 侧拿到 DSH core 产生的官方内容。
2. **投影承接**：经唯一 `dshIde` 通道，以契约允许的形状送到 renderer。
3. **UI 承接**：IDE chat 视图把它渲染出来并提供交互。

三层都满足才算承接住。

### 0.5 历史决策记录（slot 路线为何作废）

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
DshChatSession.acceptView / acceptConversation → DshChatModel（typed 节点树）
  → DshChatSessionContentProvider.history → 原生 ChatModel.acceptResponseProgress → 原生 chat 渲染
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

**不能承接（改造目标，层 4 已逐类补齐）：** 协议已定义但 Host 未填的 typed 字段——**现已全部有 Host 来源**（见 §8.1）；4 个无官方 remote 的 `missing()` method（`addAttachment`、`removeAttachment`、`openInApp`、`dismissQuotaNotice`，见 §1.5）明确失败；`fetchRowDetail` 明确抛 `FEATURE_UNAVAILABLE`（官方无对应只读端点）；`runCommand` 附件已支持图片；chat 逐类写死渲染器——**现已全部落地**（见 §8.1）。

### 1.5 协议现状（改动前记住这些数字）

- `DSH_IDE_WIRE_REVISION = 4`（`dshIdeProtocol.ts`）。保留 `frame` 并增加 typed 投影后，由 3 升到 4。
- `DshIdeMethodArgs` 共 **36 个 method**。相对动手前的 30 个，最终仍 `missing()` 的是 4 个（`addAttachment`、`removeAttachment`、`openInApp`、`dismissQuotaNotice`，均无官方 remote）；`setGoal` / `listSkills` 已分别接官方 `goals` / `skills` 服务（见 §8.1）。
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

**§4.2 会话列表/元数据/搜索**：会话列表、元数据、新建/切换、搜索、历史分页、`resume`/`fork.point`/`rewind`、`loadOlder.throughSeq`。协议已有 `listSessions`/`searchSessions`/`loadOlder{throughSeq,beforeSeq,maxMessages}`/`resume`/`fork.point`，Host 已按官方 `atSeq` 与 `session/page` 实现；UI 侧会话搜索 quick pick（§8.1）、历史补齐（§8.1）、New Session（§8.2）已接线。`rewind` 不在 core 里。Host 在装了 `dsh-rewind-plugin` 之后调用它的 `rewind-plugin` 命令（`@<seq> chat`）；没装就拒绝。`fork.point` + `resume` 仍是 core 路径。不另造 `loadThrough`/`forkAt`/`resumeSession`。

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
   - 尚无核对到官方 remote、Host 保持 `missing()` 的：`addAttachment`、`removeAttachment`、`openInApp`、`dismissQuotaNotice`（`setGoal` / `listSkills` 已按官方 `goals` / `skills` 服务接线，见 §8.1）；
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
3. `fetchRowDetail` 官方无对应只读端点，从 `return null` 改为明确抛 `FEATURE_UNAVAILABLE`（不把"不可用"伪装成"没有数据"，§8.2）。
4. `runCommand` 已支持图片附件（`attachments` 逐项按 `ImageAttachmentRef` 校验，经 `attachments.readImage()` 转官方 `CommandSubmitAttachment`，§8.2）。
5. composer 从 4 组投影扩到官方全量（`common/dshIdeComposer.js:6-39`），并订阅 `llm/models-updated`、`permission-presets/catalog-changed` 等失效事件刷新（新增 listen 必须先改契约）。
6. 新增 method handler 全部经 `dshCtx` 调官方服务；`@Remote` 面（`ide-service.js:375-391`）不新增第二条传输通道。
7. `ide-view-service.receive`（`:190-235`）从裸帧 publish 扩为按 typed 视图分流后 publish；waterfall / session-notice 仍走各自订阅，不混进内容帧。
8. 非官方插件过滤：只白名单官方 event/projection 名与官方数据形状；未知 contributor 的独有字段不投影、不转发、不告警。

**本层完成标志**：官方零插件聊天页的每类内容都能在 Host 侧拿到并投影成层 1 定义的 typed 形状；非官方插件额外效果在 Host 侧被丢弃。

### 3.3 层 3：renderer 状态层换成结构化会话

文件：`src/vs/workbench/contrib/dsh/browser/dshChatSession.ts`、`dshChatModel.ts`。

1. `IDshChatSession`（`:39-74`）接口按契约 36 method 对齐：`submit(text, attachments)`、`answerApproval/answerQuestion`（多选答案）、`listSessions/searchSessions/loadOlder{throughSeq,beforeSeq,maxMessages}`、`resume`/`fork.point`/`rewind`（rewind 走已装载的 `dsh-rewind-plugin`，不是 core remote）、`deliverables`、`tokenUsageDelta`、`quotaNotice`、`pending`。4 个无官方 remote 的 `missing()` method 只暴露禁用态或明确失败提示，不伪造成功。**注意**：`plan/goal/todos/skills` 虽已在契约与 Host 投影层就绪，但状态层 `DshChatSession` 尚未保存/暴露（真缺陷，见 §9.5 阶段 2-A）。
2. 移除 renderer 从裸 follow 帧拼节点的逻辑（`dshChatModel.ts:388-403,516-941`），直接消费层 1 的结构化 conversation。
3. `tokenUsage` 唯一真源在 `DshChatModel`（`:318-320,375-386`），`pending` 在 `DshChatSession.pendingItems`（`:86`），`running` 在 `_running`（`:89`）；扩展时**保持单一真源**。
4. 风格：tab、单引号、分号、`I` 接口前缀、`_` 私有、`this._register`/`DisposableStore`，错误走 `onUnexpectedError`。

**本层完成标志**：chat 状态层不再依赖裸帧拼装，所有官方内容都有单一真源。

### 3.4 层 4：chat 视图容器补 UI（已落地，摘要见 §8）

目录：`src/vs/workbench/contrib/dsh/browser/` 及 chat contribution。本层已全部完成，下列为落地后的真实实现（不是待办）。

逐类写死渲染器（**没有通用 slot 规则表**），全部通过 `dshChatHistory.ts` 的 `toHistory()` 折成原生 `IChatSessionHistoryItem[]`，由 `dshChatSessionContent.ts` 的 content provider 供给 `dsh` 会话类型：

| 内容 | 实际落点 |
|---|---|
| 正文 / assistant 增量 / 工具调用 | `dshChatHistory.ts` 把 typed 节点折成原生 request/response；不启用已停用的 `DshChatModelDriver`，改由 `DshChatSessionContentProvider` 提供内容 |
| 审批/问卷 | `dshChatHistory.ts` 待决议卡并进最后一条 response；`dshChatSessionContent.ts` 的 `registerDshAnswerCommands()` 真调 `answerApproval/answerQuestion`（§8.1） |
| 附件 | 历史图片以 typed `attachments` 随快照展示；上传/移除受官方能力限制（只在 prompt/命令提交时内联 admit），`addAttachment/removeAttachment` 保持 `FEATURE_UNAVAILABLE`（§8.1） |
| 交付物 | `dshChatHistory.ts` 用 `IChatContentReference` 文件引用，VS Code 打开器接管（§8.1） |
| Plan/Goal/Todo/Skill | `dshChatHistory.ts` 的 `DshHistoryExtras` 折叠为 info/warning/markdown 部件；Todo 用 `[x]/[-]/[ ]`（§8.1） |
| token/usage/quota/account notice | running/额度提示进 history 的 warning/info 部件；token 用量由 `acceptConversation` 累加（§8.1） |
| 模型/effort/permission/preset/team | 模型与 effort 走原生选择器（`dshLanguageModelProvider`）；权限/预设选项组由 `dshAgentSessionsController.getNewChatSessionInputState` 暴露（§8.1）；团队开关 `dsh.toggleTeam`（`dshTeamCommands.ts`，§8.2） |
| 会话切换/搜索/历史 | `dshSessionSearchCommands.ts` 搜索 quick pick（§8.1）；`provideChatSessionContent` 后台 `fillOlderHistory`（§8.1）；New Session 走 `createSession` + `openSessionByResource`（§8.2） |

三个关键接线点（均已落地）：

1. 内容入口：`dsh.contribution.ts` 注册 `registerDshChatSessionContent(client, chatSessionsService)` + `registerDshAnswerCommands(client)`（`dshChatSessionContent.ts`）。旧 `DshChatModelDriver` 桥接路线已放弃并清理。
2. 发送入口：`ChatWidget._acceptInput` 在 `chatService.sendRequest` 前询问 `_dshSessionContentForSubmit`，DSH 会话走 `DshChatSession.submit()`，其余退回原生链路（§8.2）。
3. New Session：`dsh.contribution.ts` 覆盖 `dsh.newSession`，调 `DshIdeSessionsService.createSession()` 后 `bind` 并用 `openSessionByResource(dshSessionResource(id))` 打开（§8.2）。

复用 VS Code 既有 codicons、主题样式、列表/树组件与原生 chat 部件；Mermaid 与 Markdown 完整保留。`dshModelMenu.ts` 已删除（原生选择器具备模型/effort，团队开关由命令承接，§8.2）。

**本层完成标志（已达成）**：DSH 零非官方插件基线里聊天页正常显示的内容，在 IDE chat 中均有对应实现与交互；`verify:dsh-ide-ci` 全步骤 PASS（§8.3）。剩余唯一限制是附件上传/移除无官方端点，已按要求 fail-closed。

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

## 5. 交付冻结契约（层 1–3 已完成；层 4 UI 亦已落地）

> **状态（2026-11-16，已全部达成）**：层 1（契约）+ 层 2（Host 投影）+ 层 3（renderer 状态层）已按本章冻结条件完成并提交；层 4（chat 视图容器 UI）也已逐类落地（§8.1）。`verify:dsh-ide-ci` 全步骤 PASS。本章保留为交接边界的定义：若后续真机验证发现问题，改动仍须遵守下列冻结边界——不再在协议/通道/Host/状态层之外另起通道或在前端重写投影。

> 本章原始要求：**层 1 + 层 2 + 层 3 全部完成并冻结后，才把工作交给 chat 视图容器前端改造。** 交付时下游只需要写渲染器和绑定 view，不再触碰协议、通道、Host 桥、会话状态模型。
>
> **第二阶段例外（2026-11-16 源码核对后新增）**：§9.5 阶段 2-A 发现 `plan/goal/todos/skills` 在状态层从未保存/暴露（真缺陷），允许**仅这四个字段**在 `DshChatSession` 补只读 getter、`acceptView` 保存与 `bind` 清空；这不改变冻结契约的形状/通道/Host/协议，只是补齐层 3 原本遗漏的只读暴露。除这四项外，§5 冻结边界全部保持。

### 5.1 冻结边界：前端改造只允许改这些文件

交付后，chat 容器前端改造只允许新增/修改 chat 视图容器与渲染器文件（`workbench/contrib/dsh/browser/` 下的 `dshChatHistory.ts`、`dshChatSessionContent.ts`、`dshSessionSearchCommands.ts`、`dshTeamCommands.ts` 等），**不得再改**：

- `src/vs/platform/dshClient/common/dshIdeProtocol.ts` 及契约校验（`dshIdeContract.ts`、`dshIdeEndpoints.test.ts`）；
- `src/vs/platform/dshClient/host/*`（`ide-view-host.js`、`ide-service.js`、投影函数）；
- `src/vs/platform/dshClient/electron-main/ide-view-service.ts`、`dshIdeChannel.ts`；
- `src/vs/workbench/contrib/dsh/browser/dshChatSession.ts`、`dshChatModel.ts`（层 3 状态层已冻结）；
- `dshIdeConsumer.ts`（消费与合并逻辑已冻结）。

若前端改造中发现上述冻结文件必须改，说明本手册的层 1–3 没做完整，退回补齐，不得在前端绕过。

### 5.2 层 1 冻结条件（契约已完成，不再变）

1. `DSH_IDE_WIRE_REVISION = 4` 固定；冻结后非全局重开不允许再 bump。
2. `DshIdeViewSnapshot` 的 11 个 typed 字段（`conversation`、`deliverables`、`attachments`、`plan`、`goal`、`todos`、`skills`、`tokenUsageDelta`、`quotaNotice`、`composer`、`pending`）形状锁定；前端按这些类型写渲染器，不再等字段变更。
3. 36 个 `DshIdeMethodArgs` 锁定；4 个无官方 remote 的 `missing()` method 语义锁定为「调用即 `FEATURE_UNAVAILABLE`」，前端按禁用态处理，不期待它们成功（`setGoal` / `listSkills` 已接线，见 §8.1）。
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

第一阶段（已完成）顺序：契约扩字段 → Host 官方数据投影 → renderer 状态层消费结构化 conversation → chat UI 逐类接线。记录见 §8。

**第二阶段（当前计划）顺序见 §9.5**：修 `plan/goal/todos/skills` 数据链缺口（2-A）→ 翻译层升级为真原生 content kind（2-B）→ Session 面板缺口核对（2-C）→ 图标全局替换（2-D）→ 真机验收（2-E）。

每步跑 `tsc --noEmit` + 相关测试；真机验证由用户执行。

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
| 会话投影（层 2） | `common/dshIdeConversation.ts`、`common/dshIdeProjections.ts`、`common/dshIdeRequestView.js` |
| renderer 总装（层 4） | `workbench/contrib/dsh/browser/dsh.contribution.ts` |
| 帧消费 | `workbench/contrib/dsh/browser/dshIdeConsumer.ts` |
| 聊天状态（层 3，已冻结） | `workbench/contrib/dsh/browser/dshChatSession.ts`、`dshChatModel.ts` |
| 内容提供者 / history（层 4） | `workbench/contrib/dsh/browser/dshChatSessionContent.ts`、`dshChatHistory.ts` |
| 会话搜索 / 团队（层 4） | `workbench/contrib/dsh/browser/dshSessionSearchCommands.ts`、`dshTeamCommands.ts` |
| 会话控制器 / 会话链 | `workbench/contrib/dsh/browser/dshAgentSessionsController.ts`、`dshIdeSessionsService.ts`、`dshIdeSessionListModel.ts` |
| Chat 容器 | `workbench/contrib/chat/browser/chatParticipant.contribution.ts` |
| Chat 面板 / 发送分流 | `workbench/contrib/chat/browser/widgetHosts/viewPane/chatViewPane.ts`、`chatWidget.ts` |
| 门禁测试 | `build/lib/test/dshIdeEndpoints.test.ts` 及 `test-dsh:all` 登记的各 dsh 测试 |

---

## 8. 第一阶段完成摘要（原始逐轮记录已压缩）

> 第一阶段（层 1–层 4）于 2026-11-16 分 17 轮落地并提交。原始逐轮流水账已压缩为本摘要；最终状态、剩余缺陷与第二阶段计划见 §9。需要某一轮的历史细节时查 `git log`。

### 8.1 交付清单（四层）

| 层 | 关键产物 |
|---|---|
| 层 1 契约（wireRevision 3→4） | `dshIdeProtocol.ts` 补齐 11 个 typed 字段及校验器；`runCommand` 支持图片附件；`loadOlder` 接受可选 `conversation`；`DshIdeMethodArgs` 30→36 |
| 层 2 Host 投影 | 11 个 typed 字段全部有官方来源；`setGoal` 接官方 `goals` 六动作、`listSkills` 接 `skills.list()`；`fetchRowDetail` 由 `return null` 改为明确 `FEATURE_UNAVAILABLE`；非官方插件数据在桥层过滤 |
| 层 3 状态层 | `DshChatModel.acceptConversation()` 只吃 typed 节点树（约 1150→730 行），`rawEvents`/`applySnapshot`/`applyStream` 等裸帧解析全删；`DshIdeConsumer` 保留 typed view；`dsh.contribution.ts` 切到 `acceptView` |
| 层 4 逐类 UI | 新增 `dshChatHistory.ts`、`dshChatSessionContent.ts`、`dshSessionSearchCommands.ts`、`dshTeamCommands.ts`；覆盖发送分流、审批/问卷、交付物文件引用、权限/预设、会话搜索、历史补齐、团队开关 |

### 8.2 过程中修掉的真缺陷

- `workbench.action.chat.open` 不接受会话资源 → 改用 `openSessionByResource`，否则 `newSession` / `searchSessions` 会停在当前会话。
- `goals.clear` 返回 `GoalRef` 而非 `GoalView` → 原样透出引用，不再套 `projectGoalView`。
- `projectGoalView` 返回 `undefined` 会被 `jsonValue` 拒绝 → 加 `requireGoalView` 守卫，投影失败抛 `FEATURE_UNAVAILABLE`。
- 待决议卡单开 response 被原生标 `isStale`、按钮禁用 → 并进最后一条 response。
- `acceptView` 每帧无条件 fire extras → 加内容判重；`bind()` 清空 extras 时补 fire。
- `provideChatSessionContent` 取消语义 → 取消判定提前到 `bind` 之前，`bind` 后取消抛 `CancellationError`。
- `bind` 内部 `rebindView` 失败静默 return → 改返回 `Promise<boolean>`，失败时 warn 并中止打开。
- typed 路径 `firstSeq()` / `located()` / `tokenUsage()` 三处仍读裸帧 → 改为纯节点来源。
- `DshIdeSessionsService` 只声明装饰器未 `registerSingleton` → 补注册，否则注入失败。
- 死代码清理：`dshModelMenu.ts`、`dshHistoryPager.ts`、`dshMappingVerifier.ts`、`dshSlotRegistry.test.ts`、`dshNodeViews.test.ts`。

### 8.3 门禁汇总

| 门禁 | 结果 |
|---|---|
| protocol-single-source / boundary / projection-golden / contract | PASS |
| release-gate（四门禁聚合） | PASS |
| `test-dsh:all` | PASS（352 项，第一阶段当时计数；当前实测见 §9.2） |
| `verify:dsh-ide-ci` | PASS（all steps passed） |
| 全量 `tsc --noEmit` | FAIL——报错均在既有 VS Code 文件（如 `chatWidget.ts` 的 `product` 未使用），本批改动文件零类型错误；按 §5.5 记录，不写成 PASS |

### 8.4 子智能体工作流（按 `workbuddylocal` 模型目录）

`glm-5.3-flash`（投影/形状/契约）、`hy4flash`（测试/状态/写回）、`hy4flash-free`（接线/生命周期/刷新）三路并发，覆盖 `ide-conversation-projection` 到 `layer4-extras-review` 等十余个工作流；报出的 typed 路径缺陷、取消语义、bind 静默失败、陈旧 response 按钮禁用、extras 每帧重建等均已修。后期数轮子智能体未返回结构化结论，由主智能体自行核对补齐（如实记录）。

### 8.5 第二阶段第一轮：子智能体工作流（workflow + subagent 插件）

用 `workflow` 工具起一个并行工作流，两个子智能体分别绑定 `workbuddylocal` 模型目录里的模型：

- `glm-5.3-flash` → 原生部件字段契约（`chatService.ts` / `chatViewModel.ts` / `languageModelToolsService.ts` / `renderChatContentPart` 全表 / 审批与问卷回传路径）；
- `hy4flash` → 2-B 降级点审计（`dshChatHistory.ts` 全部输出形态、2-A 数据链断点、B1–B5 分批可行性）。

产出落 `.build/dsh-part-contracts.md` 与 `.build/dsh-2b-audit.md`（本地核对材料，不入库）。关键结论：`confirmation` 按钮点击走 `chatService.sendRequest`，**不能**回传 `dsh.answerApproval`；`questionCarousel` 回传依赖 `resolveId` 与 `notifyQuestionCarouselAnswer`，当前数据链不具备；`planReview` / `changesSummary` / `multiDiffData` 需要正文与真实 URI，DSH 侧只有 `active/pending` 与字符串 path。以上判定为本轮「保留降级形态」的依据。

### 8.6 第二阶段第二轮：子智能体对抗式复核（workflow + 两个模型）

同一 `workflow` 机制的第二次并行工作流，仍是 `workbuddylocal` 目录里的两个模型：

- `glm-5.3-flash` → 对抗式代码审查（`dshChatHistory` / `dshChatSession` / `dshChatSessionContent` 的全部改动）；
- `hy4flash` → 测试有效性 + 文档一致性（6 个新测试文件的「假守护」风险、手册计数与实测是否一致）。

产出落 `.build/review-a.md` / `.build/review-b.md`（本地材料，不入库）。复核报出并经主智能体逐条核实、修复的**真缺陷 4 个**：running 阶段工具双卡、连续 `turn-error` 互相覆盖、`sameSkills` 漏比 3 个字段、`quotaNotice` 覆盖真实错误。另指出 1 个测试盲点（`extrasOf` 装配未被触达），已把该函数下沉为纯函数并直接单测。

> **如实记录**：`hy4flash` 的报告中「mocha 13 项」「365 项已被 376/377/378 取代且 r92 日志有失败」等说法来自它读到的工作区其他日志，不是本轮实测；主智能体复跑 `npm run test-dsh` 得 **7 passing**，`test-dsh:all` 得 **370 项全过**，以实测为准（手册 §9.2/§9.5 已按实测回写）。

### 8.7 子智能体插件与模型目录的启用证据

本轮「启用子智能体插件组成工作流」的实测依据（`plugin_manager list_plugins` + `cordis_inspect_query`）：

| 项 | 实测状态 |
|---|---|
| `@deepseek-ai/dsh-subagent`（`include:subagent`） | enabled / active；config `maxDepth: 2` |
| `@deepseek-ai/dsh-subagent-spawn-in-process` | enabled / active（spawn 后端） |
| `@deepseek-ai/dsh-subagent-fork-in-process` | enabled / active（fork 后端） |
| `@deepseek-ai/dsh-agent-team` + `@deepseek-ai/dsh-tool-agent-team` | enabled / active（共享任务板） |
| `@deepseek-ai/dsh-tool-subagent/model-selection-settings` | enabled / active；`allowedModels` 恰为 `workbuddylocal/glm-5.3-flash` 与 `workbuddylocal/hy4flash` |
| `list_subagent_models` 实测返回 | `workbuddylocal/glm-5.3-flash`（effort low/high/max）、`workbuddylocal/hy4flash`（effort high） |
| 实际派工 | 3 个 `workflow` 并行工作流共 5 个子智能体：`route-check`（能力验证）、`agent-1`/`agent-2`（2-A/2-B 核对）、`agent-3`/`agent-4`（对抗复核），全部绑定上述两个模型 |

> 说明：Host 级 `include:tool-subagent` 行在 profile 清单里是 inactive，但当前会话的 `ptc` preset 在 preset 作用域内挂了 `tool-subagent`（`provider: spawn`、`modelSelection: true`、`modelDiscovery: true`），所以本会话的 `subagent` / `subagent_fork` / `list_subagent_models` 工具可用——这也是子智能体能被实际派工的原因。这一点按源码核对记录，不臆造 Host 级启用。

---
## 9. 当前状态：第一阶段完成；第二阶段 2-A/2-B/2-C/2-D 已落地，2-E 真机验收待用户执行

### 9.1 阶段划分（本次更新）

草稿在 2026-11-16 22:23 更新后，目标已从"把内容接进来"推进到"**用 VS Code 原生模具正确渲染 + 图标全局替换**"。手册据此把工作分为两阶段：

- **第一阶段（已完成并冻结）**：§3 的四层改造——数据通路、契约、Host 投影、状态层、逐类 UI 接线。见 §8 逐轮记录。
- **第二阶段（进行中）**：把第一阶段"降级翻译"的 UI 升级为真正的 VS Code 原生 content kind；补齐 Session 面板缺口；图标全局替换为 DSH SVG。见 §9.3–§9.6。**2-A/2-B/2-C/2-D 已落地（§9.5），只剩 2-E 真机验收。**

### 9.2 第一阶段真实状态（基线，不再改）

| 层 | 状态 | 关键产物 |
|---|---|---|
| 层 1 契约（wireRevision 4） | 完成（§8.1） | `dshIdeProtocol.ts` 11 typed 字段 + 校验器；`runCommand` 图片附件；`loadOlder` 可选 `conversation` |
| 层 2 Host 投影 | 完成（§8.1） | 11 typed 字段全有 Host 来源；`setGoal`/`listSkills` 真接官方；`fetchRowDetail` 明确 `FEATURE_UNAVAILABLE` |
| 层 3 状态层 | 完成并冻结（§8.1） | `DshChatModel.acceptConversation` 只吃 typed 节点树（约 1150→730 行）；裸帧解析删除 |
| 层 4 逐类 UI（降级翻译） | 完成（§8.1） | `dshChatHistory.ts` / `dshChatSessionContent.ts` / `dshSessionSearchCommands.ts` / `dshTeamCommands.ts` |

门禁：`verify:dsh-ide-ci` 五步全 PASS（`DSH_INSTALLED_VERSION=0.2.2-rc.3`）；`test-dsh:all` PASS——本轮实测 `node --test` 370 项全过、mocha 7 项全过。全量 `tsc --noEmit` 仍 FAIL（既有 VS Code 文件，本批改动文件零错误，按 §5.5 记录）。

> **口径说明**：§8.3 的「352 项」是第一阶段当时记录的计数，本轮未复算；本轮以实测的 `node --test 370 + mocha 7` 为准（新增 32 项：`dshChatSessionExtras` 6 + `dshChatHistoryNative` 10 + `dshSessionItemState` 5 + `dshIconArtwork` 4 + `dshIconReplacement` 3 + `dshIconsStyleSheet` 4）。

### 9.3 现状核对：草稿与新计划的差异（必须先认清）

这一节是"最完美计划"的事实基础。草稿 §2/§4/§5 描述的是**改造前的旧现状**，与当前代码不符；同时草稿自身有几处事实错误。逐条校正：

| 草稿说法 | 当前真实状态（源码证据） | 对计划的影响 |
|---|---|---|
| §2.2 frame 是裸帧、renderer 从裸帧拼节点（`:99-107`） | 已废弃：`acceptConversation()` 只吃 typed `conversation`，裸帧解析已删（§8.1） | 不再重做"恢复 driver / 从裸帧翻译" |
| §4.4 / §5.6「恢复 `dshChatModelDriver.ts`，把 `DshChatNode[]` 写进原生 `ChatModel` response」 | 项目已用更好的 `IChatSessionContentProvider.history` 路径：`dshChatSessionContent.ts:34,109-111,113-139,163-165` 注册 provider，产出 history，native restorer（`remoteChatSessionRestorer.ts:489-508`）把 parts 喂给 `ChatModel.acceptResponseProgress` | **保留 content provider 路径，不恢复 driver**；翻译层升级只改 `dshChatHistory.ts` 的 part 映射 |
| §5.3 列的原生 content kind 表 | 多数真实存在（`chatListRenderer.ts:4568-4653`：确认 `:4585`、thinking `:4638`、toolInvocation `:4603`、planReview `:4617`、changesSummary `:4619`、questionCarousel `:4615`、working `:4577`、errorDetails `:4611`、multiDiffData `:4570`、warning `:4587`），但**没有 `codeBlockPart` 分支**，也没有 `registerChatRenderer`/内容部件注册表 | 翻译层只能用这些真实 kind；不做注册表、不用不存在的 kind |
| §5.3「标已接的两项当前已工作」模型/会话列表（`:347,354`） | 属实：`dshLanguageModelProvider` 与 `DshAgentSessionsController` 已工作 | 不动 |
| 草稿未提 | **改造前 `dshChatHistory.ts` 只发 6 种 part**：`markdownContent` / `thinking` / `warning` / `info` / `reference` / `command`（`dshChatHistory.ts:17-23`）。工具、审批、问卷、plan 都降成 markdown/warning/info；更严重的是 `plan/goal/todos/skills` 在状态层（`dshChatSession.ts:254-277`）就没保存、content provider（`:52-56,59-63`）也没传，数据链整条断 | 这是第二阶段首要缺口：先修状态层存储 + getter + content 补传，再把降级 part 升级为真原生 kind。**现状**：2-A 与 2-B 可行项已落地（§9.5） |
| §6.4「Mermaid 不是 DSH 特性，DSH 用 KaTeX」 | 属实，且 KaTeX 属 A 级可后续项 | 第二阶段不引入 KaTeX；保留 VS Code 自身 Mermaid/Markdown |
| §7.4「改 `iconsStyleSheet.ts` 需同步 `dshIdeContract.ts:48-77` patch 哈希」 | **错误**：`VSCODE_PATCH_POINTS`（`dshIdeContract.ts:48-77`）只覆盖 chat-viewlet / inline-completion / terminal / command-palette 四处，不含 `iconsStyleSheet.ts` | 图标改动不触发 contract hash 门禁，但仍需跑主题测试 |
| §7「改 `getCSS()` 是单一全局点，业务代码零改动」 | 部分成立：`getIconsStyleSheet().getCSS()`（`iconsStyleSheet.ts:31-74`）是动态 `::before` 规则生成点，但 `codicon.css:6-23` 字体加载/基础布局、若干 CSS 直接覆盖 `::before`（如 `chat.css:1436`）、24 处 `var(--vscode-icon-...)` 消费点都绕过它 | 图标方案按"先覆盖 getCSS 高收益面，再补直接覆盖点"分步做，承认混合状态 |
| §7.2「DSH 图标纯 stroke」 | 需修正：`ICON_ARTWORK`（`E:/deepseek-harness/packages/client/ui-primitives/src/icons/artwork.ts:22-132`，109 glyph）以 stroke 为主，但含 fill 与内部 mask 混合 | mask 方案仍可用，但资源生成脚本要原样输出 SVG，不做"转字体/统一 stroke"假设 |

**最重要的结论**：第二阶段不是"推翻第一阶段重做"，而是"**在已冻结的 content provider + history 翻译层上，把 part 从降级形态升级为原生 kind，并新增图标工作流**"。

### 9.4 第二阶段总目标与不做清单

**总目标**（对齐草稿 §0.5 / §5.5）：DSH 官方零插件基线里的聊天内容，在 IDE chat 中：

1. **不丢内容**：正文、工具、审批、问卷、计划、目标、Todo、Skill、交付物、额度、错误，全都出现。
2. **能交互**：审批能点、问卷能选、工具能展开、交付物能打开，操作回传 DSH core。
3. **原生风格**：一律用 VS Code 原生 content part 显示，不像素还原 DSH，不改原生渲染工厂。
4. **图标 DSH 化**：把 codicon 可见图标替换为 DSH 官方 SVG（混合状态：DSH 无对应者保留 codicon）。

**不做**：renderer registry、像素级还原、WebviewView/React slot、非官方插件内容、KaTeX（本轮）、鲸鱼动画/TurnNavigator/onboarding 等纯装饰、恢复 `dshChatModelDriver`。

### 9.5 第二阶段工作计划（按依赖排序，逐项可验收）

#### 阶段 2-A：修复第一阶段遗留缺陷（已落地）

> **源码核对结论（比草稿更进一步）**：`plan/goal/todos/skills` 四个 typed 字段在**状态层整条链都断了**，不只是 content provider 漏传：
> - `DshChatSession.acceptView`（`dshChatSession.ts:254-277`）只保存 `conversation`/`pending`/`deliverables`/`attachments`/`quotaNotice`，**没有**保存 `plan`/`goal`/`todos`/`skills`；
> - `DshChatSession` 没有这四个字段的只读 getter（全文搜 `_plan/_goal/_todos/_skills` 无结果）；
> - `DshChatSessionContent` 传给 `toHistory` 的 extras 也没有这四个字段（`dshChatSessionContent.ts:52-56,59-63`）。
>
> 所以手册 §8.1「计划/目标/Todo/Skill 已落地」的记录与代码不符——`dshChatHistory.ts` 的映射函数写好了，但数据从未到达它。这是第二阶段必须优先修的真缺陷。

**落地结果（本轮已完成）**：

1. **状态层**：`DshChatSession` 增加 `_plan`/`_goal`/`_todos`/`_skills` 字段与 `plan()`/`goal()`/`todos()`/`skills()` 只读 getter；`acceptView` 读取 `view.plan`/`view.goal`/`view.todos`/`view.skills` 并纳入 `extrasChanged`（新增 `samePlan`/`sameGoal`/`sameTodos`/`sameSkills` 四个判重）；`bind()` 一并清空并触发 `onDidChangeExtras`。
2. **content provider**：两处 extras 构造收成一个 `extrasOf(source)` 纯函数（位于 `dshChatHistory.ts`，唯一装配入口），七项（交付物/附件/额度/计划/目标/Todo/技能）一次取齐；下沉成纯函数是为了让单测能直接注入假来源、覆盖「provider 装配」本身。
3. **单测**：新增 `build/lib/test/dshChatSessionExtras.test.ts`（6 项：保存+getter、判重不重复 fire、bind 清空并通知、技能权限变化必 fire、`extrasOf` 七项装配、四字段到 history part 全程可达）；`dshChatSessionContent.test.ts` 同步覆盖 history 映射。
4. **契约边界**：不改协议/通道/Host，只补层 3 冻结边界允许的只读暴露（§5 例外条款）。

**验收（实测）**：`test-dsh:all` PASS（370 项 node --test 全过 + mocha 7 项全过）；`verify:dsh-ide-ci` 五步全 PASS（contract 在 `DSH_INSTALLED_VERSION=0.2.2-rc.3` 下 PASS）。

> **对抗式复核补记（子智能体 `glm-5.3-flash` + `hy4flash`）**：复核报出 3 个真缺陷并已修：① running 阶段 assistant 的 tool-call 块与独立 `tool-call` 节点会画两张卡（改为按 response 记账 `drawnCallIds`）；② 同一 response 内连续 `turn-error` 互相覆盖（第二次失败前先 `flush`）；③ `sameSkills` 只比 3/6 字段，`modelInvocable`/`userInvocable`/`provider` 变化被吞（已补齐）。另有 1 处低危：`quotaNotice` 会覆盖真实 `turn-error` 的 errorDetails（改为「已有错误时降级为 warning，不覆盖」）。四项均补了回归单测。

#### 阶段 2-B：翻译层升级（history part → 真原生 content kind）

文件：主要 `dshChatHistory.ts`，必要时 `dshChatSessionContent.ts` 的事件刷新；**不改** `chatListRenderer.ts` / `chatViewModel.ts`。

按草稿 §5.3 映射表，但只采用 §9.3 核实过的真实 kind。分批落地、每批一个门禁：

| 批次 | 内容 | 当前降级形态 → 目标原生 kind | 原生分支证据 | 本轮结论 |
|---|---|---|---|---|
| B1 工具 | tool call / result / 子调用树 | `markdownContent` → `toolInvocation`（含 `toolInvocationSerialized`） | `chatListRenderer.ts:4603` | **已落地**：`tool-call`/`tool-result`/assistant `tool-call` block → `toolInvocationSerialized`（`simpleToolInvocation` 承载输入输出，`resultError` 承载失败，`subCalls` 递归展开）；已结束的 callId 去重，不重复出卡 |
| B2 审批/问卷 | pending approval / question | `warning + command` → `confirmation` / `questionCarousel`（保留 `dsh.answerApproval/answerQuestion` 命令回传） | `:4585` / `:4615` | **不可行，保留降级**：`ChatConfirmationContentPart` 按钮只调 `chatService.sendRequest`（`chatConfirmationContentPart.ts:45-57`），无法回传 `dsh.answerApproval`；`questionCarousel` 回传要求 `resolveId` + `notifyQuestionCarouselAnswer`（`chatListRenderer.ts:5251-5253`），当前 `DshChatPending` 无 `IChatQuestion.type/options{id,label,value}/allowSkip`，且 `acceptPending` 只取第一题 |
| B3 计划/变更 | plan / deliverables / diff | `info` / `reference` → `planReview` / `changesSummary` / `multiDiffData` | `:4617` / `:4619` / `:4570` | **不可行，保留降级**：`DshIdePlanView` 只有 `active/pending`（无 `title/content/actions`）；deliverable 只有字符串 `path`（无 URI 与 diff），`changesSummary`/`multiDiffData` 需要真实 `requestId`/URI |
| B4 状态/错误 | running / 错误 / quota | 无或 `markdownContent` / `warning` → `working` / `errorDetails` / `warning` | `:4577` / `:4611` / `:4587` | **错误与额度已落地**：`turn-error` → response 级 `errorDetails`（含 `code`），`quotaNotice` → `errorDetails.isQuotaExceeded`；`working` 本轮不做——**结构性原因**：`IChatWorkingProgress` 只在渲染层联合 `IChatRendererContent`（`chatViewModel.ts:203`），**不在** `IChatProgress`（`chatService.ts:1641-1686`）里，而 `IChatSessionHistoryItem.response.parts` 的类型是 `IChatProgress[]`（`chatSessionsService.ts:357-370`）；把它塞进 history 会被 restorer 的 `acceptResponseProgress` 拒收。要走 `working` 必须在 content provider 之外另接活跃响应，属跨层改动，留作后续项 |
| B5 思考/附件 | reasoning / attachments | `thinking` 已接；附件数量文本 → `IChatAttachmentWidgetRegistry` 的附件 chip | `:4638`；`chatAttachmentWidgetRegistry.ts:35-43,64` | **thinking 保留；附件 chip 不可行**：`IChatAttachmentWidgetRegistry` 是输入附件工厂（要 `IChatRequestVariableEntry` + sessionResource URI），不是 history part；`DshIdeImageAttachmentRef.attachmentId` 明确不是路径/URL |

约束：

- 每条映射先在 `dshChatHistory.test.ts` 写"输入 DSH 节点 → 期望原生 part kind"的单测，再改实现（TDD），保证不丢内容。本轮新增 `build/lib/test/dshChatHistoryNative.test.ts`（10 项）覆盖 B1/B2/B4 的可行与不可行边界。
- 审批/问卷升级为 `confirmation`/`questionCarousel` 时，必须确认其点击回调能走 `dsh.answerApproval/answerQuestion`；若原生 confirmation 只支持 `sendRequest`（§8.2 已记录的坑），则**保留 `warning + command`**，在手册记录"原生 kind 不支持本语义"的例外，不强行降级交互。
- 未知/无对应的节点继续用 `markdownContent` 兜底，不新增自定义 kind，不触发 `renderNoContent`。
- 每批跑 `test-dsh:all` + 相关单测；本批文件零类型错误。

#### 阶段 2-C：Session 面板缺口（草稿 §5.7）

文件：`dshAgentSessionsController.ts`、`dshIdeSessionsService.ts`、相关命令注册。对照真实状态（很多已做）：

| 缺口 | 现状（源码核对） | 计划 |
|---|---|---|
| 会话图标 Codicon.comment | 草稿说要换 DSH 图标（`:189-209`） | 并入阶段 2-D 图标全局工作流处理，不单独改 controller |
| 搜索 | `dshSessionSearchCommands.ts` 已实现 quick pick（§8.1） | 保持；只真机验证 |
| running/unread | `onDidSessionNotice → applyRunning` 已在；unread 展示未见 | 只补 unread 徽标（若原生 item 支持）；无 API 则记录不做 |
| 归档/恢复 | 协议有 `archiveSession`/`unarchiveSession` | 若官方已接且在右键菜单可见则验证；否则作为低优先项，不改主链 |
| 两套会话链 | 显示主链 `DshAgentSessionsController`，操作用 `DshIdeSessionsService` | 保持，不合并 |

**落地结果（本轮已完成）**：

1. **归档 / 恢复**：`DshAgentSessionsController` 实现原生可选接口 `setChatSessionItemArchived(resource, archived)`；写回走既有 `archiveSession` / `unarchiveSession`（Host 侧官方 `workspaceRegistry`），成功后就地更新行 `archived` 并 fire `onDidChangeChatSessionItems`，失败保留原状并 `warn`（不假装成功）。
2. **已读状态**：实现 `setChatSessionItemRead(resource, isRead)`。DSH 没有已读持久化端点，这里只改本地行状态，**不写回 Host**（注释已写明，避免被误当作持久化）。
3. **纯函数抽取**：新增 `dshSessionItemState.ts`（`withArchived` / `withRead` / `timingForRunning`），把「找不到行 / 值没变 / 保持行身份」的语义从控制器里拆出来，可用零 DI 单测覆盖；新增 `build/lib/test/dshSessionItemState.test.ts`（5 项）。
4. **unread 徽标**：原生 `IChatSessionItem` 只有 `badge`（字符串）与 `isRead`（布尔），没有独立的「未读」徽标控件；已按 §9.5「无 API 则记录不做」处理，不造第二套状态。

**验收（实测）**：`test-dsh:all` PASS（含新增 5 项）；`verify:dsh-ide-ci` 五步全 PASS。

#### 阶段 2-D：图标全局替换（草稿 §7，独立工作流，可并行）

这是"难也要做"的独立需求，单独排期、单独门禁，不阻塞 2-A/2-B。

1. **资源生成**（复用官方，不手绘）：从 `E:/deepseek-harness/packages/client/ui-primitives/src/icons/artwork.ts:22-132` 的 `ICON_ARTWORK`（109 glyph，`svg(strokeWidth)`，stroke 为主但 mixed stroke/fill）生成 `dshIconDataUris.ts`（`{ glyphName: dataUri }`）。用 regular stroke=1，URL-encode；保留版权头。
2. **映射表** `dshCodiconMap.ts`：`codicon id → DSH glyph`，只映射语义对得上的（search/plus/close/copy/branch/check 等）。DSH 无对应者保留 codicon（草稿 §7.5 混合状态）。
3. **改 CSS 生成**：在 `iconsStyleSheet.ts:31-74` 的 `getCSS()` 查映射，命中输出 `::before { content:''; background:currentColor; mask:url(data:...); width/height:1em }`，未命中保留原 font 规则。SVG 必须内联 data URI（文档 URL 会失效），尺寸用 `1em`（继承 font-size 缩放）。
4. **补直接覆盖点**：`codicon.css:6-23` 字体加载/基础布局保留；逐一检查直接覆盖 `::before` 的 CSS（如 `chat.css:1436-1442`、`testing.css:198`、`tabs.css:724-733`、`tree.css:70`），命中的加 DSH mask 覆盖或记录例外。24 处 `var(--vscode-icon-...)` 消费点随 `getCSS()` 的 `:root` 值变化。
5. **验证**：浅色/深色/高对比度主题、spin 动画、不同 font-size 场景；遵守草稿 §7.5"不是 100% 纯 DSH"的预期。
6. **门禁**：`tsc --noEmit` + 主题相关测试；**不需要**同步 `dshIdeContract.ts` patch hash（§9.3 已纠正草稿错误）。

**落地结果（本轮已完成）**：

1. **资源生成脚本**：新增 `build/lib/dsh/genDshIconDataUris.mjs`（带 `--check` 漂移模式）。实测官方 `ICON_ARTWORK` 为 **104** 个 glyph（不是草稿写的 109），生成 `dshIconDataUris.ts`（约 76 KB）；每个 glyph 按 regular stroke=1 求值，兼容三种声明（`strokeWidth => \`…\``、`() => '…'`、`strokeWidth === ICON_MEDIUM_STROKE` 三元的 medium/regular 两支）。data URI 全量 URL-encode（含单引号转 `%27`），保证可直接放进 CSS `url()`。
2. **映射表**：`dshCodiconMap.ts` 手写 60+ 条语义对应（search/plus/close/copy/branch/check/chevron/…），并在 `resolveDshGlyph` 里过滤掉不存在的 glyph（防 `mask: url(undefined)`）；未映射的 codicon 返回 `undefined`，保持 codicon 原样。
3. **替换缝**：新增 `platform/theme/common/iconReplacement.ts`（单槽位注册 + 注销，重复注册直接抛错）；`iconsStyleSheet.getCSS()` 在「默认 codicon 未被产品图标主题改写」时查询替换函数，命中输出 `content:''; background-color:currentColor; width/height:1em; mask: url('data:…') center / contain no-repeat`，未命中保留原 font 规则。platform 层不 import workbench；挂载点在 `dsh.contribution.ts` → `dshIconReplacement.ts`。
4. **单测**：新增 `build/lib/test/dshIconArtwork.test.ts`（4 项：glyph 数量、data URI 形状、映射目标存在、未映射返回 undefined）；新增 `build/lib/test/dshIconReplacement.test.ts`（3 项：注册可见、重复注册抛错、过期句柄不误清后来的注册）；新增 `build/lib/test/dshIconsStyleSheet.test.ts`（4 项：命中替换仍输出 `--vscode-icon-*-content/font-family` 根变量、未命中保留 font 规则、无注册时全量 font 规则、产品主题改写优先于替换）。

> **本轮修掉的真实回归**：替换分支最初直接 `continue`，把 `--vscode-icon-<id>-content` 根变量一起吞掉；`style.css` 等处直接消费这些变量（如 chevron-down），会让那些伪元素变空。现已改为「根变量照旧输出、只换 `::before` 规则」，并由上述集成单测钉住。
5. **验证边界（未做，需用户真机）**：浅色/深色/高对比度、spin 动画、不同 font-size 的实际观感按 AGENTS §6 由用户在 2-E 执行；AI 不以代码推断观测结论。直接覆盖 `::before` 的 CSS 点（如 `chat.css:1436`）本轮未逐条加 mask 覆盖，记录为「已知混合状态」，与草稿 §7.5 的预期一致。

**门禁（实测）**：`test-dsh:all` PASS（370 项 node --test 全过 + mocha 7 项全过）；`verify:dsh-ide-ci` 五步全 PASS；生成脚本 `--check` PASS（无漂移）。

#### 阶段 2-E：真机验收与收尾

1. 用户按 `AGENTS.md §6` 做 GUI 验证：消息显示、审批/问卷按钮、工具展开、交付物打开、图标主题表现。AI 不代跑。
2. 清理临时文件 `.dsh-preview/`、`.session_dump.txt`（用户决定）。
3. 更新 §9.2 状态表与 §8 逐轮记录，把第二阶段各轮落地情况写入 §8（保持摘要可追溯；详细逐轮历史可查 git log）。

**产物与安装（本轮已完成到「等待重启」）**：

| 项 | 实测值 |
|---|---|
| 构建 | `npx gulp dsh-ide-pack` 成功；`dist/dsh-ide-2.0.0.tgz` **142,011,142 B**（含复核修复与 extrasOf 下沉后的最终重建） |
| 产物 sha256 | `514f996778a45e4fbd4451162ec7d5d37de374bd54b9a54f094495f3ad8b62d7` |
| `verify:dsh-artifact` | PASS（common 11 个模块、Host 入口含 archiveSession/unarchiveSession/searchSessions/loadOlder/throughSeq、node-pty 随包） |
| profile 精确覆盖 | 已按手册 §5/§6 的「按包内路径精确覆盖」把插件层（`index.js`/`client.js`/`package.json`/`icon.svg`/`cordis.patch.yml`/`LICENSE-DSH`/`PROVENANCE.md`/`host/`/`common/`/`locale/`）覆盖到 `$DSH_PROFILE_DIR/node_modules/dsh-ide/`；**未覆盖 `runtime/`**（随包 app） |
| `verify:dsh-install-drift` | **PASS**：24/24 文件逐字节一致、0 漂移、装载配置链完整、入口语法/导出形状合规 |
| 产物内含本轮改动 | **已核对**：解包 `package/runtime/app/out/vs/workbench/workbench.desktop.main.js`（40,358,667 B），可见 `DSH_CODICON_GLYPH_MAP` / `dshIconDataUris` / `registerDshIconReplacement` / `drawnCallIds` / `extrasOf` / `sameSkills` / `withArchived` / `dshSessionItemState` / `answerApproval` / `planReview` 等符号，确认 2-A/2-B/2-C/2-D 代码已进包 |
| 运行时加载 | `cordis_inspect_query(Config.listConfigs{name:"dsh-ide"})` 返回 **`status: "absent"`** —— **仍未加载**，须重启 DSH 才生效。**重启会终止当前会话，AI 不自行执行** |

#### 开发板 Electron 首轮验证（2026-11-17，AI 执行启动、不代替 GUI 验收）

按用户要求「先用开发板 electron 验证，连上 DSH 的 host」，用 `.build/electron/DSH IDE.exe`（Electron 43.7.7 / 产品版本 1.143.1）以 `VSCODE_DEV=1` 启动，并注入 Host 三件套环境变量（`DSH_IDE_ENDPOINT` / `DSH_IDE_LAUNCH_URL` / `DSH_IDE_ENDPOINT_FILE`）与会话 id。

**连接性实测（成立）**：

| 检查 | 结果 |
|---|---|
| `ide/ping`（官方端点，带 cookie） | `{ok:true, root:"C:\\Users\\guyu\\.dsh\\profiles\\desktop", hostPid:16300}` |
| IDE 进程到 Host 端口的 TCP 连接 | 3 条 `Established`（52221 / 56526 / 54649 → 127.0.0.1:58815） |
| 会话列表 | Sessions 面板渲染出当前会话「现在先用开发板electron验证…／E:\DSH-IDE」，数据来自 Host |
| `ide/dispatch` → `listModels` | 返回真实模型目录（`deepseek-account/deepseek-flash` 等），说明桥接 dispatch 通路正常 |
| `$events` 流 | 立即返回 `{"type":"ready","clientId":…,"host":{"home":"C:\\Users\\guyu"}}` |

**首轮暴露的两个真缺陷（均已修，含回归用例）**：

1. **帧被拒 `dsh-ide/invalid-argument`**：`DshIdeSnapshot.state.view.conversation.nodes[3].name must be a non-empty string`。
   - 根因：投影器在官方帧缺 `call.name` 时写空串 `''`（官方 `rootResult` 的 `name: previous?.name ?? ''`，见 `ui-chat/src/client/conversation-nodes/tool.ts`），而**我们自己**的 `validateToolResult` 要求非空 —— 校验器比官方语义更严，把合法帧拒了。
   - 修复：契约注释写明「`name` 允许空串（配对调用离开加载窗口）」；`validateConversationNode` 的 `tool-result.name` 改用 `anyString`；投影器在有 `call` 头时补 `call: null` 与官方一致；渲染侧空名回退显示 `callId`（官方 `records.ts:167` 的「card head shows callId」）。
   - 回归：`build/lib/test/dshIdeConversation.test.ts` 新增 2 项（空名合法、有配对时仍带 name/call）。
2. **`ide/followSession` 静默无帧**：官方 `session/follow` 用同样参数**立即返回 snapshot**（2 turns / 599 steps / projections），而 `ide/followSession` 打开后 20 秒内 **0 帧、也不回错误**；同期 `$events`、`ide/dispatch` 全部正常。
   - 根因：Host 桥接 `_ensureFollow` 的 `pump()` 在官方流结束（窗口被强杀/传输断开）后**没有摘掉 `_follows` 缓存条目**，后续窗口 `_ensureFollow` 命中死流，监听永远收不到帧。
   - 修复：`pump()` 的 `finally` 里按同一实例比对后 `this._follows.delete(sessionId)`。
   - 说明：该修复位于 **Host 半身**（`src/vs/platform/dshClient/host/ide-view-host.js`），只有重启 DSH 才会重新加载，**本轮无法在运行中的 Host 上验证生效**。

**未完成（须用户执行）**：运行中的 DSH Host 是 **2026-11-14 15:58:51** 启动的进程（pid 16300），其内存里的插件代码早于本轮全部改动；`Config.listConfigs{name:"dsh-ide"}` 仍是 `absent`。因此本轮只能验证「连接建立 + 上述两个缺陷的定位与代码修复」，**不能**断言新版 Host 半身与 2-A~2-D 在真机上的最终表现。需用户重启 DSH 后再复验。

#### 第二轮：用官方 `session/follow` 快照核对投影与其余调用（同一 Host）

抓到当前会话的 opening snapshot（348 条 records，`hasMore: true`）。投影后 159 个节点（assistant 48 / tool-call 55 / tool-result 54 / context 2）**整帧通过** `validateDshIdeSnapshot`。`plan` / `goal` 与官方 values 一致。`todos: null` 是「没有待办」，不是丢字段。窗口里的 2 条 `user/message` 是注入上下文，投影成 context，不是用户气泡；更早的用户消息在 `hasMore` 之后，要靠 `loadOlder`。

另外核对并修掉的连接问题：

| 问题 | 证据 | 处理 |
|---|---|---|
| `composerState` 在运行中的 Host 上返回 `gateway/internal: Cannot read properties of undefined (reading 'aborted')` | 直接调 `ide/dispatch` | 官方 `projections/prompt/page/state/search` 的第二参是 `AbortSignal`。源码没传。已在 Host 桥与开窗预取补上 |
| 技能目录到不了界面 | follow 的 `projections.values` 没有 `skills`；`listSkills` 用 `ctx.skills.list({ scope: sessionId })`，而官方目录是 `sessionSkillCatalog.list({ sessionId }, signal)`（`SkillEntry`，无 provider） | 改走官方目录；`provider` 改为可选；内容帧不再把缺省的 skills 当成空目录清掉；`attach`/`bind` 会调用 `listSkills` |
| 子会话 `session/follow` 返回 `session/agent-busy` | 官方文案：`subagent Sessions require their durable parent address` | 不是缺陷。工作区记账里 DSH-IDE 只挂了当前根会话；5 个子会话 `origin: subagent` 且 `agentAvailable: false`，面板不列它们是对的 |
| 快照里的 `userQuestions.active` 没有进待决议卡 | 官方 `PendingUserQuestion` 只有 `callId`，回答走 waterfall 的 `eventId` | 不投影。中途接入时，已经发出的问卷要等下一次 waterfall；不能用 callId 冒充 eventId |

这三项里 Host 半身的改动同样要重启 DSH 才进正在跑的进程。

#### 第三轮：对照官方源码核对全部 Host 入口

逐个对照 `E:/deepseek-harness` 里的服务签名。`sessionController` 的 list / search / create / selectModel / modelCatalog / prompt / cancel / fork / page / state / follow / projections，以及 `commands.execute` / `commands.list`、`agentTeams.setEnabled`、`agentPresets.select` / `list`、`permissionPresets.catalog`、`attachments.readImage`、`deepseekAccount.getState` / `getProfile`、`goals.edit|pause|resume|complete|clear`、`llm.stream`、`agentDefaultModel.currentSelection`、waterfall 事件名，签名与现有调用一致。

又修掉三处对不上的调用：

| 问题 | 官方签名 | 处理 |
|---|---|---|
| 归档 | `workspaceController.archiveSession({ sessionId })` 返回集合；`workspaceRegistry.archiveSession(sessionId)` 返回 void | 优先走 controller；没有 controller 时用字符串 id 调 registry，再读 `archivedSessionIds` |
| 创建目标 | `remoteExportCreate` 只回 `{ ref }`；`create` 回 `GoalView` | 改走 `create`，再用 `projectGoalView` 投影 |
| 带图提交 | `admitPromptContent` 的已入库图片要带 `encodedBytes` | 提交时带上附件的 `bytes`，限额检查不再变成 NaN |
| `fork.point` 非数字 | `atSeq` 必须是非负整数；`Number('head')` 是 NaN，JSON 会收成 null | 不是纯数字就 `invalid-argument`，不发给官方 |

正在跑的 Host（cordis `Service.listService`）上，`workspaceController.archiveSession`、`goals.create`、`sessionSkillCatalog.list`、`commands.execute` / `list` 的签名与上面的改法一致。Host 进程里的插件代码仍是 2026-11-14 加载的那份，要重启 DSH 才会换成这份。

### 9.6 第二阶段实施顺序（已定）

> **2-A（修数据链）与 2-B（翻译层升级）为主线顺序推进；2-D（图标全局替换）与 2-A/2-B 并行启动；2-C（Session 缺口）随主线核对；全部代码完成、门禁全绿后，最后统一做 2-E（真机验收）。**
>
> 真机验证不在中途分批做：等 2-A/2-B/2-C/2-D 全部完成、`verify:dsh-ide-ci` 全绿后一次性由用户执行（AGENTS.md §6）。
>
> 全程不改协议/通道/Host/状态层（§5 冻结边界），不改原生渲染工厂，不做注册表，不恢复 driver。

**并行排期**：

| 轨道 | 内容 | 依赖关系 |
|---|---|---|
| 主线 A | 2-A 修 `plan/goal/todos/skills` 数据链 | 先做，是 2-B 的前置 |
| 主线 B | 2-B 翻译层升级（B1→B5 分批 TDD） | 依赖 A；逐批跑门禁 |
| 主线 C | 2-C Session 缺口核对 | 随主线，无硬依赖 |
| 并行 D | 2-D 图标全局替换（资源生成→映射→getCSS→覆盖点→主题验证） | **与 A/B 并行**，独立工作流、独立门禁，不阻塞主线 |
| 收尾 E | 2-E 真机验收（用户执行） | **全部完成后**统一做 |

### 9.7 能力限制与非缺陷（保持不变）

- `addAttachment`/`removeAttachment`/`openInApp`/`dismissQuotaNotice` 无官方 remote，也没有这两插件的 Host 接口：保持 `FEATURE_UNAVAILABLE`。
- `rewind` 依赖已装载的 `dsh-rewind-plugin`；`deleteSession` 依赖已装载的 `@michengai/dsh-archive-manager`。插件页上的依赖说明以后再写。
- 附件上传/移除只能在 prompt/命令提交时内联 admit。
- DSH 特有纯装饰（鲸鱼动画、TurnNavigator、PixelWhale、onboarding、KaTeX）本阶段不做；VS Code 自身 Mermaid/Markdown 完整保留。

### 9.8 用户决策（已定）与执行边界

1. **真机 GUI 验证时机**：**全部代码完成、门禁全绿后统一验证**，不在中途分批做。由用户执行（AI 不代跑）。
2. **图标替换排期**：**与 2-A/2-B 并行**启动，独立工作流、独立门禁（2-D）。
3. **临时文件**：`.dsh-preview/`、`.session_dump.txt` 已删除清理（经用户确认终止占用目录的两个临时预览进程 `serve.cjs` / `serve-chat-view.cjs` 后删除）。二者未被 git 跟踪，不进版本库。

