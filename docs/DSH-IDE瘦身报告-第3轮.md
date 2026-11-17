# DSH-IDE 瘦身报告（第 3 轮）

> 编制时间：2026-11-17 22:35（Asia/Shanghai）
> 起点：`ad638615`（第 2 轮结束）　终点：`cd7aeb4b`
> 全区间：**3 个文件，+7 / -28 行**（另有 1 个空目录，git 不跟踪）

## 1. 门禁总览

| 门禁 | 结果 |
|---|---|
| 全量 `tsc --noEmit` | **PASS**（0 error） |
| `npm run test-dsh:all` | **PASS**（node 384 + mocha 7） |
| `verify:dsh-ide-ci`（五项） | **PASS**（`DSH_INSTALLED_VERSION=0.2.2-rc.1`） |
| `.vscode/tasks.json` | JSONC 解析 PASS |
| `.eslint-ignore` 死条目扫描 | **0**（原 19 条死条目） |
| `node --check scripts/sync-upstream.mjs` | **PASS** |
| `npm run compile` | 未重跑（本轮无源码/构建结构改动） |
| 真机 GUI | **PENDING**（按 AGENTS §6 由用户执行） |

## 2. 扫描结论：DSH 代码已无死代码可删

本轮对 `src/vs/platform/dshClient/**` + `src/vs/workbench/contrib/dsh/**`（55 文件）做全量复扫：

| 检查项 | 结果 |
|---|---|
| 零引用导出（273 个） | **0** |
| 零引用模块 | 4 个——全部是测试入口（由 `test-dsh`/`test-dsh:all` 直接指定），不是孤儿 |
| `TODO` / `FIXME` / `XXX` / `HACK` / `debugger` | **0** |
| 0 字节文件 | **0** |
| `node_modules` 里零引用依赖（9,053 文件 × 159 包） | **0** |

> 结论：前两轮已把 DSH 自有代码的可删面清完。本轮只剩配置层的少量残留。

## 3. 删除清单与理由

| # | 位置 | 内容 | 判定依据 | 删除量 |
|---|---|---|---|---|
| 1 | 空目录 `src/vs/workbench/contrib/dsh/test/browser` | 空目录 | `Get-ChildItem -Force -Recurse` = 0 项；`git ls-files src/vs/workbench/contrib/dsh/test` 为空 | 0 B（git 不跟踪） |
| 2 | `.eslint-ignore:5-21` | 17 条 `**/extensions/copilot/**` 忽略项 | `extensions/copilot` 目录不存在（`Test-Path=False`），glob 永不命中 | 17 行 |
| 3 | `.eslint-ignore:62-63` | `src/vs/base/common/lit-html/**`、`signals-core/**` | 两目录在 git 历史里**从未存在**（`git rev-list --count --all` = 0） | 2 行 |
| 4 | `build/filters.ts:223-224,246-247` | `// extensions/copilot has its own code style` + `'!extensions/copilot/**'` 两处 | 同上 | 4 行 |

## 4. 修正清单（非删除）

| 位置 | 问题 | 修法 |
|---|---|---|
| `scripts/sync-upstream.mjs:8-11,157,160,180,182` | 「渲染复用件」段（20 源 / 8 CSS / 1 资产）的本地复制件与 sidecar 构建链已删除，报告却把它当作当前复用面；其中还残留 `DshChatModelDriver` 描述 | 改为「**历史**渲染复用件」，并注明「本地复制件与 sidecar 已删除，仅作历史对照」；把 `DshChatModelDriver` 那句改为「曾用于旧渲染 sidecar」 |

## 5. 依赖前后对比

**本轮无依赖变更。**

| 项 | 值 |
|---|---|
| dependencies | 66（不变） |
| devDependencies | 93（不变） |
| scripts | 80（不变） |
| 全仓零引用依赖 | 0 |

## 6. 存疑保留项（本轮确认「不动」）

| # | 项 | 理由 |
|---|---|---|
| R1 | `dshIdeContract.ts` 的 5 个导出 + 文件本身 | 门禁按名字/正则断言，删则 FAIL |
| R2 | `dshChatModel.ts` 的 22 个 `Dsh*Block`/`Dsh*Node` 类型 | `DshChatNode` 联合类型成员 |
| R3 | `isRecord` 6 份 / `stringOf` 3 份 / `numberOf` 2 份 | 跨三层，抽取需改 gulp staging 与 boundary 门禁 |
| R4 | 协议错误码与 `ide-view-host.js` 的 4 个同名常量 | Host 半身纯 JS，有意复制 |
| R5 | `build/filters.ts:89-90,220-221` 的 `lit-html`/`signals-core` 排除项 | 与上游 vendoring 约定相关，**Q3 已确认保留**（只删 `.eslint-ignore` 的两行） |
| R6 | `build/dsh/chat-render/PROVENANCE.md` + `LICENSE-DSH` | AGENTS §5 四份凭据不得删改；其内容描述的是历史构建方式，与现状不符，**Q2 已确认保持原样** |
| R7 | `src/vs/platform/dshClient/PROVENANCE.md`、`build/lib/dsh/PROVENANCE.md`、`NOTICE.md`、`LICENSE.txt` | 同上；`NOTICE.md` 里的 `vscode-1.143.1/` 旧布局描述属许可证声明，禁改 |
| R8 | `build/lib/i18n.ts:333`、`build/npm/update-localization-extension.ts:53`、`build/gulpfile.scan.ts:38-39` 的 `vscode-loc`/`scanbin` 兄弟目录假设 | 属 VS Code 上游约定，**Q4 已确认保留** |
| R9 | 三份历史分析/草稿文档里的已删文件引用 | **Q5 已确认保持原样**（记录当时判断，加注记反而失真） |

## 7. 风险与回滚

| 风险 | 等级 | 回滚 |
|---|---|---|
| 删 17 条 copilot 忽略项与 filters.ts 排除项，若将来重新引入 `extensions/copilot`，lint 会开始检查它 | 低 | `git revert cd7aeb4b` |
| 删 `lit-html`/`signals-core` 的 `.eslint-ignore` 两行（`build/filters.ts` 仍保留） | 极低 | 同上 |
| `sync-upstream.mjs` 文案改为「历史渲染复用件」，若将来恢复渲染复用需改回 | 低 | 同上 |

**整体回滚**：`git revert --no-commit ad638615..HEAD && git commit`。

## 8. 三轮累计

| 轮次 | 区间 | 文件 | +/- | 提交 |
|---|---|---|---|---|
| 第 1 轮 | `ce668543`..`36521cd0` | 92 | +456 / -4,621 | 12 |
| 第 2 轮 | `36521cd0`..`ad638615` | 22 | +288 / -496 | 6 |
| 第 3 轮 | `ad638615`..`cd7aeb4b` | 3 | +7 / -28 | 1 |
| **合计** | `ce668543`..`cd7aeb4b`（含 4 份文档提交） | **111**（去重后） | **+945 / -5,143** | **20** |

累计成果：
- **tsc：137 → 0**
- **test-dsh:all：384 + mocha 7，全 PASS**（减少的 5 项全部来自已删的 `dshSessionItemState.test.ts`）
- **dependencies 68 → 66、devDependencies 100 → 93、scripts 86 → 80**
- **锁文件 1,649 → 1,536 条（-113，零新增、零版本变更）**
- `verify:dsh-ide-ci` 五项全 PASS、`verify:dsh-artifact` PASS
- DSH 两目录零引用导出 / 零引用模块 / TODO / 空文件全部为 0
