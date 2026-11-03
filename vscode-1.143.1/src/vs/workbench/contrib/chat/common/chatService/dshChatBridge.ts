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

	/**
	 * 工作区/会话分类由 DSH 核心裁决（Q11）：查官方 workspace/list，按 path 找到当前 VS Code 工作区对应的 DSH workspace，
	 * 以其 sessionIds 为本 IDE 的会话归属。找不到则回退到 session/list 的 cwd 匹配（DSH 未建 workspace 时）。
	 */
	private async resolveDshWorkspace(): Promise<{ workspaceId: string; sessionIds: string[] } | undefined> {
		const norm = (p: unknown) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
		try {
			const res = await this.call<{ items: Array<{ workspaceId: string; path?: string; sessionIds?: string[] }> }>('workspace/list', {});
			const items = Array.isArray(res?.items) ? res.items : [];
			const target = norm(this.cwd);
			const hit = items.find(w => norm(w.path) === target) ?? (items.length === 1 ? items[0] : undefined);
			if (hit && Array.isArray(hit.sessionIds)) { return { workspaceId: hit.workspaceId, sessionIds: hit.sessionIds }; }
		} catch (e) { this.log.warn('[dsh] workspace/list failed; fallback to cwd match', e); }
		return undefined;
	}

	/** 当前工作区的会话 id 集合（DSH workspace.list 权威；否则按 session/list 的 cwd 回退）。 */
	private async currentWorkspaceSessionIds(): Promise<Set<string> | undefined> {
		const ws = await this.resolveDshWorkspace();
		if (ws) { return new Set(ws.sessionIds); }
		return undefined;
	}

	/** 判断 id 是否确实属于当前工作区的 DSH 会话（DSH 归属优先，绝不靠 id 形状猜测）。 */
	async isKnownSession(sessionId: string): Promise<boolean> {
		if (!sessionId) { return false; }
		try {
			const ids = await this.currentWorkspaceSessionIds();
			if (ids) { return ids.has(sessionId); }
			return (await this.allSessions()).some(item => item.sessionId === sessionId && this.sameCwd(item.cwd));
		} catch (e) { this.log.warn('[dsh] session/list failed', e); return false; }
	}

	async listSessions(): Promise<Array<{ sessionId: string; title: string; cwd: string; running: boolean; updatedAt: number }>> {
		const all = await this.allSessions();
		const ids = await this.currentWorkspaceSessionIds();
		const scoped = ids ? all.filter(item => ids.has(item.sessionId)) : all.filter(item => this.sameCwd(item.cwd));
		return scoped.map(item => ({
			sessionId: item.sessionId,
			title: item.projections?.values?.title || item.projections?.values?.sessionTitle || '',
			cwd: item.cwd || '',
			running: item.running === true,
			updatedAt: item.updatedAt || 0,
		}));
	}

	/**
	 * 读 DSH 的 `ui-chat` 显示设置（transcriptView / collapseTiming），供 IDE 按 DSH 设置渲染（P-B 渲染面读取）。
	 * 走官方 settings/describe（settingsController @Remote）；失败回退默认。
	 */
	async getUiChatSettings(): Promise<{ transcriptView: 'compact' | 'standard' | 'detailed' | 'verbose'; collapseTiming: 'completion' | 'next-input' }> {
		try {
			const res = await this.call<{ namespaces: Array<{ namespace: string; values?: Record<string, unknown> }> }>('settings/describe', {});
			const ns = (res?.namespaces || []).find(n => n.namespace === 'ui-chat' || n.namespace === 'uiChat');
			const values = (ns?.values || {}) as Record<string, unknown>;
			const tvRaw = String(values['transcriptView'] ?? 'standard');
			const tv = tvRaw === 'normal' ? 'detailed' : tvRaw;
			const transcriptView = (['compact', 'standard', 'detailed', 'verbose'].includes(tv) ? tv : 'standard') as 'compact' | 'standard' | 'detailed' | 'verbose';
			const collapseTiming = (String(values['collapseTiming'] ?? 'completion') === 'next-input' ? 'next-input' : 'completion') as 'completion' | 'next-input';
			return { transcriptView, collapseTiming };
		} catch (e) {
			this.log.warn('[dsh] settings/describe failed; default transcript', e);
			return { transcriptView: 'standard', collapseTiming: 'completion' };
		}
	}

	// ---- 控件（Q10：UI 留 VS Code，内里调 DSH 官方方法）。多参端点(arg wire)需真实 Host 复核 ----
	async getModelCatalog(): Promise<unknown> { return this.call('session/modelCatalog', {}); }
	async selectModel(sessionId: string, provider: string, model: string, reasoningEffort?: string): Promise<unknown> {
		return this.call('session/selectModel', { sessionId, provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) });
	}
	async listAgentPresets(): Promise<unknown> { return this.call('agentPresets/list', {}); }
	async selectAgentPreset(sessionId: string, preset: string): Promise<unknown> {
		// 官方 select(agent, preset)：agent 为 lookup 参数；wire 字段名待真实 Host 复核，先按 agent/sessionId 双传。
		return this.call('agentPresets/select', { agent: sessionId, sessionId, agentPreset: preset, preset });
	}
	async getPermissionCatalog(): Promise<unknown> { return this.call('permissionPresets/catalog', {}); }
	async setApprovalPolicy(sessionId: string, policy: 'ask' | 'never'): Promise<unknown> {
		return this.call('approval/setPolicy', { sessionId, policy });
	}
	async getGoal(sessionId: string): Promise<unknown> { return this.call('goal/get', { sessionId }); }
	async createGoal(sessionId: string, objective: string, maxGoalRounds?: number): Promise<unknown> {
		return this.call('goal/create', { sessionId, objective, ...(maxGoalRounds ? { maxGoalRounds } : {}) });
	}

	async newSession(): Promise<string> {
		const id = await this.createSession();
		this.write(this.activeKey, id);
		return id;
	}

	private async createSession(): Promise<string> {
		// 优先在 DSH 已登记的工作区下建会话（DSH 归属）；否则按 cwd 建。
		const ws = await this.resolveDshWorkspace();
		const args: Record<string, unknown> = ws ? { workspaceId: ws.workspaceId } : { cwd: this.cwd };
		const created = await this.call<{ sessionId: string }>('session/create', args);
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
	 * 发送一轮 prompt：先开官方 session/follow 流（/api/remote.mux）拿快照游标，再发官方
	 * session/prompt，随后只认 seq > 游标 的事件，实时映射为 progress（文本/工具/步骤），turn/end 返回。
	 */
	async send(localChatKey: string, prompt: string, progress: (parts: IChatProgress[]) => void, token: CancellationToken): Promise<{ errorDetails?: { message: string } }> {
		if (token.isCancellationRequested) { return {}; }
		let sessionId = '';
		let followId = '';
		let follow: { streamId: string; close: () => void } | undefined;
		let accepted = false;
		try {
			sessionId = await this.ensureDshSession(localChatKey);
			if (token.isCancellationRequested) { return {}; }
			if (this.activeSends.has(sessionId)) { throw new Error('DSH 会话已有本 IDE 的请求在进行中'); }
			this.activeSends.add(sessionId);

			// 帧队列（官方 follow 帧原样）。
			const queue: any[] = [];
			let wake: (() => void) | undefined;
			let streamError: Error | undefined;
			let ended = false;
			const push = (f: any) => { if (wake) { const w = wake; wake = undefined; w(); } else { queue.push(f); } };
			let cursor = -1;
			let resolveSnapshot: () => void = () => undefined;
			const snapshotReady = new Promise<void>((r) => { resolveSnapshot = r; });

			follow = this.client.follow('session/follow', { address: { kind: 'session', sessionId }, assistantStream: true }, (frame) => {
				if (frame.type === 'item') {
					const p = frame.value as any;
					if (p?.type === 'snapshot') { if (typeof p.cursor === 'number') { cursor = p.cursor; } resolveSnapshot(); }
					push(p);
				} else if (frame.type === 'end') { ended = true; if (wake) { const w = wake; wake = undefined; w(); } }
				else if (frame.type === 'error') { streamError = new Error(frame.error?.message || 'DSH follow failed'); if (wake) { const w = wake; wake = undefined; w(); } }
			});
			followId = follow.streamId;
			const next = (timeoutMs: number): Promise<any | 'timeout'> => {
				if (queue.length > 0) { return Promise.resolve(queue.shift()); }
				if (streamError) { return Promise.reject(streamError); }
				if (ended) { return Promise.resolve('timeout'); }
				return new Promise((resolve) => {
					const timer = setTimeout(() => { wake = undefined; resolve('timeout'); }, timeoutMs);
					wake = () => { clearTimeout(timer); resolve(queue.length > 0 ? queue.shift() : 'timeout'); };
				});
			};

			await Promise.race([snapshotReady, new Promise<void>((_, rej) => setTimeout(() => rej(new Error('DSH follow snapshot timeout')), 15000))]);
			if (token.isCancellationRequested) { return {}; }

			const requestId = generateUuid();
			const receipt = await this.call<{ accepted: true }>('session/prompt', {
				requestId, sessionId, content: [{ type: 'text', text: prompt }],
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
				if (item === 'timeout' && ended) { throw new Error('DSH 流在本轮完成前结束'); }
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
				if (event.type === 'user/message' && this.messageText({ content: event.data?.content }) === prompt) { turn = event.data?.turn ?? pendingTurn; }
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
			if (token.isCancellationRequested) { if (accepted && sessionId) { this.cancel(sessionId); } return {}; }
			const message = error instanceof Error ? error.message : String(error);
			this.log.warn('[dsh] stream request failed', error);
			return { errorDetails: { message } };
		} finally {
			if (follow) { try { follow.close(); } catch { /* ignore */ } }
			if (sessionId) { this.activeSends.delete(sessionId); }
		}
	}
}
