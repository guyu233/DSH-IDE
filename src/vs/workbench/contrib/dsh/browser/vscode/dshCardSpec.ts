/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// `dsh*` 自研部件的**结构**描述（契约 §16 退出条件 4：不得用 info/warning/markdown 文本模拟）。
//
// 为什么拆出这份纯数据：`dshSlotHostContentPart` 里原本把所有 `dsh*` 部件都拼成一串
// `textContent`——`dshCompaction` 是「摘要 + 两个数字换行拼接」、`dshDeliverables` 是
// 「路径 + 描述」……这既是文本模拟，也让「折叠」
// 无从谈起（没有 DOM 结构可折叠）。
//
// 这里只产出「该画什么行、每行是什么角色、是否可折叠」的描述；DOM 由渲染层按描述建。
// 这样：
//   - 结构判定可以单测（不需要 DOM）；
//   - 渲染层不必再按 kind 写一条 100 行的 if-else；
//   - 新增部件只要补一份描述，不会又落回 `textContent` 拼接。

import type { DshNativePart } from './dshNativePartAdapters.js';
import { workflowStatusText } from './dshTokenFormat.js';

/** 一行内容的角色：标题 / 正文 / 次要说明（决定字号与颜色，不决定内容）。 */
export type DshCardLineRole = 'title' | 'body' | 'meta';

/** 卡片里的一行。 */
export interface DshCardLine {
	readonly role: DshCardLineRole;
	readonly text: string;
}

/** 一张自研卡片的可渲染描述。 */
export interface DshCardSpec {
	/** 卡片的语义标题（读屏与折叠头都用它）。 */
	readonly title: string;
	/** 折叠头之后的正文行；为空时不可折叠。 */
	readonly lines: readonly DshCardLine[];
	/**
	 * 是否默认展开。
	 *
	 * `compaction` 属于「背景资料」：默认收起，用户需要时才展开；
	 * 结果类卡片（交付物、错误、用量）默认展开。
	 */
	readonly open: boolean;
	/** 是否可折叠；`lines` 为空时强制 false（不留一个点了没反应的折叠头）。 */
	readonly collapsible: boolean;
}

/**
 * 把 `dsh*` 部件描述成一张结构化卡片。
 *
 * 只处理**确实需要自研**的部件（原生 Chat 没有等价语义）；有原生等价的部件
 * （markdown / thinking / toolInvocation / reference / progressTask / errorDetails）
 * 不在这里出现——它们走原生 part，不该被这张表接管。
 *
 * 返回 `undefined` 表示「这个部件不该由这张卡片画」，调用方按原路径处理。
 */
export function dshCardSpec(part: DshNativePart): DshCardSpec | undefined {
	switch (part.kind) {
		case 'dshCompaction': {
			// 官方 `CompactionSummaryNode` + `manual-compaction`：摘要可展开，并给出被压缩的规模。
			const counts: string[] = [];
			if (typeof part.shadowedItemCount === 'number') {
				counts.push(`${part.shadowedItemCount} items`);
			}
			if (typeof part.shadowedTokenCount === 'number') {
				counts.push(`${part.shadowedTokenCount} tokens`);
			}
			const lines: DshCardLine[] = [];
			if (part.summary !== null && part.summary !== '') {
				lines.push({ role: 'body', text: part.summary });
			}
			if (counts.length > 0) {
				lines.push({ role: 'meta', text: counts.join(' · ') });
			}
			return { title: 'Compaction', lines, open: false, collapsible: lines.length > 0 };
		}
		case 'dshDeliverables': {
			const lines = part.files.map(file => ({
				role: 'body' as const,
				text: file.description === undefined ? file.path : `${file.path} — ${file.description}`,
			}));
			return { title: 'Deliverables', lines, open: true, collapsible: false };
		}
		case 'dshFileCard': {
			const lines = part.files.map(file => ({
				role: 'body' as const,
				text: file.bytes === undefined ? file.name : `${file.name} (${file.bytes} bytes)`,
			}));
			return { title: 'Files', lines, open: true, collapsible: false };
		}
		case 'dshWorkflowRun': {
			// 状态走 `workflowStatusText`：线协议里的是稳定的英文枚举，界面要跟 DSH 语言走。
			const lines: DshCardLine[] = [{ role: 'meta', text: workflowStatusText(part.status) }];
			for (const phase of part.phases) {
				lines.push({ role: 'body', text: phase.phase ?? phase.key });
				for (const member of phase.members) {
					lines.push({ role: 'meta', text: `${member.label} — ${member.status}` });
				}
			}
			return { title: part.name || part.runId, lines, open: true, collapsible: lines.length > 1 };
		}
		case 'dshSubmittedPlan': {
			const lines = part.markdown === '' ? [] : [{ role: 'body' as const, text: part.markdown }];
			return { title: part.title || 'Plan', lines, open: false, collapsible: lines.length > 0 };
		}
		case 'dshUsage': {
			// 用量是数字，不是正文：拆成 meta 行，避免和正文混在一起。
			const lines: DshCardLine[] = [];
			if (typeof part.input === 'number' || typeof part.output === 'number') {
				lines.push({ role: 'meta', text: `in ${part.input ?? 0} · out ${part.output ?? 0}` });
			}
			return { title: 'Usage', lines, open: true, collapsible: false };
		}
		default:
			return undefined;
	}
}
