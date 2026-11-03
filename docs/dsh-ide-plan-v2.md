# DSH-IDE 改造计划 v2（唯一事实来源 · 定稿）

> 定位：**把 `vscode-1.143.1` 改造成一个「用官方标准编写的 DeepSeek Harness 桌面端插件」。** 它不是第二个 agent、也不是第二个内核，而是 **DSH 桌面 App 那个唯一 Host（唯一内核/唯一 agent）的第二个官方客户端**，为 DSH 补上 Cursor 式的完整 IDE 界面与 IDE 功能。
>
> 本文件取代 v1。v1 的「私有命名管道 + 手写桩」架构作废，归档于 `docs/archive/` 仅供考古。

---

## A. 产品定义（冻结）

1. **IDE 插件的目的**：给 DeepSeek Harness 提供一套 IDE 界面 + IDE 功能（编辑器/文件树/终端/搜索/diff/行内补全/行内编辑），补齐 Cursor 式体验。
2. **agent 只有 DSH**：插件本地**没有**任何 model / agent / session 引擎；一切推理与工具调用都由 DSH 提供。
3. **保留原有 AI 功能**：聊天、行内补全、行内编辑、诊断上下文等 IDE 内 AI 能力全部保留，但**后端一律是 DSH**（经官方 Remote 调用其内核）。
4. **一个 agent，两种形态**：
   - **deepseek-harness 形态** = 官方桌面/网页 GUI。
   - **DSH-IDE 形态** = 本插件改造后的 VS Code 工作台。
   - 两者连**同一个 Host 进程、同一套内核、同一份 session log** → 天然就是"一个 agent、两种形态"。
5. **只作为桌面端插件**：以官方 bundle 插件形式装进 DSH 桌面 App 的 `desktop` profile，由 `plugin_manager.install_bundle` 安装。
6. **会话同步范围**：不强制两端打开同一工作区；但**同一工作区下的会话记录必须完全一致**（同一 Host + 同一 `session.follow` 流 + 按工作区寻址的 `session.list`）。
7. **品牌**：VS Code 的 VSCode/Code-OSS 品牌与图标全部替换为 DSH logo；所有动态标识（启动/加载/欢迎 hero/空态/动效）重新设计，贴合 DSH 主题与鲸鱼/鱼形视觉。
8. **核心改动发生在 vscode 源码里**：DSH-IDE 的一切客户端逻辑、IDE 功能、品牌，都改在 `vscode-1.143.1` 源码内；Host 侧只保留最小官方 bundle 插件。

---

## B. 冻结决策汇总

| # | 决策 | 结论 |
|---|---|---|
| D1 | 拓扑 | **DSH-IDE = 桌面 App 单一 Host 的第二个官方客户端（同进程/同内核/单 agent）**；不自起 Host、不自带 agent |
| D2 | 传输 | **全官方**：`dsh-client-connection`（`/api` + `/api/remote.mux` + launch-token→签名 cookie）、`dsh-api-gateway`（`@Remote/@RemoteScope`）、`dsh-client-modules`（`__DSH_BOOT__` 客户端图）；**删除**私有命名管道、手写桩、`ide_*`、通道 B |
| D3 | 聊天 | 官方 `ui-chat`/`ui-conversation`/`api-session-controller(client)` 组合 + 官方 connection；**去掉假数据桩**（保留官方包本身） |
| D4 | IDE 动作 | 读写/编辑 → 官方 `tool-fs`/`fs-local`/`fs-sandbox`；LSP → `lsp-stdio`/`tool-lsp`；终端 → `terminal`/`tool-bash`；diff/评审 → `deliverables/tool-present`/`workspace-changes`；**IDE 专属**动作用官方 `@Remote` 扩展（`ctx.remote.ide.*`） |
| D5 | 启动入口 | 由 **DSH 桌面内「在 IDE 中打开」** 触发拉起 DSH-IDE 并连同一 Host；**IDE 不自起 Host** |
| D6 | 品牌 | 全站替换 DSH logo（源 `apps/desktop/resources/icon*.svg`、`ui-brand-official` 的 `FishLogo`/`BrandWordmark`）；动态标识重新设计；对外分发加"非官方/built on DSH"合规声明 |
| D7 | 会话同步 | 同一 Host + `session.follow` 双端实时；`session.list` 按 working-directory 过滤 → 同工作区记录一致，不同工作区互不干扰 |
| D8 | 打包 | `npm pack` 一个 bundle → `install_bundle` 装进 `desktop` profile；客户端产物按官方 `/plugins/.../client.js` 约定 |
| D9 | 版本锚定 | VS Code 固定 `1.143.1`；对准已装 DSH `0.2.1-rc.5`，字段以 asar/实时 `cordis_inspect` 为准 |

