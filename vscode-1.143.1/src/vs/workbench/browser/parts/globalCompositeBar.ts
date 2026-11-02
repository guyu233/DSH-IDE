/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/globalCompositeBar.css';
import { localize } from '../../../nls.js';
import { ActionBar, ActionsOrientation } from '../../../base/browser/ui/actionbar/actionbar.js';
import { ACCOUNTS_ACTIVITY_ID, ACCOUNTS_SHARED_SIGN_IN_GROUP, GLOBAL_ACTIVITY_ID } from '../../common/activity.js';
import { IActivityService } from '../../services/activity/common/activity.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { DisposableStore, Disposable } from '../../../base/common/lifecycle.js';
import { IColorTheme, IThemeService } from '../../../platform/theme/common/themeService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../platform/storage/common/storage.js';
import { IExtensionService } from '../../services/extensions/common/extensions.js';
import { CompositeBarActionViewItem, CompositeBarAction, IActivityHoverOptions, ICompositeBarActionViewItemOptions, ICompositeBarColors } from './compositeBarActions.js';
import { Codicon } from '../../../base/common/codicons.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { registerIcon } from '../../../platform/theme/common/iconRegistry.js';
import { Action, IAction, Separator, SubmenuAction, toAction } from '../../../base/common/actions.js';
import { Emitter } from '../../../base/common/event.js';
import { IMenu, IMenuService, MenuId } from '../../../platform/actions/common/actions.js';
import { addDisposableListener, EventType, append, clearNode, hide, show, EventHelper, $, runWhenWindowIdle, getWindow } from '../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../base/browser/keyboardEvent.js';
import { StandardMouseEvent } from '../../../base/browser/mouseEvent.js';
import { EventType as TouchEventType, GestureEvent } from '../../../base/browser/touch.js';
import { AnchorAlignment, AnchorAxisAlignment } from '../../../base/browser/ui/contextview/contextview.js';

import { getActionBarActions } from '../../../platform/actions/browser/menuEntryActionViewItem.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../platform/contextview/browser/contextView.js';
import { IKeybindingService } from '../../../platform/keybinding/common/keybinding.js';
import { ILogService } from '../../../platform/log/common/log.js';

import { CancellationToken } from '../../../base/common/cancellation.js';
import { listenStream } from '../../../base/common/stream.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { IRequestService } from '../../../platform/request/common/request.js';
import { IWorkbenchEnvironmentService } from '../../services/environment/common/environmentService.js';
import { IHoverService } from '../../../platform/hover/browser/hover.js';
import { ILifecycleService, LifecyclePhase } from '../../services/lifecycle/common/lifecycle.js';
import { IUserDataProfileService } from '../../services/userDataProfile/common/userDataProfile.js';
import { DEFAULT_ICON } from '../../services/userDataProfile/common/userDataProfileIcons.js';
import { isString } from '../../../base/common/types.js';
import { FileAccess } from '../../../base/common/network.js';
import { URI } from '../../../base/common/uri.js';
import { KeyCode } from '../../../base/common/keyCodes.js';
import { ACTIVITY_BAR_BADGE_BACKGROUND, ACTIVITY_BAR_BADGE_FOREGROUND } from '../../common/theme.js';
import { IBaseActionViewItemOptions } from '../../../base/browser/ui/actionbar/actionViewItems.js';


import { WORKBENCH_MENU_MOTION_CLASS, workbenchMenuCloseAnimation } from '../actions/menuMotion.js';


export class GlobalCompositeBar extends Disposable {

	private static readonly ACCOUNTS_ACTION_INDEX = 0;
	static readonly ACCOUNTS_ICON = registerIcon('accounts-view-bar-icon', Codicon.account, localize('accountsViewBarIcon', "Accounts icon in the view bar."));

	readonly element: HTMLElement;

