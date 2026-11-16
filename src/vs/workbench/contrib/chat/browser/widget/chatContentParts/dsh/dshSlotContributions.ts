/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// conversation.chat.node 的内置 kind 分派。
// user 与 steering 共用 DshUserView；tool-call 与 tool-result 共用 DshToolView。
// unknown 单独占精确 key。调用方的 renderSlot fallback 也必须是 DshUnknownView，禁止空节点。

import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { IMarkdownRenderer } from '../../../../../../../platform/markdown/browser/markdownRenderer.js';
import { DshNodeViewInput, DshViewKind, IDshNodeView } from './dshNodeTypes.js';
import { DshSlotRegistry } from './dshSlotRegistry.js';
import type { DshSlotContextBase } from './dshSlotTypes.js';
import { DshAssistantView } from './dshAssistantView.js';
import { DshCommandView } from './dshCommandView.js';
import { DshCompactionView } from './dshCompactionView.js';
import { DshContextView } from './dshContextView.js';
import { DshInheritedHistoryView } from './dshInheritedHistoryView.js';
import { DshModelRetryView } from './dshModelRetryView.js';
import { DshToolView } from './dshToolView.js';
import { DshTurnErrorView } from './dshTurnErrorView.js';
import { DshTurnMaxTokensView } from './dshTurnMaxTokensView.js';
import { DshUnknownView } from './dshUnknownView.js';
import { DshUserView } from './dshUserView.js';

/** 节点槽位实际传入的上下文。比注册表默认上下文宽，只放视图真正要的字段。 */
export interface IDshChatNodeSlotContext extends DshSlotContextBase {
	readonly input: DshNodeViewInput;
	readonly renderer: IMarkdownRenderer;
	readonly stores: DisposableStore;
}

export const dshChatNodeSlotRegistry = new DshSlotRegistry<IDshChatNodeSlotContext>();

function contribute(key: DshViewKind, create: (context: IDshChatNodeSlotContext) => IDshNodeView): void {
	dshChatNodeSlotRegistry.register({
		slot: 'conversation.chat.node',
		key,
		create,
	});
}

const userView = (ctx: IDshChatNodeSlotContext): IDshNodeView => new DshUserView(ctx.input, ctx.renderer, ctx.stores);
const toolView = (ctx: IDshChatNodeSlotContext): IDshNodeView => new DshToolView(ctx.input, ctx.renderer, ctx.stores);

contribute('user', userView);
contribute('steering', userView);
contribute('assistant', ctx => new DshAssistantView(ctx.input, ctx.renderer, ctx.stores));
contribute('tool-call', toolView);
contribute('tool-result', toolView);
contribute('context', ctx => new DshContextView(ctx.input, ctx.renderer, ctx.stores));
contribute('command', ctx => new DshCommandView(ctx.input, ctx.stores));
contribute('compaction', ctx => new DshCompactionView(ctx.input, ctx.renderer, ctx.stores));
contribute('model-retry', ctx => new DshModelRetryView(ctx.input, ctx.stores));
contribute('turn-error', ctx => new DshTurnErrorView(ctx.input, ctx.renderer, ctx.stores));
contribute('turn-max-tokens', ctx => new DshTurnMaxTokensView(ctx.input, ctx.stores));
contribute('inherited-history', ctx => new DshInheritedHistoryView(ctx.input, ctx.stores));
contribute('unknown', ctx => new DshUnknownView(ctx.input, ctx.stores));
