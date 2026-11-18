# DSH-IDE 项目审计与施工状态

本文件是唯一的持续审计与决策台账。问题 ID 源自只读归档 `DSH-IDE-READONLY-AUDIT-44e0a348.md`，不重录归档正文。取证日期：2026-11-18（Asia/Shanghai）。归档 SHA-256：`12f8550bd4f78adfec8cfe0eb1a8430635cc52d692a0520e83074c221a69c967`。

## 当前总摘要

**B00 已交付；B01 的取证与补充红测已完成，生产迁移仍 PENDING。** 原审计起点 `44e0a34827f83c3a87891bc8d0ebf93b96ff09b0`，比较 merge-base `d07799b88abd0b84bb4935e0527798d868782f3d`。B00 分支 `audit/b00-baseline-redwall`；B01 从 `2c448cbd` 起在 `audit/b01-identity-readiness` 延续。同一产品的 Host 半身与 IDE 窗口未改动；不以取证完成代替问题修复。

| 当前重点风险 | 下一步 |
|---|---|
| BUG-008/009、SEC-003：本地窗口、原生资源与调用的归属不一致；Host 入口未复用唯一校验器。 | B01 按下列迁移条件落实三层身份与校验，不做只改 IPC 或只改内容对象的补丁。 |
| DOC-001：开发启动不保证同版本；本机留存归档与安装目录存在字节差异，同包版本号不足以判别配对。 | 走明确契约迁移及版本裁决，在两半和手册一起交付之前保持 revision `4`。 |
| 全量 Node、Electron 单测与 ESLint 仍 FAIL，不能充当发布通过证据。 | 冻结可复算的失败对照；迁移后同口径复验。真机及发布验收单列 PENDING。 |

生效约束：一个 DSH bundle、一个 `dshIde` 通道、一套契约和校验器、原生 Chat；发送与停止带发起时的会话；换绑不取消合法审批；先保行为与外部契约，再做安全、正确性和优化。参见 [协作约定](../AGENTS.md)、[开发手册](DSH-IDE改造开发手册.md) 与 [协议真源](../src/vs/platform/dshClient/common/dshIdeProtocol.ts)。

