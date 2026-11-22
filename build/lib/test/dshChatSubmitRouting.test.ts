/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 层 4 发送分流的单测：只有注册了 content provider 的会话类型才走 provider 的 submit，
// 普通原生会话必须继续走 chatService.sendRequest；provider 会话拿不到内容对象时**不得**
// 改走原生链路，也不能静默丢弃附件。
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshChatSubmitRouting.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dshImagePayload, dshUnsentAttachmentNames } from '../../../src/vs/workbench/contrib/dsh/browser/vscode/dshImagePayload.ts';

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

test('files and folders block send, tools do not', () => {
	assert.deepEqual(dshUnsentAttachmentNames([
		{ kind: 'file', name: 'notes.md' },
		{ kind: 'directory', name: 'src' },
		{ kind: 'image', name: 'a.png' },
		{ kind: 'tool', name: 'bash' },
		{ kind: 'implicit' },
	]), ['notes.md', 'src']);
	assert.deepEqual(dshUnsentAttachmentNames([{ kind: 'paste' }]), ['paste']);
	assert.deepEqual(dshUnsentAttachmentNames([{ kind: 'string', name: '选区' }]), ['选区']);
	assert.deepEqual(dshUnsentAttachmentNames([{ kind: 'implicit', name: 'open.ts', enabled: true }]), ['open.ts']);
	assert.deepEqual(dshUnsentAttachmentNames([{ kind: 'implicit', name: 'open.ts', enabled: false }]), []);
	assert.deepEqual(dshUnsentAttachmentNames([]), []);
});

test('a dragged image without a media type is still a payload', () => {
	// 拖进输入框的文件名经常是「Image from URL」，条目上没有 mimeType。
	// 只看声明会把发送取消；字节头必须能认出 png。
	const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x01]);
	const payload = dshImagePayload({ value: png, name: 'Image from URL' });
	assert.equal(payload?.mediaType, 'image/png');
	assert.equal(payload?.data, png);
});

test('jpeg bytes win over a wrong declared png type', () => {
	const jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]);
	assert.equal(dshImagePayload({ value: jpeg, mimeType: 'image/png', name: 'a.png' })?.mediaType, 'image/jpeg');
});

test('a named file without a header still uses the extension', () => {
	const bytes = new Uint8Array([1, 2, 3, 4]);
	assert.equal(dshImagePayload({ value: bytes, name: 'shot.jpg' })?.mediaType, 'image/jpeg');
	assert.equal(dshImagePayload({ value: bytes, mimeType: 'image/jpg' })?.mediaType, 'image/jpeg');
});

test('bmp and empty bytes are not a payload', () => {
	assert.equal(dshImagePayload({ value: new Uint8Array([0x42, 0x4D, 0x00]), mimeType: 'image/bmp', name: 'a.bmp' }), undefined);
	assert.equal(dshImagePayload({ value: new Uint8Array(0), mimeType: 'image/png' }), undefined);
	assert.equal(dshImagePayload({ value: { buffer: new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) } })?.mediaType, 'image/gif');
});

