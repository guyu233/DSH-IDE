# DSH-IDE 细小 Bug 清单（第 4 轮补充，待确认）

> 编制时间：2026-11-17 23:50（Asia/Shanghai）
> 依据：`scan-small-bugs` 子智能体只读扫描 + 主智能体逐条复核。HEAD `3f60c398`。
> 用户要求「每轮还要检查是否仍有细小 bug，全部整理后分析出一个没有逻辑问题的可执行解决方案并处理」。
> 按「不确定不要提问」的约定：下表每条都给出**推荐方案**，我按推荐方案继续。

## 真实 bug（11 处，已逐条复核）

| # | 位置 | 类别 | 问题 | 触发条件 | 严重度 | 推荐方案 |
|---|---|---|---|---|---|---|
| B1 | `dshChatSession.ts:406-416` | 状态不一致 | `submit()` 置 `_running=true`，仅在 `result.ok === false` 时复位；**回合正常结束时无任何代码复位**，`running()` 永远为 true → 面板永远显示「生成中」、停止按钮常驻 | 发送任意一条消息并等本轮结束 | **高** | 在 `acceptView()` 里按 `view.frame` 的官方状态复位：读到 `frame['running'] === false`（或 `state.phase` 回到 idle）时 `_running=false` 并 fire；同时给 `DshIdeSessionNotice{kind:'status'}` 加消费（`dsh.contribution.ts` 里转给 `_chat`），由 Host 的 `session-status` 帧驱动。两条路任一条先到即复位，幂等 |
| B2 | `dshChatSession.ts:229-251` | 状态不一致 | `bind()` 先写 `boundSessionId` 再 `await rebindView`；失败不回滚 → 之后 `bind(同一 id)` 因相等直接 `return true`，永远无法重绑 | `rebindView` 失败一次后再打开原会话 | 中 | 先 `await rebindView`，成功后再写 `boundSessionId` 与清理状态；失败保持原值。注意 `generation` 要在 await 前自增以作废旧流 |
| B3 | `dshChatSession.ts:289-311` | 状态不一致 | `plan`/`goal`/`todos` 只在 `snapshot` 帧带（`ide-view-service.ts:248-250` 只在 `type==='snapshot'` 时投影），后续内容帧 `projections` 是 `{}` → `acceptView` 把三者当 `undefined`/`[]` 清空 | 打开有计划/目标/Todo 的会话，收到下一条内容帧 | 中 | 与 `skills` 同口径：`view.plan === undefined ? this._plan : view.plan`，`goal` 同理，`todos` 用 `view.todos !== undefined ? view.todos : this._todos` |
| B4 | `dshIdeConsumer.ts:74-95,98-109` | 状态不一致 | 任一坏帧/版本 gap 置 `failed=true` 后**永久**拒绝后续帧；`reset()` 全仓零调用 | 收到一次 `SNAPSHOT_STALE` 或结构不合法帧 | 中 | `dsh.contribution.ts` 在 `client.onDidChangeState(connected)` 时调用 `consumer.reset()`（重连后重新接受）；`DshChatSession.bind()` 成功后也调一次 |
| B5 | `dshIdeBackendFactory.ts:231-249` | 异步错误 | `this.authenticating` 缓存 Promise，成功/失败都不清；首次 cookie 交换因瞬断 reject 后，**该 rejected Promise 被永久复用** | 启动时 Host 未就绪导致首次 `exchangeCookie` 失败 | 中 | `this.authenticating = (async () => {...})().catch(error => { this.authenticating = undefined; throw error; })`；成功路径在 `impl` 赋值后清空 |
| B6 | `dshAgentSessionsController.ts:65-67,96-108` | 异步错误 | `void this.refresh(...)` 无 `.catch`，而 `refresh()` 在 `listSessions` 失败时 `throw` → unhandled rejection | Host 未连接时触发刷新 | 中 | 统一 `void this.refresh(t).catch(onUnexpectedError)`；`_listRefresh.schedule()` 的路径同样处理 |
| B7 | `dshSessionTree.ts:144-163` | 逻辑错误 | `list.map()` 永远返回新数组 → `nextChildren !== item.children` 恒真 → `changed` 恒真，`mapTreeItem` 对含子项的树永远返回新树 | 有 subagent 子项时调用 `setChatSessionItemRead`/`applyArchived`（即使值没变） | 低 | 比较子数组：`const nextChildren = map(...); if (nextChildren !== item.children && (nextChildren.length !== item.children.length || nextChildren.some((c,i)=>c!==item.children![i])))`。更简单：让 `map` 在 `changed` 为 false 时返回原数组 —— 用 `let listChanged=false` 逐层传递 |
| B8 | `dshLanguageModelProvider.ts:105-107` | 状态不一致 | 目录变化只比较 `identifier`；模型显示名/effort 变化不 fire `onDidChange` | DSH 侧改名模型或调整 reasoningEffort | 低 | 比较 `name`/`efforts`/`defaultEffort`/`capabilities`，或用稳定 JSON 比较 |
| B9 | `dsh.contribution.ts:89` | 资源泄漏 | `registerDshInlineCompletions(...)` 返回的 Disposable 未 `_register` | 贡献点释放时 | 低 | `this._register(registerDshInlineCompletions(languageFeatures, client));` |
| B10 | `dshIdeTransport.ts:152-160` | 异步错误 | `signal.throwIfAborted()` 与 `addEventListener('abort')` 之间有窗口，期间 abort 会漏 | 瞬间 abort 竞态 | 低 | 先 `addEventListener` 再 `throwIfAborted()`；或挂完后复查 `signal.aborted && cancel()` |
| B11 | `dshChatHistory.ts:234-238` | 逻辑错误 | `applyQuotaNotice` 在 `appendDeliverables`/`appendExtras`/`appendPending` 之后执行，配额 `errorDetails` 可能挂到交付物那条 response | 同回合既有 deliverables 又有额度失败 | 低 | 先记「最后一条对话 response 索引」，再 append 其它；配额只作用该索引 |

