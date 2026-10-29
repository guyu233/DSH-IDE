const { open } = require('E:/vscode-dsh/tools/asar-read.cjs');
const r = open();
const a = r.findAll(/dsh-session\/lib\/index\.js$/)[0];
const s = r.read(a);
const lines = s.split('\n');
function show(re, before = 2, after = 8, max = 6) {
	let n = 0;
	for (let i = 0; i < lines.length; i++) {
		if (re.test(lines[i])) {
			console.log('--- L' + (i + 1) + ' ---');
			console.log(lines.slice(Math.max(0, i - before), i + after).join('\n'));
			if (++n >= max) break;
		}
	}
}
console.log('##### workspace/changes #####');
show(/workspace\/changes/, 1, 6, 4);
console.log('##### turn/end #####');
show(/turn\/end/, 1, 8, 3);
console.log('##### SessionEventMap 定义附近 #####');
show(/SessionEventMap/, 1, 30, 2);
