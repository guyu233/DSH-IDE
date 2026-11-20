/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P2③ 协议真源单测：对 DshIdeSnapshot 与每个 DshIdeMethod 的 args 做正例/反例，
// 覆盖「未知字段拒绝 / 显式 undefined 拒绝 / version 倒退或 gap 拒绝 / 环与非有限数拒绝」。
// 模式平移自 dsh-TUI src/adapter/channel/{provider,consumer}.ts 的协议违规判据。
// 运行：node --experimental-strip-types --test build/lib/test/dshIdeProtocol.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	DSH_IDE_API_VERSION,
	DSH_IDE_DELETE_SESSION_ENDPOINT,
	DSH_IDE_DELETE_SESSION_PLUGIN,
	DSH_IDE_DELETE_SESSION_PLUGIN_VERSION,
	DSH_IDE_WIRE_REVISION,
	assertSnapshotContinuity,
	dshAccountClientMetadata,
	exactRecord,
	jsonValue,
	validateCapabilities,
	validateDshIdeInput,
	validateDshIdeInvokeOutput,
	validateDshIdeLoadOlderResult,
	resolveDshSessionPin,
	dshErrorText,
	validateDshIdeSnapshot,
	validateDshIdeWaterfallNotice,
	type DshIdeMethod,
	type DshIdeSnapshot,
} from '../../../src/vs/platform/dshClient/common/dshIdeProtocol.ts';

// ---------------------------------------------------------------------------
// 每个 method 的正例 + 反例（同一份白名单，顺序与 DshIdeMethodArgs 一致）
// ---------------------------------------------------------------------------

const VALID_ARGS: Record<DshIdeMethod, unknown> = {
	submit: { text: 'hello', sessionId: 's1' },
	interrupt: { sessionId: 's1' },
	resume: { sessionId: 's1' },
	newSession: { workspace: 'w1', options: { theme: 'dark' } },
	fork: { sessionId: 's1', point: 'p1' },
	rewind: { sessionId: 's1', to: 'p0' },
	loadOlder: { sessionId: 's1', beforeSeq: 7 },
	answerApproval: { requestId: 'r1', decision: 'approve' },
	answerQuestion: { requestId: 'r1', answer: { answers: [{ id: 'q', selected: ['yes', 'no'] }] } },
	cancelRequest: { requestId: 'r1' },
	setModel: { sessionId: 's1', model: 'deepseek-chat' },
	setEffort: { sessionId: 's1', effort: 'high' },
	setPermissionPreset: { sessionId: 's1', preset: 'balanced' },
	runCommand: { sessionId: 's1', command: 'help', args: ['a', 'b'] },
	listSessions: {},
	presentationSettings: {},
	listModels: { workspace: 'w1' },
	listCommands: { sessionId: 's1' },
	fetchRowDetail: { rowId: 'row1' },
	readAttachment: { sessionId: 's1', attachment: { attachmentId: 'img-1', mediaType: 'image/png', bytes: 3, width: 1, height: 1 } },
	refreshSnapshot: {},
	deleteSession: { sessionId: 's1' },
	archiveSession: { sessionId: 's1' },
	unarchiveSession: { sessionId: 's1' },
	searchSessions: { query: 'hello' },
	composerState: { sessionId: 's1' },
	setTeamEnabled: { sessionId: 's1', enabled: true },
	setAgentPreset: { sessionId: 's1', preset: 'create' },
	accountGetState: { client: { version: '2.0.0', locale: 'zh-CN', timezoneOffsetSeconds: 28800 } },
	accountGetProfile: { client: { version: '2.0.0', locale: 'zh-CN', timezoneOffsetSeconds: 28800 } },
	accountStartSignIn: { client: { version: '2.0.0', locale: 'zh-CN', timezoneOffsetSeconds: 28800 }, callbackOrigin: 'http://127.0.0.1:1', loginSource: 'desktop' },
	accountCancelSignIn: { attemptId: 'attempt-1' },
	setGoal: { sessionId: 's1', action: 'create', objective: 'ship the chat baseline' },
	listSkills: { sessionId: 's1' },
	capabilities: {},
	speechCatalog: {},
	speechTranscribe: { request: { audioBase64: 'AAAA' } },
	inlineComplete: { prefix: 'const a = 1;' },
	saveImageAttachment: { mediaType: 'image/png', data: 'AAAA' },
	mcpListServers: {},
	mcpRestartServer: { name: 'server-1' },
	jobList: { sessionId: 's1' },
	jobKill: { sessionId: 's1', jobId: 'job-1' },
	renameSession: { sessionId: 's1', title: '新标题' },
	setSessionFavorite: { sessionId: 's1' },
	setSessionPinned: { sessionId: 's1' },
	listWorkspaces: {},
	moveSession: { sessionId: 's1', workspaceId: 'w1' },
	openSessionPath: { sessionId: 's1' },
};

const ALL_METHODS = Object.keys(VALID_ARGS) as DshIdeMethod[];

/** 契约自报的 method 名单：从 DSH_IDE_METHOD_KEYS 的键派生，测试不再维护第二份数字。 */
function contractMethods(): string[] {
	const src = readFileSync(new URL('../../../src/vs/platform/dshClient/common/dshIdeProtocol.ts', import.meta.url), 'utf8');
	const block = /const DSH_IDE_METHOD_KEYS[\s\S]*?\n\};/.exec(src);
	assert.ok(block !== null, 'DSH_IDE_METHOD_KEYS must exist');
	return [...block[0].matchAll(/^\s*([a-zA-Z]+):/gm)].map(m => m[1]);
}

