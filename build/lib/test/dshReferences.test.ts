/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 第二批输入的纯逻辑：工作区引用 → DSH `@path`，以及提交的关联标识。
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshReferences.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { URI } from '../../../out/vs/base/common/uri.js';
import { dshRelativeReferencePath, formatDshReferenceMention, projectDshReferences } from '../../../out/vs/workbench/contrib/dsh/browser/vscode/dshReferences.js';

test('a path inside the workspace becomes a workspace-relative reference', () => {
	assert.equal(dshRelativeReferencePath('D:/work/proj/src/a.ts', ['D:/work/proj']), 'src/a.ts');
	assert.equal(dshRelativeReferencePath('D:\\work\\proj\\src\\a.ts', ['D:/work/proj']), 'src/a.ts');
	// 多根工作区取最长匹配，避免 `proj` 与 `proj-extra` 互相抢前缀。
	assert.equal(dshRelativeReferencePath('D:/work/proj-extra/b.ts', ['D:/work/proj', 'D:/work/proj-extra']), 'b.ts');
	// 工作区外的路径保留绝对形式：DSH 侧仍可解析，不做静默丢弃。
	assert.equal(dshRelativeReferencePath('C:/elsewhere/c.ts', ['D:/work/proj']), 'C:/elsewhere/c.ts');
});

test('mentions follow the documented @file grammar', () => {
	assert.equal(formatDshReferenceMention('src/a.ts', false), '@src/a.ts');
	assert.equal(formatDshReferenceMention('src/my file.ts', false), '@"src/my file.ts"');
	assert.equal(formatDshReferenceMention('src/dir', true), '@src/dir/');
	assert.equal(formatDshReferenceMention('src/my dir', true), '@"src/my dir/');
	// 无法安全表达的路径不猜，交给上层提示。
	assert.equal(formatDshReferenceMention('src/a"b.ts', false), undefined);
	assert.equal(formatDshReferenceMention('src/a\u0000b.ts', false), undefined);
});

test('file and directory entries project to mentions, everything else stays', () => {
	const roots = ['D:/work/proj'];
	const entries = [
		{ kind: 'file', name: 'a.ts', value: URI.file('D:/work/proj/src/a.ts') },
		{ kind: 'directory', name: 'src', value: URI.file('D:/work/proj/src') },
		{ kind: 'file', name: 'ranged.ts', value: { uri: URI.file('D:/work/proj/src/r.ts'), range: {} } },
		{ kind: 'paste', name: 'pasted' },
		{ kind: 'tool', name: 'toolset' },
	];
	const projected = projectDshReferences(entries, roots);
	assert.deepEqual(projected.mentions, ['@src/a.ts', '@src/', '@src/r.ts']);
	assert.deepEqual(projected.remaining.map(entry => entry.name), ['pasted', 'toolset']);
});

test('an unrepresentable file stays in the remaining set instead of a broken mention', () => {
	const projected = projectDshReferences(
		[{ kind: 'file', name: 'odd', value: URI.file('D:/work/proj/a"b.ts') }],
		['D:/work/proj'],
	);
	assert.deepEqual(projected.mentions, []);
	assert.equal(projected.remaining.length, 1);
});

test('the submit helpers exist in the widget and carry the required semantics', async () => {
	// chatWidget 依赖 DOM/workbench 服务，node 测试只做静态契约检查：
	// 关联标识必须每提交生成一次，待确认文案必须点名请求且不能写成「发送失败」。
	const { readFileSync } = await import('node:fs');
	const source = readFileSync(new URL('../../../src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts', import.meta.url), 'utf8');
	assert.match(source, /export function nextDshSubmitId\(\): string \{/, 'the submit id helper must exist');
	assert.match(source, /globalThis\.crypto\.randomUUID\(\)/, 'the id must prefer a real UUID');
	assert.match(source, /export function dshSubmitUnconfirmedText\(requestId: string\): string \{/, 'the unconfirmed text helper must exist');
	assert.match(source, /待确认/, 'the notice must state the result is unconfirmed');
	assert.doesNotMatch(source, /发送结果待确认[^`]*发送失败/, 'the notice must not present an unknown result as a failure');
});
