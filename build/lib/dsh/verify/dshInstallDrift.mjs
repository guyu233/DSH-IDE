/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 第 48 轮：**profile 安装漂移**检查（`npm run verify:dsh-install-drift`，手动运行）。
//
// 起因（第 47 轮的教训）：profile 里装着的 `dsh-ide` 长期是两周前的旧文件——
// `common/` 只有 1 个模块（应为 7 个）、`host/ide-view-host.js` 19,565 B（产物 35,584 B）。
// 也就是说：**代码已提交、tgz 已产出，但运行时用的仍是旧文件**，而此前没有任何检查
// 会提示这件事。第 47 轮把文件按包内路径精确覆盖后，22/22 逐字节一致。
//
// 本脚本把「产物 ↔ 已安装」的一致性变成可执行的检查，防止再次静默漂移。
//
// 边界（重要）：
//   - 它**只比对文件**，不判断运行时是否已加载——后者必须用 `cordis_inspect_query`
//     的 `Config.listConfigs{name:"dsh-ide"}`（`status` 为 `active` 才算加载）。
//   - 它**不修改**安装目录；漂移时只报告并给出处置办法（见手册第 5 章 §6）。
//   - 未安装（profile 不存在该包）不算失败，只提示。
//
// 用法：`node build/lib/dsh/verify/dshInstallDrift.mjs`
// 退出码：0 = 一致或未安装；1 = 存在漂移。

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const tgz = path.join(repoRoot, 'dist', 'dsh-ide-2.0.0.tgz');
const profileDir = process.env['DSH_PROFILE_DIR'];
const PACKAGE_NAME = 'dsh-ide';

if (!fs.existsSync(tgz)) {
	console.error(`STATUS: FAIL  [install-drift] 未找到产物 ${path.relative(repoRoot, tgz)}（先跑 gulp dsh-ide-pack）`);
	process.exit(1);
}
if (!profileDir) {
	console.log('STATUS: PASS  [install-drift] 未设置 DSH_PROFILE_DIR（非 profile 环境），跳过');
	process.exit(0);
}

const installedRoot = path.join(profileDir, 'node_modules', PACKAGE_NAME);
if (!fs.existsSync(installedRoot)) {
	console.log(`STATUS: PASS  [install-drift] profile 内未安装 ${PACKAGE_NAME}，跳过`);
	process.exit(0);
}

/** 产物里属于「插件层」的条目（排除随包 app 的 runtime/）。 */
function artifactEntries() {
	return execFileSync('tar', ['-tzf', tgz], { cwd: repoRoot, encoding: 'utf8' })
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(line => line.startsWith('package/') && line !== 'package/')
		.map(line => line.slice('package/'.length))
		.filter(rel => rel !== '' && !rel.startsWith('runtime/'));
}

const sha = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

const files = artifactEntries().filter(rel => !rel.endsWith('/'));
const drift = [];
let checked = 0;

for (const rel of files) {
	const installedPath = path.join(installedRoot, rel);
	if (!fs.existsSync(installedPath)) { drift.push(`缺失: ${rel}`); continue; }
	let artifactBuffer;
	try {
		artifactBuffer = execFileSync('tar', ['-xzOf', tgz, `package/${rel}`], { cwd: repoRoot });
	} catch {
		continue; // 目录或不可读成员，跳过
	}
	if (Buffer.isBuffer(artifactBuffer) && artifactBuffer.length > 0) {
		checked++;
		if (sha(artifactBuffer) !== sha(fs.readFileSync(installedPath))) { drift.push(`内容不同: ${rel}`); }
	}
}

console.log(`  产物插件层文件数        : ${files.length}`);
console.log(`  逐字节比对文件数        : ${checked}`);
console.log(`  漂移项                  : ${drift.length}`);

if (drift.length > 0) {
	for (const item of drift.slice(0, 12)) { console.error(`  ✗ ${item}`); }
	if (drift.length > 12) { console.error(`  … 另有 ${drift.length - 12} 项`); }
	console.error('');
	console.error('STATUS: FAIL  [install-drift] 已安装内容与产物不一致。');
	console.error('  处置：按第 5 章 §6 的办法把产物插件层精确覆盖到 profile（同版本号 tarball 时');
	console.error('  `plugin_manager install_bundle` 会返回 changed:false 而不刷新），覆盖后须重启 DSH 才生效。');
	process.exit(1);
}

