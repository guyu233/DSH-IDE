# DSH-IDE 插件安全审计报告

- **审计对象**：`E:\vscode-dsh\dsh-vscode-workbench`（`index.js` / `ide-tools.js` / `client.js` / `scripts/build-runtime.mjs`）
- **审计日期**：2026-10-29
- **审计模式**：只读（未修改任何代码）
- **审计者**：安全评审（security reviewer）

---

## 0. 官方 DSH 连接模型（已核实，作为对照基线）

审计结论依赖于官方模型的真实行为，已从安装包 `app.asar` 反查核实（非猜测）：

1. **回环绑定**：`@deepseek-ai/dsh-host-webserver` 的 `Config.host` 为**必填的具体 IP 字面量**，并显式**拒绝 wildcard/unspecified 地址**——源码注释原文：*"binding every interface would expose remote code execution to the network"*（`dsh-host-webserver/lib/index.js` 约 253–258 行）。桌面端以 `--host 127.0.0.1 --port 0` 启动（`lib/main.js`）。→ 官方 HTTP Host **只监听 127.0.0.1**。
2. **凭证模型**：`ctx.connection.authenticatedUrl(baseUrl)` 把**每进程 launch token** 作为 `?token=` 追加到 URL（`dsh-client-connection/lib/index.js` 约 440 行）。任一方 `GET /?token=...`（`redirect:'manual'`）即得 `303 + Set-Cookie`（约 461–477 行）。Cookie 属性为 `HttpOnly; SameSite=Strict; Path=/`（约 346–349 行），cookie 名按 Host authority 哈希，值由每次激活的 secret 签名。
3. **`/api` 围栏**：官方 `/api` 除要求有效 Cookie 外，还经 `isTrustedApiRequest` 做 **Host/Origin 同源围栏**：Host 必须是 loopback/trusted/bind 地址；`Sec-Fetch-Site: cross-site` 直接拒绝；带 `Origin` 时必须与本监听 authority 同源（约 235–300 行）。`/api/remote.mux` 走同一 Cookie。
4. **关键落差**：上述围栏**只作用于官方 `/api` 与 `/api/remote.mux`**。插件用 `ctx.webServer.register(...)` 自注册的端点（如 `/dsh-ide/connection`、`/dsh-session/*`、`/ide-cmd/*`）**完全绕过**这套 Origin/Cookie 围栏——这是本报告绝大多数风险的根因。

> 结论：官方通道本身设计良好；风险几乎全部来自插件自建的旁路端点与 CORS 通配。

---

## 1. 凭据处理

### 1.1 `/dsh-ide/connection` 无鉴权下发 per-process launchUrl

- **位置**：`index.js:583–599`；关键行 `index.js:597`（`const launchUrl = conn.authenticatedUrl(origin)`）、`index.js:599`（响应体返回 `{origin, launchUrl, muxUrl, allowsRemoteAuthorities}`）。
- **问题**：
  - 该端点**无任何鉴权**：不校验 `Origin`、不校验调用者身份、不要求 Cookie，只做 JSON 序列化返回。
  - 它返回的 `launchUrl` 内含**每进程 launch token**（即官方凭证交换的 bearer 入口）。任何拿到该 URL 的主体（本地进程 / 跨源网页）都能完成 `token → Cookie` 交换，进而以 **owner principal** 访问官方 `/api`（会话 prompt、控制器等）。
  - **是否可被其他本地进程/网站触达**：是。因为响应经 `sendJson`（`index.js:409–412`）写入了 `Access-Control-Allow-Origin: *`（定义见 `index.js:1127–1132`），这是**简单 GET 请求**，浏览器无需预检即可跨源读取响应 → 任意网页可读取含 token 的 `launchUrl` 并外传。同一 LAN/本机的任意进程也可直接请求。
  - **是否记录 token/cookie**：代码本身**未**把 `launchUrl`/token/cookie 写入日志（`launchIde` 仅 `log(pid, folder)`，见 `index.js:215`；本端点不打日志）——此点良好，须保持。
