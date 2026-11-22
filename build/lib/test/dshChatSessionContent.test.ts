/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// `dsh` 会话内容提供者的节点 → 原生 history 映射单测。
// 这是「选中会话后消息不显示」的补齐点：断言用户消息开 request、助手内容进 response。
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshChatSessionContent.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { toHistory } from '../../../out/vs/workbench/contrib/dsh/browser/vscode/dshChatHistory.js';

/** 最小节点来源：只实现 `toHistory` 用到的 `nodes()`。 */
function session(nodes: readonly unknown[]) {
	return { nodes: () => nodes } as never;
}

function markdownText(part: unknown): string | undefined {
	if (part !== null && typeof part === 'object' && (part as { kind?: string }).kind === 'markdownContent') {
		const content = (part as { content?: { value?: unknown } }).content;
		return typeof content?.value === 'string' ? content.value : undefined;
	}
	return undefined;
}

test('a user message opens a request and the assistant reply fills its response', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 10, content: [{ type: 'text', text: '你好' }] },
		{ kind: 'assistant', seq: 2, time: 11, turn: 1, step: 1, blocks: [{ kind: 'text', text: '你好，有什么可以帮你？' }] },
	]));
	assert.equal(history.length, 2);
	assert.equal(history[0].type, 'request');
	assert.equal(history[1].type, 'response');
	if (history[0].type === 'request') {
		assert.equal(history[0].prompt, '你好');
		assert.equal(history[0].timestamp, 10);
	}
	if (history[1].type === 'response') {
		assert.equal(markdownText(history[1].parts[0]), '你好，有什么可以帮你？');
	}
});

test('multiple turns produce one request/response pair each', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'q1' }] },
		{ kind: 'assistant', seq: 2, time: 2, turn: 1, step: 1, blocks: [{ kind: 'text', text: 'a1' }] },
		{ kind: 'user', seq: 3, time: 3, content: [{ type: 'text', text: 'q2' }] },
		{ kind: 'assistant', seq: 4, time: 4, turn: 2, step: 1, blocks: [{ kind: 'text', text: 'a2' }] },
	]));
	assert.deepEqual(history.map(item => item.type), ['request', 'response', 'request', 'response']);
	const prompts = history.filter(item => item.type === 'request').map(item => (item as { prompt: string }).prompt);
	assert.deepEqual(prompts, ['q1', 'q2']);
});

test('tool results and errors are rendered instead of dropped', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'run' }] },
		{ kind: 'tool-result', seq: 2, time: 2, callId: 'c1', name: 'read', args: {}, content: [{ type: 'text', text: 'file body' }], isError: false, subCalls: [] },
		{ kind: 'turn-error', seq: 3, time: 3, turn: 1, step: 1, message: 'boom' },
	]));
	const response = history[1];
	assert.equal(response.type, 'response');
	if (response.type === 'response') {
		// 工具结果现在是原生 toolInvocationSerialized（2-B B1），不再是 markdown；错误走 response.errorDetails。
		const tool = response.parts.find(part => part.kind === 'toolInvocationSerialized') as { toolSpecificData?: { output?: string } } | undefined;
		assert.ok(tool?.toolSpecificData?.output?.includes('file body'));
		assert.equal(response.errorDetails?.message, 'boom');
	}
});

test('reasoning blocks become thinking parts', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'q' }] },
		{ kind: 'assistant', seq: 2, time: 2, turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: 'thinking...' }] },
	]));
	const response = history[1];
	if (response.type === 'response') {
		const thinking = response.parts.find(part => (part as { kind?: string }).kind === 'thinking');
		assert.ok(thinking !== undefined);
		assert.equal((thinking as { value?: string }).value, 'thinking...');
	}
});

test('content without a leading user message still produces a visible response', () => {
	const history = toHistory(session([
		{ kind: 'inherited-history', seq: 1, time: 1 },
	]));
	assert.equal(history.length, 2);
	assert.equal(history[0].type, 'request');
	assert.equal(history[1].type, 'response');
});

test('an empty session has no history', () => {
	assert.deepEqual(toHistory(session([])), []);
});

