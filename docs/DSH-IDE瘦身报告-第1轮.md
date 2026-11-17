# DSH-IDE 瘦身报告（第 1 轮）

> 编制时间：2026-11-17 20:30（Asia/Shanghai）
> 依据：`docs/DSH-IDE改造开发手册.md` §9.11、`docs/DSH-IDE瘦身问题清单-第1轮.md`、AGENTS.md
> 起点提交：`ce668543`（capabilities 方案一）
> 终点提交：`980bcf5b`（welcome 测试对齐）
> 全区间：**89 个文件，+156 / -4620 行**

## 1. 门禁总览

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

## 2. 删除清单与理由

### 2.1 源码死模块 / 死资源（4 个文件，8,695 B）

| 文件 | 理由 | 无引用证明 |
|---|---|---|
| `src/vs/platform/dshClient/common/dshIdeLocationIndex.js` | `indexLocations` 零调用；`491d92f0` 改为 typed 状态层后无消费者 | 全仓 `git grep` 仅定义本身 + gulp staging 行（已同步删） |
| `src/vs/workbench/contrib/dsh/browser/dshChatModelDriver.ts` | 7 行注释空壳，无 export、无 import | 全仓仅 verify 清单（已删该行）与反向断言（保留） |
| `src/vs/workbench/contrib/dsh/browser/media/dshModelMenu.css` | `dshModelMenu.ts` 已删，CSS 无任何引用 | 无 CSS import、无路径引用 |
| `src/vs/workbench/contrib/dsh/browser/dshSessionItemState.ts` | 生产零引用；controller 已内联等价逻辑 | 仅 `build/lib/test/dshSessionItemState.test.ts` 引用，测试同步删除 |

### 2.2 死符号（file-level export 删除）

| 符号 | 文件 | 证明 |
|---|---|---|
| `onDidChangeDshComposerSource` + `listeners` 集合 | `dshComposerRegistry.ts` | 零调用点；`setDshComposerSource` 改为直接赋值 |
| `sessionTimingForRunning` | `dshSessionTree.ts` | 零引用（controller 用内联实现） |
| `AssistantBlockLike` | `dshChatModel.ts` | 零引用 |

> `dshIdeContract.ts` 的 `DSH_IDE_CONTRACT_API_VERSION` / `DSH_IDE_CONTRACT_WIRE_REVISION` **保留**：`verify:dsh-ide-protocol-single-source` 显式断言 `contract must import protocol constants`，删除会让门禁 FAIL。此项从「删除候选」降级为「存疑保留」。

### 2.3 测试与测试基础设施

| 文件 | 理由 |
|---|---|
| `build/lib/test/dshSessionItemState.test.ts`（2,430 B，5 测试） | 随死模块删除 |
| `build/lib/dsh/CHAT-RENDER.md`（4,258 B） | 描述的 `chatContentParts/dsh/` 目录已不存在，内容与当前原生渲染不符，全仓无引用 |
| `test/componentFixtures/**`（20 文件） | component-explorer CLI 已在 `edfd09bf` 删除，夹具只剩自引用 |

### 2.4 冗余配置

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

### 2.5 依赖（前后对比）

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

## 3. 功能改动（与清理分开提交）

| 提交 | 文件 | 性质 |
|---|---|---|
| `07f9def4` | `agentHostChatInputPicker.ts` | **Bug 修复**：`CODEX_APPROVALS_LEARN_MORE_URL` 全仓无定义，运行到即 ReferenceError，改为已定义的 `PERMISSIONS_LEARN_MORE_URL` |
| `908b35e6` | 17 个文件 | 类型对齐：137 → 0（含 `agents` 字段删除、`IAgentHostMcpServer` 结构化、6 个测试 mock 签名） |
| `44f9a056` | 3 个协议测试 | HEAD `ce668543` 改了契约（wireRevision 5→4、method 42→43）但漏改测试，本提交补上 |
| `afed5f18` | `genDshIconDataUris.mjs` | 去掉硬编码 `E:/deepseek-harness/...`，改 `DSH_ARTWORK_TS` 环境变量 |
| `980bcf5b` | `chatWidget.test.ts` | 测试断言对齐 DSH 文案（HEAD 起即失败的过时用例） |

## 4. 存疑保留项

| # | 项 | 为什么保留 |
|---|---|---|
| R1 | `isRecord` 六份、`stringOf`/`numberOf` 各两份 | 跨 Host-side JS / electron-main / workbench 三层；抽公共模块要改 gulp staging 与 `verify:dsh-ide-boundary` 的层规则，收益小于风险。建议单列后续任务 |
| R2 | `dshIdeSessionListModel.ts` + `dshIdeSessionsService.ts` 列表链 | 文档明确「显示主链是 controller，操作用 sessions service」；删旧链会改 `createSession()` 与搜索命令行为 |
| R3 | `dshIdeContract.ts` 两个 CONTRACT_* 常量 | 删除会让 `verify:dsh-ide-protocol-single-source` FAIL（该门禁断言 contract 必须 import protocol 常量） |
| R4 | `build/lib/dsh/CHAT-RENDER.md` 的同类文档 `ICON-PROVENANCE.md` | 后者仍准确描述生成物，只改源仓库 URL，不删 |
| R5 | `build/monaco/version.txt`（0 字节） | `build/gulpfile.editor.ts:188-193` 会写入内容，是模板占位 |
| R6 | `src/vs/platform/dshClient/index.js:45,67` 的 `console.log` | Host 端点发布/桥接成功的运行日志，非临时调试 |
| R7 | `.eslint-allowed-bracket-notation-files` 内 `# Copilot extension` / `# Agent Host platform` 段落标题 | 段落已整段清空并删除；其余段落标题与计数已重算 |

## 5. 风险与回滚

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

## 6. 提交清单（11 个，功能与清理分开）

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

## 7. 手册未覆盖处的处理

1. **覆盖率**：DSH 侧无既有覆盖率命令，本轮以 `test-dsh:all` 的项数与通过率不降为等价证据（384 全过）。如需真实行覆盖率，可用现有 `c8`（已在 devDeps）新增脚本，不新增依赖，待确认。
2. **`genDshIconDataUris.mjs --check`**：需官方 `artwork.ts`；按 AGENTS §3 不在本机保留整仓副本，故为 PENDING。
3. **全仓 ESLint**：DSH 文件版权头是 `DSH-IDE contributors`，与上游 `header/header` 规则不符，HEAD 起即报错；本轮不扩大范围改版权头（会触碰许可证边界），记 PENDING。
4. **`node_modules` 里的 extraneous 包**：`npm install --package-lock-only` 只改锁文件，磁盘上的包还在；如需回收磁盘可 `npm prune`，不影响仓库瘦身结论。
