/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 开窗预取目录（`DSH_IDE_COMPOSER`）的跨端契约。
//
// Host 用 `projectDshIdeComposer({ values, catalog, permission, presets })` 产出，
// IDE 用 `normalizeDshComposerState` 消费。两端曾经不一致：Host 直接塞原始对象
// （字段是 values/catalog/permission/presets），IDE 读的是 model/preset/team——
// 结果整份解析成 EMPTY，预取「看起来生效、第一帧仍是空的」。
//
// 这个测试把真实的两端函数接起来跑，任何一端改形状都会立刻失败。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectDshIdeComposer } from '../../../src/vs/platform/dshClient/common/dshIdeComposer.js';
import { normalizeDshComposerState } from '../../../out/vs/workbench/contrib/dsh/browser/dshComposerSource.js';

/** 官方 `sessionController` 侧的最小真实形状。 */
function hostSource() {
	return {
		values: {
			modelSelection: { next: { provider: 'deepseek', model: 'v4', reasoningEffort: 'high' } },
			permissions: { currentValue: 'standard' },
			agentPreset: 'coding',
			agentTeam: { enabled: true },
		},
		catalog: {
			groups: [{
				id: 'deepseek',
				models: [{ id: 'v4', name: 'DeepSeek V4', reasoning: { efforts: [{ id: 'high', name: 'High' }] } }],
			}],
		},
		permission: { options: [{ value: 'standard', name: 'Standard' }, { value: 'readonly', name: 'Read only' }] },
		presets: [{ id: 'coding', name: 'Coding' }],
	};
}

test('the prefetched catalogue survives the trip from Host to IDE', () => {
	const projected = projectDshIdeComposer(hostSource());
	const state = normalizeDshComposerState(projected);

	assert.equal(state.models.length, 1, 'the model catalogue must not be dropped');
	assert.equal(state.models[0].provider, 'deepseek');
	assert.equal(state.models[0].id, 'v4');
	assert.equal(state.models[0].efforts.length, 1, 'reasoning efforts must survive');
	assert.deepEqual(state.current, { provider: 'deepseek', model: 'v4', effort: 'high' });
	assert.equal(state.permission?.options.length, 2, 'permission presets must survive');
	assert.equal(state.permission?.current, 'standard');
	assert.equal(state.presets?.options.length, 1, 'agent presets must survive');
	assert.equal(state.presets?.current, 'coding');
	assert.equal(state.team?.enabled, true, 'the team toggle must survive');
});

test('the raw Host envelope is not a valid IDE payload', () => {
	// 回归：直接传 `{ values, catalog, permission, presets }` 时 IDE 会解析成空。
	// 如果哪天有人把 Host 侧改回「直接塞原始对象」，上面那条会失败、这条说明原因。
	const state = normalizeDshComposerState(hostSource());
	assert.equal(state.models.length, 0, 'the raw envelope carries no `model` block');
	assert.equal(state.current, null, 'no model selection is readable from the raw envelope');
	assert.equal(state.presets, null, 'the raw envelope has `presets`, but the IDE reads `preset`');
	assert.equal(state.team, null, 'the raw envelope carries the team under `values.agentTeam`, not `team`');
	// `permission` 恰好同名，会被读到——这正说明「部分字段可用」比「全空」更危险：
	// 用户会看到权限选择器有值、模型选择器却是空的，难以判断是没数据还是解析错。
	assert.ok(state.permission !== null, 'the same-named permission block is read by coincidence');
});

test('an empty or malformed prefetch degrades to EMPTY instead of throwing', () => {
	for (const value of [undefined, null, {}, 'not-json', 42, []]) {
		const state = normalizeDshComposerState(value);
		assert.equal(state.models.length, 0, `value ${JSON.stringify(value)} must degrade to an empty catalogue`);
		assert.equal(state.current, null);
	}
});
