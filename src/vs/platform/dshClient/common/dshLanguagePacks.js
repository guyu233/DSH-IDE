// 给 IDE 装 DSH 支持的语言包。DSH 的语言清单是唯一来源，IDE 只按它准备对应语言。

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * DSH 语言 id → 官方语言包在 Open VSX 上的扩展名。
 *
 * VS Code 官方界面语言包由 MS-CEINTL 发布；`en` 是内置语言，不需要包。
 */
export const LANGUAGE_PACK_EXTENSIONS = Object.freeze({
	zh: 'vscode-language-pack-zh-hans',
	ja: 'vscode-language-pack-ja',
	es: 'vscode-language-pack-es',
	fr: 'vscode-language-pack-fr',
	de: 'vscode-language-pack-de',
	ru: 'vscode-language-pack-ru',
	pt: 'vscode-language-pack-pt-br',
});

/** 这些 DSH 语言 id 可以直接换到 IDE 显示语言（en 是默认，无需包）。 */
export function languagePackForLocale(locale) {
	return typeof locale === 'string' && Object.prototype.hasOwnProperty.call(LANGUAGE_PACK_EXTENSIONS, locale)
		? LANGUAGE_PACK_EXTENSIONS[locale]
		: undefined;
}

/**
 * 从 zip 中读出扩展包清单。只用 Node 自带的 zlib 解压，不引入第三方依赖。
 *
 * VSIX 是 zip：这里只支持 stored / deflate 两种压缩方式，其它方式明确拒绝，
 * 不静默产出半个扩展。
 * @param {Buffer} data
 * @returns {Map<string, Buffer>}
 */
export function readZipEntries(data) {
	const entries = new Map();
	// 必须走中央目录：VSIX 用数据描述符写本地头，本地头里的压缩长度是 0，
	// 按本地头解压会读到半截流（Z_BUF_ERROR）。
	const eocd = findEndOfCentralDirectory(data);
	const count = data.readUInt16LE(eocd + 10);
	let offset = data.readUInt32LE(eocd + 16);
	for (let i = 0; i < count; i++) {
		if (data.readUInt32LE(offset) !== 0x02014b50) {
			throw new Error('corrupt zip: bad central directory signature');
		}
		const method = data.readUInt16LE(offset + 10);
		const compressedSize = data.readUInt32LE(offset + 20);
		const nameLength = data.readUInt16LE(offset + 28);
		const extraLength = data.readUInt16LE(offset + 30);
		const commentLength = data.readUInt16LE(offset + 32);
		const localOffset = data.readUInt32LE(offset + 42);
		const name = data.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
		offset += 46 + nameLength + extraLength + commentLength;
		if (name.endsWith('/')) {
			continue;
		}
		// 本地头也有自己的 name/extra 长度，数据起点要按本地头算。
		const localNameLength = data.readUInt16LE(localOffset + 26);
		const localExtraLength = data.readUInt16LE(localOffset + 28);
		const dataStart = localOffset + 30 + localNameLength + localExtraLength;
		const raw = data.subarray(dataStart, dataStart + compressedSize);
		if (method === 0) {
			entries.set(name, Buffer.from(raw));
		} else if (method === 8) {
			entries.set(name, inflateRawSync(raw));
		} else {
			throw new Error(`unsupported zip compression method ${method} for ${name}`);
		}
	}
	return entries;
}

/** 从文件尾向前找 EOCD（0x06054b50）；注释最长 65535 字节。 */
function findEndOfCentralDirectory(data) {
	const min = Math.max(0, data.length - 65557);
	for (let i = data.length - 22; i >= min; i--) {
		if (data.readUInt32LE(i) === 0x06054b50) {
			return i;
		}
	}
	throw new Error('corrupt zip: end of central directory not found');
}

/**
 * 把语言包安装到 IDE 扩展目录。
 *
 * 目录名遵循 VS Code 的 `<publisher>.<name>-<version>`，已存在则跳过。
 * 安装完不在这里登记 `languagepacks.json`：那是 `dshLanguagePreference` 的职责，
 * 两边分开后可以单独测「装包」和「切语言」。
 * @param {{ name: string, version: string, bytes: Buffer }} pack
 * @param {string} extensionsDir
 * @returns {{ dir: string, manifest: any } | undefined}
 */
export function installLanguagePack(pack, extensionsDir) {
	const entries = readZipEntries(pack.bytes);
	const manifestEntry = entries.get('extension/package.json');
	if (manifestEntry === undefined) {
		return undefined;
	}
	const manifest = JSON.parse(manifestEntry.toString('utf8'));
	const target = join(extensionsDir, `ms-ceintl.${pack.name}-${pack.version}`);
	if (!existsSync(target)) {
		mkdirSync(target, { recursive: true });
		for (const [name, content] of entries) {
			if (!name.startsWith('extension/')) {
				continue;
			}
			const relative = name.slice('extension/'.length);
			if (relative === '') {
				continue;
			}
			const file = join(target, relative);
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, content);
		}
	}
	return { dir: target, manifest };
}

