/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 聊天面板：聊天视图里的主内容区，直接按 DSH 聊天页的样子画。
//
// 数据：内核那一次 `sessionController.follow` 的帧，经 `DshChatModel` 解成条目，
// 每条由抄来的 DSH 渲染件（`build/dsh/chat-render`）画。这里不翻译 DSH 事件，也不自己连会话。
//
// 交互：发送、停止、换模型都经 `IDshClientService.call` 交给内核。回退（rewind）明确拒绝。
// 批准与提问：`listen('waterfall')` 送到面板里画，不弹右下角通知。
// 文件：消息里点到的文件在 IDE 编辑器里打开。

import './media/dshChatPanel.css';
import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { URI } from '../../../../base/common/uri.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { ViewPane, IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import { DshChatEntryPart } from './dshChatSeam.js';
import { DshChatSession, type IDshChatSession } from './dshChatSession.js';
import type { DshChatEntry } from './dshChatModel.js';

/** 下拉里的一个模型选项。 */
export interface DshChatModelOption {
	readonly provider: string;
	readonly model: string;
	readonly name: string;
}

/** 正在等用户决定的批准 / 问卷。 */
export interface DshChatPending {
	readonly eventId: string;
	readonly kind: 'approval' | 'question';
	readonly title: string;
	/** 问卷的单选标签；批准为空。 */
	readonly options: readonly string[];
	/** 问卷题号（回答时回填的 `answers[].id`）；批准不带。 */
	readonly questionId?: string;
}

