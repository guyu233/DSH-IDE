/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { getRipgrepExcludeFilter } from '../ripgrep.ts';

suite('ripgrep platform filtering', () => {
	for (const [platform, arch, target] of [
		['win32', 'x64', 'win32-x64'],
		['darwin', 'arm64', 'darwin-arm64'],
		['linux', 'armhf', 'linux-arm'],
		['alpine', 'arm64', 'linux-arm64'],
		['linux', 'alpine', 'linux-x64'],
	]) {
		test(`${platform}-${arch} keeps only the selected platform`, () => {
			const patterns = getRipgrepExcludeFilter(platform, arch);
			assert.equal(patterns[0], '**');
			assert.ok(!patterns.includes(`!**/node_modules/@vscode/ripgrep-universal/bin/${target}/**`));
			assert.equal(patterns.length, 12);
		});
	}
});
