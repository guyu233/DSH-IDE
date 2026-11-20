/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 把 DSH 的模型目录注册成 Chat 的语言模型提供方。
//
// 为什么必须注册：输入框上的模型选择器是 VS Code 的通用控件，它只读
// `ILanguageModelsService` 的模型表，自己不理解 DSH。要让选择器显示 DSH 的模型与
// 推理档，只有把 DSH 目录填进这张表这一条路，不另画第二个选择器。
//
// 数据来源只有一处：`dshIde` 通道的 `composerState`。IDE 侧不缓存模型表，也不写死档位名。

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { localize } from '../../../../nls.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import type { IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import type {
	ILanguageModelChatMetadataAndIdentifier,
	ILanguageModelChatProvider,
	ILanguageModelChatRequestOptions,
	ILanguageModelChatResponse,
	ILanguageModelConfigurationSchema,
	ILanguageModelsService,
} from '../../chat/common/languageModels.js';
import { DSH_EFFORT_PROPERTY, DSH_MODEL_VENDOR, toLanguageModel } from './dshComposerProjection.js';
import { dshChatSessionFor } from './dshChatSession.js';

/**
 * 判定两版模型表项是否「显示上等价」。
 *
 * 只比 `identifier` 会漏掉改名与推理档变化：选择器会一直显示旧名称、旧档位。
 * 这里比较元数据里所有会影响显示的字段（含配置 schema 的 JSON 形态）。
 */
function sameLanguageModel(left: ILanguageModelChatMetadataAndIdentifier, right: ILanguageModelChatMetadataAndIdentifier | undefined): boolean {
	if (right === undefined) {
		return false;
	}
	return left.identifier === right.identifier
		&& left.metadata.name === right.metadata.name
		&& left.metadata.family === right.metadata.family
		&& left.metadata.version === right.metadata.version
		&& left.metadata.maxInputTokens === right.metadata.maxInputTokens
		&& left.metadata.maxOutputTokens === right.metadata.maxOutputTokens
		&& left.metadata.modelGroup?.id === right.metadata.modelGroup?.id
		&& sameEffortSchema(left.metadata.configurationSchema, right.metadata.configurationSchema);
}

/**
 * 推理档 schema 是否等价。
 *
 * 不用 `JSON.stringify` 比：schema 的形状由 `toLanguageModel` 固定，会变的只有
 * `enum` / `enumItemLabels` / `default` 三项。每次判等都整份序列化两个对象，
 * 在模型表刷新时是纯浪费。
 */
function sameEffortSchema(left: ILanguageModelConfigurationSchema | undefined, right: ILanguageModelConfigurationSchema | undefined): boolean {
	if (left === right) {
		return true;
	}
	if (left === undefined || right === undefined) {
		return false;
	}
	const a = left.properties?.[DSH_EFFORT_PROPERTY];
	const b = right.properties?.[DSH_EFFORT_PROPERTY];
	if (a === b) {
		return true;
	}
	if (a === undefined || b === undefined) {
		return false;
	}
	if (a.default !== b.default || a.enum?.length !== b.enum?.length || a.enumItemLabels?.length !== b.enumItemLabels?.length) {
		return false;
	}
	for (let i = 0; i < (a.enum?.length ?? 0); i++) {
		if (a.enum?.[i] !== b.enum?.[i]) {
			return false;
		}
	}
	for (let i = 0; i < (a.enumItemLabels?.length ?? 0); i++) {
		if (a.enumItemLabels?.[i] !== b.enumItemLabels?.[i]) {
			return false;
		}
	}
	return true;
}

interface ComposerModel {
	readonly id: string;
	readonly name: string;
	readonly efforts: readonly { readonly id: string; readonly name: string }[];
	readonly defaultEffort?: string;
}
interface ComposerGroup { readonly id: string; readonly name: string; readonly models: readonly ComposerModel[] }
interface ComposerState {
	readonly model: { readonly current: { readonly provider: string; readonly model: string; readonly effort?: string } | null; readonly groups: readonly ComposerGroup[] };
}

/**
 * DSH 目录 → Chat 模型表。
 *
 * 一个 DSH 模型一项；推理档写成配置 schema 的枚举，选择器据此画档位。
 * 目录为空时返回空数组，让选择器显示「暂无模型」，而不是退回 VS Code 自带的模型。
 */
export function projectDshModels(state: ComposerState): ILanguageModelChatMetadataAndIdentifier[] {
	const out: ILanguageModelChatMetadataAndIdentifier[] = [];
	const groups = Array.isArray(state.model?.groups) ? state.model.groups : [];
	for (const group of groups) {
		for (const model of (Array.isArray(group.models) ? group.models : [])) {
			out.push(toLanguageModel({ provider: group.id, ...model }));
		}
	}
	return out;
}

/**
 * 唯一的 DSH 模型提供方。
 *
 * 列表只在 `composerState` 读成功后更新；读不到就保持上一次的列表（首次为空），
 * 不伪造模型。发送请求交给 DSH 会话，不在 IDE 里生成回答。
 */
