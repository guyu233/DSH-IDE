/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// D55：认证材料脱敏的唯一实现（第 8 章 §8.8.7）。
//
// `launchUrl` 形如 `<origin>/?token=<launchToken>`，携带一次性凭据；换取 cookie 后
// 仍是认证材料，不能出现在日志、遥测、错误消息或异常堆栈里（§8.8.3 第 5 条）。
// 两套 backend（Host 半身 .js / IDE 传输 .ts）共用本文件的纯函数，不各写一份正则。
//
// 只做「显示脱敏」，不改官方 token 交换流程、不新增第二条认证通道。

/** 从任意文本中抹去 URL 里的 query / fragment 与 cookie 值，供日志与错误文案使用。 */
export function redactAuthMaterial(text) {
	const asString = typeof text === 'string' ? text : String(text);
	let out = asString;
	// 整段 URL：只保留 scheme://authority/path，丢弃 ?query 与 #fragment（token 在 query）。
	out = out.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()]+/gi, url => {
		const end = url.search(/[?#]/);
		return end < 0 ? url : url.slice(0, end);
	});
	// 裸 token / cookie 形态：key=value 中把 value 换成占位符，避免堆栈里出现明文。
	out = out.replace(/\b(token|cookie|set-cookie|authorization|launchUrl)\b\s*[:=]\s*["']?[^\s"';,}&]+["']?/gi, (match, key) => `${key}=[redacted]`);
	return out;
}

/** 把未知异常收敛成脱敏后的可读文案；绝不把 error 对象或其堆栈原样投影出去。 */
export function safeErrorText(error) {
	if (error === undefined || error === null) {
		return 'unknown error';
	}
	const raw = typeof error === 'object' && error !== null && 'message' in error
		? String(error.message)
		: String(error);
	return redactAuthMaterial(raw);
}
