/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 原生 part 适配：文本/思考/工具/引用/错误/配额/任务/树/diff 分开，工具家族的 input 不同。
// 运行：node --experimental-strip-types --import build/lib/test/strip-ts-resolver.mjs --test build/lib/test/dshNativePartAdapters.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adaptDshNode } from '../../../src/vs/workbench/contrib/dsh/browser/vscode/dshNativePartAdapters.ts';
import { DSH_QUOTA_NOTICE_SLOT, DSH_REASONING_BODY_SLOT, DSH_TOOL_VIEW_SLOT, DSH_TURN_TAIL_SLOT, dshChatSlotRegistry, dshQuotaNoticeOverride, dshReasoningBodyOverride, dshToolViewOverride, dshTurnTailExtras } from '../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatSlots.ts';
import type { DshIndexedNode } from '../../../src/vs/workbench/contrib/dsh/browser/vscode/dshConversationNodeTree.ts';

test('a plugin can replace the reasoning body text through its single slot', () => {
	const node = { kind: 'assistant', seq: 90, messageId: 'a9', blocks: [{ kind: 'reasoning', text: '原始思考' }] } as DshIndexedNode;
	const thinking = (sessionId?: string) => {
		const part = adaptDshNode(node, sessionId).find(item => item.part.kind === 'thinking');
		return part?.part.kind === 'thinking' ? part.part.value : undefined;
	};
	assert.equal(thinking('s1'), '原始思考');
	const registration = dshChatSlotRegistry.register(DSH_REASONING_BODY_SLOT, { id: 'redacted', priority: 0, props: { text: '（已折叠的思考）' } });
	try {
		assert.equal(dshReasoningBodyOverride('s1'), '（已折叠的思考）');
		assert.equal(thinking('s1'), '（已折叠的思考）');
		// session 作用域：无会话 id 时不覆盖。
		assert.equal(dshReasoningBodyOverride(undefined), undefined);
		assert.equal(thinking(undefined), '原始思考');
	} finally {
		registration.dispose();
	}
	assert.equal(thinking('s1'), '原始思考');
});

test('a plugin chain can claim a quota code and replace the notice text', () => {
	const quotaNode = { kind: 'turn-error', seq: 80, message: 'out of quota', code: 'QUOTA' } as DshIndexedNode;
	assert.equal(adaptDshNode(quotaNode)[0].part.kind === 'errorDetails' && (adaptDshNode(quotaNode)[0].part as { message: string }).message, 'out of quota');
	assert.equal(dshQuotaNoticeOverride('QUOTA'), undefined);
	const registration = dshChatSlotRegistry.register(DSH_QUOTA_NOTICE_SLOT, {
		id: 'quota-banner',
		select: (owner) => owner.props?.['code'] === 'QUOTA' ? { label: '额度已用尽，请充值后重试', keepOpen: true } : null,
	});
	try {
		assert.deepEqual(dshQuotaNoticeOverride('QUOTA'), { label: '额度已用尽，请充值后重试', keepOpen: true });
		const part = adaptDshNode(quotaNode)[0];
		assert.equal(part.part.kind === 'errorDetails' && (part.part as { message: string; isQuotaExceeded: boolean }).message, '额度已用尽，请充值后重试');
		assert.equal(part.part.kind === 'errorDetails' && (part.part as { isQuotaExceeded: boolean }).isQuotaExceeded, true);
		// 其它 code 不被这条 occupant 认领。
		assert.equal(dshQuotaNoticeOverride('ACCOUNT_QUOTA'), undefined);
	} finally {
		registration.dispose();
	}
	assert.equal(dshQuotaNoticeOverride('QUOTA'), undefined);
});

test('plugins can append lines to a turn tail through the list slot', () => {
	const node = { kind: 'turn-tail', seq: 70, turn: 4, closing: '答复' } as DshIndexedNode;
	assert.equal(adaptDshNode(node, 's1').some(part => part.part.kind === 'dshTurnTailExtra'), false);
	const first = dshChatSlotRegistry.register(DSH_TURN_TAIL_SLOT, { id: 'timing', order: 20, props: { label: '耗时 3.2s' } });
	const second = dshChatSlotRegistry.register(DSH_TURN_TAIL_SLOT, { id: 'tokens', order: 10, props: { label: '输入 1.2k' } });
	try {
		// list 槽按 order 升序：tokens 在前。
		assert.deepEqual(dshTurnTailExtras('s1', 4, 70).map(extra => extra.id), ['tokens', 'timing']);
		const parts = adaptDshNode(node, 's1');
		const extra = parts.find(part => part.part.kind === 'dshTurnTailExtra');
		assert.deepEqual(extra?.part.kind === 'dshTurnTailExtra' ? extra.part.lines : [], ['输入 1.2k', '耗时 3.2s']);
		// 无会话 id 时 session 槽为 unbound，不追加。
		assert.deepEqual(dshTurnTailExtras(undefined, 4, 70), []);
	} finally {
		first.dispose();
		second.dispose();
	}
	assert.deepEqual(dshTurnTailExtras('s1', 4, 70), []);
});

