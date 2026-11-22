/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 折叠 store 与工具视图分派。
// 运行：node --experimental-strip-types --test build/lib/test/dshExpansionAndToolView.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DshExpansionStateStore } from '../../../src/vs/workbench/contrib/dsh/browser/vscode/dshExpansionStateStore.ts';
import { dshDetailsToolCount, dshToolViewId } from '../../../src/vs/workbench/contrib/dsh/browser/vscode/dshToolViewRegistry.ts';

test('turn collapse defaults per work-details mode and node disclosure resets with the turn', () => {
	// 官方「Display modes」：Compact/Standard/Detailed 对合格的历史 Turn **初始折叠**，Verbose 永不折叠。
	const store = new DshExpansionStateStore('s1');
	assert.equal(store.isTurnCollapsed(1, 0), true, 'standard starts a completed turn collapsed');
	store.setTranscriptView('verbose');
	assert.equal(store.isTurnCollapsed(1, 0), false, 'verbose never folds');
	store.setTranscriptView('standard');
	store.setTurnCollapsed(1, 0, true);
	store.setDisclosed(1, 'reasoning', true);
	store.setDisclosed(1, 'tool', true);
	store.setDisclosed(2, 'reasoning', true);
	assert.equal(store.isTurnCollapsed(1, 0), true);
	assert.equal(store.isDisclosed(1, 'tool'), true);
	store.resetTurn(1);
	assert.equal(store.isDisclosed(1, 'reasoning'), false);
	assert.equal(store.isDisclosed(1, 'tool'), false);
	assert.equal(store.isDisclosed(2, 'reasoning'), true);
	assert.equal(store.isTurnCollapsed(1, 0), true);
	store.setTurnCollapsed(1, 0, false);
	assert.equal(store.isTurnCollapsed(1, 0), false);
});

test('two sessions do not share collapse state', () => {
	const left = new DshExpansionStateStore('left');
	const right = new DshExpansionStateStore('right');
	// 用 verbose（永不折叠）做对照：右边没有手动记录，不能读到左边的手动收起。
	right.setTranscriptView('verbose');
	left.setTurnCollapsed(3, 1, true);
	assert.equal(right.isTurnCollapsed(3, 1), false);
	assert.equal(left.sessionId, 'left');
});

test('tool names dispatch to their view family and unknown names stay generic', () => {
	assert.equal(dshToolViewId('bash'), 'bash');
	assert.equal(dshToolViewId('read_image'), 'read-image');
	assert.equal(dshToolViewId('apply_patch'), 'file-mutation');
	assert.equal(dshToolViewId('grep'), 'search');
	assert.equal(dshToolViewId('web_fetch'), 'web');
	assert.equal(dshToolViewId('office_convert'), 'office');
	assert.equal(dshToolViewId('subagent_fork'), 'details');
	assert.equal(dshToolViewId('cordis_stop'), 'details');
	assert.equal(dshToolViewId('timeline_tasks'), 'details');
	assert.equal(dshToolViewId('not_a_tool'), 'generic');
	assert.equal(dshToolViewId(''), 'generic');
	assert.equal(dshDetailsToolCount(), 44);
});

test('live detail follows the official field priority and the documented examples', async () => {
	// 官方「Activity summaries → Live activity and detail」的示例表逐条实现。
	const { dshLiveDetailOf, truncateDshDetailText, normalizeDshDetailText } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshToolDetail.ts');

	// description 盖过 prompt
	assert.equal(dshLiveDetailOf({ description: 'Review parser', prompt: 'Long instructions' }), 'Review parser');
	// message 可用于 send_message
	assert.equal(dshLiveDetailOf({ subagent_id: 'child-1', message: 'Check tests' }), 'Check tests');
	// description 盖过 cmd **和** command（官方：`description` can override `command` on a shell call）
	assert.equal(dshLiveDetailOf({ cmd: 'pnpm test', description: 'Run focused tests' }), 'Run focused tests');
	assert.equal(dshLiveDetailOf({ command: 'pnpm test', description: 'Run focused tests' }), 'Run focused tests');
	// title 可以盖过文件路径（官方用例）
	assert.equal(dshLiveDetailOf({ file_path: 'src/app.ts', title: 'Open app' }), 'Open app');
	// 没有 description 时用 cmd
	assert.equal(dshLiveDetailOf({ cmd: 'pnpm test' }), 'pnpm test');
	// file_path 在 path 之前
	assert.equal(dshLiveDetailOf({ file_path: 'src/app.ts', path: 'fallback.ts' }), 'src/app.ts');
	// grep 的 pattern
	assert.equal(dshLiveDetailOf({ pattern: 'TODO', path: 'src' }), 'TODO');
	// 字符串数组逗号连接
	assert.equal(dshLiveDetailOf({ queries: ['React hooks', 'external store'] }), 'React hooks, external store');
	// 对象数组的 queries **不递归** → 落到工具名（这里没有可用字段）
	assert.equal(dshLiveDetailOf({ queries: [{ query: 'React hooks' }] }), undefined);
	// url / uri
	assert.equal(dshLiveDetailOf({ url: 'https://example.com' }), 'https://example.com');
	assert.equal(dshLiveDetailOf({ uri: 'resource://guide' }), 'resource://guide');
	// questions 取第一个非空 question，忽略 header
	assert.equal(dshLiveDetailOf({ questions: [{ header: 'Scope', question: 'Which package?' }, { question: 'Which mode?' }] }), 'Which package?');
	// code 不在字段表里 → undefined
	assert.equal(dshLiveDetailOf({ code: 'print(1)' }), undefined);
	// 空白串与数字被跳过，回落到 path
	assert.equal(dshLiveDetailOf({ description: ' ', command: 42, path: 'src/app.ts' }), 'src/app.ts');
	// 非对象 / 空对象
	assert.equal(dshLiveDetailOf(undefined), undefined);
	assert.equal(dshLiveDetailOf([]), undefined);
	assert.equal(dshLiveDetailOf({}), undefined);
});

test('live detail normalizes whitespace and truncates at 160 graphemes', async () => {
	const { dshLiveDetailOf, truncateDshDetailText, normalizeDshDetailText } = await import('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshToolDetail.ts');
	// 空白压成单空格并去两端
	assert.equal(normalizeDshDetailText('  a\n\n  b\t c  '), 'a b c');
	assert.equal(dshLiveDetailOf({ command: '  echo\n  hi  ' }), 'echo hi');
	// 短文本不截断
	assert.equal(truncateDshDetailText('short', 10), 'short');
	// 超长：结果长度恰为 max，且以 … 结尾
	const long = 'x'.repeat(500);
	const cut = truncateDshDetailText(long, 10);
	assert.equal([...cut].length, 10);
	assert.ok(cut.endsWith('\u2026'));
	// 默认上限 160
	assert.equal([...truncateDshDetailText('y'.repeat(500))].length, 160);
	// emoji（代理对）不被切坏
	const emoji = truncateDshDetailText('😀'.repeat(300), 5);
	assert.equal([...emoji].length, 5);
	assert.ok(!emoji.includes('\uFFFD'));
});
