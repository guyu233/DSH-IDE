/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH-IDE 连接层协议真源（P1 冻结，P3 升级到 wireRevision 2）。
//
// 模式直接从 dsh-TUI 的 `tui-profile/protocols/tui-channel.js` + `src/adapter/channel/{provider,consumer}.ts`
// 平移：校验原语（exactRecord / jsonValue）、双向校验器（输入/快照）、Consumer 连续性 fail-closed。
// 与 dsh-TUI 的差异：DSH-IDE 用「命名参数对象 + per-method exactRecord」而非位置参数 unknown[]，
// 且 method 直接作为 IServerChannel.call 的 command（无外层 invoke 包裹）。
//
// 本文件是协议唯一真源：所有类型/常量/校验器只在此声明；dshIdeContract.ts 单向引用本文件常量，
// 本文件绝不反向引用 contract。插件侧零 electron 直接引用（仅用平台接口）。

/** 唯一 DSH-IDE IPC 频道名（token 恒为 `dshIde`；全仓只有这一条通道）。 */
export const DSH_IDE_CHANNEL = 'dshIde';

/** API 版本（与 `dshIdeContract.UPSTREAM_VALIDATED_VERSION` 同值，由契约单测核对）。 */
export const DSH_IDE_API_VERSION = '0.2.2-rc.1';

/**
 * 线协议修订号（快照连续性校验依据；wireRevision 不变则协议相容）。
 * P3 把 `IdeViewSnapshot` 并入 `DshIdeViewState.view`，快照形状变化，故由 1 升到 2。
 */
export const DSH_IDE_WIRE_REVISION = 3;

/**
 * `deleteSession` 依赖的社区插件版本（§8.10.8（4）版本绑定）。
 *
 * DSH 官方 0.2.2-rc.1 不存在会话永久删除入口（§8.10.7 已定论），因此该 method 的唯一
 * 实现路径是调用本插件在官方 `workspaceRegistry` 实例上 overlay 的 `deleteSession`。
 * 插件升级必须重新验证 endpoint 存在性、入参 wire 与返回形态（`{ deleted: true }`）。
 * **只调用其公开方法，不复制其删除链代码**（批准范围见 §8.10.8（1））。
 */
export const DSH_IDE_DELETE_SESSION_PLUGIN = '@michengai/dsh-archive-manager';
export const DSH_IDE_DELETE_SESSION_PLUGIN_VERSION = '1.3.1';
/** 插件注册的 Typert endpoint（`workspace.ts:359-378`：namespace/method 同名，wire = `sessionId`）。 */
export const DSH_IDE_DELETE_SESSION_ENDPOINT = 'workspaceRegistry/deleteSession';

/** 功能暂不可用的统一错误码：method 不在白名单，或宿主端口尚未接线。 */
export const DSH_IDE_FEATURE_UNAVAILABLE = 'dsh-ide/feature-unavailable';
/** 入参校验失败的统一错误码（对应 dsh-TUI 的 TypeError 协议违规）。 */
export const DSH_IDE_INVALID_ARGUMENT = 'dsh-ide/invalid-argument';

/** waterfall 已被另一窗口 resolve，本窗口操作无效（P3 落地）。 */
export const DSH_IDE_ALREADY_RESOLVED = 'ALREADY_RESOLVED';

/** 目标会话已切换，本次操作上下文失效（P3 落地）。 */
export const DSH_IDE_SESSION_SWITCHED = 'SESSION_SWITCHED';

/** 本地快照落后过多，需 `refreshSnapshot`（消费点在 P4 的 DshIdeConsumer）。 */
export const DSH_IDE_SNAPSHOT_STALE = 'SNAPSHOT_STALE';

/** 旧 client 错误类型，随 DshRemoteError 一同迁到此处（保证 IDshClientService 消费方类型不破）。 */
export interface DshRemoteError {
	readonly code: string;
	readonly message: string;
	readonly details?: unknown;
}

/**
 * 当前绑定工作区的会话列表项（P4，DSH_IDE_API_VERSION 绑定官方 SessionSummary）。
 * 只取 sessionController.list 与 workspaceRegistry 交集；标题取 projections.values.title。
 * 不增加独立运行时校验器，兼容性由版本绑定与两套 backend 的契约单测守护。
 */
export interface IDshIdeSessionSummary {
	readonly sessionId: string;
	readonly workspaceId: string;
	readonly title?: string;
	readonly updatedAt: number;
	readonly running: boolean;
	readonly blank: boolean;
	readonly agentAvailable: boolean;
	readonly formatStatus?: 'current' | 'migration-required';
	readonly cwd?: string;
	readonly parentSessionId?: string;
	readonly origin?: 'subagent';
}

