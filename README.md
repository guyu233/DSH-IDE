# DSH-IDE

**DSH-IDE = DeepSeek Harness 的一个插件。** 把完整 VS Code 桌面运行时作为 DSH 的 bundle 插件交付：VS Code 外壳保留（侧栏/编辑/终端/Git/搜索/布局原生不变），聊天面板内嵌 chat-only 的 DSH 客户端子应用，由其字面渲染 DSH 事件。所有 DSH 连接由 DSH Cordis 插件在 Host 进程内完成，经**插件私有本地管道**暴露给 VS Code；只有一个 agent = DSH 本身，IDE 是其"一等公民代码身体"。

## 仓库结构（v1.0）
```
.
├─ docs/
│  ├─ dsh-ide-plan.md            # 唯一事实来源（v1.0 改造计划）
│  ├─ dsh-ide-facts.md           # 可复用工程事实附录（体积/构建/安全/Electron 陷阱）
│  └─ archive/                   # 已废旧架构文档（独立窗口 + HTTP /api bridge，仅供考古）
│
├─ .build/
│  ├─ migrate-from-wrapper/      # 旧架构 Host 半代码（P0 参考基，会被重写）
│  └─ dshsrc/                    # DSH 官方源码片段（tool-bash/fs/pwsh/approval/permission-presets 参考）
│
├─ tools/                        # 辅助脚本（构建、CDP 调试、窗口/进程、restart-dsh.bat）
│
├─ dist/
│  └─ dsh-ide-0.0.0.tgz          # 现装可用回退产物（profile 已装 0.0.0）
│
└─ vscode-1.143.1/               # VS Code OSS 1.143.1 源码（DSH 定制改造对象）
   ├─ src/                       #   前端源码（D2 核心改造落点）
   ├─ extensions/                #   v1 会删 dsh-bridge/、保留其余
   └─ product.json
```

> 本仓库**不含** `node_modules/`、`out/`（构建产物）、`runtime/`（Electron dist）等大目录，请自行安装/构建。

## 架构（摘要）
- **Host 半**（DSH Cordis 插件 `dsh-ide`）：私有命名管道服务端（nonce 校验）；进程内直调 `sessionController / modelCatalog / agentPresetRegistry / approval / permissionPresets / goal`；注册 `ide_*` 工具转通道B 给 VS Code。
- **VS Code 半**（fork 核心）：主进程管道客户端；`ideExec` 执行 `ide_*`（取代 `dsh-bridge`）；聊天容器 webview 加载 chat-only DSH 子应用（复用 DSH `app.asar` 构建产物）；行内补全 `InlineCompletionItemProvider`。
- **连接**：仅本地命名管道，**无** `/api`/cookie；删 `dsh-bridge`。详见 `docs/dsh-ide-plan.md`。

## 关键决策（已冻结）
- VS Code 固定 `1.143.1`；对准已装 DSH `0.2.1-rc.5`。
- Electron：**自带 dist（可分发）** + 同卷 dev-only 硬链接兜底（跨卷硬链接本机不可行）。
- 单一 agent；标尺 = 对齐并超越 Cursor。

## 构建
首次使用前在 `vscode-1.143.1/` 下 `npm install`（依赖未入库）。具体构建/打包脚本随 P0–P5 落地，见 `docs/dsh-ide-plan.md` 阶段计划。

## 定位（务必牢记）
DSH-IDE 始终只是 DSH 的一个插件：界面独立，但 AI 全依附 DSH。它只是帮 DSH 实现 Cursor 式智能体 IDE 体验的壳，而不是另一个 agent。
