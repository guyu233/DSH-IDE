/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// VS Code 主进程管道客户端：连接 Host 私有命名管道，握 nonce，收发通道 A/B 帧。
//
// 拓扑：Host 是服务端（net.createServer），本类运行于 Electron 主进程（Node 侧）= 客户端，
// 主动 net.connect(pipePath)。渲染器经 IPC 把请求交到这里执行（见 electron-main 接线）。
//
//   chan 'A'  callA(method,payload,onEvent?)：DSH 服务调用。unary 方法在收到
//             {event:'data',payload:{ok,result}} 时结算；流方法（如 session.follow）对每个
//             data 帧回调 onEvent，end/error 时结束 Promise。
//   chan 'B'  Host→VS Code：帧带 .op，路由到 setExecHandler(handler) 执行 ideExec，并用同一
//             id 回填 {ok,result?|error?,auditToken?}。execB 仅保留做对称/测试用（Host 主动发起 B）。
//
// 无 shell、无 http、无 cookie。仅本地命名管道。

import * as net from 'node:net';
import { encodeFrame, PipeFrameParser, PIPE_PROTOCOL_VERSION, type PipeIncoming, type PipeExecRequest, type PipeExecResponse } from '../common/dshPipeProtocol.js';

export interface DshPipeOptions {
	readonly pipePath: string;
	readonly nonce: string;
	readonly connectTimeoutMs?: number;
}

/** 通道 A 的帧回调（流方法用）。 */
export type ChannelAHandler = (frame: { id: string; event: 'snapshot' | 'data' | 'end' | 'error'; payload?: unknown }) => void;

/** 通道 B 执行处理器：接收 Host 发来的 (op,args)，返回执行结果（由 ideExec 提供）。 */
export type ExecBHandler = (op: string, args: unknown) => Promise<{ ok: boolean; result?: unknown; error?: string; auditToken?: string }>;

/** 通道 A 结算载荷形状（Host services 返回 {ok,result?|error?}）。 */
interface ChannelAResult<T> { ok?: boolean; result?: T; error?: string }

const DEFAULT_A_TIMEOUT_MS = 30000;

/**
 * 主进程管道客户端。一次连接对应一个 IDE 实例与一个 Host。
 */
