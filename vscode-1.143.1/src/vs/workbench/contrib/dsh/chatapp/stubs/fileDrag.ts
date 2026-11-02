// chatapp/stubs/fileDrag.ts
// fileDrag 桩：把拖入聊天的文件交给 IDE（经 postMessage 桥 action 'openResource'/'openExternal'）。
//
// ui-chat 的附件/拖拽最终需要一个“在 IDE 里打开/定位资源”的动作；在 chat-only 子应用里
// 该动作必须落到父窗口（VS Code workbench），而不是 webview 内自行处理。

import type { FileDragService } from '../types.js';
import type { ChatappBridge } from '../bridge.js';

export function createFileDragStub(bridge: ChatappBridge): FileDragService {
	return {
		async drop(paths: string[], sessionId: string): Promise<{ handled: boolean }> {
			if (!paths || paths.length === 0) { return { handled: false }; }
			// 交给 IDE：在编辑器中打开这些文件（首个聚焦），并把会话 id 一并带上供上下文关联。
			bridge.action('openResource', { sessionId, paths });
			return { handled: true };
		},
	};
}
