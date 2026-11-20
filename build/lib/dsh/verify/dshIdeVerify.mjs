/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH-IDE 门禁入口（P1 建脚手架，随各阶段填充）。
// 本文件自己实现 protocol-single-source / boundary / projection-golden / contract，
// 以及把全部门禁（含独立脚本 localization / bundle-integrity / artifact / install-drift）
// 聚合成 release-gate。用法见文件末尾的 gates 表。
//
//   node build/lib/dsh/verify/dshIdeVerify.mjs <gate>
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

/**
 * 从本机 DSH 运行时元数据读已安装版本。
 *
 * 依据：DSH_HOME/dsh-runtimes/<name>/runtime.json 由 DSH 自己写，字段 desktopVersion。
 * 只在显式环境变量缺省时使用；读不到返回 undefined，由调用方保持 PENDING。
 */
function detectInstalledDshVersion() {
	const home = process.env['DSH_HOME'];
	if (typeof home !== 'string' || home === '') {
		return undefined;
	}
	const root = path.join(home, 'dsh-runtimes');
	let names;
	try {
		names = fs.readdirSync(root);
	} catch {
		return undefined;
	}
	for (const name of names) {
		try {
			const meta = JSON.parse(fs.readFileSync(path.join(root, name, 'runtime.json'), 'utf8'));
			const version = meta?.desktopVersion;
			if (typeof version === 'string' && version !== '') {
				return version;
			}
		} catch {
			// 单个运行时目录损坏不影响其它候选。
		}
	}
	return undefined;
}

const commonDir = 'platform/dshClient/common';
const protocolRel = `${commonDir}/dshIdeProtocol.ts`;
const contractRel = `${commonDir}/dshIdeContract.ts`;
const hostRel = 'platform/dshClient/host/ide-view-host.js';

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

	// 契约里的每个方法都必须有 Host 实现：有契约无实现 = 调用必然失败。
	// Host 混用两种写法（`async name(args)` 与 `name: async args =>`），两种都要认。
	const methodBlock = /export interface DshIdeMethodArgs \{([\s\S]*?)\n\}/.exec(protocol);
	assert.ok(methodBlock, 'DshIdeMethodArgs must be declared as an interface body');
	const contractMethods = [...methodBlock[1].matchAll(/^\t(\w+):/gm)].map(m => m[1]);
	assert.ok(contractMethods.length > 0, 'DshIdeMethodArgs must declare at least one method');
	const hostSource = read(hostRel);
	const missing = contractMethods.filter(method => {
		// 两种写法都认：`async name(args) {` 与 `name: async args => {`。
		const asMethod = new RegExp(`\\basync\\s+${method}\\s*\\(`);
		const asProperty = new RegExp(`\\b${method}\\s*:\\s*async\\b`);
		return !asMethod.test(hostSource) && !asProperty.test(hostSource);
	});
	assert.deepEqual(missing, [], `contract methods with no Host implementation: ${missing.join(', ')}`);

	console.log(`PASS  protocol-single-source: ${symbols.length} symbols declared once in ${protocolRel}; dependency one-way; no duplicate JS validator`);
	return 'PASS';
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
	// 通道仍只依赖窄接口：现在按连接创建一个视图，因此构造参数是返回 IdeViewHost 的工厂，
	// 而不是某个具体视图实例。两条断言一起保证「窄接口」这一约束没有被放宽。
	assert.match(channel, /constructor\([^)]*\(\)\s*=>\s*IdeViewHost[^)]*\)/,
		'DshIdeChannel constructor must take an IdeViewHost factory (one view per connection)');
	assert.doesNotMatch(channel, /\bDshIdeViewService\b/,
		'DshIdeChannel must not depend on the concrete view service');

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
	return 'PASS';
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
		binding: { viewId: 'projection-golden', generation: 1, sessionId: null },
		state: { state: 'ready', view: { frame: { type: 'event' }, conversation: view } },
	}), 'the projected conversation must satisfy the protocol contract');
	// 绑定是必填项：缺它或与通道不一致都必须被拒绝，不能静默接受无身份的快照。
	assert.throws(() => validateDshIdeSnapshot({
		wireRevision: DSH_IDE_WIRE_REVISION,
		channelId: 'projection-golden',
		version: 1,
		state: { state: 'ready', view: { frame: { type: 'event' }, conversation: view } },
	}), /DshIdeViewBinding/, 'a snapshot without a view binding must be rejected');

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
/**
 * 极简 semver 区间判断：只支持 manifest 实际使用的 `>=A <B` / `>` / `<=` 组合。
 *
 * 不引第三方依赖（门禁脚本必须能在裸 Node 下运行）；遇到不认识的运算符直接抛错，
 * 不静默放行——版本契约宁可显式失败，也不能「看不懂就当满足」。
 * @param {string} version 已安装版本
 * @param {string} range manifest 的 engines.dsh
 * @returns {boolean}
 */