// ---------------------------------------------------------------------------
// 第 49 轮追加：检查「装载配置链」是否完整。
// 文件一致还不够——插件要被加载，还需要三处配置对齐：
//   ① 安装包 package.json 声明 `dsh.bundle.patch`；
//   ② 该 patch 文件存在且至少含一条 `insert` 条目；
//   ③ profile 的 `package.json` 把 `dsh-ide` 列进 `dsh.profile.bundles`。
// 任一缺失，重启后都不会加载（且不会有任何报错提示）。
// ---------------------------------------------------------------------------
const configIssues = [];

try {
	const installedPkg = JSON.parse(fs.readFileSync(path.join(installedRoot, 'package.json'), 'utf8'));
	const patchRel = installedPkg?.dsh?.bundle?.patch;
	if (typeof patchRel !== 'string' || patchRel === '') {
		configIssues.push('安装包 package.json 未声明 dsh.bundle.patch');
	} else {
		const patchPath = path.join(installedRoot, patchRel);
		if (!fs.existsSync(patchPath)) {
			configIssues.push(`patch 文件不存在: ${patchRel}`);
		} else if (!/-\s*insert:/.test(fs.readFileSync(patchPath, 'utf8'))) {
			configIssues.push(`patch 文件里没有 insert 条目: ${patchRel}`);
		}
	}
} catch (error) {
	configIssues.push(`读取安装包 package.json 失败: ${error.message}`);
}

try {
	const profilePkg = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
	const bundles = profilePkg?.dsh?.profile?.bundles;
	if (!Array.isArray(bundles) || !bundles.includes(PACKAGE_NAME)) {
		configIssues.push(`profile 的 dsh.profile.bundles 未包含 ${PACKAGE_NAME}`);
	}
} catch (error) {
	configIssues.push(`读取 profile package.json 失败: ${error.message}`);
}

console.log(`  装载配置链问题          : ${configIssues.length}`);
if (configIssues.length > 0) {
	for (const item of configIssues) { console.error(`  ✗ ${item}`); }
	console.error('');
	console.error('STATUS: FAIL  [install-drift] 文件一致但装载配置链不完整，重启后仍不会加载。');
	process.exit(1);
}

// ---------------------------------------------------------------------------
// 第 50 轮追加：检查 Host 入口能否被 Loader 装载。
// 文件对、配置对，仍可能因**语法错误或导出形状不符**而装载失败——且失败信息
// 往往淹没在启动日志里。这里做两项纯静态检查：
//   ① 已安装的全部 `.js`（index.js / client.js / host/**）能通过 `node --check`；
//   ② `index.js` 导出 `name` 与 `apply`（Cordis 插件的最小约定）。
// 注意：`node --check` 只验证语法，不执行模块；不评估运行时依赖是否可用。
// ---------------------------------------------------------------------------
const syntaxIssues = [];

/** 收集 host/ 下全部 .js，外加 index.js 与 client.js。 */
function collectJs(dir, out = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) { collectJs(full, out); continue; }
		if (entry.name.endsWith('.js')) { out.push(full); }
	}
	return out;
}

const jsFiles = [
	...collectJs(path.join(installedRoot, 'host')),
	path.join(installedRoot, 'index.js'),
	path.join(installedRoot, 'client.js'),
].filter(p => fs.existsSync(p));

for (const file of jsFiles) {
	try {
		execFileSync(process.execPath, ['--check', file], { stdio: 'ignore' });
	} catch {
		syntaxIssues.push(`语法错误: ${path.relative(installedRoot, file)}`);
	}
}

try {
	const indexSource = fs.readFileSync(path.join(installedRoot, 'index.js'), 'utf8');
	if (!/export\s+const\s+name\s*=/.test(indexSource)) { syntaxIssues.push('index.js 未导出 name'); }
	if (!/export\s+(?:async\s+)?function\s+apply\b/.test(indexSource)) { syntaxIssues.push('index.js 未导出 apply'); }
} catch (error) {
	syntaxIssues.push(`读取 index.js 失败: ${error.message}`);
}

console.log(`  入口语法/导出检查文件数  : ${jsFiles.length}`);
console.log(`  入口问题                : ${syntaxIssues.length}`);
if (syntaxIssues.length > 0) {
	for (const item of syntaxIssues) { console.error(`  ✗ ${item}`); }
	console.error('');
	console.error('STATUS: FAIL  [install-drift] 入口语法或导出形状不符合 Loader 约定，重启后会装载失败。');
	process.exit(1);
}

console.log('STATUS: PASS  [install-drift] 文件逐字节一致、装载配置链完整、入口语法与导出形状合规（注意：仍须重启 DSH 才算运行时加载）');
