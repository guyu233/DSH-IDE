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

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IdeRemoteService } from './host/ide-service.js';
import { REQUIRED_SERVICES, createDshIdeHostBridge, publishHostEndpointWhenListening, removeHostEndpoint, endpointLogText } from './host/ide-view-host.js';

export const name = 'dsh-ide';
// 只硬依赖 `sessions`（内核级、必然存在）。`sessionController` 是 API 层服务，
// 若把它写进 inject，插件会一直等它注册才 apply——真机实测会导致整插件静默不加载。
// 因此 apply 立即执行（注册 @Remote ide 服务），桥接则用 ctx.inject 等会话服务就绪后再建。
export const inject = ['sessions'];

export function apply(ctx, config = {}) {
	const root = (config && config.root) || process.cwd();
	const pluginRoot = dirname(fileURLToPath(import.meta.url));

	// 官方 @Remote IDE 扩展服务（命名空间 ide，经官方 Typert Gateway 暴露给客户端）。
	// `pluginRoot` 必须传**插件自身目录**：端点文件写在 `<plugin>/runtime/host-endpoint.json`，
	// 而 `root`（= process.cwd() = profile 根）是另一条路径。历史实现把两者混用，
	// 导致 launch() 永远找不到端点、按钮点了没反应（真机实测）。
	ctx.plugin(IdeRemoteService, { root, pluginRoot });

	// 端点自解析：由 Host 自己算出 IDE 可用的 origin + launch URL，并写入插件目录下的
	// `runtime/host-endpoint.json`。IDE 进程由操作系统单独拉起，环境变量无法传递，
	// 而文件只解决「怎么找到端口」的引导问题——传输仍是官方 HTTP/WS（第 7 章 §3.1 裁定）。
	//
	// 必须等 `webServer` 真正开始监听：`apply` 时 `webServer.port` 还是 undefined
	// （端口由 listen 回填），立刻发布只会得到「无从发布」并静默跳过（真机实测踩过）。
	const endpointFile = join(pluginRoot, 'runtime', 'host-endpoint.json');
	// D55：插件卸载 / Host 重启时删除端点文件，让一次性 query token 不再落盘。
	// ctx.effect 的清理函数在上下文销毁时调用；删除是 fire-and-forget，不阻塞卸载。
	ctx.effect(() => () => void removeHostEndpoint(endpointFile), 'dsh-ide.host-endpoint-cleanup');
	ctx.inject(['webServer', 'connection'], endpointCtx => {
		void publishHostEndpointWhenListening(endpointCtx, endpointFile).then(endpoint => {
			if (endpoint !== undefined) {
				// D55：只记录脱敏后的 origin，绝不输出 launchUrl（内含 token）。
				console.log(`[dsh-ide] host endpoint published: ${endpointLogText(endpoint)}`);
			} else {
				console.warn('[dsh-ide] host endpoint not published within timeout: webServer never reported a port');
			}
		});
	});

	// Host 半身：订阅四类官方事件 + 唯一 answerer。
	// 等会话 API 与工作区记账均就绪再建桥接；复用桥接自检清单，避免启动次序与声明漂移。
	ctx.inject(REQUIRED_SERVICES, bridgeCtx => {
		try {
			const bridge = createDshIdeHostBridge(bridgeCtx, config && config.transport ? { transport: config.transport } : {});
			bridge.follow(undefined, () => undefined);
			bridgeCtx.effect(() => () => bridge.close(), 'dsh-ide.host-bridge');
			console.log('[dsh-ide] host bridge attached');
		} catch (error) {
			console.warn(`[dsh-ide] host bridge is not available: ${error && error.message ? error.message : String(error)}`);
		}
	});
}