	private readonly globalActivityAction = this._register(new Action(GLOBAL_ACTIVITY_ID));
	private readonly accountAction = this._register(new Action(ACCOUNTS_ACTIVITY_ID));
	private readonly globalActivityActionBar: ActionBar;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	constructor(
		private readonly contextMenuActionsProvider: () => IAction[],
		private readonly colors: (theme: IColorTheme) => ICompositeBarColors,
		private readonly activityHoverOptions: IActivityHoverOptions,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IStorageService private readonly storageService: IStorageService,
		@IExtensionService private readonly extensionService: IExtensionService,
	) {
		super();

		this.element = $('div');
		const contextMenuAlignmentOptions = () => ({
			anchorAlignment: configurationService.getValue('workbench.sideBar.location') === 'left' ? AnchorAlignment.RIGHT : AnchorAlignment.LEFT,
			anchorAxisAlignment: AnchorAxisAlignment.HORIZONTAL
		});
		this.globalActivityActionBar = this._register(new ActionBar(this.element, {
			actionViewItemProvider: (action, options) => {
				if (action.id === GLOBAL_ACTIVITY_ID) {
					return this.instantiationService.createInstance(GlobalActivityActionViewItem, this.contextMenuActionsProvider, { ...options, colors: this.colors, hoverOptions: this.activityHoverOptions }, contextMenuAlignmentOptions);
				}

				if (action.id === ACCOUNTS_ACTIVITY_ID) {
					return this.instantiationService.createInstance(AccountsActivityActionViewItem,
						this.contextMenuActionsProvider,
						{
							...options,
							colors: this.colors,
							hoverOptions: this.activityHoverOptions
						},
						contextMenuAlignmentOptions,
						(actions: IAction[]) => {
							actions.unshift(...[
								toAction({ id: 'hideAccounts', label: localize('hideAccounts', "Hide Accounts"), run: () => setAccountsActionVisible(storageService, false) }),
								new Separator()
							]);
						});
				}

				throw new Error(`No view item for action '${action.id}'`);
			},
			orientation: ActionsOrientation.VERTICAL,
			ariaLabel: localize('manage', "Manage"),
			preventLoopNavigation: true
		}));

		if (this.accountsVisibilityPreference) {
			this.globalActivityActionBar.push(this.accountAction, { index: GlobalCompositeBar.ACCOUNTS_ACTION_INDEX });
		}

		this.globalActivityActionBar.push(this.globalActivityAction);

		this.registerListeners();
	}

	private registerListeners(): void {
		this.extensionService.whenInstalledExtensionsRegistered().then(() => {
			if (!this._store.isDisposed) {
				this._register(this.storageService.onDidChangeValue(StorageScope.PROFILE, AccountsActivityActionViewItem.ACCOUNTS_VISIBILITY_PREFERENCE_KEY, this._store)(() => this.toggleAccountsActivity()));
			}
		});
	}

	create(parent: HTMLElement): void {
		parent.appendChild(this.element);
	}

	focus(): void {
		this.globalActivityActionBar.focus(true);
	}

	getHeight(actionHeight: number, actionGap: number): number {
		const count = this.globalActivityActionBar.length();
		return count * actionHeight + Math.max(0, count - 1) * actionGap;
	}

	getContextMenuActions(): IAction[] {
		return [toAction({ id: 'toggleAccountsVisibility', label: localize('accounts', "Accounts"), checked: this.accountsVisibilityPreference, run: () => this.accountsVisibilityPreference = !this.accountsVisibilityPreference })];
	}

	private toggleAccountsActivity() {
		const accountsVisible = this.globalActivityActionBar.length() === 2;
		if (accountsVisible === this.accountsVisibilityPreference) {
			return;
		}
		if (accountsVisible) {
			this.globalActivityActionBar.pull(GlobalCompositeBar.ACCOUNTS_ACTION_INDEX);
		} else {
			this.globalActivityActionBar.push(this.accountAction, { index: GlobalCompositeBar.ACCOUNTS_ACTION_INDEX });
		}
		this._onDidChange.fire();
	}

