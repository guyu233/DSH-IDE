/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 组件层可离线验证的部分：本地结构守卫 + 两个真值的绑定。
//
// 为什么这里不测 DOM：VS Code 的 `base/browser/dom.js` 在模块顶层依赖真实
// `window.location`，纯 Node 桩无法可靠模拟；DOM 渲染的正确性由真机验证（用户执行，
// 按 §6 不由 AI 代跑）。本文件覆盖的是"渲染前置条件"——数据能否被安全、无损地读出。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	asArray, asBoolean, asNumber, asString, asStringOrNull, dataOf, isRecord, jsonText,
} from '../../../out/vs/workbench/contrib/chat/browser/widget/chatContentParts/dsh/dshNodeTypes.js';

test('isRecord: 只接受普通对象', () => {
	assert.equal(isRecord({}), true);
	assert.equal(isRecord([]), false);
	assert.equal(isRecord(null), false);
	assert.equal(isRecord('x'), false);
	assert.equal(isRecord(1), false);
});

test('asString: 保留空串，拒绝非字符串', () => {
	assert.equal(asString(''), '');
	assert.equal(asString('a'), 'a');
	assert.equal(asString(1), undefined);
	assert.equal(asString(null), undefined);
});

test('asStringOrNull: 区分 null 与缺失', () => {
	assert.equal(asStringOrNull(null), null, 'null 是真实值，必须保留');
	assert.equal(asStringOrNull(''), '');
	assert.equal(asStringOrNull('a'), 'a');
	assert.equal(asStringOrNull(undefined), undefined);
	assert.equal(asStringOrNull(1), undefined);
});

test('asNumber: 拒绝 NaN / Infinity（不是有效数值）', () => {
	assert.equal(asNumber(0), 0);
	assert.equal(asNumber(-1), -1);
	assert.equal(asNumber(NaN), undefined);
	assert.equal(asNumber(Infinity), undefined);
	assert.equal(asNumber('1'), undefined);
});

test('asBoolean: 只接受 true/false', () => {
	assert.equal(asBoolean(true), true);
	assert.equal(asBoolean(false), false);
	assert.equal(asBoolean(0), undefined);
	assert.equal(asBoolean('true'), undefined);
});

test('asArray: 只接受数组', () => {
	assert.deepEqual(asArray([1, 2]), [1, 2]);
	assert.deepEqual(asArray([]), []);
	assert.equal(asArray({}), undefined);
	assert.equal(asArray('ab'), undefined);
});

test('dataOf: 取事件信封的 data 层', () => {
	assert.deepEqual(dataOf({ seq: 1, type: 'x', data: { a: 1 } }), { a: 1 });
	assert.equal(dataOf({ seq: 1 }), undefined);
	assert.equal(dataOf(null), undefined);
});

test('jsonText: null/undefined 保留真实语义，不伪造空串或 0', () => {
	assert.equal(jsonText(null), 'null');
	assert.equal(jsonText(undefined), 'undefined');
	assert.equal(jsonText(''), '');
	assert.equal(jsonText(0), '0');
	assert.equal(jsonText(false), 'false');
	assert.equal(jsonText({ a: 1 }), '{\n  "a": 1\n}');
});

test('jsonText: 不可序列化的值不抛异常', () => {
	const circular: Record<string, unknown> = {};
	circular['self'] = circular;
	assert.doesNotThrow(() => jsonText(circular));
});
