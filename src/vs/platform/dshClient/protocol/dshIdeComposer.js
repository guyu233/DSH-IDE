/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * 两套 backend 共用的输入框控件中立投影。
 *
 * 只保留 IDE 输入框要画的字段：当前模型与推理档、权限预设、团队开关、
 * 开聊前的智能体预设。官方内部结构（badge、任务板、插件诊断）不透传。
 * 形状不完整的条目直接丢掉，不补默认名、不伪造「当前选中」。
 *
 * @param {unknown} source
 * @returns {{
 *   model: { current: { provider: string; model: string; effort?: string } | null; groups: readonly { id: string; name: string; models: readonly { id: string; name: string; efforts: readonly { id: string; name: string }[]; defaultEffort?: string }[] }[] };
 *   permission: { current: string | null; options: readonly { value: string; name: string }[] } | null;
 *   team: { enabled: boolean; confirmDisable: boolean } | null;
 *   preset: { current: string | null; options: readonly { id: string; name: string }[] } | null;
 * }}
 */
export function projectDshIdeComposer(source) {
	const root = isRecord(source) ? source : {};
	const values = isRecord(root.values) ? root.values : {};
	const modelSelection = isRecord(values.modelSelection) ? values.modelSelection : undefined;
	const next = modelSelection !== undefined && isRecord(modelSelection.next) ? modelSelection.next : undefined;
	const current = next !== undefined && typeof next.provider === 'string' && next.provider !== '' && typeof next.model === 'string' && next.model !== ''
		? {
			provider: next.provider,
			model: next.model,
			...(typeof next.reasoningEffort === 'string' && next.reasoningEffort !== '' ? { effort: next.reasoningEffort } : {}),
		}
		: null;
	return {
		model: { current, groups: projectGroups(root.catalog) },
		permission: projectPermission(root.permission, values.permissions),
		team: projectTeam(values.agentTeam, modelSelection),
		preset: projectPreset(root.presets, values.agentPreset),
	};
}

function projectGroups(catalog) {
	const groups = isRecord(catalog) && Array.isArray(catalog.groups) ? catalog.groups : [];
	const projected = [];
	for (const group of groups) {
		if (!isRecord(group) || typeof group.id !== 'string' || group.id === '') {
			continue;
		}
		const models = [];
		for (const model of (Array.isArray(group.models) ? group.models : [])) {
			if (!isRecord(model) || typeof model.id !== 'string' || model.id === '') {
				continue;
			}
			const reasoning = isRecord(model.reasoning) ? model.reasoning : undefined;
			const efforts = [];
			for (const effort of (reasoning !== undefined && Array.isArray(reasoning.efforts) ? reasoning.efforts : [])) {
				if (!isRecord(effort) || typeof effort.id !== 'string' || effort.id === '' || typeof effort.name !== 'string' || effort.name === '') {
					continue;
				}
				efforts.push({ id: effort.id, name: effort.name });
			}
			models.push({
				id: model.id,
				name: typeof model.name === 'string' && model.name !== '' ? model.name : model.id,
				efforts,
				...(reasoning !== undefined && typeof reasoning.defaultEffort === 'string' && reasoning.defaultEffort !== ''
					? { defaultEffort: reasoning.defaultEffort }
					: {}),
			});
		}
		if (models.length === 0) {
			continue;
		}
		projected.push({
			id: group.id,
			name: typeof group.name === 'string' && group.name !== '' ? group.name : group.id,
			models,
		});
	}
	return projected;
}

function projectPermission(catalog, selection) {
	const options = [];
	const raw = isRecord(catalog) && Array.isArray(catalog.options) ? catalog.options : null;
	if (raw === null) {
		return null;
	}
	for (const option of raw) {
		// `custom` 是推导出的当前值，官方不允许把它当成切换目标。
		if (!isRecord(option) || option.value === 'custom' || typeof option.value !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(option.value)) {
			continue;
		}
		options.push({
			value: option.value,
			name: typeof option.name === 'string' && option.name !== '' ? option.name : option.value,
		});
	}
	if (options.length === 0) {
		return null;
	}
	const currentValue = isRecord(selection) && typeof selection.currentValue === 'string' ? selection.currentValue : null;
	return { current: currentValue, options };
}

function projectTeam(agentTeam, modelSelection) {
	if (!isRecord(agentTeam) || typeof agentTeam.enabled !== 'boolean') {
		return null;
	}
	return {
		enabled: agentTeam.enabled,
		confirmDisable: modelSelection !== undefined && modelSelection.lastUsed != null,
	};
}

function projectPreset(roster, current) {
	const rows = Array.isArray(roster) ? roster : (isRecord(roster) && Array.isArray(roster.presets) ? roster.presets : null);
	if (rows === null) {
		return null;
	}
	const options = [];
	for (const row of rows) {
		if (!isRecord(row) || typeof row.id !== 'string' || row.id === '' || typeof row.broken === 'string') {
			continue;
		}
		options.push({ id: row.id, name: typeof row.name === 'string' && row.name !== '' ? row.name : row.id });
	}
	if (options.length === 0) {
		return null;
	}
	return { current: typeof current === 'string' && current !== '' ? current : null, options };
}

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
