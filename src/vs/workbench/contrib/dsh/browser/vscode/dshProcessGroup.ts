/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 一个 turn 分成提示、过程和答复。
// 过程能否收起不看 DOM，只看结束原因和 store 里的 collapsed。
// 还在跑、被中断、或出错的 turn 不能整段折起来。

import { localize } from '../../../../../nls.js';
import { dshLiveDetailOf } from './dshToolDetail.js';

export interface DshGroupableNode {
	readonly key: string;
	readonly kind: string;
	readonly seq: number;
	readonly turn?: number;
	readonly step?: number;
	readonly parentKey?: string;
	/**
	 * 该答复是否**有可见回复内容**（官方：non-blank text / image / 其它可见块）。
	 *
	 * 官方「Turn Process Folding」对「最终答复」的定义是：
	 * 「**the latest Step's settled Assistant reply, provided it has visible reply content
	 * and no tool-call block**」。分组层拿不到内容，所以由调用方按内容算好这两位。
	 */
	readonly hasVisibleReply?: boolean;
	/** 该答复是否**含 tool-call 块**（含则不能当最终答复）。 */
	readonly hasToolCallBlock?: boolean;
}

export interface DshTurnProcess {
	readonly turn: number;
	readonly answerStep: number;
	readonly promptKeys: readonly string[];
	readonly processKeys: readonly string[];
	readonly answerKeys: readonly string[];
	/**
	 * `answerKeys` 里**真正的答复**（assistant / assistant-step），按 seq 升序。
	 *
	 * 不能直接用 answerKeys 的最后一项当最终答复：那个列表还含 turn-tail、turn-error 等
	 * 同为 turn 位置的节点，取到最后一条很可能是个尾部控件而不是答复。
	 */
	readonly replyKeys: readonly string[];
	/**
	 * `answerKeys` 里**不是答复的 `turn` 位置控件**（`turn-tail` / `turn-error` / `turn-max-tokens` 等）。
	 *
	 * 官方「Turn Process Folding」：「A Node whose group-tree position is `turn` or outer
	 * **remains independent of whole-Turn folding**.」——所以整 Turn 折叠时它们**必须保留**，
	 * 不能被 `foldedReplies === 'final'` 一起折掉。
	 */
	readonly controlKeys: readonly string[];
	/**
	 * 这个 Turn 里**按边界切开的过程段**（官方「Process grouping」）。
	 *
	 * 官方规则：一个 Turn 里相邻的 process 内容归一组，但**答复与输入会结束前一组**：
	 *   `T1 → steering → T2` → `G[T1] → steering → G[T2]`（两个组，不是一组）
	 *   `A1(thought, reply) → T1` → `G[A1.reasoning] → A1.response → G[T1]`
	 * 历史实现把所有 process 节点塞进一个 `processKeys`，丢掉了 steering/答复的分隔，
	 * 于是「中途插话」前后的工作被画成一整段。
	 *
	 * `processKeys` 仍是所有段的**并集**（保持既有消费方与折叠判定不变）；
	 * 需要按段绘制时读 `segments`。
	 */
	readonly segments: readonly DshProcessSegment[];
	readonly alwaysOpen: boolean;
	/**
	 * 该 Turn 的结算原因（官方 `turn/end.reason.kind`）；进行中或缺省。
	 *
	 * 组头用它决定**语义色**：官方「Grouped rendering」要求「Process rows share one text and icon
	 * color in every Work details mode: tertiary at rest and secondary on hover, **while error and
	 * warning text keeps its semantic color**」——没有这个字段就分不出哪一行该保住语义色。
	 */
	readonly endReason?: string;
}

/** 一个过程段：同一 Turn 内被输入/答复/独立根节点切开的一段连续 process 内容。 */
export interface DshProcessSegment {
	/** 该段的 process 节点 key（按 seq 升序）。 */
	readonly processKeys: readonly string[];
	/** 该段之前紧邻的分隔节点 key（`steering` / 答复 / 独立根）；第一段为 undefined。 */
	readonly precededBy?: string;
}

export type DshGroupPosition = 'exchange' | 'input' | 'turn' | 'process';

const SIGNAL_KINDS = new Set(['turn-error', 'turn-max-tokens', 'model-retry']);

