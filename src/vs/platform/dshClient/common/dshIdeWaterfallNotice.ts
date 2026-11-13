/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 把内核转发的批准 / 问卷帧投影成 IDE 中立通知。
//
// 线上帧由 host/ide-view-host.js 的 `_share` 产出：
// `{ type:'waterfall', kind:'request', eventId, event, agentId, request }`
// 或 `{ type:'waterfall', kind:'cancel', eventId }`。
// 不认识的事件名、缺标识、请求体不是普通对象，一律丢弃（fail-closed，不猜）。不透传 agent / signal。

import type {
	DshIdeApprovalRequestView,
	DshIdeQuestionItemView,
	DshIdeQuestionOptionView,
	DshIdeQuestionRequestView,
	DshIdeWaterfallNotice,
} from './dshIdeProtocol.js';

export function projectDshIdeWaterfallNotice(raw: unknown): DshIdeWaterfallNotice | undefined {
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
		return undefined;
	}
	const frame = raw as Record<string, unknown>;
	if (frame['type'] !== 'waterfall') {
		return undefined;
	}
	const eventId = frame['eventId'];
	if (typeof eventId !== 'string' || eventId === '') {
		return undefined;
	}
	if (frame['kind'] === 'cancel') {
		return { kind: 'cancel', eventId };
	}
	if (frame['kind'] !== 'request') {
		return undefined;
	}
	const agentId = frame['agentId'];
	if (typeof agentId !== 'string' || agentId === '') {
		return undefined;
	}
	if (frame['event'] === 'approval/request') {
		const request = projectApproval(frame['request']);
		if (request === undefined) {
			return undefined;
		}
		return { kind: 'request', eventId, event: 'approval/request', agentId, request };
	}
	if (frame['event'] === 'user-questions/request') {
		const request = projectQuestion(frame['request']);
		if (request === undefined) {
			return undefined;
		}
		return { kind: 'request', eventId, event: 'user-questions/request', agentId, request };
	}
	return undefined;
}

function projectApproval(request: unknown): DshIdeApprovalRequestView | undefined {
	if (request === null || typeof request !== 'object' || Array.isArray(request)) {
		return undefined;
	}
	const record = request as Record<string, unknown>;
	if (typeof record['toolName'] !== 'string' || record['toolName'] === '') {
		return undefined;
	}
	return {
		toolName: record['toolName'],
		...(typeof record['callId'] === 'string' && record['callId'] !== '' ? { callId: record['callId'] } : {}),
		...(typeof record['reason'] === 'string' && record['reason'] !== '' ? { reason: record['reason'] } : {}),
	};
}

function projectQuestion(request: unknown): DshIdeQuestionRequestView | undefined {
	if (request === null || typeof request !== 'object' || Array.isArray(request)) {
		return undefined;
	}
	const record = request as Record<string, unknown>;
	if (!Array.isArray(record['questions'])) {
		return undefined;
	}
	const questions: DshIdeQuestionItemView[] = [];
	for (const item of record['questions']) {
		if (item === null || typeof item !== 'object' || Array.isArray(item)) {
			continue;
		}
		const question = item as Record<string, unknown>;
		if (typeof question['id'] !== 'string' || question['id'] === '') {
			continue;
		}
		const view: DshIdeQuestionItemView = { id: question['id'] };
		if (typeof question['question'] === 'string' && question['question'] !== '') {
			questions.push({
				...view,
				question: question['question'],
				...projectOptions(question),
			});
			continue;
		}
		questions.push({ ...view, ...projectOptions(question) });
	}
	if (questions.length === 0) {
		return undefined;
	}
	return { questions };
}

function projectOptions(question: Record<string, unknown>): Pick<DshIdeQuestionItemView, 'options' | 'multiSelect'> {
	const options: DshIdeQuestionOptionView[] = [];
	if (Array.isArray(question['options'])) {
		for (const option of question['options']) {
			if (option !== null && typeof option === 'object' && !Array.isArray(option)) {
				const label = (option as Record<string, unknown>)['label'];
				if (typeof label === 'string' && label !== '') {
					options.push({ label });
				}
			}
		}
	}
	return {
		...(options.length > 0 ? { options } : {}),
		...(question['multiSelect'] === true ? { multiSelect: true as const } : {}),
	};
}
