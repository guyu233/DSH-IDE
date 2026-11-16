# DSH 聊天页面全量构成与插件显示机制（源码级彻底清点）

> 文档性质：对只读参考目录 `E:/deepseek-harness/`（DSH 能力源码真源）的源码级静态清点结果。
> 生成日期：2026-11-16
> 分析范围：
> 1. 聊天页面的**所有图标、组件、卡片、文本内容与渲染管线**，逐项清点，不遗漏。
> 2. **DSH 侧插件（Cordis bundle）的图标与内容如何注册并最终显示在聊天页面里**的完整机制。
>
> 说明：本文基于源码静态分析，全部结论均有绝对路径佐证；未运行 GUI、未模拟 DSH 会话，所有需真机验证的行为不在本文结论范围内。本文为分析文档，不构成任何新的开发路线、可选阶段或回退路径。

---

## 目录

- **第一篇 聊天页面全量构成**
  - 第 1 章 页面主链路与架构
  - 第 2 章 图标清单（全部）
  - 第 3 章 组件清单（按区域）
  - 第 4 章 卡片清单（全部类型）
  - 第 5 章 文本内容 / i18n 清单
  - 第 6 章 样式与消息渲染管线
- **第二篇 插件图标与内容的显示机制**
  - 第 7 章 插件加载是前提
  - 第 8 章 图标显示机制：artwork → sprite → use
  - 第 9 章 插件如何提供图标
  - 第 10 章 不走 sprite 的私有图标体系
  - 第 11 章 内容注入：Slot 系统
  - 第 12 章 i18n 文本注入
  - 第 13 章 样式注入
  - 第 14 章 关键路径速查表
- **附录**：路径前缀表 / E2E 测试佐证 / 常见误解澄清

---

# 第一篇 聊天页面全量构成

## 第 1 章 页面主链路与架构

### 1.1 完整组件树链路

聊天页面不是一个独立的「页面文件」，而是由一堆 Cordis 插件（client 包）在运行时通过 slot 拼装出来的。从浏览器入口到消息渲染的完整链路如下：

```
apps/web/src/main.ts（浏览器入口）
  → AppWebEntry.run()                      [packages/client/web/src/boot.ts]
  → UiRenderer.mount()                     [packages/client/ui-renderer/src/client/renderer.ts]
  → renderSlot('root')                     [packages/client/ui-renderer/src/client/app.tsx]
  → AppFrame（三列：sidebar / center / rightbar）
      [packages/client/ui-layout/src/client/AppFrame.tsx]
      → main slot → ConversationPanel → ConversationRoot → ConversationMainPanel
          → ConversationContent
          → conversation.view = ChatView
              → conversation.chat.flow = ChatFlow
                  → ChatNodeSeat / ChatGroupSeat（按 NodeKey 派发所有消息与卡片）
      → 输入区 InputBar（conversation.composer.bar）+ 各 conversation.input.* slot
      → 侧栏 SidebarRoot + WorkspaceBrowser
      → shell.overlay 浮层（QuotaNotice / Modal / Toast / Menu）
```

### 1.2 Slot 分区契约

slot 声明位于 `E:/deepseek-harness/packages/client/ui-layout/src/client/index.ts`：

| Slot 分区 | 作用 |
|---|---|
| `sidebar` | 左侧栏 |
| `main` | 主区（会话） |
| `rightbar` | 右侧栏（评审 / 详情） |
| `shell.bottom` | 底栏 |
| `shell.overlay` | 浮层 |
| `shell.leading` | 顶栏 leading |

聊天能力全部通过 `conversation.*`、`conversation.chat.*`、`conversation.input.*`、`tool.call.*` 这些 keyed slot 挂入（详见第二篇第 11 章）。

### 1.3 应用入口与挂载链路明细

| 组件 / 文件 | 作用 | 绝对路径 |
|---|---|---|
| `main.ts`（浏览器入口） | Web 客户端入口，创建 `AppWebEntry(el)` 并 `run()`，处理桌面 boot 注入 | `E:/deepseek-harness/apps/web/src/main.ts` |
| `AppWebEntry` | Web boot kernel：加载模块系统、激活插件树、审计后把挂载点交给 UI renderer | `E:/deepseek-harness/packages/client/web/src/boot.ts` |
| `mountClient` / `bootClient` | 客户端插件激活与 renderer 挂载 | `E:/deepseek-harness/packages/client/web/src/mount.ts`、`E:/deepseek-harness/packages/client/web/src/boot-client.ts` |
| `BootPage` | 框架无关的启动加载页（失败可见） | `E:/deepseek-harness/packages/client/web/src/boot-page.ts` |
| `buildRenderApp` | 真正 UI 树：`ctx.slots.renderSlot('root', {})`，整棵树挂在内置 `root` slot | `E:/deepseek-harness/packages/client/ui-renderer/src/client/app.tsx` |
| `UiRenderer` / `mountApp` / `BootHandoff` | React root 创建 / hydrate、文档样式拥有、启动 DOM 交接 | `E:/deepseek-harness/packages/client/ui-renderer/src/client/renderer.ts` |
| `SlotRegistry` / `createSlotRenderer` / `scoped-slots` | slot 注册中心与 React 渲染适配器（`renderSlot`/`renderSlotChain`/`renderFactorySlot`） | `E:/deepseek-harness/packages/client/ui-renderer/src/client/registry.ts`、`E:/deepseek-harness/packages/client/ui-renderer/src/client/scoped-slots.tsx` |
| `web-app`（服务端 bundle 插件） | 浏览器曲面 glue：解析前端 dist、frontend-static fallback、URL 行、默认浏览器打开、`webApp` 服务 | `E:/deepseek-harness/packages/bundle/web-app/src/index.ts`（patch：`E:/deepseek-harness/packages/bundle/web-app/cordis.patch.yml`、`E:/deepseek-harness/packages/bundle/web-app/presets/standard.patch.yml`） |

---

## 第 2 章 图标清单（全部）

### 2.1 图标体系总论

- 聊天页图标 **100% 使用自建 `Icon*Regular` / `Icon*Medium` 组件**，数据定义在 `ui-primitives/src/icons/artwork.ts`，组件在 `icons/index.tsx`，由 `ui-theme/src/client/icon-sprite.ts` 注入 SVG sprite（symbol id 形如 `dsw-icon-xxx-regular`）。
- **零图标字体**（无 iconfont / material icons / font-awesome）。
- 发送 / 停止 / spinner / 语音波形等少数为组件内联 `<svg>`。
- 品牌图形（鲸鱼）为独立体系（canvas / favicon / PWA 图标源）。

### 2.2 顶栏 / 标题栏图标

