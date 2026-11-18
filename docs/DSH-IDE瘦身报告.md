# DSH-IDE 瘦身与 Bug 修复报告（全轮次）

> 本文件汇总第 1–9 轮每轮的瘦身报告：删除清单及理由、依赖前后对比、存疑保留项、风险与回滚方式。
> 各轮统计均为该轮实测快照；累计值见文末「累计」节。原按轮拆分的 8 份报告已合并入本文件，不再单独保留。
> 配套：`docs/DSH-IDE瘦身问题清单.md`（每轮改动前清单）、手册 §9.11.1–§9.11.10（执行记录）。

---

## 第 1 轮

> 编制时间：2026-11-17 20:30（Asia/Shanghai）
> 依据：`docs/DSH-IDE改造开发手册.md` §9.11、`docs/DSH-IDE瘦身问题清单.md`（第 1 轮）、AGENTS.md
> 起点提交：`ce668543`（capabilities 方案一）
> 终点提交：`36521cd0`（第 1 轮文档）
> 全区间：**92 个文件，+456 / -4,621 行**（26 删除 / 64 修改 / 2 新增）

### 1. 门禁总览

| 门禁 | 结果 | 证据 |
|---|---|---|
| 全量 `tsc --noEmit` | **PASS**（137 → 0） | `node --max-old-space-size=8192 node_modules/typescript/bin/tsc --project ./src/tsconfig.json --noEmit --skipLibCheck` |
| `npm run compile`（全量构建 + 扩展媒体 esbuild） | **PASS** | `Finished 'compile' after 1.67 min`，0 errors |
| `npm run test-dsh:all` | **PASS** | mocha 7 + node **384**，0 fail |
| `verify:dsh-ide-ci`（五项聚合） | **PASS** | 见下 |
| ├ `verify:dsh-ide-protocol-single-source` | PASS | 18 个符号单点声明、依赖单向、无重复 JS 校验器 |
| ├ `verify:dsh-ide-boundary` | PASS | — |
| ├ `verify:dsh-ide-projection-golden` | PASS | 4 个金标准节点 |
| ├ `verify:dsh-ide-contract` | PASS | 4 个注入点指纹一致；`DSH_INSTALLED_VERSION=0.2.2-rc.1` |
| └ `test-dsh:all` | PASS | 384 |
| `npm run transpile-client` | PASS | 7,170 文件，18.7 s |
| `.vscode/{tasks,launch}.json` | PASS | `ts.parseConfigFileTextToJson` 解析通过 |
| `node build/npm/preinstall.ts` | PASS | — |
| `genDshIconDataUris.mjs --check` | **PENDING** | 需 `DSH_ARTWORK_TS` 指向官方 artwork.ts；本机按 AGENTS §3 不保留整仓副本 |
| 全仓 `npm run eslint` | **PENDING** | 既有 `header/header` 报错（DSH 文件版权头为 `DSH-IDE contributors`，HEAD 起即如此，非本轮引入） |
| 浏览器单测 `npm run test-browser` | **PENDING** | 需 Playwright 安装与浏览器环境，按 AGENTS §6 由用户执行 |
| 真机 GUI | **PENDING** | 按 AGENTS §6 由用户执行 |

> **测试项数变化：389 → 384（-5）**。减少项全部来自 `dshSessionItemState.test.ts`（5 个测试）随死模块一并删除，不是覆盖率下降；其余 384 项全通过。

### 2. 删除清单与理由

#### 2.1 源码死模块 / 死资源（4 个文件，8,695 B）

| 文件 | 理由 | 无引用证明 |
|---|---|---|
| `src/vs/platform/dshClient/common/dshIdeLocationIndex.js` | `indexLocations` 零调用；`491d92f0` 改为 typed 状态层后无消费者 | 全仓 `git grep` 仅定义本身 + gulp staging 行（已同步删） |
| `src/vs/workbench/contrib/dsh/browser/dshChatModelDriver.ts` | 7 行注释空壳，无 export、无 import | 全仓仅 verify 清单（已删该行）与反向断言（保留） |
| `src/vs/workbench/contrib/dsh/browser/media/dshModelMenu.css` | `dshModelMenu.ts` 已删，CSS 无任何引用 | 无 CSS import、无路径引用 |
| `src/vs/workbench/contrib/dsh/browser/dshSessionItemState.ts` | 生产零引用；controller 已内联等价逻辑 | 仅 `build/lib/test/dshSessionItemState.test.ts` 引用，测试同步删除 |

#### 2.2 死符号（file-level export 删除）

| 符号 | 文件 | 证明 |
|---|---|---|
| `onDidChangeDshComposerSource` + `listeners` 集合 | `dshComposerRegistry.ts` | 零调用点；`setDshComposerSource` 改为直接赋值 |
| `sessionTimingForRunning` | `dshSessionTree.ts` | 零引用（controller 用内联实现） |
| `AssistantBlockLike` | `dshChatModel.ts` | 零引用 |

> `dshIdeContract.ts` 的 `DSH_IDE_CONTRACT_API_VERSION` / `DSH_IDE_CONTRACT_WIRE_REVISION` **保留**：`verify:dsh-ide-protocol-single-source` 显式断言 `contract must import protocol constants`，删除会让门禁 FAIL。此项从「删除候选」降级为「存疑保留」。

#### 2.3 测试与测试基础设施

| 文件 | 理由 |
|---|---|
| `build/lib/test/dshSessionItemState.test.ts`（2,430 B，5 测试） | 随死模块删除 |
| `build/lib/dsh/CHAT-RENDER.md`（4,258 B） | 描述的 `chatContentParts/dsh/` 目录已不存在，内容与当前原生渲染不符，全仓无引用 |
| `test/componentFixtures/**`（20 文件） | component-explorer CLI 已在 `edfd09bf` 删除，夹具只剩自引用 |

#### 2.4 冗余配置

| 位置 | 内容 | 理由 |
|---|---|---|
| `package.json` | 5 个悬空脚本：`test-agent-host-e2e`、`test-agent-host-e2e-coverage`、`codex:gen-protocol`、`codex:check-protocol`、`verify:dsh-guard-negative` | 目标文件/目录均不存在，脚本必然失败 |
| `package.json` `test-dsh` | 两个 `out/.../chatClient/*.test.{js,mjs}` glob | 源目录与 out 目录都不存在 |
| `package.json` `test-dsh:all` | `dshSessionItemState.test.ts` 条目 | 文件已删 |
| `build/npm/dirs.ts` | `'build/rspack'`、`'build/vite'` | 目录已在 `edfd09bf` 删除；`postinstall` 会按 dirs 逐个 `npm install`，cwd 不存在会失败 |
| `.vscode/tasks.json` | 「Component Explorer Server」「Launch Monaco Editor Vite」2 个任务 | 依赖已删 CLI / 不存在的 `build/vite` |
| `.vscode/launch.json` | 5 个启动项 + Hot Reload 的 `build/vite` URL 与 `preLaunchTask` | 同上 |
| `eslint.config.js` | `test/componentFixtures/playwright/**` 的 layer 规则 | 目录已删 |
| `.gitignore` | `test/componentFixtures/.screenshots/*`、`.playwright-cli` | 对应目录/工具已删 |
| `.eslint-allowed-bracket-notation-files` | **224 条**指向不存在文件（含 89 条 agentHost、90 条 copilot、`build/rspack/...`） | 逐条 `Test-Path` 判定；段落计数同步重算 |
| `.eslint-allowed-javascript-files` | **51 条**指向不存在文件（30 条 copilot、8 条 build 脚手架） | 同上 |
| `build/lib/dsh/verify/dshIdeVerify.mjs` | `uiProjectionFiles` 里的 `dshChatModelDriver.ts` | 文件已删 |
| `build/gulpfile.vscode.ts` | `dshIdeLocationIndex.js` staging 行 | 文件已删 |
| 空目录 5 个 | `dshClient/browser`、`dsh/host`、`dsh/browser/chatClient`、`dsh/test/browser/chatClient`、`chat/electron-browser/agentSessions/media` | 逐目录计数为 0（git 不跟踪，无 diff） |

#### 2.5 依赖（前后对比）

| 项 | 前 | 后 | 差 |
|---|---|---|---|
| `dependencies` | 68 | **66** | -2 |
| `devDependencies` | 100 | **93** | -7 |
| `scripts` | 86 | **81** | -5 |
| `package-lock.json` 包条目 | 1,649 | **1,536** | **-113** |
| 锁文件新增条目 | — | — | **0** |
| 锁文件版本变更 | — | — | **0** |

**删除的 9 个直接依赖：**

| 包 | 类型 | 证明 |
|---|---|---|
| `@hpke/core` | dependency（根 + remote） | 全仓无 import；`node_modules` 内无任何包声明依赖它；`remote/package.json` 同名项一并删 |
| `libsodium-wrappers` | dependency（根 + remote） | 同上 |
| `merge-options` | devDependency | rspack/vite 时代 polyfill，全仓零引用 |
| `os-browserify` | devDependency | 同上 |
| `@playwright/cli` | devDependency | 全仓零引用；`@playwright/test` 独立保留 |
| `@vscode/test-cli` | devDependency | 全仓零引用 |
| `@vscode/telemetry-extractor` | devDependency | 全仓零引用（唯一消费者已删） |
| `@vscode/component-explorer` | devDependency | 仅被已删的 `test/componentFixtures/**` 引用 |
| `@vscode/component-explorer-cli` | devDependency | 同上 |

**连带移除的 104 个传递依赖**（随上面 9 个直接依赖消失）：`express`、`react`、`react-dom`、`hono`、`@modelcontextprotocol/sdk`、`jose`、`ts-morph`、`vite-plugin-istanbul`、`@vscode/ripgrep`、`micromatch`、`fast-glob` 等；`package-lock.json` 逐 key 比对确认**零新增、零版本变更**。

### 3. 功能改动（与清理分开提交）

| 提交 | 文件 | 性质 |
|---|---|---|
| `07f9def4` | `agentHostChatInputPicker.ts` | **Bug 修复**：`CODEX_APPROVALS_LEARN_MORE_URL` 全仓无定义，运行到即 ReferenceError，改为已定义的 `PERMISSIONS_LEARN_MORE_URL` |
| `908b35e6` | 17 个文件 | 类型对齐：137 → 0（含 `agents` 字段删除、`IAgentHostMcpServer` 结构化、6 个测试 mock 签名） |
| `44f9a056` | 3 个协议测试 | HEAD `ce668543` 改了契约（wireRevision 5→4、method 42→43）但漏改测试，本提交补上 |
| `afed5f18` | `genDshIconDataUris.mjs` | 去掉硬编码 `E:/deepseek-harness/...`，改 `DSH_ARTWORK_TS` 环境变量 |
| `980bcf5b` | `chatWidget.test.ts` | 测试断言对齐 DSH 文案（HEAD 起即失败的过时用例） |

### 4. 存疑保留项

| # | 项 | 为什么保留 |
|---|---|---|
| R1 | `isRecord` 六份、`stringOf`/`numberOf` 各两份 | 跨 Host-side JS / electron-main / workbench 三层；抽公共模块要改 gulp staging 与 `verify:dsh-ide-boundary` 的层规则，收益小于风险。建议单列后续任务 |
| R2 | `dshIdeSessionListModel.ts` + `dshIdeSessionsService.ts` 列表链 | 文档明确「显示主链是 controller，操作用 sessions service」；删旧链会改 `createSession()` 与搜索命令行为 |
| R3 | `dshIdeContract.ts` 两个 CONTRACT_* 常量 | 删除会让 `verify:dsh-ide-protocol-single-source` FAIL（该门禁断言 contract 必须 import protocol 常量） |
| R4 | `build/lib/dsh/CHAT-RENDER.md` 的同类文档 `ICON-PROVENANCE.md` | 后者仍准确描述生成物，只改源仓库 URL，不删 |
| R5 | `build/monaco/version.txt`（0 字节） | `build/gulpfile.editor.ts:188-193` 会写入内容，是模板占位 |
| R6 | `src/vs/platform/dshClient/index.js:45,67` 的 `console.log` | Host 端点发布/桥接成功的运行日志，非临时调试 |
| R7 | `.eslint-allowed-bracket-notation-files` 内 `# Copilot extension` / `# Agent Host platform` 段落标题 | 段落已整段清空并删除；其余段落标题与计数已重算 |

### 5. 风险与回滚

