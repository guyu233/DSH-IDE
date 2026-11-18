/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 把 `sessionController.follow` 的内容帧投影成协议里的结构化会话。
//
// 投影规则依据 DSH 官方 `ui-chat/src/client/conversation-nodes/**` 的节点装配：
// 只产出 `DshIdeConversationNode` 白名单内的节点；官方内部事件（turn/start、attempt、
// boundary 等）保留为原始帧，不凭空产出可见行。字段缺失一律省略，不写显式 undefined。
//
// 子代理发现与结算的事实来自官方 `subagent/src/catalog.ts`：`subagent/catalog`
// 是父会话上的 durable 事件，`user/message` 的 `source.kind` 为 `subagent-settled`
// 或 `agent-message` 时是子代理通知，不是用户气泡。

import type {
	DshIdeAssistantBlock,
	DshIdeContentBlock,
	DshIdeConversationNode,
	DshIdeConversationView,
	DshIdeDeliverableView,
	DshIdeImageAttachmentRef,
	DshIdeTokenUsageDelta,
} from './dshIdeProtocol.js';

/** 投影器持有的会话状态：换会话时由调用方整体重置。 */
export interface DshIdeConversationState {
	/** 按节点身份保存，最终按 seq 升序输出。 */
	readonly nodes: Map<string, DshIdeConversationNode>;
	/** 进行中的流式 attempt；durable 消息到达后清理。 */
	readonly attempts: Map<string, DshIdeStreamAttempt>;
	/** 已结算的 attempt：防止重放同一流。 */
	readonly settledAttempts: Set<string>;
	/**
	 * 已经 end、但还没被同回合 `assistant/message` 接管的临时节点。
	 * end 会先把 attempt 移出 `attempts`，正式消息若只扫进行中的 attempt，就清不掉这个节点。
	 */
	readonly endedStreamNodes: Map<number, Set<string>>;
	/** 官方分页是否还有更早记录。 */
	hasMore: boolean;
	/** 官方 `deliverables/presented` 的累计结果，按事件顺序。 */
	readonly deliverables: Map<number, DshIdeDeliverableView>;
	/** 最近一次额度失败（官方 `turn/end.reason.error.code` 为 QUOTA/ACCOUNT_QUOTA）。 */
	quotaNotice?: { readonly code: 'QUOTA' | 'ACCOUNT_QUOTA'; readonly seq: number };
}

interface DshIdeStreamAttempt {
	readonly turn: number;
	readonly step: number;
	revision: number;
	readonly blocks: DshIdeAssistantBlock[];
	readonly id: string;
}

/** 新建一个空投影状态。 */
export function createDshIdeConversationState(): DshIdeConversationState {
	return {
		nodes: new Map(),
		attempts: new Map(),
		settledAttempts: new Set(),
		endedStreamNodes: new Map(),
		hasMore: true,
		deliverables: new Map(),
	};
}

/**
 * 投影一帧 follow 结果。
 *
 * - `snapshot`：整份重建，`records` 逐条投影。
 * - `event`：只投影这一条 durable 事件。
 * - `assistant-stream`：流式 start / chunk / end。
 * 其它帧（waterfall、session-status 等）返回 `undefined`，状态不变。
 */
export function projectDshIdeConversation(state: DshIdeConversationState, frame: unknown): DshIdeConversationView | undefined {
	if (!isRecord(frame)) {
		return undefined;
	}
	const type = frame['type'];
	if (type === 'snapshot') {
		return applySnapshot(state, frame);
	}
	if (type === 'event' && isRecord(frame['event'])) {
		applyDurable(state, frame['event']);
		return viewOf(state);
	}
	if (type === 'assistant-stream' && isRecord(frame['frame'])) {
		applyStream(state, frame['frame']);
		return viewOf(state);
	}
	return undefined;
}

function viewOf(state: DshIdeConversationState): DshIdeConversationView {
	const nodes = [...state.nodes.values()].sort((a, b) => a.seq - b.seq);
	return { nodes, hasMore: state.hasMore };
}

