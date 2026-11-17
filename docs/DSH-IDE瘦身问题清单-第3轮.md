# DSH-IDE 瘦身问题清单（第 3 轮，待确认）

> 编制时间：2026-11-17 21:55（Asia/Shanghai）
> 依据：HEAD `ad638615` 实测。本轮只做扫描，不改代码。
> 前两轮共 17 个提交：`07f9def4`..`ad638615`，tsc 137→0，`test-dsh:all` 384 全过，`verify:dsh-ide-ci` 五项 PASS。

## 0. 基线

| 项 | 值 |
|---|---|
| tsc | 0 error |
| test-dsh:all | 384 + mocha 7，全 PASS |
| DSH 两目录 | 55 文件 / 34 TS / 15 JS / 4 MJS / 1 SVG / 1 MD |
| 依赖 | deps 66 / devDeps 93 / scripts 80 |
| 依赖零引用扫描（9,053 文件 × 159 包） | **0 个** |
| 死导出扫描（273 个导出） | **0 个** |
| 空文件（DSH 两目录） | 0 |
| 空目录（全仓，排除 node_modules/out/.build） | **1**：`src/vs/workbench/contrib/dsh/test/browser` |

## A. 现状：已无可删的死代码/死导出

第 1、2 轮已把 DSH 两目录里的零引用模块、零调用导出、零调用成员清完。本轮复扫：
- 零引用导出：**0**
- 零引用模块：只有 4 个测试入口（`electronHome.test.mjs`、`ideLaunchQueue.test.mjs`、`ideViewHost.test.mjs`、`packaging.test.mjs`），它们由 `package.json` 的 `test-dsh`/`test-dsh:all` 直接指定，**不是孤儿**。
- `TODO/FIXME/XXX/HACK/debugger`：**0**
- DSH 两目录 0 字节文件：**0**

## B. 剩余可删项（3 项，需确认）

| # | 位置 | 类型 | 判定依据 | 风险 | 建议 |
|---|---|---|---|---|---|
| B1 | 空目录 `src/vs/workbench/contrib/dsh/test/browser` | 空资源 | `Get-ChildItem -Force -Recurse` 计数 0；`git ls-files src/vs/workbench/contrib/dsh/test` 为空 | 无（git 不跟踪目录） | 删除 |
| B2 | `.eslint-ignore:5-21` 共 **17 条** `**/extensions/copilot/**` 忽略项 | 冗余配置 | `extensions/copilot` 目录已不存在（`Test-Path=False`），这些 glob 永不命中；`.eslint-allowed-*-files` 里的 copilot 条目已在第 1 轮清完 | 低 | 删除 |
| B3 | `build/filters.ts:223-224`、`:246-247` 两处 `// extensions/copilot has its own code style` + `'!extensions/copilot/**'` | 冗余配置 | 同上；这两处在 `exclude` 数组里，指向不存在的目录 | 低 | 删除 |

## C. 文档历史段落（不建议改，供确认）

第 2 轮已修完**现状性**声明（method 数、test 数、REPORT 统计）。剩余提及已删文件的地方全部位于**明确标注为历史记录**的段落：

| 位置 | 内容 | 判定 |
|---|---|---|
| `docs/DSH-IDE改造开发手册.md:549,639,686,840,844,887` | `dshSessionItemState` 的历史阶段记录（「新增」「联跑 PASS 37 项」「产物含 withArchived」等） | 历史记录，**保留** |
| `docs/DSH-IDE改造开发手册.md:558,578` | 「不恢复 `dshChatModelDriver`」的决策记录 | 决策记录，**保留** |
| `docs/DSH-IDE改造开发手册.md:295,469` | 「`dshModelMenu.ts` 已删除」「死代码清理列表」 | 均已注明删除，**保留** |
| `docs/DSH-IDE内容接收与ChatSession面板架构分析.md`（6 处） | 分析文档写于 2026-11-16，引用当时的 `dshChatModelDriver.ts`/`dshModelMenu.ts` 行号 | 历史分析快照，**保留**（若改会破坏「当时结论」的可追溯性） |
| `docs/DSH-IDE承接DSH桌面端聊天页面的路线草稿.md:134` | 「`dshSessionItemState.ts`：会话行的归档/已读状态工具」 | 路线草稿，**保留** |

> 需要你确认：是否要把这些**历史文档**也标注「文件已删」？我倾向于不加——它们的价值就是记录当时的判断，加了反而失真。

## D. 存疑保留项（与第 1/2 轮一致，本轮复核仍成立）

| # | 项 | 理由 |
|---|---|---|
| R1 | `dshIdeContract.ts` 的 5 个导出 + 文件本身 | `verify:dsh-ide-contract` / `protocol-single-source` 按名字/正则断言；全仓 0 import 但门禁是消费者 |
| R2 | `dshChatModel.ts` 的 22 个 `Dsh*Block`/`Dsh*Node` 类型 | `DshChatNode` 联合类型成员，删了类型不全 |
| R3 | `isRecord` 6 份 / `stringOf` 3 份 / `numberOf` 2 份 | 跨三层，抽取需改 gulp staging 与 boundary 门禁 |
| R4 | 协议错误码与 `ide-view-host.js` 4 个同名常量 | Host 半身纯 JS，有意复制 |
| R5 | `.eslint-ignore:62-63` 的 `lit-html/**`、`signals-core/**` | **新证据**：这两个目录在 git 历史里**从未存在过**（`git rev-list --count --all -- 'src/vs/base/common/lit-html'` = 0）；但 `build/filters.ts:89-90,220-221` 仍按它们写排除项，属上游 vendored 约定。删 `.eslint-ignore` 这两行风险为零（glob 永不命中），但意义也接近零；建议**与 filters.ts 一起判**，不要单删 |
| R6 | `build/dsh/chat-render/` 的 `PROVENANCE.md` + `LICENSE-DSH` | AGENTS §5 四份凭据不得删改 |
| R7 | `src/vs/platform/dshClient/PROVENANCE.md`、`build/lib/dsh/PROVENANCE.md`、`NOTICE.md`、`LICENSE.txt` | 同上 |