export class DshPipeClient {
	private socket?: net.Socket;
	private readonly parser = new PipeFrameParser();
	/** 通道 A 的未决请求（unary + 流）。 */
	private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout> }>();
	/** 通道 A 的流式回调（仅流方法注册）。 */
	private readonly listeners = new Map<string, ChannelAHandler>();
	private authed = false;
	private seq = 0;
	private execHandler: ExecBHandler | undefined;
	private disposed = false;

	constructor(private readonly options: DshPipeOptions) { }

	/** 是否已握手成功。 */
	get isConnected(): boolean { return this.authed && !!this.socket && !this.socket.destroyed; }

	/** 注册通道 B 执行处理器（ideExec）。Host 主动发起 B，本端执行后回填。 */
	setExecHandler(handler: ExecBHandler): void {
		this.execHandler = handler;
	}

	/** 连接并握 nonce（一次性）。 */
	connect(): Promise<void> {
		if (this.disposed) { return Promise.reject(new Error('dsh-pipe: client disposed')); }
		if (this.socket && !this.socket.destroyed) { return Promise.resolve(); }
		return new Promise<void>((resolve, reject) => {
			const socket = net.connect(this.options.pipePath);
			this.socket = socket;
			let settled = false;
			const timer = setTimeout(() => {
				if (settled) { return; }
				settled = true;
				socket.destroy();
				reject(new Error('dsh-pipe: connect timeout'));
			}, this.options.connectTimeoutMs ?? 15000);

			socket.on('data', (chunk: Buffer) => {
				let frames: PipeIncoming[];
				try { frames = this.parser.push(chunk); } catch { socket.destroy(); return; }
				for (const frame of frames) { this.onFrame(frame); }
			});
			socket.on('error', (e: Error) => {
				if (!settled) { settled = true; clearTimeout(timer); reject(e); return; }
				this.failAll(e);
			});
			socket.on('close', () => {
				this.authed = false;
				if (!settled) { settled = true; clearTimeout(timer); reject(new Error('dsh-pipe: socket closed before handshake')); return; }
				this.failAll(new Error('dsh-pipe: connection closed'));
			});
			socket.on('connect', () => {
				this.pending.set('hs', {
					resolve: () => { settled = true; clearTimeout(timer); this.authed = true; resolve(); },
					reject: (e: Error) => { settled = true; clearTimeout(timer); reject(e); },
				});
				this.write({ v: PIPE_PROTOCOL_VERSION, chan: 'handshake', id: 'hs', nonce: this.options.nonce });
			});
		});
	}

	private nextId(prefix: string): string {
		this.seq += 1;
		return `${prefix}-${Date.now().toString(36)}-${this.seq}`;
	}

	private write(frame: Parameters<typeof encodeFrame>[0]): void {
		if (!this.socket || this.socket.destroyed) { throw new Error('dsh-pipe: not connected'); }
		this.socket.write(encodeFrame(frame));
	}

	/** 断线/错误时让所有未决调用失败（避免悬挂）。 */
	private failAll(error: Error): void {
		for (const [, p] of this.pending) {
			if (p.timer) { clearTimeout(p.timer); }
			p.reject(error);
		}
		this.pending.clear();
		this.listeners.clear();
	}

	private onFrame(frame: PipeIncoming): void {
		if (!frame || typeof frame !== 'object') { return; }
		const chan = (frame as { chan?: string }).chan;
		if (chan === 'handshake') {
			const p = this.pending.get('hs');
			if (!p) { return; }
			this.pending.delete('hs');
			const ok = (frame as { ok?: boolean }).ok === true;
			if (ok) { p.resolve(undefined); } else { p.reject(new Error('dsh-pipe: handshake rejected (bad nonce)')); }
			return;
		}
		if (chan === 'A') {
			this.onChannelAFrame(frame as { id: string; event: 'snapshot' | 'data' | 'end' | 'error'; payload?: unknown });
			return;
		}
		if (chan === 'B') {
			// Host 发起 ide_* 执行请求（帧带 .op）。
			void this.onExecRequest(frame as PipeExecRequest);
			return;
		}
	}

	private onChannelAFrame(frame: { id: string; event: 'snapshot' | 'data' | 'end' | 'error'; payload?: unknown }): void {
		const listener = this.listeners.get(frame.id);
		if (listener) { try { listener(frame); } catch { /* 回调异常不破坏通道 */ } }

		const p = this.pending.get(frame.id);
		if (!p) { return; }

		if (frame.event === 'data') {
			// unary：首帧 data 载荷形如 {ok,result?|error?}。流方法已注册 listener，
			// 其 data 帧是逐条条目，不在此结算。
			const payload = frame.payload as ChannelAResult<unknown> | undefined;
			if (!this.listeners.has(frame.id) && payload && typeof payload === 'object' && 'ok' in payload) {
				this.pending.delete(frame.id);
				if (p.timer) { clearTimeout(p.timer); }
				if (payload.ok === false) { p.reject(new Error(payload.error || 'dsh-pipe: A failed')); }
				else { p.resolve(payload.result); }
			}
			return;
		}
		if (frame.event === 'end') {
			this.pending.delete(frame.id);
			this.listeners.delete(frame.id);
			if (p.timer) { clearTimeout(p.timer); }
			p.resolve(undefined);
			return;
		}
		if (frame.event === 'error') {
			this.pending.delete(frame.id);
			this.listeners.delete(frame.id);
			if (p.timer) { clearTimeout(p.timer); }
			const payload = frame.payload as { error?: string } | undefined;
			p.reject(new Error(payload?.error || 'dsh-pipe: A error'));
			return;
		}
		if (frame.event === 'snapshot') {
			// 部分流方法可能以 snapshot 帧开头；仅转发给 listener，不结算。
			return;
		}
	}

	/** 处理 Host 发起的通道 B 执行请求（ide_*），用同一 id 回填响应。 */
	private async onExecRequest(frame: PipeExecRequest): Promise<void> {
		const id = frame.id;
		const op = frame.op;
		const args = frame.args;
		let response: PipeExecResponse;
		if (!this.execHandler) {
			response = { v: PIPE_PROTOCOL_VERSION, chan: 'B', id, ok: false, error: `no exec handler registered for op=${op}` };
		} else {
			try {
				const res = await this.execHandler(op, args);
				response = { v: PIPE_PROTOCOL_VERSION, chan: 'B', id, ok: res.ok === true, result: res.result, error: res.error, auditToken: res.auditToken };
			} catch (e) {
				response = { v: PIPE_PROTOCOL_VERSION, chan: 'B', id, ok: false, error: String((e && (e as Error).message) || e) };
			}
		}
		try { this.write(response); } catch { /* 已断开 */ }
	}

	/**
	 * 通道 A：请求/响应或流。
	 * - 非流（无 onEvent）：解析为 data 载荷里的 result。
	 * - 流（传 onEvent）：每个 data 帧回调 onEvent，end/error 时结算 Promise。
	 */
	callA<T = unknown>(method: string, payload?: unknown, onEvent?: ChannelAHandler): Promise<T> {
		if (!this.isConnected) { return Promise.reject(new Error('dsh-pipe: not connected')); }
		const id = this.nextId('a');
		if (onEvent) { this.listeners.set(id, onEvent); }
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				if (this.pending.delete(id)) {
					this.listeners.delete(id);
					reject(new Error(`dsh-pipe: A timeout for method=${method}`));
				}
			}, DEFAULT_A_TIMEOUT_MS);
			this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
			try {
				this.write({ v: PIPE_PROTOCOL_VERSION, chan: 'A', id, method, payload });
			} catch (e) {
				this.pending.delete(id);
				this.listeners.delete(id);
				clearTimeout(timer);
				reject(e as Error);
			}
			// 流方法可长期持有：这里不设超时上限，交给 onEvent 的调用方以 token 控制。
			if (onEvent) { clearTimeout(timer); this.pending.get(id)!.timer = undefined; }
		});
	}

	/**
	 * 通道 B：ide_* 执行（对称/测试保留）。正常生产由 Host 主动发起，见 onExecRequest。
	 * 返回 { ok, result?, error?, auditToken? }；Host 以帧 ok 结算对应 id。
	 */
	execB<T = unknown>(op: string, args: unknown): Promise<{ ok: boolean; result?: T; error?: string; auditToken?: string }> {
		if (!this.isConnected) { return Promise.reject(new Error('dsh-pipe: not connected')); }
		const id = this.nextId('b');
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				if (this.pending.delete(id)) { reject(new Error(`dsh-pipe: B timeout for op=${op}`)); }
			}, DEFAULT_A_TIMEOUT_MS);
			this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
			try {
				this.write({ v: PIPE_PROTOCOL_VERSION, chan: 'B', id, op, args });
			} catch (e) {
				this.pending.delete(id);
				clearTimeout(timer);
				reject(e as Error);
			}
		});
	}

	dispose(): void {
		this.disposed = true;
		this.authed = false;
		this.failAll(new Error('dsh-pipe: client disposed'));
		this.parser.dispose();
		try { this.socket?.destroy(); } catch { /* ignore */ }
		this.socket = undefined;
	}
}
