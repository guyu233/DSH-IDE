/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 行内补全的入参上限必须与契约逐项一致：超长会被 `validateDshIdeInput` 直接拒绝，
// 用户看到的是「补全没反应」，很难联想到是长度超限。
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshInlineCompletion.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

function read(relative: string): string {
	return readFileSync(new URL('../../../' + relative, import.meta.url), 'utf8');
}

/** 从契约的校验分支里取某个字段的上限。 */
function contractLimit(field: string): number {
	const source = read('src/vs/platform/dshClient/common/dshIdeProtocol.ts');
	const match = new RegExp(`boundedString\\(record\\['${field}'\\], '[^']+', (\\d+)`).exec(source);
	assert.ok(match !== null, `the contract must bound ${field}`);
	return Number(match[1]);
}

test('the IDE truncates every bounded inlineComplete field to the contract limit', () => {
	const source = read('src/vs/workbench/contrib/dsh/browser/inlineCompletion.ts');
	// 三个字段各自的上限常量必须等于契约值。
	for (const [constant, field] of [
		['MAX_PREFIX_CHARS', 'prefix'],
		['MAX_SUFFIX_CHARS', 'suffix'],
		['MAX_PATH_CHARS', 'path'],
	] as const) {
		const declared = new RegExp(`const ${constant} = (\\d+);`).exec(source);
		assert.ok(declared !== null, `${constant} must be declared`);
		assert.equal(Number(declared[1]), contractLimit(field), `${constant} must match the contract limit for ${field}`);
	}
});

test('the request actually applies each limit', () => {
	const source = read('src/vs/workbench/contrib/dsh/browser/inlineCompletion.ts');
	// 声明了常量却没用上，等于没截断。
	assert.match(source, /\.slice\(-MAX_PREFIX_CHARS\)/, 'prefix must be truncated');
	assert.match(source, /\.slice\(0, MAX_SUFFIX_CHARS\)/, 'suffix must be truncated');
	assert.match(source, /fsPath\.slice\(0, MAX_PATH_CHARS\)/, 'path must be truncated');
	// 裸的 2000 硬编码曾让 suffix 与 path 两处不一致。
	assert.doesNotMatch(source, /slice\(0, 2000\)/, 'no bare literal should remain for suffix');
});

test('disposing the provider clears the in-flight timeout timers', () => {
	// 关闭设置会注销 provider。不清理在途定时器的话，最长要等 2.5 秒超时才释放，
	// 与「关掉之后完全不产生任何开销」的目标不符。
	const source = read('src/vs/workbench/contrib/dsh/browser/inlineCompletion.ts');
	assert.match(source, /private readonly _pending = new Set<\(\) => void>\(\)/, 'in-flight cancels must be tracked');
	assert.match(source, /this\._pending\.add\(cancel\)/, 'each request must register its cancel');
	// 注销时必须逐个清掉。
	const disposeBody = /disposeInlineCompletions\(\): void \{[\s\S]{0,400}?\n\t\}/.exec(source)?.[0] ?? '';
	assert.ok(disposeBody !== '', 'disposeInlineCompletions must exist');
	assert.match(disposeBody, /for \(const cancel of this\._pending\)/, 'dispose must walk the pending set');
	assert.match(disposeBody, /this\._pending\.clear\(\)/, 'dispose must empty the pending set');
});
