/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH 风格的模型菜单：两级结构 + 按供应商分组 + 推理等级。
//
// 为什么替换的是「下拉内容」而不是「触发按钮」：输入框上的按钮仍是 VS Code 自己的
// `ModelPickerActionItem`，只在打开时改用本菜单。这样按钮的布局、键盘可达性、
// 响应式收缩都还是原生的，不会出现「第二套控件」。
//
// 视觉对齐 DSH 的 ModelSelect（`ui-model-selection/src/client/ModelSelect.tsx`）：
//   - 根菜单两行：模型 / 推理等级，右侧是当前值与 chevron
//   - 模型面板：搜索（超过 4 个时）+ 按供应商分组
//   - 推理面板：档位列表
//   - 团队开关跟在根菜单末尾（DSH 的 `conversation.input.model.options` 槽位）
// 颜色全部用 VS Code 主题变量，不使用 DSH 的 `--dsw-*` 令牌。

import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import './media/dshModelMenu.css';
import type { IModelPickerDelegate } from '../../chat/browser/widget/input/modelPicker/modelPickerActionItem.js';
import type { ILanguageModelChatMetadataAndIdentifier } from '../../chat/common/languageModels.js';
import type { IDshComposerSource } from './dshComposerSource.js';

type Pane = 'root' | 'model' | 'effort';

/** 一个供应商分组。 */
interface ProviderGroup {
	readonly id: string;
	readonly label: string;
	readonly models: readonly ILanguageModelChatMetadataAndIdentifier[];
}

/** 打开菜单所需的上下文。 */
export interface IDshModelMenuOptions {
	readonly anchor: HTMLElement;
	readonly delegate: IModelPickerDelegate;
	readonly source: IDshComposerSource;
	readonly onDidHide: () => void;
}

/**
 * DSH 风格的模型菜单。
 *
 * 一个实例只服务一次打开；关闭即释放。菜单挂在 `body` 上，避免被输入框裁切。
 */
export class DshModelMenu extends Disposable {

	private readonly root: HTMLElement;
	private readonly panes: HTMLElement;
	private readonly listeners = this._register(new DisposableStore());
	private pane: Pane = 'root';
	private query = '';
	private visible = false;

	constructor(private readonly options: IDshModelMenuOptions) {
		super();
		// 挂到工作台容器内，而不是 `document.body`：VS Code 的主题变量（`--vscode-*`）
		// 定义在 `.monaco-workbench` 作用域里，挂到 body 上会让 `var(--vscode-menu-background)`
		// 解析为空——菜单就变成没有底色、没有边框的一团文字。
		const host = options.anchor.closest('.monaco-workbench') ?? document.body;
		this.root = append(host as HTMLElement, $('.dsh-model-menu'));
		this.panes = append(this.root, $('.dsh-model-menu-panes'));
		placeAbove(this.root, options.anchor);
		this.listeners.add(addDisposableListener(window, 'mousedown', event => {
			const target = event.target as Node;
			if (this.root.contains(target) || options.anchor.contains(target)) {
				return;
			}
			this.hide();
		}));
		this.listeners.add(addDisposableListener(window, 'keydown', event => {
			if (event.key === 'Escape') {
				event.preventDefault();
				if (this.pane === 'root') {
					this.hide();
				} else {
					this.pane = 'root';
					this.render();
				}
			}
		}));
		// 点击触发按钮本身要能收起菜单。`ModelPickerWidget.show()` 在菜单已开时
		// 会被再次调用，因此按钮侧也会走 toggle 分支（见那边的 `_dshMenu` 判断）。
		this._register(toDisposable(() => {
			this.root.remove();
			this.listeners.clear();
		}));
		this.render();
		this.visible = true;
	}

	get isVisible(): boolean {
		return this.visible;
	}

	/**
	 * 收起菜单。
	 *
	 * 只置标志并清理 DOM，**不调用 `dispose()`**：持有者通过 `MutableDisposable` 管理
	 * 生命周期，自己再 dispose 一次会把同一个对象释放两遍，后续的点击/键盘事件
	 * 就再也进不来（表现为「点开后再点收不回去」）。
	 */
	hide(): void {
		if (!this.visible) {
			return;
		}
		this.visible = false;
		this.root.remove();
		this.listeners.clear();
		this.options.onDidHide();
	}