test('fixture covers exactly the contract method set', () => {
	// 断言的是「夹具与契约一致」，不是「等于某个数字」：新增或删除 method 时，
	// 只要夹具同步就通过；漏同步会明确报出多/少哪个 method。
	const contract = contractMethods().sort();
	const fixture = [...ALL_METHODS].sort();
	assert.deepEqual(fixture, contract, 'VALID_ARGS must cover exactly the contract methods');
	assert.equal(new Set(ALL_METHODS).size, ALL_METHODS.length, 'no duplicates');
});

test('every declared method has a validation branch', () => {
	// 校验 switch 漏一个方法不会让校验失效（无参方法有 exactRecord 兜底），
	// 但会让「有声明无校验」成为静默惯例——将来给该方法加字段时就漏校验了。
	const source = readFileSync(new URL('../../../src/vs/platform/dshClient/common/dshIdeProtocol.ts', import.meta.url), 'utf8');
	const withArgs = new Set([...source.matchAll(/^\t(\w+): \{[^}]*\};/gm)].map(match => match[1]));
	const noArgs = new Set([...source.matchAll(/^\t(\w+): Record<string, never>;/gm)].map(match => match[1]));
	const declared = new Set([...withArgs, ...noArgs]);
	assert.ok(declared.size > 40, `the contract should declare dozens of methods (saw ${declared.size})`);
	const cases = new Set([...source.matchAll(/^\t\tcase '(\w+)':/gm)].map(match => match[1]));
	const missing = [...declared].filter(name => !cases.has(name));
	assert.deepEqual(missing, [], 'a declared method without a validation branch is a silent gap');
});

test('validateDshIdeInput accepts every method positive case', () => {
	for (const method of ALL_METHODS) {
		const parsed = validateDshIdeInput(method, VALID_ARGS[method]);
		assert.equal(typeof parsed, 'object', `${method} should return a record`);
	}
});

test('validateDshIdeInput rejects unknown fields for every method', () => {
	for (const method of ALL_METHODS) {
		assert.throws(
			() => validateDshIdeInput(method, { ...(VALID_ARGS[method] as object), __unexpected: 1 }),
			/unknown field/,
			`${method} must reject unknown fields`,
		);
	}
});

test('validateDshIdeInput allows only x- prefixed extension fields', () => {
	assert.doesNotThrow(() => validateDshIdeInput('submit', { text: 'hi', sessionId: 's1', 'x-trace': 't1' }));
});

test('validateDshIdeInput rejects explicit undefined for every method', () => {
	for (const method of ALL_METHODS) {
		assert.throws(
			() => validateDshIdeInput(method, undefined),
			/must be an object/,
			`${method} must reject undefined args`,
		);
		assert.throws(
			() => validateDshIdeInput(method, { ...(VALID_ARGS[method] as object), __undef: undefined }),
			/must omit explicit undefined field/,
			`${method} must reject explicit undefined value`,
		);
	}
});

test('validateDshIdeInput rejects missing/invalid required fields', () => {
	assert.throws(() => validateDshIdeInput('submit', {}), /non-empty string/);
	assert.throws(() => validateDshIdeInput('submit', { text: '  ' }), /non-empty string/);
	assert.throws(() => validateDshIdeInput('rewind', { sessionId: 's1' }), /non-empty string/);
	assert.throws(() => validateDshIdeInput('answerApproval', { requestId: 'r1', decision: 'maybe' }), /decision/);
	assert.throws(() => validateDshIdeInput('answerQuestion', { requestId: 'r1' }), /must be an object/);
	assert.throws(() => validateDshIdeInput('answerQuestion', { requestId: 'r1', answer: 'yes' }), /must be an object/);
	assert.throws(() => validateDshIdeInput('setGoal', { sessionId: 's1', action: 'create' }), /non-empty string/);
	assert.throws(() => validateDshIdeInput('setGoal', { sessionId: 's1', action: 'pause', id: 'g1' }), /revision/);
	assert.throws(() => validateDshIdeInput('runCommand', { sessionId: 's1', command: 'help', args: [1] }), /array of strings/);
	assert.throws(() => validateDshIdeInput('fetchRowDetail', { rowId: '' }), /non-empty string/);
});

test('validateDshIdeInput rejects unknown method deterministically', () => {
	// 运行时传入白名单外 method：exactRecord 收到的 allowed 为 undefined，必须抛错，
	// 绝不静默 no-op（对应 2.3 的 FEATURE_UNAVAILABLE 契约）。
	assert.throws(() => validateDshIdeInput('__bogus' as DshIdeMethod, {}), TypeError);
});

// ---------------------------------------------------------------------------
// exactRecord / jsonValue 原语
// ---------------------------------------------------------------------------

test('exactRecord rejects arrays, null and primitives', () => {
	assert.throws(() => exactRecord([], [], 'x'), /must be an object/);
	assert.throws(() => exactRecord(null, [], 'x'), /must be an object/);
	assert.throws(() => exactRecord('s', [], 'x'), /must be an object/);
});

