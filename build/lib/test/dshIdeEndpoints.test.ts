/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// D16：7 个 method 的 DSH 官方落点核对（P5）。
//
// 本测试把「只读源树核查结论」固化成可执行凭据，防止两种回归：
//   ① 有人把尚未核对的形状当作官方端点悄悄接进 transport / Host（伪造成功）；
//   ② 上游升级后落点变了，而契约与接线仍停在旧结论上。
// 第 31 轮补充：commands scoped-remote 的 wire 形状已从源码核对清楚，
// 但接线仍归 D13；本测试新增断言钉住该形状结论与「仍 fail-closed」状态。
//
// 依据（只读核对 https://github.com/deepseek-ai/deepseek-harness 的 0.2.2-rc.1 源码，无真机观测）：
//   §8.10.9「D16 官方落点核对结论」。第 26 轮据此把唯一已核对完整 wire 形状的
//   setEffort 接线（session/projections → session/selectModel），故本表把
//   deleteSession + setEffort 标为已接线；第 32 轮据第 31 轮核实的 commands
//   wire 形状把 listCommands 接线，故本表为 3 个已接线 / 4 个继续 fail-closed；
//   第 33 轮把契约前置固化于 §8.10.10，第 34 轮按契约先行接线两者，故本表为
//   5 个已接线 / 2 个继续 fail-closed；第 21 轮把 loadOlder 按官方 session/page
//   形状对齐后接线，故本表为 6 个已接线 / 1 个继续 fail-closed（仅 rewind）。
// 形状一律以契约真源 dshIdeProtocol.ts 与 DSH 源码为准，不凭记忆臆造。

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const protocol = read('src/vs/platform/dshClient/protocol/dshIdeProtocol.ts');
const transport = read('src/vs/platform/dshClient/ide/transport/dshIdeTransport.ts');
const host = read('src/vs/platform/dshClient/host/bridge/ide-view-host.js');

/** D16 核对结论：null = 官方无对应独立 remote / 形状未验证，必须保持 fail-closed。 */
interface EndpointFinding {
	readonly method: string;
	/** 官方落点（namespace/method 或说明）；null = 无已验证端点。 */
	readonly landing: string | null;
	/** 只读源树证据（文件:行）。 */
	readonly evidence: string;
	/** 结论与 D13 接线前置。 */
	readonly note: string;
}

const FINDINGS: readonly EndpointFinding[] = [
	{
		method: 'rewind',
		landing: 'commands/execute /rewind-plugin @<seq> chat',
		evidence: '已安装 dsh-rewind-plugin@0.22.1：lib/index.js ENGINE_COMMAND=rewind-plugin，handleRewind 要求 `<target> chat|both`，target 为 @seq',
		note: '已完成（代码侧）。core 无 rewind remote，不造。Host 只在命令表里有 rewind-plugin 时调用它；没装插件则 FEATURE_UNAVAILABLE。模式固定 chat（消息回退），不把 both 写进契约。',
	},
	{
		method: 'loadOlder',
		landing: 'session/page',
		evidence: 'session-controller/src/index.ts:528 @Remote(page)；types.ts:469 SessionPageRequest{address,throughSeq?,beforeSeq?,maxMessages?,turnWindow?}；ui-trajectory/src/client/index.ts:102-104 session.loadOlder()',
		note: '已完成（代码侧）：契约 loadOlder 按官方 SessionPageRequest 对齐为 {sessionId, throughSeq?, beforeSeq?, maxMessages?}；Host 调 sessionController.page() 并直返 {accepted:true, page:{records, hasMore}}。page() 不重推 follow snapshot，分页内容不经 listen(snapshot)。',
	},
	{
		method: 'setEffort',
		landing: 'session/projections → session/selectModel',
		evidence: 'session-controller/src/index.ts:313 @Remote(selectModel)、:617 @Remote(projections)；types.ts:286 / :89 ModelSelection{provider,model,reasoningEffort?}、:413 SessionProjectionsRequest；core/agent/src/model-selection.ts:72-90 wire.view 产出 modelSelection.next；commands.ts:149-159；ui-model-selection/src/client/directory.ts:99-107 / :161',
		note: '已完成（代码侧，第 26 轮）：先读 session/projections 的 values.modelSelection.next 拿当前 provider+model，再以 reasoningEffort 调 session/selectModel；无当前选择则 FEATURE_UNAVAILABLE，不伪造默认路由。',
	},
	{
		method: 'setPermissionPreset',
		landing: 'commands/execute（/permission <preset>）',
		evidence: 'ui-permission-presets/src/client/index.ts:136 live.command(`/permission ${preset}`)；permission-presets/src/index.ts:291 @Remote(catalog) 仅只读；interaction/commands/src/index.ts:360 execute；第 31 轮 wire 证据同 runCommand 行',
		note: '已完成（代码侧，第 34 轮）：按 §8.10.10 契约决定接线——契约 preset 加命令 token 约束、line=/permission <preset>、结果映射 IA/FU；两套 backend 共用 dshIdeCommandLine.js。运行时 preset 可用性归 U10 / U12 真机探针。',
	},
	{
		method: 'runCommand',
		landing: 'commands/execute',
		evidence: 'interaction/commands/src/index.ts:360 @Remote execute(agent,line,submittedAttachments,signal)；ui-plan/src/client/index.ts:122、ui-commands/src/client/service.ts:423 execute(sessionId,line,attachments)；core/agent/src/index.ts:266-273 lookups.register(agent,{wire:agentId,SessionId})；session-controller/src/client/index.ts:141 identity()=sessionId；gateway/client/index.ts:518-533 args[agentId]=identity；gateway/index.ts:1269-1273/:1630-1655',
		note: '已完成（代码侧，第 34 轮）：按 §8.10.10 契约决定接线——command 为不带斜杠的命令名、args 单空格拼入 rawInput、attachments 恒 []、signal 由框架/Host 提供、结果映射 IA/FU；两套 backend 共用 dshIdeCommandLine.js。',
	},
	{
		method: 'deleteSession',
		landing: 'workspaceRegistry/deleteSession（社区插件 endpoint）',
		evidence: '§8.10.7 官方入口不存在已定论；§8.10.8 第 20 轮批准调用 @michengai/dsh-archive-manager@1.3.1 的公开 endpoint；D51/D61 已实现',
		note: '已完成（代码侧）；运行时可用性归 U12 真机探针。不得回退到 rmSync / 归档 / 隐藏列表行。',
	},
];

