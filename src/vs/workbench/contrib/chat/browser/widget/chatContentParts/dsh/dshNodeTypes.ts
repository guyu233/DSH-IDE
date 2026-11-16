/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 节点渲染层的本地结构守卫与窄类型。
//
// 纪律（对应总原则 2/3/4）：
// - **不** import `dshChatModel.ts` / `dshChatSession.ts` 的任何类型，渲染层不依赖 dsh contrib；
// - 不信任任何字段：全部用 as* 安全读取，缺字段返回 undefined，由视图决定如何呈现"缺失"；
// - 绝不补默认值、绝不伪造 0 / 空字符串 / 默认文案。

/** 渲染层认识的节点种类（与解码层 hint 一致）。 */
export type DshViewKind =
	| 'user'
	| 'steering'
	| 'context'
	| 'assistant'
	| 'tool-call'
	| 'tool-result'
	| 'command'
	| 'compaction'
	| 'model-retry'
	| 'turn-error'
	| 'turn-max-tokens'
	| 'inherited-history'
	| 'subagent-catalog'
	| 'subagent-notice'
	| 'unknown';

/** 所有子视图的统一输入。 */
export interface DshNodeViewInput {
	/** 源载荷 canonical JSON（校验真值）；「原始载荷」详情显示这个。 */
	readonly encoded: string;
	/** `encoded` 解析结果（事件信封 `{seq,time,type,data}`）。 */
	readonly encodedParsed: unknown;
	/** `projectionEncoded` 解析结果（渲染真值）；解码失败时退化为 encodedParsed。 */
	readonly parsed: unknown;
	/** `projectionEncoded` 是否可用；false 时视图必须降级而不是猜造。 */
	readonly projectionAvailable: boolean;
	readonly id: string;
	readonly kind: DshViewKind;
	/**
	 * 可选的附件字节读取入口（官方 `readAttachment` 契约）。
	 *
	 * 只用于「载荷只有 attachmentId、没有内联数据」时的只读解析；
	 * 不读会话状态、不读 model。未注入时视图必须显示原始 attachment JSON。
	 */
	readonly readAttachment?: (attachment: unknown) => Promise<{ mediaType: string; data: string } | undefined>;
}

/** 视图统一接口。 */
export interface IDshNodeView {
	readonly domNode: HTMLElement;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

/** 读取字符串并保留"空串"与"缺失"的区别：空串是真实值，缺失才是 undefined。 */
export function asStringOrNull(value: unknown): string | null | undefined {
	if (value === null) {
		return null;
	}
	return typeof value === 'string' ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

export function asArray(value: unknown): readonly unknown[] | undefined {
	return Array.isArray(value) ? value : undefined;
}

/** 按 key 读取子记录；非记录返回 undefined（不造空对象）。 */
export function asRecordAt(value: unknown, key: string): Record<string, unknown> | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const child = value[key];
	return isRecord(child) ? child : undefined;
}

/** 读取 `data` 层：DSH 事件信封的内容都在 data 里。 */
export function dataOf(node: unknown): Record<string, unknown> | undefined {
	return asRecordAt(node, 'data');
}

/**
 * 呈现"缺失"的统一形态：不伪造值，显式标出字段缺席。
 * 返回 `undefined` 表示该字段真实存在（调用方自行渲染），返回字符串表示应显示的缺失标记。
 */
export function missingLabel(field: string): string {
	return `${field}: (absent)`;
}

/**
 * 格式化任意 JSON 值为可读文本；null / undefined 各自保留真实语义。
 * 这是"不伪造"的最后一环：null 显示 null，而不是空字符串或 0。
 */
export function jsonText(value: unknown): string {
	if (value === null) {
		return 'null';
	}
	if (value === undefined) {
		return 'undefined';
	}
	if (typeof value === 'string') {
		return value;
	}
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}
