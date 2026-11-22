/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// Turn 过程分组：收起时藏过程，出错或未结束时不能收。工具按 parentKey 成树。
// 运行：node --experimental-strip-types --test build/lib/test/dshProcessGroup.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeTurnProcess, groupPositionOf, groupTurnProcesses, hiddenProcessLine, isSubagentDelegationTool, latestExchangeTurns, processActivityOf, processActivityText, processLineFromSnapshot, summarizeProcess, turnProcessAlwaysOpen, visibleProcessKeys, type DshGroupableNode } from '../../../src/vs/workbench/contrib/dsh/browser/vscode/dshProcessGroup.ts';

function node(partial: DshGroupableNode): DshGroupableNode {
	return partial;
}

test('tool names map to the official 14 process activities', () => {
	// 逐条对照官方 `conversation-nodes/process-activity.ts` 的 `activity()`。
	const cases: readonly [string, string][] = [
		['read', 'read'],
		['read_image', 'readImage'],
		['grep', 'search'],
		['glob', 'search'],
		['session_inspect', 'search'],
		['write', 'write'],
		['edit', 'edit'],
		['apply_patch', 'edit'],
		['bash', 'commands'],
		['pwsh', 'commands'],
		['exec_command', 'commands'],
		['write_stdin', 'commands'],
		['terminal_send', 'commands'],
		['run_code', 'code'],
		['cua_run_code', 'code'],
		['web_search', 'webSearch'],
		['web_fetch', 'webFetch'],
		['subagent', 'subagents'],
		['subagent_claude', 'subagents'],
		['todo_write', 'plan'],
		['create_goal', 'plan'],
		['update_goal', 'plan'],
		['get_goal', 'plan'],
		['ask_user_question', 'questions'],
		['request_user_input', 'questions'],
		['unknown_tool', 'tools'],
	];
	for (const [tool, expected] of cases) {
		assert.equal(processActivityOf('tool-call', tool), expected, tool);
	}
	assert.equal(processActivityOf('context', ''), 'context');
	assert.equal(processActivityOf('tool-call', ''), undefined);
	assert.equal(processActivityOf('assistant', 'read'), undefined);
	// 14 类都有本地化文案。
	const all = ['read', 'readImage', 'search', 'write', 'edit', 'commands', 'code', 'webSearch', 'webFetch', 'subagents', 'plan', 'questions', 'tools', 'context'] as const;
	for (const activity of all) {
		assert.equal(processActivityText(activity).length > 0, true, activity);
	}
});

test('the hidden process line uses localized activity names, not enum values', () => {
	// 活动名是内部枚举（`read` / `webSearch`），直接拼给用户等于没本地化。
	const line = hiddenProcessLine([{ kind: 'tool-call', name: 'read', callId: 'c1' }, { kind: 'tool-result', callId: 'c1' }]);
	assert.equal(typeof line, 'string');
	assert.equal(line?.includes('webSearch'), false);
	const webLine = hiddenProcessLine([{ kind: 'tool-call', name: 'web_search', callId: 'c2' }, { kind: 'tool-result', callId: 'c2' }]);
	assert.equal(webLine?.includes('webSearch'), false);
	assert.equal(processActivityText('webSearch').length > 0, true);
});

test('a turn-process node lands in the answer keys and must be skipped when anchoring', () => {
	// `groupPositionOf` 的 default 分支把 `turn-process` 算成 turn 层，于是它进了 answerKeys；
	// 但渲染时会跳过它，锚点必须越过它才能把计数行画出来。
	const groups = groupTurnProcesses([
		node({ key: 'p', kind: 'turn-process', seq: 1, turn: 5 }),
		node({ key: 'a', kind: 'assistant', seq: 2, turn: 5, step: 1 }),
	], new Map([[5, 'completed']]));
	assert.deepEqual(groups[0].answerKeys, ['p', 'a']);
	assert.equal(groupPositionOf('turn-process'), 'turn');
});

test('group position puts tools inside the turn and input outside it', () => {
	assert.equal(groupPositionOf('user'), 'input');
	assert.equal(groupPositionOf('tool-call'), 'process');
	assert.equal(groupPositionOf('assistant'), 'turn');
});

