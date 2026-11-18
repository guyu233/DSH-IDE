# DSH-IDE 审计总摘要

唯一生效的审计结论在本文。其它文档只保留链接。

当前基线：`c3bdf2ec`。访问日期 2026-11-18。

## 当前总摘要

健康度：`npm run compile` 0 error；`verify:dsh-ide-ci` 五项 PASS（`DSH_INSTALLED_VERSION=0.2.2-rc.3`）；node 测试 413、mocha 7、fail 0。覆盖率没有命令。全仓 ESLint 未作为通过项。真机界面未验。`verify:dsh-install-drift` 仍对 2026-11-17 的旧 Host 产物失败，开发期不打包。

最危险的 3 件事：

1. 安装漂移未重新打包，真机用的 Host 半身可能不是当前源码。
2. 首次开窗把工作区放在 `--` 后面。普通目录是否仍被打开，要真机看一次。
3. 删除成功后若下一次 `listSessions` 仍带回该 id，行会再出现。这是有意的。

下一步 3 件事：

1. 真机点一次开窗，并点一次被拒绝的批准，确认卡片回来。
2. 开发完成后重新打包，再跑 `verify:dsh-install-drift`。
3. 收藏/置顶没有原生行字段。找不到就保持现状，不另画标记。

## 决策台账

| ID | 主题 | 结论 | 依据 | 范围 | 状态 | 回滚 |
|---|---|---|---|---|---|---|
| DEC-007 | 批准/问卷失败 | 先拿掉卡片，避免连点。通道返回失败才放回原卡。换会话，或该 eventId 已有新卡，不写回 | `dshChatSession.ts` `restorePending` | 聊天待决议 | 生效 | `git revert c3bdf2ec` |
| DEC-006 | 开窗参数 | 首次 `spawn` 的位置参数是 `['--', workspace]`。空路径不传参数。已打开的窗口仍用 `URI.file` | `ide-service.js` 只一处 `spawn(home.exe)` | Host 拉起 IDE | 生效 | `git revert 88b1b159` |
| DEC-001 | 流式临时节点 | 正常 end 后节点先留着；同回合 `assistant/message` 写入后删掉。`abandoned` 立刻删。空内容的正式消息不接管 | `dshIdeConversation.ts` `retireTurnStreams` | 会话投影 | 生效 | `git revert 40de7e42` |
| DEC-002 | 审计文档 | 结论只写本文 | 禁止两份生效清单 | 文档 | 生效 | 从 git 历史恢复旧摘要 |
| DEC-003 | 切会话不取消批准 | `rebind` 不调用 `cancelRequest` | 旧会话仍可能被桌面端回答 | Host 视图 | 生效 | 不引入取消 |
| DEC-004 | 删除后不立刻拉名单 | 只从当前树摘行，子会话升到原位 | `deleteChatSessionItem` | 会话列表 | 生效 | `git revert 1d3f4cf2` |
| DEC-005 | 不做的原生部件 | 不做 planReview、changesSummary、multiDiffData、confirmation、questionCarousel、working、附件 chip | 原生回传或 history 类型接不住 | 聊天历史 | 生效 | 不单开这些部件 |

冲突检测：DEC-007 不改 Host 的批准协议，也不在 `rebind` 时取消请求（DEC-003）。失败放回只发生在同一代次、同一会话、且该 eventId 还空着。

## 问题总表

| ID | 状态 | 位置 | 类型 | 证据 | 处理 |
|---|---|---|---|---|---|
| BUG-003 | 已闭环 | `dshChatSession.ts` `answerApproval` / `answerQuestion` | 状态不一致 | 卡片在 `await` 之前删除，通道失败后不再出现。检索这两个方法名，渲染层各 1 处定义，已改 | 失败且仍是当前会话时放回原卡。测试 `a rejected approval puts the card back` |
| SEC-002 | 已闭环 | `ide-service.js` `spawn(home.exe, args)` | 启动参数 | 以 `-` 开头的 cwd 会被当成开关。`spawn(home.exe` 命中 1 处 | `88b1b159` |
| BUG-001 | 已闭环 | `dshIdeConversation.ts` 流式 end | 内容重复 | end 移走 attempt 后正式消息清不掉临时节点 | `40de7e42` |
| BUG-002 | 已闭环 | 绑定、发送、换模型、归档、未读、开窗 sessionId、composer、custom、vendor、名单通知、steering、删除摘行 | 竞态 / 状态 | `1d3f4cf2`、`2126de72`、`245a025b`、`c6b514dd` | 保持测试 |
| SEC-001 | 存疑保留 | `inlineCompletion.ts` 调用 `ide/inlineComplete` | 不在 43 个契约方法里 | 通道拒绝未知 method，结果是无补全 | 不绕过校验，不加第 44 个方法 |
| OPT-001 | 存疑保留 | `acceptConversation` 每帧清空再重建 | 性能 | 没有基准数字 | 没有测量前不改 |
| CLN-001 | 已闭环 | 死模块、断链脚本、零引用导出 | 瘦身 | 删除前做过引用检索。许可证未动 | 依赖 68→66，dev 100→93，scripts 86→79，锁 1649→1536 |
| CLN-002 | 仍存在 | 新的零引用符号 | 瘦身 | 本轮没有可证明零引用的新符号 | 不删 |

