/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** IDE 侧读取宿主搜索工具路径的环境变量。只传路径，不复制、不链接、不写入宿主文件。 */
export const DSH_IDE_HOST_RG_PATH = 'DSH_IDE_HOST_RG_PATH';

function isInside(root, file) {
	const name = relative(root, file);
	return name !== '' && !isAbsolute(name) && name !== '..' && !name.startsWith(`..${sep}`);
}

/** 从正在运行的桌面 Host 解析官方搜索工具，不从插件依赖或 PATH 选取可执行文件。 */
async function resolveDesktopRipgrep(resourcesPath) {
	const archive = join(resourcesPath, 'app.asar');
	const requireFromHost = createRequire(join(archive, 'dsh', 'package.json'));
	let entry;
	try {
		entry = realpathSync(requireFromHost.resolve('@deepseek-ai/dsh-util-ripgrep'));
	} catch (cause) {
		throw new Error('The DSH Host ripgrep resolver is unavailable (requires DSH Desktop 0.2.2-rc.2 or newer)', { cause });
	}
	if (!isInside(archive, entry)) {
		throw new Error('The ripgrep resolver is outside the DSH Host archive');
	}
	const { resolveRgPath } = await import(pathToFileURL(entry).href);
	return resolveRgPath();
}

/**
 * 解析并校验宿主搜索工具，返回交给 IDE 进程的绝对路径。
 *
 * 只做解析与校验：不创建目录、不建立链接、不复制文件，因此不会影响宿主安装内容。
 * IDE 侧通过 `DSH_IDE_HOST_RG_PATH` 直接使用该路径。
 */
export async function resolveHostRipgrep({
	resourcesPath = join(dirname(process.execPath), 'resources'),
	resolveRipgrep = resolveDesktopRipgrep,
} = {}) {
	if (process.platform !== 'win32') {
		throw new Error('Host ripgrep reuse requires a Windows desktop build');
	}

	const hostResources = realpathSync(resourcesPath);
	const candidate = await resolveRipgrep(hostResources);
	if (typeof candidate !== 'string' || !isAbsolute(candidate)) {
		throw new Error('The DSH Host did not resolve an absolute ripgrep path');
	}
	const executable = realpathSync(candidate);
	if (!isInside(hostResources, executable) || basename(executable) !== 'rg.exe' || !statSync(executable).isFile()) {
		throw new Error('The resolved ripgrep executable is not a file in the DSH Host resources');
	}
	return executable;
}

/** IDE 侧读取宿主终端原生模块目录的环境变量。 */
export const DSH_IDE_HOST_PTY_PATH = 'DSH_IDE_HOST_PTY_PATH';

/**
 * 解析并校验宿主的 `node-pty` 包目录，返回交给 IDE 进程的绝对路径。
 *
 * 与搜索工具同一条纪律：只解析与校验，不创建、不链接、不复制任何文件。
 * 校验依据是「目录内确实存在当前平台的原生绑定」，不是包名或版本字符串。
 */
export async function resolveHostNodePty({
	resourcesPath = join(dirname(process.execPath), 'resources'),
} = {}) {
	if (process.platform !== 'win32') {
		throw new Error('Host node-pty reuse requires a Windows desktop build');
	}
	const archive = join(resourcesPath, 'app.asar');
	const requireFromHost = createRequire(join(archive, 'dsh', 'package.json'));
	let entry;
	try {
		entry = realpathSync(requireFromHost.resolve('node-pty'));
	} catch (cause) {
		throw new Error('The DSH Host node-pty is unavailable', { cause });
	}
	// 原生绑定无法放进 asar，实际加载的是 .asar.unpacked 下的同一份包。
	const unpacked = entry.replace(/\bnode_modules\.asar\b/, 'node_modules.asar.unpacked');
	const packageRoot = dirname(dirname(unpacked));
	const binding = join(packageRoot, "prebuilds", `win32-${process.arch}`, "conpty.node");
	if (!existsSync(binding)) {
		throw new Error(`The DSH Host node-pty has no native binding for win32-${process.arch}`);
	}
	return packageRoot;
}
