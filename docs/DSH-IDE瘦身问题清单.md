# DSH-IDE 瘦身与 Bug 问题清单（全轮次）

> 本文件汇总第 1–11 轮每轮「改动前」的问题清单（位置 + 类型 + 判定依据 + 风险 + 推荐方案）。
> 按开发手册要求「每轮先扫描产出清单，确认后再改」；自第 4 轮起按用户约定「写出问题与推荐方法后按推荐方法继续，不提问」。
> 各轮的「基线 / 统计 / 门禁值」是**当时**的快照，不代表当前状态；当前状态以 `docs/DSH-IDE瘦身报告.md` 末轮为准。
> 原按轮拆分的 8 份清单已合并入本文件，不再单独保留。

---

## 第 1 轮：137 条类型错误 + 首轮全量清理

> 编制时间：2026-11-17 18:45（Asia/Shanghai）
> 依据：`docs/DSH-IDE改造开发手册.md` §9.11、AGENTS.md、当前工作区实测。
> 本轮只做扫描，不改代码；所有删除项均给出「位置 / 类型 / 判定依据 / 风险」。
> 判定证据方法：`git grep` 全仓（含 js/mjs/json/md 与字符串字面量）+ 9,222 个 TS/JS 文件的 import 说明符扫描 + gulp staging 清单核对 + 空目录枚举。

### 0. 实测基线

| 项 | 当前值 | 证据 |
|---|---|---|
| 全量 tsc 错误 | **6 条**（手册记录起点 137 条） | `node --max-old-space-size=8192 node_modules/typescript/bin/tsc --project ./src/tsconfig.json --noEmit --skipLibCheck`，输出存 `.build/tsc-current.txt` |
| `npm run test-dsh:all` | **PASS**（mocha 7 + node 389） | 本轮实跑，exit 0 |
| 修改过的 DSH 协议测试 | **PASS**（80 项） | `dshIdeProtocol/dshIdeChannel/dshIdeEndpoints` 三文件实跑 |
| 工作区未提交改动 | **35 个已跟踪文件，+85 / -175** | `git status --short`、`git diff --shortstat` |
| 依赖规模 | dependencies 68、devDependencies 100 | `package.json` |
| 锁文件 | 1,166 个包名，其中 **162 个存在多版本**（glob 6 版、commander 6 版、minimatch 5 版…） | `node` 解析 `package-lock.json` |

**判断：** 工作区里已存在一批评审前的 §9.11 类型修复（137→6），但尚未提交；其中 `chatWidget.ts`、`gettingStartedService.ts`、`terminalService.ts` 等属于「删死代码」而非纯类型对齐，提交时必须与功能/类型改动分开。

### A. 未提交改动盘点（必须先定性再提交）

| # | 范围 | 文件数 | 性质 | 风险/备注 |
|---|---|---|---|---|
| A1 | `agentHostChatInputPicker.ts` 把未定义的 `CODEX_APPROVALS_LEARN_MORE_URL` 回退到 `PERMISSIONS_LEARN_MORE_URL` | 1 | **功能修复**（原符号不存在，运行到即 ReferenceError） | 低；单独提交 |
| A2 | `agentHostCustomizationService.ts` 补 `IAgentHostMcpServer` 结构、`sessionTargetPickerActionItem.ts` 类型名笔误、`aiCustomizationManagementEditor.ts` 断言、`web.main.ts`/`desktop.main.ts` 构造参数、`tunnelProxy.ts` 断言、6 个测试 mock 签名 | 11 | **类型对齐，不改运行时** | 低 |
| A3 | 仅删除未使用 import/字段/函数的 18 个文件（`chatWidget.ts` 含 `_getGenerateInstructionsMessage` 整组、`gettingStartedService.ts` 含两个媒体路径函数、`terminalService.ts` 等） | 18 | **清理改动（死代码）** | 低；但见 G1 的测试残留 |
| A4 | 3 个 DSH 协议测试的 wireRevision 5→4、method 42→43 | 3 | **测试对齐**（HEAD `ce668543` 改了契约但漏改测试） | 低；不修则测试必挂 |
| A5 | `AGENTS.md` 源码参考由本机 `E:/deepseek-harness/` 改为在线 GitHub | 1 | 文档 | 无 |

> 结论：A1 单独一个提交；A2 一个提交；A3 一个清理提交；A4 一个测试提交；A5 一个文档提交。这样满足「功能改动与清理改动分开提交」。

### B. 剩余 6 条 tsc 错误（手册 §9.11 第四/五类）

| # | 位置 | 类型 | 判定依据 | 建议与风险 |
|---|---|---|---|---|
| B1 | `src/vs/platform/environment/node/argv.ts:50,14` | TS2741：`OPTIONS` 缺 `agents` 项 | `NativeParsedArgs` 有 `agents?: boolean`（`common/argv.ts:57`），但 `OPTIONS` 没有对应项——接口与解析表已经不一致 | 手册要求删字段。**但** `--agents` 仍有 4 个生产方：`build/lib/policies/exportPolicyData.ts:76`、`.vscode/launch.json:323`、`.vscode/tasks.json:565`、`src/vs/platform/workspaces/electron-main/workspacesHistoryMainService.ts:406`，且全仓无读取点。删字段=保持现状（该参数目前就被当 unknown option），低风险；若改补 `OPTIONS` 项反而让参数「变成合法」，是行为变化。**建议按手册删字段** |
| B2 | `src/vs/platform/tunnel/node/tunnelProxy.ts:203,3` | TS2322：`createConnection` 返回 void 与 Node 类型不符 | Node 在 `oncreate` 回调模式允许返回 undefined；实现只走回调 | 按手册加 `as typeof agent.createConnection`（纯类型断言，不改运行时），低风险 |
| B3 | `src/vs/workbench/browser/web.main.ts:488,79`；`src/vs/workbench/electron-browser/desktop.main.ts:335,79` | TS2554：`WorkspaceTrustEnablementService` 期望 0 参，实传 2 参 | 类构造器已是 0 参（`src/vs/workbench/services/workspaces/common/workspaceTrust.ts:71-79`） | 删两个实参，低风险 |
| B4 | `src/vs/workbench/api/test/browser/extHostNotebookStatusCommands.test.ts:37,22` | TS7022：`converter` 自引用推断为 any | `override readonly converter = new CommandsConverter(this, ...)` | 给 `converter` 显式类型、`this as ExtHostCommands` 打破推断环，测试专用，低风险 |
| B5 | `src/vs/workbench/contrib/chat/test/browser/accessibility/chatAccessibilityHelp.test.ts:31,189` | TS2554：期望 3-12 参，实传 13 | 多出的 `undefined` 使 `sessionWorkingSetEnabled` 错位；删掉第 11 个 `undefined` 后正好 12 参且语义正确 | 低风险 |
| B6 | `src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts` 相关测试 | 见 G1 | 运行时测试残留，不是 tsc | 见 G1 |

### C. 无争议删除候选（低风险，建议本轮执行）

| # | 位置 | 类型 | 判定依据（无引用证明） | 风险 | 预计删除 |
|---|---|---|---|---|---|
| C1 | `src/vs/platform/dshClient/common/dshIdeLocationIndex.js` | 死模块 | `indexLocations` 全仓只有定义本身；唯一另一处是 `build/gulpfile.vscode.ts:670` 的 staging 清单，无任何 import；`491d92f0` 改为 typed 状态层后已无消费者 | 低；删时同步删 gulp 行并重建 | 3,101 B |
| C2 | `src/vs/workbench/contrib/dsh/browser/media/dshModelMenu.css` | 废弃资源 | `dshModelMenu.ts` 已在 `23c12f80` 删除；全仓无 CSS import、无路径引用，仅 `dshTeamCommands.ts:9` 注释提及 | 低 | 5,046 B |
| C3 | `src/vs/workbench/contrib/dsh/browser/dshChatModelDriver.ts` | 空壳/死代码 | 7 行、548 B，只有版权头与「不再注册」注释；无 import；`build/lib/dsh/verify/dshIdeVerify.mjs:194` 仍把它列入边界扫描（需先改清单，否则 read 抛错）；`dshBundleStaging.test.ts:139` 反向断言仍可保留 | 低；先改 verify 清单再删 | 548 B |
| C4 | 空目录 5 个：`src/vs/platform/dshClient/browser`、`src/vs/workbench/contrib/dsh/host`、`src/vs/workbench/contrib/dsh/browser/chatClient`、`src/vs/workbench/contrib/dsh/test/browser/chatClient`、`src/vs/workbench/contrib/chat/electron-browser/agentSessions/media` | 空资源 | 逐目录 `Get-ChildItem -Force` 计数均为 0 | 无（git 不跟踪目录） | 0 B |
| C5 | `package.json` 5 个死脚本：`verify:dsh-guard-negative`（目标缺失）、`test-agent-host-e2e`、`test-agent-host-e2e-coverage`（`test/integration/agentHost` 不存在）、`codex:gen-protocol`、`codex:check-protocol`（`build/codex` 不存在） | 冗余配置 | 目标文件/目录均 `Test-Path=False`，`git ls-files` 为空 | 低（这些脚本只能必然失败） | 5 行 |
| C6 | `build/npm/dirs.ts:14-15` 的 `'build/rspack'`、`'build/vite'` | 冗余配置 | 两目录已在 `edfd09bf` 删除；`postinstall.ts:231-292` 会按 dirs 逐个 `npm install`，cwd 不存在会失败 | **中**：修的是构建安装链本身 | 2 行 |
| C7 | `package.json:87` `test-dsh` 里 `out/.../chatClient/*.test.js|mjs` 两个 glob | 冗余配置 | `src/vs/workbench/contrib/dsh/{browser,test/browser}/chatClient` 都是空目录、无任何源文件 | 低 | 1 行 |
| C8 | 无引用导出：`dshIdeContract.ts:138-139`（`DSH_IDE_CONTRACT_API_VERSION/WIRE_REVISION`）、`dshChatModel.ts:285`（`AssistantBlockLike`）、`dshComposerRegistry.ts:55`（`onDidChangeDshComposerSource`，且监听集合无人订阅）、`dshSessionTree.ts:36-43`（`sessionTimingForRunning`） | 死符号 | 全仓零外部引用，文件内仅定义/注释 | 低 | ~30 行 |

### D. 重复实现（分三级，部分建议保留）

| # | 位置 | 类型 | 判定依据 | 建议 |
|---|---|---|---|---|
| D1 | `dshComposerProjection.ts:25` 与 `dshLanguageModelProvider.ts:30` 各声明 `DSH_MODEL_VENDOR = 'dsh'` | 重复常量 | 两处同值、同名、同导出；后者仅本文件用 | 合并为一个来源（从 `dshComposerProjection` 导入），低风险 |
| D2 | `isRecord` 六份：`dshIdeConversation.ts:498`、`dshIdeProjections.ts:136`、`dshIdeComposer.js:133`、`dshIdeRequestView.js:159`、`dshIdeTransport.ts:351`、`dshChatModel.ts:543` | 重复代码 | 函数体逐字相同（`typeof === 'object' && !== null && !Array.isArray`） | **建议保留**：跨 Host-side JS / electron-main / workbench 三层，抽公共模块要改 staging 与边界门禁，收益小于风险；在报告中记为「存疑保留」 |
| D3 | `stringOf`/`numberOf`：`dshIdeConversation.ts:522-528` 与 `dshChatModel.ts:692-698` | 重复代码 | 逐字相同 | 同上，跨 platform/workbench 层；建议保留或单列小任务，不在本轮 |
| D4 | 计时：`dshSessionItemState.ts:55 timingForRunning`（仅测试引用）、`dshSessionTree.ts:37 sessionTimingForRunning`（零引用）、`dshAgentSessionsController.ts:307-331` 内联实现 | 功能重复 | 三处语义相同但第三处要保留旧时间戳，不能直接替换 | 删 D4 中的 `sessionTimingForRunning`（C8）；`dshSessionItemState` 模块见 Q4 |
| D5 | `dshIdeSessionListModel` + `dshIdeSessionsService` 列表链 vs `dshAgentSessionsController` 列表链 | 功能重复 | 文档已注明：Session 面板实际走 controller；旧链只被 `dsh.contribution.ts:158 createSession()` 与搜索命令复用，不供列表 UI | **建议保留**：删旧链会改 createSession/search 行为；记入存疑保留 |

### E. 依赖（按证据分三档）

| # | 包 | 档 | 证据 | 风险 |
|---|---|---|---|---|
| E1 | `merge-options`、`os-browserify` | **确定删除** | 全仓 import 扫描 0 命中；git grep 仅 package.json/lock；属已删除的 rspack/vite 时代 polyfill | 低 |
| E2 | `@playwright/cli`、`@vscode/test-cli`、`@vscode/telemetry-extractor` | **建议删除** | 全仓 import 0 命中、git grep 除锁文件外 0 命中；对应工具/流水线已在 `edfd09bf` 删除 | 低 |
| E3 | `@vscode/component-explorer`、`@vscode/component-explorer-cli` | **待决策 Q1** | 仍被 `test/componentFixtures/*.json/.mts`、`.vscode/tasks.json:647` 引用；若删依赖必须同时删夹具与任务 | 中 |
| E4 | 根 `@hpke/core`、`libsodium-wrappers` | **待决策 Q5** | 根 `src/**`、`extensions/**` 无 import；`node_modules` 内 1,648 个包的依赖/peerDependencies 里也**没有**任何包要求它们（脚本穷举）；仅 `eslint.config.js:1790-1791` 还给它们开白名单；`remote/package.json` 也各声明一份 | 中低：纯冗余声明，但需同步改 `remote/package.json`；删后跑 `npm ls` 与 `compile` 验证 |
| E5 | 锁文件内 162 个包存在多版本（glob 6 版、commander 6 版、minimatch 5 版、node-addon-api 4 版…） | **不处理** | 全部为传递依赖；去重需要升级/覆盖版本，违反「不升级依赖」红线 | — |
| E6 | `playwright-core`：根固定 `1.61.0-alpha-2026-06-04`，`@playwright/test` 带 `1.61.1` | **报告不处理** | 两个版本并存；根版本被 `browserView` 直接使用，换版本属升级 | — |

### F. 配置 / 资源 / 注释

