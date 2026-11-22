/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import * as ts from 'typescript';

// 仓库已扁平化（README §1）：仓库根即项目根，原 vscode-1.143.1/ 子目录不存在。
const repoRoot = path.resolve(import.meta.dirname, '../../..');
const vscodeRoot = repoRoot;

/** 取一个 `const NAME = [ ... ];` 数组字面量的源码（到匹配的 `];` 为止）。 */
function gulpArrayBody(source: string, declaration: string): string {
	const start = source.indexOf(declaration);
	assert.ok(start > 0, `${declaration} not found`);
	const open = source.indexOf('[', start);
	assert.ok(open > 0, `${declaration} has no array literal`);
	const end = source.indexOf('];', open);
	assert.ok(end > open, `${declaration} array is not terminated`);
	return source.slice(open, end);
}

/**
 * 取 `const NAME = task.define(..., task.series( ... ));` 里 **task.series 的完整实参**。
 *
 * 不能用 `slice(start, start + N)`：固定窗口会跨过本任务、命中下一个任务的
 * `...dshIdeBuildPrerequisites`，于是「CI 任务漏了共享前置」这种真实分叉抓不到
 * （2026-11-23 反向验证实测：按固定窗口写的断言对还原后的分叉体仍然通过）。
 */
function gulpTaskSeriesArgs(source: string, taskName: string): string {
	const start = source.indexOf(`const ${taskName} = task.define(`);
	assert.ok(start > 0, `${taskName} definition not found`);
	const series = source.indexOf('task.series(', start);
	assert.ok(series > start, `${taskName} has no task.series(`);
	const open = source.indexOf('(', series);
	let depth = 0;
	for (let i = open; i < source.length; i++) {
		const ch = source[i];
		if (ch === '(') {
			depth++;
		} else if (ch === ')') {
			depth--;
			if (depth === 0) {
				return source.slice(open, i + 1);
			}
		}
	}
	assert.fail(`${taskName} task.series( is not terminated`);
}

