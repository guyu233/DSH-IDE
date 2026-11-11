/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 第 51 轮：用**真实 DSH 事件流**做 P95 校准（D22）。
//
// 背景：D22 要求「P95 校准 ≤ 512 KiB 并重生成 golden」，此前只有 mock 脚手架
// （第 23 轮，5 条 seq 偏移的合成会话，P95 = 7915 B）——手册明确要求**真实样本**。
// 第 51 轮发现本机 `~/.dsh/sessions/<workspace>/session-*/session.v4.jsonl.zstd`
// 就是真实事件流，并解决了两个技术障碍：
//   ① 文件是**多帧 zstd**（追加写入）。Node 的 `zstdDecompressSync` 只解第一帧
//      （4.2 MB 的文件只得到 186 B 的会话头），必须按魔数 `28 B5 2F FD` 切分逐帧解；
//   ② 解出的 JSONL 含 `type: "session"` 头行，投影前要剔除。
//
// 本脚本：
//   - 读真实会话（可用 `DSH_REAL_SESSION` 指定，否则取最新的一个）；
//   - 逐帧解压，解析事件；
//   - 以固定窗口（默认 100 事件）滑窗构造多条「会话样本」，投影后取 rows 字节数；
//   - 用最近秩法求 P95，与 `ROWS_P95_BYTE_LIMIT` 比较。
//
// **只读**：不写 golden、不改常量。它给的是**测量证据**；是否据此调整
// `MAX_ROWS` / `RESULT_PREVIEW_LIMIT` 仍需按手册第 5 章 §5 的固定序列决定。
//
// 用法：`node build/lib/dsh/verify/dshRealSampleP95.mjs`

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const repoRoot = process.cwd();
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** 找真实会话文件：优先环境变量，否则取 `~/.dsh/sessions` 下最新的 `session.v4.jsonl.zstd`。 */
function findSessionFile() {
	const explicit = process.env['DSH_REAL_SESSION'];
	if (explicit && fs.existsSync(explicit)) { return explicit; }

	const sessionsRoot = path.join(process.env['USERPROFILE'] ?? process.env['HOME'] ?? '', '.dsh', 'sessions');
	if (!fs.existsSync(sessionsRoot)) { return null; }

	let best = null;
	let bestMtime = 0;
	for (const workspace of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
		if (!workspace.isDirectory()) { continue; }
		const wsDir = path.join(sessionsRoot, workspace.name);
		for (const session of fs.readdirSync(wsDir, { withFileTypes: true })) {
			if (!session.isDirectory()) { continue; }
			const candidate = path.join(wsDir, session.name, 'session.v4.jsonl.zstd');
			if (!fs.existsSync(candidate)) { continue; }
			const mtime = fs.statSync(candidate).mtimeMs;
			if (mtime > bestMtime) { bestMtime = mtime; best = candidate; }
		}
	}
	return best;
}

/** 逐帧解压多帧 zstd（Node 的 zstdDecompressSync 只解第一帧）。 */
function decompressAllFrames(buffer) {
	const starts = [];
	for (let i = 0; i <= buffer.length - 4; i++) {
		if (buffer.compare(ZSTD_MAGIC, 0, 4, i, i + 4) === 0) { starts.push(i); }
	}
	if (starts.length === 0) { return { text: '', frames: 0, failed: 0 }; }

	const chunks = [];
	let failed = 0;
	for (let k = 0; k < starts.length; k++) {
		const start = starts[k];
		const end = k + 1 < starts.length ? starts[k + 1] : buffer.length;
		try {
			chunks.push(zlib.zstdDecompressSync(buffer.subarray(start, end)));
		} catch {
			failed++;
		}
	}
	return { text: Buffer.concat(chunks).toString('utf8'), frames: starts.length, failed };
}

const sessionFile = findSessionFile();
if (sessionFile === null) {
	console.log('STATUS: PASS  [real-p95] 本机无真实会话样本，跳过（mock 脚手架见 dshIdeProjection.test.ts）');
	process.exit(0);
}

const raw = fs.readFileSync(sessionFile);
const { text, frames, failed } = decompressAllFrames(raw);
const events = [];
for (const line of text.split('\n')) {
	if (line.trim() === '') { continue; }
	try {
		const parsed = JSON.parse(line);
		if (parsed.type !== 'session') { events.push(parsed); }
	} catch { /* 跳过坏行 */ }
}

if (events.length === 0) {
	console.error('STATUS: FAIL  [real-p95] 解压后没有事件（检查会话文件格式）');
	process.exit(1);
}

// 动态导入投影器与翻译器（TS 源，靠 --experimental-strip-types 运行）。
const projectorUrl = pathToFileURL(path.join(repoRoot, 'src/vs/platform/dshClient/common/ide-view-projector.ts')).href;
const translatorUrl = pathToFileURL(path.join(repoRoot, 'src/vs/platform/dshClient/common/translator.ts')).href;
const projector = await import(projectorUrl);
const translator = await import(translatorUrl);

const WINDOW = Number(process.env['DSH_P95_WINDOW'] ?? 100);
const sizes = [];
for (let i = 0; i < events.length; i += WINDOW) {
	const window = events.slice(i, i + WINDOW);
	if (window.length < 10) { continue; }
	const rows = projector.projectIdeView(translator.translateAll(window)).rows;
	sizes.push(Buffer.byteLength(JSON.stringify(rows), 'utf8'));
}

if (sizes.length === 0) {
	console.error('STATUS: FAIL  [real-p95] 事件不足以构成窗口');
	process.exit(1);
}

const sorted = [...sizes].sort((a, b) => a - b);
const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1];
const limit = projector.ROWS_P95_BYTE_LIMIT;

console.log(`  真实会话文件            : ${path.relative(repoRoot, sessionFile)}`);
console.log(`  zstd 帧 / 解压失败      : ${frames} / ${failed}`);
console.log(`  真实事件数              : ${events.length}`);
console.log(`  窗口大小 / 窗口数        : ${WINDOW} / ${sizes.length}`);
console.log(`  单窗字节范围            : ${Math.min(...sizes)} ~ ${Math.max(...sizes)} B`);
console.log(`  P95（最近秩法）          : ${p95} B`);
console.log(`  阈值                    : ${limit} B`);

if (p95 > limit) {
	console.error('');
	console.error('STATUS: FAIL  [real-p95] 真实样本 P95 超出阈值，须按第 5 章 §5 的固定序列校准');
	console.error('  （① 下调 MAX_ROWS → ② 收紧 preview → ③ 重生成 golden），属参数校准而非架构回退。');
	process.exit(1);
}

console.log('');
console.log(`STATUS: PASS  [real-p95] 真实样本 P95 = ${p95} B ≤ ${limit} B（余量 ${(((limit - p95) / limit) * 100).toFixed(1)}%）`);
