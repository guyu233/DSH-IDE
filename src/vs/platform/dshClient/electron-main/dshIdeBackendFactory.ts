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

import { env } from '../../../base/common/process.js';
import { DSH_IDE_COOKIE_ENV, DSH_IDE_ENDPOINT_ENV, DSH_IDE_LAUNCH_URL_ENV } from '../common/env.js';
import { DshIdeTransport, DshIdeTransportBackend, authenticateHost } from '../transport/dshIdeTransport.js';
import { UnavailableDshIdeBackend, type DshIdeBackend } from './ide-view-service.js';

/**
 * 按环境装配后端。HTTP 端点在首帧之前不能异步等待，因此这里只做同步装配：
 * 有 cookie 直接用；只有 launch URL 时按「先换 cookie」的记录在首次 `follow` 前完成交换。
 */
export function createDshIdeBackendFromEnv(processEnv: Record<string, string | undefined> = env as Record<string, string | undefined>): DshIdeBackend {
	const origin = processEnv[DSH_IDE_ENDPOINT_ENV];
	if (origin === undefined || origin === '') {
		return new UnavailableDshIdeBackend();
	}
	const cookie = processEnv[DSH_IDE_COOKIE_ENV];
	const launchUrl = processEnv[DSH_IDE_LAUNCH_URL_ENV];
	return new LazyDshIdeTransportBackend(origin, cookie, launchUrl);
}

/**
 * 延迟装配的传输后端：`open` 是同步的（通道首帧不能等 IO），因此 cookie 的交换推迟到
 * 第一次真正需要网络的调用。交换失败时对应的调用以 `dsh-ide/host-authentication-failed` 拒绝，
 * 绝不伪造成功。
 */
class LazyDshIdeTransportBackend implements DshIdeBackend {
	private readonly origin: string;
	private readonly cookie: string | undefined;
	private readonly launchUrl: string | undefined;
	private impl: DshIdeTransportBackend | undefined;
	private authenticating: Promise<DshIdeTransportBackend> | undefined;

	constructor(origin: string, cookie: string | undefined, launchUrl: string | undefined) {
		this.origin = origin;
		this.cookie = cookie;
		this.launchUrl = launchUrl;
	}

	open(spec: Parameters<DshIdeBackend['open']>[0]): ReturnType<DshIdeBackend['open']> {
		// 通道 id 由后端生成；交换失败不影响首帧，错误留给第一次网络调用。
		const channelId = `dsh-ide:${crypto.randomUUID()}`;
		const sessionId = typeof spec.params?.['sessionId'] === 'string' ? spec.params['sessionId'] : undefined;
		this.pendingOpen = { channelId, sessionId };
		return { channelId, sessionId };
	}

	private pendingOpen: { channelId: string; sessionId?: string } | undefined;

	follow(sessionId: string | undefined, onEvent: (raw: unknown) => void): { dispose(): void } {
		// 同步无法等待鉴权：先登记回调，鉴权完成后补开流。
		let disposed = false;
		let handle: { dispose(): void } | undefined;
		void this.ensureImpl().then(impl => {
			if (disposed) {
				return;
			}
			handle = impl.follow(sessionId, onEvent);
		}).catch(() => {
			// 鉴权失败：不推任何伪造事件；上层调用会以同样错误码拒绝。
		});
		return {
			dispose: () => {
				disposed = true;
				handle?.dispose();
			},
		};
	}

	async invoke(method: Parameters<DshIdeBackend['invoke']>[0], args: unknown): Promise<unknown> {
		const impl = await this.ensureImpl();
		return impl.invoke(method, args);
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
		})();
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
