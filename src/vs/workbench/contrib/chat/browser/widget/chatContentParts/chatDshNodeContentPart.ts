/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { renderAsPlaintext } from '../../../../../../base/browser/markdownRenderer.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { localize } from '../../../../../../nls.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IMarkdownRenderer } from '../../../../../../platform/markdown/browser/markdownRenderer.js';
import { IChatDshNodePart } from '../../../common/chatService/chatService.js';
import { IChatRendererContent } from '../../../common/model/chatViewModel.js';
import { IChatContentPart } from './chatContentParts.js';
import { DshRawJsonView } from './dsh/dshRawJsonView.js';
import { DshViewKind, DshNodeViewInput } from './dsh/dshNodeTypes.js';
import { DshUserView } from './dsh/dshUserView.js';
import { DshAssistantView } from './dsh/dshAssistantView.js';
import { DshToolView } from './dsh/dshToolView.js';
import { DshContextView } from './dsh/dshContextView.js';
import { DshCommandView } from './dsh/dshCommandView.js';
import { DshCompactionView } from './dsh/dshCompactionView.js';
import { DshModelRetryView } from './dsh/dshModelRetryView.js';
import { DshTurnErrorView } from './dsh/dshTurnErrorView.js';
import { DshTurnMaxTokensView } from './dsh/dshTurnMaxTokensView.js';
import { DshInheritedHistoryView } from './dsh/dshInheritedHistoryView.js';
import { DshUnknownView } from './dsh/dshUnknownView.js';

/**
 * DSH 会话节点的原生渲染部件（按 kind 分派）。
 *
 * 两个真值的分工（由 `verifyProjectionBinding` 绑定）：
 * - `encoded` = 源载荷 canonical，**校验真值**；用于「原始载荷」详情与解码兜底。
 * - `projectionEncoded` = 解码后节点 canonical，**渲染真值**；含跨事件累积字段。
 * - `hint` = 分派信号，只选择渲染函数，不进入任何可见文本。
 *
 * 纯度约束：本文件不 import `DshChatNode`，不读 `DshChatSession` / `DshChatModel`
 * 或任何其它 part；所有可见内容都由上述两个 JSON 字符串派生。
 */
export class ChatDshNodeContentPart extends Disposable implements IChatContentPart {
	readonly domNode: HTMLElement;

	constructor(
		private readonly part: IChatDshNodePart,
		private readonly renderer: IMarkdownRenderer,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		// 视图目前都用显式构造；保留注入点供后续子视图按需 createInstance。
		void instantiationService;
		this.domNode = this._render(part);
	}

	private _render(part: IChatDshNodePart): HTMLElement {
		const container = dom.$('.chat-dsh-node');
		container.setAttribute('data-dsh-node-id', part.id);

		// 解码：只解一次，两个视图共用；失败则原样显示 encoded（不丢信息）。
		let encodedParsed: unknown;
		let encodedOk = true;
		try {
			encodedParsed = JSON.parse(part.encoded);
		} catch {
			encodedOk = false;
		}
		if (!encodedOk) {
			container.setAttribute('data-dsh-node-kind', 'malformed');
			const fallback = dom.append(container, dom.$('.chat-dsh-node-raw'));
			fallback.textContent = part.encoded;
			container.setAttribute('aria-label', localize('chat.dshNode.malformed', "DSH node (unparsable payload)"));
			return container;
		}

		let parsedProjection: unknown;
		let projectionOk = true;
		try {
			parsedProjection = JSON.parse(part.projectionEncoded);
		} catch {
			projectionOk = false;
		}

		const kind = this._resolveKind(part, parsedProjection, encodedParsed);
		container.setAttribute('data-dsh-node-kind', kind);

		const stores = new DisposableStore();
		this._register(stores);

		const input: DshNodeViewInput = {
			encoded: part.encoded,
			encodedParsed,
			parsed: projectionOk ? parsedProjection : encodedParsed,
			projectionAvailable: projectionOk,
			id: part.id,
			kind,
		};

		const view = this._createView(kind, input, stores);
		container.appendChild(view.domNode);

		// 每个节点都必须有「原始载荷」详情：专用视图不能成为唯一出口。
		container.appendChild(this._renderRawDetails(input, stores));

		container.setAttribute('aria-label', localize('chat.dshNode.label', "DSH node {0}", kind));
		return container;
	}

