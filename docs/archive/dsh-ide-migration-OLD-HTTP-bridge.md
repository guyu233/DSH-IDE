# DSH-IDE 官方插件化改造 · 迁移记录

> 本文件是本次改造的唯一进度真相。每完成一层更新一次：本层验收证据、未决风险、下一层计划、下下层计划。
> 基线：Windows x64 · DeepSeek `0.2.1-rc.3` · VS Code `1.143.1` · 桌面 profile。

## 总目标（已确认）

把 `vscode-1.143.1` 源码仓库整改为 DSH-IDE 的产品源码与构建工程，构建出一个**符合 DSH 官方 bundle 规范、可由官方安装器安装/卸载的 `dsh-ide` 插件**：完整 IDE 运行时、内置扩展、Host 适配器、IDE 侧 bridge 与启动生命周期都归插件管理；通信按官方 Host/Client/Remote 规范重做，不自建旁路协议。后续在该插件边界内做瘦身。

## 四层路线

- **Layer 1 · 插件形态规范化（bundle 自包含、路径无关）** — 基本完成（运行时装载需重启 DSH 后验证）
- **Layer 2 · Host 侧官方服务直连**（workspaceController/sessionController/follow；统一远端适配；运行中归档拒绝+停止并归档）— 进行中
- **Layer 3 · 跨进程通信官方化**（`connection.rpc.open` → 否则 `/api/remote.mux`；删除自建 `/dsh-session/*`、`/vscode-ai`、轮询、状态映射）
- **Layer 4 · 会话菜单按官方语义做真**（仅归档/取消归档/置顶/取消置顶/重命名；删除会话与已读未读隐藏）

---

## Layer 1 · 插件形态规范化（结果与证据）

### 关键事实（与最初假设不同，已纠正）

1. 官方 `install_bundle` **传绝对目录 = `pnpm add <path>` = 符号链接**（不复制、无视 `files`）；**传 `file:` tarball 才真实复制并遵守 `files`**。→ 自包含必须走 tarball。
2. 把旧 `link:` 依赖替换为 `file:` tarball 安装时，pnpm 会**穿透符号链接删除源包目录内容**（首次安装曾清空 `dsh-vscode-workbench`，已从 profile 副本恢复）。→ 安装前备份；tarball 打到源码包外部 `dist/`（`npm pack --pack-destination`）。
3. **不能复用 DSH 安装的 `process.execPath`**：其 `resources/app.asar` 会被 Electron 优先加载，启动的仍是 DSH 外壳而非 VS Code。→ 必须**自带 Electron 运行时**（`runtime/electron/`）。
4. 应用必须放 `runtime/electron/resources/app`（Electron 依 exe 旁 `resources/app` 加载）；`out/` 必须剥离编译测试目录（省 196MB）。
5. 运行时 `node_modules` 必须用**完整生产依赖闭包**（`npm ls --omit=dev --all --parseable`，201 个唯一顶层包），**不能手写列表**（会漏 `@vscode/policy-watcher` 等）。
6. 内置扩展必须**全量**复制（含无 `out/` 的主题/语法扩展），否则缺默认主题与语法高亮。
7. 活动 Host 会**缓存裸模块名解析到的绝对路径**（首次 link 安装解析为源码路径）；enable/disable/HMR 不重新解析，**必须重启 DSH** 才加载新副本。

### 已完成的动作（文件级）

- `dsh-vscode-workbench/index.js`
  - 新增 `PACKAGE_DIR`/`HAS_ELECTRON`/`USER_DATA_ROOT`（`~/.dsh-ide`）；`DEFAULTS` 全量去硬编码。
  - `resolveIdeRuntime()`：优先 `runtime/electron/resources/app` + `runtime/electron/*.exe`，其次 `runtime/app`+env，过渡回退旧 `dsh-ide`；**移除 execPath 兜底**。
  - `launchIde()` 用解析运行时；工作区缺省 `process.cwd()`。
  - `/dsh-ide-focus-dsh`：脚本可选，否则 `process.execPath` 唤起。
  - `/dsh-account/sign-in`：Origin 从 `webServer.getOrigin()`/`webApp.getAdvertisedUrl()` 取，删除 `59602`。
- `dsh-vscode-workbench/cordis.patch.yml`：`config: {}`，不注入绝对路径。
- `dsh-vscode-workbench/package.json`：`0.3.0`，`files` 含 `runtime/`，`build:runtime` 脚本。
- `dsh-vscode-workbench/scripts/build-runtime.mjs`：产出 `runtime/electron`（exe+资源）+ `runtime/electron/resources/app`（`out/`剥离测试、全 99 扩展、resources、生产依赖闭包）。
- `dist/dsh-ide-0.3.0.tgz`：对外安装产物。

