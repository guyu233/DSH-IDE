/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 集成：把内建 Local 聊天的“应答者”换成 DeepSeek Harness（DSH）核心。
//
// 设计（与用户确认）：内建 Local 的 UI/会话模型完全不动，只把“谁产生回复”换成 DSH。
// 本服务负责（Q1/Q3/Q4 起）：以“DSH 会话”为唯一真相，Local 只做显示。
//   1) 调 DSH 插件 HTTP 端点：/dsh-session/create|prompt|page|cancel|activate、/dsh-sessions；
//   2) 用廉价轮询（/dsh-sessions 的 running 标志）等本轮结束，再读一次 /dsh-session/page 取文本/工具；
//   3) 每工作区维护“活动 DSH 会话”（按 cwd 隔离），并可供 Sessions 面板列出会话、续接历史。
//
// 用 IRequestService 走主进程发请求（绕过 renderer 的 CSP；Host 在 127.0.0.1:59602）。

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { listenStream } from '../../../../../base/common/stream.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { IRequestService } from '../../../../../platform/request/common/request.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IChatProgress } from './chatService.js';
import { ToolDataSource } from '../tools/languageModelToolsService.js';
import { URI } from '../../../../../base/common/uri.js';
import { LocalChatSessionUri } from '../model/chatUri.js';

const DSH_ACTIVE_KEY_PREFIX = 'dsh.activeSession.';
// DSH Host 的 web 服务端口：插件端点 /dsh-session/* 与 /ide-cmd/* 都挂在 59602（与 DSH Web GUI 同端口）。
const DEFAULT_BASE_URL = 'http://127.0.0.1:59602';

export class DshChatBridge extends Disposable {

