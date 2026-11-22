/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// 折叠状态在会话 store 里，不写在 DOM 上。
// 第一层是 Turn 过程：键是 turn + answerStep，缺省表示展开，只有 collapsed === true 才收起。
// 第二层是节点 disclosure：每次调用各自一份，所属 Turn 重置时清掉，不跨会话。

import type { DshIdeTranscriptView } from '../../../../../platform/dshClient/protocol/dshIdeProtocol.js';

/**
 * 官方 work-details 模式对**整个 Turn 折叠**的影响（`conversation-nodes/README.md`「Display modes」）。
 *
 * 四档的差异只在这三处，别处（分组结果、单个 reasoning/tool 的展开、类别计数）完全相同：
 *   - `verbose`：**永不折叠整个 Turn**（「Always open; duration/status header cannot collapse it」）；
 *   - 其余三档：合格的历史 Turn **初始折叠**；
 *   - 用户手动开合始终优先于模式默认（官方「Mode changes preserve membership and manual opening choices」）。
 *
 * @param view 当前模式
 * @returns `'never'` = 永不折叠；`'collapsed-by-default'` = 初始折叠但可手动开
 */
export function turnFoldingPolicy(view: DshIdeTranscriptView): 'never' | 'collapsed-by-default' {
	return view === 'verbose' ? 'never' : 'collapsed-by-default';
}

/**
 * 官方 `detailed` 在**运行中**的 Turn 里隐藏组头（历史 Turn 保留）。
 *
 * 这条只影响组头是否渲染，不影响过程内容是否展开，也不影响单条 disclosure。
 */
export function hidesRunningGroupHeaders(view: DshIdeTranscriptView): boolean {
	return view === 'detailed';
}

/**
 * 官方 `compact` 的组头**不带实时细节**（`standard`/`detailed`/`verbose` 带）。
 */
export function showsLiveGroupDetail(view: DshIdeTranscriptView): boolean {
	return view !== 'compact';
}

interface TurnProcessEntry {
	/** 三态：`true` 手动收起、`false` 手动展开、缺省表示「没手动设过」（由模式默认决定）。 */
	readonly collapsed: boolean;
}

/** 一个会话的折叠状态。换会话用另一份 store，不要复用这里的 Map。 */
export class DshExpansionStateStore {
	private readonly turnProcesses = new Map<string, TurnProcessEntry>();
	private readonly disclosures = new Map<string, boolean>();
	private readonly listeners = new Set<() => void>();

	readonly sessionId: string;
	/**
	 * 当前 work-details 模式。
	 *
	 * 只影响**默认**折叠：用户手动开合过的 Turn 以手动值为准（`turnProcesses` 里有记录就压过模式）。
	 */
	private view: DshIdeTranscriptView = 'standard';
	/** 官方 `ui-chat.foldedReplies`：折叠时保留所有答复（默认）还是只留最终答复。 */
	private folded: 'all' | 'final' = 'all';
	/** 官方 `ui-chat.collapseTiming`：完成即折叠（默认）还是等下一条输入再折叠。 */
	private timing: 'completion' | 'next-input' = 'completion';
	/**
	 * 当前「最新 exchange」的 Turn 集合（仅 `next-input` 时机用）。
	 *
	 * 官方定义：一个 exchange 从「第一个 Step 接纳人类输入的 Turn」开始，包含其后每个 Turn，
	 * 直到下一个这样的 Turn。这些 Turn 在 `next-input` 下**保持运行中的呈现**（不折叠），
	 * 直到用户提交新输入或出现更新 exchange 的 Turn。
	 */
	private exemptTurns = new Set<number>();

	constructor(sessionId: string) {
		this.sessionId = sessionId;
	}

	/** 官方 `ui-chat.transcriptView`：缺省 / 非法值都用 `standard`（Desktop 默认）。 */
	transcriptView(): DshIdeTranscriptView {
		return this.view;
	}

	/** 官方 `ui-chat.foldedReplies`。 */
	foldedReplies(): 'all' | 'final' {
		return this.folded;
	}

	setFoldedReplies(folded: 'all' | 'final'): void {
		if (this.folded === folded) {
			return;
		}
		this.folded = folded;
		this.emit();
	}

	/** 官方 `ui-chat.collapseTiming`。 */
	collapseTiming(): 'completion' | 'next-input' {
		return this.timing;
	}

	setCollapseTiming(timing: 'completion' | 'next-input'): void {
		if (this.timing === timing) {
			return;
		}
		this.timing = timing;
		this.emit();
	}

	/**
	 * 标记「最新 exchange」包含哪些 Turn（由会话层按官方 exchange 定义算出）。
	 *
	 * 只在 `next-input` 时机生效：这些 Turn 不因模式默认而折叠。
	 * 传空集合即清除豁免（例如用户提交了新输入）。
	 */
	setExemptTurns(turns: readonly number[]): void {
		const next = new Set(turns);
		if (next.size === this.exemptTurns.size && [...next].every(turn => this.exemptTurns.has(turn))) {
			return;
		}
		this.exemptTurns = next;
		this.emit();
	}

	setTranscriptView(view: DshIdeTranscriptView): void {
		if (this.view === view) {
			return;
		}
		this.view = view;
		this.emit();
	}

	onDidChange(listener: () => void): { dispose(): void } {
		this.listeners.add(listener);
		return { dispose: () => { this.listeners.delete(listener); } };
	}

	/**
	 * 该 Turn 过程是否收起。
	 *
	 * 三层优先：① 用户手动设过就以手动值为准；② `verbose` 永不折叠；
	 * ③ 其余模式对**合格的历史 Turn** 初始折叠——但「是否合格」由调用方按官方状态表判定
	 * （未结束 / 失败 / 有可见输入等情况不可折叠），这里只回答「模式允许时默认收不收」。
	 *
	 * @param eligible 该 Turn 是否满足官方可折叠条件（由调用方按 `turnProcessAlwaysOpen` 等判定）
	 */
	isTurnCollapsed(turn: number, answerStep: number, eligible = true): boolean {
		const manual = this.turnProcesses.get(turnKey(turn, answerStep));
		if (manual !== undefined) {
			return manual.collapsed;
		}
		if (!eligible || turnFoldingPolicy(this.view) === 'never') {
			return false;
		}
		// `next-input`：最新 exchange 的 Turn 保持运行中的呈现，不按模式默认折叠。
		if (this.timing === 'next-input' && this.exemptTurns.has(turn)) {
			return false;
		}
		return true;
	}

	/**
	 * 记录用户手动的开合。
	 *
	 * **必须三态**：`false` 是「用户手动展开过」，与「从没设过、走模式默认」是两件事——
	 * 用 `delete` 表示展开会让模式默认（历史 Turn 初始折叠）把用户的展开又收回去。
	 */
	setTurnCollapsed(turn: number, answerStep: number, collapsed: boolean): void {
		this.turnProcesses.set(turnKey(turn, answerStep), { collapsed });
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
