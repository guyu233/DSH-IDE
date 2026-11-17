# DSH-IDE 承接 DSH 官方聊天页面的路线草稿

> 本文为路线草稿。已完成部分按实测结果压缩为摘要，未完成部分给出方案与证据。所有 `file:line` 以分析时快照为准。
>
> 起始分析：2026-11-16；进度更新：2026-11-17。
>
> 参考：`docs/DSH-core内容进入桌面前端的全部入口.md`、`docs/DSH-IDE内容接收与ChatSession面板架构分析.md`、`docs/DSH聊天页面全量构成与插件显示机制.md`、`docs/DSH-IDE改造开发手册.md`、DSH 源码 `E:/deepseek-harness/`、当前 DSH-IDE 源码 `E:/DSH-IDE/src/`。

---

## 0. 进度总览（最新状态）

### 0.1 当前阶段状态

| 阶段 | 状态 | 说明 |
|---|---|---|
| 路线决策 | 完成 | 见第 1 章：原生 chat 面板 + 翻译层，不引入 slot / Webview |
| 第二阶段 2-A~2-D | **代码完成** | 门禁全绿、产物已打包并装入 profile |
| 第二阶段 2-E | **待用户执行** | 重启 DSH + 真机 GUI 验收（AI 不代跑） |
| 子智能体会话树 | **方案取证完成，待讨论确认** | 见第 5 章，证据链已闭合 |

> 重启前 `cordis_inspect_query(Config.listConfigs{name:"dsh-ide"})` 返回 `status:"absent"`，说明运行时尚未加载新代码。

### 0.2 第二阶段完成摘要（压缩）

**落地内容**（详细记录见 `docs/DSH-IDE改造开发手册.md` §8.5–§8.7、§9.2/§9.5）：

| 阶段 | 已完成内容 |
|---|---|
| 2-A 数据层 | `DshChatSession` 补 `plan/goal/todos/skills` 存储 + getter + 判重 + bind 清空；`extrasOf(source)` 下沉为纯函数作为唯一装配入口 |
| 2-B 渲染翻译层 | 工具 → `toolInvocationSerialized`（含子调用展开、callId 去重）；`turn-error`/`quotaNotice` → response 级 `errorDetails`。按源码证据判定不可行并保留降级：`confirmation` 只走 `sendRequest`、`questionCarousel` 缺 resolveId、`planReview` 缺正文、`attachmentId` 非 URI |
| 2-C 会话面板 | `setChatSessionItemArchived`（走官方 archive/unarchive）；`setChatSessionItemRead`（仅本地，明确不假装持久化） |
| 2-D 图标 | 从官方 `ICON_ARTWORK` 生成 104 个 glyph 内联 data URI（`--check` 防漂移）；`dshCodiconMap` 语义映射；`platform/theme` 单槽位替换缝 + `getCSS()` mask 规则 |

**对抗复核**：3 个 workflow、5 个子智能体（绑定 `workbuddylocal/glm-5.3-flash` 与 `workbuddylocal/hy4flash`，`maxDepth:2`）。报出的 4 个真缺陷（运行中工具双卡、连续 turn-error 互相覆盖、`sameSkills` 漏比 3 字段、quota 覆盖真错误）已全部修复并补回归断言；`extrasOf` 测试盲点已补。

**验证（本轮实测）**：

- `test-dsh:all`：370 项 node + 7 项 mocha 全过。
- `verify:dsh-ide-ci`（`DSH_INSTALLED_VERSION=0.2.2-rc.3`）：五步全 PASS（含 contract）。
- 全量 `tsc --noEmit`：仍 FAIL，137 条全在既有 VS Code 文件；**本批改动文件零错误**（按 AGENTS §5.5 如实记录）。
- `gulp dsh-ide-pack`：`dist/dsh-ide-2.0.0.tgz`，142,011,142 B，sha256 `514f9967…8b62d7`。
- `verify:dsh-artifact` PASS；`verify:dsh-install-drift` PASS（24/24 逐字节一致）；`genDshIconDataUris.mjs --check` PASS。
- 解包 `workbench.desktop.main.js` 确认 `extrasOf`/`drawnCallIds`/`withArchived`/`DSH_CODICON_GLYPH_MAP` 等符号在包内。
- 共 15 个提交，工作区干净；`NOTICE.md` 与四份法律凭据未改；来源见 `build/lib/dsh/ICON-PROVENANCE.md`。

