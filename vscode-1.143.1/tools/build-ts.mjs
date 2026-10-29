// 用 VS Code 自带的 esbuild 把指定 .ts 转成 out/ 下的 ESM，格式与官方 gulp transpile 一致。
// 用法: node tools/build-ts.mjs <src-relative-ts...>
//   e.g. node tools/build-ts.mjs vs/workbench/contrib/chat/electron-browser/agentSessions/agentSessionsActions.ts
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const esbuild = require(path.join(repo, 'build/node_modules/esbuild'));

const files = process.argv.slice(2);
if (files.length === 0) {
	console.error('usage: node tools/build-ts.mjs <src-relative .ts ...>');
	process.exit(1);
}

// 保留 css / 资源 import 原样（VS Code 运行时自带处理），其余按 ESM 转译。
const keepAsset = {
	name: 'keep-asset-imports',
	setup(build) {
		build.onResolve({ filter: /\.(css|svg|png|gif|ttf|woff2?)$/ }, args => ({ path: args.path, external: true }));
	},
};

let failed = false;
for (const rel of files) {
	const src = path.join(repo, 'src', rel);
	const out = path.join(repo, 'out', rel.replace(/\.ts$/, '.js'));
	if (!fs.existsSync(src)) { console.error('MISSING', src); failed = true; continue; }
	const code = fs.readFileSync(src, 'utf8');
	try {
		const res = await esbuild.transform(code, {
			loader: 'ts',
			format: 'esm',
			target: 'es2022',
			platform: 'neutral',
			sourcefile: src,
			sourcemap: false,
			tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false, verbatimModuleSyntax: false } },
		});
		// transform 不会处理 import 解析；css import 已经是字面量，天然保留。
		fs.mkdirSync(path.dirname(out), { recursive: true });
		fs.writeFileSync(out, res.code, 'utf8');
		console.log('OK', path.relative(repo, out));
	} catch (e) {
		console.error('FAIL', rel, e.message);
		failed = true;
	}
}
process.exit(failed ? 1 : 0);
