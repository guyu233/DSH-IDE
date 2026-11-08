/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { AgentHostAutoArchiveMergedSessionsAfterDaysConfigKey, AgentHostAutoDeleteArchivedMergedSessionsAfterDaysConfigKey } from '../../../../platform/chatContracts/common/agentHostSchema.js';
import { AgentHostActiveAgentTitleGenerationSettingId, AgentHostDeferredTitleGenerationSettingId, AgentHostTitleGenerationSettingId } from '../../../../platform/chatContracts/common/agentService.js';
import { migrateLegacyTitleGenerationSettings } from '../../../../platform/chatContracts/common/titleGenerationConfiguration.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationPropertySchema, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import product from '../../../../platform/product/common/product.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ConfigurationKeyValuePairs, Extensions as WorkbenchConfigurationExtensions, IConfigurationMigrationRegistry } from '../../../common/configuration.js';
import { AGENT_SESSION_CLEANUP_SETTINGS_TAG, ChatConfiguration, CopilotHarnessIntroductionMode } from '../common/constants.js';

const legacyAutoArchiveMergedSessionsAfterDaysSetting = 'chat.agentSessions.autoArchiveMergedSessionsAfterDays';
const legacyAutoDeleteArchivedMergedSessionsAfterDaysSetting = 'chat.agentSessions.autoDeleteArchivedMergedSessionsAfterDays';

export const agentsWindowHandoffConfigurationProperties = {
	[ChatConfiguration.CopilotHarnessIntroductionMode]: {
		type: 'string',
		enum: [CopilotHarnessIntroductionMode.Off, CopilotHarnessIntroductionMode.NewSession, CopilotHarnessIntroductionMode.AfterRequest],
		enumDescriptions: [
			nls.localize('chat.copilotHarnessIntroduction.off', "Do not show the Copilot harness introduction."),
			nls.localize('chat.copilotHarnessIntroduction.newSession', "Show the introduction when a new Copilot harness session starts."),
			nls.localize('chat.copilotHarnessIntroduction.afterRequest', "Show the introduction after the first request is submitted in a new Copilot harness session."),
		],
		description: nls.localize('chat.copilotHarnessIntroduction.mode', "Controls when the introduction to the new Copilot experience is shown."),
		default: product.quality === 'insider' ? CopilotHarnessIntroductionMode.NewSession : CopilotHarnessIntroductionMode.Off,
		tags: ['experimental'],
		experiment: { mode: 'auto' },
	},
	[ChatConfiguration.HarnessSwitchFeedbackSurveyEnabled]: {
		type: 'boolean',
		description: nls.localize('chat.harnessSwitchFeedbackSurvey.enabled', "Show a one-time feedback survey after switching from Copilot to Local."),
		default: false,
		tags: ['experimental'],
		experiment: { mode: 'auto' },
	},
} satisfies Record<string, IConfigurationPropertySchema>;

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'chat',
	properties: {
		[ChatConfiguration.UnifiedWorkspacePicker]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: nls.localize('sessions.chat.unifiedWorkspacePicker.enabled', "Controls whether the Agents Window uses the unified workspace picker, which combines GitHub and remote workspaces, provides search, and, when supported, allows creating sessions with no workspace."),
			tags: ['experimental'],
			experiment: { mode: 'auto' },
		},
		[ChatConfiguration.AutoMarkAsDoneMergedSessionsAfterDays]: {
			type: 'integer',
			minimum: 0,
			default: 0,
			scope: ConfigurationScope.APPLICATION,
			tags: ['preview', AGENT_SESSION_CLEANUP_SETTINGS_TAG],
			markdownDescription: nls.localize('autoMarkAsDoneMergedSessions.description', "After a session with a merged pull request has been inactive for this many days, mark it as Done. Eligible worktrees are safely removed. Set to 0 to disable automatic marking."),
			agentHost: { key: AgentHostAutoArchiveMergedSessionsAfterDaysConfigKey },
		},
		[ChatConfiguration.AutoDeleteMarkedAsDoneMergedSessionsAfterDays]: {
			type: 'integer',
			minimum: 0,
			default: 0,
			scope: ConfigurationScope.APPLICATION,
			tags: ['preview', AGENT_SESSION_CLEANUP_SETTINGS_TAG],
			markdownDescription: nls.localize('autoDeleteMarkedAsDoneMergedSessions.description', "After a session with a merged pull request is automatically marked Done, wait this many additional days, then permanently delete the session. Eligible retained worktrees are safely removed first. Set to 0 to disable permanent deletion."),
			agentHost: { key: AgentHostAutoDeleteArchivedMergedSessionsAfterDaysConfigKey },
		},
		// DSH 集成：当前 DeepSeek Harness Host 的地址（插件在拉起 IDE 前写入 User settings）。
		// 供内建聊天桥与账号按钮连接 DSH 使用，避免硬编码端口。
		'dsh.hostBaseUrl': {
			type: 'string',
			default: '',
			scope: ConfigurationScope.APPLICATION,
			markdownDescription: nls.localize('dsh.hostBaseUrl', "DeepSeek Harness Host 的地址（由 DSH-IDE 插件自动写入）。"),
		},
	},
});

Registry.as<IConfigurationMigrationRegistry>(WorkbenchConfigurationExtensions.ConfigurationMigration).registerConfigurationMigrations([{
	key: legacyAutoArchiveMergedSessionsAfterDaysSetting,
	includeApplication: true,
	migrateFn: (value, accessor) => {
		const pairs: ConfigurationKeyValuePairs = [[legacyAutoArchiveMergedSessionsAfterDaysSetting, { value: undefined }]];
		if (accessor(ChatConfiguration.AutoMarkAsDoneMergedSessionsAfterDays) === undefined) {
			pairs.push([ChatConfiguration.AutoMarkAsDoneMergedSessionsAfterDays, { value }]);
		}
		return pairs;
	},
}, {
	key: legacyAutoDeleteArchivedMergedSessionsAfterDaysSetting,
	includeApplication: true,
	migrateFn: (value, accessor) => {
		const pairs: ConfigurationKeyValuePairs = [[legacyAutoDeleteArchivedMergedSessionsAfterDaysSetting, { value: undefined }]];
		if (accessor(ChatConfiguration.AutoDeleteMarkedAsDoneMergedSessionsAfterDays) === undefined) {
			pairs.push([ChatConfiguration.AutoDeleteMarkedAsDoneMergedSessionsAfterDays, { value }]);
		}
		return pairs;
	},
}]);

for (const key of [AgentHostDeferredTitleGenerationSettingId, AgentHostActiveAgentTitleGenerationSettingId]) {
	Registry.as<IConfigurationMigrationRegistry>(WorkbenchConfigurationExtensions.ConfigurationMigration).registerConfigurationMigrations([{
		key,
		includeApplication: true,
		migrateFn: (value, accessor) => {
			const pairs: ConfigurationKeyValuePairs = [[key, { value: undefined }]];
			if (accessor(AgentHostTitleGenerationSettingId) === undefined) {
				const strategy = migrateLegacyTitleGenerationSettings(
					key === AgentHostDeferredTitleGenerationSettingId ? value : accessor(AgentHostDeferredTitleGenerationSettingId),
					key === AgentHostActiveAgentTitleGenerationSettingId ? value : accessor(AgentHostActiveAgentTitleGenerationSettingId),
				);
				if (strategy !== undefined) {
					pairs.push([AgentHostTitleGenerationSettingId, { value: strategy }]);
				}
			}
			return pairs;
		},
	}]);
}
