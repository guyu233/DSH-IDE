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

test('turn collapse defaults to open and node disclosure resets with the turn', () => {
	const store = new DshExpansionStateStore('s1');
	assert.equal(store.isTurnCollapsed(1, 0), false);
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
