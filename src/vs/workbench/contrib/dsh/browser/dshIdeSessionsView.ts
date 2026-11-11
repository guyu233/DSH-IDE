/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// D49：会话列表两态视图（§8.10.2「正常 / 未绑定」）。
//
// 这是 contrib/dsh/browser/ 自带的轻量视图，不改动 contrib/chat/**、不接管 VS Code
// 的 Chat 模型、不接 AgentHost/Copilot 的会话服务（AGENTS.md §4 已移除其专属源码）。
// 只消费 DshIdeSessionsService 暴露的中立状态：每次刷新以 DSH Host 的可见名单为准，
// 未绑定显示空状态且禁止取数 / 删除，刷新失败保留旧列表并显示原因（fail-closed）。
//
// 行样式复用 VS Code 主题 CSS 变量（无自绘颜色）；删除与刷新走服务，不另建 helper。

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
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IDshIdeSessionsService, type IDshIdeSessionListState } from './dshIdeSessionsService.js';

export class DshIdeSessionsView extends ViewPane {
	private list: HTMLElement | undefined;
	/** 每次重绘先清空上一批行按钮的监听，避免重复渲染泄漏可释放对象。 */
	private readonly rowListeners = this._register(new DisposableStore());

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
		@IDshIdeSessionsService private readonly sessions: IDshIdeSessionsService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		const container = append(parent, $('.dsh-ide-sessions'));
		this.list = append(container, $('.dsh-ide-sessions-list', { role: 'list', tabIndex: 0 }));
		this._register(this.sessions.onDidChangeState(state => this.renderState(state)));
		this.renderState(this.sessions.state);
	}

	protected override layoutBody(_height: number, _width: number): void {
		// 列表为原生文档流，无自绘滚动条 / 绝对定位，布局交给 ViewPane 容器。
	}

	/** 单一渲染入口：两态 + 刷新失败提示，不引入第三种列表状态。 */
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
			const label = append(row, $('.dsh-ide-sessions-label'));
			label.textContent = item.title ?? item.sessionId;
			if (item.running) {
				append(row, $('.dsh-ide-sessions-badge', undefined, localize('dsh.sessions.running', "运行中")));
			}
			// 删除按钮直接走服务（成功后主动重查），不持有通道与 DSH 内部模型。
			const remove = append(row, $('.dsh-ide-sessions-remove', { 'aria-label': localize('dsh.sessions.delete', "删除会话") }));
			remove.textContent = '\u00d7';
			this.rowListeners.add(addDisposableListener(remove, 'click', () => void this.sessions.deleteSession(item.sessionId)));
		}
	}
}
