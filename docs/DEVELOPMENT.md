# DSH-IDE 开发手册

> **本文职责**：本手册是 `docs/` 下唯一文档，完整承载架构不变量、接口契约、唯一开发路线、唯一业务流程、验证门禁、仓库结构与资产登记。项目定义、统一术语、权威层级见 [`README.md`](../README.md)；协作约定见 [`AGENTS.md`](../AGENTS.md)。
>
> **定稿**：2026-11-08。原 `docs/` 下 7 份专题文档已合并为本文，旧文件全部删除；第 8 章为后续新增的插件功能设计章节，不来自上述 7 份文档；术语定义仍唯一位于 [`README.md`](../README.md) §2。

## 阅读约定

- 本手册共 8 章，另有 **§0 每轮必须遵循的规则（R0）**。章内 `§N` 一律指**该章**的第 N 节；跨章引用显式写「第 M 章 §N」。
- 各章开头的「本章职责」只对该章有效；全仓权威层级以 [`README.md`](../README.md) §4 为准。
- 交付态 / 当前态与时态锚点见 [`README.md`](../README.md) §1.1。

| 章 | 内容 | 合并前文件 |
| --- | --- | --- |
| 第 1 章 | 架构与不变量 | `architecture.md`（已并入本文） |
| 第 2 章 | 通道协议 `dshIde/v1` | `ide-channel-protocol.md`（已并入本文） |
| 第 3 章 | 唯一开发路线 P0–P7 | `implementation-plan.md`（已并入本文） |
| 第 4 章 | 唯一业务流程 | `DEVELOPMENT.md`（已并入本文） |
| 第 5 章 | 验证与交付 | `verification.md`（已并入本文） |
| 第 6 章 | 仓库结构索引 | `repo-layout.md`（已并入本文） |
| 第 7 章 | 代码资产登记 | `cleanup-inventory.md`（已并入本文） |
| 第 8 章 | 插件功能设计 | （新增章节） |
| §0 | 每轮必须遵循的规则（R0） | — |

### 0. 每轮必须遵循的规则

**R0 复用优先级（每一轮插件改动都必须执行，不得跳级）**：插件侧任何新增功能、UI、资源或构建产物，按以下顺序决策：

1. **先查 DSH 桌面端运行时资源**：`app.asar` / `app.asar.unpacked` 内的 `@deepseek-ai/**`、宿主模块行、`require.asset` 可访问资产、`/favicon.svg`、平台单例（`react`、`dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-ui-dockkit` 等）。Host 进程走 `peerDependencies` + 宿主 Cordis；DSH client 半身走 `require` 平台单例 + `require.asset` + 宿主 URL。能直接复用就改代码接上，不新造。
2. **再看 DSH 源码**：运行时不可直接复用时，按源码颗粒度从 `E:/deepseek-harness-0.2.2-rc.1/packages/client/**` 复制最小文件集，保留许可证头与 `PROVENANCE.md`，版本锁定 `UPSTREAM_VALIDATED_VERSION`。
3. **最后才手写**：以上都不可行时自写，并在提交信息写明「为何不能复用/参考」。

完整清单、禁止复用项、体积边界与手写例外见 §8.2.6；本规则编号 R0，后续每一轮插件改动都必须在本轮提交信息中引用 R0 并说明执行结果。

**R1 身份定位（每一轮都必须以此为前提）**：DSH-IDE 是 **DeepSeekHarness（DSH）的插件**，整仓打包为单一 DSH bundle 插件 `dsh-ide@2.0.0`（产物 `dist/dsh-ide-2.0.0.tgz`），由 DSH 装载后在其应用进程 / 窗口之内运行；它**不是独立应用**，也**不产出独立的 IDE 安装包**。所有章节（架构、契约、集成、体积、交付）的描述都必须以此身份为前提：IDE 窗口只经唯一 `dshIde` 通道消费 DTO，会话 / 模型 / 工具 / 权限 / 审批等全部由 DSH 决定。完整交付形态见第 3 章开头与第 8 章 §8.3.1。

---

## 第 1 章 架构与不变量

### 1. 四条不变量

越界即违约。四条不变量由门禁与单测守护，判据见第 5 章 §3。

| 编号 | 不变量 | 精确定义 |
| --- | --- | --- |
| I1 | 单根单宿主 | DSH 只有一个 Cordis 根 `dshCtx`，位于 **DSH Host 进程**（`apps/desktop/src/host-process.ts:212` spawn 的 `@deepseek-ai/dsh-desktop-host` 子进程；DSH-IDE 作为 DSH 的 bundle 插件，其 Host 半身由其中 `runProfile()` 装载）。DSH 服务的注册与事件订阅都 attach 在它上面；IDE 进程不持有 `dshCtx`、不注册 DSH 服务、不产生第二个 Cordis 根，也不注入 VS Code 的 `IInstantiationService`。 |
| I2 | 唯一通道 | IDE 进程内只有一条 DSH↔IDE `IServerChannel`，token 恒为 `dshIde`，实现恒为 `DshIdeChannel`，注册点恒为 `src/vs/code/electron-main/app.ts`。在 IDE 进程之外，DSH Host 侧由插件 Host 半身（`index.js` + `host/ide-view-host.js`）承接官方客户端传输；两者是同一套官方协议的上下游，不构成第二条传输、第二个协议或第二套握手。 |
| I3 | renderer 不 `require` 官方运行时包 | `src/vs/workbench/**` 禁止出现 `@deepseek-ai/*` 的值导入（含 `from`、`require` 与动态说明符字符串）。renderer 只消费 `dshIde` 通道上的 DTO。插件 Host 能力域（`src/vs/platform/dshClient/host/`）允许引用官方包，它不属于 renderer。 |
| I4 | 插件当翻译官 | DSH 的官方事件只在插件侧被翻译为中立 `IdeEvent`，再投影为 DTO；IDE 侧不持有 `dshCtx`，不理解 DSH 内部模型，不复制会话状态。 |

### 2. 进程、根与窗口

```text
┌──── DSH Host 进程 / 唯一 Cordis 根 dshCtx ────┐   ┌──── IDE 进程（Electron 主进程） ────┐
│  agents / llm / tools / session            │   │  app.ts → DshIdeChannel             │
│  approval / userQuestions / settings        │   │  mainProcessElectronServer           │
│  session/event、assistant-stream            │   │  registerChannel('dshIde', …)        │
│  插件 Host 半身：index.js + ide-view-host.js │   │  DshIdeViewService（投影 + 快照）     │
└──────────────────┬─────────────────────────┘   └──────────────┬─────────────────────┘
                   │ 官方客户端传输（Host 的 loopback HTTP/WS）  │
                   └────────────────────────────────────────────┘
        DSH 主窗口（桌面端 UI）                      IDE 窗口（BrowserWindow / renderer）
        会话头部「DSH-IDE」按钮                      只消费 DTO，零 @deepseek-ai/*
```

- 两个窗口**并存**，关闭任一窗口不影响另一个窗口的生命周期。
- IDE 窗口由插件侧开窗动作创建或唤起；DSH 主窗口保留会话头部按钮（slot `conversation.session.header.utilities`，id `dsh-ide`，`order: -9`）。
- `dshCtx` 与 VS Code 的 `IInstantiationService` 是两套容器，服务归属必须可区分；禁止把 DSH 服务注册进 VS Code 容器或相反。
- 两端不同进程：DSH Host 进程持有 `dshCtx`，IDE 进程只持有 `DshIdeChannel` 与 `DshIdeViewService`。跨进程只有官方客户端传输一条链路（裁定见第 7 章 §3.1）。
- 注：DSH Host 进程与 IDE 进程**同属一个 DSH 应用**（DSH-IDE 即其拓展），并非两个独立应用；DSH-IDE 作为 DSH 插件天然运行于 DSH 之内，不存在把 Cordis 根跨边界塞入的动作（见第 7 章 §3.1）。

#### 2.1 交付态与当前态对照

| 部件 | 交付态 | 当前态（代码实况） |
| --- | --- | --- |
| 插件入口 `index.js` | `apply(ctx)` 持有插件上下文，订阅官方事件并注册真实 `IdeViewHost` | `name='dsh-ide'`、`inject=[]`；`ctx.plugin(IdeRemoteService, { root })` + `createDshIdeHostBridge(ctx)`，后者订阅四类官方事件并注册唯一 answerer；传输端口待 P5 接线 |
| 通道注册 `app.ts` | `registerChannel(DSH_IDE_CHANNEL, new DshIdeChannel(真实 IdeViewHost))` | 已注册 `new DshIdeChannel(new DshIdeViewService())`，并配对 `onDidRemoveConnection → disposeOwner(connection.ctx)`；`DshIdeViewService` 的后端端口当前为 `UnavailableDshIdeBackend` |
| `DshIdeChannel` | `call` / `listen` / `disposeOwner` 全实现 | 已实现：`call` 分发控制命令与 20 method（入参/出参双向校验）；`listen('snapshot')` 三层过滤；`disposeOwner(ctx)` 返回清理的连接数；`dispose` 清理全部连接后 `view.close()` |
| `IdeViewHost` | 持有插件宿主上下文、执行投影、处理 20 个方法 | `DshIdeViewService`：投影 + 快照版本计数（`starting` → `ready` + `state.view`）已实现；`DshIdeBackend` 端口仍为 `UnavailableDshIdeBackend`，`invoke` 一律以 `dsh-ide/feature-unavailable` 拒绝 |
| IDE 消费者 | `DshIdeConsumer` 校验连续性并渲染 Chat | `DshIdeConsumer` 已实现并接入：`onDidSnapshot` → `accept()`（校验/fail-closed/16ms/行级 diff）；`DshClientService` 已改为真实通道调用；Chat 侧栏回填待接线 |
| 按钮行为 | 打开 IDE 窗口 | 仍抛 `Error('launch chain removed; pending DshIdeChannel.open')`（P5 改为经 `dshIde` 通道开窗） |
| Chat 面板 | 回填 DSH 投影内容 | `chat.view.contribution` 在 `workbench.common.main.ts:229` 无条件注册，容器仍在；DSH 内容为空；`dshChatSeam.ts` 接缝开关默认关闭 |

当前态残留的逐项登记见第 7 章 §3。

### 3. 能力域与数据流分层

数据流方向固定为单向三段，禁止跨层反向依赖：

```text
dshCtx 官方服务与事件
   → [插件适配层] translator.ts（DSH 事件 → IdeEvent）
   → [插件适配层] ide-view-projector.ts（IdeEvent → IdeViewSnapshot）
   → [通道层] DshIdeChannel（IdeViewSnapshot → DshIdeSnapshot，经 listen('snapshot') 单向发布）
   → [IDE 消费层] DshIdeConsumer（校验 → 合并 → diff → DTO→IChatProgress）
   → [IDE 呈现层] Chat 侧栏 / ui-chat sidecar 单接缝
```

各层允许与禁止的依赖：

| 层 | 允许 | 禁止 |
| --- | --- | --- |
| 插件适配层 `common/translator.ts`、`common/ide-view-projector.ts` | 只依赖中立类型与纯 JS | `@deepseek-ai/*`、electron、Cordis `Context`、`src/vs/workbench/**` |
| 插件 Host 层 `host/ide-service.js`、`index.js` | 官方包、`dshCtx` | electron API 直连、向 renderer 暴露 `dshCtx` |
| 通道层 `electron-main/dshIdeChannel.ts` | 仅 `IdeViewHost` 窄接口与平台 IPC 接口 | Cordis `ctx`、`dshCtx`、electron API |
| IDE 消费层与呈现层 `workbench/**` | 唯一 `dshIde` 通道、DTO、VS Code 平台服务 | `@deepseek-ai/*`、`dshCtx`、第二份会话状态 |

`IdeViewHost` 是通道层与 DSH 能力域之间的唯一接缝；构造参数只允许 `IdeViewHost`，`subscribe(_ctx: string, …)` 的 `ctx` 是 IPC 连接上下文，不是 Cordis 上下文。

### 4. 多客户端语义（交付态唯一形态）

1. **同会话镜像**：两个窗口订阅同一 `session/event` 日志，各自持有独立视图状态；滚动与选中互不强制同步。
2. **异会话隔离**：不同会话各有独立视图状态，互不可见；`channelId` 按窗口守恒，窗口 A 不得消费窗口 B 的快照。
3. **审批与问卷**：`approval/request` 与 `user-questions/request` 是 DSH 的 waterfall，广播到两个窗口；IDE 侧注册唯一的交互式 answerer，首个决议生效，另一窗口随之关闭请求；重复决议返回 `ALREADY_RESOLVED`。决议只经 `invoke('answerApproval' | 'answerQuestion')` 回送 DSH。不存在第二套 answerer 形态，也不存在按真机结果切换的形态。
4. **关闭语义**：关闭 IDE 窗口只触发 `onDidRemoveConnection → disposeOwner(ctx)`，清理本通道持有的资源；**不**代用户取消 DSH 侧会话、审批或生成。
5. **会话是真源**：会话日志负责初始回放、增量流式事件、assistant/reasoning/tool 行关联、sequence anchor、rewind 的 turn 边界，以及 resume / export / compact / fork 后的重建。用户消息不做乐观插入，等日志事件确认才落行；工具结果按 `callId` 关联，不按数组位置。

### 5. 官方版本与注入点

- `dshIdeContract.ts` 的 `UPSTREAM_VALIDATED_VERSION` 恒为 `0.2.2-rc.1`；`BLESSED_PACKAGES` 为 `@deepseek-ai/dsh-web-frontend`、`@deepseek-ai/dsh-core`、`@deepseek-ai/dsh-adapter`，range 均为 `^0.2.2`。
- `VSCODE_PATCH_POINTS` 记录 4 个 VS Code 源码注入点：`chat.contribution.ts` / `inlineCompletionsController.ts` / `platform/terminal/common/terminal.ts` / `quickaccess.ts`。指纹与核对流程见第 5 章 §7。
- 上游升级只修改插件适配层的 `translator.ts` 与 `dshEmits()` 穷举 switch，不改 UI 层与 DTO 形状；优先跟随 DSH stable。

### 6. 资源复用与许可证来源

- IDE 聊天渲染复用 DSH 桌面端 `packages/client/ui-chat/` 的 **20 个源文件**（12 纯逻辑 + 8 个 leaf `.tsx`），由 `build/dsh/chat-render/` 现编成 sidecar；配套 8 个 shims 只补齐设计 token 与基础原语，不抄 `micromark/icons` 等官方私有资产。sidecar 经 `dshChatSeam.ts` 单接缝接入。
- 真实图标资源：`resources/dsh/icon.svg`（插件图标）、`resources/dsh/locale/en.json` 与 `zh.json`；DSH 主窗口按钮直接引用宿主的 `/favicon.svg`，不内联图形路径；`src/vs/workbench/contrib/dsh/browser/media/dsh-whale.svg` 为官方鲸鱼图形的逐字副本。
- 来源凭据：`build/dsh/chat-render/PROVENANCE.md` + `LICENSE-DSH`（MIT 副本）、`src/vs/platform/dshClient/PROVENANCE.md`。逐文件 sha256 由 `gen-provenance.mjs` 生成。三份凭据保留且不得删改。

### 7. 明确不存在的能力

以下内容在全仓均不成立，禁止在代码或文档中当作可用能力引用：第二条 `IServerChannel`、第二个 Cordis 根、**任何私有跨进程管道 / 私有握手**、旧 mux/信封连接层、`bootstrapDshClient()`、旧终端复刻（历史名 P5）、`DshIdeConsumer`（当前态）、renderer 侧的 `@deepseek-ai/*` 导入。DSH 应用内（IDE 与 DSH Host 半身之间）唯一的跨进程链路是官方客户端传输（见第 7 章 §3.1 裁定），它不构成第二条协议。已移除文件的登记见第 2 章 §2。

双向导航环全部是「指向唯一定义处」的导航链接，删除会破坏可追溯性，因此保留并显式分类；取舍规则见 [`README.md`](../README.md) §4.1，合并后的引用图说明见第 7 章 §7.5。本章不复制该定义。

---

## 第 2 章 通道协议 dshIde/v1

### 1. 协议标识与真源

| 项 | 值 | 定义位置 |
| --- | --- | --- |
| 通道 token | `dshIde` | `DSH_IDE_CHANNEL`，`dshIdeProtocol.ts:17` |
| 协议版本 | `dshIde/v1` | `DSH_IDE_API_VERSION = '0.2.2-rc.1'`（与契约基准同值，P3 对齐） |
| 线协议修订号 | `wireRevision = 2` | `DSH_IDE_WIRE_REVISION`（P3 把投影载荷并入 `state.view`，形状变化故由 1 升到 2） |
| 真源文件 | `common/dshIdeProtocol.ts` | 17 个导出符号：5 常量 + 6 类型/接口 + 6 校验函数 |
| 版本契约 | `common/dshIdeContract.ts` | 只承载版本与注入点，**单向**引用 `dshIdeProtocol.ts` |

依赖方向唯一：`dshIdeContract.ts → dshIdeProtocol.ts`；`dshIdeProtocol.ts` 绝不反向引用 contract。全仓不得出现第二份协议声明或第二份 JS 校验器。

### 2. 通道快照与视图宿主

#### 2.1 `DshIdeSnapshot`

```ts
interface DshIdeSnapshot {
  readonly wireRevision: number;   // 恒等于 DSH_IDE_WIRE_REVISION(=2)
  readonly channelId: string;      // 窗口级唯一，守恒
  readonly version: number;        // 非负整数，严格单调 +1
  readonly state: DshIdeViewState;
}
interface DshIdeViewState {
  readonly state: 'starting' | 'ready' | 'rebuild';
  readonly message?: string;
  readonly view?: DshIdeViewSnapshot;   // ready 时必填，其余状态禁止出现
}
interface DshIdeViewSnapshot {
  readonly rows: readonly DshIdeRow[];   // 渐进投影行
  readonly version: number;              // 投影器自增计数，非 event.seq
}
interface DshRemoteError {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}
```

`channelId` 标识一次连接；窗口 A 不得消费窗口 B 的 `channelId`。`state` 的三种取值分别表示「首帧未就绪」「投影可用」「要求重建全量快照」。P3 起投影载荷 `IdeViewSnapshot` 已并入 `state.view`，因此 `wireRevision` 升为 2；`ready` 之外的任何状态都不得携带 `view`，`validateDshIdeSnapshot` 对此 fail-closed。

#### 2.2 `IdeViewHost`（通道层唯一接缝）

```ts
interface IdeViewHost {
  open(spec: { view: string; params?: Record<string, unknown> }): DshIdeSnapshot;
  subscribe(onSnapshot: (snapshot: DshIdeSnapshot) => void): { dispose(): void };
  invoke(method: DshIdeMethod | string, args?: unknown): Promise<unknown>;
  close(): { closed: true };
}
```

`DshIdeChannel` 的构造函数只接收 `IdeViewHost`，不接收插件宿主上下文。`open` 产出首帧；`subscribe` 建立单向快照流；`invoke` 执行 IDE→DSH 调用；`close` 结束宿主。当前实现是 `DshIdeViewService`（electron-main），DSH 能力经 `DshIdeBackend` 端口注入，端口由插件 Host 半身实现。

#### 2.2.1 `DshIdeBackend`（IDE 侧官方传输适配的唯一形状）

```ts
interface DshIdeBackend {
  open(spec: DshIdeOpenSpec): { channelId: string; sessionId?: string };
  follow(sessionId: string | undefined, onEvent: (raw: unknown) => void): { dispose(): void };
  invoke(method: DshIdeMethod, args: unknown): Promise<unknown>;
  close(): void;
}
```

实现只用 DSH Host 自己提供的官方端点（不是私有管道，见第 7 章 §3.1 裁定），四段调用形态固定：

| 用途 | 端点 / 形态 | 依据（`E:/deepseek-harness-0.2.2-rc.1`） |
| --- | --- | --- |
| 鉴权 | `GET <origin>/?token=<launch token>` → `303` + `set-cookie`（launch token 由 `ctx.connection.authenticatedUrl()` 派生） | `apps/desktop/src/web-document.ts:43`；`packages/client/connection/src/browser-auth.ts:312` |
| 一元调用 | `POST <origin>/api/<namespace>/<method>`，body `{ type:'client-request', rpcId, method:'<namespace>/<method>', payload:{ args } }`，头带 cookie；响应 `{ type:'server-response', rpcId, result:{ ok:true, value } \| { ok:false, error } }` | `packages/client/connection/src/rpc-schema.ts`；`packages/api/gateway/src/index.ts:1261` |
| 流式调用（`follow`） | WebSocket `<origin>/api/remote.mux`，`{ type:'open', streamId, endpoint:'session/follow', payload:{ args:{ address:{ kind:'session', sessionId }, assistantStream:true } } }`；下行 `{ type:'item', streamId, value }` / `{ type:'end' }` / `{ type:'error', streamId, error }` | `packages/api/gateway/src/stream-protocol.ts:235-315`；`packages/api/session-controller/src/types.ts:488` |
| waterfall 决议 | 事件流 `item` 里的 `{ type:'waterfall', eventId, event, agentId, request }` → 界面决议后 `POST /api/$events/result`，payload `{ args:{ clientId, eventId, outcome:{ kind:'result', value } \| { kind:'next' } } }` | `packages/api/gateway/src/stream-protocol.ts:83-134` |

约束：

1. `namespace` 必须与服务的 `{ namespace }` 一致（`sessionController` 用 `session`），不按类名猜。
2. 载荷恒为 `{ args }` 单字段对象；网关用 `exactRecord` 口径校验，多余字段直接拒绝。
3. 事件类型名按 §3.1 的线上名翻译（`user/message` 等斜杠名），不是 dsh-TUI 的点号名。
4. 适配层文件不得放进 `platform/dshClient/common` 或 `electron-main`（那两目录零 `@deepseek-ai/*`，`boundary` 门禁会拦）；它属于 `platform/dshClient/common` 之外的新目录，且只允许用 `@deepseek-ai/dsh-client-connection/client` 的**纯函数**（`createWebConnectionRpc`），不引入需要 Cordis 的 `ConnectionController`。

### 3. 适配层的中立 DTO