| 风险 | 等级 | 缓解 / 回滚 |
|---|---|---|
| 删除 `dshSessionItemState.ts` 后，未来若有人想复用纯函数 | 低 | `git revert ece6e68c`；controller 内联实现是等价逻辑 |
| `build/npm/dirs.ts` 改动影响 `postinstall` | 中 | 已跑 `preinstall.ts` PASS；`dirs` 从 49 → 47，删除的两项本就不存在。回滚：`git revert 8c029419` 的该文件 hunk |
| 删除 9 个依赖后某些动态 `require` 失效 | 低 | 全仓静态 import 扫描 0 命中 + `node_modules` 依赖图穷举 0 消费者；`npm ls` 显示这些包已 extraneous（可 `npm prune`）。回滚：`git revert 0d266820` |
| 删除 `.vscode` 的 Vite 调试项影响 Monaco 调试 | 低 | 该目录已不存在，任务必然失败。若确需恢复，回滚 `8c029419` |
| `package.json` 制表符 vs 锁文件 2 空格格式差异 | 低 | 锁文件按 npm 原格式写回，diff 仅 27 行插入（均为原有条目位移） |
| 测试项数 389 → 384 | 低 | 减少的 5 项全是已删模块的私有测试；其余 384 项全 PASS |
| 未跑浏览器单测与真机 GUI | 中 | 按 AGENTS §6 由用户执行；建议重点看：聊天欢迎页文案、模型选择器、会话树、任务行、停止按钮 |

**整体回滚**：`git revert --no-commit ce668543..HEAD && git commit`（保留 `ce668543` 及其之前的历史）。

### 6. 提交清单（11 个，功能与清理分开）

| # | 提交 | 类型 | 文件 | +/- |
|---|---|---|---|---|
| 1 | `07f9def4` fix(chat): 权限说明链接 | 功能修复 | 1 | +2/-1 |
| 2 | `908b35e6` fix(types): 收尾最后 6 条 | 类型对齐 | 17 | +55/-24 |
| 3 | `4cd32915` chore(cleanup): 删未使用 import/字段/死方法 | 清理 | 19 | +12/-139 |
| 4 | `44f9a056` test(dsh): 协议测试对齐 | 测试 | 3 | +22/-16 |
| 5 | `82011ef0` docs(agents): 源码参考改在线 | 文档 | 1 | +2/-2 |
| 6 | `ece6e68c` chore(cleanup): 删 DSH 死模块/资源 | 清理 | 9 | +3/-504 |
| 7 | `182b9e36` chore(cleanup): 删无引用导出与过期注释 | 清理 | 9 | +10/-36 |
| 8 | `afed5f18` chore(build): 图标脚本去本机路径 | 构建 | 2 | +9/-6 |
| 9 | `8c029419` chore(cleanup): component-explorer 与 VSCode 配置 | 清理 | 27 | +5/-2274 |
| 10 | `0d266820` chore(deps): 删 9 依赖 + 5 脚本 | 依赖 | 3 | +27/-1605 |
| 11 | `980bcf5b` test(chat): welcome 断言对齐 | 测试 | 1 | +10/-14 |

### 7. 手册未覆盖处的处理

1. **覆盖率**：DSH 侧无既有覆盖率命令，本轮以 `test-dsh:all` 的项数与通过率不降为等价证据（384 全过）。如需真实行覆盖率，可用现有 `c8`（已在 devDeps）新增脚本，不新增依赖，待确认。
2. **`genDshIconDataUris.mjs --check`**：需官方 `artwork.ts`；按 AGENTS §3 不在本机保留整仓副本，故为 PENDING。
3. **全仓 ESLint**：DSH 文件版权头是 `DSH-IDE contributors`，与上游 `header/header` 规则不符，HEAD 起即报错；本轮不扩大范围改版权头（会触碰许可证边界），记 PENDING。
4. **`node_modules` 里的 extraneous 包**：`npm install --package-lock-only` 只改锁文件，磁盘上的包还在；如需回收磁盘可 `npm prune`，不影响仓库瘦身结论。

---

## 第 2 轮

> 编制时间：2026-11-17 21:40（Asia/Shanghai）
> 起点：`36521cd0`（第 1 轮结束）　终点：`ad638615`
> 全区间：**22 个文件，+288 / -496 行**（2 删除 / 18 修改 / 2 新增）；6 个提交（含本文档提交）

### 1. 门禁总览

| 门禁 | 结果 | 说明 |
|---|---|---|
| 全量 `tsc --noEmit` | **PASS**（0 error） | 每批后都跑 |
| `npm run test-dsh:all` | **PASS**（node 384 + mocha 7） | 项数与第 1 轮持平（未增未减） |
| `verify:dsh-ide-ci`（五项） | **PASS** | 需 `DSH_INSTALLED_VERSION=0.2.2-rc.1`（不含该变量时 contract 为 PENDING，非本改动引入） |
| `verify:dsh-artifact` | **PASS** | 期望值已从 7 补到 10；产物当前 11（多出的是旧包里的 `dshIdeLocationIndex.js`） |
| `verify:dsh-real-p95` | **已移除** | 原脚本必 FAIL（见 §2 A1） |
| `.vscode/tasks.json` / `launch.json` | **PASS** | JSONC 解析 + 16 个 npm 任务全部命中已存在 script + 所有 preLaunchTask/dependsOn 均可解析 |
| `npm run compile` | 未重跑 | 本轮无源码结构改动会影响力构建；上一轮已 PASS（1.67 min，0 error） |
| 真机 GUI | **PENDING** | 按 AGENTS §6 由用户执行 |

### 2. 删除清单与理由

#### 2.1 失效脚本（2 个，221 行）

