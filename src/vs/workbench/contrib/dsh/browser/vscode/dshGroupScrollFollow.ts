/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 过程组容器的**组内滚动跟随**（官方 `conversation-nodes/README.md`「Group-title rules」末段）。
//
// 官方原文三段：
//   ① 「An open capped group follows content growth only while its own scroll position is at the bottom.」
//   ② 「Scrolling away pauses that group's following; returning to the bottom resumes it,
//       independently of outer transcript following.」
//   ③ 「Manually opening an unclosed group starts at the bottom and follows growth;
//       manually opening a closed group starts at the top with following disabled,
//       even when its initial content fits without scrolling.」
//
// 这三条与「外层 transcript 跟随」是**两套独立状态**——组内跟随不能借用外层的 following/reading，
// 否则「外层在跟随、组内被用户上滚过」就无法表达。所以这里是一个独立的小状态机。
//
// 判定是纯函数、DOM 接线在 `dshSlotHostContentPart`：分开的理由与 `dshScrollFollow` 相同——
// 迁移规则必须能单测，而 DOM 无法在 node:test 里跑。

/** 一个组容器的跟随归属。 */
export type DshGroupFollowMode = 'following' | 'paused';

export interface DshGroupFollowState {
	readonly mode: DshGroupFollowMode;
}

/** 组内跟随的初始态：刚展开、还没被用户滚动过。 */
export const DSH_GROUP_FOLLOW_INITIAL: DshGroupFollowState = { mode: 'following' };

/**
 * 用户滚动该组之后的新归属（官方①②）。
 *
 * @param state 当前归属
 * @param atBottom 滚动后是否仍在组自身的底部
 * @returns 到底 → 恢复跟随；离开底部 → 暂停
 *
 * 与 `dshScrollFollowAfterScroll` 同一形态，但**独立实例**：组的暂停不影响外层，
 * 外层的阅读锁也不影响组（官方明确「independently of outer transcript following」）。
 */
export function dshGroupFollowAfterScroll(state: DshGroupFollowState, atBottom: boolean): DshGroupFollowState {
	if (atBottom) {
		return state.mode === 'following' ? state : { mode: 'following' };
	}
	return state.mode === 'paused' ? state : { mode: 'paused' };
}

/**
 * 手动展开一个组时的初始归属（官方③）。
 *
 * 官方区分两种组：
 *   - **unclosed**（Turn 仍在跑）：从底部开始并跟随增长；
 *   - **closed**（Turn 已结束）：从**顶部**开始、跟随**禁用**——即使初始内容不满一屏也不跟随。
 *
 * 「为什么 closed 要从顶部」：历史组的价值在「从头读一遍」；让它自动跟到底会把读者带到末尾，
 * 反而看不到这次工作的起点。
 *
 * @param closed 该组所属 Turn 是否已结束
 * @returns 初始归属
 */
export function dshGroupFollowOnOpen(closed: boolean): DshGroupFollowState {
	return closed ? { mode: 'paused' } : { mode: 'following' };
}

/**
 * 组内容增长时是否应该把组滚到底（官方①）。
 *
 * @param state 当前归属
 * @returns 只有「跟随中」才滚
 */
export function dshGroupShouldFollow(state: DshGroupFollowState): boolean {
	return state.mode === 'following';
}
