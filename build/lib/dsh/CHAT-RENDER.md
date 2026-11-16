# DSH 聊天组件层说明

> 本文说明 `src/vs/workbench/contrib/chat/browser/widget/chatContentParts/dsh/` 的职责与约束。
> 只描述「怎么渲染」，不重复 DSH 协议或 ChatModel 通路（见 `dshIdeProtocol.ts` 与 `dshChatModelDriver.ts`）。

## 1. 数据契约：两个真值 + 一个分派信号

`IChatDshNodePart` 携带三段数据，各有严格分工：

| 字段 | 是什么 | 谁用 | 能否改 |
| --- | --- | --- | --- |
| `encoded` | 源载荷（DSH 事件信封 `{seq,time,type,data}`）的 canonical JSON | 「原始载荷」详情、解码兜底、L0/L1/L3 校验 | **不可改**——校验真值 |
| `projectionEncoded` | 解码后节点的 canonical JSON（已剥离 `raw` 与 IDE 私有字段） | 子视图读字段 | 随解码层演进而变 |
| `hint` | 节点语义 kind（`user`/`assistant`/`tool-result`…） | 只用于选择渲染函数 | 随解码层演进而变 |

三者同源：`verifyProjectionBinding` 断言 `seq` 一致、`hint` 与投影 `kind` 一致、投影不含 `raw`；
`verifyNoIdeOnlyFields` 断言 IDE 私有字段（如 `turnEnded`）不进入投影。

**为什么不让渲染层自己推导 kind**：`turn/end` 同时承载 `turn-error` 与 `turn-max-tokens`，
`user/message` 同时承载 `user` 与 `context`，`command/run` 与 `command/done` 需要跨事件合并。
这些判别在解码层已经完成，渲染层重复推导只会引入第二套真相。

## 2. 渲染纪律

1. **不 import `dshChatModel` / `dshChatSession`**：渲染层只依赖本地窄类型与两个 JSON 字符串。
2. **不读会话状态**：不读 `DshChatSession`、不读 ChatModel 的其它 part。
3. **不伪造**：不写死标签、不补默认文案、不显示伪造的 0；`null` 与「字段缺失」必须分开呈现。
4. **原始载荷兜底**：每个节点都挂 `DshRawJsonView`，逐字显示 `encoded`。专用视图可以只展开部分字段，
   但源字段永远不会从界面上消失。这是 L2 渲染完整性的最后一道保险。
5. **折叠只是 UI 状态**：`<details>` 的展开/收起不写回任何 encoded。

## 3. 文件清单

| 文件 | 职责 |
| --- | --- |
| `dshNodeTypes.ts` | 本地窄类型、`DshViewKind`、安全读取函数（`isRecord`/`asString`/`asStringOrNull`/`asNumber`/…） |
| `dshViewParts.ts` | 共用件：折叠区块、字段行、徽标、卡片、标题行、markdown 渲染 |
| `dshRawJsonView.ts` | 「原始载荷」详情 + 复制 encoded |
| `dshUserView.ts` | `user` / `steering` |
| `dshAssistantView.ts` | `assistant`（text/reasoning/image/tool-call/other + usage/timing/interrupted） |
| `dshToolView.ts` | `tool-call` / `tool-result`（递归子调用、参数折叠、错误码） |
| `dshContextView.ts` | `context`（折叠行，`form` 不转译） |
| `dshCommandView.ts` | `command`（`null` 状态原样显示，成功/失败分色） |
| `dshCompactionView.ts` | `compaction`（`summary === null` 显式呈现，统计值不伪造） |
| `dshModelRetryView.ts` | `model-retry`（三态徽标，`failure` 完整显示） |
| `dshTurnErrorView.ts` | `turn-error` |
| `dshTurnMaxTokensView.ts` | `turn-max-tokens`（不添加载荷没有的 token 数字） |
| `dshInheritedHistoryView.ts` | `inherited-history` 分隔线 |
| `dshUnknownView.ts` | `unknown`（`type` + 完整 `data`，禁止静默返回空） |
| `dshAttachmentView.ts` | 图片/文件附件（内联 → `readAttachment` → 原始 JSON 兜底）+ lightbox |

## 4. 图标与样式

- 图标一律用 `codicon`，不复制 DSH 运行时 sprite，也不新增图标依赖。
- 样式全部限定在 `.dsh-session` 作用域，只读 VS Code 主题变量，不引入第二套配色。
- 折叠/展开用原生 `<details>`，键盘可达、自带 `aria-expanded` 语义。

## 5. 验证边界（诚实声明）

- **可离线验证**：本地守卫（`dshNodeViews.test.ts`）、双真值绑定（`dshMappingVerifier.test.ts`）。
- **必须真机验证**：DOM 渲染结果、markdown 渲染、图片加载、lightbox、dark/hc 主题、窄侧栏。
  VS Code 的 `base/browser/dom.js` 在模块顶层依赖真实 `window.location`，纯 Node 环境无法可靠模拟，
  因此这部分按 AGENTS.md §6 由用户执行，AI 不代跑。
