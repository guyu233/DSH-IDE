/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH-IDE 官方传输协议常量与线格式（平台无关；主进程/渲染器共用）。
//
// v2 定稿：DSH-IDE 是 DSH 桌面 App 单一 Host 的「第二个官方客户端」，传输 100% 走官方
// dsh-client-connection（/api + /api/remote.mux + 签名 cookie）。本文件仅描述官方线格式，
// 不含任何自造通道。
//
// 端点由 dsh-ide 插件经环境变量注入（取代 v1 的 DSH_IDE_PIPE/DSH_IDE_NONCE）：
//   DSH_IDE_ENDPOINT = Host Web origin（如 http://127.0.0.1:56188）
//   DSH_IDE_TOKEN    = 进程内 launch token（由 ctx.connection.authenticatedUrl 派生）
//
// 官方一元 RPC 线格式（见 dsh-client-connection/lib/types/client/rpc.js）：
//   请求  POST <origin>/api/<namespace>/<method>
//         header content-type: application/json
//         header cookie: <session cookie from /connect>
//         body   {"type":"client-request","rpcId":"<uuid>","method":"<namespace>/<method>","payload":{"args":{...}}}
//   响应  {"type":"server-response","rpcId":"<same>","result":{"ok":true,"value":...}}
//         或 {"type":"server-response","rpcId":"<same>","result":{"ok":false,"error":{code,message,details}}}
//
// 换取 API Peer（见 client-connection/lib/types/connect-protocol.js + authorizeConnect）：
//   GET <origin>/connect?token=<launchToken>&interactions=none|answer   -> 302
//         headers: location: ./api/remote.mux
//                  set-cookie: <authority-bound signed cookie>; HttpOnly; SameSite=Strict; Path=/
//   之后每次 /api 请求都带上该 cookie。interactions=none 足以做一元调用（无需 $events/$events-result）。

export const DSH_IDE_ENDPOINT_ENV = 'DSH_IDE_ENDPOINT';
export const DSH_IDE_TOKEN_ENV = 'DSH_IDE_TOKEN';

/** 官方一元 RPC 请求信封。 */
export interface DshClientRequest {
	readonly type: 'client-request';
	readonly rpcId: string;
	readonly method: string;
	readonly payload: { readonly args: Record<string, unknown> };
}

/** 官方一元 RPC 响应信封。 */
export interface DshClientResponse {
	readonly type: 'server-response';
	readonly rpcId: string;
	readonly result:
	| { readonly ok: true; readonly value?: unknown }
	| { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details?: unknown } };
}

/** 一元调用的统一结果（把官方 {ok,value|error} 折叠为可抛/可取值）。 */
export type DshUnaryResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: DshRemoteError };

export interface DshRemoteError { readonly code: string; readonly message: string; readonly details?: unknown }

/** 构造一元请求信封。 */
export function makeClientRequest(rpcId: string, endpoint: string, args: Record<string, unknown>): DshClientRequest {
	return { type: 'client-request', rpcId, method: endpoint, payload: { args: args ?? {} } };
}

/** 校验并折叠一元响应信封；rpcId 不匹配或信封非法时抛错。 */
export function parseClientResponse(raw: unknown, expectRpcId: string): DshUnaryResult<unknown> {
	if (typeof raw !== 'object' || raw === null) { throw new Error('dsh-client: response is not an object'); }
	const env = raw as Record<string, unknown>;
	if (env.type !== 'server-response' || typeof env.rpcId !== 'string') { throw new Error('dsh-client: invalid server-response envelope'); }
	if (env.rpcId !== expectRpcId) { throw new Error(`dsh-client: rpcId mismatch (sent ${expectRpcId}, got ${String(env.rpcId)})`); }
	const result = env.result as Record<string, unknown> | undefined;
	if (!result || typeof result !== 'object') { throw new Error('dsh-client: invalid server-response result'); }
	if (result.ok === true) { return { ok: true, value: result.value }; }
	const error = result.error as Record<string, unknown> | undefined;
	if (result.ok !== false || !error || typeof error.code !== 'string' || typeof error.message !== 'string') {
		throw new Error('dsh-client: invalid server-response failure');
	}
	return { ok: false, error: { code: error.code, message: error.message, details: error.details } };
}
