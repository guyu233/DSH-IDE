/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 把 DSH 的斜杠命令接进原生 Chat 的 `/` 菜单。
//
// 为什么需要：DSH 的 `commands.list(agent)` / `commands.execute(agent, line, …)` 在 Host
// 侧都已实现（`listCommands` / `runCommand`），但 renderer 侧零调用点——用户在 IDE 输入框
// 敲 `/` 只能看到 VS Code 自己的几条命令，DSH 的命令完全不可达。这是注册缺失，不是样式问题。
//
// 边界：
//   - 命令按会话类型限定（`sessionTypes: [dsh]`），不影响其它会话类型；
//   - 执行只走唯一通道 `runCommand`，参数按契约拆成 `args[]`（契约禁止空格与斜杠）；
//   - 清单读失败就保持现有清单（首次为空），不伪造命令。

import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IChatSlashCommandService, IChatSlashData } from '../../chat/common/participants/chatSlashCommands.js';
import { ChatAgentLocation } from '../../chat/common/constants.js';
import { IProgress } from '../../../../platform/progress/common/progress.js';
import { IChatProgress } from '../../chat/common/chatService/chatService.js';
import { IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import { dshErrorText } from '../../../../platform/dshClient/common/dshIdeProtocol.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { dshSessionIdFromResource } from './dshAgentSessionsController.js';
import { DSH_CHAT_SESSION_TYPE } from './dshSessionType.js';

/** Host 投影出的命令项（`projectDshIdeCommandList` 的形状）。 */
interface DshCommandDescriptor {
	readonly name: string;
	readonly description: string;
}

/**
 * 斜杠命令的宿主状态。
 *
 * 单独一个对象而不是闭包变量，是为了让 `sync` 与命令回调读同一份绑定，
 * 不会出现「回调捕获了旧会话」这类陈旧引用。
 */
export class DshSlashCommandBridge extends Disposable {

	private readonly _registered = new Map<string, IDisposable>();
	private readonly _detail = new Map<string, string>();
	private _sessionId: string | undefined;
	private _disposed = false;

	constructor(
		private readonly _slashCommands: IChatSlashCommandService,
		private readonly _client: IDshClientService,
		private readonly _logService: ILogService,
	) {
		super();
	}

	/**
	 * 绑定当前会话并刷新命令清单。
	 *
	 * 换会话必须重读：命令是 agent-scoped 的，上一个 agent 的命令在新会话里可能不存在。
	 * @param sessionId 当前绑定的 DSH 会话；undefined 表示尚未绑定
	 */
	async setSession(sessionId: string | undefined): Promise<void> {
		this._sessionId = sessionId;
		if (sessionId === undefined) {
			// 没有会话时不能留着上一个 agent 的命令，否则 `/` 菜单还能点到旧会话的命令。
			this.clearRegistered();
			return;
		}
		await this.sync();
	}

	/** 按当前绑定重读清单；失败保持现状（首次即空列表）。 */
	async sync(): Promise<void> {
		if (this._disposed || this._sessionId === undefined) {
			return;
		}
		// `workspace` 是可选字段：会话已绑定 agent 时不需要它，省略比传空串更准确。
		const sessionId = this._sessionId;
		const result = await this._client.call<readonly DshCommandDescriptor[]>('listCommands', {
			sessionId,
		});
		// 慢回包不能盖住已经换上的会话，也不能在解绑之后把旧命令注册回去。
		if (this._disposed || this._sessionId !== sessionId) {
			return;
		}
		if (!result.ok) {
			// 没有 live Agent 时 Host 明确拒绝：不是故障，保持现有清单。
			this._logService.trace('[dsh] listCommands 暂不可用', result.error.code);
			return;
		}
		const next = (Array.isArray(result.value) ? result.value : [])
			.filter(item => typeof item?.name === 'string' && item.name !== '');
		const names = new Set(next.map(item => item.name));
		for (const item of next) {
			// 说明变了必须重注册：原生斜杠服务没有更新接口，旧 detail 会一直留在菜单里。
			if (this._registered.has(item.name) && this._detail.get(item.name) === item.description) {
				continue;
			}
			this._registered.get(item.name)?.dispose();
			this._registered.set(item.name, this.registerOne(item));
			this._detail.set(item.name, item.description);
		}
		// 清单里消失的命令要注销：留在菜单里点了只会报错。
		for (const [name, disposable] of [...this._registered]) {
			if (!names.has(name)) {
				disposable.dispose();
				this._registered.delete(name);
				this._detail.delete(name);
			}
		}
	}

	private registerOne(item: DshCommandDescriptor): IDisposable {
		const data: IChatSlashData = {
			command: item.name,
			detail: item.description,
			sortText: `dsh_${item.name}`,
			locations: [ChatAgentLocation.Chat],
			sessionTypes: [DSH_CHAT_SESSION_TYPE],
		};
		const registration = this._slashCommands.registerSlashCommand(data, async (
			prompt: string,
			progress: IProgress<IChatProgress>,
			_history,
			_location,
			sessionResource: URI,
			_token: CancellationToken,
		) => {
			// 绑定优先。回退必须走资源解码：path 里是 encodeURIComponent 过的 id，
			// 只去掉前导斜杠会把 `%` 留在会话名里，命令打到不存在的会话。
			const sessionId = this._sessionId ?? dshSessionIdFromResource(sessionResource);
			if (sessionId === undefined) {
				this.warn(progress, localize('dsh.slash.noSession', "还没有绑定 DSH 会话，无法执行 /{0}。", item.name));
				return;
			}
			// 契约：`command` 不带前导斜杠，`args` 每项不得含空白或斜杠。
			// 用户输入里的空白按参数分隔，含斜杠的片段无法安全表达时整条拒绝（不猜）。
			const args = prompt.trim() === '' ? [] : prompt.trim().split(/\s+/).filter(part => part !== '');
			if (args.some(part => part.includes('/'))) {
				this.warn(progress, localize('dsh.slash.badArg', "命令 /{0} 的参数含斜杠，无法按契约传递。", item.name));
				return;
			}
			const result = await this._client.call('runCommand', { sessionId, command: item.name, args });
			if (!result.ok) {
				const detail = dshErrorText(result.error, result.error.code);
				this.warn(progress, localize('dsh.slash.rejected', "命令 /{0} 被拒绝：{1}", item.name, detail));
				return;
			}
			progress.report({ kind: 'info', content: { value: localize('dsh.slash.ran', "已执行 /{0}。", item.name) } });
		});
		// 原生注册返回 `IDisposable`：用 `toDisposable` 统一成同一种句柄。
		const wrapper = toDisposable(() => registration.dispose());
		this._register(wrapper);
		return wrapper;
	}

	private warn(progress: IProgress<IChatProgress>, value: string): void {
		// 非 silent 命令会先开一条 response。只写日志的话，用户看到的是空白回复。
		progress.report({ kind: 'warning', content: { value }, keepVisibleWhenCollapsed: true });
	}

	override dispose(): void {
		this._disposed = true;
		this.clearRegistered();
		super.dispose();
	}

	private clearRegistered(): void {
		for (const disposable of this._registered.values()) {
			disposable.dispose();
		}
		this._registered.clear();
		this._detail.clear();
	}
}

/** 供 `dsh.contribution.ts` 注册用。 */
export function registerDshSlashCommands(
	slashCommands: IChatSlashCommandService,
	client: IDshClientService,
	logService: ILogService,
): DshSlashCommandBridge {
	return new DshSlashCommandBridge(slashCommands, client, logService);
}
