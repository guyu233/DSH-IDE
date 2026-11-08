/**
 * DSH-IDE client half（DSH Web 客户端模块）。
 *
 * 在会话头部工具区（slot `conversation.session.header.utilities`，即右上角工具条）注册一个「DSH-IDE」按钮。
 * 第一批清理已移除私有 HTTP launch 链：点击按钮显式报错（launch chain removed; pending phase 2 DshIdeChannel.open），
 * 待阶段 2 DshIdeChannel 就位后改为此通道开窗。图标使用 DSH 官方鲸鱼图形（取自 dsh-web-frontend/favicon.svg）。
 */
window.__ModuleLoader__.load({
	id: "dsh-ide",
	factory(require) {
		const React = require("react");
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
				// 第一批清理：私有 HTTP launch 链已移除，开窗改由阶段 2 DshIdeChannel.open 承担。
				throw new Error('launch chain removed; pending phase 2 DshIdeChannel.open');
			}, [busy, props, error]);
			return h("button", {
				type: "button", className: "dsh-ide-open",
				title: error ? ("DSH-IDE 启动失败: " + error) : "在 DSH-IDE 中打开（当前工作区）",
				"aria-label": error ? ("DSH-IDE 启动失败: " + error) : "在 DSH-IDE 中打开",
				disabled: busy, onClick,
				style: {
					display: "inline-flex", alignItems: "center", gap: 6,
					height: 24, padding: "0 10px", margin: "0 2px",
					border: "0.5px solid var(--dsw-alias-border-l4, rgba(128,128,128,.35))",
					borderRadius: "var(--dsw-radius-sm, 6px)",
					background: "transparent", color: "inherit",
					cursor: busy ? "default" : "pointer", fontSize: 11, lineHeight: "16px", whiteSpace: "nowrap",
				},
			}, h(WhaleLogo, { size: 14 }), h("span", null, "DSH-IDE"), error ? h("span", { style: { color: "var(--vscode-errorForeground, #f48771)" } }, "\u26a0") : null);
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
