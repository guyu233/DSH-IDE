/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 聊天画面：把 `sessionController.follow` 的帧解成 DSH 自己的聊天部件。
//
// 这里不做「另一套行」。部件形状就是抄来的 `build/dsh/chat-render` 的 `DshPartProps`
// （reasoning / markdown / user / stats / running），所以画面是 DSH 的，不是 VS Code
// 聊天列表的行。
//
// 帧来自内核那一次 follow：`snapshot`（历史）+ `event`（增量）+ `assistant-stream`（正在吐的字）。
// 读不懂的帧丢弃，不猜。

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type { DshPartProps } from './dshChatSeam.js';

/** 一条聊天记录：稳定 id + 部件 + 是否还在流式。 */
export interface DshChatEntry {
	readonly id: string;
	/** 这一条属于哪个回合；running 状态按回合收起。 */
	readonly turn: number;
	readonly part: DshPartProps;
	readonly streaming: boolean;
	/** 该条的最后修改序号：同一 attempt 的 revision 用来丢弃重放。 */
	readonly revision: number;
}

export interface DshChatEntryPatch {
	readonly entry: DshChatEntry;
	/** true = 新增，false = 更新同 id。 */
	readonly added: boolean;
}

/**
 * 只读的聊天帧解码器：`snapshot` → 全量记录；`event` / `assistant-stream` → 增量补丁。
 *
 * 它**不**持有 DSH 会话对象，也不发请求；请求仍由聊天面板交给 `IDshClientService`。
 */
