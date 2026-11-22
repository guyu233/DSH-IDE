/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH 帧消费者：结构校验、连续性 fail-closed、16ms 合并、帧原样交给渲染方。
// 运行：node --experimental-strip-types --test build/lib/test/dshIdeConsumer.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	DSH_IDE_SNAPSHOT_STALE,
	DSH_IDE_WIRE_REVISION,
	type DshIdeSnapshot,
} from '../../../src/vs/platform/dshClient/protocol/dshIdeProtocol.ts';
import { DSH_IDE_MERGE_WINDOW_MS, DshIdeConsumer, type DshIdeConsumerState } from '../../../out/vs/workbench/contrib/dsh/browser/consumer/dshIdeConsumer.js';

function frame(type = 'event'): Record<string, unknown> {
	return { type, event: { type: 'user/message', seq: 1, time: 1, data: {} } };
}

function binding(channelId = 'ch-1') {
	return { viewId: channelId, generation: 1, sessionId: null };
}

function ready(version: number, payload: Record<string, unknown> = frame(), channelId = 'ch-1'): DshIdeSnapshot {
	return {
		wireRevision: DSH_IDE_WIRE_REVISION,
		channelId,
		version,
		binding: binding(channelId),
		state: { state: 'ready', view: { frame: payload } },
	};
}

function starting(version: number, channelId = 'ch-1'): DshIdeSnapshot {
	return { wireRevision: DSH_IDE_WIRE_REVISION, channelId, version, binding: binding(channelId), state: { state: 'starting' } };
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, DSH_IDE_MERGE_WINDOW_MS + 8));

test('accepts a starting frame then a ready frame and hands the raw frame on', async () => {
	const consumer = new DshIdeConsumer();
	const seen: DshIdeConsumerState[] = [];
	consumer.onDidChangeFrame(({ state }) => seen.push(state));

	assert.equal(consumer.accept(starting(1)), true);
	assert.equal(consumer.accept(ready(2)), true);
	await tick();

	// 16ms 合并窗口把首帧与紧随其后的 ready 合成一次渲染；渲染方看到的是最后一帧。
	assert.equal(seen.length, 1);
	assert.equal(seen[0].phase, 'ready');
	assert.deepEqual(seen[0].frame, frame());
	consumer.dispose();
});

test('an unchanged ready view does not repaint', () => {
	// 内核会周期性重发同一份快照。version 严格递增，所以判重看的是
	// 「version 与状态都没变」这一条件本身；这里钉住它确实存在且返回得早。
	const source = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/consumer/dshIdeConsumer.ts', import.meta.url), 'utf8');
	assert.match(source, /previous\.version === frame\.version/, 'the version must take part in the dedupe');
	assert.match(source, /previous\.state\.state === frame\.state\.state/, 'the phase must take part in the dedupe');
	assert.match(source, /if \(unchanged\) \{\s*\n\s*return;/, 'an unchanged frame must return before firing');
	// 换绑时绝不能判重：那是新会话的首帧。
	assert.match(source, /&& !rebound/, 'a rebound must always repaint');
});

test('merges frames arriving inside the 16ms window into the last one', async () => {
	const consumer = new DshIdeConsumer();
	const seen: DshIdeConsumerState[] = [];
	consumer.onDidChangeFrame(({ state }) => seen.push(state));

	consumer.accept(starting(1));
	consumer.accept(ready(2, frame('snapshot')));
	consumer.accept(ready(3, frame('assistant-stream')));
	await tick();

	assert.equal(seen.length, 1, 'only the last frame inside the window is rendered');
	assert.equal(seen[0].version, 3);
	assert.equal((seen[0].frame as { type: string }).type, 'assistant-stream');
	consumer.dispose();
});

test('a version gap fails closed with SNAPSHOT_STALE and keeps the rendered frame', async () => {
	const consumer = new DshIdeConsumer();
	const failures: { code: string }[] = [];
	const seen: DshIdeConsumerState[] = [];
	consumer.onDidFail(error => failures.push(error));
	consumer.onDidChangeFrame(({ state }) => seen.push(state));

	consumer.accept(starting(1));
	consumer.accept(ready(2));
	await tick();
	const rendered = seen.at(-1);

	assert.equal(consumer.accept(ready(4)), false);
	assert.deepEqual(failures.map(failure => failure.code), [DSH_IDE_SNAPSHOT_STALE]);
	assert.equal(consumer.state.frame, rendered?.frame);
	// 熔断必须对外可见：贡献点据此调 `refreshSnapshot` 再 reset，否则界面永久停更。
	// 熔断后继续喂**合法**帧也必须被拒，且**不能再触发新的失败通知**：
	// 否则每一帧都会重复 fire，界面反复弹「需要刷新」。
	// 注意不能只断言返回 false——连续性检查同样返回 false，两者区分不开；
	// 这里用「失败通知次数不增加」来钉住确实是熔断在拦，而不是又走了一遍连续性判断。
	const failuresBefore = failures.length;
	assert.equal(consumer.accept(ready(5)), false, 'a tripped fuse must keep rejecting frames');
	assert.equal(failures.length, failuresBefore, 'a tripped fuse must not fire another failure');
	assert.equal(consumer.needsRefresh, true, 'a stale frame must mark the consumer as needing a refresh');
	consumer.reset();
	assert.equal(consumer.needsRefresh, false, 'reset must clear the fuse after the Host rebuilds the baseline');
	consumer.dispose();
});

test('a ready view keeps the whole typed payload for renderers', async () => {
	const consumer = new DshIdeConsumer();
	const seen: DshIdeConsumerState[] = [];
	consumer.onDidChangeFrame(({ state }) => seen.push(state));
	const conversation = { hasMore: false, nodes: [{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'hi' }] }] };
	const snapshot: DshIdeSnapshot = {
		wireRevision: DSH_IDE_WIRE_REVISION,
		channelId: 'ch-1',
		binding: { viewId: 'ch-1', generation: 1, sessionId: null },
		version: 1,
		binding: binding(),
		state: { state: 'ready', view: { frame: frame(), conversation, quotaNotice: { code: 'QUOTA', seq: 3 } } },
	};
	consumer.accept(snapshot);
	await tick();
	const rendered = seen.at(-1);
	// `frame` 只作兼容回退；`view` 必须带全 typed 字段，渲染层才能不解析裸帧。
	assert.deepEqual(rendered?.frame, frame());
	assert.deepEqual(rendered?.view?.conversation, conversation);
	assert.deepEqual(rendered?.view?.quotaNotice, { code: 'QUOTA', seq: 3 });
	assert.equal(consumer.state.view, rendered?.view);
	consumer.dispose();
});

