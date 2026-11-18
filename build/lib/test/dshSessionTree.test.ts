/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 子智能体会话树的单测：buildSessionTree / flattenTree / mapTreeItem / sameTreeItem。
// 只消费 summary 的 sessionId/parentSessionId/origin，item 工厂是纯函数，不带 DI。
//
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshSessionTree.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { URI } from '../../../out/vs/base/common/uri.js';
import { ChatSessionStatus, type IChatSessionItem } from '../../../out/vs/workbench/contrib/chat/common/chatSessionsService.js';
import type { IDshIdeSessionSummary } from '../../../out/vs/platform/dshClient/common/dshIdeProtocol.js';
import { archiveIdsFromResult, buildSessionTree, flattenTree, isCurrentRefresh, mapTreeItem, sameTreeItem, sessionReadState } from '../../../out/vs/workbench/contrib/dsh/browser/dshSessionTree.js';

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

test('a newer timestamp marks a known session unread and a first sighting stays unset', () => {
	assert.equal(sessionReadState(10, undefined), undefined);
	assert.equal(sessionReadState(10, { timing: { created: 10 }, isRead: true }), true);
	assert.equal(sessionReadState(11, { timing: { created: 10 }, isRead: true }), false);
	assert.equal(sessionReadState(9, { timing: { created: 10 }, isRead: false }), false);
});
