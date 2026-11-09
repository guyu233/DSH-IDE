/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P4：把 DSH 会话接成 CHAT 面板的「唯一 Agent」。
//
// 为什么需要它：K5 要求 Chat 面板显示来自 `dshIde` 的 DTO 投影内容。VS Code 的 Chat 面板只在
// **一次真实 request** 的 response 里渲染 `IChatProgress`，而 request 由已注册的 Chat Agent 驱动。
// DSH-IDE 此前没有任何 Chat Agent，所以面板永远空白——这不是样式问题，是缺一个供给方。
//
// 边界（第 1 章 §3 / §4）：
//   - 本文件在 `workbench/**`，**零 `@deepseek-ai/*`**；
//   - Agent 不持有会话状态：用户消息经 `IDshClientService.call('submit')` 交给 DSH Host，
//     内容回显完全走 DTO 快照（不做乐观插入，第 1 章 §4.5）；
//   - 只注册一个动态 Agent（`isDefault`），不存在第二个 AI 供给方。

import { Disposable } from '../../../../base/common/lifecycle.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import type { IChatAgentData, IChatAgentImplementation, IChatAgentRequest, IChatAgentResult } from '../../chat/common/participants/chatAgents.js';
import { ChatAgentLocation, ChatModeKind } from '../../chat/common/constants.js';
import type { IChatAgentService } from '../../chat/common/participants/chatAgents.js';
import type { IChatProgress } from '../../chat/common/chatService/chatService.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import type { IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import type { DshIdeRow } from '../../../../platform/dshClient/common/dshIdeProtocol.js';
import { rowText } from './dshIdeUiProjection.js';

/** 唯一的 DSH Chat Agent id（与 terms 一致：不存在第二个 AI 供给方）。 */
export const DSH_CHAT_AGENT_ID = 'dsh-ide';

/** Agent 元数据：core 级、默认参与者、不来自扩展市场。 */
export function dshChatAgentData(): IChatAgentData {
	return {
		id: DSH_CHAT_AGENT_ID,
		name: DSH_CHAT_AGENT_ID,
		fullName: 'DSH-IDE',
		description: 'DeepSeek Assistant 驱动的 IDE 助手',
		isDefault: true,
		isDynamic: true,
		isCore: true,
		extensionId: new ExtensionIdentifier('dsh-ide.builtin'),
		extensionVersion: undefined,
		extensionPublisherId: 'dsh-ide',
		publisherDisplayName: 'DSH-IDE',
		extensionDisplayName: 'DSH-IDE',
		// IChatAgentData 的四个必填集合：无斜杠命令、只在面板、单一模式、无消歧义。
		slashCommands: [],
		// `Chat` 即面板（其线上值为 'panel'，见 chat/common/constants.ts）。
		locations: [ChatAgentLocation.Chat],
		modes: [ChatModeKind.Ask],
		disambiguation: [],
		// IChatAgentMetadata 只有 9 个可选字段；能力声明不在这里。
		metadata: {
			isSticky: true,
			sampleRequest: '在当前工作区提问',
		},
	};
}

/**
 * DSH Chat Agent 实现。
 *
 * `invoke` 只做两件事：把用户输入交给 DSH（`submit`），并把 DTO 行投影成 `IChatProgress` 推出。
 * 它**不**在本地生成回答、不维护第二份会话状态；DSH 不可用时返回确定的错误说明。
 */
/** 等待新 DTO 行的上限：超时就按现有行交付，避免请求永久挂住。 */
export const DSH_CHAT_AGENT_WAIT_MS = 15_000;
/** 轮询间隔：DTO 快照由 16ms 合并驱动，这里按同一量级取样。 */
export const DSH_CHAT_AGENT_POLL_MS = 32;

export class DshChatAgent extends Disposable implements IChatAgentImplementation {
	constructor(
		private readonly client: IDshClientService,
		/** 读取当前 DTO 行（由 `DshIdeConsumer` 维护）；未就绪时返回空数组。 */
		private readonly rows: () => readonly DshIdeRow[],
		private readonly waitMs: number = DSH_CHAT_AGENT_WAIT_MS,
	) {
		super();
	}

	async invoke(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, _history: unknown[], token: CancellationToken): Promise<IChatAgentResult> {
		// 提交前的行数：用来判断 DSH 是否已经真的把这次输入写进了会话日志。
		const baseline = this.rows().length;

		// 1) 先把用户输入交给 DSH；失败就明确告知，不伪造回答。
		const submitted = await this.client.call('submit', { text: request.message });
		if (!submitted.ok) {
			progress([{ kind: 'markdownContent', content: new MarkdownString(`DSH-IDE 无法提交消息：${submitted.error.code}`) }]);
			return { errorDetails: { message: submitted.error.message } };
		}

		// 2) 等快照真的长出内容再回显。
		//    为什么必须等：`submit` 只是把消息投进 DSH 收件箱，会话日志是**稍后**提交的；
		//    立刻回显只能画出提交前的旧行（用户消息与回答都还不在里面），面板看起来是空的。
		//    这里轮询 DTO 行数，出现新行即交付；超时则明确返回超时提示，而不是假装有内容。
		const deadline = Date.now() + this.waitMs;
		let rows = this.rows();
		while (rows.length <= baseline && Date.now() < deadline && !token.isCancellationRequested) {
			await delay(DSH_CHAT_AGENT_POLL_MS);
			rows = this.rows();
		}

		if (token.isCancellationRequested) {
			return {};
		}
		if (rows.length <= baseline) {
			// 没有新行：不伪造回答，给一条可核对的说明。
			progress([{ kind: 'markdownContent', content: new MarkdownString('DSH-IDE 已提交消息，但在等待上限内没有收到会话日志更新。') }]);
			return {};
		}

		// 3) 内容回显只来自 DTO 快照：把新增/变更的行投影成 markdownContent。
		//    从 baseline 之后开始推，避免把历史行重复画一遍。
		for (const row of rows.slice(baseline)) {
			if (token.isCancellationRequested) {
				break;
			}
			const content = rowToChatContent(row);
			if (content === undefined) {
				continue;
			}
			progress([content]);
		}
		return {};
	}
}

/** 可被信号打断的延时（轮询用）。 */
function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * DTO 行 → Chat 渲染内容的**唯一**映射（Agent 与单测共用这一份实现）。
 *
 * 只用 `markdownContent`：它是 `dshChatSeam` 接管、又与原生渲染器兼容最好的 kind。
 * 工具行不伪造 `toolInvocation`（第 8 章 §8.4：工具主体保留 VS Code 原生渲染）。
 * 空行返回 undefined，调用方据此跳过（不产生空壳）。
 */
export function rowToChatContent(row: DshIdeRow): IChatProgress | undefined {
	const text = rowText(row);
	if (text === undefined) {
		return undefined;
	}
	const markdown = new MarkdownString(text);
	// 用户输入按纯文本处理（不放行 Markdown 与命令）；DSH 输出允许默认 Markdown，但不放行命令执行。
	markdown.isTrusted = row.kind === 'user' ? false : { enabledCommands: [] };
	return { kind: 'markdownContent', content: markdown };
}

/** 注册唯一的 DSH Chat Agent；返回可释放句柄。 */
export function registerDshChatAgent(agentService: IChatAgentService, client: IDshClientService, rows: () => readonly DshIdeRow[]): { dispose(): void } {
	const agent = new DshChatAgent(client, rows);
	const registration = agentService.registerDynamicAgent(dshChatAgentData(), agent);
	return {
		dispose: () => {
			registration.dispose();
			agent.dispose();
		},
	};
}
