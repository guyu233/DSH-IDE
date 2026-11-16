/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 第二阶段 2-B 翻译层的原生 part 单测（TDD：先写期望，再改实现）。
//
// 覆盖手册 §9.5 阶段 2-B 的可行项：
//   B1 工具：`tool-call` / `tool-result` → `toolInvocationSerialized`（带 simpleToolInvocation 数据）
//   B4 状态错误：`turn-error` → response 级 `errorDetails`
// 同时锁定手册 §9.5 明确判定「不可行、保留降级」的项，防止后来者误把它们换成原生部件：
//   B2 审批 / 问卷保留 `warning + command`（原生 confirmation 只走 sendRequest）
//
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshChatHistoryNative.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toHistory } from '../../../out/vs/workbench/contrib/dsh/browser/dshChatHistory.js';

/** 最小节点来源：只实现 `toHistory` 用到的 `nodes()`。 */
function session(nodes: readonly unknown[]) {
	return { nodes: () => nodes } as never;
}

/** 取最后一条 response。 */
function lastResponse(history: readonly { type: string }[]) {
	const last = history.at(-1);
	assert.ok(last !== undefined && last.type === 'response', 'history must end with a response');
	return last as { type: 'response'; parts: readonly { kind: string; [key: string]: unknown }[]; errorDetails?: { message: string; code?: string; isQuotaExceeded?: boolean } };
}

test('B1: a finished tool result becomes a serialized tool invocation with input/output', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'run' }] },
		{
			kind: 'tool-result', seq: 2, time: 2, callId: 'c1', name: 'read', args: { path: 'a.md' },
			content: [{ type: 'text', text: 'file body' }], isError: false, subCalls: [],
		},
	]));
	const response = lastResponse(history);
	const tool = response.parts.find(part => part.kind === 'toolInvocationSerialized');
	assert.ok(tool !== undefined, 'tool result must render as toolInvocationSerialized, not markdown');
	assert.equal(tool.toolCallId, 'c1');
	assert.equal(tool.toolId, 'read');
	assert.equal(tool.isComplete, true);
	assert.equal(tool.invocationMessage, 'read');
	const data = tool.toolSpecificData as { kind: string; input: string; output: string } | undefined;
	assert.equal(data?.kind, 'simpleToolInvocation');
	assert.ok(data?.output.includes('file body'), 'tool output must reach the native part');
});

test('B1: a running tool call becomes a serialized tool invocation too', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'run' }] },
		{ kind: 'tool-call', seq: 2, time: 2, callId: 'c2', name: 'glob', phase: 'start', argsRaw: '{"pattern":"*.ts"}' },
	]));
	const response = lastResponse(history);
	const tool = response.parts.find(part => part.kind === 'toolInvocationSerialized');
	assert.ok(tool !== undefined);
	assert.equal(tool.toolCallId, 'c2');
	assert.equal(tool.toolId, 'glob');
	// 历史里没有运行中的真实状态：序列化形态只能表达「已结束」，不伪造执行中。
	assert.equal(tool.isComplete, true);
});

test('B1: a failed tool result keeps the error on the native part', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'run' }] },
		{
			kind: 'tool-result', seq: 2, time: 2, callId: 'c3', name: 'read', args: {},
			content: [{ type: 'text', text: 'ENOENT' }], isError: true,
			error: { name: 'ToolError', code: 'ENOENT', reason: 'missing' }, subCalls: [],
		},
	]));
	const response = lastResponse(history);
	const tool = response.parts.find(part => part.kind === 'toolInvocationSerialized');
	assert.ok(tool !== undefined);
	assert.ok(tool.resultError !== undefined, 'isError must surface as resultError');
});

test('B1: sub calls stay visible as nested tool parts instead of being dropped', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'run' }] },
		{
			kind: 'tool-result', seq: 2, time: 2, callId: 'c4', name: 'parent', args: {},
			content: [{ type: 'text', text: 'parent done' }], isError: false,
			subCalls: [{
				kind: 'tool-result', seq: 3, time: 3, callId: 'c4.1', parentCallId: 'c4', name: 'child', args: {},
				content: [{ type: 'text', text: 'child done' }], isError: false, subCalls: [],
			}],
		},
	]));
	const response = lastResponse(history);
	const tools = response.parts.filter(part => part.kind === 'toolInvocationSerialized');
	assert.deepEqual(tools.map(tool => tool.toolCallId), ['c4', 'c4.1']);
});