### 验收证据

- [x] 自包含载荷构建成功：`runtime/` ≈ **823MB / 12137 文件**（electron 368MB + app 671MB→含全依赖）。
- [x] 布局正确：`runtime/electron/DeepSeek Harness.exe` + `runtime/electron/resources/app/out/main.js` + `product.json`；无 `app.asar`；98 个内置扩展。
- [x] **冒烟启动实证**：以 `VSCODE_DEV=1` 启动该 exe，Electron 日志显示 shared storage 初始化、`[CSS_DEV] DONE 386 css modules`、`AgentHostProcessManager: agent host started`，**无 ERR_MODULE_NOT_FOUND**（载荷完整可加载）。
- [x] 打包安装：官方 `install_bundle` 安装 `dist/` tarball，profile `node_modules/dsh-ide` 为**真实复制目录**（非链接），`runtime/` 随包落地。
- [x] 静态装载校验：profile 副本可 `import`（导出 `Config, apply, inject`），`@deepseek-ai/schemastery` 可解析。
- [ ] **运行时装载（需重启 DSH）**：活动 Host 缓存了首次 link 安装的旧路径，enable/disable 不重解析；须重启 DSH 后启用验证（用户要求最后统一启用）。

---

## Layer 2 · Host 侧官方服务直连（进行中）

### 已完成

- `/dsh-session/op` 严格映射官方语义：`archive` 支持 `stopActivity`；对仍活动会话，官方 `workspace/session-active` 拒绝被转成**结构化 409**（`status:'session-active'` + 活动类型），供 IDE 呈现“停止并归档”。
- 新增 `/dsh-workspace/stream`（SSE）：服务端消费官方 `workspaceController.follow()`，先发 baseline 快照，再按增量推送最新权威归档/置顶快照；客户端仅需一次普通列表拉取派生字段，**取消固定间隔轮询归档/置顶/顺序**；SSE 随断开/dispose 取消（`AbortController`）。
- 重命名走官方 `sessionController.rename`（非 Host 内部 `sessionTitle.rename`）。

### 待完成（Layer 2 收尾）

- [ ] 用**真实服务语义**验证：baseline、增量、运行中归档拒绝、`stopActivity` 停止并归档、重命名、动态地址。
- [ ] 提供统一“远端适配”边界，供 Layer 3 切换载波时不改业务层。
- [ ] 把 IDE 侧 `/dsh-sessions` 派生字段与 `follow` 快照对齐（标题/更新时间）。

### Layer 2 未决风险

- 官方 `follow()` 帧结构在不同 rc 版本字段名可能不同；已用保守兼容读取，但需真实运行时核对。
- `workspace/session-active` 的 `activity` 字段名/形状需真实会话核对。

---

## 下一层计划（Layer 3 · 跨进程通信官方化）

### 已核实事实（决定路线）

- 已安装环境**没有** `@alatastudio/dsh-client-connection-vscode` 或任何 `*connection-vscode*` / `*rendezvous*` / `*carrier*` 包（profile node_modules 与 DSH asar 内均无 `@alatastudio` 命名空间）。
- 官方 `@deepseek-ai/dsh-client-connection` 载波：浏览器 HTTP unary + `/api/remote.mux` WebSocket；`connection.rpc.open` 是**可选** shell-owned 钩子（无内建对外实现）。
- Host `ctx.connection` 提供 `authenticatedUrl` / `createPeer` / `browserPeer`。插件已加 `/dsh-ide/connection` 端点，用官方 `authenticatedUrl` 下发载体地址（不承载业务数据、不自造会话协议）。
- **桌面端特性**：VS Code 扩展宿主是插件拉起的子进程，桌面主进程掌握 Host 端口与启动上下文；“插件作 carrier 桥 + 官方凭据把子进程接入”架构可行——但依赖可复用 IPC carrier 契约（当前**未发现**已安装实现）。

### Layer 3 路线（据证据约束）

1. **优先**：确认桌面端是否已提供 VS Code IPC carrier（launch-token→cookie 转发，或 record/IDE-event 端口）。若有→插件侧接入、扩展宿主消费薄 record/event 流，删除自建 REST/轮询。**当前未发现，需以真实桌面端版本核实。**
2. **过渡（carrier 未就绪时）**：保留已验证可用的 IDE 通道，但整理为**唯一**薄适配，地址一律来自 `/dsh-ide/connection`（官方 `webServer.getOrigin()`/`getAdvertisedUrl()` 推导），**去 59602 硬编码**，不新增私有协议，不关闭后续切到 IPC carrier 的门。
3. **不采用**：自造私有 RPC/文件协议；或未重编译 Workbench 就盲目把核心聊天桥改 mux（需改 VS Code 核心+重编译+多轮 GUI 验证，且会破坏现有 IDE）。

