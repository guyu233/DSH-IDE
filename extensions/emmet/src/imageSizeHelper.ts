/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Based on @sergeche's work on the emmet plugin for atom

import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { imageSize } from 'image-size';
import { ISizeCalculationResult } from 'image-size/dist/types/interface';

const reUrl = /^https?:/;
export type ImageInfoWithScale = {
	realWidth: number;
	realHeight: number;
	width: number;
	height: number;
};

/**
 * Get size of given image file. Supports files from local filesystem,
 * as well as URLs
 */
export function getImageSize(file: string): Promise<ImageInfoWithScale | undefined> {
	file = file.replace(/^file:\/\//, '');
	return reUrl.test(file) ? getImageSizeFromURL(file) : getImageSizeFromFile(file);
}

/**
 * Get image size from file on local file system
 */
function getImageSizeFromFile(file: string): Promise<ImageInfoWithScale | undefined> {
	return new Promise((resolve, reject) => {
		const isDataUrl = file.match(/^data:.+?;base64,/);

		if (isDataUrl) {
			// NB should use sync version of `sizeOf()` for buffers
			try {
				const data = Buffer.from(file.slice(isDataUrl[0].length), 'base64');
				return resolve(sizeForFileName('', imageSize(data)));
			} catch (err) {
				return reject(err);
			}
		}

		imageSize(file, (err: Error | null, size?: ISizeCalculationResult) => {
			if (err) {
				reject(err);
			} else {
				resolve(sizeForFileName(path.basename(file), size));
			}
		});
	});
}

/** 探测远端图片尺寸时允许累积的最大字节数；超出即放弃，不把整图读进内存。 */
const MAX_IMAGE_PROBE_BYTES = 2 * 1024 * 1024;

/** 探测远端图片尺寸的时限；远端不结束时也要有结论。 */
const IMAGE_PROBE_TIMEOUT_MS = 5000;

/**
 * Get image size from given remove URL
 */
function getImageSizeFromURL(urlStr: string): Promise<ImageInfoWithScale | undefined> {
	return new Promise((resolve, reject) => {
		const url = new URL(urlStr);
		const getTransport = url.protocol === 'https:' ? https.get : http.get;

		if (!url.pathname) {
			return reject('Given url doesnt have pathname property');
		}
		const urlPath: string = url.pathname;

		getTransport(url, resp => {
			const chunks: Buffer[] = [];
			let bufSize = 0;
			// 只在「结算一次」的意义上收尾：成功、超限、未识别、出错都必须走到这里，
			// 否则调用方会永远等一个不会结算的 Promise。
			let settled = false;
			// 先声明定时器句柄：`finish` 会在定义后立刻可能被调用（例如首块就超限）。
			let timer: ReturnType<typeof setTimeout> | undefined;
			const finish = (fn: () => void) => {
				if (settled) {
					return;
				}
				settled = true;
				if (timer !== undefined) {
					clearTimeout(timer);
				}
				resp.removeListener('data', onData);
				resp.destroy(); // no need to read further
				fn();
			};

			const trySize = (final: boolean) => {
				try {
					const size: ISizeCalculationResult = imageSize(Buffer.concat(chunks, bufSize));
					finish(() => resolve(sizeForFileName(path.basename(urlPath), size)));
					return true;
				} catch (err) {
					// 数据还不够：继续等下一块。但流已经结束时这就是最终结论——
					// 识别不出尺寸要明确结算，不能把解析错误吞掉让 Promise 悬空。
					if (final) {
						finish(() => resolve(undefined));
					}
					return false;
				}
			};

			const onData = (chunk: Buffer) => {
				bufSize += chunk.length;
				if (bufSize > MAX_IMAGE_PROBE_BYTES) {
					// 有界：不再累积，也不再继续下载。读不到尺寸就是读不到，
					// 明确返回 undefined，而不是把整张图拉进内存。
					finish(() => resolve(undefined));
					return;
				}
				chunks.push(chunk);
				trySize(false);
			};

			// 时限：远端不结束时也要有结论，避免命令永久挂起。
			timer = setTimeout(() => finish(() => resolve(undefined)), IMAGE_PROBE_TIMEOUT_MS);

			resp
				.on('data', onData)
				.on('end', () => trySize(true))
				.once('error', err => finish(() => reject(err)));
		}).once('error', reject);
	});
}

/**
 * Returns size object for given file name. If file name contains `@Nx` token,
 * the final dimentions will be downscaled by N
 */
function sizeForFileName(fileName: string, size?: ISizeCalculationResult): ImageInfoWithScale | undefined {
	const m = fileName.match(/@(\d+)x\./);
	const scale = m ? +m[1] : 1;

	if (!size || !size.width || !size.height) {
		return;
	}

	return {
		realWidth: size.width,
		realHeight: size.height,
		width: Math.floor(size.width / scale),
		height: Math.floor(size.height / scale)
	};
}