| # | 位置 | 类型 | 判定依据 | 建议 |
|---|---|---|---|---|
| F1 | `.vscode/tasks.json:646-667`「Component Explorer Server」 | 冗余配置 | 命令依赖已删除的 component-explorer CLI（见 E3） | 随 Q1 决策 |
| F2 | `.vscode/tasks.json:513-517`「Launch Monaco Editor Vite」、`.vscode/launch.json:359-360,704,715` 的 `build/vite` URL、`.eslint-allowed-bracket-notation-files:290` 的 `build/rspack/...` | 冗余配置 | `build/vite`、`build/rspack` 均已不存在；这些任务/启动项无法运行 | 建议删除；若用户仍用旧 Vite 调试，则保留并在报告注明 |
| F3 | `build/lib/dsh/CHAT-RENDER.md` | 过期文档 | 描述的目录 `src/vs/workbench/contrib/chat/browser/widget/chatContentParts/dsh/` 不存在；引用的 `dshChatModelDriver.ts` 是空壳；全仓无引用 | 建议删除或重写（Q3） |
| F4 | `dshIdeProtocol.ts:6`（「P3 升级到 wireRevision 2」）、`:934`（「wireRevision 保持 2」） | 过期注释 | 实际 `DSH_IDE_WIRE_REVISION = 4`（`:28`） | 改为 4，低风险 |
| F5 | `dshCapabilities.ts:8`（「Host 下发的 capabilities 快照」） | 过期注释 | `ce668543` 已改为独立 `capabilities` method，不再随快照 | 改为「独立 method 返回值」，低风险 |
| F6 | `build/gulpfile.vscode.ts:658`（「host/ 现仅 ide-service.js」） | 过期注释 | `host/` 现有 4 个文件：`electron-home.js`、`ide-launch-queue.js`、`ide-service.js`、`ide-view-host.js` | 改为「整目录 stage」，低风险 |
| F7 | 源码注释以 `E:/deepseek-harness...` 作依据，共 **8 处**（可改 7 处，另 5 处在 PROVENANCE 不得动）：`dshIdeRequestView.js:8`、`ide-view-host.js:12,1328`、`dshChatModel.ts:8`、`dshSessionTree.ts:9`、`dshIdeEndpoints.test.ts:14`、`genDshIconDataUris.mjs:12,22` | 过期引用 | AGENTS §3 已改为在线 GitHub；本机已无该目录（`genDshIconDataUris.mjs:22` 的 `sourcePath` 是硬编码本机路径，脚本在本机不可运行） | 注释/文档类改为 GitHub URL；`genDshIconDataUris.mjs` 的 `sourcePath` 是**可执行路径**，改动属功能改动，需单列确认 |
| F8 | DSH 代码内 `TODO/FIXME/XXX/HACK/debugger` | 调试残留 | 全仓扫描 0 命中 | 无需处理 |
| F9 | `src/vs/platform/dshClient/index.js:45,67` 的 `console.log` | 调试输出？ | 是 Host 端点发布/桥接成功的运行日志，非临时调试 | 保留 |
| F10 | `build/monaco/version.txt` 0 字节 | 空文件？ | `build/gulpfile.editor.ts:188-193` 会写入内容，是模板占位 | **保留** |
| F11 | `.eslint-allowed-bracket-notation-files` 447 条有效项中 **224 条指向不存在的文件**（89 条 `src/vs/platform/agentHost/**`、90 条 `extensions/copilot/**`、8 条 workbench、37 条其它已删文件），另含 `build/rspack/...` | 冗余配置 | 逐条 `Test-Path` 判定；三个来源目录在本仓均不存在（`src/vs/platform/agentHost`、`extensions/copilot` 已删除） | 建议删，但属上游文件大改；**单列一批**，风险低（只会让 ESLint 少豁免不存在的文件） |
| F12 | `.eslint-allowed-javascript-files` 157 条有效项中 **51 条指向不存在的文件**（30 条 copilot、8 条 build、13 条其它） | 冗余配置 | 同上；`build/hygiene.ts:32-59` 用它做「JS 文件必须登记」的检查，多余项不会命中 | 同上；另有 8 条指向 `build/builtin/*.js`、`build/next/devTunnelsShims/*.cjs` 等已删脚手架 |

### G. 测试与行为漂移（必须处理，避免门禁假绿）

| # | 位置 | 问题 | 判定依据 | 建议 |
|---|---|---|---|---|
| G1 | `src/vs/workbench/contrib/chat/test/browser/widget/chatWidget.test.ts:983-1038` | 仍期待 `Build with Agent` 标题与 `_getGenerateInstructionsMessage` 调用 3 次；DSH 集成后欢迎页标题已是 `Chat`、附加文案是「输入消息开始，由 DSH 处理。」，且方法已被删 | 当前 `chatWidget.ts:1749` 与 `:1659`；测试对象按原型构造，运行会失败 | 改写该测试为 DSH 文案断言，或删除该过时 case；属清理/测试改动，单独提交 |
| G2 | `build/lib/test/dshIdeProtocol.test.ts` 新测试后多一个空行 | 风格 | 文件内连续两空行 | 随手修 |
| G3 | 覆盖率 | 无 DSH 专用覆盖率脚本 | `package.json` 无 c8 的 DSH 入口；`test-dsh:all` 只统计通过数 | 以「测试项数不降」作为等价门禁；如需真实覆盖率，需另建脚本（不新增依赖，用现有 c8），请确认 |

### H. 存疑保留项（请逐项决策）

- **Q1 component-explorer 整套**：删依赖+夹具+`.vscode` 任务（约 20 个文件、2 个 devDeps），还是只删任务保留夹具？
- **Q2 `dshSessionItemState.ts` + 测试**：生产零引用、仅测试引用；删模块+测试（约 5 KB、5 个测试），还是保留作为纯函数契约？
- **Q3 `build/lib/dsh/CHAT-RENDER.md`**：删除 / 重写为当前原生渲染说明 / 保留作历史？
- **Q4 `agents` 参数**：按手册删 `NativeParsedArgs.agents`（保持现状、低风险），还是补 `OPTIONS` 项（消除类型错误但让参数变合法，行为变化）？
- **Q5 根 `@hpke/core`、`libsodium-wrappers`**：是否允许我继续做动态引用取证后删除？
- **Q6 `.vscode` 里 `build/vite` 的启动项/任务**：删除还是保留（可能有人仍用 Monaco Vite 调试）？

### I. 建议执行批次（确认后执行）

1. **批次 0（收尾在途类型修复）**：B1-B5 + A2 + A4 + A5；tsc 必须 0。分开提交：功能修复 1 个、类型对齐 1 个、测试对齐 1 个、文档 1 个。
2. **批次 1（DSH 死代码/资源）**：C1-C4、C8、F4-F6、G2；删 `dshIdeLocationIndex` 时同步改 gulp 与 verify 清单。
3. **批次 2（依赖与脚本）**：C5-C7、E1-E2（Q1/Q5 按决策追加）；`npm install` 更新锁文件，跑 `npm ls` 核对。
4. **批次 3（配置/注释/文档）**：F1-F3、F7（按 Q1/Q3 决策）。
5. **批次 4（测试漂移）**：G1。单独提交。
6. 每批后跑：全量 tsc → `test-dsh:all` → 相关 ESLint → `npm run compile`（构建）；打包按 §0.0 推迟。
7. 最终输出瘦身报告（删除清单/依赖前后/存疑保留/风险与回滚）。

### J. 假设（手册未覆盖处）

1. 「覆盖率不降」在 DSH 侧没有既有覆盖率命令，本轮以 `test-dsh:all` 的测试项数（7+389）与通过率不降作为等价证据；如要真实行覆盖率，需用现有 c8 新增脚本（不新增依赖），请确认。
2. VS Code 上游代码里的类型错误（B2-B5、G1）只做最小类型/测试对齐，不重构上游实现、不升级依赖。
3. 删除仅限 git 跟踪文件；`.build/`、`out*/` 等被 `.gitignore` 忽略的构建产物不计入「仓库瘦身」，如需清理磁盘另列。
4. `PROVENANCE.md`、`LICENSE-DSH` 四份凭据与 `NOTICE.md`、`LICENSE.txt` 一律不删不改。
5. 所有删除先在本轮提交 `chore(cleanup)` 中单独成批，回滚方式为 `git revert <cleanup-commit>`。

---

## 第 2 轮：断链脚本 / 门禁期望 / 文档漂移

> 编制时间：2026-11-17 21:20（Asia/Shanghai）
> 依据：`docs/DSH-IDE改造开发手册.md` §9.11、AGENTS.md、HEAD `36521cd0` 实测。
> 本轮只做扫描，不改代码。判定方法：`git grep` 全仓（含字符串字面量）+ 9,055 文件引用扫描 + TypeScript AST 函数体哈希 + 逐文件 `Test-Path` + 实际执行门禁取证。
> 第 1 轮已完成并提交 12 个 commit（`07f9def4`..`36521cd0`），tsc 137→0、384 测试全过、`verify:dsh-ide-ci` 五项 PASS。

### 0. 实测基线（本轮新增门槛）

| 项 | 当前值 | 证据 |
|---|---|---|
| 全量 tsc | **0 error** | 实测 |
| `test-dsh:all` | **PASS（node 384 + mocha 7）** | 实测 |
| `npm run compile` | **PASS** | 实测 `Finished 'compile' after 1.67 min` |
| `verify:dsh-ide-ci` | **PASS** | 五项聚合全 PASS（需 `DSH_INSTALLED_VERSION=0.2.2-rc.1`） |
| `verify:dsh-artifact` | **PASS**（但期望值陈旧，见 B3） | 实测：`package/common/` 实际 11 个模块，脚本期望 7 个 |
| `verify:dsh-real-p95` | **FAIL** | 实测 `ERR_MODULE_NOT_FOUND: .../ide-view-projector.ts` |
| `git status` | clean | — |
| DSH 两目录规模 | 55 文件 / 14,394 物理行（13,400 非空） | `git ls-files` + `Measure-Object` |

### A. 会直接失败 / 写错位置的脚本（最高优先级）

