/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// B00 显式红测：由 PROJECT_AUDIT.md 的命令单独执行，不注册到发布门禁。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import {
	DSH_IDE_ALREADY_RESOLVED,
	DSH_IDE_FEATURE_UNAVAILABLE,
	DSH_IDE_SESSION_SWITCHED,
	DSH_IDE_WIRE_REVISION,
	validateDshIdeInput,
	type DshIdeBackend,
	type DshIdeConversationNode,
	type DshIdeConversationView,
	type DshIdeLoadOlderPage,
	type DshIdeSnapshot,
	type DshIdeViewSnapshot,
	type DshIdeWaterfallNotice,
} from '../../../../src/vs/platform/dshClient/common/dshIdeProtocol.ts';

const root = new URL('../../../../', import.meta.url);

// 构建项目与工作台使用不同的编译选项。这里只声明测试调用到的转译产物表面。
interface TestDisposable {
	dispose(): void;
}

interface TestChannel extends TestDisposable {
	call<T>(owner: string, command: string, args: unknown): Promise<T>;
}

interface TestChatModel extends TestDisposable {
	readonly list: readonly { readonly seq: number }[];
	acceptConversation(view: DshIdeConversationView): unknown;
	prependPage(page: DshIdeLoadOlderPage): { readonly added: number };
}

interface TestChatSession extends TestDisposable {
	acceptWaterfall(notice: DshIdeWaterfallNotice): void;
	answerApproval(eventId: string, decision: 'reject'): Promise<void>;
	pending(): readonly unknown[];
}

interface TestConsumer extends TestDisposable {
	readonly state: { readonly phase: string; readonly version: number; readonly view?: DshIdeViewSnapshot };
	accept(snapshot: DshIdeSnapshot): boolean;
}

interface TestClient {
	call(method: string, args?: Record<string, unknown>): Promise<unknown>;
}

interface TestComposer extends TestDisposable {
	selectModel(provider: string, model: string): Promise<void>;
}

function loadBuilt<T>(path: string): Promise<T> {
	return import(new URL(`out/vs/${path}.js`, root).href);
}

const [
	{ createDshIdeBackendFromEnv }, { DshIdeChannel }, { DshIdeViewService }, { DshChatModel },
	{ DshChatSession }, { DshComposerSource }, { DSH_IDE_MERGE_WINDOW_MS, DshIdeConsumer },
	{ createDshIdeConversationState, projectDshIdeConversation },
] = await Promise.all([
	loadBuilt<{ createDshIdeBackendFromEnv(env: Record<string, string>): DshIdeBackend }>('platform/dshClient/electron-main/dshIdeBackendFactory'),
	loadBuilt<{ DshIdeChannel: new (view: unknown) => TestChannel }>('platform/dshClient/electron-main/dshIdeChannel'),
	loadBuilt<{ DshIdeViewService: new (backend: DshIdeBackend) => unknown }>('platform/dshClient/electron-main/ide-view-service'),
	loadBuilt<{ DshChatModel: new () => TestChatModel }>('workbench/contrib/dsh/browser/dshChatModel'),
	loadBuilt<{ DshChatSession: new (client: TestClient) => TestChatSession }>('workbench/contrib/dsh/browser/dshChatSession'),
	loadBuilt<{ DshComposerSource: new (client: TestClient, log: { trace(): void; warn(): void }) => TestComposer }>('workbench/contrib/dsh/browser/dshComposerSource'),
	loadBuilt<{ DSH_IDE_MERGE_WINDOW_MS: number; DshIdeConsumer: new () => TestConsumer }>('workbench/contrib/dsh/browser/dshIdeConsumer'),
	loadBuilt<{ createDshIdeConversationState(): unknown; projectDshIdeConversation(state: unknown, frame: unknown): { nodes: readonly DshIdeConversationNode[] } | undefined }>('platform/dshClient/common/dshIdeConversation'),
]);
const source = (file: string) => readFileSync(new URL(file, root), 'utf8');
const content = (text: string) => [{ type: 'text' as const, text }];
const userNode = (seq: number, text: string): DshIdeConversationNode => ({ kind: 'user', seq, time: seq, content: content(text) });

/**
 * 同一绑定的 ready 帧。
 *
 * `generation` 只在换绑时递增（契约语义），不随 `version` 走：把它绑到 version 会让
 * 每个内容帧都像一次换绑，合并窗口因此被误判为跨代而丢字段。
 */
function readyFrame(version: number, view: DshIdeViewSnapshot, generation = 1): DshIdeSnapshot {
	return { wireRevision: DSH_IDE_WIRE_REVISION, channelId: 'local-view', version, binding: { viewId: 'local-view', generation, sessionId: null }, state: { state: 'ready', view } };
}

function createIdentityFixture(invoke: DshIdeBackend['invoke'] = async () => ({ accepted: true })) {
	const followed: (string | undefined)[] = [];
	const released: (string | undefined)[] = [];
	const dispatched: string[] = [];
	const backend: DshIdeBackend = {
		open: ({ params }) => {
			const sessionId = params?.sessionId;
			assert.ok(typeof sessionId === 'string', 'the fixture must specify a session');
			return { channelId: `fixture-${sessionId}`, sessionId };
		},
		follow: sessionId => {
			followed.push(sessionId);
			return { dispose: () => { released.push(sessionId); } };
		},
		invoke: (method, args) => {
			dispatched.push(method);
			return invoke(method, args);
		},
		close() { },
	};
	// 生产装配是一个共享后端 + 每条连接一个视图：夹具必须照这个形状建立。
	return { channel: new DshIdeChannel(() => new DshIdeViewService(backend)), followed, released, dispatched };
}

test('BUG-008: two local owners independently open their selected sessions', async () => {
	const { channel, followed } = createIdentityFixture();
	try {
		const first: DshIdeSnapshot = await channel.call('local-owner-A', 'open', { view: 'chat', params: { sessionId: 'A' } });
		const second: DshIdeSnapshot = await channel.call('local-owner-B', 'open', { view: 'chat', params: { sessionId: 'B' } });
		assert.deepEqual(followed, ['A', 'B'], 'opening B must not reuse the subscription for A');
		assert.notEqual(second.channelId, first.channelId);
	} finally {
		channel.dispose();
	}
});

