> ⚠️ **已被 v2 取代（superseded）**：本文件描述的是 v1（私有命名管道 + 手写桩）架构，已作废。当前唯一事实来源 = [`dsh-ide-plan-v2.md`](./dsh-ide-plan-v2.md)（全官方传输、单内核双客户端、DSH 品牌）。本文件仅留作考古。

# DSH-IDE 最终改造计划 v1.0（唯一事实来源）

> 定位：**让装了 `dsh-ide` 插件的 DeepSeek Harness 成为“超越 Cursor”的产品。** 只有一个 agent = **DSH 本身**；IDE 是 DSH 的“一等公民代码身体”。`E:\deepseek-harness` 仅作**只读参考/复用**，不 fork、不改 DSH 仓库。
>
> 本文件为唯一事实来源。旧架构文档见 `docs/archive/dsh-ide-migration-OLD-HTTP-bridge.md`（已废，描述独立窗口 + 官方回环 HTTP `/api` + `/api/remote.mux` + `dsh-bridge` 扩展，与本文方向相反，仅供考古）。
> 可复用事实（体积基线、构建闭包、安全底线、Electron 陷阱）收在 `docs/dsh-ide-facts.md`。

## A. 蓝图（一句话）
把 `vscode-1.143.1` 改造成 `dsh-ide` **DSH bundle 插件**：VS Code 外壳保留（侧栏/编辑/终端/Git/搜索/布局原生不变）；**聊天面板内嵌 chat-only 的 DSH 客户端子应用**，由其**字面渲染 DSH 事件**（E2 限定）；**所有 DSH 连接由 DSH Cordis 插件在 Host 进程内完成**、经**插件私有本地管道**暴露给 VS Code；`ide_*` IDE 动作迁入 VS Code fork 核心；**Electron 复用策略见 I 节（已据实测纠正）**；核心 agent 能力 + VS Code 全量 LSP 双向融合。

## B. 已冻结决策汇总
| # | 决策 | 结论 |
|---|---|---|
| 路线 | 保留完整 IDE，作为 DSH 插件 | **A**（B/C/D 封杀；无残留代码，仅删了死文件 `dshRemoteClient.ts`） |
| 只有一个 agent | 聊天=DSH agent；禁用 VS Code Copilot/Local 入口 | **是** |
| 连接 | 插件系统 + 私有本地管道（命名管道+nonce）；无 `/api`/cookie；删 `dsh-bridge` | **R1** |
| 聊天渲染 | VS Code 原生外壳 + 挂载 DSH React 渲染器（webview/iframe 隔离） | **E2 限定** |
| 子应用数据 | 桩上下文 + `MutableSessionEventSource` 经管道喂事件（非官方 client-connection） | **D3′** |
| F1 复用 | 复用 DSH `app.asar` 已构建产物 + 薄 boot（vendored 兜底） | **复用**（已点头） |
| F2 会话列表 | 原生 VS Code 视图 + 管道供数 | **原生**（已点头） |
| F3 裁剪 | 仅删 `github/github-authentication/microsoft-authentication`，其余保留 | **已定** |
| 核心改动策略 | 尽量少改核心（目标 ≤2 文件 + 可重放 `.patch`）；旧的 9 处 HTTP-bridge 核心改动随 E2/P2 收回 | **是** |
| 版本 | VS Code 固定 **1.143.1**；对准已装 DSH **0.2.1-rc.5**（实测命中，逐字段核验，勿假设 0.2.2 字段） | **是** |
| 打包边界 | 产物 = `out`+`resources`+裁剪`extensions`+精简`node_modules`+chatapp资源；**Electron 见 I** | **是** |
| 源码维护 | 保留 `src`/构建机；只裁剪“发行产物” | **是** |
| 标尺 | 对齐 Cursor + 超越 | **已点头** |

## C. 架构与进程拓扑
```
┌─────────────── VS Code 进程 (Electron) ───────────────┐
│ 主进程 main:  管道客户端 · launchIde · ide_* 执行器(通道B)              │
│ 渲染器 workbench:  原生工作台(侧栏/编辑/终端/Git/搜索/布局 不变)         │
│   └ 聊天面板容器(webview/iframe) ── chat-only DSH 子应用(vendor+ui-*.client.js+薄boot) │
│        └ 子应用内部: ui-chat/ui-tool/ui-model-selection/ui-agent-preset… 渲染 DSH 事件 │
└───────────────────────────▲───────────────┬───────────────────────────┘
                私有命名管道(双向, nonce)  │  通道A: Host-Remote 语义(自定义封装) │ 通道B: ide_* 执行
┌───────────────────────────┴───────────────▼───────────────────────────┐
│ DSH Host 进程 — Cordis 插件 dsh-ide:                                    │
│  · 管道服务端(named pipe + nonce 校验)                                  │
│  · 进程内直调: sessionController.prompt/follow/cancel · modelCatalog/   │
│    selectModel · agentPresetRegistry · approval.setPolicy ·             │
│    permissionPresets · goal                                      │
│  · 注册 ide_* 工具 → 转通道B 给 VS Code 执行（可审计）                   │
└────────────────────────────────────────────────────────────────────────┘
```