	private get accountsVisibilityPreference(): boolean {
		return isAccountsActionVisible(this.storageService);
	}

	private set accountsVisibilityPreference(value: boolean) {
		setAccountsActionVisible(this.storageService, value);
	}
}

abstract class AbstractGlobalActivityActionViewItem extends CompositeBarActionViewItem {

	constructor(
		private readonly menuId: MenuId,
		action: CompositeBarAction,
		options: ICompositeBarActionViewItemOptions,
		private readonly contextMenuActionsProvider: () => IAction[],
		private readonly contextMenuAlignmentOptions: () => Readonly<{ anchorAlignment: AnchorAlignment; anchorAxisAlignment: AnchorAxisAlignment }> | undefined,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IMenuService private readonly menuService: IMenuService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IConfigurationService protected override readonly configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IActivityService private readonly activityService: IActivityService,
	) {
		super(action, { draggable: false, icon: true, hasPopup: true, ...options }, () => true, themeService, hoverService, configurationService, keybindingService);

		this.updateItemActivity();
		this._register(this.activityService.onDidChangeActivity(viewContainerOrAction => {
			if (isString(viewContainerOrAction) && viewContainerOrAction === this.compositeBarActionItem.id) {
				this.updateItemActivity();
			}
		}));
	}

	private updateItemActivity(): void {
		(this.action as CompositeBarAction).activities = this.activityService.getActivity(this.compositeBarActionItem.id);
	}

	override render(container: HTMLElement): void {
		super.render(container);

		this._register(addDisposableListener(this.container, EventType.MOUSE_DOWN, async (e: MouseEvent) => {
			EventHelper.stop(e, true);
			const isLeftClick = e?.button !== 2;
			// Left-click run
			if (isLeftClick) {
				this.run();
			}
		}));

		// The rest of the activity bar uses context menu event for the context menu, so we match this
		this._register(addDisposableListener(this.container, EventType.CONTEXT_MENU, async (e: MouseEvent) => {
			// Let the item decide on the context menu instead of the toolbar
			e.stopPropagation();

			const disposables = new DisposableStore();
			const actions = await this.resolveContextMenuActions(disposables);

			const event = new StandardMouseEvent(getWindow(this.container), e);

			this.contextMenuService.showContextMenu({
				getAnchor: () => event,
				getActions: () => actions,
				getMenuClassName: () => WORKBENCH_MENU_MOTION_CLASS,
				onHide: () => disposables.dispose(),
				closeAnimation: workbenchMenuCloseAnimation
			});
		}));

		this._register(addDisposableListener(this.container, EventType.KEY_UP, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
				EventHelper.stop(e, true);
				this.run();
			}
		}));

		this._register(addDisposableListener(this.container, TouchEventType.Tap, (e: GestureEvent) => {
			EventHelper.stop(e, true);
			this.run();
		}));
	}

	protected async resolveContextMenuActions(disposables: DisposableStore): Promise<IAction[]> {
		return this.contextMenuActionsProvider();
	}

	private async run(): Promise<void> {
		const disposables = new DisposableStore();
		const menu = disposables.add(this.menuService.createMenu(this.menuId, this.contextKeyService));
		const actions = await this.resolveMainMenuActions(menu, disposables);
		const { anchorAlignment, anchorAxisAlignment } = this.contextMenuAlignmentOptions() ?? { anchorAlignment: undefined, anchorAxisAlignment: undefined };

		this.contextMenuService.showContextMenu({
			getAnchor: () => this.label,
			anchorAlignment,
			anchorAxisAlignment,
			getActions: () => actions,
			getMenuClassName: () => WORKBENCH_MENU_MOTION_CLASS,
			onHide: () => disposables.dispose(),
			menuActionOptions: { renderShortTitle: true },
			closeAnimation: workbenchMenuCloseAnimation
		});

	}

	protected async resolveMainMenuActions(menu: IMenu, _disposable: DisposableStore): Promise<IAction[]> {
		return getActionBarActions(menu.getActions({ renderShortTitle: true })).secondary;
	}
}

