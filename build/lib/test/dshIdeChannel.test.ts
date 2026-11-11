/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P3 验收单测：通道分发（24 method 全覆盖）、listen 三层过滤、disposeOwner 本通道清理、
// 视图宿主快照纪律（channelId 守恒 / version 严格 +1 / 首帧 starting / 投影 ready）。
// 运行：node --experimental-strip-types --test build/lib/test/dshIdeChannel.test.ts
// 通道与视图宿主经 `out/`（`build-dsh-tests` 转译产物）加载：两者依赖 base/common 的 .js 说明符，
// 直接指向 src/*.ts 会解析不到同目录的 .js 兄弟文件。协议常量仍从 src 真源加载。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	DSH_IDE_ALREADY_RESOLVED,
	DSH_IDE_CHANNEL,
	DSH_IDE_FEATURE_UNAVAILABLE,
	DSH_IDE_INVALID_ARGUMENT,
	DSH_IDE_SESSION_SWITCHED,
	DSH_IDE_SNAPSHOT_STALE,
	DSH_IDE_WIRE_REVISION,
	assertSnapshotContinuity,
	validateDshIdeSnapshot,
	type DshIdeMethod,
	type DshIdeSnapshot,
} from '../../../src/vs/platform/dshClient/common/dshIdeProtocol.ts';
import {
	unwrapFollowFrame,
} from '../../../out/vs/platform/dshClient/electron-main/ide-view-service.js';
import {
	DSH_IDE_CONTROL_CLOSE,
	DSH_IDE_CONTROL_LAUNCH,
	DSH_IDE_CONTROL_OPEN,
	DSH_IDE_SNAPSHOT_EVENT,
	DshIdeChannel,
	type DshIdeLauncher,
} from '../../../out/vs/platform/dshClient/electron-main/dshIdeChannel.js';
import {
	DshIdeViewService,
	UnavailableDshIdeBackend,
	type DshIdeBackend,
} from '../../../out/vs/platform/dshClient/electron-main/ide-view-service.js';

const ALL_METHODS: DshIdeMethod[] = [
	'submit', 'interrupt', 'resume', 'newSession', 'fork', 'rewind', 'loadOlder',
	'answerApproval', 'answerQuestion', 'cancelRequest', 'setModel', 'setEffort',
	'setPermissionPreset', 'runCommand', 'listSessions', 'deleteSession', 'listModels',
	'listCommands', 'fetchRowDetail', 'refreshSnapshot',
	'accountGetState', 'accountGetProfile',
	'archiveSession', 'unarchiveSession', 'searchSessions',
];

interface FakeBackend extends DshIdeBackend {
	readonly calls: string[];
	emit(raw: unknown): void;
}

/** 假后端：记录调用，并暴露 `emit` 让测试从 follow 回调注入真实事件。 */
function fakeBackend(overrides: Partial<DshIdeBackend> = {}): FakeBackend {
	const calls: string[] = [];
	let sink: ((raw: unknown) => void) | undefined;
	const backend: FakeBackend = {
		calls,
		emit: raw => sink?.(raw),
		open: () => ({ channelId: 'ch-1', sessionId: 's-1' }),
		follow: (_sessionId, onEvent) => {
			sink = onEvent;
			return { dispose: () => { calls.push('unfollow'); sink = undefined; } };
		},
		invoke: async (method: string) => { calls.push(String(method)); return { accepted: true }; },
		close: () => { calls.push('close'); },
		...overrides,
	};
	return backend;
}

// ---------------------------------------------------------------------------
// 协议常量：P3 落地三个错误码，wireRevision 升到 2
// ---------------------------------------------------------------------------

test('P3 error codes are declared and distinct', () => {
	assert.equal(DSH_IDE_ALREADY_RESOLVED, 'ALREADY_RESOLVED');
	assert.equal(DSH_IDE_SESSION_SWITCHED, 'SESSION_SWITCHED');
	assert.equal(DSH_IDE_SNAPSHOT_STALE, 'SNAPSHOT_STALE');
	const all = [DSH_IDE_FEATURE_UNAVAILABLE, DSH_IDE_INVALID_ARGUMENT, DSH_IDE_ALREADY_RESOLVED, DSH_IDE_SESSION_SWITCHED, DSH_IDE_SNAPSHOT_STALE];
	assert.equal(new Set(all).size, all.length);
	assert.equal(DSH_IDE_CHANNEL, 'dshIde');
	assert.equal(DSH_IDE_WIRE_REVISION, 2, 'projection payload merged into state.view bumps wireRevision to 2');
});

