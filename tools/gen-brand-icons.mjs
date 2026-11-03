#!/usr/bin/env node
// tools/gen-brand-icons.mjs — generates real DSH-IDE app icons (no external deps):
//   resources/win32/dsh.ico (multi-size PNG-in-ICO), resources/linux/dsh-ide.png, resources/dsh-ide.png
// Draws a rounded square (DSH blue) with a white whale/fish mark. Pure Node (zlib + CRC32).
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || '.';

function crc32(buf) {
	let c, crc = 0xFFFFFFFF;
	for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
	return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
	const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
	const t = Buffer.from(type, 'ascii');
	const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
	return Buffer.concat([len, t, data, crc]);
}
function pngRGBA(width, height, rgba) {
	const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
	const raw = Buffer.alloc((width * 4 + 1) * height);
	for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4); }
	const idat = zlib.deflateSync(raw, { level: 9 });
	return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
// ---- draw ----
function draw(size) {
	const buf = Buffer.alloc(size * size * 4, 0);
	const set = (x, y, r, g, b, a) => { if (x < 0 || y < 0 || x >= size || y >= size) return; const i = (y * size + x) * 4; const ia = a / 255, oa = buf[i + 3] / 255; const na = ia + oa * (1 - ia); if (na <= 0) { return; } buf[i] = Math.round((r * ia + buf[i] * oa * (1 - ia)) / na); buf[i + 1] = Math.round((g * ia + buf[i + 1] * oa * (1 - ia)) / na); buf[i + 2] = Math.round((b * ia + buf[i + 2] * oa * (1 - ia)) / na); buf[i + 3] = Math.round(na * 255); };
	const inRR = (x, y, x0, y0, x1, y1, r) => {
		if (x < x0 || x > x1 || y < y0 || y > y1) return false;
		const cx = Math.max(x0 + r, Math.min(x, x1 - r)), cy = Math.max(y0 + r, Math.min(y, y1 - r));
		return ((x - cx) ** 2 + (y - cy) ** 2) <= r * r || (x >= x0 + r && x <= x1 - r) || (y >= y0 + r && y <= y1 - r);
	};
	// background: blue rounded square (gradient)
	const pad = Math.round(size * 0.06), r = Math.round(size * 0.22);
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
		if (!inRR(x, y, pad, pad, size - pad, size - pad, r)) continue;
		const t = y / size; const rr = 11, gg = Math.round(108 - 40 * t), bb = Math.round(240 - 30 * t);
		set(x, y, rr, gg, bb, 255);
	}
	// whale body: ellipse
	const cx = size * 0.46, cy = size * 0.52, ea = size * 0.30, eb = size * 0.20;
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
		const dx = (x - cx) / ea, dy = (y - cy) / eb; if (dx * dx + dy * dy <= 1) set(x, y, 255, 255, 255, 255);
	}
	// tail: triangle to the right
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
		const tx = size * 0.72, ty0 = size * 0.40, ty1 = size * 0.64, tip = size * 0.86;
		if (x >= tx && x <= tip) { const frac = (x - tx) / (tip - tx); const lo = ty0 + (size / 2 - ty0) * frac, hi = ty1 + (size / 2 - ty1) * frac * -1; if (y >= lo && y <= hi) set(x, y, 255, 255, 255, 255); }
	}
	// eye (blue dot on white body)
	const ex = size * 0.38, ey = size * 0.47, er = size * 0.035;
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { if ((x - ex) ** 2 + (y - ey) ** 2 <= er * er) set(x, y, 11, 60, 200, 255); }
	// water spout (small white arc) top-left of body
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const sx = size * 0.40, sy = size * 0.30; const d = Math.abs(Math.hypot(x - sx, y - sy) - size * 0.06); if (d < size * 0.012 && y < sy) set(x, y, 255, 255, 255, 220); }
	return buf;
}
function icoFromPngs(entries) {
	// entries: [{size, png}]
	const n = entries.length;
	const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(n, 4);
	const dir = Buffer.alloc(16 * n); let offset = 6 + 16 * n; const datas = [];
	entries.forEach((e, i) => {
		const o = i * 16;
		dir[o] = e.size >= 256 ? 0 : e.size; dir[o + 1] = e.size >= 256 ? 0 : e.size; dir[o + 2] = 0; dir[o + 3] = 0;
		dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6); dir.writeUInt32LE(e.png.length, o + 8); dir.writeUInt32LE(offset, o + 12);
		offset += e.png.length; datas.push(e.png);
	});
	return Buffer.concat([header, dir, ...datas]);
}

const sizes = [256, 128, 64, 48, 32, 16];
const entries = sizes.map((s) => ({ size: s, png: pngRGBA(s, s, draw(s)) }));
const ico = icoFromPngs(entries);
const win32 = path.join(ROOT, 'resources', 'win32'); fs.mkdirSync(win32, { recursive: true });
fs.writeFileSync(path.join(win32, 'dsh.ico'), ico);
const linux = path.join(ROOT, 'resources', 'linux'); fs.mkdirSync(linux, { recursive: true });
fs.writeFileSync(path.join(linux, 'dsh-ide.png'), entries[0].png);
fs.mkdirSync(path.join(ROOT, 'resources'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'resources', 'dsh-ide.png'), entries[0].png);
console.log('wrote resources/win32/dsh.ico (' + ico.length + ' bytes), resources/linux/dsh-ide.png, resources/dsh-ide.png (' + entries[0].png.length + ' bytes)');
