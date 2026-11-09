/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P4 验收单测：DTO → UI 投影层（`DshIdeRow` → `DshUiPart`）。
//
// 守护点：
//   - 四种 kind 的映射与 sidecar 的 `DshPartProps` 对齐；
//   - 折叠行用 `preview` 而不是已移出的全文；
//   - 只有最后一个 assistant 行是 streaming；
//   - 无文本的行不产生空壳部件；
//   - `canReuseUiNode` 与消费者的 revision diff 口径一致。
//
// 运行：node --experimental-strip-types --test build/lib/test/dshIdeUiProjection.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DshIdeRow } from '../../../src/vs/platform/dshClient/common/dshIdeProtocol.ts';
import {
	canReuseUiNode,
	isRenderableRow,
	projectRowToUi,
	projectRowsToUi,
	rowText,
} from '../../../src/vs/workbench/contrib/dsh/browser/dshIdeUiProjection.ts';

function row(overrides: Partial<DshIdeRow> & { id: string }): DshIdeRow {
	return { revision: 1, kind: 'assistant', text: `text-${overrides.id}`, folded: false, ...overrides };
}

test('maps each row kind to the matching UI part', () => {
	assert.deepEqual(projectRowToUi(row({ id: 'u1', kind: 'user', text: 'hi' })), { kind: 'user', content: { text: 'hi' } });
	assert.deepEqual(projectRowToUi(row({ id: 'a1', kind: 'assistant', text: 'ok' })), {
		kind: 'markdown',
		blocks: [{ type: 'text', text: 'ok' }],
	});
	// 工具 / 系统 / 通知都用 markdown 文本呈现（工具行保留 VS Code 原生组件，不伪造 ToolRow）。
	assert.deepEqual(projectRowToUi(row({ id: 't1', kind: 'tool', text: 'a.txt' })), { kind: 'markdown', blocks: [{ type: 'text', text: 'a.txt' }] });
	assert.deepEqual(projectRowToUi(row({ id: 's1', kind: 'system', text: 'sys' })), { kind: 'markdown', blocks: [{ type: 'text', text: 'sys' }] });
	assert.deepEqual(projectRowToUi(row({ id: 'n1', kind: 'notice', text: 'note' })), { kind: 'markdown', blocks: [{ type: 'text', text: 'note' }] });
});

test('folded rows render their preview, not the evicted full text', () => {
	const folded = row({ id: 'f1', folded: true, preview: 'short…', text: undefined as unknown as string });
	assert.equal(rowText(folded), 'short…');
	assert.deepEqual(projectRowToUi(folded)?.kind, 'markdown');
});

test('a folded row without preview falls back to whatever text remains', () => {
	const folded = row({ id: 'f2', folded: true, preview: undefined, text: 'still here' });
	assert.equal(rowText(folded), 'still here');
});

test('rows with neither text nor preview are not renderable', () => {
	const empty = row({ id: 'e1', text: undefined as unknown as string, preview: undefined });
	assert.equal(rowText(empty), undefined);
	assert.equal(isRenderableRow(empty), false);
	assert.equal(projectRowToUi(empty), undefined);
});

test('marks only the last assistant row as streaming', () => {
	const rows = [
		row({ id: 'a1', kind: 'assistant', text: 'first' }),
		row({ id: 't1', kind: 'tool', text: 'tool' }),
		row({ id: 'a2', kind: 'assistant', text: 'second' }),
	];
	const parts = projectRowsToUi(rows);
	const byId = new Map(parts.map(p => [p.row.id, p.part]));
	assert.equal((byId.get('a1') as { streaming?: boolean }).streaming, undefined, 'older assistant rows are complete');
	assert.equal((byId.get('a2') as { streaming?: boolean }).streaming, true, 'only the newest assistant row streams');
	assert.equal((byId.get('t1') as { streaming?: boolean }).streaming, undefined);
});

test('projectRowsToUi preserves snapshot order and skips empty rows', () => {
	const rows = [
		row({ id: 'u1', kind: 'user', text: 'q' }),
		row({ id: 'e1', text: undefined as unknown as string, preview: undefined }),
		row({ id: 'a1', kind: 'assistant', text: 'a' }),
	];
	assert.deepEqual(projectRowsToUi(rows).map(p => p.row.id), ['u1', 'a1']);
});

test('canReuseUiNode follows the revision-based diff rule', () => {
	const before = row({ id: 'a1', revision: 2 });
	assert.equal(canReuseUiNode(before, row({ id: 'a1', revision: 2 })), true);
	assert.equal(canReuseUiNode(before, row({ id: 'a1', revision: 3 })), false, 'a revision bump must refresh the node');
	assert.equal(canReuseUiNode(before, row({ id: 'a2', revision: 2 })), false, 'different ids never reuse');
});

test('projecting an empty row list yields an empty result', () => {
	assert.deepEqual(projectRowsToUi([]), []);
});
