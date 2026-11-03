// dsh-ide/host/ide-fs.js
// IDE @Remote 服务的纯文件系统核心（无 cordis 依赖，可 node 直接单测）。
// 安全底线（docs/dsh-ide-facts.md §4 #5）：拒绝绝对路径入参；解析后必须仍在 root 内；realpath 防符号链接逃逸。

import * as fs from 'node:fs';
import * as path from 'node:path';

/** 构造受 root 约束的路径解析器。 */
export function makeResolve(root) {
  const rootAbs = path.resolve(root || '.');
  const rootWithSep = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
  return (p) => {
    if (typeof p !== 'string' || p.length === 0) throw new Error('path is required');
    if (path.isAbsolute(p)) throw new Error('absolute paths are not allowed');
    const abs = path.resolve(rootAbs, p);
    if (abs !== rootAbs && !abs.startsWith(rootWithSep)) throw new Error('path escapes workspace root');
    try {
      const real = fs.realpathSync(abs);
      const realRoot = fs.realpathSync(rootAbs);
      const realRootSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
      if (real !== realRoot && !real.startsWith(realRootSep)) throw new Error('path escapes workspace root via symlink');
    } catch (e) { if (e && /escapes workspace root/.test(e.message)) throw e; }
    return abs;
  };
}

export async function readFileAt(resolve, filePath) {
  const abs = resolve(filePath);
  const text = await fs.promises.readFile(abs, 'utf8');
  return { path: filePath, text };
}

export async function listDirAt(resolve, dirPath) {
  const abs = resolve(dirPath || '.');
  const entries = await fs.promises.readdir(abs, { withFileTypes: true });
  return { path: dirPath || '.', entries: entries.map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other' })) };
}
