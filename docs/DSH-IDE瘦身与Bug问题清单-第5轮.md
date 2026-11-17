# DSH-IDE 瘦身与 Bug 问题清单（第 5 轮，按推荐方案执行）

> 编制时间：2026-11-18 00:15（Asia/Shanghai）
> 依据：HEAD `9919cd20`（工作树 clean）。两个子智能体并行扫描：sessions 残留网络、构建/测试细小 bug。
> 按既定约定：不确定处不提问，写出问题 + 推荐方法后按推荐方法执行。

## A. 第 4 轮修复引入的回归（最高优先级，5 处）

| # | 位置 | 类型 | 问题 | 判定依据 | 风险 | 推荐修法 |
|---|---|---|---|---|---|---|
| A1 | `dshChatSession.ts:228-230,246-254` | 状态不一致（**高危**） | B2 的「失败回滚 `boundSessionId = previous`」与开头的 `if (sessionId === this.boundSessionId) return true` 组合成死锁：A 已绑定 → bind(B) 失败 → 再 bind(A) 直接 return true，但 `model.clear()` 已执行 → **面板永久空白** | 读 `:228` 短路 + `:246` 失败分支 + `:231` 的 `model.clear()` | 高 | 新增 `_boundDirty` 标志：短路条件加 `&& !this._boundDirty`；失败时置 true，成功时置 false。这样 bind(previous) 会真正重跑 rebind |
| A2 | `dshClientService.ts:102,160-166` + `dsh.contribution.ts:142-149` | 状态不一致（中） | B4 的 `consumer.reset()` 挂在 `onDidChangeState(connected===true)`，但 `_connected` 全仓无置 false 路径 → 该事件每窗口最多触发一次，**重连时不会 reset，熔断依旧只能靠重载窗口** | `git grep '_connected'` 只有 `= false` 初值与 `markConnected()` 置 true；`publishDisconnected`（`ide-view-service.ts:184-195`）只发 `rebuild` 快照 | 中 | 在 `DshClientService` 的 snapshot 监听里：`snapshot.state.state === 'rebuild'` 时 `markDisconnected()`（置 false + fire `{connected:false}`）。这是 Host 已明确表达的「正在重连」信号 |
| A3 | `dshIdeTransport.ts:158-172` | 资源泄漏（低） | B10 的顺序调整把 `throwIfAborted()` 放在 `try` 之前；若 signal 已 abort，抛错跳过 `finally`，`cancel`/`onAbort` 监听器永久挂在调用方的 signal 上 | 读 `:166-172`：`_pendingCalls.add` 与 `try` 在 `throwIfAborted()` 之后 | 低 | 把 `throwIfAborted()` 移进 `try` 第一行 |
| A4 | `dshIdeBackendFactory.ts:247-252` | 异步错误（低） | B5 的 `.catch` 无条件 `this.authenticating = undefined`；若期间 `close()`/新 `ensureImpl()` 已换成新 Promise，旧 rejection 会抹掉新的，导致并发重复鉴权 | 读 `:238-252` | 低 | 用局部 `const attempt = (async () => {...})()`，catch 里 `if (this.authenticating === attempt)` 才清空 |
| A5 | `dshIdeProtocol.ts:93-95` | 语义未固化（低） | B3 的「缺席即保留」使 `plan`/`goal` 在同一绑定内无法用「省略」清空 | `acceptView` 现为 `view.plan !== undefined ? view.plan : this._plan` | 低 | 在 `DshIdeViewSnapshot.plan/goal/todos` 的注释里固化「缺席 = 本帧没带，保留上一次；关闭计划用 `{active:false}`」 |

## B. 已删 `src/vs/sessions/**` 的残留（可安全清理）

| # | 位置 | 类型 | 判定依据 | 风险 | 建议 |
|---|---|---|---|---|---|
| B1 | `eslint.config.js` 12 个整块（1940-1950、2084-2104、2105-2125、2126-2146、2147-2163、2164-2181、2182-2197、2198-2212、2213-2232、2233-2249、2250-2276、2384-2415），共约 54 处 `vs/sessions` | 冗余配置 | `code-import-patterns.ts:63` 只做 `minimatch(relativeFilename, config.target)`，**不 stat 磁盘**；target 全部指向不存在的文件/目录 → 永不匹配、不报错、零行为变化。2384-2415 是 `no-restricted-imports`，`files` 匹配不到文件同样静默跳过 | 无 | 删 |
| B2 | `eslint.config.js:1863` 的 `'vs/sessions/~'`（在 `src/vs/workbench/contrib/*/~` 的 restrictions 里） | 冗余配置 | 该 target **覆盖数千个现存文件**；删掉是「允许清单收窄」，当前全仓 0 处 `vs/sessions` import 所以今天不报错，但语义变了 | 低 | **保留**（不属「等价清理」） |
| B3 | `build/stylelint.ts:37,97` + 注释 25/90/186 | 死逻辑 | `designSystemPattern` 指向已删目录 → 正则永假；但只删 37 行会让 97 行引用未定义变量（tsc 失败），无条件执行会让全仓 CSS 冒大量建议（行为变化） | 低 | 删 37 行；97 行改为 `reportDesignTokenSuggestions && designTokensEverywhere`（与现状严格等价）；删 3 处注释 |
| B4 | `build/lib/i18n.ts:395,420-424` + `build/lib/test/i18n.test.ts:36,46-47,57-58` | 死分支 | 只删实现 → 2 条断言走 `getResource()` 的 throw；只删断言 → 实现成死分支。**必须成对删** | 低 | 成对删（8 行） |
| B5 | `src/tsec.exemptions.json:16,43` 的 `vs/sessions/electron-browser/sessions.ts` | 冗余配置 | 文件不存在，tsec 只按路径字符串比对，永不命中 | 无 | 删 |
| B6 | `test/smoke/src/areas/agentsWindow/**`（6 文件）+ `test/automation/src/agentsWindow.ts` + 5 处 wiring | **死测试**（108 KB + 56 KB） | 被测对象全不存在：`src/vs/platform/agentHost/**`、`src/vs/sessions/**`、`out/vs/platform/agentHost/**` 均 `Test-Path=False`；`agentsWindow.ts:69` 调的 `workbench.action.openWorkspaceInAgentsWindow` 全仓无此命令 | 中（测试裁剪） | 删 7 个文件；改 `test/smoke/src/main.ts:37,470`、`test/automation/src/workbench.ts:26,53,75`、`test/automation/src/index.ts:31` |
| B7 | `build/next/devTunnelsWeb.ts` + `package.json` 的 `bundle-dev-tunnels-web` + 其 test | 死构建 | `devTunnelsWebOutDir = 'vs/sessions/contrib/providers/remoteAgentHost/browser'`，每次 build 重建 `out/vs/sessions/...`；全仓无代码 import 其产物 | 中（构建脚本） | 删（脚本 + npm script + test） |