## D. 模块与文件映射
**D1. DSH 插件（Host 半，Node-ESM）** — 从 `.build/migrate-from-wrapper/` 迁移已验证逻辑（注意：该目录仍是旧架构代码，P0 会重写，仅作参考）
- `src/vs/workbench/contrib/dsh/host/plugin.ts`（Cordis apply/Config）
- `.../host/launch.ts`（解析并启动 VS Code）
- `.../host/pipe.ts`（命名管道服务端、nonce、帧多路复用）
- `.../host/services.ts`（进程内 DSH 服务封装）
- `.../host/tools.ts`（`ide_*` 工具注册 + 通道B 转发 + 审批审计）
- 根 `package.json`、`cordis.patch.yml`、`build/dsh/build-host.mjs`

**D2. VS Code 核心（fork 内）**
- 新增 `.../dsh/browser/chatWebview.ts`（聊天容器 webview，加载子应用 + 握手）
- 新增 `src/vs/platform/dshPipe/*`（主进程管道客户端）
- 新增 `.../dsh/browser/ideExec.ts`（writeFile/editFile/diagnostics/LSP/runCommand/terminal/git/search 执行器=通道B；**取代 dsh-bridge**）
- 新增 `.../dsh/browser/inlineCompletion.ts`
- 精简改造：`chatService/dshChatBridge.ts`、`localAgentSessionsController.ts`、`globalCompositeBar.ts`、`agentSessionsConfiguration.ts`；禁用 Copilot/Local agent 入口
- **删除** `extensions/dsh-bridge/`（旧 HTTP-bridge 扩展，与 v1 方向相反）

**D3. chat-only DSH 子应用** — `src/vs/workbench/contrib/dsh/chatapp/`
- 薄 `boot.ts` + `root.tsx` + `stubs/*`（`TestSessions` 模式）
- `build/dsh/build-chatapp.mjs`：复用 asar 中 `vendor.js`、`client-modules`、聊天子集 `ui-*.lib/client.js` + 主题 CSS
- 产物放 `dsh/chatapp/` 随包分发

## E. 私有管道协议
- 端点：`\\.\pipe\dsh-ide-<hostPid>-<nonce>`；VS Code 侧从 launch env 拿 `DSH_IDE_PIPE` + `DSH_IDE_NONCE`。
- 帧：长度前缀 JSON `{v,chan,id,method|event,payload}`；**通道A**=Host-Remote 语义封装，**通道B**=`{op,args}`→`{ok,result|error,auditToken}`。
- 安全：握手校验 nonce；仅本地回环/命名管道；审计：每次工具执行记 `tool/call`+`approval/*`。（旧 `security-audit.md` 的 #4/#5/#7 在此段的 `ideExec`/`launch` 落实：根包含校验、`ide_terminal` 去 `shell:true`、launch 单实例。）

## F. 聊天子应用装配（F1 复用）
- **复用**：`app.asar` 内 `dsh-web-frontend/dist/assets/vendor-*.js`、`dsh-client-modules/lib/client.js`、`dsh-client-ui-*/lib/client.js` 与 CSS。
- **自写**：极薄 boot + 桩服务 + `root` 渲染聊天视图；`sessions.binding(id)` 返回 `{session, eventSource: MutableSessionEventSource, ctx}`。
- **版本容错**：boot 探测 rc.5 装载契约；某包不能干净复用则回退**该包 vendored 重建**。
- 隔离：webview(iframe) 独立文档/CSS/React；portal 落在自身 body；主题 token 注入到自身根。

## G. 流/事件与控制
（同 v1.0 原表，喂给 `MutableSessionEventSource` 的字段与控件映射不变，详见 v1.0 原文 G 节。）

