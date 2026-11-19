/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { dedupeExtensionOutputs, DEDUPE_GROUPS, type IDedupeGroup } from '../../../build/lib/dsh/dedupeExtensionOutputs.ts';

/** 夹具用的目录组（真实组指向 mermaid 扩展）。 */
const GROUP: readonly IDedupeGroup[] = [{ keep: 'markdown-preview-out', drop: ['notebook-out'] }];

/** 造一个「两个输出目录、只有入口不同」的夹具。 */
function fixture(t: import('node:test').TestContext) {
	const root = mkdtempSync(join(tmpdir(), 'dsh-dedupe-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const keep = join(root, 'ext', 'markdown-preview-out');
	const drop = join(root, 'ext', 'notebook-out');
	mkdirSync(keep, { recursive: true });
	mkdirSync(drop, { recursive: true });
	writeFileSync(join(keep, 'chunk-A.js'), 'export const shared = 1;');
	writeFileSync(join(drop, 'chunk-A.js'), 'export const shared = 1;');
	writeFileSync(join(keep, 'logos.js'), 'x'.repeat(1024));
	writeFileSync(join(drop, 'logos.js'), 'x'.repeat(1024));
	writeFileSync(join(keep, 'index.js'), 'import "./chunk-A.js"; console.log("preview");');
	writeFileSync(join(drop, 'index.js'), 'import "./chunk-A.js"; import "./logos.js"; console.log("notebook");');
	return { root, keep, drop };
}

test('removes byte-identical files and rewrites the entry to the kept directory', t => {
	const { root, drop } = fixture(t);
	const result = dedupeExtensionOutputs(join(root, 'ext'), GROUP);
	// chunk-A.js 与 logos.js 各一份被删；两个 index.js 内容不同，不删。
	assert.equal(result.removed, 2);
	assert.ok(result.freedBytes >= 1024);
	const entry = readFileSync(join(drop, 'index.js'), 'utf8');
	assert.match(entry, /import "\.\.\/markdown-preview-out\/chunk-A\.js"/, 'chunk import must point at the kept directory');
	assert.match(entry, /import "\.\.\/markdown-preview-out\/logos\.js"/, 'asset import must point at the kept directory');
	assert.match(entry, /console\.log\("notebook"\)/, 'entry body must be preserved');
});

test('keeps files whose contents differ', t => {
	const { root, drop } = fixture(t);
	writeFileSync(join(drop, 'chunk-A.js'), 'export const shared = 2;');
	dedupeExtensionOutputs(join(root, 'ext'), GROUP);
	assert.match(readFileSync(join(drop, 'chunk-A.js'), 'utf8'), /shared = 2/, 'differing file must survive');
	assert.match(readFileSync(join(drop, 'index.js'), 'utf8'), /import "\.\/chunk-A\.js"/, 'unmatched import must be left alone');
});

test('is idempotent and tolerates a missing drop directory', t => {
	const { root, drop } = fixture(t);
	dedupeExtensionOutputs(join(root, 'ext'), GROUP);
	const second = dedupeExtensionOutputs(join(root, 'ext'), GROUP);
	assert.equal(second.removed, 0, 'second pass must be a no-op');
	rmSync(drop, { recursive: true, force: true });
	assert.doesNotThrow(() => dedupeExtensionOutputs(join(root, 'ext'), GROUP));
});

test('the real group targets mermaid preview and notebook outputs', () => {
	assert.equal(DEDUPE_GROUPS.length, 1);
	assert.ok(DEDUPE_GROUPS[0].keep.endsWith(join('mermaid-markdown-features', 'markdown-preview-out')));
	assert.ok(DEDUPE_GROUPS[0].drop[0].endsWith(join('mermaid-markdown-features', 'notebook-out')));
});
