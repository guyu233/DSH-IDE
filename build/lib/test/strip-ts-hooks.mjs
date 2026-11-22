/**
 * Node ESM 解析钩子：把 `src/vs/**` 里的 `.js` 说明符解析到旁边的同名 `.ts`。
 *
 * 为什么需要：源码按 VS Code 约定写 `.js` 说明符（编译后同一目录就是 `.js`），
 * 而 Node 的 `--experimental-strip-types` 只剥离类型、不改写说明符。没有这一层，
 * `node --test build/lib/test/dshXxx.test.ts` 只要链到工作台代码就会
 * `ERR_MODULE_NOT_FOUND: .../dshConversationNodeTree.js`。
 *
 * 只做这一件事，不参与任何业务判断。此前 `test-dsh:all` 的命令行没有带
 * `--import`，直接链到 `src/vs/**` 的测试只能靠预编译的 `out/` 才能跑，
 * 于是门禁结果取决于 `out/` 是不是旧的。现在 `test-dsh:all` 统一带
 * `--import ./build/lib/test/strip-ts-resolver.mjs`，`out/` 只由 `test-dsh`
 * 的预编译步骤负责生成。
 */
import { accessSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function resolve(specifier, context, nextResolve) {
	if (specifier.endsWith('.js') && context.parentURL !== undefined && context.parentURL.includes('/src/vs/')) {
		const tsUrl = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
		try {
			accessSync(fileURLToPath(tsUrl));
			return nextResolve(tsUrl.href, context);
		} catch {
			// 旁边没有同名 ts，按原说明符继续。
		}
	}
	return nextResolve(specifier, context);
}