---

## C. 官方传输通道全清单（源码证据）与旧自造物替换

| # | 官方通道（源码证据） | 职责 | 被替换的旧自造物（删） |
|---|---|---|---|
| ① | `dsh-host-webserver`(`ctx.webServer`) + `dsh-client-connection`(`/api`、`/api/remote.mux`、`browser-auth.ts` 的 launch-token→cookie、`api-request-trust.ts` 的 Host/Origin 栅栏、`authorizeConnect()` 换 **API Peer**、`peer.ts`) | 任意客户端↔Host 唯一传输 | `host/protocol.js`、`host/pipe.js` |
| ② | `dsh-api-gateway`(`ctx.typertGateway`/`ctx.remote`，`@Remote/@RemoteScope`) + `dsh-api-remotes` | 类型化调用/流/取消/peer | `host/services.js` + 通道A 帧 |
| ③ | `dsh-client-modules`(`window.__DSH_BOOT__` WebBootGraph + `/plugins/.../client.js` 惰性 CJS 表) | 装载客户端 UI 插件 | `chatapp/stubs/**` 假数据桩 + `chatWebview` postMessage 桥 |
| ④ | `apps/desktop` + `apps/desktop-host`(`runProfile('desktop')`、`dsh-app://`、`web-document.ts` 的 `authenticateWebHost`/`forwardWebRequest`、`main.ts` 注入 `__DSH_TRANSPORT__.streamBaseUrl`) | 桌面载体 / 壳↔Host | `host/launch.js` 的自造 Electron 加载（改为仅 spawn + 注入端点/token） |
| ⑤ | `api/session-controller`、`api/workspace-controller`、`api/terminal-controller`、`api/workspace-files` | 会话/工作区/终端/文件 | `chatWebview` 自解析帧、`ideExec` 通道B |
| ⑥ | 工具能力缝：`tool-fs`/`fs-local`/`fs-sandbox`、`lsp`/`lsp-stdio`/`tool-lsp`、`terminal`/`terminal-bash`/`tool-bash`、`deliverables/tool-present`、`workspace-changes` | 给 agent 的读写/LSP/终端/评审 | `host/tools.js` 的 `ide_*` 工具 |
| ⑦ | `dsh-sdk-*`（`--profile sdk`）、`dsh-acp`（`--profile acp`）、`dsh-headless` | 进程外脚本/自动化（备用，非必需） | — |

> 唯一"无官方现成接口"的只有 **渲染 VS Code workbench** 和 **行内补全/行内编辑** 这类 IDE 专属 UI —— 它们以**官方客户端 + 官方 `@Remote` 扩展方法**接入，仍然 100% 走官方传输。

---

## D. 目标架构（单内核 · 双客户端）

