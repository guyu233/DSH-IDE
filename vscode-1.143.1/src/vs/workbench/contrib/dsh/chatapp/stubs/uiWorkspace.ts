// chatapp/stubs/uiWorkspace.ts
// uiWorkspace 桩：工作区级动作（切换/打开会话）。动作交给 IDE 父窗口（postMessage）。
//
// 另有 sidebarRight / openExternalLink 等由 ui-chat 直接调用的 UI 动作，也在 root 的作用域 ctx
// 上以最简桩提供（openResource/openTab），避免 ui-chat 因缺失而抛错。

import type { UiWorkspaceService } from '../types.js';
import type { ChatappBridge } from '../bridge.js';

export function createUiWorkspaceStub(bridge: ChatappBridge): UiWorkspaceService {
	return {
		openSession(sessionId: string): void {
			// 交给 IDE：切换/打开对应会话视图。
			bridge.action('openSession', { sessionId });
		},
	};
}
