/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 渲染器侧的通道 B 执行桥：主进程 DshPipeChannel 把 Host 发起的 ide_* 请求经 'b-exec' 事件推来，
// 本类用 ideExec（DshIdeExec）执行并回 'b-reply'。它把工作台服务（文件/LSP/终端）接入受控执行。
//
// 生命周期：workbench 启动时创建一次（仅当 DSH_IDE_PIPE 存在），在 workbench 作用域内 dispose。

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IDshChatClient, IDshPipeFrame } from '../../../../platform/dshPipe/common/dshChatClient.js';
import { DshIdeExec } from './ideExec.js';

export class DshIdeExecBridge extends Disposable {

	private readonly exec: DshIdeExec;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IDshChatClient client: IDshChatClient,
	) {
		super();
		this.exec = this._register(instantiationService.createInstance(DshIdeExec));
		// 订阅主进程推送的 b-exec 请求。
		this._register(client.onDidExecRequest((req) => { void this.onExecRequest(client, req.id, req.op, req.args); }));
	}

	private async onExecRequest(client: IDshChatClient, id: string, op: string, args: unknown): Promise<void> {
		let reply: { ok: boolean; result?: unknown; error?: string };
		try {
			reply = await this.exec.execute(op, args);
		} catch (e) {
			reply = { ok: false, error: String((e && (e as Error).message) || e) };
		}
		await client.replyExec(id, reply.ok, reply.result, reply.error);
	}
}

/** 便捷导出：把通道 A 流帧映射到 DSH 渲染需要的条目（chatWebview 使用）。 */
export function frameToEntries(frame: IDshPipeFrame['frame']): { mode: 'append' | 'replace'; entries: unknown[]; hasMore: boolean; cursor?: number } | undefined {
	const payload = frame.payload as { type?: string; records?: unknown[]; event?: unknown; hasMore?: boolean; cursor?: number } | undefined;
	if (!payload) { return undefined; }
	if (payload.type === 'snapshot') {
		return { mode: 'replace', entries: Array.isArray(payload.records) ? payload.records : [], hasMore: payload.hasMore === true, cursor: payload.cursor };
	}
	if (payload.type === 'event' && payload.event) {
		return { mode: 'append', entries: [{ type: 'event', event: payload.event }], hasMore: false };
	}
	return undefined;
}
