/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 草稿归属判定：fork 与 DSH 提交共用同一份规则。
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/draftOwnership.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearOwnedDraft, isOwnedDraftUnchanged } from '../../../out/vs/workbench/contrib/chat/browser/widget/input/draftOwnership.js';

/** 假输入模型：只实现本模块用到的 state/setState。 */
function inputModel(text: string, attachments: readonly unknown[] = []) {
	let state: { inputText: string; attachments: readonly unknown[] } | undefined = { inputText: text, attachments };
	return {
		get state() {
			return { get: () => state };
		},
		get current() {
			return state;
		},
		setState(next: { inputText: string; attachments: readonly unknown[] }) {
			state = { ...state, ...next };
		},
		setText(value: string) {
			state = { ...state!, inputText: value };
		},
	};
}

test('an untouched draft still belongs to the submitter', () => {
	const model = inputModel('hello', [{ id: 'a' }]);
	assert.equal(isOwnedDraftUnchanged(model as never, 'hello', [{ id: 'a' }] as never), true);
});

test('editing the text releases ownership', () => {
	const model = inputModel('hello');
	assert.equal(isOwnedDraftUnchanged(model as never, 'hello', []), true);
	model.setText('hello world');
	assert.equal(isOwnedDraftUnchanged(model as never, 'hello', []), false);
});

test('changing attachments releases ownership even when the text is identical', () => {
	const model = inputModel('same', [{ id: 'a' }]);
	assert.equal(isOwnedDraftUnchanged(model as never, 'same', [{ id: 'a' }] as never), true);
	const model2 = inputModel('same', []);
	assert.equal(isOwnedDraftUnchanged(model2 as never, 'same', [{ id: 'a' }] as never), false);
});

test('a missing input model is never treated as owned', () => {
	assert.equal(isOwnedDraftUnchanged(undefined, 'x', []), false);
	assert.equal(clearOwnedDraft(undefined, 'x', []), false);
});

test('clearing only applies to the owned draft and is idempotent', () => {
	const model = inputModel('keep me');
	assert.equal(clearOwnedDraft(model as never, 'keep me', []), true);
	assert.equal(model.current?.inputText, '');
	// 第二次调用时草稿已空，与捕获的文本不同：不再算「原稿」，不重复清。
	assert.equal(clearOwnedDraft(model as never, 'keep me', []), false);
});

test('a draft the user already replaced is left untouched', () => {
	const model = inputModel('new thought');
	assert.equal(clearOwnedDraft(model as never, 'old sent text', []), false);
	assert.equal(model.current?.inputText, 'new thought');
});
