# `build/dsh/chat-render/` — P1 聊天渲染 sidecar

给 **Lead** 直接接 `vscode-1.143.1/src/vs/workbench/contrib/chat/browser/chatListRenderer.ts` 的接入契约。
本目录是「**单接缝**改 VS Code 现有聊天侧栏 + **按源码颗粒度**复用 DSH `ui-chat` 渲染件 + **只带一份 React**」的渲染资产与旁挂编译阶段；**不是**搬整套 DSH React/Cordis/插件图/boot/`__DSH_BOOT__`，**不是**另建独立壳/接待层。

权威依据：`AGENTS.md`；`AGENTS.md`（资源与代码复用优先）。
来源、版本、逐文件 sha256、MIT 许可见 [`PROVENANCE.md`](./PROVENANCE.md) 与 [`LICENSE-DSH`](./LICENSE-DSH)。

---

## 1. 构建（旁挂 sidecar，不是平行 VS Code 编译）

```bash
# 仓库根 E:\vscode-dsh，Windows bash / cmd 均可
node build/dsh/chat-render/build-render.mjs
```

- 只编译本目录的 20 个 DSH leaf 源 + shims + 1 个入口，**不碰** `vscode-1.143.1/src/tsc`、不碰 VS Code 官方 gulp 构建图。
- 用 `vscode-1.143.1/build/node_modules/esbuild`（0.27.2，已装）：`jsx: 'automatic'`、`format: 'esm'`、`platform: 'browser'`、`bundle: true`。
- React / ReactDOM **18.3.1** 由 esbuild alias 指向唯一一份 `vscode-1.143.1/node_modules/{react,react-dom}`，直接 bundle 进产物；**没有第二份 React**，VS Code `src/` 也不需要 `@types/react`。
- 产物（**git-ignored，不入库**；根 `.gitignore` 的 `**/dist/`）：
  - `dist/dsh-chat.js` — 单个 ESM 文件（≈389 KB，未 minify，含 React 生产版）
  - `dist/dsh-chat.css` — 合并 CSS，随包便于审计/调试（**运行时不依赖它**：JS 自注入，见 §5）
- gulp `dsh-ide-pack` 已接（`prepare-dsh-chat-render`，在 `esbuildBundleTask` **之后**执行，因为 `bundle()` 会先 `cleanDir()`）：
  ```js
  const script = path.join(vscodeRoot, 'build/dsh/chat-render/build-render.mjs');
  const r = cp.spawnSync(process.execPath, [script], { cwd: repoRoot, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('sidecar chat-render build failed');
  ```
  ⚠️ 必须用**跑 gulp 的 Node**（`process.execPath`），若 dsh-ide-pack 在 Electron 主进程内跑，请改走 node 可执行文件或 `ELECTRON_RUN_AS_NODE=1`。脚本用 `import.meta.url` 定位全部路径，**cwd 无关**，不联网、不 `npm install`、不依赖 `E:\deepseek-harness`（源码与合并 CSS 已入库）。
- 可选（需要只读源树才能重跑的**一次性**合并器，不是运行时步骤）：
  `node build/dsh/chat-render/build-css.mjs` → 重新生成 `dsh-chat.css` + `shims/cssClasses.ts` + `assets/running-whale@2x.png`。

---

## 2. 导出面（`dist/dsh-chat.js`，ESM）

### 2.1 命令式挂载 API（Lead 用这个，**零 React import**）

```ts
export function mountDshChatPart(domNode: HTMLElement, props: DshPartProps): DshChatHandle;

export interface DshChatHandle {
  update(props: DshPartProps): void;   // 同一个 root 的增量重绘（流式 token 用这个）
  dispose(): void;                     // root.unmount()
  readonly domNode: HTMLElement;       // 就是传进来的 IChatContentPart.domNode
}

export type DshPartProps =
  | { kind: 'reasoning'; text: string; running?: boolean; t?: DshTranslate }
  | { kind: 'markdown';  blocks: readonly AssistantBlock[]; streaming?: boolean;
      interrupted?: boolean; reasoningHidden?: boolean; groupPart?: string;
      mentions?: MarkdownFileMentions; t?: DshTranslate }
  | { kind: 'user';      content: { text: string;
      attachments?: readonly { type: 'file'|'image'; file?: { name: string; bytes: number }; image?: any }[];
      extraBlocks?: readonly unknown[]; referenceLabels?: readonly string[] }; t?: DshTranslate }
  | { kind: 'stats';     usage: { totalTokens: number; outputTokens: number;
      uncachedInputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number;
      reasoningTokens?: number; routes?: readonly { provider: string; model: string }[] };
      t?: DshTranslate }
  | { kind: 'running';   startTime?: number; label?: string; t?: DshTranslate };
```