test('a plugin occupant of tool.call.toolview picks the family for an unlisted tool', () => {
	const node = {
		kind: 'tool-call',
		seq: 60,
		callId: 'c1',
		name: 'my_shell',
		args: { command: 'ls' },
	} as DshIndexedNode;
	// 没有 occupant 时按内置分派：未登记名字是 generic。
	assert.equal(adaptDshNode(node, 's1')[0].view, 'generic');
	const registration = dshChatSlotRegistry.register(DSH_TOOL_VIEW_SLOT, {
		id: 'my-shell-view',
		key: 'my_shell',
		props: { view: 'bash' },
	});
	try {
		assert.equal(dshToolViewOverride('my_shell', 's1'), 'bash');
		const adapted = adaptDshNode(node, 's1')[0];
		assert.equal(adapted.view, 'bash');
		assert.equal(adapted.part.kind === 'toolInvocationSerialized' && adapted.part.invocationMessage, '$ ls');
		// 别的工具名与无会话都不受影响。
		assert.equal(adaptDshNode({ kind: 'tool-call', seq: 61, callId: 'c2', name: 'grep', args: {} } as DshIndexedNode, 's1')[0].view, 'search');
		assert.equal(adaptDshNode(node)[0].view, 'generic');
	} finally {
		registration.dispose();
	}
	assert.equal(adaptDshNode(node, 's1')[0].view, 'generic');
});

test('manual-compaction renders the command line and the compaction card, not just the summary', () => {
	// 曾有一处 `compaction || manual-compaction` 的提前分支，把合成节点只画成压缩卡，
	// 命令行被吞掉，后面那条 `manual-compaction` 分支成了死代码。
	const parts = adaptDshNode({
		kind: 'manual-compaction',
		seq: 50,
		command: { commandId: 'cmd-1', name: 'compact', args: '', outcome: { kind: 'success' } },
		compaction: { summary: '摘要', shadowedItemCount: 3 },
	} as DshIndexedNode);
	assert.deepEqual(parts.map(part => part.adapter), ['command', 'compaction']);
	assert.equal(parts[0].part.kind === 'dshCommand' && parts[0].part.name, 'compact');
	assert.equal(parts[1].part.kind === 'dshCompaction' && parts[1].part.summary, '摘要');
});

test('reuse names a renderer that actually exists', () => {
	// 只有原生 part 可以写原生类名；其余必须写回退渲染器，不能编一个 Dsh*ContentPart。
	const nativeParts = new Set(['ChatMarkdownContentPart', 'ChatThinkingContentPart', 'ChatToolInvocationPart', 'ChatTaskContentPart', 'ChatTreeContentPart', 'ChatMultiDiffContentPart', 'ChatQuotaExceededPart', 'ChatErrorContentPart', 'ChatAttachmentsContentPart', 'ChatUsedReferencesListContentPart']);
	const samples: DshIndexedNode[] = [
		{ kind: 'assistant', seq: 1, messageId: 'a', blocks: [{ kind: 'text', text: 'x' }, { kind: 'reasoning', text: 'r' }] },
		{ kind: 'tool-call', seq: 2, callId: 'c', name: 'grep', args: {} },
		{ kind: 'turn-error', seq: 3, message: 'boom', code: 'QUOTA' },
		{ kind: 'compaction', seq: 4, summary: 's' },
		{ kind: 'image', seq: 5, content: [{ type: 'image', attachment: { attachmentId: 'i1', mediaType: 'image/png' } }] },
		{ kind: 'turn-tail', seq: 7, turn: 1, closing: 'c' },
	] as DshIndexedNode[];
	for (const node of samples) {
		for (const part of adaptDshNode(node)) {
			const ok = nativeParts.has(part.reuse) || part.reuse === 'dshSlotHostContentPart:renderAdaptedFallback';
			assert.equal(ok, true, `${node.kind}/${part.adapter} claims reuse "${part.reuse}"`);
		}
	}
});