export class DshLanguageModelProvider extends Disposable implements ILanguageModelChatProvider {

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private models: ILanguageModelChatMetadataAndIdentifier[] = [];
	private loading: Promise<void> | undefined;
	/** 插件停用后不再写模型表，也不再 fire。 */
	private _disposed = false;

	constructor(
		private readonly client: IDshClientService,
		private readonly logService: ILogService,
		private readonly vendorHost?: { ensureVendor(vendor: string): void },
	) {
		super();
	}

	override dispose(): void {
		this._disposed = true;
		super.dispose();
	}

	/** 拉一次 DSH 目录；并发调用合并成一次请求。 */
	refresh(): Promise<void> {
		if (this.loading !== undefined) {
			return this.loading;
		}
		this.loading = this.load().finally(() => { this.loading = undefined; });
		return this.loading;
	}

	private async load(): Promise<void> {
		// 目录随会话投影下发（`composerState`），所以必须带发起会话；未绑定时不猜。
		const sessionId = dshChatSessionFor(this.client).activeSessionId;
		if (sessionId === undefined) {
			return;
		}
		const result = await this.client.call<ComposerState>('composerState', { sessionId });
		// 等待期间插件可能已被停用：这时不能再写模型表，更不能 fire。
		if (this._disposed) {
			return;
		}
		if (!result.ok) {
			// 会话还没绑定或视图还没开：保持空列表，不发假模型，也不弹错误。
			this.logService.trace('[dsh] composerState 暂不可用，模型列表保持上一次', result.error.code);
			return;
		}
		const next = projectDshModels(result.value);
		// 每个 DSH 供应商都要在模型表里有一家，分组才有显示名。
		const seen = new Set<string>();
		for (const model of next) {
			const vendor = model.metadata.modelGroup?.id;
			if (vendor !== undefined && !seen.has(vendor)) {
				seen.add(vendor);
				this.vendorHost?.ensureVendor(vendor);
			}
		}
		if (next.length === this.models.length && next.every((model, index) => sameLanguageModel(model, this.models[index]))) {
			return;
		}
		this.models = next;
		this._onDidChange.fire();
	}

	async provideLanguageModelChatInfo(): Promise<ILanguageModelChatMetadataAndIdentifier[]> {
		await this.refresh();
		return this.models;
	}

	async sendChatRequest(_modelId: string, _messages: unknown[], _from: ExtensionIdentifier | undefined, _options: ILanguageModelChatRequestOptions, _token: CancellationToken): Promise<ILanguageModelChatResponse> {
		// 回答只由 DSH 产生并经 DTO 快照回显；这里不生成第二个回答。
		throw new Error(localize('dsh.model.noDirectRequest', "DSH 模型不通过 IDE 侧发起请求。"));
	}

	async provideTokenCount(): Promise<number> {
		return 0;
	}
}

/** 把提供方挂到 Chat 的模型表上；返回可释放句柄。 */
export function registerDshLanguageModelProvider(
	languageModels: ILanguageModelsService,
	client: IDshClientService,
	logService: ILogService,
): { provider: DshLanguageModelProvider; dispose(): void } {
	// DSH 的每个供应商都要在模型表里登记一次，模型分组才能显示它们的名字。
	// 先登记默认的一家；其余随目录变化补充（见 DshLanguageModelProvider.load）。
	const addedVendors: { vendor: string; displayName: string; configuration: undefined; managementCommand: undefined; when: undefined }[] = [];
	const ensureVendor = (vendor: string, displayName: string): void => {
		if (addedVendors.some(item => item.vendor === vendor)) {
			return;
		}
		const descriptor = {
			vendor,
			displayName,
			configuration: undefined,
			managementCommand: undefined,
			when: undefined,
		};
		languageModels.deltaLanguageModelChatProviderDescriptors([descriptor], []);
		addedVendors.push(descriptor);
	};
	ensureVendor(DSH_MODEL_VENDOR, 'DeepSeek');
	// 目录里的 provider id 也各登记一家，名字用它自己的 id，避免显示 "dsh" 把分组盖住。
	// 同一次窗口里目录会反复刷新，已经登记过的 vendor 不能再 delta，否则每次都打 already registered。
	const provider = new DshLanguageModelProvider(client, logService, {
		ensureVendor: (vendor: string) => {
			if (vendor === DSH_MODEL_VENDOR) {
				return;
			}
			ensureVendor(vendor, vendor);
		},
	});
	const registration = languageModels.registerLanguageModelProvider(DSH_MODEL_VENDOR, provider);
	// 注册后立刻拉一次：选择器一出现就有目录，不用等用户点开才加载。
	void provider.refresh();
	return {
		provider,
		dispose: () => {
			registration.dispose();
			provider.dispose();
			if (addedVendors.length > 0) {
				languageModels.deltaLanguageModelChatProviderDescriptors([], addedVendors);
			}
		},
	};
}