> 复核子智能体误报的「mocha 13 项」「365 项被取代」来自其读到的其他日志，已复跑更正为 7 项 / 370 项，手册 §8.6 已注明。

### 0.3 当前进行中：子智能体会话树

需求：在 chat 容器的 Session 面板里，让会话能展开它的子智能体会话；子智能体自己还能继续展开下一层。用 VS Code 原生会话树承接 DSH 的子智能体会话关系（第二张图 DSH 侧栏的会话层级）。证据与方案见第 5 章。

---

## 1. 决策与目标基线

### 1.1 选定路线

**在现有原生 chat 面板（`dshChatSession.ts` / `dshChatModel.ts`）上改造，只承接 DSH 源码内置的官方聊天内容。**

- 不用 WebviewView，不在 IDE 里跑 DSH Web renderer。
- 不引入 DSH 的 React slot 运行时，不加载插件 UI bundle。
- 不扫描非官方插件资源，不做插件内容告警；非官方插件额外效果一律过滤。
- **渲染采用"翻译层"**：把 DSH 节点数据翻译成 VS Code 原生 content kind，用原生模具显示，保留 VS Code 原生视觉风格。

### 1.2 目标基线

> 以"DSH 原版在不装任何非官方插件时，聊天页正常显示的内容"为唯一参照系；这些内容在 DSH-IDE chat 面板里也要正常显示和使用。

链路：`Host 拿官方 event/projection → 写死投影 → 唯一 dshIde 通道 → 翻译层映射到原生 content kind → VS Code 原生 content part 渲染`。官方插件（approval / deliverables / tool 等）通过其在 Host 侧产生的**数据效果**承接，不运行 React 组件。

### 1.3 明确不做

| 排除项 | 原因 |
|---|---|
| 非官方插件 UI / 独有数据效果 | 超出基线，主动过滤 |
| 插件资源扫描 / `clientModules` / slot 静态扫描 / Cordis inspect | 复杂度高，需 client runtime，收益不在目标内 |
| WebviewView 承载 DSH Web UI | 等于新建第二套前端运行时 |
| 引入 DSH React slot / 描述性 slot registry / 规则表 | 不引入第二套 UI 运行时 |
| 把 VS Code 渲染工厂重写成 slot 注册表 | 目标是原生风格正确渲染，非像素还原/插件可扩展，属过度设计 |
| 卡片像素级还原 DSH 外观 | 用户明确不做，保留 VS Code 原生风格更好 |

### 1.4 判别标准

三层都满足才算承接住：**数据承接**（Host 拿到官方内容）→ **投影承接**（经唯一 `dshIde` 通道送达）→ **UI 承接**（翻译层映射到原生 kind 并可交互）。验收不是"长得像"，而是**不丢内容、能交互、不串不卡**。

---

## 2. 身份前提与架构

### 2.1 身份前提

1. **DSH-IDE 是 DSH 应用内的 bundle 插件**，不是独立应用，不新增第二个 Cordis 根、会话或协议。
2. **对 DSH 而言 DSH-IDE 就是一个 Cordis 插件**：跑在 DSH Host 进程、复用同一 `dshCtx`。
3. DSH-IDE 内部的 VS Code 扩展宿主只是其作为 VS Code 外壳的内部层次，**不是相对 DSH 的身份**。
4. Host 半身 / IDE 窗口之间只走官方客户端传输与唯一 `dshIde` 通道。

证据：`src/vs/platform/dshClient/index.js:19,29,54`；`host/ide-view-host.js:308-309,317-325`；`host/ide-service.js:26-44`。

### 2.2 桥链路

- **入站**：`ide-view-service`/`ide-view-host` 订阅会话流与 Host 事件，经 `dshIde` 通道推快照。
- **出站**：renderer 调 `IDshClientService.call(method,args)`，transport 发 `ide/dispatch`，内核决定调哪个官方端点。
- **落点**：`DshClientContribution` 接 snapshot/waterfall/sessionNotice，交给 `DshChatSession`。

