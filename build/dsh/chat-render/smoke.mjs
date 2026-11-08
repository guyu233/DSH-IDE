// Real-browser smoke test for the rebuilt 0.2.2-rc.1 sidecar bundle.
// Loads dist/dsh-chat.js in real Chrome via Playwright, mounts every DshPartProps
// kind, and asserts mount/update/dispose work without console/page errors.
// Usage: node build/dsh/chat-render/smoke.mjs
import { createRequire } from 'node:module'
const require = createRequire(new URL('../node_modules/', import.meta.url))
const { chromium } = require('playwright')
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const bundle = fs.readFileSync(path.join(HERE, 'dist/dsh-chat.js'), 'utf8')

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage()
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))

await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>')
// Inject the ESM bundle as a module via a blob, then mount each kind.
await page.addScriptTag({ content: `window.__DSH_SRC__ = ${JSON.stringify(bundle)};` })
const result = await page.evaluate(async () => {
  const out = { ok: [], fail: [] }
  const blob = new Blob([window.__DSH_SRC__], { type: 'text/javascript' })
  const url = URL.createObjectURL(blob)
  let mod
  try { mod = await import(url) } catch (e) { return { ok: [], fail: ['import: ' + e.message] } }
  const api = mod.default || mod
  const cases = [
    ['reasoning', { kind: 'reasoning', text: 'think about it', running: false }],
    ['markdown', { kind: 'markdown', blocks: [{ type: 'text', text: '**hello** world' }], streaming: false }],
    ['user', { kind: 'user', content: { text: 'hi there', attachments: [], extraBlocks: [], referenceLabels: [] } }],
    ['stats', { kind: 'stats', usage: { totalTokens: 1500, outputTokens: 500, uncachedInputTokens: 1000 } }],
    ['running', { kind: 'running', startTime: Date.now() - 3000, paused: false }],
    ['running-holding', { kind: 'running', startTime: undefined, paused: true, holding: true }],
  ]
  for (const [name, props] of cases) {
    const host = document.createElement('div')
    document.getElementById('root').appendChild(host)
    try {
      const h = api.mountDshChatPart(host, props)
      if (typeof h.update === 'function') h.update(props)
      // React 18 createRoot renders asynchronously (concurrent); wait a tick for the commit.
      await new Promise(r => setTimeout(r, 30))
      const html = host.innerHTML || ''
      const styleCount = document.querySelectorAll('style[data-dsh-chat]').length
      h.dispose()
      if (html.length > 0) out.ok.push(`${name} (${html.length}b, styles=${styleCount})`)
      else out.fail.push(`${name}: empty html`)
    } catch (e) { out.fail.push(`${name}: ${e.message}`) }
  }
  return out
})
await browser.close()
console.log('OK:', result.ok.join(', ') || '(none)')
console.log('FAIL:', result.fail.join(' | ') || '(none)')
console.log('PAGE ERRORS:', errors.join(' | ') || '(none)')
process.exit(result.fail.length === 0 && errors.length === 0 ? 0 : 1)