test('jsonValue accepts finite numbers, plain objects, arrays, null', () => {
	assert.doesNotThrow(() => jsonValue({ a: [1, 2.5, null, true, 'x'], b: { c: 0 } }, 'x', new Set()));
});

test('jsonValue rejects non-finite numbers, cycles and class instances', () => {
	assert.throws(() => jsonValue(Number.NaN, 'x', new Set()), /finite numbers/);
	assert.throws(() => jsonValue(Infinity, 'x', new Set()), /finite numbers/);
	const cyclic: Record<string, unknown> = {};
	cyclic['self'] = cyclic;
	assert.throws(() => jsonValue(cyclic, 'x', new Set()), /cycles/);
	class NotPlain { public a = 1; }
	assert.throws(() => jsonValue(new NotPlain(), 'x', new Set()), /plain objects/);
	assert.throws(() => jsonValue(() => undefined, 'x', new Set()), /must be a JSON value/);
});

// ---------------------------------------------------------------------------
// DshIdeSnapshot 结构校验
// ---------------------------------------------------------------------------

function snapshot(overrides: Record<string, unknown> = {}): DshIdeSnapshot {
	return {
		wireRevision: DSH_IDE_WIRE_REVISION,
		channelId: 'c1',
		version: 0,
		binding: { viewId: 'c1', generation: 1, sessionId: null },
		state: { state: 'starting' },
		...overrides,
	} as DshIdeSnapshot;
}

test('validateDshIdeSnapshot accepts positive cases', () => {
	assert.doesNotThrow(() => validateDshIdeSnapshot(snapshot()));
	const view = { frame: { type: 'event', event: { type: 'user/message', seq: 1, time: 1, data: {} } } };
	assert.doesNotThrow(() => validateDshIdeSnapshot(snapshot({ version: 42, state: { state: 'ready', view } })));
	assert.throws(() => validateDshIdeSnapshot(snapshot({ version: 42, state: { state: 'ready', message: 'ok' } })), /must be an object/);
});

test('validateDshIdeSnapshot accepts official typed chat projections and rejects unknown ones', () => {
	const image = { attachmentId: 'img-1', mediaType: 'image/png', bytes: 3, width: 1, height: 1 };
	const view = {
		frame: { type: 'snapshot' },
		conversation: {
			hasMore: false,
			nodes: [{ kind: 'user', seq: 1, time: 2, content: [{ type: 'text', text: 'hi' }, { type: 'image', attachment: image }] }],
		},
		deliverables: [{ turn: 1, callId: 'present-1', files: [{ path: 'notes/a.txt', description: 'notes' }] }],
		attachments: [image],
		plan: { active: true, pending: false },
		goal: {
			goal: { id: 'g1', revision: 1, objective: 'ship', phase: 'blocked', maxGoalRounds: 4, blockedReason: { code: 'need-input', message: 'waiting' } },
			roundsStarted: 1,
			createdAt: 3,
			updatedAt: 4,
			activation: 'disarmed',
		},
		todos: [{ content: 'write the contract', status: 'in_progress' }],
		skills: [{ name: 'grep', description: 'search', modelInvocable: true, userInvocable: false, provider: 'local' }],
		tokenUsageDelta: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 1 },
		quotaNotice: { code: 'ACCOUNT_QUOTA', seq: 2, message: '额度已用尽' },
		composer: {
			model: { current: { provider: 'deepseek', model: 'chat', effort: 'high' }, groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat', efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' }] }] },
			permission: { current: 'default', options: [{ value: 'default', name: 'Default' }] },
			team: { enabled: false, confirmDisable: true },
			preset: null,
		},
		pending: [{
			eventId: 'e1',
			event: 'approval/request',
			agentId: 'agent-1',
			request: { toolName: 'shell', callId: 'c1', reason: 'run', displayReason: { en: 'Run a command', 'zh-CN': '运行命令' } },
		}],
	};
	assert.doesNotThrow(() => validateDshIdeSnapshot(snapshot({ version: 1, state: { state: 'ready', view } })));
	assert.throws(() => validateDshIdeSnapshot(snapshot({
		version: 1,
		state: { state: 'ready', view: { frame: { type: 'event' }, conversation: { hasMore: false, nodes: [{ kind: 'plugin-card', seq: 1, time: 1 }] } } },
	})), /not an official conversation node/);
	assert.throws(() => validateDshIdeSnapshot(snapshot({
		version: 1,
		state: { state: 'ready', view: { frame: { type: 'event' }, contributor: 'third-party' } },
	})), /unknown field/);
});

test('validateDshIdeSnapshot rejects unknown fields', () => {
	assert.throws(() => validateDshIdeSnapshot(snapshot({ __extra: 1 })), /unknown field/);
	assert.throws(() => validateDshIdeSnapshot(snapshot({ state: { state: 'ready', __extra: 1 } })), /unknown field/);
});

test('capabilities method 返回值四项必填布尔，缺项或非布尔一律拒绝', () => {
	assert.doesNotThrow(() => validateCapabilities({ rewind: true, sessionFavorite: false, sessionMove: false, sessionDelete: true }));
	// 缺插件就是 false，不省略字段
	assert.throws(() => validateCapabilities({ rewind: true, sessionFavorite: false, sessionMove: false }), /sessionDelete must be a boolean/);
	assert.throws(() => validateCapabilities({ rewind: 'yes', sessionFavorite: false, sessionMove: false, sessionDelete: false }), /rewind must be a boolean/);
	assert.throws(() => validateCapabilities({ rewind: true, sessionFavorite: false, sessionMove: false, sessionDelete: false, extra: true }), /unknown field/);
});