test('assistant blocks split into markdown and thinking', () => {
	const parts = adaptDshNode({
		kind: 'assistant',
		seq: 2,
		messageId: 'a1',
		blocks: [
			{ kind: 'text', text: 'hello' },
			{ kind: 'reasoning', text: 'because' },
		],
	} as DshIndexedNode);
	assert.deepEqual(parts.map(part => part.adapter), ['markdown', 'thinking']);
	assert.equal(parts[0].reuse, 'ChatMarkdownContentPart');
	assert.equal(parts[1].reuse, 'ChatThinkingContentPart');
	assert.equal(parts[0].part.kind, 'markdownContent');
	assert.equal(parts[1].part.kind, 'thinking');
});

test('bash and grep do not share one generic input', () => {
	const bash = adaptDshNode({
		kind: 'tool-call',
		seq: 3,
		callId: 'b1',
		name: 'bash',
		args: { command: 'npm test' },
	} as DshIndexedNode);
	const grep = adaptDshNode({
		kind: 'tool-result',
		seq: 4,
		callId: 'g1',
		name: 'grep',
		args: { pattern: 'slot' },
		content: [{ type: 'text', text: 'a.ts\nb.ts' }],
	} as DshIndexedNode);
	assert.equal(bash[0].view, 'bash');
	assert.equal(bash[0].part.kind === 'toolInvocationSerialized' && bash[0].part.toolSpecificData.input, 'npm test');
	assert.equal(grep[0].view, 'search');
	assert.equal(grep[0].part.kind === 'toolInvocationSerialized' && grep[0].part.invocationMessage, 'slot');
	assert.equal(grep.some(part => part.adapter === 'tree'), true);
});

test('file mutation lists a diff path and quota uses the quota adapter', () => {
	const edit = adaptDshNode({
		kind: 'tool-call',
		seq: 5,
		callId: 'e1',
		name: 'edit',
		argsRaw: '{"path":"src/a.ts"}',
	} as DshIndexedNode);
	assert.equal(edit.some(part => part.adapter === 'diff' && part.part.kind === 'multiDiffData' && part.part.files[0].path === 'src/a.ts'), true);
	const quota = adaptDshNode({
		kind: 'turn-error',
		seq: 6,
		message: 'out of quota',
		code: 'QUOTA',
	} as DshIndexedNode);
	assert.equal(quota[0].adapter, 'quota');
	assert.equal(quota[0].reuse, 'ChatQuotaExceededPart');
	const file = adaptDshNode({
		kind: 'context',
		seq: 7,
		content: [{ type: 'file', attachment: { name: 'README.md' } }, { type: 'text', text: 'note' }],
	} as DshIndexedNode);
	assert.deepEqual(file.map(part => part.adapter), ['context', 'file']);
	assert.equal(file[0].part.kind === 'dshContext' && file[0].part.text, 'note');
});

test('images, files, compaction and commands are structured cards', () => {
	const image = adaptDshNode({
		kind: 'assistant',
		seq: 9,
		messageId: 'a2',
		blocks: [{ kind: 'image', attachment: { attachmentId: 'img-1', name: 'shot.png', mediaType: 'image/png', width: 12, height: 8 } }],
	} as DshIndexedNode);
	assert.equal(image[0].adapter, 'image');
	assert.equal(image[0].part.kind, 'dshImageGallery');
	assert.equal(image[0].part.kind === 'dshImageGallery' && image[0].part.images[0].name, 'shot.png');
	assert.equal(JSON.stringify(image[0].part).includes('Image:'), false);

	const file = adaptDshNode({
		kind: 'context',
		seq: 10,
		content: [{ type: 'file', attachment: { name: 'README.md', attachmentId: 'f1', bytes: 20 } }, { type: 'text', text: 'note' }],
	} as DshIndexedNode);
	assert.equal(file.some(part => part.adapter === 'file' && part.part.kind === 'dshFileCard'), true);
	assert.equal(JSON.stringify(file.map(part => part.part)).includes('File:'), false);

	const compaction = adaptDshNode({
		kind: 'compaction',
		seq: 11,
		summary: 'short',
		shadowedItemCount: 4,
		shadowedTokenCount: 90,
	} as DshIndexedNode);
	assert.equal(compaction[0].adapter, 'compaction');
	assert.equal(compaction[0].part.kind, 'dshCompaction');
	assert.notEqual(compaction[0].part.kind, 'markdownContent');

	const command = adaptDshNode({
		kind: 'command',
		seq: 12,
		commandId: 'c',
		name: 'goal',
		args: 'ship',
		outcome: { kind: 'success', text: 'ok' },
	} as DshIndexedNode);
	assert.equal(command[0].adapter, 'command');
	assert.equal(command[0].part.kind === 'dshCommand' && command[0].part.args, 'ship');

	const tail = adaptDshNode({
		kind: 'turn-tail',
		seq: 13,
		tokenUsage: { input: 3, output: 5 },
		files: [{ path: 'D:/out/a.ts', description: 'result' }],
	} as DshIndexedNode);
	assert.deepEqual(tail.map(part => part.adapter), ['usage', 'deliverable']);
	assert.equal(tail[0].part.kind === 'dshUsage' && tail[0].part.total, 8);
});