- **风险评级**：**High**（凭证泄露 + 绕过官方围栏）。
- **建议**：
  1. 该端点**绑定 loopback**（已是 loopback，但需在应用层再校验 `req.socket.remoteAddress` 为回环）；
  2. **强制校验 `Origin`**（只允许 IDE 的实际来源）；或改为**一次性 nonce**：`launchIde` 生成随机 nonce 写入 IDE 侧配置，`/dsh-ide/connection` 必须携带匹配 nonce 才返回；
  3. **一旦 IDE 侧改为官方 `/api`+mux 直连，即删除 `/dsh-ide/connection`**（迁移文档"待删清单"已列）；
  4. **永不记录** token/cookie/launchUrl 到任何日志。

---

## 2. CORS 面

### 2.1 `DSH_CORS_HEADERS` 使用 `Access-Control-Allow-Origin: *`

- **位置**：`index.js:1127–1132`（定义）；经 `sendJson`（`index.js:409–412`）、`handlePreflight`（`index.js:1139–1146`）、`applyCors`（`index.js:1134–1137`）以及多处 `res.writeHead(..., ...DSH_CORS_HEADERS)` 应用。
- **CORS 全开（`*`）的端点清单**（均在 `index.js`）：

| 端点 | 行号 | 方法 | 说明 |
|---|---|---|---|
| `/dsh-session/op` | 460 | POST | 归档/置顶/重命名（破坏性会话操作） |
| `/dsh-session/activate` | 645 | GET/POST | 设置活动会话映射 |
| `/dsh-session/create` | 674 | POST | 新建会话 |
| `/dsh-session/page` | 695 | GET | 读会话历史 |
| `/dsh-session/prompt` | 734 | POST | **向 agent 发消息（高危）** |
| `/dsh-session/cancel` | 757 | POST | 取消 turn |
| `/dsh-sessions` | 609 | GET | 列出会话（含 cwd/标题） |
| `/dsh-workspace/stream` | 530 | GET(SSE) | follow 增量流 |
| `/dsh-ide/connection` | 583 | GET | **下发 launch token** |
| `/dsh-account` | 1000 | GET | 账号显示信息 |
| `/dsh-account/sign-in` | 1021 | POST | 触发登录 |
| `/dsh-account/sign-out` | 1055 | POST | 退出登录 |

- **未加 CORS、但因不校验 Origin 仍可被 CSRF 触发副作用**的端点：`/dsh-ide-launch`（312）、`/dsh-ide-focus-dsh`（342）、`/vscode-ai`（867）、`/dsh-ide-changes`（939）、`/dsh-ide-diff`（958）、以及 `ide-tools.js` 的 `/ide-cmd/exec|poll|result`（56/73/84）。
  > 注意：**CORS 缺失只阻止"读响应"，不阻止"发请求产生副作用"**。浏览器用 `text/plain` 简单请求即可触发 `POST`，服务端 `readJsonBody` 仍会 `JSON.parse` 该文本。因此 `/ide-cmd/exec`、`/dsh-ide-launch` 这类端点天然可被跨源 CSRF。

### 2.2 风险评估：`/dsh-session/op`、`/dsh-account`、`/dsh-ide-launch`、`/ide-cmd/*` 是否可被跨源调用

- **`/dsh-session/op`**：可被任意网页跨源调用并读回结果 → 恶意页面可**归档/置顶/重命名**用户所有会话（含 `stopActivity` 强停活动会话）。
- **`/dsh-session/prompt`**：可被任意网页/本地进程跨源调用，向**具备完整工具能力的 agent** 注入任意 prompt → 等价于把"命令执行"能力交给任意网页（**RCE 链**，见 4.2）。
- **`/dsh-account`**：泄露登录态显示信息（姓名/脱敏手机号/头像）；`sign-in`/`sign-out` 可被跨源触发。
- **`/dsh-ide-launch`**：无 CORS，但可被跨源简单 POST 触发 → 反复拉起 IDE 进程（资源/DoS），见第 6 节。
- **`/ide-cmd/*`**：可被跨源/本地调用，向 IDE 扩展排队**任意 `{command,args}`**（含 `runCommand`、`writeFile`、`editFile`）→ 未授权驱动 IDE，且**不进 DSH 审计**（见第 4 节）。
- **风险评级**：**High**（`/dsh-session/prompt`、`/ide-cmd/*`、`/dsh-ide/connection`）；其余 **Med**。
- **建议**：把 `Access-Control-Allow-Origin: *` **收敛为显式 IDE 来源白名单**（`vscode-file://`/`file://` 的 origin 为 `null`，需按实际渲染来源显式反射，禁止 `*`）；对**所有**插件端点统一加 `Origin`/`Sec-Fetch-Site` 校验中间件；无法确定来源的端点一律要求自定义 nonce 头。对纯本地自动化端点（`/ide-cmd/*`、`/vscode-ai`）默认关闭，或用进程内 nonce 保护。

