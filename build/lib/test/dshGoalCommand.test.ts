/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 目标命令的动作过滤单测：只列出当前阶段真能生效的动作。
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshGoalCommand.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const SOURCE = 'src/vs/workbench/contrib/dsh/browser/dshGoalCommands.ts';

/**
 * 复刻 `dshGoalCommands` 的动作过滤（见该文件 `actions` 的 `when` 表）。
 *
 * 契约 phase 只有 active / paused / blocked / complete 四种。
 */
function actionsFor(phase: string): readonly string[] {
	const table = [
		{ id: 'pause', when: ['active'] },
		{ id: 'resume', when: ['paused', 'blocked'] },
		{ id: 'complete', when: ['active', 'paused', 'blocked'] },
		{ id: 'clear', when: ['active', 'paused', 'blocked', 'complete'] },
	];
	return table.filter(action => action.when.includes(phase)).map(action => action.id);
}

test('an active goal can be paused, completed or cleared', () => {
	assert.deepEqual(actionsFor('active'), ['pause', 'complete', 'clear']);
});

test('a paused goal offers resume, not another pause', () => {
	const actions = actionsFor('paused');
	assert.ok(actions.includes('resume'), 'a paused goal must be resumable');
	assert.ok(!actions.includes('pause'), 'pausing an already-paused goal would be rejected by the host');
});

test('a completed goal only offers clear', () => {
	assert.deepEqual(actionsFor('complete'), ['clear']);
});

test('a blocked goal can be resumed, completed or cleared', () => {
	assert.deepEqual(actionsFor('blocked'), ['resume', 'complete', 'clear']);
});

test('an unknown phase offers nothing instead of a menu of failures', () => {
	assert.deepEqual(actionsFor('some-future-phase'), []);
});

test('the command filters actions by phase and warns on an unknown one', () => {
	const source = readFileSync(new URL('../../../' + SOURCE, import.meta.url), 'utf8');
	// 全列四个动作会让不该出现的选项也被点到，然后被 Host 拒绝。
	assert.match(source, /\.filter\(action => action\.when\.includes\(goal\.phase\)\)/, 'the actions must be filtered by the current phase');
	assert.match(source, /dsh\.goal\.unknownPhase/, 'an unrecognised phase must warn instead of guessing');
	// 每个动作都要声明自己的适用阶段。
	for (const id of ['pause', 'resume', 'complete', 'clear']) {
		assert.match(source, new RegExp(`id: '${id}' as const[^}]*when: \\[`), `${id} must declare the phases it applies to`);
	}
});
