/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Turn 导航条（官方 `ui-chat` 的 turn rail 的**等价投影**）。
//
// 为什么必须自建：本仓 1.143.1 自带完整的 `chat/browser/promptTimeline/`（10 个生产文件，
// 通过 `ChatWidget.CONTRIBS.push(PromptTimelineWidgetContrib)` 挂到每个 ChatWidget），
// 但它的数据源是 VS Code 的 `request` / `response` 视图模型，而 **DSH 的多 Turn 在 VS Code
// 的 Chat 模型里是同一个 request**——原生 rail 对 DSH 会话只会显示一个标记。
// 这不是配置问题，是模型不匹配（CHK-377 已核实）。
//
// 所以这里只做**数据投影**：把 `DshTurnNavigationItem[]` 投影成 rail 的可渲染项。
// DOM 由输入区 dock 承载（复用 `conversation.input.dock` 的 list 语义），不在本文件画 UI。
//
// 与官方 turn rail 的取舍：
//   - 官方的 rail 在 transcript 侧边、固定 pitch、支持预览与未载入 Turn 的分页跳转；
//   - 本仓的 dock 是**行式**席位（输入卡上方），所以投影成「第 N 轮 · 摘要」的行，
//     点击跳到该 Turn 的锚点。这是布局差异，不是语义差异——两者都以 Turn 为导航单位。

import type { DshTurnNavigationItem } from './dshConversationNodeTree.js';

/** rail 上的一项。 */
export interface DshTurnNavEntry {
	/** Turn 号（官方 rail 的标记顺序也用 Turn 号）。 */
	readonly turn: number;
	/** 可点击的行 id（稳定，用于 dock 行的 key）。 */
	readonly id: string;
	/** 行文案：`第 N 轮` + 可选的首行摘要。 */
	readonly label: string;
	/** 跳转目标：该 Turn 的锚点 key。 */
	readonly command: string;
	/** 传给命令的参数（锚点 key）。 */
	readonly arguments: readonly unknown[];
	readonly order: number;
}

/** 摘要最大长度（字符）。官方 rail 的预览是一行 50 字符，这里取同一量级。 */
export const DSH_TURN_NAV_PREVIEW_MAX = 50;

/**
 * 把 turn 导航项投影成 dock 行。
 *
 * @param items `DshConversationNodeTree.navigationItems()` 的结果（已按 turn 升序）
 * @param summaryOf 取某个 Turn 的首行摘要；返回空串表示没有可用摘要
 * @returns dock 行；没有 Turn 时返回空数组（不画空壳）
 */
export function dshTurnNavEntries(
	items: readonly DshTurnNavigationItem[],
	summaryOf: (item: DshTurnNavigationItem) => string = () => '',
): readonly DshTurnNavEntry[] {
	return items.map((item, index) => {
		const summary = summaryOf(item).replace(/\s+/g, ' ').trim();
		const preview = summary.length <= DSH_TURN_NAV_PREVIEW_MAX
			? summary
			: `${summary.slice(0, DSH_TURN_NAV_PREVIEW_MAX - 1)}\u2026`;
		return {
			turn: item.turn,
			id: `turn-nav:${item.turn}`,
			label: preview === '' ? `#${item.turn}` : `#${item.turn} ${preview}`,
			// 命令名与参数约定：宿主用锚点 key 定位那一行。命令由宿主注册，
			// 这里只表达「点击要跳到哪个锚点」，不假设宿主实现。
			command: 'dsh.revealTurnAnchor',
			arguments: [item.anchorKey],
			order: 30 + index,
		};
	});
}
