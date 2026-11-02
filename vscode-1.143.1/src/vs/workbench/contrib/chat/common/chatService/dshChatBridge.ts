/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 集成：把内建 Local 聊天的“应答者”换成 DeepSeek Harness（DSH）核心。
//
// 架构（v1.0 私有管道定稿）：
//  - 所有 DSH 连接都在 DSH Host 进程内经插件（dsh-ide）完成，经**插件私有本地命名管道**暴露；
//    VS Code 主进程是管道客户端（DshPipeClient），渲染器经 IDshChatClient 代理访问。
//  - 本文件（workbench, renderer 侧）只做：
//      1) 通过 IDshChatClient.callA(method,payload) 调通道 A 一元方法（session.list/page/projections/create/prompt/cancel…）；
//      2) 通过 IDshChatClient.follow(method,payload,onFrame) 订阅通道 A 流（session.follow），逐帧消费 snapshot/event；
//      3) 把事件映射成内建聊天的 progress。
//  - **无** `/api`、**无** `/api/remote.mux`、**无** WebSocket、**无** Cookie。
//  - 写请求（session.prompt）绝不盲目重试：先建 follow 流拿到 snapshot 游标，再发一次写，只认 seq > cursor 的事件。

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IChatProgress } from './chatService.js';
import { ToolDataSource } from '../tools/languageModelToolsService.js';
import { URI } from '../../../../../base/common/uri.js';
import { LocalChatSessionUri } from '../model/chatUri.js';
import { IDshChatClient } from '../../../../platform/dshPipe/common/dshChatClient.js';

interface SessionSummary { sessionId: string; cwd?: string; running?: boolean; updatedAt?: number; projections?: { values?: { title?: string; sessionTitle?: string } } }
interface HistoryTurn { role: 'user' | 'assistant'; text: string }

/** 通道 A follow 流帧（Host 原样转发 rc.5 follow）。 */
interface FollowFrame {
	type?: 'snapshot' | 'event' | 'assistant-stream';
	records?: Array<{ type: 'event'; event: any }>;
	event?: any;
	cursor?: number;
	hasMore?: boolean;
	frame?: any; // assistant-stream
}

const activeKeyPrefix = 'dsh.activeSession.';

/** 由私有管道（通道 A）支撑的本地聊天呈现器。 */
export class DshChatBridge extends Disposable {
	private readonly pendingCreates = new Map<string, Promise<string>>();
	private readonly activeSends = new Set<string>();

	constructor(
		@IDshChatClient private readonly client: IDshChatClient,
		@IStorageService private readonly storage: IStorageService,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@ILogService private readonly log: ILogService,
	) {
		super();
	}

	private get cwd(): string { return this.workspace.getWorkspace().folders[0]?.uri.fsPath ?? ''; }
	private get activeKey(): string { return activeKeyPrefix + this.cwd.toLowerCase(); }
	private sessionKey(localKey: string): string { return this.activeKey + ':' + encodeURIComponent(localKey); }
	private read(key: string): string | undefined { return this.storage.get(key, StorageScope.WORKSPACE) || undefined; }
	private write(key: string, id: string): void { this.storage.store(key, id, StorageScope.WORKSPACE, StorageTarget.MACHINE); }
	private sameCwd(value: unknown): boolean {
		const normalize = (p: unknown) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
		return normalize(value) === normalize(this.cwd);
	}

	/** 通道 A 一元调用（解析为 result）。 */
	private call<T>(method: string, payload?: unknown): Promise<T> {
		return this.client.callA<T>(method, payload);
	}

	private async allSessions(): Promise<SessionSummary[]> {
		const result = await this.call<{ items: SessionSummary[] }>('session.list', {});
		if (!Array.isArray(result?.items)) { throw new Error('Invalid session.list response'); }
		return result.items;
	}

	/** 判断 id 是否确实是当前工作区的 DSH 会话（查官方列表，绝不靠 id 形状猜测）。 */
	async isKnownSession(sessionId: string): Promise<boolean> {
		if (!sessionId) { return false; }
		try { return (await this.allSessions()).some(item => item.sessionId === sessionId && this.sameCwd(item.cwd)); }
		catch (e) { this.log.warn('[dsh] session.list failed', e); return false; }
	}

	async listSessions(): Promise<Array<{ sessionId: string; title: string; cwd: string; running: boolean; updatedAt: number }>> {
		return (await this.allSessions()).filter(item => this.sameCwd(item.cwd)).map(item => ({
			sessionId: item.sessionId,
			title: item.projections?.values?.title || item.projections?.values?.sessionTitle || '',
			cwd: item.cwd || '',
			running: item.running === true,
			updatedAt: item.updatedAt || 0,
		}));
	}

	async newSession(): Promise<string> {
		const id = await this.createSession();
		this.write(this.activeKey, id);
		return id;
	}