| 图标 symbol | 语义 | 引用位置 |
|---|---|---|
| `panel-left-outline` | 侧栏切换 | `E:/deepseek-harness/packages/client/ui-sidebar/src/client/HeaderLeadingControls.tsx` |
| `new-chat-outline` | 新建会话 | `E:/deepseek-harness/packages/client/ui-sidebar/src/client/SidebarRoot.tsx` |
| `ellipsis-outline` | 更多 | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx` |
| `settings-outline` | 设置 | `SidebarRoot.tsx` |
| `user-outline` | 用户 / 登录 | `AccountMenu` |
| `paper-plane-outline` | 联系我们 | 账户菜单 |
| `close-outline` | 关闭 | 弹层 |

> 分享图标 `share-outline` 已定义但未在聊天页顶栏发现引用。最小化 / 最大化 / 关闭窗口无 sprite 图标，由原生标题栏控件承载。

### 2.3 侧边栏图标

`search-outline`（搜索）、`close-fill`（清空搜索）、`filter/sort`、`folder-open` / `folder-close`、`triangle-right-fill`（展开）、`pin-fill`（置顶）、`archive-outline` / `unarchive-outline`、`ellipsis-outline`（会话菜单）、`branch-outline`（分支）、`apps-add-outline`（应用入口）。

> 会话项图标主要是 `folder-open/folder-close`、`triangle-right-fill`、`new-chat-outline`、`pin-fill`、`archive-outline/unarchive-outline`、`ellipsis-outline`。`dsw-icon-search-outline-regular` 由 e2e 测试 `icon-skin.e2e.ts:10` 直接佐证。

### 2.4 输入区图标

| 图标 | 语义 | 引用 |
|---|---|---|
| `plus-outline-medium` | 命令 `+` 按钮 | `InputBar.tsx`（命令面板触发器，带 tooltip、aria-haspopup） |
| `paperclip-outline-regular` | 附件 / 回形针 | 附件按钮 |
| `warning-outline` / `refresh-outline` / `close-fill` | 附件失败 / 重试 / 删除 | 附件卡 |
| `data-outline-regular` + `chevron-down/right` + `check` | 模型选择器 | `ModelSelect` |
| 内联 SVG | 发送箭头、停止方块、发送中 spinner、语音波形 | 主输入按钮（`InputBar.tsx`）、`VoiceInput.tsx` |

> sprite 中 `stop-fill` / `send-outline` / `paper-plane-outline` 存在但未直接用于主发送按钮；麦克风图标存在但未挂载（语音为实验包）。

### 2.5 消息操作栏图标

- 复制 / 已复制：`copy-outline` / `check-outline`
- 点赞 / 点踩（含填充态）：`like-outline` / `like-fill`、`dislike-outline` / `dislike-fill`
- 分支：`branch-outline`
- 编辑 / 删除 / 更多 / 重试 / 分享 / 朗读：未发现助手消息操作栏直接引用。分享图标已定义但未使用；未发现朗读 / TTS 图标。

### 2.6 思考 / 工具 / 文件 / 图片 / 链接图标

| 语义 | 图标 | 引用 |
|---|---|---|
| 思考 | `IconThinkOutlineRegular` | `CHAT/chat/ReasoningRow.tsx:3,10`、`CHAT/chat/ChatGroupSeat.tsx:7,39` |
| 工具（通用） | `IconSparkleRegular` | `CHAT/chat/ChatGroupSeat.tsx:6,52` |
| 命令 / API | `IconApiOutlineRegular` | `CHAT/chat/GenericCommandCard.tsx:3,9` |
| 检查 | `IconInspectOutlineRegular` | `ui-tool/.../ToolRow.tsx:4,449` |
| 读文件 | `IconBrowseOutlineRegular` | `ChatGroupSeat.tsx:4-5,40-44` |
| 写文件 | `IconEditOutlineRegular` | 同上 |
| 类型徽标 | `FileTypeIcon` | `ui-attachment/.../FileCard.tsx:1,69` |
| 文件引用 | `ReferenceIconRegular` | 引用渲染 |
| 图片 | `LinkIcon` 的 `PhotoGlyph`（内联）、`IconRefreshOutlineRegular` / `IconLoadingOutlineRegular` | `ui-primitives/.../LinkIcon.tsx:54-60`、`ui-attachment/.../MessageImage.tsx:4,129,149` |
| 链接 | `LinkIconRegular/Medium` + `SiteGlyph`（simple-icons 站点 logo） | `ui-primitives/.../LinkIcon.tsx:1-60`、`SiteGlyph.tsx:1-40` |

### 2.7 通用小图标

`chevron-down/up/left/right`、`triangle-right-fill`、`chevrons-up-down`、`close-outline/fill/circle-fill`、`check-outline/check-circle-*`、`warning-outline/warning-triangle-outline`、`info-outline`、`loading-outline`、`refresh-outline`、`download/upload`、`fullscreen`、`play/pause`、`stop-fill`。

### 2.8 artwork.ts 已定义的部分 symbol id（原文节选）

以下为 `E:/deepseek-harness/packages/client/ui-primitives/src/icons/artwork.ts` 中实际定义的图标数据（每条为一个 glyph，含 size 与随 strokeWidth 变化的 SVG）：

| glyph id | size | 说明 |
|---|---|---|
| `mail-unread-outline` | 16 | 未读邮件 |
| `mail-read-outline` | 16 | 已读邮件 |
| `layers-outline` | 16 | 层 |
| `save-outline` | 16 | 保存 |
| `new-chat-outline` | 16 | 新建会话 |
| `search-outline` | 16 | 搜索 |
| `eye-outline` / `eye-off-outline` | 16 | 显示 / 隐藏 |
| `globe-outline` | 14 | 地球 |
| `settings-outline` | 16 | 设置 |
| `panel-left-outline` | 16 | 左侧栏 |
| `ellipsis-outline` | 16 | 省略号 |
| `plus-outline` | 16 | 加号 |
| `check-outline` | 16 | 勾选 |
| `branch-outline` | 16 | 分支 |
| `chevron-down/left/right/up-outline` | 14 | 方向箭头 |
| `triangle-right-fill` | 14 | 实心三角 |
| `close-outline` / `close-fill` / `close-circle-fill` | 16 / 14 / 16 | 关闭 |
| `copy-outline` | 16 | 复制 |
| `refresh-outline` | 16 | 刷新 |
| `like-outline` / `like-fill` | 16 | 点赞 |
| `dislike-outline` / `dislike-fill` | 16 | 点踩 |
| `share-outline` | 16 | 分享 |
| `deliver-doc` | 16 | 交付文档 |
| `edit-outline` | 16 | 编辑 |
| `think-outline` | 16 | 思考 |
| `agent-preset-outline` | 16 | 智能体预设 |
| `browse-outline` | 16 | 浏览 |
| `context-injection-outline` | 16 | 上下文注入 |
| `link-outline` | 16 | 链接 |
| `right-up-outline` | 16 | 右上外链 |
| `paperclip-outline` | — | 回形针（已定义，聊天页附件使用） |
| `apps-add-outline` / `apps-add-compact-outline` | — | 应用入口 / 紧凑版 |

### 2.9 品牌图形

| 图形 | 说明 | 来源 |
|---|---|---|
| `FishLogo` | 鱼形 logo | `ui-brand-official` |
| `BrandWordmark` | 品牌字标 | `ui-brand-official` |
| `PixelWhale` canvas | 首页鲸鱼动画（`[data-home-whale]`，由 `apps/web/tests/home-whale.e2e.ts:27,40` 佐证） | `E:/deepseek-harness/packages/client/ui-brand-official/src/client/home-whale/PixelWhale.tsx` |
| favicon | 鲸鱼 favicon / favicon-dark | `apps/web/public/favicon.svg`、`favicon-dark.svg`（构建产物即 `dsh-web-frontend/dist/favicon.svg`） |
| PWA 图标源 | 鲸鱼 tile | `apps/desktop/resources/icon.svg` |
| 欢迎页图形 | `welcome-brand.svg` | 欢迎页 |

---

## 第 3 章 组件清单（按区域）

### 3.1 页面骨架与布局

| 组件 | 作用 | 绝对路径 |
|---|---|---|
| `AppFrame` | 三列骨架（sidebar / center / rightbar）+ 拖拽手柄 + 列宽求解 + 子 slot 渲染；注册到 `root` | `E:/deepseek-harness/packages/client/ui-layout/src/client/AppFrame.tsx` |
| `CenterColumn` / `MainPanel` / `RightbarColumn` / `DragHandle` | 中列容器、主面板（`main` keyed slot）、右列轨道、列宽拖拽 | 同上 |
| `columns.ts` / `createLayoutStore` / `LayoutController` / `ThemePresenter` | 列宽计算、布局 store、`ctx.layout` 服务、主题投影 | `E:/deepseek-harness/packages/client/ui-layout/src/client/columns.ts`、`stores.ts`、`service.ts`、`theme-presenter.ts` |
| 布局 slot 声明 | `sidebar` / `main` / `rightbar` / `shell.bottom` / `shell.overlay` / `shell.leading` | `E:/deepseek-harness/packages/client/ui-layout/src/client/index.ts` |
| `DocumentTitle` | 文档标题 | `E:/deepseek-harness/packages/client/ui-layout/src/client/DocumentTitle.tsx` |
| `ConversationPanel` | `main.conversation` 的薄壳（root-scoped 主占用者） | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationPanel.tsx` |
| `ConversationRoot` | 常驻会话骨架根：hero chrome、composer 定位、header、content chain 跨会话不卸载 | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx` |
| `ConversationMainPanel` | 主会话帧：`conversation.header` + `conversation.content` factory，计算 `hero/settling/active` 相位 | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationMainPanel.tsx` |
| `ConversationHeader` | 顶栏 / 标题栏：leading slot + 会话标题 / 视图 tabs（`data-window-drag`） | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationHeader.tsx` |
| `ConversationSessionHeader` | 会话标题、视图 tab 行、面包屑（子会话祖先链）、More 菜单、tooltip | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx` |
| `ViewsMoreMenu` / `ViewTabLabel` | tab 行 More 下拉、超长标签 tooltip | 同上 |
| `ConversationContent` | 会话主体：hero/active 两态、滚动体 `data-conversation-scroll`、composer seat、宽度控制、workspace chip | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx` |
| `ConversationWidthControls` | 会话宽度控制（`CONTENT_SLOTS.widthControls`） | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationWidthControls.tsx` |
| `ConversationSession` / `DefaultConversationViews` | 严格 per-session header/body；`conversation.view` 列表渲染，blank 态不渲染 | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx`、`DefaultConversationViews.tsx` |

### 3.2 聊天视图与消息流

| 组件 | 作用 | 绝对路径（前缀见附录 A） |
|---|---|---|
| `ChatView` | 聊天页视图槽入口：TurnNavigator、滚动容器、历史加载条、错误条、`conversation.chat.flow`、文本交互面、to-bottom 按钮、文件打开错误对话框 | `CHAT/chat/ChatView.tsx` |
| `ChatFlow` | 消息列表容器 / 流：有序节点行、pending 提交气泡、`RunningStatus`，无额外 DOM 父级 | `CHAT/chat/ChatFlow.tsx` |
| `ChatNodeSeat` | 节点座位：按 NodeKey 订阅、Turn-process 可见性 / 折叠、路由到 keyed `conversation.chat.node` 渲染器 | `CHAT/chat/ChatNodeSeat.tsx` |
| `ChatGroupSeat` | 分组座位：稳定的 process 容器，标题图标 / 活动，显隐切换只改可见性不改父级 | `CHAT/chat/ChatGroupSeat.tsx` |
| `registerChatNodeRenderers` | 注册所有 keyed node renderer（user/assistant/tool/command/…） | `CHAT/chat/register-node-renderers.ts` |
| `registerConversationNodes` | 注册 Chat 业务 Definitions 与 process group | `CHAT/conversation-nodes/register.ts` |
| `TurnNavigator` / `TurnMark` | 右侧固定间距虚拟 turn 导轨（跳转 / 预览 / busy 脉冲） | `CHAT/chat/TurnNavigator.tsx` |
| `TurnTailNodeView` | turn 尾部行：复制 / 分支 / 反馈 / 用量 pill 及 turnTail 卡片列表 | `CHAT/chat/TurnTailNodeView.tsx` |
| `TurnProcessNodeView` | 已结束 turn 的「耗时 / 已工作 / 失败」过程折叠按钮 | `CHAT/chat/TurnProcessNodeView.tsx` |
| `TurnTriggerNodeView` | turn 触发来源（continue/goal/agent/team/github/schedule…）可展开记录 | `CHAT/chat/TurnTriggerNodeView.tsx` |
| `TurnUsagePanel` | token 用量按钮 + 弹层明细（输入 / 缓存 / 输出 / 推理 token、模型路由） | `CHAT/chat/TurnUsagePanel.tsx` |
| `RunningStatus` / `RunningWhaleTail` | 运行中「深度思考中 + 计时」状态及动画鲸鱼图标 | `CHAT/chat/RunningStatus.tsx`、`CHAT/chat/RunningWhaleTail.tsx`、`E:/deepseek-harness/packages/client/ui-chat/src/client/assets/running-whale@2x.png` |
| 滚动 hooks | `useChatScroll`、`use-chat-viewport`、`use-chat-reading`、`use-chat-navigation`、`use-scroll-follow`、`use-process-scroll`、`flow-motion` | `CHAT/chat/use-chat-scroll.ts` 等同名文件 |

### 3.3 消息内容与操作

| 组件 | 作用 | 绝对路径（前缀见附录 A） |
|---|---|---|
| `UserMessageNodeView` | 持久化用户消息 / steering 消息的 keyed renderer（右对齐） | `CHAT/chat/MessageItem.tsx` |
| `UserStyleBubble`（内部） | 用户与 steering 共用的右对齐气泡骨架 | `CHAT/chat/MessageItem.tsx` |
| `PendingSteeringBubble` | Host 授权但尚未落盘的 steering 气泡 | `CHAT/chat/MessageItem.tsx` |
| `PendingSubmissionBubble` | 本地提交回显气泡（含 objectURL 图片预览） | `CHAT/chat/MessageItem.tsx` |
| `UserContent` | 用户内容 Factory：文本气泡 + 附件列表 + JSON extraBlock + 引用摘要 | `CHAT/chat/UserContent.tsx` |
| `AssistantNodeView` | 助手消息 step renderer（running/settled/interrupted 共用） | `CHAT/chat/AssistantNodeView.tsx` |
| `AssistantMarkdown` | 助手块渲染：`text` / `reasoning` / `image` / `tool-call` / 未知块 | `CHAT/chat/AssistantMarkdown.tsx` |
| `AssistantBlock` 各 slot | text→`MarkdownText`；image→`conversation.chat.message.images`；tool-call→由 chat 分组为 tool row；default→`JsonBlock` | `CHAT/chat/AssistantMarkdown.tsx`、`CHAT/contract/snapshot.ts` |
| `MessageIconActions` | 用户 / 助手共用的操作行：复制、分支、时间戳、额外 slot 操作、用量 | `CHAT/chat/MessageIconActions.tsx` |
| `MessageFeedbackActions` | 助手消息 Like/Dislike 反馈按钮（挂在 assistant-actions slot） | `E:/deepseek-harness/packages/client/ui-message-feedback/src/client/MessageFeedbackActions.tsx` |
| `FeedbackDialog` | 反馈弹窗 + 成功 / 失败 toast | `FEEDBACK/FeedbackDialog.tsx` |
| `formatMessageClock` / `formatRunDuration` | 时间戳与运行时长格式化 | `CHAT/chat/message-chrome.ts` |
| `InheritedHistoryNodeView` | 分叉会话继承历史的分隔线（role=separator） | `CHAT/chat/MessageItem.tsx` |
| `ContextMessageNodeView` / `ContextInjectionRow` / `ContextBody` | 注入上下文消息行（含多种 KnownContextForm body 与 OpaqueBody 回退） | `CHAT/chat/MessageItem.tsx`、`ContextInjectionRow.tsx`、`ContextBody.tsx` |
| `SystemPromptNodeView` / `SystemPromptRow` | 系统提示词折叠行 | `CHAT/chat/SystemPromptRow.tsx` |
| `CompactionItem` / `CompactionNodeView` | 历史压缩标记（可展开摘要） | `CHAT/chat/CompactionItem.tsx`、`CHAT/chat/MessageItem.tsx` |
| `ModelRetryItem` / `RetryNodeView` | 模型重试倒计时行 | `CHAT/chat/MessageItem.tsx` |
| `TurnErrorItem` / `TurnErrorNodeView` | turn 终态错误行（错误码、失败文案） | `CHAT/chat/MessageItem.tsx` |
| `TurnMaxTokensItem` / `TurnMaxTokensNodeView` | 输出 token 达上限的警告行 | `CHAT/chat/MessageItem.tsx` |
| `UnknownNodeView` | 未知 surface 的 `JsonBlock` 回退 | `CHAT/chat/MessageItem.tsx` |
| `QuotaNoticeHost` | 全局配额提示 toast（shell.overlay） | `CHAT/chat/QuotaNoticeHost.tsx` |

### 3.4 输入区（ui-conversation 包为主）

| 组件 | 作用 | 绝对路径 |
|---|---|---|
| `InputBar` | 默认 composer 主体（`conversation.composer.bar`）：textarea 宿主、工具栏（+/附件/模式/模型/停止/发送）、Toast、附件、dock、ContextMeter | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` |
| `DraftEditor` / `ComposerContentEditable` | Lexical 内容可编辑文本面（单 textarea 语义，chip 为 decorator portal，14 行滚动） | `E:/deepseek-harness/packages/client/ui-conversation/src/client/input/editor/DraftEditor.tsx`、`ComposerContentEditable.tsx` |
| `keymap.ts` / `view-binding.ts` / `projection.ts` / `runtime.ts` / `chip-node.tsx` / `command-chip-node.tsx` / `QuoteNode.tsx` / `ReferenceChip.tsx` / `DecoratorPortals.tsx` | 提交 / menu / 粘贴键位、DOM 绑定、投影、引用 chip、命令 chip、引用节点 | `E:/deepseek-harness/packages/client/ui-conversation/src/client/input/editor/` |
| 发送 / 停止按钮（InputBar 内 `css.primary`） | 主按钮在 Send / Stop / Continue / Sending 间切换，含 aria、tooltip、快捷键 | `InputBar.tsx`（第 376–407、562–592 行） |
| `IconPlusOutlineMedium` 命令(`+`)按钮 | 命令面板触发器，有 tooltip、aria-haspopup | `InputBar.tsx`（第 506–519 行） |
| 附件按钮 + `<input type="file" multiple>` + `createComposerFileIntake` | 附件 / 拖放入口、文件校验、图片限额、上传重试 | `InputBar.tsx` + `E:/deepseek-harness/packages/client/ui-conversation/src/client/input/file-intake.ts`、`image-labels.ts` |
| `ComposerAttachments` / `AttachmentRail` / `FileCard` / `DropOverlay` / `MessageImage(s)` | 附件条、文件卡、拖放遮罩、消息图片 | `E:/deepseek-harness/packages/client/ui-attachment/src/client/ComposerAttachments.tsx` 等 |
| `ContextMeter` | 上下文用量条 / 环 + 点击展开 system/tools/messages 分解面板 | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ContextMeter.tsx` |
| `QueueDock` | 队列显示（`conversation.input.dock`）：持久队列行、图片缩略图、编辑 / 删除 / 发送 | `E:/deepseek-harness/packages/client/ui-conversation/src/client/queue/QueueDock.tsx` |
| `TodoPanel` / `todoDockEntry` | Todo / 计划 dock 面板 | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/TodoPanel.tsx` |
| `ModelSelect` | 模型选择器（`conversation.input.model`）：两级菜单（模型 / Effort）、搜索、目录、Toast | `E:/deepseek-harness/packages/client/ui-model-selection/src/client/ModelSelect.tsx` |
| `TeamModeToggle` / `TeamModePane` | 模型菜单内的 Agent Teams 开关（模式切换类） | `E:/deepseek-harness/packages/client/ui-agent-team/src/client/TeamModeToggle.tsx` |
| `PermissionSelect` | 权限预设选择（`conversation.input.permission`，只读/写/全访问/自动审查） | `E:/deepseek-harness/packages/client/ui-permission-presets/src/client/PermissionSelect.tsx` |
| `PlanChip`（`PlanModeControl`） | Plan 模式切换 / 状态 chip（`conversation.input.plan`） | `E:/deepseek-harness/packages/client/ui-plan/src/client/PlanModeControl.tsx` |
| `MenuView` / `MenuSurface` | 命令(`+`)面板：slash 触发候选菜单，combobox、骨架行、面包屑 | `E:/deepseek-harness/packages/client/ui-input-trigger/src/client/MenuView.tsx` |
| `PopupSelectView` / `popup.ts` | 命令弹层选择视图（ui-commands） | `E:/deepseek-harness/packages/client/ui-commands/src/client/PopupSelectView.tsx`、`popup.ts` |
| `VoiceInput` / `Waveform` / `MicrophonePicker` / `PreparationCard` / `VoiceSetupDialog` | 语音按钮及录音 / 转写 / 波形 / 准备 / 设置（实验包，`conversation.input.activity`） | `E:/deepseek-harness/packages/experimental/client-ui-voice-input/src/client/VoiceInput.tsx` 等同名文件 |
| `ActivityPill` / `UsagePill` | composer dock 中的活动 / 用量 pill（`conversation.composer.dock`） | `E:/deepseek-harness/packages/client/ui-chat/src/client/chat/StatsPills.tsx` |
| `QuestionComposer` / `QuestionReplyView` / `PlanReviewPanel` | 用户提问 / 计划审查的输入接管 | `E:/deepseek-harness/packages/client/ui-user-questions/src/client/QuestionComposer.tsx` 等同名文件 |
| `EnterBehaviorRow` | 输入设置（Enter 行为） | `E:/deepseek-harness/packages/client/ui-conversation/src/client/settings/EnterBehaviorRow.tsx` |
| 输入机 / 契约 | `input/hub.ts`、`facade.ts`、`machine.ts`、`submission-policy.ts`、`prompt.ts`、`contract/input.ts` | `E:/deepseek-harness/packages/client/ui-conversation/src/client/input/` 与 `contract/input.ts` |
| 注册入口 | `registerComposerBar` / `main.conversation` 等，把上述组件挂到 `conversation.input.*` / `conversation.composer.*` slot | `E:/deepseek-harness/packages/client/ui-conversation/src/client/apply.ts`（第 341–600 行） |