文件：契约 `common/dshIdeProtocol.ts`；Host 桥 `host/ide-view-host.js`；投影 `electron-main/ide-view-service.ts`；transport `transport/dshIdeTransport.ts`；renderer 消费 `dsh.contribution.ts:60-88`。

### 2.3 承接范围（§4 入口取舍）

> 完整承接：§4.1 正文、§4.2 会话列表、§4.3 工具、§4.4 Deliverables、§4.5 Attachments、§4.6 审批/问卷、§4.7 模型、§4.9 状态、§4.10 Plan/Goal/Todo/Skill。
>
> 部分承接：§4.8 只取登录过期/模型登录/quota/凭据状态；§4.11 只取文件打开/外链/预览联动。
>
> 不承接：完整设置页、插件市场/管理、桌面原生 IPC、HMR/SSE。

A/B/C 三级处理（VS Code 无对应 → 放弃或降级；有近似 → 复用原生 kind；已有 → 直接映射）与"Mermaid 不是 DSH 特性（DSH 用 KaTeX）"的澄清保留在旧版分析，此处不重复。

---

## 3. 已完成实现摘要（第二阶段）

> 详细实现已落地并写回手册，本节只保留"做了什么 + 关键文件"，供后续定位。

### 3.1 数据层与翻译层

- `dshChatHistory.ts` / `dshChatSession.ts` / `dshChatSessionContent.ts`：会话历史与内容装配，`extrasOf` 为唯一装配入口，plan/goal/todos/skills 判重与 bind 清空。
- 工具 → `toolInvocationSerialized`（子调用展开 + callId 去重）；turn-error/quota → response 级 `errorDetails`。
- 不可行降级（源码证据）：`confirmation` 只走 `sendRequest`；`questionCarousel` 缺 resolveId；`planReview` 缺正文；`attachmentId` 非 URI。
- 4 个真缺陷已修：运行中工具双卡、连续 turn-error 互相覆盖、`sameSkills` 漏比字段、quota 覆盖真错误。

### 3.2 会话面板

- `dshAgentSessionsController.ts`：归档/恢复走官方 method，已读仅本地；`withArchived`/`withRead` 状态更新。
- `dshSessionItemState.ts`：会话行的归档/已读状态工具。

### 3.3 图标全局替换（2-D 已落地）

- `genDshIconDataUris.mjs`：从官方 `ICON_ARTWORK` 生成 104 个 glyph 的内联 data URI，`--check` 防漂移。
- `dshIconDataUris.ts` / `dshCodiconMap.ts`：data URI 表 + codicon→DSH glyph 语义映射。
- `iconReplacement.ts` / `dshIconReplacement.ts` / `platform/theme/iconsStyleSheet.ts`：单槽位替换缝 + `getCSS()` mask 规则；SVG 内联 data URI、尺寸用 `1em`、`background-color: currentColor` 跟主题。
- 现实约束：DSH artwork 只有 100+ 个，codicon 有几百个 → 混合状态，DSH 无对应者保留 codicon；高对比度与 spin 动画待真机验收。
- 来源：`build/lib/dsh/ICON-PROVENANCE.md`（MIT 来源，四份法律凭据未改，`NOTICE.md` 未改）。

### 3.4 门禁与产物

见 0.2 摘要：`test-dsh:all` 370+7 全过、CI 五步 PASS、打包与 install-drift 24/24、改动文件 tsc 零错误（全量 137 条为既有 VS Code 文件）。

---

## 4. 尚未完成 / 待用户执行

### 4.1 重启 DSH

重启后确认 `cordis_inspect_query(Config.listConfigs{name:"dsh-ide"})` 返回 `active`（当前 `absent`）。

### 4.2 2-E 真机验收清单

| 类别 | 检查项 |
|---|---|
| 消息显示 | 正文、思考折叠、工具调用链（含子调用展开）、连续 turn-error 不互相覆盖 |
| 交互 | 审批按钮可点并回传、问卷可选、交付物能打开 |
| 图标 | 浅色/深色/高对比度下 DSH 图标观感、spin 动画无残影 |
| 会话 | New Session 创建真实会话、归档/恢复、search 可用 |