/** 累计的 `deliverables/presented`，按 turn/callId 顺序输出。 */
export function deliverablesOf(state: DshIdeConversationState): readonly DshIdeDeliverableView[] {
	return [...state.deliverables.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(entry => entry[1]);
}

/** 当前会话最近一次额度失败；没有则为 undefined。 */
export function quotaNoticeOf(state: DshIdeConversationState): DshIdeConversationState['quotaNotice'] {
	return state.quotaNotice;
}

/**
 * 会话里出现过的图片附件引用，按节点顺序去重。
 *
 * 官方没有「会话附件列表」投影键；`attachments` 字段的语义是消息里引用的图片，
 * 所以从已投影的 `user` / `context` / `subagent-notice` 节点的 content 里收集。
 */
export function attachmentsOf(state: DshIdeConversationState): readonly DshIdeImageAttachmentRef[] {
	const seen = new Set<string>();
	const images: DshIdeImageAttachmentRef[] = [];
	for (const node of [...state.nodes.values()].sort((a, b) => a.seq - b.seq)) {
		if (node.kind !== 'user' && node.kind !== 'context' && node.kind !== 'subagent-notice') {
			continue;
		}
		for (const block of node.content) {
			if (block.type !== 'image' || seen.has(block.attachment.attachmentId)) {
				continue;
			}
			seen.add(block.attachment.attachmentId);
			images.push(block.attachment);
		}
	}
	return images;
}

function applySnapshot(state: DshIdeConversationState, frame: Record<string, unknown>): DshIdeConversationView {
	state.nodes.clear();
	state.attempts.clear();
	state.settledAttempts.clear();
	state.endedStreamNodes.clear();
	state.deliverables.clear();
	state.quotaNotice = undefined;
	state.hasMore = typeof frame['hasMore'] === 'boolean' ? frame['hasMore'] : true;
	const records = Array.isArray(frame['records']) ? frame['records'] : [];
	for (const record of records) {
		if (isRecord(record) && record['type'] === 'event' && isRecord(record['event'])) {
			applyDurable(state, record['event']);
		}
	}
	// 流式基线：恢复进行中的 attempt。
	const baseline = isRecord(frame['assistantStream']) ? frame['assistantStream'] : undefined;
	const active = baseline !== undefined && isRecord(baseline['activeAttempt']) ? baseline['activeAttempt'] : undefined;
	// revision 的权威位置在 `assistantStream` **外层**（官方 `AssistantStreamFrame`：
	// 单调、替换时重置为 1）。`activeAttempt` 里的是同一份数据的镜像，
	// 读内层会在嵌套形状变化时静默退化成 0，使后续 chunk 全被判为「不新」而丢弃。
	const baselineRevision = baseline !== undefined ? numberOf(baseline['revision']) : undefined;
	if (active !== undefined) {
		const attemptId = stringOf(active['attemptId']);
		const stream = Array.isArray(active['stream']) ? active['stream'] : [];
		if (attemptId !== undefined) {
			const blocks: DshAssistantBlock[] = [];
			for (const chunk of stream) {
				if (isRecord(chunk)) {
					appendChunk(blocks, chunk);
				}
			}
			const attempt: DshIdeStreamAttempt = {
				turn: numberOf(active['turn']) ?? 0,
				step: numberOf(active['step']) ?? 0,
				revision: baselineRevision ?? numberOf(active['revision']) ?? 0,
				blocks,
				id: `stream:${attemptId}`,
			};
			state.attempts.set(attemptId, attempt);
			state.nodes.set(attempt.id, streamNode(state, attempt));
		}
	}
	return viewOf(state);
}

type DshAssistantBlock = DshIdeAssistantBlock;

/**
 * 消费官方 `surfaceOp`。
 *
 * 官方 `replace` 用 `{ op:'replace', startSeq, endSeq }`（**闭区间**、按当前 surface 顺序）
 * 表示「这一段被新事件取代」。投影器原来只按 seq 追加，忽略这个字段，
 * 于是被替换掉的旧节点会一直留在画面上——表现为重复内容或过期内容不消失。
 * @param state 投影状态
 * @param event 带 `surfaceOp` 的 durable 事件
 * @param seq 本事件自己的 seq（替换后的新节点不得被自己删掉）
 */
function applySurfaceOp(state: DshIdeConversationState, event: Record<string, unknown>, seq: number): void {
	const op = isRecord(event['surfaceOp']) ? event['surfaceOp'] : undefined;
	if (op === undefined || stringOf(op['op']) !== 'replace') {
		return;
	}
	const start = numberOf(op['startSeq']);
	const end = numberOf(op['endSeq']);
	if (start === undefined || end === undefined || start > end) {
		return;
	}
	for (const [id, node] of [...state.nodes]) {
		if (id.startsWith('stream:')) {
			continue;
		}
		// 只删落在被替换区间内的旧节点；本事件自己的 seq 不在其中（它比区间更新）。
		if (node.seq >= start && node.seq <= end && node.seq !== seq) {
			state.nodes.delete(id);
		}
	}
}

/** 一条 durable 事件 → 零到多个节点，原地写入 state。 */
function applyDurable(state: DshIdeConversationState, event: Record<string, unknown>): void {
	const seq = numberOf(event['seq']);
	if (seq === undefined) {
		return;
	}
	// 先应用替换语义，再写入本事件：顺序反过来会把自己刚写的节点删掉。
	applySurfaceOp(state, event, seq);
	const type = stringOf(event['type']);
	const data = isRecord(event['data']) ? event['data'] : {};
	const time = numberOf(event['time']) ?? 0;
	const turn = numberOf(event['turn']) ?? numberOf(data['turn']) ?? 0;
	const messageId = stringOf(data['messageId']);

	if (type === 'user/message') {
		const source = data['source'];
		const sourceKind = isRecord(source) ? stringOf(source['kind']) : undefined;
		const content = contentBlocksOf(data['content']);
		if (sourceKind === 'subagent-settled' || sourceKind === 'agent-message') {
			put(state, `seq:${seq}`, {
				kind: 'subagent-notice',
				...(messageId === undefined ? {} : { messageId }),
				seq,
				time,
				turn,
				content,
			});
			return;
		}
		if (content.length === 0) {
			return;
		}
		if (sourceKind !== undefined && sourceKind !== 'user') {
			// 插件注入的模型可见上下文：折叠为 context 行，不画成用户气泡。
			put(state, `seq:${seq}`, {
				kind: 'context',
				...(messageId === undefined ? {} : { messageId }),
				seq,
				time,
				turn,
				content,
				form: contextFormOf(source),
			});
			return;
		}
		put(state, `seq:${seq}`, {
			kind: 'user',
			...(messageId === undefined ? {} : { messageId }),
			seq,
			time,
			content,
		});
		return;
	}

	if (type === 'assistant/message') {
		const message = isRecord(data['message']) ? data['message'] : {};
		const step = numberOf(data['step']) ?? numberOf(message['step']) ?? 0;
		const blocks = assistantBlocksOf(message['content']);
		const usage = isRecord(data['usage']) ? tokenUsageOf(data['usage']) : isRecord(message['usage']) ? tokenUsageOf(message['usage']) : undefined;
		if (blocks.length === 0) {
			return;
		}
		put(state, `seq:${seq}`, {
			kind: 'assistant',
			...(messageId === undefined ? {} : { messageId }),
			seq,
			time,
			turn,
			step,
			blocks,
			...(usage === undefined ? {} : { usage }),
			...(providerMetadataOf(message['providerMetadata']) === undefined ? {} : { providerMetadata: providerMetadataOf(message['providerMetadata']) }),
			...(data['interrupted'] === true || message['interrupted'] === true ? { interrupted: true as const } : {}),
		});
		// durable 消息接管同回合的流式临时节点，包括已经 end、但节点还留着的那次。
		retireTurnStreams(state, turn);
		return;
	}

	if (type === 'tool/call') {
		const callId = stringOf(data['callId']);
		const name = stringOf(data['name']);
		if (callId === undefined || name === undefined) {
			return;
		}
		put(state, `seq:${seq}`, {
			kind: 'tool-call',
			seq,
			time,
			callId,
			name,
			phase: data['phase'] === 'preparing' ? 'preparing' : 'start',
			step: numberOf(data['step']) ?? 0,
			...(typeof data['arguments'] === 'string' ? { argsRaw: data['arguments'] } : {}),
		});
		return;
	}

	if (type === 'tool/result') {
		const message = isRecord(data['message']) ? data['message'] : {};
		const source = isRecord(message['source']) ? message['source'] : {};
		const callId = stringOf(source['callId']);
		if (callId === undefined) {
			return;
		}
		const call = isRecord(data['call']) ? data['call'] : undefined;
		// 官方 `rootResult`（`ui-chat/.../conversation-nodes/tool.ts`）：`name: previous?.name ?? ''`，
		// `call: previous === undefined ? null : { name, argsRaw }`。配对调用不在加载窗口内时
		// `name` 就是空串、`call` 为 null——这是官方的正常形态，不是坏数据。
		const callName = call === undefined ? '' : stringOf(call['name']) ?? '';
		const subCalls = Array.isArray(data['subCalls']) ? data['subCalls'].flatMap(child => decodeToolCallBlock(child)) : [];
		put(state, `seq:${seq}`, {
			kind: 'tool-result',
			seq,
			time,
			turn,
			callId,
			name: callName,
			args: data['args'] ?? null,
			...(call === undefined || callName === ''
				? { call: null }
				: { call: { name: callName, argsRaw: stringOf(call['argsRaw']) ?? '' } }),
			...(numberOf(data['callTime']) === undefined ? {} : { callTime: numberOf(data['callTime']) }),
			content: contentBlocksOf(message['content']),
			isError: message['isError'] === true,
			subCalls,
			...(errorOf(data['error']) === undefined ? {} : { error: errorOf(data['error']) }),
		});
		return;
	}

	if (type === 'turn/end') {
		const reason = isRecord(data['reason']) ? data['reason'] : {};
		const kind = stringOf(reason['kind']);
		const step = numberOf(data['step']) ?? 0;
		if (kind === 'error' || kind === 'aborted' || kind === 'interrupted') {
			const failure = isRecord(reason['failure']) ? reason['failure'] : {};
			// 官方 `turn/end.reason.error.code` 是额度提示的唯一来源
			// （`ui-chat/src/client/apply.ts:108-116`）：只有 QUOTA / ACCOUNT_QUOTA 才记。
			const error = isRecord(reason['error']) ? reason['error'] : undefined;
			const errorCode = error === undefined ? undefined : stringOf(error['code']);
			if (errorCode === 'QUOTA' || errorCode === 'ACCOUNT_QUOTA') {
				state.quotaNotice = { code: errorCode, seq };
			}
			const message = typeof failure['message'] === 'string' && failure['message'] !== ''
				? failure['message']
				: (typeof reason['message'] === 'string' && reason['message'] !== '' ? reason['message'] : kind);
			put(state, `seq:${seq}`, {
				kind: 'turn-error',
				seq,
				time,
				turn,
				step,
				message,
				...(stringOf(failure['code']) === undefined ? {} : { code: stringOf(failure['code']) }),
			});
			return;
		}
		if (kind === 'max-tokens') {
			put(state, `seq:${seq}`, { kind: 'turn-max-tokens', seq, time, turn, step });
		}
		return;
	}

	if (type === 'llm/retry') {
		put(state, `seq:${seq}`, {
			kind: 'model-retry',
			seq,
			time,
			turn,
			retryState: 'scheduled',
			...(numberOf(data['retry']) === undefined ? {} : { retry: numberOf(data['retry']) }),
			...(numberOf(data['maxRetries']) === undefined ? {} : { maxRetries: numberOf(data['maxRetries']) }),
			...(numberOf(data['delayMs']) === undefined ? {} : { delayMs: numberOf(data['delayMs']) }),
			...(data['mode'] === 'normal' || data['mode'] === 'always' ? { mode: data['mode'] } : {}),
			...(failureOf(data['failure']) === undefined ? {} : { failure: failureOf(data['failure']) }),
		});
		return;
	}

	if (type === 'command/run' || type === 'command/done') {
		const commandId = stringOf(data['commandId']);
		if (commandId === undefined) {
			return;
		}
		const previous = state.nodes.get(`cmd:${commandId}`);
		const base = previous !== undefined && previous.kind === 'command' ? previous : undefined;
		put(state, `cmd:${commandId}`, {
			kind: 'command',
			seq: base?.seq ?? seq,
			time: base?.time ?? time,
			commandId,
			name: type === 'command/run' ? (stringOf(data['name']) ?? null) : (base?.name ?? null),
			args: type === 'command/run' ? (typeof data['rawInput'] === 'string' ? data['rawInput'] : null) : (base?.args ?? null),
			outcome: type === 'command/done'
				? { kind: data['ok'] === false ? 'error' : 'success', ...(typeof data['text'] === 'string' ? { text: data['text'] } : {}) }
				: (base?.outcome ?? null),
		});
		return;
	}

	if (type === 'compaction/summary' || type === 'user/message#compaction') {
		put(state, `seq:${seq}`, {
			kind: 'compaction',
			seq,
			time,
			summary: typeof data['summary'] === 'string' ? data['summary'] : null,
			...(numberOf(data['summaryEventSeq']) === undefined ? {} : { summaryEventSeq: numberOf(data['summaryEventSeq']) }),
			...(numberOf(data['shadowedItemCount']) === undefined ? {} : { shadowedItemCount: numberOf(data['shadowedItemCount']) }),
			...(numberOf(data['shadowedTokenCount']) === undefined ? {} : { shadowedTokenCount: numberOf(data['shadowedTokenCount']) }),
		});
		return;
	}

	if (type === 'deliverables/presented') {
		// 官方 `deliverables/presented`（`tool-present/src/types.ts:15`）：
		// 每个 turn 的 present 调用带一份文件清单，按 seq 累计。
		const callId = stringOf(data['callId']);
		const turnOfDelivery = numberOf(data['turn']) ?? turn;
		const files = presentedFilesOf(data['files']);
		if (callId !== undefined && files.length > 0) {
			state.deliverables.set(seq, { turn: turnOfDelivery, callId, files });
		}
		return;
	}

	if (type === 'subagent/catalog') {
		// 父会话上的子代理发现事实（`subagent/src/catalog.ts`）。字段缺了就不写。
		put(state, `seq:${seq}`, {
			kind: 'subagent-catalog',
			seq,
			time,
			...(messageId === undefined ? {} : { messageId }),
			...(stringOf(data['childId']) === undefined ? {} : { childId: stringOf(data['childId']) }),
			...(numberOf(data['childCreatedAt']) === undefined ? {} : { childCreatedAt: numberOf(data['childCreatedAt']) }),
			...(stringOf(data['mode']) === undefined ? {} : { mode: stringOf(data['mode']) }),
			...(stringOf(data['label']) === undefined ? {} : { label: stringOf(data['label']) }),
			...(stringOf(data['name']) === undefined ? {} : { name: stringOf(data['name']) }),
			...(numberOf(data['version']) === undefined ? {} : { version: numberOf(data['version']) }),
		});
		return;
	}

	if (type === 'session/end-seed' && data['inherited'] === true) {
		put(state, `seq:${seq}`, { kind: 'inherited-history', seq, time, turn });
	}
}

/** `assistant-stream`：start / chunk / end，按 revision 单调去重。 */
function applyStream(state: DshIdeConversationState, frame: Record<string, unknown>): void {
	const type = stringOf(frame['type']);
	const attemptId = stringOf(frame['attemptId']);
	const revision = numberOf(frame['revision']);
	if (attemptId === undefined || revision === undefined) {
		return;
	}
	if (type === 'start') {
		if (state.attempts.has(attemptId) || state.settledAttempts.has(attemptId)) {
			return;
		}
		const attempt: DshIdeStreamAttempt = {
			turn: numberOf(frame['turn']) ?? 0,
			step: numberOf(frame['step']) ?? 0,
			revision,
			blocks: [],
			id: `stream:${attemptId}`,
		};
		state.attempts.set(attemptId, attempt);
		state.nodes.set(attempt.id, streamNode(state, attempt));
		return;
	}
	if (type === 'chunk') {
		const attempt = state.attempts.get(attemptId);
		const chunk = isRecord(frame['chunk']) ? frame['chunk'] : undefined;
		if (attempt === undefined || chunk === undefined || revision <= attempt.revision) {
			return;
		}
		attempt.revision = revision;
		appendChunk(attempt.blocks, chunk);
		state.nodes.set(attempt.id, streamNode(state, attempt));
		return;
	}
	if (type === 'end') {
		const attempt = state.attempts.get(attemptId);
		if (attempt === undefined) {
			return;
		}
		const outcome = isRecord(frame['outcome']) ? frame['outcome'] : {};
		state.attempts.delete(attemptId);
		state.settledAttempts.add(attemptId);
		if (outcome['kind'] === 'abandoned') {
			// 没有落成可见消息：丢弃这次尝试留下的临时节点。
			state.nodes.delete(attempt.id);
			return;
		}
		// 正式消息可能晚于 end。先记住节点，等同回合 assistant/message 再删。
		let ids = state.endedStreamNodes.get(attempt.turn);
		if (ids === undefined) {
			ids = new Set();
			state.endedStreamNodes.set(attempt.turn, ids);
		}
		ids.add(attempt.id);
	}
}

/** 同回合的流式临时节点交给 durable 消息后删除，避免和正式回复各画一条。 */
function retireTurnStreams(state: DshIdeConversationState, turn: number): void {
	for (const [attemptId, attempt] of [...state.attempts]) {
		if (attempt.turn !== turn) {
			continue;
		}
		state.attempts.delete(attemptId);
		state.settledAttempts.add(attemptId);
		state.nodes.delete(attempt.id);
	}
	const ended = state.endedStreamNodes.get(turn);
	if (ended === undefined) {
		return;
	}
	for (const id of ended) {
		state.nodes.delete(id);
	}
	state.endedStreamNodes.delete(turn);
}

function streamNode(state: DshIdeConversationState, attempt: DshIdeStreamAttempt): DshIdeConversationNode {
	let max = 0;
	for (const node of state.nodes.values()) {
		if (node.seq > max) {
			max = node.seq;
		}
	}
	return {
		kind: 'assistant',
		seq: max + 1,
		time: Date.now(),
		turn: attempt.turn,
		step: attempt.step,
		blocks: attempt.blocks,
	};
}

function put(state: DshIdeConversationState, id: string, node: DshIdeConversationNode): void {
	state.nodes.set(id, node);
}

// ---------------------------------------------------------------------------
// 形状读取
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 官方 `PresentedFile[]`：至少要有 `path`，`description` 可选。 */
function presentedFilesOf(value: unknown): { readonly path: string; readonly description?: string }[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const files: { readonly path: string; readonly description?: string }[] = [];
	for (const file of value) {
		if (!isRecord(file)) {
			continue;
		}
		const path = stringOf(file['path']);
		if (path === undefined) {
			continue;
		}
		const description = stringOf(file['description']);
		files.push({ path, ...(description === undefined ? {} : { description }) });
	}
	return files;
}

function stringOf(value: unknown): string | undefined {
	return typeof value === 'string' && value !== '' ? value : undefined;
}

function numberOf(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** 官方 `ContentBlock[]` → 协议子集；未知或形状不合的块直接丢弃。 */
function contentBlocksOf(value: unknown): DshIdeContentBlock[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const blocks: DshIdeContentBlock[] = [];
	for (const block of value) {
		if (!isRecord(block)) {
			continue;
		}
		const type = stringOf(block['type']);
		if (type === 'text' || type === 'reasoning') {
			const text = block['text'];
			if (typeof text === 'string') {
				blocks.push({ type, text });
			}
		} else if (type === 'image') {
			const attachment = imageRefOf(block['attachment']);
			if (attachment !== undefined) {
				blocks.push({ type: 'image', attachment });
			}
		} else if (type === 'file') {
			const attachment = fileRefOf(block['attachment']);
			if (attachment !== undefined) {
				blocks.push({ type: 'file', attachment });
			}
		} else if (type === 'tool-call') {
			const id = stringOf(block['id']);
			const name = stringOf(block['name']);
			if (id !== undefined && name !== undefined && typeof block['arguments'] === 'string') {
				blocks.push({ type: 'tool-call', id, name, arguments: block['arguments'] });
			}
		} else if (type === 'tool-addition' || type === 'tool-removal') {
			const toolName = stringOf(block['toolName']);
			if (toolName !== undefined) {
				blocks.push({ type, toolName });
			}
		}
	}
	return blocks;
}

/** 源 `ContentBlock[]` → `AssistantBlock[]`；`file` 与插件块一起落 `other`。 */
function assistantBlocksOf(value: unknown): DshIdeAssistantBlock[] {
	const blocks: DshIdeAssistantBlock[] = [];
	if (!Array.isArray(value)) {
		return blocks;
	}
	for (const block of value) {
		if (!isRecord(block)) {
			continue;
		}
		const type = stringOf(block['type']);
		if (type === 'text' || type === 'reasoning') {
			const text = block['text'];
			if (typeof text === 'string') {
				blocks.push({ kind: type, text });
			}
		} else if (type === 'image') {
			const attachment = imageRefOf(block['attachment']);
			if (attachment !== undefined) {
				blocks.push({ kind: 'image', attachment });
			}
		} else if (type === 'tool-call') {
			const id = stringOf(block['id']);
			const name = stringOf(block['name']);
			if (id !== undefined && name !== undefined && typeof block['arguments'] === 'string') {
				blocks.push({ kind: 'tool-call', callId: id, name, argsRaw: block['arguments'] });
			}
		} else {
			// 真源 `AssistantBlock` 没有 `file`，`file` 与所有插件块一起落 `other` 原样保留。
			blocks.push({ kind: 'other', block });
		}
	}
	return blocks;
}

function imageRefOf(value: unknown): DshIdeImageAttachmentRef | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const attachmentId = stringOf(value['attachmentId']);
	const mediaType = value['mediaType'];
	if (attachmentId === undefined) {
		return undefined;
	}
	if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp' && mediaType !== 'image/gif') {
		return undefined;
	}
	const bytes = value['bytes'];
	const width = value['width'];
	const height = value['height'];
	if (typeof bytes !== 'number' || typeof width !== 'number' || typeof height !== 'number') {
		return undefined;
	}
	if (!Number.isSafeInteger(bytes) || bytes <= 0 || !Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
		return undefined;
	}
	const name = stringOf(value['name']);
	const original = isRecord(value['originalDimensions']) ? value['originalDimensions'] : undefined;
	const originalWidth = original === undefined ? undefined : original['width'];
	const originalHeight = original === undefined ? undefined : original['height'];
	return {
		attachmentId,
		mediaType,
		bytes,
		width,
		height,
		...(name === undefined ? {} : { name }),
		...(typeof originalWidth === 'number' && typeof originalHeight === 'number'
			&& Number.isSafeInteger(originalWidth) && originalWidth > 0 && Number.isSafeInteger(originalHeight) && originalHeight > 0
			? { originalDimensions: { width: originalWidth, height: originalHeight } }
			: {}),
	};
}