> 提示建议（placeholder/hint）在 `InputBar.tsx` 中通过 `placeholder.*`、`hint.*` 与命令 claim 的 ghost hint 实现（第 409–435 行）。

### 3.5 侧边栏

| 组件 | 作用 | 绝对路径 |
|---|---|---|
| `SidebarRoot` | 侧边栏外壳：列几何、折叠动画、面板导航、品牌、新会话、workspace 区、foot 设置 | `E:/deepseek-harness/packages/client/ui-sidebar/src/client/SidebarRoot.tsx` |
| `PanelRow` / `PanelMoreMenu` | 面板入口行、固定面板与 More 菜单、取消固定 | 同上（第 58–141 行） |
| `HeaderLeadingControls` | 侧栏完全隐藏时的顶栏 leading：打开侧栏 + 新会话（桌面） | `E:/deepseek-harness/packages/client/ui-sidebar/src/client/HeaderLeadingControls.tsx` |
| `PanelIcon` / `sidebar.panel.icon` factory | 面板图标 | `E:/deepseek-harness/packages/client/ui-sidebar/src/client/PanelIcon.tsx` |
| `scroll-handoff.ts` / `panel-pins.ts` | 滚轮交接、面板固定 | `E:/deepseek-harness/packages/client/ui-sidebar/src/client/scroll-handoff.ts`、`panel-pins.ts` |
| `WorkspaceBrowser` | 会话列表 / 工作区浏览区：标题、视图选项、搜索框（250ms 防抖）、分组树 / 平铺列表、归档过滤 | `E:/deepseek-harness/packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx` |
| `ProjectRowItem` / `SearchResultItem` / `SessionNodeItem` | 会话列表项 / 分组文件夹行 / 搜索结果行：hover 交换、标题 marquee、状态点 | `E:/deepseek-harness/packages/client/ui-workspace/src/client/rows/Rows.tsx` |
| `tree.ts` | 分组 / 文件夹（`deriveGroups`/`UNGROUPED_KEY`）、搜索结果、平铺、ordered | `E:/deepseek-harness/packages/client/ui-workspace/src/client/tree.ts` |
| `WorkspacePicker` / `WorkspacePickerFactory` | 工作区选择器（hero 与侧栏共用），新建 / 切换工作区 | `E:/deepseek-harness/packages/client/ui-workspace/src/client/WorkspacePicker.tsx` |
| `WorkspaceDialogs` | 工作区对话框（新建 / 重命名等） | `E:/deepseek-harness/packages/client/ui-workspace/src/client/rows/WorkspaceDialogs.tsx` |
| `SessionMenu` / `context-menus.tsx` | 会话 `...` 菜单与右键菜单动作 | `E:/deepseek-harness/packages/client/ui-workspace/src/client/session-actions/SessionMenu.tsx`、`context-menus.tsx` |
| `RenameSession` / `ArchiveSession` / `PinSession` / `RowActionToast` | 会话重命名对话框、归档确认、置顶、行操作 toast | `E:/deepseek-harness/packages/client/ui-workspace/src/client/session-actions/` 下同名文件 |
| 新会话按钮 `sidebar.session.action` | 新建会话（含快捷键提示） | `SidebarRoot.tsx`（第 381–408 行） |
| 设置入口 / footer | `sidebar.settings`、`sidebar.footer.action` | `SidebarRoot.tsx`（第 467–475 行） |
| `AccountMenu` / `AccountAvatar` / `AccountSection` | 用户菜单、头像、账户区 | `E:/deepseek-harness/packages/client/ui-settings-account/src/client/` 下同名文件 |
| `AccountNotifications` / `AccountNoticeStack` | 侧栏账户菜单内的通知（配额 / 公告） | `E:/deepseek-harness/packages/client/ui-account-notifications/src/client/AccountNotifications.tsx` |
| `SignInDialog` / `SignOutDialog` / `PlatformOverlay` | 登录 / 登出对话框、平台浮层 | `E:/deepseek-harness/packages/client/ui-settings-account/src/client/` 下同名文件 |
| `AccountQuotaNotice` | 账户配额提示 | `E:/deepseek-harness/packages/client/ui-settings-account/src/client/AccountQuotaNotice.tsx` |
| `ui-history` / `ui-jobs` 面板 | 历史 / 任务类侧栏面板（通过 `sidebar.panellist.actions` 注册） | 见 `E:/deepseek-harness/packages/client/ui-jobs/src/client/JobListAction.tsx` 等 |

### 3.6 状态与反馈

| 组件 | 作用 | 绝对路径 |
|---|---|---|
| `EmptyHero` / `HeroShell` / `HeroFish` / `WorkspaceChip` | 空状态 / 欢迎页：鱼形鲸鱼 hero、workspace chip、hover 游动 SMIL | `E:/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx` |
| `PixelWhale` / `renderer.ts` / `artwork.ts` | home whale（官方品牌首页鲸鱼装饰，`conversation.hero.frame` HOC） | `E:/deepseek-harness/packages/client/ui-brand-official/src/client/home-whale/PixelWhale.tsx` 等 |
| `OfficialBrandMark` / `OfficialBrandName` | 官方品牌 mark/name（侧栏 slot） | `E:/deepseek-harness/packages/client/ui-brand-official/src/client/Brand.tsx` |
| `TextShimmer` | typing/loading 文本闪烁（运行态文案） | `E:/deepseek-harness/packages/client/ui-primitives/src/TextShimmer.tsx` |
| `RunningStatus` / `RunningWhaleTail` | typing 指示：运行中计时 + 鲸尾动画 + aria-live | `CHAT/chat/RunningStatus.tsx`、`RunningWhaleTail.tsx`、`E:/deepseek-harness/packages/client/ui-chat/src/client/assets/running-whale@2x.png` |
| 历史加载条 | `chat.loadingHistory` / `openError` / `older` 历史 loading/错误/重试/start 状态 | `CHAT/chat/ChatView.tsx`（第 247–273 行） |
| `QuotaNoticeHost` | 配额提示（`shell.overlay` 帧级 Toast，可按 code 被替换） | `CHAT/chat/QuotaNoticeHost.tsx` |
| `WelcomeNotice` | 模型欢迎提示（版本化一次性 modal，`settings.onboarding`） | `E:/deepseek-harness/packages/client/ui-settings-models/src/client/WelcomeNotice.tsx` |
| `OnboardingModal` / `DeepSeekOnboardingDialog` | onboarding 对话框壳 | `E:/deepseek-harness/packages/client/ui-settings-models/src/client/OnboardingModal.tsx`、`DeepSeekOnboardingDialog.tsx` |
| Onboarding 全套步骤 | `AccountOnboarding` / `DesktopOnboarding` / `DesktopOnboardingEntry` / `OnboardingWelcomeStep` / `OnboardingPurposeStep` / `OnboardingProcessStep` / `OnboardingCreditStep` / `OnboardingConfirmation` / `OnboardingSurface` / `OnboardingIllustration` | `E:/deepseek-harness/packages/client/ui-settings-account/src/client/` 下同名文件；样式 `ui-theme/src/styles/onboarding.css` |
| `Toast` | 通用瞬时横幅（顶部居中、portal、可带动作，成功 tone） | `E:/deepseek-harness/packages/client/ui-primitives/src/Toast.tsx` |
| `StateDot` | 状态点（会话状态 / 任务状态） | `E:/deepseek-harness/packages/client/ui-primitives/src/StateDot.tsx` |
| `RiskConfirmation` | 风险确认提示组件 | `E:/deepseek-harness/packages/client/ui-primitives/src/RiskConfirmation.tsx` |
| `FileOpenErrorDialog` | 文件打开失败对话框（消息 + 重试） | `CHAT/chat/ChatView.tsx`（第 326–351 行） |
| `ModelRetryItem` / `failureMessage` | 模型重试倒计时、错误码到文案映射 | `CHAT/chat/MessageItem.tsx` |
| Skeleton 骨架屏 | 输入触发菜单与列表的骨架行（CSS + 两行 fallback） | `E:/deepseek-harness/packages/client/ui-input-trigger/src/client/MenuView.tsx`、`MenuView.module.css`；`TextShimmer` 承担文本骨架效果 |

> 说明：未在 ui-conversation/ui-chat 中发现独立的 `Skeleton.tsx` 组件；骨架反馈由 `TextShimmer`、菜单骨架行、以及各列表 loading 文案承担。

### 3.7 弹窗 / 浮层 / 菜单

