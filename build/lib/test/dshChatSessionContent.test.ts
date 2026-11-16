/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// `dsh` 会话内容提供者的节点 → 原生 history 映射单测。
// 这是「选中会话后消息不显示」的补齐点：断言用户消息开 request、助手内容进 response。
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshChatSessionContent.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toHistory } from '../../../out/vs/workbench/contrib/dsh/browser/dshChatHistory.js';

/** 最小节点来源：只实现 `toHistory` 用到的 `nodes()`。 */
function session(nodes: readonly unknown[]) {
	return { nodes: () => nodes } as never;
}

function markdownText(part: unknown): string | undefined {
	if (part !== null && typeof part === 'object' && (part as { kind?: string }).kind === 'markdownContent') {
		const content = (part as { content?: { value?: unknown } }).content;
		return typeof content?.value === 'string' ? content.value : undefined;
	}
	return undefined;
}

test('a user message opens a request and the assistant reply fills its response', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 10, content: [{ type: 'text', text: '你好' }] },
		{ kind: 'assistant', seq: 2, time: 11, turn: 1, step: 1, blocks: [{ kind: 'text', text: '你好，有什么可以帮你？' }] },
	]));
	assert.equal(history.length, 2);
	assert.equal(history[0].type, 'request');
	assert.equal(history[1].type, 'response');
	if (history[0].type === 'request') {
		assert.equal(history[0].prompt, '你好');
		assert.equal(history[0].timestamp, 10);
	}
	if (history[1].type === 'response') {
		assert.equal(markdownText(history[1].parts[0]), '你好，有什么可以帮你？');
	}
});

test('multiple turns produce one request/response pair each', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'q1' }] },
		{ kind: 'assistant', seq: 2, time: 2, turn: 1, step: 1, blocks: [{ kind: 'text', text: 'a1' }] },
		{ kind: 'user', seq: 3, time: 3, content: [{ type: 'text', text: 'q2' }] },
		{ kind: 'assistant', seq: 4, time: 4, turn: 2, step: 1, blocks: [{ kind: 'text', text: 'a2' }] },
	]));
	assert.deepEqual(history.map(item => item.type), ['request', 'response', 'request', 'response']);
	const prompts = history.filter(item => item.type === 'request').map(item => (item as { prompt: string }).prompt);
	assert.deepEqual(prompts, ['q1', 'q2']);
});

test('tool results and errors are rendered instead of dropped', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'run' }] },
		{ kind: 'tool-result', seq: 2, time: 2, callId: 'c1', name: 'read', args: {}, content: [{ type: 'text', text: 'file body' }], isError: false, subCalls: [] },
		{ kind: 'turn-error', seq: 3, time: 3, turn: 1, step: 1, message: 'boom' },
	]));
	const response = history[1];
	assert.equal(response.type, 'response');
	if (response.type === 'response') {
		// 工具结果现在是原生 toolInvocationSerialized（2-B B1），不再是 markdown；错误走 response.errorDetails。
		const tool = response.parts.find(part => part.kind === 'toolInvocationSerialized') as { toolSpecificData?: { output?: string } } | undefined;
		assert.ok(tool?.toolSpecificData?.output?.includes('file body'));
		assert.equal(response.errorDetails?.message, 'boom');
	}
});

test('reasoning blocks become thinking parts', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'q' }] },
		{ kind: 'assistant', seq: 2, time: 2, turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: 'thinking...' }] },
	]));
	const response = history[1];
	if (response.type === 'response') {
		const thinking = response.parts.find(part => (part as { kind?: string }).kind === 'thinking');
		assert.ok(thinking !== undefined);
		assert.equal((thinking as { value?: string }).value, 'thinking...');
	}
});

test('content without a leading user message still produces a visible response', () => {
	const history = toHistory(session([
		{ kind: 'inherited-history', seq: 1, time: 1 },
	]));
	assert.equal(history.length, 2);
	assert.equal(history[0].type, 'request');
	assert.equal(history[1].type, 'response');
});

test('an empty session has no history', () => {
	assert.deepEqual(toHistory(session([])), []);
});

