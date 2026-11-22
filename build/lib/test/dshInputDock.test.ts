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