| 组件 | 作用 | 绝对路径 |
|---|---|---|
| `MenuOverlay` / `menuEntries` | 右键菜单统一渲染（contextual、portal、子菜单、footer、快捷提示） | `E:/deepseek-harness/packages/client/ui-context-menu/src/client/View.tsx` |
| `View.tsx` / `Button.tsx` / `trigger.ts` / `external-trigger.ts` / `registry.ts` / `target-key.ts` | 右键菜单触发、注册、目标键 | `E:/deepseek-harness/packages/client/ui-context-menu/src/client/` |
| `Menu` / `MenuSurface` / `MenuGroup` / `MenuRow` | 通用下拉菜单 / 菜单面 / 分组 / 行 | `E:/deepseek-harness/packages/client/ui-primitives/src/Menu.tsx` 等同名文件 |
| `Modal` / `useModalLayer` | 通用对话框（portal、遮罩、Escape、焦点管理、headless 模式） | `E:/deepseek-harness/packages/client/ui-primitives/src/Modal.tsx` |
| `Tooltip` / `tooltip-placement.ts` | 工具提示（portal、延迟、快捷键标签） | `E:/deepseek-harness/packages/client/ui-primitives/src/Tooltip.tsx`、`tooltip-placement.ts` |
| `HoverCard` / `HoverCardGroup` | 会话行 / 工作区行悬浮卡 | `E:/deepseek-harness/packages/client/ui-primitives/src/HoverCard.tsx`、`HoverCardGroup.tsx` |
| `ImageLightbox` / `ImagePreview` / `DraggableImage` | 图片预览浮层 | `E:/deepseek-harness/packages/client/ui-primitives/src/ImageLightbox.tsx` 等同名文件 |
| `SegmentedControl` / `SegmentedTabs` / `Pill` / `Tag` / `Switch` / `Checkbox` / `Input` / `Button` | 通用 UI 原子（分段控件、标签、开关、输入、按钮） | `E:/deepseek-harness/packages/client/ui-primitives/src/` 下同名文件 |
| `PopupSelectView` / `popup.ts` | 命令弹层选择视图 | `E:/deepseek-harness/packages/client/ui-commands/src/client/PopupSelectView.tsx`、`popup.ts` |
| `MenuView` | 输入触发候选浮层（combobox listbox） | `E:/deepseek-harness/packages/client/ui-input-trigger/src/client/MenuView.tsx` |
| `FloatLayer` / `DockSurface` / `TabLayout` / `TabTitle` / `TabPanel` | 通用浮层 / 停靠层 / 标签布局（dockkit） | `E:/deepseek-harness/packages/client/ui-dockkit/src/components/` 下同名文件 |
| `ShellCard` | shell 卡片（设置面板容器类） | `E:/deepseek-harness/packages/client/ui-settings-shell/src/client/ShellCard.tsx` |
| `contextMenu.button` factory / `contextMenu.content` | 行菜单触发与自定义菜单内容 seat | `E:/deepseek-harness/packages/client/ui-workspace/src/client/rows/Rows.tsx`、`E:/deepseek-harness/packages/client/ui-context-menu/src/client/registry.ts` |

---

## 第 4 章 卡片清单（全部类型）

### 4.1 思考过程卡

| 组件 | 作用 | 绝对路径 |
|---|---|---|
| `ReasoningRow` | 单个推理块的折叠行（think 图标、摘要 shimmer、展开 Markdown） | `CHAT/chat/ReasoningRow.tsx` |
| `ReasoningContent` | 推理内容 Factory：compact `MarkdownText` | `CHAT/chat/ReasoningContent.tsx` |
| `DefaultReasoningBody` | 推理 Body slot 的默认适配器（转调 Content Factory） | `CHAT/chat/ReasoningContent.tsx` |
| `ProcessReasoning`（内部） | 整 turn 折叠时隐藏 / 揭示内联推理 | `CHAT/chat/AssistantMarkdown.tsx` |
| `useDisclosure` / `bindDisclosure` | 折叠状态 hook，随 turn 重置 | `CHAT/chat/use-disclosure.ts` |
| `processTitle` / `PROCESS_ICONS` | 步骤分组标题（按 activity 排序组合文案与图标） | `CHAT/chat/step-process.ts`、`CHAT/chat/ChatGroupSeat.tsx` |
| `ChatGroupSeat` | 步骤（step process）分组的折叠 / 展开容器 | `CHAT/chat/ChatGroupSeat.tsx` |
| `TurnProcessNodeView` | turn 级过程折叠开关 | `CHAT/chat/TurnProcessNodeView.tsx` |

> 活动类型（icon）：`thinking / read / readImage / search / edit / write / commands / code / webSearch / webFetch / subagents / plan / questions / tools / context`，见 `CHAT/chat/ChatGroupSeat.tsx`。

### 4.2 工具调用卡（10 内建 + 2 跨包）

**框架层：**

| 组件 | 作用 | 绝对路径 |
|---|---|---|
| `ToolCallTree` / `ToolCall` / `ToolCallBranch` | 根调用与递归子调用的 keyed 派发，fallback 为 `GenericToolCard` | `TOOL/tool/ToolCallTree.tsx` |
| `GenericToolCard` | 通用工具卡回退（按 variant 选图标，自动识别 terminal/read/diff/search/web 卡） | `TOOL/tool/toolviews/GenericToolCard.tsx` |
| `ToolRow` | 所有工具行共用的可展开行壳（summary、body、output、各类 card 插槽） | `TOOL/tool/components/ToolRow.tsx` |
| `ToolDetails` / `ToolDetailItem` | 只读字段 / 列表 / 状态码详情卡（子代理、定时任务、LSP 等结果） | `TOOL/tool/components/ToolDetails.tsx` |
| `AskQuestionCard` | ask_user_question 的问题记录卡 | `TOOL/tool/components/AskQuestionCard.tsx` |
| `QuestionToolRow` | 问题面板行 | `TOOL/tool/components/QuestionToolRow.tsx` |
| `ExitCodeBadge` | 命令退出码徽标 | `TOOL/tool/components/ExitCodeBadge.tsx` |
| `toolRowModel` + 各 card model | 行模型派生：variant/state/summary/body/output + terminal/read/diff/search/web/image/details 模型 | `TOOL/tool/models/`（`tool-call-model.ts`、`terminal-card-model.ts`、`read-card-model.ts`、`diff-card-model.ts`、`search-card-model.ts`、`web-card-model.ts`、`image-card-model.ts`、`details-card-model.ts`、`office-card-model.ts`、`todo-diff-model.ts`、`ask-question-card-model.ts`、`auto-review-denial.ts` 等） |

**内建 tool view（文件名即线索，含注册 key）：**

| 组件 | 作用 / 覆盖的 wire key | 绝对路径 |
|---|---|---|
| `BashRow` (`bashToolviewSample`) | 命令执行卡：状态、退出码、TerminalBlock / 输入输出；key `bash` | `TOOL/tool/toolviews/bash-sample.tsx` |
| `ReadRow` (`readToolview`) | 读文件卡：可打开路径 + ReadBlock；key `read` | `TOOL/tool/toolviews/read-row.tsx` |
| `ReadImageRow` (`readImageToolview`) | 读图片卡：图片经 `tool.call.images` slot 展示；key `read_image` | `TOOL/tool/toolviews/read-image-row.tsx` |
| `FileMutationRow` (`fileMutationToolview`) | 写 / 改文件卡：DiffBlock + 文件大小；key `apply_patch` / `edit` / `write` | `TOOL/tool/toolviews/file-mutation-row.tsx` |
| `SearchRow` (`searchToolview`) | 搜索卡（grep/glob 结果，SearchBlock）；key `grep` / `glob` | `TOOL/tool/toolviews/search-row.tsx` |
| `WebRow` (`webToolview`) | Web 搜索 / 抓取卡（WebBlock + 传输失败文案 + URL 链接）；key `web_search` / `web_fetch` | `TOOL/tool/toolviews/web-row.tsx` |
| `TodoRow` (`todoToolview`) | 计划 / 待办卡（完成数、diff、状态变化）；key `todo_write` | `TOOL/tool/toolviews/todo-row.tsx` |
| `DetailsRow` (`detailsToolview`) | 详情卡（**40 个 key**）：create/get/update_goal、schedule_*、cordis_inspect_*、workflow、ralph、session_*、list_subagent_models、subagent/subagent_fork、list_agents、send_message、interrupt_agent、job_*、terminal_open/read/list/signal/close、lsp、spawn_teammate、team_task_*、wait_agent | `TOOL/tool/toolviews/details-row.tsx` |
| `AskQuestionRow` (`askQuestionToolview`) | 向用户提问卡（问题 / 选项 / 答案记录、面板揭示）；key `ask_user_question` | `TOOL/tool/toolviews/ask-question-row.tsx` |
| `OfficeRow` (`officeToolview`) | Office 文档卡（路径导航 + 文本结果）；key `office_render` / `office_convert` / `office_recalculate` | `TOOL/tool/toolviews/office-row.tsx` |

**其它包注册的 tool view：**

| 组件 | 作用 / key | 绝对路径 |
|---|---|---|
| `SkillRow` | 技能调用卡；key `skill` | `E:/deepseek-harness/packages/client/ui-skill/src/client/SkillRow.tsx`（注册见同目录 `index.ts:89`） |
| `PresentRow` | 交付(present)工具调用状态卡；key `present` | `DELIV/PresentRow.tsx`（注册见 `DELIV/index.ts:85`） |

> 说明：`ui-tool/src/client/apply.ts:47-56` 依次挂载以上 10 个内建 tool view；`GenericToolCard` 兜底其它 key（如 `pwsh`、`run_code`、`cua_run_code`、`cordis_run/stop/undefine` 等，见 `TOOL/tool/models/tool-call-model.ts` 的 `TOOL_VARIANTS`）。未发现 MCP / 图片生成专用 tool view；`read_image` 承担图片结果展示。

### 4.3 代码相关卡

| 组件 | 作用 | 绝对路径 |
|---|---|---|
| `FenceCodeBlock` | 代码块（语言横幅、复制、换行、diff 模式） | `PRIM/markdown/FenceBlocks.tsx` |
| `FenceMathBlock` | 数学公式卡（display TeX / KaTeX） | `PRIM/markdown/FenceBlocks.tsx` |
| `MathFenceLayer` | `math` fence 层：流式时显示源码、稳定后渲染公式 | `CHAT/fence/FenceLayers.tsx` |
| `DiffFenceLayer` | `diff` / `patch` fence 层：统一 diff 行 | `CHAT/fence/FenceLayers.tsx` |
| `registerFenceLayers` | 按语言注册 fence 层（`math`/`diff`/`patch`） | `CHAT/fence/register.ts` |
| `CodeBlock` | 通用代码卡原语（工具栏、高亮、复制） | `PRIM/markdown/CodeBlock.tsx` |
| `DiffBlock` | 工具结果中的 diff 卡原语 | `PRIM/DiffBlock.tsx` |
| `JsonBlock` | JSON / 未知块回退卡（截断至 20k 字符） | `PRIM/markdown/JsonBlock.tsx` |
| `renderTable` | Markdown 表格渲染（宽表 `md-table-wide`、横向滚动） | `PRIM/markdown/render.tsx` |

### 4.4 附件与文件卡（ui-attachment 全部卡片）

| 组件 | 作用 | 绝对路径 |
|---|---|---|
| `FileCard` | 草稿文件卡：类型图标、名称、大小、上传进度、失败重试、移除 | `ATTACH/FileCard.tsx` |
| `MessageImage` | 单张消息图片：授权加载、重试、lightbox，三种 variant `single/tile/thumbnail` | `ATTACH/MessageImage.tsx` |
| `ImageGallery` | 图片画廊（多图平铺） | `ATTACH/MessageImage.tsx` |
| `MessageImages` / `MessageImagesContent` | 图片消息 slot 与官方 Content Factory | `ATTACH/client/MessageImages.tsx` |
| `ComposerAttachments` | 输入框附件区：草稿预览、文件卡、拖拽覆盖层、lightbox | `ATTACH/client/ComposerAttachments.tsx` |
| `AttachmentRail` | 草稿附件的横向滚动轨道（边缘翻页按钮） | `ATTACH/AttachmentRail.tsx` |
| `DropOverlay` | 拖拽文件覆盖提示 | `ATTACH/DropOverlay.tsx` |
| `installDocumentDropEvents` | 文档级拖放事件 | `ATTACH/client/drop-events.ts` |
| 用户消息中的文件卡 | `UserContent` 内以 `FileTypeIcon + 名称 + 扩展名/大小` 展示已提交文件 | `CHAT/chat/UserContent.tsx` |

> 注册位置：`ATTACH/client/index.ts` —— `conversation.images.content` Factory、`conversation.input.attachments`、`conversation.chat.message.images`、`conversation.chat.user.images`、`conversation.trajectory.images`、`tool.call.images`。

### 4.5 交付物卡（ui-deliverables 全部卡片）

| 组件 | 作用 | 绝对路径 |
|---|---|---|
| `DeliverablesTail` / `Deliverables` | turn 尾部的交付物区：变更文件卡 + 明确声明的交付文件列表 | `DELIV/Deliverables.tsx` |
| `ChangedFiles` | 变更文件卡（单文件/多文件、增删行数、hover 预览、打开评审） | `DELIV/ChangedFiles.tsx` |
| `FileDiff` | 共享文件对比（并排/统一 diff、语法高亮、行数上限 5000） | `DELIV/FileDiff.tsx` |
| `PresentedFileCard` | 单个交付文件卡（类型图标、描述、状态、native 动作、侧栏预览） | `DELIV/PresentedFileCard.tsx` |
| `PresentRow` | present 工具调用状态卡（见 4.2） | `DELIV/PresentRow.tsx` |
| `ReviewTab` | 右侧栏 `changes-review` tab：按文件切换查看 turn 前后对比 | `DELIV/ReviewTab.tsx` |
| `ChangesSummaryStore` / `ChangesDiffStore` / `PresentedOpenController` | 变更摘要/diff/交付打开的 store | `DELIV/changes-summary.ts`、`DELIV/changes-diff.ts`、`DELIV/present-open.ts` |
| `turn-deliverables` / `review-definition` | turn 交付 Definition、评审 tab 定义 | `DELIV/turn-deliverables.ts`、`DELIV/review-definition.ts` |

