/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 把原生 `@` 工作区引用转成 DSH 能识别的 mention 文本。
//
// DSH 的 `@` 不是附件：它把 `@path`（含空格时 `@"path"`）作为提示文本的一部分，
// 由 Host 侧的引用规则解析。这里只做「原生 file/directory 条目 → mention 文本」的
// 单向投影，不复制 DSH 的候选、菜单或 chip 状态。
//
// 无法安全表达的路径（控制字符、双引号）不猜，原样留给上层的「带不走的附件」提示。

import { URI } from '../../../../../base/common/uri.js';

/** 原生条目里本文件真正用到的字段。 */
export interface DshReferenceEntry {
	readonly kind: string;
	readonly name?: string;
	readonly value?: unknown;
	readonly enabled?: boolean;
}

/** 一次投影的结果：可拼进提示的 mention 文本，以及仍需按「带不走」处理的条目。 */
export interface DshReferenceProjection<T extends DshReferenceEntry> {
	readonly mentions: readonly string[];
	readonly remaining: readonly T[];
}

/**
 * 一条工作区路径是否在这些根目录之内；在则返回相对路径。
 * @param path 条目指向的本地绝对路径
 * @param roots 当前工作区根目录
 */
export function dshRelativeReferencePath(path: string, roots: readonly string[]): string {
	const normalized = path.replaceAll('\\', '/');
	// Windows 盘符大小写不固定（`D:` 与 `d:` 指向同一块盘）：比较用不区分大小写，
	// 但返回的相对路径必须按原字符串切，保留用户路径的大小写。
	const folded = normalized.toLowerCase();
	let best: { readonly base: string; readonly folded: string } | undefined;
	for (const root of roots) {
		const base = root.replaceAll('\\', '/').replace(/\/+$/, '');
		if (base === '') {
			continue;
		}
		const baseFolded = base.toLowerCase();
		if (folded === baseFolded) {
			return '';
		}
		if (folded.startsWith(`${baseFolded}/`) && (best === undefined || base.length > best.base.length)) {
			best = { base, folded: baseFolded };
		}
	}
	return best === undefined ? normalized : normalized.slice(best.base.length + 1);
}

/**
 * 按 DSH 的 `@file` 语法格式化一条 mention。
 *
 * 与官方 `formatFileMention` 同规则：含空白用 `@"…"`，目录保留结尾斜杠。
 * @param path 相对或绝对路径
 * @param directory 是否是目录
 */
export function formatDshReferenceMention(path: string, directory: boolean): string | undefined {
	if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) {
		return undefined;
	}
	const withSlash = directory && !path.endsWith('/') ? `${path}/` : path;
	if (!/\s/u.test(withSlash)) {
		return `@${withSlash}`;
	}
	return directory ? `@"${withSlash}` : `@"${withSlash}"`;
}

/**
 * 把原生 `@` 条目投影成 mention 文本。
 *
 * 只处理 `file` / `directory`：其它 kind（粘贴文本、工具、隐式上下文）不属于引用，
 * 交给调用方原有的「带不走」判定。
 * @param entries 输入框里的附件条目
 * @param roots 当前工作区根目录（用于把绝对路径压成相对路径）
 */
export function projectDshReferences<T extends DshReferenceEntry>(entries: readonly T[], roots: readonly string[]): DshReferenceProjection<T> {
	const mentions: string[] = [];
	const remaining: T[] = [];
	for (const entry of entries) {
		if (entry.kind !== 'file' && entry.kind !== 'directory') {
			remaining.push(entry);
			continue;
		}
		const uri = uriOf(entry.value);
		if (uri === undefined || uri.scheme !== 'file') {
			remaining.push(entry);
			continue;
		}
		const mention = formatDshReferenceMention(dshRelativeReferencePath(uri.fsPath, roots), entry.kind === 'directory');
		if (mention === undefined) {
			remaining.push(entry);
			continue;
		}
		mentions.push(mention);
	}
	return { mentions, remaining };
}

function uriOf(value: unknown): URI | undefined {
	if (URI.isUri(value)) {
		return value;
	}
	// `asFileVariableEntry` 带行范围时 value 是 `{ uri, range }`；只认这个已知形状。
	if (value !== null && typeof value === 'object' && 'uri' in value) {
		const uri = (value as { readonly uri?: unknown }).uri;
		if (URI.isUri(uri)) {
			return uri;
		}
	}
	return undefined;
}
