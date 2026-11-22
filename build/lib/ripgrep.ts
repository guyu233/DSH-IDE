/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Platforms shipped by @vscode/ripgrep-universal, using Node.js platform and architecture names. */
const ripgrepUniversalPlatforms = [
	'darwin-arm64', 'darwin-x64',
	'linux-arm', 'linux-arm64', 'linux-ia32', 'linux-x64',
	'linux-ppc64', 'linux-riscv64', 'linux-s390x',
	'win32-arm64', 'win32-ia32', 'win32-x64',
];

/** Returns a glob filter excluding ripgrep binaries for other targets. */
export function getRipgrepExcludeFilter(platform: string, arch: string): string[] {
	let nodePlatform = platform === 'alpine' ? 'linux' : platform;
	let nodeArch = arch;
	if (arch === 'armhf') {
		nodeArch = 'arm';
	} else if (arch === 'alpine') {
		nodePlatform = 'linux';
		nodeArch = 'x64';
	}
	const target = `${nodePlatform}-${nodeArch}`;
	const nonTargetPlatforms = ripgrepUniversalPlatforms.filter(p => p !== target);
	return ['**', ...nonTargetPlatforms.map(p => `!**/node_modules/@vscode/ripgrep-universal/bin/${p}/**`)];
}

/** DSH Windows 桌面保留 ASAR 索引和兼容包，只不分发由 Host 提供的 unpacked 二进制。 */
export function getDshRipgrepPayloadFilter(arch: string): string[] {
	return ['**', `!node_modules.asar.unpacked/@vscode/ripgrep-universal/bin/win32-${arch}/rg.exe`];
}

/** DSH Windows 桌面：终端原生绑定由 Host 提供，载荷只保留 JS 与 ASAR 索引。 */
export function getDshNodePtyPayloadFilter(): string[] {
	const platforms = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64'];

	return ['**', ...platforms.map(p => `!**/node_modules.asar.unpacked/node-pty/prebuilds/${p}/**`)];
}
