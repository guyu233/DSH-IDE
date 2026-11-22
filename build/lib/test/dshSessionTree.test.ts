/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 子智能体会话树的单测：buildSessionTree / flattenTree / mapTreeItem / sameTreeItem。
// 只消费 summary 的 sessionId/parentSessionId/origin，item 工厂是纯函数，不带 DI。
//
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshSessionTree.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URI } from '../../../out/vs/base/common/uri.js';
import { ChatSessionStatus, type IChatSessionItem } from '../../../out/vs/workbench/contrib/chat/common/chatSessionsService.js';
import type { IDshIdeSessionSummary } from '../../../out/vs/platform/dshClient/protocol/dshIdeProtocol.js';
import { archiveIdsFromResult, buildSessionTree, dropSession, flattenTree, isCurrentRefresh, mapTreeItem, sameTreeItem, sessionReadState } from '../../../out/vs/workbench/contrib/dsh/browser/vscode/dshSessionTree.js';

function summary(sessionId: string, extra: Partial<IDshIdeSessionSummary> = {}): IDshIdeSessionSummary {
	return {
		sessionId,
		workspaceId: 'ws',
		updatedAt: 1,
		running: false,
		blank: false,
		agentAvailable: true,
		...extra,
	};
}

const toItem = (s: IDshIdeSessionSummary): IChatSessionItem => ({
	resource: URI.from({ scheme: 'dsh', path: `/${s.sessionId}` }),
	label: s.title ?? s.sessionId,
	status: ChatSessionStatus.Completed,
	timing: { created: s.updatedAt },
});

function ids(items: readonly IChatSessionItem[]): string[] {
	return items.map(item => item.resource.path.slice(1));
}

test('subagent child is attached under its parent as IChatSessionItem.children', () => {
	const roots = buildSessionTree(
		[summary('parent'), summary('child', { origin: 'subagent', parentSessionId: 'parent' })],
		toItem,
	);
	assert.deepEqual(ids(roots), ['parent']);
	assert.equal(roots[0].children?.length, 1);
	assert.equal(roots[0].children![0].resource.path.slice(1), 'child');
	// 不写 parentSession（VS Code 内部字段）
	assert.equal('parentSession' in roots[0].children![0], false);
});

test('ordinary fork with parentSessionId stays a root', () => {
	const roots = buildSessionTree(
		[summary('parent'), summary('fork', { parentSessionId: 'parent' })],
		toItem,
	);
	assert.deepEqual(ids(roots), ['parent', 'fork']);
	assert.equal(roots[0].children, undefined);
});

test('orphan subagent whose parent is absent degrades to root, not dropped', () => {
	const roots = buildSessionTree(
		[summary('child', { origin: 'subagent', parentSessionId: 'missing' })],
		toItem,
	);
	assert.deepEqual(ids(roots), ['child']);
});

test('cycles are guarded and no member is lost', () => {
	const roots = buildSessionTree(
		[
			summary('a', { origin: 'subagent', parentSessionId: 'b' }),
			summary('b', { origin: 'subagent', parentSessionId: 'a' }),
		],
		toItem,
	);
	// 环被 visited 截断，不再递归；两种合法结果都可接受：
	// ① 一个 root 带着环里的其它成员作 child；② 环成员各为 root。
	// 关键是全集覆盖、不丢、不死循环（对照官方 flattenLineage:74-95 的 fail-soft）。
	const all = flattenTree(roots);
	assert.equal(new Set(all.map(i => i.resource.path.slice(1))).size, 2);
	assert.deepEqual(new Set(all.map(i => i.resource.path.slice(1))), new Set(['a', 'b']));
});

test('three-level recursion nests children and keeps resources unique', () => {
	const roots = buildSessionTree(
		[
			summary('root'),
			summary('child', { origin: 'subagent', parentSessionId: 'root' }),
			summary('grand', { origin: 'subagent', parentSessionId: 'child' }),
		],
		toItem,
	);
	assert.deepEqual(ids(roots), ['root']);
	assert.equal(roots[0].children?.[0].children?.[0].resource.path.slice(1), 'grand');
	const all = flattenTree(roots);
	assert.equal(new Set(all.map(i => i.resource.toString())).size, 3);
});