| # | 位置 | 类型 | 判定依据 | 风险 | 建议 |
|---|---|---|---|---|---|
| A1 | `build/lib/dsh/verify/dshRealSampleP95.mjs:104-114,125` | **断链**（引用已删模块） | 实跑 `npm run verify:dsh-real-p95` → `ERR_MODULE_NOT_FOUND: file:///E:/DSH-IDE/src/vs/platform/dshClient/common/ide-view-projector.ts`；该文件与 `translator.ts` 均已被删，且 `dshIdeVerify.mjs:168-169` 明确断言它们**不得回来**；脚本还读 `projector.ROWS_P95_BYTE_LIMIT`（该常量今已不存在） | **高**：门禁必 FAIL，且与 boundary 门禁自相矛盾 | 三选一：①删除脚本 + `verify:dsh-real-p95` script；②改为对现行 `dshIdeProjections`/`dshChatModel` 的投影做 P95；③改成读 golden 快照。**需你定**（Q1） |
| A2 | `build/dsh-ide-build-prereqs.mjs:22-26` | **路径算错**（仓库外写入） | `here=E:\DSH-IDE\build`；`VSC=dirname(here)=E:\DSH-IDE`；`ROOT=dirname(VSC)=E:\`；`STASH=E:\types-stash`。**我误跑一次已实证**：确实创建了 `E:\types-stash`（我已删除，仓库 tree 未受影响）；第 66-77 行校验中 `sinonjs__fake-timers` 必然 FAIL、退出码 1 | **高**：会往仓库外写、`cpDir` 先 `rmSync` 具破坏性 | 该脚本未被任何 package.json/README/手册引用，且其前提（`types-stash` junction）在扁平化后已不成立。建议**删除**（Q2） |
| A3 | `.vscode/tasks.json:632-654`「Serve Out (rspack)」 | **悬空任务** | `"script": "serve-out-rspack"`，该 script 已随 `edfd09bf` 删除（实测 `'serve-out-rspack' in scripts === false`） | 低（仅手动运行会报 Missing script） | 删除 |
| A4 | `.vscode/tasks.json:206-237,288-299`「Copilot - Build」「Kill Copilot - Build」 | **悬空任务**（脚本 + 目录都缺） | `watch-copilotd`/`kill-watch-copilotd` 两个 script 不存在；`extensions/copilot` 目录不存在 | 低（但 `VS Code - Build` / `Kill VS Code - Build` 依赖它们，整条构建任务链会失败） | 删除这两个任务，并从 `VS Code - Build`/`Kill VS Code - Build` 的 `dependsOn` 里移除 |
| A5 | `.vscode/launch.json` 5 个启动项引用不存在目录 | **悬空启动项** | `extensions/copilot` → 「Attach to Extension Host」；`extensions/github` → 「VS Code Github Tests」；`extensions/vscode-api-tests` → 「VS Code API Tests (single folder)」「VS Code API Tests (workspace)」；`extensions/vscode-colorize-tests` → 「VS Code Tokenizer Tests」；`extensions/vscode-colorize-perf-tests` → 「VS Code Tokenizer Performance Tests」；五个目录均 `Test-Path=False` | 低（点击才失败） | 建议逐项确认后删（Q3） |
| A6 | `scripts/sync-upstream.mjs:77` | **静默失效** | 读 `ROOT/vscode-1.143.1/build/lib/dsh/PROVENANCE.md`，该路径不存在，异常被 `try/catch` 吞掉 → `readVendoredVersion()` 返回 undefined → `base` 回退为最新 tag，与默认 `target` 相同 → 报告**恒为 SAME**。另 `:78` 的正则也匹配不了当前 `PROVENANCE.md:19` 的「`0.2.2-rc.1`（根 package.json…）」格式 | **中**：升级工具给出假阴性 | 改路径为 `build/lib/dsh/PROVENANCE.md` + 改正则 + 改 4 处 `vscode-1.143.1/` 文案（Q4） |

### B. 门禁期望值陈旧（不会报错，但检查的已不是真相）

| # | 位置 | 问题 | 证据 | 建议 |
|---|---|---|---|---|
| B1 | `build/lib/dsh/verify/dshArtifactContents.mjs:43-51` | `EXPECTED_COMMON` 只列 7 个模块 | 实测 `tar -tzf dist/dsh-ide-2.0.0.tgz` 有 **11 个** `package/common/` 成员（多出 `dshIdeComposer.js`、`dshIdeWaterfallNotice.js`、`dshIdeRequestView.js`、`dshIdeLocationIndex.js`（该文件本次已删，需重新打包后才会消失） | 把 `EXPECTED_COMMON` 补齐到与 `gulpfile.vscode.ts:662-671` 的 10 项一致；顺便把 `dshIdeLocationIndex.js` 从产物里验证消失 |
| B2 | `build/lib/dsh/verify/dshIdeVerify.mjs:269` | `contract` 门禁要求导出 `upstreamDrift` 等 5 个符号 | 这些符号在 `src/**` 里 0 引用（只被门禁按名字断言） | **不动**：门禁就是消费者，删了门禁会 FAIL。记入存疑保留 |
| B3 | `build/lib/dsh/verify/dshIdeVerify.mjs:97` | 断言 `contract` 必须 `import './dshIdeProtocol.js'` | 同上 | 不动 |

### C. 文档与注释漂移（会误导后续开发）

| # | 位置 | 内容 | 判定依据 | 建议 |
|---|---|---|---|---|
| C1 | `docs/DSH-IDE改造开发手册.md:145,238,265,367` | 「42 个 method」 | 实测 `DSH_IDE_METHOD_KEYS` = **43**（含 `capabilities`）；`dshIdeProtocol.test.ts:85-86`、`dshIdeEndpoints.test.ts:104,212` 也都断言 43 | 改为 43（4 处） |
| C2 | `docs/DSH-IDE改造开发手册.md:350,385` | 「36 个 `DshIdeMethodArgs`」「36 个 `ide/dispatch` method，32 可用 + 4 禁用」 | 实测 43（39 可用 + 4 禁用） | 改为 43 / 39+4 |
| C3 | `docs/DSH-IDE改造开发手册.md:799` | `dshSessionItemState.ts:14,24-34,42-52,55-64` 行号引用 | 该文件已在 `ece6e68c` 删除 | 标注为历史，或改为指向 controller 内联实现 |
| C4 | `docs/DSH-IDE改造开发手册.md:936` | 「删除 89 个文件 / 减 4,620 行」 | 实测 `git diff --shortstat ce668543..980bcf5b` = `89 files changed, 156 insertions(+), 4620 deletions(-)`；其中 **D=26、M=63、A=0**。注：`980bcf5b` 不是第 1 轮终点，完整区间 `ce668543..36521cd0` 为 **92 files / +456 / -4,621**（D=26、M=64、A=2） | 改为「92 个文件（26 删除 / 64 修改 / 2 新增），+456 / -4,621 行」 |
| C5 | `README.md:86` | 「DSH 集成层（Agent、输入框数据源、模型菜单）」 | `dshModelMenu.ts` 已删，模型/effort 走原生选择器 | 改为「Agent、输入框数据源、会话树」 |
| C6 | `README.md:90` | 「`build/dsh/chat-render/` 聊天渲染 sidecar 及其来源凭据」 | 目录只剩 `PROVENANCE.md` + `LICENSE-DSH`，sidecar 链已删 | 改为「聊天渲染复用件的历史来源凭据（只读，不随构建）」 |
| C7 | `build/gulpfile.vscode.ts:546,676`；`build/next/index.ts:405`；`build/lib/dshBuildProvenance.ts:21` | 4 处注释称「DSH 帧由 `DshChatModelDriver` 直接写进原生 ChatModel」 | 该类已在 `ece6e68c` 删除；实际走 `IChatSessionContentProvider.history`（`dshChatSessionContent.ts`） | 改为「由 `dshChatSessionContent` 的 content provider 提供历史」 |
| C8 | `src/vs/workbench/contrib/dsh/browser/dshTeamCommands.ts:9` | 「此前唯一画它的 `dshModelMenu.ts` 从未被实例化」 | 模块已删，本句是唯一残留提及 | 改为「原生选择器不提供团队开关」 |
| C9 | `src/vs/workbench/contrib/dsh/browser/dshAgentSessionsController.ts:140` | 「这是 `dshComposerProjection` 里 `toPermissionItems` / `observeModes` 的生产入口」 | `observeModes` 零引用、且将被删（见 D1） | 随 D1 一起改 |
| C10 | `.eslint-ignore:65-67,72` | 注释称 `.tsx leaves are bundled by build/dsh/chat-render/build-render.mjs`；`build/dsh/chat-render/src/**` 忽略项 | 该脚本与 `src/` 目录均已删（只剩两个凭据文件） | 删 3 行注释 + 1 行忽略项 |
| C11 | `build/tsconfig.json:25` | `"vite/**"` exclude | `build/vite` 已删 | 删该行 |
| C12 | `.vscode/tasks.json:27` | 「Install dependencies and watch all of VS Code (core, extensions and copilot)」 | `extensions/copilot` 不存在 | 去掉「and copilot」 |
| C13 | `build/dsh-ide-build-prereqs.mjs:7-14,22-23,78` 的旧路径注释 | 若 A2 决定删除，则一并消失 | — | 随 A2 |

### D. 零引用代码（新增，第 1 轮未覆盖）

| # | 位置 | 类型 | 判定依据 | 风险 | 预计删除 |
|---|---|---|---|---|---|
| D1 | `src/vs/workbench/contrib/dsh/browser/dshComposerProjection.ts:64-105`：`toChatMode` + `observeModes` + `modesOf` | 死代码链 | 三者全仓零调用；唯一出现是 `dshAgentSessionsController.ts:140` 的注释。连带 10 个 import（`constObservable`/`observableValue`/`IObservable`/`ThemeIcon`/`Codicon`/`URI`/`IChatMode`/`IChatModeInstructions`/`ChatModeKind`/`Target`）全部变为未使用（已用 AST 校验余下代码对这些标识符的出现次数均为 0） | 低（预设选项实际由 `dshAgentSessionsController.getNewChatSessionInputState()` 直接构造 `IChatSessionProviderOptionGroup`，不走 `IChatMode`） | **≈47 行代码 + 10 行 import** |
| D2 | `src/vs/workbench/contrib/dsh/browser/dshChatSession.ts:511-518` `noteRunning()` | 死方法 | 全仓零调用（`_running` 仍由 420/424 行的流式路径维护） | 低 | 8 行 |
| D3 | `src/vs/workbench/contrib/dsh/browser/dshChatSession.ts:149-151` `pendingItemsView()` + `:104` `_pendingView` + `:189`、`:245` 两处赋值 | 死字段链 | `pendingItemsView()` 零调用；typed pending 由 `pending()`/`onDidChangePending` 提供；`_pendingView` 仅被这三处读写 | 低 | 净 ≈4 行 |
| D4 | `src/vs/workbench/contrib/dsh/browser/dshChatSession.ts:226-228` `boundId()` | 死 getter | 零调用（外部只用 `boundSessionId` 字段本身） | 低 | 3 行 |
| D5 | `src/vs/platform/dshClient/common/dshIdeProtocol.ts:154-158` `DshIdeImageAttachmentValue` | 零引用导出 | 全仓仅定义 1 次，无任何 import/引用 | **零** | 4 行 |
| D6 | `src/vs/workbench/contrib/dsh/browser/dshComposerProjection.ts:25` 与 `dshLanguageModelProvider.ts:30` 的 `DSH_MODEL_VENDOR` | 重复常量 | 同名同值双份 export；后者仅本文件 4 处使用 | 低 | 1 行（改为从 projection 导入） |

### E. 重复实现（复核后仍建议保留）

| # | 位置 | 结论 |
|---|---|---|
| E1 | `isRecord` **6 份**（`dshIdeComposer.js:133`、`dshIdeConversation.ts:498`、`dshIdeProjections.ts:136`、`dshIdeRequestView.js:159`、`dshIdeTransport.ts:351`、`dshChatModel.ts:540`） | **保留**：跨 Host 纯 JS / transport / workbench 三层，抽取需改 gulp staging 与 boundary 门禁；函数体仅 1 行 |
| E2 | `stringOf`/`nonEmpty` **3 份**、`numberOf` **2 份** | **保留**：同上，收益 <10 行 |
| E3 | `refresh()` 的 `finally(() => { this.loading = undefined; })` 2 处（`dshComposerSource.ts:218`、`dshLanguageModelProvider.ts:87`） | **保留**：2 行，抽公共函数无意义 |
| E4 | `dshIdeContract.ts` 的 `UPSTREAM_VALIDATED_VERSION` 与 `dshIdeProtocol.ts` 的 `DSH_IDE_API_VERSION` 同值 | **保留**：`dshIdeProtocol.test.ts:337-343` 显式断言两者相等，是「契约跟随协议」的双点校验 |
| E5 | 协议错误码与 `ide-view-host.js` 的 4 个同名常量 | **保留**：Host 半身是纯 JS，注释明示不跨层 import，属有意复制 |
| E6 | `DSH_IDE_DELETE_SESSION_PLUGIN` / `_VERSION` / `_ENDPOINT` | **保留**：`dshIdeProtocol.test.ts:331-334` 按值断言，删了测试挂 |

### F. 依赖复核（本轮新增）

| # | 检查 | 结果 |
|---|---|---|
| F1 | 全仓 9,055 文件扫 159 个依赖名 | **「从未出现」的依赖：0 个**（第 1 轮已删干净） |
| F2 | `node_modules` 里 `@hpke/core`、`libsodium-wrappers` 等 9 个已删包 | 仍存在但 `npm ls` 标为 **extraneous**（磁盘残留，不影响仓库）；如需回收可 `npm prune` |
| F3 | 锁文件 | 1,536 条目，与 `package.json` 一致（`npm install --package-lock-only` 后零新增零版本变更） |

### G. 存疑保留（请确认）

- **R1** `dshIdeContract.ts` 的 5 个导出（`UPSTREAM_VALIDATED_VERSION`/`BLESSED_PACKAGES`/`VSCODE_PATCH_POINTS`/`installedMeetsVersion`/`upstreamDrift`）在 `src/**` 零引用，但 `verify:dsh-ide-contract` + `protocol-single-source` 按名字/正则断言它们存在。**保留**，否则门禁 FAIL。
- **R2** `dshIdeContract.ts` 文件本身全仓 0 import，只被门禁当文本读。**保留**（门禁的检查对象）。
- **R3** `dshChatModel.ts` 里 22 个 `Dsh*Block`/`Dsh*Node` 类型只在本文件自用，但它们是 `DshChatNode` 联合类型的成员，**不能删**（删了联合类型不全）。
- **R4** `.eslint-ignore` 的 `src/vs/base/common/lit-html/**`、`signals-core/**` 两个目录不存在（`Test-Path=False`）。属上游 vendored 声明，删了可能影响未来 vendoring；建议保留并记入报告。
- **R5** `build/dsh/chat-render/` 只剩 `PROVENANCE.md` + `LICENSE-DSH`。AGENTS §5 明确四份凭据「一律保留且不得删改」，**保留**。

### H. 建议执行批次

1. **批次 A（断链修复，必须）**：A1（P95 脚本，按 Q1 决策）、A2（prereqs 脚本，按 Q2 决策）、A3（rspack 任务）、A4（Copilot 任务链）、A6（sync-upstream 路径）。A5 按 Q3。
2. **批次 B（死代码）**：D1-D6。每项先跑 `tsc` + `test-dsh:all`；D1 需同步改 `dshAgentSessionsController.ts:140` 注释。
3. **批次 C（文档/注释）**：C1-C12。纯文本，一次提交。
4. **批次 D（门禁期望值）**：B1（`EXPECTED_COMMON` 补齐 10 项）。改完需重新 `gulp dsh-ide-pack` 才能验证产物；本轮只改脚本，标注 PENDING。
5. 每批后：全量 tsc → `test-dsh:all` → `npm run compile` → `verify:dsh-ide-ci`；A 批另跑 `verify:dsh-real-p95`（修好后应 PASS）。

### I. 本轮新增假设

1. **A1 的处置需要你决定**：`verify:dsh-real-p95` 检查的 `ide-view-projector.ts`/`translator.ts` 已被 `9b1bca6f` 删除，且 boundary 门禁反向要求它们不得存在。我倾向于**删除该脚本与 script**，因为它的测量对象（TUI 投影器）已不在架构里；若你要保留「真实样本 P95」这项能力，需重新定义测量对象（我可以按现行 `dshIdeProjections` 重写）。
2. **A2 的处置需要你决定**：该脚本声称修 `types-stash` junction，但实测当前 `node_modules/@types/node` 等已是实体目录、并不指向 `types-stash`，其前提不成立且未被任何文档引用。我倾向于**删除**。
3. **A5 的 5 个启动项**：它们指向的扩展（copilot/github/vscode-api-tests/colorize-tests）在 `edfd09bf` 之前的某次裁剪中被移除；删除启动项不会影响 VS Code 上游功能，但会让你失去「调试这些扩展」的入口（反正也调试不了）。建议删。
4. 本轮不改任何 `PROVENANCE.md`/`LICENSE-DSH`/`NOTICE.md`/`LICENSE.txt`。
5. 本轮不做依赖变更（F1 已证明无零引用依赖）。

---

## 第 3 轮：复检（DSH 自有代码已无可删死代码）

> 编制时间：2026-11-17 21:55（Asia/Shanghai）
> 依据：HEAD `ad638615` 实测。本轮只做扫描，不改代码。
> 前两轮共 17 个提交：`07f9def4`..`ad638615`，tsc 137→0，`test-dsh:all` 384 全过，`verify:dsh-ide-ci` 五项 PASS。

### 0. 基线

| 项 | 值 |
|---|---|
| tsc | 0 error |
| test-dsh:all | 384 + mocha 7，全 PASS |
| DSH 两目录 | 55 文件 / 34 TS / 15 JS / 4 MJS / 1 SVG / 1 MD |
| 依赖 | deps 66 / devDeps 93 / scripts 80 |
| 依赖零引用扫描（9,053 文件 × 159 包） | **0 个** |
| 死导出扫描（273 个导出） | **0 个** |
| 空文件（DSH 两目录） | 0 |
| 空目录（全仓，排除 node_modules/out/.build） | **1**：`src/vs/workbench/contrib/dsh/test/browser` |

### A. 现状：已无可删的死代码/死导出

第 1、2 轮已把 DSH 两目录里的零引用模块、零调用导出、零调用成员清完。本轮复扫：
- 零引用导出：**0**
- 零引用模块：只有 4 个测试入口（`electronHome.test.mjs`、`ideLaunchQueue.test.mjs`、`ideViewHost.test.mjs`、`packaging.test.mjs`），它们由 `package.json` 的 `test-dsh`/`test-dsh:all` 直接指定，**不是孤儿**。
- `TODO/FIXME/XXX/HACK/debugger`：**0**
- DSH 两目录 0 字节文件：**0**

### B. 剩余可删项（3 项，需确认）

| # | 位置 | 类型 | 判定依据 | 风险 | 建议 |
|---|---|---|---|---|---|
| B1 | 空目录 `src/vs/workbench/contrib/dsh/test/browser` | 空资源 | `Get-ChildItem -Force -Recurse` 计数 0；`git ls-files src/vs/workbench/contrib/dsh/test` 为空 | 无（git 不跟踪目录） | 删除 |
| B2 | `.eslint-ignore:5-21` 共 **17 条** `**/extensions/copilot/**` 忽略项 | 冗余配置 | `extensions/copilot` 目录已不存在（`Test-Path=False`），这些 glob 永不命中；`.eslint-allowed-*-files` 里的 copilot 条目已在第 1 轮清完 | 低 | 删除 |
| B3 | `build/filters.ts:223-224`、`:246-247` 两处 `// extensions/copilot has its own code style` + `'!extensions/copilot/**'` | 冗余配置 | 同上；这两处在 `exclude` 数组里，指向不存在的目录 | 低 | 删除 |

### C. 文档历史段落（不建议改，供确认）

第 2 轮已修完**现状性**声明（method 数、test 数、REPORT 统计）。剩余提及已删文件的地方全部位于**明确标注为历史记录**的段落：

| 位置 | 内容 | 判定 |
|---|---|---|
| `docs/DSH-IDE改造开发手册.md:549,639,686,840,844,887` | `dshSessionItemState` 的历史阶段记录（「新增」「联跑 PASS 37 项」「产物含 withArchived」等） | 历史记录，**保留** |
| `docs/DSH-IDE改造开发手册.md:558,578` | 「不恢复 `dshChatModelDriver`」的决策记录 | 决策记录，**保留** |
| `docs/DSH-IDE改造开发手册.md:295,469` | 「`dshModelMenu.ts` 已删除」「死代码清理列表」 | 均已注明删除，**保留** |
| `docs/DSH-IDE内容接收与ChatSession面板架构分析.md`（6 处） | 分析文档写于 2026-11-16，引用当时的 `dshChatModelDriver.ts`/`dshModelMenu.ts` 行号 | 历史分析快照，**保留**（若改会破坏「当时结论」的可追溯性） |
| `docs/DSH-IDE承接DSH桌面端聊天页面的路线草稿.md:134` | 「`dshSessionItemState.ts`：会话行的归档/已读状态工具」 | 路线草稿，**保留** |

> 需要你确认：是否要把这些**历史文档**也标注「文件已删」？我倾向于不加——它们的价值就是记录当时的判断，加了反而失真。

### D. 存疑保留项（与第 1/2 轮一致，本轮复核仍成立）

| # | 项 | 理由 |
|---|---|---|
| R1 | `dshIdeContract.ts` 的 5 个导出 + 文件本身 | `verify:dsh-ide-contract` / `protocol-single-source` 按名字/正则断言；全仓 0 import 但门禁是消费者 |
| R2 | `dshChatModel.ts` 的 22 个 `Dsh*Block`/`Dsh*Node` 类型 | `DshChatNode` 联合类型成员，删了类型不全 |
| R3 | `isRecord` 6 份 / `stringOf` 3 份 / `numberOf` 2 份 | 跨三层，抽取需改 gulp staging 与 boundary 门禁 |
| R4 | 协议错误码与 `ide-view-host.js` 4 个同名常量 | Host 半身纯 JS，有意复制 |
| R5 | `.eslint-ignore:62-63` 的 `lit-html/**`、`signals-core/**` | **新证据**：这两个目录在 git 历史里**从未存在过**（`git rev-list --count --all -- 'src/vs/base/common/lit-html'` = 0）；但 `build/filters.ts:89-90,220-221` 仍按它们写排除项，属上游 vendored 约定。删 `.eslint-ignore` 这两行风险为零（glob 永不命中），但意义也接近零；建议**与 filters.ts 一起判**，不要单删 |
| R6 | `build/dsh/chat-render/` 的 `PROVENANCE.md` + `LICENSE-DSH` | AGENTS §5 四份凭据不得删改 |
| R7 | `src/vs/platform/dshClient/PROVENANCE.md`、`build/lib/dsh/PROVENANCE.md`、`NOTICE.md`、`LICENSE.txt` | 同上 |

### E. 前两轮未覆盖、本轮新发现（重要）

| # | 位置 | 问题 | 判定依据 | 风险 | 建议 |
|---|---|---|---|---|---|
| E1 | `scripts/sync-upstream.mjs:6-12,47-58` | **语义过期（不是断链）**：脚本头注释称「复用面 = 渲染复用件（20 源 + 8 CSS + 1 资产）+ 传输/契约」，但本地已无任何「渲染复用件」副本（`build/dsh/chat-render/src/` 与 `chatContentParts/dsh/` 都不存在）；脚本只比对**上游仓库两个 tag**，不读本地副本（除已修好的 `readVendoredVersion()`），因此**不会失败**，但生成的报告仍会把 20 源/8 CSS/1 资产列为「本项目的复用面」，与现状不符 | 实测 `UI_FILES` = 20、`CSS_FILES` = 8、`ASSET_FILES` = 1；`fs.existsSync('build/dsh/chat-render/src')` = false；`fs.existsSync('.../chatContentParts/dsh')` = false | **低**：报告口径误导，不影响运行 | 二选一（Q1）：把「渲染复用件」段改为「历史复用面（已删除，仅保留凭据）」/ 整段删掉只比对契约面 |
| E2 | `build/lib/dsh/PROVENANCE.md:31,58,99-105` 与 `build/dsh/chat-render/PROVENANCE.md:31,58,99-105` | 两份凭据描述的是**已不存在的** `build/dsh/chat-render/src/` 与 `build-render.mjs` 产物链（`dist/dsh-chat.js`/`dsh-chat.css`）；AGENTS §5 规定四份凭据「不得删改」 | 目录只剩两个文件；`gulpfile.vscode.ts` 与 `dshBundleStaging.test.ts` 已禁止 `build-render.mjs` | **高**（触碰许可证边界） | **不动**。只在报告的「存疑保留」里记录：凭据描述的是历史构建方式，与现状不符，但按 AGENTS §5 保持原样（Q2 请确认） |
| E3 | `build/filters.ts:89-90,220-221` | 排除 `src/vs/base/common/lit-html/**`、`signals-core/**`（两目录从未存在） | `git rev-list --count --all` = 0；`Test-Path=False` | 低 | 与 B2/B3 一起判（Q3） |
| E4 | `src/vs/platform/dshClient/PROVENANCE.md:81` 与 `NOTICE.md:10-11,29-30` | 仍写 `E:\vscode-dsh\vscode-1.143.1` 旧布局 | 仓库已扁平化 | **高**（NOTICE/LICENSE 禁改） | **不动**，记入报告 |
| E5 | `build/lib/i18n.ts:333`、`build/npm/update-localization-extension.ts:53`、`build/gulpfile.scan.ts:38-39` | 按「仓库的兄弟目录」找 `vscode-loc` / `scanbin`；扁平化后变成 `E:\vscode-loc`、`E:\scanbin` | `path.join(REPO_ROOT_PATH,'..','vscode-loc')` 推导 | 低（仅翻译/符号任务，不影响 `dsh-ide-pack`） | **不动**（Q4）：这是 VS Code 上游约定「vscode-loc 与 vscode 同级」，扁平化没有改变这个相对关系以外的语义；改了反而偏离上游 |

### F. 建议执行

1. **批次 A**：B1（空目录）、B2（17 条 copilot 忽略）、B3（filters.ts 4 行）。
2. **批次 B**：按 Q1 处理 `sync-upstream.mjs`。
3. 之后跑：tsc → test-dsh:all → `verify:dsh-ide-ci`（带 `DSH_INSTALLED_VERSION`）→ `npm run compile`。
4. 输出第 3 轮瘦身报告并更新手册 §9.11.5。

### G. 请确认的问题

- **Q1** `scripts/sync-upstream.mjs` 的「渲染复用件」段（20 源 / 8 CSS / 1 资产）已无本地对应物：改为「历史复用面（已删除，仅保留凭据）」/ 整段删除只比对契约面 / 保持原样？
- **Q2** 两份 `PROVENANCE.md` 描述已失效的 `chat-render` 构建链：按 AGENTS §5 保持原样（推荐），还是允许追加「历史说明」段（不改原文）？
- **Q3** `build/filters.ts` 与 `.eslint-ignore` 里 `lit-html`/`signals-core` 的死排除项：删 / 保留？
- **Q4** `build/lib/i18n.ts` 等三处 `vscode-loc`/`scanbin` 兄弟目录假设：保留（推荐，属上游约定）/ 改为仓库内路径？
- **Q5** 历史文档（`docs/DSH-IDE内容接收…` 等）里的已删文件引用：保持原样（推荐）/ 逐条加「已删除」注记？

---

## 第 4 轮：已删目录导致的真实断链

> 编制时间：2026-11-17 23:10（Asia/Shanghai）
> 依据：HEAD `75b1fc1`（工作树 clean），手册 §9.11、AGENTS.md。
> 本轮由 3 个子智能体并行扫描：配置残留（已删目录）、全仓重复实现、手册与代码一致性。
> 用户已明示「不确定不要提问，按推荐方法继续」，故本清单同时给出**执行决策**。

### 0. 基线

| 项 | 值 |
|---|---|
| tsc | 0 error |
| test-dsh:all | 384 + mocha 7 全 PASS |
| DSH 两目录 | 55 文件 / 15 JS / 34 TS / 4 MJS / 1 SVG / 1 MD |
| 已删目录 | `src/vs/platform/agentHost/**`、`extensions/copilot/**`、`src/vs/sessions/**`、`test/integration/agentHost/**`（均 `Test-Path=False`） |

### A. 已删目录导致的真实断链（7 处，11 行，最高优先级）

| # | 位置 | 类型 | 判定依据 | 风险 | 决策 |
|---|---|---|---|---|---|
| A1 | `scripts/test-integration.sh:200` | 断链 | `node --input-type=module -e "import {...} from './src/vs/platform/agentHost/test/node/agentHostTestProfile.ts'"`；该文件不存在 → `ERR_MODULE_NOT_FOUND`，`set -e` 中断整个默认集成测试 | **高**：默认集成测试入口直接失败 | 删该行及其空行 |
| A2 | `scripts/test-integration.bat:130` | 断链 | 同 A1（Windows）；下一行 `if errorlevel 1 goto :failed` 判失败 | 高 | 删该行 |
| A3 | `scripts/code-agent-host.js:72-81`（entryPoint 拼接）+ `scripts/code-agent-host.sh:28` | 断链 | 拼 `out/vs/platform/agentHost/node/agentHostServerMain.js` 并 spawn；`out/` 下无此目录 | 高 | **删除整个 `code-agent-host.js` + `.sh` + `.bat`**，并删 `.vscode/launch.json` 的「VS Code Agent Host」启动项 |
| A4 | `scripts/test-agent-host-e2e.sh:37` / `.bat:15` | 断链 | `exec node ./test/integration/agentHost/runner.ts`；目录不存在 | 高 | 删这两个包装脚本（对应 npm script 已在第 1 轮删除） |
| A5 | `scripts/sync-agent-host-protocol.ts:33` | 目标失效 | `DEST_DIR` 指向已删的 `src/vs/platform/agentHost/...`；脚本先查 `../agent-host-protocol/types`（本机不存在）→ `exit 1`。**注意：该脚本仍是 61 个 `chatContracts/common/state/protocol/*.generated.ts` 的唯一生成器**（这些文件的头注释都指向它） | **中**：脚本本身跑不起来，但生成的协议文件仍在用 | **修而不删**：把 `DEST_DIR` 改为 `src/vs/platform/chatContracts/common/state/protocol`（这是文件实际所在处），其余逻辑不动 |
| A6 | `test/smoke/src/areas/agentsWindow/remoteDevContainerFixtures.ts:427,430,487` | 断链 | 拼 `out/vs/platform/agentHost/node/agentHostServerMain.js` / `agentHostMain.js`；`readFileSync(src/.../agentHost/.../version/registry.ts)` | 中：只有 Dev Container smoke 套件会走到 | 把 registry 读取路径改 `chatContracts`；入口路径改为「找不到就不 spawn」的显式 skip（不假装成功） |
| A7 | `test/smoke/src/areas/agentsWindow/fixtures/packagedAgentHost.ts:96` | 断链 | `VSCODE_ESM_ENTRYPOINT: 'vs/platform/agentHost/node/agentHostMain'` | 中 | 同 A6，改为 chatContracts 对应入口或显式不可用 |

### B. 已删目录的惰性残留（不影响运行，建议清）

| # | 位置 | 条数 | 判定 |
|---|---|---|---|
| B1 | `eslint.config.js` 的 `src/vs/platform/agentHost/**` glob（244-248、439、453、466、469、471、1213、1763、1773 等） | 10 处 | 惰性：零匹配不报错 |
| B2 | `build/filters.ts:213,242,250` 的 `!src/vs/platform/agentHost/node/codex/protocol/generated/**` | 3 处 | 惰性 |
| B3 | `.eslint-ignore:36` 的 `**/src/vs/platform/agentHost/node/codex/protocol/generated/**` | 1 处 | 惰性 |
| B4 | `.vscode/settings.json:71-73` 的三条 `src/vs/platform/agentHost/**` 只读/搜索排除 | 3 处 | 惰性 |
| B5 | `build/lib/i18n.resources.json:700`、`build/lib/extensions.ts:333`、`build/darwin/*` 的 `extensions/copilot` 条目 | 5 处 | 惰性 |

> **决策**：B1~B4 清（纯配置，零风险）；B5 保留（`build/lib/extensions.ts` 与 `build/darwin/*` 是上游打包逻辑，删除可能影响未来扩展目录结构，且均带 `existsSync` 守卫）。

### C. 手册与代码不一致（21 处，其中 17 处为现状描述）

| # | 手册行 | 声明 | 实测 | 决策 |
|---|---|---|---|---|
| C1 | 147 | `validateDshIdeSnapshot(:755-778)` | 实际 `:1157` | 改为 `:1157` |
| C2 | 147 | `assertSnapshotContinuity(:797-816)` | 实际 `:1963` | 改为 `:1963` |
| C3 | 147 | `validateDshIdeInvokeOutput(:592-596)` | 实际 `:933` | 改为 `:933` |
| C4 | 148 | `DshIdeWaterfallNotice(:671-706)`、`DshIdeSessionNotice(:667-669)` | 实际 `DshIdeWaterfallNotice` 定义在 `:1054` 起、`DshIdeSessionNotice` 在 `:1054` 之前；两者均无 667-669 | 改为 `:1054` / 去掉错误行号 |
| C5 | 189 | `DshIdeImageAttachmentRef(:109-122)` | 实际 `:136-145` | 改为 `:136-145` |
| C6 | 266 | `dshChatModel.ts:388-403,516-941` | 文件仅 **646 行**，`516-941` 越界；裸帧解析已删 | 改为 `dshChatModel.ts` 的 `acceptConversation` 段（`:388` 起） |
| C7 | 267 | `DshChatModel(:318-320,375-386)` / `pendingItems(:86)` / `_running(:89)` | `tokenUsage()` 在 `:364`；`pendingItems` 在 `:89`；`_running` 在 `:92` | 改为 `:364` / `:89` / `:92` |
| C8 | 657 | `dshIconDataUris.ts`（约 76 KB） | 实测 **96,561 B ≈ 94 KB** | 改为约 94 KB |
| C9 | 890 | node **386** 项 | 当前 384 | 标注为历史（该段是 2-D 阶段验收记录） |
| C10 | 893 | 「全量 tsc 余 137 个既有报错」 | 当前 0 | 同上，标注为历史 |
| C11 | 639/887 | `dshSessionItemState.test.ts` 存在 | 已删（第 1 轮） | 标注为历史 |
| C12 | 794-798 | 控制器 `refresh()`/`toSessionItem()`/`sameItem()`/`applyRunning()` 旧行号与旧实现 | `refresh` 在 `:190` 起、`toSessionItem` 在 `:321`、`sameItem` 已不存在（改 `sameTreeItem`）、`applyRunning` 在 `:293` | 标注为历史（该表是改造前-改造后对照） |
| C13 | 149 | `dshIdeEndpoints.test.ts:301-312` | 实际 `:328-331` | 改为 `:328-331` |

### D. 零引用脚本（1 个）

| # | 文件 | 大小 | 判定依据 | 决策 |
|---|---|---|---|---|
| D1 | `scripts/chat-simulation/merge-ci-summary.js` | 22,536 B / 508 行 | 全仓无 import、无 npm script、无 CI 配置引用；头注释称「Called by the CI report job」，但仓库已无 `.github/`；含 3 个与 `test-chat-perf-regression.js` 完全相同的函数 | **删除**（同时删 `.eslint-allowed-javascript-files:51` 的登记） |

### E. 重复实现（复核后仍保留）

| # | 项 | 结论 |
|---|---|---|
| E1 | `isRecord` 8 处（含 scripts 2 处）、`stringOf` 3 处、`numberOf` 2 处、`isRef` 2 处 | 保留：跨 ESM/CJS 两套模块系统 + Host 纯 JS 层，抽取收益 <50 行且要改 gulp staging |
| E2 | 6 组同值常量（协议错误码、版本号） | 保留：契约单测按值断言，Host 半身纯 JS 有意复制 |
| E3 | TypeScript 双 major（`typescript@npm:@typescript/typescript6@6.0.2` + `@typescript/native@npm:typescript@7.0.2`） | 保留：`update-build-ts-version` 与 `tsc` 门禁依赖两者；且实测 `node_modules/typescript` 已是 5.9.3（安装漂移），改动风险高 |
| E4 | `build/node_modules` 第二套依赖树（270 MB，未入库） | 保留：`.gitignore:17` 已忽略，不属仓库瘦身范围 |

### F. 执行批次

1. **批次 A（断链，必须）**：A1-A7。每改一个脚本跑 `bash -n` / `node --check`。
2. **批次 B（惰性配置）**：B1-B4。
3. **批次 C（D1 死脚本）**。
4. **批次 D（手册行号）**：C1-C8、C13。
5. 跑 tsc → test-dsh:all → `verify:dsh-ide-ci`（带 `DSH_INSTALLED_VERSION`）→ `npm run compile`。
6. 输出第 4 轮报告并更新手册 §9.11.6。

### G. 假设

1. `sync-agent-host-protocol.ts` 的目标目录改为 `chatContracts` 是我的推断（61 个 generated 文件都在那里、且都带该脚本的 banner），若上游另有约定需再核。
2. A6/A7 的 smoke 测试改动只在「Dev Container / packaged AgentHost」路径生效，不影响 DSH-IDE 自身。
3. `test/smoke/**` 是 VS Code 上游测试，改动只在「指向已删目录」的路径上做最小修正，不动测试逻辑。

---

## 第 4 轮补充：细小 Bug 清单（8 类扫描）

> 编制时间：2026-11-17 23:50（Asia/Shanghai）
> 依据：`scan-small-bugs` 子智能体只读扫描 + 主智能体逐条复核。HEAD `3f60c398`。
> 用户要求「每轮还要检查是否仍有细小 bug，全部整理后分析出一个没有逻辑问题的可执行解决方案并处理」。
> 按「不确定不要提问」的约定：下表每条都给出**推荐方案**，我按推荐方案继续。

### 真实 bug（11 处，已逐条复核）

| # | 位置 | 类别 | 问题 | 触发条件 | 严重度 | 推荐方案 |
|---|---|---|---|---|---|---|
| B1 | `dshChatSession.ts:406-416` | 状态不一致 | `submit()` 置 `_running=true`，仅在 `result.ok === false` 时复位；**回合正常结束时无任何代码复位**，`running()` 永远为 true → 面板永远显示「生成中」、停止按钮常驻 | 发送任意一条消息并等本轮结束 | **高** | 在 `acceptView()` 里按 `view.frame` 的官方状态复位：读到 `frame['running'] === false`（或 `state.phase` 回到 idle）时 `_running=false` 并 fire；同时给 `DshIdeSessionNotice{kind:'status'}` 加消费（`dsh.contribution.ts` 里转给 `_chat`），由 Host 的 `session-status` 帧驱动。两条路任一条先到即复位，幂等 |
| B2 | `dshChatSession.ts:229-251` | 状态不一致 | `bind()` 先写 `boundSessionId` 再 `await rebindView`；失败不回滚 → 之后 `bind(同一 id)` 因相等直接 `return true`，永远无法重绑 | `rebindView` 失败一次后再打开原会话 | 中 | 先 `await rebindView`，成功后再写 `boundSessionId` 与清理状态；失败保持原值。注意 `generation` 要在 await 前自增以作废旧流 |
| B3 | `dshChatSession.ts:289-311` | 状态不一致 | `plan`/`goal`/`todos` 只在 `snapshot` 帧带（`ide-view-service.ts:248-250` 只在 `type==='snapshot'` 时投影），后续内容帧 `projections` 是 `{}` → `acceptView` 把三者当 `undefined`/`[]` 清空 | 打开有计划/目标/Todo 的会话，收到下一条内容帧 | 中 | 与 `skills` 同口径：`view.plan === undefined ? this._plan : view.plan`，`goal` 同理，`todos` 用 `view.todos !== undefined ? view.todos : this._todos` |
| B4 | `dshIdeConsumer.ts:74-95,98-109` | 状态不一致 | 任一坏帧/版本 gap 置 `failed=true` 后**永久**拒绝后续帧；`reset()` 全仓零调用 | 收到一次 `SNAPSHOT_STALE` 或结构不合法帧 | 中 | `dsh.contribution.ts` 在 `client.onDidChangeState(connected)` 时调用 `consumer.reset()`（重连后重新接受）；`DshChatSession.bind()` 成功后也调一次 |
| B5 | `dshIdeBackendFactory.ts:231-249` | 异步错误 | `this.authenticating` 缓存 Promise，成功/失败都不清；首次 cookie 交换因瞬断 reject 后，**该 rejected Promise 被永久复用** | 启动时 Host 未就绪导致首次 `exchangeCookie` 失败 | 中 | `this.authenticating = (async () => {...})().catch(error => { this.authenticating = undefined; throw error; })`；成功路径在 `impl` 赋值后清空 |
| B6 | `dshAgentSessionsController.ts:65-67,96-108` | 异步错误 | `void this.refresh(...)` 无 `.catch`，而 `refresh()` 在 `listSessions` 失败时 `throw` → unhandled rejection | Host 未连接时触发刷新 | 中 | 统一 `void this.refresh(t).catch(onUnexpectedError)`；`_listRefresh.schedule()` 的路径同样处理 |
| B7 | `dshSessionTree.ts:144-163` | 逻辑错误 | `list.map()` 永远返回新数组 → `nextChildren !== item.children` 恒真 → `changed` 恒真，`mapTreeItem` 对含子项的树永远返回新树 | 有 subagent 子项时调用 `setChatSessionItemRead`/`applyArchived`（即使值没变） | 低 | 比较子数组：`const nextChildren = map(...); if (nextChildren !== item.children && (nextChildren.length !== item.children.length || nextChildren.some((c,i)=>c!==item.children![i])))`。更简单：让 `map` 在 `changed` 为 false 时返回原数组 —— 用 `let listChanged=false` 逐层传递 |
| B8 | `dshLanguageModelProvider.ts:105-107` | 状态不一致 | 目录变化只比较 `identifier`；模型显示名/effort 变化不 fire `onDidChange` | DSH 侧改名模型或调整 reasoningEffort | 低 | 比较 `name`/`efforts`/`defaultEffort`/`capabilities`，或用稳定 JSON 比较 |
| B9 | `dsh.contribution.ts:89` | 资源泄漏 | `registerDshInlineCompletions(...)` 返回的 Disposable 未 `_register` | 贡献点释放时 | 低 | `this._register(registerDshInlineCompletions(languageFeatures, client));` |
| B10 | `dshIdeTransport.ts:152-160` | 异步错误 | `signal.throwIfAborted()` 与 `addEventListener('abort')` 之间有窗口，期间 abort 会漏 | 瞬间 abort 竞态 | 低 | 先 `addEventListener` 再 `throwIfAborted()`；或挂完后复查 `signal.aborted && cancel()` |
| B11 | `dshChatHistory.ts:234-238` | 逻辑错误 | `applyQuotaNotice` 在 `appendDeliverables`/`appendExtras`/`appendPending` 之后执行，配额 `errorDetails` 可能挂到交付物那条 response | 同回合既有 deliverables 又有额度失败 | 低 | 先记「最后一条对话 response 索引」，再 append 其它；配额只作用该索引 |

### 分类统计

| 类别 | 处数 |
|---|---|
| 1 未定义/未导入标识符 | 0 |
| 2 可选链/空值处理 | 0 |
| 3 异步错误 | 3（B5/B6/B10） |
| 4 资源泄漏 | 1（B9） |
| 5 逻辑错误 | 2（B7/B11） |
| 6 字符串/正则/路径 | 0 |
| 7 类型断言掩盖 | 0 |
| 8 状态不一致 | 5（B1/B2/B3/B4/B8） |

### 执行计划

1. **批次 1（高危 + 中危，功能修复，单独提交）**：B1、B2、B3、B4、B5、B6。
2. **批次 2（低危，功能修复，单独提交）**：B7、B8、B9、B10、B11。
3. 每批后跑 tsc + `test-dsh:all`；全批完成后跑 `verify:dsh-ide-ci` + `npm run compile`。
4. 新增/调整单测覆盖：B1（running 复位）、B2（bind 失败可重试）、B3（缺席不清空）、B7（mapTreeItem 无变化返回原数组）。
5. 输出 `docs/DSH-IDE瘦身报告.md`（第 4 轮补充：细小 Bug 修复）（问题、根因、修法、测试、风险）。

### 假设（手册未覆盖处）

1. **B1 的复位信号**：官方 `DshIdeViewSnapshot.frame` 是 `sessionController.follow` 的原始帧，其中 `running` 字段存在（`IDshIdeSessionSummary.running` 同源）。若某些帧不带 `running`，则退化为「收到 `session-status` notice 时复位」，两者都不可用时保持现状（不清空）。
2. **B2 的顺序调整**：`generation++` 必须在 `await` 前，否则旧流可能在 await 期间写入新会话；这一点与现有 `bind()` 语义一致（它已经在写 `boundSessionId` 前自增）。
3. **B4 的 reset 时机**：只在「连接重新建立」与「bind 成功」两处 reset，不在每帧 reset——否则坏帧熔断就失去意义（防止坏帧无限刷）。
4. **B7 的返回原数组**：`mapTreeItem` 的调用方（`setChatSessionItemRead` / `applyArchived`）已用 `next === this._items` 判等来决定是否 fire，所以「无变化返回原数组」是契约的一部分，不是优化。

---

## 第 5 轮：上一轮修复的回归 + sessions 残留 + 脚本缺陷

> 编制时间：2026-11-18 00:15（Asia/Shanghai）
> 依据：HEAD `9919cd20`（工作树 clean）。两个子智能体并行扫描：sessions 残留网络、构建/测试细小 bug。
> 按既定约定：不确定处不提问，写出问题 + 推荐方法后按推荐方法执行。

### A. 第 4 轮修复引入的回归（最高优先级，5 处）

| # | 位置 | 类型 | 问题 | 判定依据 | 风险 | 推荐修法 |
|---|---|---|---|---|---|---|
| A1 | `dshChatSession.ts:228-230,246-254` | 状态不一致（**高危**） | B2 的「失败回滚 `boundSessionId = previous`」与开头的 `if (sessionId === this.boundSessionId) return true` 组合成死锁：A 已绑定 → bind(B) 失败 → 再 bind(A) 直接 return true，但 `model.clear()` 已执行 → **面板永久空白** | 读 `:228` 短路 + `:246` 失败分支 + `:231` 的 `model.clear()` | 高 | 新增 `_boundDirty` 标志：短路条件加 `&& !this._boundDirty`；失败时置 true，成功时置 false。这样 bind(previous) 会真正重跑 rebind |
| A2 | `dshClientService.ts:102,160-166` + `dsh.contribution.ts:142-149` | 状态不一致（中） | B4 的 `consumer.reset()` 挂在 `onDidChangeState(connected===true)`，但 `_connected` 全仓无置 false 路径 → 该事件每窗口最多触发一次，**重连时不会 reset，熔断依旧只能靠重载窗口** | `git grep '_connected'` 只有 `= false` 初值与 `markConnected()` 置 true；`publishDisconnected`（`ide-view-service.ts:184-195`）只发 `rebuild` 快照 | 中 | 在 `DshClientService` 的 snapshot 监听里：`snapshot.state.state === 'rebuild'` 时 `markDisconnected()`（置 false + fire `{connected:false}`）。这是 Host 已明确表达的「正在重连」信号 |
| A3 | `dshIdeTransport.ts:158-172` | 资源泄漏（低） | B10 的顺序调整把 `throwIfAborted()` 放在 `try` 之前；若 signal 已 abort，抛错跳过 `finally`，`cancel`/`onAbort` 监听器永久挂在调用方的 signal 上 | 读 `:166-172`：`_pendingCalls.add` 与 `try` 在 `throwIfAborted()` 之后 | 低 | 把 `throwIfAborted()` 移进 `try` 第一行 |
| A4 | `dshIdeBackendFactory.ts:247-252` | 异步错误（低） | B5 的 `.catch` 无条件 `this.authenticating = undefined`；若期间 `close()`/新 `ensureImpl()` 已换成新 Promise，旧 rejection 会抹掉新的，导致并发重复鉴权 | 读 `:238-252` | 低 | 用局部 `const attempt = (async () => {...})()`，catch 里 `if (this.authenticating === attempt)` 才清空 |
| A5 | `dshIdeProtocol.ts:93-95` | 语义未固化（低） | B3 的「缺席即保留」使 `plan`/`goal` 在同一绑定内无法用「省略」清空 | `acceptView` 现为 `view.plan !== undefined ? view.plan : this._plan` | 低 | 在 `DshIdeViewSnapshot.plan/goal/todos` 的注释里固化「缺席 = 本帧没带，保留上一次；关闭计划用 `{active:false}`」 |

### B. 已删 `src/vs/sessions/**` 的残留（可安全清理）

| # | 位置 | 类型 | 判定依据 | 风险 | 建议 |
|---|---|---|---|---|---|
| B1 | `eslint.config.js` 12 个整块（1940-1950、2084-2104、2105-2125、2126-2146、2147-2163、2164-2181、2182-2197、2198-2212、2213-2232、2233-2249、2250-2276、2384-2415），共约 54 处 `vs/sessions` | 冗余配置 | `code-import-patterns.ts:63` 只做 `minimatch(relativeFilename, config.target)`，**不 stat 磁盘**；target 全部指向不存在的文件/目录 → 永不匹配、不报错、零行为变化。2384-2415 是 `no-restricted-imports`，`files` 匹配不到文件同样静默跳过 | 无 | 删 |
| B2 | `eslint.config.js:1863` 的 `'vs/sessions/~'`（在 `src/vs/workbench/contrib/*/~` 的 restrictions 里） | 冗余配置 | 该 target **覆盖数千个现存文件**；删掉是「允许清单收窄」，当前全仓 0 处 `vs/sessions` import 所以今天不报错，但语义变了 | 低 | **保留**（不属「等价清理」） |
| B3 | `build/stylelint.ts:37,97` + 注释 25/90/186 | 死逻辑 | `designSystemPattern` 指向已删目录 → 正则永假；但只删 37 行会让 97 行引用未定义变量（tsc 失败），无条件执行会让全仓 CSS 冒大量建议（行为变化） | 低 | 删 37 行；97 行改为 `reportDesignTokenSuggestions && designTokensEverywhere`（与现状严格等价）；删 3 处注释 |
| B4 | `build/lib/i18n.ts:395,420-424` + `build/lib/test/i18n.test.ts:36,46-47,57-58` | 死分支 | 只删实现 → 2 条断言走 `getResource()` 的 throw；只删断言 → 实现成死分支。**必须成对删** | 低 | 成对删（8 行） |
| B5 | `src/tsec.exemptions.json:16,43` 的 `vs/sessions/electron-browser/sessions.ts` | 冗余配置 | 文件不存在，tsec 只按路径字符串比对，永不命中 | 无 | 删 |
| B6 | `test/smoke/src/areas/agentsWindow/**`（6 文件）+ `test/automation/src/agentsWindow.ts` + 5 处 wiring | **死测试**（108 KB + 56 KB） | 被测对象全不存在：`src/vs/platform/agentHost/**`、`src/vs/sessions/**`、`out/vs/platform/agentHost/**` 均 `Test-Path=False`；`agentsWindow.ts:69` 调的 `workbench.action.openWorkspaceInAgentsWindow` 全仓无此命令 | 中（测试裁剪） | 删 7 个文件；改 `test/smoke/src/main.ts:37,470`、`test/automation/src/workbench.ts:26,53,75`、`test/automation/src/index.ts:31` |
| B7 | `build/next/devTunnelsWeb.ts` + `package.json` 的 `bundle-dev-tunnels-web` + 其 test | 死构建 | `devTunnelsWebOutDir = 'vs/sessions/contrib/providers/remoteAgentHost/browser'`，每次 build 重建 `out/vs/sessions/...`；全仓无代码 import 其产物 | 中（构建脚本） | 删（脚本 + npm script + test） |

### C. 构建/测试脚本的真实缺陷（6 处）

| # | 位置 | 类型 | 问题 | 判定依据 | 风险 | 修法 |
|---|---|---|---|---|---|---|
| C1 | `build/lib/test/dshIdeEndpoints.test.ts:92-94,144-148,167` | 测试假守护 | `WIRED` 含全部 7 个 finding → `UNVERIFIED` 恒为空数组 → `for (const method of UNVERIFIED)` 一次不执行，`assert.equal(UNVERIFIED.length, 0)` 恒真 | 读 `:92` 的 7 个 method 与 `:158-161` 的 7 个完全一致 | 中 | 改为显式表：`WIRED` 7 项 + `UNVERIFIED` 显式空数组常量，并断言 `FINDINGS.every(f => WIRED.includes(f.method) || UNVERIFIED.includes(f.method))` |
| C2 | `build/lib/test/dshStageNumbering.test.ts:29` | 路径写错 | `dshIdeProjection.test.ts` 不存在（实际 `dshIdeProjections.test.ts`）；`walk()` 的 `catch { return; }` 吞掉 stat 失败 → 该文件从未被扫描 | `Test-Path` + 文件名比对 | 低-中 | 改文件名；`walk` 的 catch 改为收集 `missing` 并 `assert.deepEqual(missing, [])` |
| C3 | `build/lib/dsh/verify/dshIdeVerify.mjs:336-360` | 版本比较错 | 预发布标签用字符串比较 → `rc.10 < rc.9`；且重复实现，未复用 `dshIdeContract.ts` 的 `compareVersion` | 读 `:357` 的 `a.pre > b.pre` | 中 | 改为复用 `installedMeetsVersion()`（从 contract 读源码或直接 import） |
| C4 | `build/lib/dsh/verify/dshInstallDrift.mjs:74-77,150-160` | 逻辑错 | ① `artifactBuffer.length > 0` 才比对 → 空文件永不检测；② `collectJs` 对缺失 `host/` 目录直接抛 ENOENT，不打印 `STATUS: FAIL` | 读两处条件 | 低-中 | ① 去掉长度条件；② `collectJs` 入口加 `existsSync` 守卫并记入 `syntaxIssues` |
| C5 | `build/lib/dsh/verify/dshArtifactContents.mjs:24` | 路径依赖 cwd | `repoRoot = process.cwd()`，与 `dshIdeVerify.mjs:24` 的 `import.meta.dirname` 口径不一致；非仓库根调用会误报 | 读两处 | 低 | 改用 `path.resolve(import.meta.dirname, '../../../..')` |
| C6 | `build/lib/dsh/genDshIconDataUris.mjs` | 门禁未接线 | `--check` 逻辑存在但无 npm script、无 CI step、测试只断言 104 个 glyph 不校验内容 | `package.json` 无对应 script | 中 | 加 `verify:dsh-icons` npm script，先手动跑一次确认 PASS 再决定是否纳入 CI |

### D. 文档/凭据（只报告，不动）

| # | 位置 | 问题 | 决策 |
|---|---|---|---|
| D1 | `build/lib/dsh/PROVENANCE.md:5` vs `:11-14` | 第 5 行称「已同步到 0.2.2-rc.3」，权威版本表仍写 `0.2.2-rc.1` | AGENTS §5 法律凭据，**只记录不动**，由维护者确认 |
| D2 | `test/smoke/src/areas/agentsWindow/**` 删除后，手册 §6/README 里若有 smoke 说明 | 待核 | 若命中则同步改文档 |

### E. 执行批次

1. **批次 A（回归修复，功能提交）**：A1-A5 + 补 A1 的回归测试用例。
2. **批次 B（清理提交）**：B1、B3、B4、B5、B6、B7（B2 保留）。
3. **批次 C（脚本/测试修复提交）**：C1-C6。
4. 门禁：tsc → `build-dsh-tests` → `test-dsh:all` → `verify:dsh-ide-ci` → `verify:dsh-artifact` → `npm run compile`。
5. 输出第 5 轮报告 + 手册 §9.11.8。

### F. 假设

1. `DshClientService` 用 `rebuild` 快照判「断开」是正确信号：Host 的 `publishDisconnected` 只在传输断开时发它。
2. 删 `agentsWindow` smoke 区不减少有效覆盖：被测源码与 out 产物都不存在。
3. `devTunnelsWeb` 产物无消费者：全仓 grep 其输出路径只命中 build 自身。
4. `genDshIconDataUris --check` 若跑出漂移，则本轮只加脚本不纳入 CI，避免引入失败门禁。

---

## 第 6 轮：chat-simulation / mock-policy-server

> 编制时间：2026-11-18 00:55（Asia/Shanghai）
> 依据：HEAD `2b4f2504`（工作树 clean）。两个子智能体并行扫描：`scripts/chat-simulation` + `scripts/mock-policy-server`（上一轮仅模式扫描）与第 5 轮后的手册一致性。
> 按既定约定：不确定处不提问，写出问题 + 推荐方法后按推荐方法执行。

### A. 上一轮（第 5 轮）文档的定量偏差（6 处）

| # | 位置 | 类型 | 声明 | 实测 | 修法 |
|---|---|---|---|---|---|
| A1 | `手册:1035`（§9.11.6，第 4 轮记录） | 现状口吻写历史 | `agentsWindow/**`「整块保留」 | 第 5 轮 `8903ba72` 已删 | 补注「第 5 轮已删，见 §9.11.8」 |
| A2 | `手册:1057`（§9.11.8） | 定量口径 | 「`test/smoke/src/areas/agentsWindow/**` 6 文件 164 KB」 | smoke **5 文件 108,481 B**；`test/automation/src/agentsWindow.ts` **1 文件 56,366 B**；合计 6 文件 164,847 B | 拆写为「smoke 5 文件 108 KB + automation 1 文件 56 KB（合计 6 文件 164 KB）」 |
| A3 | `手册:1061` | 定量 | `test-dsh:all`「389 → 391」 | 第 4 轮末为 **388**，本轮为 391（**+3**） | 改为「388 → 391」 |
| A4 | `报告5:14` | 定量 | 「391，较第 4 轮 389 +2」 | 同 A3 | 改为「388，+3」 |
| A5 | `报告5:4` | 统计边界 | 终点 `90e19ae1` | 实际末次是 `85ad5953`（37 vs 40 文件） | 终点改为 `85ad5953` |
| A6 | `手册:301`（§3.5） | 行号漂移 | `package.json:85-94` 的 test/verify scripts | 实测在 **80–91** 行 | 改为 `package.json:80-91` |

### B. `scripts/chat-simulation` 的零引用符号（3 个）

| # | 位置 | 符号 | 判定依据 | 风险 | 建议 |
|---|---|---|---|---|---|
| B1 | `common/utils.js:753`（导出 `:840`） | `linearRegressionSlope` | 全仓仅定义 + 导出项两处命中，两个 test 脚本的 `require` 解构里都没有 | 无 | 删（函数 + 导出项） |
| B2 | `common/mock-llm-server.ts:26` | `ROOT` 常量 | 文件内仅 1 次出现（定义本身），`path` 只用于这一行 | 低 | 删（同时看 `path` 是否还有其他用途） |
| B3 | `common/mock-llm-server.ts:187` | `ScenarioBuilderImpl.burst()` | 全仓 `.burst(` 零命中 | 无 | 删 |

> **不删**：`utils.js` 的 `getElectronPath` / `preseedStorage` / `writeSettings` / `median` / `removeOutliers` 虽无外部消费者但在文件内被调用，只是「可降级导出」，删了无收益。
> **不是死文件**：`fixtures/_chatperf_*.ts`（8 个）经 `path.join(FIXTURES_DIR, name)` 字符串动态引用；`mock-policy-server/public/*` 经 `GUI_ASSETS` 白名单映射；`mock-llm-server.ts` 还被 `test/smoke/src/utils.ts:229` 跨目录引用。

### C. `scripts/chat-simulation` + `mock-policy-server` 的真实 bug（9 处，高危 0）

| # | 位置 | 类型 | 问题 | 触发条件 | 严重度 | 修法 |
|---|---|---|---|---|---|---|
| C1 | `mock-llm-server.ts:799-803`（同型 `:811,823,829,841`） | 未 catch 的 async | `readBody().then(body => handleChatCompletions(...))` 无 `.catch` | 请求体异常或 res 已断开 → unhandled rejection → Node 24 终止进程，整轮 benchmark 死 | **中** | `.then(...).catch(...)`，`headersSent` 判后再回 500 |
| C2 | `mock-llm-server.ts:2174` | 未 catch 的 async | `_startServer(port).then(...)` 无 `.catch` | 端口被占 | 低 | 加 `.catch` 设 `process.exitCode = 1` |
| C3 | `utils.js:390` | `JSON.parse` 无保护 | WS `message` 回调裸 `JSON.parse` | inspector 发非 JSON 帧 | **中** | try/catch 后 return |
| C4 | `utils.js:37` | `JSON.parse` 无保护 + 静默回退 | `loadConfig()` 裸 parse，失败时 `?? {}` 让阈值静默回退默认值 | config.jsonc 被改坏 | **中** | try/catch 并抛带文件名的错误，禁止静默回退 |
| C5 | `test-chat-perf-regression.js:1358,1364,1529,1782,1917` | `JSON.parse` 无保护 | 5 处裸 `JSON.parse(fs.readFileSync(...))` | 上次中断留下截断的 baseline JSON | **中** | 统一 `readJsonFile()` helper，损坏时提示删缓存 |
| C6 | `mock-policy-server/server.ts:738,768` | 路径依赖 cwd | schema 源按 `process.cwd()` 解析（`:769` 才有 `ROOT` 兜底） | 不在仓库根启动 | 低 | 统一以 `ROOT` 为基准 |
| C7 | `mock-llm-server.ts:1215,1383,1815,1909` | 正则反解 | `toolNamePattern.source.replace(...)` 反解出的工具名可能不存在 | 无匹配时回退成 `readfile` 这类假名 | 低 | 回退到 `requestToolNames[0]` 或 `unknown_tool` |
| C8 | `test-chat-perf-regression.js:380` | 正则硬编码 `/` | `/vscode-test\/vscode-.../` 在 Windows 路径 `\` 下不匹配 | Windows | 低 | 改 `[\\\\/]` |
| C9 | `utils.js:28` | 正则误伤 | `stripJsoncComments` 的 `/\/\/.*/g` 会砍掉字符串内的 `//`（URL） | config 值含 `http://` | **中** | 状态机跳过字符串，或只去行首 `//` |