test('a backwards version fails closed instead of overwriting state', async () => {
	const consumer = new DshIdeConsumer();
	consumer.accept(starting(2));
	await tick();
	assert.equal(consumer.accept(ready(1)), false);
	assert.equal(consumer.state.version, 2);
	consumer.dispose();
});

test('a channelId change fails closed', async () => {
	const consumer = new DshIdeConsumer();
	consumer.accept(starting(1, 'a'));
	await tick();
	assert.equal(consumer.accept(ready(2, frame(), 'b')), false);
	assert.equal(consumer.state.channelId, 'a');
	consumer.dispose();
});

test('a structurally invalid frame is refused without touching state', async () => {
	const consumer = new DshIdeConsumer();
	const failures: { code: string }[] = [];
	consumer.onDidFail(error => failures.push(error));
	consumer.accept(starting(1));
	await tick();

	assert.equal(consumer.accept({ wireRevision: 999 }), false);
	assert.equal(consumer.state.version, 1);
	assert.deepEqual(failures.map(failure => failure.code), ['dsh-ide/invalid-argument']);
	consumer.dispose();
});

test('reset clears the rendered frame and lets a new session start again', async () => {
	const consumer = new DshIdeConsumer();
	consumer.accept(starting(1));
	consumer.accept(ready(2));
	await tick();
	assert.ok(consumer.state.frame !== undefined);

	consumer.reset();
	assert.equal(consumer.state.frame, undefined);
	assert.equal(consumer.state.version, -1);
	assert.equal(consumer.accept(starting(1, 'other')), true);
	consumer.dispose();
});

test('every continuity failure is recoverable, not just a version gap', () => {
	// gap / 倒退 / 持平 都意味着本地序列跟不上 Host，三者都只能靠重拉快照恢复。
	// 只把 gap 归为 stale 时，另外两种会把界面永久钉死（failed 只能由 reset() 解除）。
	const cases: { label: string; prev: number; next: number }[] = [
		{ label: 'gap', prev: 5, next: 9 },
		{ label: 'backwards', prev: 5, next: 3 },
		{ label: 'did not advance', prev: 5, next: 5 },
	];
	for (const item of cases) {
		const consumer = new DshIdeConsumer();
		const failures: { code: string; message: string }[] = [];
		consumer.onDidFail(error => failures.push({ code: error.code, message: error.message }));
		assert.equal(consumer.accept(starting(item.prev)), true, `${item.label}: first frame must be accepted`);
		assert.equal(consumer.accept(starting(item.next)), false, `${item.label}: the offending frame must be refused`);
		assert.equal(failures.length, 1, `${item.label}: exactly one failure must be reported`);
		assert.equal(failures[0].code, DSH_IDE_SNAPSHOT_STALE, `${item.label}: must be classified as stale so refreshSnapshot runs`);
		assert.equal(consumer.needsRefresh, true, `${item.label}: the consumer must ask for a refresh`);
		consumer.reset();
		assert.equal(consumer.needsRefresh, false, `${item.label}: reset must clear the state`);
		consumer.dispose();
	}
});

