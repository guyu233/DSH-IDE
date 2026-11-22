/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ChatQuestionCarouselPart } from '../../../chat/browser/widget/chatContentParts/chatQuestionCarouselPart.js';
import type { IChatContentPart } from '../../../chat/browser/widget/chatContentParts/chatContentParts.js';
import type { DshQuestionCarouselController, IDshQuestionCarouselEntry } from './dshQuestionCarouselController.js';

/** 复用原生问卷控件；提交由 DSH waterfall 结算，不调用 ChatService.sendRequest。 */
export class DshQuestionCarouselContentPart extends Disposable implements IChatContentPart {
	readonly domNode = $('.dsh-question-carousel');
	private readonly _part = this._register(new MutableDisposable<ChatQuestionCarouselPart>());
	private readonly _heightListener = this._register(new MutableDisposable());
	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;
	private _disposed = false;
	private _scheduled = false;

	constructor(
		private readonly _controller: DshQuestionCarouselController,
		private readonly _entry: IDshQuestionCarouselEntry,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
		this.render();
		this._register(_controller.onDidChange(() => {
			if (this._scheduled) { return; }
			this._scheduled = true;
			// 原生 onSubmit 之后还会收起自身，等该调用结束再释放它。
			queueMicrotask(() => {
				this._scheduled = false;
				if (!this._disposed) { this.render(); }
			});
		}));
	}

	private render(): void {
		this._heightListener.clear();
		this._part.clear();
		this.domNode.replaceChildren();
		if (this._controller.get(this._entry.eventId) !== this._entry) {
			this._onDidChangeHeight.fire();
			return;
		}
		const status = $('div');
		status.setAttribute('role', 'status');
		status.setAttribute('aria-live', 'polite');
		status.textContent = this._entry.busy
			? localize('dsh.question.sending', 'Submitting answers…')
			: this._entry.error ?? localize('dsh.question.skipHint', 'Review all questions before submitting. Unanswered questions are submitted as skipped.');
		this.domNode.appendChild(status);
		if (!this._entry.busy) {
			// DSH 待决状态是唯一准据，不因历史 response 被标 complete 而禁用问卷。
			const part = this._instantiationService.createInstance(ChatQuestionCarouselPart, this._entry.carousel, undefined, {
				shouldAutoFocus: false,
				shouldAutoSelectFirstOption: false,
				dismissLabel: localize('dsh.question.skipAll', 'Skip all questions'),
				onSubmit: answers => { void this._controller.submit(this._entry, answers); },
			});
			this._part.value = part;
			this._heightListener.value = part.onDidChangeHeight(() => this._onDidChangeHeight.fire());
			this.domNode.appendChild(part.domNode);
		}
		this._onDidChangeHeight.fire();
	}

	hasSameContent(): boolean { return false; }

	override dispose(): void {
		this._disposed = true;
		super.dispose();
	}
}