test('usage lives on the turn tail and keeps cache and reasoning tokens', () => {
	// 官方把 TurnUsagePanel 放在 turn tail；助手行不再重复一份用量。
	const assistant = adaptDshNode({
		kind: 'assistant',
		seq: 39,
		messageId: 'a6',
		blocks: [{ kind: 'text', text: '答复' }],
		usage: { inputTokens: 3, outputTokens: 4 },
	} as DshIndexedNode);
	assert.equal(assistant.some(part => part.adapter === 'usage'), false);
	const parts = adaptDshNode({
		kind: 'turn-tail',
		seq: 40,
		turn: 1,
		closing: '答复',
		tokenUsage: { input: 3, output: 4, cacheRead: 5, cacheWrite: 6, reasoning: 7 },
	} as DshIndexedNode);
	const usage = parts.find(part => part.adapter === 'usage');
	assert.equal(usage?.part.kind === 'dshUsage' && usage.part.input, 3);
	assert.equal(usage?.part.kind === 'dshUsage' && usage.part.output, 4);
	assert.equal(usage?.part.kind === 'dshUsage' && usage.part.total, 7);
	assert.equal(usage?.part.kind === 'dshUsage' && usage.part.cacheRead, 5);
	assert.equal(usage?.part.kind === 'dshUsage' && usage.part.cacheWrite, 6);
	assert.equal(usage?.part.kind === 'dshUsage' && usage.part.reasoning, 7);
});

test('a workflow run is a card with phases and member statuses', () => {
	const parts = adaptDshNode({
		kind: 'workflow-run',
		seq: 53,
		runId: 'r1',
		name: 'audit',
		status: 'completed',
		phases: [{ key: 'value:1:a', phase: 'a', members: [{ seq: 1, label: '扫描', childId: 'c1', status: 'completed' }] }],
	} as DshIndexedNode);
	assert.equal(parts[0].adapter, 'workflow-run');
	assert.equal(parts[0].part.kind === 'dshWorkflowRun' && parts[0].part.status, 'completed');
	assert.equal(parts[0].part.kind === 'dshWorkflowRun' && parts[0].part.phases[0].members[0].label, '扫描');
});

test('a submitted plan is a card with its title and markdown', () => {
	const parts = adaptDshNode({ kind: 'submitted-plan', seq: 52, callId: 'call-p', title: '迁移计划', markdown: '# 迁移计划\n先做 A。' } as DshIndexedNode);
	assert.equal(parts[0].adapter, 'submitted-plan');
	assert.equal(parts[0].part.kind === 'dshSubmittedPlan' && parts[0].part.title, '迁移计划');
	assert.equal(parts[0].part.kind === 'dshSubmittedPlan' && parts[0].part.markdown.includes('先做 A'), true);
});

test('a goal command input is its own command line', () => {
	const parts = adaptDshNode({ kind: 'command-input', seq: 51, commandId: 'c1', text: '/goal 完成目标' } as DshIndexedNode);
	assert.equal(parts[0].adapter, 'command-input');
	assert.equal(parts[0].part.kind === 'dshCommandInput' && parts[0].part.text, '/goal 完成目标');
});

test('an answered questionnaire becomes a question-reply card, not a bare tool row', () => {
	const parts = adaptDshNode({
		kind: 'question-reply',
		seq: 50,
		callId: 'call-1',
		questions: [{ id: 'a', question: '继续吗', header: '确认' }, { id: 'b', question: '第二题' }],
		answers: [{ id: 'a', selected: ['继续'] }, { id: 'b', selected: [], custom: '自己写' }],
		text: '{"answers":[]}',
	} as DshIndexedNode);
	assert.equal(parts[0].adapter, 'question-reply');
	assert.equal(parts[0].part.kind === 'dshQuestionReply' && parts[0].part.callId, 'call-1');
	assert.equal(parts.map(part => part.adapter).join(','), 'question-reply');
});