/** 节点落在四级位置的哪一层。exchange 是整段对话，不是单个节点。 */
export function groupPositionOf(kind: string): DshGroupPosition {
	switch (kind) {
		case 'user':
		case 'steering':
		case 'command-input':
			return 'input';
		case 'tool-call':
		case 'tool-result':
		case 'context':
		case 'compaction':
		case 'manual-compaction':
			return 'process';
		default:
			return 'turn';
	}
}


/** 没有结束原因、仍是 open，或结束于中断/错误时，整段过程保持展开。 */
export function turnProcessAlwaysOpen(reason: string | undefined): boolean {
	if (reason === undefined || reason === '' || reason === 'open') {
		return true;
	}
	return reason === 'aborted' || reason === 'interrupted' || reason === 'error';
}

/** 按 turn 分组。没有 turn 坐标的节点不进任何过程组。 */
export function groupTurnProcesses(nodes: readonly DshGroupableNode[], reasonByTurn: ReadonlyMap<number, string> = new Map()): readonly DshTurnProcess[] {
	const buckets = new Map<number, DshGroupableNode[]>();
	for (const node of [...nodes].sort((left, right) => left.seq - right.seq)) {
		if (node.turn === undefined) {
			continue;
		}
		const bucket = buckets.get(node.turn) ?? [];
		bucket.push(node);
		buckets.set(node.turn, bucket);
	}
	return [...buckets.entries()]
		.sort((left, right) => left[0] - right[0])
		.map(([turn, bucket]) => {
			const promptKeys: string[] = [];
			const processKeys: string[] = [];
			const answerKeys: string[] = [];
			const replyKeys: string[] = [];
			const controlKeys: string[] = [];
			const segments: DshProcessSegment[] = [];
			let currentSegment: string[] = [];
			let segmentPrecededBy: string | undefined;
			let answerStep = 0;
			let sawSignal = false;
			let sawAnswer = false;
			/**
			 * 结束当前过程段（若有内容）。
			 *
			 * @param precededBy 结束它的那个节点的 key（作为下一段的前驱）
			 */
			const closeSegment = (precededBy: string | undefined): void => {
				if (currentSegment.length > 0) {
					segments.push({
						processKeys: currentSegment,
						...(segmentPrecededBy === undefined ? {} : { precededBy: segmentPrecededBy }),
					});
					currentSegment = [];
				}
				segmentPrecededBy = precededBy;
			};
			for (const node of bucket) {
				const position = groupPositionOf(node.kind);
				if (position === 'input') {
					promptKeys.push(node.key);
					// 官方：steering / 用户消息结束前一组（`T1 → steering → T2` 是两个组）。
					closeSegment(node.key);
				} else if (position === 'process') {
					processKeys.push(node.key);
					currentSegment.push(node.key);
				} else {
					answerKeys.push(node.key);
					if (node.kind !== 'assistant' && node.kind !== 'assistant-step') {
						// `turn` 位置的非答复控件：独立于整 Turn 折叠（官方原文）。
						controlKeys.push(node.key);
					}
					if (node.kind === 'assistant' || node.kind === 'assistant-step') {
						// 官方：最终答复必须是「有可见回复内容、无 tool-call 块」的已结算答复。
						// 调用方没提供这两位时（例如只做分组测试）按「合格」处理，保持既有行为。
						const eligible = node.hasVisibleReply !== false && node.hasToolCallBlock !== true;
						if (eligible) {
							replyKeys.push(node.key);
						}
						sawAnswer = true;
						if (node.step !== undefined && node.step > answerStep) {
							answerStep = node.step;
						}
						// 官方：答复结束前一组（答复本身独立，不属于任何过程段）。
						closeSegment(node.key);
					} else if (position === 'turn' && (node.kind === 'turn-error' || node.kind === 'turn-max-tokens' || node.kind === 'turn-tail')) {
						// 官方：`turn-error` / `turn-max-tokens` / `turn-tail` 是独立根，也结束前一组。
						closeSegment(node.key);
					}
				}
				if (SIGNAL_KINDS.has(node.kind)) {
					sawSignal = true;
				}
			}
			// 结尾的段也要收：否则最后一个工具组会丢。
			closeSegment(undefined);
			const reason = reasonByTurn.get(turn);
			const spec = describeTurnProcess(bucket);
			const alwaysOpen = spec.hasInterleavedInput || (reason !== undefined
				? turnProcessAlwaysOpen(reason)
				: sawSignal || !sawAnswer);
			return { turn, answerStep, promptKeys, processKeys, answerKeys, replyKeys, controlKeys, segments, alwaysOpen, ...(reason === undefined ? {} : { endReason: reason }) };
		});
}

