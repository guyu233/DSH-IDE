/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 「不增不减」三层校验器单测：L0 源保真 / L1 映射双射 / L3 反向读回。
// 运行：node --experimental-strip-types --test build/lib/test/dshMappingVerifier.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalNode, verifyBijection, verifyNoIdeOnlyFields, verifyProjectionBinding, verifyRoundTrip, verifySourceFidelity } from '../../../out/vs/workbench/contrib/dsh/browser/dshMappingVerifier.js';

/** 构造一个带 raw 的源节点。 */
function node(kind: string, seq: number, raw: unknown) {
	return { kind, seq, raw };
}

/** 构造一个 dshNode part。 */
function part(id: string, encoded: string) {
	return { kind: 'dshNode', id, encoded };
}

const idOf = (n: { seq: number }) => `dsh:${n.seq}:node`;

test('L0: 源保真——raw 可 canonical 化的节点全部通过', () => {
	const nodes = [
		node('user', 1, { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: 'hi' }] } }),
		node('assistant', 2, { seq: 2, type: 'assistant/message', data: { message: { content: [] } } }),
	];
	assert.deepEqual(verifySourceFidelity(nodes), []);
});

test('L0: 没有 raw 的本层合成节点不在源保真范围内', () => {
	assert.deepEqual(verifySourceFidelity([{ kind: 'assistant', seq: 1 }]), []);
});

test('canonicalNode: 键序不同但语义相同的 raw 产生同一 canonical', () => {
	const a = canonicalNode(node('user', 1, { b: 2, a: 1 }));
	const b = canonicalNode(node('user', 1, { a: 1, b: 2 }));
	assert.equal(a, b);
});

test('L1: 单射满射保序全通过时 ok=true', () => {
	const nodes = [node('user', 1, { seq: 1 }), node('assistant', 2, { seq: 2 }), node('tool-result', 3, { seq: 3 })];
	const parts = [
		part(idOf(nodes[0]), canonicalNode(nodes[0])),
		part(idOf(nodes[1]), canonicalNode(nodes[1])),
		part(idOf(nodes[2]), canonicalNode(nodes[2])),
	];
	const result = verifyBijection(nodes, parts, idOf);
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.deepEqual(result.missing, []);
	assert.deepEqual(result.extra, []);
	assert.deepEqual(result.reordered, []);
	assert.deepEqual(result.duplicated, []);
});

test('L1: 缺 part 被报为 missing', () => {
	const nodes = [node('user', 1, { seq: 1 }), node('assistant', 2, { seq: 2 })];
	const parts = [part(idOf(nodes[0]), canonicalNode(nodes[0]))];
	const result = verifyBijection(nodes, parts, idOf);
	assert.equal(result.ok, false);
	assert.deepEqual(result.missing, ['dsh:2:node']);
});

test('L1: 多出的 part 被报为 extra（冗余检测）', () => {
	const nodes = [node('user', 1, { seq: 1 })];
	const parts = [part(idOf(nodes[0]), canonicalNode(nodes[0])), part('dsh:99:node', '{}')];
	const result = verifyBijection(nodes, parts, idOf);
	assert.equal(result.ok, false);
	assert.deepEqual(result.extra, ['dsh:99:node']);
});

test('L1: 同 id 多份被报为 duplicated', () => {
	const nodes = [node('user', 1, { seq: 1 })];
	const e = canonicalNode(nodes[0]);
	const parts = [part(idOf(nodes[0]), e), part(idOf(nodes[0]), e)];
	const result = verifyBijection(nodes, parts, idOf);
	assert.equal(result.ok, false);
	assert.deepEqual(result.duplicated, ['dsh:1:node']);
});

test('L1: 顺序颠倒被报为 reordered', () => {
	const nodes = [node('user', 1, { seq: 1 }), node('assistant', 2, { seq: 2 })];
	const parts = [part(idOf(nodes[1]), canonicalNode(nodes[1])), part(idOf(nodes[0]), canonicalNode(nodes[0]))];
	const result = verifyBijection(nodes, parts, idOf);
	assert.equal(result.ok, false);
	assert.ok(result.reordered.length > 0);
});

