# DSH-IDE 瘦身问题清单（第 2 轮，待确认）

> 编制时间：2026-11-17 21:20（Asia/Shanghai）
> 依据：`docs/DSH-IDE改造开发手册.md` §9.11、AGENTS.md、HEAD `36521cd0` 实测。
> 本轮只做扫描，不改代码。判定方法：`git grep` 全仓（含字符串字面量）+ 9,055 文件引用扫描 + TypeScript AST 函数体哈希 + 逐文件 `Test-Path` + 实际执行门禁取证。
> 第 1 轮已完成并提交 12 个 commit（`07f9def4`..`36521cd0`），tsc 137→0、384 测试全过、`verify:dsh-ide-ci` 五项 PASS。

## 0. 实测基线（本轮新增门槛）

| 项 | 当前值 | 证据 |
|---|---|---|
| 全量 tsc | **0 error** | 实测 |
| `test-dsh:all` | **PASS（node 384 + mocha 7）** | 实测 |
| `npm run compile` | **PASS** | 实测 `Finished 'compile' after 1.67 min` |
| `verify:dsh-ide-ci` | **PASS** | 五项聚合全 PASS（需 `DSH_INSTALLED_VERSION=0.2.2-rc.1`） |
| `verify:dsh-artifact` | **PASS**（但期望值陈旧，见 B3） | 实测：`package/common/` 实际 11 个模块，脚本期望 7 个 |
| `verify:dsh-real-p95` | **FAIL** | 实测 `ERR_MODULE_NOT_FOUND: .../ide-view-projector.ts` |
| `git status` | clean | — |
| DSH 两目录规模 | 55 文件 / 14,394 物理行（13,400 非空） | `git ls-files` + `Measure-Object` |

## A. 会直接失败 / 写错位置的脚本（最高优先级）

