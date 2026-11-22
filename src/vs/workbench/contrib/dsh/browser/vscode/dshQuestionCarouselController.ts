/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import type { DshIdeQuestionItemView } from '../../../../../platform/dshClient/protocol/dshIdeProtocol.js';
import type { IChatQuestionAnswerValue } from '../../../chat/common/chatService/chatService.js';
import { ChatQuestionCarouselData } from '../../../chat/common/model/chatProgressTypes/chatQuestionCarouselData.js';
import type { DshQuestionDraft } from './dshPendingSettlement.js';
import { fromDshCarouselAnswers, toDshCarouselQuestions, usesDshQuestionCarousel } from './dshQuestionCarouselAdapter.js';

export interface IDshQuestionCarouselEntry {
	readonly eventId: string;
	readonly signature: string;
	readonly questions: readonly DshIdeQuestionItemView[];
	readonly carousel: ChatQuestionCarouselData;
	/** 官方 `AskUserQuestionRequestEvent.wait.callId`：卡片被 keyed 的 tool call（`reveal` 用它定位）。 */
	readonly callId?: string;
	/** 只读回看卡片：没有答案通道、没有倒计时（官方 `review` 的语义）。 */
	readonly readOnly?: boolean;
	busy: boolean;
	error: string | undefined;
}

/** 草稿属于一个内容会话；虚拟列表释放 DOM 时仍保留原生轮播的临时状态。 */
export class DshQuestionCarouselController extends Disposable {
	private readonly _entries = new Map<string, IDshQuestionCarouselEntry>();
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;
	private readonly _submit: (eventId: string, draft: readonly DshQuestionDraft[]) => Promise<boolean>;

	constructor(submit: (eventId: string, draft: readonly DshQuestionDraft[]) => Promise<boolean>) {
		super();
		this._submit = submit;
	}

	sync(pending: readonly { readonly eventId: string; readonly kind: string; readonly questions: readonly DshIdeQuestionItemView[] }[]): void {
		const live = new Set<string>();
		let changed = false;
		for (const item of pending) {
			if (!usesDshQuestionCarousel(item)) {
				continue;
			}
			live.add(item.eventId);
			const signature = JSON.stringify(item.questions);
			if (this._entries.get(item.eventId)?.signature === signature) {
				continue;
			}
			const callId = (item as { readonly callId?: string }).callId;
			this._entries.set(item.eventId, {
				eventId: item.eventId, signature, questions: item.questions,
				...(callId === undefined ? {} : { callId }),
				carousel: new ChatQuestionCarouselData(toDshCarouselQuestions(item.questions), true, item.eventId),
				busy: false, error: undefined,
			});
			changed = true;
		}
		for (const id of this._entries.keys()) {
			// 只读回看卡片（官方 `review`）不属于投影，投影扫描不能把它清掉；
			// 它只由用户关闭（`closeReview`）或新一次 review 替换。
			if (!live.has(id) && this._entries.get(id)?.readOnly !== true) {
				this._entries.delete(id);
				changed = true;
			}
		}
		if (changed) {
			this._onDidChange.fire();
		}
	}

	/**
	 * 官方 `userQuestionPanels.reveal(sessionId, callId)`：把该 call 的**可作答**卡片重新发布。
	 *
	 * 返回值对齐官方语义：本客户端没有这张卡（未命名请求 / 别的窗口的问卷 / 投影已关闭）时
	 * 返回 `false`，调用方据此决定是否退化为展开工具行，而不是伪造一张空卡。
	 */
	reveal(callId: string): IDshQuestionCarouselEntry | undefined {
		if (callId === '') {
			return undefined;
		}
		for (const entry of this._entries.values()) {
			if (entry.readOnly !== true && entry.callId === callId) {
				return entry;
			}
		}
		return undefined;
	}

