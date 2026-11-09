/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P5 收尾：Host 侧 IDE 客户端登记与开窗请求队列的单测（docs/DEVELOPMENT.md 第 7 章 §3 D12）。
//
// 只测 host/ide-launch-queue.js（纯 Node 实现，不引 @deepseek-ai/*），因此能直接由
// `node --experimental-strip-types --test` 执行。服务类 ide-service.js 的 @Remote 方法
// 只是对本队列的薄委托，真机链路另由 launch listener 覆盖。

import assert from 'node:assert/strict';
import test from 'node:test';
import { IdeLaunchQueue } from '../../host/ide-launch-queue.js';

test('register 拒绝空 / 非字符串 clientId', () => {
	const queue = new IdeLaunchQueue();
	assert.deepEqual(queue.register(''), { ok: false, message: 'clientId must be a non-empty string' });
	assert.deepEqual(queue.register(undefined), { ok: false, message: 'clientId must be a non-empty string' });
	assert.deepEqual(queue.register(42), { ok: false, message: 'clientId must be a non-empty string' });
});

test('重复报到只刷新 alive，不重建回调（已投递的请求不丢）', () => {
	const queue = new IdeLaunchQueue();
	const first = queue.register('ide-1');
	const seen = [];
	queue.clients.get('ide-1').setLaunchHandler(spec => seen.push(spec));
	const second = queue.register('ide-1');
	assert.equal(second.ok, true);
	assert.equal(second.alreadyRegistered, true);
	assert.equal(second.dispose, undefined);

	assert.equal(queue.dispatch({ workspace: '/w' }), true);
	assert.deepEqual(seen, [{ workspace: '/w' }]);
	assert.equal(first.ok, true);
});

test('没有在线客户端时 dispatch 返回 false；离线后也不再接收', () => {
	const queue = new IdeLaunchQueue();
	assert.equal(queue.dispatch({ workspace: '/w' }), false);

	const registration = queue.register('ide-1');
	assert.equal(registration.ok, true);
	registration.dispose();
	assert.equal(queue.dispatch({ workspace: '/w' }), false, '注销后登记项必须从表中移除');
});

test('多个客户端时只投递给第一个在线客户端', () => {
	const queue = new IdeLaunchQueue();
	queue.register('ide-1');
	queue.register('ide-2');
	const one = [];
	const two = [];
	queue.clients.get('ide-1').setLaunchHandler(spec => one.push(spec));
	queue.clients.get('ide-2').setLaunchHandler(spec => two.push(spec));

	assert.equal(queue.dispatch({ workspace: '/a' }), true);
	assert.deepEqual(one, [{ workspace: '/a' }]);
	assert.deepEqual(two, []);
});

test('回调未就绪时 launch 暂存，poll 取走且只取一次', () => {
	const queue = new IdeLaunchQueue();
	queue.register('ide-1');
	queue.clients.get('ide-1').launch({ workspace: '/p' });

	assert.deepEqual(queue.poll('ide-1'), { ok: true, requests: [{ workspace: '/p' }] });
	assert.deepEqual(queue.poll('ide-1'), { ok: true, requests: [] });
});

test('setLaunchHandler 会冲掉并投递之前暂存的请求', () => {
	const queue = new IdeLaunchQueue();
	queue.register('ide-1');
	queue.clients.get('ide-1').launch({ workspace: '/a' });
	queue.clients.get('ide-1').launch({});

	const seen = [];
	queue.clients.get('ide-1').setLaunchHandler(spec => seen.push(spec));
	assert.deepEqual(seen, [{ workspace: '/a' }, {}]);
	assert.deepEqual(queue.clients.get('ide-1').poll().requests, []);
});

test('报到前的首次开窗请求经 enqueue 暂存，poll 时先交还并清空', () => {
	const queue = new IdeLaunchQueue();
	queue.enqueue({ workspace: '/first' });
	queue.register('ide-1');
	queue.clients.get('ide-1').launch({ workspace: '/second' });

	assert.deepEqual(queue.poll('ide-1'), {
		ok: true,
		requests: [{ workspace: '/first' }, { workspace: '/second' }],
	});
	assert.deepEqual(queue.poll('ide-1'), { ok: true, requests: [] });
});

test('未知 clientId 的 poll 如实失败且不消耗暂存请求', () => {
	const queue = new IdeLaunchQueue();
	queue.enqueue({ workspace: '/first' });
	assert.deepEqual(queue.poll('missing'), { ok: false, requests: [] });
	assert.deepEqual(queue.poll('missing'), { ok: false, requests: [] });
	assert.equal(queue.pending.length, 1, '未知客户端不能把别人的请求取走');
});