### 待删清单（最终切换时一次性）

`/vscode-ai`、`/dsh-ide-changes`、`/dsh-ide-diff`、`/ide-cmd/*` 轮询、`/dsh-session/activate` 的 `dshActiveByCwd` 内存映射、`/dsh-session/create|prompt|page|cancel`（迁官方后）、`/vscode` code-server 后备（如无页面承载需要）。保留 IDE 页面承载所需代理与官方 carrier 入口。

### Layer 3 未决风险

- VS Code 扩展宿主只能 Node+`vscode` API，无法 `import` DSH 官方浏览器客户端库；核心聊天桥走 mux 需重编译 Workbench。
- Client 运行时 Inspect 偶发超时，端到端须以真实 IDE 进程验收。

## 下下层计划（Layer 4 · 会话菜单做真）

- 右键/会话菜单仅保留：归档、取消归档、置顶、取消置顶、重命名（官方 API）。
- 隐藏“删除会话”（官方无此能力）与“已读/未读”（官方无此状态）。
- 运行中归档统一走“停止并归档”确认。

---

## 运行时验收（重启 DSH 后，0.4.0/0.4.1，GUI 63327）

- [x] **启用成功**：`set_bundle dsh-ide enabled=true → application: applied`，无警告。Config schema 显示新默认值（`ideExe:""`、`ideUserDataDir:"~/.dsh-ide/user-data"`、`port:0`），旧 `E:\` 默认值全部消失。
- [x] **自包含 IDE 从 bundle 启动**：`POST /dsh-ide-launch {sessionId}` → `{launched:true, folder:E:\vscode-dsh, folderSource:session}`；进程树全部运行在 `...\profiles\desktop\node_modules\dsh-ide\runtime\electron\DeepSeek Harness.exe`；窗口标题 `Welcome - vscode-dsh - DSH IDE Dev`（截图确认：完整 VS Code + DSH Chat 面板 + Sessions 面板）。
- [x] **`ide_*` 工具注册可用**：调用 `ide_listDir docs` 返回目录内容。
- [x] **`/dsh-ide/connection` 官方凭据交换**：返回 `{origin, launchUrl(?token=…), muxUrl}`；`GET launchUrl` → 303（可换 Cookie），`GET /?token=INVALID` → 401。
- [x] **`/dsh-workspace/stream` 官方 follow**：SSE 首帧 `event: workspace {archived:[…],pinned:[]}` + `frameType:"baseline"`。
- [x] **运行中归档 → 409**：`{status:'session-active', activity:['turn','job'], canStopActivity:true, detail:"…the session is active (turn, job)"}`（非破坏，未中断本会话）。
- [x] **pin/unpin**：运行中 pin 成功（200），unpin 成功；对**已归档**会话 pin 会报错（官方行为，Layer 4 映射为“先取消归档”）。
- [x] **热更新**：同路径 tarball 0.4.0→0.4.1 `install_bundle` 直接 `applied`（重启后解析指向 profile，可热替换）。
- [ ] 隔离 profile 的 `--dump-config` 审计（低优先，已用 live inspect + HTTP 端到端替代）。

## 当前状态

- `dsh-ide` **0.4.7** 已安装并**启用/运行**；IDE 从包内 `runtime/electron` 干净启动，无扩展报错。
- profile 依赖：`file:E:/vscode-dsh/dist/dsh-ide-0.4.7.tgz`。

## 0.4.5–0.4.7 交互修复（用户反馈的三件事）

1. **无感打开**：`client.js` 改为挂载即拉起 IDE 并**立刻切回对话**，不再显示“正在打开”中间界面（不再 打开→跳转→切回）。
2. **账号按钮接回 DSH 账号**：真因是 **renderer 的 `process.env` 是空对象 `{}`**（VS Code 故意不暴露主进程环境），插件注入 `DSH_WEB_URL` 传不到 workbench → `/dsh-account` 读不到 base → “账号不可用”。修复：
   - `agentSessionsConfiguration.ts` 注册配置项 `dsh.hostBaseUrl`（scope APPLICATION）。
   - 插件 `launchIde` 在拉起前把当前 Origin 写入 IDE 的 `User/settings.json`（`~/.dsh-ide/user-data/User/settings.json` 的 `dsh.hostBaseUrl`）。
   - `globalCompositeBar.dshBaseUrl()` 与 `dshChatBridge.baseUrl` 首选 `configurationService.getValue('dsh.hostBaseUrl')`（对 renderer 与扩展宿主都可用）。
   - 验证：账号菜单显示 **「故雨🌧」头像 + 脱敏手机号 + 退出登录**（连的是 DSH 账号，非 GitHub/Copilot）。
3. **图标换成官方 DSH 鲸鱼**：先前手绘路径错误；改用 **DSH `/favicon.svg` 的官方路径**（viewBox 0 0 50 50）。
   - Chat 欢迎页图标：`chatWidget.getWelcomeViewContent` 的 `icon` 改为鲸鱼 data-URI；并在 `chatViewWelcome.css` 给 `.custom-icon` 补 `width/height`（原来只有 `mask-size` → 0×0 空白）。
   - 账号按钮（未登录/无头像）显示同一鲸鱼，已登录显示真实头像。

### 关键工程事实（务必记住）

- **renderer（workbench）的 `process.env` 为空**，不能靠环境变量把 Host 地址传给 UI/扩展宿主；必须走 VS Code 配置通道（`dsh.hostBaseUrl`）或 DSH Web UI 的 `tapIndex`（但 tapIndex 只影响 DSH 自己的页面，不影响独立 VS Code 窗口）。
- 运行时 user-data/extensions 已迁到 `~/.dsh-ide/`（旧 `E:\vscode-dsh\.dsh-ide-data` 不再使用）。
- 构建链每次改动需：`node build/next/index.ts transpile --out out`（~40-70s）→ `build-runtime.mjs --electron-from` → `npm pack` → `install_bundle`。同路径热更新在重启后生效。

## 0.4.2–0.4.4 构建修复（Layer 1 完整性补强 + Layer 3 去硬编码重编译）

- **L3 去硬编码**：`dshChatBridge.ts` / `globalCompositeBar.ts` / `dsh-bridge/extension.ts` 三处删除 `http://127.0.0.1:59602` 兜底，只用插件注入的 `DSH_WEB_URL`（缺失即报错）。
- **插件注入权威地址**：`launchIde` 现把 `webServer.getOrigin()` 作为 `DSH_WEB_URL` 显式注入 IDE 进程环境（此前依赖继承，可能为空）。
- **重编译**：`node build/next/index.ts transpile --out out`（≈38s，全量重建 out ~1万文件）；`dsh-bridge` 用 tsc 重编译。
- **构建脚本三条硬性修复**（否则 IDE 报扩展错误/缺依赖）：
  1. 内置扩展必须带**运行依赖 `node_modules`**（git 依赖 `file-type` 等，缺失则 `vscode.git` 激活失败）。
  2. 扩展 `node_modules` 内的**符号链接必须原样保留**（pnpm 的绝对/相对链接）；`fs.cpSync(dereference:true)` 会产出绝对路径断链。
  3. 根 `node_modules` 用完整生产依赖闭包（201 包）。