test('a rebuild frame is accepted and does not trip the breaker', () => {
	// `rebuild` 是 Host 的「传输断开、正在重连」信号；它必须能进 consumer，
	// 否则重连后这一帧被拒、熔断置位，界面永久停更。
	const consumer = new DshIdeConsumer();
	const failures: string[] = [];
	consumer.onDidFail(error => failures.push(error.code));

	const starting = (version: number) => ({
		wireRevision: DSH_IDE_WIRE_REVISION,
		channelId: 'ch-1',
		version,
		binding: binding('ch-1'),
		state: { state: 'rebuild' as const },
	});
	assert.equal(consumer.accept(starting(1)), true, 'a rebuild frame must be accepted');
	assert.equal(consumer.accept(starting(2)), true, 'a second rebuild frame must also be accepted');
	assert.equal(failures.length, 0, 'rebuild must not report a failure');
	assert.equal(consumer.needsRefresh, false, 'rebuild must not trip the breaker');
	consumer.dispose();
});

test('an in-window merge keeps the newest value of every optional field', async () => {
	// 合并窗口把多帧折成一帧。缺席表示「本帧没带」，此时沿用上一帧；
	// 带了就以新值为准。方向搞反的话，界面会停在旧内容。
	const frame = (version: number, plan?: { active: boolean; pending: boolean }) => ({
		channelId: 'c',
		wireRevision: 5,
		version,
		binding: { viewId: 'c', generation: 1, sessionId: 's' },
		state: { state: 'ready', view: { frame: { type: 't' }, ...(plan === undefined ? {} : { plan }) } },
	});

	// 新值必须胜出。
	const a = new DshIdeConsumer();
	const seenA: unknown[] = [];
	a.onDidChangeFrame(({ state }) => seenA.push(state.view));
	a.accept(frame(1, { active: true, pending: false }));
	a.accept(frame(2, { active: false, pending: true }));
	await new Promise(resolve => setTimeout(resolve, 60));
	a.dispose();
	const planA = (seenA.at(-1) as { plan?: { active: boolean } }).plan;
	assert.equal(planA?.active, false, 'the newest frame must win');

	// 中间帧不带该字段时，最终帧带了就仍以最终帧为准。
	const b = new DshIdeConsumer();
	const seenB: unknown[] = [];
	b.onDidChangeFrame(({ state }) => seenB.push(state.view));
	b.accept(frame(1, { active: true, pending: false }));
	b.accept(frame(2));
	b.accept(frame(3, { active: false, pending: true }));
	await new Promise(resolve => setTimeout(resolve, 60));
	b.dispose();
	const planB = (seenB.at(-1) as { plan?: { active: boolean } }).plan;
	assert.equal(planB?.active, false, 'a later frame carrying the field must win');

	// 最终帧不带该字段时沿用上一帧带来的值。
	const c = new DshIdeConsumer();
	const seenC: unknown[] = [];
	c.onDidChangeFrame(({ state }) => seenC.push(state.view));
	c.accept(frame(1, { active: true, pending: false }));
	c.accept(frame(2, { active: false, pending: true }));
	c.accept(frame(3));
	await new Promise(resolve => setTimeout(resolve, 60));
	c.dispose();
	const planC = (seenC.at(-1) as { plan?: { active: boolean } }).plan;
	assert.equal(planC?.active, false, 'a field missing from the last frame must be carried over');
});

test('可选字段清单与契约的视角字段一一对齐（漏一个就会每帧丢字段）', () => {
	// 依据 CHK-239：`DSH_IDE_VIEW_OPTIONAL_KEYS` 与契约 `DshIdeViewSnapshot` 的可选字段
	// 是两处维护的同一份事实。契约新增字段而 consumer 忘记加时，该字段每次帧都会被丢掉
	// （「缺席=保留」语义失效），且不会报错——只能靠这条断言钉住。
	const consumerSource = readFileSync('src/vs/workbench/contrib/dsh/browser/consumer/dshIdeConsumer.ts', 'utf8');
	const block = /const DSH_IDE_VIEW_OPTIONAL_KEYS = \[([\s\S]*?)\] as const;/.exec(consumerSource);
	assert.ok(block, 'DSH_IDE_VIEW_OPTIONAL_KEYS must be a const array');
	const consumerKeys = [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]);

	const protocolSource = readFileSync('src/vs/platform/dshClient/protocol/dshIdeProtocol.ts', 'utf8');
	const viewBlock = /const DSH_IDE_VIEW_KEYS = \[([\s\S]*?)\] as const;/.exec(protocolSource);
	assert.ok(viewBlock, 'DSH_IDE_VIEW_KEYS must be a const array');
	const viewKeys = [...viewBlock[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
	// `frame` 是必填字段（有单独校验），不参与「缺席=保留」的合并。
	const contractOptional = viewKeys.filter(key => key !== 'frame');

	assert.deepEqual(
		[...consumerKeys].sort(),
		[...contractOptional].sort(),
		'consumer 的可选字段清单必须与契约的视角字段（去掉必填的 frame）完全一致',
	);
});
