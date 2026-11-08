// src/vs/platform/dshClient/index.js
// DSH-IDE Host Cordis 插件入口（Cordis bundle plugin，apply 形式；纯 Node-ESM）。
//
// 两个职责：
//   1. 注册官方 @Remote IDE 扩展服务（`ctx.remote.ide.*`，命名空间 `ide`）；
//   2. 创建 DSH-IDE Host 半身桥接 `DshIdeHostBridge`，在插件上下文上订阅
//      `session/event` / `agent/assistant-stream` / `approval/request` / `user-questions/request`
//      并注册唯一的交互式 answerer（第 4 章 T3）。
//
// 传输端口（IDE 主进程 ↔ Host 半身）由 P5 真机接线注入；未接线时桥接不伪造事件，
// answerer 一律 `next()` 委托给 DSH 自己的 answerer。

import { IdeRemoteService } from './host/ide-service.js';
import { createDshIdeHostBridge } from './host/ide-view-host.js';

export const name = 'dsh-ide';
export const inject = [];

export function apply(ctx, config = {}) {
	const root = (config && config.root) || process.cwd();

	// 官方 @Remote IDE 扩展服务（命名空间 ide，经官方 Typert Gateway 暴露给客户端）。
	ctx.plugin(IdeRemoteService, { root });

	// Host 半身：订阅四类官方事件 + 唯一 answerer。服务缺失时按 feature-unavailable
	// 记录并跳过，不阻止插件加载，也不产生第二条连接。
	try {
		const bridge = createDshIdeHostBridge(ctx, config && config.transport ? { transport: config.transport } : {});
		bridge.follow(undefined, () => undefined);
		ctx.effect(() => () => bridge.close(), 'dsh-ide.host-bridge');
	} catch (error) {
		console.warn(`[dsh-ide] host bridge is not available: ${error && error.message ? error.message : String(error)}`);
	}
}
