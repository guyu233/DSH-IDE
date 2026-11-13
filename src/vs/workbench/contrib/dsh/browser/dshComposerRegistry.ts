/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 输入框三个选择器的数据源注册表。
//
// 为什么用注册表而不是构造参数：`ChatInputPart` 的创建点分散在 Chat 视图、编辑器内联
// 聊天、快速聊天等多处，逐个传参会漏。DSH 贡献点在窗口恢复时注册一次，之后所有输入框
// 都读同一份，既保证第一帧就有数据，也不重复请求。

import { Emitter } from '../../../../base/common/event.js';
import type { IDshComposerSource } from './dshComposerSource.js';

/**
 * DSH 窗口的占位数据源：模型、权限、预设都为空，`locked` 为 false。
 *
 * 为什么需要它：DSH 贡献点在恢复阶段才创建真正的数据源，而 Chat 输入框在那之前
 * 就可能已经建好并读了一次模型列表。如果没有占位，那一次会读到 VS Code 自带的模型，
 * 用户就会看到「先显示 VS Code 模型、一秒后跳成 DSH 模型」。占位让第一帧就是空的
 * DSH 列表，之后由真数据源替换。
 */
const placeholderChanges = new Emitter<void>();
const PLACEHOLDER: IDshComposerSource = {
	state: { models: [], current: null, permission: null, team: null, presets: null, locked: false },
	onDidChange: placeholderChanges.event,
	refresh: async () => undefined,
	selectModel: async () => undefined,
	selectEffort: async () => undefined,
	selectPreset: async () => undefined,
	selectPermission: async () => undefined,
	setTeam: async () => undefined,
};

let current: IDshComposerSource | undefined = PLACEHOLDER;
const listeners = new Set<(source: IDshComposerSource | undefined) => void>();

/** DSH 贡献点在构造时登记数据源；窗口关闭时传 undefined 注销。 */
export function setDshComposerSource(source: IDshComposerSource | undefined): void {
	if (current === source) {
		return;
	}
	current = source;
	for (const listener of listeners) {
		listener(source);
	}
}

/** 输入框读取当前数据源；DSH 未就绪时返回 undefined，选择器退回 VS Code 自带数据。 */
export function getDshComposerSource(): IDshComposerSource | undefined {
	return current;
}

/** 订阅数据源换人（输入框在挂载后才知道 DSH 是否就绪）。 */
export function onDidChangeDshComposerSource(listener: (source: IDshComposerSource | undefined) => void): { dispose(): void } {
	listeners.add(listener);
	return { dispose: () => listeners.delete(listener) };
}
