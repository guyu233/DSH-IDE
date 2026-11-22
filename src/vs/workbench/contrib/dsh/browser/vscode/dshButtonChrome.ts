/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 自研按钮的**键盘与焦点**基准（契约 §11.2：Tab/Shift+Tab 可达、focus-visible、hover tooltip）。
//
// 为什么必须集中一处：`button.style.border = 'none'` 会连同浏览器默认焦点环一起抹掉。
// 本仓 5 个自研按钮（消息动作、文本手势、slot 行头、队列动作、问卷回看）此前都只设了
// `border: none` + `background: transparent`，没有一个补回 `focus-visible` 样式——
// 键盘用户 Tab 到这些按钮时**看不到焦点在哪里**。逐个文件各写一遍 CSS 只会让下一处再漏，
// 所以这里给 `applyDshButtonChrome()` 一个入口：所有自研按钮都必须经过它。
//
// 用一张共享样式表 + `:focus-visible` 而不是逐元素监听 focus/blur：
// 前者由浏览器按输入模态决定要不要显示焦点环（鼠标点击不显示、键盘 Tab 显示），
// 后者要靠我们自己猜；样式表也只注入一次，不会随行数增长。

import { createStyleSheet } from '../../../../../base/browser/domStylesheets.js';
import { localize } from '../../../../../nls.js';

/** 自研按钮的视觉变体：与原生 Chat 的次按钮/链接按钮对齐。 */
export type DshButtonVariant = 'secondary' | 'link';

/**
 * 自研按钮样式的类名。
 *
 * 不使用内联样式做焦点环：内联样式写不出 `:focus-visible` 伪类。
 * 外观里必须留在内联的部分（`font: inherit` 等依赖父元素）由 `applyDshButtonChrome` 设置，
 * 与模态相关的部分集中在这张表里。
 */
export const DSH_BUTTON_CLASS = 'dsh-button';
export const DSH_BUTTON_LINK_CLASS = 'dsh-button-link';
export const DSH_STATIC_ROW_CLASS = 'dsh-static-row';

let stylesheet: HTMLStyleElement | undefined;

/**
 * 注入自研按钮的共享样式表（幂等）。
 *
 * 用 `var(--vscode-focusBorder)` 与 VS Code 原生控件同一变量：
 * 浅色/深色/高对比度主题下都自动跟随，不写死颜色。
 */
function ensureDshButtonStyles(): void {
	if (stylesheet !== undefined && stylesheet.isConnected) {
		return;
	}
	stylesheet = createStyleSheet(undefined, style => {
		style.textContent = `
			.dsh-button {
				font: inherit;
				cursor: pointer;
				border: none;
				border-radius: 4px;
				padding: 2px 8px;
			}
			.dsh-button-link {
				background: transparent;
				color: var(--vscode-textLink-foreground);
				padding: 0 2px;
			}
			/* border:none 抹掉了默认焦点环，这里补回来。outline 不参与布局，不会推挤相邻元素。 */
			.dsh-button:focus-visible,
			.dsh-button-link:focus-visible {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: 2px;
			}
			.dsh-button:disabled,
			.dsh-static-row {
				cursor: default;
				background: transparent;
				border: none;
				opacity: 1;
			}
		`;
	});
}

/**
 * 把「原生 Chat 次按钮」的基准外观与焦点环装到按钮上。
 *
 * @param button 目标按钮
 * @param variant `secondary` 是常规次按钮（默认），`link` 是纯文字链接按钮（动作条、队列动作）
 */
export function applyDshButtonChrome(button: HTMLButtonElement, variant: DshButtonVariant = 'secondary'): void {
	ensureDshButtonStyles();
	button.type = 'button';
	button.classList.add(DSH_BUTTON_CLASS);
	if (variant === 'link') {
		button.classList.add(DSH_BUTTON_LINK_CLASS);
	} else {
		button.style.background = 'var(--vscode-button-secondaryBackground)';
		button.style.color = 'var(--vscode-button-secondaryForeground)';
	}
}

/**
 * 给不可展开的行头去掉「按钮外观」，保留可访问名。
 *
 * 不这么做的话，一个 `disabled` 的 `button` 仍是「可聚焦、点了没反应」的入口，
 * 违反 §11.2 的交互一致性。
 */
export function applyDshStaticRowChrome(button: HTMLButtonElement): void {
	ensureDshButtonStyles();
	button.classList.add(DSH_STATIC_ROW_CLASS);
	button.disabled = true;
	button.removeAttribute('aria-expanded');
}

/** 动作条的读屏分组名（`role="toolbar"` 必须有可访问名，否则读屏只念「工具栏」）。 */
export function dshToolbarLabel(): string {
	return localize('dsh.toolbar.label', "Actions");
}