/**
 * 一帧跟会话的结果。形状就是 `sessionController.follow` 给出的帧，
 * 或内核转发的批准 / 问卷帧。通道不把它折成另一套行。
 */
export interface DshIdeViewSnapshot {
	readonly frame: Readonly<Record<string, unknown>>;
}

/** 渲染器消费的视图状态：骨架状态 + 可选投影载荷。 */
export interface DshIdeViewState {
	readonly state: 'starting' | 'ready' | 'rebuild';
	readonly message?: string;
	/** 跟会话的一帧；`state === 'ready'` 时必填。 */
	readonly view?: DshIdeViewSnapshot;
}

/** 单帧快照：wireRevision + channelId + 单调递增 version + 视图状态。 */
export interface DshIdeSnapshot {
	readonly wireRevision: number;
	readonly channelId: string;
	readonly version: number;
	readonly state: DshIdeViewState;
}

/**
 * 每个 DshIdeMethod 的命名参数 schema。TS 类型侧（这是唯一真源，union 由其派生）。
 * 运行侧用 `DSH_IDE_METHOD_KEYS` 同一份 key 列表做 exactRecord。
 */
export interface DshIdeMethodArgs {
	/** 提交一条用户消息。 */
	submit: { text: string };
	/** 中断当前生成。 */
	interrupt: Record<string, never>;
	/** 恢复一个会话（可选指定）。 */
	resume: { sessionId?: string };
	/** 开新会话。 */
	newSession: { workspace?: string; options?: unknown };
	/** 从某点 fork 会话。 */
	fork: { sessionId: string; point?: string };
	/** 回退到某点。 */
	rewind: { sessionId: string; to: string };
	/**
	 * 向前读取一页历史（官方 `session/page`，只读）。
	 *
	 * 形状对齐官方 `SessionPageRequest{address, beforeSeq?, maxMessages?}`
	 * （`api/session-controller/src/types.ts:469-478`）：`beforeSeq` 是**数值**游标
	 * （不是旧的字符串 `before`），`maxMessages` 限定本页条数。省略 `beforeSeq`
	 * 时官方按观察到的日志末端取页。
	 * `throughSeq` 是**包含式日志切点**：给出时只读该 seq 及之前的历史（「按固定切点
	 * 只读查看」的官方支撑）；省略时按观察到的日志末端取页。三者可组合：
	 * `throughSeq` 定切点、`beforeSeq` 定向后翻页、`maxMessages` 限本页条数。
	 */
	loadOlder: { sessionId: string; throughSeq?: number; beforeSeq?: number; maxMessages?: number };
	/** 决议审批请求。 */
	answerApproval: { requestId: string; decision: 'approve' | 'reject'; reason?: string };
	/** 决议问卷请求。 */
	answerQuestion: { requestId: string; answer: unknown };
	/** 取消一个进行中的请求（审批/问卷/生成等）。 */
	cancelRequest: { requestId: string };
	/** 设置模型。 */
	setModel: { model: string };
	/** 设置 effort。 */
	setEffort: { effort: string };
	/** 设置权限预设；预设名作为 `/permission <preset>` 的唯一参数（§8.10.10 前置②，禁空白/斜杠）。 */
	setPermissionPreset: { preset: string };
	/** 运行斜杠命令；`command` 为不带前导 `/` 的命令名，`args` 以单空格拼成 rawInput（§8.10.10 前置①②）。 */
	runCommand: { command: string; args?: readonly string[] };
	/** 列出绑定工作区的可见会话，返回 readonly IDshIdeSessionSummary[]；未绑定或归属不明返回空数组。 */
	listSessions: Record<string, never>;
	/** 删除会话（直接删除，不入回收站）。 */
	deleteSession: { sessionId: string };
	/** 归档一个已知会话（官方 `workspaceRegistry.archiveSession`）；返回**完整**归档集合。 */
	archiveSession: { sessionId: string };
	/** 恢复一个已归档会话（官方 `workspaceRegistry.unarchiveSession`）；返回**完整**归档集合。 */
	unarchiveSession: { sessionId: string };
	/**
	 * 分批检索会话（官方 `session/search`，只读）。
	 *
	 * 形状对齐官方 `SessionSearchRequest{query}` → `SessionSearchValue{items, hasMore}`
	 * （`api/session-controller/src/types.ts:255-263`）：每项为 `{sessionId, snippet}`
	 * （`:168-171`），`hasMore` 表示还有下一批。官方单批上限 20 条
	 * （`SESSION_SEARCH_RESULT_LIMIT`）、snippet 上限 240 码点。
	 * 该能力依赖宿主挂载 `@deepseek-ai/dsh-session-query`；未挂载时官方抛
	 * `gateway/internal`，本契约原样透传该失败，不伪造空结果。
	 */
	searchSessions: { query: string };
	/**
	 * 读取输入框控件状态（只读）。
	 *
	 * 一次取齐模型目录与当前选择、权限预设、团队开关、开聊前的智能体预设。
	 * 缺哪一项，投影里对应字段就是 `null`，界面藏起该控件，不伪造选项。
	 */
	composerState: Record<string, never>;
	/** 开关当前根会话的智能体团队。`enabled` 必须是布尔值。 */
	setTeamEnabled: { enabled: boolean };
	/** 在会话尚未开始前切换智能体预设。已开聊时官方拒绝，原样透传。 */
	setAgentPreset: { preset: string };
	/** 列出可用模型。 */
	listModels: { workspace?: string };
	/** 列出可用命令。 */
	listCommands: { workspace?: string };
	/** 取某行的完整内容（折叠行回 Host 取详情）。 */
	fetchRowDetail: { rowId: string };
	/** 主动刷新快照。 */
	refreshSnapshot: Record<string, never>;
	/** 读取 DeepSeek 账号投影（登录态）；`client` 为官方 `AccountClientMetadata` 三元组。 */
	accountGetState: { client: IDshAccountClientMetadataArgs };
	/** 读取账号资料（显示名 / 联系方式 / 头像 URL）；仅在 `accountGetState` 为已登录时调用。 */
	accountGetProfile: { client: IDshAccountClientMetadataArgs };
}

