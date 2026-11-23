/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 节点 → 原生 chat part 形状。
// 文本复用 ChatMarkdownContentPart，思考复用 ChatThinkingContentPart，
// 工具复用 ChatToolInvocationPart，但 input 按 tool view 家族分开，不共用一句通用文案。
// 文件引用、错误、配额、任务、路径树、diff 列表各自一条，不用 info/warning 引用块代替。

import { localize } from '../../../../../nls.js';
import type { DshIndexedNode } from './dshConversationNodeTree.js';
import { dshNodeKey } from './dshConversationNodeTree.js';
import { dshToolViewId, type DshToolViewId } from './dshToolViewRegistry.js';
import { dshCommandRowOverride, dshQuotaNoticeOverride, dshReasoningBodyOverride, dshToolViewOverride, dshTurnTailExtras } from './dshChatSlots.js';

export type DshNativeAdapterId = 'markdown' | 'thinking' | 'tool' | 'task' | 'reference' | 'error' | 'quota' | 'diff' | 'tree' | 'image' | 'file' | 'compaction' | 'command' | 'usage' | 'deliverable' | 'turn-trigger' | 'unknown' | 'context' | 'assistant-meta' | 'model-retry' | 'inherited-history' | 'max-tokens' | 'turn-tail' | 'question-reply' | 'command-input' | 'submitted-plan' | 'workflow-run' | 'manual-compaction';

export interface DshNativeAdaptation {
	readonly adapter: DshNativeAdapterId;
	/**
	 * 实际画出这个 part 的地方。
	 *
	 * 原生 part 写类名（`ChatMarkdownContentPart` 等，`chatListRenderer.renderDshAdaptedPart` 里真实调用）；
	 * 没有原生等价物时写 `dshSlotHostContentPart:renderAdaptedFallback`——那是当前唯一的回退渲染器，
	 * 不要写成不存在的 `Dsh*ContentPart` 类名。
	 */
	readonly reuse: string;
	readonly reason: string;
	readonly view?: DshToolViewId;
	readonly part: DshNativePart;
}

export type DshNativePart =
	| { readonly kind: 'markdownContent'; readonly content: { readonly value: string } }
	| { readonly kind: 'thinking'; readonly id: string; readonly value: string }
	| { readonly kind: 'toolInvocationSerialized'; readonly toolCallId: string; readonly toolId: string; readonly invocationMessage: string; readonly pastTenseMessage: string; readonly isComplete: true; readonly toolSpecificData: { readonly kind: 'simpleToolInvocation'; readonly input: string; readonly output: string }; readonly resultError?: string }
	| { readonly kind: 'progressTaskSerialized'; readonly content: { readonly value: string }; readonly items: readonly string[] }
	| { readonly kind: 'reference'; readonly label: string }
	| { readonly kind: 'warning'; readonly content: { readonly value: string } }
	| { readonly kind: 'errorDetails'; readonly message: string; readonly isQuotaExceeded: true }
	| { readonly kind: 'treeData'; readonly labels: readonly string[] }
	| { readonly kind: 'multiDiffData'; readonly files: readonly { readonly path: string }[] }
	| { readonly kind: 'dshImageGallery'; readonly images: readonly DshImageRef[] }
	| { readonly kind: 'dshFileCard'; readonly files: readonly DshFileRef[] }
	| { readonly kind: 'dshCompaction'; readonly summary: string | null; readonly shadowedItemCount?: number | null; readonly shadowedTokenCount?: number | null; /** 压缩进行中（官方 `compaction/start` 已落、`end` 未到）。 */ readonly inProgress?: true }
	| { readonly kind: 'dshCommand'; readonly commandId: string; readonly name: string | null; readonly args: string | null; readonly outcome: 'success' | 'error' | null; readonly text?: string; /** `conversation.chat.commandview` occupant 覆盖的标题。 */ readonly title?: string; readonly detail?: string; readonly icon?: string }
	| { readonly kind: 'dshUsage'; readonly input?: number; readonly output?: number; readonly total?: number; readonly cacheRead?: number; readonly cacheWrite?: number; readonly reasoning?: number }
	| { readonly kind: 'dshDeliverables'; readonly files: readonly { readonly path: string; readonly description?: string }[] }
	| { readonly kind: 'dshTurnTrigger'; readonly sourceKind: string; readonly title: string; readonly body: string }
	| { readonly kind: 'dshUnknown'; readonly type: string; readonly data: string }
	| { readonly kind: 'dshContext'; readonly text: string; readonly form: string | null; readonly producer: string | null }
	| { readonly kind: 'dshAssistantMeta'; readonly provider?: string; readonly model?: string; readonly interrupted?: true }
	| { readonly kind: 'dshModelRetry'; readonly retry?: number; readonly maxRetries?: number; readonly delayMs?: number; readonly mode?: 'normal' | 'always'; readonly retryState?: 'scheduled' | 'started' | 'cancelled'; readonly message?: string; readonly code?: string }
	| {
		readonly kind: 'dshWorkflowRun';
		readonly runId: string;
		readonly name: string;
		readonly status: string;
		readonly phases: readonly { readonly key: string; readonly phase: string | null; readonly members: readonly { readonly label: string; readonly status: string }[] }[];
	}
	| { readonly kind: 'dshSubmittedPlan'; readonly callId: string; readonly title: string; readonly markdown: string }
	| { readonly kind: 'dshCommandInput'; readonly commandId: string; readonly text: string }
	| { readonly kind: 'dshInheritedHistory' }
	| { readonly kind: 'dshTurnTail'; readonly closing?: string; readonly branchUnavailable?: true }
	| { readonly kind: 'dshTurnTailExtra'; readonly lines: readonly string[] }
	| {
		readonly kind: 'dshQuestionReply';
		readonly callId: string;
		readonly questions: readonly { readonly id: string; readonly question: string; readonly header?: string }[];
		readonly answers: readonly { readonly id: string; readonly selected: readonly string[]; readonly custom?: string }[];
		readonly text: string;
	}
	| { readonly kind: 'dshMaxTokens'; readonly turn?: number; readonly step?: number };

