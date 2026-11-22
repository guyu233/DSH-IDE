/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DshConversationNodeTree：稳定 key、按 key 通知、turn 切片隔离、底部 exchange、导航。
// 运行：node --experimental-strip-types --test build/lib/test/dshConversationNodeTree.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DshConversationNodeTree, dshNodeKey, type DshIndexedNode } from '../../../src/vs/workbench/contrib/dsh/browser/vscode/dshConversationNodeTree.ts';

interface SampleNode extends DshIndexedNode {
	readonly text?: string;
}

function node(partial: SampleNode): SampleNode {
	return partial;
}

test('node keys prefer messageId and callId over seq', () => {
	assert.equal(dshNodeKey(node({ kind: 'user', seq: 4, messageId: 'm1' })), 'user:m1');
	assert.equal(dshNodeKey(node({ kind: 'tool-result', seq: 9, callId: 'c1' })), 'tool-result:c1');
	assert.equal(dshNodeKey(node({ kind: 'compaction', seq: 3, turn: 1 })), 'compaction:3:1:');
});

test('accept keeps an unchanged key quiet and drops a removed key', () => {
	const tree = new DshConversationNodeTree<SampleNode>('s1');
	const user = node({ kind: 'user', seq: 1, messageId: 'm1', turn: 1, text: 'hello' });
	const assistant = node({ kind: 'assistant', seq: 2, messageId: 'a1', turn: 1, step: 0, text: 'old' });
	const userSource = tree.source('user:m1');
	const assistantSource = tree.source('assistant:a1');
	let userNotes = 0;
	let assistantNotes = 0;
	userSource.subscribe(() => { userNotes++; });
	assistantSource.subscribe(() => { assistantNotes++; });
	const first = tree.accept([assistant, user]);
	assert.deepEqual(first.changed, ['user:m1', 'assistant:a1']);
	assert.equal(userNotes, 1);
	assert.equal(assistantNotes, 1);
	assert.deepEqual(tree.keys(), ['user:m1', 'assistant:a1']);
	const second = tree.accept([
		user,
		node({ kind: 'assistant', seq: 2, messageId: 'a1', turn: 1, step: 0, text: 'new' }),
	]);
	assert.deepEqual(second.changed, ['assistant:a1']);
	assert.equal(userNotes, 1);
	assert.equal(assistantNotes, 2);
	assert.equal(assistantSource.get()?.text, 'new');
	const third = tree.accept([user]);
	assert.deepEqual(third.removed, ['assistant:a1']);
	assert.equal(assistantSource.get(), undefined);
	assert.equal(tree.get('user:m1')?.text, 'hello');
});

test('turnDataSource ignores other turns and other kinds', () => {
	const tree = new DshConversationNodeTree<SampleNode>('s1');
	const tools = tree.turnDataSource(1, 'tool-call');
	const later = tree.turnDataSource(2, 'tool-call');
	let toolNotes = 0;
	let laterNotes = 0;
	tools.subscribe(() => { toolNotes++; });
	later.subscribe(() => { laterNotes++; });
	tree.accept([
		node({ kind: 'tool-call', seq: 1, turn: 1, callId: 'c1', text: 'read' }),
		node({ kind: 'assistant', seq: 2, turn: 1, messageId: 'a1', text: 'answer' }),
	]);
	assert.equal(toolNotes, 1);
	assert.equal(laterNotes, 0);
	assert.equal(tools.get().length, 1);
	tree.accept([
		node({ kind: 'tool-call', seq: 1, turn: 1, callId: 'c1', text: 'read' }),
		node({ kind: 'assistant', seq: 2, turn: 1, messageId: 'a1', text: 'answer changed' }),
		node({ kind: 'tool-call', seq: 3, turn: 2, callId: 'c2', text: 'other' }),
	]);
	assert.equal(toolNotes, 1);
	assert.equal(laterNotes, 1);
	assert.equal(tools.get()[0].text, 'read');
});

