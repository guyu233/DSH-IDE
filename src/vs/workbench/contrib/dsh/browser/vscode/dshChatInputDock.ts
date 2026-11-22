/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


// 输入区两个 dock 槽的 DOM 宿主。
//
// 官方把这两个槽放在输入卡的上方（`conversation.input.dock`）与下方
// （`conversation.composer.dock`）。本仓的输入区是原生 `ChatInputPart`，
// 因此宿主只做三件事：
//   1. 在 `ChatInputPart` 的容器里插入两个 `role="group"` 的宿主元素（没有 occupant 时隐藏）；
//   2. occupant 变更时重画（`DshSlotRegistry.onDidChange` 的第一个生产消费点）；
//   3. 点击行时执行 occupant 给的宿主命令，不在本地伪造任何 DSH 事实。
//
// 视觉沿用原生 chat 的次要行：只使用主题令牌，不写死颜色，不引入第二套按钮样式。

import { $ } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { dshChatSlotRegistry } from './dshChatSlots.js';
import { dshComposerDockRows, dshInputDockRows, dshQueueDockRows, type DshInputDockRow, type DshInputZoneOwner } from './dshInputDock.js';
import type { DshIdeInboxMessage } from '../../../../../platform/dshClient/protocol/dshIdeProtocol.js';

/** 宿主需要的宿主能力：只执行命令，不读也不写会话事实。 */
export interface DshInputDockHost {
	executeCommand(command: string, args: readonly unknown[]): void;
}

/** 两个 dock 在输入区里的位置。 */
export type DshInputDockSide = 'input' | 'composer';

/**
 * 一个 dock 的 DOM 宿主。
 *
 * 由 `ChatInputPart` 在当前会话变化时调用 `update()`；occupant 注册/释放时
 * 由注册表的 `onDidChange` 驱动同一个入口，因此插件热插拔不会留下旧行。
 */
export class DshChatInputDock extends Disposable {
	readonly domNode: HTMLElement;
	private owner: DshInputZoneOwner | undefined;
	private readonly rowRefs = new Set<{ dispose(): void }>();

	constructor(
		private readonly side: DshInputDockSide,
		private readonly host: DshInputDockHost,
	) {
		super();
		this.domNode = $('.dsh-input-dock');
		this.domNode.style.display = 'none';
		this.domNode.style.flexDirection = 'column';
		this.domNode.style.gap = '2px';
		this.domNode.style.padding = '2px 0';
		this.domNode.setAttribute('role', 'group');
		this.domNode.setAttribute('aria-label', side === 'input'
			? localize('dsh.inputDock.label', "Composer extensions")
			: localize('dsh.composerDock.label', "Composer notes"));
		this._register(dshChatSlotRegistry.onDidChange(() => this.render()));
	}

	/**
	 * 指向当前会话与输入区状态。
	 *
	 * `owner` 只对 `conversation.input.dock` 有意义（官方 owner 是 `InputZone`）；
	 * `composer.dock` 只用会话 id。两者都允许缺省，表示「当前没有会话」。
	 */
	update(sessionId: string | undefined, owner?: DshInputZoneOwner, inbox?: readonly DshIdeInboxMessage[]): void {
		this.sessionId = sessionId;
		this.owner = owner;
		this.inbox = inbox;
		this.render();
	}

	private sessionId: string | undefined;
	private inbox: readonly DshIdeInboxMessage[] | undefined;

	private render(): void {
		for (const ref of this.rowRefs) {
			ref.dispose();
		}
		this.rowRefs.clear();
		this.domNode.replaceChildren();
		// `conversation.input.dock` 除了插件 occupant，还内置一条「排队队列」行：
		// 官方把 `QueueDock` 注册成该槽的 `id: 'queue'` / `order: 20` occupant，
		// 这里用同一套 list 语义把它并进去（同 order 时按 id 稳定排序）。
		const rows = this.side === 'input'
			? mergeDockRows(dshInputDockRows(this.sessionId, this.owner), dshQueueDockRows(this.inbox))
			: dshComposerDockRows(this.sessionId);
		if (rows.length === 0) {
			this.domNode.style.display = 'none';
			return;
		}
		this.domNode.style.display = 'flex';
		for (const row of rows) {
			this.domNode.appendChild(this.renderRow(row));
		}
	}

	private renderRow(row: DshInputDockRow): HTMLElement {
		const line: HTMLDivElement | HTMLButtonElement = document.createElement(row.command === undefined ? 'div' : 'button');
		line.className = 'dsh-input-dock-row';
		line.style.display = 'flex';
		line.style.alignItems = 'baseline';
		line.style.gap = '6px';
		line.style.font = 'inherit';
		line.style.color = 'var(--vscode-descriptionForeground)';
		line.style.textAlign = 'left';
		line.style.padding = '0';
		line.style.border = 'none';
		line.style.background = 'transparent';
		line.textContent = row.label;
		if (row.description !== undefined) {
			const detail = $('span.dsh-input-dock-description');
			detail.textContent = row.description;
			detail.style.color = 'var(--vscode-descriptionForeground)';
			detail.style.fontSize = '0.9em';
			line.appendChild(detail);
		}
		if (row.command !== undefined) {
			(line as HTMLButtonElement).type = 'button';
			line.style.cursor = 'pointer';
			line.title = row.description ?? row.label;
			// 纯展示行不可聚焦；有命令才表现为按钮（与原生 chat 次按钮一致）。
			const click = () => this.host.executeCommand(row.command!, row.arguments ?? []);
			line.addEventListener('click', click);
			this.rowRefs.add({ dispose: () => line.removeEventListener('click', click) });
		}
		return line;
	}
}

/**
 * 合并两组 dock 行：按官方 list 语义排序（`order` 升序，同 order 用 id 稳定），
 * 同 id 只留一行（内置队列行先出现，插件再注册同名 id 时不重复画）。
 */
function mergeDockRows(left: readonly DshInputDockRow[], right: readonly DshInputDockRow[]): readonly DshInputDockRow[] {
	const byId = new Map<string, DshInputDockRow>();
	for (const row of [...left, ...right]) {
		if (!byId.has(row.id)) {
			byId.set(row.id, row);
		}
	}
	return [...byId.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
