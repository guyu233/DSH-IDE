/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Chat 层槽位声明与消费点。
//
// 基数与作用域必须与官方 SlotMap 一致，否则接入 occupant 时选出规则会错
// （list 排序、chain 选举、hoc 包层）。声明幂等：重复登记同一份清单不会抛错。
//
// 已有消费点的槽：`conversation.chat.node`、`tool.call.toolview`、
// `conversation.chat.turnTail`、`shell.quota-notice`、`conversation.chat.reasoning.body`、
// `conversation.chat.assistant-actions`、`conversation.chat.user.before`、
// `conversation.chat.text-interaction`、`conversation.chat.aside`。
// 仍只声明、尚无消费点的槽：`conversation.chat.markdown.fence`、
// `conversation.input.dock`、`conversation.composer.dock`。

import { DshSlotRegistry } from './dshSlotRegistry.js';
import type { DshSlotDeclaration } from './dshSlotTypes.js';

/** 工具视图扩展点的槽位名（官方 keyed / session，key 是 wire 工具名）。 */
export const DSH_TOOL_VIEW_SLOT = 'tool.call.toolview';

/** turn 尾部扩展点的槽位名（官方 list / session）。 */
export const DSH_TURN_TAIL_SLOT = 'conversation.chat.turnTail';

/** 推理正文扩展点的槽位名（官方 single / session）。 */
export const DSH_REASONING_BODY_SLOT = 'conversation.chat.reasoning.body';

/** 一次文本手势：选中文本 + 可执行命令。 */
export interface DshTextInteraction {
	readonly id: string;
	readonly title: string;
	readonly command: string;
	readonly arguments?: readonly unknown[];
}

/**
 * 取该 surface 上可用的文本手势（官方 keyed 槽，key 是 surface 名）。
 *
 * 只返回带 title 与 command 的条目；缺字段的跳过。
 */
export function dshTextInteractions(sessionId: string | undefined, surface: string): readonly DshTextInteraction[] {
	const resolved = dshChatSlotRegistry.resolve(DSH_TEXT_INTERACTION_SLOT, {
		sessionId,
		entryKey: surface,
		props: { surface },
	}) as { readonly occupants?: readonly { readonly id?: string; readonly props?: Readonly<Record<string, unknown>> }[] } | undefined;
	const interactions: DshTextInteraction[] = [];
	for (const occupant of resolved?.occupants ?? []) {
		const title = occupant.props?.['title'];
		const command = occupant.props?.['command'];
		const id = occupant.id;
		if (typeof title !== 'string' || title === '' || typeof command !== 'string' || command === '' || id === undefined) {
			continue;
		}
		const args = occupant.props?.['arguments'];
		interactions.push({ id, title, command, ...(Array.isArray(args) ? { arguments: args } : {}) });
	}
	return interactions;
}

/** 用户消息上方的一条装饰。`label` 是可直接显示的文本。 */
export interface DshUserBeforeDecoration {
	readonly id: string;
	readonly label: string;
}

/**
 * 取用户消息上方的装饰（官方 chain 槽：首个返回非空 select 的 occupant 生效）。
 *
 * 官方 `slots.ts` 对该槽写明「steering and pending rows do not render this slot」，
 * 因此只接受 `kind === 'user'`；传别的 kind 一律返回 undefined，调用方也不必自己过滤。
 *
 * 只收可读文本；没有 occupant 认领时不显示任何装饰。
 */
export function dshUserBeforeDecoration(sessionId: string | undefined, kind: string, source: string | undefined): DshUserBeforeDecoration | undefined {
	if (kind !== 'user') {
		return undefined;
	}
	const resolved = dshChatSlotRegistry.resolve(DSH_USER_BEFORE_SLOT, {
		sessionId,
		props: { kind, ...(source === undefined ? {} : { source }) },
		fallback: undefined,
	}) as { readonly occupants?: readonly { readonly id?: string; readonly selected?: unknown }[] } | undefined;
	const occupant = resolved?.occupants?.[0];
	const label = occupant?.selected;
	return occupant?.id !== undefined && typeof label === 'string' && label !== '' ? { id: occupant.id, label } : undefined;
}

/** 助手消息动作行的槽位名（官方 list / session，owner 是 messageId）。 */
export const DSH_ASSISTANT_ACTIONS_SLOT = 'conversation.chat.assistant-actions';

