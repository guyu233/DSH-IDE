/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 输入区两个 dock 槽的投影单测（契约附录 A §2 的 `conversation.input.dock` /
// `conversation.composer.dock`，以及 §1 的 list/order 语义）。
// 运行：node --experimental-strip-types --test build/lib/test/dshInputDock.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dshChatSlotRegistry, DSH_COMPOSER_DOCK_SLOT, DSH_INPUT_DOCK_SLOT } from '../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatSlots.ts';
import { dshComposerDockRows, dshInputDockRows } from '../../../src/vs/workbench/contrib/dsh/browser/vscode/dshInputDock.ts';

function register(slot: string, id: string, props: Record<string, unknown>, order = 0): { dispose(): void } {
	return dshChatSlotRegistry.register(slot, { id, order, props });
}

test('both docks are declared as official list/session slots', () => {
	const catalog = new Map(dshChatSlotRegistry.catalog().slots.map(entry => [entry.name, entry]));
	const input = catalog.get(DSH_INPUT_DOCK_SLOT);
	assert.equal(input?.cardinality, 'list');
	assert.deepEqual(input?.ownerProps, ['session', 'input'], 'the owner is the official InputZone { session, input }');
	const composer = catalog.get(DSH_COMPOSER_DOCK_SLOT);
	assert.equal(composer?.cardinality, 'list');
	assert.deepEqual(composer?.ownerProps, [], 'composer.dock has no owner props in the official SlotMap');
});

test('input.dock rows sort by order and refuse to render without a session', () => {
	const late = register(DSH_INPUT_DOCK_SLOT, 'b', { label: 'second' }, 20);
	const early = register(DSH_INPUT_DOCK_SLOT, 'a', { label: 'first', description: 'why' }, 10);
	try {
		assert.deepEqual(dshInputDockRows('s1', undefined), [], 'a session-scoped slot must not render without a session');
		const rows = dshInputDockRows('s1', { session: { id: 's1' } });
		assert.deepEqual(rows.map(row => row.label), ['first', 'second']);
		assert.equal(rows[0].description, 'why');
	} finally {
		early.dispose();
		late.dispose();
	}
	assert.deepEqual(dshInputDockRows('s1', { session: { id: 's1' } }), [], 'disposing the occupants must clear the rows');
});

test('an occupant without a label is skipped instead of drawing an empty row', () => {
	const blank = register(DSH_INPUT_DOCK_SLOT, 'blank', { label: '   ' });
	const missing = register(DSH_INPUT_DOCK_SLOT, 'missing', {});
	try {
		assert.deepEqual(dshInputDockRows('s1', { session: { id: 's1' } }), []);
	} finally {
		blank.dispose();
		missing.dispose();
	}
});

test('composer.dock carries the click command and its arguments', () => {
	const entry = register(DSH_COMPOSER_DOCK_SLOT, 'note', { label: 'Open queue', command: 'dsh.queue.open', arguments: ['s1', 1] }, 5);
	try {
		const rows = dshComposerDockRows('s1');
		assert.equal(rows.length, 1);
		assert.equal(rows[0].command, 'dsh.queue.open');
		assert.deepEqual(rows[0].arguments, ['s1', 1]);
		assert.deepEqual(dshComposerDockRows(undefined), [], 'composer.dock also requires a session');
	} finally {
		entry.dispose();
	}
});

test('the two docks are independent projections of their own slot', () => {
	const input = register(DSH_INPUT_DOCK_SLOT, 'only-input', { label: 'input side' });
	const composer = register(DSH_COMPOSER_DOCK_SLOT, 'only-composer', { label: 'composer side' });
	try {
		assert.deepEqual(dshInputDockRows('s1', { session: { id: 's1' } }).map(row => row.id), ['only-input']);
		assert.deepEqual(dshComposerDockRows('s1').map(row => row.id), ['only-composer']);
	} finally {
		input.dispose();
		composer.dispose();
	}
});

test('a single queued message renders its text preview on the queue row', async () => {
	const { dshQueueDockRows } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshInputDock.ts');
	const rows = dshQueueDockRows([{ id: 'm1', sourceKind: 'user', content: [{ type: 'text', text: '排队的问题' }] }]);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].id, 'queue');
	assert.equal(rows[0].label, '排队的问题');
	assert.equal(rows[0].order, 20, 'the official queue dock registers at order 20');
});