function fileRefOf(value: unknown): { attachmentId: string; name: string; bytes: number } | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const attachmentId = stringOf(value['attachmentId']);
	const name = stringOf(value['name']);
	const bytes = value['bytes'];
	if (attachmentId === undefined || name === undefined) {
		return undefined;
	}
	if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0) {
		return undefined;
	}
	return { attachmentId, name, bytes };
}

/** DSH `event-projection.ts:47-53`：只放行 Chat 认得的 form，其余保持不透明。 */
const KNOWN_CONTEXT_FORMS: readonly string[] = ['instructions', 'catalog', 'snapshot', 'notice', 'relay', 'recall'];

function contextFormOf(source: unknown): string | null {
	const record = isRecord(source) ? source : undefined;
	const form = record === undefined ? undefined : stringOf(record['form']);
	return form !== undefined && KNOWN_CONTEXT_FORMS.includes(form) ? form : null;
}

function tokenUsageOf(value: Record<string, unknown>): DshIdeTokenUsageDelta | undefined {
	const inputTokens = numberOf(value['inputTokens']);
	const outputTokens = numberOf(value['outputTokens']);
	if (inputTokens === undefined || outputTokens === undefined) {
		return undefined;
	}
	return {
		inputTokens,
		outputTokens,
		...(numberOf(value['totalTokens']) === undefined ? {} : { totalTokens: numberOf(value['totalTokens']) }),
		...(numberOf(value['cacheReadTokens']) === undefined ? {} : { cacheReadTokens: numberOf(value['cacheReadTokens']) }),
		...(numberOf(value['cacheWriteTokens']) === undefined ? {} : { cacheWriteTokens: numberOf(value['cacheWriteTokens']) }),
		...(numberOf(value['reasoningTokens']) === undefined ? {} : { reasoningTokens: numberOf(value['reasoningTokens']) }),
	};
}