**`t` 不要求从 VS Code 侧传**：sidecar 用 `shims/translate.ts` 的默认实例（复制的 `locale.ts` 的 `en`/`zh` + 10 个桥接键，`{name}` 插值）。可用 `setLocale(vscode.env.language)` 或 `setLocale('zh')` 全局切换；单个 part 也可传 `t` 覆盖。`DshTranslate = (key: string, params?: Record<string, string|number>) => string`。

其它导出：`DshChatPart({ props })`（React 组件，供高级接缝/测试）、`injectDshChatStyles(doc?)`、`dshChatCss` / `dshChatCssHash`、`setMarkdownDomRenderer(renderer|null)`、`setLocale` / `getLocale` / `t`，以及 20 个源码里的**纯逻辑**与 leaf 组件（`reasoningText` / `markdownLabels` / `formatTokens` / `processTitle` / `useDisclosure` / `AssistantMarkdown` / `ReasoningRow` / `UserContent` / `TurnUsagePanel` / `RunningStatus` / `RunningWhaleTail` …共 65 个命名导出）。`default` 导出一个对象，含 `mountDshChatPart` 等常用项。

### 2.2 `IChatContentPart` 单接缝骨架（示例，**Lead 自行实现，本目录不改 `src/**`**）

```ts
// chatListRenderer.ts —— renderContentPart 顶部，其余内容一律 return undefined 交回原生
if (dshChatRendererEnabled() && isDshDisplayPart(content)) {
  const domNode = document.createElement('div');
  domNode.classList.add('dsh-chat-part');
  let handle: DshChatHandle | undefined;
  let pending: DshPartProps = toDshPartProps(content);  // DSH 事件 → 中立回合部件 → props
  let disposed = false;

  // ESM 动态导入；VS Code src 无 jsx / @types/react，这里零 React import
  void import(sidecarUrl /* FileAccess.asBrowserUri(DSH_CHAT_SIDECAR_PATH) */)
    .then(m => {
      m.setLocale(vscode.env.language);
      m.setMarkdownDomRenderer(vsCodeMarkdownRenderer);   // 见 §4
      if (disposed) return;
      handle = m.mountDshChatPart(domNode, pending);
    });

  return {
    domNode,
    hasSameContent(other: IChatContentPart): boolean {
      // 用 content 的 id/version 比较；true 时不要再建 root
      return sameDshContent(other, content);
    },
    dispose(): void {
      disposed = true;
      handle?.dispose();          // 内部 root.unmount()；之后不再 update()
      handle = undefined;
    },
  };
}
```

**生命周期铁律**
- 每个 `IChatContentPart` **只建一个** `createRoot`（`mountDshChatPart` 内部）。
- 流式增量只调 `handle.update(next)`，**不要**每个 token 建 root；`update()` 在 `dispose()` 后是 no-op。
- `dispose()` 调用同步 `root.unmount()`；不要在同一 tick 再 `render`（handle 已用 `disposed` 标志拦住）。
- 动态 import 是异步的：import 完成前若 part 已 dispose，示例用 `disposed` 标志避免挂载泄漏。
- `hasSameContent` 由 Lead 按 content 身份实现；返回 `true` 时不重建 part，而是对现有 handle 调 `update()`（虚拟化复用）。
- **保留 VS Code 现有工具渲染件**：`AssistantMarkdown.tsx` 明确跳过 `tool-call` 块，真 DSH ToolRow 在另一个包（本工作未复制）。不要谎称 ui-chat 自带工具行。

---

