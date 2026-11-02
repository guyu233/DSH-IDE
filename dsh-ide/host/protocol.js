// dsh-ide/host/protocol.js
// DSH-IDE 私有本地管道协议（Host 半，纯 Node ESM，无外部依赖，node --check 可验）。
//
// 拓扑（唯一权威定义，双端共享）：
//   VS Code 主进程 = 客户端（net.connect）；DSH Host = 服务端（net.createServer）。
//   一条双工命名管道，长度前缀 JSON 帧按 id 多路复用：
//     - chan 'handshake'  客户端→服务端：{ nonce }（首帧，校验后放行）
//     - chan 'A'          客户端→服务端：DSH 服务调用（会话/模型/预设/审批/权限/目标），服务端回 data/end/error
//     - chan 'B'          服务端→客户端：ide_* 执行请求（{op,args}），客户端执行 ideExec 后回 {ok,result|error,auditToken}
//
// 仅本地命名管道；无 HTTP、无 /api、无 cookie。端点：\\.\pipe\dsh-ide-<hostPid>-<nonce>
// 环境变量：DSH_IDE_PIPE(完整管道路径) + DSH_IDE_NONCE(握手) + DSH_IDE_LAUNCH('1' 表示由 dsh-ide 拉起)。

import { randomBytes } from 'node:crypto';

export const DSH_IDE_PIPE_ENV = 'DSH_IDE_PIPE';
export const DSH_IDE_NONCE_ENV = 'DSH_IDE_NONCE';
export const DSH_IDE_LAUNCH_ENV = 'DSH_IDE_LAUNCH';
export const PIPE_PROTOCOL_VERSION = 1;

/** 编码一帧为 Buffer（4 字节大端长度前缀 + JSON UTF-8）。 */
export function encodeFrame(frame) {
  const body = Buffer.from(JSON.stringify(frame), 'utf8');
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** 流式帧解析器：喂入任意分片，按长度前缀切出完整帧（已 JSON.parse）。 */
export class PipeFrameParser {
  constructor() { this.buffer = Buffer.alloc(0); }

  push(chunk) {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const frames = [];
    for (;;) {
      if (this.buffer.length < 4) break;
      const len = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + len) break;
      const body = this.buffer.subarray(4, 4 + len);
      this.buffer = this.buffer.subarray(4 + len);
      try { frames.push(JSON.parse(body.toString('utf8'))); } catch { /* 损坏帧跳过 */ }
    }
    return frames;
  }

  dispose() { this.buffer = Buffer.alloc(0); }
}

/** 生成 Windows 命名管道完整路径。nonce 同时用于握手校验。 */
export function pipeName(hostPid, nonce) {
  return `\\\\.\\pipe\\dsh-ide-${hostPid}-${nonce}`;
}

/** 生成一次性随机 nonce（hex）。 */
export function randomNonce() {
  return randomBytes(16).toString('hex');
}
