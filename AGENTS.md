# AGENTS.md — DSH-IDE 协作约定

> 本文只定义「怎么工作」。项目介绍见 [`README.md`](README.md)。本文不重复 README 的内容。

## 1. 总纪律

1. 全仓只承认一条开发路线，不得在代码注释、提交信息或文档中新增并行路线、可选阶段、回退路径、条件替代形态。
2. **身份前提（每一次改动的默认假设）**：DSH-IDE 是 **DSH 应用内的 bundle 插件**，不是独立应用，不产出独立 IDE 安装包，不新增第二个 Cordis 根、第二套会话或第二套协议。「一体」是**天然前提**而非待达成的合并目标：`dshCtx` 本就是 DSH 的、位于 DSH Host 进程，DSH-IDE 作为插件直接复用；DSH 应用内部的进程边界（Host 半身 / IDE 窗口）只走官方客户端传输与唯一 `dshIde` 通道。**禁止**把它当作「两个 app 需要跨边界合并」来设计、评估或讨论。
3. 改动涉及契约时，先改契约真源 `src/vs/platform/dshClient/common/dshIdeProtocol.ts`，再改实现，最后跑门禁。
4. 发现文档与代码矛盾时，改文档迁就代码，而不是反过来。

## 2. 资源复用优先

- 尽量少自行绘制或手写资源（图标、Logo、SVG、样式、字体、常量图形）。
- 优先顺序固定为：① 已安装 DSH 的 `resources/app.asar` 内 `dsh/node_modules/@deepseek-ai/**`（官方鲸鱼图形见 `@deepseek-ai/dsh-web-frontend/dist/favicon.svg`，各插件自带 `icon.svg` / locale / 样式）；② VS Code 源码 `src/**`（`src/vs/workbench/browser/parts/media`、codicons、主题样式、`resources/**`）。
- 确无可用资源或必须定制时才自绘，并在提交信息写明「为何不能复用」。禁止手抄近似 LOGO 路径。

## 3. 代码复用优先

- 先搜官方是否已有，再决定是否自写。只读参考目录：`E:/dsh-TUI/`、`E:/deepseek-harness/`、已安装 DSH 的 `resources/app.asar`，以及 `src/**`。这些目录只读，不得在其中写入。
- 优先搬用现成实现：协议客户端、远程调用、类型定义、适配器、会话/工作区控制器、工具、常量、schema。VS Code 侧同理复用既有服务与组件。
- 能复用函数或片段时不搬整包；确需完整模块或共享单例时保留必要闭包。
- 搬用必须保留原许可证与版权头，记录来源与 tree digest（格式见 `build/dsh/chat-render/PROVENANCE.md`），不伪造 Git commit。确需自写时在提交信息写明「为何不能先搬用」。

## 4. 构建与保留边界

- 构建/打包一律使用 VS Code 上游官方脚本（`gulpfile.mjs`、`build/**`），不自造打包脚本。打包任务是 `gulp dsh-ide-pack`（普通）与 `gulp dsh-ide-pack-min`（minified + 去 map）。
- Mermaid 与 Markdown 功能及其全部运行依赖完整保留；普通扩展宿主、扩展市场、扩展 API、扩展运行依赖、远程连接一律保留。
- 本地听写只接 DSH 的实验语音识别服务（由 DSH 决定启停、provider 与就绪状态），不另建本地识别后端；未就绪时入口明确不可用。
- native 模块（`node-pty`、`ripgrep`）按宿主 Electron 44.7.0 的 `NODE_MODULE_VERSION` 编译；VS Code 版本号 `1.143.1` 不是 ABI。

## 5. 许可证凭据

- `src/vs/platform/dshClient/PROVENANCE.md`、`build/dsh/chat-render/PROVENANCE.md`、`build/dsh/chat-render/LICENSE-DSH` 保留且不得删改；`NOTICE.md` 与 `LICENSE.txt` 保留原文。
- `NOTICE.md` / `LICENSE` 只在新增第三方依赖或素材时于 `NOTICE.md` 末尾追加条目，原文一字不动；**禁止重写**。

## 6. 提交与验证纪律

- 每次提交信息写清「做了什么 / 门禁实测结果 / 未完成项」；未跑的门禁如实标注，禁止写「门禁全过」这类模糊表述。
- 提交前核对 `git status --short` 的状态码（`M` 与 `A` 区分），显式 `git add <文件>`，不用 `-A`。
- 门禁状态只允许 `PASS` / `PENDING` / `FAIL` 三种；`PENDING` 不计入通过，不得标成 `PASS`。
- 所有需要真机验证的工作由用户执行；AI 不代跑 GUI、不模拟 DSH 会话、不以代码推断观测结论。

## 7. 代码风格、注释与源码对齐

- **风格单一**：改动一律遵循 VS Code 既有约定——制表符缩进、单引号、语句结尾分号、`camelCase` / `PascalCase`、接口 `I` 前缀、类私有成员 `_` 前缀、`this._register(...)` / `DisposableStore` 管理生命周期、错误走 `onUnexpectedError`。不得引入第二套缩进、引号、命名或错误处理风格。
- **同目录一致**：动手前先读同目录相邻实现，文件组织、导入顺序、命名、日志与配置读取方式与其保持一致。同一能力只保留一处实现和一个公共入口。
- **注释语言**：**新增注释一律用中文**；不得翻译、改写或批量替换上游既有英文注释（保持与上游 diff 最小）。用户可见字符串、NLS key、日志与错误文案、类型名/标识符、API 注释仍按上游英文约定，不受本条影响。
- **对照源码**：开发 DSH 相关能力时必须先读 `E:/deepseek-harness/` 与 `E:/dsh-TUI/` 的源码，以其中的协议、事件、字段与调用顺序为依据；不得凭记忆臆造形状，找不到依据时回到契约真源 `src/vs/platform/dshClient/common/dshIdeProtocol.ts`。
- **质量门禁**：新增与修改代码必须通过 `tsc --noEmit` 与相关测试。
