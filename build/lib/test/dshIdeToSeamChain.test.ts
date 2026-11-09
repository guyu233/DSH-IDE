/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P4 验收单测：DTO 行 → Chat 渲染内容 → 单接缝接受的**串联**验证。
//
// 为什么单独一条：`dshChatSeamMap.test.ts` 用纯函数复刻接缝语义（因为 seam 依赖 VS Code 深层
// 模块无法离线加载），它证明的是「接缝内部映射对不对」，**不能**证明「我们的 DTO 行真的能进接缝」。
// 本文件验证的是后一段，且**直接调用真实的 `rowToChatContent`**（复刻会让测试自证）：
//   1. DTO 行经 `rowText` 得到展示文本；
//   2. 包成 `markdownContent`（接缝唯一支持的 kind）；
//   3. 用接缝的判定逻辑（`isDshSeamSupportedKind`）确认它会被接管而不是交回原生。
//
// 仍然**不能**替代真机渲染观测（K5 的第 5 章 §6 第 8 项）：这里没有 DOM、没有 React、没有截图。
// 它证明的是「链路两端形状对得上」，不是「屏幕上确实画出来了」。
//
// 运行：node --experimental-strip-types --test build/lib/test/dshIdeToSeamChain.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DshIdeRow } from '../../../src/vs/platform/dshClient/common/dshIdeProtocol.ts';
import { rowToChatContent } from '../../../out/vs/workbench/contrib/dsh/browser/dshChatAgent.js';

/**
 * 接缝是否接管该内容（与 `dshChatSeam.ts:toDshPartProps` 的判定口径一致）：
 * 只有 `thinking` / `markdownContent` / 带 DSH 前缀的 `progressMessage` / `working` 会被接管，
 * 其余（`toolInvocation` / `references` / `command` / …）交回原生。
 */
function isDshSeamSupportedKind(content: { kind: string; id?: string }): boolean {
	if (content.kind === 'thinking' || content.kind === 'markdownContent' || content.kind === 'working') {
		return true;
	}
	if (content.kind === 'progressMessage' && typeof content.id === 'string') {
		return content.id === 'dsh-usage' || content.id.startsWith('dsh-tool:') || content.id.startsWith('dsh-step:');
	}
	return false;
}

/** 真实实现：`dshChatAgent.rowToChatContent`（不是复刻）。 */
const toChatContentReal = rowToChatContent as unknown as (row: DshIdeRow) => { kind: string; content: { value: string; isTrusted: unknown } } | undefined;

function row(overrides: Partial<DshIdeRow> & { id: string }): DshIdeRow {
	return { revision: 1, kind: 'assistant', text: `text-${overrides.id}`, folded: false, ...overrides };
}

test('every renderable DTO row reaches the seam (not bounced to native)', () => {
	for (const kind of ['user', 'assistant', 'tool', 'system', 'notice'] as const) {
		const content = toChatContentReal(row({ id: `${kind}-1`, kind, text: `body-${kind}` }));
		assert.ok(content !== undefined, `${kind} must produce content`);
		assert.equal(isDshSeamSupportedKind(content), true, `${kind} must be taken over by the DSH seam`);
		assert.equal(content.content.value, `body-${kind}`, `${kind} must keep its text through the chain`);
	}
});

test('empty rows never reach the seam', () => {
	const empty = row({ id: 'e1', text: undefined as unknown as string, preview: undefined });
	assert.equal(toChatContentReal(empty), undefined, 'an empty row must be filtered before the seam');
});

test('folded rows carry preview text through to the seam', () => {
	const content = toChatContentReal(row({ id: 'f1', folded: true, preview: 'folded…', text: undefined as unknown as string }));
	assert.equal(content?.content.value, 'folded…');
	assert.equal(isDshSeamSupportedKind(content!), true);
});

test('user rows reach the seam with untrusted markdown; DSH output allows default commands', () => {
	const user = toChatContentReal(row({ id: 'u1', kind: 'user', text: '**x**' }));
	assert.equal(user?.content.isTrusted, false);

	const assistant = toChatContentReal(row({ id: 'a1', kind: 'assistant', text: 'ok' }));
	assert.deepEqual(assistant?.content.isTrusted, { enabledCommands: [] });
});

test('the seam never sees kinds it would bounce back to native', () => {
	// 我们的映射只产 markdownContent；工具行不伪造 toolInvocation（第 8 章 §8.4）。
	const content = toChatContentReal(row({ id: 't1', kind: 'tool', text: 'a.txt' }));
	assert.equal(content?.kind, 'markdownContent');
	assert.equal(isDshSeamSupportedKind(content!), true, 'a plain tool result must not be a native-only kind');
});
