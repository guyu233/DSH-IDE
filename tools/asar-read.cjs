const fs = require('fs');
const P = 'C:/Users/guyu/AppData/Local/Programs/DeepSeek Harness/resources/app.asar';
function open() {
	const fd = fs.openSync(P, 'r');
	const b = Buffer.alloc(16); fs.readSync(fd, b, 0, 16, 0);
	const hs = b.readUInt32LE(12);
	const hb = Buffer.alloc(hs); fs.readSync(fd, hb, 0, hs, 16);
	const h = JSON.parse(hb.toString('utf8').replace(/\0+$/, ''));
	const base = 16 + hs;
	function findAll(re) {
		const out = [];
		(function w(n, p) {
			if (!n.files) return;
			for (const k of Object.keys(n.files)) {
				const np = p + '/' + k; const c = n.files[k];
				if (c.files) w(c, np);
				else if (re.test(np)) out.push({ path: np, off: Number(c.offset), size: Number(c.size) });
			}
		})(h, '');
		return out;
	}
	function read(a) { const buf = Buffer.alloc(a.size); fs.readSync(fd, buf, 0, a.size, base + a.off); return buf.toString('utf8'); }
	return { findAll, read };
}
module.exports = { open };
if (require.main === module) {
	const r = open();
	const pat = process.argv[2] ? new RegExp(process.argv[2]) : null;
	if (pat) {
		for (const a of r.findAll(pat).slice(0, 40)) console.log(a.path, a.size);
	}
}
