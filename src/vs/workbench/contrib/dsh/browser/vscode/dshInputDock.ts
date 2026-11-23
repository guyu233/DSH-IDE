/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


// 输入区两个 dock 槽的投影（官方 `conversation.input.dock` / `conversation.composer.dock`）。
//
// 官方语义（`ui-conversation/src/client/contract/slots.ts`）：
//   - `conversation.input.dock` 是 `list` / `session`，owner 是 `InputZone { session, input }`，
//     渲染在输入卡**上方**的整行区域（todo / goal / queue 这类常驻条）；
//   - `conversation.composer.dock` 也是 `list` / `session`，没有 owner props，
//     渲染在输入卡**下方**的环境区。
//
// 本仓此前只声明、没有消费点。这里把 occupant 投影成纯数据行，DOM 由
// `DshChatInputDock` 负责；投影本身零 DOM、可单测，避免把「有没有 occupant」与
// 「画成什么」混在一起。

import { localize } from '../../../../../nls.js';
import { formatTokens } from './dshTokenFormat.js';
import type { DshIdeContextPressure, DshIdeInboxMessage, DshIdeTokenUsageTotal } from '../../../../../platform/dshClient/protocol/dshIdeProtocol.js';
import { dshChatSlotRegistry, DSH_COMPOSER_DOCK_SLOT, DSH_INPUT_DOCK_SLOT } from './dshChatSlots.js';

/** 一个 dock occupant 投影出来的一行。 */
export interface DshInputDockRow {
	readonly id: string;
	/** 可直接显示的文本。没有文本的 occupant 不成行（不画空行）。 */
	readonly label: string;
	/** 可选的可访问性描述；缺省用 label。 */
	readonly description?: string;
	/** 点击时执行的宿主命令；缺省表示纯展示。 */
	readonly command?: string;
	readonly arguments?: readonly unknown[];
	/** 低值更靠前（官方 list 的 order）。 */
	readonly order: number;
	/**
	 * 队列行的行内动作（官方 `QueueDock` 的 edit/remove/steer）。
	 *
	 * 只对队列行有意义：插件 occupant 的动作走 `command`，两者互补不混用。
	 * 动作不在这里执行——由渲染层回调到 `DshChatSession.updateQueue`。
	 */
	readonly queueActions?: readonly DshQueueRowAction[];
}

/** 一条队列行可以执行的动作（与官方 `QueueAction` 的三种一一对应）。 */
export type DshQueueRowAction = 'edit' | 'remove' | 'steer';

/**
 * 官方 `conversation.input.dock` 的 owner（`InputZone`）。
 *
 * `session` 是当前会话快照，`input` 是输入机状态。本仓不复制 DSH 的会话事实，
 * 也不自造输入机模型：调用方把已经存在的本地输入状态原样传入，缺省表示「还不知道」，
 * occupant 必须自己容忍 `undefined`（与官方 `InputZone` 的必填语义不同，这里
 * 不伪造一个假的输入状态）。
 */
export interface DshInputZoneOwner {
	readonly session: unknown;
	readonly input?: unknown;
}

/** `resolve()` 返回的 occupant 里本文件要读的那几个字段。 */
interface DshSlotOccupantView {
	readonly id?: string;
	readonly order: number;
	readonly props: Readonly<Record<string, unknown>>;
}

/**
 * 取 `conversation.input.dock` 的全部行（官方 list 语义：按 `order` 升序，`id` 稳定）。
 *
 * `sessionId` 是槽位作用域的绑定（官方 scope 是 `session`）；`zone` 是官方 owner
 * `InputZone { session, input }`。两者都必须有才能解析：没有会话时不把 occupant
 * 挂在无会话的输入区上。
 */
export function dshInputDockRows(sessionId: string | undefined, zone: DshInputZoneOwner | undefined): readonly DshInputDockRow[] {
	if (sessionId === undefined || sessionId === '' || zone === undefined || zone.session === undefined || zone.session === null) {
		return [];
	}
	return projectDockRows(DSH_INPUT_DOCK_SLOT, sessionId, { session: zone.session, input: zone.input });
}

/**
 * 取 `conversation.composer.dock` 的全部行。
 *
 * 这个槽没有 owner props，只按会话解析；没有会话时不解析。
 */
