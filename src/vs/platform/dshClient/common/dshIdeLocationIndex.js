// src/vs/platform/dshClient/common/dshIdeLocationIndex.js
// 事件定位索引 —— 精确对照 DSH
// `@deepseek-ai/dsh-client-ui-conversation` `conversation/location-index.ts` 的 `rebuild()`。
//
// 为什么必须有它：`user/message` / `tool/result` 这些事件**本身不带 turn**。DSH 靠顺序
// 扫描事件流、维护 currentTurn / currentStep 游标给每个事件定位，节点再按 seq 落进 Turn 区间。
// 没有这层，所有用户消息都会被推到末尾（真机表现为「用户发的消息全挤到下面」）。
//
// 算法逐行对照上游：
//   - turn/start 开 Turn 并清 Step；step/start 开 Step
//   - 事件自带 turn/step 时以它为准（data.turn === null 表示 session 级）
//   - turn/end / step/end 关闭游标
//   - turn/start 与 turn/end 自身不带 step

/**
 * 读一个事件自带的坐标。
 * @param {object} event - { type, data }
 * @returns {{ session: boolean, turn?: number, step?: number }}
 */
function payloadCoordinates(event) {
	const data = event.data;
	if (data === null || typeof data !== 'object') {
		return { session: false };
	}
	if (data.turn === null) {
		return { session: true };
	}
	const turn = Number.isSafeInteger(data.turn) && data.turn >= 0 ? data.turn : undefined;
	const step = Number.isSafeInteger(data.step) && data.step >= 0 ? data.step : undefined;
	return {
		session: false,
		...(turn === undefined ? {} : { turn }),
		...(step === undefined ? {} : { step }),
	};
}

/**
 * 顺序扫描事件流，给每个 seq 算出 Turn/Step 坐标。
 * @param {readonly { seq: number, type: string, data: unknown }[]} entries - 按 seq 升序。
 * @returns {Map<number, { turn?: number, step?: number }>} seq → 坐标。
 */
export function indexLocations(entries) {
	const coordinates = new Map();
	let currentTurn;
	let currentStep;
	for (const event of entries) {
		const explicit = payloadCoordinates(event);
		if (event.type === 'turn/start') {
			currentTurn = event.data.turn;
			currentStep = undefined;
		}
		if (event.type === 'step/start') {
			currentTurn = event.data.turn;
			currentStep = event.data.step;
		}
		if (explicit.session !== true && explicit.turn !== undefined) {
			if (currentTurn !== explicit.turn) {
				currentStep = undefined;
			}
			currentTurn = explicit.turn;
			if (explicit.step !== undefined) {
				currentStep = explicit.step;
			}
		}
		const turn = explicit.session === true ? undefined : explicit.turn ?? currentTurn;
		const step = explicit.session === true || event.type === 'turn/start' || event.type === 'turn/end'
			? undefined
			: explicit.step ?? (turn === currentTurn ? currentStep : undefined);
		coordinates.set(event.seq, {
			...(turn === undefined ? {} : { turn }),
			...(turn === undefined || step === undefined ? {} : { step }),
		});

		if (event.type === 'step/end' && currentTurn === event.data.turn && currentStep === event.data.step) {
			currentStep = undefined;
		}
		if (event.type === 'turn/end' && currentTurn === event.data.turn) {
			currentTurn = undefined;
			currentStep = undefined;
		}
	}
	return coordinates;
}