test('navigation lists anchors and steps after the latest turn grows', () => {
	// `bottomSource` 曾是「节点是否落在最新 exchange」的观察点，但全仓无消费者
	// （见 CHK-344：连同 `publishBottoms` / `isBottom` / `FlagState` 一并删除）。
	// 这条用例保留其余仍然有消费者的断言。
	const tree = new DshConversationNodeTree<SampleNode>('s1');
	tree.accept([
		node({ kind: 'user', seq: 1, messageId: 'u1', turn: 1, text: 'one' }),
		node({ kind: 'assistant', seq: 2, messageId: 'a1', turn: 1, step: 0, text: 'reply' }),
	]);
	tree.accept([
		node({ kind: 'user', seq: 1, messageId: 'u1', turn: 1, text: 'one' }),
		node({ kind: 'assistant', seq: 2, messageId: 'a1', turn: 1, step: 0, text: 'reply' }),
		node({ kind: 'user', seq: 3, messageId: 'u2', turn: 2, text: 'two' }),
	]);
	assert.deepEqual(tree.navigationItems(), [
		{ turn: 1, anchorKey: 'user:u1', promptKey: 'user:u1', responseKey: 'assistant:a1' },
		{ turn: 2, anchorKey: 'user:u2', promptKey: 'user:u2' },
	]);
	// `getStep` 无生产消费者，已删除（CHK-345）；同一断言改用 `list()` 表达。
	assert.equal(tree.list().filter(node => node.turn === 1 && node.step === 0)[0].kind, 'assistant');
	const shot = tree.snapshot();
	assert.deepEqual(shot.order, ['user:u1', 'assistant:a1', 'user:u2']);
	assert.equal(shot.nodes.get('assistant:a1')?.text, 'reply');
	assert.deepEqual(shot.locations.filter(item => item.turn === 1).map(item => item.key), ['user:u1', 'assistant:a1']);
	assert.equal(shot.navigation.length, 2);
	shot.nodes.delete('assistant:a1');
	assert.equal(tree.get('assistant:a1')?.text, 'reply');
});

test('processSource stays on one turn and clears when the node leaves', () => {
	const tree = new DshConversationNodeTree<SampleNode>('s1');
	tree.accept([
		node({ kind: 'user', seq: 1, messageId: 'u1', turn: 1, text: 'one' }),
		node({ kind: 'tool-call', seq: 2, turn: 1, callId: 'c1', text: 'read' }),
		node({ kind: 'user', seq: 3, messageId: 'u2', turn: 2, text: 'two' }),
	]);
	const process = tree.processSource('tool-call:c1');
	const other = tree.processSource('user:u2');
	let processNotes = 0;
	let otherNotes = 0;
	process.subscribe(() => { processNotes++; });
	other.subscribe(() => { otherNotes++; });
	assert.equal(process.get().length, 2);
	tree.accept([
		node({ kind: 'user', seq: 1, messageId: 'u1', turn: 1, text: 'one' }),
		node({ kind: 'tool-call', seq: 2, turn: 1, callId: 'c1', text: 'read' }),
		node({ kind: 'assistant', seq: 4, messageId: 'a1', turn: 1, step: 0, text: 'done' }),
		node({ kind: 'user', seq: 3, messageId: 'u2', turn: 2, text: 'two' }),
	]);
	assert.equal(processNotes, 1);
	assert.equal(otherNotes, 0);
	assert.equal(process.get().length, 3);
	tree.accept([
		node({ kind: 'user', seq: 3, messageId: 'u2', turn: 2, text: 'two' }),
	]);
	assert.equal(process.get().length, 0);
	assert.equal(other.get().length, 1);
});

test('parentCallId nests a sibling under the parent tool and a cycle stays put', () => {
	const tree = new DshConversationNodeTree<SampleNode>('s1');
	tree.accept([
		node({ kind: 'tool-call', seq: 1, callId: 'parent', name: 'bash' }),
		node({ kind: 'tool-call', seq: 2, callId: 'child', name: 'read', parentCallId: 'parent' } as SampleNode),
		node({ kind: 'tool-call', seq: 3, callId: 'a', parentCallId: 'b' } as SampleNode),
		node({ kind: 'tool-call', seq: 4, callId: 'b', parentCallId: 'a' } as SampleNode),
	]);
	assert.deepEqual(tree.childKeysOf('tool-call:parent'), ['tool-call:child']);
	assert.equal(tree.parentKey('tool-call:child'), 'tool-call:parent');
	assert.equal(tree.list().some(item => item.callId === 'child'), false);
	assert.equal(tree.parentKey('tool-call:a'), 'tool-call:b');
	assert.equal(tree.parentKey('tool-call:b'), undefined);
});