export function dshComposerDockRows(sessionId: string | undefined, usage?: DshIdeTokenUsageTotal, mode: 'detailed' | 'compact' = 'detailed', pressure?: DshIdeContextPressure): readonly DshInputDockRow[] {
	if (sessionId === undefined || sessionId === '') {
		return [];
	}
	// 官方 `ui-chat` 的 composer 统计控件是 `conversation.composer.dock` 的**两个内置项**：
	// `activity`（order 0）与 `usage`（order 1）。本仓没有 activity 的权威数据源
	// （turn/step 计数在 `turn-process` 节点上、按 Turn 分散），所以只实现 `usage`——
	// 有数据才画，没有就不占位（不伪造 0）。
	return [...projectDockRows(DSH_COMPOSER_DOCK_SLOT, sessionId, undefined), ...dshComposerActivityRows(pressure, mode), ...dshComposerUsageRows(usage, mode)];
}

/**
 * composer 的用量统计行（官方 `usage` 项，order 1）。
 *
 * 官方「Turn token usage」：「The composer statistics are two `conversation.composer.dock` list entries:
 * `activity` (order 0 …) and **`usage` (order 1, token total and cache hit)**。」
 *
 * @param usage 官方 `tokenUsage` 投影（整会话累加）；缺省表示还没有任何用量
 * @returns 至多一行；没有用量时不画
 */
/**
 * composer 的上下文占用行（官方 `activity` 项，order 0）。
 *
 * 官方「Turn token usage」把 composer 统计定为**两个** dock 项：`activity`（order 0）与 `usage`（order 1）。
 * 官方 token-meter README 给了 activity 的算法：「A UI computes occupancy by **dividing measured pressure
 * by the separately resolved capacity for the selected model**」。
 *
 * 本仓可用的两项：`pressureTokens`（最新 provider 报告的 prompt 大小）与 `contextWindow`（容量）。
 * 两者都有才画——**缺一个就不画**，不猜分母、也不把 `projectedTokens` 冒充实测压力。
 *
 * @param pressure 官方 `contextPressure` 投影
 * @param mode 官方 `ui-chat.performanceUsage`；`compact` 下不画（官方：compact 只留输出速度与命中率）
 * @returns 至多一行；数据不全或 compact 模式返回空
 */
export function dshComposerActivityRows(pressure: DshIdeContextPressure | undefined, mode: 'detailed' | 'compact' = 'detailed'): readonly DshInputDockRow[] {
	if (mode === 'compact' || pressure === undefined) {
		return [];
	}
	const used = pressure.pressureTokens;
	const capacity = pressure.contextWindow;
	if (used === undefined || capacity === undefined || capacity <= 0) {
		// 缺压力或缺容量都不画：分母不可猜，分子不能拿 projectedTokens 冒充。
		return [];
	}
	const percent = Math.min(100, Math.round((used / capacity) * 100));
	return [{
		id: 'composer-activity',
		label: localize('dsh.composer.contextUsed', "{0}% context used", percent),
		order: 0,
	}];
}

export function dshComposerUsageRows(usage: DshIdeTokenUsageTotal | undefined, mode: 'detailed' | 'compact' = 'detailed'): readonly DshInputDockRow[] {
	if (usage === undefined) {
		return [];
	}
	const total = usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
	if (total <= 0) {
		// 全零不画：那是「还没有用量」，不是「用量为 0」。
		return [];
	}
	// 缓存命中率：cacheRead 占「可缓存输入」的比例（uncached + cacheRead）。
	const cacheable = usage.uncachedInputTokens + usage.cacheReadTokens;
	const hitRate = cacheable <= 0 ? undefined : Math.round((usage.cacheReadTokens / cacheable) * 100);
	// 官方 `ui-chat.performanceUsage`：`compact` **只留**「输出速度 + 缓存命中率」，不显示总量。
	// 本仓没有权威的输出速度数据源（官方措辞是「**available** output speed」——有才显示），
	// 所以 `compact` 下只保留命中率；没有命中率时整行不画（不伪造速度）。
	if (mode === 'compact') {
		return hitRate === undefined ? [] : [{
			id: 'composer-usage',
			label: localize('dsh.composer.cacheHit', "{0}% cache hit", hitRate),
			order: 1,
		}];
	}
	return [{
		id: 'composer-usage',
		label: hitRate === undefined
			? localize('dsh.composer.tokens', "{0} tokens", formatTokens(total))
			: localize('dsh.composer.tokensCacheHit', "{0} tokens · {1}% cache hit", formatTokens(total), hitRate),
		order: 1,
	}];
}