### D. 重复实现（5 组，低收益，本轮不动）

| # | 位置 | 函数 | 说明 |
|---|---|---|---|
| D1 | `fixtures/_chatperf_errors.ts:28` ↔ `:36` | `onUnexpectedError` / `onUnexpectedExternalError` | 逐字相同 |
| D2 | `mock-policy-server/public/app.ts:516` ↔ `server.ts:940` | `isPlainObject` / `isRecord` | 逐字相同，但 app.ts 是浏览器直服 IIFE，无模块系统 |
| D3 | `fixtures/_chatperf_async.ts:55` ↔ `:83` | `cancelTimeout` / `cancel` | 逐字相同（`clearTimeout` + 置 null） |
| D4 | `test-chat-perf-regression.js:1250` ↔ `:1266` | `round2` | 同一函数内重复定义 |
| D5 | `mock-policy-server/server.ts:825-859` ↔ `public/app.ts:292-323` | 三平台 install/remove 命令模板 | 4 段命令字符串逐字同源 |

> 判定：这些是**测试脚手架**（不在 DSH-IDE 产品代码里），且抽取会跨模块系统（CJS / 浏览器 IIFE / ESM）。按「收益 < 风险」保留，只记入报告。

### E. 执行批次

1. **批次 A（文档定量修正）**：A1-A6。
2. **批次 B（清理）**：B1-B3。
3. **批次 C（bug 修复）**：C1-C9（C7/C8 只改明显的正则与回退，不重构 scenario 语义）。
4. 门禁：tsc → `build-dsh-tests` → `test-dsh:all` → `verify:dsh-ide-ci` → `npm run compile`。
5. 输出第 6 轮报告 + 手册 §9.11.9。

