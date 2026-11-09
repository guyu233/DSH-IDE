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
export class DshChatAgent extends Disposable implements IChatAgentImplementation {
	constructor(
		private readonly client: IDshClientService,
		/** 读取当前 DTO 行（由 `DshIdeConsumer` 维护）；未就绪时返回空数组。 */
		private readonly rows: () => readonly DshIdeRow[],
	) {
		super();
	}

	async invoke(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, _history: unknown[], token: CancellationToken): Promise<IChatAgentResult> {
		// 1) 先把用户输入交给 DSH；失败就明确告知，不伪造回答。
		const submitted = await this.client.call('submit', { text: request.message });
		if (!submitted.ok) {
			progress([{ kind: 'markdownContent', content: new MarkdownString(`DSH-IDE 无法提交消息：${submitted.error.code}`) }]);
			return { errorDetails: { message: submitted.error.message } };
		}

		// 2) 内容回显只来自 DTO 快照：把当前行投影成 markdownContent。
		//    流式增量由快照的 version 推进驱动（consumers 侧已做 16ms 合并）。
		for (const row of this.rows()) {
			if (token.isCancellationRequested) {
				break;
			}
			const text = rowText(row);
			if (text === undefined) {
				continue;
			}
			progress([{ kind: 'markdownContent', content: new MarkdownString(text) }]);
		}
		return {};
	}
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