// ---------------------------------------------------------------------------
// 快照形状：starting 不带 view；ready 必须带合法 view
// ---------------------------------------------------------------------------

function starting(): DshIdeSnapshot {
	return { wireRevision: DSH_IDE_WIRE_REVISION, channelId: 'c1', version: 1, state: { state: 'starting' } };
}

test('validateDshIdeSnapshot accepts starting without view', () => {
	assert.doesNotThrow(() => validateDshIdeSnapshot(starting()));
});

test('validateDshIdeSnapshot requires a valid view when ready', () => {
	assert.throws(() => validateDshIdeSnapshot({ ...starting(), state: { state: 'ready' } }), /must be an object/);
	assert.throws(
		() => validateDshIdeSnapshot({ ...starting(), state: { state: 'ready', view: { rows: [{ id: 'row:1' }], version: 1 } } }),
		/revision must be a non-negative integer/,
	);
	const view = { rows: [{ id: 'row:1', revision: 1, kind: 'user', text: 'hi', folded: false, seq: 1 }], version: 1 };
	assert.doesNotThrow(() => validateDshIdeSnapshot({ ...starting(), state: { state: 'ready', view } }));
});

test('validateDshIdeSnapshot rejects view on non-ready states and bad row kinds', () => {
	const view = { rows: [], version: 0 };
	assert.throws(() => validateDshIdeSnapshot({ ...starting(), state: { state: 'rebuild', view } }), /only allowed when state is ready/);
	const bad = { rows: [{ id: 'row:1', revision: 1, kind: 'mystery', text: 'x', folded: false }], version: 1 };
	assert.throws(() => validateDshIdeSnapshot({ ...starting(), state: { state: 'ready', view: bad } }), /kind must be/);
});

test('validateDshIdeSnapshot rejects rows without text or preview', () => {
	const bad = { rows: [{ id: 'row:1', revision: 1, kind: 'user', folded: false }], version: 1 };
	assert.throws(() => validateDshIdeSnapshot({ ...starting(), state: { state: 'ready', view: bad } }), /must carry text or preview/);
});

// ---------------------------------------------------------------------------
// 视图宿主：首帧 starting、重复 open 复用 channelId、投影 ready、version 严格 +1
// ---------------------------------------------------------------------------

test('view service emits starting first and reuses channelId on repeated open', () => {
	const backend = fakeBackend();
	const view = new DshIdeViewService(backend);
	const first = view.open({ view: 'chat', params: { sessionId: 's-1' } });
	assert.equal(first.state.state, 'starting');
	assert.equal(first.version, 1);
	assert.equal(first.wireRevision, DSH_IDE_WIRE_REVISION);

	const again = view.open({ view: 'chat' });
	assert.equal(again.channelId, first.channelId, 'repeated open must reuse the same channelId');
	assert.equal(again.version, first.version);
	view.close();
	assert.ok(backend.calls.includes('close'));
});

test('view service publishes ready snapshots with strictly increasing versions', async () => {
	const backend = fakeBackend();
	const view = new DshIdeViewService(backend);
	view.open({ view: 'chat', params: { sessionId: 's-1' } });

	const frames: DshIdeSnapshot[] = [];
	view.subscribe(snapshot => frames.push(snapshot));

	backend.emit({ type: 'event', event: { type: 'user.message', seq: 1, text: 'hello' } });
	await microtasks();
	backend.emit({ type: 'event', event: { type: 'custom', seq: 2, text: 'done' } });
	await microtasks();

	assert.ok(frames.length >= 1, 'ready frames must be published');
	const ready = frames.at(-1)!;
	assert.equal(ready.state.state, 'ready');
	assert.equal(ready.wireRevision, DSH_IDE_WIRE_REVISION);
	assert.ok(ready.state.view !== undefined);
	assert.equal(ready.state.view.rows.length, 2);
	assert.deepEqual(ready.state.view.rows.map(r => r.id), ['row:1', 'row:2']);

	let prev: DshIdeSnapshot | undefined;
	for (const frame of frames) {
		assert.doesNotThrow(() => validateDshIdeSnapshot(frame));
		assert.doesNotThrow(() => assertSnapshotContinuity(prev, frame));
		prev = frame;
	}
	view.close();
});

