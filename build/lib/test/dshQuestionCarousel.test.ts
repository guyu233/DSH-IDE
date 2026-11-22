/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 官方 transpile 后运行；只测内存模型与提交适配，不操作 GUI 或真实 DSH 会话。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toDshCarouselQuestions, fromDshCarouselAnswers, usesDshQuestionCarousel } from '../../../out/vs/workbench/contrib/dsh/browser/vscode/dshQuestionCarouselAdapter.js';
import { DshQuestionCarouselController } from '../../../out/vs/workbench/contrib/dsh/browser/vscode/dshQuestionCarouselController.js';
import { settleQuestion } from '../../../out/vs/workbench/contrib/dsh/browser/vscode/dshPendingSettlement.js';
import { attachDshQuestions, dshSlotHostSame } from '../../../out/vs/workbench/contrib/dsh/browser/vscode/dshSlotHostModel.js';
import { validateDshIdeInput } from '../../../out/vs/platform/dshClient/protocol/dshIdeProtocol.js';

const questions = [
	{ id: 'one', header: 'Mode', question: 'Choose', detail: 'Details', options: [{ label: 'A (Recommended)', description: 'First' }, { label: 'B' }], multiSelect: false },
	{ id: 'many', question: 'Select several', options: [{ label: 'X' }, { label: 'Y' }], multiSelect: true },
	{ id: 'text', question: 'Your explanation', options: [], multiSelect: false },
	{ id: 'skip', question: 'Optional', options: [], multiSelect: false },
];
const pending = [{ eventId: 'request', kind: 'question', questions }];

test('native question schema preserves every question and wire label without defaults', () => {
	const native = toDshCarouselQuestions(questions);
	assert.deepEqual(native.map(item => item.type), ['singleSelect', 'multiSelect', 'text', 'text']);
	assert.equal(native[0].title, 'Mode');
	assert.equal(native[0].message, 'Choose');
	assert.equal(native[0].description, 'Details');
	assert.equal(native[0].options[0].value, 'A (Recommended)');
	assert.ok(native[0].options[0].label.includes('First'));
	assert.equal(native.every(item => item.defaultValue === undefined && item.allowFreeformInput), true);
	assert.equal(usesDshQuestionCarousel(pending[0]), true);
	assert.equal(usesDshQuestionCarousel({ kind: 'approval', questions }), false);
	assert.equal(usesDshQuestionCarousel({ kind: 'question', questions: [{ ...questions[0], intent: { kind: 'plan-review', approve: 'A' } }] }), false);
});

test('native results settle all IDs once, multi-select custom and explicit skip survive the wire validator', () => {
	const draft = fromDshCarouselAnswers(questions, new Map([
		['one', { selectedValue: 'A (Recommended)' }],
		['many', { selectedValues: ['Y', 'X'], freeformValue: ' extra ' }],
		['text', ' explanation '],
	]));
	const answer = settleQuestion(questions, draft);
	assert.deepEqual(answer, { answers: [
		{ id: 'one', selected: ['A (Recommended)'] },
		{ id: 'many', selected: ['Y', 'X'], custom: 'extra' },
		{ id: 'text', selected: [], custom: 'explanation' },
		{ id: 'skip', selected: [] },
	] });
	assert.doesNotThrow(() => validateDshIdeInput('answerQuestion', { requestId: 'request', answer }));
	assert.equal(settleQuestion(questions, draft.slice(1)), undefined);
	assert.equal(settleQuestion([{ ...questions[0], id: 'dup' }, { ...questions[0], id: 'dup' }], [{ id: 'dup', selected: ['B'] }, { id: 'other', selected: ['B'] }]), undefined);
	assert.equal(settleQuestion([questions[0]], [{ id: 'one', selected: [], custom: '  ' }]), undefined);
	assert.equal(settleQuestion([questions[0]], [{ id: 'one', selected: ['B'], skipped: true }]), undefined);
	assert.deepEqual(settleQuestion([questions[1]], [{ id: 'many', selected: [], custom: 'only custom' }]), { answers: [{ id: 'many', selected: [], custom: 'only custom' }] });
});

test('single-select custom replaces selection; skip-all never selects a recommended choice', () => {
	const custom = fromDshCarouselAnswers([questions[0]], new Map([['one', { selectedValue: 'B', freeformValue: 'Other' }]]));
	assert.deepEqual(custom, [{ id: 'one', selected: [], custom: 'Other' }]);
	const skipped = settleQuestion(questions, fromDshCarouselAnswers(questions, undefined));
	assert.deepEqual(skipped?.answers, questions.map(item => ({ id: item.id, selected: [] })));
});

