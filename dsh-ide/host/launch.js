// dsh-ide/host/launch.js
// 以自带 Electron dist 启动包内 VS Code app（DSH 的 exe 与 bundle exe 字节一致，见 docs/dsh-ide-facts.md）。
// 注入 DSH_IDE_PIPE + DSH_IDE_NONCE + DSH_IDE_LAUNCH；delete ELECTRON_RUN_AS_NODE；VSCODE_DEV=1。
// 单实例：对相同 folder 复用已起窗口（--reuse-window），并做存活跟踪避免重复拉起。

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DSH_IDE_LAUNCH_ENV, DSH_IDE_PIPE_ENV, DSH_IDE_NONCE_ENV } from './protocol.js';

/**
 * 解析 VS Code 运行时：优先包内 runtime/electron（自带 dist），其次配置覆盖。
 * @param {object} cfg 配置
 * @returns {{ exe: string, app: string }}
 */
export function resolveIdeRuntime(cfg = {}) {
  const pkgDir = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // dsh-ide 包根
  const runtimeRoot = cfg.ideRuntimeDir || path.join(pkgDir, 'runtime', 'electron');
  const exe = cfg.ideExe || path.join(runtimeRoot, 'DeepSeek Harness.exe');
  const app = cfg.ideAppPath || path.join(runtimeRoot, 'resources', 'app');
  if (!fs.existsSync(exe)) throw new Error(`IDE Electron exe not found: ${exe}`);
  const outMain = path.join(app, 'out', 'main.js');
  if (!fs.existsSync(outMain) && !fs.existsSync(path.join(app, 'package.json'))) {
    throw new Error(`IDE app not found at ${app} (need out/main.js or package.json)`);
  }
  return { exe, app };
}

/** 存活跟踪：pid -> true（进程存在）。 */
const live = new Map();
function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; }
}

function toFileUri(p) {
  // Windows 路径 -> file:///E:/a/b；统一正斜杠，仅编码会破坏 URI 的字符（保留盘符冒号与斜杠）。
  let s = String(p).replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(s)) s = '/' + s;         // E:/x -> /E:/x
  else if (!s.startsWith('/')) s = '/' + s;
  s = s.replace(/[%#? ]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return 'file://' + s;
}

function defaultDataHome() {
  return process.env.DSH_IDE_DATA_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh-ide');
}

/**
 * 拉起 IDE 窗口（detached，独立进程组）。
 * @param {object} cfg 配置
 * @param {object} opts { pipePath, nonce, folder }
 * @returns {{ pid: number, folder: string, reused: boolean }}
 */
export function launchIde(cfg, opts) {
  const { exe, app } = resolveIdeRuntime(cfg);
  const folder = opts.folder || cfg.ideWorkdir || process.cwd();
  const userDataDir = cfg.ideUserDataDir || path.join(defaultDataHome(), 'user-data');
  const extensionsDir = cfg.ideExtensionsDir || path.join(defaultDataHome(), 'extensions');

  // 单实例：若上一次拉起的进程仍存活且 folder 相同，直接复用（--reuse-window 亦会置前）。
  for (const [pid, info] of live) {
    if (!isAlive(pid)) live.delete(pid);
    else if (info.folder === folder) return { pid, folder, reused: true };
  }

  const env = { ...process.env };
  // Electron 检查变量「存在性」而非值：必须 delete，不能设 undefined（见 facts §3）。
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  delete env.ELECTRON_ENABLE_LOGGING;
  env.VSCODE_DEV = '1';
  env[DSH_IDE_LAUNCH_ENV] = '1';
  env[DSH_IDE_PIPE_ENV] = opts.pipePath;
  env[DSH_IDE_NONCE_ENV] = opts.nonce;
  if (cfg.hostBaseUrl) env.DSH_HOST_BASE_URL = cfg.hostBaseUrl;

  const args = [
    app,
    `--folder-uri=${toFileUri(folder)}`,
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    '--reuse-window',
  ];

  const child = spawn(exe, args, { env, detached: true, stdio: 'ignore' });
  child.unref();
  const pid = child.pid ?? -1;
  if (pid > 0) live.set(pid, { folder });
  return { pid, folder, reused: false };
}
