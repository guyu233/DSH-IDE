/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// DSH 内联补全（InlineCompletionItemProvider）。
//
// 后端通过私有管道 callA('session.inlineComplete', ...) 请 DSH 产出补全文本。
// 若 Host 未提供该方法（unknown method）或超时，则优雅降级为「无补全」，不打断编辑体验。

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import { InlineCompletion, InlineCompletions, InlineCompletionContext, InlineCompletionsProvider, ProviderResult } from '../../../../editor/common/languages.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import type { LanguageSelector } from '../../../../editor/common/languageSelector.js';
import type { ITextModel } from '../../../../editor/common/model.js';
import { IDshChatClient } from '../../../../platform/dshPipe/common/dshChatClient.js';

/** 常见语言：默认注册这些语言的内联补全。 */
export const DSH_INLINE_COMMON_LANGUAGES: LanguageSelector = [
	'typescript', 'typescriptreact', 'javascript', 'javascriptreact',
	'python', 'go', 'rust', 'java', 'c', 'cpp', 'csharp', 'php', 'ruby',
	'html', 'css', 'scss', 'json', 'yaml', 'markdown', 'shellscript', 'sql',
];

/** 结果文本上限，避免超长插入。 */
const MAX_PREFIX_CHARS = 4000;

/** DSH 后端内联补全提供器。 */
export class DshInlineCompletionsProvider implements InlineCompletionsProvider<InlineCompletions<InlineCompletion>> {

	constructor(private readonly client: IDshChatClient) { }

	async provideInlineCompletions(model: ITextModel, position: Position, _context: InlineCompletionContext, token: CancellationToken): Promise<InlineCompletions<InlineCompletion> | undefined> {
		if (token.isCancellationRequested) { return undefined; }

		const prefix = model.getValueInRange(new Range(1, 1, position.lineNumber, position.column)).slice(-MAX_PREFIX_CHARS);
		const lastLineLength = model.getLineLength(position.lineNumber);
		const suffix = model.getValueInRange(new Range(position.lineNumber, position.column, position.lineNumber, lastLineLength + 1));

		let result: { text?: string; insertText?: string } | undefined;
		try {
			result = await this.withTimeout(
				this.client.callA<{ text?: string; insertText?: string }>('session.inlineComplete', {
					path: model.uri.fsPath,
					languageId: model.getLanguageId(),
					prefix,
					suffix,
					lineNumber: position.lineNumber,
					column: position.column,
				}),
				2500,
			);
		} catch {
			// unknown method / 超时 / 连接失败：优雅降级
			return undefined;
		}

		const text = result?.text ?? result?.insertText;
		if (!text || typeof text !== 'string' || text.length === 0) { return undefined; }

		const item: InlineCompletion = {
			insertText: text,
			range: new Range(position.lineNumber, position.column, position.lineNumber, position.column),
			completeBracketPairs: true,
		};
		return { items: [item] };
	}

	disposeInlineCompletions(): void { /* 无资源需释放 */ }

	private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('dsh inlineComplete timeout')), ms);
			p.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
		});
	}
}

/** 注册内联补全提供器；返回可释放句柄。 */
export function registerDshInlineCompletions(languageFeaturesService: ILanguageFeaturesService, client: IDshChatClient, selector: LanguageSelector = DSH_INLINE_COMMON_LANGUAGES): Disposable {
	const provider = new DshInlineCompletionsProvider(client);
	const reg = languageFeaturesService.inlineCompletionsProvider.register(selector, provider);
	return new (class extends Disposable {
		constructor() { super(); this._register(reg); this._register({ dispose: () => provider.disposeInlineCompletions() }); }
	})();
}