test('view service batches multiple events into one published frame', async () => {
	const backend = fakeBackend();
	const view = new DshIdeViewService(backend);
	view.open({ view: 'chat', params: { sessionId: 's-1' } });
	const frames: DshIdeSnapshot[] = [];
	view.subscribe(snapshot => frames.push(snapshot));

	backend.emit({ type: 'event', event: { type: 'user.message', seq: 1, text: 'a' } });
	backend.emit({ type: 'event', event: { type: 'user.message', seq: 2, text: 'b' } });
	backend.emit({ type: 'event', event: { type: 'user.message', seq: 3, text: 'c' } });
	await microtasks();

	assert.equal(frames.length, 1, 'a microtask batch publishes a single frame');
	assert.equal(frames[0].state.view?.rows.length, 3);
	view.close();
});

test('view service rejects invoke before open with feature-unavailable', async () => {
	const view = new DshIdeViewService(fakeBackend());
	await assert.rejects(() => view.invoke('listSessions', {}), (error: { code?: string }) => error.code === DSH_IDE_FEATURE_UNAVAILABLE);
});

test('unavailable backend never fabricates snapshots or events', () => {
	const view = new DshIdeViewService(new UnavailableDshIdeBackend());
	assert.throws(() => view.open({ view: 'chat' }), (error: { code?: string }) => error.code === DSH_IDE_FEATURE_UNAVAILABLE);
});

// ---------------------------------------------------------------------------
// 通道：24 method 全覆盖 + 未知 method + 入参违规
// ---------------------------------------------------------------------------

const VALID: Record<DshIdeMethod, unknown> = {
	submit: { text: 'hello' },
	interrupt: {},
	resume: { sessionId: 's-1' },
	newSession: { workspace: 'w1', options: { preset: 'standard' } },
	fork: { sessionId: 's-1', point: 'p1' },
	rewind: { sessionId: 's-1', to: 'p0' },
	loadOlder: { sessionId: 's-1', beforeSeq: 7 },
	answerApproval: { requestId: 'r1', decision: 'approve' },
	answerQuestion: { requestId: 'r1', answer: 'yes' },
	cancelRequest: { requestId: 'r1' },
	setModel: { model: 'deepseek/deepseek-chat' },
	setEffort: { effort: 'high' },
	setPermissionPreset: { preset: 'balanced' },
	runCommand: { command: 'help', args: ['a'] },
	listSessions: {},
	deleteSession: { sessionId: 's-1' },
	listModels: { workspace: 'w1' },
	listCommands: { workspace: 'w1' },
	fetchRowDetail: { rowId: 'row:1' },
	refreshSnapshot: {},
	accountGetState: { client: { version: '2.0.0', locale: 'zh-CN', timezoneOffsetSeconds: 28800 } },
	accountGetProfile: { client: { version: '2.0.0', locale: 'zh-CN', timezoneOffsetSeconds: 28800 } },
	archiveSession: { sessionId: 's-1' },
	unarchiveSession: { sessionId: 's-1' },
	searchSessions: { query: 'hello' },
};

async function openedChannel(backend = fakeBackend()) {
	const view = new DshIdeViewService(backend);
	const channel = new DshIdeChannel(view);
	const first = await channel.call<DshIdeSnapshot>('ctx-a', DSH_IDE_CONTROL_OPEN, { view: 'chat', params: { sessionId: 's-1' } });
	return { view, channel, backend, first };
}

test('channel dispatches all 25 DTO methods through validateDshIdeInput', async () => {
	const { channel, backend } = await openedChannel();
	for (const method of ALL_METHODS) {
		const output = await channel.call<{ value: unknown }>('ctx-a', method, VALID[method]);
		assert.ok('value' in output, `${method} must return { value }`);
		assert.deepEqual(Object.keys(output), ['value'], `${method} must not leak extra keys`);
	}
	assert.deepEqual(backend.calls.filter(c => c !== 'unfollow' && c !== 'close'), ALL_METHODS);
});

test('channel rejects unknown method and malformed args with defined codes', async () => {
	const { channel } = await openedChannel();
	await assert.rejects(() => channel.call('ctx-a', '__bogus', {}), (error: { code?: string }) => error.code === DSH_IDE_FEATURE_UNAVAILABLE);
	await assert.rejects(() => channel.call('ctx-a', 'submit', { text: 'x', __extra: 1 }), (error: { code?: string }) => error.code === DSH_IDE_INVALID_ARGUMENT);
	await assert.rejects(() => channel.call('ctx-a', 'submit', { text: '' }), (error: { code?: string }) => error.code === DSH_IDE_INVALID_ARGUMENT);
});

