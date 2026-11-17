# DSH-IDE 瘦身问题清单（第 1 轮，待确认）

> 编制时间：2026-11-17 18:45（Asia/Shanghai）
> 依据：`docs/DSH-IDE改造开发手册.md` §9.11、AGENTS.md、当前工作区实测。
> 本轮只做扫描，不改代码；所有删除项均给出「位置 / 类型 / 判定依据 / 风险」。
> 判定证据方法：`git grep` 全仓（含 js/mjs/json/md 与字符串字面量）+ 9,222 个 TS/JS 文件的 import 说明符扫描 + gulp staging 清单核对 + 空目录枚举。

## 0. 实测基线

| 项 | 当前值 | 证据 |
|---|---|---|
| 全量 tsc 错误 | **6 条**（手册记录起点 137 条） | `node --max-old-space-size=8192 node_modules/typescript/bin/tsc --project ./src/tsconfig.json --noEmit --skipLibCheck`，输出存 `.build/tsc-current.txt` |
| `npm run test-dsh:all` | **PASS**（mocha 7 + node 389） | 本轮实跑，exit 0 |
| 修改过的 DSH 协议测试 | **PASS**（80 项） | `dshIdeProtocol/dshIdeChannel/dshIdeEndpoints` 三文件实跑 |
| 工作区未提交改动 | **35 个已跟踪文件，+85 / -175** | `git status --short`、`git diff --shortstat` |
| 依赖规模 | dependencies 68、devDependencies 100 | `package.json` |
| 锁文件 | 1,166 个包名，其中 **162 个存在多版本**（glob 6 版、commander 6 版、minimatch 5 版…） | `node` 解析 `package-lock.json` |

**判断：** 工作区里已存在一批评审前的 §9.11 类型修复（137→6），但尚未提交；其中 `chatWidget.ts`、`gettingStartedService.ts`、`terminalService.ts` 等属于「删死代码」而非纯类型对齐，提交时必须与功能/类型改动分开。

## A. 未提交改动盘点（必须先定性再提交）

| # | 范围 | 文件数 | 性质 | 风险/备注 |
|---|---|---|---|---|
| A1 | `agentHostChatInputPicker.ts` 把未定义的 `CODEX_APPROVALS_LEARN_MORE_URL` 回退到 `PERMISSIONS_LEARN_MORE_URL` | 1 | **功能修复**（原符号不存在，运行到即 ReferenceError） | 低；单独提交 |
| A2 | `agentHostCustomizationService.ts` 补 `IAgentHostMcpServer` 结构、`sessionTargetPickerActionItem.ts` 类型名笔误、`aiCustomizationManagementEditor.ts` 断言、`web.main.ts`/`desktop.main.ts` 构造参数、`tunnelProxy.ts` 断言、6 个测试 mock 签名 | 11 | **类型对齐，不改运行时** | 低 |
| A3 | 仅删除未使用 import/字段/函数的 18 个文件（`chatWidget.ts` 含 `_getGenerateInstructionsMessage` 整组、`gettingStartedService.ts` 含两个媒体路径函数、`terminalService.ts` 等） | 18 | **清理改动（死代码）** | 低；但见 G1 的测试残留 |
| A4 | 3 个 DSH 协议测试的 wireRevision 5→4、method 42→43 | 3 | **测试对齐**（HEAD `ce668543` 改了契约但漏改测试） | 低；不修则测试必挂 |
| A5 | `AGENTS.md` 源码参考由本机 `E:/deepseek-harness/` 改为在线 GitHub | 1 | 文档 | 无 |

> 结论：A1 单独一个提交；A2 一个提交；A3 一个清理提交；A4 一个测试提交；A5 一个文档提交。这样满足「功能改动与清理改动分开提交」。

## B. 剩余 6 条 tsc 错误（手册 §9.11 第四/五类）