| 文件 | 行数 | 为什么删 |
|---|---|---|
| `build/lib/dsh/verify/dshRealSampleP95.mjs` | 143 | 它 `import` 的 `ide-view-projector.ts` / `translator.ts` 已被删除，且 `dshIdeVerify.mjs:168-169` **反向断言**两者不得存在；实跑 `npm run verify:dsh-real-p95` → `ERR_MODULE_NOT_FOUND`。它测量的 TUI 投影器已不在当前架构（现走 `dshIdeProjections` / `dshChatModel`） |
| `build/dsh-ide-build-prereqs.mjs` | 78 | 仓库扁平化后 `ROOT = dirname(仓库根) = E:\`，会把 `types-stash` 写到 `E:\types-stash`（已实测并清理）；且其前提（`@types/*` 是指向 `types-stash` 的 junction）已不成立，无任何 package.json / README / 手册引用 |

同时删除 npm script `verify:dsh-real-p95`（scripts 81 → 80）。

#### 2.2 死代码（4 处，74 行）

| 位置 | 符号 | 删除量 | 证明 |
|---|---|---|---|
| `dshComposerProjection.ts` | `toChatMode` + `observeModes` + `modesOf`（含 10 个连带失效 import） | 41 行 | 三者全仓零调用；预设选项实际由 `dshAgentSessionsController.getNewChatSessionInputState()` 直接构造 `IChatSessionProviderOptionGroup` |
| `dshChatSession.ts` | `noteRunning()` | 8 行 | 零调用；`_running` 仍由流式路径维护 |
| `dshChatSession.ts` | `pendingItemsView()` + `_pendingView` 字段 + 2 处赋值 | 11 行 | `pendingItemsView()` 零调用；typed pending 由 `pending()` / `onDidChangePending` 提供 |
| `dshChatSession.ts` | `boundId()` | 3 行 | 零调用 |
| `dshIdeProtocol.ts` | `DshIdeImageAttachmentValue` | 6 行 | 全仓仅定义 1 次 |
| `dshLanguageModelProvider.ts` | 重复的 `DSH_MODEL_VENDOR` 声明 | 4 行 | 改为从 `dshComposerProjection` 导入，消除同名同值双份 |

#### 2.3 悬空配置（2 个 config，166 行）

| 文件 | 删除内容 | 证明 |
|---|---|---|
| `.vscode/tasks.json` | 「Serve Out (rspack)」「Copilot - Build」「Kill Copilot - Build」3 个任务 + 2 处 dependsOn 引用 + 1 处描述 | `serve-out-rspack` / `watch-copilotd` / `kill-watch-copilotd` 三个 script 均不存在；`extensions/copilot` 目录不存在 |
| `.vscode/launch.json` | 「VS Code Github Tests」「VS Code API Tests (single folder)」「VS Code API Tests (workspace)」「VS Code Tokenizer Tests」「VS Code Tokenizer Performance Tests」5 个启动项 + `extensions/copilot/dist` 的 outFiles 条目 | 对应 5 个扩展目录（github / vscode-api-tests / vscode-colorize-tests / vscode-colorize-perf-tests / copilot）均 `Test-Path=False` |

#### 2.4 死配置项（3 处）

| 位置 | 内容 | 证明 |
|---|---|---|
| `.eslint-ignore:65-67,72` | 3 行 sidecar 注释 + `build/dsh/chat-render/src/**` 忽略项 | 该目录与 `build-render.mjs` 均已删，只剩两个凭据文件 |
| `build/tsconfig.json:25` | `"vite/**"` exclude | `build/vite` 已删 |
| `.vscode/tasks.json:27` | 描述里的「and copilot」 | `extensions/copilot` 不存在 |

### 3. 修正清单（非删除）

| 位置 | 问题 | 修法 |
|---|---|---|
| `scripts/sync-upstream.mjs:77` | 读 `vscode-1.143.1/build/lib/dsh/PROVENANCE.md`（不存在，异常被吞 → `readVendoredVersion()` 恒返回 undefined → base 回退为最新 tag → 报告恒为 SAME） | 改 `build/lib/dsh/PROVENANCE.md`；版本正则适配「`0.2.2-rc.1`（源仓库根…）」格式；4 处报告文案去掉 `vscode-1.143.1/` 前缀 |
| `build/lib/dsh/verify/dshArtifactContents.mjs:43-51,81` | `EXPECTED_COMMON` 只列 7 个，实际 stage 10 个；日志硬编码「期望 7」 | 补齐 `dshIdeComposer.js` / `dshIdeWaterfallNotice.js` / `dshIdeRequestView.js`；日志改用 `EXPECTED_COMMON.length` |
| `docs/DSH-IDE改造开发手册.md:145,238,265,350,367,385` | method 计数 42 / 36 | 42 → 43（4 处）、36 → 43（2 处，32 可用 → 39 可用） |
| `docs/DSH-IDE改造开发手册.md:799` | `dshSessionItemState.ts` 行号引用 | 改为「已删除，等价逻辑内联在 controller」 |
| `docs/DSH-IDE改造开发手册.md:936` | 「删除 89 个文件」 | 改为「变更 92 个文件（26 删除 / 64 修改 / 2 新增），+456 / -4,621 行」 |
| `README.md:86,90` | 「模型菜单」「聊天渲染 sidecar」 | 改为「会话树」「历史来源凭据（只读，不参与构建）」 |
| `build/gulpfile.vscode.ts:546,676`；`build/next/index.ts:405`；`build/lib/dshBuildProvenance.ts:21` | 4 处注释称 DSH 帧由 `DshChatModelDriver` 写入 | 改为 `dshChatSessionContent` content provider |
| `dshTeamCommands.ts:8-9` | 提及已删的 `dshModelMenu.ts` | 改为直接说明「原生选择器没有团队控件」 |

### 4. 依赖前后对比

**本轮无依赖变更。**

| 项 | 值 |
|---|---|
| dependencies | 66（不变） |
| devDependencies | 93（不变） |
| scripts | 81 → **80**（-1：`verify:dsh-real-p95`） |
| 全仓依赖名扫描（9,055 文件 × 159 个包） | **「从未出现」的依赖 0 个** |

`node_modules` 里第 1 轮删掉的 9 个包仍以 **extraneous** 形式存在（磁盘残留）；如需回收磁盘可 `npm prune`，不影响仓库。

### 5. 存疑保留项

| # | 项 | 为什么保留 |
|---|---|---|
| R1 | `dshIdeContract.ts` 的 5 个导出（`UPSTREAM_VALIDATED_VERSION` / `BLESSED_PACKAGES` / `VSCODE_PATCH_POINTS` / `installedMeetsVersion` / `upstreamDrift`） | `src/**` 零引用，但 `verify:dsh-ide-contract` + `protocol-single-source` 按名字/正则断言存在，删则门禁 FAIL |
| R2 | `dshIdeContract.ts` 整个文件（全仓 0 import） | 它是门禁的检查对象（被当文本读） |
| R3 | `dshChatModel.ts` 的 22 个 `Dsh*Block` / `Dsh*Node` 类型 | 只在本文件自用，但都是 `DshChatNode` 联合类型成员，删了类型不全 |
| R4 | `isRecord` 6 份 / `stringOf` 3 份 / `numberOf` 2 份 | 跨 Host 纯 JS / transport / workbench 三层；抽取需改 gulp staging 与 boundary 门禁，函数体各仅 1 行 |
| R5 | 协议错误码与 `ide-view-host.js` 的 4 个同名常量 | Host 半身为纯 JS，注释明示不跨层 import，属有意复制 |
| R6 | `DSH_IDE_DELETE_SESSION_PLUGIN` / `_VERSION` / `_ENDPOINT` | `dshIdeProtocol.test.ts:331-334` 按值断言 |
| R7 | `.eslint-ignore` 的 `src/vs/base/common/lit-html/**`、`signals-core/**` | 目录不存在，但属上游 vendored 声明，删了可能影响未来 vendoring |
| R8 | `build/dsh/chat-render/` 的 `PROVENANCE.md` + `LICENSE-DSH` | AGENTS §5 明确四份凭据不得删改 |

### 6. 风险与回滚

| 风险 | 等级 | 缓解 / 回滚 |
|---|---|---|
| 删除 `verify:dsh-real-p95` 后失去真实样本 P95 测量 | 中 | 该能力已随 `ide-view-projector.ts` / `translator.ts` 一起失效；若需恢复，须按现行 `dshIdeProjections` 重写（不在本轮）。回滚：`git revert eb32759d` |
| 删除 `build/dsh-ide-build-prereqs.mjs` 后，若将来 `@types` junction 再丢失，需要手工补 | 低 | 脚本原本会写坏 `E:\` 且校验必失败，留着反而更危险。回滚：`git revert eb32759d` |
| 删除 `.vscode` 的 Copilot/Github/API/Tokenizer 调试入口 | 低 | 对应扩展目录早已不存在，任务点了必失败。回滚：`git revert cc38a1b1` |
| 删除 `toChatMode` / `observeModes` 后，若将来要用 `IChatMode` 形态的预设选择器 | 低 | 当前预设走 `IChatSessionProviderOptionGroup`，两种形态不通用；需要时按新需求重写。回滚：`git revert 62eb9c4c` |
| 删除 `pendingItemsView()` / `noteRunning()` / `boundId()` | 低 | 三者零调用；`pending()` / `_running` / `boundSessionId` 仍在。回滚：`git revert 62eb9c4c` |
| `sync-upstream.mjs` 正则改动可能匹配不到未来格式 | 低 | 已用当前 `PROVENANCE.md:19` 实测捕获 `0.2.2-rc.1`；格式再变时需再调。回滚：`git revert cc38a1b1` |
| `verify:dsh-artifact` 期望 10 但产物 11 | 低 | 多出的 `dshIdeLocationIndex.js` 是旧 dist 产物；重新打包后消失。回滚：`git revert 2d7a1b02` |

**整体回滚**：`git revert --no-commit 36521cd0..HEAD && git commit`。

### 7. 提交清单（5 个）

| # | 提交 | 类型 | 文件 | +/- |
|---|---|---|---|---|
| 1 | `62eb9c4c` chore(cleanup): 删 DSH 零引用导出与死成员 | 清理 | 5 | +4/-74 |
| 2 | `cc38a1b1` chore(cleanup): 修断链脚本与悬空调试配置 | 清理 | 4 | +11/-174 |
| 3 | `eb32759d` chore(cleanup): 删两个已失效的构建/门禁脚本 | 清理 | 2 | +0/-221 |
| 4 | `acc31151` docs: 对齐手册定量声明与源码/构建注释 | 文档 | 9 | +21/-24 |
| 5 | `2d7a1b02` chore(verify): artifact 门禁期望补齐到 10 个 common 模块 | 门禁 | 1 | +6/-3 |

### 8. 手册未覆盖处的假设

1. **P95 能力**：删脚本 = 放弃「真实样本 P95」这一测量项。若后续要做性能校准，需按现行投影层重新设计（`dshIdeProjections` / `dshChatModel`），阈值也要重新定。
2. **`dshIdeContract.ts`**：其 5 个导出在 `src/**` 零引用，但门禁按名字断言，因此不删；这与「零引用即删」的原则冲突，按「门禁是消费者」例外处理。
3. **`.vscode` 的 Copilot 相关项**：删除依据是 `extensions/copilot` 目录不存在；若将来重新引入该扩展，需要恢复这些任务与启动项。
4. **`node_modules` extraneous 包**：只清仓库（package.json + lock），不清磁盘；需要的话单跑 `npm prune`。

---

## 第 3 轮

> 编制时间：2026-11-17 22:35（Asia/Shanghai）
> 起点：`ad638615`（第 2 轮结束）　终点：`cd7aeb4b`
> 全区间：**3 个文件，+7 / -28 行**（另有 1 个空目录，git 不跟踪）

### 1. 门禁总览

| 门禁 | 结果 |
|---|---|
| 全量 `tsc --noEmit` | **PASS**（0 error） |
| `npm run test-dsh:all` | **PASS**（node 384 + mocha 7） |
| `verify:dsh-ide-ci`（五项） | **PASS**（`DSH_INSTALLED_VERSION=0.2.2-rc.1`） |
| `.vscode/tasks.json` | JSONC 解析 PASS |
| `.eslint-ignore` 死条目扫描 | **0**（原 19 条死条目） |
| `node --check scripts/sync-upstream.mjs` | **PASS** |
| `npm run compile` | 未重跑（本轮无源码/构建结构改动） |
| 真机 GUI | **PENDING**（按 AGENTS §6 由用户执行） |

### 2. 扫描结论：DSH 代码已无死代码可删

本轮对 `src/vs/platform/dshClient/**` + `src/vs/workbench/contrib/dsh/**`（55 文件）做全量复扫：

| 检查项 | 结果 |
|---|---|
| 零引用导出（273 个） | **0** |
| 零引用模块 | 4 个——全部是测试入口（由 `test-dsh`/`test-dsh:all` 直接指定），不是孤儿 |
| `TODO` / `FIXME` / `XXX` / `HACK` / `debugger` | **0** |
| 0 字节文件 | **0** |
| `node_modules` 里零引用依赖（9,053 文件 × 159 包） | **0** |

> 结论：前两轮已把 DSH 自有代码的可删面清完。本轮只剩配置层的少量残留。

### 3. 删除清单与理由

| # | 位置 | 内容 | 判定依据 | 删除量 |
|---|---|---|---|---|
| 1 | 空目录 `src/vs/workbench/contrib/dsh/test/browser` | 空目录 | `Get-ChildItem -Force -Recurse` = 0 项；`git ls-files src/vs/workbench/contrib/dsh/test` 为空 | 0 B（git 不跟踪） |
| 2 | `.eslint-ignore:5-21` | 17 条 `**/extensions/copilot/**` 忽略项 | `extensions/copilot` 目录不存在（`Test-Path=False`），glob 永不命中 | 17 行 |
| 3 | `.eslint-ignore:62-63` | `src/vs/base/common/lit-html/**`、`signals-core/**` | 两目录在 git 历史里**从未存在**（`git rev-list --count --all` = 0） | 2 行 |
| 4 | `build/filters.ts:223-224,246-247` | `// extensions/copilot has its own code style` + `'!extensions/copilot/**'` 两处 | 同上 | 4 行 |

### 4. 修正清单（非删除）

| 位置 | 问题 | 修法 |
|---|---|---|
| `scripts/sync-upstream.mjs:8-11,157,160,180,182` | 「渲染复用件」段（20 源 / 8 CSS / 1 资产）的本地复制件与 sidecar 构建链已删除，报告却把它当作当前复用面；其中还残留 `DshChatModelDriver` 描述 | 改为「**历史**渲染复用件」，并注明「本地复制件与 sidecar 已删除，仅作历史对照」；把 `DshChatModelDriver` 那句改为「曾用于旧渲染 sidecar」 |

### 5. 依赖前后对比

**本轮无依赖变更。**

| 项 | 值 |
|---|---|
| dependencies | 66（不变） |
| devDependencies | 93（不变） |
| scripts | 80（不变） |
| 全仓零引用依赖 | 0 |

### 6. 存疑保留项（本轮确认「不动」）

| # | 项 | 理由 |
|---|---|---|
| R1 | `dshIdeContract.ts` 的 5 个导出 + 文件本身 | 门禁按名字/正则断言，删则 FAIL |
| R2 | `dshChatModel.ts` 的 22 个 `Dsh*Block`/`Dsh*Node` 类型 | `DshChatNode` 联合类型成员 |
| R3 | `isRecord` 6 份 / `stringOf` 3 份 / `numberOf` 2 份 | 跨三层，抽取需改 gulp staging 与 boundary 门禁 |
| R4 | 协议错误码与 `ide-view-host.js` 的 4 个同名常量 | Host 半身纯 JS，有意复制 |
| R5 | `build/filters.ts:89-90,220-221` 的 `lit-html`/`signals-core` 排除项 | 与上游 vendoring 约定相关，**Q3 已确认保留**（只删 `.eslint-ignore` 的两行） |
| R6 | `build/dsh/chat-render/PROVENANCE.md` + `LICENSE-DSH` | AGENTS §5 四份凭据不得删改；其内容描述的是历史构建方式，与现状不符，**Q2 已确认保持原样** |
| R7 | `src/vs/platform/dshClient/PROVENANCE.md`、`build/lib/dsh/PROVENANCE.md`、`NOTICE.md`、`LICENSE.txt` | 同上；`NOTICE.md` 里的 `vscode-1.143.1/` 旧布局描述属许可证声明，禁改 |
| R8 | `build/lib/i18n.ts:333`、`build/npm/update-localization-extension.ts:53`、`build/gulpfile.scan.ts:38-39` 的 `vscode-loc`/`scanbin` 兄弟目录假设 | 属 VS Code 上游约定，**Q4 已确认保留** |
| R9 | 三份历史分析/草稿文档里的已删文件引用 | **Q5 已确认保持原样**（记录当时判断，加注记反而失真） |

### 7. 风险与回滚

| 风险 | 等级 | 回滚 |
|---|---|---|
| 删 17 条 copilot 忽略项与 filters.ts 排除项，若将来重新引入 `extensions/copilot`，lint 会开始检查它 | 低 | `git revert cd7aeb4b` |
| 删 `lit-html`/`signals-core` 的 `.eslint-ignore` 两行（`build/filters.ts` 仍保留） | 极低 | 同上 |
| `sync-upstream.mjs` 文案改为「历史渲染复用件」，若将来恢复渲染复用需改回 | 低 | 同上 |

**整体回滚**：`git revert --no-commit ad638615..HEAD && git commit`。

### 8. 三轮累计

| 轮次 | 区间 | 文件 | +/- | 提交 |
|---|---|---|---|---|
| 第 1 轮 | `ce668543`..`36521cd0` | 92 | +456 / -4,621 | 12 |
| 第 2 轮 | `36521cd0`..`ad638615` | 22 | +288 / -496 | 6 |
| 第 3 轮 | `ad638615`..`cd7aeb4b` | 3 | +7 / -28 | 1 |
| **合计** | `ce668543` 之后（含全部文档提交） | **约 111**（去重后） | **+945 / -5,143** | **20 余** |

累计成果：
- **tsc：137 → 0**
- **test-dsh:all：384 + mocha 7，全 PASS**（减少的 5 项全部来自已删的 `dshSessionItemState.test.ts`）
- **dependencies 68 → 66、devDependencies 100 → 93、scripts 86 → 80**
- **锁文件 1,649 → 1,536 条（-113，零新增、零版本变更）**
- `verify:dsh-ide-ci` 五项全 PASS、`verify:dsh-artifact` PASS
- DSH 两目录零引用导出 / 零引用模块 / TODO / 空文件全部为 0

---

## 第 4 轮

> 编制时间：2026-11-17 23:30（Asia/Shanghai）
> 起点：`d75b1fc1`（第 3 轮结束）　终点：`3bd2238f`
> 全区间：**23 个文件，+284 / -1,289 行**（含本文档）；6 个提交（清理 3 / 功能注释 1 / 文档 2）

### 1. 门禁总览

| 门禁 | 结果 |
|---|---|
| 全量 `tsc --noEmit` | **PASS**（0 error） |
| `npm run test-dsh:all` | **PASS**（node 384 + mocha 7） |
| `verify:dsh-ide-ci`（五项） | **PASS**（`DSH_INSTALLED_VERSION=0.2.2-rc.1`） |
| `verify:dsh-artifact` | **PASS**（产物 142,011,142 B；`package/common/` 11 个模块） |
| `npm run compile` | **PASS**（0 errors，49 s） |
| `.vscode` 三份 JSONC | 解析 PASS；tasks.json 16 个 npm 任务全部命中；launch.json preLaunchTask 0 缺失 |
| `bash -n scripts/test-integration.sh` | **PASS** |
| `node --check eslint.config.js / build/filters.ts / scripts/sync-agent-host-protocol.ts` | **PASS** |
| `.eslint-allowed-*-files` 全条目存在性 | **0 missing**（105 + 220 条） |
| `build/lib/test/i18n.test.ts` | **PASS**（3/3） |
| 真机 GUI | **PENDING**（按 AGENTS §6 由用户执行） |

### 2. 删除清单与理由

#### 2.1 断链脚本（4 个文件，219 行）

| 文件 | 行数 | 为什么删 |
|---|---|---|
| `scripts/code-agent-host.js` | 113 | 拼 `out/vs/platform/agentHost/node/agentHostServerMain.js` 并 spawn；`src/vs/platform/agentHost/**` 已整体删除，`out/` 下无此目录 → 子进程 `Cannot find module` |
| `scripts/code-agent-host.sh` | 31 | 只 `exec` 上面那个 js，同一失败路径 |
| `scripts/test-agent-host-e2e.sh` | 37 | `exec node ./test/integration/agentHost/runner.ts`；该目录不存在 |
| `scripts/test-agent-host-e2e.bat` | 38 | 同上（Windows 版）；对应 npm script 已在第 1 轮删除 |
| `scripts/code-sessions-web.js` | 176 | 启动页 import `src/vs/sessions/sessions.web.main.internal`；`src/vs/sessions/**` 已整体删除 |
| `scripts/code-sessions-web.sh` | 27 | 只 `exec` 上面那个 js |

> 合计 **6 个文件、422 行**；全部为「指向已删目录」的启动/包装脚本，无任何 package.json script 引用（`test-agent-host-e2e` 两个 npm script 已在第 1 轮删除）。

#### 2.2 零引用脚本（1 个文件，571 行）

| 文件 | 行数 | 证明 |
|---|---|---|
| `scripts/chat-simulation/merge-ci-summary.js` | 571 | 全仓无 import、无 package.json script、无 `.github/` CI 配置引用；头注释称「Called by the CI report job」但该 CI 已不存在；含 3 个与 `test-chat-perf-regression.js` 完全相同的函数（同源分叉） |

#### 2.3 冗余配置（8 个文件，约 260 行）

| 位置 | 内容 | 判定依据 |
|---|---|---|
| `eslint.config.js` | agentHost/sessions 的 files/ignores glob **14 行** + 空的 `agent-host-test` 插件块 **27 行** + 两个纯 agentHost 的 `code-import-patterns` 条目 **约 49 行** | 全部指向已删目录，ESLint 零匹配不报错（惰性），但没有任何作用 |
| `build/filters.ts` | 3 处 `!src/vs/platform/agentHost/node/codex/protocol/generated/**` | 同上 |
| `.eslint-ignore` | 1 处同名忽略项 | 同上 |
| `.vscode/settings.json` | 3 条 `files.readonlyInclude` + 1 条注释掉的 sessions 排除 | 同上 |
| `.vscode/launch.json` | 「VS Code Agent Host」启动项（15 行） | 其 `program` 指向已删的 `scripts/code-agent-host.js` |
| `.eslint-allowed-javascript-files` | 3 条登记（code-agent-host.js / code-sessions-web.js / merge-ci-summary.js） | 对应文件已删 |
| `.eslint-allowed-bracket-notation-files` | 3 条登记 | 同上 |
| `.gitignore` | 1 条反向忽略 `!/src/vs/platform/agentHost/test/node/e2e/coverage/` | 目标目录不存在 |
| `build/lib/i18n.resources.json` | `"sessions"` 段 **38 条 / 154 行**（`project: vscode-sessions`） | `src/vs/sessions/**` 已整体删除，这些翻译资源无对应源码 |

### 3. 修正清单（非删除）

| 位置 | 问题 | 修法 |
|---|---|---|
| `scripts/test-integration.sh:200` | `node --input-type=module -e "import {...} from './src/vs/platform/agentHost/test/node/agentHostTestProfile.ts'"`；文件不存在 → `ERR_MODULE_NOT_FOUND`，`set -e` 中断整个默认集成测试 | 删该行（下一行的 `test.sh --runGlob` 照常执行） |
| `scripts/test-integration.bat:130` | 同 A1；`if errorlevel 1 goto :failed` 直接判失败 | 删该行及随后的 `if errorlevel 1 goto :failed` |
| `scripts/test-integration.sh:88` / `.bat:40` | 帮助文本指向已删的 `test-agent-host-e2e.sh/.bat` | 删该行 |
| `scripts/sync-agent-host-protocol.ts:33` | `DEST_DIR` 指向已删的 `src/vs/platform/agentHost/common/state/protocol`；但该脚本仍是 **61 个 `chatContracts/common/state/protocol/*.generated.ts`** 的唯一生成器（这些文件头都是 `DO NOT EDIT -- auto-generated by scripts/sync-agent-host-protocol.ts`） | 改为 `src/vs/platform/chatContracts/common/state/protocol`（第 7 行的注释同步改） |
| `src/vs/platform/dshClient/common/dshIdeProtocol.ts:25` | 注释写「5：新增 capabilities」，但 capabilities 最终按方案一改成独立 method（提交 `ce668543`），修订号从未升到 5、值仍是 4 | 改为「`capabilities` 最终采用独立 method（方案一），不占用修订号——故值停在 4」 |
| `docs/DSH-IDE改造开发手册.md` 13 处 | 见 §4 | 见 §4 |

### 4. 手册修正明细（13 处）

| 手册位置 | 原值 | 新值 | 证据 |
|---|---|---|---|
| §2 `validateDshIdeSnapshot` | `:755-778` | `:1157` | `Select-String 'export function validateDshIdeSnapshot'` |
| §2 `assertSnapshotContinuity` | `:797-816` | `:1963` | 同上 |
| §2 `validateDshIdeInvokeOutput` | `:592-596` | `:933` | 同上 |
| §2 `DshIdeWaterfallNotice` | `:671-706` | `:1058` | `export type DshIdeWaterfallNotice =` |
| §2 `DshIdeSessionNotice` | `:667-669` | `:1054` | `export type DshIdeSessionNotice =` |
| §2 listen 事件面 | `:209-221` | `:924-931` | 「白名单是 `snapshot` 与 `waterfall`」注释段 |
| §2 endpoints 测试 | `dshIdeEndpoints.test.ts:301-312` | `build/lib/test/dshIdeEndpoints.test.ts:328-331` | 「不处理 waterfall」断言实际位置 |
| §2 §4.5 `DshIdeImageAttachmentRef` | `:109-122` | `:136-145` | `export interface DshIdeImageAttachmentRef` |
| §2 状态层裸帧解析 | `dshChatModel.ts:388-403,516-941` | `acceptConversation`，`:394` 起 | 文件仅 646 行，`516-941` 越界 |
| §2 `tokenUsage` | `:318-320,375-386` | `:364` | `tokenUsage()` 实际定义 |
| §2 `pendingItems` / `_running` | `:86` / `:89` | `:89` / `:92` | 实际字段声明 |
| §9.7 图标产物大小 | 约 76 KB | 约 94 KB | 实测 96,561 B |
| §9.7 全量门禁行 | 无口径标注 | 标注「当时记录」并指向 §9.11 现行口径（node 384 / tsc 0 / rc.1） | — |
| §9.9.2 表头与说明 | 「当前代码实际状态」 | 改为「改造前快照」，并列出改造后的 5 个真实行号 | `refresh:190` / `toSessionItem:321` / `sameTreeItem:dshSessionTree.ts:167` / `applyRunning:293` / 归档 `:245/:258/:272` |
| §9.9 验收表 / §9.7 记录 | 未标注历史 | 加「当时记录；`dshSessionItemState` 已在第 1 轮删除」 | — |

### 5. 依赖前后对比

**本轮无依赖变更。**

| 项 | 值 |
|---|---|
| dependencies | 66（不变） |
| devDependencies | 93（不变） |
| scripts | 80（不变；本轮删的脚本本来就没有 npm script 入口） |
| 全仓零引用依赖 | 0 |
| `build/node_modules` | 270 MB / 369 顶层包（`.gitignore:17` 已忽略，不属仓库瘦身范围） |

**TypeScript 双 major 复核结论（保留）**：`typescript` → `npm:@typescript/typescript6@6.0.2`、`@typescript/native` → `npm:typescript@7.0.2` 是同一个上游包的两个 major，但 `update-build-ts-version` 与 `tsc --noEmit` 门禁都依赖这两个别名；且实测 `node_modules/typescript` 已是 5.9.3（安装漂移），改动风险大于收益。

### 6. 存疑保留项

| # | 项 | 理由 |
|---|---|---|
| R1 | `test/smoke/src/areas/agentsWindow/remoteDevContainerFixtures.ts:427,430,487` 与 `fixtures/packagedAgentHost.ts:96` | 仍指向已删的 agentHost 入口；但 `src/vs/sessions/**`（Dev Container / Agents Window 的宿主）也已整体删除，**这些 smoke 用例本身已无被测对象**。改路径只会把「必失败」改成「另一个必失败」，删除整个 `test/smoke/src/areas/agentsWindow/**`（5 文件 / 108 KB）属测试功能裁剪，超出「行为不变」的清理范围，需单独决策。**本轮不动**。 |
| R2 | `build/lib/extensions.ts:333` 的 `'copilot'` | `excludedExtensions` 是对 `extensions/*/package.json` 的过滤名单，目录不存在即无条目，属上游打包逻辑；删除会改变未来扩展目录结构的处理 |
| R3 | `build/darwin/*`、`build/next/index.ts`、`src/**` 11 处 `extensions/copilot` 注释 | 均为注释或带 `existsSync` 守卫的打包逻辑 |
| R4 | `build/lib/i18n.ts:395,420-424` 的 `sessionsProject` 分支 | 属上游翻译工具逻辑（按 sourceFile 路径前缀分派），不是数据；保留 |
| R5 | `eslint.config.js` 的 `src/vs/workbench/services/agentHost/**`（该目录存在）与 `src/vs/sessions/**` 相关 import-pattern 条目（目录已删但属上游分层规则） | 前者目标仍在；后者是 code-import-patterns 的分层声明，删除需同步调整 `vs/sessions/~` 的引用关系网 |
| R6 | `eslint.config.js:1717-1730` 已删的两个纯 agentHost 条目 | 已删（本轮的删除项，非保留项） |
| R7 | `scripts/sync-agent-host-protocol.ts` 的 `PROTOCOL_REPO` 默认 `../agent-host-protocol` | 本机不存在该兄弟仓库；脚本会 `exit 1` 并打印清晰错误，属「需要外部源仓库」的正常前置条件 |
| R8 | `isRecord` 8 份 / `stringOf` 3 份 / `numberOf` 2 份 / `isRef` 2 份 | 跨 ESM / CJS 两套模块系统 + Host 纯 JS 层；抽取收益 <50 行且要改 gulp staging 与 boundary 门禁 |
| R9 | 四份 PROVENANCE/LICENSE 凭据 | AGENTS §5 不得删改 |

### 7. 风险与回滚

| 风险 | 等级 | 回滚 |
|---|---|---|
| 删 `code-agent-host.js/.sh` 后失去「单独启动 Agent Host 进程」的调试入口 | 中 | 该入口的 `out/vs/platform/agentHost/**` 已不存在，留着也只能失败；若将来恢复 agentHost，需从上游重新取这三个脚本。`git revert 4cf5ca10` |
| 删 `test-agent-host-e2e.sh/.bat` 后失去 E2E 包装入口 | 中 | `test/integration/agentHost/**` 已不存在。`git revert 4cf5ca10` |
| `sync-agent-host-protocol.ts` 的目标目录改为 chatContracts 是推断 | 中 | 61 个 generated 文件都在新目录且都带该脚本 banner，证据充分；若上游另有约定需再核。`git revert 4cf5ca10` |
| 删 `build/lib/i18n.resources.json` 的 sessions 段 | 低 | `src/vs/sessions/**` 已删，无源码可提取；若恢复 sessions 需重新生成。`git revert 7a0e6f1e` |
| `wireRevision` 注释改写 | 极低 | 纯注释。`git revert b9c132bc` |
| 手册行号批量修正 | 低 | 全部按 `Select-String` 实测；`git revert cb499ac0` |

**整体回滚**：`git revert --no-commit d75b1fc1..HEAD && git commit`。

### 8. 提交清单（5 个）

| # | 提交 | 类型 | 文件 | +/- |
|---|---|---|---|---|
| 1 | `4cf5ca10` chore(cleanup): 修已删 agentHost/copilot 目录导致的断链与惰性配置 | 清理 | 15 | +3/-916 |
| 2 | `7619d7a9` docs: 第 4 轮瘦身问题清单 | 文档 | 1 | +87/-0 |
| 3 | `b9c132bc` fix(dsh): wireRevision 注释去掉撤销的 5 号方案残留 | 功能（注释） | 1 | +1/-1 |
| 4 | `cb499ac0` docs: 对齐手册 §2/§4/§9.9 的行号与定量声明 | 文档 | 1 | +17/-12 |
| 5 | `7a0e6f1e` chore(cleanup): 删已删 sessions 目录的残留脚本与配置 | 清理 | 6 | +0/-360 |

### 9. 四轮累计

| 轮次 | 文件 | +/- | 提交 |
|---|---|---|---|
| 第 1 轮 | 92 | +456 / -4,621 | 12 |
| 第 2 轮 | 22 | +288 / -496 | 6 |
| 第 3 轮 | 3 | +7 / -28 | 3 |
| 第 4 轮（清理 + 文档） | 23 | +284 / -1,289 | 7 |
| 第 4 轮（细小 Bug 修复） | 10 | +193 / -39 | 1 |
| 第 4 轮（Bug 文档） | 3 | +141 / -0 | 1 |
| **合计** | **133**（去重后） | **+1,564 / -6,469** | **33** |

累计成果：
- **tsc：137 → 0**
- **test-dsh:all：384 + mocha 7，全 PASS**
- **dependencies 68 → 66、devDependencies 100 → 93、scripts 86 → 80**
- **锁文件 1,649 → 1,536 条（-113，零新增、零版本变更）**
- **DSH 两目录零引用导出 / 零引用模块 / TODO / 空文件全部为 0**
- **已删目录（agentHost / copilot / sessions / test-integration agentHost）的断链入口全部清除**

### 10. 手册未覆盖处的假设

1. **`sync-agent-host-protocol.ts` 目标目录**：改为 `chatContracts` 是依据「61 个 generated 文件都在那里 + 文件头 banner 都指向该脚本」推断的，属合理但需上游确认的假设。
2. **`scripts/chat-simulation/merge-ci-summary.js` 删除**：依据是「无 import、无 script、无 CI 配置」，但若 CI 计划恢复摘要合并，需从 `test-chat-perf-regression.js` 的同源函数重建（3 个函数完全相同）。
3. **`build/lib/i18n.resources.json` 的 sessions 段**：删除依据是「`src/vs/sessions/**` 目录不存在」；`build/lib/i18n.ts:420-424` 的 `sessionsProject` 分支保留（它是逻辑不是数据），将来若恢复 sessions 目录，需要把 38 条资源条目加回。
4. **`test/smoke/src/areas/agentsWindow/**`**：整块保留。它是「Dev Container / packaged AgentHost」的 smoke 测试，被测对象已随 `src/vs/sessions/**` 与 `src/vs/platform/agentHost/**` 一起消失；但删除属测试裁剪，不在「行为不变」的清理范围内。

---

## 第 4 轮补充：细小 Bug 修复

> 编制时间：2026-11-18 00:00（Asia/Shanghai）
> 依据：`scan-small-bugs` 子智能体只读扫描（8 类模式，覆盖 DSH 全部生产代码）+ 主智能体逐条复核
> 清单：`docs/DSH-IDE瘦身问题清单.md`（第 4 轮补充：细小 Bug 清单）
> 修复提交：`594dd4a4`（与清理改动分开）

### 1. 门禁总览

| 门禁 | 结果 |
|---|---|
| `tsc --noEmit` | **PASS**（0 error） |
| `npm run build-dsh-tests` | **PASS** |
| `npm run test-dsh:all` | **PASS**（**388**，较修复前 384 **+4**） |
| `verify:dsh-ide-ci`（五项） | **PASS**（`DSH_INSTALLED_VERSION=0.2.2-rc.1`） |
| `npm run compile` | **PASS**（0 errors，36 s） |
| 真机 GUI | **PENDING**（按 AGENTS §6 由用户执行） |

### 2. 修复清单（11 处）

| # | 文件 | 问题 | 根因 | 修法 | 严重度 |
|---|---|---|---|---|---|
| B1 | `dshChatSession.ts` | `running()` 永为 true，面板永远「生成中」 | `submit()` 置 true 后，正常回合结束无任何复位路径 | 新增 `setRunning()`（幂等）+ `acceptSessionStatus()`；`dsh.contribution.ts` 消费 `session-status` 帧驱动复位 | **高** |
| B2 | `dshChatSession.ts` | rebind 失败后同一会话永不重绑 | `boundSessionId` 在 `await` 前写入，失败不回滚 | 失败时回滚 `previous` | 中 |
| B3 | `dshChatSession.ts` | 每条内容帧清空 plan/goal/todos | 投影只在 snapshot 帧下发，`acceptView` 把缺席当清空 | 与 `skills` 同口径：缺席保留上一次值 | 中 |
| B4 | `dshIdeConsumer.ts` + `dsh.contribution.ts` | 一次坏帧后永久拒帧，只能重载窗口 | `reset()` 全仓零调用 | 连接重建时 `consumer.reset()` | 中 |
| B5 | `dshIdeBackendFactory.ts` | 首次 cookie 交换失败后永久失效 | `authenticating` 缓存 rejected Promise 且不清 | `.catch()` 清空后重抛 | 中 |
| B6 | `dshAgentSessionsController.ts` | unhandled rejection | `void this.refresh(...)` 无 catch，而 refresh 会 throw | 统一 `refreshNow()` = `.catch(onUnexpectedError)` | 中 |
| B7 | `dshSessionTree.ts` | 无变化也重建树，`next === this._items` 判等失效 | `list.map()` 必返回新数组 → `changed` 恒真 | 逐层维护 `changed`，无变化返回原数组 | 低 |
| B8 | `dshLanguageModelProvider.ts` | 模型改名/推理档变化不刷新选择器 | 只比 `identifier` | `sameLanguageModel()` 比 name/family/version/token 上限/modelGroup/schema | 低 |
| B9 | `dsh.contribution.ts` | 行内补全 provider 泄漏 | 返回的 Disposable 未 `_register` | `this._register(...)` | 低 |
| B10 | `dshIdeTransport.ts` | abort 竞态窗口漏取消 | `throwIfAborted()` 在挂监听之前 | 先挂监听 + 复查 `signal.aborted` | 低 |
| B11 | `dshChatHistory.ts` | 配额错误挂到交付物行 | `applyQuotaNotice` 在 append 之后执行 | 移到 appendDeliverables 之前 | 低 |

### 3. 测试补充（+4 项，384 → 388）

| 测试文件 | 新增用例 | 锁住的回归 |
|---|---|---|
| `dshChatSessionExtras.test.ts` | 内容帧不带 plan/goal/todos 时保留上次值 | B3 |
| `dshChatSessionExtras.test.ts` | rebind 失败后同一 id 可重试 | B2 |
| `dshChatSessionExtras.test.ts` | 会话状态通知按 sessionId 过滤且能复位 running | B1 |
| `dshSessionTree.test.ts` | `mapTreeItem` 无变化时返回原数组（含子项的树） | B7 |

### 4. 未修（存疑保留）

| # | 项 | 为什么保留 |
|---|---|---|
| R1 | `DshIdeConsumer` 的「坏帧熔断」语义本身 | 熔断是 fail-closed 的正确设计；本次只补了「连接重建时可恢复」。是否要「stale 帧改为重拉快照而非熔断」需要产品决策，不在「行为不变」清理范围 |
| R2 | `dshChatSession.acceptView` 的 `deliverables`/`attachments` 仍按缺省清空 | 这两个字段在 Host 侧每帧都算（`deliverablesOf`/`attachmentsOf` 累计下发），缺席即真为空；与 plan/goal/todos 的投影语义不同 |
| R3 | `dshIdeTransport` 的 `_pendingCalls` 在 dispose 时不清理 | `dispose()` 走 `_failPending`，`_pendingCalls` 只是 AbortController 集合，GC 随 transport 一起回收；无泄漏证据 |

### 5. 风险与回滚

| 风险 | 等级 | 回滚 |
|---|---|---|
| B1 引入 `acceptSessionStatus`：若 Host 侧 `api-session/status` 事件不触发（旧版本），`running` 会停在 true 直到下次 bind | 中 | 旧 Host 本身也没有 `session-status` 帧，行为与修复前一致；`bind()` 仍会 `setRunning(false)`。`git revert 594dd4a4` |
| B3 改为「缺席保留」：若上游某天真的用 `plan: undefined` 表示「计划已取消」，会保留旧值 | 低 | 目前 `projectDshIdeProjections` 只在 snapshot 帧返回 `plan`，取消计划会下发 `{active:false,pending:false}` 而非缺席。`git revert 594dd4a4` |
| B5 失败后重试：可能出现多次 cookie 交换（每次新 `ensureImpl`） | 低 | 交换是幂等的 GET，失败才会重试；成功仍只缓存一份 |
| B7 改 `mapTreeItem` 返回值语义：若有调用方依赖「总是新数组」 | 低 | 全仓只有 `dshAgentSessionsController` 的 3 处调用，都按 `next === this._items` 判等，正是所需语义 |
| B11 调整顺序：配额提示从「最后一条」改为「追加 extras 之前的最后一条」 | 低 | `appendExtras` 是往最后一条 response 追加 parts，不新增行；顺序调整后配额仍落在同一条对话 response 上 |

**整体回滚**：`git revert 594dd4a4`。

### 6. 扫描覆盖面与遗漏说明

| 类别 | 命中 |
|---|---|
| 1 未定义/未导入标识符 | 0（TS 由编译约束；JS 侧逐文件核对） |
| 2 可选链/空值处理 | 0（`?.` 均有前置守卫，`JSON.parse` 均在 try/catch 内） |
| 3 异步错误 | 3（B5/B6/B10） |
| 4 资源泄漏 | 1（B9） |
| 5 逻辑错误 | 2（B7/B11） |
| 6 字符串/正则/路径 | 0（路径均用 `path.join`，正则转义核对无错） |
| 7 类型断言掩盖 | 0（`!` 均由不变量可证非空） |
| 8 状态不一致 | 5（B1/B2/B3/B4/B8） |

**遗漏说明**：子智能体为限时扫描，`build/lib/test/dsh*.test.*` 与 `build/dsh/**` 只做模式扫描未逐行读，可能仍有遗漏；下一轮可对这两处做定向复扫。

---

## 第 5 轮

> 编制时间：2026-11-18 00:35（Asia/Shanghai）
> 起点：`9919cd20`（第 4 轮结束）　终点：`85ad5953`（第 5 轮文档提交；统计口径含文档）
> 全区间：**40 个文件，+422 / -3,910 行**（含本文档与手册提交）
> 4 个提交：`3a3c7336`（回归修复）→ `8903ba72`（清理）→ `90e19ae1`（脚本/测试缺陷）→ 文档

### 1. 门禁总览

| 门禁 | 结果 |
|---|---|
| `tsc --noEmit` | **PASS**（0 error） |
| `npm run build-dsh-tests` | **PASS** |
| `npm run test-dsh:all` | **PASS**（**391**，较第 4 轮 388 **+3**） |
| `verify:dsh-ide-ci`（五项） | **PASS**（`DSH_INSTALLED_VERSION=0.2.2-rc.1`） |
| `verify:dsh-artifact` | **PASS**（142,011,142 B；`package/common/` 11 模块） |
| `npm run compile` | **PASS**（0 errors，37 s） |
| `verify:dsh-install-drift` | **FAIL — 预先存在的漂移，非本轮引入**（见 §6） |
| `build/lib/test/i18n.test.ts` | **PASS**（3/3） |
| 真机 GUI | **PENDING**（按 AGENTS §6 由用户执行） |

### 2. 第 4 轮修复引入的回归（5 处，全部修复）

| # | 位置 | 问题 | 修法 | 严重度 |
|---|---|---|---|---|
| A1 | `dshChatSession.ts` | **高危**：`bind()` 失败回滚 `boundSessionId = previous` 与开头「相同 id 短路」组合 → A 已绑定 → bind(B) 失败 → 再 bind(A) 直接 return true，但 `model.clear()` 已执行 → **面板永久空白** | 新增 `_boundDirty`：短路条件加 `&& !this._boundDirty`，失败置 true、成功置 false | **高** |
| A2 | `dshClientService.ts` + `dsh.contribution.ts` | `consumer.reset()` 挂在 `onDidChangeState({connected:true})`，但 `_connected` 无置 false 路径 → 该事件每窗口最多一次，**重连不 reset，熔断仍只能重载窗口** | snapshot 监听里按 Host 的 `rebuild` 快照调新增 `markDisconnected()`；重连成功再 `markConnected()` | 中 |
| A3 | `dshIdeTransport.ts` | `throwIfAborted()` 在 `try` 外 → signal 已 abort 时跳过 `finally`，abort 监听器永久留在调用方 signal 上 | 移进 `try` 第一行 | 低 |
| A4 | `dshIdeBackendFactory.ts` | `authenticating` 的 catch 无条件清空，可能抹掉期间新建的 promise | 局部 `attempt` + `if (this.authenticating === attempt)` 才清 | 低 |
| A5 | `dshIdeProtocol.ts` | 「缺席即保留」语义未固化 | 在 `DshIdeViewSnapshot` 的 plan/goal/todos 上加契约注释（缺席=保留，显式空值=关闭） | 低 |

**新增回归测试**：A→B(失败)→A 必须真正重绑（`dshChatSessionExtras.test.ts`）。

### 3. 删除清单与理由（B 批）

| # | 位置 | 内容 | 判定依据 | 删除量 |
|---|---|---|---|---|
| B1 | `eslint.config.js` | 12 个纯 `src/vs/sessions/**` 配置块 | `code-import-patterns.ts:63` 只做 `minimatch`，**不 stat 磁盘**；target 全部指向不存在的文件/目录 → 永不匹配、不报错、零行为变化 | 236 行 |
| B3 | `build/stylelint.ts` | 死正则 `designSystemPattern` + 3 处注释 | 指向已删目录 → 正则永假；`if` 条件改为 `reportDesignTokenSuggestions && designTokensEverywhere`（与现状严格等价） | 10 行 |
| B4 | `build/lib/i18n.ts` + `i18n.test.ts` | `sessionsProject` 与两个 `vs/sessions` 分支 + 2 条断言 | 成对删（只删一边会让 `getResource()` throw） | 17 行 |
| B5 | `src/tsec.exemptions.json` | 2 条 `vs/sessions/electron-browser/sessions.ts` 白名单 | 文件不存在，tsec 只按路径字符串比对 | 2 条 |
| B6 | `test/smoke/src/areas/agentsWindow/**` + `test/automation/src/agentsWindow.ts` + 5 处 wiring | **死测试区** | 被测的 `src/vs/platform/agentHost/**`、`src/vs/sessions/**`、`out/vs/platform/agentHost/**` 全部不存在；`agentsWindow.ts:69` 调的命令全仓无定义 | 6 文件 / 164 KB |
| B7 | `build/next/devTunnelsWeb.ts` + entry + 4 个 shim + test + npm script | **死构建脚本** | outDir 写死 `vs/sessions/contrib/providers/remoteAgentHost/browser`（已删 feature）；产物 `devTunnelsModule.js` 全仓无 import | 7 文件 / scripts 80→79 |

> **保留**：`eslint.config.js:1863` 的 `'vs/sessions/~'` —— 它在覆盖数千现存文件的 target 的允许清单里，删掉是「允许清单收窄」而不是等价清理。

### 4. 构建/测试脚本的真实缺陷（C 批，6 处）

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| C1 | `dshIdeEndpoints.test.ts:92-94` | `UNVERIFIED = FINDINGS.filter(not in WIRED)`，而 WIRED 含全部 7 项 → 恒为空数组 → `for` 循环一次不执行 → **守护形同虚设** | 显式 `const UNVERIFIED: readonly string[] = []` + 新增「每条 finding 必须落在 WIRED 或 UNVERIFIED 之一」断言 |
| C2 | `dshStageNumbering.test.ts:29` | 扫描根 `dshIdeProjection.test.ts` 拼错（实际 `dshIdeProjections.test.ts`），`catch { return }` 吞掉 stat 失败 → 该文件从未被扫描 | 改正文件名 + `missingRoots` 收集 + `assert.deepEqual(missingRoots, [])` |
| C3 | `dshIdeVerify.mjs` + `dshIdeContract.ts` | prerelease 整段字符串比较 → `rc.10 < rc.9` | 契约抽出 `comparePrerelease()` 按 semver 逐段数字比较；verify 按同一语义实现；新增结构断言测试 |
| C4 | `dshInstallDrift.mjs` | ① 空文件永不比对（`length > 0` 才比）；② 缺 `host/` 目录时抛 ENOENT、不打印 `STATUS: FAIL` | ① 只要 `Buffer.isBuffer` 就比对；② `existsSync` 守卫 + 记入 `syntaxIssues` |
| C5 | `dshArtifactContents.mjs:24` | `repoRoot = process.cwd()` 依赖调用目录 | 按 `import.meta.url` 向上四级推导；实测从 `C:\` 调用 PASS |
| C6 | `genDshIconDataUris.mjs` | `--check` 存在但需 `DSH_ARTWORK_TS` 外部源、未接入任何门禁 | 在 `dshIconArtwork.test.ts` 增加生成物 sha256 指纹断言（`514e24d8…`） |

### 5. 依赖前后对比

**本轮无依赖变更。**

| 项 | 值 |
|---|---|
| dependencies | 66（不变） |
| devDependencies | 93（不变） |
| scripts | 80 → **79**（-1：`bundle-dev-tunnels-web`） |
| 全仓零引用依赖 | 0 |

### 6. `verify:dsh-install-drift` FAIL 说明（预先存在，非本轮引入）

```
产物插件层文件数 : 24
逐字节比对文件数 : 24
漂移项           : 2
  ✗ 内容不同: host/ide-service.js
  ✗ 内容不同: host/ide-view-host.js
STATUS: FAIL  [install-drift]
```

**判定**：
- 这两个文件在本轮**未被修改**（`git status --short` 对它们为空；最后一次改动是 `182b9e36`，第 1 轮）。
- `dist/dsh-ide-2.0.0.tgz` 的时间戳是 **2026-11-17 00:38:51**，早于第 1 轮（本轮之前的所有清理）。
- 即：**产物是旧的、profile 安装的是更旧的**，两者在第 1 轮之前就已分叉。
- 处置：这需要 **重新打包**（`gulp dsh-ide-pack`）再覆盖 profile；按手册 §0.0「打包推迟到全部开发完成后再做」，本轮**不打包**，如实记为 **FAIL（预先存在）**。

### 7. 存疑保留项

| # | 项 | 理由 |
|---|---|---|
| R1 | `eslint.config.js:1863` 的 `'vs/sessions/~'` | 属活 target 的允许清单，删=收窄语义，不是等价清理 |
| R2 | `build/lib/dsh/PROVENANCE.md:5` 与 `:11-14` 的版本自相矛盾（rc.3 vs rc.1） | AGENTS §5 法律凭据，只报告不动 |
| R3 | `test/smoke/src/utils.ts`、`test/automation/src/chat.ts`、`modelConfigPicker.ts`、`shellScenarios.ts` | 其它 smoke 套件共用，不在删除范围 |
| R4 | `build/next/devTunnelsWeb` 删后 `@microsoft/dev-tunnels-*` 5 个依赖仍被声明 | 它们是 VS Code 上游依赖；`eslint.config.js:1591-1592` 的 hasNode 允许清单仍引用，且 `agentHostProtocolClient.ts` 等注释仍在讨论 dev-tunnels 传输。删依赖属独立决策，本轮不动 |
| R5 | `isRecord` / `stringOf` / `numberOf` 重复实现 | 跨 ESM/CJS + Host 纯 JS 层，抽取收益 < 50 行 |
| R6 | `dshIdeContract.ts` 的 5 个门禁锁定导出 | verify 门禁按名字断言 |

### 8. 风险与回滚

| 风险 | 等级 | 回滚 |
|---|---|---|
| A1 的 `_boundDirty` 若忘记在成功路径清除，会让每次 bind 都重绑 | 低 | 成功路径已置 false，且有测试覆盖 |
| A2 的 `markDisconnected()` 由 `rebuild` 快照驱动：若 Host 不发 `rebuild`，连接态不会翻 false（行为同修复前） | 低 | `git revert 3a3c7336` |
| 删 12 个 eslint sessions 块：若将来恢复 sessions 目录，需从上游重新取这些 target 定义 | 低 | `git revert 8903ba72` |
| 删 agentsWindow smoke 区（164 KB）：若将来恢复 agentHost，需要重新引入这套测试 | 中 | `git revert 8903ba72` |
| 删 devTunnelsWeb 构建：若将来恢复 remote agent host 的 browser 端，需重建打包脚本 | 中 | `git revert 8903ba72` |
| C3 改 `compareVersion`：若上游版本号出现非 semver 形态（如 `0.2.2-rc.1+meta`），解析会退化 | 低 | `git revert 90e19ae1` |

**整体回滚**：`git revert --no-commit 9919cd20..HEAD && git commit`。

### 9. 提交清单（4 个）

| # | 提交 | 类型 | 文件 | +/- |
|---|---|---|---|---|
| 1 | `3a3c7336` fix(dsh): 修上一轮 5 处修复引入的回归 | 功能 | 6 | +70 / -7 |
| 2 | `8903ba72` chore(cleanup): 删已删 sessions 目录的残留配置、死测试与死构建脚本 | 清理 | 23 | +8 / -3,863 |
| 3 | `90e19ae1` fix(dsh): 修构建/测试脚本的 6 处真实缺陷 | 功能 | 8 | +148 / -40 |
| 4 | 文档（本报告 + 手册） | 文档 | 2 | 见提交 |

### 10. 假设

1. **`rebuild` 快照是「断开」的正确信号**：Host 的 `publishDisconnected` 只在传输断开时发它，语义明确。
2. **删 agentsWindow smoke 不减少有效覆盖**：被测源码与 out 产物都不存在，命令也不存在。
3. **`devTunnelsWeb` 无消费者**：全仓 grep `devTunnelsModule` 只命中 build 自身与 test。
4. **`genDshIconDataUris --check` 需外部 artwork 源**：本机与 app.asar 内均无该文件，故用生成物指纹代替接入 CI。

---

## 第 6 轮

> 编制时间：2026-11-18 01:00（Asia/Shanghai）
> 起点：`2b4f2504`（第 5 轮结束）　终点：本轮末次
> **代码改动：4 个文件，+143 / -56 行**（`git diff --shortstat 2b4f2504..HEAD -- scripts/`，稳定）
>
> **文档改动：4 份**（第 6 轮问题清单、本报告、手册 §9.11.9、第 5 轮报告校正）；提交总数以 `git rev-list --count 2b4f2504..HEAD` 为准（每追加一次文档补正 +1）
> 提交：`5ecce9ae`（清理）→ `f66cf565`（bug 修复）→ `005cdf34`（文档校正）→ `e0b826eb`（问题清单）→ `09b5fe5c`（本报告+手册）→ 若干次统计补正

### 1. 门禁总览

| 门禁 | 结果 |
|---|---|
| `tsc --noEmit` | **PASS**（0 error） |
| `npm run test-dsh:all` | **PASS**（**391**，与第 5 轮持平） |
| `verify:dsh-ide-ci`（五项） | **PASS**（`DSH_INSTALLED_VERSION=0.2.2-rc.1`） |
| `npm run compile` | **PASS**（0 errors，31 s） |
| `npm run test-dsh` | **PASS**（7 passing） |
| `node --check`（4 个改动的 JS） | **PASS** |
| TypeScript 编译器 parse（3 个 .ts） | **0 diagnostics** |
| `stripJsoncComments` 单元用例 | **4/4 pass** |
| 真机 GUI | **PENDING**（按 AGENTS §6 由用户执行） |

### 2. 删除清单与理由（B 批）

| # | 位置 | 符号 | 判定依据 | 删除量 |
|---|---|---|---|---|
| B1 | `scripts/chat-simulation/common/utils.js:753`（导出 `:840`） | `linearRegressionSlope()` | 全仓仅「定义 + 导出项」两处命中；两个 perf 脚本的 `require` 解构里都没有它 | 18 行 |
| B2 | `scripts/chat-simulation/common/mock-llm-server.ts:26` | `ROOT` 常量 + `path` require | 文件内仅定义本身出现一次；`path` 模块只剩这一行用途（已核 `path.join/resolve/...` 零命中） | 4 行 |
| B3 | `scripts/chat-simulation/common/mock-llm-server.ts:187` | `ScenarioBuilderImpl.burst()` | 全仓 `.burst(` 零命中；其余 `emit/wait/stream/build` 均被 perf-scenarios 使用 | 6 行 |

**不删（有依据的保留）**：
- `utils.js` 的 `getElectronPath` / `preseedStorage` / `writeSettings` / `median` / `removeOutliers` —— 文件内自用，只是「可降级导出」，删了无收益。
- `fixtures/_chatperf_*.ts`（8 个）—— 经 `path.join(FIXTURES_DIR, name)` **字符串动态引用**，纯符号 grep 会全部误判为死。
- `mock-policy-server/public/*` —— 经 `GUI_ASSETS` 白名单映射（`/app.js` → `app.ts` 等）。
- `mock-llm-server.ts` —— 被 `test/smoke/src/utils.ts:229` 跨目录引用，5 个 smoke 套件依赖。

### 3. 真实 bug 修复（C 批，9 处，0 高危）

| # | 位置 | 类型 | 问题 | 修法 |
|---|---|---|---|---|
| C1 | `mock-llm-server.ts` 7 处 `readBody().then` | 未 catch 的 async | 请求体异常/res 断开 → unhandled rejection → Node 24 终止进程，整轮 benchmark 报废 | 新增 `handleBody()`：失败记日志、`headersSent` 判后回 500 或 end |
| C2 | `mock-llm-server.ts:2185` | 未 catch 的 async | `_startServer(port).then(...)` 无 catch，端口被占时静默挂起 | 补 `.catch` + `process.exitCode = 1` |
| C3 | `utils.js:390` | `JSON.parse` 无保护 | WS message 回调裸 parse，非 JSON 帧炸事件回调 | try/catch 后 return |
| C4 | `utils.js:37` | 无保护 + 静默回退 | `loadConfig()` 失败时 `?? {}` 让阈值静默回退默认值 | try/catch 抛带文件名+section 的错误；校验 section 必须是对象 |
| C5 | `test-chat-perf-regression.js` 6 处 | `JSON.parse` 无保护 | 截断的 baseline/cache JSON → 整轮起不来且看不出哪份坏 | 新增 `readJsonFile(file, what)` |
| C6 | `mock-policy-server/server.ts:738,768` | 路径依赖 cwd | 不在仓库根启动时 `/api/schema` 恒 `ok:false` | 以 `ROOT` 为基准；默认候选 ROOT 优先、cwd 兜底 |
| C7 | `mock-llm-server.ts` 4 处 | 正则反解 | `toolNamePattern.source.replace(...)` 得到 `readfile` 这类不存在的工具名 → 客户端 unknown tool 后等到超时 | 回退 `requestToolNames[0]` + 日志 |
| C8 | `test-chat-perf-regression.js:380` | 正则硬编码 `/` | Windows 路径下 `buildLabel` 退化成 basename | 改 `[\\/]` / `[^/\\]`；实测三种路径都取到版本号 |
| C9 | `utils.js:28` | 正则误伤 | `stripJsoncComments` 砍掉字符串里的 `http://` | 改为按字符扫描的状态机；实测 4 个用例全过 |

### 4. 文档定量校正（A 批，6 处）

| # | 位置 | 原值 | 新值 |
|---|---|---|---|
| A1 | 手册 §9.11.6 | agentsWindow「整块保留」 | 补注「第 5 轮已删除，见 §9.11.8」 |
| A2 | 手册 §9.11.8 | 「smoke 6 文件 164 KB」 | 「smoke 5 文件 108 KB + automation 1 文件 56 KB（合计 6 文件 164 KB）」 |
| A3 | 手册 §9.11.8 | `389 → 391` | `388 → 391（+3）` |
| A4 | 报告 5 | 「389 +2」 | 「388 +3」 |
| A5 | 报告 5 起点/终点 | 终点 `90e19ae1` | 终点 `85ad5953`（统计含文档提交） |
| A6 | 手册 §3.5 | `package.json:85-94` | `package.json:80-91` |

### 5. 依赖前后对比

**本轮无依赖变更。** scripts 79（不变）、deps 66、devDeps 93。

### 6. 存疑保留项

| # | 项 | 理由 |
|---|---|---|
| R1 | `scripts/chat-simulation` 的 5 组重复实现 | 测试脚手架，跨 CJS / 浏览器 IIFE / ESM 三套模块系统；抽取收益 < 风险 |
| R2 | `test/smoke/src/utils.ts` 等 5 个 smoke 套件对 `mock-llm-server.ts` 的路径字符串依赖 | 动态引用，必须保留 |
| R3 | `utils.js` 的 5 个「仅文件内自用」导出 | 可降级为非导出，但无收益 |
| R4 | `scripts/chat-simulation/jsconfig.json` | 无显式引用，但 `checkJs` 依赖它，不能删 |
| R5 | `mock-llm-server.ts` 的 3 个 TS2339（JSDoc 形参漏声明 `gcObjectStats`、`result.error` 联合类型未收窄） | 运行时由调用方真传，不崩；属 JSDoc 严谨性问题，不在本轮 5 类 bug 范围 |
| R6 | 第 5 轮的 `verify:dsh-install-drift` FAIL | 预先存在（旧产物 vs profile），需重新打包，按 §0.0 不打包 |

### 7. 风险与回滚

| 风险 | 等级 | 回滚 |
|---|---|---|
| 删 `linearRegressionSlope` / `ROOT` / `burst()`：若将来某个 scenario 用到会编译/运行失败 | 低 | 三者都是零引用，`git revert 5ecce9ae` |
| C1 的 `handleBody()` 改变错误路径：原本 unhandled rejection 现在回 500 | 低（行为改善） | `git revert f66cf565` |
| C4 的 `loadConfig` 由「静默回退」改为「抛错」：config 损坏时 benchmark 直接失败而非用默认值跑 | 低（行为改善，但更严格） | `git revert f66cf565` |
| C6 的 `ROOT` 优先：若有人故意从其它 cwd 用相对路径覆盖 schema 源，行为会变 | 低 | `git revert f66cf565` |
| C9 的状态机：若 config 里有 `//` 出现在非字符串非注释位置（非法 JSONC），行为可能与旧正则不同 | 低 | `git revert f66cf565` |

**整体回滚**：`git revert --no-commit 2b4f2504..HEAD && git commit`。

### 8. 提交清单（4 个）

| # | 提交 | 类型 | 文件 | +/- |
|---|---|---|---|---|
| 1 | `5ecce9ae` chore(cleanup): 删 chat-simulation 的 3 个零引用符号 | 清理 | 2 | +0 / -28 |
| 2 | `f66cf565` fix(scripts): 修 chat-simulation / mock-policy-server 的 9 处真实 bug | 功能 | 4 | +144 / -29 |
| 3 | `005cdf34` docs: 校正第 5 轮 6 处文档定量偏差 | 文档 | 2 | +6 / -6 |
| 4 | `e0b826eb` docs: 第 6 轮瘦身与 Bug 问题清单 | 文档 | 1 | +62 / 0 |

### 9. 扫描覆盖面

| 区域 | 覆盖 |
|---|---|
| `scripts/chat-simulation/**`（15 文件 / 266 KB） | **本轮全覆盖**（上一轮只做模式扫描） |
| `scripts/mock-policy-server/**`（5 文件 / 159 KB） | **本轮全覆盖** |
| `src/vs/platform/dshClient/**` + `src/vs/workbench/contrib/dsh/**` | 第 4/5 轮已扫，本轮复扫 TODO/死导出，**0 命中** |
| `build/lib/**`、`build/next/**` | 第 5 轮已扫；本轮删 devTunnelsWeb 后无新增死文件 |
| 全仓空目录 / .eslint-ignore 死条目 / 零引用依赖 | **0 / 0 / 0** |

### 10. 假设

1. **`ROOT` 删除安全**：`path` 模块在 `mock-llm-server.ts` 内只剩 ROOT 一处用途，删后 `path.` 前缀零命中（已实测）。
2. **`handleBody` 的 500 语义**：mock server 的失败应显式回 500 而不是让进程挂掉；benchmark 侧会因 HTTP 错误而非超时失败，更容易定位。
3. **`loadConfig` 抛错**：损坏的 config 应阻断运行而不是用默认值；这是 benchmark 更安全的行为。
4. **`ROOT` 优先于 cwd**：仓库根是 schema 的真实位置；cwd 只作为「用户显式从别处启动」的兜底。

---

## 第 7 轮

> 编制时间：2026-11-18 09:40（Asia/Shanghai）
> 起点：`6547a250`（第 6 轮结束）　终点：本轮末次
> **代码改动：20 个文件，+154 / -1,316 行**（`git diff --shortstat 6547a250..HEAD`，不含后续文档提交）
> 2 个代码提交：`b0d3bd26`（清理）→ `5451edcd`（功能修复）；文档另计

### 0. 子智能体派发

本轮开局检查可用模型：`workbuddylocal/cli2api`（本 session 不允许作 child 路由），沿用默认路由派 3 个：
- `scan-smoke-next`：`test/smoke/src/**` + `build/next/**` → 完成，4 节结论
- `scan-build-lib`：**首次失败**（无 closing message），立即重派 `scan-build-lib-2`（收窄为 3 个明确问题）→ 完成
- 主智能体对两份报告逐条复核，删掉低置信项、补验动态引用证据

### 1. 门禁总览

| 门禁 | 结果 |
|---|---|
| 主工程 `tsc --noEmit`（src/tsconfig.json） | **PASS**（0 error） |
| `test/smoke/tsconfig.json --noEmit` | **39 个错误，与改动前基线完全一致**（34 既存 TS2307 automation 模块 + 5 既存 main.ts 错误），**0 新增** |
| TypeScript parse（全部 13 个改动 .ts） | **0 diagnostics** |
| `npm run test-dsh:all` | **PASS**（**391**，持平） |
| `verify:dsh-ide-ci`（五项） | **PASS**（`DSH_INSTALLED_VERSION=0.2.2-rc.1`） |
| `npm run compile` | **PASS**（0 errors，54 s） |
| 正则修复行为验证 | 转义后逐字匹配 3/3、拒绝通配 2/2 |
| 真机 GUI / smoke 套件 | **PENDING**（按 AGENTS §6 由用户执行；smoke 需编译后的 automation/out） |

### 2. 删除清单与理由（A 批，7 文件 + 3 符号 + 3 配置）

| # | 位置 | 判定依据（含动态/字符串引用） | 删除量 |
|---|---|---|---|
| A1 | `build/lib/screenshotBlocksCi.ts` + `screenshotDiffReport.ts` | `git grep` 排除自身 **0 命中**；`.github/` 已删（`git ls-files .github` 空）；package.json 79 scripts 无相关项；`screenshotComment.test.ts:8` 只 import `screenshotComment.ts`（**保留**）。唯一反向依赖 `screenshotDiffReport.ts:29 → screenshotComment.ts` 随之消失 | ~22 KB |
| A2 | `test/smoke/src/networkProxy/{pacServer,negotiateAuthHelper}.ts` + `run-agents-window-network-proxy.sh` + `{test.pac,test-kerberos.pac}` | 整条孤链：两个 .ts 唯一引用是那个 .sh；2 个 .pac 只被该 .sh 的 `FIXTURE_DIR`/`PAC_FILE` 引用；而 .sh 自身无任何 workflow/script 调用（agentsWindow 已删、`smoketest` script 不调它） | 5 文件 |
| A3 | `test/smoke/src/utils.ts` 的 `describeRepeat`/`itRepeat`/`retryWithRestart` | `git grep` 排除定义文件 **0 命中**；连带删不再使用的 `import { Suite, Context } from 'mocha'` | 34 行 |
| B1/B2 | `test/smoke/src/shard.ts` | 删 `suiteDurations` 里 6 条已不存在 "Agents Window" 套件条目、失效的 `firstShardSuite` 常量，及随之恒真的 `assignments.forEach` 预分配循环（对应套件不存在 → 判断恒 false，删除与现状严格等价） | 19 行 |

**删前严格要求（已满足）**：每个删除都查了 `import` / `package.json script` / workflow / 字符串路径 / 动态 `path.join` 五种引用形态。

**不删（有依据）**：`utils.ts` 的 `buildCopilotChatToken`/`getCopilotRuntimeLogDir` 与 `build/next` 的 3 个内部类型导出虽无外部消费者，但文件内自用，仅属「可降级导出」；`build/next/**` 10 个非测试文件全部活（经 `build/lib/esbuild.ts:28/52` 字符串 spawn 链路）；24 个 area 测试全部在 `main.ts` 注册，terminal-*/task-quick-pick 为父套件嵌套子模块，非独立入口。

