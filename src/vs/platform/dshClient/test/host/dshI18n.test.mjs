/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH-IDE 的英中词典与 i18n 补丁。
// 运行：node --test src/vs/platform/dshClient/test/host/dshI18n.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildDshI18n, checkDshDictionaries, DSH_I18N_MODULES } from '../../../../workbench/contrib/dsh/browser/i18n/dshI18n.mjs';
import { mergeI18nPatch } from '../../common/dshLanguagePacks.js';

const here = dirname(fileURLToPath(import.meta.url));
const i18nDir = join(here, '../../../../workbench/contrib/dsh/browser/i18n');
const english = JSON.parse(readFileSync(join(i18nDir, 'dsh.nls.json'), 'utf8'));
const chinese = JSON.parse(readFileSync(join(i18nDir, 'dsh.nls.zh-cn.json'), 'utf8'));

test('every English source has exactly one Chinese translation', () => {
	assert.deepEqual(checkDshDictionaries(english, chinese), []);
	assert.equal(Object.keys(english).length, Object.keys(chinese).length);
	assert.ok(Object.keys(english).length > 140, `expected the full dictionary, saw ${Object.keys(english).length}`);
});

test('all placeholders survive translation', () => {
	for (const [key, text] of Object.entries(english)) {
		const en = [...String(text).matchAll(/\{[A-Za-z0-9_]+\}/g)].map(m => m[0]).join(',');
		const zh = [...String(chinese[key]).matchAll(/\{[A-Za-z0-9_]+\}/g)].map(m => m[0]).join(',');
		assert.equal(zh, en, `${key} must keep its placeholders in the same order`);
	}
});

test('a missing or mismatched translation is reported, not silently ignored', () => {
	assert.deepEqual(checkDshDictionaries({ a: 'Hello {0}' }, { a: '你好 {0}' }), []);
	assert.match(checkDshDictionaries({ a: 'Hello {0}' }, {})[0], /missing Chinese translation: a/);
	assert.match(checkDshDictionaries({ a: 'Hello {0}' }, { a: '你好' })[0], /placeholder mismatch for a/);
	assert.match(checkDshDictionaries({}, { a: '你好' })[0], /translation without an English source/);
});

test('every dictionary key is assigned to a real module', () => {
	const mapped = new Set(Object.values(DSH_I18N_MODULES).flat());
	for (const key of Object.keys(english)) {
		assert.ok(mapped.has(key), `${key} is not mapped to a module`);
	}
	for (const key of mapped) {
		assert.ok(key in english, `${key} is mapped but has no English source`);
	}
});

test('the built i18n payload groups translations by module', () => {
	const payload = buildDshI18n(DSH_I18N_MODULES, chinese, '2.0.0');
	assert.equal(payload.version, '2.0.0');
	assert.equal(Object.keys(payload.contents).length, Object.keys(DSH_I18N_MODULES).length);
	const team = payload.contents['vs/workbench/contrib/dsh/browser/dshTeamCommands'];
	assert.equal(team['dsh.team.enable'], '开启团队');
});

test('merging a patch keeps the upstream translations of the language pack', () => {
	const dir = mkdtempSync(join(tmpdir(), 'dsh-i18n-merge-'));
	try {
		mkdirSync(join(dir, 'translations'), { recursive: true });
		writeFileSync(join(dir, 'translations', 'main.i18n.json'), JSON.stringify({
			version: '1.131.0',
			contents: {
				'vs/base/browser/ui/button/button': { ok: '确定' },
				'vs/workbench/contrib/dsh/browser/dshTeamCommands': { 'dsh.team.enable': '旧译文' },
			},
		}), 'utf8');
		const payload = buildDshI18n(DSH_I18N_MODULES, chinese, '2.0.0');
		assert.equal(mergeI18nPatch(dir, payload), true);
		const merged = JSON.parse(readFileSync(join(dir, 'translations', 'main.i18n.json'), 'utf8'));
		assert.equal(merged.contents['vs/base/browser/ui/button/button'].ok, '确定', 'upstream translations must survive');
		assert.equal(merged.contents['vs/workbench/contrib/dsh/browser/dshTeamCommands']['dsh.team.enable'], '开启团队', 'our key is updated');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('a pack without a readable main.i18n.json is left alone', () => {
	const dir = mkdtempSync(join(tmpdir(), 'dsh-i18n-missing-'));
	try {
		assert.equal(mergeI18nPatch(dir, { version: '1', contents: {} }), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