for (const method of ['newSession', 'fork'] as const) {
	test(`BUG-008: a late ${method} result does not take over a newer binding`, { timeout: 5000 }, async () => {
		const started = Promise.withResolvers<void>();
		const delayed = Promise.withResolvers<{ accepted: true; sessionId: string }>();
		const { channel, followed } = createIdentityFixture(async actualMethod => {
			assert.equal(actualMethod, method);
			started.resolve();
			return delayed.promise;
		});
		const owner = 'local-owner-A';
		try {
			await channel.call(owner, 'open', { view: 'chat', params: { sessionId: 'A' } });
			const result = channel.call(owner, method, method === 'fork' ? { sessionId: 'A' } : {});
			const settled = Promise.allSettled([result]);
			await Promise.race([started.promise, settled.then(() => assert.fail('the fixture must dispatch before settling'))]);
			await channel.call(owner, 'rebind', { sessionId: 'B' });
			assert.deepEqual(followed, ['A', 'B'], 'the user selection must have started before the reply');
			delayed.resolve({ accepted: true, sessionId: 'created' });
			const [outcome] = await settled;
			if (outcome.status === 'rejected') {
				assert.equal(outcome.reason?.code, DSH_IDE_SESSION_SWITCHED, 'only a stale binding error is expected');
			}
			assert.deepEqual(followed, ['A', 'B'], 'a late reply must not start a follow on behalf of a newer binding');
		} finally {
			delayed.resolve({ accepted: true, sessionId: 'created' });
			channel.dispose();
		}
	});
}

test('BUG-008: closing the last local owner releases its follow without stopping the session', async () => {
	const { channel, followed, released, dispatched } = createIdentityFixture();
	try {
		const owner = 'local-owner-A';
		await channel.call(owner, 'open', { view: 'chat', params: { sessionId: 'A' } });
		assert.deepEqual(followed, ['A']);
		assert.deepEqual(await channel.call(owner, 'close', {}), { closed: true });
		assert.deepEqual(dispatched.filter(method => method === 'interrupt' || method === 'cancelRequest'), []);
		assert.deepEqual(released, ['A'], 'last-owner close must release the logical follow');
	} finally {
		channel.dispose();
	}
});

test('BUG-010: a terminal cancel removes a card that was hidden while submitting', async () => {
	const decision = Promise.withResolvers<{ ok: false; error: { code: string; message: string } }>();
	const session = new DshChatSession({ call: () => decision.promise });
	try {
		session.acceptWaterfall({
			kind: 'request', eventId: 'fixture-hide', event: 'approval/request', agentId: 'fixture-agent',
			request: { toolName: 'preview' },
		});
		const sent = session.answerApproval('fixture-hide', 'approve');
		assert.deepEqual(session.pending(), [], 'the card is hidden while the decision is in flight');
		// 桌面先答：终态在卡片已隐藏之后到达，之后任何迟到请求帧都不得把它画回来。
		session.acceptWaterfall({ kind: 'cancel', eventId: 'fixture-hide' });
		decision.resolve({ ok: false, error: { code: DSH_IDE_FEATURE_UNAVAILABLE, message: 'channel not ready' } });
		await sent;
		session.acceptWaterfall({
			kind: 'request', eventId: 'fixture-hide', event: 'approval/request', agentId: 'fixture-agent',
			request: { toolName: 'preview' },
		});
		assert.deepEqual(session.pending(), [], 'a terminal request cannot reappear after a late request frame');
	} finally {
		session.dispose();
	}
});

test('BUG-017: only a single-select single question is answered from the native card', async () => {
	const calls: { method: string; args: Record<string, unknown> }[] = [];
	const session = new DshChatSession({
		call: async (method: string, args: Record<string, unknown>) => {
			calls.push({ method, args });
			return { ok: true, value: { accepted: true } };
		},
	});
	try {
		const question = (eventId: string, questions: readonly Record<string, unknown>[]) => session.acceptWaterfall({
			kind: 'request', eventId, event: 'user-questions/request', agentId: 'fixture-agent',
			request: { questions },
		} as never);

		// 单题单选：原生卡片能完整承接，提交的就是用户点的那一项。
		question('q-single', [{ id: 'q1', question: 'Pick one', options: [{ label: 'A' }, { label: 'B' }] }]);
		await session.answerQuestion('q-single', 'B');
		assert.deepEqual(calls.at(-1)?.args.answer, { answers: [{ id: 'q1', selected: ['B'] }] });

		// 多题：一份只含第一题的回答不是完整答案，必须交还桌面而不是提交半份。
		question('q-multi', [
			{ id: 'q1', question: 'First', options: [{ label: 'A' }] },
			{ id: 'q2', question: 'Second', options: [{ label: 'B' }] },
		]);
		const before = calls.length;
		await session.answerQuestion('q-multi', 'A');
		assert.equal(calls.length, before, 'a partial answer must not be submitted');
		assert.equal(session.questionFellBackToDesktop('q-multi'), true, 'the card must report the desktop handoff');
		assert.deepEqual(session.pending().map(item => item.eventId), ['q-multi'], 'the card stays for the desktop入口');

		// 多选：同样无法由「点一项」完整承接。
		question('q-select-many', [{ id: 'q1', question: 'Choose', multiSelect: true, options: [{ label: 'A' }, { label: 'B' }] }]);
		const afterMulti = calls.length;
		await session.answerQuestion('q-select-many', 'A');
		assert.equal(calls.length, afterMulti, 'a multi-select answer must not be reduced to one choice');

		// 无选项：没有任何可提交的答案。
		question('q-empty', [{ id: 'q1', question: 'Free form' }]);
		const afterEmpty = calls.length;
		await session.answerQuestion('q-empty', 'anything');
		assert.equal(calls.length, afterEmpty, 'a question without options cannot be answered by a label');
	} finally {
		session.dispose();
	}
});

