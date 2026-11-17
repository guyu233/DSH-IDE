/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH-IDE 四条门禁（P1 建脚手架，随各阶段填充）。
//
//   node build/lib/dsh/verify/dshIdeVerify.mjs <gate>
//   gate ∈ protocol-single-source | boundary | projection-golden | contract
//
// 状态语义（诚实标注，不假装修复/通过）：
//   PASS    —— 门禁已实现且检查通过
//   PENDING —— 该门禁依赖后续阶段产物，脚手架已就位但未启用断言
//   FAIL    —— 检查失败，退出码 1

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as zlib from 'node:zlib';

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
// 1. verify:dsh-ide-protocol-single-source  —— P1 强制门禁，已实现
// ---------------------------------------------------------------------------
function protocolSingleSource() {
	const protocol = read(protocolRel);
	const contract = read(contractRel);

	// 协议符号只允许在 dshIdeProtocol.ts 声明一次（TS 侧唯一真源）。
	const symbols = [
		'DSH_IDE_CHANNEL', 'DSH_IDE_API_VERSION', 'DSH_IDE_WIRE_REVISION',
		'DSH_IDE_FEATURE_UNAVAILABLE', 'DSH_IDE_INVALID_ARGUMENT',
		'DshRemoteError', 'IDshIdeSessionSummary', 'DshIdeViewState', 'DshIdeSnapshot',
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
// 2. verify:dsh-ide-boundary  —— P1 基础检查 + P4 完整 UI 隔离断言；P3 起 listen 三层过滤已启用
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
	// 门禁仍绿」——这与 tsc 过滤列表硬编码同族。
	// 排除：test/（测试可用测试设施）；Host 侧 JS 桥接层（host/ide-service.js、index.js、
	// client/client.js）合法持有 Cordis 与官方包，且非 .ts，不在本扫描范围。
	// 目录扫描而非文件名白名单：新增目录自动纳入，避免「新建文件漏检、门禁仍绿」。
	// transport/ 是 IDE 侧官方传输适配（P3），同样必须零 electron / Cordis 引用。
	const pluginSources = [
		...walk(path.join(srcRoot, 'platform/dshClient/common')),
		...walk(path.join(srcRoot, 'platform/dshClient/electron-main')),
		...walk(path.join(srcRoot, 'platform/dshClient/transport')),
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

	// 单一收听（D78）：会话内容只由内核调一次 `sessionController.follow`；
	// 窗口只消费内核的 `ide/followSession`，不得自己开 `session/follow` / `$events`，
	// 不得把 prompt / cancel / selectModel 重写成 `session/*` 请求，也不得再自带 translator/projector。
	const transport = read('platform/dshClient/transport/dshIdeTransport.ts');
	const hostBridge = read('platform/dshClient/host/ide-view-host.js');
	assert.match(hostBridge, /controller\.follow\(\{[\s\S]*?assistantStream: true/, 'the kernel must call sessionController.follow with assistantStream');
	// 调用现在跨多行（follow 多了 onDisconnect 参数），断言按「出现该端点」匹配。
	assert.match(transport, /'ide\/followSession'/, 'the window must follow through the kernel stream');
	assert.doesNotMatch(transport, /openStream\('session\/follow'/, 'the window must not open session/follow itself');
	assert.doesNotMatch(transport, /openStream\('\$events'/, 'the window must not open the $events stream itself');
	assert.doesNotMatch(transport, /call\('session', '(?:prompt|cancel|selectModel)'/, 'the window must not rewrite operations into session/* requests');
	assert.match(transport, /call\('ide', 'dispatch'/, 'the window must hand operations to ide/dispatch');
	assert.ok(!fs.existsSync(path.join(srcRoot, 'platform/dshClient/common/translator.ts')), 'the TUI translator must not come back');
	assert.ok(!fs.existsSync(path.join(srcRoot, 'platform/dshClient/common/ide-view-projector.ts')), 'the TUI projector must not come back');

	// listen 三层过滤（P3 启用）：事件名白名单 / 连接归属 / version 严格递增必须同时在代码里存在。
	const listenBody = /listen<T>\(([\s\S]*?)\n\t}/.exec(channel);
	assert.ok(listenBody !== null, 'DshIdeChannel.listen must be implemented (not a stub)');
	// 白名单三个事件：snapshot（版本帧）、waterfall（审批/问卷）、session-notice（运行态）。
	// 三个都要出现在同一个 reject 条件里，缺一个就等于把未知事件当成已知事件放行。
	assert.match(channel, /if \(event !== DSH_IDE_SNAPSHOT_EVENT && event !== DSH_IDE_WATERFALL_EVENT && event !== DSH_IDE_SESSION_NOTICE_EVENT\)/,
		'listen must gate Event.None behind the snapshot, waterfall and session-notice whitelist');
	assert.match(channel, /DSH_IDE_SNAPSHOT_EVENT/, 'listen must whitelist the snapshot event name');
	assert.match(channel, /emitted => emitted\.ctx === ctx/, 'listen must filter frames by owning connection');
	assert.match(channel, /snapshot\.version <= sent/, 'publish path must drop non-advancing versions');

	// 通道分发（P3 启用）：call() 不得再无条件 reject，必须走 validateDshIdeInput + 出参校验。
	assert.doesNotMatch(channel, /return Promise\.reject\(\{[\s\S]*?FEATURE_UNAVAILABLE[\s\S]*?\}\) as unknown as Promise<T>/,
		'DshIdeChannel.call must dispatch instead of rejecting every command');
	assert.match(channel, /validateDshIdeInput/, 'call must validate inputs with the protocol validator');
	assert.match(channel, /validateDshIdeInvokeOutput/, 'call must validate the { value } output contract');

	// 聊天渲染层隔离：帧解码与面板只依赖平台 DTO 与 VS Code 既有模块，
	// 既不能 import DSH 包（上面已扫），也不能反向依赖主进程/通道层。
	const uiProjectionFiles = [
		'workbench/contrib/dsh/browser/dshIdeConsumer.ts',
		'workbench/contrib/dsh/browser/dshChatModel.ts',
		'workbench/contrib/dsh/browser/dshChatSession.ts',
	];
	for (const file of uiProjectionFiles) {
		const text = read(file);
		assert.doesNotMatch(text, /from\s+['"][^'"]*\/electron-main\//,
			`${file} must not depend on the electron-main layer`);
		assert.doesNotMatch(text, /from\s+['"]@deepseek-ai\//,
			`${file} must not import DSH runtime packages`);
	}
	// 消费者必须是唯一做帧校验的地方：通道层不得重复实现（单一实现纪律，第 2 章 §9）。
	assert.match(read(uiProjectionFiles[0]), /validateDshIdeSnapshot/,
		'DshIdeConsumer must validate frames (it is the single validation point)');
	const channelForValidation = read('platform/dshClient/electron-main/dshIdeChannel.ts');
	assert.doesNotMatch(channelForValidation, /validateDshIdeSnapshot/,
		'the channel must not duplicate frame validation — that belongs to the consumer');
}

// ---------------------------------------------------------------------------
// 3. verify:dsh-ide-projection-golden  —— typed 投影金标准
//
// 会话帧不再翻译成另一套行，但 Host 侧确实有一层投影：`dshIdeConversation.ts`
// 把官方事件装配成 `DshIdeConversationNode[]`。本门禁用一组金标准事件回放该投影，
// 断言每个节点都过协议校验，且关键事实（子代理发现 / 结算通知）不被丢掉。
// ---------------------------------------------------------------------------
async function projectionGolden() {
	const projectPath = pathToFileURL(path.join(repoRoot, 'src/vs/platform/dshClient/common/dshIdeConversation.ts')).href;
	const protocolPath = pathToFileURL(path.join(repoRoot, 'src/vs/platform/dshClient/common/dshIdeProtocol.ts')).href;
	const { createDshIdeConversationState, projectDshIdeConversation } = await import(projectPath);
	const { validateDshIdeSnapshot, DSH_IDE_WIRE_REVISION } = await import(protocolPath);

	const events = [
		{ seq: 1, time: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] } },
		{ seq: 2, time: 2, type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'hello' }] }, usage: { inputTokens: 10, outputTokens: 2 } } },
		{ seq: 3, time: 3, type: 'subagent/catalog', data: { childId: 'child-1', childCreatedAt: 5, mode: 'continuable', label: 'reviewer', name: 'reviewer', version: 3 } },
		{ seq: 4, time: 4, type: 'user/message', data: { source: { kind: 'subagent-settled' }, content: [{ type: 'text', text: 'relay' }] } },
		{ seq: 5, time: 5, type: 'deliverables/presented', data: { turn: 1, callId: 'present-1', files: [{ path: 'docs/a.md' }] } },
	];

	const state = createDshIdeConversationState();
	const view = { hasMore: false, nodes: [] };
	for (const event of events) {
		const next = projectDshIdeConversation(state, { type: 'event', event });
		assert.ok(next !== undefined, `projection must return a view for ${event.type}`);
		view.nodes = next.nodes;
	}

	// 每个投影结果都必须过协议真源的校验（fail-closed）。
	assert.doesNotThrow(() => validateDshIdeSnapshot({
		wireRevision: DSH_IDE_WIRE_REVISION,
		channelId: 'projection-golden',
		version: 1,
		state: { state: 'ready', view: { frame: { type: 'event' }, conversation: view } },
	}), 'the projected conversation must satisfy the protocol contract');

	const kinds = view.nodes.map(node => node.kind);
	assert.deepEqual(kinds, ['user', 'assistant', 'subagent-catalog', 'subagent-notice'],
		'projection must keep the user message, the assistant reply, the subagent catalog fact and the settlement notice');

	// 子代理发现事实必须原样保留名字，不能只留一个空节点。
	const catalog = view.nodes.find(node => node.kind === 'subagent-catalog');
	assert.equal(catalog?.name, 'reviewer', 'subagent catalog must keep the child name');

	// 投影节点不得携带原始事件（raw 不进线协议）。
	for (const node of view.nodes) {
		assert.equal(Object.hasOwn(node, 'raw'), false, 'projected nodes must not carry raw');
	}

	console.log(`projection-golden: ${view.nodes.length} 个金标准节点全部通过协议校验（含子代理发现与结算通知）`);
	return 'PASS';
}

// ---------------------------------------------------------------------------
// 4. verify:dsh-ide-contract  —— 上游升级时启用失败门禁；P1 建立脚手架
// ---------------------------------------------------------------------------
function contract() {
	const text = read(contractRel);
	for (const symbol of ['UPSTREAM_VALIDATED_VERSION', 'BLESSED_PACKAGES', 'installedMeetsVersion', 'upstreamDrift', 'VSCODE_PATCH_POINTS']) {
		assert.match(text, new RegExp(`export\\s+(?:const|function|interface)\\s+${symbol}\\b`), `dshIdeContract.ts must export ${symbol}`);
	}

	// VSCODE_PATCH_POINTS 指纹（第 62 轮启用失败断言，D26）。
	//
	// 每个注入点在契约里带 `sha256`（基线，前 16 位）。这里对实际文件重算并**逐点比对**：
	//   - 不一致 → 说明该文件内容已偏离基线（上游改动或本仓库误改），注入点需要重新核对；
	//   - 缺失   → 文件被移走/改名，注入点已失效。
	// 二者都会让门禁 FAIL，而不是只打印一串无人比对的哈希。
	//
	// 关于「上游未升级时是否该 FAIL」：`UPSTREAM_VALIDATED_VERSION` 记录的是**已核对过的**
	// 上游版本。基线指纹即在该版本下确立，因此本地不匹配就是真实的漂移，应当失败。
	const files = [...text.matchAll(/\bfile:\s*'([^']+)'/g)].map(m => m[1]);
	assert.equal(files.length, 4, `VSCODE_PATCH_POINTS must contain 4 injection points, got ${files.length}`);

	const baselines = [...text.matchAll(/\bsha256:\s*'([0-9a-f]{16})'/g)].map(m => m[1]);
	assert.equal(baselines.length, 4, `VSCODE_PATCH_POINTS must carry 4 sha256 baselines, got ${baselines.length}`);

	const mismatches = [];
	const report = files.map((f, i) => {
		const abs = path.join(repoRoot, f);
		if (!fs.existsSync(abs)) {
			mismatches.push(`${f}: 文件缺失`);
			return `  ${f}  MISSING`;
		}
		const actual = createHash('sha256').update(fs.readFileSync(abs)).digest('hex').slice(0, 16);
		const expected = baselines[i];
		if (actual !== expected) {
			mismatches.push(`${f}: 基线 ${expected} ≠ 实际 ${actual}`);
		}
		return `  ${f}  ${actual}${actual === expected ? '' : '  <-- 与基线不符'}`;
	});

	console.log(`  validated=${/UPSTREAM_VALIDATED_VERSION\s*=\s*'([^']+)'/.exec(text)?.[1] ?? '?'}`);
	console.log(report.join('\n'));

	if (mismatches.length > 0) {
		throw new Error(`VSCODE_PATCH_POINTS 指纹与基线不符（${mismatches.length} 处）：\n    ${mismatches.join('\n    ')}\n  处置：按第 5 章 §7 核对上游改动，确认后更新契约里的 sha256 基线并记录原因。`);
	}

	// ---------------------------------------------------------------------
	// 第 68 轮：按 §9.3「何时变 PASS / FAIL」启用**完整**失败断言。
	//
	// §9.3 原文：P6 中把 contract() 改为启用失败断言——比对
	// `installedMeetsVersion()` / `upstreamDrift()` 与 `UPSTREAM_VALIDATED_VERSION`、
	// 比对 4 个注入点 sha256 与冻结基线。全部相符 → PASS；任一不符 → FAIL。
	//
	// 第 62 轮已做后者（指纹）；本轮补前者（版本）。已安装版本取自
	// `DSH_INSTALLED_VERSION`，与契约里 `upstreamDrift()` 的口径一致；
	// **未设置该变量时视为无法证明相符**，按 §9.3 不得判 PASS，保持 PENDING。
	// ---------------------------------------------------------------------
	const validated = /UPSTREAM_VALIDATED_VERSION\s*=\s*'([^']+)'/.exec(text)?.[1];
	if (validated === undefined) {
		throw new Error('dshIdeContract.ts must declare UPSTREAM_VALIDATED_VERSION');
	}

	const installed = process.env['DSH_INSTALLED_VERSION'];
	if (installed === undefined || installed === '') {
		console.log('PENDING(上游升级) contract: 4 个注入点指纹与基线一致；未设置 DSH_INSTALLED_VERSION，无法证明已安装版本 ≥ 校验版本');
		console.log(`  设定 DSH_INSTALLED_VERSION（如 ${validated}）后，本门禁将比对版本并判定 PASS / FAIL（§9.3）`);
		return 'PENDING';
	}

	// 版本比对：契约文件 import 了 base/common/process.js（TS 相对导入），node 无法直接
	// 动态 import，因此这里按契约 `compareVersion` 的同一语义实现一份。
	// 关键点：prerelease 必须逐段按数字比较，不能把整段当字符串（否则 'rc.10' < 'rc.9'），
	// 这正是上一版的缺陷；改完后 `dshIdeContract.ts` 的 compareVersion 同步修正为同一规则。
	const parseVer = v => {
		const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v.trim());
		if (m === null) { return undefined; }
		return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? '' };
	};
	const comparePre = (x, y) => {
		if (x === y) { return 0; }
		if (x === '') { return 1; }
		if (y === '') { return -1; }
		const px = x.split('.');
		const py = y.split('.');
		for (let i = 0; i < Math.max(px.length, py.length); i++) {
			const u = px[i];
			const v = py[i];
			if (u === undefined) { return -1; }
			if (v === undefined) { return 1; }
			const un = /^\d+$/.test(u);
			const vn = /^\d+$/.test(v);
			if (un && vn) {
				const diff = Number(u) - Number(v);
				if (diff !== 0) { return diff < 0 ? -1 : 1; }
				continue;
			}
			if (un) { return -1; }
			if (vn) { return 1; }
			if (u !== v) { return u < v ? -1 : 1; }
		}
		return 0;
	};
	const pa = parseVer(installed);
	const pb = parseVer(validated);
	if (pa === undefined || pb === undefined) {
		throw new Error(`contract: 无法解析版本（installed=${installed} validated=${validated}）`);
	}
	let meets = 0;
	for (let i = 0; i < 3; i++) {
		if (pa.nums[i] !== pb.nums[i]) { meets = pa.nums[i] < pb.nums[i] ? -1 : 1; break; }
	}
	if (meets === 0) {
		meets = comparePre(pa.pre, pb.pre);
	}
	if (meets < 0) {
		throw new Error(`contract: 已安装版本 ${installed} 低于经校验版本 ${validated}（upstreamDrift=true）`);
	}

	console.log(`contract: 4 个注入点指纹与基线一致；已安装版本 ${installed} ≥ 经校验版本 ${validated}`);
	return 'PASS';
}

