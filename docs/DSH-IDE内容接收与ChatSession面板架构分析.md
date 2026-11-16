# DSH-IDE 内容接收机制与 Chat / Session 面板架构深度分析

> 基于当前代码树（`e:/DSH-IDE`）实际实现撰写，所有结论均给出 `文件:行号` 依据。
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
- `BLESSED_PACKAGES`（`:24-28`）：受信 DSH 包及 semver 范围（`@deepseek-ai/dsh-web-frontend` / `dsh-core` / `dsh-adapter`，均 `^0.2.2`）。
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