## 3. shim 符号表（`shims/primitives.tsx`，16 个运行时符号）

不复制 `dsh-client-ui-primitives` barrel（127 文件 / Markdown+shiki+katex+micromark+icons 1686 行）；用薄 shim 顶上。

| # | 符号 | 实现 |
| --- | --- | --- |
| 1 | `DisclosureRow` | 纯 DOM `<details>/<summary>`，保留 `[data-open]` / `[data-disclosure-header]`，VS Code `codicon-chevron-right` 折叠箭头 |
| 2 | `TextShimmer` | CSS `background-clip:text` 渐变扫光，`prefers-reduced-motion` 关闭 |
| 3 | `JsonBlock` | `<details>` + `<pre>`，4000 字符预览 + `truncatedLabel(total)` |
| 4 | `MarkdownText` | **可注入**：`setMarkdownDomRenderer()` 接 VS Code `chatContentMarkdownRenderer`；未注入时降级为 React 转义纯文本（见 §4） |
| 5 | `useAnchoredPosition` | viewport-clamped `position:fixed` 弹层定位（stat dialog 用），measure pass 返回 `null` |
| 6 | `useDismissOnOutsidePointer` | 外部 pointerdown / capture click 关闭，portal panel 算内部 |
| 7 | `fileExtension` | path → 小写扩展名 |
| 8 | `FileTypeIcon` | `codicon-file` / `codicon-file-code` |
| 9 | `fileSizeText` | B/KB/MB/GB/TB |
| 10 | `IconThinkOutlineRegular` | `codicon-lightbulb` |
| 11 | `IconDatabaseOutlineRegular` | `codicon-database` |
| 12 | `IconGaugeOutlineRegular` | `codicon-dashboard` |
| 13 | `IconChevronRightRegular` | `codicon-chevron-right` |
| 14 | `IconFileOutlineRegular` | `codicon-file`（可传 `glyph` 覆盖） |
| 15 | `UserMessageBubble` | 0.2.2-rc.1 新增：如实复刻上游主题化 div（`MessageItem` 用户气泡改用此件） |
| 16 | `Tooltip` | 0.2.2-rc.1 新增：上游 `Tooltip` 为 273 行 portal/placement 复合体，此处**原生 `title` 降级**（仅保留 tooltip 文本语义，`StatsPills` 的 `onlyWhenClipped` 提示退化为常显 title） |

全部图标复用 VS Code workbench 已加载的 codicon 字体（AGENTS.md 资源复用优先），**未自绘 SVG/LOGO**。鲸鱼动画图形是从只读源逐字复制的 `running-whale@2x.png`（APNG），见 `assets/` 与 PROVENANCE.md §3。

另外：`shims/workspace-path.ts` 提供 `fileMediaUrl`（保守地只放行 http(s)/data/blob vscode-resource URL；本地路径返回 `undefined`，Lead 可在单接缝用 `asWebviewUri` 桥接替换）；`shims/types.d.ts` 是所有可擦除 `import type` 的落点（不产生运行时代码）；`shims/tokens.css` 把约 33 个 `--dsw-*` / `--dsh-*` 映射到 `--vscode-*` 主题变量。

---

## 4. Markdown renderer（**重要，诚实边界**）

`MarkdownText` **不是** Markdown 实现，也不是把 VS Code 的 `chatContentMarkdownRenderer` 塞进 bundle（那样会拉进 VS Code `src/` 模块图，破坏 sidecar 边界）。请在单接缝注入一次：

```ts
type MarkdownDomRenderer = (options: {
  text: string; streaming: boolean; labels?: MarkdownLabels; variant?: string;
  fileMentions?: unknown; pathImages?: { resolve?: (v: string) => string | undefined };
}) => Node | string | void;

m.setMarkdownDomRenderer(options => {
  // 用 VS Code 现有 chatContentMarkdownRenderer / IMarkdownRenderer 产出 DOM Node
  // 例：const node = document.createElement('div'); renderer.render(md).appendTo(node); return node;
  return node;
});
```

