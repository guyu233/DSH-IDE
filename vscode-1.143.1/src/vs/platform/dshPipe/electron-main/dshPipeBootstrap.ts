/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 主进程引导：当本 IDE 由 dsh-ide 拉起（注入 DSH_IDE_PIPE）时，创建命名管道客户端、
// 连接 Host，并把 DshPipeChannel 注册为 IPC 频道 'dshPipe'，供渲染器（DshChatClient）使用。
//
// 仅在 DSH_IDE_PIPE 存在时生效；否则本函数立即返回 undefined（普通 VS Code 实例零副作用）。

import * as path from 'node:path';
import { IServerChannel } from '../../base/parts/ipc/common/ipc.js';
import { ILogService } from '../../log/common/log.js';
import { DshPipeClient } from './dshPipeClient.js';
import { DshPipeChannel } from '../common/dshPipeChannel.js';

export interface IDshPipeBootstrapResult {
	readonly channelName: string;
	readonly channel: IServerChannel<string>;
}

/**
 * 创建管道客户端并连接 Host；返回待注册的 IPC 频道（channelName='dshPipe'）。
 * @param appRoot 打包后的应用根（含 chatapp/ 子应用资源）；默认由调用方传入。
 * @param log 主进程日志服务。
 */
export async function bootstrapDshPipe(appRoot: string, log: ILogService): Promise<IDshPipeBootstrapResult | undefined> {
	const pipePath = process.env.DSH_IDE_PIPE;
	const nonce = process.env.DSH_IDE_NONCE;
	if (!pipePath || !nonce) { return undefined; }

	const chatappDir = path.join(appRoot, 'chatapp');
	const client = new DshPipeClient({ pipePath, nonce });
	try {
		await client.connect();
	} catch (e) {
		log.warn('[dsh-ide] pipe connect failed: ' + String((e && (e as Error).message) || e));
		return undefined;
	}
	const channel = new DshPipeChannel(client, chatappDir);
	return { channelName: 'dshPipe', channel };
}
