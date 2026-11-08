/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 旧 requests 文件中「账号」端点常量与元数据的暂留（P0 清理批次）。
//
// 这些 DSH 私有概念不属于新「中立 DTO」协议（dshIdeProtocol.ts），故单独放置本文件，
// 待 P5 归并到新协议或随账号功能重建时移除。当前仅 globalCompositeBar.ts（鲸鱼按钮）仍用。

import { env } from '../../../base/common/process.js';

export const DSH_ACCOUNT_GET_STATE_ENDPOINT = 'account/getState';
export const DSH_ACCOUNT_GET_PROFILE_ENDPOINT = 'account/getProfile';

export interface IDshAccountClientMetadata {
	readonly clientId: string;
	readonly clientSecret: string;
	readonly redirectUri: string;
	readonly scope: string;
}

export function dshAccountClientMetadata(locale?: string): IDshAccountClientMetadata {
	const v = (k: string) => env[k];
	return {
		clientId: v('DSH_ACCOUNT_CLIENT_ID') ?? '',
		clientSecret: v('DSH_ACCOUNT_CLIENT_SECRET') ?? '',
		redirectUri: v('DSH_ACCOUNT_REDIRECT_URI') ?? '',
		scope: locale ? `dsh.account.read dsh.account.write lang:${locale}` : 'dsh.account.read dsh.account.write',
	};
}