- 返回 `Node` → append；返回 `string` → 由 sidecar 写入 `innerHTML`（**调用方须保证已消毒**）；返回 `void` → 渲染器自行异步挂载。
- 未注入 / 渲染器抛错时降级为转义纯文本 + `white-space:pre-wrap`，流式不会白屏。
- `markdownLabels(t)` 由复制的 DSH 源码产出 code/footnotes 标签，原样传给 options.labels。

---

## 5. CSS 注入

`mountDshChatPart()` 自动调用 `injectDshChatStyles(domNode.ownerDocument)`：把 `tokens.css + primitives.css + dsh-chat.css` 作为 `<style id="dsh-chat-styles" data-dsh-chat data-dsh-chat-hash="…">` 一次性 append 到 `document.head`，按 CSS 内容哈希幂等（第二个 part / 第二次挂载不会重复插入）。**Lead 不需要（也不能）在 `src/` 里 `import './dsh-chat.css'`**。

- `dist/dsh-chat.css` 仍产出并建议随 tgz 带上，便于审计/调试；运行时不强依赖。
- 8 个 CSS 模块合并为一份、class 名按模块前缀化（`.dsh-reasoningRow-root` 等），`:global(...)` 解开；`ChatView.module.css` 的 `.running*` 段包含在内。
- `shims/cssClasses.ts` 是唯一 class map，复制的 `.tsx` 从这里取类名。

---

## 6. 一份 React 如何共享

```
vscode-1.143.1/node_modules/react@18.3.1  ─┐
vscode-1.143.1/node_modules/react-dom@18.3.1 ├─ esbuild alias ─► dist/dsh-chat.js (bundle 内)
                                            ┘                         │
VS Code chatListRenderer.ts ── dynamic import() ─────────────────────┘
   （零 React import、零 JSX、零 @types/react）      mountDshChatPart() → createRoot()
```

- sidecar 是**唯一**持有 React 的地方；VS Code `src/tsconfig*.json` 无 `jsx`、include 仅 `*.ts`、无 `@types/react` 的现状**不需要改动**。
- 产物是 ESM：必须用 dynamic `import()`，不要 `require()`；若打包进 AMD/CJS 边界，由 Lead 用 VS Code 官方 loader 包装。
- `createPortal(..., document.body)` 的 stat dialog 用同一个 `react-dom` 实例，不会出现第二个 React 副本的 hook 错误。

---

## 7. P3 打包清单（给 Lead）

最小运行时文件：
- `chat-render/dist/dsh-chat.js`、`chat-render/dist/dsh-chat.css`（gulp 现编，不入库）
- `chat-render/PROVENANCE.md`、`chat-render/LICENSE-DSH`（MIT 合规随包）

`dsh/` 源码、`shims/`、`build-*.mjs`、`README.md` 是构建期文件，**不必**进 tgz（若希望源码随包审计可加，但无运行时价值）。`assets/running-whale@2x.png` 已内联进 CSS，运行时不需单独文件。

---

## 8. 已知边界 / 风险

1. **工具行**：ui-chat 的 `AssistantMarkdown` 跳过 tool-call 块；工具渲染继续用 VS Code 原生部件。真 DSH ToolRow 在 `packages/client/ui-tool`（未复制）。
2. **Markdown**：需 Lead 注入 `chatContentMarkdownRenderer`；未注入时是纯文本降级（§4）。Mermaid/Markdown 完整能力仍归 VS Code 上游，不因本 sidecar 精简。
3. **数据面**：DSH `session/follow` → VS Code `IChatProgress` 映射、终止信号、`isLocalDsh` 判定**不在本目录职责内**；sidecar 不读 env / `DSH_IDE_SESSION` / ChatModel / session metadata，只接收单接缝传来的最小 props，避免第二套判定源（P2/Lead 负责）。
4. **视觉验收**：真实 DSH Host + Electron 冷/热启动下的显示未在本环境验证（计划 §8，P4）。
5. **CSS 派生**：`dsh-chat.css` 是前缀化 + data URL 的合并产物，不是源文件逐字副本；复算用 `build-css.mjs`（需要只读源树）。
6. **React 生产版**：构建时 `process.env.NODE_ENV='"production"'`；如需 dev 版调试，改 `build-render.mjs` 的 `define` 重跑即可。
