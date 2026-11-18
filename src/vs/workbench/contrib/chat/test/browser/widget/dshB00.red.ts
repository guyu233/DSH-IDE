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
import { DSH_IDE_WIRE_REVISION, type DshIdeSnapshot } from '../../../../../../platform/dshClient/common/dshIdeProtocol.js';
import { NullLogService } from '../../../../../../platform/log/common/log.js';
import { DshChatSession } from '../../../../dsh/browser/dshChatSession.js';
import { DshChatSessionContent } from '../../../../dsh/browser/dshChatSessionContent.js';
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
		state: { state: 'ready', view: {
			frame: { type: 'snapshot' },
			conversation: { hasMore: false, nodes: [{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text }] }] },
		} },
	};
}

function prompts(content: IChatSession): string[] {
	return content.history.flatMap(item => item.type === 'request' ? [item.prompt] : []);
}

function receiveSubmission(sessionResource: URI, result: boolean) {
	let inputAccepted = 0;
	let requestAccepted = 0;
	const sent: string[] = [];
	const normal: string[] = [];
	const attachments = new ChatRequestVariableSet();
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
		chatSessionsService: { value: {
			getContentProviderSchemes: () => ['dsh'],
			getOrCreateChatSession: async (actualResource: URI) => {
				assert.strictEqual(actualResource, sessionResource);
				return { submit: async (text: string) => { sent.push(text); return result; } };
			},
		} },
		chatService: { value: { sendRequest: async (_resource: URI, text: string) => { normal.push(text); return { kind: 'rejected' }; } } },
	});
	return {
		submit: () => widget._acceptInput({ query: 'Fixture prompt' }, { preserveInput: false, onRequestAccepted: () => { requestAccepted++; } }),
		state: () => ({ inputAccepted, requestAccepted, sent, normal }),
	};
}

suite('DSH B00 redwall', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('BUG-009: a cached resource retains its own history after another resource binds', async () => {
		const client = mockObject<IDshClientService>()({ _serviceBrand: undefined });
		client.rebindView.callsFake(async id => ({ ok: true, value: ready(`History for ${id}`) }));
		client.call.resolves({ ok: false, error: { code: 'fixture/unavailable', message: 'No extras for this fixture' } });
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
		const cachedA = await native.getOrCreateChatSession(a, CancellationToken.None);
		assert.strictEqual(cachedA, first, 'A must take the actual native cache-hit path');
		assert.deepStrictEqual(prompts(second), ['History for B']);
		assert.deepStrictEqual(prompts(cachedA), ['History for A']);
	});

	test('BUG-011: provider acceptance consumes the native draft once', async () => {
		const fixture = receiveSubmission(URI.parse('dsh:/A'), true);
		await fixture.submit();
		assert.deepStrictEqual(fixture.state(), { inputAccepted: 1, requestAccepted: 1, sent: ['Fixture prompt'], normal: [] });
	});

	test('BUG-011 control: a rejected provider submission leaves the native draft intact', async () => {
		const fixture = receiveSubmission(URI.parse('dsh:/A'), false);
		await fixture.submit();
		assert.deepStrictEqual(fixture.state(), { inputAccepted: 0, requestAccepted: 0, sent: ['Fixture prompt'], normal: [] });
	});

	test('BUG-011 control: the regular chat path still calls its own service', async () => {
		const fixture = receiveSubmission(URI.parse('agent-host-copilot:/A'), false);
		await fixture.submit();
		assert.deepStrictEqual(fixture.state(), { inputAccepted: 0, requestAccepted: 0, sent: [], normal: ['Fixture prompt'] });
	});
});
