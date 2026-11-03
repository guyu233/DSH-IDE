/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 集成：把内建 Local 聊天的“应答者”换成 DeepSeek Harness（DSH）核心。
//
// v2 官方传输：所有 DSH 连接都在 DSH Host 进程内经官方 dsh-client-connection（/api）完成；
// 渲染器经 IDshClientService（主进程持 cookie）调官方一元方法（session/list、session/page、
// session/projections、session/create、session/prompt、session/cancel）。
//
// R1 阶段：一元方法走官方 /api；实时流（session/follow 经 /api/remote.mux）在 R2 接入。
// 无 /api 之外的自造通道、无 cookie 落盘、无私有管道。

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
import { IDshClientService } from '../../../../../platform/dshClient/common/dshClientService.js';

interface SessionSummary { sessionId: string; cwd?: string; running?: boolean; updatedAt?: number; projections?: { values?: { title?: string; sessionTitle?: string } } }
interface HistoryTurn { role: 'user' | 'assistant'; text: string }

const activeKeyPrefix = 'dsh.activeSession.';

/** 由官方客户端服务（IDshClientService）支撑的本地聊天呈现器。 */
export class DshChatBridge extends Disposable {
	private readonly pendingCreates = new Map<string, Promise<string>>();
	private readonly activeSends = new Set<string>();

	constructor(
		@IDshClientService private readonly client: IDshClientService,
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

	/** 官方一元调用；Host 返回 ok:false 时抛出带 code 的错误。 */
	private async call<T>(endpoint: string, args: Record<string, unknown> = {}): Promise<T> {
		const res = await this.client.call<T>(endpoint, args);
		if (!res.ok) { throw new Error(`${endpoint} failed: ${res.error.code} ${res.error.message}`); }
		return res.value;
	}

	private async allSessions(): Promise<SessionSummary[]> {
		const result = await this.call<{ items: SessionSummary[] }>('session/list', {});
		if (!Array.isArray(result?.items)) { throw new Error('Invalid session/list response'); }
		return result.items;
	}

	/** 判断 id 是否确实是当前工作区的 DSH 会话（查官方列表，绝不靠 id 形状猜测）。 */
	async isKnownSession(sessionId: string): Promise<boolean> {
		if (!sessionId) { return false; }
		try { return (await this.allSessions()).some(item => item.sessionId === sessionId && this.sameCwd(item.cwd)); }
		catch (e) { this.log.warn('[dsh] session/list failed', e); return false; }
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
		const created = await this.call<{ sessionId: string }>('session/create', { cwd: this.cwd });
		if (!created?.sessionId) { throw new Error('DSH session/create returned no session ID'); }
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

	/** 官方 session/page 分页读取完整历史（向 beforeSeq 方向翻页直到 hasMore=false）。 */
	private async page(sessionId: string): Promise<any[]> {
		const projection = await this.call<{ asOfSeq: number }>('session/projections', { sessionId });
		if (!Number.isSafeInteger(projection?.asOfSeq)) { throw new Error('Invalid session cursor'); }
		let beforeSeq: number | undefined;
		const pages: any[][] = [];
		for (let i = 0; i < 40; i++) {
			const value = await this.call<{ records: any[]; hasMore: boolean }>('session/page', {
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
		void this.call('session/cancel', { sessionId }).catch(error => this.log.warn('[dsh] cancel failed', error));
	}

	private emitTool(progress: (parts: IChatProgress[]) => void, name: string, id: string): void {
		progress([{
			kind: 'toolInvocationSerialized', toolCallId: id, toolId: name, source: ToolDataSource.External,
			presentation: undefined, invocationMessage: new MarkdownString(`\`${name}\` 已完成`),
			pastTenseMessage: new MarkdownString(`\`${name}\` 已完成`), originMessage: undefined,
			isComplete: true, isConfirmed: true,
		} as unknown as IChatProgress]);
	}

	/**
	 * 发送一轮 prompt（R1：官方一元 session/prompt 受理；实时流在 R2 经 /api/remote.mux）。
	 * 保留既有签名；返回 {errorDetails?} 以贴合调用方。
	 */
	async send(localChatKey: string, prompt: string, progress: (parts: IChatProgress[]) => void, token: CancellationToken): Promise<{ errorDetails?: { message: string } }> {
		if (token.isCancellationRequested) { return {}; }
		let sessionId = '';
		try {
			sessionId = await this.ensureDshSession(localChatKey);
			if (token.isCancellationRequested) { return {}; }
			this.activeSends.add(sessionId);
			const requestId = generateUuid();
			const receipt = await this.call<{ accepted: true }>('session/prompt', {
				requestId, sessionId, content: [{ type: 'text', text: prompt }],
			});
			if (receipt?.accepted !== true) { throw new Error('DSH 未接受该消息'); }
			// R2：接入 session/follow 流，把 thinking/tool/step 实时映射回 progress。
			void progress; void this.emitTool;
			return {};
		} catch (error) {
			if (token.isCancellationRequested) { if (sessionId) { this.cancel(sessionId); } return {}; }
			const message = error instanceof Error ? error.message : String(error);
			this.log.warn('[dsh] prompt failed', error);
			return { errorDetails: { message } };
		} finally {
			if (sessionId) { this.activeSends.delete(sessionId); }
		}
	}
}
