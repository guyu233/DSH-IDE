/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// 并发开窗的回归测试。
//
// 背景：`spawnIdeProcess` 的防抖只看 `ideChild`，而真正 `spawn` 之前有一段 await
// （物化 Electron 主页、解析 ripgrep / node-pty、预取 composerState）。这段时间里
// `ideChild` 仍是 undefined，两个并发点击会各自通过防抖、各拉起一个窗口。
//
// 这里只测「合流」这一层的语义：用假对象复刻 `launchInFlight` 的登记/复用/清理，
// 不引入真实 spawn，也不需要 Electron。

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

/** 复刻 ide-service 中 spawnIdeProcess 的合流骨架（与被测实现保持同构）。 */
class LaunchGate {
	constructor() {
		this.launchInFlight = undefined;
		this.spawnCalls = 0;
	}

	async spawnIdeProcess(work) {
		if (this.launchInFlight !== undefined) {
			return this.launchInFlight;
		}
		const inFlight = this.runOnce(work);
		this.launchInFlight = inFlight;
		try {
			return await inFlight;
		} finally {
			if (this.launchInFlight === inFlight) {
				this.launchInFlight = undefined;
			}
		}
	}

	async runOnce(work) {
		this.spawnCalls += 1;
		return work();
	}
}

test('two concurrent launches share one spawn', async () => {
	const gate = new LaunchGate();
	let release;
	const blocked = new Promise(resolve => { release = resolve; });
	const work = async () => {
		await blocked;
		return { ok: true, via: 'spawned-ide' };
	};

	const first = gate.spawnIdeProcess(work);
	const second = gate.spawnIdeProcess(work);
	assert.equal(gate.spawnCalls, 1, 'only one spawn may start');
	release();
	const [a, b] = await Promise.all([first, second]);
	assert.deepEqual(a, { ok: true, via: 'spawned-ide' });
	assert.equal(a, b, 'both callers observe the same result');
});

test('a failed launch releases the gate so the next click retries', async () => {
	const gate = new LaunchGate();
	const failing = async () => { throw new Error('spawn failed'); };
	await assert.rejects(() => gate.spawnIdeProcess(failing), /spawn failed/);
	assert.equal(gate.launchInFlight, undefined, 'the gate must be released after a failure');

	const ok = await gate.spawnIdeProcess(async () => ({ ok: true }));
	assert.deepEqual(ok, { ok: true });
	assert.equal(gate.spawnCalls, 2, 'the retry must actually spawn again');
});

test('sequential launches each spawn exactly once', async () => {
	const gate = new LaunchGate();
	await gate.spawnIdeProcess(async () => ({ ok: true }));
	await gate.spawnIdeProcess(async () => ({ ok: true }));
	assert.equal(gate.spawnCalls, 2, 'no cross-request coalescing after the first settles');
});

test('the real ide-service keeps the launch coalescing skeleton', async () => {
	// 上面三条用例测的是**复刻**的 LaunchGate；复刻一旦与被测实现走样，
	// 测试会继续绿而真实代码已经退化。这条直接读真实 `ide-service.js` 复核骨架。
	//
	// 为什么读源码而不是 import：`out/` 里的 `ide-service.js` 会
	// `import '@deepseek-ai/cordis'`，该包由 DSH Host 在运行时提供、仓库里没有，
	// 直接 import 必然失败。此前这里用 `catch { return }` 静默跳过——那会让测试
	// 永远「通过」却什么都没验（假绿），所以改成文本断言。
	const source = readFileSync(new URL('../../host/ide-service.js', import.meta.url), 'utf8');
	assert.match(source, /if \(this\.launchInFlight !== undefined\) \{\s*\n\s*return this\.launchInFlight;/, 'launch must reuse the in-flight promise');
	assert.match(source, /this\.launchInFlight = inFlight;/, 'launch must register the in-flight promise');
	assert.match(source, /if \(this\.launchInFlight === inFlight\) \{\s*\n\s*this\.launchInFlight = undefined;/, 'launch must clear the in-flight promise');
	// `launch()` 必须先 `_requireTrustedCaller` 再校验参数：顺序反了会让不可信主体拿到参数错误码。
	const launchBody = source.slice(source.indexOf('async launch(workspace, sessionId)'), source.indexOf('async launch(workspace, sessionId)') + 2000);
	assert.ok(launchBody.indexOf('_requireTrustedCaller') < launchBody.indexOf('must be a string when provided'), 'trust must be checked before argument shape');
	// 排队返回必须**每一条**都如实标注 `opened: false`：把「已排队」说成「已开窗」
	// 会让界面显示成功却没有窗口。`launch()` 有两条成功路径（已报到 / 新拉起），
	// 只断言「存在一处」会漏掉另一处——这里要求两者都在且数量吻合。
	const queuedReturns = launchBody.match(/return \{ ok: true,[^}]*\};/g) ?? [];
	assert.equal(queuedReturns.length, 2, 'launch() must have exactly two success paths');
	for (const line of queuedReturns) {
		assert.match(line, /opened: false/, `a queued launch must not claim the window is open: ${line}`);
		assert.match(line, /queued: true/, `a queued launch must say it is queued: ${line}`);
	}
});
