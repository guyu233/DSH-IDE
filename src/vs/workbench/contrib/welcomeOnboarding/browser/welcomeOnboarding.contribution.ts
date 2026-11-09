/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Load styles for the remaining onboarding variant.
import './media/variationA.css';

import { Event } from '../../../../base/common/event.js';
import { localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import product from '../../../../platform/product/common/product.js';
import { IOnboardingService } from '../common/onboardingService.js';
import { OnboardingVariationA } from './onboardingVariationA.js';

/**
 * 未配置 Copilot 类 `defaultChatAgent` 时的空实现。
 *
 * DSH-IDE 已移除 Copilot 专属入口，登录与引导由 DSH 决定；保留该服务只为满足
 * `startupPage` 的注入契约。`show()` 不弹出任何界面，`onDidDismiss` 不伪造完成事件。
 */
class NoopOnboardingService implements IOnboardingService {
	declare readonly _serviceBrand: undefined;
	readonly onDidDismiss: Event<void> = Event.None;

	show(): void {
		// 由 DSH 主窗口负责登录与引导；这里不弹出、不伪造状态。
	}
}

if (product.defaultChatAgent) {
	registerSingleton(IOnboardingService, OnboardingVariationA, InstantiationType.Delayed);

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.welcomeOnboarding2026',
				title: localize2('welcomeOnboarding2026', "Welcome Onboarding 2026"),
				category: Categories.Developer,
				f1: true,
			});
		}

		run(accessor: ServicesAccessor): void {
			const onboardingService = accessor.get(IOnboardingService);
			onboardingService.show();
		}
	});
} else {
	registerSingleton(IOnboardingService, NoopOnboardingService, InstantiationType.Delayed);
}