test('a finished turn can hide its process and an open turn cannot', () => {
	assert.equal(turnProcessAlwaysOpen(undefined), true);
	assert.equal(turnProcessAlwaysOpen('error'), true);
	assert.equal(turnProcessAlwaysOpen('aborted'), true);
	assert.equal(turnProcessAlwaysOpen('completed'), false);
	const groups = groupTurnProcesses([
		node({ key: 'u', kind: 'user', seq: 1, turn: 1 }),
		node({ key: 't', kind: 'tool-call', seq: 2, turn: 1 }),
		node({ key: 'a', kind: 'assistant', seq: 3, turn: 1, step: 2 }),
		node({ key: 'u2', kind: 'user', seq: 4, turn: 2 }),
		node({ key: 'tool2', kind: 'tool-result', seq: 5, turn: 2 }),
	], new Map([[1, 'completed']]));
	assert.equal(groups[0].alwaysOpen, false);
	assert.equal(groups[0].answerStep, 2);
	assert.deepEqual(visibleProcessKeys(groups[0], true), ['u', 'a']);
	assert.deepEqual(visibleProcessKeys(groups[0], false), ['u', 't', 'a']);
	assert.equal(groups[1].alwaysOpen, true);
	assert.deepEqual(visibleProcessKeys(groups[1], true), ['u2', 'tool2']);
});

test('interleaved input keeps the tools visible even when collapse is requested', () => {
	const groups = groupTurnProcesses([
		node({ key: 'u', kind: 'user', seq: 1, turn: 4 }),
		node({ key: 't', kind: 'tool-call', seq: 2, turn: 4 }),
		node({ key: 'a', kind: 'assistant', seq: 3, turn: 4, step: 1 }),
		node({ key: 's', kind: 'steering', seq: 4, turn: 4 }),
	], new Map([[4, 'completed']]));
	assert.equal(groups[0].alwaysOpen, true);
	assert.deepEqual(visibleProcessKeys(groups[0], true), ['u', 's', 't', 'a']);
});

test('an error signal keeps the turn open and the signal itself visible', () => {
	const groups = groupTurnProcesses([
		node({ key: 'u', kind: 'user', seq: 1, turn: 3 }),
		node({ key: 't', kind: 'tool-call', seq: 2, turn: 3 }),
		node({ key: 'e', kind: 'turn-error', seq: 3, turn: 3 }),
	]);
	assert.equal(groups[0].alwaysOpen, true);
	assert.deepEqual(visibleProcessKeys(groups[0], true), ['u', 't', 'e']);
});

test('process activity counts stay in their own buckets', () => {
	assert.equal(isSubagentDelegationTool('subagent'), true);
	assert.equal(isSubagentDelegationTool('subagent_fork'), true);
	assert.equal(isSubagentDelegationTool('bash'), false);
	const summary = summarizeProcess([
		{ kind: 'tool-call', name: 'read', running: true },
		{ kind: 'tool-result', name: 'bash' },
		{ kind: 'tool-call', name: 'subagent_fork' },
		{ kind: 'tool-call', name: 'ask_user_question' },
		{ kind: 'context' },
		{ kind: 'assistant' },
	], false);
	assert.equal(summary.counts.read, 1);
	assert.equal(summary.counts.commands, 1);
	assert.equal(summary.counts.subagents, 1);
	assert.equal(summary.counts.questions, 1);
	// 官方 `processActivity`：context 与其它成员混在一起时**不计数**。
	assert.equal(summary.counts.context, undefined);
	assert.equal(summary.running, 1);
	assert.equal(summary.runningDetail, 'read');
	assert.equal(summary.preparing, false);
	assert.equal(summarizeProcess([], false).preparing, true);
	assert.equal(summarizeProcess([], true).preparing, false);
	// 全部成员都是 context 时才报一个 context 类，计成员数。
	assert.equal(summarizeProcess([{ kind: 'context' }, { kind: 'context' }], true).counts.context, 2);
	assert.equal(summarizeProcess([{ kind: 'context' }], true).counts.context, 1);
});