export interface DshImageRef {
	readonly attachmentId: string;
	readonly mediaType?: string;
	readonly name?: string;
	readonly width?: number;
	readonly height?: number;
}

export interface DshFileRef {
	readonly name: string;
	readonly attachmentId?: string;
	readonly bytes?: number;
}

interface Block {
	readonly kind?: string;
	readonly type?: string;
	readonly text?: string;
	readonly name?: string;
	readonly argsRaw?: string;
	readonly callId?: string;
	readonly attachment?: { readonly name?: string; readonly attachmentId?: string; readonly mediaType?: string; readonly bytes?: number; readonly width?: number; readonly height?: number };
}

/** 一个节点对应的原生 part。助手块会拆成多条。 */
export function adaptDshNode(node: DshIndexedNode, sessionId?: string): readonly DshNativeAdaptation[] {
	const record = node as DshIndexedNode & {
		readonly blocks?: readonly Block[];
		readonly content?: readonly Block[];
		readonly name?: string;
		readonly argsRaw?: string;
		readonly args?: unknown;
		readonly call?: { readonly name?: string; readonly argsRaw?: string } | null;
		readonly callId?: string;
		readonly isError?: boolean;
		readonly error?: { readonly reason?: string; readonly code?: string; readonly name?: string };
		readonly message?: string;
		readonly code?: string;
		readonly summary?: string | null;
		readonly commandId?: string;
		readonly outcome?: { readonly kind?: string; readonly text?: string } | null;
		readonly shadowedItemCount?: number | null;
		readonly shadowedTokenCount?: number | null;
		readonly usage?: unknown;
		readonly tokenUsage?: unknown;
		readonly text?: string;
		readonly update?: string;
		readonly closing?: unknown;
		readonly branchUnavailable?: unknown;
		readonly files?: readonly { readonly path?: string; readonly description?: string }[];
		readonly type?: string;
		readonly data?: unknown;
		readonly command?: { readonly commandId?: string; readonly name?: string | null; readonly args?: unknown; readonly outcome?: { readonly kind?: string; readonly text?: string } | null };
		readonly compaction?: { readonly summary?: string | null; readonly shadowedItemCount?: number | null; readonly shadowedTokenCount?: number | null };
		readonly producer?: unknown;
		readonly form?: string | null;
		readonly providerMetadata?: { readonly provider?: string; readonly model?: string };
		readonly interrupted?: true;
		readonly retry?: number;
		readonly maxRetries?: number;
		readonly delayMs?: number;
		readonly mode?: 'normal' | 'always';
		readonly retryState?: 'scheduled' | 'started' | 'cancelled';
		readonly failure?: { readonly message?: string; readonly code?: string };
	};
	if (node.kind === 'user') {
		return contentExtras(node, record.content, sessionId);
	}
	if (node.kind === 'assistant' || node.kind === 'assistant-step') {
		return [...(record.blocks ?? []).flatMap(block => adaptBlock(node, block, sessionId)), ...assistantMeta(record)];
	}
	if (node.kind === 'compaction') {
		return [compactionCard(record)];
	}
	if (node.kind === 'command') {
		return [commandCard(record, sessionId)];
	}
	if (node.kind === 'context') {
		return [...contextCard(record), ...contentExtras(node, record.content, sessionId)];
	}
	if (node.kind === 'unknown') {
		return [unknownCard(record.type || 'unknown', record.data)];
	}
	if (node.kind === 'manual-compaction') {
		return [commandCard(record.command ?? {}, sessionId), compactionCard(record.compaction ?? {})];
	}
	if (node.kind === 'workflow-run') {
		return [workflowRunCard(record)];
	}
	if (node.kind === 'submitted-plan') {
		return [submittedPlanCard(record)];
	}
	if (node.kind === 'command-input') {
		return [commandInputCard(record)];
	}
	if (node.kind === 'question-reply') {
		return [questionReplyCard(record)];
	}
	if (node.kind === 'turn-trigger') {
		return [turnTriggerCard(node, textOf(record.content)), ...contentExtras(node, record.content, sessionId)];
	}
	if (node.kind === 'steering') {
		const text = textOf(record.content);
		const body = text === '' ? [] : [markdown(text, 'steering body reuses ChatMarkdownContentPart; no Steering prefix')];
		return [...body, ...contentExtras(node, record.content, sessionId)];
	}
	if (node.kind === 'turn-tail') {
		// 用量只在尾部出现，对齐官方把 TurnUsagePanel 放在 turn tail 的做法；不再逐条助手重复。
		const extras = dshTurnTailExtras(sessionId, record.turn ?? node.turn ?? -1, node.seq);
		return [
			...turnTailCard(record),
			...usageParts(record.tokenUsage),
			...deliverableParts(record.files),
			...(extras.length === 0 ? [] : [{ adapter: 'turn-tail', reuse: 'dshSlotHostContentPart:renderAdaptedFallback', reason: '插件可向 turn 尾部追加行', part: { kind: 'dshTurnTailExtra', lines: extras.map(extra => extra.label) } } as const]),
		];
	}
	if (node.kind === 'tool-call' || node.kind === 'tool-result') {
		return adaptTool(node, record, sessionId);
	}
	if (node.kind === 'model-retry') {
		return [modelRetryCard(record)];
	}
	if (node.kind === 'turn-max-tokens') {
		return [maxTokensCard(node)];
	}
	if (node.kind === 'inherited-history') {
		return [inheritedHistoryCard()];
	}
	if (node.kind === 'turn-error') {
		return [adaptFailure(node, record)];
	}
	const text = textOf(record.content) || record.summary || record.message || '';
	const parts: DshNativeAdaptation[] = [];
	if (text !== '') {
		parts.push(markdown(text, `${node.kind} body reuses ChatMarkdownContentPart`));
	}
	parts.push(...mediaCards(record.content));
	return parts;
}

