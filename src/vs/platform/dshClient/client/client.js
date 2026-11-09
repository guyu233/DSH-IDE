/**
 * DSH-IDE client half（DSH Web 客户端模块）。
 *
 * 在会话头部工具区（slot `conversation.session.header.utilities`，即右上角工具条）注册一个「DSH-IDE」按钮。
 * 私有 HTTP launch 链已移除：点击按钮显式报错（launch chain removed; pending DshIdeChannel.open），
 * 待 P5 接通 `dshIde` 通道开窗后改为经通道调用。图标使用 DSH 官方鲸鱼图形（取自 dsh-web-frontend/favicon.svg）；
 * 按钮复用宿主 `@deepseek-ai/dsh-client-ui-primitives` 的 `Button`（ghost/sm），不手写样式。
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

		function DshIdeButton(props) {
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState(null);
			const onClick = React.useCallback(() => {
				if (busy) { return; }
				setBusy(true);
				setError(null);
				setBusy(false);
				// 私有 HTTP launch 链已移除；开窗由 P5 经 `dshIde` 通道的 open 控制命令承担。
				throw new Error('launch chain removed; pending DshIdeChannel.open');
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
			inject: ["slots"],
			apply(ctx) {
				ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
					name: "conversation.session.header.utilities",
					id: "dsh-ide",
					order: -9,
				}, DshIdeButton));
			},
		};
	},
});
