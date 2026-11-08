# PROVENANCE — `build/dsh/chat-render/`

P1 聊天渲染资产的来源与许可证记录。本文件是 `docs/DEVELOPMENT.md` 第 1 章资源复用章节的落盘凭据。

> **版本同步（2026-11-05）**：DSH 桌面端已升级到 **0.2.2-rc.1**，本目录的复用源随之从 `0.2.1-rc.5` 同步到 `0.2.2-rc.1`。同步记录见 §8。

## 1. 源与版本（真实 Git 提交）

| 项 | 值 |
| --- | --- |
| 权威源仓库（**只读，绝不写**） | `E:\deepseek-harness-0.2.2-rc.1`（官方 `deepseek-ai/deepseek-harness` 的 `dsh-v0.2.2-rc.1` tag 克隆） |
| 源包 | `packages/client/ui-chat/`（`@deepseek-ai/dsh-client-ui-chat`） |
| 版本 | `0.2.2-rc.1`（源仓库根 `package.json` 的 `version` 字段） |
| `sourceCommit` | `66491b05e3 (tag dsh-v0.2.2-rc.1)` — 本次为真实克隆，记录实际 tag 与 commit；不再留空 |
| 采集时间 | 2026-11-05 (Asia/Shanghai) |
| 采样方式 | 逐文件从 `E:/deepseek-harness-0.2.2-rc.1/packages/client/ui-chat/` 读取，只复制下列精确相对路径；由 `regen-sources.mjs` 只重写 import specifiers。**未**从 `其他来源的整仓副本` 旧整仓快照复制 |
| 许可 | **MIT License**, Copyright (c) 2026 DeepSeek。源仓库 `LICENSE` 的逐字副本为 [`LICENSE-DSH`](./LICENSE-DSH)（sha256 `ebb4f09972aee8608be255debaf78451a68e95c290f55c240dec2ecfa16ea6be`）。每个复制文件保留原始头部注释与业务逻辑；随包附带本许可证全文 |

> 复制纪律：用户锁定「按源码颗粒度复用」；复制 **20 个**源码文件（12 纯逻辑 + 8 leaf `.tsx`），远低于「>50 文件先评审」阈值。未复制 `ChatView.tsx` / `ChatFlow.tsx` / `MessageItem.tsx` / `src/index.ts` / `client/apply.ts` / `register-node-renderers` / Cordis / schemastery / module-system / boot / `__DSH_BOOT__` / 插槽运行时 / 整个 `dsh-client-ui-primitives` barrel / 第二份 React。

### 整组 tree digest

把第 2 节的 20 行 `"相对路径\0源文件 sha256"` 用换行连接后取 sha256：

```
5e5fc39ad5226cebfcf25b6c3efe52086db24487b0b45409eba698ef7af0511b
```

## 2. 复制的源码文件（20 个，精确保持相对路径）

目标根目录：`build/dsh/chat-render/src/`；下表 `rel` 同时是相对于 `packages/client/ui-chat/` 的**源路径**。sha256 均为**源文件**（`0.2.2-rc.1`）内容哈希。复制时**只重写 import specifiers**（指向 `shims/*` 与单一份 CSS class map），业务逻辑逐字未改。

