# DSH Host 替代范围评审稿

日期：2026-11-19（Asia/Shanghai）

本文件记录评审时的证据。随后只删除了没有运行入口的依赖：根与 remote 的 `@devcontainers/cli`、`ssh2`，以及根上的五个 `@microsoft/dev-tunnels-*` 和仅被它们使用的传递依赖。Host 可替代但尚未接通的功能、终端、搜索、数据库、语言服务和普通扩展能力都没有删。
## 接入进度（2026-11-19）

| 编号 | 状态 | 说明 |
| --- | --- | --- |
| S01 语音听写 | 已接入 | 注册 `DshChatSpeechToTextService`；新增 `speechCatalog` / `speechTranscribe` 通道方法，Host 转发官方 `speechController`。未就绪时入口不可用，不再回落 MAI。旧实现已删除，只保留接口定义。 |
| S02 行内补全 | 已接入 | 新增 `inlineComplete` 通道方法；只发光标前 4000 字与当前行后缀 2000 字；Host 用已选模型生成。README 与 SEC-001 红线已同步。 |
| S05 附件入库 | 已接入 | 新增 `saveImageAttachment`；聊天里尚未入库的图片先经官方 `attachments.saveImages` 入库再随消息提交，失败时保留草稿。 |
| S06 目标写入 | 已接入 | 新增 `dsh.goal` 命令与命令面板入口，创建/暂停/恢复/完成/清除都走已存在的 `setGoal`。 |
| S10 账户登录 | 已接入 | 新增 `accountStartSignIn` / `accountCancelSignIn`；登录按钮打开 Host 返回的授权地址并刷新状态，不再只开 usage 页。 |
| S03 DSH MCP 管理 | 已接入 | 新增 `mcpListServers` / `mcpRestartServer` 和 `dsh.mcp` 命令；只管理 DSH 的 `mcpManager`，IDE 原有 MCP 扩展栈保留不动。 |
| S07 DSH 后台 Jobs | 已接入 | 新增 `jobList` / `jobKill` 和 `dsh.jobs` 命令；只覆盖 DSH 自己的后台作业，IDE 的 TaskService 与扩展任务保留。 |
| S04 AI 浏览器 | 不构成平替 | 官方 `browserUse` 只有唯一 provider 注册与资源归属，没有 Remote 方法；Playwright MCP 是独立进程。IDE BrowserView 与 CPU profiler 仍用 `playwright-core` / `chrome-remote-interface`，不能删。 |
| S08 共享任务 | 已接入 | 快照投影新增 `agentTeam` → `team`（enabled / tasks / failure），历史里显示任务进度；任务的创建与修改仍只在 DSH 会话内发生。 |
| S09 工作树 | 仅展示 | `worktrees` 服务没有 Remote 方法；快照投影新增 `worktree` → `worktrees`，历史里显示分支与是否继承。Git 扩展的工作树命令保留。 |
| 听写本地骨架 | 已删除 | 听写改走 DSH 后，`ILocalTranscriptionService`、`NullLocalTranscriptionService` 及两个入口注册已无人消费，连同 `localTranscription.ts` 三个文件移除。 |
| S11 插件配置与存储 | 无需接入 | DSH 各功能窗口侧没有自建持久化，模型/权限/预设/团队全部读 Host 投影。`@vscode/sqlite3`、`@vscode/spdlog`、`deviceid` 是 IDE 全局消费者，不能删。 |
| 死代码清理 | 已删除 | 移除无调用方的 `openInApp` / `dismissQuotaNotice` 通道方法及其校验与 Host 空实现；移除听写模块里已无消费者的后端判定与文本整理函数。 |
| 残留依赖 | 已删除 | `@types/ssh2`（无任何 `ssh2` 导入）与 remote 的 `@vscode/copilot-api`（源码零引用）从清单、锁与安装目录移除。 |
| 通道空壳 | 已删除 | `addAttachment` / `removeAttachment` 无任何调用方，连同定义、校验、Host 空实现移除；协议测试夹具同步到 49 个方法。 |
| 测试基线修复 | 已完成 | `dshIdeEndpoints.test.ts` 三处硬编码的 43 方法断言与四个已删空壳断言同步到现状；`dsh*.test.ts` 通过。 |
| 团队/工作树回归修复 | 已完成 | `dshIdeConsumer` 的合并窗口键补上 `team` / `worktrees`；换绑时清空两者，避免上一个会话的任务板与工作树串到新会话；新增 4 条投影单测。 |
| 听写提示死读取清理 | 已删除 | `micButtonHovers.ts` 的 `getDictationDescription` 读了 `dictation.model` 的两个值再用 `void` 丢弃，注释还声称「Names the model dictation actually uses」——实际不显示任何模型名。已移除死读取与失效参数传递；DSH 下该设置只有「DSH Host」一个取值。 |
| 打包与测试的顺序约束 | 已记录 | `gulp dsh-ide-pack` 的 `clean-app` 会清空 `out/`，之后直接跑 `build/lib/test/dsh*.test.ts` 会有 16 个文件因找不到 `out/**` 模块而失败（不是断言失败）。跑测试前必须先执行 `node build/next/index.ts transpile` 重新生成产物。 |
| 三面一致性守护 | 已完成 | 新增测试断言「契约 49 个方法 ↔ Host 49 个 handler 逐一对应、无孤儿无遗漏」，已用注入 `bogusOrphan` 验证能准确报错。至此契约、Host、客户端三面由测试强制同步。 |
| 完整门禁 | 已完成 | 从已安装 DSH `0.2.2-rc.5` 取得版本（高于契约校验版本 `0.2.2-rc.1`），`verify:dsh-ide-release-gate` 四条门禁全部 PASS：protocol-single-source、boundary、projection-golden、contract。此前 contract 的 PENDING 是未设 `DSH_INSTALLED_VERSION` 所致。 |
| 产物门禁 | 已完成 | `verify:dsh-artifact` PASS；`dshArtifactContents.mjs` 的期望模块清单漏了 `dshIdeProtocol.js`（打包实际包含 11 个，脚本只列 10 个），已补齐。`protocol-single-source` / `boundary` / `projection-golden` 均 PASS。 |
| 打包实测 | 已完成 | `gulp dsh-ide-pack` 完整跑通（4 分 02 秒），产出 `dist/dsh-ide-2.0.0.tgz` 140,025,477 字节（旧包 142,011,142）。产物内确认五个新命令、`speechCatalog`、`inlineComplete` 均存在，`voiceCodeTranscriptionClient` 与 `ILocalTranscriptionService` 已不在。顺带修复 `build/next/index.ts` 把 Windows 临时文件删除失败误报为语法错误的问题。 |
| 远程补全死方法删除 | 已删除 | `ide-service.js` 的 `@Remote inlineComplete`（约 42 行实现 + 描述符条目）无任何调用方，已移除；其余 `@Remote` 方法（ping/launch/registerIdeClient/followSession/dispatch）仍是客户端传输主通道，保留。 |
| 测试去硬编码 | 已完成 | 方法数量断言改为「夹具与契约 `DSH_IDE_METHOD_KEYS` 逐项比对」，不再写死数字；已用临时删条目验证该断言能准确报出缺失的 method。 |
| 通道测试同步 | 已完成 | `dshIdeChannel.test.ts` 仍写死 43 个方法与四个已删空壳，已同步到 49 个方法；`product.ts` 里指向已删 `build/dictation-runtime` 的注释也已修正。 |
| 旧转写客户端删除 | 已删除 | `VoiceCodeTranscriptionClient`（408 行）只服务旧 MAI 听写，听写改走 DSH 后无任何业务消费者，连同注册与 375 行测试移除；Voice Mode 的 `voiceClientService` / `voiceEndpoint` 保留。 |
| 命令可达性修复 | 已完成 | `dsh.toggleTeam` / `dsh.searchSessions` 原先只有命令注册、无任何入口，已补命令面板 action；移除 `chatServiceImpl` 里与 DSH 贡献点重复注册的 `dsh.newSession` 占位实现。 |
| 接入测试补齐 | 已完成 | 语音、补全、附件入库、账号、MCP、作业的新通道方法与 team/worktrees 字段原先没有单测，现补入参校验与 Host 落点断言；`dsh*.test.ts` 全部通过。 |
| 手册口径同步 | 已完成 | `DSH-IDE改造开发手册.md` 的 method 数、typed 字段数、wireRevision 与 missing 空壳描述全部对齐当前实现；§5 的「冻结」改为「稳定性 + 受控扩展流程」，明确新增能力必须走唯一通道而非旁路。 |

