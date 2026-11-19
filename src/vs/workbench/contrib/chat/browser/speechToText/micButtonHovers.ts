/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IManagedHoverContent } from '../../../../../base/browser/ui/hover/hover.js';
import { escapeMarkdownSyntaxTokens, MarkdownString } from '../../../../../base/common/htmlContent.js';
import { isWeb } from '../../../../../base/common/platform.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';

/**
 * Build a hover with a bold title line and a one-sentence description below it.
 * `title` is the button's label plus keybinding, so it is escaped before being
 * emphasized.
 */
function createMicButtonHover(title: string, description: string): MarkdownString {
	const markdown = new MarkdownString('', { supportThemeIcons: true });
	markdown.appendMarkdown(`**${escapeMarkdownSyntaxTokens(title)}**`);
	markdown.appendMarkdown('\n\n');
	markdown.appendMarkdown(escapeMarkdownSyntaxTokens(description));
	return markdown;
}

/** Wrap a mic-button hover for APIs that take managed hover content. */
function asHoverContent(title: string, description: string): IManagedHoverContent {
	return { markdown: createMicButtonHover(title, description), markdownNotSupportedFallback: `${title}\n${description}` };
}

/**
 * 听写的识别后端由 DSH Host 决定，前端只说明这一点；不再读取 `dictation.model`，
 * 那个设置在本集成下只有「DSH Host」一个取值。
 */
function getDictationDescription(): string {
	return localize('dictation.hover.dsh', "Types what you say into the input. Transcription is performed by the speech provider selected in DeepSeek Harness.");
}

/**
 * Spells out that Voice Mode is a spoken conversation driven by a separate online
 * model, so it doesn't read as another dictation entry point.
 */
function getVoiceModeDescription(): string {
	return localize('voiceMode.hover', "Talk with the agent and hear it reply. Uses the online real-time voice model.");
}

/** Hover markdown for the dictation mic button. */
export function getDictationHoverMarkdown(title: string, configurationService: IConfigurationService, web = isWeb): MarkdownString {
	return createMicButtonHover(title, getDictationDescription());
}

/** Hover for the dictation mic button, for APIs that take managed hover content. */
export function getDictationHoverContent(title: string, configurationService: IConfigurationService): IManagedHoverContent {
	return asHoverContent(title, getDictationDescription());
}

/** Hover for the Voice Mode button, for APIs that take managed hover content. */
export function getVoiceModeHoverContent(title: string): IManagedHoverContent {
	return asHoverContent(title, getVoiceModeDescription());
}
