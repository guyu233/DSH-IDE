/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DshSlotRegistry：基数、作用域、priority 遮蔽、owner props、inject、dispose、活树。
// 运行：node --experimental-strip-types --test build/lib/test/dshSlotRegistry.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DshSlotRegistry } from '../../../src/vs/workbench/contrib/dsh/browser/vscode/dshSlotRegistry.ts';
import { DSH_CHAT_SLOT_DECLARATIONS, dshChatSlotRegistry, declareDshChatSlots } from '../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatSlots.ts';

test('the unoccupied Chat slots declare the official cardinality and scope', () => {
	// 这七席还没有 occupant，但基数/作用域必须与官方 SlotMap 一致，否则将来接入时选出规则会错。
	const registry = new DshSlotRegistry();
	declareDshChatSlots(registry);
	declareDshChatSlots(registry); // 幂等：重复登记不抛。
	const byName = new Map(registry.catalog().slots.map(entry => [entry.name, entry]));
	for (const declaration of DSH_CHAT_SLOT_DECLARATIONS) {
		const entry = byName.get(declaration.name);
		assert.equal(entry?.cardinality, declaration.cardinality, declaration.name);
		assert.equal(entry?.scope, declaration.scope, declaration.name);
	}
	assert.equal(byName.get('conversation.chat.markdown.fence')?.cardinality, 'hoc');
	assert.equal(byName.get('conversation.chat.text-interaction')?.cardinality, 'keyed');
	assert.equal(byName.get('conversation.chat.user.before')?.cardinality, 'chain');
	// 没有 occupant 时槽位仍可解析，但 occupants 为空：不会假装已经有人渲染。
	const resolved = registry.resolve('conversation.chat.aside', { sessionId: 's' }) as { occupants?: readonly unknown[] } | undefined;
	// 运行期单例已经声明好这批槽位，别的模块不必重复清单。
	assert.equal(dshChatSlotRegistry.catalog().slots.length >= DSH_CHAT_SLOT_DECLARATIONS.length, true);
	assert.equal(dshChatSlotRegistry.catalog().slots.some(entry => entry.name === 'conversation.chat.markdown.fence'), true);
});

test('single renders the lowest priority and rejects the same priority', () => {
	const registry = new DshSlotRegistry();
	registry.declare({ name: 'shell.quota-notice', cardinality: 'single', scope: 'root' });
	registry.register('shell.quota-notice', { priority: 10, props: { who: 'high' } });
	registry.register('shell.quota-notice', { priority: 1, props: { who: 'low' } });
	const resolved = registry.resolve('shell.quota-notice');
	assert.equal(resolved.status, 'rendered');
	assert.equal(resolved.occupants.length, 1);
	assert.equal(resolved.occupants[0].props['who'], 'low');
	assert.throws(() => registry.register('shell.quota-notice', { priority: 1 }), /priority 1/);
});

test('list orders winners by order and shadows the same id', () => {
	const registry = new DshSlotRegistry();
	registry.declare({ name: 'conversation.input.dock', cardinality: 'list', scope: 'session' });
	assert.throws(() => registry.register('conversation.input.dock', {}), /requires an id/);
	registry.register('conversation.input.dock', { id: 'queue', order: 20, props: { label: 'queue' } });
	registry.register('conversation.input.dock', { id: 'files', order: 5, props: { label: 'files' } });
	registry.register('conversation.input.dock', { id: 'queue', priority: -1, order: 20, props: { label: 'queue-shadow' } });
	const resolved = registry.resolve('conversation.input.dock', { sessionId: 's1' });
	assert.deepEqual(resolved.occupants.map(item => item.props['label']), ['files', 'queue-shadow']);
	assert.throws(() => registry.register('conversation.input.dock', { id: 'files', priority: 0 }), /priority 0/);
});

test('keyed dispatches by entryKey and keeps a lower-priority shadow', () => {
	const registry = new DshSlotRegistry();
	registry.declare({ name: 'conversation.chat.node', cardinality: 'keyed', scope: 'session' });
	assert.throws(() => registry.register('conversation.chat.node', {}), /requires a key/);
	registry.register('conversation.chat.node', { key: 'user', props: { view: 'user-a' } });
	registry.register('conversation.chat.node', { key: 'user', priority: -1, props: { view: 'user-b' } });
	registry.register('conversation.chat.node', { key: 'tool-call', props: { view: 'tool' } });
	const user = registry.resolve('conversation.chat.node', { sessionId: 's1', entryKey: 'user' });
	const tool = registry.resolve('conversation.chat.node', { sessionId: 's1', entryKey: 'tool-call' });
	const missing = registry.resolve('conversation.chat.node', { sessionId: 's1', entryKey: 'missing' });
	assert.equal(user.occupants[0].props['view'], 'user-b');
	assert.equal(tool.occupants[0].props['view'], 'tool');
	assert.equal(missing.status, 'empty');
});

