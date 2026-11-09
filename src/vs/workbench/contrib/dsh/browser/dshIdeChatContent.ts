/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P4：DTO → Chat 渲染内容的适配层（`DshIdeRow` → `IChatRendererContent`）。
//
// 为什么需要这一层：`DshIdeConsumer` 产出的是中立行（`DshIdeRow`），
// `chatListRenderer` 消费的是 `IChatRendererContent`，两者之间必须有一条唯一、可测的映射，
// 否则「Chat 侧栏显示 DSH 内容」只能靠散落在渲染器里的字符串拼接。
//
// 边界（第 1 章 §3 / §4）：本文件在 `workbench/**`，零 `@deepseek-ai/*`，不持有会话状态，
// 也不创建 Chat 模型；它只做纯映射，由贡献点决定何时把结果交给 Chat。

import { MarkdownString } from '../../../../base/common/htmlContent.js';
import type { IChatRendererContent } from '../../chat/common/model/chatViewModel.js';
import type { DshIdeRow } from '../../../../platform/dshClient/common/dshIdeProtocol.js';
import { projectRowToUi, rowText, type DshUiPart } from './dshIdeUiProjection.js';

/**
 * 把一行 DTO 转成 Chat 渲染内容。
 *
 * 只用 `markdownContent` 一种 kind：它是 `dshChatSeam` 已支持、且与原生渲染器兼容最好的形态
 * （用户消息 / assistant 正文 / 工具结果都是文本）。**不伪造** `toolInvocation` 等需要真实
 * 工具状态的 kind（第 8 章 §8.4：工具行保留 VS Code 原生渲染）。
 *
 * @param row - 消费者已接受的行
 * @returns 可交给 `chatListRenderer` 的内容；不可渲染时返回 undefined（调用方过滤）
 */
export function rowToChatContent(row: DshIdeRow): IChatRendererContent | undefined {
	const text = rowText(row);
	if (text === undefined) {
		return undefined;
	}
	const markdown = new MarkdownString(text);
	if (row.kind === 'user') {
		// 用户消息保持原样：不加引用、不加折叠标记，避免和 DSH 侧展示不一致。
		markdown.isTrusted = false;
	} else {
		// DSH 输出的正文/工具结果可能包含合法 Markdown；命令与链接按 VS Code 默认策略执行。
		markdown.isTrusted = { enabledCommands: [] };
	}
	return { kind: 'markdownContent', content: markdown };
}

/** 把整段行转成 Chat 内容序列（跳过不可渲染行，保持快照顺序）。 */
export function rowsToChatContent(rows: readonly DshIdeRow[]): readonly IChatRendererContent[] {
	const out: IChatRendererContent[] = [];
	for (const row of rows) {
		const content = rowToChatContent(row);
		if (content !== undefined) {
			out.push(content);
		}
	}
	return out;
}

/**
 * 行 → UI 部件的稳定键：Chat 增量刷新时用它判断能否复用节点。
 * 同时带上 `revision`，这样同一行内容变化会得到新键（触发更新），未变化则复用。
 */
export function rowUiKey(row: DshIdeRow): string {
	return `${row.id}#${row.revision}`;
}

/** 供渲染层判断该行是否会交给 DSH 接缝（`dshChatSeam` 只接管 markdownContent）。 */
export function rowProjectsToDshSeam(row: DshIdeRow): boolean {
	const part: DshUiPart | undefined = projectRowToUi(row);
	return part !== undefined;
}
