/**
 * DSH-IDE client half（DSH Web 客户端模块）。
 *
 * 在会话头部工具区（slot `conversation.session.header.utilities`，即右上角工具条）注册一个「DSH-IDE」按钮。
 *
 * 开窗路径：按钮 → `remote.ide.launch(workspace, sessionId)` → Host 半身的
 * `IdeRemoteService.launch()` → 已有 IDE 报到则排队交给它，否则物化 Electron 主页并拉起插件载荷
 * → IDE 进程在自己的窗口里开窗。承载形态为原生窗口（不使用 iframe 页面）。
 * 为什么绕 Host：本文件跑在 DSH Web 渲染进程，碰不到 IDE 主进程的 `dshIde` 通道，
 * 只能经官方 Typert Gateway 调 Host 服务（复用官方机制，不自造传输）。
 *
 * **命名空间必须先挂载**：客户端能看到的 `remote.<namespace>` 由 `remote.$mount(contribution)`
 * 装出来的（官方 `api-gateway.client.mountContribution`）。本文件因此手写 `IDE_REMOTE`
 * contribution（与官方 dsh-ops 的写法一致），在 apply() 里先挂载、再注册按钮；
 * 不挂载时 `remote.ide` 根本不存在，按钮点了会抛同步 TypeError（真机踩过）。
 *
 * 控件与图标全部自绘：官方插件规范禁止 `require('@deepseek-ai/dsh-client-ui-primitives')`
 * 或加载任何 Harness Client 包（它们随版本变化，且组件抛错会让整个槽条目变空白）。
 * 按钮形态照搬该包的 ghost/sm 规格，类名与样式使用 `dsh-ide-` 前缀并只引用 `--dsw-alias-*`
 * 主题 token；鲸鱼图形来自随包 `resources/dsh/icon.svg`（官方 favicon 派生，来源见
 * `build/lib/dsh/ICON-PROVENANCE.md`）。
 *
 * 全部用户可见文案走 Client locale 服务（`ctx.locale`，en/zh 两套字典）。
 */