export interface DshTurnProcessSpec {
	readonly controlAnchorSeq?: number;
	readonly processStartSeq?: number;
	readonly answerAnchorSeq?: number;
	readonly answerStep: number;
	readonly messageCount: number;
	readonly toolCallCount: number;
	readonly subagentCount: number;
	/** reasoning 在 assistant 块里，这一层节点上看不到，固定为 false。 */
	readonly inlineReasoning: false;
	readonly turnStarted: boolean;
	readonly turnClosed: boolean;
	readonly hasExternalProcess: boolean;
	readonly hasNonReplyProcess: boolean;
	readonly hasInterleavedInput: boolean;
}

/** 从一个 turn 的节点算出锚点和折叠用的呈现。不编造 reasoning。 */
export function describeTurnProcess(nodes: readonly (DshGroupableNode & { readonly name?: string })[]): DshTurnProcessSpec {
	const ordered = [...nodes].sort((left, right) => left.seq - right.seq);
	let controlAnchorSeq: number | undefined;
	let processStartSeq: number | undefined;
	let answerAnchorSeq: number | undefined;
	let answerStep = 0;
	let messageCount = 0;
	let toolCallCount = 0;
	let subagentCount = 0;
	let sawProcess = false;
	let interleaved = false;
	// 官方 `TurnProcessSpec.messageCount` 是「Reply-bearing durable Assistant messages
	// **before the final answer**」：只数最终答复之前的助手消息，不含最终答复本身，
	// 也不含 input 节点。先收集全部助手 seq，最后一条即最终答复。
	const assistantSeqs: number[] = [];
	for (const node of ordered) {
		const position = groupPositionOf(node.kind);
		if (position === 'input') {
			if (controlAnchorSeq === undefined) {
				controlAnchorSeq = node.seq;
			}
			if (sawProcess || answerAnchorSeq !== undefined) {
				interleaved = true;
			}
		} else if (position === 'process') {
			sawProcess = true;
			if (processStartSeq === undefined) {
				processStartSeq = node.seq;
			}
			if (node.kind === 'tool-call') {
				// 官方 `TurnProcessSpec.toolCallCount` 是「Durable **non-subagent** Tool calls」：
				// 子代理委派只进 `subagentCount`，不重复计入 `toolCallCount`。
				if (node.name !== undefined && isSubagentDelegationTool(node.name)) {
					subagentCount += 1;
				} else {
					toolCallCount += 1;
				}
			}
		} else if (node.kind === 'assistant' || node.kind === 'assistant-step') {
			assistantSeqs.push(node.seq);
			if (answerAnchorSeq === undefined) {
				answerAnchorSeq = node.seq;
			}
			if (node.step !== undefined && node.step > answerStep) {
				answerStep = node.step;
			}
		}
	}
	messageCount = assistantSeqs.length === 0 ? 0 : assistantSeqs.length - 1;
	return {
		...(controlAnchorSeq === undefined ? {} : { controlAnchorSeq }),
		...(processStartSeq === undefined ? {} : { processStartSeq }),
		...(answerAnchorSeq === undefined ? {} : { answerAnchorSeq }),
		answerStep,
		messageCount,
		toolCallCount,
		subagentCount,
		inlineReasoning: false,
		turnStarted: ordered.length > 0,
		// 官方 `turnProcessAlwaysOpen(node)` 用 `location.turn.status === 'open'` 判「还在进行」，
		// 有答复**不等于** Turn 结束（工具可能还在跑、Turn 还没 `turn/end`）。
		// 旧写法 `answerAnchorSeq !== undefined` 会把「已出答复但仍在运行」的 Turn 判成已关闭，
		// 从而允许收起正在跑的 Turn。
		turnClosed: nodes.some(node => (node as { readonly endReason?: string }).endReason !== undefined),
		hasExternalProcess: processStartSeq !== undefined,
		hasNonReplyProcess: processStartSeq !== undefined,
		hasInterleavedInput: interleaved,
	};
}


