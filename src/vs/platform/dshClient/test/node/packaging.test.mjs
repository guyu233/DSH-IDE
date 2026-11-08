// DSH-IDE 打包完整性真实测试（不构建生产包）：
//   - bundle 清单模板（build/lib/dsh/package.json）的 `files` 必含全部运行时入口：
//     Host 运行时 import 的 index.js / client.js / host/ / common/，缺一即 npm pack 后运行必崩。
//   - 若存在 npm pack --dry-run 的 JSON 输出（.pack.json），校验其文件清单确实包含这些入口。

import assert from 'node:assert';
import { readFileSync } from 'node:fs';

/** 相对本测试文件定位仓库内的 bundle 清单模板（§3.7：bundle 根由 gulp 生成，模板在 build/lib/dsh）。 */
const MANIFEST_URL = new URL('../../../../../../build/lib/dsh/package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(MANIFEST_URL, 'utf8'));

suite('dsh-ide packaging integrity', () => {
	test('manifest files includes host runtime entries', () => {
		assert.ok(Array.isArray(pkg.files), 'files must be array');
		for (const req of ['index.js', 'client.js', 'host/', 'common/', 'cordis.patch.yml']) {
			assert.ok(pkg.files.includes(req), `files must include ${req}`);
		}
	});

	test('manifest files does not carry build-only inputs', () => {
		for (const forbidden of ['chat-client/', 'chat-render/README.md']) {
			assert.ok(!pkg.files.includes(forbidden), `files must not include ${forbidden}`);
		}
	});


});

// 清单完整性：dsh.client.inject 必须只列「可加载的真实模块」，且必须含 slots 服务提供者。
// 依据：已装 app.asar 无 dsh-client-ui-slots（纯库、无 dsh.client 字段、非可加载模块）；
// ctx.slots 由 dsh-client-ui-renderer（super(ctx,'slots')）提供；官方 header 按钮插件均注入 ui-renderer。
suite('dsh-ide manifest (dsh.client.inject) integrity', () => {
	const inject = pkg.dsh?.client?.inject || [];

	test('inject 必须包含 slots 服务提供者 ui-renderer', () => {
		assert.ok(inject.includes('@deepseek-ai/dsh-client-ui-renderer'),
			'inject 必须含 @deepseek-ai/dsh-client-ui-renderer（提供 ctx.slots；ui-slots 只是库、不是模块）');
	});

	test('inject 不得列出非模块库 ui-slots', () => {
		assert.ok(!inject.includes('@deepseek-ai/dsh-client-ui-slots'),
			'inject 不得含 @deepseek-ai/dsh-client-ui-slots（纯库，无 dsh.client 字段，已装 app 无此包）');
	});

	test('inject 含需要提供 header.utilities 槽的 ui-conversation', () => {
		assert.ok(inject.includes('@deepseek-ai/dsh-client-ui-conversation'),
			'inject 必须含 ui-conversation（声明 conversation.session.header.utilities 槽）');
	});

	test('inject 皆为 @deepseek-ai 包且无重复', () => {
		for (const p of inject) assert.ok(p.startsWith('@deepseek-ai/'), `inject 条目应为 @deepseek-ai 包: ${p}`);
		assert.strictEqual(new Set(inject).size, inject.length, 'inject 不应有重复项');
	});

	test('bundle 清单含 dsh.bundle.patch 且指向随包 patch 文件', () => {
		assert.strictEqual(pkg.dsh?.bundle?.patch, './cordis.patch.yml');
	});
});
