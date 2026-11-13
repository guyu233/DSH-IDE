/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// P3：`IdeViewHost` 的真实实现（`DshIdeViewService`）。
//
// 职责边界（第 1 章 §3）：本类只做「窄接口 + 帧转发 + 版本计数」，不认识 DSH 内部模型，
// 也不直连 electron 或插件宿主的服务容器；DSH 能力经 `DshIdeBackend` 端口注入。
//
// 帧纪律（第 2 章 §2）：`channelId` 一次打开内守恒；`version` 从 1 起严格 +1；
// 首帧 `starting`，收到第一帧跟会话结果后转为 `ready` 并携带该帧。
// 本类**不再**把帧翻译成另一套行：帧就是 `sessionController.follow` 给出的形状。

import { Disposable } from '../../../base/common/lifecycle.js';
import { projectDshIdeWaterfallNotice } from '../common/dshIdeWaterfallNotice.js';
import {
	DSH_IDE_FEATURE_UNAVAILABLE,
	DSH_IDE_WIRE_REVISION,
	type DshIdeBackend,
	type DshIdeMethod,
	type DshIdeOpenSpec,
	type DshIdeSnapshot,
	type DshIdeViewSnapshot,
	type DshIdeWaterfallNotice,
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
	private readonly _waterfall = new Set<(notice: DshIdeWaterfallNotice) => void>();
	private subscription: { dispose(): void } | undefined;
	private channelId: string | undefined;
	private sessionId: string | undefined;
	/** 已发布帧数：首帧 `starting` 为 1，此后每帧 +1。 */
	private version = 0;
	private last: DshIdeSnapshot | undefined;
	private _boundSessionId: string | undefined;

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

	/** 换一个会话继续跟：停掉旧流，按新地址重开。同一个会话不会被听两遍。 */
	rebind(sessionId: string): DshIdeSnapshot {
		if (this.channelId === undefined) {
			return this.open({ view: 'chat', params: { sessionId } });
		}
		if (sessionId === this.sessionId) {
			return this.last!;
		}
		this.subscription?.dispose();
		this.subscription = undefined;
		this.sessionId = sessionId;
		this._boundSessionId = sessionId;
		this.subscription = this.backend.follow(sessionId, raw => this.receive(raw));
		this.version += 1;
		const next: DshIdeSnapshot = {
			wireRevision: DSH_IDE_WIRE_REVISION,
			channelId: this.channelId,
			version: this.version,
			state: { state: 'starting' },
		};
		this.last = next;
		for (const listener of [...this._listeners]) {
			listener(next);
		}
		return next;
	}

	subscribe(onSnapshot: (snapshot: DshIdeSnapshot) => void): { dispose(): void } {
		this._listeners.add(onSnapshot);
		return { dispose: () => { this._listeners.delete(onSnapshot); } };
	}

	subscribeWaterfall(onNotice: (notice: DshIdeWaterfallNotice) => void): { dispose(): void } {
		this._waterfall.add(onNotice);
		return { dispose: () => { this._waterfall.delete(onNotice); } };
	}

	async invoke(method: string, args?: unknown): Promise<unknown> {
		if (this.channelId === undefined) {
			throw { code: DSH_IDE_FEATURE_UNAVAILABLE, message: 'DSH-IDE view is not open' };
		}
		const value = await this.backend.invoke(method as DshIdeMethod, args);
		// 新建 / 分叉成功后，画面跟着新会话走。
		const nextSessionId = value !== null && typeof value === 'object' && typeof (value as Record<string, unknown>)['sessionId'] === 'string'
			? (value as Record<string, unknown>)['sessionId'] as string
			: undefined;
		if ((method === 'newSession' || method === 'fork') && nextSessionId !== undefined) {
			this.rebind(nextSessionId);
		}
		return value;
	}

	close(): { closed: true } {
		this.subscription?.dispose();
		this.subscription = undefined;
		this.backend.close();
		this.channelId = undefined;
		this.sessionId = undefined;
		this._boundSessionId = undefined;
		this.last = undefined;
		this.version = 0;
		return { closed: true };
	}

	/** 收一帧跟会话结果：内容帧直接发布，批准 / 问卷帧交给独立订阅者。 */
	private receive(raw: unknown): void {
		if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
			return;
		}
		const notice = projectDshIdeWaterfallNotice(raw);
		if (notice !== undefined) {
			for (const listener of [...this._waterfall]) {
				listener(notice);
			}
			return;
		}
		if ((raw as Record<string, unknown>)['type'] === 'waterfall') {
			// 形状不合的批准 / 问卷帧丢弃，不能混进会话内容流。
			return;
		}
		this.publish({ frame: raw as Record<string, unknown> });
	}

	private publish(view: DshIdeViewSnapshot): void {
		if (this.channelId === undefined) {
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
		return this._boundSessionId ?? this.sessionId;
	}
}
