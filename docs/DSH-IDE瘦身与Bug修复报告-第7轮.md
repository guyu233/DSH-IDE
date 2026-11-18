# DSH-IDE 瘦身与 Bug 修复报告（第 7 轮）

> 编制时间：2026-11-18 09:40（Asia/Shanghai）
> 起点：`6547a250`（第 6 轮结束）　终点：本轮末次
> **代码改动：20 个文件，+154 / -1,316 行**（`git diff --shortstat 6547a250..HEAD`，不含后续文档提交）
> 2 个代码提交：`b0d3bd26`（清理）→ `5451edcd`（功能修复）；文档另计

## 0. 子智能体派发

本轮开局检查可用模型：`workbuddylocal/cli2api`（本 session 不允许作 child 路由），沿用默认路由派 3 个：
- `scan-smoke-next`：`test/smoke/src/**` + `build/next/**` → 完成，4 节结论
- `scan-build-lib`：**首次失败**（无 closing message），立即重派 `scan-build-lib-2`（收窄为 3 个明确问题）→ 完成
- 主智能体对两份报告逐条复核，删掉低置信项、补验动态引用证据

## 1. 门禁总览

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

## 2. 删除清单与理由（A 批，7 文件 + 3 符号 + 3 配置）

| # | 位置 | 判定依据（含动态/字符串引用） | 删除量 |
|---|---|---|---|
| A1 | `build/lib/screenshotBlocksCi.ts` + `screenshotDiffReport.ts` | `git grep` 排除自身 **0 命中**；`.github/` 已删（`git ls-files .github` 空）；package.json 79 scripts 无相关项；`screenshotComment.test.ts:8` 只 import `screenshotComment.ts`（**保留**）。唯一反向依赖 `screenshotDiffReport.ts:29 → screenshotComment.ts` 随之消失 | ~22 KB |
| A2 | `test/smoke/src/networkProxy/{pacServer,negotiateAuthHelper}.ts` + `run-agents-window-network-proxy.sh` + `{test.pac,test-kerberos.pac}` | 整条孤链：两个 .ts 唯一引用是那个 .sh；2 个 .pac 只被该 .sh 的 `FIXTURE_DIR`/`PAC_FILE` 引用；而 .sh 自身无任何 workflow/script 调用（agentsWindow 已删、`smoketest` script 不调它） | 5 文件 |
| A3 | `test/smoke/src/utils.ts` 的 `describeRepeat`/`itRepeat`/`retryWithRestart` | `git grep` 排除定义文件 **0 命中**；连带删不再使用的 `import { Suite, Context } from 'mocha'` | 34 行 |
| B1/B2 | `test/smoke/src/shard.ts` | 删 `suiteDurations` 里 6 条已不存在 "Agents Window" 套件条目、失效的 `firstShardSuite` 常量，及随之恒真的 `assignments.forEach` 预分配循环（对应套件不存在 → 判断恒 false，删除与现状严格等价） | 19 行 |

**删前严格要求（已满足）**：每个删除都查了 `import` / `package.json script` / workflow / 字符串路径 / 动态 `path.join` 五种引用形态。

**不删（有依据）**：`utils.ts` 的 `buildCopilotChatToken`/`getCopilotRuntimeLogDir` 与 `build/next` 的 3 个内部类型导出虽无外部消费者，但文件内自用，仅属「可降级导出」；`build/next/**` 10 个非测试文件全部活（经 `build/lib/esbuild.ts:28/52` 字符串 spawn 链路）；24 个 area 测试全部在 `main.ts` 注册，terminal-*/task-quick-pick 为父套件嵌套子模块，非独立入口。

## 3. 真实 bug 修复（B 批，13 处）

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

## 4. 存疑保留项（2 处 bug + 11 处假守护，均不擅自改）