- 运行时体积随之增大（≈1.86GB，tarball≈546MB）。**体积瘦身按用户要求单列后续阶段**（可裁剪 @types/测试/未用扩展、或复用符号链接森林）。

## 最新一轮（阶段 0–4，并行推进，`dsh-ide` 0.5.0）

- **阶段 0（门禁）**：不通过 → 用户决策降级为“官方回环 HTTP/WS”。
- **阶段 1/5（运行时策略）**：`docs/runtime-strategy.md`。复用 DSH Electron 不可行（跨卷硬链接失败 + app.asar 抢占），接受自带 348MB Electron dist；裁剪以 bundle 实测为准。
- **阶段 2（远端适配器）**：新增 `remote-adapter.js`（载体无关：archive/unarchive/pin/unpin/rename/listSessions/follow/snapshotFlags + classifySessionActive）；`/dsh-session/op` 全部改走 `remote.*`。已验证运行中归档 → 409 `session-active`（activity:[turn,job]），无回归。
- **阶段 3（官方 Remote 协议）**：新增 `dshRemoteClient.ts`（VS Code 侧，经 `dsh.hostBaseUrl` + token→cookie 调官方 `/api`）。**已实测打通**：`POST /api/session/list`、payload `{args:{_request:{}}}`、Cookie=303 换得 → `200 {result:{ok:true,value:{items:[...]}}}`。endpoint 格式 = `<namespace>/<method>`，args 键为 TS 参数名。
- **阶段 7（安全加固）**：`docs/security-audit.md`（14 项，6 High）。已落地：CORS 改 Origin 白名单（evil 不回显、vscode 回显，已验证）；`makeResolveRoot` 根包含校验（拒绝 `../` 与 root 外绝对路径）。
- **未完成（诚实边界）**：阶段 3 全量流式改 remoteMux + 阶段 4 菜单动作映射，需改 VS Code 流式逻辑 + GUI 迭代，风险高；本轮奠定可靠基础但未替换正在工作的聊天桥，以保持可用态。