function adaptBlock(node: DshIndexedNode, block: Block, sessionId?: string): readonly DshNativeAdaptation[] {
	if (block.kind === 'text' || block.type === 'text') {
		// 官方 `ui-chat/README.md`「Hidden Chat rows」：「Text and reasoning contribute to Assistant
		// visibility **only when they contain a non-whitespace character**.」
		// 只判空串会把纯空白的块也画成一个空 markdown——流式中这种块很常见（换行/缩进）。
		return (block.text ?? '').trim() === '' ? [] : [markdown(block.text ?? '', 'assistant text reuses ChatMarkdownContentPart')];
	}
	if (block.kind === 'reasoning' || block.type === 'reasoning') {
		// `conversation.chat.reasoning.body` 是 single 槽：occupant 可覆盖正文文本。
		const value = dshReasoningBodyOverride(sessionId) ?? block.text ?? '';
		// 同一条官方规则：reasoning 也只有含非空白字符时才产生行。
		return value.trim() === '' ? [] : [{
			adapter: 'thinking',
			reuse: 'ChatThinkingContentPart',
			reason: '思考块复用原生 thinking，不放进正文 markdown',
			part: { kind: 'thinking', id: `${dshNodeKey(node)}:reasoning`, value },
		}];
	}
	if (block.kind === 'tool-call' || block.type === 'tool-call') {
		const wire = block as { readonly id?: string; readonly arguments?: string };
		return adaptTool(node, {
			name: block.name,
			argsRaw: block.argsRaw || wire.arguments,
			callId: block.callId || wire.id,
		}, sessionId);
	}
	if (block.kind === 'other') {
		const inner = (block as { readonly block?: unknown }).block;
		return [unknownCard(blockTypeOf(inner) || 'other', inner ?? block)];
	}
	if (block.type === 'plugin') {
		const plugin = block as { readonly pluginType?: string; readonly block?: unknown };
		return [unknownCard(plugin.pluginType || 'plugin', plugin.block ?? block)];
	}
	if (block.type === 'tool-addition' || block.type === 'tool-removal') {
		const toolName = (block as { readonly toolName?: string }).toolName || '';
		return [unknownCard(block.type, toolName === '' ? block : { toolName })];
	}
	if (block.kind === 'image' || block.type === 'image' || block.kind === 'file' || block.type === 'file') {
		return mediaCards([block]);
	}
	const type = block.kind || block.type;
	return type === undefined || type === '' ? [] : [unknownCard(type, block)];
}

