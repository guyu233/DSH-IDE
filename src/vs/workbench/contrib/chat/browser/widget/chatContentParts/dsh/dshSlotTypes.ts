/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH conversation.chat.* 槽位的本地类型。
//
// 这是 VS Code 原生轻量登记用的形状，不是 Cordis、React 或 webview。
// 调用方上下文只保留真正会传来的字段；注册表泛型默认用更窄的 DshSlotContextBase，
// 因此这里不引用 DOM，也不引用 IInstantiationService。实际迁移时上下文会更宽。

/** 与 DSH 聊天节点渲染对应的槽位名。 */
export type DshSlotId =
	| 'conversation.chat.node'
	| 'conversation.chat.user.content'
	| 'conversation.chat.user.images'
	| 'conversation.chat.reasoning.body'
	| 'conversation.chat.reasoning.content'
	| 'conversation.chat.message.images'
	| 'conversation.chat.commandview'
	| 'conversation.chat.markdown.fence';

/**
 * 注册表泛型的最小上下文。
 * 默认用它，而不是 unknown，这样登记逻辑不必依赖浏览器。
 */
export interface DshSlotContextBase {
	readonly input: {
		readonly id: string;
		readonly kind: string;
		readonly encoded: string;
	};
}

/** 调用方传来的槽位上下文。只放会传入的字段。 */
export type DshSlotContext = {
	readonly input: {
		readonly id: string;
		readonly kind: string;
		readonly encoded: string;
		readonly projectionEncoded?: string;
	};
	readonly stores: {
		add(disposable: { dispose(): void }): void;
	};
	readonly extras?: Record<string, unknown>;
};

/** 一条槽位贡献。create 只交出 domNode，不执行动态代码。 */
export interface DshSlotContribution<TContext> {
	readonly slot: DshSlotId;
	readonly key?: string;
	readonly priority?: number;
	create(context: TContext): { readonly domNode: unknown };
}
