/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 认证材料脱敏（§8.8.7）：launchUrl 带一次性 token，换取 cookie 后仍是凭据，
// 不能出现在日志、遥测、错误消息或堆栈里。
// 运行：node --experimental-strip-types --test --test-force-exit build/lib/test/dshIdeAuthRedaction.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactAuthMaterial, safeErrorText } from '../../../src/vs/platform/dshClient/protocol/dshIdeAuthRedaction.js';

/** 断言输出里不残留任何一个凭据片段。 */
function assertNoLeak(input: string, secrets: readonly string[]): void {
	const out = redactAuthMaterial(input);
	for (const secret of secrets) {
		assert.ok(!out.includes(secret), `redacted output must not contain ${secret}: ${out}`);
	}
}

test('a token in a URL query never survives redaction', () => {
	assertNoLeak('open http://127.0.0.1:61623/?token=SECRET123 failed', ['SECRET123']);
	assertNoLeak('GET https://host/path?a=1&token=ABC#frag', ['ABC']);
});

test('key=value credential forms are replaced wholesale', () => {
	assertNoLeak('launchUrl=http://x/?token=T', ['token=T']);
	assertNoLeak('cookie: session=XYZ', ['XYZ']);
});

test('an Authorization header keeps the scheme but loses the credential', () => {
	// 这条曾经漏过：`Authorization` 这个 key 被换成 [redacted] 后，
	// 紧跟的 `Bearer xxx` 就认不出来了，凭据本体留在输出里。
	// 上游 fetch/undici 的错误消息里可能出现这种 header 文本。
	assertNoLeak('Authorization: Bearer abc.def.ghi', ['abc.def.ghi']);
	assertNoLeak('Authorization: Basic dXNlcjpwYXNz', ['dXNlcjpwYXNz']);
	assertNoLeak('header bearer eyJhbGciOiJIUzI1NiJ9.payload.sig', ['eyJhbGciOiJIUzI1NiJ9.payload.sig']);
});

test('text without credentials is left untouched', () => {
	const plain = 'plain message without secrets';
	assert.equal(redactAuthMaterial(plain), plain);
});

test('safeErrorText only projects the message, never the object or a stack', () => {
	assert.equal(safeErrorText(null), 'unknown error');
	assert.equal(safeErrorText(undefined), 'unknown error');
	const text = safeErrorText({ message: 'boom http://h/?token=S' });
	assert.ok(!text.includes('S'), `safeErrorText must redact: ${text}`);
	assert.ok(!text.includes('[object Object]'), 'safeErrorText must not stringify the object');
});

test('a userinfo credential inside a URL is redacted too', () => {
	// `http://user:pass@host/` 里的 user:pass 同样是凭据。
	assertNoLeak('http://user:pass123@host/path', ['pass123']);
	assertNoLeak('http://user:pass123@host/path?token=T', ['pass123', 'token=T']);
});

test('credential key variants are all covered', () => {
	// 键名不能只认字面 token：真实配置里是 access_token / launchToken / apiKey / x-api-key。
	assertNoLeak('x-api-key: sk-abcdef123456', ['sk-abcdef123456']);
	assertNoLeak('apiKey=sk-abcdef123456', ['sk-abcdef123456']);
	assertNoLeak('?access_token=AT123', ['AT123']);
	assertNoLeak('?launchToken=LT123', ['LT123']);
	assertNoLeak('Set-Cookie: sid=abc123; Path=/', ['abc123']);
});

test('ordinary diagnostics survive redaction unchanged', () => {
	// 脱敏不能把排查问题需要的信息一起抹掉：路径、端口、错误码都要留着。
	for (const text of [
		'ENOENT: no such file or directory, open E:/DSH-IDE/src/x.ts',
		'connect ECONNREFUSED 127.0.0.1:61623',
		'DSH 会话列表没有加载：gateway/internal',
		'http://127.0.0.1:61623/path/to/file.js',
		'token expired at 12:30',
		'password field is required',
	]) {
		assert.equal(redactAuthMaterial(text), text, `must not touch: ${text}`);
	}
});

test('a URL query is dropped wholesale, even without credentials', () => {
	// 宁可多抹：`?q=search` 丢掉不影响排查，漏掉 `?token=` 是事故。
	assert.equal(redactAuthMaterial('https://example.com/a/b?q=search'), 'https://example.com/a/b');
});