test('channel requires an open connection for DTO calls', async () => {
	const channel = new DshIdeChannel(new DshIdeViewService(fakeBackend()));
	await assert.rejects(() => channel.call('ctx-x', 'listSessions', {}), (error: { code?: string }) => error.code === DSH_IDE_FEATURE_UNAVAILABLE);
});

// ---------------------------------------------------------------------------
// listen 三层过滤：事件名白名单 / 连接归属 / version 严格递增
// ---------------------------------------------------------------------------

test('listen ignores non-snapshot event names', async () => {
	const { channel, backend } = await openedChannel();
	const seen: DshIdeSnapshot[] = [];
	channel.listen<DshIdeSnapshot>('ctx-a', 'state')(snapshot => seen.push(snapshot));
	backend.emit({ type: 'event', event: { type: 'user.message', seq: 1, text: 'a' } });
	await microtasks();
	assert.equal(seen.length, 0, 'only the snapshot event name is forwarded');
});

test('listen filters frames by owning connection and drops non-advancing versions', async () => {
	const { channel, backend } = await openedChannel();
	const mine: DshIdeSnapshot[] = [];
	const other: DshIdeSnapshot[] = [];
	channel.listen<DshIdeSnapshot>('ctx-a', DSH_IDE_SNAPSHOT_EVENT)(snapshot => mine.push(snapshot));
	channel.listen<DshIdeSnapshot>('ctx-b', DSH_IDE_SNAPSHOT_EVENT)(snapshot => other.push(snapshot));

	backend.emit({ type: 'event', event: { type: 'user.message', seq: 1, text: 'a' } });
	await microtasks();
	backend.emit({ type: 'event', event: { type: 'custom', seq: 2, text: 'b' } });
	await microtasks();

	assert.ok(mine.length >= 2, 'owning connection receives published frames');
	assert.equal(other.length, 0, 'another connection must not consume this view frames');
	for (let i = 1; i < mine.length; i++) {
		assert.ok(mine[i].version > mine[i - 1].version, 'version must strictly increase');
	}
});

test('disposeOwner removes only the named connection and is idempotent', async () => {
	const { channel } = await openedChannel();
	await channel.call('ctx-b', DSH_IDE_CONTROL_OPEN, { view: 'chat' });
	assert.equal(channel.disposeOwner('ctx-a'), 1);
	assert.equal(channel.disposeOwner('ctx-a'), 0);
	await assert.rejects(() => channel.call('ctx-a', 'listSessions', {}), (error: { code?: string }) => error.code === DSH_IDE_FEATURE_UNAVAILABLE);
	const output = await channel.call<{ value: unknown }>('ctx-b', 'listSessions', {});
	assert.deepEqual(Object.keys(output), ['value']);
});

test('close control command releases the connection without cancelling sessions', async () => {
	const { channel, backend } = await openedChannel();
	const result = await channel.call<{ closed: true }>('ctx-a', DSH_IDE_CONTROL_CLOSE, {});
	assert.deepEqual(result, { closed: true });
	assert.ok(!backend.calls.includes('cancel'), 'closing the view must not cancel the DSH session');
});

/** 让已排队的 microtask（快照批处理）跑完。 */
async function microtasks(): Promise<void> {
	for (let i = 0; i < 3; i++) {
		await Promise.resolve();
	}
}


// ---------------------------------------------------------------------------
// 开窗控制命令（P5，用户授权先于 K5 实施）
// ---------------------------------------------------------------------------

/** 假 launcher：记录调用并按预设返回。 */
function fakeLauncher(result: { ok: true } | { ok: false; message: string }): DshIdeLauncher & { calls: unknown[] } {
	const calls: unknown[] = [];
	return {
		calls,
		launch: async spec => {
			calls.push(spec);
			return result;
		},
	};
}

test('launch control command delegates to the injected launcher', async () => {
	const launcher = fakeLauncher({ ok: true });
	const channel = new DshIdeChannel(new DshIdeViewService(fakeBackend()), launcher);
	const result = await channel.call('ctx-a', DSH_IDE_CONTROL_LAUNCH, { workspace: 'E:\DSH-IDE', sessionId: 's-1' });
	assert.deepEqual(result, { ok: true });
	assert.deepEqual(launcher.calls, [{ workspace: 'E:\DSH-IDE', sessionId: 's-1' }]);
});

test('launch accepts an empty spec (open the current workspace)', async () => {
	const launcher = fakeLauncher({ ok: true });
	const channel = new DshIdeChannel(new DshIdeViewService(fakeBackend()), launcher);
	await channel.call('ctx-a', DSH_IDE_CONTROL_LAUNCH, {});
	assert.deepEqual(launcher.calls, [{}], 'no fields means the current workspace');
});

