/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


// 把自动滚动归属状态机接到原生 chat widget（契约 §19.3 S5）。
//
// 原生已提供正确的机制：`IChatWidget.holdAutoScroll()` → `ChatListWidget.acquireAutoScrollHold()`
// 是引用计数的「暂停自动滚动」，`_withPersistedAutoScroll()` 与 `chatWidget` 的 `addRequest`
// 分支都会读 `isAutoScrollHeld`。本贡献点只做三件事：
//   1. 监听 `onDidScroll`，用户离开底部就取一个 hold，回到底部就释放；
//   2. 监听 `onDidAcceptInput`，发送后释放 hold（恢复一次跟随）；
//   3. widget 换绑/销毁时释放，避免 hold 泄漏把后续会话的自动滚动永久关掉。
//
// 不改上游任何文件：这是 DSH 插件对原生 API 的正常消费，原生对「谁持有」无感知。

import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { IChatWidget, IChatWidgetService } from '../../../chat/browser/chat.js';
import {
	DSH_SCROLL_FOLLOW_INITIAL,
	dshScrollDeltaSource,
	dshScrollFollowAfterScroll,
	dshScrollFollowAfterSend,
	dshScrollFollowFromViewState,
	dshScrollFollowShouldHold,
	type DshScrollFollowState,
} from './dshScrollFollow.js';

interface MountedWidget {
	/** 当前持有的原生 hold；没有持有时为 undefined。 */
	hold: IDisposable | undefined;
	state: DshScrollFollowState;
	readonly store: DisposableStore;
	/** 上一次采样到的 scrollTop：用来区分「布局推走」与「用户真的滚了」。 */
	lastScrollTop: number;
}

/**
 * 给每个原生 chat widget 装一个滚动归属跟踪器。
 *
 * 只处理有会话的普通 chat widget：行内 chat 与 quick chat 不是 DSH 会话的落点，
 * 而且它们的输入区/滚动容器语义与面板不同，不在这里接管。
 */
export class DshChatAutoScrollHoldContribution extends Disposable {
	private readonly mounted = new Map<IChatWidget, MountedWidget>();

	constructor(
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
	) {
		super();
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
		if (this.mounted.has(widget)) {
			return;
		}
		const store = new DisposableStore();
		const mounted: MountedWidget = { hold: undefined, state: DSH_SCROLL_FOLLOW_INITIAL, store, lastScrollTop: widget.getViewState().scrollTop ?? 0 };
		this.mounted.set(widget, mounted);
		// 初始归属取原生 view state：已恢复的阅读位置不能被当成「在底部」。
		mounted.state = dshScrollFollowFromViewState(widget.getViewState());
		this.sync(widget, mounted);
		store.add(widget.onDidScroll(() => {
			// 区分「布局增长把视口推走」与「用户真的滚了」：前者不能改归属，
			// 否则流式输出的每一帧都会把用户锁进阅读态（见 `dshScrollDeltaSource` 的注释）。
			const scrollTop = widget.getViewState().scrollTop ?? mounted.lastScrollTop;
			const source = dshScrollDeltaSource(mounted.lastScrollTop, scrollTop);
			mounted.lastScrollTop = scrollTop;
			if (source === 'layout') {
				// 布局引起的滚动只同步 hold（视口离底部的距离可能变了），不改归属。
				this.sync(widget, mounted);
				return;
			}
			mounted.state = dshScrollFollowAfterScroll(mounted.state, this.isAtBottom(widget));
			this.sync(widget, mounted);
		}));
		store.add(widget.onDidAcceptInput(() => {
			mounted.state = dshScrollFollowAfterSend();
			this.sync(widget, mounted);
		}));
		// 换绑会话时重新按新会话的 view state 起算；旧会话的阅读锁不能带到新会话。
		store.add(widget.onDidChangeViewModel(() => {
			mounted.state = dshScrollFollowFromViewState(widget.getViewState());
			this.sync(widget, mounted);
		}));
		store.add(toDisposable(() => {
			mounted.hold?.dispose();
			mounted.hold = undefined;
		}));
	}

	private unmount(widget: IChatWidget): void {
		const mounted = this.mounted.get(widget);
		if (mounted === undefined) {
			return;
		}
		this.mounted.delete(widget);
		mounted.store.dispose();
	}

	/**
	 * 让原生 hold 与当前归属一致。重复调用安全：只在跨越边界时取/放。
	 *
	 * **故意不在释放时调用 `restoreViewState`**：`isAtBottom` 的滚动事件已经由原生发出，
	 * `scrollToEnd()` 也是原生「回到底部」按钮自己做的；插件再滚一次会与用户的滚动抢位置，
	 * 也会在「发送后恢复跟随」时把还想看旧位置的用户强行拉走。这里只负责 hold 的取/放。
	 */
	private sync(widget: IChatWidget, mounted: MountedWidget): void {
		const shouldHold = dshScrollFollowShouldHold(mounted.state);
		if (shouldHold && mounted.hold === undefined) {
			mounted.hold = widget.holdAutoScroll();
			return;
		}
		if (!shouldHold && mounted.hold !== undefined) {
			mounted.hold.dispose();
			mounted.hold = undefined;
		}
	}

	private isAtBottom(widget: IChatWidget): boolean {
		return widget.getViewState().isAtBottom === true;
	}
}

