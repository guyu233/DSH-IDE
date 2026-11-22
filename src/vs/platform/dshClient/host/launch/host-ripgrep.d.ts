/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export declare const DSH_IDE_HOST_RG_PATH: string;

export declare function resolveHostRipgrep(options?: {
	resourcesPath?: string;
	resolveRipgrep?: (resourcesPath: string) => Promise<string>;
}): Promise<string>;
