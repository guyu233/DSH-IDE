/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// `dsh-attachment:` 只读文件系统方案：把 DSH 会话附件接到原生打开器上。
//
// 为什么需要它：原生 Chat 的进度部件没有图片类型（`IChatProgress` 里没有 image），
// 会话里的图片如果只写成「会话附件 N 个」就是纯装饰——用户点不开也看不到。
// 正确做法是给每个附件一个真实 URI，让 VS Code 自己的图片查看器去读字节；
// 字节仍由 Host 的官方附件服务提供（`readAttachment` → `attachments.readImage`），
// IDE 侧不缓存、不落盘、不复制一份附件存储。
//
// 只读：写/删/改名/建目录一律拒绝（附件归 DSH 内核管），只实现读取所需的最小面。

import { Event } from '../../../../base/common/event.js';
import { decodeBase64 } from '../../../../base/common/buffer.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import {
	FileSystemProviderCapabilities,
	FileSystemProviderErrorCode,
	createFileSystemProviderError,
	FileType,
	IFileDeleteOptions,
	IFileOverwriteOptions,
	IFileService,
	IFileSystemProviderWithFileReadWriteCapability,
	IFileWriteOptions,
	IStat,
	IWatchOptions,
} from '../../../../platform/files/common/files.js';
import { IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import type { DshIdeImageAttachmentRef } from '../../../../platform/dshClient/common/dshIdeProtocol.js';

/** 附件 URI 方案名。 */
export const DSH_ATTACHMENT_SCHEME = 'dsh-attachment';

/**
 * 构造 URI 真正需要的两个字段。
 *
 * 不声明成完整的 `DshIdeImageAttachmentRef`：会话投影里的附件行只有 id 与类型，
 * 要求 width/height/bytes 会逼调用方编造数字。
 */
export interface DshAttachmentUriInput {
	readonly attachmentId: string;
	readonly mediaType: string;
}

/**
 * 由附件引用构造只读 URI。
 *
 * 路径只放 attachmentId（DSH 自己发的稳定 id），查询串带会话与媒体类型：
 * 打开器在 `stat` 之前就能按扩展名选对查看器，Host 侧也不用再猜类型。
 * @param ref 附件引用（Host 投影下发）
 * @param sessionId 附件所属会话
 * @returns 可直接交给原生打开器的 URI
 */
export function dshAttachmentUri(ref: DshAttachmentUriInput, sessionId: string): URI {
	const extension = ref.mediaType === 'image/jpeg' ? 'jpg'
		: ref.mediaType === 'image/webp' ? 'webp'
			: ref.mediaType === 'image/gif' ? 'gif' : 'png';
	return URI.from({
		scheme: DSH_ATTACHMENT_SCHEME,
		path: `/${encodeURIComponent(ref.attachmentId)}.${extension}`,
		query: `session=${encodeURIComponent(sessionId)}&media=${encodeURIComponent(ref.mediaType)}`,
	});
}

/**
 * 只读附件文件系统。
 *
 * 目录结构是平的：根下每个附件一个文件，不支持列目录（附件清单由会话投影提供，
 * 不在这里另造一份索引）。
 */
export class DshAttachmentFileSystemProvider extends Disposable implements IFileSystemProviderWithFileReadWriteCapability {

	// FileReadWrite 是 readFile 的能力位，不是「可写」。
	// 再标 Readonly：fileService 会在写入入口直接拒绝，而不是先打开编辑器再让 writeFile 抛错。
	// PathCaseSensitive：attachmentId 是不透明字符串，大小写不同就是不同附件。
	readonly capabilities = FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.Readonly | FileSystemProviderCapabilities.PathCaseSensitive;

	readonly onDidChangeCapabilities: Event<void> = Event.None;
	readonly onDidChangeFile: Event<readonly never[]> = Event.None;

	// 打开图片时 fileService 先 stat 再 readFile。没有单独的元数据端点，
	// stat 只能读一遍字节。把这一遍留下，紧接着的 readFile 不再向 Host 要第二次。
	// 只留一张的话，多图来回切换会反复向 Host 取同一批字节；改成小容量 LRU：
	// 容量固定（上限 8 张），内存可控，常见来回对比的几张图也不用重传。
	private readonly _readCache = new Map<string, Uint8Array>();
	private static readonly READ_CACHE_LIMIT = 8;
	/** 同一 URI 的在途读取；并发调用共享一次 Host 传输。 */
	private readonly _inflight = new Map<string, Promise<Uint8Array>>();

	constructor(
		private readonly client: IDshClientService,
		@IFileService private readonly fileService: IFileService,
	) {
		super();
		this._register(this.fileService.registerProvider(DSH_ATTACHMENT_SCHEME, this));
	}

	async stat(resource: URI): Promise<IStat> {
		// 附件服务没有单独的元数据端点；先读一次拿到真实字节数，
		// 不凭空编 size（编小了查看器会截断，编大了会先报错）。
		const data = await this.readFile(resource);
		return {
			type: FileType.File,
			size: data.byteLength,
			mtime: 0,
			ctime: 0,
		};
	}

	async readFile(resource: URI): Promise<Uint8Array> {
		const key = resource.toString();
		const cached = this._readCache.get(key);
		if (cached !== undefined) {
			// 命中后重新插入一次：Map 保持插入顺序，这样它就是 LRU。
			this._readCache.delete(key);
			this._readCache.set(key, cached);
			return cached;
		}
		// 查看器会先 stat 再 readFile，并发时还会再问一次。
		// 同一 URI 的在途读取合并成一次 Host 调用，不重复传同一张图。
		const pending = this._inflight.get(key);
		if (pending !== undefined) {
			return pending;
		}
		const work = this.load(resource).then(data => {
			this._remember(key, data);
			return data;
		}).finally(() => {
			this._inflight.delete(key);
		});
		this._inflight.set(key, work);
		return work;
	}

	/** 写入 LRU，超出容量时淘汰最早的那张。 */
	private _remember(key: string, data: Uint8Array): void {
		this._readCache.delete(key);
		this._readCache.set(key, data);
		while (this._readCache.size > DshAttachmentFileSystemProvider.READ_CACHE_LIMIT) {
			const oldest = this._readCache.keys().next();
			if (oldest.done === true) {
				return;
			}
			this._readCache.delete(oldest.value);
		}
	}

	private async load(resource: URI): Promise<Uint8Array> {
		const file = resource.path.replace(/^\//, '');
		const attachmentId = decodeURIComponent(file.replace(/\.[a-z0-9]+$/i, ''));
		const params = new URLSearchParams(resource.query);
		const sessionId = params.get('session') ?? '';
		const mediaType = params.get('media') ?? '';
		if (attachmentId === '') {
			throw createFileSystemProviderError('dsh-attachment: the URI names no attachment id', FileSystemProviderErrorCode.FileNotFound);
		}
		const result = await this.client.call<{ readonly mediaType?: string; readonly data?: string }>('readAttachment', {
			sessionId,
			// Host 只按 attachmentId 读取；mediaType 是回退提示，缺字段不会改变读取路径。
			attachment: { attachmentId, mediaType, bytes: 0, width: 0, height: 0 } as DshIdeImageAttachmentRef,
		});
		if (!result.ok) {
			// 业务拒绝映射成「读不到」：让查看器显示标准错误，不把内部错误码画进图片区。
			throw createFileSystemProviderError(`dsh-attachment: ${result.error.code}`, FileSystemProviderErrorCode.FileNotFound);
		}
		const base64 = result.value.data ?? '';
		try {
			const bytes = decodeBase64(base64).buffer;
			if (bytes.byteLength === 0) {
				throw new Error('empty');
			}
			return bytes;
		} catch {
			// 坏的 base64 不能冒泡成未捕获异常，否则图片查看器整页失败。
			throw createFileSystemProviderError('dsh-attachment: image bytes could not be decoded', FileSystemProviderErrorCode.FileNotFound);
		}
	}

	writeFile(_resource: URI, _content: Uint8Array, _opts: IFileWriteOptions): Promise<void> {
		return Promise.reject(createFileSystemProviderError('dsh-attachment is read-only', FileSystemProviderErrorCode.NoPermissions));
	}

	// 只读平面方案：这些操作一律不存在，显式拒绝而不是静默成功。
	mkdir(): Promise<void> {
		return Promise.reject(createFileSystemProviderError('dsh-attachment has no directories', FileSystemProviderErrorCode.NoPermissions));
	}

	readdir(): Promise<[string, FileType][]> {
		return Promise.reject(createFileSystemProviderError('dsh-attachment cannot list; the session projection supplies the list', FileSystemProviderErrorCode.NoPermissions));
	}

	delete(_resource: URI, _opts: IFileDeleteOptions): Promise<void> {
		return Promise.reject(createFileSystemProviderError('dsh-attachment is read-only', FileSystemProviderErrorCode.NoPermissions));
	}

	rename(_from: URI, _to: URI, _opts: IFileOverwriteOptions): Promise<void> {
		return Promise.reject(createFileSystemProviderError('dsh-attachment is read-only', FileSystemProviderErrorCode.NoPermissions));
	}

	watch(_resource: URI, _opts: IWatchOptions): { dispose(): void } {
		// 附件不可变：没有变更可推。返回空句柄，不抛错（抛错会让打开器把方案当坏掉）。
		return { dispose() { } };
	}
}