## H. 单一 agent + “超越 Cursor”新增
1. 单一 agent 收口：禁用/旁路 VS Code 内置 Copilot 与 Local agent 入口。
2. 行内补全/Tab：`InlineCompletionItemProvider`，后端接 DSH。
3. agent 全域上下文：`ide_*` 把 VS Code 全量 LSP + 终端 + Git + 搜索交给 DSH agent，并回显到编辑器（diff 评审/应用）。
4. 验收标尺 = 对齐 Cursor + 超越（逐条勾，见 v1.0 H4）。

## I. Electron 复用与打包（已据实测纠正）
> ⚠️ **纠正**：v1.0 原 I 节「硬链接复用 DSH Electron」与 `docs/runtime-strategy.md` 的实测结论冲突，已据本机事实重述。
- **本机事实**：DSH 装在 `C:`（NVMe），仓库/bundle 在 `E:`（HDD），**跨卷硬链接被系统拒绝**（实测 `C:→C:` 成功、`C:→E:` 失败 "cannot move to a different disk drive"）。且 DSH `resources/` 只有 `app.asar`（182MB）+ `app.asar.unpacked` + `runtime/`，**无 `app/`**；其 exe 永远加载 `app.asar`（DSH 外壳），指向它不会起我们的 VS Code。
- **机制（唯一可行 + 可分发）**：**自带一份 Electron dist**（bundle 内 `runtime/electron/`），exe 与我们同卷。DSH 的 exe 与 bundle 的 exe **字节一致**（SHA256 相同），来源可靠。
  - 启动：`<electron>/DeepSeek Harness.exe <app> --folder-uri=… --user-data-dir=… --extensions-dir=… --reuse-window`，`VSCODE_DEV=1`，**`delete ELECTRON_RUN_AS_NODE`**（不能设 undefined，见 facts）。
- **dev-only 兜底（同卷时）**：开发机若把 bundle 放到与 DSH **同一卷**，可硬链接 `runtime/electron/`（348MB 白名单；`nlink==2` 校验；`EXDEV/EPERM`→copy 兜底）。**跨卷/分发包不生效。**
- 打包：`build/dsh/build-runtime.mjs`（app=out+裁剪extensions+精简node_modules+chatapp；**无 Electron**）→ `npm pack` → `install_bundle`（同版本需 remove→install）。
- 复用谨慎：仅复用惰性资产；`node-pty`/VS Code 原生 addon 仍自带（避免 ABI 漂移）。
- **G4 修正**：`nlink==2` 仅在本机同卷硬链接兜底下成立；否则 G4 改为「产物**无 Electron**（Electron 在 bundle 自带 dist 内，不来自 DSH）+ 实测体积记录」。

## J. 裁剪（本轮）
- 删扩展：`github`(实测 137MB)/`github-authentication`(106MB)/`microsoft-authentication`(138MB)（**合计 ≈381MB**，远大于早期估值 ~79MB）。其余全保留。
- 删 dev 产物 `.map/.d.ts/.pdb/.ilk`；删非 Windows 资源。
- **诚实预期**：本轮去 Electron(-348)+登录栈(-381)+dev 文件 ⇒ app 明显小于 1.9GB，但非“极小”；大幅瘦身（扩展依赖/多余扩展）列后续独立项。详见 `docs/dsh-ide-facts.md §3`。

## K. 阶段计划（P0→P6）
- **P0 骨架**：根 `package.json`→`dsh-ide`；`cordis.patch.yml`；`contrib/dsh/host/*`（从 `.build/migrate-from-wrapper/` 重写，非直接复用）；`build-host.mjs`；根导出。产出可安装骨架。
- **P1 启动验证（降最大风险，先做）**：自带 Electron dist 启动包内 app；最小 tgz→install→重启；过 **G0/G1**。（注：原 I 的硬链接降风险已改为自带 dist。）
- **P2 私有管道 + ide_* 迁核心**：`dshPipe` 客户端 + `host/pipe.ts`；`ideExec.ts`+`host/tools.ts`（含审批/审计）；删 `dsh-bridge`；过 **G3**。
- **P3 聊天子应用**：`build-chatapp.mjs` 复用 asar 产物 + 薄 boot + 桩 + `chatWebview.ts`；先渲染历史，再接 `session.follow` 实时；过 **G2 基础**。
- **P4 控件与融合**：模型/强度/四模式/审批/权限；`ide_*` 全域上下文回喂；`inlineCompletion`；单一 agent 收口；过 **G2 全量 + 超越项**。
- **P5 裁剪+打包+安装**：J 裁剪；I 打包；安装；记录实测体积；过 **G4**。
- **P6 验收固化**：全门回归 + 账号 + `docs/` 定稿。