---

## 3. 路径与命令执行（`ide-tools.js`）

### 3.1 根目录未做包含性校验，`../` 与绝对路径均可逃逸

- **位置**：`ide-tools.js:141–147`（`makeResolveRoot`）。
- **代码行为**：
  ```js
  const abs = path.isAbsolute(p) ? p : path.join(root, p);
  return path.normalize(abs);
  ```
- **问题**：
  - **绝对路径直接放行**：`resolve('C:\\Windows\\System32\\...')` 或 `resolve('/etc/passwd')` 完全绕过 `root`。
  - **`../` 未拦截**：`path.join(root, '../../secret')` + `path.normalize` 会逃逸出 `root`，**没有** `path.relative(root, abs)` 是否以 `..` 开头的检查、也没有 realpath 校验（符号链接亦可绕过）。
  - 影响所有 `ide_readFile / ide_listDir / ide_glob / ide_search / ide_terminal / ide_writeFile / ide_editFile`。
- **风险评级**：**High**（读写/执行范围无界，等同 DSH 进程权限的任意文件访问）。

### 3.2 `ide_terminal` 通过 `shell:true` 执行任意 shell 命令

- **位置**：`ide-tools.js:293–320`（工具定义）；关键行 `ide-tools.js:308`：
  ```js
  execFile(command, { cwd: dir, shell: true, timeout: 120000, maxBuffer: 4*1024*1024, windowsHide: true }, ...)
  ```
- **问题**：`command` 是**整条命令串**且以 `shell:true` 交给系统 shell → **任意代码执行**（`;`、`&&`、管道、重定向、子命令全部生效）。它**不经过** DSH 的 bash 沙箱/权限预设/审批，直接在 Host 进程上下文以用户权限运行。
- **风险评级**：**High**（宿主级任意命令执行，且绕过 DSH 沙箱与审批）。

### 3.3 `ide_writeFile` / `ide_editFile` 沿用未约束的 resolve

- **位置**：`ide-tools.js:323–364`。二者经命令桥把 `resolve(p)` 得到的**绝对路径**交给 VS Code 扩展写入 → 写入位置不受 `root` 约束（同 3.1）。
- **风险评级**：**Med–High**（任意路径写入）。

- **建议**：
  1. **强制根包含**：`const rel = path.relative(root, abs); if (rel.startsWith('..') || path.isAbsolute(rel)) throw ...`；拒绝绝对路径入参（或一律相对 `root` 解析）；对已存在路径做 `realpath` 校验防符号链接逃逸。
  2. **`ide_terminal` 禁用 `shell:true` 直跑**；如确需 shell，接入 DSH 的 `ctx.tools` pre-execute + `ctx.approval` + `ctx.sandboxPolicy`（与官方 `dsh-tool-bash` 一致），使其受权限预设/沙箱/审批约束。
  3. **`ide_writeFile`/`ide_editFile` 映射到 DSH 权限预设/审批**（写操作走 `ctx.approval.request`，与官方 `dsh-tool-fs` 的 `write`/`edit` 对齐）。

---

## 4. 审计可见性

### 4.1 `ide_*` 工具写/终端是否进入 DSH 审计

