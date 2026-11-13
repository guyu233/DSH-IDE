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
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import type { IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import type {
	ILanguageModelChatMetadataAndIdentifier,
	ILanguageModelChatProvider,
	ILanguageModelChatRequestOptions,
	ILanguageModelChatResponse,
	ILanguageModelsService,
} from '../../chat/common/languageModels.js';
import { toLanguageModel } from './dshComposerProjection.js';

/** 提供方厂商 id：与 DSH 会话自报的 provider 分开，避免和 Copilot 等厂商撞名。 */
export const DSH_MODEL_VENDOR = 'dsh';

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

	constructor(
		private readonly client: IDshClientService,
		private readonly logService: ILogService,
		private readonly vendorHost?: { ensureVendor(vendor: string): void },
	) {
		super();
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
		const result = await this.client.call<ComposerState>('composerState', {});
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
		if (next.length === this.models.length && next.every((model, index) => model.identifier === this.models[index].identifier)) {
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
		throw new Error('DSH 模型不通过 IDE 侧发起请求');
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
	languageModels.deltaLanguageModelChatProviderDescriptors([{
		vendor: DSH_MODEL_VENDOR,
		displayName: 'DeepSeek',
		configuration: undefined,
		managementCommand: undefined,
		when: undefined,
	}], []);
	// 目录里的 provider id 也各登记一家，名字用它自己的 id，避免显示 "dsh" 把分组盖住。
	const provider = new DshLanguageModelProvider(client, logService, {
		ensureVendor: (vendor: string) => {
			if (vendor === DSH_MODEL_VENDOR) {
				return;
			}
			languageModels.deltaLanguageModelChatProviderDescriptors([{
				vendor,
				displayName: vendor,
				configuration: undefined,
				managementCommand: undefined,
				when: undefined,
			}], []);
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
		},
	};
}
