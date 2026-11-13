/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// Chat 输入框三个控件的数据源：全部来自 `dshIde` 通道的 `composerState`。
//
// 为什么要这一层：VS Code 的模型 / 模式 / 权限选择器本身不存数据，只读各自的表。
// 上游那三张表是 VS Code 自己的（Copilot 模型、Ask/Agent/Plan 模式、Default/Allow all/Autopilot 权限），
// 和 DSH 的会话目录不是一回事。把它们换成本文件的投影，选择器才显示 DSH 的模型、推理档、
// 智能体预设和权限预设。
//
// 边界：只读通道、只做投影；写回仍走已有 method（`setModel` / `setEffort` /
// `setAgentPreset` / `setPermissionPreset` / `setTeamEnabled`），不在这里另造接口。

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import type { IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';

/** 模型目录里的一项。 */
export interface DshComposerModel {
	readonly provider: string;
	readonly id: string;
	readonly name: string;
	readonly efforts: readonly { readonly id: string; readonly name: string }[];
	readonly defaultEffort?: string;
}
/** 权限预设。 */
export interface DshComposerPermissionOption {
	readonly value: string;
	readonly name: string;
}
/** 智能体预设。 */
export interface DshComposerPresetOption {
	readonly id: string;
	readonly name: string;
}
/** 一次投影的完整结果。缺哪一项就是 null，控件据此隐藏，不补假选项。 */
export interface DshComposerState {
	readonly models: readonly DshComposerModel[];
	readonly current: { readonly provider: string; readonly model: string; readonly effort?: string } | null;
	readonly permission: { readonly current: string | null; readonly options: readonly DshComposerPermissionOption[] } | null;
	readonly team: { readonly enabled: boolean; readonly confirmDisable: boolean } | null;
	readonly presets: { readonly current: string | null; readonly options: readonly DshComposerPresetOption[] } | null;
	/** 会话是否已经开聊：开聊后预设不可改，与桌面端一致。 */
	readonly locked: boolean;
}

const EMPTY: DshComposerState = {
	models: [],
	current: null,
	permission: null,
	team: null,
	presets: null,
	locked: false,
};

/** 三个选择器只依赖这个形状，不依赖具体实现，便于测试替身。 */
export interface IDshComposerSource {
	readonly state: DshComposerState;
	readonly onDidChange: Event<void>;
	refresh(): Promise<void>;
	selectModel(provider: string, model: string): Promise<void>;
	selectEffort(effort: string): Promise<void>;	selectPreset(preset: string): Promise<void>;
	selectPermission(permission: string): Promise<void>;
	setTeam(enabled: boolean): Promise<void>;
}

/** 把通道返回的原样对象收敛成上面的形状；形状不对就当没有。 */
export function normalizeDshComposerState(value: unknown): DshComposerState {
	if (typeof value !== 'object' || value === null) {
		return EMPTY;
	}
	const raw = value as Record<string, unknown>;
	const models: DshComposerModel[] = [];
	const modelBlock = raw.model;
	if (typeof modelBlock === 'object' && modelBlock !== null) {
		const groups = (modelBlock as Record<string, unknown>).groups;
		if (Array.isArray(groups)) {
			for (const group of groups) {
				if (typeof group !== 'object' || group === null) {
					continue;
				}
				const g = group as Record<string, unknown>;
				const provider = String(g.id ?? '');
				const list = Array.isArray(g.models) ? g.models : [];
				for (const item of list) {
					if (typeof item !== 'object' || item === null) {
						continue;
					}
					const m = item as Record<string, unknown>;
					const efforts = Array.isArray(m.efforts) ? m.efforts : [];
					models.push({
						provider,
						id: String(m.id ?? ''),
						name: typeof m.name === 'string' ? m.name : String(m.id ?? ''),
						efforts: efforts
							.filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
							.map(e => ({ id: String(e.id ?? ''), name: typeof e.name === 'string' ? e.name : String(e.id ?? '') })),
						...(typeof m.defaultEffort === 'string' ? { defaultEffort: m.defaultEffort } : {}),
					});
				}
			}
		}
	}
	const selection = modelBlock !== null && typeof modelBlock === 'object'
		? (modelBlock as Record<string, unknown>).current
		: undefined;
	const current = (typeof selection === 'object' && selection !== null)
		? (() => {
			const s = selection as Record<string, unknown>;
			if (typeof s.provider !== 'string' || typeof s.model !== 'string') {
				return null;
			}
			return {
				provider: s.provider,
				model: s.model,
				...(typeof s.effort === 'string' ? { effort: s.effort } : {}),
			};
		})()
		: null;

	return {
		models,
		current,
		permission: readOptions(raw.permission, 'value'),
		team: readTeam(raw.team),
		presets: readPresets(raw.preset),
		locked: raw.locked === true,
	};
}

function readOptions(block: unknown, key: 'value'): { current: string | null; options: DshComposerPermissionOption[] } | null {
	if (typeof block !== 'object' || block === null) {
		return null;
	}
	const b = block as Record<string, unknown>;
	if (!Array.isArray(b.options)) {
		return null;
	}
	const options = b.options
		.filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null)
		.map(o => ({ value: String(o[key] ?? ''), name: typeof o.name === 'string' ? o.name : String(o[key] ?? '') }))
		.filter(o => o.value !== '');
	if (options.length === 0) {
		return null;
	}
	return { current: typeof b.current === 'string' ? b.current : null, options };
}