### 3. 真实 bug 修复（B 批，13 处）

| # | 位置 | 类型 | 问题 | 修法 |
|---|---|---|---|---|
| C1 | `search.test.ts:19-20` | 浮空 Promise（**高**） | `after()` 两次 `retry(...)` 不 await/return → git 清理与后续套件并发、失败成 unhandledRejection | `await Promise.all([...])` + async 回调 |
| C2 | `utils.ts:215-216` | TDZ | `const instance = new sqlite3.Database(dbPath, cb=>resolve(instance))`，cb 同步时 `instance` 处 TDZ → ReferenceError 掩盖 ENOENT | 先 `let` 声明再赋值 |
| C3/C4 | `terminal-splitCwd.test.ts:33-35` / `terminal-tabs.test.ts:61-63` | 未 await | Alt 按下/抬起无 await，点击夹中间 → Alt 卡住污染后续用例 | await + try/finally 保证释放 |
| C5 | `shellScenarios.ts:96` | 正则注入 | `new RegExp(\`...${reply}\`)` 直接插值，含元字符时静默不匹配 | 转义正则元字符 |
| C6 | `browserView.test.ts:101-104` | 空引用 | before 赋值前失败时 `mockServer.close()` 掩盖成 TypeError | `mockServer?.close()` |
| C7 | `browserView.test.ts:543` | 正则注入 | `findBrowserPageId` 的 title 未转义 | 转义（不加 `\b`：标题可能以标点结尾，实测后简化） |
| C8 | `build/next/index.ts:620` | 裸 JSON.parse | .map 损坏只落到通用 "Build failed" | try/catch 带文件名 |
| C9 | `nativePolicy.ts:41` | 裸 JSON.parse | product.json 坏/空时裸 SyntaxError 无路径上下文 | try/catch 带 productPath |
| C10 | `nls-sourcemap.test.ts:44-56` | 资源泄漏 | `mkdtemp` 后任一步抛错 → cleanup 返回不到调用方 → tmpdir 永久残留 | try/catch 包整个体，失败 cleanup 后 rethrow |
| C11 | `build/lib/fetch.ts:155` | 裸 JSON.parse（**中高**） | `through2.obj(async ...)` 回调里解析 GitHub API 响应；403 HTML/空 body → callback 永不调用、流挂起 | 整个回调体 try/catch + `callback(error)` |
| C12 | `build/lib/util.ts:234` | 裸 JSON.parse | `fs.readFile` 回调里解析 .map；`cb(err)` 只覆盖读文件 | try/catch 后 `cb(error)` |
| C13 | `build/lib/compilation.ts:297` | cwd 当仓库根 | `checkApiProposalNames(process.cwd())`；子目录启动 gulp → ENOENT/误判 | `path.dirname(path.dirname(import.meta.dirname))` |

