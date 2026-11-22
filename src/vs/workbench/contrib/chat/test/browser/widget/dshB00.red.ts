/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { ResourceMap } from '../../../../../../base/common/map.js';
import { constObservable } from '../../../../../../base/common/observable.js';
import { URI } from '../../../../../../base/common/uri.js';
import { mockObject } from '../../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IDshClientService } from '../../../../../../platform/dshClient/common/dshClientService.js';
import { DSH_IDE_WIRE_REVISION, type DshIdeSnapshot } from '../../../../../../platform/dshClient/protocol/dshIdeProtocol.js';
import { NullLogService } from '../../../../../../platform/log/common/log.js';
import { DshChatSession } from '../../../../dsh/browser/vscode/dshChatSession.js';
import { DshChatSessionContent } from '../../../../dsh/browser/vscode/dshChatSessionContent.js';
import { type IChatAcceptInputOptions } from '../../../browser/chat.js';
import { ChatSessionsService } from '../../../browser/chatSessions/chatSessions.contribution.js';
import { ChatWidget } from '../../../browser/widget/chatWidget.js';
import { ChatRequestVariableSet } from '../../../common/attachments/chatVariableEntries.js';
import { type IChatSession } from '../../../common/chatSessionsService.js';
import { ChatModeKind } from '../../../common/constants.js';

// 本组只由 B00 显式执行，不加入常规测试入口。
function ready(text: string): DshIdeSnapshot {
	return {
		wireRevision: DSH_IDE_WIRE_REVISION,
		channelId: 'native-fixture',
		version: 1,
		binding: { viewId: 'native-fixture', generation: 1, sessionId: null },
		state: { state: 'ready', view: {
			frame: { type: 'snapshot' },
			conversation: { hasMore: false, nodes: [{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text }] }] },
		} },
	};
}

function prompts(content: IChatSession): string[] {
	return content.history.flatMap(item => item.type === 'request' ? [item.prompt] : []);
}

function receiveSubmission(sessionResource: URI, result: boolean, options: { readonly contentFailure?: boolean; readonly images?: readonly { readonly kind: string; readonly _meta?: Record<string, unknown> }[] } = {}) {
	let inputAccepted = 0;
	let requestAccepted = 0;
	const contentFailure = options.contentFailure === true;
	const sent: string[] = [];
	const sentAttachments: (readonly unknown[])[] = [];
	const notices: string[] = [];
	const normal: string[] = [];
	const attachments = new ChatRequestVariableSet();
	for (const entry of options.images ?? []) {
		attachments.add(entry as never);
	}
	const model = {
		hasActiveRequest: constObservable(false),
		requestNeedsInput: constObservable(false),
		requestInProgress: constObservable(false),
	};
	const widget = Object.create(ChatWidget.prototype) as { _acceptInput(query: { query: string }, options: IChatAcceptInputOptions): Promise<unknown> };
	Object.defineProperties(widget, {
		_viewModel: { value: { model, sessionResource } },
		isTranscriptProgressActive: { value: false },
		isLockedToCodingAgent: { value: false },
		input: { value: {
			currentModeKind: ChatModeKind.Ask,
			isManagedSettingsRefreshBlocked: false,
			getAttachedContext: () => attachments,
			getAttachedAndImplicitContext: () => attachments,
			validateAgentMode: () => { },
			acceptInput: () => { inputAccepted++; },
		} },
		_onDidAcceptInput: { value: { fire() { } } },
		listWidget: { value: { setScrollLock() { } } },
		viewOptions: { value: {} },
		configurationService: { value: { getValue: () => false } },
		_location: { value: {} },
		getSelectedModelRequestOptions: { value: () => ({}) },
		getModeRequestOptions: { value: () => ({}) },
		_getInstructionRouting: { value: () => ({}) },
		_applyPromptFileIfSet: { value: async () => true },
		_resolveDirectoryImageAttachments: { value: async () => [] },
		confirmPendingRequestsBeforeSend: { value: async () => true },
		logThinkingStyleUsage: { value: () => { } },
		updateChatViewVisibility: { value: () => { } },
		_maybeStartGoalSummary: { value: () => { } },
		notificationService: { value: { error: (message: string) => notices.push(`error:${message}`), warn: (message: string) => notices.push(`warn:${message}`), info: () => { } } },
		logService: { value: { warn: () => { }, trace: () => { }, info: () => { } } },
		chatSessionsService: { value: {
			getContentProviderSchemes: () => ['dsh'],
			getOrCreateChatSession: async (actualResource: URI) => {
				assert.strictEqual(actualResource, sessionResource);
				if (contentFailure) {
					throw new Error('content unavailable');
				}
				return { submit: async (text: string, attachments?: readonly unknown[]) => { sent.push(text); sentAttachments.push(attachments ?? []); return result; } };
			},
		} },
		chatService: { value: { sendRequest: async (_resource: URI, text: string) => { normal.push(text); return { kind: 'rejected' }; } } },
	});
	return {
		submit: () => widget._acceptInput({ query: 'Fixture prompt' }, { preserveInput: false, onRequestAccepted: () => { requestAccepted++; } }),
		state: () => ({ inputAccepted, requestAccepted, sent, normal, sentAttachments, notices }),
	};
}