| # | 位置 | 类型 | 判定依据 | 建议与风险 |
|---|---|---|---|---|
| B1 | `src/vs/platform/environment/node/argv.ts:50,14` | TS2741：`OPTIONS` 缺 `agents` 项 | `NativeParsedArgs` 有 `agents?: boolean`（`common/argv.ts:57`），但 `OPTIONS` 没有对应项——接口与解析表已经不一致 | 手册要求删字段。**但** `--agents` 仍有 4 个生产方：`build/lib/policies/exportPolicyData.ts:76`、`.vscode/launch.json:323`、`.vscode/tasks.json:565`、`src/vs/platform/workspaces/electron-main/workspacesHistoryMainService.ts:406`，且全仓无读取点。删字段=保持现状（该参数目前就被当 unknown option），低风险；若改补 `OPTIONS` 项反而让参数「变成合法」，是行为变化。**建议按手册删字段** |
| B2 | `src/vs/platform/tunnel/node/tunnelProxy.ts:203,3` | TS2322：`createConnection` 返回 void 与 Node 类型不符 | Node 在 `oncreate` 回调模式允许返回 undefined；实现只走回调 | 按手册加 `as typeof agent.createConnection`（纯类型断言，不改运行时），低风险 |
| B3 | `src/vs/workbench/browser/web.main.ts:488,79`；`src/vs/workbench/electron-browser/desktop.main.ts:335,79` | TS2554：`WorkspaceTrustEnablementService` 期望 0 参，实传 2 参 | 类构造器已是 0 参（`src/vs/workbench/services/workspaces/common/workspaceTrust.ts:71-79`） | 删两个实参，低风险 |
| B4 | `src/vs/workbench/api/test/browser/extHostNotebookStatusCommands.test.ts:37,22` | TS7022：`converter` 自引用推断为 any | `override readonly converter = new CommandsConverter(this, ...)` | 给 `converter` 显式类型、`this as ExtHostCommands` 打破推断环，测试专用，低风险 |
| B5 | `src/vs/workbench/contrib/chat/test/browser/accessibility/chatAccessibilityHelp.test.ts:31,189` | TS2554：期望 3-12 参，实传 13 | 多出的 `undefined` 使 `sessionWorkingSetEnabled` 错位；删掉第 11 个 `undefined` 后正好 12 参且语义正确 | 低风险 |
| B6 | `src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts` 相关测试 | 见 G1 | 运行时测试残留，不是 tsc | 见 G1 |

## C. 无争议删除候选（低风险，建议本轮执行）

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

## D. 重复实现（分三级，部分建议保留）

| # | 位置 | 类型 | 判定依据 | 建议 |
|---|---|---|---|---|
| D1 | `dshComposerProjection.ts:25` 与 `dshLanguageModelProvider.ts:30` 各声明 `DSH_MODEL_VENDOR = 'dsh'` | 重复常量 | 两处同值、同名、同导出；后者仅本文件用 | 合并为一个来源（从 `dshComposerProjection` 导入），低风险 |
| D2 | `isRecord` 六份：`dshIdeConversation.ts:498`、`dshIdeProjections.ts:136`、`dshIdeComposer.js:133`、`dshIdeRequestView.js:159`、`dshIdeTransport.ts:351`、`dshChatModel.ts:543` | 重复代码 | 函数体逐字相同（`typeof === 'object' && !== null && !Array.isArray`） | **建议保留**：跨 Host-side JS / electron-main / workbench 三层，抽公共模块要改 staging 与边界门禁，收益小于风险；在报告中记为「存疑保留」 |
| D3 | `stringOf`/`numberOf`：`dshIdeConversation.ts:522-528` 与 `dshChatModel.ts:692-698` | 重复代码 | 逐字相同 | 同上，跨 platform/workbench 层；建议保留或单列小任务，不在本轮 |
| D4 | 计时：`dshSessionItemState.ts:55 timingForRunning`（仅测试引用）、`dshSessionTree.ts:37 sessionTimingForRunning`（零引用）、`dshAgentSessionsController.ts:307-331` 内联实现 | 功能重复 | 三处语义相同但第三处要保留旧时间戳，不能直接替换 | 删 D4 中的 `sessionTimingForRunning`（C8）；`dshSessionItemState` 模块见 Q4 |
| D5 | `dshIdeSessionListModel` + `dshIdeSessionsService` 列表链 vs `dshAgentSessionsController` 列表链 | 功能重复 | 文档已注明：Session 面板实际走 controller；旧链只被 `dsh.contribution.ts:158 createSession()` 与搜索命令复用，不供列表 UI | **建议保留**：删旧链会改 createSession/search 行为；记入存疑保留 |

## E. 依赖（按证据分三档）

| # | 包 | 档 | 证据 | 风险 |
|---|---|---|---|---|
| E1 | `merge-options`、`os-browserify` | **确定删除** | 全仓 import 扫描 0 命中；git grep 仅 package.json/lock；属已删除的 rspack/vite 时代 polyfill | 低 |
| E2 | `@playwright/cli`、`@vscode/test-cli`、`@vscode/telemetry-extractor` | **建议删除** | 全仓 import 0 命中、git grep 除锁文件外 0 命中；对应工具/流水线已在 `edfd09bf` 删除 | 低 |
| E3 | `@vscode/component-explorer`、`@vscode/component-explorer-cli` | **待决策 Q1** | 仍被 `test/componentFixtures/*.json/.mts`、`.vscode/tasks.json:647` 引用；若删依赖必须同时删夹具与任务 | 中 |
| E4 | 根 `@hpke/core`、`libsodium-wrappers` | **待决策 Q5** | 根 `src/**`、`extensions/**` 无 import；`node_modules` 内 1,648 个包的依赖/peerDependencies 里也**没有**任何包要求它们（脚本穷举）；仅 `eslint.config.js:1790-1791` 还给它们开白名单；`remote/package.json` 也各声明一份 | 中低：纯冗余声明，但需同步改 `remote/package.json`；删后跑 `npm ls` 与 `compile` 验证 |
| E5 | 锁文件内 162 个包存在多版本（glob 6 版、commander 6 版、minimatch 5 版、node-addon-api 4 版…） | **不处理** | 全部为传递依赖；去重需要升级/覆盖版本，违反「不升级依赖」红线 | — |
| E6 | `playwright-core`：根固定 `1.61.0-alpha-2026-06-04`，`@playwright/test` 带 `1.61.1` | **报告不处理** | 两个版本并存；根版本被 `browserView` 直接使用，换版本属升级 | — |

