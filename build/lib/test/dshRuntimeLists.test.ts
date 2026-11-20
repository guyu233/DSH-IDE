/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// MCP / 作业名单投影：坏行不能抛，字符串状态不能被写成 unknown。
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshRuntimeLists.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dshJobChoices, dshMcpChoices, dshMcpStatusText } from '../../../src/vs/workbench/contrib/dsh/browser/dshRuntimeLists.ts';

test('a string MCP status is shown as-is', () => {
	assert.equal(dshMcpStatusText('ready'), 'ready');
	assert.equal(dshMcpStatusText({ state: 'error', reason: 'boom' }), 'error (boom)');
	assert.equal(dshMcpStatusText({ state: 'idle', reason: { code: 1 } }), 'idle');
	assert.equal(dshMcpStatusText(null), 'unknown');
});

test('null MCP rows are dropped instead of throwing', () => {
	assert.deepEqual(dshMcpChoices([null, { name: '' }, { name: 'fs', status: 'ready' }, { title: 'no-name' }]), [
		{ name: 'fs', description: 'ready' },
	]);
	assert.deepEqual(dshMcpChoices({ servers: [] }), []);
});

test('jobs without an id are dropped and a missing label falls back to the id', () => {
	assert.deepEqual(dshJobChoices([null, { label: 'orphan' }, { id: 'j-1', status: 'running', progress: '1/2' }]), [
		{ id: 'j-1', label: 'j-1', description: 'running · 1/2' },
	]);
});

test('a duplicated mcp server name or job id appears only once', () => {
	// Host 侧原样返回官方 list，不去重。重复时选择器会有两行一样的条目，
	// 「重启」/「终止」打到哪个说不清。
	const servers = dshMcpChoices([
		{ name: 'fs', status: 'connected' },
		{ name: 'fs', status: 'connected' },
		{ name: 'git', status: 'error' },
	]);
	assert.deepEqual(servers.map(s => s.name), ['fs', 'git']);
	const jobs = dshJobChoices([
		{ id: 'j-1', label: '构建' },
		{ id: 'j-1', label: '构建' },
		{ id: 'j-2' },
	]);
	assert.deepEqual(jobs.map(j => j.id), ['j-1', 'j-2']);
});
