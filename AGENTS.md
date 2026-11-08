# AGENTS.md — DSH-IDE 协作约定

> 本文只定义「怎么工作」。项目定义、统一术语与权威层级见 [`README.md`](README.md)；全部技术规格见 `docs/DEVELOPMENT.md`。本文不重复上述内容。

## 1. 总纪律

1. 全仓只承认 [`README.md`](README.md) §5 的**一条开发路线**与 §6 的**一条业务流程**。不得在代码注释、提交信息或文档中新增并行路线、可选阶段、回退路径、条件替代形态。
2. 阶段编号统一使用 **P0–P7**，步骤编号统一使用 **T1–T9**。旧文档中的 `2.1` / `2.2a` / `2.5` / `S0` 等编号已废止，仅用于阅读历史提交；对照表见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 第 3 章 §5。
3. 改动涉及契约时，先改契约真源 `src/vs/platform/dshClient/common/dshIdeProtocol.ts`，再改实现，再按 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 第 5 章 §2 的命令执行 §3 的门禁；禁止让文档先于代码定义新形状。
4. 发现文档与代码矛盾时，按 [`README.md`](README.md) §4 的权威层级修正文档，不改代码迁就文档。

## 2. 资源复用优先

- 尽量少自行绘制或手写资源（图标、Logo、SVG、样式、字体、常量图形）。
- 优先顺序固定为：① 已安装 DSH 的 `resources/app.asar` 内 `dsh/node_modules/@deepseek-ai/**`（官方鲸鱼图形见 `@deepseek-ai/dsh-web-frontend/dist/favicon.svg`，各插件自带 `icon.svg` / locale / 样式）；② VS Code 源码 `vscode-1.143.1/src/**`（`src/vs/workbench/browser/parts/media`、codicons、主题样式、`resources/**`）。
- 确无可用资源或必须定制时才自绘，并在提交信息写明「为何不能复用」。禁止手抄近似 LOGO 路径。
- 现有已复用资源清单与来源凭据见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 第 1 章 §6 和第 7 章 §4。

## 3. 代码复用优先

- 先搜官方是否已有，再决定是否自写。只读参考目录固定为：`E:/dsh-TUI/`、`E:/deepseek-harness-0.2.2-rc.1/`（或 `E:/deepseek-harness/`）、已安装 DSH 的 `resources/app.asar`，以及 `vscode-1.143.1/src/**`。这些目录只读，不得在其中写入。
- 优先搬用现成实现：协议客户端、远程调用、类型定义、适配器、会话/工作区控制器、工具、常量、schema。VS Code 侧同理复用既有服务与组件。
- 能复用函数或片段时不搬整包；确需完整模块或共享单例时保留必要闭包。
- 搬用必须保留原许可证与版权头，记录来源与 tree digest（格式见 `build/dsh/chat-render/PROVENANCE.md`），不伪造 Git commit。确需自写时在提交信息写明「为何不能先搬用」。
- 删除代码前核对生产、扩展、测试与动态加载引用（含文件名字符串字面量），核对范围与命令见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 第 7 章 §5。

## 4. 构建与保留边界

- 构建/打包一律使用 VS Code 上游官方脚本（`vscode-1.143.1/gulpfile.mjs`、`build/**`），不自造打包脚本；要调整就直接改官方脚本或其参数。唯一打包任务是 `gulp dsh-ide-pack`。
- Mermaid 与 Markdown 功能及其全部运行依赖完整保留；普通扩展宿主、扩展市场、扩展 API、扩展运行依赖、远程连接一律保留。
- Copilot/AgentHost 与重复的 VS Code Agent Sessions 窗口移除专属源码与入口，不得误删上述保留项。
- 本地听写只接 DSH 的实验语音识别服务（由 DSH 决定启停、provider 与就绪状态），不另建本地识别后端；未就绪时入口明确不可用。
- native 模块（`node-pty`、`ripgrep`）按宿主 Electron 44.7.0 的 `NODE_MODULE_VERSION` 编译；VS Code 版本号 `1.143.1` 不是 ABI。