### F. 假设

1. **B2**：`ROOT` 在 `mock-llm-server.ts` 里只被定义一次，删后 `path` 若还有其他用途则保留 import——先查再删。
2. **C4/C5 的失败策略**：损坏的 config/baseline 应「明确报错并提示删除」而不是静默回退默认值；这对 benchmark 是更安全的行为。
3. **C9 的注释剥离**：只处理 `//` 行内注释；`/* */` 块注释保持现状（config.jsonc 实际只用了 `//`）。
4. **D 组不动**：测试脚手架的重复实现不在产品路径上，且跨模块系统。

---

## 第 7 轮：build/lib + test/smoke + build/next

> 编制时间：2026-11-18 09:20（Asia/Shanghai）
> 依据：HEAD `6547a250`（工作树 clean）。本轮派 3 个子智能体（其中 `scan-build-lib` 首次失败，重派 `scan-build-lib-2`），覆盖此前未逐行扫过的 `test/smoke/src/**`、`build/next/**`、`build/lib/**`（顶层 48 文件）。
> 按既定约定：不确定处不提问，写出问题 + 推荐方法后按推荐方法执行。功能改动与清理改动**分开提交**。

### 0. 扫描结论概览

| 区域 | 死文件 | 死符号 | 残留 | 真实 bug | 假守护 |
|---|---|---|---|---|---|
| `test/smoke/src/**` | 2（+1 孤儿 .sh +2 .pac） | 3（+5 冗余导出） | 14 | 12 | 11 |
| `build/next/**` | 0 | 3 冗余导出 | 1 注释 | 3 | 0 |
| `build/lib/**` 顶层 | 2 | 0 | 0（i18n 已净） | 3 | 0 |