### 4. 存疑保留项（2 处 bug + 11 处假守护，均不擅自改）

| # | 项 | 为什么保留 |
|---|---|---|
| R1 | `build/next/index.ts:759` `gulpWatch('src/**', {base: srcDir})` 的 glob 相对 cwd、`base` 却绝对 | 修（传 `cwd`）会改 watch 行为，需长驻/真机验证，属功能变更 |
| R2 | `copilotCli.test.ts:224` `process.env.XDG_STATE_HOME` 取 runner 而非 app.extraEnv | 该套件唯一用例 `it.skip`、调用的 `smoketest.openCopilotCliChat` 命令在 src 已不存在、仍起停 mock server，属「被测对象已消失的死测试」；整块删除牵连 `main.ts:32,465` 注册与共享 env，属测试裁剪，需单独决策 |
| R3 | 11 处测试假守护（恒真 `skipSuite ? it.skip : it.skip` ×3、硬编码 `skipSuite:true`、5 处无原因 `it.skip`、只断言不抛错、矛盾断言） | 上游有意禁用或语义问题；「启用被 skip 的测试」属功能变更且需真机 smoke（§6），按 AGENTS §7「保持与上游 diff 最小」不做 |

### 5. 依赖前后对比

**本轮无依赖变更。** deps 66 / devDeps 93 / scripts 79（均不变）；全仓零引用依赖 0。