- **已注册为 DSH 工具**：`ide-tools.js:447–464` 通过 `ctx.get('tools').register(...)` 注册全部 `ide_*`。DSH 工具层会把每次调用记入会话日志 `tool/call` + `tool/result`（`dsh-agent-loop/lib/index.js` 的 `appendToolCall`/`appendToolResult`，约 683/698 行）→ **调用与输出可被会话日志审计**。
- **但**：
  - 这些工具**不经过** `tools/pre-execute` / `ctx.approval` / 沙箱（实现直接 `fs.*` 与 `execFile`），所以**没有** `approval/asked`/`approval/decided` 审计对，也**不受权限预设约束**——审计"有调用记录、无审批记录"。
  - **真正的旁路**是 `ide-tools.js:52–98` 的 `/ide-cmd/exec|poll|result` HTTP 端点：任何调用者可越过 tools 层直接把任意 `{command,args}` 入队执行，**完全不产生 `tool/call` 事件**，即**完全不可审计**。

### 4.2 会话 prompt 端点构成 RCE 链

- `/dsh-session/prompt`（`index.js:734`）跨源可调用 → 向运行中的 agent 注入 prompt；该 agent 持有 `ide_terminal`、`bash`、`write` 等工具 → 攻击者无需直接触发 `ide_terminal` 即可间接获得命令执行。

- **风险评级**：**High**（`/ide-cmd/exec` 不可审计的写入/执行旁路；prompt→工具 RCE 链）。
- **建议**：
  1. 把 `ide_*` 的写/执行能力接入 `ctx.tools` 的 pre-execute 审批与 `ctx.approval`，使每次写入/终端运行都留下 **审批审计对**；
  2. **移除或强鉴权 `/ide-cmd/exec`**（改为仅扩展宿主可用的内部通道，绑定进程内 nonce，绝不对 `webServer` 公开）；
  3. `/dsh-session/prompt` 收紧到 IDE 同源。

---

## 5. IPC / 复用攻击面

- **事实（已核实）**：本机不存在可被"拉起的子进程"消费的官方 IPC carrier（`@alatastudio/*` 版本代不符；`@deepseek-ai` 无 `dsh-client-connection-vscode`；桌面 `dsh-app://` 自定义协议只接受 `dsh-app://app` 渲染帧；stdio `ipc` 被 Electron 主进程独占）。
- **结论**：
  - **IPC 复用不可用**，因此不存在"IPC 复用"这条攻击面。
  - **硬链接复用 Electron 不可行**（C: 与 E: 为不同物理盘，跨卷硬链接被拒；且 DSH 安装 `resources/` 只有 `app.asar` 无 `app/`）。
  - 因此**真正的攻击面就是第 1/2 节所述**：`/dsh-ide/connection` + 通配 CORS + 无鉴权的插件旁路端点。
  - 附带（**Low**）：`resolveIdeRuntime`（`index.js:101–134`）会信任显式配置 `ideExe/ideAppPath`、环境变量 `DSH_IDE_ELECTRON/DSH_IDE_APP`、以及包内 `runtime/` 与旧 `../dsh-ide` 回退路径。若攻击者能篡改配置/环境变量或投放同名可执行文件，可令 `launchIde` 拉起任意 exe。建议对 exe 路径做签名/归属校验，并在文档中明确"配置与 env 属可信边界"。

---

## 6. 终端 / 进程

### 6.1 `launchIde` detached 启动 + `/dsh-ide-launch` 无鉴权

- **位置**：`launchIde` `index.js:146–217`（`spawn` 于 `index.js:202–208`，`detached:true, stdio:'ignore'`）；端点 `/dsh-ide-launch` `index.js:312–336`。
- **问题**：
  - `/dsh-ide-launch` **无鉴权、无 Origin 校验**，仅校验 `req.method === 'POST'`。任何本地进程可 POST；任意网页亦可用 `text/plain` 简单请求跨源 POST（`readJsonBody` 会 `JSON.parse` 文本 body）触发拉起。
  - `detached:true` + `unref` 使 IDE 成为独立进程组，DSH 退出也不回收 → 反复触发可造成进程堆积（资源/DoS）。
  - `folder` 来自 `resolveSessionFolder(sessionId)`（会话 cwd）或 `cfg.folder`；`sessionId` 由请求体控制，配合上述未鉴权可反复以不同目录拉起窗口。
