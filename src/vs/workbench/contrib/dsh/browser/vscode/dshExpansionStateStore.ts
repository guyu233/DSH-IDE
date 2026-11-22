/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 折叠状态在会话 store 里，不写在 DOM 上。
// 第一层是 Turn 过程：键是 turn + answerStep，缺省表示展开，只有 collapsed === true 才收起。
// 第二层是节点 disclosure：每次调用各自一份，所属 Turn 重置时清掉，不跨会话。

interface TurnProcessEntry {
	readonly collapsed?: true;
}

/** 一个会话的折叠状态。换会话用另一份 store，不要复用这里的 Map。 */
export class DshExpansionStateStore {
	private readonly turnProcesses = new Map<string, TurnProcessEntry>();
	private readonly disclosures = new Map<string, boolean>();
	private readonly listeners = new Set<() => void>();

	readonly sessionId: string;

	constructor(sessionId: string) {
		this.sessionId = sessionId;
	}

	onDidChange(listener: () => void): { dispose(): void } {
		this.listeners.add(listener);
		return { dispose: () => { this.listeners.delete(listener); } };
	}

	/** 缺省是展开。只有显式收起过才返回 true。 */
	isTurnCollapsed(turn: number, answerStep: number): boolean {
		return this.turnProcesses.get(turnKey(turn, answerStep))?.collapsed === true;
	}

	setTurnCollapsed(turn: number, answerStep: number, collapsed: boolean): void {
		const key = turnKey(turn, answerStep);
		if (collapsed) {
			this.turnProcesses.set(key, { collapsed: true });
		} else {
			this.turnProcesses.delete(key);
		}
		this.emit();
	}

	/** 节点级展开。同一个 turn 里不同 disclosureId 互不影响。 */
	isDisclosed(turn: number, disclosureId: string): boolean {
		return this.disclosures.get(disclosureKey(turn, disclosureId)) === true;
	}

	setDisclosed(turn: number, disclosureId: string, open: boolean): void {
		const key = disclosureKey(turn, disclosureId);
		if (open) {
			this.disclosures.set(key, true);
		} else {
			this.disclosures.delete(key);
		}
		this.emit();
	}

	/**
	 * Turn 重置时清掉这一层的节点展开。
	 * Turn 过程的收起状态留着，刷新快照不把用户收起的过程打开。
	 */
	resetTurn(turn: number): void {
		const prefix = `${turn}\u0000`;
		let changed = false;
		for (const key of [...this.disclosures.keys()]) {
			if (key.startsWith(prefix)) {
				this.disclosures.delete(key);
				changed = true;
			}
		}
		if (changed) {
			this.emit();
		}
	}

	private emit(): void {
		for (const listener of [...this.listeners]) {
			listener();
		}
	}
}

function turnKey(turn: number, answerStep: number): string {
	return `${turn}\u0000${answerStep}`;
}

function disclosureKey(turn: number, disclosureId: string): string {
	return `${turn}\u0000${disclosureId}`;
}
