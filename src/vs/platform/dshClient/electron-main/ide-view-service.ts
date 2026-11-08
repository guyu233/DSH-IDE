/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P3：`IdeViewHost` 的真实实现（`DshIdeViewService`）。
//
// 职责边界（第 1 章 §3）：本类只做「窄接口 + 投影 + 版本计数」，不认识 DSH 内部模型，
// 也不直连 electron 或插件宿主的服务容器；DSH 能力经 `DshIdeBackend` 端口注入。端口由插件
// Host 层（插件入口 apply 拿到的上下文）实现，因此本文件不出现 `@deepseek-ai/*`、`ctx.on`
// 或 electron API。
//
// 快照纪律（第 2 章 §2）：`channelId` 一次打开内守恒；`version` 从 1 起严格 +1；
// 首帧 `starting`，收到第一条真实事件后转为 `ready` 并携带 `IdeViewSnapshot`。

import { Disposable } from '../../../base/common/lifecycle.js';
import { createIdeViewProjector, type IdeViewProjector } from '../common/ide-view-projector.js';
import { translateDshEvent } from '../common/translator.js';
import {
	DSH_IDE_FEATURE_UNAVAILABLE,
	DSH_IDE_WIRE_REVISION,
	type DshIdeBackend,
	type DshIdeMethod,
	type DshIdeOpenSpec,
	type DshIdeSnapshot,
	type IdeViewHost,
} from '../common/dshIdeProtocol.js';

// 端口类型与 `open` 规格定义在 common/dshIdeProtocol.ts（单一真源）：
// transport/ 与 electron-main/ 都只依赖它，避免反向依赖。
export type { DshIdeBackend, DshIdeOpenSpec } from '../common/dshIdeProtocol.js';

/** 端口未接线时的实现：一律以 `dsh-ide/feature-unavailable` 拒绝，绝不伪造事件或快照。 */
export class UnavailableDshIdeBackend implements DshIdeBackend {
	open(): never {
		throw { code: DSH_IDE_FEATURE_UNAVAILABLE, message: 'DSH-IDE host bridge is not wired' };
	}
	follow(): never {
		throw { code: DSH_IDE_FEATURE_UNAVAILABLE, message: 'DSH-IDE host bridge is not wired' };
	}
	invoke(): Promise<never> {
		return Promise.reject({ code: DSH_IDE_FEATURE_UNAVAILABLE, message: 'DSH-IDE host bridge is not wired' });
	}
	close(): void { /* no-op */ }
}

export class DshIdeViewService extends Disposable implements IdeViewHost {
	private readonly _listeners = new Set<(snapshot: DshIdeSnapshot) => void>();
	private projector: IdeViewProjector | undefined;
	private subscription: { dispose(): void } | undefined;
	private channelId: string | undefined;
	private sessionId: string | undefined;
	/** 已发布帧数：首帧 `starting` 为 1，此后每帧 +1。 */
	private version = 0;
	private last: DshIdeSnapshot | undefined;
	/** 待发布事件缓冲：合并同一宏任务内的连续增量，避免逐 token 推帧。 */
	private pending: unknown[] = [];
	private flushScheduled = false;

	private readonly backend: DshIdeBackend;

	constructor(backend: DshIdeBackend = new UnavailableDshIdeBackend()) {
		super();
		this.backend = backend;
	}

	open(spec: Record<string, unknown>): DshIdeSnapshot {
		if (this.channelId !== undefined) {
			// 重复触发复用既有连接与 channelId，不创建第二个实例（第 4 章 §1）。
			return this.last!;
		}
		const binding = this.backend.open(spec as unknown as DshIdeOpenSpec);
		this.channelId = binding.channelId;
		this.sessionId = binding.sessionId;
		this.projector = createIdeViewProjector();
		this.subscription = this.backend.follow(binding.sessionId, raw => this.receive(raw));
		const first: DshIdeSnapshot = {
			wireRevision: DSH_IDE_WIRE_REVISION,
			channelId: binding.channelId,
			version: 1,
			state: { state: 'starting' },
		};
		this.version = 1;
		this.last = first;
		return first;
	}

	subscribe(onSnapshot: (snapshot: DshIdeSnapshot) => void): { dispose(): void } {
		this._listeners.add(onSnapshot);
		return { dispose: () => { this._listeners.delete(onSnapshot); } };
	}

	async invoke(method: string, args?: unknown): Promise<unknown> {
		if (this.channelId === undefined) {
			throw { code: DSH_IDE_FEATURE_UNAVAILABLE, message: 'DSH-IDE view is not open' };
		}
		const value = await this.backend.invoke(method as DshIdeMethod, args);
		if (method === 'refreshSnapshot') {
			// 全量重发：version 仍严格 +1，不重置计数。
			this.publish(true);
		}
		return value;
	}

	close(): { closed: true } {
		this.subscription?.dispose();
		this.subscription = undefined;
		this.backend.close();
		this.projector = undefined;
		this.channelId = undefined;
		this.sessionId = undefined;
		this.last = undefined;
		this.pending = [];
		this.version = 0;
		return { closed: true };
	}

	private receive(raw: unknown): void {
		this.pending.push(raw);
		if (this.flushScheduled) {
			return;
		}
		this.flushScheduled = true;
		queueMicrotask(() => {
			this.flushScheduled = false;
			const batch = this.pending;
			this.pending = [];
			if (this.projector === undefined) {
				return;
			}
			let applied = 0;
			batch.forEach((event, index) => {
				const translated = translateDshEvent(event, index);
				if (translated === undefined) {
					return;
				}
				this.projector!.apply(translated);
				applied += 1;
			});
			if (applied > 0) {
				this.publish(false);
			}
		});
	}

	private publish(forceFull: boolean): void {
		if (this.channelId === undefined || this.projector === undefined) {
			return;
		}
		const view = this.projector.snapshot();
		if (!forceFull && this.last !== undefined && this.last.state.state === 'ready' && this.last.state.view !== undefined && this.last.state.view.version === view.version) {
			// 没有新投影版本时不制造空帧，保证消费者看到的 version 严格 +1。
			return;
		}
		this.version += 1;
		const next: DshIdeSnapshot = {
			wireRevision: DSH_IDE_WIRE_REVISION,
			channelId: this.channelId,
			version: this.version,
			state: { state: 'ready', view },
		};
		this.last = next;
		for (const listener of [...this._listeners]) {
			listener(next);
		}
	}

	/** 当前绑定会话（Host 侧归属校验用；未打开时为 undefined）。 */
	get boundSessionId(): string | undefined {
		return this.sessionId;
	}
}