suite('DSH B00 redwall', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	async function openTwoCachedResources() {
		const client = mockObject<IDshClientService>()({ _serviceBrand: undefined });
		client.rebindView.callsFake(async id => ({ ok: true, value: ready(`History for ${id}`) }));
		client.call.resolves({ ok: false, error: { code: 'fixture/unavailable', message: 'No extras for this fixture' } });
		client.call.withArgs('submit').resolves({ ok: true, value: { accepted: true } });
		client.call.withArgs('interrupt').resolves({ ok: true, value: { accepted: true } });
		const session = store.add(new DshChatSession(client));
		const a = URI.parse('dsh:/A');
		const b = URI.parse('dsh:/B');
		assert.strictEqual(await session.bind('A'), true);
		const first = store.add(new DshChatSessionContent(a, session));
		assert.deepStrictEqual(prompts(first), ['History for A']);
		assert.strictEqual(await session.bind('B'), true);
		const second = store.add(new DshChatSessionContent(b, session));
		const cache = new ResourceMap<{ session: IChatSession }>();
		cache.set(a, { session: first });
		cache.set(b, { session: second });
		const native = Object.assign(Object.create(ChatSessionsService.prototype), {
			_sessions: cache,
			_pendingSessionResolutions: new Map(),
			_logService: new NullLogService(),
		}) as ChatSessionsService;
		return { client, session, native, a, first, second };
	}

	test('BUG-009: a cached resource retains its own history after another resource binds', async () => {
		const { native, a, first, second } = await openTwoCachedResources();
		const cachedA = await native.getOrCreateChatSession(a, CancellationToken.None);
		assert.strictEqual(cachedA, first, 'A must take the actual native cache-hit path');
		assert.deepStrictEqual(prompts(second), ['History for B']);
		assert.deepStrictEqual(prompts(cachedA), ['History for A']);
	});

	for (const method of ['submit', 'interrupt'] as const) {
		test(`BUG-009: a stale cached resource cannot send ${method} to another resource`, async () => {
			const { client, session, native, a, first, second } = await openTwoCachedResources();
			const perform = (content: DshChatSessionContent) => method === 'submit'
				? content.submit('Fixture prompt')
				: content.interruptActiveResponseCallback();
			const targets = () => client.call.getCalls().filter(call => call.args[0] === method).map(call => call.args[1]?.sessionId);
			session.acceptSessionStatus('B', true);
			assert.strictEqual(await perform(second), true, 'the active resource must still accept the ordinary action');
			assert.deepStrictEqual(targets(), ['B']);
			session.acceptSessionStatus('B', true);
			assert.strictEqual(await native.getOrCreateChatSession(a, CancellationToken.None), first);
			const result = await perform(first);
			assert.deepStrictEqual({ result, targets: targets() }, { result: false, targets: ['B'] });
		});
	}

	test('BUG-011: provider acceptance consumes the native draft once', async () => {
		const fixture = receiveSubmission(URI.parse('dsh:/A'), true);
		await fixture.submit();
		const state = fixture.state();
		assert.deepStrictEqual(
			{ inputAccepted: state.inputAccepted, requestAccepted: state.requestAccepted, sent: state.sent, normal: state.normal, notices: state.notices },
			{ inputAccepted: 1, requestAccepted: 1, sent: ['Fixture prompt'], normal: [], notices: [] },
		);
	});

	test('BUG-011: an unavailable DSH content object never falls through to the native path', async () => {
		const fixture = receiveSubmission(URI.parse('dsh:/A'), true, { contentFailure: true });
		await fixture.submit();
		const state = fixture.state();
		// 关键点：normal 必须为空。改走原生链路等于把这次发送交给另一个内核。
		assert.deepStrictEqual(
			{ sent: state.sent, normal: state.normal, inputAccepted: state.inputAccepted, requestAccepted: state.requestAccepted },
			{ sent: [], normal: [], inputAccepted: 0, requestAccepted: 0 },
			'an unavailable provider must keep the draft and report, not reroute',
		);
		assert.strictEqual(state.notices.length, 1, 'the user must be told the send did not happen');
	});

	test('BUG-011: an image without an ingested reference is not sent with a forged id', async () => {
		const fixture = receiveSubmission(URI.parse('dsh:/A'), true, { images: [{ kind: 'image' }] });
		await fixture.submit();
		const state = fixture.state();
		assert.deepStrictEqual(
			{ sent: state.sent, inputAccepted: state.inputAccepted, requestAccepted: state.requestAccepted },
			{ sent: [], inputAccepted: 0, requestAccepted: 0 },
			'an image without bytes must block the send, not be silently dropped',
		);
		assert.strictEqual(state.notices.length, 1, 'the refusal must be visible to the user');
	});

	test('BUG-011: an ingested image reference is forwarded on the DSH contract', async () => {
		const ref = { attachmentId: 'att-1', mediaType: 'image/png', bytes: 9, width: 3, height: 2, name: 'a.png' };
		const fixture = receiveSubmission(URI.parse('dsh:/A'), true, { images: [{ kind: 'image', _meta: { dshImageAttachment: ref } }] });
		await fixture.submit();
		const state = fixture.state();
		assert.deepStrictEqual(state.sentAttachments, [[ref]], 'the ingested reference must reach the provider unchanged');
		assert.deepStrictEqual(
			{ inputAccepted: state.inputAccepted, requestAccepted: state.requestAccepted },
			{ inputAccepted: 1, requestAccepted: 1 },
			'an accepted DSH send completes the native draft exactly once',
		);
	});

	test('BUG-011 control: a rejected provider submission leaves the native draft intact', async () => {
		const fixture = receiveSubmission(URI.parse('dsh:/A'), false);
		await fixture.submit();
		const rejected = fixture.state();
		assert.deepStrictEqual(
			{ inputAccepted: rejected.inputAccepted, requestAccepted: rejected.requestAccepted, sent: rejected.sent, normal: rejected.normal, notices: rejected.notices },
			{ inputAccepted: 0, requestAccepted: 0, sent: ['Fixture prompt'], normal: [], notices: [] },
		);
	});

	test('BUG-011 control: the regular chat path still calls its own service', async () => {
		const fixture = receiveSubmission(URI.parse('agent-host-copilot:/A'), false);
		await fixture.submit();
		const regular = fixture.state();
		assert.deepStrictEqual(
			{ inputAccepted: regular.inputAccepted, requestAccepted: regular.requestAccepted, sent: regular.sent, normal: regular.normal, notices: regular.notices },
			// 原生链路返回 rejected：没有接受，因此不得计一次输入完成。
			{ inputAccepted: 0, requestAccepted: 0, sent: [], normal: ['Fixture prompt'], notices: [] },
		);
	});
});
