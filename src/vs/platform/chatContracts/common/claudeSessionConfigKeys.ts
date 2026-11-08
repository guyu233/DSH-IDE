/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Well-known session-config keys shared by the chat input pickers.
 *
 * This module is intentionally protocol-free (no imports from the agent-host
 * `node`/`browser` layers) so it can be consumed from browser-side pickers.
 * It is part of the chat contract layer, not an agent provider implementation.
 */
export const enum ClaudeSessionConfigKey {
	PermissionMode = 'claude.permissionMode',
}