/**
 * 官方 `AccountClientMetadata`（账号接口的调用方身份）。
 *
 * 依据 DSH `deepseekAccount` 服务（`cordis_inspect_query` Service.listService 实测）与
 * `packages/credentials/deepseek-account-platform`：Host 用它派生 Platform 请求头
 * （`x-client-version` / `x-client-locale` / `x-client-timezone-offset`）。
 * 三字段**都必填**，且不含任何密钥——账号凭据只存在于 Host，IDE 侧永远拿不到。
 */
export interface IDshAccountClientMetadataArgs {
	/** 客户端版本号，映射到 `x-client-version`。 */
	readonly version: string;
	/** 语言/地区，映射到 `x-client-locale`（如 `zh-CN`）。 */
	readonly locale: string;
	/** 相对 UTC 的时区偏移秒数，映射到 `x-client-timezone-offset`。 */
	readonly timezoneOffsetSeconds: number;
}

/** 客户端版本号的兜底值：无构建注入时也要给出非空串，否则 Host 会拒绝该身份。 */
const DSH_IDE_FALLBACK_CLIENT_VERSION = 'dsh-ide';

/**
 * 构造官方 `AccountClientMetadata` 调用方身份（D18：归并入协议真源，不再有第二份文件）。
 *
 * 依据（只读核对 DSH `packages/client/ui-settings-account/src/client/client-metadata.ts`）：
 * `Date.getTimezoneOffset()` 返回「UTC 以西的分钟数」，Platform 要的是「UTC 以东的秒数」，
 * 故取负再乘 60。三字段都必填、不含任何密钥——账号凭据只存在于 Host。
 *
 * @param locale 当前界面语言（如 `zh-CN`）；Host 会再收敛成 Platform 的线上 locale。
 * @param version 客户端构建版本；缺省时用本插件标识兜底。
 */
export function dshAccountClientMetadata(locale?: string, version?: string): IDshAccountClientMetadataArgs {
	return {
		version: typeof version === 'string' && version !== '' ? version : DSH_IDE_FALLBACK_CLIENT_VERSION,
		locale: typeof locale === 'string' && locale !== '' ? locale : 'zh-CN',
		// 与官方实现同一口径：偏移取反、分钟转秒。
		timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
	};
}

/** 方法白名单（由 DshIdeMethodArgs 键派生，单一真源）。 */
export type DshIdeMethod = keyof DshIdeMethodArgs;

/** 每个 method 的 exactRecord 允许字段（与 DshIdeMethodArgs 同步；空数组=无字段）。 */
const DSH_IDE_METHOD_KEYS: Record<DshIdeMethod, readonly string[]> = {
	submit: ['text'],
	interrupt: [],
	resume: ['sessionId'],
	newSession: ['workspace', 'options'],
	fork: ['sessionId', 'point'],
	rewind: ['sessionId', 'to'],
	loadOlder: ['sessionId', 'throughSeq', 'beforeSeq', 'maxMessages'],
	answerApproval: ['requestId', 'decision', 'reason'],
	answerQuestion: ['requestId', 'answer'],
	cancelRequest: ['requestId'],
	setModel: ['model'],
	setEffort: ['effort'],
	setPermissionPreset: ['preset'],
	runCommand: ['command', 'args'],
	listSessions: [],
	deleteSession: ['sessionId'],
	archiveSession: ['sessionId'],
	unarchiveSession: ['sessionId'],
	searchSessions: ['query'],
	composerState: [],
	setTeamEnabled: ['enabled'],
	setAgentPreset: ['preset'],
	listModels: ['workspace'],
	listCommands: ['workspace'],
	fetchRowDetail: ['rowId'],
	refreshSnapshot: [],
	accountGetState: ['client'],
	accountGetProfile: ['client'],
};

