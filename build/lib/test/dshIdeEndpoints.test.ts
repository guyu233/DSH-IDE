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
//   deleteSession + setEffort 标为已接线、其余 5 个继续钉死 fail-closed。
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
		note: '落点存在但契约 {before?:string} 与官方 beforeSeq:number 不是同一形状，且官方经 client session 对象封装。映射未验证前保持 fail-closed。',
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
		note: '第 31 轮：commands/execute 的 args 精确为 { agentId: sessionId, line, submittedAttachments }（信号不入 args）。形状已核对，但 /permission 斜杠命令拼接属 D13，保持 fail-closed。',
	},
	{
		method: 'runCommand',
		landing: 'commands/execute',
		evidence: 'interaction/commands/src/index.ts:360 @Remote execute(agent,line,submittedAttachments,signal)；ui-plan/src/client/index.ts:122、ui-commands/src/client/service.ts:423 execute(sessionId,line,attachments)；core/agent/src/index.ts:266-273 lookups.register(agent,{wire:agentId,SessionId})；session-controller/src/client/index.ts:141 identity()=sessionId；gateway/client/index.ts:518-533 args[agentId]=identity；gateway/index.ts:1269-1273/:1630-1655',
		note: '第 31 轮：wire 形状已核对——commands/execute args={agentId,line,submittedAttachments}，signal 由 cancellation 承载，line=/name+rawInput（parseCommand :125-131）。契约 {command,args?}→line 拼接与 attachments 投影属 D13，保持 fail-closed。',
	},
	{
		method: 'listCommands',
		landing: 'commands/list',
		evidence: 'interaction/commands/src/index.ts:314 @Remote list(agent)；ui-commands/src/client/service.ts:108 list(sessionId)；bundle/base/cordis.patch.yml:322 commands 默认在册；types.ts:57-66 CommandDescriptor；第 31 轮 wire 证据同 runCommand 行',
		note: '第 31 轮：wire 形状已核对——commands/list args={agentId:sessionId}、返回 name 排序的 CommandDescriptor[]。IDE 列表类中立投影与 Host 侧 Agent 解析属 D13，保持 fail-closed。',
	},
	{
		method: 'deleteSession',
		landing: 'workspaceRegistry/deleteSession（社区插件 endpoint）',
		evidence: '§8.10.7 官方入口不存在已定论；§8.10.8 第 20 轮批准调用 @michengai/dsh-archive-manager@1.3.1 的公开 endpoint；D51/D61 已实现',
		note: '已完成（代码侧）；运行时可用性归 U12 真机探针。不得回退到 rmSync / 归档 / 隐藏列表行。',
	},
];

/** 已完成（代码侧）的 method：deleteSession（第 21 轮）与 setEffort（第 26 轮）。 */
const WIRED = ['deleteSession', 'setEffort'];
/** 尚不允许接线的 5 个 method：其余形状未核对者全部保持 fail-closed。 */
const UNVERIFIED = FINDINGS.filter(f => !WIRED.includes(f.method)).map(f => f.method);

// ---------------------------------------------------------------------------
// 契约口径：22 method 白名单（20 会话域 + 2 账号域）
// ---------------------------------------------------------------------------

test('D16 contract still declares exactly 22 methods', () => {
	const block = /const DSH_IDE_METHOD_KEYS[\s\S]*?\n\};/.exec(protocol);
	assert.ok(block !== null, 'DSH_IDE_METHOD_KEYS must exist in the protocol single source');
	const keys = [...block[0].matchAll(/^\s*([a-zA-Z]+):/gm)].map(m => m[1]);
	assert.equal(keys.length, 22, `expected 22 methods, got ${keys.length}`);
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
	// 两个已接线的 method 绝不能回退成 stub。
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
	// deleteSession 与 setEffort 已完成（代码侧）；其余 5 个保持未核对形状。
	assert.equal(FINDINGS.filter(f => f.note.startsWith('已完成')).length, 2);
	assert.equal(UNVERIFIED.length, 5);
});

// ---------------------------------------------------------------------------
// 第 31 轮：commands scoped-remote 的 wire 形状已核对，但接线仍归 D13。
// 这里钉住「形状结论进了 §8.10.9，且三个 method 仍 fail-closed」，防止有人
// 借「形状已知」之名把未做契约先行/单测的调用抢跑接进两套 backend。
// ---------------------------------------------------------------------------

test('D16 round-31 commands wire shape is documented but still fail-closed', () => {
	const dev = read('docs/DEVELOPMENT.md');
	// 形状结论落在 §8.10.9（agentId = sessionId、字段名 = 参数名、signal 不入 args）。
	assert.match(dev, /形状已核对（第 31 轮）/, '§8.10.9 must record the round-31 wire-shape conclusion');
	assert.match(dev, /agentId:\s*sessionId/, '§8.10.9 must name the agentId=sessionId wire identity');
	assert.match(dev, /lookups\.register\('agent'/, '§8.10.9 must cite the agent lookup declaration');
	assert.match(dev, /仍不接线/, '§8.10.9 must keep the no-wiring decision');
	assert.match(dev, /属 D13 功能工作/, '§8.10.9 must attribute wiring to D13');
	// 执行纪律：5 个未接线 method 仍保持 fail-closed。
	assert.match(dev, /其余 5 个\s*method 在完成接线前必须保持 fail-closed/, 'discipline must keep the 5 methods fail-closed');
	// 两套 backend 的拒绝状态一字未动。
	assert.equal(UNVERIFIED.length, 5, 'the shape conclusion must not change the fail-closed set');
	for (const method of ['runCommand', 'listCommands', 'setPermissionPreset']) {
		const re = new RegExp(`${method}:\\s*missing\\('${method}'\\)`);
		assert.match(host, re, `${method} must stay missing(...) on the Host side`);
	}
	const stub = /case 'rewind':[\s\S]*?throw new DshIdeTransportError\('dsh-ide\/feature-unavailable'/.exec(transport);
	assert.ok(stub !== null);
	for (const method of ['runCommand', 'listCommands', 'setPermissionPreset']) {
		assert.ok(stub[0].includes(`case '${method}':`), `${method} must stay in the transport fail-closed stub`);
	}
});
