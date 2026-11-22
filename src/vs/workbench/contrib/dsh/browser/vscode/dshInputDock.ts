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
}

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
export function dshComposerDockRows(sessionId: string | undefined): readonly DshInputDockRow[] {
	if (sessionId === undefined || sessionId === '') {
		return [];
	}
	return projectDockRows(DSH_COMPOSER_DOCK_SLOT, sessionId, undefined);
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
