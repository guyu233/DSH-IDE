# dsh-ide 运行时策略 / Runtime Strategy

> 适用范围：`dsh-vscode-workbench` 的 IDE 运行时（`runtime/`）——即「用 DSH 自带 Electron 外壳加载我们的 VS Code 应用」这一套。
> 本文只做策略与基线说明，不改动任何代码或构建脚本。
> 关键前提（均已实测）：DSH Desktop 装在 `C:`（NVMe），仓库/bundle 在 `E:`（HDD），两者是**不同物理卷**。

---

## 1. 复用策略结论 / Reuse Strategy Conclusion

**结论：「复用 DSH 自带 Electron」当前不可行。** 两个硬约束各自都足以否决：

1. **跨卷硬链接不可能。** DSH 装在 `C:`（NVMe），bundle 在 `E:`（HDD）——不同物理卷。
   实测：`C: → C:` 硬链接成功；`C: → E:` 失败并报 *"cannot move to a different disk drive"*。
   因此无法把 DSH 的 `electron/` dist 以硬链接方式「零拷贝」进 `E:` 上的 bundle。
2. **DSH 的 `resources/` 只有 `app.asar`，没有 `app/` 目录。**
   `C:\Users\guyu\AppData\Local\Programs\DeepSeek Harness\resources\` 下是 `app.asar`（182 MB）+ `app.asar.unpacked/` + `runtime/`，**不存在** `resources/app/`。
   而我们的启动方式要求 `appPath = <exe>/resources/app`（见第 5 节）。DSH 安装体的 exe 会**优先加载 `app.asar`**，永远只会起 DSH 外壳，而不是我们的 VS Code 应用。
   ⇒ 直接拿 DSH 安装目录当 IDE 运行时，必然加载成 DSH 自身。

### 方案对比 / Options

| 方案 | 做法 | 体积 / 分发 | 适用场景 | 判定 |
|---|---|---|---|---|
| **(a) 自带 Electron dist**（当前） | bundle 内放一份完整 Electron dist（`--electron-from` 拷贝），exe 与我们同卷 | ~348 MB，**可独立分发**，不依赖用户装了什么 | 生产/发布 | ✅ **采用** |
| **(b) 同卷本地 `dsh-ide` 目录硬链接 dist** | 在 `E:` 上另建一个与 bundle 同卷的 `dsh-ide/`，把 Electron dist 硬链接进去复用 | 开发机上 0 额外拷贝（仅同卷时可行） | **仅开发机**（`C:` 与 `E:` 不满足，需两者同卷） | ⚠️ 记为 dev-only 优化 |
| **(c) bundle 整体放 `C:`（与 DSH 同卷）** | 把 runtime 搬到 `C:`，再与 DSH dist 硬链接 | 省 ~348 MB，但要求用户设备上 DSH 与 bundle 同卷、且版本匹配 | 特殊部署 | ⚠️ 不通用，不推荐作为默认 |

> 当前 bundle 里那份 exe 与 DSH 的 exe **字节一致**（SHA256 `FD7D298F...4C0C`），证明 dist 来源可靠；限制只在「怎么放到 `E:` 上」而非「用哪份 Electron」。

### 建议 / Recommendation

- **主线保留方案 (a)**：自带 Electron dist，可独立分发、不受用户机器装没装 DSH / 装在哪个盘影响。多出的 ~348 MB 是「可分发性」的合理代价。
- **(b) 仅作为开发机优化**在文档中记录并标注 *dev-only*：只有当开发机把 `dsh-ide`（或 DSH）放到与 bundle **同一卷**时才成立；跨卷时该优化直接失效，不做代码兜底。
- **(c) 不作为默认路径**：把 bundle 迁到 `C:` 会改变部署形态，仅在对体积极敏感且有同卷条件的特殊场景评估。

---

## 2. 裁剪策略 (Phase 1.3 / 5.3) / Trimming Strategy

目标：在**不牺牲功能**的前提下压缩 `runtime/`。分两个层面独立裁剪。

### 2.1 Electron 层：按平台裁剪 / Trim by Platform

- 只需要 **`win32-x64`** 一份，不把一个 Electron 安装里的多平台产物都塞进来。
- 保留必需项：`DeepSeek Harness.exe`、`*.dll`（`d3dcompiler_47`、`dxcompiler`、`dxil`、`ffmpeg`、`vk_swiftshader`、`vulkan-1`）、`*.pak`（`resources.pak` 及 `chrome_100/200_percent.pak`）、`icudtl.dat`、`snapshot_blob.bin`、`v8_context_snapshot.bin`、`locales/`、`version`、许可证文件。
- 可省：`LICENSES.chromium.html`（约 20 MB，纯文本许可证）、安装器残留（`Uninstall *.exe`、`7zip-installer-*`）。构建脚本 `ELECTRON_SKIP` 已在跳过 `resources`、`Uninstall*`、`LICENSES.chromium.html` 等。

### 2.2 app 层：按真实使用路径裁剪内置扩展 / Trim Built-in Extensions by Real Usage

**必须保留（真实使用路径）：**
- **主题类** `theme-*`（`theme-defaults`、`theme-seti`、`theme-monokai*`、`theme-solarized-*`、`theme-*` 等）——UI 外观基础，几乎不占体积。
- **语法高亮 / 语言基础**：各 `language`/`*-basics`（`javascript`、`typescript-basics`、`python`、`java`、`go`、`rust`、`cpp`、`php`、`ruby`、`csharp`、`html`、`css`、`json`、`yaml`、`xml`、`markdown-basics`、`shellscript`、`sql`、`powershell` 等），这些「basics」体积极小但提供 tokenization。
- **`dsh-bridge`**（约 19 MB）——DSH-IDE 的核心桥接扩展，必须保留。
- 运行所必需的少量框架扩展（如 `configuration-editing`、`git-base`、`emmet`、`npm` 等按需确认）。

**测试类（已在构建时跳过，无需再处理）：**
`vscode-api-tests`、`vscode-colorize-tests`、`vscode-colorize-perf-tests`、`vscode-test-resolver`、`vscode-test` —— 脚本 `SKIP_EXT` 已排除。

**重型候选（与 DSH-IDE 主使用路径关系弱，可裁剪）：**

| 扩展 | 源码体积（`vscode-1.143.1/extensions`） | 说明 |
|---|---|---|
| `mermaid-markdown-features` | ~310 MB / 23.8k files | 最大头，重度依赖 |
| `markdown-language-features` | ~259 MB / 15.2k files | Markdown 语言服务（预览/智能） |
| `github` | ~133 MB | GitHub 集成（PR/认证） |
| `microsoft-authentication` | ~132 MB | 微软账号认证栈 |
| `github-authentication` | ~102 MB | GitHub 认证 |
| `html-language-features` | ~110 MB | HTML 语言服务 |
| `json-language-features` | ~107 MB | JSON 语言服务 |
| `typescript-language-features` | ~106 MB | TS/JS 语言服务 |
| `git` | ~105 MB | Git 集成 |
| `simple-browser` | ~101 MB | 内置简易浏览器 |
| `notebook-renderers` | ~22 MB | Notebook 渲染器（若无 Notebook 需求） |

> ⚠️ 注意：上列是**源码树体积**；bundle 里因 `src/test/.map/.ts` 等已被剥离，实测体积明显更小（见第 3 节，例如 `mermaid-markdown-features` 在 bundle 中约 179 MB）。裁剪决策请以 bundle 实测为准。

**两档建议 / Two Tiers：**

- **保守档（推荐先做）**：只删「明显不相关且几乎无语言能力损失」的项——`simple-browser`、`notebook-renderers`、`github`/`github-authentication`/`microsoft-authentication`、`mermaid-markdown-features`（若不需要 Mermaid 预览）。保留全部语言服务（`html/json/typescript/markdown-language-features`）与 `git`。
- **激进档**：在保守档基础上再删 `markdown-language-features`、`html/json/typescript-language-features`、`git` 等重型扩展。
  **风险**：会丢失对应的**语言特性**（智能补全、诊断、格式化、Markdown 预览、Git 集成面板等），可能触发启动时扩展缺失告警或功能回归。**必须**通过第 4 节验证，且默认**不建议**在生产发布中采用激进档。

### 2.3 生产依赖闭包 / Production Dependency Closure

- **用 `npm ls --omit=dev --all --parseable` 生成完整闭包，绝不手写包列表**（手写必然漏包，如 `@vscode/policy-watcher`）。
- 构建脚本 `prodDepPaths()` 即按此方式解析 relative 路径、去重（祖先已包含则跳过）、逐项 `cpSync`；`npm ls` 因 peer 警告非零退出时仍从 `stdout` 解析（忽略告警、保留完整闭包）。
- 当前闭包约 **201 个顶层包**（含嵌套）。

---

## 3. 体积实测基线 / Measured Size Baseline

> 测量方法：PowerShell `Get-ChildItem -Recurse -File | Measure-Object Length -Sum`，**只针对指定子目录**，不对整树做 `du`。
> 位置：`E:\vscode-dsh\dsh-vscode-workbench\runtime\electron\`（Electron 布局：`runtime/electron/` = dist，`runtime/electron/resources/app/` = 我们的 app）。

### 3.1 顶层分解 / Top-level Breakdown

| 组成 | 体积 | 文件数 | 说明 |
|---|---:|---:|---|
| **runtime 总计** | **1793.41 MB** | **55,275** | 与已知基线一致 |
| Electron dist（`runtime/electron/` 去掉 `resources/app`） | **348.11 MB** | 71 | exe 246 MB + dll/pak/dat |
| app 合计（`resources/app/`） | **1445.30 MB** | 55,204 | 见下表 |

### 3.2 app 子项 / app Sub-directories

| 子项 | 体积 | 文件数 |
|---|---:|---:|
| `resources/app/node_modules`（生产依赖闭包） | **754.74 MB** | 11,584 |
| `resources/app/extensions`（内置扩展） | **549.94 MB** | 35,716 |
| `resources/app/out`（编译产物，已剥测试） | **129.93 MB** | 7,783 |
| `resources/app/resources` | **10.66 MB** | 119 |
| `package.json` + `product.json`（根文件） | ~24 KB | 2 |

> 交叉校验：`out` + `node_modules` + `extensions` + `resources` ≈ 1445.27 MB ≈ app 合计 1445.30 MB ✅；app + dist = 1445.30 + 348.11 = 1793.41 MB ✅。

### 3.3 extensions 体积 Top（bundle 实测，前 15）

| 扩展 | 体积 | 文件数 |
|---|---:|---:|
| `mermaid-markdown-features` | 178.81 MB | 14,655 |
| `markdown-language-features` | 89.43 MB | 9,001 |
| `microsoft-authentication` | 42.77 MB | 1,037 |
| `node_modules`（extensions 内嵌套 shared） | 30.34 MB | 568 |
| `github` | 21.37 MB | 908 |
| `html-language-features` | 19.66 MB | 900 |
| `dsh-bridge` | 19.01 MB | 43 |
| `typescript-language-features` | 17.49 MB | 705 |
| `json-language-features` | 16.96 MB | 850 |
| `git` | 16.42 MB | 620 |
| `github-authentication` | 15.43 MB | 667 |
| `simple-browser` | 15.31 MB | 915 |
| `media-preview` | 14.26 MB | 434 |
| `merge-conflict` | 14.22 MB | 417 |
| `notebook-renderers` | 12.77 MB | 1,551 |

> 前 15 项合计 ≈ 526 MB，占 extensions 的约 96%；尾部几十个 `theme-*` 与语言基础扩展合计通常 < 2 MB，裁剪价值极低、保留成本极低。
> 复测命令（仅测指定子目录，别对整树 `du`）：
> ```powershell
> $ext='E:\vscode-dsh\dsh-vscode-workbench\runtime\electron\resources\app\extensions'
> Get-ChildItem $ext -Directory | ForEach-Object {
>   $m = Get-ChildItem $_.FullName -Recurse -File -EA SilentlyContinue | Measure-Object Length -Sum
>   [pscustomobject]@{ Name=$_.Name; MB=[math]::Round($m.Sum/1MB,2); Files=$m.Count }
> } | Sort-Object MB -Descending | Format-Table -AutoSize
> ```

---

## 4. 验证约束 / Verification Constraints

**任何裁剪后，体积变小不能以功能回归为代价。** 必须全部通过以下四关，才算裁剪有效：

1. **冒烟启动 / Smoke Launch**：能正常拉起 IDE 窗口（`<exe> resources/app --folder-uri=... --user-data-dir=... --extensions-dir=... --reuse-window`），无崩溃、无「Cannot find module」。
2. **无扩展报错 / No Extension Errors**：扩展宿主日志中无 `Activating extension failed` / `Cannot find module` / 缺失依赖告警。裁掉的扩展若被其它扩展或配置引用，必须同步处理。
3. **账号连通 / Account Connectivity**：DSH 账号 / 认证链路可正常登录、连通（裁剪 `microsoft-authentication` / `github-authentication` 等需重点回归此项）。
4. **Chat 可用 / Chat Functional**：DSH Chat 面板可正常使用（`dsh-bridge` 与 `dsh.hostBaseUrl` 配置均生效）。

> 建议：每次裁剪跑一遍这四项回归，通过后再记录新的体积基线；激进档尤其要做「语言特性」回归（补全/诊断/格式化/预览）。
> 若某一项失败，回滚对应扩展，体积收益让位于功能正确性。

---

## 5. `ELECTRON_RUN_AS_NODE` 陷阱 / The ELECTRON_RUN_AS_NODE Trap

**必须 `delete`，不能赋 `undefined`。**

- Electron 会检查该环境变量的**存在性**，而非其值；把它设成 `undefined` 仍等于「存在」，Electron 会以**纯 Node 模式**运行，导致以 `Cannot find module <argv0>` 崩溃——起不来 IDE 窗口。
- 正确写法（见 `index.js` 启动逻辑）：
  ```js
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;      // 关键：delete，不是 = undefined
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  delete env.ELECTRON_ENABLE_LOGGING;
  env.VSCODE_DEV = '1';
  ```
- **两种模式都要验证**：无论是「复用 DSH Electron（方案 b/c）」还是「自带 Electron dist（方案 a）」，启动前都必须确认 `ELECTRON_RUN_AS_NODE` 已被删除。DSH 主进程本身以 `ELECTRON_RUN_AS_NODE` 方式运行时该变量会存在于 `process.env`，容易被 `{ ...process.env }` 继承，故每次 `spawn` 前统一 `delete`。
- 配套要点（同段启动逻辑，供交叉核对）：`appPath = <exe>/resources/app`；`VSCODE_DEV=1` 让主进程 `parseMainProcessArgv` 把首个非选项参数当 app 路径剥离；目录用 `--folder-uri`（而非位置参数）；`--reuse-window` 保证单实例下把同一窗口切到新目录。

---

## 附：关键事实清单 / Key Facts

- DSH Desktop 安装：`C:\Users\guyu\AppData\Local\Programs\DeepSeek Harness`（Electron 44.7.0）；`resources/` 有 `app.asar`（182 MB）**无** `app/` ⇒ 其 exe 永远加载 DSH 外壳。
- DSH 在 `C:`（NVMe），repo/bundle 在 `E:`（HDD）⇒ 跨卷硬链接**不可能**（实测 `C:→C:` 成功、`C:→E:` 失败）。
- bundle 的 exe 与 DSH exe **字节一致**（SHA256 `FD7D298F...4C0C`）。
- 构建脚本 `scripts/build-runtime.mjs` 收集：`out/`（剥测试）、`resources/`、全部内置扩展（含各自 `node_modules`、剥 dev 产物、保留符号链接）、根生产依赖闭包（`npm ls --omit=dev --all --parseable` → ~201 顶层包）、Electron dist（`--electron-from`）。
- 当前 runtime 基线：1793.41 MB / 55,275 files = app 1445.30 MB + Electron dist 348.11 MB。
