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
	dshScrollDeltaSource,
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

test('a layout-driven scroll must not flip following into reading', () => {
	// 官方「Scroll ownership」：Pinned scroll deliveries without reader movement update follow
	// ownership immediately，other reader movement remains pending——两者必须区分。
	// 判据是滚动容器自己的位移，不是「距底部的距离」：布局增长会让 atBottom 从 true 变 false，
	// 但 scrollTop 没变，那不是用户行为。
	// scrollTop 未变 = 布局推走；不能改归属，否则流式每帧都把用户锁进阅读态。
	assert.equal(dshScrollDeltaSource(100, 100), 'layout');
	// 亚像素抖动也不算用户移动（官方 subpixel rounding）。
	assert.equal(dshScrollDeltaSource(100, 100.4), 'layout');
	// 真的滚了，哪怕很小（官方：小滚动意图不能被布局增长抹掉）。
	assert.equal(dshScrollDeltaSource(100, 99), 'reader');
	assert.equal(dshScrollDeltaSource(100, 101), 'reader');
	assert.equal(dshScrollDeltaSource(100, 100.5), 'reader');
});

test('a capped group follows only its own bottom, independently of the transcript', async () => {
	// 官方「Group-title rules」末段：An open capped group follows content growth only while its own
	// scroll position is at the bottom；Scrolling away pauses that group's following; returning to the
	// bottom resumes it, independently of outer transcript following。
	const { dshGroupFollowAfterScroll, dshGroupShouldFollow, DSH_GROUP_FOLLOW_INITIAL } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshGroupScrollFollow.ts');
	assert.equal(DSH_GROUP_FOLLOW_INITIAL.mode, 'following', 'a fresh group follows');
	assert.equal(dshGroupShouldFollow(DSH_GROUP_FOLLOW_INITIAL), true);
	const paused = dshGroupFollowAfterScroll(DSH_GROUP_FOLLOW_INITIAL, false);
	assert.equal(paused.mode, 'paused', 'scrolling away pauses the group');
	assert.equal(dshGroupShouldFollow(paused), false, 'a paused group must not be scrolled');
	const resumed = dshGroupFollowAfterScroll(paused, true);
	assert.equal(resumed.mode, 'following', 'returning to the bottom resumes');
	// 状态迁移是幂等的：已在目标态时返回原对象（不制造无谓的重绘）。
	assert.equal(dshGroupFollowAfterScroll(DSH_GROUP_FOLLOW_INITIAL, true), DSH_GROUP_FOLLOW_INITIAL);
	assert.equal(dshGroupFollowAfterScroll(paused, false), paused);
});

test('manually opening a closed group starts at the top with following disabled', async () => {
	// 官方：Manually opening an unclosed group starts at the bottom and follows growth;
	// manually opening a closed group starts at the top with following disabled,
	// even when its initial content fits without scrolling。
	const { dshGroupFollowOnOpen } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshGroupScrollFollow.ts');
	assert.deepEqual(dshGroupFollowOnOpen(false), { mode: 'following' }, 'an unclosed group follows from the bottom');
	assert.deepEqual(dshGroupFollowOnOpen(true), { mode: 'paused' }, 'a closed group starts at the top, not following');
});