test('a turn tail keeps closing text, usage and files', () => {
	const parts = adaptDshNode({
		kind: 'turn-tail',
		seq: 37,
		closing: '本轮结束',
		branchUnavailable: true,
		tokenUsage: { input: 1, output: 2 },
		files: [{ path: 'D:/out/a.ts' }],
	} as DshIndexedNode);
	assert.deepEqual(parts.map(part => part.adapter), ['turn-tail', 'usage', 'deliverable']);
	assert.equal(parts[0].part.kind === 'dshTurnTail' && parts[0].part.closing, '本轮结束');
	assert.equal(parts[0].part.kind === 'dshTurnTail' && parts[0].part.branchUnavailable, true);
	// 线协议只允许 `branchUnavailable: true`；字符串形式到不了这一层（校验器会拒）。
	assert.equal(adaptDshNode({ kind: 'turn-tail', seq: 38, branchUnavailable: 'no branch' } as unknown as DshIndexedNode).length, 0);
	assert.equal(adaptDshNode({ kind: 'turn-tail', seq: 39 } as DshIndexedNode).length, 0);
});

test('a turn trigger keeps its image and a system prompt keeps its update', () => {
	const trigger = adaptDshNode({
		kind: 'turn-trigger',
		seq: 35,
		content: [{ type: 'text', text: 'done' }, { type: 'image', attachment: { attachmentId: 't1', name: 'shot.png' } }],
		source: { kind: 'subagent-settled' },
	} as DshIndexedNode);
	assert.equal(trigger.map(part => part.adapter).join(','), 'turn-trigger,image');
	assert.equal(trigger[0].part.kind === 'dshTurnTrigger' && trigger[0].part.title, 'Subagent settled: done');
	// 官方 ui-chat「Hidden Chat rows」：Chat 在所有 work-details 模式下都不显示 system-prompt 行，
	// 且过滤在视图层（`fromConversationNode`）而不是投影层。所以这里不再有 system-prompt 适配器：
	// 该节点到不了 `DshChatNode`，`adaptDshNode` 对它返回空。
	const prompt = adaptDshNode({ kind: 'system-prompt', seq: 36, text: '规则', update: '第二条' } as DshIndexedNode);
	assert.deepEqual(prompt, [], 'a system prompt never reaches the chat flow');
});

test('turn triggers keep the source title and drop the quote prefix', () => {
	const settled = adaptDshNode({
		kind: 'turn-trigger',
		seq: 14,
		content: [{ type: 'text', text: 'done' }],
		source: { kind: 'subagent-settled' },
	} as DshIndexedNode);
	assert.equal(settled[0].adapter, 'turn-trigger');
	assert.equal(settled[0].part.kind === 'dshTurnTrigger' && settled[0].part.title, 'Subagent settled: done');
	assert.equal(settled[0].part.kind === 'dshTurnTrigger' && settled[0].part.title.startsWith('>'), false);
	const unknown = adaptDshNode({
		kind: 'turn-trigger',
		seq: 15,
		content: [{ type: 'text', text: 'custom body' }],
		source: { kind: 'acme' },
	} as DshIndexedNode);
	assert.equal(unknown[0].part.kind === 'dshTurnTrigger' && unknown[0].part.title, 'custom body');
	const steering = adaptDshNode({
		kind: 'steering',
		seq: 16,
		content: [{ type: 'text', text: '改口' }],
	} as DshIndexedNode);
	assert.equal(steering[0].part.kind === 'markdownContent' && steering[0].part.content.value, '改口');
});

test('a failed tool keeps the error name, code and reason', () => {
	const parts = adaptDshNode({
		kind: 'tool-result',
		seq: 41,
		callId: 'err',
		name: 'read',
		isError: true,
		error: { name: 'ToolError', code: 'ENOENT', reason: 'missing' },
		content: [],
		subCalls: [],
	} as DshIndexedNode);
	assert.equal(parts[0].part.kind === 'toolInvocationSerialized' && parts[0].part.resultError, 'ToolError: ENOENT: missing');
});

test('a tool result image is a gallery, not dropped text', () => {
	const parts = adaptDshNode({
		kind: 'tool-result',
		seq: 22,
		callId: 'img',
		name: 'read_image',
		args: { path: 'shot.png' },
		content: [{ kind: 'image', attachment: { attachmentId: 'img-9', name: 'shot.png', mediaType: 'image/png' } }],
		isError: false,
		subCalls: [],
	} as DshIndexedNode);
	assert.equal(parts.some(part => part.adapter === 'tool'), true);
	assert.equal(parts.some(part => part.adapter === 'image' && part.part.kind === 'dshImageGallery'), true);
});