test('a DSH submit clears only the session that started it', async () => {
	const widget = readFileSync(new URL('../../../src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts', import.meta.url), 'utf8');
	// 发送是异步的：期间用户可能已经切到另一个会话。清稿必须以发起时的会话为准，
	// 只看草稿文本无法区分「同一草稿」和「另一个会话里恰好相同的内容」。
	assert.match(widget, /const ownedSessionResource = this\.viewModel\?\.sessionResource;/, 'the submit must capture the source session');
	assert.match(widget, /const stillSameSession = ownedSessionResource === undefined\s*\n\s*\|\| isEqual\(this\.viewModel\?\.sessionResource, ownedSessionResource\)/, 'cleanup must compare the current session with the source session');
	assert.match(widget, /if \(!stillSameSession\) \{\s*\n\s*options\?\.onRequestAccepted\?\.\(\);\s*\n\s*return;/, 'a switched session must be left untouched');
});

test('send and open paths keep the payload and the single read', () => {
	const widget = readFileSync(new URL('../../../src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts', import.meta.url), 'utf8');
	assert.match(widget, /return dshImagePayload\(entry\)/, 'image bytes must go through the shared payload helper');
	const resolve = readFileSync(new URL('../../../src/vs/workbench/contrib/chat/browser/attachments/chatAttachmentResolveService.ts', import.meta.url), 'utf8');
	assert.match(resolve, /mimeType: image\.mimeType/, 'picked files must keep their media type on the chat entry');
	const drag = readFileSync(new URL('../../../src/vs/workbench/contrib/chat/browser/widget/chatDragAndDrop.ts', import.meta.url), 'utf8');
	assert.match(drag, /file\.name !== '' \? file\.name : createDisplayName\(\)/, 'a dropped file must keep its own name');
	assert.match(drag, /mimeType\.startsWith\('image\/'\)/, 'a dropped file must forward its media type');
	const fs = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshAttachmentFileSystem.ts', import.meta.url), 'utf8');
	assert.match(fs, /private readonly _readCache = new Map/, 'the read cache must hold more than one image');
	assert.match(fs, /READ_CACHE_LIMIT = 8/, 'the cache must stay bounded');
	assert.match(fs, /private _remember\(key: string, data: Uint8Array\)/, 'inserts must evict the oldest entry');
	assert.match(fs, /this\._readCache\.delete\(key\);\s*\n\s*this\._readCache\.set\(key, cached\)/, 'a hit must refresh LRU order');
	assert.match(fs, /private readonly _inflight = new Map/, 'concurrent reads of one attachment must share one Host transfer');
	assert.match(fs, /const pending = this\._inflight\.get\(key\)/, 'an in-flight read must be reused instead of re-requested');
	assert.match(fs, /this\._inflight\.delete\(key\)/, 'a settled read must leave the in-flight map');
	assert.match(fs, /decodeBase64\(base64\)/, 'bad base64 must be decoded without atob');
	assert.doesNotMatch(fs, /atob\(/, 'atob throws on malformed bytes and takes down the viewer');
});

test('a DSH submit holds one in-flight lock and clears only the owned draft', () => {
	const widget = readFileSync(new URL('../../../src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts', import.meta.url), 'utf8');
	// 锁必须在附件入库之前生效：只包住 submit() 不能阻止同一份草稿被编码、上传两次。
	const providerBlock = widget.slice(widget.indexOf("if (target.kind === 'provider') {"), widget.indexOf('result = await this.chatService.sendRequest'));
	assert.match(providerBlock, /if \(this\._dshSubmitInFlight\) \{\s*\n\s*return undefined;/, 'a second submit while one is in flight must be refused');
	assert.match(providerBlock, /this\._dshSubmitInFlight = true;[\s\S]*finally \{\s*\n\s*this\._dshSubmitInFlight = false;/, 'the lock must be released in a finally');
	const saveAt = providerBlock.indexOf('target.session.saveImage');
	const lockAt = providerBlock.indexOf('this._dshSubmitInFlight = true');
	assert.ok(lockAt >= 0 && lockAt < saveAt, 'the lock must cover attachment ingestion, not just the RPC');
	// 清草稿必须绑定这一次的输入模型、文本与附件，而不是「控件当前的草稿」。
	assert.match(widget, /const ownedInputModel = this\.viewModel\?\.model\.inputModel;/, 'the submit must capture the source input model');
	assert.match(widget, /const ownedText = requestInputs\.input;/, 'the submit must capture the sent text');
	assert.match(widget, /const ownedAttachments = \[\.\.\.this\.input\.attachmentModel\.attachments\];/, 'the submit must capture the attachment snapshot');
	// 判定已抽成共享模块（fork 与 DSH 提交共用）；这里钉住调用点用的是它，
	// 具体「文本+附件都要一致」的规则由 draftOwnership.test.ts 覆盖。
	assert.match(widget, /isOwnedDraftUnchanged\(ownedInputModel, ownedText, ownedAttachments\)/, 'cleanup must use the shared owned-draft check');
	const ownership = readFileSync(new URL('../../../src/vs/workbench/contrib/chat/browser/widget/input/draftOwnership.ts', import.meta.url), 'utf8');
	assert.match(ownership, /state\.inputText === text && structuralEquals\(state\.attachments \?\? \[\], attachments\)/, 'ownership must compare text and attachments');
});
