/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 数值与状态文案的纯格式化。
//
// 单独成文件的原因：`dshSlotHostContentPart` 用了构造函数参数属性，Node 的 strip-only
// 模式加载不了它，测试无法直接引用其中的纯函数。这里零 UI 依赖、零副作用，可被单测直接导入。

import { localize } from '../../../../../nls.js';

/**
 * 紧凑 token 数：517 / 12.2K / 517K / 1.2M。
 *
 * 对照官方 `chat/token-format.ts` 的 `formatTokens`：<1000 原样，<1e6 用 K，否则 M；
 * 缩放后 >=100 取整，否则保留一位小数。不用 `Intl` 的紧凑格式——它按 locale 变单位，
 * 与官方的固定 K/M 不一致。
 */
export function formatTokens(value: number): string {
	const scaled = (candidate: number): string => candidate >= 100
		? String(Math.round(candidate))
		: String(Math.round(candidate * 10) / 10);
	if (value < 1000) {
		return String(value);
	}
	if (value < 1000000) {
		return localize('dsh.tokens.thousand', "{0}K", scaled(value / 1000));
	}
	return localize('dsh.tokens.million', "{0}M", scaled(value / 1000000));
}

/**
 * 工作流状态文案。
 *
 * 只翻译线协议里已知的五种；其余原样显示——猜一个中文词比露出原词更容易误导
 * （与 `dshChatHistory.taskStatusText` 同一口径）。
 */
export function workflowStatusText(status: string): string {
	switch (status) {
		case 'running': return localize('dsh.workflow.running', "running");
		case 'completed': return localize('dsh.workflow.completed', "completed");
		case 'cancelled': return localize('dsh.workflow.cancelled', "cancelled");
		case 'failed': return localize('dsh.workflow.failed', "failed");
		case 'interrupted': return localize('dsh.workflow.interrupted', "interrupted");
		default: return status;
	}
}
