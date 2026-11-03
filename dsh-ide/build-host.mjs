// dsh-ide/build-host.mjs
// Host 半构建脚本。Host 源码已是纯 Node-ESM JS（与 @deepseek-ai/cordis 运行时共存），
// 无需 esbuild 转译；本脚本做存在性校验 + node --check 语法检查 + manifest/locale 校验，
// 并报告可分发形式（esbuild 不可用时的默认路径）。
//
// 若后续需要打包为单一文件（可选），取消下方 esbuild 分支注释即可。

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const hostFiles = ['index.js', 'host/launch.js', 'common/env.js'];

let ok = true;
for (const f of hostFiles) {
  const fp = path.join(root, f);
  if (!existsSync(fp)) { console.error(`MISSING ${f}`); ok = false; continue; }
  try { execSync(`node --check "${fp}"`, { stdio: 'pipe' }); console.log(`checked ${f}`); }
  catch (e) { console.error(`SYNTAX FAIL ${f}\n${e.stderr?.toString() || e.message}`); ok = false; }
}

// 校验 package.json / cordis.patch.yml / locale JSON / icon 存在。
for (const rel of ['package.json', 'cordis.patch.yml', 'icon.svg', 'locale/en.json', 'locale/zh.json']) {
  if (!existsSync(path.join(root, rel))) { console.error(`MISSING ${rel}`); ok = false; }
}
for (const rel of ['package.json', 'locale/en.json', 'locale/zh.json']) {
  try { JSON.parse(readFileSync(path.join(root, rel), 'utf8')); }
  catch (e) { console.error(`BAD JSON ${rel}: ${e.message}`); ok = false; }
}

if (!ok) process.exit(1);

try {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  console.log(`[build:host] ${pkg.name}@${pkg.version} ready (plain ESM, no bundling required).`);
  console.log('[build:host] bundle exports: index.js, host/*, locale/*.json, icon.svg, build-*.mjs');
} catch (e) { console.error(e.message); process.exit(1); }
