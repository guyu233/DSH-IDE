/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// D49：把 `dshIde` 通道的 listSessions / deleteSession 调用适配成会话列表状态机的取数端口。
//
// 本文件是唯一一处把官方通道调用翻译成中立 DTO 的接缝（§8.10.2：列表经 invoke 主动查询，
// 不进快照 rows）；零 @deepseek-ai/*、零 workbench 运行时依赖，便于离线单测。
// fail-closed：通道返回 !ok 或畸形载荷一律抛带官方 code 的错误，交给状态机保留旧列表并报告原因
// （§8.10.5 降级规则），绝不静默降级成空列表或「已删除」态。

import type { DshClientCallResult, IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import type { IDshIdeSessionSummary } from '../../../../platform/dshClient/common/dshIdeProtocol.js';
import type { IDshIdeSessionListSource } from './dshIdeSessionListModel.js';

/** 只依赖 client.call 的最小切片：不绑定具体服务实现，测试可直接传假 call。 */
export type DshIdeSessionListCaller = Pick<IDshClientService, 'call'>;

/** 会话列表取数端口：状态机只经它读 Host，不感知通道与 DSH 内部模型。 */
export class DshClientSessionListSource implements IDshIdeSessionListSource {
	constructor(private readonly client: DshIdeSessionListCaller) { }

	async list(): Promise<readonly IDshIdeSessionSummary[]> {
		const result = await this.client.call<readonly IDshIdeSessionSummary[]>('listSessions', {});
		if (!result.ok) {
			throw sessionListError(result);
		}
		// 版本绑定承担官方载荷兼容性；这里只做最小结构守卫，不让畸形值静默变成空列表。
		if (!Array.isArray(result.value)) {
			const error = new Error('listSessions must return an array');
			(error as { code?: string }).code = 'dsh-ide/invalid-argument';
			throw error;
		}
		return result.value;
	}

	async remove(sessionId: string): Promise<void> {
		const result = await this.client.call('deleteSession', { sessionId });
		if (!result.ok) {
			throw sessionListError(result);
		}
	}
}

/** 把通道错误收敛成带官方 code 的 Error，状态机的 errorMessage() 才能优先显示 code。 */
function sessionListError(result: Extract<DshClientCallResult<unknown>, { ok: false }>): Error {
	const error = new Error(result.error.message);
	(error as { code?: string }).code = result.error.code;
	return error;
}