## L. 验收门
**G0** 起得来（自带 Electron 起包内 app，无 `ERR_MODULE_NOT_FOUND`）· **G1** 无扩展报错 + 子应用能加载 · **G2** 聊天端到端（文本/思考/工具/步骤/用量；模型+强度+四模式+审批生效）· **G3** `ide_*` 经通道执行且留 `tool/call+approval/*`；`/api` 旁路与 `dsh-bridge` 已删 · **G4** 产物无 Electron（自有 dist）+ 实测体积记录 · **G5** 账号连通；**超越项**逐条勾。

## M. 风险与缓解
| 风险 | 缓解 |
|---|---|
| rc.5 vs 0.2.2-alpha 字段漂移 | 逐字段对 **asar/实时** 核验；不假设 alpha 字段 |
| 子应用复用 `vendor.js`/装载契约耦合 | 薄 boot + 版本容错；失败回退 vendored 重建 |
| 跨卷硬链接不可行 | 主线自带 Electron dist（可分发）；同卷 dev-only 硬链接兜底 |
| 核心多改难维护 | 收口到 `contrib/dsh/*`，核心 ≤2 文件+`.patch` |
| 删登录栈连带依赖 | 启动/回归报错则回滚对应扩展 |
| diff 评审/应用、行内补全复杂度 | 分波推进；先只读回显、再应用、再行内 edit |

## N. 当前状态 / 回退
- 参考源码 `E:\deepseek-harness` 已切换到 `0.2.1-rc.5`（旧 `0.2.2-alpha.2` 在 `.bak`）；**逐字段核验的 rc.5 契约见 `.build/rc5-contract.md`**。
- 本轮已实施（本环境）：Host 半 `dsh-ide/{index.js,host/*.js}` 按 rc.5 真实签名重写并通过 `node --check` 与管道功能自测（握手/通道A 单播+流/通道B 往返）；bundle `package.json`/`cordis.patch.yml`/`locale`/`icon` 落地；`build-host.mjs` 校验脚本；VS Code 侧 TS（`platform/dshPipe/*`、`contrib/dsh/browser/{ideExec,chatWebview,inlineCompletion,dsh.contribution}.ts`、`chatapp/*`）、`build-chatapp.mjs`、`build-runtime.mjs` 落地；**删除 `extensions/dsh-bridge/`**；撤回 3 处旧 HTTP-bridge 装饰性核心改动（chatWidget/chatViewWelcomeController/chatViewWelcome.css）；裁剪 `github/github-authentication/microsoft-authentication`（实测共 -381MB）；`.gitignore` 改为追踪 `dsh-ide` 源码（runtime 除外）。
- 保留（有意）：`dshChatBridge.ts`（重写为经管道）、`chatServiceImpl.ts`（`isKnownSession` 判据）、`agentSessionsConfiguration.ts`（`dsh.hostBaseUrl` 配置）、`globalCompositeBar.ts`（账号按钮，用 `dsh.hostBaseUrl`）——均为新架构沿用。
- **核心改动预算（≤2）已达成**：除 `contrib/dsh/*` 与 `platform/dshPipe/*` 自有模块外，仅改 `src/vs/code/electron-main/app.ts`（主进程引导 + 注册 `dshPipe` IPC 频道）与 `src/vs/workbench/workbench.common.main.ts`（一行注册 import）两处。
- **chatapp 复用实测纠正**：rc.5 的 `vendor-*.js` 仅第三方库；React 18.3.1 + cordis + 共享单例（dsh-client-store/ui-slots/ui-primitives/ui-dockkit）内联在 `dsh-web-frontend/dist/assets/index-*.js`。`build-chatapp.mjs` 据此记录 `react.strategy='single-copy-in-index-shell'`，不重复内置 React；子应用挂载由 `chatWebview.ts` 注入 `__DSH_CHATAPP_STATIC__`+`__ModuleLoader__`+import map（`index-*.js` 导出符号抽取为集成接缝，缺失时子应用回退诊断面板，事件管线仍可验证）。
- 回退：profile 保留现可用 `dist/dsh-ide-0.0.0.tgz`；各阶段独立 git；Electron 兜底 copy。
- ⚠️ **验收边界**：本环境无法拉起 Electron/DSH Host 联动，G0/G1/G2/G3/G5 与超越项须在用户机器 GUI 验收（见 §11 与 facts §7）。

## O. 已冻结的开口（本次已确认）
`F1=复用` · `F2=原生` · `标尺=对齐+超越 Cursor` · I 节 Electron 复用改为「自带 dist 可分发 + 同卷硬链接 dev-only 兜底」。
**未经「确认，开 P1」不写任何 P1 代码。**