test('question, office and skill cards use their own fields', () => {
	const question = adaptDshNode({
		kind: 'tool-result',
		seq: 19,
		callId: 'q',
		name: 'ask_user_question',
		args: { question: '继续吗' },
		content: [],
		isError: false,
		subCalls: [],
	} as DshIndexedNode);
	assert.equal(question[0].part.kind === 'toolInvocationSerialized' && question[0].part.invocationMessage, '继续吗');
	const office = adaptDshNode({
		kind: 'tool-call',
		seq: 20,
		callId: 'o',
		name: 'office_render',
		args: { path: 'D:/a.docx' },
	} as DshIndexedNode);
	assert.equal(office[0].part.kind === 'toolInvocationSerialized' && office[0].part.invocationMessage, 'D:/a.docx');
	const skill = adaptDshNode({
		kind: 'tool-call',
		seq: 21,
		callId: 's',
		name: 'skill',
		args: { name: 'genui' },
	} as DshIndexedNode);
	assert.equal(skill[0].part.kind === 'toolInvocationSerialized' && skill[0].part.invocationMessage, 'genui');
});

test('token limit and inherited history are their own cards', () => {
	const limit = adaptDshNode({ kind: 'turn-max-tokens', seq: 28, turn: 3, step: 2 } as DshIndexedNode);
	assert.equal(limit[0].adapter, 'max-tokens');
	assert.equal(limit[0].part.kind === 'dshMaxTokens' && limit[0].part.turn, 3);
	assert.equal(limit[0].part.kind === 'dshMaxTokens' && limit[0].part.step, 2);
	assert.notEqual(limit[0].part.kind, 'warning');
	const inherited = adaptDshNode({ kind: 'inherited-history', seq: 29 } as DshIndexedNode);
	assert.equal(inherited[0].part.kind, 'dshInheritedHistory');
	assert.equal(JSON.stringify(inherited).includes('> History inherited'), false);
});

test('a model retry keeps its count, delay and failure', () => {
	const parts = adaptDshNode({
		kind: 'model-retry',
		seq: 27,
		retry: 2,
		maxRetries: 4,
		delayMs: 800,
		mode: 'normal',
		retryState: 'scheduled',
		failure: { message: '超时', code: 'TIMEOUT' },
	} as DshIndexedNode);
	assert.equal(parts[0].adapter, 'model-retry');
	assert.equal(parts[0].part.kind === 'dshModelRetry' && parts[0].part.retry, 2);
	assert.equal(parts[0].part.kind === 'dshModelRetry' && parts[0].part.maxRetries, 4);
	assert.equal(parts[0].part.kind === 'dshModelRetry' && parts[0].part.delayMs, 800);
	assert.equal(parts[0].part.kind === 'dshModelRetry' && parts[0].part.message, '超时');
	assert.equal(parts[0].part.kind === 'dshModelRetry' && parts[0].part.code, 'TIMEOUT');
	assert.notEqual(parts[0].part.kind, 'warning');
});

test('assistant meta keeps the provider and an interrupt flag off the body', () => {
	const parts = adaptDshNode({
		kind: 'assistant',
		seq: 25,
		messageId: 'a4',
		blocks: [{ kind: 'text', text: '答案' }],
		providerMetadata: { provider: 'deepseek', model: 'v4' },
		interrupted: true,
	} as DshIndexedNode);
	assert.equal(parts[0].part.kind === 'markdownContent' && parts[0].part.content.value, '答案');
	const meta = parts.find(part => part.adapter === 'assistant-meta');
	assert.equal(meta?.part.kind === 'dshAssistantMeta' && meta.part.provider, 'deepseek');
	assert.equal(meta?.part.kind === 'dshAssistantMeta' && meta.part.model, 'v4');
	assert.equal(meta?.part.kind === 'dshAssistantMeta' && meta.part.interrupted, true);
	const plain = adaptDshNode({
		kind: 'assistant',
		seq: 26,
		messageId: 'a5',
		blocks: [{ kind: 'text', text: '只有正文' }],
	} as DshIndexedNode);
	assert.equal(plain.some(part => part.adapter === 'assistant-meta'), false);
});

