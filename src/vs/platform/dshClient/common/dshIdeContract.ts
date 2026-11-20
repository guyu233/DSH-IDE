/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH-IDE 协议契约与版本门禁（P1）。
//
// 依赖方向单向：本文件引用 `dshIdeProtocol.ts` 的常量；`dshIdeProtocol.ts` 绝不反向引用本文件。
// 版本策略：优先跟随 DSH stable，不在 rc 迭代期盲目追新；`installedMeetsVersion` / `upstreamDrift`
// 在插件启动时做 drift 警告，CI 做失败门禁。

import { env } from '../../../base/common/process.js';
import { DSH_IDE_API_VERSION, DSH_IDE_WIRE_REVISION } from './dshIdeProtocol.js';

/** 经校验、承诺兼容的上游（DSH stable）版本。上游升级时只改此处 + translator/dshEmits 穷举。 */
export const UPSTREAM_VALIDATED_VERSION = '0.2.2-rc.1';

/**
 * 受信的 DSH 包（升级时比对指纹用）。
 *
 * 只列**真实存在于已安装 DSH 的 npm 包**。`packages/core/` 与 `packages/adapter/`
 * 是上游的**目录组**（一组包的家），不是可安装的包名——写进这里会让清单核对时
 * 找不到对应 version，等于给假数据。`dsh-web-frontend` 是真实发布的包。
 */
export interface DshBlessedPackage {
	readonly name: string;
	/** 承诺兼容的 semver 范围（人类可读，CI 仅作记录/审计）。 */
	readonly range: string;
}
export const BLESSED_PACKAGES = Object.freeze([
	{ name: '@deepseek-ai/dsh-web-frontend', range: '^0.2.2' },
] as readonly DshBlessedPackage[]);

/**
 * VS Code 侧需保留的注入点占位（上游升级打 patch 时核对）。
 *
 * `symbol` 必须是**本仓库该文件里真实存在的锚点**：`file` 与 `sha256` 描述本仓库现状，
 * `symbol` 若写成上游的旧名字（本仓库已精简掉的类），这份清单就只是好看、核对时对不上。
 */
export interface VSCodePatchPoint {
	readonly id: string;
	readonly file: string;
	/** 该文件里真实存在的锚点符号；文件已精简到无导出时，写其保留的注册入口描述。 */
	readonly symbol: string;
	readonly note: string;
	/**
	 * 该文件在**本仓库基线时刻**的 sha256 前 16 位。
	 *
	 * 用途（D26）：上游升版时，若注入点的实际内容与基线不一致，说明上游改动过这个
	 * 文件、`patch` 可能需要重放调整——`verify:dsh-ide-contract` 据此做**失败断言**，
	 * 而不是只在日志里打印一串无人比对的哈希。
	 *
	 * 维护方式（见第 5 章 §7）：上游核对确认改动已被本仓库吸收后再更新此值，
	 * 并在第 7 章 §7.7 记录更新原因与新的上游 commit。
	 */
	readonly sha256: string;
}
export const VSCODE_PATCH_POINTS = Object.freeze([
	{
		id: 'chat-viewlet',
		file: 'src/vs/workbench/contrib/chat/browser/chat.contribution.ts',
		symbol: 'registerAction2 / registerSingleton（本文件已精简为注册入口）',
		note: 'DSH Chat 视图接入点（鲸鱼按钮 / 面板骨架）',
		sha256: 'efce7729d4bbe245',
	},
	{
		id: 'inline-completion',
		file: 'src/vs/editor/contrib/inlineCompletions/browser/controller/inlineCompletionsController.ts',
		symbol: 'InlineCompletionsController',
		note: 'DSH 行内补全接入点',
		sha256: 'f192395c09b631ab',
	},
	{
		id: 'terminal',
		file: 'src/vs/platform/terminal/common/terminal.ts',
		symbol: 'IRawTerminalInstanceLayoutInfo',
		note: '原生 node-pty 终端接入点（按宿主 Electron ABI 重编）',
		sha256: '4bc444eea27988a3',
	},
	{
		id: 'command-palette',
		file: 'src/vs/workbench/browser/quickaccess.ts',
		symbol: 'inQuickPickContext',
		note: 'DSH 命令入口接入点',
		sha256: 'd7babb3efa906bdd',
	},
] as readonly VSCodePatchPoint[]);

/**
 * 严格解析 semver（SemVer 2.0.0）。
 *
 * 为什么不用 `parseInt`：`parseInt('abc')` 是 NaN、`parseInt('1x')` 是 1，
 * 于是 `abc` 会被当成 `0.0.0`、`1x.2.3` 会被当成 `1.2.3`——无效版本被静默接受，
 * 「版本不符」被误判成「版本相符」。这里要求形状严格合法，非法即返回 `undefined`，
 * 由调用方明确拒绝，而不是补零猜一个值。
 *
 * build metadata（`+sha`）按 SemVer §10 不参与比较，因此解析时丢弃、但**允许出现**。
 * @returns `[major, minor, patch, prerelease]`；形状非法时返回 `undefined`
 */
export function parseVersion(version: string): [number, number, number, string] | undefined {
	const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/.exec(version.trim());
	if (match === null) {
		return undefined;
	}
	return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? ''];
}

/**
 * 比较 semver 的 prerelease 段（`rc.2` / `beta.10`）。
 *
 * 必须按 semver 规则逐段比较数字：直接把整段当字符串比会让 `rc.10 < rc.9`。
 * 规则：数字段按数值比、数字段低于非数字段、段数少者更低、都没区别则相等。
 */
function comparePrerelease(a: string, b: string): number {
	if (a === b) {
		return 0;
	}
	// 无 prerelease = 正式版，高于任何 prerelease。
	if (a === '') {
		return 1;
	}
	if (b === '') {
		return -1;
	}
	const pa = a.split('.');
	const pb = b.split('.');
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const x = pa[i];
		const y = pb[i];
		if (x === undefined) {
			return -1;
		}
		if (y === undefined) {
			return 1;
		}
		const xn = /^\d+$/.test(x);
		const yn = /^\d+$/.test(y);
		if (xn && yn) {
			const diff = Number(x) - Number(y);
			if (diff !== 0) {
				return diff < 0 ? -1 : 1;
			}
			continue;
		}
		if (xn) {
			return -1;
		}
		if (yn) {
			return 1;
		}
		if (x !== y) {
			return x < y ? -1 : 1;
		}
	}
	return 0;
}

/**
 * 比较 semver：a<b 返回 -1，a==b 返回 0，a>b 返回 1。
 * 正式版优先于预发布（1.0.0 > 1.0.0-rc.1）。
 * 任一侧形状非法时返回 `undefined`：非法版本不可比较，不能当成相等或更低。
 */
export function compareVersion(a: string, b: string): number | undefined {
	const pa = parseVersion(a);
	const pb = parseVersion(b);
	if (pa === undefined || pb === undefined) {
		return undefined;
	}
	for (let i = 0; i < 3; i++) {
		if (pa[i] !== pb[i]) {
			return pa[i] < pb[i] ? -1 : 1;
		}
	}
	return comparePrerelease(pa[3], pb[3]);
}

/**
 * 已安装的 DSH 版本是否满足经校验版本（>= 即满足）。
 *
 * 版本字符串非法时返回 `false`：无法证明满足，就不算满足。
 */
export function installedMeetsVersion(installed: string): boolean {
	const order = compareVersion(installed, UPSTREAM_VALIDATED_VERSION);
	return order !== undefined && order >= 0;
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
