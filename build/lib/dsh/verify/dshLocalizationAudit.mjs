#!/usr/bin/env node
/**
 * DSH 层本地化审计。
 *
 * 检查四件事，任何一条失败都以非零码退出：
 *   1. 每个 `localize`/`localize2` 的 source 文本必须是中文（本仓库无 i18n 层，source 即界面文字）。
 *   2. 占位符 `{0}`…`{n}` 的个数必须与实参个数吻合（错位会让用户看到字面量占位符）。
 *   3. 同一 key 不得对应两种不同文案（会让翻译互相覆盖）。
 *   4. 代码行里不得出现裸中文字符串字面量（必须先剔除 `localize(...)` 调用与注释）。
 *
 * 用法：node build/lib/dsh/verify/dshLocalizationAudit.mjs [--verbose]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const layerDir = join(repoRoot, 'src', 'vs', 'workbench', 'contrib', 'dsh', 'browser');
const verbose = process.argv.includes('--verbose');

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

const problems = [];
const keyText = new Map();
let calls = 0;

for (const name of readdirSync(layerDir).filter(entry => entry.endsWith('.ts'))) {
	const file = join(layerDir, name);
	const source = readFileSync(file, 'utf8');

	// 1 + 2 + 3：逐条检查调用。
	const callPattern = /localize2?\(\s*'([^']+)',\s*["']([^"']*)["']((?:\s*,\s*[^,)]+)*)/g;
	for (const match of source.matchAll(callPattern)) {
		calls++;
		const [, key, text, rest] = match;
		if (!/[\u4e00-\u9fa5]/.test(text)) {
			problems.push(`${name}: ${key} 的 source 不是中文：${text.slice(0, 40)}`);
		}
		const placeholders = [...text.matchAll(/\{(\d+)\}/g)].map(m => Number(m[1]));
		const needed = placeholders.length === 0 ? 0 : Math.max(...placeholders) + 1;
		const supplied = rest === undefined ? 0 : rest.split(',').filter(part => part.trim() !== '').length;
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
		.filter(line => !/new RawContextKey</.test(line));
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

console.log(`STATUS: PASS  [localization] ${calls} 次调用、${keyText.size} 个唯一 key 全部合规（中文 source、占位符与实参吻合、key 无冲突、无裸字符串）`);