test('subCalls are indexed under their parent and stay out of the top-level order', () => {
	const tree = new DshConversationNodeTree<SampleNode>('s1');
	const child = node({ kind: 'tool-call', seq: 3, turn: 1, callId: 'child', text: 'nested' });
	tree.accept([
		node({
			kind: 'tool-result',
			seq: 2,
			turn: 1,
			callId: 'root',
			text: 'parent',
			subCalls: [child],
		}),
	]);
	assert.deepEqual(tree.keys(), ['tool-result:root']);
	assert.equal(tree.get('tool-call:child')?.text, 'nested');
	assert.equal(tree.parentKey('tool-call:child'), 'tool-result:root');
	assert.deepEqual(tree.childKeysOf('tool-result:root'), ['tool-call:child']);
	assert.equal(tree.turnDataSource(1, 'tool-call').get()[0].callId, 'child');
	const again = tree.accept([
		node({
			kind: 'tool-result',
			seq: 2,
			turn: 1,
			callId: 'root',
			text: 'parent',
			subCalls: [child],
		}),
	]);
	assert.deepEqual(again.changed, []);
});

test('a second session tree does not share keys with the first', () => {
	const left = new DshConversationNodeTree<SampleNode>('left');
	const right = new DshConversationNodeTree<SampleNode>('right');
	left.accept([node({ kind: 'user', seq: 1, messageId: 'm', turn: 1, text: 'left' })]);
	assert.equal(right.get('user:m'), undefined);
	assert.equal(left.sessionId, 'left');
});

test('raw payload and key order do not count as display changes', () => {
	// 契约 §19 S1：`raw` 是整帧源载荷，流式帧每次都会重新序列化；它不出现在
	// 任何渲染路径上，不能被当成「这一行变了」，否则每帧都会通知订阅者。
	const tree = new DshConversationNodeTree<SampleNode & { readonly raw?: unknown; readonly timing?: unknown }>('s1');
	const source = tree.source('assistant:a1');
	let notes = 0;
	source.subscribe(() => { notes++; });
	const base = {
		kind: 'assistant' as const,
		seq: 2,
		messageId: 'a1',
		turn: 1,
		step: 0,
		text: 'same',
		raw: { z: 1, a: 2 },
		timing: { start: 1 },
	};
	assert.deepEqual(tree.accept([{ ...base }]).changed, ['assistant:a1']);
	assert.equal(notes, 1);

	// raw / timing 变化（甚至只是字段顺序变化）不触发通知。
	const second = tree.accept([{ raw: { a: 2, z: 1 }, timing: { start: 2 }, text: 'same', step: 0, turn: 1, messageId: 'a1', seq: 2, kind: 'assistant' }]);
	assert.deepEqual(second.changed, []);
	assert.equal(notes, 1);

	// 真正影响显示的字段变化仍然通知。
	const third = tree.accept([{ ...base, text: 'changed' }]);
	assert.deepEqual(third.changed, ['assistant:a1']);
	assert.equal(notes, 2);
});

test('subCalls carried on a parent still count as display changes', () => {
	// `subCalls` 决定工具树的子行，必须参与比较；只有不显示的内部字段被忽略。
	const tree = new DshConversationNodeTree<SampleNode>('s1');
	const root = { kind: 'tool-result' as const, seq: 2, turn: 1, callId: 'root', text: 'parent' };
	tree.accept([{ ...root, subCalls: [] }]);
	const change = tree.accept([{ ...root, subCalls: [{ kind: 'tool-call', seq: 3, callId: 'child', text: 'nested' }] }]);
	// 新增的子调用也新进索引，两个 key 都算「这次接受后可见内容变了」。
	assert.deepEqual(change.changed.sort(), ['tool-call:child', 'tool-result:root']);
	assert.equal(tree.get('tool-call:child')?.text, 'nested');
});