以上所有改动的类型检查均通过（`npx tsc -p src/tsconfig.json --noEmit`），Host 桥接脚本通过 `node --check`。未运行 GUI，未做真机验证。剩余候选均无静态证据支持进一步删除。


## 固定版本

- 本地仓库：E:/DSH-IDE，HEAD 65a0ac116f26b2dede3a29cff4e736c3b4ffb3ce。
- 评审开始时已有 32 项未提交改动，清单见同目录 existing-changes-not-this-review.json。那些改动不是本评审批准的删除。
- 官方源码只在线阅读，提交 2e39e704（2026-11-18，0.2.2-rc.5 同步到 master）。没有克隆整仓。
- 本地契约常量仍写 0.2.2-rc.1。官方源码存在，不等于这台机器的 Host 已经挂上对应服务。

## 评审结论

1. 已经接到 Host 的，只记录复用事实，不作为删除对象。
2. 官方有对应服务、插件还没接上的，可以列为以后接入的对象；现在删掉现有实现会造成空窗。
3. 终端、搜索、数据库、沙箱有相近能力，但接口不是替换件。完整适配之前不能删包。
4. 编辑器渲染、语言服务、扩展网络、SecretStorage、Windows 本机能力应保留。
5. dev-tunnels、ssh2、Dev Containers CLI 已删除；根上的 ws / zod 仍被 `chrome-remote-interface` 与 `@vscode/sandbox-runtime` 使用，`@vscode/fs-copyfile` 被 Git 扩展使用，三者保留。

65 个直接生产/可选依赖里，本表未归类的有：无。八个 @xterm/addon-* 归在 A01。
被标成可立即删除的项：0。

## 已复用，不要再当成待删重复实现

### R01 Electron 与插件框架运行时

现状：IDE开窗取DSH的process.execPath，插件根声明Cordis/Typert/React等peer依赖。

Host：宿主Electron与Host插件上下文已经是共享来源。

评审范围：记录已经完成的复用；不是新增删除项。

必须留下：host/、common/、index/client适配、窗口上下文和协议校验。

先删再接的后果：删掉插件入口或Host适配会使窗口打不开或断联；同应用不等于无进程边界。

缺口：未运行窗口启动验证；本机宿主版本/已挂载服务未读出。

本地证据：L01、L07、L08；官方证据：无

### R02 DSH会话、历史和生成生命周期

现状：prompt/follow/cancel/create/fork/list/page/search通过当前Host桥调用；ChatWidget有DSH发送分支。

Host：sessionController与sessions承担生成、持久化和内容流。

评审范围：继续使用同一DSH会话真源，不再建设另一套DSH会话存储。

必须留下：DSH内容provider、history投影、ChatWidget，以及普通扩展会话API。

先删再接的后果：删除这些消费与适配代码会失去DSH发送/历史展示；不能把界面层当重复后端。

缺口：回退/收藏/移动/永久删除部分依赖另装插件，不能一概算core默认能力。

本地证据：L09、L10、L11、L18；官方证据：U21、U20

### R03 模型目录、选择和推理档

现状：目录与effort已走Host；通用sendChatRequest仍抛错，token计数返回0。

Host：Host模型目录投影与sessionController选择接口。

评审范围：仅目录和选择的宿主复用已成立。

必须留下：普通扩展LanguageModel API、模型选择UI与DSH适配。

先删再接的后果：删除目录适配会失去选模型；删除通用LM API不会自动获得Host推理。

缺口：目录投影不是流式通用推理/取消/token计数的等价证明。

本地证据：L12、L13、L14、L72；官方证据：U35、U21

### R04 DSH工具、权限审批和问卷

现状：DSH会话工具由Host运行，审批/问卷通过waterfall和answer方法回写。

Host：工具执行流水线及现有Host审批事件。

