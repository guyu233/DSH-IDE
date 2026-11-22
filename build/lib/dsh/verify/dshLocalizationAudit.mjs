#!/usr/bin/env node
/**
 * DSH 层本地化审计。
 *
 * 检查五件事，任何一条失败都以非零码退出：
 *   1. 每个 `localize`/`localize2` 的 source 文本必须是**英文**，且与
 *      `i18n/dsh.nls.json` 登记的一致（本仓库无 vscode-loc 流水线，source 即出厂文案；
 *      只有英文 source 才能被官方语言包与 DSH 自带 zh-cn 补丁按 key 覆盖）。
 *   2. 每个 key 必须在 `i18n/dsh.nls.zh-cn.json` 里有中文译文。
 *   3. 占位符 `{0}`…`{n}` 的个数必须与实参个数吻合（错位会让用户看到字面量占位符）。
 *   4. 同一 key 不得对应两种不同文案（会让翻译互相覆盖）。
 *   5. 代码行里不得出现裸中文字符串字面量（必须先剔除 `localize(...)` 调用与注释）。
 *
 * 用法：node build/lib/dsh/verify/dshLocalizationAudit.mjs [--verbose]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const layerDir = join(repoRoot, 'src', 'vs', 'workbench', 'contrib', 'dsh', 'browser');
// DSH 的用户可见文案不只在 `contrib/dsh/browser`：听写接入点放在
// `contrib/chat/browser/speechToText/`（它要替换原生听写服务，必须在那一侧）。
// 只扫第一个目录会漏掉这里的 localize，等于「门禁说全合规、实际没检查」。
const extraDirs = [
	join(repoRoot, 'src', 'vs', 'workbench', 'contrib', 'chat', 'browser', 'speechToText'),
];
const verbose = process.argv.includes('--verbose');

/** 读取一份 i18n 词典；读不到就直接失败，不能当成「没有 key 需要检查」。 */
function loadDictionary(file) {
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(file, 'utf8'));
	} catch (error) {
		console.error(`STATUS: FAIL  [localization] 无法读取词典 ${file}: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		console.error(`STATUS: FAIL  [localization] 词典 ${file} 必须是 key→文案 的对象`);
		process.exit(1);
	}
	return new Map(Object.entries(parsed));
}

const i18nDir = join(layerDir, 'i18n');
const englishDictionary = loadDictionary(join(i18nDir, 'dsh.nls.json'));
const chineseDictionary = loadDictionary(join(i18nDir, 'dsh.nls.zh-cn.json'));

/** 返回调用括号内最后一个顶层逗号的下标；没有时返回 -1。 */
function lastTopLevelComma(source, open) {
	let depth = 0;
	let last = -1;
	let quote = '';
	for (let i = open; i < source.length; i++) {
		const ch = source[i];
		if (quote !== '') {
			if (ch === '\\') {
				i++;
			} else if (ch === quote) {
				quote = '';
			}
			continue;
		}
		if (ch === '"' || ch === "'" || ch === '`') {
			quote = ch;
			continue;
		}
		if (ch === '(' || ch === '[' || ch === '{') {
			depth++;
			continue;
		}
		if (ch === ')' || ch === ']' || ch === '}') {
			depth--;
			if (depth === 0) {
				break;
			}
			continue;
		}
		if (depth === 1 && ch === ',') {
			last = i;
		}
	}
	return last;
}

/**
 * 数一个调用括号内的**顶层实参**个数。
 *
 * `open` 指向 `(` 的下标；按括号深度切分，忽略字符串里的括号。
 * `localize(key, source)` 没有额外实参时返回 0。
 */
function countArguments(source, open) {
	if (open < 0) {
		return 0;
	}
	let depth = 0;
	let commas = 0;
	let hasContent = false;
	let quote = '';
	for (let i = open; i < source.length; i++) {
		const ch = source[i];
		if (quote !== '') {
			if (ch === '\\') {
				i++;
			} else if (ch === quote) {
				quote = '';
			}
			continue;
		}
		if (ch === '"' || ch === "'" || ch === '`') {
			quote = ch;
			hasContent = true;
			continue;
		}
		if (ch === '(' || ch === '[' || ch === '{') {
			depth++;
			if (depth > 1) {
				hasContent = true;
			}
			continue;
		}
		if (ch === ')' || ch === ']' || ch === '}') {
			depth--;
			if (depth === 0) {
				break;
			}
			continue;
		}
		if (depth === 1) {
			if (ch === ',') {
				commas++;
			} else if (!/\s/.test(ch)) {
				hasContent = true;
			}
		}
	}
	// 尾随逗号（ESLint/格式化器常见写法）不算一个空实参：看最后一个逗号之后
	// 到右括号之间是否只有空白，是则扣掉。
	if (commas > 0) {
		const lastComma = lastTopLevelComma(source, open);
		if (lastComma !== -1 && source.slice(lastComma + 1, source.indexOf(')', lastComma)).trim() === '') {
			commas--;
		}
	}
	return hasContent ? commas + 1 : 0;
}

/** 把 `localize(...)` 调用整段剔除，保留其余源码。支持跨行与嵌套括号。 */
function stripLocalizeCalls(source) {
	let out = '';
	let i = 0;
	while (i < source.length) {
		const start = source.indexOf('localize', i);
		if (start < 0) {
			out += source.slice(i);
			break;
		}
		out += source.slice(i, start);
		const open = source.indexOf('(', start);
		if (open < 0) {
			out += source.slice(start);
			break;
		}
		let depth = 0;
		let cursor = open;
		for (; cursor < source.length; cursor++) {
			if (source[cursor] === '(') {
				depth++;
			} else if (source[cursor] === ')') {
				depth--;
				if (depth === 0) {
					cursor++;
					break;
				}
			}
		}
		i = cursor;
	}
	return out;
}

