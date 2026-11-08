/**
 * SIDECAR JSX + CSS build for the DSH-IDE chat renderer.
 *
 * This is NOT a parallel VS Code build. It compiles only ~20 copied ui-chat
 * leaf sources + our shims into ONE ESM JS artifact and ONE CSS artifact,
 * consumed by the single seam in
 * `src/vs/workbench/contrib/dsh/browser/dshChatSeam.ts` (called from
 * `chatListRenderer.ts`). Upstream `src/tsconfig.json` has no `jsx`,
 * includes only `*.ts`, and lacks @types/react — that is exactly why this
 * sidecar stage exists (docs/DEVELOPMENT.md 第 1 章 §3 能力域与数据流分层).
 *
 * React/ReactDOM are aliased to the ONE installed copy at
 *   ../node_modules/{react,react-dom}  (18.3.1, MIT)
 * No second React is added. No DSH Cordis/boot/plugin graph is pulled in.
 *
 * Reproducible command (from vscode-1.143.1):
 *   node build/dsh/chat-render/build-render.mjs
 *
 * Outputs (git-ignored, do NOT commit):
 *   build/dsh/chat-render/dist/dsh-chat.js   (single ESM bundle)
 *   build/dsh/chat-render/dist/dsh-chat.css  (merged CSS for audit/debugging;
 *                                            the JS also self-injects it)
 *
 * Requires: only the esbuild already installed at
 *   build/node_modules/esbuild (0.27.2)
 * No npm install, no network, no dependency on the DSH checkout at build
 * time (the DSH sources and merged CSS are checked in under this directory).
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../../..')
const VSCODE_ROOT = REPO
const DIST = path.join(HERE, 'dist')

const ENTRY = path.join(HERE, 'index.tsx')
const OUT_JS = path.join(DIST, 'dsh-chat.js')
const OUT_CSS = path.join(DIST, 'dsh-chat.css')

/* ---- resolve the ONE React 18.3.1 installation ---- */
const NM = path.join(VSCODE_ROOT, 'node_modules')
const REACT_FILES = {
  react: path.join(NM, 'react/index.js'),
  'react/jsx-runtime': path.join(NM, 'react/jsx-runtime.js'),
  'react/jsx-dev-runtime': path.join(NM, 'react/jsx-dev-runtime.js'),
  'react/react.shared-subset': path.join(NM, 'react/react.shared-subset.js'),
  'react-dom': path.join(NM, 'react-dom/index.js'),
  'react-dom/client': path.join(NM, 'react-dom/client.js'),
}

for (const [name, file] of Object.entries(REACT_FILES)) {
  if (!fs.existsSync(file)) {
    console.error(`[chat-render] missing React alias target for "${name}": ${file}`)
    process.exit(1)
  }
}
const reactVersion = JSON.parse(fs.readFileSync(path.join(NM, 'react/package.json'), 'utf8')).version
const reactDomVersion = JSON.parse(fs.readFileSync(path.join(NM, 'react-dom/package.json'), 'utf8')).version
if (reactVersion !== '18.3.1' || reactDomVersion !== '18.3.1') {
  console.error(`[chat-render] expected React/ReactDOM 18.3.1, got ${reactVersion}/${reactDomVersion}`)
  process.exit(1)
}

/* ---- CSS text that the JS self-injects at mount time ---- */
const TOKENS_CSS = fs.readFileSync(path.join(HERE, 'shims/tokens.css'), 'utf8')
const PRIMITIVES_CSS = fs.readFileSync(path.join(HERE, 'shims/primitives.css'), 'utf8')
const DSH_CHAT_CSS = fs.readFileSync(path.join(HERE, 'dsh-chat.css'), 'utf8')
const ALL_CSS = `${TOKENS_CSS}\n${PRIMITIVES_CSS}\n${DSH_CHAT_CSS}`
const CSS_HASH = createHash('sha256').update(ALL_CSS).digest('hex').slice(0, 12)

