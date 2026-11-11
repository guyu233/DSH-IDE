/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P4 验收单测：D49 会话列表状态机（正常 / 未绑定两态、单一刷新入口、迟到作废、删除后重查）。
//
// 运行：node --experimental-strip-types --test build/lib/test/dshIdeSessionListModel.test.ts
// 模型经 `out/`（build-dsh-tests 转译产物）加载：它依赖 base/common 的 .js 说明符，
// 直接指向 src/*.ts 会解析不到同目录的 .js 兄弟文件（与 dshIdeConsumer.test.ts 同口径）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IDshIdeSessionSummary } from '../../../src/vs/platform/dshClient/common/dshIdeProtocol.ts';
import {
	DshIdeSessionListModel,
	type IDshIdeSessionListSource,
	type IDshIdeSessionListState,
} from '../../../out/vs/workbench/contrib/dsh/browser/dshIdeSessionListModel.js';

/** 最小会话摘要（字段与契约真源一致，够测状态机即可）。 */
function summary(sessionId: string): IDshIdeSessionSummary {
	return {
		sessionId,
		workspaceId: 'w-1',
		updatedAt: 1,
		running: false,
		blank: false,
		agentAvailable: false,
	};
}

/** 可控 source：记录调用、允许延迟 resolve / reject。 */
function fakeSource() {
	let listCalls = 0;
	let removeCalls: string[] = [];
	let pendingList: { resolve: (v: readonly IDshIdeSessionSummary[]) => void; reject: (e: unknown) => void } | undefined;
	const source: IDshIdeSessionListSource = {
		list: () => {
			listCalls += 1;
			return new Promise((resolve, reject) => { pendingList = { resolve, reject }; });
		},
		remove: async (sessionId: string) => { removeCalls.push(sessionId); },
	};
	return {
		source,
		get listCalls() { return listCalls; },
		get removeCalls() { return removeCalls; },
		resolveList(items: readonly IDshIdeSessionSummary[]) {
			const p = pendingList;
			pendingList = undefined;
			assert.ok(p !== undefined, 'list must have been called');
			p.resolve(items);
		},
		rejectList(error: unknown) {
			const p = pendingList;
			pendingList = undefined;
			assert.ok(p !== undefined, 'list must have been called');
			p.reject(error);
		},
	};
}

/** 等所有微任务结算。 */
async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

// ---------------------------------------------------------------------------
// 未绑定：fail-closed，零取数、零删除
// ---------------------------------------------------------------------------

test('unbound model starts in unbound phase with no items', () => {
	const fake = fakeSource();
	const model = new DshIdeSessionListModel(fake.source, undefined);
	assert.deepEqual(model.state, { phase: 'unbound', items: [], lastError: undefined });
	assert.equal(model.isBound, false);
	model.dispose();
});

test('unbound refresh makes zero Host requests; delete is refused', async () => {
	const fake = fakeSource();
	const model = new DshIdeSessionListModel(fake.source, undefined);
	await model.refresh();
	assert.equal(fake.listCalls, 0, 'an unbound list must never query the Host');
	const result = await model.deleteSession('s-1');
	assert.deepEqual(result, { ok: false, error: 'unbound' });
	assert.equal(fake.removeCalls.length, 0);
	model.dispose();
});

test('empty-string binding is treated as unbound', () => {
	const fake = fakeSource();
	const model = new DshIdeSessionListModel(fake.source, '');
	assert.equal(model.state.phase, 'unbound');
	model.dispose();
});

// ---------------------------------------------------------------------------
// 正常态：刷新取数、事件、并发合并
// ---------------------------------------------------------------------------

test('bound refresh publishes the Host-visible list in normal phase', async () => {
	const fake = fakeSource();
	const model = new DshIdeSessionListModel(fake.source, 's-1');
	const states: IDshIdeSessionListState[] = [];
	model.onDidChangeState(s => states.push(s));

	const refreshing = model.refresh();
	assert.equal(fake.listCalls, 1);
	fake.resolveList([summary('s-1'), summary('s-2')]);
	await refreshing;

	assert.equal(model.state.phase, 'normal');
	assert.deepEqual(model.state.items.map(i => i.sessionId), ['s-1', 's-2']);
	assert.equal(model.state.lastError, undefined);
	assert.ok(states.length >= 1);
	assert.deepEqual(states.at(-1)?.items.map(i => i.sessionId), ['s-1', 's-2']);
	model.dispose();
});

test('concurrent refresh calls share one in-flight read', async () => {
	const fake = fakeSource();
	const model = new DshIdeSessionListModel(fake.source, 's-1');
	const a = model.refresh();
	const b = model.refresh();
	assert.equal(fake.listCalls, 1, 'a second refresh while in flight must not issue another read');
	fake.resolveList([summary('s-1')]);
	await Promise.all([a, b]);
	assert.equal(model.state.items.length, 1);
	model.dispose();
});

// ---------------------------------------------------------------------------
// 刷新失败：保留旧列表、报告错误，不伪造空列表
// ---------------------------------------------------------------------------

