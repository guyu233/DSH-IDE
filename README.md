# DSH-IDE

> 本文是仓库总纲：定义项目、统一术语、权威层级、文档索引与状态入口。全部规格内容由 `docs/DEVELOPMENT.md` 唯一承载，本文不重复其内容。

## 1. 项目定义

**为什么做**：DSH（DeepSeek Harness）是本地 AI 内核，具备会话、模型、工具、审批、语音能力，但缺少成熟的桌面编辑器外壳；普通 AI 编辑器又把 AI 与工作区割裂成两套状态。DSH-IDE 把两者合成一个进程、一个工作区、一套状态。

**想做成什么效果**：把整个 IDE 改造成 DeepSeekHarness 的插件——整个 DSH-IDE 项目打包后就是**一个** DSH bundle 插件（`dsh-ide@2.0.0`，产物 `dist/dsh-ide-2.0.0.tgz`），由 DSH 加载后提供原生 VS Code 的编辑、终端、Git、调试、扩展与远程体验；AI 侧栏由 DSH 驱动，能基于真实工作区上下文调用工具、走审批、多会话并行。不存在独立的 IDE 安装包，也不存在第二套 AI 会话或协议。

DSH-IDE 是把整个 VS Code 桌面运行时改造成 DeepSeekHarness 插件的实现：以 **DeepSeek Harness**（下称 **DSH**）为唯一 AI 内核、以 VS Code 1.143.1 源码树 `vscode-1.143.1/` 为 IDE 载体，整体作为 DSH 的单一 bundle 插件 `dsh-ide@2.0.0` 交付。改造后的形态满足：DSH 主进程逻辑与 VS Code 主进程逻辑在同一个 Electron 主进程内共享**一个 Cordis 根** `dshCtx`；IDE 窗口只经**唯一一条 `IServerChannel`**（token `dshIde`）消费 DTO；会话、模型、工具、权限、审批、问卷、设置与语音全部由 DSH 决定。

仓库只有一棵代码树 `vscode-1.143.1/`。所有 DSH-IDE 源码、资源、构建与验证脚本都落在这棵树的 VS Code 原生分层中，不存在第二个子工程。

许可、商标与上游归属以 [`NOTICE.md`](NOTICE.md) 与 [`LICENSE`](LICENSE) 为准。二者是法律文件，保留原文，不纳入规格文档分层；本文及 `docs/` 不对资质归属作技术性声明。

**法律文件维护规则（旁注，文件本身不改）**：`NOTICE.md` 声明了 VS Code（MIT，原文见 `vscode-1.143.1/LICENSE.txt`）与 DSH 两处上游来源、商标归属及许可范围；`LICENSE` 是本仓库 MIT 许可文本。二者**不得重写、不得删改原文**；仅当新增第三方依赖或素材时，才允许在 `NOTICE.md` 末尾**追加**条目，原有内容一字不动。定稿时未新增任何依赖或素材，`NOTICE.md` 保持原文。全量法律/许可文件清单与定稿核验见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 第 7 章 §4。

### 1.1 两种时态（全仓统一用法）

| 时态 | 含义 | 使用位置 |
| --- | --- | --- |
| **交付态** | 目标形态，规范性描述，用「必须 / 定义」表述 | 开发手册各章正文 |
| **当前态** | 截至本版文档的代码实况，用「当前 / 尚未 / 已落地」表述 | 开发手册各章的「当前态」表与第 5 章实测记录 |

禁止把当前态的骨架行为写成规范，也禁止把交付态契约写成已完成功能。

文档中的「本轮」「定稿时」等**会话过程性表述**统一指 **2026-11-08 文档定稿**这一时点，不构成规范条款；业务流程中的「本次实例 / 本次调用 / 本次决议」指流程实例本身（见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 第 4 章），与时态无关。所有「当前态」记录以定稿时点的代码实况为准；实现推进后按 §4 权威层级更新开发手册，不得就地另立第二份定义。

## 2. 统一术语

