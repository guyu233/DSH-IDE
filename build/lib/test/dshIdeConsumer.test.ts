/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P4 验收单测：`DshIdeConsumer`（快照校验 → 连续性 fail-closed → 16ms 合并 → 行级 diff）。
//
// 关键场景（第 4 章 T7 / 第 2 章 §5.1）：
//   - version 断号 / 倒退 / channelId 变化 → 拒绝该帧且不改变已渲染状态；
//   - 16ms 窗口内多帧合并为一次渲染；
//   - rows 按稳定 id diff，只把新增/变更交给渲染方；
//   - starting / rebuild 帧不携带投影载荷时保持现有行。
//
// 运行：node --experimental-strip-types --test build/lib/test/dshIdeConsumer.test.ts
// 消费者经 `out/`（build-dsh-tests 转译产物）加载：它依赖 base/common 的 .js 说明符，
// 直接指向 src/*.ts 会解析不到同目录的 .js 兄弟文件。协议常量仍从 src 真源加载。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	DSH_IDE_SNAPSHOT_STALE,
	DSH_IDE_WIRE_REVISION,
	type DshIdeRow,
	type DshIdeSnapshot,
} from '../../../src/vs/platform/dshClient/common/dshIdeProtocol.ts';
import {
	DSH_IDE_MERGE_WINDOW_MS,
	DshIdeConsumer,
	type DshIdeConsumerState,
	type DshIdeRowDiff,
} from '../../../out/vs/workbench/contrib/dsh/browser/dshIdeConsumer.js';

function row(id: string, revision = 1, text = `text-${id}`): DshIdeRow {
	return { id, revision, kind: 'assistant', text, folded: false };
}

function ready(version: number, rows: DshIdeRow[], channelId = 'ch-1'): DshIdeSnapshot {
	return {
		wireRevision: DSH_IDE_WIRE_REVISION,
		channelId,
		version,
		state: { state: 'ready', view: { rows, version } },
	};
}

function starting(version: number, channelId = 'ch-1'): DshIdeSnapshot {
	return { wireRevision: DSH_IDE_WIRE_REVISION, channelId, version, state: { state: 'starting' } };
}

/** 等过合并窗口，让被调度的渲染真正发生。 */
async function settle(): Promise<void> {
	await new Promise(resolve => setTimeout(resolve, DSH_IDE_MERGE_WINDOW_MS + 12));
}

// ---------------------------------------------------------------------------
// 正常路径：接受、合并、diff
// ---------------------------------------------------------------------------

test('accepts a starting frame then a ready frame with projected rows', async () => {
	const consumer = new DshIdeConsumer();
	const changes: { state: DshIdeConsumerState; diff: DshIdeRowDiff }[] = [];
	consumer.onDidChangeRows(e => changes.push(e));

	assert.equal(consumer.accept(starting(1)), true);
	await settle();
	assert.equal(consumer.state.phase, 'starting');
	assert.equal(consumer.state.rows.length, 0, 'a starting frame carries no rows');

	assert.equal(consumer.accept(ready(2, [row('row:1'), row('row:2')])), true);
	await settle();
	assert.equal(consumer.state.phase, 'ready');
	assert.deepEqual(consumer.state.rows.map(r => r.id), ['row:1', 'row:2']);
	assert.equal(consumer.state.version, 2);
	consumer.dispose();
});

test('merges frames arriving inside the 16ms window into one render', async () => {
	const consumer = new DshIdeConsumer();
	let renders = 0;
	consumer.onDidChangeRows(() => { renders += 1; });

	consumer.accept(starting(1));
	await settle();
	const before = renders;

	// 同一 tick 内连推三帧：只有最后一帧（最全）生效。
	consumer.accept(ready(2, [row('row:1')]));
	consumer.accept(ready(3, [row('row:1'), row('row:2')]));
	consumer.accept(ready(4, [row('row:1'), row('row:2'), row('row:3')]));
	await settle();

	assert.equal(renders - before, 1, 'the window must coalesce into a single render');
	assert.equal(consumer.state.rows.length, 3);
	assert.equal(consumer.state.version, 4);
	consumer.dispose();
});

test('diffs rows by stable id and reports only added or changed rows', async () => {
	const consumer = new DshIdeConsumer();
	let last: DshIdeRowDiff | undefined;
	consumer.onDidChangeRows(e => { last = e.diff; });

	consumer.accept(ready(1, [row('row:1'), row('row:2')]));
	await settle();
	assert.deepEqual(last?.added.map(r => r.id), ['row:1', 'row:2']);
	assert.deepEqual(last?.changed, []);

	// 第二帧：row:1 内容变化（revision+1）、row:2 不变、row:3 新增。
	consumer.accept(ready(2, [row('row:1', 2, 'edited'), row('row:2'), row('row:3')]));
	await settle();
	assert.deepEqual(last?.added.map(r => r.id), ['row:3']);
	assert.deepEqual(last?.changed.map(r => r.id), ['row:1'], 'only the row whose revision changed is reported');
	assert.equal(consumer.state.rows.length, 3);
	consumer.dispose();
});

