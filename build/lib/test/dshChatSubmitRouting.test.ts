/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 层 4 发送分流的单测：只有注册了 content provider 的会话类型才走 provider 的 submit，
// 普通原生会话必须继续走 chatService.sendRequest；provider 会话拿不到内容对象时**不得**
// 改走原生链路，也不能静默丢弃附件。
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshChatSubmitRouting.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * 复刻 `ChatWidget._dshSubmitTarget` 的判定顺序（见 chatWidget.ts）。
 *
 * 三种结果互斥：`native`（没有 content provider）、`provider`（有会话对象）、
 * `unavailable`（本该由 provider 发送但拿不到对象）。
 */
function routeToContentProvider(
	sessionType: string,
	contentProviderSchemes: readonly string[],
	content: { submit?: unknown } | Error,
): 'provider' | 'native' | 'unavailable' {
	if (!contentProviderSchemes.includes(sessionType)) {
		return 'native';
	}
	if (content instanceof Error) {
		// 拿不到 content 是 provider 侧不可用，不是「这条会话用原生链路」。
		return 'unavailable';
	}
	return typeof content.submit === 'function' ? 'provider' : 'unavailable';
}

/**
 * 复刻 `ChatWidget.collectDshImageAttachments`：只放行已入库的图片引用。
 *
 * 未入库的图片没有 `attachmentId`，伪造一个会把未入库的图当成已入库提交，
 * 所以必须进 `rejected` 由调用方明确拒绝。
 */
function splitDshImages(entries: readonly { readonly kind: string; readonly _meta?: Record<string, unknown> }[]) {
	const refs: unknown[] = [];
	const rejected: { readonly kind: string }[] = [];
	for (const entry of entries) {
		if (entry.kind !== 'image') {
			continue;
		}
		const candidate = entry._meta?.['dshImageAttachment'] as Record<string, unknown> | undefined;
		const mediaType = candidate?.['mediaType'];
		const usable = candidate !== undefined
			&& typeof candidate['attachmentId'] === 'string' && candidate['attachmentId'] !== ''
			&& typeof candidate['bytes'] === 'number'
			&& typeof candidate['width'] === 'number' && typeof candidate['height'] === 'number'
			&& (mediaType === 'image/png' || mediaType === 'image/jpeg' || mediaType === 'image/webp' || mediaType === 'image/gif');
		usable ? refs.push(candidate) : rejected.push(entry);
	}
	return { refs, rejected };
}

test('a session type with a content provider routes to provider submit', () => {
	assert.equal(routeToContentProvider('dsh', ['dsh'], { submit: async () => true }), 'provider');
});

test('a native session type keeps the original sendRequest path', () => {
	assert.equal(routeToContentProvider('local', ['dsh'], { submit: async () => true }), 'native');
});

test('a provider session without submit is reported unavailable, never rerouted', () => {
	assert.equal(routeToContentProvider('dsh', ['dsh'], {}), 'unavailable');
});

test('a failing content lookup is reported unavailable, never rerouted', () => {
	// 改走原生链路等于把这次发送交给另一个内核：用户会以为消息发到了当前会话。
	assert.equal(routeToContentProvider('dsh', ['dsh'], new Error('boom')), 'unavailable');
});

test('an ingested image reference reaches the DSH submit as-is', () => {
	const ref = { attachmentId: 'att-1', mediaType: 'image/png', bytes: 12, width: 4, height: 3, name: 'a.png' };
	const { refs, rejected } = splitDshImages([{ kind: 'image', _meta: { dshImageAttachment: ref } }, { kind: 'file' }]);
	assert.deepEqual({ refs, rejected }, { refs: [ref], rejected: [] });
});

test('an image without an ingested reference is rejected instead of silently dropped', () => {
	// 原生图片条目只有 URI/字节，没有入库 id：不能凭空造一个提交上去。
	const { refs, rejected } = splitDshImages([
		{ kind: 'image' },
		{ kind: 'image', _meta: { dshImageAttachment: { attachmentId: '', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } } },
		{ kind: 'image', _meta: { dshImageAttachment: { attachmentId: 'att-2', mediaType: 'image/bmp', bytes: 1, width: 1, height: 1 } } },
	]);
	assert.deepEqual(refs, []);
	assert.equal(rejected.length, 3, 'every unsupported image must be reported to the caller');
});
