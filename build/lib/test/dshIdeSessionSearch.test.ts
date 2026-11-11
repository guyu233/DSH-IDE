/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 第 22 轮：两套 backend 共用的会话检索结果中立投影（D59 分批检索）。
// 官方 `session/search` 返回 `{ items: {sessionId, snippet}[], hasMore }`。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectDshIdeSessionSearch } from '../../../src/vs/platform/dshClient/common/dshIdeSessionSearch.js';

test('projectDshIdeSessionSearch keeps only the neutral sessionId/snippet pair', () => {
	const value = {
		items: [
			{ sessionId: 's-1', snippet: 'hello world', internalScore: 0.9 },
			{ sessionId: 's-2', snippet: 'other' },
		],
		hasMore: true,
		internalCursor: 'cursor-1',
	};
	assert.deepEqual(projectDshIdeSessionSearch(value), {
		items: [{ sessionId: 's-1', snippet: 'hello world' }, { sessionId: 's-2', snippet: 'other' }],
		hasMore: true,
	});
});

test('projectDshIdeSessionSearch drops malformed items instead of inventing fields', () => {
	const value = {
		items: [
			{ sessionId: 's-1', snippet: 'ok' },
			{ sessionId: '', snippet: 'empty id' },
			{ sessionId: 's-3' },
			{ snippet: 'no id' },
			null,
			'not-an-object',
		],
		hasMore: false,
	};
	assert.deepEqual(projectDshIdeSessionSearch(value), { items: [{ sessionId: 's-1', snippet: 'ok' }], hasMore: false });
});

test('projectDshIdeSessionSearch is fail-closed for malformed payloads', () => {
	for (const value of [undefined, null, 'x', 42, [], {}, { items: 'nope' }, { items: [] }]) {
		assert.deepEqual(projectDshIdeSessionSearch(value), { items: [], hasMore: false }, `must be empty for ${JSON.stringify(value)}`);
	}
	// hasMore 只有严格 `true` 才算有下一批，其它值一律 false（不猜）。
	assert.equal(projectDshIdeSessionSearch({ items: [], hasMore: 'true' }).hasMore, false);
});