---

## 5. 子智能体会话树（当前重点，证据已闭合）

### 5.1 需求与结论

需求：Session 面板中，父会话可展开其子智能体会话（第一层），子会话还能继续展开自己的子会话（递归）。用户提供的两张图：第一张是 VS Code 会话行右键菜单（Open as Editor / Pin / Mark as Done），第二张是 DSH 原生侧栏菜单（分叉会话/移至工作区/归档）。

**结论**：不新增 `listSubagentChildren` 端点，不做右键子菜单。**用已有 `parentSessionId`/`origin` 拼 `IChatSessionItem.children`，交给 VS Code 原生会话树渲染。** 证据如下。

### 5.2 证据链

**证据 1 — 官方 `sessionController.list()` 返回子会话，且带父子字段**

`E:/deepseek-harness/packages/api/session-controller/src/list.ts`：

- `list()` 遍历 `sessionQuery.listSessions()` 所有 records，live 走 `summaryFor`，冷会话走 `summarizeCold`，**不过滤 `origin==='subagent'`**（`:145-178`）。
- `summaryFor()` 用 `...listFields(session.header)`（`:125-137`，关键 `:135`）；`summarizeCold()` 同样（`:180-193`，关键 `:191`）。
- `listFields()` 明确输出 `parentSessionId`（来自 `header.parentSession`）、`origin`、`cwd`（`:372-382`）。

**证据 2 — DSH-IDE Host 桥保留这些字段**

- `host/ide-view-host.js:708-745`：`listSessions` 调官方 `controller().list({}, signal)`（`:730`），再经投影。
- `common/dshIdeSessionList.js:48-62`：`toSummary` 保留 `parentSessionId`（`:60`）与 `origin`（`:61`）。
- `common/dshIdeProtocol.ts:68-79`：`IDshIdeSessionSummary` 已声明 `parentSessionId?` 与 `origin?:'subagent'`（`:78-79`）。

**证据 3 — 官方已有"扁平列表 → 层级"算法可参照**

`E:/deepseek-harness/packages/api/session-controller/src/client/sessions/lineage.ts` 的 `flattenLineage()`（`:54-96`）：

- 只有 `origin==='subagent' && parentSessionId && byId.has(parentSessionId)` 才挂到父项（`:64-68`）；普通 fork 即便有 parent 也不挂。
- 父不在列表 → 降级为 root 不丢（`:69`）；`visited` 防环（`:74-79`）；循环外不可达项补为 root（`:92-94`）。
- 输出扁平有序 + `depth`。

**证据 4 — VS Code 原生会话项支持 children 树**

- `chatSessionsService.ts:260-267`：`IChatSessionItem.children?: readonly IChatSessionItem[]`（`:267`），注释即"Child chats to present under this session"。
- `agentSessionsModel.ts:800-803`：递归转换 `item.children`，自动注入 `parentSession`。
- `agentSessionsModel.ts:230-232`：`isAgentSessionChild()` 通过 `parentSession` 判定。
- `agentSessionsViewer.ts:364-365`：有 children 的行加 `has-chat-children` class。

**证据 5 — 当前 renderer 丢弃了父子字段**

`dshAgentSessionsController.ts:313-333` 的 `toSessionItem()` 只用 sessionId/title/cwd/running/timing，未用 `parentSessionId`/`origin`，也不填 `children`；`refresh()`（`:208-217`）把所有 summary 当扁平列表。

**证据 6 — 右键菜单机制存在但不建议主用**

`agentSessionsActions.ts:71-78` 有 submenu 注册范式；`:812-817` 是 `AgentSessionChatContextMenu`。但菜单通常靠静态 contribution + `when` 过滤，动态列子项不如 `children` 树自然。

**证据 7 — 点击打开无需新增路径**

`dshAgentSessionsController.ts:115-124`：`sessionOpenerRegistry` 对任意 `dsh:///<sessionId>` 调 `dshChatSessionFor(client).bind(sessionId)`。子项 resource 用同样格式即可。

**证据 8 — 深度来自配置，不是 list 缺失**

