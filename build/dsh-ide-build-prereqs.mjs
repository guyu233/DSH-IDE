/**
 * DSH-IDE 构建前置修复（可复现）。
 *
 * 本仓库的 node_modules 是「部分安装」状态，直接跑 `gulp dsh-ide-pack` 会失败。此脚本把两处**环境级**缺口补好，
 * 使官方 gulp 任务可跑通（不改 VS Code 上游逻辑；`build/lib/extensions.ts` 里的目录读取健壮性修复是单独的源码改动）：
 *
 *  1) `types-stash/`（仓库根的签名类型暂存，.gitignore 忽略）：扩展的 `node_modules/@types/{node,mocha,undici-types,
 *     sinonjs__fake-timers}` 是指向它的 junction，缺失即导致扩展 tsgo typecheck 报 “Cannot find type definition file”。
 *     从 `vscode-1.143.1/node_modules` 补齐（sinonjs 走 npm 安装）。
 *  2) `vscode-1.143.1/node_modules/esbuild` + `@esbuild/win32-x64`（被忽略）：扩展 esbuild 打包脚本 `import 'esbuild'`
 *     需要它；仓库未装。从 `vscode-1.143.1/build/node_modules` 复制（已被 sidecar 构建验证可用的二进制）。
 *
 * 用法（在仓库根 E:\vscode-dsh 下）：
 *   node vscode-1.143.1/build/dsh-ide-build-prereqs.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const VSC = path.dirname(here)                 // vscode-1.143.1
const ROOT = path.dirname(VSC)                 // repo root
const NM = path.join(VSC, 'node_modules')
const BUILD_NM = path.join(VSC, 'build', 'node_modules')
const STASH = path.join(ROOT, 'types-stash')

function cpDir(src, dst) {
  fs.rmSync(dst, { recursive: true, force: true })
  fs.cpSync(src, dst, { recursive: true })
}
function ok(p) { return fs.existsSync(path.join(p, 'package.json')) }

// 1) types-stash
fs.mkdirSync(STASH, { recursive: true })
const fromRoot = { node: path.join(NM, '@types', 'node'), mocha: path.join(NM, '@types', 'mocha'), 'undici-types': path.join(NM, 'undici-types') }
for (const [name, src] of Object.entries(fromRoot)) {
  const dst = path.join(STASH, name)
  if (!ok(dst)) { if (!ok(src)) throw new Error(`missing source for types-stash/${name}: ${src}`); cpDir(src, dst); console.log(`types-stash/${name} <- node_modules`) }
  else console.log(`types-stash/${name} OK`)
}
const sinon = path.join(STASH, 'sinonjs__fake-timers')
if (!ok(sinon)) {
  console.log('installing @types/sinonjs__fake-timers (needs network npm registry)…')
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '@types/sinonjs__fake-timers@8.1.5', '--no-save', '--no-package-lock', '--ignore-scripts', '--prefix', STASH], { stdio: 'inherit', shell: process.platform === 'win32' })
}
// types-stash/node/node_modules/undici-types：@types/node/dns.d.ts、http.d.ts 以裸说明符引用它
const uLink = path.join(STASH, 'node', 'node_modules', 'undici-types')
if (!fs.existsSync(uLink)) {
  fs.mkdirSync(path.join(STASH, 'node', 'node_modules'), { recursive: true })
  fs.cpSync(path.join(STASH, 'undici-types'), uLink, { recursive: true })
  console.log('types-stash/node/node_modules/undici-types OK')
}

// 2) esbuild for extensions
const ebDst = path.join(NM, 'esbuild')
const ebPkgDst = path.join(NM, '@esbuild', 'win32-x64')
if (!ok(ebDst)) { cpDir(path.join(BUILD_NM, 'esbuild'), ebDst); console.log('node_modules/esbuild <- build/node_modules') }
if (!ok(ebPkgDst)) {
  fs.mkdirSync(path.join(NM, '@esbuild'), { recursive: true })
  cpDir(path.join(BUILD_NM, '@esbuild', 'win32-x64'), ebPkgDst)
  console.log('node_modules/@esbuild/win32-x64 <- build/node_modules')
}

// 校验
const checks = [
  ['types-stash/node', ok(path.join(STASH, 'node'))],
  ['types-stash/mocha', ok(path.join(STASH, 'mocha'))],
  ['types-stash/undici-types', ok(path.join(STASH, 'undici-types'))],
  ['types-stash/sinonjs__fake-timers', ok(sinon)],
  ['node/node_modules/undici-types', fs.existsSync(uLink)],
  ['node_modules/esbuild', ok(ebDst)],
  ['node_modules/@esbuild/win32-x64', ok(ebPkgDst)],
]
let bad = 0
for (const [n, good] of checks) { console.log(`${good ? 'OK  ' : 'FAIL'} ${n}`); if (!good) bad++ }
if (bad) { console.error(`\n${bad} 项未就绪`); process.exit(1) }
console.log('\n构建前置全部就绪：可在 vscode-1.143.1 下运行 `node ./node_modules/gulp/bin/gulp.js dsh-ide-pack`')
