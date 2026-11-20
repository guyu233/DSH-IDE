/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 客户端半身的「禁用 → 启用」回归测试。
//
// 背景：`client.js` 在模块作用域持有 `ideNamespace`（`remote.ide` 的已解析引用）。
// 禁用再启用会复用同一个模块实例；若 `apply()` 不重新解析，点击时的兜底逻辑看到
// 「非 undefined」就会跳过重挂，直接调用属于上一个 Cordis 上下文的旧引用
// （Host 重启后更是失效对象）。
//
// 这里真的执行 client.js 的 factory：把源码里的 `factory(require) { ... }` 摘出来求值，
// 用最小 ctx 跑两遍 `apply()`，检查每次是否都重新解析命名空间、重注册字典与槽。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const CLIENT = new URL('../../../src/vs/platform/dshClient/client/client.js', import.meta.url);

interface Harness {
	applies: number;
	mounts: number;
	dicts: number;
	slots: number;
	apply(): Promise<void>;
}

/** 从源码摘出 factory 体并在最小 ctx 上执行两次 apply。 */
function buildHarness(): Harness {
	const source = readFileSync(CLIENT, 'utf8');
	const start = source.indexOf('factory(require) {');
	assert.ok(start > 0, 'client.js must expose a module-loader factory');
	const body = source.slice(start + 'factory(require) {'.length);
	// 换行可能是 CRLF（仓库在 Windows 上检出）：用正则定位，别写死 `\n`。
	const terminator = /\},\r?\n\}\);\s*$/.exec(body);
	assert.ok(terminator !== null, 'factory body must be terminated');
	const end = terminator.index;
	const factoryBody = body.slice(0, end);

	const fakeReact = {
		useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => undefined],
		useCallback: (fn: unknown) => fn,
		useEffect: () => undefined,
		createElement: () => null,
		Fragment: 'Fragment',
	};

	// eslint-disable-next-line no-new-func -- 被测对象是纯 JS 插件模块，这里按它的真实形态求值
	const factory = new Function('require', factoryBody) as (require: (id: string) => unknown) => { apply(ctx: unknown): Promise<void> };
	const plugin = factory(() => fakeReact);

	const harness: Harness = {
		applies: 0, mounts: 0, dicts: 0, slots: 0,
		apply: async () => {
			let namespace: unknown;
			const ctx = {
				// Cordis 的服务解析：`ctx.<name>` 走容器查找，这里只提供被测代码用到的几个。
				get: (name: string) => {
					if (name === 'remote') {
						return {
							$mount: async () => {
								harness.mounts += 1;
								namespace = { launch: async () => ({ ok: true, value: { ok: true } }) };
							},
							get ide() { return namespace; },
						};
					}
					if (name === 'remote.ide') {
						return namespace;
					}
					return undefined;
				},
				get slots() {
					return {
						inject: (_name: string, register: () => unknown) => register(),
						register: () => {
							harness.slots += 1;
							return () => undefined;
						},
					};
				},
				get locale() {
					return {
						register: () => {
							harness.dicts += 1;
							return () => undefined;
						},
						bind: () => (key: string) => key,
					};
				},
				effect: (fn: () => unknown) => {
					const result = fn();
					return () => {
						if (typeof result === 'function') {
							result();
						}
					};
				},
			};
			harness.applies += 1;
			await plugin.apply(ctx);
		},
	};
	return harness;
}

test('re-enabling the plugin re-resolves the remote namespace', async () => {
	const harness = buildHarness();
	await harness.apply();
	assert.equal(harness.mounts, 1, 'the first apply must mount the namespace');
	assert.equal(harness.dicts, 1, 'the first apply must register the dictionaries');
	assert.equal(harness.slots, 1, 'the first apply must register the header slot');

	await harness.apply();
	assert.equal(harness.mounts, 2, 'a second apply must mount again instead of reusing the stale reference');
	assert.equal(harness.dicts, 2, 'dictionaries must be registered for the new context');
	assert.equal(harness.slots, 2, 'the slot must be registered for the new context');
});

test('every apply starts from a clean namespace state', async () => {
	// 更直接的口径：第一次 apply 若失败，第二次仍必须尝试重新挂载，而不是因为
	// 「上次留下了一个非 undefined 的引用」就跳过。
	const source = readFileSync(CLIENT, 'utf8');
	const applyStart = source.indexOf('async apply(ctx) {');
	const applyBody = source.slice(applyStart, applyStart + 900);
	assert.match(applyBody, /ideNamespace = undefined;/, 'apply must reset the cached namespace');
	assert.match(applyBody, /mountFailure = undefined;/, 'apply must reset the cached mount failure');
});
