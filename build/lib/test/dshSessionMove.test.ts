/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 移动会话的候选项：当前工作区不能再被选中，空 id 不能进选择器。
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshSessionMove.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dshMoveChoices, dshRewindSeq } from '../../../src/vs/workbench/contrib/dsh/browser/vscode/dshSessionMove.ts';

test('the current workspace and blank ids are not move targets', () => {
	const choices = dshMoveChoices([
		{ id: 'here', title: '当前', path: 'E:/here' },
		{ id: '', title: '空' },
		{ id: 'other', path: 'E:/other' },
		{ title: '没有 id' },
	], 'here');
	assert.deepEqual(choices, [{ id: 'other', label: 'other', description: 'E:/other' }]);
});

test('every workspace stays when the current one is unknown', () => {
	const choices = dshMoveChoices([{ id: 'a', title: '甲' }, { id: 'b', title: '乙' }], undefined);
	assert.deepEqual(choices.map(choice => choice.id), ['a', 'b']);
	assert.equal(choices[0].label, '甲');
});

test('rewind targets are an @ seq and nothing else', () => {
	assert.equal(dshRewindSeq('12'), '@12');
	assert.equal(dshRewindSeq('  @12 '), '@12');
	assert.equal(dshRewindSeq('@0'), '@0');
	assert.equal(dshRewindSeq(''), undefined);
	assert.equal(dshRewindSeq('12a'), undefined);
	assert.equal(dshRewindSeq('-1'), undefined);
	assert.equal(dshRewindSeq('@'), undefined);
});

test('rewind is a real menu action and a missing new session id is reported', () => {
	const menu = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshSessionMenu.ts', import.meta.url), 'utf8');
	assert.match(menu, /id: 'dsh\.session\.rewind'/);
	assert.match(menu, /capability: 'rewind'/);
	assert.match(menu, /dshRewindSeq\(raw\)/);
	assert.match(menu, /call\('rewind'/);
	assert.match(menu, /dsh\.session\.copied/);
	const contrib = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/dsh.contribution.ts', import.meta.url), 'utf8');
	assert.match(contrib, /dsh\.newSessionNoId/);
});

test('success notices exist for move, fork and rename', () => {
	const menu = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshSessionMenu.ts', import.meta.url), 'utf8');
	assert.match(menu, /dshMoveChoices\(/);
	assert.match(menu, /dsh\.session\.moved/);
	assert.match(menu, /dsh\.session\.forkedNoId/);
	assert.match(menu, /dsh\.session\.renamed/);
	assert.doesNotMatch(menu, /workspace\.path/);
});

test('a duplicated workspace id appears only once', () => {
	// Host 侧 listWorkspaces 不去重。registry 返回重复 id 时，
	// 选择器会出现两行一模一样的目标，用户分不清该点哪个。
	const choices = dshMoveChoices([
		{ id: 'w-1', title: '目标', path: 'E:/one' },
		{ id: 'w-1', title: '目标', path: 'E:/one' },
		{ id: 'w-2' },
	], undefined);
	assert.deepEqual(choices.map(c => c.id), ['w-1', 'w-2']);
});
