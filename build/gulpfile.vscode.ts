/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { gulp, rename, replace, filter, jsonEditor } from './lib/gulp/facade.ts';
import * as fs from 'fs';
import * as path from 'path';
import es from 'event-stream';
import vfs from 'vinyl-fs';
import electron from '@vscode/gulp-electron';
import * as util from './lib/util.ts';
import * as compilation from './lib/compilation.ts';
import { getVersion } from './lib/getVersion.ts';
import { readISODate, writeISODate } from './lib/date.ts';
import * as task from './lib/gulp/task.ts';
import { inlineMeta } from './lib/inlineMeta.ts';
import { computeNLSMetadataHash } from './lib/nlsMetadata.ts';
import packageJson from '../package.json' with { type: 'json' };
import product from '../product.json' with { type: 'json' };
import * as crypto from 'crypto';
import * as cp from 'child_process';
import * as i18n from './lib/i18n.ts';
import { getProductionDependencies } from './lib/dependencies.ts';
import { config } from './lib/electron.ts';
import { createAsar } from './lib/asar.ts';
import minimist from 'minimist';
import { compileNonNativeExtensionsBuildTask, compileNativeExtensionsBuildTask, compileAllExtensionsBuildTask, compileExtensionMediaBuildTask, cleanExtensionsBuildTask } from './gulpfile.extensions.ts';
import { checkApiProposalNamesTask, copyCodiconsTask } from './lib/compilation.ts';
import { getDshNodePtyPayloadFilter, getDshRipgrepPayloadFilter, getRipgrepExcludeFilter } from './lib/ripgrep.ts';
import { ensureOSProxyResolverPlatformPackage, getOSProxyResolverExcludeFilter, getOSProxyResolverPlatformFiles } from './lib/osProxyResolver.ts';
import { promisify } from 'util';
import globCallback from 'glob';
import rceditCallback from 'rcedit';
import { spawnTsgo } from './lib/tsgo.ts';
import { runEsbuildTranspile, runEsbuildBundle, getBootstrapEntryPointsForTarget } from './lib/esbuild.ts';
import { generateNodeCompileCache, shouldGenerateNodeCompileCache } from './lib/nodeCompileCache.ts';
import { captureDshBuildProvenance, type DshBuildProvenance } from './lib/dshBuildProvenance.ts';
import { dedupeExtensionOutputs } from './lib/dsh/dedupeExtensionOutputs.ts';

const glob = promisify(globCallback);
const rcedit = promisify(rceditCallback);
const root = path.dirname(import.meta.dirname);
let commit = getVersion(root);
let sourceMappingURLBase = `https://main.vscode-cdn.net/sourcemaps/${commit}`;
const isCI = !!process.env['CI'] || !!process.env['BUILD_ARTIFACTSTAGINGDIRECTORY'] || !!process.env['GITHUB_WORKSPACE'];
const useCdnSourceMapsForPackagingTasks = isCI;

// （T11-03）原有 `dshManifestSourceRoot` / `dshResourcesRoot` 两个常量已删除：
// 它们是 §3.7 归位初期的中间产物，`dsh-ide-pack` 实际直接用 `path.join(buildRoot, ...)`
// 与 `path.join(root, 'resources', 'dsh')` 内联表达，两个常量全文件仅各 1 处引用（定义自身）。


task.task(task.define('core-ci', task.series(
	checkApiProposalNamesTask,
	copyCodiconsTask,
	compileNonNativeExtensionsBuildTask,
	compileExtensionMediaBuildTask,
	writeISODate('out-build'),
	// Type-check with tsgo (no emit)
	task.define('tsgo-typecheck', () => spawnTsgo(path.join(root, 'src', 'tsconfig.json'), { taskName: 'tsgo-typecheck', noEmit: true })),
	// Transpile individual files to out-build first (for unit tests)
	task.define('esbuild-out-build', () => runEsbuildTranspile('out-build', false)),
	// Then bundle for shipping (bundles also write NLS files to out-build)
	task.parallel(
		task.define('esbuild-vscode-min', () => runEsbuildBundle('out-vscode-min', true, true, 'desktop', `${sourceMappingURLBase}/core`)),
		task.define('esbuild-vscode-reh-min', () => runEsbuildBundle('out-vscode-reh-min', true, true, 'server', `${sourceMappingURLBase}/core`)),
	)
)));

/**
 * Compute checksums for some files.
 *
 * @param out The out folder to read the file from.
 * @param filenames The paths to compute a checksum for.
 * @return A map of paths to checksums.
 */
function computeChecksums(out: string, filenames: string[]): Record<string, string> {
	const result: Record<string, string> = {};
	filenames.forEach(function (filename) {
		const fullPath = path.join(process.cwd(), out, filename);
		result[filename] = computeChecksum(fullPath);
	});
	return result;
}

/**
 * Compute checksums for a file.
 *
 * @param filename The absolute path to a filename.
 * @return The checksum for `filename`.
 */
function computeChecksum(filename: string): string {
	const contents = fs.readFileSync(filename);

	const hash = crypto
		.createHash('sha256')
		.update(contents)
		.digest('base64')
		.replace(/=+$/, '');

	return hash;
}

