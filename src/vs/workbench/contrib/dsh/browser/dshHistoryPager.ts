/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import type { DshChatSession } from './dshChatSession.js';

/**
 * 顶部滚动触发 loadOlder，并用节点锚点把视口留在原消息上。
 *
 * 加载提示是普通 DOM，不是 dshNode part，因此不进双射。
 * 没有现成的 pauseFollowTail：前插后只按锚点改正 scrollTop。
 */
export function attachDshHistoryPager(root: HTMLElement, session: DshChatSession, stores: DisposableStore): void {
	const bar = dom.append(root, dom.$('.dsh-history-pager'));
	const label = dom.append(bar, dom.$('button.dsh-history-pager-label')) as HTMLButtonElement;
	label.type = 'button';
	bar.hidden = true;

	const render = (): void => {
		const status = session.historyStatus();
		if (status === 'loading') {
			bar.hidden = false;
			label.disabled = true;
			label.textContent = '正在加载更早记录…';
		} else if (status === 'error') {
			bar.hidden = false;
			label.disabled = false;
			label.textContent = '加载失败，点击重试';
		} else if (!session.hasMore() && session.firstSeq() !== undefined) {
			bar.hidden = false;
			label.disabled = true;
			label.textContent = '已到会话开始';
		} else {
			bar.hidden = true;
		}
	};

	let busy = false;
	const load = async (): Promise<void> => {
		if (busy || session.historyStatus() === 'loading' || !session.hasMore()) {
			return;
		}
		const scroller = scrollParent(root);
		const anchor = firstVisibleAnchor(scroller);
		const before = anchor?.getBoundingClientRect().top;
		const id = anchor?.getAttribute('data-dsh-node-id') ?? undefined;
		busy = true;
		root.setAttribute('data-dsh-history-loading', '');
		try {
			await session.loadOlder();
		} finally {
			busy = false;
			root.removeAttribute('data-dsh-history-loading');
			render();
			if (id !== undefined && before !== undefined) {
				requestAnimationFrame(() => {
					const next = scroller.querySelector(`[data-dsh-node-id="${id.replaceAll('"', '')}"]`);
					if (next instanceof HTMLElement) {
						scroller.scrollTop += next.getBoundingClientRect().top - before;
					}
				});
			}
		}
	};

	const onScroll = (): void => {
		if (scrollParent(root).scrollTop <= 24) {
			void load();
		}
	};
	const onClick = (): void => {
		void load();
	};
	label.addEventListener('click', onClick);
	root.addEventListener('scroll', onScroll, true);
	stores.add(session.onDidChangeHistory(render));
	stores.add({
		dispose: () => {
			label.removeEventListener('click', onClick);
			root.removeEventListener('scroll', onScroll, true);
			bar.remove();
		},
	});
	render();
}

function scrollParent(root: HTMLElement): HTMLElement {
	const anchor = root.querySelector('[data-dsh-paging-anchor]');
	let node: HTMLElement | null = anchor instanceof HTMLElement ? anchor.parentElement : null;
	while (node !== null && node !== root.parentElement) {
		if (node.scrollHeight > node.clientHeight + 1) {
			return node;
		}
		if (node === root) {
			break;
		}
		node = node.parentElement;
	}
	return root;
}

function firstVisibleAnchor(scroller: HTMLElement): HTMLElement | undefined {
	const box = scroller.getBoundingClientRect();
	for (const node of scroller.querySelectorAll('[data-dsh-paging-anchor]')) {
		if (!(node instanceof HTMLElement)) {
			continue;
		}
		const rect = node.getBoundingClientRect();
		if (rect.bottom >= box.top && rect.top <= box.bottom) {
			return node;
		}
	}
	return undefined;
}
