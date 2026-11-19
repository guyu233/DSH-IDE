/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 第 45 轮：核对打包产物是否真的包含前几轮修复的内容（只读检查，不改产物）。
//
// 背景：第 36 轮发现磁盘上的 `dist/dsh-ide-2.0.0.tgz` 是**早于第 19 轮的陈旧产物**
// （`package/common/` 里只有 `env.js`，缺多个共享模块）。此后第 37–39 轮修了三处
// 终端相关的真实阻塞（desktop 入口、NAPI 已证、node-pty 依赖分类），但**从未重新打包**，
// 因此那些修复是否真的落进产物，此前一直没有证据。
//
// 本脚本检查产物的入口、共享模块与本地原生资源。
//   ① `package/common/` 下 11 个共享模块是否齐全（含协议真源 dshIdeProtocol.js）；
//   ② Host 入口是否含 `archiveSession` / `searchSessions` / `loadLater` 等新 method 痕迹；
//   ③ `node-pty` 是否随包（对应第 39 轮的依赖分类修复）；
//   ④ Host 搜索适配器随包，且 Windows 桌面不再重复分发宿主提供的 rg.exe。
//
// 它**不做**体积结论、**不判断**终端是否可用——后者必须真机（U06）。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 用脚本自身位置推导仓库根，而不是 `process.cwd()`：本文件在
// build/lib/dsh/verify/ 下，向上四级即仓库根；否则从其它目录直接 `node <本文件>`
// 会把 cwd 当成仓库根，误报「未找到产物」。
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
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
	'dshIdeComposer.js',
	'dshIdeWaterfallNotice.js',
	'dshIdeRequestView.js',
	'dshIdeProtocol.js',
];

const present = new Set(list.filter(m => m.startsWith('package/common/')).map(m => path.basename(m)));
const missingCommon = EXPECTED_COMMON.filter(name => !present.has(name));

// Host 入口里是否出现新 method 名（说明代码确实是新构建的）。
const hostEntry = ['package/host/ide-view-host.js', 'package/index.js'].map(readMember).join('\n');
const methodTraces = ['archiveSession', 'unarchiveSession', 'searchSessions', 'loadOlder', 'throughSeq']
	.filter(name => hostEntry.includes(name));
const missingTraces = ['archiveSession', 'searchSessions'].filter(name => !methodTraces.includes(name));

// 终端：JS 在 `node_modules.asar` 内，原生绑定改由 DSH Host 提供（`DSH_IDE_HOST_PTY_PATH`）。
// 因此这里不再要求 `.node` 随包，改为要求「ASAR 在 + Host 适配器在 + 载荷不重复带 prebuilds」。
const hasNodePtyAsar = list.some(m => m.endsWith('/node_modules.asar'));
const ptyPrebuilds = list.filter(m => /node_modules\.asar\.unpacked\/node-pty\/prebuilds\//.test(m));

const hostService = readMember('package/host/ide-service.js');
const hasHostRipgrepAdapter = list.includes('package/host/host-ripgrep.js')
	&& hostService.includes('await resolveHostRipgrep()')
	&& hostService.includes('DSH_IDE_HOST_RG_PATH');
const bundledWindowsRipgrep = list.filter(member => /^package\/runtime\/app\/node_modules(?:\.asar\.unpacked)?\/@vscode\/ripgrep-universal\/bin\/win32-[^/]+\/rg\.exe$/u.test(member));

const failures = [];
if (!hasHostRipgrepAdapter) { failures.push('产物缺 Host ripgrep 适配器或启动接线'); }
if (bundledWindowsRipgrep.length > 0) { failures.push(`产物仍重复携带 Windows ripgrep: ${bundledWindowsRipgrep.join(', ')}`); }
if (missingCommon.length > 0) { failures.push(`package/common/ 缺模块: ${missingCommon.join(', ')}`); }
if (missingTraces.length > 0) { failures.push(`Host 入口缺新 method 痕迹: ${missingTraces.join(', ')}`); }
if (!hasNodePtyAsar) { failures.push('产物缺 node_modules.asar，node-pty 的 JS 代码可能没进去'); }
if (ptyPrebuilds.length > 0) { failures.push(`载荷重复携带 node-pty 原生绑定: ${ptyPrebuilds.slice(0, 3).join(', ')}`); }

console.log(`  tar 成员数              : ${list.length}`);
console.log(`  package/common/ 模块    : ${present.size} 个（期望 ${EXPECTED_COMMON.length}）`);
console.log(`  Host 入口新 method 痕迹 : ${methodTraces.join(', ') || '（无）'}`);
console.log(`  node-pty prebuilds（应为 0）: ${ptyPrebuilds.length} 个`);
console.log(`  node_modules.asar 归档  : ${hasNodePtyAsar ? '在' : '缺'}`);
console.log(`  Host ripgrep 适配        : ${hasHostRipgrepAdapter ? '在' : '缺'}`);
console.log(`  Windows rg.exe 副本      : ${bundledWindowsRipgrep.length} 个`);
console.log(`  产物大小                : ${fs.statSync(tgz).size} B`);

if (failures.length > 0) {
	for (const f of failures) { console.error(`  ✗ ${f}`); }
	console.error(`STATUS: FAIL  [artifact] ${failures.length} 项不符合预期`);
	process.exit(1);
}
console.log('STATUS: PASS  [artifact] 产物包含前几轮修复的内容');
