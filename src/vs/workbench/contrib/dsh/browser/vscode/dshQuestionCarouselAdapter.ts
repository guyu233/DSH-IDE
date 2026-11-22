/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DshIdeQuestionItemView } from '../../../../../platform/dshClient/protocol/dshIdeProtocol.js';
import type { IChatQuestion, IChatQuestionAnswerValue } from '../../../chat/common/chatService/chatService.js';
import type { DshQuestionDraft } from './dshPendingSettlement.js';

/** 原生轮播只承接普通问卷；计划审阅仍由专用动作负责。 */
export function usesDshQuestionCarousel(item: { readonly kind: string; readonly questions?: readonly DshIdeQuestionItemView[] }): boolean {
	return item.kind === 'question' && (item.questions?.length ?? 0) > 0
		&& !item.questions!.some(question => question.intent?.kind === 'plan-review');
}

/** 标签作为答案值原样保留，选项说明只参与展示，不进入线协议。 */
export function toDshCarouselQuestions(questions: readonly DshIdeQuestionItemView[]): IChatQuestion[] {
	return questions.map(question => ({
		id: question.id,
		type: !question.options?.length ? 'text' : question.multiSelect ? 'multiSelect' : 'singleSelect',
		title: question.header || question.question || question.id,
		message: question.question,
		description: question.detail,
		options: question.options?.map((option, index) => ({
			id: String(index),
			label: option.description ? `${option.label} — ${option.description}` : option.label,
			value: option.label,
		})),
		allowFreeformInput: true,
		required: false,
	}));
}

/** 只在用户按下提交或明确跳过之后调用；未填题生成显式 skipped 草稿。 */
export function fromDshCarouselAnswers(questions: readonly DshIdeQuestionItemView[], answers: ReadonlyMap<string, IChatQuestionAnswerValue> | undefined): readonly DshQuestionDraft[] {
	return questions.map(question => {
		const value = answers?.get(question.id);
		let selected: readonly string[] = [];
		let custom = '';
		if (typeof value === 'string') {
			custom = value.trim();
		} else if (value !== undefined) {
			custom = value.freeformValue?.trim() ?? '';
			selected = 'selectedValues' in value ? [...value.selectedValues]
				: value.selectedValue === undefined ? [] : [value.selectedValue];
		}
		// 官方单选自由回答替换选项；多选自由回答可以补充勾选项。
		if (!question.multiSelect && custom !== '') {
			selected = [];
		}
		return {
			id: question.id,
			selected,
			...(custom === '' ? {} : { custom }),
			...(custom === '' && selected.length === 0 ? { skipped: true } : {}),
		};
	});
}