### 6. 风险与回滚

| 风险 | 等级 | 回滚 |
|---|---|---|
| 删两个 screenshot CLI：若仓库外 CI 按 `node build/lib/xxx.ts` 直接调用则 git grep 看不到 | 低 | 本仓无 `.github/`、无 script、无 test 证据；`git revert b0d3bd26` |
| 删 networkProxy 孤链：将来恢复 agentsWindow 网络代理需重建 | 低 | `git revert b0d3bd26` |
| 删 shard.ts 条目：将来恢复那些套件需重新加权重 | 低 | 与「永不命中」严格等价；`git revert b0d3bd26` |
| C1 改 `after` 为 async + await：若 `retry` 本身挂起会拖住 after | 低 | 原本就是浮空调用，现在至少显式暴露；`git revert 5451edcd` |
| C11 改 fetch.ts 回调结构：重排了大段代码 | 中 | 逻辑逐行等价 + 外层 try/catch；`git revert 5451edcd` |
| C13 改仓库根推导：若有人依赖 cwd 语义 | 低 | 与 util.ts / electron.ts 口径一致；`git revert 5451edcd` |

**整体回滚**：`git revert --no-commit 6547a250..HEAD && git commit`。

### 7. 提交清单（2 个代码提交）

| # | 提交 | 类型 | 文件 | +/- |
|---|---|---|---|---|
| 1 | `b0d3bd26` chore(cleanup): 删 build/lib 与 test/smoke 的死文件/死符号 | 清理 | 9 | +3 / -1,212 |
| 2 | `5451edcd` fix(smoke/build): 修 13 处真实 bug | 功能 | 12 | +151 / -104 |

