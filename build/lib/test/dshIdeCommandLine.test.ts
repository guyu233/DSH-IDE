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

test('a handler error keeps its message whichever field name the host uses', () => {
	// 官方 CommandResult 的错误文案字段名在不同版本里可能是 `text` 或 `message`。
	// 只读一个会在另一个形态下丢掉真实原因，用户只看到通用兜底文案。
	const fromText = mapDshIdeCommandExecution({ result: { kind: 'error', text: '来自 text' } });
	assert.deepEqual(fromText, { error: 'feature-unavailable', message: '来自 text' });
	const fromMessage = mapDshIdeCommandExecution({ result: { kind: 'error', message: '来自 message' } });
	assert.deepEqual(fromMessage, { error: 'feature-unavailable', message: '来自 message' });
	// 两个都空时才有兜底文案。
	const neither = mapDshIdeCommandExecution({ result: { kind: 'error' } });
	assert.deepEqual(neither, { error: 'feature-unavailable', message: 'command handler reported an error' });
	// text 为空串时回退到 message。
	const fallback = mapDshIdeCommandExecution({ result: { kind: 'error', text: '', message: '回退' } });
	assert.deepEqual(fallback, { error: 'feature-unavailable', message: '回退' });
});