test('launch refuses without a launcher instead of pretending success', async () => {
	const channel = new DshIdeChannel(new DshIdeViewService(fakeBackend()));
	const result = await channel.call<{ ok: boolean; code?: string }>('ctx-a', DSH_IDE_CONTROL_LAUNCH, {});
	assert.equal(result.ok, false);
	assert.equal(result.code, DSH_IDE_FEATURE_UNAVAILABLE, 'an unwired launcher must be feature-unavailable');
});

test('launch rejects malformed specs and never reaches the launcher', async () => {
	const launcher = fakeLauncher({ ok: true });
	const channel = new DshIdeChannel(new DshIdeViewService(fakeBackend()), launcher);
	for (const bad of [{ workspace: '' }, { sessionId: '   ' }, { workspace: 1 }, { __extra: 1 }]) {
		const result = await channel.call<{ ok: boolean; code?: string }>('ctx-a', DSH_IDE_CONTROL_LAUNCH, bad);
		assert.equal(result.ok, false, `${JSON.stringify(bad)} must be refused`);
		assert.equal(result.code, DSH_IDE_INVALID_ARGUMENT);
	}
	assert.deepEqual(launcher.calls, [], 'invalid specs must not open a window');
});

test('launch surfaces launcher failure messages verbatim', async () => {
	const launcher = fakeLauncher({ ok: false, message: 'spawn failed' });
	const channel = new DshIdeChannel(new DshIdeViewService(fakeBackend()), launcher);
	const result = await channel.call<{ ok: boolean; message?: string }>('ctx-a', DSH_IDE_CONTROL_LAUNCH, {});
	assert.deepEqual(result, { ok: false, message: 'spawn failed' });
});


test('launch forwards the session id to the launcher so the window can follow it', async () => {
	// 会话由 DSH 决定（不变量 I4）：开窗方必须把 sessionId 交给窗口，否则窗口只订阅 $events，
	// 拿不到会话内容，Chat 面板永远没有行。
	const launcher = fakeLauncher({ ok: true });
	const channel = new DshIdeChannel(new DshIdeViewService(fakeBackend()), launcher);
	await channel.call('ctx-a', DSH_IDE_CONTROL_LAUNCH, { sessionId: 'session-42' });
	assert.deepEqual(launcher.calls, [{ sessionId: 'session-42' }], 'the session id must reach the launcher');
});

test('openView binds the session id it is given (and only then can follow a session)', async () => {
	// 守护「传了 sessionId 才会绑定会话」：这是 Chat 面板能拿到内容的先决条件。
	const backend = fakeBackend({
		open: (spec: { params?: Record<string, unknown> }) => ({
			channelId: 'ch-1',
			sessionId: typeof spec.params?.['sessionId'] === 'string' ? spec.params['sessionId'] as string : undefined,
		}),
	});
	const view = new DshIdeViewService(backend);
	view.open({ view: 'chat', params: { sessionId: 'session-77' } });
	assert.equal(view.boundSessionId, 'session-77');
	view.close();

	const bare = new DshIdeViewService(backend);
	bare.open({ view: 'chat' });
	assert.equal(bare.boundSessionId, undefined, 'omitting sessionId leaves the view unbound (only $events is followed)');
	bare.close();
});


// ---------------------------------------------------------------------------
// session/follow 帧解包（真机缺陷修复的守护）
//
// 真机实测：`follow` 收到的是 `{ type:'snapshot', records:[{type:'event', event:{...}}] }`，
// 直接整帧喂给 translator 会被「未知类型」全部丢弃 → 绑定成功但一帧都发不出（FRAMES=0）。
// ---------------------------------------------------------------------------

test('unwrapFollowFrame expands a snapshot into its session events', () => {
	const frame = {
		type: 'snapshot',
		records: [
			{ type: 'event', event: { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: 'hi' }] } } },
			{ type: 'event', event: { type: 'assistant/message', seq: 2, data: { message: { content: [] } } } },
		],
	};
	const events = unwrapFollowFrame(frame);
	assert.equal(events.length, 2);
	assert.deepEqual(events.map(e => (e as { type: string }).type), ['user/message', 'assistant/message']);
});

test('unwrapFollowFrame expands a single incremental event frame', () => {
	const events = unwrapFollowFrame({ type: 'event', event: { type: 'tool/call', seq: 3, data: {} } });
	assert.deepEqual(events.map(e => (e as { type: string }).type), ['tool/call']);
});

