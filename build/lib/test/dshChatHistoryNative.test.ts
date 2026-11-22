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
import { readFileSync } from 'node:fs';
import { toHistory, extrasOf, extrasFingerprint, dshRequestId } from '../../../out/vs/workbench/contrib/dsh/browser/vscode/dshChatHistory.js';
import { DshChatSession } from '../../../out/vs/workbench/contrib/dsh/browser/vscode/dshChatSession.js';

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

test('a steering or turn-trigger row before any user message is kept', () => {
	const history = toHistory(session([
		{ kind: 'steering', seq: 1, time: 1, content: [{ type: 'text', text: '改口' }] },
		{ kind: 'turn-trigger', seq: 2, time: 2, content: [{ type: 'text', text: '子任务完成' }], source: { kind: 'subagent-settled' } },
	]));
	const response = lastResponse(history);
	assert.ok(response !== undefined, 'a steering row before any user message must still open a response');
	const text = JSON.stringify(response.parts);
	assert.equal(text.includes('**Steering:**'), false);
	assert.equal(text.includes('> Subagent'), false);
});

test('turn-trigger labels follow the recorded source kind', () => {
	const cases: readonly (readonly [unknown, string])[] = [
		[{ kind: 'subagent-settled' }, 'Subagent settled'],
		[{ kind: 'agent-message' }, 'Message from another agent'],
		[{ kind: 'retry' }, 'Continuation requested'],
		[{ kind: 'goal' }, 'Goal continuation'],
		[{ kind: 'team-message' }, 'Team message'],
		[{ kind: 'webhook' }, 'Webhook'],
		[{ kind: 'schedule' }, 'Scheduled run'],
		[{ kind: 'tool-jobs' }, 'Background job'],
		[{ kind: 'cordis-host-runner' }, 'Plugin run'],
	];
	for (const [source] of cases) {
		const history = toHistory(session([
			{ kind: 'turn-trigger', seq: 1, time: 1, content: [{ type: 'text', text: 'x' }], source },
		]));
		assert.ok(lastResponse(history) !== undefined, `source ${JSON.stringify(source)} must still open a response`);
		assert.equal(JSON.stringify(history).includes('> '), false);
	}
});

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
	assert.equal(tool.resultError, 'ToolError: ENOENT: missing');
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

test('a plan review also offers Discuss, a plain question does not', () => {
	const plan = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'q' }] },
	]), [{
		eventId: 'plan-1', kind: 'question', title: '批准计划？', options: ['Approve'],
		questions: [{ id: 'p', question: '批准计划？', multiSelect: false, options: [{ label: 'Approve' }], intent: { kind: 'plan-review', approve: 'Approve' } }],
	}]);
	const planCommands = JSON.stringify(lastResponse(plan).parts);
	assert.ok(planCommands.includes('dsh.answerQuestion'));
	assert.ok(planCommands.includes('dsh.discussQuestion'));
	assert.ok(planCommands.includes('Discuss'));
	const plain = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'q' }] },
	]), [{
		eventId: 'q-9', kind: 'question', title: '继续吗', options: ['继续'],
		questions: [{ id: 'a', question: '继续吗', multiSelect: false, options: [{ label: '继续' }] }],
	}]);
	assert.equal(JSON.stringify(lastResponse(plain).parts).includes('dsh.discussQuestion'), false);
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
	assert.equal(response.parts.some(part => part.kind === 'warning' && (part as { content?: { value?: string } }).content?.value === 'DSH 请求运行 shell'), false);
	assert.ok(response.parts.some(part => part.kind === 'progressTaskSerialized'));
	const many = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'q' }] },
	]), [{
		eventId: 'q-2',
		kind: 'question',
		title: '两题',
		options: ['只显示第一题'],
		questions: [
			{ id: 'a', question: '第一题', multiSelect: false, options: [{ label: 'A' }] },
			{ id: 'b', question: '第二题', multiSelect: true, options: [{ label: 'B' }, { label: 'C' }] },
		],
	}]);
	const manyText = JSON.stringify(lastResponse(many).parts);
	assert.equal(manyText.includes('dsh.answerQuestion'), false);
	assert.ok(manyText.includes('第一题: A'));
	assert.ok(manyText.includes('第二题: B, C'));
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
	assert.ok(warnings.some(part => part.content.value.includes('Quota exhausted')), 'the quota notice must still be visible');
});

