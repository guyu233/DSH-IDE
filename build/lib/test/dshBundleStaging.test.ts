/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import * as ts from 'typescript';

// 仓库已扁平化（README §1）：仓库根即项目根，原 vscode-1.143.1/ 子目录不存在。
const repoRoot = path.resolve(import.meta.dirname, '../../..');
const vscodeRoot = repoRoot;

function readGulpfile(): ts.SourceFile {
	return ts.createSourceFile('gulpfile.vscode.ts', fs.readFileSync(path.join(vscodeRoot, 'build/gulpfile.vscode.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
}

/** Every string literal inside the `dsh-ide-pack` task body. */
function dshPackLiterals(): string[] {
	const source = readGulpfile();
	const literals: string[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
			&& node.expression.name.text === 'define'
			&& node.arguments.length >= 1 && ts.isStringLiteral(node.arguments[0])
			&& node.arguments[0].text === 'dsh-ide-pack') {
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
		'build/dsh/chat-render/build-render.mjs',
		'build/dsh/chat-render/index.tsx',
		'build/dsh/chat-render/PROVENANCE.md',
		'build/dsh/chat-render/LICENSE-DSH',
		'resources/dsh/icon.svg',
		'resources/dsh/locale/en.json',
		'resources/dsh/locale/zh.json',
		'src/vs/platform/dshClient/index.js',
		'src/vs/platform/dshClient/client/client.js',
		'src/vs/platform/dshClient/host/ide-service.js',
		'src/vs/platform/dshClient/common/env.js',
		// P1：协议真源与版本契约（单一真源，二者必须存在于原生位置）。
		'src/vs/platform/dshClient/common/dshIdeProtocol.ts',
		'src/vs/platform/dshClient/common/dshIdeContract.ts',
		'src/vs/platform/dshClient/electron-main/dshIdeChannel.ts',
		'src/vs/platform/dshClient/electron-main/ide-view-service.ts',
		// 旧连接层/聊天文件已整删，不再列入（协议耦合的 renderer 侧实现与事件映射）。
	];
	for (const relative of expected) {
		assert.ok(fs.existsSync(path.join(vscodeRoot, relative)), `missing native source: ${relative}`);
	}
});

test('DSH bundle: dsh-ide-pack stages host entries from out/ and manifest/icon from their sources', () => {
	const literals = dshPackLiterals();
	assert.ok(literals.length > 0, 'dsh-ide-pack task body not found');
	for (const needle of ['index.js', 'client.js', 'host', 'common', 'package.json', 'cordis.patch.yml', 'icon.svg', 'locale', 'chat-render']) {
		assert.ok(literals.includes(needle), `dsh-ide-pack must stage ${needle}`);
	}
	const gulp = fs.readFileSync(path.join(vscodeRoot, 'build/gulpfile.vscode.ts'), 'utf8');
	assert.match(gulp, /const dshChatRenderSource = path\.join\(root, 'build', 'dsh', 'chat-render'\)/,
		'sidecar must be read from build/dsh/chat-render');
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
	for (const required of ['index.js', 'client.js', 'host/', 'common/', 'cordis.patch.yml', 'locale/*.json', 'icon.svg', 'runtime/', 'chat-render/dist/']) {
		assert.ok(pkg.files.includes(required), `manifest files must include ${required}`);
	}
	for (const forbidden of ['chat-client/', 'chat-render/README.md', 'node_modules/', 'vendor/']) {
		assert.ok(!pkg.files.includes(forbidden), `manifest files must not include build-only input ${forbidden}`);
	}
});

test('DSH bundle: sidecar is written after the bundle step (cleanDir would drop it otherwise)', () => {
	const source = readGulpfile();
	const body = fs.readFileSync(path.join(vscodeRoot, 'build/gulpfile.vscode.ts'), 'utf8');
	// prepare-dsh-chat-render 必须排在 esbuildBundleTask 之后：bundle() 会 cleanDir(outDir)。
	const appTaskIndex = body.indexOf('const appTask = task.define(`dsh-ide-${platform}-${arch}${dashed(minified)}`');
	assert.ok(appTaskIndex > 0, 'appTask definition not found');
	const appTaskBody = body.slice(appTaskIndex, appTaskIndex + 900);
	assert.ok(appTaskBody.indexOf('esbuildBundleTask') < appTaskBody.indexOf('prepareDshChatRenderTask'),
		'prepareDshChatRenderTask must run AFTER esbuildBundleTask');
	assert.ok(source.statements.length > 0);
});

test('DSH bundle: sidecar target path matches the seam constant', () => {
	const seam = fs.readFileSync(path.join(vscodeRoot, 'src/vs/workbench/contrib/dsh/browser/dshChatSeam.ts'), 'utf8');
	assert.match(seam, /DSH_CHAT_SIDECAR_PATH\s*=\s*'vs\/workbench\/contrib\/dsh\/browser\/chatRender\/dsh-chat\.js'/);
	const gulp = fs.readFileSync(path.join(vscodeRoot, 'build/gulpfile.vscode.ts'), 'utf8');
	assert.match(gulp, /path\.join\('vs', 'workbench', 'contrib', 'dsh', 'browser', 'chatRender'\)/);
});

test('DSH bundle: only the Host common dependencies are staged (transport modules stay in the app)', () => {
	const gulp = fs.readFileSync(path.join(vscodeRoot, 'build/gulpfile.vscode.ts'), 'utf8');
	assert.match(gulp, /path\.join\(dshClientOut, 'common', 'env\.js'\)/, 'common/env.js must be staged as a single file');
	assert.match(gulp, /path\.join\(dshClientOut, 'common', 'dshIdeAuthRedaction\.js'\)/, 'D55 auth redaction must be shipped with the Host bridge');
	assert.match(gulp, /path\.join\(dshClientOut, 'common', 'dshIdeSessionList\.js'\)/, 'shared session projection must be shipped with the Host bridge');
	assert.match(gulp, /path\.join\(dshClientOut, 'common', 'dshIdeCommandList\.js'\)/, 'D13 shared command projection must be shipped with the Host bridge');
	assert.doesNotMatch(gulp, /path\.join\(dshClientOut, 'common'\), 'common'/, 'common/ must not be staged as a whole directory');
});

// D55：端点文件含一次性 query token，绝不能随包分发；构建时残留必须被删。
test('DSH bundle: runtime host-endpoint.json is removed from staging before packaging', () => {
	const gulp = fs.readFileSync(path.join(vscodeRoot, 'build/gulpfile.vscode.ts'), 'utf8');
	const literals = dshPackLiterals();
	assert.ok(literals.includes('host-endpoint.json'), 'the pack task must explicitly delete the token-bearing endpoint file');
	assert.match(gulp, /fs\.promises\.rm\([^)]*host-endpoint\.json/, 'the removal must run in the official gulp task');
});
