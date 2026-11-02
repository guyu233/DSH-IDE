# DSH-IDE 可复用事实附录（facts）

> 本文件从实测与已装的 DSH `0.2.1-rc.5` `app.asar` 提炼**工程事实**，供 v1.0 施工直接复用。
> 旧架构（独立窗口 + 官方回环 HTTP `/api` + `/api/remote.mux` + `dsh-bridge` 扩展）已被 v1.0 推翻，仅见 `docs/archive/`。
> **逐字段核验的 rc.5 服务契约见 `.build/rc5-contract.md`（施工期权威，随构建可弃）；本文收长期有用的基线事实。**

## 0. rc.5 服务契约要点（实测，纠正早期按 0.2.2-alpha 的假设）

从已装 `app.asar` 的 `dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/**` 等提取并 `cordis_inspect_query` 实时核对，与早期草稿的偏差（务必按此实现）：

| 项 | 早期草稿（错） | rc.5 实测（对） |
|---|---|---|
| sessionController 方法 | 含 events/state/wait | **无** events/state/wait；有 list/search/create/selectModel/modelCatalog/rename/fork/prompt/attachment/cancel/**page**/**follow**/projections/**control**/updateQueue/openWorkspacePath… |
| follow 帧 | 假设 {events:[…]}/delta | 首帧 `{type:'snapshot', records:[{type:'event',event}], header, cursor, hasMore, projections}`；之后逐条 `{type:'event', event}`；`assistantStream:true` 时另有 `{type:'assistant-stream', frame}` |
| page 返回 | 假设裸数组 | `{ records:[{type:'event',event}], hasMore }` |
| prompt 请求 | 含糊 | `{ sessionId, requestId, content:ContentBlock[], mode?('steer'|'followup'), clientTimeZone? }` |
| selectModel 请求 | — | `{ sessionId, provider, model, reasoningEffort? }` -> `{ selected:{provider,model,reasoningEffort?} }` |
| agentPresets.read | `read()` | 服务方法 `readDocument(id)`（`@Remote('read')`） |
| 目标服务 | `goal` + `(payload)` | 服务名 **`goals`**，每方法首参为 **live Agent**：`get/create/edit/pause/resume/complete/clear(agent, …)` |
| approval.request | 可随时调用 | **必须在 open turn 内**（否则抛错）；策略 `ask|never`；结果集 `allowed-once|rejected|cancelled|unavailable`（仅 allowed-once 放行） |
| 权限预设 | — | `permissionPresets.catalog()` -> `{ options, defaultOptions, defaultPreset }`；`set(session, preset)` 组合 approval.setPolicy |
| 四模式预设 | — | `agentPresets.list()` -> `[{id,name?,description?,order?,broken?}]`；`select(agent,preset)` 在首轮后抛 `agent-preset/locked` |
| 事件信封 | — | `{type,seq,time,data,ignorable?,surfaceOp?,sourceEventSeqs?}`；**禁止 append 新 type**（仅 `ignorable:true` 记录可重开） |

## 1. 私有管道拓扑（v1.0 权威）

- **VS Code Electron 主进程 = 管道客户端**（`net.connect(process.env.DSH_IDE_PIPE)`，首帧 `{chan:'handshake',nonce}`）。
- **DSH Host（Cordis 插件 `dsh-ide`）= 管道服务端**（`net.createServer`，握手校验 nonce）。
- 端点：`\\.\pipe\dsh-ide-<hostPid>-<nonce>`。帧：4 字节大端长度前缀 + JSON。
- 通道 **A**（VS Code→Host）：DSH 服务调用（会话/模型/预设/审批/权限/目标），Host 回 data/end/error。
- 通道 **B**（Host→VS Code）：`ide_*` 执行 `{op,args}`，VS Code `ideExec` 回 `{ok,result|error,auditToken}`。
- 无 HTTP、无 `/api`、无 cookie。审计：工具调用经 DSH `tools` 层留 `tool/call`+`tool/result`；写/终端经 `approval/*`。

## 2. 构建 / 打包事实（沿用实测基线）

- **体积基线（旧 runtime 实测）**：`runtime/` ≈ 1793 MB / 55,275 文件 = Electron dist 348.11 MB / 71 文件 + app 1445.30 MB / 55,204（node_modules 754MB · extensions 549MB · out 129MB · resources 10MB）。
- **生产依赖闭包**：必须用 `npm ls --omit=dev --all --parseable` 生成完整闭包（约 201 顶层包），**不能手写列表**（会漏 `@vscode/policy-watcher` 等）。`dsh-ide/build-runtime.mjs` 已实现。
- **内置扩展必须全量复制**（含无 `out/` 的主题/语法扩展），否则缺默认主题与高亮。
- **扩展 node_modules 内符号链接必须原样保留**；`fs.cpSync(dereference:true)` 会产出绝对路径断链。
- **`out/` 必须剥离测试目录**（省 ~196MB）。
- **Electron 按平台裁剪**：只留 `win32-x64`；保留 `*.dll`/`*.pak`/`icudtl.dat`/`snapshot_blob.bin`/`v8_context_snapshot.bin`/`locales/`/`version`；可省 `LICENSES.chromium.html`(~20MB)。