| # | rel | sha256（源文件 0.2.2-rc.1） |
| --- | --- | --- |
| 1 | `src/client/reasoning-text.ts` | `e65bed4c7627f02ed2f1db4595cbeca24d767c4c23da517d1bb262995a1bdb17` |
| 2 | `src/client/markdown-labels.ts` | `ecb76d9db853ca785b532001c31df3be7d60f98e5bcd221b28196a18db94600a` |
| 3 | `src/client/locale.ts` | `9fef3732b862b458334564efbc44bdc29b8135e6b9ec042b2ea01b1233edd7ab` |
| 4 | `src/client/chat/message-chrome.ts` | `861a573c299317e5359f735a1c33381f93537e286a1b4fbd6ad0a0c01c98629a` |
| 5 | `src/client/chat/token-format.ts` | `143a024cbec7ad51a8e0b15db5ea68a6c994bd584b6530b8ce3fb9c5c9e8646f` |
| 6 | `src/client/chat/turn-assistant.ts` | `f510f118673a53b48651cae06b9f44c765192a0e5cb1187e6945096ad36fa9b3` |
| 7 | `src/client/chat/step-process.ts` | `9a0b117d4adae19137cf2ed5e5dcfa2c3070733fe5b68a7e65626a409d3d2d36` |
| 8 | `src/client/chat/stat-dialog.ts` | `c58e74382631d7ee42f2a36f24300bf747a75d08924d9e756f477e4d07ffc14f` |
| 9 | `src/client/chat/use-disclosure.ts` | `2855d4d62ea556b37e53efdaac6dc0e589f2b22e81abc0f00f413bca35f1cddf` |
| 10 | `src/client/contract/assistant-content.ts` | `a736c22b643545b1acd072e850add94bdf628c25c13e5fb1dd1046fffaa18c85` |
| 11 | `src/client/contract/turn-metrics.ts` | `73d4f7efa088db97c091daa921f4489e43ce52ef6e8e199f09a5733a90b2705b` |
| 12 | `src/client/contract/turn-process.ts` | `dce44841b376607f143df8c990b4f9e54579655a2d6adc8fead2fe7112efe7ef` |
| 13 | `src/client/chat/ReasoningRow.tsx` | `5ff9e4f02929bf58ce091b1a0f009753685336b0437b8af4684c3a23a31f651d` |
| 14 | `src/client/chat/ReasoningContent.tsx` | `99fb2c19edeb0ff452713ab7871751715ef1cefa54465c63155383b3068cf7c4` |
| 15 | `src/client/chat/AssistantMarkdown.tsx` | `07f1fde40b63cfa4723bd049692d2e8ed705a3223ff67cfe6584e65f11a46e51` |
| 16 | `src/client/chat/UserContent.tsx` | `3964a95ad7a293ef2d07ce10ac7f429298f38556009b75d6e9ad0cd9633f9eff` |
| 17 | `src/client/chat/StatsPills.tsx` | `ce5b0c92adf74bdd43a308a412df639f61304cdc565b3dd7f9f4f2be54fd09ab` |
| 18 | `src/client/chat/TurnUsagePanel.tsx` | `50c74e7cafb5d2a3373e728f31c37a8e07271fdc888369e818551cd458cc9b1e` |
| 19 | `src/client/chat/RunningStatus.tsx` | `53971b4e146b701d5a11e9473df79dea51934079f771597af2af7f831d746a20` |
| 20 | `src/client/chat/RunningWhaleTail.tsx` | `0ddb0ab3819c0eb3b8a5ab96d8c3d5ada30771fa66d16e594faa5e552161905d` |

## 3. CSS 模块 / 图形资产（9 个）

源目录：`E:/deepseek-harness-0.2.2-rc.1/packages/client/ui-chat/src/client/chat/`（APNG 在 `../assets/running-whale@2x.png`）。
8 个 CSS 模块由 `build-css.mjs` 合并为**已入库的单份** `dsh-chat.css`（按模块前缀化 class 名、解开 `:global(...)`、把 APNG 内联为 data URL），并生成 `shims/cssClasses.ts` 作为唯一 class map。

| # | source file | bytes | sha256（源文件 0.2.2-rc.1） |
| --- | --- | --- | --- |
| 1 | `accessibility.module.css` | 137 | `57cfa9a890cb754cbd2cf9ade7d7379873620b7ee86cb8f11f0177065065788d` |
| 2 | `ReasoningRow.module.css` | 1659 | `5c28a61623c3bda67513c728422141921909d5227dbfb6c2e8a1a2e7e59079b1` |
| 3 | `AssistantMarkdown.module.css` | 3310 | `e10c5986e93070cf87bbd5c4a570a64a103c0d596d178ad4b8e170bbb6883908` |
| 4 | `MessageItem.module.css` | 9119 | `ca84271735a3e41229d4edc49bd9e3ddc06ea99698f12a2a3c98dd30a8d14743` |
| 5 | `StatsPills.module.css` | 1436 | `54c8593deae58daa06db7c3a4a5351956e6df6dbb0af7edfdfe4f113a1c6a099` |
| 6 | `stat-dialog.module.css` | 2777 | `1cf1e8b4de71799f906235b3315ef55bc52525006fbc68073665d5933ceef3ef` |
| 7 | `TurnUsagePanel.module.css` | 2137 | `4fec2bd6d9ed86bf76b4fe20f9cb54550e68d2be181065f46d5e65088eae0860` |
| 8 | `ChatView.module.css` | 14589 | `665bde92503ad829f7ea188b6631435802f30e7e2c3dd80be991cf36d3806a91` |
| 9 | `running-whale@2x.png` (APNG, 28x28, 60 帧) | 21631 | `0fd990d118113d19af7af4480f2b55d610b103451a08be6f7bf5a146823f8bd3` |