test('pending approvals merge into the last response as warning plus approve/reject commands', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'q' }] },
		{ kind: 'assistant', seq: 2, time: 2, turn: 1, step: 1, blocks: [{ kind: 'text', text: 'a' }] },
	]), [{ eventId: 'e-1', kind: 'approval', title: 'DSH 请求运行 shell', options: [] }]);
	// 待决议卡并进最后一条 response（不能单开陈旧 response，否则按钮被禁用）。
	assert.equal(history.length, 2);
	const last = history.at(-1);
	assert.equal(last?.type, 'response');
	if (last?.type === 'response') {
		assert.equal((last.parts[0] as { kind: string }).kind, 'markdownContent');
		// 标题是任务行；Allow / Reject 仍是 command，因为原生 confirmation 会另发请求。
		assert.ok(last.parts.some(part => (part as { kind: string }).kind === 'progressTaskSerialized'));
		const commands = last.parts.filter(part => (part as { kind: string }).kind === 'command') as { command: { id: string; title: string; arguments?: readonly unknown[] } }[];
		assert.deepEqual(commands.map(c => c.command.title), ['Allow', 'Reject']);
		assert.deepEqual(commands[0].command.arguments, ['e-1', 'approve']);
		assert.deepEqual(commands[1].command.arguments, ['e-1', 'reject']);
	}
});

test('pending questions render one command per option', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'q' }] },
	]), [{ eventId: 'q-1', kind: 'question', title: '继续吗', options: ['继续', '停止'], questionId: 'q1' }]);
	const last = history.at(-1);
	if (last?.type === 'response') {
		const commands = last.parts.filter(part => (part as { kind: string }).kind === 'command') as { command: { id: string; title: string; arguments?: readonly unknown[] } }[];
		assert.deepEqual(commands.map(c => c.command.title), ['继续', '停止']);
		assert.ok(commands.every(c => c.command.id === 'dsh.answerQuestion'));
	}
});

test('pending on an empty session still gets its own response', () => {
	const history = toHistory(session([]), [{ eventId: 'e-9', kind: 'approval', title: '空会话审批', options: [] }]);
	assert.equal(history.length, 1);
	assert.equal(history[0].type, 'response');
});

test('no pending items adds no extra history rows', () => {
	assert.deepEqual(toHistory(session([]), []), []);
});

test('deliverables render as clickable file references', () => {
	const history = toHistory(session([
		{ kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'q' }] },
	]), [], {
		deliverables: [{ turn: 1, callId: 'p1', files: [{ path: 'docs/a.md', description: '说明' }, { path: 'docs/b.md' }] }],
	});
	const last = history.at(-1);
	assert.equal(last?.type, 'response');
	if (last?.type === 'response') {
		const refs = last.parts.filter(part => part.kind === 'reference') as { reference: string }[];
		assert.deepEqual(refs.map(ref => ref.reference), ['docs/a.md', 'docs/b.md']);
	}
});

test('an absolute deliverable path becomes a file URI and a relative path stays a string', () => {
	const absolute = process.platform === 'win32' ? 'C:\\repo\\a.md' : '/repo/a.md';
	const history = toHistory(session([]), [], {
		deliverables: [{ turn: 1, callId: 'p1', files: [{ path: absolute }, { path: 'docs/b.md' }] }],
	});
	const last = history.at(-1);
	assert.equal(last?.type, 'response');
	if (last?.type === 'response') {
		const refs = last.parts.filter(part => part.kind === 'reference') as { reference: string | { fsPath: string } }[];
		assert.equal(typeof refs[0].reference, 'object');
		const actual = refs[0].reference instanceof Object && 'fsPath' in refs[0].reference
			? refs[0].reference.fsPath.replace(/\\/g, '/')
			: '';
		const expected = process.platform === 'win32' ? 'C:/repo/a.md' : '/repo/a.md';
		assert.equal(actual.toLowerCase(), expected.toLowerCase());
		assert.equal(refs[1].reference, 'docs/b.md');
	}
});

test('quota notice is a response-level quota error and todos stay visible', () => {
	const history = toHistory(session([]), [], {
		quotaNotice: { code: 'ACCOUNT_QUOTA', seq: 5 },
		todos: [
			{ content: '写测试', status: 'completed' },
			{ content: '跑门禁', status: 'in_progress' },
		],
	});
	const response = history.find(item => item.type === 'response');
	assert.ok(response !== undefined && response.type === 'response');
	if (response?.type === 'response') {
		// 2-B B4：额度提示升级为 response.errorDetails.isQuotaExceeded（带原生配额升级入口）。
		assert.equal(response.errorDetails?.isQuotaExceeded, true);
		assert.equal(response.parts.some(part => part.kind === 'warning'), false);
		// Todo 走原生任务行，额度错误不影响它继续显示。
		const tasks = response.parts.filter(part => part.kind === 'progressTaskSerialized') as { progress: { content: { value: string } }[] }[];
		assert.equal(tasks.length, 1);
		assert.ok(tasks[0].progress.some(part => part.content.value.includes('[x] 写测试')));
		assert.ok(tasks[0].progress.some(part => part.content.value.includes('[-] 跑门禁')));
	}
});

