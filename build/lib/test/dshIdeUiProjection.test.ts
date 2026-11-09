/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P4 验收单测：行的展示文本提取（`rowText`）。
//
// 守护点：折叠行用 `preview`（全文已被投影器移出快照，第 2 章 E10）；非折叠行用 `text`；
// 两者皆无时返回 undefined（调用方据此跳过空行，不产生空壳）。
//
// 运行：node --experimental-strip-types --test build/lib/test/dshIdeUiProjection.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DshIdeRow } from '../../../src/vs/platform/dshClient/common/dshIdeProtocol.ts';
import { rowText } from '../../../out/vs/workbench/contrib/dsh/browser/dshIdeUiProjection.js';

function row(overrides: Partial<DshIdeRow> & { id: string }): DshIdeRow {
	return { revision: 1, kind: 'assistant', text: `text-${overrides.id}`, folded: false, ...overrides };
}

test('unfolded rows expose their text', () => {
	assert.equal(rowText(row({ id: 'a1', text: 'body' })), 'body');
});

test('folded rows expose their preview, not the evicted full text', () => {
	assert.equal(rowText(row({ id: 'f1', folded: true, preview: 'short…', text: undefined as unknown as string })), 'short…');
});

test('folded rows without preview fall back to whatever text remains', () => {
	assert.equal(rowText(row({ id: 'f2', folded: true, preview: undefined, text: 'still here' })), 'still here');
});

test('rows with neither text nor preview have no display text', () => {
	assert.equal(rowText(row({ id: 'e1', text: undefined as unknown as string, preview: undefined })), undefined);
});