- **风险评级**：**Med**（未授权进程拉起 / DoS；非直接代码执行，因 exe 路径由配置决定）。

### 6.2 `/dsh-ide-focus-dsh` 可执行 powershell / spawn 宿主 exe

- **位置**：`index.js:342–380`。若配置了 `cfg.dshFocusScript`，会 `execFile('powershell.exe', ['-File', script, folder])`（`index.js:356`，参数数组形式，**无 shell 拼接**，folder 注入风险低）；否则 `spawn(dshExe)`（`index.js:367`）。端点本身无鉴权/无 Origin 校验。
- **风险评级**：**Low–Med**（仅触发预配置脚本/宿主 exe，路径由配置决定）。
- **建议**：
  1. `/dsh-ide-launch`、`/dsh-ide-focus-dsh` **要求同源或一次性 nonce**（`launchIde` 时生成、随 IDE 配置下发，端点校验）；
  2. 增加 `Origin`/`Sec-Fetch-Site` 校验与频率限制；
  3. 对 `detached` 子进程做**单实例/存活跟踪**，避免重复拉起；
  4. `dshFocusScript`/`dshExe` 属可信配置，文档化并做存在性/归属校验。

---

## 7. 汇总：按优先级排序的发现表

> 严重度：High（可利用/影响大）/ Med（需一定前置条件）/ Low（纵深防御）。

| # | 严重度 | 位置 (file:line) | 问题 | 建议 |
|---|---|---|---|---|
| 1 | **High** | `index.js:583–599`（`authenticatedUrl` 于 `:597`，返回 `launchUrl` 于 `:599`） | `/dsh-ide/connection` 无鉴权/无 Origin 校验，经通配 CORS 下发含 per-process token 的 `launchUrl`；本地进程或任意网页可换取 owner Cookie 从而绕过官方 `/api` 围栏 | loopback-only + Origin 校验 + 一次性 nonce；用后删除该端点；永不记录 token/cookie |
| 2 | **High** | `index.js:734–756` | `/dsh-session/prompt` 通配 CORS，可跨源向具备工具的 agent 注入任意 prompt → RCE 链 | 收敛 CORS 到 IDE 同源；加 Origin/Sec-Fetch-Site 校验 |
| 3 | **High** | `ide-tools.js:52–98`（`/ide-cmd/exec` 于 `:56`） | 未鉴权 HTTP 端点可入队任意 `{command,args}`（含 writeFile/runCommand），**完全绕过 DSH 审计**；可跨源 CSRF | 移除或改为内部 nonce 通道，绝不暴露到 webServer |
| 4 | **High** | `ide-tools.js:293–320`（`:308` `execFile(command,{shell:true})`） | `ide_terminal` 以 `shell:true` 执行任意命令串，绕过 DSH 沙箱/权限预设/审批 | 禁 `shell:true` 直跑；接入 `ctx.approval` + `ctx.sandboxPolicy` |
| 5 | **High** | `ide-tools.js:141–147` | `makeResolveRoot` 无根包含校验：绝对路径放行、`../` 可逃逸、无 realpath 检查 | 强制 `path.relative` 包含校验；拒绝绝对路径；realpath 防符号链接 |
| 6 | **High/Med** | `index.js:1127–1132`（`*`）；应用点 `:409–412, :1139–1146` | `Access-Control-Allow-Origin: *` 全局通配，12 个端点（含 `op/activate/create/page/prompt/cancel/sessions/stream/connection/account*`）可被任意来源读写 | 收敛为显式 IDE 来源白名单，移除 `*` |
| 7 | **Med** | `index.js:312–336`（`spawn` `:202–208`） | `/dsh-ide-launch` 无鉴权/无 Origin；detached+unref 可被跨源 CSRF 反复拉起（DoS） | 同源/ nonce 校验 + 频率限制 + 单实例跟踪 |
| 8 | **Med** | `index.js:867–898` | `/vscode-ai` 无鉴权、未校验 Origin，可被本地/跨源触发消耗用户 LLM 配额、注入 system | 加来源/nonce 保护，或改内部通道 |
| 9 | **Med** | `index.js:1000–1090` | `/dsh-account*` 通配 CORS：泄露登录显示信息；可跨源触发 sign-in/sign-out | 收敛 CORS + Origin 校验 |
| 10 | **Med** | `index.js:460–536, 645–683, 695–756` | 会话类端点（op/activate/create/page/cancel）通配 CORS，任意网页可跨源破坏/操控会话 | 同上，收敛来源 |
| 11 | **Low–Med** | `index.js:342–380`（`:356` powershell, `:367` spawn） | `/dsh-ide-focus-dsh` 无鉴权，可触发预配置脚本/宿主 exe | 同源/nonce 校验 |
| 12 | **Low** | `index.js:101–134` | `resolveIdeRuntime` 信任配置/环境变量/回退路径，可被投毒为任意 exe | exe 归属/签名校验；文档化可信边界 |
| 13 | **Low** | `index.js:215`；`ide-tools.js:137,360` | 目前未记录 token/cookie（良好），但缺少"禁止记录凭证"的显式约束与脱敏兜底 | 增加日志脱敏守卫，禁止打印 `launchUrl/token/cookie` |
| 14 | **Low** | `index.js:939–966`（`/dsh-ide-changes` `:958` diff） | 未鉴权端点暴露工作区改动与 diff 内容 | 加来源校验；仅在需要时开启 |

