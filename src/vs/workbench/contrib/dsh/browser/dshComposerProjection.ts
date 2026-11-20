/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 把 DSH 的目录投影成 Chat 输入框三个选择器认的形状。
//
// 三个选择器各有自己的接口：模型要 `ILanguageModelChatMetadataAndIdentifier`、模式要
// `IChatSessionProviderOptionGroup`、权限要 `IChatSessionProviderOptionItem`。本文件只做
// 「同一份 DSH 数据 → 三种形状」的转换，不含请求逻辑；请求在 `dshComposerSource.ts`。

import { localize } from '../../../../nls.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import type { IChatSessionProviderOptionItem } from '../../chat/common/chatSessionsService.js';
import type { ILanguageModelChatMetadata, ILanguageModelChatMetadataAndIdentifier, ILanguageModelConfigurationSchema } from '../../chat/common/languageModels.js';
import { DSH_CHAT_SESSION_TYPE } from './dshSessionType.js';
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
				title: localize('dsh.composer.effortTitle', "推理等级"),
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
		// 这些模型只属于 `dsh:` 会话：`requiresCustomModels` 的会话类型只有在存在
		// 「target 指向自己」的模型时才拿到模型池，否则选择器会判定为「无可用模型」。
		// 同时它们不会漏进 VS Code 其它会话的通用模型列表。
		targetChatSessionType: DSH_CHAT_SESSION_TYPE,
		configurationSchema,
	};
	return { identifier, metadata };
}

/** DSH 权限预设 → 权限选择器认的选项项。`custom` 只展示，不作可选项。 */
export function toPermissionItems(state: DshComposerState): readonly IChatSessionProviderOptionItem[] {
	const permission = state.permission;
	if (permission === null) {
		return [];
	}
	const custom = permission.options.find(option => option.value === 'custom');
	const items = permission.options
		.filter(option => option.value !== 'custom')
		.map(option => ({ id: option.value, name: option.name }));
	// 当前值是 custom 时必须能被选中显示，但不能把它加进「可切换过去」的列表之外。
	// 只在已经处于 custom 时插入；其它权限下仍然看不到这一项。
	if (permission.current === 'custom') {
		items.unshift({ id: 'custom', name: custom?.name && custom.name !== '' ? custom.name : localize('dsh.composer.custom', "自定义") });
	}
	return items;
}
