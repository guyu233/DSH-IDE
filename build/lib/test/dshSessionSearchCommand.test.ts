/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// `dsh.searchSessions` 的纯逻辑单测：空关键字不触发搜索、失败有提示、命中才列 quick pick。
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshSessionSearchCommand.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

type Outcome = 'skipped' | 'failed' | 'empty' | 'picked' | 'cancelled';

/**
 * 复刻 `registerDshSessionSearchCommands` 的判定顺序（见 dshSessionSearchCommands.ts），
 * 用简化输入验证每个分支都不会把「没搜到」误当成「搜索全部」。
 */
async function runSearch(options: {
	readonly query: string | undefined;
	readonly search: (query: string) => Promise<{ ok: true; items: readonly { sessionId: string; snippet: string }[] } | { ok: false; error: string }>;
	readonly pick?: (items: readonly { sessionId: string }[]) => Promise<string | undefined>;
}): Promise<Outcome> {
	const query = options.query;
	if (query === undefined || query.trim() === '') {
		return 'skipped';
	}
	const result = await options.search(query.trim());
	if (!result.ok) {
		return 'failed';
	}
	if (result.items.length === 0) {
		return 'empty';
	}
	const picked = options.pick === undefined ? undefined : await options.pick(result.items);
	return picked === undefined ? 'cancelled' : 'picked';
}

test('a blank query never calls the search endpoint', async () => {
	let called = false;
	const outcome = await runSearch({
		query: '   ',
		search: async () => { called = true; return { ok: true, items: [] }; },
	});
	assert.equal(outcome, 'skipped');
	assert.equal(called, false);
});

test('a failed search surfaces instead of showing an empty list', async () => {
	const outcome = await runSearch({
		query: '泄漏',
		search: async () => ({ ok: false, error: 'unavailable' }),
	});
	assert.equal(outcome, 'failed');
});

test('no matches reports empty rather than opening a blank picker', async () => {
	const outcome = await runSearch({
		query: '不存在',
		search: async () => ({ ok: true, items: [] }),
	});
	assert.equal(outcome, 'empty');
});

test('matching sessions are offered and a pick is returned', async () => {
	let offered: readonly { sessionId: string }[] = [];
	const outcome = await runSearch({
		query: '连接池',
		search: async () => ({ ok: true, items: [{ sessionId: 's-1', snippet: '修好连接池' }] }),
		pick: async items => { offered = items; return items[0]?.sessionId; },
	});
	assert.equal(outcome, 'picked');
	assert.deepEqual(offered, [{ sessionId: 's-1', snippet: '修好连接池' }]);
});

test('cancelling the picker leaves the session untouched', async () => {
	const outcome = await runSearch({
		query: '连接池',
		search: async () => ({ ok: true, items: [{ sessionId: 's-1', snippet: 'x' }] }),
		pick: async () => undefined,
	});
	assert.equal(outcome, 'cancelled');
});
