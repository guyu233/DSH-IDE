/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH 帧消费者：结构校验、连续性 fail-closed、16ms 合并、帧原样交给渲染方。
// 运行：node --experimental-strip-types --test build/lib/test/dshIdeConsumer.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	DSH_IDE_SNAPSHOT_STALE,
	DSH_IDE_WIRE_REVISION,
	type DshIdeSnapshot,
} from '../../../src/vs/platform/dshClient/common/dshIdeProtocol.ts';
import { DSH_IDE_MERGE_WINDOW_MS, DshIdeConsumer, type DshIdeConsumerState } from '../../../out/vs/workbench/contrib/dsh/browser/dshIdeConsumer.js';

function frame(type = 'event'): Record<string, unknown> {
	return { type, event: { type: 'user/message', seq: 1, time: 1, data: {} } };
}

function ready(version: number, payload: Record<string, unknown> = frame(), channelId = 'ch-1'): DshIdeSnapshot {
	return {
		wireRevision: DSH_IDE_WIRE_REVISION,
		channelId,
		version,
		state: { state: 'ready', view: { frame: payload } },
	};
}

function starting(version: number, channelId = 'ch-1'): DshIdeSnapshot {
	return { wireRevision: DSH_IDE_WIRE_REVISION, channelId, version, state: { state: 'starting' } };
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