function versionInRange(version, range) {
	const parse = v => {
		const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/.exec(String(v).trim());
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
	const compare = (a, b) => {
		for (let i = 0; i < 3; i++) {
			if (a.nums[i] !== b.nums[i]) { return a.nums[i] < b.nums[i] ? -1 : 1; }
		}
		return comparePre(a.pre, b.pre);
	};
	const target = parse(version);
	if (target === undefined) {
		throw new Error(`contract: 无法解析已安装版本 ${version}`);
	}
	const clauses = String(range).trim().split(/\s+/).filter(Boolean);
	if (clauses.length === 0) {
		throw new Error('contract: engines.dsh 为空');
	}
	for (const clause of clauses) {
		const m = /^(>=|<=|>|<|=)?(.+)$/.exec(clause);
		if (m === null) { throw new Error(`contract: 无法解析 engines.dsh 片段 ${clause}`); }
		const op = m[1] ?? '=';
		const bound = parse(m[2]);
		if (bound === undefined) { throw new Error(`contract: engines.dsh 中的版本 ${m[2]} 非法`); }
		const c = compare(target, bound);
		const ok = op === '>=' ? c >= 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : op === '<' ? c < 0 : c === 0;
		if (!ok) { return false; }
	}
	return true;
}

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

	// 会话归属：任何 Host 方法只要读了 `args.sessionId`，就必须在方法体内做过
	// `sessionIdOf(...)` / `assertVisibleRowForBridge(...)` / `assertOwnership(...)` 之一，
	// 或者把 sessionId 交给 `changeArchive` 这类已知会校验的下游函数。
	//
	// 依据 CHK-168：`jobList`/`jobKill` 曾直接透传 `args.sessionId` 调官方服务，
	// 任意 id 都能读/杀别的会话的后台作业。这条断言把那个缺口钉死。
	const hostText = read(hostRel);
	const hostLines = hostText.split('\n');
	const unguarded = [];
	let current = undefined;
	let guarded = false;
	for (const line of hostLines) {
		const start = /^\t\t(?:async )?([a-zA-Z]+)[:(]/.exec(line);
		if (start !== null) {
			if (current !== undefined && !guarded && current.usedSessionId) {
				unguarded.push(current.name);
			}
			current = { name: start[1], usedSessionId: false };
			guarded = false;
		}
		if (current === undefined) {
			continue;
		}
		if (/sessionIdOf\(|assertVisibleRowForBridge\(|assertOwnership\(|changeArchive\(/.test(line)) {
			guarded = true;
		}
		if (/args\.sessionId/.test(line)) {
			current.usedSessionId = true;
		}
	}
	if (current !== undefined && !guarded && current.usedSessionId) {
		unguarded.push(current.name);
	}
	assert.deepEqual(unguarded, [], `Host methods reading args.sessionId without an ownership check: ${unguarded.join(', ')}`);

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

	// 已安装版本优先取显式变量；缺省时从本机运行时元数据读。
	// 之前只认环境变量：本机装好了也永远 PENDING，门禁不跑就等于没有门禁。
	const installed = process.env['DSH_INSTALLED_VERSION'] || detectInstalledDshVersion();
	if (installed === undefined || installed === '') {
		console.log('PENDING(上游升级) contract: 4 个注入点指纹与基线一致；既未设置 DSH_INSTALLED_VERSION，也未找到本机运行时版本');
		console.log(`  设定 DSH_INSTALLED_VERSION（如 ${validated}）后，本门禁将比对版本并判定 PASS / FAIL（§9.3）`);
		return 'PENDING';
	}

	// manifest 声明的支持区间才是对外契约：`UPSTREAM_VALIDATED_VERSION` 只是「上次人工核对过」的下界。
	// 只比后者的旧实现会放行低于 engines.dsh 的宿主（例如 0.2.2-rc.1）和未来大版本（9.9.9）。
	const manifestPath = path.join(repoRoot, 'build', 'lib', 'dsh', 'package.json');
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	const engineRange = manifest?.engines?.dsh;
	if (typeof engineRange !== 'string' || engineRange === '') {
		throw new Error('build/lib/dsh/package.json must declare engines.dsh');
	}
	const inRange = versionInRange(installed, engineRange);
	if (!inRange) {
		throw new Error(`contract: 已安装版本 ${installed} 不满足 manifest engines.dsh ${JSON.stringify(engineRange)}`);
	}

	// 版本比对：契约文件 import 了 base/common/process.js（TS 相对导入），node 无法直接
	// 动态 import，因此这里按契约 `compareVersion` 的同一语义实现一份。
	// 关键点：prerelease 必须逐段按数字比较，不能把整段当字符串（否则 'rc.10' < 'rc.9'），
	// 这正是上一版的缺陷；改完后 `dshIdeContract.ts` 的 compareVersion 同步修正为同一规则。
	// 与 `dshIdeContract.ts` 的 `parseVersion` 保持**同一套严格规则**（SemVer 2.0.0）：
	// 主版本段不允许前导零，prerelease 段形状受限，build metadata（`+sha`）允许出现
	// 但不参与比较（§10）。两边口径不一致时，门禁会把运行时接受的版本判成非法，反之亦然。
	const parseVer = v => {
		const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/.exec(v.trim());
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
// 只读 RELEASE_GATES 里每一项的 STATUS，不改任何单条门禁的语义与退出码：
//   - 任一 FAIL 或任一命令退出码非 0 → 拒绝发布（退出 1）；
//   - 任一 PENDING → 拒绝发布（退出 1），因为 PENDING 不计入通过；
//   - 全部 PASS → 聚合通过（退出 0）。
// ---------------------------------------------------------------------------
// 发布级聚合必须覆盖**全部**门禁，不只是最早那四条。
// 第四十一轮发现这里硬编码了四项，导致 localization / bundle-integrity / artifact / install-drift
// 在发布检查里被静默跳过——「发布门禁通过」实际只覆盖了一半。
// 每项写成 [显示名, 调用方式]：本文件内的子命令传 `sub`，独立脚本传 `script`。
// 两种形态都要支持——localization 与 bundle-integrity 是独立入口，不是本文件的子命令。
const RELEASE_GATES = [
	['protocol-single-source', { sub: 'protocol-single-source' }],
	['boundary', { sub: 'boundary' }],
	['projection-golden', { sub: 'projection-golden' }],
	['contract', { sub: 'contract' }],
	['localization', { script: 'build/lib/dsh/verify/dshLocalizationAudit.mjs' }],
	['bundle-integrity', { script: 'build/lib/dsh/verify/dshBundleIntegrity.mjs' }],
	// 产物内容与安装一致性同样是发布前的必要条件：前者保证 tgz 里确实是这一版代码，
	// 后者保证 profile 里装的就是这个 tgz。缺任一条，「发布通过」都可能对应一个用户装不上的包。
	['artifact', { script: 'build/lib/dsh/verify/dshArtifactContents.mjs' }],
	['install-drift', { script: 'build/lib/dsh/verify/dshInstallDrift.mjs' }],
	// 单元测试也是发布前的必要条件：`verify:dsh-ide-ci` 一直把它算在聚合里，
	// 而 release-gate 早先漏了它——「发布通过」可能对应一个测试全红的包。
	['test-dsh:all', { npm: 'test-dsh:all' }],
];
function releaseGate() {
	const results = [];
	for (const [gate, invocation] of RELEASE_GATES) {
		let status = 'FAIL';
		let code = 1;
		// 三种调用形态：本文件子命令（`sub`）、独立脚本（`script`）、npm 脚本（`npm`）。
		// npm 脚本没有 `STATUS:` 行，只能按退出码判定：0 即 PASS。
		// Windows 上 npm 是 `npm.cmd`，`execFileSync` 直接调它拿不到退出码（status 为 null）。
		// npm 脚本必须经 shell 执行；其余两种形态仍是「node + 脚本路径」，不经 shell。
		const isNpm = invocation.npm !== undefined;
		const file = isNpm ? (process.platform === 'win32' ? 'npm.cmd' : 'npm') : process.execPath;
		const argv = invocation.npm !== undefined
			? ['run', invocation.npm]
			: invocation.script !== undefined
				? [path.join(repoRoot, invocation.script)]
				: [import.meta.filename, invocation.sub];
		try {
			const out = execFileSync(file, argv, {
				encoding: 'utf8',
				cwd: repoRoot,
				env: process.env,
				stdio: ['ignore', 'pipe', 'pipe'],
				...(isNpm ? { shell: true } : {}),
			});
			code = 0;
			status = isNpm ? 'PASS' : (/^STATUS:\s*(\S+)/m.exec(out)?.[1] ?? 'UNKNOWN');
		} catch (error) {
			code = typeof error.status === 'number' ? error.status : 1;
			const text = `${error.stdout ?? ''}${error.stderr ?? ''}`;
			status = isNpm ? 'FAIL' : (/^STATUS:\s*(\S+)/m.exec(text)?.[1] ?? 'FAIL');
		}
		results.push({ gate, status, code });
		console.log(`  ${gate}: ${status} (exit ${code})`);
	}

	const blocking = results.filter(result => result.code !== 0 || result.status !== 'PASS');
	if (blocking.length > 0) {
		// PENDING 与 FAIL 都拒绝发布，但原因不同：PENDING 是「未启用断言、不计通过」，
		// 不是失败也不是通过（§9.3 / §9.4 无歧义口径）。
		const reasons = blocking.map(result => `${result.gate}=${result.status}(exit ${result.code})`).join(', ');
		throw new Error(`release refused: ${reasons} — 发布聚合要求全部门禁 PASS（PENDING 不计入通过）`);
	}
	console.log(`PASS  release-gate: ${results.length} gates all PASS (${RELEASE_GATES.map(([name]) => name).join(', ')})`);
	return 'PASS';
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
	console.log(`STATUS: ${status ?? 'FAIL'}  [${gate}]`);
	// 未返回状态按 FAIL 处理：忘记 return 的新门禁不得被当成通过。
	// PENDING 也以非零退出：直接调用者（shell &&、CI step、npm script）必须能看到「没有证据」。
	if (status === 'PENDING') {
		process.exit(2);
	}
	if (status !== 'PASS') {
		process.exit(1);
	}
} catch (err) {
	console.error(`STATUS: FAIL  [${gate}]`);
	console.error(err?.message ?? err);
	process.exit(1);
}
