/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH-IDE：原来这里注册两个「Configure Custom Agents…」动作，点开的是 VS Code 的
// Agent 自定义编辑器。本产品的智能体预设由 DSH 管理，只在 DSH 主窗口里改，所以整段
// 删除，不留死代码，也不给用户第二个不生效的入口。调用方仍保留 `registerAgentActions()`
// 这个空函数，避免改动无关的启动序列。

/**
 * 兼容入口：DSH-IDE 不提供「Configure Custom Agents…」，因此什么也不注册。
 */
export function registerAgentActions(): void {
	// 有意为空：见上方说明。
}
