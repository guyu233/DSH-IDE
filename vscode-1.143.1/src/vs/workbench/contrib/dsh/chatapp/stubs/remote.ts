// chatapp/stubs/remote.ts
// remote 桩：Host-Remote 语义调用。**全部经 webview postMessage 桥**（bridge.rpc），绝不走 http。
//
// 与官方 @deepseek-ai/dsh-api-remotes 的语义对齐：业务代码只发 method + payload，
// 传输层（命名管道 → Host cordis 服务）由父窗口 chatWebview 负责。

import type { RemoteService } from '../types.js';
import type { ChatappBridge } from '../bridge.js';

export function createRemoteStub(bridge: ChatappBridge): RemoteService {
	return {
		invoke<Req = unknown, Res = unknown>(method: string, payload?: Req): Promise<Res> {
			return bridge.rpc<Res>(method, payload);
		},
	};
}
