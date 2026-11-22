# docs 文档索引

> 本目录只保留 4 份文档。不要恢复已合并的历史文件。

## 1. 现行入口

| 文档 | 角色 |
|---|---|
| [`AGENTS.md`](../AGENTS.md) | 工作纪律、身份前提、证据纪律、提交与验证纪律 |
| [`DSH-IDE内容原子化契约.md`](DSH-IDE内容原子化契约.md) | 唯一内容架构契约；包含当前状态矩阵与真机验收表 |
| [`PROJECT_AUDIT.md`](PROJECT_AUDIT.md) | 审计台账、历史决策、轮次记录、门禁快照 |
| [`DSH历史证据汇编.md`](DSH历史证据汇编.md) | 历史证据与旧施工记录；只用于追溯，不定义现行路线 |

## 2. 真源

| 类型 | 真源 |
|---|---|
| 工作纪律 | `AGENTS.md` |
| 内容架构与状态 | `docs/DSH-IDE内容原子化契约.md` |
| 当前审计状态 | `docs/PROJECT_AUDIT.md` 最新轮次 |
| 协议 | `src/vs/platform/dshClient/protocol/dshIdeProtocol.ts` |
| 实现 | `src/**`、`build/**` |
| 验收 | `docs/DSH-IDE内容原子化契约.md` 附录 A/B 与第 15/18/19 节 |

## 3. 阅读顺序

1. `AGENTS.md`
2. `docs/DSH-IDE内容原子化契约.md`
3. `docs/PROJECT_AUDIT.md` 最新轮次
4. 只有追溯历史时读 `docs/DSH历史证据汇编.md`

## 4. 状态口径

只使用：

- `已实现`
- `部分实现`
- `未实现`
- `PENDING`

协议/数据存在不等于界面已显示；计划不等于已实现；历史快照不等于当前真源。未跑门禁不得写 PASS。

## 5. 业务事实边界

DSH-IDE 是 DSH core 的 UI 投影层，不是第二个响应生成器。用户消息、assistant 正文、thinking、工具结果、approval/question/plan 终态、usage、quota、deliverables、turn/process/tail 必须来自 DSH core/Host。IDE 侧本地状态仅限输入草稿、optimistic running、卡片临时隐藏/恢复、折叠状态、滚动位置、失败提示与原生化投影。禁止把本地 UI 状态写成 DSH 会话事实。详见 `DSH-IDE内容原子化契约.md` §1.8–§1.9。

## 6. 每轮上游同步与优化机会

每一轮开发/评审开始时必须在线只读检查 DSH 最新源码/提交与 VS Code 更新日志；DSH 优先关注破坏性更新，VS Code 关注 Chat/editor/input/theme/a11y/scroll/tree 的小变化。检查不仅要判断“会不会坏”，还必须判断“上游新能力是否让当前自研/降级/文本模拟实现有更优替代”。检查结果必须写明来源、破坏性结论、优化机会和本仓动作；“无需调整/无优化机会”也要给依据。规则见 `AGENTS.md` 总纪律第 7 条与 `DSH-IDE内容原子化契约.md` §20。

## 7. 提交节奏

每完成一个可独立验收的大问题修复、新功能实现或较大改动，必须立即提交一次；不要积压到后续任务，也不要把多个大主题混在一次提交里。提交信息按 `AGENTS.md` §6 写明「做了什么 / 门禁实测结果 / 未完成项」。
