// 路径只从「正在运行的 DSH」和「当前用户」推出来。
// 不写死盘符、用户名或插件包被链接到的目录：pnpm link 会把插件指到另一块盘，
// 硬链接 Electron 时就会失败。

import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** DSH 可执行文件所在目录。跟着本次进程走，不看安装包原来放在哪。 */
export function dshInstallRoot(exePath = process.execPath) {
	return dirname(exePath);
}

/**
 * DSH 的用户数据根。
 * 优先 `DSH_HOME`，其次 `DSH_PROFILE_DIR`（配置目录），最后是当前用户的 `~/.dsh`。
 */
export function dshUserRoot() {
	const home = process.env.DSH_HOME;
	if (typeof home === 'string' && home !== '') {
		return home;
	}
	const profile = process.env.DSH_PROFILE_DIR;
	if (typeof profile === 'string' && profile !== '') {
		return profile;
	}
	return join(homedir(), '.dsh');
}

/**
 * @param {string} target
 * @param {(path: string) => { dev?: number, isDirectory?: () => boolean }} stat
 */
function statInfo(target, stat) {
	try {
		return stat(target);
	} catch {
		return undefined;
	}
}

/**
 * 路径本身，或它还不存在时最近的已存在上级，所在的卷。
 * 目录还没建出来时，创建它会落在上级那块盘上；stat 失败不能当成「哪块盘都行」。
 * 候选路径本身是文件时不可用：不能把状态目录建在文件下面。
 * @param {string} target
 * @param {(path: string) => { dev?: number, isDirectory?: () => boolean }} stat
 * @returns {{ dev: number, usable: boolean } | undefined}
 */
function volumeOf(target, stat) {
	let current = target;
	for (let depth = 0; depth < 32; depth++) {
		const info = statInfo(current, stat);
		if (info) {
			const dev = info.dev;
			if (typeof dev !== 'number') {
				return undefined;
			}
			const fileAtTarget = current === target
				&& typeof info.isDirectory === 'function'
				&& info.isDirectory() === false;
			return { dev, usable: !fileAtTarget };
		}
		const parent = dirname(current);
		if (parent === current) {
			return undefined;
		}
		current = parent;
	}
	return undefined;
}

/**
 * 插件运行时状态目录（端点文件、Electron 主页）。
 * 必须和本次 DSH 可执行文件同一块盘，否则硬链接铺不开主页。
 * 候选顺序：用户的 DSH 数据目录、LOCALAPPDATA、可执行文件所在目录。
 * 只有卷号对得上才选用；对不上或还无法证明同卷时，退回可执行文件所在目录。
 * @param {string} [exePath]
 * @param {(path: string) => { dev?: number, isDirectory?: () => boolean }} [stat]
 */
export function dshIdeStateDir(exePath = process.execPath, stat = statSync) {
	const exe = volumeOf(exePath, stat);
	const candidates = [
		dshUserRoot(),
		process.env.LOCALAPPDATA,
		dshInstallRoot(exePath),
	].filter(dir => typeof dir === 'string' && dir !== '');
	if (exe !== undefined) {
		for (const dir of candidates) {
			const volume = volumeOf(dir, stat);
			if (volume !== undefined && volume.usable && volume.dev === exe.dev) {
				return join(dir, 'dsh-ide');
			}
		}
	}
	return join(dshInstallRoot(exePath), 'dsh-ide');
}

/** Electron 主页。和 DSH 可执行文件同一块盘，不放在插件包目录里。 */
export function electronHomeDir(exePath = process.execPath, stat = statSync) {
	return join(dshIdeStateDir(exePath, stat), 'electron-home');
}

/** IDE 重新发现端口用的端点文件。跟着用户的 DSH 数据目录，不跟着插件链接。 */
export function hostEndpointFile(exePath = process.execPath, stat = statSync) {
	return join(dshIdeStateDir(exePath, stat), 'host-endpoint.json');
}