	/**
	 * 官方 `userQuestionPanels.review(sessionId, callId, record)`：用调用方解析出的
	 * questions + answers 建一张**只读**卡片。
	 *
	 * 为什么 record 由调用方给：官方 `userQuestions` 投影只列**还能回答**的调用，
	 * 已结算的答案只存在于 transcript 自己的记录里（本仓是 `question-reply` 节点）。
	 * 这张卡没有答案通道、没有倒计时，投影扫描不碰它（`readOnly` 标记），关闭即移除。
	 */
	review(callId: string, record: { readonly questions: readonly DshIdeQuestionItemView[]; readonly answers: readonly { readonly id: string; readonly selected: readonly string[]; readonly custom?: string }[] }): IDshQuestionCarouselEntry | undefined {
		if (callId === '' || record.questions.length === 0) {
			return undefined;
		}
		// 同一 call 已有活卡片时展示活的，不用旧记录覆盖（官方同款：a stale copy never replaces a standing request）。
		const live = this.reveal(callId);
		if (live !== undefined) {
			return live;
		}
		const eventId = `review:${callId}`;
		const carousel = new ChatQuestionCarouselData(toDshCarouselQuestions(record.questions), false, eventId);
		// 把已答内容填成草稿：只读视图据此显示「用户选了什么」。
		// 原生 carousel 的答案形状是 `{selectedValues, freeformValue}`（多选）/ 字符串（单选）。
		// 官方 record 是 `{selected: string[], custom?}`：有一项以上用多选形状承载，
		// 否则用单选字符串。自定义文本进 `freeformValue`，与原生「Other」同一字段。
		carousel.draftAnswers = Object.fromEntries(record.answers.map(answer => {
			if (answer.selected.length > 1 || (answer.selected.length > 0 && answer.custom !== undefined)) {
				return [answer.id, {
					selectedValues: [...answer.selected],
					...(answer.custom === undefined ? {} : { freeformValue: answer.custom }),
				}];
			}
			if (answer.selected.length === 1 && answer.custom === undefined) {
				return [answer.id, answer.selected[0]];
			}
			return [answer.id, { selectedValues: [], ...(answer.custom === undefined ? {} : { freeformValue: answer.custom }) }];
		}));
		const entry: IDshQuestionCarouselEntry = {
			eventId, signature: JSON.stringify(record), questions: record.questions, carousel,
			callId, readOnly: true, busy: false, error: undefined,
		};
		this._entries.set(eventId, entry);
		this._onDidChange.fire();
		return entry;
	}

	/** 关闭一张只读回看卡片（官方：closing a review removes it rather than parking it）。 */
	closeReview(eventId: string): void {
		const entry = this._entries.get(eventId);
		if (entry?.readOnly === true) {
			this._entries.delete(eventId);
			this._onDidChange.fire();
		}
	}

	ids(): readonly string[] { return [...this._entries.keys()]; }
	/** 全部问卷的结构指纹，供 slot host 判重。 */
	signature(): string {
		return [...this._entries.values()].map(entry => `${entry.eventId}:${entry.signature}`).join('\n');
	}
	get(eventId: string): IDshQuestionCarouselEntry | undefined { return this._entries.get(eventId); }

	async submit(entry: IDshQuestionCarouselEntry, answers: ReadonlyMap<string, IChatQuestionAnswerValue> | undefined): Promise<boolean> {
		if (this._entries.get(entry.eventId) !== entry || entry.busy) {
			return false;
		}
		entry.carousel.draftAnswers = answers === undefined ? {} : Object.fromEntries(answers);
		entry.busy = true;
		entry.error = undefined;
		this._onDidChange.fire();
		try {
			const sent = await this._submit(entry.eventId, fromDshCarouselAnswers(entry.questions, answers));
			if (this._entries.get(entry.eventId) !== entry) {
				return sent;
			}
			if (sent) {
				this._entries.delete(entry.eventId);
			} else {
				entry.error = localize('dsh.question.sendFailed', 'The answer was not accepted. Your draft is kept; review it before retrying.');
			}
			return sent;
		} catch {
			if (this._entries.get(entry.eventId) === entry) {
				entry.error = localize('dsh.question.sendUnknown', 'The answer could not be confirmed. Your draft is kept.');
			}
			return false;
		} finally {
			entry.busy = false;
			this._onDidChange.fire();
		}
	}

	override dispose(): void {
		this._entries.clear();
		super.dispose();
	}
}
