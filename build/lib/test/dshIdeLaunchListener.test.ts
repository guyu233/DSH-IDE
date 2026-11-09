/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P5 验收单测：IDE 侧开窗接单器（`DshIdeLaunchListener`）。
//
// 它解决的是「按钮点了没反应」的根因：`dshIde` 是 IDE 自己的 IPC 通道，Host 在另一个进程，
// 无法跨进程直接调用。因此 IDE 必须自己向 Host 报到并轮询开窗请求。
//
// 守护点：
//   - 报到失败会重试，不放弃；
//   - 报到成功后轮询到的请求会分发给 onLaunch；
//   - onLaunch 抛错不会中断轮询；
//   - dispose 后不再轮询。
//
// 运行：node --experimental-strip-types --test build/lib/test/dshIdeLaunchListener.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	DSH_IDE_LAUNCH_POLL_MS,
	DshIdeLaunchListener,
	type DshIdeLaunchRequest,
} from '../../../out/vs/platform/dshClient/transport/dshIdeLaunchListener.js';

/** 假的 Host 调用面：按脚本回答，并记录调用顺序。 */
function fakeCaller(script: { register?: () => unknown; poll?: () => unknown }) {
	const calls: { namespace: string; method: string; args: Record<string, unknown> }[] = [];
	return {
		calls,
		call: async (namespace: string, method: string, args: Record<string, unknown>) => {
			calls.push({ namespace, method, args });
			if (method === 'registerIdeClient') {
				return script.register ? script.register() : { ok: true };
			}
			if (method === 'pollLaunch') {
				return script.poll ? script.poll() : { ok: true, requests: [] };
			}
			throw new Error(`unexpected call ${namespace}/${method}`);
		},
	};
}

function wait(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

test('registers once, then polls and dispatches launch requests', async () => {
	let pollCount = 0;
	const caller = fakeCaller({
		poll: () => {
			pollCount += 1;
			// 第二次轮询时给出一个开窗请求。
			return pollCount === 2 ? { ok: true, requests: [{ workspace: 'E:\\repo' }] } : { ok: true, requests: [] };
		},
	});
	const launched: DshIdeLaunchRequest[] = [];
	const listener = new DshIdeLaunchListener(caller, 'ide-1', request => launched.push(request));
	listener.start();

	await wait(DSH_IDE_LAUNCH_POLL_MS * 3);

	const registerCalls = caller.calls.filter(c => c.method === 'registerIdeClient');
	assert.equal(registerCalls.length, 1, 'must register exactly once, not on every poll');
	assert.equal(registerCalls[0].args['clientId'], 'ide-1');
	assert.ok(pollCount >= 2, `polling must continue (got ${pollCount})`);
	assert.deepEqual(launched, [{ workspace: 'E:\\repo' }], 'the request must reach onLaunch');
	listener.dispose();
});

test('a failing registration is retried instead of giving up', async () => {
	let attempts = 0;
	const caller = fakeCaller({
		register: () => {
			attempts += 1;
			if (attempts === 1) {
				throw new Error('host not ready');
			}
			return { ok: true };
		},
	});
	const listener = new DshIdeLaunchListener(caller, 'ide-2', () => undefined);
	listener.start();

	await wait(DSH_IDE_LAUNCH_POLL_MS * 3);

	assert.ok(attempts >= 2, `registration must be retried (attempts=${attempts})`);
	listener.dispose();
});

test('a throw inside onLaunch does not stop the polling loop', async () => {
	let pollCount = 0;
	const caller = fakeCaller({
		poll: () => {
			pollCount += 1;
			return pollCount === 1 ? { ok: true, requests: [{ workspace: 'a' }] } : { ok: true, requests: [] };
		},
	});
	let calls = 0;
	const listener = new DshIdeLaunchListener(caller, 'ide-3', () => {
		calls += 1;
		throw new Error('window creation failed');
	});
	listener.start();

	// 等足够久让 onLaunch 被调用，并让轮询继续跑（证明没被打断）。
	await wait(DSH_IDE_LAUNCH_POLL_MS * 3);

	assert.equal(calls, 1, 'onLaunch ran exactly once (only one request was served)');
	assert.ok(pollCount >= 2, 'polling must survive the onLaunch failure');
	// 注意：后续轮询成功会清空 lastFailure（这是正确的「恢复即清除」语义），
	// 因此这里不断言 lastFailure，只断言循环没停。
	listener.dispose();
});

test('malformed poll payloads are ignored', async () => {
	let served = false;
	const caller = fakeCaller({
		poll: () => {
			if (served) {
				return { ok: true, requests: [] };
			}
			served = true;
			return { ok: true, requests: [null, 'nope', { workspace: 42 }] };
		},
	});
	const launched: DshIdeLaunchRequest[] = [];
	const listener = new DshIdeLaunchListener(caller, 'ide-4', request => launched.push(request));
	listener.start();

	await wait(DSH_IDE_LAUNCH_POLL_MS * 1.6);

	// 只有对象形状会被取出；非字符串 workspace 被丢弃为「不带 workspace」。
	assert.deepEqual(launched, [{}], 'only object-shaped requests are dispatched');
	listener.dispose();
});

test('dispose stops the loop', async () => {
	const caller = fakeCaller({});
	const listener = new DshIdeLaunchListener(caller, 'ide-5', () => undefined);
	listener.start();
	await wait(DSH_IDE_LAUNCH_POLL_MS + 100);
	const before = caller.calls.length;
	listener.dispose();
	await wait(DSH_IDE_LAUNCH_POLL_MS * 2);
	assert.equal(caller.calls.length, before, 'no calls may happen after dispose');
});
