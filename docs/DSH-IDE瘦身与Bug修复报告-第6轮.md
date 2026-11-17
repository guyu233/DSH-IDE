# DSH-IDE 瘦身与 Bug 修复报告（第 6 轮）

> 编制时间：2026-11-18 01:00（Asia/Shanghai）
> 起点：`2b4f2504`（第 5 轮结束）　终点：本轮末次
> 全区间：**8 个文件，+343 / -62 行**（含本文档与手册提交）
> 6 个提交：`5ecce9ae`（清理）→ `f66cf565`（bug 修复）→ `005cdf34`（文档校正）→ `e0b826eb`（问题清单）→ `09b5fe5c`（本报告+手册）→ `00536309`（统计补正）

## 1. 门禁总览

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

## 2. 删除清单与理由（B 批）

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

## 3. 真实 bug 修复（C 批，9 处，0 高危）

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

## 4. 文档定量校正（A 批，6 处）

| # | 位置 | 原值 | 新值 |
|---|---|---|---|
| A1 | 手册 §9.11.6 | agentsWindow「整块保留」 | 补注「第 5 轮已删除，见 §9.11.8」 |
| A2 | 手册 §9.11.8 | 「smoke 6 文件 164 KB」 | 「smoke 5 文件 108 KB + automation 1 文件 56 KB（合计 6 文件 164 KB）」 |
| A3 | 手册 §9.11.8 | `389 → 391` | `388 → 391（+3）` |
| A4 | 报告 5 | 「389 +2」 | 「388 +3」 |
| A5 | 报告 5 起点/终点 | 终点 `90e19ae1` | 终点 `85ad5953`（统计含文档提交） |
| A6 | 手册 §3.5 | `package.json:85-94` | `package.json:80-91` |

## 5. 依赖前后对比

**本轮无依赖变更。** scripts 79（不变）、deps 66、devDeps 93。

## 6. 存疑保留项

| # | 项 | 理由 |
|---|---|---|
| R1 | `scripts/chat-simulation` 的 5 组重复实现 | 测试脚手架，跨 CJS / 浏览器 IIFE / ESM 三套模块系统；抽取收益 < 风险 |
| R2 | `test/smoke/src/utils.ts` 等 5 个 smoke 套件对 `mock-llm-server.ts` 的路径字符串依赖 | 动态引用，必须保留 |
| R3 | `utils.js` 的 5 个「仅文件内自用」导出 | 可降级为非导出，但无收益 |
| R4 | `scripts/chat-simulation/jsconfig.json` | 无显式引用，但 `checkJs` 依赖它，不能删 |
| R5 | `mock-llm-server.ts` 的 3 个 TS2339（JSDoc 形参漏声明 `gcObjectStats`、`result.error` 联合类型未收窄） | 运行时由调用方真传，不崩；属 JSDoc 严谨性问题，不在本轮 5 类 bug 范围 |
| R6 | 第 5 轮的 `verify:dsh-install-drift` FAIL | 预先存在（旧产物 vs profile），需重新打包，按 §0.0 不打包 |

## 7. 风险与回滚

| 风险 | 等级 | 回滚 |
|---|---|---|
| 删 `linearRegressionSlope` / `ROOT` / `burst()`：若将来某个 scenario 用到会编译/运行失败 | 低 | 三者都是零引用，`git revert 5ecce9ae` |
| C1 的 `handleBody()` 改变错误路径：原本 unhandled rejection 现在回 500 | 低（行为改善） | `git revert f66cf565` |
| C4 的 `loadConfig` 由「静默回退」改为「抛错」：config 损坏时 benchmark 直接失败而非用默认值跑 | 低（行为改善，但更严格） | `git revert f66cf565` |
| C6 的 `ROOT` 优先：若有人故意从其它 cwd 用相对路径覆盖 schema 源，行为会变 | 低 | `git revert f66cf565` |
| C9 的状态机：若 config 里有 `//` 出现在非字符串非注释位置（非法 JSONC），行为可能与旧正则不同 | 低 | `git revert f66cf565` |

**整体回滚**：`git revert --no-commit 2b4f2504..HEAD && git commit`。

## 8. 提交清单（4 个）

| # | 提交 | 类型 | 文件 | +/- |
|---|---|---|---|---|
| 1 | `5ecce9ae` chore(cleanup): 删 chat-simulation 的 3 个零引用符号 | 清理 | 2 | +0 / -28 |
| 2 | `f66cf565` fix(scripts): 修 chat-simulation / mock-policy-server 的 9 处真实 bug | 功能 | 4 | +144 / -29 |
| 3 | `005cdf34` docs: 校正第 5 轮 6 处文档定量偏差 | 文档 | 2 | +6 / -6 |
| 4 | `e0b826eb` docs: 第 6 轮瘦身与 Bug 问题清单 | 文档 | 1 | +62 / 0 |

## 9. 扫描覆盖面

| 区域 | 覆盖 |
|---|---|
| `scripts/chat-simulation/**`（15 文件 / 266 KB） | **本轮全覆盖**（上一轮只做模式扫描） |
| `scripts/mock-policy-server/**`（5 文件 / 159 KB） | **本轮全覆盖** |
| `src/vs/platform/dshClient/**` + `src/vs/workbench/contrib/dsh/**` | 第 4/5 轮已扫，本轮复扫 TODO/死导出，**0 命中** |
| `build/lib/**`、`build/next/**` | 第 5 轮已扫；本轮删 devTunnelsWeb 后无新增死文件 |
| 全仓空目录 / .eslint-ignore 死条目 / 零引用依赖 | **0 / 0 / 0** |

## 10. 假设

1. **`ROOT` 删除安全**：`path` 模块在 `mock-llm-server.ts` 内只剩 ROOT 一处用途，删后 `path.` 前缀零命中（已实测）。
2. **`handleBody` 的 500 语义**：mock server 的失败应显式回 500 而不是让进程挂掉；benchmark 侧会因 HTTP 错误而非超时失败，更容易定位。
3. **`loadConfig` 抛错**：损坏的 config 应阻断运行而不是用默认值；这是 benchmark 更安全的行为。
4. **`ROOT` 优先于 cwd**：仓库根是 schema 的真实位置；cwd 只作为「用户显式从别处启动」的兜底。