```
┌──────────────── DSH 桌面 App（官方 Electron，apps/desktop）────────────────┐
│  desktop-host 子进程 = runProfile('desktop')  ← 唯一内核/Host/agent            │
│  Host 侧：dsh-base + dsh-web-app（官方 session/llm/tools/persistence/approval…）│
│          + 【本仓库 bundle 插件 dsh-ide】（装进 desktop profile）               │
│            · 官方 @Remote 暴露 IDE 扩展 ctx.remote.ide.*（openFile/revealDiff/  │
│              inlineComplete/diagnostics …，后端 ctx.llm / 原生编辑器回显）        │
│            · 扮演"壳"的交付方：把 hostUrl + launchToken 交给 DSH-IDE 客户端       │
│  Transport：dsh-client-connection（/api + /api/remote.mux + cookie）           │
└──────────▲───────────────────────────────────────────────▲──────────────────┘
  官方客户端①（桌面/网页壳）                        官方客户端②（DSH-IDE 形态）
┌──────────┴──────────┐                        ┌───────────────┴────────────────────────┐
│ deepseek-harness 形态│                        │ DSH-IDE（vscode-1.143.1，DSH 品牌）    │
│ 官方 GUI（ui-chat 等）│                        │ 主进程：官方载体 authenticateWebHost +   │
│                      │                        │   forwardWebRequest + /connect(API Peer)│
│                      │                        │ 渲染器：workbench 原生 IDE（编辑器/终端/  │
│                      │                        │   搜索/diff/LSP）                       │
│                      │                        │ 聊天 webview：官方 ui-chat 组合 + 官方    │
│                      │                        │   connection（无假桩）→ 同一 Host         │
│                      │                        │ 行内补全/编辑：ctx.remote.ide.*（DSH）     │
└──────────────────────┘                        └────────────────────────────────────────┘
   同一 Host / 同一 session log / session.follow 双端实时 → 一个 agent，两种形态
```

**接入同一内核的两条官方路径（均已源码核实）**
- **(a) `/connect` 取 API Peer**：`browser-auth.ts` 的 `authorizeConnect()` "Exchange the launch token for an independent API operator"，`peer.ts` 的 API Peer 是独立 principal；随后走 `/api`（一元）+ `/api/remote.mux`（流）。适用于 VS Code 作为外部进程客户端。
- **(b) 外壳 cookie 载体**：复刻 `apps/desktop/src/web-document.ts` 的 `authenticateWebHost()`（tokenized URL → 303 → 签名 cookie）+ `forwardWebRequest()`（转发 `/api`、重写 `origin`/`sec-fetch-site`），并由 `main.ts` 注入 `__DSH_TRANSPORT__.streamBaseUrl`。
- **端点来源**：Host 的 `hostUrl+launchToken` 对进程内插件可见（`ctx.webServer.port` + `ctx.connection`），由 `dsh-ide` 插件在 spawn VS Code 时注入 `DSH_IDE_ENDPOINT`+`DSH_IDE_TOKEN`（取代旧的 `DSH_IDE_PIPE`+`DSH_IDE_NONCE`）。

---

## E. 模块与文件映射

### E1. Host 侧：`dsh-ide/`（最小官方 bundle 插件）
- **删除**：`host/protocol.js`、`host/pipe.js`、`host/services.js`、`host/tools.js`（私有管道 + 通道A/B + `ide_*`）
- **改造** `host/launch.js`：仅"spawn VS Code + 注入 `DSH_IDE_ENDPOINT/DSH_IDE_TOKEN` + 单实例"，删除 pipe/nonce
- **改造** `index.js`：`apply(ctx)` 只做 (a) 注册 `@Remote` IDE 扩展服务；(b) 若需要，`ctx.webServer.register` 一个"交给 IDE 端点"的 exact route
- **新增** `host/ide-remote.ts`：`TypertRemoteService` + `@Remote`，命名空间 `ide`（`openFile/revealDiff/applyEdit/inlineComplete/diagnostics/workspaceSymbols` 等），遵守 `docs/cookbook/adding-a-remote-api.md`
- **保留**：`package.json`(`dsh.bundle.patch`)、`cordis.patch.yml`、`locale/*`、`icon.svg`

