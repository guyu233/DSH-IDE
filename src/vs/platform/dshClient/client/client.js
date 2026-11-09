/**
 * DSH-IDE client half（DSH Web 客户端模块）。
 *
 * 在会话头部工具区（slot `conversation.session.header.utilities`，即右上角工具条）注册一个「DSH-IDE」按钮。
 *
 * 开窗路径（P5，用户授权先于 K5 实施）：按钮 → `ctx.remote.ide.launch(workspace)` →
 * Host 半身的 `IdeRemoteService.launch()` → 校验已发布的 IDE 端点 → IDE 主进程开窗。
 * 为什么绕 Host：本文件跑在 DSH Web 渲染进程，碰不到 IDE 主进程的 `dshIde` 通道，
 * 只能经官方 Typert Gateway 调 Host 服务（R0：复用官方机制，不自造传输）。
 *
 * 图标使用 DSH 官方鲸鱼图形（取自 dsh-web-frontend/favicon.svg）；按钮复用宿主
 * `@deepseek-ai/dsh-client-ui-primitives` 的 `Button`（ghost/sm），不手写样式。
 */
window.__ModuleLoader__.load({
	id: "dsh-ide",
	factory(require) {
		const React = require("react");
		const { Button } = require("@deepseek-ai/dsh-client-ui-primitives");
		const h = React.createElement;

		// DSH 官方鲸鱼 LOGO：**直接引用宿主的官方资源** `/favicon.svg`（E1 `apps/web/public/favicon.svg`，
		// Host 以 `/favicon.svg` 提供，实测 200 + `image/svg+xml`）。不再内联 path 数据（T11-02），
		// 图标只有一处来源，随宿主升级自动更新（R-06 资源复用）。
		function WhaleLogo({ size = 16 }) {
			return h("img", {
				src: "/favicon.svg", alt: "", width: size, height: size, "aria-hidden": true,
				style: { display: "block", flex: "none", objectFit: "contain" },
			});
		}

		// 插件上下文：`DshIdeButton` 在 factory 作用域定义，`ctx` 只在 apply() 里可见，
		// 用 factory 级变量传递（单一赋值点，不会出现两个上下文）。
		let pluginCtx;

		function DshIdeButton(props) {
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState(null);
			const onClick = React.useCallback(() => {
				if (busy) { return; }
				setBusy(true);
				setError(null);
				const workspace = props && typeof props.workspace === "string" ? props.workspace : undefined;
				Promise.resolve(pluginCtx.remote.ide.launch(workspace))
					.then(result => {
						setBusy(false);
						if (result && result.ok === true) { setError(null); return; }
						setError((result && result.message) || "未知错误");
					})
					.catch(err => {
						setBusy(false);
						setError((err && err.message) || String(err));
					});
			}, [busy, props, error]);
			return h(Button, {
				variant: "ghost", size: "sm", className: "dsh-ide-open",
				title: error ? ("DSH-IDE 启动失败: " + error) : "在 DSH-IDE 中打开（当前工作区）",
				"aria-label": error ? ("DSH-IDE 启动失败: " + error) : "在 DSH-IDE 中打开",
				disabled: busy, onClick,
				icon: h(WhaleLogo, { size: 14 }),
			}, h("span", null, "DSH-IDE"), error ? h("span", { style: { color: "var(--vscode-errorForeground, #f48771)" } }, "\u26a0") : null);
		}

		return {
			// 需要 `remote` 才能调 Host 的 ide.launch（官方 Typert Gateway）。
			inject: ["slots", "remote"],
			apply(ctx) {
				pluginCtx = ctx;
				ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
					name: "conversation.session.header.utilities",
					id: "dsh-ide",
					order: -9,
				}, DshIdeButton));
			},
		};
	},
});
