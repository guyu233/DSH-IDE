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