test('input order is preserved and never re-sorted by updatedAt', () => {
	const roots = buildSessionTree(
		[summary('b', { updatedAt: 99 }), summary('a', { updatedAt: 1 })],
		toItem,
	);
	assert.deepEqual(ids(roots), ['b', 'a']);
});

test('duplicate sessionId keeps only the first', () => {
	const roots = buildSessionTree(
		[summary('a', { title: 'first' }), summary('a', { title: 'second' })],
		toItem,
	);
	assert.equal(roots.length, 1);
	assert.equal(roots[0].label, 'first');
});

test('mapTreeItem updates a nested child and keeps siblings stable', () => {
	const tree = buildSessionTree(
		[
			summary('parent'),
			summary('child', { origin: 'subagent', parentSessionId: 'parent' }),
			summary('other'),
		],
		toItem,
	);
	const parent = tree[0];
	const other = tree[1];
	const next = mapTreeItem(tree, URI.from({ scheme: 'dsh', path: '/child' }).toString(), item => ({ ...item, archived: true }));
	assert.notEqual(next, tree);
	assert.equal(next[1], other, 'unaffected root keeps identity');
	assert.equal((next[0].children as readonly IChatSessionItem[])[0].archived, true);
	assert.equal(parent.children![0].archived, undefined, 'original tree is not mutated');
});

test('mapTreeItem returns the original array when nothing changed (含子项的树)', () => {
	const tree = buildSessionTree(
		[
			summary('parent'),
			summary('child', { origin: 'subagent', parentSessionId: 'parent' }),
		],
		toItem,
	);
	// 命中但 update 返回原对象：不应产生新数组，否则调用方的 next === this._items 判等永远失效。
	const same = mapTreeItem(tree, URI.from({ scheme: 'dsh', path: '/child' }).toString(), item => item);
	assert.equal(same, tree, 'a no-op update must not rebuild the tree');
	// 完全不命中：同样应返回原数组。
	const untouched = mapTreeItem(tree, URI.from({ scheme: 'dsh', path: '/missing' }).toString(), item => ({ ...item }));
	assert.equal(untouched, tree, 'a miss must not rebuild the tree');
});

test('sameTreeItem detects child status changes', () => {
	const make = (status: ChatSessionStatus) => buildSessionTree(
		[summary('parent'), summary('child', { origin: 'subagent', parentSessionId: 'parent' })],
		s => s.sessionId === 'child'
			? { ...toItem(s), status }
			: toItem(s),
	);
	const a = make(ChatSessionStatus.Completed);
	const b = make(ChatSessionStatus.InProgress);
	assert.equal(sameTreeItem(a[0], b[0]), false);
	assert.equal(sameTreeItem(a[0], a[0]), true);
});

test('a newer refresh epoch retires the previous read', () => {
	assert.equal(isCurrentRefresh(1, 1), true);
	assert.equal(isCurrentRefresh(1, 2), false);
});

test('an archive result replaces the whole set and a bad payload does not wipe it', () => {
	const previous = new Set(['keep']);
	assert.deepEqual([...archiveIdsFromResult(['s', '', 1, 'other'], 's', true, previous)].sort(), ['other', 's']);
	assert.deepEqual([...archiveIdsFromResult({ archivedSessionIds: ['s'] }, 's', true, previous)], ['keep', 's']);
	assert.deepEqual([...archiveIdsFromResult(undefined, 'keep', false, previous)], []);
});

test('dropSession removes a row and promotes its children', () => {
	const tree = buildSessionTree(
		[summary('parent'), summary('child', { origin: 'subagent', parentSessionId: 'parent' })],
		toItem,
	);
	const parentKey = tree[0].resource.toString();
	const next = dropSession(tree, parentKey);
	assert.deepEqual(ids(next), ['child']);
	assert.equal(dropSession(tree, 'dsh:/missing'), tree);
});

test('a newer timestamp marks a known session unread and a first sighting stays unset', () => {
	assert.equal(sessionReadState(10, undefined), undefined);
	assert.equal(sessionReadState(10, { timing: { created: 10 }, isRead: true }), true);
	assert.equal(sessionReadState(11, { timing: { created: 10 }, isRead: true }), false);
	assert.equal(sessionReadState(9, { timing: { created: 10 }, isRead: false }), false);
});

