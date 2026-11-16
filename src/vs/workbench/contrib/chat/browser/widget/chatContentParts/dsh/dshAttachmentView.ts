/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { DshNodeViewInput, asString, isRecord } from './dshNodeTypes.js';
import { createField } from './dshViewParts.js';

/**
 * 图片/文件附件视图。
 *
 * 三种来源，优先级固定且全部可回溯：
 * 1. 载荷内已含 `dataUrl` / `url` → 直接渲染；
 * 2. 只有 `attachmentId` 且注入了 `readAttachment` → 走官方契约异步解析；
 * 3. 解析失败或未注入 → 显示**原始 attachment JSON**，绝不留空白。
 */
export class DshAttachmentView {
	readonly domNode: HTMLElement;

	constructor(attachment: unknown, input: DshNodeViewInput, stores: DisposableStore) {
		const box = dom.$('.chat-dsh-attachment');
		const name = attachmentName(attachment);
		const nameEl = dom.append(box, dom.$('.chat-dsh-attachment-name'));
		nameEl.textContent = name ?? asString(isRecord(attachment) ? attachment['type'] : undefined) ?? 'attachment';

		const inline = inlineSource(attachment);
		if (inline !== undefined) {
			const img = dom.append(box, dom.$('img.chat-dsh-attachment-image')) as HTMLImageElement;
			img.src = inline;
			img.alt = name ?? 'attachment';
			// 点击放大（lightbox）：纯 UI 行为，不改 encoded。
			const handler = () => openLightbox(inline, img.alt);
			img.addEventListener('click', handler);
			img.tabIndex = 0;
			const keyHandler = (e: KeyboardEvent) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					handler();
				}
			};
			img.addEventListener('keydown', keyHandler);
			stores.add({ dispose: () => { img.removeEventListener('click', handler); img.removeEventListener('keydown', keyHandler); } });
			this.domNode = box;
			return;
		}

		const attachmentId = isRecord(attachment) ? asString(attachment['attachmentId']) : undefined;
		if (attachmentId !== undefined && input.readAttachment !== undefined) {
			// 先显示原始 attachment（可回溯），解析成功后再补图片。
			const raw = dom.append(box, dom.$('.chat-dsh-attachment-detail'));
			raw.textContent = attachmentId;
			void this._load(attachmentId, attachment, box, raw, input.readAttachment, stores);
			this.domNode = box;
			return;
		}

		box.appendChild(createField('attachment', attachment));
		this.domNode = box;
	}

	private async _load(
		attachmentId: string,
		attachment: unknown,
		box: HTMLElement,
		raw: HTMLElement,
		readAttachment: NonNullable<DshNodeViewInput['readAttachment']>,
		stores: DisposableStore,
	): Promise<void> {
		let value: { mediaType: string; data: string } | undefined;
		try {
			value = await readAttachment(attachment);
		} catch {
			value = undefined;
		}
		if (value === undefined) {
			// 失败：保留原始 JSON，不伪造图片。
			box.appendChild(createField('attachment', attachment));
			return;
		}
		const img = dom.append(box, dom.$('img.chat-dsh-attachment-image')) as HTMLImageElement;
		img.src = `data:${value.mediaType};base64,${value.data}`;
		img.alt = attachmentName(attachment) ?? attachmentId;
		raw.remove();
		stores.add({ dispose: () => img.remove() });
	}
}

function inlineSource(attachment: unknown): string | undefined {
	if (!isRecord(attachment)) {
		return undefined;
	}
	const dataUrl = asString(attachment['dataUrl']);
	if (dataUrl !== undefined && dataUrl !== '') {
		return dataUrl;
	}
	const url = asString(attachment['url']);
	if (url !== undefined && url !== '') {
		return url;
	}
	return undefined;
}

function attachmentName(attachment: unknown): string | undefined {
	if (!isRecord(attachment)) {
		return undefined;
	}
	const name = asString(attachment['name']);
	return name !== undefined && name !== '' ? name : undefined;
}

/**
 * 极简 lightbox：覆盖层 + 图片，Esc / 点击背景关闭，关闭后恢复焦点到触发元素。
 *
 * 不引入第三方依赖，不做复杂的缩放/旋转；关闭时确保从 DOM 移除，避免泄漏。
 */
function openLightbox(src: string, alt: string): void {
	const previouslyFocused = document.activeElement as HTMLElement | null;
	const overlay = dom.$('.chat-dsh-lightbox');
	overlay.setAttribute('role', 'dialog');
	overlay.setAttribute('aria-modal', 'true');
	overlay.setAttribute('aria-label', alt);

	const image = dom.append(overlay, dom.$('img.chat-dsh-lightbox-image')) as HTMLImageElement;
	image.src = src;
	image.alt = alt;

	const close = () => {
		overlay.remove();
		document.removeEventListener('keydown', onKey);
		previouslyFocused?.focus?.();
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			close();
		}
	};

	overlay.addEventListener('click', e => {
		// 点击背景关闭；点击图片本身不关闭。
		if (e.target === overlay) {
			close();
		}
	});
	document.addEventListener('keydown', onKey);

	document.body.appendChild(overlay);
	overlay.focus?.();
}
