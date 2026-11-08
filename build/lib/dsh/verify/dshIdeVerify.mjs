/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH-IDE 四条门禁（阶段 2.1 建脚手架，随各步填充）。
//
//   node build/lib/dsh/verify/dshIdeVerify.mjs <gate>
//   gate ∈ protocol-single-source | boundary | projection-golden | contract
//
// 状态语义（诚实标注，不假装修复/通过）：
//   PASS    —— 门禁已实现且检查通过（2.1 仅 protocol-single-source / boundary 可达）
//   PENDING —— 该门禁依赖后续阶段产物，脚手架已就位但未启用断言
//   FAIL    —— 检查失败，退出码 1

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const srcRoot = path.join(repoRoot, 'src/vs');
const commonDir = 'platform/dshClient/common';
const protocolRel = `${commonDir}/dshIdeProtocol.ts`;
const contractRel = `${commonDir}/dshIdeContract.ts`;

function walk(dir, out = []) {
	if (!fs.existsSync(dir)) { return out; }
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) { walk(full, out); }
		else { out.push(full); }
	}
	return out;
}

function read(rel) {
	return fs.readFileSync(path.join(srcRoot, rel), 'utf8');
}

function rel(p) {
	return path.relative(srcRoot, p).replaceAll('\\', '/');
}

function countMatches(text, re) {
	return [...text.matchAll(re)].length;
}

