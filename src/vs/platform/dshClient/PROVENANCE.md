# PROVENANCE — `src/vs/platform/dshClient/`（官方客户端传输层）

本文件记录 DSH-IDE **官方客户端传输层**（Host 侧 Node 传输 + 主进程 bootstrap + 渲染器服务）
与上游 DeepSeek Harness 源码的对应关系、逐文件 sha256 与 tree digest。

对应本仓库的契约与上游核对流程
（原 R-05 搬用须记来源与 tree digest、R-06 资源复用、T11-05 官方传输复刻改为可溯源搬用）。

> **为什么不是运行时 `require` 宿主包**：DSH 桌面端的 `@deepseek-ai/*` 包位于
> `resources/app.asar` 内的 pnpm 私有布局中，VS Code fork 无法稳定解析其导出图，
> 且运行时会与 Host 进程的模块实例分裂（两个 `Remote` 描述符副本会破坏 Typert 校验）。
> 因此按「**源码片段搬用 + 记录来源**」的方式内联，逻辑严格对齐上游，不发明协议。

## 1. 来源与版本（真实 Git 提交）

| 项 | 值 |
| --- | --- |
| 权威源仓库（**只读，绝不写**） | `E:\deepseek-harness-0.2.2-rc.1` |
| 版本 | `0.2.2-rc.1`（根 `package.json` 的 `version`） |
| `sourceCommit` | `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`（tag `dsh-v0.2.2-rc.1`，真实克隆） |
| 采集时间 | 2026-11-06 (Asia/Shanghai) |
| 采样方式 | 逐文件从 `packages/client/connection/src/client/` 与 `packages/api/gateway/src/` 读取，只对齐下表所列**协议语义**；不整包复制、不复制 React/Cordis/schemastery |
| 许可 | **MIT License**, Copyright (c) 2026 DeepSeek（同 `build/dsh/chat-render/LICENSE-DSH`） |

## 2. 上游对应文件（E1 权威源，逐文件 sha256）

| 上游路径 | 字节 | sha256 |
| --- | --- | --- |
| `packages/client/connection/src/client/connection.ts` | 11601 | `efe3168500645825630af073428bf88f21e7b92e15d73d12fb849ba4e480bd41` |
| `packages/api/gateway/src/client/stream-client.ts` | 18950 | `4acd9e39179f9c1e9ffe899f5ed08b54564a30ef1f194cc5ef19ad539d7f0d97` |
| `packages/api/gateway/src/stream-protocol.ts` | 14533 | `c0d26dd8d3be737cbb9ae8ecf4e7084d1fb31b37693e94d7e79263c4aa8ce040` |
| `packages/api/gateway/src/client/index.ts` | 34737 | `67b346bbb099b65ec37c6fcedb08e4efeae2aee291fe1809e7a2d6fea080030c` |

## 3. 本仓库内的落地文件（逐文件 sha256）

| 文件（相对 `src/vs/platform/dshClient/`） | 字节 | sha256 |
| --- | --- | --- |
| `electron-main/dshClientTransport.node.ts` ⚠已删(阶段3第三批) | 19149 | `35f1da56892f7fd92b13f4e78f1d98392dcc63a4790fb7e2110b029a7d42d946` |
| `electron-main/dshClientBootstrap.ts` ⚠已删(阶段3第三批) | 1532 | `2a9b6cd5487a6b0bb2bf922d80cd3340ce0ddc91821529456a2f4cf0644ad2f7` |
| `common/dshClientProtocol.ts` ⚠已删(阶段3第三批) | 4400 | `c648c35d5378771e994662b8b0f27ebf8300290e8c2a1edb4cadb03739364bad` |
| `common/dshClientChannel.ts` ⚠已删(阶段3第三批) | 10148 | `6fe820480c3e41d792dd714f5b2469fa7a4091ecd10f631e8119d5f64b161eec` |
| `common/dshClientService.ts` | 9655 | `9839e6b9ca52fefbe4e3b29415a8212e0947f818d55b06ba03c1e5a0a05697ee` |
| `common/env.js` | 713 | `fed4823221b7c14f620c16368d5bf1da3fa5079559fb2ff4813817d11ef0fdf7` |

