/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH glyph → VS Code codicon id 的映射表（2-D 图标工作流）。
//
// 只映射**语义对得上**的：名称相近但含义不同的宁可不映射（手册 §9.5 的 2-D 第 2 条）。
// DSH 没有对应 glyph 的 codicon 保持原样，形成「混合状态」——这是预期，不是缺陷。
//
// 键是 codicon id（不带 `codicon-` 前缀），值是 `DSH_ICON_DATA_URIS` 里的 glyph 名。

import { DSH_ICON_DATA_URIS } from './dshIconDataUris.js';

/** codicon id → DSH glyph id。 */
export const DSH_CODICON_GLYPH_MAP: Readonly<Record<string, string>> = {
	// 直接对应：几何与语义都一一匹配。
	'search': 'search-outline',
	'add': 'plus-outline',
	'close': 'close-outline',
	'copy': 'copy-outline',
	'check': 'check-outline',
	'chevron-down': 'chevron-down-outline',
	'chevron-left': 'chevron-left-outline',
	'chevron-right': 'chevron-right-outline',
	'chevron-up': 'chevron-up-outline',
	'ellipsis': 'ellipsis-outline',
	'trash': 'trash-outline',
	'refresh': 'refresh-outline',
	'edit': 'edit-outline',
	'save': 'save-outline',
	'eye': 'eye-outline',
	'eye-closed': 'eye-off-outline',
	'link': 'link-outline',
	'globe': 'globe-outline',
	'settings': 'settings-outline',
	'settings-gear': 'settings-outline',
	'history': 'clock-outline',
	'comment-discussion': 'new-chat-outline',
	'comment': 'new-chat-outline',
	'file': 'deliver-doc',
	'file-text': 'deliver-doc',
	'folder': 'folder-close',
	'folder-opened': 'folder-open',
	'symbol-class': 'agent-preset-outline',
	'sparkle': 'sparkle',
	'warning': 'warning-outline',
	'warning-description': 'warning-triangle-outline',
	'info': 'info-outline',
	'question': 'question-outline',
	'loading': 'loading-outline',
	'sync': 'refresh-outline',
	'branch': 'branch-outline',
	'download': 'download-outline',
	'upload': 'upload-outline',
	'play': 'play-outline',
	'debug-pause': 'pause-outline',
	'debug-stop': 'stop-fill',
	'send': 'paper-plane-outline',
	'attach': 'paperclip-outline',
	'pin': 'pin-outline',
	'pinned': 'pin-fill',
	'archive': 'archive-outline',
	'unarchive': 'unarchive-outline',
	'checklist': 'checklist-outline',
	'list-flat': 'flat-list-outline',
	'list-tree': 'workspace-tree-outline',
	'layout-sidebar-left': 'panel-left-outline',
	'lightbulb': 'light-outline',
	'lightbulb-sparkle': 'light-outline',
	'color-mode': 'followsystem-outline',
	'account': 'user-outline',
	'organization': 'users-outline',
	'plug': 'cordis-plugin-outline',
	'extensions': 'cordis-plugin-outline',
	'database': 'database-outline',
	'table': 'data-outline',
	'code': 'code-outline',
	'go-to-file': 'right-up-outline',
	'arrow-up': 'right-up-outline',
	'arrow-right': 'chevron-right-outline',
	'graph': 'branch-outline',
	'issue-reopened': 'refresh-outline',
	'microphone': 'microphone-outline',
	'credit-card': 'gauge-outline',
};

/**
 * 判断一个 glyph 名是否真的存在。
 *
 * 映射表手写难免写错名字；这里在模块加载时过滤掉不存在的条目，避免生成
 * `mask: url(undefined)` 这类静默坏样式（宁可保留 codicon 原样）。
 */
export function resolveDshGlyph(codiconId: string): string | undefined {
	const glyph = DSH_CODICON_GLYPH_MAP[codiconId];
	return glyph !== undefined && DSH_ICON_DATA_URIS[glyph] !== undefined ? glyph : undefined;
}

/** codicon id → 内联 data URI（没有对应 glyph 时返回 undefined）。 */
export function dshIconDataUri(codiconId: string): string | undefined {
	const glyph = resolveDshGlyph(codiconId);
	return glyph === undefined ? undefined : DSH_ICON_DATA_URIS[glyph];
}
