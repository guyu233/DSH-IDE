/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 审批 / 问卷 / 计划必须整份结算。缺题和 discuss 都不能变成半份答案。
// 运行：node --experimental-strip-types --test build/lib/test/dshPendingSettlement.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { questionUsesSingleClick, settleApproval, settleQuestion, type DshSettlementQuestion } from '../../../src/vs/workbench/contrib/dsh/browser/vscode/dshPendingSettlement.ts';

const questions: readonly DshSettlementQuestion[] = [
	{ id: 'q1', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] },
	{ id: 'q2', multiSelect: true, options: [{ label: 'X' }, { label: 'Y' }] },
];

test('a full draft submits once and a missing question does not', () => {
	const full = settleQuestion(questions, [
		{ id: 'q1', selected: ['A'] },
		{ id: 'q2', selected: ['Y', 'X'] },
	]);
	assert.deepEqual(full?.answers.map(item => item.selected), [['A'], ['Y', 'X']]);
	assert.equal(settleQuestion(questions, [{ id: 'q1', selected: ['A'] }]), undefined);
	assert.equal(settleQuestion(questions, [
		{ id: 'q1', selected: ['A'] },
		{ id: 'q2', selected: ['nope'] },
	]), undefined);
	assert.equal(settleQuestion(questions, [
		{ id: 'q1', selected: ['A', 'B'] },
		{ id: 'q2', selected: ['X'] },
	]), undefined);
});

test('custom text answers a single-select question that has no picked option', () => {
	const answered = settleQuestion(questions, [
		{ id: 'q1', selected: [], custom: '  other  ' },
		{ id: 'q2', selected: ['X'] },
	]);
	assert.equal(answered?.answers[0].custom, 'other');
	assert.equal(settleQuestion(questions, [
		{ id: 'q1', selected: [], custom: '   ' },
		{ id: 'q2', selected: ['X'] },
	]), undefined);
	assert.deepEqual(settleQuestion([questions[1]], [{ id: 'q2', selected: [], custom: 'only custom' }]), { answers: [{ id: 'q2', selected: [], custom: 'only custom' }] });
});

test('only a single-select question can use one command button', () => {
	assert.equal(questionUsesSingleClick([{ id: 'q', multiSelect: false, options: [{ label: 'A' }] }]), true);
	assert.equal(questionUsesSingleClick([
		{ id: 'q1', multiSelect: false, options: [{ label: 'A' }] },
		{ id: 'q2', multiSelect: false, options: [{ label: 'B' }] },
	]), false);
	assert.equal(questionUsesSingleClick([{ id: 'q', multiSelect: true, options: [{ label: 'A' }] }]), false);
	assert.equal(questionUsesSingleClick([{ id: 'q', multiSelect: false, options: [] }]), false);
});

test('approval keeps a trimmed reason and rejects always as a wire decision', () => {
	assert.deepEqual(settleApproval('approve', '  because  '), { decision: 'approve', reason: 'because' });
	assert.deepEqual(settleApproval('reject', '   '), { decision: 'reject' });
	assert.equal(settleApproval('always'), undefined);
});

