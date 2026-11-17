# DSH-IDE 瘦身与 Bug 修复报告（第 5 轮）

> 编制时间：2026-11-18 00:35（Asia/Shanghai）
> 起点：`9919cd20`（第 4 轮结束）　终点：`85ad5953`（第 5 轮文档提交；统计口径含文档）
> 全区间：**40 个文件，+422 / -3,910 行**（含本文档与手册提交）
> 4 个提交：`3a3c7336`（回归修复）→ `8903ba72`（清理）→ `90e19ae1`（脚本/测试缺陷）→ 文档

## 1. 门禁总览

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

## 2. 第 4 轮修复引入的回归（5 处，全部修复）

| # | 位置 | 问题 | 修法 | 严重度 |
|---|---|---|---|---|
| A1 | `dshChatSession.ts` | **高危**：`bind()` 失败回滚 `boundSessionId = previous` 与开头「相同 id 短路」组合 → A 已绑定 → bind(B) 失败 → 再 bind(A) 直接 return true，但 `model.clear()` 已执行 → **面板永久空白** | 新增 `_boundDirty`：短路条件加 `&& !this._boundDirty`，失败置 true、成功置 false | **高** |
| A2 | `dshClientService.ts` + `dsh.contribution.ts` | `consumer.reset()` 挂在 `onDidChangeState({connected:true})`，但 `_connected` 无置 false 路径 → 该事件每窗口最多一次，**重连不 reset，熔断仍只能重载窗口** | snapshot 监听里按 Host 的 `rebuild` 快照调新增 `markDisconnected()`；重连成功再 `markConnected()` | 中 |
| A3 | `dshIdeTransport.ts` | `throwIfAborted()` 在 `try` 外 → signal 已 abort 时跳过 `finally`，abort 监听器永久留在调用方 signal 上 | 移进 `try` 第一行 | 低 |
| A4 | `dshIdeBackendFactory.ts` | `authenticating` 的 catch 无条件清空，可能抹掉期间新建的 promise | 局部 `attempt` + `if (this.authenticating === attempt)` 才清 | 低 |
| A5 | `dshIdeProtocol.ts` | 「缺席即保留」语义未固化 | 在 `DshIdeViewSnapshot` 的 plan/goal/todos 上加契约注释（缺席=保留，显式空值=关闭） | 低 |

**新增回归测试**：A→B(失败)→A 必须真正重绑（`dshChatSessionExtras.test.ts`）。

## 3. 删除清单与理由（B 批）

| # | 位置 | 内容 | 判定依据 | 删除量 |
|---|---|---|---|---|
| B1 | `eslint.config.js` | 12 个纯 `src/vs/sessions/**` 配置块 | `code-import-patterns.ts:63` 只做 `minimatch`，**不 stat 磁盘**；target 全部指向不存在的文件/目录 → 永不匹配、不报错、零行为变化 | 236 行 |
| B3 | `build/stylelint.ts` | 死正则 `designSystemPattern` + 3 处注释 | 指向已删目录 → 正则永假；`if` 条件改为 `reportDesignTokenSuggestions && designTokensEverywhere`（与现状严格等价） | 10 行 |
| B4 | `build/lib/i18n.ts` + `i18n.test.ts` | `sessionsProject` 与两个 `vs/sessions` 分支 + 2 条断言 | 成对删（只删一边会让 `getResource()` throw） | 17 行 |
| B5 | `src/tsec.exemptions.json` | 2 条 `vs/sessions/electron-browser/sessions.ts` 白名单 | 文件不存在，tsec 只按路径字符串比对 | 2 条 |
| B6 | `test/smoke/src/areas/agentsWindow/**` + `test/automation/src/agentsWindow.ts` + 5 处 wiring | **死测试区** | 被测的 `src/vs/platform/agentHost/**`、`src/vs/sessions/**`、`out/vs/platform/agentHost/**` 全部不存在；`agentsWindow.ts:69` 调的命令全仓无定义 | 6 文件 / 164 KB |
| B7 | `build/next/devTunnelsWeb.ts` + entry + 4 个 shim + test + npm script | **死构建脚本** | outDir 写死 `vs/sessions/contrib/providers/remoteAgentHost/browser`（已删 feature）；产物 `devTunnelsModule.js` 全仓无 import | 7 文件 / scripts 80→79 |

> **保留**：`eslint.config.js:1863` 的 `'vs/sessions/~'` —— 它在覆盖数千现存文件的 target 的允许清单里，删掉是「允许清单收窄」而不是等价清理。