window.__ModuleLoader__.load({
	id: "dsh-ide",
	factory(require) {
		const React = require("react");
		const h = React.createElement;

		// ── 文案字典（八种语言必须同键；模板占位用 {name}） ──────────────────────
		const NS = "dsh-ide";
		const DICT_ZH = {
			"button.open": "在 DSH-IDE 中打开当前工作区",
			"button.starting": "正在启动 DSH-IDE…",
			"button.failed": "DSH-IDE 启动失败（悬停查看原因）",
			"button.failedDetail": "DSH-IDE 启动失败：{error}",
			"error.hostNotReady": "DSH-IDE Host 通道未就绪：{reason}",
			"error.hostNotReadyRetry": "DSH-IDE Host 通道未就绪：请重启 DSH 后重试",
			"error.launchTimeout": "DSH Host 未响应：请重启 DSH 后重试",
			"error.launchFailed": "开窗失败",
			"error.remoteUnavailable": "客户端 remote 服务不可用",
			"error.namespaceMissing": "remote.ide 未挂载成功",
			"button.queued": "已交给 DSH-IDE 窗口",
		};
		const DICT_EN = {
			"button.open": "Open current workspace in DSH-IDE",
			"button.starting": "Starting DSH-IDE…",
			"button.failed": "DSH-IDE failed to start (hover for the reason)",
			"button.failedDetail": "DSH-IDE failed to start: {error}",
			"error.hostNotReady": "DSH-IDE Host channel is not ready: {reason}",
			"error.hostNotReadyRetry": "DSH-IDE Host channel is not ready. Restart DSH and try again.",
			"error.launchTimeout": "DSH Host did not respond. Restart DSH and try again.",
			"error.launchFailed": "Could not open the window",
			"error.remoteUnavailable": "the Client remote service is unavailable",
			"error.namespaceMissing": "the remote.ide namespace did not mount",
			"button.queued": "Handed to the DSH-IDE window",
		};
		const DICT_JA = {
			"button.open": "現在のワークスペースを DSH-IDE で開く",
			"button.starting": "DSH-IDE を起動しています…",
			"button.failed": "DSH-IDE の起動に失敗しました（理由はホバーで表示）",
			"button.failedDetail": "DSH-IDE の起動に失敗しました：{error}",
			"error.hostNotReady": "DSH-IDE Host チャネルが準備できていません：{reason}",
			"error.hostNotReadyRetry": "DSH-IDE Host チャネルが準備できていません。DSH を再起動してから再試行してください",
			"error.launchTimeout": "DSH Host が応答しません。DSH を再起動してから再試行してください",
			"error.launchFailed": "ウィンドウを開けませんでした",
			"error.remoteUnavailable": "クライアントの remote サービスを利用できません",
			"error.namespaceMissing": "remote.ide のマウントに失敗しました",
			"button.queued": "DSH-IDE ウィンドウに渡しました",
		};
		const DICT_ES = {
			"button.open": "Abrir el área de trabajo actual en DSH-IDE",
			"button.starting": "Iniciando DSH-IDE…",
			"button.failed": "DSH-IDE no pudo iniciarse (pase el cursor para ver el motivo)",
			"button.failedDetail": "DSH-IDE no pudo iniciarse: {error}",
			"error.hostNotReady": "El canal Host de DSH-IDE no está listo: {reason}",
			"error.hostNotReadyRetry": "El canal Host de DSH-IDE no está listo. Reinicie DSH e inténtelo de nuevo.",
			"error.launchTimeout": "El Host de DSH no respondió. Reinicie DSH e inténtelo de nuevo.",
			"error.launchFailed": "No se pudo abrir la ventana",
			"error.remoteUnavailable": "el servicio remote del cliente no está disponible",
			"error.namespaceMissing": "el espacio de nombres remote.ide no se montó",
			"button.queued": "Entregado a la ventana de DSH-IDE",
		};
		const DICT_FR = {
			"button.open": "Ouvrir l’espace de travail actuel dans DSH-IDE",
			"button.starting": "Démarrage de DSH-IDE…",
			"button.failed": "Échec du démarrage de DSH-IDE (survolez pour voir la raison)",
			"button.failedDetail": "Échec du démarrage de DSH-IDE : {error}",
			"error.hostNotReady": "Le canal Host de DSH-IDE n’est pas prêt : {reason}",
			"error.hostNotReadyRetry": "Le canal Host de DSH-IDE n’est pas prêt. Redémarrez DSH, puis réessayez.",
			"error.launchTimeout": "Le Host DSH n’a pas répondu. Redémarrez DSH, puis réessayez.",
			"error.launchFailed": "Impossible d’ouvrir la fenêtre",
			"error.remoteUnavailable": "le service remote du client est indisponible",
			"error.namespaceMissing": "l’espace de noms remote.ide n’a pas été monté",
			"button.queued": "Transmis à la fenêtre DSH-IDE",
		};
		const DICT_DE = {
			"button.open": "Aktuellen Arbeitsbereich in DSH-IDE öffnen",
			"button.starting": "DSH-IDE wird gestartet…",
			"button.failed": "DSH-IDE konnte nicht starten (Grund beim Darüberfahren)",
			"button.failedDetail": "DSH-IDE konnte nicht starten: {error}",
			"error.hostNotReady": "Der DSH-IDE-Host-Kanal ist nicht bereit: {reason}",
			"error.hostNotReadyRetry": "Der DSH-IDE-Host-Kanal ist nicht bereit. Starten Sie DSH neu und versuchen Sie es erneut.",
			"error.launchTimeout": "Der DSH-Host hat nicht geantwortet. Starten Sie DSH neu und versuchen Sie es erneut.",
			"error.launchFailed": "Fenster konnte nicht geöffnet werden",
			"error.remoteUnavailable": "der Remote-Dienst des Clients ist nicht verfügbar",
			"error.namespaceMissing": "der Namensraum remote.ide wurde nicht eingehängt",
			"button.queued": "An das DSH-IDE-Fenster übergeben",
		};
		const DICT_RU = {
			"button.open": "Открыть текущую рабочую область в DSH-IDE",
			"button.starting": "Запуск DSH-IDE…",
			"button.failed": "Не удалось запустить DSH-IDE (наведите указатель, чтобы увидеть причину)",
			"button.failedDetail": "Не удалось запустить DSH-IDE: {error}",
			"error.hostNotReady": "Канал Host DSH-IDE не готов: {reason}",
			"error.hostNotReadyRetry": "Канал Host DSH-IDE не готов. Перезапустите DSH и повторите попытку.",
			"error.launchTimeout": "Host DSH не ответил. Перезапустите DSH и повторите попытку.",
			"error.launchFailed": "Не удалось открыть окно",
			"error.remoteUnavailable": "служба remote клиента недоступна",
			"error.namespaceMissing": "пространство имён remote.ide не смонтировано",
			"button.queued": "Передано окну DSH-IDE",
		};
		const DICT_PT = {
			"button.open": "Abrir a área de trabalho atual no DSH-IDE",
			"button.starting": "A iniciar o DSH-IDE…",
			"button.failed": "O DSH-IDE não conseguiu iniciar (passe o cursor para ver o motivo)",
			"button.failedDetail": "O DSH-IDE não conseguiu iniciar: {error}",
			"error.hostNotReady": "O canal Host do DSH-IDE não está pronto: {reason}",
			"error.hostNotReadyRetry": "O canal Host do DSH-IDE não está pronto. Reinicie o DSH e tente novamente.",
			"error.launchTimeout": "O Host do DSH não respondeu. Reinicie o DSH e tente novamente.",
			"error.launchFailed": "Não foi possível abrir a janela",
			"error.remoteUnavailable": "o serviço remote do cliente não está disponível",
			"error.namespaceMissing": "o espaço de nomes remote.ide não foi montado",
			"button.queued": "Entregue à janela do DSH-IDE",
		};




		// 模板替换交给官方 `t(key, params)`：字典里用 `{name}` 占位，框架按当前语言插值。
		// 这里不再自带第二套插值实现（同一能力只保留一处）。

		// ── 官方鲸鱼图形（与 resources/dsh/icon.svg 同一路径，currentColor 自适应主题） ──
		const WHALE_VIEW_BOX = "0 0 50 50";
		const WHALE_PATH = "M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z";

		function WhaleIcon() {
			return h("svg", {
				viewBox: WHALE_VIEW_BOX,
				width: 16,
				height: 16,
				"aria-hidden": true,
				focusable: false,
				style: { display: "block", flex: "none" },
			}, h("path", { d: WHALE_PATH, fill: "currentColor" }));
		}

		// ── 客户端 remote 贡献（对应 Host 的 `IdeRemoteService`，命名空间 `ide`） ──────────
		// 只声明本文件真正要调的一个方法；参数名必须等于 Host 方法形参名（Typert 逐字段校验）。
		// 参数 codec 必须做真实校验：`mode: 'strict'` 是 Gateway 客户端的硬要求，恒等 `parse`
		// 只是伪装成 strict，传错类型不会有任何本地提示。
		function optionalStringCodec(name) {
			return {
				mode: "strict",
				typeSymbol: `dsh-ide#${name}`,
				create: () => ({
					parse(value) {
						if (value === undefined || typeof value === "string") {
							return value;
						}
						throw new TypeError(`dsh-ide: ${name} must be a string when provided`);
					},
				}),
			};
		}

		const IDE_REMOTE = Object.freeze({
			package: "dsh-ide",
			descriptors: Object.freeze([
				{
					id: "dsh-ide#ide/launch",
					service: "ide",
					namespace: "ide",
					method: "launch",
					invocation: { kind: "direct" },
					// 结果由 Host 的 `{ ok, message, ... }` 自行解释；不在客户端伪装强解码。
					result: { mode: "src-json" },
					parameters: [
						{ name: "workspace", wire: "workspace", source: "json", codec: optionalStringCodec("WorkspacePath") },
						{ name: "sessionId", wire: "sessionId", source: "json", codec: optionalStringCodec("SessionId") },
					],
				},
			]),
		});

		// 插件上下文：`DshIdeButton` 在 factory 作用域定义，`ctx` 只在 apply() 里可见，
		// 用 factory 级变量传递（单一赋值点，不会出现两个上下文）。
		let pluginCtx;
		// 字典绑定：apply() 里 `ctx.locale.bind(NS)` 的结果，供注入座位缺失时兜底。
		let fallbackT = (key, _params) => key;
		// 挂载结果：`remote.ide` 的解析原因与是否就绪（按钮据此给如实提示）。
		let ideNamespace;
		let mountFailure;

		// 挂载官方 Remote 命名空间（幂等）。失败返回原因字符串；成功返回 undefined。
		// 独立成函数：apply() 首次挂载，点击时若仍缺失再重试一次（HMR / Host 半身稍后加载）。
		async function mountIdeNamespace(ctx, t) {
			try {
				// `remote` 是客户端 Cordis 服务；按官方写法经 `ctx.get` 取得（点号属性访问受追踪）。
				const remote = ctx.get("remote") ?? ctx.remote;
				if (remote === undefined || typeof remote.$mount !== "function") {
					return t("error.remoteUnavailable");
				}
				await remote.$mount(IDE_REMOTE);
				// 命名空间属性受追踪：必须在**本上下文**内解析一次后复用；渲染回调里读会抛。
				ideNamespace = ctx.get("remote.ide") ?? remote.ide;
				if (ideNamespace === undefined || typeof ideNamespace.launch !== "function") {
					return t("error.namespaceMissing");
				}
				return undefined;
			} catch (error) {
				return (error && error.message) || String(error);
			}
		}

		// 开窗调用必须有上限：官方 RPC 在 Host 无响应时可能一直不返回（不是 reject），
		// 按钮会永久停在 disabled。超时后按失败处理并复位。
		const LAUNCH_TIMEOUT_MS = 15000;
		function withTimeout(promise, timeoutMs, message) {
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
				Promise.resolve(promise).then(
					value => { clearTimeout(timer); resolve(value); },
					reason => { clearTimeout(timer); reject(reason); },
				);
			});
		}

		/**
		 * ghost/sm 按钮的规格，逐条照搬官方 primitives 的
		 * `_button_1ulci_2` / `_sm_1ulci_28` / `_ghost_1ulci_46`（取自宿主 CSS bundle）：
		 *   base: box-sizing/display/align/gap/border/radius/cursor/font/color/background/padding
		 *   sm:   height 28px; font-size 12px; line-height 18px; padding 0 10px; radius --dsw-radius-sm
		 *   ghost: 默认透明，hover/active 用 interactive-bg-* 两个 token
		 * 令牌都带真实默认值（8px 与官方定义一致），主题缺失时不会退化成直角。
		 */
		const BUTTON_STYLE = {
			boxSizing: "border-box",
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			gap: 4,
			height: 28,
			padding: "0 10px",
			border: "none",
			borderRadius: "var(--dsw-radius-sm, 8px)",
			background: "transparent",
			color: "var(--dsw-alias-label-primary)",
			cursor: "pointer",
			// 只继承字体族，别用 `font` 简写：简写会把 font-weight/style/variant 一并重置为
			// inherit，而官方只写了全局 `button { font-family: inherit }`，字重保持默认。
			fontFamily: "inherit",
			fontSize: 12,
			lineHeight: "18px",
		};

		/** 只在组件存活期间存在的样式：卸载即移除，不改宿主全局样式表。 */
		function ButtonStyles() {
			// hover/active/disabled 与官方 ghost 按钮逐条对应。
			//
			// 键盘焦点用官方**按钮类**的做法（`_save_*` / `_helpButton_*` / `_actionButton_*` 都是
			// `outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, …)` + offset）。
			// 先前照搬的是**菜单项**（`_item_*` / `_danger_*`）的 `outline:none`——那套只适合
			// 有整行背景可依的列表项；本控件是 16px 图标按钮，只靠背景变化，键盘用户几乎看不出焦点在哪。
			return h("style", null,
				".dsh-ide-open:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);}" +
				".dsh-ide-open:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active);}" +
				".dsh-ide-open:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:2px;}" +
				".dsh-ide-open-failed{outline:var(--dsw-focus-ring-width) solid var(--dsw-alias-state-danger, var(--dsw-alias-state-business-primary));outline-offset:2px;}" +
				".dsh-ide-open:disabled{cursor:not-allowed;opacity:.4;}");
		}

		function DshIdeButton(props) {
			// `locale: NS` 让框架把字典注入成 `t`；闭包里绑定的同名函数是旧槽实现的兜底，
			// 保证任何情况下都不会回落到硬编码语言（两者读同一份字典）。
			const t = typeof props.t === "function" ? props.t : fallbackT;
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState(null);
			// 请求已被 Host 接收但窗口尚未开出来：给一次短暂确认，否则再点一次毫无反馈，
			// 用户会以为按钮坏了（Host 的 launch 一律异步排队，`opened` 恒为 false）。
			const [queued, setQueued] = React.useState(false);
			// 当前会话的工作区（与官方 open-in-app 同一来源：SessionSnapshot.cwd）。
			// 会话由 DSH 决定，按钮只把「当前工作区」原样转给 Host（不变量 I4）。
			const cwd = props.useSessions(state => state.byId[props.sessionId]?.cwd);
			const onClick = React.useCallback(async () => {
				if (busy) { return; }
				setBusy(true);
				setError(null);
				setQueued(false);
				// `remote.<namespace>` 的属性访问是「受追踪」的，渲染回调里读不到；
				// 命名空间在 apply() 里解析一次。若当时 Host 还没就绪，这里再挂载一次。
				if (ideNamespace === undefined && pluginCtx !== undefined) {
					mountFailure = await mountIdeNamespace(pluginCtx, t);
				}
				if (ideNamespace === undefined) {
					setBusy(false);
					setError(mountFailure !== undefined
						? t("error.hostNotReady", { reason: mountFailure })
						: t("error.hostNotReadyRetry"));
					return;
				}
				withTimeout(
					// 会话由 DSH 决定（不变量 I4）：把当前会话 id 一并交给 Host，新窗口据此订阅该会话。
					// 不传 sessionId 时后端只订阅状态事件，Chat 面板拿不到会话内容。
					ideNamespace.launch(
						typeof cwd === "string" && cwd !== "" ? cwd : undefined,
						typeof props.sessionId === "string" && props.sessionId !== "" ? props.sessionId : undefined,
					),
					LAUNCH_TIMEOUT_MS,
					t("error.launchTimeout"),
				)
					.then(result => {
						setBusy(false);
						// 官方 `RemoteResult`：成功 `{ ok:true, value }`，失败 `{ ok:false, error }`。
						// Host 自己的 `launch()` 返回值在 `value` 里，再按 `{ ok, message }` 判定。
						if (result !== null && typeof result === "object" && result.ok === false) {
							const failure = result.error;
							setError((failure && (failure.message || failure.code)) || t("error.launchFailed"));
							return;
						}
						const payload = result !== null && typeof result === "object" ? result.value : undefined;
						if (payload !== null && typeof payload === "object" && payload.ok === true) {
							setError(null);
							setQueued(true);
							return;
						}
						const message = payload !== null && typeof payload === "object" && typeof payload.message === "string"
							? payload.message
							: t("error.launchFailed");
						setError(message);
					})
					.catch(err => {
						setBusy(false);
						setError((err && err.message) || String(err));
					});
			}, [busy, cwd, props.sessionId, t]);
			// queued 只是确认，不是状态：2.5 秒后自动收回，按钮回到常态。
			React.useEffect(() => {
				if (!queued) { return undefined; }
				const timer = setTimeout(() => setQueued(false), 2500);
				return () => clearTimeout(timer);
			}, [queued]);
			// 按钮很窄，原始错误（可能是一整句 `no IDE process has registered yet; endpoint file
			// not found (looked in C:\…, C:\…)`）塞进去会把布局撑破、也读不懂。
			// 标签只给一句可读的结论，完整原因放 `title`，悬停可见。
			const label = error !== null
				? t("button.failed")
				: busy ? t("button.starting") : queued ? t("button.queued") : t("button.open");
			const tooltip = error !== null ? t("button.failedDetail", { error }) : label;
			// 屏幕阅读器读不到 `title`（悬停提示），所以错误态的 `aria-label` 必须给出完整原因；
			// 否则只念「悬停查看原因」，而这条路径根本没有悬停动作。
			const accessibleName = error !== null ? tooltip : label;
			return h(React.Fragment, null,
				h(ButtonStyles),
				h("button", {
					type: "button",
					className: error !== null ? "dsh-ide-open dsh-ide-open-failed" : "dsh-ide-open",
					style: BUTTON_STYLE,
					title: tooltip,
					"aria-label": accessibleName,
					"aria-busy": busy ? true : undefined,
					"aria-invalid": error !== null ? true : undefined,
					disabled: busy,
					onClick,
				}, h(WhaleIcon)),
			);
		}

		return {
			// `slots` 提供注册面，`remote` 提供 Host 的 ide 命名空间，`locale` 提供字典与 t 座位。
			inject: ["slots", "remote", "locale"],
			async apply(ctx) {
				pluginCtx = ctx;
				// 模块级引用必须每次 apply 重新解析：禁用→启用会复用同一个模块实例，
				// 旧的 `remote.ide` 属于上一个 Cordis 上下文（Host 重启后更是失效对象）。
				// 不重置的话，点击时的兜底逻辑看到「非 undefined」就会跳过重挂，直接调旧引用。
				ideNamespace = undefined;
				mountFailure = undefined;
				// 字典先注册：槽声明 `locale: NS` 后，框架会在渲染时注入 `t`。
				ctx.effect(() => ctx.locale.register(NS, { zh: DICT_ZH, en: DICT_EN, ja: DICT_JA, es: DICT_ES, fr: DICT_FR, de: DICT_DE, ru: DICT_RU, pt: DICT_PT }), "dsh-ide: dictionaries");
				const bound = ctx.locale.bind(NS);
				// `ctx.locale.bind(ns)` 返回的是 `(key, params) => translate(ns, key, params)`。
				// 必须把 `params` 透传下去，否则 `{reason}` / `{error}` 不会被替换，
				// 注入座位缺失时用户会看到字面量 `DSH-IDE 启动失败：{error}`。
				fallbackT = (key, params) => bound(key, params);

				// 先挂载命名空间：官方 `ctx.remote.$mount(contribution)` 会装出 `remote.ide` 服务。
				// 失败不静默：记下原因，点击时如实显示（并允许点击时再挂载一次）。
				mountFailure = await mountIdeNamespace(ctx, fallbackT);

				ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
					name: "conversation.session.header.utilities",
					id: "dsh-ide",
					// 紧邻「…」会话菜单（官方 `session-log-download`，order 0）：右侧第一个入口（order 1）。
					order: 1,
					locale: NS,
				}, DshIdeButton));
			},
		};
	},
});
