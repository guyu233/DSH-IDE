/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 生成 `dshIconDataUris.ts`：把官方 DSH 产品图标（`ICON_ARTWORK`）的 SVG 源码
// 转成内联 data URI，供 `iconsStyleSheet` 的 DSH mask 规则使用。
//
// 为什么必须内联 data URI：CSS 里的 `url(...)` 指向文档/资源文件时在打包后会失效
// （手册 §9.5 阶段 2-D 第 3 条）；内联后无外部依赖，且 `mask` 会随 `currentColor` 变色。
//
// 资源来源（只读，不手绘）：`E:/deepseek-harness/packages/client/ui-primitives/src/icons/artwork.ts`
// 的 `ICON_ARTWORK`，regular stroke = 1（`ICON_REGULAR_STROKE`）。
//
// 用法：node build/lib/dsh/genDshIconDataUris.mjs [--check]
//   --check  只比对输出是否与已生成文件一致（不写文件），供门禁使用。

import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const sourcePath = 'E:/deepseek-harness/packages/client/ui-primitives/src/icons/artwork.ts';
const outputPath = path.join(repoRoot, 'src/vs/workbench/contrib/dsh/browser/dshIconDataUris.ts');
const strokeWidth = 1;

const header = `/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 本文件由 \`build/lib/dsh/genDshIconDataUris.mjs\` 生成，请勿手改。
//
// 资源来源：DeepSeek Harness 官方 \`packages/client/ui-primitives/src/icons/artwork.ts\`
// 的 \`ICON_ARTWORK\`（MIT License, Copyright (c) 2026 DeepSeek）；按 regular stroke=1
// 取每个 glyph 的 SVG，URL-encode 后内联为 data URI。生成脚本只做编码，不改图形。

/** 一个 DSH glyph 的内联 SVG（data URI，供 CSS mask 使用）。 */
export const DSH_ICON_DATA_URIS: Readonly<Record<string, string>> = {
`;

/** 读源文件并抽取每个 glyph 的 svg(strokeWidth) 模板求值结果。 */
function readArtwork() {
	const text = fs.readFileSync(sourcePath, 'utf8');
	const entries = [];
	// 源文件里 glyph 用对象字面量声明：`'name': { size, [aspect,] svg: ... },`。
	// 绝大多数一行一个；个别 glyph 按 strokeWidth 分支跨多行（如 archive-off-outline），
	// 因此按「对象起止」切块，而不是按行。花括号只出现在模板字符串之外时才计数。
	const marker = /^\s*'([a-z0-9-]+)':\s*\{/gm;
	let match;
	const starts = [];
	while ((match = marker.exec(text)) !== null) {
		starts.push({ name: match[1], index: match.index });
	}
	for (let i = 0; i < starts.length; i++) {
		const start = starts[i];
		const end = i + 1 < starts.length ? starts[i + 1].index : text.length;
		const block = text.slice(start.index, end);
		const svgTemplate = evaluateSvgTemplate(block, start.name);
		entries.push({ name: start.name, svg: svgTemplate.replaceAll('${strokeWidth}', String(strokeWidth)) });
	}
	entries.sort((a, b) => a.name.localeCompare(b.name));
	return entries;
}

/** 在一个 glyph 块里求 `svg` 的值：支持箭头模板串、单引号串、以及 strokeWidth 三元分支。 */
function evaluateSvgTemplate(block, name) {
	const branch = /svg:\s*strokeWidth\s*=>\s*strokeWidth\s*===\s*ICON_MEDIUM_STROKE\s*\?\s*`([\s\S]*?)`\s*:\s*`([\s\S]*?)`/.exec(block);
	if (branch !== null) {
		return branch[2];
	}
	const arrow = /svg:\s*strokeWidth\s*=>\s*`([\s\S]*?)`/.exec(block);
	if (arrow !== null) {
		return arrow[1];
	}
	const plain = /svg:\s*\(\s*\)\s*=>\s*'([\s\S]*?)'/.exec(block);
	if (plain !== null) {
		return plain[1];
	}
	throw new Error(`glyph ${name} has an unsupported svg declaration; update the generator`);
}

/** SVG → 可直接放进 CSS `url()` / `mask` 的 data URI。 */
function toDataUri(svg) {
	// 全量 URL 编码：SVG 里的双引号、`#`、尖括号都必须编码，否则会破坏 CSS 字符串
	// 或把 `#` 当成 fragment。不做任何「解码回可读字符」的优化——那会把引号带回字符串里。
	// `encodeURIComponent` 不会编码单引号，而 CSS 里用单引号包 url，这里补上。
	return `data:image/svg+xml,${encodeURIComponent(svg).replaceAll('\'', '%27')}`;
}

function generate() {
	if (!fs.existsSync(sourcePath)) {
		throw new Error(`official artwork source not found: ${sourcePath}`);
	}
	const entries = readArtwork();
	if (entries.length < 100) {
		throw new Error(`expected at least 100 glyphs, got ${entries.length}`);
	}
	const lines = entries.map(({ name, svg }) => `\t'${name}': '${toDataUri(svg)}',`);
	return `${header}${lines.join('\n')}\n};\n`;
}

const check = process.argv.includes('--check');
const next = generate();
if (check) {
	const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
	if (current !== next) {
		console.error(`DRIFT  ${path.relative(repoRoot, outputPath)} is stale; run: node build/lib/dsh/genDshIconDataUris.mjs`);
		process.exitCode = 1;
	} else {
		console.log(`PASS  ${path.relative(repoRoot, outputPath)} matches the official artwork (${readArtwork().length} glyphs, stroke ${strokeWidth})`);
	}
} else {
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, next, 'utf8');
	console.log(`WROTE ${path.relative(repoRoot, outputPath)} (${readArtwork().length} glyphs)`);
}