test('BUG-010: a decision already settled elsewhere does not restore its card', async () => {
	const decision = Promise.withResolvers<{ ok: false; error: { code: string; message: string } }>();
	const session = new DshChatSession({ call: () => decision.promise });
	try {
		session.acceptWaterfall({
			kind: 'request', eventId: 'fixture-approval', event: 'approval/request', agentId: 'fixture-agent',
			request: { toolName: 'preview' },
		});
		assert.equal(session.pending().length, 1, 'the fixture must create a card');
		const sent = session.answerApproval('fixture-approval', 'reject');
		assert.deepEqual(session.pending(), [], 'the card is hidden while the decision is in flight');
		session.acceptWaterfall({ kind: 'cancel', eventId: 'fixture-approval' });
		decision.resolve({ ok: false, error: { code: DSH_IDE_ALREADY_RESOLVED, message: 'Already settled' } });
		await sent;
		assert.deepEqual(session.pending(), [], 'a terminal result cannot make the card clickable again');
	} finally {
		session.dispose();
	}
});

test('BUG-012: the next live view preserves an already loaded older page', () => {
	const model = new DshChatModel();
	try {
		const current = userNode(9, 'Current');
		model.acceptConversation({ nodes: [current], hasMore: true });
		const page = model.prependPage({
			records: [{ type: 'event', event: { type: 'user/message', seq: 2, time: 2, data: { source: { kind: 'user' }, content: content('Earlier') } } }],
			hasMore: false,
		});
		assert.equal(page.added, 1, 'the older record must be present before the next follow frame');
		model.acceptConversation({ nodes: [current, userNode(10, 'Next')], hasMore: true });
		assert.deepEqual(model.list.map(node => node.seq), [2, 9, 10]);
	} finally {
		model.dispose();
	}
});

test('BUG-012: the paging cursor stays on durable history after the live window slides', () => {
	const model = new DshChatModel();
	try {
		// 实时窗口先给 9，再读到更早的 2，然后窗口滑到 10：游标不能跟着窗口下移。
		model.acceptConversation({ nodes: [userNode(9, 'Current')], hasMore: true });
		assert.equal(model.pagingCursor(), 9, 'the cursor starts at the live window floor');
		model.prependPage({
			records: [{ type: 'event', event: { type: 'user/message', seq: 2, time: 2, data: { source: { kind: 'user' }, content: content('Earlier') } } }],
			hasMore: true,
		});
		assert.equal(model.pagingCursor(), 2, 'a loaded page moves the cursor back');
		model.acceptConversation({ nodes: [userNode(10, 'Next')], hasMore: true });
		assert.equal(model.pagingCursor(), 2, 'the live window sliding forward must not move the cursor');
		assert.deepEqual(model.list.map(node => node.seq), [2, 10], 'the loaded page stays visible after the window slides');
	} finally {
		model.dispose();
	}
});

test('BUG-012: an empty projection page ends paging instead of looping', () => {
	const model = new DshChatModel();
	try {
		model.acceptConversation({ nodes: [userNode(5, 'Only')], hasMore: true });
		const cursor = model.pagingCursor();
		const outcome = model.prependPage({ records: [], hasMore: true });
		assert.deepEqual({ added: outcome.added, hasMore: model.hasMore(), cursor: model.pagingCursor() }, { added: 0, hasMore: false, cursor });
		// 已读到头之后，实时帧自称「还有更多」不能把翻页重新打开。
		model.acceptConversation({ nodes: [userNode(6, 'Later')], hasMore: true });
		assert.equal(model.hasMore(), false, 'a finished history must not reopen paging');
	} finally {
		model.dispose();
	}
});

test('BUG-012: rebinding is the only thing that drops loaded pages', () => {
	const model = new DshChatModel();
	try {
		model.acceptConversation({ nodes: [userNode(9, 'Current')], hasMore: true });
		model.prependPage({
			records: [{ type: 'event', event: { type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' }, content: content('Oldest') } } }],
			hasMore: true,
		});
		assert.deepEqual(model.list.map(node => node.seq), [1, 9]);
		model.clear();
		assert.deepEqual(model.list.map(node => node.seq), [], 'clearing the binding drops the loaded pages');
		assert.equal(model.pagingCursor(), undefined, 'the cursor resets with the binding');
	} finally {
		model.dispose();
	}
});

test('BUG-013: starting a new binding never republishes the previous ready view', t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const consumer = new DshIdeConsumer();
	try {
		const previous = { frame: { type: 'snapshot' }, conversation: { nodes: [userNode(1, 'Previous')], hasMore: false } };
		assert.equal(consumer.accept(readyFrame(1, previous)), true);
		t.mock.timers.tick(DSH_IDE_MERGE_WINDOW_MS);
		assert.ok(consumer.state.view, 'the first ready view must be applied');
		assert.equal(consumer.accept({ wireRevision: DSH_IDE_WIRE_REVISION, channelId: 'local-view', version: 2, binding: { viewId: 'local-view', generation: 2, sessionId: null }, state: { state: 'starting' } }), true);
		t.mock.timers.tick(DSH_IDE_MERGE_WINDOW_MS);
		assert.equal(consumer.state.phase, 'starting');
		assert.equal(consumer.state.view, undefined);
	} finally {
		consumer.dispose();
	}
});

test('BUG-013: coalescing retains fields carried only by the opening baseline', t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const consumer = new DshIdeConsumer();
	try {
		const plan = { active: true, pending: false };
		assert.equal(consumer.accept(readyFrame(1, { frame: { type: 'snapshot' }, plan })), true);
		assert.equal(consumer.accept(readyFrame(2, { frame: { type: 'event' } })), true);
		t.mock.timers.tick(DSH_IDE_MERGE_WINDOW_MS);
		assert.equal(consumer.state.version, 2);
		assert.deepEqual(consumer.state.view?.plan, plan);
	} finally {
		consumer.dispose();
	}
});

test('BUG-013: a generation change drops the previous view before the new one is ready', t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const consumer = new DshIdeConsumer();
	try {
		const previous = { frame: { type: 'snapshot' }, plan: { active: true, pending: false } };
		assert.equal(consumer.accept(readyFrame(1, previous, 1)), true);
		t.mock.timers.tick(DSH_IDE_MERGE_WINDOW_MS);
		assert.ok(consumer.state.view, 'the first generation renders');
		// 同一 channelId 上的新一代（重建）：旧视图必须立刻作废，不能被沿用。
		assert.equal(consumer.accept({ wireRevision: DSH_IDE_WIRE_REVISION, channelId: 'local-view', version: 2, binding: { viewId: 'local-view', generation: 2, sessionId: null }, state: { state: 'rebuild' } }), true);
		t.mock.timers.tick(DSH_IDE_MERGE_WINDOW_MS);
		assert.deepEqual({ phase: consumer.state.phase, view: consumer.state.view }, { phase: 'rebuild', view: undefined });
	} finally {
		consumer.dispose();
	}
});