## 分类统计

| 类别 | 处数 |
|---|---|
| 1 未定义/未导入标识符 | 0 |
| 2 可选链/空值处理 | 0 |
| 3 异步错误 | 3（B5/B6/B10） |
| 4 资源泄漏 | 1（B9） |
| 5 逻辑错误 | 2（B7/B11） |
| 6 字符串/正则/路径 | 0 |
| 7 类型断言掩盖 | 0 |
| 8 状态不一致 | 5（B1/B2/B3/B4/B8） |

## 执行计划

1. **批次 1（高危 + 中危，功能修复，单独提交）**：B1、B2、B3、B4、B5、B6。
2. **批次 2（低危，功能修复，单独提交）**：B7、B8、B9、B10、B11。
3. 每批后跑 tsc + `test-dsh:all`；全批完成后跑 `verify:dsh-ide-ci` + `npm run compile`。
4. 新增/调整单测覆盖：B1（running 复位）、B2（bind 失败可重试）、B3（缺席不清空）、B7（mapTreeItem 无变化返回原数组）。
5. 输出 `docs/DSH-IDE细小Bug修复报告-第4轮.md`（问题、根因、修法、测试、风险）。

## 假设（手册未覆盖处）

1. **B1 的复位信号**：官方 `DshIdeViewSnapshot.frame` 是 `sessionController.follow` 的原始帧，其中 `running` 字段存在（`IDshIdeSessionSummary.running` 同源）。若某些帧不带 `running`，则退化为「收到 `session-status` notice 时复位」，两者都不可用时保持现状（不清空）。
2. **B2 的顺序调整**：`generation++` 必须在 `await` 前，否则旧流可能在 await 期间写入新会话；这一点与现有 `bind()` 语义一致（它已经在写 `boundSessionId` 前自增）。
3. **B4 的 reset 时机**：只在「连接重新建立」与「bind 成功」两处 reset，不在每帧 reset——否则坏帧熔断就失去意义（防止坏帧无限刷）。
4. **B7 的返回原数组**：`mapTreeItem` 的调用方（`setChatSessionItemRead` / `applyArchived`）已用 `next === this._items` 判等来决定是否 fire，所以「无变化返回原数组」是契约的一部分，不是优化。
