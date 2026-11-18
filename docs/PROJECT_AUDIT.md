# DSH-IDE 审计总摘要

唯一生效的审计结论在本文。其它文档只保留链接。

当前基线：`8915453f`。访问日期 2026-11-18。

## 当前总摘要

健康度：`npm run compile` 0 error（1.33 min）；`verify:dsh-ide-ci` 五项 PASS（`DSH_INSTALLED_VERSION=0.2.2-rc.3`）；node 测试 416、mocha 7、fail 0。覆盖率没有命令。全仓 ESLint 未作为通过项。真机界面未验。`verify:dsh-install-drift` 仍对 2026-11-17 的旧 Host 产物失败，开发期不打包。

最危险的 3 件事：

1. 安装漂移未重新打包，真机用的 Host 半身可能不是当前源码。
2. 首次开窗把工作区放在 `--` 后面。普通目录是否仍被打开，要真机看一次。
3. 删除成功后若下一次 `listSessions` 仍带回该 id，行会再出现。这是有意的。

下一步 3 件事：

1. 真机在开窗完成前点另一条会话，确认不会被开窗回包拉回去。
2. 开发完成后重新打包，再跑 `verify:dsh-install-drift`。
3. 收藏/置顶没有原生行字段。找不到就保持现状，不另画标记。

## 决策台账

| ID | 主题 | 结论 | 依据 | 范围 | 状态 | 回滚 |
|---|---|---|---|---|---|---|
| DEC-010 | 停止请求 | `interrupt` 必填 `sessionId`。Host 只在仍绑定该会话时 `cancel`。已经换绑则拒绝，不停新会话。方法数仍是 43。取代上一轮「不加 sessionId」的暂缓 | `dshIdeProtocol.ts` `interrupt`；`ide-view-host.js` `assertOwnership` | 聊天停止 | 生效 | `git revert 8915453f` |
| DEC-009 | 收藏/置顶切换 | 同一会话的收藏、置顶各自排队。下一次读取发生在上一次写入返回之后。契约仍只传 sessionId，由 Host 按当前状态切换 | `ide-view-host.js` `enqueueToggle`。检索 `favoriteSessions()` 与 `pinnedSessionIds`，各 1 处读取 | Host 会话操作 | 生效 | `git revert 051dd6dd` |
| DEC-008 | 开窗回包绑定 | `attach` 只在 `generation` 仍为 0、且没有绑定、也没有正在进行的 `bind` 时登记开窗会话。用户已经换过会话就返回 | `dshChatSession.ts` `attach`。`generation` 只在 `bind` 和 `dispose` 时增加 | 聊天会话 | 生效 | `git revert 51596740` |
| DEC-007 | 批准/问卷失败 | 先拿掉卡片，避免连点。通道返回失败才放回原卡。换会话，或该 eventId 已有新卡，不写回 | `dshChatSession.ts` `restorePending` | 聊天待决议 | 生效 | `git revert c3bdf2ec` |
| DEC-006 | 开窗参数 | 首次 `spawn` 的位置参数是 `['--', workspace]`。空路径不传参数。已打开的窗口仍用 `URI.file` | `ide-service.js` 只一处 `spawn(home.exe)` | Host 拉起 IDE | 生效 | `git revert 88b1b159` |
| DEC-001 | 流式临时节点 | 正常 end 后节点先留着；同回合 `assistant/message` 写入后删掉。`abandoned` 立刻删。空内容的正式消息不接管 | `dshIdeConversation.ts` `retireTurnStreams` | 会话投影 | 生效 | `git revert 40de7e42` |
| DEC-002 | 审计文档 | 结论只写本文 | 禁止两份生效清单 | 文档 | 生效 | 从 git 历史恢复旧摘要 |
| DEC-003 | 切会话不取消批准 | `rebind` 不调用 `cancelRequest` | 旧会话仍可能被桌面端回答 | Host 视图 | 生效 | 不引入取消 |
| DEC-004 | 删除后不立刻拉名单 | 只从当前树摘行，子会话升到原位 | `deleteChatSessionItem` | 会话列表 | 生效 | `git revert 1d3f4cf2` |
| DEC-005 | 不做的原生部件 | 不做 planReview、changesSummary、multiDiffData、confirmation、questionCarousel、working、附件 chip | 原生回传或 history 类型接不住 | 聊天历史 | 生效 | 不单开这些部件 |

冲突检测：DEC-010 取代上一轮「interrupt 不加字段」的暂缓。方法数仍是 43，没有「空参数就停当前会话」的第二条路径。它不取消 `rebind`（DEC-003）。DEC-009 不改删除路径（DEC-004）。

## 问题总表