### 阶段 3 分步（版本固定 0.0.0）

- **步 1（已完成，可回退）**：`dshChatBridge.ts` 的 `listSessions`（会话列表）与 `loadHistory`（历史回放）改为**优先官方 `/api`**：
  - `session/list` → payload `{args:{_request:{}}}`；`session/projections`(`request.sessionId`) 取 `asOfSeq` → `session/page`(`request.address={kind:'session',sessionId},throughSeq:asOfSeq,maxMessages:300`)。
  - 传输经 `IRequestService`（主进程 net，绕过 renderer CSP），凭据用官方 token→cookie（`GET ${base}/?interactions=none` 取 Set-Cookie，缓存 5 分钟）；envelope 为 `{type:'client-request',rpcId,method,payload:{args}}`。
  - 全部**保留旧端点回退**：官方失败则回退 `/dsh-sessions`、`/dsh-session/page`，保证不回归。
  - 真实 Host 实测：`session/list` 200、`session/page` 200（24 user + 177 assistant）；转译通过；0.0.0 安装 `applied`，IDE 启动健康（Chat 鲸鱼、无扩展报错）。
- **步 2（未做）**：`send` 的 `prompt` 走官方 `session/prompt` + 用 `session/follow`(mux) 替代 `running` 轮询 + `cancel` 走官方 `session/cancel`。需先摸清 `SessionPromptRequest.content` 的 content-part wire 形状（官方无公开请求 schema，需抓活动流量样本），且 `session/follow` 是流式（需 mux/长连接）。为不破坏核心聊天，暂保留工作路径。
- **步 3（未做）**：`ensureDshSession` 的 `create/activate` 走官方 `session/create`；删除旧端点。

---

## 阶段 0 · IPC carrier 门禁结论：**不通过（FAILED）**

1. **`@alatastudio/dsh-client-connection-vscode` 存在，但对本机不可用**：
   - 它面向 `@alatastudio/*@0.1.1-rc.x`（另一条并行镜像发行线），peerDependencies 全是 `@alatastudio/dsh-*@0.1.1-rc.x` + `@deepseek-ai/cordis`；**不依赖任何 `@deepseek-ai/dsh-*`**。
   - 依赖 `@alatastudio/dsh-client-connection/client-shared`（`AbstractApiClient`）——该导出在我们的官方 `@deepseek-ai/dsh-client-connection@0.2.1-rc.3` 里**不存在**（其导出仅 `.`/`./client`/`./src/*`/`./package.json`/`./locale/*`；描述已改为 “Authenticated RPC transport and generation lifecycle”，API 已重构）。
   - README 明确：“Installed-runtime IPC only — the Host plugin requires a connected Node IPC channel; the extension launcher **owns process discovery, startup buffering, and workspace lease handling**。”→ 它要求**扩展自己 fork/own 一个带 Node IPC 的 DSH host**，**无法挂到正在运行的桌面 DSH 应用**上。
   - 不存在同名官方包 `@deepseek-ai/dsh-client-connection-vscode`（npm 404）；已装 app.asar 内**零**个 `dsh-client-connection-vscode` 字符串。
2. **webserver README 说的 “IPC bridge” 是 `dsh-app://` 自定义协议处理器**，位于桌面 Electron 主进程，`assertDesktopSender` **只接受 `dsh-app://app` 渲染帧**；**子进程（我们拉的 VS Code）无法使用**。桌面↔自身 Host 的 Node IPC（stdio `ipc`）也被 Electron 主进程独占。
3. **已装 0.2.1-rc.3 子进程唯一可用载波**：Host 回环 HTTP `/api` + `/api/remote.mux`（凭据由 `ctx.connection.authenticatedUrl` 的 token→cookie 交换获得）。

### 结论

- **“跨进程只走 IPC、HTTP/WS 业务通道彻底移除”在当前 DSH 版本/宿主形态/平台上无法成立**。计划要求的“唯一 IPC 载体”在 0.2.1-rc.3 上不存在可被拉起的子进程消费的实现。
- 计划同时假设“桌面版 opens no listening port”（framed byte pipes）——**本机事实相反**：桌面端确实起了 127.0.0.1 随机端口的回环 HTTP Host（`dsh-desktop-host` 以 `--host 127.0.0.1 --port 0` 启动），我们一直在用它。
- **按计划纪律：门禁失败 → 暂停，不降级。** 不做 IPC 切换、不删旧路径，等待你对下述选项拍板。

### 复用运行时门禁结论（阶段 1.2）

