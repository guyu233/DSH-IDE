# DSH-IDE 审计总摘要

唯一生效的审计结论在本文。其它文档只保留链接，不再各写一份清单。

当前基线：`40de7e42`。访问日期 2026-11-18。

## 当前总摘要

健康度：主工程类型检查 0 error；`verify:dsh-ide-ci` 五项 PASS（`DSH_INSTALLED_VERSION=0.2.2-rc.3`）；node 测试 410、mocha 7、fail 0。覆盖率没有命令，未测。全仓 ESLint 未作为通过项。真机界面未验。`verify:dsh-install-drift` 仍对 2026-11-17 的旧 Host 产物失败，开发期不打包。

最危险的 3 件事：

1. 安装漂移未重新打包，真机用的 Host 半身可能不是当前源码。
2. 删除成功后若下一次 `listSessions` 仍带回该 id，行会再出现。这是有意的，避免把没删掉的会话藏起来。
3. 收藏和置顶没有单独的行字段，刷新名单不会多画出星标。

下一步 3 件事：

1. 开发完成后重新打包，再跑 `verify:dsh-install-drift`。
2. 真机看一次：流式结束后正式回复只剩一条；删除后行马上消失。
3. 给收藏/置顶找原生行字段，找不到就保持现状，不另画一套标记。

## 决策台账

| ID | 主题 | 结论 | 依据 | 范围 | 状态 | 回滚 |
|---|---|---|---|---|---|---|
| DEC-001 | 流式临时节点 | `assistant-stream` 正常 end 后节点先留着；同回合 `assistant/message` 写入后删掉。`abandoned` 立刻删。空内容的正式消息不接管，避免把已经流出来的文字清掉 | `dshIdeConversation.ts` 的 `retireTurnStreams`；官方 durable 消息与流式 attempt 是两条身份 | 会话投影 | 生效 | `git revert 40de7e42` |
| DEC-002 | 审计文档 | 结论只写 `docs/PROJECT_AUDIT.md`。`docs/DSH-IDE瘦身报告.md` 与 `docs/DSH-IDE瘦身问题清单.md` 只留链接 | 本轮约束：禁止两份生效清单 | 文档 | 生效，取代此前两份摘要同时生效 | 从 git 历史恢复旧摘要 |
| DEC-003 | 切会话不取消批准 | `rebind` 不调用 `cancelRequest`。会话还在跑 | 旧会话的 waterfall 仍可能被桌面端回答 | Host 视图 | 生效 | 不引入取消 |
| DEC-004 | 删除后不立刻拉名单 | 删除成功只从当前树摘行。子会话升到原位。名单最终一致，立刻刷新会把旧行画回来 | `deleteChatSessionItem`；`ide-view-host.js` 删除路径的注释 | 会话列表 | 生效 | `git revert 1d3f4cf2` |
| DEC-005 | 不做的原生部件 | 不做 `planReview`、`changesSummary`、`multiDiffData`、confirmation、questionCarousel、`working`、附件 chip | 原生回传或 history 类型接不住 DSH 数据 | 聊天历史 | 生效 | 不单开这些部件 |

冲突检测：DEC-001 不改 wireRevision，也不把「缺席即保留」改成清空。与 DEC-003、DEC-004、DEC-005 无交叉代码。

## 问题总表

| ID | 状态 | 位置 | 类型 | 证据 | 处理 |
|---|---|---|---|---|---|
| BUG-001 | 已闭环 | `dshIdeConversation.ts` `applyStream` end 与 `assistant/message` | 内容重复 | end 把 attempt 移出 `attempts`，正式消息只扫进行中的 attempt，临时节点留下。检索 `outcome['kind'] === 'abandoned'` 命中 1 处，已改 | 记住已结束的节点 id，正式消息按 turn 删除。测试 `assistant-stream end then assistant/message keeps one node for that turn` |
| BUG-002 | 已闭环 | 会话绑定、发送、换模型、归档、未读、开窗 sessionId、composer 刷新、custom 权限、vendor 重复登记、名单通知、开头 steering、删除摘行 | 竞态 / 状态 | 见 git `1d3f4cf2`、`2126de72`、`245a025b`、`c6b514dd` 及更早修复提交 | 保持现有测试 |
| SEC-001 | 存疑保留 | 行内补全 `inlineCompletion.ts` 调用 `ide/inlineComplete` | 调用不在 dshIde 契约方法表上 | 通道会拒绝未知 method，调用方 catch 后变成无补全。不是已确认的注入或越权 | 不在本轮改。要接上必须先改契约并单独验证，不能绕过校验 |
| OPT-001 | 存疑保留 | `acceptConversation` 每帧 `clear()` 再重建 | 性能 | 推断会在大会话上重复建树。没有基准数字 | 没有测量前不改 |
| CLN-001 | 已闭环 | 死模块、断链脚本、sessions 残留、零引用导出 | 瘦身 | 删除前做过全仓引用检索。许可证文件未动 | 依赖 68→66、devDependencies 100→93、scripts 86→79、锁文件 1649→1536 |
| CLN-002 | 仍存在 | 本轮新的零引用符号 | 瘦身 | 本轮没有新的可证明零引用项 | 不删 |