### E2. 客户端侧：`vscode-1.143.1/`
- **删除**：`src/vs/platform/dshPipe/**`（私有管道客户端 5 文件）
- **删除**：`src/vs/workbench/contrib/dsh/chatapp/stubs/**`（假数据桩）、`chatapp/{bridge,eventSource,types}.ts`
- **删除**：`browser/{chatWebview.ts 的自造帧解析, dshIdeExecBridge.ts, ideExec.ts}`（通道B 执行桥）
- **改造** `src/main.ts`：去掉 AUMID 强绑与 pipe 引导，改为读取 `DSH_IDE_ENDPOINT/DSH_IDE_TOKEN`
- **改造** `src/vs/code/electron-main/app.ts`：删 `bootstrapDshPipe`，改注入官方载体（见下）
- **新增** `src/vs/platform/dshClient/**`：**官方载体**——复刻 `web-document.ts`（`authenticateWebHost`+`forwardWebRequest`+`/connect` API Peer+`remote.mux` WS 代理）
- **改造** `browser/dsh.contribution.ts`：启动**官方 client 图**（`dsh-client-modules` boot + `dsh-client-connection`），聊天面板注册官方 `ui-chat` 组合
- **改造** `browser/inlineCompletion.ts`：改为调 `ctx.remote.ide.inlineComplete`
- **保留**：`src/vs/editor/**`、workbench 作为 IDE 本体；`product.json` 品牌
- **品牌**：替换 `resources/**`（win32 ico / darwin icns / linux png / server）+ 新增 `dsh-ide-brand/`（SVG 静态 + 动效 + 主题 token）+ 更新 `product.json` 图标字段

### E3. 构建/打包
- Host：`npm pack` bundle → `install_bundle`（`desktop` profile）
- 客户端 chatapp：官方包组合（保留），数据层=官方 connection
- 品牌：单独产出 `dsh-ide-brand/`
- **删除**：`build-runtime.mjs` 的"自带 Electron/自拼 app"、`build-chatapp.mjs` 的"手拼壳"段落

---

## F. 品牌替换方案

1. **静态资源**：应用图标（`resources/win32/*.ico`、`darwin/*.icns`、`linux/*.png`、`server/*`）← `apps/desktop/resources/icon.svg`/`icon-windows.svg`/`icon-macos.svg`/`icon.png`/`tray-windows.ico`；工作台内品牌位（欢迎图、关于框、设置 logo、水印）← `@deepseek-ai/dsh-client-ui-primitives` 的 `FishLogo`/`BrandWordmark`。
2. **product.json**：`nameShort/nameLong=DSH IDE`、`applicationName=dsh-ide` 保留；补 `win32Icon`/`darwinBundleIdentifier`/`linuxIconName` 指向新图标。
3. **动态标识**：splash、加载动画、欢迎 hero、空态插画、`Getting Started` 动效 → 用 DSH 鲸鱼/鱼形 hero 动效（参照 `ui-conversation` 的 animated hero fish）+ DSH 主题 token 重新设计。
4. **合规备注**：按 `BRAND_GUIDELINES.md`，"DeepSeek Harness" 为注册商标，产品名用缩写 "DSH"（已用 "DSH IDE"）；对外分发须显式标注 "built on DeepSeek Harness / 非官方"，避免官方背书误解。内部分发/自用可全量替换。

---

## G. 阶段计划（R0–R6）

| 阶段 | 内容 | 验收门 |
|---|---|---|
| **R0 冻结** | 本 v2 定稿；`docs/dsh-ide-plan.md` 指向 v2 | 用户点头 |
| **R1 官方连通 smoke（头号风险先做）** | 极简 `dsh-ide` 装进 desktop profile；VS Code 主进程用官方载体 `/connect` 拿 API Peer；`ctx.remote` 调 `session.list` 成功 | workbench 里能对同一 Host 列会话 |
| **R2 聊天官方化** | 删 `dshPipe/**`+`stubs/**`；聊天 = 官方 `ui-chat` 组合 + 官方 connection；`session.follow` 实时 | 聊天端到端；与桌面端同一 session 实时同步 |
| **R3 IDE 动作官方化** | 删 `ide_*`/通道B；读写→`tool-fs`、LSP→`lsp-stdio/tool-lsp`、终端→`terminal/tool-bash`、diff→`tool-present/workspace-changes`；宿主留 `@Remote` IDE 扩展 | agent 读写/LSP/终端 + `tool/call`+`approval/*` 审计 |
| **R4 两形态联动** | IDE↔DSH 双向往返深链；同工作区会话一致 | 一端 prompt，另一端实时；同内核单 agent |
| **R5 保留 AI + 品牌** | 行内补全/编辑/诊断经 `ctx.remote.ide.*`；全站换 DSH logo + 动效；合规备注 | Cursor 式 AI 可用（后端 DSH）；品牌全替换 |
| **R6 打包/验收** | `npm pack`→`install_bundle`；桌面 App 内自测；文档定稿 | 单内核、双形态、全官方传输、品牌=DSH |

