/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 图标替换缝的单测：单槽位注册、重复注册抛错、注销后恢复。
//
// 这条缝是全局的（`iconsStyleSheet.getCSS()` 每次生成都会查它），所以「两个产品同时
// 注册」必须立刻暴露，而不是让样式结果依赖模块加载顺序。
//
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshIconReplacement.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getIconReplacement, registerIconReplacement } from '../../../out/vs/platform/theme/common/iconReplacement.js';

test('registering a replacement makes it visible to the style sheet', () => {
	const handle = registerIconReplacement(id => id === 'search' ? 'data:image/svg+xml,x' : undefined);
	try {
		assert.equal(getIconReplacement()?.('search'), 'data:image/svg+xml,x');
		assert.equal(getIconReplacement()?.('close'), undefined);
	} finally {
		handle.dispose();
	}
	assert.equal(getIconReplacement(), undefined, 'dispose must release the slot');
});

test('a second registration fails instead of silently overriding the first', () => {
	const handle = registerIconReplacement(() => undefined);
	try {
		assert.throws(() => registerIconReplacement(() => undefined), /already registered/);
	} finally {
		handle.dispose();
	}
});

test('disposing a stale handle does not clear a newer registration', () => {
	const first = registerIconReplacement(() => 'first');
	first.dispose();
	const second = registerIconReplacement(() => 'second');
	try {
		first.dispose();
		assert.equal(getIconReplacement()?.('x'), 'second');
	} finally {
		second.dispose();
	}
});
