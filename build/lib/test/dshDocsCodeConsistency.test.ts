/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 第 35 轮：检测「手册声称某 method 未接线，但代码其实已接线」这类**过时陈述**。
//
// 背景：第 33–34 轮连续发现手册状态落后于代码——U05 说「审批问卷双窗口接线未完成」、
// D13 说「审批 / 问卷 … 仍未接线」，而 `answerApproval` / `answerQuestion` /
// `cancelRequest` 早已在 Host 与 transport 双端实现并有单测。这种落后会让真机验收
// 被无谓推迟，也让待办统计失真。
//
// 本测试的判据很窄、只针对**可机械判定**的情形：
//   若手册在「未接线」的语境里提到了某个 method 名，而该 method 在两套 backend
//   都已实现，则判为过时陈述。
// 它不判断语义层面的「够不够用」，只防止**最明显的一类落后**。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const handbook = fs.readFileSync(path.join(repoRoot, 'docs/DEVELOPMENT.md'), 'utf8');
const hostSource = fs.readFileSync(path.join(repoRoot, 'src/vs/platform/dshClient/host/ide-view-host.js'), 'utf8');
const transportSource = fs.readFileSync(path.join(repoRoot, 'src/vs/platform/dshClient/transport/dshIdeTransport.ts'), 'utf8');

/** 当前契约里的全部 method 名（用于把文本里提到的名字限制在契约集合内）。 */
function contractMethods() {
	const protocol = fs.readFileSync(path.join(repoRoot, 'src/vs/platform/dshClient/common/dshIdeProtocol.ts'), 'utf8');
	const block = /const DSH_IDE_METHOD_KEYS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(protocol)?.[1] ?? '';
	return [...new Set([...block.matchAll(/^\s*([a-zA-Z]+):/gm)].map(m => m[1]))];
}

/** 某 method 是否在 Host 与 transport 两套 backend 都已实现。 */
function isWiredInCode(method) {
	const inHost = hostSource.includes(`async ${method}(args)`) || hostSource.includes(`${method}: missing(`) === false && hostSource.includes(`async ${method}(`);
	const inTransport = new RegExp(`case '${method}'`).test(transportSource);
	// `FEATURE_UNAVAILABLE` 的 stub 块也算「出现在 transport」，故必须排除 stub 形态。
	const transportStubbed = new RegExp(`case '${method}':\\s*case '(?:[a-zA-Z]+)':\\s*\\n\\s*return this\\.reject\\(`).test(transportSource);
	return inHost && inTransport && !transportStubbed;
}

test('handbook does not call a method "unwired" when both backends implement it', () => {
	// 只扫「当前状态区」，排除历史记录：
	//   - §7.7 每轮更新记录（历史，允许写当时的未接线状态）
	//   - §8.10.x 历史核实小节（记录某一轮的结论）
	// 这两处描述的是**当时**，不是现在；对它们做一致性断言会误报。
	const historyStart = handbook.indexOf('#### 7.7 每轮更新记录');
	const current = historyStart < 0 ? handbook : handbook.slice(0, historyStart);

	const methods = contractMethods();
	assert.ok(methods.length >= 20, `expected the contract method list, got ${methods.length}`);

	// 手册的待办表格行极长，一行里常同时出现「已接线的」与「未接线的」方法名，
	// 因此按**分句**匹配（以中文句号 / 分号 / 顿号段切分），只在**同一分句**内
	// 既有「未接线」又提到该 method 时才判定，避免整行匹配造成的成片误报。
	const stale = [];
	for (const line of current.split(/\r?\n/)) {
		// 引述历史措辞的行（「本行此前写…」「此前写…」）不是当前断言，跳过。
		if (/此前写|本行此前|曾写/.test(line)) { continue; }
		if (!/未接线|仍未接|尚未接/.test(line)) { continue; }
		for (const clause of line.split(/[。；;]/)) {
			if (!/未接线|仍未接|尚未接/.test(clause)) { continue; }
			for (const method of methods) {
				if (!new RegExp(`\\b${method}\\b`).test(clause)) { continue; }
				if (isWiredInCode(method)) { stale.push(`${method} → ${clause.slice(0, 60)}…`); }
			}
		}
	}
	assert.deepEqual(stale, [],
		'handbook claims these methods are unwired but both backends implement them; correct the statement instead of delaying verification');
});

test('the three approval/question methods stay wired on both sides', () => {
	// 第 34–35 轮核实的具体结论，钉住防止回退。
	for (const method of ['answerApproval', 'answerQuestion', 'cancelRequest']) {
		assert.ok(hostSource.includes(`async ${method}(args)`), `${method} must stay implemented in the Host bridge`);
		assert.ok(new RegExp(`case '${method}'`).test(transportSource), `${method} must stay implemented in the transport`);
	}
	// 手册不得再声称它们未接线。
	for (const method of ['answerApproval', 'answerQuestion', 'cancelRequest']) {
		assert.doesNotMatch(handbook, new RegExp(`${method}[^\\n]{0,40}未接线`), `${method} must not be described as unwired`);
	}
});