function adaptTool(node: DshIndexedNode, record: { readonly name?: string; readonly argsRaw?: string; readonly args?: unknown; readonly call?: { readonly argsRaw?: string } | null; readonly callId?: string; readonly content?: readonly Block[]; readonly isError?: boolean; readonly error?: { readonly name?: string; readonly reason?: string; readonly code?: string } }, sessionId?: string): readonly DshNativeAdaptation[] {
	const toolName = record.name || '';
	// `tool.call.toolview` 是 keyed 槽：插件可以按 wire 工具名指定家族，缺省才用内置分派。
	const view = (dshToolViewOverride(toolName, sessionId) ?? dshToolViewId(toolName)) as DshToolViewId;
	const args = argsOf(record);
	const output = textOf(record.content);
	const shaped = shapeTool(view, toolName, args, record.argsRaw || record.call?.argsRaw || '', output);
	const callId = record.callId || dshNodeKey(node);
	const parts: DshNativeAdaptation[] = [{
		adapter: 'tool',
		reuse: 'ChatToolInvocationPart',
		reason: `${view} 家族用自己的 input，不跟其它工具共用一句 generic 文案`,
		view,
		part: {
			kind: 'toolInvocationSerialized',
			toolCallId: callId,
			toolId: toolName || view,
			invocationMessage: shaped.message,
			pastTenseMessage: shaped.message,
			isComplete: true,
			toolSpecificData: { kind: 'simpleToolInvocation', input: shaped.input, output: shaped.output },
			...(record.isError ? { resultError: [record.error?.name, record.error?.code, record.error?.reason].filter((part): part is string => typeof part === 'string' && part !== '').join(': ') || 'error' } : {}),
		},
	}];
	if (view === 'todo') {
		parts.push({
			adapter: 'task',
			reuse: 'ChatTaskContentPart',
			reason: 'todo_write 的条目复用任务行',
			part: { kind: 'progressTaskSerialized', content: { value: shaped.message }, items: shaped.items },
		});
	}
	if (view === 'search' && shaped.items.length > 0) {
		parts.push({
			adapter: 'tree',
			reuse: 'ChatTreeContentPart',
			reason: '搜索命中路径走树，不埋进一段 markdown',
			part: { kind: 'treeData', labels: shaped.items },
		});
	}
	if (view === 'file-mutation' && shaped.path !== '') {
		parts.push({
			adapter: 'diff',
			reuse: 'ChatMultiDiffContentPart',
			reason: '改写路径列成 diff 条目；完整 diff 编辑器仍由原生 opener 打开',
			part: { kind: 'multiDiffData', files: [{ path: shaped.path }] },
		});
	}
	parts.push(...mediaCards(record.content));
	return parts;
}

function modelRetryCard(record: {
	readonly retry?: number;
	readonly maxRetries?: number;
	readonly delayMs?: number;
	readonly mode?: 'normal' | 'always';
	readonly retryState?: 'scheduled' | 'started' | 'cancelled';
	readonly failure?: { readonly message?: string; readonly code?: string };
	readonly message?: string;
	readonly code?: string;
}): DshNativeAdaptation {
	const message = record.failure?.message || record.message;
	const code = record.failure?.code || record.code;
	return {
		adapter: 'model-retry',
		reuse: 'dshSlotHostContentPart:renderAdaptedFallback',
		reason: '重试链保留次数、延迟和状态，不写成一句 Model retry',
		part: {
			kind: 'dshModelRetry',
			...(typeof record.retry === 'number' ? { retry: record.retry } : {}),
			...(typeof record.maxRetries === 'number' ? { maxRetries: record.maxRetries } : {}),
			...(typeof record.delayMs === 'number' ? { delayMs: record.delayMs } : {}),
			...(record.mode === undefined ? {} : { mode: record.mode }),
			...(record.retryState === undefined ? {} : { retryState: record.retryState }),
			...(message === undefined || message === '' ? {} : { message }),
			...(code === undefined || code === '' ? {} : { code }),
		},
	};
}

function maxTokensCard(node: DshIndexedNode): DshNativeAdaptation {
	return {
		adapter: 'max-tokens',
		reuse: 'dshSlotHostContentPart:renderAdaptedFallback',
		reason: '输出上限是回合坐标，不是一句引用',
		part: {
			kind: 'dshMaxTokens',
			...(node.turn === undefined ? {} : { turn: node.turn }),
			...(node.step === undefined ? {} : { step: node.step }),
		},
	};
}

function inheritedHistoryCard(): DshNativeAdaptation {
	return {
		adapter: 'inherited-history',
		reuse: 'dshSlotHostContentPart:renderAdaptedFallback',
		reason: 'fork 分界没有正文，不能再写引用块',
		part: { kind: 'dshInheritedHistory' },
	};
}

function adaptFailure(node: DshIndexedNode, record: { readonly message?: string; readonly code?: string }): DshNativeAdaptation {
	const message = record.message || node.kind;
	if (record.code === 'QUOTA' || record.code === 'ACCOUNT_QUOTA') {
		// `shell.quota-notice` 是 root 的 chain：插件可认领同一 code 并覆盖文案。
		const override = dshQuotaNoticeOverride(record.code);
		return {
			adapter: 'quota',
			reuse: 'ChatQuotaExceededPart',
			reason: '配额失败复用配额 part，不降级成普通 warning',
			part: { kind: 'errorDetails', message: override?.label ?? message, isQuotaExceeded: true },
		};
	}
	return {
		adapter: 'error',
		reuse: 'ChatErrorContentPart',
		reason: '回合错误复用错误 part',
		part: { kind: 'warning', content: { value: record.code === undefined ? message : `${record.code}: ${message}` } },
	};
}