test('BUG-013: an explicit empty list overrides the previous baseline', t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const consumer = new DshIdeConsumer();
	try {
		assert.equal(consumer.accept(readyFrame(1, { frame: { type: 'snapshot' }, todos: [{ content: 'Task', status: 'pending' }] })), true);
		t.mock.timers.tick(DSH_IDE_MERGE_WINDOW_MS);
		assert.equal((consumer.state.view?.todos ?? []).length, 1);
		// 空数组是显式「已清空」，不是「本帧没带」：必须覆盖，不能被基线补回来。
		assert.equal(consumer.accept(readyFrame(2, { frame: { type: 'snapshot' }, todos: [] })), true);
		t.mock.timers.tick(DSH_IDE_MERGE_WINDOW_MS);
		assert.deepEqual(consumer.state.view?.todos, []);
	} finally {
		consumer.dispose();
	}
});

test('BUG-013: a non-ready frame never republishes the last ready view', t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const consumer = new DshIdeConsumer();
	try {
		assert.equal(consumer.accept(readyFrame(1, { frame: { type: 'snapshot' }, plan: { active: true, pending: false } })), true);
		t.mock.timers.tick(DSH_IDE_MERGE_WINDOW_MS);
		assert.equal(consumer.accept({ wireRevision: DSH_IDE_WIRE_REVISION, channelId: 'local-view', version: 2, binding: { viewId: 'local-view', generation: 1, sessionId: null }, state: { state: 'starting' } }), true);
		t.mock.timers.tick(DSH_IDE_MERGE_WINDOW_MS);
		assert.deepEqual({ phase: consumer.state.phase, view: consumer.state.view }, { phase: 'starting', view: undefined });
		// 回到 ready 时不得把 starting 之前的内容当成「保留的基线」重新画出来。
		assert.equal(consumer.accept(readyFrame(3, { frame: { type: 'snapshot' } })), true);
		t.mock.timers.tick(DSH_IDE_MERGE_WINDOW_MS);
		assert.deepEqual(consumer.state.view?.plan, undefined, 'a starting gap breaks the baseline');
	} finally {
		consumer.dispose();
	}
});

test('BUG-014: closing during a deferred handshake cannot dispatch an obsolete read', async t => {
	const handshake = Promise.withResolvers<Response>();
	const origin = 'http://127.0.0.1:9';
	let reads = 0;
	const fetch = t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
		if (String(input) === `${origin}/handshake-fixture`) {
			return handshake.promise;
		}
		assert.equal(String(input), `${origin}/api/ide/dispatch`);
		reads++;
		assert.ok(typeof init?.body === 'string', 'the fake caller must send one JSON envelope');
		const { rpcId } = JSON.parse(init.body);
		return Response.json({ type: 'server-response', rpcId, result: { ok: true, value: {} } });
	});
	const backend = createDshIdeBackendFromEnv({
		DSH_IDE_ENDPOINT: origin,
		DSH_IDE_ENDPOINT_FILE: fileURLToPath(new URL('fixture-no-endpoint.json', import.meta.url)),
		DSH_IDE_LAUNCH_URL: `${origin}/handshake-fixture`,
	});
	backend.open({ view: 'chat', params: { sessionId: 'A' } });
	const pending = backend.invoke('capabilities', {}).then(() => 'completed', () => 'cancelled');
	try {
		assert.equal(fetch.mock.callCount(), 1, 'the mocked handshake must be in flight before close');
		backend.close();
		handshake.resolve(new Response(null, { status: 303, headers: { 'set-cookie': 'fixture=unit' } }));
		const result = await pending;
		assert.deepEqual({ result, reads }, { result: 'cancelled', reads: 0 });
	} finally {
		handshake.resolve(new Response(null, { status: 503 }));
		await pending;
		backend.close();
	}
});

test('BUG-015: model selection with a slash-qualified model reaches the real DTO schema', async () => {
	const writes: { method: string; args: Record<string, unknown> }[] = [];
	const client = {
		async call(method: string, args: Record<string, unknown> = {}) {
			if (method === 'composerState') {
				return { ok: true, value: {} };
			}
			writes.push({ method, args });
			return { ok: true, value: { accepted: true } };
		},
	};
	const log = { trace() { }, warn() { } };
	const source = new DshComposerSource(client, log);
	// 写回带会话身份：未绑定时写回被跳过，写不进 DTO schema。
	source.setSession('s-1');
	try {
		await source.selectModel('provider-a', 'family/model-a');
		await source.selectModel('provider-b', 'family/model-b');
		assert.equal(writes.length, 2);
		for (const write of writes) {
			assert.equal(write.method, 'setModel');
			assert.doesNotThrow(() => validateDshIdeInput('setModel', write.args));
		}
		assert.deepEqual(writes.map(write => write.args.model), ['provider-a/family/model-a', 'provider-b/family/model-b']);
	} finally {
		source.dispose();
	}
});

