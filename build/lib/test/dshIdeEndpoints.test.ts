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
// 依据（只读核对 E:/deepseek-harness-0.2.2-rc.1/，本地静态源码，无真机观测）：
//   §8.10.9「D16 官方落点核对结论」。第 26 轮据此把唯一已核对完整 wire 形状的
//   setEffort 接线（session/projections → session/selectModel），故本表把
//   deleteSession + setEffort 标为已接线；第 32 轮据第 31 轮核实的 commands
//   wire 形状把 listCommands 接线，故本表为 3 个已接线 / 4 个继续 fail-closed；
//   第 33 轮把契约前置固化于 §8.10.10，第 34 轮按契约先行接线两者，故本表为
//   5 个已接线 / 2 个继续 fail-closed；第 21 轮把 loadOlder 按官方 session/page
//   形状对齐后接线，故本表为 6 个已接线 / 1 个继续 fail-closed（仅 rewind）。
// 形状一律以契约真源 dshIdeProtocol.ts 与 DSH 源码为准，不凭记忆臆造。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const protocol = read('src/vs/platform/dshClient/common/dshIdeProtocol.ts');
const transport = read('src/vs/platform/dshClient/transport/dshIdeTransport.ts');
const host = read('src/vs/platform/dshClient/host/ide-view-host.js');

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
		landing: null,
		evidence: 'session-controller/src/index.ts 20 个 @Remote 全量枚举无 rewind；ui-chat/src/client/model/conversation-context.ts:6 仅为 ConversationContextOriginKind 字面量',
		note: '官方无 rewind remote；它是客户端会话上下文概念（compaction/rewind/rewrite），不是 Host 端点。保持 fail-closed，不得用 fork/prompt 冒充。',
	},
	{
		method: 'loadOlder',
		landing: 'session/page',
		evidence: 'session-controller/src/index.ts:528 @Remote(page)；types.ts:469 SessionPageRequest{address,throughSeq?,beforeSeq?,maxMessages?,turnWindow?}；ui-trajectory/src/client/index.ts:102-104 session.loadOlder()',
		note: '已完成（代码侧，第 21 轮）：契约 loadOlder 已按官方 SessionPageRequest 对齐为 {sessionId, beforeSeq?:number, maxMessages?:number}；Host 调 sessionController.page()、transport 调 session/page args {request}；按 §2 §4 动作类口径返回 {accepted:true}，分页内容仍只经 listen(snapshot) 到达。',
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
		method: 'listCommands',
		landing: 'commands/list',
		evidence: 'interaction/commands/src/index.ts:314 @Remote list(agent)；ui-commands/src/client/service.ts:108 list(sessionId)；bundle/base/cordis.patch.yml:322 commands 默认在册；types.ts:57-66 CommandDescriptor；第 31 轮 wire 证据同 runCommand 行',
		note: '已完成（代码侧，第 32 轮）：据第 31 轮核实的 wire 形状接线两套 backend——Host 经 agents.get(sessionId)→commands.list(agent)、transport 调 commands/list {agentId}，共用 projectDshIdeCommandList 投影 {name,description}；6 项单测。运行时命令目录可用性归 U10 / U12 真机探针。',
	},
	{
		method: 'deleteSession',
		landing: 'workspaceRegistry/deleteSession（社区插件 endpoint）',
		evidence: '§8.10.7 官方入口不存在已定论；§8.10.8 第 20 轮批准调用 @michengai/dsh-archive-manager@1.3.1 的公开 endpoint；D51/D61 已实现',
		note: '已完成（代码侧）；运行时可用性归 U12 真机探针。不得回退到 rmSync / 归档 / 隐藏列表行。',
	},
];

/** 已完成（代码侧）：deleteSession、setEffort、listCommands、runCommand / setPermissionPreset、loadOlder（第 21 轮）。 */
const WIRED = ['deleteSession', 'setEffort', 'listCommands', 'runCommand', 'setPermissionPreset', 'loadOlder'];
/** 尚不允许接线的 1 个 method：rewind 无独立 remote，保持 fail-closed。 */
const UNVERIFIED = FINDINGS.filter(f => !WIRED.includes(f.method)).map(f => f.method);

// ---------------------------------------------------------------------------
// 契约口径：24 method 白名单（20 会话域 + 2 账号域 + 2 归档域）
// ---------------------------------------------------------------------------

	test('D16 contract still declares exactly 25 methods', () => {
	const block = /const DSH_IDE_METHOD_KEYS[\s\S]*?\n\};/.exec(protocol);
	assert.ok(block !== null, 'DSH_IDE_METHOD_KEYS must exist in the protocol single source');
	const keys = [...block[0].matchAll(/^\s*([a-zA-Z]+):/gm)].map(m => m[1]);
	assert.equal(keys.length, 25, `expected 25 methods, got ${keys.length}`);
	for (const f of FINDINGS) {
		assert.ok(keys.includes(f.method), `D16 finding must reference a real whitelist method: ${f.method}`);
	}
});

// ---------------------------------------------------------------------------
// fail-closed 守护：未核对形状的 method 在两套 backend 都必须显式拒绝，
// 不许悄悄接成「看起来成功」的假端点。
// ---------------------------------------------------------------------------

