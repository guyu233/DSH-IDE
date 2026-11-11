/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 第 45 轮：核对打包产物是否真的包含前几轮修复的内容（只读检查，不改产物）。
//
// 背景：第 36 轮发现磁盘上的 `dist/dsh-ide-2.0.0.tgz` 是**早于第 19 轮的陈旧产物**
// （`package/common/` 里只有 `env.js`，缺 6 个共享模块）。此后第 37–39 轮修了三处
// 终端相关的真实阻塞（desktop 入口、NAPI 已证、node-pty 依赖分类），但**从未重新打包**，
// 因此那些修复是否真的落进产物，此前一直没有证据。
//
// 本脚本对产物做三项可静态判定、且与「代码是否进包」有关的检查：
//   ① `package/common/` 下 7 个共享模块是否齐全（对应第 19/22/34 轮新增的投影模块）；
//   ② Host 入口是否含 `archiveSession` / `searchSessions` / `loadLater` 等新 method 痕迹；
//   ③ `node-pty` 是否随包（对应第 39 轮的依赖分类修复）。
//
// 它**不做**体积结论、**不判断**终端是否可用——后者必须真机（U06）。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const tgz = path.join(repoRoot, 'dist', 'dsh-ide-2.0.0.tgz');

if (!fs.existsSync(tgz)) {
	console.error(`STATUS: FAIL  [artifact] 未找到产物 ${path.relative(repoRoot, tgz)}`);
	process.exit(1);
}

const list = execFileSync('tar', ['-tzf', tgz], { cwd: repoRoot, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);

/** 读取 tar 里某个成员的内容。 */
function readMember(member) {
	try {
		return execFileSync('tar', ['-xzOf', tgz, member], { cwd: repoRoot, encoding: 'utf8' });
	} catch {
		return '';
	}
}

const EXPECTED_COMMON = [
	'env.js',
	'dshIdeAuthRedaction.js',
	'dshIdeSessionList.js',
	'dshIdeCommandList.js',
	'dshIdeCommandLine.js',
	'dshIdeArchiveSet.js',
	'dshIdeSessionSearch.js',
];

const present = new Set(list.filter(m => m.startsWith('package/common/')).map(m => path.basename(m)));
const missingCommon = EXPECTED_COMMON.filter(name => !present.has(name));

// Host 入口里是否出现新 method 名（说明代码确实是新构建的）。
const hostEntry = ['package/host/ide-view-host.js', 'package/index.js'].map(readMember).join('\n');
const methodTraces = ['archiveSession', 'unarchiveSession', 'searchSessions', 'loadOlder', 'throughSeq']
	.filter(name => hostEntry.includes(name));
const missingTraces = ['archiveSession', 'searchSessions'].filter(name => !methodTraces.includes(name));

// node-pty 是否随包（第 39 轮依赖分类 + 第 45 轮 .moduleignore 修复的直接后果）。
// 注意 Electron 的布局：`.node` 二进制无法放进 asar，会被解包到
// `node_modules.asar.unpacked/`；JS 代码则在 `node_modules.asar` 归档内。
// 因此这里必须同时认这两种位置，只认 `node_modules/node-pty/` 会误报缺失。
const nodePtyUnpacked = list.filter(m => /node_modules\.asar\.unpacked\/node-pty\//.test(m));
const hasNodePtyBinary = nodePtyUnpacked.some(m => m.endsWith('.node'));
const hasNodePtyAsar = list.some(m => m.endsWith('/node_modules.asar'));
const hasNodePty = hasNodePtyBinary;

const failures = [];
if (missingCommon.length > 0) { failures.push(`package/common/ 缺模块: ${missingCommon.join(', ')}`); }
if (missingTraces.length > 0) { failures.push(`Host 入口缺新 method 痕迹: ${missingTraces.join(', ')}`); }
if (!hasNodePty) { failures.push('node-pty 未随包（.moduleignore 的 node-pty/** 仍需例外）'); }
if (hasNodePty && !hasNodePtyAsar) { failures.push('产物缺 node_modules.asar，node-pty 的 JS 代码可能没进去'); }

console.log(`  tar 成员数              : ${list.length}`);
console.log(`  package/common/ 模块    : ${present.size} 个（期望 7）`);
console.log(`  Host 入口新 method 痕迹 : ${methodTraces.join(', ') || '（无）'}`);
console.log(`  node-pty 二进制（unpacked）: ${nodePtyUnpacked.length} 个`);
console.log(`  node_modules.asar 归档  : ${hasNodePtyAsar ? '在' : '缺'}`);
console.log(`  产物大小                : ${fs.statSync(tgz).size} B`);

if (failures.length > 0) {
	for (const f of failures) { console.error(`  ✗ ${f}`); }
	console.error(`STATUS: FAIL  [artifact] ${failures.length} 项不符合预期`);
	process.exit(1);
}
console.log('STATUS: PASS  [artifact] 产物包含前几轮修复的内容');
