#!/usr/bin/env node
/**
 * sync-upstream.mjs —— DSH 上游升级差异报告（T7-08 固化）
 *
 * 作用：当 DSH 上游发布新版本时，一条命令生成「本插件复用面 vs 新版本」的差异报告，
 * 输出到 `.build/upstream-diff/<新版本>-dsh-ide-diff.md`（不入库），用于「升级先读 docs/DEVELOPMENT.md 第 5 章上游核对流程、
 * 再重跑 verify:dsh-ide-contract 全量核对」的落地凭据。只读，不改任何源码。
 *
 * 复用面 = 本项目真正依赖 DSH 上游的两部分：
 *   1) 渲染复用件：`packages/client/ui-chat` 的 20 个源文件 + 8 个 CSS 模块 + 1 个 APNG；
 *   2) 传输/契约：connection / gateway / session-controller / llm / client-modules / typert 的关键契约文件。
 *
 * 用法（在仓库根 E:\vscode-dsh 下）：
 *   node scripts/sync-upstream.mjs                       # 用默认源 clone，base=当前 vendored 版本，target=最新 dsh-v* tag
 *   node scripts/sync-upstream.mjs --fetch               # 先从官方 upstream 抓取最新 tags 再比对
 *   node scripts/sync-upstream.mjs --target dsh-v0.2.2-rc.1
 *   node scripts/sync-upstream.mjs --source E:/deepseek-harness-0.2.2-rc.1 --base dsh-v0.2.1-rc.5 --target dsh-v0.2.2-rc.1
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(here)

function parseArgs(argv) {
	const a = { fetch: false, source: 'E:/deepseek-harness-0.2.2-rc.1', remote: 'https://github.com/deepseek-ai/deepseek-harness.git', base: undefined, target: undefined, out: undefined }
	for (let i = 0; i < argv.length; i++) {
		const k = argv[i]
		if (k === '--fetch') a.fetch = true
		else if (k === '--source') a.source = argv[++i]
		else if (k === '--remote') a.remote = argv[++i]
		else if (k === '--base') a.base = argv[++i]
		else if (k === '--target') a.target = argv[++i]
		else if (k === '--out') a.out = argv[++i]
		else if (k === '-h' || k === '--help') { console.log('见文件头注释'); process.exit(0) }
	}
	return a
}

const args = parseArgs(process.argv.slice(2))

function git(...g) {
	return execFileSync('git', ['-C', args.source, ...g], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

// 复用面清单（相对 packages/client/ui-chat 的源路径）
const UI_DIR = 'packages/client/ui-chat/src/client'
const UI_FILES = [
	'locale.ts', 'markdown-labels.ts', 'reasoning-text.ts',
	'chat/message-chrome.ts', 'chat/token-format.ts', 'chat/turn-assistant.ts', 'chat/step-process.ts',
	'chat/stat-dialog.ts', 'chat/use-disclosure.ts',
	'contract/assistant-content.ts', 'contract/turn-metrics.ts', 'contract/turn-process.ts',
	'chat/ReasoningRow.tsx', 'chat/ReasoningContent.tsx', 'chat/AssistantMarkdown.tsx', 'chat/UserContent.tsx',
	'chat/StatsPills.tsx', 'chat/TurnUsagePanel.tsx', 'chat/RunningStatus.tsx', 'chat/RunningWhaleTail.tsx',
]
const CSS_FILES = ['chat/accessibility.module.css', 'chat/ReasoningRow.module.css', 'chat/AssistantMarkdown.module.css', 'chat/MessageItem.module.css', 'chat/StatsPills.module.css', 'chat/stat-dialog.module.css', 'chat/TurnUsagePanel.module.css', 'chat/ChatView.module.css']
const ASSET_FILES = ['assets/running-whale@2x.png']
// 传输/契约面
const CONTRACT_FILES = [
	'packages/client/connection/src/rpc.ts',
	'packages/client/connection/src/client/index.ts',
	'packages/api/gateway/src/stream-protocol.ts',
	'packages/api/gateway/src/client/index.ts',
	'packages/api/gateway/src/client/stream-client.ts',
	'packages/api/session-controller/src/client/contract/events.ts',
	'packages/api/session-controller/src/client/sessions/assistant-stream.ts',
	'packages/api/session-controller/src/types.ts',
	'packages/llm/llm/src/types.ts',
	'packages/client/modules/src/client/manifest.ts',
	'packages/typert/protocol/src/index.ts',
	'packages/typert/protocol/src/types.ts',
]

function readVendoredVersion() {
	try {
		const p = fs.readFileSync(path.join(ROOT, 'vscode-1.143.1/build/dsh/chat-render/PROVENANCE.md'), 'utf8')
		const m = p.match(/\|\s*版本\s*\|\s*`?([0-9][^`|\s]*)`?\s*\|/)
		if (m) return m[1]
	} catch { /* ignore */ }
	return undefined
}