	private render(): void {
		clearNode(this.panes);
		switch (this.pane) {
			case 'root':
				this.renderRoot();
				break;
			case 'model':
				this.renderModels();
				break;
			case 'effort':
				this.renderEfforts();
				break;
		}
	}

	/** 当前选中项在 DSH 目录里的对应项。 */
	private selection(): { provider: string; model: string; effort?: string } | null {
		const current = this.options.source.state.current;
		if (current !== null) {
			return current;
		}
		const selected = this.options.delegate.currentModel.get();
		if (selected === undefined) {
			return null;
		}
		const slash = selected.identifier.indexOf('/');
		if (slash < 0) {
			return null;
		}
		return { provider: selected.identifier.slice(0, slash), model: selected.identifier.slice(slash + 1) };
	}

	private currentModel(): ILanguageModelChatMetadataAndIdentifier | undefined {
		const selection = this.selection();
		if (selection === null) {
			return undefined;
		}
		return this.options.delegate.getModels().find(model => model.identifier === `${selection.provider}/${selection.model}`);
	}

	private effortLabel(): string {
		const selection = this.selection();
		const model = this.currentModel();
		if (selection?.effort === undefined) {
			return localize('dsh.menu.effortDefault', "默认");
		}
		const effort = model?.metadata.configurationSchema?.properties?.['reasoningEffort'];
		const index = Array.isArray(effort?.enum) ? effort.enum.indexOf(selection.effort) : -1;
		const labels = effort?.enumItemLabels;
		return (index >= 0 && Array.isArray(labels) ? labels[index] : undefined) ?? selection.effort;
	}

	private renderRoot(): void {
		const model = this.currentModel();
		this.cell(localize('dsh.menu.model', "模型"), model?.metadata.name ?? localize('dsh.menu.modelEmpty', "暂无模型"), () => {
			this.pane = 'model';
			this.render();
		});
		this.cell(localize('dsh.menu.effort', "推理等级"), this.effortLabel(), () => {
			this.pane = 'effort';
			this.render();
		});
		// 团队开关：DSH 把它放在同一个菜单的末尾。
		const team = this.options.source.state.team;
		if (team !== null) {
			const row = append(this.panes, $('.dsh-model-menu-row'));
			append(row, $('span.dsh-model-menu-row-label', undefined, localize('dsh.menu.team', "启用智能体团队协作")));
			const toggle = append(row, $('button.dsh-model-menu-switch', {
				type: 'button',
				role: 'switch',
				'aria-checked': String(team.enabled),
				'aria-label': localize('dsh.menu.team', "启用智能体团队协作"),
			})) as HTMLButtonElement;
			this.listeners.add(addDisposableListener(toggle, 'click', event => {
				event.preventDefault();
				void this.options.source.setTeam(!team.enabled);
			}));
		}
	}

	private groups(): ProviderGroup[] {
		const groups = new Map<string, ProviderGroup>();
		for (const model of this.options.delegate.getModels()) {
			const id = model.metadata.modelGroup?.id ?? model.metadata.vendor;
			const label = id;
			const existing = groups.get(id);
			if (existing === undefined) {
				groups.set(id, { id, label, models: [model] });
			} else {
				(groups.get(id)!.models as ILanguageModelChatMetadataAndIdentifier[]).push(model);
			}
		}
		return [...groups.values()];
	}

