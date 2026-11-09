/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P4：DTO 行的展示文本提取（`DshIdeRow` → 可渲染文本）。
//
// 为什么只有这一个函数：投影载荷里真正需要「解释」的只有一件事——折叠行该显示什么。
// 全文已被投影器移出快照（第 2 章 E10），折叠行只剩 `preview`；非折叠行用 `text`。
// Chat 渲染内容的构造在 `dshChatAgent.ts`（直接消费本函数，不另设转译层）。
//
// R0 复用说明：本文件**没有**新造渲染机制或组件，只做 DTO 字段选择；所有渲染都交给
// VS Code 既有的 `IChatRendererContent` 与 `dshChatSeam` 的 sidecar。
//
// 边界（第 1 章 §3）：`workbench/**`，零 `@deepseek-ai/*`。

import type { DshIdeRow } from '../../../../platform/dshClient/common/dshIdeProtocol.js';

/** 取一行的展示文本：折叠行优先用 `preview`，非折叠行用 `text`。两者皆无时返回 undefined。 */
export function rowText(row: DshIdeRow): string | undefined {
	if (row.folded) {
		return row.preview ?? row.text;
	}
	return row.text ?? row.preview;
}