test('快照 view 不再接受 capabilities（方案一：能力走独立 method）', () => {
	const view = { frame: { type: 'snapshot' }, capabilities: { rewind: true, sessionFavorite: false, sessionMove: false, sessionDelete: false } };
	assert.throws(() => validateDshIdeSnapshot(snapshot({ version: 1, state: { state: 'ready', view } })), /unknown field/);
});

test('validateDshIdeSnapshot rejects explicit undefined', () => {
	assert.throws(() => validateDshIdeSnapshot(snapshot({ message: undefined })), /must omit explicit undefined field/);
});

test('validateDshIdeSnapshot rejects wireRevision mismatch and bad version/state', () => {
	assert.throws(() => validateDshIdeSnapshot(snapshot({ wireRevision: 999 })), /wireRevision mismatch/);
	assert.throws(() => validateDshIdeSnapshot(snapshot({ version: -1 })), /non-negative integer/);
	assert.throws(() => validateDshIdeSnapshot(snapshot({ version: 1.5 })), /non-negative integer/);
	assert.throws(() => validateDshIdeSnapshot(snapshot({ state: { state: 'bogus' } })), /state\.state/);
	assert.throws(() => validateDshIdeSnapshot(snapshot({ state: 'starting' })), /must be an object/);
});

// ---------------------------------------------------------------------------
// Consumer 连续性 fail-closed
// ---------------------------------------------------------------------------

test('assertSnapshotContinuity accepts first snapshot and strict +1', () => {
	assert.doesNotThrow(() => assertSnapshotContinuity(undefined, snapshot({ version: 0 })));
	assert.doesNotThrow(() => assertSnapshotContinuity(snapshot({ version: 0 }), snapshot({ version: 1 })));
});

test('assertSnapshotContinuity rejects version backwards, equal and gap', () => {
	assert.throws(() => assertSnapshotContinuity(snapshot({ version: 5 }), snapshot({ version: 4 })), /went backwards/);
	assert.throws(() => assertSnapshotContinuity(snapshot({ version: 5 }), snapshot({ version: 5 })), /did not advance/);
	assert.throws(() => assertSnapshotContinuity(snapshot({ version: 5 }), snapshot({ version: 7 })), /version gap/);
});

test('assertSnapshotContinuity rejects channelId and wireRevision changes', () => {
	assert.throws(() => assertSnapshotContinuity(snapshot(), snapshot({ channelId: 'c2' })), /channel id changed/);
	assert.throws(() => assertSnapshotContinuity(snapshot(), snapshot({ wireRevision: DSH_IDE_WIRE_REVISION + 1 })), /wire revision changed/);
});

// ---------------------------------------------------------------------------
// invoke 输出契约：只 { value }，绝不返回快照
// ---------------------------------------------------------------------------

test('validateDshIdeInvokeOutput accepts { value }', () => {
	assert.doesNotThrow(() => validateDshIdeInvokeOutput({ value: { rows: [1, 2] } }));
	assert.doesNotThrow(() => validateDshIdeInvokeOutput({ value: null }));
});

test('validateDshIdeInvokeOutput rejects snapshot/unknown fields/undefined', () => {
	assert.throws(() => validateDshIdeInvokeOutput({ value: 1, snapshot: snapshot() }), /unknown field/);
	assert.throws(() => validateDshIdeInvokeOutput({ value: undefined }), /must omit explicit undefined field/);
	assert.throws(() => validateDshIdeInvokeOutput(undefined), /must be an object/);
});

test('validateDshIdeLoadOlderResult accepts records and hasMore', () => {
	const parsed = validateDshIdeLoadOlderResult({
		accepted: true,
		page: { records: [{ seq: 3, type: 'user/message', data: { text: 'earlier' } }], hasMore: true },
	});
	assert.equal(parsed.accepted, true);
	assert.equal(parsed.page.records.length, 1);
	assert.equal(parsed.page.hasMore, true);
	assert.equal(validateDshIdeLoadOlderResult({ accepted: true, page: { records: [], hasMore: false } }).page.records.length, 0);
});

test('validateDshIdeLoadOlderResult rejects a malformed page', () => {
	assert.throws(() => validateDshIdeLoadOlderResult({ accepted: false, page: { records: [], hasMore: false } }), /accepted must be true/);
	assert.throws(() => validateDshIdeLoadOlderResult({ accepted: true }), /must be an object/);
	assert.throws(() => validateDshIdeLoadOlderResult({ accepted: true, page: { records: {}, hasMore: true } }), /records must be an array/);
	assert.throws(() => validateDshIdeLoadOlderResult({ accepted: true, page: { records: [], hasMore: 1 } }), /hasMore must be a boolean/);
	assert.throws(() => validateDshIdeLoadOlderResult({ accepted: true, page: { records: ['x'], hasMore: false } }), /must be an object/);
	assert.throws(() => validateDshIdeLoadOlderResult({ accepted: true, page: { records: [], hasMore: false, cursor: 4 } }), /unknown field/);
});

