/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 聊天面板的会话状态：把内核 follow 的帧、输入框目录、待决批准合成一份只读状态，
// 并把发送 / 停止 / 换模型 / 回答批准交给内核。面板只订阅这里，不碰通道细节。
//
// 边界：零 `@deepseek-ai/*`；不自己开 session/follow；不改写帧。

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type { IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import type { DshIdeWaterfallNotice } from '../../../../platform/dshClient/common/dshIdeProtocol.js';
import { DshChatModel, type DshChatEntry } from './dshChatModel.js';
import type { DshChatModelOption, DshChatPending } from './dshChatPanel.js';

/** 输入框目录里的一个模型（`projectDshIdeComposer` 的 `model.groups[].models[]`）。 */
interface ComposerModelCatalog {
	readonly id?: string;
	readonly name?: string;
}

export interface IDshChatSession {
	readonly onDidChangeEntries: Event<readonly [readonly DshChatEntry[], boolean]>;
	readonly onDidChangeModelMenu: Event<void>;
	readonly onDidChangePending: Event<readonly DshChatPending[]>;
	readonly onDidChangeRunning: Event<boolean>;
	entries(): readonly DshChatEntry[];
	models(): readonly DshChatModelOption[];
	currentModel(): { readonly provider: string; readonly model: string } | undefined;
	pending(): readonly DshChatPending[];
	running(): boolean;
	/** 发送一句话；成功即交给内核。 */
	submit(text: string): Promise<boolean>;
	selectModel(provider: string, model: string): Promise<void>;
	cancel(): Promise<void>;
	answerApproval(eventId: string, decision: 'approve' | 'reject'): Promise<void>;
	answerQuestion(eventId: string, label: string): Promise<void>;
}

export class DshChatSession extends Disposable implements IDshChatSession {
	private readonly model = this._register(new DshChatModel());
	private readonly _onDidChangeModelMenu = this._register(new Emitter<void>());
	private readonly _onDidChangePending = this._register(new Emitter<readonly DshChatPending[]>());
	private readonly _onDidChangeRunning = this._register(new Emitter<boolean>());
	private readonly _onDidChangeEntries = this._register(new Emitter<readonly [readonly DshChatEntry[], boolean]>());
	private readonly pendingItems = new Map<string, DshChatPending>();
	private _models: readonly DshChatModelOption[] = [];
	private _current: { provider: string; model: string } | undefined;
	private _running = false;
	private boundSessionId: string | undefined;

	readonly onDidChangeModelMenu: Event<void> = this._onDidChangeModelMenu.event;
	readonly onDidChangePending: Event<readonly DshChatPending[]> = this._onDidChangePending.event;
	readonly onDidChangeRunning: Event<boolean> = this._onDidChangeRunning.event;
	readonly onDidChangeEntries: Event<readonly [readonly DshChatEntry[], boolean]> = this._onDidChangeEntries.event;

	constructor(private readonly client: IDshClientService) {
		super();
		this._register(this.model.onDidReset(() => this._onDidChangeEntries.fire([[], true])));
		this._register(this.model.onDidChange(patches => {
			if (patches.length > 0) {
				this._onDidChangeEntries.fire([this.model.list, false]);
			}
		}));
	}

	entries(): readonly DshChatEntry[] {
		return this.model.list;
	}

	models(): readonly DshChatModelOption[] {
		return this._models;
	}

	currentModel(): { readonly provider: string; readonly model: string } | undefined {
		return this._current;
	}

	pending(): readonly DshChatPending[] {
		return [...this.pendingItems.values()];
	}

	running(): boolean {
		return this._running;
	}

	/** 换会话：清空旧记录、重读目录、重开跟进流。 */
	async bind(sessionId: string | undefined): Promise<void> {
		if (sessionId === this.boundSessionId) {
			return;
		}
		this.boundSessionId = sessionId;
		this.model.clear();
		this.pendingItems.clear();
		this._onDidChangePending.fire([]);
		this._running = false;
		this._onDidChangeRunning.fire(false);
		if (sessionId === undefined) {
			return;
		}
		const rebound = await this.client.rebindView(sessionId);
		if (!rebound.ok) {
			return;
		}
		await this.refreshComposer();
	}

	/** 启动时连接已由 `openView` 按开窗参数建好：只登记绑定并补读目录，不重开流。 */
	async attach(sessionId: string | undefined): Promise<void> {
		this.boundSessionId = sessionId;
		await this.refreshComposer();
	}

	/** 收一帧内核送来的 follow 结果 / 批准帧。 */
	accept(snapshotView: Readonly<Record<string, unknown>> | undefined): void {
		if (snapshotView !== undefined) {
			this.model.accept(snapshotView);
		}
	}

	/** 批准 / 问卷帧：登记成本地面的卡片，不再走通知。 */
	acceptWaterfall(notice: DshIdeWaterfallNotice): void {
		if (notice.kind === 'cancel') {
			if (this.pendingItems.delete(notice.eventId)) {
				this._onDidChangePending.fire(this.pending());
			}
			return;
		}
		if (notice.event === 'approval/request' && 'toolName' in notice.request) {
			const reason = notice.request.reason;
			this.pendingItems.set(notice.eventId, {
				eventId: notice.eventId,
				kind: 'approval',
				title: reason === undefined
					? `DSH 请求运行 ${notice.request.toolName}`
					: `DSH 请求运行 ${notice.request.toolName}：${reason}`,
				options: [],
			});
		} else if (notice.event === 'user-questions/request' && 'questions' in notice.request) {
			const question = notice.request.questions[0];
			this.pendingItems.set(notice.eventId, {
				eventId: notice.eventId,
				kind: 'question',
				title: question?.question ?? 'DSH 提问',
				options: (question?.options ?? []).map(option => option.label),
				questionId: question?.id ?? '',
			});
		}
		this._onDidChangePending.fire(this.pending());
	}

	/** 发送一句话。成功后交给内核，不做乐观插入。 */
	async submit(text: string): Promise<boolean> {
		this._running = true;
		this._onDidChangeRunning.fire(true);
		const result = await this.client.call('submit', { text });
		if (!result.ok) {
			this._running = false;
			this._onDidChangeRunning.fire(false);
			return false;
		}
		return true;
	}

	async cancel(): Promise<void> {
		await this.client.call('interrupt', {});
	}

	async selectModel(provider: string, model: string): Promise<void> {
		const result = await this.client.call('setModel', { model: `${provider}/${model}` });
		if (result.ok) {
			this._current = { provider, model };
			this._onDidChangeModelMenu.fire();
		}
	}

	async answerApproval(eventId: string, decision: 'approve' | 'reject'): Promise<void> {
		this.pendingItems.delete(eventId);
		this._onDidChangePending.fire(this.pending());
		await this.client.call('answerApproval', { requestId: eventId, decision });
	}

	async answerQuestion(eventId: string, label: string): Promise<void> {
		const item = this.pendingItems.get(eventId);
		this.pendingItems.delete(eventId);
		this._onDidChangePending.fire(this.pending());
		// 答案里的 id 是问卷题号（官方 `{ answers: [{ id, selected }] }`），不是 eventId。
		await this.client.call('answerQuestion', {
			requestId: eventId,
			answer: { answers: [{ id: item?.questionId ?? '', selected: [label] }] },
		});
	}

	/** 重读输入框目录：模型列表与当前选择（形状由 `projectDshIdeComposer` 决定）。 */
	async refreshComposer(): Promise<void> {
		const result = await this.client.call<{
			readonly model?: {
				readonly current?: { readonly provider?: string; readonly model?: string; readonly effort?: string } | null;
				readonly groups?: readonly { readonly id?: string; readonly models?: readonly ComposerModelCatalog[] }[];
			};
		}>('composerState', {});
		if (!result.ok) {
			return;
		}
		const options: DshChatModelOption[] = [];
		for (const group of result.value.model?.groups ?? []) {
			const provider = typeof group.id === 'string' && group.id !== '' ? group.id : '';
			for (const model of group.models ?? []) {
				if (typeof model.id !== 'string' || model.id === '') {
					continue;
				}
				options.push({ provider, model: model.id, name: typeof model.name === 'string' && model.name !== '' ? model.name : model.id });
			}
		}
		this._models = options;
		const provider = result.value.model?.current?.provider;
		const model = result.value.model?.current?.model;
		this._current = typeof provider === 'string' && provider !== '' && typeof model === 'string' && model !== ''
			? { provider, model }
			: undefined;
		this._onDidChangeModelMenu.fire();
	}

	/** 运行态由 Stream 帧以外的信号也能确认：有流式条目即算在跑。 */
	noteRunning(running: boolean): void {
		if (this._running === running) {
			return;
		}
		this._running = running;
		this._onDidChangeRunning.fire(running);
	}
}
