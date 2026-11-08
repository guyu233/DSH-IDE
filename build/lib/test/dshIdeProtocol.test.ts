/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P2③ 协议真源单测：对 DshIdeSnapshot 与每个 DshIdeMethod 的 args 做正例/反例，
// 覆盖「未知字段拒绝 / 显式 undefined 拒绝 / version 倒退或 gap 拒绝 / 环与非有限数拒绝」。
// 模式平移自 dsh-TUI src/adapter/channel/{provider,consumer}.ts 的协议违规判据。
// 运行：node --experimental-strip-types --test build/lib/test/dshIdeProtocol.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	DSH_IDE_WIRE_REVISION,
	assertSnapshotContinuity,
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
	loadOlder: { sessionId: 's1', before: 'm1' },
	answerApproval: { requestId: 'r1', decision: 'approve' },
	answerQuestion: { requestId: 'r1', answer: 'yes' },
	cancelRequest: { requestId: 'r1' },
	setModel: { model: 'deepseek-chat' },
	setEffort: { effort: 'high' },
	setPermissionPreset: { preset: 'balanced' },
	runCommand: { command: '/help', args: ['a', 'b'] },
	listSessions: {},
	listModels: { workspace: 'w1' },
	listCommands: {},
	fetchRowDetail: { rowId: 'row1' },
	refreshSnapshot: {},
	deleteSession: { sessionId: 's1' },
};

const ALL_METHODS = Object.keys(VALID_ARGS) as DshIdeMethod[];

test('method whitelist has the 20 phase-2.3 methods', () => {
	assert.equal(ALL_METHODS.length, 20);
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
	assert.throws(() => validateDshIdeInput('runCommand', { command: '/x', args: [1] }), /array of strings/);
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
	assert.doesNotThrow(() => validateDshIdeSnapshot(snapshot({ version: 42, state: { state: 'ready', message: 'ok' } })));
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
	assert.throws(() => assertSnapshotContinuity(snapshot(), snapshot({ wireRevision: 2 })), /wire revision changed/);
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