// ---------------------------------------------------------------------------
// 校验原语（平移自 dsh-TUI tui-channel.js，保持行为一致）
// ---------------------------------------------------------------------------

/** 拒绝未知字段（仅允许 `x-` 前缀扩展），要求纯对象、非数组、非 null。 */
export function exactRecord(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object`);
	}
	const obj = value as Record<string, unknown>;
	// 显式 undefined 一律省略：线协议不允许出现值为 undefined 的字段（JSON 会静默丢弃，
	// 其存在即说明生产端未省略），fail-closed 拒绝。先于未知字段检查，保证判据确定。
	for (const key of Object.keys(obj)) {
		if (obj[key] === undefined) {
			throw new TypeError(`${label} must omit explicit undefined field ${JSON.stringify(key)}`);
		}
	}
	const unknown = Object.keys(obj).filter(key => !allowed.includes(key) && !key.startsWith('x-'));
	if (unknown.length > 0) {
		throw new TypeError(`${label} contains unknown field ${JSON.stringify(unknown[0])}`);
	}
	return obj;
}

/** 有限数、纯对象、无环；class 实例（非 Object.prototype）一律拒绝。 */
export function jsonValue(value: unknown, label: string, ancestors: Set<object>): void {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') {
		return;
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			throw new TypeError(`${label} must contain only finite numbers`);
		}
		return;
	}
	if (typeof value !== 'object') {
		throw new TypeError(`${label} must be a JSON value`);
	}
	const obj = value as object;
	if (ancestors.has(obj)) {
		throw new TypeError(`${label} must not contain cycles`);
	}
	ancestors.add(obj);
	try {
		if (Array.isArray(value)) {
			value.forEach((item, index) => jsonValue(item, `${label}[${index}]`, ancestors));
		} else {
			const prototype = Object.getPrototypeOf(obj);
			if (prototype !== Object.prototype && prototype !== null) {
				throw new TypeError(`${label} must contain only plain objects`);
			}
			for (const [key, item] of Object.entries(obj)) {
				jsonValue(item, `${label}.${key}`, ancestors);
			}
		}
	} finally {
		ancestors.delete(obj);
	}
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new TypeError(`${label} must be a non-negative integer`);
	}
	return value as number;
}

function nonEmptyString(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new TypeError(`${label} must be a non-empty string`);
	}
	return value;
}

function optionalString(value: unknown, label: string): void {
	if (value !== undefined) {
		nonEmptyString(value, label);
	}
}

/** 可选的绝对值整数（官方游标类字段：`SessionSeq` 等）。 */
function optionalNonNegativeInteger(value: unknown, label: string): void {
	if (value === undefined) {
		return;
	}
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`${label} must be a non-negative safe integer`);
	}
}

/** 可选的正整数（官方分页预算类字段：`maxMessages` 等）。 */
function optionalPositiveInteger(value: unknown, label: string): void {
	if (value === undefined) {
		return;
	}
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		throw new TypeError(`${label} must be a positive safe integer`);
	}
}

/**
 * 斜杠命令名 / 命令参数的中立约束（第 34 轮契约决定，§8.10.10 前置① ② ⑤）。
 * 官方 `parseCommand` 要求 `^/([a-z][a-z0-9_-]*)(\s|$)`（`interaction/commands/src/index.ts:125-131`）；
 * IDE 契约的 `command` 为**不带前导斜杠的命令名**，`args` 每项以单空格拼进 `rawInput`。
 * 因此两处都禁空白与 `/`，防止注入换行 / 多余斜杠把一次调用变成多次或越权命令。
 */
function commandToken(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(value)) {
		throw new TypeError(`${label} must be a lowercase slash-command token (no leading slash, no whitespace)`);
	}
	return value;
}

/**
 * 校验官方 `AccountClientMetadata`：三个非空/有限数字段，且不额外放宽。
 * 账号凭据不在此结构里（只在 Host），这里只描述「调用方身份」。
 */
function accountClientMetadata(value: unknown, label: string): void {
	const record = exactRecord(value, ['version', 'locale', 'timezoneOffsetSeconds'], label);
	for (const key of ['version', 'locale'] as const) {
		nonEmptyString(record[key], `${label}.${key}`);
	}
	const offset = record['timezoneOffsetSeconds'];
	if (typeof offset !== 'number' || !Number.isFinite(offset)) {
		throw new TypeError(`${label}.timezoneOffsetSeconds must be a finite number`);
	}
}

// ---------------------------------------------------------------------------
// 双向校验器
// ---------------------------------------------------------------------------

/**
 * 入参校验：在 `DshIdeChannel.call()` 入口使用。未知 method 抛错（绝不静默 no-op）。
 * 返回按 method 收窄的强类型参数；调用方可直接交给强类型 handler。
 */
export function validateDshIdeInput<K extends DshIdeMethod>(command: K, args: unknown): DshIdeMethodArgs[K] {
	if (!Object.prototype.hasOwnProperty.call(DSH_IDE_METHOD_KEYS, command)) {
		throw new TypeError(`DshIdeInput: method ${JSON.stringify(command)} is not defined (FEATURE_UNAVAILABLE)`);
	}
	const keys = DSH_IDE_METHOD_KEYS[command];
	const record = exactRecord(args, keys, `DshIdeInput.${command}`);
	switch (command) {
		case 'submit':
			nonEmptyString(record['text'], 'DshIdeInput.submit.text');
			break;
		case 'resume':
			optionalString(record['sessionId'], 'DshIdeInput.resume.sessionId');
			break;
		case 'newSession':
			optionalString(record['workspace'], 'DshIdeInput.newSession.workspace');
			if (record['options'] !== undefined) {
				jsonValue(record['options'], 'DshIdeInput.newSession.options', new Set());
			}
			break;
		case 'fork':
			nonEmptyString(record['sessionId'], 'DshIdeInput.fork.sessionId');
			optionalString(record['point'], 'DshIdeInput.fork.point');
			break;
		case 'rewind':
			nonEmptyString(record['sessionId'], 'DshIdeInput.rewind.sessionId');
			nonEmptyString(record['to'], 'DshIdeInput.rewind.to');
			break;
		case 'loadOlder':
			nonEmptyString(record['sessionId'], 'DshIdeInput.loadOlder.sessionId');
			optionalNonNegativeInteger(record['beforeSeq'], 'DshIdeInput.loadOlder.beforeSeq');
			optionalPositiveInteger(record['maxMessages'], 'DshIdeInput.loadOlder.maxMessages');
			optionalNonNegativeInteger(record['throughSeq'], 'DshIdeInput.loadOlder.throughSeq');
			break;
		case 'answerApproval':
			nonEmptyString(record['requestId'], 'DshIdeInput.answerApproval.requestId');
			if (record['decision'] !== 'approve' && record['decision'] !== 'reject') {
				throw new TypeError('DshIdeInput.answerApproval.decision must be "approve" or "reject"');
			}
			optionalString(record['reason'], 'DshIdeInput.answerApproval.reason');
			break;
		case 'answerQuestion':
			nonEmptyString(record['requestId'], 'DshIdeInput.answerQuestion.requestId');
			jsonValue(record['answer'], 'DshIdeInput.answerQuestion.answer', new Set());
			break;
		case 'cancelRequest':
			nonEmptyString(record['requestId'], 'DshIdeInput.cancelRequest.requestId');
			break;
		case 'setModel':
			nonEmptyString(record['model'], 'DshIdeInput.setModel.model');
			break;
		case 'setEffort':
			nonEmptyString(record['effort'], 'DshIdeInput.setEffort.effort');
			break;
		case 'setPermissionPreset':
			// §8.10.10 前置②：preset 是 `/permission` 的唯一参数，按命令参数约束（禁空白/斜杠）。
			commandToken(record['preset'], 'DshIdeInput.setPermissionPreset.preset');
			break;
		case 'runCommand':
			// §8.10.10 前置①②：`command` 为不带前导斜杠的命令名，`args` 每项单空格拼入 rawInput。
			commandToken(record['command'], 'DshIdeInput.runCommand.command');
			if (record['args'] !== undefined) {
				if (!Array.isArray(record['args']) || record['args'].some(a => typeof a !== 'string')) {
					throw new TypeError('DshIdeInput.runCommand.args must be an array of strings');
				}
				for (const [index, arg] of (record['args'] as readonly string[]).entries()) {
					// 参数允许任意非空字符串内容，但不得含空白或 `/`（注入防护）。
					if (arg === '' || /[\s/]/.test(arg)) {
						throw new TypeError(`DshIdeInput.runCommand.args[${index}] must not be empty or contain whitespace/slash`);
					}
				}
			}
			break;
		case 'listModels':
			optionalString(record['workspace'], 'DshIdeInput.listModels.workspace');
			break;
		case 'listCommands':
			optionalString(record['workspace'], 'DshIdeInput.listCommands.workspace');
			break;
		case 'fetchRowDetail':
			nonEmptyString(record['rowId'], 'DshIdeInput.fetchRowDetail.rowId');
			break;
		case 'accountGetState':
		case 'accountGetProfile':
			// 官方 `AccountClientMetadata` 四字段必填；缺一个就会让 Host 派生出错误的请求身份。
			accountClientMetadata(record['client'], `DshIdeInput.${command}.client`);
			break;
		case 'archiveSession':
		case 'unarchiveSession':
			// 归档类 method 只接受一个会话标识；官方形状见 §8.10.11 `{ sessionId }`。
			nonEmptyString(record['sessionId'], `DshIdeInput.${command}.sessionId`);
			break;
		case 'searchSessions':
			// 官方 `search(query)` 只接受一个非空查询串。
			nonEmptyString(record['query'], 'DshIdeInput.searchSessions.query');
			break;
		case 'setTeamEnabled':
			if (typeof record['enabled'] !== 'boolean') {
				throw new TypeError('DshIdeInput.setTeamEnabled.enabled must be a boolean');
			}
			break;
		case 'setAgentPreset':
			// 预设 id 由注册表决定，不套斜杠命令的 token 规则；仍拒绝空白和斜杠。
			nonEmptyString(record['preset'], 'DshIdeInput.setAgentPreset.preset');
			if (/[\s/]/.test(String(record['preset']))) {
				throw new TypeError('DshIdeInput.setAgentPreset.preset must not contain whitespace or slash');
			}
			break;
		case 'composerState':
		case 'interrupt':
		case 'listSessions':
		case 'refreshSnapshot':
			// 无字段，exactRecord 已确保空对象。
			break;
	}
	return record as DshIdeMethodArgs[K];
}

/**
 * `invoke` 输出契约：只返回 `{ value }`（或错误），**绝不返回快照**。
 * 所有状态变化只走 `listen('snapshot')` 一条路。
 * `DshIdeChannel.call()` 组装输出时调用。
 *
 * 关于 `listen` 的事件面：白名单是 `snapshot` 与 `waterfall`。
 * `DshIdeChannel.listen()` 对其它名字返回 `Event.None`。
 * `waterfall` 承载官方 `$events` 的审批 / 问卷请求与取消，帧形状是
 * `DshIdeWaterfallNotice`，由独立消费者 `validateDshIdeWaterfallNotice` 校验，
 * **不**进入 `DshIdeSnapshot`（wireRevision 保持 2）。
 * 若将来要再增加官方事件名，须**先改本契约**（新增事件名常量 + 帧形状 + 独立消费者）
 * 并按第 2 章 §9 走完手续；在此之前不得在实现里私自增加事件名，
 * 也不得改用自建出站通道（§8.10.2 的「允许增加」以「先改契约」为前提）。
 */
export function validateDshIdeInvokeOutput(value: unknown): { readonly value: unknown } {
	const output = exactRecord(value, ['value'], 'DshIdeInvokeOutput');
	jsonValue(output['value'], 'DshIdeInvokeOutput.value', new Set());
	return output as { readonly value: unknown };
}

/** 审批请求的中立视图。不含官方 `agent` / `signal`。 */
export interface DshIdeApprovalRequestView {
	readonly toolName: string;
	readonly callId?: string;
	readonly reason?: string;
}

/** 问卷选项只保留用户能点的标签。 */
export interface DshIdeQuestionOptionView {
	readonly label: string;
}

/** 一条问卷。`multiSelect` 只在为真时出现。 */
export interface DshIdeQuestionItemView {
	readonly id: string;
	readonly question?: string;
	readonly options?: readonly DshIdeQuestionOptionView[];
	readonly multiSelect?: true;
}

/** 问卷请求的中立视图。 */
export interface DshIdeQuestionRequestView {
	readonly questions: readonly DshIdeQuestionItemView[];
}

/**
 * `listen('waterfall')` 的帧。请求与取消分开，不并进快照。
 * `event` 只允许官方两条 waterfall：`approval/request` 与 `user-questions/request`。
 */
export type DshIdeWaterfallNotice =
	| {
		readonly kind: 'request';
		readonly eventId: string;
		readonly event: 'approval/request' | 'user-questions/request';
		readonly agentId: string;
		readonly request: DshIdeApprovalRequestView | DshIdeQuestionRequestView;
	}
	| {
		readonly kind: 'cancel';
		readonly eventId: string;
	};

/** waterfall 帧校验（独立消费者入口，不复用快照校验）。 */
export function validateDshIdeWaterfallNotice(value: unknown): DshIdeWaterfallNotice {
	const notice = exactRecord(value, ['kind', 'eventId', 'event', 'agentId', 'request'], 'DshIdeWaterfallNotice');
	const eventId = nonEmptyString(notice['eventId'], 'DshIdeWaterfallNotice.eventId');
	if (notice['kind'] === 'cancel') {
		const extra = ['event', 'agentId', 'request'].filter(key => notice[key] !== undefined);
		if (extra.length > 0) {
			throw new TypeError(`DshIdeWaterfallNotice cancel must omit ${extra[0]}`);
		}
		return { kind: 'cancel', eventId };
	}
	if (notice['kind'] !== 'request') {
		throw new TypeError('DshIdeWaterfallNotice.kind must be request or cancel');
	}
	const agentId = nonEmptyString(notice['agentId'], 'DshIdeWaterfallNotice.agentId');
	if (notice['event'] === 'approval/request') {
		return { kind: 'request', eventId, event: 'approval/request', agentId, request: validateApprovalView(notice['request']) };
	}
	if (notice['event'] === 'user-questions/request') {
		return { kind: 'request', eventId, event: 'user-questions/request', agentId, request: validateQuestionView(notice['request']) };
	}
	throw new TypeError('DshIdeWaterfallNotice.event must be approval/request or user-questions/request');
}

function validateApprovalView(value: unknown): DshIdeApprovalRequestView {
	const request = exactRecord(value, ['toolName', 'callId', 'reason'], 'DshIdeWaterfallNotice.request');
	const toolName = nonEmptyString(request['toolName'], 'DshIdeWaterfallNotice.request.toolName');
	optionalString(request['callId'], 'DshIdeWaterfallNotice.request.callId');
	optionalString(request['reason'], 'DshIdeWaterfallNotice.request.reason');
	return {
		toolName,
		...(typeof request['callId'] === 'string' ? { callId: request['callId'] } : {}),
		...(typeof request['reason'] === 'string' ? { reason: request['reason'] } : {}),
	};
}

function validateQuestionView(value: unknown): DshIdeQuestionRequestView {
	const request = exactRecord(value, ['questions'], 'DshIdeWaterfallNotice.request');
	if (!Array.isArray(request['questions']) || request['questions'].length === 0) {
		throw new TypeError('DshIdeWaterfallNotice.request.questions must be a non-empty array');
	}
	const questions = request['questions'].map((item, index) => validateQuestionItem(item, index));
	return { questions };
}

function validateQuestionItem(value: unknown, index: number): DshIdeQuestionItemView {
	const label = `DshIdeWaterfallNotice.request.questions[${index}]`;
	const item = exactRecord(value, ['id', 'question', 'options', 'multiSelect'], label);
	const id = nonEmptyString(item['id'], `${label}.id`);
	optionalString(item['question'], `${label}.question`);
	let options: readonly DshIdeQuestionOptionView[] | undefined;
	if (item['options'] !== undefined) {
		if (!Array.isArray(item['options'])) {
			throw new TypeError(`${label}.options must be an array`);
		}
		options = item['options'].map((option, optionIndex) => {
			const record = exactRecord(option, ['label'], `${label}.options[${optionIndex}]`);
			return { label: nonEmptyString(record['label'], `${label}.options[${optionIndex}].label`) };
		});
	}
	if (item['multiSelect'] !== undefined && item['multiSelect'] !== true) {
		throw new TypeError(`${label}.multiSelect must be true when present`);
	}
	return {
		id,
		...(typeof item['question'] === 'string' ? { question: item['question'] } : {}),
		...(options !== undefined ? { options } : {}),
		...(item['multiSelect'] === true ? { multiSelect: true as const } : {}),
	};
}

/** 快照结构校验（在 `DshIdeConsumer.accept()` 入口使用）。 */
export function validateDshIdeSnapshot(value: unknown): DshIdeSnapshot {
	const s = exactRecord(value, ['wireRevision', 'channelId', 'version', 'state'], 'DshIdeSnapshot');
	if (s['wireRevision'] !== DSH_IDE_WIRE_REVISION) {
		throw new TypeError(`DshIdeSnapshot.wireRevision mismatch: expected ${DSH_IDE_WIRE_REVISION}`);
	}
	nonEmptyString(s['channelId'], 'DshIdeSnapshot.channelId');
	nonNegativeInteger(s['version'], 'DshIdeSnapshot.version');
	const state = exactRecord(s['state'], ['state', 'message', 'view'], 'DshIdeSnapshot.state');
	if (state['state'] !== 'starting' && state['state'] !== 'ready' && state['state'] !== 'rebuild') {
		throw new TypeError('DshIdeSnapshot.state.state must be starting|ready|rebuild');
	}
	if (state['message'] !== undefined) {
		nonEmptyString(state['message'], 'DshIdeSnapshot.state.message');
	}
	const view = state['view'];
	if (state['state'] === 'ready') {
		validateDshIdeView(view);
	} else if (view !== undefined) {
		throw new TypeError(`DshIdeSnapshot.state.view is only allowed when state is ready (got ${String(state['state'])})`);
	}
	jsonValue(state, 'DshIdeSnapshot.state', new Set());
	return s as unknown as DshIdeSnapshot;
}

/** 跟会话帧校验：必须是带 `type` 字符串的对象，其余字段原样保留。 */
function validateDshIdeView(value: unknown): asserts value is DshIdeViewSnapshot {
	const view = exactRecord(value, ['frame'], 'DshIdeSnapshot.state.view');
	const frame = view['frame'];
	if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) {
		throw new TypeError('DshIdeSnapshot.state.view.frame must be an object');
	}
	if (typeof (frame as Record<string, unknown>)['type'] !== 'string' || (frame as Record<string, unknown>)['type'] === '') {
		throw new TypeError('DshIdeSnapshot.state.view.frame.type must be a non-empty string');
	}
}

/**
 * 快照连续性 fail-closed（平移自 dsh-TUI consumer.accept）：
 * channelId / wireRevision 不变；version 严格 +1；gap 或倒退一律抛错。
 * 返回 void，违反即抛 TypeError（协议违规）。
 */
export function assertSnapshotContinuity(prev: DshIdeSnapshot | undefined, next: DshIdeSnapshot): void {
	if (prev === undefined) {
		return;
	}
	if (next.channelId !== prev.channelId) {
		throw new TypeError(`DshIdeSnapshot channel id changed: ${prev.channelId} -> ${next.channelId}`);
	}
	if (next.wireRevision !== prev.wireRevision) {
		throw new TypeError(`DshIdeSnapshot wire revision changed: ${prev.wireRevision} -> ${next.wireRevision}`);
	}
	if (next.version < prev.version) {
		throw new TypeError(`DshIdeSnapshot version went backwards: ${prev.version} -> ${next.version}`);
	}
	if (next.version === prev.version) {
		throw new TypeError(`DshIdeSnapshot version did not advance: ${prev.version}`);
	}
	if (next.version !== prev.version + 1) {
		throw new TypeError(`DshIdeSnapshot version gap: expected ${prev.version + 1}, got ${next.version}`);
	}
}

/** `open` 的规格：视图名 + 会话/工作区参数。 */
export interface DshIdeOpenSpec {
	readonly view: string;
	readonly params?: Record<string, unknown>;
}

/**
 * DSH 能力端口：由 IDE 侧的官方客户端传输适配实现（`platform/dshClient/transport/`）。
 * 四个方法逐一对应 `IdeViewHost` 的四个语义，不承载任何传输细节，因此不存在第二条协议。
 * 定义在 common 层是为了让 `transport/` 与 `electron-main/` 都只依赖本文件，避免反向依赖。
 */
export interface DshIdeBackend {
	/** 绑定会话并返回该视图的通道 id（一次打开一个，守恒）。 */
	open(spec: DshIdeOpenSpec): { readonly channelId: string; readonly sessionId?: string };
	/** 订阅会话真源（历史回放 + 实时流）；返回解绑句柄。 */
	/**
	 * 订阅会话真源。
	 *
	 * 回调收到的是**传输层的原始帧**（`session/follow` 的 `snapshot` / `event` / `assistant-stream`），
	 * 不是展开后的单条事件：解包由 `IdeViewHost` 实现负责（`unwrapFollowFrame`），
	 * 这样端口两侧的职责边界只划一次，不出现「一半帧、一半事件」的混合契约。
	 */
	follow(sessionId: string | undefined, onFrame: (frame: unknown) => void): { dispose(): void };
	/** 执行一个 DTO method（参数已过 `validateDshIdeInput`）。 */
	invoke(method: DshIdeMethod, args: unknown): Promise<unknown>;
	/** 释放传输资源；不取消 DSH 会话。 */
	close(): void;
}

/**
 * 宿主侧视图宿主窄接口：DshIdeChannel 只依赖这四个方法，由 `DshIdeViewService`
 * （electron-main）实现，DSH 能力经 `DshIdeBackend` 端口注入。
 */
export interface IdeViewHost {
	open(spec: { view: string; params?: Record<string, unknown> }): DshIdeSnapshot;
	/** 换一个会话继续跟：停旧流、按新地址重开。 */
	rebind(sessionId: string): DshIdeSnapshot;
	subscribe(onSnapshot: (snapshot: DshIdeSnapshot) => void): { dispose(): void };
	/** 订阅官方 waterfall 通知。与快照流分开，不推进 `version`。 */
	subscribeWaterfall(onNotice: (notice: DshIdeWaterfallNotice) => void): { dispose(): void };
	invoke(method: DshIdeMethod | string, args?: unknown): Promise<unknown>;
	close(): { closed: true };
}

// 注：账号能力的**端点名**是本协议的正式 method（`accountGetState` / `accountGetProfile`），
// 「调用方身份」元数据（官方 `AccountClientMetadata` 三字段）及其构造器
// `dshAccountClientMetadata` 也同在本文件（D18 归并），协议侧只留唯一真源。
