/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH-IDE 的中文译文补丁。
//
// 背景：本仓库没有接 vscode-loc 的翻译流水线，`localize(key, "source")` 的 source 就是
// 出厂文案。要让 IDE 跟随 DSH 的界面语言，source 必须是英文（见 `dsh.nls.json`），
// 再由本文件按模块名 + key 覆盖成中文。
//
// 产物形状与官方语言包的 `translations/main.i18n.json` 一致：
//   { "version": "...", "contents": { "<moduleId>": { "<key>": "<text>" } } }
// 官方 `NativeLanguagePackService` 生成 `nls.messages.json` 时按模块取译文，
// 找不到 key 就回落到英文 source，所以只覆盖我们自己的 151 条，不碰其它模块。

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 把词典 JSON 组装成官方 i18n 译文结构。
 * @param {Record<string, readonly string[]>} moduleKeys 模块 id → 该模块的 key 列表
 * @param {Record<string, string>} translations key → 中文
 * @param {string} version 语言包版本（写进 i18n 文件的 `version`）
 */
export function buildDshI18n(moduleKeys, translations, version) {
	const contents = {};
	for (const [moduleId, keys] of Object.entries(moduleKeys)) {
		const bucket = {};
		for (const key of keys) {
			const text = translations[key];
			if (typeof text === 'string' && text !== '') {
				bucket[key] = text;
			}
		}
		if (Object.keys(bucket).length > 0) {
			contents[moduleId] = bucket;
		}
	}
	return { version, contents };
}

/**
 * 校验两份词典的 key 完全一致、占位符一一对应。
 *
 * 占位符错位会让界面显示 `{0}` 字面量或吞掉参数，比缺一条译文更糟，所以要在构建期拦住。
 * @param {Record<string, string>} english key → 英文 source
 * @param {Record<string, string>} chinese key → 中文
 * @returns {string[]} 问题列表；空数组表示通过
 */
export function checkDshDictionaries(english, chinese) {
	const problems = [];
	const enKeys = Object.keys(english).sort();
	const zhKeys = Object.keys(chinese).sort();
	for (const key of enKeys) {
		if (!(key in chinese)) {
			problems.push(`missing Chinese translation: ${key}`);
			continue;
		}
		const enSlots = placeholders(english[key]);
		const zhSlots = placeholders(chinese[key]);
		if (enSlots.join(',') !== zhSlots.join(',')) {
			problems.push(`placeholder mismatch for ${key}: en=[${enSlots}] zh=[${zhSlots}]`);
		}
	}
	for (const key of zhKeys) {
		if (!(key in english)) {
			problems.push(`translation without an English source: ${key}`);
		}
	}
	return problems;
}

/** 提取 `{0}` / `{name}` 形式的占位符，按出现顺序。 */
function placeholders(text) {
	return [...String(text).matchAll(/\{[A-Za-z0-9_]+\}/g)].map(match => match[0]);
}

/**
 * 读取源词典并写出中文 i18n 文件。
 * @param {string} i18nDir 放 `dsh.nls.json` 的目录
 * @param {string} outFile 目标 `main.i18n.json`
 * @param {Record<string, readonly string[]>} moduleKeys
 * @param {string} version
 */
export function writeDshI18n(i18nDir, outFile, moduleKeys, version) {
	const english = JSON.parse(readFileSync(join(i18nDir, 'dsh.nls.json'), 'utf8'));
	const chinese = JSON.parse(readFileSync(join(i18nDir, 'dsh.nls.zh-cn.json'), 'utf8'));
	const problems = checkDshDictionaries(english, chinese);
	if (problems.length > 0) {
		throw new Error(`DSH dictionaries are inconsistent:\n  ${problems.join('\n  ')}`);
	}
	const payload = buildDshI18n(moduleKeys, chinese, version);
	writeFileSync(outFile, `${JSON.stringify(payload, null, '\t')}\n`, 'utf8');
	return payload;
}

/** 模块清单：key 必须是模块里真实用到的，构建脚本据此分组。 */
export const DSH_I18N_MODULES = JSON.parse(
	readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'dsh.nls.modules.json'), 'utf8'),
);