function packageTask(platform: string, arch: string, sourceFolderName: string, destinationFolderName: string, _opts?: { stats?: boolean; appOnly?: boolean; stripSourceMaps?: boolean }) {
	// 是否剔除 `*.js.map` 由**任务**决定（minified 版本剔除、普通版本保留），不看 CI 环境：
	// 同一条命令在本地与 CI 必须产出同一形态的产物，否则不可复现、文档也无法如实描述。
	const stripSourceMaps = _opts?.stripSourceMaps ?? isCI;
	// 扁平化后 `root` 即仓库根：产物必须落在仓库内（历史实现写到仓库外的父目录，
	// 导致 `dsh-ide-pack` 的 staging 里 `runtime/app` 为空、tgz 只有 157 KB）。
	// 目标目录允许绝对路径（插件 staging 可用 `DSH_IDE_STAGING_ROOT` 指到别的盘）：
	// 绝对路径原样使用，相对路径才拼仓库根。
	const destination = path.isAbsolute(destinationFolderName) ? destinationFolderName : path.join(root, destinationFolderName);
	platform = platform || process.platform;

	const task = () => {
		const out = sourceFolderName;
		const versionedResourcesFolder = util.getVersionedResourcesFolder(platform, commit!);

		const checksums = computeChecksums(out, [
			'vs/base/parts/sandbox/electron-browser/preload.js',
			'vs/workbench/workbench.desktop.main.js',
			'vs/workbench/workbench.desktop.main.css',
			'vs/workbench/api/node/extensionHostProcess.js',
			'vs/code/electron-browser/workbench/workbench.html',
			'vs/code/electron-browser/workbench/workbench.js'
		]);

		const src = gulp.src(out + '/**', { base: '.' })
			.pipe(rename(function (path) { path.dirname = path.dirname!.replace(new RegExp('^' + out), 'out'); }))
			.pipe(util.setExecutableBit(['**/*.sh']));

		const platformSpecificBuiltInExtensionsExclusions = product.builtInExtensions.filter(ext => {
			if (!(ext as { platforms?: string[] }).platforms) {
				return false;
			}

			const set = new Set((ext as { platforms?: string[] }).platforms);
			return !set.has(platform);
		}).map(ext => `!.build/extensions/${ext.name}/**`);

		const extensions = gulp.src(['.build/extensions/**', ...platformSpecificBuiltInExtensionsExclusions], { base: '.build', dot: true });

		const sourceFilterPattern = stripSourceMaps
			? ['**', '!**/*.{js,css}.map']
			: ['**'];
		const sources = es.merge(src, extensions)
			.pipe(filter(sourceFilterPattern, { dot: true }));

		let version = packageJson.version;
		const quality = (product as { quality?: string }).quality;

		if (quality && quality !== 'stable') {
			version += '-' + quality;
		}

		const name = product.nameShort;
		const packageJsonUpdates: Record<string, unknown> = { name, version };

		if (platform === 'linux') {
			packageJsonUpdates.desktopName = `${product.applicationName}.desktop`;
		}

		let packageJsonContents: string;
		const packageJsonStream = gulp.src(['package.json'], { base: '.' })
			.pipe(jsonEditor(packageJsonUpdates))
			.pipe(es.through(function (file) {
				packageJsonContents = file.contents.toString();
				this.emit('data', file);
			}));

		let productJsonContents: string;
		const productJsonStream = gulp.src(['product.json'], { base: '.' })
			.pipe(jsonEditor((json: Record<string, unknown>) => {
				json.commit = commit;
				json.nlsMetadataHash = computeNLSMetadataHash(path.join(import.meta.dirname, '..', out), commit);
				json.date = readISODate(out);
				json.checksums = checksums;
				json.version = version;
				return json;
			}))
			.pipe(es.through(function (file) {
				productJsonContents = file.contents.toString();
				this.emit('data', file);
			}));

		const license = gulp.src([product.licenseFileName, 'ThirdPartyNotices.txt', 'licenses/**'], { base: '.', allowEmpty: true });

		// TODO the API should be copied to `out` during compile, not here
		const api = gulp.src('src/vscode-dts/vscode.d.ts').pipe(rename('out/vscode-dts/vscode.d.ts'));

		const telemetry = gulp.src('.build/telemetry/**', { base: '.build/telemetry', dot: true });

		const jsFilter = util.filter(data => !data.isDirectory() && /\.js$/.test(data.path));
		const root = path.resolve(path.join(import.meta.dirname, '..'));
		const productionDependencies = getProductionDependencies(root);
		const dependenciesSrc = productionDependencies.map(d => path.relative(root, d)).map(d => [`${d}/**`, `!${d}/**/{test,tests}/**`]).flat().concat('!**/*.mk');

		const depFilterPattern = ['**', `!**/${config.version}/**`, '!**/bin/darwin-arm64-87/**', '!**/package-lock.json', '!**/yarn.lock'];
		if (stripSourceMaps) {
			depFilterPattern.push('!**/*.{js,css}.map');
		}

		const cleanedDeps = gulp.src(dependenciesSrc, { base: '.', dot: true })
			.pipe(filter(depFilterPattern))
			.pipe(util.cleanNodeModules(path.join(import.meta.dirname, '.moduleignore')))
			.pipe(util.cleanNodeModules(path.join(import.meta.dirname, `.moduleignore.${process.platform}`)));
		ensureOSProxyResolverPlatformPackage(platform, arch);
		const osProxyResolverPlatformPackage = gulp.src(getOSProxyResolverPlatformFiles(platform, arch), { base: '.', dot: true, allowEmpty: true });
		const deps = es.merge(cleanedDeps, osProxyResolverPlatformPackage)
			.pipe(filter(['**', '!**/node_modules/@github/copilot/**', '!**/node_modules/@github/copilot-*/**', '!**/node_modules/@github/copilot-sdk/**', '!**/node_modules/@github/copilot-sdk-*/**']))
			.pipe(filter(getRipgrepExcludeFilter(platform, arch)))
			.pipe(filter(getOSProxyResolverExcludeFilter(platform, arch)))
			.pipe(jsFilter)
			.pipe(util.rewriteSourceMappingURL(sourceMappingURLBase))
			.pipe(jsFilter.restore)
			.pipe(createAsar(path.join(process.cwd(), 'node_modules'), [
				'**/*.node',
				'**/@vscode/ripgrep-universal/bin/**',
				'**/*.wasm',
				'**/@vscode/vsce-sign/bin/*',
			], [
				'**/*.mk',
			], [
				'node_modules/vsda/**', // retain copy of `vsda` in node_modules for internal use
				// The sandbox runtime is spawned as a standalone Node subprocess (no ASAR
				// resolution hook), so it and its transitive JS dependencies must remain as
				// real files under `node_modules`. Keep them duplicated out of the archive.
				'node_modules/@vscode/sandbox-runtime/**', // includes its nested `commander`
				'node_modules/@pondwader/socks5-server/**',
				'node_modules/shell-quote/**',
				'node_modules/zod/**'
			], 'node_modules.asar'));

		// 只裁 DSH Windows 插件的物理副本；扩展仍能通过原 ASAR 索引找到由 Host 物化的文件。
		const shippedDeps = _opts?.appOnly && platform === 'win32'
			? deps
				.pipe(filter(getDshRipgrepPayloadFilter(arch), { dot: true }))
				.pipe(filter(getDshNodePtyPayloadFilter(arch), { dot: true }))
			: deps;

		const mergeStreams = [
			packageJsonStream,
			productJsonStream,
			license,
			api,
			telemetry,
			sources,
			shippedDeps
		];
		let all = es.merge(...mergeStreams);

		// DSH ships the exact upstream app stream, before platform launchers or Electron wrapping.
		// Electron is supplied by the host at launch time; no executable is copied here.
		if (_opts?.appOnly) {
			// DSH-IDE：不要任何音频。音频都在 `out/` 下，`.moduleignore` 只管 `node_modules`，
			// 因此必须在这里过滤。两类都不影响功能：无障碍提示音由 `playSound()` 的 catch 兜底，
			// 语音试听（agentsVoice 引导页）在音频缺失时同样只是播不出声。
			return inlineMeta(all
				.pipe(util.skipDirectories())
				.pipe(util.fixWin32DirectoryPermissions())
				.pipe(filter(['**', '!**/.github/**', '!**/*.mp3'], { dot: true })), {
				targetPaths: getBootstrapEntryPointsForTarget('desktop').map(entry => `${entry}.js`),
				packageJsonFn: () => packageJsonContents,
				productJsonFn: () => productJsonContents
			}).pipe(vfs.dest(destination));
		}

		if (platform === 'win32') {
			all = es.merge(all, gulp.src([
				'resources/win32/bower.ico',
				'resources/win32/c.ico',
				'resources/win32/code.ico',
				'resources/win32/config.ico',
				'resources/win32/cpp.ico',
				'resources/win32/csharp.ico',
				'resources/win32/css.ico',
				'resources/win32/default.ico',
				'resources/win32/go.ico',
				'resources/win32/html.ico',
				'resources/win32/jade.ico',
				'resources/win32/java.ico',
				'resources/win32/javascript.ico',
				'resources/win32/json.ico',
				'resources/win32/less.ico',
				'resources/win32/markdown.ico',
				'resources/win32/php.ico',
				'resources/win32/powershell.ico',
				'resources/win32/python.ico',
				'resources/win32/react.ico',
				'resources/win32/ruby.ico',
				'resources/win32/sass.ico',
				'resources/win32/sessions.ico',
				'resources/win32/shell.ico',
				'resources/win32/sql.ico',
				'resources/win32/typescript.ico',
				'resources/win32/vue.ico',
				'resources/win32/xml.ico',
				'resources/win32/yaml.ico',
				'resources/win32/code_70x70.png',
				'resources/win32/code_150x150.png'
			], { base: '.' }));
		} else if (platform === 'linux') {
			const policyDest = gulp.src('.build/policies/linux/**', { base: '.build/policies/linux' })
				.pipe(rename(f => f.dirname = `policies/${f.dirname}`));
			all = es.merge(all, gulp.src('resources/linux/code.png', { base: '.' }), policyDest);
		} else if (platform === 'darwin') {
			const shortcut = gulp.src('resources/darwin/bin/code.sh')
				.pipe(replace('@@APPNAME@@', product.applicationName))
				.pipe(replace('@@NAME@@', product.nameShort))
				.pipe(rename('bin/code'));
			const policyDest = gulp.src('.build/policies/darwin/**', { base: '.build/policies/darwin' })
				.pipe(rename(f => f.dirname = `policies/${f.dirname}`));
			all = es.merge(all, shortcut, policyDest);
		}

		const electronConfig = {
			...config,
			platform,
			arch: arch === 'armhf' ? 'arm' : arch,
			ffmpegChromium: false
		};

		let result: NodeJS.ReadWriteStream = all
			.pipe(util.skipDirectories())
			.pipe(util.fixWin32DirectoryPermissions())
			.pipe(filter(['**', '!**/.github/**'], { dot: true })) // https://github.com/microsoft/vscode/issues/116523
			.pipe(electron(electronConfig))
			.pipe(filter([
				'**',
				'!LICENSE',
				'!version',
				...(platform === 'darwin' ? ['!**/Contents/Applications', '!**/Contents/Applications/**'] : []),
				...(platform === 'win32' ? ['!**/electron_proxy.exe'] : []),
			], { dot: true }));

		if (platform === 'linux') {
			result = es.merge(result, gulp.src('resources/completions/bash/code', { base: '.' })
				.pipe(replace('@@APPNAME@@', product.applicationName))
				.pipe(rename(function (f) { f.basename = product.applicationName; })));

			result = es.merge(result, gulp.src('resources/completions/zsh/_code', { base: '.' })
				.pipe(replace('@@APPNAME@@', product.applicationName))
				.pipe(rename(function (f) { f.basename = '_' + product.applicationName; })));
		}

		if (platform === 'win32') {
			result = es.merge(result, gulp.src('resources/win32/bin/code.js', { base: 'resources/win32', allowEmpty: true }));

			if (versionedResourcesFolder) {
				result = es.merge(result, gulp.src('resources/win32/versioned/bin/code.cmd', { base: 'resources/win32/versioned' })
					.pipe(replace('@@NAME@@', product.nameShort))
					.pipe(replace('@@VERSIONFOLDER@@', versionedResourcesFolder))
					.pipe(rename(function (f) { f.basename = product.applicationName; })));

				result = es.merge(result, gulp.src('resources/win32/versioned/bin/code.sh', { base: 'resources/win32/versioned' })
					.pipe(replace('@@NAME@@', product.nameShort))
					.pipe(replace('@@PRODNAME@@', product.nameLong))
					.pipe(replace('@@VERSION@@', version))
					.pipe(replace('@@COMMIT@@', String(commit)))
					.pipe(replace('@@APPNAME@@', product.applicationName))
					.pipe(replace('@@VERSIONFOLDER@@', versionedResourcesFolder))
					.pipe(replace('@@SERVERDATAFOLDER@@', product.serverDataFolderName || '.vscode-remote'))
					.pipe(replace('@@QUALITY@@', quality!))
					.pipe(rename(function (f) { f.basename = product.applicationName; f.extname = ''; })));
			} else {
				result = es.merge(result, gulp.src('resources/win32/bin/code.cmd', { base: 'resources/win32' })
					.pipe(replace('@@NAME@@', product.nameShort))
					.pipe(rename(function (f) { f.basename = product.applicationName; })));

				result = es.merge(result, gulp.src('resources/win32/bin/code.sh', { base: 'resources/win32' })
					.pipe(replace('@@NAME@@', product.nameShort))
					.pipe(replace('@@PRODNAME@@', product.nameLong))
					.pipe(replace('@@VERSION@@', version))
					.pipe(replace('@@COMMIT@@', String(commit)))
					.pipe(replace('@@APPNAME@@', product.applicationName))
					.pipe(replace('@@SERVERDATAFOLDER@@', product.serverDataFolderName || '.vscode-remote'))
					.pipe(replace('@@QUALITY@@', String(quality)))
					.pipe(rename(function (f) { f.basename = product.applicationName; f.extname = ''; })));
			}

			result = es.merge(result, gulp.src('resources/win32/VisualElementsManifest.xml', { base: 'resources/win32' })
				.pipe(replace('@@VERSIONFOLDER@@', versionedResourcesFolder ? `${versionedResourcesFolder}\\` : ''))
				.pipe(rename(product.nameShort + '.VisualElementsManifest.xml')));

			result = es.merge(result, gulp.src('.build/policies/win32/**', { base: '.build/policies/win32' })
				.pipe(rename(f => f.dirname = `policies/${f.dirname}`)));

			if (quality === 'stable' || quality === 'insider') {
				result = es.merge(result, gulp.src('.build/win32/appx/**', { base: '.build/win32' }));
				const rawVersion = version.replace(/-\w+$/, '').split('.');
				const appxVersion = `${rawVersion[0]}.0.${rawVersion[1]}.${rawVersion[2]}`;
				result = es.merge(result, gulp.src('resources/win32/appx/AppxManifest.xml', { base: '.' })
					.pipe(replace('@@AppxPackageName@@', product.win32AppUserModelId))
					.pipe(replace('@@AppxPackageVersion@@', appxVersion))
					.pipe(replace('@@AppxPackageDisplayName@@', product.nameLong))
					.pipe(replace('@@AppxPackageDescription@@', product.win32NameVersion))
					.pipe(replace('@@ApplicationIdShort@@', product.win32RegValueName))
					.pipe(replace('@@ApplicationExe@@', product.nameShort + '.exe'))
					.pipe(replace('@@FileExplorerContextMenuID@@', quality === 'stable' ? 'OpenWithCode' : 'OpenWithCodeInsiders'))
					.pipe(replace('@@FileExplorerContextMenuCLSID@@', (product as { win32ContextMenu?: Record<string, { clsid: string }> }).win32ContextMenu![arch].clsid))
					.pipe(replace('@@FileExplorerContextMenuDLL@@', `${quality === 'stable' ? 'code' : 'code_insider'}_explorer_command_${arch}.dll`))
					.pipe(rename(f => f.dirname = `appx/manifest`)));
			}
		} else if (platform === 'linux') {
			result = es.merge(result, gulp.src('resources/linux/bin/code.sh', { base: '.' })
				.pipe(replace('@@PRODNAME@@', product.nameLong))
				.pipe(replace('@@APPNAME@@', product.applicationName))
				.pipe(rename('bin/' + product.applicationName)));
		}

		result = inlineMeta(result, {
			targetPaths: getBootstrapEntryPointsForTarget('desktop').map(entry => `${entry}.js`),
			packageJsonFn: () => packageJsonContents,
			productJsonFn: () => productJsonContents
		});

		return result.pipe(vfs.dest(destination));
	};
	task.taskName = `package-${platform}-${arch}`;
	return task;
}