	/** 分派 kind：优先用 hint，退化到投影/源载荷上的判别字段，最后 unknown。 */
	private _resolveKind(part: IChatDshNodePart, projection: unknown, encoded: unknown): DshViewKind {
		const fromHint = asKind(part.hint);
		if (fromHint !== undefined) {
			return fromHint;
		}
		const fromProjection = asKind(readString(projection, 'kind'));
		if (fromProjection !== undefined) {
			return fromProjection;
		}
		// 源载荷没有 kind，只有事件 type；这里只做兜底识别，不做完整 type→kind 推导。
		const type = readString(encoded, 'type');
		if (type !== undefined) {
			return 'unknown';
		}
		return 'unknown';
	}

	private _createView(kind: DshViewKind, input: DshNodeViewInput, stores: DisposableStore): { domNode: HTMLElement } {
		switch (kind) {
			case 'user':
			case 'steering':
				return new DshUserView(input, this.renderer, stores);
			case 'assistant':
				return new DshAssistantView(input, this.renderer, stores);
			case 'tool-call':
			case 'tool-result':
				return new DshToolView(input, this.renderer, stores);
			case 'context':
				return new DshContextView(input, this.renderer, stores);
			case 'command':
				return new DshCommandView(input, stores);
			case 'compaction':
				return new DshCompactionView(input, this.renderer, stores);
			case 'model-retry':
				return new DshModelRetryView(input, stores);
			case 'turn-error':
				return new DshTurnErrorView(input, this.renderer, stores);
			case 'turn-max-tokens':
				return new DshTurnMaxTokensView(input, stores);
			case 'inherited-history':
				return new DshInheritedHistoryView(input, stores);
			case 'unknown':
			default:
				return new DshUnknownView(input, stores);
		}
	}

	/** 「原始载荷」详情：永远显示 encoded 原文，保证专用视图不隐藏任何字段。 */
	private _renderRawDetails(input: DshNodeViewInput, stores: DisposableStore): HTMLElement {
		return new DshRawJsonView(input, stores).domNode;
	}

	hasSameContent(other: IChatRendererContent): boolean {
		return other.kind === 'dshNode'
			&& other.id === this.part.id
			&& other.encoded === this.part.encoded
			&& other.projectionEncoded === this.part.projectionEncoded
			&& other.hint === this.part.hint;
	}
}

/** 供无障碍视图/纯文本导出使用：把 encoded 还原为可读文本，不引入新语义。 */
export function dshNodePartPlaintext(part: IChatDshNodePart): string {
	try {
		return renderAsPlaintext(new MarkdownString(JSON.stringify(JSON.parse(part.encoded), null, 2)));
	} catch {
		return part.encoded;
	}
}

// ---- 本地安全读取（不依赖 dsh contrib 类型） ----

const KNOWN_KINDS: readonly DshViewKind[] = [
	'user', 'steering', 'context', 'assistant', 'tool-call', 'tool-result',
	'command', 'compaction', 'model-retry', 'turn-error', 'turn-max-tokens',
	'inherited-history', 'unknown',
];

function asKind(value: unknown): DshViewKind | undefined {
	return typeof value === 'string' && (KNOWN_KINDS as readonly string[]).includes(value)
		? value as DshViewKind
		: undefined;
}

function readString(value: unknown, key: string): string | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return undefined;
	}
	const raw = (value as Record<string, unknown>)[key];
	return typeof raw === 'string' ? raw : undefined;
}

void Codicon;
void ThemeIcon;