评审范围：复用DSH执行与审批主体，不重复创建工具运行时。

必须留下：原生LanguageModelToolsService、扩展工具API、IDE审批展示与有限问卷适配。

先删再接的后果：删原生工具服务损害普通扩展；删DSH审批桥会失去IDE内审批。

缺口：复杂问卷目前可能要求回到DSH桌面；不等价覆盖全部原生工具和MCP生命周期。

本地证据：L31、L32、L34、L74；官方证据：U30

### R05 DeepSeek账户状态和资料显示

现状：头像/名称读取通过deepseekAccount.getState/getProfile；登录按钮仅打开链接。

Host：Host的DeepSeek账户投影。

评审范围：账户资料显示已复用，登录全生命周期另见S10。

必须留下：普通GitHub等扩展认证、DSH账户读取适配。

先删再接的后果：删除读取桥会丢失资料显示；删除其他认证服务不产生DSH登录能力。

缺口：未证明登录完成、撤销和扩展身份体系兼容。

本地证据：L27、L28；官方证据：U26

### R06 技能、目标、计划、Todo展示及团队开关

现状：listSkills及摘要、goal/plan/todo投影、setTeamEnabled已经接入。

Host：sessionSkillCatalog、goals、plan-mode、todo日志及agentTeams。

评审范围：记录已有展示与团队开关；目标写UI、共享任务和jobs另列。

必须留下：Prompt/Skill编辑与发现服务、可见状态投影、团队开关命令。

先删再接的后果：删除这些现有适配会移除已工作的入口，不构成减重替代。

缺口：Host技能摘要不等于原生提示词系统/扩展技能编辑的完整替代。

本地证据：L13、L23、L24、L26、L73、L74；官方证据：U17、U23、U24、U25、U29

## 以后可以接入 Host，但现在不能删

### S01 语音识别后端改由DSH承担

现状：当前注册ChatSpeechToTextService，设置默认MAI；DSH类存在但未注册，speech方法不在通道白名单。

Host：speechController公开catalog/follow/configure/prepare/cancelPreparation/transcribe；Host选择provider并管理就绪与限额。

评审范围：替代识别provider、模型准备和转写执行；本轮只提出对象，不改路由。

必须留下：麦克风采集、音频编码、UI状态、Chat/编辑器/终端表面接口及必要共享类型。

先删再接的后果：整删原服务文件会连DSH适配导入一起破坏；只删当前实现则听写空窗，尚无替代接通证据。

缺口：G01/G02/G03：本机服务与provider就绪未验证；当前适配形状、取消与多表面行为未验证。不得将MAI迁移称为Host复用。

本地证据：L02、L03、L16、L17、L18、L19、L20、L21；官方证据：U01、U34

### S02 AI行内补全与专用推理入口

现状：Host半身已有inlineComplete且调用llm.stream；renderer明确未注册，通道尚未纳入。

Host：现有Host模型服务与插件Host侧补全实现。

评审范围：仅AI补全推理后端；普通语言服务另见N02。

必须留下：编辑器补全provider接口、取消/流式契约、普通扩展LM API。

先删再接的后果：删补全框架或通用LM服务不会让Host方法自动可达；当前未接通模块不存在已证明可删替身。

缺口：缺同一通道可达性、取消与结果语义证明；原型接口与完整模型请求仍不等价。

本地证据：L03、L09、L14、L15、L72；官方证据：U35、U21

### S03 DSH MCP连接管理及资源目录

现状：DSH agent已有自己的MCP；IDE仍注册独立MCP服务和远程/扩展/工作区发现，dshIde无MCP方法。

Host：mcpManager可管理设置驱动的连接，提供restart/probe/watch与授权生命周期；mcp-client负责协议。

评审范围：针对DSH连接的管理、状态和资源供给可以由Host提供；不能把普通扩展MCP一并删除。

必须留下：IDE MCP扩展API、远程位置、资源文件系统、普通工具/提示词发现，直到有等价证据。

先删再接的后果：先删当前注册会使MCP管理/资源/工具消费者失去实现；DSH agent能调用工具不填补这些UI。

缺口：连接身份、OAuth、sampling/elicitation、resources/prompts与远端位置未完成等价核验。

相关包：@vscode/sandbox-runtime、undici、ws、zod
本地证据：L03、L33、L34、L50；官方证据：U19、U33、U30

### S04 AI浏览器自动化执行

现状：IDE仍有可达PlaywrightService/CDP页面组和浏览器工具注册。

Host：Host有browserUse provider注册与独立Playwright MCP provider，管理Agent所属浏览器资源。

评审范围：仅AI浏览器任务的执行、页面归属与结果采集。

必须留下：IDE BrowserView/预览、页面权限/会话隔离；CPU profiler使用CDP是独立消费者。

先删再接的后果：直接删除playwright-core会破坏当前IDE浏览器调用；删chrome-remote-interface还会影响CPU分析。

缺口：本机Host provider未确认；页面身份、授权及生命周期不能靠同用Playwright推定一致。

相关包：playwright-core、chrome-remote-interface
本地证据：L46、L47、L48；官方证据：U11、U12、U32

### S05 DSH附件入库、读取与上下文供给

现状：已入库图片可提交；Host readAttachment已有，add/remove为stub；普通粘贴缺入库信息时拒发。

Host：attachments提供图片持久化/读取，session输入接收附件；workspaceFiles提供读取和名称搜索。

评审范围：DSH会话附件和上下文的业务真源；不是整个IDE文件系统。

必须留下：附件UI、拖放/粘贴、预览、编码、校验与编辑器上下文选择。

先删再接的后果：删除当前UI/适配使附件不可提交或展示；Host存储不会自动建立粘贴上传链。

缺口：普通文件和非image上下文未证明转发闭环；readAttachment尚缺当前renderer消费。

本地证据：L11、L22、L23、L25；官方证据：U28、U20、U04、U05

### S06 目标管理的写操作

现状：setGoal已入白名单且Host handler真实调用goals；当前workbench未发现调用该方法的UI。

Host：goals.create/edit/pause/resume/complete/clear与CAS引用。

评审范围：DSH长期目标写操作由Host提供；没有发现另一套可删IDE目标执行器。