- **“复用 DSH 自带 Electron”不可行**：C:（NVMe）与 E:（HDD）是**不同物理盘**，跨卷硬链接被系统拒绝（实测 C:→C: 成功、C:→E: 失败 “cannot move to a different disk drive”）；且 DSH 安装 `resources/` 只有 `app.asar`（182MB）无 `app/`，指向其 exe 会加载 DSH 外壳而非我们的 VS Code。
- 现实选项：(a) 接受自带 ~348MB Electron dist（当前做法，可分发）；(b) 与 bundle **同卷**的 E: 本地 `dsh-ide` 目录硬链接该 dist（仅开发机、不可分发）；(c) 把 bundle 放到 C: 与 DSH 同卷。当前 runtime = **1,793 MB / 55,276 文件**（我们的 app 约 1,445MB + Electron dist 348MB）。

### 门禁阻塞报告（按计划要求的字段）

- **缺失契约**：可被“拉起的子进程”消费的 IPC fetch/stream carrier。候选 `@alatastudio/dsh-client-connection-vscode@0.1.1-rc.4`（仅 0.1.1-rc.x，非 0.2.1-rc.3）；无 `@deepseek-ai` 版。
- **失败阶段**：契约不存在（版本代不符）→ 无法进入握手。
- **平台/宿主形态**：Windows x64 · DSH Desktop 0.2.1-rc.3 · 拉起的 VS Code 子进程。
- **可选绕行**：① 等 DSH 发布 0.2.1/更高版本并内置 vscode carrier；② 接受“自建 IPC 桥”的额外工程量（需改 DSH 核心/自写 carrier，风险大）；③ 重新评估“拒绝 HTTP”决策。

### 用户决策（2026-10-29）

- 选择**③：将 IPC 目标降级为“官方回环 HTTP/WS”**。即：正式跨进程载波 = 官方回环 HTTP `/api` + `/api/remote.mux`，凭据走官方 `connection.authenticatedUrl` 的 token→cookie 交换（已实现并验证 303/401）。不再追求“纯 IPC、删 HTTP”，但仍删除自建旁路协议、尽量把业务走官方 `/api`。
- 后续阶段（1 bundle/运行时、2 远端适配器、4 菜单官方语义、5 诊断、7 安全、8 流水线）在“官方回环 HTTP/WS”基线上继续。

## Layer 3 现状（诚实边界）

- 已完成并验证：官方凭据交换端点 `/dsh-ide/connection`（`GET launchUrl`→303，非法 token→401）；客户端 59602 全部移除并改用注入的 `DSH_WEB_URL`；重新编译进 `out/`。
- 过渡保留：自建 `/dsh-session/*`、`/vscode-ai`、`/dsh-ide-changes`、`/ide-cmd/*` 仍可用（它们走已验证的动态地址，无硬编码）。
- **未完成（需进一步工程 + GUI 迭代）**：把核心聊天桥的每次调用改为“生成 Remote 语义经官方 `/api` + `/api/remote.mux`”。缺的是客户端侧把 DSH 生成的 Remote schema 打进 Workbench 或按 schema 手工编码 envelope 的自动化库；这是一项独立的、可在下一轮专注推进的工作，不影响当前可用性。

## Layer 4 现状（诚实边界）

- DSH 会话在 IDE 的 Sessions 面板由 `LocalAgentsSessionsController`（`dshBridge.listSessions()`）**事件驱动列举**；归档/置顶/重命名的**右键菜单映射**需在真实 Sessions 列表上点击验证并改 `agentSessions*` 注册点。
- 本轮未改菜单动作集；已具备 Host 侧官方语义（409+stopActivity、pin/unpin、rename）作为其落地基础。

## 仍存在的工程质量差距（明确记录，不回避）

- `runtime` 体积 1.86GB：后续瘦身（移除 `@types`/测试/未用扩展/dereference 膨胀）。
- 隔离 profile 未做 `--dump-config`（低优先，已用 live inspect + HTTP 端到端替代）。

## Layer 3 · 官方传输调查（定论，来自 ASAR 深查）

- 运行时 0.2.1-rc.3 **没有**任何官方/半官方 VS Code IPC carrier（`open-inbox` 是空 stub，无 `@alatastudio`）。
- 唯一官方传输 = **HTTP `/api` + `/api/remote.mux` WebSocket**，Cookie 鉴权；`connection.rpc.open` 只是抽象注入钩子，无现成 IPC 实现。
- 桌面主进程把 `hostCookie` 仅注入 **mainWindow** 的请求/WS（`onBeforeSendHeaders` 的 `webContentsId === mainWindow`），**不会**转给子进程。
- **但有官方可行通道**：Host 插件的 `ctx.connection.authenticatedUrl(origin)` 返回 per-process `?token=` 的 launch URL；任何子进程对它 `GET`（`redirect:manual`）即得 `303 + Set-Cookie`（`BrowserAuth.authorizeIndex`），随后用该 Cookie 走官方 `/api` 与 `/api/remote.mux`。**无需浏览器 Cookie，也无需重写 Workbench**。→ 已实现为 `/dsh-ide/connection`（下发 `{origin, launchUrl, muxUrl}`）。

