// src/vs/platform/dshClient/host/electron-home.js
// DSH-IDE「Electron 主页」物化。
//
// 为什么需要它：Electron 按**自身所在目录**解析 `resources`；直接运行 DSH 安装目录的 exe
// 只会加载 DSH 自己的 `resources/app.asar`。因此把 DSH 的 Electron 以硬链接（文件）/
// 目录联接（目录）物化到插件目录，再让 `resources/app` 指向插件载荷，exe 就会加载 DSH-IDE。
//
// 纪律：
//   - 硬链接必须同卷；跨卷**禁止**静默复制（会凭空复制约 300 MB），明确失败并给出同卷建议。
//   - 主页可用性由 `.marker.json`（Electron 版本 + 安装根 + exe 名称/mtime）判定，DSH 升级后重建。
//   - 只物化运行必需项；卸载器、7zip 附件、Chromium 许可文本不参与。
//   - 当前只支持 Windows；其它平台明确失败，不产生半成品主页。
//
// 该文件被 Host 半身（ide-service.js）调用，也被 electronHome.test.mjs 直接单测；
// 依赖注入 `io` 只用于测试跨卷等不可构造的文件系统条件。

import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** 主页目录名（位于插件根 `runtime/` 下）。 */
export const ELECTRON_HOME_DIR = 'electron-home';
/** 判定主页是否需要重建的标记文件。 */
export const ELECTRON_HOME_MARKER = '.marker.json';
/** 标记文件 schema；字段变化时递增。 */
export const ELECTRON_HOME_SCHEMA = 1;

/** 不参与物化的安装根条目：卸载器、7zip 附件、Chromium 许可文本。 */
const EXCLUDED_ENTRY_PATTERNS = [
	/^Uninstall.*\.exe$/i,
	/^7zip-/i,
	/^LICENSES\.chromium\.html$/i,
];

/**
 * 是否跳过该安装根条目。
 * @param {string} name
 * @returns {boolean}
 */
export function isExcludedEntry(name) {
	return EXCLUDED_ENTRY_PATTERNS.some(pattern => pattern.test(name));
}

/**
 * 计算主页内的固定路径。
 * @param {string} pluginRoot 插件根目录（`index.js` 所在目录）
 * @returns {{ home: string, resources: string, resourcesApp: string, marker: string }}
 */
export function electronHomePaths(pluginRoot) {
	const home = join(pluginRoot, 'runtime', ELECTRON_HOME_DIR);
	return {
		home,
		resources: join(home, 'resources'),
		resourcesApp: join(home, 'resources', 'app'),
		marker: join(home, ELECTRON_HOME_MARKER),
	};
}

/** 真实文件系统实现；测试可注入同名函数模拟跨卷失败。 */
export const defaultIo = {
	exists: path => existsSync(path),
	read: (path, encoding) => readFileSync(path, encoding),
	write: (path, data) => writeFileSync(path, data),
	mkdir: (path, options) => mkdirSync(path, options),
	readdir: (path, options) => readdirSync(path, options),
	stat: path => statSync(path),
	link: (from, to) => linkSync(from, to),
	junction: (from, to) => symlinkSync(from, to, 'junction'),
	remove: path => rmSync(path, { recursive: true, force: true }),
};

/**
 * 期望的标记内容。
 * @param {{ installRoot: string, exePath: string, electronVersion: string }} options
 * @param {typeof defaultIo} io
 */
function expectedMarker({ installRoot, exePath, electronVersion }, io) {
	let exeMtimeMs = 0;
	try {
		exeMtimeMs = io.stat(exePath).mtimeMs;
	} catch {
		// exe 不存在时由调用方的前置检查负责给出明确失败。
	}
	return {
		schema: ELECTRON_HOME_SCHEMA,
		electronVersion,
		installRoot,
		exeName: basename(exePath),
		exeMtimeMs: Math.round(exeMtimeMs),
	};
}

/**
 * 现有主页是否与当前 DSH Electron 匹配。
 * @returns {boolean}
 */