export class AccountsActivityActionViewItem extends AbstractGlobalActivityActionViewItem {

	static readonly ACCOUNTS_VISIBILITY_PREFERENCE_KEY = 'workbench.activity.showAccounts';

	private avatarImg: HTMLImageElement | undefined;
	private dshAccount: { signedIn: boolean; unavailable?: boolean; name: string; contact: string; avatarUrl: string } | undefined;
	// DSH 鲸鱼 logo（未登录/无头像时作为账号按钮标识，替掉 GitHub/Copilot 的通用人像）。
	// 官方 DSH /favicon.svg 路径，viewBox 0 0 50 50。
	private static readonly DSH_WHALE_ICON_URI = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><path fill="#ffffff" d="M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z"/></svg>');

	constructor(
		contextMenuActionsProvider: () => IAction[],
		options: ICompositeBarActionViewItemOptions,
		contextMenuAlignmentOptions: () => Readonly<{ anchorAlignment: AnchorAlignment; anchorAxisAlignment: AnchorAxisAlignment }> | undefined,
		private readonly fillContextMenuActions: (actions: IAction[]) => void,
		@IThemeService themeService: IThemeService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IHoverService hoverService: IHoverService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IMenuService menuService: IMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@ILogService private readonly logService: ILogService,
		@IActivityService activityService: IActivityService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IRequestService private readonly requestService: IRequestService,
	) {
		const action = instantiationService.createInstance(CompositeBarAction, {
			id: ACCOUNTS_ACTIVITY_ID,
			name: localize('accounts', "Accounts"),
			classNames: ThemeIcon.asClassNameArray(GlobalCompositeBar.ACCOUNTS_ICON)
		});
		super(MenuId.AccountsContext, action, options, contextMenuActionsProvider, contextMenuAlignmentOptions, themeService, hoverService, menuService, contextMenuService, contextKeyService, configurationService, keybindingService, activityService);
		this._register(action);
		this.registerListeners();
		this.initialize();
	}

	private registerListeners(): void {
		const timer = setInterval(() => { void this.refreshDshAccount(); }, 5000);
		this._register({ dispose: () => clearInterval(timer) });
	}

		private async initialize(): Promise<void> {
		// Resolving the menu doesn't need to happen immediately, so we can wait until after the workbench has been restored
		// and only run this when the system is idle.
		await this.lifecycleService.when(LifecyclePhase.Restored);
		if (this._store.isDisposed) {
			return;
		}
		const disposable = this._register(runWhenWindowIdle(getWindow(this.element), async () => {
			await this.doInitialize();
			disposable.dispose();
		}));
	}

	private async doInitialize(): Promise<void> {
		await this.refreshDshAccount();
		this.updateAvatar();
	}

		override render(container: HTMLElement): void {
		super.render(container);

		this.avatarImg = $('img.accounts-avatar') as HTMLImageElement;
		this.avatarImg.alt = '';
		this.avatarImg.setAttribute('aria-hidden', 'true');
		this.avatarImg.draggable = false;
		this.avatarImg.referrerPolicy = 'no-referrer';
		this.avatarImg.style.display = 'none';
		this.avatarImg.onerror = () => {
			this.avatarImg!.style.display = 'none';
			this.label.classList.remove('has-avatar');
		};
		append(this.label, this.avatarImg);

		this.updateAvatar();
	}

