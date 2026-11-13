/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 把 DSH 的目录投影成 Chat 输入框三个选择器认的形状。
//
// 三个选择器各有自己的接口：模型要 `ILanguageModelChatMetadataAndIdentifier`、模式要
// `IChatMode`、权限要 `IChatSessionProviderOptionItem`。本文件只做「同一份 DSH 数据 →
// 三种形状」的转换，不含请求逻辑；请求在 `dshComposerSource.ts`。

import { constObservable, observableValue, IObservable } from '../../../../base/common/observable.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { URI } from '../../../../base/common/uri.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { IChatMode, IChatModeInstructions } from '../../chat/common/chatModes.js';
import { ChatModeKind } from '../../chat/common/constants.js';
import { Target } from '../../chat/common/promptSyntax/promptTypes.js';
import type { IChatSessionProviderOptionItem } from '../../chat/common/chatSessionsService.js';
import type { ILanguageModelChatMetadata, ILanguageModelChatMetadataAndIdentifier, ILanguageModelConfigurationSchema } from '../../chat/common/languageModels.js';
import type { DshComposerModel, DshComposerState } from './dshComposerSource.js';

/** 语言模型 vendor：与 DSH 会话自报的 provider 分开，避免和 Copilot 撞名。 */
export const DSH_MODEL_VENDOR = 'dsh';
/** 推理档在配置 schema 里的属性名。 */
export const DSH_EFFORT_PROPERTY = 'reasoningEffort';

/** DSH 模型 → Chat 模型表项。推理档写成枚举，选择器据此画档位。 */
export function toLanguageModel(model: DshComposerModel): ILanguageModelChatMetadataAndIdentifier {
	const identifier = `${model.provider}/${model.id}`;
	const efforts = [...model.efforts];
	const configurationSchema: ILanguageModelConfigurationSchema | undefined = efforts.length === 0 ? undefined : {
		type: 'object',
		properties: {
			[DSH_EFFORT_PROPERTY]: {
				type: 'string',
				title: '推理等级',
				enum: efforts.map(effort => effort.id),
				enumItemLabels: efforts.map(effort => effort.name),
				default: model.defaultEffort ?? efforts[0].id,
			},
		},
	};
	const metadata: ILanguageModelChatMetadata = {
		extension: new ExtensionIdentifier('dsh-ide.builtin'),
		name: model.name || model.id,
		id: identifier,
		vendor: DSH_MODEL_VENDOR,
		version: '1',
		family: model.provider,
		maxInputTokens: 0,
		maxOutputTokens: 0,
		isDefaultForLocation: {},
		isUserSelectable: true,
		// DSH 的供应商（DeepSeek / vanyo / vanyo-gift / cli2api …）做成分组，
		// 选择器据此分段，而不是把所有模型平铺在同一家下面。
		modelGroup: { id: model.provider },
		configurationSchema,
	};
	return { identifier, metadata };
}

/** DSH 预设 → 模式选择器的一项。预设 id 不是命令 token，因此只作选择键。 */
export function toChatMode(id: string, name: string): IChatMode {
	const instructions: IChatModeInstructions = { content: '', toolReferences: [] };
	return {
		id,
		name: constObservable(name),
		label: constObservable(name),
		icon: constObservable<ThemeIcon | undefined>(Codicon.cloud),
		description: constObservable<string | undefined>(undefined),
		isBuiltin: false,
		kind: ChatModeKind.Agent,
		target: constObservable(Target.Undefined),
		uri: constObservable(URI.parse(`dsh-preset:/${encodeURIComponent(id)}`)),
		modeInstructions: constObservable(instructions),
	};
}

/** DSH 权限预设 → 权限选择器认的选项项。`custom` 只展示，不作可选项。 */
export function toPermissionItems(state: DshComposerState): readonly IChatSessionProviderOptionItem[] {
	const permission = state.permission;
	if (permission === null) {
		return [];
	}
	return permission.options
		.filter(option => option.value !== 'custom')
		.map(option => ({ id: option.value, name: option.name }));
}

/** 观测包装：DSH 目录变了就让选择器重画。 */
export function observeModes(source: { readonly state: DshComposerState; readonly onDidChange: (listener: () => void) => { dispose(): void } }): IObservable<IChatMode[]> {
	const observable = observableValue<IChatMode[]>('dshModes', modesOf(source.state));
	source.onDidChange(() => observable.set(modesOf(source.state), undefined));
	return observable;
}

function modesOf(state: DshComposerState): IChatMode[] {
	const presets = state.presets;
	if (presets === null) {
		return [];
	}
	return presets.options.map(option => toChatMode(option.id, option.name));
}
