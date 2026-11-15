/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH 帧 → VS Code 原生 ChatModel 的唯一驱动器。
//
// 身份前提（AGENTS.md §1）：会话真源在 DSH Host，DSH-IDE 是插件，只把 Host 帧
// **直接**写进 VS Code 的 ChatModel，不投影、不翻译、不建第二套会话。
// 原生 ChatWidget / composer / 统计条 / Sessions 面板从此共用同一个 model，
// 不再有 sidecar 自绘的第二套 DOM。
//
// 写入路径：`chatService.startSessionForResource(dsh://...)` 拿具体 ChatModel →
// `addRequest` 建请求 → `acceptResponseProgress` 追加 progress。全程不经过
// `_sendRequestAsync`，因此不会再向 agent 发起一次真实请求。
//
// 「不增不减」约束（本文件的核心纪律）：
// - 每个 DSH 会话节点都写成一个 `dshNode` part，payload 是该节点 `raw` 的 canonical JSON；
// - 绝不把结构化节点压成自造文案，也不添加源载荷里不存在的装饰性前缀；
// - 绝不为"给节点找归属"新建只为承载节点的空请求；
// - 同一 (seq, blockIndex) 恒得同一 id，ChatModel 侧按 id 覆盖而非追加。

import { Disposable, IReference } from '../../../../base/common/lifecycle.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { stableStringify } from '../../../../base/common/objects.js';
import { URI } from '../../../../base/common/uri.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IChatService, IChatProgress, IChatDshNodePart } from '../../chat/common/chatService/chatService.js';
import { ChatAgentLocation } from '../../chat/common/constants.js';
import { IChatWidgetService, IChatWidget } from '../../chat/browser/chat.js';
import { IParsedChatRequest } from '../../chat/common/requestParser/chatParserTypes.js';
import type { ChatRequestModel, ChatModel } from '../../chat/common/model/chatModel.js';
import { IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import { dshChatSessionFor } from './dshChatSession.js';
import { dshSessionResource } from './dshAgentSessionsController.js';
import type { DshChatNode } from './dshChatModel.js';

/** 把一段纯文本包成最简 IParsedChatRequest（无变量段）。 */
function parsed(text: string): IParsedChatRequest {
	return { text, parts: [] };
}

/**
 * 取节点文本用于 request 的 `text` 字段。
 *
 * **仅**用于 `ChatRequestModel` 必需的人写消息文本；这不是节点内容通路，
 * 节点内容一律走 `dshNode` part。取不到就返回空串，绝不编造。
 */
function requestText(node: DshChatNode): string {
	if (node.kind === 'user' || node.kind === 'steering' || node.kind === 'context') {
		return node.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n');
	}
	return '';
}

/** 节点 → 稳定 part id。无块节点用 `:node`，保证单射。 */
function partIdOf(node: DshChatNode): string {
	return `dsh:${node.seq}:node`;
}

/** 节点 → `dshNode` part；payload 严格是节点 `raw` 的 canonical JSON。 */
function nodePart(node: DshChatNode): IChatDshNodePart {
	const source = node.raw === undefined ? node : node.raw;
	return { kind: 'dshNode', id: partIdOf(node), encoded: stableStringify(source) };
}

export class DshChatModelDriver extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.dshChatModelDriver';

	/** 已写入的 request id（用 DSH seq 作稳定身份），避免重复 addRequest。 */
	private readonly requestIds = new Set<string>();
	/** part id → 已写入的 canonical JSON；内容没变就整段跳过，重放不重复。 */
	private readonly writtenParts = new Map<string, string>();
	private modelResource: URI | undefined;
	/** 持有 model 引用，避免 ChatModelStore 因引用计数归零回收掉正在写的会话。 */
	private modelRef: IReference<ChatModel> | undefined;
	/** 已订阅过 onDidChangeViewModel 的 widget，避免重复订阅。 */
	private boundWidget: IChatWidget | undefined;
	/** 首次绘制补偿：贡献点构造早于 widget / 快照，需补跑几次。 */
	private readonly syncSoon = this._register(new RunOnceScheduler(() => this.sync(), 16));

	constructor(
		@IDshClientService private readonly client: IDshClientService,
		@IChatService private readonly chatService: IChatService,
		@IChatWidgetService private readonly widgets: IChatWidgetService,
	) {
		super();
		const session = dshChatSessionFor(client);
		this._register(session.onDidChangeNodes(() => this.syncSoon.schedule()));
		this._register(session.onDidChangeRunning(() => this.syncSoon.schedule()));
		this._register(this.widgets.onDidAddWidget(() => this.syncSoon.schedule()));
		for (const delay of [0, 100, 400, 1200, 3000]) {
			const timer = setTimeout(() => this.sync(), delay);
			this._register({ dispose: () => clearTimeout(timer) });
		}
	}

	private sync(): void {
		const session = dshChatSessionFor(this.client);
		const sessionId = session.boundId() ?? 'dsh-current';
		const resource = dshSessionResource(sessionId);
		if (this.modelResource === undefined || this.modelResource.toString() !== resource.toString()) {
			this.requestIds.clear();
			this.writtenParts.clear();
			this.modelRef?.dispose();
			this.modelRef = undefined;
			this.boundWidget = undefined;
			this.modelResource = resource;
		}

		// 复用指定 dsh:// resource 上的本地 model；不查外部 provider、不重建。
		// 引用由驱动器持有到会话切换/销毁，不能每次 sync 后 dispose（引用计数归零会回收 model）。
		if (this.modelRef === undefined) {
			const create = this.chatService.startSessionForResource;
			if (create === undefined) {
				return; // 未装载该扩展入口时保持界面现状，不伪造内容。
			}
			this.modelRef = create.call(this.chatService, resource, ChatAgentLocation.Chat, {
				canUseTools: false,
				debugOwner: 'DshChatModelDriver',
			});
		}
		const model = this.modelRef.object;

		const nodes = session.nodes();

		// 请求边界：每个 user/steering 节点建一个 request，其 text 严格等于该节点
		// 自身的文本拼接（不 trim、不加前缀）。其余节点挂到**其后最近的前驱** request；
		// 若第一条输入之前还有节点，则挂到第一个真实 request 上（回溯归属），
		// 不再新建只为承载节点的空请求。
		const firstRequestIndex = nodes.findIndex(node => node.kind === 'user' || node.kind === 'steering');
		let current: ChatRequestModel | undefined;
		let pendingBeforeFirst: DshChatNode[] = [];

		for (const [index, node] of nodes.entries()) {
			const isRequest = node.kind === 'user' || node.kind === 'steering';
			if (isRequest) {
				const id = `dsh:${node.seq}`;
				const existing = model.getRequests().find(request => request.id === id);
				if (existing !== undefined) {
					current = existing;
				} else {
					current = model.addRequest(parsed(requestText(node)), { variables: [] }, 0, undefined, undefined, undefined,
						undefined, undefined, undefined, undefined, undefined, undefined, id, node.kind === 'steering', undefined,
						undefined, false, node.time ?? undefined);
					this.requestIds.add(id);
				}
				// 先把第一个请求之前积累的节点按源序写进这个真实请求。
				if (pendingBeforeFirst.length > 0) {
					for (const pending of pendingBeforeFirst) {
						this.writeNode(model, current, pending);
					}
					pendingBeforeFirst = [];
				}
				continue;
			}

			if (current === undefined) {
				if (index < firstRequestIndex || firstRequestIndex === -1) {
					// 还没有任何真实请求：先缓存，等第一个真实 request 出现后按源序写入。
					pendingBeforeFirst.push(node);
					continue;
				}
				continue;
			}
			this.writeNode(model, current, node);
		}

		// 会话全是非输入节点（没有任何 user/steering）：为它们建一个承载请求，
		// 但**只有**在确实存在节点时才建，且不写任何自造文案（text 为空是宿主容器所需）。
		if (pendingBeforeFirst.length > 0) {
			const anchorId = `dsh:head`;
			let anchor = model.getRequests().find(request => request.id === anchorId);
			if (anchor === undefined) {
				anchor = model.addRequest(parsed(''), { variables: [] }, 0, undefined, undefined, undefined,
					undefined, undefined, undefined, undefined, undefined, undefined, anchorId, true, undefined,
					undefined, false, pendingBeforeFirst[0]?.time ?? undefined, true);
				this.requestIds.add(anchorId);
			}
			for (const pending of pendingBeforeFirst) {
				this.writeNode(model, anchor, pending);
			}
		}

		// 把当前 Chat widget 绑到这个 model（composer/统计条/滚动/Sessions 同源）。
		const widget = this.widgets.getWidgetsByLocations(ChatAgentLocation.Chat)[0];
		if (widget !== undefined) {
			// DSH 皮肤作用域：只改 DSH 驱动的这个 widget，不污染 VS Code 其它 chat（§4 保留扩展生态）。
			widget.domNode.classList.add('dsh-session');
			if (this.boundWidget !== widget) {
				this.boundWidget = widget;
				// ChatViewPane 可能在之后把 widget 切到自己的 local session；被换走时重新绑回 DSH model。
				this._register(widget.onDidChangeViewModel(() => {
					const current = this.widgets.getWidgetsByLocations(ChatAgentLocation.Chat)[0];
					if (current !== undefined && this.modelRef !== undefined && current.viewModel?.model !== this.modelRef.object) {
						current.setModel(this.modelRef.object);
					}
				}));
			}
			if (widget.viewModel?.model !== model) {
				widget.setModel(model);
			}
		}
	}

	/** 把一个节点写成 `dshNode` part；同 id 且 canonical 未变则跳过（避免重放堆叠）。 */
	private writeNode(model: ChatModel, request: ChatRequestModel, node: DshChatNode): void {
		const part = nodePart(node);
		if (this.writtenParts.get(part.id) === part.encoded) {
			return;
		}
		model.acceptResponseProgress(request, part as IChatProgress);
		this.writtenParts.set(part.id, part.encoded);
	}

	override dispose(): void {
		this.modelRef?.dispose();
		this.modelRef = undefined;
		super.dispose();
	}
}

registerWorkbenchContribution2(DshChatModelDriver.ID, DshChatModelDriver, WorkbenchPhase.AfterRestored);