// ---------------------------------------------------------------------------
// 版本绑定（D61 / §8.10.8（4））：deleteSession 依赖的第三方插件端点
//
// 官方 0.2.2-rc.1 无会话删除入口（§8.10.7 定论），因此 deleteSession 的唯一实现路径是
// 调用 `@michengai/dsh-archive-manager@1.3.1` 的 `workspaceRegistry/deleteSession`。
// 三条断言把「插件没换、endpoint 没改名、传输层没有自己发明端点」钉死在契约层。
// ---------------------------------------------------------------------------

test('deleteSession plugin binding names the approved plugin, version and endpoint', () => {
	assert.equal(DSH_IDE_DELETE_SESSION_PLUGIN, '@michengai/dsh-archive-manager');
	assert.equal(DSH_IDE_DELETE_SESSION_PLUGIN_VERSION, '1.3.1');
	// 插件 src/workspace.ts:359-378：namespace 与 method 同名，wire = `sessionId`。
	assert.equal(DSH_IDE_DELETE_SESSION_ENDPOINT, 'workspaceRegistry/deleteSession');
});

test('契约的 compareVersion 逐段比较 prerelease（rc.10 > rc.9，不能用字符串比）', () => {
	// 契约文件依赖 base/common/process.js，strip-types 下无法 import，因此按源码结构断言：
	// 必须存在独立的 comparePrerelease 且用数字正则判定数字段；不得留下整段字符串比较。
	const contract = readFileSync(new URL('../../../src/vs/platform/dshClient/common/dshIdeContract.ts', import.meta.url), 'utf8');
	assert.match(contract, /function comparePrerelease\(/, 'contract must extract a comparePrerelease helper');
	assert.match(contract, /\/\^\\d\+\$\/\.test\(/, 'prerelease segments must be classified with a numeric regex');
	assert.match(contract, /Number\(x\) - Number\(y\)/, 'numeric segments must compare by value');
	assert.doesNotMatch(contract, /return ra < rb \? -1 : 1;/, 'must not compare the whole prerelease string');
	assert.match(contract, /return comparePrerelease\(pa\[3\], pb\[3\]\)/, 'compareVersion must delegate to comparePrerelease');
});

test('DSH_IDE_API_VERSION pins the validated upstream version', () => {
	// `dshIdeContract.ts` 依赖 `base/common/process.js`，strip-types 下无法直接加载，
	// 因此用源码断言核对两者的字面量一致（契约门禁另有版本比对）。
	const contract = readFileSync(new URL('../../../src/vs/platform/dshClient/common/dshIdeContract.ts', import.meta.url), 'utf8');
	const upstream = /UPSTREAM_VALIDATED_VERSION\s*=\s*'([^']+)'/.exec(contract)?.[1];
	assert.equal(DSH_IDE_API_VERSION, upstream, 'DSH_IDE_API_VERSION must equal UPSTREAM_VALIDATED_VERSION');
});
test('dshAccountClientMetadata returns the three required identity fields', () => {
	const meta = dshAccountClientMetadata('ja-JP', '2.0.0');
	assert.deepEqual(
		{ version: meta.version, locale: meta.locale, tz: meta.timezoneOffsetSeconds },
		{ version: '2.0.0', locale: 'ja-JP', tz: -new Date().getTimezoneOffset() * 60 },
	);
	// 三字段都必填，且不含任何凭据。
	assert.equal(typeof meta.version, 'string');
	assert.equal(typeof meta.locale, 'string');
	assert.equal(typeof meta.timezoneOffsetSeconds, 'number');
	assert.ok(!('token' in meta) && !('cookie' in meta) && !('secret' in meta));
});

test('dshAccountClientMetadata falls back to a non-empty version and locale', () => {
	const meta = dshAccountClientMetadata();
	assert.equal(meta.version, 'dsh-ide');
	assert.equal(meta.locale, 'zh-CN');
	assert.equal(dshAccountClientMetadata('', '').version, 'dsh-ide');
	assert.equal(dshAccountClientMetadata('', '').locale, 'zh-CN');
});

test('D18 legacy account endpoints file is gone and the consumer uses the protocol single source', () => {
	const legacy = new URL('../../../src/vs/platform/dshClient/common/legacy-account-endpoints.ts', import.meta.url);
	assert.equal(existsSync(legacy), false, 'the legacy file must be deleted after the D18 merge');
	const consumer = readFileSync(new URL('../../../src/vs/workbench/browser/parts/globalCompositeBar.ts', import.meta.url), 'utf8');
	assert.match(consumer, /from '[^']*common\/dshIdeProtocol\.js'/, 'the consumer must import the builder from the protocol single source');
	assert.ok(!consumer.includes('legacy-account-endpoints'), 'no stale legacy import may remain');
});

// ---------------------------------------------------------------------------
// 第 34 轮契约决定（§8.10.10 前置①②）：command 为不带斜杠的命令名、
// args 每项以单空格拼入 rawInput，禁空白/斜杠注入。
// ---------------------------------------------------------------------------