### Layer 3 仍需完成（客户端接线，需重编译 + GUI 迭代验证）

- IDE 侧（`dshChatBridge.ts` 与 `dsh-bridge` 扩展）改为：先取 `/dsh-ide/connection` 的 `launchUrl` → 303 换 Cookie → 用生成的 Remote 语义走 `/api`（unary）与 `/api/remote.mux`（流），**替换**自建 `/dsh-session/*`、`/vscode-ai`、`/dsh-ide-changes`、`/ide-cmd/*` 轮询。
- 这一步涉及 VS Code 核心 TS 与扩展编译，必须在真实 GUI 下多轮迭代，故排在“重启后启用验证”阶段执行，避免盲改破坏现有 IDE。

---

## Layer 1 · Gate A 收尾（2026-11-02）

### 已完成（源码改动，无需重启即已落盘）
- `dsh-vscode-workbench/index.js`：删除 **7 个零消费的自建会话 HTTP 旁路端点**——
  `/dsh-session/{op,activate,create,page,prompt,cancel}`、`/dsh-sessions`、`/dsh-workspace/stream`（约 -230 行）。
  - 依据：对全产品源码（`vscode-1.143.1/src`、`extensions/dsh-bridge/src`，排除 test）grep 上述端点 → **零消费**；
    IDE 聊天/会话已全部改走官方 `/api`（`dsh.remote.call`）+ `/api/remote.mux`。
  - 连带清理死代码：`createRemoteAdapter`/`classifySessionActive` 导入、`sendJson`、`dshActiveByCwd`、`normCwd`、
    `readSessionFlags`、`extractSessionId`、`applyFlagFrame`、`sc()`、`wreg()`、`uuidGenerate`。
  - 验证：`node --check` 通过；`index.js` 保留端点仅 `/dsh-ide-launch`、`/dsh-ide-focus-dsh`、`/vscode-ai`、
    `/dsh-ide-changes`、`/dsh-ide-diff`、`/dsh-account*`（均仍被 `extension.js` / `globalCompositeBar` 使用）。
- 安全收益：审计 **#2（`/dsh-session/prompt` 跨源 prompt 注入 RCE 链）** 与 **#6/#10（会话端点通配 CORS）** 随端点删除**关闭**；
  `remote-adapter.js` 作为“载体无关适配层”**保留**（供 Layer 3/4 官方远程调用复用，不随端点删除）。

### 未完成（需一次重启窗口才能生效）
- **重打 `dist/dsh-ide-0.0.0.tgz`**：现有 tarball（10-29 17:14）**已含缺陷 B 修复 + 透明管道/背压**
  （`out/`、`runtime/` 均为当前源码），但**不含**本轮 `index.js` 端点删除。重打 = `build-runtime.mjs --electron-from <electron>` → `npm pack`（~550MB，约 10–20 分钟）。
- **install_bundle → 重启 DSH**：当前安装副本 `~/.dsh/profiles/desktop/node_modules/dsh-ide` 仍含全部 7 个旧端点（13 处引用），
  且活动 Host 缓存裸模块路径，**必须重启**才加载新副本；端点 404 / 重度工具轮不溢出的**运行时验收只能在重启后**进行。
- 回退：`install_bundle` 回上一版 tgz；端点删除为纯 `index.js` 改动，独立 `git revert` 即可。

---

## Layer 2 · Gate C-1 执行限制对齐 DSH（2026-11-02，源码改动）

目标：把执行旁路对齐 DSH 官方「审批 + 沙盒」模型（呼应“限制与 DSH 同步”，关闭安全审计 OPEN 的 #3/#4）。

### 已完成（源码改动 + 本地行为验证，无需重启即已落盘）
- **#4 `ide_terminal` 去 `shell:true` → 停用**（`ide-tools.js`）：删除 `execFile(command,{shell:true})` 的宿主级任意命令执行。
  按计划“或先禁用”，保留同名工具但执行即抛明确错误，提示改用 DSH 官方受控执行能力（审批+沙盒）。命令执行回归 DSH 官方通道。