function hasAuthenticodeSignature(filePath: string): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const proc = cp.spawn('signtool.exe', ['verify', '/pa', filePath]);
		proc.on('error', reject);
		proc.on('exit', code => resolve(code === 0));
	});
}

async function stripAuthenticodeSignature(filePath: string): Promise<void> {
	// ESRP's `signtool /as` (append) fails with 0x800700C1 on PEs whose existing
	// Authenticode signature was invalidated by rcedit. Strip cleanly first so
	// rcedit operates on an unsigned PE.
	if (!await hasAuthenticodeSignature(filePath)) {
		return;
	}
	await new Promise<void>((resolve, reject) => {
		const proc = cp.spawn('signtool.exe', ['remove', '/s', filePath]);
		let out = '';
		proc.stdout?.on('data', chunk => out += chunk.toString());
		proc.stderr?.on('data', chunk => out += chunk.toString());
		proc.on('error', reject);
		proc.on('exit', code => {
			if (code === 0) {
				resolve();
			} else {
				process.stderr.write(out);
				reject(new Error(`signtool remove /s failed for ${filePath} (exit ${code})`));
			}
		});
	});
}

function patchWin32DependenciesTask(destinationFolderName: string) {
	const cwd = path.join(root, destinationFolderName);

	return async () => {
		const versionedResourcesFolder = util.getVersionedResourcesFolder('win32', commit!);
		const deps = (await Promise.all([
			glob('**/*.node', { cwd, ignore: 'extensions/node_modules/@parcel/watcher/**' }),
			glob('**/rg.exe', { cwd }),
			glob('**/tgrep.exe', { cwd }),
			glob('**/*explorer_command*.dll', { cwd }),
			// TODO@anthonykim1 Remove once @github/copilot ships OneAuthInterop.dll with complete version information.
			glob('**/OneAuthInterop.dll', { cwd }),
		])).flatMap(o => o);
		const packageJson = JSON.parse(await fs.promises.readFile(path.join(cwd, versionedResourcesFolder, 'resources', 'app', 'package.json'), 'utf8'));
		const product = JSON.parse(await fs.promises.readFile(path.join(cwd, versionedResourcesFolder, 'resources', 'app', 'product.json'), 'utf8'));
		const baseVersion = packageJson.version.replace(/-.*$/, '');

		const patchPromises = deps.map<Promise<unknown>>(async dep => {
			const basename = path.basename(dep);
			const fullPath = path.join(cwd, dep);

			await stripAuthenticodeSignature(fullPath);
			await rcedit(fullPath, {
				'file-version': baseVersion,
				'version-string': {
					'CompanyName': 'Microsoft Corporation',
					'FileDescription': product.nameLong,
					'FileVersion': packageJson.version,
					'InternalName': basename,
					'LegalCopyright': 'Copyright (C) 2026 Microsoft. All rights reserved',
					'OriginalFilename': basename,
					'ProductName': product.nameLong,
					'ProductVersion': packageJson.version,
				}
			});
		});

		await Promise.all(patchPromises);
	};
}

