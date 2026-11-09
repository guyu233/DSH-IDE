/**
 * DSH-IDE client half（DSH Web 客户端模块）。
 *
 * 在会话头部工具区（slot `conversation.session.header.utilities`，即右上角工具条）注册一个「DSH-IDE」按钮。
 *
 * 开窗路径（P5，用户授权先于 K5 实施）：按钮 → `remote.ide.launch(workspace)` →
 * Host 半身的 `IdeRemoteService.launch()` → 已有 IDE 报到则转发开窗，否则物化 Electron 主页
 * 并拉起插件载荷 → IDE 进程在自己的窗口里开窗。承载形态为原生窗口（不使用 iframe 页面）。
 * 为什么绕 Host：本文件跑在 DSH Web 渲染进程，碰不到 IDE 主进程的 `dshIde` 通道，
 * 只能经官方 Typert Gateway 调 Host 服务（R0：复用官方机制，不自造传输）。
 *
 * **命名空间必须先挂载**：客户端能看到的 `remote.<namespace>` 由 `remote.$mount(contribution)`
 * 装出来的（官方 `api-gateway.client.mountContribution`）。本文件因此手写 `IDE_REMOTE`
 * contribution（与官方 dsh-ops 的写法一致），在 apply() 里先挂载、再注册按钮；
 * 不挂载时 `remote.ide` 根本不存在，按钮点了会抛同步 TypeError（真机踩过）。
 *
 * 图标复用宿主官方鲸鱼组件 `FishLogo`（`@deepseek-ai/dsh-client-ui-primitives`，`currentColor`
 * 自适应主题）；按钮复用同一包的 `Button`（ghost/sm），不手写样式。
 */