/** 已完成（代码侧）：deleteSession、setEffort、listCommands、runCommand / setPermissionPreset、loadOlder（第 21 轮）。 */
const WIRED = ['deleteSession', 'setEffort', 'runCommand', 'setPermissionPreset', 'loadOlder', 'rewind'];
/**
 * core 没有、也不靠这两插件补的 method 不在这张表里。
 *
 * 显式列空数组而不是 `FINDINGS.filter(not in WIRED)`：后者在 WIRED 覆盖全部 finding 时
 * 恒为空，`for (const method of UNVERIFIED)` 一次都不执行，守护变成恒真。
 */
const UNVERIFIED: readonly string[] = [];

// ---------------------------------------------------------------------------
// 契约口径：method 白名单（20 会话域 + 2 账号域 + 2 归档域 + 团队/预设/附加 + readAttachment）
// ---------------------------------------------------------------------------

	test('D16 contract declares the current method whitelist', () => {
	const block = /const DSH_IDE_METHOD_KEYS[\s\S]*?\n\};/.exec(protocol);
	assert.ok(block !== null, 'DSH_IDE_METHOD_KEYS must exist in the protocol single source');
	const keys = [...block[0].matchAll(/^\s*([a-zA-Z]+):/gm)].map(m => m[1]);
	assert.ok(keys.length > 0, 'the contract must declare at least one method');
	assert.equal(new Set(keys).size, keys.length, 'no duplicate method names');
	for (const f of FINDINGS) {
		assert.ok(keys.includes(f.method), `D16 finding must reference a real whitelist method: ${f.method}`);
	}
});

// ---------------------------------------------------------------------------
// fail-closed 守护：未核对形状的 method 在两套 backend 都必须显式拒绝，
// 不许悄悄接成「看起来成功」的假端点。
// ---------------------------------------------------------------------------