function readPresets(block: unknown): { current: string | null; options: DshComposerPresetOption[] } | null {
	if (typeof block !== 'object' || block === null) {
		return null;
	}
	const b = block as Record<string, unknown>;
	if (!Array.isArray(b.options)) {
		return null;
	}
	const options = b.options
		.filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null)
		.map(o => ({ id: String(o.id ?? ''), name: typeof o.name === 'string' ? o.name : String(o.id ?? '') }))
		.filter(o => o.id !== '');
	return options.length === 0 ? null : { current: typeof b.current === 'string' ? b.current : null, options };
}

function readTeam(block: unknown): { enabled: boolean; confirmDisable: boolean } | null {
	if (typeof block !== 'object' || block === null) {
		return null;
	}
	const b = block as Record<string, unknown>;
	if (typeof b.enabled !== 'boolean') {
		return null;
	}
	return { enabled: b.enabled, confirmDisable: b.confirmDisable === true };
}

/**
 * 唯一的 DSH 输入框数据源。
 *
 * 三个选择器共用这一份快照，因此打开一次窗口只读一次通道，不各自发请求。
 * 读失败时保持上一次的值（首次为空），由控件自己决定藏起来，不弹错误。
 */
export class DshComposerSource extends Disposable implements IDshComposerSource {

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private stateValue: DshComposerState = EMPTY;
	private loading: Promise<void> | undefined;
	private disposed = false;

	constructor(
		private readonly client: IDshClientService,
		private readonly logService: ILogService,
		/** 开窗时由 Host 预取的目录（DSH_IDE_COMPOSER）。有它时第一帧就有数据。 */
		preset?: unknown,
	) {
		super();
		if (preset !== undefined) {
			this.stateValue = normalizeDshComposerState(preset);
		}
	}

	get state(): DshComposerState {
		return this.stateValue;
	}

	/** 拉一次；并发调用合并。 */
	refresh(): Promise<void> {
		if (this.disposed) {
			return Promise.resolve();
		}
		if (this.loading !== undefined) {
			return this.loading;
		}
		this.loading = this.load().finally(() => { this.loading = undefined; });
		return this.loading;
	}

	private async load(): Promise<void> {
		const result = await this.client.call('composerState', {});
		if (this.disposed) {
			return;
		}
		if (!result.ok) {
			// 会话还没绑定、视图还没开：保持上一次，不把拒绝画成「没有模型」。
			this.logService.trace('[dsh] composerState 暂不可用', result.error.code);
			return;
		}
		const next = normalizeDshComposerState(result.value);
		if (sameState(next, this.stateValue)) {
			return;
		}
		this.stateValue = next;
		this._onDidChange.fire();
	}

	// ---- 写回：全部走已有 method，不新增接口 ----

	async selectModel(provider: string, model: string): Promise<void> {
		await this.write('setModel', { provider, model });
	}

	async selectEffort(effort: string): Promise<void> {
		await this.write('setEffort', { effort });
	}

	async selectPreset(preset: string): Promise<void> {
		await this.write('setAgentPreset', { preset });
	}

	async selectPermission(permission: string): Promise<void> {
		await this.write('setPermissionPreset', { preset: permission });
	}

	async setTeam(enabled: boolean): Promise<void> {
		await this.write('setTeamEnabled', { enabled });
	}

	private async write(method: string, args: Record<string, unknown>): Promise<void> {
		const result = await this.client.call(method, args);
		if (!result.ok) {
			this.logService.warn(`[dsh] ${method} 被拒绝`, result.error.code, result.error.message);
			return;
		}
		await this.refresh();
	}

	override dispose(): void {
		this.disposed = true;
		super.dispose();
	}
}

function sameState(a: DshComposerState, b: DshComposerState): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}
