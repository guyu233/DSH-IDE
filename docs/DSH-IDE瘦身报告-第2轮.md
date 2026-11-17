# DSH-IDE 瘦身报告（第 2 轮）

> 编制时间：2026-11-17 21:40（Asia/Shanghai）
> 起点：`36521cd0`（第 1 轮结束）　终点：`ad638615`
> 全区间：**22 个文件，+288 / -496 行**（2 删除 / 18 修改 / 2 新增）；6 个提交（含本文档提交）

## 1. 门禁总览

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

## 2. 删除清单与理由

### 2.1 失效脚本（2 个，221 行）

| 文件 | 行数 | 为什么删 |
|---|---|---|
| `build/lib/dsh/verify/dshRealSampleP95.mjs` | 143 | 它 `import` 的 `ide-view-projector.ts` / `translator.ts` 已被删除，且 `dshIdeVerify.mjs:168-169` **反向断言**两者不得存在；实跑 `npm run verify:dsh-real-p95` → `ERR_MODULE_NOT_FOUND`。它测量的 TUI 投影器已不在当前架构（现走 `dshIdeProjections` / `dshChatModel`） |
| `build/dsh-ide-build-prereqs.mjs` | 78 | 仓库扁平化后 `ROOT = dirname(仓库根) = E:\`，会把 `types-stash` 写到 `E:\types-stash`（已实测并清理）；且其前提（`@types/*` 是指向 `types-stash` 的 junction）已不成立，无任何 package.json / README / 手册引用 |

同时删除 npm script `verify:dsh-real-p95`（scripts 81 → 80）。

### 2.2 死代码（4 处，74 行）

| 位置 | 符号 | 删除量 | 证明 |
|---|---|---|---|
| `dshComposerProjection.ts` | `toChatMode` + `observeModes` + `modesOf`（含 10 个连带失效 import） | 41 行 | 三者全仓零调用；预设选项实际由 `dshAgentSessionsController.getNewChatSessionInputState()` 直接构造 `IChatSessionProviderOptionGroup` |
| `dshChatSession.ts` | `noteRunning()` | 8 行 | 零调用；`_running` 仍由流式路径维护 |
| `dshChatSession.ts` | `pendingItemsView()` + `_pendingView` 字段 + 2 处赋值 | 11 行 | `pendingItemsView()` 零调用；typed pending 由 `pending()` / `onDidChangePending` 提供 |
| `dshChatSession.ts` | `boundId()` | 3 行 | 零调用 |
| `dshIdeProtocol.ts` | `DshIdeImageAttachmentValue` | 6 行 | 全仓仅定义 1 次 |
| `dshLanguageModelProvider.ts` | 重复的 `DSH_MODEL_VENDOR` 声明 | 4 行 | 改为从 `dshComposerProjection` 导入，消除同名同值双份 |

### 2.3 悬空配置（2 个 config，166 行）

| 文件 | 删除内容 | 证明 |
|---|---|---|
| `.vscode/tasks.json` | 「Serve Out (rspack)」「Copilot - Build」「Kill Copilot - Build」3 个任务 + 2 处 dependsOn 引用 + 1 处描述 | `serve-out-rspack` / `watch-copilotd` / `kill-watch-copilotd` 三个 script 均不存在；`extensions/copilot` 目录不存在 |
| `.vscode/launch.json` | 「VS Code Github Tests」「VS Code API Tests (single folder)」「VS Code API Tests (workspace)」「VS Code Tokenizer Tests」「VS Code Tokenizer Performance Tests」5 个启动项 + `extensions/copilot/dist` 的 outFiles 条目 | 对应 5 个扩展目录（github / vscode-api-tests / vscode-colorize-tests / vscode-colorize-perf-tests / copilot）均 `Test-Path=False` |

### 2.4 死配置项（3 处）

| 位置 | 内容 | 证明 |
|---|---|---|
| `.eslint-ignore:65-67,72` | 3 行 sidecar 注释 + `build/dsh/chat-render/src/**` 忽略项 | 该目录与 `build-render.mjs` 均已删，只剩两个凭据文件 |
| `build/tsconfig.json:25` | `"vite/**"` exclude | `build/vite` 已删 |
| `.vscode/tasks.json:27` | 描述里的「and copilot」 | `extensions/copilot` 不存在 |

## 3. 修正清单（非删除）

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

## 4. 依赖前后对比

**本轮无依赖变更。**

| 项 | 值 |
|---|---|
| dependencies | 66（不变） |
| devDependencies | 93（不变） |
| scripts | 81 → **80**（-1：`verify:dsh-real-p95`） |
| 全仓依赖名扫描（9,055 文件 × 159 个包） | **「从未出现」的依赖 0 个** |

`node_modules` 里第 1 轮删掉的 9 个包仍以 **extraneous** 形式存在（磁盘残留）；如需回收磁盘可 `npm prune`，不影响仓库。

## 5. 存疑保留项

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

## 6. 风险与回滚

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

## 7. 提交清单（5 个）

| # | 提交 | 类型 | 文件 | +/- |
|---|---|---|---|---|
| 1 | `62eb9c4c` chore(cleanup): 删 DSH 零引用导出与死成员 | 清理 | 5 | +4/-74 |
| 2 | `cc38a1b1` chore(cleanup): 修断链脚本与悬空调试配置 | 清理 | 4 | +11/-174 |
| 3 | `eb32759d` chore(cleanup): 删两个已失效的构建/门禁脚本 | 清理 | 2 | +0/-221 |
| 4 | `acc31151` docs: 对齐手册定量声明与源码/构建注释 | 文档 | 9 | +21/-24 |
| 5 | `2d7a1b02` chore(verify): artifact 门禁期望补齐到 10 个 common 模块 | 门禁 | 1 | +6/-3 |

## 8. 手册未覆盖处的假设

1. **P95 能力**：删脚本 = 放弃「真实样本 P95」这一测量项。若后续要做性能校准，需按现行投影层重新设计（`dshIdeProjections` / `dshChatModel`），阈值也要重新定。
2. **`dshIdeContract.ts`**：其 5 个导出在 `src/**` 零引用，但门禁按名字断言，因此不删；这与「零引用即删」的原则冲突，按「门禁是消费者」例外处理。
3. **`.vscode` 的 Copilot 相关项**：删除依据是 `extensions/copilot` 目录不存在；若将来重新引入该扩展，需要恢复这些任务与启动项。
4. **`node_modules` extraneous 包**：只清仓库（package.json + lock），不清磁盘；需要的话单跑 `npm prune`。
