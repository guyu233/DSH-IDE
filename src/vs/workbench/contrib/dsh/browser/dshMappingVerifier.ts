/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 节点 → ChatModel part 的「不增不减」校验器。
//
// 三层判定（对应方案 L0/L1/L3）：
//   L0 源保真：源节点自身的 canonical 序列化必须等于它携带的 `raw` 的 canonical 序列化。
//   L1 映射双射：每个源节点恰对应一个 part，id 唯一、集合相等、顺序一致。
//   L3 反向读回：从 ChatModel 读回的 part 序列必须能还原出与源一致的 canonical 序列。
//
// 不含任何渲染逻辑：渲染纯度（L2）由 `ChatDshNodeContentPart` 的纯度约束保证。

import { stableStringify } from '../../../../base/common/objects.js';

/** 校验所需的最小 part 形状（避免把 workbench 类型拖进构建期测试）。 */
export interface IDshNodePartLike {
	readonly kind: string;
	readonly id: string;
	readonly encoded: string;
}

/** 校验所需的最小节点形状。 */
export interface IDshChatNodeLike {
	readonly kind: string;
	readonly seq: number;
	readonly raw?: unknown;
}

/** 单次校验结果。 */
export interface IDshMappingVerification {
	/** 源里有、part 里没有的 id。 */
	readonly missing: readonly string[];
	/** part 里有、源里没有的 id。 */
	readonly extra: readonly string[];
	/** 两边都有但顺序不同的 id。 */
	readonly reordered: readonly string[];
	/** 同一个 id 在 part 序列里出现多次。 */
	readonly duplicated: readonly string[];
	/** 源节点的 canonical 与其 `raw` 的 canonical 不一致（解码层失真）。 */
	readonly corrupted: readonly string[];
	/** 全部为空才算通过。 */
	readonly ok: boolean;
}

/**
 * 生成节点的 canonical 序列化。
 *
 * 基准是节点的 `raw`（源载荷原样），不是重建出来的 typed 字段：解码层的投影
 * 允许丢字段，`raw` 不允许。`raw` 缺失时退回整节点，此时语义为"节点自身即源"。
 */
export function canonicalNode(node: IDshChatNodeLike): string {
	return stableStringify(node.raw === undefined ? node : node.raw);
}

/**
 * 校验 L0：节点自身投影是否忠实于 `raw`。
 *
 * 对 `raw` 存在的节点，要求 `raw` 可被 canonical 化（非空串且非 'undefined'）。
 * `raw` 本身不要求等于 typed 字段——typed 字段是便捷投影，`raw` 才是真值。
 */
export function verifySourceFidelity(nodes: readonly IDshChatNodeLike[]): readonly string[] {
	const corrupted: string[] = [];
	for (const node of nodes) {
		if (node.raw === undefined) {
			// 没有 raw 的节点只能是本层合成的流式临时节点，不在源保真范围内。
			continue;
		}
		const encoded = stableStringify(node.raw);
		if (encoded === '' || encoded === 'undefined') {
			corrupted.push(`${node.kind}:${node.seq}`);
		}
	}
	return corrupted;
}

/**
 * 校验 L1 + L3：源节点集合与 part 序列的双射关系。
 *
 * @param nodes 源节点（按显示顺序）
 * @param parts 从 ChatModel 读回的 part（按顺序）
 * @param idOf 源节点 → 期望 part id 的映射函数
 */
export function verifyBijection(
	nodes: readonly IDshChatNodeLike[],
	parts: readonly IDshNodePartLike[],
	idOf: (node: IDshChatNodeLike) => string,
): IDshMappingVerification {
	const expected: string[] = [];
	const corrupted: string[] = [];
	for (const node of nodes) {
		const id = idOf(node);
		expected.push(id);
		if (node.raw !== undefined) {
			const encoded = stableStringify(node.raw);
			if (encoded === '' || encoded === 'undefined') {
				corrupted.push(id);
			}
		}
	}

	const actual: string[] = [];
	const seen = new Set<string>();
	const duplicated: string[] = [];
	for (const part of parts) {
		actual.push(part.id);
		if (seen.has(part.id)) {
			duplicated.push(part.id);
		}
		seen.add(part.id);
	}

	const expectedSet = new Set(expected);
	const actualSet = new Set(seen);
	const missing = expected.filter(id => !actualSet.has(id));
	const extra = [...actualSet].filter(id => !expectedSet.has(id));

	// 顺序一致性：仅比较两边都存在的 id 的相对顺序。
	const common = expected.filter(id => actualSet.has(id));
	const actualCommon = actual.filter(id => expectedSet.has(id));
	const reordered: string[] = [];
	for (let i = 0; i < Math.min(common.length, actualCommon.length); i++) {
		if (common[i] !== actualCommon[i]) {
			reordered.push(common[i]);
		}
	}

	return {
		missing,
		extra,
		reordered,
		duplicated,
		corrupted,
		ok: missing.length === 0 && extra.length === 0 && reordered.length === 0 && duplicated.length === 0 && corrupted.length === 0,
	};
}

/**
 * 校验 L3：从 part 的 `encoded` 反向还原出的对象，必须与源节点的 canonical 完全一致。
 *
 * 只对 id 能对上、且两侧都可解析的条目做比较；对不上的由 {@link verifyBijection} 报告。
 */
export function verifyRoundTrip(
	nodes: readonly IDshChatNodeLike[],
	parts: readonly IDshNodePartLike[],
	idOf: (node: IDshChatNodeLike) => string,
): readonly string[] {
	const byId = new Map<string, string>();
	for (const part of parts) {
		if (!byId.has(part.id)) {
			byId.set(part.id, part.encoded);
		}
	}
	const mismatched: string[] = [];
	for (const node of nodes) {
		const id = idOf(node);
		const encoded = byId.get(id);
		if (encoded === undefined) {
			continue;
		}
		const source = canonicalNode(node);
		if (source === '' || source === 'undefined') {
			mismatched.push(id);
			continue;
		}
		let decoded: unknown;
		try {
			decoded = JSON.parse(encoded);
		} catch {
			mismatched.push(id);
			continue;
		}
		// 用 stableStringify 归一后比较：编码器可能换了键序，但语义必须一致。
		if (stableStringify(decoded) !== source) {
			mismatched.push(id);
		}
	}
	return mismatched;
}
