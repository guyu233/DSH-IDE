/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 纯函数：把 DSH 官方 session/follow 的条目流映射为「中立回合部件」（DshTurnPart[]）。
// 无 VS Code / 无 DOM 依赖，便于单测。bridge 再把 DshTurnPart 适配成 IChatProgress；
// 渲染器再把 IChatProgress 适配成 DSH 视觉 ContentPart（P-B）。
//
// 角色：本文件是「DSH 事件 → 中立回合部件」的**纯函数映射规范 + 单测基准(oracle)**，与
// dshChatBridge.send() 的流式实现语义等价（后者因需处理游标/流式增量而内联）。改动任一处的
// 映射规则时，需同步本文件与其单测(mapprove)。
//
// 输入条目：{ type:'event', event:SessionEvent } | { type:'assistant-stream', frame } | { type:'snapshot', ... }
// 输出：有序 DshTurnPart[]（thinking/text/tool/step/usage），并给出 turn 完成标志。

export type DshTurnPart =
	| { kind: 'thinking'; id: string; text: string; done: boolean }
	| { kind: 'text'; text: string }
	| { kind: 'tool'; callId: string; toolId: string; title: string; status: 'running' | 'done' | 'error'; detail?: string }
	| { kind: 'step'; turn: number; step: number; label: string }
	| { kind: 'usage'; promptTokens?: number; completionTokens?: number; totalTokens?: number };

export interface DshMapResult {
	parts: DshTurnPart[];
	/** 本轮已 turn/end（调用方可结束等待）。 */
	done: boolean;
	/** 最新投影游标（snapshot.cursor 或已消费事件 seq+1）。 */
	cursor: number;
}

function textOf(content: unknown): string {
	if (typeof content === 'string') { return content; }
	if (Array.isArray(content)) {
		return content.filter((p: any) => p && p.type === 'text' && typeof p.text === 'string').map((p: any) => p.text).join('');
	}
	return '';
}

/**
 * 把一批 follow 条目归约为部件列表。纯函数，可重复调用（调用方维护 cursor 与增量）。
 * @param entries follow 条目（snapshot/event/assistant-stream）
 * @param opts.matchPrompt 可选：仅映射该用户 prompt 之后的本轮事件（turn 对齐）
 */
export function mapDshEntries(entries: ReadonlyArray<any>, opts: { startCursor?: number; matchPrompt?: string } = {}): DshMapResult {
	const parts: DshTurnPart[] = [];
	let cursor = Number.isSafeInteger(opts.startCursor) ? (opts.startCursor as number) : -1;
	let done = false;
	let turn: number | undefined;
	const toolIndex = new Map<string, number>(); // callId -> part index
	const thinkingIndex = new Map<string, number>(); // attemptId -> part index
	let matched = opts.matchPrompt === undefined; // 无 matchPrompt 时全收

	for (const entry of entries) {
		if (!entry || typeof entry !== 'object') { continue; }
		if (entry.type === 'snapshot') {
			if (Number.isSafeInteger(entry.cursor)) { cursor = entry.cursor; }
			// snapshot.records 视为历史，不回放（渲染由 page 负责）
			continue;
		}
		if (entry.type === 'assistant-stream' && entry.frame) {
			const f = entry.frame;
			if (f.type === 'chunk' && f.chunk?.type === 'text-delta' && typeof f.chunk.text === 'string') {
				// 流式文本：追加到上一个 text 或新建
				const last = parts[parts.length - 1];
				if (last && last.kind === 'text') { last.text += f.chunk.text; } else { parts.push({ kind: 'text', text: f.chunk.text }); }
			}
			continue;
		}
		if (entry.type !== 'event' || !entry.event) { continue; }
		const ev = entry.event;
		if (Number.isSafeInteger(ev.seq)) { cursor = Math.max(cursor, ev.seq); }
		const d = ev.data || {};
		switch (ev.type) {
			case 'turn/start':
				turn = d.turn;
				break;
			case 'user/message':
				if (!matched && textOf(d.content) === opts.matchPrompt) { matched = true; turn = d.turn; }
				break;
			case 'step/start':
				parts.push({ kind: 'step', turn: d.turn, step: d.step, label: `步骤 ${d.step + 1}` });
				break;
			case 'assistant/message': {
				if (!matched) { break; }
				const msg = d.message || {};
				const blocks = Array.isArray(msg.content) ? msg.content : [];
				for (const b of blocks) {
					if (b?.type === 'thinking' || b?.type === 'reasoning') {
						parts.push({ kind: 'thinking', id: String(b.id ?? `t-${parts.length}`), text: String(b.text ?? b.value ?? ''), done: true });
					} else if (b?.type === 'text' && typeof b.text === 'string') {
						parts.push({ kind: 'text', text: b.text });
					}
				}
				if (msg.usage) {
					parts.push({ kind: 'usage', promptTokens: msg.usage.inputTokens ?? msg.usage.promptTokens, completionTokens: msg.usage.outputTokens ?? msg.usage.completionTokens, totalTokens: msg.usage.totalTokens });
				}
				break;
			}
			case 'tool/call': {
				if (!matched) { break; }
				const callId = String(d.callId ?? d.id ?? `call-${parts.length}`);
				parts.push({ kind: 'tool', callId, toolId: String(d.name ?? d.toolId ?? 'tool'), title: String(d.name ?? d.toolId ?? 'tool'), status: 'running', detail: typeof d.args === 'string' ? d.args : undefined });
				toolIndex.set(callId, parts.length - 1);
				break;
			}
			case 'tool/result': {
				const callId = String(d?.message?.toolCallId ?? d.callId ?? '');
				const idx = toolIndex.get(callId);
				if (idx !== undefined && parts[idx]?.kind === 'tool') {
					(parts[idx] as any).status = d.isError || d.message?.isError ? 'error' : 'done';
				}
				break;
			}
			case 'turn/end':
				if (matched) { done = true; }
				break;
			default:
				break;
		}
	}
	return { parts, done, cursor };
}