/** 已安装的语言包目录列表（只按目录名匹配，不读内容）。 */
export function installedLanguagePackDirs(extensionsDir) {
	if (!existsSync(extensionsDir)) {
		return [];
	}
	return readdirSync(extensionsDir).filter(name => name.toLowerCase().startsWith('ms-ceintl.vscode-language-pack-'));
}


/**
 * 把 DSH-IDE 自己的中文译文合并进已安装语言包的 `main.i18n.json`。
 *
 * 官方语言包只覆盖 VS Code 上游模块；DSH-IDE 新增的 151 条 key 不在其中，
 * 需要在装好之后补写进去。按模块合并，已有条目保留，不覆盖官方译文。
 * @param {string} packDir 语言包扩展目录
 * @param {{ version: string, contents: Record<string, Record<string, string>> }} patch
 * @returns {boolean} 是否写成功
 */
export function mergeI18nPatch(packDir, patch) {
	const file = join(packDir, 'translations', 'main.i18n.json');
	let current;
	try {
		current = JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return false;
	}
	if (current === null || typeof current !== 'object' || typeof current.contents !== 'object' || current.contents === null) {
		return false;
	}
	for (const [moduleId, entries] of Object.entries(patch.contents)) {
		const existing = current.contents[moduleId];
		current.contents[moduleId] = existing !== null && typeof existing === 'object'
			? { ...existing, ...entries }
			: { ...entries };
	}
	writeFileSync(file, JSON.stringify(current), 'utf8');
	return true;
}

/** Open VSX 的扩展下载地址模板；与 IDE 里配置的 gallery 同源。 */
/** 随插件分发的中文译文补丁；只有 zh-cn 需要，其它语言先交给官方语言包。 */
export function loadBundledI18nPatch(locale) {
	if (locale !== 'zh') {
		return undefined;
	}
	try {
		return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'dshI18n.zh-cn.json'), 'utf8'));
	} catch {
		return undefined;
	}
}

export const OPEN_VSX_PACK_URL = (name, version) =>
	`https://open-vsx.org/api/MS-CEINTL/${name}/${version}/file/MS-CEINTL.${name}-${version}.vsix`;

/** 每个语言包的固定版本：与 IDE 的 VS Code 基线（1.143.1）兼容的最近发布。 */
export const LANGUAGE_PACK_VERSION = '1.131.0';

/**
 * 确保某个 DSH 语言的 IDE 语言包已安装。
 *
 * 已安装就直接返回；没有则从 Open VSX 下载并安装。下载或安装失败时返回失败原因，
 * 不写半个包、也不假装语言已就绪。
 * @param {string | undefined} locale DSH 语言 id
 * @param {{ extensionsDir: string, fetchImpl?: typeof fetch, version?: string }} options
 * @returns {Promise<{ ok: true, dir: string, manifest: any } | { ok: false, reason: string } | { ok: true, skipped: true }>}
 */
export async function ensureLanguagePack(locale, options) {
	const name = languagePackForLocale(locale);
	if (name === undefined) {
		// `en` 或未知语言：不需要语言包。
		return { ok: true, skipped: true };
	}
	const extensionsDir = options.extensionsDir;
	if (!existsSync(extensionsDir)) {
		mkdirSync(extensionsDir, { recursive: true });
	}
	const patch = loadBundledI18nPatch(locale);
	const installed = installedLanguagePackDirs(extensionsDir).find(dir => dir.toLowerCase().startsWith(`ms-ceintl.${name}-`));
	if (installed !== undefined) {
		const dir = join(extensionsDir, installed);
		try {
			const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
			// 已装的语言包可能是旧版安装、还没有 DSH 自己的译文：补一次，幂等。
			if (patch !== undefined) {
				mergeI18nPatch(dir, patch);
			}
			return { ok: true, dir, manifest };
		} catch {
			// 坏目录：删掉重装，不把损坏的包当成已安装。
			rmSync(dir, { recursive: true, force: true });
		}
	}
	const version = options.version ?? LANGUAGE_PACK_VERSION;
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	if (typeof fetchImpl !== 'function') {
		return { ok: false, reason: 'no fetch implementation available to download the language pack' };
	}
	let response;
	try {
		response = await fetchImpl(OPEN_VSX_PACK_URL(name, version));
	} catch (error) {
		return { ok: false, reason: `language pack download failed: ${error instanceof Error ? error.message : String(error)}` };
	}
	if (!response.ok) {
		return { ok: false, reason: `language pack download failed: HTTP ${response.status}` };
	}
	const bytes = Buffer.from(await response.arrayBuffer());
	try {
		const installedPack = installLanguagePack({ name, version, bytes }, extensionsDir);
		if (installedPack === undefined) {
			return { ok: false, reason: 'downloaded language pack has no extension/package.json' };
		}
		if (patch !== undefined) {
			mergeI18nPatch(installedPack.dir, patch);
		}
		return { ok: true, dir: installedPack.dir, manifest: installedPack.manifest };
	} catch (error) {
		return { ok: false, reason: `language pack install failed: ${error instanceof Error ? error.message : String(error)}` };
	}
}