test('unwrapFollowFrame turns assistant-stream chunks into neutral deltas', () => {
	// 线上形状（packages/llm/assistant-stream）：chunk 帧带 attempt 身份与 attempt 内 revision。
	// 两者必须一路带到中立事件里：瞬时帧没有会话 seq，幂等与合并只能靠它们。
	const events = unwrapFollowFrame({
		type: 'assistant-stream',
		frame: { type: 'chunk', attemptId: 'a1', revision: 3, index: 1, time: 20, chunk: { type: 'text-delta', index: 0, text: 'abc' } },
	});
	assert.deepEqual(events, [{ type: 'assistant.delta', attemptId: 'a1', streamRevision: 3, text: 'abc' }]);
});

test('unwrapFollowFrame keeps attempt identity on stream start and end frames', () => {
	assert.deepEqual(
		unwrapFollowFrame({ type: 'assistant-stream', frame: { type: 'start', attemptId: 'a1', revision: 1, turn: 2, step: 3 } }),
		[{ type: 'assistant.attempt.start', attemptId: 'a1', streamRevision: 1, turn: 2, step: 3 }],
	);
	assert.deepEqual(
		unwrapFollowFrame({ type: 'assistant-stream', frame: { type: 'end', attemptId: 'a1', revision: 5, index: 3, outcome: { kind: 'committed', eventType: 'assistant/message', seq: 7 } } }),
		[{ type: 'assistant.attempt.end', attemptId: 'a1', streamRevision: 5, outcome: 'committed' }],
	);
});

test('unwrapFollowFrame marks an end frame as abandoned unless a visible message settled it', () => {
	// 上游 end.outcome：`abandoned` 或结算为 `assistant/attempt` 都表示这次尝试没有可见消息；
	// 投影器要靠这个结局丢弃临时行，否则失败尝试会留下半截回答。
	assert.deepEqual(
		unwrapFollowFrame({ type: 'assistant-stream', frame: { type: 'end', attemptId: 'a1', revision: 5, index: 3, outcome: { kind: 'abandoned' } } }),
		[{ type: 'assistant.attempt.end', attemptId: 'a1', streamRevision: 5, outcome: 'abandoned' }],
	);
	assert.deepEqual(
		unwrapFollowFrame({ type: 'assistant-stream', frame: { type: 'end', attemptId: 'a2', revision: 9, index: 1, outcome: { kind: 'committed', eventType: 'assistant/attempt', seq: 8 } } }),
		[{ type: 'assistant.attempt.end', attemptId: 'a2', streamRevision: 9, outcome: 'abandoned' }],
	);
	// 结局缺失时按「已结算」处理：不凭空丢弃可能有正文的行。
	assert.deepEqual(
		unwrapFollowFrame({ type: 'assistant-stream', frame: { type: 'end', attemptId: 'a3', revision: 2, index: 0 } }),
		[{ type: 'assistant.attempt.end', attemptId: 'a3', streamRevision: 2, outcome: 'committed' }],
	);
});

test('unwrapFollowFrame drops stream frames without attempt identity instead of guessing one', () => {
	// 没有 attemptId / revision 就无法做幂等与归并；伪造一个身份会让重放双写。
	assert.deepEqual(unwrapFollowFrame({ type: 'assistant-stream', frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'abc' } } }), []);
	assert.deepEqual(unwrapFollowFrame({ type: 'assistant-stream', frame: { type: 'start' } }), []);
});

test('unwrapFollowFrame drops non-text stream chunks so reasoning never mixes into the answer row', () => {
	assert.equal(unwrapFollowFrame({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a1', revision: 1, chunk: { type: 'text-delta', text: 'x' } } }).length, 1);
	assert.deepEqual(
		unwrapFollowFrame({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a1', revision: 2, chunk: { type: 'reasoning-delta', text: 'thinking' } } }),
		[],
	);
});

test('unwrapFollowFrame drops frames that carry no session content', () => {
	for (const frame of [
		{ type: 'waterfall', eventId: 'e1', event: 'approval/request' },
		{ type: 'ready', clientId: 'c1' },
		{ type: 'cancel', eventId: 'e1' },
		{ type: 'snapshot' },
		{},
		null,
		'not-a-frame',
	]) {
		assert.deepEqual(unwrapFollowFrame(frame), [], `frame ${JSON.stringify(frame)} must yield no events`);
	}
});
