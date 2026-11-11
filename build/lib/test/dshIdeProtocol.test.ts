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
	validateDshIdeInput,
	validateDshIdeInvokeOutput,
	validateDshIdeSnapshot,
	type DshIdeMethod,
	type DshIdeSnapshot,
} from '../../../src/vs/platform/dshClient/common/dshIdeProtocol.ts';

// ---------------------------------------------------------------------------
// 每个 method 的正例 + 反例（同一份白名单，顺序与 DshIdeMethodArgs 一致）
// ---------------------------------------------------------------------------

const VALID_ARGS: Record<DshIdeMethod, unknown> = {
	submit: { text: 'hello' },
	interrupt: {},
	resume: { sessionId: 's1' },
	newSession: { workspace: 'w1', options: { theme: 'dark' } },
	fork: { sessionId: 's1', point: 'p1' },
	rewind: { sessionId: 's1', to: 'p0' },
	loadOlder: { sessionId: 's1', beforeSeq: 7 },
	answerApproval: { requestId: 'r1', decision: 'approve' },
	answerQuestion: { requestId: 'r1', answer: 'yes' },
	cancelRequest: { requestId: 'r1' },
	setModel: { model: 'deepseek-chat' },
	setEffort: { effort: 'high' },
	setPermissionPreset: { preset: 'balanced' },
	runCommand: { command: 'help', args: ['a', 'b'] },
	listSessions: {},
	listModels: { workspace: 'w1' },
	listCommands: {},
	fetchRowDetail: { rowId: 'row1' },
	refreshSnapshot: {},
	deleteSession: { sessionId: 's1' },
	archiveSession: { sessionId: 's1' },
	unarchiveSession: { sessionId: 's1' },
	searchSessions: { query: 'hello' },
	accountGetState: { client: { version: '2.0.0', locale: 'zh-CN', timezoneOffsetSeconds: 28800 } },
	accountGetProfile: { client: { version: '2.0.0', locale: 'zh-CN', timezoneOffsetSeconds: 28800 } },
};

const ALL_METHODS = Object.keys(VALID_ARGS) as DshIdeMethod[];

test('method whitelist has the 25 methods (20 session + 2 account + 2 archive + 1 search)', () => {
	assert.equal(ALL_METHODS.length, 25);
	assert.equal(new Set(ALL_METHODS).size, ALL_METHODS.length);
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
	assert.doesNotThrow(() => validateDshIdeInput('submit', { text: 'hi', 'x-trace': 't1' }));
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
	assert.throws(() => validateDshIdeInput('answerQuestion', { requestId: 'r1' }), /must be a JSON value/);
	assert.throws(() => validateDshIdeInput('runCommand', { command: 'help', args: [1] }), /array of strings/);
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
		state: { state: 'starting' },
		...overrides,
	} as DshIdeSnapshot;
}

test('validateDshIdeSnapshot accepts positive cases', () => {
	assert.doesNotThrow(() => validateDshIdeSnapshot(snapshot()));
	// P3：wireRevision 升到 2，`ready` 必须携带投影载荷 `view`（第 2 章 §2.1）。
	const view = { rows: [{ id: 'row:1', revision: 1, kind: 'user', text: 'hi', folded: false, seq: 1 }], version: 3 };
	assert.doesNotThrow(() => validateDshIdeSnapshot(snapshot({ version: 42, state: { state: 'ready', view } })));
	assert.throws(() => validateDshIdeSnapshot(snapshot({ version: 42, state: { state: 'ready', message: 'ok' } })), /must be an object/);
});

test('validateDshIdeSnapshot rejects unknown fields', () => {
	assert.throws(() => validateDshIdeSnapshot(snapshot({ __extra: 1 })), /unknown field/);
	assert.throws(() => validateDshIdeSnapshot(snapshot({ state: { state: 'ready', __extra: 1 } })), /unknown field/);
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

test('DSH_IDE_API_VERSION pins the validated upstream version', () => {
	// `dshIdeContract.ts` 依赖 `base/common/process.js`，strip-types 下无法直接加载，
	// 因此用源码断言核对两者的字面量一致（契约门禁另有版本比对）。
	const contract = readFileSync(new URL('../../../src/vs/platform/dshClient/common/dshIdeContract.ts', import.meta.url), 'utf8');
	const upstream = /UPSTREAM_VALIDATED_VERSION\s*=\s*'([^']+)'/.exec(contract)?.[1];
	assert.equal(DSH_IDE_API_VERSION, upstream, 'DSH_IDE_API_VERSION must equal UPSTREAM_VALIDATED_VERSION');
});

test('the transport calls exactly the contracted endpoint for deleteSession', () => {
	// 传输层是纯 JS 可加载模块（值导入 `.js` 说明符在 strip-types 下不可解析），
	// 因此用源码断言守住「不自己发明端点、不写死第二个插件名」。
	const source = readFileSync(new URL('../../../src/vs/platform/dshClient/transport/dshIdeTransport.ts', import.meta.url), 'utf8');
	const [namespace, method] = DSH_IDE_DELETE_SESSION_ENDPOINT.split('/');
	assert.match(
		source,
		new RegExp(`call\\(\\s*'${namespace}'\\s*,\\s*'${method}'\\s*,\\s*\\{ sessionId \\}`),
		'the transport must call the contracted endpoint with the exact wire field',
	);
	assert.match(source, new RegExp(DSH_IDE_DELETE_SESSION_PLUGIN.replace(/[/@]/g, '\\$&')), 'the refusal message must name the approved plugin');
	assert.match(source, /deleted'\] !== true/, 'only { deleted: true } may be reported as accepted');
});

// ---------------------------------------------------------------------------
// D18：AccountClientMetadata 构造器归并入协议真源（原 legacy-account-endpoints.ts 已删）
// ---------------------------------------------------------------------------

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
	assert.doesNotThrow(() => validateDshIdeInput('runCommand', { command: 'plan', args: ['topic'] }));
	assert.doesNotThrow(() => validateDshIdeInput('runCommand', { command: 'my_cmd-2' }));
	for (const bad of ['/plan', 'Plan', '', 'plan extra', 'plan/sub', '1plan']) {
		assert.throws(() => validateDshIdeInput('runCommand', { command: bad }), /slash-command token/,
			`command ${JSON.stringify(bad)} must be rejected`);
	}
});

test('runCommand contract: args forbid whitespace and slash injection', () => {
	assert.doesNotThrow(() => validateDshIdeInput('runCommand', { command: 'plan', args: ['a', 'b-c'] }));
	for (const bad of ['a b', 'a/b', '', 'a\nb']) {
		assert.throws(() => validateDshIdeInput('runCommand', { command: 'plan', args: [bad] }), /whitespace\/slash/,
			`arg ${JSON.stringify(bad)} must be rejected`);
	}
});

test('setPermissionPreset contract: preset uses the same token constraint', () => {
	assert.doesNotThrow(() => validateDshIdeInput('setPermissionPreset', { preset: 'workspace-write' }));
	for (const bad of ['/plan', 'Plan', 'a b', '']) {
		assert.throws(() => validateDshIdeInput('setPermissionPreset', { preset: bad }), /slash-command token/,
			`preset ${JSON.stringify(bad)} must be rejected`);
	}
});