test('drops a row removed from the snapshot', async () => {
	const consumer = new DshIdeConsumer();
	consumer.accept(ready(1, [row('row:1'), row('row:2')]));
	await settle();
	consumer.accept(ready(2, [row('row:1')]));
	await settle();
	assert.deepEqual(consumer.state.rows.map(r => r.id), ['row:1']);
	consumer.dispose();
});

// ---------------------------------------------------------------------------
// fail-closed：连续性违规不得改变已渲染状态
// ---------------------------------------------------------------------------

test('a version gap fails closed with SNAPSHOT_STALE and keeps the rendered rows', async () => {
	const consumer = new DshIdeConsumer();
	const failures: { code: string; message: string }[] = [];
	consumer.onDidFail(e => failures.push({ code: e.code, message: e.message }));

	consumer.accept(ready(1, [row('row:1')]));
	await settle();
	const rendered = consumer.state.rows.map(r => r.id);
	const version = consumer.state.version;

	// 断号：2 → 5
	assert.equal(consumer.accept(ready(5, [row('row:9')])), false);
	assert.equal(failures.length, 1);
	assert.equal(failures[0].code, DSH_IDE_SNAPSHOT_STALE, 'a gap must be surfaced as SNAPSHOT_STALE');
	assert.deepEqual(consumer.state.rows.map(r => r.id), rendered, 'rendered rows must not change');
	assert.equal(consumer.state.version, version, 'the accepted version must not advance');

	// 已 fail-closed：后续帧一律拒绝。
	assert.equal(consumer.accept(ready(6, [row('row:10')])), false);
	consumer.dispose();
});

test('a backwards version fails closed instead of overwriting state', async () => {
	const consumer = new DshIdeConsumer();
	const failures: string[] = [];
	consumer.onDidFail(e => failures.push(e.code));
	consumer.accept(ready(5, [row('row:5')]));
	await settle();
	assert.equal(consumer.accept(ready(3, [row('row:3')])), false);
	assert.equal(failures.length, 1);
	assert.deepEqual(consumer.state.rows.map(r => r.id), ['row:5']);
	consumer.dispose();
});

test('a channelId change fails closed', async () => {
	const consumer = new DshIdeConsumer();
	const failures: string[] = [];
	consumer.onDidFail(e => failures.push(e.code));
	consumer.accept(ready(1, [row('row:1')], 'ch-1'));
	await settle();
	assert.equal(consumer.accept(ready(2, [row('row:2')], 'ch-2')), false);
	assert.equal(failures.length, 1, 'switching channel must be refused, never merged');
	assert.deepEqual(consumer.state.rows.map(r => r.id), ['row:1']);
	consumer.dispose();
});

test('a structurally invalid frame is refused without touching state', async () => {
	const consumer = new DshIdeConsumer();
	const failures: string[] = [];
	consumer.onDidFail(e => failures.push(e.code));
	consumer.accept(ready(1, [row('row:1')]));
	await settle();

	assert.equal(consumer.accept({ nonsense: true }), false);
	assert.equal(consumer.accept({ ...ready(2, []), __extra: 1 }), false);
	// 同一失败原因只上报一次（避免逐帧刷屏）；两帧都是「结构非法」。
	assert.equal(failures.length, 1);
	assert.equal(failures[0], 'dsh-ide/invalid-argument');
	assert.deepEqual(consumer.state.rows.map(r => r.id), ['row:1']);
	consumer.dispose();
});

test('reset clears the failure latch so a new flow instance can start', async () => {
	const consumer = new DshIdeConsumer();
	consumer.accept(ready(1, [row('row:1')]));
	await settle();
	assert.equal(consumer.accept(ready(9, [row('row:9')])), false);

	consumer.reset();
	assert.equal(consumer.state.rows.length, 0);
	assert.equal(consumer.state.version, -1);
	assert.equal(consumer.state.phase, 'none');

	assert.equal(consumer.accept(ready(1, [row('row:2')])), true, 'after reset the consumer accepts a fresh sequence');
	await settle();
	assert.deepEqual(consumer.state.rows.map(r => r.id), ['row:2']);
	consumer.dispose();
});

// ---------------------------------------------------------------------------
// starting / rebuild 不携带载荷
// ---------------------------------------------------------------------------

test('a rebuild frame keeps existing rows until a fresh ready frame arrives', async () => {
	const consumer = new DshIdeConsumer();
	consumer.accept(ready(1, [row('row:1')]));
	await settle();
	consumer.accept({ wireRevision: DSH_IDE_WIRE_REVISION, channelId: 'ch-1', version: 2, state: { state: 'rebuild' } });
	await settle();
	assert.deepEqual(consumer.state.rows.map(r => r.id), ['row:1'], 'rebuild must not wipe the current view');
	assert.equal(consumer.state.phase, 'rebuild');
	consumer.dispose();
});