	private async createSession(): Promise<string> {
		const created = await this.call<{ sessionId: string }>('session.create', { cwd: this.cwd });
		if (!created?.sessionId) { throw new Error('DSH session.create returned no session ID'); }
		return created.sessionId;
	}

	async ensureDshSession(localChatKey: string): Promise<string> {
		const pending = this.pendingCreates.get(localChatKey);
		if (pending) { return pending; }
		const operation = this.resolveSession(localChatKey);
		this.pendingCreates.set(localChatKey, operation);
		try { return await operation; } finally { this.pendingCreates.delete(localChatKey); }
	}

	private async resolveSession(localChatKey: string): Promise<string> {
		const resourceId = LocalChatSessionUri.parseLocalSessionId(URI.parse(localChatKey));
		// 普通 Local 会话也是 UUID；只有当官方列表里确有该 id 且 cwd 匹配时才复用。
		if (resourceId && await this.isKnownSession(resourceId)) {
			this.write(this.sessionKey(localChatKey), resourceId);
			return resourceId;
		}
		const bound = this.read(this.sessionKey(localChatKey)) || this.read(this.activeKey);
		if (bound && await this.isKnownSession(bound)) {
			this.write(this.sessionKey(localChatKey), bound);
			return bound;
		}
		const created = await this.createSession();
		this.write(this.sessionKey(localChatKey), created);
		this.write(this.activeKey, created);
		return created;
	}

	private messageText(message: any): string {
		const content = message?.content;
		if (typeof content === 'string') { return content; }
		return Array.isArray(content) ? content.filter((part: any) => part?.type === 'text' && typeof part.text === 'string').map((part: any) => part.text).join('') : '';
	}

	/** 通道 A session.page 分页读取完整历史（向 beforeSeq 方向翻页直到 hasMore=false）。 */
	private async page(sessionId: string): Promise<any[]> {
		const projection = await this.call<{ asOfSeq: number }>('session.projections', { sessionId });
		if (!Number.isSafeInteger(projection?.asOfSeq)) { throw new Error('Invalid session cursor'); }
		let beforeSeq: number | undefined;
		const pages: any[][] = [];
		for (let i = 0; i < 40; i++) {
			const value = await this.call<{ records: any[]; hasMore: boolean }>('session.page', {
				address: { kind: 'session', sessionId }, throughSeq: projection.asOfSeq, maxMessages: 200, ...(beforeSeq === undefined ? {} : { beforeSeq }),
			});
			if (!Array.isArray(value?.records)) { throw new Error('Invalid session page'); }
			pages.push(value.records);
			if (!value.hasMore) { return pages.reverse().flat(); }
			const first = value.records.find(record => Number.isSafeInteger(record?.event?.seq));
			if (!first || first.event.seq <= 0 || first.event.seq === beforeSeq) { throw new Error('Invalid session page cursor'); }
			beforeSeq = first.event.seq;
		}
		throw new Error('DSH history exceeds pagination limit');
	}

	async loadHistory(sessionId: string): Promise<HistoryTurn[]> {
		const records = await this.page(sessionId);
		const turns: HistoryTurn[] = [];
		for (const record of records) {
			const event = record?.event;
			if (event?.type === 'user/message') {
				const text = this.messageText({ content: event.data?.content });
				if (text) { turns.push({ role: 'user', text }); }
			} else if (event?.type === 'assistant/message') {
				const text = this.messageText(event.data?.message);
				if (text) { turns.push({ role: 'assistant', text }); }
			}
		}
		return turns;
	}

	cancel(sessionId: string): void {
		if (!this.activeSends.has(sessionId)) { return; }
		void this.call('session.cancel', { sessionId }).catch(error => this.log.warn('[dsh] cancel failed', error));
	}

	private emitTool(progress: (parts: IChatProgress[]) => void, name: string, id: string): void {
		progress([{
			kind: 'toolInvocationSerialized', toolCallId: id, toolId: name, source: ToolDataSource.External,
			presentation: undefined, invocationMessage: new MarkdownString(`\`${name}\` 已完成`),
			pastTenseMessage: new MarkdownString(`\`${name}\` 已完成`), originMessage: undefined,
			isComplete: true, isConfirmed: true,
		} as unknown as IChatProgress]);
	}