test('plan and goal state are visible in the transcript', () => {
	const history = toHistory(session([]), [], {
		plan: { active: true, pending: false },
		goal: { goal: { objective: '完成手册', phase: 'active' }, roundsStarted: 3 },
	});
	const response = history.find(item => item.type === 'response');
	if (response?.type === 'response') {
		const tasks = response.parts.filter(part => part.kind === 'progressTaskSerialized') as { content: { value: string } }[];
		assert.ok(tasks.some(part => part.content.value.includes('Plan mode is on')));
		assert.ok(tasks.some(part => part.content.value.includes('完成手册') && part.content.value.includes('3 rounds')));
	}
});

// ---------------------------------------------------------------------------
// 会话选项组：`dsh:` 是真实资源，原生服务只对 `/untitled-*` 拉选项组，
// content provider 必须补一次，否则模型/权限/预设三个选择器全部读不到。
//
// 这里用源码断言而不是 import：该 provider 的运行期依赖链会加载 `.css`，
// node 的 strip-types 模式无法解析（仓库里同类「接线存在」的断言都用这个办法）。
// ---------------------------------------------------------------------------
test('the content provider seeds option groups for a real dsh session', () => {
	const file = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatSessionContent.ts', import.meta.url), 'utf8');
	assert.match(file, /getNewChatSessionInputState\(DSH_CHAT_SESSION_TYPE, sessionResource\)/,
		'the provider must ask the sessions service for dsh option groups');
	assert.match(file, /updateSessionOptions\(sessionResource, options\)/,
		'the selected values must reach the session options map (otherwise every group stays invisible)');
	assert.match(file, /void this\.registerSessionOptions\(sessionResource\);/,
		'provideChatSessionContent must trigger the seeding for real resources');
});

test('one frame rebuilds the history once, not once per event', () => {
	// 一帧内容会连发 pending / extras / nodes 三个事件。每个都全量重建 history 的话，
	// 同一帧要跑三遍 O(节点数) 的投影——这是滚动长会话时最直接的 CPU 开销。
	const file = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatSessionContent.ts', import.meta.url), 'utf8');
	assert.match(file, /queueMicrotask/, 'rebuilds must be coalesced');
	assert.match(file, /let rebuildScheduled = false/, 'a second event in the same frame must be dropped');
	const history = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatHistory.ts', import.meta.url), 'utf8');
	assert.match(history, /const nodes = session\.nodes\(\)/, 'the node list must be read once per projection');
	assert.equal((history.match(/session\.nodes\(\)/g) ?? []).length, 1, 'toHistory must not walk the node list twice');
});

test('a pending interaction blocks sending while keeping the draft editable', () => {
	// 官方 `IChatSession.isInputBlocked`：「Temporarily prevents sending while keeping the draft
	// visible and editable」。DSH 的待决审批/问卷/计划审阅正好是这个语义，原生 ChatWidget
	// 已经把它接到 ChatContextKeys.inputBlocked 与提交门禁上，DSH 只需提供这个 observable。
	const file = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatSessionContent.ts', import.meta.url), 'utf8');
	assert.match(file, /get isInputBlocked\(\): IObservable<boolean>/, 'the session must expose isInputBlocked');
	assert.match(file, /this\._session\.onDidChangePending/, 'blocking must follow the pending set, not a timer');
	assert.match(file, /this\._session\.pending\(\)\.length > 0/, 'blocked exactly while something is pending');
});
test('a truncated backfill says so instead of pretending the history is complete', () => {
	// 后台补历史有页数上限（40）。到上限时 Host 仍说 hasMore，原先直接 return，
	// 用户看到的是一个「到底了」的面板，实际更早的记录还在 Host 上。
	const file = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatSessionContent.ts', import.meta.url), 'utf8');
	assert.match(file, /reportOlderHistoryTruncated/);
	assert.match(file, /if \(!content\.isDisposed && session\.hasMore\(\)\)/, 'the notice must only fire when more really exists');
	assert.match(file, /dsh\.history\.truncated/);
});