	private renderModels(): void {
		const groups = this.groups();
		const all = groups.flatMap(group => group.models);
		if (all.length > 4) {
			const search = append(this.panes, $('input.dsh-model-menu-search', {
				type: 'search',
				placeholder: localize('dsh.menu.search', "搜索模型…"),
				'aria-label': localize('dsh.menu.search', "搜索模型…"),
			})) as HTMLInputElement;
			search.value = this.query;
			this.listeners.add(addDisposableListener(search, 'input', () => {
				this.query = search.value;
				this.render();
				const next = this.panes.querySelector<HTMLInputElement>('.dsh-model-menu-search');
				next?.focus();
				next?.setSelectionRange(next.value.length, next.value.length);
			}));
			queueMicrotask(() => search.focus());
		}
		const needle = this.query.trim().toLowerCase();
		const selection = this.selection();
		let matched = 0;
		for (const group of groups) {
			const models = group.models.filter(model => matches(model.metadata.name, needle));
			if (models.length === 0) {
				continue;
			}
			matched += models.length;
			append(this.panes, $('.dsh-model-menu-group', undefined, group.label));
			for (const model of models) {
				const selected = selection !== null && model.identifier === `${selection.provider}/${selection.model}`;
				this.item(model.metadata.name, selected, () => {
					const slash = model.identifier.indexOf('/');
					if (slash > 0) {
						void this.options.source.selectModel(model.identifier.slice(0, slash), model.identifier.slice(slash + 1));
					}
					this.hide();
				});
			}
		}
		if (matched === 0) {
			append(this.panes, $('.dsh-model-menu-note', undefined, localize('dsh.menu.noMatch', "没有匹配的模型")));
		}
	}

	private renderEfforts(): void {
		const model = this.currentModel();
		const efforts = model?.metadata.configurationSchema?.properties?.['reasoningEffort'];
		const values = Array.isArray(efforts?.enum) ? efforts.enum as string[] : [];
		const labels = efforts?.enumItemLabels;
		if (values.length === 0) {
			append(this.panes, $('.dsh-model-menu-note', undefined, localize('dsh.menu.noEffort', "这个模型没有推理等级")));
			return;
		}
		const selected = this.selection()?.effort;
		for (let index = 0; index < values.length; index++) {
			const value = values[index];
			const label = (Array.isArray(labels) ? labels[index] : undefined) ?? value;
			this.item(label, selected === value, () => {
				void this.options.source.selectEffort(value);
				this.hide();
			});
		}
	}

	/** 一行「标签 + 当前值 + chevron」。 */
	private cell(label: string, value: string, run: () => void): void {
		const row = append(this.panes, $('button.dsh-model-menu-cell', { type: 'button' })) as HTMLButtonElement;
		append(row, $('span.dsh-model-menu-cell-label', undefined, label));
		append(row, $('span.dsh-model-menu-cell-value', undefined, value));
		append(row, $('span.codicon.codicon-chevron-right.dsh-model-menu-cell-chevron'));
		this.listeners.add(addDisposableListener(row, 'click', event => {
			event.preventDefault();
			run();
		}));
	}

	/** 普通可选行。 */
	private item(label: string, selected: boolean, run: () => void): void {
		const row = append(this.panes, $('button.dsh-model-menu-item', { type: 'button', 'aria-checked': String(selected), role: 'menuitemradio' })) as HTMLButtonElement;
		row.classList.toggle('selected', selected);
		append(row, $('span.dsh-model-menu-item-label', undefined, label));
		if (selected) {
			append(row, $('span.codicon.codicon-check.dsh-model-menu-item-check'));
		}
		this.listeners.add(addDisposableListener(row, 'click', event => {
			event.preventDefault();
			run();
		}));
	}
}

/** 把菜单放到锚点上方，越界时夹回视口。 */
function placeAbove(menu: HTMLElement, anchor: HTMLElement): void {
	const rect = anchor.getBoundingClientRect();
	const width = Math.min(420, Math.max(240, rect.width));
	menu.style.position = 'fixed';
	menu.style.width = `${width}px`;
	menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
	menu.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 6)}px`;
	menu.style.maxHeight = `${Math.min(360, rect.top - 16)}px`;
}

/** 与 DSH 一致：按字符顺序匹配，不要求连续。 */
function matches(name: string, query: string): boolean {
	if (query === '') {
		return true;
	}
	const folded = name.toLowerCase();
	let index = 0;
	for (const char of folded) {
		if (char === query[index]) {
			index++;
		}
		if (index === query.length) {
			return true;
		}
	}
	return false;
}