下表是全仓唯一术语定义。其它文档只使用这些词，不再另行定义、不另造同义词。

| 术语 | 定义 |
| --- | --- |
| DSH 主窗口 | DSH 桌面端 UI，持有会话头部「DSH-IDE」按钮 |
| IDE 窗口 | 由 DSH-IDE 打开的 VS Code `BrowserWindow` 及其 renderer |
| `dshCtx` | 单进程内唯一的 Cordis 根，DSH 服务的注册与订阅都发生在它上面 |
| 插件 | `build/lib/dsh/package.json` 定义的 `dsh-ide@2.0.0` bundle 插件，入口 `src/vs/platform/dshClient/index.js` |
| 通道 | 唯一 `IServerChannel` 实现 `DshIdeChannel`，token `dshIde`，注册点 `src/vs/code/electron-main/app.ts` |
| 视图宿主 | `IdeViewHost` 窄接口（`open` / `subscribe` / `invoke` / `close`）；当前为占位实现 `EmptyIdeViewHost`，交付态为持有 `dshCtx` 的真实实现 |
| 中立事件 | `IdeEvent`，`translator.ts` 输出的与 DSH 内部模型无关的封闭事件联合 |
| 投影快照 | `IdeViewSnapshot`，`ide-view-projector.ts` 折叠出的 `{ rows, version }` |
| 通道快照 | `DshIdeSnapshot`，跨 `dshIde` 通道传输的 `{ wireRevision, channelId, version, state }` |
| 消费者 | `DshIdeConsumer`，IDE renderer 侧校验并消费通道快照的组件（交付态） |
| 调用 | IDE → DSH 的 `invoke(method, namedArgs)`，经通道 `call()` 分发 |
| 订阅 | DSH → IDE 的单向 `listen('snapshot')` 快照流 |
| 门禁 | `build/lib/dsh/verify/dshIdeVerify.mjs` 提供的四条 `verify:dsh-ide-*` 校验 |
| 阶段 | 唯一开发路线中的 P0–P7，见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 第 3 章 |
| 步骤 / 状态 | 唯一业务流程中的 T1–T9 与 ST0–ST4、STF，见开发手册第 4 章 |
| 关键节点 | 阶段出口判据全部满足的时刻 K1–K8，见开发手册第 3 章 |
| 流程实例 | 从一次开窗触发到该窗口关闭（或异常终止）的一次完整业务过程 |

## 3. 文档分层与权威层级

本仓库规格文档只有三份，每份只有一个职责；同一事实只在其职责文件内定义一次，其余文件只能引用。

