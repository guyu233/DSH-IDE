/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, suite, test } from 'node:test';
import { captureDshBuildProvenance } from '../dshBuildProvenance.ts';

suite('DSH build provenance', () => {
	let repository: string;
	let head: string;
	const originalCleanOnly = process.env['DSH_BUILD_CLEAN_ONLY'];
	const scope = ['inputs'];
	const capture = (source?: string) => captureDshBuildProvenance(repository, source, scope);
	const git = (...args: string[]) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' }).trim();

	beforeEach(() => {
		repository = fs.mkdtempSync(join(tmpdir(), 'dsh-build-provenance-'));
		execFileSync('git', ['init', '-q', repository]);
		git('config', 'user.email', 'build-test@example.invalid');
		git('config', 'user.name', 'Build Test');
		fs.mkdirSync(join(repository, 'inputs'));
		fs.writeFileSync(join(repository, 'inputs/input.txt'), 'source');
		git('add', 'inputs/input.txt');
		git('commit', '-qm', 'source');
		head = git('rev-parse', 'HEAD');
		delete process.env['DSH_BUILD_CLEAN_ONLY'];
	});

	afterEach(() => {
		fs.rmSync(repository, { recursive: true, force: true });
		if (originalCleanOnly === undefined) { delete process.env['DSH_BUILD_CLEAN_ONLY']; }
		else { process.env['DSH_BUILD_CLEAN_ONLY'] = originalCleanOnly; }
	});

	test('defaults to real HEAD and records scope and exclusions', () => {
		const actual = capture();
		assert.deepStrictEqual({ head: actual.repositoryHead, commit: actual.sourceCommit, dirty: actual.dirty, scope: actual.inputScope },
			{ head, commit: head, dirty: false, scope });
		assert.match(actual.workingTreeDigest, /^[0-9a-f]{64}$/);
		assert.match(actual.excludedPathPolicy, /excluded/);
	});

	test('captures tracked, staged, untracked, renames and subsequent edits', () => {
		const clean = capture();
		fs.writeFileSync(join(repository, 'inputs/input.txt'), 'changed');
		const tracked = capture();
		git('add', 'inputs/input.txt');
		const staged = capture();
		fs.writeFileSync(join(repository, 'inputs/new.txt'), 'untracked');
		const untracked = capture();
		fs.writeFileSync(join(repository, 'inputs/new.txt'), 'changed');
		const updated = capture();
		git('mv', 'inputs/input.txt', 'inputs/renamed.txt');
		const renamed = capture();
		assert.deepStrictEqual([clean.dirty, tracked.dirty, staged.dirty, untracked.dirty, renamed.dirty], [false, true, true, true, true]);
		assert.equal(new Set([clean, tracked, staged, untracked, updated, renamed].map(value => value.workingTreeDigest)).size, 6);
	});

	test('does not read or expose out-of-scope or secret-named untracked files', t => {
		const before = capture();
		fs.writeFileSync(join(repository, '.env'), 'outside');
		fs.writeFileSync(join(repository, 'inputs/.env'), 'inside');
		fs.writeFileSync(join(repository, 'inputs/private-key.pem'), 'private');
		fs.writeFileSync(join(repository, 'inputs/secret-token.txt'), 'token');
		const reads: string[] = [];
		const original = fs.readFileSync;
		t.mock.method(fs, 'readFileSync', ((file: fs.PathOrFileDescriptor, ...args: unknown[]) => {
			reads.push(String(file));
			return Reflect.apply(original, fs, [file, ...args]);
		}) as typeof fs.readFileSync);
		const after = capture();
		assert.deepStrictEqual(reads, [join(repository, 'inputs/input.txt')]);
		fs.writeFileSync(join(repository, 'inputs/private-key.pem'), 'different private content');
		assert.deepStrictEqual(capture(), after);
		assert.deepStrictEqual(after, before);
		assert.ok(!JSON.stringify(after).includes('private-key.pem'));
	});

	test('validates source commit and clean-only scope', () => {
		assert.throws(() => capture(''), /40-character Git commit ID/);
		assert.throws(() => capture('0'.repeat(40)));
		assert.equal(capture(head).sourceCommit, head);
		fs.writeFileSync(join(repository, 'inputs/input.txt'), 'dirty');
		process.env['DSH_BUILD_CLEAN_ONLY'] = '1';
		assert.throws(() => capture(), /requires a clean scoped source tree/);
	});
});
