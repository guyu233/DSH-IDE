// DSH 界面语言 → IDE 显示语言与语言包安装。
// 运行：node --test src/vs/platform/dshClient/test/host/dshLanguagePreference.test.mjs

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	applyIdeDisplayLocale,
	findInstalledLanguagePack,
	ideUserDataDir,
	languagePackName,
	localePreferenceFromRows,
	normalizeLocalePreference,
	registerLanguagePack,
	registeredLanguagePacks,
	writeIdeDisplayLocale,
} from '../../common/dshLanguagePreference.js';
import { ensureLanguagePack, languagePackForLocale, readZipEntries } from '../../common/dshLanguagePacks.js';

function tempDir() {
	return mkdtempSync(join(tmpdir(), 'dsh-lang-'));
}

test('DSH locale ids map to the matching IDE language tags', () => {
	assert.equal(normalizeLocalePreference('zh'), 'zh');
	assert.equal(normalizeLocalePreference('pt'), 'pt');
	assert.equal(normalizeLocalePreference('en'), 'en');
	// 未知语言不猜：沿用默认（英文）。
	assert.equal(normalizeLocalePreference('it'), undefined);
	assert.equal(normalizeLocalePreference(undefined), undefined);
	assert.equal(languagePackName('zh'), 'vscode-language-pack-zh-hans');
	assert.equal(languagePackName('pt'), 'vscode-language-pack-pt-br');
	assert.equal(languagePackName('ru'), 'vscode-language-pack-ru');
	assert.equal(languagePackName('en'), undefined);
});

test('the locale row is read from the `locale` namespace', () => {
	assert.equal(localePreferenceFromRows([{ ns: 'locale', value: { preference: 'ja' } }]), 'ja');
	assert.equal(localePreferenceFromRows([{ namespace: 'locale', value: { preference: 'de' } }]), 'de');
	// 外观命名空间不能被当成语言。
	assert.equal(localePreferenceFromRows([{ ns: 'ui-theme', value: { preference: 'dark' } }]), undefined);
	assert.equal(localePreferenceFromRows(undefined), undefined);
});

test('writing the display language keeps the rest of argv.json intact', () => {
	const dir = tempDir();
	try {
		const file = join(dir, 'argv.json');
		writeFileSync(file, '{\n\t// keep me\n\t"enable-crash-reporter": true\n}\n', 'utf8');
		assert.equal(writeIdeDisplayLocale('zh-cn', dir), true);
		const text = readFileSync(file, 'utf8');
		assert.match(text, /"locale": "zh-cn"/);
		assert.match(text, /keep me/, 'existing comments must survive');
		assert.match(text, /enable-crash-reporter/, 'existing settings must survive');
		// 再写一次不能出现两条 locale。
		writeIdeDisplayLocale('ru', dir);
		const updated = readFileSync(file, 'utf8');
		assert.equal((updated.match(/"locale"/g) ?? []).length, 1);
		assert.match(updated, /"locale": "ru"/);
		// 切回英文时删掉这一行。
		writeIdeDisplayLocale(undefined, dir);
		assert.doesNotMatch(readFileSync(file, 'utf8'), /"locale"/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('an installed language pack is registered for selection', () => {
	const dir = tempDir();
	try {
		const packDir = join(dir, 'extensions', 'ms-ceintl.vscode-language-pack-zh-hans-1.131.0');
		mkdirSync(packDir, { recursive: true });
		writeFileSync(join(packDir, 'package.json'), JSON.stringify({
			name: 'vscode-language-pack-zh-hans',
			version: '1.131.0',
			contributes: { localizations: [{ languageId: 'zh-cn', languageName: 'Chinese', localizedLanguageName: '中文', translations: [{ id: 'vscode', path: './translations/main.i18n.json' }] }] },
		}), 'utf8');
		const found = findInstalledLanguagePack('vscode-language-pack-zh-hans', join(dir, 'extensions'));
		assert.ok(found !== undefined);
		assert.equal(registerLanguagePack(found, dir), true);
		const packs = registeredLanguagePacks(dir);
		assert.equal(packs['zh-cn'].label, '中文');
		assert.equal(packs['zh-cn'].translations.vscode, join(packDir, 'translations', 'main.i18n.json'));
		assert.match(packs['zh-cn'].hash, /^[0-9a-f]{32}$/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('switching to a language with no pack still writes argv.json but reports the missing pack', () => {
	const dir = tempDir();
	try {
		const result = applyIdeDisplayLocale('ja', { userDataDir: dir });
		assert.equal(result.changed, true);
		assert.equal(result.missingPack, 'vscode-language-pack-ja');
		assert.match(readFileSync(join(dir, 'argv.json'), 'utf8'), /"locale": "ja"/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('English removes the override instead of requiring a pack', () => {
	const dir = tempDir();
	try {
		writeIdeDisplayLocale('de', dir);
		const result = applyIdeDisplayLocale('en', { userDataDir: dir });
		assert.equal(result.changed, true);
		assert.doesNotMatch(readFileSync(join(dir, 'argv.json'), 'utf8'), /"locale"/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('a real VSIX is readable and carries the expected manifest', async () => {
	// 用仓库里已有的真实语言包样本验证 zip 读取路径；没有样本时跳过，不伪造通过。
	const sample = new URL('../../../../../dist/_lp/zh.vsix', import.meta.url);
	let bytes;
	try {
		bytes = readFileSync(sample);
	} catch {
		return;
	}
	const entries = readZipEntries(bytes);
	const manifest = JSON.parse(entries.get('extension/package.json').toString('utf8'));
	assert.equal(manifest.name, 'vscode-language-pack-zh-hans');
	assert.ok(entries.has('extension/translations/main.i18n.json'));
	assert.equal(readZipEntries(bytes).size, entries.size);
});

test('a failed download never reports the pack as ready', async () => {
	const dir = tempDir();
	try {
		const result = await ensureLanguagePack('ru', {
			extensionsDir: join(dir, 'extensions'),
			fetchImpl: async () => ({ ok: false, status: 503 }),
		});
		assert.equal(result.ok, false);
		assert.match(result.reason, /503/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('an already installed pack is reused without downloading', async () => {
	const dir = tempDir();
	try {
		const packDir = join(dir, 'extensions', 'ms-ceintl.vscode-language-pack-fr-1.131.0');
		mkdirSync(packDir, { recursive: true });
		writeFileSync(join(packDir, 'package.json'), JSON.stringify({
			name: 'vscode-language-pack-fr',
			version: '1.131.0',
			contributes: { localizations: [{ languageId: 'fr', translations: [{ id: 'vscode', path: './translations/main.i18n.json' }] }] },
		}), 'utf8');
		let fetched = false;
		const result = await ensureLanguagePack('fr', {
			extensionsDir: join(dir, 'extensions'),
			fetchImpl: async () => { fetched = true; throw new Error('must not download'); },
		});
		assert.equal(result.ok, true);
		assert.equal(fetched, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('switching back to English clears the override even though no pack is needed', async () => {
	const dir = tempDir();
	try {
		writeIdeDisplayLocale('ru', dir);
		// `skipped` 必须在「可以写 argv.json」这一侧：把 en 当成「语言包没就绪」会永远删不掉旧 locale。
		const result = applyIdeDisplayLocale('en', { userDataDir: dir });
		assert.equal(result.changed, true);
		assert.equal(result.pack, undefined);
		assert.doesNotMatch(readFileSync(join(dir, 'argv.json'), 'utf8'), /"locale"/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