文档（问题清单 + 本报告 + 手册 §9.11.10）另计。

### 8. 扫描覆盖面

| 区域 | 本轮 | 结论 |
|---|---|---|
| `test/smoke/src/**`（排除已删 agentsWindow） | 全覆盖 | 2 死文件（+3 孤儿）、3 死符号、14 处残留（仅注释/惰性）、12 bug、11 假守护 |
| `build/next/**` | 全覆盖 | 0 死文件、入口链路全活、3 bug |
| `build/lib/**` 顶层 48 文件 | 全覆盖 | 2 死文件、3 bug；i18n.ts sessions 残留 0 |
| `src/vs/platform/dshClient/**` + `contrib/dsh/**` | 复扫 | TODO/死导出/空文件 0 |
| 全仓空目录 / .eslint-ignore 死条目 / 零引用依赖 | 复扫 | 0 / 0 / 0 |

### 9. 假设

1. **两个 screenshot CLI 无仓库外调用**：无 `.github/`、无 npm script、无 test import，属合理推断。
2. **networkProxy 孤链安全**：agentsWindow 已删，`.sh` 与 2 个 `.pac` 只互相引用。
3. **shard.ts 删除等价**：套件不存在 → 条目/常量永不命中，且删掉了随之恒真的预分配循环。
4. **smoke tsc 的 39 个错误是基线**：改动前后逐项比对完全一致（TS2307 是 automation 未编译产物，5 个 main.ts 错误为既存），不属本轮引入。
5. **假守护保留**：上游有意 skip，启用属功能变更且需真机，按 AGENTS §6/§7 不做。


