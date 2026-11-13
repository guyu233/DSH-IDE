/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// waterfall 中立投影与契约校验。不依赖 out/ 转译产物。
// 运行：node --experimental-strip-types --test build/lib/test/dshIdeWaterfallNotice.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectDshIdeWaterfallNotice } from '../../../src/vs/platform/dshClient/common/dshIdeWaterfallNotice.ts';
import { validateDshIdeWaterfallNotice } from '../../../src/vs/platform/dshClient/common/dshIdeProtocol.ts';

test('approval waterfall drops official objects and keeps the neutral view', () => {
	const notice = projectDshIdeWaterfallNotice({
		type: 'waterfall',
		kind: 'request',
		eventId: 'e1',
		event: 'approval/request',
		agentId: 'agent-1',
		request: { toolName: 'shell', reason: 'run', callId: 'c1', agent: { id: 'secret' }, signal: {} },
	});
	assert.deepEqual(notice, {
		kind: 'request',
		eventId: 'e1',
		event: 'approval/request',
		agentId: 'agent-1',
		request: { toolName: 'shell', callId: 'c1', reason: 'run' },
	});
	assert.deepEqual(validateDshIdeWaterfallNotice(notice), notice);
});

test('question waterfall keeps labels and drops unknown events', () => {
	const notice = projectDshIdeWaterfallNotice({
		type: 'waterfall',
		kind: 'request',
		eventId: 'q1',
		event: 'user-questions/request',
		agentId: 'agent-1',
		request: {
			questions: [{ id: 'q', question: 'Pick', options: [{ label: 'Yes', description: 'nope' }, { label: '' }], multiSelect: false }],
			agent: { id: 'secret' },
		},
	});
	assert.deepEqual(notice, {
		kind: 'request',
		eventId: 'q1',
		event: 'user-questions/request',
		agentId: 'agent-1',
		request: { questions: [{ id: 'q', question: 'Pick', options: [{ label: 'Yes' }] }] },
	});
	assert.deepEqual(validateDshIdeWaterfallNotice(notice), notice);
	assert.equal(projectDshIdeWaterfallNotice({ type: 'waterfall', eventId: 'e', event: 'other/request', agentId: 'a', request: {} }), undefined);
	assert.equal(projectDshIdeWaterfallNotice({ type: 'ready', clientId: 'c' }), undefined);
});

test('cancel is a separate notice and the validator rejects a leaked request', () => {
	const notice = projectDshIdeWaterfallNotice({ type: 'waterfall', kind: 'cancel', eventId: 'e1' });
	assert.deepEqual(notice, { kind: 'cancel', eventId: 'e1' });
	assert.deepEqual(validateDshIdeWaterfallNotice(notice), notice);
	assert.throws(() => validateDshIdeWaterfallNotice({ kind: 'cancel', eventId: 'e1', event: 'approval/request' }), /must omit event/);
	assert.equal(projectDshIdeWaterfallNotice({ type: 'cancel', eventId: '' }), undefined);
	assert.equal(projectDshIdeWaterfallNotice({ type: 'waterfall', eventId: 'e', event: 'approval/request', agentId: 'a', request: { toolName: '' } }), undefined);
});
