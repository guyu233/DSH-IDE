# DSH-IDE 细小 Bug 修复报告（第 4 轮）

> 编制时间：2026-11-18 00:00（Asia/Shanghai）
> 依据：`scan-small-bugs` 子智能体只读扫描（8 类模式，覆盖 DSH 全部生产代码）+ 主智能体逐条复核
> 清单：`docs/DSH-IDE细小Bug清单-第4轮.md`
> 修复提交：`594dd4a4`（与清理改动分开）

## 1. 门禁总览

| 门禁 | 结果 |
|---|---|
| `tsc --noEmit` | **PASS**（0 error） |
| `npm run build-dsh-tests` | **PASS** |
| `npm run test-dsh:all` | **PASS**（**388**，较修复前 384 **+4**） |
| `verify:dsh-ide-ci`（五项） | **PASS**（`DSH_INSTALLED_VERSION=0.2.2-rc.1`） |
| `npm run compile` | **PASS**（0 errors，36 s） |
| 真机 GUI | **PENDING**（按 AGENTS §6 由用户执行） |

## 2. 修复清单（11 处）

| # | 文件 | 问题 | 根因 | 修法 | 严重度 |
|---|---|---|---|---|---|
| B1 | `dshChatSession.ts` | `running()` 永为 true，面板永远「生成中」 | `submit()` 置 true 后，正常回合结束无任何复位路径 | 新增 `setRunning()`（幂等）+ `acceptSessionStatus()`；`dsh.contribution.ts` 消费 `session-status` 帧驱动复位 | **高** |
| B2 | `dshChatSession.ts` | rebind 失败后同一会话永不重绑 | `boundSessionId` 在 `await` 前写入，失败不回滚 | 失败时回滚 `previous` | 中 |
| B3 | `dshChatSession.ts` | 每条内容帧清空 plan/goal/todos | 投影只在 snapshot 帧下发，`acceptView` 把缺席当清空 | 与 `skills` 同口径：缺席保留上一次值 | 中 |
| B4 | `dshIdeConsumer.ts` + `dsh.contribution.ts` | 一次坏帧后永久拒帧，只能重载窗口 | `reset()` 全仓零调用 | 连接重建时 `consumer.reset()` | 中 |
| B5 | `dshIdeBackendFactory.ts` | 首次 cookie 交换失败后永久失效 | `authenticating` 缓存 rejected Promise 且不清 | `.catch()` 清空后重抛 | 中 |
| B6 | `dshAgentSessionsController.ts` | unhandled rejection | `void this.refresh(...)` 无 catch，而 refresh 会 throw | 统一 `refreshNow()` = `.catch(onUnexpectedError)` | 中 |
| B7 | `dshSessionTree.ts` | 无变化也重建树，`next === this._items` 判等失效 | `list.map()` 必返回新数组 → `changed` 恒真 | 逐层维护 `changed`，无变化返回原数组 | 低 |
| B8 | `dshLanguageModelProvider.ts` | 模型改名/推理档变化不刷新选择器 | 只比 `identifier` | `sameLanguageModel()` 比 name/family/version/token 上限/modelGroup/schema | 低 |
| B9 | `dsh.contribution.ts` | 行内补全 provider 泄漏 | 返回的 Disposable 未 `_register` | `this._register(...)` | 低 |
| B10 | `dshIdeTransport.ts` | abort 竞态窗口漏取消 | `throwIfAborted()` 在挂监听之前 | 先挂监听 + 复查 `signal.aborted` | 低 |
| B11 | `dshChatHistory.ts` | 配额错误挂到交付物行 | `applyQuotaNotice` 在 append 之后执行 | 移到 appendDeliverables 之前 | 低 |

## 3. 测试补充（+4 项，384 → 388）

| 测试文件 | 新增用例 | 锁住的回归 |
|---|---|---|
| `dshChatSessionExtras.test.ts` | 内容帧不带 plan/goal/todos 时保留上次值 | B3 |
| `dshChatSessionExtras.test.ts` | rebind 失败后同一 id 可重试 | B2 |
| `dshChatSessionExtras.test.ts` | 会话状态通知按 sessionId 过滤且能复位 running | B1 |
| `dshSessionTree.test.ts` | `mapTreeItem` 无变化时返回原数组（含子项的树） | B7 |

## 4. 未修（存疑保留）

| # | 项 | 为什么保留 |
|---|---|---|
| R1 | `DshIdeConsumer` 的「坏帧熔断」语义本身 | 熔断是 fail-closed 的正确设计；本次只补了「连接重建时可恢复」。是否要「stale 帧改为重拉快照而非熔断」需要产品决策，不在「行为不变」清理范围 |
| R2 | `dshChatSession.acceptView` 的 `deliverables`/`attachments` 仍按缺省清空 | 这两个字段在 Host 侧每帧都算（`deliverablesOf`/`attachmentsOf` 累计下发），缺席即真为空；与 plan/goal/todos 的投影语义不同 |
| R3 | `dshIdeTransport` 的 `_pendingCalls` 在 dispose 时不清理 | `dispose()` 走 `_failPending`，`_pendingCalls` 只是 AbortController 集合，GC 随 transport 一起回收；无泄漏证据 |

## 5. 风险与回滚

| 风险 | 等级 | 回滚 |
|---|---|---|
| B1 引入 `acceptSessionStatus`：若 Host 侧 `api-session/status` 事件不触发（旧版本），`running` 会停在 true 直到下次 bind | 中 | 旧 Host 本身也没有 `session-status` 帧，行为与修复前一致；`bind()` 仍会 `setRunning(false)`。`git revert 594dd4a4` |
| B3 改为「缺席保留」：若上游某天真的用 `plan: undefined` 表示「计划已取消」，会保留旧值 | 低 | 目前 `projectDshIdeProjections` 只在 snapshot 帧返回 `plan`，取消计划会下发 `{active:false,pending:false}` 而非缺席。`git revert 594dd4a4` |
| B5 失败后重试：可能出现多次 cookie 交换（每次新 `ensureImpl`） | 低 | 交换是幂等的 GET，失败才会重试；成功仍只缓存一份 |
| B7 改 `mapTreeItem` 返回值语义：若有调用方依赖「总是新数组」 | 低 | 全仓只有 `dshAgentSessionsController` 的 3 处调用，都按 `next === this._items` 判等，正是所需语义 |
| B11 调整顺序：配额提示从「最后一条」改为「追加 extras 之前的最后一条」 | 低 | `appendExtras` 是往最后一条 response 追加 parts，不新增行；顺序调整后配额仍落在同一条对话 response 上 |

**整体回滚**：`git revert 594dd4a4`。

## 6. 扫描覆盖面与遗漏说明

| 类别 | 命中 |
|---|---|
| 1 未定义/未导入标识符 | 0（TS 由编译约束；JS 侧逐文件核对） |
| 2 可选链/空值处理 | 0（`?.` 均有前置守卫，`JSON.parse` 均在 try/catch 内） |
| 3 异步错误 | 3（B5/B6/B10） |
| 4 资源泄漏 | 1（B9） |
| 5 逻辑错误 | 2（B7/B11） |
| 6 字符串/正则/路径 | 0（路径均用 `path.join`，正则转义核对无错） |
| 7 类型断言掩盖 | 0（`!` 均由不变量可证非空） |
| 8 状态不一致 | 5（B1/B2/B3/B4/B8） |

**遗漏说明**：子智能体为限时扫描，`build/lib/test/dsh*.test.*` 与 `build/dsh/**` 只做模式扫描未逐行读，可能仍有遗漏；下一轮可对这两处做定向复扫。
