/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 会话面板：列表、点开、新建、归档、取消归档、搜索、单条删除。
//
// 真源在 DSH Host：每次刷新都以 Host 返回的可见名单为准，本面板不缓存第二份会话表。
// 删除按归档管理器的单条语义：先确认，永久删掉这条会话、它的子会话和全部记录；
// 不删项目目录；调用归档管理器已有的删除方法（Host 侧 deleteSession 已接）。
// 删掉正在看的会话时，停掉收听、聊天清空，不自动换一条。
//
// 行样式复用 VS Code 主题 CSS 变量（无自绘颜色）。

import './media/dshIdeSessions.css';
import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import Severity from '../../../../base/common/severity.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IDshIdeSessionsService, type IDshIdeSessionListState } from './dshIdeSessionsService.js';
import { DshChatSession } from './dshChatSession.js';
import { dshChatSessionFor } from './dshChatPanel.js';
import { IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';

export class DshIdeSessionsView extends ViewPane {
	private list: HTMLElement | undefined;
	private searchBox: HTMLInputElement | undefined;
	private searchResults: HTMLElement | undefined;
	private readonly rowListeners = this._register(new DisposableStore());
	private readonly chat: DshChatSession;
	private readonly pendingDeletes = new Set<string>();

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
		@INotificationService private readonly notifications: INotificationService,
		@IDshIdeSessionsService private readonly sessions: IDshIdeSessionsService,
		@IDshClientService client: IDshClientService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this.chat = dshChatSessionFor(client);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		const container = append(parent, $('.dsh-ide-sessions'));
		const toolbar = append(container, $('.dsh-ide-sessions-toolbar'));
		const create = append(toolbar, $('button.dsh-ide-sessions-new', { title: localize('dsh.sessions.new', "新建会话") })) as HTMLButtonElement;
		create.textContent = localize('dsh.sessions.newLabel', "新建会话");
		this._register(addDisposableListener(create, 'click', () => void this.createSession()));
		this.searchBox = append(container, $('input.dsh-ide-sessions-search', {
			type: 'search',
			placeholder: localize('dsh.sessions.searchPlaceholder', "搜索会话"),
			'aria-label': localize('dsh.sessions.searchPlaceholder', "搜索会话"),
		})) as HTMLInputElement;
		this._register(addDisposableListener(this.searchBox, 'input', () => void this.runSearch()));
		this.searchResults = append(container, $('.dsh-ide-sessions-search-results'));
		this.list = append(container, $('.dsh-ide-sessions-list', { role: 'list', tabIndex: 0 }));
		this._register(this.sessions.onDidChangeState(state => this.renderState(state)));
		this.renderState(this.sessions.state);
	}

	protected override layoutBody(_height: number, _width: number): void {
		// 列表为原生文档流，无自绘滚动条 / 绝对定位，布局交给 ViewPane 容器。
	}

	private async runSearch(): Promise<void> {
		const query = this.searchBox?.value.trim() ?? '';
		if (query === '') {
			clearNode(this.searchResults!);
			return;
		}
		const result = await this.sessions.search(query);
		clearNode(this.searchResults!);
		if (!result.ok) {
			append(this.searchResults!, $('.dsh-ide-sessions-error', undefined, localize('dsh.sessions.searchFailed', "搜索失败（{0}）。", result.error)));
			return;
		}
		for (const item of result.items) {
			const row = append(this.searchResults!, $('.dsh-ide-sessions-search-hit'));
			row.textContent = item.snippet;
			this.rowListeners.add(addDisposableListener(row, 'click', () => void this.openSession(item.sessionId)));
		}
	}

	private renderState(state: IDshIdeSessionListState): void {
		const list = this.list;
		if (list === undefined) {
			return;
		}
		clearNode(list);
		this.rowListeners.clear();
		if (state.phase === 'unbound') {
			append(list, $('.dsh-ide-sessions-empty', undefined, localize('dsh.sessions.unbound', "未绑定会话：请在 DSH 主窗口打开 IDE 窗口以跟随当前会话。")));
			return;
		}
		if (state.lastError !== undefined) {
			append(list, $('.dsh-ide-sessions-error', undefined, localize('dsh.sessions.refreshFailed', "刷新失败（{0}），已保留上次列表。", state.lastError)));
		}
		if (state.items.length === 0) {
			append(list, $('.dsh-ide-sessions-empty', undefined, localize('dsh.sessions.empty', "当前工作区暂无可见会话。")));
			return;
		}
		for (const item of state.items) {
			const row = append(list, $('.dsh-ide-sessions-row', { role: 'listitem', 'data-session-id': item.sessionId }));
			if (item.sessionId === this.sessions.boundSessionId) {
				row.classList.add('selected');
			}
			const label = append(row, $('.dsh-ide-sessions-label'));
			label.textContent = item.title ?? item.sessionId;
			label.title = item.title ?? item.sessionId;
			this.rowListeners.add(addDisposableListener(label, 'click', () => void this.openSession(item.sessionId)));
			if (item.running) {
				append(row, $('.dsh-ide-sessions-badge', undefined, localize('dsh.sessions.running', "运行中")));
			}
			const archive = append(row, $('.dsh-ide-sessions-action', { 'aria-label': localize('dsh.sessions.archive', "归档会话"), title: localize('dsh.sessions.archive', "归档会话") }));
			archive.textContent = '⊟';
			this.rowListeners.add(addDisposableListener(archive, 'click', event => {
				event.stopPropagation();
				void this.archive(item.sessionId);
			}));
			const remove = append(row, $('.dsh-ide-sessions-remove', { 'aria-label': localize('dsh.sessions.delete', "删除会话") }));
			remove.textContent = '\u00d7';
			this.rowListeners.add(addDisposableListener(remove, 'click', event => {
				event.stopPropagation();
				void this.confirmDelete(item.sessionId, item.title ?? item.sessionId);
			}));
		}
	}

	private async openSession(sessionId: string): Promise<void> {
		this.sessions.bind(sessionId);
		await this.chat.bind(sessionId);
	}

	/** 新建会话：内核建好后，聊天与列表都切到新会话。 */
	private async createSession(): Promise<void> {
		const result = await this.sessions.createSession();
		if (!result.ok) {
			this.notifications.warn(localize('dsh.sessions.createFailed', "新建会话失败（{0}）。", result.error));
			return;
		}
		if (typeof result.sessionId === 'string') {
			await this.chat.bind(result.sessionId);
		}
	}

	/** 归档：交给内核已有的 archiveSession；如果归档的是当前会话，聊天清空。 */
	private async archive(sessionId: string): Promise<void> {
		const result = await this.sessions.archiveSession(sessionId);
		if (!result.ok) {
			this.notifications.warn(localize('dsh.sessions.archiveFailed', "归档会话失败（{0}）。", result.error));
			return;
		}
		if (sessionId === this.sessions.boundSessionId) {
			this.sessions.bind(undefined);
			await this.chat.bind(undefined);
		}
	}

	/**
	 * 删除：先确认，说清会永久删掉什么（会话、子会话、全部记录，不能恢复；不删项目目录）。
	 * 确认后调用归档管理器已有的删除方法（Host 的 deleteSession）。
	 */
	private async confirmDelete(sessionId: string, title: string): Promise<void> {
		if (this.pendingDeletes.has(sessionId)) {
			return;
		}
		const confirmed = await this.confirm(
			localize('dsh.sessions.deleteConfirmTitle', "删除会话？"),
			localize('dsh.sessions.deleteConfirmBody', "将永久删除会话“{0}”及其子会话和全部记录（对话内容、统计、缓存）。此操作不可恢复，但不会删除项目目录。", title),
			localize('dsh.sessions.deleteConfirmButton', "删除"),
		);
		if (!confirmed) {
			return;
		}
		this.pendingDeletes.add(sessionId);
		try {
			const result = await this.sessions.deleteSession(sessionId);
			if (!result.ok) {
				this.notifications.warn(localize('dsh.sessions.deleteFailed', "删除会话失败（{0}），列表保持不变。", result.error));
				return;
			}
			// 删的正是当前打开的会话：停止收听，聊天清空，不自动换一条。
			if (sessionId === this.sessions.boundSessionId) {
				this.sessions.bind(undefined);
				await this.chat.bind(undefined);
			}
		} finally {
			this.pendingDeletes.delete(sessionId);
		}
	}

	/** 确认框：走宿主通知的模态提示，不用自绘弹层。 */
	private confirm(title: string, body: string, confirmLabel: string): Promise<boolean> {
		return new Promise(resolve => {
			let settled = false;
			const settle = (value: boolean) => {
				if (settled) {
					return;
				}
				settled = true;
				handle.close();
				resolve(value);
			};
			const handle = this.notifications.prompt(Severity.Warning, `${title}\n${body}`, [
				{ label: confirmLabel, run: () => settle(true) },
			], { onCancel: () => settle(false) });
		});
	}
}