function projectDockRows(slot: string, sessionId: string | undefined, props: Readonly<Record<string, unknown>> | undefined): readonly DshInputDockRow[] {
	const resolved = dshChatSlotRegistry.resolve(slot, {
		...(sessionId === undefined ? {} : { sessionId }),
		...(props === undefined ? {} : { props }),
	}) as { readonly occupants?: readonly DshSlotOccupantView[] } | undefined;
	const rows: DshInputDockRow[] = [];
	for (const occupant of resolved?.occupants ?? []) {
		const id = occupant.id;
		const label = occupant.props.label;
		if (id === undefined || typeof label !== 'string' || label.trim() === '') {
			continue;
		}
		const description = occupant.props.description;
		const command = occupant.props.command;
		const args = occupant.props.arguments;
		rows.push({
			id,
			label,
			...(typeof description === 'string' && description !== '' ? { description } : {}),
			...(typeof command === 'string' && command !== '' ? { command, ...(Array.isArray(args) ? { arguments: args } : {}) } : {}),
			order: occupant.order,
		});
	}
	// 官方 list 按 order 升序；同 order 用 id 稳定排序，保证多次渲染顺序一致（不靠注册顺序）。
	rows.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
	return rows;
}

/**
 * 排队消息 → `conversation.input.dock` 的一行（官方 `QueueDock` 的等价投影）。
 *
 * 官方 `queueDockEntry` 注册在 `conversation.input.dock`，`id: 'queue'`、`order: 20`；
 * 数据源是 `inbox` 投影的 `next-turn`。本仓把「排队行」也投影成 dock 行，
 * 因此队列与其它 dock occupant 共用同一套 list 语义（order 排序、无 occupant 不占位）。
 *
 * 与官方一致的行为：一条时直接显示该条预览；多条时显示「N 条排队」的计数头
 * （是否展开由调用方的折叠态决定）；预览取 text 块，没有则退回附件名，绝不画空行；
 * 队列为空返回空数组。
 */
/** 官方 `QueueDock` 在可变更时提供的三种动作，顺序与官方按钮一致。 */
const QUEUE_ACTIONS: readonly DshQueueRowAction[] = ['steer', 'edit', 'remove'];

export function dshQueueDockRows(messages: readonly DshIdeInboxMessage[] | undefined, kind: 'next-turn' | 'next-step' = 'next-turn'): readonly DshInputDockRow[] {
	const rows = (messages ?? []).filter(message => message !== null && typeof message === 'object');
	if (rows.length === 0) {
		return [];
	}
	const attachments = (message: DshIdeInboxMessage): readonly string[] => message.content.flatMap(block => {
		if (block['type'] !== 'image' && block['type'] !== 'file') {
			return [];
		}
		const name = typeof block['name'] === 'string' && block['name'] !== '' ? block['name'] : undefined;
		return name === undefined ? [] : [name];
	});
	const textOf = (message: DshIdeInboxMessage): string | undefined => {
		const texts = message.content.flatMap(block => block['type'] === 'text' && typeof block['text'] === 'string' && block['text'] !== '' ? [block['text']] : []);
		return texts.length === 0 ? undefined : texts.join('\n');
	};
	const previewOf = (message: DshIdeInboxMessage): string => textOf(message) ?? attachments(message).join(', ');
	if (rows.length === 1) {
		const preview = previewOf(rows[0]);
		// 一条时也必须是非空行：正文与附件都没有就不画（与官方 `textOf`/`queueAttachments` 的容忍一致）。
		// `next-step` 是「转向」：与排队等下一轮的消息分开成行，id 不能撞。
		return preview === '' ? [] : [{ id: kind === 'next-turn' ? 'queue' : 'queue-steer', label: preview, order: kind === 'next-turn' ? 20 : 21, queueActions: QUEUE_ACTIONS }];
	}
	const first = previewOf(rows[0]);
	return [{
		id: kind === 'next-turn' ? 'queue' : 'queue-steer',
		label: kind === 'next-turn'
			? localize('dsh.queue.count', "{0} queued", rows.length)
			: localize('dsh.queue.steerCount', "{0} to steer", rows.length),
		...(first === '' ? {} : { description: first }),
		order: kind === 'next-turn' ? 20 : 21,
		queueActions: QUEUE_ACTIONS,
	}];
}
