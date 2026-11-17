/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// P3：按环境选择 `DshIdeBackend` 的实现（`app.ts` 唯一调用点）。
//
// 三种情形只有一个分支点，且不构成第二条路线（第 7 章 §3.1 裁定：只允许官方客户端传输）：
//   1. 配置了 `DSH_IDE_ENDPOINT` 与 `DSH_IDE_COOKIE`：用官方客户端传输适配（本机 loopback 官方端点）；
//   2. 只配置了 `DSH_IDE_ENDPOINT`（未换 cookie）：用同一适配但先按官方 `/?token` 交换 cookie；
//   3. 两者都没有：`UnavailableDshIdeBackend`，所有调用以 `dsh-ide/feature-unavailable` 拒绝。
//
// 本文件在 `electron-main/` 下，因此必须保持零 `@deepseek-ai/*`（boundary 门禁）；
// 官方包的等价线协议由 `transport/dshIdeTransport.ts` 手写实现，这里只做装配。

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '../../../base/common/process.js';
import { DSH_IDE_COOKIE_ENV, DSH_IDE_ENDPOINT_ENV, DSH_IDE_ENDPOINT_FILE_ENV, DSH_IDE_LAUNCH_URL_ENV } from '../common/env.js';
import { DshIdeTransport, DshIdeTransportBackend, authenticateHost } from '../transport/dshIdeTransport.js';
import { UnavailableDshIdeBackend, type DshIdeBackend } from './ide-view-service.js';

/**
 * 按环境装配后端。HTTP 端点在首帧之前不能异步等待，因此这里只做同步装配：
 * 有 cookie 直接用；只有 launch URL 时按「先换 cookie」的记录在首次 `follow` 前完成交换。
 */
/**
 * Host 没把路径写进环境变量时，仍按插件载荷的固定位置找端点文件。
 * 拉起 IDE 时工作目录是 `runtime/app`，文件在它的上一级。
 */
export function defaultDshIdeEndpointFile(): string | undefined {
	const cwd = process.cwd();
	const candidates = [
		join(cwd, '..', 'host-endpoint.json'),
		join(cwd, 'runtime', 'host-endpoint.json'),
	];
	for (const file of candidates) {
		try {
			if (existsSync(file)) {
				return file;
			}
		} catch {
			// 探测失败就试下一个，不让发现过程本身把后端打成不可用。
		}
	}
	return undefined;
}

export function createDshIdeBackendFromEnv(processEnv: Record<string, string | undefined> = env as Record<string, string | undefined>): DshIdeBackend {
	const endpointFile = processEnv[DSH_IDE_ENDPOINT_FILE_ENV] || defaultDshIdeEndpointFile();
	const origin = processEnv[DSH_IDE_ENDPOINT_ENV];
	// 知道端点文件就足够建立后端：即使启动时没有 DSH_IDE_ENDPOINT（IDE 可能比 DSH 活得久），
	// 也能在第一次调用时按文件里的新端点解析。两者都没有才是真的不可用。
	if ((origin === undefined || origin === '') && (endpointFile === undefined || endpointFile === '')) {
		return new UnavailableDshIdeBackend();
	}
	const cookie = processEnv[DSH_IDE_COOKIE_ENV];
	const launchUrl = processEnv[DSH_IDE_LAUNCH_URL_ENV];
	return new LazyDshIdeTransportBackend(origin ?? '', cookie, launchUrl, endpointFile);
}

/**
 * 延迟装配的传输后端：`open` 是同步的（通道首帧不能等 IO），因此 cookie 的交换推迟到
 * 第一次真正需要网络的调用。交换失败时对应的调用以 `dsh-ide/host-authentication-failed` 拒绝，
 * 绝不伪造成功。
 */
class LazyDshIdeTransportBackend implements DshIdeBackend {
	/** 当前实际使用的端点。DSH 重启可能换端口，所以不能当常量用。 */
	private origin: string;
	private cookie: string | undefined;
	private launchUrl: string | undefined;
	/** Host 端点文件路径（由 Host 在拉窗时注入）；缺省时无法重新发现端点。 */
	private readonly endpointFile: string | undefined;
	private impl: DshIdeTransportBackend | undefined;
	private authenticating: Promise<DshIdeTransportBackend> | undefined;

	constructor(origin: string, cookie: string | undefined, launchUrl: string | undefined, endpointFile?: string) {
		this.origin = origin;
		this.cookie = cookie;
		this.launchUrl = launchUrl;
		this.endpointFile = endpointFile;
	}

	/**
	 * 重新读 Host 端点文件，端点变了就丢掉旧连接并按新端点重连。
	 *
	 * 为什么需要：IDE 进程可能比 DSH 活得久。用户在 IDE 里继续工作，DSH 重启后
	 * 换了 pid/端口——若一直用启动时那个 origin，聊天会永久失联且界面只表现为空白。
	 * @returns true 表示端点确实换了（调用方可据此重试一次）。
	 */
	private async refreshEndpoint(): Promise<boolean> {
		if (this.endpointFile === undefined || this.endpointFile === '') {
			return false;
		}
		try {
			const { readFile } = await import('node:fs/promises');
			const parsed: unknown = JSON.parse(await readFile(this.endpointFile, 'utf8'));
			if (typeof parsed !== 'object' || parsed === null) {
				return false;
			}
			const endpoint = parsed as { origin?: unknown; launchUrl?: unknown };
			const nextOrigin = typeof endpoint.origin === 'string' ? endpoint.origin : undefined;
			const nextLaunchUrl = typeof endpoint.launchUrl === 'string' ? endpoint.launchUrl : undefined;
			// 启动时 origin 为空也算变化：那是首次解析。
			// 端口没变但 launchUrl 变了（同端口换了 token）同样要重连，旧 cookie 已经作废。
			if (nextOrigin === undefined || nextOrigin === '') {
				return false;
			}
			const sameOrigin = this.origin !== '' && nextOrigin === this.origin;
			const sameLaunch = nextLaunchUrl === undefined || nextLaunchUrl === this.launchUrl;
			if (sameOrigin && sameLaunch) {
				return false;
			}
			this.origin = nextOrigin;
			this.launchUrl = nextLaunchUrl ?? this.launchUrl;
			// 旧 cookie 属于旧端口，必须作废。
			this.cookie = undefined;
			this.close();
			return true;
		} catch {
			return false;
		}
	}

