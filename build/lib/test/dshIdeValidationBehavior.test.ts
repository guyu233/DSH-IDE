/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 协议边界的**行为**测试（不是源码文本断言）。
//
// 为什么单独一个文件：`dshIdeProtocol.test.ts` 里多数用例是读源码匹配正则，只能证明
// 「那行字还在」，证明不了「这个输入真的会被拒绝」。这里直接 import 编译后的校验函数，
// 把非法输入喂进去看它是否抛错——契约真源的每一条拒绝都必须可执行地成立。

import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDshIdeInput } from '../../../src/vs/platform/dshClient/protocol/dshIdeProtocol.ts';

/** 断言这份输入会被协议边界拒绝。 */
function rejects(method: string, args: unknown, why: string): void {
	assert.throws(() => validateDshIdeInput(method as never, args), undefined, why);
}

/** 断言这份输入会被协议边界接受。 */
function accepts(method: string, args: unknown, why: string): void {
	assert.doesNotThrow(() => validateDshIdeInput(method as never, args), why);
}

test('unknown methods are rejected instead of silently forwarded', () => {
	rejects('notAMethod', {}, 'an undefined method must not reach the Host');
	rejects('', {}, 'an empty method name must not reach the Host');
});

test('extra fields are rejected (no smuggling through exactRecord)', () => {
	rejects('submit', { text: 'hi', sessionId: 's', extra: 1 }, 'unknown field must be refused');
	rejects('listWorkspaces', { foo: 1 }, 'a no-argument method must refuse any field');
});

test('required strings must be present and non-empty', () => {
	rejects('submit', { sessionId: 's' }, 'missing text');
	rejects('submit', { text: '', sessionId: 's' }, 'empty text');
	rejects('submit', { text: 'hi', sessionId: '' }, 'empty sessionId');
	rejects('interrupt', {}, 'missing sessionId');
	rejects('setModel', { sessionId: 's', model: '' }, 'empty model');
});

test('every session-scoped method refuses an empty session id', () => {
	// 这一组是回归：`deleteSession` 曾漏掉 nonEmptyString，空串能过协议边界。
	const methods = [
		'deleteSession', 'archiveSession', 'unarchiveSession', 'renameSession',
		'setSessionFavorite', 'setSessionPinned', 'openSessionPath',
	];
	for (const method of methods) {
		const args: Record<string, unknown> = { sessionId: '' };
		if (method === 'renameSession') {
			args.title = 't';
		}
		rejects(method, args, `${method} must refuse an empty sessionId`);
	}
});

test('non-object payloads are rejected', () => {
	rejects('submit', null, 'null is not a payload');
	rejects('submit', [], 'an array is not a payload');
	rejects('submit', 'text', 'a bare string is not a payload');
});

test('valid payloads are still accepted', () => {
	accepts('submit', { text: 'hi', sessionId: 's' }, 'a well-formed submit must pass');
	accepts('listWorkspaces', {}, 'a no-argument method takes an empty object');
	accepts('deleteSession', { sessionId: 's' }, 'a non-empty session id must pass');
});
