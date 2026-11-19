/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { suite, test, type TestContext } from 'node:test';
import { Readable } from 'node:stream';
import VinylFile from 'vinyl';
import { filter } from '../gulp/facade.ts';
import { DSH_IDE_HOST_RG_PATH, resolveHostRipgrep } from '../../../src/vs/platform/dshClient/host/host-ripgrep.js';
import { getDshRipgrepPayloadFilter, getRipgrepExcludeFilter } from '../ripgrep.ts';

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

test('DSH packaging filters only the physical rg.exe after building the ASAR', async () => {
	const rg = 'node_modules.asar.unpacked/@vscode/ripgrep-universal/bin/win32-x64/rg.exe';
	const remaining = ['node_modules.asar', 'node_modules.asar.unpacked/node-pty/prebuilds/win32-x64/conpty.node', 'node_modules/@vscode/sandbox-runtime/dist/cli.js'];
	const input = [rg, ...remaining].map(path => new VinylFile({ path: join(process.cwd(), path), contents: Buffer.from(path) }));
	const output: string[] = [];
	await new Promise<void>((resolve, reject) => {
		const stream = filter(getDshRipgrepPayloadFilter('x64'), { dot: true });
		stream.on('data', (file: VinylFile) => output.push(file.relative.replaceAll('\\', '/')));
		stream.once('end', resolve);
		stream.once('error', reject);
		Readable.from(input).once('error', reject).pipe(stream);
	});
	assert.deepEqual(output, remaining);
});

test('exposes the environment variable name the IDE reads', () => {
	assert.equal(DSH_IDE_HOST_RG_PATH, 'DSH_IDE_HOST_RG_PATH');
});

function fixture(t: TestContext) {
	const root = mkdtempSync(join(tmpdir(), 'dsh-ide-rg-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const resourcesPath = join(root, 'host', 'resources');
	const hostExecutable = join(resourcesPath, 'rg package', 'bin', 'rg.exe');
	mkdirSync(dirname(hostExecutable), { recursive: true });
	writeFileSync(hostExecutable, 'Host binary');
	return { root, resourcesPath, hostExecutable };
}

const windowsOnly = { skip: process.platform !== 'win32' };

test('resolves the Host executable without creating or modifying files', windowsOnly, async t => {
	const { resourcesPath, hostExecutable } = fixture(t);
	const resolved = await resolveHostRipgrep({ resourcesPath, resolveRipgrep: async () => hostExecutable });
	assert.equal(resolved, realpathSync(hostExecutable));
	// 解析本身不得产生任何额外条目。
	assert.deepEqual(readdirSync(join(resourcesPath, 'rg package', 'bin')), ['rg.exe']);
});

test('rejects an executable outside the Host resources', windowsOnly, async t => {
	const { root, resourcesPath } = fixture(t);
	const foreign = join(root, 'rg.exe');
	writeFileSync(foreign, 'Foreign');
	await assert.rejects(resolveHostRipgrep({ resourcesPath, resolveRipgrep: async () => foreign }), /not a file in the DSH Host resources/);
});

test('rejects a missing Host executable', windowsOnly, async t => {
	const { resourcesPath, hostExecutable } = fixture(t);
	await assert.rejects(resolveHostRipgrep({ resourcesPath, resolveRipgrep: async () => join(dirname(hostExecutable), 'missing.exe') }), /ENOENT/);
});
