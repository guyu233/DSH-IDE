/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 团队开关命令的纯逻辑单测：无团队时拒绝、选中同值不写回、切换失败要提示。
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshTeamCommand.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

type Outcome = 'unavailable' | 'skipped' | 'unchanged' | 'written' | 'stale';

/**
 * 复刻 `registerDshTeamCommands` 的判定顺序（见 dshTeamCommands.ts）。
 */
async function runToggle(options: {
	readonly team: { enabled: boolean } | null;
	readonly pick: '开启团队' | '关闭团队' | undefined;
	readonly setTeam: (enabled: boolean) => Promise<void>;
	readonly after: { enabled: boolean } | null;
}): Promise<Outcome> {
	if (options.team === null) {
		return 'unavailable';
	}
	if (options.pick === undefined) {
		return 'skipped';
	}
	const next = options.pick === '开启团队';
	if (next === options.team.enabled) {
		return 'unchanged';
	}
	await options.setTeam(next);
	if (options.after !== null && options.after.enabled !== next) {
		return 'stale';
	}
	return 'written';
}

test('no team settings means the command refuses instead of guessing', async () => {
	const outcome = await runToggle({
		team: null,
		pick: '开启团队',
		setTeam: async () => { throw new Error('must not be called'); },
		after: null,
	});
	assert.equal(outcome, 'unavailable');
});

test('cancelling the picker writes nothing', async () => {
	let written = false;
	const outcome = await runToggle({
		team: { enabled: false },
		pick: undefined,
		setTeam: async () => { written = true; },
		after: { enabled: false },
	});
	assert.equal(outcome, 'skipped');
	assert.equal(written, false);
});

test('picking the current state does not issue a redundant write', async () => {
	let written = false;
	const outcome = await runToggle({
		team: { enabled: true },
		pick: '开启团队',
		setTeam: async () => { written = true; },
		after: { enabled: true },
	});
	assert.equal(outcome, 'unchanged');
	assert.equal(written, false);
});

test('the current-state mark is on the option that matches enabled', () => {
	const file = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshTeamCommands.ts', import.meta.url), 'utf8');
	const enableAt = file.indexOf('label: enable');
	const disableAt = file.indexOf('label: disable');
	assert.ok(enableAt >= 0 && disableAt > enableAt);
	const enableLine = file.slice(enableAt, disableAt);
	const disableLine = file.slice(disableAt, file.indexOf('],', disableAt));
	assert.match(enableLine, /team\.enabled === true/);
	assert.doesNotMatch(enableLine, /team\.enabled === false/);
	assert.match(disableLine, /team\.enabled === false/);
	assert.match(file, /dsh\.team\.alreadyOn/);
	assert.match(file, /dsh\.team\.turnedOn/);
	assert.match(file, /dsh\.team\.turnedOff/);
});

test('a real toggle writes and is confirmed by the refreshed state', async () => {
	let written: boolean | undefined;
	const outcome = await runToggle({
		team: { enabled: false },
		pick: '开启团队',
		setTeam: async enabled => { written = enabled; },
		after: { enabled: true },
	});
	assert.equal(outcome, 'written');
	assert.equal(written, true);
});

test('a rejected toggle surfaces instead of pretending success', async () => {
	const outcome = await runToggle({
		team: { enabled: false },
		pick: '开启团队',
		setTeam: async () => { /* 官方拒绝：state 不变 */ },
		after: { enabled: false },
	});
	assert.equal(outcome, 'stale');
});