function markdown(value: string, reason: string): DshNativeAdaptation {
	return {
		adapter: 'markdown',
		reuse: 'ChatMarkdownContentPart',
		reason,
		part: { kind: 'markdownContent', content: { value } },
	};
}

function mediaCards(blocks: readonly Block[] | undefined): DshNativeAdaptation[] {
	if (blocks === undefined) {
		return [];
	}
	const images: DshImageRef[] = [];
	const files: DshFileRef[] = [];
	for (const block of blocks) {
		const attachment = block.attachment;
		if (attachment === undefined) {
			continue;
		}
		if (block.type === 'image' || block.kind === 'image') {
			if (attachment.attachmentId === undefined || attachment.attachmentId === '') {
				continue;
			}
			images.push({
				attachmentId: attachment.attachmentId,
				...(attachment.mediaType === undefined ? {} : { mediaType: attachment.mediaType }),
				...(attachment.name === undefined ? {} : { name: attachment.name }),
				...(attachment.width === undefined ? {} : { width: attachment.width }),
				...(attachment.height === undefined ? {} : { height: attachment.height }),
			});
			continue;
		}
		if (block.type === 'file' || block.kind === 'file') {
			const name = attachment.name || attachment.attachmentId;
			if (name === undefined || name === '') {
				continue;
			}
			files.push({
				name,
				...(attachment.attachmentId === undefined ? {} : { attachmentId: attachment.attachmentId }),
				...(attachment.bytes === undefined ? {} : { bytes: attachment.bytes }),
			});
		}
	}
	const parts: DshNativeAdaptation[] = [];
	if (images.length > 0) {
		parts.push({
			adapter: 'image',
			// 渲染走原生 `ChatAttachmentsContentPart`（`DshAttachmentListContentPart` 只补
			// `IChatContentPart` 接口）：缩略图、点击打开、hover 预览、主题适配都由原生提供。
			reuse: 'ChatAttachmentsContentPart',
			reason: '图片画廊复用原生附件部件，不自绘缩略图也不列附件名',
			part: { kind: 'dshImageGallery', images },
		});
	}
	if (files.length > 0) {
		parts.push({
			adapter: 'file',
			// DSH 文件块只带 attachmentId / name / bytes，没有文件系统路径，因此交给原生
			// `ChatUsedReferencesListContentPart` 的可折叠引用列表；`FileAttachmentWidget`
			// 需要 `resource: URI`，硬编路径属伪造数据（CHK-317）。
			reuse: 'ChatUsedReferencesListContentPart',
			reason: '文件卡没有可打开的路径，用原生引用列表按名字展示',
			part: { kind: 'dshFileCard', files },
		});
	}
	return parts;
}

function compactionCard(record: { readonly summary?: string | null; readonly shadowedItemCount?: number | null; readonly shadowedTokenCount?: number | null; readonly inProgress?: true }): DshNativeAdaptation {
	return {
		adapter: 'compaction',
		reuse: 'dshSlotHostContentPart:renderAdaptedFallback',
		reason: '原生没有 DSH compaction 语义，不用 markdown 引用块',
		part: {
			kind: 'dshCompaction',
			...(record.inProgress === true ? { inProgress: true as const } : {}),
			summary: record.summary ?? null,
			...(record.shadowedItemCount === undefined ? {} : { shadowedItemCount: record.shadowedItemCount }),
			...(record.shadowedTokenCount === undefined ? {} : { shadowedTokenCount: record.shadowedTokenCount }),
		},
	};
}

function commandCard(
	record: { readonly commandId?: string; readonly name?: string | null; readonly args?: unknown; readonly outcome?: { readonly kind?: string; readonly text?: string } | null },
	sessionId?: string,
): DshNativeAdaptation {
	const outcome = record.outcome?.kind === 'success' || record.outcome?.kind === 'error' ? record.outcome.kind : null;
	// 官方 keyed 槽 `conversation.chat.commandview`：插件可按命令名覆盖命令行卡。
	const override = dshCommandRowOverride(record.name, sessionId);
	return {
		adapter: 'command',
		reuse: 'dshSlotHostContentPart:renderAdaptedFallback',
		reason: '斜杠命令用命令行，不用反引号 markdown',
		part: {
			kind: 'dshCommand',
			...(override?.title === undefined ? {} : { title: override.title }),
			...(override?.detail === undefined ? {} : { detail: override.detail }),
			...(override?.icon === undefined ? {} : { icon: override.icon }),
			commandId: record.commandId || '',
			name: record.name ?? null,
			args: typeof record.args === 'string' ? record.args : null,
			outcome,
			...(record.outcome?.text === undefined ? {} : { text: record.outcome.text }),
		},
	};
}

