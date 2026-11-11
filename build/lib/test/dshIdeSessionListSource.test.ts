/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// D49 生产接线单测：取数端口（IDshClientService → 中立 DTO）的 fail-closed 行为。
//
// 运行：node --experimental-strip-types --test build/lib/test/dshIdeSessionListSource.test.ts
// 只测纯适配层 DshClientSessionListSource，零 workbench 运行时依赖（与 model 同口径）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DshClientSessionListSource } from '../../../out/vs/workbench/contrib/dsh/browser/dshIdeSessionListSource.js';

/** 最小假 call：记录 method / args，允许按 method 配返回。 */
function fakeClient(handler: (method: string, args: Record<string, unknown>) => unknown) {
	const calls: { method: string; args: Record<string, unknown> }[] = [];
	return {
		calls,
		call: async (method: string, args?: Record<string, unknown>) => {
			calls.push({ method, args: args ?? {} });
			return handler(method, args ?? {});
		},
	};
}

function summary(sessionId: string) {
	return {
		sessionId,
		workspaceId: 'w-1',
		updatedAt: 1,
		running: false,
		blank: false,
		agentAvailable: false,
	};
}

test('list returns the Host-visible array and calls listSessions with an empty object', async () => {
	const items = [summary('s-1'), summary('s-2')];
	const fake = fakeClient(() => ({ ok: true, value: items }));
	const source = new DshClientSessionListSource(fake);
	assert.deepEqual(await source.list(), items);
	assert.deepEqual(fake.calls, [{ method: 'listSessions', args: {} }]);
});

test('list propagates the official error code instead of faking an empty list', async () => {
	const fake = fakeClient(() => ({ ok: false, error: { code: 'SESSION_SWITCHED', message: 'binding changed' } }));
	const source = new DshClientSessionListSource(fake);
	await assert.rejects(source.list(), error => {
		assert.equal((error as { code?: string }).code, 'SESSION_SWITCHED');
		return true;
	});
});

test('list rejects a malformed non-array payload as invalid-argument', async () => {
	const fake = fakeClient(() => ({ ok: true, value: { items: [] } }));
	const source = new DshClientSessionListSource(fake);
	await assert.rejects(source.list(), error => {
		assert.equal((error as { code?: string }).code, 'dsh-ide/invalid-argument');
		return true;
	});
});

test('remove calls deleteSession with the exact id and accepts success', async () => {
	const fake = fakeClient(() => ({ ok: true, value: { accepted: true } }));
	const source = new DshClientSessionListSource(fake);
	await source.remove('s-2');
	assert.deepEqual(fake.calls, [{ method: 'deleteSession', args: { sessionId: 's-2' } }]);
});

test('remove propagates FEATURE_UNAVAILABLE so the model keeps the list', async () => {
	const fake = fakeClient(() => ({ ok: false, error: { code: 'feature-unavailable', message: 'plugin missing' } }));
	const source = new DshClientSessionListSource(fake);
	await assert.rejects(source.remove('s-2'), error => {
		assert.equal((error as { code?: string }).code, 'feature-unavailable');
		return true;
	});
});