## F. 配置 / 资源 / 注释

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

## G. 测试与行为漂移（必须处理，避免门禁假绿）

| # | 位置 | 问题 | 判定依据 | 建议 |
|---|---|---|---|---|
| G1 | `src/vs/workbench/contrib/chat/test/browser/widget/chatWidget.test.ts:983-1038` | 仍期待 `Build with Agent` 标题与 `_getGenerateInstructionsMessage` 调用 3 次；DSH 集成后欢迎页标题已是 `Chat`、附加文案是「输入消息开始，由 DSH 处理。」，且方法已被删 | 当前 `chatWidget.ts:1749` 与 `:1659`；测试对象按原型构造，运行会失败 | 改写该测试为 DSH 文案断言，或删除该过时 case；属清理/测试改动，单独提交 |
| G2 | `build/lib/test/dshIdeProtocol.test.ts` 新测试后多一个空行 | 风格 | 文件内连续两空行 | 随手修 |
| G3 | 覆盖率 | 无 DSH 专用覆盖率脚本 | `package.json` 无 c8 的 DSH 入口；`test-dsh:all` 只统计通过数 | 以「测试项数不降」作为等价门禁；如需真实覆盖率，需另建脚本（不新增依赖，用现有 c8），请确认 |

## H. 存疑保留项（请逐项决策）

- **Q1 component-explorer 整套**：删依赖+夹具+`.vscode` 任务（约 20 个文件、2 个 devDeps），还是只删任务保留夹具？
- **Q2 `dshSessionItemState.ts` + 测试**：生产零引用、仅测试引用；删模块+测试（约 5 KB、5 个测试），还是保留作为纯函数契约？
- **Q3 `build/lib/dsh/CHAT-RENDER.md`**：删除 / 重写为当前原生渲染说明 / 保留作历史？
- **Q4 `agents` 参数**：按手册删 `NativeParsedArgs.agents`（保持现状、低风险），还是补 `OPTIONS` 项（消除类型错误但让参数变合法，行为变化）？
- **Q5 根 `@hpke/core`、`libsodium-wrappers`**：是否允许我继续做动态引用取证后删除？
- **Q6 `.vscode` 里 `build/vite` 的启动项/任务**：删除还是保留（可能有人仍用 Monaco Vite 调试）？

## I. 建议执行批次（确认后执行）

1. **批次 0（收尾在途类型修复）**：B1-B5 + A2 + A4 + A5；tsc 必须 0。分开提交：功能修复 1 个、类型对齐 1 个、测试对齐 1 个、文档 1 个。
2. **批次 1（DSH 死代码/资源）**：C1-C4、C8、F4-F6、G2；删 `dshIdeLocationIndex` 时同步改 gulp 与 verify 清单。
3. **批次 2（依赖与脚本）**：C5-C7、E1-E2（Q1/Q5 按决策追加）；`npm install` 更新锁文件，跑 `npm ls` 核对。
4. **批次 3（配置/注释/文档）**：F1-F3、F7（按 Q1/Q3 决策）。
5. **批次 4（测试漂移）**：G1。单独提交。
6. 每批后跑：全量 tsc → `test-dsh:all` → 相关 ESLint → `npm run compile`（构建）；打包按 §0.0 推迟。
7. 最终输出瘦身报告（删除清单/依赖前后/存疑保留/风险与回滚）。

## J. 假设（手册未覆盖处）

1. 「覆盖率不降」在 DSH 侧没有既有覆盖率命令，本轮以 `test-dsh:all` 的测试项数（7+389）与通过率不降作为等价证据；如要真实行覆盖率，需用现有 c8 新增脚本（不新增依赖），请确认。
2. VS Code 上游代码里的类型错误（B2-B5、G1）只做最小类型/测试对齐，不重构上游实现、不升级依赖。
3. 删除仅限 git 跟踪文件；`.build/`、`out*/` 等被 `.gitignore` 忽略的构建产物不计入「仓库瘦身」，如需清理磁盘另列。
4. `PROVENANCE.md`、`LICENSE-DSH` 四份凭据与 `NOTICE.md`、`LICENSE.txt` 一律不删不改。
5. 所有删除先在本轮提交 `chore(cleanup)` 中单独成批，回滚方式为 `git revert <cleanup-commit>`。