必须留下：现有goal/plan/todo展示和唯一会话身份。

先删再接的后果：删现有投影会丢状态展示；此项主要是未消费能力，不应自动生成删除项。

缺口：UI调用、revision冲突、失效目标和动作结果尚未验证。

本地证据：L03、L23、L26；官方证据：U17

### S07 DSH后台Jobs管理

现状：dshIde无jobs方法；普通IDE TaskService与扩展任务仍有消费者。

Host：jobs注册表及jobController.list/output/kill按所有者管理后台工作。

评审范围：DSH启动的后台任务和输出观察。

必须留下：普通IDE构建任务、问题匹配器、custom execution、终端任务及调试任务。

先删再接的后果：删除TaskService会损害扩展构建任务；Host jobs不会自动成为TaskService后端。

缺口：所有者身份、输出流、取消/终止和任务事件尚未映射。

本地证据：L03、L61、L62；官方证据：U18、U27

### S08 DSH共享任务和团队管理

现状：当前只证明团队开关及部分展示已接，未证明完整共享任务UI。

Host：agentTeams.createTask/updateTask与任务归属/修订管理。

评审范围：DSH成员和共享任务业务，不是另造IDE团队运行器。

必须留下：已有setTeamEnabled、会话列表与消息展示适配。

先删再接的后果：删除已接开关会损害现有操作；没有已证明可删除的重复团队执行引擎。

缺口：成员生命周期、任务修订、暂停/恢复与结果展示未验证完整窗口闭环。

本地证据：L03、L13、L26；官方证据：U23

### S09 DSH会话工作树管理

现状：无DSH worktrees窗口方法；Git扩展有用户命令及worktree add/remove实现。

Host：worktrees.create/restore/enter/exit与DSH会话目录、权限和归档生命周期相连。

评审范围：DSH所有的会话工作树业务。

必须留下：普通Git/SCM工作树命令、远程仓库、未提交修改和Git扩展文件包含/链接规则。

先删再接的后果：删Git worktree实现会移除现有用户命令，Host暂没有窗口契约承接。

缺口：DSH所属与任意用户工作树的归属、dirty状态、回收行为不等价。

本地证据：L03、L59、L60；官方证据：U13

### S10 DSH登录生命周期与插件专用凭据

现状：账户资料已接；sign-in/out和通用credentials桥未在当前方法表。

Host：deepseekAccount.startSignIn/cancelSignIn及credentials.resolve/set/unset、私有record接口。

评审范围：DSH账户及插件自己的凭据管理。

必须留下：普通扩展authentication和SecretStorage、命名空间与既有密文。

先删再接的后果：删现有认证/secret服务会使普通扩展无法取存秘密，并不会自动采用DSH账户。

缺口：登录回调来源、生命周期、扩展授权关系与秘密迁移无等价证明。

本地证据：L03、L27、L28、L29、L30、L71；官方证据：U26、U14

### S11 插件自有配置、业务持久化和日志

现状：Host半身本在DSH上下文；工作台还维护自己的全局/工作区数据库和多进程日志。

Host：settings、storage.domain/KV、ctx.logger与otel提供插件后端基础能力。

评审范围：插件未来新增的DSH业务配置/记录/日志可统一由Host持有；不能把整个IDE数据库划入。

必须留下：工作台state.vscdb、扩展存储、远端状态和低延迟日志。

先删再接的后果：删sqlite3/spdlog会影响仍存在的IDE消费者；此项没有证明整包可删。

缺口：数据域、事件、事务/崩溃恢复、日志轮转/输出通道未与IDE完整契约等价。

相关包：@vscode/sqlite3、@vscode/spdlog
本地证据：L08、L42、L43、L44、L45；官方证据：U07、U08、U22、U15

## 有相近能力，但要完整适配后才能谈减包

### A01 本地交互终端进程后端

现状：当前IPtyService直接node-pty并用headless xterm；window继续xterm渲染。

Host：terminalController有create/watch/retain/attach/rename/close；双向流有write/resize、输出/ack。

评审范围：有条件迁移本地终端进程所有权；不是删整个终端系统。

必须留下：xterm窗口渲染、任务/调试集成、远端PTY及扩展终端API。

先删再接的后果：现在删node-pty会使本地终端启动失败；删headless会影响重放/序列化；删xterm会失去显示。

缺口：IPtyService要求工作区布局、持久化revive、env、detach、binary、shell integration等；Host当前接口并非drop-in。

相关包：node-pty、@xterm/headless、@xterm/xterm
本地证据：L35、L36、L37、L38、L52；官方证据：U02、U03、U10

### A02 Agent命令执行与沙箱

现状：DSH自己的执行已受Host策略控制；IDE聊天终端和MCP仍有独立sandbox-runtime路径，含远端。

Host：subprocess.spawn/spawnTerminal与sandbox.confine按会话策略执行。

评审范围：针对DSH Agent动作统一执行与审批边界；可讨论迁移原生Agent工具消费者。

必须留下：普通用户终端、扩展启动、远端MCP的实际执行位置和权限语义。

先删再接的后果：直接删sandbox-runtime/rg会使现有消费者找不到CLI；本机Host不能替远端进程执行沙箱。

缺口：文件权限/网络限制、审批语义、cwd/env与远端执行未证明等价。

相关包：@vscode/sandbox-runtime、@vscode/ripgrep-universal、zod
本地证据：L50、L51、L52、L63；官方证据：U09、U10、U30

### A03 IDE文件服务、搜索和监视

现状：IDE使用rg流式内容搜索、Parcel递归监视、原生复制及编码转换。

Host：workspaceFiles可读文本/字节/list/stat/changes和文件名搜索；ctx.fs可写文本并提供有限watch。

评审范围：DSH上下文读写可直接复用；完整IDE IFileService/search后端尚非等价替代。

必须留下：递归监听、多根/远端目录、未保存文件、取消/流式搜索进度及文件保存事件。

先删再接的后果：直接删rg/watcher会损害搜索/热更新；删复制/编码库会影响Git及文件服务。

缺口：官方名称搜索不是内容搜索；watch默认可不支持，直系目录通知不是递归事件API。