function generateNodeCompileCacheTask(platform: string, destinationFolderName: string) {
	const outputDirectory = path.join(root, destinationFolderName);

	return () => generateNodeCompileCache(
		platform,
		outputDirectory,
		util.getVersionedResourcesFolder(platform, commit!),
		product
	);
}

// 仓库已扁平化（README §1）：`root` 就是仓库根，`buildRoot` 不能再取父目录，
// 否则 dist/ 与 staging 会写到仓库外的上一级（历史实测产物落到了 E:\dist）。
const buildRoot = root;
let dshBuildProvenance: DshBuildProvenance | undefined;

async function prepareDshBuildProvenance(): Promise<void> {
	dshBuildProvenance = captureDshBuildProvenance(root, process.env['BUILD_SOURCEVERSION']);
	commit = dshBuildProvenance.sourceCommit;
	process.env['BUILD_SOURCEVERSION'] = commit;
	sourceMappingURLBase = `https://main.vscode-cdn.net/sourcemaps/${commit}`;
}

async function verifyDshBuildProvenance(stagingRoot: string): Promise<void> {
	if (!dshBuildProvenance) {
		throw new Error('DSH build provenance was not initialized.');
	}
	const after = captureDshBuildProvenance(root, dshBuildProvenance.sourceCommit);
	if (JSON.stringify(after) !== JSON.stringify(dshBuildProvenance)) {
		throw new Error('DSH build inputs changed during the build; discard the staging output and rebuild.');
	}
	// `stagingRoot` 可能是绝对路径（`DSH_IDE_STAGING_ROOT` 指到别的盘）：绝对路径原样使用，
	// 否则会拼出 `E:\DSH-IDE\E:\DSH-IDE\dist\…` 这种不存在的路径。
	const runtimeDirectory = path.join(path.isAbsolute(stagingRoot) ? stagingRoot : path.join(buildRoot, stagingRoot), 'runtime');
	await fs.promises.mkdir(runtimeDirectory, { recursive: true });
	await fs.promises.writeFile(path.join(runtimeDirectory, 'build-provenance.json'), JSON.stringify({
		...dshBuildProvenance,
		workingTreeDigestScope: 'Only allowlisted non-secret source inputs; ignored dependencies, generated outputs and sensitive paths are not fingerprinted.',
	}, null, '\t') + '\n');
}

