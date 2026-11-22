/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 会话选项的「程序投影」与「用户点选」必须分开：
// 打开/换绑时补当前值只能更新界面，绝不能触发 Host 写回。
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshSessionOptionSync.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	runWithoutSessionOptionWriteBack,
	shouldWriteBackSessionOption,
} from '../../../out/vs/workbench/contrib/dsh/browser/vscode/dshSessionOptionSync.js';

test('a projection suppresses write-back while it runs', () => {
	assert.equal(shouldWriteBackSessionOption(), true);
	runWithoutSessionOptionWriteBack(() => {
		assert.equal(shouldWriteBackSessionOption(), false);
	});
	assert.equal(shouldWriteBackSessionOption(), true);
});

test('nested projections stay suppressed until the outermost returns', () => {
	runWithoutSessionOptionWriteBack(() => {
		runWithoutSessionOptionWriteBack(() => {
			assert.equal(shouldWriteBackSessionOption(), false);
		});
		assert.equal(shouldWriteBackSessionOption(), false);
	});
	assert.equal(shouldWriteBackSessionOption(), true);
});

test('a throwing projection does not leave write-back disabled', () => {
	assert.throws(() => runWithoutSessionOptionWriteBack(() => {
		throw new Error('projection failed');
	}), /projection failed/);
	assert.equal(shouldWriteBackSessionOption(), true);
});

test('the projection path uses the guard and the listener honors it', async () => {
	const { readFileSync } = await import('node:fs');
	const content = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatSessionContent.ts', import.meta.url), 'utf8');
	assert.match(content, /runWithoutSessionOptionWriteBack\(\(\) => this\.chatSessionsService\.updateSessionOptions\(/,
		'registering session options must run inside the suppression guard');
	const controller = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshAgentSessionsController.ts', import.meta.url), 'utf8');
	assert.match(controller, /if \(!shouldWriteBackSessionOption\(\)\) \{/,
		'the option listener must skip programmatic projections');
	assert.match(controller, /dshSessionIdFromResource\(event\.sessionResource\)/,
		'a user change must be written back to the session the event belongs to');
});