相关包：@parcel/watcher、@vscode/ripgrep-universal、@vscode/fs-copyfile、@vscode/iconv-lite-umd、jschardet
本地证据：L39、L40、L41、L52、L83；官方证据：U04、U05、U31

### A04 工作台状态数据库和日志后端

现状：global/profile/workspace state.vscdb和扩展spdlog仍实际使用，非只有DSH会话记录。

Host：Host storage可持久化业务KV，logger/otel可接收插件自有日志。

评审范围：仅在完整数据域与服务契约匹配后讨论整体后端替换，当前仅有接口差距证据。

必须留下：普通扩展状态、跨窗口事件、存储恢复、远端数据域和输出通道。

先删再接的后果：删sqlite3导致状态数据库打不开；删spdlog影响现有原生日志/扩展输出。

缺口：需等价数据库/缓存/事件与崩溃恢复证据；扩展日志明确设计为本进程写入避免IPC。

相关包：@vscode/sqlite3、@vscode/spdlog
本地证据：L42、L43、L44、L45；官方证据：U07、U08、U15

## 应保留

### N01 窗口渲染、文本算法及本地格式处理

现状：xterm、KaTeX、Markdown/Mermaid、图标主题和diff/编码/压缩仍在IDE或内置扩展中执行。

Host：Host可复用来源素材/公共实现，但后台服务不能代替DOM/WebGL/WASM渲染与本地算法调用。

评审范围：记录保留边界，不列为Host服务替换删除对象。

必须留下：Markdown/Mermaid全运行依赖、终端渲染及附加组件、差异/编码/归档处理。

先删再接的后果：删除会丢显示/语法/预览/扩展安装等现有能力。

缺口：未找到保持相同IDE能力的宿主服务契约；不能按同名库借宿主node_modules路径。

相关包：@vscode/codicons、@vscode/diff、katex、@xterm/xterm、yauzl、yazl、tar
本地证据：L02、L38、L55、L56、L57、L58、L79、L81；官方证据：无

### N02 语言服务、语法高亮与语言检测

现状：语言扩展提供编辑器文档同步/诊断/补全；TextMate/Oniguruma、Tree-sitter与语言检测worker仍是消费者。

Host：Host LSP仅有goToDefinition/findReferences/goToImplementation/hover四种语义查询。

评审范围：AI可复用四种查询；不构成完整语言扩展替代。

必须留下：语言server、文档生命周期、补全/诊断/调试、编辑器高亮与worker。

先删再接的后果：删除语言扩展/解析库会损害日常编辑功能，Host四查询不会补齐。

缺口：官方公开边界已证实不是等价API；不因未来可能扩展而先删。

相关包：@vscode/tree-sitter-wasm、@vscode/vscode-languagedetection、vscode-oniguruma、vscode-regexpp、vscode-textmate
本地证据：L55、L56、L80；官方证据：U06

### N03 普通扩展网络代理、认证与远端IDE

现状：扩展宿主patch http/https/net/tls，原生request使用proxy/kerberos；远端另有扩展/文件/终端服务。

Host：Host可处理自身AI网络和SSH工具，但不是IDE resolver/extension host网络栈。

评审范围：AI请求可收敛；普通扩展与远端IDE能力保留。

必须留下：代理来源、证书、企业Kerberos、远端位置、远端扩展宿主和容器/隧道功能。

先删再接的后果：删代理/HTTP库会影响扩展网络；把Host SSH当远程IDE协议会丢resolver和持久IPC。

缺口：已查官方SSH此版本仅接受POSIX客户端，不能宣称可在当前Windows直接顶替全部SSH/隧道。

相关包：@vscode/proxy-agent、@vscode/os-proxy-resolver、http-proxy-agent、https-proxy-agent、kerberos、undici、detect-libc
本地证据：L49、L50、L52、L66、L68、L82；官方证据：U16

### N04 普通扩展SecretStorage与密文

现状：MainThreadSecretState按extensionId/key隔离且发送变更事件；Native依赖Electron safeStorage。

Host：Host credentials可服务插件凭据；没有完整VS Code秘密存储兼容层证据。

评审范围：DSH自有凭据在S10，普通扩展秘密不列当前可删除项。

必须留下：既有密文、命名空间、keys与变更事件、扩展授权。

先删再接的后果：先删会使普通扩展秘密读写失效，旧密文不能自动由Host读取。

缺口：现有存储格式、加密语义和跨窗口事件兼容均未证明。

本地证据：L29、L30、L71；官方证据：U14

### N05 Windows窗口、进程、策略和诊断

现状：键盘布局、前台窗口、进程树、互斥、注册表、OS组策略、watchdog和profiler有本地消费者。

Host：Host同样运行于Electron，但未发现一组等价公开服务可直接覆盖IDE窗口与扩展进程。

评审范围：插件纯系统查询可另核；当前没有整组可删依据。

必须留下：窗口/进程身份、键盘事件、权限提升、组策略、独立进程失活监视及性能分析。

先删再接的后果：删包会影响窗口交互/进程启动/调试诊断；同一Electron版本不是接口兼容证据。

缺口：需逐个进程/事件契约而非Host装有同库；系统策略不等于Agent沙箱权限。

相关包：native-keymap、native-is-elevated、windows-foreground-love、@vscode/windows-mutex、@vscode/windows-process-tree、@vscode/windows-registry、@vscode/policy-watcher、@vscode/native-watchdog、@vscode/sudo-prompt、@vscode/deviceid、open、minimist、chrome-remote-interface
本地证据：L07、L48、L67、L75、L76、L77、L78；官方证据：无

### N06 微软1DS遥测和TAS实验配置

现状：1DS与TAS仍有动态导入；是否运行取决于产品与用户配置，不能把开关关闭当包可删。

Host：Host otel能提供自有遥测通道，不提供微软TAS相同实验键、分配和同意语义。

评审范围：可评审是否取消旧产品遥测/实验；这属于产品裁剪，不是现成同接口平替。

必须留下：调用方默认行为、配置键与回退语义；DSH自身日志策略独立。

先删再接的后果：直接删1DS/TAS在相关分支启动时会模块缺失；改到Host上报也可能改变事件/同意规则。

缺口：当前product配置没有相关值不证明所有构建/分支均不可达；未评估关闭旧功能的产品决定。

