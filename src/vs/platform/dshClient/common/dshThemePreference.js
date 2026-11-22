// DSH 外观只有三项：light / dark / system（设置命名空间 ui-theme，字段 preference）。
// IDE 只保留与之对应的两个配色，跟随系统时打开自动检测。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DSH_LIGHT_THEME = 'Light Modern';
export const DSH_DARK_THEME = 'Dark Modern';

/** @param {unknown} value */
export function normalizeThemePreference(value) {
	if (value === 'light' || value === 'dark' || value === 'system') {
		return value;
	}
	return 'system';
}

/**
 * 从 Host `settings.describe()` 的结果里取外观。没有这项时按 DSH 的默认值 system。
 * @param {unknown} rows
 */
export function themePreferenceFromRows(rows) {
	if (!Array.isArray(rows)) {
		return 'system';
	}
	const row = rows.find(item => item && (item.ns === 'ui-theme' || item.namespace === 'ui-theme'));
	const value = row && typeof row.value === 'object' && row.value !== null ? row.value.preference : undefined;
	return normalizeThemePreference(value);
}

/**
 * 写成 IDE 用户设置里的那几项。跟随系统只开自动检测，不把某一侧写死成当前主题。
 * @param {'light' | 'dark' | 'system'} preference
 */
export function ideThemeSettings(preference) {
	const mode = normalizeThemePreference(preference);
	if (mode === 'light') {
		return {
			'window.autoDetectColorScheme': false,
			'workbench.colorTheme': DSH_LIGHT_THEME,
			'workbench.preferredLightColorTheme': DSH_LIGHT_THEME,
			'workbench.preferredDarkColorTheme': DSH_DARK_THEME,
		};
	}
	if (mode === 'dark') {
		return {
			'window.autoDetectColorScheme': false,
			'workbench.colorTheme': DSH_DARK_THEME,
			'workbench.preferredLightColorTheme': DSH_LIGHT_THEME,
			'workbench.preferredDarkColorTheme': DSH_DARK_THEME,
		};
	}
	return {
		'window.autoDetectColorScheme': true,
		'workbench.preferredLightColorTheme': DSH_LIGHT_THEME,
		'workbench.preferredDarkColorTheme': DSH_DARK_THEME,
	};
}

/**
 * @param {unknown} current
 * @param {'light' | 'dark' | 'system'} preference
 */
export function mergeIdeSettings(current, preference) {
	const base = current !== null && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {};
	return { ...base, ...ideThemeSettings(preference) };
}

/** 正在运行的 DSH IDE 用户设置。Windows 上就是 `%APPDATA%/DSH IDE/User/settings.json`。 */
export function ideUserSettingsFile() {
	const appData = process.env.APPDATA;
	if (typeof appData === 'string' && appData !== '') {
		return join(appData, 'DSH IDE', 'User', 'settings.json');
	}
	return join(homedir(), '.dsh-ide-oss', 'User', 'settings.json');
}

/**
 * 把外观写进 IDE 用户设置。文件带注释或坏 JSON 时不动，避免把用户的设置写坏。
 * @param {'light' | 'dark' | 'system'} preference
 * @param {string} [file]
 * @returns {boolean}
 */
export function writeIdeThemeSettings(preference, file = ideUserSettingsFile()) {
	let current = {};
	try {
		const text = readFileSync(file, 'utf8');
		if (text.trim() !== '') {
			const parsed = JSON.parse(text);
			if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
				return false;
			}
			current = parsed;
		}
	} catch (error) {
		if (error && error.code !== 'ENOENT') {
			return false;
		}
	}
	const next = mergeIdeSettings(current, preference);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
	return true;
}
