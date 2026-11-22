/**
 * 兼容入口：单独 `--import build/lib/test/strip-ts-resolver.mjs` 时注册解析钩子。
 *
 * `test-dsh:all` 统一把本文件作为 `--import` 传入；单独跑某个直接链到
 * `src/vs/**` 的测试文件时也需要同样传入，否则 Node 解析不到 `.js` 说明符。
 */
import { register } from 'node:module';

register('./strip-ts-hooks.mjs', import.meta.url);