test('pending approvals merge into the last response as warning plus approve/reject commands', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'q' }] },
		{ kind: 'assistant', seq: 2, time: 2, turn: 1, step: 1, blocks: [{ kind: 'text', text: 'a' }] },
	]), [{ eventId: 'e-1', kind: 'approval', title: 'DSH 请求运行 shell', options: [] }]);
	// 待决议卡并进最后一条 response（不能单开陈旧 response，否则按钮被禁用）。
	assert.equal(history.length, 2);
	const last = history.at(-1);
	assert.equal(last?.type, 'response');
	if (last?.type === 'response') {
		assert.equal((last.parts[0] as { kind: string }).kind, 'markdownContent');
		assert.ok(last.parts.some(part => (part as { kind: string }).kind === 'warning'));
		const commands = last.parts.filter(part => (part as { kind: string }).kind === 'command') as { command: { id: string; title: string; arguments?: readonly unknown[] } }[];
		assert.deepEqual(commands.map(c => c.command.title), ['允许', '拒绝']);
		assert.deepEqual(commands[0].command.arguments, ['e-1', 'approve']);
		assert.deepEqual(commands[1].command.arguments, ['e-1', 'reject']);
	}
});

test('pending questions render one command per option', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'q' }] },
	]), [{ eventId: 'q-1', kind: 'question', title: '继续吗', options: ['继续', '停止'], questionId: 'q1' }]);
	const last = history.at(-1);
	if (last?.type === 'response') {
		const commands = last.parts.filter(part => (part as { kind: string }).kind === 'command') as { command: { id: string; title: string; arguments?: readonly unknown[] } }[];
		assert.deepEqual(commands.map(c => c.command.title), ['继续', '停止']);
		assert.ok(commands.every(c => c.command.id === 'dsh.answerQuestion'));
	}
});

test('pending on an empty session still gets its own response', () => {
	const history = toHistory(session([]), [{ eventId: 'e-9', kind: 'approval', title: '空会话审批', options: [] }]);
	assert.equal(history.length, 1);
	assert.equal(history[0].type, 'response');
});

test('no pending items adds no extra history rows', () => {
	assert.deepEqual(toHistory(session([]), []), []);
});

test('deliverables render as clickable file references', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'q' }] },
	]), [], {
		deliverables: [{ turn: 1, callId: 'p1', files: [{ path: 'docs/a.md', description: '说明' }, { path: 'docs/b.md' }] }],
	});
	const last = history.at(-1);
	assert.equal(last?.type, 'response');
	if (last?.type === 'response') {
		const refs = last.parts.filter(part => part.kind === 'reference') as { reference: string }[];
		assert.deepEqual(refs.map(ref => ref.reference), ['docs/a.md', 'docs/b.md']);
	}
});

test('quota notice is a response-level quota error and todos stay visible', () => {
	const history = toHistory(session([]), [], {
		quotaNotice: { code: 'ACCOUNT_QUOTA', seq: 5 },
		todos: [
			{ content: '写测试', status: 'completed' },
			{ content: '跑门禁', status: 'in_progress' },
		],
	});
	const response = history.find(item => item.type === 'response');
	assert.ok(response !== undefined && response.type === 'response');
	if (response?.type === 'response') {
		// 2-B B4：额度提示升级为 response.errorDetails.isQuotaExceeded（带原生配额升级入口）。
		assert.equal(response.errorDetails?.isQuotaExceeded, true);
		assert.equal(response.parts.some(part => part.kind === 'warning'), false);
		const markdown = response.parts.filter(part => part.kind === 'markdownContent') as { content: { value: string } }[];
		assert.ok(markdown.some(part => part.content.value.includes('[x] 写测试')));
		assert.ok(markdown.some(part => part.content.value.includes('[-] 跑门禁')));
	}
});

test('plan and goal state are visible in the transcript', () => {
	const history = toHistory(session([]), [], {
		plan: { active: true, pending: false },
		goal: { goal: { objective: '完成手册', phase: 'active' }, roundsStarted: 3 },
	});
	const response = history.find(item => item.type === 'response');
	if (response?.type === 'response') {
		const infos = response.parts.filter(part => part.kind === 'info') as { content: { value: string } }[];
		assert.ok(infos.some(part => part.content.value.includes('计划模式已启用')));
		assert.ok(infos.some(part => part.content.value.includes('完成手册') && part.content.value.includes('3 轮')));
	}
});