export type DshProcessActivity =
	| 'read'
	| 'readImage'
	| 'search'
	| 'write'
	| 'edit'
	| 'commands'
	| 'code'
	| 'webSearch'
	| 'webFetch'
	| 'subagents'
	| 'plan'
	| 'questions'
	| 'tools'
	| 'context';

export interface DshActivityNode {
	readonly kind: string;
	readonly name?: string;
	readonly running?: boolean;
	/**
	 * 工具调用身份。**计数去重靠它**：官方「Repeated `callId` | Count only the first occurrence,
	 * including when it appears both as a root and as a nested call」。
	 *
	 * 为什么必须去重：`tool-call` 与 `tool-result` 是一次调用的两条节点，两者都带 `name`；
	 * 不去重就会把**一次调用数成两次**，折叠行显示的数字直接翻倍。
	 */
	readonly callId?: string;
	/**
	 * 工具参数。用于按官方「Live activity and detail」的 21 字段优先级取「这一步在做什么」。
	 * 缺失时退回工具名（与官方「Without usable detail … falls back to the tool name」一致）。
	 */
	readonly args?: unknown;
}

export interface DshProcessActivitySummary {
	readonly counts: Readonly<Partial<Record<DshProcessActivity, number>>>;
	readonly running: number;
	readonly runningDetail: string;
	readonly preparing: boolean;
}

/** 收起时只留提示和答复。不可折叠的 turn 始终返回全部 key。 */
/**
 * 折叠时保留哪些答复（官方 `ui-chat.foldedReplies`）。
 *
 * `all`（默认）：**每条答复都留在折叠之外**，只折过程；
 * `final`：中间答复随过程一起折起，**只留最终答复**。
 *
 * 官方把「最终答复」定义为**最新 Step 的已结算 Assistant 答复**，且必须「有可见回复内容、无 tool-call 块」。
 * 不满足时（例如最后一步只有工具调用）**不猜**——保持 `all` 的行为，宁可多显示也不把唯一的答复折掉。
 */
export type DshFoldedReplies = 'all' | 'final';

/**
 * 折叠时可见的 key 列表。
 *
 * @param group 一个 Turn 的过程组
 * @param collapsed 整个 Turn 是否收起
 * @param foldedReplies 官方的「折叠后的答复」偏好
 */
export function visibleProcessKeys(group: DshTurnProcess, collapsed: boolean, foldedReplies: DshFoldedReplies = 'all'): readonly string[] {
	if (group.alwaysOpen || !collapsed) {
		return [...group.promptKeys, ...group.processKeys, ...group.answerKeys];
	}
	if (foldedReplies === 'final') {
		// 只在**真正的答复**里取最后一条；`answerKeys` 还含 turn-tail/turn-error 等控件。
		const finalKey = group.replyKeys.at(-1);
		// 官方：「A Node whose group-tree position is `turn` or outer remains **independent of
		// whole-Turn folding**」——`turn-tail` / `turn-error` 这类控件必须保留，不能被一起折掉。
		return [...group.promptKeys, ...(finalKey === undefined ? [] : [finalKey]), ...group.controlKeys];
	}
	return [...group.promptKeys, ...group.answerKeys];
}

/** `subagent` 与 `subagent_*` 是委派，不是普通工具。 */
export function isSubagentDelegationTool(name: string): boolean {
	return name === 'subagent' || name.startsWith('subagent_');
}

/** 工具名归到过程活动。对照官方 `conversation-nodes/process-activity.ts` 的 `activity()`。 */
export function processActivityOf(kind: string, name = ''): DshProcessActivity | undefined {
	if (kind === 'context') {
		return 'context';
	}
	if (kind !== 'tool-call' && kind !== 'tool-result') {
		return undefined;
	}
	if (name === '') {
		return undefined;
	}
	if (name === 'read') {
		return 'read';
	}
	if (name === 'read_image') {
		return 'readImage';
	}
	// 官方把 `*_inspect` 也算搜索。
	if (name === 'grep' || name === 'glob' || name.endsWith('_inspect')) {
		return 'search';
	}
	if (name === 'write') {
		return 'write';
	}
	if (name === 'edit' || name === 'apply_patch') {
		return 'edit';
	}
	if (name === 'bash' || name === 'pwsh' || name === 'exec_command' || name === 'write_stdin' || name.startsWith('terminal_')) {
		return 'commands';
	}
	if (name === 'run_code' || name === 'cua_run_code') {
		return 'code';
	}
	if (name === 'web_search') {
		return 'webSearch';
	}
	if (name === 'web_fetch') {
		return 'webFetch';
	}
	if (isSubagentDelegationTool(name)) {
		return 'subagents';
	}
	if (name === 'todo_write' || name === 'create_goal' || name === 'update_goal' || name === 'get_goal') {
		return 'plan';
	}
	if (name === 'ask_user_question' || name === 'request_user_input') {
		return 'questions';
	}
	return 'tools';
}