test('context keeps the producer and form beside the text', () => {
	const parts = adaptDshNode({
		kind: 'context',
		seq: 24,
		content: [{ type: 'text', text: '目录' }],
		form: 'replay',
		producer: { role: 'host', label: '索引' },
	} as DshIndexedNode);
	assert.equal(parts[0].adapter, 'context');
	assert.equal(parts[0].part.kind === 'dshContext' && parts[0].part.producer, '索引');
	assert.equal(parts[0].part.kind === 'dshContext' && parts[0].part.form, 'replay');
	assert.equal(parts[0].part.kind === 'dshContext' && parts[0].part.text, '目录');
	assert.equal(JSON.stringify(parts[0].part).includes('> Context'), false);
});

test('user and steering keep non-text blocks without repeating the prompt', () => {
	const user = adaptDshNode({
		kind: 'user',
		seq: 33,
		messageId: 'u9',
		content: [{ type: 'text', text: '看看' }, { type: 'plugin', pluginType: 'widget', block: { n: 2 } }],
	} as DshIndexedNode);
	assert.equal(user.some(part => part.adapter === 'markdown'), false);
	assert.equal(user[0].part.kind === 'dshUnknown' && user[0].part.type, 'widget');
	const steering = adaptDshNode({
		kind: 'steering',
		seq: 34,
		content: [{ type: 'text', text: '改口' }, { type: 'image', attachment: { attachmentId: 's1', name: 'a.png' } }],
	} as DshIndexedNode);
	assert.equal(steering.map(part => part.adapter).join(','), 'markdown,image');
});

test('content tool calls, plugin blocks and tool changes keep their real names', () => {
	const tool = adaptDshNode({
		kind: 'context',
		seq: 30,
		content: [{ type: 'tool-call', id: 'call-9', name: 'read', arguments: '{"path":"a.ts"}' }],
	} as DshIndexedNode);
	const toolPart = tool.find(part => part.adapter === 'tool');
	assert.equal(toolPart?.part.kind === 'toolInvocationSerialized' && toolPart.part.toolCallId, 'call-9');
	assert.equal(toolPart?.part.kind === 'toolInvocationSerialized' && toolPart.part.invocationMessage, 'a.ts');
	const plugin = adaptDshNode({
		kind: 'assistant',
		seq: 31,
		messageId: 'a6',
		blocks: [{ kind: 'other', block: { type: 'widget', n: 1 } }],
	} as DshIndexedNode);
	assert.equal(plugin[0].part.kind === 'dshUnknown' && plugin[0].part.type, 'widget');
	const change = adaptDshNode({
		kind: 'context',
		seq: 32,
		content: [{ type: 'tool-removal', toolName: 'bash' }],
	} as DshIndexedNode);
	const removed = change.find(part => part.adapter === 'unknown');
	assert.equal(removed?.part.kind === 'dshUnknown' && removed.part.type, 'tool-removal');
	assert.equal(removed?.part.kind === 'dshUnknown' && removed.part.data.includes('bash'), true);
});

test('an unrecognized assistant block stays as an unknown card', () => {
	const parts = adaptDshNode({
		kind: 'assistant',
		seq: 23,
		messageId: 'a3',
		blocks: [{ kind: 'citation', text: 'src/a.ts' }],
	} as DshIndexedNode);
	assert.equal(parts[0].adapter, 'unknown');
	assert.equal(parts[0].part.kind === 'dshUnknown' && parts[0].part.type, 'citation');
	assert.equal(parts[0].part.kind === 'dshUnknown' && parts[0].part.data.includes('src/a.ts'), true);
});

test('an unknown node stays visible and does not invent a meaning', () => {
	const parts = adaptDshNode({
		kind: 'unknown',
		seq: 17,
		type: 'future-event',
		data: { n: 1 },
	} as DshIndexedNode);
	assert.equal(parts[0].adapter, 'unknown');
	assert.equal(parts[0].part.kind === 'dshUnknown' && parts[0].part.type, 'future-event');
	assert.equal(parts[0].part.kind === 'dshUnknown' && parts[0].part.data, '{"n":1}');
	const huge = adaptDshNode({
		kind: 'unknown',
		seq: 18,
		type: 'blob',
		data: 'x'.repeat(500),
	} as DshIndexedNode);
	assert.equal(huge[0].part.kind === 'dshUnknown' && huge[0].part.data.endsWith('…'), true);
	assert.equal(huge[0].part.kind === 'dshUnknown' && huge[0].part.data.length <= 401, true);
});

test('todo_write becomes a task list', () => {
	const parts = adaptDshNode({
		kind: 'tool-result',
		seq: 8,
		callId: 't1',
		name: 'todo_write',
		args: { todos: [{ content: '写适配' }, { content: '跑测试' }] },
	} as DshIndexedNode);
	const task = parts.find(part => part.adapter === 'task');
	assert.ok(task);
	assert.equal(task.reuse, 'ChatTaskContentPart');
	assert.deepEqual(task.part.kind === 'progressTaskSerialized' ? task.part.items : [], ['写适配', '跑测试']);
});