test('chain elects the first non-null select and falls back when every select declines', () => {
	const registry = new DshSlotRegistry();
	registry.declare({ name: 'conversation.chat.user.before', cardinality: 'chain', scope: 'session' });
	assert.throws(() => registry.register('conversation.chat.user.before', {}), /select/);
	registry.register('conversation.chat.user.before', {
		priority: 5,
		select: owner => owner.props?.['kind'] === 'late' ? 'late' : null,
	});
	registry.register('conversation.chat.user.before', {
		priority: 1,
		select: owner => owner.props?.['kind'] === 'early' ? 'early' : null,
	});
	const early = registry.resolve('conversation.chat.user.before', { sessionId: 's1', props: { kind: 'early' } });
	const late = registry.resolve('conversation.chat.user.before', { sessionId: 's1', props: { kind: 'late' } });
	const none = registry.resolve('conversation.chat.user.before', { sessionId: 's1', props: { kind: 'nope' }, fallback: 'owner' });
	assert.equal(early.occupants[0].selected, 'early');
	assert.equal(late.occupants[0].selected, 'late');
	assert.equal(none.status, 'fallback');
	assert.equal(none.fallback, 'owner');
});

test('hoc wraps from the outside in and an exact key replaces the wildcard of the same id', () => {
	const registry = new DshSlotRegistry();
	registry.declare({ name: 'conversation.chat.markdown.fence', cardinality: 'hoc', scope: 'session' });
	assert.throws(() => registry.register('conversation.chat.markdown.fence', {}), /requires an id/);
	registry.register('conversation.chat.markdown.fence', { id: 'outer', order: 0, props: { layer: 'outer' } });
	registry.register('conversation.chat.markdown.fence', { id: 'lang', order: 10, props: { layer: 'any-lang' } });
	registry.register('conversation.chat.markdown.fence', { id: 'lang', key: 'mermaid', order: 10, props: { layer: 'mermaid' } });
	registry.register('conversation.chat.markdown.fence', { id: 'inner', order: 20, props: { layer: 'inner' } });
	const mermaid = registry.resolve('conversation.chat.markdown.fence', { sessionId: 's1', entryKey: 'mermaid', children: 'code' });
	const plain = registry.resolve('conversation.chat.markdown.fence', { sessionId: 's1', children: 'code' });
	assert.deepEqual(mermaid.occupants.map(item => item.props['layer']), ['outer', 'mermaid', 'inner']);
	assert.equal(mermaid.children, 'code');
	assert.deepEqual(plain.occupants.map(item => item.props['layer']), ['outer', 'any-lang', 'inner']);
});

test('session scope stays unbound without a session and session-maybe still renders', () => {
	const registry = new DshSlotRegistry();
	registry.declare({ name: 'conversation.chat.node', cardinality: 'keyed', scope: 'session' });
	registry.declare({ name: 'conversation.chat.aside', cardinality: 'single', scope: 'session-maybe' });
	registry.register('conversation.chat.node', { key: 'user' });
	registry.register('conversation.chat.aside', { props: { shown: true } });
	assert.equal(registry.resolve('conversation.chat.node').status, 'unbound');
	assert.equal(registry.resolve('conversation.chat.node', { sessionId: '' }).status, 'unbound');
	const aside = registry.resolve('conversation.chat.aside');
	assert.equal(aside.status, 'rendered');
	assert.equal(aside.occupants[0].props['shown'], true);
});

test('owner props cannot be overwritten and entry props survive', () => {
	const registry = new DshSlotRegistry();
	registry.declare({
		name: 'conversation.chat.node',
		cardinality: 'keyed',
		scope: 'session',
		ownerProps: ['node'],
	});
	registry.register('conversation.chat.node', { key: 'user', props: { node: 'entry', extra: 1 } });
	const resolved = registry.resolve('conversation.chat.node', {
		sessionId: 's1',
		entryKey: 'user',
		props: { node: 'owner', other: 2 },
	});
	assert.deepEqual(resolved.occupants[0].props, { node: 'owner', extra: 1, other: 2 });
});

