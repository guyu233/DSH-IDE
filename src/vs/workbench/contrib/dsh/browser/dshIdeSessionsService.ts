/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// D49：IDE renderer 侧唯一的会话列表供给方（§8.10.4 批次 A③与 B⑧）。
//
// 职责：把 `IDshClientService` 的 listSessions / deleteSession 调用接进
// `DshIdeSessionListModel` 状态机，并在「手动刷新 / 窗口聚焦 / 删除成功后」主动重查。
//
// 边界（第 1 章 §3 / §8.2.4）：
//   - 零 @deepseek-ai/*；会话真源在 DSH Host，本服务不缓存第二份会话表，
//     每次刷新都以 Host 返回的可见名单为准（有边界最终一致）。
//   - 未绑定（无 sessionId）时状态机 fail-closed：零取数、零删除、空状态，
//     不降级显示全部工作区会话。
//   - 只有一条刷新入口 refresh()：focus / 手动 / 删除成功都汇到这里，不定时轮询。
//   - 删除成功只重查，不设「已删除 / 未知」两态；失败保留列表并报告原因。

import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { env } from '../../../../base/common/process.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { DSH_IDE_SESSION_ENV } from '../../../../platform/dshClient/common/env.js';
import { IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import type { IDshIdeSessionSummary } from '../../../../platform/dshClient/common/dshIdeProtocol.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { DshIdeSessionListModel, type IDshIdeSessionListState } from './dshIdeSessionListModel.js';
import { DshClientSessionListSource } from './dshIdeSessionListSource.js';

export const IDshIdeSessionsService = createDecorator<IDshIdeSessionsService>('dshIdeSessionsService');

/** 视图层只需这一组中立 DTO 与状态，不反向依赖平台通道细节。 */
export type { IDshIdeSessionListState, IDshIdeSessionSummary };

export interface IDshIdeSessionsService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeState: Event<IDshIdeSessionListState>;
	readonly state: IDshIdeSessionListState;
	/** 唯一刷新入口；未绑定时零请求。 */
	refresh(): Promise<void>;
	/** 删除会话；成功后由状态机主动重查，失败保留列表。 */
	deleteSession(sessionId: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }>;
	/** 新建会话，成功后切过去。 */
	createSession(): Promise<{ readonly ok: true; readonly sessionId?: string } | { readonly ok: false; readonly error: string }>;
	/** 归档 / 取消归档。 */
	archiveSession(sessionId: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }>;
	unarchiveSession(sessionId: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }>;
	/** 检索会话（标题 / 正文）。 */
	search(query: string | undefined): Promise<{ readonly ok: true; readonly items: readonly { readonly sessionId: string; readonly snippet: string }[] } | { readonly ok: false; readonly error: string }>;
	/** 切换绑定会话（开窗参数变化时）；重绑会作废在途旧读。 */
	bind(sessionId: string | undefined): void;
	/** 当前绑定的会话 id。 */
	readonly boundSessionId: string | undefined;
}

export class DshIdeSessionsService extends Disposable implements IDshIdeSessionsService {
	declare readonly _serviceBrand: undefined;

	private readonly _model: DshIdeSessionListModel;

	constructor(
		@IDshClientService private readonly _client: IDshClientService,
		@IHostService hostService: IHostService,
	) {
		super();
		const bound = env[DSH_IDE_SESSION_ENV];
		this._model = this._register(new DshIdeSessionListModel(
			new DshClientSessionListSource(this._client),
			typeof bound === 'string' && bound !== '' ? bound : undefined,
		));
		// 窗口聚焦重查（§8.10.2：不造通知机制、不定时轮询）。失焦不取数。
		this._register(hostService.onDidChangeFocus(focused => {
			if (focused) {
				void this.refresh();
			}
		}));
		// 首次取数：绑定了会话才向 Host 发起一次读取；未绑定保持空状态。
		void this.refresh();
	}

	// 用 getter 而非字段初始化：字段初始化先于构造器体，那时 _model 还未赋值。
	get onDidChangeState(): Event<IDshIdeSessionListState> {
		return this._model.onDidChangeState;
	}

	get state(): IDshIdeSessionListState {
		return this._model.state;
	}

	refresh(): Promise<void> {
		return this._model.refresh();
	}

	deleteSession(sessionId: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }> {
		return this._model.deleteSession(sessionId);
	}

	/** 新建会话：交给内核，成功后绑定到新会话并重查列表。 */
	async createSession(): Promise<{ readonly ok: true; readonly sessionId?: string } | { readonly ok: false; readonly error: string }> {
		const result = await this._client.call<{ readonly sessionId?: string }>('newSession', {});
		if (!result.ok) {
			return { ok: false, error: result.error.message };
		}
		const sessionId = result.value?.sessionId;
		if (typeof sessionId === 'string') {
			this.bind(sessionId);
		}
		await this.refresh();
		return { ok: true, sessionId };
	}

	async archiveSession(sessionId: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }> {
		const result = await this._client.call('archiveSession', { sessionId });
		if (!result.ok) {
			return { ok: false, error: result.error.message };
		}
		await this.refresh();
		return { ok: true };
	}

	async unarchiveSession(sessionId: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }> {
		const result = await this._client.call('unarchiveSession', { sessionId });
		if (!result.ok) {
			return { ok: false, error: result.error.message };
		}
		await this.refresh();
		return { ok: true };
	}

	async search(query: string | undefined): Promise<{ readonly ok: true; readonly items: readonly { readonly sessionId: string; readonly snippet: string }[] } | { readonly ok: false; readonly error: string }> {
		if (typeof query !== 'string' || query.trim() === '') {
			return { ok: true, items: [] };
		}
		const result = await this._client.call<{ readonly items?: readonly { readonly sessionId: string; readonly snippet: string }[] }>('searchSessions', { query });
		if (!result.ok) {
			return { ok: false, error: result.error.message };
		}
		return { ok: true, items: result.value?.items ?? [] };
	}

	bind(sessionId: string | undefined): void {
		this._model.bind(sessionId);
	}

	get boundSessionId(): string | undefined {
		return this._model.boundSessionId;
	}
}
