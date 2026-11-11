/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/globalCompositeBar.css';
import { localize } from '../../../nls.js';
import { ActionBar, ActionsOrientation } from '../../../base/browser/ui/actionbar/actionbar.js';
import { ACCOUNTS_ACTIVITY_ID, GLOBAL_ACTIVITY_ID } from '../../common/activity.js';
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
import { Action, IAction, Separator, toAction } from '../../../base/common/actions.js';
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

import { IRequestService } from '../../../platform/request/common/request.js';
import { IWorkbenchEnvironmentService } from '../../services/environment/common/environmentService.js';
import { IHoverService } from '../../../platform/hover/browser/hover.js';
import { ILifecycleService, LifecyclePhase } from '../../services/lifecycle/common/lifecycle.js';
import { IUserDataProfileService } from '../../services/userDataProfile/common/userDataProfile.js';
import { DEFAULT_ICON } from '../../services/userDataProfile/common/userDataProfileIcons.js';
import { isString } from '../../../base/common/types.js';
import { URI } from '../../../base/common/uri.js';
import { FileAccess } from '../../../base/common/network.js';
import { KeyCode } from '../../../base/common/keyCodes.js';
import { ACTIVITY_BAR_BADGE_BACKGROUND, ACTIVITY_BAR_BADGE_FOREGROUND } from '../../common/theme.js';
import { IBaseActionViewItemOptions } from '../../../base/browser/ui/actionbar/actionViewItems.js';
import { IDshClientService } from '../../../platform/dshClient/common/dshClientService.js';
import { dshAccountClientMetadata } from '../../../platform/dshClient/common/dshIdeProtocol.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';


import { WORKBENCH_MENU_MOTION_CLASS, workbenchMenuCloseAnimation } from '../actions/menuMotion.js';


/**
 * DSH 桌面端自注册的深链。桌面端启动时 `app.setAsDefaultProtocolClient('dsh')`，
 * 收到 `dsh://open` 即 `focusPrimaryWindow()`；配合主进程 `requestSingleInstanceLock` +
 * `second-instance`，已开着时聚焦、没开着时拉起，行为一致。
 */
const DSH_DESKTOP_OPEN_URL = 'dsh://open';


export class GlobalCompositeBar extends Disposable {

	private static readonly ACCOUNTS_ACTION_INDEX = 0;
	static readonly ACCOUNTS_ICON = registerIcon('accounts-view-bar-icon', Codicon.account, localize('accountsViewBarIcon', "Accounts icon in the view bar."));

	readonly element: HTMLElement;

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

		// 齿轮（Manage）按 DSH-IDE 交付要求不再渲染（第 9 轮用户指定）：
		// 它的菜单能力没有丢失——`MenuId.GlobalActivity` 整份并在账号右键菜单里，
		// 见 AccountsActivityActionViewItem.resolveContextMenuActions。
		// 账号按钮的显示/隐藏仍走 storage 偏好（`accountsVisibilityPreference`）。
		if (this.accountsVisibilityPreference) {
			this.globalActivityActionBar.push(this.accountAction, { index: GlobalCompositeBar.ACCOUNTS_ACTION_INDEX });
		}

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
		// 齿轮已不再 push 进 action bar，所以「账号可见」不能再按固定总数 2 判定，
		// 改为按当前条数（齿轮移除后为 0 或 1）判断，否则开关会永久错位。
		const accountsVisible = this.globalActivityActionBar.length() > 0;
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
				this.onLeftClick();
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
				this.onLeftClick();
			}
		}));

		this._register(addDisposableListener(this.container, TouchEventType.Tap, (e: GestureEvent) => {
			EventHelper.stop(e, true);
			this.onLeftClick();
		}));
	}

	protected async resolveContextMenuActions(disposables: DisposableStore): Promise<IAction[]> {
		return this.contextMenuActionsProvider();
	}

	/** 左键行为：默认弹出主菜单；子类可覆盖（如账号按钮改为打开 DSH 桌面端）。 */
	protected onLeftClick(): void {
		void this.run();
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
		return getActionBarActions(menu.getActions({ renderShortTitle: true })).secondary;	}
}

