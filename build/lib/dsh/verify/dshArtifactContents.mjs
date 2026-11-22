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
// 版本从 manifest 读，不硬编码：升版后旧 tgz 残留会让门禁检查错对象。
const manifestForVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'build', 'lib', 'dsh', 'package.json'), 'utf8'));
const PACKAGE_VERSION = manifestForVersion.version;
const tgz = path.join(repoRoot, 'dist', `dsh-ide-${PACKAGE_VERSION}.tgz`);

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
	'dshLocations.js',
	'dshThemePreference.js',
];
const EXPECTED_PROTOCOL = [
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
const presentProtocol = new Set(list.filter(m => m.startsWith('package/protocol/')).map(m => path.basename(m)));
const missingCommon = [
	...EXPECTED_COMMON.filter(name => !present.has(name)),
	...EXPECTED_PROTOCOL.filter(name => !presentProtocol.has(name)),
];

// Host 入口里是否出现新 method 名（说明代码确实是新构建的）。
const hostEntry = ['package/host/bridge/ide-view-host.js', 'package/index.js'].map(readMember).join('\n');
const methodTraces = ['archiveSession', 'unarchiveSession', 'searchSessions', 'loadOlder', 'throughSeq']
	.filter(name => hostEntry.includes(name));
const missingTraces = ['archiveSession', 'searchSessions'].filter(name => !methodTraces.includes(name));

// 终端：JS 在 `node_modules.asar` 内，原生绑定改由 DSH Host 提供（`DSH_IDE_HOST_PTY_PATH`）。
// 因此这里不再要求 `.node` 随包，改为要求「ASAR 在 + Host 适配器在 + 载荷不重复带 prebuilds」。
const hasNodePtyAsar = list.some(m => m.endsWith('/node_modules.asar'));
const ptyPrebuilds = list.filter(m => /node_modules\.asar\.unpacked\/node-pty\/prebuilds\//.test(m));

const hostService = readMember('package/host/usecase/ide-service.js');
const hasHostRipgrepAdapter = list.includes('package/host/launch/host-ripgrep.js')
	&& hostService.includes('await resolveHostRipgrep()')
	&& hostService.includes('DSH_IDE_HOST_RG_PATH');
const bundledWindowsRipgrep = list.filter(member => /^package\/runtime\/app\/node_modules(?:\.asar\.unpacked)?\/@vscode\/ripgrep-universal\/bin\/win32-[^/]+\/rg\.exe$/u.test(member));

const failures = [];

// ① manifest 白名单逐项核对：`files` 里声明的每个条目都必须在产物里真的出现。
// 旧实现只抽查 11 个 common 模块，删掉 `package/index.js`、`client.js`、`package.json`、
// `PROVENANCE.md`、`LICENSE-DSH`、整个 `runtime/app/out/` 都仍判 PASS，等于没有守护。
const manifest = JSON.parse(readMember('package/package.json'));
const manifestFiles = Array.isArray(manifest.files) ? manifest.files : [];
if (manifestFiles.length === 0) { failures.push('package/package.json 缺 files 白名单'); }
for (const entry of manifestFiles) {
	const normalized = entry.replace(/\/$/, '');
	if (/[*?[\]]/.test(normalized)) {
		const prefix = normalized.split(/[*?[\]]/)[0].replace(/[^/]*$/, '');
		const suffix = normalized.slice(prefix.length);
		const ext = suffix.startsWith('*.') ? suffix.slice(1) : '';
		const hits = list.filter(member => member.startsWith(`package/${prefix}`) && (ext === '' || member.endsWith(ext)));
		if (hits.length === 0) { failures.push(`manifest files 声明的通配条目没有产物成员: ${entry}`); }
		continue;
	}
	const expected = `package/${normalized}`;
	const present = list.includes(expected) || list.some(member => member.startsWith(`${expected}/`));
	if (!present) {
		failures.push(`manifest files 声明的条目在产物里缺失: ${entry}`);
	}
}

// ② IDE 载荷入口与来源凭据：没有它们，包能装但窗口打不开、审计也断链。
const REQUIRED_MEMBERS = [
	'package/index.js',
	'package/client.js',
	'package/package.json',
	'package/cordis.patch.yml',
	'package/icon.svg',
	'package/PROVENANCE.md',
	'package/LICENSE-DSH',
	'package/locale/en.json',
	'package/locale/zh.json',
	'package/locale/ja.json',
	'package/locale/es.json',
	'package/locale/fr.json',
	'package/locale/de.json',
	'package/locale/ru.json',
	'package/locale/pt.json',
	'package/docs/DETAIL.md',
	'package/docs/DETAIL.zh.md',
	'package/docs/preview.svg',
	'package/runtime/app/out/main.js',
	'package/runtime/app/out/mainImpl.js',
	'package/runtime/build-provenance.json',
];
for (const member of REQUIRED_MEMBERS) {
	if (!list.includes(member)) { failures.push(`产物缺必需成员: ${member}`); }
}

// ③ 版本一致性：manifest、tar 内的 package.json 与文件名必须是同一版。
const manifestVersion = manifest.version;
const tarVersion = /^dsh-ide-(.+)\.tgz$/.exec(path.basename(tgz))?.[1];
if (typeof manifestVersion !== 'string' || manifestVersion === '') {
	failures.push('package/package.json 缺 version');
} else if (tarVersion !== manifestVersion) {
	failures.push(`产物文件名版本 ${tarVersion} 与 manifest ${manifestVersion} 不一致`);
}

// ④ engines.dsh 必须存在：运行宿主版本契约是插件可安装的前提。
if (typeof manifest?.engines?.dsh !== 'string' || manifest.engines.dsh === '') {
	failures.push('package/package.json 缺 engines.dsh');
}

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
