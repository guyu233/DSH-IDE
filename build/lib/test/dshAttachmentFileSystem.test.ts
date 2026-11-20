/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 附件只读文件系统：缓存上限与释放。
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshAttachmentFileSystem.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('dispose releases the attachment read cache', () => {
	// 缓存最多 8 张图片（可能几十 MB）。基类 dispose 不会清，必须显式释放。
	const source = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/dshAttachmentFileSystem.ts', import.meta.url), 'utf8');
	assert.match(source, /override dispose\(\): void \{/, 'the provider must override dispose');
	assert.match(source, /this\._readCache\.clear\(\);/, 'dispose must clear the read cache');
	assert.match(source, /this\._inflight\.clear\(\);/, 'dispose must clear the in-flight map');
});

test('the read cache is bounded', () => {
	const source = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/dshAttachmentFileSystem.ts', import.meta.url), 'utf8');
	assert.match(source, /READ_CACHE_LIMIT = \d+/, 'the cache must have an explicit limit');
	// 超限时必须真的淘汰，不能只声明常量。
	assert.match(source, /while \(this\._readCache\.size > DshAttachmentFileSystemProvider\.READ_CACHE_LIMIT\)/, 'the cache must evict beyond the limit');
});