---

## H. 验收门

- **G0 起得来**：bundle 装进 desktop profile 且激活；DSH-IDE 能连到运行中的 Host（不自起 Host）。
- **G1 官方连通**：`/connect` 拿到 API Peer；`ctx.remote.session.list/follow` 通；无私有管道、无 `/api` 之外的自造通道。
- **G2 聊天端到端**：文本/思考/工具/步骤/用量；模型+强度+四模式+审批生效；与桌面端同一 session 实时同步。
- **G3 IDE 动作**：`tool-fs`/`tool-lsp`/`tool-bash` 生效并留 `tool/call`+`approval/*`；无 `ide_*`、无通道 B。
- **G4 两形态**：同一 agent、两个客户端；同工作区会话一致；不同工作区隔离。
- **G5 保留 AI**：行内补全/行内编辑/诊断上下文可用，后端=DSH。
- **G6 品牌**：全站 DSH logo + 动效，无 VSCode/Code-OSS 残留品牌。

---

## I. 风险与缓解

| 风险 | 缓解 |
|---|---|
| **【头号】官方 client 能否在 VS Code Electron 里跑**（主进程载体 + 聊天 webview 载官方 ui-chat） | R1 先做最小 smoke 打通再删改 |
| `/api/remote.mux` WebSocket 经 VS Code 主进程代理的 cookie/origin 重写 | 对齐 `api-request-trust.ts` 的 Host/Origin 栅栏；照抄 `web-document.ts` |
| "同内核=同进程"：IDE 必须连已运行的 Host | 启动入口=DSH 内"在 IDE 中打开"；桌面未开时给出明确引导 |
| rc.5 vs 后续版本字段漂移 | 逐字段对 asar/实时 `cordis_inspect` 核验；不假设 alpha 字段 |
| 品牌对外分发的商标合规 | 加 "非官方/built on DSH" 声明；产品名用 "DSH" |
| 行内补全无官方现成 FIM | 用官方 `@Remote` 新增 `ctx.remote.ide.inlineComplete`（后端 `ctx.llm`），仍走官方传输 |

---

## J. 当前状态 / 回退

- 现状（v1）已实现：Host 半 `dsh-ide/{index.js,host/*}`（私有管道）、VS Code 侧 `platform/dshPipe/*`+`contrib/dsh/*`（含手写桩）、`dshChatBridge.ts`、品牌已改 product.json、已删 `extensions/dsh-bridge/`、已裁剪登录栈扩展。
- v2 的迁移是**替换式**：删私有管道/桩/ide_* 与通道B，换官方 client-connection/gateway/能力缝；渲染器/主进程侧本地逻辑基本重写为官方客户端。
- 回退：保留现可用 `dist/dsh-ide-0.0.0.tgz`；各阶段独立 git 提交；Electron 由桌面 App 官方提供（不再自带 dist）。

### R1 进展（本轮已实施）