/** 触发行标题。不带 markdown 引用前缀。未知 source 不编造身份。 */
export function dshTurnTriggerTitle(sourceKind: string, body: string): string {
	// 用户可见文案必须走 NLS（AGENTS §7）。带正文时用 `{0}` 占位符拼在同一句里，
	// 这样中文语序可以调整，而不是把冒号两侧的英文硬拼起来。
	switch (sourceKind) {
		case 'subagent-settled':
			return body === '' ? localize('dsh.trigger.subagentSettled', "Subagent settled") : localize('dsh.trigger.subagentSettledWithBody', "Subagent settled: {0}", body);
		case 'agent-message':
			return body === '' ? localize('dsh.trigger.agentMessage', "Message from another agent") : localize('dsh.trigger.agentMessageWithBody', "Message from another agent: {0}", body);
		case 'retry':
			return localize('dsh.trigger.retry', "Continuation requested");
		case 'goal':
			return body === '' ? localize('dsh.trigger.goal', "Goal continuation") : localize('dsh.trigger.goalWithBody', "Goal continuation: {0}", body);
		case 'team-message':
			return body === '' ? localize('dsh.trigger.teamMessage', "Team message") : localize('dsh.trigger.teamMessageWithBody', "Team message: {0}", body);
		case 'webhook':
			return body === '' ? localize('dsh.trigger.webhook', "Webhook") : localize('dsh.trigger.webhookWithBody', "Webhook: {0}", body);
		case 'schedule':
			return body === '' ? localize('dsh.trigger.schedule', "Scheduled run") : localize('dsh.trigger.scheduleWithBody', "Scheduled run: {0}", body);
		case 'tool-jobs':
			return body === '' ? localize('dsh.trigger.toolJobs', "Background job") : localize('dsh.trigger.toolJobsWithBody', "Background job: {0}", body);
		case 'cordis-host-runner':
			return body === '' ? localize('dsh.trigger.pluginRun', "Plugin run") : localize('dsh.trigger.pluginRunWithBody', "Plugin run: {0}", body);
		default:
			// 未知 source 不编造身份：有正文就只显示正文，没有才用通用标题。
			return body === '' ? localize('dsh.trigger.generic', "Turn trigger") : body;
	}
}

function assistantMeta(record: { readonly providerMetadata?: { readonly provider?: string; readonly model?: string }; readonly interrupted?: true }): DshNativeAdaptation[] {
	const provider = record.providerMetadata?.provider;
	const model = record.providerMetadata?.model;
	const hasProvider = typeof provider === 'string' && provider !== '';
	const hasModel = typeof model === 'string' && model !== '';
	const interrupted = record.interrupted === true;
	if (!hasProvider && !hasModel && !interrupted) {
		return [];
	}
	return [{
		adapter: 'assistant-meta',
		reuse: 'dshSlotHostContentPart:renderAdaptedFallback',
		reason: '提供方和中断标记来自节点，不写进正文',
		part: {
			kind: 'dshAssistantMeta',
			...(hasProvider ? { provider } : {}),
			...(hasModel ? { model } : {}),
			...(interrupted ? { interrupted: true as const } : {}),
		},
	}];
}

function contentExtras(node: DshIndexedNode, content: readonly Block[] | undefined, sessionId?: string): DshNativeAdaptation[] {
	return (content ?? [])
		.filter(block => block.type !== 'text' && block.kind !== 'text')
		.flatMap(block => adaptBlock(node, block, sessionId));
}

function contextCard(record: { readonly content?: readonly Block[]; readonly form?: string | null; readonly producer?: unknown }): DshNativeAdaptation[] {
	const text = textOf(record.content);
	const form = typeof record.form === 'string' && record.form !== '' ? record.form : null;
	const producer = producerLabel(record.producer);
	if (text === '' && form === null && producer === null) {
		return [];
	}
	return [{
		adapter: 'context',
		reuse: 'dshSlotHostContentPart:renderAdaptedFallback',
		reason: '上下文保留 form 和 producer，不写成引用块',
		part: { kind: 'dshContext', text, form, producer },
	}];
}

function producerLabel(value: unknown): string | null {
	if (typeof value === 'string' && value !== '') {
		return value;
	}
	if (typeof value !== 'object' || value === null) {
		return null;
	}
	const record = value as { readonly label?: unknown; readonly role?: unknown };
	if (typeof record.label === 'string' && record.label !== '') {
		return record.label;
	}
	return typeof record.role === 'string' && record.role !== '' ? record.role : null;
}

function blockTypeOf(value: unknown): string {
	if (typeof value !== 'object' || value === null) {
		return '';
	}
	const type = (value as { readonly type?: unknown; readonly kind?: unknown }).type
		?? (value as { readonly kind?: unknown }).kind;
	return typeof type === 'string' ? type : '';
}

function unknownCard(type: string, data: unknown): DshNativeAdaptation {
	return {
		adapter: 'unknown',
		reuse: 'dshSlotHostContentPart:renderAdaptedFallback',
		reason: '认不出的节点必须留在画面上，只展示记录下来的 type 和数据，不编造含义',
		part: { kind: 'dshUnknown', type, data: boundedJson(data) },
	};
}

function boundedJson(data: unknown): string {
	try {
		const text = JSON.stringify(data);
		if (text === undefined) {
			return '';
		}
		return text.length > 400 ? `${text.slice(0, 400)}…` : text;
	} catch {
		return '';
	}
}

