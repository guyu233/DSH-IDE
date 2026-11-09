/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P4 验收单测：DSH Chat Agent（Chat 面板的唯一内容供给方）。
//
// 守护点：
//   - 元数据满足 `IChatAgentData` 必填项，且是唯一的默认参与者（不存在第二个 AI 供给方）；
//   - `invoke` 把用户输入交给 DSH（`submit`），失败时明确报错、不伪造回答；
//   - 内容回显只来自 DTO 行，且尊重取消令牌。
//
// 运行：node --experimental-strip-types --test build/lib/test/dshChatAgent.test.ts
// Agent 与 CancellationToken 经 out/ 加载（依赖 base/common 的 .js 说明符与 namespace 声明）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
// 经 out/ 加载：cancellation.ts 含 namespace 声明，strip-types 模式不支持。
import { CancellationTokenSource } from '../../../out/vs/base/common/cancellation.js';
import type { DshIdeRow } from '../../../src/vs/platform/dshClient/common/dshIdeProtocol.ts';
import {
	DSH_CHAT_AGENT_ID,
	DshChatAgent,
	dshChatAgentData,
} from '../../../out/vs/workbench/contrib/dsh/browser/dshChatAgent.js';

function row(overrides: Partial<DshIdeRow> & { id: string }): DshIdeRow {
	return { revision: 1, kind: 'assistant', text: `text-${overrides.id}`, folded: false, ...overrides };
}

/** 假 client：记录调用，按预设返回。 */
function fakeClient(result: { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }) {
	const calls: { method: string; args: unknown }[] = [];
	return {
		calls,
		call: async (method: string, args?: Record<string, unknown>) => {
			calls.push({ method, args });
			return result;
		},
	};
}

function fakeRequest(message: string) {
	return { sessionResource: undefined, requestId: 'r1', agentId: DSH_CHAT_AGENT_ID, message, variables: {}, location: 'panel' } as never;
}

function collect() {
	const parts: unknown[] = [];
	return { parts, progress: (p: unknown[]) => { parts.push(...p); } };
}

// ---------------------------------------------------------------------------
// 元数据
// ---------------------------------------------------------------------------

test('agent metadata satisfies the required IChatAgentData fields', () => {
	const data = dshChatAgentData();
	assert.equal(data.id, DSH_CHAT_AGENT_ID);
	assert.equal(data.isDefault, true, 'the DSH agent must be the default participant');
	assert.equal(data.isCore, true);
	assert.equal(data.isDynamic, true);
	assert.deepEqual(data.slashCommands, []);
	assert.deepEqual(data.locations, ['panel'], 'the agent serves the chat panel only');
	assert.deepEqual(data.modes, ['ask']);
	assert.deepEqual(data.disambiguation, []);
	assert.equal(data.metadata.isSticky, true);
});

test('only one default AI supplier exists in this metadata', () => {
	// 若将来出现第二个 `isDefault: true` 的 Agent，这条会提醒必须走架构裁定。
	assert.equal(dshChatAgentData().isDefault, true);
	assert.equal(dshChatAgentData().id, 'dsh-ide');
});

// ---------------------------------------------------------------------------
// invoke：提交与回显
// ---------------------------------------------------------------------------

test('invoke submits the user message to DSH', async () => {
	const client = fakeClient({ ok: true, value: { accepted: true } });
	// 快照立即有一行新内容，避免走到超时分支。
	let rows: DshIdeRow[] = [];
	const agent = new DshChatAgent(client as never, () => rows, 2000);
	const { parts, progress } = collect();
	setTimeout(() => { rows = [row({ id: 'a1', kind: 'assistant', text: 'ok' })]; }, 30);
	await agent.invoke(fakeRequest('hello'), progress, [], new CancellationTokenSource().token);

	assert.deepEqual(client.calls, [{ method: 'submit', args: { text: 'hello' } }]);
	assert.equal(parts.length, 1, 'the one new row is rendered');
	agent.dispose();
});

test('invoke surfaces a submit failure instead of fabricating an answer', async () => {
	const client = fakeClient({ ok: false, error: { code: 'dsh-ide/feature-unavailable', message: 'not wired' } });
	const agent = new DshChatAgent(client as never, () => [row({ id: 'a1' })], 200);
	const { parts, progress } = collect();
	const result = await agent.invoke(fakeRequest('hi'), progress, [], new CancellationTokenSource().token);

	assert.equal(parts.length, 1, 'a single explicit error message, never a fake answer');
	assert.match((parts[0] as { content: { value: string } }).content.value, /feature-unavailable/);
	assert.equal((result as { errorDetails?: { message: string } }).errorDetails?.message, 'not wired');
	agent.dispose();
});

test('invoke waits for the snapshot to grow, then echoes only the new rows', async () => {
	const client = fakeClient({ ok: true, value: { accepted: true } });
	// 提交前只有 1 行历史；提交后快照才会长出用户消息与回答。
	const history = [row({ id: 'a0', kind: 'assistant', text: 'old answer' })];
	let rows = history;
	const agent = new DshChatAgent(client as never, () => rows, 2000);
	const { parts, progress } = collect();

	// 模拟 DSH 在稍后提交会话日志：60ms 后把新行放进去。
	setTimeout(() => {
		rows = [...history, row({ id: 'u1', kind: 'user', text: 'question' }), row({ id: 'a1', kind: 'assistant', text: 'answer' })];
	}, 60);

	await agent.invoke(fakeRequest('q'), progress, [], new CancellationTokenSource().token);

	assert.deepEqual(
		parts.map(p => (p as { content: { value: string } }).content.value),
		['question', 'answer'],
		'only rows appended after submit are echoed (history is not redrawn)',
	);
	for (const part of parts) {
		assert.equal((part as { kind: string }).kind, 'markdownContent');
	}
	agent.dispose();
});

test('invoke reports a wait timeout instead of pretending there is content', async () => {
	const client = fakeClient({ ok: true, value: { accepted: true } });
	// 快照始终不增长：agent 必须在超时后给明确说明，而不是空手返回。
	const agent = new DshChatAgent(client as never, () => [row({ id: 'a0' })], 80);
	const { parts, progress } = collect();
	await agent.invoke(fakeRequest('q'), progress, [], new CancellationTokenSource().token);

	assert.equal(parts.length, 1);
	assert.match((parts[0] as { content: { value: string } }).content.value, /没有收到会话日志更新/);
	agent.dispose();
});

test('invoke stops echoing when the request is cancelled', async () => {
	const client = fakeClient({ ok: true, value: { accepted: true } });
	const agent = new DshChatAgent(client as never, () => [row({ id: 'a1' }), row({ id: 'a2' })], 200);
	const { parts, progress } = collect();
	const source = new CancellationTokenSource();
	source.cancel();
	await agent.invoke(fakeRequest('q'), progress, [], source.token);
	assert.deepEqual(parts, [], 'a cancelled request renders nothing');
	agent.dispose();
});
