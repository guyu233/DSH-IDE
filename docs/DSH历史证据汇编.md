# DSH 历史证据汇编

> 本文件由四份历史文档合并而成，只作为历史证据索引，不定义现行路线。现行入口见 `docs/README.md`；现行内容架构见 `DSH-IDE内容原子化契约.md`；协议真源见 `src/vs/platform/dshClient/protocol/dshIdeProtocol.ts`；当前状态以 `PROJECT_AUDIT.md` 最新轮次为准。
> 文中所有 `E:/deepseek-harness`、`wireRevision 3/4`、旧 method 数、旧路径和“正文不显示”等结论均为当时快照，必须按当前协议与源码复核。

---

## 原文件：`docs/DSH-IDE改造开发手册.md`

# DSH-IDE 改造开发手册（历史施工记录）

> 历史定位：本文记录 2026-11-16 至 2026-11-18 第一/第二阶段施工过程与当时依据。**不是当前内容架构规范，也不是当前状态真源。**
>
> 现行入口见 [`docs/README.md`](README.md)。现行内容架构以 `DSH-IDE内容原子化契约.md`、`DSH-IDE内容原子化差异表.md` 为准；协议真源是 `src/vs/platform/dshClient/protocol/dshIdeProtocol.ts`；当前状态与最新门禁以 `PROJECT_AUDIT.md` 最新轮次为准。
>
> 本文中的“不做 slot / 不做注册表 / 写死投影”等段落均属于历史路线，已被内容原子化契约取代，不得用于当前实现判断。
>
> 所有 `file:line` 与 `E:/deepseek-harness` 路径均为历史快照，需在线复核；真机 GUI 验证由用户执行，AI 不代跑。

---

## 0. 历史决策与目标基线

### 0.0 开发/验证流程（2026-11-17 用户明确，优先于本文所有打包记录）

> **现阶段不做打包。** 开发中的功能与界面验证一律用**开发版 Electron**（`.build/electron/DSH IDE.exe`，`VSCODE_DEV=1`，注入 Host 三件套环境变量）启动后实测；等全部开发完成后，才进入打包环节（`gulp dsh-ide-pack` / `verify:dsh-artifact` / `verify:dsh-install-drift`）。
>
> - 每个功能批次完成后：跑相关单测 + 用开发版 Electron 连 DSH Host 验证功能/界面，发现问题就地修。
> - **打包、profile 覆盖、install-drift、tgz 产物核对等只在"开发完成"节点做一次**；§9.5 里已有的打包记录是历史实测，不是当前每轮必做项。
> - 真机 GUI 观察仍由用户执行（AGENTS.md §6）；AI 只负责启动开发版 Electron、连通性与代码级定位，不以代码推断界面结论。

### 0.0.1 源码参考约定（2026-11-17 用户明确）

> **不在本机下载或保留 DSH / VS Code 整仓副本。** 本机原先的 `E:/deepseek-harness/` 参考目录不再作为依据。需要核对官方源码时：
>
> - DSH：`https://github.com/deepseek-ai/deepseek-harness`（在线最新）；
> - VS Code：`https://github.com/microsoft/vscode`，或直接读本项目 `src/**`（即 VS Code 工作副本）；
> - 已安装 DSH 的 `resources/app.asar` 仍可只读参考（与 AGENTS.md §2 资源复用一致）。
>
> 本文及历史分析文档里出现的 `E:/deepseek-harness/...:line` 是**历史快照证据**，仅记录当时依据，不代表本机仍有该目录；后续以在线最新源码为准，契约形状以 `src/vs/platform/dshClient/protocol/dshIdeProtocol.ts` 为真源。

### 0.0.2 文档证据纪律（强制）

> 本仓文档中的事实性结论必须同时具备两类证据，缺一不得写成事实：
>
> 1. **DSH 真源证据**：在线核对 `https://github.com/deepseek-ai/deepseek-harness` 的具体文件、路径、commit/HEAD、类型或注册点；不得凭记忆、博客、历史快照或本地已删除目录下结论。
> 2. **DSH-IDE 证据**：本项目当前 `src/**`、`build/**`、测试或实测记录中的具体文件、函数、行号或门禁输出；不得以“计划中”“应该会”“数据有了”冒充界面已经显示。
>
> 证据写法统一为：`DSH 真源路径/符号` → `DSH-IDE 当前实现路径/行为` → `差异` → `目标策略（复用 / 改造 / 自研）` → `验收状态`。
>
> 分类必须分开标注：
>
> - `已实现`：代码存在且测试/行为验证通过；
> - `部分实现`：代码或数据存在，但界面不可见、不可点、未回读或语义不完整；
> - `未实现`：只有计划或文档，没有可验证代码；
> - `PENDING`：需要真机验证，未跑不得写 PASS。
>
> 历史分析文档只能作为证据索引，不能作为现行真源。现行真源固定为：`AGENTS.md`、本手册、`docs/PROJECT_AUDIT.md`、`docs/DSH-IDE内容原子化契约.md`、`docs/DSH-IDE内容原子化差异表.md` 与 `src/vs/platform/dshClient/protocol/dshIdeProtocol.ts`。

### 0.1 已作废的历史路线（不得用于当前实现判断）

> 本节保留历史决策供审计，不再作为现行渲染架构依据。  
> 现行内容架构以 `docs/DSH-IDE内容原子化契约.md` 和 `docs/DSH-IDE内容原子化差异表.md` 为准：以 DSH slot/node/renderer 语义为标准，VS Code 原生优先，原生不足则改造或自研原生化组件。

历史路线原文概要（已作废）：

**在现有原生 chat 面板上改造，只承接 DSH 源码内置官方内容；不使用 WebviewView，不运行 DSH Web renderer，不扫描非官方插件资源。**

该段曾提出“不做 slot 化 / 不做描述性 slot registry / 不做规则表”，已由 `DSH-IDE内容原子化契约.md` 取代。保留此概要只为说明历史决策来源，不代表当前实现约束。

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

### 1.3 frame 与 typed 投影并存（wireRevision 5）

`DshIdeViewSnapshot` 仍保留 `frame: Readonly<Record<string, unknown>>` 作为兼容字段，同时可带 13 个 typed 字段：`conversation`、`deliverables`、`attachments`、`plan`、`goal`、`todos`、`skills`、`team`、`worktrees`、`tokenUsageDelta`、`quotaNotice`、`composer`、`pending`。字段全部可选；一旦出现，未知字段或未知节点种类 fail-closed 拒绝。

**当前实现已切到 typed 字段**（层 3 完成）：renderer 的 `DshChatModel.acceptConversation` 只吃 `conversation` 节点树，裸帧解析路径已删除（`accept(frame)` 为兼容空壳）。四条独立通路的状态：

- nodes：`DshIdeViewSnapshot.conversation` 的 `DshIdeConversationNode[]`（`dshIdeConversation.ts` 投影，Host 侧产出）；
- pending：快照 `pending` 字段（`waterfall` 仍用于运行中的增量帧）；
- modelMenu：仍走独立的 `composerState` 一元调用（`dshLanguageModelProvider`、`dshComposerSource`、`dshChatSession` 三条消费方在用，合并进快照属后续工作）；
- session 状态：独立 `subscribeSessionNotice`。

`ide-view-service.ts` 现在把 `conversation` / `deliverables` / `attachments` / `plan` / `goal` / `todos` / `skills` / `quotaNotice` / `pending` 一并挂到快照上。

### 1.4 当前承接能力

**能承接（层 1 已落地）：** `session/follow` 事件流（快照式）；`submit` 带图片附件（Host 写成官方 `{ type: 'image', attachment }`）；审批/问卷富字段投影（`displayReason`、`detail/header`、选项 `description`、`multiSelect`、`intent`，`dshIdeRequestView.js`）；waterfall 阶段状态；`listSessions`/`searchSessions`/`resume`/`fork.point`/`loadOlder{throughSeq,beforeSeq,maxMessages}`；模型/effort/权限/团队/preset 投影；开窗绑定会话。

**不能承接（改造目标，层 4 已逐类补齐）：** 协议已定义但 Host 未填的 typed 字段——**现已全部有 Host 来源**（见 §8.1）；原先 4 个 `missing()` 空壳已从契约移除；`fetchRowDetail` 明确抛 `FEATURE_UNAVAILABLE`（官方无对应只读端点）；`runCommand` 附件已支持图片；chat 逐类写死渲染器——**现已全部落地**（见 §8.1）。

### 1.5 协议现状（改动前记住这些数字）

- `DSH_IDE_WIRE_REVISION = 5`（`dshIdeProtocol.ts`）。把视图绑定带进快照后由 4 升到 5。
- `DshIdeMethodArgs` 共 **49 个 method**（2026-11-17 新增 6 个会话操作；之后接入语音、补全、附件入库、账号登录、MCP、后台作业）。`missing()` 已清零；`setGoal` / `listSkills` 接官方 `goals` / `skills` 服务（见 §8.1）。
- 旧稿点名要新增的 `searchSessions` / `resumeSession` / `forkAt` / `loadThrough` **不另增**：`searchSessions` 与 `resume` 已在白名单；`fork.point` 已映射官方 `atSeq`；`loadOlder.throughSeq` 已是官方切点。
- `validateDshIdeSnapshot`（`:1157`）、`assertSnapshotContinuity`（`:1963`，version 严格 +1）、`validateDshIdeInvokeOutput` 只允许 `{value}`（`:933`）。
- `DshIdeWaterfallNotice`（`:1058`）、`DshIdeSessionNotice`（`:1054`）形状固定；扩展 listen 事件面必须先改契约并同步测试（`:924-931`）。
- consumer 当前只处理 snapshot，测试钉死不处理 waterfall（`build/lib/test/dshIdeEndpoints.test.ts:328-331`）。

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

**§4.5 Attachments**：上传附件、消息图片、文件引用、prompt 与 receipt 绑定、历史附件读取。`submit` 带附件 ref，`readAttachment` 读取，图片用 DOM `<img>`/themed icon。协议已有 `DshIdeImageAttachmentRef`（`:136-145`），不重新发明。不接 DSH 拖动上传组件与 native clipboard/file IPC。

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
   - 无官方 remote 的空壳已全部移除：`addAttachment` / `removeAttachment`（附件改走 `saveImageAttachment`）、`openInApp`、`dismissQuotaNotice`；`setGoal` / `listSkills` 已按官方 `goals` / `skills` 服务接线（见 §8.1）；
   - **不新增** `searchSessions`、`resumeSession`、`forkAt`、`loadThrough`（见 §1.5）。
3. 形状变化已经把 `DSH_IDE_WIRE_REVISION` 升到 5，并同步了 `validateDshIdeView` / `validateDshIdeSnapshot` / `assertSnapshotContinuity`。
4. 三条不变量：`exactRecord` 白名单（拒绝未知字段与显式 `undefined`，`:306-324`）、`version` 严格 +1、gap/倒退 fail-closed。
5. 门禁已改到 49 个 method。listen 白名单仍是 snapshot / waterfall / session-notice 这 3 个事件。

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

1. `IDshChatSession`（`:39-74`）接口按当前契约 method 对齐：`submit(text, attachments)`、`answerApproval/answerQuestion`（多选答案）、`listSessions/searchSessions/loadOlder{throughSeq,beforeSeq,maxMessages}`、`resume`/`fork.point`/`rewind`（rewind 走已装载的 `dsh-rewind-plugin`，不是 core remote）、`deliverables`、`tokenUsageDelta`、`quotaNotice`、`pending`。4 个无官方 remote 的 `missing()` method 只暴露禁用态或明确失败提示，不伪造成功。**注意**：`plan/goal/todos/skills` 虽已在契约与 Host 投影层就绪，但状态层 `DshChatSession` 尚未保存/暴露（真缺陷，见 §9.5 阶段 2-A）。
2. 移除 renderer 从裸 follow 帧拼节点的逻辑（`dshChatModel.ts` 的 `acceptConversation`，`:394` 起），直接消费层 1 的结构化 conversation。
3. `tokenUsage` 唯一真源在 `DshChatModel`（`:364`），`pending` 在 `DshChatSession.pendingItems`（`:89`），`running` 在 `_running`（`:92`）；扩展时**保持单一真源**。
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

- 测试入口：`package.json:80-91` 的 `build-dsh-tests`、`test-dsh`、`test-dsh:all`、`verify:dsh-ide-*`、`verify:dsh-ide-ci`；`dshIdeEndpoints.test.ts` 在 `test-dsh:all` 显式列表内。
- **开发期每批**（按 §0.0）：相关单测 + 增量类型检查（改动文件零错误）+ 开发版 Electron 连 Host 验证功能/界面。**不做打包。**
- **开发完成后一次性**：全量 `tsc --noEmit` + `npm run test-dsh:all` + `verify:dsh-ide-ci` + 打包（§0.0）。
- 提交信息写清「做了什么 / 门禁实测结果 / 未完成项」；PENDING 不计入通过；真机 GUI 由用户执行。

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

## 5. 交付稳定性契约（层 1–3 已完成；层 4 UI 亦已落地）

> **状态（2026-11-16，已全部达成）**：层 1（契约）+ 层 2（Host 投影）+ 层 3（renderer 状态层）已按本章稳定性条件完成并提交；层 4（chat 视图容器 UI）也已逐类落地（§8.1）。`verify:dsh-ide-ci` 全步骤 PASS。本章保留为交接边界的定义：若后续真机验证发现问题，改动仍须遵守下列冻结边界——不再在协议/通道/Host/状态层之外另起通道或在前端重写投影。

> 本章原始要求：**层 1 + 层 2 + 层 3 全部完成并冻结后，才把工作交给 chat 视图容器前端改造。** 交付时下游只需要写渲染器和绑定 view，不再触碰协议、通道、Host 桥、会话状态模型。
>
> **第二阶段例外（2026-11-16 源码核对后新增）**：§9.5 阶段 2-A 发现 `plan/goal/todos/skills` 在状态层从未保存/暴露（真缺陷），允许**仅这四个字段**在 `DshChatSession` 补只读 getter、`acceptView` 保存与 `bind` 清空；这不改变冻结契约的形状/通道/Host/协议，只是补齐层 3 原本遗漏的只读暴露。除这四项外，§5 冻结边界全部保持。

### 5.1 稳定性边界：前端改造只允许改这些文件

交付后，chat 容器前端改造只允许新增/修改 chat 视图容器与渲染器文件（`workbench/contrib/dsh/browser/` 下的 `dshChatHistory.ts`、`dshChatSessionContent.ts`、`dshSessionSearchCommands.ts`、`dshTeamCommands.ts` 等），**不得再改**：

- `src/vs/platform/dshClient/common/dshIdeProtocol.ts` 及契约校验（`dshIdeContract.ts`、`dshIdeEndpoints.test.ts`）；
- `src/vs/platform/dshClient/host/*`（`ide-view-host.js`、`ide-service.js`、投影函数）；
- `src/vs/platform/dshClient/electron-main/ide-view-service.ts`、`dshIdeChannel.ts`；
- `src/vs/workbench/contrib/dsh/browser/dshChatSession.ts`、`dshChatModel.ts`（层 3 状态层，扩展须走新增字段流程）；
- `dshIdeConsumer.ts`（消费与合并逻辑：新增 typed 字段时必须同步 `DSH_IDE_VIEW_OPTIONAL_KEYS`）。

上述边界约束的是「为绕过契约而改」，不是「为新增 Host 能力而改」。新增能力必须走同一条唯一通道：先改契约真源（`dshIdeProtocol.ts` 的 `DshIdeMethodArgs`、`DSH_IDE_METHOD_KEYS`、`validateDshIdeInput` 与 `DSH_IDE_VIEW_KEYS`），再改 Host handler，再改 renderer 消费方，并同步协议与红线测试。同一能力只允许一处实现、一个入口；禁止另开旁路通道或在渲染层自拼投影。

### 5.2 层 1 稳定性条件（契约已完成；新增能力须走扩展流程）

1. `DSH_IDE_WIRE_REVISION = 5` 固定；冻结后非全局重开不允许再 bump。5 相对 4 的唯一变化是把**视图绑定**（`binding: { viewId, generation, sessionId }`）带进快照、`ide/followSession` 与 `ide/dispatch`：两半必须同时是 5，缺字段或修订号不符一律拒绝，不按 4 的形状降级。
2. `DshIdeViewSnapshot` 的 13 个 typed 字段（`conversation`、`deliverables`、`attachments`、`plan`、`goal`、`todos`、`skills`、`team`、`worktrees`、`tokenUsageDelta`、`quotaNotice`、`composer`、`pending`）形状锁定；前端按这些类型写渲染器，不再等字段变更。
3. 49 个 `DshIdeMethodArgs` 锁定；`missing()` 空壳已清零：`addAttachment` / `removeAttachment` / `openInApp` / `dismissQuotaNotice` 因无实际落点已从契约移除，附件改走 `saveImageAttachment`。`setGoal` / `listSkills` 已接线（见 §8.1）。
4. 三条不变量（白名单、`version` 严格 +1、fail-closed）和 listen 白名单 3 事件冻结。
5. **会话范围的方法必须自带发起时的 `sessionId`**（`DSH_IDE_VIEW_BOUND_METHODS`：`submit`、`interrupt`、`resume`、`rewind`、`loadOlder`、`setModel`、`setEffort`、`setPermissionPreset`、`runCommand`、`composerState`、`setTeamEnabled`、`setAgentPreset`、`listCommands`、`readAttachment`、`setGoal`、`listSkills`）。不存在「省略即当前会话」的回退；Host 只核对，不改写目标。
6. **显式行操作按可见行校验**（rename / favorite / pin / move / openPath / delete / archive / unarchive / fork）：不要求等于当前绑定会话，但该行必须出现在官方可见名单里。`listSessions` 与 `capabilities` 按发起视图的绑定取范围；模型目录这类宿主级事实不借用活动会话。

### 5.3 层 2 稳定性条件（Host 投影已完成；新增字段须走扩展流程）

1. **follow 帧 → `conversation` 的投影由 Host 完成**：renderer 收到的 snapshot 里 `conversation.nodes` 已是官方装配后的节点数组（`user/steering/context/turn-trigger/assistant/tool-call/tool-result/command/compaction/model-retry/turn-error/turn-max-tokens/inherited-history`），前端只管画，不再从裸 frame 拼。`subagent/catalog` 不是节点 kind，走 `conversation.subagentCatalog` 投影通道（对齐官方 `SessionProjectionMap['subagentCatalog']`）。
2. **其余 typed 字段由 Host 填齐**：`deliverables`、`attachments`、`plan`、`goal`、`todos`、`skills`、`team`、`worktrees`、`tokenUsageDelta`、`quotaNotice`、`composer`、`pending`；字段缺省只能表示「该会话没有此内容」，不能表示「Host 还没实现」。
3. **审批/问卷的富字段投影冻结**：`displayReason`、`detail/header/description/multiSelect/intent` 已在 typed `pending` 里；`agent`/`signal` 永久不进协议。
4. **`fetchRowDetail` 不再返回 `null`**（或明确文档化为官方不可用并给禁用态）；`runCommand` 不再传恒空附件。
5. **非官方插件过滤冻结**：白名单外的 event/projection 在 Host 丢弃，前端不会收到未知形状。
6. `ide-view-service.receive` 把 typed 视图连同 `frame` 一起 publish；`frame` 只是兼容回退，前端稳定路径不依赖它。
7. **终态唯一且必须投递**：`pending` 每帧下发完整清单（含空清单），空清单不得省略；取消帧只带 `eventId`，传输层不得要求它带 `event`。一次决议的终态必须广播给所有视图，已收到终态的 `eventId` 不再接受任何请求帧或恢复路径。
8. **决议必须匹配请求种类**：批准不能结算问卷，反之亦然；种类不符返回 `INVALID_ARGUMENT` 且原请求继续等待。桥销毁时逐个结算本桥等待者（交还 `undefined` 给下一个 answerer），不允许清 Map 留悬空 Promise。
9. **问卷不静默缩写**：原生面板只显示第一题，但待决议项保留全部题目。只有「单题、单选、有选项」由原生卡片提交；多题、多选、无选项一律不提交部分答案，明确交还桌面入口并提示用户（DEC-005 能力边界）。
10. **发送目标三态互斥**：没有 content provider 才是原生链路；有 provider 但拿不到会话对象属「不可用」，必须保留草稿并报错，**不得**改走原生链路（那等于把发送交给另一个内核）。DSH 会话被接受后必须走一次原生完成路径（隐藏欢迎页、`acceptInput` 写历史并清草稿、接受回调、目标摘要），成功只清一次草稿。
11. **附件只认已入库引用**：`submit.attachments` 只接受 `ImageAttachmentRef`。原生图片条目没有入库 id，禁止凭空构造；无法承接的图片一律拒绝整次发送并保留草稿，不静默丢弃。
12. **实时窗口与翻页历史分开存放**：实时 `conversation` 帧整体替换上一窗口，但 `loadOlder` 读入的旧页跨帧保留，两者在 `list` 里按 seq 合并、同 identity 以实时窗口为准。分页游标取「已读到的最早 durable seq」，**不取**可见窗口的最小 seq——旧页被挤出画面后从可见窗口取会漏掉中间那段记录。
13. **翻页终止是单向的**：空页强制结束翻页；一旦确认读到日志开头，后续实时帧自称「还有更多」不得把翻页重新打开。只有换绑（`clear`）才复位游标与终止状态。
14. **`generation` 只在换绑/重建时递增**，不随 `version` 走；把两者绑在一起会让每个内容帧都像一次换绑。
15. **合并窗口保留基线字段**：16ms 合并窗口内，同绑定且都为 ready 的帧按字段合并；「缺席 = 本帧没带」的字段从上一份视图补回，显式空值（`todos: []`、`pending: []`）照原样覆盖。换绑或退出 ready 时后一帧就是新事实，前一帧视图一律丢弃。
16. **非 ready 帧不重发旧视图**：`starting` / `rebuild` 必须让 `view` 为空；回到 ready 时不得把中断前的内容当作保留基线重新画出。
17. **关闭世代拦截废弃调用**：`close()` 递增关闭世代；每个 `await` 之后的恢复点（握手完成、端点重发现重试、跟随建立）都比对世代，不符即以 `dsh-ide/cancelled` 丢弃，绝不向已关闭的窗口派发读取。
18. **Markdown 供应链锁下限**：四处 `markdown-it` 解析（根、`build/`、`extensions/extension-editing`、`extensions/markdown-language-features`）一律 `>=14.3.3 <15`；升级只改条目的 `version`/`resolved`/`integrity` 三行，不得整体重写锁文件。
19. **原生选择必须写回内核**：原生模型选择器只改本地状态；由 content provider 驱动的会话（DSH）在**用户操作**时必须把选择写回 `setModel`，程序性同步（恢复、默认值、会话切换）不得当成一次选择写回。写回身份取 `identifier`（`<provider>/<model id>`）而**不是**显示名，且只按第一个斜杠切分——模型名本身可以含斜杠。内核拒绝时不改本地当前模型、不发「已切换」通知：选择器不把「显示成功」当成成功。
20. **共享流对每位订阅者一致**：同一会话仍只开一条官方流，但每位订阅者都必须收到**同一份 opening 基线**；后来者不得只收到增量。上游正常结束与异常结束都显式广播 `follow-ended`，不允许静默删表让订阅者无限等待。释放按引用身份：旧句柄只结束自己那一份，不得删掉期间新建的流。待送帧有上限，超过时丢弃旧增量并插入 `follow-overflow` 让上层重读基线，不静默截断。
21. **投影必须消费官方位置语义**：`surfaceOp` 的 `replace`（`{ op, startSeq, endSeq }`，闭区间、按当前 surface 顺序）必须让被覆盖的旧节点消失，且不得删掉本事件自己；`append` 按追加处理。流式基线（snapshot 的 `assistantStream`）的 `revision` 取**外层** `assistantStream.revision`，不取内层 `activeAttempt.revision` 镜像——读内层会在形状变化时退化成 0，使后续 chunk 被误判为「不新」而丢弃。
22. **开窗结果是三态**：`registered-ide` 才算真的把窗口开了（`opened: true`）；刚拉起进程只是**排队**（`opened: false, queued: true`），不得报成已开窗。`spawn` 只代表请求已提交，必须等 `spawn` 或 `error` 事件判定，并检查 `pid`；异步 `error` 不得漏掉，否则「根本没起来」会被报成成功。
23. **写回按序号采纳，队列任务执行时复核**：归档/恢复回包是**完整集合**，只能整体采纳且只采纳序号最新的那一次；较旧回包描述的是旧意图，直接丢弃，不得覆盖较新结果。入队前检查归属不够——排队期间视图可能换绑，收藏/置顶等排队任务必须在**执行时**重新核对目标行仍可见。
24. **外部资源探测必须有界且必结算**：读取远端图片尺寸时必须有字节上限与时限，超限或超时明确返回「读不到」，不得把整图读进内存、也不得永久挂起。解析失败只在「流已结束」时才是最终结论——那时必须结算，不允许把解析错误吞掉让 Promise 悬空。

### 5.4 层 3 稳定性条件（renderer 状态层已完成；新增字段须走扩展流程）

1. `DshChatSession` / `DshChatModel` 已改成消费 typed 字段，`DshChatModel.accept()` 直接从 `snapshot.conversation` 建节点树，不再解析裸帧。
2. 四类独立通路已合并到 typed 字段和统一 state：`nodes`（conversation）、`pending`、`composer`（modelMenu）、session notice；前端通过统一会话状态读取，不再各自订阅裸事件。
3. 单一真源明确：`tokenUsage` 在模型层、`pending` 在会话层、`running` 在会话层；前端只读，不再累加或二次推导。
4. `IDshChatSession` 暴露前端所需的全部读接口与 49 method 的调用入口；接口冻结后前端只调用，不改签名。
5. `DshIdeConsumer` 已把 16ms 合并、version 连续性、fail-closed 处理完，前端不再做协议校验。

### 5.5 稳定性验收（移交前端前的 gate）

移交前必须同时满足：

- `tsc --noEmit`：本轮改动涉及的协议/Host/renderer 状态层文件零类型错误；若全量 `tsc` 因既有 VS Code 文件失败，记录在案但不阻塞移交（不得写成 PASS）。
- 测试：协议、通道、waterfall、Host 桥、dshIdeConsumer、endpoints 全 PASS；新增的 typed 投影往返测试全 PASS。
- 当时记录：`dshSlotRegistry.test.ts` 曾被视为遗留；现行原子化契约已将 `dshSlotRegistry.test.ts` 纳入定向门禁，以当前 `docs/DSH-IDE内容原子化差异表.md` 为准。
- 真机界面显示仍属前端改造完成后的用户验证项，AI 不代跑。

### 5.6 前端改造的最终输入（前端只需要这些）

冻结后，chat 视图容器前端拿到的稳定输入只有：

- `DshIdeViewSnapshot` 的 13 个 typed 字段（§5.2）；
- `DshChatSession` / `DshChatModel` 的只读接口（§5.4）；
- 49 个 `ide/dispatch` method 的调用入口，全部可用；无禁用态空壳（§5.2）。

前端不需要也不允许知道：裸 follow 帧形状、官方 event 名、Host 服务名、投影函数、wireRevision、channel 白名单、version 合并。

### 5.7 历史凭据勘误（不修改保留原文）

`build/lib/dsh/PROVENANCE.md` 与 `build/dsh/chat-render/PROVENANCE.md` 是**留存的历史凭据**，按 §5 与 AGENTS §5 的规定**保留原文、不得删改**。其中两处描述已与现行实现不符，在此集中勘误，避免读者按旧文理解现状：

1. **「旁挂 sidecar esbuild 编译（运行时唯一构建入口）」**（`build-render.mjs` 条目）：现行实现**没有** sidecar 运行时产物。聊天内容由 `dshChatSessionContent` 的 content provider 直接提供 history；打包期 `prepare-dsh-chat-render` 只把鲸鱼图标写进 bundle 的 `media` 目录（见 `build/gulpfile.vscode.ts` 中该任务注释「不再有 sidecar 产物」）。因此该条应读作「历史说明：早期用 sidecar 渲染」，不是当前运行路径。
2. **`dist/dsh-chat.js` / `dist/dsh-chat.css` 的入库边界**：该段描述的产物与 `.gitignore` 规则仍成立（产物不入库），但**不再**是运行时加载路径——运行时不加载这两个文件。

处置方式固定为「只在此处加勘误，不回写原文」：修改 PROVENANCE 会破坏凭据的可核对性，也让「原文」与「当前状态」混为一谈。若后续需要更新凭据，另立新文件并在本小节登记，不覆盖既有原文。

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
| 层 1 契约（wireRevision 3→5） | `dshIdeProtocol.ts` 补齐 typed 字段及校验器；`runCommand` 支持图片附件；`loadOlder` 接受可选 `conversation` |
| 层 2 Host 投影 | typed 字段全部有官方来源；`setGoal` 接官方 `goals` 六动作、`listSkills` 接 `skills.list()`；`fetchRowDetail` 由 `return null` 改为明确 `FEATURE_UNAVAILABLE`；非官方插件数据在桥层过滤 |
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
- 历史死代码清理记录：`dshModelMenu.ts`、`dshHistoryPager.ts`、`dshMappingVerifier.ts`、`dshNodeViews.test.ts`。`dshSlotRegistry.test.ts` 已由现行原子化契约恢复为门禁测试，不再按死代码处理。

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
## 9. 当前状态：第一/第二阶段代码完成；开发版 Electron 验证中；打包推迟到开发完成后

### 9.1 阶段划分与当前进度（按 2026-11-17 草稿迭代）

草稿在 2026-11-17 14:11 重写为进度版：已完成部分压缩为摘要，未完成部分给出方案。当前状态：

| 阶段 | 状态 | 说明 |
|---|---|---|
| 路线决策 | 完成 | 原生 chat 面板 + 翻译层，不引入 slot / Webview（§0） |
| 第一阶段（层 1–4） | 完成并冻结 | 数据通路、契约、Host 投影、状态层、逐类 UI 接线（§8） |
| 第二阶段 2-A~2-D | **代码完成** | 门禁全绿；历史曾打包并装入 profile，但按 §0.0 现流程打包推迟到开发完成后（§9.2–§9.5） |
| 第二阶段 2-E | **开发版 Electron 验证** | 用 `.build/electron/DSH IDE.exe` 连 Host 验证功能/界面（§9.5 2-E）；不做打包 |
| **子智能体会话树** | **代码完成（全量门禁 PASS）** | 用户确认三项决策后实现：纯 renderer 改动、原生 `IChatSessionItem.children`；新增 `dshSessionTree.ts` 与 9 项单测（§9.9）。全量门禁已复跑 PASS，真机验证并入 2-E |

> 重启前运行中的 DSH Host（pid 16300，2026-11-14 启动）内存里的插件代码早于本轮改动；开发板 electron 已完成连接性与两轮源码核对（§9.5 2-E），但**新版 Host 半身与 2-A~2-D 的真机最终表现须重启后复验**。

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
4. **契约边界**：本阶段不改协议/通道/Host；如需新增能力，按 §5.1 的扩展流程先改契约真源。

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
3. **纯函数抽取**：新增 `dshSessionItemState.ts`（`withArchived` / `withRead` / `timingForRunning`），把「找不到行 / 值没变 / 保持行身份」的语义从控制器里拆出来，可用零 DI 单测覆盖；新增 `build/lib/test/dshSessionItemState.test.ts`（5 项）。（两者均已在第 1 轮瘦身删除，等价逻辑现内联在 `dshAgentSessionsController.ts` 与 `dshSessionTree.ts`。）
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

1. **资源生成脚本**：新增 `build/lib/dsh/genDshIconDataUris.mjs`（带 `--check` 漂移模式）。实测官方 `ICON_ARTWORK` 为 **104** 个 glyph（不是草稿写的 109），生成 `dshIconDataUris.ts`（约 94 KB）；每个 glyph 按 regular stroke=1 求值，兼容三种声明（`strokeWidth => \`…\``、`() => '…'`、`strokeWidth === ICON_MEDIUM_STROKE` 三元的 medium/regular 两支）。data URI 全量 URL-encode（含单引号转 `%27`），保证可直接放进 CSS `url()`。
2. **映射表**：`dshCodiconMap.ts` 手写 60+ 条语义对应（search/plus/close/copy/branch/check/chevron/…），并在 `resolveDshGlyph` 里过滤掉不存在的 glyph（防 `mask: url(undefined)`）；未映射的 codicon 返回 `undefined`，保持 codicon 原样。
3. **替换缝**：新增 `platform/theme/common/iconReplacement.ts`（单槽位注册 + 注销，重复注册直接抛错）；`iconsStyleSheet.getCSS()` 在「默认 codicon 未被产品图标主题改写」时查询替换函数，命中输出 `content:''; background-color:currentColor; width/height:1em; mask: url('data:…') center / contain no-repeat`，未命中保留原 font 规则。platform 层不 import workbench；挂载点在 `dsh.contribution.ts` → `dshIconReplacement.ts`。
4. **单测**：新增 `build/lib/test/dshIconArtwork.test.ts`（4 项：glyph 数量、data URI 形状、映射目标存在、未映射返回 undefined）；新增 `build/lib/test/dshIconReplacement.test.ts`（3 项：注册可见、重复注册抛错、过期句柄不误清后来的注册）；新增 `build/lib/test/dshIconsStyleSheet.test.ts`（4 项：命中替换仍输出 `--vscode-icon-*-content/font-family` 根变量、未命中保留 font 规则、无注册时全量 font 规则、产品主题改写优先于替换）。

> **本轮修掉的真实回归**：替换分支最初直接 `continue`，把 `--vscode-icon-<id>-content` 根变量一起吞掉；`style.css` 等处直接消费这些变量（如 chevron-down），会让那些伪元素变空。现已改为「根变量照旧输出、只换 `::before` 规则」，并由上述集成单测钉住。
5. **验证边界（未做，需用户真机）**：浅色/深色/高对比度、spin 动画、不同 font-size 的实际观感按 AGENTS §6 由用户在 2-E 执行；AI 不以代码推断观测结论。直接覆盖 `::before` 的 CSS 点（如 `chat.css:1436`）本轮未逐条加 mask 覆盖，记录为「已知混合状态」，与草稿 §7.5 的预期一致。

**门禁（实测）**：`test-dsh:all` PASS（370 项 node --test 全过 + mocha 7 项全过）；`verify:dsh-ide-ci` 五步全 PASS；生成脚本 `--check` PASS（无漂移）。

#### 阶段 2-E：开发版 Electron 功能/界面验收（现状流程，不做打包）

按 §0.0：**现阶段每批开发完成后用开发版 Electron 启动验证功能与界面；打包推迟到全部开发完成后。**

1. 启动：`.build/electron/DSH IDE.exe` + `VSCODE_DEV=1` + Host 三件套环境变量（`DSH_IDE_ENDPOINT` / `DSH_IDE_LAUNCH_URL` / `DSH_IDE_ENDPOINT_FILE`）。
2. 检查：`ide/ping` 连通、Sessions 面板来自 Host、`ide/dispatch` 可用、`$events` 就绪。
3. 用户按 `AGENTS.md §6` 做 GUI 验证：消息显示、审批/问卷按钮、工具展开、交付物打开、图标主题表现、会话树展开。AI 不代跑。
4. 发现问题就地修，再重复 1–3；**本阶段不执行打包、profile 覆盖、install-drift**。
5. 临时文件 `.dsh-preview/`、`.session_dump.txt` 已清理（§9.8）。

**产物与安装（历史实测记录，非当前流程；按 §0.0 打包推迟到开发完成后再做）**：

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

> **2-A（修数据链）与 2-B（翻译层升级）为主线顺序推进；2-D（图标全局替换）与 2-A/2-B 并行启动；2-C（Session 缺口）随主线核对；每批完成后按 §0.0 用开发版 Electron 连 Host 验证（GUI 观察由用户执行）。**
>
> 打包、profile 覆盖、install-drift 按 §0.0 推迟到全部开发完成后一次性执行。
>
> 本阶段不改协议/通道/Host/状态层（§5 稳定性边界）；新增能力按 §5.1 的扩展流程处理。不改原生渲染工厂，不做注册表，不恢复 driver。