function providerMetadataOf(value: unknown): { provider: string; model: string } | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const provider = stringOf(value['provider']);
	const model = stringOf(value['model']);
	return provider === undefined || model === undefined ? undefined : { provider, model };
}

function failureOf(value: unknown): { message: string; code?: string } | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const message = typeof value['message'] === 'string' && value['message'] !== '' ? value['message'] : 'unknown';
	return {
		message,
		...(stringOf(value['code']) === undefined ? {} : { code: stringOf(value['code']) }),
	};
}

function errorOf(value: unknown): { name: string; code: string; reason?: string } | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const name = stringOf(value['name']);
	const code = stringOf(value['code']);
	if (name === undefined || code === undefined) {
		return undefined;
	}
	return {
		name,
		code,
		...(stringOf(value['reason']) === undefined ? {} : { reason: stringOf(value['reason']) }),
	};
}

/** PTC 子调用挂在父调用的 `subCalls` 上；按同一形状递归解码。 */
function decodeToolCallBlock(value: unknown): DshIdeConversationNode[] {
	if (!isRecord(value)) {
		return [];
	}
	const callId = stringOf(value['callId']);
	if (callId === undefined) {
		return [];
	}
	const subCalls = Array.isArray(value['subCalls']) ? value['subCalls'].flatMap(child => decodeToolCallBlock(child)) : [];
	const seq = numberOf(value['seq']) ?? 0;
	const time = numberOf(value['time']) ?? 0;
	const hasResult = value['kind'] === 'tool-result' || value['content'] !== undefined;
	if (hasResult) {
		const call = isRecord(value['call']) ? value['call'] : undefined;
		const name = call === undefined ? stringOf(value['name']) ?? '' : stringOf(call['name']) ?? '';
		return [{
			kind: 'tool-result',
			seq,
			time,
			callId,
			name,
			args: value['args'] ?? null,
			...(call === undefined || name === '' ? { call: null } : { call: { name, argsRaw: stringOf(call['argsRaw']) ?? '' } }),
			content: contentBlocksOf(value['content']),
			isError: value['isError'] === true,
			subCalls,
		}];
	}
	const phase = value['phase'] === 'preparing' ? 'preparing' : 'start';
	return [{
		kind: 'tool-call',
		seq,
		time,
		callId,
		name: stringOf(value['name']) ?? '',
		phase,
		...(typeof value['argsRaw'] === 'string' ? { argsRaw: value['argsRaw'] } : {}),
	}];
}

/** 流式 chunk 追加：`text-delta` / `reasoning-delta`。 */
function appendChunk(blocks: DshAssistantBlock[], chunk: Record<string, unknown>): void {
	const type = stringOf(chunk['type']);
	const text = typeof chunk['text'] === 'string' ? chunk['text'] : undefined;
	if (text === undefined) {
		return;
	}
	const kind = type === 'reasoning-delta' ? 'reasoning' : type === 'text-delta' ? 'text' : undefined;
	if (kind === undefined) {
		return;
	}
	const last = blocks[blocks.length - 1];
	if (last !== undefined && last.kind === kind) {
		blocks[blocks.length - 1] = { kind, text: last.text + text };
		return;
	}
	blocks.push({ kind, text });
}