| # | 位置 | 类型 | 判定依据 | 风险 | 建议 |
|---|---|---|---|---|---|
| A1 | `build/lib/dsh/verify/dshRealSampleP95.mjs:104-114,125` | **断链**（引用已删模块） | 实跑 `npm run verify:dsh-real-p95` → `ERR_MODULE_NOT_FOUND: file:///E:/DSH-IDE/src/vs/platform/dshClient/common/ide-view-projector.ts`；该文件与 `translator.ts` 均已被删，且 `dshIdeVerify.mjs:168-169` 明确断言它们**不得回来**；脚本还读 `projector.ROWS_P95_BYTE_LIMIT`（该常量今已不存在） | **高**：门禁必 FAIL，且与 boundary 门禁自相矛盾 | 三选一：①删除脚本 + `verify:dsh-real-p95` script；②改为对现行 `dshIdeProjections`/`dshChatModel` 的投影做 P95；③改成读 golden 快照。**需你定**（Q1） |
| A2 | `build/dsh-ide-build-prereqs.mjs:22-26` | **路径算错**（仓库外写入） | `here=E:\DSH-IDE\build`；`VSC=dirname(here)=E:\DSH-IDE`；`ROOT=dirname(VSC)=E:\`；`STASH=E:\types-stash`。**我误跑一次已实证**：确实创建了 `E:\types-stash`（我已删除，仓库 tree 未受影响）；第 66-77 行校验中 `sinonjs__fake-timers` 必然 FAIL、退出码 1 | **高**：会往仓库外写、`cpDir` 先 `rmSync` 具破坏性 | 该脚本未被任何 package.json/README/手册引用，且其前提（`types-stash` junction）在扁平化后已不成立。建议**删除**（Q2） |
| A3 | `.vscode/tasks.json:632-654`「Serve Out (rspack)」 | **悬空任务** | `"script": "serve-out-rspack"`，该 script 已随 `edfd09bf` 删除（实测 `'serve-out-rspack' in scripts === false`） | 低（仅手动运行会报 Missing script） | 删除 |
| A4 | `.vscode/tasks.json:206-237,288-299`「Copilot - Build」「Kill Copilot - Build」 | **悬空任务**（脚本 + 目录都缺） | `watch-copilotd`/`kill-watch-copilotd` 两个 script 不存在；`extensions/copilot` 目录不存在 | 低（但 `VS Code - Build` / `Kill VS Code - Build` 依赖它们，整条构建任务链会失败） | 删除这两个任务，并从 `VS Code - Build`/`Kill VS Code - Build` 的 `dependsOn` 里移除 |
| A5 | `.vscode/launch.json` 5 个启动项引用不存在目录 | **悬空启动项** | `extensions/copilot` → 「Attach to Extension Host」；`extensions/github` → 「VS Code Github Tests」；`extensions/vscode-api-tests` → 「VS Code API Tests (single folder)」「VS Code API Tests (workspace)」；`extensions/vscode-colorize-tests` → 「VS Code Tokenizer Tests」；`extensions/vscode-colorize-perf-tests` → 「VS Code Tokenizer Performance Tests」；五个目录均 `Test-Path=False` | 低（点击才失败） | 建议逐项确认后删（Q3） |
| A6 | `scripts/sync-upstream.mjs:77` | **静默失效** | 读 `ROOT/vscode-1.143.1/build/lib/dsh/PROVENANCE.md`，该路径不存在，异常被 `try/catch` 吞掉 → `readVendoredVersion()` 返回 undefined → `base` 回退为最新 tag，与默认 `target` 相同 → 报告**恒为 SAME**。另 `:78` 的正则也匹配不了当前 `PROVENANCE.md:19` 的「`0.2.2-rc.1`（根 package.json…）」格式 | **中**：升级工具给出假阴性 | 改路径为 `build/lib/dsh/PROVENANCE.md` + 改正则 + 改 4 处 `vscode-1.143.1/` 文案（Q4） |

## B. 门禁期望值陈旧（不会报错，但检查的已不是真相）

| # | 位置 | 问题 | 证据 | 建议 |
|---|---|---|---|---|
| B1 | `build/lib/dsh/verify/dshArtifactContents.mjs:43-51` | `EXPECTED_COMMON` 只列 7 个模块 | 实测 `tar -tzf dist/dsh-ide-2.0.0.tgz` 有 **11 个** `package/common/` 成员（多出 `dshIdeComposer.js`、`dshIdeWaterfallNotice.js`、`dshIdeRequestView.js`、`dshIdeLocationIndex.js`（该文件本次已删，需重新打包后才会消失） | 把 `EXPECTED_COMMON` 补齐到与 `gulpfile.vscode.ts:662-671` 的 10 项一致；顺便把 `dshIdeLocationIndex.js` 从产物里验证消失 |
| B2 | `build/lib/dsh/verify/dshIdeVerify.mjs:269` | `contract` 门禁要求导出 `upstreamDrift` 等 5 个符号 | 这些符号在 `src/**` 里 0 引用（只被门禁按名字断言） | **不动**：门禁就是消费者，删了门禁会 FAIL。记入存疑保留 |
| B3 | `build/lib/dsh/verify/dshIdeVerify.mjs:97` | 断言 `contract` 必须 `import './dshIdeProtocol.js'` | 同上 | 不动 |

## C. 文档与注释漂移（会误导后续开发）

| # | 位置 | 内容 | 判定依据 | 建议 |
|---|---|---|---|---|
| C1 | `docs/DSH-IDE改造开发手册.md:145,238,265,367` | 「42 个 method」 | 实测 `DSH_IDE_METHOD_KEYS` = **43**（含 `capabilities`）；`dshIdeProtocol.test.ts:85-86`、`dshIdeEndpoints.test.ts:104,212` 也都断言 43 | 改为 43（4 处） |
| C2 | `docs/DSH-IDE改造开发手册.md:350,385` | 「36 个 `DshIdeMethodArgs`」「36 个 `ide/dispatch` method，32 可用 + 4 禁用」 | 实测 43（39 可用 + 4 禁用） | 改为 43 / 39+4 |
| C3 | `docs/DSH-IDE改造开发手册.md:799` | `dshSessionItemState.ts:14,24-34,42-52,55-64` 行号引用 | 该文件已在 `ece6e68c` 删除 | 标注为历史，或改为指向 controller 内联实现 |
| C4 | `docs/DSH-IDE改造开发手册.md:936` | 「删除 89 个文件 / 减 4,620 行」 | 实测 `git diff --shortstat ce668543..980bcf5b` = `89 files changed, 156 insertions(+), 4620 deletions(-)`；其中 **D=26、M=63、A=0**。注：`980bcf5b` 不是第 1 轮终点，完整区间 `ce668543..36521cd0` 为 **92 files / +456 / -4,621**（D=26、M=64、A=2） | 改为「92 个文件（26 删除 / 64 修改 / 2 新增），+456 / -4,621 行」 |
| C5 | `README.md:86` | 「DSH 集成层（Agent、输入框数据源、模型菜单）」 | `dshModelMenu.ts` 已删，模型/effort 走原生选择器 | 改为「Agent、输入框数据源、会话树」 |
| C6 | `README.md:90` | 「`build/dsh/chat-render/` 聊天渲染 sidecar 及其来源凭据」 | 目录只剩 `PROVENANCE.md` + `LICENSE-DSH`，sidecar 链已删 | 改为「聊天渲染复用件的历史来源凭据（只读，不随构建）」 |
| C7 | `build/gulpfile.vscode.ts:546,676`；`build/next/index.ts:405`；`build/lib/dshBuildProvenance.ts:21` | 4 处注释称「DSH 帧由 `DshChatModelDriver` 直接写进原生 ChatModel」 | 该类已在 `ece6e68c` 删除；实际走 `IChatSessionContentProvider.history`（`dshChatSessionContent.ts`） | 改为「由 `dshChatSessionContent` 的 content provider 提供历史」 |
| C8 | `src/vs/workbench/contrib/dsh/browser/dshTeamCommands.ts:9` | 「此前唯一画它的 `dshModelMenu.ts` 从未被实例化」 | 模块已删，本句是唯一残留提及 | 改为「原生选择器不提供团队开关」 |
| C9 | `src/vs/workbench/contrib/dsh/browser/dshAgentSessionsController.ts:140` | 「这是 `dshComposerProjection` 里 `toPermissionItems` / `observeModes` 的生产入口」 | `observeModes` 零引用、且将被删（见 D1） | 随 D1 一起改 |
| C10 | `.eslint-ignore:65-67,72` | 注释称 `.tsx leaves are bundled by build/dsh/chat-render/build-render.mjs`；`build/dsh/chat-render/src/**` 忽略项 | 该脚本与 `src/` 目录均已删（只剩两个凭据文件） | 删 3 行注释 + 1 行忽略项 |
| C11 | `build/tsconfig.json:25` | `"vite/**"` exclude | `build/vite` 已删 | 删该行 |
| C12 | `.vscode/tasks.json:27` | 「Install dependencies and watch all of VS Code (core, extensions and copilot)」 | `extensions/copilot` 不存在 | 去掉「and copilot」 |
| C13 | `build/dsh-ide-build-prereqs.mjs:7-14,22-23,78` 的旧路径注释 | 若 A2 决定删除，则一并消失 | — | 随 A2 |

## D. 零引用代码（新增，第 1 轮未覆盖）

| # | 位置 | 类型 | 判定依据 | 风险 | 预计删除 |
|---|---|---|---|---|---|
| D1 | `src/vs/workbench/contrib/dsh/browser/dshComposerProjection.ts:64-105`：`toChatMode` + `observeModes` + `modesOf` | 死代码链 | 三者全仓零调用；唯一出现是 `dshAgentSessionsController.ts:140` 的注释。连带 10 个 import（`constObservable`/`observableValue`/`IObservable`/`ThemeIcon`/`Codicon`/`URI`/`IChatMode`/`IChatModeInstructions`/`ChatModeKind`/`Target`）全部变为未使用（已用 AST 校验余下代码对这些标识符的出现次数均为 0） | 低（预设选项实际由 `dshAgentSessionsController.getNewChatSessionInputState()` 直接构造 `IChatSessionProviderOptionGroup`，不走 `IChatMode`） | **≈47 行代码 + 10 行 import** |
| D2 | `src/vs/workbench/contrib/dsh/browser/dshChatSession.ts:511-518` `noteRunning()` | 死方法 | 全仓零调用（`_running` 仍由 420/424 行的流式路径维护） | 低 | 8 行 |
| D3 | `src/vs/workbench/contrib/dsh/browser/dshChatSession.ts:149-151` `pendingItemsView()` + `:104` `_pendingView` + `:189`、`:245` 两处赋值 | 死字段链 | `pendingItemsView()` 零调用；typed pending 由 `pending()`/`onDidChangePending` 提供；`_pendingView` 仅被这三处读写 | 低 | 净 ≈4 行 |
| D4 | `src/vs/workbench/contrib/dsh/browser/dshChatSession.ts:226-228` `boundId()` | 死 getter | 零调用（外部只用 `boundSessionId` 字段本身） | 低 | 3 行 |
| D5 | `src/vs/platform/dshClient/common/dshIdeProtocol.ts:154-158` `DshIdeImageAttachmentValue` | 零引用导出 | 全仓仅定义 1 次，无任何 import/引用 | **零** | 4 行 |
| D6 | `src/vs/workbench/contrib/dsh/browser/dshComposerProjection.ts:25` 与 `dshLanguageModelProvider.ts:30` 的 `DSH_MODEL_VENDOR` | 重复常量 | 同名同值双份 export；后者仅本文件 4 处使用 | 低 | 1 行（改为从 projection 导入） |

## E. 重复实现（复核后仍建议保留）

| # | 位置 | 结论 |
|---|---|---|
| E1 | `isRecord` **6 份**（`dshIdeComposer.js:133`、`dshIdeConversation.ts:498`、`dshIdeProjections.ts:136`、`dshIdeRequestView.js:159`、`dshIdeTransport.ts:351`、`dshChatModel.ts:540`） | **保留**：跨 Host 纯 JS / transport / workbench 三层，抽取需改 gulp staging 与 boundary 门禁；函数体仅 1 行 |
| E2 | `stringOf`/`nonEmpty` **3 份**、`numberOf` **2 份** | **保留**：同上，收益 <10 行 |
| E3 | `refresh()` 的 `finally(() => { this.loading = undefined; })` 2 处（`dshComposerSource.ts:218`、`dshLanguageModelProvider.ts:87`） | **保留**：2 行，抽公共函数无意义 |
| E4 | `dshIdeContract.ts` 的 `UPSTREAM_VALIDATED_VERSION` 与 `dshIdeProtocol.ts` 的 `DSH_IDE_API_VERSION` 同值 | **保留**：`dshIdeProtocol.test.ts:337-343` 显式断言两者相等，是「契约跟随协议」的双点校验 |
| E5 | 协议错误码与 `ide-view-host.js` 的 4 个同名常量 | **保留**：Host 半身是纯 JS，注释明示不跨层 import，属有意复制 |
| E6 | `DSH_IDE_DELETE_SESSION_PLUGIN` / `_VERSION` / `_ENDPOINT` | **保留**：`dshIdeProtocol.test.ts:331-334` 按值断言，删了测试挂 |

## F. 依赖复核（本轮新增）

| # | 检查 | 结果 |
|---|---|---|
| F1 | 全仓 9,055 文件扫 159 个依赖名 | **「从未出现」的依赖：0 个**（第 1 轮已删干净） |
| F2 | `node_modules` 里 `@hpke/core`、`libsodium-wrappers` 等 9 个已删包 | 仍存在但 `npm ls` 标为 **extraneous**（磁盘残留，不影响仓库）；如需回收可 `npm prune` |
| F3 | 锁文件 | 1,536 条目，与 `package.json` 一致（`npm install --package-lock-only` 后零新增零版本变更） |

## G. 存疑保留（请确认）

- **R1** `dshIdeContract.ts` 的 5 个导出（`UPSTREAM_VALIDATED_VERSION`/`BLESSED_PACKAGES`/`VSCODE_PATCH_POINTS`/`installedMeetsVersion`/`upstreamDrift`）在 `src/**` 零引用，但 `verify:dsh-ide-contract` + `protocol-single-source` 按名字/正则断言它们存在。**保留**，否则门禁 FAIL。
- **R2** `dshIdeContract.ts` 文件本身全仓 0 import，只被门禁当文本读。**保留**（门禁的检查对象）。
- **R3** `dshChatModel.ts` 里 22 个 `Dsh*Block`/`Dsh*Node` 类型只在本文件自用，但它们是 `DshChatNode` 联合类型的成员，**不能删**（删了联合类型不全）。
- **R4** `.eslint-ignore` 的 `src/vs/base/common/lit-html/**`、`signals-core/**` 两个目录不存在（`Test-Path=False`）。属上游 vendored 声明，删了可能影响未来 vendoring；建议保留并记入报告。
- **R5** `build/dsh/chat-render/` 只剩 `PROVENANCE.md` + `LICENSE-DSH`。AGENTS §5 明确四份凭据「一律保留且不得删改」，**保留**。

## H. 建议执行批次

1. **批次 A（断链修复，必须）**：A1（P95 脚本，按 Q1 决策）、A2（prereqs 脚本，按 Q2 决策）、A3（rspack 任务）、A4（Copilot 任务链）、A6（sync-upstream 路径）。A5 按 Q3。
2. **批次 B（死代码）**：D1-D6。每项先跑 `tsc` + `test-dsh:all`；D1 需同步改 `dshAgentSessionsController.ts:140` 注释。
3. **批次 C（文档/注释）**：C1-C12。纯文本，一次提交。
4. **批次 D（门禁期望值）**：B1（`EXPECTED_COMMON` 补齐 10 项）。改完需重新 `gulp dsh-ide-pack` 才能验证产物；本轮只改脚本，标注 PENDING。
5. 每批后：全量 tsc → `test-dsh:all` → `npm run compile` → `verify:dsh-ide-ci`；A 批另跑 `verify:dsh-real-p95`（修好后应 PASS）。

## I. 本轮新增假设

1. **A1 的处置需要你决定**：`verify:dsh-real-p95` 检查的 `ide-view-projector.ts`/`translator.ts` 已被 `9b1bca6f` 删除，且 boundary 门禁反向要求它们不得存在。我倾向于**删除该脚本与 script**，因为它的测量对象（TUI 投影器）已不在架构里；若你要保留「真实样本 P95」这项能力，需重新定义测量对象（我可以按现行 `dshIdeProjections` 重写）。
2. **A2 的处置需要你决定**：该脚本声称修 `types-stash` junction，但实测当前 `node_modules/@types/node` 等已是实体目录、并不指向 `types-stash`，其前提不成立且未被任何文档引用。我倾向于**删除**。
3. **A5 的 5 个启动项**：它们指向的扩展（copilot/github/vscode-api-tests/colorize-tests）在 `edfd09bf` 之前的某次裁剪中被移除；删除启动项不会影响 VS Code 上游功能，但会让你失去「调试这些扩展」的入口（反正也调试不了）。建议删。
4. 本轮不改任何 `PROVENANCE.md`/`LICENSE-DSH`/`NOTICE.md`/`LICENSE.txt`。
5. 本轮不做依赖变更（F1 已证明无零引用依赖）。