| ID | 状态 | 位置 | 类型 | 证据 | 处理 |
|---|---|---|---|---|---|
| BUG-006 | 已闭环 | `dshIdeProtocol.ts` `interrupt`；`ide-view-host.js` `interrupt` | 竞态 | 停止请求不带会话，Host 用当时绑定的会话调用 `cancel`。换绑后到达的请求会停掉新会话 | 必填 `sessionId`。换绑后 `assertOwnership` 拒绝。测试 `submit and interrupt use the verified sessionController shapes` 与 `cancel sends the session that was bound when stop was clicked` |
| BUG-005 | 已闭环 | `ide-view-host.js` `setSessionFavorite` / `setSessionPinned` | 竞态 | 两次调用会同时读到同一份收藏或置顶状态，然后都写成同一种结果。测试 `two favorite toggles for one session apply in order` | 按会话串行。第一次写成收藏，第二次取消收藏 |
| BUG-004 | 已闭环 | `dshChatSession.ts` `attach` | 竞态 | `openView` 的回包无条件写 `boundSessionId`。用户已 `bind` 别的会话时，绑定被改回开窗会话。检索 `.attach(`，DSH 渲染层只有贡献点这一处调用 | 已有绑定或 `generation !== 0` 时直接返回。测试 `attach does not replace a session the user already bound` |
| BUG-003 | 已闭环 | `dshChatSession.ts` `answerApproval` / `answerQuestion` | 状态不一致 | 卡片在 `await` 之前删除，通道失败后不再出现 | `c3bdf2ec` |
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
| node 测试 | 384 | 416 |
| mocha | 7 | 7 |

## 存疑保留

- `agentsWindow` 配置仍被代码读，不删。
- 上游 `it.skip` 的 smoke 不启用。
- `build/next` 的 watch 在非仓库根可能监听空目录。
- 已有窗口的会话 URI 与 `dshSessionResource` 写法相同，但没有抽成同一个函数。
- 收藏、置顶没有原生行字段。

## 假设与待验证

- 【事实】停止请求带上点击时的 `sessionId`。视图已换到别的会话时，Host 拒绝且不再调用 `cancel`。
- 【事实】同一会话两次收藏切换按顺序写成收藏、再取消。测试断言了写入序列。
- 【事实】用户先 `bind` 再 `attach` 时，第二次 `bind` 同一 id 不会再 `rebind`。测试断言了 `rebind` 只发生一次。
- 【事实】还没有任何 `bind` 时，`attach` 仍会登记开窗会话并读取技能目录。既有测试 `follow frames without skills keep a catalog loaded by listSkills` 仍通过。
- 【待验证】真机在开窗完成前点另一条会话，面板是否停在后者。
- 【待验证】普通目录放在 `--` 后面之后，首次开窗仍打开该文件夹。
- 【推断】空内容的 `assistant/message` 不接管临时节点，是为了留下已经流出来的文字。本轮未改。

## 验证结果

| 门禁 | 改前 | 改后 |
|---|---|---|
| `npm run compile` | 上一轮 0 error | 0 error，1.33 min |
| `verify:dsh-ide-ci` | 五项 PASS，node 415 | 五项 PASS，node 416，mocha 7，fail 0 |
| 覆盖率 | 无命令 | 未跑 |
| 全仓 ESLint | PENDING | PENDING |
| 真机 GUI | PENDING | PENDING |
| `verify:dsh-install-drift` | FAIL，预先存在 | 未打包，仍 FAIL |

安全：本轮没有放宽校验或鉴权。回退命令的切点仍只接受数字序号。

## 风险与回滚

| 风险 | 回滚 |
|---|---|
| 旧的空 `interrupt` 调用会被拒绝。IDE 与 Host 必须一起更新 | `git revert 8915453f` |
| 前一次收藏写入若一直不返回，同会话的下一次切换会等着 | `git revert 051dd6dd` |
| 若开窗回包早于任何点击，行为与原来一样，仍登记该会话 | `git revert 51596740` |
| 若用户在 `attach` 之前没有绑定，但 `generation` 已被别的路径增加，首屏不会登记。当前只有 `bind` 和 `dispose` 会增加 `generation` | 同上 |

## 手册增补

不新增第二套开窗绑定。首屏仍走 `openView` 然后 `attach`。用户已经 `bind` 时以 `bind` 为准。

## 全局路线图

1. 正确性：投影、列表、开窗、待决议继续用回归测试钉住。
2. 安全：契约仍是唯一调用面。开窗 argv 已收口。行内补全不绕过校验。
3. 体积：依赖不再增加。
4. 验证：真机看开窗回包和被拒绝的批准。开发完成后打包再验漂移。

## 信息缺口

没有覆盖率基线。没有本轮全仓 SAST/SCA。没有真机观察。

## 状态对照

已闭环：BUG-006、BUG-005、BUG-004、BUG-003、SEC-002、BUG-001、BUG-002、CLN-001、DEC-010。

仍存在：SEC-001、OPT-001、CLN-002、安装漂移、真机未验、收藏/置顶无星标、删除后旧名单可能把行画回来。

新引入：无。

## 变更表

| 日期 | ID | 状态 | 提交 |
|---|---|---|---|
| 2026-11-18 | BUG-006、DEC-010 | 已闭环。取代「interrupt 不加字段」 | `8915453f` |
| 2026-11-18 | BUG-005、DEC-009 | 已闭环 | `051dd6dd` |
| 2026-11-18 | BUG-004、DEC-008 | 已闭环 | `51596740` |
| 2026-11-18 | BUG-003、DEC-007 | 已闭环 | `c3bdf2ec` |
| 2026-11-18 | SEC-002、DEC-006 | 已闭环 | `88b1b159` |
| 2026-11-18 | BUG-001、DEC-001 | 已闭环 | `40de7e42` |
| 2026-11-18 | DEC-002 | 已闭环 | `041d17ed` |
| 2026-11-18 | DEC-004 | 已闭环 | `1d3f4cf2` |
| 2026-11-18 | 名单通知、开头 steering | 已闭环 | `2126de72` |
