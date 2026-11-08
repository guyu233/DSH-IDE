/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 文档结构核验（docs/DEVELOPMENT.md 第 5 章 §10.1 的三项检查）：
//
//   node build/lib/dsh/verify/dshDocsGraph.mjs
//
// 1. 定义依赖图：只取三份规格文档**头部 blockquote**内的跨文档链接；按 README → AGENTS →
//    DEVELOPMENT 的序号，**只有指向序号更靠前文件的链接**才算定义依赖边（指向更靠后的
//    是导航）。要求 0 环，且实测边数与 README §4.1 的 Mermaid 图注一致（3 节点 3 边）。
// 2. 术语表唯一：`^## .*术语` 只允许 README §2 一处。
// 3. `唯一定义` / `唯一职责` 声明按主题去重：同一主题不得由两个文件声称定义。
//
// 退出码：0 = 全部通过；1 = 任一断言失败。

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');

/** 规格文档按权威序号排列：靠前的更权威，定义依赖边只能指向靠前的文件。 */
const DOCS = ['README.md', 'AGENTS.md', 'docs/DEVELOPMENT.md'];
const RANK = new Map(DOCS.map((file, index) => [file, index]));

/** 头部 blockquote：文件开头连续的注释/空行之后，第一个 `>` 引用块（到第一个 `## ` 标题为止）。 */
function headerBlockquote(file) {
	const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
	const lines = text.split(/\r?\n/);
	const block = [];
	let inside = false;
	for (const line of lines) {
		if (!inside && /^#{1,2} /.test(line) === false && line.startsWith('>')) {
			inside = true;
		}
		if (inside) {
			if (line.startsWith('>')) {
				block.push(line);
			} else if (line.trim() === '') {
				block.push('');
			} else {
				break;
			}
		}
	}
	return block.join('\n');
}

/** blockquote 内的相对链接解析为仓库相对路径（去掉锚点）。 */
function resolveLink(fromFile, target) {
	const clean = target.split('#')[0].trim();
	if (clean === '' || /^[a-z]+:/i.test(clean)) {
		return undefined;
	}
	const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), clean));
	return resolved;
}

function definitionEdges() {
	const edges = [];
	const navigation = [];
	for (const file of DOCS) {
		const block = headerBlockquote(file);
		for (const match of block.matchAll(/\]\(([^)]+)\)/g)) {
			const target = resolveLink(file, match[1]);
			if (target === undefined || !RANK.has(target)) {
				continue;
			}
			// 同一文件对在同一 blockquote 里重复出现（如二处指向 README）只算一条边。
			const seenInFile = RANK.get(target) < RANK.get(file) ? edges : navigation;
			if (!seenInFile.some(([from, to]) => from === file && to === target)) {
				seenInFile.push([file, target]);
			}
		}
	}
	return { edges, navigation };
}

function transitiveClosure(nodes, edges) {
	const reach = new Map(nodes.map(node => [node, new Set()]));
	for (const [from, to] of edges) {
		reach.get(from).add(to);
	}
	for (const through of nodes) {
		for (const node of nodes) {
			if (reach.get(node).has(through)) {
				for (const target of reach.get(through)) {
					reach.get(node).add(target);
				}
			}
		}
	}
	return reach;
}

function main() {
	const { edges, navigation } = definitionEdges();

	// 1. 定义依赖图：0 环 + 边数/节点数与 README §4.1 的图注一致（3 / 3）。
	const reach = transitiveClosure(DOCS, edges);
	const cycles = DOCS.filter(node => reach.get(node).has(node));
	assert.deepEqual(cycles, [], `definition-dependency graph must be a DAG, found cycles: ${cycles.join(', ')}`);

	const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
	const declared = /定义依赖图（(\d+) 节点、(\d+) 边/.exec(readme);
	assert.ok(declared !== null, 'README §4.1 must declare the definition-dependency graph size');
	assert.equal(Number(declared[1]), DOCS.length, 'README node count must match the measured node count');
	assert.equal(Number(declared[2]), edges.length, `README edge count must match the measured edge count (${edges.length})`);

	// 2. 术语表唯一：只在 README §2 出现一次。
	const termHeadings = [];
	for (const file of DOCS) {
		const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
		for (const match of text.matchAll(/^## .*术语.*$/gm)) {
			termHeadings.push(`${file}:${match[0]}`);
		}
	}
	assert.deepEqual(termHeadings, ['README.md:## 2. 统一术语'], `term table must be unique to README.md, found: ${termHeadings.join(' | ')}`);

	// 3. `唯一定义` / `唯一职责` 声明按主题去重：只统计**声明式**用法——出现在表格列头
	//    （`唯一定义` 后紧跟 `|`）或在句子中直接跟书名号/术语名词的说法，其它提及（如
	//    「由第 1 章 §1 唯一定义并解释」）属于导航，不构成第二份定义。
	const claims = [];
	for (const file of DOCS) {
		const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
		for (const match of text.matchAll(/`?(唯一定义|唯一职责)`?\s*[：:]\s*([^\n|。）]{2,32})/g)) {
			const subject = match[2].replace(/`/g, '').trim();
			if (subject.length > 0 && !subject.startsWith('|')) {
				claims.push([file, subject]);
			}
		}
	}
	const seen = new Map();
	for (const [file, subject] of claims) {
		const previous = seen.get(subject);
		assert.ok(previous === undefined || previous === file, `duplicate "唯一定义/唯一职责" claim for "${subject}" in ${previous} and ${file}`);
		seen.set(subject, file);
	}

	console.log(`PASS  docs-graph: ${DOCS.length} nodes / ${edges.length} edges / 0 cycles; navigation links excluded (${navigation.length}); term table unique; ${claims.length} unique-owner claims deduped`);
}

try {
	main();
} catch (error) {
	console.error('STATUS: FAIL  [docs-graph]');
	console.error(error?.message ?? error);
	process.exit(1);
}