| # | 项 | 为什么保留 |
|---|---|---|
| R1 | `build/next/index.ts:759` `gulpWatch('src/**', {base: srcDir})` 的 glob 相对 cwd、`base` 却绝对 | 修（传 `cwd`）会改 watch 行为，需长驻/真机验证，属功能变更 |
| R2 | `copilotCli.test.ts:224` `process.env.XDG_STATE_HOME` 取 runner 而非 app.extraEnv | 该套件唯一用例 `it.skip`、调用的 `smoketest.openCopilotCliChat` 命令在 src 已不存在、仍起停 mock server，属「被测对象已消失的死测试」；整块删除牵连 `main.ts:32,465` 注册与共享 env，属测试裁剪，需单独决策 |
| R3 | 11 处测试假守护（恒真 `skipSuite ? it.skip : it.skip` ×3、硬编码 `skipSuite:true`、5 处无原因 `it.skip`、只断言不抛错、矛盾断言） | 上游有意禁用或语义问题；「启用被 skip 的测试」属功能变更且需真机 smoke（§6），按 AGENTS §7「保持与上游 diff 最小」不做 |

## 5. 依赖前后对比

**本轮无依赖变更。** deps 66 / devDeps 93 / scripts 79（均不变）；全仓零引用依赖 0。

## 6. 风险与回滚

| 风险 | 等级 | 回滚 |
|---|---|---|
| 删两个 screenshot CLI：若仓库外 CI 按 `node build/lib/xxx.ts` 直接调用则 git grep 看不到 | 低 | 本仓无 `.github/`、无 script、无 test 证据；`git revert b0d3bd26` |
| 删 networkProxy 孤链：将来恢复 agentsWindow 网络代理需重建 | 低 | `git revert b0d3bd26` |
| 删 shard.ts 条目：将来恢复那些套件需重新加权重 | 低 | 与「永不命中」严格等价；`git revert b0d3bd26` |
| C1 改 `after` 为 async + await：若 `retry` 本身挂起会拖住 after | 低 | 原本就是浮空调用，现在至少显式暴露；`git revert 5451edcd` |
| C11 改 fetch.ts 回调结构：重排了大段代码 | 中 | 逻辑逐行等价 + 外层 try/catch；`git revert 5451edcd` |
| C13 改仓库根推导：若有人依赖 cwd 语义 | 低 | 与 util.ts / electron.ts 口径一致；`git revert 5451edcd` |

**整体回滚**：`git revert --no-commit 6547a250..HEAD && git commit`。

## 7. 提交清单（2 个代码提交）

| # | 提交 | 类型 | 文件 | +/- |
|---|---|---|---|---|
| 1 | `b0d3bd26` chore(cleanup): 删 build/lib 与 test/smoke 的死文件/死符号 | 清理 | 9 | +3 / -1,212 |
| 2 | `5451edcd` fix(smoke/build): 修 13 处真实 bug | 功能 | 12 | +151 / -104 |

文档（问题清单 + 本报告 + 手册 §9.11.10）另计。

## 8. 扫描覆盖面

| 区域 | 本轮 | 结论 |
|---|---|---|
| `test/smoke/src/**`（排除已删 agentsWindow） | 全覆盖 | 2 死文件（+3 孤儿）、3 死符号、14 处残留（仅注释/惰性）、12 bug、11 假守护 |
| `build/next/**` | 全覆盖 | 0 死文件、入口链路全活、3 bug |
| `build/lib/**` 顶层 48 文件 | 全覆盖 | 2 死文件、3 bug；i18n.ts sessions 残留 0 |
| `src/vs/platform/dshClient/**` + `contrib/dsh/**` | 复扫 | TODO/死导出/空文件 0 |
| 全仓空目录 / .eslint-ignore 死条目 / 零引用依赖 | 复扫 | 0 / 0 / 0 |

## 9. 假设

1. **两个 screenshot CLI 无仓库外调用**：无 `.github/`、无 npm script、无 test import，属合理推断。
2. **networkProxy 孤链安全**：agentsWindow 已删，`.sh` 与 2 个 `.pac` 只互相引用。
3. **shard.ts 删除等价**：套件不存在 → 条目/常量永不命中，且删掉了随之恒真的预分配循环。
4. **smoke tsc 的 39 个错误是基线**：改动前后逐项比对完全一致（TS2307 是 automation 未编译产物，5 个 main.ts 错误为既存），不属本轮引入。
5. **假守护保留**：上游有意 skip，启用属功能变更且需真机，按 AGENTS §6/§7 不做。