主智能体逐条复核：删掉低置信项、确认「已删目录残留」里 `vs/sessions`/`devTunnels`/`agentsWindow` 字面量均为 0（仅 "Agents Window" 显示名注释），`build/next` 入口链路 10 个文件全部活（由 `build/lib/esbuild.ts:28/52` 字符串 spawn）。

### A. 清理：死文件（7 个文件，零引用证据）

| # | 位置 | 判定依据（含动态/字符串引用） | 风险 |
|---|---|---|---|
| A1 | `build/lib/screenshotBlocksCi.ts` + `build/lib/screenshotDiffReport.ts` | `git grep -n` 排除自身后 **0 命中**；`.github/` 已删（`git ls-files .github` 空）；package.json 79 scripts 无 `screenshot/diff/blocks/report`；`screenshotComment.test.ts:8` 只 import `screenshotComment.ts`；唯一反向依赖是 `screenshotDiffReport.ts:29 → screenshotComment.ts`（删后 screenshotComment.ts 仍被其 test 用） | 低：两个独立 CLI，若仓库外 CI 直接 `node build/lib/xxx.ts` 调用则 grep 看不到，但本仓无任何证据 |
| A2 | `test/smoke/src/networkProxy/pacServer.ts` + `negotiateAuthHelper.ts` | 全仓唯一引用是 `test/smoke/scripts/run-agents-window-network-proxy.sh:234,253`；该 .sh **自身零引用**（`git grep` 无命中、package.json 无 script、`smoketest` script 不调它、名字里的 agentsWindow 已删）→ 整条是孤链 | 低 |
| A3 | `test/smoke/scripts/run-agents-window-network-proxy.sh` + `test/smoke/network-proxy/test.pac` + `test-kerberos.pac` | 与 A2 同链；2 个 .pac 只被该 .sh 的 `FIXTURE_DIR`/`PAC_FILE` 引用，除此之外全仓 0 命中 | 低 |
| A4 | `test/smoke/src/utils.ts:82 describeRepeat`、`:88 itRepeat`、`:347 retryWithRestart` | `git grep` 排除定义文件后 **0 命中**；删后 `import { Suite, Context } from 'mocha'` 的 `Suite`/`Context` 仅这 3 个函数用（`:56/:74/:106` 的 Suite/Context 是普通文本），可一并删 import | 无 |