test('rebuilding the same state twice yields identical history', () => {
	// 面板每帧都重建 history；同一状态重建两次必须完全相同，
	// 否则原生列表会因引用变化而整体重绘（闪烁）。
	const session = new DshChatSession();
	session.acceptView({
		conversation: {
			hasMore: false,
			nodes: [
				{ seq: 1, time: 1, kind: 'user', messageId: 'm1', content: [{ kind: 'text', text: 'hi' }] },
				{ seq: 2, time: 2, kind: 'assistant', messageId: 'm2', turn: 1, step: 1, blocks: [{ kind: 'text', text: 'yo' }] },
			],
		},
		pending: [],
		todos: [{ content: 'a', status: 'pending' }],
	});
	const first = JSON.stringify(toHistory(session, session.pending(), extrasOf(session)));
	const second = JSON.stringify(toHistory(session, session.pending(), extrasOf(session)));
	assert.equal(first, second, 'history must be a pure function of the current state');
	session.dispose();
});

test('an evolving conversation grows without duplicating earlier content', () => {
	// 三帧演进：同一 response 行内累积，旧内容不得重复出现。
	const session = new DshChatSession();
	const user = { seq: 1, time: 1, kind: 'user', messageId: 'm1', content: [{ kind: 'text', text: 'q' }] };
	const a1 = { seq: 2, time: 2, kind: 'assistant', messageId: 'm2', turn: 1, step: 1, blocks: [{ kind: 'text', text: 'part1' }] };
	const a2 = { seq: 3, time: 3, kind: 'assistant', messageId: 'm2', turn: 1, step: 2, blocks: [{ kind: 'text', text: 'part2' }] };
	const frame = (nodes: unknown[]) => ({ conversation: { hasMore: false, nodes }, pending: [] });

	session.acceptView(frame([user]));
	const one = toHistory(session, session.pending(), extrasOf(session));
	session.acceptView(frame([user, a1]));
	const two = toHistory(session, session.pending(), extrasOf(session));
	session.acceptView(frame([user, a1, a2]));
	const three = toHistory(session, session.pending(), extrasOf(session));

	assert.equal(one.length, 2, 'one request + one response');
	assert.equal(two.length, 2, 'the assistant reply merges into the same response');
	assert.equal(three.length, 2, 'later steps keep merging');
	const serialized = JSON.stringify(three);
	assert.equal((serialized.match(/part1/g) ?? []).length, 1, 'part1 must appear exactly once');
	assert.ok(serialized.includes('part2'), 'part2 must be present');
	session.dispose();
});

test('history labels go through localize instead of being hardcoded', () => {
	// 上游生成聊天描述文本时一律走 `localize`（见 `chatSessionDescription.ts`）。
	// 本文件此前 7 处界面标签是裸字符串：换语言时它们不会跟着变，
	// 而同一层其它文件（`dshGoalCommands` / `dshSessionMenu` …）都用 `localize`。
	const source = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatHistory.ts', import.meta.url), 'utf8');
	assert.match(source, /import \{ localize \} from '(?:\.\.\/)+nls\.js';/, 'the history module must import localize');
	for (const key of ['dsh.history.goal', 'dsh.history.todos', 'dsh.history.skills', 'dsh.history.worktrees', 'dsh.history.teamTasks']) {
		assert.ok(source.includes(`'${key}'`), `${key} must be localized`);
	}
	// 标签文字不得再以裸字符串出现在模板里。
	// 只检查**代码行**里「反引号模板直接跟标签」这一形态：
	// `localize` 的 source 参数里出现中文是正常的，注释里提到标签也是正常的。
	const codeLines = source.split(/\r?\n/).filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line));
	for (const raw of ['`目标：', '`待办 ', '`可用技能：', '`工作树 ', '`共享任务 ', '`> 上下文：', '`> 子智能体：', '`**Steering:**']) {
		const hit = codeLines.find(line => line.includes(raw));
		assert.equal(hit, undefined, `the label ${raw} must not be a bare template literal: ${hit ?? ''}`);
	}
});