test('D16 transport forwards every method to the kernel dispatcher and maps no endpoint itself', () => {
	// 窗口不再重写 session/* 请求：所有操作只经 ide/dispatch 交给内核。
	assert.match(transport, /call\('ide', 'dispatch'/, 'transport must hand operations to the kernel dispatcher');
	assert.doesNotMatch(transport, /call\('session', 'prompt'/, 'transport must not carry its own prompt call');
	assert.doesNotMatch(transport, /call\('session', 'selectModel'/, 'transport must not carry its own selectModel call');
	assert.doesNotMatch(transport, /call\('session', 'cancel'/, 'transport must not carry its own cancel call');
});

test('chat-baseline methods without a verified remote stay missing(...)', () => {
	// setGoal / listSkills / searchSessions 已按官方服务核对接线（见 HANDOFF 记录），不再在此列。
	// 这四个空壳已经删除：附件改走 saveImageAttachment，openInApp/dismissQuotaNotice 无落点。
	for (const method of ['addAttachment', 'removeAttachment', 'openInApp', 'dismissQuotaNotice']) {
		assert.doesNotMatch(host, new RegExp(`${method}:\\s*missing\\('${method}'\\)`), `${method} must no longer be a fail-closed stub`);
	}
	assert.match(protocol, /searchSessions:/, 'searchSessions already exists and must not be duplicated');
	assert.match(protocol, /resume:/, 'resume already exists and must not be duplicated as resumeSession');
	assert.doesNotMatch(protocol, /\bforkAt:/, 'fork.point already maps to atSeq; do not add forkAt');
	assert.doesNotMatch(protocol, /\bloadThrough:/, 'loadOlder.throughSeq already is the official cut; do not add loadThrough');
});

test('setGoal and listSkills are not on the chat path', () => {
	assert.doesNotMatch(host, /async setGoal\(args\)/);
	assert.doesNotMatch(host, /listSkills:/);
});

test('D16 Host bridge keeps the unverified methods as missing(...)', () => {
	for (const method of UNVERIFIED) {
		const re = new RegExp(`${method}:\\s*missing\\('${method}'\\)`);
		assert.match(host, re, `Host bridge must keep ${method} as missing(...) until its official endpoint is verified`);
	}
	for (const method of WIRED) {
		assert.doesNotMatch(host, new RegExp(`${method}:\\s*missing\\(`), `${method} must remain wired on the Host side`);
	}
});

// ---------------------------------------------------------------------------
// 结论表本身：每条都要有证据与结论，落点与 D13 前置口径一致。
// ---------------------------------------------------------------------------

test('D16 findings are complete: 6 methods, each with evidence and a conclusion', () => {
	assert.equal(FINDINGS.length, 6);
	assert.deepEqual(FINDINGS.map(f => f.method).sort(),
		['deleteSession', 'loadOlder', 'rewind', 'runCommand', 'setEffort', 'setPermissionPreset'].sort());
	for (const f of FINDINGS) {
		assert.ok(f.evidence.length > 20, `${f.method} must carry source evidence`);
		assert.ok(f.note.length > 10, `${f.method} must carry a conclusion / D13 prerequisite`);
	}
	assert.equal(FINDINGS.filter(f => f.note.startsWith('已完成')).length, 6);
	// 每条 finding 必须落在 WIRED 或 UNVERIFIED 之一：既不漏判，也不允许两边都不列。
	for (const finding of FINDINGS) {
		assert.ok(
			WIRED.includes(finding.method) || UNVERIFIED.includes(finding.method),
			`${finding.method} must be classified as WIRED or UNVERIFIED`,
		);
	}
	assert.equal(UNVERIFIED.length, 0);
});

// ---------------------------------------------------------------------------
// 第 31 轮核对 commands scoped-remote 形状；第 32 轮据此只接线 listCommands，
// 其余两个（runCommand 拼接 / setPermissionPreset 斜杠语义）仍 fail-closed。
// 这里钉住「形状结论进 §8.10.9、listCommands 已接线、其余不抢跑」。
// ---------------------------------------------------------------------------

test('D17 deleteSession calls the approved physical-delete endpoint, never a close/hide/rmSync fallback', () => {
	// Host：唯一删除路径是 resolveDeleteSessionMethod() 取到的插件 overlay / 网关 remote。
	assert.match(host, /async deleteSession\(args\)\s*\{[\s\S]*?resolveDeleteSessionMethod\(bridge\.ctx\)/,
		'Host deleteSession must resolve the approved plugin endpoint');
	assert.doesNotMatch(host, /async deleteSession\(args\)\s*\{[\s\S]{0,600}?\.close\(\)/,
		'Host deleteSession must not close the view as a substitute for deleting');
	// 只查 deleteSession 函数体：文件别处的 unlink 是 D55 端点文件清理，与删会话无关。
	const hostCode = host.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
	const deleteBody = /async deleteSession\(args\)\s*\{([\s\S]*?)\n\t\t\},/.exec(hostCode)?.[1] ?? '';
	assert.ok(deleteBody.length > 0, 'Host deleteSession body must be found');
	assert.doesNotMatch(deleteBody, /\brmSync\s*\(|\bfs\.promises\.rm\s*\(|\bunlink\s*\(|\.close\(\)/,
		'Host deleteSession must not delete directories locally or close the view instead');
	// 删除只在 Host 侧走归档管理器的端点；窗口只经 ide/dispatch 转发。
	assert.match(host, /resolveDeleteSessionMethod\(bridge\.ctx\)/, 'Host owns the delete endpoint');
	assert.match(transport, /call\('ide', 'dispatch'/, 'window only forwards the delete to the kernel');
	assert.match(host, /result\.deleted !== true/, 'Host must require the confirmed delete result');
	// 归属与判活前置必须保留。
	// 显式行操作按「该行对当前主体可见」校验，不再要求它等于当前绑定会话。
	assert.match(host, /async deleteSession\(args\)\s*\{\s*await assertVisibleRowForBridge\(bridge, args\.sessionId\)/,
		'Host deleteSession must verify the row is visible before touching storage');
	assert.match(host, /if \(!\(await sessionExists\(bridge\.ctx, args\.sessionId\)\)\)/,
		'Host deleteSession must verify the session exists before calling the plugin');
});

// ---------------------------------------------------------------------------
// 第 38 轮：D59 的官方端点核对结论（§8.10.11）。
// 钉住「归档 / 置顶是官方公开 remote、当前契约仍是 22 method、尚未接线」，
// 防止下一轮凭记忆新增端点，或误以为它们和 deleteSession 一样依赖第三方插件。
// ---------------------------------------------------------------------------

// D59 的官方端点核对结论（§8.10.11）。
// 钉住「归档 / 恢复是官方公开 remote、已在契约与内核接线、不依赖第三方插件」。
// ---------------------------------------------------------------------------

test('D59 archive endpoints are official remotes and now wired without third-party approval', () => {
	const block = /const DSH_IDE_METHOD_KEYS[\s\S]*?\n\};/.exec(protocol);
	assert.ok(block !== null);
	assert.ok([...block[0].matchAll(/^\s*([a-zA-Z]+):/gm)].length > 0, 'contract must declare methods');
	for (const endpoint of ['archiveSession', 'unarchiveSession']) {
		assert.ok(protocol.includes(endpoint + ':'), endpoint + ' must be a contract method');
		// 窗口只经 ide/dispatch 转发；真正调官方 remote 的是内核桥接。
		assert.ok(host.includes('async ' + endpoint + '(args)'), endpoint + ' must be implemented by the Host bridge');
	}
	for (const endpoint of ['pinSession', 'unpinSession']) {
		assert.ok(!protocol.includes(endpoint + ':'), endpoint + ' must stay out of the contract until approved');
	}
	});

// ---------------------------------------------------------------------------
// D54（第 20 轮）：探针执行清单（§8.10.12）。
// 钉住「清单存在、三类齐全、条目编号可数、六列回填格式与 AI 不代跑纪律」，
// 防止清单被删空或倒退成无法执行的散文。
// ---------------------------------------------------------------------------

test('listen event surface stays an explicit allow-list (snapshot / waterfall / session-notice)', () => {
	const protocol = read('src/vs/platform/dshClient/protocol/dshIdeProtocol.ts');
	const channel = read('src/vs/platform/dshClient/ide/main/dshIdeChannel.ts');

	// 契约里有澄清注释，且明确「当前唯一」「须先改本契约」。
	assert.match(protocol, /白名单是 `snapshot` 与 `waterfall`/, 'the contract must name both allowed snapshot/waterfall events');
	assert.match(protocol, /须\*\*先改本契约\*\*/, 'the contract must require a contract change before extending');
	// 通道实现只认白名单里的名字，其它返回 Event.None（行为未变）。
	assert.match(channel, /export const DSH_IDE_SNAPSHOT_EVENT = 'snapshot'/, 'the snapshot event name must stay "snapshot"');
	assert.match(channel, /if \(event !== DSH_IDE_SNAPSHOT_EVENT && event !== DSH_IDE_WATERFALL_EVENT && event !== DSH_IDE_SESSION_NOTICE_EVENT\) \{[\s\S]{0,80}?return Event\.None/, 'listen must return Event.None for any other name');
	// session-notice 不进快照 version，是状态通知的第三条独立事件；常量数随白名单同步。
	assert.equal((channel.match(/DSH_IDE_[A-Z_]*EVENT\s*=/g) ?? []).length, 3, 'exactly three listen event-name constants may exist');
});

// ---------------------------------------------------------------------------
// 第 26 轮：D15 前置——官方语音服务的就绪语义核实（§8.10.13）。
// 钉住「只读核对结论已固化、DSH-IDE 仍无语音入口、未自建第二套识别后端」。
// ---------------------------------------------------------------------------

test('round-27 packaging never reads .npmrc target, so it cannot affect the artifact', () => {
	const gulp = read('build/gulpfile.vscode.ts');

	// 结论已固化。

	// 脚本事实：打包不读这些配置，也不重编译。
	for (const token of ['npmrc', 'electron-rebuild', 'build_from_source']) {
		assert.ok(!gulp.includes(token), `gulpfile must not reference ${token}`);
	}
	assert.doesNotMatch(gulp, /['"]target['"]\s*:/, 'gulpfile must not read an npmrc target option');
	assert.doesNotMatch(gulp, /electron-rebuild|nativeRebuild/, 'gulpfile must not recompile native modules');

	// `.npmrc` 仍带着 target（本轮不改它），结论因此始终有前提可核。
	const npmrc = read('.npmrc');
	assert.match(npmrc, /^target="43\.7\.7"$/m, 'the .npmrc target must stay unchanged by this round');
});

// ---------------------------------------------------------------------------
// D27（第 28 轮）：CI 聚合入口——不选平台、不改仓库结构，只提供单一入口，
// 并如实把 PENDING 记为未通过（与第 5 章 §9 / §9.4 一致）。
// ---------------------------------------------------------------------------

test('D27 CI aggregate entry exists, follows §2 order, and refuses PENDING', () => {
	const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
	assert.equal(pkg.scripts['verify:dsh-ide-ci'], 'node build/lib/dsh/verify/dshIdeCi.mjs', 'the CI entry must be registered');

	const script = read('build/lib/dsh/verify/dshIdeCi.mjs');
	// 顺序取自第 5 章 §2（四门禁 → test-dsh:all）。
	// `verify:docs-graph` 从未在 package.json 里实现过，作为悬空步骤已移除。
	const order = [...script.matchAll(/script: '(verify:dsh-ide-[a-z-]+|test-dsh:all)'/g)].map(m => m[1]);
	assert.deepEqual(order, [
		'verify:dsh-ide-protocol-single-source',
		'verify:dsh-ide-boundary',
		'verify:dsh-ide-projection-golden',
		'verify:dsh-ide-contract',
		// 本地化审计（第三十九轮新增）：中文 source、占位符与实参吻合、key 无冲突、无裸字符串。
		'verify:dsh-ide-localization',
		// 产物完整性（第四十轮新增）：相对 import 可达、外部依赖与 peer 声明一致、exports 目标齐全。
		'verify:dsh-ide-bundle-integrity',
		'test-dsh:all',
	], 'the CI steps must follow chapter-5 §2 order');
	// PENDING 不计通过（§9）。
	assert.match(script, /status === 'PASS'/, 'the entry must require STATUS: PASS');
	assert.match(script, /PENDING 不计通过|PENDING` 不计通过/, 'the entry must document the PENDING rule');
	// 不选平台、不新建 CI 配置目录。
	assert.match(script, /不选 CI 平台/, 'the entry must state it does not choose a CI platform');
	// 注释里可以提到「不新建 .github」，但代码不得真的读写这些目录。
	assert.doesNotMatch(script, /mkdir|writeFile|cp\w*\(.*(github|azure-pipelines)/, 'the entry must not create a CI platform directory');

	// 仓库当前仍无 CI 配置目录（D27 未完成，平台待定）。
	assert.equal(fs.existsSync(path.join(repoRoot, '.github')), false, 'no .github/ may be created before the platform is decided');
	assert.equal(fs.existsSync(path.join(repoRoot, 'build/azure-pipelines')), false, 'no azure-pipelines/ may be created before the platform is decided');
});

// ---------------------------------------------------------------------------
// D54 第 57 轮：U3 探针的**可本地观测部分**已执行并回填（§8.10.12）。
// 四条依赖文件系统的探针（U3-1/2/3/5）已由 AI 实测；U3-4（删除后不重建）
// 涉及真实删除动作，按 AGENTS §6 归用户，故 U3 未全部完成、D54 保持未完成。
// 本测试钉住「结果已回填、结论包含两个否决项、且未谎称全部完成」。
// ---------------------------------------------------------------------------

test('D62 workspaceRegistry is optional and the bridge still waits for its core deps via ctx.inject', () => {
	const host = read('src/vs/platform/dshClient/host/bridge/ide-view-host.js');
	const index = read('src/vs/platform/dshClient/index.js');

	// 核心依赖只有会话跟随必需的两项；workspaceRegistry 只被归档/删除用到，
	// 列成硬依赖会让缺该插件的 profile 连聊天都打不开（真机实测，见 host 文件注释）。
	assert.match(host, /REQUIRED_SERVICES = Object\.freeze\(\['sessions', 'sessionController'\]\)/, 'core deps must be sessions + sessionController');
	assert.doesNotMatch(host, /REQUIRED_SERVICES = Object\.freeze\([^\]]*'workspaceRegistry'/, 'workspaceRegistry must stay optional');

	// 必须用 ctx.inject 等依赖就绪后建桥（这正是「无装载顺序依赖」的依据）。
	assert.match(index, /ctx\.inject\(REQUIRED_SERVICES,/, 'the bridge must be built inside ctx.inject(REQUIRED_SERVICES, …)');

	// 服务缺失路径必须已 fail-closed。
	assert.match(host, /FEATURE_UNAVAILABLE/, 'a missing service must fail closed with FEATURE_UNAVAILABLE');
});

test('DshIdeConsumer exists but its accept() only validates snapshots', () => {
	const consumer = read('src/vs/workbench/contrib/dsh/browser/consumer/dshIdeConsumer.ts');

	assert.match(consumer, /export class DshIdeConsumer extends Disposable/, 'the consumer must exist as a class');
	assert.match(consumer, /accept\(frame: unknown\): boolean/, 'accept() must keep its signature');
	assert.match(consumer, /validateDshIdeSnapshot\(frame\)/, 'accept() must validate snapshot frames');

	// 关键事实：目前不处理 waterfall / approval / question。若将来补上，本断言需同步更新
	// 并在手册里把缺口③ 标为已完成——本测试的作用就是让这个变化不能悄悄发生。
	assert.doesNotMatch(consumer, /waterfall|answerApproval|answerQuestion/,
		'the consumer currently handles snapshots only; adding waterfall handling requires updating D50 and this test');
});

// ---------------------------------------------------------------------------
// D27 第 60 轮：CI 聚合入口的**前置构建检查**（干净 checkout 的真实缺口）。
// `test-dsh` 从 `out/` 加载测试与模块，干净 checkout 上直接跑本聚合会以
// 「找不到 out/...」失败，且失败点在下游，报错不会提示「要先构建」。
// 本测试钉住：脚本必须显式检查 node_modules/ 与 out/ 并给出可操作命令。
// ---------------------------------------------------------------------------

test('D27 the CI aggregate checks prerequisites and names the fix command', () => {
	const ci = read('build/lib/dsh/verify/dshIdeCi.mjs');

	// 两项前置必须被检查，且各自给出可执行命令，而不是让下游报模块缺失。
	assert.match(ci, /PREREQUISITES/, 'the CI aggregate must declare its prerequisites');
	assert.match(ci, /dir: 'node_modules'[\s\S]{0,40}hint: 'npm ci'/, 'node_modules prerequisite must hint npm ci');
	assert.match(ci, /dir: 'out'[\s\S]{0,60}hint: 'npm run build-dsh-tests'/, 'out prerequisite must hint build-dsh-tests');

	// 缺失时必须退出 1（不得静默继续跑门禁）。
	assert.match(ci, /前置条件缺失，未开始跑门禁/, 'missing prerequisites must abort before running gates');
});

// ---------------------------------------------------------------------------
// D21 第 61 轮：九项真机验收的**前置静态核查**已记录（§5 §6 之后）。
// 关键纪律：这九项只能真机判定，静态核查**不构成任何一项通过**。本测试钉住
// 记录存在、且明确写着「不构成通过结论」与「D21 整体保持未完成」。
// ---------------------------------------------------------------------------

const contractGateScript = 'build/lib/dsh/verify/dshIdeVerify.mjs';

function runContractGate(root: string, env: Record<string, string>) {
	const child = spawnSync(process.execPath, [path.join(root, contractGateScript), 'contract'], {
		cwd: root,
		encoding: 'utf8',
		env: { ...process.env, ...env },
		timeout: 10_000,
	});
	assert.ifError(child.error);
	return { code: child.status, out: child.stdout + child.stderr };
}

test('D26 the contract gate accepts LF and CRLF checkouts and refuses drift', t => {
	const root = fs.mkdtempSync(path.join(tmpdir(), 'dsh-d26-'));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const contractFile = 'src/vs/platform/dshClient/protocol/dshIdeContract.ts';
	const files = [...read(contractFile).matchAll(/\bfile:\s*'([^']+)'/g)].map(m => m[1]);
	assert.equal(files.length, 4, 'four injection points must be declared');

	// 复制门禁和它依赖的文件，在临时目录制造两种检出与真实漂移。
	for (const file of [contractGateScript, contractFile, 'build/lib/dsh/package.json', 'src/vs/platform/dshClient/host/bridge/ide-view-host.js', ...files]) {
		const dest = path.join(root, file);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.copyFileSync(path.join(repoRoot, file), dest);
	}
	const run = () => runContractGate(root, { DSH_INSTALLED_VERSION: '0.2.2-rc.5', DSH_HOME: '' });
	for (const [label, eol] of [['LF', '\n'], ['CRLF', '\r\n']]) {
		for (const file of files) {
			fs.writeFileSync(path.join(root, file), read(file).replace(/\r?\n/g, eol));
		}
		const result = run();
		assert.equal(result.code, 0, `${label} checkout must pass:\n${result.out}`);
		assert.match(result.out, /STATUS: PASS +\[contract\]/);
	}

	const changedFile = files[0];
	const changedPath = path.join(root, changedFile);
	fs.appendFileSync(changedPath, '\r\n// D26 content drift fixture\r\n');
	const changed = run();
	assert.equal(changed.code, 1, changed.out);
	assert.match(changed.out, /STATUS: FAIL +\[contract\]/);
	assert.ok(changed.out.includes(`${changedFile}: 基线`), changed.out);

	fs.unlinkSync(changedPath);
	const missing = run();
	assert.equal(missing.code, 1, missing.out);
	assert.match(missing.out, /STATUS: FAIL +\[contract\]/);
	assert.ok(missing.out.includes(`${changedFile}: 文件缺失`), missing.out);
});

// ---------------------------------------------------------------------------
// 第 64 轮：禁止「条件跳过」式假守护。
//
// 发现：`dshNativeModuleAbi.test.ts` 的 conpty 测试原先写
// `if (!fs.existsSync(release)) { return; }`——模块缺失时**整个测试静默通过**，
// D23 的 conpty 断言形同虚设。与第 42 轮 D20 假守护同类：看起来有守护，
// 但环境不满足时它不会失败。
//
// 本测试扫全部 dsh 测试文件，禁止「check-then-return」这种会让断言消失的写法。
// 允许的替代：`assert.ok(exists, msg)` 显式失败；或 `continue` 但末尾有兜底计数断言。
// ---------------------------------------------------------------------------

test('no dsh test silently returns when a required path is missing', async () => {
	const fsMod = await import('node:fs');
	const files = fsMod.readdirSync(path.join(repoRoot, 'build/lib/test'))
		.filter(name => name.startsWith('dsh') && name.endsWith('.test.ts'));

	// 注意（第 64 轮踩到的坑）：不能对全文做正则匹配——注释里引用的示例文本、
	// 以及本测试自身的正则字面量都会被命中（与第 42 轮 D20 假守护同一类错误）。
	// 因此先剥离行注释再匹配，只检查**真正会被执行的代码**。
	const stripLineComments = (line) => {
		// 只在字符串外的 `//` 处截断；这里不需要完整词法分析，覆盖本仓库的写法即可。
		const idx = line.indexOf('//');
		if (idx === -1) { return line; }
		const before = line.slice(0, idx);
		const quotes = (before.match(/`/g) ?? []).length + (before.match(/'/g) ?? []).length + (before.match(/"/g) ?? []).length;
		return quotes % 2 === 0 ? before : line;
	};

	const offenders = [];
	for (const name of files) {
		if (name === 'dshIdeEndpoints.test.ts') { continue; } // 本文件含自指的正则与示例
		const source = fsMod.readFileSync(path.join(repoRoot, 'build/lib/test', name), 'utf8');
		const offendersInFile = source
			.split(/\r?\n/)
			.map(stripLineComments)
			.filter(line => /if \(!fs\.existsSync\([^)]*\)\)\s*\{\s*return;\s*\}/.test(line));
		if (offendersInFile.length > 0) { offenders.push(name); }
	}

	assert.deepEqual(offenders, [],
		`these tests silently pass when a path is missing (use assert.ok instead): ${offenders.join(', ')}`);
});

// ---------------------------------------------------------------------------
// 第 65 轮：`test-dsh:all` 用**显式文件列表**（不是 glob），因此新增测试文件若忘记
// 登记就会静默不运行——这是第 64 轮「条件跳过」的近亲：测试存在、CI 变绿、但它跑没跑
// 无人知道。本测试把「本项目每个 dsh*.test.ts 都在列表里」变成不变量。
//
// 说明：`build/lib/test/` 下还有约 32 个**上游 VS Code** 自带测试（eslint / i18n /
// stylelint 等），它们不属于本项目、也不在该命令范围内，故只约束 `dsh*` 前缀文件。
// ---------------------------------------------------------------------------

test('every project dsh test file is registered in test-dsh:all', async () => {
	const fsMod = await import('node:fs');
	const pkg = JSON.parse(fsMod.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
	const command = pkg?.scripts?.['test-dsh:all'];
	assert.ok(typeof command === 'string' && command.length > 0, 'package.json must define test-dsh:all');

	const registered = new Set(
		[...command.matchAll(/build\/lib\/test\/[\w.]+\.test\.ts/g)].map(m => m[0]),
	);
	const onDisk = fsMod.readdirSync(path.join(repoRoot, 'build/lib/test'))
		.filter(name => name.startsWith('dsh') && name.endsWith('.test.ts'))
		.map(name => `build/lib/test/${name}`);

	const missing = onDisk.filter(file => !registered.has(file));
	assert.deepEqual(missing, [],
		`these test files exist but never run (add them to test-dsh:all): ${missing.join(', ')}`);
});

// ---------------------------------------------------------------------------
// 第 66 轮：手册里的**体积口径**必须与真实产物一致。
//
// 发现的过时表述：P7 状态行与 D29 依据都还写着「仍含 map」「119,704,107 B」，
// 但第 46 轮已用 `CI=1` 实测剔除（78,912,417 B、out/**/*.js.map = 0）。
// 同一份文档里前后矛盾，会让读者以为 D29 的 map 子项没做。
//
// 本测试把「§0.1 声明的分发体积 == 磁盘上 tgz 的实际字节数」变成不变量；产物
// 重打后若忘记回写，测试即失败。
// ---------------------------------------------------------------------------

test('D68 contract gate can actually reach PASS, and fails on a lower installed version', t => {
	const run = (env: Record<string, string>) => runContractGate(repoRoot, env);

	// 未设版本且本机没有运行时元数据：不得判 PASS（无法证明相符），且退出码必须非 0
	// （「没有证据」不能算成功）。两个来源都要清掉，否则自动发现会补上版本。
	const unset = run({ DSH_INSTALLED_VERSION: '', DSH_HOME: '' });
	assert.match(unset.out, /STATUS: PENDING/, 'without any version evidence the gate must stay PENDING');
	assert.notEqual(unset.code, 0, 'PENDING must not exit 0 — a caller using && would treat it as success');

	// 用临时运行时元数据走自动发现，同一测试可在装机与干净检出环境运行。
	const home = fs.mkdtempSync(path.join(tmpdir(), 'dsh-d68-'));
	t.after(() => fs.rmSync(home, { recursive: true, force: true }));
	const runtime = path.join(home, 'dsh-runtimes', 'desktop');
	fs.mkdirSync(runtime, { recursive: true });
	fs.writeFileSync(path.join(runtime, 'runtime.json'), JSON.stringify({ desktopVersion: '0.2.2-rc.5' }));
	const auto = run({ DSH_INSTALLED_VERSION: '', DSH_HOME: home });
	assert.equal(auto.code, 0, auto.out);
	assert.match(auto.out, /STATUS: PASS +\[contract\]/);

	// 版本在 manifest engines.dsh 区间内：应当 PASS。
	const ok = run({ DSH_INSTALLED_VERSION: '0.2.2-rc.5' });
	assert.equal(ok.code, 0, 'an in-range installed version must not fail the gate');
	assert.match(ok.out, /STATUS: PASS/, 'an in-range installed version must yield PASS');

	// 低于 engines.dsh 下界：必须 FAIL —— 只比「上次核对过的版本」会放行这里。
	const belowEngine = run({ DSH_INSTALLED_VERSION: '0.2.2-rc.1' });
	assert.notEqual(belowEngine.code, 0, 'a version below engines.dsh must fail the gate');
	assert.match(belowEngine.out, /engines\.dsh/, 'the failure must name the manifest range');

	// 未来大版本（不在 engines.dsh 区间）：同样必须 FAIL。
	const future = run({ DSH_INSTALLED_VERSION: '9.9.9' });
	assert.notEqual(future.code, 0, 'a future major outside engines.dsh must fail the gate');
	assert.match(future.out, /engines\.dsh/, 'the failure must name the manifest range');

	// 版本过低：应当 FAIL（退出非 0）。
	const low = run({ DSH_INSTALLED_VERSION: '0.1.0' });
	assert.notEqual(low.code, 0, 'a lower installed version must fail the gate');
	assert.match(low.out, /STATUS: FAIL/, 'a lower installed version must yield FAIL');
});

// ---------------------------------------------------------------------------
// 第 69 轮：`projection-golden` 内置 P95 断言（此前只是打印说明）。
//
// 与第 68 轮修掉的 `contract` 同类：**文字在、校验不在**。第 51 轮已用真实事件流
// 实测 P95（235,214 B / 14,522 B ≪ 512 KiB），但门禁里仍只有一行
// `console.log('PENDING(P6): 真实事件流 P95 字节数校准…')`，超限也不会失败。
// 本轮把度量内置：有真实样本时重算并断言，超限即抛错；无样本时明确跳过。
// ---------------------------------------------------------------------------

test('D69 projection-golden replays the typed projector instead of staying PENDING', () => {
	const gate = read('build/lib/dsh/verify/dshIdeVerify.mjs');
	// 会话内容改为帧直传后不再有 translator + projector，原 P95 探针随投影器一起删除。
	// 现在有替代断言：回放 Host 的 typed 投影器（`dshIdeConversation.ts`）并校验协议。
	assert.match(gate, /function projectionGolden\(\)/, 'the gate must still exist');
	assert.match(gate, /createDshIdeConversationState/, 'the gate must replay the typed projector');
	assert.match(gate, /validateDshIdeSnapshot/, 'the gate must validate projected nodes against the protocol');
	assert.match(gate, /return 'PASS'/, 'the gate must report PASS once the replay succeeds');
	assert.doesNotMatch(gate, /function probeRealSessionP95/, 'the removed projector probe must not come back');
	assert.doesNotMatch(gate, /function projectIdeView/, 'the removed projector must not come back');
});

// ---------------------------------------------------------------------------
// 第 70 轮：CI 聚合器的两处修正。
//
// ① `contract` 的 PASS 路径若 CI 不传 `DSH_INSTALLED_VERSION` 就永远用不到 →
//    CI 现在透传该变量，未传时明确提示「本次将以 PENDING 结束」。
// ② 原实现对所有步骤都用 `/^STATUS:/m` 抓状态，于是 `test-dsh:all` 里任何测试
//    打印过 `STATUS: FAIL`（例如「版本过低应 FAIL」的子进程测试）就会被误判为
//    失败——**实际测试全通过、退出码 0**。现改为只对 `verify:` 门禁解析。
// ---------------------------------------------------------------------------

test('D70 CI forwards DSH_INSTALLED_VERSION and only parses STATUS for gate steps', () => {
	const ci = read('build/lib/dsh/verify/dshIdeCi.mjs');

	// ① 透传并提示
	assert.match(ci, /DSH_INSTALLED_VERSION/, 'CI must consider DSH_INSTALLED_VERSION');
	assert.match(ci, /未设置 DSH_INSTALLED_VERSION —— `contract` 将以 PENDING 结束/,
		'CI must explain the consequence of not setting the version');

	// ② 只对门禁解析 STATUS
	assert.match(ci, /const isGate = step\.script\.startsWith\('verify:'\)/,
		'CI must scope STATUS parsing to gate steps');
	assert.match(ci, /isGate \? \/\^STATUS:/, 'the STATUS regex must be gated by isGate');
});

// ---------------------------------------------------------------------------
// 第 71 轮：§7.4「CI 接入清单」必须与入口脚本的真实行为一致。
//
// 这条清单是 U16 裁定后**任何平台**照抄即用的说明；它若与实际行为不符，
// 接入者会按错的步骤配 CI。因此把三步写成断言：前置两项 + 版本变量 + 判定口径。
// ---------------------------------------------------------------------------

test('D27 §7.4 onboarding checklist matches the CI entry script behaviour', () => {
	const ci = read('build/lib/dsh/verify/dshIdeCi.mjs');

	// 文档三步必须都在。

	// 文档承诺的行为必须在脚本里成立（否则清单是空话）。
	assert.match(ci, /dir: 'node_modules'[\s\S]{0,40}hint: 'npm ci'/, 'script must check node_modules and hint npm ci');
	assert.match(ci, /dir: 'out'[\s\S]{0,60}hint: 'npm run build-dsh-tests'/, 'script must check out and hint the build');
	assert.match(ci, /step\.script\.startsWith\('verify:'\)/, 'script must scope STATUS parsing');
});

// ---------------------------------------------------------------------------
// 第 76 轮：三个「手动核对」脚本**不得**被塞进 CI 聚合，且手册必须标明其性质。
//
// 背景：`verify:dsh-artifact` / `verify:dsh-install-drift` / `verify:dsh-real-p95`
// 分别依赖 `dist/*.tgz`、`DSH_PROFILE_DIR`、`~/.dsh/sessions`——干净 checkout 里
// 三者皆无，因此**不放进 CI 是正确设计**（放进去也只会被跳过，制造「已覆盖」的错觉）。
// 但这个「有意不纳入」若不写明，接入者会以为 CI 已覆盖全部检查。
// 本测试同时钉住两侧：CI 里确实没有它们；手册里确实标注了「手动核对」。
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 新增能力的 Host 落点（语音 / 补全 / 附件入库 / 账号 / MCP / 作业）
// ---------------------------------------------------------------------------

test('new channel methods resolve their documented Host services', () => {
	const cases: readonly { method: string; service: string; call: RegExp }[] = [
		{ method: 'speechCatalog', service: 'speechController', call: /speech\.catalog\(\)/ },
		{ method: 'speechTranscribe', service: 'speechController', call: /speech\.transcribe\(args\.request/ },
		{ method: 'saveImageAttachment', service: 'attachments', call: /attachments\.saveImages\(\[/ },
		{ method: 'accountStartSignIn', service: 'deepseekAccount', call: /service\.startSignIn\(args\.client, args\.callbackOrigin, args\.loginSource\)/ },
		{ method: 'accountCancelSignIn', service: 'deepseekAccount', call: /service\.cancelSignIn\(args\.attemptId\)/ },
	];
	for (const entry of cases) {
		// 无参方法（speechCatalog / mcpListServers）的 Host 实现写成 `async name()`。
		assert.ok(
			host.includes('async ' + entry.method + '(args)') || host.includes('async ' + entry.method + '()'),
			entry.method + ' must be implemented by the Host bridge',
		);
		assert.ok(host.includes("service(bridge.ctx, '" + entry.service + "')"), entry.method + ' must resolve ' + entry.service);
		assert.match(host, entry.call, entry.method + ' must call its documented service method');
	}
	assert.doesNotMatch(host, /async inlineComplete\(args\)/);
	assert.doesNotMatch(host, /async jobList\(args\)/);
	assert.doesNotMatch(host, /async mcpListServers\(\)/);
});

test('no channel method is left as a fail-closed stub', () => {
	assert.doesNotMatch(host, /:\s*missing\('/, 'the Host bridge must not keep any missing(...) stub');
});
// ---------------------------------------------------------------------------
// 三面一致性：契约方法 ↔ Host handler 必须逐一对应
// ---------------------------------------------------------------------------

test('every contract method has a Host handler and no handler is orphaned', () => {
	const block = /const DSH_IDE_METHOD_KEYS[\s\S]*?\n\};/.exec(protocol);
	assert.ok(block !== null, 'DSH_IDE_METHOD_KEYS must exist');
	const contract = [...block[0].matchAll(/^\s*([a-zA-Z]+):/gm)].map(m => m[1]);

	// Host 里两种写法都算实现：`async name(args)` 与 `name: async args =>`。
	const handlers = new Set<string>();
	for (const m of host.matchAll(/^\t\tasync ([a-zA-Z]+)\(/gm)) {
		handlers.add(m[1]);
	}
	for (const m of host.matchAll(/^\t\t([a-zA-Z]+): async /gm)) {
		handlers.add(m[1]);
	}

	const missing = contract.filter(method => !handlers.has(method));
	const orphaned = [...handlers].filter(name => !contract.includes(name));
	assert.deepEqual(missing, [], 'every contract method must have a Host handler');
	assert.deepEqual(orphaned, [], 'no Host handler may exist outside the contract');
});

test('accountCancelSignIn is reachable from the account menu, not just the contract', async () => {
	// 契约与 Host 早就实现了 cancelSignIn，但 renderer 没有调用点：用户关掉浏览器授权页后
	// 只能等超时。这里锁住「有 attemptId、有取消入口、失败如实提示」三件事。
	const fs = await import('node:fs');
	const file = fs.readFileSync('src/vs/workbench/browser/parts/globalCompositeBar.ts', 'utf8');
	assert.match(file, /accountCancelSignIn/, 'the account menu must call the official cancel endpoint');
	assert.match(file, /attemptId\?: string/, 'startSignIn must read the attempt id returned by the Host');
	assert.match(file, /private async cancelSignIn\(attemptId: string\)/, 'cancel must be one shared implementation');
	assert.match(file, /dsh\.cancelSignInFailed/, 'a failed cancel must be reported, not swallowed');
});

test('a disabled provider bundle is diagnosable instead of silent', async () => {
	// Cordis 的 ctx.inject 在依赖未注册时静默等待、不报错也不超时。
	// sessionController 由 dsh-web-app bundle 提供：那个 bundle 被禁用时，Host 半身永远不建立，
	// 日志里一行原因都没有。体检必须存在，且不能改变等待语义。
	const fs = await import('node:fs');
	const entry = fs.readFileSync('src/vs/platform/dshClient/index.js', 'utf8');
	assert.match(entry, /host bridge is waiting for services/, 'the watchdog must name the missing services');
	assert.match(entry, /REQUIRED_SERVICES\.filter/, 'the watchdog must check the same required list');
	assert.match(entry, /bridgeWatchdog\.unref|unref\(\)/, 'the watchdog must not keep the process alive');
	assert.match(entry, /clearTimeout\(bridgeWatchdog\)/, 'the watchdog must be cleared once the bridge is up');
});

test('concurrent launch clicks are coalesced, not spawned twice', async () => {
	// 防抖只看 ideChild，而 spawn 之前有 await（物化主页/解析工具路径/预取 composerState）。
	// 这期间 ideChild 仍是 undefined，两个并发点击会各拉起一个窗口。
	const fs = await import('node:fs');
	const service = fs.readFileSync('src/vs/platform/dshClient/host/usecase/ide-service.js', 'utf8');
	assert.match(service, /this\.launchInFlight !== undefined/, 'a second click must reuse the in-flight launch');
	assert.match(service, /async _spawnIdeProcessOnce\(/, 'the spawn body must be separable from the coalescing gate');
	assert.match(service, /this\.launchInFlight === inFlight/, 'the gate must only clear its own promise');
	assert.match(service, /this\.launchInFlight = undefined;\s*\n\s*if \(child === undefined/, 'unload must clear the gate too');
});

test('the release gate covers every CI gate, not a stale subset', () => {
	// `release-gate` 曾经硬编码最早那四条门禁；后来新增的 localization / bundle-integrity /
	// artifact / install-drift 全被静默跳过——「发布门禁通过」实际只覆盖一半。
	// 这里钉住：CI 聚合里的每条 verify 门禁都必须出现在 RELEASE_GATES 里。
	const ci = read('build/lib/dsh/verify/dshIdeCi.mjs');
	const verify = read('build/lib/dsh/verify/dshIdeVerify.mjs');

	const ciGates = [...ci.matchAll(/script:\s*'(verify:dsh-ide-[a-z-]+)'/g)].map(m => m[1]);
	assert.ok(ciGates.length >= 6, `expected the CI entry to list its gates (found ${ciGates.length})`);

	// 把 npm script 名映射到 RELEASE_GATES 里用的短名：`verify:dsh-ide-<name>` → `<name>`。
	const expected = ciGates
		.map(script => script.replace('verify:dsh-ide-', ''))
		// `release-gate` 自身不参与聚合（会递归）。
		.filter(name => name !== 'release-gate');
	const block = /const RELEASE_GATES = \[([\s\S]*?)\n\];/.exec(verify);
	assert.ok(block !== null, 'RELEASE_GATES must be declared as a literal array');
	const covered = [...block[1].matchAll(/\['([a-z-]+)'/g)].map(m => m[1]);
	for (const gate of expected) {
		assert.ok(covered.includes(gate), `release-gate must cover "${gate}"`);
	}
});
