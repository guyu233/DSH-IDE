/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 工具调用的「实时细节」提取（官方 `conversation-nodes/README.md`「Live activity and detail」）。
//
// 官方给了一份**跨所有工具共用的 21 字段优先级表**，不是按类别定制：
//   title, description, objective, task, task_name, name, question, questions, prompt, message,
//   command, cmd, queries, query, pattern, url, uri, file_path, path, target, action, status
// 并规定：
//   - 「The first field whose supported value remains nonempty after whitespace normalization wins;
//      unsupported values are skipped.」
//   - 「All live detail collapses whitespace, trims its ends, and is limited to 160 grapheme clusters,
//      including a final `…` when truncated.」
//   - 字符串可以仍在流式；数组只有**完整**且全是字符串时才用，逗号连接；
//     唯一的例外是 `questions`：取对象数组里第一个非空的 `question`。
//
// 单独成文件的原因：这是一张纯数据规则，不依赖 DOM 也不依赖分组；放在 `dshProcessGroup.ts` 里
// 会让「字段优先级」淹没在分组逻辑中，也不好单测。

/**
 * 官方的 detail 字段优先级（自上而下，第一个非空的胜出）。
 *
 * 顺序**不可调换**：官方用例明确说明 `description` 可以盖过 shell 的 `command`、
 * `title` 可以盖过文件路径，所以这两项必须排在前面。
 */
export const DSH_LIVE_DETAIL_FIELDS = [
	'title', 'description', 'objective', 'task', 'task_name', 'name', 'question', 'questions',
	'prompt', 'message', 'command', 'cmd', 'queries', 'query', 'pattern', 'url', 'uri',
	'file_path', 'path', 'target', 'action', 'status',
] as const;

/** 官方上限：160 个 grapheme cluster（含结尾的 `…`）。 */
export const DSH_LIVE_DETAIL_MAX_GRAPHEMES = 160;

/**
 * 按官方规则把空白压成单空格并去掉两端。
 *
 * 为什么要压：参数里常有换行与缩进（补丁、命令），直接显示会把折叠行撑成多行。
 */
export function normalizeDshDetailText(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

/**
 * 截断到 `max` 个 grapheme cluster（含结尾 `…`）。
 *
 * 用 `Intl.Segmenter` 而不是 `slice`：`slice` 按 UTF-16 code unit 切，
 * 会把代理对（emoji）与组合字符（带音标的拉丁文、部分 CJK 变体）切坏。
 * 环境不支持 `Intl.Segmenter` 时退回按 code point 切（`Array.from`），
 * 比按 code unit 安全，但不处理组合字符——这是明确的降级，不是假装正确。
 */
export function truncateDshDetailText(value: string, max: number = DSH_LIVE_DETAIL_MAX_GRAPHEMES): string {
	if (max <= 0) {
		return '';
	}
	// 不 import `safeIntl`：它所在的 `base/common/date.ts` 含 `const enum`，
	// 而本仓的测试运行器用 `--experimental-strip-types`，无法加载含 enum 的模块。
	// 这里在运行时探测 `Intl.Segmenter`；缺它就退回按 code point 切（`Array.from`），
	// 比按 UTF-16 code unit 安全（不会切坏代理对），只是不处理组合字符。
	const segmenter = createGraphemeSegmenter();
	const units = segmenter === undefined
		? Array.from(value)
		: [...segmenter.segment(value)].map(part => part.segment);
	if (units.length <= max) {
		return value;
	}
	// 截断后保留 `max - 1` 个簇 + 一个 `…`，总长不超过 max。
	return units.slice(0, max - 1).join('') + '\u2026';
}

/**
 * 从一次工具调用的参数里取「实时细节」。
 *
 * @param args 工具参数（可能是流式中不完整的对象；不是对象时返回 undefined）
 * @returns 归一化并截断后的细节；没有任何可用字段时返回 undefined
 */
export function dshLiveDetailOf(args: unknown): string | undefined {
	if (typeof args !== 'object' || args === null || Array.isArray(args)) {
		return undefined;
	}
	const record = args as Readonly<Record<string, unknown>>;
	for (const field of DSH_LIVE_DETAIL_FIELDS) {
		const candidate = record[field];
		const text = field === 'questions' ? firstQuestionText(candidate) : fieldText(candidate);
		if (text !== undefined) {
			return truncateDshDetailText(text);
		}
	}
	return undefined;
}

/** 普通字段：字符串去空白后非空才可用；字符串数组要求**全部**是字符串。 */
function fieldText(value: unknown): string | undefined {
	if (typeof value === 'string') {
		const text = normalizeDshDetailText(value);
		return text === '' ? undefined : text;
	}
	if (Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string')) {
		const text = normalizeDshDetailText((value as readonly string[]).join(', '));
		return text === '' ? undefined : text;
	}
	return undefined;
}

/**
 * `questions` 的特殊规则：取对象数组里**第一个非空的 `question`**，忽略 header 与后续题。
 *
 * 官方用例：`{"questions":[{"header":"Scope","question":"Which package?"},{"question":"Which mode?"}]}`
 * → `Which package?`。不做递归提取（官方的 `queries` 用例明确说 object-array queries 不递归）。
 */
function firstQuestionText(value: unknown): string | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	for (const item of value) {
		if (typeof item !== 'object' || item === null) {
			continue;
		}
		const question = normalizeDshDetailText(String((item as { readonly question?: unknown }).question ?? ''));
		if (question !== '') {
			return question;
		}
	}
	return undefined;
}

/** 运行时探测 `Intl.Segmenter`；不支持时返回 undefined（调用方退回按 code point 切）。 */
function createGraphemeSegmenter(): { segment(input: string): Iterable<{ readonly segment: string }> } | undefined {
	const intl = (globalThis as { readonly Intl?: unknown }).Intl as
		| { readonly Segmenter?: new (locales?: string, options?: { granularity?: string }) => { segment(input: string): Iterable<{ readonly segment: string }> } }
		| undefined;
	return intl?.Segmenter === undefined ? undefined : new intl.Segmenter(undefined, { granularity: 'grapheme' });
}
