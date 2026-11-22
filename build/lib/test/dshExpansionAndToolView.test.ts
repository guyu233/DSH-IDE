/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 折叠 store 与工具视图分派。
// 运行：node --experimental-strip-types --test build/lib/test/dshExpansionAndToolView.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DshExpansionStateStore } from '../../../src/vs/workbench/contrib/dsh/browser/vscode/dshExpansionStateStore.ts';
import { dshDetailsToolCount, dshToolViewId } from '../../../src/vs/workbench/contrib/dsh/browser/vscode/dshToolViewRegistry.ts';

test('turn collapse defaults per work-details mode and node disclosure resets with the turn', () => {
	// 官方「Display modes」：Compact/Standard/Detailed 对合格的历史 Turn **初始折叠**，Verbose 永不折叠。
	const store = new DshExpansionStateStore('s1');
	assert.equal(store.isTurnCollapsed(1, 0), true, 'standard starts a completed turn collapsed');
	store.setTranscriptView('verbose');
	assert.equal(store.isTurnCollapsed(1, 0), false, 'verbose never folds');
	store.setTranscriptView('standard');
	store.setTurnCollapsed(1, 0, true);
	store.setDisclosed(1, 'reasoning', true);
	store.setDisclosed(1, 'tool', true);
	store.setDisclosed(2, 'reasoning', true);
	assert.equal(store.isTurnCollapsed(1, 0), true);
	assert.equal(store.isDisclosed(1, 'tool'), true);
	store.resetTurn(1);
	assert.equal(store.isDisclosed(1, 'reasoning'), false);
	assert.equal(store.isDisclosed(1, 'tool'), false);
	assert.equal(store.isDisclosed(2, 'reasoning'), true);
	assert.equal(store.isTurnCollapsed(1, 0), true);
	store.setTurnCollapsed(1, 0, false);
	assert.equal(store.isTurnCollapsed(1, 0), false);
});

test('two sessions do not share collapse state', () => {
	const left = new DshExpansionStateStore('left');
	const right = new DshExpansionStateStore('right');
	// 用 verbose（永不折叠）做对照：右边没有手动记录，不能读到左边的手动收起。
	right.setTranscriptView('verbose');
	left.setTurnCollapsed(3, 1, true);
	assert.equal(right.isTurnCollapsed(3, 1), false);
	assert.equal(left.sessionId, 'left');
});

test('tool names dispatch to their view family and unknown names stay generic', () => {
	assert.equal(dshToolViewId('bash'), 'bash');
	assert.equal(dshToolViewId('read_image'), 'read-image');
	assert.equal(dshToolViewId('apply_patch'), 'file-mutation');
	assert.equal(dshToolViewId('grep'), 'search');
	assert.equal(dshToolViewId('web_fetch'), 'web');
	assert.equal(dshToolViewId('office_convert'), 'office');
	assert.equal(dshToolViewId('subagent_fork'), 'details');
	assert.equal(dshToolViewId('cordis_stop'), 'details');
	assert.equal(dshToolViewId('timeline_tasks'), 'details');
	assert.equal(dshToolViewId('not_a_tool'), 'generic');
	assert.equal(dshToolViewId(''), 'generic');
	assert.equal(dshDetailsToolCount(), 44);
});
