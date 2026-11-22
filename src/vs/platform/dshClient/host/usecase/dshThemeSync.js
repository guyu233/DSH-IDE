// 按 DSH 设置里的外观，改 IDE 用户设置。DSH 是唯一来源。

import { themePreferenceFromRows, writeIdeThemeSettings } from '../../common/dshThemePreference.js';

/**
 * @param {{ get?: (name: string) => unknown }} ctx
 * @returns {() => void}
 */
export function watchThemePreference(ctx) {
	let last = '';
	const tick = () => {
		try {
			const settings = typeof ctx.get === 'function' ? ctx.get('settings') : undefined;
			if (settings === undefined || settings === null || typeof settings.describe !== 'function') {
				return;
			}
			const preference = themePreferenceFromRows(settings.describe());
			if (preference === last) {
				return;
			}
			if (writeIdeThemeSettings(preference)) {
				last = preference;
			}
		} catch {
			// 设置服务还没挂上，下一轮再读。
		}
	};
	tick();
	const timer = setInterval(tick, 1500);
	if (typeof timer.unref === 'function') {
		timer.unref();
	}
	return () => clearInterval(timer);
}
