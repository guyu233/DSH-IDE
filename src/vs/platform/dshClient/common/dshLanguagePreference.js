// DSH 界面语言 → IDE 显示语言。DSH 是唯一来源，IDE 跟着切。

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * DSH 语言 id → IDE 语言包 id。
 *
 * DSH 的 `locale.preference` 用短标签（zh / en / ja / es / fr / de / ru / pt），
 * VS Code 语言包用带地区的标签（zh-cn / pt-br）。这里只做一一对应，
 * 没有语言包的语言不猜：返回 undefined，界面保持英文。
 */
const DSH_TO_IDE_LANGUAGE = Object.freeze({
	zh: 'zh-cn',
	en: 'en',
	ja: 'ja',
	es: 'es',
	fr: 'fr',
	de: 'de',
	ru: 'ru',
	pt: 'pt-br',
});

/** 语言包扩展 id 前缀：VS Code 官方语言包都是 `ms-ceintl.<name>`。 */
const LANGUAGE_PACK_PUBLISHER = 'ms-ceintl';

/** @param {unknown} value */
export function normalizeLocalePreference(value) {
	return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DSH_TO_IDE_LANGUAGE, value)
		? value
		: undefined;
}

/**
 * 从 Host `settings.describe()` 的结果里取语言。没有这项时返回 undefined（跟随英文）。
 * @param {unknown} rows
 */
export function localePreferenceFromRows(rows) {
	if (!Array.isArray(rows)) {
		return undefined;
	}
	const row = rows.find(item => item && (item.ns === 'locale' || item.namespace === 'locale'));
	const value = row && typeof row.value === 'object' && row.value !== null ? row.value.preference : undefined;
	return normalizeLocalePreference(value);
}

/** DSH 语言 id → VS Code 语言包扩展名（`zh` → `vscode-language-pack-zh-hans`）。 */
export function languagePackName(locale) {
	switch (locale) {
		case 'zh': return 'vscode-language-pack-zh-hans';
		case 'pt': return 'vscode-language-pack-pt-br';
		case 'en': return undefined;
		case 'ja': return 'vscode-language-pack-ja';
		case 'es': return 'vscode-language-pack-es';
		case 'fr': return 'vscode-language-pack-fr';
		case 'de': return 'vscode-language-pack-de';
		case 'ru': return 'vscode-language-pack-ru';
		default: return undefined;
	}
}

/** IDE 用户数据目录：Windows 上就是 `%APPDATA%/DSH IDE`。 */
export function ideUserDataDir(appData = process.env.APPDATA) {
	if (typeof appData === 'string' && appData !== '') {
		return join(appData, 'DSH IDE');
	}
	return join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh-ide-oss');
}

/**
 * 已安装扩展目录。VS Code 的扩展都在 `<userData>/extensions/<publisher>.<name>-<version>/`。
 * @param {string} [userDataDir]
 */
export function ideExtensionsDir(userDataDir = ideUserDataDir()) {
	return join(userDataDir, 'extensions');
}

/**
 * 在已安装扩展里找某个语言包。
 *
 * 只认目录里带 `package.json` 且声明了 `contributes.localizations` 的扩展；
 * 目录名大小写在不同版本里不固定，因此按前缀比较。
 * @param {string} name 语言包扩展名（不含 publisher）
 * @param {string} [extensionsDir]
 * @returns {{ dir: string, manifest: any } | undefined}
 */
export function findInstalledLanguagePack(name, extensionsDir = ideExtensionsDir()) {
	if (!existsSync(extensionsDir)) {
		return undefined;
	}
	const prefix = `${LANGUAGE_PACK_PUBLISHER}.${name}-`.toLowerCase();
	for (const entry of readdirSync(extensionsDir)) {
		if (!entry.toLowerCase().startsWith(prefix)) {
			continue;
		}
		const dir = join(extensionsDir, entry);
		const manifestPath = join(dir, 'package.json');
		if (!existsSync(manifestPath)) {
			continue;
		}
		let manifest;
		try {
			manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
		} catch {
			continue;
		}
		const localizations = manifest?.contributes?.localizations;
		if (Array.isArray(localizations) && localizations.length > 0) {
			return { dir, manifest };
		}
	}
	return undefined;
}

/**
 * 把语言包写进 `languagepacks.json`。
 *
 * VS Code 只在 `languagepacks.json` 里登记的包才会被当成显示语言；光把扩展放进目录不够。
 * 登记项的形状与 `NativeLanguagePackService.createLanguagePacksFromExtension` 一致：
 * `hash` 是扩展 id+version 的 md5，`translations` 是 translation id → 绝对路径。
 * @param {{ dir: string, manifest: any }} pack
 * @param {string} [userDataDir]
 * @returns {boolean} 是否写成功
 */
