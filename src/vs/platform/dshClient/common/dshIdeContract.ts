/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH-IDE 协议契约与版本门禁（阶段 2.1）。
//
// 依赖方向单向：本文件引用 `dshIdeProtocol.ts` 的常量；`dshIdeProtocol.ts` 绝不反向引用本文件。
// 版本策略：优先跟随 DSH stable，不在 rc 迭代期盲目追新；`installedMeetsVersion` / `upstreamDrift`
// 在插件启动时做 drift 警告，CI 做失败门禁。

import { env } from '../../../base/common/process.js';
import { DSH_IDE_API_VERSION, DSH_IDE_WIRE_REVISION } from './dshIdeProtocol.js';

/** 经校验、承诺兼容的上游（DSH stable）版本。上游升级时只改此处 + translator/dshEmits 穷举。 */
export const UPSTREAM_VALIDATED_VERSION = '0.2.2-rc.1';

/** 受信的 DSH 包（升级时比对指纹用）。 */
export interface DshBlessedPackage {
	readonly name: string;
	/** 承诺兼容的 semver 范围（人类可读，CI 仅作记录/审计）。 */
	readonly range: string;
}
export const BLESSED_PACKAGES = Object.freeze([
	{ name: '@deepseek-ai/dsh-web-frontend', range: '^0.2.2' },
	{ name: '@deepseek-ai/dsh-core', range: '^0.2.2' },
	{ name: '@deepseek-ai/dsh-adapter', range: '^0.2.2' },
] as readonly DshBlessedPackage[]);

/** VS Code 侧需保留的注入点占位（上游升级打 patch 时核对）。 */
export interface VSCodePatchPoint {
	readonly id: string;
	readonly file: string;
	readonly symbol: string;
	readonly note: string;
}
export const VSCODE_PATCH_POINTS = Object.freeze([
	{
		id: 'chat-viewlet',
		file: 'src/vs/workbench/contrib/chat/browser/chat.contribution.ts',
		symbol: 'ChatViewPane',
		note: 'DSH Chat 视图接入点（鲸鱼按钮 / 面板骨架）',
	},
	{
		id: 'inline-completion',
		file: 'src/vs/editor/contrib/inlineCompletions/browser/controller/inlineCompletionsController.ts',
		symbol: 'InlineCompletionsController',
		note: 'DSH 行内补全接入点',
	},
	{
		id: 'terminal',
		file: 'src/vs/platform/terminal/common/terminal.ts',
		symbol: 'ITerminalService',
		note: '原生 node-pty 终端接入点（按宿主 Electron ABI 重编）',
	},
	{
		id: 'command-palette',
		file: 'src/vs/workbench/browser/quickaccess.ts',
		symbol: 'QuickAccessController',
		note: 'DSH 命令入口接入点',
	},
] as readonly VSCodePatchPoint[]);

/** 解析 semver（支持 `1.2.3` 与 `1.2.3-rc.1`）。返回 [major, minor, patch, prerelease]。 */
export function parseVersion(version: string): [number, number, number, string] {
	const [core, pre = ''] = version.split('-');
	const parts = core.split('.').map(n => parseInt(n, 10));
	const safe = (n: number | undefined): number => (n !== undefined && Number.isFinite(n) ? n : 0);
	return [safe(parts[0]), safe(parts[1]), safe(parts[2]), pre];
}

/** 比较 semver：a<b 返回 -1，a==b 返回 0，a>b 返回 1。正式版优先于预发布（1.0.0 > 1.0.0-rc.1）。 */
export function compareVersion(a: string, b: string): number {
	const pa = parseVersion(a);
	const pb = parseVersion(b);
	for (let i = 0; i < 3; i++) {
		if (pa[i] !== pb[i]) {
			return pa[i] < pb[i] ? -1 : 1;
		}
	}
	const ra = pa[3];
	const rb = pb[3];
	if (ra === rb) {
		return 0;
	}
	// 无预发布 > 有预发布
	if (ra === '') {
		return 1;
	}
	if (rb === '') {
		return -1;
	}
	return ra < rb ? -1 : 1;
}

/** 已安装的 DSH 版本是否满足经校验版本（>= 即满足）。 */
export function installedMeetsVersion(installed: string): boolean {
	return compareVersion(installed, UPSTREAM_VALIDATED_VERSION) >= 0;
}

export interface UpstreamDrift {
	readonly validated: string;
	readonly installed: string | undefined;
	readonly drift: boolean;
	readonly blessed: readonly DshBlessedPackage[];
	readonly patchPoints: readonly VSCodePatchPoint[];
}

/** 启动时调用：比对已安装版本与经校验版本，返回 drift 结论（供警告/CI 门禁）。 */
export function upstreamDrift(): UpstreamDrift {
	const installed = (env['DSH_INSTALLED_VERSION'] as string | undefined) ?? undefined;
	const drift = installed === undefined ? true : !installedMeetsVersion(installed);
	return {
		validated: UPSTREAM_VALIDATED_VERSION,
		installed,
		drift,
		blessed: BLESSED_PACKAGES,
		patchPoints: VSCODE_PATCH_POINTS,
	};
}

/** 协议 API 版本（运行时对齐用，便于与 DSH_IDE_API_VERSION 比对）。 */
export const DSH_IDE_CONTRACT_API_VERSION = DSH_IDE_API_VERSION;
export const DSH_IDE_CONTRACT_WIRE_REVISION = DSH_IDE_WIRE_REVISION;
