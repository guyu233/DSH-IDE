# DSH-IDE 瘦身与修复摘要

当前基线：`1d3f4cf2`。本文只保留总结果，不再按轮次记流水。更早的逐项记录在 git 历史里。

## 门禁

| 项 | 结果 |
|---|---|
| `npm run compile`（`src/tsconfig.json`） | PASS，0 error（1.27 min） |
| `npm run test-dsh:all` | PASS。mocha 7 + node 408，fail 0 |
| `verify:dsh-ide-ci`（`DSH_INSTALLED_VERSION=0.2.2-rc.3`） | PASS。protocol-single-source、boundary、projection-golden、contract、test-dsh:all |
| 全仓 ESLint | PENDING。直接跑改动文件时，`header/header` 报的是既有 DSH 版权头和规则期望的上游头不一致，没有用 `--fix` 改写版权头 |
| 覆盖率 | 未跑。仓库没有现成覆盖率命令。测试项数只说明断言没少 |
| 真机 GUI / smoke | PENDING。按 AGENTS §6 由用户执行 |
| `verify:dsh-install-drift` | FAIL，预先存在：`host/ide-service.js`、`host/ide-view-host.js` 与 2026-11-17 旧产物不一致。开发期不打包，所以没有重验 |

类型错误从最初的 137 条到现在的 0。node 测试从 384 增到 408（中间删过死测试，所以不是纯增加）。

## 删除

本轮没有删文件。此前已删并核对过零引用（含字符串和动态路径）的，是死模块、断链脚本、已删 `src/vs/sessions` 的配置和 smoke、`build/lib` 里没人 import 的截图脚本、chatContracts 的零引用导出，以及若干失效 npm script。许可证文件没有动：`src/vs/platform/dshClient/PROVENANCE.md`、`build/lib/dsh/PROVENANCE.md`、`build/lib/dsh/LICENSE-DSH`、`build/dsh/chat-render/` 下的同批凭据、`NOTICE.md`、`LICENSE.txt`。

没有再找到满足「全仓符号名零命中，且没有 `path.join` / 动态 import」的新死代码。

## 依赖

| 项 | 之前 | 现在 |
|---|---|---|
| dependencies | 68 | 66 |
| devDependencies | 100 | 93 |
| scripts | 86 | 79 |
| 锁文件条目 | 1649 | 1536 |

没有新增依赖，没有改版本。本轮也没有动依赖。

## 现在的行为

会话绑定、换模型、发送失败都按代次丢掉过期回包。已知会话只有 `updatedAt` 变大才标未读。绝对路径交付物用 `URI.file`。计划、目标、待办在帧里缺席时保留，不当成清空。归档集合来自 Host 回包，刷新不会丢掉。已打开的 IDE 再收到带 `sessionId` 的开窗请求时，会打开对应的 `dsh:/<id>`，而不是只把窗口拉到前面。归档和恢复走会话控制器。写模型或权限之后，不会采用写请求之前已经发出的目录回包。当前权限是 `custom` 时选择器能看见它，其它状态下不能切到 `custom`。模型 vendor 不重复登记。重命名、移动、新建、收藏、置顶成功后会通知面板刷新名单。删除成功不拉名单，只从当前树拿掉这一行，子会话留在原位置。之后若 Host 名单仍带回该 id，行会再出现。会话开头的 steering / 子智能体通知不会因为还没有用户消息而被丢掉。

仍不做：`planReview`、`changesSummary`、`multiDiffData`、原生 confirmation / questionCarousel、`working` 进度、附件 chip。这些原生部件的回传或类型对不上 DSH。

## 存疑保留

- `agentsWindow` 配置仍被现有代码读，不删。
- 上游有意 `it.skip` 的 smoke 不启用。
- `build/next` 的 watch 在非仓库根启动时 glob 和 cwd 可能对不齐，改 watch 需要长驻验证。
- 收藏和置顶没有单独的原生行字段。名单刷新不会多画出一枚星标。
- 已有窗口打开会话的 URI 与 `dshSessionResource` 是同一写法，但分处主进程和 workbench，没有抽成同一个函数。
- 删除后若下一次名单仍包含该 id，行会回来。不把 id 永久藏起来，避免删失败时会话消失。

## 风险与回滚

| 风险 | 回滚 |
|---|---|
| 刚改完的名单通知如果发得太早，可能刷新到旧标题。失败路径不发通知 | `git revert 2126de72` |
| 删除只改本地树。下一次仍包含该 id 的名单会把行画回来 | `git revert 1d3f4cf2` |
| 开头的 steering 会单独占一条空 prompt 的回复 | `git revert 2126de72` |
| 旧的清理提交如果要整体撤回，按 `git log` 里的 `chore(cleanup)` 逐个 revert，不要和功能提交混在一次 | 各清理提交自己的 hash |

假设：`vscode:openChatSession` 收到与 `dshSessionResource` 相同的 URI 后，会走内容提供者的 `bind`。`custom` 选项不加 `locked`，否则用户无法改去其它权限。
