/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** Keeps build I/O comfortably below the Windows CRT's 8192 file-handle limit. */
export const MAX_CONCURRENT_FILE_OPERATIONS = 256;

const transformOptions: esbuild.TransformOptions = {
	loader: 'ts',
	format: 'esm',
	target: 'es2024',
	sourcemap: 'inline',
	sourcesContent: false,
	tsconfigRaw: JSON.stringify({
		compilerOptions: {
			experimentalDecorators: true,
			useDefineForClassFields: false
		}
	}),
};

/**
 * 超过该字节数的文件改用 `build` API 转译。
 *
 * 为什么需要这条分支：`esbuild.transform` 会把输入写成系统临时目录里的一个临时文件，
 * 再让 Go 侧删掉它。在本机（Windows）上，超过约 1 MiB 的输入会让这次删除稳定失败
 * （`remove C:\...\Temp\esbuild-<hash>: Access is denied`），残留一个同名普通文件，
 * 转译整体报错。实测边界：1048578 B 成功、1050000 B 失败；1024 KB 通过、1029 KB 失败。
 *
 * `build` API 走真实文件入口，不经过那条临时文件路径，因此同一份 1,377,561 B 的
 * 源文件用 `build` 能正常产出（实测 outputs=2）。这不是绕过检查，而是改用另一条
 * 官方 API 完成同一件事：输入输出仍是同一份源码与同一个目标文件。
 */
const LARGE_FILE_THRESHOLD_BYTES = 1024 * 1024;

export async function transpileFile(srcPath: string, destPath: string): Promise<void> {
	const size = (await fs.promises.stat(srcPath)).size;
	await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

	if (size > LARGE_FILE_THRESHOLD_BYTES) {
		// `build` 需要 outdir + entryPoints；写到临时 outdir 再取回内容，
		// 这样不改变调用方约定的「一个源文件 → 一个目标文件」语义。
		const outdir = path.join(path.dirname(destPath), `.esbuild-large-${process.pid}-${Math.random().toString(36).slice(2)}`);
		try {
			// `transformOptions.loader` 是字符串（`'ts'`），而 `build` 的 `loader` 必须是
			// 「扩展名 → loader」的对象；直接展开会在 build API 下报 `"loader" must be an object`。
			// 因此这里显式给出映射，其余选项与 `transform` 保持一致。
			const built = await esbuild.build({
				entryPoints: [srcPath],
				outdir,
				bundle: false,
				write: false,
				format: transformOptions.format,
				target: transformOptions.target,
				sourcemap: transformOptions.sourcemap,
				sourcesContent: transformOptions.sourcesContent,
				tsconfigRaw: transformOptions.tsconfigRaw,
				loader: { '.ts': 'ts' },
			});
			const js = built.outputFiles.find(file => file.path.endsWith('.js'));
			if (js === undefined) {
				throw new Error(`esbuild produced no JavaScript output for ${srcPath}`);
			}
			await fs.promises.writeFile(destPath, adjustEsmUrl(js.text));
		} finally {
			await fs.promises.rm(outdir, { recursive: true, force: true }).catch(() => undefined);
		}
		return;
	}

	const source = await fs.promises.readFile(srcPath, 'utf-8');
	const result = await esbuild.transform(source, {
		...transformOptions,
		sourcefile: srcPath,
	});
	await fs.promises.writeFile(destPath, adjustEsmUrl(result.code));
}

export async function copyFile(srcPath: string, destPath: string): Promise<void> {
	await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

	if (needsBomAdded(srcPath)) {
		const content = await fs.promises.readFile(srcPath);
		if (content[0] !== 0xef || content[1] !== 0xbb || content[2] !== 0xbf) {
			await fs.promises.writeFile(destPath, Buffer.concat([UTF8_BOM, content]));
			return;
		}
	}
	await fs.promises.copyFile(srcPath, destPath);
}

export async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
	if (!Number.isInteger(concurrency) || concurrency < 1) {
		throw new RangeError('Concurrency must be a positive integer.');
	}

	const results = new Array<R>(items.length);
	let nextIndex = 0;
	let firstError: { value: unknown } | undefined;

	async function worker(): Promise<void> {
		while (!firstError && nextIndex < items.length) {
			const index = nextIndex++;
			try {
				results[index] = await task(items[index], index);
			} catch (error) {
				firstError ??= { value: error };
			}
		}
	}

	const workerCount = Math.min(concurrency, items.length);
	await Promise.all(Array.from({ length: workerCount }, worker));

	if (firstError) {
		throw firstError.value;
	}

	return results;
}

export async function applyIncrementalClientChanges(repoRoot: string, outDir: string, changedPaths: readonly string[]): Promise<void> {
	const destinations = new Set<string>();
	for (const changedPath of changedPaths) {
		if (!changedPath.startsWith('src/')) {
			continue;
		}
		destinations.add(getOutputRelativePath(changedPath.slice('src/'.length)));
	}

	const operations = await mapWithConcurrency([...destinations], MAX_CONCURRENT_FILE_OPERATIONS, async destination => {
		const destinationPath = path.join(repoRoot, outDir, destination);
		const resourceSource = path.join(repoRoot, 'src', destination);

		if (!resourceSource.endsWith('.ts') && await isFile(resourceSource)) {
			return { destinationPath, sourcePath: resourceSource, kind: 'copy' as const };
		}

		if (destination.endsWith('.js')) {
			const typeScriptSource = path.join(repoRoot, 'src', destination.slice(0, -'.js'.length) + '.ts');
			if (await isFile(typeScriptSource) && !typeScriptSource.endsWith('.d.ts')) {
				return { destinationPath, sourcePath: typeScriptSource, kind: 'transpile' as const };
			}
		}

		if (await isFile(resourceSource)) {
			return { destinationPath, sourcePath: resourceSource, kind: 'copy' as const };
		}

		return { destinationPath, kind: 'remove' as const };
	});

	for (const operation of operations) {
		if (operation.kind === 'remove') {
			await fs.promises.rm(operation.destinationPath, { recursive: true, force: true });
		}
	}
	for (const operation of operations) {
		if (operation.kind !== 'remove' && await isDirectory(operation.destinationPath)) {
			await fs.promises.rm(operation.destinationPath, { recursive: true, force: true });
		}
	}

	await mapWithConcurrency(operations, MAX_CONCURRENT_FILE_OPERATIONS, async operation => {
		if (operation.kind === 'copy') {
			await copyFile(operation.sourcePath, operation.destinationPath);
		} else if (operation.kind === 'transpile') {
			await transpileFile(operation.sourcePath, operation.destinationPath);
		}
	});
}

export function getOutputRelativePath(sourceRelativePath: string): string {
	return sourceRelativePath.endsWith('.ts') && !sourceRelativePath.endsWith('.d.ts')
		? sourceRelativePath.slice(0, -'.ts'.length) + '.js'
		: sourceRelativePath;
}

function adjustEsmUrl(code: string): string {
	return code.replace(/\.ts(\?esm['"])/g, '.js$1');
}

function needsBomAdded(filePath: string): boolean {
	return /([\/\\])test\1.*utf8/.test(filePath);
}

async function isFile(filePath: string): Promise<boolean> {
	try {
		return (await fs.promises.stat(filePath)).isFile();
	} catch (error) {
		if (isPathMissing(error)) {
			return false;
		}
		throw error;
	}
}

async function isDirectory(filePath: string): Promise<boolean> {
	try {
		return (await fs.promises.stat(filePath)).isDirectory();
	} catch (error) {
		if (isPathMissing(error)) {
			return false;
		}
		throw error;
	}
}

function isPathMissing(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}