window.__ModuleLoader__.load({
	id: "dsh-ide",
	factory(require) {
		const React = require("react");
		const { Button, FishLogo } = require("@deepseek-ai/dsh-client-ui-primitives");
		const h = React.createElement;

		// ── 客户端 remote 贡献（对应 Host 的 `IdeRemoteService`，命名空间 `ide`） ──────────
		// 只声明本插件真正要调的三个方法；参数名必须等于 Host 方法的形参名（Typert 逐字段校验）。
		const jsonCodec = (name) => ({ mode: "strict", typeSymbol: `dsh-ide#${name}`, create: () => ({ parse: value => value }) });

		function directMethod(method, parameters) {
			return {
				id: `dsh-ide#ide/${method}`,
				service: "ide",
				namespace: "ide",
				method,
				invocation: { kind: "direct" },
				result: jsonCodec("IdeResult"),
				parameters: parameters.map(parameter => ({
					name: parameter.wire,
					wire: parameter.wire,
					source: "json",
					codec: jsonCodec(parameter.type),
				})),
			};
		}

		const IDE_REMOTE = Object.freeze({
			package: "dsh-ide",
			descriptors: Object.freeze([
				directMethod("launch", [
					{ wire: "workspace", type: "WorkspacePath" },
					{ wire: "sessionId", type: "SessionId" },
				]),
				directMethod("registerIdeClient", [{ wire: "clientId", type: "ClientId" }]),
				directMethod("pollLaunch", [{ wire: "clientId", type: "ClientId" }]),
			]),
		});

		// 插件上下文：`DshIdeButton` 在 factory 作用域定义，`ctx` 只在 apply() 里可见，
		// 用 factory 级变量传递（单一赋值点，不会出现两个上下文）。
		let pluginCtx;
		// 挂载结果：`remote.ide` 的解析原因与是否就绪（按钮据此给如实提示）。
		let ideNamespace;
		let mountFailure;

		// 挂载官方 Remote 命名空间（幂等）。失败返回原因字符串；成功返回 undefined。
		// 独立成函数：apply() 首次挂载，点击时若仍缺失再重试一次（HMR / Host 半身稍后加载）。
		async function mountIdeNamespace(ctx) {
			try {
				// `remote` 是客户端 Cordis 服务；按官方写法经 `ctx.get` 取得（点号属性访问受追踪）。
				const remote = ctx.get("remote") ?? ctx.remote;
				if (remote === undefined || typeof remote.$mount !== "function") {
					return "客户端 remote 服务不可用";
				}
				await remote.$mount(IDE_REMOTE);
				// 命名空间属性受追踪：必须在**本上下文**内解析一次后复用；渲染回调里读会抛。
				ideNamespace = ctx.get("remote.ide") ?? remote.ide;
				if (ideNamespace === undefined || typeof ideNamespace.launch !== "function") {
					return "remote.ide 未挂载成功";
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

		function DshIdeButton(props) {
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState(null);
			// 当前会话的工作区（与官方 open-in-app 同一来源：SessionSnapshot.cwd）。
			// 会话由 DSH 决定，按钮只把「当前工作区」原样转给 Host（不变量 I4）。
			const cwd = props.useSessions(state => state.byId[props.sessionId]?.cwd);
			const onClick = React.useCallback(async () => {
				if (busy) { return; }
				setBusy(true);
				setError(null);
				// `remote.<namespace>` 的属性访问是「受追踪」的，渲染回调里读不到；
				// 命名空间在 apply() 里解析一次。若当时 Host 还没就绪，这里再挂载一次。
				if (ideNamespace === undefined && pluginCtx !== undefined) {
					mountFailure = await mountIdeNamespace(pluginCtx);
				}
				if (ideNamespace === undefined) {
					setBusy(false);
					setError(mountFailure !== undefined
						? ("DSH-IDE Host 通道未就绪：" + mountFailure)
						: "DSH-IDE Host 通道未就绪：请重启 DSH 后重试");
					return;
				}
				withTimeout(
					// 会话由 DSH 决定（不变量 I4）：把当前会话 id 一并交给 Host，新窗口据此订阅该会话。
					// 不传 sessionId 时后端只订阅 `$events`，Chat 面板拿不到会话内容（K5 缺口）。
					ideNamespace.launch(
						typeof cwd === "string" && cwd !== "" ? cwd : undefined,
						typeof props.sessionId === "string" && props.sessionId !== "" ? props.sessionId : undefined,
					),
					LAUNCH_TIMEOUT_MS,
					"DSH Host 未响应：请重启 DSH 后重试",
				)
					.then(result => {
						setBusy(false);
						// 官方 `RemoteResult`：成功 `{ ok:true, value }`，失败 `{ ok:false, error }`。
						// Host 自己的 `launch()` 返回值在 `value` 里，再按 `{ ok, message }` 判定。
						if (result !== null && typeof result === "object" && result.ok === false) {
							const failure = result.error;
							setError((failure && (failure.message || failure.code)) || "开窗失败");
							return;
						}
						const payload = result !== null && typeof result === "object" ? result.value : undefined;
						if (payload !== null && typeof payload === "object" && payload.ok === true) { setError(null); return; }
						const message = payload !== null && typeof payload === "object" && typeof payload.message === "string"
							? payload.message
							: "开窗失败";
						setError(message);
					})
					.catch(err => {
						setBusy(false);
						setError((err && err.message) || String(err));
					});
			}, [busy, cwd, props.sessionId]);
			const label = error ? ("DSH-IDE 启动失败: " + error) : "在 DSH-IDE 中打开当前工作区";
			return h(Button, {
				variant: "ghost", size: "sm", className: "dsh-ide-open",
				title: label,
				"aria-label": label,
				disabled: busy, onClick,
				icon: h(FishLogo, { size: 16 }),
			});
		}

		return {
			// 需要 `remote` 才能挂载 Host 的 ide 命名空间（官方 Typert Gateway）。
			inject: ["slots", "remote"],
			async apply(ctx) {
				pluginCtx = ctx;

				// 先挂载命名空间：官方 `ctx.remote.$mount(contribution)` 会装出 `remote.ide` 服务。
				// 失败不静默：记下原因，点击时如实显示（并允许点击时再挂载一次）。
				mountFailure = await mountIdeNamespace(ctx);

				ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
					name: "conversation.session.header.utilities",
					id: "dsh-ide",
					// 紧邻「…」会话菜单（官方 `session-log-download`，order 0）：右侧第一个入口（order 1）。
					order: 1,
				}, DshIdeButton));
			},
		};
	},
});