// ---------------------------------------------------------------------------
// 5. verify:dsh-ide-release-gate  —— §9.4 发布级状态聚合检查（D57）
//
// 只读四条门禁的 STATUS，不改任何单条门禁的语义与退出码：
//   - 任一 FAIL 或任一命令退出码非 0 → 拒绝发布（退出 1）；
//   - 任一 PENDING → 拒绝发布（退出 1），因为 PENDING 不计入通过；
//   - 全部 PASS → 聚合通过（退出 0）。
// ---------------------------------------------------------------------------
const RELEASE_GATES = ['protocol-single-source', 'boundary', 'projection-golden', 'contract'];

function releaseGate() {
	const results = [];
	for (const gate of RELEASE_GATES) {
		let status = 'FAIL';
		let code = 1;
		try {
			const out = execFileSync(process.execPath, [import.meta.filename, gate], { encoding: 'utf8', cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
			code = 0;
			status = /^STATUS:\s*(\S+)/m.exec(out)?.[1] ?? 'UNKNOWN';
		} catch (error) {
			code = typeof error.status === 'number' ? error.status : 1;
			const text = `${error.stdout ?? ''}${error.stderr ?? ''}`;
			status = /^STATUS:\s*(\S+)/m.exec(text)?.[1] ?? 'FAIL';
		}
		results.push({ gate, status, code });
		console.log(`  ${gate}: ${status} (exit ${code})`);
	}

	const blocking = results.filter(result => result.code !== 0 || result.status !== 'PASS');
	if (blocking.length > 0) {
		// PENDING 与 FAIL 都拒绝发布，但原因不同：PENDING 是「未启用断言、不计通过」，
		// 不是失败也不是通过（§9.3 / §9.4 无歧义口径）。
		const reasons = blocking.map(result => `${result.gate}=${result.status}(exit ${result.code})`).join(', ');
		throw new Error(`release refused: ${reasons} — 发布聚合要求四条门禁全部 PASS（PENDING 不计入通过）`);
	}
	console.log(`PASS  release-gate: ${results.length} gates all PASS (${RELEASE_GATES.join(', ')})`);
}

// ---------------------------------------------------------------------------

const gates = {
	'protocol-single-source': protocolSingleSource,
	'boundary': boundary,
	'projection-golden': projectionGolden,
	'contract': contract,
	'release-gate': releaseGate,
};

const gate = process.argv[2];
if (!gate || !Object.hasOwn(gates, gate)) {
	console.error(`usage: dshIdeVerify.mjs <${Object.keys(gates).join(' | ')}>`);
	process.exit(2);
}

try {
	// 部分门禁（projection-golden）需要动态 import TS 模块，返回 Promise。
	const status = await gates[gate]();
	console.log(`STATUS: ${status ?? 'PASS'}  [${gate}]`);
} catch (err) {
	console.error(`STATUS: FAIL  [${gate}]`);
	console.error(err?.message ?? err);
	process.exit(1);
}
