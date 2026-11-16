/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { IMarkdownRenderer } from '../../../../../../../platform/markdown/browser/markdownRenderer.js';
import { DshNodeViewInput, IDshNodeView, asArray, asBoolean, asNumber, asRecordAt, asString, isRecord, jsonText } from './dshNodeTypes.js';
import { createBadge, createCard, createDisclosure, createField, createTitleRow, renderMarkdown } from './dshViewParts.js';

/**
 * `tool-call` / `tool-result` 视图（递归 subCalls）。
 *
 * 覆盖 callId / parentCallId / name / phase / argsRaw / args / call / callTime /
 * content[] / isError / error / meta / subCalls[] / turn / step。
 */
export class DshToolView implements IDshNodeView {
	readonly domNode: HTMLElement;

	constructor(input: DshNodeViewInput, renderer: IMarkdownRenderer, stores: DisposableStore) {
		this.domNode = this._renderNode(input, renderer, stores, 0);
	}

	private _renderNode(input: DshNodeViewInput, renderer: IMarkdownRenderer, stores: DisposableStore, depth: number): HTMLElement {
		const node = input.parsed;
		const isResult = input.kind === 'tool-result' || (isRecord(node) && node['content'] !== undefined);
		const isError = asBoolean(readValue(node, 'isError')) === true;

		const card = createCard(isError ? 'error' : 'default');
		card.classList.add('chat-dsh-tool');
		card.setAttribute('data-dsh-tool-depth', String(depth));

		const name = asString(readValue(node, 'name')) ?? asString(readValue(node, 'callId')) ?? 'tool';
		const titleRow = createTitleRow(Codicon.tools, name);
		const phase = asString(readValue(node, 'phase'));
		titleRow.appendChild(createBadge(isResult ? 'result' : (phase ?? 'call'), isError ? 'error' : 'default'));
		card.appendChild(titleRow);

		// 身份与父子关系：必须可追溯。
		const meta = dom.append(card, dom.$('.chat-dsh-tool-meta'));
		for (const key of ['callId', 'parentCallId', 'turn', 'step', 'callTime']) {
			const value = readValue(node, key);
			if (value !== undefined) {
				meta.appendChild(createField(key, value));
			}
		}

		// 参数区可折叠。
		const argsRaw = asString(readValue(node, 'argsRaw'));
		const args = readValue(node, 'args');
		const call = asRecordAt(node, 'call');
		if (argsRaw !== undefined || args !== undefined || call !== undefined) {
			const { root, body } = createDisclosure(stores, 'arguments', Codicon.code);
			if (argsRaw !== undefined) {
				body.appendChild(createField('argsRaw', argsRaw));
			}
			if (args !== undefined) {
				body.appendChild(createField('args', args));
			}
			if (call !== undefined) {
				body.appendChild(createField('call', call));
			}
			card.appendChild(root);
		}

		// 结果内容。
		const content = asArray(readValue(node, 'content'));
		if (content !== undefined && content.length > 0) {
			const { root, body } = createDisclosure(stores, 'content', Codicon.output);
			for (const block of content) {
				body.appendChild(this._renderContentBlock(block, renderer, stores));
			}
			card.appendChild(root);
		}

		// 错误码与 reason 必须显示。
		const error = asRecordAt(node, 'error');
		if (error !== undefined) {
			const box = dom.append(card, dom.$('.chat-dsh-tool-error'));
			box.appendChild(createField('error.name', error['name']));
			box.appendChild(createField('error.code', error['code']));
			box.appendChild(createField('error.reason', error['reason']));
		}

		const metaValue = readValue(node, 'meta');
		if (metaValue !== undefined) {
			const { root, body } = createDisclosure(stores, 'meta', Codicon.json);
			body.appendChild(createField('meta', metaValue));
			card.appendChild(root);
		}

		// 递归子调用：保持层级缩进，不摊平、不省略。
		const subCalls = asArray(readValue(node, 'subCalls'));
		if (subCalls !== undefined && subCalls.length > 0) {
			const box = dom.append(card, dom.$('.chat-dsh-subcalls'));
			for (const child of subCalls) {
				if (!isRecord(child)) {
					box.appendChild(createField('subCall', child));
					continue;
				}
				const childInput: DshNodeViewInput = {
					...input,
					parsed: child,
					kind: child['content'] !== undefined ? 'tool-result' : 'tool-call',
				};
				box.appendChild(this._renderNode(childInput, renderer, stores, depth + 1));
			}
		}

		return card;
	}

	private _renderContentBlock(block: unknown, renderer: IMarkdownRenderer, stores: DisposableStore): HTMLElement {
		if (!isRecord(block)) {
			return createField('block', block);
		}
		if (asString(block['type']) === 'text') {
			const text = asString(block['text']);
			return text === undefined ? createField('text', block) : renderMarkdown(stores, renderer, text);
		}
		return createField(asString(block['type']) ?? 'block', block);
	}
}

/** tool 节点的字段分散在 data 与 data.message 两处，两处都读。 */
function readValue(node: unknown, key: string): unknown {
	if (!isRecord(node)) {
		return undefined;
	}
	const data = isRecord(node['data']) ? node['data'] : undefined;
	if (data !== undefined) {
		if (key in data) {
			return data[key];
		}
		const message = isRecord(data['message']) ? data['message'] : undefined;
		if (message !== undefined && key in message) {
			return message[key];
		}
	}
	return key in node ? node[key] : undefined;
}

void asNumber;
void asString;
void jsonText;