## 4. 构建/测试脚本的真实缺陷（C 批，6 处）

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| C1 | `dshIdeEndpoints.test.ts:92-94` | `UNVERIFIED = FINDINGS.filter(not in WIRED)`，而 WIRED 含全部 7 项 → 恒为空数组 → `for` 循环一次不执行 → **守护形同虚设** | 显式 `const UNVERIFIED: readonly string[] = []` + 新增「每条 finding 必须落在 WIRED 或 UNVERIFIED 之一」断言 |
| C2 | `dshStageNumbering.test.ts:29` | 扫描根 `dshIdeProjection.test.ts` 拼错（实际 `dshIdeProjections.test.ts`），`catch { return }` 吞掉 stat 失败 → 该文件从未被扫描 | 改正文件名 + `missingRoots` 收集 + `assert.deepEqual(missingRoots, [])` |
| C3 | `dshIdeVerify.mjs` + `dshIdeContract.ts` | prerelease 整段字符串比较 → `rc.10 < rc.9` | 契约抽出 `comparePrerelease()` 按 semver 逐段数字比较；verify 按同一语义实现；新增结构断言测试 |
| C4 | `dshInstallDrift.mjs` | ① 空文件永不比对（`length > 0` 才比）；② 缺 `host/` 目录时抛 ENOENT、不打印 `STATUS: FAIL` | ① 只要 `Buffer.isBuffer` 就比对；② `existsSync` 守卫 + 记入 `syntaxIssues` |
| C5 | `dshArtifactContents.mjs:24` | `repoRoot = process.cwd()` 依赖调用目录 | 按 `import.meta.url` 向上四级推导；实测从 `C:\` 调用 PASS |
| C6 | `genDshIconDataUris.mjs` | `--check` 存在但需 `DSH_ARTWORK_TS` 外部源、未接入任何门禁 | 在 `dshIconArtwork.test.ts` 增加生成物 sha256 指纹断言（`514e24d8…`） |

## 5. 依赖前后对比

**本轮无依赖变更。**

| 项 | 值 |
|---|---|
| dependencies | 66（不变） |
| devDependencies | 93（不变） |
| scripts | 80 → **79**（-1：`bundle-dev-tunnels-web`） |
| 全仓零引用依赖 | 0 |

## 6. `verify:dsh-install-drift` FAIL 说明（预先存在，非本轮引入）

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

## 7. 存疑保留项

| # | 项 | 理由 |
|---|---|---|
| R1 | `eslint.config.js:1863` 的 `'vs/sessions/~'` | 属活 target 的允许清单，删=收窄语义，不是等价清理 |
| R2 | `build/lib/dsh/PROVENANCE.md:5` 与 `:11-14` 的版本自相矛盾（rc.3 vs rc.1） | AGENTS §5 法律凭据，只报告不动 |
| R3 | `test/smoke/src/utils.ts`、`test/automation/src/chat.ts`、`modelConfigPicker.ts`、`shellScenarios.ts` | 其它 smoke 套件共用，不在删除范围 |
| R4 | `build/next/devTunnelsWeb` 删后 `@microsoft/dev-tunnels-*` 5 个依赖仍被声明 | 它们是 VS Code 上游依赖；`eslint.config.js:1591-1592` 的 hasNode 允许清单仍引用，且 `agentHostProtocolClient.ts` 等注释仍在讨论 dev-tunnels 传输。删依赖属独立决策，本轮不动 |
| R5 | `isRecord` / `stringOf` / `numberOf` 重复实现 | 跨 ESM/CJS + Host 纯 JS 层，抽取收益 < 50 行 |
| R6 | `dshIdeContract.ts` 的 5 个门禁锁定导出 | verify 门禁按名字断言 |

## 8. 风险与回滚

| 风险 | 等级 | 回滚 |
|---|---|---|
| A1 的 `_boundDirty` 若忘记在成功路径清除，会让每次 bind 都重绑 | 低 | 成功路径已置 false，且有测试覆盖 |
| A2 的 `markDisconnected()` 由 `rebuild` 快照驱动：若 Host 不发 `rebuild`，连接态不会翻 false（行为同修复前） | 低 | `git revert 3a3c7336` |
| 删 12 个 eslint sessions 块：若将来恢复 sessions 目录，需从上游重新取这些 target 定义 | 低 | `git revert 8903ba72` |
| 删 agentsWindow smoke 区（164 KB）：若将来恢复 agentHost，需要重新引入这套测试 | 中 | `git revert 8903ba72` |
| 删 devTunnelsWeb 构建：若将来恢复 remote agent host 的 browser 端，需重建打包脚本 | 中 | `git revert 8903ba72` |
| C3 改 `compareVersion`：若上游版本号出现非 semver 形态（如 `0.2.2-rc.1+meta`），解析会退化 | 低 | `git revert 90e19ae1` |

**整体回滚**：`git revert --no-commit 9919cd20..HEAD && git commit`。

## 9. 提交清单（4 个）

| # | 提交 | 类型 | 文件 | +/- |
|---|---|---|---|---|
| 1 | `3a3c7336` fix(dsh): 修上一轮 5 处修复引入的回归 | 功能 | 6 | +70 / -7 |
| 2 | `8903ba72` chore(cleanup): 删已删 sessions 目录的残留配置、死测试与死构建脚本 | 清理 | 23 | +8 / -3,863 |
| 3 | `90e19ae1` fix(dsh): 修构建/测试脚本的 6 处真实缺陷 | 功能 | 8 | +148 / -40 |
| 4 | 文档（本报告 + 手册） | 文档 | 2 | 见提交 |

## 10. 假设

1. **`rebuild` 快照是「断开」的正确信号**：Host 的 `publishDisconnected` 只在传输断开时发它，语义明确。
2. **删 agentsWindow smoke 不减少有效覆盖**：被测源码与 out 产物都不存在，命令也不存在。
3. **`devTunnelsWeb` 无消费者**：全仓 grep `devTunnelsModule` 只命中 build 自身与 test。
4. **`genDshIconDataUris --check` 需外部 artwork 源**：本机与 app.asar 内均无该文件，故用生成物指纹代替接入 CI。