test('a turn spec records anchors and counts an input that arrives after tools', () => {
	const spec = describeTurnProcess([
		node({ key: 'u', kind: 'user', seq: 1, turn: 1 }),
		node({ key: 't', kind: 'tool-call', seq: 2, turn: 1, name: 'subagent' } as DshGroupableNode & { name: string }),
		node({ key: 'a', kind: 'assistant', seq: 4, turn: 1, step: 3 }),
		node({ key: 'u2', kind: 'steering', seq: 5, turn: 1 }),
	]);
	assert.equal(spec.controlAnchorSeq, 1);
	assert.equal(spec.processStartSeq, 2);
	assert.equal(spec.answerAnchorSeq, 4);
	assert.equal(spec.answerStep, 3);
	// 官方 `messageCount` 只数「最终答复之前」的带答复助手消息：这里唯一一条助手就是最终答复，
	// 所以是 0；input 节点不计入 messageCount。
	assert.equal(spec.messageCount, 0);
	// 官方 `toolCallCount` 只数 non-subagent 调用：唯一的工具是 `subagent`，所以是 0。
	assert.equal(spec.toolCallCount, 0);
	assert.equal(spec.subagentCount, 1);
	assert.equal(spec.inlineReasoning, false);
	assert.equal(spec.turnStarted, true);
	// 官方 `turnProcessAlwaysOpen(node)` 用 `location.turn.status === 'open'` 判「还在进行」：
	// 有答复**不等于** Turn 结束。这里既没有 `endReason`（没有 `turn/end`），
	// 就应按「仍在进行」处理——旧断言 `turnClosed === true` 是错的判据，已改。
	assert.equal(spec.turnClosed, false);
	assert.equal(spec.hasExternalProcess, true);
	assert.equal(spec.hasInterleavedInput, true);
});

test('turnClosed only becomes true once the turn has an end reason', () => {
	// 官方判据：`turn.end.data.reason.kind` 存在才算结算；`aborted` / `interrupted` / `error`
	// 仍然不允许整段收起（由 `turnProcessAlwaysOpen` 的另一半负责），但「已结算」这件事本身要看它。
	const base = [
		node({ key: 'u', kind: 'user', seq: 1, turn: 1 }),
		node({ key: 'a', kind: 'assistant', seq: 2, turn: 1, step: 0 }),
	];
	assert.equal(describeTurnProcess(base).turnClosed, false, 'a reply alone does not close the turn');
	const closed = [...base, node({ key: 'p', kind: 'turn-process', seq: 3, turn: 1, endReason: 'completed' } as DshGroupableNode & { endReason: string })];
	assert.equal(describeTurnProcess(closed).turnClosed, true, 'an end reason closes it');
});

test('the collapsed line prefers the turn-process snapshot counts', () => {
	// 文案走 localize：断言形状而不是硬编码英文，避免把「未本地化」当成期望值。
	const line = processLineFromSnapshot({ toolCallCount: 2, subagentCount: 1, messageCount: 3 });
	assert.equal(line?.split(', ').length, 3);
	assert.match(line ?? '', /2/);
	assert.match(line ?? '', /1/);
	assert.match(line ?? '', /3/);
	assert.equal(processLineFromSnapshot({ toolCallCount: 0, subagentCount: 0, messageCount: 2 })?.split(', ').length, 1);
	assert.equal(processLineFromSnapshot({ toolCallCount: 0, subagentCount: 0, messageCount: 0 }), undefined);
});

test('a hidden process becomes one count line and an open call stays marked', () => {
	assert.equal(hiddenProcessLine([
		{ kind: 'tool-call', name: 'read', callId: 'a' },
		{ kind: 'tool-result', name: 'bash', callId: 'b' },
		{ kind: 'tool-call', name: 'grep', callId: 'c' },
	]), 'read 1, commands 1, search 1 · read, grep');
	assert.equal(hiddenProcessLine([{ kind: 'assistant' }]), undefined);
});