/** 配额通知链的槽位名（官方 chain / root）。 */
export const DSH_QUOTA_NOTICE_SLOT = 'shell.quota-notice';

/** 侧栏席位的槽位名（官方 single / session）。 */
export const DSH_ASIDE_SLOT = 'conversation.chat.aside';

/** markdown 围栏扩展点的槽位名（官方 hoc / session，key 是围栏 info 语言）。 */
export const DSH_MARKDOWN_FENCE_SLOT = 'conversation.chat.markdown.fence';

/** 输入卡上方整行区域的槽位名（官方 list / session，owner 是 `InputZone`）。 */
export const DSH_INPUT_DOCK_SLOT = 'conversation.input.dock';

/** 输入卡下方环境区的槽位名（官方 list / session，无 owner props）。 */
export const DSH_COMPOSER_DOCK_SLOT = 'conversation.composer.dock';

/**
 * 取某个围栏语言的插件包装（官方 hoc 槽：key 是围栏 info，缺省走通配层）。
 *
 * 返回可显示的替代文本；没有 occupant 时返回 undefined，交给原生 markdown 渲染。
 * 这一层只决定「这段围栏交给谁画」，不接管 markdown 解析。
 */
export function dshMarkdownFenceOverride(sessionId: string | undefined, info: string): string | undefined {
	const resolved = dshChatSlotRegistry.resolve(DSH_MARKDOWN_FENCE_SLOT, {
		sessionId,
		entryKey: info,
		props: { info },
	}) as { readonly occupants?: readonly { readonly props?: Readonly<Record<string, unknown>> }[] } | undefined;
	const text = resolved?.occupants?.[0]?.props?.['replacement'];
	return typeof text === 'string' && text !== '' ? text : undefined;
}

/** 文本手势扩展点的槽位名（官方 keyed / session，key 是 surface）。 */
export const DSH_TEXT_INTERACTION_SLOT = 'conversation.chat.text-interaction';

/** 用户消息上方装饰的槽位名（官方 chain / session）。 */
export const DSH_USER_BEFORE_SLOT = 'conversation.chat.user.before';

/** 节点渲染扩展点的槽位名（官方 keyed / session，key 是 node kind）。 */
export const DSH_NODE_SLOT = 'conversation.chat.node';

/** 差异表 §2 里仍无 occupant 的 Chat 槽位。 */
export const DSH_CHAT_SLOT_DECLARATIONS: readonly DshSlotDeclaration[] = [
	{ name: DSH_NODE_SLOT, cardinality: 'keyed', scope: 'session', ownerProps: ['node'] },
	{ name: DSH_TOOL_VIEW_SLOT, cardinality: 'keyed', scope: 'session', ownerProps: ['toolCall'] },
	{ name: DSH_TURN_TAIL_SLOT, cardinality: 'list', scope: 'session', ownerProps: ['turn', 'seq'] },
	{ name: DSH_QUOTA_NOTICE_SLOT, cardinality: 'chain', scope: 'root', ownerProps: ['code', 'seq'] },
	{ name: DSH_REASONING_BODY_SLOT, cardinality: 'single', scope: 'session' },
	{ name: DSH_ASSISTANT_ACTIONS_SLOT, cardinality: 'list', scope: 'session', ownerProps: ['messageId'] },
	{ name: 'conversation.chat.aside', cardinality: 'single', scope: 'session' },
	{ name: 'conversation.chat.user.before', cardinality: 'chain', scope: 'session', ownerProps: ['source', 'kind'] },
	{ name: 'conversation.chat.text-interaction', cardinality: 'keyed', scope: 'session', ownerProps: ['surface'] },
	{ name: DSH_MARKDOWN_FENCE_SLOT, cardinality: 'hoc', scope: 'session', ownerProps: ['info'] },
	// 官方 `conversation.input.dock` 的 owner 是 `InputZone { session, input }`；
	// `conversation.composer.dock` 与 `conversation.chat.aside` 没有 owner props。
	{ name: DSH_INPUT_DOCK_SLOT, cardinality: 'list', scope: 'session', ownerProps: ['session', 'input'] },
	{ name: DSH_COMPOSER_DOCK_SLOT, cardinality: 'list', scope: 'session' },
];