**并行排期**：

| 轨道 | 内容 | 依赖关系 |
|---|---|---|
| 主线 A | 2-A 修 `plan/goal/todos/skills` 数据链 | 先做，是 2-B 的前置 |
| 主线 B | 2-B 翻译层升级（B1→B5 分批 TDD） | 依赖 A；逐批跑门禁 |
| 主线 C | 2-C Session 缺口核对 | 随主线，无硬依赖 |
| 并行 D | 2-D 图标全局替换（资源生成→映射→getCSS→覆盖点→主题验证） | **与 A/B 并行**，独立工作流、独立门禁，不阻塞主线 |
| 收尾 E | 2-E 开发版 Electron 验证（按 §0.0 每批做，GUI 观察由用户执行） | 每批完成后 |
| 新重点（已完成） | 子智能体会话树（§9.9） | 已按形态 A+ 实现并入门禁 |

### 9.7 能力限制与非缺陷（保持不变）

- `addAttachment`/`removeAttachment`/`openInApp`/`dismissQuotaNotice` 无官方 remote，也没有这两插件的 Host 接口：保持 `FEATURE_UNAVAILABLE`。
- `rewind` 依赖已装载的 `dsh-rewind-plugin`；`deleteSession` 依赖已装载的 `@michengai/dsh-archive-manager`。插件页上的依赖说明以后再写。
- 附件上传/移除只能在 prompt/命令提交时内联 admit。
- DSH 特有纯装饰（鲸鱼动画、TurnNavigator、PixelWhale、onboarding、KaTeX）本阶段不做；VS Code 自身 Mermaid/Markdown 完整保留。

### 9.8 用户决策（已定）与执行边界

1. **开发期验证时机**：按 §0.0，每批完成后用开发版 Electron 连 Host 验证功能与界面；GUI 观察由用户执行（AI 不代跑）。打包推迟到全部开发完成后。
2. **图标替换排期**：**与 2-A/2-B 并行**启动，独立工作流、独立门禁（2-D）。
3. **临时文件**：`.dsh-preview/`、`.session_dump.txt` 已删除清理（经用户确认终止占用目录的两个临时预览进程 `serve.cjs` / `serve-chat-view.cjs` 后删除）。二者未被 git 跟踪，不进版本库。

---

### 9.9 子智能体会话树（2026-11-17 已按确认决策实现）

> 状态：用户确认三项决策（仅树展开 / rebind 到主 chat / 完整递归+防环）后，已按 §9.9.5 实现并通过门禁。契约字段与 Host 投影本就具备 `parentSessionId`/`origin`，本次是**纯 renderer 改动**，不改契约、不加 Host 端点、不改菜单。落地结果见 §9.9.8。

#### 9.9.1 需求与结论

需求：Session 面板中，父会话可展开其子智能体会话，子会话还能继续展开下一层（递归），用 VS Code 原生会话树承接 DSH 的子智能体会话关系。

**结论**：不新增 `listSubagentChildren` 端点、不做右键子菜单。**用已有 `parentSessionId`/`origin` 在 renderer 拼 `IChatSessionItem.children`，交给 VS Code 原生树渲染。**

#### 9.9.2 当前代码实际状态（改造前快照，2026-11-17 初；行号为当时值）

> **说明**：下表记录的是 §9.9 改造**动手前**的代码状态，用于对照「改了什么」。§9.9 完成后：
> `refresh()` 现为 `:190` 起（内部走 `buildSessionTree` + `flattenTree`，不再 `next.push`）；
> `toSessionItem()` 在 `:321`；`sameItem()` 已删除，改为 `dshSessionTree.ts:167` 的 `sameTreeItem`；
> `applyRunning()` 在 `:293`；归档/已读为 `setChatSessionItemArchived:245` / `setChatSessionItemRead:258` / `applyArchived:272`。

| 位置（改造前快照） | 当时行为 | 树所需改动 |
|---|---|---|
| `dshAgentSessionsController.ts:190-242` `refresh()` | `:220-227` 逐条 `toSessionItem()` 后 `next.push(item)`，全扁平 | 改为先建树，push 根节点 |
| `dshAgentSessionsController.ts:323-343` `toSessionItem()` | `:335-342` 只返回 `resource/label/description/status/timing/iconPath`，**无 `children`、不读 `parentSessionId/origin`** | 保持单条映射，供树构造调用；补稳定 resource/timing、label 单行 |
| `dshAgentSessionsController.ts:345-352` `sameItem()` | 只比 `label/description/status/timing.*` | 递归比较 `children`，否则子项状态变化不刷新 |
| `dshAgentSessionsController.ts:298-320` `applyRunning()` | `:301` 只按 resource 找顶层，`:309-318` 只替换顶层 | 递归更新 `children` |
| `dshAgentSessionsController.ts:250-256`/`:263-274` 归档/已读 | 走 `applyArchived`(`277-295`) / `withRead`，均 `items.map` 单层 | 递归更新 `children` |
| `dshSessionItemState.ts`（该文件已在第 1 轮瘦身删除；等价逻辑现内联在 `dshAgentSessionsController.ts` 的 `applyArchived` / `setChatSessionItemRead` / `mapTreeItem` 调用处） | 原为 `DshSessionItemLike`/`withArchived`/`withRead`/`timingForRunning`，全部单层 | 历史记录：递归改造最终落在 `dshSessionTree.ts` 的 `mapTreeItem` |
| `dshAgentSessionsController.ts:117-134` `sessionOpenerRegistry` | 对任意 `dsh:///<sessionId>` 调 `bind(sessionId)` | **不用改**；子项 resource 用同格式即可 |
| `dshSessionMenu.ts:86-235` | 9 个命令（收藏/置顶/重命名/fork/复制 ID/打开路径/移动/归档/删除），不涉及父子 | **不用改**，也不要把它当子智能体入口 |
| `buildSessionTree`/`children`/`parentSessionId`/`origin==='subagent'` | `dsh/browser/` 全 0 命中 | 全部待建 |
| `build/lib/test/dshSessionTree*.test.*` | 不存在 | 新建单测 |

#### 9.9.3 关键 API 事实与 gotcha（源码核对，草稿未写）

**VS Code 原生规则（必须遵守）：**

1. provider 接口只有 `children?: readonly IChatSessionItem[]`（`chatSessionsService.ts:260-273`），**没有 `parentSession` 字段**；`parentSession` 是内部类型（`agentSessionsModel.ts:90-94,230-232`），由 `toInternalSession` 从嵌套关系自动注入（`:762-803`）——**不要在 item 上手写 parentSession**。
2. 子项仍是普通 `IChatSessionItem`，需要 stable `resource` + `label` + `timing`；children **可仅嵌入**，无需逐个 `registerChatSessionItemController`（model 只 set 顶层 provider items，children 递归内联，`:743-807`）。
3. child 定位按 `resource` 相等（`agentSessionsModel.ts:607-619`），树 id 用 `resource.toString()`、child 带 `chat-` 前缀（`agentSessionsViewer.ts:1749-1752`）——resource 必须稳定且唯一。
4. `hasChildren` 依据 `children?.length`（`agentSessionsViewer.ts:1295,1351-1353`）；`has-chat-children` class 由 `visibleChildrenCount > 0` 决定（`:364-365`），缩进 guide 只在 `aria-expanded="true"` 出现（`agentsessionsviewer.css:389-397`）。
5. **展开是用户驱动**：tree `expandOnlyOnTwistieClick: true`、缩进设为 0（`agentSessionsControl.ts:366-372`），**没有公开 `expandSession`**（`:847-857,868-879,970-1008` 只展开 section）。不做"默认展开所有子会话"，交给用户点 twistie。
6. parent 的 `label.split('\n')[0]` 会进 child 的 `parentSession.label`（`agentSessionsModel.ts:781`）——label 保持单行。

**DSH 侧参照规则（不直接复用其输出）：**

7. `flattenLineage()`（`lineage.ts:54-95`）输出的是**新对象 `SessionListEntry`**（剥离 `agentAvailable`、新增 `depth`，`:21-44,81-85`），不是 `IChatSessionItem`；仓库里也**没有**反向 `buildTree/unflatten` 可搬——只参照规则，不搬输出。
8. 规则：仅 `origin === 'subagent' && parentSessionId && byId.has(parentSessionId)` 才挂为子项（普通 fork 即便有 parent 也不挂，`:63-69`）；父不在列表→降级 root 不丢（`:69`）；`visited` 防环（`:74-79`）；不可达环成员补 root（`:92-94`）。
9. **保持 DSH 输入顺序**，不按 `updatedAt` 重排（`lineage.ts:48-50`）。

#### 9.9.4 证据链与判定（详细见草稿 §5.2/§5.3）

| 待确认点 | 结论 | 证据 |
|---|---|---|
| `listSessions` 是否返回子会话 | 是（不过滤 subagent） | `list.ts:145-178,180-193` |
| summary 是否带父子字段 | 是（`parentSessionId`/`origin`） | `list.ts:372-382`，`dshIdeProtocol.ts:68-80` |
| Host 桥是否保留 | 是 | `ide-view-host.js:708-745`，`dshIdeSessionList.js:48-62` |
| renderer 是否使用 | **否**（唯一缺口） | `dshAgentSessionsController.ts:335-342` |
| VS Code 是否有原生 children 树 | 有 | `chatSessionsService.ts:260-267`，`agentSessionsModel.ts:762-803` |
| 是否需新 `listSubagentChildren` 端点 | 不需要（仅冷/外部子会话不返回时再评估） | 草稿 §5.3 |
| 是否需右键子菜单 | 不建议主用；children 树是正解 | `agentSessionsActions.ts:71-78,812-817` |
| 点击打开是否要改 | 不用，现有 opener 通用 | `dshAgentSessionsController.ts:117-134` |
| 深度是否受限 | 来自配置 `maxDepth:2`，不是 list 缺失 | `tool-subagent.spec.ts:606-610,442-456,74-79` |

#### 9.9.5 代码级实施计划（确认后按序执行）

| 步骤 | 文件 | 具体动作 |
|---|---|---|
| 1 | 新增 `dshSessionTree.ts`（或并入 `dshSessionItemState.ts`） | 纯函数 `buildSessionTree(summaries, toItem)`：按 §9.9.3 规则 7–9 建树。`byId=Map(sessionId→summary)`；仅 subagent 且 parent 存在才挂子；`visited` 防环；孤儿/环降级 root；**保持输入顺序**；输出 `readonly IChatSessionItem[]`（root 带嵌套 `children`），**不写 `parentSession`、不写 `depth` 到 item**（depth 仅测试可选返回） |
| 2 | `dshAgentSessionsController.ts:190-242` `refresh()` | `:220-227` 的逐条 `next.push` 改为用 `buildSessionTree(summaries, toSessionItem)` 的结果作为 `next` |
| 3 | `dshAgentSessionsController.ts:323-343` `toSessionItem()` | 只做单条映射：resource=`dshSessionResource(sessionId)`、timing 来自 `timingForRunning`、label 单行；稳定 resource 供 child 定位 |
| 4 | `dshAgentSessionsController.ts:345-352` `sameItem()` | 递归：先比顶层字段，再比两侧 `children` 长度与逐项 `sameItem` |
| 5 | `dshAgentSessionsController.ts:298-320` + `dshSessionItemState.ts` | `applyRunning` / `withArchived` / `withRead` 递归处理 `children`（给 item 接口加 `children?`，`map` 后对 `children` 再递归） |
| 6 | 契约 / Host / 菜单 / opener | **不动**：不加端点、不改 `dshIdeProtocol.ts`、不改 `dshSessionMenu.ts`、不改 `sessionOpenerRegistry` |
| 7 | 新测试 `build/lib/test/dshSessionTree.test.ts` | 见 §9.9.6 |

#### 9.9.6 测试与门禁

`dshSessionTree.test.ts` 必测用例：

1. `origin==='subagent'` 且 parent 存在 → 挂为父项 `children`。
2. 普通 fork（有 `parentSessionId` 但非 subagent）→ 仍为 root。
3. parent 不在列表的孤儿 subagent → 降级 root 不丢。
4. 环状父子 → `visited` 防死循环，剩余项补 root。
5. 三层递归（父→子→孙）→ children 嵌套正确、resource 唯一。
6. 输入顺序保持，不按 `updatedAt` 重排。
7. `sameItem` 子项状态变化 → 返回 true（触发刷新）。
8. `applyRunning`/`withArchived`/`withRead` 递归更新子项。

门禁：`test-dsh:all` 全 PASS、`verify:dsh-ide-ci` 五步全 PASS、改动文件 tsc 零错误（全量 tsc 既有 FAIL 如实记录）；真机会话树展开在 2-E 重启后一并验收（AI 不代跑）。

#### 9.9.7 用户决策（2026-11-17 已确认，按此实现）

1. **形态**：**仅"会话树展开"**——原生、递归自然。不做右键子智能体子菜单（`dshSessionMenu.ts` 已是独立右键菜单且不含子项，保持不动）。
2. **点击子会话**：**rebind 到主 chat**——现有 opener `dsh:///<id> → bind` 通用，无需新增路径、不新开 editor/side。
3. **深度**：**完整递归 + 防环**——不截断到 `maxDepth`；list 已返回所有层级，人为截断反而丢信息；`maxDepth` 只控制派生，不限制展示。

按 §9.9.5 执行，完成结果如下。

#### 9.9.8 落地结果与门禁（2026-11-17）

**改动文件：**

| 文件 | 改动 |
|---|---|
| 新增 `src/vs/workbench/contrib/dsh/browser/dshSessionTree.ts` | 纯函数层：`buildSessionTree(summaries, toItem)` 建树（subagent 才挂子、孤儿降级 root、`visited` 防环、保持输入顺序、不写 `parentSession`/`depth`）；`flattenTree` / `mapTreeItem`（递归状态更新）/ `sameTreeItem`（递归比较）/ `sessionTimingForRunning` |
| `dshAgentSessionsController.ts` | `refresh()` 改用 `buildSessionTree` + `flattenTree` 做树与 delta；`setChatSessionItemRead` / `applyArchived` / `applyRunning` 改用 `mapTreeItem` 递归更新子项；`applyRunning` 查找改 `flattenTree`；删除旧的单层 `sameItem`，改用 `sameTreeItem` |
| 新增 `build/lib/test/dshSessionTree.test.ts` | 9 项：subagent 挂子、普通 fork 为 root、孤儿降级 root、环防死循环不丢、三层递归、输入顺序、重复 id 去重、递归状态更新、递归比较 |
| `package.json` | `test-dsh:all` 登记 `dshSessionTree.test.ts` |

**门禁实测（如实记录）：**

| 项 | 结果 |
|---|---|
| `dshSessionTree.test.ts`（9 项） | PASS |
| 会话相关四文件联跑（`dshSessionItemState` + `dshSessionTree` + `dshChatSessionContent` + `dshChatHistoryNative`） | PASS（37 项，当时记录；`dshSessionItemState` 已在第 1 轮删除） |
| mocha `test-dsh` 核心命令 | PASS（7 项） |
| 改动文件 tsc 检查 | PASS：`dshSessionTree.ts` 零错误；`dshAgentSessionsController.ts` 的 `pane` 可能为 null 已改为 `?? undefined` 收窄，改动文件零错误 |
| 全量 `tsc --noEmit` / `verify:dsh-ide-ci` | **PASS**（2026-11-17 15:26 复跑，当时记录）：`test-dsh:all` mocha 7 项 + node 386 项全通过；`verify:dsh-ide-ci` 在 `DSH_INSTALLED_VERSION=0.2.2-rc.3` 下五步全 PASS；全量 tsc 余 137 个既有 VS Code 报错，本次改动文件零命中。（**现行口径见 §9.11**：node 384 项、全量 tsc 0 报错、`DSH_INSTALLED_VERSION=0.2.2-rc.1`；本行保留为当时的验收记录。） |

> 注：全量门禁已按上表复跑并转 PASS；真机会话树展开在 2-E 用开发版 Electron 连 Host 验收（AI 不代跑）。全量门禁 PASS 不等于打包——按 §0.0 打包推迟到全部开发完成后再做。


---

### 9.10 依赖插件能力门控（rewind / 会话管理）：方案一已落地

> 用户决策（2026-11-17）：DSH-IDE 依赖 rewind 与会话管理两个插件；**缺插件时隐藏相关功能**，不报错、不假装可用。传输方式最终选 **方案一：IDE 启动时主动调一次 `capabilities` method + 监听 Host 状态变化时重查**，菜单用 context key 的 `when` 过滤。**不把 capabilities 塞进 follow 快照，不改 wireRevision。**
>
> 当前代码状态（2026-11-18 复核）：方案一已经在代码里。`DSH_IDE_WIRE_REVISION` 是 4，`DshIdeViewSnapshot` 不含 `capabilities`，`validateCapabilities` 校验的是 method 返回值，Host `capabilities()` 调用 `probeDshIdeCapabilities`，渲染器用 `client.call('capabilities')` 并在连接后和 30 秒轮询时重查。下面的步骤表保留为当时的实施顺序，不再表示待执行。

#### 9.10.1 两个插件提供什么 / 移除后哪些功能不可用

功能来源：GitHub README 摘要（`SiriLee/dsh-rewind`、`MichengAI/dsh-archive-manager`）+ 本项目 Host 桥 `ide-view-host.js` 的调用点。GitHub 正文抓取不可靠（返回泛化内容），**以本项目 Host 源码为最终依据**，README 只佐证功能定位。

| 插件 | 功能 | 本项目 Host 调用 | 移除后不可用的 DSH-IDE 功能 |
|---|---|---|---|
| `dsh-rewind-plugin`（`SiriLee/dsh-rewind`，命令 `rewind-plugin`） | 同窗口就地回退到更早用户消息，可选还原文件 | `commands.list(agent)` 查 `rewind-plugin` → `executeCommandLine('rewind-plugin', ['@<seq>','chat'])`；只承接消息回退，不承接文件恢复 | **消息回退**入口隐藏（当前本就无 UI 按钮） |
| `@michengai/dsh-archive-manager` | 归档/恢复、收藏、永久删除、工作区移动、诊断 | `workspaceRegistry.setSessionFavorite`/`favoriteSessions`、`moveSessionToWorkspace`、overlay `deleteSession`（`dshIdeProtocol.ts:29-40` 常量） | **收藏 / 移动到工作区 / 删除会话**隐藏 |
| 同插件不涉及 | — | `setSessionPinned` 走 core `workspaceController`；`renameSession` 走 core `controller().rename`；`archiveSession/unarchiveSession` 走 core | 置顶/重命名/归档/恢复**不隐藏** |

#### 9.10.2 方案一实施计划（按顺序，执行时再改代码）

1. **契约** `dshIdeProtocol.ts`：`DSH_IDE_WIRE_REVISION` 5→4；`DshIdeViewSnapshot` 去掉 `capabilities?` 字段与 `DSH_IDE_VIEW_KEYS` 中的 `capabilities`、`validateDshIdeView` 的校验调用；`DshIdeBackend.open` 去掉 `capabilities?` 返回；**保留** `DshIdeCapabilities` 类型、`capabilities` method（method 计数 42→43）、`validateCapabilities`（改为校验 method 返回值）。
2. **Host** `ide-view-host.js`：`open()` 不再返回 capabilities；`createMethodHandlers` 增 `capabilities()` → `probeDshIdeCapabilities(ctx, bridge.sessionId)`；`probeDshIdeCapabilities` 的 rewind 探测优先用绑定会话的 agent，取不到再试无参 `commands.list()`；缺插件只返回 false，不抛错。
3. **electron-main** `ide-view-service.ts`：删 `_capabilities` 字段、open/close 里的赋值、`receive()` 每帧携带 capabilities 的代码；`DshIdeCapabilities` import 删除。快照不再含 capabilities。
4. **renderer** `dsh.contribution.ts`：`applyDshCapabilities` 不再从 `state.view` 读；改为 `refreshCapabilities()`——`client.call('capabilities')` → `validateCapabilities(result.value)` → `applyDshCapabilities` 写 context key；连接后调一次，`onDidChangeState(connected)` 时重查；为捕捉运行中安装/卸载插件，连接期间低频轮询（建议 30s，`getStatus().connected` 时重查），dispose 时清定时器。调用失败一律写全 false（fail-closed）。
5. **保留不动**：`dshCapabilities.ts`（4 个 context key + `applyDshCapabilities`）与 `dshSessionMenu.ts` 的 `when` 过滤（收藏/移动/删除分别用对应 capability key）——这两处与传输方式无关，方案一继续复用。
6. **测试调整**：`dshIdeChannel.test.ts` wireRevision 断言 5→4；`dshIdeProtocol.test.ts` 把 capabilities 测试从"快照字段"改为"method 返回值 `validateCapabilities`"并新增"快照带 capabilities 被拒"；`ideViewHost.test.mjs` 把 `open().capabilities` 改为 `bridge.invoke('capabilities')`；method 计数 42→43（新增 `capabilities`）。
7. **门禁**：相关 node 测试全 PASS、改动文件 tsc 零错误；按 §0.0 用开发版 Electron 验证菜单隐藏效果，不做打包。

#### 9.10.3 验收

1. 装齐插件：Sessions 右键显示收藏/移动/删除；rewind capability 为 true（本阶段无 UI 按钮）。
2. 缺插件：对应菜单项不出现；command palette 同名命令也不执行（Action2 `when` 约束）。
3. 运行中安装插件：下一次状态变化或轮询后菜单项出现；卸载后消失。
4. 旧 Host（不带 capabilities method）：调用失败 → 全 false → 隐藏，不报错。

---

### 9.11 消除 137 条类型错误 + 并行瘦身计划（已执行，2026-11-17）

> 当前状态不在下面按轮次往下续。生效结论只在 `docs/PROJECT_AUDIT.md`。
>
> 用户要求：一边做一边项目瘦身，用不到的都删掉；在不影响 DSH-IDE 功能前提下把全量 tsc 的 137 条错误清零。原则：**能删就删**（优先删瘦身残留死代码），其次做类型对齐；所有改动都不改变运行时行为。执行期间不碰 §9.10 的契约文件，避免与其冲突。
>
> **执行结果**：tsc 137 → **0**；`npm run compile` PASS；`test-dsh:all` 384/384 PASS；`verify:dsh-ide-ci` 五项全 PASS（`DSH_INSTALLED_VERSION=0.2.2-rc.1`）。变更 92 个文件（26 删除 / 64 修改 / 2 新增），+456 / -4,621 行；依赖 68→66（dependencies）、100→93（devDependencies）；锁文件条目 1,649→1,536（-113，零新增、零版本变更）。生效结论统一见 `docs/PROJECT_AUDIT.md`。
>
> **落地要点与手册原方案的偏差**：
> 1. `DSH_IDE_CONTRACT_API_VERSION` / `DSH_IDE_CONTRACT_WIRE_REVISION` **未删**——`verify:dsh-ide-protocol-single-source` 显式断言 contract 必须 import protocol 常量，删则门禁 FAIL。
> 2. `isRecord` / `stringOf` / `numberOf` 的重复实现**保留**——跨 Host-side JS / electron-main / workbench 三层，抽取需改 gulp staging 与 boundary 门禁，收益小于风险。
> 3. 测试项数 389 → 384：减少的 5 项全部来自随死模块删除的 `dshSessionItemState.test.ts`。
> 4. `genDshIconDataUris.mjs --check` 与全仓 ESLint、浏览器单测、真机 GUI 均为 PENDING（需官方 source / 既有 header 基线 / 用户执行）。

#### 9.11.1 分类与逐项方案

**第一类：MCP/AgentHost 类型塌缩（~60 条，根因）**
`agentHostCustomizationService.ts` 的 `IAgentHostMcpServer` 是弱别名（`[key:string]: unknown`），下游 `ReturnType` 派生后字段全变 unknown。方案：按 `getMcpServers()` 实际构造字段补全接口（`start`/`stop`/`state`/`source`/`enablement`/`disabledReason` 等），从协议层 import `McpServerState`/`McpServerStatus`/`McpServerSource`/`CustomizationDisabledReason`/`TextRange`。一次性消除 `mcpListWidget.ts`/`mcpCommands.ts`/`toolsListWidget.ts`/`mcpServerCount.ts` 约 60 条。风险低，纯类型声明。注意新增中文注释配 `// allow-any-unicode-next-line` 过 hygiene。

**第二类：瘦身残留死代码（~35 条 TS6133）**
| 文件 | 处理 |
|---|---|
| `ChatContextKeys` 相关 9 个文件 | 删残留的 `import { ChatContextKeys }`（使用点已删） |
| `chatSetupContributions.ts`（11 条） | 删 11 个未使用 import |
| `gettingStartedService.ts`（4 条） | 删 `BUILT_IN_SOURCE`、`sessionInstalledExtensions`、两个媒体路径转换函数（使用点已删） |
| `terminalService.ts` | 删 `OS`、`terminalEnvironment`、`generateUuid` 等未使用 import/字段 |
| `chatExecuteActions.ts`/`agentPluginServiceImpl.ts`/`chatWidget.ts` | 逐条删未使用符号 |

**第三类：死代码 + 不可达分支**
- `editorAccessibilityHelp.ts:154`：`if(true){...} return;` → 展平为直接 `return`（删不可达代码）。
- `chatWidget.ts`：`_getGenerateInstructionsMessage` 及 `_instructionFilesCheckPromise`/`_instructionFilesExist`/`_checkForAgentInstructionFiles` 无调用点 → 整组删除，连带清 `thenIfNotDisposed`/`IPromptsService`/`GENERATE_AGENT_INSTRUCTIONS_COMMAND_ID` import。

**第四类：改造残留修复（非删除，谨慎）**
| 文件 | 问题 | 方案 |
|---|---|---|
| `sessionTargetPickerActionItem.ts:188` | 类型名笔误 `IChatHarnessSwitchSurveyService` | 改 `IChatHarnessSwitchFeedbackSurveyService` |
| `agentHostChatInputPicker.ts:263` | `CODEX_APPROVALS_LEARN_MORE_URL` 未定义 | fallback 到 `PERMISSIONS_LEARN_MORE_URL` |
| `aiCustomizationManagementEditor.ts:3977` | `$('button')` 返回 `HTMLElement` 与字段 `HTMLButtonElement` 不符 | 加 `as HTMLButtonElement`（同文件既有风格） |
| `web.main.ts:488`/`desktop.main.ts:335` | `WorkspaceTrustEnablementService` 构造参数已删但调用还传 2 个 | 去参数 |
| `argv.ts` | `agents` 字段无读取点 | 从 `NativeParsedArgs` 删 `agents?: boolean` |
| `tunnelProxy.ts:203` | Node `createConnection` 类型与回调实现不符 | `as typeof agent.createConnection` 断言（不改运行时） |

**第五类：测试 mock 签名对齐（8 条）**
- 5 个 `executeCommand` mock → 加 `<R = unknown>(...): Promise<R | undefined>` 并返回 `undefined`（chatForkActions、chatMigrationNotice、onboarding、opener、statusbarItem）。
- `chatStatusPromo` 的 `getViewWithId`/`openView` → 补 `id` 参数、返回 `T | null`。
- `chatExpNotification` 的 `getTreatment` → 返回 `Promise<T | undefined>`。
- `configurationService.test`（4 处）`getTreatmentWithAssignment` → 补 `name` 参数 + 显式返回类型。
- `chatAccessibilityHelp.test.ts:31` → 删多余 `undefined` 实参。
- `extHostNotebookStatusCommands.test.ts:37` → `converter` 显式类型 + `this as ExtHostCommands` 打破推断循环。

**第六类：零散上游遗留**：已归入第五类，无其它独立遗留。

#### 9.11.2 执行顺序与契约

1. 先第一类（根因，~60 条）；每批后跑 `npx tsc --project ./src/tsconfig.json --noEmit --skipLibCheck --max-old-space-size=8192` 确认递减。
2. 第二、三类（死代码清理，低风险）。
3. 第四类（改造残留，逐个确认，不改运行时）。
4. 第五类（测试签名）。
5. 全程遵守"**边做边瘦身**"：发现某符号零引用就删，不留兼容壳；不引入新依赖；不改 §9.10 契约文件；不改 DSH-IDE 功能逻辑。

#### 9.11.3 验证门禁

- 必跑：`npx tsc --project ./src/tsconfig.json --noEmit --skipLibCheck`（目标 0 错误；`--max-old-space-size=8192`）。
- 建议：对改动文件跑 `build/hygiene.ts`（既有中文注释 hygiene 报错是基线，不新增即可）。
- 真机验证由用户执行（AGENTS.md §6，AI 不代跑 GUI）；按 §0.0 用开发版 Electron 验证，不做打包。

#### 9.11.4 第 2 轮复检与断链修复（已执行，2026-11-17）

