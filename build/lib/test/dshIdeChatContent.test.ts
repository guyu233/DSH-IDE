/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P4 验收单测：DTO → Chat 渲染内容适配层。
//
// 守护点：
//   - 所有可渲染行都映射为 `markdownContent`（接缝唯一支持的 kind），不伪造 toolInvocation；
//   - 用户消息与 DSH 输出使用不同的 `isTrusted` 策略；
//   - 不可渲染行被跳过，顺序保持；
//   - `rowUiKey` 携带 revision，内容变化时键变化（增量刷新可复用）。
//
// 运行：node --experimental-strip-types --test build/lib/test/dshIdeChatContent.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DshIdeRow } from '../../../src/vs/platform/dshClient/common/dshIdeProtocol.ts';
import {
	rowProjectsToDshSeam,
	rowToChatContent,
	rowsToChatContent,
	rowUiKey,
} from '../../../out/vs/workbench/contrib/dsh/browser/dshIdeChatContent.js';

function row(overrides: Partial<DshIdeRow> & { id: string }): DshIdeRow {
	return { revision: 1, kind: 'assistant', text: `text-${overrides.id}`, folded: false, ...overrides };
}

test('maps renderable rows to markdownContent with their text', () => {
	for (const kind of ['user', 'assistant', 'tool', 'system', 'notice'] as const) {
		const content = rowToChatContent(row({ id: `${kind}-1`, kind, text: `body-${kind}` }));
		assert.equal(content?.kind, 'markdownContent', `${kind} must render as markdownContent`);
		const markdown = (content as { content: { value: string } }).content;
		assert.equal(markdown.value, `body-${kind}`, `${kind} must keep its text`);
	}
});

test('never fabricates richer kinds the seam cannot back', () => {
	for (const kind of ['user', 'assistant', 'tool', 'system', 'notice'] as const) {
		const content = rowToChatContent(row({ id: `x-${kind}`, kind }));
		assert.ok(content !== undefined);
		assert.equal(content.kind, 'markdownContent', 'tool rows must not pretend to be toolInvocation');
	}
});

test('user messages are not trusted while DSH output allows default command policy', () => {
	const user = rowToChatContent(row({ id: 'u1', kind: 'user', text: '**not markdown**' })) as { content: { isTrusted?: unknown } };
	assert.equal(user.content.isTrusted, false, 'user text must not be trusted as markdown');

	const assistant = rowToChatContent(row({ id: 'a1', kind: 'assistant', text: 'ok' })) as { content: { isTrusted?: unknown } };
	assert.deepEqual(assistant.content.isTrusted, { enabledCommands: [] }, 'assistant output runs no commands by default');
});

test('folded rows expose preview text', () => {
	const content = rowToChatContent(row({ id: 'f1', folded: true, preview: 'folded…', text: undefined as unknown as string }));
	const markdown = (content as { content: { value: string } }).content;
	assert.equal(markdown.value, 'folded…');
});

test('rows without text produce no content and are skipped in bulk', () => {
	const empty = row({ id: 'e1', text: undefined as unknown as string, preview: undefined });
	assert.equal(rowToChatContent(empty), undefined);
	const content = rowsToChatContent([
		row({ id: 'u1', kind: 'user', text: 'q' }),
		empty,
		row({ id: 'a1', kind: 'assistant', text: 'a' }),
	]);
	assert.equal(content.length, 2, 'the empty row must be skipped');
	assert.deepEqual(
		content.map(c => (c as { content: { value: string } }).content.value),
		['q', 'a'],
		'order must follow the snapshot',
	);
});

test('rowUiKey changes with revision so updates invalidate and unchanged rows reuse', () => {
	assert.equal(rowUiKey(row({ id: 'a1', revision: 2 })), 'a1#2');
	assert.notEqual(rowUiKey(row({ id: 'a1', revision: 2 })), rowUiKey(row({ id: 'a1', revision: 3 })));
	assert.equal(rowUiKey(row({ id: 'a1', revision: 2 })), rowUiKey(row({ id: 'a1', revision: 2 })));
});

test('rowProjectsToDshSeam mirrors renderability', () => {
	assert.equal(rowProjectsToDshSeam(row({ id: 'a1', text: 'x' })), true);
	assert.equal(rowProjectsToDshSeam(row({ id: 'e1', text: undefined as unknown as string, preview: undefined })), false);
});

test('bulk projection of an empty list is empty', () => {
	assert.deepEqual(rowsToChatContent([]), []);
});
