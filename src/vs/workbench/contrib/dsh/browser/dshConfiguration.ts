/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH-IDE 的设置项。
//
// 只在确有「默认值会持续消耗资源」的开关时才加设置项：行内补全每次光标停顿都要
// 一次跨进程调用加一次 LLM 生成，装插件即开启等于让用户在不知情的情况下持续付费，
// 因此默认关闭，由用户显式打开。

import { localize } from '../../../../nls.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { DSH_INLINE_COMPLETION_SETTING } from './inlineCompletion.js';

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

configurationRegistry.registerConfiguration({
	id: 'dshIde',
	title: localize('dsh.configuration.title', "DSH-IDE 插件设置"),
	type: 'object',
	properties: {
		[DSH_INLINE_COMPLETION_SETTING]: {
			type: 'boolean',
			default: false,
			description: localize(
				'dsh.configuration.inlineCompletion',
				"启用 DSH 行内补全。开启后每次光标停顿都会向 DeepSeek Harness 请求一次补全，会持续占用 CPU 与模型额度。",
			),
		},
	},
});
