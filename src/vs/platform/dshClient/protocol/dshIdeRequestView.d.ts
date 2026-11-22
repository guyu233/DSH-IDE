/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// `dshIdeRequestView.js` 的类型声明。
//
// 为什么需要：这个模块是手写 ESM（Host 与 IDE 共用的中立投影），不是 tsc 产物；
// 而 `dshIdeWaterfallNotice.ts` 是 TS 模块、要 import 它的两个函数。没有声明文件时
// `build/tsconfig.json` 报 TS7016（隐式 any），类型检查失效。
//
// 只声明**导出面**，不重复实现；返回形状直接对齐协议真源里已有的两个 view 类型，
// 避免另写一份会漂移的镜像类型。

import type { DshIdeApprovalRequestView, DshIdeQuestionRequestView } from './dshIdeProtocol.js';

/**
 * 把官方 `ApprovalRequestEvent` 投影成线协议中立形状。
 *
 * 形状不完整（缺 `toolName`、或请求体不是普通对象）返回 `undefined`，不猜。
 */
export function projectApprovalRequest(request: unknown): DshIdeApprovalRequestView | undefined;

/**
 * 把官方 `AskUserQuestionRequest` 投影成线协议中立形状。
 *
 * 没有任何可用题目时返回 `undefined`，不产出空问卷。
 */
export function projectQuestionRequest(request: unknown): DshIdeQuestionRequestView | undefined;