test('foldedReplies=final keeps only the final reply, never a tail control', () => {
	// 官方 ui-chat.foldedReplies=final：中间答复随过程一起折起，只留最终答复。
	// 关键陷阱：answerKeys 还含 turn-tail / turn-error 等同为 turn 位置的控件，
	// 用 answerKeys.at(-1) 会取到尾部控件，而不是答复。
	const grouped = groupTurnProcesses([
		node({ key: 'u', kind: 'user', seq: 1, turn: 1 }),
		node({ key: 'a1', kind: 'assistant', seq: 2, turn: 1, step: 0 }),
		node({ key: 't', kind: 'tool-call', seq: 3, turn: 1 }),
		node({ key: 'a2', kind: 'assistant', seq: 4, turn: 1, step: 1 }),
		node({ key: 'tail', kind: 'turn-tail', seq: 5, turn: 1 }),
	], new Map([[1, 'completed']]));
	const group = grouped[0];
	assert.equal(group.alwaysOpen, false, 'a completed turn with replies is foldable');
	// all：答复与控制都在。
	assert.deepEqual([...visibleProcessKeys(group, true, 'all')], ['u', 'a1', 'a2', 'tail']);
	// final：只剩输入与最终答复；turn-tail 不能被当成最终答复留下，中间答复 a1 也折起。
	assert.deepEqual([...visibleProcessKeys(group, true, 'final')], ['u', 'a2']);
	// 展开时两种偏好一致。
	assert.deepEqual([...visibleProcessKeys(group, false, 'final')], ['u', 't', 'a1', 'a2', 'tail']);
});

test('latestExchangeTurns starts at the last turn that admitted human input', () => {
	// 官方「Collapse timing」：一个 exchange 从「第一个 Step 接纳人类输入的 Turn」开始，
	// 包含其后每个 Turn，直到下一个这样的 Turn。
	// 关键：被通知唤醒的 Turn（无 promptKeys）不开新 exchange，不结束前一个的豁免。
	const mk = (turn: number, prompts: string[]) => ({ turn, answerStep: 0, promptKeys: prompts, processKeys: [], answerKeys: [], replyKeys: [], alwaysOpen: false });
	const groups = [mk(1, ['u1']), mk(2, []), mk(3, ['u3']), mk(4, []), mk(5, [])];
	// 最后一个有人类输入的是 turn 3 → exchange 是 [3,4,5]。
	assert.deepEqual([...latestExchangeTurns(groups)], [3, 4, 5]);
	// 没有人类输入时没有 exchange（豁免为空）。
	assert.deepEqual([...latestExchangeTurns([mk(1, []), mk(2, [])])], []);
	// 只有第一个 Turn 有输入时，整个列表都属于同一个 exchange。
	assert.deepEqual([...latestExchangeTurns([mk(1, ['u']), mk(2, []), mk(3, [])])], [1, 2, 3]);
});

test('a repeated callId counts once, so call+result does not double the number', () => {
	// 官方「Activity summaries → Category counts」：Repeated callId —— Count only the first
	// occurrence, including when it appears both as a root and as a nested call.
	// 本仓最容易踩的形态就是 tool-call 与 tool-result：它们是同一次调用的两条节点，都带 name。
	const call = { kind: 'tool-call', name: 'read', callId: 'c1' };
	const result = { kind: 'tool-result', name: 'read', callId: 'c1' };
	const one = summarizeProcess([call, result], true);
	assert.deepEqual(one.counts, { read: 1 }, 'one call must not be counted twice');
	// 不同 callId 的同名工具各自计数。
	const two = summarizeProcess([
		{ kind: 'tool-call', name: 'read', callId: 'c1' },
		{ kind: 'tool-call', name: 'read', callId: 'c2' },
	], true);
	assert.deepEqual(two.counts, { read: 2 });
	// 没有 callId 的节点不去重（无法判定身份时按原样各计一次）。
	const anonymous = summarizeProcess([{ kind: 'tool-call', name: 'read' }, { kind: 'tool-call', name: 'read' }], true);
	assert.deepEqual(anonymous.counts, { read: 2 });
	// 去重是**组内**的：另一个组的同名 callId 不受影响。
	assert.deepEqual(summarizeProcess([{ kind: 'tool-call', name: 'bash', callId: 'c1' }], true).counts, { commands: 1 });
});