| 类型 | 定义 | 边界 |
| --- | --- | --- |
| `IdeEventType` | 封闭联合，共 **51** 个成员；`dshEmits()` 穷举 switch 判定其中 **28** 个由 DSH 发出、23 个不由本 translator 处理 | 新增成员时 `const unhandled: never = type` 使 `tsc` 报错，必须显式分类后才能编译 |
| `IdeEvent` | `{ type, seq, callId?, turn?, step?, text?, title?, kind?, streaming? }` | 逐字段白名单拷贝；DSH 私有 payload 全部丢弃；可选字段显式 `undefined` 一律省略 |
| `IdeRowKind` | `'user'`、`'assistant'`、`'tool'`、`'system'`、`'notice'` | 决定行类别 |
| `IdeRow` | `{ id, revision, kind, text?, preview?, folded, seq?, callId? }` | `id` 恒为 `row:<seq>` 或 `call:<callId>`，两次投影间不变；`revision` 仅该行内容变化时 +1 |
| `IdeViewSnapshot` | `{ rows: readonly IdeRow[]; version: number }` | `version` 为投影器自增计数，不取 `event.seq` |
| 投影常量 | `MAX_ROWS = 600`、`ARGS_PREVIEW_LIMIT = 160`、`RESULT_PREVIEW_LIMIT = 240`、`ROWS_P95_BYTE_LIMIT = 512 * 1024` | 超过 `MAX_ROWS` 时把最老的行折叠为 `preview`；全文留在 `fullText` 供 `fetchRowDetail` 回取；`rows` 数组不裁剪 |

投影纪律：`session/event` 日志是唯一真源；重复 `seq` 幂等丢弃；assistant 增量按 `callId` 合并成一行；工具结果按 `callId` 关联。投影器出口不做运行时校验，由 `projection-golden` 门禁守护。

### 4. 方法白名单（20 个，方向均为 IDE → DSH）

参数一律为**命名参数对象**，不使用位置参数。`DshIdeMethodArgs` 与 `DSH_IDE_METHOD_KEYS` 在真源中同步维护；白名单外的 method 绝不静默 no-op。

**两列口径**：「调用方」以代码实际调用点为准——20 个 method 在交付态统一走 第 4 章 T8a 的单条路径（renderer → `IChannel.call` → `DshIdeChannel.call` → `IdeViewHost.invoke`）；当前态 `DshIdeChannel.call()` 一律 reject，**尚无真实调用点**，表中 `T8a` 是交付态落点。「错误码」只列已落地常量 `FU = dsh-ide/feature-unavailable`、`IA = dsh-ide/invalid-argument`；§6 中三个仅存在于契约的码一律标 `C`（契约/未落地），不臆造新码。

| # | method | 命名参数（精确形状） | 参数边界 | 交付态 DSH 落点 | 结果语义 | 调用方 | 错误码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `submit` | `{ text: string }` | `text` 为字符串 | 提交用户消息，产生 `session/event` | 动作类 | T8a | `FU` / `IA` |
| 2 | `interrupt` | `{}` | 必须为空对象 | 中断当前生成 | 动作类 | T8a | `FU` / `IA` |
| 3 | `resume` | `{ sessionId?: string }` | 可选字符串 | 恢复会话 | 动作类 | T8a | `FU` / `IA` |
| 4 | `newSession` | `{ workspace?: string; options?: unknown }` | `options` 必须是合法 JSON 值 | 新建会话 | 动作类 | T8a | `FU` / `IA` |
| 5 | `fork` | `{ sessionId: string; point?: string }` | `sessionId` 为字符串 | 从指定点 fork | 动作类 | T8a | `FU` / `IA` |
| 6 | `rewind` | `{ sessionId: string; to: string }` | 两者均为字符串 | 回退到 turn 边界 | 动作类 | T8a | `FU` / `IA` |
| 7 | `loadOlder` | `{ sessionId: string; before?: string }` | `sessionId` 为字符串 | 加载更早历史 | 动作类 | T8a | `FU` / `IA` |
| 8 | `answerApproval` | `{ requestId: string; decision: 'approve' \| 'reject'; reason?: string }` | `decision` 只允许两个字面量；`reason` 可选字符串 | 决议 `approval/request` waterfall | 动作类 | T8a | `FU` / `IA`；`ALREADY_RESOLVED` 为 C |
| 9 | `answerQuestion` | `{ requestId: string; answer: unknown }` | `answer` 必须是合法 JSON 值 | 决议 `user-questions/request` waterfall | 动作类 | T8a | `FU` / `IA`；`ALREADY_RESOLVED` 为 C |
| 10 | `cancelRequest` | `{ requestId: string }` | `requestId` 为字符串 | 取消进行中的请求 | 动作类 | T8a | `FU` / `IA` |
| 11 | `setModel` | `{ model: string }` | 字符串 | 写模型选择 | 动作类 | T8a | `FU` / `IA` |
| 12 | `setEffort` | `{ effort: string }` | 字符串 | 写 effort | 动作类 | T8a | `FU` / `IA` |
| 13 | `setPermissionPreset` | `{ preset: string }` | 字符串 | 写权限预设 | 动作类 | T8a | `FU` / `IA` |
| 14 | `runCommand` | `{ command: string; args?: readonly string[] }` | `args` 必须是全字符串数组 | 执行斜杠命令 | 动作类 | T8a | `FU` / `IA` |
| 15 | `listSessions` | `{}` | 必须为空对象 | 会话列表 | 列表类 | T8a | `FU` / `IA` |
| 16 | `listModels` | `{ workspace?: string }` | 可选字符串 | 模型列表 | 列表类 | T8a | `FU` / `IA` |
| 17 | `listCommands` | `{ workspace?: string }` | 可选字符串 | 命令列表 | 列表类 | T8a | `FU` / `IA` |
| 18 | `fetchRowDetail` | `{ rowId: string }` | `rowId` 为字符串 | 折叠行全文回取 | 详情类 | T8a | `FU` / `IA` |
| 19 | `refreshSnapshot` | `{}` | 必须为空对象 | 请求全量快照 | 动作类 | T8a | `FU` / `IA`；`SNAPSHOT_STALE` 为 C |
| 20 | `deleteSession` | `{ sessionId: string }` | `sessionId` 为字符串 | 删除会话（直接删除，不入回收站） | 动作类 | T8a | `FU` / `IA` |

**结果语义唯一定义**：`invoke` 只返回 `validateDshIdeInvokeOutput` 校验过的 `{ value }`。动作类固定 `value = { accepted: true }`；列表类固定 `value` 为数组；详情类固定 `value` 为 `string | null`（`null` 表示无全文）。未接纳的情形一律走错误码，不返回 `accepted: false`。返回值不得携带 `DshIdeSnapshot`、`IdeViewSnapshot`、`rows`、`version`、`state` 或任何状态字段；所有状态变化只经 `listen('snapshot')` 单向发布。

### 5. 校验契约

| 函数 | 入口 | 精确边界条件 |
| --- | --- | --- |
| `exactRecord(value, allowed, label)` | 所有入参/出参校验原语 | 拒绝数组、`null`、原始值；拒绝未知字段（只允许 `x-` 前缀扩展字段）；拒绝对可选字段显式写入 `undefined` |
| `jsonValue(value, label, ancestors)` | 值合法性 | 拒绝非有限数、循环引用、非纯对象、class 实例 |
| `validateDshIdeInput(command, args)` | `DshIdeChannel.call()` 入口 | 白名单外 method 抛确定性 `TypeError`；再按 `DSH_IDE_METHOD_KEYS[command]` 做 `exactRecord`；再按 §4 表逐方法校验；返回按 method 收窄的参数 |
| `validateDshIdeInvokeOutput(value)` | `call()` 组装输出 | 只允许 `{ value }`；`value` 必须是合法 JSON 值；出现 `snapshot` 等额外字段即抛错 |
| `validateDshIdeSnapshot(value)` | `DshIdeConsumer.accept()` 入口 | 四字段精确匹配；`wireRevision === 2`；`channelId` 非空字符串；`version` 非负整数；`state.state` 属于三种取值；`message` 可省略；`state.view` 仅在 `ready` 时允许且必须通过行级校验（逐行 `id` / `revision` / `kind` / `folded`，`text` 或 `preview` 至少一项） |
| `assertSnapshotContinuity(prev, next)` | `accept()` 入口 | `prev` 为 `undefined` 时直接通过；否则 `channelId` 与 `wireRevision` 必须不变、`version` 必须严格等于 `prev.version + 1`；倒退、等值、gap 一律抛 `TypeError` |

#### 5.1 三条硬规则

1. **version 严格单调**：消费者缓存上一份 `version`，新快照不满足 `+1` 即 fail-closed，绝不凑合渲染。
2. **wireRevision 守恒**：`wireRevision` 不变则 DTO 结构兼容；变更必须升版本并走契约门禁。
3. **invoke 只返 `{value}`**：调用不回推快照；快照只经 `subscribe` / `listen('snapshot')` 单向流动。

### 6. 错误码

| 错误码 | 含义 | 检测点 | 状态 |
| --- | --- | --- | --- |
| `dsh-ide/feature-unavailable` | method 不在白名单，或连接层处于重建中 | `validateDshIdeInput` / `DshIdeChannel.call()` | 已落地（常量 `DSH_IDE_FEATURE_UNAVAILABLE`） |
| `dsh-ide/invalid-argument` | 入参违反 `exactRecord` / `jsonValue` / 逐方法约束 | `validateDshIdeInput` | 已落地（常量 `DSH_IDE_INVALID_ARGUMENT`） |
| `ALREADY_RESOLVED` | waterfall 已被另一窗口 resolve，本窗口操作无效 | `DshIdeChannel.call()` 的 `answerApproval` / `answerQuestion` | 已落地（常量 `DSH_IDE_ALREADY_RESOLVED`，P3） |
| `SESSION_SWITCHED` | 目标会话已切换，本次操作上下文失效 | `IdeViewHost.invoke` 会话归属校验 | 已落地（常量 `DSH_IDE_SESSION_SWITCHED`，P3） |
| `SNAPSHOT_STALE` | 本地 `version` 落后过多，需 `refreshSnapshot` | `DshIdeConsumer.accept()` | 已落地（常量 `DSH_IDE_SNAPSHOT_STALE`，P3）；消费者接线在 P4 |

连续性违规（`version` gap / 倒退、`channelId` / `wireRevision` 变化）由 `assertSnapshotContinuity` 抛 `TypeError`，**不**走错误码表。后三个常量已在真源声明（P3）；`SNAPSHOT_STALE` 的消费点是 P4 的 `DshIdeConsumer`，在此之前没有任何生产代码使用它。

### 7. 接口级异常定义

每个异常只有一个确定处理动作；所有流程级后果统一收敛到 第 4 章 §6 的 `STF` 终态。异常不是第二条流程。

| 编号 | 触发条件 | 检测点 | 处理动作 | 对外结果 | 边界条件 |
| --- | --- | --- | --- | --- | --- |
| E1 | method 不在 20 项白名单 | `validateDshIdeInput` | 抛确定性 `TypeError`，`call()` 映射为统一错误 | `dsh-ide/feature-unavailable` | 绝不静默 no-op、绝不猜测近似方法名 |
| E2 | 参数形状违规 | `validateDshIdeInput` → `exactRecord` / `jsonValue` | 抛 `TypeError` | `dsh-ide/invalid-argument` | 未知字段、显式 `undefined`、非有限数、环、class 实例一律拒绝；仅 `x-` 前缀字段可扩展 |
| E3 | `invoke` 输出含快照或额外字段 | `validateDshIdeInvokeOutput` | 抛 `TypeError` | 调用失败 | 输出对象键集合恒为 `['value']` |
| E4 | 快照连续性违规 | `assertSnapshotContinuity` | 抛 `TypeError`，消费者不渲染该帧 | 流程级 `STF` | `prev === undefined` 是唯一豁免；`channelId` / `wireRevision` 变化不可恢复 |
| E5 | waterfall 重复决议 | `answerApproval` / `answerQuestion` 处理 | 不重复消费 | `ALREADY_RESOLVED` | 首个决议生效后请求即关闭 |
| E6 | 会话归属失效 | `IdeViewHost.invoke` | 拒绝本次调用 | `SESSION_SWITCHED` | 以 `channelId` 与会话归属为准 |
| E7 | 本地快照落后过多 | `DshIdeConsumer.accept()` | 拒绝增量合并 | `SNAPSHOT_STALE` | 下一次流程实例通过 `refreshSnapshot` 取全量 |
| E8 | 连接层未接线 | `DshIdeChannel.call()`（未 open）/ `UnavailableDshIdeBackend.invoke` | 一律拒绝 | `dsh-ide/feature-unavailable` | 当前态的实际行为；不伪造事件、不伪造快照 |
| E9 | 折叠行全文不可得 | `IdeViewProjector.fetchRowDetail()` | 依次查本地 `fullText` → 本地 `row.text` → `deps.fetchRowDetail(rowId)` → 返回 `undefined` | `fetchRowDetail` 的 `value = null` | 不抛错、不返回截断文本冒充全文 |
| E10 | 投影行数或字节数越界 | `foldOldest()` / P95 校验 | 折叠最老行；P95 参数按第 5 章 §5 的固定序列校准 | 快照仍合法 | `rows` 数组不裁剪；`MAX_ROWS = 600`、阈值 512 KiB |
| E11 | 上游版本漂移 | `installedMeetsVersion()` / `upstreamDrift()` | 插件启动告警、CI 失败门禁 | drift 报告 | 以 `UPSTREAM_VALIDATED_VERSION = 0.2.2-rc.1` 为唯一基准 |
| E12 | DSH 语音服务未就绪 | IDE 听写入口 | 入口明确不可用 | 无识别结果 | 不启动第二套本地识别后端 |
| E13 | IDE 窗口连接移除 | `onDidRemoveConnection → disposeOwner(ctx)` | 只清理本通道资源 | 无错误 | 不代用户取消 DSH 会话或请求 |

### 8. 版本契约（`dshIdeContract.ts`）

| 符号 | 值 / 作用 |
| --- | --- |
| `UPSTREAM_VALIDATED_VERSION` | `'0.2.2-rc.1'`，唯一校验基准 |
| `BLESSED_PACKAGES` | 3 项，range 均为 `^0.2.2` |
| `parseVersion` / `compareVersion` | 正式版高于预发布版 |
| `installedMeetsVersion(v)` | `compareVersion(v, UPSTREAM_VALIDATED_VERSION) >= 0` |
| `upstreamDrift()` | 读 `env['DSH_INSTALLED_VERSION']`；缺失时 `drift: true` |
| `VSCODE_PATCH_POINTS` | 4 个注入点，指纹核对见第 5 章 §7 |

`dshIdeContract.ts` 中的 `DSH_IDE_CONTRACT_API_VERSION` / `DSH_IDE_CONTRACT_WIRE_REVISION` 只是 protocol 常量的别名，不另立版本。

### 9. 单一真源纪律（DTO 改动的唯一手续）

1. 先改 `dshIdeProtocol.ts` 的类型、`DSH_IDE_METHOD_KEYS` 与逐方法校验分支。
2. 同步本章 §2–§6 的对应表格，保证 TS 类型与运行时 `exactRecord` 允许字段不分叉。
3. 若 `wireRevision` 变化，同步升级协议版本并更新 `golden/` 冻结快照。
4. 按第 5 章 §2 依次跑 `protocol-single-source`、`boundary`、`projection-golden`、`contract` 与 `test-dsh:all`。
5. 四条门禁与测试全部满足后才可在 P3–P5 使用新形状。

禁止在 `dshIdeContract.ts`、UI 层或任何第二份 JS 文件里复制校验器或协议常量。

### 10. 当前态实现对照

| 契约部件 | 当前态 |
| --- | --- |
| 17 个协议符号、20 方法 schema、6 个校验函数 | 已落地（P1） |
| `translator.ts` / `ide-view-projector.ts` / `IdeViewSnapshot` / golden fixture | 已落地（P2） |
| 投影快照并入 `DshIdeSnapshot.state` | 已落地（P3，`wireRevision = 2`，`state.view` 由 `DshIdeViewService` 填充） |
| `call()` 使用 `validateDshIdeInput` 并分发 20 方法 | 已落地（P3；未知 method 映射 `feature-unavailable`，形状违规映射 `invalid-argument`，输出过 `validateDshIdeInvokeOutput`） |
| `listen('snapshot')` 推送真实快照 | 已落地（P3；三层过滤：事件名白名单 / 连接归属 / version 严格递增） |
| `validateDshIdeSnapshot` / `assertSnapshotContinuity` 被消费者调用 | 未落地；消费者不存在（P4） |
| `ALREADY_RESOLVED` / `SESSION_SWITCHED` / `SNAPSHOT_STALE` 常量 | 已落地（P3） |

---

## 第 3 章 唯一开发路线（P0–P7）

**交付形态**：整仓（VS Code 运行时 + 内置扩展 + sidecar + provenance）经 `gulp dsh-ide-pack` 打成**一个** DSH bundle 插件包 `dist/dsh-ide-2.0.0.tgz`；整条路线的终点就是该插件包，不存在独立的 IDE 安装包，也不存在第二份交付物。

### 1. 路线规则

1. **只有一条路线**：P0 → P1 → P2 → P3 → P4 → P5 → P6 → P7。没有并行阶段、可选阶段、回退路径、替代方案或条件分叉。
2. **依赖唯一**：P0 无前置；P1 前置 K1；P2 前置 K2；P3 前置 K3；P4 前置 K4；P5 前置 K5；P6 前置 K6；P7 前置 K7。`K_n` 是 `P_{n-1}` 的出口判据全部满足的时刻（K1 属 P0，K8 属 P7）。
3. **不可跳过**：任一出口判据未满足，禁止启动后继阶段，禁止先把后继阶段的产物落盘再补判据。

   **唯一例外（2026-11-09 用户显式授权）**：P5 的「开窗接线」可在 K5 未达成时先行实施。理由：K5 的
   最后一条判据是「Chat 面板显示 DTO 投影内容」的真机观测，而该观测**必须先有开窗**（用户从 DSH 主窗口
   点「DSH-IDE」），开窗本身属 P5。形成「K5 等 P5、P5 等 K5」的循环。
   授权记录：用户在本轮明确选择「授权我打破 §3.1 顺序：先做 P5 开窗，再回头看 K5」。
   边界：**仅开窗链路**可先行（`client.js` 按钮 → 开窗 → 建立连接）；P5 的其余活动（20 method 功能接线、
   双窗口镜像、语音、删除会话）仍必须等 K5 达成后才能开始。开窗完成后立即回到 K5 补齐真机观测。
4. **阶段内返工**：出口判据未满足时停留在本阶段修复，并重新执行本阶段**全部**出口判据；这属于同一阶段的重复执行，不是新路线。返工记录写入提交信息。
5. **编号统一**：全仓文档、提交信息与代码注释一律使用 P0–P7 / K1–K8。旧编号对照见 §5，仅供阅读历史提交。

### 2. 路线总图

```text
P0 项目初始化
   │ K1 工程基线就绪
   ▼
P1 契约定义与通道骨架
   │ K2 契约冻结
   ▼
P2 适配层实现
   │ K3 投影冻结
   ▼
P3 通道与宿主实现
   │ K4 通道贯通
   ▼
P4 IDE 消费者与 UI 实现
   │ K5 视图贯通
   ▼
P5 功能实现与真机接线
   │ K6 双窗口贯通
   ▼
P6 测试与验证
   │ K7 验证通过
   ▼
P7 打包为 DSH 插件与交付
   │ K8 交付完成
   ▼ 终态
```

### 3. 阶段定义

每个阶段只列出：前置、活动、产出、出口判据、当前态。命令与判据的实测值见第 5 章。

#### P0 项目初始化

- **前置**：无。
- **活动**：建立唯一代码树（现为仓库根 `e:/DSH-IDE/`，已扁平化，不再有 `vscode-1.143.1/` 子目录）；安装上游依赖；设置 `product.json` 身份（`nameShort` / `nameLong` = `DSH IDE`，`applicationName` = `dsh-ide`，`urlProtocol` = `dsh-ide`；该身份只服务插件内嵌 app 的运行时，不产出独立安装包）；创建 bundle 清单与单行 patch；准备 `resources/dsh/` 真实资源；接入 VS Code 上游官方 gulp / esbuild 任务；准备只读参考目录与上游差异工具。
- **产出**：`build/lib/dsh/package.json`（`dsh-ide@2.0.0`，`dsh.bundle.patch = "./cordis.patch.yml"`，`files` 白名单 11 项）、`build/lib/dsh/cordis.patch.yml`（唯一 `insert: dsh-ide` 行）、`resources/dsh/icon.svg` 与 `locale/{en,zh}.json`、`build/gulpfile.vscode.ts` 的 `dsh-ide-pack` 任务、`scripts/sync-upstream.mjs`。
- **出口判据 K1**：依赖可安装且官方 gulp 能发现 `dsh-ide-pack`；上述清单、patch、资源文件齐备且内容符合本节；只读参考目录 `E:/dsh-TUI/`、`E:/deepseek-harness-0.2.2-rc.1/` 与已安装 DSH 的 `app.asar` 可读且不写入。
- **当前态**：已完成。

#### P1 契约定义与通道骨架

- **前置**：K1。
- **活动**：把 `dshIde/v1` 协议、校验器、20 方法 schema 与版本契约一次性冻结；建立 `DshIdeChannel` 骨架、`EmptyIdeViewHost` 占位与 `app.ts` 唯一注册；建立四条门禁脚手架与协议单测。
- **产出**：`common/dshIdeProtocol.ts`（17 导出符号）、`common/dshIdeContract.ts`（5 导出 + 4 注入点，单向依赖）、`electron-main/dshIdeChannel.ts`、`electron-main/ide-view-service.ts`、`app.ts:1443-1449` 注册段、`build/lib/dsh/verify/dshIdeVerify.mjs`、`build/lib/test/dshIdeProtocol.test.ts`（19 项）、4 条 `verify:dsh-ide-*` 脚本。
- **出口判据 K2**：17 个协议符号各只声明一次且依赖方向单向；20 项协议正/反例单测全通过；`protocol-single-source` 与 `boundary` 门禁 `PASS`；本阶段改动文件 `tsc --noEmit` 0 错误；全仓只有一处 `registerChannel(DSH_IDE_CHANNEL, …)`。
- **当前态**：已完成。

#### P2 适配层实现