	async send(localChatKey: string, prompt: string, progress: (parts: IChatProgress[]) => void, token: CancellationToken): Promise<{ errorDetails?: { message: string } }> {
		if (token.isCancellationRequested) { return {}; }
		let sessionId = '';
		let streamId = '';
		let accepted = false;
		try {
			sessionId = await this.ensureDshSession(localChatKey);
			if (token.isCancellationRequested) { return {}; }
			if (this.activeSends.has(sessionId)) { throw new Error('DSH 会话已有本 IDE 的请求在进行中'); }
			this.activeSends.add(sessionId);

			// 先建 follow 流，等首个 snapshot 帧拿游标 cursor，再发写请求；此后只认 seq > cursor 的事件。
			let cursor = -1;
			let resolveSnapshot: () => void = () => undefined;
			const snapshotReady = new Promise<void>((res) => { resolveSnapshot = res; });
			const queue: FollowFrame[] = [];
			let wake: (() => void) | undefined;
			let streamError: Error | undefined;
			let streamEnded = false;
			const push = (frame: FollowFrame) => { if (wake) { const w = wake; wake = undefined; w(); } else { queue.push(frame); } };
			const next = async (timeoutMs: number): Promise<FollowFrame | 'timeout'> => {
				if (queue.length > 0) { return queue.shift()!; }
				if (streamError) { throw streamError; }
				if (streamEnded) { return 'timeout'; }
				return new Promise<FollowFrame | 'timeout'>((resolve) => {
					const timer = setTimeout(() => { wake = undefined; resolve('timeout'); }, timeoutMs);
					wake = () => { clearTimeout(timer); resolve(queue.length > 0 ? queue.shift()! : (streamError ? Promise.reject(streamError) as any : 'timeout')); };
				});
			};

			const follow = this.client.follow('session.follow', { address: { kind: 'session', sessionId }, assistantStream: true }, (frame) => {
				const payload = frame.payload as FollowFrame | undefined;
				if (!payload) { return; }
				if (payload.type === 'snapshot') { if (typeof payload.cursor === 'number') { cursor = payload.cursor; } resolveSnapshot(); }
				push(payload);
			}, token);
			streamId = follow.streamId;
			follow.done.then(() => { streamEnded = true; }, (e) => { streamError = e instanceof Error ? e : new Error(String(e)); if (wake) { const w = wake; wake = undefined; w(); } });

			// 等快照（最多 15s）。
			await Promise.race([snapshotReady, new Promise<void>((_, rej) => setTimeout(() => rej(new Error('DSH follow snapshot timeout')), 15000))]);
			if (token.isCancellationRequested) { return {}; }

			const requestId = generateUuid();
			const receipt = await this.call<{ accepted: true }>('session.prompt', {
				requestId, sessionId, mode: 'followup', content: [{ type: 'text', text: prompt }],
			});
			if (receipt?.accepted !== true) { throw new Error('DSH 未接受该消息'); }
			accepted = true;

			let turn: number | undefined;
			let pendingTurn: number | undefined;
			const streamedSteps = new Set<string>();
			const attempts = new Map<string, { turn: number; step: number }>();
			const tools = new Map<string, string>();
			while (true) {
				if (token.isCancellationRequested) { if (accepted && sessionId) { this.cancel(sessionId); } return {}; }
				const item = await next(300000);
				if (item === 'timeout' && streamEnded) { throw new Error('DSH 流在本轮完成前结束'); }
				if (item === 'timeout') { continue; }
				if (item.type === 'assistant-stream') {
					const delta = item.frame;
					if (delta?.type === 'start') { attempts.set(String(delta.attemptId), { turn: delta.turn, step: delta.step }); }
					const attempt = attempts.get(String(delta?.attemptId));
					if (delta?.type === 'chunk' && attempt
						&& delta.chunk?.type === 'text-delta' && typeof delta.chunk.text === 'string'
						&& (turn === undefined ? attempt.turn === pendingTurn : attempt.turn === turn)) {
						streamedSteps.add(`${attempt.turn}:${attempt.step}`);
						progress([{ kind: 'markdownContent', content: new MarkdownString(delta.chunk.text) } as IChatProgress]);
					}
					continue;
				}
				if (item.type !== 'event' || !item.event || item.event.seq <= cursor) { continue; }
				const event = item.event;
				if (event.type === 'turn/start') { pendingTurn = event.data?.turn; }
				if (event.type === 'user/message' && this.messageText({ content: event.data?.content }) === prompt) {
					turn = event.data?.turn ?? pendingTurn;
				}
				if (turn === undefined || event.data?.turn !== turn) { continue; }
				if (event.type === 'assistant/message') {
					const text = this.messageText(event.data.message);
					if (text && !streamedSteps.has(`${turn}:${event.data.step}`)) {
						progress([{ kind: 'markdownContent', content: new MarkdownString(text) } as IChatProgress]);
					}
				} else if (event.type === 'tool/call') {
					tools.set(String(event.data.callId), String(event.data.name));
				} else if (event.type === 'tool/result') {
					const id = String(event.data?.message?.toolCallId || event.data?.callId || '');
					const name = tools.get(id);
					if (name) { this.emitTool(progress, name, id); tools.delete(id); }
				} else if (event.type === 'turn/end') {
					return {};
				}
			}
		} catch (error) {
			if (token.isCancellationRequested) {
				if (accepted && sessionId) { this.cancel(sessionId); }
				return {};
			}
			const message = error instanceof Error ? error.message : String(error);
			this.log.warn('[dsh] stream request failed', error);
			return { errorDetails: { message } };
		} finally {
			if (streamId) { void this.client.cancel(streamId).catch(() => undefined); }
			if (sessionId) { this.activeSends.delete(sessionId); }
		}
	}
}