function workflowRunCard(record: {
	readonly runId?: string;
	readonly name?: string;
	readonly status?: string;
	readonly phases?: readonly { readonly key: string; readonly phase: string | null; readonly members: readonly { readonly label: string; readonly status: string }[] }[];
}): DshNativeAdaptation {
	return {
		adapter: 'workflow-run',
		reuse: 'dshSlotHostContentPart:renderAdaptedFallback',
		reason: '工作流按阶段与成员显示状态，不并进一张通用工具卡',
		part: {
			kind: 'dshWorkflowRun',
			runId: record.runId || '',
			name: record.name || '',
			status: record.status || 'running',
			phases: record.phases ?? [],
		},
	};
}

function submittedPlanCard(record: { readonly callId?: string; readonly title?: string; readonly markdown?: string }): DshNativeAdaptation {
	return {
		adapter: 'submitted-plan',
		reuse: 'dshSlotHostContentPart:renderAdaptedFallback',
		reason: '计划是一整份 Markdown 文档，用卡片保留标题与正文，不并进工具行',
		part: { kind: 'dshSubmittedPlan', callId: record.callId || '', title: record.title || '', markdown: record.markdown || '' },
	};
}

function commandInputCard(record: { readonly commandId?: string; readonly text?: string }): DshNativeAdaptation {
	return {
		adapter: 'command-input',
		reuse: 'dshSlotHostContentPart:renderAdaptedFallback',
		reason: '人工 /goal 输入按命令行回显，不混进模型消息',
		part: { kind: 'dshCommandInput', commandId: record.commandId || '', text: record.text || '' },
	};
}

function questionReplyCard(record: {
	readonly callId?: string;
	readonly questions?: readonly { readonly id: string; readonly question: string; readonly header?: string }[];
	readonly answers?: readonly { readonly id: string; readonly selected: readonly string[]; readonly custom?: string }[];
	readonly text?: string;
}): DshNativeAdaptation {
	return {
		adapter: 'question-reply',
		reuse: 'dshSlotHostContentPart:renderAdaptedFallback',
		reason: '已作答问卷按题面回显，不要只剩一张通用工具卡',
		part: {
			kind: 'dshQuestionReply',
			callId: record.callId || '',
			questions: record.questions ?? [],
			answers: record.answers ?? [],
			text: record.text ?? '',
		},
	};
}

function turnTriggerCard(node: DshIndexedNode, body: string): DshNativeAdaptation {
	const source = (node as { readonly source?: { readonly kind?: unknown } }).source;
	const sourceKind = typeof source?.kind === 'string' ? source.kind : '';
	return {
		adapter: 'turn-trigger',
		reuse: 'dshSlotHostContentPart:renderAdaptedFallback',
		reason: '触发行按 source.kind 取标题，不用 markdown 引用块',
		part: { kind: 'dshTurnTrigger', sourceKind, title: dshTurnTriggerTitle(sourceKind, body), body },
	};
}


function turnTailCard(record: { readonly closing?: unknown; readonly branchUnavailable?: unknown }): DshNativeAdaptation[] {
	const closing = typeof record.closing === 'string' ? record.closing : '';
	// 线协议只允许 `branchUnavailable: true`（校验器拒绝其它值），这里不再猜字符串原因。
	const unavailable = record.branchUnavailable === true;
	if (closing === '' && !unavailable) {
		return [];
	}
	return [{
		adapter: 'turn-tail',
		reuse: 'dshSlotHostContentPart:renderAdaptedFallback',
		reason: '回合收尾的 closing 和分支不可用要留在 tail 里，不写进正文',
		part: {
			kind: 'dshTurnTail',
			...(closing === '' ? {} : { closing }),
			...(unavailable ? { branchUnavailable: true as const } : {}),
		},
	}];
}

function usageParts(usage: unknown): DshNativeAdaptation[] {
	if (usage === null || typeof usage !== 'object') {
		return [];
	}
	const record = usage as {
		input?: unknown;
		output?: unknown;
		total?: unknown;
		inputTokens?: unknown;
		outputTokens?: unknown;
		promptTokens?: unknown;
		completionTokens?: unknown;
		cacheRead?: unknown;
		cacheReadTokens?: unknown;
		cacheWrite?: unknown;
		cacheWriteTokens?: unknown;
		reasoning?: unknown;
		reasoningTokens?: unknown;
	};
	const input = numberOf(record.input ?? record.inputTokens ?? record.promptTokens);
	const output = numberOf(record.output ?? record.outputTokens ?? record.completionTokens);
	const total = numberOf(record.total) ?? (input !== undefined && output !== undefined ? input + output : undefined);
	const cacheRead = numberOf(record.cacheRead ?? record.cacheReadTokens);
	const cacheWrite = numberOf(record.cacheWrite ?? record.cacheWriteTokens);
	const reasoning = numberOf(record.reasoning ?? record.reasoningTokens);
	if (input === undefined && output === undefined && total === undefined && cacheRead === undefined && cacheWrite === undefined && reasoning === undefined) {
		return [];
	}
	return [{
		adapter: 'usage',
		reuse: 'dshSlotHostContentPart:renderAdaptedFallback',
		reason: '用量在 turn tail 内，不单开 slot，也不写进 info 文本',
		part: {
			kind: 'dshUsage',
			...(input === undefined ? {} : { input }),
			...(output === undefined ? {} : { output }),
			...(total === undefined ? {} : { total }),
			...(cacheRead === undefined ? {} : { cacheRead }),
			...(cacheWrite === undefined ? {} : { cacheWrite }),
			...(reasoning === undefined ? {} : { reasoning }),
		},
	}];
}

