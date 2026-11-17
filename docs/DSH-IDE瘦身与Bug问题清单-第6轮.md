# DSH-IDE 瘦身与 Bug 问题清单（第 6 轮，按推荐方案执行）

> 编制时间：2026-11-18 00:55（Asia/Shanghai）
> 依据：HEAD `2b4f2504`（工作树 clean）。两个子智能体并行扫描：`scripts/chat-simulation` + `scripts/mock-policy-server`（上一轮仅模式扫描）与第 5 轮后的手册一致性。
> 按既定约定：不确定处不提问，写出问题 + 推荐方法后按推荐方法执行。

## A. 上一轮（第 5 轮）文档的定量偏差（6 处）

| # | 位置 | 类型 | 声明 | 实测 | 修法 |
|---|---|---|---|---|---|
| A1 | `手册:1035`（§9.11.6，第 4 轮记录） | 现状口吻写历史 | `agentsWindow/**`「整块保留」 | 第 5 轮 `8903ba72` 已删 | 补注「第 5 轮已删，见 §9.11.8」 |
| A2 | `手册:1057`（§9.11.8） | 定量口径 | 「`test/smoke/src/areas/agentsWindow/**` 6 文件 164 KB」 | smoke **5 文件 108,481 B**；`test/automation/src/agentsWindow.ts` **1 文件 56,366 B**；合计 6 文件 164,847 B | 拆写为「smoke 5 文件 108 KB + automation 1 文件 56 KB（合计 6 文件 164 KB）」 |
| A3 | `手册:1061` | 定量 | `test-dsh:all`「389 → 391」 | 第 4 轮末为 **388**，本轮为 391（**+3**） | 改为「388 → 391」 |
| A4 | `报告5:14` | 定量 | 「391，较第 4 轮 389 +2」 | 同 A3 | 改为「388，+3」 |
| A5 | `报告5:4` | 统计边界 | 终点 `90e19ae1` | 实际末次是 `85ad5953`（37 vs 40 文件） | 终点改为 `85ad5953` |
| A6 | `手册:301`（§3.5） | 行号漂移 | `package.json:85-94` 的 test/verify scripts | 实测在 **80–91** 行 | 改为 `package.json:80-91` |

## B. `scripts/chat-simulation` 的零引用符号（3 个）

| # | 位置 | 符号 | 判定依据 | 风险 | 建议 |
|---|---|---|---|---|---|
| B1 | `common/utils.js:753`（导出 `:840`） | `linearRegressionSlope` | 全仓仅定义 + 导出项两处命中，两个 test 脚本的 `require` 解构里都没有 | 无 | 删（函数 + 导出项） |
| B2 | `common/mock-llm-server.ts:26` | `ROOT` 常量 | 文件内仅 1 次出现（定义本身），`path` 只用于这一行 | 低 | 删（同时看 `path` 是否还有其他用途） |
| B3 | `common/mock-llm-server.ts:187` | `ScenarioBuilderImpl.burst()` | 全仓 `.burst(` 零命中 | 无 | 删 |

> **不删**：`utils.js` 的 `getElectronPath` / `preseedStorage` / `writeSettings` / `median` / `removeOutliers` 虽无外部消费者但在文件内被调用，只是「可降级导出」，删了无收益。
> **不是死文件**：`fixtures/_chatperf_*.ts`（8 个）经 `path.join(FIXTURES_DIR, name)` 字符串动态引用；`mock-policy-server/public/*` 经 `GUI_ASSETS` 白名单映射；`mock-llm-server.ts` 还被 `test/smoke/src/utils.ts:229` 跨目录引用。

## C. `scripts/chat-simulation` + `mock-policy-server` 的真实 bug（9 处，高危 0）

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

## D. 重复实现（5 组，低收益，本轮不动）

| # | 位置 | 函数 | 说明 |
|---|---|---|---|
| D1 | `fixtures/_chatperf_errors.ts:28` ↔ `:36` | `onUnexpectedError` / `onUnexpectedExternalError` | 逐字相同 |
| D2 | `mock-policy-server/public/app.ts:516` ↔ `server.ts:940` | `isPlainObject` / `isRecord` | 逐字相同，但 app.ts 是浏览器直服 IIFE，无模块系统 |
| D3 | `fixtures/_chatperf_async.ts:55` ↔ `:83` | `cancelTimeout` / `cancel` | 逐字相同（`clearTimeout` + 置 null） |
| D4 | `test-chat-perf-regression.js:1250` ↔ `:1266` | `round2` | 同一函数内重复定义 |
| D5 | `mock-policy-server/server.ts:825-859` ↔ `public/app.ts:292-323` | 三平台 install/remove 命令模板 | 4 段命令字符串逐字同源 |

> 判定：这些是**测试脚手架**（不在 DSH-IDE 产品代码里），且抽取会跨模块系统（CJS / 浏览器 IIFE / ESM）。按「收益 < 风险」保留，只记入报告。

## E. 执行批次

1. **批次 A（文档定量修正）**：A1-A6。
2. **批次 B（清理）**：B1-B3。
3. **批次 C（bug 修复）**：C1-C9（C7/C8 只改明显的正则与回退，不重构 scenario 语义）。
4. 门禁：tsc → `build-dsh-tests` → `test-dsh:all` → `verify:dsh-ide-ci` → `npm run compile`。
5. 输出第 6 轮报告 + 手册 §9.11.9。

## F. 假设

1. **B2**：`ROOT` 在 `mock-llm-server.ts` 里只被定义一次，删后 `path` 若还有其他用途则保留 import——先查再删。
2. **C4/C5 的失败策略**：损坏的 config/baseline 应「明确报错并提示删除」而不是静默回退默认值；这对 benchmark 是更安全的行为。
3. **C9 的注释剥离**：只处理 `//` 行内注释；`/* */` 块注释保持现状（config.jsonc 实际只用了 `//`）。
4. **D 组不动**：测试脚手架的重复实现不在产品路径上，且跨模块系统。
