// dsh-ide/index.js
// DSH-IDE Host Cordis 插件入口（v2 / R1，Cordis bundle plugin，apply 形式；纯 Node-ESM）。
//
// v2 定稿：DSH-IDE = DSH 桌面 App 单一 Host 的「第二个官方客户端」。传输 100% 官方：
//   - Host 侧不再有私有命名管道 / 通道 A/B / ide_*。
//   - IDE（VS Code）作为外部进程，用官方 dsh-client-connection（/api + /api/remote.mux + cookie）
//     连到本 Host；登录 token 由 ctx.connection.authenticatedUrl() 派生。
//
// 本插件（Host 侧）职责（R1 最小）：
//   1. 提供 /dsh-ide-launch：把 官方端点(hostUrl) + launchToken 交给 DSH-IDE 客户端（spawn VS Code）。
//   2. 提供 /dsh-ide-status：诊断端点（origin + 是否有 connection）。
//   R3 起：在此注册 @Remote IDE 扩展服务（ctx.remote.ide.*）。

import z from '@deepseek-ai/schemastery';
import { launchIde, resolveIdeRuntime } from './host/launch.js';
import { IdeRemoteService } from './host/ide-service.js';

/** 目标服务：webServer 提供 launch/status 端点；connection 派生官方 token（可选）。 */
export const inject = ['webServer'];

export const Config = z.object({
  /** IDE 专属 @Remote 服务的受约束工作区根（空 = process.cwd()）。 */
  root: z.string().default(''),
  /** 拉起 IDE 时打开的文件夹（空 = process.cwd()）。 */
  ideWorkdir: z.string().default(''),
  /** DSH-IDE（VS Code）可执行文件路径（用户机器提供；v2 不再自带 Electron dist）。 */
  ideExe: z.string().default(''),
  /** 打包后的 app 目录（含 out/）；空 = <exeDir>/resources/app。 */
  ideAppPath: z.string().default(''),
  ideUserDataDir: z.string().default(''),
  ideExtensionsDir: z.string().default(''),
  /** 新 API Peer 的 interactions：'none'（一元够用）或 'answer'（需要 $events 时）。 */
  interactions: z.string().default('none'),
});

export function apply(ctx, config = {}) {
  // 0) 注册官方 @Remote IDE 扩展服务（命名空间 ide，经官方 Typert Gateway 暴露给客户端）。
  ctx.plugin(IdeRemoteService, { root: config.root || process.cwd() });

  /** 派生官方登录 URL（tokenized），并拆出 endpoint + token 供 IDE 使用。 */
  function deriveEndpointAndToken(folder) {
    const connection = ctx.get('connection');
    const origin = ctx.webServer.getOrigin();
    if (!origin) throw new Error('webServer origin unavailable');
    const base = new URL(origin);
    // 让 IDE 打开的目标目录带在 URL 的 hash 里仅作提示；沿用官方 mock。
    if (folder) { base.hash = ''; }
    const tokenized = connection && typeof connection.authenticatedUrl === 'function'
      ? connection.authenticatedUrl(base.href)
      : base.href;
    const u = new URL(tokenized);
    const token = u.searchParams.get('token') || '';
    const endpoint = `${u.protocol}//${u.host}`;
    if (!token) throw new Error('launch token unavailable (ctx.connection.authenticatedUrl did not yield a token)');
    return { endpoint, token };
  }

  // 1) /dsh-ide-launch：交给 IDE 官方端点 + token，并拉起窗口。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-ide-launch',
    handler: async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      try {
        const body = await readJsonBody(req);
        const folder = (body && typeof body.folder === 'string' && body.folder) || config.ideWorkdir || process.cwd();
        const { endpoint, token } = deriveEndpointAndToken(folder);
        // 先校验运行时是否配置（未配置则不 spawn，仅回报端点，便于用户先配 ideExe）。
        let launched = null;
        try {
          resolveIdeRuntime(config);
          launched = launchIde(config, { endpoint, token, folder, interactions: config.interactions });
        } catch (e) {
          // 未配置 ideExe：仍返回端点+token，供手动启动或首次配置参考。
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, launched: false, reason: String((e && e.message) || e), endpoint, token, folder }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, launched: true, ...launched, endpoint }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String((e && e.message) || e) }));
      }
    },
  }), 'dsh-ide: /dsh-ide-launch');

  // 2) /dsh-ide-status：诊断（origin、是否有 connection）。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-ide-status',
    handler: (_req, res) => {
      let origin = '';
      try { origin = ctx.webServer.getOrigin() || ''; } catch { /* ignore */ }
      const hasConnection = !!ctx.get('connection');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ origin, hasConnection, hostPid: process.pid }));
    },
  }), 'dsh-ide: /dsh-ide-status');
}

function readJsonBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') { resolve(req.body); return; }
    let data = ''; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); return; } data += c; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

export default apply;