### 完整 sha256（可复算）

```
35f1da56892f7fd92b13f4e78f1d98392dcc63a4790fb7e2110b029a7d42d946  electron-main/dshClientTransport.node.ts
2a9b6cd5487a6b0bb2bf922d80cd3340ce0ddc91821529456a2f4cf0644ad2f7  electron-main/dshClientBootstrap.ts
c648c35d5378771e994662b8b0f27ebf8300290e8c2a1edb4cadb03739364bad  common/dshClientProtocol.ts
6fe820480c3e41d792dd714f5b2469fa7a4091ecd10f631e8119d5f64b161eec  common/dshClientChannel.ts
1e4f59caed1cf5026f880af9e742adfeddcc0a4e4345162ace702af4b2bc9f2d  common/dshClientService.ts
375d5ba8332647fd15dcd9001bb7a2e85dd67b61ae605db95b4dc351aec8fb1e  common/env.js
```

> 注：上面 6 行 sha256 与 tree digest（第 61 行）是**删除前**的快照。`electron-main/dshClientTransport.node.ts`、`electron-main/dshClientBootstrap.ts`、`common/dshClientProtocol.ts`、`common/dshClientChannel.ts` 已在阶段 3 第三批整删，现网落地文件仅剩 `dshClientService.ts` 与 `env.js`（外加新建的 `dshIdeProtocol.ts` / `dshIdeChannel.ts` / `ide-view-service.ts`）。复算 digest 须从本节清单中剔除已删 4 行。

### 整组 tree digest

把上面 6 行 `"相对路径\0sha256"` 用换行连接后取 sha256：

```
32d6500ebb2031a476fe465a902c2919a920c35bd9ba4ac3f03920b4e353d138
```

## 4. 协议对齐点（逐条，便于审计）

| 语义 | 上游依据 | 本仓库实现 |
| --- | --- | --- |
| 认证：`GET <origin>/?token=<launchToken>` → 303 + 签名 cookie | `connection.ts` | `dshClientTransport.node.ts` `authorize()` |
| 一元：`POST <origin>/api/<ns>/<method>`，带 cookie + client-request 信封 | `gateway/src/client/index.ts` | `callUnary()` |
| 流：单条 WS `<origin>/api/remote.mux`，按 `streamId` 多路复用 | `stream-protocol.ts` | `StreamMux` |
| 下行帧 `item` / `end` / `error` | `stream-protocol.ts` `RemoteStreamServerMessage` | `RemoteStreamServerMessage` 联合类型 |
| 上行帧 `open` / `item` / `end` / `cancel` | `stream-protocol.ts` | `openWireStream` / `StreamMux.send/end/cancel` |
| Typert 形参名即线上字段名（`_request` / `request`） | `gateway/src/index.ts:1630-1655` `assertExactArguments` | `common/dshRemoteRequests.ts` |

## 5. 校验方式

```powershell
# 复算本仓库 6 个文件的 sha256 与 tree digest
cd E:\vscode-dsh\vscode-1.143.1
node E:\vscode-dsh\.build\prov.mjs

# 官方传输相关单测（Channel/Mux/取消/重连）
npm run test-dsh     # dshClientChannel/dshClientTransport/dshClientService 共 30+ 条
```

## 6. 未搬用（明确边界）

未复制：Cordis、schemastery、`@deepseek-ai/dsh-client-*` 的 React 层、模块加载器、
`__DSH_BOOT__` 引导、任何 UI 组件。本目录只承载**协议实现**，UI 侧由
`build/dsh/chat-render/PROVENANCE.md` 单独记录。
