/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createRequire } from 'node:module';

// DSH-IDE：用 Node 内置的 `node:sqlite` 替代 `@vscode/sqlite3`。
//
// 原因：`@vscode/sqlite3` 需要本地编译出 `vscode-sqlite3.node`，DSH-IDE 的桌面载荷
// 从未产出该绑定，导致打包版状态数据库一打开就失败。`node:sqlite` 由 Electron 内置，
// 无需编译、无需随包分发原生文件。
//
// 边界：只适配驱动层。`storage.ts` 的备份、恢复、事务、WAL、busy timeout 与错误标记
// 语义全部保留；对外接口形状与原驱动一致（回调式），调用方无需改动。

/** 原驱动 `Statement` 在本文件中被用到的最小面。 */
export interface IHostStatement {
	run(...params: unknown[]): { readonly changes: number };
	finalize(): void;
}

/** 原驱动 `Database` 在本文件中被用到的最小面。 */
export interface IHostDatabase {
	exec(sql: string, callback?: (error: Error | null) => void): void;
	get(sql: string, callback: (error: Error | null, row: object | undefined) => void): void;
	all(sql: string, callback: (error: Error | null, rows: object[]) => void): void;
	prepare(sql: string): IHostStatement;
	serialize(callback: () => void): void;
	run(sql: string, callback?: (error: Error | null) => void): void;
	close(callback?: (error: Error | null) => void): void;
	readonly isInMemory: boolean;
}

/** 把 `node:sqlite` 抛出的异常归一成带 `code` 的 Error，保持原驱动的判错口径。 */
function normalize(error: unknown): Error & { code?: string } {
	if (error instanceof Error) {
		return error as Error & { code?: string };
	}
	return new Error(String(error));
}

/**
 * 打开一个数据库连接。同步 API 在这里被转成回调，让上层代码保持原有写法。
 * @param path 数据库路径，或 `:memory:`
 */
export function openDatabase(path: string, onCreate?: (db: IHostDatabase) => void): IHostDatabase {
	// 延迟引入：`node:sqlite` 只在真正需要存储时才加载。
	const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => any };
	const raw = new DatabaseSync(path);
	let closed = false;

	const wrap = (fn: () => void, callback?: (error: Error | null) => void): void => {
		try {
			fn();
			callback?.(null);
		} catch (error) {
			callback?.(normalize(error));
		}
	};

	const db: IHostDatabase = {
		exec(sql, callback) {
			wrap(() => raw.exec(sql), callback);
		},
		get(sql, callback) {
			try {
				callback(null, raw.prepare(sql).get());
			} catch (error) {
				callback(normalize(error), undefined);
			}
		},
		all(sql, callback) {
			try {
				callback(null, raw.prepare(sql).all());
			} catch (error) {
				callback(normalize(error), []);
			}
		},
		prepare(sql) {
			const stmt = raw.prepare(sql);
			return {
				run: (...params) => { const args = params.length === 1 && Array.isArray(params[0]) ? params[0] : params; return stmt.run(...args); },
				finalize: () => { /* node:sqlite 由 GC 回收语句，无显式 finalize */ },
			};
		},
		serialize(callback) {
			// `node:sqlite` 的语句执行本身就是同步串行的，这里直接进入临界区。
			callback();
		},
		run(sql, callback) {
			wrap(() => { raw.exec(sql); }, callback);
		},
		close(callback) {
			if (closed) {
				callback?.(null);
				return;
			}
			closed = true;
			wrap(() => raw.close(), callback);
		},
		isInMemory: path === ':memory:',
	};

	// 打开即建表：与原实现一致，用同一条 exec 同时完成建库与损坏检测。
	onCreate?.(db);
	return db;
}