function main() {
	if (!fs.existsSync(path.join(args.source, '.git'))) throw new Error(`--source 不是 git 仓库: ${args.source}`)

	if (args.fetch) {
		try {
			let hasUpstream = false
			try { git('remote', 'get-url', 'upstream'); hasUpstream = true } catch { /* none */ }
			if (!hasUpstream) { try { git('remote', 'add', 'upstream', args.remote) } catch { /* exists */ } }
			git('fetch', 'upstream', '--tags', '--quiet')
			console.log('[sync] fetched upstream tags')
		} catch (e) {
			console.warn('[sync] 警告：fetch 失败（离线？），改用现有 tags 对比：' + e.message)
		}
	}

	const tags = git('tag', '--list', 'dsh-v*').split('\n').filter(Boolean)
		if (tags.length === 0) throw new Error('源 clone 无 dsh-v* tag')
	// 语义排序：取 `git tag --sort=v:refname`
	const sorted = git('tag', '--list', 'dsh-v*', '--sort=v:refname').split('\n').filter(Boolean)

	const vendored = readVendoredVersion()
	let base = args.base || (vendored ? `dsh-v${vendored}` : undefined)
	const target = args.target || sorted[sorted.length - 1]
	if (!base) base = sorted[sorted.length - 1]
	if (!tags.includes(base)) throw new Error(`base tag 不存在: ${base}（可选：${sorted.join(', ')}）`)
	if (!tags.includes(target)) throw new Error(`target tag 不存在: ${target}（可选：${sorted.join(', ')}）`)

	const baseCommit = git('rev-parse', '--short', `${base}^{commit}`)
	const targetCommit = git('rev-parse', '--short', `${target}^{commit}`)

	// 逐文件状态
	function statusOf(relPaths) {
		const out = {}
		for (const rel of relPaths) {
			try {
				const r = git('diff', '--name-status', base, target, '--', rel).split('\n').filter(Boolean)
				out[rel] = r.length === 0 ? 'SAME' : r[0].split('\t')[0] // A/M/D/...
			} catch { out[rel] = 'ERR' }
		}
		return out
	}
	const uiStatus = statusOf(UI_FILES.map(f => `${UI_DIR}/${f}`))
	const cssStatus = statusOf(CSS_FILES.map(f => `${UI_DIR}/${f}`))
	const assetStatus = statusOf(ASSET_FILES.map(f => `${UI_DIR}/${f}`))
	const contractStatus = statusOf(CONTRACT_FILES)

	const rel = (p) => p.replace(/^packages\/client\/ui-chat\/src\/client\//, '')
	const changedUi = Object.entries(uiStatus).filter(([, s]) => s !== 'SAME')
	const changedCss = Object.entries(cssStatus).filter(([, s]) => s !== 'SAME')
	const changedContract = Object.entries(contractStatus).filter(([, s]) => s !== 'SAME')
	const changedAsset = Object.entries(assetStatus).filter(([, s]) => s !== 'SAME')

	const same = base === target
	const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
	const outDir = args.out || path.join(ROOT, '.build', 'upstream-diff')
	fs.mkdirSync(outDir, { recursive: true })
	const reportPath = path.join(outDir, `${target.replace(/^dsh-v/, '')}-dsh-ide-diff.md`)

	const lines = []
	lines.push(`# DSH 上游差异报告：${base} → ${target}`)
	lines.push('')
	lines.push('> 由 `scripts/sync-upstream.mjs` 生成（只读，不改源码）。用于 R-10 升级核对。')
	lines.push('')
	lines.push('## 概要')
	lines.push('')
	lines.push('| 项 | 值 |')
	lines.push('| --- | --- |')
	lines.push(`| base | \`${base}\` @ \`${baseCommit}\` |`)
	lines.push(`| target | \`${target}\` @ \`${targetCommit}\` |`)
	lines.push(`| 生成时间 | ${now} |`)
	lines.push(`| 状态 | ${same ? '**版本相同（无需同步）**' : '有差异，需处理下表'} |`)
	lines.push(`| 渲染件变化 | ${changedUi.length}/20 源 + ${changedCss.length}/8 CSS + ${changedAsset.length}/1 资产 |`)
	lines.push(`| 传输/契约变化 | ${changedContract.length}/${CONTRACT_FILES.length} |`)
	lines.push('')
	lines.push('## 1. 渲染复用件（packages/client/ui-chat，20 源 / 8 CSS / 1 资产）')
	lines.push('')
	lines.push('| 文件 | 状态 |')
	lines.push('| --- | --- |')
	for (const f of UI_FILES) { const s = uiStatus[`${UI_DIR}/${f}`]; lines.push(`| \`${f}\` | ${s === 'SAME' ? '✓ 相同' : '⚠ ' + s} |`) }
	for (const f of CSS_FILES) { const s = cssStatus[`${UI_DIR}/${f}`]; lines.push(`| \`${f}\` | ${s === 'SAME' ? '✓ 相同' : '⚠ ' + s} |`) }
	for (const f of ASSET_FILES) { const s = assetStatus[`${UI_DIR}/${f}`]; lines.push(`| \`${f}\` | ${s === 'SAME' ? '✓ 相同' : '⚠ ' + s} |`) }
	lines.push('')
	lines.push('## 2. 传输 / 契约（连接 / 网关 / 会话控制器 / LLM / 模块清单 / typert）')
	lines.push('')
	lines.push('| 文件 | 状态 |')
	lines.push('| --- | --- |')
	for (const f of CONTRACT_FILES) { const s = contractStatus[f]; lines.push(`| \`${f}\` | ${s === 'SAME' ? '✓ 相同' : '⚠ ' + s} |`) }
	lines.push('')
	lines.push('## 3. 处理清单（人工核对）')
	lines.push('')
	if (same) {
		lines.push('- base 与 target 相同，无需动作。')
	} else {
		if (changedUi.length === 0 && changedCss.length === 0 && changedAsset.length === 0) {
			lines.push('- 渲染复用件：无变化，无需改 `vscode-1.143.1/build/dsh/chat-render/`。')
		} else {
			lines.push('- **渲染复用件有变化**：用 `node build/dsh/chat-render/regen-sources.mjs` 按新源重生成 `src/**`；若新增运行时符号（ui-primitives 的 Tooltip 等）需在 `shims/primitives.tsx` 补桩；CSS 变化用 `build-css.mjs` 重生成；随后 `build-render.mjs` + `smoke.mjs` 复验。')
			for (const [p, s] of changedUi) lines.push(`  - ${s} \`${rel(p)}\``)
			for (const [p, s] of changedCss) lines.push(`  - ${s} \`${rel(p)}\``)
			for (const [p, s] of changedAsset) lines.push(`  - ${s} \`${rel(p)}\``)
		}
		if (changedContract.length === 0) {
			lines.push('- 传输/契约：逐字相同，无需改传输复刻（`dshClientProtocol`/`dshEventMap`/`inlineCompletion`/`launch-guard`/host 插件）。')
		} else {
			lines.push('- **传输/契约有变化**：逐项核对线格式/类型形状，必要时改 `vscode-1.143.1/src/vs/platform/dshClient/**` 与 `src/vs/platform/dshClient/host/**`。')
			for (const [p, s] of changedContract) lines.push(`  - ${s} \`${p}\``)
		}
		lines.push('- 跑 `verify:dsh-ide-contract` 与 `verify:dsh-ide-protocol-single-source`，确认无破坏性变更。')
		lines.push('- 按 `VSCODE_PATCH_POINTS` 重核指纹；更新 `vscode-1.143.1/build/dsh/chat-render/PROVENANCE.md` 版本/commit/sha256。')
	}
	lines.push('')

	fs.writeFileSync(reportPath, lines.join('\n'), 'utf8')

	console.log(`[sync] ${base}(${baseCommit}) → ${target}(${targetCommit})  ${same ? 'SAME' : 'DIFF'}`)
	console.log(`[sync] 渲染件: ${changedUi.length}/20 源, ${changedCss.length}/8 CSS, ${changedAsset.length}/1 资产`)
	console.log(`[sync] 传输/契约: ${changedContract.length}/${CONTRACT_FILES.length}`)
	console.log(`[sync] 报告: ${path.relative(ROOT, reportPath)}`)
	if (!same && (changedUi.length || changedCss.length || changedContract.length)) {
		console.log('[sync] 结论：有变化，需按报告 §3 处理。')
	} else if (!same) {
		console.log('[sync] 结论：仅版本号变化、复用面无差异。')
	}
}

try { main() } catch (e) { console.error('[sync] 失败：' + (e && e.message ? e.message : e)); process.exit(1) }