`packages/subagent/tool-subagent/tests/tool-subagent.spec.ts`：`maxDepth:2` 进入 start request（`:606-610`）、配置可更新 5/0/2（`:442-456`）、0 禁止派生（`:74-79`）。实测 `maxDepth:2`。

### 5.3 判定表

| 待确认点 | 结论 |
|---|---|
| `listSessions` 是否返回子会话 | 是（`list.ts:145-178`，不过滤 subagent） |
| summary 是否带父子字段 | 是（`listFields` `:372-382`） |
| DSH-IDE 桥是否保留 | 是（`dshIdeSessionList.js:60-61`、`dshIdeProtocol.ts:78-79`） |
| renderer 是否使用 | 否（`toSessionItem()` 丢弃，`:313-333`） |
| VS Code 是否有原生 children 树 | 有（`chatSessionsService.ts:267` + model/viewer 递归） |
| 是否需新 `listSubagentChildren` 端点 | 当前不需要；仅当 list 不返回冷/外部子会话时再评估 |
| 是否需右键子菜单 | 不建议主用；children 树是正解 |
| 点击打开是否要改 | 不用，现有 opener 通用 |

### 5.4 实现方案（形态 A+）

1. `refresh()` 拿到 summaries 后建树：
   - `byId = Map<sessionId, summary>`；
   - 仅 `origin==='subagent' && parentSessionId && byId.has(parentSessionId)` 的项挂为子项，其余为 root；
   - `visited` 防环、孤儿/环降级为 root（照 `flattenLineage` 规则）。
2. 递归构造 `IChatSessionItem`，子项填到父项 `children`；`toSessionItem()` 只做单条映射，树构造独立为 `buildSessionTree()`。
3. `sameItem()` 递归比较 children，否则子项状态变化不刷新。
4. `applyRunning()` / `withArchived()` / `withRead()` 递归更新 children。
5. 不改契约、不加 Host 端点、不改菜单；点击子会话走现有 opener（`:115-124`）。
6. 层级可递归展示，遇到超过 `maxDepth` 的更深层也不会崩（有防环）。

### 5.5 待你确认

- 会话树展开 vs 右键"子智能体会话"子菜单：推荐前者（原生、递归自然）；是否两者都要？
- 点击子会话：默认 rebind 到主 chat（与现有 opener 一致），还是新开 editor/side？
- 是否只展示到 `maxDepth`（当前 2）还是完整递归？

---

## 6. 不变量与边界

- **身份**：bundle 插件、共用 `dshCtx`、唯一 `dshIde` 通道，不新建 Cordis 根/会话/协议。
- **契约**：契约先行；`exactRecord` 白名单、`version` 严格 +1、gap 倒退 fail-closed 不动。
- **复用**：内核侧复用官方装配器；UI 复用 VS Code 原生 content part 与会话树；图标复用 DSH 官方 artwork；保留许可证与版权头。
- **风格**：VS Code 约定（制表符、单引号、分号、`I`/`_` 命名、`DisposableStore`、`onUnexpectedError`）。
- **资源**：VS Code 自身 Mermaid/Markdown 保留（构建约束）；DSH 聊天页用 KaTeX 而非 Mermaid；native 模块按 Electron 44.7.0 ABI 编译。
- **过滤**：非官方插件独有内容在内核桥层过滤，IDE 不感知、不告警。
- **视觉**：卡片保留 VS Code 原生风格；图标按 2-D 全局替换为 DSH SVG（混合状态，DSH 无对应者保留 codicon）。
- **验证**：真机 GUI 由用户执行，AI 不代跑；门禁状态只记 PASS/PENDING/FAIL，未跑如实标注。

---

## 7. 遗留 / 后续

- `rewind` 当前官方落点为 null，本阶段是否实现待定；若实现需先在 DSH 侧确认可用 remote/事件，不能凭 IDE 侧臆造。
- `resume/fork/rewind` 若官方基线不可用，IDE 只保留入口禁用态，不做实际调用。
- A 级装饰项（鲸鱼动画、TurnNavigator、PixelWhale、onboarding、KaTeX、ContextMeter、TurnUsage 明细）为非 P0 后续项。
- 子智能体会话树方案（第 5 章）确认后进入实现与门禁。