function homeIsCurrent(paths, expected, io) {
	try {
		const marker = JSON.parse(io.read(paths.marker, 'utf8'));
		return marker.schema === expected.schema
			&& marker.electronVersion === expected.electronVersion
			&& marker.installRoot === expected.installRoot
			&& marker.exeName === expected.exeName
			&& marker.exeMtimeMs === expected.exeMtimeMs
			&& io.exists(join(paths.home, expected.exeName))
			&& io.exists(paths.resourcesApp);
	} catch {
		return false;
	}
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

/**
 * 物化 Electron 主页（幂等）。
 *
 * @param {object} options
 * @param {string} options.pluginRoot 插件根目录
 * @param {string} options.installRoot DSH 安装根（`dirname(process.execPath)`）
 * @param {string} options.exePath 宿主 Electron 可执行文件（默认 `process.execPath`）
 * @param {string} options.appPath 插件载荷 `runtime/app`
 * @param {string} options.electronVersion 宿主 Electron 版本（用于标记判定）
 * @param {string} [options.platform] 平台（默认 `process.platform`）
 * @param {typeof defaultIo} [options.io] 文件系统实现（测试注入）
 * @returns {{ ok: boolean, exe?: string, message?: string }}
 */
export function materializeElectronHome({
	pluginRoot,
	installRoot,
	appPath,
	electronVersion,
	exePath = process.execPath,
	platform = process.platform,
	io = defaultIo,
}) {
	if (platform !== 'win32') {
		return {
			ok: false,
			message: `Electron home materialization is Windows-only for now (platform=${platform}); a bundled Electron would be required on this platform`,
		};
	}
	if (!io.exists(join(installRoot, 'resources'))) {
		return { ok: false, message: `cannot locate the DSH Electron distribution at ${installRoot}` };
	}
	if (!io.exists(appPath)) {
		return { ok: false, message: `IDE payload is missing: ${appPath}` };
	}

	const paths = electronHomePaths(pluginRoot);
	const expected = expectedMarker({ installRoot, exePath, electronVersion }, io);
	const homeExe = join(paths.home, expected.exeName);
	if (homeIsCurrent(paths, expected, io)) {
		return { ok: true, exe: homeExe };
	}

	try {
		// 重建前先移除旧主页；exe 正在运行时这里会失败，如实报告而不是留下半新半旧的主页。
		io.remove(paths.home);
		io.mkdir(paths.resources, { recursive: true });
		for (const entry of io.readdir(installRoot, { withFileTypes: true })) {
			if (entry.name === 'resources' || isExcludedEntry(entry.name)) {
				continue;
			}
			const from = join(installRoot, entry.name);
			const to = join(paths.home, entry.name);
			if (entry.isDirectory()) {
				// 目录用联接：同卷零占用，且跟随 DSH 安装目录的内容。
				io.junction(from, to);
			} else {
				// 文件用硬链接：同卷零占用；失败按跨卷/权限明确拒绝。
				io.link(from, to);
			}
		}
		// `resources/app` 指向插件载荷：exe 从这里加载 DSH-IDE，而不是 DSH 的 app.asar。
		io.junction(appPath, paths.resourcesApp);
		io.write(paths.marker, `${JSON.stringify({ ...expected, materializedAt: new Date().toISOString() }, null, 2)}\n`);
		return { ok: true, exe: homeExe };
	} catch (error) {
		try {
			io.remove(paths.home);
		} catch {
			// 清理失败不覆盖主错误；下一次调用会再次尝试重建。
		}
		const code = error !== null && typeof error === 'object' ? error.code : undefined;
		if (code === 'EXDEV' || code === 'EPERM' || code === 'EACCES') {
			return {
				ok: false,
				message: `cannot hard-link the DSH Electron into ${paths.home} (${code}); keep the DSH installation and the DSH profile on the same volume (hard links cannot cross volumes)`,
			};
		}
		return { ok: false, message: `failed to materialize Electron home: ${errorMessage(error)}` };
	}
}