/** 已声明过的名字。`declare` 本身允许重复，这里只避免重复登记同一份清单。 */
export interface DshSlotDeclarer {
	declare(declaration: DshSlotDeclaration): void;
}

export function declareDshChatSlots(registry: DshSlotDeclarer): void {
	for (const declaration of DSH_CHAT_SLOT_DECLARATIONS) {
		registry.declare(declaration);
	}
}

/**
 * 插件内共用的 Chat 槽位注册表。
 *
 * 现在还没有 occupant 与 ChatList 接线；先让声明活在运行期对象上，
 * 后续接第一个 occupant 时不用再把清单复制到别处。
 */
export const dshChatSlotRegistry = new DshSlotRegistry();
declareDshChatSlots(dshChatSlotRegistry);

/** 节点行可被 occupant 覆盖的字段。owner props（node）不允许被覆盖。 */
export interface DshNodeRowOverride {
	readonly title?: string;
	readonly detail?: string;
	readonly icon?: string;
}

/** 一条助手消息动作行。`command` 由宿主执行，`arguments` 原样传入。 */
export interface DshAssistantAction {
	readonly id: string;
	readonly title: string;
	readonly command: string;
	readonly arguments?: readonly unknown[];
}

/**
 * 取该助手消息的动作行（官方 list 槽，按 `order` 排序）。
 *
 * 只有 title 与 command 都齐全的 occupant 才成行；缺字段的跳过，不画空按钮。
 */
export function dshAssistantActions(sessionId: string | undefined, messageId: string | undefined): readonly DshAssistantAction[] {
	if (messageId === undefined || messageId === '') {
		return [];
	}
	const resolved = dshChatSlotRegistry.resolve(DSH_ASSISTANT_ACTIONS_SLOT, {
		sessionId,
		props: { messageId },
	}) as { readonly occupants?: readonly { readonly id?: string; readonly props?: Readonly<Record<string, unknown>> }[] } | undefined;
	const actions: DshAssistantAction[] = [];
	for (const occupant of resolved?.occupants ?? []) {
		const title = occupant.props?.['title'];
		const command = occupant.props?.['command'];
		const id = occupant.id;
		if (typeof title !== 'string' || title === '' || typeof command !== 'string' || command === '' || id === undefined) {
			continue;
		}
		const args = occupant.props?.['arguments'];
		actions.push({
			id,
			title,
			command,
			...(Array.isArray(args) ? { arguments: args } : {}),
		});
	}
	return actions;
}

/**
 * 推理正文的插件覆盖（官方 single 槽，低 priority 胜出）。
 *
 * 只覆盖文本：本仓没有独立 reasoning DOM，occupant 给 `text` 就用它，
 * 否则用节点自带的 reasoning。
 */
export function dshReasoningBodyOverride(sessionId: string | undefined): string | undefined {
	const resolved = dshChatSlotRegistry.resolve(DSH_REASONING_BODY_SLOT, { sessionId }) as
		{ readonly occupants?: readonly { readonly props?: Readonly<Record<string, unknown>> }[] } | undefined;
	const text = resolved?.occupants?.[0]?.props?.['text'];
	return typeof text === 'string' && text !== '' ? text : undefined;
}

/** 配额通知的插件覆盖结果；只有 claim 成功才有值。 */
export interface DshQuotaNoticeOverride {
	/** 覆盖显示的文案；缺省沿用 Host/内置文案。 */
	readonly label?: string;
	/** 该通知必须保持显示，后续更小的 seq 不得顶掉（官方 `keepOpen()`）。 */
	readonly keepOpen?: boolean;
}

/**
 * 让插件按稳定 code 认领配额通知（官方 chain：首个返回非空 select 的 occupant 生效）。
 *
 * chain 是 root 作用域，不传会话身份。没有 occupant 认领时返回 undefined，
 * 由内置的 `ChatQuotaExceededPart` 与 `retainQuotaNotice` 处理。
 */