export class AccountsActivityActionViewItem extends AbstractGlobalActivityActionViewItem {

	static readonly ACCOUNTS_VISIBILITY_PREFERENCE_KEY = 'workbench.activity.showAccounts';

	private avatarImg: HTMLImageElement | undefined;
	private dshAccount: { signedIn: boolean; unavailable?: boolean; name: string; contact: string; avatarUrl: string } | undefined;
	// DSH 鲸鱼 logo（未登录/无头像时作为账号按钮标识，替掉 GitHub/Copilot 的通用人像）。
	// DSH 鲸鱼 logo（未登录/无头像时作为账号按钮标识，替掉 GitHub/Copilot 的通用人像）。
	// 直接取**宿主官方资源**：`FileAccess.asBrowserUri` 指向仓库内 `dsh-whale.svg`（该文件本身是
	// E1 `apps/web/public/favicon.svg` 的原样拷贝，sha256 9E983B4F…），不再内联 data URI（T11-02）。
	private static readonly DSH_WHALE_ICON_URI = FileAccess.asBrowserUri('vs/workbench/contrib/dsh/browser/media/dsh-whale.svg').toString(true);

	constructor(
		contextMenuActionsProvider: () => IAction[],
		options: ICompositeBarActionViewItemOptions,
		contextMenuAlignmentOptions: () => Readonly<{ anchorAlignment: AnchorAlignment; anchorAxisAlignment: AnchorAxisAlignment }> | undefined,
		private readonly fillContextMenuActions: (actions: IAction[]) => void,
		@IThemeService themeService: IThemeService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IHoverService hoverService: IHoverService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IMenuService private readonly accountMenuService: IMenuService,
		@IContextKeyService private readonly accountContextKeyService: IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@ILogService private readonly logService: ILogService,
		@IActivityService activityService: IActivityService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IRequestService requestService: IRequestService, // 保留参数位序（Simple* 子类 super(...) 依赖它）
		@IDshClientService private readonly dshClientService: IDshClientService,
		@IOpenerService private readonly openerService: IOpenerService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		const action = instantiationService.createInstance(CompositeBarAction, {
			id: ACCOUNTS_ACTIVITY_ID,
			name: localize('accounts', "Accounts"),
			classNames: ThemeIcon.asClassNameArray(GlobalCompositeBar.ACCOUNTS_ICON)
		});
		super(MenuId.AccountsContext, action, options, contextMenuActionsProvider, contextMenuAlignmentOptions, themeService, hoverService, accountMenuService, contextMenuService, accountContextKeyService, configurationService, keybindingService, activityService);
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

	private dshLocale(): string {
		try {
			const nav = (globalThis as { navigator?: { language?: string } }).navigator;
			return nav?.language || 'zh-cn';
		} catch { /* ignore */ }
		return 'zh-cn';
	}

	/**
	 * 读取官方账号投影。走**官方传输层**（`account/getState`），不再自造 HTTP `/dsh-account`
	 * —— 该端点从未存在过（真机 404），是历史遗留的错误接线。
	 * 依据（E1）：`packages/api/account-controller/src/index.ts`（@Remote getState/getProfile/signOut）。
	 */
	private async refreshDshAccount(): Promise<void> {
		try {
			const status = await this.dshClientService.getStatus();
			if (!status.connected) {
				// 未连 Host：保持可用但未登录，且不打日志（避免轮询刷屏）。
				this.dshAccount = { signedIn: false, unavailable: true, name: '', contact: '', avatarUrl: '' };
				this.updateAvatar();
				return;
			}
			const res = await this.dshClientService.call<{ status?: string }>('accountGetState', { client: dshAccountClientMetadata(this.dshLocale()) });
			if (!res.ok) {
				this.dshAccount = { signedIn: false, unavailable: true, name: '', contact: '', avatarUrl: '' };
				this.updateAvatar();
				return;
			}
			// `AccountView.status` = 'signed-out' | 'credential-stored'（E1 types.ts:38-42）。
			const stored = res.value?.status === 'credential-stored';
			let name = '';
			let contact = '';
			let avatarUrl = '';
			if (stored) {
				const meta = dshAccountClientMetadata(this.dshLocale());
				// 官方 `getProfile` 返回 `{ status:'ready', value: AccountProfile }`（E1
				// `deepseek-account/src/types.ts` AccountDetails），必须剥一层 `.value`。
				const profile = await this.dshClientService.call<{ status?: string; value?: { name?: string | null; contact?: string | null; avatarUrl?: string | null } }>(
					'accountGetProfile', { client: meta });
				const p = profile.ok && profile.value?.status === 'ready' ? profile.value.value : undefined;
				if (p) {
					name = typeof p.name === 'string' ? p.name : '';
					contact = typeof p.contact === 'string' ? p.contact : '';
					avatarUrl = this.safeAvatar(typeof p.avatarUrl === 'string' ? p.avatarUrl : '');
				}
			}
			this.dshAccount = { signedIn: stored, unavailable: false, name, contact, avatarUrl };
		} catch (error) {
			this.logService.error(error);
			this.dshAccount = { signedIn: false, unavailable: true, name: '', contact: '', avatarUrl: '' };
		}
		this.updateAvatar();
	}

	private async signInDsh(): Promise<void> {
		// 官方登录是「浏览器授权」流程（`account/startSignIn` → 打开 authorizeUrl → 回调）。
		// 完整实现见后续轮次；此处给出明确可用入口（打开官方 usage 页），避免死路。
		try {
			const res = await this.dshClientService.call<{ links?: { usageUrl?: string } }>('accountGetState', { client: dshAccountClientMetadata(this.dshLocale()) });
			const usage = res.ok ? res.value?.links?.usageUrl : undefined;
			if (usage) { await this.openerService.open(URI.parse(usage)); }
		} catch (error) {
			this.logService.error(error);
		}
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

	/**
	 * 左键 = 打开 DeepSeek-Harness 桌面端（用户指定：账号头像即桌面端入口）。
	 * 走 DSH 桌面端**自己注册**的 `dsh` 协议：它启动时 `setAsDefaultProtocolClient('dsh')`，
	 * 收到 `dsh://open` 会 `focusPrimaryWindow()`；且主进程持有单实例锁
	 * （`requestSingleInstanceLock` + `second-instance`），所以已开着时是「聚焦」而非再开一个；
	 * 没开着时由 ShellExecute 直接把它拉起来。两种情况都不需要另造启动通道。
	 * 账号菜单仍可从右键（CONTEXT_MENU）进入，登录态/账号信息不丢。
	 */
	protected override onLeftClick(): void {
		void this.openDshDesktop();
	}

	private async openDshDesktop(): Promise<void> {
		// 自定义 scheme 不在 shouldOpenExternal 的默认白名单（mailto/http/https/vsls）内，
		// 必须显式 openExternal:true，否则会被当作「未知协议」静默吞掉。
		// skipValidation：dsh 协议没有可信域名语义，不需要弹「是否打开外部网站」。
		try {
			await this.openerService.open(DSH_DESKTOP_OPEN_URL, { openExternal: true, skipValidation: true });
		} catch (error) {
			// 走到这里说明 ShellExecute 失败：主进程 doOpenShellExternal 已经弹过错误框，
			// 这里只负责留痕，不再叠一层通知。
			this.logService.error('[dsh] failed to open DeepSeek-Harness desktop', error);
		}
	}

	/** 悬停提示：账号按钮现在是「打开桌面端」入口，提示要把这件事说清楚。 */
	protected override computeTitle(): string {
		const acc = this.dshAccount;
		const openDesktop = localize('dshOpenDesktop', "打开 DeepSeek-Harness 桌面端");
		if (acc?.signedIn) {
			const name = acc.name || 'DeepSeek';
			const who = acc.contact && acc.contact !== name ? `${name} (${acc.contact})` : name;
			return `${openDesktop} - ${who}`;
		}
		return openDesktop;
	}

		protected override async resolveMainMenuActions(_accountsMenu: IMenu, disposables: DisposableStore): Promise<IAction[]> {
		return this.buildAccountActions(disposables);
	}

	/**
	 * 账号动作（未登录→登录；已登录→名称/联系方式）。左键菜单与右键菜单共用同一份实现，
	 * 避免两处文案/可用性漂移。
	 */
	private async buildAccountActions(disposables: DisposableStore): Promise<IAction[]> {
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
		// 按用户要求：不再提供「退出登录」入口（账号由 DSH 桌面 App 管理）。
		return actions;
	}

	/**
	 * 右键菜单：账号操作（登录/账号名）放在最前，其后是常规的隐藏账号/Manage。
	 * 左键已改为打开桌面端，所以这里是账号菜单**唯一**入口，必须带完整的账号动作，
	 * 登录入口才不会随左键改行为而失联。
	 */
	protected override async resolveContextMenuActions(disposables: DisposableStore): Promise<IAction[]> {
		const accountActions = await this.buildAccountActions(disposables);
		const actions = await super.resolveContextMenuActions(disposables);
		this.fillContextMenuActions(actions);
		// 账号动作在前（用户最常找）；其后接「设置」，再接从齿轮 Manage 菜单并过来的整份
		// `MenuId.GlobalActivity` 项（扩展 / 主题 / 同步 / 配置文件等），最后是常规的隐藏账号项。
		// 齿轮按钮已不再渲染，所以这里是这些入口的唯一去处——不能只留下「设置」一项。
		const manageActions = await this.buildManageMenuActions(disposables);
		return [...accountActions, this.settingsAction(), new Separator(), ...manageActions, new Separator(), ...actions];
	}

	/**
	 * 取齿轮 Manage 菜单（`MenuId.GlobalActivity`）的全部动作，供账号右键菜单承载。
	 * 齿轮按钮不再渲染后，这些入口（扩展、主题、同步、配置文件、更新等）必须仍有归宿。
	 */
	private async buildManageMenuActions(disposables: DisposableStore): Promise<IAction[]> {
		const menu = disposables.add(this.accountMenuService.createMenu(MenuId.GlobalActivity, this.accountContextKeyService));
		// 与齿轮菜单同一渲染口径：主分组在前，次级动作在后。
		const { primary, secondary } = getActionBarActions(menu.getActions({ renderShortTitle: true }));
		return [...primary, ...secondary];
	}

	/**
	 * 「设置」入口：与齿轮 Manage 菜单里的 `workbench.action.openSettings` 同一命令，
	 * 不复制设置界面，只把入口放到账号菜单里（用户指定位置）。
	 */
	private settingsAction(): IAction {
		// 与同文件的 `hideAccounts` / `toggle.hideAccounts` 一致：`toAction` 的结果不登记 disposable，
		// 它不持有需要释放的资源（`IAction` 本身没有 dispose）。
		return toAction({
			id: 'dsh.account.openSettings',
			label: localize('dshOpenSettings', "设置"),
			run: () => { void this.commandService.executeCommand('workbench.action.openSettings'); },
		});
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
		@IDshClientService dshClientService: IDshClientService,
		@IOpenerService openerService: IOpenerService,
		@ICommandService commandService: ICommandService,
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
			}, () => undefined, actions => actions, themeService, lifecycleService, hoverService, contextMenuService, menuService, contextKeyService, configurationService, keybindingService, logService, activityService, instantiationService, requestService, dshClientService, openerService, commandService);
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