test('BUG-015: the native picker writes the selection back to the bound session', () => {
	// 只核对接线与身份切分：原生选择器必须把用户操作写回会话，且用真实路由而不是显示名。
	const input = source('src/vs/workbench/contrib/chat/browser/widget/input/chatInputPart.ts');
	assert.match(input, /if \(isUserAction\) \{\s*\n\s*void this\._writeModelSelectionToSession\(model\);/,
		'a user model pick must trigger a write-back');
	assert.match(input, /candidate\.selectModel\(/, 'the write-back must reach the session object');
	assert.match(input, /model\.identifier\.indexOf\('\/'\)/, 'identity must come from the identifier, not the display name');
	assert.match(input, /model\.identifier\.slice\(separator \+ 1\)/, 'the model id keeps every slash after the first');
	assert.doesNotMatch(input, /model\.metadata\.name \?\? model\.identifier/, 'the display name must never be used as the model id');
});

test('BUG-015: a slash-qualified model keeps its provider and full model id', async () => {
	const writes: { method: string; args: Record<string, unknown> }[] = [];
	const session = new DshChatSession({
		call: async (method: string, args: Record<string, unknown>) => {
			writes.push({ method, args });
			return { ok: true, value: { accepted: true } };
		},
		rebindView: async () => ({ ok: true }),
	} as never);
	try {
		assert.equal(await session.bind('s-1'), true);
		// 模型名本身含斜杠：只有第一个斜杠分隔 provider 与 model。
		await session.selectModel('provider-a', 'family/model-a');
		assert.deepEqual(writes.at(-1), { method: 'setModel', args: { sessionId: 's-1', model: 'provider-a/family/model-a' } });
		assert.doesNotThrow(() => validateDshIdeInput('setModel', writes.at(-1)!.args));
	} finally {
		session.dispose();
	}
});

test('BUG-015: a rejected write-back does not pretend the selection succeeded', async () => {
	let changed = 0;
	const session = new DshChatSession({
		call: async () => ({ ok: false, error: { code: 'dsh-ide/invalid-argument', message: 'unknown model' } }),
		rebindView: async () => ({ ok: true }),
	} as never);
	try {
		session.onDidChangeModelMenu(() => changed++);
		assert.equal(await session.bind('s-1'), true);
		const before = changed;
		await session.selectModel('provider-a', 'missing');
		// 内核拒绝时不得改本地当前模型，也不得发出「已切换」通知。
		assert.equal(changed, before, 'a rejected selection must not announce a change');
		assert.deepEqual(session.currentModel(), undefined, 'a rejected selection must not become the current model');
	} finally {
		session.dispose();
	}
});

test('BUG-022: a replace surfaceOp removes the nodes it supersedes', () => {
	const state = createDshIdeConversationState();
	// 先落两条普通消息（append 语义）。
	const first = projectDshIdeConversation(state, { type: 'event', event: {
		type: 'user/message', seq: 1, time: 1, surfaceOp: { op: 'append' },
		data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'first' }] },
	} });
	assert.deepEqual(first?.nodes.map(node => node.seq), [1]);
	const second = projectDshIdeConversation(state, { type: 'event', event: {
		type: 'user/message', seq: 2, time: 2, surfaceOp: { op: 'append' },
		data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'second' }] },
	} });
	assert.deepEqual(second?.nodes.map(node => node.seq), [1, 2]);
	// 新事件以 replace 覆盖 [1,2]：旧的两条必须消失，只留新的一条。
	const replaced = projectDshIdeConversation(state, { type: 'event', event: {
		type: 'user/message', seq: 3, time: 3, surfaceOp: { op: 'replace', startSeq: 1, endSeq: 2 },
		data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'compacted' }] },
	} });
	assert.deepEqual(replaced?.nodes.map(node => node.seq), [3], 'the superseded nodes must be gone');
});

test('BUG-022: a replace that does not cover a node leaves it in place', () => {
	const state = createDshIdeConversationState();
	for (const seq of [1, 2, 3]) {
		projectDshIdeConversation(state, { type: 'event', event: {
			type: 'user/message', seq, time: seq, surfaceOp: { op: 'append' },
			data: { source: { kind: 'user' }, content: [{ type: 'text', text: `m${seq}` }] },
		} });
	}
	// 只覆盖 [2,2]：1 与 3 必须留下。
	const view = projectDshIdeConversation(state, { type: 'event', event: {
		type: 'user/message', seq: 4, time: 4, surfaceOp: { op: 'replace', startSeq: 2, endSeq: 2 },
		data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'replaced' }] },
	} });
	assert.deepEqual(view?.nodes.map(node => node.seq), [1, 3, 4]);
});

test('BUG-022: the stream baseline reads revision from the outer assistantStream', () => {
	const state = createDshIdeConversationState();
	// 官方形状：revision 在外层，activeAttempt 只是镜像。
	const view = projectDshIdeConversation(state, { type: 'snapshot', records: [], hasMore: false, assistantStream: {
		revision: 7,
		activeAttempt: { attemptId: 'a-1', turn: 1, step: 1, stream: [{ type: 'text-delta', text: 'live' }] },
	} });
	const stream = view?.nodes.find(node => node.kind === 'assistant');
	assert.ok(stream !== undefined, 'the in-flight attempt must be projected');
	// 内层没有 revision 时也必须拿到外层的 7：否则基线记成 0，
	// 后续 revision 8 虽仍会通过，但 revision 1..7 的 chunk 会被误判为「不新」。
	// 官方分发形状是 `{ type:'assistant-stream', frame: <AssistantStreamFrame> }`。
	const afterChunk = projectDshIdeConversation(state, {
		type: 'assistant-stream',
		frame: { type: 'chunk', attemptId: 'a-1', revision: 8, chunk: { type: 'text-delta', text: ' more' } },
	});
	assert.ok(afterChunk !== undefined, 'a newer chunk must be accepted after the baseline');
	assert.ok(
		afterChunk.nodes.some(node => node.kind === 'assistant' && JSON.stringify(node).includes('more')),
		'the newer chunk content must reach the projected node',
	);
});

test('BUG-018: a first-click open reports queued, not opened', () => {
	// 只核对结果语义：拉起进程不等于窗口已经打开。
	const service = source('src/vs/platform/dshClient/host/ide-service.js');
	assert.match(service, /via: 'registered-ide', opened: true/, 'a registered IDE really opens the window');
	assert.match(service, /via: 'spawned-ide', opened: false, queued: true/, 'a freshly spawned IDE is only queued');
	assert.doesNotMatch(service, /via: 'spawned-ide' \};/, 'a spawned IDE must never be reported as opened');
});

