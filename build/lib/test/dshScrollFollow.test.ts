/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


// 自动滚动 hold 的单测（契约 §19.3 S5 的三条验收）。
// 运行：node --experimental-strip-types --test build/lib/test/dshScrollFollow.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	DSH_SCROLL_FOLLOW_INITIAL,
	dshScrollFollowAfterScroll,
	dshScrollFollowAfterSend,
	dshScrollFollowFromViewState,
	dshScrollFollowShouldHold,
	dshScrollFollowToBottom,
} from '../../../src/vs/workbench/contrib/dsh/browser/vscode/dshScrollFollow.ts';

test('scrolling up enters the reading lock and holds native auto-scroll', () => {
	// 验收 1：用户上滚后，流式高度变化不把视口拉回底部。
	const reading = dshScrollFollowAfterScroll(DSH_SCROLL_FOLLOW_INITIAL, false);
	assert.equal(reading.mode, 'reading');
	assert.equal(dshScrollFollowShouldHold(reading), true, 'the reading lock must hold native auto-scroll');
	// 用户手动滚回底部（或点原生「回到底部」按钮产生一次 atBottom 滚动事件）必须解除阅读锁，
	// 否则 hold 永不释放、自动跟随永久失效——契约 §19.3 S5 第三条明确要求这个出口。
	assert.equal(dshScrollFollowAfterScroll(reading, true).mode, 'following');
	// 仍然不在底部时阅读锁保持不变。
	assert.equal(dshScrollFollowAfterScroll(reading, false).mode, 'reading');
});

test('staying at the bottom keeps following without acquiring a hold', () => {
	const following = dshScrollFollowAfterScroll(DSH_SCROLL_FOLLOW_INITIAL, true);
	assert.equal(following.mode, 'following');
	assert.equal(dshScrollFollowShouldHold(following), false, 'following must not block native auto-scroll');
});

test('sending a message restores one follow', () => {
	// 验收 2：新用户消息发送后可恢复一次跟随。
	const reading = dshScrollFollowAfterScroll(DSH_SCROLL_FOLLOW_INITIAL, false);
	const afterSend = dshScrollFollowAfterSend();
	assert.equal(afterSend.mode, 'following');
	assert.equal(dshScrollFollowShouldHold(afterSend), false);
	assert.equal(reading.mode, 'reading', 'the previous state must not be mutated');
});

test('explicitly going back to the bottom releases the reading lock', () => {
	// 验收 3：点「回到底部」后恢复自动跟随。
	const reading = dshScrollFollowAfterScroll(DSH_SCROLL_FOLLOW_INITIAL, false);
	const bottom = dshScrollFollowToBottom();
	assert.equal(bottom.mode, 'following');
	assert.equal(dshScrollFollowShouldHold(reading), true);
	assert.equal(dshScrollFollowShouldHold(bottom), false);
});

test('a restored view state only follows when it explicitly says it is at the bottom', () => {
	// `isAtBottom` 缺省必须当成「不在底部」：读不到不能当成在底部，否则会重置阅读位置。
	assert.equal(dshScrollFollowFromViewState({ scrollTop: 10, isAtBottom: true }).mode, 'following');
	assert.equal(dshScrollFollowFromViewState({ scrollTop: 10, isAtBottom: false }).mode, 'reading');
	assert.equal(dshScrollFollowFromViewState({ scrollTop: 10 }).mode, 'reading');
});
