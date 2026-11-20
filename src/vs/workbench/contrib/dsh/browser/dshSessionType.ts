/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// `dsh` 会话类型的唯一定义处。
//
// 单独成文件是为了避免环依赖：会话控制器要用 composer 投影（权限选项），
// 而 composer 投影又必须给模型打上「只属于 dsh 会话」的标记——两边都引这里，
// 谁也不引对方。

/** 原生 Chat 里代表 DSH 会话的 scheme / session type。 */
export const DSH_CHAT_SESSION_TYPE = 'dsh';
