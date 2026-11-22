import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { mergeIdeSettings, themePreferenceFromRows, writeIdeThemeSettings } from '../../common/dshThemePreference.js';

test('missing ui-theme section defaults to system', () => {
	assert.equal(themePreferenceFromRows([]), 'system');
	assert.equal(themePreferenceFromRows([{ ns: 'ui-chat', value: { transcriptView: 'standard' } }]), 'system');
});

test('reads light, dark and system, rejects anything else', () => {
	assert.equal(themePreferenceFromRows([{ ns: 'ui-theme', value: { preference: 'dark' } }]), 'dark');
	assert.equal(themePreferenceFromRows([{ namespace: 'ui-theme', value: { preference: 'light' } }]), 'light');
	assert.equal(themePreferenceFromRows([{ ns: 'ui-theme', value: { preference: 'nope' } }]), 'system');
});

test('system turns on auto detect and does not pin a color theme', () => {
	const merged = mergeIdeSettings({ 'editor.fontSize': 14 }, 'system');
	assert.equal(merged['window.autoDetectColorScheme'], true);
	assert.equal(merged['workbench.preferredLightColorTheme'], 'Light Modern');
	assert.equal(merged['workbench.preferredDarkColorTheme'], 'Dark Modern');
	assert.equal(merged['workbench.colorTheme'], undefined);
	assert.equal(merged['editor.fontSize'], 14);
});

test('light and dark pin the matching theme and turn auto detect off', () => {
	assert.equal(mergeIdeSettings({}, 'light')['workbench.colorTheme'], 'Light Modern');
	assert.equal(mergeIdeSettings({}, 'light')['window.autoDetectColorScheme'], false);
	assert.equal(mergeIdeSettings({}, 'dark')['workbench.colorTheme'], 'Dark Modern');
});

test('write keeps existing keys and refuses commented json', () => {
	const dir = mkdtempSync(join(tmpdir(), 'dsh-theme-'));
	const file = join(dir, 'settings.json');
	try {
		writeFileSync(file, '{\n  "editor.fontSize": 16\n}\n');
		assert.equal(writeIdeThemeSettings('dark', file), true);
		const written = JSON.parse(readFileSync(file, 'utf8'));
		assert.equal(written['editor.fontSize'], 16);
		assert.equal(written['workbench.colorTheme'], 'Dark Modern');
		writeFileSync(file, '{\n  // comment\n  "editor.fontSize": 16\n}\n');
		assert.equal(writeIdeThemeSettings('light', file), false);
		assert.match(readFileSync(file, 'utf8'), /comment/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
