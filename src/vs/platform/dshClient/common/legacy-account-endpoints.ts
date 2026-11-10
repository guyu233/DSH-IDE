/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 账号调用的「调用方身份」元数据（官方 `AccountClientMetadata`）。
//
// 账号能力的**端点**已是 `dshIdeProtocol.ts` 的正式 method（`accountGetState` / `accountGetProfile`），
// Host 桥接转发到官方 `deepseekAccount` 服务。本文件只负责构造官方要求的调用方身份：
// `{ version, locale, timezoneOffsetSeconds }`——由 Host 转成 Platform 请求头
// （`x-client-version` / `x-client-locale` / `x-client-timezone-offset`），**不含任何凭据**。
//
// 依据（只读核对）：`packages/client/ui-settings-account/src/client/client-metadata.ts` 的
// `accountClientMetadata(locale, version)`——注意时区符号：`Date.getTimezoneOffset()`
// 返回「UTC 以西的分钟数」，Platform 要的是「UTC 以东的秒数」，故取负再乘 60。

import type { IDshAccountClientMetadataArgs } from './dshIdeProtocol.js';

/** 客户端版本号的兜底值：无构建注入时也要给出非空串，否则 Host 会拒绝该身份。 */
const FALLBACK_CLIENT_VERSION = 'dsh-ide';

/**
 * 构造官方 `AccountClientMetadata`。
 *
 * @param locale 当前界面语言（如 `zh-CN`）；Host 会再收敛成 Platform 的线上 locale。
 * @param version 客户端构建版本；缺省时用本插件标识兜底。
 */
export function dshAccountClientMetadata(locale?: string, version?: string): IDshAccountClientMetadataArgs {
	const resolvedVersion = typeof version === 'string' && version !== '' ? version : FALLBACK_CLIENT_VERSION;
	return {
		version: resolvedVersion,
		locale: typeof locale === 'string' && locale !== '' ? locale : 'zh-CN',
		// 与官方实现同一口径：偏移取反、分钟转秒。
		timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
	};
}
