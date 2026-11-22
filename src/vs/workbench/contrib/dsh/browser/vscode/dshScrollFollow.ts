/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


// 自动滚动归属（契约 §19.3 的 S5：自动滚动 hold 与运行态策略）。
//
// 问题：DSH 流式帧会让行的内容持续变化。原生 `ChatListWidget` 在「用户仍在底部」时
// 会跟随到底（`_withPersistedAutoScroll`），但用户一旦上滚阅读，任何高度变化都不应再把
// 视口拉回底部。原生已经提供了正确的机制——`acquireAutoScrollHold()` 引用计数的
// 「暂停自动滚动」，`_withPersistedAutoScroll` 与 `chatWidget` 的多处 follow 判断都会读
// `isAutoScrollHeld`；本文件只负责「什么时候持有它」。
//
// 判定是纯函数，DOM/事件接线在 `dshChatAutoScrollHold.ts`。分开的原因：契约要求
// 「用户上滚后流式高度变化不把视口拉回底部 / 新消息发送后可恢复一次跟随 / 点回到底部后
// 恢复自动跟随」三条都必须能单测，而它们本质上是同一个状态机的迁移。

/** 自动滚动归属：跟随最新内容，还是锁定在用户的阅读位置。 */
export type DshScrollFollowMode = 'following' | 'reading';

export interface DshScrollFollowState {
	readonly mode: DshScrollFollowMode;
}

export const DSH_SCROLL_FOLLOW_INITIAL: DshScrollFollowState = { mode: 'following' };

/**
 * 用户滚动后的归属。
 *
 * @param state 当前归属
 * @param atBottom 滚动后是否仍在底部
 * @returns 仍在底部 → 跟随；离开底部 → 阅读锁
 *
 * `atBottom` 是**滚动的直接结果**，不是「列表长高了顺带碰到」：原生
 * `isScrolledToBottom` 在内容增长时只会从 true 变 false，不会从 false 变 true。
 * 所以「回到底部 → 跟随」这条迁移既能接住用户手动上滚后滚回来，也能接住原生
 * 「回到底部」按钮（它先 `scrollToEnd()`，随后产生一次 atBottom 的滚动事件）——
 * 这正是契约 §19.3 S5 第三条「点回到底部后恢复自动跟随」要求的出口。
 * 若把阅读锁做成粘性，按钮就会失效（hold 永远不释放），因此这里不做粘性。
 */
export function dshScrollFollowAfterScroll(state: DshScrollFollowState, atBottom: boolean): DshScrollFollowState {
	if (atBottom) {
		return state.mode === 'following' ? state : { mode: 'following' };
	}
	return state.mode === 'reading' ? state : { mode: 'reading' };
}

/**
 * 用户显式要求回到底部（点击「回到底部」按钮，或原生 `restoreViewState({isAtBottom:true})`）。
 *
 * 这是阅读锁的唯一显式出口：恢复跟随并允许下一次高度变化把视口带到底部。
 */
export function dshScrollFollowToBottom(): DshScrollFollowState {
	return { mode: 'following' };
}

/**
 * 用户主动发送了一条消息。
 *
 * 发送是「我要看新回复」的明确意图，因此解除阅读锁、恢复一次跟随。
 * 注意这只是恢复跟随，不在这里滚动——真正滚到底部由原生 `scrollToEnd` 完成。
 */
export function dshScrollFollowAfterSend(): DshScrollFollowState {
	return { mode: 'following' };
}

/**
 * 当前归属是否应该让原生继续自动滚动。
 *
 * `reading` 时必须持有 hold：这样 `_withPersistedAutoScroll` 不会 `revealLastItem`，
 * `chatWidget` 的 `addRequest` 分支也不会把用户拉走。
 */
export function dshScrollFollowShouldHold(state: DshScrollFollowState): boolean {
	return state.mode === 'reading';
}

/**
 * 换算原生 view state 的 `isAtBottom`。
 *
 * 原生 `getViewState()` 返回 `{ scrollTop, isAtBottom }`；缺省 `isAtBottom` 视为「不在底部」，
 * 因为「读不到」不能当成「在底部」——那会在恢复视图时把用户的阅读位置重置到底部。
 */
export function dshScrollFollowFromViewState(state: { readonly isAtBottom?: boolean }): DshScrollFollowState {
	return state.isAtBottom === true ? { mode: 'following' } : { mode: 'reading' };
}