版本口径：VS Code `1.143.1` 是产品基线；DSH bundle `2.0.0` 是包版本；`0.2.2-rc.1` 是 DSH 契约校验基线；桌面 Host 运行时清单是 `0.2.2-rc.3`；开发 Electron 实际读取根 [`.npmrc`](../.npmrc#L2)，为 `43.7.7`，缓存版本也为 `43.7.7`。[取版本脚本](../build/lib/electronVersion.ts#L11)不使用协作约定中的宿主 `44.7.0` 作为开发下载版本。两者不直接证明 ABI 兼容；B11 澄清，B00 不改动。

## 决策台账

| ID | 状态 | 生效规则、依据和范围 | 取代关系 / 回滚 |
|---|---|---|---|
| DEC-001 | 生效 | 正常流结束后保留临时节点，正式可见消息接管；`abandoned` 立即移除。会话投影。 | 未取代；`40de7e42`。 |
| DEC-002 | 生效 | 单一 bundle、官方传输、唯一通道与协议、原生 Chat、唯一持续审计。协作约定 §1。 | 未取代；`041d17ed` 留存文档历史，不退回并行报告。 |
| DEC-003 | 生效 | 换绑不调用 `cancelRequest`，桌面和 IDE 都可先答。会话绑定与审批。 | 未取代；不引入跨视图取消。 |
| DEC-004 | 生效 | 删除成功摘除本地行，保留子项，不立即重拉最终一致名单。会话列表。 | 未取代；`1d3f4cf2`。 |
| DEC-005 | 生效 | 只承接选定的原生数据结果，不另做此前排除的原生部件。Chat 历史。 | 未取代；不新增第二种渲染模具。 |
| DEC-006 | 生效 | 首次 argv 中 `--` 隔开工作区；现有窗口保持 URI 入口。启动。 | 未取代；`88b1b159`。 |
| DEC-007 | 生效 | 批准或问卷提交时先隐藏，失败恢复限同代且未被新卡占用。待决议。 | 未取代；`c3bdf2ec`。终态失败的分类由 B02 裁决。 |
| DEC-008 | 生效 | 迟到 `attach` 不覆盖用户已作出的绑定。首窗初始化。 | 未取代；`51596740`。 |
| DEC-009 | 生效 | 收藏、置顶按同类型和同会话串行。Host 列表写入。 | 未取代；`051dd6dd`。 |
| DEC-010 | 生效 | 停止必填发起时的 `sessionId`，无空参数回退。 | 未取代；`8915453f`。 |
| DEC-011 | 生效 | 发送必填发起时的 `sessionId`，Host 不改写目标。 | 未取代；`cbf54c1b`。不以方法数量证明两半相容。 |

### D1–D6 草案

以下均为 **PENDING / 草案**，不是运行规则；B00 不宣布旧决策被取代。生效条件是对应批次将影响文件、测试、门禁及手册原子落地并验收。

| 草案 ID / 批次 | 唯一规则与依据 | 影响面及取代关系 | 回滚 |
|---|---|---|---|
| DEC-012 / D1 / B01 | 窗口拥有视图绑定；内容绑定到原生缓存 URI 与当前代次；请求在发起时固定身份。当前会话写必须匹配绑定，显式行操作核对同一主体下可见对象。依据 BUG-008/009。 | 主进程 `app`/`channel`/`view-service`、传输、Host 入口、状态及内容对象、菜单、测试。替代当前进程级可变绑定的假设，不替代 DEC-008/010/011；`ctx` 不是远程认证主体。 | 完整 B01 一起撤销，不能单独退 DTO。 |
| DEC-013 / D2 / B01 | 配对构建可用同一 staging 证实，当前安装与开发混跑不可仅据此证明。先确认配对识别和混装拒绝是否适用于支持的启动入口；证据不足时做显式契约迁移裁决，保持 revision `4` 直至原子交付。依据 DOC-001/SEC-003。 | 协议、Host 守卫、两半装配、源码与 staging 决定的模块、配对矩阵、门禁、手册。不设旧参数回退，不用方法数量替代兼容性判断。 | 配对校验、协议、Host 与 staging 同批撤销。 |
| DEC-014 / D3 / B02 | 请求种类一致、一次结算，统一投递最后状态；只有仍有效的可重试失败可恢复原卡。问卷必须完整交付答案和意图，无法完整承接时明确交还桌面。依据 BUG-010/017。 | Host pending、mux DTO、投影、renderer、恢复测试。补足 DEC-007 的终态分类，DEC-003/005 不动。 | 结算和卡片状态守卫一起撤销。 |
| DEC-015 / D4 / B03 | 发送入口以资源确立唯一 provider 和真实接纳结果；沿原生接受与历史语义结算。选择器写回同一目标的真实 Host DTO，失败不显示成已生效。依据 BUG-011/015。 | 原生 `ChatWidget`、DSH 内容对象、composer/命令、契约参数与测试；替代失败后尝试走另一内核及仅界面选中的做法。 | 发送、选择写回及配套断言完整撤销。 |
| DEC-016 / D5 / B04 | durable 边界按资源和日志位置维护，首个有效基线触发分页，增量不擦除旧页。投影使用版本匹配的 surface/attempt 锚点。依据 BUG-012/022。 | 投影、模型、loadOlder 与真源边界、golden。需要调整 DEC-001 时显式记录，未验证前保留其既有接管语义。 | durable 分页和 projector 变更同批撤销。 |
| DEC-017 / D6 / B06 | 鉴权由单一所有者管理。结算绑定 origin 和代次，过期任务不能写缓存或环境；重放按请求语义分类，不可确认的写和消费型轮询不盲重发。依据 BUG-014/020、SEC-004。 | `app` caller、backend、传输、端点验证与延迟桩；替代两处缓存各自更新的做法，不另设传输。 | 认证所有者、清理和重试分类一起撤销。 |

## 问题总表

| ID | 产品状态 | 验收状态 / 批次 |
|---|---|---|
| BUG-008 | 已修（隔离证据） | 每连接一个视图、代次隔离、迟到回包不夺回绑定、最后窗口只释放订阅：4 条隔离用例转绿。B02 补修「桥被钉在第一个窗口」的回归：代次按视图分别记账，同一桥可服务多个视图。真机双窗 PENDING。 |
| BUG-010 | 已修（隔离证据） | 终态统一投递：空 `pending` 基线不再省略、取消帧不再被传输层拒收、IDE 先答也广播终态、决议按请求种类校验、桥销毁逐个结算等待者、只有已证可重试的失败才恢复卡片、已终态 `eventId` 不再被迟到帧或恢复路径复活。2 条隔离用例 + 3 条 Host 用例转绿。真机多窗一致 PENDING。 |
| BUG-017 | 已修（隔离证据） | 问卷不再静默缩写：待决议项保留全部题目；仅单题单选有选项由原生卡片提交，多题/多选/无选项不提交部分答案并明确交还桌面入口。1 条隔离用例覆盖四种形状。真机问卷 PENDING。 |
| BUG-009 | 已修（隔离证据） | 缓存历史与陈旧发送/停止：3 条原生用例转绿。原生 A→B→A 端到端 PENDING。 |
| DOC-001 | 已修（设计层） | 两半在 `ide/ping` 上互相声明修订号 5，不符即拒绝；Host 入口另有共享校验。真机混装矩阵 PENDING。 |
| SEC-003 | 已修（隔离证据） | Host 入口改调唯一共享校验器并校验可信主体；staging 已把该模块纳入 Host 闭包。运行态主体 PENDING。 |
| BUG-011 | 已修（隔离证据） | 分流三态互斥、完成路径、附件拒绝与转发：原生 4 条 + 隔离 6 条用例转绿。真机发送与图片 PENDING。 |
| BUG-015 | 仍存在 | 两个 provider 的模型参数不符合真正 schema，红；选择器、档位和门控 PENDING / B05。 |
| BUG-012 | 已修（隔离证据） | 实时窗口与翻页历史分离、durable 游标、空页终止单向：4 条隔离用例转绿。真机长会话 PENDING。 |
| BUG-022 | 仍存在 | rc.3 事件/锚点 golden PENDING / B04。 |
| BUG-013 | 已修（隔离证据） | 合并窗口按字段合并保留 opening baseline、generation 只随换绑递增、换绑与非 ready 帧一律清视图、显式空值覆盖基线：5 条隔离用例转绿。真机重建与恢复 PENDING。 |
| BUG-016 | 仍存在 | 共用流基线、结束和释放场景 PENDING / B05。 |
| BUG-014 | 仍存在 | close 后旧鉴权仍发一次只读调用，桩内红；代次完整矩阵 PENDING / B06。 |
| BUG-020、SEC-004 | 仍存在 | 重放边界与端点信任/ACL 证据 PENDING / B06。 |
| BUG-018 | 仍存在 | 进程启动与队列确认 PENDING / B07。 |
| BUG-021、BUG-023、CLN-003 | 仍存在 / 存疑保留 | 归档、可见性与实际消费路径 PENDING / B08。 |
| SEC-005 | 仍存在 | 四个锁仍解析 `14.3.2`，安全版本断言红；未运行极端输入；发布物及普通文档验收 PENDING / B09。 |
| SEC-006 | 存疑保留 | 按原审计逐公告核可达性，不能单凭锁宣告生产漏洞 / B09。 |
| DOC-003、DOC-005、DOC-007 | 仍存在 | 发布、版本、cwd 验收 PENDING / B10。 |
| DOC-002、DOC-004、DOC-006、SEC-001 | 仍存在 | 平台支持、上游来源、历史凭据说明、行内补全声明 PENDING / B11。 |
| BUG-019、BUG-024、OPT-001、OPT-002、CLN-004、CLN-005 | 仍存在 / 存疑保留 | 依赖前序结论；维持现状，需独立复核 / B12。 |

历史关闭项 BUG-001–007、SEC-002、CLN-001 不重开。其原有验收范围不覆盖本表的跨模块问题。CLN-002 没有可删除零引用项的新增证据。

## 漂移重锚表

审计与 B00 批前提交等同。下表为旧锚 → 现场复核的现锚，只列本批 ID 与 D2 的 DOC-001；后续批次按各自分支再重锚。

| ID | 审计锚 → 现场符号 | 是否仍存在 |
|---|---|---|
| BUG-008 | IPC `:171` → [`DshIdeChannel.open`](../src/vs/platform/dshClient/electron-main/dshIdeChannel.ts#L172)，[`DshIdeViewService.open`](../src/vs/platform/dshClient/electron-main/ide-view-service.ts#L74)，Host [`follow`](../src/vs/platform/dshClient/host/ide-view-host.js#L280)。 | 是；两个 owner 只建立了 A 的订阅。 |
| BUG-009 | content ctor `:46` → [`DshChatSessionContent`](../src/vs/workbench/contrib/dsh/browser/dshChatSessionContent.ts#L46) / [`getOrCreateChatSession` 缓存命中](../src/vs/workbench/contrib/chat/browser/chatSessions/chatSessions.contribution.ts#L1317)。 | 是；以真实缓存方法验证。 |
| BUG-010 | renderer `:544` → [`restorePending`](../src/vs/workbench/contrib/dsh/browser/dshChatSession.ts#L544)，传输 [`isFrame`](../src/vs/platform/dshClient/transport/dshIdeTransport.ts#L362)。 | 是；恢复已决议卡实测，其余终态验收保留。 |
| BUG-011 | widget `:3872` → [`_acceptInput` DSH 分支](../src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts#L3872)，原生 [`acceptInput`](../src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts#L3930)。 | 是；用真实入口验证是否接纳。 |
| BUG-012 | model `:394/:464` → [`acceptConversation`](../src/vs/workbench/contrib/dsh/browser/dshChatModel.ts#L394) / [`prependPage`](../src/vs/workbench/contrib/dsh/browser/dshChatModel.ts#L464)。 | 是；实时更新擦除已验证出现的较早记录。 |
| BUG-013 | consumer `:73` → [`accept`](../src/vs/workbench/contrib/dsh/browser/dshIdeConsumer.ts#L73) / [`apply`](../src/vs/workbench/contrib/dsh/browser/dshIdeConsumer.ts#L134)，Host [`refreshSnapshot`](../src/vs/platform/dshClient/host/ide-view-host.js#L942)。 | 是；阶段与合并各一条红。 |
| BUG-014 | factory `:224–257` → [`close`/`ensureImpl`](../src/vs/platform/dshClient/electron-main/dshIdeBackendFactory.ts#L224)，[`createLazyLaunchCaller`](../src/vs/code/electron-main/app.ts#L2022)。 | 是；不把一个后端的红当作两个 caller 全部验收。 |
| BUG-015 | composer `:252` → [`DshComposerSource.selectModel`](../src/vs/workbench/contrib/dsh/browser/dshComposerSource.ts#L252)，[`setModel` schema](../src/vs/platform/dshClient/common/dshIdeProtocol.ts#L809)。 | 是；真实 validator 拒绝额外的 `provider` 字段。 |
| SEC-003 | Host `:301` → [`IdeRemoteService.dispatch`](../src/vs/platform/dshClient/host/ide-service.js#L301)，[`DshIdeHostBridge.invoke`](../src/vs/platform/dshClient/host/ide-view-host.js#L497)，[`copyList`](../build/gulpfile.vscode.ts#L651)。 | 装配不对称仍在；不据此宣布远程越权。 |
| SEC-005 | 扩展锁 `:1632` 等 → [根锁](../package-lock.json#L13111)、[构建锁](../build/package-lock.json#L4625)、[扩展编辑锁](../extensions/extension-editing/package-lock.json#L100)、[Markdown 扩展锁](../extensions/markdown-language-features/package-lock.json#L1632)。 | 四处均为 `14.3.2`。 |
| DOC-001 | 手册 `:346` → [wireRevision 声明](../src/vs/platform/dshClient/common/dshIdeProtocol.ts#L22) / [合同门禁](../build/lib/dsh/verify/dshIdeVerify.mjs#L294)。 | 是；Host 配对证明未取得。 |

复扫按归档原样的 P07/P23/P26/P32 与 P19/P31，对固定提交运行 `git grep -I -P -c`（命中行数，仓库 / DSH 两目录）：`66/47`、`13/11`、`916/194`、`46/32`、`3173/73`、`12/11`。P23 的 11 行是实际 Host 调用，另两行是文档，不是生产命中。P07/P26/P32 与 P19/P31 包含声明、测试和重叠调用，只按上述 ID 的实际链路裁定，其余未逐条分类，不伪报为误报或新缺陷。浏览器侧和 Host 的静态扫描不替代 ACL 或鉴权实测。

## 批次施工记录

| 批次 | 原子边界 | 现状 / 回滚点 |
|---|---|---|
| B00 | 既有命令的实测基线；两份测试；本报告。 | 11 条目标断言按预期失败；全量矩阵有基线 FAIL。测试提交 `34b0135c`；台账可独立回滚，不涉及生产行为。 |
| B01 | BUG-008/009、DOC-001、SEC-003：D1 + D2，窗口与请求归属、共享校验、配对失配处理。 | **已落地（隔离证据）**；两半、契约、staging、门禁、手册与本台账同批。真机与发布验收 PENDING。 |
| B02 | BUG-010、BUG-017：D3，审批/问卷的终态、请求种类、恢复语义与问卷完整承接。 | **已落地（隔离证据）**；Host 桥、传输帧接收、视图基线、会话状态与命令入口同批。真机多窗与问卷验收 PENDING。 |
| B03 | BUG-011：D4，原生发送分流的附件与输入完成语义。 | **已落地（隔离证据）**；分流三态、完成路径、附件拒绝与转发同批。真机发送与图片验收 PENDING。 |
| B04 | BUG-012：D5，历史分页边界与换绑隔离。 | **已落地（隔离证据）**；模型层窗口/历史分离、游标与终止语义同批。真机长会话 PENDING。 |
| B05 | BUG-013：D6，合并窗口与世代恢复。 | **已落地（隔离证据）**；消费侧字段合并、世代判定与非 ready 语义同批。真机重建 PENDING。 |

隔离红测使用 `.red.ts`，仅由显式命令运行；旧用例、默认测试入口、门禁规则不变。对应测试修复后须随实现进入常规矩阵，其余红测保留原口径。B00/B01 各分配 6 个只读关注面，B01 使用 `glm-5.3-flash`；身份调用方分片未完整回交，由主控复查。并行结果只采纳可以回查源码、日志或公开声明的事实。

### B01：身份边界与版本裁决（已生效，隔离证据）

| 证据 | 本轮裁定 |
|---|---|
| 官方请求主体 | [rc.1 Typert 声明](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/typert/protocol/src/types.ts#L443-L510) 与 [rc.3 声明](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/typert/protocol/src/types.ts#L443-L510) 一致：Gateway 在调用上下文提供 `this.ctx.invocation.peer`；`principal` 由 Host 创建，不是请求 DTO。对照 [Gateway 调用准备](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/gateway/src/index.ts#L792-L875) 与 [Connection admission](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/connection/src/rpc-host.ts#L128-L162)：HTTP 与 WS 共享 admission；浏览器流与一元同属浏览器 owner peer；同一 API 连接的身份由其 Peer 生命周期限定。`ctx`、`viewId`、`sessionId` 都不是主体，也不能从相同 owner peer 推导出相同窗口。ASAR 的同版声明已对照，但其构建 commit 未证。 |
| 同一 bundle 与启动路径 | [staging](../build/gulpfile.vscode.ts#L639-L675) 将两半组装，[Host 拉起](../src/vs/platform/dshClient/host/ide-service.js#L119-L169) 从插件目录取载荷。[开发版接线](DSH-IDE改造开发手册.md#L667-L687) 与[后端装配](../src/vs/platform/dshClient/electron-main/dshIdeBackendFactory.ts#L49-L59) 允许独立选端点，故“总是配对”不成立。现有 revision 由 [IDE View Service](../src/vs/platform/dshClient/electron-main/ide-view-service.ts#L88-L96) 写入本地快照，不能据此认证 Host 半身。[契约门禁](../build/lib/dsh/verify/dshIdeVerify.mjs#L283-L329) 的版本下限与四个指纹也不等于运行配对。 |
| 磁盘样本与加载分离 | 只读比较 [留存归档](../dist/dsh-ide-2.0.0.tgz) 与现有安装目录的指定成员：`package.json`、IDE `runtime/app/out/main.js` 相同，`runtime/build-provenance.json`、Host `ide-service.js`、`ide-view-host.js` 不同。证实这五项中的差异，不能判定哪端更新、整个 IDE 载荷相同或当前已混跑。`Config.listConfigs(name: dsh-ide)` 返回 `absent`；未调用真服务、未做全量安装门禁。 |

DEC-012、DEC-013 仍为草案。既然配对不能视作默认事实，原子实现须走显式迁移：继续复用唯一协议，由 Host 独立表明契约身份，IDE 在第一次 chat `follow` / `dispatch` 之前确认，并在端点/连接代次变化后重新确认；新 Host 对相关远程入口也强制检查该身份。发布构建从同一协议真源生成身份并校验两半均包含它。比对的是契约，不是包版本、方法数、请求自报的主体或只存在于本机的环境变量。旧 Host／新 IDE 不可调用业务，新 Host／旧 IDE 不可调用业务，明确报告不相容；匹配两半应能正常操作。旧／旧只作为移交基线，不作为回退或支持模式。迁移版本、守卫形状和解冻条款须同批生效，不提前改 revision，也不利用开窗队列或鉴权错误重试掩盖不匹配。

| B01 可执行顺序 | 放行断言（尚未执行） |
|---|---|
| 1. 契约与边界先行：更新 [协议真源](../src/vs/platform/dshClient/common/dshIdeProtocol.ts)、[Host 入口](../src/vs/platform/dshClient/host/ide-service.js#L278-L308)、[官方传输适配](../src/vs/platform/dshClient/transport/dshIdeTransport.ts#L427) 与 [staging](../build/gulpfile.vscode.ts#L651)。 | 在仅有固定新/旧两种接口描述的本地测试中钉住匹配通过、两个混装方向拒绝；Host 使用真实共享 validator 和 Gateway 提供的活 owner（本地 IDE 场景），业务方法只走显式注册表。在服务桩前断言不相容或未授权不调用；不复现攻击，不发送真实请求。 |
| 2. 本地其余生产路径同步：单一 IPC 按连接持有视图和单调代次，视图的逻辑订阅独立，公用传输不等于共用活动会话；Host 由同一个桥按可信 peer 下的逻辑视图约束目标。 | 两窗各自跟随、切换、发/停和读目录，另窗无变化；异步新建/分叉不覆盖新代次；最后窗口只释放订阅，不取消会话。Host 列表通知与会话帧不同类，不以共享名单代表共享绑定。 |
| 3. 调用归类后一并迁移。 | Host `requireSession()` 11 处全部消除缺省：命令共用入口（权限/命令/回退）、`rewind`、`loadOlder`、`setModel`、`setEffort`、`composerState`、`setTeamEnabled`、`setAgentPreset`、`listCommands`、`setGoal`、`listSkills`。发送、停止、审批和资源读取各自明确有效对象，附件和命令只在合法资源桩中检验。显式行操作（rename、favorite、pin、move、open path、delete、archive、unarchive、fork）核对可见行，不强制先激活该行；列表缺省范围及能力探测按发起视图；模型目录等真正全局调用不借用活动会话。保留 DEC-003/004/009–011。 |
| 4. 原生 URI 激活：在 [原生激活点](../src/vs/workbench/contrib/chat/browser/widgetHosts/viewPane/chatViewPane.ts#L1522) 与 [缓存](../src/vs/workbench/contrib/chat/browser/chatSessions/chatSessions.contribution.ts#L1306) 接管重激活，在 [内容对象](../src/vs/workbench/contrib/dsh/browser/dshChatSessionContent.ts#L46) 按资源和代次接收。 | 真实 A→B→A 缓存命中，A/B 内容仍同时存活；未就绪保留该资源显示而拒绝错误目标，原生发送/停止路由取发起资源。停止按钮是否真正接上内容回调须另验，不由桩回调推断。仍用原生缓存，不新增 DSH 会话库。 |
| 5. 单次交付：生效的 DEC、手册 §5.2、旧新矩阵、端点清单、staging 传递依赖闭包和门禁一起更新。 | 第 1 步的配对与合法主体桩能跑通并锁定拒绝语义后，才能进入这份完整生产改动。所有 B01 红测按实际入口转绿；编译、源码类型检查、定向 Lint 和 DSH 常规矩阵通过；全量失败逐项和下表比较，不将任何未验或已失败项目算通过。提交前若不能完结，回到批前生产树，保留本节和测试取证。 |

## 瘦身报告与存疑保留

没有删除或依赖变动：根依赖 `66 → 66`、开发依赖 `93 → 93`、scripts `79 → 79`、根锁条目 `1536 → 1536`。批前跟踪 blob 总和 `165,360,039 B` 是仓库口径，新增变动只有测试和本文，不是发布负载变化，未重打包。现存空文件、fixture、许可证、来源凭据、测试门面与被调用的裸帧入口不动。`agentsWindow` 有读路径；`dsh.hostBaseUrl` 的外部设置与迁移还未排除；旧列表 DI 与动态消费者仍待查。删除后旧名单可能再显示、收藏/置顶无星标，按已知限制保留，不另立问题。

## 假设与 PENDING 台账

| 未证事项 | 本批结论与补证条件 |
|---|---|
| 真实加载与授权 | 当前运行目录没有活跃的 `dsh-ide` 实例。官方 Peer 声明可用不等于本项目已经消费；授权范围、附件对象准入和接线保留 PENDING。 |
| SEC-003 入口边界 | 只证共享校验器未装配；不据此断言远程越权。不跑攻击复现，待用正常本地业务桩验收允许路径和拒绝语义。 |
| SEC-005 适用范围 | 两条公告的 14.x 修复都为 `14.3.3`。实际 bundle 版本、普通文档行为及性能预算需在 B09 验证。 |
| 全量与发布 | 本机基线按下表对照，真实安装、ACL、ABI、配对和发行验收仍 PENDING；不改变 profile、生产设置或过滤规则来取得 PASS。 |

## 验证与不变量校验对比

| 门禁 | B00 | B01 取证（基线与测试暂存稿分开） |
|---|---|---|
| `npm run compile` | PASS：串行重跑 135.2 s，`compile-src` 0 errors；先前 `tsgo` 退出 2 的原因未证。 | PASS：测试稿 99.6 s、`compile-src` 0 errors。 |
| 源码无产物类型检查 | PASS：`node node_modules/@typescript/native/bin/tsc --project src/tsconfig.json --noEmit --pretty false`。 | PASS：暂存稿同命令退出 0；`build-dsh-tests` 转译同样 PASS。 |
| 全仓 ESLint | FAIL：106 errors + 1,028 warnings。 | FAIL：完整 B00 提交上为 104 errors + 1,027 warnings。档差是 B00 初次扫描时尚未移除的临时 `.mjs` 的三条诊断，不是生产修复。两份补充测试定向 Lint PASS。 |
| `npm run test-node` | FAIL：13,803 通过 / 136 pending / 2 失败。 | FAIL：相同计数与失败点；运行时无法加载 Kerberos 绑定；[Workspace Trust 源码](../src/vs/workbench/services/workspaces/common/workspaceTrust.ts#L71-L82) 返回 `false`，既有[测试](../src/vs/workbench/services/workspaces/test/common/workspaceTrust.test.ts#L57-L63) 期望 `true`，不是环境变量可以修正的断言差异。 |
| 开发 Electron 单测 `scripts/test.bat --reporter dot` | FAIL：18,523 通过 / 144 pending / 66 失败。 | FAIL：18,505 通过 / 144 pending / 66 失败；排序、Kerberos 解析与多类超时仍在；两次出现的失败套件并非完全一致，不单凭数量归因。是隐藏单测窗口，不是真机。 |
| 构建脚本项目直接 `--noEmit`（附加诊断） | FAIL：165 条不落在新增红测的诊断；不执行构建包生成前置步骤。 | PENDING：未重跑，不代替源码项目类型门禁。 |
| DSH 常规矩阵 `DSH_INSTALLED_VERSION=0.2.2-rc.3` | PASS：5 步；Mocha 7，Node 417。 | PASS：暂存稿与还原后实跑均为 5 步、Mocha 7、Node 417，无失败；不证明发布。 |
| 隔离红测（B05 后） | Node 9 + 原生 2 条目标断言失败。 | Node 20 条中 18 条转绿，余 2 条属 B06–B09（BUG-014、SEC-005）；原生 10 条全绿。 |
| Host 半身用例（B05） | 85 项 | PASS 88/88。 |
| 常规 DSH 矩阵（B05） | PASS 417 | PASS 422/422，五步全 PASS。 |
| 分流单测（B03） | 4 项 | PASS 6/6（新增不可用不分流、入库引用转发、未入库拒绝）。 |
| Host 半身用例 | 85 项 | PASS 85/85（改从转译产物加载共享契约，含新增身份确认与可见行语义）。 |
| 常规 DSH 矩阵 | PASS 417 | PASS 417/417，五步全 PASS；契约、边界、投影与单一真源门禁同批更新到 revision 5 与工厂装配。 |
| 代码级不变量 | 单一通道、协议和传输；revision `4`、停止/发送及现有装配不变。 | 与 `2c448cbd` 比较，含许可证、PROVENANCE、打包、手册在内的所有非报告跟踪文件零差异；SEC-003 未修，现有门禁的通过不掩盖该项。 |

覆盖率单列为 **既有 DSH Node 测试 417 项**，Node.js `24.18.0` V8 LCOV，只计报告内出现的被测文件，排除测试文件；不是全仓覆盖率，编译前后不混用分母。红测结果不混入覆盖率：

| 范围 | 文件 | 行覆盖（已覆盖 / 总） | 分支覆盖（已覆盖 / 总） |
|---|---:|---:|---:|
| `src/vs/platform/dshClient` | 16 | 5,031 / 5,964（84.36%） | 1,049 / 1,457（72.00%） |
| `out/vs/platform/dshClient` 与 `out/vs/workbench/contrib/dsh` | 19 | 2,887 / 4,903（58.88%） | 756 / 1,036（72.97%） |

关键路径绝对已覆盖行：`src` 的协议 1,796、Host 1,226、传输 385；`out` 的视图通道 172、视图宿主 173、会话 373、聊天模型 300、Consumer 100。B01 实测 417 项通过，两组行、分支的覆盖数和分母相对 B00 **均为 Δ0**。以上是载入文件的 V8 LCOV，不包含未覆盖的鉴权工厂或原生 UI。

原始日志：`%TEMP%\DSH-IDE-B00-matrix-20261118-170903`、`%TEMP%\DSH-IDE-B01-preflight-20261118-175550`。B01 的五条新断言在暂存稿上执行后已还原；保留的 `b01-fixtures.patch` SHA-256 为 `eab5eab03a6a55e7cb13f333b5c7ea22c1a5acaf2d070fef652b639359128f98`，已在还原后的测试文件上运行 `git apply --check`。原子实施时从仓库根先核对该 SHA，再应用补丁：

```powershell
$patch = Join-Path $env:TEMP 'DSH-IDE-B01-preflight-20261118-175550\b01-fixtures.patch'
if ((Get-FileHash -LiteralPath $patch -Algorithm SHA256).Hash -ne 'EAB5EAB03A6A55E7CB13F333B5C7EA22C1A5ACAF2D070FEF652B639359128F98') { throw 'B01 补丁内容与取证不符' }
git apply --check -- $patch
if ($LASTEXITCODE -eq 0) { git apply -- $patch }
```

隔离红测复跑（Windows，开发 Electron 已备好；维护者要核对目标断言，而非仅看退出 `1`）：

```powershell
npm run build-dsh-tests
node --test --test-reporter=spec build/lib/test/redwall/b00.red.ts
$env:VSCODE_SKIP_PRELAUNCH = '1'
cmd.exe /d /c 'scripts\test.bat --run src/vs/workbench/contrib/chat/test/browser/widget/dshB00.red.ts'
```

同口径覆盖率（使用已转译的 `out`）：

```powershell
$script = (Get-Content -Raw -LiteralPath 'package.json' | ConvertFrom-Json).scripts.'test-dsh:all'
$tests = @($script -split '\s+' | Where-Object { $_ -match '\.test\.(ts|mjs)$' })
node --experimental-strip-types --test --test-force-exit --experimental-test-coverage '--test-coverage-include=src/vs/platform/dshClient/**/*.js' '--test-coverage-include=src/vs/platform/dshClient/**/*.ts' '--test-coverage-include=out/vs/platform/dshClient/**/*.js' '--test-coverage-include=out/vs/workbench/contrib/dsh/**/*.js' '--test-coverage-exclude=**/test/**' --test-reporter=lcov @tests
```

## 风险与回滚方式

B01 的两半、契约及现行手册仍未改；按提交回滚测试和报告即可回到 `2c448cbd` 的跟踪文件状态，不触碰原有用户文件或产物。触发下一次原子迁移的是上节第 1 步两端存在可验证的配对和身份约束，不是让当前旧版先通过它不具有的检查，也不是等真机发布后才施工。全量仍失败必须如实记录，并按相同运行时及测试入口逐项对照，不关闭 Workspace Trust、不放宽门禁、不以计数相同掩盖不同失败。

## 手册增补建议

B00 的草案不覆盖手册冻结条件，README 与手册均未改。B01 只有在成对版本、请求身份与 Host 守卫生效时才同步 §5；B04 以 rc.3 声明核对 DEC-001；B10 对齐门禁分级与定位；B11 一次核对平台承诺和历史引用。历史 PROVENANCE 保留原文，新的澄清只写现行资料。

## 路线图

B01 先从新旧配对和可信主体的隔离测试进入原子迁移，不重复已经完成的磁盘和上游声明核对，也不并行进入依赖批次。随后按 B02 终态、B03 发送与选择、B04 历史、B05 世代、B06 鉴权、B07 开窗、B08 列表、B09 供应链、B10 门禁、B11 声明、B12 清理与性能推进，保持依赖与批内原子性。

## 待真机与发布验收清单

**均为 PENDING**：多窗真实运行与审批、Windows ACL、宿主 ABI、新构建两半的字节一致性、完整安装漂移检查、原生端到端和真实性能预算。现有磁盘五成员比较是局部证据，不是完整安装门禁。未安装、未打包、未启动 GUI 验收、未触发发布。

## 信息缺口与版本证据

全仓行/分支覆盖、已安装插件两半身份、实际 ACL、原生失败族归因及后续公告逐包可达性未穷尽。取证源访问日期为 2026-11-18：[VS Code 1.143.1 标签](https://api.github.com/repos/microsoft/vscode/git/ref/tags/1.143.1)（`e6468682`，实际缓存行为以仓库与测试为准）、[DSH rc.3 事件和分页声明](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/src/types.ts)、本机同版桌面声明、[Node 24.18.0 子进程错误事件](https://nodejs.org/download/release/v24.18.0/docs/api/child_process.html#event-error)、[SemVer 2.0.0 §9–11](https://semver.org/spec/v2.0.0.html)、[SEC-005 参考解析公告](https://api.osv.dev/v1/vulns/GHSA-gfr2-rv44-r23c)及[HTML 解析公告](https://github.com/advisories/GHSA-vfgh-jcmw-g37q)。未运行同步脚本、未写参考仓库 refs。

## 批次状态对照

| 状态 | B01 实现结果 |
|---|---|
| 已闭环 | BUG-008、BUG-009、DOC-001、SEC-003 在隔离用例上转绿；契约升到 revision 5 并两半同时拒绝不匹配。 |
| 仍存在 | BUG-010/012/013/014/015、SEC-005 等按批次保留；全量 Node、Electron、ESLint 基线仍 FAIL；真机与发布验收 PENDING。 |
| 新引入 | 契约 revision 5 使旧 Host 与旧 IDE 互相拒绝业务调用，这是有意的失配拒绝。 |
