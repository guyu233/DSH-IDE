/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 批准 / 问卷请求的中立投影（Host `describeRequest` 与 IDE `projectDshIdeWaterfallNotice` 共用）。
//
// 依据（E:/deepseek-harness）：
//   - `packages/interaction/user-approval/src/types.ts` `ApprovalRequestEvent`
//   - `packages/interaction/user-questions/src/types.ts` `AskUserQuestionItem` / `AskUserQuestionIntent`
// 只保留可 JSON 化的官方字段。`agent` 对象与 `AbortSignal` 不进线协议（agentId 在通知信封上，
// signal 留在 Host 的等待句柄里）。形状不完整的本地化文案 / intent 直接丢掉，不猜、不告警。

/**
 * @param {unknown} request
 * @returns {{ toolName: string, callId?: string, reason?: string, displayReason?: Readonly<Record<string, string>> } | undefined}
 */
export function projectApprovalRequest(request) {
	if (!isRecord(request) || typeof request.toolName !== 'string' || request.toolName === '') {
		return undefined;
	}
	const displayReason = copyLocale(request.displayReason);
	return {
		toolName: request.toolName,
		...(typeof request.callId === 'string' && request.callId !== '' ? { callId: request.callId } : {}),
		...(typeof request.reason === 'string' && request.reason !== '' ? { reason: request.reason } : {}),
		...(displayReason !== undefined ? { displayReason } : {}),
	};
}

/**
 * @param {unknown} request
 * @returns {{ questions: readonly Record<string, unknown>[] } | undefined}
 */
export function projectQuestionRequest(request) {
	if (!isRecord(request) || !Array.isArray(request.questions)) {
		return undefined;
	}
	const questions = [];
	for (const item of request.questions) {
		const projected = projectQuestionItem(item);
		if (projected !== undefined) {
			questions.push(projected);
		}
	}
	if (questions.length === 0) {
		return undefined;
	}
	return { questions };
}

function projectQuestionItem(item) {
	if (!isRecord(item) || typeof item.id !== 'string' || item.id === '') {
		return undefined;
	}
	const options = projectOptions(item.options);
	const intent = projectIntent(item.intent);
	return {
		id: item.id,
		...(typeof item.question === 'string' && item.question !== '' ? { question: item.question } : {}),
		...(typeof item.detail === 'string' && item.detail !== '' ? { detail: item.detail } : {}),
		...(typeof item.header === 'string' && item.header !== '' ? { header: item.header } : {}),
		...(options !== undefined ? { options } : {}),
		...(typeof item.multiSelect === 'boolean' ? { multiSelect: item.multiSelect } : {}),
		...(intent !== undefined ? { intent } : {}),
	};
}

function projectOptions(value) {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const options = [];
	for (const option of value) {
		if (!isRecord(option) || typeof option.label !== 'string' || option.label === '') {
			continue;
		}
		options.push({
			label: option.label,
			...(typeof option.description === 'string' && option.description !== '' ? { description: option.description } : {}),
		});
	}
	return options.length > 0 ? options : undefined;
}

function projectIntent(value) {
	if (!isRecord(value)) {
		return undefined;
	}
	if (value.kind === 'plan-review') {
		if (typeof value.approve !== 'string' || value.approve === '') {
			return undefined;
		}
		return {
			kind: 'plan-review',
			approve: value.approve,
			...(typeof value.callId === 'string' && value.callId !== '' ? { callId: value.callId } : {}),
		};
	}
	if (value.kind === 'approval') {
		if (typeof value.approve !== 'string' || value.approve === '' || typeof value.reject !== 'string' || value.reject === '') {
			return undefined;
		}
		const subject = isRecord(value.subject) && typeof value.subject.name === 'string' && value.subject.name !== ''
			? {
				name: value.subject.name,
				...(typeof value.subject.icon === 'string' && value.subject.icon !== '' ? { icon: value.subject.icon } : {}),
			}
			: undefined;
		const display = projectIntentDisplay(value.display);
		return {
			kind: 'approval',
			approve: value.approve,
			reject: value.reject,
			...(typeof value.always === 'string' && value.always !== '' ? { always: value.always } : {}),
			...(subject !== undefined ? { subject } : {}),
			...(display !== undefined ? { display } : {}),
		};
	}
	return undefined;
}

function projectIntentDisplay(value) {
	if (!isRecord(value)) {
		return undefined;
	}
	const question = copyLocale(value.question);
	if (question === undefined) {
		return undefined;
	}
	const detail = copyLocale(value.detail);
	const approve = copyLocale(value.approve);
	return {
		question,
		...(detail !== undefined ? { detail } : {}),
		...(approve !== undefined ? { approve } : {}),
	};
}

/** 官方 locale map：必须有非空 `en`，其余键也必须是非空字符串。任一格不合法则整份丢掉。 */
function copyLocale(value) {
	if (!isRecord(value) || typeof value.en !== 'string' || value.en.trim() === '') {
		return undefined;
	}
	const out = {};
	for (const key of Object.keys(value)) {
		if (key.trim() === '' || /\s/.test(key)) {
			return undefined;
		}
		const item = value[key];
		if (typeof item !== 'string' || item.trim() === '') {
			return undefined;
		}
		out[key] = item;
	}
	return out;
}

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