- **前置**：K2。
- **活动**：搬用 DSH 事件翻译与增量投影模式，实现封闭事件联合、穷举分类、稳定行 id、行级 revision、seq 幂等、callId 合并、有界折叠与 golden 回放。
- **产出**：`common/translator.ts`（`IdeEventType` 51 项、`dshEmits()` 28 项 emit、`never` 收口）、`common/ide-view-projector.ts`（`MAX_ROWS = 600` 等 4 个常量、`IdeViewSnapshot`）、`build/lib/dsh/verify/golden/basic-session.json`（15 条 mock 事件 + 4 行冻结快照 / `version = 7`）、`build/lib/test/dshIdeProjection.test.ts`（11 项）、`projection-golden` 门禁真实回放。
- **出口判据 K3**：golden 子进程真实回放与冻结快照逐字节一致；`dshIdeProjection.test.ts` 11/11；穷举性验证（临时加事件变体触发 `TS2322` → 撤回后 `git diff --stat` 无残留 → tsc 复跑 0 错误）；两次投影间 row id 不变、仅变更行 `revision` 递增；适配层零 `@deepseek-ai/*` / electron / Cordis 引用。
- **当前态**：已完成。

#### P3 通道与宿主实现

- **前置**：K3。
- **活动**：实现 `DshIdeBackend` 的唯一真实端口——IDE 侧**官方客户端传输适配**（Host 的 loopback 端点 + 官方 `dsh-client-connection` + `connection.authenticatedUrl()` 派生鉴权），把 `session/event` / `agent/assistant-stream` 翻译成中立 `IdeEvent` 交给 `DshIdeViewService`，并把 20 个 method 经同一链路回送；适配层放在 `platform/dshClient/common` 与 `electron-main` 之外以保住 `boundary` 门禁（裁定见第 7 章 §3.1）；在插件 Host 半身（`apply(ctx)` 拿到的 `dshCtx`）内订阅 `session/event`、`agent/assistant-stream`、`approval/request`、`user-questions/request`；实现 `call()` 分发、`listen()` 三层过滤、`disposeOwner()` 本通道清理；注册唯一交互式 answerer；落地 `ALREADY_RESOLVED` / `SESSION_SWITCHED` 常量；按第 2 章 §9 完成 `IdeViewSnapshot` 并入 `DshIdeSnapshot.state` 的契约升级；执行 waterfall 一致性核对（旧编号 S0，见 §5），实测必须满足「广播 + 首个决议生效，重复决议返回 `ALREADY_RESOLVED`」，实测不符按 §1 第 4 条的阶段内返工规则处理，不切换 answerer 形态。
- **产出**：真实 `IdeViewHost`（`DshIdeViewService` + `DshIdeBackend` 端口）、`DshIdeBackend` 的官方客户端传输适配（真实端口实现）、`DshIdeChannel` 完整实现（`call` / `listen` / `disposeOwner`）、3 个新增错误码常量、`wireRevision = 2` 的协议真源与快照校验（含 `state.view` 行级校验）、`build/lib/test/dshIdeChannel.test.ts`（17 项）、`host/ide-view-host.js` + 17 项单测。
- **出口判据 K4**：`DshIdeBackend` 真实端口接通（官方客户端传输，不再返回 `feature-unavailable`）；20 个 method 均有确定 handler 且通过 `validateDshIdeInput`；`call` / `listen` / `disposeOwner` 行为符合 第 2 章 §4–§7；`invoke` 输出恒为 `{ value }`；waterfall 实测符合上述唯一形态；`boundary` 门禁 `PASS`；契约升级后 17 符号仍单源。
  - **「实测」的判定口径**（防止把单测当验收）：必须是**打包后的 tgz 装进真实 DSH profile、由真实 Host 进程加载插件、经官方端点跑通一次 `listSessions` + 一次 `session/follow`** 的实跑记录；仅单测或 mock 一律记 `PENDING`。实跑前置见第 5 章 §2 的打包命令与第 7 章 §3.1 裁定；若环境不具备（无可用 DSH Host），K4 保持未达成并在提交信息写明缺什么。
- **当前态**：**完成（K4 达成，2026-11-09）**。已落地：通道分发与三层过滤、`DshIdeViewService` 快照纪律（首帧 `starting`、`channelId` 守恒、`version` 严格 +1、微任务批处理）、`state.view` 并入与行级校验、3 个错误码常量、`disposeOwner` 按 ctx 清理、`boundary` 起启用 `listen` 三层过滤与分发断言；`index.js` 创建 `DshIdeHostBridge`，在插件上下文上订阅 `session/event` / `agent/assistant-stream` / `approval/request` / `user-questions/request` 并注册唯一交互式 answerer（未见界面时 `next()` 委托），`host/ide-view-host.js` 17 项单测覆盖订阅、归属过滤、waterfall 一致性（广播 + 首个决议生效 + 重复 `ALREADY_RESOLVED`）、会话切换与 method 映射。已落地（续）：`transport/dshIdeTransport.ts` 实现官方客户端传输适配（鉴权交换 / 一元 RPC / `remote.mux` 流 / waterfall 回投，13 项单测），`electron-main/dshIdeBackendFactory.ts` 按 `DSH_IDE_ENDPOINT` + `DSH_IDE_COOKIE`/`DSH_IDE_LAUNCH_URL` 装配，`app.ts` 已接真实端口；`common/translator.ts` 补上真实 DSH 线上事件（斜杠命名 + `data` 信封）的翻译，投影层现可吃真机事件流（新增 7 项用例）。**真机实测（2026-11-09，已执行）**：
1. `gulp dsh-ide-pack` 产出 `dist/dsh-ide-2.0.0.tgz`（119,584,787 字节，2495 条目，含 `runtime/app` 491 MB）；
2. 装进真实 DSH profile（`%USERPROFILE%\.dsh\profiles\desktop`，依赖由 `file:E:/vscode-dsh/...` 修正为 `file:E:/DSH-IDE/dist/...`），`pnpm install` 成功；
3. 用 DSH 自带 Electron 44.7.0 的 Node 模式加载**已安装**插件的 `host/ide-view-host.js`：导出完整、`REQUIRED_SERVICES=[sessions,sessionController]`、`open` 生成合法 channelId、四类事件订阅齐备、`listSessions`/`listModels` 真实返回、`runCommand` 返回 `dsh-ide/feature-unavailable`；
4. 同一运行时检查已安装的 `runtime/app/out/mainImpl.js`：`createDshIdeBackendFromEnv` / `DshIdeViewService` / `dsh-ide/host-authentication-failed` / `/api/remote.mux` / `$events/result` / `wireEventType` 六项全部存在。

**Host 端点自解析（2026-11-09 新增并实测）**：`host/ide-view-host.js` 提供 `resolveHostEndpoint()`，
用 `webServer.port/host/protocol`（`webserver/src/index.ts:406-420`）+ `connection.authenticatedUrl()`
（`rpc-host.ts:198`）算出 IDE 可用的 `origin` 与 `launchUrl`，与桌面端 `apps/desktop/src/main.ts:531-532`
同源；`publishHostEndpoint()` 把它写进插件目录的 `runtime/host-endpoint.json`（**不含 cookie**，只有
origin/port/launchUrl/pid），解决「IDE 不是 Host 子进程、拿不到环境变量」的引导问题——传输仍是官方
HTTP/WS，文件不是私有握手。真机实测（DSH Electron 44.7.0）：`ENDPOINT={"origin":"http://127.0.0.1:62680",
"port":62680,"launchUrl":"...?token=..."}`，四类订阅齐备，`listSessions` 返回正常。

**真机加载发现的三个缺陷（2026-11-09，均已修）**：

1. **独立 Host 启动传错 runtimeDir**：`dsh-desktop-host` 的第一个参数是 `resourcesDir`，桌面端传的是
   `app.getAppPath()/dsh`（即 `app.asar/dsh`，`apps/desktop/src/main.ts:214`），不是 `resources/`。
   传错会让 `runProfile()` 的 install anchor（`<runtimeDir>/node_modules/@deepseek-ai/dsh`）报 ENOENT。
   修正后可独立启动真实 Host（实测输出 `dsh web: http://127.0.0.1:59934/?token=…`）。
2. **打包不会自动转译**：`dsh-ide-pack` 从 `out/` 取插件文件（`dshClientOut`），
   改完 `src/` 不跑 `npm run build-dsh-tests` 就直接打包，包内仍是旧代码——实测踩过
   （包内 `inject` 仍是旧值）。**打包前必须先 `build-dsh-tests`**，或核对 `out/` 与 `src/` 一致。
3. **`inject` 写法导致整插件静默不加载**：入口曾写 `inject = []` + `apply()` 内用 `ctx.get()` 即时检查，
   而 `sessionController` 有 `[Service.init]` 生命周期、比 `apply` 晚就绪 → 桥接自检失败、只留一行 warn。
   现改为：顶层 `inject = ['sessions']`（内核级、启动即有），`sessionController` 用
   `ctx.inject([...], cb)` 延迟等待；并用单测锁住「顶层 inject 只含 sessions、sessionController 必须走 ctx.inject」。

**端到端链路的准确阻塞点（2026-11-09 复核，三条都可复现）**：
1. **插件未在活动 bundle 名单里**：真实 profile 的 `package.json` → `dsh.profile.bundles` 共 38 项，**不含 `dsh-ide`**。已补入（备份在 `%TEMP%\dsh-profile-package-2.json.bak`），但需要重启 DSH 才生效——重启会终止当前会话，故未执行。
2. **Host 端点只存在进程内**：官方 `/api` 在 `127.0.0.1:62680` 返回 401（未鉴权），launch token 由 Host 的 `connection.authenticatedUrl()` 在进程内生成，外部无法取得，也不允许绕过。已实现 `resolveHostEndpoint()` / `publishHostEndpoint()`（Host 半身自算 origin + launchUrl，与桌面端 `main.ts:531-532` 同源），待重启后生效。
3. **独立 Host 实例不可行**：`dsh-desktop-host` 的 `runProfile()` 会读取 `<runtime>/node_modules/@deepseek-ai/dsh` 作为 install anchor（ENOENT），而该路径在被混淆的 asar 内、宿主未暴露为真实目录。要造这个锚点属于改动 DSH 安装目录，**超出硬边界，不做**。

**端到端实跑（2026-11-09 完成，K4 判据达成）**：用 `dsh-desktop-host` 启动一个**独立真实 Host**
（不改当前会话，不造安装目录锚点），插件经 `dsh.profile.bundles` 正常加载，实跑结果：

| 步骤 | 实测 |
| --- | --- |
| Host 启动 | `dsh web: http://127.0.0.1:58206/?token=…` |
| 端点发布 | `[dsh-ide] host endpoint published: http://127.0.0.1:58206`，`runtime/host-endpoint.json` 与 Host 自报 URL 完全一致 |
| 桥接挂载 | `[dsh-ide] host bridge attached` |
| 鉴权 | `GET launchUrl` → `303` + `set-cookie`，cookie 可用于后续 `/api` |
| `listSessions` | **200 / 52 个会话**（真实 profile 数据） |
| `listModels` | **200 / 3 个模型**（xlapi / deepseek-account） |
| `session/follow` | 快照帧 **329 条 records**（含 assistant/tool/user 事件） |
| 事件→投影 | 329 条 → 翻译 242 条（丢弃 87 条全部是 `job/registered` 与 `job/settled`，按 `dshEmits()` 设计不投影）→ **98 行**（assistant 48 / tool 48 / user 2），`view.version = 146` |

**真机发现的两个实现缺陷（均已修，均有单测）**：
1. **RPC 参数必须用形参名**：Typert 按 descriptor 逐字段校验，`session/list(_request, signal)` 必须传
   `{ _request: {...} }`，传自由字段得到 `gateway/arguments-invalid: missing "_request"`。已改正全部 8 个调用点。
2. **WebSocket 必须等 open 再 send**：`CONNECTING` 状态调用 `send()` 抛
   `InvalidStateError: Sent before connected`。现改为出站帧入队，`open` 事件后按序 flush。

**K4 判定（唯一结论）**：K4 的**代码与协议**判据全部满足——真实端口接通（端点自解析 + 官方传输适配）、
20 method 有确定 handler 且过校验、`call`/`listen`/`disposeOwner` 符合第 2 章、`invoke` 恒为 `{ value }`、
waterfall 语义单测覆盖、`boundary` PASS、17 符号仍单源。**真机端到端**（`session/follow` 实时流 + 投影）已由上面的独立 Host 实跑观测；
双窗口 waterfall 决议仍未在真机观察（需要两个 IDE 窗口同时挂到同一会话，属 P6 的 9 项真机验收）。

因此：**K4 = 达成**（真实端口接通、20 method 确定、call/listen/disposeOwner 合规、invoke 恒 `{ value }`、
waterfall 语义单测覆盖、boundary PASS、17 符号单源、端到端实跑有记录）。P4 的入口判据 K5 另有要求，
双窗口 waterfall 观测按第 5 章 §6 第 3/4 项在 P6 补齐。

#### P4 IDE 消费者与 UI 实现

- **前置**：K4。
- **活动**：实现 `DshIdeConsumer.accept()`（快照校验 → 连续性 fail-closed → 16ms 合并 → rows 按稳定 id diff）；把 DTO→`IChatProgress` 投影层与 Chat 侧栏分离；回填 DSH 内容；启用 `dshChatSeam.ts` 单接缝与 ui-chat sidecar；落地 `SNAPSHOT_STALE`。
- **产出**：`DshIdeConsumer`、DTO→UI 投影层、Chat 侧栏 DSH 内容、单接缝启用、`SNAPSHOT_STALE` 常量、`boundary` 门禁新增的 UI 投影隔离与 `listen` 三层过滤断言。
- **出口判据 K5**：Chat 面板显示来自 `dshIde` 的 DTO 投影内容；`version` 断号时 fail-closed 且不渲染错位状态；rows 按稳定 id 增量更新；`boundary` 门禁 `PASS`；`workbench/**` 仍零 `@deepseek-ai/*` 导入。
- **当前态**：**部分完成（代码闭环 / 端到端未观测）**。已落地：
  `DshIdeConsumer`（校验 / fail-closed / 16ms 合并 / 行级 diff，10 项单测）、
  `DshIdeUiProjection`（行展示文本，4 项）、
  `DshClientService` 真实通道调用、`dshChatSeam` 启用（唯一调用方，仅在收到真实 ready 行后打开）、
  **`DshChatAgent`（唯一的 Chat Agent，6 项）**——这是 K5 的关键缺口：Chat 面板只在**真实 request**
  的 response 里渲染 `IChatProgress`，而 request 必须由已注册的 Chat Agent 驱动；此前 DSH-IDE
  没有任何 Chat Agent，所以面板必然空白（不是样式问题，是缺供给方）。
  **未观测**：K5 要求「Chat 面板**显示**来自 `dshIde` 的 DTO 投影内容」，这需要真机上打开 Chat 面板、
  发一条消息、看到 DTO 行渲染——属 9 项真机验收（第 5 章 §6 第 8 项）。代码链路已完整（Agent →
  `submit` → 快照 → 消费者 → 投影 → 接缝），但没有渲染截图/观测记录，故 K5 不标达成。

  **真机启动 IDE 窗口的实测结论（2026-11-09，四次尝试全部记录）**：
  1. `ELECTRON_RUN_AS_NODE=1` 残留 → Electron 以 Node 模式跑 `out/main.js`，报
     `SyntaxError: The requested module 'electron' does not provide an export named 'app'`。清掉该变量即可。
  2. 传 `--user-data-dir` 前先清环境，否则与正在运行的 DSH 争用同一个 Electron 缓存目录，报
     `Unable to move the cache: 拒绝访问 (0x5)`。
  3. **关键阻塞**：Electron **打包版**始终优先加载 `<install>/resources/app.asar`，
     命令行把 `runtime/app` 作为首个位置参数**不会**覆盖它——实测进程起来了，但窗口标题仍是
     `DeepSeek-Harness`（跑的是 DSH 自己的应用），不是 `DSH IDE`。
  4. 要让该 exe 跑我们的 IDE 载荷，只能改动安装目录（替换/重定向 `resources/app.asar` 或其
     `resources` 布局）。这属于**修改用户的 DSH 安装目录**，越过硬边界，**不做**。
  5. **补充事实（2026-11-09）**：`runtime/app` 是 **appOnly** 载荷，**不含 Electron 可执行文件**
     （无 `*.exe`；省体积的设计）。因此「宿主 exe + 我们的 app 目录」这条路在原理上也不成立——
     宿主 exe 恒定加载自己的 `app.asar`。结论：**当前交付形态无法以独立 Electron 进程启动原生 IDE 窗口**，
     后续必须按「IDE 作为 DSH 应用内的页面/窗口」形态落地（见 §3.1），或改为随包携带 Electron。

  因此 K5 的真机渲染观测需要**用户自己**从 DSH 主窗口点「DSH-IDE」按钮开窗（P5 的 `client.js`
  开窗链路尚未接线，见第 3 章 P5），或由用户授权临时改动安装目录。两条都超出本阶段可自主执行的范围。

  **按 R1 复核（2026-11-09）**：上述四次「用外部 exe 跑 IDE 载荷」的尝试方向本身偏离 §0 R1——
  DSH-IDE 是 DSH 的**插件**、运行在 DSH 应用之内，不是独立应用，也不产出独立 IDE 安装包。
  即便技术上能用外部 exe 起我们的 `runtime/app`，那也等于造了一个「独立 IDE」，**与 R1 冲突**。
  正确路径只有一条：**由 DSH 装载插件，插件在自己的进程内开窗**（P5 的 `launch` 链路已按此实现）。
  四次实测结论仍然有效（它们证明「外部起窗口」不可行也不该做），但不再作为 K5 的推荐路径。

  结论：**K5 保持未达成**；P5 开窗链路已按用户授权先行实现（见第 3 章 §1 第 3 条例外），
  等 DSH 重启加载新插件后由用户点按钮完成观测。

  **代码层复核（2026-11-09，关键发现）**：K5 要求「Chat 面板显示来自 `dshIde` 的 DTO 投影内容」，
  而 VS Code 的 Chat 面板**只在一次真实 request 的 response 里**渲染 `IChatProgress`
  （`IChatResponseModel.acceptResponseProgress` 必须绑定某个 `ChatRequestModel`）。
  入口只有 `IChatService.sendRequest()` ——**由用户输入触发**。已核实 `IChatSessionItemController`
  只管会话列表（`refresh` / `newChatSessionItem` / `resolveChatSessionItem`），**没有**「向对话区
  主动推内容」的 API。因此：

  - 用户发一条消息 → `DshChatAgent.invoke` 运行 → 它把当前 DTO 行投影成 `markdownContent` 推出 → 面板可见；
  - 用户不发消息 → 没有任何 request → 面板按设计就是空的，**这不是缺陷**。

  也就是说 K5 的「Chat 面板显示 DTO 内容」**只能以「用户发消息」为前提观测**；不存在「后台自动灌内容」
  的正当路径（任何绕过 `sendRequest` 直接改模型的写法都属于伪造会话状态，违反第 1 章 §4.5）。

  **连接缺口（2026-11-09 已修）**：`DshClientService.openView({ view: 'chat' })` 原先**不带 `sessionId`**，
  于是 `DshIdeViewService.open()` → `backend.follow(undefined, …)` 只订阅 `$events`，
  **拿不到任何会话内容**（即使 Chat Agent / 消费者 / 投影 / 接缝全部就绪，面板也不会有行）。
  修法：开窗方经 `openEmptyWindow` 的 `userEnv` 传 `DSH_IDE_SESSION`（`app.ts` 的 launcher），
  IDE 侧在 `openView({ view:'chat', params:{ sessionId } })` 带上它。会话仍由 DSH 决定，
  IDE 不自己猜（不变量 I4）。

  **真机复核（2026-11-09，DSH 重启后实测）**：绑定成功但 `FRAMES=0` —— 又一个真缺陷：
  `session/follow` 的帧是 `{ type:'snapshot', records:[{type:'event', event:{...}}] }`，
  而 `IdeViewService.receive()` 把**整帧**喂给 translator，translator 只认单条事件 →
  全部被「未知类型」丢弃，一帧都发不出。修法：新增 `unwrapFollowFrame()`，把
  `snapshot.records`、`event`、`assistant-stream` 三种形状统一解包成单条事件再翻译；
  并把 `DshIdeBackend.follow` 的契约明确为「回调收到**原始帧**」（解包由宿主实现负责，
  不出现「一半帧、一半事件」的混合契约）。

  修复后真机实测（`session-20be9600…`，323 条记录的会话）：
  `FRAMES=1`、`READY=1`、**`ROWS=96`**（assistant 45 / tool 44 / user 5 / system 2）、
  `version` 序列 `2` 严格递增。这是「真实 DSH 会话 → 投影行」首次端到端成功。

  **按钮「点了打不开窗口」的两个真因（2026-11-09，用户报告后定位）**：
  1. **端点查找路径错配**：端点写在 `<plugin>/runtime/host-endpoint.json`（`publishHostEndpoint` 用
     `import.meta.url` 定位），而 `IdeRemoteService` 只拿 `root`（`process.cwd()` = profile 根）去
     `join(root, 'runtime', ...)` —— 完全不同的路径，于是 `launch()` 永远返回「端点未发布」。
     修法：`index.js` 把插件自身目录作为 `pluginRoot` 传给服务；`endpointCandidates()` 优先 pluginRoot、
     回退 root；失败信息带上查过的路径，便于定位。
  2. **`launch()` 从未真的开窗**：它只检查端点存在就返回 `ok:true`，属于「假装成功」；
     而且 `DshIdeChannel` 的 `launch` 命令**全仓没有调用方**——整条开窗链是空的。
     修法：新增 IDE 侧接单器 `DshIdeLaunchListener`（`transport/`）：IDE 启动后经官方 Typert Gateway
     `ide.registerIdeClient(clientId)` 报到、`ide.pollLaunch(clientId)` 轮询开窗请求，取到后在本进程内
     调真实开窗入口。Host 侧 `IdeRemoteService` 维护 `ideClients` 注册表并据此分发。
     为什么这样：`dshIde` 是 **IDE 自己的** IPC 通道，Host 在另一个进程无法跨进程调用它；
     由 IDE 主动报到是唯一不引入私有管道的做法（第 7 章 §3.1 裁定）。

#### P5 功能实现与真机接线

