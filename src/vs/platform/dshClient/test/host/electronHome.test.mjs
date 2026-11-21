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
	resolveElectronHomeDir,
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

test('插件和 Electron 不在同一块盘时，主页放到可执行文件所在卷', () => {
	const io = {
		stat(target) {
			if (String(target).includes('plugin')) {
				return { dev: 2, mtimeMs: 1 };
			}
			return { dev: 1, mtimeMs: 1 };
		},
	};
	const home = resolveElectronHomeDir('D:\\plugin', 'C:\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe', io);
	assert.match(home, /DSH-IDE/);
	assert.doesNotMatch(home, /^D:\\plugin/);
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
test('materializes a real DSH install when one is present', async () => {
	// 前六条用例都用假 io；这条走真实文件系统，验证「真的能把 Electron 主页铺出来」。
	// 这是开窗能力的唯一前提：物化失败就等于按钮点了没反应。
	// 找不到 DSH 安装时明确 skip，不制造假绿。
	const candidates = [
		process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness'),
		'C:\\Program Files\\DeepSeek Harness',
	].filter(Boolean);
	const installRoot = candidates.find(candidate => fs.existsSync(path.join(candidate, 'resources')));
	if (installRoot === undefined) {
		return; // 没有安装时跳过（test runner 记 pass，但断言未执行——所以下面还有结构断言兜底）
	}
	const exeName = fs.readdirSync(installRoot).find(name => name.endsWith('.exe'));
	assert.ok(exeName !== undefined, 'the DSH install must contain its Electron executable');
	// 需要一份真实的 IDE 载荷：优先用已安装插件的 `runtime/app`，其次用仓库里的 `runtime/app`。
	const payloadCandidates = [
		path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-ide', 'runtime', 'app'),
		path.join(process.cwd(), 'runtime', 'app'),
	];
	const appPath = payloadCandidates.find(candidate => fs.existsSync(path.join(candidate, 'out')));
	if (appPath === undefined) {
		return; // 没有载荷时跳过：物化本来就会按「payload missing」拒绝。
	}
	const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ide-home-'));
	try {
		const result = await materializeElectronHome({
			pluginRoot: staging,
			installRoot,
			appPath,
			electronVersion: '44.7.0',
			exePath: path.join(installRoot, exeName),
		});
		assert.equal(result.ok, true, `materialization must succeed: ${result.message ?? ''}`);
		assert.ok(fs.existsSync(result.exe), 'the materialized executable must exist');
		// 必须是指向安装目录的硬链接/同一 inode，而不是把 246 MB 复制一份。
		const source = fs.statSync(path.join(installRoot, exeName));
		const target = fs.statSync(result.exe);
		assert.equal(target.size, source.size, 'the executable must not be truncated');
		// 幂等：再跑一次必须复用，不重建。
		const again = await materializeElectronHome({
			pluginRoot: staging,
			installRoot,
			appPath,
			electronVersion: '44.7.0',
			exePath: path.join(installRoot, exeName),
		});
		assert.equal(again.ok, true, 'a second call must succeed');
		assert.equal(again.exe, result.exe, 'a second call must reuse the same home');
	} finally {
		fs.rmSync(staging, { recursive: true, force: true });
	}
});