export class DshChatPanel extends ViewPane {
	private readonly bodyStore = this._register(new DisposableStore());
	private list: HTMLElement | undefined;
	private input: HTMLTextAreaElement | undefined;
	private send: HTMLButtonElement | undefined;
	private stop: HTMLButtonElement | undefined;
	private model: HTMLSelectElement | undefined;
	private pendingHost: HTMLElement | undefined;
	private readonly parts = new Map<string, DshChatEntryPart>();
	private readonly pendingHandles = new Set<string>();

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@ICommandService private readonly commandService: ICommandService,
		@IEditorService private readonly editorService: IEditorService,
		@IDshClientService private readonly client: IDshClientService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this.session = dshChatSessionFor(this.client);
	}
	private readonly session: IDshChatSession;

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		const root = append(parent, $('.dsh-chat-panel'));
		this.list = append(root, $('.dsh-chat-list', { role: 'log', 'aria-live': 'polite' }));
		this.pendingHost = append(root, $('.dsh-chat-pending-host'));

		const composer = append(root, $('.dsh-chat-composer'));
		const toolbar = append(composer, $('.dsh-chat-composer-toolbar'));
		this.model = append(toolbar, $('select.dsh-chat-model', { 'aria-label': localize('dsh.chat.model', "选择模型") })) as HTMLSelectElement;
		this.bodyStore.add(addDisposableListener(this.model, 'change', () => {
			const value = this.model!.value;
			const option = this.session.models().find(item => `${item.provider}/${item.model}` === value);
			if (option !== undefined) {
				void this.session.selectModel(option.provider, option.model);
			}
		}));
		this.stop = append(toolbar, $('button.dsh-chat-stop', { title: localize('dsh.chat.stop', "停止") })) as HTMLButtonElement;
		this.stop.appendChild($('span.codicon.codicon-debug-stop'));
		this.bodyStore.add(addDisposableListener(this.stop, 'click', () => void this.session.cancel()));

		this.input = append(composer, $('textarea.dsh-chat-input', {
			placeholder: localize('dsh.chat.placeholder', "给 DeepSeek 发消息"),
			rows: '3',
		})) as HTMLTextAreaElement;
		this.bodyStore.add(addDisposableListener(this.input, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				this.submit();
			}
		}));
		this.send = append(composer, $('button.dsh-chat-send', { title: localize('dsh.chat.send', "发送") })) as HTMLButtonElement;
		this.send.textContent = localize('dsh.chat.sendLabel', "发送");
		this.bodyStore.add(addDisposableListener(this.send, 'click', () => this.submit()));

		this.bodyStore.add(this.session.onDidChangeModelMenu(() => this.renderModelMenu()));
		this.bodyStore.add(this.session.onDidChangeEntries(([entries, reset]) => this.renderEntries(entries, reset)));
		this.bodyStore.add(this.session.onDidChangePending(pending => this.renderPending(pending)));
		this.bodyStore.add(this.session.onDidChangeRunning(running => this.renderRunning(running)));
		this.renderModelMenu();
		this.renderEntries(this.session.entries(), true);
		this.renderPending(this.session.pending());
		this.renderRunning(this.session.running());
	}

	protected override layoutBody(height: number, width: number): void {
		// 列表为原生文档流，滚动交给容器；输入框固定在底部。
		void height;
		void width;
	}

	private submit(): void {
		const text = this.input?.value.trim();
		if (text === undefined || text === '') {
			return;
		}
		this.input!.value = '';
		void this.session.submit(text);
	}

	private renderModelMenu(): void {
		if (this.model === undefined) {
			return;
		}
		clearNode(this.model);
		const current = this.session.currentModel();
		for (const option of this.session.models()) {
			const element = document.createElement('option');
			element.value = `${option.provider}/${option.model}`;
			element.textContent = option.name;
			element.selected = current !== undefined && current.provider === option.provider && current.model === option.model;
			this.model.appendChild(element);
		}
		this.model.disabled = this.session.models().length === 0;
	}

	private renderRunning(running: boolean): void {
		if (this.stop === undefined) {
			return;
		}
		this.stop.disabled = !running;
	}

	private renderEntries(entries: readonly DshChatEntry[], reset: boolean): void {
		if (this.list === undefined) {
			return;
		}
		if (reset) {
			for (const part of this.parts.values()) {
				part.dispose();
			}
			this.parts.clear();
			clearNode(this.list);
		}
		for (const entry of entries) {
			const existing = this.parts.get(entry.id);
			if (existing === undefined) {
				const part = new DshChatEntryPart(entry.part);
				this.parts.set(entry.id, part);
				append(this.list, part.domNode);
			} else {
				existing.setProps(entry.part);
			}
		}
		this.list.scrollTop = this.list.scrollHeight;
	}

	private renderPending(pending: readonly DshChatPending[]): void {
		if (this.pendingHost === undefined) {
			return;
		}
		clearNode(this.pendingHost);
		this.pendingHandles.clear();
		for (const item of pending) {
			this.pendingHandles.add(item.eventId);
			const card = append(this.pendingHost, $('.dsh-chat-pending'));
			append(card, $('.dsh-chat-pending-title', undefined, item.title));
			const actions = append(card, $('.dsh-chat-pending-actions'));
			if (item.kind === 'approval') {
				this.pendingButton(actions, localize('dsh.chat.allow', "允许一次"), () => this.session.answerApproval(item.eventId, 'approve'));
				this.pendingButton(actions, localize('dsh.chat.reject', "拒绝"), () => this.session.answerApproval(item.eventId, 'reject'));
			} else {
				for (const label of item.options) {
					this.pendingButton(actions, label, () => this.session.answerQuestion(item.eventId, label));
				}
			}
		}
	}

	private pendingButton(parent: HTMLElement, label: string, run: () => void): void {
		const button = append(parent, $('button.dsh-chat-pending-button')) as HTMLButtonElement;
		button.textContent = label;
		addDisposableListener(button, 'click', run);
	}

	/** 给内容里的文件链接用：在 IDE 编辑器里打开。 */
	async openFile(path: string): Promise<void> {
		try {
			await this.editorService.openEditor({ resource: URI.file(path) });
		} catch {
			await this.commandService.executeCommand('vscode.open', URI.file(path));
		}
	}

	/** 当前可见的待决请求（供外部判断是否还有未处理的批准）。 */
	get pendingCount(): number {
		return this.pendingHandles.size;
	}
}

/** 供贡献点构造视图用：面板只依赖这个最小会话口。 */
export type DshChatPanelSession = IDshChatSession;

/** 进程内唯一的聊天会话状态：面板和贡献点共用同一份（帧只喂一次）。 */
let sharedChatSession: DshChatSession | undefined;

export function dshChatSessionFor(client: IDshClientService): DshChatSession {
	if (sharedChatSession === undefined) {
		sharedChatSession = new DshChatSession(client);
	}
	return sharedChatSession;
}

/** 组件用的图标（从 VS Code codicon 取，不自绘）。 */
export const DSH_CHAT_STOP_ICON = Codicon.debugStop;
export const DSH_CHAT_SEND_ICON = ThemeIcon.asClassName(Codicon.send);