## C. 构建/测试脚本的真实缺陷（6 处）

| # | 位置 | 类型 | 问题 | 判定依据 | 风险 | 修法 |
|---|---|---|---|---|---|---|
| C1 | `build/lib/test/dshIdeEndpoints.test.ts:92-94,144-148,167` | 测试假守护 | `WIRED` 含全部 7 个 finding → `UNVERIFIED` 恒为空数组 → `for (const method of UNVERIFIED)` 一次不执行，`assert.equal(UNVERIFIED.length, 0)` 恒真 | 读 `:92` 的 7 个 method 与 `:158-161` 的 7 个完全一致 | 中 | 改为显式表：`WIRED` 7 项 + `UNVERIFIED` 显式空数组常量，并断言 `FINDINGS.every(f => WIRED.includes(f.method) || UNVERIFIED.includes(f.method))` |
| C2 | `build/lib/test/dshStageNumbering.test.ts:29` | 路径写错 | `dshIdeProjection.test.ts` 不存在（实际 `dshIdeProjections.test.ts`）；`walk()` 的 `catch { return; }` 吞掉 stat 失败 → 该文件从未被扫描 | `Test-Path` + 文件名比对 | 低-中 | 改文件名；`walk` 的 catch 改为收集 `missing` 并 `assert.deepEqual(missing, [])` |
| C3 | `build/lib/dsh/verify/dshIdeVerify.mjs:336-360` | 版本比较错 | 预发布标签用字符串比较 → `rc.10 < rc.9`；且重复实现，未复用 `dshIdeContract.ts` 的 `compareVersion` | 读 `:357` 的 `a.pre > b.pre` | 中 | 改为复用 `installedMeetsVersion()`（从 contract 读源码或直接 import） |
| C4 | `build/lib/dsh/verify/dshInstallDrift.mjs:74-77,150-160` | 逻辑错 | ① `artifactBuffer.length > 0` 才比对 → 空文件永不检测；② `collectJs` 对缺失 `host/` 目录直接抛 ENOENT，不打印 `STATUS: FAIL` | 读两处条件 | 低-中 | ① 去掉长度条件；② `collectJs` 入口加 `existsSync` 守卫并记入 `syntaxIssues` |
| C5 | `build/lib/dsh/verify/dshArtifactContents.mjs:24` | 路径依赖 cwd | `repoRoot = process.cwd()`，与 `dshIdeVerify.mjs:24` 的 `import.meta.dirname` 口径不一致；非仓库根调用会误报 | 读两处 | 低 | 改用 `path.resolve(import.meta.dirname, '../../../..')` |
| C6 | `build/lib/dsh/genDshIconDataUris.mjs` | 门禁未接线 | `--check` 逻辑存在但无 npm script、无 CI step、测试只断言 104 个 glyph 不校验内容 | `package.json` 无对应 script | 中 | 加 `verify:dsh-icons` npm script，先手动跑一次确认 PASS 再决定是否纳入 CI |

## D. 文档/凭据（只报告，不动）

| # | 位置 | 问题 | 决策 |
|---|---|---|---|
| D1 | `build/lib/dsh/PROVENANCE.md:5` vs `:11-14` | 第 5 行称「已同步到 0.2.2-rc.3」，权威版本表仍写 `0.2.2-rc.1` | AGENTS §5 法律凭据，**只记录不动**，由维护者确认 |
| D2 | `test/smoke/src/areas/agentsWindow/**` 删除后，手册 §6/README 里若有 smoke 说明 | 待核 | 若命中则同步改文档 |

## E. 执行批次

1. **批次 A（回归修复，功能提交）**：A1-A5 + 补 A1 的回归测试用例。
2. **批次 B（清理提交）**：B1、B3、B4、B5、B6、B7（B2 保留）。
3. **批次 C（脚本/测试修复提交）**：C1-C6。
4. 门禁：tsc → `build-dsh-tests` → `test-dsh:all` → `verify:dsh-ide-ci` → `verify:dsh-artifact` → `npm run compile`。
5. 输出第 5 轮报告 + 手册 §9.11.8。

## F. 假设

1. `DshClientService` 用 `rebuild` 快照判「断开」是正确信号：Host 的 `publishDisconnected` 只在传输断开时发它。
2. 删 `agentsWindow` smoke 区不减少有效覆盖：被测源码与 out 产物都不存在。
3. `devTunnelsWeb` 产物无消费者：全仓 grep 其输出路径只命中 build 自身。
4. `genDshIconDataUris --check` 若跑出漂移，则本轮只加脚本不纳入 CI，避免引入失败门禁。