> 其它 turnTail 交付/产物卡（跨包）：`PlanCards` — `E:/deepseek-harness/packages/client/ui-plan/src/client/PlanCard.tsx`；`ScheduleTurnCard` / `ScheduleCreateCard` — `E:/deepseek-harness/packages/client/ui-schedule/src/client/ScheduleTurnCard.tsx`、`ScheduleCreateCard.tsx`。

### 4.6 其他卡

| 组件 | 作用 | 绝对路径 |
|---|---|---|
| `TeamCommandRow` | `/team` 命令历史失败/输出卡 | `E:/deepseek-harness/packages/client/ui-agent-team/src/client/TeamCommandRow.tsx` |
| `GenericCommandCard` | 通用命令生命周期卡（running/ok/error 摘要 + 多行输出） | `CHAT/chat/GenericCommandCard.tsx` |
| `CompactionCommandCard` | `/compact` 命令 + 压缩事务整合卡 | `CHAT/chat/CompactionCommandCard.tsx` |
| `CommandNodeView` / `ManualCompactionNodeView` | 命令节点 keyed renderer + 命令视图 slot 派发 | `CHAT/chat/CommandNodeView.tsx` |
| `ApprovalCommand` | 审批详情：解析关联工具调用的命令文本 | `CHAT/chat/ApprovalCommand.tsx` |
| `ApprovalCard` / `ApprovalWarning` / `ApprovalPanel` | 权限审批卡（允许/拒绝/始终允许、警告） | `E:/deepseek-harness/packages/client/ui-approval/src/client/ApprovalCard.tsx`、`ApprovalWarning.tsx`、`ApprovalPanel.tsx` |
| `QuestionReplyBubble` / `QuestionReplyView` | 已回答问题批次的用户气泡（右对齐、带复制/时间） | `E:/deepseek-harness/packages/client/ui-user-questions/src/client/QuestionReplyView.tsx` |
| `WorkflowRunPanel` | 工作流运行节点卡（状态、阶段、成员） | `E:/deepseek-harness/packages/client/ui-workflow-run/src/client/WorkflowRunPanel.tsx` |
| `GoalCommandInputView` | `/goal` 命令输入气泡 | `E:/deepseek-harness/packages/client/ui-goal/src/client/GoalCommandInputView.tsx` |
| `WebBlock` / `WebSourceView` | Web 搜索结果卡（答案 + 引用来源列表）/ web_fetch 卡 | `PRIM/WebBlock.tsx` |
| `SearchBlock` | grep/glob 结果卡原语 | `PRIM/SearchBlock.tsx` |
| `TerminalBlock` | 终端执行结果卡原语 | `PRIM/TerminalBlock.tsx` |
| `ReadBlock` | 读文件结果卡原语 | `PRIM/ReadBlock.tsx` |
| `FileReference` / `FolderReference` | 用户文本中的 `@文件` / `@文件夹` 引用渲染 | `E:/deepseek-harness/packages/client/ui-reference/src/client/FileReference.tsx` |

### 4.7 清点要点

- **节点渲染统一走 keyed slot** `conversation.chat.node`（`CHAT/chat/register-node-renderers.ts`），工具卡统一走 `tool.call.toolview`（`TOOL/apply.ts`）。
- **工具卡共 10 个内建 view + 2 个跨包 view**，`detailsToolview` 一类就覆盖 40 个 wire key，`fileMutationToolview` 覆盖 3 个、`webToolview`/`searchToolview`/`officeToolview` 各 2–3 个。
- **消息块 slot** 在 `CHAT/chat/AssistantMarkdown.tsx`：text / reasoning / image / tool-call / 未知→`JsonBlock`。
- 所有路径均已通过实际打开目录与文件确认，未发现独立命名的「MCP 卡」「图片生成卡」；相关能力由通用 `GenericToolCard` / `read_image` / `DetailsRow` 承担。

---

## 第 5 章 文本内容 / i18n 清单

### 5.1 总论

聊天页可见文字 **100% 走 `t('key')` 字典**，无硬编码（对 5 个核心包做了中文字符 / `placeholder` / `aria-label` / `title` / 裸 JSX 文本全文扫描，零遗漏）。唯一例外是注释中出现的中文（如 `ContextMeter.tsx` 注释里的 `45% of context used / 上下文已用 45%`），非运行时文案。

**主字典：**

| 字典 | 大小 | 作用 |
|---|---|---|
| `CHAT/locale.ts` | 101.47 KB | zh 为真源，`NS = 'chat'` |
| `E:/deepseek-harness/packages/client/ui-conversation/src/client/locales.ts` | 172.11 KB | 会话 / 输入区文案 |
| 各包的 `locales.ts` / `locale/zh.json` | — | 各功能包文案 |

文件开头示例（`E:/deepseek-harness/packages/client/ui-chat/src/client/locale.ts:1-8`）：

```ts
/** Chat-owned locale namespace and dictionaries. */
/** Namespace for Chat target, node, statistics, and details copy. */
export const NS = 'chat'
/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'message.stepProcess.thinking': '正在分析请求',
  ...
}
```

### 5.2 步骤过程文案（`message.stepProcess.*`）

| 类别 | 文案 |
|---|---|
| 进行态 | `正在分析请求` / `正在读取文件` / `正在读取图片` / `正在写入文件` / `正在搜索代码` / `正在编辑文件` / `正在运行命令` / `正在运行代码` / `正在搜索网页` / `正在访问网页` / `正在协调子智能体` / `正在更新计划` / `等待你的操作` / `正在调用工具` |
| 准备态（`prepare.*`） | `准备读取文件` / `准备读取图片` / `准备写入文件` / `准备搜索代码` / `准备编辑文件` / `准备运行命令` / `准备运行代码` / `准备搜索网页` / `准备访问网页` / `准备协调子智能体` / `准备更新计划` / `准备提问` / `准备调用工具` |
| 完成态（`done.*`） | `已完成分析` / `已读取文件` / `已读取图片` / `已写入文件` / `已搜索代码` / `修改了文件` / `执行了命令` / `运行了代码` / `已搜索网页` / `已访问网页` / `已协调子智能体` / `更新了计划` / `向用户提出了问题` / `已调用工具` / `已注入上下文` |
| 组合 | `{first}并{second}`、`，`、`已`、`{title}等` |

### 5.3 触发来源 / turn 过程 / 视图 / 图片

| 分类 | 文案 |
|---|---|
| 触发来源（`message.trigger.*`） | `收到执行请求` / `继续执行目标` / `收到任务消息` / `收到团队消息` / `子任务状态更新` / `子智能体已完成任务` / `子智能体任务已停止` / `子智能体执行失败` / `子智能体已达 token 上限` / `子智能体拒绝执行` / `子智能体异常结束` / `收到 GitHub 事件` / `收到外部事件` / `自动化任务` / `后台任务状态更新` / `插件状态更新` / `这条通知触发了本轮回复。` |
| turn 过程 | `已完成` / `已完成，用时 ` / `处理失败` |
| 视图 | `对话` |
| 图片 | `查看大图` / `加载图片…` / `图片无法预览` / `图片预览` / `关闭图片预览` |
| 数字 | `number.groupSeparator` = `,` |

### 5.4 消息操作与反馈

复制 / 已复制、点赞 / 点踩（含填充态）、分支、反馈弹窗（`FEEDBACK/FeedbackDialog.tsx`）与成功 / 失败 toast、时间戳（`formatMessageClock` / `formatRunDuration`）、token 用量明细（输入 / 缓存 / 输出 / 推理 token、模型路由，`TurnUsagePanel.tsx`）。

### 5.5 输入区文案

`placeholder.*` / `hint.*`、命令 ghost hint、发送 / 停止 / 继续 / 发送中 tooltip 与快捷键、附件校验与图片限额提示（`image-labels.ts`）。

### 5.6 onboarding 全套文案

来源：`E:/deepseek-harness/packages/client/ui-settings-account/src/client/locales/onboarding.ts`

| 中文 | English | key |
|---|---|---|
| 继续 / 你希望看到多少工作过程？ | Continue / How much detail would you like to see? | `onboardingContinue` / `onboardingProcess` |
| 这只会影响工作过程的展示方式，不会影响 DeepSeek Harness 的工作能力。 | This only changes how progress is shown, not what DeepSeek Harness can do. | `onboardingProcessDescription` |
| 聚焦结果 / 只看结果，保持界面简洁明了 | Results only / See just the results in a clean, simple interface | `onboardingCompact` / `onboardingCompactDescription` |
| 关键细节 / 结果优先，仅展示重要步骤和关键操作 | Key details / Focus on results, with only the most important steps and actions shown | `onboardingStandard` / `onboardingStandardDescription` |
| 完整过程 / 查看完整工作过程，方便调试和排查问题 | Full details / See the full process for easier debugging and troubleshooting | `onboardingDetailed` / `onboardingDetailedDescription` |
| 进入应用 / 上一步 / 跳过 | Open app / Back / Skip | `onboardingEnter` / `onboardingBack` / `onboardingSkip` |
| 跳过设置？/ 你可以随时前往 设置 → 通用设置 中调整工作过程、性能与用量展示方式或开启代码工作工具。 | Skip setup? / You can change how progress, performance, and usage are displayed, or enable Coding Tools, anytime in Settings → General. | `onboardingSkipTitle` / `onboardingSkipDescription` |
| 继续设置 / 暂时跳过充值？ | Continue setup / Skip adding credits? | `onboardingKeepSetting` / `onboardingNoCreditTitle` |
| 没有可用额度时，DeepSeek Harness 将无法开始新的任务。你可以稍后前往 设置 → 账号与余额 进行充值。 | DeepSeek Harness can't start new tasks without credits. You can add them later in Settings → Account. | `onboardingNoCreditDescription` |
| 我知道了 / 前往充值 | Got it / Add credits | `onboardingUnderstood` / `onboardingGoTopUp` |
| 未能保存设置，请重试。/ 重试 / 正在加载设置… | Could not save settings. Try again. / Retry / Loading settings… | `onboardingSaveFailed` / `onboardingRetry` / `onboardingLoading` |

品牌文案：`onboardingBrand` = `DeepSeek Harness`（来源 `E:/deepseek-harness/packages/client/ui-settings-account/src/client/locales/onboarding.ts`）。

### 5.7 账号与额度提示（聊天中弹出）

来源：`E:/deepseek-harness/packages/client/ui-settings-account/src/client/locales.ts`

| 中文 | English | key |
|---|---|---|
| 当前模型暂不可用，请登录后再试 | Model unavailable. Please sign in and try again. | `modelSignInRequired` |
| 登录信息已失效，请重新登录 | You have signed out of your account, please log in again. | `sessionExpired` |
| 当前无可用余额 / 没有可用额度时，DeepSeek Harness 无法开始新的任务，是否前往充值？或者可以稍后前往 设置 → 账号与余额 进行充值。/ 去充值 | No balance available / DeepSeek Harness cannot start a new task with this account when no balance is available. Would you like to top up? You can also top up later in Settings → Account. / Top up | `quotaTitle` / `quotaDescription` / `quotaTopUp` |
| 开始使用 / 登录 DeepSeek 账号，或添加 API Key，即可开始使用。你的项目和文件保存在本地。 | Get started / Sign in to your DeepSeek account or add an API Key to get started. Your projects and files are stored locally. | `loginTitle` / `loginDescription` |
| 等待登录 / 没有自动打开新页面？/ 复制登录链接 / 链接已复制 / 复制失败 / ，手动打开登录页完成登录。 | Waiting for sign in / Page did not open automatically? / Copy sign-in link / Link copied / Copy failed / , then open it in your browser to finish signing in. | `browserTitle` / `browserPrompt` / `copyLink` / `copiedLink` / `copyFailed` / `browserDescription` |
| 登录已超时 / 请重新登录后继续操作。/ 登录失败 / 操作未完成，请重试 / 重试 | Sign in timed out / Sign in again to continue. / Could not sign in / Could not complete the operation. Try again. / Retry | `timeoutTitle` / `timeoutDescription` / `failureTitle` / `platformFailed` / `platformRetry` |
| 加载中… / 返回 DeepSeek Harness / 设置 / 意见反馈 / 账号菜单 | Loading… / Back to DeepSeek Harness / Settings / Feedback / Account menu | `loading` / `backToHarness` / `settings` / `contactUs` / `menu` |
| 登录 / 退出登录 / 已登录 DeepSeek / 尚未登录 | Sign in / Sign out / Signed in to DeepSeek / Not signed in | `signIn` / `signOut` / `signedIn` / `signedOut` |
| 暂时无法确认任务状态。退出登录可能会中断使用此账号的任务，是否继续？/ 退出登录不会丢失任何数据，你仍可以登录此账号。/ 当前有进程正在执行中，点击"退出登录"，将会打断进程，是否即刻退出登录？/ 取消 / 打开浏览器 | （对应英文见字典 en） | `signOutUnknownDescription` / `signOutDescription` / `signOutRunningDescription` / `cancel` / `open` |
| 正在发起登录… / 请在浏览器中继续 / 正在完成登录… / 登录已过期，请重试。/ 其他错误文案 | Starting sign in… / Continue in your browser / Completing sign in… / Sign in expired. Try again. | `initializing` / `waiting` / `completing` / `expired` / `failed` / `noResponse` / `settingsSignedOutTitle` / `settingsSignedOutDescription` / `signInDescription` / `profileUnavailable` / `balance` / `bonusBalance` / `balanceUnavailable` / `balanceSignedOut` / `accountInfo` / `more` / `usage` / `topUp` |

