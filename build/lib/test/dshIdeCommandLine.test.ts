/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 第 34 轮：两套 backend 共用的斜杠命令 line 构造与结果判定（§8.10.10 契约决定）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDshIdeCommandLine, mapDshIdeCommandExecution } from '../../../src/vs/platform/dshClient/common/dshIdeCommandLine.js';

test('buildDshIdeCommandLine builds a slash line from bare command name + args', () => {
	assert.equal(buildDshIdeCommandLine('plan', undefined), '/plan');
	assert.equal(buildDshIdeCommandLine('plan', []), '/plan');
	assert.equal(buildDshIdeCommandLine('plan', ['a', 'b-c']), '/plan a b-c');
	assert.equal(buildDshIdeCommandLine('permission', ['workspace-write']), '/permission workspace-write');
});

test('mapDshIdeCommandExecution maps success to accepted and failures to error codes', () => {
	assert.deepEqual(mapDshIdeCommandExecution({ commandId: 'c1', result: { kind: 'success' } }), { accepted: true });
	assert.deepEqual(mapDshIdeCommandExecution({ commandId: 'c1', result: { kind: 'success', text: 'ok' } }), { accepted: true });
	assert.deepEqual(
		mapDshIdeCommandExecution({ commandId: 'c1', result: { kind: 'error', text: 'unknown preset "x"' } }),
		{ error: 'feature-unavailable', message: 'unknown preset "x"' },
	);
	assert.deepEqual(
		mapDshIdeCommandExecution({ commandId: 'c1', result: { kind: 'error' } }),
		{ error: 'feature-unavailable', message: 'command handler reported an error' },
	);
});

test('mapDshIdeCommandExecution is fail-closed for missing/malformed executions', () => {
	assert.deepEqual(
		mapDshIdeCommandExecution(undefined),
		{ error: 'invalid-argument', message: 'command was not admitted (unknown or malformed)' },
	);
	assert.deepEqual(
		mapDshIdeCommandExecution(null),
		{ error: 'invalid-argument', message: 'command was not admitted (unknown or malformed)' },
	);
	assert.deepEqual(
		mapDshIdeCommandExecution('not-an-object'),
		{ error: 'invalid-argument', message: 'command was not admitted (unknown or malformed)' },
	);
	assert.deepEqual(
		mapDshIdeCommandExecution({ commandId: 'c1' }),
		{ error: 'feature-unavailable', message: 'command execution returned no result' },
	);
});