## 瘦身报告

本轮没有删除文件，没有改依赖，没有改产物体积。

| 项 | 之前 | 现在 |
|---|---|---|
| dependencies | 68 | 66 |
| devDependencies | 100 | 93 |
| scripts | 86 | 79 |
| 锁文件条目 | 1649 | 1536 |
| tsc 错误 | 137 | 0 |
| node 测试 | 384 | 413 |
| mocha | 7 | 7 |

## 存疑保留

- `agentsWindow` 配置仍被代码读，不删。
- 上游 `it.skip` 的 smoke 不启用。
- `build/next` 的 watch 在非仓库根可能监听空目录。
- 已有窗口的会话 URI 与 `dshSessionResource` 写法相同，但没有抽成同一个函数。
- 收藏、置顶没有原生行字段。

## 假设与待验证

- 【事实】通道返回 `ok: false` 时，批准卡回到原来的 eventId。
- 【事实】等待期间换了会话，失败回包不会把旧卡写到新会话。
- 【待验证】真机上 Host 拒绝批准后，卡片是否重新可点。
- 【待验证】普通目录放在 `--` 后面之后，首次开窗仍打开该文件夹。
- 【推断】空内容的 `assistant/message` 不接管临时节点，是为了留下已经流出来的文字。本轮未改。

## 验证结果

| 门禁 | 改前 | 改后 |
|---|---|---|
| `npm run compile` | 0 error | 0 error |
| `verify:dsh-ide-ci` | 五项 PASS，node 411 | 五项 PASS，node 413，mocha 7，fail 0 |
| 覆盖率 | 无命令 | 未跑 |
| 全仓 ESLint | PENDING | PENDING |
| 真机 GUI | PENDING | PENDING |
| `verify:dsh-install-drift` | FAIL，预先存在 | 未打包，仍 FAIL |

安全：本轮没有放宽校验或鉴权。

## 风险与回滚

| 风险 | 回滚 |
|---|---|
| 失败放回的卡片若和 Host 稍后推来的新卡交错，可能闪一下 | `git revert c3bdf2ec` |
| 成功的批准仍会拿掉卡片，这条没变 | 同上 |

## 手册增补

不新增第二套批准路径。按钮仍走 `dsh.answerApproval` / `dsh.answerQuestion`。失败恢复只在会话状态层。

## 全局路线图

1. 正确性：投影、列表、开窗、待决议继续用回归测试钉住。
2. 安全：契约仍是唯一调用面。开窗 argv 已收口。行内补全不绕过校验。
3. 体积：依赖不再增加。
4. 验证：真机看开窗和被拒绝的批准。开发完成后打包再验漂移。

## 信息缺口

没有覆盖率基线。没有本轮全仓 SAST/SCA。没有真机观察。

## 状态对照

已闭环：BUG-003、SEC-002、BUG-001、BUG-002、CLN-001、DEC-007。

仍存在：SEC-001、OPT-001、CLN-002、安装漂移、真机未验、收藏/置顶无星标、删除后旧名单可能把行画回来。

新引入：无。

## 变更表

| 日期 | ID | 状态 | 提交 |
|---|---|---|---|
| 2026-11-18 | BUG-003、DEC-007 | 已闭环 | `c3bdf2ec` |
| 2026-11-18 | SEC-002、DEC-006 | 已闭环 | `88b1b159` |
| 2026-11-18 | BUG-001、DEC-001 | 已闭环 | `40de7e42` |
| 2026-11-18 | DEC-002 | 已闭环 | `041d17ed` |
| 2026-11-18 | DEC-004 | 已闭环 | `1d3f4cf2` |
| 2026-11-18 | 名单通知、开头 steering | 已闭环 | `2126de72` |