/** 统计一段过程。running 只数调用方标了 running 的节点。没有任何活动且没有答复时 preparing 为真。 */
export function summarizeProcess(nodes: readonly DshActivityNode[], hasAnswer: boolean): DshProcessActivitySummary {
	const counts: Partial<Record<DshProcessActivity, number>> = {};
	const runningNames: string[] = [];
	// 官方 `processActivity`：**全部成员都是 context** 时才报一个 context 类、计成员数；
	// context 与其它成员混在一起时不计数。逐个节点都记 context 会把「工具里夹了一条上下文」
	// 也算成一条独立活动。
	const allContext = nodes.length > 0 && nodes.every(node => node.kind === 'context');
	// 官方「Repeated callId」：同一个 callId 只计第一次出现（含 root 与 nested 重复的情况）。
	// 没有 callId 的节点（context / 无身份的节点）不去重，按原样各计一次。
	const seenCallIds = new Set<string>();
	for (const node of nodes) {
		if (allContext) {
			continue;
		}
		const callId = node.callId;
		if (callId !== undefined && callId !== '') {
			if (seenCallIds.has(callId)) {
				continue;
			}
			seenCallIds.add(callId);
		}
		const activity = processActivityOf(node.kind, node.name);
		if (activity === undefined || activity === 'context') {
			continue;
		}
		counts[activity] = (counts[activity] ?? 0) + 1;
		if (node.running === true) {
			// 官方：running detail 走 21 字段优先级；没有可用字段时才退回工具名。
			runningNames.push(dshLiveDetailOf(node.args) ?? node.name ?? activity);
		}
	}
	if (allContext) {
		counts['context'] = nodes.length;
	}
	const running = runningNames.length;
	return {
		counts,
		running,
		runningDetail: runningNames.join(', '),
		preparing: !hasAnswer && running === 0 && Object.keys(counts).length === 0,
	};
}

/** 活动名的用户可见文案。未列出的活动原样显示枚举名，不猜中文。 */
/**
 * 组头文案（官方 `conversation-nodes/README.md`「Group-title rules」的类别表）。
 *
 * 官方给的是**两套**标签：`Running label` 与 `Closed label`——
 * 运行中的组用「正在做什么」（Reading files / Running commands），
 * 已结束的组用「做过什么」（Read files / Ran commands）。
 * 历史实现只有一套小写单词（`read` / `commands`），两套都没有落地。
 *
 * @param activity 类别
 * @param state `running` = 组仍在跑；`closed` = 组已结束
 */
export function processActivityLabel(activity: DshProcessActivity, state: 'running' | 'closed'): string {
	switch (activity) {
		case 'read': return state === 'running' ? localize('dsh.activity.read.running', "Reading files") : localize('dsh.activity.read.closed', "Read files");
		case 'readImage': return state === 'running' ? localize('dsh.activity.readImage.running', "Reading images") : localize('dsh.activity.readImage.closed', "Read images");
		case 'search': return state === 'running' ? localize('dsh.activity.search.running', "Searching code") : localize('dsh.activity.search.closed', "Searched code");
		case 'write': return state === 'running' ? localize('dsh.activity.write.running', "Writing files") : localize('dsh.activity.write.closed', "Wrote files");
		case 'edit': return state === 'running' ? localize('dsh.activity.edit.running', "Editing files") : localize('dsh.activity.edit.closed', "Edited files");
		case 'commands': return state === 'running' ? localize('dsh.activity.commands.running', "Running commands") : localize('dsh.activity.commands.closed', "Ran commands");
		case 'code': return state === 'running' ? localize('dsh.activity.code.running', "Running code") : localize('dsh.activity.code.closed', "Ran code");
		case 'webSearch': return state === 'running' ? localize('dsh.activity.webSearch.running', "Searching the web") : localize('dsh.activity.webSearch.closed', "Searched the web");
		case 'webFetch': return state === 'running' ? localize('dsh.activity.webFetch.running', "Visiting web pages") : localize('dsh.activity.webFetch.closed', "Visited web pages");
		case 'subagents': return state === 'running' ? localize('dsh.activity.subagents.running', "Coordinating subagents") : localize('dsh.activity.subagents.closed', "Coordinated subagents");
		case 'plan': return state === 'running' ? localize('dsh.activity.plan.running', "Updating the plan") : localize('dsh.activity.plan.closed', "Updated the plan");
		case 'questions': return state === 'running' ? localize('dsh.activity.questions.running', "Waiting for your action") : localize('dsh.activity.questions.closed', "Asked questions");
		case 'tools': return state === 'running' ? localize('dsh.activity.tools.running', "Calling tools") : localize('dsh.activity.tools.closed', "Called tools");
		case 'context': return state === 'running' ? localize('dsh.activity.context.running', "Analyzing the request") : localize('dsh.activity.context.closed', "Injected context");
	}
}

