/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 权限 / 预设 → 原生聊天输入框选项组的映射单测。
// 这对应手册 §3.4「模型/effort/permission/preset → composer 区 quick pick/dropdown」。
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshComposerOptions.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toPermissionItems } from '../../../out/vs/workbench/contrib/dsh/browser/dshComposerProjection.js';

function state(overrides: Record<string, unknown> = {}): never {
	return {
		models: [],
		current: null,
		permission: null,
		team: null,
		presets: null,
		locked: false,
		...overrides,
	} as never;
}

test('permission options drop the custom entry and keep ids', () => {
	const items = toPermissionItems(state({
		permission: {
			current: 'workspace-write',
			options: [
				{ value: 'workspace-write', name: '工作区写入' },
				{ value: 'read-only', name: '只读' },
				{ value: 'custom', name: '自定义' },
			],
		},
	}));
	assert.deepEqual(items, [
		{ id: 'workspace-write', name: '工作区写入' },
		{ id: 'read-only', name: '只读' },
	]);
});

test('no permission projection yields no options instead of inventing defaults', () => {
	assert.deepEqual(toPermissionItems(state()), []);
});