test('multiple queued messages collapse into a count row with the first preview', async () => {
	const { dshQueueDockRows } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshInputDock.ts');
	const rows = dshQueueDockRows([
		{ id: 'm1', sourceKind: 'user', content: [{ type: 'text', text: 'first' }] },
		{ id: 'm2', sourceKind: 'user', content: [{ type: 'text', text: 'second' }] },
	]);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].description, 'first', 'the header keeps the first preview');
	assert.match(rows[0].label, /2/);
});

test('a queued message with only attachments previews the attachment names', async () => {
	const { dshQueueDockRows } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshInputDock.ts');
	const rows = dshQueueDockRows([{ id: 'm1', sourceKind: 'user', content: [{ type: 'image', name: 'shot.png' }, { type: 'file', name: 'notes.md' }] }]);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].label, 'shot.png, notes.md');
	// 正文与附件都没有时不画空行。
	assert.deepEqual(dshQueueDockRows([{ id: 'm2', sourceKind: 'user', content: [] }]), []);
	assert.deepEqual(dshQueueDockRows(undefined), []);
});

test('the next-step queue renders as its own row, not merged into next-turn', async () => {
	// 官方 `inbox` 有两个队列：`next-turn`（排队等下一轮）与 `next-step`（转向当前轮）。
	// 它们的状态机与处置不同（一个可等、一个立刻插队），合成一行会让用户分不清。
	const { dshQueueDockRows } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshInputDock.ts');
	const messages = [{ id: 'm1', sourceKind: 'user', content: [{ type: 'text', text: 'steer me' }] }];
	const turn = dshQueueDockRows(messages, 'next-turn');
	const step = dshQueueDockRows(messages, 'next-step');
	assert.equal(turn[0].id, 'queue');
	assert.equal(step[0].id, 'queue-steer', 'the two queues must not share a row id');
	assert.notEqual(turn[0].order, step[0].order, 'and must not share an order slot');
	assert.equal(turn[0].label, 'steer me');
	assert.equal(step[0].label, 'steer me');
});

test('multiple next-step messages show a steer-specific count, not the queued wording', async () => {
	const { dshQueueDockRows } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshInputDock.ts');
	const messages = [
		{ id: 'm1', sourceKind: 'user', content: [{ type: 'text', text: 'a' }] },
		{ id: 'm2', sourceKind: 'user', content: [{ type: 'text', text: 'b' }] },
	];
	const step = dshQueueDockRows(messages, 'next-step');
	assert.match(step[0].label, /2/);
	assert.equal(step[0].description, 'a');
	// `next-turn` 的多条仍是 queued 措辞：两个队列的计数文案不能互换。
	assert.doesNotMatch(dshQueueDockRows(messages, 'next-turn')[0].label, /steer/i);
});

test('the composer usage row shows total tokens and cache hit rate', async () => {
	// 官方「Turn token usage」：The composer statistics are two conversation.composer.dock list
	// entries: activity (order 0 …) and **usage (order 1, token total and cache hit)**。
	const { dshComposerUsageRows } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshInputDock.ts');
	// 四桶相加；cacheRead 占「可缓存输入」（uncached + cacheRead）的比例。
	const rows = dshComposerUsageRows({ uncachedInputTokens: 300, outputTokens: 100, cacheReadTokens: 100, cacheWriteTokens: 0 });
	assert.equal(rows.length, 1);
	assert.equal(rows[0].order, 1, 'the usage entry is order 1');
	assert.equal(rows[0].id, 'composer-usage');
	assert.ok(rows[0].label.includes('500'), `total is 300+100+100+0: "${rows[0].label}"`);
	assert.ok(rows[0].label.includes('25'), `cache hit is 100/(300+100)=25%: "${rows[0].label}"`);
	// 全零不画（那是「还没有用量」，不是「用量为 0」）。
	assert.deepEqual(dshComposerUsageRows({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }), []);
	// 没有数据源时不画。
	assert.deepEqual(dshComposerUsageRows(undefined), []);
	// 没有可缓存输入时不报命中率（不除以 0，也不伪造 0%）。
	const noCache = dshComposerUsageRows({ uncachedInputTokens: 0, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 5 });
	assert.equal(noCache.length, 1);
	assert.ok(!noCache[0].label.includes('cache hit'), `must omit the rate: "${noCache[0].label}"`);
});

