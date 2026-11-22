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
			this._entries.set(item.eventId, {
				eventId: item.eventId, signature, questions: item.questions,
				carousel: new ChatQuestionCarouselData(toDshCarouselQuestions(item.questions), true, item.eventId),
				busy: false, error: undefined,
			});
			changed = true;
		}
		for (const id of this._entries.keys()) {
			if (!live.has(id)) {
				this._entries.delete(id);
				changed = true;
			}
		}
		if (changed) {
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