	private dshBaseUrl(): string {
		// 首选：VS Code 自身配置（插件在拉起 IDE 前把当前 Host Origin 写入 settings.json 的 dsh.hostBaseUrl）。
		try {
			const configured = this.configurationService.getValue<string | undefined>('dsh.hostBaseUrl');
			if (configured && configured.trim()) { return configured.trim().replace(/\/+$/, ''); }
		} catch { /* ignore */ }
		// 其次：插件注入到渲染层 globalThis 的地址（若当前进程恰为 DSH Web UI）。
		try {
			const g = (globalThis as { __DSH_HOST_BASE__?: string }).__DSH_HOST_BASE__;
			if (typeof g === 'string' && g.trim()) { return g.trim().replace(/\/+$/, ''); }
		} catch { /* ignore */ }
		try {
			const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.['DSH_WEB_URL'];
			if (v && v.trim()) { return v.trim().replace(/\/+$/, ''); }
		} catch { /* ignore */ }
		return '';
	}

	private async dshJson(path: string, method: 'GET' | 'POST'): Promise<any> {
		const context = await this.requestService.request({
			url: this.dshBaseUrl() + path,
			type: method,
			headers: { 'Content-Type': 'application/json' },
			data: method === 'POST' ? '{}' : undefined,
			callSite: 'dshAccountButton',
		}, CancellationToken.None);
		let body = '';
		await new Promise<void>((resolve, reject) => {
			listenStream(context.stream, {
				onData: (chunk: VSBuffer) => { body += chunk.toString(); },
				onError: reject,
				onEnd: () => resolve(),
			});
		});
		if (context.res.statusCode && context.res.statusCode >= 400) {
			throw new Error(body.slice(0, 300));
		}
		return body ? JSON.parse(body) : {};
	}

	private async refreshDshAccount(): Promise<void> {
		try {
			const data = await this.dshJson('/dsh-account', 'GET');
			this.dshAccount = {
				signedIn: data?.signedIn === true,
				unavailable: data?.unavailable === true,
				name: typeof data?.name === 'string' ? data.name : '',
				contact: typeof data?.contact === 'string' ? data.contact : '',
				avatarUrl: this.safeAvatar(typeof data?.avatarUrl === 'string' ? data.avatarUrl : ''),
			};
		} catch (error) {
			this.logService.error(error);
			this.dshAccount = { signedIn: false, unavailable: true, name: '', contact: '', avatarUrl: '' };
		}
		this.updateAvatar();
	}

	private async signInDsh(): Promise<void> {
		try {
			const data = await this.dshJson('/dsh-account/sign-in', 'POST');
			this.dshAccount = {
				signedIn: data?.signedIn === true,
				name: typeof data?.name === 'string' ? data.name : '',
				contact: typeof data?.contact === 'string' ? data.contact : '',
				avatarUrl: this.safeAvatar(typeof data?.avatarUrl === 'string' ? data.avatarUrl : ''),
			};
		} catch (error) {
			this.logService.error(error);
		}
		this.updateAvatar();
	}

	private async signOutDsh(): Promise<void> {
		try {
			await this.dshJson('/dsh-account/sign-out', 'POST');
		} catch (error) {
			this.logService.error(error);
		}
		await this.refreshDshAccount();
	}

	private safeAvatar(value: string): string {
		try {
			const url = new URL(value);
			if (url.protocol === 'https:' || url.protocol === 'http:') {
				return url.href;
			}
		} catch {
			return '';
		}
		return '';
	}

	private updateAvatar(): void {
		if (!this.avatarImg) {
			return;
		}
		const avatarUrl = this.dshAccount?.signedIn ? this.dshAccount.avatarUrl : '';
		if (avatarUrl) {
			this.avatarImg.src = avatarUrl;
			this.avatarImg.style.display = '';
			this.label.classList.add('has-avatar');
		} else {
			// 未登录/无头像：用 DSH 鲸鱼标识（替掉 GitHub/Copilot 的通用人像），确保始终显示 DSH 品牌。
			this.avatarImg.src = AccountsActivityActionViewItem.DSH_WHALE_ICON_URI;
			this.avatarImg.style.display = '';
			this.avatarImg.style.objectFit = 'contain';
			this.avatarImg.style.padding = '3px';
			this.label.classList.add('has-avatar');
		}
	}

