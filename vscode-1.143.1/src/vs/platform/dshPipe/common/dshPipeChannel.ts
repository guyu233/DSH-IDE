/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH 私有管道 IPC 服务端频道（主进程注册为 'dshPipe'，渲染器 DshChatClient 消费）。
//
// 数据流：
//   渲染器 (DshChatClient)  --IPC-->  DshPipeChannel(main)  --pipe-->  DSH Host
//   渲染器 通道 A 一元/流调用；通道 B（Host 发起的 ide_* 执行）反向：
//   Host --pipe--> DshPipeClient.setExecHandler --> 本频道 b-exec 事件 --> 渲染器 ideExec 执行
//   渲染器 --> 本频道 b-reply --> DshPipeClient 回填 Host。
//
// 本文件只依赖 base/common，主进程与渲染器共用（避免层级耦合）。实际 DshPipeClient 由主进程
// 引导创建并注入（见 dshPipeBootstrap.ts）。

import { Emitter, Event } from '../../base/common/event.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { generateUuid } from '../../base/common/uuid.js';
import { IServerChannel } from '../../base/parts/ipc/common/ipc.js';

/** 通道 A 流帧（渲染器订阅）。 */
export interface IDshPipeFrameMsg {
	readonly streamId: string;
	readonly frame: { id: string; event: 'snapshot' | 'data' | 'end' | 'error'; payload?: unknown };
}

/** Host 发起的通道 B 执行请求（转发给渲染器 ideExec）。 */
export interface IDshExecRequestMsg {
	readonly id: string;
	readonly op: string;
	readonly args: unknown;
}

/** 本频道对底层管道客户端的最小依赖（DshPipeClient 结构化满足）。 */
export interface IDshPipeClientLike {
	readonly isConnected: boolean;
	setExecHandler(handler: (op: string, args: unknown) => Promise<{ ok: boolean; result?: unknown; error?: string; auditToken?: string }>): void;
	callA<T = unknown>(method: string, payload?: unknown, onEvent?: (frame: { id: string; event: 'snapshot' | 'data' | 'end' | 'error'; payload?: unknown }) => void): Promise<T>;
	execB<T = unknown>(op: string, args: unknown): Promise<{ ok: boolean; result?: T; error?: string; auditToken?: string }>;
}

interface PendingExec { resolve: (v: { ok: boolean; result?: unknown; error?: string; auditToken?: string }) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; }

const EXEC_TIMEOUT_MS = 60000;

export class DshPipeChannel extends Disposable implements IServerChannel<string> {
	private readonly _onAEvent = this._register(new Emitter<IDshPipeFrameMsg>());
	private readonly _onExecRequest = this._register(new Emitter<IDshExecRequestMsg>());
	private readonly pendingExec = new Map<string, PendingExec>();
	private readonly streams = new Map<string, AbortController>();

	constructor(private readonly client: IDshPipeClientLike, private readonly chatappDir: string) {
		super();
		// Host 发起的通道 B：转给渲染器执行，等待 b-reply 回填。
		this.client.setExecHandler((op, args) => this.requestRendererExec(op, args));
	}

	listen(_ctx: string, event: string): Event<unknown> {
		switch (event) {
			case 'a-event': return this._onAEvent.event as Event<unknown>;
			case 'b-exec': return this._onExecRequest.event as Event<unknown>;
			default: throw new Error(`Invalid listen: ${event}`);
		}
	}

	async call(_ctx: string, command: string, args?: any): Promise<any> {
		switch (command) {
			case 'status': return { connected: this.client.isConnected, chatappDir: this.chatappDir };
			case 'callA': return this.client.callA(args.method, args.payload);
			case 'follow': return this.doFollow(args.streamId, args.method, args.payload);
			case 'cancel': { const ac = this.streams.get(args.streamId); if (ac) { ac.abort(); this.streams.delete(args.streamId); } return; }
			case 'execB': return this.client.execB(args.op, args.args);
			case 'b-reply': {
				const p = this.pendingExec.get(args.id);
				if (p) { this.pendingExec.delete(args.id); clearTimeout(p.timer); p.resolve({ ok: args.ok === true, result: args.result, error: args.error, auditToken: args.auditToken }); }
				return;
			}
			default: throw new Error(`Invalid call: ${command}`);
		}
	}

	private async doFollow(streamId: string, method: string, payload: unknown): Promise<void> {
		const ac = new AbortController();
		this.streams.set(streamId, ac);
		try {
			await this.client.callA(method, payload, (frame) => { this._onAEvent.fire({ streamId, frame }); });
		} finally {
			this.streams.delete(streamId);
		}
	}

	private requestRendererExec(op: string, args: unknown): Promise<{ ok: boolean; result?: unknown; error?: string; auditToken?: string }> {
		return new Promise((resolve, reject) => {
			const id = generateUuid();
			const timer = setTimeout(() => { this.pendingExec.delete(id); reject(new Error(`ideExec timeout for op=${op}`)); }, EXEC_TIMEOUT_MS);
			this.pendingExec.set(id, { resolve, reject, timer });
			this._onExecRequest.fire({ id, op, args });
		});
	}

	override dispose(): void {
		for (const p of this.pendingExec.values()) { clearTimeout(p.timer); p.reject(new Error('dsh-pipe channel disposed')); }
		this.pendingExec.clear();
		for (const ac of this.streams.values()) { ac.abort(); }
		this.streams.clear();
		super.dispose();
	}
}