> 第 1 轮结束后复检发现 3 个**已失效的脚本/配置**与 4 处死代码，按同样流程先出清单（生效结论见 `docs/PROJECT_AUDIT.md`）再执行。区间 `36521cd0..2d7a1b02`：**20 个文件，+42 / -496 行**。
>
> **删除**：`build/lib/dsh/verify/dshRealSampleP95.mjs`（import 的 `ide-view-projector.ts` / `translator.ts` 已被删，boundary 门禁反向要求不得存在，实跑 `ERR_MODULE_NOT_FOUND`）、`build/dsh-ide-build-prereqs.mjs`（扁平化后把 `types-stash` 写到 `E:\`）、npm script `verify:dsh-real-p95`；`dshComposerProjection.ts` 的 `toChatMode`/`observeModes`/`modesOf`（41 行）、`dshChatSession.ts` 的 `noteRunning`/`pendingItemsView`+`_pendingView`/`boundId`（22 行）、`dshIdeProtocol.ts` 的 `DshIdeImageAttachmentValue`、重复的 `DSH_MODEL_VENDOR`；`.vscode` 的 3 个悬空任务与 5 个指向已删扩展目录的启动项。
>
> **修正**：`sync-upstream.mjs` 的 PROVENANCE 路径与版本正则（原恒返回 undefined → 报告恒为 SAME）；`dshArtifactContents.mjs` 的 `EXPECTED_COMMON` 7 → 10；手册 method 计数 42/36 → 43（6 处）；README 两处过期描述；4 处 `DshChatModelDriver` 注释改为 `dshChatSessionContent` content provider。
>
> **门禁**：tsc 0 error、`test-dsh:all` 384 PASS、`verify:dsh-ide-ci` 五项 PASS、`verify:dsh-artifact` PASS、`.vscode` 两份 JSONC 解析与依赖引用全部可解析。生效结论见 `docs/PROJECT_AUDIT.md`。

#### 9.11.5 第 3 轮复检（已执行，2026-11-17）

> 第 3 轮全量复扫 DSH 两目录（55 文件）：零引用导出 **0**、零引用模块 **0**（4 个测试入口由 script 直接指定）、`TODO/FIXME/XXX/HACK/debugger` **0**、0 字节文件 **0**、`node_modules` 零引用依赖 **0**。即 DSH 自有代码的可删面已清完，本轮只剩配置层残留。区间 `ad638615..cd7aeb4b`：**3 个文件，+7 / -28 行**。
>
> **删除**：空目录 `src/vs/workbench/contrib/dsh/test/browser`；`.eslint-ignore` 的 17 条 `**/extensions/copilot/**` 与 2 条 `lit-html/**`/`signals-core/**`（两目录 git 历史从未存在）；`build/filters.ts` 两处 copilot 注释与排除项。
>
> **修正**：`scripts/sync-upstream.mjs` 的「渲染复用件」段改为「历史渲染复用件」，注明本地复制件与 sidecar 已删除、仅作历史对照。
>
> **门禁**：tsc 0 error、`test-dsh:all` 384 PASS、`verify:dsh-ide-ci` 五项 PASS、`.eslint-ignore` 死条目 0、`node --check scripts/sync-upstream.mjs` PASS。生效结论见 `docs/PROJECT_AUDIT.md`。
>
> **累计（三轮）**：约 111 个文件变更、净减约 4,200 行（+945 / -5,143）、20 余个提交；tsc 137→0；dependencies 68→66、devDependencies 100→93、scripts 86→80；锁文件 -113 条目（零新增、零版本变更）。

#### 9.11.6 第 4 轮：已删目录的断链与残留（已执行，2026-11-17）

> 第 4 轮由 3 个子智能体并行扫描（配置残留 / 重复实现 / 手册一致性），重点查「`src/vs/platform/agentHost/**`、`extensions/copilot/**`、`src/vs/sessions/**` 已删但仍有引用」的地方。区间 `d75b1fc1..628256cc`：**23 个文件，+284 / -1,289 行**，6 个提交。
>
> **真实断链（7 处，11 行）**：`scripts/test-integration.sh:200` / `.bat:130` 无条件 import 已删的 `agentHostTestProfile.ts`（`set -e` 中断整个默认集成测试）；`scripts/code-agent-host.js/.sh` spawn 不存在的 `out/.../agentHostServerMain.js`；`scripts/test-agent-host-e2e.sh/.bat` exec 不存在的 `test/integration/agentHost/runner.ts`；`scripts/code-sessions-web.js/.sh` import 不存在的 `src/vs/sessions/sessions.web.main.internal`。
>
> **删除**：上述 6 个脚本（422 行）、`scripts/chat-simulation/merge-ci-summary.js`（571 行，零引用）、`.vscode/launch.json` 的「VS Code Agent Host」启动项、`build/lib/i18n.resources.json` 的 `sessions` 段（38 条 / 154 行）、`eslint.config.js` 90 行（14 行 glob + 27 行空插件块 + 49 行 import-pattern）、`build/filters.ts` 3 处、`.eslint-ignore` 1 处、`.vscode/settings.json` 3 处、`.gitignore` 1 处、`.eslint-allowed-*-files` 6 条。
>
> **修正**：`sync-agent-host-protocol.ts` 的 `DEST_DIR` 改到 `chatContracts`（61 个 generated 文件的真实位置）；`dshIdeProtocol.ts:25` 的 wireRevision 注释去掉撤销的 5 号方案残留；手册 13 处行号/定量声明（§2 校验器 6 处、§4.5 附件 1 处、§2 状态层 3 处、§9.7 图标大小 1 处、§9.9.2 表头与 5 个真实行号）。
>
> **门禁**：tsc 0 error、`test-dsh:all` 384 PASS、`verify:dsh-ide-ci` 五项 PASS、`verify:dsh-artifact` PASS、`npm run compile` PASS（0 errors，49 s）、三份 `.vscode` JSONC 解析 PASS、`bash -n` / `node --check` 全部 PASS、`.eslint-allowed-*-files` 0 missing、`build/lib/test/i18n.test.ts` 3/3 PASS。生效结论见 `docs/PROJECT_AUDIT.md`。
>
> **保留**：`test/smoke/src/areas/agentsWindow/**`（5 文件 108 KB）整块保留——它测的 Dev Container / packaged AgentHost 已随 `src/vs/sessions/**` 与 `src/vs/platform/agentHost/**` 消失，但删除属测试裁剪，不在「行为不变」的清理范围。（**第 5 轮已删除**，见 §9.11.8。）

#### 9.11.7 第 4 轮细小 Bug 修复（已执行，2026-11-17）

> 用户要求「每轮检查是否仍有细小 bug，整理出一个没有逻辑问题的可执行方案并处理」。子智能体按 8 类模式（未定义标识符 / 空值 / 异步 / 泄漏 / 逻辑 / 字符串正则路径 / 类型断言 / 状态不一致）扫描 DSH 全部生产代码，命中并复核 **11 处真实 bug**，生效结论见 `docs/PROJECT_AUDIT.md`。修复提交 `594dd4a4`（功能改动，与清理提交分开）：**10 文件，+193 / -39 行**。
>
> **高危 1 处**：`DshChatSession._running` 只在 `submit()` 置 true、失败置 false，**正常回合结束无复位** → `running()` 永远 true，面板永远「生成中」、停止按钮常驻。修法：新增幂等 `setRunning()` + `acceptSessionStatus()`，由 `dsh.contribution.ts` 消费 `session-status` 帧（Host 侧 `api-session/status` 转发）驱动复位；`submit()` 与 `bind()` 统一走 `setRunning()`。
>
> **中危 5 处**：bind 失败不回滚导致同一会话永不重绑；`acceptView` 把缺席的 plan/goal/todos 当清空（投影只在 snapshot 帧下发）；`DshIdeConsumer.reset()` 全仓零调用导致一次坏帧永久熔断；`authenticating` 缓存 rejected Promise 导致首次鉴权失败永久失效；`void this.refresh()` 无 catch 造成 unhandled rejection。
>
> **低危 5 处**：`mapTreeItem` 的 `changed` 恒真（无变化也重建树）；模型目录只比 identifier（改名/推理档不刷新）；行内补全 Disposable 未注册；`throwIfAborted()` 与 abort 监听之间的竞态窗口；`applyQuotaNotice` 顺序导致配额错误挂到交付物行。
>
> **测试**：新增 4 项（`dshChatSessionExtras` 3 项 + `dshSessionTree` 1 项），`test-dsh:all` 384 → **388** 全 PASS。
>
> **门禁**：tsc 0 error、`build-dsh-tests` PASS、`test-dsh:all` 388 PASS、`verify:dsh-ide-ci` 五项 PASS、`npm run compile` PASS（0 errors，36 s）。

#### 9.11.8 第 5 轮：上一轮修复的回归 + sessions 残留 + 脚本缺陷（已执行，2026-11-18）

> 两个子智能体并行扫描：sessions 残留网络（规则实现 / eslint 配置 / stylelint / i18n / smoke / scripts）与构建测试缺陷（含对第 4 轮 11 处修复的逐项复查）。区间 `9919cd20..85ad5953`：**40 个文件，+422 / -3,910 行**，3 个代码提交 + 1 个文档提交。

> **上一轮修复引入的回归（5 处，全部修复）**：① **高危** `bind()` 失败回滚与「相同 id 短路」组合成死锁——A 已绑定 → bind(B) 失败 → 再 bind(A) 直接 return true，但 `model.clear()` 已执行 → 面板永久空白；修法是新增 `_boundDirty` 标志（短路条件加 `&& !this._boundDirty`）。② `consumer.reset()` 挂在 `onDidChangeState({connected:true})`，但 `_connected` 无置 false 路径 → 每窗口最多触发一次，重连不 reset；修法是在 snapshot 监听里按 Host 的 `rebuild` 快照调新增 `markDisconnected()`。③ `throwIfAborted()` 在 `try` 外导致 abort 监听器泄漏。④ `authenticating` 的 catch 无条件清空可能抹掉新 promise。⑤ plan/goal/todos 的「缺席即保留」语义未在契约里固化。

> **清理**：删 12 个纯 `src/vs/sessions/**` 的 eslint 配置块（236 行，规则只做 minimatch 不 stat 磁盘）、`stylelint.ts` 的死正则、`i18n.ts` 的 sessions 分支（与测试成对删）、`tsec.exemptions.json` 2 条、`test/smoke/src/areas/agentsWindow/**` 5 文件 108 KB + `test/automation/src/agentsWindow.ts` 1 文件 56 KB（合计 6 文件 164 KB；被测源码与 out 产物全不存在）、`build/next/devTunnelsWeb*` 7 文件 + npm script（outDir 写死已删 feature）。**保留** `eslint.config.js:1863` 的 `'vs/sessions/~'`（在活 target 的允许清单里，删=收窄语义）。

> **脚本/测试缺陷（6 处）**：`dshIdeEndpoints.test.ts` 的 `UNVERIFIED` 恒为空数组导致守护恒真（改为显式空数组 + 覆盖断言）；`dshStageNumbering.test.ts` 扫描根拼错且 `catch { return }` 吞错（改正 + `missingRoots` 断言）；`compareVersion` 与 `dshIdeVerify.mjs` 把 prerelease 整段字符串比（`rc.10 < rc.9`，改为逐段数字比较）；`dshInstallDrift.mjs` 跳过空文件、缺 `host/` 时抛 ENOENT；`dshArtifactContents.mjs` 依赖 `process.cwd()`；`genDshIconDataUris --check` 未接线（改用生成物 sha256 指纹测试）。

> **门禁**：tsc 0 error、`build-dsh-tests` PASS、`test-dsh:all` **391** PASS（388 → 391，+3）、`verify:dsh-ide-ci` 五项 PASS、`verify:dsh-artifact` PASS、`npm run compile` PASS（37 s）。`verify:dsh-install-drift` **FAIL（预先存在）**：`host/ide-service.js` / `host/ide-view-host.js` 与 2026-11-17 00:38 的旧产物不一致，本轮未改这两个文件、也未打包（按 §0.0 打包推迟）。生效结论见 `docs/PROJECT_AUDIT.md`。

#### 9.11.9 第 6 轮：chat-simulation / mock-policy-server 的清理与 Bug 修复（已执行，2026-11-18）

> 上一轮只对 `scripts/chat-simulation/**`（15 文件 / 266 KB）与 `scripts/mock-policy-server/**`（5 文件 / 159 KB）做了模式扫描，本轮全覆盖。另核对第 5 轮文档的定量声明。代码改动 **4 个文件，+143 / -56 行**；文档 4 份；提交数见 `git log 2b4f2504..HEAD`。

> **可删符号（3 个）**：`utils.js` 的 `linearRegressionSlope()`（全仓仅定义+导出项）、`mock-llm-server.ts` 的 `ROOT` 常量（文件内仅定义本身）+ 随之无用的 `path` require、`ScenarioBuilderImpl.burst()`（全仓 `.burst(` 零命中）。
>
> **不是死文件（易误判，已核）**：`fixtures/_chatperf_*.ts`（8 个）经 `path.join(FIXTURES_DIR, name)` **字符串动态引用**；`mock-policy-server/public/*` 经 `GUI_ASSETS` 白名单映射；`mock-llm-server.ts` 被 `test/smoke/src/utils.ts:229` 跨目录引用，5 个 smoke 套件依赖。

> **真实 bug（9 处，0 高危）**：7 处 `readBody().then` 无 `.catch`（unhandled rejection 会让 Node 24 终止 mock server，整轮 benchmark 报废）+ `_startServer` 无 catch；WS 回调裸 `JSON.parse`；`loadConfig()` 裸 parse 且失败静默回退默认值；`test-chat-perf-regression.js` 6 处裸 `JSON.parse(fs.readFileSync(...))`（截断的 baseline 会让整轮起不来）；`mock-policy-server` 的 schema 源按 cwd 解析（不在仓库根启动则 `/api/schema` 恒 `ok:false`）；4 处把 `toolNamePattern.source` 反解成不存在的工具名（客户端 unknown tool 后等到超时）；`/vscode-test\/...` 硬编码正斜杠（Windows 下 buildLabel 退化）；`stripJsoncComments` 的正则会砍掉字符串里的 `http://`。

> **文档校正（6 处）**：§9.11.6 的 agentsWindow「整块保留」补注第 5 轮已删；§9.11.8 的「smoke 6 文件」拆写为「smoke 5 + automation 1」；`test-dsh:all` 增量 389→391 改为 388→391；§3.5 的 `package.json:85-94` 改为 `80-91`；报告 5 的「389 +2」与终点提交同步修正。

> **门禁**：tsc 0 error、`test-dsh:all` **391** PASS、`verify:dsh-ide-ci` 五项 PASS、`npm run compile` PASS（31 s）、`node --check` 4 个 JS PASS、TypeScript parse 3 个 .ts 0 diagnostics、`stripJsoncComments` 4/4、`loadConfig` 实跑正常。生效结论见 `docs/PROJECT_AUDIT.md`。

#### 9.11.10 第 7 轮：build/lib + test/smoke + build/next 的清理与 Bug 修复（已执行，2026-11-18）

> 三个子智能体并行（其中 build/lib 首次失败后重派收窄版），覆盖此前未逐行扫过的 `test/smoke/src/**`、`build/next/**`、`build/lib/**` 顶层 48 文件。区间 `6547a250..5451edcd`：**代码改动 20 文件，+154 / -1,316 行**，2 个代码提交（清理 / 功能分开）。

> **删除（A 批）**：`build/lib/screenshotBlocksCi.ts` + `screenshotDiffReport.ts`（零 import / 零 script / `.github` 已删 / screenshotComment.test.ts 只依赖保留的 screenshotComment.ts）；`test/smoke/src/networkProxy/{pacServer,negotiateAuthHelper}.ts` + `run-agents-window-network-proxy.sh` + 2 个 `.pac`（整条 agentsWindow 孤链）；`utils.ts` 3 个零引用导出 + 连带 `mocha` import；`shard.ts` 6 条已不存在套件权重 + 失效的 `firstShardSuite` + 恒真的预分配循环。删前均查了 import / script / workflow / 字符串路径 / 动态 path.join 五种引用。

> **真实 bug（B 批，13 处）**：`search.test.ts` 的 `after()` 浮空 Promise（高）、`utils.ts` sqlite3 回调 TDZ、两处 Alt 键未 await、`shellScenarios.ts` 与 `browserView.test.ts` 的正则元字符注入、`browserView` 的 mockServer 空引用、`build/next/index.ts` 与 `nativePolicy.ts` 的裸 JSON.parse、`nls-sourcemap.test.ts` 的 mkdtemp 泄漏、`build/lib/fetch.ts` 与 `util.ts` 异步回调内裸 JSON.parse（流挂起）、`compilation.ts` 把 cwd 当仓库根。

> **存疑保留**：`build/next/index.ts:759` 的 watch glob cwd 错位（改需长驻验证）、`copilotCli.test.ts` 死测试（唯一用例 skip、命令已删，删除牵连 main.ts 注册属测试裁剪）、11 处上游有意 skip 的假守护（启用属功能变更 + 需真机，按 AGENTS §6/§7 不做）。

> **门禁**：主 tsc 0 error；`test/smoke/tsconfig.json` 39 个错误与改动前基线完全一致（0 新增）；TypeScript parse 13 个改动 .ts 0 diagnostics；`test-dsh:all` 391 PASS；`verify:dsh-ide-ci` 五项 PASS；`npm run compile` PASS（54 s）。生效结论见 `docs/PROJECT_AUDIT.md`。

#### 9.11.11 第 8 轮：已删目录剩余引用与 chatContracts 死导出（已执行，2026-11-18）

> 三个子智能体：`scan-agentswindow-config`、`scan-src-residue`、`scan-round8-extra`。已删路径去重 52 处里 **a=0**（没有会真失败的 import / 读文件 / spawn）。`enabledApiProposals` 58 个名字缺 d.ts = 0。`agentsWindow` 配置仍被 `isSessionsWindow` 与 configuration service 消费，整组保留。区间 `1bb666d7..8e367bcb`：**12 文件，+9 / -373**。清理 `d6bd3f1f`、功能 `8e367bcb` 分开提交。

> **删除**：失效的 `code-no-private-agent-host-meta-import` 规则及测试、`eslint.config.js` 注册与 `'vs/sessions/~'`、`test/unit/node/index.js` 里永不命中的 sessions 排除、`product.ts` 两行指向已删 roadmap 的 JSDoc、chatContracts 5 个零引用导出（两个元数据 key 的字符串值也只有定义处）。

> **修复**：归档取消与会话 pill 的 7 个 `void` Promise（剪贴板、browser、opener、预览文件）补 `.catch(onUnexpectedError)`。

> **门禁**：tsc 0 error、`test-dsh:all` 391 PASS、eslint-plugin-local 测试 161 PASS、`verify:dsh-ide-ci` 五项 PASS、`npm run compile` PASS（1.12 min）。生效结论见 `docs/PROJECT_AUDIT.md`。

#### 9.11.12 第 9 轮：会话绑定竞态与关窗后的开窗分发（已执行，2026-11-18）

> 没有新的删除。`client.call` / `openView` / 会话列表 `refresh` / `loadOlder` 已在内部收口，调用处缺少 `.catch` 不记为缺陷。`acceptToolConfirmationIfPresent` 仍被同文件调用，不删。

> **修复**：`DshChatSession.bind` 与 `refreshComposer` 丢掉过期回包，失败不再回滚更新的绑定，同一 id 在绑定完成前不能返回成功。`DshIdeLaunchListener` 在报到尚未完成就 dispose 时补注销，并且不再分发 dispose 之后才返回的 poll。修复前独立复现 4/4 FAIL，修复后 4/4 PASS。

> **门禁**：tsc 0 error、`test-dsh:all` **395** PASS、`verify:dsh-ide-ci` 五项 PASS、`npm run compile` PASS（0 errors，1.58 min）。生效结论见 `docs/PROJECT_AUDIT.md`。

#### 9.11.13 第 10 轮：会话列表的归档集合与过期刷新（已执行，2026-11-18）

> §9.10 复核后确认方案一已在代码中，手册标题从「待执行」改为「已落地」，没有再改契约。

> **修复**：`DshAgentSessionsController.refresh` 用代次丢掉后返回的旧 `listSessions`。归档/恢复回包的完整 id 集合记下来，下一次名单刷新重新标 `archived`。回包不是数组时只改当前 id。不在名单里的归档 id 不补幽灵行。

> **门禁**：tsc 0 error、`test-dsh:all` **397** PASS。`verify:dsh-ide-ci` 与 `npm run compile` 在第 11 轮补跑为 **PASS**。生效结论见 `docs/PROJECT_AUDIT.md`。

#### 9.11.14 第 11 轮：未读点、交付物路径、迟到的发送和换模型（已执行，2026-11-18）

> **修复**：`submit` 失败和 `selectModel` 成功都先对代次与会话 id。已知会话的 `updatedAt` 变大时写 `isRead: false`，没变则保留上一行的已读。绝对路径交付物用 `URI.file`，相对路径仍是字符串。`planReview` / `changesSummary` / `multiDiffData` 仍不做。

> **门禁**：tsc 0 error、`test-dsh:all` **401** PASS、`npm run compile` PASS（0 errors，44 s）。`verify:dsh-ide-ci` 对本改动 **PENDING**（改动前的上一提交已 PASS）。生效结论见 `docs/PROJECT_AUDIT.md`。

#### 9.11.15 第 12 轮：已开窗口丢会话、归档菜单、目录回滚、custom 权限（已执行，2026-11-18）

> 没有删除。可用子智能体模型为 `workbuddylocal/glm-5.3-flash` 与 `hy4flash`。

> **修复**：① 开窗接单器转发 `sessionId`；IDE 已打开时不再只聚焦，而是用 `vscode:openChatSession` 绑定这次点击的会话。② 归档/恢复都走会话控制器。DSH 右键滤掉了原生 unarchive，自定义归档原先不写 `archivedIds`。③ 写回后的 `composerState` 不再复用写前的在途回包。④ 当前权限已是 `custom` 时选择器能显示它。⑤ 模型 vendor 不重复登记。

> **门禁**：`npm run compile` 0 error（1.55 min）、`test-dsh:all` **404** PASS（401 + 3）、`verify:dsh-ide-ci` 五项 PASS（`DSH_INSTALLED_VERSION=0.2.2-rc.3`）。生效结论见 `docs/PROJECT_AUDIT.md`。



---

## 原文件：`docs/DSH-core内容进入桌面前端的全部入口.md`

# DSH core 内容进入桌面前端的全部入口分析

> 历史静态源码分析存档：不再作为现行开发规范。现行真源是 `AGENTS.md`、`docs/DSH-IDE内容原子化契约.md`、`docs/DSH-IDE内容原子化差异表.md`、`docs/PROJECT_AUDIT.md` 与 `src/vs/platform/dshClient/protocol/dshIdeProtocol.ts`。
>
> 本文是一份**只读静态源码分析**记录，不修改被分析仓库的代码，也不代表真机观测结论。
>
> 分析对象：DSH 自身（`E:/deepseek-harness`）中，**DSH core（agent / session / 后端）的内容进入 DSH 自己桌面端前端的全部入口**。
>
> 分析日期：2026-11-16。所有 `file:line` 均相对仓库根目录 `E:/deepseek-harness`；行号为分析时的静态快照，定位时以实际文件为准。

---

## 目录

- [1. 认知前提：桌面端前端是 Web app](#1-认知前提桌面端前端是-web-app)
- [2. 传输骨架：9 种通道](#2-传输骨架9-种通道)
- [3. 事件总闸：转发 allowlist](#3-事件总闸转发-allowlist)
- [4. 按内容类别的全部入口](#4-按内容类别的全部入口)
- [5. Native 专用入口（Electron IPC）](#5-native-专用入口electron-ipc)
- [6. 总链路图](#6-总链路图)
- [7. 消息正文端到端细解](#7-消息正文端到端细解)
- [8. 不属于桌面入口的能力](#8-不属于桌面入口的能力)
- [附录：分析方法与边界](#附录分析方法与边界)

---

## 1. 认知前提：桌面端前端是 Web app

DSH 桌面端的"前端"**不是原生 UI，而是一个嵌在 Electron 里的完整 Web app**（`dsh-web-frontend` / `packages/client/ui-*`）。`apps/desktop` 只是个壳。证据：

- `apps/desktop/src/main.ts:522`：renderer 加载 Web client。
- `apps/desktop/src/main.ts:797-813`：`dsh-app://app/` 从 `dsh-web-frontend/dist` 本地读取，其余路径转发到 Host。

所以 core→前端的入口本质是 **Web 架构**：

- 业务数据走 **HTTP RPC + WebSocket stream + SSE**（Host BFF / api-gateway）。
- Electron IPC / contextBridge **只负责壳能力**（boot 注入、文件对话框、更新、窗口等）。

理解这一点后，"入口不止一种"是必然的——它有一整套 Web 服务的入口面。

## 2. 传输骨架：9 种通道

### 2.1 静态前端文档入口

- `dsh-app://app/`、`/index.html`、`/assets/*` 从 `dsh-web-frontend/dist` 本地读取。
- `apps/desktop/src/main.ts:797-813`、`apps/desktop/src/web-document.ts:18-35`。
- 机制：本地协议 / 静态资源服务。

```ts
protocol.handle(SCHEME, (request) => {
  const url = new URL(request.url)
  if (url.hostname === 'shell') return serveWebDocument(request, join(app.getAppPath(), ...))
  if (url.hostname === 'app') {
    if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.startsWith('/assets/')
      || ['/favicon.svg', '/manifest.webmanifest'].includes(url.pathname)) {
      return serveWebDocument(request, join(resources.dsh, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist'))
    }
    if (backend.host === undefined || hostUrl === undefined || hostCookie === undefined) {
      return Promise.resolve(new Response(null, { status: 503 }))
    }
    return forwardWebRequest(request, hostUrl, hostCookie)
  }
  return Promise.resolve(new Response(null, { status: 404 }))
})
```

### 2.2 Boot injection 入口

- Host ready 时收集 `injections`，Electron `boot` IPC 返回给 renderer。
- `apps/desktop-host/src/index.ts:165-168`、`apps/desktop/src/main.ts:821-825`、`apps/web/src/main.ts:21-35`、`packages/host/webserver/src/index.ts:846-868`、`packages/client/connection/src/index.ts:133-135`。
- 机制：IPC 请求-响应。

```ts
ipcMain.handle(DESKTOP_IPC.boot, async (event) => {
  assertDesktopSender(event, ['app'])
  await startup
  if (backend.host === undefined || hostUrl === undefined) throw new Error('Desktop Host is unavailable')
  return { injections, streamBaseUrl: new URL(hostUrl).origin }
})
```

### 2.3 Transport 声明入口

- renderer 设置 `__DSH_TRANSPORT__ = { ownsHost: true, streamBaseUrl }`。
- `apps/web/src/main.ts:24-27`、`packages/client/connection/src/client/index.ts:122-126,343-351`。
- 机制：启动参数注入。

### 2.4 HTTP unary RPC 入口

- `ctx.remote.<namespace>.<method>()` → `POST /api/<namespace>/<method>` → Host `/api` bridge。
- `packages/client/connection/src/client/rpc.ts:31-67`、`packages/client/connection/src/api-path.ts:7`、`packages/client/connection/src/index.ts:136-146`、`packages/api/gateway/src/client/index.ts:639-702`。
- 机制：请求-响应。

### 2.5 WebSocket 流式入口

- `$events` / Remote streams 走 `/api/remote.mux`。
- `packages/api/gateway/src/stream-protocol.ts:6-16`、`packages/api/gateway/src/index.ts:255-278`、`packages/api/gateway/src/client/index.ts:158-184`、`packages/api/gateway/src/client/stream-client.ts:267-269,528-535`、`packages/api/gateway/src/stream-server.ts:94-106`。
- Electron cookie/origin 重写：`apps/desktop/src/main.ts:846-857`。
- 机制：服务端推送流。

```ts
session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['ws://127.0.0.1/*', 'wss://127.0.0.1/*'] }, (details, callback) => {
  if (hostUrl === undefined || hostCookie === undefined || details.webContentsId !== mainWindow?.webContents.id) { callback({}); return }
  const target = new URL(hostUrl)
  const requested = new URL(details.url)
  if (requested.host !== target.host || requested.protocol !== (target.protocol === 'https:' ? 'wss:' : 'ws:')) { callback({}); return }
  const headers = Object.fromEntries(Object.entries(details.requestHeaders).map(([name, value]) => [name.toLowerCase(), value]))
  if (headers.origin !== 'dsh-app://app') { callback({ cancel: true }); return }
  callback({ requestHeaders: { ...headers, origin: target.origin, cookie: hostCookie, 'sec-fetch-site': 'same-origin' } })
})
```

### 2.6 SSE / client graph 入口

- `/plugins/events` 推送 client graph 与 rebuilt 通知。
- `packages/client/hmr/src/events.ts:43-50`、`packages/client/hmr/src/index.ts:158-208`、`packages/client/hmr/src/client/index.ts:30-41,74-86`。
- 机制：服务端推送。

### 2.7 插件静态资源 / bundle 入口

- `dsh-app://app/*` 的非静态路径统一转发到 Host。
- `/plugins/*` 响应强制 `no-store`。
- `apps/desktop/src/main.ts:807-810`、`apps/desktop/src/web-document.ts:70-71,83-98`。
- 机制：资源代理。

### 2.8 Native welcome / account 专用入口

- main 进程用 Host HTTP RPC 访问 `settings/credentials/account/productAnalytics`，再通过 `dshWelcome` IPC 暴露给欢迎窗口。
- `apps/desktop/src/welcome-backend.ts:52-70,98-157`、`apps/desktop/src/account-backend.ts:86-135`、`apps/desktop/src/preload-welcome.ts:11-29`。
- 机制：HTTP RPC + IPC。

### 2.9 Electron IPC / contextBridge（shell 原生能力）

- 文件保存、目录选择、拖拽、剪贴板图片、更新、平台窗口、快捷键等。
- `apps/desktop/src/preload-app.ts:16-128`、`apps/desktop/src/ipc.ts:12-47`、`apps/desktop/src/main.ts` 各 handler。
- 这类入口进入桌面前端，但不是 core 内容主干。详见[第 5 节](#5-native-专用入口electron-ipc)。

## 3. 事件总闸：转发 allowlist

所有从 Host 转发给 client 的事件先过 allowlist `API_REMOTE_FORWARDED_EVENTS`（`packages/api/remotes/src/remote-events.ts:27-59`），由 `registerRemoteEvents` / `forwardWaterfall` 按 Agent 作用域转发（`packages/api/remotes/src/index.ts:41-78,138-160`）。

完整 allowlist（`remote-events.ts:27-59`）：

| 事件 | mode | 说明 |
|---|---|---|
| `agent-preset/selected` | emit | Agent 预设选择 |
| `approval/request` | waterfall | 审批请求 |
| `api-session/activity` | emit | 会话活动（带 session 资源） |
| `api-session/added` | emit | 会话新增（带 session 资源） |
| `api-session/error` | emit | 会话错误（带 session 资源） |
| `api-session/removed` | emit | 会话移除（带 session 资源） |
| `api-session/status` | emit | 会话状态（带 session 资源） |
| `commands/change` | emit | 命令变化 |
| `deepseek-account/session-expired` | emit | 登录态过期 |
| `deepseek-account/model-sign-in-required` | emit | 需要模型登录 |
| `credentials/record-updated` | emit | 凭据记录更新 |
| `credentials/reference-updated` | emit | 凭据引用更新 |
| `goal/activation-changed` | emit | 目标激活变化 |
| `cordis/request-run` | emit | Cordis 请求运行 |
| `cordis/request-run-resolved` | emit | Cordis 请求完成 |
| `cordis/dynamic-package` | emit | 动态包 |
| `cordis/dynamic-retract` | emit | 动态回收 |
| `cordis/inspect-query` | emit | 检视查询 |
| `cordis/inspect-query-resolved` | emit | 检视查询完成 |
| `llm/adapters-updated` | emit | LLM 适配器更新 |
| `llm/models-updated` | emit | 模型更新 |
| `permission-presets/catalog-changed` | emit | 权限预设目录变化 |
| `plugin-manager/changed` | emit | 插件管理器变化 |
| `plugin-manager/install-log` | emit | 安装日志 |
| `plugin-manager/install-state` | emit | 安装状态 |
| `plugin-manager/update-state` | emit | 更新状态 |
| `plugin-market/changed` | emit | 插件市场变化 |
| `settings/document-updated` | emit | 设置文档更新 |
| `schedule/changed` | emit | 计划任务变化 |
| `user-questions/request` | waterfall | 用户提问请求 |
| `web/providers-changed` | emit | Web provider 变化 |

文件头注释明确了设计意图（同一个声明被 Host 转发循环和 consumer 的 `ctx.remote.$on` key face 共用，避免两份漂移；`emit` 项声明 payload 携带资源的读者；集合变化走 follow stream 而非 event）。

## 4. 按内容类别的全部入口

### 9.1 会话/消息正文（走 WS stream，不是文件订阅）

**core 生产点**
- `Session.commit` / `Session.#appendEvents` 写 event log 后触发 `session/event`：`packages/core/session/src/index.ts:879-906,972-984`。
- LLM 增量 `AssistantStreamAttempt.push/settle`：`packages/core/agent-loop/src/assistant-stream.ts:61-71,79-97`。
- 机制：in-process event bus / live stream。

**Host 暴露点**
- `EventListener` 订阅并按 seq 缓冲：`packages/api/session-controller/src/history/listener.ts:37-43`。
- `WebController.follow` 产出 opening snapshot + 增量事件/assistant frame：`packages/api/session-controller/src/web/controller.ts:32-76`。
- `SessionController.follow` 以 `@Remote({mode:'stream'})` 暴露：`packages/api/session-controller/src/index.ts:611-613`。
- 载体：`RemoteStreamMuxServer.handleUpgrade`：`packages/api/gateway/src/stream-server.ts:94-106`。
- 机制：WS stream / Remote stream。

**renderer 消费点**
- `SessionEventStream.follow`：`packages/api/session-controller/src/client/transport.ts:180-220`。调用 `remote.session.follow({ address, activate:true, assistantStream:true, ... }, signal)`，逐帧处理 `snapshot` / `assistant-stream` / `entry`。
- `Session.publishAssistantEntry` / `appendLive`：`packages/api/session-controller/src/client/sessions/session.ts:750-753,811-828,847-852`，写入 `eventSource`。
- `MutableSessionEventSource.subscribe`：`packages/api/session-controller/src/client/contract/events.ts:138-141,167-203`。
- 机制：WS stream → observable。

关键帧处理代码（`transport.ts:180-220`）：

```ts
for await (const frame of this.remote.session.follow({
  address: this.address, activate: true, assistantStream: true, ...this.repairRequest(request)
}, signal)) {
  if (frame.type === 'snapshot') {
    for (const record of frame.records) assertSessionWireEvent(record.event)
    if (frame.assistantStream === undefined) {
      throw new RemoteError('gateway/internal', 'session assistant stream omitted its opted-in opening baseline', {})
    }
    assistantRevision = frame.assistantStream.revision
    yield { type: 'opened', cursor: frame.cursor, page: {
      records: frame.records, hasMore: frame.hasMore,
      projections: frame.projections, assistantStream: frame.assistantStream
    } }
    continue
  }
  if (frame.type === 'assistant-stream') {
    const expected = (assistantRevision ?? 0) + 1
    if (frame.frame.revision !== expected) {
      throw new RemoteStreamCarrierError(`session assistant stream skipped revision ${String(expected)}`)
    }
    assistantRevision = frame.frame.revision
    yield { type: 'notification', notification: frame.frame }
    continue
  }
  assertSessionWireEvent(frame.event)
  yield { type: 'entry', entry: frame }
}
```

**UI 渲染点**
- `BoundConversation`：`packages/client/ui-conversation/src/client/conversation/assembly.ts:64-74`，订阅 eventSource 并汇编 conversation snapshot：

```ts
constructor(feed: SessionEventSource, private readonly assembler: ConversationNodeAssembler) {
  this.viewStore = assembler
  this.snapshot = createSnapshotStore(this.currentSnapshot())
  this.openTurn = createSnapshotStore(assembler.openTurn())
  this.replace(feed.getSnapshot())
  this.disposeFeed = feed.subscribe(() => { this.accept(feed.getSnapshot()) })
}
```

- `chatSource` / `UiSession.provide`：`packages/client/ui-chat/src/client/apply.ts:125-138`，把 `target('chat')` 暴露给 React hooks。
- `ChatView` / `ChatFlow`：`packages/client/ui-chat/src/client/chat/ChatView.tsx:81-85`、`ChatFlow.tsx:52-56`；`AssistantNodeView`：`AssistantNodeView.tsx:49-65` 渲染消息正文。
- 机制：observable → React render。

### 9.2 会话列表 / 元数据 / 搜索

- 生产：`ApiSessionList.summaryFor/list/search` 合并 live Session + `sessionQuery` 持久化记录 + `sessionListMetadata` projection（`packages/api/session-controller/src/list.ts:125,145,202`）；`applySessionListMetadata`（`:47`）维护 blank/lastPromptAt。
- Host：`SessionController` 的 `@Remote('list')`（`packages/api/session-controller/src/index.ts:282`）、`@Remote('search')`（`:296`）。机制：**RPC**。
- client：`SessionManager.list`（`packages/api/session-controller/src/client/sessions/manager.ts:405`）/ `search`（`:472`），并由 `api-session/*` 事件与 `control` 流（`packages/api/session-controller/src/client/index.ts:116,128`）合入 observable `SessionListState`（`packages/api/session-controller/src/client/sessions/service.ts:60`）。机制：**WS stream + observable**。
- UI：`WorkspaceBrowser` 的 `useSessions`（`packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx:821`）和 `deriveSearchResults`（`packages/client/ui-workspace/src/client/tree.ts:583`）渲染，搜索防抖 RPC（`:1199`）。

### 9.3 工具调用与结果

- 生产：`ToolBatch` 写 `session.append('tool/call')` / `('tool/result')`（`packages/core/tools/src/batch.ts:247,256`），事件契约在 `packages/core/session/src/types.ts:369,383`。
- Host：`EventListener` 订阅 `session/event`（`history/listener.ts:37`），经 `@Remote('page')`（`index.ts:533`）与 `@Remote({mode:'stream'}) follow`（`:611`）暴露。机制：**RPC + WS stream**。
- client：`SessionEventStream`（`client/transport.ts:138,173`）写入 `eventSource`（`client/sessions/session.ts:182,783`）；`rootCall/rootResult/applyDelta`（`packages/client/ui-chat/src/client/conversation-nodes/tool.ts:41,100,62`）投影工具节点。
- UI：`ToolCallTree` slot（`packages/client/ui-tool/src/client/apply.ts:37`）渲染。

### 9.4 Deliverables（两类）

- 生产：`present` 工具 append `deliverables/presented`（`packages/deliverables/tool-present/src/index.ts:106`）；`TurnRecorder` 汇总 git/capture 并 append `workspace/changes`（`packages/deliverables/workspace-changes/src/recorder.ts:351`），`ctx.workspaceChanges` 提供 summary/diff（`packages/deliverables/workspace-changes/src/index.ts:116,120`）。
- Host：authenticated `connection.fetch` 路由 `/api/changes.summary|diff/open`、`/api/present.open|host`（`packages/client/ui-deliverables/src/client/present-open.ts:20,26,36`）。机制：**HTTP fetch**。
- client：`deliverablesDefinition` 只消费事件（`ui-deliverables/src/client/turn-deliverables.ts:173,189`），`HostReadStore.loadUrl` 取大对象（`ui-deliverables/src/client/host-read-store.ts:71`）。
- UI：`DeliverablesTail/Deliverables`（`ui-deliverables/src/client/Deliverables.tsx:56,68`）渲染 ChangedFiles 与 PresentedFileCard（`:96,109`）。

### 9.5 Attachments（上传/引用/展示）

- 生产：浏览器草稿 `createDrafts/beginFileUpload`（`ui-conversation/src/client/service.ts:330,377`）调用流式上传。
- Host：`FileUploads` 注册 `POST` stream route（`packages/client/file-upload/src/index.ts:80`）与 `@Remote('upload')`（`:112`）、`uploadStream/imageStream`（`:127,154`），`AttachmentStore.admitPromptContent`（`packages/attachment/attachment/src/index.ts:135`）落库，prompt 通过 receipts 绑定（`api/session-controller/src/commands.ts:340,372`）。机制：**HTTP stream + RPC**。
- 读取：`@Remote('attachment')`（`api/session-controller/src/index.ts:501`）和 `HistoricalImageCache.resolve/loadCanonical`（`ui-conversation/.../historical-images.ts:36,103`）。
- UI：`fileUploads` observable 驱动 `ComposerAttachments`（`ui-attachment/src/client/ComposerAttachments.tsx:34,69`），消息图片由 `MessageImagesContent`（`ui-attachment/.../MessageImages.tsx:15`）渲染。

### 9.6 用户交互请求（审批 / 问卷）

- 生产：`ApprovalService.ask` waterfall `approval/request`（`packages/interaction/user-approval/src/index.ts:307-310`）；`UserQuestionService.ask` waterfall `user-questions/request`（`packages/interaction/user-questions/src/index.ts:347-355`），回答/计时为 `@Remote answer/attachWait`（`:169,220`）。
- Host：两条都在转发 allowlist（`remote-events.ts:29,57`），按 Agent scope 转发。
- client：`ui-approval/src/client/index.ts:107-109` 的 `$on` → `PendingApproval/registerPendingInteraction`（`:38-70`）；`ui-user-questions/src/client/index.ts:401-403` → `answerQuestion`（`:207-260`）+ projection 恢复（`:311-319`）。
- UI：`ApprovalCard`（`ApprovalCard.tsx:14,79-88`）、`QuestionComposer`（`QuestionComposer.tsx:153`；composer slot `client/index.ts:382-393`）。

### 9.7 模型目录 / 选择

- 生产：`LlmRuntime.emitAdaptersUpdated/listProviders/listConfigurableProviders/remoteDiscoverModels`（`packages/llm/llm/src/index.ts:381-400,497-500,569-572,657-664`）。
- Host：`buildModelCatalog` 聚合 provider/models（`api/session-controller/src/catalog.ts:20-72`），`SessionController.modelCatalog/selectModel`（`api/session-controller/src/index.ts:317-320,345-348`）；失效事件 `llm/adapters-updated/models-updated`（`remote-events.ts:47-48`）。
- client：`ModelCatalogDirectory.load`（`ui-model-selection/src/client/catalog.ts:47-67`），`ModelDirectory.select`（`ui-model-selection/src/client/directory.ts:92-106`），失效刷新（`ui-model-selection/src/client/service.ts:54-58`）。
- UI：`/model` popupSelect 与 `conversation.input.model` slot（`ui-model-selection/src/client/index.ts:125-195`）。

### 9.8 Settings / Credentials / Identity

- 生产：`SettingsForms.mutate` 发 `settings/document-updated`（`packages/settings/settings/src/index.ts:302-368`）；`CredentialsService.fanOut` 发 credential 更新（`packages/credentials/credentials/src/index.ts:259-283`）；账号事件 `session-expired/model-sign-in-required`（`credentials/deepseek-account/.../deepseek-account/src/index.ts:392`、`account-tasks.ts:24`）。匿名 id 仅在 Host 本地生成（`/identity/anonymous-user-id/src/index.ts:68-99`），不进 UI。
- Host：`SettingsController` / `CredentialsController` Remote（`api/settings-controller/src/index.ts:76-105`、credentials `:68-119`）；事件 allowlist（`remote-events.ts:36-39,55`）。
- client：`SettingsDescribeMirror` 刷新（`ui-settings/src/client/index.ts:41-52`）、Models 失效（`ui-settings-models/src/client/index.ts:121-134`）、账号订阅（`ui-settings-account/src/client/index.ts:180-184,270-277`）。
- UI：`ModelsSection`/onboarding slot（`ui-settings-models/src/client/index.ts:136-159`）。

### 9.9 通知 / 进度 / 状态（session-status）

- 生产：`SessionController` 发 `api-session/added/removed/status/error/activity`（`api/session-controller/src/index.ts:225-247`）；账户通知 RPC（`credentials/deepseek-account/src/index.ts:256-312`）。
- Host：emit allowlist（`remote-events.ts:30-34`）；事件/投影/assistant-stream 由 `events/observeProjections` 与 `SessionEventStream` 输出（`api/session-controller/src/index.ts:533-568`、`client/transport.ts:50-78,137-160`）。
- client：`api/session/*` handlers（`api/session-controller/src/client/index.ts:116-126`）；`UiSessionStatus` 汇总 running/pending/unread（`ui-session-status/src/client/status.ts:85-102`）；通知控制器轮询 Remote（`ui-account-notifications/src/client/index.ts:23-43`）。
- UI：`useSessionStatus` root hook（`ui-session-status/src/client/index.ts:20-23`）、`settings.launcher.notifications` slot（`ui-account-notifications/src/client/index.ts:54-67`）。

### 9.10 Plan / Goal / Todo / Skill（projection 类）

- 生产：均为 session projection——`planProjectionDefinition`（`plan/plan-mode/src/index.ts:137-169,207`）、`goalProjectionDefinition`（`goal/goal/src/index.ts:159-166,258`）、todos（`todo/tool-todo/src/index.ts:124`）；Goal 另发 `goal/activation-changed`（`goal/goal/src/index.ts:505`）；Skill 目录由 `SessionSkillCatalog.list`（`api/session-controller/src/skill-catalog.ts:20-36,65-85`）。
- Host：journal/projection stream + Remote 事件 allowlist（`remote-events.ts:40`）。
- client：`useProjection('plan')`（`ui-plan/src/client/PlanModeControl.tsx:20`）、Goal projection/Remote verbs（`ui-goal/src/client/index.ts:90-151`）、Todo 历史节点（`ui-tool/src/client/tool/models/todo-history.ts:27-54`）、`remote.skills.list`（`ui-skill/src/client/index.ts:121-132`）。
- UI：`PlanCards/PlanPreview`（`ui-plan/src/client/index.ts:63-111`）、`GoalDock`（`ui-goal/src/client/index.ts:102-154`）、`TodoRow/SkillRow` toolview slots（`ui-tool/src/client/tool/toolviews/todo-row.tsx:80-92`、`ui-skill/src/client/index.ts:88-91,169-178`）。

### 9.11 其它 UI 包群（同骨架机制）

- 工作区 / 文件 / 终端 / 文档预览 / 浏览器侧栏：`ui-workspace`、`ui-sidebar-files`、`ui-sidebar-terminal`、`ui-sidebar-documentpreview`、`ui-sidebar-browser`，数据来自 workspace/fs/terminal 的 Remote 服务与 stream。
- 插件管理 / 市场 / 清单 / 遥测：`ui-plugin-manager`、`ui-plugin-market`、`ui-settings-plugin-inventory`、`ui-settings-plugins`、`host/plugin-inventory`、`host/open-in-app`、`client/product-analytics`。
- 它们都走与前面相同的 RPC + 事件 allowlist + stream 机制，此处不逐一展开。

## 5. Native 专用入口（Electron IPC）

这些是"壳"能力，进入 renderer 但不走 core 主干：

| contextBridge API | IPC channel | main handler | 消费 client UI 包 |
|---|---|---|---|
| `dshDesktop.fileActions.save/readClipboardImage` | `dsh-desktop:file-save`、`dsh-desktop:clipboard-image-read` | `src/file-actions.ts:100,136` | `client/ui-file-actions` |
| `dshDesktop.browser.acquire/release/onOpenRequested` | `dsh-desktop:browser-acquire/release/open-requested` | `src/main.ts:837-844` | `client/ui-sidebar-browser` |
| `dshDesktop.fileDrag.prepare/cancel/start/release` | `:file-drag-prepare/cancel/start/release` | `src/file-drag.ts:112,122,126,148` | `client/ui-file-drag`、`util/file-drag` |
| `dshDesktop.keyboard` / `shortcuts` | `:shortcuts-input/close-window/get/edit/recording/changed` | `src/keyboard.ts:80,86,91,97`（输入派发 `:54,69,199`） | `client/shortcuts`、`client/ui-shortcuts` |
| `dshDesktop.updates.channels/status/open/subscribe` | `:updates-channel-get/set/changed`、`updates-status/open/presentation` | `src/main.ts:948-1024`、`update-overlay.ts` | `client/ui-settings-general` |
| `dshDesktop.deviceInfo` | `dsh-desktop:device-info` | `src/main.ts:1038` | 反馈问卷相关 client 包 |
| `dshOnboarding.hasApiKey/setActive` | `:onboarding-api-key/active`、`enter-workspace` | `src/main.ts:827-835` | `client/ui-settings-account` |
| `dshDesktopBoot.ready/failed` | `dsh-desktop:boot`、`boot-failed` | `src/main.ts:821,828` | web-frontend bootstrap / `client/locale` |
| `__DSH_DIRECTORY_PICKER__.pick` | `dsh-desktop:directory-pick` | `src/directory-picker.ts:12` | `client/ui-directory-picker-native` |
| `__DSH_HOST_PATHS__.pathFor` | 无 IPC（`webUtils.getPathForFile`） | `src/preload-app.ts:110` | `client/ui-file-actions`、`ui-file-drag` |
| `dshPlatform.open/setBounds/close` | `dsh-platform:open/bounds/close` | `src/main.ts:870,875,879` → `platform-view.ts` | 内嵌 Platform Web |
| `__DSH_LOCALE__.read/onChange` | `dsh-desktop:locale-bootstrap/changed` | `src/main.ts` locale 处理 | `client/locale` |
| `dshWelcome.*` | `dsh-welcome:*`（`welcome-api.ts:8-18`） | `welcome-window.ts:81-115` | `dsh-web-welcome` |
| `dshMandatoryUpdate.status/action/subscribe` | `dsh-desktop:mandatory-status/state/action` | `mandatory-update-window.ts:245-280` | `shell/mandatory-update.html` |
| `dshUpdateDialog.status/respond/subscribe` | `dsh-update-dialog:status/changed/respond` | `update-dialog.ts:75,76` | `shell/update-dialog.html` |
| Platform 注入 `dsh.getAuthToken/onLocaleChange` | `dsh-platform:bootstrap/locale-changed` | `platform-ipc.ts:4-8`，`src/main.ts:866` | Platform 页自身 |

窗口控制/深链/剪贴板/截图：深链 `dsh://open` 在 `main.ts:1488-1492` 仅触发主进程聚焦，不暴露给 renderer；窗口焦点/全屏/系统菜单由 `preload-platform.ts:27`、`preload-menu.ts:67`、`preload-windows.ts:45`、`preload-theme.ts:24` 的 `ipcRenderer.on/send` 处理；未发现 `capturePage`/`desktopCapturer` 截图 IPC。上述 main handler 及 preload 路径均相对 `apps/desktop/src/`。

## 6. 总链路图

```
┌─ core 进程（Cordis plugins）─────────────────────────────┐
│ session/commit · agent-loop · tools · interaction · llm │  产生事件/投影/状态
│ settings · credentials · deliverables · attachment ...  │
└───────────────┬──────────────────────────────────────────┘
                │ in-process event bus (ctx.on / ctx.effect)
┌───────────────▼── Host（desktop-host / api-gateway / BFF）┐
│ EventListener(seq 缓冲) · buildModelCatalog · ApiSessionList│
│ @Remote 方法 · SessionController.follow (stream)           │
│ API_REMOTE_FORWARDED_EVENTS allowlist                     │
└───┬──────────┬──────────┬──────────┬──────────┬───────────┘
    │          │          │          │          │
 HTTP RPC   WS mux     SSE /plugins  HTTP fetch  IPC boot
 /api/ns/m  /api/remote /events      (大对象)   /contextBridge
    │          │          │          │          │
┌───▼──────────▼──────────▼──────────▼──────────▼───────────┐
│ renderer（dsh-web-frontend + packages/client/ui-*）        │
│ client/connection · SessionEventStream · SessionManager    │
│ observable stores → hooks → React 组件（ChatView 等）      │
└────────────────────────────────────────────────────────────┘
```

一条具体链路（消息正文）：
`Session.commit` → `session/event` → `EventListener` → `WebController.follow` → WS `/api/remote.mux` → `SessionEventStream.follow` → `MutableSessionEventSource` → `BoundConversation` → `ChatFlow/AssistantNodeView`。

## 7. 消息正文端到端细解

这是最核心的一条链路，单独展开：

| 阶段 | 机制 | 关键 symbol | file:line |
|---|---|---|---|
| ① 事件产生 | in-process event bus | `Session.commit` / `#appendEvents` | `packages/core/session/src/index.ts:879-906,972-984` |
| ② 增量帧 | live stream | `AssistantStreamAttempt.push/settle` | `packages/core/agent-loop/src/assistant-stream.ts:61-71,79-97` |
| ③ Host 订阅缓冲 | event → buffer | `EventListener` | `packages/api/session-controller/src/history/listener.ts:37-43` |
| ④ follow 产出 | opening snapshot + delta | `WebController.follow` | `packages/api/session-controller/src/web/controller.ts:32-76` |
| ⑤ Remote 暴露 | `@Remote({mode:'stream'})` | `SessionController.follow` | `packages/api/session-controller/src/index.ts:611-613` |
| ⑥ WS 载体 | mux upgrade | `RemoteStreamMuxServer.handleUpgrade` | `packages/api/gateway/src/stream-server.ts:94-106` |
| ⑦ Electron 放行 | cookie/origin rewrite | `onBeforeSendHeaders` | `apps/desktop/src/main.ts:846-857` |
| ⑧ client 订阅 | WS → journal | `SessionEventStream.follow` | `packages/api/session-controller/src/client/transport.ts:180-220` |
| ⑨ 写 observable | appendLive/publish | `Session.publishAssistantEntry` | `packages/api/session-controller/src/client/sessions/session.ts:750-753,811-828,847-852` |
| ⑩ 事件源订阅 | observable | `MutableSessionEventSource.subscribe` | `packages/api/session-controller/src/client/contract/events.ts:138-141,167-203` |
| ⑪ 装配快照 | assemble | `BoundConversation` | `packages/client/ui-conversation/src/client/conversation/assembly.ts:64-74` |
| ⑫ 暴露给 React | slot/target | `chatSource` | `packages/client/ui-chat/src/client/apply.ts:125-138` |
| ⑬ 渲染 | React render | `ChatView/ChatFlow/AssistantNodeView` | `packages/client/ui-chat/src/client/chat/*.tsx` |

## 8. 不属于桌面入口的能力

- **`packages/sdk`（newline JSON-RPC / stdio）**：给外部自动化/SDK 用（`packages/sdk/README.md:6,12,29-31`），不是桌面前端链路。
- **Web 专属能力**（`apps/web` 的浏览器 API、in-page picker 等）：走 `dsh-web-frontend` + Host，不经桌面 contextBridge。
- **SharedWorker**：主干中未发现。
- 唯一的 `postMessage/MessageChannel` 只用于 shell mandatory overlay（`preload-mandatory-overlay.ts:39-42,57-59`），不承载 core 内容。
- 深链 `dsh://open` 只触发主进程聚焦，不是 renderer 数据入口；`dsh-app://` 是内部资源协议，不是对外深链。

---

## 附录：分析方法与边界

- 本文基于 **只读静态源码分析**，未修改 `E:/deepseek-harness` 任何文件。
- 未运行 GUI、未模拟 DSH 会话、未做真机验证；所有分析为静态证据推导，运行时细节需要真机日志确认。
- DSH 本体部分的行号来自逐包检索；部分 UI 包群（第 4.11 节）只归纳机制未逐文件展开，如需可继续下钻到组件级。
- 仓库开发约定见 `E:/deepseek-harness/AGENTS.md`；本分析文档不改任何源码、协议真源或许可证凭据。


---

## 原文件：`docs/DSH-IDE内容接收与ChatSession面板架构分析.md`

# DSH-IDE 内容接收机制与 Chat / Session 面板架构深度分析

> 历史架构分析存档：不再作为现行开发规范。现行真源是 `AGENTS.md`、`docs/DSH-IDE内容原子化契约.md`、`docs/DSH-IDE内容原子化差异表.md`、`docs/PROJECT_AUDIT.md` 与 `src/vs/platform/dshClient/protocol/dshIdeProtocol.ts`。文中 `wireRevision 3/4`、旧 method 数、旧协议路径、`E:/deepseek-harness` 均为历史快照，不代表当前实现。
>
> 基于当时代码树（`e:/DSH-IDE`）实际实现撰写，所有结论均给出 `文件:行号` 依据；行号与实现可能已漂移。
> 遵循 `AGENTS.md`：**DSH-IDE 是 DSH 应用内的 bundle 插件，不是独立应用**；进程边界只走官方客户端传输与唯一 `dshIde` 通道。
>
> **总纲**：当前树里**不存在独立的「DSH Chat 面板」或「DSH Session 面板」类**。DSH-IDE 复用 VS Code 原生 Chat 视图容器与 `ChatViewPane`，DSH 内容通过唯一 `dshIde` IPC 通道进入渲染进程，再以「数据源注入」方式嵌入原生 Chat UI。当前生效的 DSH 改动是「换图标/文案 + 注册 DSH 模型目录 + 接入会话列表 + 接收快照到内部状态」，而 **DSH 消息正文到原生 ChatModel 的渲染 driver 目前停用**。

---

## 目录

1. [身份前提与架构边界](#1-身份前提与架构边界)
2. [DSH 内容接收管线总览](#2-dsh-内容接收管线总览)
3. [契约真源 dshIdeProtocol.ts](#3-契约真源-dshideprotocolts)（含 3.4 DTO 方法完整清单、3.5 契约门禁）
4. [传输层与主进程装配](#4-传输层与主进程装配)（含 4.4 开窗接单器）
5. [主进程通道 DshIdeChannel](#5-主进程通道-dshidechannel)
6. [渲染进程客户端 DshClientService](#6-渲染进程客户端-dshclientservice)
7. [内容消费与 fail-closed](#7-内容消费与-fail-closed)
8. [三类内容流的完整路径](#8-三类内容流的完整路径)
9. [Chat 视图容器的注册与显示](#9-chat-视图容器的注册与显示)
10. [ChatViewPane 内部结构](#10-chatviewpane-内部结构)（含 10.4 会话列表状态机与服务）
11. [ChatWidget 组件树与控件清单](#11-chatwidget-组件树与控件清单)
12. [DSH 已接线 vs 未接线组件](#12-dsh-已接线-vs-未接线组件)
13. [端到端时序](#13-端到端时序)
14. [关键结论与风险点](#14-关键结论与风险点)
15. [附录：关键文件索引](#附录关键文件索引)

---

## 1. 身份前提与架构边界

### 1.1 唯一开发路线（AGENTS.md 纪律）

- DSH-IDE 是 **DSH 应用内的 bundle 插件**，不是独立应用，不产出独立 IDE 安装包。
- `dshCtx` 本就是 DSH 的、位于 DSH Host 进程；DSH-IDE 作为插件直接复用。
- DSH 应用内部进程边界（Host 半身 / IDE 窗口）只走：① 官方客户端传输（`src/vs/platform/dshClient/transport/`）；② 唯一 `dshIde` 通道（`DSH_IDE_CHANNEL = 'dshIde'`，`dshIdeProtocol.ts:17`）。
- 禁止把它当作「两个 app 需要跨边界合并」来设计。

### 1.2 进程分层

```text
┌───────────────────────────────────────────────────────────────────────┐
│ DSH Host 进程（官方 DSH 插件宿主 / Cordis 上下文 dshCtx）             │
│   持有：sessions / sessionController / composerState / 审批 pending   │
│   实现：src/vs/platform/dshClient/host/ide-view-host.js（搬自官方）   │
└───────────────────────────┬───────────────────────────────────────────┘
                            │ HTTP / WebSocket 官方线协议
                            │ ide/followSession、ide/dispatch、api/$events/result
┌───────────────────────────▼───────────────────────────────────────────┐
│ IDE 主进程（electron-main）                                           │
│   dshIdeBackendFactory.ts  按环境装配传输后端                         │
│   dshIdeTransport.ts       官方客户端传输适配（fetch/WS）             │
│   ide-view-service.ts      DshIdeViewService：原始帧 → 三类快照/通知    │
│   dshIdeChannel.ts         IServerChannel<string>，唯一通道 dshIde     │
└───────────────────────────┬───────────────────────────────────────────┘
                            │ Electron IPC（IChannel.listen / call）
┌───────────────────────────▼───────────────────────────────────────────┐
│ IDE 渲染进程（workbench）                                             │
│   dshClientService.ts      IDshClientService，原样转发三类事件         │
│   dshIdeConsumer.ts        结构校验+连续性+16ms 合并+fail-closed       │
│   dshChatSession.ts        进程唯一聊天状态                            │
│   dshAgentSessionsController.ts → 原生 AgentSessionsControl            │
│   dshLanguageModelProvider.ts   → 原生模型选择器                       │
│   ChatViewPane / ChatWidget / ChatListWidget（原生 UI）                │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.3 边界门禁

- `platform/dshClient/common` 与 `electron-main` 必须**零 `@deepseek-ai/*` 引用**。
- 官方包只在 DSH 宿主 asar，IDE 进程不可达，故 `dshIdeTransport.ts:11-14` 按官方线协议手写最小客户端，只依赖 `fetch`/`WebSocket`，不复制业务逻辑。
- `workbench/**` 的 DSH 文件同样零 `@deepseek-ai/*`（`dshIdeConsumer.ts:8`、`dshChatSession.ts:9`）。

### 1.4 官方源码对照依据（AGENTS.md 第 7 条）

| 文件 | 行号 | 引用内容 |
|---|---|---|
| `src/vs/platform/dshClient/host/ide-view-host.js` | 12 | 已核对服务：`sessions`、`sessionController`（`E:/deepseek-harness-0.2.2-rc.1`） |
| 同上 | 974 | `publishHostEndpoint` 端点文件形状依据 |
| `src/vs/workbench/contrib/dsh/browser/dshChatModel.ts` | 8 | 会话节点形状依据：`packages/client/ui-conversation/src/client/contract/records.ts` |
| `src/vs/platform/dshClient/PROVENANCE.md` | 18 | 权威源仓库凭据：`E:\deepseek-harness-0.2.2-rc.1`（只读） |
| `build/lib/dsh/PROVENANCE.md` | 5,11,16,58 | 复用源同步到 rc.3、权威源 tag 克隆、`ui-chat` 采样路径 |
| `build/dsh/chat-render/PROVENANCE.md` | 11,16,58 | 同批凭据留存副本 |
| `build/lib/test/dshIdeEndpoints.test.ts` | 14 | 端点核对凭据，无真机观测 |
| `scripts/sync-upstream.mjs` | 16,27 | 上游同步脚本 `--source E:/deepseek-harness-0.2.2-rc.1` |

协议文件自身也标注官方源码行号：`dshIdeProtocol.ts:106`（`ImageAttachmentRef` → `attachment/src/types.ts:11-32`）、`:144-146`（`SessionPageRequest` → `session-controller/src/types.ts:469-478`）、`:188-191`（`SessionSearchRequest` → 同文件 `:255-263,:168-171`）、`:404-405`（`parseCommand` → `interaction/commands/src/index.ts:125-131`）。

---

## 2. DSH 内容接收管线总览

```text
DSH Host
  │ sessionController.follow / api-session 事件 / 审批问卷事件
  ▼
DshIdeTransport（HTTP / WS 官方线协议）
  ▼
DshIdeViewService.receive() ──分流──┬─→ waterfall 订阅者
  │                                 ├─→ session-notice 订阅者
  │                                 └─→ publish(snapshot)
  ▼
DshIdeChannel（归属过滤 + version 过滤，listen 白名单）
  ▼
DshClientService（原样转发 onDidSnapshot / onDidWaterfall / onDidSessionNotice）
  ▼
DshIdeConsumer（结构校验 + 连续性 + 16ms 合并，fail-closed）
  ▼
DshClientContribution / DshChatSession / DshAgentSessionsController
  ▼
原生 ChatViewPane / AgentSessionsControl（UI 显示）
```

**三条硬纪律**（`dshClientService.ts:10-15`）：
1. 状态变化**只走** `listen('snapshot')`，客户端服务**不做校验**（校验唯一职责在 `DshIdeConsumer.accept()`，避免两处实现漂移）；
2. 调用**只走** `call(method, args)`，返回 `{ value }`，**绝不回推快照**；
3. 快照是 `DshIdeSnapshot`（`wireRevision 3`，`state:'ready'` 时携带 `state.view` 投影载荷）。

---

## 3. 契约真源 dshIdeProtocol.ts

> 2026-11-16 动手后，`DSH_IDE_WIRE_REVISION` 为 4，method 为 36。本节下面的数字和行号是动手前快照，当前口径以《DSH-IDE改造开发手册》§7 为准。

文件：`src/vs/platform/dshClient/common/dshIdeProtocol.ts`（约 40.6 KB）。文件头（`:6-14`）声明：协议唯一真源，所有类型/常量/校验器只在此声明；`dshIdeContract.ts` 单向引用本文件常量，本文件绝不反向引用 contract；插件侧零 electron 直接引用。

### 3.1 关键常量

| 常量 | 值 | 行号 | 说明 |
|---|---|---|---|
| `DSH_IDE_CHANNEL` | `'dshIde'` | 17 | 唯一 IPC 频道名 |
| `DSH_IDE_API_VERSION` | `'0.2.2-rc.1'` | 20 | 与契约单测核对的 API 版本 |
| `DSH_IDE_WIRE_REVISION` | `3` | 26 | 快照连续性校验依据；快照形状变化故升到 3 |
| `DSH_IDE_DELETE_SESSION_PLUGIN` | `'@michengai/dsh-archive-manager'` | 36 | `deleteSession` 依赖的社区插件 |
| `DSH_IDE_DELETE_SESSION_PLUGIN_VERSION` | `'1.3.1'` | 37 | 版本绑定 |
| `DSH_IDE_DELETE_SESSION_ENDPOINT` | `'workspaceRegistry/deleteSession'` | 39 | Typert endpoint |
| `DSH_IDE_FEATURE_UNAVAILABLE` | `'dsh-ide/feature-unavailable'` | 42 | method 不在白名单 / 端口未接线 |
| `DSH_IDE_INVALID_ARGUMENT` | `'dsh-ide/invalid-argument'` | 44 | 入参校验失败 |
| `DSH_IDE_ALREADY_RESOLVED` | `'ALREADY_RESOLVED'` | 47 | waterfall 已被另一窗口 resolve |
| `DSH_IDE_SESSION_SWITCHED` | `'SESSION_SWITCHED'` | 50 | 目标会话已切换 |
| `DSH_IDE_SNAPSHOT_STALE` | `'SNAPSHOT_STALE'` | 53 | 本地快照落后过多，需 refreshSnapshot |

### 3.2 核心数据结构

```ts
// :56-60
export interface DshRemoteError {
  readonly code: string; readonly message: string; readonly details?: unknown;
}
// :67-79 会话列表项（绑定官方 SessionSummary）
export interface IDshIdeSessionSummary {
  readonly sessionId: string; readonly workspaceId: string; readonly title?: string;
  readonly updatedAt: number; readonly running: boolean; readonly blank: boolean;
  readonly agentAvailable: boolean;
  readonly formatStatus?: 'current' | 'migration-required';
  readonly cwd?: string; readonly parentSessionId?: string; readonly origin?: 'subagent';
}
// :85-87 一帧跟会话结果（就是 sessionController.follow 的帧，不折叠）
export interface DshIdeViewSnapshot { readonly frame: Readonly<Record<string, unknown>>; }
// :89-95 渲染器消费的视图状态
export interface DshIdeViewState {
  readonly state: 'starting' | 'ready' | 'rebuild';
  readonly message?: string;
  readonly view?: DshIdeViewSnapshot;   // state === 'ready' 时必填
}
// :97-103 单帧快照
export interface DshIdeSnapshot {
  readonly wireRevision: number; readonly channelId: string;
  readonly version: number;             // 单调递增
  readonly state: DshIdeViewState;
}
```

协议还定义了图片附件类型（`DshIdeImageAttachmentRef`，`:109-116`：`attachmentId` 是不透明存储 id，媒体类型字段叫 `mediaType`，非 URL/路径）、分页/搜索请求（`:144-146`、`:188-191`）、以及 `validateDshIdeSnapshot`、`validateDshIdeInput`、`validateDshIdeInvokeOutput`、`assertSnapshotContinuity` 等校验器。

### 3.3 控制命令与事件名（在 dshIdeChannel.ts 定义）

| 类别 | 名称 | 常量 | 文件:行号 |
|---|---|---|---|
| 控制命令 | `open`/`close`/`rebind`/`launch` | `DSH_IDE_CONTROL_*` | `dshIdeChannel.ts:34-43` |
| 推送事件 | `snapshot` | `DSH_IDE_SNAPSHOT_EVENT` | `dshIdeChannel.ts:56` |
| 推送事件 | `waterfall` | `DSH_IDE_WATERFALL_EVENT` | `dshIdeChannel.ts:58` |
| 推送事件 | `session-notice` | `DSH_IDE_SESSION_NOTICE_EVENT` | `dshIdeChannel.ts:60` |

控制命令与约 30 个 DTO method 共用 `call()`，**method 名即 command 名，无外层 `invoke` 包裹**（`dshIdeProtocol.ts:10-11`、`dshClientService.ts:182`）。

### 3.4 DTO 方法完整清单（DshIdeMethodArgs）

`DshIdeMethodArgs`（`dshIdeProtocol.ts:128-224`）是全部 `client.call(method, args)` 参数的唯一真源，共 **30 个 method**。`DshIdeMethod = keyof DshIdeMethodArgs`（`:266`）；运行侧 `DSH_IDE_METHOD_KEYS`（`:269-300`）用同一份字段列表做 `exactRecord` 精确校验（拒绝未知字段、省略显式 `undefined`，`:306-312`）。**TS 类型与运行时 key 表同源**，避免两处漂移。整个方法表在 `dshIdeChannel.invoke()` 统一经 `validateDshIdeInput` 校验（见 5.2）。

| # | method | 参数 | 作用 | 行号 |
|---|---|---|---|---|
| 1 | `submit` | `{ text }` | 提交一条用户消息 | 130 |
| 2 | `interrupt` | `{}` | 中断当前生成 | 132 |
| 3 | `resume` | `{ sessionId? }` | 恢复一个会话（可选指定） | 134 |
| 4 | `newSession` | `{ workspace?, options? }` | 开新会话 | 136 |
| 5 | `fork` | `{ sessionId, point? }` | 从某点 fork 会话 | 138 |
| 6 | `rewind` | `{ sessionId, to }` | 回退到某点 | 140 |
| 7 | `loadOlder` | `{ sessionId, throughSeq?, beforeSeq?, maxMessages? }` | 向前读一页历史；`beforeSeq` 为数值游标，`throughSeq` 为包含式日志切点，随 `call` 返回而非 snapshot | 156 |
| 8 | `answerApproval` | `{ requestId, decision, reason? }` | 决议审批请求 | 158 |
| 9 | `answerQuestion` | `{ requestId, answer }` | 决议问卷请求 | 160 |
| 10 | `cancelRequest` | `{ requestId }` | 取消进行中请求 | 162 |
| 11 | `setModel` | `{ model }` | 设置模型 | 164 |
| 12 | `setEffort` | `{ effort }` | 设置 effort（推理档） | 166 |
| 13 | `setPermissionPreset` | `{ preset }` | 设置权限预设 | 168 |
| 14 | `runCommand` | `{ command, args? }` | 运行斜杠命令 | 170 |
| 15 | `listSessions` | `{ workspace? }` | 列出工作区可见会话，返回 `IDshIdeSessionSummary[]` | 176 |
| 16 | `presentationSettings` | `{}` | 读取桌面端聊天展示设置 | 178 |
| 17 | `deleteSession` | `{ sessionId }` | 删除会话（直接删，不入回收站） | 180 |
| 18 | `archiveSession` | `{ sessionId }` | 归档会话，返回完整归档集合 | 182 |
| 19 | `unarchiveSession` | `{ sessionId }` | 恢复归档会话 | 184 |
| 20 | `searchSessions` | `{ query }` | 分批检索会话（依赖宿主 `@deepseek-ai/dsh-session-query`，未挂载原样透传失败） | 195 |
| 21 | `composerState` | `{}` | 读输入框控件状态（模型目录、当前选择、权限、团队、预设）；缺项投影为 `null` 并隐藏控件 | 202 |
| 22 | `setTeamEnabled` | `{ enabled }` | 开关当前根会话的智能体团队 | 204 |
| 23 | `setAgentPreset` | `{ preset }` | 会话开始前切换智能体预设（已开聊官方拒绝） | 206 |
| 24 | `listModels` | `{ workspace? }` | 列出可用模型 | 208 |
| 25 | `listCommands` | `{ workspace? }` | 列出可用命令 | 210 |
| 26 | `fetchRowDetail` | `{ rowId }` | 取某行完整内容（折叠行回 Host 取详情） | 212 |
| 27 | `readAttachment` | `{ attachment }` | 按 `attachmentId` 读图片附件字节（base64，绝不返回路径） | 217 |
| 28 | `refreshSnapshot` | `{}` | 主动刷新快照（对应 `DSH_IDE_SNAPSHOT_STALE`） | 219 |
| 29 | `accountGetState` | `{ client }` | 读取 DeepSeek 账号投影（登录态） | 221 |
| 30 | `accountGetProfile` | `{ client }` | 读取账号资料（显示名/联系方式/头像 URL） | 223 |

`client` 参数为官方 `AccountClientMetadata` 三元组（`IDshAccountClientMetadataArgs`，`:234-241`：`version`/`locale`/`timezoneOffsetSeconds` 全必填、不含密钥），由 `dshAccountClientMetadata()`（`:256-263`）按官方口径构造（`timezoneOffsetSeconds = -new Date().getTimezoneOffset() * 60`）。当前仓库中真正被 UI/服务调用的只有：`submit`、`interrupt`、`setModel`、`answerApproval`、`answerQuestion`（`dshChatSession.ts`）、`composerState` 及 `set*` 写回（`dshComposerSource.ts`）、`listSessions`/`deleteSession`/`newSession`/`archiveSession`/`unarchiveSession`/`searchSessions`（会话服务，见 10.4）——其余方法是协议已声明但 UI 未接的完整能力面。

### 3.5 契约门禁 dshIdeContract.ts

文件：`src/vs/platform/dshClient/common/dshIdeContract.ts`。依赖方向**单向**：本文件引用 `dshIdeProtocol.ts` 常量（`:13` `DSH_IDE_API_VERSION`、`DSH_IDE_WIRE_REVISION`），协议文件绝不反向引用它（`:8`）。

- `UPSTREAM_VALIDATED_VERSION = '0.2.2-rc.1'`（`:16`）：经校验承诺兼容的上游 DSH stable 版本；上游升级时只改此处 + translator/dshEmits 穷举。
- `BLESSED_PACKAGES`（`:24-28`）：受信 DSH 包及 semver 范围。只列真实发布的 npm 包——当前仅 `@deepseek-ai/dsh-web-frontend`（`^0.2.2`）。`packages/core/` 与 `packages/adapter/` 是上游的**目录组**、不是可安装包名，不能写进这里。
- `VSCODE_PATCH_POINTS`（`:48-77`）：VS Code 侧 4 个注入点（`chat-viewlet`→`ChatViewPane`、`inline-completion`→`InlineCompletionsController`、`terminal`→`ITerminalService`、`command-palette`→`QuickAccessController`），每个带基线文件 sha256 前 16 位。上游升版时 `verify:dsh-ide-contract` 据此做**失败断言**（而非只打印哈希），提示 patch 是否需重放。
- `parseVersion` / `compareVersion`（`:80-88`）：semver 比较，正式版优先于预发布。
- 版本策略：优先跟随 DSH stable，不在 rc 迭代期盲目追新；`installedMeetsVersion` / `upstreamDrift` 在插件启动时做 drift 警告，CI 做失败门禁（`:9-10`）。

---

## 4. 传输层与主进程装配

### 4.1 dshIdeTransport.ts（官方线协议最小实现）

文件：`src/vs/platform/dshClient/transport/dshIdeTransport.ts`。

线上形态（文件头 `:19-23`）：
```text
鉴权   GET  /?token=…                 → 303 + set-cookie（官方 launch token 交换）
一元   POST /api/<ns>/<method>         → { type:'client-request', rpcId, method, payload:{args} }
流式   WS   /api/remote.mux            → { type:'open', streamId, endpoint, payload:{args} }
waterfall WS item → POST /api/$events/result → { clientId, eventId, outcome }
```

**`args` 的键必须等于服务方法的形参名**（`:25-28`）：Typert 按 descriptor 逐字段校验，例如 `session/list(_request, signal)` 要传 `{ _request: {...} }`，`session/prompt(request, signal)` 要传 `{ request: {...} }`，`signal` 由 Host 注入、客户端不传。真机实测传自由字段会得到 `gateway/arguments-invalid: missing "_request"`。

关键类型：
- `DshIdeWebSocket`（`:37-43`）：`readyState` / `send` / `close` / `addEventListener`
- `DshIdeTransportPrimitives`（`:46-49`）：注入 `fetch` / `WebSocket`
- `DshIdeTransportOptions`（`:52-59`）：`origin` + 已换取的 `cookie`
- `DshIdeTransportError`（`:62-71`）：保留官方错误码

上行调用：一元调用 → `POST /api/<ns>/<method>`；`answerWaterfall()` → `POST /api/$events/result`（`:217-226`）；`call('ide','dispatch',{method,payload})` → Host 官方服务调用（`:420-426`）。

### 4.2 dshIdeBackendFactory.ts（后端装配）

文件：`src/vs/platform/dshClient/electron-main/dshIdeBackendFactory.ts`。

`createDshIdeBackendFromEnv()`（`:25-36`）三种情形只有一个分支点：
1. 配了 `DSH_IDE_ENDPOINT` + `DSH_IDE_COOKIE`：用官方传输适配；
2. 只配 `DSH_IDE_ENDPOINT`（未换 cookie）：同一适配先按官方 `/?token` 换 cookie；
3. 都没有：`UnavailableDshIdeBackend`，所有调用以 `FEATURE_UNAVAILABLE` 拒绝。

**`LazyDshIdeTransportBackend`**（`:43`）：
- `open()`（`:95-101`）：同步生成 `channelId = dsh-ide:${crypto.randomUUID()}`，保存 `pendingOpen`，**HTTP 端点首帧前不等待 IO**。
- `follow()`（`:105-178`）：`connect()` 建立订阅，断线时 `onDisconnect` + 退避重连：
  ```ts
  const delay = Math.min(5000, 250 * 2 ** Math.min(attempt - 1, 5));  // :147
  ```
  重连前 `refreshEndpoint()` 重读 Host 端点文件——IDE 可能比 DSH 活得久，DSH 重启换端口后旧 origin 会永久失联（`:67-93`）。端点变了就作废旧 cookie、关旧连接。
- `invoke()`（`:179-192`）：端点确实变了才重试一次，避免对真实业务失败做无意义重放。
- `exchangeCookie()`（`:221-230`）：用 launch URL 换 cookie 后**立刻清除进程环境里的一次性 token**（`delete env[DSH_IDE_LAUNCH_URL_ENV]`，D55），不再落盘留驻。

### 4.3 ide-view-service.ts（原始帧分流）

文件：`src/vs/platform/dshClient/electron-main/ide-view-service.ts`。

- `open()`（`:67-89`）：重复触发复用既有连接和 channelId，不创建第二实例；返回首帧快照 `state:{state:'starting'}`，`version:1`。
- `rebind(sessionId)`（`:92-120`）：停旧订阅、按新会话重开，`version += 1`，广播 `starting` 快照。
- `invoke(method,args)`（`:137-150`）：调后端；`newSession`/`fork` 成功后自动 `rebind()` 到新 sessionId。
- `publishDisconnected(error)`（`:172-188`）：传输断开时公布 `state:'rebuild'` 快照，消息 `"DSH 连接已断开，正在重新连接…"`，**只改状态、不推伪造内容**，避免把断线误认为模型思考中。
- `receive(raw)`（`:191-218`）分流核心：
  ```ts
  const notice = projectDshIdeWaterfallNotice(raw);   // :195
  if (notice !== undefined) { for (listener of waterfall) listener(notice); return; }
  if (raw.type === 'waterfall') return;               // :202-205 形状不合的帧丢弃，不混进内容流
  const kind = raw.type;
  if (kind === 'session-status' || kind === 'session-list') {  // :207-216
    // → session-notice 订阅者
    return;
  }
  this.publish({ frame: raw });                       // :217 其余才是聊天内容帧
  ```
- `publish(view)`（`:220-235`）：`version += 1`，构造 `state:{state:'ready', view}` 快照广播。
- 三个订阅入口：`subscribe()`（`:122-125`）、`subscribeWaterfall()`（`:127-130`）、`subscribeSessionNotice()`（`:132-135`）。

### 4.4 开窗接单器 dshIdeLaunchListener.ts（入口来源）

文件：`src/vs/platform/dshClient/transport/dshIdeLaunchListener.ts`。

它解决了「DSH 主窗口『DSH-IDE』按钮如何打开 IDE 窗口」这一入口问题。真机实测发现 `dshIde` 是 **IDE 自己的** IPC 通道，Host 在另一个进程无法跨进程调用它，因此开窗不能由 Host 直接做，必须由 IDE 自己经**官方 Typert Gateway** 接单（`:6-17`）：

1. IDE 启动后调 `ide.registerIdeClient(clientId)` 报到；
2. 定时调 `ide.pollLaunch(clientId)` 取开窗请求；
3. 取到后在本进程内调注入的 `onLaunch(request)` 打开窗口。

关键实现：
- `DSH_IDE_LAUNCH_POLL_MS = 1500`（`:22`）：开窗是低频事件，1.5s 轮询足够，且比长连接订阅更简单——用长轮询换实现简单，无需额外订阅登记（若将来改流只换此层）。
- `DshIdeLaunchHostCaller.call(namespace, method, args)`（`:25-27`）：IDE 对 Host 的最小调用面，由 `DshIdeTransport` 提供，避免依赖具体实现。
- `DshIdeLaunchRequest { workspace? }`（`:29-32`）：开窗请求体。
- `DshIdeLaunchListener.start()`（`:62-67`）：幂等启动，`schedule(0)` 立即第一次。
- `tick()`（`:98-117`）：未注册先 `registerIdeClient`（成功后 `registered=true`、清错误），再 `pollLaunch` → `dispatch(result)`；失败不改 `registered`（重报到）、记 `lastError`，末尾固定 `schedule(1500)`。
- `dispose()`（`:69-86`）：关窗时立刻 `ide.unregisterIdeClient({clientId})`。不注销会让旧登记项等 15s 心跳超时，期间再点入口 Host 会把请求投给已死回调并返回成功，用户看到「点了没反应，要等很久再点一次」。
- 失败策略（`:37-38`）：报到/轮询失败**不抛出**（静默重试），只影响「按钮能否开窗」，不影响 IDE 其他功能；仅首次失败记原因供排查。

开窗请求最终经 `DshIdeChannel.launch()`（见 5.2）落到主进程开窗入口，并把 `sessionId` 通过 `DSH_IDE_SESSION_ENV` 注入新窗口。

---

## 5. 主进程通道 DshIdeChannel

文件：`src/vs/platform/dshClient/electron-main/dshIdeChannel.ts`，实现 `IServerChannel<string>`。

职责（`:11-14`）：① `call()` 控制命令与 DTO method 唯一分发；② `listen()` 只发布本连接所属视图快照（三层过滤）；③ `disposeOwner()` 窗口断开只清理该连接订阅，**不代用户取消 DSH 会话**。

### 5.1 listen：三层过滤（`:96-123`）

```ts
listen<T>(ctx, event, _arg?): Event<T> {
  if (event !== 'snapshot' && event !== 'waterfall' && event !== 'session-notice')
    return Event.None;                                     // ① 事件名白名单
  if (event === 'session-notice')
    return Event.map(Event.filter(_onDidSessionNotice.event, e => e.ctx === ctx), ...);
  if (event === 'waterfall')
    return Event.map(Event.filter(_onDidWaterfall.event, e => e.ctx === ctx), ...);
  return Event.map(Event.filter(_onDidSnapshot.event, e => e.ctx === ctx), ...); // ② 连接归属
}
```
第 ③ 层（version 严格递增）在发布侧按 ctx 去重（见 5.2）。全部用平台既有 `Event.filter`/`Event.map`，不自造事件适配层。

### 5.2 call：统一分发（`:125-140`）

```ts
async call<T>(ctx, command, arg?): Promise<T> {
  if (command === 'open')   return this.open(ctx, arg);
  if (command === 'close')  { this.disposeOwner(ctx); return { closed: true }; }
  if (command === 'rebind') return this.rebind(ctx, arg);
  if (command === 'launch') return this.launch(arg);
  return this.invoke<T>(ctx, command, arg);
}
```

`open(ctx, arg)`（`:171-212`）：同一 ctx 重复 open 返回 `existing.last`，不产生第二个 channelId；注册三个订阅；`subscribe` 回调做两层判断：
```ts
if (connection === undefined || snapshot.channelId !== connection.channelId) return; // 归属
const sent = _lastSentVersion.get(ctx) ?? -1;
if (snapshot.version <= sent) return;   // 连续性：重复/倒退帧丢弃
_lastSentVersion.set(ctx, snapshot.version);
connection.last = snapshot;
_onDidSnapshot.fire({ ctx, snapshot });
```

`launch(arg)`（`:146-169`）：委派主进程注入的 `DshIdeLauncher`；未注入明确返回 `FEATURE_UNAVAILABLE`，不伪造已开窗。

`invoke()`（`:226-248`）：`assertOpen` → `validateDshIdeInput(method, arg)` → `view.invoke(method, validated)` → `validateDshIdeInvokeOutput({value})` 三段校验，异常收敛为 `DshRemoteError`。

`disposeOwner()`（`:257-268`）：删连接、删 version 记录、dispose 三个订阅，返回清理数。

---

## 6. 渲染进程客户端 DshClientService

文件：`src/vs/platform/dshClient/common/dshClientService.ts`。

### 6.1 接口 IDshClientService（`:59-83`）

| 成员 | 类型 | 说明 |
|---|---|---|
| `onDidChangeState` | `Event<{connected:boolean}>` | 连接态变化 |
| `onDidStreamFrame` | `Event<IDshStreamFrame>` | 流帧 |
| `onDidSnapshot` | `Event<DshIdeSnapshot>` | 唯一快照流，原样转发 |
| `onDidWaterfall` | `Event<DshIdeWaterfallNotice>` | 审批/问卷流 |
| `onDidSessionNotice` | `Event<DshIdeSessionNotice>` | 官方 api-session 状态（不进快照、不附正文） |
| `openView(spec)` | `Promise<DshClientCallResult<DshIdeSnapshot>>` | 控制命令 `open`，返回首帧 |
| `rebindView(sessionId)` | 同上 | 换会话继续跟 |
| `closeView()` | `Promise<void>` | 控制命令 `close`，不取消会话 |
| `getStatus()` / `connect()` | — | `connect()` 为骨架 |
| `call(endpoint,args,signal?)` | `Promise<DshClientCallResult<T>>` | 一元调用 |
| `follow(...)` | 流句柄 | 当前骨架 |

`IDshStreamClient`（`:86-88`）扩展 `openWritableStream()`，支持可写双向流（对齐 `ClientStreamHandle`/`WritableRemoteStream`）。

### 6.2 实现要点（`:97-213`）

构造（`:109-126`）：
```ts
this.channel = mainProcessService.getChannel(DSH_IDE_CHANNEL);  // 'dshIde'
this._register(this.channel.listen<DshIdeSnapshot>('snapshot')(snapshot => {
  this.markConnected();
  this._onDidSnapshot.fire(snapshot);     // 原样转发，不校验
}));
this._register(this.channel.listen('waterfall')(notice => { ... }));
this._register(this.channel.listen('session-notice')(notice => { ... }));
```
**先监听后 open，避免漏帧**（`:112`）。

- `openView()`（`:139-147`）：`channel.call('open', spec)`，成功 `markConnected()`。
- `call()`（`:180-188`）：`channel.call(endpoint, args)` 返回 `{value}`，method 直接作为 command。
- `markConnected()`（`:160-166`）：仅状态真正翻转时发事件，避免轮询刷重复帧。
- `getStatus()`（`:132-137`）：连接态 = 曾经 `open` 成功；**不伪造 endpoint**。
- `connect()`/`follow()`/`openWritableStream()`（`:176-209`）：当前骨架，`follow` 立即回 `FEATURE_UNAVAILABLE` error 帧，**绝不静默**。
- `toRemoteError()`（`:216-226`）：把通道异常收敛为 `DshRemoteError`。

---

## 7. 内容消费与 fail-closed

### 7.1 DshIdeConsumer（dshIdeConsumer.ts）

文件：`src/vs/workbench/contrib/dsh/browser/dshIdeConsumer.ts`。职责（`:6-12`）：直接读 `sessionController.follow` 的帧，不翻译成另一套行；**零 `@deepseek-ai/*`**；`version` 断号/倒退、`channelId`/`wireRevision` 变化一律拒绝且不改变已渲染状态。

状态（`:24-33`）：
```ts
export interface DshIdeConsumerState {
  readonly frame: Readonly<Record<string, unknown>> | undefined;
  readonly version: number;                 // 已接受快照 version，未接受为 -1
  readonly channelId: string | undefined;
  readonly phase: 'starting' | 'ready' | 'rebuild' | 'none';
}
```

`accept(frame)`（`:64-86`）：① `validateDshIdeSnapshot`（结构校验）→ 失败 `fail('dsh-ide/invalid-argument')`；② `assertSnapshotContinuity(pending ?? last, validated)`（连续性）→ version gap → `DSH_IDE_SNAPSHOT_STALE`，其他 → `'dsh-ide/snapshot-continuity'`；③ `schedule(validated)` 进 16ms 合并窗口。

合并（`:109-122`）：`DSH_IDE_MERGE_WINDOW_MS = 16`（`:36`），一帧内多次 accept 合并成一次渲染，`pending` 保存最新帧，定时器到点 `apply()`。

`apply()`（`:124-130`）：更新 `last`；若 `state.state === 'ready'` 且 `view !== undefined`，取 `current = frame.state.view.frame`；fire `onDidChangeFrame`。

`fail()`（`:132-141`）：`failed = true`，此后所有 `accept()` 直接返回 false（`:66-68`），界面保持上一次一致状态。

### 7.2 DshClientContribution（总装）

文件：`src/vs/workbench/contrib/dsh/browser/dsh.contribution.ts:37-98`，`WorkbenchPhase.AfterRestored` 注册。构造时（`:45-88`）：

1. `registerDshLanguageModelProvider(...)` 把 DSH 模型目录注册进原生模型表（`:48`）；
2. 读 `DSH_IDE_COMPOSER` 预置，创建 `DshComposerSource`，`setDshComposerSource(composer)`（`:49-56`）；
3. `registerDshInlineCompletions(languageFeatures, client)`（`:57`）；
4. 创建 `DshIdeConsumer`，`onDidFail` → 通知 `DSH-IDE 帧被拒绝（{0}），界面保持上一次一致状态。`（`:59-66`）；
5. 帧交给进程唯一 `DshChatSession`：
   ```ts
   this._chat = dshChatSessionFor(client);
   consumer.onDidChangeFrame(({ state }) => this._chat.accept(state.frame));
   client.onDidSnapshot(snapshot => consumer.accept(snapshot));
   client.onDidWaterfall(notice => this._chat.acceptWaterfall(notice));
   ```
6. 从 `DSH_IDE_SESSION_ENV` 读开窗注入的 sessionId，`client.openView({view:'chat', params:{sessionId}})`，成功后 `this._chat.attach(boundSessionId)`；失败弹 `DSH-IDE AI 连接层尚未就绪（{0}）…`（`:75-88`）。

> 注意：`:46` 仍留旧注释「聊天画面由 DshChatModelDriver 把 DSH 帧直接写进原生 ChatModel」，与 `dshChatModelDriver.ts:6-7` 的「已停用」矛盾，属遗留注释（按 AGENTS.md 应改文档迁就代码）。

---

## 8. 三类内容流的完整路径

### 8.1 聊天正文帧（snapshot）

```text
DSH Host ide-view-host.js：sessionController.follow 事件
  → DshIdeTransport（WS /api/remote.mux item）
  → DshIdeViewService.receive() 识别为内容帧 → publish({frame: raw})，version+1
       （ide-view-service.ts:217,220-235）
  → DshIdeChannel.view.subscribe() 回调做 channelId 归属 + version 过滤
       → fire _onDidSnapshot（dshIdeChannel.ts:195-209）
  → listen('snapshot') 按 ctx 过滤 → DshClientService._onDidSnapshot
       （dshClientService.ts:114-117）
  → DshClientContribution → DshIdeConsumer.accept()（结构+连续性+16ms 合并）
  → DshChatSession.accept()（dshChatSession.ts:170-174）
  → DshChatModel.accept()（dshChatModel.ts:389-400）
```

### 8.2 waterfall 帧（审批 / 问卷）

```text
Host Bridge _armWaterfalls() 监听 approval/request / user-questions/request
       （ide-view-host.js:308-309）
  → _share() fan-out {type:'waterfall', kind:'request', eventId, event, agentId, request}
       （:336-343）
  → 桌面与 IDE race 决议（:344-368）
  → 同一 ide/followSession 流进入 DshIdeViewService.receive()
  → projectDshIdeWaterfallNotice() 命中（ide-view-service.ts:195-201）
  → view.subscribeWaterfall() → DshIdeChannel fire _onDidWaterfall
       （dshIdeChannel.ts:183-188）
  → listen('waterfall') → DshClientService.onDidWaterfall
  → DshClientContribution → DshChatSession.acceptWaterfall() 登记待决卡片
       （dshChatSession.ts:177-205）
  → 用户决议：call('answerApproval'|'answerQuestion') → ide/dispatch
       → Host pending.settle()（ide-view-host.js:590-608）
  → 如需回投官方事件流：answerWaterfall() → POST /api/$events/result
       （dshIdeTransport.ts:217-226）
```

`DshChatSession.acceptWaterfall()`（`:177-205`）：
- `kind === 'cancel'` → 删除该 eventId 的 pending 项并 fire；
- `event === 'approval/request' && 'toolName' in request` → 标题 `DSH 请求运行 ${toolName}`（有 reason 时附 `:${reason}`），options 为空；
- `event === 'user-questions/request' && 'questions' in request` → 取第一个问题，标题为 `question.question`，options 为 `options[].label`，保存 `questionId`。

### 8.3 会话状态帧（session-notice）

```text
Host ctx.on('api-session/status'|'added'|'removed')（ide-view-host.js:313-326）
  → 同一 follow 流进入 DshIdeViewService.receive()
  → 识别 session-status / session-list（ide-view-service.ts:206-216）
  → view.subscribeSessionNotice() → DshIdeChannel fire _onDidSessionNotice
       （dshIdeChannel.ts:189-194）
  → listen('session-notice') → DshClientService.onDidSessionNotice
  → DshAgentSessionsController（dshAgentSessionsController.ts:90-96）
      · kind:'list' → 50ms 合并刷新列表
      · kind:'status' → applyRunning() 只更新那一行 running
```

### 8.4 上行调用路径（call）

```text
渲染器 call(method,args)（dshClientService.ts:180-188）
  → IChannel.call(method) → DshIdeChannel.call() → invoke()
  → 三段校验（dshIdeChannel.ts:226-248）
  → DshIdeViewService.invoke()（ide-view-service.ts:137-150）
  → transport.call('ide','dispatch',{method,payload})（dshIdeTransport.ts:420-426）
  → Host createMethodHandlers 的官方服务调用
```
**调用只返回 `{value}`，状态变化只走 `listen`**（`dshIdeProtocol.ts:578-596`）。

---

## 9. Chat 视图容器的注册与显示

### 9.1 容器注册

文件：`src/vs/workbench/contrib/chat/browser/chatParticipant.contribution.ts:37-112`。

```ts
const DSH_DISABLE_CHAT_UI = false;  // :42 总开关，true 则整个 Chat UI 不注册

const chatViewIcon: URI = FileAccess.asBrowserUri(
  'vs/workbench/contrib/dsh/browser/media/dsh-whale.svg');  // :46 DSH 鲸鱼图标

const chatViewContainer: ViewContainer = Registry.as<IViewContainersRegistry>(
  ViewExtensions.ViewContainersRegistry).registerViewContainer({
    id: ChatViewContainerId,              // 'workbench.panel.chat'
    title: localize2('chat.viewContainer.label', "Chat"),
    icon: chatViewIcon,                   // DSH 替换点
    ctorDescriptor: new SyncDescriptor(ViewPaneContainer,
      [ChatViewContainerId, { mergeViewWithContainerWhenSingleView: true }]),
    storageId: ChatViewContainerId,
    hideIfEmpty: true,
    order: 1,
  }, ViewContainerLocation.AuxiliaryBar, { isDefault: true, doNotRegisterOpenCommand: true });
```

- 容器 ID：`workbench.panel.chat`（`chat.ts:629`）
- 位置：`ViewContainerLocation.AuxiliaryBar`（右侧辅助栏）
- 用 `ViewPaneContainer` 承载，`mergeViewWithContainerWhenSingleView: true`（单视图时容器标题与视图合并）
- DSH 改动仅两处：图标换 `dsh-whale.svg`，加总开关 `DSH_DISABLE_CHAT_UI`
- 快捷键 `Ctrl/Cmd+Alt+I`（`:70-75`）

### 9.2 容器内的视图

**主 Chat 视图**（`chatParticipant.contribution.ts:58-91`）：
- ID：`ChatViewId = workbench.panel.chat.view.${CHAT_PROVIDER_ID}`（当前 copilot，`chat.ts:628`）
- 标题 "Chat"，`ctorDescriptor: SyncDescriptor(ChatViewPane)`
- `when`：`accountPolicyGateActive.negate()` 且（`Setup.hidden.negate()` 且 `Setup.disabledInWorkspace.negate()`，或 `panelParticipantRegistered`，或 `extensionInvalid`）

**条件视图**（`:93-110`）：`MANAGED_SETTINGS_UPDATE_VIEW_ID` → `ChatUpdateRequiredView`，仅在策略要求更新时显示。

扩展可通过 `chatViewsWelcome` 贡献点注入欢迎内容（`viewsRegistry.registerViewWelcomeContent(ChatViewId, ...)`，`:395-398`）。

**没有独立 DSH 视图**：`dsh.contribution.ts:9-10` 明确写「聊天和 Sessions 都在 VS Code 的 Chat 视图容器里，不再注册左侧自建视图」。

---

## 10. ChatViewPane 内部结构

文件：`src/vs/workbench/contrib/chat/browser/widgetHosts/viewPane/chatViewPane.ts`。

### 10.1 控件创建

`createControls(parent)`（`:410-426`）：
```ts
const sessionsControl = this.createSessionsControl(parent);   // Session 面板
const welcomeController = ... createInstance(ChatViewWelcomeController, parent, this, ChatAgentLocation.Chat);
const chatWidget = this.createChatControl(parent);            // Chat 面板主体
this.registerControlsListeners(sessionsControl, chatWidget, welcomeController);
this.updateSessionsControlVisibility();
```

DOM 层级：
```text
ChatViewPane (ViewPane)
├── .agent-sessions-container                ← Session 面板
│   ├── .agent-sessions-title-container
│   │   ├── span.agent-sessions-title  ("Sessions")
│   │   └── .agent-sessions-toolbar (MenuId.AgentSessionsToolbar)
│   ├── AgentSessionsFilter
│   ├── .agent-sessions-new-button-container → Button "New Session"  ← DSH 改动
│   └── .agent-sessions-control-container → AgentSessionsControl (列表)
├── ChatViewWelcomeController                ← 欢迎页
├── ChatViewTitleControl (:1130-1143)        ← 标题栏
└── ChatWidget                               ← 聊天主体
```

### 10.2 Session 面板（原生 AgentSessionsControl）

`createSessionsControl()`（`:877-940+`）：
- `:878` 创建 `.agent-sessions-container`；
- `:881-887` 标题 "Sessions"，点击滚动到顶并聚焦；
- `:889-902` 工具栏 `MenuId.AgentSessionsToolbar` + `AgentSessionsFilter`；
- `:904-912` New Session 按钮（**DSH 直接改动**）：
  ```ts
  const createNewChat = () => {
    void this.commandService.executeCommand('dsh.newSession').catch(() => {});
    return this.commandService.executeCommand(ACTION_ID_NEW_CHAT, this.getActionsContext());
  };
  ```
- `:915-931` 创建 `AgentSessionsControl`，`source:'chatViewPane'`，带 filter、样式、打开选项。

可见性（`:985-1022`）：受 chat widget 是否为空、欢迎页是否显示、`ChatConfiguration.ChatViewSessionsEnabled`、`hasByokModels` 上下文影响；支持堆叠/侧边方向和 sash 拖拽。

### 10.3 DSH 会话如何注入 Session 面板

文件：`src/vs/workbench/contrib/dsh/browser/dshAgentSessionsController.ts`。

- `:24-28` 定义会话 URI：`dsh:///<encoded-session-id>`；`getChatSessionType()`（`chatUri.ts:96-105`）识别 `dsh` scheme → `chatSessionType === 'dsh'`
- `:46-50` `DshAgentSessionsController implements IChatSessionItemController, IWorkbenchContribution`
- `:75` 注册：`chatSessionsService.registerChatSessionItemController('dsh', this)`
- `:109-161` `refresh()` 调 `client.call('listSessions', {workspace})`，把 `IDshIdeSessionSummary[]` 转成 `IChatSessionItem[]`（`:189-209`）：
  - `label` = 标题（fallback sessionId），`description` = cwd，`status` = running ? `InProgress` : `Completed`，`iconPath` = `Codicon.comment`，`timing` 用 `updatedAt`
  - delta 经 `_onDidChangeChatSessionItems` → 原生 `AgentSessionsModel`（`agentSessionsModel.ts:577-596` 监听）→ `AgentSessionsControl`
- `:90-96` 监听 `onDidSessionNotice`：`kind:'list'` 50ms 合并刷新；`status` 只更新那行 running
- `:97-106` 注册 `sessionOpenerRegistry`：点击时 `dshChatSessionFor(client).bind(sessionId)`；上游 opener 以 `ChatViewPaneTarget` 在主 chat 视图打开（`agentSessionsOpener.ts:273-278`）
- `:220` `registerWorkbenchContribution2(..., WorkbenchPhase.AfterRestored)`

**New Session 命令**：`dsh.newSession` 在 `chatServiceImpl.ts:407-413` 注册，当前实现只是 `workbench.action.chat.open`；仓库有 `DshIdeSessionsService.createSession()`（`dshIdeSessionsService.ts:98-110`）但 UI 未接到它——这是当前实现与设计注释的差距。

### 10.4 会话列表状态机与服务（未接 UI 的独立供给链）

除 10.3 的 `DshAgentSessionsController`（直接把 `listSessions` 转成原生 `IChatSessionItem`）外，仓库还有一套**完整的、但当前未接到 ChatViewPane UI** 的会话列表状态机/服务链，需单列以免遗漏：

**`DshIdeSessionListModel`（`dshIdeSessionListModel.ts:46-...`）**：renderer 侧会话列表状态机。
- 两态：`phase: 'unbound' | 'normal'`（`:20-21`）；绑定了即 normal（名单可为空），否则 unbound。`lastError` 只是刷新失败提示，不构成第三态（`:23-30`）。
- 只依赖两个 Host 调用：`IDshIdeSessionListSource.list()` / `remove(sessionId)`（`:32-36`），便于离线单测、不绑死通道实现。
- fail-closed（`:12-14`）：未绑定时既不取数也不允许 delete；迟到响应按 `generation` 作废（`:53-57`，`bind`/`refresh` 都递增 `_generation`，`:89,106`），绝不让旧绑定列表回写新绑定；删除成功只重查，不设「已删除/未知」两态，刷新失败保留旧列表并报告原因。
- `refresh()`（`:98-...`）是唯一取数入口：未绑定直接 `Promise.resolve()`（零请求，`:99-102`）；`_inFlight` 合并同一时刻重复触发（`:103-105`）。手动刷新、窗口聚焦、删除成功都汇到这里，**不定时轮询**。
- `bind()`（`:84-95`）：绑定变化时递增 generation、清在途、清空 items/error 并 fire。

**`DshIdeSessionsService`（`dshIdeSessionsService.ts:56-...`）**：`IDshIdeSessionsService`（`:35-54`）的 renderer 唯一会话列表供给方。
- 构造（`:61-79`）：用 `DshClientSessionListSource(this._client)` 建 `DshIdeSessionListModel`，绑定值取 `env[DSH_IDE_SESSION_ENV]`；订阅 `hostService.onDidChangeFocus`，**聚焦时才 refresh**（`:72-76`），首次构造也 refresh 一次（`:78`）；未绑定保持空状态。
- `createSession()`（`:99-110`）：调 `client.call('newSession', {})`，成功后 `bind(sessionId)` 再 `refresh()`——这是 New Session 按钮**应该调用但当前未接**的实现。
- `deleteSession` / `archiveSession` / `unarchiveSession`（`:94-128`）：调对应 `client.call`，成功后统一 `refresh()`。
- `search(query)`（`:130-139`）：空 query 直接返回空列表；否则 `client.call('searchSessions', {query})`，原样透传失败。
- `bind(sessionId)`（见状态机）：开窗参数变化时切换绑定，作废在途旧读。

这套链与 10.3 并存的结论：**Session 面板当前显示走的是 `DshAgentSessionsController → IChatSessionsService → AgentSessionsControl`；`DshIdeSessionsService + DshIdeSessionListModel` 是另一条已实现、尚未被 UI 消费的会话供给链**。

---

## 11. ChatWidget 组件树与控件清单

### 11.1 原生 ChatWidget 结构

`ChatWidget` 由 `chatViewPane.createChatControl()` 创建，组合以下原生子组件（均在 `src/vs/workbench/contrib/chat/browser/`）：

```text
ChatWidget
├── ChatInputPart（widget/input/chatInputPart.ts）
│   ├── 输入编辑器（Monaco）
│   ├── 发送按钮 ChatSubmitAction
│   ├── 模型选择器 ModelPickerActionItem / OpenModelPickerAction
│   ├── 模式/权限选择器 ModePickerActionItem / PermissionPickerActionItem
│   ├── 附件 ChatAttachmentModel / ChatDynamicVariableModel
│   ├── 语音/听写 DictationActionViewItem / VoiceModeActionViewItem
│   └── 会话目标选择器 SessionTargetPickerActionItem
├── ChatListWidget（chatListWidget.ts:597-636 建 WorkbenchObjectTree）
│   └── ChatListItemRenderer（:556-564）
│       └── div.interactive-item-container
│           ├── MarkdownPart
│           ├── CodeBlockPart
│           ├── ToolInvocationPart
│           ├── ThinkingPart
│           ├── TodoList
│           ├── Attachments
│           └── feedback / actions
├── ChatViewWelcomeController
├── ChatViewTitleControl
└── 查找、chat pet 等辅助组件
```

### 11.2 当前实际渲染链路（原生）

```text
IChatService / ChatModel
  → ChatViewModel.getItems()
  → ChatWidget.onDidChangeItems()
  → ChatListWidget.setModel / WorkbenchObjectTree
  → ChatListItemRenderer.renderElement()
  → div.interactive-item-container（MarkdownPart / CodeBlockPart / ...）
```
关键代码：列表 widget 创建 `chatWidget.ts:2321-2351`，tree 创建 `chatListWidget.ts:597-636`，renderer 创建 `chatListWidget.ts:556-564`。**当前列表渲染不消费 `DshChatNode`**，而是消费原生 `IChatViewModel`。

### 11.3 用户输入发送链路（原生）

用户按 Enter / 点发送：
```text
ChatInputPart 输入编辑器
  → ChatWidget.acceptInput()（chatWidget.ts:3415-3479）
  → ChatWidget._acceptInput()
  → ChatRequestParser.parseChatRequest()
  → IChatService.sendRequest()（chatWidget.ts:3901-3920）
  → ChatModel / ChatViewModel
  → ChatListWidget 重新渲染
```
发送后清空输入框：`chatWidget.ts:3945` → `ChatInputPart.acceptInput()`（`chatInputPart.ts:2565-2607`）。
模型信息通过 `getSelectedModelRequestOptions()`（`chatWidget.ts:4168-4179`）进入请求；DSH 模型能出现在选择器里是因为 `DshLanguageModelProvider` 注册进了 `ILanguageModelsService`。

**`DshChatSession.submit()` 未接 UI**：`dshChatSession.ts:264-275` 实现了 `client.call('submit', {text})`，但全仓无 UI 调用方；用户点发送实际走原生 `IChatService.sendRequest()`。

### 11.4 DSH 消息渲染：设计数据层 vs 当前实现

`dshChatModel.ts` 定义了完整 DSH 节点类型：
- `DshUserMessageNode`（`:100-105`）、`DshSteeringMessageNode`（`:108-113`）、`DshContextMessageNode`（`:116-123`）、`DshAssistantMessageNode`（`:126-136`）、`DshToolResultNode`（`:139-154`）、`DshRunningToolCall`（`:157-168`）
- command / compaction / retry / turn-error / max-tokens / unknown / inherited-history / subagent 节点（`:174-266`）
- 节点全集 `DshChatNode`（`:269-283`）：
  ```ts
  export type DshChatNode =
    | DshUserMessageNode | DshSteeringMessageNode | DshContextMessageNode
    | DshAssistantMessageNode | DshToolCallBlock | DshCommandNode
    | DshCompactionNode | DshModelRetryNode | DshTurnErrorNode
    | DshTurnMaxTokensNode | DshUnknownSurfaceNode | DshInheritedHistoryNode
    | DshSubagentCatalogNode | DshSubagentNoticeNode;
  ```
- 设计原则「不翻译、不转换、不投影」（文件头 `:6-18`）

`dshChatModelDriver.ts:6-7` 明确停用：
```ts
// 聊天面板已恢复为 VS Code 原生实现。这里不再把 DSH 节点写进 ChatModel，
// 也不再注册 workbench contribution。后续要一点一点接，从原生面板往上加。
```
因此 **DSH 节点模型没有直接对应到 DOM part**；要恢复需在 `ChatListWidget`/`ChatListItemRenderer` 或新 provider 层增加 `DshChatNode → IChatViewModel` 桥接。

### 11.5 DSH composer / 模型 / 权限控件设计

- `dshComposerSource.ts:184-274`：`refresh()` 调 `client.call('composerState', {})`；写回方法 `selectModel`→`setModel`、`selectEffort`→`setEffort`、`selectPreset`→`setAgentPreset`、`selectPermission`→`setPermissionPreset`、`setTeam`→`setTeamEnabled`
- `dshComposerProjection.ts:30-62`：
  ```ts
  export const DSH_MODEL_VENDOR = 'dsh';
  export const DSH_EFFORT_PROPERTY = 'reasoningEffort';
  export function toLanguageModel(model: DshComposerModel): ILanguageModelChatMetadataAndIdentifier { ... }
  ```
  把推理档通过原生模型配置 schema 表达（title "推理等级"，enum 来自 efforts）
- `dshLanguageModelProvider.ts:131-170`：注册 DSH 模型供应商到 `ILanguageModelsService`；`sendChatRequest()` 故意抛错（`:120-123`「DSH 模型不通过 IDE 侧发起请求」）——只让模型出现在选择器，回答由 DSH 回显帧驱动
- `DshModelMenu`（`dshModelMenu.ts:49-301`）：两级菜单（模型/推理等级/团队开关），挂在 `.monaco-workbench` 内以解析主题变量（`:60-63`），**当前无 `new DshModelMenu()` 调用点**

### 11.6 语音输入 / 历史分页（均未接线）

- `dshSpeech.ts:24-75` + `dshChatSpeechToTextService.ts:25-284`：完整 DSH 语音实现（`currentBackend='dsh'`、调 `speech/catalog`、录音采样、转写）；但 `chat.shared.contribution.ts:3341` 注册的是原生 `ChatSpeechToTextService`
- `dshHistoryPager.ts:16-88`：`attachDshHistoryPager()` 顶部滚动加载（`scrollTop<=24` 触发、用 `data-dsh-node-id` 锚点保持视口、调 `session.loadOlder()`），**无调用方**

---

## 12. DSH 已接线 vs 未接线组件

### 12.1 已接线、当前生效

| 组件 | 位置 | 作用 |
|---|---|---|
| Chat 容器 + 鲸鱼图标 + 总开关 | `chatParticipant.contribution.ts:39-112` | 右侧 Chat 容器显示 |
| `IDshClientService` 单例 | `dsh.contribution.ts:32` | 唯一 `dshIde` 通道访问器 |
| `DshClientContribution` | `dsh.contribution.ts:37-98` | 启动 `openView('chat')`，分发帧 |
| `DshIdeConsumer` | `dshIdeConsumer.ts` | 帧校验/合并/fail-closed |
| `DshChatSession` | `dshChatSession.ts` | 进程唯一聊天状态（节点、模型、pending、running） |
| `DshAgentSessionsController` | `dshAgentSessionsController.ts` | Sessions 面板行数据 + 点击打开 |
| `DshLanguageModelProvider` | `dshLanguageModelProvider.ts:131-170` | DSH 模型目录进原生选择器 |
| `DshIdeLaunchListener` | `dshIdeLaunchListener.ts:40-117` | IDE 侧开窗接单（报到 + 1.5s 轮询） |
| 契约门禁 | `dshIdeContract.ts:16-88` | 版本 drift 警告、patch 点 sha256 断言 |
| `DshComposerSource` | `dshComposerSource.ts` | composerState 数据源 |
| `registerDshInlineCompletions` | `inlineCompletion.ts` | 行内补全（未就绪优雅降级） |
| New Session 按钮 | `chatViewPane.ts:904-912` | 调 `dsh.newSession` |
| 隐藏原生 Copilot/agent-host 控件 | `chatExecuteActions.ts:377-399,503-529`；`sessionTargetPickerActionItem.ts:384-388` | 去掉不相关入口 |
| 文案中性化 | `chatWidget.ts:1663-1665,1801-1802`；`chatViewTitleControl.ts:154-157` | 去掉 Copilot/harness 字样 |

### 12.2 已实现但当前未接线

- `DshChatModel` 节点 → `ChatListItemRenderer` 的映射（driver 停用）
- `DshChatSession.submit()` 的 UI 调用（发送仍走原生）
- `DshModelMenu`（无调用点）
- `DshComposerSource` 在输入框侧的消费
- `toChatMode` / `toPermissionItems` / `observeModes`
- `DshHistoryPager`（`attachDshHistoryPager()` 无调用方）
- `DshChatSpeechToTextService`（未注册为 `IChatSpeechToTextService`）
- `DshIdeSessionsService` + `DshIdeSessionListModel` + `DshClientSessionListSource`（完整会话列表链，未被 ChatViewPane 消费；`createSession()` 未被 New Session 按钮调用）
- 协议已声明但 UI 未调的 method：`resume`/`fork`/`rewind`/`loadOlder`/`cancelRequest`/`runCommand`/`presentationSettings`/`deleteSession`/`archiveSession`/`unarchiveSession`/`searchSessions`/`fetchRowDetail`/`readAttachment`/`refreshSnapshot`/`accountGetState`/`accountGetProfile`（见 3.4）

要让 DSH 正文真正显示，核心落点：
1. 在 `ChatWidget` 或新 host 中订阅 `DshChatSession.onDidChangeNodes`；
2. 把 `DshChatNode[]` 投影成原生 request/response VM 或新增 renderer；
3. 把 `ChatWidget.acceptInput()` 发送目标切到 `DshChatSession.submit()`；
4. 在 `ChatInputPart` 消费 `getDshComposerSource()` 或接 `DshModelMenu`；
5. 将 `DshChatSpeechToTextService` 注册为 `IChatSpeechToTextService`；
6. 调用 `attachDshHistoryPager()` 并绑定根节点。

---

## 13. 端到端时序

```text
1. DSH 主窗口点“在 IDE 中打开” → DshIdeLaunchListener 经官方
   ide/registerIdeClient + ide/pollLaunch 接单 → 主进程 launch 开窗，
   DSH_IDE_SESSION 注入新窗口
2. DshClientContribution (AfterRestored) 启动：
   - 注册模型 provider、composer source、inline completions
   - client.openView({view:'chat', params:{sessionId}}) → channel.call('open')
     → DshIdeChannel.open() → DshIdeViewService.open()
     → LazyDshIdeTransportBackend.follow() 连 Host → 返回首帧 starting snapshot
3. 首帧 → DshClientService._onDidSnapshot → DshIdeConsumer.accept
   → DshChatSession.accept → DshChatModel
4. DshAgentSessionsController 在 onDidChangeState(connected) 后 call('listSessions')
   → IChatSessionsService delta → AgentSessionsControl 显示会话行
5. 后续 follow 帧 → 第 3 步路径更新 DshChatSession
   （当前不写回原生 ChatModel，正文不在列表显示 —— 未接通）
6. 用户在输入框输入并发送 → ChatWidget.acceptInput()
   → IChatService.sendRequest()（模型来自 DshLanguageModelProvider）
7. DSH 产生回答 → waterfall/snapshot 帧回传 → 第 5 步
8. 断线 → DshIdeViewService.publishDisconnected() 发 rebuild 快照
   → 后台退避重连（250ms~5s），端点变了重读端点文件 → 下帧真实内容接管
```

---

## 14. 关键结论与风险点

1. **接收管线完整、fail-closed**：Host → transport → channel（三层过滤）→ client service → consumer（校验+16ms 合并）→ DshChatSession，设计严整，错误不伪造、断网如实提示。
2. **UI 是原生 ChatViewPane + 注入式集成**：容器/面板/列表都是上游代码，DSH 通过 `IDshClientService`、`IChatSessionsService`、`ILanguageModelsService` 和 contribution 嵌入。
3. **Session 面板显示正常**：`DshAgentSessionsController` 把 `listSessions` 转成 `dsh` scheme items，原生 `AgentSessionsControl` 渲染，点击 rebind。
4. **Chat 消息正文当前不显示**：driver 停用，`DshChatNode → IChatViewModel` 桥接不存在；节点/pending/token/历史/submit/语音都有实现但未接 UI。
5. **文档与代码矛盾**：`dsh.contribution.ts:46` 旧注释称 driver 写入 ChatModel，与 `dshChatModelDriver.ts:6-7` 矛盾；按 AGENTS.md 应改文档迁就代码。
6. **New Session 名不副实**：`dsh.newSession` 只执行 `workbench.action.chat.open`，没调 `DshIdeSessionsService.createSession()`。

---

## 附录：关键文件索引

| 类别 | 文件 |
|---|---|
| 契约真源 | `src/vs/platform/dshClient/common/dshIdeProtocol.ts` |
| 契约门禁 | `src/vs/platform/dshClient/common/dshIdeContract.ts` |
| 客户端服务 | `src/vs/platform/dshClient/common/dshClientService.ts` |
| 传输适配 | `src/vs/platform/dshClient/transport/dshIdeTransport.ts` |
| 开窗监听 | `src/vs/platform/dshClient/transport/dshIdeLaunchListener.ts` |
| 后端装配 | `src/vs/platform/dshClient/electron-main/dshIdeBackendFactory.ts` |
| 帧分流 | `src/vs/platform/dshClient/electron-main/ide-view-service.ts` |
| 唯一通道 | `src/vs/platform/dshClient/electron-main/dshIdeChannel.ts` |
| 总装贡献 | `src/vs/workbench/contrib/dsh/browser/dsh.contribution.ts` |
| 帧消费 | `src/vs/workbench/contrib/dsh/browser/dshIdeConsumer.ts` |
| 聊天状态 | `src/vs/workbench/contrib/dsh/browser/dshChatSession.ts` |
| 节点模型 | `src/vs/workbench/contrib/dsh/browser/dshChatModel.ts` |
| 会话控制器 | `src/vs/workbench/contrib/dsh/browser/dshAgentSessionsController.ts` |
| 会话列表状态机 | `src/vs/workbench/contrib/dsh/browser/dshIdeSessionListModel.ts` / `dshIdeSessionListSource.ts` |
| 会话列表服务 | `src/vs/workbench/contrib/dsh/browser/dshIdeSessionsService.ts` |
| 模型目录 | `src/vs/workbench/contrib/dsh/browser/dshLanguageModelProvider.ts` |
| 作曲器 | `src/vs/workbench/contrib/dsh/browser/dshComposerSource.ts` / `dshComposerProjection.ts` / `dshComposerRegistry.ts` |
| 停用的 driver | `src/vs/workbench/contrib/dsh/browser/dshChatModelDriver.ts` |
| 容器注册 | `src/vs/workbench/contrib/chat/browser/chatParticipant.contribution.ts` |
| 视图 ID | `src/vs/workbench/contrib/chat/browser/chat.ts:628-629` |
| 面板主体 | `src/vs/workbench/contrib/chat/browser/widgetHosts/viewPane/chatViewPane.ts` |
| 聊天控件 | `src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts` / `widget/input/chatInputPart.ts` / `chatListWidget.ts` |
| 语音服务 | `src/vs/workbench/contrib/dsh/browser/dshChatSpeechToTextService.ts` / `dshSpeech.ts` |
| 历史分页 | `src/vs/workbench/contrib/dsh/browser/dshHistoryPager.ts` |
| 模型菜单 | `src/vs/workbench/contrib/dsh/browser/dshModelMenu.ts` |


---

## 原文件：`docs/DSH聊天页面全量构成与插件显示机制.md`

# DSH 聊天页面全量构成与插件显示机制（源码级彻底清点）

> 历史源码清点存档：不再作为现行开发规范。现行真源是 `AGENTS.md`、`docs/DSH-IDE内容原子化契约.md`、`docs/DSH-IDE内容原子化差异表.md`、`docs/PROJECT_AUDIT.md` 与 `src/vs/platform/dshClient/protocol/dshIdeProtocol.ts`。
>
> 重要：本文件描述 DSH Web 端运行时与插件显示机制，不等于 DSH-IDE 内运行 React slot 或 Web renderer。DSH-IDE 现行做法是语义对齐 + VS Code 原生 Chat 单扩展点。
>
> 文档性质：对当时只读参考目录 `E:/deepseek-harness/` 的源码级静态清点结果，路径与行号可能已漂移。
> 生成日期：2026-11-16
> 分析范围：
> 1. 聊天页面的**所有图标、组件、卡片、文本内容与渲染管线**，逐项清点，不遗漏。
> 2. **DSH 侧插件（Cordis bundle）的图标与内容如何注册并最终显示在聊天页面里**的完整机制。
>
> 说明：本文基于源码静态分析，全部结论均有绝对路径佐证；未运行 GUI、未模拟 DSH 会话，所有需真机验证的行为不在本文结论范围内。本文为分析文档，不构成任何新的开发路线、可选阶段或回退路径。

---

## 目录

- **第一篇 聊天页面全量构成**
  - 第 1 章 页面主链路与架构
  - 第 2 章 图标清单（全部）
  - 第 3 章 组件清单（按区域）
  - 第 4 章 卡片清单（全部类型）
  - 第 5 章 文本内容 / i18n 清单
  - 第 6 章 样式与消息渲染管线
- **第二篇 插件图标与内容的显示机制**
  - 第 7 章 插件加载是前提
  - 第 8 章 图标显示机制：artwork → sprite → use
  - 第 9 章 插件如何提供图标
  - 第 10 章 不走 sprite 的私有图标体系
  - 第 11 章 内容注入：Slot 系统
  - 第 12 章 i18n 文本注入
  - 第 13 章 样式注入
  - 第 14 章 关键路径速查表
- **附录**：路径前缀表 / E2E 测试佐证 / 常见误解澄清

---

# 第一篇 聊天页面全量构成

## 第 1 章 页面主链路与架构

### 1.1 完整组件树链路

聊天页面不是一个独立的「页面文件」，而是由一堆 Cordis 插件（client 包）在运行时通过 slot 拼装出来的。从浏览器入口到消息渲染的完整链路如下：

```
apps/web/src/main.ts（浏览器入口）
  → AppWebEntry.run()                      [packages/client/web/src/boot.ts]
  → UiRenderer.mount()                     [packages/client/ui-renderer/src/client/renderer.ts]
  → renderSlot('root')                     [packages/client/ui-renderer/src/client/app.tsx]
  → AppFrame（三列：sidebar / center / rightbar）
      [packages/client/ui-layout/src/client/AppFrame.tsx]
      → main slot → ConversationPanel → ConversationRoot → ConversationMainPanel
          → ConversationContent
          → conversation.view = ChatView
              → conversation.chat.flow = ChatFlow
                  → ChatNodeSeat / ChatGroupSeat（按 NodeKey 派发所有消息与卡片）
      → 输入区 InputBar（conversation.composer.bar）+ 各 conversation.input.* slot
      → 侧栏 SidebarRoot + WorkspaceBrowser
      → shell.overlay 浮层（QuotaNotice / Modal / Toast / Menu）
```

### 1.2 Slot 分区契约

slot 声明位于 `E:/deepseek-harness/packages/client/ui-layout/src/client/index.ts`：

| Slot 分区 | 作用 |
|---|---|
| `sidebar` | 左侧栏 |
| `main` | 主区（会话） |
| `rightbar` | 右侧栏（评审 / 详情） |
| `shell.bottom` | 底栏 |
| `shell.overlay` | 浮层 |
| `shell.leading` | 顶栏 leading |

聊天能力全部通过 `conversation.*`、`conversation.chat.*`、`conversation.input.*`、`tool.call.*` 这些 keyed slot 挂入（详见第二篇第 11 章）。

### 1.3 应用入口与挂载链路明细

| 组件 / 文件 | 作用 | 绝对路径 |
|---|---|---|
| `main.ts`（浏览器入口） | Web 客户端入口，创建 `AppWebEntry(el)` 并 `run()`，处理桌面 boot 注入 | `E:/deepseek-harness/apps/web/src/main.ts` |
| `AppWebEntry` | Web boot kernel：加载模块系统、激活插件树、审计后把挂载点交给 UI renderer | `E:/deepseek-harness/packages/client/web/src/boot.ts` |
| `mountClient` / `bootClient` | 客户端插件激活与 renderer 挂载 | `E:/deepseek-harness/packages/client/web/src/mount.ts`、`E:/deepseek-harness/packages/client/web/src/boot-client.ts` |
| `BootPage` | 框架无关的启动加载页（失败可见） | `E:/deepseek-harness/packages/client/web/src/boot-page.ts` |
| `buildRenderApp` | 真正 UI 树：`ctx.slots.renderSlot('root', {})`，整棵树挂在内置 `root` slot | `E:/deepseek-harness/packages/client/ui-renderer/src/client/app.tsx` |
| `UiRenderer` / `mountApp` / `BootHandoff` | React root 创建 / hydrate、文档样式拥有、启动 DOM 交接 | `E:/deepseek-harness/packages/client/ui-renderer/src/client/renderer.ts` |
| `SlotRegistry` / `createSlotRenderer` / `scoped-slots` | slot 注册中心与 React 渲染适配器（`renderSlot`/`renderSlotChain`/`renderFactorySlot`） | `E:/deepseek-harness/packages/client/ui-renderer/src/client/registry.ts`、`E:/deepseek-harness/packages/client/ui-renderer/src/client/scoped-slots.tsx` |
| `web-app`（服务端 bundle 插件） | 浏览器曲面 glue：解析前端 dist、frontend-static fallback、URL 行、默认浏览器打开、`webApp` 服务 | `E:/deepseek-harness/packages/bundle/web-app/src/index.ts`（patch：`E:/deepseek-harness/packages/bundle/web-app/cordis.patch.yml`、`E:/deepseek-harness/packages/bundle/web-app/presets/standard.patch.yml`） |

---

## 第 2 章 图标清单（全部）

### 2.1 图标体系总论

- 聊天页图标 **100% 使用自建 `Icon*Regular` / `Icon*Medium` 组件**，数据定义在 `ui-primitives/src/icons/artwork.ts`，组件在 `icons/index.tsx`，由 `ui-theme/src/client/icon-sprite.ts` 注入 SVG sprite（symbol id 形如 `dsw-icon-xxx-regular`）。
- **零图标字体**（无 iconfont / material icons / font-awesome）。
- 发送 / 停止 / spinner / 语音波形等少数为组件内联 `<svg>`。
- 品牌图形（鲸鱼）为独立体系（canvas / favicon / PWA 图标源）。

### 2.2 顶栏 / 标题栏图标

| 图标 symbol | 语义 | 引用位置 |
|---|---|---|
| `panel-left-outline` | 侧栏切换 | `E:/deepseek-harness/packages/client/ui-sidebar/src/client/HeaderLeadingControls.tsx` |
| `new-chat-outline` | 新建会话 | `E:/deepseek-harness/packages/client/ui-sidebar/src/client/SidebarRoot.tsx` |
| `ellipsis-outline` | 更多 | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx` |
| `settings-outline` | 设置 | `SidebarRoot.tsx` |
| `user-outline` | 用户 / 登录 | `AccountMenu` |
| `paper-plane-outline` | 联系我们 | 账户菜单 |
| `close-outline` | 关闭 | 弹层 |

> 分享图标 `share-outline` 已定义但未在聊天页顶栏发现引用。最小化 / 最大化 / 关闭窗口无 sprite 图标，由原生标题栏控件承载。

### 2.3 侧边栏图标

`search-outline`（搜索）、`close-fill`（清空搜索）、`filter/sort`、`folder-open` / `folder-close`、`triangle-right-fill`（展开）、`pin-fill`（置顶）、`archive-outline` / `unarchive-outline`、`ellipsis-outline`（会话菜单）、`branch-outline`（分支）、`apps-add-outline`（应用入口）。

> 会话项图标主要是 `folder-open/folder-close`、`triangle-right-fill`、`new-chat-outline`、`pin-fill`、`archive-outline/unarchive-outline`、`ellipsis-outline`。`dsw-icon-search-outline-regular` 由 e2e 测试 `icon-skin.e2e.ts:10` 直接佐证。

### 2.4 输入区图标

| 图标 | 语义 | 引用 |
|---|---|---|
| `plus-outline-medium` | 命令 `+` 按钮 | `InputBar.tsx`（命令面板触发器，带 tooltip、aria-haspopup） |
| `paperclip-outline-regular` | 附件 / 回形针 | 附件按钮 |
| `warning-outline` / `refresh-outline` / `close-fill` | 附件失败 / 重试 / 删除 | 附件卡 |
| `data-outline-regular` + `chevron-down/right` + `check` | 模型选择器 | `ModelSelect` |
| 内联 SVG | 发送箭头、停止方块、发送中 spinner、语音波形 | 主输入按钮（`InputBar.tsx`）、`VoiceInput.tsx` |

> sprite 中 `stop-fill` / `send-outline` / `paper-plane-outline` 存在但未直接用于主发送按钮；麦克风图标存在但未挂载（语音为实验包）。

### 2.5 消息操作栏图标

- 复制 / 已复制：`copy-outline` / `check-outline`
- 点赞 / 点踩（含填充态）：`like-outline` / `like-fill`、`dislike-outline` / `dislike-fill`
- 分支：`branch-outline`
- 编辑 / 删除 / 更多 / 重试 / 分享 / 朗读：未发现助手消息操作栏直接引用。分享图标已定义但未使用；未发现朗读 / TTS 图标。

### 2.6 思考 / 工具 / 文件 / 图片 / 链接图标

| 语义 | 图标 | 引用 |
|---|---|---|
| 思考 | `IconThinkOutlineRegular` | `CHAT/chat/ReasoningRow.tsx:3,10`、`CHAT/chat/ChatGroupSeat.tsx:7,39` |
| 工具（通用） | `IconSparkleRegular` | `CHAT/chat/ChatGroupSeat.tsx:6,52` |
| 命令 / API | `IconApiOutlineRegular` | `CHAT/chat/GenericCommandCard.tsx:3,9` |
| 检查 | `IconInspectOutlineRegular` | `ui-tool/.../ToolRow.tsx:4,449` |
| 读文件 | `IconBrowseOutlineRegular` | `ChatGroupSeat.tsx:4-5,40-44` |
| 写文件 | `IconEditOutlineRegular` | 同上 |
| 类型徽标 | `FileTypeIcon` | `ui-attachment/.../FileCard.tsx:1,69` |
| 文件引用 | `ReferenceIconRegular` | 引用渲染 |
| 图片 | `LinkIcon` 的 `PhotoGlyph`（内联）、`IconRefreshOutlineRegular` / `IconLoadingOutlineRegular` | `ui-primitives/.../LinkIcon.tsx:54-60`、`ui-attachment/.../MessageImage.tsx:4,129,149` |
| 链接 | `LinkIconRegular/Medium` + `SiteGlyph`（simple-icons 站点 logo） | `ui-primitives/.../LinkIcon.tsx:1-60`、`SiteGlyph.tsx:1-40` |

### 2.7 通用小图标

`chevron-down/up/left/right`、`triangle-right-fill`、`chevrons-up-down`、`close-outline/fill/circle-fill`、`check-outline/check-circle-*`、`warning-outline/warning-triangle-outline`、`info-outline`、`loading-outline`、`refresh-outline`、`download/upload`、`fullscreen`、`play/pause`、`stop-fill`。

### 2.8 artwork.ts 已定义的部分 symbol id（原文节选）

以下为 `E:/deepseek-harness/packages/client/ui-primitives/src/icons/artwork.ts` 中实际定义的图标数据（每条为一个 glyph，含 size 与随 strokeWidth 变化的 SVG）：

| glyph id | size | 说明 |
|---|---|---|
| `mail-unread-outline` | 16 | 未读邮件 |
| `mail-read-outline` | 16 | 已读邮件 |
| `layers-outline` | 16 | 层 |
| `save-outline` | 16 | 保存 |
| `new-chat-outline` | 16 | 新建会话 |
| `search-outline` | 16 | 搜索 |
| `eye-outline` / `eye-off-outline` | 16 | 显示 / 隐藏 |
| `globe-outline` | 14 | 地球 |
| `settings-outline` | 16 | 设置 |
| `panel-left-outline` | 16 | 左侧栏 |
| `ellipsis-outline` | 16 | 省略号 |
| `plus-outline` | 16 | 加号 |
| `check-outline` | 16 | 勾选 |
| `branch-outline` | 16 | 分支 |
| `chevron-down/left/right/up-outline` | 14 | 方向箭头 |
| `triangle-right-fill` | 14 | 实心三角 |
| `close-outline` / `close-fill` / `close-circle-fill` | 16 / 14 / 16 | 关闭 |
| `copy-outline` | 16 | 复制 |
| `refresh-outline` | 16 | 刷新 |
| `like-outline` / `like-fill` | 16 | 点赞 |
| `dislike-outline` / `dislike-fill` | 16 | 点踩 |
| `share-outline` | 16 | 分享 |
| `deliver-doc` | 16 | 交付文档 |
| `edit-outline` | 16 | 编辑 |
| `think-outline` | 16 | 思考 |
| `agent-preset-outline` | 16 | 智能体预设 |
| `browse-outline` | 16 | 浏览 |
| `context-injection-outline` | 16 | 上下文注入 |
| `link-outline` | 16 | 链接 |
| `right-up-outline` | 16 | 右上外链 |
| `paperclip-outline` | — | 回形针（已定义，聊天页附件使用） |
| `apps-add-outline` / `apps-add-compact-outline` | — | 应用入口 / 紧凑版 |

### 2.9 品牌图形

| 图形 | 说明 | 来源 |
|---|---|---|
| `FishLogo` | 鱼形 logo | `ui-brand-official` |
| `BrandWordmark` | 品牌字标 | `ui-brand-official` |
| `PixelWhale` canvas | 首页鲸鱼动画（`[data-home-whale]`，由 `apps/web/tests/home-whale.e2e.ts:27,40` 佐证） | `E:/deepseek-harness/packages/client/ui-brand-official/src/client/home-whale/PixelWhale.tsx` |
| favicon | 鲸鱼 favicon / favicon-dark | `apps/web/public/favicon.svg`、`favicon-dark.svg`（构建产物即 `dsh-web-frontend/dist/favicon.svg`） |
| PWA 图标源 | 鲸鱼 tile | `apps/desktop/resources/icon.svg` |
| 欢迎页图形 | `welcome-brand.svg` | 欢迎页 |

---

## 第 3 章 组件清单（按区域）

### 3.1 页面骨架与布局

| 组件 | 作用 | 绝对路径 |
|---|---|---|
| `AppFrame` | 三列骨架（sidebar / center / rightbar）+ 拖拽手柄 + 列宽求解 + 子 slot 渲染；注册到 `root` | `E:/deepseek-harness/packages/client/ui-layout/src/client/AppFrame.tsx` |
| `CenterColumn` / `MainPanel` / `RightbarColumn` / `DragHandle` | 中列容器、主面板（`main` keyed slot）、右列轨道、列宽拖拽 | 同上 |
| `columns.ts` / `createLayoutStore` / `LayoutController` / `ThemePresenter` | 列宽计算、布局 store、`ctx.layout` 服务、主题投影 | `E:/deepseek-harness/packages/client/ui-layout/src/client/columns.ts`、`stores.ts`、`service.ts`、`theme-presenter.ts` |
| 布局 slot 声明 | `sidebar` / `main` / `rightbar` / `shell.bottom` / `shell.overlay` / `shell.leading` | `E:/deepseek-harness/packages/client/ui-layout/src/client/index.ts` |
| `DocumentTitle` | 文档标题 | `E:/deepseek-harness/packages/client/ui-layout/src/client/DocumentTitle.tsx` |
| `ConversationPanel` | `main.conversation` 的薄壳（root-scoped 主占用者） | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationPanel.tsx` |
| `ConversationRoot` | 常驻会话骨架根：hero chrome、composer 定位、header、content chain 跨会话不卸载 | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx` |
| `ConversationMainPanel` | 主会话帧：`conversation.header` + `conversation.content` factory，计算 `hero/settling/active` 相位 | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationMainPanel.tsx` |
| `ConversationHeader` | 顶栏 / 标题栏：leading slot + 会话标题 / 视图 tabs（`data-window-drag`） | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationHeader.tsx` |
| `ConversationSessionHeader` | 会话标题、视图 tab 行、面包屑（子会话祖先链）、More 菜单、tooltip | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx` |
| `ViewsMoreMenu` / `ViewTabLabel` | tab 行 More 下拉、超长标签 tooltip | 同上 |
| `ConversationContent` | 会话主体：hero/active 两态、滚动体 `data-conversation-scroll`、composer seat、宽度控制、workspace chip | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx` |
| `ConversationWidthControls` | 会话宽度控制（`CONTENT_SLOTS.widthControls`） | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationWidthControls.tsx` |
| `ConversationSession` / `DefaultConversationViews` | 严格 per-session header/body；`conversation.view` 列表渲染，blank 态不渲染 | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx`、`DefaultConversationViews.tsx` |

### 3.2 聊天视图与消息流

| 组件 | 作用 | 绝对路径（前缀见附录 A） |
|---|---|---|
| `ChatView` | 聊天页视图槽入口：TurnNavigator、滚动容器、历史加载条、错误条、`conversation.chat.flow`、文本交互面、to-bottom 按钮、文件打开错误对话框 | `CHAT/chat/ChatView.tsx` |
| `ChatFlow` | 消息列表容器 / 流：有序节点行、pending 提交气泡、`RunningStatus`，无额外 DOM 父级 | `CHAT/chat/ChatFlow.tsx` |
| `ChatNodeSeat` | 节点座位：按 NodeKey 订阅、Turn-process 可见性 / 折叠、路由到 keyed `conversation.chat.node` 渲染器 | `CHAT/chat/ChatNodeSeat.tsx` |
| `ChatGroupSeat` | 分组座位：稳定的 process 容器，标题图标 / 活动，显隐切换只改可见性不改父级 | `CHAT/chat/ChatGroupSeat.tsx` |
| `registerChatNodeRenderers` | 注册所有 keyed node renderer（user/assistant/tool/command/…） | `CHAT/chat/register-node-renderers.ts` |
| `registerConversationNodes` | 注册 Chat 业务 Definitions 与 process group | `CHAT/conversation-nodes/register.ts` |
| `TurnNavigator` / `TurnMark` | 右侧固定间距虚拟 turn 导轨（跳转 / 预览 / busy 脉冲） | `CHAT/chat/TurnNavigator.tsx` |
| `TurnTailNodeView` | turn 尾部行：复制 / 分支 / 反馈 / 用量 pill 及 turnTail 卡片列表 | `CHAT/chat/TurnTailNodeView.tsx` |
| `TurnProcessNodeView` | 已结束 turn 的「耗时 / 已工作 / 失败」过程折叠按钮 | `CHAT/chat/TurnProcessNodeView.tsx` |
| `TurnTriggerNodeView` | turn 触发来源（continue/goal/agent/team/github/schedule…）可展开记录 | `CHAT/chat/TurnTriggerNodeView.tsx` |
| `TurnUsagePanel` | token 用量按钮 + 弹层明细（输入 / 缓存 / 输出 / 推理 token、模型路由） | `CHAT/chat/TurnUsagePanel.tsx` |
| `RunningStatus` / `RunningWhaleTail` | 运行中「深度思考中 + 计时」状态及动画鲸鱼图标 | `CHAT/chat/RunningStatus.tsx`、`CHAT/chat/RunningWhaleTail.tsx`、`E:/deepseek-harness/packages/client/ui-chat/src/client/assets/running-whale@2x.png` |
| 滚动 hooks | `useChatScroll`、`use-chat-viewport`、`use-chat-reading`、`use-chat-navigation`、`use-scroll-follow`、`use-process-scroll`、`flow-motion` | `CHAT/chat/use-chat-scroll.ts` 等同名文件 |

### 3.3 消息内容与操作

| 组件 | 作用 | 绝对路径（前缀见附录 A） |
|---|---|---|
| `UserMessageNodeView` | 持久化用户消息 / steering 消息的 keyed renderer（右对齐） | `CHAT/chat/MessageItem.tsx` |
| `UserStyleBubble`（内部） | 用户与 steering 共用的右对齐气泡骨架 | `CHAT/chat/MessageItem.tsx` |
| `PendingSteeringBubble` | Host 授权但尚未落盘的 steering 气泡 | `CHAT/chat/MessageItem.tsx` |
| `PendingSubmissionBubble` | 本地提交回显气泡（含 objectURL 图片预览） | `CHAT/chat/MessageItem.tsx` |
| `UserContent` | 用户内容 Factory：文本气泡 + 附件列表 + JSON extraBlock + 引用摘要 | `CHAT/chat/UserContent.tsx` |
| `AssistantNodeView` | 助手消息 step renderer（running/settled/interrupted 共用） | `CHAT/chat/AssistantNodeView.tsx` |
| `AssistantMarkdown` | 助手块渲染：`text` / `reasoning` / `image` / `tool-call` / 未知块 | `CHAT/chat/AssistantMarkdown.tsx` |
| `AssistantBlock` 各 slot | text→`MarkdownText`；image→`conversation.chat.message.images`；tool-call→由 chat 分组为 tool row；default→`JsonBlock` | `CHAT/chat/AssistantMarkdown.tsx`、`CHAT/contract/snapshot.ts` |
| `MessageIconActions` | 用户 / 助手共用的操作行：复制、分支、时间戳、额外 slot 操作、用量 | `CHAT/chat/MessageIconActions.tsx` |
| `MessageFeedbackActions` | 助手消息 Like/Dislike 反馈按钮（挂在 assistant-actions slot） | `E:/deepseek-harness/packages/client/ui-message-feedback/src/client/MessageFeedbackActions.tsx` |
| `FeedbackDialog` | 反馈弹窗 + 成功 / 失败 toast | `FEEDBACK/FeedbackDialog.tsx` |
| `formatMessageClock` / `formatRunDuration` | 时间戳与运行时长格式化 | `CHAT/chat/message-chrome.ts` |
| `InheritedHistoryNodeView` | 分叉会话继承历史的分隔线（role=separator） | `CHAT/chat/MessageItem.tsx` |
| `ContextMessageNodeView` / `ContextInjectionRow` / `ContextBody` | 注入上下文消息行（含多种 KnownContextForm body 与 OpaqueBody 回退） | `CHAT/chat/MessageItem.tsx`、`ContextInjectionRow.tsx`、`ContextBody.tsx` |
| `SystemPromptNodeView` / `SystemPromptRow` | 系统提示词折叠行 | `CHAT/chat/SystemPromptRow.tsx` |
| `CompactionItem` / `CompactionNodeView` | 历史压缩标记（可展开摘要） | `CHAT/chat/CompactionItem.tsx`、`CHAT/chat/MessageItem.tsx` |
| `ModelRetryItem` / `RetryNodeView` | 模型重试倒计时行 | `CHAT/chat/MessageItem.tsx` |
| `TurnErrorItem` / `TurnErrorNodeView` | turn 终态错误行（错误码、失败文案） | `CHAT/chat/MessageItem.tsx` |
| `TurnMaxTokensItem` / `TurnMaxTokensNodeView` | 输出 token 达上限的警告行 | `CHAT/chat/MessageItem.tsx` |
| `UnknownNodeView` | 未知 surface 的 `JsonBlock` 回退 | `CHAT/chat/MessageItem.tsx` |
| `QuotaNoticeHost` | 全局配额提示 toast（shell.overlay） | `CHAT/chat/QuotaNoticeHost.tsx` |

### 3.4 输入区（ui-conversation 包为主）

| 组件 | 作用 | 绝对路径 |
|---|---|---|
| `InputBar` | 默认 composer 主体（`conversation.composer.bar`）：textarea 宿主、工具栏（+/附件/模式/模型/停止/发送）、Toast、附件、dock、ContextMeter | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` |
| `DraftEditor` / `ComposerContentEditable` | Lexical 内容可编辑文本面（单 textarea 语义，chip 为 decorator portal，14 行滚动） | `E:/deepseek-harness/packages/client/ui-conversation/src/client/input/editor/DraftEditor.tsx`、`ComposerContentEditable.tsx` |
| `keymap.ts` / `view-binding.ts` / `projection.ts` / `runtime.ts` / `chip-node.tsx` / `command-chip-node.tsx` / `QuoteNode.tsx` / `ReferenceChip.tsx` / `DecoratorPortals.tsx` | 提交 / menu / 粘贴键位、DOM 绑定、投影、引用 chip、命令 chip、引用节点 | `E:/deepseek-harness/packages/client/ui-conversation/src/client/input/editor/` |
| 发送 / 停止按钮（InputBar 内 `css.primary`） | 主按钮在 Send / Stop / Continue / Sending 间切换，含 aria、tooltip、快捷键 | `InputBar.tsx`（第 376–407、562–592 行） |
| `IconPlusOutlineMedium` 命令(`+`)按钮 | 命令面板触发器，有 tooltip、aria-haspopup | `InputBar.tsx`（第 506–519 行） |
| 附件按钮 + `<input type="file" multiple>` + `createComposerFileIntake` | 附件 / 拖放入口、文件校验、图片限额、上传重试 | `InputBar.tsx` + `E:/deepseek-harness/packages/client/ui-conversation/src/client/input/file-intake.ts`、`image-labels.ts` |
| `ComposerAttachments` / `AttachmentRail` / `FileCard` / `DropOverlay` / `MessageImage(s)` | 附件条、文件卡、拖放遮罩、消息图片 | `E:/deepseek-harness/packages/client/ui-attachment/src/client/ComposerAttachments.tsx` 等 |
| `ContextMeter` | 上下文用量条 / 环 + 点击展开 system/tools/messages 分解面板 | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ContextMeter.tsx` |
| `QueueDock` | 队列显示（`conversation.input.dock`）：持久队列行、图片缩略图、编辑 / 删除 / 发送 | `E:/deepseek-harness/packages/client/ui-conversation/src/client/queue/QueueDock.tsx` |
| `TodoPanel` / `todoDockEntry` | Todo / 计划 dock 面板 | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/TodoPanel.tsx` |
| `ModelSelect` | 模型选择器（`conversation.input.model`）：两级菜单（模型 / Effort）、搜索、目录、Toast | `E:/deepseek-harness/packages/client/ui-model-selection/src/client/ModelSelect.tsx` |
| `TeamModeToggle` / `TeamModePane` | 模型菜单内的 Agent Teams 开关（模式切换类） | `E:/deepseek-harness/packages/client/ui-agent-team/src/client/TeamModeToggle.tsx` |
| `PermissionSelect` | 权限预设选择（`conversation.input.permission`，只读/写/全访问/自动审查） | `E:/deepseek-harness/packages/client/ui-permission-presets/src/client/PermissionSelect.tsx` |
| `PlanChip`（`PlanModeControl`） | Plan 模式切换 / 状态 chip（`conversation.input.plan`） | `E:/deepseek-harness/packages/client/ui-plan/src/client/PlanModeControl.tsx` |
| `MenuView` / `MenuSurface` | 命令(`+`)面板：slash 触发候选菜单，combobox、骨架行、面包屑 | `E:/deepseek-harness/packages/client/ui-input-trigger/src/client/MenuView.tsx` |
| `PopupSelectView` / `popup.ts` | 命令弹层选择视图（ui-commands） | `E:/deepseek-harness/packages/client/ui-commands/src/client/PopupSelectView.tsx`、`popup.ts` |
| `VoiceInput` / `Waveform` / `MicrophonePicker` / `PreparationCard` / `VoiceSetupDialog` | 语音按钮及录音 / 转写 / 波形 / 准备 / 设置（实验包，`conversation.input.activity`） | `E:/deepseek-harness/packages/experimental/client-ui-voice-input/src/client/VoiceInput.tsx` 等同名文件 |
| `ActivityPill` / `UsagePill` | composer dock 中的活动 / 用量 pill（`conversation.composer.dock`） | `E:/deepseek-harness/packages/client/ui-chat/src/client/chat/StatsPills.tsx` |
| `QuestionComposer` / `QuestionReplyView` / `PlanReviewPanel` | 用户提问 / 计划审查的输入接管 | `E:/deepseek-harness/packages/client/ui-user-questions/src/client/QuestionComposer.tsx` 等同名文件 |
| `EnterBehaviorRow` | 输入设置（Enter 行为） | `E:/deepseek-harness/packages/client/ui-conversation/src/client/settings/EnterBehaviorRow.tsx` |
| 输入机 / 契约 | `input/hub.ts`、`facade.ts`、`machine.ts`、`submission-policy.ts`、`prompt.ts`、`contract/input.ts` | `E:/deepseek-harness/packages/client/ui-conversation/src/client/input/` 与 `contract/input.ts` |
| 注册入口 | `registerComposerBar` / `main.conversation` 等，把上述组件挂到 `conversation.input.*` / `conversation.composer.*` slot | `E:/deepseek-harness/packages/client/ui-conversation/src/client/apply.ts`（第 341–600 行） |

> 提示建议（placeholder/hint）在 `InputBar.tsx` 中通过 `placeholder.*`、`hint.*` 与命令 claim 的 ghost hint 实现（第 409–435 行）。

### 3.5 侧边栏

| 组件 | 作用 | 绝对路径 |
|---|---|---|
| `SidebarRoot` | 侧边栏外壳：列几何、折叠动画、面板导航、品牌、新会话、workspace 区、foot 设置 | `E:/deepseek-harness/packages/client/ui-sidebar/src/client/SidebarRoot.tsx` |
| `PanelRow` / `PanelMoreMenu` | 面板入口行、固定面板与 More 菜单、取消固定 | 同上（第 58–141 行） |
| `HeaderLeadingControls` | 侧栏完全隐藏时的顶栏 leading：打开侧栏 + 新会话（桌面） | `E:/deepseek-harness/packages/client/ui-sidebar/src/client/HeaderLeadingControls.tsx` |
| `PanelIcon` / `sidebar.panel.icon` factory | 面板图标 | `E:/deepseek-harness/packages/client/ui-sidebar/src/client/PanelIcon.tsx` |
| `scroll-handoff.ts` / `panel-pins.ts` | 滚轮交接、面板固定 | `E:/deepseek-harness/packages/client/ui-sidebar/src/client/scroll-handoff.ts`、`panel-pins.ts` |
| `WorkspaceBrowser` | 会话列表 / 工作区浏览区：标题、视图选项、搜索框（250ms 防抖）、分组树 / 平铺列表、归档过滤 | `E:/deepseek-harness/packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx` |
| `ProjectRowItem` / `SearchResultItem` / `SessionNodeItem` | 会话列表项 / 分组文件夹行 / 搜索结果行：hover 交换、标题 marquee、状态点 | `E:/deepseek-harness/packages/client/ui-workspace/src/client/rows/Rows.tsx` |
| `tree.ts` | 分组 / 文件夹（`deriveGroups`/`UNGROUPED_KEY`）、搜索结果、平铺、ordered | `E:/deepseek-harness/packages/client/ui-workspace/src/client/tree.ts` |
| `WorkspacePicker` / `WorkspacePickerFactory` | 工作区选择器（hero 与侧栏共用），新建 / 切换工作区 | `E:/deepseek-harness/packages/client/ui-workspace/src/client/WorkspacePicker.tsx` |
| `WorkspaceDialogs` | 工作区对话框（新建 / 重命名等） | `E:/deepseek-harness/packages/client/ui-workspace/src/client/rows/WorkspaceDialogs.tsx` |
| `SessionMenu` / `context-menus.tsx` | 会话 `...` 菜单与右键菜单动作 | `E:/deepseek-harness/packages/client/ui-workspace/src/client/session-actions/SessionMenu.tsx`、`context-menus.tsx` |
| `RenameSession` / `ArchiveSession` / `PinSession` / `RowActionToast` | 会话重命名对话框、归档确认、置顶、行操作 toast | `E:/deepseek-harness/packages/client/ui-workspace/src/client/session-actions/` 下同名文件 |
| 新会话按钮 `sidebar.session.action` | 新建会话（含快捷键提示） | `SidebarRoot.tsx`（第 381–408 行） |
| 设置入口 / footer | `sidebar.settings`、`sidebar.footer.action` | `SidebarRoot.tsx`（第 467–475 行） |
| `AccountMenu` / `AccountAvatar` / `AccountSection` | 用户菜单、头像、账户区 | `E:/deepseek-harness/packages/client/ui-settings-account/src/client/` 下同名文件 |
| `AccountNotifications` / `AccountNoticeStack` | 侧栏账户菜单内的通知（配额 / 公告） | `E:/deepseek-harness/packages/client/ui-account-notifications/src/client/AccountNotifications.tsx` |
| `SignInDialog` / `SignOutDialog` / `PlatformOverlay` | 登录 / 登出对话框、平台浮层 | `E:/deepseek-harness/packages/client/ui-settings-account/src/client/` 下同名文件 |
| `AccountQuotaNotice` | 账户配额提示 | `E:/deepseek-harness/packages/client/ui-settings-account/src/client/AccountQuotaNotice.tsx` |
| `ui-history` / `ui-jobs` 面板 | 历史 / 任务类侧栏面板（通过 `sidebar.panellist.actions` 注册） | 见 `E:/deepseek-harness/packages/client/ui-jobs/src/client/JobListAction.tsx` 等 |

### 3.6 状态与反馈

| 组件 | 作用 | 绝对路径 |
|---|---|---|
| `EmptyHero` / `HeroShell` / `HeroFish` / `WorkspaceChip` | 空状态 / 欢迎页：鱼形鲸鱼 hero、workspace chip、hover 游动 SMIL | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx` |
| `PixelWhale` / `renderer.ts` / `artwork.ts` | home whale（官方品牌首页鲸鱼装饰，`conversation.hero.frame` HOC） | `E:/deepseek-harness/packages/client/ui-brand-official/src/client/home-whale/PixelWhale.tsx` 等 |
| `OfficialBrandMark` / `OfficialBrandName` | 官方品牌 mark/name（侧栏 slot） | `E:/deepseek-harness/packages/client/ui-brand-official/src/client/Brand.tsx` |
| `TextShimmer` | typing/loading 文本闪烁（运行态文案） | `E:/deepseek-harness/packages/client/ui-primitives/src/TextShimmer.tsx` |
| `RunningStatus` / `RunningWhaleTail` | typing 指示：运行中计时 + 鲸尾动画 + aria-live | `CHAT/chat/RunningStatus.tsx`、`RunningWhaleTail.tsx`、`E:/deepseek-harness/packages/client/ui-chat/src/client/assets/running-whale@2x.png` |
| 历史加载条 | `chat.loadingHistory` / `openError` / `older` 历史 loading/错误/重试/start 状态 | `CHAT/chat/ChatView.tsx`（第 247–273 行） |
| `QuotaNoticeHost` | 配额提示（`shell.overlay` 帧级 Toast，可按 code 被替换） | `CHAT/chat/QuotaNoticeHost.tsx` |
| `WelcomeNotice` | 模型欢迎提示（版本化一次性 modal，`settings.onboarding`） | `E:/deepseek-harness/packages/client/ui-settings-models/src/client/WelcomeNotice.tsx` |
| `OnboardingModal` / `DeepSeekOnboardingDialog` | onboarding 对话框壳 | `E:/deepseek-harness/packages/client/ui-settings-models/src/client/OnboardingModal.tsx`、`DeepSeekOnboardingDialog.tsx` |
| Onboarding 全套步骤 | `AccountOnboarding` / `DesktopOnboarding` / `DesktopOnboardingEntry` / `OnboardingWelcomeStep` / `OnboardingPurposeStep` / `OnboardingProcessStep` / `OnboardingCreditStep` / `OnboardingConfirmation` / `OnboardingSurface` / `OnboardingIllustration` | `E:/deepseek-harness/packages/client/ui-settings-account/src/client/` 下同名文件；样式 `ui-theme/src/styles/onboarding.css` |
| `Toast` | 通用瞬时横幅（顶部居中、portal、可带动作，成功 tone） | `E:/deepseek-harness/packages/client/ui-primitives/src/Toast.tsx` |
| `StateDot` | 状态点（会话状态 / 任务状态） | `E:/deepseek-harness/packages/client/ui-primitives/src/StateDot.tsx` |
| `RiskConfirmation` | 风险确认提示组件 | `E:/deepseek-harness/packages/client/ui-primitives/src/RiskConfirmation.tsx` |
| `FileOpenErrorDialog` | 文件打开失败对话框（消息 + 重试） | `CHAT/chat/ChatView.tsx`（第 326–351 行） |
| `ModelRetryItem` / `failureMessage` | 模型重试倒计时、错误码到文案映射 | `CHAT/chat/MessageItem.tsx` |
| Skeleton 骨架屏 | 输入触发菜单与列表的骨架行（CSS + 两行 fallback） | `E:/deepseek-harness/packages/client/ui-input-trigger/src/client/MenuView.tsx`、`MenuView.module.css`；`TextShimmer` 承担文本骨架效果 |

> 说明：未在 ui-conversation/ui-chat 中发现独立的 `Skeleton.tsx` 组件；骨架反馈由 `TextShimmer`、菜单骨架行、以及各列表 loading 文案承担。

### 3.7 弹窗 / 浮层 / 菜单

| 组件 | 作用 | 绝对路径 |
|---|---|---|
| `MenuOverlay` / `menuEntries` | 右键菜单统一渲染（contextual、portal、子菜单、footer、快捷提示） | `E:/deepseek-harness/packages/client/ui-context-menu/src/client/View.tsx` |
| `View.tsx` / `Button.tsx` / `trigger.ts` / `external-trigger.ts` / `registry.ts` / `target-key.ts` | 右键菜单触发、注册、目标键 | `E:/deepseek-harness/packages/client/ui-context-menu/src/client/` |
| `Menu` / `MenuSurface` / `MenuGroup` / `MenuRow` | 通用下拉菜单 / 菜单面 / 分组 / 行 | `E:/deepseek-harness/packages/client/ui-primitives/src/Menu.tsx` 等同名文件 |
| `Modal` / `useModalLayer` | 通用对话框（portal、遮罩、Escape、焦点管理、headless 模式） | `E:/deepseek-harness/packages/client/ui-primitives/src/Modal.tsx` |
| `Tooltip` / `tooltip-placement.ts` | 工具提示（portal、延迟、快捷键标签） | `E:/deepseek-harness/packages/client/ui-primitives/src/Tooltip.tsx`、`tooltip-placement.ts` |
| `HoverCard` / `HoverCardGroup` | 会话行 / 工作区行悬浮卡 | `E:/deepseek-harness/packages/client/ui-primitives/src/HoverCard.tsx`、`HoverCardGroup.tsx` |
| `ImageLightbox` / `ImagePreview` / `DraggableImage` | 图片预览浮层 | `E:/deepseek-harness/packages/client/ui-primitives/src/ImageLightbox.tsx` 等同名文件 |
| `SegmentedControl` / `SegmentedTabs` / `Pill` / `Tag` / `Switch` / `Checkbox` / `Input` / `Button` | 通用 UI 原子（分段控件、标签、开关、输入、按钮） | `E:/deepseek-harness/packages/client/ui-primitives/src/` 下同名文件 |
| `PopupSelectView` / `popup.ts` | 命令弹层选择视图 | `E:/deepseek-harness/packages/client/ui-commands/src/client/PopupSelectView.tsx`、`popup.ts` |
| `MenuView` | 输入触发候选浮层（combobox listbox） | `E:/deepseek-harness/packages/client/ui-input-trigger/src/client/MenuView.tsx` |
| `FloatLayer` / `DockSurface` / `TabLayout` / `TabTitle` / `TabPanel` | 通用浮层 / 停靠层 / 标签布局（dockkit） | `E:/deepseek-harness/packages/client/ui-dockkit/src/components/` 下同名文件 |
| `ShellCard` | shell 卡片（设置面板容器类） | `E:/deepseek-harness/packages/client/ui-settings-shell/src/client/ShellCard.tsx` |
| `contextMenu.button` factory / `contextMenu.content` | 行菜单触发与自定义菜单内容 seat | `E:/deepseek-harness/packages/client/ui-workspace/src/client/rows/Rows.tsx`、`E:/deepseek-harness/packages/client/ui-context-menu/src/client/registry.ts` |

---

## 第 4 章 卡片清单（全部类型）

### 4.1 思考过程卡

| 组件 | 作用 | 绝对路径 |
|---|---|---|
| `ReasoningRow` | 单个推理块的折叠行（think 图标、摘要 shimmer、展开 Markdown） | `CHAT/chat/ReasoningRow.tsx` |
| `ReasoningContent` | 推理内容 Factory：compact `MarkdownText` | `CHAT/chat/ReasoningContent.tsx` |
| `DefaultReasoningBody` | 推理 Body slot 的默认适配器（转调 Content Factory） | `CHAT/chat/ReasoningContent.tsx` |
| `ProcessReasoning`（内部） | 整 turn 折叠时隐藏 / 揭示内联推理 | `CHAT/chat/AssistantMarkdown.tsx` |
| `useDisclosure` / `bindDisclosure` | 折叠状态 hook，随 turn 重置 | `CHAT/chat/use-disclosure.ts` |
| `processTitle` / `PROCESS_ICONS` | 步骤分组标题（按 activity 排序组合文案与图标） | `CHAT/chat/step-process.ts`、`CHAT/chat/ChatGroupSeat.tsx` |
| `ChatGroupSeat` | 步骤（step process）分组的折叠 / 展开容器 | `CHAT/chat/ChatGroupSeat.tsx` |
| `TurnProcessNodeView` | turn 级过程折叠开关 | `CHAT/chat/TurnProcessNodeView.tsx` |

> 活动类型（icon）：`thinking / read / readImage / search / edit / write / commands / code / webSearch / webFetch / subagents / plan / questions / tools / context`，见 `CHAT/chat/ChatGroupSeat.tsx`。

### 4.2 工具调用卡（10 内建 + 2 跨包）

**框架层：**

| 组件 | 作用 | 绝对路径 |
|---|---|---|
| `ToolCallTree` / `ToolCall` / `ToolCallBranch` | 根调用与递归子调用的 keyed 派发，fallback 为 `GenericToolCard` | `TOOL/tool/ToolCallTree.tsx` |
| `GenericToolCard` | 通用工具卡回退（按 variant 选图标，自动识别 terminal/read/diff/search/web 卡） | `TOOL/tool/toolviews/GenericToolCard.tsx` |
| `ToolRow` | 所有工具行共用的可展开行壳（summary、body、output、各类 card 插槽） | `TOOL/tool/components/ToolRow.tsx` |
| `ToolDetails` / `ToolDetailItem` | 只读字段 / 列表 / 状态码详情卡（子代理、定时任务、LSP 等结果） | `TOOL/tool/components/ToolDetails.tsx` |
| `AskQuestionCard` | ask_user_question 的问题记录卡 | `TOOL/tool/components/AskQuestionCard.tsx` |
| `QuestionToolRow` | 问题面板行 | `TOOL/tool/components/QuestionToolRow.tsx` |
| `ExitCodeBadge` | 命令退出码徽标 | `TOOL/tool/components/ExitCodeBadge.tsx` |
| `toolRowModel` + 各 card model | 行模型派生：variant/state/summary/body/output + terminal/read/diff/search/web/image/details 模型 | `TOOL/tool/models/`（`tool-call-model.ts`、`terminal-card-model.ts`、`read-card-model.ts`、`diff-card-model.ts`、`search-card-model.ts`、`web-card-model.ts`、`image-card-model.ts`、`details-card-model.ts`、`office-card-model.ts`、`todo-diff-model.ts`、`ask-question-card-model.ts`、`auto-review-denial.ts` 等） |

**内建 tool view（文件名即线索，含注册 key）：**

| 组件 | 作用 / 覆盖的 wire key | 绝对路径 |
|---|---|---|
| `BashRow` (`bashToolviewSample`) | 命令执行卡：状态、退出码、TerminalBlock / 输入输出；key `bash` | `TOOL/tool/toolviews/bash-sample.tsx` |
| `ReadRow` (`readToolview`) | 读文件卡：可打开路径 + ReadBlock；key `read` | `TOOL/tool/toolviews/read-row.tsx` |
| `ReadImageRow` (`readImageToolview`) | 读图片卡：图片经 `tool.call.images` slot 展示；key `read_image` | `TOOL/tool/toolviews/read-image-row.tsx` |
| `FileMutationRow` (`fileMutationToolview`) | 写 / 改文件卡：DiffBlock + 文件大小；key `apply_patch` / `edit` / `write` | `TOOL/tool/toolviews/file-mutation-row.tsx` |
| `SearchRow` (`searchToolview`) | 搜索卡（grep/glob 结果，SearchBlock）；key `grep` / `glob` | `TOOL/tool/toolviews/search-row.tsx` |
| `WebRow` (`webToolview`) | Web 搜索 / 抓取卡（WebBlock + 传输失败文案 + URL 链接）；key `web_search` / `web_fetch` | `TOOL/tool/toolviews/web-row.tsx` |
| `TodoRow` (`todoToolview`) | 计划 / 待办卡（完成数、diff、状态变化）；key `todo_write` | `TOOL/tool/toolviews/todo-row.tsx` |
| `DetailsRow` (`detailsToolview`) | 详情卡（**40 个 key**）：create/get/update_goal、schedule_*、cordis_inspect_*、workflow、ralph、session_*、list_subagent_models、subagent/subagent_fork、list_agents、send_message、interrupt_agent、job_*、terminal_open/read/list/signal/close、lsp、spawn_teammate、team_task_*、wait_agent | `TOOL/tool/toolviews/details-row.tsx` |
| `AskQuestionRow` (`askQuestionToolview`) | 向用户提问卡（问题 / 选项 / 答案记录、面板揭示）；key `ask_user_question` | `TOOL/tool/toolviews/ask-question-row.tsx` |
| `OfficeRow` (`officeToolview`) | Office 文档卡（路径导航 + 文本结果）；key `office_render` / `office_convert` / `office_recalculate` | `TOOL/tool/toolviews/office-row.tsx` |

**其它包注册的 tool view：**

| 组件 | 作用 / key | 绝对路径 |
|---|---|---|
| `SkillRow` | 技能调用卡；key `skill` | `E:/deepseek-harness/packages/client/ui-skill/src/client/SkillRow.tsx`（注册见同目录 `index.ts:89`） |
| `PresentRow` | 交付(present)工具调用状态卡；key `present` | `DELIV/PresentRow.tsx`（注册见 `DELIV/index.ts:85`） |

> 说明：`ui-tool/src/client/apply.ts:47-56` 依次挂载以上 10 个内建 tool view；`GenericToolCard` 兜底其它 key（如 `pwsh`、`run_code`、`cua_run_code`、`cordis_run/stop/undefine` 等，见 `TOOL/tool/models/tool-call-model.ts` 的 `TOOL_VARIANTS`）。未发现 MCP / 图片生成专用 tool view；`read_image` 承担图片结果展示。

### 4.3 代码相关卡

| 组件 | 作用 | 绝对路径 |
|---|---|---|
| `FenceCodeBlock` | 代码块（语言横幅、复制、换行、diff 模式） | `PRIM/markdown/FenceBlocks.tsx` |
| `FenceMathBlock` | 数学公式卡（display TeX / KaTeX） | `PRIM/markdown/FenceBlocks.tsx` |
| `MathFenceLayer` | `math` fence 层：流式时显示源码、稳定后渲染公式 | `CHAT/fence/FenceLayers.tsx` |
| `DiffFenceLayer` | `diff` / `patch` fence 层：统一 diff 行 | `CHAT/fence/FenceLayers.tsx` |
| `registerFenceLayers` | 按语言注册 fence 层（`math`/`diff`/`patch`） | `CHAT/fence/register.ts` |
| `CodeBlock` | 通用代码卡原语（工具栏、高亮、复制） | `PRIM/markdown/CodeBlock.tsx` |
| `DiffBlock` | 工具结果中的 diff 卡原语 | `PRIM/DiffBlock.tsx` |
| `JsonBlock` | JSON / 未知块回退卡（截断至 20k 字符） | `PRIM/markdown/JsonBlock.tsx` |
| `renderTable` | Markdown 表格渲染（宽表 `md-table-wide`、横向滚动） | `PRIM/markdown/render.tsx` |

### 4.4 附件与文件卡（ui-attachment 全部卡片）

| 组件 | 作用 | 绝对路径 |
|---|---|---|
| `FileCard` | 草稿文件卡：类型图标、名称、大小、上传进度、失败重试、移除 | `ATTACH/FileCard.tsx` |
| `MessageImage` | 单张消息图片：授权加载、重试、lightbox，三种 variant `single/tile/thumbnail` | `ATTACH/MessageImage.tsx` |
| `ImageGallery` | 图片画廊（多图平铺） | `ATTACH/MessageImage.tsx` |
| `MessageImages` / `MessageImagesContent` | 图片消息 slot 与官方 Content Factory | `ATTACH/client/MessageImages.tsx` |
| `ComposerAttachments` | 输入框附件区：草稿预览、文件卡、拖拽覆盖层、lightbox | `ATTACH/client/ComposerAttachments.tsx` |
| `AttachmentRail` | 草稿附件的横向滚动轨道（边缘翻页按钮） | `ATTACH/AttachmentRail.tsx` |
| `DropOverlay` | 拖拽文件覆盖提示 | `ATTACH/DropOverlay.tsx` |
| `installDocumentDropEvents` | 文档级拖放事件 | `ATTACH/client/drop-events.ts` |
| 用户消息中的文件卡 | `UserContent` 内以 `FileTypeIcon + 名称 + 扩展名/大小` 展示已提交文件 | `CHAT/chat/UserContent.tsx` |

> 注册位置：`ATTACH/client/index.ts` —— `conversation.images.content` Factory、`conversation.input.attachments`、`conversation.chat.message.images`、`conversation.chat.user.images`、`conversation.trajectory.images`、`tool.call.images`。

### 4.5 交付物卡（ui-deliverables 全部卡片）

| 组件 | 作用 | 绝对路径 |
|---|---|---|
| `DeliverablesTail` / `Deliverables` | turn 尾部的交付物区：变更文件卡 + 明确声明的交付文件列表 | `DELIV/Deliverables.tsx` |
| `ChangedFiles` | 变更文件卡（单文件/多文件、增删行数、hover 预览、打开评审） | `DELIV/ChangedFiles.tsx` |
| `FileDiff` | 共享文件对比（并排/统一 diff、语法高亮、行数上限 5000） | `DELIV/FileDiff.tsx` |
| `PresentedFileCard` | 单个交付文件卡（类型图标、描述、状态、native 动作、侧栏预览） | `DELIV/PresentedFileCard.tsx` |
| `PresentRow` | present 工具调用状态卡（见 4.2） | `DELIV/PresentRow.tsx` |
| `ReviewTab` | 右侧栏 `changes-review` tab：按文件切换查看 turn 前后对比 | `DELIV/ReviewTab.tsx` |
| `ChangesSummaryStore` / `ChangesDiffStore` / `PresentedOpenController` | 变更摘要/diff/交付打开的 store | `DELIV/changes-summary.ts`、`DELIV/changes-diff.ts`、`DELIV/present-open.ts` |
| `turn-deliverables` / `review-definition` | turn 交付 Definition、评审 tab 定义 | `DELIV/turn-deliverables.ts`、`DELIV/review-definition.ts` |

> 其它 turnTail 交付/产物卡（跨包）：`PlanCards` — `E:/deepseek-harness/packages/client/ui-plan/src/client/PlanCard.tsx`；`ScheduleTurnCard` / `ScheduleCreateCard` — `E:/deepseek-harness/packages/client/ui-schedule/src/client/ScheduleTurnCard.tsx`、`ScheduleCreateCard.tsx`。

### 4.6 其他卡

| 组件 | 作用 | 绝对路径 |
|---|---|---|
| `TeamCommandRow` | `/team` 命令历史失败/输出卡 | `E:/deepseek-harness/packages/client/ui-agent-team/src/client/TeamCommandRow.tsx` |
| `GenericCommandCard` | 通用命令生命周期卡（running/ok/error 摘要 + 多行输出） | `CHAT/chat/GenericCommandCard.tsx` |
| `CompactionCommandCard` | `/compact` 命令 + 压缩事务整合卡 | `CHAT/chat/CompactionCommandCard.tsx` |
| `CommandNodeView` / `ManualCompactionNodeView` | 命令节点 keyed renderer + 命令视图 slot 派发 | `CHAT/chat/CommandNodeView.tsx` |
| `ApprovalCommand` | 审批详情：解析关联工具调用的命令文本 | `CHAT/chat/ApprovalCommand.tsx` |
| `ApprovalCard` / `ApprovalWarning` / `ApprovalPanel` | 权限审批卡（允许/拒绝/始终允许、警告） | `E:/deepseek-harness/packages/client/ui-approval/src/client/ApprovalCard.tsx`、`ApprovalWarning.tsx`、`ApprovalPanel.tsx` |
| `QuestionReplyBubble` / `QuestionReplyView` | 已回答问题批次的用户气泡（右对齐、带复制/时间） | `E:/deepseek-harness/packages/client/ui-user-questions/src/client/QuestionReplyView.tsx` |
| `WorkflowRunPanel` | 工作流运行节点卡（状态、阶段、成员） | `E:/deepseek-harness/packages/client/ui-workflow-run/src/client/WorkflowRunPanel.tsx` |
| `GoalCommandInputView` | `/goal` 命令输入气泡 | `E:/deepseek-harness/packages/client/ui-goal/src/client/GoalCommandInputView.tsx` |
| `WebBlock` / `WebSourceView` | Web 搜索结果卡（答案 + 引用来源列表）/ web_fetch 卡 | `PRIM/WebBlock.tsx` |
| `SearchBlock` | grep/glob 结果卡原语 | `PRIM/SearchBlock.tsx` |
| `TerminalBlock` | 终端执行结果卡原语 | `PRIM/TerminalBlock.tsx` |
| `ReadBlock` | 读文件结果卡原语 | `PRIM/ReadBlock.tsx` |
| `FileReference` / `FolderReference` | 用户文本中的 `@文件` / `@文件夹` 引用渲染 | `E:/deepseek-harness/packages/client/ui-reference/src/client/FileReference.tsx` |

### 4.7 清点要点

- **节点渲染统一走 keyed slot** `conversation.chat.node`（`CHAT/chat/register-node-renderers.ts`），工具卡统一走 `tool.call.toolview`（`TOOL/apply.ts`）。
- **工具卡共 10 个内建 view + 2 个跨包 view**，`detailsToolview` 一类就覆盖 40 个 wire key，`fileMutationToolview` 覆盖 3 个、`webToolview`/`searchToolview`/`officeToolview` 各 2–3 个。
- **消息块 slot** 在 `CHAT/chat/AssistantMarkdown.tsx`：text / reasoning / image / tool-call / 未知→`JsonBlock`。
- 所有路径均已通过实际打开目录与文件确认，未发现独立命名的「MCP 卡」「图片生成卡」；相关能力由通用 `GenericToolCard` / `read_image` / `DetailsRow` 承担。

---

## 第 5 章 文本内容 / i18n 清单

### 5.1 总论

聊天页可见文字 **100% 走 `t('key')` 字典**，无硬编码（对 5 个核心包做了中文字符 / `placeholder` / `aria-label` / `title` / 裸 JSX 文本全文扫描，零遗漏）。唯一例外是注释中出现的中文（如 `ContextMeter.tsx` 注释里的 `45% of context used / 上下文已用 45%`），非运行时文案。

**主字典：**

| 字典 | 大小 | 作用 |
|---|---|---|
| `CHAT/locale.ts` | 101.47 KB | zh 为真源，`NS = 'chat'` |
| `E:/deepseek-harness/packages/client/ui-conversation/src/client/locales.ts` | 172.11 KB | 会话 / 输入区文案 |
| 各包的 `locales.ts` / `locale/zh.json` | — | 各功能包文案 |

文件开头示例（`E:/deepseek-harness/packages/client/ui-chat/src/client/locale.ts:1-8`）：

```ts
/** Chat-owned locale namespace and dictionaries. */
/** Namespace for Chat target, node, statistics, and details copy. */
export const NS = 'chat'
/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'message.stepProcess.thinking': '正在分析请求',
  ...
}
```

### 5.2 步骤过程文案（`message.stepProcess.*`）

| 类别 | 文案 |
|---|---|
| 进行态 | `正在分析请求` / `正在读取文件` / `正在读取图片` / `正在写入文件` / `正在搜索代码` / `正在编辑文件` / `正在运行命令` / `正在运行代码` / `正在搜索网页` / `正在访问网页` / `正在协调子智能体` / `正在更新计划` / `等待你的操作` / `正在调用工具` |
| 准备态（`prepare.*`） | `准备读取文件` / `准备读取图片` / `准备写入文件` / `准备搜索代码` / `准备编辑文件` / `准备运行命令` / `准备运行代码` / `准备搜索网页` / `准备访问网页` / `准备协调子智能体` / `准备更新计划` / `准备提问` / `准备调用工具` |
| 完成态（`done.*`） | `已完成分析` / `已读取文件` / `已读取图片` / `已写入文件` / `已搜索代码` / `修改了文件` / `执行了命令` / `运行了代码` / `已搜索网页` / `已访问网页` / `已协调子智能体` / `更新了计划` / `向用户提出了问题` / `已调用工具` / `已注入上下文` |
| 组合 | `{first}并{second}`、`，`、`已`、`{title}等` |

### 5.3 触发来源 / turn 过程 / 视图 / 图片

| 分类 | 文案 |
|---|---|
| 触发来源（`message.trigger.*`） | `收到执行请求` / `继续执行目标` / `收到任务消息` / `收到团队消息` / `子任务状态更新` / `子智能体已完成任务` / `子智能体任务已停止` / `子智能体执行失败` / `子智能体已达 token 上限` / `子智能体拒绝执行` / `子智能体异常结束` / `收到 GitHub 事件` / `收到外部事件` / `自动化任务` / `后台任务状态更新` / `插件状态更新` / `这条通知触发了本轮回复。` |
| turn 过程 | `已完成` / `已完成，用时 ` / `处理失败` |
| 视图 | `对话` |
| 图片 | `查看大图` / `加载图片…` / `图片无法预览` / `图片预览` / `关闭图片预览` |
| 数字 | `number.groupSeparator` = `,` |

### 5.4 消息操作与反馈

复制 / 已复制、点赞 / 点踩（含填充态）、分支、反馈弹窗（`FEEDBACK/FeedbackDialog.tsx`）与成功 / 失败 toast、时间戳（`formatMessageClock` / `formatRunDuration`）、token 用量明细（输入 / 缓存 / 输出 / 推理 token、模型路由，`TurnUsagePanel.tsx`）。

### 5.5 输入区文案

`placeholder.*` / `hint.*`、命令 ghost hint、发送 / 停止 / 继续 / 发送中 tooltip 与快捷键、附件校验与图片限额提示（`image-labels.ts`）。

### 5.6 onboarding 全套文案

来源：`E:/deepseek-harness/packages/client/ui-settings-account/src/client/locales/onboarding.ts`

| 中文 | English | key |
|---|---|---|
| 继续 / 你希望看到多少工作过程？ | Continue / How much detail would you like to see? | `onboardingContinue` / `onboardingProcess` |
| 这只会影响工作过程的展示方式，不会影响 DeepSeek Harness 的工作能力。 | This only changes how progress is shown, not what DeepSeek Harness can do. | `onboardingProcessDescription` |
| 聚焦结果 / 只看结果，保持界面简洁明了 | Results only / See just the results in a clean, simple interface | `onboardingCompact` / `onboardingCompactDescription` |
| 关键细节 / 结果优先，仅展示重要步骤和关键操作 | Key details / Focus on results, with only the most important steps and actions shown | `onboardingStandard` / `onboardingStandardDescription` |
| 完整过程 / 查看完整工作过程，方便调试和排查问题 | Full details / See the full process for easier debugging and troubleshooting | `onboardingDetailed` / `onboardingDetailedDescription` |
| 进入应用 / 上一步 / 跳过 | Open app / Back / Skip | `onboardingEnter` / `onboardingBack` / `onboardingSkip` |
| 跳过设置？/ 你可以随时前往 设置 → 通用设置 中调整工作过程、性能与用量展示方式或开启代码工作工具。 | Skip setup? / You can change how progress, performance, and usage are displayed, or enable Coding Tools, anytime in Settings → General. | `onboardingSkipTitle` / `onboardingSkipDescription` |
| 继续设置 / 暂时跳过充值？ | Continue setup / Skip adding credits? | `onboardingKeepSetting` / `onboardingNoCreditTitle` |
| 没有可用额度时，DeepSeek Harness 将无法开始新的任务。你可以稍后前往 设置 → 账号与余额 进行充值。 | DeepSeek Harness can't start new tasks without credits. You can add them later in Settings → Account. | `onboardingNoCreditDescription` |
| 我知道了 / 前往充值 | Got it / Add credits | `onboardingUnderstood` / `onboardingGoTopUp` |
| 未能保存设置，请重试。/ 重试 / 正在加载设置… | Could not save settings. Try again. / Retry / Loading settings… | `onboardingSaveFailed` / `onboardingRetry` / `onboardingLoading` |

品牌文案：`onboardingBrand` = `DeepSeek Harness`（来源 `E:/deepseek-harness/packages/client/ui-settings-account/src/client/locales/onboarding.ts`）。

### 5.7 账号与额度提示（聊天中弹出）

来源：`E:/deepseek-harness/packages/client/ui-settings-account/src/client/locales.ts`

| 中文 | English | key |
|---|---|---|
| 当前模型暂不可用，请登录后再试 | Model unavailable. Please sign in and try again. | `modelSignInRequired` |
| 登录信息已失效，请重新登录 | You have signed out of your account, please log in again. | `sessionExpired` |
| 当前无可用余额 / 没有可用额度时，DeepSeek Harness 无法开始新的任务，是否前往充值？或者可以稍后前往 设置 → 账号与余额 进行充值。/ 去充值 | No balance available / DeepSeek Harness cannot start a new task with this account when no balance is available. Would you like to top up? You can also top up later in Settings → Account. / Top up | `quotaTitle` / `quotaDescription` / `quotaTopUp` |
| 开始使用 / 登录 DeepSeek 账号，或添加 API Key，即可开始使用。你的项目和文件保存在本地。 | Get started / Sign in to your DeepSeek account or add an API Key to get started. Your projects and files are stored locally. | `loginTitle` / `loginDescription` |
| 等待登录 / 没有自动打开新页面？/ 复制登录链接 / 链接已复制 / 复制失败 / ，手动打开登录页完成登录。 | Waiting for sign in / Page did not open automatically? / Copy sign-in link / Link copied / Copy failed / , then open it in your browser to finish signing in. | `browserTitle` / `browserPrompt` / `copyLink` / `copiedLink` / `copyFailed` / `browserDescription` |
| 登录已超时 / 请重新登录后继续操作。/ 登录失败 / 操作未完成，请重试 / 重试 | Sign in timed out / Sign in again to continue. / Could not sign in / Could not complete the operation. Try again. / Retry | `timeoutTitle` / `timeoutDescription` / `failureTitle` / `platformFailed` / `platformRetry` |
| 加载中… / 返回 DeepSeek Harness / 设置 / 意见反馈 / 账号菜单 | Loading… / Back to DeepSeek Harness / Settings / Feedback / Account menu | `loading` / `backToHarness` / `settings` / `contactUs` / `menu` |
| 登录 / 退出登录 / 已登录 DeepSeek / 尚未登录 | Sign in / Sign out / Signed in to DeepSeek / Not signed in | `signIn` / `signOut` / `signedIn` / `signedOut` |
| 暂时无法确认任务状态。退出登录可能会中断使用此账号的任务，是否继续？/ 退出登录不会丢失任何数据，你仍可以登录此账号。/ 当前有进程正在执行中，点击"退出登录"，将会打断进程，是否即刻退出登录？/ 取消 / 打开浏览器 | （对应英文见字典 en） | `signOutUnknownDescription` / `signOutDescription` / `signOutRunningDescription` / `cancel` / `open` |
| 正在发起登录… / 请在浏览器中继续 / 正在完成登录… / 登录已过期，请重试。/ 其他错误文案 | Starting sign in… / Continue in your browser / Completing sign in… / Sign in expired. Try again. | `initializing` / `waiting` / `completing` / `expired` / `failed` / `noResponse` / `settingsSignedOutTitle` / `settingsSignedOutDescription` / `signInDescription` / `profileUnavailable` / `balance` / `bonusBalance` / `balanceUnavailable` / `balanceSignedOut` / `accountInfo` / `more` / `usage` / `topUp` |

> 额度 Toast 的聊天页文案来源是 `message.failure.quota`（当前请求的额度已用尽 / Request quota exhausted.），见 `CHAT/chat/QuotaNoticeHost.tsx`；弹窗详情走本节 `quotaTitle/quotaDescription/quotaTopUp`。

### 5.8 模型设置欢迎提示（WelcomeNotice）

来源：`E:/deepseek-harness/packages/client/ui-settings-models/src/client/locales.ts` 与 `E:/deepseek-harness/packages/client/ui-settings-models/src/client/WelcomeNotice.tsx`

该提示只在首次 / 版本更新时出现在聊天区上方，文案位于 `ui-settings-models/src/client/locales.ts`（en 为真源，zh 字典同 key）。关键条目：`intro`（输入 API key 以使用以下提供方的模型 / Enter your API keys to use models from the following providers.）、`add`（添加模型提供方 / Add model provider）、`close`（关闭 / Close）、`keyPlaceholder`（输入你的 API key / Enter your API key）、`credentialConfigured`（API key 已配置 / API key configured）、`keyHelp`（保存的凭据优先使用… / Saved credentials are used first…）等。完整字典约 130+ 条，均为设置面板文案。

版本控制常量：`WELCOME_NOTICE_ACK_FIELD='welcomeNoticeVersion'`、`WELCOME_NOTICE_VERSION='2026-09-28.1'`，来源 `E:/deepseek-harness/packages/client/ui-settings-models/src/onboarding-copy.ts`。

### 5.9 各包 locale 目录元信息

| 包 | 中文标题 / 描述 | 英文标题 | 来源 |
|---|---|---|---|
| ui-chat | 聊天内容展示 / 渲染聊天消息、工具内容和相关详情。 | ui-chat | `E:/deepseek-harness/packages/client/ui-chat/locale/zh.json`、`en.json` |
| ui-conversation | 会话界面框架 / 组织对话内容、输入框、消息队列和视图导航。 | ui-conversation | `E:/deepseek-harness/packages/client/ui-conversation/locale/zh.json`、`en.json` |
| ui-tool | 工具调用展示 / 展示工具调用过程、嵌套关系和各工具的结果界面。 | ui-tool | `E:/deepseek-harness/packages/client/ui-tool/locale/zh.json`、`en.json` |
| ui-message-feedback | 消息反馈包元信息 | ui-message-feedback | `E:/deepseek-harness/packages/client/ui-message-feedback/locale/zh.json`、`en.json` |
| ui-attachment | 附件包元信息 | ui-attachment | `E:/deepseek-harness/packages/client/ui-attachment/locale/zh.json`、`en.json` |
| ui-deliverables | 交付文件包元信息 | ui-deliverables | `E:/deepseek-harness/packages/client/ui-deliverables/locale/zh.json`、`en.json` |
| locale | 通用字典包元信息 | locale | `E:/deepseek-harness/packages/client/locale/locale/zh.json`、`en.json` |

> 这些 `meta.*` 是语言包注册用的元信息，不是聊天正文，但用户可能在语言 / 包列表中看到，故列出。

---

## 第 6 章 样式与消息渲染管线

### 6.1 样式

- 组件样式：`ui-chat/src/client/**/*.module.css` + `ui-primitives/src/markdown/*.module.css`
- 主题全局样式：`ui-theme/src/styles/*`（含 `onboarding.css`、`shiki.css`）
- 代码块工具栏：`E:/deepseek-harness/packages/client/ui-primitives/src/CodeToolbar.tsx`

### 6.2 Markdown 渲染

| 文件 | 作用 |
|---|---|
| `ui-primitives/src/markdown/render.tsx` | 表格 / 引用 / 脚注 / 图片渲染（`renderTable`：宽表 `md-table-wide`、横向滚动） |
| `highlight.ts` | shiki 代码高亮（`E:/deepseek-harness/packages/client/ui-theme/src/styles/shiki.css`） |
| `useViewportHighlighting.ts` | 视口内代码块高亮优化 |
| `cjkFriendlyStrong.ts` | CJK 友好加粗边界规则 |
| `plain-text.ts` / `quote-text.ts` / `file-link.ts` / `local-image-syntax.ts` / `windows-path-destinations.ts` | 纯文本 / 引用 / 文件路径链接 / 本地图片语法 / Windows 路径兼容 |
| `MarkdownDelegate.tsx` | 链接文件 / URL / 图片菜单、打开文件、renderCode 回调 |
| `MarkdownText.module.css` | 表格、引用、脚注、图片等 Markdown 元素样式 |

### 6.3 公式与 fence 层

| 文件 | 作用 |
|---|---|
| `ui-primitives/src/markdown/katex.tsx` | KaTeX 公式渲染：Tex→React（strict/ignore/错误 span 三段容错），MathML + 可视 span |
| `mathCompatibility.ts` | 数学语法兼容处理（inline `$...$`、块级 `$$...$$` 与 mdast-math 对齐） |
| `copy-tex.ts` | 复制公式为 Tex 源码 |
| `diff-fence.ts` | diff 语言围栏解析与统一 diff 行构建 |
| `CHAT/fence/FenceLayers.tsx` | `MathFenceLayer`（流式显示源码、完成后显示 KaTeX 公式）与 `DiffFenceLayer`（diff/patch 统一 diff 行） |
| `CHAT/fence/register.ts` | 注册 math / diff / patch 三种 fence 层 |

> 结论：表格在 `render.tsx` 直接渲染；公式用 KaTeX（**无 mermaid**）；代码高亮用 shiki；图片经 `MarkdownDelegateProvider.fileImages` + `ui-attachment/MessageImage`。

### 6.4 Chat 侧渲染入口

| 文件 | 作用 |
|---|---|
| `CHAT/chat/AssistantMarkdown.tsx` | 把助手消息块交给 `MarkdownText`（text 块）、`ReasoningRow`（reasoning）、图片 slot、JsonBlock |
| `CHAT/chat/ChatView.tsx` | 在 `MarkdownDelegateProvider` 中注入 `renderCode`，把每个代码围栏派发到语言 keyed slot，默认 `FenceCodeBlock` |
| `CHAT/markdown-labels.ts` | 从 Chat locale 生成代码复制 / 脚注标签 |
| `apps/web/katex-fonts.ts` | Web 构建中 KaTeX 字体资源处理 |

### 6.5 E2E 测试佐证入口（行为证据，非源码主体）

- `apps/web/tests/chat-*.e2e.ts` 系列（`chat-scroll-contract.e2e.ts` 101KB、`chat-flow-layout.e2e.ts`、`chat-fold-opened-group.e2e.ts`、`chat-continuous-conversation.e2e.ts`、`chat-long-interactions.e2e.ts`）
- `apps/web/tests/code-card-layout.e2e.ts`、`clickable-links-gallery.e2e.ts`、`changed-files-turn.e2e.ts`
- `packages/client/ui-chat/tests/chat-view.client.spec.tsx`（231KB）、`conversation-node-definitions.client.spec.ts`（137KB）、`chat-scroll.client.spec.tsx`、`reasoning-row.client.spec.tsx`、`assistant-markdown-path-images.client.spec.tsx` 等约 70 个测试文件

---

# 第二篇 插件图标与内容的显示机制

> 核心结论：**图标走「全局 sprite + 主题替换 + 少量图标 slot」三条路，内容走「Cordis slot 注入系统」一条路，两者互不耦合。**

## 第 7 章 插件加载是前提

聊天页面本身不是一个「页面文件」，而是由一堆 Cordis 插件（client 包）在运行时拼装出来的。插件树在 `E:/deepseek-harness/packages/bundle/web-app/cordis.patch.yml` 声明，每个包的 `apply(ctx)` 在插件激活时执行，把图标和内容分别注册进对应的系统：

```
cordis.patch.yml（声明 ui-chat / ui-tool / ui-sidebar / ui-theme …）
  → 各包 apply(ctx)
      ├─ 图标 → 全局 artwork.ts + 主题 icons 替换 + contextMenu.icon 等图标 slot
      └─ 内容 → ctx.slots.register(...) 挂到 conversation.* / tool.call.* slot
```

与 DSH-IDE 的关系：DSH-IDE 作为 DSH 应用内的 bundle 插件，天然复用 `dshCtx`（位于 DSH Host 进程），直接接入上述同一套 slot / 图标 / i18n / 样式机制，不需要任何独立的图标或 UI 通道，也不新增第二套会话或协议。

## 第 8 章 图标显示机制：artwork → sprite → use

### 8.1 数据定义（artwork.ts）

`E:/deepseek-harness/packages/client/ui-primitives/src/icons/artwork.ts`：

```ts
interface IconArtwork {
  size: number                              // 默认渲染高度
  aspect?: readonly [number, number]        // 非方形的宽高比
  svg: (strokeWidth: number) => string      // SVG 源码，笔宽随字重变化
}
export const ICON_ARTWORK = {
  'new-chat-outline': { size: 16, svg: sw => `<svg viewBox="0 0 16 16" ...>...</svg>` },
  'search-outline':   { size: 16, svg: sw => `...` },
  ...
}
```

两个字重：`ICON_REGULAR_STROKE = 1`、`ICON_MEDIUM_STROKE = 1.3`。每个 glyph × 每个字重展开成一个 `ICON_SYMBOLS` 条目，symbol id 形如 `dsw-icon-new-chat-outline-regular`。

### 8.2 组件绑定（index.tsx）

`E:/deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx:17-25`：

```ts
function productIcon(glyph, weight) {
  const { size, aspect } = ICON_ARTWORK[glyph]
  const id = iconSymbolId(glyph, weight)        // → dsw-icon-<glyph>-<weight>
  return ({ size = defaultSize, className }) => (
    <svg width={...} height={size} className={className} data-icon={id} aria-hidden="true">
      <use href={`#${id}`} />                    {/* 引用 sprite 里的 symbol */}
    </svg>
  )
}
export const IconNewChatOutlineRegular = productIcon('new-chat-outline', 'regular')
export const IconNewChatOutlineMedium  = productIcon('new-chat-outline', 'medium')
```

所以 `Icon*Regular` / `Icon*Medium` 是**编译期具名组件**，不是运行时按字符串查表。size 默认取 artwork 定义，className 由调用方传入，`<use href="#dsw-icon-...">` 引用 sprite。

### 8.3 注入 sprite（icon-sprite.ts）

`E:/deepseek-harness/packages/client/ui-theme/src/client/icon-sprite.ts`（完整机制）：

```ts
const DROPPED_ATTRIBUTES = new Set(['width', 'height', 'xmlns', 'class', 'aria-hidden'])

