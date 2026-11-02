// dsh-ide/index.js
// DSH-IDE Host Cordis 插件入口（Cordis bundle plugin，apply 形式；纯 Node-ESM）。
//
// 职责：
//  1. 启动时建立私有命名管道服务端（nonce 握手），经它把 DSH 全部连接暴露给 VS Code（无 /api、无 cookie）。
//  2. 注册 ide_* 工具（进入 DSH 会话日志审计 tool/call + tool/result；写/终端经 approval/*）。
//  3. 注册 /dsh-ide-launch 端点：同源/nonce 校验后拉起自带 Electron dist 的 VS Code 窗口（单实例）。
//
// 所有 DSH 调用都在 Host 进程内经 ctx.get(name) 完成；管道只是传输层。详见 .build/rc5-contract.md。

import z from '@deepseek-ai/schemastery';
import { randomUUID } from 'node:crypto';
import { pipeName as makePipeName } from './host/protocol.js';
import { startPipeServer } from './host/pipe.js';
import { launchIde } from './host/launch.js';

/** 目标服务：webServer 提供 /dsh-ide-launch；tools 承载 ide_* 注册。 */
export const inject = ['webServer', 'tools'];

export const Config = z.object({
  /** 工作区根（ide_* 的读写受约束于此；空 = 进程 cwd）。 */
  root: z.string().default(''),
  /** 自带 Electron dist 目录（含 DeepSeek Harness.exe）；空 = 包内 runtime/electron。 */
  ideRuntimeDir: z.string().default(''),
  /** 显式 exe 覆盖（一般留空）。 */
  ideExe: z.string().default(''),
  /** 拉起 IDE 时打开的文件夹（空 = process.cwd()）。 */
  ideWorkdir: z.string().default(''),
  ideUserDataDir: z.string().default(''),
  ideExtensionsDir: z.string().default(''),
  /** 由 DSH 启动注入的 Host base url（供 IDE 侧账号/连接读取）。 */
  hostBaseUrl: z.string().default(''),
});

export function apply(ctx, config = {}) {
  const hostPid = process.pid;
  const nonce = randomUUID().replace(/-/g, '');
  const pipe = makePipeName(hostPid, nonce);
  const root = config.root || process.cwd();

  // 1) 管道服务端（含 ide_* 分发所需的 execB 通道 B）。
  let pipeServer;
  ctx.effect(() => {
    pipeServer = startPipeServer(ctx, { pipeName: pipe, nonce, root });
    ctx.logger?.info?.(`[dsh-ide] private pipe listening: ${pipe}`);
    return () => { try { pipeServer.close(); } catch { /* ignore */ } };
  }, 'dsh-ide: private pipe server');

  // 2) ide_* 工具注册（审计经 DSH tools 层）。
  ctx.effect(() => {
    const names = pipeServer ? pipeServer.ideTools.register() : [];
    ctx.logger?.info?.(`[dsh-ide] registered ide tools: ${names.join(', ') || '(none)'}`);
    // ideTools.register 内部已把各 register 的 dispose 挂到 ctx.effect；此处无额外清理。
    return () => { /* 由各工具 register 的 ctx.effect 负责 */ };
  }, 'dsh-ide: ide_* tools');

  // 3) /dsh-ide-launch：拉起 IDE 窗口（同源/nonce + 单实例）。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-ide-launch',
    handler: async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      try {
        const body = await readJsonBody(req);
        const folder = (body && typeof body.folder === 'string' && body.folder) || config.ideWorkdir || process.cwd();
        const { pid, reused } = launchIde(config, { pipePath: pipe, nonce, folder });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ launched: true, pid, folder, reused }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String((e && e.message) || e) }));
      }
    },
  }), 'dsh-ide: /dsh-ide-launch');

  // 4) /dsh-ide-status：是否已有 IDE 客户端接入（调试/健康检查）。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-ide-status',
    handler: (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ pipe, hostPid, root }));
    },
  }), 'dsh-ide: /dsh-ide-status');
}

function readJsonBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    // 部分载体已解析 body。
    if (req.body && typeof req.body === 'object') { resolve(req.body); return; }
    let data = ''; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); return; } data += c; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

export default apply;