// ---------------------------------------------------------------------------
// 1. verify:dsh-ide-protocol-single-source  —— 2.1 强制门禁，已实现
// ---------------------------------------------------------------------------
function protocolSingleSource() {
	const protocol = read(protocolRel);
	const contract = read(contractRel);

	// 协议符号只允许在 dshIdeProtocol.ts 声明一次（TS 侧唯一真源）。
	const symbols = [
		'DSH_IDE_CHANNEL', 'DSH_IDE_API_VERSION', 'DSH_IDE_WIRE_REVISION',
		'DSH_IDE_FEATURE_UNAVAILABLE', 'DSH_IDE_INVALID_ARGUMENT',
		'DshRemoteError', 'DshIdeViewState', 'DshIdeSnapshot',
		'DshIdeMethodArgs', 'DshIdeMethod', 'IdeViewHost',
		'exactRecord', 'jsonValue', 'validateDshIdeInput',
		'validateDshIdeInvokeOutput', 'validateDshIdeSnapshot',
		'assertSnapshotContinuity',
	];

	// 扫描范围限定在 DSH-IDE 插件作用域：上游自带同名导出（如 platform/github 的
	// jsonValue）不属于本协议，不应误判为重复声明。
	const scopedRoots = [
		path.join(srcRoot, 'platform/dshClient'),
		path.join(srcRoot, 'workbench/contrib/dsh'),
		path.join(srcRoot, 'workbench/browser/parts'),
	];
	const allTs = scopedRoots.flatMap(r => walk(r)).filter(f => f.endsWith('.ts'));
	for (const symbol of symbols) {
		const declRe = new RegExp(`\\bexport\\s+(?:declare\\s+)?(?:function|const|interface|type|class|enum)\\s+${symbol}\\b`, 'g');
		const declaring = [];
		let total = 0;
		for (const file of allTs) {
			const n = countMatches(fs.readFileSync(file, 'utf8'), declRe);
			if (n > 0) {
				declaring.push(rel(file));
				total += n;
			}
		}
		assert.equal(total, 1, `${symbol} must be declared exactly once (found ${total} in ${declaring.join(', ')})`);
		assert.deepEqual(declaring, [protocolRel], `${symbol} must be declared only in ${protocolRel}`);
	}

	// 依赖方向单向：contract → protocol，protocol 绝不 import contract。
	// 只匹配真实 import/require 语句；注释中「本文件不引用 contract」的陈述不算违规。
	const reverseImport = /\b(?:import|export)\b[^;\n]*\bdshIdeContract\b|\brequire\(['"][^'"]*dshIdeContract[^'"]*['"]\)/;
	assert.doesNotMatch(protocol, reverseImport, `${protocolRel} must not import dshIdeContract.ts`);
	assert.match(contract, /from '\.\/dshIdeProtocol\.js'/, `${contractRel} must import protocol constants`);

	// TS/JS 校验器同源：dshClient 下不存在第二份 JS 校验器定义。
	const jsFiles = walk(path.join(srcRoot, 'platform/dshClient')).filter(f => /\.(?:js|mjs)$/.test(f));
	for (const file of jsFiles) {
		const text = fs.readFileSync(file, 'utf8');
		assert.doesNotMatch(text, /\b(?:function|const|let)\s+(?:exactRecord|jsonValue|validateDshIde\w+)\b/,
			`duplicate JS validator in ${rel(file)} — protocol must be the single source`);
	}

	console.log(`PASS  protocol-single-source: ${symbols.length} symbols declared once in ${protocolRel}; dependency one-way; no duplicate JS validator`);
}

// ---------------------------------------------------------------------------
// 2. verify:dsh-ide-boundary  —— 2.4 填充完整 UI 隔离断言；基础检查 2.1 已启用
// ---------------------------------------------------------------------------
function boundary() {
	// workbench/** 零 @deepseek-ai/* import（DTO → IChatProgress 的 UI 投影层不 import DSH 包）。
	const workbenchTs = walk(path.join(srcRoot, 'workbench')).filter(f => f.endsWith('.ts'));
	const dshImports = [];
	for (const file of workbenchTs) {
		const text = fs.readFileSync(file, 'utf8');
		if (/from\s+['"]@deepseek-ai\//.test(text) || /require\(['"]@deepseek-ai\//.test(text)) {
			dshImports.push(rel(file));
		}
	}
	assert.deepEqual(dshImports, [], `workbench/** must not import @deepseek-ai/*: ${dshImports.join(', ')}`);

	// channel 零 Cordis Context 引用：构造只接收 IdeViewHost 窄接口。
	// 注意：IServerChannel.call/listen 的 ctx: string 是 IPC 连接层上下文，合法，不在禁止之列。
	const channel = read('platform/dshClient/electron-main/dshIdeChannel.ts');
	assert.doesNotMatch(channel, /\bCordis\b|\bCordisContext\b|\bdshCtx\b|apply\s*\(\s*ctx\s*\)/,
		'DshIdeChannel must not depend on Cordis Context');
	assert.match(channel, /constructor\([^)]*IdeViewHost[^)]*\)/,
		'DshIdeChannel constructor must take the IdeViewHost narrow interface');

	// 插件侧 TS 生产文件零 electron / DSH 运行时包 / Cordis Context 直接引用。
	// 范围由**目录扫描**决定，不维护文件名白名单：新增 .ts 自动纳入，避免「新建文件漏检、
	// 门禁仍绿」——这与 tsc 过滤列表硬编码同族（见 docs/DEVELOPMENT.md 第 7 章）。
	// 排除：test/（测试可用测试设施）；Host 侧 JS 桥接层（host/ide-service.js、index.js、
	// client/client.js）合法持有 Cordis 与官方包，且非 .ts，不在本扫描范围。
	const pluginSources = [
		...walk(path.join(srcRoot, 'platform/dshClient/common')),
		...walk(path.join(srcRoot, 'platform/dshClient/electron-main')),
	].filter(f => f.endsWith('.ts') && !rel(f).includes('/test/')).map(rel).sort();
	assert.ok(pluginSources.length >= 6, `plugin source sweep found only ${pluginSources.length} .ts files`);
	for (const file of pluginSources) {
		const text = read(file);
		assert.doesNotMatch(text, /from\s+['"]electron['"]|require\(['"]electron['"]\)|\bElectron\.|\bBrowserWindow\b|\bipcMain\b/,
			`${file} must not directly reference electron APIs`);
		assert.doesNotMatch(text, /from\s+['"]@deepseek-ai\//,
			`${file} must not import @deepseek-ai/* runtime packages`);
		assert.doesNotMatch(text, /\bCordisContext\b|\bdshCtx\b|apply\s*\(\s*ctx\s*\)/,
			`${file} must not depend on Cordis Context`);
	}

	console.log(`PASS  boundary: workbench/** zero @deepseek-ai/* imports (${workbenchTs.length} files); channel zero Cordis ctx; ${pluginSources.length} plugin sources zero electron/@deepseek-ai/*/Cordis refs`);
	console.log('      PENDING(2.4): DTO → IChatProgress UI 投影层隔离断言、listen 三层过滤断言');
}

// ---------------------------------------------------------------------------
// 3. verify:dsh-ide-projection-golden  —— 2.2a 已实现（真实回放比对）
// ---------------------------------------------------------------------------
function projectionGolden() {
	const goldenDir = path.join(import.meta.dirname, 'golden');
	const fixtures = fs.existsSync(goldenDir) ? walk(goldenDir).filter(f => f.endsWith('.json')) : [];
	assert.ok(fixtures.length > 0, 'no golden fixtures: 2.2a must provide at least one golden/*.json');

	// 子进程以 strip-types 加载插件侧真实 translator/projector（不复制实现、不伪造比对）。
	const common = path.join(srcRoot, 'platform/dshClient/common');
	const translatorUrl = pathToFileURL(path.join(common, 'translator.ts')).href;
	const projectorUrl = pathToFileURL(path.join(common, 'ide-view-projector.ts')).href;

	for (const fixturePath of fixtures) {
		const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
		const body = [
			`import { translateAll } from ${JSON.stringify(translatorUrl)};`,
			`import { projectIdeView } from ${JSON.stringify(projectorUrl)};`,
			`import { readFileSync } from 'node:fs';`,
			`const fx = JSON.parse(readFileSync(${JSON.stringify(fixturePath)}, 'utf8'));`,
			`process.stdout.write(JSON.stringify(projectIdeView(translateAll(fx.events))));`,
		].join('\n');
		const out = execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', body], {
			encoding: 'utf8',
			cwd: repoRoot,
		});
		const actual = JSON.parse(out);
		assert.equal(
			JSON.stringify(actual),
			JSON.stringify(fixture.expected),
			`golden mismatch: ${path.basename(fixturePath)} — 投影器输出与冻结快照不一致（改动投影器须同步更新 golden）`,
		);
		assert.ok(Array.isArray(fixture.events) && fixture.events.length > 0, `${path.basename(fixturePath)} must carry a mock event stream`);
	}

	console.log(`PASS  projection-golden: ${fixtures.length} fixture(s) replayed against ${path.relative(repoRoot, common)}/translator.ts + ide-view-projector.ts, byte-exact match`);
	console.log('      PENDING(2.5): 真实事件流 P95 字节数校准（见 docs/DEVELOPMENT.md 第 5 章 §5，参数校准非架构回退）');
}

// ---------------------------------------------------------------------------
// 4. verify:dsh-ide-contract  —— 上游升级时启用失败门禁；2.1 建立脚手架
// ---------------------------------------------------------------------------
function contract() {
	const text = read(contractRel);
	for (const symbol of ['UPSTREAM_VALIDATED_VERSION', 'BLESSED_PACKAGES', 'installedMeetsVersion', 'upstreamDrift', 'VSCODE_PATCH_POINTS']) {
		assert.match(text, new RegExp(`export\\s+(?:const|function|interface)\\s+${symbol}\\b`), `dshIdeContract.ts must export ${symbol}`);
	}

	// VSCODE_PATCH_POINTS 指纹：4 个注入点，记录目标文件 sha256（上游升级时与基线比对）。
	const files = [...text.matchAll(/\bfile:\s*'([^']+)'/g)].map(m => m[1]);
	assert.equal(files.length, 4, `VSCODE_PATCH_POINTS must contain 4 injection points, got ${files.length}`);
	const fingerprints = files.map(f => {
		const abs = path.join(repoRoot, f);
		const hash = fs.existsSync(abs)
			? createHash('sha256').update(fs.readFileSync(abs)).digest('hex').slice(0, 16)
			: 'MISSING';
		return `  ${f}  ${hash}`;
	});
	console.log('PENDING(上游升级) contract: 脚手架就位，以下为首次指纹基线（升级时做失败门禁）：');
	console.log(`  validated=${/UPSTREAM_VALIDATED_VERSION\s*=\s*'([^']+)'/.exec(text)?.[1] ?? '?'}`);
	console.log(fingerprints.join('\n'));
	return 'PENDING';
}

// ---------------------------------------------------------------------------

const gates = {
	'protocol-single-source': protocolSingleSource,
	'boundary': boundary,
	'projection-golden': projectionGolden,
	'contract': contract,
};

const gate = process.argv[2];
if (!gate || !Object.hasOwn(gates, gate)) {
	console.error(`usage: dshIdeVerify.mjs <${Object.keys(gates).join(' | ')}>`);
	process.exit(2);
}

try {
	const status = gates[gate]();
	console.log(`STATUS: ${status ?? 'PASS'}  [${gate}]`);
} catch (err) {
	console.error(`STATUS: FAIL  [${gate}]`);
	console.error(err?.message ?? err);
	process.exit(1);
}
