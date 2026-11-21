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
	DSH_IDE_LAUNCH_WAIT_MS,
	DshIdeLaunchListener,
	type DshIdeLaunchRequest,
} from '../../../out/vs/platform/dshClient/transport/dshIdeLaunchListener.js';
import { DSH_IDE_WIRE_REVISION } from '../../../src/vs/platform/dshClient/common/dshIdeProtocol.ts';

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
	// Host 的形参名就是 wire 字段：缺 wireRevision 会被 gateway/内部错误折成「点了没反应」。
	assert.deepEqual(registerCalls[0].args, { clientId: 'ide-1', wireRevision: DSH_IDE_WIRE_REVISION });
	const pollCalls = caller.calls.filter(c => c.method === 'pollLaunch');
	assert.ok(pollCalls.length >= 1, 'polling must happen');
	for (const call of pollCalls) {
		assert.deepEqual(call.args, { clientId: 'ide-1', wireRevision: DSH_IDE_WIRE_REVISION, waitMs: DSH_IDE_LAUNCH_WAIT_MS }, 'every poll carries the wire revision and the long-poll budget');
	}
	assert.ok(pollCount >= 2, `polling must continue (got ${pollCount})`);
	assert.deepEqual(launched, [{ workspace: 'E:\\repo' }], 'the request must reach onLaunch');
	listener.dispose();
});

test('a launch request keeps sessionId and drops a blank one', async () => {
	let polls = 0;
	const caller = fakeCaller({
		poll: () => {
			polls += 1;
			return polls === 1
				? { ok: true, requests: [{ workspace: 'E:\\repo', sessionId: 's-9' }, { sessionId: '' }, { sessionId: 3 }] }
				: { ok: true, requests: [] };
		},
	});
	const launched: DshIdeLaunchRequest[] = [];
	const listener = new DshIdeLaunchListener(caller, 'ide-1', request => launched.push(request));
	listener.start();
	await wait(DSH_IDE_LAUNCH_POLL_MS + 400);
	assert.deepEqual(launched, [
		{ workspace: 'E:\\repo', sessionId: 's-9' },
		{},
		{},
	]);
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
	const after = caller.calls.slice(before);
	// dispose 会立刻向 Host 注销（避免死登记项等心跳超时）；除这次注销外不得再有轮询。
	assert.deepEqual(after.map(call => call.method), ['unregisterIdeClient'], 'no polling may happen after dispose');
	assert.deepEqual(after[0].args, { clientId: 'ide-5', wireRevision: DSH_IDE_WIRE_REVISION }, 'unregister carries the wire revision');
});

test('a Host that dropped the registration is re-registered instead of staying offline', async () => {
	// Host 重启或心跳超时后 `pollLaunch` 会以 `{ ok:false }` 正常返回（不抛错）。
	// 不据此重新报到，接单器会永远认为自己在线，按钮从此打不开窗。
	let registrations = 0;
	let polls = 0;
	const caller = fakeCaller({
		register: () => { registrations += 1; return { ok: true }; },
		poll: () => {
			polls += 1;
			return polls === 2 ? { ok: false, requests: [] } : { ok: true, requests: [] };
		},
	});
	const listener = new DshIdeLaunchListener(caller, 'ide-7', () => undefined);
	listener.start();
	await wait(DSH_IDE_LAUNCH_POLL_MS * 4);
	assert.ok(registrations >= 2, `must re-register after ok:false (registrations=${registrations})`);
	listener.dispose();
});

test('dispose during registration unregisters and does not dispatch a later poll', async () => {
	let finishRegister: (value: { ok: true }) => void = () => undefined;
	let finishPoll: (value: { ok: true; requests: { workspace: string }[] }) => void = () => undefined;
	const caller = fakeCaller({
		register: () => new Promise(resolve => { finishRegister = resolve; }),
		poll: () => new Promise(resolve => { finishPoll = resolve; }),
	});
	const launched: DshIdeLaunchRequest[] = [];
	const listener = new DshIdeLaunchListener(caller, 'ide-6', request => launched.push(request));
	listener.start();
	await wait(20);
	listener.dispose();
	finishRegister({ ok: true });
	await wait(20);
	assert.deepEqual(caller.calls.map(call => call.method), ['registerIdeClient', 'unregisterIdeClient']);
	assert.deepEqual(caller.calls[0].args, { clientId: 'ide-6', wireRevision: DSH_IDE_WIRE_REVISION });
	assert.deepEqual(caller.calls[1].args, { clientId: 'ide-6', wireRevision: DSH_IDE_WIRE_REVISION });
	finishPoll({ ok: true, requests: [{ workspace: 'E:\\late' }] });
	await wait(20);
	assert.deepEqual(launched, [], 'a poll that resolves after dispose must not open a window');
});

test('the IDE-side call shapes match the Host method parameter names', async () => {
	// Typert SRC 模式把**形参名**当 wire 字段，多一个/少一个都会被判 invalid。
	// 这条测试直接读两半源码，锁住「调用形状 == 方法签名」，防止再出现漏 wireRevision 的回归。
	const fs = await import('node:fs');
	const host = fs.readFileSync('src/vs/platform/dshClient/host/ide-service.js', 'utf8');
	const hostParams = new Map<string, string[]>();
	for (const match of host.matchAll(/(?:async\s+\*?)?(launch|registerIdeClient|unregisterIdeClient|pollLaunch|followSession|dispatch)\(([^)]*)\)\s*\{/g)) {
		hostParams.set(match[1], match[2].split(',').map(part => part.trim()).filter(part => part !== 'signal'));
	}
	assert.deepEqual(hostParams.get('registerIdeClient'), ['clientId', 'wireRevision']);
	assert.deepEqual(hostParams.get('pollLaunch'), ['clientId', 'wireRevision', 'waitMs']);
	assert.deepEqual(hostParams.get('unregisterIdeClient'), ['clientId', 'wireRevision']);

	const listener = fs.readFileSync('src/vs/platform/dshClient/transport/dshIdeLaunchListener.ts', 'utf8');
	const queueSource = fs.readFileSync('src/vs/platform/dshClient/host/ide-launch-queue.js', 'utf8');
	const cap = /export const IDE_CLIENT_LONG_POLL_MS = (\d+)/.exec(queueSource);
	const asked = /export const DSH_IDE_LAUNCH_WAIT_MS = (\d+)/.exec(listener);
	assert.ok(cap !== null && asked !== null, 'both halves must name the long-poll budget');
	assert.equal(cap[1], asked[1], 'the IDE must not ask to wait longer than the Host will actually hold the call');
	for (const method of ['registerIdeClient', 'pollLaunch', 'unregisterIdeClient']) {
		const call = new RegExp(`call\\('ide', '${method}', \\{([^}]*)\\}\\)`).exec(listener);
		assert.ok(call !== null, `${method} must be called`);
		const keys = [...call[1].matchAll(/(\w+):/g)].map(match => match[1]);
		assert.deepEqual(keys, hostParams.get(method), `${method} call keys must equal the Host parameter names`);
	}
});
