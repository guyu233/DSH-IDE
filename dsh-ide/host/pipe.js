// dsh-ide/host/pipe.js
// 私有命名管道服务端（Host 半，Node net）。DSH Host 起 server，VS Code 主进程作客户端连入。
//
// 帧多路复用（见 protocol.js）：
//   chan 'handshake' 客户端首帧携带 nonce，校验通过才放行。
//   chan 'A'         客户端请求 DSH 服务；本端分发到 services，流式方法逐帧回 data，末尾 end。
//   chan 'B'         本端（因模型调用 ide_* 写/LSP/终端）向客户端发起执行请求，客户端 ideExec 后回填。
//
// 仅本地命名管道；未握手/出错即断开。

import * as net from 'node:net';
import { randomUUID } from 'node:crypto';
import { encodeFrame, PipeFrameParser, PIPE_PROTOCOL_VERSION } from './protocol.js';
import { createHostServices } from './services.js';
import { createIdeTools } from './tools.js';

const EXEC_TIMEOUT_MS = 30000;

/**
 * 启动管道服务端，并返回一个可被工具使用的 execB（通道 B 执行入口）。
 * @param {object} ctx DSH Cordis 上下文
 * @param {object} opts { pipeName, nonce, root }
 * @returns {{ pipeName, execB, close, waitForClient }}
 */
export function startPipeServer(ctx, opts) {
  const nonce = opts.nonce;
  const services = createHostServices(ctx);

  /** 已握手的客户端 socket 集合；B 执行取最近一个可用连接。 */
  const clients = new Set();
  /** 通道 B 待回填：id -> { resolve, reject, timer } */
  const pendingB = new Map();

  const activeSocket = () => {
    // 取最近加入的已握手连接。
    let last = null;
    for (const s of clients) last = s;
    return last;
  };

  /** 通道 B：向 VS Code 侧发起一次 ideExec 请求并等待回填。 */
  function execB(op, args, signal) {
    const socket = activeSocket();
    if (!socket || socket.destroyed) return Promise.reject(new Error('IDE not connected (channel B unavailable)'));
    const id = `b-${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pendingB.delete(id); reject(new Error(`channel B timeout after ${EXEC_TIMEOUT_MS}ms for op=${op}`)); }, EXEC_TIMEOUT_MS);
      pendingB.set(id, { resolve, reject, timer });
      if (signal && typeof signal.addEventListener === 'function') {
        const onAbort = () => { if (pendingB.delete(id)) { clearTimeout(timer); reject(new Error('channel B aborted')); } };
        signal.addEventListener('abort', onAbort, { once: true });
      }
      try { socket.write(encodeFrame({ v: PIPE_PROTOCOL_VERSION, chan: 'B', id, op, args })); }
      catch (e) { pendingB.delete(id); clearTimeout(timer); reject(e); }
    });
  }

  const ideTools = createIdeTools(ctx, opts.root, { execB });

  const server = net.createServer((socket) => {
    const parser = new PipeFrameParser();
    let authed = false;
    const streams = new Map(); // id -> AbortController

    const send = (frame) => { try { socket.write(encodeFrame(frame)); } catch { /* 断开 */ } };

    function handle(frame) {
      if (!frame || frame.v !== PIPE_PROTOCOL_VERSION) { socket.destroy(); return; }

      // 握手：首帧必须是 { chan:'handshake', nonce }
      if (!authed) {
        if (frame.chan === 'handshake' && frame.nonce === nonce) {
          authed = true; clients.add(socket);
          send({ v: PIPE_PROTOCOL_VERSION, chan: 'handshake', id: frame.id ?? 'hs', ok: true });
        } else {
          send({ v: PIPE_PROTOCOL_VERSION, chan: 'handshake', id: frame.id ?? 'hs', ok: false });
          socket.destroy();
        }
        return;
      }

      if (frame.chan === 'A') return void handleA(frame);
      if (frame.chan === 'B') return void handleBResult(frame);
      socket.destroy();
    }

    async function handleA(frame) {
      const id = frame.id;
      const method = frame.method;
      const svc = services[method];
      if (typeof svc !== 'function') {
        send({ v: PIPE_PROTOCOL_VERSION, chan: 'A', id, event: 'error', payload: { error: `unknown method: ${method}` } });
        return;
      }
      const ac = new AbortController();
      streams.set(id, ac);
      const ctx2 = {
        signal: ac.signal,
        onEvent: (entry) => send({ v: PIPE_PROTOCOL_VERSION, chan: 'A', id, event: 'data', payload: entry }),
      };
      try {
        const res = await svc(frame.payload ?? {}, ctx2);
        if (!streams.has(id)) return; // 已因断开/取消作废
        send({ v: PIPE_PROTOCOL_VERSION, chan: 'A', id, event: 'data', payload: { ok: true, result: res?.result } });
        send({ v: PIPE_PROTOCOL_VERSION, chan: 'A', id, event: 'end' });
      } catch (err) {
        send({ v: PIPE_PROTOCOL_VERSION, chan: 'A', id, event: 'error', payload: { error: String((err && err.message) || err) } });
      } finally {
        streams.delete(id);
      }
    }

    function handleBResult(frame) {
      const entry = pendingB.get(frame.id);
      if (!entry) return;
      pendingB.delete(frame.id);
      clearTimeout(entry.timer);
      if (frame.ok) entry.resolve({ ok: true, result: frame.result, auditToken: frame.auditToken });
      else entry.reject(new Error(frame.error || 'channel B failed'));
    }

    socket.on('data', (chunk) => {
      let frames;
      try { frames = parser.push(chunk); } catch { socket.destroy(); return; }
      for (const frame of frames) handle(frame);
    });
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      clients.delete(socket);
      for (const ac of streams.values()) ac.abort();
      streams.clear();
      parser.dispose();
    });
    socket.setTimeout(0); // 长连接（follow 流可长期持有）
  });

  server.on('error', (e) => { try { ctx.logger?.error?.(`[dsh-ide] pipe server error: ${e && e.message}`); } catch { /* ignore */ } });
  server.listen(opts.pipeName);

  return {
    pipeName: opts.pipeName,
    execB,
    ideTools,
    close: () => { try { server.close(); } catch { /* ignore */ } },
    /** 解析为 true 当有客户端握手；用于启动端点等待 IDE 接线。 */
    waitForClient: (timeoutMs = 20000) => new Promise((resolve) => {
      if (clients.size > 0) return resolve(true);
      const t = setTimeout(() => { server.off('connection', onConn); resolve(false); }, timeoutMs);
      function onConn() { /* 需等握手，简单起见只观察 clients 轮询 */ }
      const iv = setInterval(() => { if (clients.size > 0) { clearInterval(iv); clearTimeout(t); resolve(true); } }, 200);
      setTimeout(() => clearInterval(iv), timeoutMs + 500);
      server.on('connection', onConn);
    }),
  };
}
