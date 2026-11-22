/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 配额通知：缺省不覆盖，旧序号不覆盖。
// 运行：node --experimental-strip-types --test build/lib/test/dshQuotaNotice.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retainQuotaNotice } from '../../../src/vs/workbench/contrib/dsh/browser/vscode/dshQuotaNotice.ts';

const current = { code: 'QUOTA' as const, seq: 5, message: '先到' };

test('a frame that omits the notice keeps the one already shown', () => {
	assert.equal(retainQuotaNotice(current, undefined), current);
	assert.equal(retainQuotaNotice(undefined, undefined), undefined);
});

test('an older seq does not replace a newer notice', () => {
	const older = { code: 'ACCOUNT_QUOTA' as const, seq: 4 };
	assert.equal(retainQuotaNotice(current, older), current);
	const newer = { code: 'ACCOUNT_QUOTA' as const, seq: 6, message: '后到' };
	assert.equal(retainQuotaNotice(current, newer), newer);
	assert.equal(retainQuotaNotice(undefined, newer), newer);
});