- **Host 半（`dsh-ide/`）已切到最小官方 bundle**：删 `host/{protocol,pipe,services,tools}.js`；`index.js` 改为「派生官方端点+token 并 `/dsh-ide-launch` 拉起 IDE、`/dsh-ide-status` 诊断」；`host/launch.js` 不再自带 Electron，改为 spawn 注入 `DSH_IDE_ENDPOINT/DSH_IDE_TOKEN`（+ `--reuse-window` 单实例）；新增 `common/env.js`；`package.json`→2.0.0（`files` 去 runtime/旧脚本）；`build-host.mjs` 校验三文件，`node --check` 通过。
- **VS Code 侧官方载体已建（新增 `platform/dshClient/**`）**：`common/dshClientProtocol.ts`（官方 client-request/server-response 线格式 + 折叠）、`electron-main/dshClientTransport.node.ts`（`/connect` 换 cookie + `/api/<ns>/<method>` 一元 + 401 重连）、`common/dshClientChannel.ts`（IPC `dshClient`）、`electron-main/dshClientBootstrap.ts`（由 env 构造、`exchangeToken`）、`common/dshClientService.ts`（渲染器代理）。`dsh.contribution.ts` 注册 `IDshClientService` 并在 `DSH_IDE_ENDPOINT` 存在时做启动 smoke（`session/list`）。`dshChatBridge.ts` 改为经 `IDshClientService` 走官方一元（R1 无 follow 流；R2 接 `/api/remote.mux`）。`app.ts` 改注册 `dshClient` 频道（去 v1 pipe bootstrap）。核心文件改动仍为 app.ts + workbench.common.main.ts 两处。
- **R1 证据（本环境已跑通）**：`tools/r1-live-smoke.mjs` 与 `.build/rc5-official/r1-smoke.mjs` 验证官方线格式——`/connect`(302+cookie) → `/api/session/list`(server-response)→ 3/2 条会话、错误折叠（`gateway/not-found`）、错 token 被拒、懒连接——**全部 PASS**（本地伪 Host，官方线格式逐字对齐 rc.5 源码）。
- **待用户机器**：装 bundle 进 desktop profile → DSH 内「在 IDE 中打开」→ `node tools/r1-live-smoke.mjs --endpoint <host> --token <t>` 对**真实 Host** 复核；随后在 VS Code 里观察 smoke 通知（G1 完整）。
- **说明**：v1 的 `platform/dshPipe/**` 与 `contrib/dsh` 的聊天/通道B 物暂保留（R2 替换删除），以免 R1 一次性大改不可回退；旧 `chatapp/**`（v1 手拼壳）在 `runtime/`（已 gitignore）与源码均待 R2 清理。

### R2–R6 进展（本轮一口气推进）

- **传输载体纠正（重要）**：官方 `/connect` 换得的 API Peer 是**socket 绑定**（"one API socket owns cleanup… later HTTP using that Cookie is refused"），无法在 HTTP 一元与 mux WebSocket 间共用。故改为官方**浏览器 cookie 载体**（`GET /?token=` → authorizeIndex 303+签名 cookie，绑定共享 `browserPeer`），同一 cookie 同时服务 `/api` 一元与 `/api/remote.mux` WS。`dshClientTransport.node.ts` 已实现：token 交换 + 一元 + `openStream()`（`ws` 连 mux，open/item/end/cancel/error）；IPC 频道与渲染器服务已贯通流帧。
- **R2 聊天官方化**：`dshChatBridge.ts` 改为「先开官方 `session/follow` 流拿 snapshot 游标 → 官方 `session/prompt` → 只认 seq>游标 的事件」，按 `assistant-stream` chunk / `assistant/message` / `tool/call`+`tool/result` / `turn/end` 映射回 progress（文本/思考/工具/步骤）。**删除 v1 物**：`platform/dshPipe/**`、`contrib/dsh/browser/{chatWebview,dshIdeExecBridge,ideExec,inlineCompletion(v1)}.ts`、`contrib/dsh/chatapp/**`（假桩）。
- **R3 IDE 动作**：agent 侧读写/终端/LSP 由官方 `tool-fs`/`tool-bash`/`tool-lsp`（Host 内）提供，天然留 `tool/call`+`approval/*`；IDE 专属能力由 Host 新增 `@Remote` 服务 `host/ide-service.js`（命名空间 `ide`：`ping/readFile/listDir/inlineComplete/diagnostics`，纯 JS `bindTypertRemote`+原型 marker，等价 `@Remote`），经官方 `/api/ide/<m>` 暴露。文件系统核心 `host/ide-fs.js`（根包含/符号链接校验）——`r3-idefs.mjs` 全 PASS。
- **R5 保留 AI**：`inlineCompletion.ts`（v2）经 `IDshClientService.call('ide/inlineComplete')` 后端 DSH，超时/未实现优雅降级；在 `dsh.contribution.ts` 注册。
- **R6 品牌**：`tools/gen-brand-icons.mjs` 程序化生成真实 DSH 鲸鱼图标（`resources/win32/dsh.ico` 多尺寸 + `resources/{linux,}/dsh-ide.png`，并覆盖 `code.ico`/`code.png` 作为构建默认）；`product.json` 精准改 `win32Icon`/`linuxIconName`/`darwinBundleIdentifier`（nameShort/nameLong/applicationName 已是 DSH IDE）。
- **R4 两形态**：同一 Host/同一 session log；`session.follow`（IDE）+ 桌面端同行；`session/list` 按 cwd 过滤 → 同工作区一致、不同工作区隔离（`dshChatBridge` 已按 `sameCwd` 过滤）。**需真实双端 GUI 复核**。
- **R1/R2 证据（本环境已跑通）**：`r1-smoke.mjs`（浏览器 cookie 交换 + 一元 + 错误折叠 + 错 token + 懒连接）、`stream-smoke.mjs`（mux open→2 item→end + error 帧）、`r3-idefs.mjs`（路径/../绝对/符号链接逃逸全被拒）——**全 PASS**。全部 TS 通过 tsc transpile 语法检查；Host `node --check` 通过。
- **待用户机器（GUI/真实 Host，本环境无法代跑）**：装 bundle → 「在 IDE 中打开」→ `node tools/r1-live-smoke.mjs --endpoint <host> --token <t> [--session <id> --stream]` 复核真实 Host + mux；随后在 VS Code 观察 smoke 通知、聊天端到端、行内补全、品牌、双端同步（G0–G6 的 GUI 部分）。`@Remote ide` 服务的 SRC 派发语义亦需真实 Host 复核（客户端已优雅降级）。