export function dshQuotaNoticeOverride(code: string): DshQuotaNoticeOverride | undefined {
	const resolved = dshChatSlotRegistry.resolve(DSH_QUOTA_NOTICE_SLOT, {
		props: { code },
		fallback: undefined,
	}) as { readonly occupants?: readonly { readonly selected?: unknown }[] } | undefined;
	const selected = resolved?.occupants?.[0]?.selected;
	if (selected === null || typeof selected !== 'object') {
		return undefined;
	}
	const record = selected as { readonly label?: unknown; readonly keepOpen?: unknown };
	const label = typeof record.label === 'string' && record.label !== '' ? record.label : undefined;
	const keepOpen = record.keepOpen === true;
	return label === undefined && !keepOpen ? undefined : { ...(label === undefined ? {} : { label }), ...(keepOpen ? { keepOpen } : {}) };
}

/** turn 尾部的一条插件扩展。`label` 是可直接显示的文本；没有 label 的 occupant 被忽略。 */
export interface DshTurnTailExtra {
	readonly id: string;
	readonly label: string;
}

/**
 * 取该 Turn 尾部要追加的插件行（官方 list 槽，按 `order` 排序）。
 *
 * 只收可读文本：本期没有自研 DOM 席位，先以行文本进入 tail，避免假装有独立组件。
 */
export function dshTurnTailExtras(sessionId: string | undefined, turn: number, seq: number): readonly DshTurnTailExtra[] {
	const resolved = dshChatSlotRegistry.resolve(DSH_TURN_TAIL_SLOT, {
		sessionId,
		props: { turn, seq },
	}) as { readonly occupants?: readonly { readonly id?: string; readonly props?: Readonly<Record<string, unknown>> }[] } | undefined;
	const extras: DshTurnTailExtra[] = [];
	for (const occupant of resolved?.occupants ?? []) {
		const label = occupant.props?.['label'];
		const id = occupant.id;
		if (typeof label === 'string' && label !== '' && id !== undefined) {
			extras.push({ id, label });
		}
	}
	return extras;
}

/** 工具视图家族可由插件占用；返回 undefined 表示用内置的 wire 名分派。 */
export function dshToolViewOverride(toolName: string, sessionId?: string): string | undefined {
	const resolved = dshChatSlotRegistry.resolve(DSH_TOOL_VIEW_SLOT, {
		sessionId,
		entryKey: toolName,
		props: { toolCall: toolName },
	}) as { readonly occupants?: readonly { readonly props?: Readonly<Record<string, unknown>> }[] } | undefined;
	const view = resolved?.occupants?.[0]?.props?.['view'];
	return typeof view === 'string' && view !== '' ? view : undefined;
}

/**
 * 取某个 node kind 的槽位覆盖。
 *
 * 这是 `conversation.chat.node` 的唯一生产消费点：插件按官方 keyed 槽注册，
 * 本仓的行渲染先问它，没有 occupant 时用内置适配。返回 undefined 表示没有覆盖。
 */
export function dshNodeRowOverride(kind: string, sessionId?: string): DshNodeRowOverride | undefined {
	const resolved = dshChatSlotRegistry.resolve(DSH_NODE_SLOT, { sessionId, entryKey: kind, props: { node: kind } }) as
		{ readonly occupants?: readonly { readonly props?: Readonly<Record<string, unknown>> }[] } | undefined;
	const props = resolved?.occupants?.[0]?.props;
	if (props === undefined) {
		return undefined;
	}
	const pick = (key: string): string | undefined => typeof props[key] === 'string' && props[key] !== '' ? props[key] as string : undefined;
	const title = pick('title');
	const detail = pick('detail');
	const icon = pick('icon');
	return title === undefined && detail === undefined && icon === undefined
		? undefined
		: { ...(title === undefined ? {} : { title }), ...(detail === undefined ? {} : { detail }), ...(icon === undefined ? {} : { icon }) };
}

/**
 * 取侧栏内容（官方 single 槽：低 priority 胜出）。
 *
 * 返回可显示文本；没有 occupant 或文本为空时不显示侧栏。
 */
export function dshAsideText(sessionId: string | undefined): string | undefined {
	const resolved = dshChatSlotRegistry.resolve(DSH_ASIDE_SLOT, { sessionId }) as
		{ readonly occupants?: readonly { readonly props?: Readonly<Record<string, unknown>> }[] } | undefined;
	const text = resolved?.occupants?.[0]?.props?.['text'];
	return typeof text === 'string' && text !== '' ? text : undefined;
}