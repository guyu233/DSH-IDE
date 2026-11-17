# DSH-IDE 瘦身问题清单（第 4 轮，按推荐方案执行）

> 编制时间：2026-11-17 23:10（Asia/Shanghai）
> 依据：HEAD `75b1fc1`（工作树 clean），手册 §9.11、AGENTS.md。
> 本轮由 3 个子智能体并行扫描：配置残留（已删目录）、全仓重复实现、手册与代码一致性。
> 用户已明示「不确定不要提问，按推荐方法继续」，故本清单同时给出**执行决策**。

## 0. 基线

| 项 | 值 |
|---|---|
| tsc | 0 error |
| test-dsh:all | 384 + mocha 7 全 PASS |
| DSH 两目录 | 55 文件 / 15 JS / 34 TS / 4 MJS / 1 SVG / 1 MD |
| 已删目录 | `src/vs/platform/agentHost/**`、`extensions/copilot/**`、`src/vs/sessions/**`、`test/integration/agentHost/**`（均 `Test-Path=False`） |

## A. 已删目录导致的真实断链（7 处，11 行，最高优先级）

| # | 位置 | 类型 | 判定依据 | 风险 | 决策 |
|---|---|---|---|---|---|
| A1 | `scripts/test-integration.sh:200` | 断链 | `node --input-type=module -e "import {...} from './src/vs/platform/agentHost/test/node/agentHostTestProfile.ts'"`；该文件不存在 → `ERR_MODULE_NOT_FOUND`，`set -e` 中断整个默认集成测试 | **高**：默认集成测试入口直接失败 | 删该行及其空行 |
| A2 | `scripts/test-integration.bat:130` | 断链 | 同 A1（Windows）；下一行 `if errorlevel 1 goto :failed` 判失败 | 高 | 删该行 |
| A3 | `scripts/code-agent-host.js:72-81`（entryPoint 拼接）+ `scripts/code-agent-host.sh:28` | 断链 | 拼 `out/vs/platform/agentHost/node/agentHostServerMain.js` 并 spawn；`out/` 下无此目录 | 高 | **删除整个 `code-agent-host.js` + `.sh` + `.bat`**，并删 `.vscode/launch.json` 的「VS Code Agent Host」启动项 |
| A4 | `scripts/test-agent-host-e2e.sh:37` / `.bat:15` | 断链 | `exec node ./test/integration/agentHost/runner.ts`；目录不存在 | 高 | 删这两个包装脚本（对应 npm script 已在第 1 轮删除） |
| A5 | `scripts/sync-agent-host-protocol.ts:33` | 目标失效 | `DEST_DIR` 指向已删的 `src/vs/platform/agentHost/...`；脚本先查 `../agent-host-protocol/types`（本机不存在）→ `exit 1`。**注意：该脚本仍是 61 个 `chatContracts/common/state/protocol/*.generated.ts` 的唯一生成器**（这些文件的头注释都指向它） | **中**：脚本本身跑不起来，但生成的协议文件仍在用 | **修而不删**：把 `DEST_DIR` 改为 `src/vs/platform/chatContracts/common/state/protocol`（这是文件实际所在处），其余逻辑不动 |
| A6 | `test/smoke/src/areas/agentsWindow/remoteDevContainerFixtures.ts:427,430,487` | 断链 | 拼 `out/vs/platform/agentHost/node/agentHostServerMain.js` / `agentHostMain.js`；`readFileSync(src/.../agentHost/.../version/registry.ts)` | 中：只有 Dev Container smoke 套件会走到 | 把 registry 读取路径改 `chatContracts`；入口路径改为「找不到就不 spawn」的显式 skip（不假装成功） |
| A7 | `test/smoke/src/areas/agentsWindow/fixtures/packagedAgentHost.ts:96` | 断链 | `VSCODE_ESM_ENTRYPOINT: 'vs/platform/agentHost/node/agentHostMain'` | 中 | 同 A6，改为 chatContracts 对应入口或显式不可用 |

