# DSH-IDE 瘦身与 Bug 问题清单（第 7 轮，按推荐方案执行）

> 编制时间：2026-11-18 09:20（Asia/Shanghai）
> 依据：HEAD `6547a250`（工作树 clean）。本轮派 3 个子智能体（其中 `scan-build-lib` 首次失败，重派 `scan-build-lib-2`），覆盖此前未逐行扫过的 `test/smoke/src/**`、`build/next/**`、`build/lib/**`（顶层 48 文件）。
> 按既定约定：不确定处不提问，写出问题 + 推荐方法后按推荐方法执行。功能改动与清理改动**分开提交**。

## 0. 扫描结论概览

| 区域 | 死文件 | 死符号 | 残留 | 真实 bug | 假守护 |
|---|---|---|---|---|---|
| `test/smoke/src/**` | 2（+1 孤儿 .sh +2 .pac） | 3（+5 冗余导出） | 14 | 12 | 11 |
| `build/next/**` | 0 | 3 冗余导出 | 1 注释 | 3 | 0 |
| `build/lib/**` 顶层 | 2 | 0 | 0（i18n 已净） | 3 | 0 |

主智能体逐条复核：删掉低置信项、确认「已删目录残留」里 `vs/sessions`/`devTunnels`/`agentsWindow` 字面量均为 0（仅 "Agents Window" 显示名注释），`build/next` 入口链路 10 个文件全部活（由 `build/lib/esbuild.ts:28/52` 字符串 spawn）。

## A. 清理：死文件（7 个文件，零引用证据）

| # | 位置 | 判定依据（含动态/字符串引用） | 风险 |
|---|---|---|---|
| A1 | `build/lib/screenshotBlocksCi.ts` + `build/lib/screenshotDiffReport.ts` | `git grep -n` 排除自身后 **0 命中**；`.github/` 已删（`git ls-files .github` 空）；package.json 79 scripts 无 `screenshot/diff/blocks/report`；`screenshotComment.test.ts:8` 只 import `screenshotComment.ts`；唯一反向依赖是 `screenshotDiffReport.ts:29 → screenshotComment.ts`（删后 screenshotComment.ts 仍被其 test 用） | 低：两个独立 CLI，若仓库外 CI 直接 `node build/lib/xxx.ts` 调用则 grep 看不到，但本仓无任何证据 |
| A2 | `test/smoke/src/networkProxy/pacServer.ts` + `negotiateAuthHelper.ts` | 全仓唯一引用是 `test/smoke/scripts/run-agents-window-network-proxy.sh:234,253`；该 .sh **自身零引用**（`git grep` 无命中、package.json 无 script、`smoketest` script 不调它、名字里的 agentsWindow 已删）→ 整条是孤链 | 低 |
| A3 | `test/smoke/scripts/run-agents-window-network-proxy.sh` + `test/smoke/network-proxy/test.pac` + `test-kerberos.pac` | 与 A2 同链；2 个 .pac 只被该 .sh 的 `FIXTURE_DIR`/`PAC_FILE` 引用，除此之外全仓 0 命中 | 低 |
| A4 | `test/smoke/src/utils.ts:82 describeRepeat`、`:88 itRepeat`、`:347 retryWithRestart` | `git grep` 排除定义文件后 **0 命中**；删后 `import { Suite, Context } from 'mocha'` 的 `Suite`/`Context` 仅这 3 个函数用（`:56/:74/:106` 的 Suite/Context 是普通文本），可一并删 import | 无 |

**不删（有依据）**：`utils.ts` 的 `buildCopilotChatToken`(:243)/`getCopilotRuntimeLogDir`(:325) 虽无外部 import 但文件内自用（`:305/:512`），只是「可降级导出」；`build/next/build-fast.ts` 的 `BuildFastPlan`/`BuildFastPrerequisites`、`nls-plugin.ts` 的 `NLSPluginOptions` 同为内部类型导出，删除无收益。

## B. 清理：冗余配置（惰性，等价清理）

| # | 位置 | 内容 | 判定 | 风险 |
|---|---|---|---|---|
| B1 | `test/smoke/src/shard.ts:24,25,27,28,30,32` | `suiteDurations` 里 6 条 "Agents Window (...) AgentHost/Codex" 条目 | 对应套件已随 agentsWindow 删除 → `suiteDurations.get(title)` 永不命中、回退 `defaultSuiteDuration=20`，仅让分片估算失衡 | 低 |
| B2 | `test/smoke/src/shard.ts:42` + `:76` | `firstShardSuite = 'Agents Window (WSL Dev Container AgentHost)'` | 该套件不存在 → `assignments` 里 `suite.title === firstShardSuite` 恒 false；注释放的「pr-win32 只在首片装 WSL」契约本身已失效 | 低（删后行为与「永不命中」严格等价） |

## C. 真实 bug（本轮修 13 处；2 处记为存疑保留）

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

## D. 测试假守护（11 处，保留 + 说明，不擅自启用）

| 位置 | 形态 | 决策 |
|---|---|---|
| `task/task-quick-pick.test.ts:42,47,52` | `(options?.skipSuite ? it.skip : it.skip)` 两支恒 `it.skip` | 上游笔误，但「修成 `it : it.skip`」会启用 3 个从未跑过的 smoke 用例（行为变更、需真机验证）→ **保留**，仅记为已知 |
| `terminal/terminal.test.ts:48` | `setupTerminalStickyScrollTests({ skipSuite: true })` 硬编码 | 上游有意禁用 → 保留 |
| `accessibility:56,141`、`extensions:19`、`terminal-persistence:104`、`copilotCli:69` | `it.skip` 无原因 | 上游有意禁用 → 保留 |
| `workbench/launch.test.ts:21-24` | 只断言「不抛错」 | 启动冒烟本就如此 → 保留 |
| `chat/chatDisabled.test.ts:24-42` | 逻辑矛盾断言 | 上游语义，改需产品决策 → 保留 |

> 依据 AGENTS §7「不得重写上游代码、保持与上游 diff 最小」+「保证行为不变、覆盖率不降」：启用被上游有意 skip 的测试属功能变更，且真机 smoke 由用户执行（§6），本轮不做。

## E. 执行批次

1. **批次 A（清理，单独提交）**：A1-A4 + B1-B2。
2. **批次 B（功能修复，单独提交）**：C1-C13。
3. 门禁：tsc（含 `test/smoke/tsconfig.json` 的独立校验）→ `build-dsh-tests` → `test-dsh:all` → `verify:dsh-ide-ci` → `npm run compile`；对改动的 JS/TS 逐个 `node --check` / TS parse。
4. 输出第 7 轮报告 + 手册 §9.11.10。

## F. 假设

1. **删 screenshot CLI 安全**：本仓无 `.github/`、无 npm script、无 test import；独立 CLI 的「仓库外调用」无证据，属合理推断。
2. **删 networkProxy 孤链安全**：`.sh` 与 2 个 `.pac` 只互相引用，agentsWindow 已删，无任何 workflow/script 调用。
3. **删 shard.ts 条目等价**：套件不存在 → 条目/`firstShardSuite` 永不命中，删除不改变任何实际分片结果。
4. **C13 的仓库根推导**：`build/lib/compilation.ts` 在 `build/lib/` 下，向上两级即仓库根，与 `build/lib/util.ts:20` 一致。
5. **假守护保留**：上游有意 skip，启用属功能变更且需真机，按 AGENTS §6/§7 不做。
