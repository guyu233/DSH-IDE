/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 层 4 发送分流的单测：只有注册了 content provider 的会话类型才走 provider 的 submit，
// 普通原生会话必须继续走 chatService.sendRequest。
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshChatSubmitRouting.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

/** 复刻 `ChatWidget._dshSessionContentForSubmit` 的判定顺序（见 chatWidget.ts）。 */
function routeToContentProvider(
	sessionType: string,
	contentProviderSchemes: readonly string[],
	content: { submit?: unknown } | Error,
): 'provider' | 'native' {
	if (!contentProviderSchemes.includes(sessionType)) {
		return 'native';
	}
	if (content instanceof Error) {
		// 拿不到 content 就退回原生链路，不把一次发送变成硬失败。
		return 'native';
	}
	return typeof content.submit === 'function' ? 'provider' : 'native';
}

test('a session type with a content provider routes to provider submit', () => {
	assert.equal(routeToContentProvider('dsh', ['dsh'], { submit: async () => true }), 'provider');
});

test('a native session type keeps the original sendRequest path', () => {
	assert.equal(routeToContentProvider('local', ['dsh'], { submit: async () => true }), 'native');
});

test('a provider session without submit falls back to the native path', () => {
	assert.equal(routeToContentProvider('dsh', ['dsh'], {}), 'native');
});

test('a failing content lookup falls back instead of hard-failing the send', () => {
	assert.equal(routeToContentProvider('dsh', ['dsh'], new Error('boom')), 'native');
});
