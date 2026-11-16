# DSH core 内容进入桌面前端的全部入口分析

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