test('B2: approvals keep command buttons because native confirmation cannot call dsh.answerApproval', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'q' }] },
	]), [{ eventId: 'e-1', kind: 'approval', title: 'DSH 请求运行 shell', options: [] }]);
	const response = lastResponse(history);
	assert.equal(response.parts.some(part => part.kind === 'confirmation'), false,
		'native confirmation sends a new request instead of calling the DSH answer command');
	const commands = response.parts.filter(part => part.kind === 'command') as { command: { id: string; arguments?: readonly unknown[] } }[];
	assert.deepEqual(commands.map(command => command.command.id), ['dsh.answerApproval', 'dsh.answerApproval']);
});

test('B4: a turn error becomes the response errorDetails instead of a markdown quote', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'q' }] },
		{ kind: 'assistant', seq: 2, time: 2, turn: 1, step: 1, blocks: [{ kind: 'text', text: 'partial' }] },
		{ kind: 'turn-error', seq: 3, time: 3, turn: 1, step: 1, message: 'boom', code: 'MODEL_ERROR' },
	]));
	const response = lastResponse(history);
	assert.equal(response.errorDetails?.message, 'boom');
	assert.equal(response.errorDetails?.code, 'MODEL_ERROR');
	const markdown = response.parts.filter(part => part.kind === 'markdownContent') as { content: { value: string } }[];
	assert.equal(markdown.some(part => part.content.value.includes('boom')), false,
		'the error text must not be duplicated as markdown');
});

test('B4: a quota notice marks the response as quota exceeded', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'q' }] },
	]), [], { quotaNotice: { code: 'ACCOUNT_QUOTA', seq: 7 } });
	const response = lastResponse(history);
	assert.equal(response.parts.some(part => part.kind === 'warning'), false,
		'the quota notice must not stay a generic warning');
	assert.equal(response.errorDetails?.isQuotaExceeded, true);
});

test('a running tool call is drawn once even when the assistant block and the tool-call node both exist', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'run' }] },
		{
			kind: 'assistant', seq: 2, time: 2, turn: 1, step: 1,
			blocks: [{ kind: 'tool-call', callId: 'c9', name: 'read', argsRaw: '{}' }],
		},
		{ kind: 'tool-call', seq: 3, time: 3, callId: 'c9', name: 'read', phase: 'start', argsRaw: '{}' },
	]));
	const response = lastResponse(history);
	const tools = response.parts.filter(part => part.kind === 'toolInvocationSerialized');
	assert.equal(tools.length, 1, 'one call must render one card, not two');
});

test('two turn errors in the same response are both preserved instead of overwriting each other', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'run' }] },
		{ kind: 'turn-error', seq: 2, time: 2, turn: 1, step: 1, message: 'first', code: 'E1' },
		{ kind: 'turn-error', seq: 3, time: 3, turn: 2, step: 1, message: 'second', code: 'E2' },
	]));
	const errors = history
		.filter(item => item.type === 'response')
		.map(item => (item as { errorDetails?: { message: string } }).errorDetails?.message);
	assert.deepEqual(errors, ['first', 'second'], 'consecutive failures must not overwrite each other');
});

test('a quota notice does not overwrite a real turn error', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'q' }] },
		{ kind: 'turn-error', seq: 2, time: 2, turn: 1, step: 1, message: 'boom', code: 'MODEL_ERROR' },
	]), [], { quotaNotice: { code: 'ACCOUNT_QUOTA', seq: 3 } });
	const response = lastResponse(history);
	assert.equal(response.errorDetails?.message, 'boom', 'the real error must win over the quota notice');
	assert.equal(response.errorDetails?.isQuotaExceeded, undefined);
	const warnings = response.parts.filter(part => part.kind === 'warning') as { content: { value: string } }[];
	assert.ok(warnings.some(part => part.content.value.includes('额度不足')), 'the quota notice must still be visible');
});