---

## K. 结论（确认项）

**确认：本计划的最终形态 = 把 `vscode-1.143.1` 改造为「一个用 DeepSeek Harness 官方标准编写的桌面端插件（bundle）」。** 它作为 DSH 桌面 App 单一内核的第二个官方客户端，通过 `dsh-client-connection/gateway/client-modules` 全官方传输接入同一 Host，提供 Cursor 式 IDE 界面与功能，agent 100% 由 DSH 提供，实现"一个 agent、两种形态（DSH-IDE 形态 / deepseek-harness 形态）、同工作区会话一致"，并全面替换为 DSH 品牌视觉。

---

## L. 本轮定案（Q1–Q13）与落地状态（P-A / P-B / P-C）

经 grilling，「聊天面板如何用 DSH」的核心分叉已定案（用户逐条确认）：

| # | 决策 | 结论 |
|---|---|---|
| Q1 | agent 内核 | **DSH 拥有完整循环；VS Code 纯客户端/UI** |
| Q2 | 分工 | 双向、边界清晰：VS Code 能力→DSH 工具（辅），DSH 事件→IDE UI（主） |
| Q3 | 交付形态 | **官方 DSH bundle 插件**（`install_bundle`） |
| Q4 | Host 拓扑 | **复用运行中的 DSH 桌面 Host**（第二客户端，不自起内核） |
| Q5 | IDE 能力进 DSH | **优先吃官方工具**（tool-fs/bash/lsp 同机同工作区），仅 IDE-only 用**极薄 @Remote** |
| Q6 | 连接 | **仅 Electron 主进程持 1 条官方连接**，渲染器经 IPC，主进程统一重连 |
| Q7 | VS Code 改动面 | 后端随便改；前端尽量少改；不搬 DSH 整 UI；**只替换侧边栏逐条消息渲染** |
| Q8 | AI 面归属 | 聊天/行内补全/行内编辑/诊断解释**全部 DSH**；能不绕弯就不绕 |
| Q9 | 品牌合规 | 全量 DSH 品牌 + “built on DSH/非官方”声明 + **保留 MIT 许可与版权** |
| Q10 | 侧边栏控件 | 壳与控件**留 VS Code**，内里改调 DSH 官方方法 |
| Q11 | 会话/工作区分类 | **不在 VS Code 自造**，直接用 DSH `workspaceController` 核心驱动，IDE 镜像 |
| Q12 | 双形态 | 桌面 GUI 与 IDE 侧边栏**同会话可并发** |
| Q13 | 消息渲染 | **B：单接缝改核心 + DSH 视觉原生 ContentPart + 读 `ui-chat` 的 `transcriptView`/`collapseTiming`** |

