/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 第二阶段 2-D 的单测：DSH 图标资源与 codicon 映射表。
//
// 只测纯数据与纯函数（不碰 DOM / 主题服务）：
//   - 生成物必须与官方 artwork 一致（防手改、防漂移）；
//   - 映射表里的每个 glyph 都必须真实存在（防 `mask: url(undefined)`）；
//   - 未映射的 codicon 必须返回 undefined（混合状态，不伪造图标）。
//
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshIconArtwork.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DSH_ICON_DATA_URIS } from '../../../out/vs/workbench/contrib/dsh/browser/dshIconDataUris.js';
import { DSH_CODICON_GLYPH_MAP, dshIconDataUri, resolveDshGlyph } from '../../../out/vs/workbench/contrib/dsh/browser/dshCodiconMap.js';

test('the generated icon table covers the official artwork set', () => {
	assert.equal(Object.keys(DSH_ICON_DATA_URIS).length, 104, 'official ICON_ARTWORK has 104 glyphs');
	assert.ok(DSH_ICON_DATA_URIS['search-outline'] !== undefined);
});

test('every data URI is an inline svg mask source', () => {
	for (const [glyph, uri] of Object.entries(DSH_ICON_DATA_URIS)) {
		assert.ok(uri.startsWith('data:image/svg+xml,'), `${glyph} must be an inline svg data uri`);
		assert.equal(uri.includes('\''), false, `${glyph} must not contain a single quote (it would break the CSS url)`);
		assert.equal(uri.includes('#'), false, `${glyph} must not contain a raw # (it would become a fragment)`);
	}
});

test('every mapped glyph exists in the generated table', () => {
	const missing = Object.entries(DSH_CODICON_GLYPH_MAP)
		.filter(([, glyph]) => DSH_ICON_DATA_URIS[glyph] === undefined)
		.map(([codicon, glyph]) => `${codicon}->${glyph}`);
	assert.deepEqual(missing, [], 'the map must not point at glyphs that do not exist');
});

test('dshIconDataUri resolves mapped codicons and leaves the rest alone', () => {
	assert.ok(dshIconDataUri('search')?.startsWith('data:image/svg+xml,'));
	assert.equal(resolveDshGlyph('search'), 'search-outline');
	// 未映射：DSH 没有语义对应的 glyph，保留 codicon（混合状态）。
	assert.equal(dshIconDataUri('debug-alt'), undefined);
	assert.equal(dshIconDataUri('not-a-real-codicon'), undefined);
});