---

## 8. 最小加固清单（按落地顺序）

1. **收敛 CORS**：把 `DSH_CORS_HEADERS`（`index.js:1127`）的 `Access-Control-Allow-Origin: *` 改为**显式 IDE 来源白名单反射**，禁止 `*`；对所有插件端点统一加 `Origin` / `Sec-Fetch-Site` 校验中间件。（覆盖发现 #6、#9、#10）
2. **保护 `/dsh-ide/connection`**：加 loopback 校验 + `Origin` 校验 + **一次性 nonce**；IDE 侧改官方 `/api`+mux 后**删除该端点**；确保任何日志不打印 `launchUrl/token/cookie`。（发现 #1、#13）
3. **根包含强校验**：`makeResolveRoot`（`ide-tools.js:141`）增加 `path.relative(root, abs)` 越界拒绝 + 拒绝绝对路径 + realpath 防符号链接。（发现 #5）
4. **`ide_terminal` 去 `shell:true`**：改为受控执行并接入 DSH 沙箱/审批；`ide_writeFile/ide_editFile` 接入 `ctx.approval` 与权限预设。（发现 #3、#4、#6 的执行侧）
5. **关闭/保护 `/ide-cmd/*`**：改为扩展宿主内部 nonce 通道或直接移除；至少拒绝未经 nonce 的外部调用。（发现 #3）
6. **`/dsh-session/prompt` 收紧来源**：只允许 IDE 同源，防 prompt 注入 RCE 链。（发现 #2）
7. **`/dsh-ide-launch`、`/dsh-ide-focus-dsh` 加同源/nonce + 频率限制 + 单实例跟踪**。（发现 #7、#11）
8. **`/vscode-ai`、`/dsh-account*` 加来源/nonce 保护**，或默认关闭、按需开启。（发现 #8、#9）
9. **运行时/配置可信边界**：对 `ideExe/ideAppPath/DSH_IDE_*` 做归属校验并文档化；禁止配置投毒拉起任意 exe。（发现 #12）
10. **审计补全**：确保所有写/执行能力都经 `ctx.tools` + `ctx.approval`，在会话日志留下 `tool/call`+`approval/*` 对；移除任何不入审计的执行旁路。（发现 #3、#4 的审计侧）

---

## 附：审计范围与只读声明

- 已读文件：`index.js`（1216 行）、`ide-tools.js`（464 行）、`client.js`、`scripts/build-runtime.mjs`、`package.json`、`cordis.patch.yml`；对照核验了安装包 `app.asar` 内 `dsh-host-webserver`、`dsh-client-connection`、`dsh-tools`、`dsh-agent-loop`、`dsh-user-approval`、`dsh-permission-presets` 等实现，以及 `docs/dsh-ide-migration.md`。
- **本次审计未修改任何代码**；仅新建本报告文件。
