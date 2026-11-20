/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// MCP 服务器和后台作业的名单投影。
//
// Host 把官方 list 原样送回来。条目可能是 null，状态可能是字符串而不是 { state, reason }。
// 直接读 `.name` / `.status.state` 会在打开选择器之前抛错，命令没有 catch，用户什么都看不到。

export interface DshMcpChoice {
	readonly name: string;
	readonly description: string;
}

export interface DshJobChoice {
	readonly id: string;
	readonly label: string;
	readonly description: string;
}

/** 状态是字符串就原样显示；是对象则取 state，reason 只有字符串才附上。 */
export function dshMcpStatusText(status: unknown): string {
	if (typeof status === 'string' && status !== '') {
		return status;
	}
	if (status === null || typeof status !== 'object') {
		return 'unknown';
	}
	const record = status as { readonly state?: unknown; readonly reason?: unknown };
	const state = typeof record.state === 'string' && record.state !== '' ? record.state : 'unknown';
	const reason = typeof record.reason === 'string' && record.reason !== '' ? ` (${record.reason})` : '';
	return `${state}${reason}`;
}

/** 只留下有名字的服务器。null、缺名字的行丢掉，不抛错。同名只保留第一份。 */
export function dshMcpChoices(value: unknown): readonly DshMcpChoice[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const choices: DshMcpChoice[] = [];
	// Host 侧 `mcpListServers` 原样返回 `mcpManager.list()`，不去重。
	// 同名服务器出现两次时，选择器会有两行一样的名字，「重启」打到哪个说不清。
	const seen = new Set<string>();
	for (const item of value) {
		if (item === null || typeof item !== 'object') {
			continue;
		}
		const name = (item as { readonly name?: unknown }).name;
		if (typeof name !== 'string' || name === '' || seen.has(name)) {
			continue;
		}
		seen.add(name);
		choices.push({ name, description: dshMcpStatusText((item as { readonly status?: unknown }).status) });
	}
	return choices;
}

/** 只留下有 id 的作业。没有 label 时用 id，避免选择器空白。 */
export function dshJobChoices(value: unknown): readonly DshJobChoice[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const choices: DshJobChoice[] = [];
	// 同 `dshMcpChoices`：Host 原样返回作业列表，同 id 出现两次时
	// 选择器会有两行一样的作业，「终止」打到哪个说不清。
	const seen = new Set<string>();
	for (const item of value) {
		if (item === null || typeof item !== 'object') {
			continue;
		}
		const record = item as { readonly id?: unknown; readonly label?: unknown; readonly status?: unknown; readonly progress?: unknown; readonly detail?: unknown };
		if (typeof record.id !== 'string' || record.id === '' || seen.has(record.id)) {
			continue;
		}
		seen.add(record.id);
		const label = typeof record.label === 'string' && record.label !== '' ? record.label : record.id;
		const parts = [typeof record.status === 'string' && record.status !== '' ? record.status : 'unknown'];
		if (typeof record.progress === 'string' && record.progress !== '') {
			parts.push(record.progress);
		}
		if (typeof record.detail === 'string' && record.detail !== '') {
			parts.push(record.detail);
		}
		choices.push({ id: record.id, label, description: parts.join(' · ') });
	}
	return choices;
}
