/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH 展示部件的「契约」——在数据面(common/dshChatBridge) 与渲染面(browser/dshChatParts) 之间共享，
// 避免 common 依赖 browser。用 progressMessage 的 id 前缀区分工具/步骤/用量，用 kind:'thinking' 承载思考。
// 之所以用「原生安全」的 progressMessage（而非伪造 toolInvocation/usage），是为了不动 VS Code 内部
// 富数据通道、保证任何版本都能渲染，同时由单接缝把 DSH 的骨架样式接管过去。

import { IChatProgress } from './chatService.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';

export const DSH_TOOL_PREFIX = 'dsh-tool:';
export const DSH_STEP_PREFIX = 'dsh-step:';
export const DSH_USAGE_ID = 'dsh-usage';

/** 思考块（原生 kind:'thinking'，seam 会替换为 DSH 折叠块）。 */
export function dshThinkingProgress(text: string, id?: string): IChatProgress {
	return { kind: 'thinking', value: text, ...(id ? { id } : {}) } as unknown as IChatProgress;
}

/** 工具调用行（progressMessage，id 前缀 dsh-tool:）。text 前置一个状态字形。 */
export function dshToolProgress(callId: string, text: string): IChatProgress {
	return { kind: 'progressMessage', id: DSH_TOOL_PREFIX + callId, content: new MarkdownString(text), shimmer: false } as unknown as IChatProgress;
}

/** 步骤行（progressMessage，id 前缀 dsh-step:）。 */
export function dshStepProgress(turn: number, step: number, label: string): IChatProgress {
	return { kind: 'progressMessage', id: `${DSH_STEP_PREFIX}${turn}:${step}`, content: new MarkdownString(label), shimmer: false } as unknown as IChatProgress;
}

/** 用量行（progressMessage，固定 id dsh-usage，后者覆盖前者）。 */
export function dshUsageProgress(promptTokens: number, completionTokens: number): IChatProgress {
	return { kind: 'progressMessage', id: DSH_USAGE_ID, content: new MarkdownString(`↑${promptTokens} ↓${completionTokens} tokens`), shimmer: false } as unknown as IChatProgress;
}
