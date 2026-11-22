/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// DSH-IDE 提示只有三类，每类一种框，调用方不要再直接选 info / warn / error。
// 连接：传输和桥。失败：这次操作没做成。结果：做成了，或只是说明现状。

import { INotificationService } from '../../../../platform/notification/common/notification.js';

const PREFIX = 'DSH-IDE：';

function textOf(message: string): string {
	return message.startsWith(PREFIX) ? message : `${PREFIX}${message}`;
}

/** 连接状态。黄色警告框。 */
export function dshLink(notifications: INotificationService, message: string): void {
	notifications.warn(textOf(message));
}

/** 操作失败。红色错误框。 */
export function dshFail(notifications: INotificationService, message: string): void {
	notifications.error(textOf(message));
}

/** 操作结果。蓝色信息框。 */
export function dshDone(notifications: INotificationService, message: string): void {
	notifications.info(textOf(message));
}