## 5. 许可证凭据

- `src/vs/platform/dshClient/PROVENANCE.md`、`build/dsh/chat-render/PROVENANCE.md`、`build/dsh/chat-render/LICENSE-DSH` 保留且不得删改；`NOTICE.md` 与 `vscode-1.143.1/LICENSE.txt` 保留原文。
- 上游升级时按 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 第 5 章 §7 更新版本、commit 与逐文件 sha256。
- `NOTICE.md` / `LICENSE` 只在新增第三方依赖或素材时于 `NOTICE.md` 末尾追加条目，原文一字不动；**禁止重写**（维护规则见 [`README.md`](README.md) §1）。
- 法律/许可文件清单与定稿核验见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 第 7 章 §4。

## 6. 提交与验证纪律

- 每次提交信息写清「做了什么 / 门禁实测结果 / 未完成项」；未跑的门禁如实标注，禁止写「门禁全过」这类模糊表述。
- 提交前核对 `git status --short` 的状态码（`M` 与 `A` 区分），显式 `git add <文件>`，不用 `-A`。
- 门禁状态只允许 `PASS` / `PENDING` / `FAIL` 三种，语义与退出码见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 第 5 章 §9；`PENDING` 不计入通过，不得标成 `PASS`。
- 代码注释中残留的旧阶段标记（如「阶段 2.x」）在对应 P 阶段实现时同步改成 P 编号；不得借注释引入旧编号路线。
- 任何文档变更后必须跑 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 第 5 章 §10.1 的引用图脚本（定义依赖图 0 环、术语定义唯一、`唯一定义` 声明不冲突），并把结果与断链检查结论写入提交信息。

## 7. 代码风格、注释与源码对齐

- **风格单一**：改动一律遵循 VS Code 既有约定——制表符缩进、单引号、语句结尾分号、`camelCase` / `PascalCase`、接口 `I` 前缀、类私有成员 `_` 前缀、`this._register(...)` / `DisposableStore` 管理生命周期、错误走 `onUnexpectedError`。不得引入第二套缩进、引号、命名或错误处理风格；最终代码必须看起来像同一个团队连续写出来的。
- **同目录一致**：动手前先读同目录相邻实现，文件组织、导入顺序、命名、日志与配置读取方式与其保持一致。同一能力只保留一处实现和一个公共入口，能复用既有服务、组件、工具函数时不另写；不得新增并行抽象、重复 helper、重复常量或重复 schema。同类概念统一使用 [`README.md`](README.md) §2 的术语。
- **注释语言**：**新增注释一律用中文**；不得翻译、改写或批量替换上游既有英文注释（保持与上游 diff 最小）。用户可见字符串、NLS key、日志与错误文案、类型名/标识符、API 注释仍按上游英文约定，不受本条影响。
- **对照源码**：开发 DSH 相关能力时必须先读 `E:/deepseek-harness-0.2.2-rc.1/`（或 `E:/deepseek-harness/`）与 `E:/dsh-TUI/` 的源码，以其中的协议、事件、字段与调用顺序为依据；不得凭记忆臆造形状，找不到依据时回到契约真源 `src/vs/platform/dshClient/common/dshIdeProtocol.ts` 与 DSH 源码核对。
- **一致性自检**：提交前对改动文件做一次「同风格」复查（缩进、引号、分号、命名、导入顺序、错误处理、注释语言），确认与相邻代码一致；不得留下多套风格混杂或半途翻译的注释。确需类型断言或忽略检查时，采用最小范围并在中文注释中写明原因。
- **质量门禁**：新增与修改代码必须通过 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 第 5 章 §3 的门禁与 `tsc --noEmit`；注释中的阶段编号仍按 §1.2 统一为 P0–P7 / K1–K8。