test('a local revision isolates one turn from the rest', () => {
	// 契约 §19 S0 的验收：修改第 N 轮节点时，只有第 N 轮那组 nodeIds 的 revision 变化。
	const tree = new DshConversationNodeTree<SampleNode>('s1');
	const turn1 = [node({ kind: 'user', seq: 1, messageId: 'u1', turn: 1, text: 'q' }), node({ kind: 'assistant', seq: 2, messageId: 'a1', turn: 1, text: 'a' })];
	const turn2 = [node({ kind: 'user', seq: 3, messageId: 'u2', turn: 2, text: 'q2' }), node({ kind: 'assistant', seq: 4, messageId: 'a2', turn: 2, text: 'a2' })];
	tree.accept([...turn1, ...turn2]);
	const rev1 = tree.revisionFor(['user:u1', 'assistant:a1']);
	const rev2 = tree.revisionFor(['user:u2', 'assistant:a2']);
	// 第 2 轮追加一个流式块：第 1 轮的 revision 必须原样不动。
	tree.accept([...turn1, ...turn2.slice(0, 1), node({ kind: 'assistant', seq: 4, messageId: 'a2', turn: 2, text: 'a2 updated' })]);
	assert.equal(tree.revisionFor(['user:u1', 'assistant:a1']), rev1, 'turn 1 must not be invalidated by a turn 2 change');
	assert.notEqual(tree.revisionFor(['user:u2', 'assistant:a2']), rev2, 'the changed turn must get a new revision');
});

test('revisionFor is order-sensitive and per-key', () => {
	const tree = new DshConversationNodeTree<SampleNode>('s1');
	tree.accept([node({ kind: 'user', seq: 1, messageId: 'u1' }), node({ kind: 'assistant', seq: 2, messageId: 'a1' })]);
	assert.notEqual(tree.revisionFor(['user:u1', 'assistant:a1']), tree.revisionFor(['assistant:a1', 'user:u1']));
	assert.equal(tree.revisionOf('user:u1'), tree.source('user:u1').version);
	assert.equal(tree.revisionOf('missing'), 0, 'a key that was never seen has revision 0');
});

test('turnDataSource finds a turn-process node that is not in the caller node list', () => {
	// 契约 §19 S6 的消费面：槽位渲染只用本段 nodeIds，但过程计数行属于整个 Turn。
	// `turnDataSource(turn, 'turn-process')` 必须能取到不在本段引用里的那个节点——
	// 否则渲染层只能退化成现算，页面上的计数与 Host 给的权威计数不一致。
	const tree = new DshConversationNodeTree<SampleNode>('s1');
	tree.accept([
		node({ kind: 'tool-call', seq: 1, turn: 1, callId: 'c1' }),
		node({ kind: 'turn-process', seq: 2, turn: 1 }),
	]);
	const own = ['tool-call:c1'];
	assert.equal(own.includes('turn-process:2:1:'), false, 'the count row is deliberately outside the caller list');
	const counts = tree.turnDataSource(1, 'turn-process').get();
	assert.equal(counts.length, 1);
	assert.equal(dshNodeKey(counts[0]), 'turn-process:2:1:');
	// 别的 Turn 的同 kind 节点不进来。
	tree.accept([
		node({ kind: 'tool-call', seq: 1, turn: 1, callId: 'c1' }),
		node({ kind: 'turn-process', seq: 2, turn: 1 }),
		node({ kind: 'turn-process', seq: 9, turn: 2 }),
	]);
	assert.equal(tree.turnDataSource(1, 'turn-process').get().length, 1);
	assert.equal(tree.turnDataSource(2, 'turn-process').get().length, 1);
});

