// 按 DSH 设置里的界面语言，准备 IDE 语言包并改 IDE 显示语言。DSH 是唯一来源。

import { applyIdeDisplayLocale, ideExtensionsDir, ideUserDataDir, localePreferenceFromRows, normalizeLocalePreference, readIdeDisplayLocale } from '../../common/dshLanguagePreference.js';
import { ensureLanguagePack } from '../../common/dshLanguagePacks.js';

/** DSH 语言 id → argv.json 里写的显示语言 id。 */
function targetLocaleId(preference) {
	switch (normalizeLocalePreference(preference)) {
		case 'zh': return 'zh-cn';
		case 'pt': return 'pt-br';
		case 'ja': return 'ja';
		case 'es': return 'es';
		case 'fr': return 'fr';
		case 'de': return 'de';
		case 'ru': return 'ru';
		default: return 'en';
	}
}

/**
 * 轮询 Host 设置里的 `locale.preference`，变化时准备语言包并写 IDE 的 argv.json。
 *
 * 与外观同步同一节奏：只在值变化时动手。语言包是按需下载的（每个约 2 MiB），
 * 装好后不再联网；下载失败只记录一次，不阻塞 IDE、也不假装语言已切换。
 * @param {{ get?: (name: string) => unknown }} ctx
 * @returns {() => void}
 */
export function watchLanguagePreference(ctx) {
	let last = '';
	let missingPack = '';
	let preparing = false;
	const tick = async () => {
		if (preparing) {
			return;
		}
		let preference;
		try {
			const settings = typeof ctx.get === 'function' ? ctx.get('settings') : undefined;
			if (settings === undefined || settings === null || typeof settings.describe !== 'function') {
				return;
			}
			preference = localePreferenceFromRows(settings.describe());
		} catch {
			// 设置服务还没挂上，下一轮再读。
			return;
		}
		const key = normalizeLocalePreference(preference) ?? 'en';
		if (key === last) {
			return;
		}
		preparing = true;
		try {
			const userDataDir = ideUserDataDir();
			const pack = await ensureLanguagePack(preference, { extensionsDir: ideExtensionsDir(userDataDir) });
			// `skipped` 是「这门语言不需要语言包」（en / 未知）；只有真正失败才拦住写入，
			// 否则切回英文时旧 locale 永远删不掉。
			if (pack.ok !== true) {
				if (key !== missingPack) {
					// 语言包没准备好：不写 argv.json，IDE 保持原语言并记录一次原因。
					missingPack = key;
					console.warn(`[dsh-ide] IDE language pack is not ready for "${key}": ${pack.reason}`);
				}
				return;
			}
			const result = applyIdeDisplayLocale(preference, { userDataDir });
			if (!result.changed) {
				// argv.json 写不进去（被占用/格式坏了）：下一轮再试，不把 last 推进。
				return;
			}
			last = key;
			// 显示语言只在启动时读取：值真的变了才需要重载，否则每轮都会多一条提示。
			const previous = result.previous ?? readIdeDisplayLocale(userDataDir);
			if (previous !== targetLocaleId(preference)) {
				console.log(`[dsh-ide] IDE display language -> ${targetLocaleId(preference)}; reopen the IDE window to apply it`);
			}
			missingPack = '';
		} finally {
			preparing = false;
		}
	};
	void tick();
	const timer = setInterval(() => void tick(), 1500);
	if (typeof timer.unref === 'function') {
		timer.unref();
	}
	return () => clearInterval(timer);
}
