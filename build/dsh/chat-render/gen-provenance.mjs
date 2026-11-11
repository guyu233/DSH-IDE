import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const SRC_ROOT = 'E:/deepseek-harness-0.2.2-rc.1'
const UI = path.join(SRC_ROOT, 'packages/client/ui-chat/src/client')
const sha = b => crypto.createHash('sha256').update(b).digest('hex')
const size = b => b.length

const SRC_FILES = [
  'reasoning-text.ts', 'markdown-labels.ts', 'locale.ts',
  'chat/message-chrome.ts', 'chat/token-format.ts', 'chat/turn-assistant.ts',
  'chat/step-process.ts', 'chat/stat-dialog.ts', 'chat/use-disclosure.ts',
  'contract/assistant-content.ts', 'contract/turn-metrics.ts', 'contract/turn-process.ts',
  'chat/ReasoningRow.tsx', 'chat/ReasoningContent.tsx', 'chat/AssistantMarkdown.tsx',
  'chat/UserContent.tsx', 'chat/StatsPills.tsx', 'chat/TurnUsagePanel.tsx',
  'chat/RunningStatus.tsx', 'chat/RunningWhaleTail.tsx',
]
const CSS_FILES = ['accessibility.module.css', 'ReasoningRow.module.css', 'AssistantMarkdown.module.css', 'MessageItem.module.css', 'StatsPills.module.css', 'stat-dialog.module.css', 'TurnUsagePanel.module.css', 'ChatView.module.css']
const CHAT = path.join(SRC_ROOT, 'packages/client/ui-chat/src/client/chat')

const srcRows = [], srcDigestLines = []
SRC_FILES.forEach((f, i) => {
  const b = fs.readFileSync(path.join(UI, f))
  const h = sha(b); srcDigestLines.push(`${f}\0${h}`)
  srcRows.push(`| ${i + 1} | \`src/client/${f}\` | \`${h}\` |`)
})
const treeDigest = sha(Buffer.from(srcDigestLines.join('\n')))

const cssRows = [], cssDigestLines = []
CSS_FILES.forEach((f, i) => {
  const b = fs.readFileSync(path.join(CHAT, f))
  const h = sha(b); cssDigestLines.push(`${f}\0${h}`)
  cssRows.push(`| ${i + 1} | \`${f}\` | ${size(b)} | \`${h}\` |`)
})
const png = fs.readFileSync(path.join(UI, 'assets/running-whale@2x.png'))
const pngSha = sha(png)
cssRows.push(`| 9 | \`running-whale@2x.png\` (APNG, 28x28, 60 帧) | ${size(png)} | \`${pngSha}\` |`)
const cssDigest = sha(Buffer.from(cssDigestLines.join('\n')))

const licSha = sha(fs.readFileSync(path.join(SRC_ROOT, 'LICENSE')))
const commit = '66491b05e3 (tag dsh-v0.2.2-rc.1)'