	open(spec: Parameters<DshIdeBackend['open']>[0]): ReturnType<DshIdeBackend['open']> {
		// 通道 id 由后端生成；交换失败不影响首帧，错误留给第一次网络调用。
		const channelId = `dsh-ide:${crypto.randomUUID()}`;
		const sessionId = typeof spec.params?.['sessionId'] === 'string' ? spec.params['sessionId'] : undefined;
		this.pendingOpen = { channelId, sessionId };
		return { channelId, sessionId };
	}

	private pendingOpen: { channelId: string; sessionId?: string } | undefined;

	follow(
		sessionId: string | undefined,
		onEvent: (raw: unknown) => void,
		onDisconnect?: (error: unknown) => void,
	): { dispose(): void } {
		let disposed = false;
		let handle: { dispose(): void } | undefined;
		let retryTimer: ReturnType<typeof setTimeout> | undefined;
		let attempt = 0;

		/**
		 * 建立（或重建）订阅。DSH 重启会换端口：先重新发现端点，再重连。
		 *
		 * 这是「不管 DSH 重启几次都能接上」的核心：断线不再是一条流的终点，
		 * 而是一次重连的起点。退避上限 5s，避免 DSH 长时间不在时打爆本机 CPU。
		 */
		const connect = async (): Promise<void> => {
			if (disposed) {
				return;
			}
			try {
				const impl = await this.ensureImpl();
				if (disposed) {
					return;
				}
				attempt = 0;
				handle = impl.follow(sessionId, onEvent, error => {
					// 传输断开（DSH 重启）：立刻排一次重连，并把原因交给上层显示。
					onDisconnect?.(error);
					scheduleRetry();
				});
			} catch (error) {
				onDisconnect?.(error);
				scheduleRetry();
			}
		};

		const scheduleRetry = (): void => {
			if (disposed || retryTimer !== undefined) {
				return;
			}
			attempt += 1;
			const delay = Math.min(5000, 250 * 2 ** Math.min(attempt - 1, 5));
			retryTimer = setTimeout(() => {
				retryTimer = undefined;
				if (disposed) {
					return;
				}
				void (async () => {
					// 端点变了就丢旧连接；没变也照样重试（可能只是瞬间断线）。
					await this.refreshEndpoint();
					if (disposed) {
						return;
					}
					handle?.dispose();
					handle = undefined;
					await connect();
				})();
			}, delay);
		};

		void connect();
		return {
			dispose: () => {
				disposed = true;
				if (retryTimer !== undefined) {
					clearTimeout(retryTimer);
					retryTimer = undefined;
				}
				handle?.dispose();
				handle = undefined;
			},
		};
	}
	async invoke(method: Parameters<DshIdeBackend['invoke']>[0], args: unknown): Promise<unknown> {
		try {
			const impl = await this.ensureImpl();
			return await impl.invoke(method, args);
		} catch (error) {
			// 端点变了才重试一次：DSH 可能就是刚重启换端口，旧连接必然失败。
			// 端点没变说明是真正的业务失败，不做无意义重放。
			if (await this.refreshEndpoint()) {
				const impl = await this.ensureImpl();
				return await impl.invoke(method, args);
			}
			throw error;
		}
	}

	close(): void {
		this.impl?.close();
		this.impl = undefined;
		this.authenticating = undefined;
		this.pendingOpen = undefined;
	}

	private ensureImpl(): Promise<DshIdeTransportBackend> {
		if (this.impl !== undefined) {
			return Promise.resolve(this.impl);
		}
		if (this.authenticating !== undefined) {
			return this.authenticating;
		}
		this.authenticating = (async () => {
			const cookie = this.cookie ?? await this.exchangeCookie();
			const transport = new DshIdeTransport({ origin: this.origin, cookie });
			const backend = new DshIdeTransportBackend(transport);
			if (this.pendingOpen !== undefined) {
				backend.open({ view: 'chat', params: { sessionId: this.pendingOpen.sessionId } });
			}
			this.impl = backend;
			return backend;
		})().catch(error => {
			// 失败不得缓存：否则首次 cookie 交换的瞬时失败会把 rejected promise 永久复用到后续所有调用。
			this.authenticating = undefined;
			throw error;
		});
		return this.authenticating;
	}

	private async exchangeCookie(): Promise<string> {
		if (this.launchUrl === undefined || this.launchUrl === '') {
			// 既无 cookie 也无 launch URL：明确拒绝，不猜测鉴权方式。
			throw Object.assign(new Error('DSH_IDE_COOKIE and DSH_IDE_LAUNCH_URL are both unset'), { code: 'dsh-ide/host-authentication-failed' });
		}
		const cookie = await authenticateHost(this.origin, this.launchUrl);
		// D55：换取成功后立刻清掉进程环境里的一次性 launch token，不再落盘、不再留驻。
		delete env[DSH_IDE_LAUNCH_URL_ENV];
		return cookie;
	}
}