## B. 已删目录的惰性残留（不影响运行，建议清）

| # | 位置 | 条数 | 判定 |
|---|---|---|---|
| B1 | `eslint.config.js` 的 `src/vs/platform/agentHost/**` glob（244-248、439、453、466、469、471、1213、1763、1773 等） | 10 处 | 惰性：零匹配不报错 |
| B2 | `build/filters.ts:213,242,250` 的 `!src/vs/platform/agentHost/node/codex/protocol/generated/**` | 3 处 | 惰性 |
| B3 | `.eslint-ignore:36` 的 `**/src/vs/platform/agentHost/node/codex/protocol/generated/**` | 1 处 | 惰性 |
| B4 | `.vscode/settings.json:71-73` 的三条 `src/vs/platform/agentHost/**` 只读/搜索排除 | 3 处 | 惰性 |
| B5 | `build/lib/i18n.resources.json:700`、`build/lib/extensions.ts:333`、`build/darwin/*` 的 `extensions/copilot` 条目 | 5 处 | 惰性 |

> **决策**：B1~B4 清（纯配置，零风险）；B5 保留（`build/lib/extensions.ts` 与 `build/darwin/*` 是上游打包逻辑，删除可能影响未来扩展目录结构，且均带 `existsSync` 守卫）。

## C. 手册与代码不一致（21 处，其中 17 处为现状描述）

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

## D. 零引用脚本（1 个）

| # | 文件 | 大小 | 判定依据 | 决策 |
|---|---|---|---|---|
| D1 | `scripts/chat-simulation/merge-ci-summary.js` | 22,536 B / 508 行 | 全仓无 import、无 npm script、无 CI 配置引用；头注释称「Called by the CI report job」，但仓库已无 `.github/`；含 3 个与 `test-chat-perf-regression.js` 完全相同的函数 | **删除**（同时删 `.eslint-allowed-javascript-files:51` 的登记） |

## E. 重复实现（复核后仍保留）

| # | 项 | 结论 |
|---|---|---|
| E1 | `isRecord` 8 处（含 scripts 2 处）、`stringOf` 3 处、`numberOf` 2 处、`isRef` 2 处 | 保留：跨 ESM/CJS 两套模块系统 + Host 纯 JS 层，抽取收益 <50 行且要改 gulp staging |
| E2 | 6 组同值常量（协议错误码、版本号） | 保留：契约单测按值断言，Host 半身纯 JS 有意复制 |
| E3 | TypeScript 双 major（`typescript@npm:@typescript/typescript6@6.0.2` + `@typescript/native@npm:typescript@7.0.2`） | 保留：`update-build-ts-version` 与 `tsc` 门禁依赖两者；且实测 `node_modules/typescript` 已是 5.9.3（安装漂移），改动风险高 |
| E4 | `build/node_modules` 第二套依赖树（270 MB，未入库） | 保留：`.gitignore:17` 已忽略，不属仓库瘦身范围 |

## F. 执行批次

1. **批次 A（断链，必须）**：A1-A7。每改一个脚本跑 `bash -n` / `node --check`。
2. **批次 B（惰性配置）**：B1-B4。
3. **批次 C（D1 死脚本）**。
4. **批次 D（手册行号）**：C1-C8、C13。
5. 跑 tsc → test-dsh:all → `verify:dsh-ide-ci`（带 `DSH_INSTALLED_VERSION`）→ `npm run compile`。
6. 输出第 4 轮报告并更新手册 §9.11.6。

## G. 假设

1. `sync-agent-host-protocol.ts` 的目标目录改为 `chatContracts` 是我的推断（61 个 generated 文件都在那里、且都带该脚本的 banner），若上游另有约定需再核。
2. A6/A7 的 smoke 测试改动只在「Dev Container / packaged AgentHost」路径生效，不影响 DSH-IDE 自身。
3. `test/smoke/**` 是 VS Code 上游测试，改动只在「指向已删目录」的路径上做最小修正，不动测试逻辑。
