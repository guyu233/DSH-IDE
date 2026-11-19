/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 去掉扩展产物里的跨目录重复：同一份 chunk/资源被打包到多个 webview 输出目录时，
 * 只保留第一份，其余目录的入口文件改写为相对引用。
 *
 * 背景：`mermaid-markdown-features` 的 `esbuild.webview.mts` 为 Markdown 预览与 Notebook
 * 各打一次包，两个输出目录 200 个文件里只有 `index.js` 不同，其余 32.68 MiB 字节完全相同。
 * 上游构建脚本不改（避免与 VS Code 上游分叉），去重放在打包阶段完成。
 */

export interface IDedupeGroup {
	/** 保留内容的目录（相对 extensions 根）。 */
	readonly keep: string;
	/** 内容被移除、入口被改写的目录（相对 extensions 根）。 */
	readonly drop: string[];
}

/** 需要去重的扩展与目录组。 */
export const DEDUPE_GROUPS: readonly IDedupeGroup[] = [
	{
		keep: path.join('mermaid-markdown-features', 'markdown-preview-out'),
		drop: [path.join('mermaid-markdown-features', 'notebook-out')],
	},
];

function sha256(file: string): string {
	return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * 对 `extensionsRoot` 下的一组输出目录去重。
 * @returns 删除的文件数与释放的字节数
 */
export function dedupeExtensionOutputs(extensionsRoot: string, groups: readonly IDedupeGroup[] = DEDUPE_GROUPS): { removed: number; freedBytes: number } {
	let removed = 0;
	let freedBytes = 0;

	for (const group of groups) {
		const keepDir = path.join(extensionsRoot, group.keep);
		if (!fs.existsSync(keepDir)) {
			continue;
		}
		const keepFiles = new Map<string, string>();
		for (const name of fs.readdirSync(keepDir)) {
			const full = path.join(keepDir, name);
			if (fs.statSync(full).isFile()) {
				keepFiles.set(name, sha256(full));
			}
		}

		for (const dropRel of group.drop) {
			const dropDir = path.join(extensionsRoot, dropRel);
			if (!fs.existsSync(dropDir)) {
				continue;
			}
			const relativeToKeep = path.relative(dropDir, keepDir).replace(/\\/g, '/');
			// 记录本目录里确实被删掉的文件名：只有它们需要改写引用。
			const deleted = new Set<string>();
			for (const name of fs.readdirSync(dropDir)) {
				const full = path.join(dropDir, name);
				if (!fs.statSync(full).isFile()) {
					continue;
				}
				const keptHash = keepFiles.get(name);
				if (keptHash === undefined || keptHash !== sha256(full)) {
					continue;
				}
				// 只删除内容确实相同的文件；入口 `index.js` 内容不同，天然被排除。
				const size = fs.statSync(full).size;
				fs.rmSync(full);
				deleted.add(name);
				removed++;
				freedBytes += size;
			}

			// 改写留下的入口文件：把指向已删除同目录文件的相对引用改到 keep 目录。
			for (const name of fs.readdirSync(dropDir)) {
				if (!name.endsWith('.js')) {
					continue;
				}
				const full = path.join(dropDir, name);
				const source = fs.readFileSync(full, 'utf8');
				const rewritten = source.replace(/(["'])\.\/([^"'/]+\.js)\1/g, (match, quote, target) => {
					// 只有「本目录的同名文件已被删除」才需要指向 keep；否则保留原引用。
					return deleted.has(target) ? `${quote}${relativeToKeep}/${target}${quote}` : match;
				});
				if (rewritten !== source) {
					fs.writeFileSync(full, rewritten);
				}
			}
		}
	}

	return { removed, freedBytes };
}
