/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 第 53 轮：Client 半身的 `require` 与 `dsh.client` 声明关系（**证伪一个假设**）。
//
// 起因：`client.js` 里 `require("@deepseek-ai/dsh-client-ui-primitives")` 与
// `require("react")`，而 `dsh.client` 只声明了 `platform` / `immediately` / `inject`，
// **没有** `external`。读 DSH 源码 `packages/client/modules/src/index.ts:61` 时看到
// `external` 的注释是「Module specifiers the package requests from the module table」，
// 一度判断「缺 `external` 会导致 `require` 失败」。
//
// **该假设已被证伪**：同 profile 里的 `dsh-better-sidebar` 与 `dsh-context` 同样
// `require` 了 `@deepseek-ai/dsh-client-ui-primitives`、同样**没有**声明 `external`，
// 而它们是已安装且正常工作的插件。说明 `react` 与 `dsh-client-ui-primitives`
// 由宿主的**静态模块表**提供，不需要 `external` 声明；`external` 只用于声明
// **需要参与模块图排序的其它插件行**。
//
// 本测试的意义：把这条结论钉住，避免后来者（或我）再把它误判为缺陷而改动 manifest。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const manifestPath = path.join(repoRoot, 'build/lib/dsh/package.json');
const clientPath = path.join(repoRoot, 'src/vs/platform/dshClient/client/client.js');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const clientSource = fs.readFileSync(clientPath, 'utf8');

/** `client.js` 里通过 `require(...)` 请求的模块说明符。 */
function requiredSpecifiers() {
	return [...new Set([...clientSource.matchAll(/require\("([^"]+)"\)/g)].map(m => m[1]))].sort();
}

test('client.js only requires host-provided modules (react + ui-primitives)', () => {
	const required = requiredSpecifiers();
	assert.deepEqual(required, ['@deepseek-ai/dsh-client-ui-primitives', 'react'],
		'client half must only require the two host-provided modules; anything else needs a declared dependency');
});

test('dsh.client declares platform/immediately/inject but deliberately omits external', () => {
	const client = manifest?.dsh?.client;
	assert.ok(client !== undefined, 'manifest must declare dsh.client');

	assert.equal(client.platform, 'web', 'client platform must stay web');
	assert.equal(client.immediately, true, 'client must load immediately');
	assert.ok(Array.isArray(client.inject) && client.inject.length >= 3,
		'dsh.client.inject must list the client packages this row contributes to');

	// 关键结论：`external` **刻意不声明**。react 与 ui-primitives 由宿主静态模块表
	// 提供；`external` 只用于声明需要参与模块图排序的其它插件行。
	// 若将来真要引入其它插件行依赖，再显式加 external，并同步改本测试与手册说明。
	assert.equal(client.external, undefined,
		'client.external must stay absent: react and ui-primitives come from the host static module table');
});

test('the two host-provided modules are the documented client-half reuse surface', () => {
	// 手册第 7 章 §4 的资源复用表把这两项列为「DSH client 半身」复用项。
	const dev = fs.readFileSync(path.join(repoRoot, 'docs/DEVELOPMENT.md'), 'utf8');
	assert.match(dev, /`react`、`dsh-client-ui-slots`、`dsh-client-ui-primitives`/,
		'the handbook must keep documenting react / ui-primitives as the client-half reuse surface');
});