- **#3 `/ide-cmd/exec` 删除**（`ide-tools.js`）：该无鉴权端点可越过 tools 层入队任意 `{command,args}` 且不入审计；生产代码零调用者。
  `/ide-cmd/poll` 与 `/ide-cmd/result` 加**进程内 nonce 头**（`x-dsh-ide-nonce`）鉴权：无/错 nonce 一律 403。
  - nonce 在插件实例创建时生成（`index.js`），经 `launchIde` 以环境变量 `DSH_IDE_BRIDGE_NONCE` 注入 IDE 进程；
    `dsh-bridge` 扩展（`extension.ts` 的 `bridgeHeaders()`）在 poll/result 请求头携带之（已 `tsc` 编译进 `out/`）。
- **写/编辑接入 `ctx.approval`**（`ide-tools.js`）：`ide_writeFile`/`ide_editFile` 每次写入/编辑前调用 `ctx.approval.request(...)`，
  会话日志留 `approval/asked`+`approval/decided` 审计对（与官方 fs write/edit 对齐）。策略完全交 DSH：`ask`→询问用户；`never`→自动拒绝不弹窗；
  审批服务缺失→fail-closed 拒绝。`agent`/`signal` 取自工具运行时 `exec`（`ToolRunContext`），回退 `agents.currentInitiator()`。

### 本地验证（node --check + 桩测试，均通过）
- `node --check` 通过 `ide-tools.js`、`index.js`；`tsc -p ./` 编译 `dsh-bridge` 通过，`out/extension.js` 含 `bridgeHeaders`/nonce 头。
- 桩测试：`ide_terminal` 抛“disabled”；`ide_writeFile` 允许(1 次审批)→经桥写入；`ide_editFile` 被拒(0 次桥调用)；审批服务缺失→fail-closed。
- 桩测试：`/ide-cmd/exec` 不存在；`/ide-cmd/poll|result` 无/错 nonce→403，正确 nonce→200。

### 待重启生效 + 验收（与 Layer 1 合并到同一重启窗口）
- 重打 tgz → install_bundle → **重启 DSH，并“完全关闭再重开” DSH-IDE 窗口**（不能只靠 `--reuse-window` 转发：
  旧窗口的扩展宿主没有新注入的 `DSH_IDE_BRIDGE_NONCE`，会导致 poll/result 403、写/诊断/LSP 失效）。
- 验收：执行动作均留 `tool/call`+`approval/*` 审计对；`/ide-cmd/exec` 外部不可达（404）；`/ide-cmd/poll|result` 无 nonce 403；
  `ide_writeFile/editFile` 在 ask 策略下弹审批、允许后可见写入；`ide_terminal` 明确禁用。
- 回退：本轮为 `ide-tools.js` + `index.js` + `extension.ts` 源码改动，独立 `git revert` 即可（不影响官方聊天链路）。

### 说明 / 边界
- 本轮“执行限制”采取**去旁路 + 审批化 + 停用直跑**，未把 `ide_terminal` 改接官方 bash 工具：当前 Host 组成未装配
  `dsh-tool-bash`（其执行经 `ctx.shell` + `ctx.sandboxPolicy`），静态无法验证；按计划“或先禁用”先行停用最稳。
  后续如需恢复命令执行，走“官方 bash 工具/终端能力”而非重新打开 `shell:true`。
- `ide_writeFile/ide_editFile` 仍是经命令桥在 VS Code 内**可见**写入（非 `ctx.fs` 沙盒），本轮只补“审批”这一审计侧；
  是否进一步改走 `ctx.fs.writeText/editText`（沙盒化，代价是失去编辑器内可见/撤销）留待后续按需评估。

### 预置完成（2026-11-02，重启前，用户手动重启生效）
- 重打运行时：`build-runtime.mjs --electron-from "C:/Users/guyu/AppData/Local/Programs/DeepSeek Harness"` → `runtime/` 刷新
  （`out` 7784 文件 / 95 扩展 / 生产依赖 201 包；bridge 扩展 nonce 已进 `runtime/.../dsh-bridge/out/extension.js`）。
- 重打包：`npm pack` → `dist/dsh-ide-0.0.0.tgz`（572.5MB / 51058 文件 / shasum `fcfbe936…`）。
  抽检 tgz 内：`index.js` 会话端点 0、`ideBridgeNonce` 在、`ide-tools.js` 有 nonce 且无 `/ide-cmd/exec`、运行时 bridge 含 nonce。
- 安装：`file:` 同版本 tarball 触发 `already-installed`（installer 按未变 spec 去重），按官方提示 **remove_bundle → install_bundle**，
  `application: applied`（pnpm 6m14s，`+1 -16` 为按当前 tarball 重算内置扩展计数）。安装副本抽检全部通过；`node --check` 通过。
- **待用户手动重启 DSH**：重启后插件加载新 `index.js`/`ide-tools.js`；**打开 DSH-IDE 时须全新窗口**（旧窗口扩展宿主无新 nonce）。
