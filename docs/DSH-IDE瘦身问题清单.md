# DSH-IDE 问题摘要

只保留还成立的问题和已经落地的修法。不再按轮次重复记录。判定过又撤回的项不列在这里。

## 已修

| 位置 | 类型 | 依据 | 修法 |
|---|---|---|---|
| `dshChatSession.ts` 的 `bind` / `submit` / `selectModel` / `refreshComposer` | 竞态 | await 之后无条件写本地状态，会覆盖新会话 | 先对代次和会话 id |
| `dshAgentSessionsController.ts` 刷新与归档 | 状态不一致 | 刷新丢掉归档标志，旧名单回包盖住新名单 | 代次作废旧刷新；归档回包保存完整 id 集合 |
| `toSessionItem` / `appendDeliverables` | 内容丢失 | 刷新冲掉已读；绝对路径点不开 | 时间戳变大才标未读；绝对路径用 `URI.file` |
| `dshIdeLaunchListener.ts`、`app.ts` | 逻辑错误 | 已开窗口的开窗请求丢掉 `sessionId`，只聚焦 | 转发非空 `sessionId`，用 `vscode:openChatSession` 绑定 |
| `dshSessionMenu.ts` 归档 | 状态不一致 | 右键滤掉原生恢复；自定义归档不写 `archivedIds` | 归档和恢复都走 `setChatSessionItemArchived` |
| `dshComposerSource.ts` `write` | 竞态 | 写成功后的刷新复用写前的 `composerState` | 写成功先作废在途读取 |
| `toPermissionItems` | 状态不一致 | `custom` 被滤掉后，当前值是 custom 时没有选中项 | 仅当前已是 custom 时插回显示 |
| `dshLanguageModelProvider.ts` | 逻辑错误 | 每次刷新都再次登记 vendor | 记住已登记项，dispose 时撤掉 |
| `ide-view-host.js` 重命名 / 移动 / 新建 / 收藏 / 置顶 | 状态不一致 | 这些调用不一定发出 `api-session/added\|removed`，面板不更新 | 成功后 fanout `session-list`。失败不发。删除不发 |
| `dshChatHistory.ts` steering / 子智能体通知 | 内容丢失 | 还没有用户消息时 `pending` 为空，末尾 flush 直接返回 | 先开一条空 prompt 的回复再写入 |
| `dshSessionMenu.ts` 删除 / `deleteChatSessionItem` | 状态不一致 | 删除成功后名单不立刻重拉，行会留着；立刻重拉又会把旧名单里的行画回来 | 成功后只从当前树拿掉这一行，子会话升到原位置。不调用 listSessions |

## 不改

| 项 | 原因 |
|---|---|
| `planReview` / `changesSummary` / `multiDiffData` / confirmation / questionCarousel / `working` / 附件 chip | 原生部件的点击回传或 history 类型接不住 DSH 的数据 |
| `rebind` 时取消旧会话的批准 | 会话还在跑，切走不应该结算那次批准 |
| 快照里的 `goal.activation` | 官方快照 schema 没有这个字段 |
| `todosOf` 遇到坏项就整表缺席 | 缺席表示保留，不把坏帧当成清空 |
| 会话树纯环 | 补根后仍留一个 root，现有测试要求不丢 |
| 搜索结果被读空 | `client.call` 的 `value` 已经是 `{items, hasMore}` |
| 团队开关失败被吞 | 写失败后会读回状态并提示 |
| 删除后立刻刷新名单 | 名单最终一致，立刻刷新会把刚删的行画回来 |
| 菜单命令的 dispose | 每个窗口只注册一次 |

## 仍开放

收藏和置顶没有单独的行字段，刷新名单也不会多出一个星标。删除后如果下一次 `listSessions` 仍带回这个 id，行会再出现，这表示 Host 名单还没丢掉它。`build/next` 的 watch 在非仓库根启动时可能监听空目录，改动需要长驻验证。`verify:dsh-install-drift` 仍对旧产物失败，要等开发完成后打包再验。