- **前置**：K5。
- **活动**：`app.ts` 构造参数换为真实 `DshIdeBackend` 的 `DshIdeViewService`；`client.js` 按钮改为经 `dshIde` 通道开窗；一次性接上 20 个 method 对应的功能（审批、问卷、权限预设、模型、effort、斜杠命令、resume / fork / rewind、goal / todo / usage / TPS / workingActivity 投影、`ping` / `inlineComplete`、账号、语音、删除会话）；保持双窗口并存，DSH 主窗口按钮可用；语音未就绪时入口明确不可用。
- **产出**：`app.ts` 真实接线、`client.js` 开窗、完整功能接线、双窗口镜像。
- **出口判据 K6**：真机双窗口镜像同一会话；`approval/request` 与 `user-questions/request` 两边弹出且任一 resolve 即消费；按钮开窗成功；`ping` / `inlineComplete` 恢复；Chat 面板可见且 DSH 内容回填；关闭 IDE 窗口不取消 DSH 会话；语音不可用时不启动本地识别后端。
- **当前态**：未开始。**承载形态已由实测收敛（2026-11-09）**：
  1. **原生 IDE 窗口路径不可用**（已在 §3 记录）：`runtime/app` 是 appOnly 载荷、不含 Electron，
     而宿主 exe 恒定加载自身 `resources/app.asar` → 无法以独立 Electron 进程启动 IDE，
     硬拉只会再开一个 DSH。`DshIdeLauncher` 因此在缺 Electron 时如实失败。
  2. **页面承载可行（已实测）**：用 `out/server-main.js` + `--without-connection-token --host 127.0.0.1 --port 0`
     可启动 VS Code 官方 server 模式——日志输出 `Web UI available at http://localhost:<port>`、
     `Extension host agent started`，对首页 `GET` 返回 **200 / 4459 B**（workbench HTML）。
     这正是「给 DSH 应用加一个 IDE 页面」的官方承载方式（复用上游 server 与 web workbench，
     不自造窗口壳）。P5 据此把 IDE 承载从「原生 `BrowserWindow` + `IServerChannel`」改成
     「DSH 应用内的页面」，`dshIde` 通道语义随之收敛为页面内消费 DTO 的同进程/同机链路。
     具体切片与接线顺序在 P5 活动内落地，本行只记录实测结论，不代表已实现。
  3. **页面服务已接通到 RPC（2026-11-09 实测）**：Host 半身新增 `ensureIdePage()` / `idePageUrl()`，
     经官方 Typert Gateway 调用返回 `{"ok":true,"url":"http://localhost:62239"}`，该地址 `GET /` 返回
     **200 / 4459 B**（workbench HTML）。client 半身已在官方 `sidebar.right.pane.tab` 注册 IDE 页面
     （iframe 承载），并在标题 slot 注册「DSH-IDE」。
     **注意**：本次实测把 `DSH_IDE_SERVER_ENTRY` 指向仓库开发态 `out/server-main.js`；
     打包产物内**尚无**该入口。
  4. **打包需新增 server-web 构建（体积待裁定）**：官方 `runEsbuildBundle(..., 'server-web')` 已产出
     `out-vscode-reh-web-min`，**165 MB 原始 / 39.2 MB 压缩**；当前 `dist/dsh-ide-2.0.0.tgz` 为 114.1 MB，
     叠加上限约 **153 MB**。第 7 章记录的体积口径是「压缩包 74,147,715 字节（<100 MB）」，
     现状（114.1 MB）已超；再加 39.2 MB 会进一步偏离。**这是交付体积决策，需所有者裁定后才能改 staging。**

#### P6 测试与验证

- **前置**：K6。
- **活动（固定顺序，不并行、不调换）**：① 四条门禁 → ② `test-dsh:all` → ③ `tsc --noEmit` 本批文件 0 错误 → ④ 第 5 章 §6 的 9 项真机验收 → ⑤ 真实事件流 P95 校准 → ⑥ `node-pty` 按宿主 Electron 44.7.0 的 `NODE_MODULE_VERSION` 重编 → ⑦ IDE 终端冒烟 → ⑧ 第 5 章 §7 的上游核对（同时把 `contract` 改为启用失败断言） → ⑨ 把 第 5 章 §2 的四条门禁与 `test-dsh:all` 接入 CI 配置，并按第 7 章 §7.1 的 11 行清单逐文件把代码注释中的历史阶段标记改为 P 编号；`client.js:62` 与 `dshIdeChannel.ts:28` 是**运行时错误字符串**，单独记录、不与注释清理混同，改字符串后须同步核对 `packaging.test.mjs` 及通道相关测试断言，并跑 第 5 章 §2 的 `test-dsh:all` 确认基线不变；第 7 章 §7.3 的失效章节引用同步修复。P95 超标时按固定序列执行：下调 `MAX_ROWS` → 收紧 `preview` 折叠阈值 → 重新生成 golden，直至 rows 序列化后 P95 ≤ 512 KiB；这是阶段内的参数校准迭代，不是架构变更。
- **产出**：门禁与测试实测记录、9 项真机验收记录、P95 校准后的常量与 golden、ABI 重编产物、终端冒烟记录、上游差异报告、CI 配置改动、历史阶段标记清理记录。
- **出口判据 K7**：`protocol-single-source` / `boundary` / `projection-golden` 均 `PASS`；`contract` 启用失败断言后完成一次上游核对且 4 个注入点指纹一致，并按第 5 章 §9 记录状态；`test-dsh:all` 不低于 165/165；9 项真机验收全部通过；P95 ≤ 512 KiB；IDE 终端可开且 PTY 数据流走原生 `node-pty`；CI 配置中可见同一组命令；第 7 章登记的历史阶段标记与失效章节引用零残留。
- **当前态**：未开始。门禁脚手架已就位（3 `PASS` + 1 `PENDING`，见第 5 章 §3），不构成 K7 达成。

#### P7 打包为 DSH 插件与交付

- **前置**：K7。
- **活动**：运行上游官方 `gulp dsh-ide-pack`（`build/gulpfile.vscode.ts:664`）把**整仓**打成**唯一交付物** `dist/dsh-ide-2.0.0.tgz`（即 DSH bundle 插件包，不是独立 IDE 安装包）；执行 stage 声明式自校验；更新 `build/dsh/chat-render/PROVENANCE.md` 的版本 / commit / sha256；核对 `NOTICE.md` 与 `LICENSE` 原文保留；按 [`AGENTS.md`](../AGENTS.md) §6 写提交信息并提交。
- **产出**：`dist/dsh-ide-2.0.0.tgz`（唯一交付物；含 `runtime/app` appOnly 载荷、91 个内置扩展、sidecar 4 文件、`runtime/build-provenance.json`、bundle 清单白名单 11 项）、更新后的来源凭据、交付提交。
- **出口判据 K8**：tgz 生成成功；stage 白名单 11 项逐项存在且 glob 项至少命中 1 个文件；PROVENANCE 逐文件 sha256 与源一致；提交信息含门禁实测与未完成项；`git status --short` 无临时产物。
- **当前态**：打包链路已实测可执行并产出过 tgz，但 K7 未达成，故本阶段出口未满足，不标记为完成。

### 4. 关键节点定义

关键节点 = 某阶段全部出口判据满足的时刻。每条记录只有：定义、前置、边界。

| 节点 | 所属阶段 | 定义 | 前置 | 边界条件 |
| --- | --- | --- | --- | --- |
| K1 | P0 | 工程基线就绪 | 无 | 只读参考目录不得写入；官方构建脚本可用 |
| K2 | P1 | 契约冻结 | K1 | 协议真源唯一；全仓只注册一条 `dshIde` 通道 |
| K3 | P2 | 投影冻结 | K2 | golden 逐字节一致；适配层零厂商依赖 |
| K4 | P3 | 通道贯通 | K3 | 20 方法全覆盖；waterfall 只存在一种 answerer 形态 |
| K5 | P4 | 视图贯通 | K4 | 连续性 fail-closed；`workbench/**` 边界不破 |
| K6 | P5 | 双窗口贯通 | K5 | 关闭 IDE 窗口不取消 DSH 会话 |
| K7 | P6 | 验证通过 | K6 | 九项真机验收全通过；P95 ≤ 512 KiB；ABI 重编与终端冒烟闭环；CI 接入与第 7 章 第 7 章残留清理闭环 |
| K8 | P7 | 交付完成 | K7 | tgz 白名单自校验通过；许可证凭据齐备 |

关键节点不可跳过、不可并行达成、不可由后继阶段倒补。任一关键节点未达成时，后续阶段的活动不得开始。

### 5. 已废止编号对照（仅用于阅读历史提交）

下表中的旧编号已在文档定稿时废止，**不构成路线、阶段或分支**，禁止在新文档与提交信息中继续使用。

| 旧编号 | 对应现行阶段 |
| --- | --- |
| 阶段 3（终端回退） / 第一批 / 第二批 / 第三批清理 | P0（历史已完成的清理动作，登记见第 7 章 §2） |
| 2.1 协议真源 | P1 |
| 2.2a 投影器 / golden | P2 |
| 2.2b answerer、S0 Spike | P3 中的 waterfall 一致性核对 |
| 2.3 通道、2.4 消费者、2.5 真机接线 | P3 / P4 / P5 |
| 阶段 1、阶段 4、阶段 5、S1–S3 Spike | 已废止，无对应现行阶段 |
| 「回滚点」「路径 1 保护」 | 已废止，不存在回退路径 |

旧文档里的「S0 双结果规则表」已废止：waterfall 只存在 §3 P3 定义的一种形态，实测不符按 §1 第 4 条的阶段内返工规则修复实现，不切换设计。表中的 `S0` / `S1–S3` 是当时的 Spike 编号，与业务流程状态 `ST0–ST4` / `STF` 无关。

### 6. 当前进度（唯一状态表）

| 阶段 | 状态 | 依据 |
| --- | --- | --- |
| P0 | 已完成 | 工程基线、bundle 清单、patch、资源、官方打包任务齐备 |
| P1 | 已完成 | K2 判据实测通过 |
| P2 | 已完成 | `translator.ts` / `ide-view-projector.ts` / golden / 11 项单测；K3 判据实测通过 |
| P3 | 已完成 | K4 判据全部满足：真实端口接通、20 method 确定、`call`/`listen`/`disposeOwner` 合规、`invoke` 恒 `{ value }`、waterfall 单测覆盖、`boundary` PASS；端到端实跑（独立真实 Host）listSessions=52 / listModels=3 / follow=329 records → 98 行投影 |
| P4 | 代码闭环 / 端到端未观测 | 消费者 + 快照流 + DTO→UI + DTO→Chat 内容 + **唯一 Chat Agent** + `dshChatSeam` 启用全部落地（154/154）；Chat 面板实际渲染未观测，K5 不标达成 |
| P5 | 未开始 | 按钮仍抛显式错误；双窗口镜像未接线 |
| P6 | 未开始 | 门禁脚手架 3 `PASS` + 1 `PENDING`；真机验收、ABI 重编、终端冒烟未完成 |
| P7 | 未满足出口 | 打包链路可执行，但前置 K7 未达成 |

阶段状态以本表为准；代码资产与产物的版本控制状态见第 7 章 §3。

---

## 第 4 章 唯一业务流程

>
> 术语见 [`README.md`](../README.md) §2；接口形状与错误码见第 2 章；静态架构见第 1 章；开发阶段见第 3 章。本章不重复它们的内容。

### 1. 流程实例与触发条件

**流程实例**：从 DSH 主窗口的一次开窗触发，到该 IDE 窗口正常关闭或异常终止为止的一次完整业务过程。一个 IDE 窗口对应一个实例、一个 `channelId`、一条 `listen('snapshot')` 订阅。

**唯一触发条件**：用户在 DSH 主窗口会话头部点击「DSH-IDE」按钮（slot `conversation.session.header.utilities`，id `dsh-ide`，`order: -9`）。

**前置条件**（必须同时满足，否则不创建实例）：

1. 会话已加载，可解析 `sessionId`；
2. 工作区可解析 `cwd`；
3. DSH Host 侧的会话服务可用（插件 Host 半身已装载），且 `dshIde` 通道已在 IDE 侧 `app.ts` 注册。

前置条件不满足时的处理唯一：不创建流程实例、不建立连接、不发布快照，按钮给出确定提示，实例停留于 ST0。

**重复触发**：同一 IDE 窗口已存在实例时复用既有连接与 `channelId`，不创建第二个实例、不产生第二个 `channelId`。

### 2. 状态定义

| 状态 | 含义 | 是否为终态 |
| --- | --- | --- |
| ST0 未连接 | 实例尚未建立通道连接 | 否 |
| ST1 已连接 | 连接建立，首帧 `starting` 快照已发布，真源订阅进行中 | 否 |
| ST2 视图就绪 | 首份 `ready` 快照已被消费者接受，Chat 面板渲染完成 | 否 |
| ST3 输入已受理 | 一次 IDE→DSH 调用通过校验并交给 DSH 服务 | 否 |
| ST4 已关闭 | 正常终态：连接释放，IDE 窗口关闭，DSH 会话继续 | 是 |
| STF 失败 | 异常终态：本次实例终止，界面不渲染不一致状态 | 是 |

状态名统一使用 `ST*` 前缀，与已废止的历史 Spike 编号 `S0` / `S1–S3` 无关（见第 3 章 §5）。

### 3. 状态流转

每个状态只有一个正常后继；`ST3 → ST2` 是整条流程唯一的状态回边；所有异常统一收敛到 `STF`。

| 当前状态 | 触发 | 后继状态 | 说明 |
| --- | --- | --- | --- |
| ST0 | T1 完成 | ST1 | 唯一入口 |
| ST1 | T2 → T3 → T4 → T5 → T6 → T7 依次完成 | ST2 | 首帧到视图就绪 |
| ST2 | T8a 完成 | ST3 | 进入交互态 |
| ST3 | T8b → T8c → T8d → T8e 完成 | ST2 | 唯一状态回边；每完成一次回边，`version` 严格 +1 |
| ST2 | T9 完成 | ST4 | 正常终止 |
| 任意状态 | 任一接口级异常 E1–E13 | STF | 异常终止 |

约束：T9 只在 ST2 触发；处于 ST3 时必须先完成 T8b–T8e 回到 ST2 再关闭，保证关闭时视图与日志一致。除表中列出的迁移外不存在其它迁移。

### 4. 处理步骤 T1–T9

#### T1 开窗与连接建立

- 触发：§1 的唯一触发条件成立。
- 输入：`sessionId`、`cwd`。
- 处理：`client.js` 经 `dshIde` 通道发起 `open({ view: 'chat', params: { sessionId, cwd } })`；主进程创建或唤起 IDE `BrowserWindow`；`app.ts` 的 `onDidRemoveConnection` 配对 `disposeOwner(ctx)`。
- 接口：`IdeViewHost.open(spec)`；通道注册恒为 `registerChannel(DSH_IDE_CHANNEL, …)`。
- 输出：连接 `ctx`、窗口、窗口级 `channelId`。
- 状态：ST0 → ST1。
- 边界：一个实例一个 `channelId`；不携带 token、不开第二条通道；不满足前置条件时不执行本步。

#### T2 首帧与订阅

- 输入：T1 的连接。
- 处理：`IdeViewHost.open()` 产出首帧 `DshIdeSnapshot`；`IdeViewHost.subscribe(onSnapshot)` 注册快照回调；IDE renderer 建立唯一的 `listen('snapshot')` 订阅。
- 接口：`DshIdeSnapshot { wireRevision: 2, channelId, version: 1, state: { state: 'starting' } }`；`IServerChannel.listen(_ctx, 'snapshot')`。
- 输出：首帧快照与订阅句柄。
- 状态：保持 ST1。
- 边界：`wireRevision` 恒为 2；`version` 从 1 起；`invoke` 不参与首帧；首帧不得携带未校验的投影载荷。

#### T3 订阅真源

- 输入：T2 已建立的连接与插件 Host 半身持有的 `dshCtx`。
- 处理：真实 `IdeViewHost` 在 `dshCtx` 上订阅 `session/event` 与 `agent/assistant-stream`，回放历史并与实时流合并；注册唯一的审批 / 问卷 answerer（`approval/request`、`user-questions/request`）。
- 接口：`ctx.on('session/event', …)`、`ctx.on('approval/request', …)`、`ctx.on('user-questions/request', …)`。
- 输出：按序到达的官方事件流。
- 状态：保持 ST1。
- 边界：会话日志是唯一真源；不做乐观插入；用户消息等日志事件确认后才落行；工具结果按 `callId` 关联；answerer 只有一种形态（广播 + 首个决议生效）。

#### T4 翻译

- 输入：一条官方事件。
- 处理：`translateDshEvent()` 按 `dshEmits()` 穷举分类，逐字段白名单拷贝为 `IdeEvent`；DSH 私有 payload 全部丢弃；分类为不 emit 或未知的事件直接丢弃。
- 接口：`common/translator.ts` 的 `translateDshEvent` / `translateAll`；`IdeEvent` 字段集合见第 2 章 §3。
- 输出：中立 `IdeEvent` 或空。
- 状态：保持 ST1。
- 边界：不 import `@deepseek-ai/*`；不新增未被 `IdeEventType` 收口的类型；可选字段显式 `undefined` 一律省略。

#### T5 投影

- 输入：T4 的 `IdeEvent`。
- 处理：`IdeViewProjector.apply(event)` 增量折叠：重复 `seq` 幂等丢弃；assistant 增量按 `callId` 合并；行 id 稳定为 `row:<seq>` / `call:<callId>`；仅变更行 `revision` +1；超过 `MAX_ROWS = 600` 时把最老的行折叠为 `preview`，全文留在 `fullText`。
- 接口：`common/ide-view-projector.ts` 的 `createIdeViewProjector` / `projectIdeView` / `IdeViewSnapshot { rows, version }`。
- 输出：投影快照。
- 状态：保持 ST1。
- 边界：`rows` 数组不裁剪；折叠行全文经 `fetchRowDetail(rowId)` 回取；投影器出口不做运行时校验（由 golden 门禁守护）。

#### T6 发布快照

- 输入：T5 的 `IdeViewSnapshot`。
- 处理：包装为 `DshIdeSnapshot` 并经 `listen('snapshot')` **单向**发布；`state` 置为 `ready`；`invoke` 只返回 `{ value }`，绝不回推快照。
- 接口：`IdeViewHost.subscribe(onSnapshot)` → `DshIdeChannel.listen('snapshot')`；输出经 `validateDshIdeInvokeOutput` 约束。
- 输出：一帧 `DshIdeSnapshot`。
- 状态：保持 ST1，直到 T7 完成。
- 边界：`channelId` / `wireRevision` 守恒；`version` 严格 `+1`；局部更新只传变更行，不重发整树；`sessionId` 属会话层过滤，不进快照。

#### T7 消费与渲染

- 输入：一帧 `DshIdeSnapshot`。
- 处理：`DshIdeConsumer.accept()` 依次执行 `validateDshIdeSnapshot` → `assertSnapshotContinuity` → 16ms 合并 → rows 按稳定 id diff → DTO→`IChatProgress` 投影 → Chat 侧栏渲染；需要时经 `dshChatSeam.ts` 单接缝调用 ui-chat sidecar。
- 接口：`DshIdeConsumer.accept()`；DTO→UI 投影层与 Chat 侧栏分离。
- 输出：Chat 面板中与日志一致的视图。
- 状态：ST1 → ST2。
- 边界：`prev === undefined` 是连续性校验的唯一豁免；`version` 断号、倒退或 `channelId` / `wireRevision` 变化一律 fail-closed，不渲染；不得把 React 本地数组当作对话真相。

#### T8 交互闭环（ST2 与 ST3 之间的唯一迭代）

所有 20 个 method 都走同一条路径，不按 method 分叉：

| 子步 | 处理 | 接口 | 状态 |
| --- | --- | --- | --- |
| T8a | 用户在 IDE 的操作被组装为命名参数调用，经 `validateDshIdeInput` 校验后交给 `IdeViewHost.invoke`，由 DSH 服务执行 | renderer → `IChannel.call(command=method, arg)` → `DshIdeChannel.call(ctx, command, arg)` → `IdeViewHost.invoke(method, args)` | ST2 → ST3 |
| T8b | DSH 服务产生 `session/event`；审批 / 问卷 waterfall 广播到两窗口，IDE 弹出对应面板，用户决议经 `answerApproval` / `answerQuestion` 回送，首个决议生效 | `session/event`、`approval/request`、`user-questions/request` | 保持 ST3 |
| T8c | 重放 T4：官方事件翻译为 `IdeEvent` | 同 T4 | 保持 ST3 |
| T8d | 重放 T5–T6：增量投影并发布新一帧 `DshIdeSnapshot` | 同 T5 / T6 | 保持 ST3 |
| T8e | 重放 T7：消费者校验连续性并增量更新视图 | 同 T7 | ST3 → ST2 |

- 输出：DSH 状态变化在 IDE 侧的一次一致呈现。
- 边界：每次回边 `version` 严格 +1；重复 waterfall 决议返回 `ALREADY_RESOLVED`；会话切换返回 `SESSION_SWITCHED`；本地落后过多返回 `SNAPSHOT_STALE`；所有 method 的结果恒为 `{ value }`，状态变化只经快照。

#### T9 关闭与释放

- 触发：用户关闭 IDE 窗口（仅在 ST2 触发，见 §3 约束）。
- 处理：`onDidRemoveConnection` 触发 `disposeOwner(ctx)`，只清理本通道持有的订阅与资源；`IdeViewHost.close()` 结束宿主；`listen('snapshot')` 订阅解除。
- 接口：`disposeOwner(ctx)`、`close()`。
- 输出：连接释放，ST4。
- 状态：ST2 → ST4。
- 边界：**不**代用户取消 DSH 侧会话、审批或生成；不写第二份会话状态；DSH 主窗口继续可用。

### 5. 最终结果

| 结果 | 终态 | 确切含义 |
| --- | --- | --- |
| 正常终止 | ST4 | IDE 窗口关闭；`channelId` 释放；不再接收快照；DSH 会话与会话日志不受影响；会话日志仍是唯一真源 |
| 异常终止 | STF | 本次实例立即终止；界面不渲染不一致状态；对外结果按第 2 章 §6 的错误码或 `TypeError`；下一次实例由 §1 的同一触发条件重新开启，不自动重试、不静默降级、不切换到另一套流程 |

### 6. 流程级异常处理

接口级异常的触发条件、检测点与对外结果由第 2 章 §7 的 E1–E13 唯一定义。本节只定义它们对流程实例的统一后果。

