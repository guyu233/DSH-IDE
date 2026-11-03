/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 主进程引导：当本 IDE 由 dsh-ide 拉起（注入 DSH_IDE_ENDPOINT/DSH_IDE_TOKEN）时，
// 用官方传输（dsh-client-connection 语义）连接运行中的 DSH Host，并把
// DshClientChannel 注册为 IPC 频道 'dshClient'，供渲染器（IDshClientService）使用。
//
// 仅在 DSH_IDE_ENDPOINT 存在时生效；否则返回 undefined（普通 VS Code 实例零副作用）。
// 不自起 Host；Host 必须已在运行（由 DSH 桌面 App 提供）。

import { IServerChannel } from '../../base/parts/ipc/common/ipc.js';
import { ILogService } from '../../log/common/log.js';
import { DshClientTransport } from './dshClientTransport.node.js';
import { DshClientChannel } from '../common/dshClientChannel.js';

export interface IDshClientBootstrapResult {
	readonly channelName: string;
	readonly channel: IServerChannel<string>;
}

/**
 * 构建官方客户端传输并注册 IPC 频道（channelName='dshClient'）。
 * @param log 主进程日志服务。
 */
export async function bootstrapDshClient(log: ILogService): Promise<IDshClientBootstrapResult | undefined> {
	const transport = DshClientTransport.fromEnv();
	if (!transport) { return undefined; }
	try {
		await transport.exchangeToken(); // 头号风险第一步：官方 /connect 能否拿到 cookie
		log.info(`[dsh-ide] official client connected to ${transport.endpoint}`);
	} catch (e) {
		log.warn('[dsh-ide] official /connect failed: ' + String((e && (e as Error).message) || e));
		// 仍注册频道：渲染器可显示「未连接」并重试，而不是整体缺失。
	}
	const channel = new DshClientChannel(transport);
	return { channelName: 'dshClient', channel };
}