## 瘦身报告

本轮没有删除文件，没有改依赖，没有改产物体积。此前删除的理由与无引用证据在 git 历史的 `chore(cleanup)` 提交里，不在这里重复贴清单。

| 项 | 之前 | 现在 |
|---|---|---|
| dependencies | 68 | 66 |
| devDependencies | 100 | 93 |
| scripts | 86 | 79 |
| 锁文件条目 | 1649 | 1536 |
| tsc 错误 | 137 | 0 |
| node 测试 | 384 | 410 |
| mocha | 7 | 7 |

## 存疑保留

- `agentsWindow` 配置仍被代码读，不删。
- 上游 `it.skip` 的 smoke 不启用。
- `build/next` 的 watch 在非仓库根启动时可能监听空目录，需要长驻验证。
- 已有窗口打开会话的 URI 与 `dshSessionResource` 写法相同，但分处主进程和 workbench，没有抽成同一个函数。抽函数会动启动路径，本轮不做。
- 收藏、置顶没有原生行字段。

## 假设与待验证

- 【事实】正常 end 之后、正式消息之前，临时节点仍然可见。测试断言了这一点。
- 【事实】`abandoned` 立刻删除临时节点。
- 【推断】空内容的 `assistant/message` 不接管临时节点，是为了不丢掉已经流出来的文字。若官方把空消息当作「这回合没有文字」，现行为会多留一条。确认方法：拿一条只有工具调用、没有 text block 的 `assistant/message` 看投影。本轮未改这条路径。
- 【待验证】真机上正式回复是否只剩一条。AI 不代跑 GUI。

## 验证结果

| 门禁 | 改前 | 改后 |
|---|---|---|
| `npm run compile` | 0 error | 0 error，1.07 min |
| `dshIdeConversation.test.ts` | 12 项 | 14 项，fail 0 |
| `verify:dsh-ide-ci` | 上轮五项 PASS | 本轮五项 PASS（`DSH_INSTALLED_VERSION=0.2.2-rc.3`） |
| 覆盖率 | 无命令 | 无命令，未跑 |
| 全仓 ESLint | PENDING | PENDING。不把既有版权头差异当成新缺陷 |
| 真机 GUI | PENDING | PENDING |
| `verify:dsh-install-drift` | FAIL，预先存在 | 未打包，仍 FAIL |

安全：本轮只改投影状态，没有放宽校验、鉴权或协议。没有新的 CVE 结论。

## 风险与回滚

| 风险 | 回滚 |
|---|---|
| 正式消息和流式文字不完全相同时，用户会从临时文字切到正式文字 | `git revert 40de7e42` |
| 正式消息若晚到，中间仍会看到临时节点。这是有意的 | 同上 |
| 旧清理提交要撤回时，按 `chore(cleanup)` 逐个 revert | 各提交自己的 hash |

## 手册增补

手册 §9.11 开头改为指向本文。历史实施记录仍留在手册里，不再当作第二份生效清单。不新增「流式节点两套保留策略」。

## 全局路线图

1. 正确性：会话投影、列表、开窗这条链继续用回归测试钉住。本轮补的是流式接管。
2. 安全：dshIde 契约仍是唯一调用面。行内补全的旁路调用保持失败即无补全，不绕过校验。
3. 体积：依赖不再增加。新的删除必须先证明零引用。
4. 验证：开发完成后打包，再验安装漂移和真机。

## 信息缺口

没有覆盖率基线。没有本轮的全仓 SAST/SCA 报告。没有真机观察。

## 状态对照

已闭环：BUG-001、BUG-002、CLN-001、DEC-002。

仍存在：SEC-001、OPT-001、CLN-002、安装漂移、真机未验、收藏/置顶无星标、删除后旧名单可能把行画回来。

新引入：无。

## 变更表

| 日期 | ID | 状态 | 提交 |
|---|---|---|---|
| 2026-11-18 | DEC-004、删除摘行 | 已闭环 | `1d3f4cf2` |
| 2026-11-18 | 名单通知、开头 steering | 已闭环 | `2126de72` |
| 2026-11-18 | BUG-001、DEC-001 | 已闭环 | `40de7e42` |
| 2026-11-18 | DEC-002 审计文档单源 | 已闭环 | 本文件随文档提交 |