test('compact performance mode keeps only the cache-hit percentage', async () => {
	// 官方 ui-chat.performanceUsage：Compact shows only available output speed and cache-hit
	// percentage beneath the composer, without interactive statistic dialogs or per-Turn usage。
	// 本仓没有权威的输出速度数据源（官方措辞是 available output speed），所以 compact 只保留命中率。
	const { dshComposerUsageRows } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshInputDock.ts');
	const usage = { uncachedInputTokens: 300, outputTokens: 100, cacheReadTokens: 100, cacheWriteTokens: 0 };
	const detailed = dshComposerUsageRows(usage, 'detailed');
	const compact = dshComposerUsageRows(usage, 'compact');
	// detailed：总量 + 命中率。
	assert.ok(detailed[0].label.includes('500'));
	assert.ok(detailed[0].label.includes('25'));
	// compact：只留命中率，不显示总量。
	assert.equal(compact.length, 1);
	assert.ok(compact[0].label.includes('25'), `keeps the rate: "${compact[0].label}"`);
	assert.ok(!compact[0].label.includes('500'), `drops the total: "${compact[0].label}"`);
	// compact 且没有命中率（无可缓存输入）→ 整行不画，不伪造速度。
	const noRate = { uncachedInputTokens: 0, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 5 };
	assert.deepEqual(dshComposerUsageRows(noRate, 'compact'), []);
	// detailed 仍显示总量。
	assert.equal(dshComposerUsageRows(noRate, 'detailed').length, 1);
	// 缺省 mode 等价 detailed。
	assert.deepEqual(dshComposerUsageRows(usage), dshComposerUsageRows(usage, 'detailed'));
});

test('the composer activity row divides measured pressure by the route capacity', async () => {
	// 官方 token-meter README：A UI computes occupancy by **dividing measured pressure by the
	// separately resolved capacity for the selected model**。
	// 缺分子或缺分母都不画——不猜分母、也不拿 projectedTokens 冒充实测压力。
	const { dshComposerActivityRows } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshInputDock.ts');
	const rows = dshComposerActivityRows({ pressureTokens: 25_000, contextWindow: 100_000 });
	assert.equal(rows.length, 1);
	assert.equal(rows[0].order, 0, 'the activity entry is order 0');
	assert.equal(rows[0].id, 'composer-activity');
	assert.ok(rows[0].label.includes('25'), `25000/100000 is 25%: "${rows[0].label}"`);
	// 缺压力：不画。
	assert.deepEqual(dshComposerActivityRows({ contextWindow: 100_000 }), []);
	// 缺容量：不画（分母不可猜）。
	assert.deepEqual(dshComposerActivityRows({ pressureTokens: 25_000 }), []);
	// 容量为 0：不画（不除以 0）。
	assert.deepEqual(dshComposerActivityRows({ pressureTokens: 1, contextWindow: 0 }), []);
	// 没有投影：不画。
	assert.deepEqual(dshComposerActivityRows(undefined), []);
	// compact 模式：不画（官方 compact 只留输出速度与命中率）。
	assert.deepEqual(dshComposerActivityRows({ pressureTokens: 25_000, contextWindow: 100_000 }, 'compact'), []);
	// 超过容量时钳到 100%，不报 120%。
	const over = dshComposerActivityRows({ pressureTokens: 120_000, contextWindow: 100_000 });
	assert.ok(over[0].label.includes('100'), `clamped to 100%: "${over[0].label}"`);
});

test('the composer breakdown row reports composition shares, never a total', async () => {
	// 官方 token-meter README 两条硬约束：contextBreakdown 是 the context's composition,
	// not its provider-billed size；Present these as approximations of composition, never as a total。
	const { dshComposerBreakdownRows } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshInputDock.ts');
	const rows = dshComposerBreakdownRows({ systemTokens: 100, toolsTokens: 300, messageTokens: 600 });
	assert.equal(rows.length, 1);
	assert.equal(rows[0].order, 2);
	assert.equal(rows[0].id, 'composer-breakdown');
	// 比例：10% / 30% / 60%（和为 100%）。
	assert.ok(rows[0].label.includes('10'), `system 10%: "${rows[0].label}"`);
	assert.ok(rows[0].label.includes('30'), `tools 30%: "${rows[0].label}"`);
	assert.ok(rows[0].label.includes('60'), `messages 60%: "${rows[0].label}"`);
	// **不报总量**：三项之和 1000 不得出现在文案里（把和当上下文大小会误导）。
	assert.ok(!rows[0].label.includes('1000'), `must not show the sum as a total: "${rows[0].label}"`);
	// 三项全 0：不画空壳，也不显示 0%。
	assert.deepEqual(dshComposerBreakdownRows({ systemTokens: 0, toolsTokens: 0, messageTokens: 0 }), []);
	// 没有投影：不画。
	assert.deepEqual(dshComposerBreakdownRows(undefined), []);
	// compact：不画。
	assert.deepEqual(dshComposerBreakdownRows({ systemTokens: 1, toolsTokens: 1, messageTokens: 1 }, 'compact'), []);
});
