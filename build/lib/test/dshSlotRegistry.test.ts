/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH 槽位注册表：精确 key 优先于无 key、priority 高者胜、dispose 后回到 fallback。
// 运行：node --experimental-strip-types --test build/lib/test/dshSlotRegistry.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DshSlotRegistry } from '../../../src/vs/workbench/contrib/chat/browser/widget/chatContentParts/dsh/dshSlotRegistry.ts';
import type { DshSlotContext } from '../../../src/vs/workbench/contrib/chat/browser/widget/chatContentParts/dsh/dshSlotTypes.ts';

function context(): DshSlotContext {
	return {
		input: { id: 'n1', kind: 'user', encoded: '{}' },
		stores: { add() { } },
	};
}

function view(name: string): { readonly domNode: unknown } {
	return { domNode: name };
}

test('exact key beats an unkeyed contribution even when the unkeyed priority is higher', () => {
	const registry = new DshSlotRegistry<DshSlotContext>();
	registry.register({
		slot: 'conversation.chat.node',
		priority: 100,
		create: () => view('plain'),
	});
	registry.register({
		slot: 'conversation.chat.node',
		key: 'user',
		priority: 0,
		create: () => view('user'),
	});

	let fallbackCalls = 0;
	const rendered = registry.renderSlot('conversation.chat.node', context(), {
		key: 'user',
		fallback: () => {
			fallbackCalls++;
			return view('fallback');
		},
	});
	assert.equal(fallbackCalls, 0);
	assert.equal(rendered.domNode, 'user');

	const plain = registry.renderSlot('conversation.chat.node', context(), {
		fallback: () => view('fallback'),
	});
	assert.equal(plain.domNode, 'plain');

	const missed = registry.renderSlot('conversation.chat.node', context(), {
		key: 'assistant',
		fallback: () => view('fallback'),
	});
	assert.equal(missed.domNode, 'fallback');
});

test('higher priority wins and a missing priority is zero', () => {
	const registry = new DshSlotRegistry<DshSlotContext>();
	registry.register({
		slot: 'conversation.chat.node',
		key: 'user',
		create: () => view('default'),
	});
	registry.register({
		slot: 'conversation.chat.node',
		key: 'user',
		priority: 1,
		create: () => view('higher'),
	});
	const rendered = registry.renderSlot('conversation.chat.node', context(), {
		key: 'user',
		fallback: () => view('fallback'),
	});
	assert.equal(rendered.domNode, 'higher');
});

test('dispose removes only that entry and then renderSlot uses fallback', () => {
	const registry = new DshSlotRegistry<DshSlotContext>();
	const low = registry.register({
		slot: 'conversation.chat.node',
		key: 'user',
		priority: 1,
		create: () => view('low'),
	});
	const high = registry.register({
		slot: 'conversation.chat.node',
		key: 'user',
		priority: 5,
		create: () => view('high'),
	});
	high.dispose();
	assert.equal(registry.renderSlot('conversation.chat.node', context(), {
		key: 'user',
		fallback: () => view('fallback'),
	}).domNode, 'low');
	low.dispose();

	let calls = 0;
	const rendered = registry.renderSlot('conversation.chat.node', context(), {
		key: 'user',
		fallback: () => {
			calls++;
			return view('fallback');
		},
	});
	assert.equal(calls, 1);
	assert.ok(rendered);
	assert.equal(rendered.domNode, 'fallback');
});

test('fallback is called when the slot has no contribution and the view is not empty', () => {
	const registry = new DshSlotRegistry<DshSlotContext>();
	registry.register({
		slot: 'conversation.chat.node',
		key: 'user',
		create: () => view('other-slot'),
	});
	let calls = 0;
	const rendered = registry.renderSlot('conversation.chat.markdown.fence', context(), {
		fallback: (ctx) => {
			calls++;
			assert.equal(ctx.input.id, 'n1');
			return view('fence-fallback');
		},
	});
	assert.equal(calls, 1);
	assert.ok(rendered);
	assert.notEqual(rendered, null);
	assert.notEqual(rendered.domNode, null);
	assert.notEqual(rendered.domNode, '');
	assert.equal(rendered.domNode, 'fence-fallback');
});

test('renderSlot does not swallow contribution errors', () => {
	const registry = new DshSlotRegistry<DshSlotContext>();
	registry.register({
		slot: 'conversation.chat.reasoning.body',
		create: () => {
			throw new Error('slot failed');
		},
	});
	assert.throws(() => registry.renderSlot('conversation.chat.reasoning.body', context(), {
		fallback: () => view('fallback'),
	}), /slot failed/);
});