| 异常 | 流程级后果 | 界面行为 | 边界条件 |
| --- | --- | --- | --- |
| E1 白名单外 method | 终止于 STF | 显示 `dsh-ide/feature-unavailable` | 不静默 no-op |
| E2 入参违规 | 终止于 STF | 显示 `dsh-ide/invalid-argument` | 不猜测修正参数 |
| E3 invoke 输出违规 | 终止于 STF | 该次调用结果无效 | 不把调用输出当快照用 |
| E4 连续性违规 | 终止于 STF | 不渲染该帧，不残留错位行 | 新实例通过 `refreshSnapshot` 取全量 |
| E5 重复决议 | 本次决议无效，实例按 T8b 完成回边 | 关闭本窗口请求面板 | 首个决议已生效 |
| E6 会话归属失效 | 本次调用失败，实例按 T8b 完成回边 | 提示上下文失效 | 以 `channelId` 与会话归属为准 |
| E7 快照落后过多 | 终止于 STF | 提示需刷新 | 不凑合合并增量 |
| E8 连接层重建中 | 终止于 STF | 显示「重建中」 | 不伪造事件或快照 |
| E9 折叠行全文不可得 | 本次详情回取返回空，实例继续 | 不展示截断文本冒充全文 | `value = null` |
| E10 行数 / 字节越界 | 折叠最老行后实例继续 | 展示 `preview`，可回取全文 | `rows` 不裁剪；P95 校准见第 5 章 §5 |
| E11 上游版本漂移 | 实例继续并告警 | 显示 drift 告警 | 基准恒为 `0.2.2-rc.1` |
| E12 语音服务未就绪 | 听写入口不可用，实例继续 | 明确提示不可用 | 不启动本地识别后端 |
| E13 连接移除 | 按 T9 正常终止于 ST4 | 无错误提示 | 不取消 DSH 会话 |

统一规则：除 E5、E6、E9、E10、E11、E12 这些「实例继续」的局部异常外，其余异常一律终止于 STF；STF 是本流程唯一的异常终态，不存在第二条恢复流程。所有异常都不改变「会话日志是唯一真源」这一约束。

### 7. 流程关键节点 B1–B5

| 节点 | 定义 | 前置 | 边界条件 |
| --- | --- | --- | --- |
| B1 连接建立 | T1、T2 完成，进入 ST1 | 前置条件全部满足 | 一个实例一个 `channelId` |
| B2 视图就绪 | 首份 `ready` 快照被接受，进入 ST2 | B1 + T3–T7 | `version = 1` 起严格 +1 |
| B3 调用受理 | T8a 完成，进入 ST3 | B2 | 调用必须过 `validateDshIdeInput` |
| B4 决议消费 | waterfall 首个决议生效 | B3 | 重复决议返回 `ALREADY_RESOLVED` |
| B5 连接释放 | T9 完成，进入 ST4 | B2 | 不取消 DSH 会话 |

B1–B5 是流程内的检查点，与开发路线的 K1–K8 不同，二者不得混用。

### 8. 当前态

当前代码处于骨架期，业务流在 T1 即终止：

| 步骤 | 当前行为 |
| --- | --- |
| T1 | `client.js` 抛 `Error('launch chain removed; pending DshIdeChannel.open')`，实例终止于 STF |
| T2 | `DshIdeViewService.open()` 返回 `starting` 首帧；`subscribe` 已注册，后端端口接通后按批次推 `ready` + `state.view` |
| T3 | `index.js` 已创建 `DshIdeHostBridge` 并订阅四类官方事件、注册唯一 answerer；但桥接与 IDE 主进程之间的传输端口尚未接线 |
| T4 / T5 | `translator.ts` 与 `ide-view-projector.ts` 已落地（P2），但未被真实 `IdeViewHost` 调用 |
| T6 | `DshIdeChannel.listen()` 返回 `Event.None`，无快照推送 |
| T7 | `DshIdeConsumer` 不存在；`DshClientService` 骨架恒返回「重建中」；Chat 容器在、DSH 内容为空；`inlineComplete` / 语音 / 账号优雅降级 |
| T8 | `DshIdeChannel.call()` 一律 reject `dsh-ide/feature-unavailable`，未调用 `validateDshIdeInput` |
| T9 | `disposeOwner()` 返回 `0`，无资源清理 |

上述行为是 P3–P5 之前的中间态，不是第二条流程；交付态以 §3–§5 为准。逐项残留登记见第 7 章 §3。

---

## 第 5 章 验证与交付

>
> 除标注「项目根」的命令外，工作目录一律为 `e:/DSH-IDE/`（即仓库根 / 项目根，已扁平化）；命令按 PowerShell 语法给出。

### 1. 规则

1. 四条门禁与 `test-dsh:all` 目前**只通过仓库根 `package.json` 的 `scripts` 在本地执行**；仓库已于 2026-11-09 删除 `.github/` 与 `build/azure-pipelines/`，**当前无 CI 配置**（登记见第 7 章 §7）。把该组命令接入 CI 属于 第 3 章 P6 步骤⑨；接入时再新建 CI 配置，接入前 K7 以本地实测记录为准，不得表述为「CI 已拦截」。接入后 `contract` 启用失败断言，其 `PASS` / `FAIL` 判据见 §9.3（节号已核对）。执行顺序按 P6 的固定顺序。
2. 门禁状态只允许 `PASS` / `PENDING` / `FAIL`，语义见 §9；`PENDING` 不计入通过，不得标成 `PASS`。
3. 任何命令的失败都按第 3 章 §1 第 4 条的阶段内返工处理，不跳过、不改写判据。

### 2. 命令清单（唯一命令真源）

| 用途 | 命令 | 通过判据 |
| --- | --- | --- |
| 编译 DSH 测试 | `npm run build-dsh-tests` | 退出 0，产出 `out/` |
| mocha tdd 半场 | `npm run test-dsh` | `13 passing` |
| 全量 DSH 测试 | `npm run test-dsh:all` | `13 passing` + `152/152`，合计 165/165 |
| 门禁 1 | `npm run verify:dsh-ide-protocol-single-source` | `STATUS: PASS` |
| 门禁 2 | `npm run verify:dsh-ide-boundary` | `STATUS: PASS` |
| 门禁 3 | `npm run verify:dsh-ide-projection-golden` | `STATUS: PASS` |
| 门禁 4 | `npm run verify:dsh-ide-contract` | `STATUS: PENDING`（当前，见 §3） |
| 类型检查 | `$env:NODE_OPTIONS='--max-old-space-size=12288'; .\node_modules\.bin\tsc.cmd -p src/tsconfig.json --noEmit` | 变更文件 0 错误（§4） |
| 官方打包 | `node ./node_modules/gulp/bin/gulp.js dsh-ide-pack` | 产出 `dist/dsh-ide-2.0.0.tgz`（§8） |
| sidecar 构建 | `node build/dsh/chat-render/build-render.mjs` | 产出 `build/dsh/chat-render/dist/dsh-chat.js` 与 `.css` |
| sidecar 源核对 | `node build/dsh/chat-render/regen-sources.mjs --check` | 退出 0，20 个源文件无漂移 |
| 来源凭据重生成 | `node build/dsh/chat-render/gen-provenance.mjs` | `PROVENANCE.md` 逐文件 sha256 对齐 |
| sidecar 浏览器冒烟 | `node build/dsh/chat-render/smoke.mjs` | 退出 0，6 种 `DshPartProps` 挂载成功 |
| 上游差异报告（项目根） | `node scripts/sync-upstream.mjs --fetch --target dsh-v<版本>` | 产出 `.build/upstream-diff/<版本>-dsh-ide-diff.md` |

#### 2.1 环境守卫下的固定执行方式

`pretest-dsh → build-dsh-tests` 会 `cleanDir('out')`（约 8671 文件），`SAFE_DELETE_BULK_CONFIRM_REQUIRED` 批量删除守卫会拦截该操作，导致 `npm run test-dsh:all` 首跑 `EXIT=1`、重试 `EXIT=0`。这属于环境守卫，不是代码缺陷，也不用于跳过任何测试。守卫拦截时，按以下两条命令**依次**执行同一组测试（不减少测试项）：

```powershell
node node_modules/mocha/bin/mocha.js --ui tdd "out/vs/platform/dshClient/test/node/*.test.mjs" "out/vs/workbench/contrib/dsh/test/browser/chatClient/*.test.js" "out/vs/workbench/contrib/dsh/test/browser/chatClient/*.test.mjs"
node --experimental-strip-types --test build/lib/test/dshBuildProvenance.test.ts build/lib/test/dshBundleStaging.test.ts build/lib/test/ripgrep.test.ts build/lib/test/dshIdeProtocol.test.ts build/lib/test/dshIdeProjection.test.ts build/lib/test/dshIdeChannel.test.ts build/lib/test/dshIdeTransport.test.ts src/vs/platform/dshClient/test/host/ideViewHost.test.mjs
```

### 3. 四条门禁判据与当前实测

四条门禁均由 `build/lib/dsh/verify/dshIdeVerify.mjs` 单脚本按参数分派，并接入 `package.json` 的 `scripts`。

| 门禁 | 精确判据 | 当前实测 |
| --- | --- | --- |
| `protocol-single-source` | 17 个协议符号各在 `platform/dshClient/common/dshIdeProtocol.ts` 声明且只声明一次；扫描范围为 `platform/dshClient`、`workbench/contrib/dsh`、`workbench/browser/parts` 下全部 `.ts`；`dshIdeProtocol.ts` 不得引用 contract，contract 必须引用 protocol；`platform/dshClient` 下 `.js` / `.mjs` 不得出现第二份 `exactRecord` / `jsonValue` / `validateDshIde*` 校验器 | **PASS**，退出 0 |
| `boundary` | `src/vs/workbench` 全部 `.ts`（实测 4442 文件）零 `from '@deepseek-ai/` 与 `require('@deepseek-ai/`；`dshIdeChannel.ts` 零 Cordis / `dshCtx` / `apply(ctx)` 且构造函数必须含 `IdeViewHost`；`platform/dshClient/{common,electron-main,transport}` 下 `.ts`（排除 `test/`，实测 10 个文件）零 electron API、`@deepseek-ai/*`、Cordis 引用；`listen` 三层过滤与 `call` 真实分发断言；**P4/K5 起启用 UI 投影层隔离**：`dshIdeConsumer` / `dshIdeUiProjection` / `dshChatAgent` 三文件零 `electron-main` 反向依赖、零 DSH 包；快照校验只允许出现在消费者（通道层不得重复）；Chat Agent 必须是 `isDefault` 且经 `registerDynamicAgent` 注册 | **PASS**，退出 0 |
| `projection-golden` | `verify/golden/*.json` 至少 1 个 fixture；每个 fixture 起子进程真实执行 `projectIdeView(translateAll(fx.events))`，与 `fixture.expected` 做 `JSON.stringify` 逐字节比对；`fx.events` 必须为非空数组 | **PASS**，退出 0，1 个 fixture；脚本内附 `PENDING(P6)` 说明：真实事件流 P95 校准未执行（§5） |
| `contract` | `dshIdeContract.ts` 必须导出 `UPSTREAM_VALIDATED_VERSION`、`BLESSED_PACKAGES`、`installedMeetsVersion`、`upstreamDrift`、`VSCODE_PATCH_POINTS`；正则抽取的注入点恰好 4 个；逐文件计算 sha256 前 16 位指纹并打印基线 | **PENDING**（状态语义见 §9），退出 0；首次基线：`validated=0.2.2-rc.1`，4 个指纹已产出 |

本表只记录实测结果；`PENDING` 的状态语义、触发条件、升级条件与交付口径（含脚本内 `PENDING(2.4)` / `PENDING(2.5)` 说明项）一律见 §9。

### 4. 测试基线与类型检查

`test-dsh:all` = `npm run test-dsh` + `node --experimental-strip-types --test` 的 7 个 `build/lib/test` 文件 + 1 个插件侧 `.mjs`（`src/vs/platform/dshClient/test/host/ideViewHost.test.mjs`）。`build/package.json` 的默认 `test` 不覆盖这组文件，必须由 `test-dsh:all` 显式列出。

| 分组 | 文件 | 用例数 |
| --- | --- | --- |
| mocha tdd | `out/vs/platform/dshClient/test/node/*.test.mjs` + `out/vs/workbench/contrib/dsh/test/browser/chatClient/*.test.js` 与 `*.test.mjs` | 13 |
| `dshBuildProvenance.test.ts` | 构建来源凭据 | 4 |
| `dshBundleStaging.test.ts` | bundle 清单与 stage 字面量 | 7 |
| `ripgrep.test.ts` | 平台过滤 | 5 |
| `dshIdeProtocol.test.ts` | 20 方法白名单、双向校验器、连续性 fail-closed | 19 |
| `dshIdeProjection.test.ts` | golden 回放、事件分类、seq 幂等、稳定 id、600 行折叠、P95 脚手架、架构边界、**真实 DSH 线上事件（斜杠命名 + data 信封）翻译** | 18 |
| `dshIdeChannel.test.ts` | 通道分发（20 method）、三层过滤、`disposeOwner`、快照纪律、`state.view` 行级校验、`launch` 开窗命令、sessionId 传递与绑定、**follow 帧解包** | 28 |
| `ideViewHost.test.mjs` | Host 半身：四类事件订阅与归属过滤、唯一 answerer 形态、waterfall 一致性、会话归属、method 映射、Host 端点自解析与发布（不含 cookie）、插件入口 inject 与延迟等待清单一致、**等端口就绪再发布** | 25 |
| `dshIdeTransport.test.ts` | IDE 侧传输适配：鉴权交换、一元信封、remote.mux 流、waterfall 回投、method 映射与拒绝、**连接前不发送** | 14 |
| `dshIdeConsumer.test.ts` | 消费者：校验、fail-closed（断号/倒退/channelId 变化）、16ms 合并、行级 diff | 10 |
| `dshIdeUiProjection.test.ts` | 行展示文本：折叠用 preview、非折叠用 text、皆无返回 undefined | 4 |
| `dshChatAgent.test.ts` | 唯一 Chat Agent：元数据、submit 转发、失败不伪造、**等快照增长后只回显新行**、超时明确说明、取消 | 7 |
| `dshIdeToSeamChain.test.ts` | DTO 行 → 接缝的**串联**：五种 kind 都被接管、空行被过滤、折叠带 preview、isTrusted 策略 | 5 |
| `dshIdeLaunchListener.test.ts` | IDE 侧开窗接单：报到一次不重复、失败重试、onLaunch 抛错不断循环、畸形载荷、dispose 停止 | 5 |
| **合计** | — | **13 + 152 = 165** |

- 当前唯一基线：**165/165**（mocha `13 passing` + node:test `152/152`），实测退出 0。
- mocha 的 13 个用例来自 `packaging.test.mjs`（7 项）与 `dshChatSeamMap.test.js`（6 项）；第三个 glob `chatClient/*.test.mjs` 当前无匹配文件（既有现象，不减少测试项）。`client.test.mjs`（原零用例、仅 harness）与 `dshClientService.test.ts`（原 stale、不兼容）已在全面清理（2026-11-08）中删除，不计入基线。
- 上述两文件（stale / 零用例）已在全面清理（2026-11-08）中删除，原登记见第 7 章 §3。
- 类型检查判据：全仓既有 electron 类型解析错误集中在 `app.ts`，改动前后基线对比确认非 DSH 改动引入；**变更文件 0 错误**即为通过。
- 穷举性验证（P2 出口）：临时新增 `IdeEventType` 变体 → `tsc` 必须报 `TS2322: not assignable to type 'never'` → 撤回 → `git diff --stat` 无残留 → `tsc` 复跑 0 错误。

### 5. P95 校准（固定序列）

- 输入：真实 DSH 事件流样本；测量 `rows` 序列化后的字节数 P95。
- 阈值：`ROWS_P95_BYTE_LIMIT = 512 * 1024`；相关常量 `MAX_ROWS = 600`、`RESULT_PREVIEW_LIMIT = 240`。
- 固定序列：① 下调 `MAX_ROWS` → ② 收紧 `preview` 折叠阈值 → ③ 重新生成并更新 `golden/basic-session.json` → 重新测量，直至 P95 ≤ 512 KiB。
- 边界：这三次调整统一标注为「参数校准，非架构变更」，不改 DTO 形状、不改通道形状；当前无真实样本时用 mock 样本搭建回放脚手架，不阻塞 P2。
- 当前态：未执行（脚本内 `PENDING(2.5)`）。

### 6. 真机验收（9 项，固定顺序）

1. DSH 主窗口与 IDE 窗口可同时打开。
2. 同一会话在两窗口镜像，消息流一致。
3. `approval/request` 两边弹出，任一窗口 resolve 即消费，重复决议返回 `ALREADY_RESOLVED`。
4. `user-questions/request` 同上。
5. 关闭 IDE 窗口不取消 DSH 侧会话、审批或生成。
6. IDE 内终端可开，PTY 数据流走原生 `node-pty`；`node-pty` 按宿主 Electron 44.7.0 的 `NODE_MODULE_VERSION` 编译（`1.143.1` 是 VS Code 版本号，不是 ABI）。
7. 上游升版后四条门禁状态符合 §9、4 个注入点 patch 可重放。
8. AI Chat 面板可见且 DSH 内容回填。
9. 会话头部「DSH-IDE」按钮恢复开窗；`ping` / `inlineComplete` 恢复；语音服务未就绪时入口明确不可用且不启动本地识别后端。

九项全部通过才满足 第 3 章 的 K7 前置部分。

### 7. 上游核对流程（固定 4 步）

1. 在只读参考源执行 `git fetch upstream --tags`，再运行 §2 的差异报告命令，产出 `<版本>-dsh-ide-diff.md`（落 `.build/upstream-diff/`，不入库）。
2. 跑 `verify:dsh-ide-contract` 与 `verify:dsh-ide-protocol-single-source`，确认无破坏性变更。
3. 按 `VSCODE_PATCH_POINTS` 的 4 个路径重核 sha256 前 16 位指纹；不一致时重放 patch。
4. 更新 `build/dsh/chat-render/PROVENANCE.md` 的版本 / commit / 逐文件 sha256，并在提交信息附差异报告路径。

版本基准恒为 `UPSTREAM_VALIDATED_VERSION = '0.2.2-rc.1'`；优先跟随 DSH stable，不在 rc 迭代期盲目追新。

### 8. 交付验收（单一 DSH 插件包）

上游官方任务 `gulp dsh-ide-pack`（定义于 `build/gulpfile.vscode.ts:664`）在仓库根 `e:/DSH-IDE/dist/` 把整仓打成 `dsh-ide-2.0.0.tgz`，这是**唯一交付物**（DSH bundle 插件包；包内 `runtime/app` 是插件载荷，不是独立安装包）。验收项：

1. stage 声明式自校验通过：`build/lib/dsh/package.json` 的 `files` 白名单 11 项逐项存在，glob 项（`locale/*.json`、`chat-render/dist/`）至少命中 1 个文件。
2. 包内含 `runtime/app` appOnly 载荷、91 个内置扩展、`chat-render/dist/dsh-chat.js` / `dsh-chat.css` / `PROVENANCE.md` / `LICENSE-DSH`、`runtime/build-provenance.json`。
3. `PROVENANCE.md` 逐文件 sha256 与源一致；`NOTICE.md` 与 `LICENSE` 原文保留。
4. 提交信息写清「做了什么 / 门禁实测 / 未完成项」；`git status --short` 无临时产物，显式 `git add <文件>`。

### 9. 门禁状态语义与验收口径

| 状态 | 定义 | 退出码 | 是否拦截 |
| --- | --- | --- | --- |
| `PASS` | 断言已实现且全部通过 | 0 | 是 |
| `PENDING` | 脚手架就位但**未启用失败断言**；**不计入通过** | 0 | **否** |
| `FAIL` | 断言不通过 | 1 | 是 |
| 非法 / 缺失 gate 名 | 脚本参数错误 | 2 | 是 |

仅 `FAIL` 与参数错误阻断流程；`PASS` 与 `PENDING` 均退出 0。

#### 9.1 四门禁状态矩阵

| 门禁 | 当前 STATUS | `PASS` 含义与退出码 | `FAIL` 含义与退出码 | `PENDING` 处理与退出码 |
| --- | --- | --- | --- | --- |
| `protocol-single-source` | PASS | 断言全通过，计入 K7；退出 0 | 协议符号重复 / 依赖反向 / 第二份校验器，阻断；退出 1 | 不适用 |
| `boundary` | PASS | 边界断言全通过，计入 K7；退出 0 | `workbench/**` 越界或通道持有 Cordis，阻断；退出 1 | 内部 `PENDING(2.4)` 说明项，P4 转为启用断言；不改本门禁 STATUS，退出 0 |
| `projection-golden` | PASS | golden 逐字节一致，计入 K7；退出 0 | 回放输出与冻结快照不一致，阻断；退出 1 | 内部 `PENDING(2.5)` 说明项，P6 完成 P95 校准；不改本门禁 STATUS，退出 0 |
| `contract` | PENDING | 启用失败断言且版本 / 指纹全相符后计入 K7；退出 0 | 结构断言失败（当前唯一失败情形）或启用后版本 / 指纹不符；退出 1 | **不拦截**；以 §7 上游核对人工记录与 4 个指纹一致作补偿；退出 0 |

#### 9.2 四门禁 = 三道拦截 + 一道观察

- **拦截（3 条）**：`protocol-single-source`、`boundary`、`projection-golden` 的断言已启用，任一 `FAIL` 退出 1。
- **观察（1 条）**：`contract`。`dshIdeVerify.mjs:198-217` 只断言 5 个导出符号存在、`VSCODE_PATCH_POINTS` 恰好 4 项，打印 `UPSTREAM_VALIDATED_VERSION` 与 4 个 sha256 前 16 位基线后**无条件 `return 'PENDING'`**；不比对已安装版本、不比对指纹基线。它当前与代码是否合规无关，不拦截。
- `boundary` / `projection-golden` 内部打印的 `PENDING(2.4)` / `PENDING(2.5)` 是待启用断言的说明项，不改变这两条门禁自身的 `STATUS`；分别在 P4、P6 转为启用断言。

#### 9.3 PENDING 的触发条件、升级条件与交付判据

| 项 | 唯一定义 |
| --- | --- |
| 触发条件 | `contract()` 处于脚手架实现：除上述 2 项结构断言外没有失败断言，末尾固定返回 `PENDING`。结构断言不通过时抛错转 `FAIL`（退出 1），这是当前该门禁唯一会失败的情形。 |
| 何时变 `PASS` / `FAIL` | P6 中按本章 §7 的上游核对步骤把 `contract()` 改为**启用失败断言**：比对 `installedMeetsVersion()` / `upstreamDrift()` 与 `UPSTREAM_VALIDATED_VERSION = 0.2.2-rc.1`、比对 4 个注入点 sha256 与冻结基线。全部相符 → `PASS`；任一不符 → `FAIL`（退出 1）。启用断言之前，该门禁不存在 `PASS` / `FAIL` 语义。 |
| PENDING 期间交付判据 | **不降级，也不因 `PENDING` 自动放行**。`PENDING` 不计入通过；K7 要求以本章 §7 上游核对的人工记录与 4 个注入点指纹一致性作为补偿判据，未完成该记录即 K7 不满足、P7 不得启动。 |

