#!/usr/bin/env node
/**
 * sync-upstream.mjs —— DSH 上游升级差异报告（T7-08 固化）
 *
 * 作用：当 DSH 上游发布新版本时，一条命令生成「本插件复用面 vs 新版本」的差异报告，
 * 输出到 `.build/upstream-diff/<新版本>-dsh-ide-diff.md`（不入库），用于升级时比对复用面差异的落地凭据。只读，不改任何源码。
 *
 * 复用面 = 本项目真正依赖 DSH 上游的两部分：
 *   1) 历史渲染复用件：`packages/client/ui-chat` 的 20 个源文件 + 8 个 CSS 模块 + 1 个 APNG。
 *      这批复制件与 sidecar 构建链已删除（仅保留 `build/dsh/chat-render/` 的来源凭据），
 *      本脚本仍按上游 tag 比对，用于追溯「当初复用的是哪些文件」；它们不再进入构建。
 *   2) 传输/契约：connection / gateway / session-controller / llm / client-modules / typert 的关键契约文件。
 *
 * 用法（在仓库根执行）：
 *   node scripts/sync-upstream.mjs                    # 默认：经官方远程 API 比对（不需要本机 clone）
 *   node scripts/sync-upstream.mjs --fetch            # 先从官方远程解析最新 tag（只读 ls-remote，不写任何仓库）
 *   node scripts/sync-upstream.mjs --target dsh-v0.2.2-rc.3
 *   node scripts/sync-upstream.mjs --source <本地只读 clone> --base dsh-v0.2.1-rc.5 --target dsh-v0.2.2-rc.3
 *
 * 与仓库约定的关系：AGENTS §3 禁止在本机下载或保留 DSH 整仓副本。因此本脚本
 * **默认不 clone**，改用官方 compare API 读取精确 tag 之间的文件状态；`--source`
 * 只用于已经存在的本地只读副本，脚本对它只做读取（不加 remote、不 fetch、不改 refs）。
 * 网络不可用时不猜结论，明确输出 `STATUS: PENDING`。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(here)

function parseArgs(argv) {
	// `source` 默认 undefined：没有显式指定就**不**假设本机有整仓副本（AGENTS §3 禁止保留）。
	const a = { fetch: false, source: undefined, remote: 'https://github.com/deepseek-ai/deepseek-harness.git', base: undefined, target: undefined, out: undefined }
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

/** 只读调用本地 clone：`-C <source>` 只读取，不写 refs。 */
function git(...g) {
	return execFileSync('git', ['-C', args.source, ...g], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** 仓库根，用于相对路径与产物目录。 */
const REPO_ROOT = ROOT

/**
 * 只读解析远端 tag 列表（`git ls-remote`，不需要 clone，也不写任何本地仓库）。
 * @returns {Promise<string[]>} 形如 `dsh-v0.2.2-rc.3` 的 tag 名
 */
async function listRemoteTags() {
	const out = execFileSync('git', ['ls-remote', '--tags', '--refs', args.remote], {
		encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
	})
	return out
		.split(/\r?\n/)
		.map(line => line.split('\t')[1])
		.filter(ref => typeof ref === 'string' && ref.startsWith('refs/tags/dsh-v'))
		.map(ref => ref.slice('refs/tags/'.length))
}

/**
 * 经官方 compare API 判断两个 tag 之间某文件的状态。
 *
 * 为什么不 clone：整仓副本被仓库约定禁止，且 clone 会把「网络 + 磁盘」两件事耦合进
 * 一个只读比对。API 直接给两端 commit 与文件级差异，语义足够且不留本地副本。
 * @returns {Promise<Record<string, string>>} 相对路径 → SAME / A / M / D / ERR
 */
async function statusOfViaApi(baseTag, targetTag, relPaths) {
	const api = 'https://api.github.com/repos/deepseek-ai/deepseek-harness';
	const headers = { accept: 'application/vnd.github+json', 'user-agent': 'dsh-ide-sync-upstream' };
	const getJson = async url => {
		const res = await fetch(url, { headers });
		if (!res.ok) { throw new Error(`${res.status} ${res.statusText} for ${url}`); }
		return res.json();
	};
	const baseSha = (await getJson(`${api}/git/ref/tags/${baseTag}`)).object.sha;
	const targetSha = (await getJson(`${api}/git/ref/tags/${targetTag}`)).object.sha;
	const compare = await getJson(`${api}/compare/${baseSha}...${targetSha}`);
	const touched = new Map();
	for (const file of compare.files ?? []) {
		touched.set(file.filename, file.status);
	}
	const status = {};
	for (const rel of relPaths) {
		const hit = touched.get(rel);
		status[rel] = hit === undefined ? 'SAME' : hit === 'added' ? 'A' : hit === 'modified' ? 'M' : hit === 'removed' ? 'D' : hit.toUpperCase();
	}
	return status;
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
		const p = fs.readFileSync(path.join(ROOT, 'build/lib/dsh/PROVENANCE.md'), 'utf8')
		const m = p.match(/\|\s*版本\s*\|\s*`?([0-9][^`|（(]*)`?/)
		if (m) return m[1].trim()
	} catch { /* ignore */ }
	return undefined
}

async function main() {
	// 两种数据来源：显式 `--source`（已存在的本地只读副本）或远端 API（默认）。
	// 共同约束：**都不写任何仓库**——不加 remote、不 fetch、不改 refs。
	let tags
	let baseCommit
	let targetCommit
	let statusOf

	if (args.source !== undefined) {
		// 先判互斥再判路径：否则一个同时给了两者的调用会报「路径不存在」，
		// 掩盖真正的问题（这个组合本身不被允许）。
		if (args.fetch) {
			throw new Error('--fetch 与 --source 互斥：本脚本不会对本地副本执行 fetch（那会改动它的 refs）。请去掉 --fetch 改用远端比对。')
		}
		if (!fs.existsSync(path.join(args.source, '.git'))) {
			throw new Error(`--source 不是 git 仓库（只读副本）: ${args.source}`)
		}
		tags = git('tag', '--list', 'dsh-v*', '--sort=v:refname').split('\n').filter(Boolean)
		if (tags.length === 0) { throw new Error('源副本无 dsh-v* tag') }
		statusOf = (relPaths) => {
			const out = {}
			for (const rel of relPaths) {
				try {
					const r = git('diff', '--name-status', base, target, '--', rel).split('\n').filter(Boolean)
					out[rel] = r.length === 0 ? 'SAME' : r[0].split('\t')[0]
				} catch { out[rel] = 'ERR' }
			}
			return out
		}
	} else {
		try {
			tags = (await listRemoteTags()).sort()
		} catch (error) {
			// 网络不可用时不猜结论：明确 PENDING，让调用方知道「没比对」。
			console.log(`STATUS: PENDING  [sync-upstream] 无法读取远端 tag（${error && error.message ? error.message : error}）`)
			console.log('  离线或 API 不可用时本脚本不产出差异报告；请在网络可用后重跑。')
			process.exit(0)
		}
		statusOf = (relPaths) => statusOfViaApi(base, target, relPaths)
	}

	const vendored = readVendoredVersion()
	let base = args.base || (vendored ? `dsh-v${vendored}` : undefined)
	const target = args.target || tags[tags.length - 1]
	if (!base) base = tags[tags.length - 1]
	if (!tags.includes(base)) throw new Error(`base tag 不存在: ${base}（可选：${tags.join(', ')}）`)
	if (!tags.includes(target)) throw new Error(`target tag 不存在: ${target}（可选：${tags.join(', ')}）`)

	if (args.source !== undefined) {
		baseCommit = git('rev-parse', '--short', `${base}^{commit}`)
		targetCommit = git('rev-parse', '--short', `${target}^{commit}`)
	} else {
		baseCommit = base
		targetCommit = target
	}

	// 逐文件状态（来源由上面的分支决定：远端 API 或本地只读副本）
	const uiStatus = await statusOf(UI_FILES.map(f => `${UI_DIR}/${f}`))
	const cssStatus = await statusOf(CSS_FILES.map(f => `${UI_DIR}/${f}`))
	const assetStatus = await statusOf(ASSET_FILES.map(f => `${UI_DIR}/${f}`))
	const contractStatus = await statusOf(CONTRACT_FILES)

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
	lines.push(`| 历史渲染件变化 | ${changedUi.length}/20 源 + ${changedCss.length}/8 CSS + ${changedAsset.length}/1 资产（本地复制件已删除，仅作历史对照） |`)
	lines.push(`| 传输/契约变化 | ${changedContract.length}/${CONTRACT_FILES.length} |`)
	lines.push('')
	lines.push('## 1. 历史渲染复用件（packages/client/ui-chat，20 源 / 8 CSS / 1 资产；本地复制件与 sidecar 已删除，仅作历史对照）')
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
			lines.push('- DSH 历史渲染件：无变化，无需动作（本地复制件已删除，仅作历史对照）。')
		} else {
			lines.push('- **DSH 历史渲染件有变化**：这些上游文件曾用于旧渲染 sidecar，本地复制件已删除；如需重做渲染复用，以此为差异清单，当前不进入构建。')
			for (const [p, s] of changedUi) lines.push(`  - ${s} \`${rel(p)}\``)
			for (const [p, s] of changedCss) lines.push(`  - ${s} \`${rel(p)}\``)
			for (const [p, s] of changedAsset) lines.push(`  - ${s} \`${rel(p)}\``)
		}
		if (changedContract.length === 0) {
			lines.push('- 传输/契约：逐字相同，无需改传输复刻（`dshClientProtocol`/`dshEventMap`/`inlineCompletion`/`launch-guard`/host 插件）。')
		} else {
			lines.push('- **传输/契约有变化**：逐项核对线格式/类型形状，必要时改 `src/vs/platform/dshClient/**` 与 `src/vs/platform/dshClient/host/**`。')
			for (const [p, s] of changedContract) lines.push(`  - ${s} \`${p}\``)
		}
		lines.push('- 跑 `verify:dsh-ide-contract` 与 `verify:dsh-ide-protocol-single-source`，确认无破坏性变更。')
		lines.push('- 按 `VSCODE_PATCH_POINTS` 重核指纹；更新 `build/lib/dsh/PROVENANCE.md` 版本/commit/sha256。')
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

main().catch(e => { console.error('[sync] 失败：' + (e && e.message ? e.message : e)); process.exit(1) })
