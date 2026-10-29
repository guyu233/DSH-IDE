const { open } = require('E:/vscode-dsh/tools/asar-read.cjs');
const r = open();
const a = r.findAll(/dsh-session\/lib\/index\.js$/)[0];
const s = r.read(a);
const lines = s.split('\n');
function show(re, before, after, max) {
	let n = 0;
	for (let i = 0; i < lines.length; i++) {
		if (re.test(lines[i])) {
			console.log('--- L' + (i + 1) + ' ---');
			console.log(lines.slice(Math.max(0, i - before), i + after).join('\n'));
			if (++n >= max) break;
		}
	}
}
console.log('##### "workspace/changes" data 定义 #####');
show(/"workspace\/changes"\s*:/, 2, 14, 3);
console.log('\n##### turn/end data 定义 #####');
show(/"turn\/end"\s*:/, 2, 10, 3);
console.log('\n##### append / on 事件方法 #####');
show(/append\(|on\(type|onEvent|subscribe/, 1, 4, 5);