export class DshChatModel extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<readonly DshChatEntryPatch[]>());
	private readonly _onDidReset = this._register(new Emitter<void>());
	readonly onDidChange: Event<readonly DshChatEntryPatch[]> = this._onDidChange.event;
	readonly onDidReset: Event<void> = this._onDidReset.event;

	/** 按 seq 索引的记录（历史 + durable 增量）。 */
	private readonly entries = new Map<string, DshChatEntry>();
	/** 正在流式的 attempt：id → 已拼好的文本与元信息。 */
	private readonly attempts = new Map<string, { turn: number; text: string; revision: number; entryId: string }>();
	/** 已结算的 durable 消息 seq：流式帧不能覆盖它们。 */
	private readonly committed = new Set<number>();

	get list(): readonly DshChatEntry[] {
		return [...this.entries.values()].sort((a, b) => a.turn - b.turn || a.id.localeCompare(b.id));
	}

	/** 接受一帧 follow 结果。返回本次产生的补丁（空数组 = 没有可见变化）。 */
	accept(frame: Readonly<Record<string, unknown>>): readonly DshChatEntryPatch[] {
		if (frame['type'] === 'snapshot') {
			return this.applySnapshot(frame);
		}
		if (frame['type'] === 'event' && isRecord(frame['event'])) {
			return this.applyDurable(frame['event']);
		}
		if (frame['type'] === 'assistant-stream' && isRecord(frame['frame'])) {
			return this.applyStream(frame['frame']);
		}
		return [];
	}

	/** 换会话：旧会话的记录与流式状态全部作废。 */
	clear(): void {
		this.entries.clear();
		this.attempts.clear();
		this.committed.clear();
		this._onDidReset.fire();
	}

	private applySnapshot(frame: Readonly<Record<string, unknown>>): readonly DshChatEntryPatch[] {
		this.clear();
		const records = Array.isArray(frame['records']) ? frame['records'] : [];
		const patches: DshChatEntryPatch[] = [];
		for (const record of records) {
			if (!isRecord(record) || record['type'] !== 'event' || !isRecord(record['event'])) {
				continue;
			}
			patches.push(...this.applyDurable(record['event']));
		}
		const baseline = isRecord(frame['assistantStream']) ? frame['assistantStream'] : undefined;
		const active = baseline !== undefined && isRecord(baseline['activeAttempt']) ? baseline['activeAttempt'] : undefined;
		if (active !== undefined) {
			this.beginAttempt(
				String(active['attemptId'] ?? ''),
				Number(active['turn'] ?? 0),
				Number(active['revision'] ?? 0),
			);
		}
		return patches;
	}

	/** durable 事件：user/message 与 assistant/message 生成记录，其余只更新 running。 */
	private applyDurable(event: Record<string, unknown>): readonly DshChatEntryPatch[] {
		const seq = Number(event['seq']);
		if (!Number.isFinite(seq)) {
			return [];
		}
		this.committed.add(seq);
		const type = String(event['type'] ?? '');
		const data = isRecord(event['data']) ? event['data'] : {};
		const turn = Number(event['turn'] ?? data['turn'] ?? 0) || 0;
		if (type === 'user/message') {
			const text = textOf(data['content']);
			if (text === undefined || text === '') {
				return [];
			}
			const entry: DshChatEntry = {
				id: `seq:${seq}`,
				turn,
				part: { kind: 'user', content: { text } },
				streaming: false,
				revision: seq,
			};
			this.entries.set(entry.id, entry);
			return [{ entry, added: true }];
		}
		if (type === 'assistant/message') {
			const message = isRecord(data['message']) ? data['message'] : {};
			const text = textOf(message['content']);
			if (text === undefined || text === '') {
				return [];
			}
			// 结算消息接管正在流式的同一 attempt：删掉临时条目，落一条稳定记录。
			const entryId = `seq:${seq}`;
			this.entries.set(entryId, {
				id: entryId,
				turn,
				part: { kind: 'markdown', blocks: parseMarkdownBlocks(text), streaming: false },
				streaming: false,
				revision: seq,
			});
			const patches: DshChatEntryPatch[] = [];
			for (const [attemptId, attempt] of this.attempts) {
				if (attempt.turn === turn) {
					this.attempts.delete(attemptId);
					const temp = this.entries.get(attempt.entryId);
					if (temp !== undefined) {
						this.entries.delete(attempt.entryId);
						patches.push({ entry: temp, added: true });
					}
				}
			}
			patches.push({ entry: this.entries.get(entryId)!, added: true });
			return patches;
		}
		if (type === 'assistant/attempt') {
			// 结算为 attempt：流式文本在原处转正，不再另起一条。
			const attemptId = String(data['attemptId'] ?? '');
			const attempt = this.attempts.get(attemptId);
			if (attempt === undefined) {
				return [];
			}
			this.attempts.delete(attemptId);
			const existing = this.entries.get(attempt.entryId);
			if (existing === undefined) {
				return [];
			}
			const settled: DshChatEntry = { ...existing, streaming: false, part: { ...existing.part, streaming: false, interrupted: false } as DshPartProps };
			this.entries.set(settled.id, settled);
			return [{ entry: settled, added: true }];
		}
		return [];
	}

	private applyStream(frame: Record<string, unknown>): readonly DshChatEntryPatch[] {
		const type = String(frame['type'] ?? '');
		const attemptId = String(frame['attemptId'] ?? '');
		if (attemptId === '' || frame['revision'] === undefined) {
			return [];
		}
		const revision = Number(frame['revision']);
		if (type === 'start') {
			return this.beginAttempt(attemptId, Number(frame['turn'] ?? 0), revision);
		}
		if (type === 'chunk') {
			const chunk = isRecord(frame['chunk']) ? frame['chunk'] : undefined;
			if (chunk === undefined || chunk['type'] !== 'text-delta' || typeof chunk['text'] !== 'string') {
				return [];
			}
			const attempt = this.attempts.get(attemptId);
			if (attempt === undefined || revision <= attempt.revision) {
				return [];
			}
			attempt.revision = revision;
			attempt.text += chunk['text'];
			return [this.patchAttempt(attemptId)];
		}
		if (type === 'end') {
			const attempt = this.attempts.get(attemptId);
			if (attempt === undefined) {
				return [];
			}
			const outcome = isRecord(frame['outcome']) ? frame['outcome'] : {};
			if (outcome['kind'] === 'abandoned') {
				this.attempts.delete(attemptId);
				this.entries.delete(attempt.entryId);
				this._onDidReset.fire();
				return [];
			}
			// committed：等 durable 的 assistant/message 接管；先把流式关掉，避免闪回。
			const existing = this.entries.get(attempt.entryId);
			if (existing === undefined) {
				return [];
			}
			const settled: DshChatEntry = { ...existing, streaming: false };
			this.entries.set(settled.id, settled);
			return [{ entry: settled, added: false }];
		}
		return [];
	}

	private beginAttempt(attemptId: string, turn: number, revision: number): readonly DshChatEntryPatch[] {
		if (attemptId === '' || this.attempts.has(attemptId)) {
			return [];
		}
		const entryId = `stream:${attemptId}`;
		const entry: DshChatEntry = {
			id: entryId,
			turn,
			part: { kind: 'markdown', blocks: [], streaming: true },
			streaming: true,
			revision,
		};
		this.entries.set(entryId, entry);
		this.attempts.set(attemptId, { turn, text: '', revision, entryId });
		return [{ entry, added: true }];
	}

	private patchAttempt(attemptId: string): DshChatEntryPatch {
		const attempt = this.attempts.get(attemptId)!;
		const previous = this.entries.get(attempt.entryId)!;
		const next: DshChatEntry = {
			...previous,
			part: { kind: 'markdown', blocks: parseMarkdownBlocks(attempt.text), streaming: true },
			revision: attempt.revision,
		};
		this.entries.set(next.id, next);
		return { entry: next, added: false };
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 多段文本按出现顺序拼接；没有文本返回 undefined。 */
function textOf(value: unknown): string | undefined {
	if (typeof value === 'string') {
		return value;
	}
	if (!Array.isArray(value)) {
		return undefined;
	}
	const parts: string[] = [];
	for (const block of value) {
		if (isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string') {
			parts.push(block['text']);
		}
	}
	return parts.length === 0 ? undefined : parts.join('');
}

/** 纯文本 → DSH 渲染件的 blocks。先整段交给消息块，不做二次解析。 */
function parseMarkdownBlocks(text: string): readonly unknown[] {
	return text === '' ? [] : [{ type: 'text', text }];
}