/**
 * 把 DSH 的鲸鱼图标写进每个 bundle 输出的 media 目录。
 * globalCompositeBar.ts 与 chatParticipant.contribution.ts 用 FileAccess.asBrowserUri
 * 指向它；它不在 bundle 的 copyResources 精选 glob 内，必须 bundle 后补写。
 * 聊天内容由 `dshChatSessionContent` 的 content provider 提供 history，不再有 sidecar 产物。
 */
/**
 * 编译 DSH-IDE 插件层需要的 `out/`。
 *
 * 为什么必须显式做：`dsh-ide-pack` 从 `out/vs/platform/dshClient` 拷 index.js / client.js /
 * host/**，而 `out/` 是 gitignore 的生成目录。不先编译时：干净检出直接 ENOENT；
 * 存在旧 `out/` 时会把上一版代码静默打进 tgz（源码改了、产物没变）。
 * 用官方 `compilation.transpileTask`（与 `gulp transpile-client` 同一实现），不另写编译流程。
 */
/**
 * 把 tsc 产出的 CommonJS 模块就地改写成 ESM。
 *
 * 只覆盖 `transpileTask` 实际产生的形态：`"use strict";` 开头、`exports.X = void 0;` 前置声明、
 * `exports.X = Y;` 赋值、`exports.X = X;` 再导出。够用即可，不做通用转换——
 * 真要做通用转换应改用 esbuild，但它的临时目录在 Windows 上清理会失败。
 * @param {string} source tsc 产物内容
 */
function cjsToEsm(source) {
	const exported = new Set();
	let out = source
		// `"use strict";` 在 ESM 里是空操作，但 `exports` 引用会直接报错，先删。
		.replace(/^"use strict";\r?\n/, '')
		// `Object.defineProperty(exports, "__esModule", { value: true });` 无意义。
		.replace(/^Object\.defineProperty\(exports, "__esModule", \{ value: true \}\);\r?\n/m, '');
	// 前置声明：`exports.A = exports.B = void 0;`（可能多行）
	out = out.replace(/^exports\.[\w$]+(?: = exports\.[\w$]+)* = void 0;\r?\n/gm, '');
	// 赋值导出：`exports.X = <expr>;` → `const X = <expr>;`
	out = out.replace(/^exports\.([\w$]+) = /gm, (_m, name) => {
		exported.add(name);
		return `const ${name} = `;
	});
	// `exports.X = X;`（同名再导出）已经在上一步变成 `const X = X;`，删掉这行自赋值。
	for (const name of exported) {
		out = out.replace(new RegExp(`^const ${name} = ${name};\\r?\\n`, 'gm'), '');
	}
	// tsc 在函数体里写 `exports.X`（例如 wireRevision 比较、视图绑定方法表）。
	// 赋值行改成 const 之后这些引用仍指向不存在的 `exports`，一调用就抛
	// `exports is not defined`。会话列表的 listSessions 正是走这条校验。
	for (const name of [...exported].sort((a, b) => b.length - a.length)) {
		out = out.replace(new RegExp(`\\bexports\\.${name}\\b`, 'g'), name);
	}
	// 末尾补导出表。名字必须排序后稳定输出，避免每次打包产生无意义 diff。
	out = out.trimEnd() + '\n\nexport { ' + [...exported].sort().join(', ') + ' };\n';
	return out;
}

