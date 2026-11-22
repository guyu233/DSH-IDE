/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 把原生聊天条目里的图片字节收成 Host `saveImages` 能接受的载荷。
//
// 粘贴路径会带 `mimeType`。从磁盘选文件、以及把图片拖进输入框，条目经常只有字节：
// 文件名是「Image from URL」或没有扩展名，`mimeType` 也是空的。只看 `mimeType`
// 会把这些图全部判成无法入库，发送被取消，草稿还在。这里按字节头识别四种 Host
// 支持的格式，识别不到再看声明和文件名。

const SUPPORTED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * 这些是用户放进输入框、但 Host `submit` 带不走的附件。
 * 工具、隐式上下文和会话引用不在此列，否则普通文本也会被拦住。
 */
const UNSENT_ATTACHMENT_KINDS = new Set([
	'file',
	'directory',
	'paste',
	'string',
	'notebookOutput',
	'symbol',
	'diagnostic',
	'element',
	'promptFile',
	'promptText',
	'scmHistoryItem',
	'scmHistoryItemChange',
	'scmHistoryItemChangeRange',
	'terminalCommand',
	'debugVariable',
	'debugEvents',
	'browserView',
	'command',
]);

/** 返回这条消息里无法交给 DSH 的附件名称；没有时为空数组。 */
export function dshUnsentAttachmentNames(entries: readonly { readonly kind: string; readonly name?: string; readonly enabled?: boolean }[]): readonly string[] {
	const names: string[] = [];
	for (const entry of entries) {
		// 关掉的隐式上下文是建议，不是用户要发送的内容。打开的当前文件芯片必须拦住。
		if (entry.kind === 'implicit') {
			if (entry.enabled !== true) {
				continue;
			}
		} else if (!UNSENT_ATTACHMENT_KINDS.has(entry.kind)) {
			continue;
		}
		names.push(typeof entry.name === 'string' && entry.name !== '' ? entry.name : entry.kind);
	}
	return names;
}

/** 从条目取出可入库的字节和媒体类型；不是这四种图片时返回 undefined。 */
export function dshImagePayload(entry: { readonly value?: unknown; readonly mimeType?: string; readonly name?: string }): { readonly data: Uint8Array; readonly mediaType: string } | undefined {
	const data = bytesOf(entry.value);
	if (data === undefined) {
		return undefined;
	}
	// 字节头优先：声明写成 image/png、实际是 jpeg 时，Host 按字节复核会拒绝声明。
	const mediaType = sniff(data) ?? declared(entry.mimeType) ?? declared(mimeFromName(entry.name));
	if (mediaType === undefined) {
		return undefined;
	}
	return { data, mediaType };
}

function bytesOf(value: unknown): Uint8Array | undefined {
	if (value instanceof Uint8Array) {
		return value.byteLength === 0 ? undefined : value;
	}
	if (value instanceof ArrayBuffer) {
		return value.byteLength === 0 ? undefined : new Uint8Array(value);
	}
	// VSBuffer 不是 Uint8Array，字节在 `.buffer` 上。
	if (value !== null && typeof value === 'object' && 'buffer' in value) {
		const buffer = (value as { readonly buffer?: unknown }).buffer;
		if (buffer instanceof Uint8Array && buffer.byteLength > 0) {
			return buffer;
		}
	}
	return undefined;
}

function declared(value: string | undefined): string | undefined {
	if (value === undefined || value === '') {
		return undefined;
	}
	const mediaType = value === 'image/jpg' ? 'image/jpeg' : value;
	return SUPPORTED.has(mediaType) ? mediaType : undefined;
}

function mimeFromName(name: string | undefined): string | undefined {
	if (name === undefined || name === '') {
		return undefined;
	}
	const dot = name.lastIndexOf('.');
	if (dot < 0) {
		return undefined;
	}
	switch (name.slice(dot).toLowerCase()) {
		case '.png': return 'image/png';
		case '.jpg':
		case '.jpeg': return 'image/jpeg';
		case '.webp': return 'image/webp';
		case '.gif': return 'image/gif';
		default: return undefined;
	}
}

function sniff(data: Uint8Array): string | undefined {
	if (data.length >= 8
		&& data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) {
		return 'image/png';
	}
	if (data.length >= 3 && data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) {
		return 'image/jpeg';
	}
	if (data.length >= 6
		&& data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) {
		return 'image/gif';
	}
	if (data.length >= 12
		&& data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46
		&& data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) {
		return 'image/webp';
	}
	return undefined;
}