function readGulpfile(): ts.SourceFile {
	return ts.createSourceFile('gulpfile.vscode.ts', fs.readFileSync(path.join(vscodeRoot, 'build/gulpfile.vscode.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
}

/** 任务名是字符串，或 `minified ? 'dsh-ide-pack-min' : 'dsh-ide-pack'` 这种条件表达式。 */
function packNameMentions(node: ts.Node, name: string): boolean {
	if (ts.isStringLiteral(node)) {
		return node.text === name;
	}
	let found = false;
	ts.forEachChild(node, child => {
		if (packNameMentions(child, name)) {
			found = true;
		}
	});
	return found;
}

/** Every string literal inside the `dsh-ide-pack` task body. */
function dshPackLiterals(): string[] {
	const source = readGulpfile();
	const literals: string[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
			&& node.expression.name.text === 'define'
			&& node.arguments.length >= 1 && packNameMentions(node.arguments[0], 'dsh-ide-pack')) {
			assert.equal(node.arguments.length, 2, 'dsh-ide-pack must be defined with (name, body)');
			const collect = (n: ts.Node): void => {
				if (ts.isStringLiteral(n)) { literals.push(n.text); }
				ts.forEachChild(n, collect);
			};
			collect(node.arguments[1]);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return literals;
}

/**
 * §3.7：bundle 根目录由官方 gulp 在 staging 根**生成**，不再有手维护的 dsh-ide/ 目录。
 * 本套件守护三件事：原生位置存在、staging 清单覆盖 manifest files 白名单、渲染制品从新位置现编。
 */
test('DSH bundle: source tree has no standalone dsh-ide/ directory', () => {
	assert.equal(fs.existsSync(path.join(repoRoot, 'dsh-ide')), false, 'dsh-ide/ must not exist (§3.7 D1\')');
});

test('DSH bundle: host/client/manifest/icon live at their native positions', () => {
	const expected = [
		'build/lib/dsh/package.json',
		'build/lib/dsh/cordis.patch.yml',
		// §5 凭据保留：sidecar 删除后 PROVENANCE/LICENSE 迁到 build/lib/dsh/。
		'build/lib/dsh/PROVENANCE.md',
		'build/lib/dsh/LICENSE-DSH',
		'resources/dsh/icon.svg',
		'resources/dsh/locale/en.json',
		'resources/dsh/locale/zh.json',
		'resources/dsh/locale/ja.json',
		'resources/dsh/locale/es.json',
		'resources/dsh/locale/fr.json',
		'resources/dsh/locale/de.json',
		'resources/dsh/locale/ru.json',
		'resources/dsh/locale/pt.json',
		'src/vs/platform/dshClient/index.js',
		'src/vs/platform/dshClient/client/client.js',
		'src/vs/platform/dshClient/host/usecase/ide-service.js',
		'src/vs/platform/dshClient/common/env.js',
		// P1：协议真源与版本契约（单一真源，二者必须存在于原生位置）。
		'src/vs/platform/dshClient/protocol/dshIdeProtocol.ts',
		'src/vs/platform/dshClient/protocol/dshIdeContract.ts',
		'src/vs/platform/dshClient/ide/main/dshIdeChannel.ts',
		'src/vs/platform/dshClient/ide/main/ide-view-service.ts',
		// 旧连接层/聊天文件已整删，不再列入（协议耦合的 renderer 侧实现与事件映射）。
	];
	for (const relative of expected) {
		assert.ok(fs.existsSync(path.join(vscodeRoot, relative)), `missing native source: ${relative}`);
	}
});

test('DSH bundle: dsh-ide-pack stages host entries from out/ and manifest/icon from their sources', () => {
	const literals = dshPackLiterals();
	assert.ok(literals.length > 0, 'dsh-ide-pack task body not found');
	const gulpSource = fs.readFileSync(path.join(vscodeRoot, 'build/gulpfile.vscode.ts'), 'utf8');
	// 只发布 minified 载荷：source map 占安装后体积 41%，对插件分发没有收益。
	// `dsh-ide-pack` 指向 minified staging，`dsh-ide-pack-min` 保留为别名。
	assert.match(gulpSource, /task\.define\('dsh-ide-pack', task\.series\(appTask/, 'dsh-ide-pack must build the minified payload');
	assert.match(gulpSource, /task\.define\('dsh-ide-pack-min', task\.series\(dshIdePackTask\)\)/, 'dsh-ide-pack-min must remain as an alias');
	for (const needle of ['index.js', 'client.js', 'host', 'common', 'package.json', 'cordis.patch.yml', 'icon.svg', 'locale', 'PROVENANCE.md', 'LICENSE-DSH']) {
		assert.ok(literals.includes(needle), `dsh-ide-pack must stage ${needle}`);
	}
	const gulp = fs.readFileSync(path.join(vscodeRoot, 'build/gulpfile.vscode.ts'), 'utf8');
	// T11-03：两个中间常量已删除，改为断言**实际来源路径**内联出现在任务体里
	// （`dsh-ide-pack` 直接 path.join 到 build/lib/dsh 与 resources/dsh）。
	assert.match(gulp, /path\.join\([^)]*'build',\s*'lib',\s*'dsh'\)/,
		'manifest template must be read from build/lib/dsh');
	assert.match(gulp, /path\.join\([^)]*'resources',\s*'dsh'\)/,
		'icon/locale must be read from resources/dsh');
});

test('DSH bundle: manifest files whitelist only names runtime payloads', () => {
	const pkg = JSON.parse(fs.readFileSync(path.join(vscodeRoot, 'build/lib/dsh/package.json'), 'utf8'));
	assert.ok(Array.isArray(pkg.files));
	for (const required of ['index.js', 'client.js', 'host/', 'common/', 'cordis.patch.yml', 'locale/*.json', 'docs', 'icon.svg', 'runtime/']) {
		assert.ok(pkg.files.includes(required), `manifest files must include ${required}`);
	}
	// files 里列了 icon.svg、exports 里有 ./icon，但 `icon` 字段缺失时插件详情页拿不到图标。
	// 三处必须指向同一个文件。
	assert.equal(pkg.icon, 'icon.svg', 'manifest icon must name the shipped icon');
	assert.ok(Object.hasOwn(pkg.exports ?? {}, './icon'), 'the icon must stay importable');
	// 插件页详情文档：`meta.detail` 指向它，缺文件时宿主会按「声明的文档不存在」报错，
	// 而不是回退到 README，所以两份语言文档与唯一特性图必须真的在包里。
	for (const locale of ['en', 'zh']) {
		const meta = JSON.parse(fs.readFileSync(path.join(vscodeRoot, `resources/dsh/locale/${locale}.json`), 'utf8')).meta;
		assert.equal(typeof meta.detail, 'string', `${locale} locale must declare meta.detail`);
		assert.ok(fs.existsSync(path.join(vscodeRoot, 'resources/dsh', meta.detail)), `declared detail document must exist: ${meta.detail}`);
		const image = /!\[.*?\]\(([^)]+)\)/.exec(fs.readFileSync(path.join(vscodeRoot, 'resources/dsh', meta.detail), 'utf8'))?.[1];
		assert.ok(image !== undefined && fs.existsSync(path.join(vscodeRoot, 'resources/dsh/docs', image)), `${locale} detail must reference an existing image`);
	}
	// 详情页是用户了解这个插件的第一屏，必须真的有内容。
	//
	// 第五轮曾在这里写死「文档只允许一行图片，功能与用法放在 description 里」——
	// 那是把当时的**实现现状**当成了规范，结果详情页只剩一张图，点开是空白的。
	// 官方 `dsh-ops` 的 plugin-detail 有标题、要点与操作指引，这里按同样结构要求。
	for (const [code, doc] of [['en', 'DETAIL.md'], ['zh', 'DETAIL.zh.md']] as const) {
		const text = fs.readFileSync(path.join(vscodeRoot, 'resources/dsh/docs', doc), 'utf8');
		assert.ok(text.startsWith('# DSH-IDE'), `${doc} must open with a title`);
		assert.ok(/!\[.*?\]\(preview\.svg\)/.test(text), `${doc} must keep the preview image`);
		const headings = (text.match(/^## /gm) ?? []).length;
		assert.ok(headings >= 3, `${doc} must have sections explaining the plugin (found ${headings})`);
		assert.ok(text.length > 600, `${code} detail document must actually explain something`);
	}
	// 特性图必须自描述且不含脚本/远程资源（宿主按静态资源渲染）。
	const svg = fs.readFileSync(path.join(vscodeRoot, 'resources/dsh/docs/preview.svg'), 'utf8');
	assert.match(svg, /viewBox="0 0 640 300"/, 'the detail preview must use the documented 640x300 canvas');
	// 只禁「外部资源引用」；`xmlns="http://www.w3.org/2000/svg"` 是命名空间，不是网络请求。
	for (const forbidden of ['<script', '<foreignObject', 'xlink:href', 'url(http', 'src="http']) {
		assert.ok(!svg.includes(forbidden), `the detail preview must not contain ${forbidden}`);
	}
	for (const forbidden of ['chat-client/', 'chat-render/', 'node_modules/', 'vendor/']) {
		assert.ok(!pkg.files.some((entry: string) => entry.startsWith(forbidden)),
			`manifest files must not include removed sidecar / build-only input ${forbidden}`);
	}
});

test('DSH bundle: DSH whale media is staged after the bundle step (cleanDir would drop it otherwise)', () => {
	const body = fs.readFileSync(path.join(vscodeRoot, 'build/gulpfile.vscode.ts'), 'utf8');
	const source = readGulpfile();
	// prepare-dsh-chat-render 仍负责鲸鱼图标，且必须排在 esbuildBundleTask 之后。
	//
	// 2026-11-23（CHK-330）：步骤已从 appTask 的内联数组提成 `dshIdePackageTail`，
	// 让 `appTask`（发布）与 `appTaskCI`（CI）共用同一份，避免两条入口再分叉。
	// 断言改为直接读这个数组——它才是「实际执行顺序」的唯一真源。
	const tail = gulpArrayBody(body, 'const dshIdePackageTail');
	assert.ok(tail.indexOf('esbuildBundleTask') < tail.indexOf('prepareDshChatRenderTask'),
		'prepareDshChatRenderTask must run AFTER esbuildBundleTask');
	assert.match(body, /dsh-whale\.svg/, 'the Chat view icon must still be staged');
	assert.ok(source.statements.length > 0);
});

test('DSH bundle: chat content is driven by the native ChatModel, no sidecar artifacts remain', () => {
	const gulp = fs.readFileSync(path.join(vscodeRoot, 'build/gulpfile.vscode.ts'), 'utf8');
	const next = fs.readFileSync(path.join(vscodeRoot, 'build/next/index.ts'), 'utf8');
	const contribution = fs.readFileSync(path.join(vscodeRoot, 'src/vs/workbench/contrib/dsh/browser/dsh.contribution.ts'), 'utf8');
	// 层 4 的稳定路径：`dsh:/<id>` 会话由注册进原生 ChatWidget 的 content provider 提供内容，
	// 不再经过已停用的 DshChatModelDriver，也没有 sidecar 视图桥。
	assert.match(contribution, /registerDshChatSessionContent/, 'the dsh session content provider must be registered');
	assert.doesNotMatch(contribution, /dshChatViewBridge/, 'sidecar view bridge must be gone');
	assert.doesNotMatch(contribution, /dshChatModelDriver\.js/, 'the stopped ChatModel driver must not be re-registered');
	// 构建链不再编译/复制 sidecar 产物。
	assert.doesNotMatch(gulp, /build-render\.mjs/, 'no sidecar build step may remain');
	assert.doesNotMatch(next, /stageDshChatRender|dsh-chat\.js/, 'no sidecar staging may remain in transpile');
	assert.ok(!fs.existsSync(path.join(vscodeRoot, 'src/vs/workbench/contrib/dsh/browser/dshChatSeam.ts')), 'sidecar seam file must be removed');
});

test('DSH bundle: only the Host common dependencies are staged (transport modules stay in the app)', () => {
	const gulp = fs.readFileSync(path.join(vscodeRoot, 'build/gulpfile.vscode.ts'), 'utf8');
	assert.match(gulp, /path\.join\(dshClientOut, 'common', 'env\.js'\)/, 'common/env.js must be staged as a single file');
	// 分层后协议投影在 `protocol/`，Host 运行时路径（env / 定位 / 主题）留在 `common/`。
	assert.match(gulp, /path\.join\(dshClientOut, 'protocol', 'dshIdeAuthRedaction\.js'\)/, 'D55 auth redaction must be shipped with the Host bridge');
	assert.match(gulp, /path\.join\(dshClientOut, 'protocol', 'dshIdeSessionList\.js'\)/, 'shared session projection must be shipped with the Host bridge');
	assert.match(gulp, /path\.join\(dshClientOut, 'protocol', 'dshIdeCommandList\.js'\)/, 'D13 shared command projection must be shipped with the Host bridge');
	assert.match(gulp, /path\.join\(dshClientOut, 'protocol', 'dshIdeCommandLine\.js'\)/, 'D13 shared command line builder must be shipped with the Host bridge');
	assert.match(gulp, /path\.join\(dshClientOut, 'protocol', 'dshIdeArchiveSet\.js'\)/, 'D59 shared archive projection must be shipped with the Host bridge');
	assert.match(gulp, /path\.join\(dshClientOut, 'protocol', 'dshIdeSessionSearch\.js'\)/, 'D59 shared session search projection must be shipped with the Host bridge');
	assert.doesNotMatch(gulp, /path\.join\(dshClientOut, 'common'\), 'common'/, 'common/ must not be staged as a whole directory');
});

// D55：端点文件含一次性 query token，绝不能随包分发；构建时残留必须被删。
test('DSH bundle: runtime host-endpoint.json is removed from staging before packaging', () => {
	const gulp = fs.readFileSync(path.join(vscodeRoot, 'build/gulpfile.vscode.ts'), 'utf8');
	const literals = dshPackLiterals();
	assert.ok(literals.includes('host-endpoint.json'), 'the pack task must explicitly delete the token-bearing endpoint file');
	assert.match(gulp, /fs\.promises\.rm\([^)]*host-endpoint\.json/, 'the removal must run in the official gulp task');
});

// ---------------------------------------------------------------------------
// 第 36 轮：staging 清单必须与 `common/` 下的共享模块一一对应。
//
// 背景：磁盘上的 `dist/dsh-ide-2.0.0.tgz` 是**第 19 轮之前的旧产物**——它的
// `package/` 里只有 `common/env.js`，而 gulpfile 现在明确 stage 7 个 common 文件
// （`dshIdeArchiveSet` / `dshIdeCommandLine` / `dshIdeCommandList` / `dshIdeSessionList` /
// `dshIdeSessionSearch` / `dshIdeAuthRedaction` / `env`）。产物陈旧本身由「重打包」解决
// （D29），但**漏登记**会在每次打包时悄悄少带一个模块，故用本测试钉住。
// ---------------------------------------------------------------------------

test('every common/ shared module is explicitly staged for the bundle', () => {
	const gulp = fs.readFileSync(path.join(repoRoot, 'build/gulpfile.vscode.ts'), 'utf8');

	// 共享投影现在在 protocol/；common/ 只剩 Host 运行时路径。
	const protocolDir = path.join(repoRoot, 'src/vs/platform/dshClient/protocol');
	const shipped = fs.readdirSync(protocolDir).filter(name => name.endsWith('.js')).sort();
	assert.ok(shipped.length >= 7, `expected the shared protocol modules, got ${shipped.length}`);

	// gulpfile 里每个 protocol 模块都应有 `'protocol', '<file>'` 形式的 staging 条目。
	const staged = new Set([...gulp.matchAll(/'protocol',\s*'([a-zA-Z]+\.js)'/g)].map(m => m[1]));
	const missing = shipped.filter(name => !staged.has(name));
	assert.deepEqual(missing, [], `these protocol modules are not staged and would be missing from the bundle: ${missing.join(', ')}`);
});


// ---------------------------------------------------------------------------
// D20（第 37 轮）：终端宿主入口必须在 desktop 构建里。
//
// `electronPtyHostStarter` 以 entryPoint 'vs/platform/terminal/node/ptyHostMain'
// 启动 PTY 子进程，但该入口原先只列在 serverEntryPoints，导致 desktop 构建
// 缺这个文件、终端无法启动。本测试钉住它留在 desktopEntryPoints 里。
// ---------------------------------------------------------------------------

test('D20 ptyHostMain stays in desktopEntryPoints (terminal host entry)', () => {
	const source = fs.readFileSync(path.join(repoRoot, 'build/next/index.ts'), 'utf8');

	// 取出两个入口数组的正文，避免只看全文造成误判。
	const desktop = /const desktopEntryPoints = \[([\s\S]*?)\];/.exec(source)?.[1] ?? '';
	const server = /const serverEntryPoints = \[([\s\S]*?)\];/.exec(source)?.[1] ?? '';
	assert.ok(desktop !== '', 'desktopEntryPoints must exist');
	assert.ok(server !== '', 'serverEntryPoints must exist');

	// 只认同「整行就是一个数组元素」的写法（可带缩进），排除注释里出现的同名并串。
	// 第 42 轮反向验证发现：若用 includes() 匹配，注释里写了同一个 entryPoint
	// 字符串会让「入口已被删除」的守护仍然通过（假通过），故改为逐行比对。
	const entryLines = desktop.split(/\r?\n/).map(line => line.trim());
	const hasEntry = (module: string) => entryLines.includes(`'${module}',`);

	assert.ok(hasEntry('vs/platform/terminal/node/ptyHostMain'),
		'ptyHostMain must be a desktop entry point (an actual array element), otherwise the packaged desktop build has no PTY host');
	// 其余两个桌面进程入口也必须在（作为对照，防止有人把整组搬走）。
	assert.ok(hasEntry('vs/workbench/api/node/extensionHostProcess'), 'extensionHostProcess must stay a desktop entry');
	assert.ok(hasEntry('vs/platform/files/node/watcher/watcherMain'), 'watcherMain must stay a desktop entry');

	// 启动方确实指向该 entryPoint（证据链，防止入口与启动方脱节）。
	const starter = fs.readFileSync(path.join(repoRoot, 'src/vs/platform/terminal/electron-main/electronPtyHostStarter.ts'), 'utf8');
	assert.match(starter, /entryPoint:\s*'vs\/platform\/terminal\/node\/ptyHostMain'/, 'the Electron pty host starter must reference this entry point');
});

test('install-drift compares the IDE window runtime, not only the plugin layer', () => {
	// 真机前踩到的盲区：插件层 0 漂移，但 `runtime/app` 还是旧构建，窗口跑的是旧 workbench。
	const drift = fs.readFileSync(path.join(repoRoot, 'build/lib/dsh/verify/dshInstallDrift.mjs'), 'utf8');
	assert.match(drift, /RUNTIME_CRITICAL/, 'the drift gate must define the runtime critical set');
	for (const required of ['workbench.desktop.main.js', 'mainImpl.js', 'node_modules.asar', 'build-provenance.json']) {
		assert.ok(drift.includes(required), `runtime drift must cover ${required}`);
	}
	// 大文件必须放大 maxBuffer，否则「读不出」会被误报成未核验。
	assert.match(drift, /maxBuffer: 512 \* 1024 \* 1024/, 'large runtime members need an explicit maxBuffer');
	// 聚合器必须把 drift 纳入，且环境缺失时记为 SKIPPED 而不是 PASS。
	const ci = fs.readFileSync(path.join(repoRoot, 'build/lib/dsh/verify/dshIdeCi.mjs'), 'utf8');
	assert.match(ci, /'install-drift'/, 'the CI aggregate must run install-drift');
	assert.match(ci, /skippedForEnv/, 'a missing profile must be reported as skipped, never as pass');
});

test('the pack task compiles out/ before copying the plugin layer', () => {
	// `out/` 是 gitignore 的生成目录：不先编译，干净检出会 ENOENT；
	// 有旧 `out/` 时会把上一版代码静默打进 tgz。这条测试钉住前置编译步骤的存在与顺序。
	const gulp = fs.readFileSync(path.join(repoRoot, 'build/gulpfile.vscode.ts'), 'utf8');
	assert.match(gulp, /const compileDshPluginLayerTask = task\.define\('dsh-ide-compile-plugin-layer'/,
		'the plugin layer compile step must exist as a named task');
	// CHK-330：前置步骤提成 `dshIdeBuildPrerequisites`，`appTask` 与 `appTaskCI` 都展开它。
	// 断言必须覆盖**两个入口都引用同一份**，否则将来只给一边加步骤就会重新分叉
	// （这正是 CHK-329 修掉的真实缺陷）。
	const prerequisites = gulpArrayBody(gulp, 'const dshIdeBuildPrerequisites');
	assert.ok(prerequisites.includes('compileDshPluginLayerTask'), 'the prerequisite list must compile the plugin layer');
	assert.ok(prerequisites.includes('util.rimraf(appStagingPath)'),
		'the prerequisite list must clear the staging root (otherwise a previous runtime-only staging is reused)');
	for (const taskName of ['appTaskCI', 'appTask']) {
		const body = gulpTaskSeriesArgs(gulp, taskName);
		assert.ok(body.includes('...dshIdeBuildPrerequisites'), `${taskName} must expand the shared prerequisite list`);
		assert.ok(body.includes('...dshIdePackageTail'), `${taskName} must expand the shared package tail`);
	}
	const tail = gulpArrayBody(gulp, 'const dshIdePackageTail');
	assert.ok(tail.indexOf('packageAppTask') >= 0, 'the package step must still run');
	assert.ok(prerequisites.indexOf('compileDshPluginLayerTask') >= 0, 'compile must be part of the prerequisites');
	assert.ok(gulp.indexOf('...dshIdeBuildPrerequisites') < gulp.indexOf('...dshIdePackageTail'),
		'compile must run before the app is packaged');
	// 用官方编译实现，不自造编译流程。
	assert.match(gulp, /compilation\.transpileTask\('src', 'out'\)/, 'the compile step must reuse the official transpile task');
});

test('plugin metadata covers exactly the languages the host UI can select', () => {
	// 宿主内建 `LOCALE_IDS` 只有 zh/en，但 `dsh-client-locale` 的 apply() 还会
	// `addLanguage` 登记 ja/es/fr/de/ru/pt（fallback 为 en），并把它们放进 catalog。
	// Plugin Manager 的 `languageChain` 会按当前 UI 语言读 `locale/<id>.json`。
	// 第二十四轮只留 zh/en，是把内建常量当成了全部可选语言；官方 91 个带 client 的包都是这 8 份。
	const expected = ['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh'];
	const dir = path.join(vscodeRoot, 'resources/dsh/locale');
	const files = fs.readdirSync(dir).filter(name => name.endsWith('.json')).map(name => name.replace(/\.json$/, '')).sort();
	assert.deepStrictEqual(files, expected, 'metadata files must match the host selectable set');
	const asar = process.env.DSH_ASAR ?? 'C:\\Users\\guyu\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar';
	if (fs.existsSync(asar)) {
		const header = Buffer.alloc(16);
		const fd = fs.openSync(asar, 'r');
		try {
			fs.readSync(fd, header, 0, 16, 0);
			const size = header.readUInt32LE(12);
			const json = Buffer.alloc(size);
			fs.readSync(fd, json, 0, size, 16);
			const root = JSON.parse(json.toString('utf8'));
			const pad = (4 - (size % 4)) % 4;
			let node = root;
			for (const part of 'dsh/node_modules/@deepseek-ai/dsh-client-locale/lib/client.js'.split('/')) {
				node = node.files?.[part];
			}
			assert.ok(node?.size, 'host locale client must be in the asar');
			const body = Buffer.alloc(node.size);
			fs.readSync(fd, body, 0, node.size, 16 + size + pad + Number(node.offset));
			const source = body.toString('utf8');
			const builtIn = /LOCALE_IDS=\[`([a-z]{2})`,`([a-z]{2})`\]/.exec(source);
			assert.ok(builtIn !== null, 'host LOCALE_IDS must be present');
			const extra = /for\(const\[id,label\]of\[(.*?)\]\)ctx\.effect\(\(\)=>locale\.addLanguage/.exec(source);
			assert.ok(extra !== null, 'host must register the extra languages with addLanguage');
			const added = [...extra[1].matchAll(/\[`([a-z]{2})`,/g)].map(match => match[1]);
			const host = [...new Set([builtIn[1], builtIn[2], ...added])].sort();
			assert.deepStrictEqual(files, host, 'our locale files must equal the languages this host actually registers');
		} finally {
			fs.closeSync(fd);
		}
	}
	for (const code of files) {
		const parsed = JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), 'utf8'));
		assert.ok(typeof parsed.meta?.title === 'string' && parsed.meta.title !== '', `${code}: meta.title is required`);
		assert.ok(typeof parsed.meta?.description === 'string' && parsed.meta.description.length > 40, `${code}: meta.description is required`);
		assert.equal(typeof parsed.meta?.detail, 'string', `${code} locale must declare meta.detail`);
		const detail = path.join(vscodeRoot, 'resources/dsh', parsed.meta.detail);
		assert.ok(fs.existsSync(detail), `${code} detail document must exist: ${parsed.meta.detail}`);
		assert.equal(parsed.meta.detail, code === 'zh' ? 'docs/DETAIL.zh.md' : 'docs/DETAIL.md',
			`${code} must follow the official split: Chinese detail, everyone else the English document`);
	}
});

test('the preview illustration stays legal and theme-neutral', () => {
	// 规范明确要求避免 text / font / script / stylesheet / foreignObject 与外部资源；
	// 同时同一张图在明暗两种主题下都要可读——所以只能靠中性灰 alpha 叠加，不能写死浅色底。
	const file = path.join(vscodeRoot, 'resources/dsh/docs/preview.svg');
	const svg = fs.readFileSync(file, 'utf8');
	const stripped = svg.replace(/<!--[\s\S]*?-->/g, '');
	for (const forbidden of ['<text', '<style', '<script', 'font-family', 'foreignObject']) {
		assert.ok(!stripped.includes(forbidden), `preview.svg must not contain ${forbidden}`);
	}
	assert.ok(!/href="http|url\(http/.test(stripped), 'preview.svg must not reference remote resources');
	const elements = new Set([...stripped.matchAll(/<([a-zA-Z]+)/g)].map(m => m[1]));
	assert.deepStrictEqual([...elements].sort(), ['circle', 'path', 'rect', 'svg'], 'only plain shapes are allowed');
	// 深色主题下不能出现接近纯白的实心大块（那会在深色页面里变成刺眼亮块）。
	// 按真实亮度判断，而不是按十六进制前缀：`#0B6CF0` 是品牌蓝，不是白色。
	const luminance = (hex: string): number => {
		const value = hex.replace('#', '');
		const channels = [0, 2, 4].map(index => parseInt(value.substr(index, 2), 16) / 255)
			.map(channel => channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4));
		return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
	};
	// 只检查「大面积背景」：图标前景（鲸鱼在品牌蓝按钮上的白色描形）本来就是对的。
	for (const match of stripped.matchAll(/<rect[^>]*fill="(#[0-9A-Fa-f]{6})"/g)) {
		assert.ok(luminance(match[1]) < 0.95, `rect fill ${match[1]} is too bright for a theme-neutral illustration`);
	}
	assert.ok(stripped.includes('fill-opacity'), 'structural shading must use alpha so both themes work');
});

test('every bundled module is loadable as ESM, matching the package type', () => {
	// 包根声明 `"type": "module"`，所以每个 `.js` 都必须能被 Node 以 ESM 解析。
	// `transpileTask`（tsc）产出的是 CommonJS，staging 时必须就地改写成 ESM；
	// 漏掉任何一个都会让 DSH 装载失败并报 `exports is not defined in ES module scope`。
	// 这里直接读 tgz，避免依赖 staging 目录是否存在（那会让断言静默跳过）。
	const tgz = path.join(vscodeRoot, 'dist', 'dsh-ide-2.0.0.tgz');
	if (!fs.existsSync(tgz)) {
		assert.fail('the bundle must be built before this test runs');
	}
	const names = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8' })
		.split(/\r?\n/)
		.filter(name => name.startsWith('package/') && name.endsWith('.js') && !name.includes('/runtime/'));
	assert.ok(names.length > 0, 'the bundle must contain plugin modules');
	const offenders: string[] = [];
	for (const name of names) {
		const source = execFileSync('tar', ['-xzOf', tgz, name], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
		const head = source.slice(0, 400);
		if (/^"use strict";/.test(head) || /^exports\.[\w$]+ = /m.test(head) || /\bexports\./.test(source)) {
			offenders.push(name);
		}
	}
	assert.deepStrictEqual(offenders, [], `these bundled modules are CommonJS but the package is ESM: ${offenders.join(', ')}`);
});