test('BUG-018: the spawn result waits for the asynchronous error event', () => {
	const service = source('src/vs/platform/dshClient/host/ide-service.js');
	// `spawn` 只代表请求已提交；真正的失败以异步 `error` 到达，try/catch 覆盖不到。
	assert.match(service, /child\.once\('error'/, 'the async error event must be observed');
	assert.match(service, /child\.once\('spawn'/, 'success must be confirmed by the spawn event');
	assert.match(service, /child\.pid === undefined/, 'a child without a pid did not start');
});

test('BUG-020: a business rejection is never replayed as if it were a transport failure', () => {
	// 只核对分类边界：端点没变时不得重放，否则一次业务拒绝会被当成瞬时故障重发。
	const factory = source('src/vs/platform/dshClient/electron-main/dshIdeBackendFactory.ts');
	assert.match(factory, /if \(!\(await this\.refreshEndpoint\(\)\)\) \{\s*\n\s*throw error;/, 'a non-endpoint failure must be rethrown unchanged');
	assert.match(factory, /this\.assertLive\(epoch\)/, 'a closed view must cancel the call instead of retrying it');
});

test('BUG-021: an archive reply older than a newer request is discarded', () => {
	// 回包是完整集合，只能整体采纳；乱序时必须只采纳序号最新的那一次。
	const controller = source('src/vs/workbench/contrib/dsh/browser/dshAgentSessionsController.ts');
	assert.match(controller, /const epoch = \+\+this\.archiveEpoch;/, 'each archive request must take an epoch');
	assert.match(controller, /if \(!isCurrentRefresh\(epoch, this\.archiveEpoch\)\)/, 'a stale reply must be dropped before it replaces the set');
});

test('BUG-021: a queued toggle re-checks ownership before it runs', () => {
	const host = source('src/vs/platform/dshClient/host/ide-view-host.js');
	// 入队前的检查不够：排队期间视图可能换绑，执行时必须重新核对这一行仍然可见。
	const favorite = host.slice(host.indexOf('async setSessionFavorite'));
	const pin = host.slice(host.indexOf('async setSessionPinned'));
	const recheck = /enqueueToggle\(`[^`]+`, async \(\) => \{\s*\n\s*\/\/[^\n]*\n\s*await assertVisibleRowForBridge\(bridge, args\.sessionId\);/;
	assert.match(favorite, recheck, 'setSessionFavorite must re-check ownership inside the queued task');
	assert.match(pin, recheck, 'setSessionPinned must re-check ownership inside the queued task');
});

test('BUG-019: the remote image probe is bounded and always settles', () => {
	// 只读结构核验：不联网，不触发真实下载。
	const helper = source('extensions/emmet/src/imageSizeHelper.ts');
	assert.match(helper, /const MAX_IMAGE_PROBE_BYTES = /, 'the probe must have a byte ceiling');
	assert.match(helper, /const IMAGE_PROBE_TIMEOUT_MS = /, 'the probe must have a time limit');
	assert.match(helper, /let settled = false;/, 'the probe must settle exactly once');
	assert.match(helper, /if \(bufSize > MAX_IMAGE_PROBE_BYTES\)/, 'an oversized body must be abandoned');
	assert.match(helper, /resp\.destroy\(\)/, 'the response must be torn down on every exit');
	// 解析不出尺寸时必须结算为 undefined，而不是把错误吞掉让 Promise 悬空。
	const finalBlock = helper.slice(helper.indexOf('if (final) {'), helper.indexOf('if (final) {') + 200);
	assert.match(finalBlock, /resolve\(undefined\)/, 'an unrecognised body must resolve, not hang');
	assert.doesNotMatch(finalBlock, /^\s*\/\/ might not have enough data, skip error\s*$/m, 'a final parse failure is not a silent skip');
});

test('BUG-024: a scenario tool pattern mismatch fails instead of running another tool', () => {
	// 只读结构核验：模拟器是测试工具链，不启动真实服务。
	const server = source('scripts/chat-simulation/common/mock-llm-server.ts');
	assert.doesNotMatch(server, /requestToolNames\[0\]/, 'no branch may silently substitute the first tool');
	assert.match(server, /measurements are not comparable/, 'a mismatch must be reported as non-comparable');
	// 四条协议路径都必须显式失败，而不是只有一条。
	const throws = (server.match(/throw new Error\(/g) ?? []).length;
	assert.ok(throws >= 1, 'a mismatch must throw');
	assert.equal(
		(server.match(/matched none of/g) ?? []).length,
		4,
		'all four protocol paths must reject a mismatch',
	);
});

test('BUG-023: the sessions control follows the list visibility, not just the pane', () => {
	// 只读结构核验：可见状态必须只有一个来源（pane 可见 且 列表实际显示）。
	const pane = source('src/vs/workbench/contrib/chat/browser/widgetHosts/viewPane/chatViewPane.ts');
	assert.doesNotMatch(
		pane,
		/onDidChangeBodyVisibility\(visible => sessionsControl\.setVisible\(visible\)\)/,
		'the pane must not drive the control on its own',
	);
	assert.match(
		pane,
		/onDidChangeBodyVisibility\(\(\) => this\.refreshSessionsControlVisibility\(\)\)/,
		'a pane visibility change must re-evaluate the combined state',
	);
	// control 的最终状态必须同时考虑容器可见与 body 可见。
	assert.match(
		pane,
		/this\.sessionsControl\?\.setVisible\(newSessionsContainerVisible && this\.isBodyVisible\(\)\)/,
		'the control must follow the list result combined with the body',
	);
});

test('OPT-002: watch honours --out and --exclude-tests like one-shot transpile', () => {
	const index = source('build/next/index.ts');
	// watch 必须接收并使用与一次性 transpile 相同的两个参数。
	assert.match(index, /async function watch\(outDir: string, excludeTests: boolean\)/, 'watch must take the same parameters');
	assert.match(index, /await watch\(options\.out \?\? OUT_DIR, options\.excludeTests\)/, 'the CLI must pass both through');
	assert.doesNotMatch(index, /const outDir = OUT_DIR;/, 'watch must not pin the output directory');
	// 监听器必须用绝对路径与绝对 cwd：相对 glob 会按进程 cwd 解析。
	assert.match(index, /gulpWatch\(path\.join\(srcDir, '\*\*'\), \{ base: srcDir, cwd: srcDir \}\)/, 'the watcher must use absolute glob and cwd');
	assert.doesNotMatch(index, /gulpWatch\('src\/\*\*'/, 'a relative glob would follow the process cwd');
});

test('DOC-007: every verifier derives the repo root from its own location', () => {
	// 三个门禁脚本必须用同一套根目录约定：脚本位置，而不是 process.cwd()。
	for (const file of [
		'build/lib/dsh/verify/dshIdeCi.mjs',
		'build/lib/dsh/verify/dshInstallDrift.mjs',
		'build/lib/dsh/verify/dshArtifactContents.mjs',
	]) {
		const text = source(file);
		assert.match(text, /fileURLToPath\(import\.meta\.url\)/, `${file} must locate itself`);
		assert.match(text, /\.\.\/\.\.\/\.\.\/\.\./, `${file} must walk up to the repo root`);
		assert.doesNotMatch(text, /const repoRoot = process\.cwd\(\)/, `${file} must not trust the caller's cwd`);
	}
});

test('DOC-005: runtime and gate share one strict semver rule', async () => {
	const { parseVersion, compareVersion, installedMeetsVersion } = await import(new URL('out/vs/platform/dshClient/common/dshIdeContract.js', root).href) as {
		parseVersion(v: string): [number, number, number, string] | undefined;
		compareVersion(a: string, b: string): number | undefined;
		installedMeetsVersion(v: string): boolean;
	};
	// 合法：主版本、预发布、build metadata（§10 不参与比较但允许出现）。
	assert.deepEqual(parseVersion('0.2.2-rc.3'), [0, 2, 2, 'rc.3']);
	assert.deepEqual(parseVersion('0.2.2+build.7'), [0, 2, 2, '']);
	assert.deepEqual(parseVersion('0.2.2-rc.3+sha.abc'), [0, 2, 2, 'rc.3']);
	// 非法：不再补零猜值，一律 undefined。
	for (const bad of ['01.2.3', 'abc', '1.2', '1.2.3.4', '']) {
		assert.equal(parseVersion(bad), undefined, `${bad} must be rejected`);
	}
	// 预发布逐段按数值比较：rc.10 > rc.9。
	assert.equal(compareVersion('0.2.2-rc.10', '0.2.2-rc.9'), 1);
	// 非法版本不可比较，也不能被当成「满足」。
	assert.equal(compareVersion('abc', '0.2.2'), undefined);
	assert.equal(installedMeetsVersion('abc'), false);
	// 门禁脚本必须用同一套正则，否则两边口径会再次分叉。
	const gate = source('build/lib/dsh/verify/dshIdeVerify.mjs');
	assert.match(gate, /\(0\|\[1-9\]\\d\*\)\\\./, 'the gate must reject leading zeros like the runtime does');
	assert.match(gate, /\\\+\[0-9a-zA-Z-\]\+/, 'the gate must accept build metadata like the runtime does');
});

test('DOC-003: a gate step without STATUS is not a pass', () => {
	const ci = source('build/lib/dsh/verify/dshIdeCi.mjs');
	// 门禁类步骤必须打印 STATUS: PASS 才算通过；缺 STATUS 视为「没有结论」。
	assert.match(ci, /isGate \? \(code === 0 && status === 'PASS'\) : code === 0/, 'a gate must require an explicit PASS');
	const judge = (isGate: boolean, code: number, status: string | undefined) =>
		isGate ? (code === 0 && status === 'PASS') : code === 0;
	assert.equal(judge(true, 0, undefined), false, 'a gate with no STATUS must not pass');
	assert.equal(judge(true, 0, 'PENDING'), false, 'a PENDING gate must not pass');
	assert.equal(judge(true, 0, 'PASS'), true, 'an explicit PASS gate passes');
	assert.equal(judge(false, 0, undefined), true, 'a test step passes on exit code alone');
	assert.equal(judge(false, 1, undefined), false, 'a failing test step does not pass');
});

test('DOC-003: install-drift reports PENDING instead of PASS when it cannot compare', () => {
	const drift = source('build/lib/dsh/verify/dshInstallDrift.mjs');
	assert.doesNotMatch(drift, /STATUS: PASS  \[install-drift\] 未设置 DSH_PROFILE_DIR/, 'no profile is not a pass');
	assert.doesNotMatch(drift, /STATUS: PASS  \[install-drift\] profile 内未安装/, 'not installed is not a pass');
	assert.match(drift, /STATUS: PENDING  \[install-drift\] 未设置 DSH_PROFILE_DIR/, 'no profile must be PENDING');
	assert.match(drift, /STATUS: PENDING  \[install-drift\] profile 内未安装/, 'not installed must be PENDING');
	// 读不出内容的成员不能静默当成一致。
	assert.match(drift, /unverified\.push\(rel\)/, 'an unreadable member must be recorded');
	assert.match(drift, /if \(unverified\.length > 0\) \{/, 'unverified members must downgrade the verdict');
});

test('DOC-002: the public support claim matches the implemented platform gate', () => {
	const readme = source('README.md');
	const host = source('src/vs/platform/dshClient/host/electron-home.js');
	// 实现只支持 Windows 首次拉窗：声明必须与之一致。
	assert.match(host, /platform !== 'win32'/, 'the platform gate must exist');
	assert.match(host, /Windows-only/, 'the gate must say what it does');
	assert.match(readme, /支持平台：Windows x64/, 'the README must state the supported platform plainly');
	// 不能继续把 Linux 与 Windows 并列成「当前构建目标」而暗示可运行。
	assert.doesNotMatch(readme, /Windows x64 \/ Linux x64（当前构建目标）/, 'Linux must not be listed as a runnable target');
	assert.match(readme, /Linux x64 目前\*\*不是\*\*可运行平台/, 'the Linux limitation must be explicit');
});

test('DOC-002: dev header version and runtime ABI are documented as different things', () => {
	const readme = source('README.md');
	const agents = source('AGENTS.md');
	const npmrc = source('.npmrc');
	const devTarget = /^target="(.*)"$/m.exec(npmrc)?.[1];
	assert.ok(devTarget !== undefined, '.npmrc must pin a dev target');
	// 开发头文件版本出现在声明里，且明确不等于运行 ABI。
	assert.ok(readme.includes(devTarget), 'the dev header version must be stated');
	assert.match(readme, /运行宿主/, 'the runtime host must be named');
	assert.match(readme, /不等于/, 'a version difference must not be presented as an observed ABI crash');
	assert.match(agents, /不是\*\*运行 ABI/, 'AGENTS must distinguish the dev target from the runtime ABI');
});

test('DOC-006: historical provenance is corrected by errata, never rewritten', () => {
	const manual = source('docs/DSH-IDE改造开发手册.md');
	// 勘误必须写在现行手册里，并明确「不回写原文」的处置方式。
	assert.match(manual, /历史凭据勘误/, 'the manual must carry the errata section');
	assert.match(manual, /保留原文、不得删改/, 'the errata must state the originals are preserved');
	assert.match(manual, /不再有 sidecar 产物|没有\*\* sidecar 运行时产物/, 'the errata must state there is no sidecar runtime output');
	// 凭据原文必须仍保留旧表述（证明未被回写）。
	const libProvenance = source('build/lib/dsh/PROVENANCE.md');
	const chatRenderProvenance = source('build/dsh/chat-render/PROVENANCE.md');
	assert.match(libProvenance, /旁挂 sidecar esbuild 编译/, 'the preserved original must keep its wording');
	assert.match(chatRenderProvenance, /旁挂 sidecar esbuild 编译/, 'the preserved copy must keep its wording');
});

test('DOC-004: sync-upstream never writes to the reference repo', () => {
	const script = source('scripts/sync-upstream.mjs');
	// 默认不得假设本机有整仓副本（AGENTS §3 禁止保留）。
	assert.doesNotMatch(script, /source: 'E:\/deepseek-harness'/, 'the default source must not point at a local full clone');
	assert.match(script, /source: undefined/, 'the default must be "no local source"');
	// 不得对参考仓库加 remote 或 fetch。
	assert.doesNotMatch(script, /git\('remote', 'add'/, 'the script must not add a remote');
	assert.doesNotMatch(script, /git\('fetch'/, 'the script must not fetch into the reference repo');
	// --fetch 与 --source 互斥，且互斥先于路径判定。
	assert.match(script, /--fetch 与 --source 互斥/, 'the combination must be rejected explicitly');
	const mutual = script.indexOf('--fetch 与 --source 互斥');
	const pathCheck = script.indexOf("path.join(args.source, '.git')");
	assert.ok(mutual > 0 && mutual < pathCheck, 'mutual exclusion must be checked before the path');
	// 离线不猜结论。
	assert.match(script, /STATUS: PENDING  \[sync-upstream\] 无法读取远端 tag/, 'offline must report PENDING');
	// 远端比对走只读 API，不需要 clone。
	assert.match(script, /git', \['ls-remote'/, 'tag discovery must use ls-remote');
	assert.match(script, /api\.github\.com\/repos\/deepseek-ai\/deepseek-harness/, 'comparison must use the read-only API');
});

test('SEC-001: inline completion is registered as unavailable, not wired through a side channel', () => {
	const protocol = source('src/vs/platform/dshClient/common/dshIdeProtocol.ts');
	const contribution = source('src/vs/workbench/contrib/dsh/browser/dsh.contribution.ts');
	const readme = source('README.md');
	// 事实核验：`ide/inlineComplete` 确实不在唯一通道白名单里。
	assert.doesNotMatch(protocol, /'inlineComplete'/, 'the method must not be in the contract whitelist yet');
	// 因此不得注册 provider：注册也拿不到结果。
	assert.doesNotMatch(contribution, /this\._register\(registerDshInlineCompletions\(/, 'the provider must not be registered while unreachable');
	// 也不得为它另开旁路通道（唯一通道不变量）。
	assert.match(contribution, /行内补全\*\*不注册\*\*/, 'the reason must be recorded in place');
	// 公开声明必须与之一致。
	assert.match(readme, /行内补全 \| \*\*暂不可用\*\*/, 'the README must state it is unavailable');
});

test('SEC-003: Host dispatch shares the packaged protocol validator', () => {
	// 只审查装配和单一校验器的接线；不发送非法 DTO，不调用真实 Host。
	const host = source('src/vs/platform/dshClient/host/ide-view-host.js');
	const service = source('src/vs/platform/dshClient/host/ide-service.js');
	const staging = source('build/gulpfile.vscode.ts');
	const usesContract = [host, service].some(code =>
		/\bimport\s*\{[^}]*\bvalidateDshIdeInput\b[^}]*\}\s*from\s*'\.\.\/common\/dshIdeProtocol\.js'/.test(code)
		&& /\bvalidateDshIdeInput\s*\(/.test(code));
	assert.ok(usesContract, 'the Host entry path must actually call the shared validator');
	assert.match(staging, /'dshIdeProtocol\.js'/, 'the Host package must stage that same module');
});

test('SEC-005: every affected Markdown lock resolves the compatible patched line', () => {
	// 仅校验锁文件的版本；不运行公告中的输入。
	const locks = ['package-lock.json', 'build/package-lock.json', 'extensions/extension-editing/package-lock.json', 'extensions/markdown-language-features/package-lock.json'];
	const unsupported = [];
	for (const lock of locks) {
		const { packages }: { packages: Record<string, { version: string }> } = JSON.parse(source(lock));
		const matches = Object.entries(packages).filter(([entry]) => /(?:^|\/)node_modules\/markdown-it$/.test(entry));
		assert.ok(matches.length > 0, `${lock}: no resolved markdown-it entry`);
		for (const [entry, value] of matches) {
			if (!semver.satisfies(value.version, '>=14.3.3 <15.0.0')) {
				unsupported.push(`${lock} ${entry}@${value.version}`);
			}
		}
	}
	assert.deepEqual(unsupported, []);
});
