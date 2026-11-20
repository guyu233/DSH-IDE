# ICON-PROVENANCE — DSH 产品图标派生资源

本文件记录 `src/vs/workbench/contrib/dsh/browser/dshIconDataUris.ts` 的来源与许可。
它**不是** AGENTS §5 所列的四份法律凭据（那份清单里的 `PROVENANCE.md` / `LICENSE-DSH`
一律未改动）；本文件是新增资源来源说明，只追加、不替代。

## 1. 源

| 项 | 值 |
| --- | --- |
| 权威源仓库（只读，绝不写） | `https://github.com/deepseek-ai/deepseek-harness`（官方仓库；不下载整仓副本） |
| `sourceCommit` | `39163dd30f703a79079e2d2446545cff3c453738`（`git describe`：`dsh-v0.2.2-rc.3-608-g39163dd30f`） |
| 源包 | `packages/client/ui-primitives/`（`@deepseek-ai/dsh-client-ui-primitives`，版本 `0.2.2-rc.3`） |
| 源文件 | `src/icons/artwork.ts`（sha256 `0f24b3f813f79d726fd1784d5d9bbf0b4fc64fa801711df728a6d34363d5b964`，78,594 B） |
| 许可 | MIT License, Copyright (c) 2026 DeepSeek（全文见 `build/lib/dsh/LICENSE-DSH`，本文件不改写、不替代） |
| 采集时间 | 2026-11-16 (Asia/Shanghai) |

## 2. 派生方式

`build/lib/dsh/genDshIconDataUris.mjs` 读取 `ICON_ARTWORK`（104 个 glyph），对每个 glyph：

1. 取 `svg(strokeWidth)` 在 regular stroke = `1` 下的结果；兼容三种声明写法
   （`strokeWidth => \`…\``、`() => '…'`、`strokeWidth === ICON_MEDIUM_STROKE` 的 medium/regular 三元两支，取 regular 支）。
2. **图形原样**，只把模板占位 `\${strokeWidth}` 替换成 `1`，不做「转字体 / 统一 stroke / 简化路径」。
3. `encodeURIComponent` 全量 URL-encode（含单引号转 `%27`），拼成 `data:image/svg+xml,…`。

生成物：`src/vs/workbench/contrib/dsh/browser/dshIconDataUris.ts`
（sha256 `514e24d8a30b5a21625d168b503c45be0e0f11a10902c118ae817deed4d991a1`，96,561 B）。

**可重复验证**：`DSH_ARTWORK_TS=<官方 artwork.ts 路径> node build/lib/dsh/genDshIconDataUris.mjs --check`
（已登记进 `test-dsh:all` 的 `dshIconArtwork.test.ts` 覆盖生成物形状）。

## 3. 边界

- 只派生**图标几何**，不复制 React 组件、样式表、字体或任何运行时模块。
- 手绘被明确排除：本目录不含任何人工编造的 LOGO 路径（AGENTS §2）。
- 映射表 `dshCodiconMap.ts` 是 DSH-IDE 自写的语义对应，不属于上游资源。
- DSH 没有对应 glyph 的 codicon 保持原样（混合状态），不强行替换。
