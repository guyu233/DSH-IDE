/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'node:child_process';
import * as crypto from 'node:crypto';
import fs from 'node:fs';
import * as path from 'node:path';

/** Repository-relative source inputs used by the DSH desktop and bundle build. */
// 仓库已扁平化（README §1）：仓库根即项目根，路径不带 `vscode-1.143.1/` 前缀。
export const DSH_BUILD_INPUT_PATHS = [
	'src', 'build', 'extensions',
	'resources', 'remote',
	'package.json', 'package-lock.json',
	'product.json', 'gulpfile.mjs',
	'LICENSE.txt', 'ThirdPartyNotices.txt',
	// DSH-IDE 输入：bundle 清单模板在 build/lib/dsh/，图标与 NLS 在 resources/dsh/，
	// 渲染 sidecar 在 build/dsh/chat-render/，Host/客户端半身在 src/vs/platform/dshClient/（已被上行 src 覆盖）。
	'build/lib/dsh', 'build/dsh',
	'resources/dsh',
] as const;

const excludedNames = /(?:^|\/)(?:node_modules|\.git|\.build|\.dsh-build|dist|out(?:-[^/]*)?|\.env(?:\..*)?|\.npmrc|\.pypirc|credentials?(?:\..*)?|secrets?(?:\..*)?|id_rsa|id_ed25519|[^/]*(?:private[-_.]?key|secret|credential)[^/]*|[^/]*\.(?:pem|key|p12|pfx))(?=\/|$)/i;
const gitExcludes = [
	':(exclude,glob)**/node_modules/**', ':(exclude,glob)**/.git/**',
	':(exclude,glob)**/.build/**', ':(exclude,glob)**/.dsh-build/**',
	':(exclude,glob)**/dist/**', ':(exclude,glob)**/out/**',
	':(exclude,glob)**/out-*/**',
	':(exclude,glob)**/.env', ':(exclude,glob)**/.env.*',
	':(exclude,glob)**/.npmrc', ':(exclude,glob)**/.pypirc',
	':(exclude,glob)**/*private*key*', ':(exclude,glob)**/*secret*',
	':(exclude,glob)**/*credential*', ':(exclude,glob)**/*.pem',
	':(exclude,glob)**/*.key', ':(exclude,glob)**/*.p12', ':(exclude,glob)**/*.pfx',
	':(exclude,glob)**/id_rsa', ':(exclude,glob)**/id_ed25519',
];

export interface DshBuildProvenance {
	readonly repositoryHead: string;
	readonly sourceCommit: string;
	readonly dirty: boolean;
	readonly workingTreeDigest: string;
	readonly inputScope: readonly string[];
	readonly excludedPathPolicy: string;
}

/** Fingerprint only explicitly scoped, non-secret source inputs; no source contents are written to the manifest. */
export function captureDshBuildProvenance(cwd: string, requestedCommit?: string, inputPaths: readonly string[] = DSH_BUILD_INPUT_PATHS): DshBuildProvenance {
	const git = (...args: string[]): Buffer => cp.execFileSync('git', args, { cwd, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
	const top = git('rev-parse', '--show-toplevel').toString('utf8').trim();
	const head = git('rev-parse', '--verify', 'HEAD^{commit}').toString('utf8').trim();
	const candidate = requestedCommit === undefined ? head : requestedCommit.trim();
	if (!/^[0-9a-f]{40}$/i.test(candidate)) {
		throw new Error('BUILD_SOURCEVERSION must be a full 40-character Git commit ID.');
	}
	const sourceCommit = git('rev-parse', '--verify', `${candidate}^{commit}`).toString('utf8').trim();
	if (sourceCommit.toLowerCase() !== candidate.toLowerCase()) {
		throw new Error('BUILD_SOURCEVERSION must identify a commit object directly.');
	}
	if (inputPaths.length === 0 || inputPaths.some(value => !value || path.isAbsolute(value) || value.split('/').includes('..') || value.startsWith(':'))) {
		throw new Error('DSH build input scope must contain safe repository-relative paths.');
	}
	const args = [...inputPaths, ...gitExcludes];
	const status = git('-C', top, '-c', 'status.renames=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none', '--', ...args)
		.toString('utf8').split('\0').filter(record => record && !excludedNames.test(record.slice(3).replaceAll('\\', '/')));
	const indexEntries = git('-C', top, 'ls-files', '-s', '-z', '--', ...args).toString('utf8').split('\0').filter(Boolean)
		.filter(record => !excludedNames.test(record.slice(record.indexOf('\t') + 1).replaceAll('\\', '/')));
	if (indexEntries.some(record => record.startsWith('160000 '))) {
		throw new Error('A scoped submodule input requires explicit audit.');
	}
	const listed = git('-C', top, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...args);
	const hash = crypto.createHash('sha256').update(status.join('\0')).update('\0').update(indexEntries.join('\0'));
	for (const relative of [...new Set(listed.toString('utf8').split('\0').filter(Boolean))].sort()) {
		if (excludedNames.test(relative.replaceAll('\\', '/'))) {
			continue;
		}
		const absolute = path.join(top, relative);
		hash.update(`${Buffer.byteLength(relative)}:${relative}\0`);
		let stat: fs.Stats;
		try {
			stat = fs.lstatSync(absolute);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				hash.update('deleted\0');
				continue;
			}
			throw error;
		}
		if (stat.isSymbolicLink()) {
			hash.update('symlink\0').update(fs.readlinkSync(absolute));
		} else if (stat.isFile()) {
			const contents = fs.readFileSync(absolute);
			hash.update(`${contents.length}:`).update(contents);
		} else {
			throw new Error('A scoped build input is not a regular file; submodule inputs require explicit audit.');
		}
	}
	const dirty = status.length > 0;
	if (dirty && process.env['DSH_BUILD_CLEAN_ONLY'] === '1') {
		throw new Error('DSH_BUILD_CLEAN_ONLY=1 requires a clean scoped source tree.');
	}
	return {
		repositoryHead: head, sourceCommit, dirty, workingTreeDigest: hash.digest('hex'),
		inputScope: [...inputPaths],
		excludedPathPolicy: 'Generated outputs, dependency installations, .env, npm credentials and secret/private-key paths are excluded; dirty and digest cover only inputScope.',
	};
}