	constructor(
		@IRequestService private readonly requestService: IRequestService,
		@IStorageService private readonly storageService: IStorageService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	private get baseUrl(): string {
		const configured = this.configurationService.getValue<string | undefined>('dsh.hostBaseUrl');
		return (configured && configured.trim()) || DEFAULT_BASE_URL;
	}

	private get cwd(): string {
		const folder = this.workspaceContextService.getWorkspace().folders[0];
		return folder?.uri.fsPath ?? '';
	}

	// ---- 每工作区“活动 DSH 会话”持久化（key 用 cwd，隔离不同工作区） ----
	private activeKey(): string { return DSH_ACTIVE_KEY_PREFIX + this.cwd.toLowerCase(); }
	private readActive(): string | undefined {
		try { return this.storageService.get(this.activeKey(), StorageScope.WORKSPACE) || undefined; } catch { return undefined; }
	}
	private writeActive(sid: string | undefined): void {
		try {
			if (sid) { this.storageService.store(this.activeKey(), sid, StorageScope.WORKSPACE, StorageTarget.MACHINE); }
			else { this.storageService.remove(this.activeKey(), StorageScope.WORKSPACE); }
		} catch (e) { this.logService.warn('[dsh-bridge] failed to persist active session', e); }
	}

	private async httpJson(path: string, method: 'GET' | 'POST', body?: unknown): Promise<any> {
		const context = await this.requestService.request({
			url: this.baseUrl + path,
			type: method,
			headers: { 'Content-Type': 'application/json' },
			data: body === undefined ? undefined : JSON.stringify(body),
			callSite: 'dshChatBridge',
		}, CancellationToken.None);
		let text = '';
		await new Promise<void>((resolve, reject) => {
			listenStream(context.stream, {
				onData: (chunk: VSBuffer) => { text += chunk.toString(); },
				onError: reject,
				onEnd: () => resolve(),
			});
		});
		if (context.res.statusCode && context.res.statusCode >= 400) {
			throw new Error(`DSH ${path} -> ${context.res.statusCode}: ${text.slice(0, 300)}`);
		}
		return text ? JSON.parse(text) : {};
	}

	/**
	 * 取得当前工作区应使用的 DSH 会话 id。
	 * 模型：每个工作区有一个“活动会话”。来源优先级：本地绑定(会话列表所选) → Host 活动映射 → 按当前 cwd 新建。
	 * 若已绑定的会话 cwd 与当前工作区不符，则丢弃重绑（绝不跨工作区复用）。
	 */
	async ensureDshSession(localChatKey: string): Promise<string> {
		// 若该 Local 聊天本身就是某个 DSH 会话（Sessions 面板点开的历史会话，resource id 即 sessionId），直接用它续接。
		try {
			const id = LocalChatSessionUri.parseLocalSessionId(URI.parse(localChatKey));
			if (id && (id.startsWith('session-') || /^[0-9a-f]{8}-/.test(id))) {
				this.writeActive(id);
				return id;
			}
		} catch { /* ignore */ }
		let sid = this.readActive();
		if (sid) {
			const cwdOk = await this.sessionCwdMatches(sid);
			if (!cwdOk) {
				this.logService.info(`[dsh-bridge] active session ${sid} cwd mismatch (${this.cwd}); rebinding`);
				sid = undefined;
				this.writeActive(undefined);
			}
		}
		// Host 端活动映射（会话列表“选择历史”会写它）
		if (!sid) {
			try {
				const act = await this.httpJson('/dsh-session/activate?cwd=' + encodeURIComponent(this.cwd), 'GET');
				const active = String(act?.session || '');
				if (active) { sid = active; this.writeActive(active); }
			} catch { /* ignore */ }
		}
		if (sid) { return sid; }
		const created = await this.httpJsonWithTimeout('/dsh-session/create', 'POST', { cwd: this.cwd }, 20000);
		const createdId = String(created?.sessionId || '');
		if (!createdId) { throw new Error('DSH 创建会话失败'); }
		this.writeActive(createdId);
		this.logService.info(`[dsh-bridge] created DSH session ${createdId} (cwd=${this.cwd})`);
		return createdId;
	}

	/** 会话的 cwd 是否等于当前工作区（用于绑定校验）。 */
	private async sessionCwdMatches(dshSessionId: string): Promise<boolean> {
		try {
			const data = await this.httpJson('/dsh-sessions', 'GET');
			const items = Array.isArray(data?.items) ? data.items : [];
			const it = items.find((x: any) => String(x?.sessionId) === dshSessionId);
			if (!it) { return false; }
			const norm = (p: any) => String(p || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
			return norm(it.cwd) === norm(this.cwd);
		} catch {
			return true; // 查询失败时不强拆绑定，避免抖动
		}
	}

	/** httpJson 的超时包装。 */
	private async httpJsonWithTimeout(path: string, method: 'GET' | 'POST', body: unknown, timeoutMs: number): Promise<any> {
		let timer: any;
		const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout ${timeoutMs}ms`)), timeoutMs); });
		try {
			return await Promise.race([this.httpJson(path, method, body), timeout]);
		} finally {
			clearTimeout(timer);
		}
	}

	/** 取消当前 turn。 */
	cancel(dshSessionId: string): void {
		void this.httpJson('/dsh-session/cancel', 'POST', { session: dshSessionId }).catch(() => { /* ignore */ });
	}

	/** 列出当前工作区的 DSH 会话（供 IDE 会话列表，Q1/Q3）。 */
	async listSessions(): Promise<Array<{ sessionId: string; title: string; cwd: string; running: boolean; updatedAt: number }>> {
		const data = await this.httpJson('/dsh-sessions?cwd=' + encodeURIComponent(this.cwd), 'GET');
		const items = Array.isArray(data?.items) ? data.items : [];
		return items.map((i: any) => ({ sessionId: String(i.sessionId), title: String(i.title || ''), cwd: String(i.cwd || ''), running: !!i.running, updatedAt: Number(i.updatedAt) || 0 }));
	}

	/** 新建一个 DSH 会话并把当前工作区的活动会话切到它（会话列表“新建”用，Q3）。 */
	async newSession(): Promise<string> {
		const created = await this.httpJson('/dsh-session/create', 'POST', { cwd: this.cwd });
		const sid = String(created?.sessionId || '');
		if (!sid) { throw new Error('DSH 创建会话失败'); }
		this.writeActive(sid);
		return sid;
	}

	/** 加载某个 DSH 会话的历史轮（user/assistant 文本），用于把旧会话回放进 Local UI（Q4）。 */
	async loadHistory(dshSessionId: string): Promise<Array<{ role: 'user' | 'assistant'; text: string }>> {
		const page = await this.httpJson('/dsh-session/page?session=' + encodeURIComponent(dshSessionId), 'GET');
		const turns = Array.isArray(page?.turns) ? page.turns : [];
		return turns
			.filter((t: any) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string' && t.text)
			.map((t: any) => ({ role: t.role as 'user' | 'assistant', text: t.text as string }));
	}

	/**
	 * 发起一轮对话并流式把结果推进 Local UI。
	 * @param localChatKey 本地会话的稳定键（通常 sessionResource.toString()）
	 * @param prompt 用户输入文本
	 * @param progress 进度回调（Local UI 的 progressCallback）
	 * @param token 取消令牌
	 * @returns 供 _sendRequestAsync 使用的 IChatAgentResult
	 */
	async send(localChatKey: string, prompt: string, progress: (parts: IChatProgress[]) => void, token: CancellationToken): Promise<{ errorDetails?: { message: string } }> {
		const dshSessionId = await this.ensureDshSession(localChatKey);
		this.logService.info(`[dsh-bridge] send ${dshSessionId}: ${prompt.slice(0, 60)}`);

		try { progress([{ kind: 'progressMessage', content: new MarkdownString('DSH 正在处理…'), id: 'dsh-status' } as IChatProgress]); } catch { /* ignore */ }

		// 发送（快速返回，不在服务端驻留）
		const accepted = await this.httpJson('/dsh-session/prompt', 'POST', { session: dshSessionId, text: prompt });
		if (accepted && accepted.error) {
			return { errorDetails: { message: 'DSH 错误：' + accepted.error } };
		}

		// 廉价轮询：只查 /dsh-sessions 的 running 标志（不碰 inspect/全量事件），
		// 等本轮结束后再读一次 page 取最终文本/工具。大幅降低对 Host 的压力。
		const started = Date.now();
		const timeoutMs = 300000;
		// 先等它进入 running（避免刚发出时列表还没反映 running 就误判结束）
		let sawRunning = false;
		const graceUntil = Date.now() + 60000;
		while (Date.now() < graceUntil) {
			if (token.isCancellationRequested) { this.cancel(dshSessionId); return {}; }
			await this.delay(1000);
			const r = await this.isRunning(dshSessionId);
			if (r) { sawRunning = true; break; }
			// 已结束（很短的任务）也可直接跳出
			if (Date.now() - started > 6000 && !r) { break; }
		}
		// 主等待：running 变 false 即结束
		while (Date.now() - started < timeoutMs) {
			if (token.isCancellationRequested) { this.cancel(dshSessionId); return {}; }
			const running = await this.isRunning(dshSessionId);
			if (!running) { break; }
			await this.delay(1500);
		}
		if (!sawRunning) {
			// 没观察到 running：可能任务极短，给一点缓冲再读
			await this.delay(800);
		}

		// 最终只读一次 page（拿正文 + 工具）
		const finalPage = await this.readPage(dshSessionId);
		const tools = finalPage.tools;
		const text = finalPage.assistantText || '';

		for (const name of tools) {
			try {
				progress([{
					kind: 'toolInvocationSerialized',
					toolCallId: `dsh-tool-${name}-${Math.random().toString(36).slice(2, 8)}`,
					toolId: name,
					source: ToolDataSource.External,
					presentation: undefined,
					invocationMessage: new MarkdownString(`\`${name}\` 已完成`),
					pastTenseMessage: new MarkdownString(`\`${name}\` 已完成`),
					originMessage: undefined,
					isComplete: true,
					isConfirmed: true,
				} as unknown as IChatProgress]);
			} catch (e) {
				this.logService.warn('[dsh-bridge] tool card failed', e);
			}
		}

		if (text) {
			progress([{ kind: 'markdownContent', content: new MarkdownString(text) } as IChatProgress]);
		} else if (!tools.length) {
			progress([{ kind: 'markdownContent', content: new MarkdownString('（DSH 无输出，可能仍在处理，请稍候重试）') } as IChatProgress]);
		}
		this.logService.info(`[dsh-bridge] send done ${dshSessionId}: ${text.length} chars, tools=${tools.join(',') || '(none)'}`);
		return {};
	}

	/** 读取 page：assistant 计数/最后文本/工具名。 */
	private async readPage(dshSessionId: string): Promise<{ assistantCount: number; assistantText?: string; tools: string[] }> {
		try {
			const page = await this.httpJson('/dsh-session/page?session=' + encodeURIComponent(dshSessionId), 'GET');
			const turns = Array.isArray(page?.turns) ? page.turns : [];
			let assistantCount = 0;
			let assistantText: string | undefined;
			for (const t of turns) {
				if (t?.role === 'assistant') { assistantCount++; if (typeof t.text === 'string' && t.text) { assistantText = t.text; } }
			}
			const tools = Array.isArray(page?.tools) ? page.tools : [];
			return { assistantCount, assistantText, tools };
		} catch {
			return { assistantCount: 0, assistantText: undefined, tools: [] };
		}
	}

	private delay(ms: number): Promise<void> {
		return new Promise<void>(r => setTimeout(r, ms));
	}

	private async isRunning(dshSessionId: string): Promise<boolean> {
		try {
			const data = await this.httpJson('/dsh-sessions', 'GET');
			const items = Array.isArray(data?.items) ? data.items : [];
			const found = items.find((it: any) => String(it?.sessionId) === dshSessionId);
			return !!found?.running;
		} catch {
			return false;
		}
	}

}
