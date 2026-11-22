/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 审批 / 问卷 / 计划的一次结算。
// 缺任何一题、多选里混进未知选项、或 discuss 还没结束，都不产出可提交的答案。
// 这样调用方不会把半份答案当成整份发走。

export interface DshSettlementQuestion {
	readonly id: string;
	readonly options: readonly { readonly label: string }[];
	readonly multiSelect: boolean;
	readonly intent?: DshSettlementIntent;
}

export type DshSettlementIntent =
	| { readonly kind: 'plan-review'; readonly approve: string; readonly reject?: string }
	| { readonly kind: 'approval'; readonly approve: string; readonly reject: string; readonly always?: string };

export interface DshQuestionDraft {
	readonly id: string;
	readonly selected: readonly string[];
	readonly custom?: string;
	/** 本地草稿标记；不进入 answerQuestion 线协议。 */
	readonly skipped?: boolean;
}

export interface DshQuestionSettlement {
	readonly answers: readonly { readonly id: string; readonly selected: readonly string[]; readonly custom?: string }[];
}

/** 原生一次点击只能提交一题单选。多题、多选或没有选项都不能用命令按钮假装答完。 */
export function questionUsesSingleClick(questions: readonly { readonly multiSelect: boolean; readonly options: readonly unknown[] }[]): boolean {
	const question = questions[0];
	return questions.length === 1 && question !== undefined && question.multiSelect !== true && question.options.length > 0;
}

/** 批准只接受 approve / reject。reason 空串不当成理由。always 不是这条线协议的 decision。 */
export function settleApproval(decision: string, reason?: string): { readonly decision: 'approve' | 'reject'; readonly reason?: string } | undefined {
	if (decision !== 'approve' && decision !== 'reject') {
		return undefined;
	}
	const trimmed = reason?.trim();
	return trimmed === undefined || trimmed === '' ? { decision } : { decision, reason: trimmed };
}

/**
 * 整份问卷一次提交。
 * 每题都必须出现一次。有选项时选中项必须是选项标签；单选只能一项。
 * 选项或非空 custom 均可作答；空答案必须由本地 skipped 标记显式确认。
 */
export function settleQuestion(questions: readonly DshSettlementQuestion[], draft: readonly DshQuestionDraft[]): DshQuestionSettlement | undefined {
	const questionIds = new Set(questions.map(question => question.id));
	if (questions.length === 0 || draft.length !== questions.length || questionIds.size !== questions.length || questionIds.has('')) {
		return undefined;
	}
	const byId = new Map<string, DshQuestionDraft>();
	for (const item of draft) {
		if (item.id === '' || byId.has(item.id)) {
			return undefined;
		}
		byId.set(item.id, item);
	}
	const answers: { readonly id: string; readonly selected: readonly string[]; readonly custom?: string }[] = [];
	for (const question of questions) {
		const item = byId.get(question.id);
		if (item === undefined) {
			return undefined;
		}
		const known = new Set(question.options.map(option => option.label));
		const selected: string[] = [];
		for (const label of item.selected) {
			if (!known.has(label) || selected.includes(label)) {
				return undefined;
			}
			selected.push(label);
		}
		const custom = item.custom?.trim();
		if (!question.multiSelect && selected.length > 1) {
			return undefined;
		}
		if (item.skipped === true) {
			if (selected.length > 0 || (custom !== undefined && custom !== '')) {
				return undefined;
			}
		} else if (selected.length === 0 && (custom === undefined || custom === '')) {
			return undefined;
		}
		answers.push({
			id: question.id,
			selected,
			...(custom === undefined || custom === '' ? {} : { custom }),
		});
	}
	return { answers };
}