test('processSource notifies only for its own turn', () => {
	// 槽位对每个 Turn 订阅 processSource；别的 Turn 变化不得触发本 Turn 的订阅者。
	const tree = new DshConversationNodeTree<SampleNode>('s1');
	tree.accept([node({ kind: 'tool-call', seq: 1, turn: 1, callId: 'c1' }), node({ kind: 'tool-call', seq: 2, turn: 2, callId: 'c2' })]);
	let turn1 = 0;
	tree.processSource('tool-call:c1').subscribe(() => { turn1++; });
	tree.accept([node({ kind: 'tool-call', seq: 1, turn: 1, callId: 'c1' }), node({ kind: 'tool-call', seq: 2, turn: 2, callId: 'c2', text: 'changed' })]);
	assert.equal(turn1, 0, 'a turn 2 change must not notify the turn 1 process source');
	tree.accept([node({ kind: 'tool-call', seq: 1, turn: 1, callId: 'c1', text: 'changed' }), node({ kind: 'tool-call', seq: 2, turn: 2, callId: 'c2', text: 'changed' })]);
	assert.equal(turn1, 1, 'a turn 1 change must notify it');
});

test('turn navigation projects into dock rows with stable ids and anchors', async () => {
	// CHK-377 核实过：原生 promptTimeline 的模型是 VS Code request，而 DSH 多 Turn 是同一个
	// request，原生 rail 只会显示一个标记。所以这里用 DSH 自己的 navigationItems() 投影。
	const { dshTurnNavEntries, DSH_TURN_NAV_PREVIEW_MAX } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshTurnNavigation.ts');
	const items = [
		{ turn: 1, anchorKey: 'user:u1', promptKey: 'user:u1', responseKey: 'assistant:a1' },
		{ turn: 2, anchorKey: 'user:u2' },
	];
	const entries = dshTurnNavEntries(items, item => item.turn === 1 ? '  第一轮的问题  ' : '');
	assert.equal(entries.length, 2);
	assert.deepEqual(entries.map(e => e.id), ['turn-nav:1', 'turn-nav:2'], 'ids must be stable per turn');
	assert.equal(entries[0].label, '#1 第一轮的问题', 'the preview is whitespace-normalized and trimmed');
	assert.equal(entries[1].label, '#2', 'a turn without a summary shows only its number');
	// 跳转目标就是锚点 key。
	assert.deepEqual(entries[0].arguments, ['user:u1']);
	assert.equal(entries[0].command, 'dsh.revealTurnAnchor');
	// order 递增，保证 dock 里顺序稳定。
	assert.ok(entries[1].order > entries[0].order);
	// 超长摘要被截断到上限（含省略号）。
	const long = dshTurnNavEntries([{ turn: 3, anchorKey: 'k' }], () => 'x'.repeat(200));
	assert.equal([...long[0].label].length, '#3 '.length + DSH_TURN_NAV_PREVIEW_MAX);
	assert.ok(long[0].label.endsWith('\u2026'));
	// 没有 Turn 时不画空壳。
	assert.deepEqual(dshTurnNavEntries([]), []);
});

test('the turn nav summary comes from the prompt first line only', async () => {
	// 官方 rail 的预览是「prompt 一行（50 字符）」。摘要必须只取首行：
	// 多行提问的后续行属于详情，塞进导航行会把一行撑成多行。
	const { dshTurnNavSummaryOf } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshTurnNavigation.ts');
	assert.equal(dshTurnNavSummaryOf([{ type: 'text', text: '第一行\n第二行\n第三行' }]), '第一行');
	assert.equal(dshTurnNavSummaryOf([{ type: 'text', text: '  多余   空白  ' }]), '多余 空白');
	// 跳过非 text 块，取第一个有文本的。
	assert.equal(dshTurnNavSummaryOf([{ type: 'image' }, { type: 'text', text: '真正的问题' }]), '真正的问题');
	// 空块 / 纯空白 / 缺失都返回空串（调用方据此只显示 #N）。
	assert.equal(dshTurnNavSummaryOf([]), '');
	assert.equal(dshTurnNavSummaryOf([{ type: 'text', text: '   ' }]), '');
	assert.equal(dshTurnNavSummaryOf(undefined), '');
	assert.equal(dshTurnNavSummaryOf([{ type: 'text', text: '\n\n' }]), '');
});
