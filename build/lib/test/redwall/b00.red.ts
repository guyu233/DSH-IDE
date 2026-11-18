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
] = await Promise.all([
	loadBuilt<{ createDshIdeBackendFromEnv(env: Record<string, string>): DshIdeBackend }>('platform/dshClient/electron-main/dshIdeBackendFactory'),
	loadBuilt<{ DshIdeChannel: new (view: unknown) => TestChannel }>('platform/dshClient/electron-main/dshIdeChannel'),
	loadBuilt<{ DshIdeViewService: new (backend: DshIdeBackend) => unknown }>('platform/dshClient/electron-main/ide-view-service'),
	loadBuilt<{ DshChatModel: new () => TestChatModel }>('workbench/contrib/dsh/browser/dshChatModel'),
	loadBuilt<{ DshChatSession: new (client: TestClient) => TestChatSession }>('workbench/contrib/dsh/browser/dshChatSession'),
	loadBuilt<{ DshComposerSource: new (client: TestClient, log: { trace(): void; warn(): void }) => TestComposer }>('workbench/contrib/dsh/browser/dshComposerSource'),
	loadBuilt<{ DSH_IDE_MERGE_WINDOW_MS: number; DshIdeConsumer: new () => TestConsumer }>('workbench/contrib/dsh/browser/dshIdeConsumer'),
]);
const source = (file: string) => readFileSync(new URL(file, root), 'utf8');
const content = (text: string) => [{ type: 'text' as const, text }];
const userNode = (seq: number, text: string): DshIdeConversationNode => ({ kind: 'user', seq, time: seq, content: content(text) });

function readyFrame(version: number, view: DshIdeViewSnapshot): DshIdeSnapshot {
	return { wireRevision: DSH_IDE_WIRE_REVISION, channelId: 'local-view', version, binding: { viewId: 'local-view', generation: version, sessionId: null }, state: { state: 'ready', view } };
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
