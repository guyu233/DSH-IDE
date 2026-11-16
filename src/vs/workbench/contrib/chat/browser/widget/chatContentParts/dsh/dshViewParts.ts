/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../../../base/common/themables.js';
import { IMarkdownRenderer } from '../../../../../../../platform/markdown/browser/markdownRenderer.js';
import { MarkdownString } from '../../../../../../../base/common/htmlContent.js';
import { DshNodeViewInput, jsonText } from './dshNodeTypes.js';

/** 折叠区块：summary 常显，body 可展开；带 aria-expanded 与键盘可达（details 原生能力）。 */
export function createDisclosure(store: DisposableStore, summaryText: string, icon?: ThemeIcon): { root: HTMLElement; body: HTMLElement; summary: HTMLElement } {
	const details = dom.$('details.chat-dsh-disclosure');
	const summary = dom.append(details, dom.$('summary.chat-dsh-disclosure-summary'));
	if (icon !== undefined) {
		const iconEl = dom.append(summary, dom.$('span.chat-dsh-disclosure-icon'));
		iconEl.classList.add(...ThemeIcon.asClassNameArray(icon));
		iconEl.setAttribute('aria-hidden', 'true');
	}
	const label = dom.append(summary, dom.$('span.chat-dsh-disclosure-label'));
	label.textContent = summaryText;
	const body = dom.append(details, dom.$('.chat-dsh-disclosure-body'));
	void store;
	return { root: details, body, summary };
}

/** 一行 key/value；value 为 undefined 时显示显式缺失，而不是空白。 */
export function createField(label: string, value: unknown): HTMLElement {
	const row = dom.$('.chat-dsh-field');
	const key = dom.append(row, dom.$('span.chat-dsh-field-key'));
	key.textContent = label;
	const val = dom.append(row, dom.$('span.chat-dsh-field-value'));
	val.textContent = jsonText(value);
	return row;
}

/** markdown 渲染并纳入 dispose 管理。 */
export function renderMarkdown(store: DisposableStore, renderer: IMarkdownRenderer, value: string): HTMLElement {
	const rendered = store.add(renderer.render(new MarkdownString(value)));
	rendered.element.classList.add('chat-dsh-markdown');
	return rendered.element;
}

/** 状态徽标：文字来自调用方（必须是 encoded 派生值或 UI chrome），不在此处编造。 */
export function createBadge(text: string, tone: 'default' | 'success' | 'warning' | 'error' = 'default'): HTMLElement {
	const badge = dom.$(`span.chat-dsh-badge.chat-dsh-badge-${tone}`);
	badge.textContent = text;
	return badge;
}

/** 卡片外框。 */
export function createCard(tone: 'default' | 'error' | 'warning' | 'success' = 'default'): HTMLElement {
	return dom.$(`.chat-dsh-card.chat-dsh-card-${tone}`);
}

/** 标题行：图标 + 文本（文本必须来自 encoded 或 UI chrome）。 */
export function createTitleRow(icon: ThemeIcon, text: string): HTMLElement {
	const row = dom.$('.chat-dsh-title');
	const iconEl = dom.append(row, dom.$('span.chat-dsh-title-icon'));
	iconEl.classList.add(...ThemeIcon.asClassNameArray(icon));
	iconEl.setAttribute('aria-hidden', 'true');
	const label = dom.append(row, dom.$('span.chat-dsh-title-text'));
	label.textContent = text;
	return row;
}

export { Codicon };
export type { DshNodeViewInput };
