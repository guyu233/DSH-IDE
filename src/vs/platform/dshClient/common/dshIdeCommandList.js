/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * 两套 backend 共用的命令列表中立投影。
 *
 * 官方 `commands.list(agent)` / Gateway `commands/list` 返回 `readonly CommandDescriptor[]`
 * （含 `definitionId` / `input` 等插件内部结构）；IDE 侧只消费中立项，不透传官方
 * 内部字段，也不在此建第二份 schema。字段与顺序由官方返回保持（list 已按 name 排序）。
 *
 * @param {unknown} descriptors - 官方返回值，形状未知时一律按空列表 fail-closed。
 * @returns {readonly { readonly name: string; readonly description: string }[]}
 */
export function projectDshIdeCommandList(descriptors) {
	if (!Array.isArray(descriptors)) {
		return [];
	}
	const commands = [];
	for (const descriptor of descriptors) {
		if (descriptor === null || typeof descriptor !== 'object') {
			continue;
		}
		const name = descriptor.name;
		const description = descriptor.description;
		if (typeof name !== 'string' || name === '' || typeof description !== 'string') {
			continue;
		}
		// name / description 是官方必填的中立字段，原样保留；空串也保留，不臆造默认值。
		commands.push({ name, description });
	}
	return commands;
}