test('runCommand contract: command is a bare slash-command token', () => {
	assert.doesNotThrow(() => validateDshIdeInput('runCommand', { sessionId: 's1', command: 'plan', args: ['topic'] }));
	assert.doesNotThrow(() => validateDshIdeInput('runCommand', { sessionId: 's1', command: 'my_cmd-2' }));
	for (const bad of ['/plan', 'Plan', '', 'plan extra', 'plan/sub', '1plan']) {
		assert.throws(() => validateDshIdeInput('runCommand', { sessionId: 's1', command: bad }), /slash-command token/,
			`command ${JSON.stringify(bad)} must be rejected`);
	}
});

test('runCommand contract: args forbid whitespace and slash injection', () => {
	assert.doesNotThrow(() => validateDshIdeInput('runCommand', { sessionId: 's1', command: 'plan', args: ['a', 'b-c'] }));
	for (const bad of ['a b', 'a/b', '', 'a\nb']) {
		assert.throws(() => validateDshIdeInput('runCommand', { sessionId: 's1', command: 'plan', args: [bad] }), /whitespace\/slash/,
			`arg ${JSON.stringify(bad)} must be rejected`);
	}
});

test('runCommand contract: attachments follow the image attachment whitelist', () => {
	const image = { attachmentId: 'img-1', mediaType: 'image/png', bytes: 3, width: 1, height: 1 };
	assert.doesNotThrow(() => validateDshIdeInput('runCommand', { sessionId: 's1', command: 'present', args: ['x'], attachments: [image] }));
	assert.doesNotThrow(() => validateDshIdeInput('runCommand', { sessionId: 's1', command: 'present', attachments: [] }));
	// 附件必须逐字段命中 ImageAttachmentRef，路径/URL 形状一律拒绝。
	assert.throws(() => validateDshIdeInput('runCommand', {
		sessionId: 's1',
		command: 'present',
		attachments: [{ path: 'C:/secret.png' }],
	}), /unknown field/);
	assert.throws(() => validateDshIdeInput('runCommand', {
		sessionId: 's1',
		command: 'present',
		attachments: [{ ...image, mediaType: 'text/plain' }],
	}), /supported image media type/);
	assert.throws(() => validateDshIdeInput('runCommand', { sessionId: 's1', command: 'present', attachments: 'nope' }), /must be an array/);
});

test('setPermissionPreset contract: preset uses the same token constraint', () => {
	assert.doesNotThrow(() => validateDshIdeInput('setPermissionPreset', { sessionId: 's1', preset: 'workspace-write' }));
	for (const bad of ['/plan', 'Plan', 'a b', '']) {
		assert.throws(() => validateDshIdeInput('setPermissionPreset', { sessionId: 's1', preset: bad }), /slash-command token/,
			`preset ${JSON.stringify(bad)} must be rejected`);
	}
});
// ---------------------------------------------------------------------------
// 新增通道方法的入参校验（语音 / 补全 / 附件入库 / 账号 / MCP / 作业）
// ---------------------------------------------------------------------------

test('speechTranscribe validates the request shape', () => {
	assert.doesNotThrow(() => validateDshIdeInput('speechTranscribe', { request: { audioBase64: 'AAAA' } }));
	assert.doesNotThrow(() => validateDshIdeInput('speechTranscribe', { request: { audioBase64: 'AAAA', providerId: 'p1', language: 'zh' } }));
	assert.throws(() => validateDshIdeInput('speechTranscribe', {}), /must be an object/);
	assert.throws(() => validateDshIdeInput('speechTranscribe', { request: { audioBase64: '' } }), /non-empty string/);
	assert.throws(() => validateDshIdeInput('speechTranscribe', { request: { audioBase64: 'AAAA', unknown: 1 } }), /unknown field/);
});

test('inlineComplete enforces bounded prefix and optional suffix', () => {
	assert.doesNotThrow(() => validateDshIdeInput('inlineComplete', { prefix: 'const a = 1;' }));
	assert.doesNotThrow(() => validateDshIdeInput('inlineComplete', { prefix: 'x', suffix: 'y', languageId: 'ts', path: '/a.ts' }));
	assert.throws(() => validateDshIdeInput('inlineComplete', {}), /must be a string/);
	assert.throws(() => validateDshIdeInput('inlineComplete', { prefix: 'x'.repeat(4001) }), /exceeds 4000 characters/);
	assert.throws(() => validateDshIdeInput('inlineComplete', { prefix: 'x', suffix: 'y'.repeat(2001) }), /exceeds 2000 characters/);
});

test('saveImageAttachment accepts only supported image media types', () => {
	for (const mediaType of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
		assert.doesNotThrow(() => validateDshIdeInput('saveImageAttachment', { mediaType, data: 'AAAA' }));
	}
	assert.throws(() => validateDshIdeInput('saveImageAttachment', { mediaType: 'image/svg+xml', data: 'AAAA' }), /supported image media type/);
	assert.throws(() => validateDshIdeInput('saveImageAttachment', { mediaType: 'image/png', data: '' }), /non-empty string/);
});

test('account sign-in methods require identity and an allowed login source', () => {
	const client = { version: '2.0.0', locale: 'zh-CN', timezoneOffsetSeconds: 28800 };
	assert.doesNotThrow(() => validateDshIdeInput('accountStartSignIn', { client, callbackOrigin: 'http://127.0.0.1:1', loginSource: 'desktop' }));
	assert.throws(() => validateDshIdeInput('accountStartSignIn', { client, callbackOrigin: '', loginSource: 'desktop' }), /non-empty string/);
	assert.throws(() => validateDshIdeInput('accountStartSignIn', { client, callbackOrigin: 'http://x', loginSource: 'mobile' }), /web or desktop/);
	assert.throws(() => validateDshIdeInput('accountCancelSignIn', {}), /non-empty string/);
});