test('refresh failure keeps the previous list and reports a reason', async () => {
	const fake = fakeSource();
	const model = new DshIdeSessionListModel(fake.source, 's-1');
	const first = model.refresh();
	fake.resolveList([summary('s-1')]);
	await first;

	const second = model.refresh();
	fake.rejectList({ code: 'dsh-ide/feature-unavailable', message: 'Host offline' });
	await second;

	assert.equal(model.state.phase, 'normal');
	assert.deepEqual(model.state.items.map(i => i.sessionId), ['s-1'], 'failed refresh must retain the last good list');
	assert.equal(model.state.lastError, 'dsh-ide/feature-unavailable');

	// 成功刷新清除错误。
	const third = model.refresh();
	fake.resolveList([summary('s-2')]);
	await third;
	assert.equal(model.state.lastError, undefined);
	assert.deepEqual(model.state.items.map(i => i.sessionId), ['s-2']);
	model.dispose();
});

// ---------------------------------------------------------------------------
// 迟到作废：重绑 / dispose 后旧响应不得回写
// ---------------------------------------------------------------------------

test('re-binding invalidates an in-flight read from the old binding', async () => {
	const fake = fakeSource();
	const model = new DshIdeSessionListModel(fake.source, 's-1');
	const stale = model.refresh();
	assert.equal(fake.listCalls, 1);
	model.bind('s-9');                       // 切换绑定：旧读作废、列表清空
	assert.deepEqual(model.state.items, []);
	fake.resolveList([summary('s-1'), summary('s-2')]); // 旧响应晚到
	await stale;
	assert.deepEqual(model.state.items, [], 'a late response must not repopulate the new binding');
	assert.equal(model.boundSessionId, 's-9');

	const fresh = model.refresh();
	fake.resolveList([summary('s-9')]);
	await fresh;
	assert.deepEqual(model.state.items.map(i => i.sessionId), ['s-9']);
	model.dispose();
});

test('unbinding drops items and switches back to unbound', async () => {
	const fake = fakeSource();
	const model = new DshIdeSessionListModel(fake.source, 's-1');
	const first = model.refresh();
	fake.resolveList([summary('s-1')]);
	await first;
	model.bind(undefined);
	assert.equal(model.state.phase, 'unbound');
	assert.deepEqual(model.state.items, []);
	await model.refresh();
	assert.equal(fake.listCalls, 1, 'unbound refresh must not issue a new read');
	model.dispose();
});

test('dispose invalidates in-flight reads', async () => {
	const fake = fakeSource();
	const model = new DshIdeSessionListModel(fake.source, 's-1');
	const states: IDshIdeSessionListState[] = [];
	model.onDidChangeState(s => states.push(s));
	const stale = model.refresh();
	model.dispose();
	fake.resolveList([summary('s-1')]);
	await stale;
	assert.equal(states.length, 0, 'no state change may be published after dispose');
});

// ---------------------------------------------------------------------------
// 删除成功后主动重查；失败不重查
// ---------------------------------------------------------------------------

test('deleteSession refreshes the list from Host after success', async () => {
	const fake = fakeSource();
	const model = new DshIdeSessionListModel(fake.source, 's-1');
	const initial = model.refresh();
	fake.resolveList([summary('s-1'), summary('s-2')]);
	await initial;
	assert.equal(fake.listCalls, 1);

	const deleting = model.deleteSession('s-2');
	await settle();
	assert.deepEqual(fake.removeCalls, ['s-2']);
	assert.equal(fake.listCalls, 2, 'a successful delete must trigger exactly one re-read');
	fake.resolveList([summary('s-1')]);
	await deleting;

	assert.deepEqual(model.state.items.map(i => i.sessionId), ['s-1']);
	assert.equal(model.state.phase, 'normal');
	model.dispose();
});

test('deleteSession failure does not reload or fake removal', async () => {
	let removeCalls = 0;
	let listCalls = 0;
	const source: IDshIdeSessionListSource = {
		list: async () => { listCalls += 1; return [summary('s-1'), summary('s-2')]; },
		remove: async () => { removeCalls += 1; throw { code: 'session/flush-failed', message: 'busy' }; },
	};
	const model = new DshIdeSessionListModel(source, 's-1');
	await model.refresh();
	const result = await model.deleteSession('s-2');
	assert.equal(removeCalls, 1);
	assert.equal(listCalls, 1, 'a failed delete must not trigger a re-read');
	assert.equal(result.ok, false);
	assert.equal(model.state.lastError, 'session/flush-failed');
	assert.deepEqual(model.state.items.map(i => i.sessionId), ['s-1', 's-2'], 'list must be preserved on delete failure');
	model.dispose();
});

test('deleteSession refuses while unbound', async () => {
	const fake = fakeSource();
	const model = new DshIdeSessionListModel(fake.source, undefined);
	const result = await model.deleteSession('s-1');
	assert.deepEqual(result, { ok: false, error: 'unbound' });
	assert.equal(fake.listCalls, 0);
	model.dispose();
});
