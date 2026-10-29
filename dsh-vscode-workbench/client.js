/**
 * Client half of @local/dsh-vscode-workbench.
 *
 * 形态（按最终需求）：
 *  - 侧栏不再有「VS Code」按钮，也没有 iframe 内嵌面板；
 *  - 在会话的「对话 / 轨迹 / 上下文 / 编队」这排 Tab 之后，追加一个「DSH-IDE」标签；
 *  - 点击该标签 => 调用 Host 的 POST /dsh-ide-launch 打开**独立的原生 IDE 窗口**
 *    （dsh-ide：复用 DSH 自带 Electron 运行时 + 我们编译好的 VS Code 桌面版），
 *    随后自动切回「对话」视图，不在主面板里留占位界面。
 */
window.__ModuleLoader__.load({
	id: 'dsh-ide',
	factory(require) {
		const React = require('react');
		const h = React.createElement;

		// DSH 鲸鱼 logo（取自 DSH favicon 的 FishLogo 路径），fill 跟随当前文字色。
		function DshLogo({ size = 16, style }) {
			return h('svg', {
				viewBox: '0 0 23.16 17.04',
				width: size, height: (size * 17.04) / 23.16,
				fill: 'currentColor', 'aria-hidden': true,
				style: style,
			}, h('path', {
				d: 'M22.62 7.02c-1.53 0-2.79.63-3.78 1.62a9.4 9.4 0 0 1-2.16 1.53c.18-1.17.13-2.4-.18-3.6-.62-2.42-2.06-4.55-4.09-6.02L11.1.15c-.24-.2-.6-.2-.83.02C8.9 1.4 7.75 3.02 7.1 4.83c-.5 1.4-.68 2.9-.55 4.38.06.7.22 1.4.44 2.07-.6-.35-1.16-.76-1.66-1.24-.95-.9-2.13-1.47-3.6-1.47-.55 0-1 .45-1 1 0 2.2 1.2 4.13 2.98 5.18a7.5 7.5 0 0 0 3.6.92c.7 0 1.38-.1 2.03-.27 1.06.9 2.36 1.45 3.78 1.45 1.1 0 2.14-.3 3.03-.82.9-.53 1.62-1.28 2.06-2.18h3.28c.3 0 .54-.24.54-.54V7.56c0-.3-.24-.54-.54-.54z',
			}));
		}

		// DSH-IDE 视图：作为「按钮式」标签，挂载即开窗 + 切回对话。
		function DshIdeLauncherView(props) {
			const fired = React.useRef(false);
			const [state, setState] = React.useState({ phase: 'idle', message: '' });

			const launch = React.useCallback(async () => {
				setState({ phase: 'launching', message: '正在打开 DSH IDE 窗口…' });
				// 把当前会话 id 传给 Host，让 IDE 打开「当前工作区」而非固定目录。
				const sessionId = props && props.sessionId ? String(props.sessionId) : undefined;
				try {
					const res = await fetch('/dsh-ide-launch', {
						method: 'POST',
						cache: 'no-store',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(sessionId ? { sessionId } : {}),
					});
					const data = await res.json().catch(() => ({}));
					if (!res.ok || data.error) {
						setState({ phase: 'error', message: String(data.error || ('HTTP ' + res.status)) });
					} else {
						const where = data.folder ? '（' + data.folder + '）' : '';
						setState({ phase: 'done', message: '已在独立窗口打开 DSH IDE' + where });
					}
				} catch (e) {
					setState({ phase: 'error', message: String(e && e.message ? e.message : e) });
				}
				// 稍等片刻让用户看到提示，然后自动回到「对话」，不占主面板。
				setTimeout(() => {
					try { props.openView && props.openView('chat', ''); } catch { /* ignore */ }
				}, 700);
			}, []);

			React.useEffect(() => {
				if (fired.current) return;
				fired.current = true;
				void launch();
			}, []);

			const tone = state.phase === 'error' ? '#ff6b6b' : 'inherit';
			return h('div', {
				style: {
					display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
					height: '100%', gap: '12px', font: '13px/1.5 system-ui, sans-serif', color: tone, opacity: 0.9,
				},
			}, [
				h(DshLogo, { key: 'logo', size: 44 }),
				h('div', { key: 'msg' }, state.message || '正在打开 DSH IDE…'),
				state.phase === 'error' ? h('button', {
					key: 'retry',
					onClick: () => { void launch(); },
					style: {
						cursor: 'pointer', border: '1px solid rgba(128,128,128,.4)', background: 'transparent',
						color: 'inherit', borderRadius: '6px', padding: '4px 12px', font: 'inherit',
					},
				}, '重试') : null,
			]);
		}

		return {
			inject: ['slots', 'layout'],
			apply(ctx) {
				try { window.__dsh_layout = ctx.layout; } catch { /* ignore */ }

				// 在「编队」之后追加 DSH-IDE 标签（conversation.view 现有 order：chat0/trajectory10/context20/fleet30）。
				ctx.slots.inject('conversation.view', () => ctx.slots.register({
					name: 'conversation.view',
					id: 'dsh-ide',
					order: 40,
					label: () => 'DSH-IDE',
				}, DshIdeLauncherView));
			},
		};
	},
});
