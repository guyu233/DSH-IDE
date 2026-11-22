/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// tool.call.toolview 的 key 是 wire 工具名。
// 这里只决定用哪一个视图家族；具体 DOM 在对应的 content part 里画。
// details 一家覆盖记录型工具，未登记的名字落到 generic，不把所有工具画成同一张卡。

/** 一个工具视图家族。details 一家对应 DSH 的 details-row。 */
export type DshToolViewId =
	| 'bash'
	| 'read'
	| 'read-image'
	| 'file-mutation'
	| 'search'
	| 'web'
	| 'todo'
	| 'ask-question'
	| 'office'
	| 'skill'
	| 'present'
	| 'details'
	| 'generic';

const FILE_MUTATION = new Set(['apply_patch', 'edit', 'write']);
const SEARCH = new Set(['grep', 'glob']);
const WEB = new Set(['web_search', 'web_fetch']);
const OFFICE = new Set(['office_render', 'office_convert', 'office_recalculate']);

/** details-row 承载的记录型 wire 名。一个视图，不给每个名字单独造组件。 */
const DETAILS = new Set([
	'create_goal',
	'get_goal',
	'update_goal',
	'schedule_create',
	'schedule_list',
	'schedule_view',
	'schedule_edit',
	'schedule_delete',
	'schedule_update',
	'cordis_inspect',
	'cordis_inspect_list',
	'cordis_inspect_query',
	'cordis_inspect_self',
	'workflow',
	'ralph',
	'session_event_read',
	'session_event_search',
	'session_event_trace',
	'session_search',
	'session_trace',
	'list_subagent_models',
	'subagent',
	'subagent_fork',
	'list_agents',
	'send_message',
	'interrupt_agent',
	'wait_agent',
	'job_list',
	'job_output',
	'job_kill',
	'terminal_open',
	'terminal_read',
	'terminal_list',
	'terminal_signal',
	'terminal_close',
	'lsp',
	'spawn_teammate',
	'team_task_create',
	'team_task_get',
	'team_task_update',
	'team_task_list',
	'cordis_stop',
	'cordis_undefine',
	'timeline_tasks',
]);

/** 按 wire 工具名选择视图。空名字和没登记的名字都是 generic。 */
export function dshToolViewId(toolName: string): DshToolViewId {
	switch (toolName) {
		case 'bash':
			return 'bash';
		case 'read':
			return 'read';
		case 'read_image':
			return 'read-image';
		case 'todo_write':
			return 'todo';
		case 'ask_user_question':
			return 'ask-question';
		case 'skill':
			return 'skill';
		case 'present':
			return 'present';
		default:
			break;
	}
	if (FILE_MUTATION.has(toolName)) {
		return 'file-mutation';
	}
	if (SEARCH.has(toolName)) {
		return 'search';
	}
	if (WEB.has(toolName)) {
		return 'web';
	}
	if (OFFICE.has(toolName)) {
		return 'office';
	}
	if (DETAILS.has(toolName)) {
		return 'details';
	}
	return 'generic';
}

/** 测试和目录用：details 家族一共覆盖多少个 wire 名。 */
export function dshDetailsToolCount(): number {
	return DETAILS.size;
}