test('session attachments become openable URIs instead of a decorative count', () => {
	// 原生 Chat 没有图片进度部件：只写「会话附件 N 个」用户点不开也看不到。
	// 附件必须以 `dsh-attachment:` 引用出现，字节由 Host 官方附件服务提供。
	const history = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatHistory.ts', import.meta.url), 'utf8');
	// 图片改由该段 slot host 的 `dshImageGallery` 画（官方只有一个 user.images 席位）。
	// history 再产一份 `dsh-attachment:` reference 会让同一张图显示两次，因此这里断言的是
	// 「history 不再重复引用」，而不是「history 里有引用」。
	assert.doesNotMatch(history, /pushImageReferences\(/, 'history must not duplicate images the gallery already draws');
	assert.doesNotMatch(history, /dshAttachmentUri\(/, 'history must not mint attachment URIs at all');
	assert.doesNotMatch(history, /会话附件 \$\{extras\.attachments\.length\} 个/, 'the decorative count must be gone');

	const fs = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshAttachmentFileSystem.ts', import.meta.url), 'utf8');
	assert.match(fs, /registerProvider\(DSH_ATTACHMENT_SCHEME, this\)/, 'the read-only scheme must be registered');
	assert.match(fs, /call<[^>]*>\('readAttachment'/, 'bytes must come from the official Host attachment service');
	assert.match(fs, /FileSystemProviderCapabilities\.Readonly/, 'the provider must advertise readonly so the editor does not offer save');
	assert.match(fs, /dsh-attachment is read-only/, 'writes must be refused');
});

test('the truncation warning is only appended once per content instance', () => {
	// 同一个会话反复打开都会走到 40 页上限。每次都追加的话，
	// history 尾部会堆出一串一模一样的警告。
	const source = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatSessionContent.ts', import.meta.url), 'utf8');
	assert.match(source, /private _truncationReported = false/, 'the report must be tracked');
	assert.match(source, /if \(this\._truncationReported\) \{\s*\n\s*return;/, 'a second report must be a no-op');
	assert.match(source, /this\._truncationReported = true;/, 'the flag must be set on the first report');
});

test('an unchanged frame does not rebuild or republish the history', () => {
	// rebuild 已用 queueMicrotask 合并同轮多次触发，但每次仍无条件 toHistory + fire。
	// 节点数、首尾 seq、待决议条数都没变时，说明这一帧没有新内容。
	const source = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatSessionContent.ts', import.meta.url), 'utf8');
	assert.match(source, /private _historyFingerprint: string \| undefined/, 'the fingerprint must be tracked');
	assert.match(source, /historyFingerprintOf\(session, extras\)/, 'the fingerprint must be computed from nodes and extras');
	assert.match(source, /if \(fingerprint === this\._historyFingerprint\) \{\s*\n\s*return;/, 'an identical fingerprint must skip the rebuild');
});

test('an extras-only change still rebuilds the history', () => {
	// extras（目标 / 计划 / 待办 / 技能 / 团队 / 交付物）不体现在节点上，
	// 但它们会改变 history 尾部。指纹必须把它们算进去，否则目标阶段变了界面不更新。
	const source = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatSessionContent.ts', import.meta.url), 'utf8');
	assert.match(source, /extrasFingerprint\(extras\)/, 'the fingerprint must include the extras');
	const history = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatHistory.ts', import.meta.url), 'utf8');
	assert.match(history, /export function extrasFingerprint/, 'the extras fingerprint must exist');
	// 目标阶段必须参与，否则「进行中 → 已完成」不会触发重建。
	assert.match(history, /goal\.phase/, 'the goal phase must take part in the fingerprint');
	// 不能用 JSON.stringify 整份序列化——那比直接重建还贵。
	assert.doesNotMatch(history, /JSON\.stringify\(extras\)/, 'the extras must not be fully serialized');
});

test('the truncation notice survives a later rebuild', () => {
	// 警告是「这次加载没到底」的说明，不属于 Host 投影。新内容一到 rebuild 会用
	// toHistory 重建，若不拼回去，这条警告就整条消失——而 _truncationReported
	// 已是 true，再也不会补回来。
	const source = readFileSync(new URL('../../../src/vs/workbench/contrib/dsh/browser/vscode/dshChatSessionContent.ts', import.meta.url), 'utf8');
	assert.match(source, /const TRUNCATION_NOTICE: IChatSessionHistoryItem/, 'the notice must be a shared constant');
	assert.match(source, /private _truncationFolded = false/, 'the folded state must be tracked');
	assert.match(source, /this\._truncationFolded = true;/, 'folding must be recorded when appended');
	assert.match(source, /this\._truncationFolded\s*\n?\s*\? \[\.\.\.rebuilt, TRUNCATION_NOTICE\]/, 'a rebuild must re-append the notice');
});