test('D16 transport keeps the unverified methods in the feature-unavailable stub', () => {
	const stub = /case 'rewind':[\s\S]*?throw new DshIdeTransportError\('dsh-ide\/feature-unavailable'/.exec(transport);
	assert.ok(stub !== null, 'transport must keep a single fail-closed stub for unverified methods');
	for (const method of UNVERIFIED) {
		assert.ok(stub[0].includes(`case '${method}':`), `${method} must stay in the transport fail-closed stub until its wire shape is verified`);
	}
	// 五个已接线的 method 绝不能回退成 stub。
	for (const method of WIRED) {
		assert.ok(!stub[0].includes(`case '${method}':`), `${method} must not fall back to the stub`);
	}
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

test('D16 findings are complete: 7 methods, each with evidence and a conclusion', () => {
	assert.equal(FINDINGS.length, 7);
	assert.deepEqual(FINDINGS.map(f => f.method).sort(),
		['deleteSession', 'listCommands', 'loadOlder', 'rewind', 'runCommand', 'setEffort', 'setPermissionPreset'].sort());
	for (const f of FINDINGS) {
		assert.ok(f.evidence.length > 20, `${f.method} must carry source evidence`);
		assert.ok(f.note.length > 10, `${f.method} must carry a conclusion / D13 prerequisite`);
	}
	// deleteSession / setEffort / listCommands / runCommand / setPermissionPreset / loadOlder 已完成；仅 rewind 保持 fail-closed。
	assert.equal(FINDINGS.filter(f => f.note.startsWith('已完成')).length, 6);
	assert.equal(UNVERIFIED.length, 1);
});

// ---------------------------------------------------------------------------
// 第 31 轮核对 commands scoped-remote 形状；第 32 轮据此只接线 listCommands，
// 其余两个（runCommand 拼接 / setPermissionPreset 斜杠语义）仍 fail-closed。
// 这里钉住「形状结论进 §8.10.9、listCommands 已接线、其余不抢跑」。
// ---------------------------------------------------------------------------

test('D16 round-21 commands family: 6 wired, only rewind still fail-closed', () => {
	const dev = read('docs/DEVELOPMENT.md');
	// 第 31 轮的 wire 形状结论仍是接线的唯一依据（agentId = sessionId 等）。
	assert.match(dev, /形状已核对（第 31 轮）/, '§8.10.9 must record the round-31 wire-shape conclusion');
	assert.match(dev, /agentId:\s*sessionId/, '§8.10.9 must name the agentId=sessionId wire identity');
	assert.match(dev, /lookups\.register\('agent'/, '§8.10.9 must cite the agent lookup declaration');
	assert.match(dev, /已完成（代码侧，第 34 轮）/, '§8.10.9 must record the round-34 wiring of both writers');
	// 执行纪律：接线后只剩 1 个 fail-closed（仅 rewind）。
	assert.match(dev, /其余 1 个[\s\S]{0,20}?method 在完成接线前必须/, 'discipline must keep the remaining method fail-closed');
	assert.equal(UNVERIFIED.length, 1, 'only rewind stays fail-closed');
	for (const method of ['rewind']) {
		const re = new RegExp(`${method}:\\s*missing\\('${method}'\\)`);
		assert.match(host, re, `${method} must stay missing(...) on the Host side`);
		const stub = /case 'rewind':[\s\S]*?throw new DshIdeTransportError\('dsh-ide\/feature-unavailable'/.exec(transport);
		assert.ok(stub !== null && stub[0].includes(`case '${method}':`), `${method} must stay in the transport fail-closed stub`);
	}
	// 两个已接线的 writer 绝不能回退成 stub / missing。
	assert.doesNotMatch(host, /runCommand:\s*missing\(/, 'runCommand must stay wired on Host');
	assert.doesNotMatch(host, /setPermissionPreset:\s*missing\(/, 'setPermissionPreset must stay wired on Host');
});

// ---------------------------------------------------------------------------
// 第 33 轮：runCommand / setPermissionPreset 的契约前置（§8.10.10）。
// wire 形状已核对，但 IDE 契约语义空白未补前不得接线；本断言钉住这段前置
// 清单与两套 backend 的拒绝状态，防止有人绕过第 2 章 §9 契约先行抢跑。
// ---------------------------------------------------------------------------

test('D16 round-33 contract prerequisite is documented (wired in round 34)', () => {
	const dev = read('docs/DEVELOPMENT.md');
	assert.match(dev, /#### 8\.10\.10[^\n]*契约前置/, '§8.10.10 must exist');
	// 5 项语义空白都要有源码依据与契约决定。
	for (const token of ['command` 是否带前导', 'args` 如何拼', '返回值如何映射动作类', 'Host 侧 `signal`', 'submittedAttachments`']) {
		assert.ok(dev.includes(token), `§8.10.10 must cover the ${token} gap`);
	}
	assert.match(dev, /必须先补契约真源，不得凭猜测实现/, '§8.10.10 must demand contract-first');
	assert.match(dev, /不是接线完成声明/, '§8.10.10 must not claim wiring is done');
	// setPermissionPreset 行的陈旧「wire 形状未核对」表述已被修正：
	// 只核 §8.10.9 结论表区，§7.7 历史记录引用该旧文案属合法追述，不误判。
	const tableStart = dev.indexOf('#### 8.10.9');
	const tableEnd = dev.indexOf('#### 8.10.10', tableStart);
	assert.ok(tableStart > 0 && tableEnd > tableStart, '§8.10.9 / §8.10.10 must both exist');
	assert.doesNotMatch(dev.slice(tableStart, tableEnd), /wire 形状未核对前不接线/, 'the stale pre-round-31 wording must be gone from the §8.10.9 conclusion table');
	// 第 34 轮接线两个 writer、第 21 轮接线 loadOlder；剩余 fail-closed 只有 rewind。
	assert.equal(UNVERIFIED.length, 1, 'only rewind stays fail-closed after the loadOlder wiring');
	for (const method of ['runCommand', 'setPermissionPreset', 'loadOlder']) {
		assert.ok(WIRED.includes(method), `${method} must be marked wired`);
	}
});

// ---------------------------------------------------------------------------
// D17：删除能力归属确认——`deleteSession` 必须是真正的物理删除端点调用，
// 不得用「关闭视图 / 隐藏列表行 / 本地 rmSync」冒充（§8.2.4、§8.10.7、§8.10.8）。
// 本条是源码级守护：行为级覆盖见 Host / transport 各自的 deleteSession 用例。
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
	// transport：唯一删除路径是 workspaceRegistry/deleteSession。
	assert.match(transport, /call\('workspaceRegistry',\s*'deleteSession',\s*\{ sessionId \}\)/,
		'transport must call the approved endpoint with the exact wire field');
	assert.doesNotMatch(transport, /deleteSessionViaPlugin[\s\S]{0,400}?\.close\(\)/,
		'transport must not close the stream/view as a substitute for deleting');
	// 只有 { deleted: true } 才能报告成功；其余一律拒绝。
	assert.match(transport, /value\['deleted'\] !== true/, 'transport must require the confirmed delete result');
	assert.match(host, /result\.deleted !== true/, 'Host must require the confirmed delete result');
	// 归属与判活前置必须保留。
	assert.match(host, /async deleteSession\(args\)\s*\{\s*bridge\.assertOwnership\(args\.sessionId\)/,
		'Host deleteSession must assert ownership first');
	assert.match(host, /if \(!\(await sessionExists\(bridge\.ctx, args\.sessionId\)\)\)/,
		'Host deleteSession must verify the session exists before calling the plugin');
});

// ---------------------------------------------------------------------------
// 第 38 轮：D59 的官方端点核对结论（§8.10.11）。
// 钉住「归档 / 置顶是官方公开 remote、当前契约仍是 22 method、尚未接线」，
// 防止下一轮凭记忆新增端点，或误以为它们和 deleteSession 一样依赖第三方插件。
// ---------------------------------------------------------------------------

	test('D59 archive endpoints are official remotes and now wired without third-party approval', () => {
		const dev = read('docs/DEVELOPMENT.md');
		assert.match(dev, /#### 8\.10\.11[^\n]*会话管理扩展的官方端点/, '§8.10.11 must exist');
		for (const endpoint of ['archiveSession', 'unarchiveSession', 'pinSession', 'unpinSession']) {
			assert.ok(dev.includes(endpoint), `§8.10.11 must name ${endpoint}`);
		}
		assert.match(dev, /api\/workspace-controller\/src\/index\.ts:159-162/, '§8.10.11 must cite the archiveSession remote');
		assert.match(dev, /stopActivity/, '§8.10.11 must record the stopActivity semantics');
		assert.match(dev, /workspace\/session-active/, '§8.10.11 must record the active-session rejection code');
		// 归档 / 恢复已按 §2 §9 走完契约先行并接线（第 19 轮）；契约现在恰 24 method。
		const block = /const DSH_IDE_METHOD_KEYS[\s\S]*?\n\};/.exec(protocol);
		assert.ok(block !== null);
		assert.equal([...block[0].matchAll(/^\s*([a-zA-Z]+):/gm)].length, 25, 'contract must declare 25 methods after the search wiring');
		for (const endpoint of ['archiveSession', 'unarchiveSession']) {
			assert.ok(protocol.includes(`${endpoint}:`), `${endpoint} must be a contract method`);
			assert.ok(transport.includes(`'${endpoint}'`), `${endpoint} must be called by the transport`);
			assert.ok(host.includes(`async ${endpoint}(args)`), `${endpoint} must be implemented by the Host bridge`);
		}
		// pin / unpin 仍未接线（D59 子项待逐项评估与批准）。
		for (const endpoint of ['pinSession', 'unpinSession']) {
			assert.ok(!protocol.includes(`${endpoint}:`), `${endpoint} must stay out of the contract until approved`);
			assert.ok(!transport.includes(`'${endpoint}'`), `${endpoint} must not be called yet`);
		}
		// 归档不依赖第三方插件：契约里不得出现 archive 的插件绑定常量。
		assert.doesNotMatch(protocol, /DSH_IDE_ARCHIVE_SESSION_PLUGIN/, 'archive must not require a third-party plugin binding');
	});

// ---------------------------------------------------------------------------
// D54（第 20 轮）：探针执行清单（§8.10.12）。
// 钉住「清单存在、三类齐全、条目编号可数、六列回填格式与 AI 不代跑纪律」，
// 防止清单被删空或倒退成无法执行的散文。
// ---------------------------------------------------------------------------

test('D54 probe checklist exists with U2/U3/U12 items and the six-column discipline', () => {
	const dev = read('docs/DEVELOPMENT.md');
	assert.match(dev, /#### 8\.10\.12[^\n]*探针执行清单/, '§8.10.12 must exist');
	// 六列回填格式。
	assert.match(dev, /断言 \/ 方法 \/ 观察值 \/ 结论 \/ 解锁或否决哪一步 \/ 对应 §0\.2 项/, 'the six-column format must be stated');
	// 三类探针与条目数量（U2 6 + U3 5 + U12 5 = 16）。
	//
	// 注意：只统计**定义表**范围，不统计「U3 探针执行结果」那张表（第 57 轮回填的
	// 结果表同样带 `U3-n` 标记；若连它也统计，5 会被数成 9——该 bug 本轮实测暴露并修正）。
	const secStart = dev.indexOf('#### 8.10.12');
	const resultAt = dev.indexOf('**U3 探针执行结果', secStart);
	const u12At = dev.indexOf('**U12 插件 endpoint', secStart);
	assert.ok(secStart > 0 && u12At > secStart, '§8.10.12 must precede the U12 checklist heading');
	assert.ok(resultAt > secStart && resultAt < u12At, 'the U3 execution-result table must sit between the definition tables');

	const definitions = dev.slice(secStart, resultAt) + dev.slice(u12At);
	for (const [prefix, count] of [['U2', 6], ['U3', 5], ['U12', 5]]) {
		const found = [...definitions.matchAll(new RegExp(`\\| ${prefix}-(\\d+) \\|`, 'g'))].map(m => Number(m[1]));
		assert.equal(found.length, count, `${prefix} must list ${count} probe items, got ${found.length}`);
		assert.deepEqual(found, [...Array(count).keys()].map(i => i + 1), `${prefix} items must be numbered 1..${count}`);
	}
	// 执行归用户、AI 不得代跑。
	assert.match(dev, /执行一律归用户/, 'the checklist must state that execution belongs to the user');
	assert.match(dev, /不得代跑 GUI/, 'the checklist must forbid the AI from running the GUI');
	assert.match(dev, /不是验收完成声明/, 'the checklist must not claim acceptance is done');
	// 不允许把未执行记成通过。
	assert.match(dev, /不得写「结论」/, 'a row without an observation must not carry a conclusion');
});

// ---------------------------------------------------------------------------
// 第 24 轮：listen 事件面的边界（§8.10.2 与契约注释的澄清）。
// 钉住「snapshot 是当前唯一事件名、扩展须先改契约」，防止在实现里私自加名字
// 或用自建出站通道把 waterfall 帧绕过契约送达。
// ---------------------------------------------------------------------------

test('round-24 listen event surface stays snapshot-only until the contract changes', () => {
	const protocol = read('src/vs/platform/dshClient/common/dshIdeProtocol.ts');
	const channel = read('src/vs/platform/dshClient/electron-main/dshIdeChannel.ts');
	const dev = read('docs/DEVELOPMENT.md');

	// 契约里有澄清注释，且明确「当前唯一」「须先改本契约」。
	assert.match(protocol, /当前唯一\*\*允许的事件名/, 'the contract must state that snapshot is currently the only event name');
	assert.match(protocol, /须\*\*先改本契约\*\*/, 'the contract must require a contract change before extending');
	// 通道实现只认这一个名字，其它返回 Event.None（行为未变）。
	assert.match(channel, /export const DSH_IDE_SNAPSHOT_EVENT = 'snapshot'/, 'the snapshot event name must stay "snapshot"');
	assert.match(channel, /if \(event !== DSH_IDE_SNAPSHOT_EVENT\) \{[\s\S]{0,80}?return Event\.None/, 'listen must keep returning Event.None for other names');
	// §8.10.2 的「允许」已限定为「须先改契约真源」。
	assert.match(dev, /`listen` \*\*可以\*\*增加官方事件名，但\*\*须先改契约真源\*\*/, '§8.10.2 must scope the permission to a prior contract change');
	// 实现里不得出现第二个 listen 事件名常量。
	assert.equal((channel.match(/DSH_IDE_[A-Z_]*EVENT\s*=/g) ?? []).length, 1, 'only one listen event-name constant may exist');
});

// ---------------------------------------------------------------------------
// 第 26 轮：D15 前置——官方语音服务的就绪语义核实（§8.10.13）。
// 钉住「只读核对结论已固化、DSH-IDE 仍无语音入口、未自建第二套识别后端」。
// ---------------------------------------------------------------------------

test('round-26 speech readiness findings are documented and no dictation backend exists', () => {
	const dev = read('docs/DEVELOPMENT.md');
	assert.match(dev, /#### 8\.10\.13[^\n]*DSH 实验语音服务的就绪语义/, '§8.10.13 must exist');
	// 关键源码事实与含义。
	for (const token of ['speechToText', 'experimental-speech-to-text-sensevoice', 'host-local', 'activation performs no downloads or model loading']) {
		assert.ok(dev.includes(token), `§8.10.13 must record ${token}`);
	}
	assert.match(dev, /不是接线完成声明/, '§8.10.13 must not claim wiring is done');
	assert.match(dev, /不得自建第二套识别后端/, '§8.10.13 must forbid a second recognizer backend');
	assert.match(dev, /§0\.2 U15/, '§8.10.13 must point at the user ruling for the entry decision');

	// DSH-IDE 现状：contrib/dsh 与 platform/dshClient 零语音/听写代码（未私自加后端）。
	const roots = ['src/vs/workbench/contrib/dsh', 'src/vs/platform/dshClient'];
	const pattern = /dictation|speechToText|speech-to-text|SenseVoice/i;
	const offenders: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) { walk(full); continue; }
			if (!/\.(ts|js|mjs)$/.test(entry.name)) { continue; }
			if (pattern.test(fs.readFileSync(full, 'utf8'))) { offenders.push(full); }
		}
	};
	for (const root of roots) { walk(path.join(repoRoot, root)); }
	assert.deepEqual(offenders, [], `no dictation backend may exist until the user rules on the entry: ${offenders.join(', ')}`);
});

// ---------------------------------------------------------------------------
// 第 27 轮：D56 可静态部分——`.npmrc` 的 target 不影响交付物（§8.10.14）。
// 用打包脚本自身的事实钉住：gulpfile 不读 .npmrc/target，也不重编译原生模块。
// ---------------------------------------------------------------------------

test('round-27 packaging never reads .npmrc target, so it cannot affect the artifact', () => {
	const gulp = read('build/gulpfile.vscode.ts');
	const dev = read('docs/DEVELOPMENT.md');

	// 结论已固化。
	assert.match(dev, /#### 8\.10\.14[^\n]*`target` 不影响交付物/, '§8.10.14 must exist');
	assert.match(dev, /不进入 `gulp dsh-ide-pack` 的交付物/, '§8.10.14 must state the conclusion');
	assert.match(dev, /必须真机实测/, '§8.10.14 must keep the runtime half for real-machine verification');

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
	// 顺序取自第 5 章 §2（四门禁 → test-dsh:all → docs-graph）。
	const order = [...script.matchAll(/script: '(verify:dsh-ide-[a-z-]+|test-dsh:all|verify:docs-graph)'/g)].map(m => m[1]);
	assert.deepEqual(order, [
		'verify:dsh-ide-protocol-single-source',
		'verify:dsh-ide-boundary',
		'verify:dsh-ide-projection-golden',
		'verify:dsh-ide-contract',
		'test-dsh:all',
		'verify:docs-graph',
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

test('D54 U3 probes were executed locally and recorded without overclaiming', () => {
	const dev = read('docs/DEVELOPMENT.md');

	// 四条已执行 + 一条未执行，必须写清。
	assert.match(dev, /U3 探针执行结果（第 57 轮/, '§8.10.12 must record the round-57 U3 execution');
	for (const id of ['U3-1', 'U3-2', 'U3-3', 'U3-5']) {
		assert.ok(dev.includes(id), `the executed probe ${id} must be recorded`);
	}
	assert.match(dev, /U3-4 仍未执行/, 'U3-4 must stay explicitly unexecuted (it deletes a real session)');

	// 两个否决项必须写进结论——它们是探针真正的产出。
	assert.match(dev, /否决[\s\S]{0,40}仅用存在性判定/, 'U3-3 must reject existence-only checks');
	assert.match(dev, /否决[\s\S]{0,40}纯字符串前缀/, 'U3-5 must reject string-prefix-only validation');

	// 不得把 D54 或 U3 标为全部完成。
	assert.match(dev, /D54 保持未完成/, 'D54 must stay unfinished because U3-4 is not executed');
});

// ---------------------------------------------------------------------------
// D62 第 58 轮：加载时序耦合的**静态可判定部分**已核实（§8.10.12 之后的 D62 段落）。
// 三个关键事实必须可复核：workspaceRegistry 是官方服务、DSH-IDE 用 ctx.inject
// 等它就绪（故无装载顺序依赖）、客户端可见性走 journal 的 direct 直调。
// ---------------------------------------------------------------------------

test('D62 workspaceRegistry is an official service and DSH-IDE waits for it via ctx.inject', () => {
	const host = read('src/vs/platform/dshClient/host/ide-view-host.js');
	const index = read('src/vs/platform/dshClient/index.js');

	// REQUIRED_SERVICES 必须含 workspaceRegistry：桥接以它为前提。
	assert.match(host, /REQUIRED_SERVICES = Object\.freeze\(\[[^\]]*'workspaceRegistry'/, 'workspaceRegistry must be a required service');

	// 必须用 ctx.inject 等依赖就绪后建桥（这正是「无装载顺序依赖」的依据）。
	assert.match(index, /ctx\.inject\(REQUIRED_SERVICES,/, 'the bridge must be built inside ctx.inject(REQUIRED_SERVICES, …)');

	// 服务缺失路径必须已 fail-closed。
	assert.match(host, /FEATURE_UNAVAILABLE/, 'a missing service must fail closed with FEATURE_UNAVAILABLE');
});

test('D62 findings are recorded with the three decided sub-questions', () => {
	const dev = read('docs/DEVELOPMENT.md');
	assert.match(dev, /D62 实证结论（第 58 轮/, '§8.10.12 must record the round-58 D62 findings');
	assert.match(dev, /官方服务，非插件 overlay/, 'workspaceRegistry ownership must be recorded as official');
	assert.match(dev, /无顺序依赖/, 'the absence of load-order dependency must be recorded');
	assert.match(dev, /进程内直调（`direct`）/, 'the direct-invocation decision must be recorded');
	assert.match(dev, /D62 保持未完成/, 'D62 must stay unfinished (UI copy + optional remote work remain)');
});

// ---------------------------------------------------------------------------
// D50 第 59 轮：三处缺口的精确现状已复核并有代码位置（§8.10.12 之后的 D50 段落）。
// 「DshIdeConsumer 存在但只管快照」是易被误读为「未实现」的关键事实，须钉住。
// ---------------------------------------------------------------------------

test('D50 gap analysis is recorded with concrete code locations', () => {
	const dev = read('docs/DEVELOPMENT.md');
	assert.match(dev, /D50 三处缺口的精确现状（第 59 轮复核/, 'the round-59 D50 gap analysis must be recorded');
	assert.match(dev, /都会接线|已接线 `answerWaterfall`|answerWaterfall`/, 'gap ① must cite the transport wiring');
	assert.match(dev, /主动丢弃|交回调用方/, 'gap ② must record the deliberate frame drop');
	assert.match(dev, /DshIdeConsumer` 未承接审批|只处理快照帧/, 'gap ③ must record that the consumer only handles snapshots');
	assert.match(dev, /D50 仍未完成/, 'D50 must stay unfinished');
});

test('DshIdeConsumer exists but its accept() only validates snapshots', () => {
	const consumer = read('src/vs/workbench/contrib/dsh/browser/dshIdeConsumer.ts');

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

test('D21 static precheck is recorded without claiming any acceptance item passed', () => {
	const dev = read('docs/DEVELOPMENT.md');

	assert.match(dev, /D21 九项的前置静态核查（第 61 轮/, 'the round-61 static precheck must be recorded');
	assert.match(dev, /不构成任何一项的通过结论/, 'the precheck must disclaim that it is not an acceptance result');
	assert.match(dev, /D21 整体保持未完成/, 'D21 must stay unfinished');
	assert.match(dev, /九项仍须由用户按固定顺序执行/, 'the nine items must stay with the user');

	// 第 6 项的两个静态事实必须写明（否则用户跑之前无法确认件齐）。
	assert.match(dev, /ptyHostMain\.js`\s*\*\*在产物中\*\*|ptyHostMain.*在产物中/, 'item 6 must record ptyHostMain presence');
	assert.match(dev, /5 个必需模块的 `\.node` \*\*全部随包\*\*/, 'item 6 must record all five native modules shipped');
});

// ---------------------------------------------------------------------------
// D26 第 62 轮：`contract` 门禁启用**指纹失败断言**。
// 第 61 轮及以前，门禁只把 4 个注入点的 sha256 打印出来、没有任何基线可比，
// 因此永远停在 PENDING 且无法发现漂移。现在契约里带 `sha256` 基线，门禁逐点比对，
// 不一致/缺失即 FAIL。本测试钉住「基线与实际一致」这一不变量。
// ---------------------------------------------------------------------------

test('D26 every patch point carries a sha256 baseline matching the actual file', async () => {
	const crypto = await import('node:crypto');
	const fsMod = await import('node:fs');
	const contract = read('src/vs/platform/dshClient/common/dshIdeContract.ts');

	const files = [...contract.matchAll(/\bfile:\s*'([^']+)'/g)].map(m => m[1]);
	const baselines = [...contract.matchAll(/\bsha256:\s*'([0-9a-f]{16})'/g)].map(m => m[1]);

	assert.equal(files.length, 4, 'four injection points must be declared');
	assert.equal(baselines.length, 4, 'each injection point must carry a sha256 baseline');

	for (let i = 0; i < files.length; i++) {
		const abs = path.join(repoRoot, files[i]);
		assert.ok(fsMod.existsSync(abs), `injection point file must exist: ${files[i]}`);
		const actual = crypto.createHash('sha256').update(fsMod.readFileSync(abs)).digest('hex').slice(0, 16);
		assert.equal(actual, baselines[i],
			`${files[i]} drifted from its baseline — update the contract baseline deliberately (see §5 §7)`);
	}
});

test('D26 the contract gate fails on fingerprint mismatch instead of only printing', () => {
	const gate = read('build/lib/dsh/verify/dshIdeVerify.mjs');
	assert.match(gate, /VSCODE_PATCH_POINTS 指纹与基线不符/, 'the gate must throw on drift');
	assert.match(gate, /mismatches\.push/, 'the gate must collect mismatches');
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

test('the documented distribution size matches the actual tgz on disk', async () => {
	const fsMod = await import('node:fs');
	const tgz = path.join(repoRoot, 'dist/dsh-ide-2.0.0.tgz');
	if (!fsMod.existsSync(tgz)) { return; } // 未打包时跳过（CI 的打包步骤尚未产出）

	const actual = fsMod.statSync(tgz).size;
	const dev = read('docs/DEVELOPMENT.md');
	// §0.1 的分发行以「第 NN 轮 … 实测 <bytes> B」陈述当前体积。
	const claimed = /第 \d+ 轮[^|\n]*?实测 ([\d,]+) B/.exec(dev)?.[1];
	assert.ok(claimed !== undefined, '§0.1 must state the measured distribution size');
	assert.equal(Number(claimed.replaceAll(',', '')), actual,
		`documented size ${claimed} B must equal the actual tgz ${actual} B（重打后请回写 §0.1）`);
});

test('no stale "still contains map" claims remain in the handbook', () => {
	const dev = read('docs/DEVELOPMENT.md');

	// 注意（第 66 轮踩到的第三次同类坑）：不能扫全文——§7.7 的每轮记录会**引用**被修正
	// 的过时表述作为证据（「P7 状态行仍写『仍含 map』」），那是有意保留的历史叙述。
	// 因此只检查 §7.7 之外的正文；第 42 轮（注释含被检查字符串）、第 64 轮（正则字面量）
	// 都是同一类「守护被自己的说明文字触发」的错误。
	// 只在**状态断言区**检查：`| P7 ` 状态行与 `| D29 ` 待办行必须不再声称「仍含 map」。
	//
	// 不扫全文的原因（第 66 轮第三次踩到同类坑）：§7.7 的每轮记录、以及 §0.1 的
	// 「最近一轮改动」摘要，都会**引用**被修正的旧表述作为证据；把那些也算过时是错的。
	// 第 42 轮（注释含被检查字符串）、第 64 轮（正则字面量）都是同一类自指错误。
	const stateRows = dev.split(/\r?\n/)
		.filter(line => line.startsWith('| P7 ') || line.startsWith('| D29 '));

	const offenders = stateRows.filter(line => line.includes('仍含 map') || line.includes('`*.js.map` 仍随包'));
	assert.deepEqual(offenders, [],
		'the P7 status row and D29 row must not claim maps are still shipped (found ' + offenders.length + ')');
});

// ---------------------------------------------------------------------------
// 第 67 轮：§0.2 用户动作的**阻塞理由**不得引用已完成项。
//
// 发现的过时：U10 的阻塞理由原文写「D46 / D49–D50 / D52 尚未实施」，但其中
// D46、D49、D52 早已完成，只有 D50 仍未完成；同时它的 U3 五条探针已有四条
// 由 AI 执行（第 57 轮）。这会让读者以为整条都动不了，实际只差真实 profile。
//
// 本测试对每条 `| Uxx |` 行做结构检查：若阻塞理由里出现 `Dxx`
// 而该 Dxx 在 §7.3 待办表里已是「已完成」，即判失败。
// ---------------------------------------------------------------------------

test('user-action blocker reasons must not cite already-completed todos', async () => {
	const fsMod = await import('node:fs');
	const dev = fsMod.readFileSync(path.join(repoRoot, 'docs/DEVELOPMENT.md'), 'utf8');

	// 收集 §7.3 待办表里已完成项的编号。
	const done = new Set();
	for (const line of dev.split(/\r?\n/)) {
		if (!line.startsWith('| D')) { continue; }
		const cells = line.split('|').map(c => c.trim());
		if (cells.length < 6) { continue; }
		const id = cells[1];
		const status = cells[4];
		if (/^D\d+$/.test(id) && status === '已完成') { done.add(id); }
	}
	assert.ok(done.size > 0, 'the todo table must list completed items');

	// 逐条检查用户动作行的**阻塞理由所在列**（第 4 列）。
	const offenders = [];
	for (const line of dev.split(/\r?\n/)) {
		if (!/^\| U\d+ /.test(line)) { continue; }
		const cells = line.split('|').map(c => c.trim());
		if (cells.length < 6) { continue; }
		const uid = cells[1];
		const reason = cells[4] ?? '';
		if (!reason.includes('暂阻塞')) { continue; }
		// 只看**否定式断言**：形如「Dxx 尚未实施 / 未完成 / 未做」。
		// 不能把所有 Dxx 都算进去——第 67 轮修正 U10 时，新理由里写了
		// 「D46、D49、D52 均已完成」作为证据，若按「出现即算」会把它自己判为过时
		// （第 42 / 64 / 66 轮之后的第四次同类自指错误）。
		for (const match of reason.matchAll(/(D\d+)\s*(?:尚未实施|尚未完成|未实施|未完成|未做)/g)) {
			if (done.has(match[1])) { offenders.push(`${uid} 声称 ${match[1]} 未完成，但它已完成`); }
		}
	}

	assert.deepEqual(offenders, [],
		'blocker reasons must be refreshed after their cited todos complete: ' + offenders.join('; '));
});

// ---------------------------------------------------------------------------
// 第 68 轮：`contract` 按 §9.3 启用**完整**失败断言——指纹 + 版本。
//
// 此前（第 62 轮及以前）它只比对指纹、末尾硬编码 `return 'PENDING'`，因此
// **永远不可能 PASS**，`release-gate` 也就永远拒绝。§9.3 明文规定变为
// 「全部相符 → PASS；任一不符 → FAIL」，本轮把版本比对补上，于是：
//   - 未设 `DSH_INSTALLED_VERSION` → 无法证明相符 → PENDING（与 upstreamDrift 口径一致）
//   - 设为 ≥ 校验版本 → PASS
//   - 设为更低版本 → FAIL
// 本测试用子进程实测这三条分支，防止以后又被改回「无条件 PENDING」。
// ---------------------------------------------------------------------------

test('D68 contract gate can actually reach PASS, and fails on a lower installed version', async () => {
	const { execFileSync } = await import('node:child_process');
	const script = path.join(repoRoot, 'build/lib/dsh/verify/dshIdeVerify.mjs');

	const run = env => {
		try {
			return { code: 0, out: execFileSync(process.execPath, [script, 'contract'], {
				cwd: repoRoot, encoding: 'utf8', env: { ...process.env, ...env },
			}) };
		} catch (error) {
			return { code: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
		}
	};

	// 未设版本：不得判 PASS（无法证明相符）。
	const unset = run({ DSH_INSTALLED_VERSION: '' });
	assert.match(unset.out, /STATUS: PENDING/, 'without DSH_INSTALLED_VERSION the gate must stay PENDING');

	// 版本相符：应当 PASS。
	const ok = run({ DSH_INSTALLED_VERSION: '0.2.2-rc.1' });
	assert.equal(ok.code, 0, 'a matching installed version must not fail the gate');
	assert.match(ok.out, /STATUS: PASS/, 'a matching installed version must yield PASS');

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

test('D69 projection-golden asserts real-sample P95 instead of only printing a note', () => {
	const gate = read('build/lib/dsh/verify/dshIdeVerify.mjs');

	// 必须有真实的度量函数与断言，而不是一句 PENDING 说明。
	assert.match(gate, /function probeRealSessionP95/, 'the gate must define the real-sample P95 probe');
	assert.match(gate, /真实样本 P95 \$\{p95\} B 超出阈值/, 'the gate must throw when P95 exceeds the limit');

	// 第 74 轮补强：光有文本还不够——**阈值必须真的参与判定**。
	// guard-negative 的「P95 阈值断言守护」用例会把 `const limit = 512 * 1024;` 改成
	// `1`，若本测试只做文本匹配就不会失败（实测确认过这个漏洞）。因此这里断言
	// 「limit 必须来自那个可被破坏的常量」，使改动常量能被抓住。
	assert.match(gate, /const limit = 512 \* 1024;/, 'the P95 limit must be the 512 KiB constant (guard-negative breaks it)');
	assert.match(gate, /p95 > limit/, 'the limit must actually be compared against p95');
	// 只禁止**代码行**里的旧说明；注释中保留「此前只有一行 console.log(...)」作为历史
	// 记录是有意的（第 42 / 64 / 66 / 67 轮反复踩到的自指陷阱：守护不能扫自己的说明文字）。
	const codeLines = gate.split(/\r?\n/).filter(line => !line.trimStart().startsWith('//'));
	assert.equal(
		codeLines.filter(line => line.includes("PENDING(P6): 真实事件流 P95 字节数校准")).length, 0,
		'the old print-only note must not survive in executable code');
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
	const dev = read('docs/DEVELOPMENT.md');
	const ci = read('build/lib/dsh/verify/dshIdeCi.mjs');

	// 文档三步必须都在。
	assert.match(dev, /接入清单（第 70 轮补全，任何平台通用）/, 'the checklist must exist');
	assert.match(dev, /`npm ci`（需要 `node_modules\/`）/i, 'step 1 must name npm ci');
	assert.match(dev, /`npm run build-dsh-tests`[\s\S]{0,40}`out\/`/, 'step 1 must name the build command for out/');
	assert.match(dev, /设 `DSH_INSTALLED_VERSION`/, 'step 2 must name the version variable');
	assert.match(dev, /只有 `verify:` 开头的步骤才解析 `STATUS:`/, 'step 3 must state the STATUS-parsing scope');

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

test('D76 manual-only checkers stay out of CI and say so in the handbook', () => {
	const dev = read('docs/DEVELOPMENT.md');
	const ci = read('build/lib/dsh/verify/dshIdeCi.mjs');

	// 第 77 轮扩充：覆盖矩阵显示共有 **5 个** 脚本不在 CI、也不在 test-dsh:all 里。
	// 三个依赖本机状态（artifact / install-drift / real-p95），另有两个：
	//   - guard-negative：会临时改写源文件后还原，CI 中途崩溃会留脏工作区；
	//   - release-gate：判定逻辑与 CI 聚合等价（都要求 code===0 && status==='PASS'），
	//     CI 已等价拒绝，它是独立复核入口。
	// 五者的「不纳入」都必须写明理由，否则接入者会以为 CI 覆盖了全部检查。
	const manualOnly = [
		'verify:dsh-artifact',
		'verify:dsh-install-drift',
		'verify:dsh-real-p95',
		'verify:dsh-guard-negative',
		'verify:dsh-ide-release-gate',
	];
	for (const script of manualOnly) {
		// ① 不在 CI 聚合的步骤表里。
		assert.ok(!ci.includes(script),
			`${script} depends on local state and must not be a CI step`);
		// ② 手册**命令表**里那一行带「手动核对，不纳入 verify:dsh-ide-ci」标注。
		//
		// 注意：不能取「第一个包含脚本名的行」——§0.1 的分发体积行也提到
		// verify:dsh-artifact（作为证据引用），会先被匹配到。故要求该行以
		// 「| <中文标题>（第 NN 轮」开头，即命令表的行形态。
		// 命令表行的形态不统一：多数是「| <标题>（第 NN 轮…」，但 release-gate 那行是
		// 「| 发布聚合（§9.4，D57，…」。故只要求「以 | 开头、第二格含 `npm run <script>`」，
		// 用后者精确定位，避免误命中 §0.1 等处的证据性引用。
		// 直接找「**同时**含该命令与手动核对标注」的行——因为脚本名也可能出现在别处
		// （§0.1 的分发体积行就把 verify:dsh-artifact 当证据引用）。这正是第 42 / 64 /
		// 66 / 67 / 74 / 76 轮反复踩到的自指陷阱：**匹配条件必须精确到目标行**。
		// 排除 §7.7 的轮次记录行（形如「| 90 | 2026-11-12 / `hash` | …」）——那里也会
		// **引用**脚本名与「手动核对，不纳入」作为该轮证据，若纳入匹配就会掩盖真问题。
		// 这是本仓库第七次遇到同类自指陷阱（42 / 64 / 66 / 67 / 74 / 76 / 77），
		// 因此这里同时排除「第二格是纯数字轮次号」与「含日期 + commit」的行。
		const isRoundRecord = line => {
			const cells = line.split('|');
			const second = (cells[1] ?? '').trim();
			return /^\d+$/.test(second);
		};
		const row = dev.split(/\r?\n/).find(line =>
			line.startsWith('| ') && !isRoundRecord(line) &&
			line.includes(script) && line.includes('手动核对，不纳入'));
		assert.ok(row !== undefined,
			`${script} must appear on a command-table row that states 手动核对，不纳入`);
	}
});