test('carousel state survives identical sync, failed submit and blocks a second click', async () => {
	let calls = 0;
	let resolve!: (ok: boolean) => void;
	const controller = new DshQuestionCarouselController(async () => { calls++; return new Promise<boolean>(done => { resolve = done; }); });
	try {
		controller.sync(pending);
		const entry = controller.get('request')!;
		entry.carousel.draftCurrentIndex = 2;
		entry.carousel.draftAnswers = { text: 'draft' };
		controller.sync(JSON.parse(JSON.stringify(pending)));
		assert.equal(controller.get('request'), entry);
		assert.equal(entry.carousel.draftCurrentIndex, 2);
		const result = controller.submit(entry, new Map([['text', 'draft']]));
		assert.equal(entry.busy, true);
		assert.equal(await controller.submit(entry, undefined), false);
		assert.equal(calls, 1);
		resolve(false);
		assert.equal(await result, false);
		assert.equal(entry.busy, false);
		assert.equal(entry.carousel.draftAnswers.text, 'draft');
		assert.ok(entry.error);
	} finally { controller.dispose(); }
});

test('a cancelled or replaced request ignores stale callbacks and rejects old submit handles', async () => {
	let resolve!: (ok: boolean) => void;
	const controller = new DshQuestionCarouselController(() => new Promise<boolean>(done => { resolve = done; }));
	try {
		controller.sync(pending);
		const old = controller.get('request')!;
		const work = controller.submit(old, undefined);
		controller.sync([]);
		controller.sync([{ ...pending[0], questions: [{ ...questions[0], question: 'Changed' }] }]);
		const next = controller.get('request')!;
		assert.notEqual(old, next);
		resolve(false);
		await work;
		assert.equal(next.error, undefined);
		assert.equal(next.busy, false);
		assert.equal(await controller.submit(old, undefined), false);
		controller.sync([]);
		assert.deepEqual(controller.ids(), []);
	} finally { controller.dispose(); }
});

test('empty conversations get one questionnaire host and existing responses keep one host', () => {
	const empty = attachDshQuestions([], 's1', ['request']);
	assert.equal(empty[0].parts[0].kind, 'dshSlotHost');
	assert.deepEqual(empty[0].parts[0].questionIds, ['request']);
	const items = [{ type: 'response', parts: [{ kind: 'dshSlotHost', treeId: 's1', nodeIds: ['a'] }] }];
	const next = attachDshQuestions(items, 's1', ['request']);
	assert.equal(next[0].parts.length, 1);
	assert.equal(items[0].parts[0].questionIds, undefined);
	assert.equal(dshSlotHostSame(items[0].parts[0], next[0].parts[0]), false);
});

test('reveal finds an answerable card by its tool callId, not by eventId', () => {
	// 官方 `userQuestionPanels.reveal(sessionId, callId)`：按被 keyed 的 tool call 找卡片。
	// eventId 是请求身份、callId 是工具调用身份，两者不能混用。
	const submit = async () => true;
	const controller = new DshQuestionCarouselController(submit);
	controller.sync([
		{ eventId: 'e1', kind: 'question', questions: [{ id: 'q1', question: 'A', options: [] }], callId: 'call-1' } as never,
	]);
	assert.ok(controller.reveal('call-1') !== undefined, 'a live card must be found by callId');
	assert.equal(controller.reveal('call-2'), undefined, 'an unknown callId must not fabricate a card');
	assert.equal(controller.reveal(''), undefined, 'an empty callId must not match anything');
	controller.dispose();
});

test('review builds a read-only card from the recorded answers and survives the projection sweep', () => {
	const controller = new DshQuestionCarouselController(async () => true);
	// 先放一张待决卡片，再建它的只读回看：同一 call 已有活卡片时必须返回活的。
	controller.sync([{ eventId: 'e1', kind: 'question', questions: [{ id: 'q1', question: 'A', options: [] }], callId: 'call-1' } as never]);
	const live = controller.reveal('call-1');
	const same = controller.review('call-1', { questions: [{ id: 'q1', question: 'A' }], answers: [{ id: 'q1', selected: ['yes'] }] });
	assert.equal(same, live, 'a stale record must not replace the standing live request');

	// 结算后的 call 没有活卡片：review 建只读卡。
	const review = controller.review('call-9', {
		questions: [{ id: 'q1', question: 'A' }, { id: 'q2', question: 'B' }],
		answers: [{ id: 'q1', selected: ['x'] }, { id: 'q2', selected: [], custom: 'typed' }],
	});
	assert.ok(review !== undefined);
	assert.equal(review.readOnly, true);
	assert.equal(review.eventId, 'review:call-9');
	// 投影扫描（sync）不能把只读回看卡清掉——它不属于投影。
	controller.sync([]);
	assert.ok(controller.get('review:call-9') !== undefined, 'the review card must survive a projection sweep');
	// 关闭即移除。
	controller.closeReview('review:call-9');
	assert.equal(controller.get('review:call-9'), undefined);
	controller.dispose();
});

test('review rejects an empty callId or an empty question record', () => {
	const controller = new DshQuestionCarouselController(async () => true);
	assert.equal(controller.review('', { questions: [{ id: 'q', question: 'A' }], answers: [] }), undefined);
	assert.equal(controller.review('call-1', { questions: [], answers: [] }), undefined);
	controller.dispose();
});
