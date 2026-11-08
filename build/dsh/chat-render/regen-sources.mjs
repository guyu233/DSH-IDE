/**
 * Regenerate the copied ui-chat leaf sources in ../src/ from the
 * AUTHORITATIVE DSH source, rewriting every external import to the local shims.
 *
 * Applies the exact same import-rewrite the original 0.2.1-rc.5 copies used, so
 * the diff vs upstream is ONLY the import specifiers (file bodies stay verbatim).
 *
 * Usage (from vscode-1.143.1):
 *   node build/dsh/chat-render/regen-sources.mjs           # write
 *   node build/dsh/chat-render/regen-sources.mjs --check   # diff only, no write
 *
 * Source root overridable via DSH_SRC_ROOT (default = 0.2.2-rc.1 checkout).
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DSH_PKG = path.join(
  process.env.DSH_SRC_ROOT || 'E:/deepseek-harness-0.2.2-rc.1',
  'packages/client/ui-chat/src/client',
)
const LOCAL = path.join(HERE, 'src')
const CHECK = process.argv.includes('--check')

const FILES = [
  'locale.ts', 'markdown-labels.ts', 'reasoning-text.ts',
  'chat/AssistantMarkdown.tsx', 'chat/message-chrome.ts', 'chat/ReasoningContent.tsx',
  'chat/ReasoningRow.tsx', 'chat/RunningStatus.tsx', 'chat/RunningWhaleTail.tsx',
  'chat/stat-dialog.ts', 'chat/StatsPills.tsx', 'chat/step-process.ts',
  'chat/token-format.ts', 'chat/turn-assistant.ts', 'chat/TurnUsagePanel.tsx',
  'chat/use-disclosure.ts', 'chat/UserContent.tsx',
  'contract/assistant-content.ts', 'contract/turn-metrics.ts', 'contract/turn-process.ts',
]

const CSS_KEY = {
  accessibility: 'a11y', ReasoningRow: 'reasoningRow', AssistantMarkdown: 'assistantMarkdown',
  MessageItem: 'messageItem', StatsPills: 'statsPills', 'stat-dialog': 'statDialog',
  TurnUsagePanel: 'turnUsagePanel', ChatView: 'chatView', GenericCommandCard: 'genericCommandCard',
  TurnProcessNodeView: 'turnProcessNodeView',
}

/** ../-depth from a copied file (relative to this directory) up to chat-render/shims. */
function shimBase(relFile) {
  const dir = path.dirname(relFile).replaceAll('\\', '/')
  // Copies are flattened to `<this>/src/**` (T6-05): src/X.ts -> ../shims, src/chat/X.tsx -> ../../shims.
  const depth = dir === '.' || dir === '' || dir === 'src' ? 0 : dir.split('/').length
  return '../'.repeat(1 + depth) + 'shims'
}

function rewrite(src, relFile) {
  const shims = shimBase(relFile)
  let out = src
  // 1) @deepseek-ai/* imports (multiline-safe; braces may span lines).
  out = out.replace(/(import\s+(type\s+)?)\{([^{}]*?)\}\s+from\s+'(@deepseek-ai\/[^']+)'/g,
    (_all, kw, typeKw, names, pkg) => {
      let target
      if (pkg === '@deepseek-ai/dsh-util-workspace-path') target = `${shims}/workspace-path`
      else if (pkg === '@deepseek-ai/dsh-client-ui-primitives') target = typeKw ? `${shims}/types` : `${shims}/primitives`
      else target = `${shims}/types` // every other @deepseek-ai edge is type-only here
      return `${kw}{${names}} from '${target}'`
    })
  // 2) relative imports to ui-chat contract TYPE modules we do NOT vendor -> shims/types.
  //    Vendored contract files (turn-metrics/assistant-content/turn-process) stay local;
  //    runtime siblings (message-chrome/token-format/stat-dialog/...) also stay local.
  const VENDORED_CONTRACT = new Set(['turn-metrics', 'assistant-content', 'turn-process'])
  const STUB_CONTRACT = new Set(['slots', 'snapshot', 'chat-nodes', 'process-groups'])
  out = out.replace(/(import\s+(?:type\s+)?)\{([^{}]*?)\}\s+from\s+'((?:\.\.?\/)+)(?:contract\/)?([\w-]+)\.ts'/g,
    (all, kw, names, dots, base) => {
      if (VENDORED_CONTRACT.has(base)) return all
      if (STUB_CONTRACT.has(base) || all.includes('contract/')) return `${kw}{${names}} from '${shims}/types'`
      return all
    })
  // 3) ./<Name>.module.css  default import -> named cssClasses map.
  out = out.replace(/import\s+(\w+)\s+from\s+'\.\/([^']+)\.module\.css'/g, (_all, name, mod) => {
    const key = CSS_KEY[mod]
    if (!key) throw new Error(`[${relFile}] unmapped CSS module: ${mod}`)
    return `import { ${key} as ${name} } from '${shims}/cssClasses'`
  })
  if (/from '@deepseek-ai\//.test(out)) throw new Error(`[${relFile}] residual external import remains`)
  return out
}

for (const relFile of FILES) {
  const srcPath = path.join(DSH_PKG, relFile)
  const outPath = path.join(LOCAL, relFile)
  const rewritten = rewrite(fs.readFileSync(srcPath, 'utf8'), relFile)
  if (CHECK) {
    const cur = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : ''
    if (cur === rewritten) { console.log(`SAME  ${relFile}`) }
    else {
      const a = cur.split('\n'), b = rewritten.split('\n')
      let i = 0; while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++
      console.log(`DIFF  ${relFile}  @line ${i + 1}: cur=${JSON.stringify(a[i])}  new=${JSON.stringify(b[i])}`)
    }
  } else {
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, rewritten, 'utf8')
    console.log(`wrote ${relFile}`)
  }
}
if (CHECK) console.log('\n(check mode: nothing written)')