## 第 8 轮

> 起点 `1bb666d7`，终点 `8e367bcb`。代码 **12 文件，+9 / -373**。两个提交：清理 `d6bd3f1f`、功能 `8e367bcb`。

### 1. 门禁总览

| 门禁 | 结果 |
|---|---|
| 主工程 `tsc --noEmit` | **PASS**（0 error；清理后、功能修复后各跑一次） |
| `npm run test-dsh:all` | **PASS**（**391** / fail 0；两次） |
| `node --test .eslint-plugin-local/tests/*.test.ts` | **PASS**（161 / fail 0，规则文件删除之后） |
| `verify:dsh-ide-ci` | **PASS**（五项，`DSH_INSTALLED_VERSION=0.2.2-rc.1`） |
| `npm run compile` | **PASS**（0 errors，1.12 min） |
| `node --check` `eslint.config.js`、`test/unit/node/index.js` | **PASS** |
| 真机 GUI / smoke | **PENDING**（AGENTS §6，由用户执行） |
| 全仓 ESLint | **PENDING**（既有 `header/header` 基线，本轮不把它标成 PASS） |
| `verify:dsh-install-drift` | **FAIL（预先存在）**：tarball `dist/dsh-ide-2.0.0.tgz` 时间是 2026-11-17 00:38，`host/ide-service.js` / `host/ide-view-host.js` 源码更晚。本轮未改这两个文件，也未打包 |

### 2. 删除清单与理由

| # | 位置 | 理由 |
|---|---|---|
| A1 | agent-host meta ESLint 规则 + 测试 + `eslint.config.js` 注册 | 守护目录已不存在。引用只有这三处；index 与测试脚本都是 glob |
| A2 | `eslint.config.js` 的 `'vs/sessions/~'` | 没有任何 `from 'vs/sessions` |
| A3 | `test/unit/node/index.js` 的 sessions web 测试排除 | 目标文件不存在 |
| A4 | `product.ts` 两行 roadmap JSDoc | 文件不存在。只删这两行 |
| A5–A9 | 5 个 chatContracts 导出 | 标识符 `git grep` 只有定义处；两个元数据字符串值也同样只有定义处。`isLocalAgentHostProviderDisabledByPolicy` 仍有 8 处调用，保留 |

### 3. 真实 bug 修复（7 个调用点，同一类）

归档取消、复制分支名、复制 commit hash、打开 browser pill、外链、预览文件、内部打开。全部是 `void` 一个返回 Promise 的调用且没有 catch。改为 `.catch(onUnexpectedError)`。

### 4. 依赖前后对比

**本轮无依赖变更。** dependencies 66、devDependencies 93、scripts 79。

### 5. 存疑保留项

`agentsWindow` 整套 proposal 与 setting override（`isSessionsWindow` 仍从 environment 读取）；邀请子系统；52 处注释 / `NOTICE.md` / `PROVENANCE.md`；starter contribution 里过时的 side-effect 注释；npm 的 `capabilities.agentsWindow`；把 Promise 交回 action runner 的 `run: () => writeText()`（没有证明 runner 会丢 rejection）。

### 6. 风险与回滚

| 风险 | 等级 | 回滚 |
|---|---|---|
| 删掉永不命中的 ESLint 规则后，若上游把 `agentHost/common/meta` 加回来，这条边界不再被 lint | 低 | `git revert d6bd3f1f` |
| 删两个元数据常量：旧数据库里若已写入这些 key，现在本来也没有读者 | 低 | 同上 |
| `.catch(onUnexpectedError)` 把原来的 unhandled rejection 变成日志 | 低 | `git revert 8e367bcb` |

### 7. 假设

1. 规则三件套删除后，glob 注册和测试收集都不需要改脚本。已用 161 项插件测试验证。
2. 两个元数据字符串没有动态拼接读者。`git grep` 全字面量只有定义处。
3. 不碰 `agentsWindow` proposal。删 d.ts 而不改 `extensionsApiProposals.ts` 会让 `check-api-proposal-names` 失败。

## 第 9 轮

> 起点 `69ff996c`，终点 `fd361a02`。没有删除。功能提交只改绑定竞态和关窗分发。

### 1. 门禁总览

| 门禁 | 结果 |
|---|---|
| 主工程 `tsc --noEmit` | **PASS**（0 error） |
| `npm run test-dsh:all` | **PASS**（**395** / fail 0；391 + 4） |
| 绑定竞态复现 | 修复前 **4/4 FAIL**，修复后 **4/4 PASS**（不连接 Host、不开窗口） |
| `verify:dsh-ide-ci` | **PASS**（五项，`DSH_INSTALLED_VERSION=0.2.2-rc.1`） |
| `npm run compile` | **PASS**（0 errors，1.58 min） |
| 全仓 ESLint | **PENDING**（未复跑；既有 header 基线） |
| 真机 GUI | **PENDING** |
| `verify:dsh-install-drift` | **FAIL（预先存在）**，本轮未打包 |

输出里的 `STATUS: FAIL [contract]` 来自负例「已安装版本 0.1.0 低于 0.2.2-rc.1」。套件随后仍是 pass 395 / fail 0，CI 汇总为 PASS。

### 2. 删除清单

**本轮无删除。** 复核过的候选要么仍被调用，要么只是调用处没有 `.catch` 但被调函数已经收口。

### 3. 修复

| # | 修复 |
|---|---|
| A1–A3 | `bind` 用代次丢掉过期回包，失败不再回滚更新的绑定；绑定尚未完成时，同一 id 不能短路成功。`refreshComposer` 同样丢掉过期目录 |
| A4 | 报到过程中 dispose 会补注销；poll 在 dispose 之后返回时不再调用 `onLaunch` |

### 4. 依赖前后对比

无依赖变更。dependencies 66、devDependencies 93、scripts 79。

### 5. 存疑保留

`agentsWindow` 配置仍被 `isSessionsWindow` 读取。第 8 轮删掉的 meta 规则如果要继续生效，必须改指向 `chatContracts/common/meta`，那是新的 lint 行为，本轮不做。`NOTICE.md` 与 `PROVENANCE.md` 不动。

### 6. 风险与回滚

| 风险 | 等级 | 回滚 |
|---|---|---|
| 被后来的 bind 盖过的那次调用现在返回 false，而不再返回 true | 低。这是修复本身 | `git revert` 本轮功能提交 |
| dispose 后多一次 unregister | 低。Host 对未知 client 会拒绝，注销失败已被吞掉 | 同上 |

### 7. 假设

测试数增加不代表覆盖率百分比已测量。本轮没有跑覆盖率工具。

## 累计（截至第 9 轮）

| 项 | 值 |
|---|---|
| tsc 错误 | 137 → **0** |
| test-dsh:all | 384 → **395**（全 PASS；第 9 轮 +4。减少的 5 项来自更早删掉的死模块） |
| dependencies | 68 → **66** |
| devDependencies | 100 → **93** |
| scripts | 86 → **79** |
| 锁文件条目 | 1,649 → **1,536**（-113，零新增、零版本变更） |
| `ce668543..HEAD` | **184 文件，+2,763 / -12,122**（53 个提交） |

**已知未完成项**：`verify:dsh-install-drift` FAIL（预先存在：`host/ide-service.js` / `host/ide-view-host.js` 与 2026-11-17 旧产物不一致），需重新打包后再验；真机 GUI / smoke 套件按 AGENTS §6 由用户执行；`agentsWindow` 配置集群仍保留。