		protected override async resolveMainMenuActions(_accountsMenu: IMenu, disposables: DisposableStore): Promise<IAction[]> {
		await this.refreshDshAccount();
		const account = this.dshAccount;
		if (!account) {
			return [disposables.add(new Action('dshAccountLoading', localize('dshAccountLoading', "正在读取 DeepSeek 账号…"), undefined, false))];
		}
		if (account.unavailable) {
			return [disposables.add(new Action('dshAccountUnavailable', localize('dshAccountUnavailable', "DeepSeek 账号不可用"), undefined, false))];
		}
		if (!account.signedIn) {
			return [disposables.add(new Action('dsh.signIn', localize('dshSignIn', "登录 DeepSeek"), undefined, true, () => { void this.signInDsh(); }))];
		}
		const actions: IAction[] = [
			disposables.add(new Action('dsh.accountName', account.name || 'DeepSeek', undefined, false)),
		];
		if (account.contact && account.contact !== account.name) {
			actions.push(disposables.add(new Action('dsh.accountContact', account.contact, undefined, false)));
		}
		actions.push(disposables.add(new Action('dsh.signOut', localize('dshSignOut', "退出登录"), undefined, true, () => { void this.signOutDsh(); })));
		return actions;
	}

		protected override async resolveContextMenuActions(disposables: DisposableStore): Promise<IAction[]> {
		const actions = await super.resolveContextMenuActions(disposables);
		this.fillContextMenuActions(actions);
		return actions;
	}
}

export class GlobalActivityActionViewItem extends AbstractGlobalActivityActionViewItem {

	private profileBadge: HTMLElement | undefined;
	private profileBadgeContent: HTMLElement | undefined;

	constructor(
		contextMenuActionsProvider: () => IAction[],
		options: ICompositeBarActionViewItemOptions,
		contextMenuAlignmentOptions: () => Readonly<{ anchorAlignment: AnchorAlignment; anchorAxisAlignment: AnchorAxisAlignment }> | undefined,
		@IUserDataProfileService private readonly userDataProfileService: IUserDataProfileService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IMenuService menuService: IMenuService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IActivityService activityService: IActivityService,
	) {
		const action = instantiationService.createInstance(CompositeBarAction, {
			id: GLOBAL_ACTIVITY_ID,
			name: localize('manage', "Manage"),
			classNames: ThemeIcon.asClassNameArray(userDataProfileService.currentProfile.icon ? ThemeIcon.fromId(userDataProfileService.currentProfile.icon) : DEFAULT_ICON)
		});
		super(MenuId.GlobalActivity, action, options, contextMenuActionsProvider, contextMenuAlignmentOptions, themeService, hoverService, menuService, contextMenuService, contextKeyService, configurationService, keybindingService, activityService);
		this._register(action);
		this._register(this.userDataProfileService.onDidChangeCurrentProfile(e => {
			action.compositeBarActionItem = {
				...action.compositeBarActionItem,
				classNames: ThemeIcon.asClassNameArray(userDataProfileService.currentProfile.icon ? ThemeIcon.fromId(userDataProfileService.currentProfile.icon) : DEFAULT_ICON)
			};
		}));
	}

	override render(container: HTMLElement): void {
		super.render(container);

		this.profileBadge = append(container, $('.profile-badge'));
		this.profileBadgeContent = append(this.profileBadge, $('.profile-badge-content'));
		this.updateProfileBadge();
	}

	private updateProfileBadge(): void {
		if (!this.profileBadge || !this.profileBadgeContent) {
			return;
		}

		clearNode(this.profileBadgeContent);
		hide(this.profileBadge);

		if (this.userDataProfileService.currentProfile.isDefault) {
			return;
		}

		if (this.userDataProfileService.currentProfile.icon && this.userDataProfileService.currentProfile.icon !== DEFAULT_ICON.id) {
			return;
		}

		if ((this.action as CompositeBarAction).activities.length > 0) {
			return;
		}

		show(this.profileBadge);
		this.profileBadgeContent.classList.add('profile-text-overlay');
		this.profileBadgeContent.textContent = this.userDataProfileService.currentProfile.name.substring(0, 2).toUpperCase();
	}