function toSymbol(id, markup) {
  const root = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement
  const symbol = document.createElementNS(SVG_NS, 'symbol')
  for (const { name, value } of root.attributes)
    if (!DROPPED_ATTRIBUTES.has(name)) symbol.setAttribute(name, value)
  symbol.id = id
  symbol.append(...[...root.childNodes].map(node => document.importNode(node, true)))
  return symbol
}

export function installIconSprite(ctx, icons) {
  if (typeof document === 'undefined') return
  const sprite = document.createElementNS(SVG_NS, 'svg')
  sprite.setAttribute('aria-hidden', 'true')
  sprite.setAttribute('data-dsh-icon-sprite', '')
  sprite.style.cssText = 'position: absolute; width: 0; height: 0; overflow: hidden'
  const rendered = new Map()
  const markups = new Map()
  const apply = (replacements = {}) => {
    for (const [id, fallback] of Object.entries(ICON_SYMBOLS)) {
      const markup = replacements[id] ?? fallback
      if (markups.get(id) === markup) continue
      const symbol = toSymbol(id, markup)
      const previous = rendered.get(id)
      if (previous === undefined) sprite.append(symbol)
      else previous.replaceWith(symbol)          // 主题热替换
      rendered.set(id, symbol)
      markups.set(id, markup)
    }
  }
  apply(icons)
  ctx.effect(() => {
    document.body.prepend(sprite)                // 挂在 body 头部，隐藏
    return () => { sprite.remove() }             // 插件卸载时移除
  }, 'ui-theme: icon sprite')
  ctx.on('theme/change', snapshot => apply(snapshot.active.icons))
}
```

关键点：
- sprite 是隐藏 `<svg>`（`position:absolute;width:0;height:0;overflow:hidden`），`data-dsh-icon-sprite` 标记。
- `toSymbol` 把每个 SVG 转成 `<symbol id="dsw-icon-...">`，去掉 `width/height/xmlns/class/aria-hidden` 这些"单次渲染"属性，保留 `viewBox`、`stroke` 等几何属性。
- `theme/change` 事件到来时用 `replaceWith` 热替换 symbol，**无需刷新页面**。
- 插件 fiber 卸载时 `sprite.remove()` 清理。

### 8.4 显示的本质

组件里的 `<use href="#dsw-icon-xxx">` 引用隐藏 sprite 的 symbol，`currentColor` 和 CSS 变量在**使用点**生效——这就是图标能跟随主题变色的原因。

## 第 9 章 插件如何提供图标

| 方式 | 机制 | 实例 |
|---|---|---|
| **直接复用全局图标**（绝大多数） | `import { IconCopyOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'`，用编译期具名组件 | `ui-tool`、`ui-sidebar`、`ui-approval` |
| **注册图标组件到 keyed slot** | `ctx.slots.inject('contextMenu.icon', ...)`，key 为动作 id，value 为图标组件 | `ui-workspace`、`ui-file-actions`、`ui-open-in-app` |
| **面板类图标 slot** | `sidebar.panellist`（register 时直接传图标组件）、`sidebar.panel.icon`（factory）、`settings.section.icon` | `ui-plugin-manager`、`ui-schedule`、`ui-sidebar-right` |
| **主题替换已有 symbol** | `ThemeDefinition.icons` → `validateIcons()` 校验 → `theme/change` 触发 `apply()` 的 `replaceWith` | 第三方主题 |

### 9.1 插件注册自己的图标到 slot（实证）

`E:/deepseek-harness/packages/client/ui-file-actions/src/client/index.ts:31-36`：

```ts
child.slots.inject('contextMenu.icon', function* () {
  for (const [key, Icon] of Object.entries({
    'file-actions.copy': IconCopyOutlineRegular, 'file-actions.download': IconDownloadOutlineRegular,
    'file-actions.save': IconSaveOutlineRegular,
  })) yield child.slots.register({ name: 'contextMenu.icon', key }, Icon)
})
```

`E:/deepseek-harness/packages/client/ui-plugin-manager/src/client/index.ts:167-173`：

```ts
yield ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
  name: 'sidebar.panellist',
  id: PANEL_ID,
  order: 0,
  label: () => t('panel'),
  locale: NS,
}, PluginsPanelIcon))
```

其它实例：
- `E:/deepseek-harness/packages/client/ui-workspace/src/client/index.ts:325-333,337-342`（全局 Icon 注册到 `contextMenu.icon`）
- `E:/deepseek-harness/packages/client/ui-open-in-app/src/client/index.ts:64-70`；`context-menus.tsx:218-223`（动态 `<img>` 回退）
- `E:/deepseek-harness/packages/client/ui-sidebar-right/src/client/index.ts:138-139`（`sidebar.close` key）
- `E:/deepseek-harness/packages/client/ui-plugin-manager/src/client/PluginsPanelIcon.tsx:13-15`（panellist + 全局 Icon 包装）
- `E:/deepseek-harness/packages/client/ui-schedule/src/client/TaskManagerIcon.tsx:14-16`（同上）
- `E:/deepseek-harness/packages/client/ui-tool/src/client/apply.ts:30-57`；`tool/toolviews/details-row.tsx:30-38`；`GenericToolCard.tsx:19-25`；`search-row.tsx:2,27`（tool view 按数据选全局 Icon，无注册）
- `E:/deepseek-harness/packages/client/ui-approval/src/client/ApprovalWarning.tsx:5,85`（直接使用）

### 9.2 动态图标（按数据决定显示哪个）

| 组件 | 机制 | 绝对路径 |
|---|---|---|
| `FileTypeIcon` | 按文件扩展名直绘 SVG 类型徽标 | `E:/deepseek-harness/packages/client/ui-primitives/src/FileTypeIcon.tsx:49-112,138-148,156-170,198-285` |
| `LinkIcon` | URL 链接图标，`PhotoGlyph` 为内联图片字形 | `E:/deepseek-harness/packages/client/ui-primitives/src/LinkIcon.tsx:33-52,54-76,89-118` |
| `SiteGlyph` | 站点 logo，基于 `simple-icons` 数据表 | `E:/deepseek-harness/packages/client/ui-primitives/src/SiteGlyph.tsx:55-96,103-122,139-149` |
| `shared-artwork.tsx` | 复合图标共享轮廓路径 | `E:/deepseek-harness/packages/client/ui-primitives/src/icons/shared-artwork.tsx:13-46` |

### 9.3 主题替换接口（`ThemeDefinition.icons`）

`E:/deepseek-harness/packages/client/ui-theme/src/client/index.ts`：

- `ThemeDefinition.icons: IconReplacements` 是 `Readonly<Partial<Record<IconSymbolId, string>>>`（`icon-sprite.ts:12`）。
- `ThemeRuntime.register(definition)` 在 `:354-359` 校验并注册主题；`validateIcons(definition)` 在 `:525` 起校验图标替换：
  - 只接受已知的 `IconSymbolId`（未知 id 抛 `TypeError`）
  - 拒绝无 SVG 命名空间的 `<svg viewBox>` 之外的文档
  - 拒绝 `<style>` / `<script>`
  - 拒绝 symbol 自身命名空间之外的 element id
- 公开 API 目录佐证：`E:/deepseek-harness/packages/extensions/cordis-client-runner/src/client/api-catalog.ts:659-660,1072`（`IconReplacements`、`ThemeDefinition.icons`）；`E:/deepseek-harness/packages/client/ui-primitives/src/index.ts:65-70,129-133`（导出面）。

> **重要限制**：插件**不能新增 sprite symbol**。`ThemeDefinition.icons` 只接受已有 `IconSymbolId` 的替换，所以自定义图标只能是「换皮已有图标」或「注册自己的 React 图标组件到 slot」。

## 第 10 章 不走 sprite 的私有图标体系

- `FileTypeIcon`（`ui-primitives/src/FileTypeIcon.tsx`）：按扩展名直绘 SVG 类型徽标，与 sprite/换肤无关。
- `LinkIcon` + `SiteGlyph`（`LinkIcon.tsx`、`SiteGlyph.tsx`）：站点 logo 用 `simple-icons` 数据表直绘。
- `PixelWhale`（`ui-brand-official/.../PixelWhale.tsx`）：首页鲸鱼是 canvas 逐帧绘制，CSS 标记 `data-home-whale`。
- 内联 `<svg>`：发送箭头、停止方块、发送中 spinner、语音波形直接写在 `InputBar.tsx` 和 `VoiceInput.tsx` 里。

## 第 11 章 内容注入：Slot 系统

### 11.1 Slot 注册中心

`E:/deepseek-harness/packages/client/ui-renderer/src/client/registry.ts` 的 `SlotRegistry` 提供三类注册：

```ts
slots.register({ name, key/id/order, locale?, ... }, ReactComponent)  // 普通/keyed
slots.registerSlotChain(name, ...)                                    // 链式
slots.registerFactorySlot(name, ...)                                  // 工厂
```

React 侧由 `scoped-slots.tsx` 的 `renderSlot` / `renderSlotChain` / `renderFactorySlot` 在组件树里渲染。scoped 绑定会把 `ctx` 服务（如 `t`、`host`）自动注入组件 props（`scoped-slots.tsx:604-613`）：

```ts
if (entry.locale !== undefined) {
  const face = host.locale
  if (face === undefined) throw new SlotAssemblyError(...)
  kit['t'] = localeSeat(face, entry.locale)
}
```

Factory 同理（`scoped-slots.tsx:908-915`）。语言切换时 `useLocaleRevision` 让所有 outlet 重渲染（`scoped-slots.tsx:1333-1335`）。

renderer 侧安装：`E:/deepseek-harness/packages/client/ui-renderer/src/client/index.ts:30-63`；scoped bindings：`E:/deepseek-harness/packages/client/ui-renderer/src/client/bindings.tsx:14-70`。设计文档：`E:/deepseek-harness/packages/client/ui-slots/README.zh.md:28,48,58-66`。

### 11.2 keyed slot / factory slot 的派发

| Slot | 派发维度 | 注册例 | 派发点 |
|---|---|---|---|
| `conversation.chat.node` | 节点 `NodeKey`（user/assistant/tool/command/compaction…） | `ui-chat/.../register-node-renderers.ts:27-102` | `ui-chat/.../ChatNodeSeat.tsx:150-176` |
| `tool.call.toolview` | 工具名（`bash`/`read`/`web_search`…） | `ui-tool/.../toolviews/read-row.tsx:25-33` | `ui-tool/.../ToolCallTree.tsx:45-56` |
| `conversation.images.content` | Content Factory（按图片来源） | `ui-attachment/.../client/index.ts:23-29` | `MessageImages.tsx:28-34`（AssistantMarkdown 的 image slot） |
| `conversation.view` | 视图 tab | `ui-chat/src/client/apply.ts` | `ConversationSession` |

slot 类型声明：`E:/deepseek-harness/packages/client/ui-chat/src/client/contract/slots.ts:443-455`；`E:/deepseek-harness/packages/client/ui-tool/src/client/contract/slots.ts:15-41`；`E:/deepseek-harness/packages/client/ui-conversation/src/client/contract/slots.ts:199-217`。

### 11.3 以工具卡为例的完整链路

```
ui-tool apply()
  → slots.inject('tool.call.toolview', ...)
      → register({ key: 'bash' }, BashRow)
  → ChatView → ChatFlow → ChatNodeSeat 遇到 tool node
  → conversation.chat.node renderer → ToolCallTree
  → ToolCallTree 读 tool.name='bash'，renderSlot('tool.call.toolview', { key: 'bash' })
  → BashRow 被渲染，读 ctx 服务拿到状态并画卡片
```

### 11.4 插件生命周期与 ctx 服务

- patch 声明：`E:/deepseek-harness/packages/bundle/web-app/cordis.patch.yml`（:260-380）
- patch 组合：`E:/deepseek-harness/packages/boot/plugin-manager/src/index.ts:20-27`，`E:/deepseek-harness/packages/boot/app-boot/README.zh.md:69`
- 浏览器启动：`E:/deepseek-harness/packages/client/web/src/boot-client.ts:59-80`
- entry 创建：`E:/deepseek-harness/packages/client/modules/src/client/entries.ts:89-104,184-192`
- 模块系统：`E:/deepseek-harness/packages/client/modules/src/client/manifest.ts:1-29,41-45`，`system.ts:250-276`
- ui-chat apply：`E:/deepseek-harness/packages/client/ui-chat/src/client/apply.ts:79-83,89,225-249`
- ui-tool apply：`E:/deepseek-harness/packages/client/ui-tool/src/client/apply.ts:24-57`
- SlotRegistry 实现：`registry.ts:120-162,164-181,209-271,382-396,475-531,740-754`
- renderSlot 实现：`scoped-slots.tsx:72-158,591-673,1321-1509,1577-1591`

`ctx`（Cordis Context）通过 `ctx.provide('xxx', service)` 提供服务（如 `ui-file-actions` 的 `fileActions`），通过 `ctx.inject(['service1', ...], child => ...)` 声明依赖并拿到子 context，通过 `ctx.effect(fn, 'label')` 管理生命周期（返回 disposer）。

## 第 12 章 i18n 文本注入

`E:/deepseek-harness/packages/client/locale/src/client/index.ts` 的 `LocaleRuntime` 用 `Map<namespace, Map<locale, dict>>` 存储：

- `register(ns, {...})` 拒绝同一 `(ns, locale)` 重复注册（单一拥有者，`:420-422`），注册后 bump revision，让已挂载 outlet 取到新词典（`:425`）。
- `bind(ns)` 返回按 ns 缓存、身份稳定的 `t` 函数（`:460-467`）。
- `translate(ns, key, params)` 先查本 ns 的 fallback 链，未命中再查共享 `common` 命名空间，仍无则回显 key（`:470-478`）：

```ts
private translate(ns, key, params?) {
  const chain = this.fallbackChain(this.snapshot.active)
  const template = this.lookup(ns, key, chain)
    ?? (ns !== COMMON_NS ? this.lookup(COMMON_NS, key, chain) : undefined)
    ?? key
  ...
}
```

- `NS` 定义在包内 `locale.ts`（如 `ui-chat/src/client/locale.ts:4` 的 `export const NS = 'chat'`），slot 注册时带 `locale: NS`，渲染器自动注入 `t`。
- 类型层：`LocaleNamespaceMap` 由各包 `declare module` 合并（locale 的 `index.ts:43` 及其消费方），`PropsLocale<'chat'>` 之类别名把 `t` 约束到该 NS 的 key 联合。
- 注册实例：`E:/deepseek-harness/packages/client/ui-file-actions/src/client/index.ts:30` — `child.effect(() => child.locale.register('fileActions', { zh, en, ja, es, fr, de, ru, pt }), 'file actions: locale')`。
- 语言切换由 `useLocaleRevision` 触发所有 outlet 重渲染。

关键路径：i18n 运行时 `E:/deepseek-harness/packages/client/locale/src/client/index.ts:390-478,586-595`；`ui-chat/src/client/locale.ts`；`ui-chat/src/client/apply.ts:140-141`。

## 第 13 章 样式注入

### 13.1 构建期：CSS 变成模块 metadata

`E:/deepseek-harness/packages/client/tsdown.client.ts:1-15` 的 doc 说明：`x.module.css` 编译为哈希 class map；普通全局 CSS import（如 ui-theme 的 `styles/*.css`）不作为运行时 import，而作为该 chunk 的**延迟样式表文本**收进 metadata：

```
each output chunk exposes deferred stylesheet text through its metadata factory.
`x.css?inline` exports compiled text without registering a resource.
```

关键实现（同文件 `:517-523`）：

```ts
const resources = Object.keys(chunk.modules).flatMap(module => {
  const style = styles.get(module)
  ...
})
const metadata = resources.length === 0 ? '' : `, meta: () => ({ stylesheets: {${resources.join(',')}} })`
```

即打包产物调用 `window.__ModuleLoader__.load({ id, factory, meta })`，`meta()` 返回 `{ stylesheets: { [path]: { text(...) } } }`。样式按「拥有它的包 + 包内路径」命名（`:70-91` 的 `compiledClientStyle`）。

### 13.2 运行期：DocumentStyles 是文档样式的拥有者

`E:/deepseek-harness/packages/client/ui-renderer/src/client/styles/document-styles.ts:25-33`：

> Materialized module styles installed synchronously in the main document. Each style element carries `data-plugin` with the owning package and `data-path` with the stylesheet's path within that package.

`DocumentStyles.mount()` 订阅 `modules.subscribeModules` 并立即 `refresh()`（`:48-60`）；`refresh()` 把每个活跃 module record 的 `record.meta().stylesheets` 文本取出来（`:74-96`），按包 + 路径去重、按依赖顺序排序（`:98-153`），为每个样式创建 `<style data-plugin=... data-path=...>` 插入文档（`:155-188`）：

```ts
const element = this.container.ownerDocument.createElement('style')
element.setAttribute('data-plugin', owner)
element.setAttribute('data-path', path)
element.textContent = css
this.container.insertBefore(element, anchor)
```

挂载时机在 `UiRenderer.mount`（`renderer.ts:64-73`）：

```ts
mount(container: HTMLElement): () => void {
  const mounted: RendererMount = {
    styles: new DocumentStyles(container.ownerDocument.head, this.ctx.modules),
  }
  ...
  mounted.styles.mount()
  const root = mountApp(container, buildRenderApp({ ctx: this.ctx }))
```

即容器是 `document.head`，renderer 生命周期内拥有所有模块样式，卸载时 `styles.dispose()` 移除全部 `<style>`（`:97-113`）。

### 13.3 ui-theme 全局样式

ui-theme 的 client 入口 import 全部主题样式（`E:/deepseek-harness/packages/client/ui-theme/src/client/styles.ts:1-10`）：

```ts
/** Theme CSS is compiled into module resources; DPR presentation follows the plugin lifetime. */
import '../styles/base.css'
import '../styles/corner-shape.css'
import '../styles/design-platform.css'
import '../styles/focus.css'
import '../styles/onboarding.css'
import '../styles/scrollbar.css'
import '../styles/gradient-shadow-text.css'
import '../styles/shiki.css'
```

这些 import 经 13.1 的构建流程进入 ui-theme chunk 的 `meta().stylesheets`，再由 13.2 的 `DocumentStyles` 注入 `<head>`，`data-plugin="@deepseek-ai/dsh-client-ui-theme"`。此外 `installThemeStyles(ctx)`（`styles.ts:18-40`）按 DPR 在 `document.documentElement` 上设置 `--dsh-hairline-width` 之类的内联 CSS 变量，随插件 fiber 生命周期清理。主题运行时本身（`ui-theme/src/client/index.ts`）提供 token 覆盖与字体 / 外观设置行。

### 13.4 `.module.css` 与样式归属

组件里 `import css from './X.module.css'`（如 `ToolCallTree.tsx:7` 的 `import css from './ToolCallTree.module.css'`）由 lightningcss 编译为哈希 class map 直接内联进 JS（`tsdown.client.ts:5-8`），不进 `DocumentStyles`；`"stylesheet has no package owner"` 错误见 `:91`。全局 CSS 以「拥有者包 + 路径」为键，冲突时后者被拒并打印 console（document-styles.ts:142-146），保证「文档样式拥有者」语义清晰。

## 第 14 章 关键路径速查表

| 主题 | 绝对路径 |
|---|---|
| patch 声明 | `E:/deepseek-harness/packages/bundle/web-app/cordis.patch.yml`（:260-380） |
| patch 组合 | `E:/deepseek-harness/packages/boot/plugin-manager/src/index.ts:20-27`，`E:/deepseek-harness/packages/boot/app-boot/README.zh.md:69` |
| 浏览器启动 | `E:/deepseek-harness/packages/client/web/src/boot-client.ts:59-80` |
| entry 创建 | `E:/deepseek-harness/packages/client/modules/src/client/entries.ts:89-104,184-192` |
| 模块系统 | `E:/deepseek-harness/packages/client/modules/src/client/manifest.ts:1-29,41-45`，`system.ts:250-276` |
| ui-chat apply | `E:/deepseek-harness/packages/client/ui-chat/src/client/apply.ts:79-83,89,225-249` |
| ui-tool apply | `E:/deepseek-harness/packages/client/ui-tool/src/client/apply.ts:24-57` |
| SlotRegistry | `E:/deepseek-harness/packages/client/ui-renderer/src/client/registry.ts:120-162,164-181,209-271,382-396,475-531,740-754` |
| renderer 安装 | `E:/deepseek-harness/packages/client/ui-renderer/src/client/index.ts:30-63` |
| renderSlot 实现 | `E:/deepseek-harness/packages/client/ui-renderer/src/client/scoped-slots.tsx:72-158,591-673,1321-1509,1577-1591` |
| scoped bindings | `E:/deepseek-harness/packages/client/ui-renderer/src/client/bindings.tsx:14-70` |
| slot 类型声明 | `ui-chat/src/client/contract/slots.ts:443-455`；`ui-tool/src/client/contract/slots.ts:15-41`；`ui-conversation/src/client/contract/slots.ts:199-217` |
| node renderer 注册 | `E:/deepseek-harness/packages/client/ui-chat/src/client/chat/register-node-renderers.ts:27-102` |
| toolview 注册 | `E:/deepseek-harness/packages/client/ui-tool/src/client/tool/toolviews/read-row.tsx:25-33` |
| keyed 派发点 | `ui-chat/.../ChatNodeSeat.tsx:150-176`；`ui-tool/.../ToolCallTree.tsx:45-56` |
| Content Factory | `ui-attachment/.../client/index.ts:23-29`；`MessageImages.tsx:28-34` |
| i18n | `E:/deepseek-harness/packages/client/locale/src/client/index.ts:390-478,586-595`；`ui-chat/src/client/locale.ts`；`ui-chat/src/client/apply.ts:140-141` |
| 样式拥有者 | `E:/deepseek-harness/packages/client/ui-renderer/src/client/styles/document-styles.ts:25-188`；`renderer.ts:64-113`；`tsdown.client.ts:1-15,517-523`；`ui-theme/src/client/styles.ts:1-40` |
| 设计文档 | `E:/deepseek-harness/packages/client/ui-slots/README.zh.md:28,48,58-66` |
| 图标数据 | `E:/deepseek-harness/packages/client/ui-primitives/src/icons/artwork.ts` |
| 图标组件与 use | `E:/deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx` |
| sprite 注入与主题热替换 | `E:/deepseek-harness/packages/client/ui-theme/src/client/icon-sprite.ts` |
| 主题定义与图标校验 | `E:/deepseek-harness/packages/client/ui-theme/src/client/index.ts`（`validateIcons` :525） |
| 插件注册自己的图标 | `ui-file-actions/src/client/index.ts:31`、`ui-plugin-manager/src/client/index.ts:167` |

---

# 附录

## 附录 A 路径前缀表

本文表格中使用的路径前缀展开如下（均为绝对路径）：

| 前缀 | 展开的绝对目录 |
|---|---|
| `CHAT` | `E:/deepseek-harness/packages/client/ui-chat/src/client/` |
| `TOOL` | `E:/deepseek-harness/packages/client/ui-tool/src/client/` |
| `ATTACH` | `E:/deepseek-harness/packages/client/ui-attachment/src/` |
| `DELIV` | `E:/deepseek-harness/packages/client/ui-deliverables/src/client/` |
| `FEEDBACK` | `E:/deepseek-harness/packages/client/ui-message-feedback/src/client/` |
| `PRIM` | `E:/deepseek-harness/packages/client/ui-primitives/src/` |
| 其它 | 直接写完整绝对路径 |

## 附录 B E2E 测试佐证

以下测试文件在分析中作为「真实聊天页行为」的佐证被引用（非源码主体）：

| 测试文件 | 佐证内容 |
|---|---|
| `apps/web/tests/message-actions.e2e.ts` | 消息操作行（复制 / 分支 / 反馈）实际渲染验证 |
| `apps/web/tests/message-feedback.e2e.ts` | 点赞 / 点踩按钮验证 |
| `apps/web/tests/icon-skin.e2e.ts:10` | 明确引用 `dsw-icon-search-outline-regular` symbol id |
| `apps/web/tests/home-whale.e2e.ts:27,40` | 明确验证 `[data-home-whale]` canvas |
| `apps/web/tests/chat-scroll-contract.e2e.ts`（101KB） | 聊天滚动契约 |
| `apps/web/tests/chat-flow-layout.e2e.ts` | 聊天流布局 |
| `apps/web/tests/chat-fold-opened-group.e2e.ts` | 分组折叠 |
| `apps/web/tests/chat-continuous-conversation.e2e.ts` | 连续会话 |
| `apps/web/tests/chat-long-interactions.e2e.ts` | 长交互 |
| `apps/web/tests/code-card-layout.e2e.ts` | 代码卡片布局 |
| `apps/web/tests/clickable-links-gallery.e2e.ts` | 可点击链接画廊 |
| `apps/web/tests/changed-files-turn.e2e.ts` | 变更文件 turn |

## 附录 C 常见误解澄清

| 常见表述 | 源码真相 |
|---|---|
| 「已深度思考」 | 代码中不存在，实际是 `message.think` = **思考 / Think**（`ui-chat/src/client/locale.ts`） |
| 「思考中」 | 实际为进行态步骤文案 `message.stepProcess.thinking` = **正在分析请求 / Analyzing the request**（`ui-chat/src/client/locale.ts`） |
| 「复制代码」 | `code.copySource` = 复制代码 / Copy code（`ui-trajectory/src/client/locales.ts`） |
| 「生成图片」 | 代码中不存在该短语；图片相关文案为 `image.*` 系列（原图、查看原图、图片加载失败…）和 `image.sendFailed`（`ui-conversation/src/client/locales.ts`） |
| 「深度求索」 | 即 `chat.deepDiving` / `chat.deepDivingFor`（`ui-chat/src/client/locale.ts`），状态栏和底部运行提示 |
| Mermaid 渲染 | DSH 聊天页 Markdown **不含 mermaid**；公式用 KaTeX，代码高亮用 shiki |
| 独立 MCP 卡 / 图片生成卡 | 未发现独立命名的卡片；由通用 `GenericToolCard` / `read_image` / `DetailsRow` 承担 |

---

> **文档完**。本文为静态源码清点结果，所有需真机验证的 GUI 行为以用户实机观测为准；AI 不代跑 GUI、不模拟 DSH 会话、不以代码推断观测结论。


