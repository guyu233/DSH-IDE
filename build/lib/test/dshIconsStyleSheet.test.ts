/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// `iconsStyleSheet.getCSS()` 与图标替换缝的集成单测。
//
// 这条测试补的是「只有纯函数单测时漏掉的真实回归」：替换分支曾直接 `continue`，
// 把 `--vscode-icon-<id>-content` 根变量一起吞掉；而 `style.css` 等地方直接消费
// 这些变量（如 chevron-down），结果那些伪元素会变空。这里用假主题服务驱动
// `getIconsStyleSheet`，断言：
//   1) 命中替换的 codicon 输出 mask 规则，且**仍然**输出 content/font-family 变量；
//   2) 未命中的 codicon 保持原 font 规则，不输出 mask；
//   3) 产品图标主题显式改写的字形不被替换盖掉。
//
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshIconsStyleSheet.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

// `cssValue.className` 用浏览器的全局 `CSS.escape`；node 测试环境没有 DOM，这里补最小实现
// （codicon id 只含字母/数字/短横线，转义规则简单：首字符是数字时加 `\3` 前缀）。
if (globalThis.CSS === undefined) {
	(globalThis as { CSS?: { escape(value: string): string } }).CSS = {
		escape: (value: string) => /^[0-9]/.test(value) ? `\\3${value[0]} ${value.slice(1)}` : value,
	};
}

import { getIconsStyleSheet } from '../../../out/vs/platform/theme/browser/iconsStyleSheet.js';
import { getIconRegistry } from '../../../out/vs/platform/theme/common/iconRegistry.js';
import { registerIconReplacement } from '../../../out/vs/platform/theme/common/iconReplacement.js';

const replacement = (id: string) => id === 'search' ? 'data:image/svg+xml,search' : undefined;

function cssWith(themeService?: unknown): string {
	return String(getIconsStyleSheet(themeService as never).getCSS());
}

test('a replaced codicon emits a mask rule and still publishes its root variables', () => {
	const handle = registerIconReplacement(replacement);
	try {
		const css = cssWith();
		const rule = /\.codicon-search:before \{[^}]*mask: url\('data:image\/svg\+xml,search'\)/.exec(css);
		assert.ok(rule !== null, 'search must be replaced with a mask rule');
		assert.ok(rule[0].includes('width: 1em') && rule[0].includes('height: 1em'));
		assert.ok(rule[0].includes('background-color: currentColor'));
		// 根变量不能被吞：直接消费 --vscode-icon-search-content 的 CSS 仍要有值。
		assert.match(css, /--vscode-icon-search-content: '[^']+';/, 'the content variable must still be published');
		assert.match(css, /--vscode-icon-search-font-family: 'codicon';/, 'the font-family variable must still be published');
	} finally {
		handle.dispose();
	}
});

test('an unmapped codicon keeps the original font rule', () => {
	const handle = registerIconReplacement(replacement);
	try {
		const css = cssWith();
		const rule = /\.codicon-add:before \{[^}]*content: '\\ea60'/.exec(css);
		assert.ok(rule !== null, 'unmapped codicons must keep their font rule');
		assert.equal(/\.codicon-add:before \{[^}]*mask:/.test(css), false, 'unmapped codicons must not get a mask');
	} finally {
		handle.dispose();
	}
});

test('without a registered replacement every codicon keeps its font rule', () => {
	const css = cssWith();
	assert.equal(css.includes('mask: url('), false);
	assert.match(css, /\.codicon-search:before \{[^}]*content:/);
});

test('a product icon theme that rewrites a glyph is not overridden by the replacement', () => {
	const search = getIconRegistry().getIcon('search');
	assert.ok(search !== undefined);
	const themeService = {
		onDidProductIconThemeChange: () => ({ dispose: () => { } }),
		getProductIconTheme: () => ({
			getIcon: (contribution: { id: string }) => contribution.id === 'search'
				? { fontCharacter: '\\e900', font: { id: 'custom-font', definition: { src: [{ format: 'woff', location: { toString: () => 'file:///custom.woff' } }] } } }
				: search.defaults,
		}),
	};
	const handle = registerIconReplacement(replacement);
	try {
		const css = cssWith(themeService);
		assert.equal(/\.codicon-search:before \{[^}]*mask:/.test(css), false, 'the theme glyph must win over the replacement');
		assert.match(css, /\.codicon-search:before \{[^}]*font-family: 'custom-font'/);
	} finally {
		handle.dispose();
	}
});