test('text with files and images is collected in one pass', () => {
	// 用户消息与上下文节点每帧都要过 textWithFiles。原先它走 textOf + fileNames +
	// imageLabels 三次遍历同一份 content；现在必须只遍历一次，且旧的三个辅助函数不再存在。
	const file = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatHistory.ts', import.meta.url), 'utf8');
	assert.doesNotMatch(file, /function fileNames\(/, 'the per-pass helper must be gone');
	assert.doesNotMatch(file, /function imageLabels\(/, 'the per-pass helper must be gone');
	assert.match(file, /function fileNameOf\(attachment: unknown\)/, 'name extraction must be per-block');
	assert.match(file, /function imageLabelOf\(attachment: unknown\)/, 'label extraction must be per-block');
	// 有正文时，附件不进正文：附件由该段 slot host 的画廊/文件卡渲染，
	// 拼进 prompt 就是「用文本模拟附件」，且会与画廊重复。
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [
			{ type: 'text', text: '看看这个' },
			{ type: 'file', attachment: { name: 'notes.md' } },
			{ type: 'image', attachment: { name: 'shot.png' } },
		] },
	]));
	const prompt = (history[0] as { prompt?: string }).prompt ?? '';
	assert.equal(prompt, '看看这个');
	assert.equal(prompt.includes('notes.md'), false, 'attachments are rendered by the gallery, not the prompt');
	assert.equal(prompt.includes('shot.png'), false, 'attachments are rendered by the gallery, not the prompt');
	assert.equal(prompt.includes('File:'), false);
	assert.equal(prompt.includes('Image:'), false);
	// 正文为空时仍需非空 prompt，否则原生 request 连同附件一起消失。
	const imageOnly = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'image', attachment: { name: 'shot.png' } }] },
	]));
	assert.equal((imageOnly[0] as { prompt?: string }).prompt, 'shot.png');
});

test('localized history labels still render the same text', () => {
	// `localize` 在没有翻译时原样返回 source，所以输出必须与改造前逐字一致，
	// 且不得残留 `{0}` 这类未替换的占位符。
	const session = new DshChatSession();
	session.acceptView({
		conversation: {
			hasMore: false,
			nodes: [
				{ seq: 1, time: 1, kind: 'user', messageId: 'm1', content: [{ kind: 'text', text: 'q' }] },
				{ seq: 2, time: 2, kind: 'assistant', messageId: 'm2', turn: 1, step: 1, blocks: [{ kind: 'text', text: 'a' }] },
			],
		},
		pending: [],
		todos: [{ content: 'x', status: 'completed' }, { content: 'y', status: 'pending' }],
		goal: { goal: { objective: 'obj', phase: 'active' }, roundsStarted: 3 },
		skills: [{ name: 'sk1' }],
		worktrees: [{ path: '/p', branch: 'b', created: false }],
		team: { enabled: true, tasks: [{ id: 't', subject: 's', status: 'completed', ready: true }] },
	});
	const text = JSON.stringify(toHistory(session, session.pending(), extrasOf(session)));
	// 目标阶段是内核枚举（active/paused/blocked/complete），必须翻成中文标签再拼进句子；
	// 其余标签保持逐字一致，且不得残留 `{0}` 这类未替换的占位符。
	for (const expected of ['Goal: obj (In progress, 3 rounds so far)', 'Todos 1/2', 'Available skills: sk1', 'Worktrees: 1 — b (inherited)', 'Shared tasks 1/1']) {
		assert.ok(text.includes(expected), `history must contain ${expected}`);
	}
	assert.ok(!/\{\d+\}/.test(text), 'no placeholder may survive interpolation');
	session.dispose();
});