## 3. 扩展裁剪实测（本轮）

| 扩展 | 实测体积 | 处理 |
|---|---|---|
| `github` | **137 MB** | 删 |
| `github-authentication` | **106 MB** | 删 |
| `microsoft-authentication` | **138 MB** | 删 |
| 合计 | ≈ **381 MB** | 已删（原计划估值 ~79MB，实测远大于此） |

其余扩展全部保留（构建时另跳过纯测试/示例扩展：`vscode-api-tests`/`vscode-colorize-*`/`vscode-test-resolver`/`vscode-test`）。

## 4. 本机 DSH 事实（实测）

- **已装 DSH = `0.2.1-rc.5`**；DSH 源码实际全部在 `app.asar` 内（`dsh/node_modules/@deepseek-ai/*`，共 315 个包），`app.asar.unpacked/dsh/` 仅有原生依赖 `node_modules`（`dsh-session-log-export`/`libreoffice-kit*`）。
- DSH 装在 `C:`（NVMe），仓库在 `E:`（HDD）→ **跨卷硬链接不可能**（实测 `C:→C:` 成功、`C:→E:` 失败）。
- DSH `resources/` 只有 `app.asar`(182MB) + `app.asar.unpacked` + `runtime/`，**无 `app/`** → 其 exe 永远加载 DSH 外壳。
- **bundle 的 exe 与 DSH 的 exe 字节一致**（同 SHA256）→ Electron 来源可靠，自带 dist 即可。

## 5. ELECTRON_RUN_AS_NODE 陷阱（两条模式都要）

- 必须 `delete env.ELECTRON_RUN_AS_NODE`，**不能**赋 `undefined`（Electron 检查变量存在性，设 undefined 仍按 Node 模式崩，报 `Cannot find module <argv0>`）。
- 配套：`appPath = <exe>/resources/app`；`VSCODE_DEV=1`；`--folder-uri`（非位置参数）；`--reuse-window` 单实例切目录；启动前 `delete ELECTRON_NO_ATTACH_CONSOLE`/`ELECTRON_ENABLE_LOGGING`。
- 拉起 env 另注入：`DSH_IDE_PIPE`（完整管道路径）、`DSH_IDE_NONCE`（握手）、`DSH_IDE_LAUNCH='1'`。`host/launch.js` 已实现单实例存活跟踪。

## 6. 安全底线（v1 私有管道 + ideExec 落实）

v1 的私有管道 + 删 `dsh-bridge` 关闭了旧 #1/#2/#3/#6/#9/#10（通配 CORS + `/api` 旁路 + `/ide-cmd` 不可审计桥）。仍需：
- **#4 `ide_terminal` 去 `shell:true`**：经受控执行（审批 + 沙盒），不直跑 `execFile(command,{shell:true})`；`ideExec` 侧同样禁 `shell:true`。
- **#5 根包含校验**：`path.relative(root,abs)` 越界拒绝 + 拒绝绝对路径入参 + `realpath` 防符号链接逃逸（`ide_readFile/listDir/glob/search/writeFile/editFile`）。Host（`host/tools.js`）与 VS Code（`ideExec.ts`）双侧落实。
- **#7 `/dsh-ide-launch` + 单实例**：launch 端点要求 POST；对 detached 子进程做存活跟踪，避免重复拉起（DoS）。
- 凭据（launch token / Cookie）**永不写入任何日志**。
- **审批语义**：写/终端经 `ctx.approval.request`（模型在 turn 内合法），策略 `ask|never`；**不在轮次之间裸 append `approval/*` 事件**（会导致会话重开失败）。

## 7. 验收四关（裁剪后必过，用户机器执行）

1. 冒烟启动（自带 Electron `<exe> resources/app --folder-uri=… --user-data-dir=… --extensions-dir=… --reuse-window`，无崩溃/无 Cannot find module）。
2. 无扩展报错（扩展宿主日志无 `Activating extension failed` / `Cannot find module`）。
3. 账号连通（裁剪 `microsoft-authentication`/`github-authentication` 重点回归）。
4. Chat 可用（私有管道接通 + 子应用加载 + 事件渲染）。

> **本环境无法拉起 Electron/DSH Host 联动**；G0/G1/G2/G3/G5 与超越项须在用户机器 GUI 验收。本环境可交付：源码、Host 纯 JS（`node --check` 通过 + 管道功能自测通过）、构建脚本、删除/裁剪、docs 定稿、git 提交。
