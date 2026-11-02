/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH-IDE 私有本地管道协议（Host↔VS Code 唯一通道）。
//
// 拓扑（客户端连接式，唯一权威定义，与 Host 半 dsh-ide/host/protocol.js 对齐）：
//   - DSH Host = 命名管道 *服务端*（net.createServer）。
//   - VS Code Electron 主进程 = 命名管道 *客户端*（net.connect）。
//   一条双工管道，长度前缀 JSON 帧按 id 多路复用：
//     - chan 'handshake'  客户端→服务端首帧：{ nonce }；服务端回 { ok:true|false }。
//     - chan 'A'          客户端→服务端：DSH 服务调用；服务端回 data*/end/error 帧。
//     - chan 'B'          服务端→客户端：ide_* 执行请求（{ op, args }），客户端执行后回
//                         { ok, result?|error?, auditToken? }，id 关联。
//   端点：`\\\\.\\pipe\\dsh-ide-<hostPid>-<nonce>`（Windows 命名管道）。VS Code 侧从 launch env
//   拿 `DSH_IDE_PIPE`（完整管道路径）+ `DSH_IDE_NONCE`（握手校验）。仅本地命名管道，
//   无 HTTP、无 /api、无 cookie —— 所有 DSH 连接都在 Host 进程内完成。
//
// 本文件是双端共享的唯一协议真相，Host(ESM) 与 VS Code(TS) 各自适配其运行时。

export const DSH_IDE_PIPE_ENV = 'DSH_IDE_PIPE';
export const DSH_IDE_NONCE_ENV = 'DSH_IDE_NONCE';
export const DSH_IDE_LAUNCH_ENV = 'DSH_IDE_LAUNCH'; // '1' 表示由 dsh-ide 拉起

export const PIPE_PROTOCOL_VERSION = 1 as const;

export type PipeChannel = 'handshake' | 'A' | 'B';

/** 通道 'handshake'：客户端首帧，携带一次性 nonce。 */
export interface PipeHandshake {
	readonly v: number;
	readonly chan: 'handshake';
	readonly id: string;
	readonly nonce: string;
}

/** 通道 'handshake'：服务端对握手的确认。 */
export interface PipeHandshakeAck {
	readonly v: number;
	readonly chan: 'handshake';
	readonly id: string;
	readonly ok: boolean;
}

/** 通道 A：Host-Remote 语义请求/响应（单帧配对，id 关联） */
export interface PipeRequest {
	readonly v: number;
	readonly chan: 'A';
	readonly id: string;
	readonly method: string;       // 例：session.follow / session.prompt / modelCatalog / selectModel / agentPresets.list / permissionPresets.catalog / approval.setPolicy / goal.*
	readonly payload?: unknown;
}

/** 通道 A：事件帧（Host 经管道回推；可多帧，对应一个请求的流） */
export interface PipeEvent {
	readonly v: number;
	readonly chan: 'A';
	readonly id: string;            // 对应请求的 id
	readonly event: 'snapshot' | 'data' | 'end' | 'error';
	readonly payload?: unknown;
}

/** 通道 B：ide_* 执行请求（Host→VS Code） */
export interface PipeExecRequest {
	readonly v: number;
	readonly chan: 'B';
	readonly id: string;
	readonly op: string;            // 例：writeFile / editFile / diagnostics / lsp / runCommand / terminal / git
	readonly args: unknown;
}

/** 通道 B：ide_* 执行响应（VS Code→Host） */
export interface PipeExecResponse {
	readonly v: number;
	readonly chan: 'B';
	readonly id: string;
	readonly ok: boolean;
	readonly result?: unknown;
	readonly error?: string;
	readonly auditToken?: string;   // 审计令牌（tool/call + approval/* 留痕）
}

/** 客户端可接收的入站帧（握手确认、通道 A 事件、通道 B 执行请求）。 */
export type PipeIncoming = PipeHandshakeAck | PipeEvent | PipeExecRequest;
/** 客户端可发送的出站帧（握手、通道 A 请求、通道 B 执行响应、通道 B 请求[对称/测试]）。 */
export type PipeOutgoing = PipeHandshake | PipeRequest | PipeExecResponse | PipeExecRequest;
/** 服务端可接收的入站帧（握手、通道 A 请求、通道 B 执行响应）。 */
export type PipeServerIncoming = PipeHandshake | PipeRequest | PipeExecResponse;

/**
 * 长度前缀帧编码：4 字节大端长度 + JSON UTF-8。
 * 返回 Buffer，便于 Node net / Electron net 直接 write。
 */
export function encodeFrame(frame: PipeOutgoing): Buffer {
	const body = Buffer.from(JSON.stringify(frame), 'utf8');
	const header = Buffer.allocUnsafe(4);
	header.writeUInt32BE(body.length, 0);
	return Buffer.concat([header, body]);
}

/** 流式解码器：喂入任意分片 Buffer，按长度前缀切出完整帧。 */
export class PipeFrameParser {
	private buffer = Buffer.alloc(0);

	/** @returns 本次喂入解析出的所有完整帧（已 JSON.parse） */
	push(chunk: Buffer): PipeIncoming[] {
		this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
		const frames: PipeIncoming[] = [];
		for (;;) {
			if (this.buffer.length < 4) break;
			const len = this.buffer.readUInt32BE(0);
			if (this.buffer.length < 4 + len) break;
			const body = this.buffer.subarray(4, 4 + len);
			this.buffer = this.buffer.subarray(4 + len);
			try {
				frames.push(JSON.parse(body.toString('utf8')) as PipeIncoming);
			} catch {
				// 损坏帧：跳过（不阻塞后续），Host 侧另有审计。
			}
		}
		return frames;
	}

	dispose(): void {
		this.buffer = Buffer.alloc(0);
	}
}
