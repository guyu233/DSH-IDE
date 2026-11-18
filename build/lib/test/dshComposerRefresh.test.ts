/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 写回之后的 composer 刷新不能采用写前已经发出的回包。
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshComposerRefresh.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DshComposerSource } from '../../../out/vs/workbench/contrib/dsh/browser/dshComposerSource.js';

function composer(model: string) {
	return {
		model: {
			current: { provider: 'p', model },
			groups: [{ id: 'p', models: [{ id: model, name: model }] }],
		},
	};
}

test('a composerState started before a write cannot roll the selection back', async () => {
	let releaseOld: (() => void) | undefined;
	const oldState = new Promise<void>(resolve => { releaseOld = resolve; });
	let composerCalls = 0;
	const client = {
		async call(method: string): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }> {
			if (method === 'setModel') {
				return { ok: true, value: {} };
			}
			if (method !== 'composerState') {
				return { ok: false, error: { code: 'unexpected', message: method } };
			}
			composerCalls += 1;
			if (composerCalls === 1) {
				await oldState;
				return { ok: true, value: composer('old') };
			}
			return { ok: true, value: composer('new') };
		},
	};
	const source = new DshComposerSource(client as never, { trace() { }, warn() { } } as never);
	// 写回与读取都带会话身份：未绑定时两者都必须拒绝发出（read 保旧值、write 跳过）。
	source.setSession('session-1');
	const first = source.refresh();
	const written = source.selectModel('p', 'new');
	releaseOld?.();
	await first;
	await written;
	assert.equal(source.state.current?.model, 'new');
	source.dispose();
});