/* ---- esbuild from VS Code's official build dependencies ---- */
const ESBUILD_DIR = path.join(VSCODE_ROOT, 'build/node_modules/esbuild')
const esbuildEntry = path.join(ESBUILD_DIR, 'lib/main.js')
if (!fs.existsSync(esbuildEntry)) {
  console.error(`[chat-render] esbuild not found at ${esbuildEntry}`)
  process.exit(1)
}
const esbuild = await import(pathToFileURL(esbuildEntry).href)
const build = esbuild.build ?? esbuild.default?.build
if (typeof build !== 'function') {
  console.error('[chat-render] esbuild.build is unavailable')
  process.exit(1)
}
const esbuildVersion = JSON.parse(fs.readFileSync(path.join(ESBUILD_DIR, 'package.json'), 'utf8')).version

/* ---- plugin 1: resolve react / react-dom to the single installed copy ---- */
const singleReactPlugin = {
  name: 'dsh-single-react',
  setup(api) {
    api.onResolve({ filter: /^react(?:\/.*)?$|^react-dom(?:\/.*)?$/ }, args => {
      const exact = REACT_FILES[args.path]
      if (exact) return { path: exact }
      // Fall back to a real file inside the same single package (keeps one copy).
      const base = args.path.startsWith('react-dom/')
        ? path.join(NM, 'react-dom', args.path.slice('react-dom/'.length))
        : path.join(NM, 'react', args.path.slice('react/'.length))
      const candidate = fs.existsSync(base) ? base
        : fs.existsSync(`${base}.js`) ? `${base}.js` : undefined
      if (candidate) return { path: candidate }
      return { errors: [{ text: `[chat-render] cannot resolve ${args.path} to the single React copy` }] }
    })
  },
}

/* ---- plugin 2: virtual CSS-as-string module for runtime self-injection ---- */
const virtualCssPlugin = {
  name: 'dsh-virtual-css',
  setup(api) {
    api.onResolve({ filter: /^virtual:dsh-chat-css$/ }, () => ({
      path: 'virtual:dsh-chat-css',
      namespace: 'dsh-virtual-css',
    }))
    api.onLoad({ filter: /.*/, namespace: 'dsh-virtual-css' }, () => ({
      contents: `export const css = ${JSON.stringify(ALL_CSS)};\nexport const hash = ${JSON.stringify(CSS_HASH)};\n`,
      loader: 'js',
    }))
  },
}

/* ---- run ---- */
fs.mkdirSync(DIST, { recursive: true })

const result = await build({
  absWorkingDir: HERE,
  entryPoints: [ENTRY],
  outfile: OUT_JS,
  bundle: true,
  write: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  jsx: 'automatic',
  jsxImportSource: 'react',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.ts': 'ts', '.tsx': 'tsx', '.css': 'css', '.json': 'json' },
  plugins: [singleReactPlugin, virtualCssPlugin],
  logLevel: 'warning',
  metafile: true,
  sourcemap: false,
  minify: false,
  legalComments: 'eof',
  charset: 'utf8',
})

const outputs = Object.keys(result.metafile?.outputs ?? {})
if (!outputs.length) {
  console.error('[chat-render] esbuild produced no outputs')
  process.exit(1)
}

const js = fs.statSync(OUT_JS)
const css = fs.existsSync(OUT_CSS) ? fs.statSync(OUT_CSS) : null
const jsSha = createHash('sha256').update(fs.readFileSync(OUT_JS)).digest('hex')
const cssSha = css ? createHash('sha256').update(fs.readFileSync(OUT_CSS)).digest('hex') : null

console.log('[chat-render] sidecar build OK')
console.log(`  esbuild        : ${esbuildVersion}`)
console.log(`  React/ReactDOM : ${reactVersion} (single copy at vscode-1.143.1/node_modules)`)
console.log(`  outputs        : ${outputs.join(', ')}`)
console.log(`  dist/dsh-chat.js  : ${js.size} bytes  sha256=${jsSha}`)
if (css) console.log(`  dist/dsh-chat.css : ${css.size} bytes  sha256=${cssSha}`)
console.log(`  runtime CSS hash  : ${CSS_HASH} (self-injected by mountDshChatPart)`)
console.log('  dist/ is a generated artifact: git-ignored, never committed.')