> 额度 Toast 的聊天页文案来源是 `message.failure.quota`（当前请求的额度已用尽 / Request quota exhausted.），见 `CHAT/chat/QuotaNoticeHost.tsx`；弹窗详情走本节 `quotaTitle/quotaDescription/quotaTopUp`。

### 5.8 模型设置欢迎提示（WelcomeNotice）

来源：`E:/deepseek-harness/packages/client/ui-settings-models/src/client/locales.ts` 与 `E:/deepseek-harness/packages/client/ui-settings-models/src/client/WelcomeNotice.tsx`

该提示只在首次 / 版本更新时出现在聊天区上方，文案位于 `ui-settings-models/src/client/locales.ts`（en 为真源，zh 字典同 key）。关键条目：`intro`（输入 API key 以使用以下提供方的模型 / Enter your API keys to use models from the following providers.）、`add`（添加模型提供方 / Add model provider）、`close`（关闭 / Close）、`keyPlaceholder`（输入你的 API key / Enter your API key）、`credentialConfigured`（API key 已配置 / API key configured）、`keyHelp`（保存的凭据优先使用… / Saved credentials are used first…）等。完整字典约 130+ 条，均为设置面板文案。

版本控制常量：`WELCOME_NOTICE_ACK_FIELD='welcomeNoticeVersion'`、`WELCOME_NOTICE_VERSION='2026-09-28.1'`，来源 `E:/deepseek-harness/packages/client/ui-settings-models/src/onboarding-copy.ts`。

### 5.9 各包 locale 目录元信息

| 包 | 中文标题 / 描述 | 英文标题 | 来源 |
|---|---|---|---|
| ui-chat | 聊天内容展示 / 渲染聊天消息、工具内容和相关详情。 | ui-chat | `E:/deepseek-harness/packages/client/ui-chat/locale/zh.json`、`en.json` |
| ui-conversation | 会话界面框架 / 组织对话内容、输入框、消息队列和视图导航。 | ui-conversation | `E:/deepseek-harness/packages/client/ui-conversation/locale/zh.json`、`en.json` |
| ui-tool | 工具调用展示 / 展示工具调用过程、嵌套关系和各工具的结果界面。 | ui-tool | `E:/deepseek-harness/packages/client/ui-tool/locale/zh.json`、`en.json` |
| ui-message-feedback | 消息反馈包元信息 | ui-message-feedback | `E:/deepseek-harness/packages/client/ui-message-feedback/locale/zh.json`、`en.json` |
| ui-attachment | 附件包元信息 | ui-attachment | `E:/deepseek-harness/packages/client/ui-attachment/locale/zh.json`、`en.json` |
| ui-deliverables | 交付文件包元信息 | ui-deliverables | `E:/deepseek-harness/packages/client/ui-deliverables/locale/zh.json`、`en.json` |
| locale | 通用字典包元信息 | locale | `E:/deepseek-harness/packages/client/locale/locale/zh.json`、`en.json` |

> 这些 `meta.*` 是语言包注册用的元信息，不是聊天正文，但用户可能在语言 / 包列表中看到，故列出。

---

## 第 6 章 样式与消息渲染管线

### 6.1 样式

- 组件样式：`ui-chat/src/client/**/*.module.css` + `ui-primitives/src/markdown/*.module.css`
- 主题全局样式：`ui-theme/src/styles/*`（含 `onboarding.css`、`shiki.css`）
- 代码块工具栏：`E:/deepseek-harness/packages/client/ui-primitives/src/CodeToolbar.tsx`

### 6.2 Markdown 渲染

| 文件 | 作用 |
|---|---|
| `ui-primitives/src/markdown/render.tsx` | 表格 / 引用 / 脚注 / 图片渲染（`renderTable`：宽表 `md-table-wide`、横向滚动） |
| `highlight.ts` | shiki 代码高亮（`E:/deepseek-harness/packages/client/ui-theme/src/styles/shiki.css`） |
| `useViewportHighlighting.ts` | 视口内代码块高亮优化 |
| `cjkFriendlyStrong.ts` | CJK 友好加粗边界规则 |
| `plain-text.ts` / `quote-text.ts` / `file-link.ts` / `local-image-syntax.ts` / `windows-path-destinations.ts` | 纯文本 / 引用 / 文件路径链接 / 本地图片语法 / Windows 路径兼容 |
| `MarkdownDelegate.tsx` | 链接文件 / URL / 图片菜单、打开文件、renderCode 回调 |
| `MarkdownText.module.css` | 表格、引用、脚注、图片等 Markdown 元素样式 |

### 6.3 公式与 fence 层

| 文件 | 作用 |
|---|---|
| `ui-primitives/src/markdown/katex.tsx` | KaTeX 公式渲染：Tex→React（strict/ignore/错误 span 三段容错），MathML + 可视 span |
| `mathCompatibility.ts` | 数学语法兼容处理（inline `$...$`、块级 `$$...$$` 与 mdast-math 对齐） |
| `copy-tex.ts` | 复制公式为 Tex 源码 |
| `diff-fence.ts` | diff 语言围栏解析与统一 diff 行构建 |
| `CHAT/fence/FenceLayers.tsx` | `MathFenceLayer`（流式显示源码、完成后显示 KaTeX 公式）与 `DiffFenceLayer`（diff/patch 统一 diff 行） |
| `CHAT/fence/register.ts` | 注册 math / diff / patch 三种 fence 层 |

> 结论：表格在 `render.tsx` 直接渲染；公式用 KaTeX（**无 mermaid**）；代码高亮用 shiki；图片经 `MarkdownDelegateProvider.fileImages` + `ui-attachment/MessageImage`。

### 6.4 Chat 侧渲染入口

| 文件 | 作用 |
|---|---|
| `CHAT/chat/AssistantMarkdown.tsx` | 把助手消息块交给 `MarkdownText`（text 块）、`ReasoningRow`（reasoning）、图片 slot、JsonBlock |
| `CHAT/chat/ChatView.tsx` | 在 `MarkdownDelegateProvider` 中注入 `renderCode`，把每个代码围栏派发到语言 keyed slot，默认 `FenceCodeBlock` |
| `CHAT/markdown-labels.ts` | 从 Chat locale 生成代码复制 / 脚注标签 |
| `apps/web/katex-fonts.ts` | Web 构建中 KaTeX 字体资源处理 |

### 6.5 E2E 测试佐证入口（行为证据，非源码主体）

- `apps/web/tests/chat-*.e2e.ts` 系列（`chat-scroll-contract.e2e.ts` 101KB、`chat-flow-layout.e2e.ts`、`chat-fold-opened-group.e2e.ts`、`chat-continuous-conversation.e2e.ts`、`chat-long-interactions.e2e.ts`）
- `apps/web/tests/code-card-layout.e2e.ts`、`clickable-links-gallery.e2e.ts`、`changed-files-turn.e2e.ts`
- `packages/client/ui-chat/tests/chat-view.client.spec.tsx`（231KB）、`conversation-node-definitions.client.spec.ts`（137KB）、`chat-scroll.client.spec.tsx`、`reasoning-row.client.spec.tsx`、`assistant-markdown-path-images.client.spec.tsx` 等约 70 个测试文件

---

# 第二篇 插件图标与内容的显示机制

> 核心结论：**图标走「全局 sprite + 主题替换 + 少量图标 slot」三条路，内容走「Cordis slot 注入系统」一条路，两者互不耦合。**

## 第 7 章 插件加载是前提

聊天页面本身不是一个「页面文件」，而是由一堆 Cordis 插件（client 包）在运行时拼装出来的。插件树在 `E:/deepseek-harness/packages/bundle/web-app/cordis.patch.yml` 声明，每个包的 `apply(ctx)` 在插件激活时执行，把图标和内容分别注册进对应的系统：

```
cordis.patch.yml（声明 ui-chat / ui-tool / ui-sidebar / ui-theme …）
  → 各包 apply(ctx)
      ├─ 图标 → 全局 artwork.ts + 主题 icons 替换 + contextMenu.icon 等图标 slot
      └─ 内容 → ctx.slots.register(...) 挂到 conversation.* / tool.call.* slot
```

与 DSH-IDE 的关系：DSH-IDE 作为 DSH 应用内的 bundle 插件，天然复用 `dshCtx`（位于 DSH Host 进程），直接接入上述同一套 slot / 图标 / i18n / 样式机制，不需要任何独立的图标或 UI 通道，也不新增第二套会话或协议。

## 第 8 章 图标显示机制：artwork → sprite → use

### 8.1 数据定义（artwork.ts）

`E:/deepseek-harness/packages/client/ui-primitives/src/icons/artwork.ts`：

```ts
interface IconArtwork {
  size: number                              // 默认渲染高度
  aspect?: readonly [number, number]        // 非方形的宽高比
  svg: (strokeWidth: number) => string      // SVG 源码，笔宽随字重变化
}
export const ICON_ARTWORK = {
  'new-chat-outline': { size: 16, svg: sw => `<svg viewBox="0 0 16 16" ...>...</svg>` },
  'search-outline':   { size: 16, svg: sw => `...` },
  ...
}
```

两个字重：`ICON_REGULAR_STROKE = 1`、`ICON_MEDIUM_STROKE = 1.3`。每个 glyph × 每个字重展开成一个 `ICON_SYMBOLS` 条目，symbol id 形如 `dsw-icon-new-chat-outline-regular`。

### 8.2 组件绑定（index.tsx）

`E:/deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx:17-25`：

```ts
function productIcon(glyph, weight) {
  const { size, aspect } = ICON_ARTWORK[glyph]
  const id = iconSymbolId(glyph, weight)        // → dsw-icon-<glyph>-<weight>
  return ({ size = defaultSize, className }) => (
    <svg width={...} height={size} className={className} data-icon={id} aria-hidden="true">
      <use href={`#${id}`} />                    {/* 引用 sprite 里的 symbol */}
    </svg>
  )
}
export const IconNewChatOutlineRegular = productIcon('new-chat-outline', 'regular')
export const IconNewChatOutlineMedium  = productIcon('new-chat-outline', 'medium')
```

所以 `Icon*Regular` / `Icon*Medium` 是**编译期具名组件**，不是运行时按字符串查表。size 默认取 artwork 定义，className 由调用方传入，`<use href="#dsw-icon-...">` 引用 sprite。

### 8.3 注入 sprite（icon-sprite.ts）

`E:/deepseek-harness/packages/client/ui-theme/src/client/icon-sprite.ts`（完整机制）：

```ts
const DROPPED_ATTRIBUTES = new Set(['width', 'height', 'xmlns', 'class', 'aria-hidden'])

function toSymbol(id, markup) {
  const root = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement
  const symbol = document.createElementNS(SVG_NS, 'symbol')
  for (const { name, value } of root.attributes)
    if (!DROPPED_ATTRIBUTES.has(name)) symbol.setAttribute(name, value)
  symbol.id = id
  symbol.append(...[...root.childNodes].map(node => document.importNode(node, true)))
  return symbol
}