## E. 前两轮未覆盖、本轮新发现（重要）

| # | 位置 | 问题 | 判定依据 | 风险 | 建议 |
|---|---|---|---|---|---|
| E1 | `scripts/sync-upstream.mjs:6-12,47-58` | **语义过期（不是断链）**：脚本头注释称「复用面 = 渲染复用件（20 源 + 8 CSS + 1 资产）+ 传输/契约」，但本地已无任何「渲染复用件」副本（`build/dsh/chat-render/src/` 与 `chatContentParts/dsh/` 都不存在）；脚本只比对**上游仓库两个 tag**，不读本地副本（除已修好的 `readVendoredVersion()`），因此**不会失败**，但生成的报告仍会把 20 源/8 CSS/1 资产列为「本项目的复用面」，与现状不符 | 实测 `UI_FILES` = 20、`CSS_FILES` = 8、`ASSET_FILES` = 1；`fs.existsSync('build/dsh/chat-render/src')` = false；`fs.existsSync('.../chatContentParts/dsh')` = false | **低**：报告口径误导，不影响运行 | 二选一（Q1）：把「渲染复用件」段改为「历史复用面（已删除，仅保留凭据）」/ 整段删掉只比对契约面 |
| E2 | `build/lib/dsh/PROVENANCE.md:31,58,99-105` 与 `build/dsh/chat-render/PROVENANCE.md:31,58,99-105` | 两份凭据描述的是**已不存在的** `build/dsh/chat-render/src/` 与 `build-render.mjs` 产物链（`dist/dsh-chat.js`/`dsh-chat.css`）；AGENTS §5 规定四份凭据「不得删改」 | 目录只剩两个文件；`gulpfile.vscode.ts` 与 `dshBundleStaging.test.ts` 已禁止 `build-render.mjs` | **高**（触碰许可证边界） | **不动**。只在报告的「存疑保留」里记录：凭据描述的是历史构建方式，与现状不符，但按 AGENTS §5 保持原样（Q2 请确认） |
| E3 | `build/filters.ts:89-90,220-221` | 排除 `src/vs/base/common/lit-html/**`、`signals-core/**`（两目录从未存在） | `git rev-list --count --all` = 0；`Test-Path=False` | 低 | 与 B2/B3 一起判（Q3） |
| E4 | `src/vs/platform/dshClient/PROVENANCE.md:81` 与 `NOTICE.md:10-11,29-30` | 仍写 `E:\vscode-dsh\vscode-1.143.1` 旧布局 | 仓库已扁平化 | **高**（NOTICE/LICENSE 禁改） | **不动**，记入报告 |
| E5 | `build/lib/i18n.ts:333`、`build/npm/update-localization-extension.ts:53`、`build/gulpfile.scan.ts:38-39` | 按「仓库的兄弟目录」找 `vscode-loc` / `scanbin`；扁平化后变成 `E:\vscode-loc`、`E:\scanbin` | `path.join(REPO_ROOT_PATH,'..','vscode-loc')` 推导 | 低（仅翻译/符号任务，不影响 `dsh-ide-pack`） | **不动**（Q4）：这是 VS Code 上游约定「vscode-loc 与 vscode 同级」，扁平化没有改变这个相对关系以外的语义；改了反而偏离上游 |

## F. 建议执行

1. **批次 A**：B1（空目录）、B2（17 条 copilot 忽略）、B3（filters.ts 4 行）。
2. **批次 B**：按 Q1 处理 `sync-upstream.mjs`。
3. 之后跑：tsc → test-dsh:all → `verify:dsh-ide-ci`（带 `DSH_INSTALLED_VERSION`）→ `npm run compile`。
4. 输出第 3 轮瘦身报告并更新手册 §9.11.5。

## G. 请确认的问题

- **Q1** `scripts/sync-upstream.mjs` 的「渲染复用件」段（20 源 / 8 CSS / 1 资产）已无本地对应物：改为「历史复用面（已删除，仅保留凭据）」/ 整段删除只比对契约面 / 保持原样？
- **Q2** 两份 `PROVENANCE.md` 描述已失效的 `chat-render` 构建链：按 AGENTS §5 保持原样（推荐），还是允许追加「历史说明」段（不改原文）？
- **Q3** `build/filters.ts` 与 `.eslint-ignore` 里 `lit-html`/`signals-core` 的死排除项：删 / 保留？
- **Q4** `build/lib/i18n.ts` 等三处 `vscode-loc`/`scanbin` 兄弟目录假设：保留（推荐，属上游约定）/ 改为仓库内路径？
- **Q5** 历史文档（`docs/DSH-IDE内容接收…` 等）里的已删文件引用：保持原样（推荐）/ 逐条加「已删除」注记？