test('MCP and job methods validate their identifiers', () => {
	assert.doesNotThrow(() => validateDshIdeInput('mcpListServers', {}));
	assert.doesNotThrow(() => validateDshIdeInput('mcpRestartServer', { name: 'server-1' }));
	assert.throws(() => validateDshIdeInput('mcpRestartServer', {}), /non-empty string/);
	assert.doesNotThrow(() => validateDshIdeInput('jobList', { sessionId: 's1' }));
	assert.doesNotThrow(() => validateDshIdeInput('jobKill', { sessionId: 's1', jobId: 'job-1' }));
	assert.throws(() => validateDshIdeInput('jobKill', { sessionId: 's1' }), /non-empty string/);
});

test('team and worktrees typed fields are validated and unknown shapes rejected', () => {
	const team = {
		enabled: true,
		tasks: [{ id: 't-1', revision: 1, subject: 'x', description: 'y', status: 'completed', ready: true }],
	};
	assert.doesNotThrow(() => validateDshIdeSnapshot(snapshot({ state: { state: 'ready', view: { frame: { type: 'snapshot' }, team } } })));
	assert.throws(
		() => validateDshIdeSnapshot(snapshot({ state: { state: 'ready', view: { frame: { type: 'snapshot' }, team: { enabled: 'yes', tasks: [] } } } })),
		/must be a boolean/,
	);
	const worktrees = [{ path: '/w', branch: 'b', baseCommit: 'c', repositoryRoot: '/r', created: true }];
	assert.doesNotThrow(() => validateDshIdeSnapshot(snapshot({ state: { state: 'ready', view: { frame: { type: 'snapshot' }, worktrees } } })));
	assert.throws(
		() => validateDshIdeSnapshot(snapshot({ state: { state: 'ready', view: { frame: { type: 'snapshot' }, worktrees: [{ path: '' }] } } })),
		/non-empty string/,
	);
});

test('setSessionPinned accepts an absolute flag and resolves the next state', () => {
	assert.doesNotThrow(() => validateDshIdeInput('setSessionPinned', { sessionId: 's1', pinned: true }));
	assert.doesNotThrow(() => validateDshIdeInput('setSessionPinned', { sessionId: 's1', pinned: false }));
	assert.throws(() => validateDshIdeInput('setSessionPinned', { sessionId: 's1', pinned: 'yes' }), /must be a boolean/);
	assert.equal(resolveDshSessionPin(false, true), true);
	assert.equal(resolveDshSessionPin(true, true), true);
	assert.equal(resolveDshSessionPin(true, undefined), false);
	assert.equal(resolveDshSessionPin(false, undefined), true);
});

test('pin and favorite update the list the user is looking at', () => {
	const menu = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/dshSessionMenu.ts', import.meta.url), 'utf8');
	assert.match(menu, /id: 'dsh\.session\.unpin'/);
	assert.match(menu, /setPinned\(accessor, sessionId, arg, true\)/);
	assert.match(menu, /setPinned\(accessor, sessionId, arg, false\)/);
	assert.match(menu, /session\?\.setPinned\?\.\(applied\)/);
	assert.match(menu, /dsh\.session\.favorited/);
	assert.match(menu, /dsh\.session\.unfavorited/);
	const host = readFileSync(new URL('../../../src/vs/platform/dshClient/host/ide-view-host.js', import.meta.url), 'utf8');
	assert.match(host, /resolveDshSessionPin\(currently, args\.pinned\)/);
	assert.match(host, /return \{ accepted: true, pinned \}/);
	assert.match(host, /return \{ accepted: true, favorite \}/);
});

test('an error with only a code never renders as an empty message', () => {
	assert.equal(dshErrorText({ code: 'dsh-ide/feature-unavailable', message: '' }, '兜底'), 'dsh-ide/feature-unavailable');
	assert.equal(dshErrorText({ code: 'x', message: '   ' }, '兜底'), 'x');
	assert.equal(dshErrorText({ code: 'x', message: '真的原因' }, '兜底'), '真的原因');
	assert.equal(dshErrorText({ message: '只有原因' }, '兜底'), '只有原因');
	assert.equal(dshErrorText(undefined, '兜底'), '兜底');
	assert.equal(dshErrorText({}, '兜底'), '兜底');
});

test('base64 payloads have a runaway-size ceiling but no business limit', () => {
	// 契约不设业务上限（图片 20 MiB 与音频按官方 maxAudioBytes 都由调用方限制），
	// 但要挡住明显失控的输入：Host 侧 Buffer.from(data,'base64') 会为任意长度先分配内存。
	const ok = 'A'.repeat(1024);
	assert.doesNotThrow(() => validateDshIdeInput('saveImageAttachment', { mediaType: 'image/png', data: ok }));
	assert.doesNotThrow(() => validateDshIdeInput('speechTranscribe', { request: { audioBase64: ok } }));
	// 空串仍要拒绝。
	assert.throws(() => validateDshIdeInput('saveImageAttachment', { mediaType: 'image/png', data: '' }));
	assert.throws(() => validateDshIdeInput('speechTranscribe', { request: { audioBase64: '' } }));
	// 超限也要拒绝。
	const huge = 'A'.repeat(140 * 1024 * 1024 + 1);
	assert.throws(() => validateDshIdeInput('saveImageAttachment', { mediaType: 'image/png', data: huge }));
	assert.throws(() => validateDshIdeInput('speechTranscribe', { request: { audioBase64: huge } }));
});