/** 列举目录下所有 `.ts`（递归，跳过 test 目录与 .test.ts）。 */
function listSources(dir) {
	const out = [];
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		if (entry.name === 'test' || entry.name === 'node_modules') {
			continue;
		}
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...listSources(full));
		} else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) {
			out.push(full);
		}
	}
	return out;
}

/**
 * DSH 改写过的 `speechToText` 文件白名单。
 *
 * 该目录下还有多个 VS Code 上游文件（`micButtonMenuActions.ts` 等），它们的英文
 * source 是上游既定写法，不在本插件的本地化责任范围内——只检查 DSH 自己新增/改写的文件。
 */
const SPEECH_TO_TEXT_DSH_FILES = new Set(['dshSpeech.ts', 'dshChatSpeechToTextService.ts']);

const problems = [];
const keyText = new Map();
let calls = 0;

for (const file of [layerDir, ...extraDirs].flatMap(listSources)) {
	// `contrib/dsh/browser` 全部纳入；`speechToText` 只纳入 DSH 自己改写的文件。
	const inLayerDir = file.startsWith(layerDir);
	if (!inLayerDir && !SPEECH_TO_TEXT_DSH_FILES.has(file.split(/[\\/]/).pop())) {
		continue;
	}
	const source = readFileSync(file, 'utf8');
	// 报错信息里仍用文件名（原实现用 `name`），保留可读性。
	const name = file.slice(repoRoot.length + 1).replaceAll('\\', '/');

	// 1 + 2 + 3：逐条检查调用。
	//
	// 口径（CHK-262 起）：本仓库没有 vscode-loc 翻译流水线，`localize(key, source)` 的
	// source 就是出厂文案。要让 IDE 跟随 DSH 的界面语言，source 必须是**英文**
	// （官方语言包与 DSH 自带的 zh-cn 补丁才能按 key 覆盖），并且每个 key 必须在
	// `i18n/dsh.nls.json`（英）与 `i18n/dsh.nls.zh-cn.json`（中）里成对存在。
	// 此前要求 source 是中文，那是 CHK-262 之前的做法，会让英文/日文界面永远显示中文。
	const callPattern = /localize2?\(\s*'([^']+)',\s*["']([^"']*)["']/g;
	for (const match of source.matchAll(callPattern)) {
		calls++;
		const key = match[1];
		const text = match[2];
		const open = source.indexOf('(', match.index);
		// 前两个实参是 key 与 source，剩下的才是占位符实参。
		const supplied = Math.max(0, countArguments(source, open) - 2);
		if (/[\u4e00-\u9fa5]/.test(text)) {
			problems.push(`${name}: ${key} 的 source 仍是中文，语言包无法覆盖：${text.slice(0, 40)}`);
		}
		if (!englishDictionary.has(key)) {
			problems.push(`${name}: ${key} 不在 i18n/dsh.nls.json 里，英文 source 未登记`);
		} else if (englishDictionary.get(key) !== text) {
			problems.push(`${name}: ${key} 的 source 与词典不一致（代码「${text.slice(0, 20)}」vs 词典「${String(englishDictionary.get(key)).slice(0, 20)}」）`);
		}
		if (!chineseDictionary.has(key)) {
			problems.push(`${name}: ${key} 没有中文译文（i18n/dsh.nls.zh-cn.json）`);
		}
		const placeholders = [...text.matchAll(/\{(\d+)\}/g)].map(m => Number(m[1]));
		const needed = placeholders.length === 0 ? 0 : Math.max(...placeholders) + 1;
		if (needed !== supplied) {
			problems.push(`${name}: ${key} 需要 ${needed} 个实参，实际给了 ${supplied} 个`);
		}
		const previous = keyText.get(key);
		if (previous !== undefined && previous !== text) {
			problems.push(`${name}: key ${key} 对应两种文案（「${previous.slice(0, 20)}」vs「${text.slice(0, 20)}」）`);
		}
		keyText.set(key, text);
	}

	// 4：剔除调用与注释后，代码行里不应再有裸中文字符串。
	const codeOnly = stripLocalizeCalls(source)
		.split(/\r?\n/)
		.filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
		// 日志与内部元数据不是用户可见文字，不要求本地化：
		// `logService.*` 输出到输出面板；`RawContextKey` 的 description 只用于 API 元数据。
		.filter(line => !/logService\.(trace|debug|info|warn|error)\s*\(/.test(line))
		.filter(line => !/new RawContextKey</.test(line))
		// `DshNativeAdaptation.reason` / `reuse` 是适配层的开发期说明（谁复用、为什么），
		// 不进入任何 DOM，也不是用户可见文字；和日志一样不属于本地化责任范围。
		.filter(line => !/\breason:\s*['"`]/.test(line));
	for (const line of codeOnly) {
		const hit = /["'`][^"'`]*[\u4e00-\u9fa5][^"'`]*["'`]/.exec(line);
		if (hit !== null) {
			problems.push(`${name}: 裸中文字符串 ${hit[0].slice(0, 40)}`);
		}
	}
}

if (verbose) {
	console.log(`扫描目录 : ${layerDir}`);
	console.log(`localize : ${calls} 次调用、${keyText.size} 个唯一 key`);
}

if (problems.length > 0) {
	for (const problem of problems) {
		console.error(`  ✗ ${problem}`);
	}
	console.error(`STATUS: FAIL  [localization] ${problems.length} 处问题`);
	process.exit(1);
}

console.log(`STATUS: PASS  [localization] ${calls} 次调用、${keyText.size} 个唯一 key 全部合规（英文 source 与词典一致、中文译文齐备、占位符与实参吻合、key 无冲突、无裸字符串）`);
