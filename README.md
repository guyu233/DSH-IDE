# DSH-IDE

**DSH-IDE = DeepSeek Harness 的一个插件。** 界面是独立的原生 VS Code 窗口，但所有 AI / Agent 能力都依附于 DeepSeek Harness（DSH）——本仓库不含任何独立智能体，只负责把 DSH 的大脑接到一个 Cursor 式的智能体 IDE 外壳上（提供"手和眼"：编辑、终端、LSP、Git 等能力）。

## 仓库结构（精简单仓）

```
.
├─ dsh-vscode-workbench/        # DSH Host 插件（核心）
│  ├─ index.js                  #   注册 /dsh-session/*、/dsh-ide-*、/dsh-account 等 HTTP 端点，
│  │                            #   桥接 DSH sessionController，拉起 IDE 窗口
│  ├─ ide-tools.js              #   把 VS Code 能力包装成 ide_* 工具（readFile/listDir/glob/search/
│  │                            #   terminal/writeFile/editFile/diagnostics + LSP 六件套）+ /ide-cmd/*
│  ├─ client.js / *.svg / locale/  # DSH Web GUI 侧的小组件
│  ├─ package.json / cordis.patch.yml
│
├─ tools/                       # 辅助脚本（构建、CDP 调试、窗口/进程工具、restart-dsh.bat 等）
│
└─ vscode-1.143.1/              # VS Code OSS 1.143.1 源码（含 DSH 定制补丁）
   ├─ src/                      #   完整前端源码
   ├─ extensions/dsh-bridge/    #   IDE 侧扩展：命令泵（/ide-cmd/poll）、SCM 改动审查、LSP 执行
   └─ product.json              #   定制项
```

> 说明：本仓库**不含** `node_modules/`、`out/`（构建产物）、`dsh-ide/`（运行时）等大目录，请自行安装/构建。

## 关键定制点（VS Code 源码内）

- `src/vs/workbench/contrib/chat/common/chatService/dshChatBridge.ts`（新增）
  —— 把内建 Local 聊天的「应答者」换成 DSH：create/prompt/page/cancel、每工作区活动会话、会话列表与历史回放。
- `src/vs/workbench/contrib/chat/common/chatService/chatServiceImpl.ts`
  —— 发送分流到 DSH 桥；点开 DSH 会话时把历史合成为「可恢复会话数据」在原生 Chat 里回放。
- `src/vs/workbench/contrib/chat/browser/agentSessions/localAgentSessionsController.ts`
  —— 把当前工作区的 DSH 会话列进右侧 **Sessions** 面板（id 即 DSH sessionId）。
- `src/vs/workbench/contrib/chat/browser/widgetHosts/viewPane/chatViewPane.ts`
  —— "New Session" 按钮先建 DSH 会话。
- `src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts` —— 欢迎页中性化（去 Copilot 文案）。
- 另有多处 UI 净化（移除模型选择器 / 会话类型选择器 / 委托 / Copilot 状态栏等），详见 git 历史。
- `extensions/dsh-bridge/` —— IDE 侧扩展（命令泵 + SCM + LSP 执行入口）。
- `product.json` —— 已清空 `extensionEnabledApiProposals`（扩展不再声明任何 chat 提案）。

## 构建

```bash
# VS Code 核心文件（esbuild，单文件）
node tools/build-ts.mjs vs/workbench/contrib/chat/common/chatService/dshChatBridge.ts

# IDE 侧扩展（需要 node_modules）
cd extensions/dsh-bridge && npm install && node_modules/.bin/tsc -p ./
```

首次使用完整 VS Code 工程前，请在 `vscode-1.143.1/` 下执行 `npm install`（依赖未入库）。

## 定位（务必牢记）

DSH-IDE 始终只是 DSH 的一个插件：界面独立，但 AI 全依附 DSH。它只是帮 DSH 实现 Cursor 式智能体 IDE 体验的壳，而不是另一个 agent。