test('inject factory is cached per session and disposed with the entry', () => {
	const registry = new DshSlotRegistry();
	registry.declare({ name: 'conversation.chat.node', cardinality: 'keyed', scope: 'session' });
	const disposed: string[] = [];
	let calls = 0;
	const registration = registry.register('conversation.chat.node', {
		key: 'user',
		inject: sessionId => {
			calls++;
			return { value: sessionId, dispose: () => { disposed.push(sessionId ?? ''); } };
		},
	});
	registry.resolve('conversation.chat.node', { sessionId: 's1', entryKey: 'user' });
	registry.resolve('conversation.chat.node', { sessionId: 's1', entryKey: 'user' });
	registry.resolve('conversation.chat.node', { sessionId: 's2', entryKey: 'user' });
	assert.equal(calls, 2);
	registration.dispose();
	assert.deepEqual(disposed.sort(), ['s1', 's2']);
});

test('inject waits for declaration, restarts after collapse, and stops when cancelled', () => {
	const registry = new DshSlotRegistry();
	const log: string[] = [];
	const waiting = registry.inject('conversation.chat.flow', () => {
		log.push('start');
		return { dispose: () => { log.push('stop'); } };
	});
	assert.deepEqual(log, []);
	assert.throws(() => registry.register('root', {}), /not declared/);
	registry.declare({ name: 'root', cardinality: 'single', scope: 'root' });
	const root = registry.register('root', {});
	root.declare({ name: 'conversation.chat.flow', cardinality: 'single', scope: 'session' });
	assert.deepEqual(log, ['start']);
	root.dispose();
	assert.deepEqual(log, ['start', 'stop']);
	registry.declare({ name: 'conversation.chat.flow', cardinality: 'single', scope: 'session' });
	assert.deepEqual(log, ['start', 'stop', 'start']);
	waiting.dispose();
	assert.deepEqual(log, ['start', 'stop', 'start', 'stop']);
	registry.declare({ name: 'conversation.chat.node', cardinality: 'keyed', scope: 'session' });
	assert.deepEqual(log, ['start', 'stop', 'start', 'stop']);
});

test('disposing an entry collapses the child slots it declared', () => {
	const registry = new DshSlotRegistry();
	registry.declare({ name: 'conversation.chat.flow', cardinality: 'single', scope: 'session' });
	const flow = registry.register('conversation.chat.flow', {});
	flow.declare({ name: 'conversation.chat.node', cardinality: 'keyed', scope: 'session' });
	registry.register('conversation.chat.node', { key: 'user' });
	assert.equal(registry.catalog().slots.some(slot => slot.name === 'conversation.chat.node'), true);
	flow.dispose();
	assert.equal(registry.catalog().slots.some(slot => slot.name === 'conversation.chat.node'), false);
	assert.throws(() => registry.resolve('conversation.chat.node', { sessionId: 's1', entryKey: 'user' }), /not declared/);
});

test('snapshot marks the active occupant and lists declared children', () => {
	const registry = new DshSlotRegistry();
	let changes = 0;
	registry.onDidChange(() => { changes++; });
	registry.declare({ name: 'conversation.chat.flow', cardinality: 'single', scope: 'session' });
	const flow = registry.register('conversation.chat.flow', { priority: 2 });
	registry.register('conversation.chat.flow', { priority: 0 });
	flow.declare({ name: 'conversation.chat.node', cardinality: 'keyed', scope: 'session' });
	const tree = registry.snapshot('conversation.chat.flow');
	assert.equal(tree.length, 1);
	assert.deepEqual(tree[0].occupants.map(item => item.priority), [2, 0]);
	assert.deepEqual(tree[0].occupants.map(item => item.active), [false, true]);
	assert.equal(tree[0].children[0].name, 'conversation.chat.node');
	assert.ok(changes >= 3);
});

test('an unknown slot and a second child declaration fail closed', () => {
	const registry = new DshSlotRegistry();
	assert.throws(() => registry.register('missing', {}), /not declared/);
	registry.declare({ name: 'root', cardinality: 'single', scope: 'root' });
	const root = registry.register('root', {});
	root.declare({ name: 'child', cardinality: 'list', scope: 'session' });
	assert.throws(() => root.declare({ name: 'child', cardinality: 'list', scope: 'session' }), /already declared/);
	assert.throws(() => registry.declare({ name: 'root', cardinality: 'list', scope: 'root' }), /different cardinality/);
});
