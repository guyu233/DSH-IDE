/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 产品图标替换缝：允许上层（workbench 的 DSH 贡献点）把某些 codicon 换成自己的矢量图形，
// 而不让 `platform/theme` 反向依赖 `workbench/contrib/dsh`。
//
// 为什么需要这条缝：`iconsStyleSheet.getCSS()` 是唯一动态生成 `::before` 规则的地方
// （`iconsStyleSheet.ts:31-74`），但它在 platform 层，不能 import workbench。这里只放
// 「一个可替换的查询函数」，图形资源与映射表仍留在 DSH 贡献点。

/** 一次替换：返回 `mask` 用的图片 URL（通常是内联 data URI），`undefined` 表示保留原 font 规则。 */
export type IconReplacement = (codiconId: string) => string | undefined;

let current: IconReplacement | undefined;

/**
 * 注册替换函数，返回注销句柄。
 *
 * 只有一个槽位：多处注册会互相覆盖并让样式结果依赖加载顺序。后注册者直接抛错，
 * 让冲突在启动时暴露，而不是变成难以复现的图标错乱。
 */
export function registerIconReplacement(replacement: IconReplacement): { dispose(): void } {
	if (current !== undefined) {
		throw new Error('an icon replacement is already registered');
	}
	current = replacement;
	return {
		dispose: () => {
			if (current === replacement) {
				current = undefined;
			}
		},
	};
}

/** 当前替换函数（未注册时为 `undefined`）。 */
export function getIconReplacement(): IconReplacement | undefined {
	return current;
}