const compileDshPluginLayerTask = task.define('dsh-ide-compile-plugin-layer',
	task.series(util.rimraf('out'), compilation.transpileTask('src', 'out')));
const dshWhaleMediaSource = path.join(root, 'src', 'vs', 'workbench', 'contrib', 'dsh', 'browser', 'media', 'dsh-whale.svg');
const dshWhaleMediaTargetPath = path.join('vs', 'workbench', 'contrib', 'dsh', 'browser', 'media');
const DSH_MEDIA_OUTPUT_DIRS = ['out-build', 'out', 'out-vscode', 'out-vscode-min'];

const prepareDshChatRenderTask = task.define('prepare-dsh-chat-render', async () => {
	let staged = 0;
	for (const outDirName of DSH_MEDIA_OUTPUT_DIRS) {
		const outDir = path.join(root, outDirName);
		if (!fs.existsSync(outDir)) {
			continue;
		}
		const mediaTarget = path.join(outDir, dshWhaleMediaTargetPath);
		await fs.promises.mkdir(mediaTarget, { recursive: true });
		await fs.promises.copyFile(dshWhaleMediaSource, path.join(mediaTarget, 'dsh-whale.svg'));
		staged++;
	}
	console.log(`[dsh-chat-render] dsh-whale.svg staged into ${staged} bundle output(s): ${DSH_MEDIA_OUTPUT_DIRS.join(', ')}`);
});

