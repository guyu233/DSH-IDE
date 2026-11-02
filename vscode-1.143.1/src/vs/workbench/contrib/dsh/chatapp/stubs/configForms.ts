// chatapp/stubs/configForms.ts
// configForms 桩：配置表单服务的最小只读实现。
// ui-conversation 用 ctx.configForms.get(key) 读取配置、ctx.configForms.developerTools 判定调试工具开关。
// chat-only 子应用里没有完整的设置编辑器，因此 get 一律返回 undefined（走默认），developerTools 固定关闭。

import type { ConfigFormsService } from '../types.js';
import { createStore } from './store.js';

export function createConfigFormsStub(): ConfigFormsService {
	const developerTools = createStore(false);
	return {
		get(_key: string): unknown { return undefined; },
		developerTools: {
			getSnapshot: () => developerTools.getSnapshot(),
			subscribe: (listener: () => void) => developerTools.subscribe(listener),
		},
	};
}
