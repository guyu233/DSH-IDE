/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 守护：IDE 进程必须能在 DSH 重启后重新发现 Host 端点。
//
// 为什么需要这条守护：DSH 每次重启都换 pid，端口通常也换（监听 0 端口时由内核分配）。
// IDE 进程可能比 DSH 活得久——用户在 IDE 里继续工作，DSH 在后台重启。旧实现把启动时
// 拿到的 origin 闭包进传输层当成永久地址，于是重启之后：
//   - 聊天链再也连不上（界面只表现为空白）；
//   - 「DSH-IDE」按钮的开窗报到永久失败。
// 两组改动都必须存在，否则这个问题会静默复发：
//   1. Host 在拉窗时把端点文件路径交给 IDE（DSH_IDE_ENDPOINT_FILE）；
//   2. IDE 侧两个消费者（开窗接单 / 聊天后端）在失败后读该文件、发现端点变了就重连。
//
// 运行：node --experimental-strip-types --test build/lib/test/dshIdeEndpointRediscovery.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('env declares the endpoint-file variable both halves share', () => {
	const env = read('src/vs/platform/dshClient/common/env.js');
	assert.match(env, /export const DSH_IDE_ENDPOINT_FILE_ENV = 'DSH_IDE_ENDPOINT_FILE';/,
		'the endpoint-file env name must be declared once in the shared env module');
});

test('Host hands the endpoint file path to the IDE it spawns', () => {
	const service = read('src/vs/platform/dshClient/host/usecase/ide-service.js');
	assert.match(service, /env\.DSH_IDE_ENDPOINT_FILE = /,
		'host must pass the endpoint file path, otherwise the IDE cannot rediscover a new port');
	assert.match(service, /host-endpoint\.json/,
		'the passed path must point at the published endpoint file');
});

test('launch listener caller rediscovers the endpoint after a failed call', () => {
	const app = read('src/vs/code/electron-main/app.ts');
	const start = app.indexOf('function createLazyLaunchCaller');
	assert.ok(start > 0, 'createLazyLaunchCaller must exist');
	const body = app.slice(start, start + 6000);
	assert.match(body, /refreshEndpoint/, 'the caller must be able to rediscover the endpoint');
	// 空 origin 是「尚未解析」，不是「没变化」：启动时 IDE 可能没拿到 DSH_IDE_ENDPOINT。
	assert.match(body, /currentOrigin !== '' && nextOrigin === currentOrigin/,
		'rediscovery must be a no-op only when a known endpoint did not change');
	assert.match(body, /DSH_IDE_ENDPOINT_FILE_ENV/, 'rediscovery must read the injected endpoint file');
	// 重试只能发生在端点确实变了之后，不能对业务失败做无意义重放。
	assert.match(body, /if \(await refreshEndpoint\(\)\) \{/,
		'the retry must be gated on an actual endpoint change');
});

test('chat backend rediscovers the endpoint for both invoke and follow', () => {
	const factory = read('src/vs/platform/dshClient/ide/main/dshIdeBackendFactory.ts');
	assert.match(factory, /DSH_IDE_ENDPOINT_FILE_ENV/, 'the backend must accept the endpoint file path');
	assert.match(factory, /private async refreshEndpoint\(\): Promise<boolean>/,
		'the backend must own a rediscovery routine');
	// 两个消费者都要重试：一元调用与流式跟随。
	const invoke = factory.slice(factory.indexOf('async invoke('), factory.indexOf('close(): void'));
	assert.match(invoke, /refreshEndpoint/, 'invoke must retry once after rediscovery');
	const follow = factory.slice(factory.indexOf('follow(sessionId'), factory.indexOf('async invoke('));
	assert.match(follow, /refreshEndpoint/, 'follow must retry once after rediscovery');
});

test('a changed endpoint discards the stale cookie', () => {
	const factory = read('src/vs/platform/dshClient/ide/main/dshIdeBackendFactory.ts');
	assert.match(factory, /this\.cookie = undefined;/,
		'a cookie issued by the old port must not be reused against the new one');
});

test('the follow stream reconnects by itself after the host goes away', () => {
	const factory = read('src/vs/platform/dshClient/ide/main/dshIdeBackendFactory.ts');
	// 断线不能是一条流的终点：必须排一次重连。
	assert.match(factory, /const scheduleRetry = \(\): void =>/, 'the backend must schedule a reconnect');
	assert.match(factory, /onDisconnect\?\.\(error\)/, 'a transport disconnect must be reported upward');
	// 重连要重新发现端点，否则 DSH 换了端口就永远连不上新实例。
	const retry = factory.slice(factory.indexOf('const scheduleRetry'), factory.indexOf('void connect()'));
	assert.match(retry, /refreshEndpoint/, 'each reconnect must rediscover the endpoint');
	assert.match(retry, /Math\.min\(5000, 250 \* 2 \*\*/, 'reconnect must back off and cap its delay');
});

test('a transport stream reports disconnect through the port contract', () => {
	const protocol = read('src/vs/platform/dshClient/protocol/dshIdeProtocol.ts');
	// 端口仍必须暴露断线回调；现在它排在绑定参数之前，签名因此显式可缺省。
	assert.match(protocol, /onDisconnect: \(\(error: unknown\) => void\) \| undefined/,
		'the port must expose a disconnect signal, otherwise no layer can reconnect');
	assert.match(protocol, /binding: DshIdeViewBinding/,
		'the same port must carry the originating view binding');
	const transport = read('src/vs/platform/dshClient/ide/transport/dshIdeTransport.ts');
	assert.match(transport, /onDisconnect\?\.\(error\)/,
		'the transport must forward the stream error to the disconnect callback');
});

test('a disconnected view tells the UI it is rebuilding instead of freezing', () => {
	const service = read('src/vs/platform/dshClient/ide/main/ide-view-service.ts');
	// 断线回调按代次过滤：只有当前代的断开才允许把界面切到 rebuild。
	assert.match(service, /private publishDisconnected\(generation: number, error: unknown\): void/,
		'the view service must publish a rebuild state on disconnect');
	assert.match(service, /generation !== this\.generation/,
		'a stale generation must not publish a rebuild over a newer binding');
	assert.match(service, /state: \{ state: 'rebuild'/, 'the published state must be rebuild');
});

test('the IDE can bootstrap when DSH restarts before it starts', () => {
	const app = read('src/vs/code/electron-main/app.ts');
	// 只知道端点文件也要启动接单器；否则 IDE 会比 DSH 活得久时永远接不了单。
	assert.match(app, /const hasEntry = \(typeof endpointOrigin === 'string' && endpointOrigin !== ''\)/,
		'the launch listener must start from the endpoint file alone');
	const factory = read('src/vs/platform/dshClient/ide/main/dshIdeBackendFactory.ts');
	assert.match(factory, /if \(\(origin === undefined \|\| origin === ''\) && \(endpointFile === undefined \|\| endpointFile === ''\)\)/,
		'the backend must stay available when only the endpoint file is known');
});
