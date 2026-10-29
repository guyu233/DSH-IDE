const { open } = require('E:/vscode-dsh/tools/asar-read.cjs');
const r = open();
// search workspace/changes across session lib files
for (const a of r.findAll(/dsh-session\/lib\/(index|types\/index)\.js$/)) {
	const s = r.read(a);
	const lines = s.split('\n');
	for (let i = 0; i < lines.length; i++) {
		if (/workspace\/changes|WorkspaceChangesSummary|WorkspaceChangedFile|turn\/end/.test(lines[i])) {
			// print compact context when it looks like a type/JSDoc block
			const ctx = lines.slice(Math.max(0, i - 3), i + 12).join('\n');
			if (/snapshot|files|added|deleted|summary|sequence|seq|data:|type:/.test(ctx)) {
				console.log('=== ' + a.path + ' L' + (i + 1) + ' ===');
				console.log(ctx);
				console.log();
			}
		}
	}
}