### 10. 记录规则

每阶段出口判据实测后，按「阶段 / 命令 / 结果 / 未完成项」四字段记录；未执行的命令如实标注「未跑」，禁止写「门禁全过」这类模糊表述。历史验证数值属历史记录，以 git history 与本章 §4 的当前基线为准，不在本章重复。

#### 10.1 文档结构核验（引用图与术语唯一）

每次文档结构调整后，按 [`README.md`](../README.md) §4.1 的引用图规则执行三项核验，结果写入提交信息：

1. 抽取各文档头部 blockquote 段的跨文档链接构成**定义依赖图**，用传递闭包检查 `reach[i][i]`，环数必须为 **0**；同时核对 [`README.md`](../README.md) §4.1 的 Mermaid 图注**边数 / 节点数 = 脚本实测 `DEF_EDGES` / 节点数**（当前 3 / 3），不一致即判文档漂移。
   核验脚本：`npm run verify:docs-graph`（`build/lib/dsh/verify/dshDocsGraph.mjs`，串联本节三项检查；`PASS` 退出 0，任一不符退出 1）。
2. `git grep -nE '^## .*术语'` 必须只有 `README.md:## 2. 统一术语` 一处；L1–L5 不得出现术语表或术语重定义。
3. 全仓 `唯一定义` / `唯一职责` 声明按主题去重，不得有两个文件声称定义同一主题。

正文中的导航链接允许双向、不参与定义依赖图，但不得复制定义；定稿核验测得的双向导航对与分类结果登记在第 7 章 §7.5。

---

## 第 6 章 仓库结构索引

### 1. 仓库根（已扁平化；仓库根即项目根，`vscode-1.143.1/` 子目录已不存在）

```text
e:/DSH-IDE/                              git 仓库根 / 唯一代码树
  .git/
  README.md                      总纲、术语、分层索引、状态入口（L0）
  AGENTS.md                      协作约定（L0）
  NOTICE.md / LICENSE / LICENSE.txt   法律声明（保留原文）
  docs/DEVELOPMENT.md            本手册（docs/ 仅此一份）
  src/ build/ extensions/ cli/ remote/ resources/ test/ scripts/   代码树
  .eslint-plugin-local/         仓库自定义 ESLint 规则（eslint.config.js 依赖）
  .vscode/                      工作区开发配置；.vscode/extensions 被 build/npm/dirs.ts 引用
  cli/ThirdPartyNotices.txt     原 Rust CLI 唯一保留的法律文件（其余 CLI 源码已删）
  node_modules/                 安装依赖（生成物，git 忽略）
  dist/                         唯一交付物 dist/dsh-ide-2.0.0.tgz（DSH 插件包，生成物，git 忽略）
  .build/                       上游差异报告（生成物，git 忽略）
```

### 2. 插件与通道（`src/vs/platform/dshClient/`）

只列 6 个关键节点，其余文件以 `git ls-files` 为准。

| 路径 | 职责边界 |
| --- | --- |
| `index.js` | Cordis 插件入口，`apply(ctx, config)` 注册 Host 侧服务 |
| `common/dshIdeProtocol.ts` | **协议唯一真源**：常量、DTO、20 方法 schema、双向校验器、连续性 |
| `common/translator.ts` | DSH 事件 → 中立 `IdeEvent`，`dshEmits()` 穷举分类 |
| `common/ide-view-projector.ts` | 增量 reducer：`IdeRow` / `IdeViewSnapshot`、稳定 id、有界折叠 |
| `electron-main/dshIdeChannel.ts` | 唯一 `IServerChannel` 实现，构造只接 `IdeViewHost` |
| `PROVENANCE.md` | 搬用声明与审计 hash（保留，勿改） |

其余文件（`dshIdeContract.ts`、`dshClientService.ts`、`ide-view-service.ts`、`client/`、`host/`、`test/` 等）不在此表展开；分层边界见第 1 章 §3，当前态残留见第 7 章 §3。

### 3. IDE 侧（`src/vs/`）

只列职责边界，逐文件清单以 `git ls-files` 为准。

| 路径 | 职责边界 |
| --- | --- |
| `code/electron-main/app.ts` | 唯一通道注册点与 `onDidRemoveConnection → disposeOwner` 配对 |
| `workbench/contrib/dsh/` | IDE 侧单接缝、行内补全、Chat 渲染入口与降级提示 |
| `workbench/workbench.common.main.ts` | 无条件引入 Chat 与 DSH contribution |
| `workbench/contrib/chat/browser/widget/chatListRenderer.ts` | `tryRenderDshChatPart` 的唯一消费点 |

`workbench/contrib/dsh/` 下另有 2 个空目录残留：`browser/chatClient/`、`host/`；`test/browser/chatClient/` 保留唯一测试文件 `dshChatSeamMap.test.ts`（6 项用例，见第 5 章 §4）。

### 4. 构建、资源与验证

| 路径 | 职责 |
| --- | --- |
| `product.json` | 产品身份：`nameShort/nameLong = "DSH IDE"`、`applicationName = "dsh-ide"`、`urlProtocol = "dsh-ide"` |
| `package.json` | 9 条 DSH 脚本：`build-dsh-tests`、`pretest-dsh`、`test-dsh`、`test-dsh:all`、4 条 `verify:dsh-ide-*`、`verify:docs-graph` |
| `build/lib/dsh/package.json` | bundle 清单模板：`dsh-ide@2.0.0`、`dsh.bundle.patch`、11 项 `files`、3 项 `dsh.client.inject`、2 项 `peerDependencies` |
| `build/lib/dsh/cordis.patch.yml` | bundle patch：唯一 `insert: dsh-ide` 行 |
| `build/lib/dsh/verify/dshIdeVerify.mjs` | 四条门禁单脚本，`PASS` / `PENDING` 退出 0、`FAIL` 退出 1、非法 gate 退出 2 |
| `build/lib/dsh/verify/dshDocsGraph.mjs` | 文档结构核验（定义依赖图 0 环 / 术语表唯一 / 声明去重） |
| `build/lib/dsh/verify/golden/basic-session.json` | mock 事件流 + 冻结快照（`version = 7`） |
| `build/lib/test/` | 5 个 node:test 文件（4 / 7 / 5 / 19 / 11 项），由 `test-dsh:all` 显式列出 |
| `build/lib/dshBuildProvenance.ts` | 构建来源凭据采集 |
| `build/gulpfile.vscode.ts` | 上游官方打包脚本扩展：`prepare-dsh-chat-render`（子任务）、`dsh-ide-<platform>-<arch>`、`dsh-ide-pack`（`:664`）、stage 自校验（`:701-724`） |
| `gulpfile.mjs` / `build/gulpfile.ts` | 上游任务加载入口，自动加载 `build/gulpfile.*.ts` |
| `build/dsh/chat-render/` | sidecar：`src/` 20 个 ui-chat 源文件、`shims/` 8 个、构建器、`PROVENANCE.md`、`LICENSE-DSH`、合并 CSS 与 APNG |
| `resources/dsh/` | `icon.svg`、`locale/en.json`、`locale/zh.json` |
| `resources/win32/dsh.ico`、`resources/linux/dsh-ide.png` | 平台图标 |
| `scripts/sync-upstream.mjs`（项目根） | 上游差异报告，默认源 `E:/deepseek-harness-0.2.2-rc.1/`，输出 `.build/upstream-diff/` |

#### 4.1 法律/许可文件（迁移目标，只放指针）

法律/许可文件清单与维护规则见第 7 章 §4.1 及 [`README.md`](../README.md) §1。原 `cleanup-inventory.md` 已合并入本手册，本节只放指针、不复制清单。

### 5. 生成物与忽略策略

| 生成物 | 来源 | 是否入库 |
| --- | --- | --- |
| `out/`、`out-build/`、`out-vscode/`、`out-vscode-min/` | 官方编译与 sidecar 复制（`build/gulpfile.vscode.ts:565-583`） | 否，`**/out/` 忽略 |
| `build/dsh/chat-render/dist/dsh-chat.js` / `.css` | `build-render.mjs` | 否，`**/dist/` 忽略 |
| `dist/dsh-ide-2.0.0.tgz` | `gulp dsh-ide-pack` | 否 |
| `dist/.dsh-ide-staging/<platform>-<arch>/` | 打包 stage 目录 | 否 |
| `.build/upstream-diff/` | `sync-upstream.mjs` | 否，`.build/` 忽略 |
| `runtime/app` | 单根单宿主下的 VS Code appOnly 载荷，随 tgz stage | 否（生成物） |

`docs/` 现仅 `DEVELOPMENT.md` 一份（由 7 份专题规格合并而来）；`NOTICE.md`、`LICENSE`、两份 `PROVENANCE.md` 与 `LICENSE-DSH` 属于必须保留的凭据文件，不受生成物清理影响。

---

## 第 7 章 代码资产登记

### 1. 登记规则

1. 旧跨进程连接层、私有 launch 链与**旧终端复刻**已物理删除，**不存在回退路径**。
2. 历史文档把旧终端复刻称作「P5」，该名称与现行开发阶段 `P5` 无关；本章一律使用「旧终端复刻 / 旧终端探测」。
3. 当前态残留统一按第 3 章 对应 P 阶段处理，不构成第二条路线。
4. 许可证凭据保留且不得删改；删改违反许可证义务。

### 2. 已移除代码登记

**合并说明（触发条件已执行）**：原 `cleanup-inventory.md` 设定的删除触发条件为「`K7` 达成且 §7 全部条目闭环」。2026-11-08 合并为单一手册时，该文件与其它专题文档一并并入本手册并删除。其有效条目已落在第 7 章 §4.1（法律/许可清单）、§7.1 与 §7.3（旧编号与失效引用登记），第 6 章 §4.1 只保留指针。

下表为已完成的删除动作留痕（批次号仅为历史索引，不是开发阶段）。

| 批次 | 已移除内容 |
| --- | --- |
| 第一批 · launch token 链 | `index.js` 的 `/dsh-ide-launch`、`/dsh-ide-status` 私有路由及 `deriveEndpointAndToken` / `readSessions` / `readJsonBody`；`common/env.js` 的 `DSH_IDE_TOKEN_ENV`；`host/launch.js`；`host/launch-guard.mjs`；`test/node/launch.test.mjs`、`launch-guard.test.mjs`；`client.test.mjs` 的 launch body suite；`dshBundleStaging.test.ts` 与 `packaging.test.mjs` 中对应断言；`gulpfile.vscode.ts` 的注释残段。`client.js` 的点击改为抛显式错误。 |
| 第二批 · 旧终端复刻 | `host/terminal-stream.js`、`workbench/contrib/terminal/browser/dshTerminalPty.ts`、`dshTerminalSpawn.ts`、`platform/dshClient/browser/dshTerminalBridge.ts`、`electron-main/dshTerminalPrepare.ts`、`common/dshTerminalProtocol.ts` 及相关伴生测试；`ide-service.js` 的 `terminal()` 与 `runTerminalStream` import；`terminalService.ts` 的 `customPtyImplementation` 注入；`dsh.contribution.ts` 的终端流注册。原生 ptyHost / `localPty` 频道恢复为上游实现。 |
| 第三批 · 跨进程 mux/信封 | `electron-main/dshClientTransport.node.ts`、`common/dshClientProtocol.ts`、`common/dshClientChannel.ts`、`common/dshRemoteRequests.ts`、`browser/chatClient/dshEventMap.ts`、`electron-main/dshClientBootstrap.ts`、`browser/dshChatProvider.ts`、`browser/dshChatSessions.ts`、`browser/dshSessionUri.ts` 及 5 个伴生测试；`bootstrapDshClient()` 引导一并删除。账号端点迁至 `legacy-account-endpoints.ts`。 |
| 第四批 · 全面清理（2026-11-08） | `electron-main/dshTerminalBackendProbe.ts`（旧终端探测，全仓 0 引用）、`test/node/client.test.mjs`（零用例、仅 harness 的死测试）、`test/node/dshClientService.test.ts`（断言旧 mux 语义、与现实现不兼容且未被执行）；三者均 `git rm` 删除，不留工作区副本。 |

同时立新骨架：`dshIdeProtocol.ts`、`dshIdeChannel.ts`、`ide-view-service.ts`、`dshClientService.ts` 重写为消费 `dshIde` 骨架，`app.ts` 改为唯一 `registerChannel(DSH_IDE_CHANNEL, …)`。

### 3. 当前态残留登记

下表是代码实况与交付态契约之间的差距。处置规则唯一：在「归属阶段」列对应的 P 阶段内按路线处理，不新增并行阶段。

| 项 | 实况 | 归属阶段 |
| --- | --- | --- |
| `index.js` | 已注册 `IdeRemoteService` 并创建 Host 半身桥接（订阅四类官方事件 + 唯一 answerer）；传输端口与 IDE 主进程接线未完成 | P5 |
| `common/env.js` | `DSH_IDE_ENDPOINT` / `DSH_IDE_INTERACTIONS` 两个常量在目录内无消费者 | P5 |
| `common/legacy-account-endpoints.ts` | 账号端点仍由 `globalCompositeBar.ts` 引用，尚未归并入新协议 | P5 |
| `client/client.js` | `postJson()`、`body`、`showError` 均为死代码；点击抛 `Error('launch chain removed; pending DshIdeChannel.open')` | P5 |
| `common/dshClientService.ts` | 骨架：`getStatus()` 恒 `false`，`call()` / `connect()` 恒 `REBUILD_ERROR`，`openWritableStream()` 不发 channel command | P4 |
| `src/vs/platform/dshClient/PROVENANCE.md` | 记录的文件大小、落地文件数量与 `test-dsh` 命令为删除前快照，已过期；须按 §4 规则更新 | P7 |
| `dshChatSeam.ts` | `dshChatRenderEnabled` 默认 `false`；`setDshChatRenderEnabled` 全仓无调用方，接缝恒休眠 | P4 |
| Chat 面板 | `chat.view.contribution` 无条件注册，容器仍在；DSH 内容为空，显示「连接层重建中」 | P4 |
| `translator.ts` / `ide-view-projector.ts` | `IdeEvent.streaming`、`ARGS_PREVIEW_LIMIT`、`ROWS_P95_BYTE_LIMIT` 定义后未被生产代码使用（仅常量与测试引用） | P3 / P6 |
| `DshIdeViewService` 后端端口 | Host 半身（`index.js` + `host/ide-view-host.js`）已订阅四类官方事件并注册唯一 answerer；与 IDE 主进程之间的传输端口仍未接线，端口实现仍是 `UnavailableDshIdeBackend` | P5 |
| 打包输出路径 | 已修（2026-11-09）：仓库扁平化后 `buildRoot`/`packageTask`/`patchWin32DependenciesTask`/`generateNodeCompileCacheTask` 仍用 `path.dirname(root)`，产物与 staging 落到仓库外的 `E:\dist`，导致 `runtime/app` 为空、tgz 只有 157 KB。现统一改为 `root` | 已闭环 |
| 扩展类型依赖断链 | 已修（2026-11-09）：767 个目录联接指向已迁移的 `E:\vscode-dsh\...`（含 11 个 `@types/node`、`extensions/node_modules` 全量），导致 `tsgo` 报 `Cannot find type definition file for 'node'`。已批量重定向到本仓库对应路径，移除 42 个无真实目标的孤儿联接 | 已闭环 |
| 7 个 method 的官方落点 | `rewind` / `loadOlder` / `setEffort` / `setPermissionPreset` / `runCommand` / `listCommands` / `deleteSession` 在 DSH 公开接口中未核对到确切方法，当前一律返回 `feature-unavailable` 并写明缺口，不猜方法名、不伪造成功 | P5 |
| `deleteSession` 语义缺口 | 第 8 章 §8.2.4 要求直接物理删除；DSH `sessions` 只有 `get` / `list`，会话由拥有它的 fiber 生命周期决定，无公开物理删除接口。当前明确拒绝，待 P5 与 DSH 侧确认删除能力归属后再实现，禁止用「关闭视图」冒充删除 | P5 |

**§3.1 架构裁定（2026-11-09，K4 前置）**

| # | 事实（可复核） | 与手册的冲突 | 影响 |
| --- | --- | --- | --- |
| B1 | DSH `0.2.2-rc.1` 的插件**不在 Electron 主进程**加载：`apps/desktop/src/host-process.ts:212` 用 `spawn()` 起 `node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js` 子进程，`apps/desktop-host/src/index.ts:29-31` 在该子进程内 `loadProfileDirectory()` + `runProfile()` 装载 bundle 插件 | README §1（L0 项目定义）要求「DSH 主进程逻辑与 VS Code 主进程逻辑在同一个 Electron 主进程内共享唯一 Cordis 根 `dshCtx`」；实际上 DSH `0.2.2-rc.1` 的 Cordis 根在 **Node 子进程**（见本表事实列），Electron 主进程只做窗口与 IPC 外壳。第 1 章 §1 不变量 I1 已据此修正为「单根单宿主」，不再要求同进程 | `DshIdeBackend` 与 IDE 主进程之间只能是**跨进程**通道；而第 1 章 §7 已把「跨进程私有管道」列为明确不存在的能力 |
| B2 | DSH Host 提供官方 HTTP/WS 端点（`runProfile({args: ['--no-open','--host','127.0.0.1','--port','0']})`），客户端经官方 `dsh-client-connection` 连接；`common/env.js` 的 `DSH_IDE_ENDPOINT` / `DSH_IDE_INTERACTIONS` 正是按这一形态设计 | 手册目前的通道设计（主进程 `IServerChannel` + 进程内 `IdeViewHost`）假设同进程；两者不能同时成立 | P3 的 `DshIdeChannel` / `DshIdeViewService` 可实现、可测，但 `DshIdeBackend` 的**真实**实现必须选定其一：① 在 Host 子进程里实现并以官方客户端传输连回；② 改交付形态让 IDE 与 Host 同进程 |

处置纪律：本项**不改代码迁就文档，也不改文档迁就代码**。按 [`README.md`](../README.md) §4 的权威层级（代码与门禁 > 契约真源 > 手册职责章节 > 其它文档），代码事实优先。

**裁定结论（2026-11-09，按上述层级；并据项目所有者对 DSH-IDE 定位的澄清修订）**：

1. **DSH-IDE 是 DSH 的 bundle 插件、对 DSH 应用的拓展，不是独立应用或独立进程**（项目所有者澄清）。它是把 VS Code 改造为 DSH 插件、给 DSH 增加 IDE 页面并保留部分 IDE 功能的结果；「一体」是天然前提，而非需跨边界合并的目标。
2. 不变量 I1 维持「**单根单宿主**」：全仓只有一个 Cordis 根 `dshCtx`，由 DSH 持有并贯穿 DSH-IDE；IDE 侧不持有独立 `dshCtx`、不注册第二份 DSH 服务、不产生第二个 Cordis 根，也不向 VS Code 容器注入 DSH 服务。
3. 第 1 章 §7 禁止项维持：**禁止私有跨进程管道 / 私有握手**。DSH 应用内部（DSH 主进程外壳与 DSH Host 半身之间）只经官方客户端传输（Host 在 `--host 127.0.0.1 --port 0` 提供的官方 HTTP/WS）。这是 DSH 自身协议，不是第二条。
4. `DshIdeBackend` 实现形态：在 IDE 侧做官方客户端传输适配（P5 落地），把官方事件翻译成中立 `IdeEvent` 后交给 `DshIdeViewService` 投影；适配层文件必须放在 `platform/dshClient/common` 与 `electron-main` 之外，以保持 `boundary` 门禁。
5. 因此 P3 的 `DshIdeChannel` / `DshIdeViewService` 保持不变：二者在 IDE 侧工作，`IdeViewHost` 仍是通道层与 DSH 能力域之间的唯一接缝。

> **关于「同进程 / 单进程」的澄清**：DSH-IDE 作为 DSH 插件，运行在 DSH 应用之内——DSH 把 bundle 插件装载进其 Host 半身（B1 记录的 `spawn()` 子进程，承载 `dshCtx`），IDE 页面作为 DSH 应用的一个 UI 面呈现。二者同属一个 DSH 应用（非独立 app），其内部进程边界只走官方传输。故**不存在「把 Cordis 根强行塞进 DSH 桌面端 Electron 主进程」这类跨边界动作**：`dshCtx` 本就是 DSH 的，DSH-IDE 作为拓展直接复用。原 §3.1 曾把「IDE 与 Host 同进程」列为需改 DSH `apps/desktop` 的 B2② 选项并判定为越界不可行——该表述有误，已据澄清删除：DSH-IDE 从来就在 DSH 之内，无需越界。

K4 仍**未达成**：裁定解除了设计歧义，但第 4 条实现（官方客户端传输适配）属 **P3 活动**（K4 前置），尚未落地。写回 P5 会造成「K4 等 K5」的循环依赖，故明确归 P3。P4 不得启动。
| `DSH_IDE_API_VERSION` | 已对齐 `0.2.2-rc.1`（P3） | 已闭环 |
| `IdeViewSnapshot` 与 `DshIdeSnapshot.state` | 已并入 `state.view`，`wireRevision` 升为 2，行级校验随真源落地（P3） | 已闭环 |
| 错误码 | 五个码全部落地（`feature-unavailable` / `invalid-argument` / `ALREADY_RESOLVED` / `SESSION_SWITCHED` / `SNAPSHOT_STALE`）；`SNAPSHOT_STALE` 的消费点在 P4 | 已闭环（常量）/ P4（消费点） |
| `DshIdeConsumer` | 不存在；`validateDshIdeSnapshot` / `assertSnapshotContinuity` 尚未被生产代码调用 | P4 |
| 三批清理后的引用核对 | 第三批曾漏扫 `build/lib/test/dshBundleStaging.test.ts` 的字符串字面量断言，导致门禁持续红到 P1 才修正 | 已修复，规则见 §5 |
| P2 产物组的版本控制状态 | `golden/basic-session.json` 未被 `.gitignore` 命中（`git check-ignore` 退出 1），定稿时已 `git add`；同组 `translator.ts`、`ide-view-projector.ts`、`dshIdeProjection.test.ts`、`dshIdeVerify.mjs`、`package.json` 仍未纳入版本控制 / 未提交，而 `projection-golden` 门禁依赖前两个文件 | P6⑨ 一并 `git add` 并提交 |

### 4. 法律与许可文件登记

定稿时**未新增任何第三方依赖或素材**，`NOTICE.md` 保持原文。`git status --short -- '*LICENSE*' '*COPYING*' '*NOTICE*' '*ThirdPartyNotices*'` 返回空，确认下列文件未被改动。

