/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 会话菜单的动作可见性：不该在已归档会话上出现的动作必须声明 `when`。
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshSessionMenu.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const SOURCE = 'src/vs/workbench/contrib/dsh/browser/dshSessionMenu.ts';

function readSource(): string {
	return readFileSync(new URL('../../../' + SOURCE, import.meta.url), 'utf8');
}

/** 取一个动作块的源码（从 `id:` 到下一个 `id:` 或文件尾）。 */
function actionBlock(source: string, id: string): string {
	const start = source.indexOf(`id: 'dsh.session.${id}'`);
	assert.ok(start >= 0, `action ${id} must exist`);
	const next = source.indexOf("id: 'dsh.session.", start + 10);
	return source.slice(start, next < 0 ? source.length : next);
}

test('actions that cannot apply to an archived session are hidden there', () => {
	// 归档会话在 Host 侧不可见（`assertVisibleRowForBridge`），重命名/分支/移动/删除
	// 都会被拒。菜单不该给出点了必然失败的入口。
	const source = readSource();
	for (const id of ['rename', 'fork', 'move', 'delete', 'favorite']) {
		const block = actionBlock(source, id);
		assert.ok(
			block.includes('isArchivedAgentSession.negate()'),
			`${id} must be hidden for archived sessions`,
		);
	}
});

test('pin and unpin are mutually exclusive and both exclude archived sessions', () => {
	const source = readSource();
	const pin = actionBlock(source, 'pin');
	const unpin = actionBlock(source, 'unpin');
	assert.ok(pin.includes('isPinnedAgentSession.negate()'), 'pin only applies to unpinned sessions');
	assert.ok(unpin.includes('isPinnedAgentSession'), 'unpin only applies to pinned sessions');
	assert.ok(pin.includes('isArchivedAgentSession.negate()'), 'pin must exclude archived sessions');
	assert.ok(unpin.includes('isArchivedAgentSession.negate()'), 'unpin must exclude archived sessions');
});

test('archive and unarchive are exact opposites', () => {
	const source = readSource();
	assert.ok(actionBlock(source, 'archive').includes('isArchivedAgentSession.negate()'), 'archive only applies to live sessions');
	assert.ok(/isArchivedAgentSession,|isArchivedAgentSession\s*$/.test(actionBlock(source, 'unarchive').replace(/\n/g, ' ')) || actionBlock(source, 'unarchive').includes('isArchivedAgentSession'), 'unarchive only applies to archived sessions');
	assert.ok(!actionBlock(source, 'unarchive').includes('isArchivedAgentSession.negate()'), 'unarchive must not negate the archived key');
});

test('a failed session action is reported at error level, like every other DSH command', () => {
	// 目标 / 作业 / MCP 命令的失败都用 error。会话操作的失败同样是「刚才那一下没做成」，
	// 用 warn 会更弱、也更容易被当成非致命提醒而忽略。
	const source = readSource();
	const failBody = /async function fail\([\s\S]{0,400}?\n\}/.exec(source)?.[0] ?? '';
	assert.ok(failBody !== '', 'the fail helper must exist');
	assert.match(failBody, /notifications\.error\(/, 'the fail helper must use error level');
	assert.doesNotMatch(failBody, /notifications\.warn\(/, 'the fail helper must not downgrade to warn');
});
