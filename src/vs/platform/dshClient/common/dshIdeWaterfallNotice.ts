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

import { projectApprovalRequest, projectQuestionRequest } from './dshIdeRequestView.js';
import type {
	DshIdeApprovalRequestView,
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
		const request = projectApprovalRequest(frame['request']) as DshIdeApprovalRequestView | undefined;
		if (request === undefined) {
			return undefined;
		}
		return { kind: 'request', eventId, event: 'approval/request', agentId, request };
	}
	if (frame['event'] === 'user-questions/request') {
		const request = projectQuestionRequest(frame['request']) as DshIdeQuestionRequestView | undefined;
		if (request === undefined) {
			return undefined;
		}
		return { kind: 'request', eventId, event: 'user-questions/request', agentId, request };
	}
	return undefined;
}
