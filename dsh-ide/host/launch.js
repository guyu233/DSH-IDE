// dsh-ide/host/launch.js
// 以「官方载体」方式拉起 DSH-IDE 窗口（v2：DSH 桌面 App 单一 Host 的第二个官方客户端）。
//
// 不再自带 Electron dist、不再注入私有管道。VS Code 由调用方指定的可执行文件拉起，
// 注入官方端点+token（由 index.js 经 ctx.webServer.getOrigin() + ctx.connection.authenticatedUrl() 派生）：
//   DSH_IDE_ENDPOINT = <Host Web origin>（如 http://127.0.0.1:56188）
//   DSH_IDE_TOKEN    = 进程内 launch token（登录用；VS Code 侧走官方 /connect）
// 单实例：相同 folder 复用已起窗口（--reuse-window）+ 存活跟踪。
//
// 说明：R1 阶段 VS Code 可执行文件由配置 `ideExe`/`ideAppPath` 指定（用户机器提供）；v2 不再自带 dist。

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DSH_IDE_ENDPOINT_ENV, DSH_IDE_TOKEN_ENV, DSH_IDE_INTERACTIONS_ENV } from '../common/env.js';

/** 存活跟踪：pid -> folder。 */
const live = new Map();
function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; }
}

function toFileUri(p) {
  let s = String(p).replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(s)) s = '/' + s;
  else if (!s.startsWith('/')) s = '/' + s;
  s = s.replace(/[%#? ]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return 'file://' + s;
}

function defaultDataHome() {
  return process.env.DSH_IDE_DATA_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh-ide');
}

/**
 * 校验 VS Code 运行时（exe + app 目录）。
 * @param {object} cfg { ideExe, ideAppPath }
 */
export function resolveIdeRuntime(cfg = {}) {
  const exe = cfg.ideExe;
  if (!exe || !fs.existsSync(exe)) throw new Error(`IDE executable not found: ${cfg.ideExe || '(unset; set config.ideExe)'}`);
  const app = cfg.ideAppPath || path.join(path.dirname(exe), 'resources', 'app');
  return { exe, app };
}

/**
 * 拉起 DSH-IDE 窗口（detached），注入官方端点+token。
 * @param {object} cfg 配置（ideExe/ideAppPath/ideWorkdir/ideUserDataDir/ideExtensionsDir）
 * @param {object} opts { endpoint, token, folder, interactions? }
 */
export function launchIde(cfg, opts) {
  const { exe, app } = resolveIdeRuntime(cfg);
  const folder = opts.folder || cfg.ideWorkdir || process.cwd();
  const userDataDir = cfg.ideUserDataDir || path.join(defaultDataHome(), 'user-data');
  const extensionsDir = cfg.ideExtensionsDir || path.join(defaultDataHome(), 'extensions');

  // 单实例：相同 folder 且进程存活则复用。
  for (const [pid, info] of live) {
    if (!isAlive(pid)) live.delete(pid);
    else if (info.folder === folder) return { pid, folder, reused: true };
  }

  const env = { ...process.env };
  // Electron 存在性陷阱：必须 delete，不能设 undefined。
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  delete env.ELECTRON_ENABLE_LOGGING;
  // v2：清掉可能残留的 v1 管道变量，避免旧路径误触。
  delete env.DSH_IDE_PIPE;
  delete env.DSH_IDE_NONCE;
  env.VSCODE_DEV = '1';
  env[DSH_IDE_ENDPOINT_ENV] = opts.endpoint;
  env[DSH_IDE_TOKEN_ENV] = opts.token;
  env[DSH_IDE_INTERACTIONS_ENV] = opts.interactions === 'answer' ? 'answer' : 'none';

  const args = [
    folder, // 位置参数即可；或用 --folder-uri
    `--folder-uri=${toFileUri(folder)}`,
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    '--reuse-window',
  ];

  const child = spawn(exe, [app, ...args], { env, detached: true, stdio: 'ignore' });
  child.unref();
  const pid = child.pid ?? -1;
  if (pid > 0) live.set(pid, { folder });
  return { pid, folder, reused: false };
}
