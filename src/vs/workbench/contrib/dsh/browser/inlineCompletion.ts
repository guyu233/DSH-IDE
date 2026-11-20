/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH 行内补全（InlineCompletionItemProvider，v2 官方传输）。
//
// 后端只走唯一通道的 inlineComplete。未连接、取消或 Host 没有默认模型时不产生补全。

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable, DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import { InlineCompletion, InlineCompletions, InlineCompletionContext, InlineCompletionsProvider } from '../../../../editor/common/languages.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import type { LanguageSelector } from '../../../../editor/common/languageSelector.js';
import type { ITextModel } from '../../../../editor/common/model.js';
import type { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import type { IConfigurationChangeEvent } from '../../../../platform/configuration/common/configuration.js';
import { IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';

export const DSH_INLINE_COMMON_LANGUAGES: LanguageSelector = [
	'typescript', 'typescriptreact', 'javascript', 'javascriptreact',
	'python', 'go', 'rust', 'java', 'c', 'cpp', 'csharp', 'php', 'ruby',
	'html', 'css', 'scss', 'json', 'yaml', 'markdown', 'shellscript', 'sql',
];

const MAX_PREFIX_CHARS = 4000;
// 与契约 dshIdeProtocol 的 inlineComplete 上限逐项对齐：suffix 2000、path 1024。
// 不一致时超长请求会被契约校验拒绝，用户看到的是「补全没反应」。
const MAX_SUFFIX_CHARS = 2000;
const MAX_PATH_CHARS = 1024;

/**
 * 行内补全开关。默认关闭。
 *
 * 每次光标停顿都会向 Host 打一次模型请求（一次跨进程调用 + 一次 LLM 生成）。
 * 装插件即全语言开启的话，用户什么都没配就持续消耗 CPU 与额度，
 * 且没有任何入口关掉它。默认关闭，由用户显式开启。
 */
export const DSH_INLINE_COMPLETION_SETTING = 'dsh.inlineCompletion.enabled';

export class DshInlineCompletionsProvider implements InlineCompletionsProvider<InlineCompletions<InlineCompletion>> {

	/** 在途请求的定时器取消句柄：provider 注销时逐个清掉，不必等 2.5 秒超时。 */
	private readonly _pending = new Set<() => void>();

	constructor(private readonly client: IDshClientService) { }

	async provideInlineCompletions(model: ITextModel, position: Position, _context: InlineCompletionContext, token: CancellationToken): Promise<InlineCompletions<InlineCompletion> | undefined> {
		if (token.isCancellationRequested) { return undefined; }
		const status = await this.client.getStatus();
		if (!status.connected || token.isCancellationRequested) { return undefined; }
		const prefix = model.getValueInRange(new Range(1, 1, position.lineNumber, position.column)).slice(-MAX_PREFIX_CHARS);
		const lastLineLength = model.getLineLength(position.lineNumber);
		const suffix = model.getValueInRange(new Range(position.lineNumber, position.column, position.lineNumber, lastLineLength + 1)).slice(0, MAX_SUFFIX_CHARS);

		let res;
		try {
			res = await this.withTimeout(this.client.call<{ text?: string }>('inlineComplete', {
				prefix,
				suffix,
				languageId: model.getLanguageId(),
				// 契约对 path 有 1024 字符上限，超长会被校验直接拒绝、补全静默失效。
				// 这里按上限截断：路径只用于给模型一点上下文，截断不影响可用性。
				path: model.uri.fsPath.slice(0, MAX_PATH_CHARS),
			}), 2500);
			if (token.isCancellationRequested) { return undefined; }
		} catch { return undefined; }
		if (!res || res.ok !== true) { return undefined; }
		const text = res.value?.text;
		if (!text || typeof text !== 'string' || text.length === 0) { return undefined; }
		const item: InlineCompletion = { insertText: text, range: new Range(position.lineNumber, position.column, position.lineNumber, position.column), completeBracketPairs: true };
		return { items: [item] };
	}

	disposeInlineCompletions(): void {
		// 注销（关设置 / 停用插件）时把在途请求的定时器一起收掉。
		// 不收的话，最长要等 2.5 秒超时才释放——关闭设置后仍在跑定时器不符合「关掉即零开销」。
		for (const cancel of this._pending) {
			cancel();
		}
		this._pending.clear();
	}

	private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const t = setTimeout(() => {
				this._pending.delete(cancel);
				reject(new Error('dsh inlineComplete timeout'));
			}, ms);
			// 登记取消句柄：provider 注销时能立刻清掉定时器，不必等超时。
			const cancel = (): void => {
				clearTimeout(t);
			};
			this._pending.add(cancel);
			p.then(v => {
				this._pending.delete(cancel);
				clearTimeout(t);
				resolve(v);
			}, e => {
				this._pending.delete(cancel);
				clearTimeout(t);
				reject(e);
			});
		});
	}
}

export function registerDshInlineCompletions(languageFeaturesService: ILanguageFeaturesService, client: IDshClientService, selector: LanguageSelector = DSH_INLINE_COMMON_LANGUAGES): Disposable {
	const provider = new DshInlineCompletionsProvider(client);
	const reg = languageFeaturesService.inlineCompletionsProvider.register(selector, provider);
	return new (class extends Disposable { constructor() { super(); this._register(reg); this._register({ dispose: () => provider.disposeInlineCompletions() }); } })();
}

/**
 * 按设置开关行内补全：关闭时根本不注册 provider。
 *
 * 只把 provider 内部判空是不够的——注册着就会参与每次光标移动的能力协商，
 * 而这里要的是「关掉之后完全不产生任何开销」。
 * @param configurationService 读取 `dsh.inlineCompletion.enabled`
 * @param languageFeaturesService 语言能力注册表
 * @param client 唯一通道
 * @returns 可释放句柄；开关变化时自动注册/注销
 */
export function registerDshInlineCompletionsSetting(
	configurationService: IConfigurationService,
	languageFeaturesService: ILanguageFeaturesService,
	client: IDshClientService,
): IDisposable {
	const store = new DisposableStore();
	let current: Disposable | undefined;
	const sync = (): void => {
		const enabled = configurationService.getValue<boolean>(DSH_INLINE_COMPLETION_SETTING) === true;
		if (enabled && current === undefined) {
			current = store.add(registerDshInlineCompletions(languageFeaturesService, client));
			return;
		}
		if (!enabled && current !== undefined) {
			store.delete(current);
			current = undefined;
		}
	};
	sync();
	store.add(configurationService.onDidChangeConfiguration((event: IConfigurationChangeEvent) => {
		if (event.affectsConfiguration(DSH_INLINE_COMPLETION_SETTING)) {
			sync();
		}
	}));
	return store;
}