### 已落地

- **P-A 传输/数据面稳固**（commit `5387698b`）：
  - `host/ide-service.js`：`inlineComplete` 改用**真实 `ctx.llm.stream`**（`ctx.llm` 无 `complete()`）；删除死代码 `readFile/listDir/diagnostics`（读走官方 `tool-fs`）；方法参数名即 wire 字段（满足 SRC 派发约束）。**已核验** `dsh-api-gateway` 的 `resolveSrcDescriptor` 会从原型 `remote-methods` marker + `typertRemote` 绑定派发 `@Remote`（约束：参数名精确、JSON 结果、signal 末位）。
  - `host/ide-fs.js` 删除（读不再需要）；`index.js` 的 `/dsh-ide-launch` 复用官方 `ctx.connection.requestRejection` 做 Host/Origin+认证栅栏（本地任意进程不可窃取 token）。
  - `dshChatBridge.ts`：工作区/会话分类改由官方 **`workspace/list`**（`workspaceId,path,sessionIds`）权威裁决；`session/create` 优先带 `workspaceId`，`cwd` 仅回退。新增 `ui-chat` 设置读取（`settings/describe` → `transcriptView`/`collapseTiming`）与控件面（模型/四模式/权限/审批/目标）。
- **P-B DSH 视觉渲染**（commit `0b349dd9`）：
  - `dshEventMap.ts`（纯函数，10/10 单测）：DSH `session/follow` 条目 → 中立回合部件（thinking/text/tool/step/usage），prompt 对齐 + `turn/end`。
  - `dshPartsContract.ts`：数据面/渲染面共享的进度消息契约（`dsh-tool:`/`dsh-step:`/`dsh-usage` 前缀）+ 原生安全构造器；避免伪造脆弱的 `toolInvocation`/`usage` 富对象。
  - `dshChatBridge.send()`：忠实产出思考块/步骤行/工具行(状态字形)/用量行(覆盖式 id)/正文。
  - 单接缝 `chatListRenderer.renderChatContentPart`：新增一支 `renderDshPart(...)`；非 DSH 部件返回 `undefined` 交回原生（**纯净 VS Code 行为不变**）。
  - `dshChatParts.ts`：DSH 风格原生 ContentPart（思考折叠块/步骤/工具/用量），严格跟随 `ui-chat` 的 `transcriptView`(compact 隐藏步骤用量、detailed/verbose 展开思考) 与 `collapseTiming`；纯原生 DOM + 官方 Markdown，**不嵌 React/Cordis**。
  - `dsh.contribution.ts`：连通后 `setDshTranscriptEnabled(true)` + 读 `ui-chat` 设置注入渲染层。
- **P-C 品牌合规 / 收尾**：
  - `product.json`：`urlProtocol=dsh-ide`（其余 nameShort/nameLong/applicationName/win32Icon/linuxIconName/darwinBundleIdentifier 均已是 DSH）。
  - 新增根 `NOTICE.md`：非官方声明 + VS Code MIT 版权保留 + 商标说明。
  - 删除 v1 遗留 `dsh-ide/runtime/`（4MB 死产物，已不上库）。

### 验证现状
- Host：`node --check` + `build-host.mjs` 通过；TS：全部改动文件 tsc-transpile 语法通过；`dshEventMap` 单测通过。
- **待用户机器（GUI/真实 Host，E:\vscode-dsh 本环境无法拉起 Electron/DSH 联动）**：G0–G6 端到端——真实 Host 的 `@Remote ide` 派发、`session/*` 多参 arg-wire 形状、`workspace/list`、`settings/describe`、聊天 DSH 视觉与设置跟随、行内补全、品牌、双端同会话并发。