**迁移结果**：原 `cleanup-inventory.md` 的法律/许可清单已迁入第 7 章 §4.1，维护规则留在 [`README.md`](../README.md) §1；第 6 章 §4.1 只放指针，本章不复制清单。

#### 4.1 法律/许可文件清单

| 文件 | 作用 | 定稿核验状态 |
| --- | --- | --- |
| `NOTICE.md` | 上游来源、商标与许可归属声明（VS Code MIT + DSH）；**不得重写** | 未改动 |
| `LICENSE` | 本仓库 MIT 许可文本 | 未改动 |
| `LICENSE.txt` | VS Code 上游 MIT 版权声明 | 未改动 |
| `ThirdPartyNotices.txt` | VS Code 第三方许可清单 | 未改动 |
| `build/dsh/chat-render/LICENSE-DSH` | DSH `ui-chat` 复用源的 MIT 副本 | 未改动 |
| `build/monaco/LICENSE`、`cli/ThirdPartyNotices.txt`、`extensions/*/ThirdPartyNotices.txt` | 上游随附的局部许可文件 | 未改动 |

`cglicenses.json` 已随上游 CI/合规配置清理于 2026-11-09 删除，不再列入；`cli/ThirdPartyNotices.txt` 是原 Rust CLI 唯一保留的法律文件。

`NOTICE.md` 为定稿时保留原文的法律文件，其中 `vscode-1.143.1/` 路径是扁平化前的历史表述；实际文件位于仓库根（`LICENSE.txt`、`ThirdPartyNotices.txt`）。按 [`AGENTS.md`](../AGENTS.md) §5 不得改写 `NOTICE.md`，故以本注记说明差异。

本仓库不存在 `COPYING` 类文件（已核实），不得凭空补写。`NOTICE.md` 的维护规则见 [`README.md`](../README.md) §1：只允许末尾追加，原文一字不动。

#### 4.2 来源凭据

| 文件 | 作用 | 规则 |
| --- | --- | --- |
| `src/vs/platform/dshClient/PROVENANCE.md` | 新桥搬用 DSH 官方客户端的来源凭据与审计 hash | 保留；上游升级时按第 5 章 §7 更新版本、commit 与摘要 |
| `build/dsh/chat-render/PROVENANCE.md` | sidecar 复用 `ui-chat` 20 个源文件的逐文件 sha256 与 MIT 声明 | 保留；由 `gen-provenance.mjs` 重生成 |
| `build/dsh/chat-render/LICENSE-DSH` | MIT License 全文（Copyright (c) 2026 DeepSeek） | 保留原文 |

删除任何文件后都必须重新核对上述凭据中的引用；凭据中的历史文件名属于合法的删除前快照记录。

### 5. 全仓核对命令

删除或重命名文件后的核对范围固定为 `src/` + `build/` + `scripts/` + `resources/`，且必须包含**文件名字符串字面量**（不能只扫符号名）。在项目根 `e:/DSH-IDE/` 执行：

```powershell
git grep -nE "launch-guard|launch\.js|buildIdeEnv|buildIdeArgs|handleLaunchRequest|makeReadSessions|resolveLaunchTarget|DSH_IDE_TOKEN_ENV|resolveIdeRuntime|launchIde" -- src build scripts resources
git grep -nE "terminal-stream|dshTerminalPty|dshTerminalSpawn|dshTerminalBridge|dshTerminalPrepare|dshTerminalProtocol|runTerminalStream|backendProbe|prepareDshTerminal" -- src build scripts resources
git grep -nE "dshClientTransport|dshClientProtocol|dshClientChannel|DshClientChannel|dshRemoteRequests|dshEventMap|bootstrapDshClient|DshClientTransport|dshClientBootstrap" -- src build scripts resources
git grep -nE "dshEventMap\.ts|dshSessionUri\.ts|dshChatSessions\.ts|dshChatProvider\.ts|dshChatProvider|dshBundleStaging" -- src build scripts resources
```

判据：代码引用为 0 命中；`PROVENANCE.md` 中的审计 hash 记录与 `docs/` 中的登记性提及属合法残留。`build/lib/test/dshBundleStaging.test.ts` 的字符串字面量断言必须一并核对（P1 的修正教训）。

### 6. 历史验证数值（不作为当前判据）

| 记录 | 数值 / 结论 |
| --- | --- |
| 历史数值与环境守卫 | 当前判据见第 5 章 §4；环境守卫固定执行方式见 §2.1；本表不再重复数值 |
| ABI 口径 | `node-pty` 按宿主 Electron 44.7.0 的 `NODE_MODULE_VERSION` 编译；`1.143.1` 是 VS Code 版本号，不是 ABI |
| 门禁实跑修正 | P1 实跑抓出并修正：`jsonValue` 与上游同名导出冲突（单源扫描限定 DSH-IDE 作用域）、2 个 `VSCODE_PATCH_POINTS` 路径不存在、依赖方向断言误判注释、遗留未使用的 `positiveInteger` |

当前门禁与测试的实测状态以第 5 章 §3–§4 为唯一依据。

### 7. 全局扫描登记（唯一性核验）

定稿核验（2026-11-08）对「唯一开发路线 / 唯一业务流程」做了全仓扫描。结论：文档层面无第二路线；代码与 CI 层面存在下列**已登记残留**。定稿时先修复 2 处代码引用（仅注释与 `description`，零逻辑变更），其余残留只登记、不改动；处置按 [`AGENTS.md`](../AGENTS.md) §6 与第 3 章 P3–P6 执行。

#### 7.1 旧编号残留（代码注释、配置、测试、数据文件）

| 位置 | 残留 | 归属阶段 |
| --- | --- | --- |
| `src/vs/platform/dshClient/electron-main/dshIdeChannel.ts` | 已清理（P3）：旧阶段标记与 `phase 2.x pending` 运行时错误串全部改为 P 编号/当前语义 | 已闭环 |
| `src/vs/platform/dshClient/electron-main/ide-view-service.ts` | 已清理（P3）：`阶段 3 第三批` / `阶段 2.x` 全部改为 P 编号 | 已闭环 |
| `src/vs/platform/dshClient/common/translator.ts`、`ide-view-projector.ts` | 已清理（P3）：`阶段 2.2a` / `2.2b` / `2.5` 改为 P 编号 | 已闭环 |
| `src/vs/platform/dshClient/common/dshIdeProtocol.ts`、`dshIdeContract.ts` | 已清理（P3）：`阶段 2.1` / `阶段 2.x` 改为 P 编号与当前语义 | 已闭环 |
| `src/vs/platform/dshClient/common/dshClientService.ts`、`legacy-account-endpoints.ts` | 已清理（P3）：`阶段 3 第三批` / `阶段 2.1-2.5` / `阶段 2.x` 改为 P 编号 | 已闭环 |
| `src/vs/platform/dshClient/client/client.js` | 已清理（P3）：错误串改为 `pending DshIdeChannel.open`，不再含 `phase 2` | 已闭环 |
| `src/vs/workbench/contrib/dsh/browser/dsh.contribution.ts`、`dshChatSeam.ts` | 已清理（P3）：`阶段 3 第三批` 改为当前语义 | 已闭环 |
| `build/lib/dsh/verify/dshIdeVerify.mjs:6,52,110,157,162,196` | `阶段 2.1`、`2.4`、`2.2a` 等脚本注释与一条断言文案 | P6 |
| `build/lib/test/dshIdeProtocol.test.ts:6`、`dshIdeProjection.test.ts:6`、`dshBundleStaging.test.ts:64` | `阶段 2.1` / `阶段 2.2a` 测试注释 | P6 |
| `build/gulpfile.vscode.ts:681` | `P5 终端流 runner` | P6 |
| `build/lib/dsh/verify/golden/basic-session.json:3` | 定稿时已修复：`2.2a` → `P2`、`verification.md §3.2` → `§5`；见 7.3 | 已闭环 |

#### 7.2 可能形成第二路线的开关

| 命中 | 判定 |
| --- | --- |
| `src/vs/workbench/contrib/dsh/browser/dshChatSeam.ts:60-62,198,206` 的 `dshChatRenderEnabled`、`setDshChatRenderEnabled`、`isDshChatRenderEnabled` | 全仓唯一 feature flag，默认 `false`。`git grep` 确认两个导出函数**无调用方**，接缝恒休眠，不构成第二条渲染路线；P4 启用单接缝时按路线激活。 |
| `src/vs/platform/dshClient/common/translator.ts:162` 的 `fallbackSeq` | 函数参数（序号兜底），不是路线开关。 |
| `legacy-account-endpoints.ts` | 文件与常量隔离，不是条件分支。 |
| `featureFlag`、`enableXxx`、`if (legacy)`、`isLegacy`、`useLegacy`、`legacyMode` | DSH 作用域内 0 命中。 |

#### 7.3 旧文档路径与章节引用

| 位置 | 引用 | 判定 |
| --- | --- | --- |
| `build/dsh/chat-render/build-render.mjs:10` | `docs/DEVELOPMENT.md 第 1 章 §3 能力域与数据流分层` | **已闭环**：先按章节实际标题修，再随 7 份文档合并改为本手册章号；零逻辑变更 |
| `build/lib/dsh/verify/golden/basic-session.json:3` | `docs/DEVELOPMENT.md 第 5 章 §5 的 P95 校准流程` | **已闭环**：原为 `§3.2`；`description` 不参与 golden 比对，`projection-golden` 门禁已复核通过 |
| `build/dsh/chat-render/gen-provenance.mjs:46` | `docs/DEVELOPMENT.md 第 1 章资源复用章节` | **已同步**：凭据生成器模板随合并一并更新，重生成不会回退 |
| `scripts/sync-upstream.mjs:6,192` | `verify:dsh-ide-contract`、`verify:dsh-ide-protocol-single-source` | 脚本名未变，有效 |
| `.github/**` | — | 已于 2026-11-09 整体删除，不再登记；仓库现无 `.github/` 目录 |
| 仓库根 `README.md` | — | 未发现指向本仓库 `docs/` 的链接、旧编号或徽章 |
| `build/lib/dsh/verify/dshIdeVerify.mjs:192` | 当前文案：`PENDING(2.5): 真实事件流 P95 字节数校准（见 docs/DEVELOPMENT.md 第 5 章 §5，参数校准非架构回退）` | **已闭环**：合并为单一手册时随引用修复一并替换；`PENDING(2.5)` 字面标记按 §7.1 归 P6⑨；`§9.3` 是 PENDING 判据而非 P95 校准章节，不作目标 |

#### 7.4 CI 接入

仓库已于 2026-11-09 删除 `.github/` 与 `build/azure-pipelines/`，当前无 CI 配置；四条门禁与 `test-dsh:all` 只在本地 `package.json` scripts 执行。第 5 章 §1 已按此事实定稿，接入 CI 归属 P6 步骤⑨（届时新建配置）。

#### 7.5 交叉引用图

合并为单一手册后，规格文档只剩 3 份：`README.md`、`AGENTS.md`、`docs/DEVELOPMENT.md`。定义依赖图为 3 节点、3 边（AGENTS→README、DEVELOPMENT→README、DEVELOPMENT→AGENTS），按 [`README.md`](../README.md) §4.1 序号单向、0 环；术语表只在 `README.md` §2 出现。正文导航链接允许双向，不参与定义依赖图、不得复制定义。核验脚本口径见第 5 章 §10.1，实测值以每次核验输出为准。

#### 7.6 2026-11-09 整理记录

| 项 | 结果 |
| --- | --- |
| 仓库根 | 已扁平化：`vscode-1.143.1/` 子目录不存在，仓库根即项目根 `e:/DSH-IDE/`；本手册命令与路径已去前缀 |
| 删除的上游工程配置 | `.github/`、`.config/`、`.devcontainer/`、`build/azure-pipelines/`、`build/vite/`、`build/rspack/`、`build/gulpfile.cli.ts` |
| 删除的上游测试/CLI | `extensions/vscode-api-tests/`、`vscode-colorize-tests/`、`vscode-colorize-perf-tests/`；`cli/` 源码与 `target/`（保留 `cli/ThirdPartyNotices.txt`） |
| 删除的根文件 | `README.vscode.md`、`AGENTS.vscode.md`、`.mcp.json`、`.lsifrc.json`、`.mention-bot`、`.mailmap`、`.git-blame-ignore-revs`、`cglicenses.json`、`.vscode-test.js` |
| 保留 | `.eslint-plugin-local/`（lint 依赖）、`.vscode/`（`extensions/` 被构建引用）、`build/next/`（`build-dsh-tests` 依赖）、`build/dictation-runtime/`（`gulpfile.vscode.ts` 直接 import） |
| 插件复用 | `client.js` 头部按钮改用宿主 `@deepseek-ai/dsh-client-ui-primitives` 的 `Button`（ghost/sm），去掉手写 `<button>` 与内联样式；`packaging.test.mjs` 7/7 通过 |
| 体积口径 | 压缩包 74,147,715 字节（<100 MB）；解压安装 285 MiB；安全瘦身目标 200–210 MiB，详见 §8.2.5 |
| 文档核验 | 定义依赖图 3 节点 / 3 边 / 0 环；术语表唯一；无断链 |

---

## 第 8 章 插件功能设计

### 8.1 设计基调与总边界

DSH-IDE = 把 VS Code 改造为 DSH 的 bundle 插件，是对 DSH 应用的拓展（非独立应用）：给 DSH 增加 IDE 页面并保留部分 IDE 功能。全仓只有一个 Cordis 根 `dshCtx`，位于 DSH Host 进程；IDE 侧不持有它，只经唯一通道与本机官方客户端传输消费 DSH 下发的中立 DTO（见第 1 章 §1、第 7 章 §3.1）。IDE 窗口只经唯一一条 `IServerChannel`（token `dshIde`）消费 DSH 下发的 `DshIdeSnapshot`；会话、模型、审批、工具、权限、语音均由 DSH 决定，IDE 侧不持有这些状态的第二份定义（不变量 I1–I4，见第 1 章 §1）。

由此划出三大功能域边界：

| 域 | 归属 | 不做什么 |
| --- | --- | --- |
| DSH 内核域 | DSH 决定（会话/模型/工具/权限/审批/语音） | IDE 不重写协议、不另立路线 |
| VS Code 宿主域 | VS Code 原生（编辑/调试/扩展/终端/Git/设置） | DSH 不接管非 AI 路径 |
| 渲染适配域 | 桥接两者（聊天侧栏/消息流渲染/配置面板） | 侧栏只呈现、不持有状态 |

红线：不得借复用引入第二份协议、第二条路线或第二条流程；任何复用资源须保留原许可证头（见第 1 章 §6、第 7 章 §4.1）。

### 8.2 DSH 资源复用

#### 8.2.1 复用策略总原则

- 优先级固定：① DSH 桌面端 `resources/app.asar` 内 `@deepseek-ai/**`（官方鲸鱼 favicon、各插件自带 `icon.svg`/`locale`/样式）；② VS Code 源码 `src/**`（codicons、主题、`resources/**`）；③ 确无可用资源才自绘，自绘须写明理由。
- 禁止手抄近似 LOGO / 近似资源路径；搬用须保留原许可证与版权头，记录 tree digest（格式见第 1 章 §6 与 `build/dsh/chat-render/PROVENANCE.md`）。
- 已复用清单与来源凭据见第 1 章 §6、第 7 章 §4.1；运行时可复用范围、禁止复用项与体积边界见 §8.2.5；插件侧任何新增功能/资源按 §8.2.6 的固定顺序（DSH 运行时 → DSH 源码 → 手写）决策。

#### 8.2.2 AI 聊天侧栏渲染 DSH 原始消息流

- 功能边界：侧栏是呈现层，会话状态在 DSH 内核；DSH 原始事件流 → 投影 → 快照 → 侧栏渲染（流程 T1–T9，见第 4 章 §4）。
- 数据通路（适配层已落地 P2，契约冻结 P1）：

  ```text
  DSH 事件流
    → translator.ts：穷举分类为封闭联合 IdeEvent（51 项类型、28 项 emit、never 收口；见第 2 章 §3）
    → ide-view-projector.ts：按稳定 row id 增量折叠为 IdeViewSnapshot{rows,version}（MAX_ROWS=600 等常量）
    → 通道 DshIdeChannel.call/listen（见第 2 章 §2）
    → IdeViewSnapshot 并入 DshIdeSnapshot.state，跨 dshIde 通道传输
    → IDE 侧 DshIdeConsumer（P4 规划）：校验 → 连续性 fail-closed → 16ms 合并 → 行级 diff
    → chatListRenderer.ts 的 tryRenderDshChatPart 消费点 / sidecar 渲染
  ```

- 外壳样式：AI 聊天面板容器保留 VS Code 原生样式（不另造外壳），仅消息内容由 DSH 渲染件（`tryRenderDshChatPart` / sidecar）接管，满足「原生外壳 + DSH 原生消息流」的双重要求。
- 复用渲染资源：侧栏消息气泡、Markdown、代码块、APNG 等直接复用桌面端 `ui-chat` 渲染资产（`build/dsh/chat-render/` 的 20 个源文件 + 合并 CSS + APNG），不另造渲染引擎；sidecar 经 `build-render.mjs` 由 React/ReactDOM 别名到单一副本构建。
- 一致性保证：两侧都走同一套 `translator` schema 投影，避免 IDE 侧自绘导致语义漂移；golden 回放（`projection-golden` 门禁，见第 5 章 §3）逐字节冻结快照。

#### 8.2.3 配置项复用（模型 / 思考强度 / 安全权限 / 模式选择）

- 功能边界：这些都是 DSH 内核的配置，IDE 侧只做透传与 UI 承载，不在本地定义第二份配置 schema。
- 集成方式（契约已定义，P5 接线）：DSH 下发配置 schema，IDE 面板直接渲染该 schema；用户选择经 `dshIde` 通道 method 回送：

| 桌面端配置项 | 通道 method（单源：第 2 章 §4） | 状态 |
| --- | --- | --- |
| 模型选取 | `listModels` / `setModel` | 契约已定义，P5 接线 |
| 思考强度 | `setEffort`（low/medium/high） | 契约已定义，P5 接线 |
| 安全权限 | `setPermissionPreset` + `approval/request` waterfall（两侧镜像、`ALREADY_RESOLVED` 去重） | waterfall 一致性核对在 P3 |
| 模式选择 | 由 DSH 下发的模式枚举，IDE 透传呈现（method 名以第 2 章真源为准，不本地造名） | P5 接线 |

- “与桌面端保持一致”的手段：IDE 不持有配置默认值，全部以 DSH 下发 schema 为准，桌面端改默认值 IDE 自动跟随。

#### 8.2.4 会话管理对齐（工作区范围 + 与桌面端同步 + DSH-IDE 直接删除）

- 功能边界：会话是 DSH 内核状态，IDE 侧不持有第二份会话表；会话列表来自 DSH 内核经 `dshIde` 通道下发的快照（契约 `listSessions` 已登记，P4 接线）。
- 工作区对齐：IDE 只显示**当前 DSH-IDE 打开工作区**内的会话，与 DSH 桌面端在该工作区显示的会话**完全同步**——两侧读同一份内核会话集合，不做本地缓存或本地新建会话源。
- 删除（直接删除，不入回收站）：DSH-IDE 必须提供删除会话能力，**无论 DSH 桌面端是否自带删除**；`deleteSession` 已加入契约真源（第 2 章 §4），调用方为 IDE 会话 UI，参数为 `{ sessionId }`，语义为**直接物理删除**、不进入任何回收站/软删除队列。删除后由内核回推快照，列表即时更新（fail-closed：删除失败则保留原列表，不静默丢弃）。

#### 8.2.5 运行时复用桌面端资源与体积边界

本节锁定「插件安装到 DSH 后，哪些桌面端文件可在运行时直接复用、哪些必须随插件打包、哪些禁止复用」。实测基线：DSH 桌面端 `0.2.2-rc.1` 安装版与 `dsh-ide@2.0.0` 安装目录（2026-11-09）。

**（1）安装后可访问的桌面端目录**