	protected override updateActivity(): void {
		super.updateActivity();
		this.updateProfileBadge();
	}

	protected override computeTitle(): string {
		return this.userDataProfileService.currentProfile.isDefault ? super.computeTitle() : localize('manage profile', "Manage {0} (Profile)", this.userDataProfileService.currentProfile.name);
	}
}

export class SimpleAccountActivityActionViewItem extends AccountsActivityActionViewItem {

	constructor(
		hoverOptions: IActivityHoverOptions,
		options: IBaseActionViewItemOptions,
		@IThemeService themeService: IThemeService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IHoverService hoverService: IHoverService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IMenuService menuService: IMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IStorageService storageService: IStorageService,
		@ILogService logService: ILogService,
		@IActivityService activityService: IActivityService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IRequestService requestService: IRequestService,
	) {
		super(() => simpleActivityContextMenuActions(storageService, true),
			{
				...options,
				colors: theme => ({
					badgeBackground: theme.getColor(ACTIVITY_BAR_BADGE_BACKGROUND),
					badgeForeground: theme.getColor(ACTIVITY_BAR_BADGE_FOREGROUND),
				}),
				hoverOptions,
				compact: true,
			}, () => undefined, actions => actions, themeService, lifecycleService, hoverService, contextMenuService, menuService, contextKeyService, configurationService, keybindingService, logService, activityService, instantiationService, requestService);
	}
}

export class SimpleGlobalActivityActionViewItem extends GlobalActivityActionViewItem {

	constructor(
		hoverOptions: IActivityHoverOptions,
		options: IBaseActionViewItemOptions,
		@IUserDataProfileService userDataProfileService: IUserDataProfileService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IMenuService menuService: IMenuService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IActivityService activityService: IActivityService,
		@IStorageService storageService: IStorageService
	) {
		super(() => simpleActivityContextMenuActions(storageService, false),
			{
				...options,
				colors: theme => ({
					badgeBackground: theme.getColor(ACTIVITY_BAR_BADGE_BACKGROUND),
					badgeForeground: theme.getColor(ACTIVITY_BAR_BADGE_FOREGROUND),
				}),
				hoverOptions,
				compact: true,
			}, () => undefined, userDataProfileService, themeService, hoverService, menuService, contextMenuService, contextKeyService, configurationService, environmentService, keybindingService, instantiationService, activityService);
	}
}

function simpleActivityContextMenuActions(storageService: IStorageService, isAccount: boolean): IAction[] {
	const currentElementContextMenuActions: IAction[] = [];
	if (isAccount) {
		currentElementContextMenuActions.push(
			toAction({ id: 'hideAccounts', label: localize('hideAccounts', "Hide Accounts"), run: () => setAccountsActionVisible(storageService, false) }),
			new Separator()
		);
	}
	return [
		...currentElementContextMenuActions,
		toAction({ id: 'toggle.hideAccounts', label: localize('accounts', "Accounts"), checked: isAccountsActionVisible(storageService), run: () => setAccountsActionVisible(storageService, !isAccountsActionVisible(storageService)) }),
		toAction({ id: 'toggle.hideManage', label: localize('manage', "Manage"), checked: true, enabled: false, run: () => { throw new Error('"Manage" can not be hidden'); } })
	];
}

export function isAccountsActionVisible(storageService: IStorageService): boolean {
	return storageService.getBoolean(AccountsActivityActionViewItem.ACCOUNTS_VISIBILITY_PREFERENCE_KEY, StorageScope.PROFILE, true);
}

function setAccountsActionVisible(storageService: IStorageService, visible: boolean) {
	storageService.store(AccountsActivityActionViewItem.ACCOUNTS_VISIBILITY_PREFERENCE_KEY, visible, StorageScope.PROFILE, StorageTarget.USER);
}