- CSS 模块组 digest（`"文件名\0sha256"` 逐行取 sha256）：`4ff615737c196b192bd6ea6136ebae7fbfb2c87ac7be2385e87aab370415eb14`。
- APNG 逐字副本已存 [`assets/running-whale@2x.png`](./assets/running-whale@2x.png)，同时内联进 `dsh-chat.css`。
- 合并产物 `dsh-chat.css` 为派生文件，**不是** DSH 源文件逐字副本；生成器 `build-css.mjs` 已入库以便复算。

## 4. 原创 sidecar 文件（非 DSH 源，不受上表哈希约束）

| 文件 | 作用 |
| --- | --- |
| `shims/primitives.tsx` | 16 个运行时符号（0.2.2-rc.1 新增 `Tooltip`、`UserMessageBubble`；见 README.md §3） |
| `shims/primitives.css` | 上述 shim 的皮肤（含 `.dsh-user-bubble`、`.dsh-tooltip-anchor`） |
| `shims/workspace-path.ts` | `fileMediaUrl` |
| `shims/types.d.ts` | erasable 类型桩（全部 `import type` 落点） |
| `shims/translate.ts` | 合并 `ui-chat/src/client/locale.ts` 的 `en`/`zh` + 少量桥接键，带 `{name}` 插值 |
| `shims/css-modules.d.ts` | CSS module 形状声明（工具链用） |
| `shims/tokens.css` | 约 33 个 `--dsw-*` / `--dsh-*` → VS Code 主题变量映射 |
| `shims/cssClasses.ts` | 8 个模块 → 1 份 class map（由 `build-css.mjs` 生成） |
| `dsh-chat.css` | 8 个 CSS 模块的合并/前缀化产物（由 `build-css.mjs` 生成） |
| `index.tsx` | 导出 `mountDshChatPart` 等命令式接入面 |
| `regen-sources.mjs` | 从只读源树按 import-rewrite 规则重新生成 `dsh/**`（0.2.1-rc.5 时对旧树 `--check` 全部 SAME，证明改写忠实） |
| `build-css.mjs` | 一次性 CSS 合并器（需要只读源树才能重跑） |
| `build-render.mjs` | **旁挂 sidecar esbuild 编译**（运行时唯一构建入口） |
| `README.md` | 与 VS Code 单接缝的接入契约 |
| `PROVENANCE.md` / `LICENSE-DSH` | 本文件 / MIT 许可证副本 |

## 5. React / 构建依赖（不复制、不打包第二份）

- `react` / `react-dom` **18.3.1**：`E:\vscode-dsh\vscode-1.143.1\node_modules\{react,react-dom}`，MIT。构建脚本用 esbuild alias 指到这份唯一目录，并 bundle 进 `dist/dsh-chat.js`；**没有**新增安装、没有复制 React 源码进本目录。
- `esbuild` **0.27.2**：`E:\vscode-dsh\vscode-1.143.1\build\node_modules\esbuild`（VS Code 官方构建依赖，MIT）。不联网、不 `npm install`。
- 未引入 cordis / schemastery / module-system / boot / `__DSH_BOOT__` / 插件图 / `ChatView.tsx` / `ChatFlow.tsx` / `MessageItem.tsx` / `dsh-client-ui-primitives` barrel。

## 6. 产物与入库边界