**不删（有依据）**：`utils.ts` 的 `buildCopilotChatToken`(:243)/`getCopilotRuntimeLogDir`(:325) 虽无外部 import 但文件内自用（`:305/:512`），只是「可降级导出」；`build/next/build-fast.ts` 的 `BuildFastPlan`/`BuildFastPrerequisites`、`nls-plugin.ts` 的 `NLSPluginOptions` 同为内部类型导出，删除无收益。

### B. 清理：冗余配置（惰性，等价清理）

| # | 位置 | 内容 | 判定 | 风险 |
|---|---|---|---|---|
| B1 | `test/smoke/src/shard.ts:24,25,27,28,30,32` | `suiteDurations` 里 6 条 "Agents Window (...) AgentHost/Codex" 条目 | 对应套件已随 agentsWindow 删除 → `suiteDurations.get(title)` 永不命中、回退 `defaultSuiteDuration=20`，仅让分片估算失衡 | 低 |
| B2 | `test/smoke/src/shard.ts:42` + `:76` | `firstShardSuite = 'Agents Window (WSL Dev Container AgentHost)'` | 该套件不存在 → `assignments` 里 `suite.title === firstShardSuite` 恒 false；注释放的「pr-win32 只在首片装 WSL」契约本身已失效 | 低（删后行为与「永不命中」严格等价） |

### C. 真实 bug（本轮修 13 处；2 处记为存疑保留）

| # | 位置 | 类型 | 问题 / 触发 | 严重度 | 推荐修法 |
|---|---|---|---|---|---|
| C1 | `test/smoke/src/areas/search/search.test.ts:19-20` | 浮空 Promise | `after()` 两次 `retry(...)` 既不 await 也不 return → git 清理与后续套件并发、失败成 unhandledRejection | **高** | `await Promise.all([retry(...), retry(...)])` |
| C2 | `test/smoke/src/utils.ts:215-216` | TDZ | `const instance = new sqlite3.Database(dbPath, cb => resolve(instance))`；cb 同步时 `instance` 仍在 TDZ → 掩盖真实 ENOENT | 中 | `let instance: sqlite3.Database;` 先声明再赋值 |
| C3 | `test/smoke/src/areas/terminal/terminal-splitCwd.test.ts:33-35` | 未 await | `page.keyboard.down('Alt')`/`up('Alt')` 无 await，点击夹中间 → Alt 卡住污染后续用例 | 中 | 全部 await + try/finally 保证 up |
| C4 | `test/smoke/src/areas/terminal/terminal-tabs.test.ts:61-63` | 未 await | 同 C3 的 alt-click 分支 | 中 | 同 C3 |
| C5 | `test/smoke/src/areas/chat/shellScenarios.ts:96` | 正则未转义 | `new RegExp(\`...${reply}\`)` 直接插值；reply 含 `.`/`(`/`[` 时静默不匹配 | 中 | `reply.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` |
| C6 | `test/smoke/src/areas/browserView/browserView.test.ts:101-104` | 空引用 | `after` 里 `await mockServer.close()`；若 `before` 在赋值前抛错，mockServer 为 undefined → 掩盖原始错误成 TypeError | 中 | `await mockServer?.close()` |
| C7 | `test/smoke/src/areas/browserView/browserView.test.ts:543` | 正则未转义 | `new RegExp(\`...\\s+${title}\`,'i')` title 未转义且无词边界 → 前缀相同的多标题匹配错页 | 低 | 转义 title + `\b` |
| C8 | `build/next/index.ts:620` | JSON.parse 无保护 | `JSON.parse(mapFile.text)`；.map 损坏/被插件改写时抛 SyntaxError，只落到通用 "Build failed" | 低 | try/catch 带文件名报错 |
| C9 | `test/smoke/src/areas/policy/nativePolicy.ts:41` | JSON.parse 无保护 | `JSON.parse(fs.readFileSync(productPath))`；product.json 坏/空时裸 SyntaxError 无路径上下文 | 低 | try/catch 带 productPath |
| C10 | `build/next/test/nls-sourcemap.test.ts:44-56` | 资源泄漏 | `mkdtemp` 后若 `esbuild.build` 抛错，未返回 cleanup → tmpdir 永久残留 | 低 | 失败时 `fs.rmSync(tmpDir,...)` 后 rethrow |
| C11 | `build/lib/fetch.ts:155` | JSON.parse 无保护 | `through2.obj(async (file,_enc,cb)=>{ JSON.parse(...) })` 在内层 try 之外；GitHub API 返回 403 HTML/空 body → 回调抛错、cb 不调用、流挂起 | **中高** | 整个回调体 try/catch，`catch(e){ cb(e); }` |
| C12 | `build/lib/util.ts:234` | JSON.parse 无保护 | `fs.readFile` 回调里 `f.sourceMap = JSON.parse(contents)`；`cb(err)` 只覆盖读文件；.map 损坏 → 异常逃出、流挂起 | 中 | try/catch 后 `cb(error)` |
| C13 | `build/lib/compilation.ts:297` | cwd 当仓库根 | `checkApiProposalNames(process.cwd())`；从子目录启动 gulp → ENOENT/误判 | 中 | 改 `path.dirname(path.dirname(import.meta.dirname))`（对齐 util.ts:20 / electron.ts:30） |

**存疑保留（2 处，分析后按推荐方法「保留 + 说明」处理）**：
- `build/next/index.ts:759` `gulpWatch('src/**', { base: srcDir })` 的 glob 相对 cwd、`base` 却是绝对路径 → 非仓库根执行 `--watch` 会监听空目录。修法（传 `cwd`）会改 watch 行为，需要真机/长驻验证，本轮不动。
- `test/smoke/src/areas/chat/copilotCli.test.ts:224` `process.env.XDG_STATE_HOME` 取 runner 环境而非 app 的 `extraEnv` → 诊断永远读用户真实 `~/.copilot`。但**该套件唯一用例 `it.skip`、调用的 `smoketest.openCopilotCliChat` 命令在 src 已不存在、仍起停 mock server**，属「被测对象已消失的死测试」；整块删除会牵连 `main.ts:32,465` 注册与共享的 `getCopilotSmokeTestEnv`，属测试裁剪，需单独决策。本轮不动。

### D. 测试假守护（11 处，保留 + 说明，不擅自启用）

| 位置 | 形态 | 决策 |
|---|---|---|
| `task/task-quick-pick.test.ts:42,47,52` | `(options?.skipSuite ? it.skip : it.skip)` 两支恒 `it.skip` | 上游笔误，但「修成 `it : it.skip`」会启用 3 个从未跑过的 smoke 用例（行为变更、需真机验证）→ **保留**，仅记为已知 |
| `terminal/terminal.test.ts:48` | `setupTerminalStickyScrollTests({ skipSuite: true })` 硬编码 | 上游有意禁用 → 保留 |
| `accessibility:56,141`、`extensions:19`、`terminal-persistence:104`、`copilotCli:69` | `it.skip` 无原因 | 上游有意禁用 → 保留 |
| `workbench/launch.test.ts:21-24` | 只断言「不抛错」 | 启动冒烟本就如此 → 保留 |
| `chat/chatDisabled.test.ts:24-42` | 逻辑矛盾断言 | 上游语义，改需产品决策 → 保留 |

> 依据 AGENTS §7「不得重写上游代码、保持与上游 diff 最小」+「保证行为不变、覆盖率不降」：启用被上游有意 skip 的测试属功能变更，且真机 smoke 由用户执行（§6），本轮不做。

### E. 执行批次

1. **批次 A（清理，单独提交）**：A1-A4 + B1-B2。
2. **批次 B（功能修复，单独提交）**：C1-C13。
3. 门禁：tsc（含 `test/smoke/tsconfig.json` 的独立校验）→ `build-dsh-tests` → `test-dsh:all` → `verify:dsh-ide-ci` → `npm run compile`；对改动的 JS/TS 逐个 `node --check` / TS parse。
4. 输出第 7 轮报告 + 手册 §9.11.10。

### F. 假设

1. **删 screenshot CLI 安全**：本仓无 `.github/`、无 npm script、无 test import；独立 CLI 的「仓库外调用」无证据，属合理推断。
2. **删 networkProxy 孤链安全**：`.sh` 与 2 个 `.pac` 只互相引用，agentsWindow 已删，无任何 workflow/script 调用。
3. **删 shard.ts 条目等价**：套件不存在 → 条目/`firstShardSuite` 永不命中，删除不改变任何实际分片结果。
4. **C13 的仓库根推导**：`build/lib/compilation.ts` 在 `build/lib/` 下，向上两级即仓库根，与 `build/lib/util.ts:20` 一致。
5. **假守护保留**：上游有意 skip，启用属功能变更且需真机，按 AGENTS §6/§7 不做。

---

## 第 8 轮：已删目录的剩余引用 + chatContracts 死导出

> 编制时间：2026-11-18 10:20（Asia/Shanghai）。起点 `1bb666d7`。
> 子智能体：`scan-agentswindow-config`、`scan-src-residue`、`scan-round8-extra`（默认路由；可用模型只有 `workbuddylocal/cli2api`，不能作 child 路由）。
> 按约定写出问题与推荐方法后直接执行，不提问。

### 0. 扫描结论

| 区域 | 结论 |
|---|---|
| 六条已删路径 grep（`agentHost` / `sessions` / `copilot` / 已删 DSH 符号 / `vscode-1.143.1`） | 去重 52 处：**a=0**（没有 import / readFile / spawn 会真失败）/ b=37 注释或惰性配置 / c=15 测试夹具或反向断言 |
| `extensions/*/package.json` 的 `enabledApiProposals` | 63 条 / 58 个名字，缺 d.ts = **0** |
| `agentsWindow` 配置 | 代码层仍有效：`configurationExtensionPoint.ts` 仍校验 proposal，`configurationService` 在 `isSessionsWindow` 时读 override。不整组删除 |
| chatContracts 抽查 | 5 个导出名全仓只出现在定义处，字符串值也同样只一处 |

### A. 本轮删除（清理）

| # | 位置 | 类型 | 判定依据 | 风险 | 推荐 |
|---|---|---|---|---|---|
| A1 | `.eslint-plugin-local/code-no-private-agent-host-meta-import.ts` + `tests/code-no-private-agent-host-meta-import.test.ts` + `eslint.config.js` 注册行 | 死规则 | 规则只匹配已不存在的 `src/vs/platform/agentHost/common/meta`。全仓引用只有这三处。index 与测试脚本都是目录 glob | 低。删掉一条永不命中的 import 边界 | 三件套一起删 |
| A2 | `eslint.config.js` 的 `'vs/sessions/~'` | 冗余白名单 | `from 'vs/sessions` 全仓 0 命中 | 低。以后若有人再写这种 import，lint 会报错，这是对的 | 删这一行 |
| A3 | `test/unit/node/index.js` 的 `**/vs/sessions/test/web.test.js` | 冗余排除 | 该测试文件不存在，排除项永不命中 | 低 | 删这一行 |
| A4 | `product.ts` JSDoc 里的 `agentHost/node/claude/roadmap.md` 两行 | 过期注释 | `Test-Path` 为 false，且该目录 0 个 tracked 文件 | 低。只删这两行，不改写其余英文 | 删这两行 |
| A5 | `AH_META_WORKSPACE_CONVERSION_QUARANTINED_DB_KEY` | 无引用符号 | 标识符与字符串值 `agentHost.workspaceConversionQuarantined` 都只在定义处 | 低。没有读者，删常量不改变运行时 | 删常量及注释 |
| A6 | `SESSION_CHECKPOINT_REPOSITORIES_METADATA_KEY` | 无引用符号 | 标识符与 `agentHost.checkpointRepositories` 都只在定义处 | 低 | 删常量及注释 |
| A7 | `supersedeTitleGenerationStrategyForLegacyUpdate` | 无引用符号 | 全仓 1 次。连带只被它使用的 `IRootConfigChangedAction` import | 低。相邻的 migrate / resolve 仍保留 | 删函数和多余 import |
| A8 | `createUnknownAgentHostClientTelemetryContext` | 无引用符号 | 全仓 1 次。所用 enum / interface 在同文件仍被其它导出使用 | 低 | 只删函数 |
| A9 | `getPolicyUnavailableLocalAgentHostProviders` | 无引用符号 | 全仓 1 次。`isLocalAgentHostProviderDisabledByPolicy` 仍被 8 个调用点使用，保留 | 低 | 只删这个函数 |

### B. 本轮修复（功能，单独提交）

