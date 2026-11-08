/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 单接缝「内容 → DshPartProps」映射的纯逻辑 oracle。
// 与 vscode-1.143.1/src/vs/workbench/contrib/dsh/browser/dshChatSeam.ts 的 toDshPartProps
// 语义一致；因 seam 依赖 VS Code 深层模块无法离线加载，故在此以零依赖纯函数复刻并单测。
// 改动任一处须同步另一处及其单测。

import assert from 'assert';

export const DSH_TOOL_PREFIX = 'dsh-tool:';
export const DSH_STEP_PREFIX = 'dsh-step:';
export const DSH_USAGE_ID = 'dsh-usage';

export type SeamPartProps =
	| { kind: 'reasoning'; text: string; running: boolean }
	| { kind: 'markdown'; blocks: readonly { type: string; text: string }[]; streaming: boolean }
	| { kind: 'running'; label?: string; startTime?: number };

function mdText(v: { value?: string } | string | undefined): string {
	if (v === undefined || v === null) { return ''; }
	return typeof v === 'string' ? v : (v.value ?? '');
}

export function mapContentToDshProps(content: any, isComplete: boolean): SeamPartProps | undefined {
	if (content?.kind === 'thinking') {
		const v = content.value;
		return { kind: 'reasoning', text: Array.isArray(v) ? v.join('') : (v ?? ''), running: !isComplete };
	}
	if (content?.kind === 'markdownContent') {
		return { kind: 'markdown', blocks: [{ type: 'text', text: mdText(content.content) }], streaming: !isComplete };
	}
	if (content?.kind === 'progressMessage') {
		const id = content.id;
		if (id === DSH_USAGE_ID || (typeof id === 'string' && (id.startsWith(DSH_TOOL_PREFIX) || id.startsWith(DSH_STEP_PREFIX)))) {
			return { kind: 'running', label: mdText(content.content) };
		}
		return undefined; // 交回原生
	}
	if (content?.kind === 'working') {
		return { kind: 'running', startTime: typeof content.at === 'number' ? content.at : 0 };
	}
	return undefined; // toolInvocation / references / command / … 一律原生
}

suite('dshChatSeamMap', () => {
	test('thinking → reasoning（流式未完成时 running=true）', () => {
		assert.deepStrictEqual(mapContentToDshProps({ kind: 'thinking', value: ['想', '一想'] }, false),
			{ kind: 'reasoning', text: '想一想', running: true });
		assert.deepStrictEqual(mapContentToDshProps({ kind: 'thinking', value: '完了' }, true),
			{ kind: 'reasoning', text: '完了', running: false });
	});

	test('markdownContent → markdown blocks（正文交 sidecar MarkdownText 渲染）', () => {
		assert.deepStrictEqual(mapContentToDshProps({ kind: 'markdownContent', content: { value: '**粗体**' } }, false),
			{ kind: 'markdown', blocks: [{ type: 'text', text: '**粗体**' }], streaming: true });
	});

	test('DSH 前缀 progressMessage → running', () => {
		for (const id of [DSH_USAGE_ID, DSH_TOOL_PREFIX + 'c1', DSH_STEP_PREFIX + '2:3']) {
			assert.deepStrictEqual(mapContentToDshProps({ kind: 'progressMessage', id, content: { value: '读文件' } }, false),
				{ kind: 'running', label: '读文件' });
		}
	});

	test('非 DSH progressMessage 与其它 kind → undefined（交回原生，尤其工具行）', () => {
		assert.equal(mapContentToDshProps({ kind: 'progressMessage', id: 'other', content: { value: 'x' } }, false), undefined);
		assert.equal(mapContentToDshProps({ kind: 'progressMessage', content: { value: 'x' } }, false), undefined);
		assert.equal(mapContentToDshProps({ kind: 'toolInvocation', toolId: 't' }, false), undefined);
		assert.equal(mapContentToDshProps({ kind: 'references' }, false), undefined);
		assert.equal(mapContentToDshProps({ kind: 'command' }, false), undefined);
		assert.equal(mapContentToDshProps(undefined, false), undefined);
	});

	test('working → running', () => {
		assert.deepStrictEqual(mapContentToDshProps({ kind: 'working', at: 123 }, false), { kind: 'running', startTime: 123 });
	});

	test('IMarkdownString.value 缺失 / 字符串内容 → 空文本不抛', () => {
		assert.deepStrictEqual(mapContentToDshProps({ kind: 'markdownContent', content: {} }, true),
			{ kind: 'markdown', blocks: [{ type: 'text', text: '' }], streaming: false });
		assert.deepStrictEqual(mapContentToDshProps({ kind: 'markdownContent', content: 'plain' }, true),
			{ kind: 'markdown', blocks: [{ type: 'text', text: 'plain' }], streaming: false });
	});

});
