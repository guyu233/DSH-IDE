/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 把 DSH 产品图标接到产品图标样式表（2-D 图标工作流）。
//
// 挂载点：`platform/theme` 的 `registerIconReplacement`（由 `iconsStyleSheet.getCSS()`
// 在生成每个 `.codicon-*:before` 规则时查询）。这里是唯一知道「哪些 codicon 换成
// DSH glyph」的地方，platform 层不反向依赖 workbench。
//
// 混合状态是预期行为：DSH 没有对应 glyph 的 codicon 保持原样（手册 §9.5 的 2-D）。

import { registerIconReplacement } from '../../../../../platform/theme/common/iconReplacement.js';
import { dshIconDataUri } from './dshCodiconMap.js';

/** 注册 DSH 图标替换；返回注销句柄。 */
export function registerDshIconReplacement(): { dispose(): void } {
	return registerIconReplacement(dshIconDataUri);
}