/**
 * 按官方「Group-title rules」把多个类别标签连成组头文案。
 *
 * 官方表格：
 *   - Closed, one category  → 用该类的 closed label，**不带计数**
 *   - Closed, two categories → 用 "and" 连接
 *   - Closed, three categories → 逗号连接
 *   - Closed, more than three → 前三个 + "etc."
 * 并规定「**English lowercases the initial letter of joined labels after the first**」
 * 与「**Chinese removes the second leading `已` only when both labels start with it**」。
 *
 * @param labels 已按官方排名排好序的标签（长度 ≥ 1）
 * @returns 连接后的文案；空数组返回 undefined
 */
export function joinActivityLabels(labels: readonly string[]): string | undefined {
	if (labels.length === 0) {
		return undefined;
	}
	if (labels.length === 1) {
		return labels[0];
	}
	if (labels.length === 2) {
		// 英文：第二个标签首字母小写（"Read files and ran commands"）。
		return `${labels[0]} and ${lowerInitial(labels[1])}`;
	}
	if (labels.length === 3) {
		return `${labels[0]}, ${lowerInitial(labels[1])}, ${lowerInitial(labels[2])}`;
	}
	// >3：前三个 + etc.，仍是逗号连接。
	return `${labels[0]}, ${lowerInitial(labels[1])}, ${lowerInitial(labels[2])}, etc.`;
}

/**
 * 英文标签的首字母小写化；非拉丁字母（中文等）原样返回。
 *
 * 官方的中文规则更特殊：只有两个标签**都以「已」开头**时才去掉第二个的「已」。
 * 这里按语言分别处理——拉丁字母首字母小写、中文去第二个「已」。
 */
function lowerInitial(label: string): string {
	const first = label.charAt(0);
	// 拉丁大写字母：小写化。
	if (first >= 'A' && first <= 'Z') {
		return first.toLowerCase() + label.slice(1);
	}
	return label;
}

/**
 * 中文连接：两个标签都以「已」开头时去掉第二个的「已」。
 *
 * 官方原文：「Chinese removes the second leading `已` only when both labels start with it.」
 * 只在两者都以「已」开头时动手——否则会改坏一个本来不该省的词。
 */
export function joinActivityLabelsZh(labels: readonly string[]): string | undefined {
	if (labels.length <= 1) {
		return labels[0];
	}
	const second = labels[1].startsWith('\u5df2') && labels[0].startsWith('\u5df2') ? labels[1].slice(1) : labels[1];
	if (labels.length === 2) {
		return `${labels[0]}\u548c${second}`;
	}
	return labels.map((label, index) => index === 0 ? label : (index === 1 ? second : label)).join('\u3001') + (labels.length > 3 ? '\u7b49' : '');
}