test('the chat view filters system-prompt instead of the projection', async () => {
	// 官方 ui-chat「Hidden Chat rows」：Chat omits system-prompt rows in every work-details mode,
	// and "The filter changes neither recorded Session events nor Trajectory inspection".
	// 所以过滤必须在视图层（fromConversationNode），投影层仍产出该节点。
	const { readFileSync } = await import('node:fs');
	const view = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatModel.ts', import.meta.url), 'utf8');
	const projection = readFileSync(new URL('../../../src/vs/platform/dshClient/protocol/dshIdeConversation.ts', import.meta.url), 'utf8');
	assert.match(projection, /kind: 'system-prompt'/, 'the projection must keep producing the node (Trajectory still reads it)');
	// 视图层不留这个 kind 的任何构造分支：没有 case 就无从产出 DshChatNode，
	// `fromConversationNode` 的 switch 会落到 default 返回 undefined。
	assert.ok(!view.includes("case 'system-prompt':"), 'the chat view must not build a system-prompt node');
	assert.ok(!view.includes("kind: 'system-prompt', text:"), 'and must not map it into the chat flow');
});

test('hidden command rows follow the official three-way boundary', async () => {
	// 官方 ui-chat「Hidden Chat rows」：隐藏 permission 与成功的 /team on|off 收据；
	// 「failures and commands with missing or unrecognized arguments remain visible」。
	const { isHiddenCommandRow } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshCommandRows.ts');
	const row = (over: Record<string, unknown>) => ({ commandId: 'x', name: null, args: null, outcome: { kind: 'success' }, ...over }) as never;

	// ① permission：按 commandId 或记录名都算。
	assert.equal(isHiddenCommandRow(row({ commandId: 'permission' })), true);
	assert.equal(isHiddenCommandRow(row({ commandId: 'other', name: 'permission' })), true);
	// ② 成功的 /team on|off（参数去空白）。
	assert.equal(isHiddenCommandRow(row({ commandId: 'team', name: 'team', args: 'on' })), true);
	assert.equal(isHiddenCommandRow(row({ commandId: 'team', name: 'team', args: '  off  ' })), true);
	// ③ 失败永远可见——它是用户唯一的错误反馈。
	assert.equal(isHiddenCommandRow(row({ commandId: 'permission', outcome: { kind: 'error' } })), false);
	assert.equal(isHiddenCommandRow(row({ commandId: 'team', name: 'team', args: 'on', outcome: { kind: 'error' } })), false);
	// 参数不可识别时不隐藏（官方明说 remain visible）。
	assert.equal(isHiddenCommandRow(row({ commandId: 'team', name: 'team', args: null })), false);
	assert.equal(isHiddenCommandRow(row({ commandId: 'team', name: 'team', args: '' })), false);
	assert.equal(isHiddenCommandRow(row({ commandId: 'team', name: 'team', args: 'on extra' })), false);
	// 其它命令照常显示。
	assert.equal(isHiddenCommandRow(row({ commandId: 'compact', name: 'compact' })), false);
	assert.equal(isHiddenCommandRow(row({ commandId: 'team', name: 'other', args: 'on' })), false, 'the recorded name decides, not the id alone');
});

test('whitespace-only text and reasoning produce no rows', async () => {
	// 官方「Hidden Chat rows」：Text and reasoning contribute to Assistant visibility
	// only when they contain a **non-whitespace character**。
	// 只判空串会把纯空白块画成空 markdown——流式中换行/缩进很常见。
	const { adaptDshNode } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshNativePartAdapters.ts');
	const assistant = (blocks: readonly { readonly type: string; readonly text?: string }[]) => adaptDshNode({
		kind: 'assistant', seq: 1, blocks,
	} as never);
	// 纯空白（空格 / 换行 / 制表）都不产生行。
	for (const blank of ['', '   ', '\n', '\n\n  \t ']) {
		assert.deepEqual(assistant([{ type: 'text', text: blank }]), [], `text ${JSON.stringify(blank)} must not render`);
		assert.deepEqual(assistant([{ type: 'reasoning', text: blank }]), [], `reasoning ${JSON.stringify(blank)} must not render`);
	}
	// 有非空白字符时正常渲染。
	assert.equal(assistant([{ type: 'text', text: 'x' }]).length, 1);
	assert.equal(assistant([{ type: 'reasoning', text: 'x' }]).length, 1);
});