| 层 | 文件 | 唯一职责 |
| --- | --- | --- |
| L0 总纲 | 本文件 `README.md` | 项目定义、术语、权威层级、状态入口、文档索引 |
| L0 约定 | [`AGENTS.md`](AGENTS.md) | 人与 AI 协作者的工作规则（复用、构建、许可证、提交纪律） |
| L1 手册 | [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | 架构不变量、接口契约、唯一开发路线、唯一业务流程、验证门禁、仓库结构、资产登记 |
| — 法律 | `NOTICE.md`、`LICENSE` | 法律声明（保留原文，不参与上述分层） |

**定稿声明**：本仓库规格文档由 `README.md`、`AGENTS.md` 与 `docs/DEVELOPMENT.md` 三份构成，2026-11-08 定稿。`docs/` 下仅保留单一开发手册，原 6 份专题文档（`architecture.md` / `ide-channel-protocol.md` / `implementation-plan.md` / `verification.md` / `repo-layout.md` / `cleanup-inventory.md`）已删除，其内容连同原 `DEVELOPMENT.md` 一并整理为 `docs/` 下唯一手册。此后任何变更按 §4 权威层级、§4.1 引用图与删除/合并规则、[`AGENTS.md`](AGENTS.md) §6 的核验约定执行。`NOTICE.md`、`LICENSE`、两份 `PROVENANCE.md` 与 `LICENSE-DSH` 属法律与来源凭据，不参与规格改写。

阅读顺序：本文件 → `AGENTS.md` → `docs/DEVELOPMENT.md`。

## 4. 权威层级与冲突处理

自高到低只有一条链：

```text
代码与门禁脚本 > 契约真源 dshIdeProtocol.ts > 开发手册中职责所属章节 > 其它文档
```

冲突处理规则唯一：以链上更高者为准，并修正较低者的表述；**不得改代码去迁就文档**。任何文档都不得就地另立第二份协议、第二条路线或第二条流程。

### 4.1 引用图规则（防循环定义）

交叉引用分两类，只有第一类参与层级判定：

1. **定义依赖**：各文档头部 blockquote 段中指向权威源的链接。序号固定为 `README.md` → `AGENTS.md` → `docs/DEVELOPMENT.md`；定义依赖边只允许从序号靠后的文件指向靠前的文件，因此该图必须是 DAG（0 环）。
2. **导航 / 参见**：正文与表格中的链接，用于指向唯一定义处、排错与文件定位。允许双向，但**不得复制定义**；不构成定义依赖边。

由此保证：L0 只定义项目、术语、权威层级与状态入口，不承载 L1 的定义内容；L1 引用 L0 术语表是唯一允许的向上引用；每个主题只在开发手册里定义一次。核验脚本口径见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 第 5 章 §10.1。

**定义依赖图（3 节点、3 边，序号单向 ⇒ DAG）**：

```mermaid
flowchart TD
  R["README.md · L0 总纲/术语"]
  A["AGENTS.md · L0 约定"] --> R
  D["docs/DEVELOPMENT.md · L1 开发手册"] --> R
  D --> A
```

图中只画头部 blockquote 段的定义依赖边；导航 / 参见链接不在此图。§3 已有「层 → 文件 → 唯一职责」表，本图不重复职责说明。

**删除 / 合并文档规则**：删除任何文档前，先全仓 `git grep` 该文件名（代码注释、CI、issue/PR 模板、其它文档相对链接），把引用改到迁移后的目标位置；再删文件；最后按 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 第 5 章 §10.1 跑三项核验。顺序颠倒会留下断链，断链检查失败。

## 5. 唯一开发路线（摘要）

```text
P0 初始化 → P1 契约 → P2 适配层 → P3 通道与宿主 → P4 消费者与 UI → P5 功能与真机接线 → P6 测试与验证 → P7 打包与交付
```

这是全仓唯一路线：严格串行、前一阶段出口判据满足后才可启动后一阶段，无并行阶段、无可选阶段、无回退路径、无替代方案。阶段定义、依赖与出口判据见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 第 3 章，不得在其它文档中重述。

## 6. 唯一业务流程（摘要）

```text
触发（DSH 主窗口点击「DSH-IDE」）→ 开窗与连接 → 订阅 dshCtx 真源 → 翻译 → 投影 → 发布快照 → IDE 消费渲染 → 用户调用回送 DSH（同一流程内迭代）→ 关闭窗口释放连接
```

这是全仓唯一业务流程：一次流程实例对应一个 IDE 窗口，所有用户操作走同一条调用路径，所有状态变化走同一条快照路径。完整步骤、状态流转与异常终止见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 第 4 章。

## 7. 当前状态入口

- 时态：**骨架期**。`DshIdeChannel` 仅注册骨架，`EmptyIdeViewHost` 占位，`client.js` 的按钮点击抛显式错误，`DshIdeConsumer` 尚未实现。
- 阶段进度（唯一表）：[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 第 3 章 §6。
- 门禁与测试实测（唯一表）：开发手册第 5 章 §3–§4。
- 代码实况与残留登记：开发手册第 7 章 §3；全局扫描与引用图登记：第 7 章 §7。

## 8. 硬边界

硬边界是四条不变量，由 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 第 1 章 §1 唯一定义并解释。本文不列名称、不解释、不复制；越界即违约，门禁判据见开发手册第 5 章 §3。