相关包：@microsoft/1ds-core-js、@microsoft/1ds-post-js、tas-client
本地证据：L53、L54；官方证据：U15

## 仅裁剪候选，本轮不批准删除

### N06 微软1DS遥测和TAS实验配置

现状：1DS与TAS仍有动态导入；是否运行取决于产品与用户配置，不能把开关关闭当包可删。

Host：Host otel能提供自有遥测通道，不提供微软TAS相同实验键、分配和同意语义。

评审范围：可评审是否取消旧产品遥测/实验；这属于产品裁剪，不是现成同接口平替。

必须留下：调用方默认行为、配置键与回退语义；DSH自身日志策略独立。

先删再接的后果：直接删1DS/TAS在相关分支启动时会模块缺失；改到Host上报也可能改变事件/同意规则。

缺口：当前product配置没有相关值不证明所有构建/分支均不可达；未评估关闭旧功能的产品决定。

相关包：@microsoft/1ds-core-js、@microsoft/1ds-post-js、tas-client
本地证据：L53、L54；官方证据：U15

### C01 五个dev-tunnels根依赖

现状：源码与扩展未见运行导入；锁中connections/contracts/management/ssh/ssh-tcp相互依赖，不能按单包独立删除。

Host：没有已接上的Host等价IDE隧道方案；这不是Host替代证明。

评审范围：仅审查5个根声明、锁闭包及历史AgentHost残留。

必须留下：普通远程IDE、code tunnel CLI、resolver和远端扩展宿主。

先删再接的后果：在未证实完整闭包前，删除可能破坏构建/动态入口；五包内部消费者真实存在。

缺口：G04/G05：未重构建、未真机；动态/生成代码及distro例外未证实全空。peer版本不匹配是已有诊断，不是删包理由。

相关包：@microsoft/dev-tunnels-connections、@microsoft/dev-tunnels-contracts、@microsoft/dev-tunnels-management、@microsoft/dev-tunnels-ssh、@microsoft/dev-tunnels-ssh-tcp
本地证据：L63、L65、L66、L68、L85、L93、L94；官方证据：U16

### C02 根与remote的ssh2声明

现状：未发现当前src/extensions运行字面导入；根与remote仍声明并有锁节点。

Host：Host SSH工具能力不等于远端IDE；当前官方SSH provider还有限定平台。

评审范围：仅审查未用根/remote声明及独占传递闭包，不删除远端IDE。

必须留下：远端会话、VS Code SSH resolver扩展、独立任务/隧道能力。

先删再接的后果：未证实动态消费者全空前不能批准无损删除，remote已安装实例未核实。

缺口：无静态import不是可删充分条件；未来构建要验证真实产物。

相关包：ssh2
本地证据：L63、L66、L68、L85、L95、L97；官方证据：U16

### C03 根与remote的Dev Containers CLI

现状：未见源码运行导入；官方打包仍有解包规则，包自带可执行CLI且把实现打在bundle里。

Host：Host worktree/subprocess不是Dev Container配置与容器开发的等价实现。

评审范围：审查是否历史AgentHost遗留的根/remote CLI声明。

必须留下：用户容器开发、扩展API和独立扩展自己的依赖。

先删再接的后果：若尚有外部spawn或生成代码入口，会失去CLI；dependencies为空不代表无内部功能。

缺口：外部进程路径、构建产物及场景未证明不使用；不能依Host存在subprocess就删。

相关包：@devcontainers/cli
本地证据：L63、L85、L98；官方证据：U10、U13

### C04 类型与原生编译辅助依赖分类

现状：@types/semver属于类型声明；node-addon-api用于原生编译，打包已有排除规则。

Host：这些不是可迁给Host的运行服务。

评审范围：只审依赖类别与成品过滤，不把移到开发依赖等同于删开发环境安装。

必须留下：原生模块编译需要的headers、类型检查及各嵌套版本实例。

先删再接的后果：删node-addon-api可能破坏native编译；删类型依赖可能影响类型检查。

缺口：当前规则可能已不产出它们；没有可宣称的新包体收益。

相关包：@types/semver、node-addon-api
本地证据：L64、L85、L87、L88；官方证据：无

### C05 根ws与根zod的独立声明

现状：根声明的字面运行导入较少；CDP自有嵌套ws，sandbox有嵌套zod，Markdown扩展另声明zod/mini，版本与目录不同。

Host：Host能提供WebSocket/校验业务不代表普通客户端不需协议/校验库。

评审范围：只审根安装实例的消费者与显式打包复制，不动嵌套/扩展实例。

必须留下：Markdown扩展的zod、sandbox嵌套zod、CDP嵌套ws、跨进程DTO校验与协议实现。

先删再接的后果：整scope或同名全删会破坏其他组件；根zod当前还在打包real-file复制名单。

缺口：需分安装路径证明独占闭包和动态/外部进程查找；没有立即安全删除证明。 test/mcp仍直接import zod，但其直接清单未列zod，根安装实例是否供测试解析尚未证明。

相关包：ws、zod
本地证据：L33、L63、L84、L85、L86、L90、L92、L96、L99；官方证据：无

### C06 根fs-copyfile声明与Git扩展实例分离

现状：Git扩展源码import fs-copyfile，其自身清单声明且构建外部化后从extension/node_modules拷贝；未找到src/vs直接运行import。

Host：没有等价Host原生写时复制服务被证明；此项是依赖作用域核查。

评审范围：只审根package.json的fs-copyfile声明是否冗余，不删除Git扩展自己的实例。

必须留下：Git扩展复制实现、自己的fs-copyfile声明/安装/native ABI与打包闭包。

先删再接的后果：整名全删将破坏Git；仅移除根声明是否影响构建解析需要另证。

缺口：根/扩展node_modules真实解析与原生编译/打包路径未实测；静态字面引用不证明由根供给。

相关包：@vscode/fs-copyfile
本地证据：L83、L91、L70、L63；官方证据：无

## 证据文件

都在 C:/Users/guyu/AppData/Local/Temp/DSH-IDE-Host-Review-20261119/：

