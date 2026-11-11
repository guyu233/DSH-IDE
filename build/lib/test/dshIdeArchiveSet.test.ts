/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 第 19 轮：两套 backend 共用的归档集合中立投影（§8.10.11）。
// 官方返回 `{ archivedSessionIds }`（完整集合），契约按列表类投影为 string[]。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectDshIdeArchiveSet } from '../../../src/vs/platform/dshClient/common/dshIdeArchiveSet.js';

test('projectDshIdeArchiveSet maps the official full archive set to a string array', () => {
	assert.deepEqual(projectDshIdeArchiveSet({ archivedSessionIds: ['s-1', 's-2'] }), ['s-1', 's-2']);
	assert.deepEqual(projectDshIdeArchiveSet({ archivedSessionIds: [] }), []);
});

test('projectDshIdeArchiveSet drops non-string and empty ids instead of inventing entries', () => {
	assert.deepEqual(projectDshIdeArchiveSet({ archivedSessionIds: ['s-1', '', 42, null, 's-2'] }), ['s-1', 's-2']);
});

test('projectDshIdeArchiveSet is fail-closed for malformed payloads', () => {
	for (const value of [undefined, null, 'x', 42, [], { archivedSessionIds: 'nope' }, {}]) {
		assert.deepEqual(projectDshIdeArchiveSet(value), [], `must be [] for ${JSON.stringify(value)}`);
	}
});
