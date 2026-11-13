/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P5 收尾：Electron 主页物化的单测。
//
// 只测 host/electron-home.js（纯 Node 实现，不引 @deepseek-ai/*），因此能直接由
// `node --experimental-strip-types --test` 执行。Windows-only 的建链用例在其它平台跳过，
// 但「跨卷失败」「非 Windows 明确失败」始终执行，防止平台判定回退。

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import {
	ELECTRON_HOME_MARKER,
	defaultIo,
	electronHomePaths,
	materializeElectronHome,
} from '../../host/electron-home.js';

const windowsOnly = process.platform === 'win32' ? false : 'Windows-only test';

function makeFixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-electron-home-'));
	const pluginRoot = path.join(root, 'plugin');
	const installRoot = path.join(root, 'install');
	const appPath = path.join(pluginRoot, 'runtime', 'app');
	fs.mkdirSync(path.join(installRoot, 'resources'), { recursive: true });
	fs.mkdirSync(path.join(installRoot, 'locales'), { recursive: true });
	fs.mkdirSync(path.join(appPath, 'out'), { recursive: true });
	fs.writeFileSync(path.join(installRoot, 'Electron.exe'), 'exe');
	fs.writeFileSync(path.join(installRoot, 'resources.pak'), 'pak');
	fs.writeFileSync(path.join(installRoot, 'Uninstall DSH.exe'), 'uninstall');
	fs.writeFileSync(path.join(installRoot, '7zip-installer-COPYING.txt'), 'copying');
	fs.writeFileSync(path.join(installRoot, 'LICENSES.chromium.html'), 'licenses');
	fs.writeFileSync(path.join(installRoot, 'locales', 'en.pak'), 'locale');
	fs.writeFileSync(path.join(appPath, 'out', 'main.js'), 'main');
	fs.writeFileSync(path.join(appPath, 'package.json'), '{}');
	return {
		root,
		pluginRoot,
		installRoot,
		appPath,
		exePath: path.join(installRoot, 'Electron.exe'),
		dispose: () => fs.rmSync(root, { recursive: true, force: true }),
	};
}

function build(fixture, extra = {}) {
	return materializeElectronHome({
		pluginRoot: fixture.pluginRoot,
		installRoot: fixture.installRoot,
		exePath: fixture.exePath,
		appPath: fixture.appPath,
		electronVersion: '44.7.0',
		platform: 'win32',
		...extra,
	});
}

test('同卷物化：硬链接 exe、目录联接资源、resources/app 指向载荷并写标记', { skip: windowsOnly }, () => {
	const fixture = makeFixture();
	try {
		const result = build(fixture);
		assert.equal(result.ok, true, result.message);
		const paths = electronHomePaths(fixture.pluginRoot);
		assert.equal(result.exe, path.join(paths.home, 'Electron.exe'));

		// exe 是硬链接：与安装目录的源文件同一 inode，体积零增长。
		assert.equal(fs.lstatSync(result.exe).ino, fs.lstatSync(fixture.exePath).ino);
		// resources/app 是目录联接，解析后就是插件载荷。
		assert.equal(fs.realpathSync(paths.resourcesApp).toLowerCase(), fs.realpathSync(fixture.appPath).toLowerCase());

		const marker = JSON.parse(fs.readFileSync(paths.marker, 'utf8'));
		assert.equal(marker.electronVersion, '44.7.0');
		assert.equal(marker.installRoot, fixture.installRoot);
		assert.equal(marker.exeName, 'Electron.exe');
		assert.ok(marker.exeMtimeMs > 0);
	} finally {
		fixture.dispose();
	}
});

test('物化排除卸载器、7zip 附件与 Chromium 许可文本', { skip: windowsOnly }, () => {
	const fixture = makeFixture();
	try {
		const result = build(fixture);
		assert.equal(result.ok, true, result.message);
		const { home } = electronHomePaths(fixture.pluginRoot);
		assert.equal(fs.existsSync(path.join(home, 'Uninstall DSH.exe')), false);
		assert.equal(fs.existsSync(path.join(home, '7zip-installer-COPYING.txt')), false);
		assert.equal(fs.existsSync(path.join(home, 'LICENSES.chromium.html')), false);
		// 运行必需项仍在。
		assert.equal(fs.existsSync(path.join(home, 'resources.pak')), true);
		assert.equal(fs.existsSync(path.join(home, 'locales', 'en.pak')), true);
	} finally {
		fixture.dispose();
	}
});

test('标记与当前 Electron 不一致时重建主页', { skip: windowsOnly }, () => {
	const fixture = makeFixture();
	try {
		assert.equal(build(fixture).ok, true);
		const paths = electronHomePaths(fixture.pluginRoot);
		const marker = JSON.parse(fs.readFileSync(paths.marker, 'utf8'));
		marker.electronVersion = '43.7.7';
		fs.writeFileSync(paths.marker, JSON.stringify(marker));

		const result = build(fixture);
		assert.equal(result.ok, true, result.message);
		assert.equal(JSON.parse(fs.readFileSync(paths.marker, 'utf8')).electronVersion, '44.7.0');
	} finally {
		fixture.dispose();
	}
});

test('标记匹配时不重复重建（幂等）', { skip: windowsOnly }, () => {
	const fixture = makeFixture();
	try {
		assert.equal(build(fixture).ok, true);
		const paths = electronHomePaths(fixture.pluginRoot);
		const markerPath = path.join(paths.home, ELECTRON_HOME_MARKER);
		const before = JSON.parse(fs.readFileSync(markerPath, 'utf8')).materializedAt;
		const result = build(fixture);
		assert.equal(result.ok, true, result.message);
		assert.equal(JSON.parse(fs.readFileSync(markerPath, 'utf8')).materializedAt, before);
	} finally {
		fixture.dispose();
	}
});

test('跨卷硬链接失败时明确拒绝，不静默复制', () => {
	const fixture = makeFixture();
	const io = {
		...defaultIo,
		link() {
			throw Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' });
		},
	};
	try {
		const result = build(fixture, { io });
		assert.equal(result.ok, false);
		assert.match(result.message, /same volume/);
		assert.equal(fs.existsSync(electronHomePaths(fixture.pluginRoot).marker), false, '失败后不得留下半成品主页');
	} finally {
		fixture.dispose();
	}
});

test('非 Windows 平台明确失败，不产生主页', () => {
	const fixture = makeFixture();
	try {
		const result = build(fixture, { platform: 'darwin' });
		assert.equal(result.ok, false);
		assert.match(result.message, /Windows-only/);
		assert.equal(fs.existsSync(electronHomePaths(fixture.pluginRoot).home), false);
	} finally {
		fixture.dispose();
	}
});

test('插件载荷缺失时明确失败', () => {
	const fixture = makeFixture();
	try {
		const result = build(fixture, { appPath: path.join(fixture.pluginRoot, 'runtime', 'missing-app') });
		assert.equal(result.ok, false);
		assert.match(result.message, /payload is missing/);
	} finally {
		fixture.dispose();
	}
});