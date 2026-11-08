/*---------------------------------------------------------------------------------------------
 *  Copyright (c) DSH-IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// Workbench 集成。
//
// 旧官方客户端连接层已整删，唯一的 `dshIde` 通道由主进程分发（P3）。本文件保留行内补全注册
// （通道未接线时优雅降级为无补全，不报错），并显式告知用户 AI 连接层尚未接线。

import { localize } from '../../../../nls.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IDshClientService, DshClientService } from '../../../../platform/dshClient/common/dshClientService.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { registerDshInlineCompletions } from './inlineCompletion.js';
import { DshIdeConsumer, type DshIdeConsumerState } from './dshIdeConsumer.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

registerSingleton(IDshClientService, DshClientService, InstantiationType.Delayed);

/**
 * 消费 `dshIde` 通道的唯一快照流：`DshIdeConsumer` 负责校验与 fail-closed，
 * 本贡献点负责「开视图 → 订阅 → 把行交给渲染方」，并把失败如实提示给用户。
 *
 * 无论是否配置了远端端点都要注册：`DshClientService` 在未接线时会明确返回
 * `feature-unavailable`（不伪造状态），用户应看到确定提示而不是「什么都没有」。
 */
class DshClientContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IDshClientService client: IDshClientService,
		@INotificationService private readonly notifications: INotificationService,
		@ILanguageFeaturesService languageFeatures: ILanguageFeaturesService,
	) {
		super();
		// 行内补全（DSH 后端；未接线时优雅降级为无补全，不报错）。
		registerDshInlineCompletions(languageFeatures, client);

		// 消费链路：快照 → 消费者（校验 / fail-closed / 合并 / diff）。
		const consumer = this._register(new DshIdeConsumer());
		this._register(consumer.onDidFail((error: { readonly code: string }) => {
			// 连续性失败必须让用户知道，不能静默丢弃帧（第 2 章 E4 / E7）。
			this.notifications.warn(localize(
				'dsh.snapshotFailed',
				"DSH-IDE 快照被拒绝（{0}），界面保持上一次一致状态。",
				error.code,
			));
		}));
		this._register(consumer.onDidChangeRows(({ state }: { state: DshIdeConsumerState }) => {
			// 渲染层由 Chat 侧栏读取（P4 后续接线）；这里保证状态是最新的。
			this._lastState = state;
		}));
		this._register(client.onDidSnapshot(snapshot => consumer.accept(snapshot)));

		// 打开视图：失败时明确提示，不伪造「已连接」。
		void client.openView({ view: 'chat' }).then(result => {
			if (!result.ok) {
				this.notifications.info(localize(
					'dsh.connectionUnavailable',
					"DSH-IDE AI 连接层尚未就绪（{0}），Chat 暂不可用。",
					result.error.code,
				));
			}
		});
	}

	private _lastState: DshIdeConsumerState | undefined;

	/** 最近一次被接受的渲染状态（供 Chat 侧栏读取；P4 接线）。 */
	get lastState(): DshIdeConsumerState | undefined {
		return this._lastState;
	}
}

registerWorkbenchContribution2('workbench.contrib.dshClient', DshClientContribution, WorkbenchPhase.AfterRestored);