/** 被收起的过程用一行计数表示。没有活动时返回 undefined。未配对的 tool-call 算正在跑。 */
export function hiddenProcessLine(nodes: readonly { readonly kind: string; readonly name?: string; readonly callId?: string; readonly args?: unknown }[]): string | undefined {
	const settled = new Set(nodes.flatMap(node => node.kind === 'tool-result' && node.callId !== undefined && node.callId !== '' ? [node.callId] : []));
	const summary = summarizeProcess(nodes.map(node => ({
		kind: node.kind,
		...(node.name === undefined ? {} : { name: node.name }),
		...(node.args === undefined ? {} : { args: node.args }),
		running: node.kind === 'tool-call' && node.callId !== undefined && node.callId !== '' && !settled.has(node.callId),
	})), true);
	// 活动名是内部枚举（`read` / `webSearch`），直接拼给用户等于没本地化。
	// 该行只在过程被收起时画：有正在跑的就用 running 标签，否则用 closed 标签。
	const state = summary.running > 0 ? 'running' : 'closed';
	// 官方排名：**count 降序**；同数按该类别**首次出现**的顺序（Object.entries 保持插入序）。
	const ranked = Object.entries(summary.counts)
		.filter((entry): entry is [string, number] => typeof entry[1] === 'number')
		.sort((left, right) => right[1] - left[1]);
	if (ranked.length === 0) {
		return undefined;
	}
	// 官方组头：closed 的类别**不带计数**；有正在跑的类别时追加实时细节。
	const labels = ranked.map(([name]) => processActivityLabel(name as DshProcessActivity, state));
	const title = joinActivityLabels(labels);
	if (title === undefined) {
		return undefined;
	}
	return summary.running > 0 ? `${title} · ${summary.runningDetail}` : title;
}

/**
 * 用线协议里的 `turn-process` 计数画收起行。
 *
 * 官方过程组行的数据来自该节点；这里优先它，客户端现算只作回退。
 * 没有任何计数时返回 undefined。
 */
export function processLineFromSnapshot(snapshot: {
	readonly toolCallCount: number;
	readonly subagentCount: number;
	readonly messageCount: number;
}): string | undefined {
	const parts: string[] = [];
	if (snapshot.toolCallCount > 0) {
		parts.push(localize('dsh.process.tools', "{0} tools", snapshot.toolCallCount));
	}
	if (snapshot.subagentCount > 0) {
		parts.push(localize('dsh.process.subagents', "{0} subagents", snapshot.subagentCount));
	}
	if (snapshot.messageCount > 0) {
		parts.push(localize('dsh.process.messages', "{0} messages", snapshot.messageCount));
	}
	return parts.length === 0 ? undefined : parts.join(', ');
}

/**
 * 算「最新 exchange」包含哪些 Turn（官方「Collapse timing」）。
 *
 * 官方定义：**一个 exchange 从「第一个 Step 接纳人类输入的 Turn」开始，包含其后每个 Turn，
 * 直到下一个这样的 Turn**。只有这些 Turn 在 `next-input` 时机下保持运行中的呈现；
 * 更早的 exchange 已经结束，照常折叠。
 *
 * 「接纳人类输入」= 该 Turn 有 `promptKeys`（user / steering / command-input）。
 * 注意：被通知唤醒的 Turn（settled subagent、goal round、schedule）**不开新 exchange**，
 * 所以它不会结束前一个 exchange 的豁免——这与官方「a Turn woken by a notice leaves the
 * preceding Turns of its exchange expanded」一致。
 *
 * @param groups 全部 Turn 的过程组（顺序无关，内部按 turn 排序）
 * @returns 最新 exchange 的 turn 号集合；没有人类输入时返回空集合
 */
export function latestExchangeTurns(groups: readonly DshTurnProcess[]): readonly number[] {
	const ordered = [...groups].sort((left, right) => left.turn - right.turn);
	// 从后往前找第一个「有人类输入」的 Turn，那就是当前 exchange 的起点。
	let startIndex = -1;
	for (let index = ordered.length - 1; index >= 0; index -= 1) {
		if (ordered[index].promptKeys.length > 0) {
			startIndex = index;
			break;
		}
	}
	if (startIndex === -1) {
		// 官方「Collapse timing」：「The latest exchange of a **reopened Session** also receives the
		// exemption, **starting at the first loaded Turn when the loaded window holds no opening Turn**.」
		//
		// 重开会话时窗口可能从中间切进来——没有「接纳人类输入」的 Turn（prompt 在窗口之外）。
		// 此时不能返回空集合（那等于完全失去豁免），而应从**已载入的第一个 Turn** 起算。
		return ordered.map(group => group.turn);
	}
	return ordered.slice(startIndex).map(group => group.turn);
}