test('a submission cannot carry an unbounded number of attachments', () => {
	// Host 对每个附件各起一次读取与编码；超长数组等于把一次提交放大成任意多次 IO。
	const ref = (i: number) => ({ attachmentId: `a${i}`, mediaType: 'image/png' as const, bytes: 100, width: 10, height: 10 });
	assert.doesNotThrow(() => validateDshIdeInput('submit', { text: 'hi', sessionId: 's', attachments: [ref(0)] }));
	assert.doesNotThrow(() => validateDshIdeInput('submit', { text: 'hi', sessionId: 's', attachments: Array.from({ length: 64 }, (_, i) => ref(i)) }));
	assert.throws(() => validateDshIdeInput('submit', { text: 'hi', sessionId: 's', attachments: Array.from({ length: 65 }, (_, i) => ref(i)) }));
});

test('a deeply nested json value is rejected instead of overflowing the stack', () => {
	// 不设深度限制时，十万层嵌套会让 jsonValue 自己栈溢出（RangeError），
	// 把「校验失败」变成「进程崩溃」。
	const nested = (depth: number) => {
		const root: Record<string, unknown> = {};
		let cursor = root;
		for (let i = 0; i < depth; i++) {
			const next: Record<string, unknown> = {};
			cursor.a = next;
			cursor = next;
		}
		return root;
	};
	assert.doesNotThrow(() => validateDshIdeInput('newSession', { options: nested(3) }));
	assert.doesNotThrow(() => validateDshIdeInput('newSession', { options: nested(32) }));
	assert.throws(() => validateDshIdeInput('newSession', { options: nested(33) }), /levels of nesting/);
	// 关键：十万层必须是 TypeError 而不是 RangeError。
	assert.throws(
		() => validateDshIdeInput('newSession', { options: nested(100000) }),
		error => error instanceof TypeError && /levels of nesting/.test(error.message),
	);
});

test('exactRecord rejects objects whose fields come from a prototype', () => {
	// `Object.keys` 只列自有键，但 `record['field']` 会沿着原型链读。
	// 不拒原型对象的话，一个 `Object.create({sessionId:'attacker'})` 就能绕过
	// 「字段必须显式提供」的检查，甚至伪造会话 id。
	const evil = Object.create({ sessionId: 'attacker' }) as Record<string, unknown>;
	evil.text = 'hi';
	assert.throws(() => exactRecord(evil, ['text', 'sessionId'], 't'), /must be a plain object/);
	class Instance { public a = 1; }
	assert.throws(() => exactRecord(new Instance(), ['a'], 't'), /must be a plain object/);
	// 普通对象与 null 原型对象仍接受。
	assert.deepEqual(exactRecord({ a: 1 }, ['a'], 't'), { a: 1 });
	const bare = Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 });
	assert.equal(exactRecord(bare, ['a'], 't')['a'], 1);
});

test('a locale map cannot inherit its required en field from a prototype', () => {
	// localeMap 读 record['en'] 会沿原型链；不拒原型对象时
	// Object.create({en:'x'}) 能通过「必须含 en」的检查。
	const request = Object.assign(Object.create({ en: 'pwn' }), { toolName: 'bash' });
	assert.throws(
		() => validateDshIdeWaterfallNotice({ kind: 'request', eventId: 'e1', event: 'approval/request', agentId: 'a1', request }),
		/must be a plain object/,
	);
	// 正常对象仍通过。
	assert.doesNotThrow(() => validateDshIdeWaterfallNotice({ kind: 'request', eventId: 'e1', event: 'approval/request', agentId: 'a1', request: { toolName: 'bash' } }));
});

test('x- extension fields must be short scalars', () => {
	// `x-` 是客户端扩展命名空间，但扩展值必须是短标量——不设限的话，
	// 一个 10 MB 的 `x-anything` 会通过校验并随帧跨进程传输。
	const ok = (extra: Record<string, unknown>) => validateDshIdeInput('submit', { text: 'hi', sessionId: 's', ...extra });
	assert.doesNotThrow(() => ok({ 'x-v': '1.2.3' }));
	assert.doesNotThrow(() => ok({ 'x-v': 'A'.repeat(256) }));
	assert.doesNotThrow(() => ok({ 'x-n': 42 }));
	assert.doesNotThrow(() => ok({ 'x-b': true }));
	assert.doesNotThrow(() => ok({ 'x-z': null }));
	assert.throws(() => ok({ 'x-v': 'A'.repeat(257) }), /exceeds 256 characters/);
	assert.throws(() => ok({ 'x-big': 'A'.repeat(10 * 1024 * 1024) }), /exceeds 256 characters/);
	assert.throws(() => ok({ 'x-o': { a: 1 } }), /must be a short scalar/);
	assert.throws(() => ok({ 'x-a': [1, 2] }), /must be a short scalar/);
});