export function registerLanguagePack(pack, userDataDir = ideUserDataDir()) {
	const localizations = pack.manifest?.contributes?.localizations;
	if (!Array.isArray(localizations) || localizations.length === 0) {
		return false;
	}
	const file = join(userDataDir, 'languagepacks.json');
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
	const version = String(pack.manifest.version ?? '0.0.0');
	const extensionId = `${LANGUAGE_PACK_PUBLISHER}.${String(pack.manifest.name ?? '')}`.toLowerCase();
	const next = { ...current };
	for (const localization of localizations) {
		if (typeof localization?.languageId !== 'string' || !Array.isArray(localization.translations)) {
			continue;
		}
		const translations = {};
		for (const translation of localization.translations) {
			if (typeof translation?.id === 'string' && typeof translation.path === 'string') {
				translations[translation.id] = join(pack.dir, translation.path);
			}
		}
		const hash = createHash('md5').update(extensionId).update(version).digest('hex');
		next[localization.languageId] = {
			hash,
			label: localization.localizedLanguageName ?? localization.languageName,
			extensions: [{ extensionIdentifier: { id: extensionId }, version }],
			translations,
		};
	}
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(next, null, '\t'), 'utf8');
	return true;
}

/**
 * 把 IDE 显示语言写成 `argv.json` 的 `locale`。
 *
 * `argv.json` 默认带注释，不能整体 JSON.parse / 重写：那会把用户的注释和设置一起抹掉。
 * 这里只替换已有的 `"locale"` 行，没有就插到最后一个 `}` 前；文件读不到时新建。
 * @param {string | undefined} locale undefined = 英文（删掉 locale 行）
 * @param {string} [userDataDir]
 * @returns {boolean}
 */
export function writeIdeDisplayLocale(locale, userDataDir = ideUserDataDir()) {
	const file = join(userDataDir, 'argv.json');
	let text = '';
	try {
		text = readFileSync(file, 'utf8');
	} catch (error) {
		if (error && error.code !== 'ENOENT') {
			return false;
		}
	}
	if (text.trim() === '') {
		text = '{\n}\n';
	}
	const line = locale === undefined ? undefined : `\t"locale": ${JSON.stringify(locale)},`;
	const existing = /^[ \t]*"locale"\s*:[^\n]*$/m;
	if (line === undefined) {
		if (existing.test(text)) {
			text = text.replace(/^[ \t]*"locale"\s*:[^\n]*\n?/m, '');
		}
	} else if (existing.test(text)) {
		text = text.replace(existing, line);
	} else {
		const close = text.lastIndexOf('}');
		if (close < 0) {
			return false;
		}
		const before = text.slice(0, close).replace(/\s*$/, '');
		const needsComma = !/[{,]\s*$/.test(before);
		text = `${before}${needsComma ? ',' : ''}\n${line}\n${text.slice(close)}`;
	}
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
	return true;
}

/**
 * 一次性把 DSH 语言同步到 IDE：登记语言包 + 写 argv.json。
 *
 * 只处理已安装的语言包；没装就只写 argv.json，并在结果里说明缺哪个包，
 * 不伪造「已切换」。
 * @param {string | undefined} locale DSH 语言 id
 * @param {{ userDataDir?: string, extensionsDir?: string }} [options]
 */
export function applyIdeDisplayLocale(locale, options = {}) {
	const userDataDir = options.userDataDir ?? ideUserDataDir();
	const extensionsDir = options.extensionsDir ?? join(userDataDir, 'extensions');
	const normalized = normalizeLocalePreference(locale);
	if (normalized === undefined || normalized === 'en') {
		// 切回英文要删掉 locale；返回 previous 供调用方判断是否真的改了（决定要不要提示重载）。
		const previous = readIdeDisplayLocale(userDataDir);
		const changed = writeIdeDisplayLocale(undefined, userDataDir);
		return { changed, previous, pack: undefined, missingPack: undefined };
	}
	const name = languagePackName(normalized);
	const pack = name === undefined ? undefined : findInstalledLanguagePack(name, extensionsDir);
	if (pack !== undefined) {
		registerLanguagePack(pack, userDataDir);
	}
	const languageId = DSH_TO_IDE_LANGUAGE[normalized];
	const previous = readIdeDisplayLocale(userDataDir);
	return {
		changed: writeIdeDisplayLocale(languageId, userDataDir),
		previous,
		pack: pack?.dir,
		missingPack: pack === undefined ? name : undefined,
	};
}

/**
 * 读回 argv.json 里当前的显示语言（没有 locale 行就是英文）。
 * 用于判断这次写入是否真的改变了设置——没变就不该提示用户重载。
 * @param {string} [userDataDir]
 */
export function readIdeDisplayLocale(userDataDir = ideUserDataDir()) {
	try {
		const text = readFileSync(join(userDataDir, 'argv.json'), 'utf8');
		const match = /^[ \t]*"locale"\s*:\s*"([^"]*)"/m.exec(text);
		return match?.[1] ?? 'en';
	} catch {
		return 'en';
	}
}

/** 供测试与诊断：当前 IDE 已登记的语言。 */
export function registeredLanguagePacks(userDataDir = ideUserDataDir()) {
	const file = join(userDataDir, 'languagepacks.json');
	if (!existsSync(file)) {
		return {};
	}
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return {};
	}
}
