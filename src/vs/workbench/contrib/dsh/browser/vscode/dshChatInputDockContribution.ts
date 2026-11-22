/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 把输入区的两个官方 dock 槽接进原生 ChatWidget。
//
// 官方位置（`ui-conversation/src/client/contract/slots.ts`）：
//   - `conversation.input.dock` 是输入卡**上方**的整行区域（todo / goal / queue 这类常驻条）；
//   - `conversation.composer.dock` 是输入卡**下方**的环境区。
//
// 本仓的输入区是原生 `ChatInputPart`，没有 DSH 自己的输入 DOM。这里不复制输入机，
// 只在原生容器里插入两个宿主：上方的插到 `chatInputStack` 里输入卡之前，
// 下方的插到输入卡之后。没有 occupant 时宿主 `display:none`，不占位、不影响原生布局。
//
// 为什么放在贡献点而不是改 `ChatInputPart`：这是 DSH 一个插件的扩展需求，
// 上游输入框不该认识 DSH；用 `IChatWidgetService.onDidAddWidget` 拿到每个原生 widget，
// 插件卸载时随 `DisposableStore` 一起摘掉，上游零改动。

import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IChatWidget, IChatWidgetService } from '../../../chat/browser/chat.js';
import { ChatAgentLocation } from '../../../chat/common/constants.js';
import { DshChatInputDock } from './dshChatInputDock.js';
import type { DshQueueRowAction } from './dshInputDock.js';
import { dshSessionIdFromResource } from './dshAgentSessionsController.js';
import { dshChatSessionFor, type DshChatSession } from './dshChatSession.js';
import { IDshClientService } from '../../../../../platform/dshClient/common/dshClientService.js';

/** 一个已挂载的 widget：两个 dock 宿主 + 会话监听。 */
interface MountedWidget {
	readonly input: DshChatInputDock;
	readonly composer: DshChatInputDock;
	readonly store: DisposableStore;
}

/**
 * 监听原生 chat widget 的创建，把两个 DSH dock 席位挂进输入区。
 *
 * 只处理 `ChatAgentLocation.Chat` 的主输入（面板里的会话输入框）；行内 chat 与
 * quick chat 的输入区不是 DSH 会话的落点，不挂。
 */
export class DshChatInputDockContribution extends Disposable {
	private readonly mounted = new Map<IChatWidget, MountedWidget>();
	private readonly chat: DshChatSession;

	constructor(
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
		@ICommandService private readonly commandService: ICommandService,
		@IDshClientService client: IDshClientService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
	) {
		super();
		// 队列的事实来源：DSH 会话本身（官方 `inbox` 投影），不在 IDE 侧自建。
		this.chat = dshChatSessionFor(client);
		for (const widget of this.chatWidgetService.getAllWidgets()) {
			this.mount(widget);
		}
		this._register(this.chatWidgetService.onDidAddWidget(widget => this.mount(widget)));
		this._register(this.chatWidgetService.onDidRemoveWidget(widget => this.unmount(widget)));
	}

	override dispose(): void {
		for (const widget of [...this.mounted.keys()]) {
			this.unmount(widget);
		}
		super.dispose();
	}

	private mount(widget: IChatWidget): void {
		if (this.mounted.has(widget) || widget.location !== ChatAgentLocation.Chat) {
			return;
		}
		const inputContainer = widget.inputPart.inputContainerElement;
		if (inputContainer === undefined || inputContainer === null) {
			return;
		}
		const stack = inputContainer.parentElement;
		if (stack === null) {
			return;
		}
		const host = {
			executeCommand: (command: string, args: readonly unknown[]): void => {
				void this.commandService.executeCommand(command, ...args);
			},
			// 队列动作只发请求：结果由 Host 的 `inbox` 投影下一帧带回（见 `DshChatSession.updateQueue`）。
			// `edit` 需要新文本，走单独的输入框入口；行内按钮只承载 remove / steer。
			updateQueue: (itemId: string, action: DshQueueRowAction): void => {
				if (action === 'edit') {
					void this.promptQueueEdit(itemId);
					return;
				}
				void this.chat.updateQueue(itemId, { kind: action });
			},
		};
		const store = new DisposableStore();
		const input = store.add(new DshChatInputDock('input', host));
		const composer = store.add(new DshChatInputDock('composer', host));
		store.add({ dispose: () => input.domNode.remove() });
		store.add({ dispose: () => composer.domNode.remove() });
		// 上方：输入卡之前；下方：输入卡之后。都用原生容器做锚点，不另外包一层。
		stack.insertBefore(input.domNode, inputContainer);
		stack.insertBefore(composer.domNode, inputContainer.nextSibling);
		this.mounted.set(widget, { input, composer, store });
		const sync = () => {
			const sessionId = widget.viewModel?.sessionResource === undefined
				? undefined
				: dshSessionIdFromResource(widget.viewModel.sessionResource);
			// `InputZone.session` 是官方 owner 的会话快照。本仓不复制会话事实，
			// 只把「这是哪个会话」这个已有身份交给 occupant；`input`（输入机状态）
			// 不在本仓建模，如实留空而不是伪造一个假值。
			const session = sessionId === undefined ? undefined : { sessionId };
			// 队列来自 DSH 会话的 `inbox` 投影（官方 `QueueDock` 的数据源）。
			// 没有会话时没有队列；`DshChatSession` 是本贡献点唯一的事实来源，不在 IDE 侧自建。
			const inbox = sessionId === undefined ? undefined : this.chat.inboxNextTurn();
			input.update(sessionId, session === undefined ? undefined : { session }, inbox);
			composer.update(sessionId);
		};
		sync();
		store.add(widget.onDidChangeViewModel(() => sync()));
	}

	/**
	 * 编辑一条排队输入：弹输入框收新文本，再调官方 `updateQueue`。
	 *
	 * 官方 `QueueAction.edit.content` 只接受非空纯文本，所以这里只收文本；
	 * 用户取消或留空都不发请求（留空会被 Host 拒绝，没必要打一次来回）。
	 */
	private async promptQueueEdit(itemId: string): Promise<void> {
		const value = await this.quickInputService.input({
			title: localize('dsh.queue.editTitle', "Edit queued message"),
			prompt: localize('dsh.queue.editPrompt', "The new text replaces the queued message."),
			placeHolder: localize('dsh.queue.editPlaceholder', "Message text"),
			ignoreFocusLost: true,
		});
		if (value === undefined || value.trim() === '') {
			return;
		}
		await this.chat.updateQueue(itemId, { kind: 'edit', text: value });
	}

	private unmount(widget: IChatWidget): void {
		const mounted = this.mounted.get(widget);
		if (mounted === undefined) {
			return;
		}
		this.mounted.delete(widget);
		mounted.store.dispose();
	}
}