export function installIconSprite(ctx, icons) {
  if (typeof document === 'undefined') return
  const sprite = document.createElementNS(SVG_NS, 'svg')
  sprite.setAttribute('aria-hidden', 'true')
  sprite.setAttribute('data-dsh-icon-sprite', '')
  sprite.style.cssText = 'position: absolute; width: 0; height: 0; overflow: hidden'
  const rendered = new Map()
  const markups = new Map()
  const apply = (replacements = {}) => {
    for (const [id, fallback] of Object.entries(ICON_SYMBOLS)) {
      const markup = replacements[id] ?? fallback
      if (markups.get(id) === markup) continue
      const symbol = toSymbol(id, markup)
      const previous = rendered.get(id)
      if (previous === undefined) sprite.append(symbol)
      else previous.replaceWith(symbol)          // 主题热替换
      rendered.set(id, symbol)
      markups.set(id, markup)
    }
  }
  apply(icons)
  ctx.effect(() => {
    document.body.prepend(sprite)                // 挂在 body 头部，隐藏
    return () => { sprite.remove() }             // 插件卸载时移除
  }, 'ui-theme: icon sprite')
  ctx.on('theme/change', snapshot => apply(snapshot.active.icons))
}
```

关键点：
- sprite 是隐藏 `<svg>`（`position:absolute;width:0;height:0;overflow:hidden`），`data-dsh-icon-sprite` 标记。
- `toSymbol` 把每个 SVG 转成 `<symbol id="dsw-icon-...">`，去掉 `width/height/xmlns/class/aria-hidden` 这些"单次渲染"属性，保留 `viewBox`、`stroke` 等几何属性。
- `theme/change` 事件到来时用 `replaceWith` 热替换 symbol，**无需刷新页面**。
- 插件 fiber 卸载时 `sprite.remove()` 清理。

### 8.4 显示的本质

组件里的 `<use href="#dsw-icon-xxx">` 引用隐藏 sprite 的 symbol，`currentColor` 和 CSS 变量在**使用点**生效——这就是图标能跟随主题变色的原因。

## 第 9 章 插件如何提供图标

| 方式 | 机制 | 实例 |
|---|---|---|
| **直接复用全局图标**（绝大多数） | `import { IconCopyOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'`，用编译期具名组件 | `ui-tool`、`ui-sidebar`、`ui-approval` |
| **注册图标组件到 keyed slot** | `ctx.slots.inject('contextMenu.icon', ...)`，key 为动作 id，value 为图标组件 | `ui-workspace`、`ui-file-actions`、`ui-open-in-app` |
| **面板类图标 slot** | `sidebar.panellist`（register 时直接传图标组件）、`sidebar.panel.icon`（factory）、`settings.section.icon` | `ui-plugin-manager`、`ui-schedule`、`ui-sidebar-right` |
| **主题替换已有 symbol** | `ThemeDefinition.icons` → `validateIcons()` 校验 → `theme/change` 触发 `apply()` 的 `replaceWith` | 第三方主题 |

### 9.1 插件注册自己的图标到 slot（实证）

`E:/deepseek-harness/packages/client/ui-file-actions/src/client/index.ts:31-36`：

```ts
child.slots.inject('contextMenu.icon', function* () {
  for (const [key, Icon] of Object.entries({
    'file-actions.copy': IconCopyOutlineRegular, 'file-actions.download': IconDownloadOutlineRegular,
    'file-actions.save': IconSaveOutlineRegular,
  })) yield child.slots.register({ name: 'contextMenu.icon', key }, Icon)
})
```

`E:/deepseek-harness/packages/client/ui-plugin-manager/src/client/index.ts:167-173`：

```ts
yield ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
  name: 'sidebar.panellist',
  id: PANEL_ID,
  order: 0,
  label: () => t('panel'),
  locale: NS,
}, PluginsPanelIcon))
```

其它实例：
- `E:/deepseek-harness/packages/client/ui-workspace/src/client/index.ts:325-333,337-342`（全局 Icon 注册到 `contextMenu.icon`）
- `E:/deepseek-harness/packages/client/ui-open-in-app/src/client/index.ts:64-70`；`context-menus.tsx:218-223`（动态 `<img>` 回退）
- `E:/deepseek-harness/packages/client/ui-sidebar-right/src/client/index.ts:138-139`（`sidebar.close` key）
- `E:/deepseek-harness/packages/client/ui-plugin-manager/src/client/PluginsPanelIcon.tsx:13-15`（panellist + 全局 Icon 包装）
- `E:/deepseek-harness/packages/client/ui-schedule/src/client/TaskManagerIcon.tsx:14-16`（同上）
- `E:/deepseek-harness/packages/client/ui-tool/src/client/apply.ts:30-57`；`tool/toolviews/details-row.tsx:30-38`；`GenericToolCard.tsx:19-25`；`search-row.tsx:2,27`（tool view 按数据选全局 Icon，无注册）
- `E:/deepseek-harness/packages/client/ui-approval/src/client/ApprovalWarning.tsx:5,85`（直接使用）

### 9.2 动态图标（按数据决定显示哪个）

| 组件 | 机制 | 绝对路径 |
|---|---|---|
| `FileTypeIcon` | 按文件扩展名直绘 SVG 类型徽标 | `E:/deepseek-harness/packages/client/ui-primitives/src/FileTypeIcon.tsx:49-112,138-148,156-170,198-285` |
| `LinkIcon` | URL 链接图标，`PhotoGlyph` 为内联图片字形 | `E:/deepseek-harness/packages/client/ui-primitives/src/LinkIcon.tsx:33-52,54-76,89-118` |
| `SiteGlyph` | 站点 logo，基于 `simple-icons` 数据表 | `E:/deepseek-harness/packages/client/ui-primitives/src/SiteGlyph.tsx:55-96,103-122,139-149` |
| `shared-artwork.tsx` | 复合图标共享轮廓路径 | `E:/deepseek-harness/packages/client/ui-primitives/src/icons/shared-artwork.tsx:13-46` |

### 9.3 主题替换接口（`ThemeDefinition.icons`）

`E:/deepseek-harness/packages/client/ui-theme/src/client/index.ts`：

- `ThemeDefinition.icons: IconReplacements` 是 `Readonly<Partial<Record<IconSymbolId, string>>>`（`icon-sprite.ts:12`）。
- `ThemeRuntime.register(definition)` 在 `:354-359` 校验并注册主题；`validateIcons(definition)` 在 `:525` 起校验图标替换：
  - 只接受已知的 `IconSymbolId`（未知 id 抛 `TypeError`）
  - 拒绝无 SVG 命名空间的 `<svg viewBox>` 之外的文档
  - 拒绝 `<style>` / `<script>`
  - 拒绝 symbol 自身命名空间之外的 element id
- 公开 API 目录佐证：`E:/deepseek-harness/packages/extensions/cordis-client-runner/src/client/api-catalog.ts:659-660,1072`（`IconReplacements`、`ThemeDefinition.icons`）；`E:/deepseek-harness/packages/client/ui-primitives/src/index.ts:65-70,129-133`（导出面）。

> **重要限制**：插件**不能新增 sprite symbol**。`ThemeDefinition.icons` 只接受已有 `IconSymbolId` 的替换，所以自定义图标只能是「换皮已有图标」或「注册自己的 React 图标组件到 slot」。

## 第 10 章 不走 sprite 的私有图标体系

- `FileTypeIcon`（`ui-primitives/src/FileTypeIcon.tsx`）：按扩展名直绘 SVG 类型徽标，与 sprite/换肤无关。
- `LinkIcon` + `SiteGlyph`（`LinkIcon.tsx`、`SiteGlyph.tsx`）：站点 logo 用 `simple-icons` 数据表直绘。
- `PixelWhale`（`ui-brand-official/.../PixelWhale.tsx`）：首页鲸鱼是 canvas 逐帧绘制，CSS 标记 `data-home-whale`。
- 内联 `<svg>`：发送箭头、停止方块、发送中 spinner、语音波形直接写在 `InputBar.tsx` 和 `VoiceInput.tsx` 里。

## 第 11 章 内容注入：Slot 系统

### 11.1 Slot 注册中心

`E:/deepseek-harness/packages/client/ui-renderer/src/client/registry.ts` 的 `SlotRegistry` 提供三类注册：

```ts
slots.register({ name, key/id/order, locale?, ... }, ReactComponent)  // 普通/keyed
slots.registerSlotChain(name, ...)                                    // 链式
slots.registerFactorySlot(name, ...)                                  // 工厂
```

React 侧由 `scoped-slots.tsx` 的 `renderSlot` / `renderSlotChain` / `renderFactorySlot` 在组件树里渲染。scoped 绑定会把 `ctx` 服务（如 `t`、`host`）自动注入组件 props（`scoped-slots.tsx:604-613`）：

```ts
if (entry.locale !== undefined) {
  const face = host.locale
  if (face === undefined) throw new SlotAssemblyError(...)
  kit['t'] = localeSeat(face, entry.locale)
}
```

Factory 同理（`scoped-slots.tsx:908-915`）。语言切换时 `useLocaleRevision` 让所有 outlet 重渲染（`scoped-slots.tsx:1333-1335`）。

renderer 侧安装：`E:/deepseek-harness/packages/client/ui-renderer/src/client/index.ts:30-63`；scoped bindings：`E:/deepseek-harness/packages/client/ui-renderer/src/client/bindings.tsx:14-70`。设计文档：`E:/deepseek-harness/packages/client/ui-slots/README.zh.md:28,48,58-66`。

### 11.2 keyed slot / factory slot 的派发

| Slot | 派发维度 | 注册例 | 派发点 |
|---|---|---|---|
| `conversation.chat.node` | 节点 `NodeKey`（user/assistant/tool/command/compaction…） | `ui-chat/.../register-node-renderers.ts:27-102` | `ui-chat/.../ChatNodeSeat.tsx:150-176` |
| `tool.call.toolview` | 工具名（`bash`/`read`/`web_search`…） | `ui-tool/.../toolviews/read-row.tsx:25-33` | `ui-tool/.../ToolCallTree.tsx:45-56` |
| `conversation.images.content` | Content Factory（按图片来源） | `ui-attachment/.../client/index.ts:23-29` | `MessageImages.tsx:28-34`（AssistantMarkdown 的 image slot） |
| `conversation.view` | 视图 tab | `ui-chat/src/client/apply.ts` | `ConversationSession` |

slot 类型声明：`E:/deepseek-harness/packages/client/ui-chat/src/client/contract/slots.ts:443-455`；`E:/deepseek-harness/packages/client/ui-tool/src/client/contract/slots.ts:15-41`；`E:/deepseek-harness/packages/client/ui-conversation/src/client/contract/slots.ts:199-217`。

### 11.3 以工具卡为例的完整链路

```
ui-tool apply()
  → slots.inject('tool.call.toolview', ...)
      → register({ key: 'bash' }, BashRow)
  → ChatView → ChatFlow → ChatNodeSeat 遇到 tool node
  → conversation.chat.node renderer → ToolCallTree
  → ToolCallTree 读 tool.name='bash'，renderSlot('tool.call.toolview', { key: 'bash' })
  → BashRow 被渲染，读 ctx 服务拿到状态并画卡片
```

### 11.4 插件生命周期与 ctx 服务

- patch 声明：`E:/deepseek-harness/packages/bundle/web-app/cordis.patch.yml`（:260-380）
- patch 组合：`E:/deepseek-harness/packages/boot/plugin-manager/src/index.ts:20-27`，`E:/deepseek-harness/packages/boot/app-boot/README.zh.md:69`
- 浏览器启动：`E:/deepseek-harness/packages/client/web/src/boot-client.ts:59-80`
- entry 创建：`E:/deepseek-harness/packages/client/modules/src/client/entries.ts:89-104,184-192`
- 模块系统：`E:/deepseek-harness/packages/client/modules/src/client/manifest.ts:1-29,41-45`，`system.ts:250-276`
- ui-chat apply：`E:/deepseek-harness/packages/client/ui-chat/src/client/apply.ts:79-83,89,225-249`
- ui-tool apply：`E:/deepseek-harness/packages/client/ui-tool/src/client/apply.ts:24-57`
- SlotRegistry 实现：`registry.ts:120-162,164-181,209-271,382-396,475-531,740-754`
- renderSlot 实现：`scoped-slots.tsx:72-158,591-673,1321-1509,1577-1591`

`ctx`（Cordis Context）通过 `ctx.provide('xxx', service)` 提供服务（如 `ui-file-actions` 的 `fileActions`），通过 `ctx.inject(['service1', ...], child => ...)` 声明依赖并拿到子 context，通过 `ctx.effect(fn, 'label')` 管理生命周期（返回 disposer）。

## 第 12 章 i18n 文本注入

`E:/deepseek-harness/packages/client/locale/src/client/index.ts` 的 `LocaleRuntime` 用 `Map<namespace, Map<locale, dict>>` 存储：

- `register(ns, {...})` 拒绝同一 `(ns, locale)` 重复注册（单一拥有者，`:420-422`），注册后 bump revision，让已挂载 outlet 取到新词典（`:425`）。
- `bind(ns)` 返回按 ns 缓存、身份稳定的 `t` 函数（`:460-467`）。
- `translate(ns, key, params)` 先查本 ns 的 fallback 链，未命中再查共享 `common` 命名空间，仍无则回显 key（`:470-478`）：

```ts
private translate(ns, key, params?) {
  const chain = this.fallbackChain(this.snapshot.active)
  const template = this.lookup(ns, key, chain)
    ?? (ns !== COMMON_NS ? this.lookup(COMMON_NS, key, chain) : undefined)
    ?? key
  ...
}
```

- `NS` 定义在包内 `locale.ts`（如 `ui-chat/src/client/locale.ts:4` 的 `export const NS = 'chat'`），slot 注册时带 `locale: NS`，渲染器自动注入 `t`。
- 类型层：`LocaleNamespaceMap` 由各包 `declare module` 合并（locale 的 `index.ts:43` 及其消费方），`PropsLocale<'chat'>` 之类别名把 `t` 约束到该 NS 的 key 联合。
- 注册实例：`E:/deepseek-harness/packages/client/ui-file-actions/src/client/index.ts:30` — `child.effect(() => child.locale.register('fileActions', { zh, en, ja, es, fr, de, ru, pt }), 'file actions: locale')`。
- 语言切换由 `useLocaleRevision` 触发所有 outlet 重渲染。

关键路径：i18n 运行时 `E:/deepseek-harness/packages/client/locale/src/client/index.ts:390-478,586-595`；`ui-chat/src/client/locale.ts`；`ui-chat/src/client/apply.ts:140-141`。

## 第 13 章 样式注入

### 13.1 构建期：CSS 变成模块 metadata

`E:/deepseek-harness/packages/client/tsdown.client.ts:1-15` 的 doc 说明：`x.module.css` 编译为哈希 class map；普通全局 CSS import（如 ui-theme 的 `styles/*.css`）不作为运行时 import，而作为该 chunk 的**延迟样式表文本**收进 metadata：

```
each output chunk exposes deferred stylesheet text through its metadata factory.
`x.css?inline` exports compiled text without registering a resource.
```

关键实现（同文件 `:517-523`）：

```ts
const resources = Object.keys(chunk.modules).flatMap(module => {
  const style = styles.get(module)
  ...
})
const metadata = resources.length === 0 ? '' : `, meta: () => ({ stylesheets: {${resources.join(',')}} })`
```

即打包产物调用 `window.__ModuleLoader__.load({ id, factory, meta })`，`meta()` 返回 `{ stylesheets: { [path]: { text(...) } } }`。样式按「拥有它的包 + 包内路径」命名（`:70-91` 的 `compiledClientStyle`）。

### 13.2 运行期：DocumentStyles 是文档样式的拥有者

`E:/deepseek-harness/packages/client/ui-renderer/src/client/styles/document-styles.ts:25-33`：

> Materialized module styles installed synchronously in the main document. Each style element carries `data-plugin` with the owning package and `data-path` with the stylesheet's path within that package.

`DocumentStyles.mount()` 订阅 `modules.subscribeModules` 并立即 `refresh()`（`:48-60`）；`refresh()` 把每个活跃 module record 的 `record.meta().stylesheets` 文本取出来（`:74-96`），按包 + 路径去重、按依赖顺序排序（`:98-153`），为每个样式创建 `<style data-plugin=... data-path=...>` 插入文档（`:155-188`）：

```ts
const element = this.container.ownerDocument.createElement('style')
element.setAttribute('data-plugin', owner)
element.setAttribute('data-path', path)
element.textContent = css
this.container.insertBefore(element, anchor)
```

挂载时机在 `UiRenderer.mount`（`renderer.ts:64-73`）：

```ts
mount(container: HTMLElement): () => void {
  const mounted: RendererMount = {
    styles: new DocumentStyles(container.ownerDocument.head, this.ctx.modules),
  }
  ...
  mounted.styles.mount()
  const root = mountApp(container, buildRenderApp({ ctx: this.ctx }))
```

即容器是 `document.head`，renderer 生命周期内拥有所有模块样式，卸载时 `styles.dispose()` 移除全部 `<style>`（`:97-113`）。

### 13.3 ui-theme 全局样式

ui-theme 的 client 入口 import 全部主题样式（`E:/deepseek-harness/packages/client/ui-theme/src/client/styles.ts:1-10`）：

```ts
/** Theme CSS is compiled into module resources; DPR presentation follows the plugin lifetime. */
import '../styles/base.css'
import '../styles/corner-shape.css'
import '../styles/design-platform.css'
import '../styles/focus.css'
import '../styles/onboarding.css'
import '../styles/scrollbar.css'
import '../styles/gradient-shadow-text.css'
import '../styles/shiki.css'
```

这些 import 经 13.1 的构建流程进入 ui-theme chunk 的 `meta().stylesheets`，再由 13.2 的 `DocumentStyles` 注入 `<head>`，`data-plugin="@deepseek-ai/dsh-client-ui-theme"`。此外 `installThemeStyles(ctx)`（`styles.ts:18-40`）按 DPR 在 `document.documentElement` 上设置 `--dsh-hairline-width` 之类的内联 CSS 变量，随插件 fiber 生命周期清理。主题运行时本身（`ui-theme/src/client/index.ts`）提供 token 覆盖与字体 / 外观设置行。

### 13.4 `.module.css` 与样式归属

组件里 `import css from './X.module.css'`（如 `ToolCallTree.tsx:7` 的 `import css from './ToolCallTree.module.css'`）由 lightningcss 编译为哈希 class map 直接内联进 JS（`tsdown.client.ts:5-8`），不进 `DocumentStyles`；`"stylesheet has no package owner"` 错误见 `:91`。全局 CSS 以「拥有者包 + 路径」为键，冲突时后者被拒并打印 console（document-styles.ts:142-146），保证「文档样式拥有者」语义清晰。

## 第 14 章 关键路径速查表

| 主题 | 绝对路径 |
|---|---|
| patch 声明 | `E:/deepseek-harness/packages/bundle/web-app/cordis.patch.yml`（:260-380） |
| patch 组合 | `E:/deepseek-harness/packages/boot/plugin-manager/src/index.ts:20-27`，`E:/deepseek-harness/packages/boot/app-boot/README.zh.md:69` |
| 浏览器启动 | `E:/deepseek-harness/packages/client/web/src/boot-client.ts:59-80` |
| entry 创建 | `E:/deepseek-harness/packages/client/modules/src/client/entries.ts:89-104,184-192` |
| 模块系统 | `E:/deepseek-harness/packages/client/modules/src/client/manifest.ts:1-29,41-45`，`system.ts:250-276` |
| ui-chat apply | `E:/deepseek-harness/packages/client/ui-chat/src/client/apply.ts:79-83,89,225-249` |
| ui-tool apply | `E:/deepseek-harness/packages/client/ui-tool/src/client/apply.ts:24-57` |
| SlotRegistry | `E:/deepseek-harness/packages/client/ui-renderer/src/client/registry.ts:120-162,164-181,209-271,382-396,475-531,740-754` |
| renderer 安装 | `E:/deepseek-harness/packages/client/ui-renderer/src/client/index.ts:30-63` |
| renderSlot 实现 | `E:/deepseek-harness/packages/client/ui-renderer/src/client/scoped-slots.tsx:72-158,591-673,1321-1509,1577-1591` |
| scoped bindings | `E:/deepseek-harness/packages/client/ui-renderer/src/client/bindings.tsx:14-70` |
| slot 类型声明 | `ui-chat/src/client/contract/slots.ts:443-455`；`ui-tool/src/client/contract/slots.ts:15-41`；`ui-conversation/src/client/contract/slots.ts:199-217` |
| node renderer 注册 | `E:/deepseek-harness/packages/client/ui-chat/src/client/chat/register-node-renderers.ts:27-102` |
| toolview 注册 | `E:/deepseek-harness/packages/client/ui-tool/src/client/tool/toolviews/read-row.tsx:25-33` |
| keyed 派发点 | `ui-chat/.../ChatNodeSeat.tsx:150-176`；`ui-tool/.../ToolCallTree.tsx:45-56` |
| Content Factory | `ui-attachment/.../client/index.ts:23-29`；`MessageImages.tsx:28-34` |
| i18n | `E:/deepseek-harness/packages/client/locale/src/client/index.ts:390-478,586-595`；`ui-chat/src/client/locale.ts`；`ui-chat/src/client/apply.ts:140-141` |
| 样式拥有者 | `E:/deepseek-harness/packages/client/ui-renderer/src/client/styles/document-styles.ts:25-188`；`renderer.ts:64-113`；`tsdown.client.ts:1-15,517-523`；`ui-theme/src/client/styles.ts:1-40` |
| 设计文档 | `E:/deepseek-harness/packages/client/ui-slots/README.zh.md:28,48,58-66` |
| 图标数据 | `E:/deepseek-harness/packages/client/ui-primitives/src/icons/artwork.ts` |
| 图标组件与 use | `E:/deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx` |
| sprite 注入与主题热替换 | `E:/deepseek-harness/packages/client/ui-theme/src/client/icon-sprite.ts` |
| 主题定义与图标校验 | `E:/deepseek-harness/packages/client/ui-theme/src/client/index.ts`（`validateIcons` :525） |
| 插件注册自己的图标 | `ui-file-actions/src/client/index.ts:31`、`ui-plugin-manager/src/client/index.ts:167` |

---

# 附录

## 附录 A 路径前缀表

本文表格中使用的路径前缀展开如下（均为绝对路径）：

| 前缀 | 展开的绝对目录 |
|---|---|
| `CHAT` | `E:/deepseek-harness/packages/client/ui-chat/src/client/` |
| `TOOL` | `E:/deepseek-harness/packages/client/ui-tool/src/client/` |
| `ATTACH` | `E:/deepseek-harness/packages/client/ui-attachment/src/` |
| `DELIV` | `E:/deepseek-harness/packages/client/ui-deliverables/src/client/` |
| `FEEDBACK` | `E:/deepseek-harness/packages/client/ui-message-feedback/src/client/` |
| `PRIM` | `E:/deepseek-harness/packages/client/ui-primitives/src/` |
| 其它 | 直接写完整绝对路径 |

## 附录 B E2E 测试佐证

以下测试文件在分析中作为「真实聊天页行为」的佐证被引用（非源码主体）：

| 测试文件 | 佐证内容 |
|---|---|
| `apps/web/tests/message-actions.e2e.ts` | 消息操作行（复制 / 分支 / 反馈）实际渲染验证 |
| `apps/web/tests/message-feedback.e2e.ts` | 点赞 / 点踩按钮验证 |
| `apps/web/tests/icon-skin.e2e.ts:10` | 明确引用 `dsw-icon-search-outline-regular` symbol id |
| `apps/web/tests/home-whale.e2e.ts:27,40` | 明确验证 `[data-home-whale]` canvas |
| `apps/web/tests/chat-scroll-contract.e2e.ts`（101KB） | 聊天滚动契约 |
| `apps/web/tests/chat-flow-layout.e2e.ts` | 聊天流布局 |
| `apps/web/tests/chat-fold-opened-group.e2e.ts` | 分组折叠 |
| `apps/web/tests/chat-continuous-conversation.e2e.ts` | 连续会话 |
| `apps/web/tests/chat-long-interactions.e2e.ts` | 长交互 |
| `apps/web/tests/code-card-layout.e2e.ts` | 代码卡片布局 |
| `apps/web/tests/clickable-links-gallery.e2e.ts` | 可点击链接画廊 |
| `apps/web/tests/changed-files-turn.e2e.ts` | 变更文件 turn |

## 附录 C 常见误解澄清

| 常见表述 | 源码真相 |
|---|---|
| 「已深度思考」 | 代码中不存在，实际是 `message.think` = **思考 / Think**（`ui-chat/src/client/locale.ts`） |
| 「思考中」 | 实际为进行态步骤文案 `message.stepProcess.thinking` = **正在分析请求 / Analyzing the request**（`ui-chat/src/client/locale.ts`） |
| 「复制代码」 | `code.copySource` = 复制代码 / Copy code（`ui-trajectory/src/client/locales.ts`） |
| 「生成图片」 | 代码中不存在该短语；图片相关文案为 `image.*` 系列（原图、查看原图、图片加载失败…）和 `image.sendFailed`（`ui-conversation/src/client/locales.ts`） |
| 「深度求索」 | 即 `chat.deepDiving` / `chat.deepDivingFor`（`ui-chat/src/client/locale.ts`），状态栏和底部运行提示 |
| Mermaid 渲染 | DSH 聊天页 Markdown **不含 mermaid**；公式用 KaTeX，代码高亮用 shiki |
| 独立 MCP 卡 / 图片生成卡 | 未发现独立命名的卡片；由通用 `GenericToolCard` / `read_image` / `DetailsRow` 承担 |

---

> **文档完**。本文为静态源码清点结果，所有需真机验证的 GUI 行为以用户实机观测为准；AI 不代跑 GUI、不模拟 DSH 会话、不以代码推断观测结论。
