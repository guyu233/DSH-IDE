/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 第二阶段 2-C 的单测：Sessions 面板行的归档 / 已读状态纯变换。
//
// 控制器本身要 DI 容器，单测不实例化它；这里锁住纯函数语义（找不到行、值没变、批量多行），
// 控制器只负责把结果 fire 给原生列表。
//
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshSessionItemState.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { timingForRunning, withArchived, withRead } from '../../../out/vs/workbench/contrib/dsh/browser/dshSessionItemState.js';

function item(key: string, extra: Record<string, unknown> = {}) {
	return {
		resource: { toString: () => key },
		label: key,
		timing: { created: 1 },
		...extra,
	};
}

test('withArchived flips exactly one row and keeps the others', () => {
	const items = [item('a'), item('b')];
	const next = withArchived(items, 'b', true);
	assert.equal(next[0], items[0], 'untouched rows keep identity (no needless re-render)');
	assert.equal(next[1].archived, true);
});

test('withArchived returns the same array when the value already matches', () => {
	const items = [item('a', { archived: true })];
	assert.equal(withArchived(items, 'a', true), items);
});

test('withArchived returns the same array when the row is absent', () => {
	const items = [item('a')];
	assert.equal(withArchived(items, 'zzz', true), items);
});

test('withRead flips read state without pretending a Host write', () => {
	const items = [item('a', { isRead: false })];
	const next = withRead(items, 'a', true);
	assert.equal(next[0].isRead, true);
	assert.equal(withRead(next, 'a', true), next);
});

test('timingForRunning fills the two endpoints and never invents a start time', () => {
	const running = timingForRunning(10, true);
	assert.equal(running.created, 10);
	assert.equal(running.lastRequestStarted, 10);
	assert.equal(running.lastRequestEnded, undefined);
	const done = timingForRunning(10, false);
	assert.equal(done.lastRequestStarted, undefined);
	assert.equal(done.lastRequestEnded, 10);
});