| # | 位置 | 类型 | 判定依据 | 风险 | 推荐 |
|---|---|---|---|---|---|
| B1 | `agentSessionsService.ts` 归档回调 | 未捕获 Promise | `cancelCurrentRequestForSession` 在 `chatService.ts` 声明为 `Promise<void>`，实现是 async。`void` 调用没有 catch | 中。归档时取消失败会变成 unhandled rejection | `.catch(onUnexpectedError)` |
| B2 | `agentHostSessionInputPills.ts` 复制分支名 / 复制 commit hash | 未捕获 Promise | `IClipboardService.writeText` 返回 `Promise<void>` | 低 | 同上 |
| B3 | 同文件打开 browser pill | 未捕获 Promise | `_openBrowser` 是 async，内部 `await openEditor` | 中低 | 同上 |
| B4 | 同文件外链 opener、预览文件、内部 opener | 未捕获 Promise | `IOpenerService.open` 返回 `Promise<boolean>`；`openChatTurnFile` 是 async | 低 | 同上 |

### C. 存疑保留（本轮不改）

| # | 位置 | 为什么不动 |
|---|---|---|
| C1 | `agentsWindow` proposal、`extensions/git/package.json` 的 9 处 override、`editorConfigurationSchema` 6 处、`workbench.contribution.ts` 21 处 | `isSessionsWindow` 仍从 environment 读取，配置服务仍消费 `schema.agentsWindow`。整组删除会让 tsc 失败，也改变仍可达的窗口模式。单独删 git 的 `enabledApiProposals` 会让 `configurationExtensionPoint.ts` 对 9 个属性报 `collector.error` |
| C2 | `agentsWindowInvitation.ts` 及 native / editor 引用 | 不是孤岛，删文件会断 import。`claim/mark/release` 没有 UI 调用点，但要成组下线 |
| C3 | 52 处已删路径里的注释、`NOTICE.md`、四份 `PROVENANCE.md` | AGENTS §5 禁止改凭据；§7 不改写上游英文注释。`dshBundleStaging.test.ts` 的 `assert.doesNotMatch` 是有意反向断言 |
| C4 | `agentHostStarter.config.contribution.ts` 注释里列出的 main/server side-effect import | 实际只剩 `chat.shared.contribution.ts` 在 import。改注释属于改写上游英文；补回 main/server import 是功能变更，没有已证实的失败 |
| C5 | `extensions/npm/package.json` 的 `capabilities.agentsWindow.supported` | 仍被 `extensionManifestPropertiesService` 和测试读取 |
| C6 | pill 里 `run: () => this._clipboardService.writeText(...)`（把 Promise 交回 action runner，不是 `void`） | 扫描未证明 runner 会丢掉 rejection。不扩大到未证实的调用点 |

### D. 假设

1. **ESLint 规则三件套可原子删除**：index 用 `glob.sync(*.ts)`，`build/package.json` 的 test 用目录 glob，删文件后两者都不再收集。
2. **两个元数据 key 没有动态读者**：标识符和字符串值的 `git grep` 都只有定义处。
3. **`onUnexpectedError` 是正确的失败去向**：同目录 `agentSessionsControl.ts` / `localAgentSessionsController.ts` 已经这么用。
4. **不删 `agentsWindow` 基础设施**：proposal d.ts 仍在，`checkApiProposalNames` 会对照 `extensionsApiProposals.ts`。删 d.ts 而不重写注册表会让 `core-ci` 失败。

---

## 第 9 轮：会话绑定竞态与关窗后的开窗分发

> 起点 `69ff996c`。默认子智能体路由复核；`workbuddylocal/cli2api` 不能作为本会话的 child 路由。
> 先写清单再按推荐方案改。没有新的删除。

### A. 本轮修复

| # | 位置 | 类型 | 判定依据 | 风险 | 推荐 |
|---|---|---|---|---|---|
| A1 | `dshChatSession.ts` `bind` | 迟到回包覆盖新会话 | 独立复现：先 `bind('A')` 挂起，再 `bind('B')` 完成，A 的快照随后到达，待办从 B 变成 A。修复前 FAIL | 中。快速切换会话会串内容 | 记下代次；代次变了就丢弃回包，且失败不得回滚更新的绑定 |
| A2 | 同函数，同一 id 并发 | 假成功 | 第一次 `bind('A')` 尚未返回时，第二次因为 id 已经写上就返回 true。rebind 实际失败时得到 `[false, true]` | 中。调用方以为绑定成功 | 有绑定在飞时禁止这条短路 |
| A3 | `refreshComposer` | 迟到目录覆盖 | 先发起的 `composerState` 在 `bind('B')` 之后才返回，模型选择从 B 变回 A。修复前 FAIL | 中 | 等待前记下代次和会话 id，不一致就丢弃 |
| A4 | `dshIdeLaunchListener.ts` `tick` | dispose 之后仍分发 | `register` 尚未完成时 dispose 看不到 `registered`，不会注销；随后的 poll 仍调用 `onLaunch` | 中。关窗后仍可能打开窗口 | dispose 后补注销，并且 poll 返回时若已 dispose 就不再分发 |

### B. 复核后排除（不是本轮缺陷）

| # | 位置 | 为什么排除 |
|---|---|---|
| B1 | `dsh.contribution.ts` 里多处 `void refreshCapabilities()` / `void openView().then` | `client.call` / `openView` 自己把通道拒绝收成 `{ ok: false }`。调用处没有 `.catch` 不等于会变成未处理拒绝 |
| B2 | `dshIdeSessionsService.refresh` | `DshIdeSessionListModel.refresh` 内部已经 catch，失败只保留旧列表 |
| B3 | `fillOlderHistory` | `loadOlder` 自己 catch 并返回 false |
| B4 | `test/automation/src/chat.ts` 的 `acceptToolConfirmationIfPresent` | 同文件第 187 行仍在调用，不能删 |
| B5 | 根 `package.json` 79 个 script | 所谓缺文件是把 `tsconfig.json` 截成了 `.js`。实际路径都在 |
| B6 | 第 8 轮删除的 meta ESLint 规则 | 旧目录确实不存在。新目录 `src/vs/platform/chatContracts/common/meta` 仍有 `copilotd/` 与 `vscode/`，顶层适配仍在调用。把规则改指向新目录会改变 lint 行为，本轮不擅自加 |

### C. 假设

1. 代次是会话绑定的唯一作废条件。`loadOlder` 与 `refreshSkills` 已经这么做，`bind` 和 `refreshComposer` 补上同一规则。
2. 同一目标的第二次 `bind` 不复用第一次的 Promise，而是让第一次过期。两边都得到真实结果，而不是提前成功。
3. 测试数量从 391 增到 395 只说明新增了 4 条断言。本轮没有跑覆盖率工具，不能据此声称覆盖率百分比不变。

---

## 第 10 轮：会话列表归档标志与重叠刷新

> 起点 `49802d5b`。可用模型仍只有 `workbuddylocal/cli2api`，不能作 child 路由。默认路由派 `scan-handbook-910`（中途失败，主智能体自己核对了协议）和 `scan-one-dsh-bug`（完成）。

### A. 本轮修复

| # | 位置 | 类型 | 判定依据 | 风险 | 推荐 |
|---|---|---|---|---|---|
| A1 | `dshAgentSessionsController.ts` `applyArchived` / `toSessionItem` | 刷新丢掉归档标志 | `IDshIdeSessionSummary` 没有 `archived`。`archiveSession` 回包是完整 id 数组（`dshIdeArchiveSet.js`），控制器原先丢掉 `result.value`，只改当前行。下一次 `refresh` 用新树替换 `_items` | 中。归档菜单状态和 Host 集合不一致 | 保存 id 集合，刷新时再标上。坏回包不把集合清掉 |
| A2 | 同文件 `refresh` | 旧名单覆盖新名单 | 两次 `refresh` 没有代次。慢的那次在快的那次之后写入 `_items` | 中。面板停在过期会话 | await 之后若代次变了或 token 已取消，直接返回 |

### B. 排除

| # | 项 | 为什么不做 |
|---|---|---|
| B1 | 为已不在 `listSessions` 里的归档 id 补一行 | 没有证明名单会丢掉已归档会话。补行会造出 Host 没返回的会话 |
| B2 | 直接单测 `DshAgentSessionsController` 类 | 该模块会加载浏览器 CSS 和 `window`。断言放在 `dshSessionTree.ts` 的纯函数上，控制器调用它们 |
| B3 | §9.10 再改契约 | 代码已是方案一：wireRevision 4，capabilities 是独立 method。只改手册标题 |

### C. 假设

1. 成功回包的 `value` 是字符串数组时，它就是完整集合，可以替换本地集合。
2. 代次只保证后完成的旧请求不写 UI。先发出的请求若在 Host 上后执行，仍可能改 Host 状态；本轮只修 IDE 侧显示。

---

## 第 11 轮：未读点、交付物路径、迟到的发送和换模型

> 起点 `9aff69f9`。可用模型只有 `workbuddylocal/cli2api`，不能作 child 路由。默认路由派 `scan-r13-race` 与 `scan-r13-handbook`。本轮先补跑上一提交的 CI 和 compile，再按推荐方案改。

### A. 本轮修复

| # | 位置 | 类型 | 判定依据 | 风险 | 推荐 |
|---|---|---|---|---|---|
| A1 | `dshChatSession.ts` `submit` | 迟到失败清掉新会话的 running | 失败分支在 await 之后无条件 `setRunning(false)`。绑定 B 并标成运行中之后，A 的失败回包会把它清掉 | 中 | 记下代次和会话 id，变了就不再写 running |
| A2 | 同文件 `selectModel` | 迟到成功覆盖新会话的模型 | await 之后直接写 `_current`。`refreshComposer` 的代次检查会被这次写回盖掉 | 中 | 同样先对代次和会话 id |
| A3 | `toSessionItem` / `sessionReadState` | 刷新冲掉已读，更新也不标未读 | 手册 §9.5 2-C 说没有未读点。原生 `!isRead()` 就是实心圆点。`isRead === undefined` 在提供者拥有已读状态时被当成已读 | 低。第一次出现的历史会话不会全部变未读 | 时间戳变大才写 `isRead: false`；没变则保留上一行的已读 |
| A4 | `dshChatHistory.ts` `appendDeliverables` | 绝对路径交付物点不开 | `reference` 可以是 URI。字符串只做标签，`getResourceForElement` 返回 null | 低 | 绝对路径用 `URI.file`。相对路径仍是字符串 |

### B. 排除

| # | 项 | 为什么不做 |
|---|---|---|
| B1 | `cancel` / `answerApproval` / `answerQuestion` | await 之后不写本地状态。批准和问卷的删除发生在 await 之前 |
| B2 | `planReview` / `changesSummary` / `multiDiffData` | 计划只有 active/pending，交付物没有 diff。空 diff 会假装有变更 |
| B3 | 给全部历史会话打未读 | 没有「上次看到的时间」。第一次出现继续不写 isRead |

### C. 假设

1. `timing.created` 存的就是 `updatedAt`。比较它等于比较会话更新时间。
2. 时间戳变小或相等不标未读，避免时钟回拨把已读会话打成未读。
3. Windows 上 `URI.file` 会把盘符收成小写。测试按不区分大小写比较。

---

## 第 12 轮：已开窗口丢会话、归档菜单、目录回滚、custom 权限

> 起点 `4fa3a82d`。可用模型：`workbuddylocal/glm-5.3-flash`（low/high/max）、`workbuddylocal/hy4flash`（high）。workflow `round12-dsh-scan` 六路只读扫描。本轮按推荐方案改，不另开问题等确认。

### A. 本轮修复

| # | 位置 | 类型 | 判定依据 | 风险 | 推荐 |
|---|---|---|---|---|---|
| A1 | `dshIdeLaunchListener.ts` dispatch；`app.ts` 已有窗口分支 | 逻辑错误 | Host `launch` 把 `sessionId` 放进队列，接单器只抄 `workspace`。已有窗口只 `focus()`，`userEnv` 不会再生效 | 高。IDE 已开时再点会话，窗口停在旧会话 | 接单器转发非空 `sessionId`。已有窗口聚焦后走现成 `vscode:openChatSession`，资源形状与 `dshSessionResource` 相同，由 content provider `bind` |
| A2 | `dshSessionMenu.ts` `dsh.session.archive`；`agentSessionsControl.ts:800-803` | 状态不一致 | DSH 右键只留 `dsh.session.*`，原生 unarchive 被滤掉。自定义归档直接 `call`，不写控制器 `archivedIds`，刷新后标志丢失，且没有恢复项 | 中 | 归档/恢复都走 `IChatSessionsService.setChatSessionItemArchived`。已归档只显示恢复 |
| A3 | `dshComposerSource.ts` `write` / `refresh` | 竞态 | 写成功后的 `refresh` 复用写前的 `composerState`。快照刷新与 `setModel` 重叠时，旧回包把选择盖回去 | 中 | 写成功先作废在途代次，再发一次新的读取 |
| A4 | `dshComposerProjection.ts` `toPermissionItems` | 状态不一致 | `custom` 被滤出选项，但 `current === 'custom'` 仍要显示。选择器找不到 checked 项 | 中 | 仅当当前已是 custom 时把它插回列表。其它权限下仍然不提供「切到 custom」 |
| A5 | `dshLanguageModelProvider.ts` `ensureVendor` | 逻辑错误 | 每次目录刷新都 `delta` 已登记的 vendor，服务侧打 `already registered` 并忽略。dispose 也不撤登记 | 低 | 闭包里记住已登记项，重复刷新不再 delta；dispose 时撤掉本轮加上的 descriptor |

### B. 排除

| # | 项 | 为什么不做 |
|---|---|---|
| B1 | `search()` 把结果读空 | 误报。`client.call` 的 `value` 已是 `{items, hasMore}` |
| B2 | 会话树纯环丢光节点 | 误报。补根循环会留下一个 root。现有测试要求不丢 |
| B3 | 快照投影丢掉 goal.activation | 撤回。官方快照 schema 没有该字段；实时视图的 activation 走另一条投影 |
| B4 | `spawn` 残留 `DSH_IDE_COMPOSER` | 子进程 env 是拷贝，不写回 Host 的 `process.env` |
| B5 | `rebind` 时取消旧会话的 waterfall | 会把仍在跑的会话的批准/问卷取消掉。切走不应结算 |
| B6 | `todosOf` 遇坏项整表缺席 | 有意 fail-closed。缺席表示保留，不把坏帧当成清空 |
| B7 | `deleteSession` 作废在途 refresh | 有意：删除成功后以 Host 重查为准。失败保留旧列表是既有降级 |
| B8 | 菜单 `registerAction2` 的 dispose | 贡献点每个窗口只注册一次。二次注册才会撞命令 id |

### C. 假设

1. `vscode:openChatSession` 收到与 `dshSessionResource` 相同的 URI 后，会进 `provideChatSessionContent` 并 `bind`。这是点击会话行的同一条路。
2. custom 项不加 `locked`。`locked` 会藏起其它权限，用户就无法从 custom 切走。
3. 没有跑覆盖率工具。测试项数增加只说明多了断言。

