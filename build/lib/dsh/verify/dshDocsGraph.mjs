/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 文档结构核验（docs/DEVELOPMENT.md 第 5 章 §10.1 的四项检查）：
//
//   node build/lib/dsh/verify/dshDocsGraph.mjs
//
// 1. 定义依赖图：只取三份规格文档**头部 blockquote**内的跨文档链接；按 README → AGENTS →
//    DEVELOPMENT 的序号，**只有指向序号更靠前文件的链接**才算定义依赖边（指向更靠后的
//    是导航）。要求 0 环，且实测边数与 README §4.1 的 Mermaid 图注一致（3 节点 3 边）。
// 2. 术语表唯一：`^## .*术语` 只允许 README §2 一处。
// 3. `唯一定义` / `唯一职责` 声明按主题去重：同一主题不得由两个文件声称定义。
// 4. 状态单一性与每轮回写：第 3 章 §6 唯一状态表恰好 8 行 P0–P7、状态值限于枚举；三份文档
//    除该表外不得出现阶段状态行或过期状态字面量；README §7 不得写阶段状态细节。另校验
//    §0.1 项目快照、§0.2 用户操作清单、第 7 章 §3 待办清单、§7.7 每轮更新记录四者齐全，
//    日期 / commit 与 §3.6「最后实测」一致、快照数值仍能在真源中找到；PASS 输出待办统计、
//    用户操作统计与轮次数。
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

/** 唯一状态表的锚点、允许的状态枚举、禁止复现的过期状态字面量。 */
const STATE_TABLE_HEADING = '### 6. 当前进度（唯一状态表）';
const STATUS_VALUES = new Set(['已完成', '进行中', '未开始', '未满足出口']);
const STALE_STATUS_LITERALS = [
	'launch chain removed',
	'P3 进行中',
	'P5 未开始',
	'消费者不存在',
	'call() 一律 reject',
	'页面承载可行',
	'原生渲染承载',
];
const STATE_POINTER = '应指向第 3 章 §6';

/** 每轮回写的四处锚点、状态枚举、快照中必须与真源同步的数值。 */
const SNAPSHOT_HEADING = '### 0.1 当前项目情况（每轮更新）';
const USER_ACTIONS_HEADING = '### 0.2 用户本轮操作清单（每轮更新）';
const TODO_HEADING = '### 3. 待办清单（唯一，含完成标记）';
const ROUND_LOG_HEADING = '#### 7.7 每轮更新记录（每轮新增一行）';
const TODO_STATUS_VALUES = new Set(['已完成', '未完成', '待核对']);
const USER_ACTION_STATUS_VALUES = new Set(['待用户执行', '已完成', '暂阻塞']);
const SNAPSHOT_TOKENS = ['119,704,107', '183/183', '3 `PASS` + 1 `PENDING`'];