- `dist/dsh-chat.js` / `dist/dsh-chat.css` 由 `node build/dsh/chat-render/build-render.mjs` 生成，**不入库**：根 `.gitignore` 含 `**/dist/`。gulp `dsh-ide-pack` 在打包前现场调用该脚本，并把产物写进 bundle 的 `out/vs/workbench/contrib/dsh/browser/chatRender/`。
- 本目录**不得**写入 `src/**`；单接缝（`dshChatSeam.ts`）由 Lead 负责。

## 7. 诚实边界

- `AssistantMarkdown.tsx` 源码明确**跳过 `tool-call` 块**；DSH 真 ToolRow 位于 `packages/client/ui-tool/.../ToolRow.tsx`（另一个包），本工作**未**复制。P1 保留 VS Code 现有工具渲染件，不谎称 ui-chat 自带工具行。
- `MarkdownText` shim **不是** Markdown 渲染器；README 要求 Lead 在单接缝用 `setMarkdownDomRenderer()` 注入 VS Code `chatContentMarkdownRenderer`。
- `Tooltip` shim 是**原生 `title` 降级**：上游 `Tooltip` 是 273 行的 portal/placement/ShortcutKeys 复合体，本工作未复制其闭包，仅保留语义（tooltip 文本）。`UserMessageBubble` shim 如实复刻上游 14 行的主题化 div。
- 真实 DSH Host / Electron 冷启动下的视觉验收属于 P4，本工作未做。

## 8. 版本同步记录（0.2.1-rc.5 → 0.2.2-rc.1，2026-11-05）

**背景**：DSH 桌面端升级到 0.2.2-rc.1（安装版 `@deepseek-ai/dsh-desktop-runtime 0.2.2-rc.1` 已核实）。用 `git clone --branch dsh-v0.2.2-rc.1` 得到真实源（`upstream` 远程已配），逐文件比对 0.2.1-rc.5 → 0.2.2-rc.1。

**ui-chat 20 个复用文件中变化的 7 个**（其余 13 个逐字节相同）：
- `locale.ts`：20.5KB→94.5KB，新增 `ja/es/fr/de/ru/pt` 与更多键（超集，`translate.ts` 仅读 `NS/zh/en`，兼容）。
- `AssistantMarkdown.tsx` / `ReasoningRow.tsx`：新增可选 `textInteractionSource`（透传 `data-text-interaction-source`），向后兼容。
- `RunningStatus.tsx`：新增**必填** `paused`（+ 可选 `holding`）→ 本目录 `index.tsx` 已补 `paused: props.paused ?? false`、`holding ?? false`，并扩展 `DshPartProps.running`。
- `StatsPills.tsx`：新增运行时依赖 `Tooltip`（ui-primitives）+ `text` 无障碍名 → 新增 `shims/primitives.tsx#Tooltip` 原生 title 降级。
- `UserContent.tsx`：新增运行时依赖 `UserMessageBubble`（ui-primitives）→ 新增 `shims/primitives.tsx#UserMessageBubble`（如实复刻）。
- CSS 模块 8 个中 6 个变化（MessageItem / ChatView / StatsPills / stat-dialog / TurnUsagePanel / TurnProcessNodeView）→ `dsh-chat.css` 全量重生成（67.8KB）。APNG 从 `src/client/chat/` 移到 `src/client/assets/`，`build-css.mjs` 已适配新路径与 `url('../assets/...')`。

**传输/契约层（非渲染）核对结论——无需改动**：`client/connection` 的 `rpc.ts`、`gateway` 的 `stream-protocol.ts`/`client/index.ts`/`stream-client.ts`、`session-controller` 的 `events.ts`/`assistant-stream.ts`、`dsh-llm` 的 `StreamChunk`（`{type:'text-delta',index,text}`）均与 0.2.1-rc.5 **逐字相同**；`SessionSummary` 仍有 `sessionId`/`cwd`；`manifest.ts`/`connection/client/index.ts` 仅新增可选 `asset/resolveAsset` 钩子（附加，不影响现有用法）；`typert/protocol` 仅新增可选 `resolve` 资源身份提取（本插件 `ide` 服务未声明 resources，不受影响）；`schemastery` 3.19.0 / `cordis` 4.1.0 仍满足 `^3.18`/`^4.0` peer 范围。
