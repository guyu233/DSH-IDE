/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// D53：README 项目定义与「有边界一致性 / 第三方插件例外」口径的回归守护。
//
// 权威层级（README §4）：代码与门禁脚本 > 契约真源 > 开发手册职责章节 > 其它文档。
// 因此本测试只钉「README 不得把边界写成完全同步、不得扩大第三方依赖范围、
// 不得自造通知机制」，不改写 L1（§8.2.4 / §8.10.8）的唯一定义。
//
// 反例闸门：一旦有人把 README 的边界表述改回「完全同步 / 实时镜像 / 推送通知」，
// 或在其它端点登记第二个第三方插件依赖，本测试立即失败。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

test('D53 README declares bounded consistency and points to the single L1 definition', () => {
	const readme = read('README.md');
	// 必须如实声明边界：有边界的最终一致性 + 不宣称完全同步。
	assert.match(readme, /有边界的最终一致性/, 'README must state bounded eventual consistency');
	assert.match(readme, /不宣称完全同步/, 'README must explicitly refuse the full-sync claim');
	// 必须指向唯一真源，不在 L0 复制定义。
	assert.match(readme, /docs\/DEVELOPMENT\.md[^\n]*第 8 章 §8\.2\.4/, 'README must point at the single L1 definition');
});

test('D53 README rejects a notification mechanism for session changes', () => {
	const readme = read('README.md');
	// 明确否定：不做定时轮询 / 推送通知——避免后续「补一个通知机制」的滑移。
	assert.match(readme, /不做定时轮询或推送通知/, 'README must refuse polling/push notification');
	// 主动重查的三处触发必须写清楚（开窗 / 聚焦 / 手动刷新）。
	assert.match(readme, /开窗[、，]\s*窗口聚焦与手动刷新/, 'README must name the three refresh triggers');
});

test('D53 README registers exactly one third-party endpoint exception', () => {
	const readme = read('README.md');
	// 例外仅限 deleteSession 一个端点，且点名经批准的插件与版本。
	assert.match(readme, /deleteSession/, 'the exception must name deleteSession');
	assert.match(readme, /@michengai\/dsh-archive-manager@1\.3\.1/, 'the exception must pin the approved plugin version');
	assert.match(readme, /仅限该端点/, 'the exception must be scoped to that endpoint only');
	assert.match(readme, /FEATURE_UNAVAILABLE/, 'the missing-plugin path must stay fail-closed');
	// 不得出现第二个被批准的第三方端点说法。
	const approvals = readme.match(/经用户批准/g) ?? [];
	assert.equal(approvals.length, 1, 'README must record exactly one user-approved third-party exception');
});

test('D53 L1 keeps the authoritative definition the README points to', () => {
	const dev = read('docs/DEVELOPMENT.md');
	// §8.2.4 必须仍是有边界最终一致性的唯一定义处。
	assert.match(dev, /#### 8\.2\.4[^\n]*有边界一致性/, '§8.2.4 must remain the bounded-consistency home');
	assert.match(dev, /有边界的最终一致性/, '§8.2.4 must keep the definition text');
	// §8.10.8 必须仍把第三方依赖限制在唯一端点。
	assert.match(dev, /适用范围仅限本端点|仅限本端点/, '§8.10.8 must keep the endpoint-only scope');
});