const BUILD_TARGETS = [
	{ platform: 'win32', arch: 'x64' },	{ platform: 'win32', arch: 'arm64' },
	{ platform: 'darwin', arch: 'x64', opts: { stats: true } },
	{ platform: 'darwin', arch: 'arm64', opts: { stats: true } },
	{ platform: 'linux', arch: 'x64' },
	{ platform: 'linux', arch: 'armhf' },
	{ platform: 'linux', arch: 'arm64' },
];
BUILD_TARGETS.forEach(buildTarget => {
	const dashed = (str: string) => (str ? `-${str}` : ``);
	const platform = buildTarget.platform;
	const arch = buildTarget.arch;
	const opts = buildTarget.opts;

	const [vscode, vscodeMin] = ['', 'min'].map(minified => {
		const sourceFolderName = `out-vscode${dashed(minified)}`;
		const destinationFolderName = `VSCode${dashed(platform)}${dashed(arch)}`;

		const packageTasks: task.Task[] = [
			compileNativeExtensionsBuildTask,
			util.rimraf(path.join(buildRoot, destinationFolderName)),
			packageTask(platform, arch, sourceFolderName, destinationFolderName, opts)
		];

		if (platform === 'win32') {
			packageTasks.push(patchWin32DependenciesTask(destinationFolderName));
		}
		if (shouldGenerateNodeCompileCache(platform, arch, product)) {
			packageTasks.push(generateNodeCompileCacheTask(platform, destinationFolderName));
		}

		const vscodeTaskCI = task.define(`vscode${dashed(platform)}${dashed(arch)}${dashed(minified)}-ci`, task.series(...packageTasks));
		task.task(vscodeTaskCI);

		const esbuildBundleTask = task.define(
			`esbuild-bundle${dashed(platform)}${dashed(arch)}${dashed(minified)}`,
			() => runEsbuildBundle(
				sourceFolderName,
				!!minified,
				true,
				'desktop',
				minified && useCdnSourceMapsForPackagingTasks ? `${sourceMappingURLBase}/core` : undefined
			)
		);
		// 暂存根可由 `DSH_IDE_STAGING_ROOT` 覆盖：Windows 上 Defender 实时保护会长时间占用
		// `node_modules.asar`，导致 rimraf 失败；指向别处即可绕开，默认仍是仓库内 `dist`。
		// 绝对路径必须原样使用：以前无条件 `path.join(buildRoot, appStagingRoot)` 会把它当相对段，
		// 拼出 `E:\DSH-IDE\D:\staging\…` 这种不存在的路径，覆盖功能等于不可用。
		const stagingRootOption = process.env['DSH_IDE_STAGING_ROOT'];
		const appStagingRoot = path.isAbsolute(stagingRootOption ?? '')
			? path.join(stagingRootOption!, '.dsh-ide-staging', `${platform}-${arch}`)
			: path.join(stagingRootOption ?? 'dist', '.dsh-ide-staging', `${platform}-${arch}`);
		// 只有相对路径才需要拼仓库根；绝对路径直接用它自己（下面所有使用点统一走这里）。
		const appStagingPath = path.isAbsolute(appStagingRoot) ? appStagingRoot : path.join(buildRoot, appStagingRoot);
		const appDestination = path.join(appStagingPath, 'runtime', 'app');
		const packageAppTask = task.series(
			compileNativeExtensionsBuildTask,
			util.rimraf(appDestination),
			// 插件载荷固定按 minified 口径剔除 source map：`dsh-ide-pack` 只产出发布形态。
			packageTask(platform, arch, sourceFolderName, appDestination, { ...opts, appOnly: true, stripSourceMaps: true })
		);
		const appTaskCI = task.define(`dsh-ide-${platform}-${arch}${dashed(minified)}-ci`, task.series(
			prepareDshBuildProvenance,
			prepareDshChatRenderTask,
			packageAppTask,
			() => verifyDshBuildProvenance(appStagingPath)
		));
		task.task(appTaskCI);
		const appTask = task.define(`dsh-ide-${platform}-${arch}${dashed(minified)}`, task.series(
			prepareDshBuildProvenance,
			// 插件层（index.js / client.js / host/**）是从 `out/vs/platform/dshClient` 拷的，
			// 而 `out/` 是 gitignore 的生成目录：不先编译，干净检出会 ENOENT；有旧 `out/` 时
			// 更糟——会把上一版代码静默打进新 tgz（真机前踩过：插件层与源码不一致）。
			// 这里显式把 `src → out` 作为打包的前置步骤，产物永远与源码同源。
			compileDshPluginLayerTask,
			util.rimraf(appStagingPath),
			copyCodiconsTask,
			cleanExtensionsBuildTask,
			compileNonNativeExtensionsBuildTask,
			compileExtensionMediaBuildTask,
			writeISODate('out-build'),
			esbuildBundleTask,
			prepareDshChatRenderTask,
			packageAppTask,
			() => verifyDshBuildProvenance(appStagingPath)
		));
		task.task(appTask);
		// 只产出 minified 载荷：标准构建（保留 *.js.map）已移除——source map 占安装后体积的 41%，
		// 对插件分发没有收益。`dsh-ide-pack` 与 `dsh-ide-pack-min` 都指向同一套 minified staging，
		// 保留旧名字只为不打断既有脚本与文档引用。
		if (process.platform === platform && process.arch === arch && minified) {
			const dshIdePackTask = task.define('dsh-ide-pack', task.series(appTask, async () => {
				const stagingRoot = appStagingPath;
				// Electron 在 package.json 没有 main 时去加载 resources/app/index.js。
				// 本仓库的载荷 package.json 没有 main，窗口会报 ERR_MODULE_NOT_FOUND。
				// 真正的入口是 vscode 的 out/main.js。
				const appPackagePath = path.join(stagingRoot, 'runtime', 'app', 'package.json');
				const appPackage = JSON.parse(await fs.promises.readFile(appPackagePath, 'utf8')) as { main?: string };
				if (appPackage.main !== './out/main.js') {
					appPackage.main = './out/main.js';
					await fs.promises.writeFile(appPackagePath, JSON.stringify(appPackage, null, 2) + '\n');
				}
				// bundle 根清单由官方构建生成（§3.7：不再手维护 dsh-ide/ 目录）：
				//   manifest 模板 + patch  ← build/lib/dsh/
				//   icon + NLS locale      ← resources/dsh/
				//   Host 入口与客户端半身   ← out/vs/platform/dshClient/
				const manifestSource = path.join(root, 'build', 'lib', 'dsh');
				const dshResources = path.join(root, 'resources', 'dsh');
				const dshClientOut = path.join(root, 'out', 'vs', 'platform', 'dshClient');
				const pkg = JSON.parse(await fs.promises.readFile(path.join(manifestSource, 'package.json'), 'utf8')) as { files: string[] };
				const copyList: readonly [string, string][] = [
					[path.join(manifestSource, 'package.json'), 'package.json'],
					[path.join(manifestSource, 'cordis.patch.yml'), 'cordis.patch.yml'],
					[path.join(dshResources, 'icon.svg'), 'icon.svg'],
					[path.join(dshResources, 'locale'), 'locale'],
					// 插件页详情文档与唯一的特性图；`meta.detail` 在两条语言里都指向这里。
					[path.join(dshResources, 'docs'), 'docs'],
					[path.join(dshClientOut, 'index.js'), 'index.js'],
					[path.join(dshClientOut, 'client', 'client.js'), 'client.js'],
					// host/ 整目录：launch（开窗）、usecase（远程服务）、bridge（会话桥）。
					[path.join(dshClientOut, 'host'), 'host'],
					// common/ 是 Host 运行时路径，不是协议。协议在 protocol/，和源码里的相对引用一致。
					[path.join(dshClientOut, 'common', 'env.js'), path.join('common', 'env.js')],
					[path.join(dshClientOut, 'common', 'dshLocations.js'), path.join('common', 'dshLocations.js')],
					[path.join(dshClientOut, 'common', 'dshThemePreference.js'), path.join('common', 'dshThemePreference.js')],
					[path.join(dshClientOut, 'common', 'dshLanguagePreference.js'), path.join('common', 'dshLanguagePreference.js')],
					[path.join(dshClientOut, 'common', 'dshLanguagePacks.js'), path.join('common', 'dshLanguagePacks.js')],
					[path.join(dshClientOut, 'common', 'dshI18n.zh-cn.json'), path.join('common', 'dshI18n.zh-cn.json')],
					[path.join(dshClientOut, 'protocol', 'dshIdeAuthRedaction.js'), path.join('protocol', 'dshIdeAuthRedaction.js')],
					[path.join(dshClientOut, 'protocol', 'dshIdeSessionList.js'), path.join('protocol', 'dshIdeSessionList.js')],
					[path.join(dshClientOut, 'protocol', 'dshIdeCommandList.js'), path.join('protocol', 'dshIdeCommandList.js')],
					[path.join(dshClientOut, 'protocol', 'dshIdeCommandLine.js'), path.join('protocol', 'dshIdeCommandLine.js')],
					[path.join(dshClientOut, 'protocol', 'dshIdeArchiveSet.js'), path.join('protocol', 'dshIdeArchiveSet.js')],
					[path.join(dshClientOut, 'protocol', 'dshIdeSessionSearch.js'), path.join('protocol', 'dshIdeSessionSearch.js')],
					[path.join(dshClientOut, 'protocol', 'dshIdeComposer.js'), path.join('protocol', 'dshIdeComposer.js')],
					[path.join(dshClientOut, 'protocol', 'dshIdeWaterfallNotice.js'), path.join('protocol', 'dshIdeWaterfallNotice.js')],
					[path.join(dshClientOut, 'protocol', 'dshIdeRequestView.js'), path.join('protocol', 'dshIdeRequestView.js')],
					[path.join(dshClientOut, 'protocol', 'dshIdeProtocol.js'), path.join('protocol', 'dshIdeProtocol.js')],
				];
				for (const [from, to] of copyList) {
					await fs.promises.cp(from, path.join(stagingRoot, to), { recursive: true });
				}
				// `common/` 下有两类文件：手写 ESM（env.js / dshIdeComposer.js 等）与
				// `transpileTask`（tsc）编译出的 CommonJS（dshIdeProtocol.js / dshIdeWaterfallNotice.js）。
				// 包根声明 `"type": "module"`，Node 会把后者也当 ESM 加载并报
				// `exports is not defined in ES module scope`，Host 半身装载失败。
				//
				// 不能给整个目录加 `type: commonjs`（会破坏前者），也不改文件名（Host 侧
				// 的 `import … from '../common/dshIdeProtocol.js'` 与开发期 `out/` 都要能跑）。
				// 因此在 staging 时把这两份 CJS 产物**就地改写成 ESM**：
				// `exports.X = void 0;` 这类前置声明删除，`exports.X = Y` 改成 `const X = Y`，
				// 末尾补 `export { … }`。改动只发生在打包产物里，源码与 `out/` 不动。
				for (const name of ['dshIdeProtocol', 'dshIdeWaterfallNotice']) {
					const target = path.join(stagingRoot, 'protocol', `${name}.js`);
					if (!fs.existsSync(target)) {
						continue;
					}
					await fs.promises.writeFile(target, cjsToEsm(await fs.promises.readFile(target, 'utf8')), 'utf8');
				}
				// §5 复用凭据随包保留；聊天内容已由 `dshChatSessionContent` 的 content provider 提供
				// history，不再有需要随包分发的 sidecar 渲染制品。
				for (const [from, to] of [
					['build/lib/dsh/PROVENANCE.md', 'PROVENANCE.md'],
					['build/lib/dsh/LICENSE-DSH', 'LICENSE-DSH'],
				] as const) {
					await fs.promises.copyFile(path.join(root, from), path.join(stagingRoot, to));
				}
				// 扩展产物去重：mermaid 为 Markdown 预览与 Notebook 各打一次包，
				// 两个输出目录除入口外字节完全相同；保留一份、改写入口相对引用。
				const dedupe = dedupeExtensionOutputs(path.join(stagingRoot, 'runtime', 'app', 'extensions'));
				if (dedupe.removed > 0) {
					console.log(`[dsh-ide-pack] dedupe: removed ${dedupe.removed} duplicate extension files, freed ${(dedupe.freedBytes / 1048576).toFixed(2)} MiB`);
				}
				// D55：运行期才写入的端点文件（内含一次性 query token）绝不能随包分发。
				// 若构建机上残留了旧文件，直接删掉并记入 staging 清单校验之前。
				await fs.promises.rm(path.join(stagingRoot, 'runtime', 'host-endpoint.json'), { force: true });
				// 声明式自校验：模板 files 白名单里的每一项都必须真的在 staging 根出现，
				// 否则 npm pack 会静默产出缺文件的包（旧实现就漏过部分入口）。
				// 含 glob 的条目（如 `locale/*.json`）校验其非通配前缀目录存在且至少匹配一个文件。
				const missing: string[] = [];
				for (const entry of pkg.files) {
					const normalized = entry.replace(/\/$/, '');
					if (/[*?[\]]/.test(normalized)) {
						const prefix = normalized.split(/[*?[\]]/)[0].replace(/[^/]*$/, '');
						const baseDir = path.join(stagingRoot, prefix || '.');
						const suffix = normalized.slice(prefix.length);
						const ext = suffix.startsWith('*.') ? suffix.slice(1) : '';
						const hasMatch = fs.existsSync(baseDir) && fs.readdirSync(baseDir).some(name => ext ? name.endsWith(ext) : true);
						if (!hasMatch) {
							missing.push(entry);
						}
						continue;
					}
					if (!fs.existsSync(path.join(stagingRoot, normalized))) {
						missing.push(entry);
					}
				}
				if (missing.length > 0) {
					throw new Error(`dsh-ide staging is missing manifest files entries: ${missing.join(', ')}`);
				}
				await verifyDshBuildProvenance(appStagingPath);
				const dist = path.join(buildRoot, 'dist');
				await fs.promises.mkdir(dist, { recursive: true });
				const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
				const pack = cp.spawnSync(npmCommand, ['pack', '--pack-destination', dist], { cwd: stagingRoot, stdio: 'inherit', shell: process.platform === 'win32' });
				if (pack.error || pack.status !== 0) {
					throw new Error(`npm pack failed for ${stagingRoot}: ${pack.error?.message ?? `status ${pack.status}`}`);
				}
			}));
			task.task(dshIdePackTask);
			// 旧名字保留为别名，既有脚本与文档无需改动。
			task.task(task.define('dsh-ide-pack-min', task.series(dshIdePackTask)));
		}
		if (process.platform === platform && process.arch === arch) {
			task.task(task.define(`dsh-ide-app${dashed(minified)}`, task.series(appTask)));
			task.task(task.define(`dsh-ide-app${dashed(minified)}-ci`, task.series(appTaskCI)));
		}

		const vscodeTask = task.define(`vscode${dashed(platform)}${dashed(arch)}${dashed(minified)}`, task.series(
			copyCodiconsTask,
			cleanExtensionsBuildTask,
			compileNonNativeExtensionsBuildTask,
			compileExtensionMediaBuildTask,
			writeISODate('out-build'),
			esbuildBundleTask,
			vscodeTaskCI
		));
		task.task(vscodeTask);

		return vscodeTask;
	});

	if (process.platform === platform && process.arch === arch) {
		task.task(task.define('vscode', task.series(vscode)));
		task.task(task.define('vscode-min', task.series(vscodeMin)));
	}
});

