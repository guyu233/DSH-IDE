// src/vs/platform/dshClient/index.js
// DSH-IDE Host Cordis 插件入口（v2 / R1，Cordis bundle plugin，apply 形式；纯 Node-ESM）。
//
// v2 定稿：DSH-IDE = DSH 桌面 App 单一 Host 的「第二个官方客户端」。传输 100% 官方：
//   - Host 侧不再有私有命名管道 / 通道 A/B / ide_*。
//   - IDE（VS Code）作为外部进程，用官方 dsh-client-connection（/api + /api/remote.mux + cookie）
//     连到本 Host；登录 token 由 ctx.connection.authenticatedUrl() 派生。
//
// 本插件（Host 侧）当前职责（R1 最小）：
//   - 注册 @Remote IDE 扩展服务（ctx.remote.ide.*）。
// 第一批清理已移除私有 HTTP launch 链；开窗改由阶段 2 DshIdeChannel 承担。

import { IdeRemoteService } from './host/ide-service.js';

export const name = 'dsh-ide';
export const inject = [];

export function apply(ctx, config = {}) {
	// 注册官方 @Remote IDE 扩展服务（命名空间 ide，经官方 Typert Gateway 暴露给客户端）。
	ctx.plugin(IdeRemoteService, { root: (config && config.root) || process.cwd() });
}