const md = `# PROVENANCE — \`build/dsh/chat-render/\`

P1 聊天渲染资产的来源与许可证记录。本文件是 \`docs/DEVELOPMENT.md\` 第 1 章资源复用章节的落盘凭据。

> **版本同步（2026-11-05）**：DSH 桌面端已升级到 **0.2.2-rc.1**，本目录的复用源随之从 \`0.2.1-rc.5\` 同步到 \`0.2.2-rc.1\`。同步记录见 §8。

## 1. 源与版本（真实 Git 提交）

| 项 | 值 |
| --- | --- |
| 权威源仓库（**只读，绝不写**） | \`E:\\deepseek-harness-0.2.2-rc.1\`（官方 \`deepseek-ai/deepseek-harness\` 的 \`dsh-v0.2.2-rc.1\` tag 克隆） |
| 源包 | \`packages/client/ui-chat/\`（\`@deepseek-ai/dsh-client-ui-chat\`） |
| 版本 | \`0.2.2-rc.1\`（源仓库根 \`package.json\` 的 \`version\` 字段） |
| \`sourceCommit\` | \`${commit}\` — 本次为真实克隆，记录实际 tag 与 commit；不再留空 |
| 采集时间 | 2026-11-05 (Asia/Shanghai) |
| 采样方式 | 逐文件从 \`${SRC_ROOT}/packages/client/ui-chat/\` 读取，只复制下列精确相对路径；由 \`regen-sources.mjs\` 只重写 import specifiers。**未**从 \`其他来源的整仓副本\` 旧整仓快照复制 |
| 许可 | **MIT License**, Copyright (c) 2026 DeepSeek。源仓库 \`LICENSE\` 的逐字副本为 [\`LICENSE-DSH\`](./LICENSE-DSH)（sha256 \`${licSha}\`）。每个复制文件保留原始头部注释与业务逻辑；随包附带本许可证全文 |

> 复制纪律：用户锁定「按源码颗粒度复用」；复制 **20 个**源码文件（12 纯逻辑 + 8 leaf \`.tsx\`），远低于「>50 文件先评审」阈值。未复制 \`ChatView.tsx\` / \`ChatFlow.tsx\` / \`MessageItem.tsx\` / \`src/index.ts\` / \`client/apply.ts\` / \`register-node-renderers\` / Cordis / schemastery / module-system / boot / \`__DSH_BOOT__\` / 插槽运行时 / 整个 \`dsh-client-ui-primitives\` barrel / 第二份 React。

### 整组 tree digest

把第 2 节的 20 行 \`"相对路径\\0源文件 sha256"\` 用换行连接后取 sha256：

\`\`\`
${treeDigest}
\`\`\`

## 2. 复制的源码文件（20 个，精确保持相对路径）

目标根目录：\`build/dsh/chat-render/src/\`；下表 \`rel\` 同时是相对于 \`packages/client/ui-chat/\` 的**源路径**。sha256 均为**源文件**（\`0.2.2-rc.1\`）内容哈希。复制时**只重写 import specifiers**（指向 \`shims/*\` 与单一份 CSS class map），业务逻辑逐字未改。

| # | rel | sha256（源文件 0.2.2-rc.1） |
| --- | --- | --- |
${srcRows.join('\n')}

## 3. CSS 模块 / 图形资产（9 个）

源目录：\`${SRC_ROOT}/packages/client/ui-chat/src/client/chat/\`（APNG 在 \`../assets/running-whale@2x.png\`）。
8 个 CSS 模块由 \`build-css.mjs\` 合并为**已入库的单份** \`dsh-chat.css\`（按模块前缀化 class 名、解开 \`:global(...)\`、把 APNG 内联为 data URL），并生成 \`shims/cssClasses.ts\` 作为唯一 class map。

| # | source file | bytes | sha256（源文件 0.2.2-rc.1） |
| --- | --- | --- | --- |
${cssRows.join('\n')}

- CSS 模块组 digest（\`"文件名\\0sha256"\` 逐行取 sha256）：\`${cssDigest}\`。
- APNG 逐字副本已存 [\`assets/running-whale@2x.png\`](./assets/running-whale@2x.png)，同时内联进 \`dsh-chat.css\`。
- 合并产物 \`dsh-chat.css\` 为派生文件，**不是** DSH 源文件逐字副本；生成器 \`build-css.mjs\` 已入库以便复算。

## 4. 原创 sidecar 文件（非 DSH 源，不受上表哈希约束）

| 文件 | 作用 |
| --- | --- |
| \`shims/primitives.tsx\` | 16 个运行时符号（0.2.2-rc.1 新增 \`Tooltip\`、\`UserMessageBubble\`；见 README.md §3） |
| \`shims/primitives.css\` | 上述 shim 的皮肤（含 \`.dsh-user-bubble\`、\`.dsh-tooltip-anchor\`） |
| \`shims/workspace-path.ts\` | \`fileMediaUrl\` |
| \`shims/types.d.ts\` | erasable 类型桩（全部 \`import type\` 落点） |
| \`shims/translate.ts\` | 合并 \`ui-chat/src/client/locale.ts\` 的 \`en\`/\`zh\` + 少量桥接键，带 \`{name}\` 插值 |
| \`shims/css-modules.d.ts\` | CSS module 形状声明（工具链用） |
| \`shims/tokens.css\` | 约 33 个 \`--dsw-*\` / \`--dsh-*\` → VS Code 主题变量映射 |
| \`shims/cssClasses.ts\` | 8 个模块 → 1 份 class map（由 \`build-css.mjs\` 生成） |
| \`dsh-chat.css\` | 8 个 CSS 模块的合并/前缀化产物（由 \`build-css.mjs\` 生成） |
| \`index.tsx\` | 导出 \`mountDshChatPart\` 等命令式接入面 |
| \`regen-sources.mjs\` | 从只读源树按 import-rewrite 规则重新生成 \`dsh/**\`（0.2.1-rc.5 时对旧树 \`--check\` 全部 SAME，证明改写忠实） |
| \`build-css.mjs\` | 一次性 CSS 合并器（需要只读源树才能重跑） |
| \`build-render.mjs\` | **旁挂 sidecar esbuild 编译**（运行时唯一构建入口） |
| \`README.md\` | 与 VS Code 单接缝的接入契约 |
| \`PROVENANCE.md\` / \`LICENSE-DSH\` | 本文件 / MIT 许可证副本 |

## 5. React / 构建依赖（不复制、不打包第二份）

- \`react\` / \`react-dom\` **18.3.1**：\`E:\\vscode-dsh\\vscode-1.143.1\\node_modules\\{react,react-dom}\`，MIT。构建脚本用 esbuild alias 指到这份唯一目录，并 bundle 进 \`dist/dsh-chat.js\`；**没有**新增安装、没有复制 React 源码进本目录。
- \`esbuild\` **0.27.2**：\`E:\\vscode-dsh\\vscode-1.143.1\\build\\node_modules\\esbuild\`（VS Code 官方构建依赖，MIT）。不联网、不 \`npm install\`。
- 未引入 cordis / schemastery / module-system / boot / \`__DSH_BOOT__\` / 插件图 / \`ChatView.tsx\` / \`ChatFlow.tsx\` / \`MessageItem.tsx\` / \`dsh-client-ui-primitives\` barrel。

## 6. 产物与入库边界

- \`dist/dsh-chat.js\` / \`dist/dsh-chat.css\` 由 \`node build/dsh/chat-render/build-render.mjs\` 生成，**不入库**：根 \`.gitignore\` 含 \`**/dist/\`。gulp \`dsh-ide-pack\` 在打包前现场调用该脚本，并把产物写进 bundle 的 \`out/vs/workbench/contrib/dsh/browser/chatRender/\`。
- 本目录**不得**写入 \`src/**\`；单接缝（\`dshChatSeam.ts\`）由 Lead 负责。

## 7. 诚实边界

- \`AssistantMarkdown.tsx\` 源码明确**跳过 \`tool-call\` 块**；DSH 真 ToolRow 位于 \`packages/client/ui-tool/.../ToolRow.tsx\`（另一个包），本工作**未**复制。P1 保留 VS Code 现有工具渲染件，不谎称 ui-chat 自带工具行。
- \`MarkdownText\` shim **不是** Markdown 渲染器；README 要求 Lead 在单接缝用 \`setMarkdownDomRenderer()\` 注入 VS Code \`chatContentMarkdownRenderer\`。
- \`Tooltip\` shim 是**原生 \`title\` 降级**：上游 \`Tooltip\` 是 273 行的 portal/placement/ShortcutKeys 复合体，本工作未复制其闭包，仅保留语义（tooltip 文本）。\`UserMessageBubble\` shim 如实复刻上游 14 行的主题化 div。
- 真实 DSH Host / Electron 冷启动下的视觉验收属于 P4，本工作未做。

## 8. 版本同步记录（0.2.1-rc.5 → 0.2.2-rc.1，2026-11-05）

**背景**：DSH 桌面端升级到 0.2.2-rc.1（安装版 \`@deepseek-ai/dsh-desktop-runtime 0.2.2-rc.1\` 已核实）。用 \`git clone --branch dsh-v0.2.2-rc.1\` 得到真实源（\`upstream\` 远程已配），逐文件比对 0.2.1-rc.5 → 0.2.2-rc.1。

**ui-chat 20 个复用文件中变化的 7 个**（其余 13 个逐字节相同）：
- \`locale.ts\`：20.5KB→94.5KB，新增 \`ja/es/fr/de/ru/pt\` 与更多键（超集，\`translate.ts\` 仅读 \`NS/zh/en\`，兼容）。
- \`AssistantMarkdown.tsx\` / \`ReasoningRow.tsx\`：新增可选 \`textInteractionSource\`（透传 \`data-text-interaction-source\`），向后兼容。
- \`RunningStatus.tsx\`：新增**必填** \`paused\`（+ 可选 \`holding\`）→ 本目录 \`index.tsx\` 已补 \`paused: props.paused ?? false\`、\`holding ?? false\`，并扩展 \`DshPartProps.running\`。
- \`StatsPills.tsx\`：新增运行时依赖 \`Tooltip\`（ui-primitives）+ \`text\` 无障碍名 → 新增 \`shims/primitives.tsx#Tooltip\` 原生 title 降级。
- \`UserContent.tsx\`：新增运行时依赖 \`UserMessageBubble\`（ui-primitives）→ 新增 \`shims/primitives.tsx#UserMessageBubble\`（如实复刻）。
- CSS 模块 8 个中 6 个变化（MessageItem / ChatView / StatsPills / stat-dialog / TurnUsagePanel / TurnProcessNodeView）→ \`dsh-chat.css\` 全量重生成（67.8KB）。APNG 从 \`src/client/chat/\` 移到 \`src/client/assets/\`，\`build-css.mjs\` 已适配新路径与 \`url('../assets/...')\`。

**传输/契约层（非渲染）核对结论——无需改动**：\`client/connection\` 的 \`rpc.ts\`、\`gateway\` 的 \`stream-protocol.ts\`/\`client/index.ts\`/\`stream-client.ts\`、\`session-controller\` 的 \`events.ts\`/\`assistant-stream.ts\`、\`dsh-llm\` 的 \`StreamChunk\`（\`{type:'text-delta',index,text}\`）均与 0.2.1-rc.5 **逐字相同**；\`SessionSummary\` 仍有 \`sessionId\`/\`cwd\`；\`manifest.ts\`/\`connection/client/index.ts\` 仅新增可选 \`asset/resolveAsset\` 钩子（附加，不影响现有用法）；\`typert/protocol\` 仅新增可选 \`resolve\` 资源身份提取（本插件 \`ide\` 服务未声明 resources，不受影响）；\`schemastery\` 3.19.0 / \`cordis\` 4.1.0 仍满足 \`^3.18\`/\`^4.0\` peer 范围。
`

fs.writeFileSync(path.join(import.meta.dirname, 'PROVENANCE.md'), md, 'utf8')
console.log('PROVENANCE.md regenerated')
console.log('treeDigest', treeDigest)
console.log('cssDigest', cssDigest)
