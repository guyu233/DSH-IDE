/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Lazy } from '../common/lazy.js';

const _rgDiskPath = new Lazy(async () => {
	// DSH-IDE：由 Host 提供的搜索工具路径优先。只读取路径，不复制也不链接文件。
	const hostProvided = process.env['DSH_IDE_HOST_RG_PATH'];
	if (typeof hostProvided === 'string' && hostProvided.length > 0) {
		return hostProvided;
	}
	const m = await import('@vscode/ripgrep-universal');
	return m.rgPath.replace(/\bnode_modules\.asar\b/, 'node_modules.asar.unpacked');
});

export function rgDiskPath(): Promise<string> {
	return _rgDiskPath.value;
}
