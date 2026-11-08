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
export const DSH_IDE_WIRE_REVISION = 2;

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

/** 单行类别（中立 DTO；投影器决定行类别，通道快照跨进程只带字符串）。 */
export type DshIdeRowKind = 'user' | 'assistant' | 'tool' | 'system' | 'notice';

/** 单行投影（`IdeRow` 的快照副本；稳定 id + 行级 revision）。 */
export interface DshIdeRow {
	readonly id: string;
	readonly revision: number;
	readonly kind: DshIdeRowKind;
	readonly text?: string;
	readonly preview?: string;
	readonly folded: boolean;
	readonly seq?: number;
	readonly callId?: string;
}

/** 投影载荷：增量 reducer 的出口，随快照单向发布。 */
export interface DshIdeViewSnapshot {
	readonly rows: readonly DshIdeRow[];
	readonly version: number;
}

/** 渲染器消费的视图状态：骨架状态 + 可选投影载荷。 */
export interface DshIdeViewState {
	readonly state: 'starting' | 'ready' | 'rebuild';
	readonly message?: string;
	/** 投影载荷；`state === 'ready'` 时必填，`starting` / `rebuild` 时省略。 */
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
	/** 加载更早的历史。 */
	loadOlder: { sessionId: string; before?: string };
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
	/** 设置权限预设。 */
	setPermissionPreset: { preset: string };
	/** 运行斜杠命令。 */
	runCommand: { command: string; args?: readonly string[] };
	/** 列出会话。 */
	listSessions: Record<string, never>;
	/** 删除会话（直接删除，不入回收站）。 */
	deleteSession: { sessionId: string };
	/** 列出可用模型。 */
	listModels: { workspace?: string };
	/** 列出可用命令。 */
	listCommands: { workspace?: string };
	/** 取某行的完整内容（折叠行回 Host 取详情）。 */
	fetchRowDetail: { rowId: string };
	/** 主动刷新快照。 */
	refreshSnapshot: Record<string, never>;
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
	loadOlder: ['sessionId', 'before'],
	answerApproval: ['requestId', 'decision', 'reason'],
	answerQuestion: ['requestId', 'answer'],
	cancelRequest: ['requestId'],
	setModel: ['model'],
	setEffort: ['effort'],
	setPermissionPreset: ['preset'],
	runCommand: ['command', 'args'],
	listSessions: [],
	deleteSession: ['sessionId'],
	listModels: ['workspace'],
	listCommands: ['workspace'],
	fetchRowDetail: ['rowId'],
	refreshSnapshot: [],
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
			optionalString(record['before'], 'DshIdeInput.loadOlder.before');
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
			nonEmptyString(record['preset'], 'DshIdeInput.setPermissionPreset.preset');
			break;
		case 'runCommand':
			nonEmptyString(record['command'], 'DshIdeInput.runCommand.command');
			if (record['args'] !== undefined) {
				if (!Array.isArray(record['args']) || record['args'].some(a => typeof a !== 'string')) {
					throw new TypeError('DshIdeInput.runCommand.args must be an array of strings');
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
 */
export function validateDshIdeInvokeOutput(value: unknown): { readonly value: unknown } {
	const output = exactRecord(value, ['value'], 'DshIdeInvokeOutput');
	jsonValue(output['value'], 'DshIdeInvokeOutput.value', new Set());
	return output as { readonly value: unknown };
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

/** 投影载荷校验：`version` 非负整数；`rows` 为数组，逐行按 `DshIdeRow` 收窄。 */
function validateDshIdeView(value: unknown): asserts value is DshIdeViewSnapshot {
	const view = exactRecord(value, ['rows', 'version'], 'DshIdeSnapshot.state.view');
	nonNegativeInteger(view['version'], 'DshIdeSnapshot.state.view.version');
	const rows = view['rows'];
	if (!Array.isArray(rows)) {
		throw new TypeError('DshIdeSnapshot.state.view.rows must be an array');
	}
	for (const [index, row] of rows.entries()) {
		const record = exactRecord(row, ['id', 'revision', 'kind', 'text', 'preview', 'folded', 'seq', 'callId'], `DshIdeSnapshot.state.view.rows[${index}]`);
		nonEmptyString(record['id'], `DshIdeSnapshot.state.view.rows[${index}].id`);
		nonNegativeInteger(record['revision'], `DshIdeSnapshot.state.view.rows[${index}].revision`);
		const kind = record['kind'];
		if (kind !== 'user' && kind !== 'assistant' && kind !== 'tool' && kind !== 'system' && kind !== 'notice') {
			throw new TypeError(`DshIdeSnapshot.state.view.rows[${index}].kind must be user|assistant|tool|system|notice`);
		}
		if (typeof record['folded'] !== 'boolean') {
			throw new TypeError(`DshIdeSnapshot.state.view.rows[${index}].folded must be a boolean`);
		}
		if (record['text'] !== undefined && typeof record['text'] !== 'string') {
			throw new TypeError(`DshIdeSnapshot.state.view.rows[${index}].text must be a string`);
		}
		if (record['preview'] !== undefined && typeof record['preview'] !== 'string') {
			throw new TypeError(`DshIdeSnapshot.state.view.rows[${index}].preview must be a string`);
		}
		if (record['seq'] !== undefined) {
			nonNegativeInteger(record['seq'], `DshIdeSnapshot.state.view.rows[${index}].seq`);
		}
		if (record['callId'] !== undefined) {
			nonEmptyString(record['callId'], `DshIdeSnapshot.state.view.rows[${index}].callId`);
		}
		if (record['text'] === undefined && record['preview'] === undefined) {
			throw new TypeError(`DshIdeSnapshot.state.view.rows[${index}] must carry text or preview`);
		}
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
	follow(sessionId: string | undefined, onEvent: (raw: unknown) => void): { dispose(): void };
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
	subscribe(onSnapshot: (snapshot: DshIdeSnapshot) => void): { dispose(): void };
	invoke(method: DshIdeMethod | string, args?: unknown): Promise<unknown>;
	close(): { closed: true };
}

// 注：旧「账号」端点常量（DSH_ACCOUNT_*_ENDPOINT / dshAccountClientMetadata）已迁至
// `legacy-account-endpoints.ts`，不属于本中立 DTO 协议，待 P5 归并或移除。