test('L3: encoded 与源 canonical 一致时无失配', () => {
	const nodes = [node('user', 1, { seq: 1, type: 'user/message', data: { content: [] } })];
	const parts = [part(idOf(nodes[0]), canonicalNode(nodes[0]))];
	assert.deepEqual(verifyRoundTrip(nodes, parts, idOf), []);
});

test('L3: encoded 被改写时被抓出（伪造检测）', () => {
	const nodes = [node('user', 1, { seq: 1, type: 'user/message', data: { content: [] } })];
	const parts = [part(idOf(nodes[0]), JSON.stringify({ seq: 1, type: 'user/message', data: { content: [], extra: '伪造' } }))];
	assert.deepEqual(verifyRoundTrip(nodes, parts, idOf), ['dsh:1:node']);
});

test('L3: encoded 不是合法 JSON 时被抓出', () => {
	const nodes = [node('user', 1, { seq: 1 })];
	const parts = [part(idOf(nodes[0]), 'not json')];
	assert.deepEqual(verifyRoundTrip(nodes, parts, idOf), ['dsh:1:node']);
});

test('L3: 键序不同不算失配（canonical 归一）', () => {
	const nodes = [node('user', 1, { b: 2, a: 1 })];
	const parts = [part(idOf(nodes[0]), JSON.stringify({ a: 1, b: 2 }))];
	assert.deepEqual(verifyRoundTrip(nodes, parts, idOf), []);
});

// ---- projection 绑定（C 方案）：两个真值必须同源 ----

function dshPart(hint: string, encodedObj: unknown, projectionObj: unknown) {
	return { kind: 'dshNode', hint, encoded: JSON.stringify(encodedObj), projectionEncoded: JSON.stringify(projectionObj) };
}

test('projection binding: seq 与 hint 一致时通过', () => {
	const parts = [dshPart('command', { seq: 2, type: 'command/done', data: {} }, { kind: 'command', seq: 2, name: 'help', outcome: { kind: 'success' } })];
	assert.deepEqual(verifyProjectionBinding(parts), []);
});

test('projection binding: seq 不一致被抓出', () => {
	const parts = [dshPart('command', { seq: 2 }, { kind: 'command', seq: 99 })];
	assert.deepEqual(verifyProjectionBinding(parts), ['command#0:seq-mismatch']);
});

test('projection binding: hint 与投影 kind 不一致被抓出', () => {
	const parts = [dshPart('assistant', { seq: 1 }, { kind: 'command', seq: 1 })];
	assert.deepEqual(verifyProjectionBinding(parts), ['assistant#0:hint-mismatch']);
});

test('projection binding: projection 内嵌 raw 被拒（避免重复存储与掩盖真值）', () => {
	const parts = [dshPart('user', { seq: 1 }, { kind: 'user', seq: 1, raw: { seq: 1 } })];
	assert.deepEqual(verifyProjectionBinding(parts), ['user#0:projection-contains-raw']);
});

test('projection binding: projectionEncoded 非法 JSON 被抓出', () => {
	const parts = [{ kind: 'dshNode', hint: 'user', encoded: '{"seq":1}', projectionEncoded: 'not json' }];
	assert.deepEqual(verifyProjectionBinding(parts), ['user#0:unparsable']);
});

test('verifyNoIdeOnlyFields: turnEnded 混入 projection 被抓出', () => {
	const parts = [dshPart('assistant', { seq: 1 }, { kind: 'assistant', seq: 1, turnEnded: true })];
	assert.deepEqual(verifyNoIdeOnlyFields(parts, ['turnEnded']), ['assistant:turnEnded']);
});

test('verifyNoIdeOnlyFields: 干净 projection 通过', () => {
	const parts = [dshPart('assistant', { seq: 1 }, { kind: 'assistant', seq: 1, turn: 1 })];
	assert.deepEqual(verifyNoIdeOnlyFields(parts, ['turnEnded']), []);
});

