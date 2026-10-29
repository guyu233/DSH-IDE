/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { enableNodeCompileCache } from './vs/base/node/nodeCompileCache.js';
import { app } from 'electron';

enableNodeCompileCache('main');

// DSH: 强制使用 DSH 的 AppUserModelID，使 IDE 窗口与 DSH 主窗口在 Windows 任务栏合并（不“分家”）。
// 值来自环境变量 DSH_IDE_AUMID；未设置时回退到 'com.deepseek.dsh'。必须在创建任何窗口前调用。
if (process.platform === 'win32') {
	const dshAumid = process.env['DSH_IDE_AUMID'] || 'com.deepseek.dsh';
	try { app.setAppUserModelId(dshAumid); } catch { /* ignore */ }
}

await import('./mainImpl.js');
