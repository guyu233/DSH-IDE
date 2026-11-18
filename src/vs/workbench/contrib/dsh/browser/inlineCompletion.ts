/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH 行内补全（InlineCompletionItemProvider，v2 官方传输）。
//
// 后端经官方客户端调 Host 的 @Remote IDE 服务：IDshClientService.call('ide/inlineComplete', {...})
// （走官方 /api，由 dsh-ide 的 IdeRemoteService 提供，后端 DSH）。Host 未实现/超时则优雅降级为「无补全」。

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import { InlineCompletion, InlineCompletions, InlineCompletionContext, InlineCompletionsProvider } from '../../../../editor/common/languages.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import type { LanguageSelector } from '../../../../editor/common/languageSelector.js';
import type { ITextModel } from '../../../../editor/common/model.js';
import { IDshClientService } from '../../../../platform/dshClient/common/dshClientService.js';

export const DSH_INLINE_COMMON_LANGUAGES: LanguageSelector = [
	'typescript', 'typescriptreact', 'javascript', 'javascriptreact',
	'python', 'go', 'rust', 'java', 'c', 'cpp', 'csharp', 'php', 'ruby',
	'html', 'css', 'scss', 'json', 'yaml', 'markdown', 'shellscript', 'sql',
];

const MAX_PREFIX_CHARS = 4000;

export class DshInlineCompletionsProvider implements InlineCompletionsProvider<InlineCompletions<InlineCompletion>> {

	constructor(private readonly client: IDshClientService) { }

	async provideInlineCompletions(model: ITextModel, position: Position, _context: InlineCompletionContext, token: CancellationToken): Promise<InlineCompletions<InlineCompletion> | undefined> {
		if (token.isCancellationRequested) { return undefined; }
		const prefix = model.getValueInRange(new Range(1, 1, position.lineNumber, position.column)).slice(-MAX_PREFIX_CHARS);
		const lastLineLength = model.getLineLength(position.lineNumber);
		const suffix = model.getValueInRange(new Range(position.lineNumber, position.column, position.lineNumber, lastLineLength + 1));

		let res;
		try {
			res = await this.withTimeout(this.client.call<{ text?: string }>('ide/inlineComplete', {
				prefix, suffix, languageId: model.getLanguageId(), path: model.uri.fsPath,
			}), 2500);
		} catch { return undefined; }
		if (!res || res.ok !== true) { return undefined; }
		const text = res.value?.text;
		if (!text || typeof text !== 'string' || text.length === 0) { return undefined; }
		const item: InlineCompletion = { insertText: text, range: new Range(position.lineNumber, position.column, position.lineNumber, position.column), completeBracketPairs: true };
		return { items: [item] };
	}

	disposeInlineCompletions(): void { /* no resources */ }

	private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
		return new Promise<T>((resolve, reject) => { const t = setTimeout(() => reject(new Error('dsh inlineComplete timeout')), ms); p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); }); });
	}
}

/**
 * 行内补全当前**不可用**，这里显式登记原因而不是假装接上。
 *
 * 事实：provider 调用的是 `ide/inlineComplete`，而 `ide/inlineComplete` 不在唯一通道的
 * 方法白名单（`DSH_IDE_VIEW_BOUND_METHODS`）里。Host 侧登记了同名 @Remote 能力，
 * 但 renderer 侧调用会被契约校验拒绝——**注册了不等于可达**。
 * 与其让用户看到一个永远不出结果的补全，不如不注册，并把原因说清楚。
 *
 * 恢复条件（三项同时满足才允许接线）：① 该 method 进入唯一契约白名单并通过
 * `validateDshIdeInput`；② 明确启用条件与文本最小化策略（不默认上传整个缓冲区）；
 * ③ 取消语义与测试就位。**不得**为此另开旁路通道。
 */
export const DSH_INLINE_COMPLETION_UNAVAILABLE_REASON =
	'DSH 行内补全暂不可用：`ide/inlineComplete` 尚未纳入唯一通道方法白名单。';

export function registerDshInlineCompletions(languageFeaturesService: ILanguageFeaturesService, client: IDshClientService, selector: LanguageSelector = DSH_INLINE_COMMON_LANGUAGES): Disposable {
	const provider = new DshInlineCompletionsProvider(client);
	const reg = languageFeaturesService.inlineCompletionsProvider.register(selector, provider);
	return new (class extends Disposable { constructor() { super(); this._register(reg); this._register({ dispose: () => provider.disposeInlineCompletions() }); } })();
}