| 目录 | 内容 | 访问面 |
| --- | --- | --- |
| `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-ide\` | 插件包：`runtime/app`、`chat-render/`、`host/`、`client.js`、`index.js`、`locale/`、`icon.svg` | 插件自身可读写 |
| `%USERPROFILE%\.dsh\profiles\desktop\` | profile 清单、`cordis.patch.yml`、`pnpm-lock.yaml`、`node_modules/` | 插件安装与加载 |
| `<DSH 安装目录>\resources\app.asar\dsh\node_modules\@deepseek-ai\**` | 宿主包：`dsh-client-ui-chat`、`ui-theme`、`ui-primitives`、`client-locale`、`client-resources`、`ui-brand-official`、`dsh-web-frontend` 等 | 只读；Host 可 import，client 经 module table |
| `<DSH 安装目录>\resources\app.asar.unpacked\` | 原生二进制回退 | 只读 |
| `<DSH 安装目录>\resources\runtime\` | Node/pnpm/Python 运行时 | 只读 |
| `%LOCALAPPDATA%\.dsh-ide\` | IDE 的 Electron、extensions、user-data | IDE 自有 |

渲染进程只有两个 URL 面：宿主 dist 根与 `/plugins/<pkg>/assets/<path>`。后者仅对声明 `"./assets/*": "./lib/assets/*"` 的包生效，且仅支持 `svg/png/webp/jpg/jpeg`；CSS、`woff2`、JSON 不在白名单，渲染进程也没有文件系统通道。

**（2）当前自打包资源（实测 `dsh-ide@2.0.0`）**

| 项 | 大小（字节） | 与桌面端关系 | 处置 |
| --- | --- | --- | --- |
| `runtime/app` | 299,381,810（约 285 MiB） | 不重复：VS Code IDE 载荷；DSH 桌面端不含 VS Code | 保留；`appOnly` 已复用宿主 Electron/Node |
| `dist/dsh-ide-2.0.0.tgz`（压缩包，tar.gz 同口径） | 74,147,715（约 70.7 MiB） | 压缩分发物；**< 100 MB** | 保持；与安装体积 285 MiB 区分 |
| `chat-render/dist/dsh-chat.js` / `.css` | 408,062 / 61,448（合计 469,510） | **重复**：与 `runtime/app/out/.../chatRender/` 同一份 | 删除插件根副本，只留 `runtime/app/out/.../chatRender/` |
| `chat-render/PROVENANCE.md` / `LICENSE-DSH` | 小 | 法律与来源凭据 | 保留 |
| `icon.svg` / `locale/*.json` | 3,573 / 529 | 插件元数据；运行时按钮图标已用宿主 `/favicon.svg` | 保留（安装前元数据） |
| `client.js` / `index.js` / `host/` / `common/` | 4,562 / 7,244 / 34,036 / 590 | 不重复 | 保留 |

`runtime/app` 的构成（同一次实测）：`extensions` 115,846,593、`out` 74,990,508、`node_modules.asar` 72,146,952、`node_modules.asar.unpacked` 31,330,250、`node_modules` 4,858,615，其余为 `product.json` 等小文件；全部是 VS Code IDE 载荷，不是 DSH 资源副本。

其中 `extensions` 的大头：`mermaid-markdown-features` 47,782,907、`markdown-language-features` 9,449,263、共享 `node_modules` 34,506,641（`typescript` 23,031,995 + `@esbuild` 11,365,750），其余扩展合计约 24 MB。按 AGENTS §4，Mermaid/Markdown 及其运行依赖必须完整保留，前三项合计约 91.7 MB 是安装体积的硬下限。

压缩包同口径（tar.gz）实测 74,147,715 字节（约 70.7 MiB），低于 100 MB；285 MiB 是解压安装体积。分发体积看压缩包，磁盘占用看安装体积，两者不可混用。

**（3）可在运行时直接复用的桌面端资源**

| 资源 | 位置 | 复用方式 | 功能点 | 状态 |
| --- | --- | --- | --- | --- |
| Electron / Node 宿主 | DSH 安装目录 | 插件 `appOnly`，不自带 Electron | IDE 启动、终端 PTY、扩展宿主 | 已复用 |
| `@deepseek-ai/cordis`、`schemastery`、`typert-protocol` | `app.asar/dsh/node_modules` | `peerDependencies` + Host import | 插件 Host 生命周期、Typert 远程派发 | 已复用 |
| `react` / `react-dom` / `dsh-client-ui-slots` | 宿主平台单例 | `client.js` 的 `require('react')` + `inject: ['slots']` | DSH 会话头部按钮 | 已复用 |
| `dsh-client-ui-primitives` 的 `Button` | 宿主平台单例（`@deepseek-ai/dsh-client-ui-primitives`） | `client.js` 的 `require('@deepseek-ai/dsh-client-ui-primitives')` | 会话头部「DSH-IDE」按钮（官方 ghost/sm 样式） | 已复用（2026-11-09） |
| 官方鲸鱼 favicon | 宿主 `/favicon.svg` | `client.js` 直接引用 | 头部按钮图标 | 已复用 |
| `dsh-client-ui-chat` 的 APNG | `.../ui-chat/lib/assets/running-whale@2x-*.png` | 仅 DSH client 半身可 `require.asset('plugins/@deepseek-ai/dsh-client-ui-chat/assets/...')` | DSH 窗口内聊天气泡 | 可用；当前侧栏在 VS Code renderer，不适用 |
| `dsh-client-ui-chat` 的 locale JSON | `.../ui-chat/locale/{en,zh}.json` | 构建期只读源；运行期仅 DSH client 可读 | 聊天文案 | 构建期已复用（`src/locale.ts` 逐字副本） |
| `dsh-client-ui-theme` 字体 | `.../ui-theme/lib/styles/montserrat-*.woff2` | 仅 DSH client 可 import | DSH 品牌字体 | 不适用（侧栏使用 VS Code 主题字体） |
| `@vscode/ripgrep` 的 `rg.exe` | `app.asar.unpacked/dsh/node_modules/@vscode/ripgrep-win32-x64/bin/rg.exe`（5,443,048） | 重定向 `@vscode/ripgrep` 的 `rgPath`（包名/路径与插件侧 `@vscode/ripgrep-universal` 不同） | 搜索 | 可复用；需路径与版本核对 |
| `node-pty` 原生二进制 | `.../node-pty/prebuilds/win32-x64/*.node`（约 0.45 MB） | 重定向 `node-pty` 的原生加载路径 | 终端 PTY | 可复用；插件侧为 `build/Release`（约 2.4 MB），ABI 同为 Electron 44.7.0，需加载路径核对 |
| 64 个共享 JS 包 | `app.asar/dsh/node_modules` | 去重/路径重定向 | 工具库（`zod`、`semver`、`ws`、`undici`、`@xterm/*` 等） | 需版本矩阵核对；收益小于风险 |

已复用且无需改动：Electron/Chromium/Node（`runtime/app` 无 `electron.exe`、`resources.pak`、`icudtl.dat`）、Host 包（`runtime/app` 无 `@deepseek-ai`）、`/favicon.svg`、React/slots（见上表）。

**（4）禁止复用（耦合 / 路径 / 版本）**

| 资源 | 原因 |
| --- | --- |
| `@deepseek-ai/dsh-client-ui-chat/lib/client.js` | DSH client 运行时专用：依赖 `window.__ModuleLoader__`、`__DSH_BOOT__`、11 个平台单例、cordis 注入行与宿主 origin；VS Code renderer 是 `vscode-file://` 独立窗口，无 module table / 文件系统 / `/plugins` URL，直接 import 会在 boot 阶段 throw |
| `ui-chat` 的 CSS / `woff2` / JSON | 宿主静态服务只暴露 `/plugins/<pkg>/assets/*` 且仅 `svg/png/webp/jpg/jpeg`；CSS、`woff2`、JSON 不在白名单；renderer 无文件系统通道 |
| `ui-theme` 的 CSS / `woff2` | 同上；且 DSH 主题 token 与 VS Code 主题变量冲突，直接加载会破坏原生外观 |
| `ui-brand-official` / `dsh-brand` 资产 | 面向 DSH client 插槽与品牌，版本耦合，VS Code renderer 不可达 |
| `ui-tool` 的 `ToolRow` | 插件明确保留 VS Code 原生工具渲染；复用需引入 DSH client 运行时并改变 UI |
| DSH 会话 / 工作区 / LLM 控制器 | 必须经 `dshIde` 通道（I2/I3）；直接 import 会产生第二份协议或状态 |
| `resources/runtime`（Python）与 `app.asar.unpacked` | DSH 专用 / ABI 耦合；IDE 不需要 |
| `dsh-web-frontend/dist` 的 JS/CSS 壳 | DSH Web 外壳，不是组件库；加载会拉入整套 DSH boot |

**（5）加载优先级（固定，不得新增第二条）**

1. Host 进程：`@deepseek-ai/*` 一律 `peerDependencies` + 宿主 Cordis，不打包。
2. DSH client 半身：`require` 宿主平台单例（`react`、`dsh-client-ui-slots`、`dsh-client-ui-primitives` 等）；图片用 `require.asset`（仅 `./assets/*` 包）；图标用 `/favicon.svg`；不打包 React/图标/官方原子组件。
3. VS Code renderer 侧栏：宿主资源不可达，sidecar 必须自包含；唯一允许的复用是构建期从 `ui-chat` 只读源复制，版本锁定 `UPSTREAM_VALIDATED_VERSION`，由 `regen-sources.mjs --check` 与 `PROVENANCE.md` sha256 守护。
4. 禁止：在 renderer 中 `file://` 读 `app.asar`，或把宿主 `ui-chat/lib/client.js` 塞进 VS Code renderer；失败只会静默降级为原生渲染，属于回归。

**（6）体积优化动作（按收益排序）**

| 动作 | 预期收益 | 验收 |
| --- | --- | --- |
| 删除插件根 `chat-render/dist/` 重复副本 | 约 469 KB | 改 `build/lib/dsh/package.json` 的 `files` 与 `gulpfile.vscode.ts` 的 staging；跑 `packaging.test.mjs` + 真机开窗 |
| sidecar JS/CSS 开启 minify | 预计 150–200 KB | 改 `build-render.mjs` 的 `minify`；视觉回归 + `projection-golden` |
| APNG 从 CSS data URL 改为独立文件 | 约 7 KB | 用 `FileAccess.asBrowserUri` 重写 URL；动画回归 |
| `out` 改用 `out-vscode-min`（当前 `dsh-ide-pack` 绑定非压缩 `out-vscode`） | 预计 35–45 MB | 改 `dsh-ide-pack` 绑定 minified 构建；跑打包 + 真机开窗 + 视觉回归 |
| 剔除 `playwright-core`（测试专用，`src`/扩展运行时零引用） | 12,718,734 字节 | `gulpfile.vscode.ts` 的 `dependenciesSrc`/`filter` 增加排除；跑 `test-dsh:all` + 真机 |
| 剔除 `esbuild` / `@esbuild`（构建工具） | 约 22.8 MB（asar 11.5 MB + `extensions/node_modules` 11.4 MB） | 同上 + `build/lib/extensions.ts` 过滤；打包后确认无运行时引用 |
| 剔除 `@types/*`（纯类型声明） | 约 23 KB | 同上；可忽略 |
| 复用 DSH `@vscode/ripgrep` / `node-pty` | 约 7–8 MB | 路径/ABI/版本核对；搜索与终端回归 |
| 裁剪非必需内置扩展（保留 Mermaid/Markdown + 共享依赖约 91.7 MB） | 最多约 24 MB | 产品决策；与「91 个内置扩展」交付口径冲突，需批准 |
| 复用宿主 Electron/Node | 已生效（`appOnly`） | 保持 |

**（7）结论**

- **分发体积**：压缩包同口径（tar.gz）74,147,715 字节（约 70.7 MiB），已低于 100 MB；285 MiB 是解压安装体积。两者不可混用。
- **安装体积**：`runtime/app` 299,381,810 字节，其中 `extensions` 115.8 MB（Mermaid/Markdown + 共享依赖约 91.7 MB 为 AGENTS §4 必须保留）、`out` 75 MB（当前非 minified）、`node_modules.asar` 72 MB + unpacked 31 MB（VS Code 运行依赖，DSH 无对应包）。
- **DSH 资源复用上限**预计 8–10 MB（`@vscode/ripgrep` 5.4 MB、`node-pty` 约 1.8 MB、64 个共享 JS 包需实测），需路径/ABI/版本核对；不得为了复用把 DSH client 运行时塞进 VS Code renderer。
- **安装体积下探**：先剔除构建/测试依赖（`playwright-core` 12.7 MB + `esbuild`/`@esbuild` 约 22.8 MB + `@types/*`），再加 `out-vscode-min`（35–45 MB）、sidecar 去重/minify（约 0.6 MB）、复用 DSH `ripgrep`/`node-pty`（约 7 MB），安装体积可到 **约 200–210 MiB**；再裁剪非必需扩展（最多约 24 MB）可到 **约 180–190 MiB**。仍无法到 <100 MiB：Mermaid/Markdown + 共享依赖约 91.7 MB、VS Code `out`/`node_modules` 是硬下限。扩展裁剪与「91 个内置扩展」交付口径冲突，需产品决策。
- 版本漂移：宿主 `ui-chat` 源升级时按第 5 章 §7 更新 `PROVENANCE.md` 与 `UPSTREAM_VALIDATED_VERSION`；不得直接引用新版 `lib/client.js`。

> 证据：DSH 源码 `apps/desktop/src/paths.ts`（profile 目录）、`packages/boot/app-boot/src/profile.ts`（bundle 解析）、`packages/client/modules/src/index.ts`（`/plugins` 与 module table）、`packages/client/web/src/seed.ts`（平台单例）、`packages/host/frontend-static/src/index.ts`（静态服务白名单）、`packages/client/ui-chat/package.json`（`./assets/*` 与 `./client`）；安装目录、文件大小与本机实测一致（2026-11-09）。

#### 8.2.6 插件改动的复用优先级（R0，每轮必须遵循）

**本规则编号 R0，每一轮插件改动都必须执行；摘要见 §0。**

任何插件侧新增功能、UI、资源或构建产物，按以下**固定顺序**决策，不得跳级：

1. **先看 DSH 桌面端运行时资源**：安装版 `app.asar` / `app.asar.unpacked` 内的 `@deepseek-ai/**`、宿主模块行、`require.asset` 可访问资产、`/favicon.svg`、平台单例（`react`、`dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-ui-dockkit` 等）。
   - Host 进程：`peerDependencies` + 宿主 Cordis。
   - DSH client 半身：`require` 平台单例 + `require.asset` + 宿主 URL。
   - 能直接复用就改代码接上，不新造。
2. **再看 DSH 源码**：运行时不可直接复用时，按源码颗粒度从 `E:/deepseek-harness-0.2.2-rc.1/packages/client/**` 复制最小文件集，保留许可证头与 `PROVENANCE.md`，版本锁定 `UPSTREAM_VALIDATED_VERSION`。
3. **最后才手写**：以上都不可行时自写，并在提交信息写明「为何不能复用/参考」。

**当前已接上的复用**（2026-11-09）：

| 层 | 复用项 | 接入点 |
| --- | --- | --- |
| IDE 宿主 | Electron / Chromium / Node | 插件 `appOnly`，不自带 Electron |
| Host 半身 | `@deepseek-ai/cordis`、`schemastery`、`typert-protocol` | `peerDependencies` + Host import |
| DSH client 半身 | `react`、`dsh-client-ui-slots`、`dsh-client-ui-primitives`、`/favicon.svg` | `client.js` 的 `require` / `inject` / 宿主 URL |
| DSH client 半身 | 官方 `Button`（ghost/sm） | `client.js` 头部按钮，2026-11-09 替换手写 `<button>` 与内联样式 |
| VS Code renderer | `ui-chat` 20 个源文件 + CSS + APNG | 构建期 sidecar（`build/dsh/chat-render/`） |

**边界**：VS Code renderer 不能直接 `require` 宿主模块行或读 `app.asar`，只能走构建期源码复用（见 §8.2.5 第（4）条）。`@vscode/ripgrep` / `node-pty` 的运行时复用依赖 P5 启动/路径传递，未接线前不得硬接；当前仍随插件打包。

**手写例外**：sidecar `shims/primitives.tsx` 的 `Tooltip` 仅做原生 `title` 降级（上游 273 行 portal/placement 复合体未复制）；`UserMessageBubble` 按上游 14 行如实复刻。两者均已在 `build/dsh/chat-render/PROVENANCE.md` §4/§7 登记。

### 8.3 VS Code 原生能力保障

#### 8.3.1 插件生态保障

- 功能边界：完整保留扩展宿主、扩展市场、扩展 API、扩展运行依赖、远程连接；移除的只是 Copilot/AgentHost 与重复 VS Code Agent Sessions 的专属源码与入口，通用宿主保留。
- 集成方式：DSH 作为唯一插件 `dsh-ide@2.0.0` 注入（入口 `index.js`，bundle 清单 `build/lib/dsh/package.json`；整仓构建产物即该插件，IDE 是其内嵌运行时，不是独立产品），不改动扩展加载机制；Mermaid、Markdown 功能及其运行依赖完整保留。

#### 8.3.2 非 AI 功能正常运作

- 功能边界：编辑、调试、终端、Git、搜索、设置等全部非 AI 路径保持原状，DSH 不接管。
- 集成方式：DSH 入口只由“DSH 主窗口点击 DSH-IDE”触发开窗，`dshChatSeam.ts` 单接缝默认休眠（`dshChatRenderEnabled = false`）；默认 VS Code 窗口零 DSH 介入，原生功能零回归（门禁 `boundary` 守护，见第 5 章 §3）。

#### 8.3.3 以 tool 形式把 VS Code 能力接入 DSH

- 功能边界：VS Code 中“可补充给 DSH”的能力（读写文件、运行命令、检索、编辑器操作等），封装为 DSH tool，经 `dshIde` 通道暴露给 DSH 内核调用，IDE 侧执行后回送结果。
- 复用策略：tool 后端复用 VS Code 既有服务（`workspace`/`tasks`/`terminal`/`search` 等），不重写；tool 清单、权限与生效由 DSH 决定，IDE 不持有第二份 tool 表。
- 集成方式：通过契约真源（第 2 章）的 method 承载（如 `runCommand` 已定义；文件/检索类 method 在路线 P5 按同一单源登记），确保所有 tool 入口只有一份清单、可 fail-closed 校验。

### 8.4 复用策略与集成方式汇总

| 需求项 | 功能边界 | 复用策略 | 集成方式 | 落地状态 |
| --- | --- | --- | --- | --- |
| 复用 DSH 桌面端资源 | 仅资源文件，不动内核 | 优先 app.asar → VS Code src → 自绘 | `PROVENANCE.md` 登记 + 许可头保留 | 已部分（sidecar 20 源文件已复用） |
| 侧栏渲染 DSH 消息流 | 呈现层，不持状态 | 复用 `ui-chat` 渲染资产 | translator→projector→通道→消费者→`tryRenderDshChatPart` | P2 投影冻结，P4 消费者规划中 |
| 配置项一致 | 透传，不定义第二份 schema | 渲染 DSH 下发 schema | `listModels`/`setModel`/`setEffort`/`setPermissionPreset` + waterfall | 契约 P1，P5 接线 |
| 插件生态 | 不改扩展加载 | 保留宿主/市场/API/依赖 | 唯一插件注入 | 已保障 |
| 非 AI 功能 | 零接管 | 原生路径不动 | `dshChatSeam` 休眠 + 独立窗口触发 | 已保障 |
| tool 接入 DSH | VS Code 能力→DSH tool | 复用既有服务 | `dshIde` method 单源登记 | P5 规划 |

### 8.5 风险与边界红线

1. 不引入第二协议/路线：所有复用与集成都只经 `dshIde` 单通道、单源（第 2 章）。
2. 资源复用经登记：任何搬用须留 `PROVENANCE.md` 记录，禁止伪造 Git commit、禁止手抄 LOGO（见第 1 章 §6）。
3. 非 AI 零回归：DSH 入口默认休眠，门禁 `boundary` 持续校验 `workbench/**` 零越界与零 Cordis 泄漏（见第 5 章 §3）。
4. 配置/审批以 DSH 为准：IDE 面板不本地定义配置值，避免与桌面端漂移。

### 8.6 与现有手册的映射

以上设计对应本手册既有章节：架构不变量（第 1 章）、契约与 20 method（第 2 章）、路线 P0–P7（第 3 章，P2 投影冻结 / P3 通道 / P4 消费者 / P5 功能接线）、流程 T1–T9（第 4 章）、门禁与验证（第 5 章 `projection-golden` / `boundary`）。本章不新增架构，仅把“资源复用 + 原生保障 + tool 接入”的边界与策略显式落到这些既有章节。

### 8.7 冲突消解清单（VS Code 原生 AI 能力与 DSH）

VS Code 1.143.1 源码自带一套原生 AI/Chat/Agent/Session 能力；DSH 作为唯一 AI 内核注入。凡二者提供**同一功能且会同时生效**者，以 DSH 为准，移除或禁用 VS Code 侧对应配置/注册。下表逐项说明处理与理由。

| 项 | VS Code 侧（冲突点） | DSH 侧（为准） | 处理 | 理由（抛弃/保留） |
| --- | --- | --- | --- | --- |
| C1 默认 Chat Agent | `product.json` `defaultChatAgent` 指向 GitHub Copilot（整套 entitlement/voice/mcp 配置） | DSH 为唯一 AI 插件 | **已移除** `defaultChatAgent` 整段 | 抛弃：Copilot 默认会抢占 AI 入口；Copilot 未内建、市场为 open-vsx，移除零功能损失 |
| C2 受信扩展授权 | `product.json` `trustedExtensionAuthAccess` 含 `GitHub.copilot-chat` | DSH 不走该 OAuth 深链 | **已移除** github/github-enterprise 两项，保留 `microsoft: vscode.github-authentication` | 抛弃 Copilot 自动授权；保留原生 GitHub 登录扩展（非 AI，可作原生账号能力） |
| C3 微软语音端点 | `product.json` `voiceWsUrl` 指向 Microsoft 实时语音 | DSH 实验语音（DSH 决定启停/provider） | **已移除** `voiceWsUrl` | 抛弃：语音属 AI 能力，须以 DSH 为准；本地听写只接 DSH |
| C4 原生 Chat 视图容器 | `chatParticipant.contribution.ts` `DSH_DISABLE_CHAT_UI=false` → 原生容器默认注册 | DSH 接缝 `tryRenderDshChatPart` 接管消息内容 | **保留容器（外壳）**，不置 `DSH_DISABLE_CHAT_UI=true` | 保留：用户要求 AI UI 保持 VS Code 原生样式；容器外壳保留，仅消息内容由 DSH 渲染件接管 |
| C5 原生 chatParticipants 扩展点 | `chatParticipant.contribution.ts` 无条件 `registerExtensionPoint('chatParticipants')` | DSH 是唯一种子参与者 | **保留扩展点**（C1 后无原生参与者，不会生成原生 AI 内容） | 保留：扩展点是平台能力，无参与者扩展时不产生 AI 内容；移除反而破坏原生外壳可扩展性 |
| C6 原生 Chat 会话存储/删除 | `chatSessionsService.ts` `IChatSessionStore.deleteSession`、原生会话 UI | DSH 会话由内核下发、IDE 实现删除 | **依赖 C1 消解**：无原生参与者→原生会话恒空；DSH 会话列表/删除由通道接管，原生会话 UI 不承载 DSH 会话 | 保留原生存储实现（代码不删），运行时无原生 AI 会话，故不与 DSH 冲突；DSH 会话管理见 §8.2.4 |
| C7 原生 Agent Sessions / AgentHost 会话 UI | `chatSessions.contribution`（`IAgentSessionsService` / `editorRemoteAgentHostServiceClient.listSessions`） | DSH 会话模型 | **决定禁用**其 UI 注册（保留远端连接传输层，见 AGENTS.md §4（构建与保留边界）） | 抛弃 Agent Sessions 检视器（与 DSH 会话并行的第二套 AI 会话）；保留远程连接机制本身，仅拆掉其 AI 会话暴露面 |
| C8 两路贡献同时加载 | `workbench.common.main.ts` 原生 chat 全家桶 + DSH 贡献同时注册 | — | 原生侧仅保留外壳/样式模块（C4），原生 AI 内容生成/会话/agent 由 C1/C6/C7 消解 | 确保两者不同时生效：原生壳 + DSH 内容 |

> 注：C7 的 UI 注册禁用（改造 `chatSessions.contribution` / `chatViewPane` 的 sessionsViewer）属 chat-core 改动，需在 P4/P5 接缝接线时随构建门禁（`boundary`、类型检查）一并落地；本手册先锁定决策与代码位置，避免与休眠通道并行施工引入回归。C1–C3 已落地于 `product.json`，`deleteSession` 已落地于契约真源（第 2 章 §4）。