test('the live-running map is pruned to the sessions that still exist', () => {
	// `liveRunning` 只增不清的话，删掉/归档的会话会一直留在内存里。
	// 每轮刷新按当前名单剪一次，长会话不会越积越多。
	const file = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshAgentSessionsController.ts', import.meta.url), 'utf8');
	assert.match(file, /const liveIds = new Set\(summaries\.map/, 'the current ids must be collected');
	assert.match(file, /if \(!liveIds\.has\(sessionId\)\) \{\s*\n\s*this\.liveRunning\.delete\(sessionId\);/, 'a gone session must be dropped');
});

test('multi-root workspaces list in parallel instead of stacking round trips', () => {
	// 每个工作区目录各要一次 listSessions。串行等的话，N 根工作区要叠加 N 次往返。
	const file = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshAgentSessionsController.ts', import.meta.url), 'utf8');
	assert.match(file, /await Promise\.all\(queries\.map/, 'the per-folder reads must run concurrently');
	assert.match(file, /const stale = \(\)/, 'the cancel/epoch check must be shared, not copy-pasted');
	// 并发之后多个目录可能同时发现视图没开：必须共用一个在途 openView。
	assert.match(file, /opening \?\?= this\.client\.openView/, 'the view must only be opened once');
});

test('concurrent refresh triggers share one listSessions round', () => {
	// 启动时会连着触发几次（构造、getStatus、连接状态变化），工作区切换也可能连发。
	// 不合并的话每次都是一整轮 listSessions，按工作区目录数还要再翻倍。
	const file = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshAgentSessionsController.ts', import.meta.url), 'utf8');
	assert.match(file, /private _refreshInFlight: Promise<void> \| undefined/);
	assert.match(file, /if \(this\._refreshInFlight !== undefined\) \{\s*\n\s*return;/, 'a second trigger must reuse the in-flight round');
	assert.match(file, /this\._refreshInFlight = undefined;/, 'the in-flight marker must be cleared when the round settles');
});

test('unarchive failure is not reported as an archive failure', () => {
	const file = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshAgentSessionsController.ts', import.meta.url), 'utf8');
	assert.match(file, /dsh\.sessions\.unarchiveFailed/);
	assert.match(file, /archived\s*\?\s*localize\('dsh\.sessions\.archiveFailed'/);
	assert.match(file, /dsh\.sessions\.refreshFailed/);
	assert.match(file, /flattenTree\(this\._items\)\.length === 0/);
});

test('a dropped connection is announced once and a reconnect clears it', () => {
	// 断线时输入框仍能打字，但发送一定失败；不提示用户会以为是自己按错了。
	// 连接层会反复重试，所以只在状态翻转时各提示一次。
	const file = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/dsh.contribution.ts', import.meta.url), 'utf8');
	assert.match(file, /dsh\.disconnected/);
	assert.match(file, /dsh\.reconnected/);
	assert.match(file, /if \(!sawDisconnect\) \{/, 'the warning must fire on the transition only');
	assert.match(file, /sawDisconnect = false;/, 'a successful reconnect must reset the flag');
});

test('the sessions controller stops writing after it is disposed', () => {
	// 控制器释放后，在途的 delete / archive 回包仍可能回来。
	// 没有防护的话会写 _items 并 fire 到已经释放的列表视图。
	const file = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshAgentSessionsController.ts', import.meta.url), 'utf8');
	assert.match(file, /private _disposed = false/, 'the controller must track disposal');
	assert.match(file, /override dispose\(\): void \{\s*\n\s*this\._disposed = true;/, 'dispose must set the flag');
	const deleteIdx = file.indexOf("await this.client.call('deleteSession'");
	assert.ok(deleteIdx > 0, 'the delete path must exist');
	assert.match(file.slice(deleteIdx, deleteIdx + 400), /if \(this\._disposed\) \{\s*\n\s*return;/, 'delete must bail out after dispose');
	const archiveIdx = file.indexOf("await this.client.call('archiveSession'");
	assert.ok(archiveIdx > 0, 'the archive path must exist');
	assert.match(file.slice(archiveIdx, archiveIdx + 700), /if \(this\._disposed\) \{\s*\n\s*return;/, 'archive must bail out after dispose');
});