/** 校验唯一状态表与每轮回写，并收集三份文档中出现的第二份阶段状态。 */
function stateViolations() {
	const lines = new Map(DOCS.map(file => [
		file,
		fs.readFileSync(path.join(repoRoot, file), 'utf8').split(/\r?\n/),
	]));
	const devFile = 'docs/DEVELOPMENT.md';
	const devLines = lines.get(devFile);
	const tableStart = devLines.findIndex(line => line.trim() === STATE_TABLE_HEADING);
	assert.ok(tableStart >= 0, `missing state table heading: ${STATE_TABLE_HEADING}`);
	let tableEnd = devLines.length;
	for (let i = tableStart + 1; i < devLines.length; i++) {
		if (/^---\s*$/.test(devLines[i]) || /^## /.test(devLines[i])) {
			tableEnd = i;
			break;
		}
	}
	const section = devLines.slice(tableStart, tableEnd);
	const rows = section.filter(line => /^\|\s*P[0-7]\s*\|/.test(line));
	assert.equal(rows.length, 8, `state table must have exactly 8 P0-P7 rows, found ${rows.length}`);
	for (const [index, row] of rows.entries()) {
		const cells = row.split('|').map(cell => cell.trim());
		assert.ok(cells.length >= 6, `state row must have 4 columns: ${row}`);
		assert.equal(cells[1], `P${index}`, `state table row ${index + 1} must be P${index}`);
		assert.ok(STATUS_VALUES.has(cells[2]), `invalid status "${cells[2]}" at ${devFile}:${tableStart + 1 + section.indexOf(row)}`);
	}

	const violations = [];
	for (const file of DOCS) {
		const fileLines = lines.get(file);
		for (let i = 0; i < fileLines.length; i++) {
			if (file === devFile && i >= tableStart && i < tableEnd) {
				continue;
			}
			const line = fileLines[i];
			const where = `${file}:${i + 1}`;
			if (/^\|\s*P[0-7]\s*\|/.test(line)) {
				violations.push(`${where}  ${line.trim()}  → ${STATE_POINTER}`);
			}
			if (line.startsWith('- **当前态**：') && !line.includes('第 3 章 §6')) {
				violations.push(`${where}  阶段当前态必须是指针  → ${STATE_POINTER}`);
			}
			for (const literal of STALE_STATUS_LITERALS) {
				if (line.includes(literal)) {
					violations.push(`${where}  过期状态字面量 "${literal}"  → ${STATE_POINTER}`);
				}
			}
		}
	}

	const readmeLines = lines.get('README.md');
	const statusStart = readmeLines.findIndex(line => /^## 7\. 当前状态入口/.test(line));
	assert.ok(statusStart >= 0, 'README §7 heading is missing');
	let statusEnd = readmeLines.length;
	for (let i = statusStart + 1; i < readmeLines.length; i++) {
		if (/^## /.test(readmeLines[i])) {
			statusEnd = i;
			break;
		}
	}
	for (let i = statusStart; i < statusEnd; i++) {
		if (/P[0-7].*(进行中|未开始|已完成)/.test(readmeLines[i])) {
			violations.push(`README.md:${i + 1}  §7 不得写阶段状态细节  → ${STATE_POINTER}`);
		}
	}
	// 每轮回写：项目快照 / 用户操作清单 / 唯一待办清单 / 更新记录四处齐全，且日期、commit 与数值一致。
	const snapshotStart = devLines.findIndex(line => line.trim() === SNAPSHOT_HEADING);
	const userActionsStart = devLines.findIndex(line => line.trim() === USER_ACTIONS_HEADING);
	const todoStart = devLines.findIndex(line => line.trim() === TODO_HEADING);
	const roundsStart = devLines.findIndex(line => line.trim() === ROUND_LOG_HEADING);
	assert.ok(snapshotStart >= 0 && userActionsStart >= 0 && todoStart >= 0 && roundsStart >= 0,
		'每轮回写四处（§0.1 / §0.2 / 第 7 章 §3 / §7.7）必须齐全');
	const sectionEnd = (all, start) => {
		for (let i = start + 1; i < all.length; i++) {
			if (/^---\s*$/.test(all[i]) || /^#{2,4} /.test(all[i])) {
				return i;
			}
		}
		return all.length;
	};
	const snapshotEnd = sectionEnd(devLines, snapshotStart);
	const snapshotText = devLines.slice(snapshotStart, snapshotEnd).join('\n');
	const elsewhere = devLines.filter((_, i) => i < snapshotStart || i >= snapshotEnd).join('\n');
	for (const token of SNAPSHOT_TOKENS) {
		if (snapshotText.includes(token)) {
			assert.ok(elsewhere.includes(token), `快照数值 "${token}" 已不在唯一真源中，需回写 §0.1`);
		}
	}
	const snapshotRow = devLines.slice(snapshotStart, snapshotEnd).find(line => /^\|\s*最后更新\s*\|/.test(line));
	assert.ok(snapshotRow !== undefined, '§0.1 必须有「最后更新」行');
	const snapshot = snapshotRow.split('|').map(cell => cell.trim())[2].replace(/`/g, '');
	assert.match(snapshot, /^\d{4}-\d{2}-\d{2} \/ [0-9a-f]{7,40}$/, '§0.1「最后更新」必须是「日期 / commit」');
	for (const row of rows) {
		const measured = row.split('|').map(cell => cell.trim())[4].replace(/`/g, '');
		assert.equal(measured, snapshot, `第 3 章 §6 的「最后实测」必须与 §0.1「最后更新」一致：${row.slice(0, 40)}`);
	}

	const todoRows = devLines.slice(todoStart, sectionEnd(devLines, todoStart)).filter(line => /^\|\s*D\d+\s*\|/.test(line));
	assert.ok(todoRows.length > 0, '第 7 章 §3 待办清单不能为空');
	const todoStats = { done: 0, open: 0, verify: 0 };
	for (const row of todoRows) {
		const cells = row.split('|').map(cell => cell.trim());
		assert.ok(cells.length >= 8, `待办行必须 6 列: ${row.slice(0, 60)}`);
		assert.ok(TODO_STATUS_VALUES.has(cells[4]), `待办 ${cells[1]} 的「是否完成」值非法: ${cells[4]}`);
		assert.ok(cells[5].length > 0, `待办 ${cells[1]} 必须写依据 / 真源`);
		// 各条目的核对日期可以不同：只要求是合法日期或 —，不强制与快照同日。
		assert.ok(cells[6] === '—' || /^\d{4}-\d{2}-\d{2}$/.test(cells[6]), `待办 ${cells[1]} 的「最后核对」必须是日期或 —`);
		if (cells[4] === '已完成') {
			todoStats.done++;
		} else if (cells[4] === '未完成') {
			todoStats.open++;
		} else {
			todoStats.verify++;
		}
	}

	const userActionRows = devLines.slice(userActionsStart, sectionEnd(devLines, userActionsStart)).filter(line => /^\|\s*U\d+\s*\|/.test(line));
	assert.ok(userActionRows.length > 0, '§0.2 用户本轮操作清单不能为空');
	const userStats = { ready: 0, done: 0, blocked: 0 };
	for (const row of userActionRows) {
		const cells = row.split('|').map(cell => cell.trim());
		assert.ok(cells.length >= 9, `用户操作行必须 7 列: ${row.slice(0, 60)}`);
		assert.ok(USER_ACTION_STATUS_VALUES.has(cells[7]), `用户操作 ${cells[1]} 的「状态」值非法: ${cells[7]}`);
		assert.ok(cells[3].length > 0, `用户操作 ${cells[1]} 必须写对应项`);
		assert.ok(cells[5].length > 0, `用户操作 ${cells[1]} 必须写完成判据`);
		if (cells[7] === '待用户执行') {
			userStats.ready++;
		} else if (cells[7] === '已完成') {
			userStats.done++;
		} else {
			userStats.blocked++;
		}
	}

	const roundRows = devLines.slice(roundsStart, sectionEnd(devLines, roundsStart)).filter(line => /^\|\s*\d+\s*\|/.test(line));
	assert.ok(roundRows.length > 0, '§7.7 每轮更新记录不能为空');
	const lastRound = roundRows[roundRows.length - 1].split('|').map(cell => cell.trim())[2].replace(/`/g, '');
	assert.equal(lastRound, snapshot, '§7.7 最后一行的日期 / commit 必须与 §0.1「最后更新」一致');

	return { violations, snapshot, todoStats, userStats, rounds: roundRows.length };
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

	// 4. 状态单一性与每轮回写：第 3 章 §6 是唯一状态真源，其它章节只允许指针。
	const state = stateViolations();
	assert.deepEqual(state.violations, [], `state single-source violations:\n${state.violations.join('\n')}`);

	console.log(`PASS  docs-graph: ${DOCS.length} nodes / ${edges.length} edges / 0 cycles; navigation links excluded (${navigation.length}); term table unique; ${claims.length} unique-owner claims deduped; state single-source ok (8 phases); snapshot ${state.snapshot}; todos ${state.todoStats.done} done / ${state.todoStats.open} open / ${state.todoStats.verify} to-verify; user actions ${state.userStats.ready} ready / ${state.userStats.done} done / ${state.userStats.blocked} blocked; ${state.rounds} rounds`);
}

try {
	main();
} catch (error) {
	console.error('STATUS: FAIL  [docs-graph]');
	console.error(error?.message ?? error);
	process.exit(1);
}