test('approval, plan and quota texts are localized too', () => {
	// 上一轮只覆盖了「目标/待办/技能/工作树/共享任务/上下文/子智能体」。
	// 同一文件里还有审批标题、允许/拒绝按钮、计划状态、额度提示——同样是用户直接读到的文字。
	const source = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatHistory.ts', import.meta.url), 'utf8');
	for (const key of ['dsh.history.quotaExceeded', 'dsh.history.planPending', 'dsh.history.planActive', 'dsh.history.planOff', 'dsh.history.allow', 'dsh.history.reject']) {
		assert.ok(source.includes(`'${key}'`), `${key} must be localized`);
	}
	const sessionSource = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatSession.ts', import.meta.url), 'utf8');
	for (const key of ['dsh.pending.approvalTitle', 'dsh.pending.approvalTitleWithReason']) {
		assert.ok(sessionSource.includes(`'${key}'`), `${key} must be localized`);
	}
	// 这两处不得再以裸模板出现。
	assert.ok(!/`DSH 请求运行 \$\{/.test(sessionSource), 'the approval title must not be a bare template');
	assert.equal(source.includes('> Context compacted'), false, 'compaction must not stay a markdown quote');
	assert.equal(source.includes('> This turn reached the token limit'), false, 'the token limit must not stay a markdown quote');
	assert.equal(source.includes('> Model retry'), false, 'model retry must not stay a markdown quote');
	assert.equal(source.includes('> History inherited'), false, 'inherited history must not stay a markdown quote');
	assert.ok(!/title: 'Allow'/.test(source), 'the allow button label must not be a bare string');
});

test('localized approval and plan texts still render the same words', () => {
	const session = new DshChatSession();
	session.acceptView({
		conversation: { hasMore: false, nodes: [{ seq: 1, time: 1, kind: 'user', messageId: 'm1', content: [{ kind: 'text', text: 'q' }] }] },
		pending: [{ eventId: 'e1', event: 'approval/request', request: { toolName: 'bash', reason: '需要执行' } }],
		plan: { active: true, pending: true },
		quotaNotice: { code: 'insufficient' },
	});
	const text = JSON.stringify(toHistory(session, session.pending(), extrasOf(session)));
	for (const expected of ['Plan mode (waiting for confirmation)', 'DSH requests to run bash: 需要执行', 'Quota exhausted (insufficient)', 'Allow', 'Reject']) {
		assert.ok(text.includes(expected), `history must contain ${expected}`);
	}
	assert.ok(!/\{\d+\}/.test(text), 'no placeholder may survive interpolation');
	session.dispose();
});

test('an image reference stays on the turn that sent it', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: '看图' }, { type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png' } }] },
		{ kind: 'assistant', seq: 2, time: 2, blocks: [{ kind: 'text', text: '看到了' }] },
		{ kind: 'user', seq: 3, time: 3, content: [{ type: 'text', text: '下一句' }] },
		{ kind: 'assistant', seq: 4, time: 4, blocks: [{ kind: 'text', text: '好' }] },
	]), [], { sessionId: 's-1', attachments: [{ attachmentId: 'att-1', mediaType: 'image/png' }] });
	const responses = history.filter(item => item.type === 'response');
	assert.equal(responses.length, 2);
	// 用户消息的图片由该段 slot host 的 `dshImageGallery` 画（官方只有一个 user.images 席位），
	// history 不再同时产出 `dsh-attachment:` reference，否则同一张图会显示两次。
	const all = JSON.stringify(history);
	assert.ok(!all.includes('dsh-attachment'), `history must not duplicate user images: ${all}`);
	// prompt 里仍会带附件名（`textWithFiles` 的行为），但不再有可点击的 attachment URI。
	assert.ok(!all.includes('dsh-attachment://'), `history must not mint attachment URIs: ${all}`);
});

test('an image-only user message is not an empty prompt', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'image', attachment: { attachmentId: 'att-9', mediaType: 'image/png', name: 'shot.png' } }] },
	]), [], { sessionId: 's-1' });
	const request = history.find(item => item.type === 'request') as { prompt: string } | undefined;
	assert.ok(request !== undefined, 'the image must still open a request');
	assert.equal(request.prompt, 'shot.png');
	// 图片本身由 slot host 的画廊画，history 里不再重复引用。
	assert.ok(!JSON.stringify(history).includes('att-9'), 'the image must not be duplicated into history');
});

test('a file attachment stays visible and is not given an openable URI', () => {
	// 官方 readFileStream 默认拒绝，本机 provider 没有实现。编 URI 会变成点开即失败。
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'file', attachment: { attachmentId: 'file-1', name: 'notes.txt', bytes: 4 } }] },
		{ kind: 'assistant', seq: 2, time: 2, blocks: [{ kind: 'text', text: '收到' }] },
	]), [], { sessionId: 's-1' });
	const request = history.find(item => item.type === 'request') as { prompt: string } | undefined;
	assert.ok(request !== undefined, 'the file must still open a request');
	assert.equal(request.prompt, 'notes.txt');
	assert.ok(!JSON.stringify(history).includes('dsh-attachment'), 'a file must not be disguised as an openable attachment');
});

test('an image without a session id is not given a URI', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'image', attachment: { attachmentId: 'att-2', mediaType: 'image/png' } }] },
	]), [], {});
	assert.ok(!JSON.stringify(history).includes('dsh-attachment'), 'missing session id must not invent an attachment URI');
});

test('extras fingerprint tracks displayed content, not only counts', () => {
	const base = { sessionId: 's1' };
	const todosA = { ...base, todos: [{ content: 'write docs', status: 'pending' }] };
	const todosB = { ...base, todos: [{ content: 'write tests', status: 'pending' }] };
	assert.notEqual(extrasFingerprint(todosA), extrasFingerprint(todosB), 'same count, different todo text must rebuild');

	const teamA = { ...base, team: { enabled: true, tasks: [{ id: 't1', subject: 'a', status: 'pending', ready: true }] } };
	const teamB = { ...base, team: { enabled: true, tasks: [{ id: 't1', subject: 'a', status: 'completed', ready: false }] } };
	assert.notEqual(extrasFingerprint(teamA), extrasFingerprint(teamB), 'same task count, different task state must rebuild');

	const quotaA = { ...base, quotaNotice: { code: 'QUOTA', seq: 1 } };
	const quotaB = { ...base, quotaNotice: { code: 'QUOTA', seq: 2 } };
	assert.notEqual(extrasFingerprint(quotaA), extrasFingerprint(quotaB), 'a newer quota notice must rebuild');
});

test('request ids are stable across rebuilds and derived from DSH identity', () => {
	assert.equal(dshRequestId({ kind: 'user', seq: 3, messageId: 'm1', turn: 1 }), 'dsh:m1');
	assert.equal(dshRequestId({ kind: 'user', seq: 3, messageId: 'm1', turn: 1 }), dshRequestId({ kind: 'user', seq: 3, messageId: 'm1', turn: 1 }));
	assert.equal(dshRequestId({ kind: 'user', seq: 7, turn: 2 }), 'dsh:2:7');
	// 同一节点在不同数组位置必须得到同一个 id；不含时间戳，避免每次刷新换身份。
	assert.equal(dshRequestId({ kind: 'user', seq: 7, turn: 2 }), dshRequestId({ kind: 'user', seq: 7, turn: 2 }));
});
