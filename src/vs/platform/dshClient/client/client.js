/**
 * DSH-IDE client half（DSH Web 客户端模块）。
 *
 * 在会话头部工具区（slot `conversation.session.header.utilities`，即右上角工具条）注册一个「DSH-IDE」按钮。
 *
 * 开窗路径（P5，用户授权先于 K5 实施）：按钮 → `ctx.remote.ide.launch(workspace)` →
 * Host 半身的 `IdeRemoteService.launch()` → 已有 IDE 报到则转发开窗，否则物化 Electron 主页
 * 并拉起插件载荷 → IDE 进程在自己的窗口里开窗。承载形态为原生窗口（不使用 iframe 页面）。
 * 为什么绕 Host：本文件跑在 DSH Web 渲染进程，碰不到 IDE 主进程的 `dshIde` 通道，
 * 只能经官方 Typert Gateway 调 Host 服务（R0：复用官方机制，不自造传输）。
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

		// 图标复用宿主官方鲸鱼图形组件 `FishLogo`（`fill="currentColor"`，随主题前景色自适应；
		// 资源与品牌由宿主维护，不在插件内复制 path 数据）。注释见文件头的 R0 说明。

		// 插件上下文：`DshIdeButton` 在 factory 作用域定义，`ctx` 只在 apply() 里可见，
		// 用 factory 级变量传递（单一赋值点，不会出现两个上下文）。
		let pluginCtx;

		function DshIdeButton(props) {
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState(null);
			// 当前会话的工作区（与官方 open-in-app 同一来源：SessionSnapshot.cwd）。
			// 会话由 DSH 决定，按钮只把「当前工作区」原样转给 Host（不变量 I4）。
			const cwd = props.useSessions(state => state.byId[props.sessionId]?.cwd);
			const onClick = React.useCallback(() => {
				if (busy) { return; }
				setBusy(true);
				setError(null);
				Promise.resolve(pluginCtx.remote.ide.launch(typeof cwd === "string" && cwd !== "" ? cwd : undefined))
					.then(result => {
						setBusy(false);
						if (result && result.ok === true) { setError(null); return; }
						setError((result && result.message) || "未知错误");
					})
					.catch(err => {
						setBusy(false);
						setError((err && err.message) || String(err));
					});
			}, [busy, cwd]);
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
			// 需要 `remote` 才能调 Host 的 ide.launch（官方 Typert Gateway）。
			inject: ["slots", "remote"],
			apply(ctx) {
				pluginCtx = ctx;
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
