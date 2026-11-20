/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 第 22 轮：两套 backend 共用的会话检索结果中立投影（D59 分批检索）。
// 官方 `session/search` 返回 `{ items: {sessionId, snippet}[], hasMore }`。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('the IDE service forwards hasMore instead of dropping it', () => {
	// 官方单批上限 20 条。服务层若把 hasMore 丢掉，用户搜到 20 条会以为那就是全部。
	const source = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/dshIdeSessionsService.ts', import.meta.url), 'utf8');
	assert.match(source, /readonly hasMore: boolean/, 'the service result must carry hasMore');
	assert.match(source, /hasMore: result\.value\?\.hasMore === true/, 'hasMore must come from the host reply');
	// 命令入口必须在有下一批时说明，否则用户不知道结果被截断。
	const commands = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/dshSessionSearchCommands.ts', import.meta.url), 'utf8');
	assert.match(commands, /dsh\.searchSessions\.truncated/, 'the command must say the list is truncated');
	assert.match(commands, /if \(result\.hasMore\)/, 'the notice must be conditional on hasMore');
});

test('write paths do not re-read the list after the host already fanned it out', () => {
	// Host 的 newSession / archiveSession / unarchiveSession / setSessionFavorite /
	// setSessionPinned 都会 fanout `session-list`，列表控制器收到后自己重查。
	// 服务层再 await refresh() 等于每次写操作多打一轮 listSessions。
	const source = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/dshIdeSessionsService.ts', import.meta.url), 'utf8');
	for (const method of ['createSession', 'archiveSession', 'unarchiveSession']) {
		const start = source.indexOf(`async ${method}(`);
		assert.ok(start >= 0, `${method} must exist`);
		const next = source.indexOf('\n\tasync ', start + 10);
		const body = source.slice(start, next < 0 ? source.length : next);
		assert.ok(!/await this\.refresh\(\)/.test(body), `${method} must not re-read the list itself`);
	}
});

test('a session matched twice appears once', () => {
	// 同一会话可能因多处命中被官方返回两次（不同 snippet）。选择器里会出现
	// 两行同 id 的条目，选中后打开的是同一个会话。
	const projected = projectDshIdeSessionSearch({
		items: [
			{ sessionId: 's-1', snippet: '第一处命中' },
			{ sessionId: 's-1', snippet: '第二处命中' },
			{ sessionId: 's-2', snippet: '另一条' },
		],
		hasMore: false,
	});
	assert.deepEqual(projected.items.map(item => item.sessionId), ['s-1', 's-2']);
	assert.equal(projected.items[0].snippet, '第一处命中');
});
