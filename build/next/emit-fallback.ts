/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 构建回退：不经 esbuild 服务，直接用 TypeScript 自带转译器产出 `out/`。
//
// 为什么需要：本机（Windows）上 esbuild 的常驻服务在收尾删除临时目录时稳定失败
// （`remove C:\...\Temp\esbuild-<hash>: Access is denied`），残留物是一个 1.37 MB 的
// 普通文件而不是目录，因此按目录删除必然失败。`transpile` 命令会先 `cleanDir(out)`
// 再逐文件转译，服务一旦中途退出，`out/` 就停在半成品状态，后续 `test-dsh:all`
// 全部加载失败——这不是代码缺陷，却会阻断每一轮门禁。
//
// 本脚本只做同一件事的两步：`src/**` 的 `.ts` 用 `ts.transpileModule` 转译，
// 非 `.ts` 资源原样拷贝。它不参与打包（打包仍走 `gulp dsh-ide-pack`），
// 也不改变任何源码语义：转译选项与 `build/next/transpile.ts` 保持一致。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** 与 `transpile.ts` 的 `transformOptions` 对齐；差异仅在于这里用 tsc 而非 esbuild。 */
const COMPILER_OPTIONS: ts.CompilerOptions = {
	target: ts.ScriptTarget.ES2024,
	module: ts.ModuleKind.ESNext,
	experimentalDecorators: true,
	useDefineForClassFields: false,
	sourceMap: true,
	esModuleInterop: true,
	resolveJsonModule: true,
};

interface IEmitResult {
	readonly emitted: number;
	readonly copied: number;
	readonly failed: readonly string[];
}

function walkFiles(directory: string, into: string[] = []): string[] {
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const full = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			walkFiles(full, into);
		} else {
			into.push(full);
		}
	}
	return into;
}

/**
 * 把 `src/` 转译并拷贝到 `out/`。
 *
 * 不删除 `out/`：调用方可能只想要「补齐缺失产物」，而不是从零重建。
 * @param repoRoot 仓库根目录
 */
export function emitFallback(repoRoot: string): IEmitResult {
	const srcRoot = path.join(repoRoot, 'src');
	const outRoot = path.join(repoRoot, 'out');
	let emitted = 0;
	let copied = 0;
	const failed: string[] = [];

	for (const file of walkFiles(srcRoot)) {
		const relative = path.relative(srcRoot, file);
		const isDeclaration = file.endsWith('.d.ts');
		const isTypeScript = file.endsWith('.ts') && !isDeclaration;
		const destination = path.join(outRoot, isTypeScript ? `${relative.slice(0, -'.ts'.length)}.js` : relative);
		fs.mkdirSync(path.dirname(destination), { recursive: true });
		try {
			if (isTypeScript) {
				const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
					compilerOptions: COMPILER_OPTIONS,
					fileName: file,
				});
				fs.writeFileSync(destination, result.outputText);
				emitted += 1;
			} else {
				// `.d.ts` 与其它资源（`.js` / `.json` / `.css` / `.mjs`）原样拷贝。
				fs.copyFileSync(file, destination);
				copied += 1;
			}
		} catch (error) {
			failed.push(`${relative}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	return { emitted, copied, failed };
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	// 从 `build/next/` 上溯两级得到仓库根。
	const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
	const result = emitFallback(repoRoot);
	console.log(`[emit-fallback] emitted=${result.emitted} copied=${result.copied} failed=${result.failed.length}`);
	for (const line of result.failed.slice(0, 10)) {
		console.error(`[emit-fallback] ${line}`);
	}
	process.exit(result.failed.length === 0 ? 0 : 1);
}
