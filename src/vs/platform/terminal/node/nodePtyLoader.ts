/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IPty, IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty';

/** `node-pty` 中本仓库实际用到的部分。 */
export interface INodePtyModule {
	spawn(file: string, args: string[] | string, options: IPtyForkOptions | IWindowsPtyForkOptions): IPty;
}

let modulePromise: Promise<INodePtyModule> | undefined;

/**
 * 加载 `node-pty`。
 *
 * DSH-IDE：Host 会在拉起 IDE 前把宿主的 `node-pty` 包目录写进 `DSH_IDE_HOST_PTY_PATH`。
 * 有该变量时优先从宿主目录加载，复用宿主已编译好的原生绑定；
 * 加载失败（宿主目录不完整、绑定缺失）时回退到本仓库依赖，并保留原始错误便于排查。
 * 只读路径，不复制也不链接文件。
 */
export function loadNodePty(): Promise<INodePtyModule> {
	modulePromise ??= (async () => {
		const hostPath = process.env['DSH_IDE_HOST_PTY_PATH'];
		if (typeof hostPath === 'string' && hostPath.length > 0) {
			try {
				const { pathToFileURL } = await import('node:url');
				const { join } = await import('node:path');
				return await import(pathToFileURL(join(hostPath, 'lib', 'index.js')).href) as INodePtyModule;
			} catch (error) {
				console.warn('[dsh-ide] cannot load the Host node-pty, falling back to the bundled one:', error);
			}
		}
		return await import('node-pty') as INodePtyModule;
	})();
	return modulePromise;
}