- review-candidates.json：33 项机器可读候选
- local-evidence-index.json：99 条本地片段，带文件 SHA-256
- upstream-evidence-index.json：35 条官方文件，带提交号、blob SHA 和行号，不含全文
- direct-import-evidence.json：src/vs 214、extensions 7、build 5 条直接字面导入
- direct-dependencies-observed.json：当前 65 个直接声明
- extension-evidence-index.json：89 个扩展源码目录；vscode-test-resolver 被 build/lib/extensions.ts 排除

批准某一项时，请写明编号和允许的动作（只记录、以后接入、或在补证后删除）。没有编号的删除不会执行。
## A 系列完整适配评估（2026-11-19 复核）

结论：四项的现有 Host 服务尚不能直接替换 IDE 基础设施；这不排除保留原有消费者、复用宿主的底层资源。已实现 A03 的 Windows 本地搜索二进制复用切片，A01、A02、A04 及 A03 的文件服务/监视未迁移，相关依赖不能先删。

### A01 终端进程后端 — 语义不兼容

DSH `TerminalController`（`@deepseek-ai/dsh-api-terminal-controller`）暴露 9 个 Remote 方法：`environment` / `shells` / `list` / `create` / `watch` / `retain` / `attach` / `rename` / `close`。

官方 [`terminal-controller.create`](https://github.com/deepseek-ai/deepseek-harness/blob/2e39e70496aa02986ca6a820c5d497e816b69d7e/packages/api/terminal-controller/src/index.ts#L185-L239) 创建的是 Session 所有的用户终端；「首次用户输入交权」属于 `openForAgent`，不适用于普通 `create`。IDE 的 `IPtyService` 另有布局、持久化 revive、detach、shell integration、二进制输入及输出流控，不应改绑到 Agent 会话。

源码核对显示 [Host 本地子进程包](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.5/packages/subprocess/subprocess-local/package.json) 与 IDE 根均依赖 `node-pty@1.2.0-beta.15`（实测两侧版本字符串一致）。

**已实现的适配**：新增 `src/vs/platform/terminal/node/nodePtyLoader.ts`，把 `terminalProcess.ts` 的静态 `import { spawn } from 'node-pty'` 改为 `await loadNodePty()`。Host 在拉起 IDE 前用 `resolveHostNodePty()` 解析宿主 `node-pty` 包目录（校验 `prebuilds/win32-<arch>/conpty.node` 确实存在），经 `DSH_IDE_HOST_PTY_PATH` 交给 IDE；加载失败时回退到自带依赖并保留原始错误。与搜索工具同一条纪律：**只传路径，不创建、不链接、不复制任何文件**。

**实测**：用宿主 `node-pty` 从临时目录 `spawn('cmd.exe')` 成功输出标记文本；`loadNodePty()` 经环境变量指向宿主目录时同样成功。`@xterm/headless`、界面 xterm、所有远端终端依赖、任务/调试/扩展终端语义均未改动。

**打包裁剪已实测**：`getDshNodePtyPayloadFilter` 剔除 6 个平台的 prebuilds，仅保留 JS 与 ASAR 索引。产物内 `node-pty/prebuilds` 条目 **0 个**（基线 8 个），成员数 2840 → 2832。

**产物级端到端验证**：从裁剪后的载荷检查 `node_modules.asar.unpacked/node-pty/prebuilds/win32-x64/conpty.node` **不存在**；`out/vs/platform/terminal/node/ptyHostMain.js` 内确实含 `DSH_IDE_HOST_PTY_PATH` 读取逻辑；用宿主 `node-pty` 在该载荷环境下 `spawn('cmd.exe')` 成功输出标记文本。

**环境变量可达性已核实**：PTY 宿主是独立子进程，`ipc.cp.ts` 的 fork 选项为 `{ ...deepClone(process.env), ...this.options.env }`，父进程环境整体继承，因此 `DSH_IDE_HOST_PTY_PATH` 无需额外接线即可到达 `ptyHostMain` 内的加载点。

**未完成**：真机终端行为（真实窗口内新建终端、任务、调试、扩展自有 PTY、远端终端）仍由用户验收；本轮验证止于 Node 模式下的 spawn 与产物内容检查。

### A02 命令执行与沙箱 — 执行位置不同

IDE 的 `terminalSandboxEngine` / `mcpSandboxService` 在 **IDE 进程侧**执行，服务 VS Code 自带 agent 工具与 MCP stdio 服务；DSH `sandbox` / `subprocess` 在 **DSH Host 进程侧**执行，服务 DSH 会话。两者不是同一执行域。

阻塞点：本机 Host 无法替远端进程执行沙箱；MCP 的 `sandboxEnabled` 由服务器定义驱动，与 DSH 会话策略无关。

结论：不能替代。`@vscode/sandbox-runtime`（2883 KB）保留。

### A03 文件服务、搜索与监视 — 能力不等价

`dsh-api-workspace-files` 有 6 个 Remote 方法：`read` / `readBytes` / `stat` / `list` / `search` / `changes`。

阻塞点（逐项核对源码）：
- `search(workspaceFileScope, request, signal)` 作用域固定为**单个** `workspaceRoot`，IDE 搜索支持多根、远端、未保存文件；
- `changes(scope, path, signal)` 实现是 `feed.follow(...)`；官方 JSDoc 明确写「Watch one file or a **directory's direct entries**」，即只覆盖直接子项；
- 底层 `dsh-fs-local` 的 `watch()` 用 `watch(root, { ignoreInitial: true, depth: 0 })`——`depth: 0` 就是**非递归**，而 IDE 的 `@parcel/watcher` 需要 `recursive: true`；
- 官方 `fs` 基类默认 `watch()` 直接抛 `Filesystem watching is not supported by this provider`，说明监视本身是可选能力；
- 官方 [`workspace-files/search`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.5/packages/api/workspace-files/src/search.ts) 以 `rg --files` 枚举路径，不是 IDE 全文搜索的替代接口。

IDE 文件服务、监视、所有搜索消费端及远端协议保留；仅复用 Windows 本地的底层 `rg.exe`，见下文。

### A04 状态数据库与日志 — 数据域不同

IDE 的 `state.vscdb` 承载 global / profile / workspace 三级作用域，外加跨窗口事件与崩溃恢复；DSH `dsh-storage-domain` 是 schema 定义的 domain KV，作用域是 DSH 业务域。两者数据模型不同。

**已落地的修复**：核对打包产物时发现 `@vscode/sqlite3` 的原生绑定 `vscode-sqlite3.node` **从未被编译**（本地 `node_modules/@vscode/sqlite3/build/Release/` 不存在），打包版状态数据库一打开就失败（`Cannot find module '../build/Release/vscode-sqlite3.node'`）。

因此改为使用 Electron 内置的 `node:sqlite`：新增 `src/vs/base/parts/storage/node/sqliteDriver.ts` 适配层，把同步 API 包装成原驱动的回调接口；`storage.ts` 的备份、恢复、事务、WAL、busy timeout 与错误标记语义全部保留。实测覆盖插入、更新、删除、`checkIntegrity`、`VACUUM`、关闭备份、重开读取，以及既有 `ItemTable` 旧库的读写兼容（`user_version` 保持 1）。

依赖层面从根与 remote 的 `package.json` 移除 `@vscode/sqlite3`，并同步两处锁文件；`.moduleignore` 保留构建期文件排除规则（`deps/**` 含 4 MB SQLite 源码包、`src/**`、`binding.gyp`），避免历史残留被打进包。

**日志后端的实际状态（实测）**：`@vscode/spdlog` 的原生绑定 `spdlog.node` 同样**从未被编译**（本地 `node_modules/@vscode/spdlog/build/` 不存在），用 Electron Node 模式加载报 `Could not locate the bindings file`。也就是说开发版与打包版的文件日志**都不可用**，`SpdLogLogger` 的日志只会进内存缓冲、永不落盘。

Host 侧有 `dsh-otel` / `dsh-host-product-telemetry-otel`，但那是遥测/OTel 通道，与 spdlog 的文件轮转（6 个分片、每片 5 MB、`%Y-%m-%d %H:%M:%S.%e [%l] %v` 格式、退出 flush）语义不同，**不属于可等价替换**。按目标「不把仅有相近 API 算作完成」，不做迁移。

**已做的修复**：`createSpdLogLogger` 的 `catch` 原本只 `console.error(e)`，GUI 启动时用户看不到，日志目录为空会被误判为「没有日志事件」。已改为输出明确的降级说明（`[dsh-ide] file logging is unavailable … buffered in memory and never written to disk`），保留不崩溃语义。

结论：`@vscode/spdlog` **保留**，且它本来就是坏的——修复需重新编译原生模块（`npm rebuild @vscode/spdlog`），不属于 Host 适配范围。

### A03 已落地切片：复用 Windows 桌面宿主的搜索二进制

IDE 开窗前由 `host-ripgrep.js` 调用 [官方 `resolveRgPath`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.5/packages/util/ripgrep/src/index.ts) 解析宿主的 `rg.exe`，校验官方模块来自宿主 ASAR、可执行文件位于宿主资源目录，然后以 `DSH_IDE_HOST_RG_PATH` 环境变量交给 IDE 进程。**只传路径**：不创建目录、不建链接、不复制文件，因此不会影响宿主安装内容。IDE 的 `rgDiskPath()` 优先读取该变量，未设置时才回退到自身依赖。最低桌面版本 `0.2.2-rc.2`（实测安装版 `0.2.2-rc.5`）；会话协议基线未改。

**体积的真实构成（标准包 584 MiB 解包后）**：`extensions` 248.2 MiB、`out` 206.2 MiB（其中 **source map 243.4 MiB / 149 个文件**）、`node_modules.asar` 95.5 MiB。单个 `workbench.desktop.main.js.map` 就有 81.2 MiB。

**因此减包的主杠杆不是依赖，而是构建变体**：项目自带 `CI=1 npx gulp dsh-ide-pack-min`（README 已记录），它会 minify 并剔除全部 `*.js.map`。

**实测对比（Windows x64，同一份源码）**：

| 构建 | 体积 | 相对基线 |
| --- | --- | --- |
| 基线（标准包，改动前） | 140,025,477 B | — |
| 标准包 + 三项 Host 适配 | 137,421,233 B | −2,604,244 B（2.48 MiB，1.86%） |
| **min 包 + 三项 Host 适配** | **78,471,151 B** | **−61,554,326 B（58.7 MiB，44.0%）** |

min 包内 `*.js.map` 0 个、成员数 2701；三项适配依然生效（`node-pty/prebuilds` 0、`rg.exe` 0、`sqlite` 0）。从 min 包实测：`resolveHostRipgrep()` 解析成功、宿主 `node-pty` spawn 成功输出标记文本。基线含 1 个 `win32-x64/rg.exe`，候选为 0 个；两份包的 `out/**/*.js.map` 均为 23 个，成员数 2839 → 2840（新增 `host/host-ripgrep.js`）。

官方打包只在 ASAR 组装后排除 DSH Windows app 载荷的 `rg.exe` 物理副本，保留原 ASAR 索引、`@vscode/ripgrep-universal` JS 兼容层和原有路径。IDE 内容/文件搜索、普通扩展模块映射、远端构建及执行域、沙箱策略均未改。专项测试覆盖 Gulp 过滤、纯解析不产生文件、拒绝越界与缺失；宿主纯 Node 探针已在隔离目录执行 `rg --version`，输出 `ripgrep 15.0.0 (rev 3a612f88b8)`。真实 GUI 搜索和普通扩展使用仍由用户验收。

> **事故记录（2026-11-19）**：初版实现把 IDE 的 `node_modules.asar.unpacked/@vscode/ripgrep-universal/bin/win32-*` 目录**联接**到宿主可执行目录。测试夹具的递归清理跟随联接进入宿主安装目录，删除了宿主 `@vscode/ripgrep-win32-x64` 的 `rg.exe` 与 `package.json`。已从 npm 官方 `@vscode/ripgrep-win32-x64@1.18.0` 恢复（`rg.exe` 5,429,760 B，sha256 `f9dde634…`，可执行且输出 `ripgrep 15.0.0 (rev 3a612f88b8)`），但**与宿主原始文件（5,440,496 B）不是同一构建**。因此联接方案被废弃，改为只传路径的环境变量方案，实现不再对宿主或载荷目录做任何写入。