// #region nls

task.task(task.define(
	'vscode-translations-export',
	task.series(
		task.task('core-ci') as task.Task,
		compileAllExtensionsBuildTask,
		function () {
			const pathToMetadata = './out-build/nls.metadata.json';
			const pathToExtensions = '.build/extensions/*';
			const pathToSetup = 'build/win32/i18n/messages.en.isl';

			return es.merge(
				gulp.src(pathToMetadata).pipe(i18n.createXlfFilesForCoreBundle()),
				gulp.src(pathToSetup).pipe(i18n.createXlfFilesForIsl()),
				gulp.src(pathToExtensions).pipe(i18n.createXlfFilesForExtensions())
			).pipe(vfs.dest('../vscode-translations-export'));
		}
	)
));

task.task('vscode-translations-import', function () {
	const options = minimist(process.argv.slice(2), {
		string: 'location',
		default: {
			location: '../vscode-translations-import'
		}
	});
	return es.merge([...i18n.defaultLanguages, ...i18n.extraLanguages].map(language => {
		const id = language.id;
		return gulp.src(`${options.location}/${id}/vscode-setup/messages.xlf`)
			.pipe(i18n.prepareIslFiles(language))
			.pipe(vfs.dest(`./build/win32/i18n`));
	}));
});

// #endregion