function deliverableParts(files: readonly { readonly path?: string; readonly description?: string }[] | undefined): DshNativeAdaptation[] {
	if (files === undefined) {
		return [];
	}
	const kept = files.flatMap(file => typeof file.path === 'string' && file.path !== '' ? [{ path: file.path, ...(file.description === undefined ? {} : { description: file.description }) }] : []);
	if (kept.length === 0) {
		return [];
	}
	return [{
		adapter: 'deliverable',
		// 交付物有绝对路径，交给原生引用列表（`ChatUsedReferencesListContentPart`）：
		// 点击由原生打开器接管，不自绘列表也不写说明文字。
		reuse: 'ChatUsedReferencesListContentPart',
		reason: '交付物是文件列表，打开走原生 reference 列表，不用一段说明文字',
		part: { kind: 'dshDeliverables', files: kept },
	}];
}

function numberOf(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

interface ShapedTool {
	readonly message: string;
	readonly input: string;
	readonly output: string;
	readonly path: string;
	readonly items: readonly string[];
}

function shapeTool(view: DshToolViewId, toolName: string, args: Record<string, unknown> | undefined, raw: string, output: string): ShapedTool {
	const command = field(args, 'command') || raw;
	const path = field(args, 'file_path') || field(args, 'path') || field(args, 'target_file') || field(args, 'file');
	const pattern = field(args, 'pattern') || field(args, 'query') || field(args, 'glob');
	const url = field(args, 'url') || field(args, 'query');
	if (view === 'bash') {
		return { message: command === '' ? 'bash' : `$ ${command}`, input: command, output, path: '', items: [] };
	}
	if (view === 'read' || view === 'read-image') {
		return { message: path || toolName, input: path, output, path, items: [] };
	}
	if (view === 'file-mutation') {
		return { message: path || toolName, input: path || raw, output, path, items: [] };
	}
	if (view === 'search') {
		const hits = output.split('\n').map(line => line.trim()).filter(line => line !== '').slice(0, 20);
		return { message: pattern || toolName, input: pattern, output, path: '', items: hits };
	}
	if (view === 'web') {
		return { message: url || toolName, input: url || raw, output, path: '', items: [] };
	}
	if (view === 'todo') {
		const items = todoItems(args);
		return { message: toolName || 'todo_write', input: items.join('\n'), output, path: '', items };
	}
	if (view === 'ask-question') {
		const question = field(args, 'question') || field(args, 'header') || raw;
		return { message: question || toolName, input: question, output, path: '', items: [] };
	}
	if (view === 'office' || view === 'skill' || view === 'present') {
		const label = path || field(args, 'name') || field(args, 'skill') || toolName;
		return { message: label, input: label, output, path, items: [] };
	}
	if (view === 'details') {
		const line = raw === '' ? toolName : `${toolName} ${raw.replace(/\s+/g, ' ').slice(0, 160)}`;
		return { message: line, input: line, output, path: '', items: [] };
	}
	return { message: toolName || 'tool', input: raw, output, path: '', items: [] };
}

function todoItems(args: Record<string, unknown> | undefined): string[] {
	const todos = args?.['todos'];
	if (!Array.isArray(todos)) {
		return [];
	}
	const lines: string[] = [];
	for (const item of todos) {
		if (item !== null && typeof item === 'object' && 'content' in item) {
			lines.push(String((item as { content?: unknown }).content ?? ''));
		}
	}
	return lines;
}

function argsOf(record: { readonly args?: unknown; readonly argsRaw?: string; readonly call?: { readonly argsRaw?: string } | null }): Record<string, unknown> | undefined {
	if (record.args !== null && typeof record.args === 'object' && !Array.isArray(record.args)) {
		return record.args as Record<string, unknown>;
	}
	const raw = record.argsRaw || record.call?.argsRaw;
	if (typeof raw !== 'string' || raw === '') {
		return undefined;
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function field(args: Record<string, unknown> | undefined, key: string): string {
	const value = args?.[key];
	return typeof value === 'string' ? value : '';
}

function textOf(blocks: readonly Block[] | undefined): string {
	if (blocks === undefined) {
		return '';
	}
	const lines: string[] = [];
	for (const block of blocks) {
		if (typeof block.text === 'string' && block.text !== '') {
			lines.push(block.text);
		}
	}
	return lines.join('\n');
}
