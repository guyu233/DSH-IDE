// chatapp/stubs/locale.ts
// locale 桩：本地化最小实现。键缺失时回落到 key 本身（不会抛错）。
//
// ui-* 大量使用 ctx.locale 与各包内 bind(NS) 的 t()。子应用无完整语言包，
// 这里提供可用的 t/bind；真实文案由 DSH 客户端包自带（其 NS 字典已内联在各自 client.js）。

import type { LocaleService } from '../types.js';

const FALLBACK: Record<string, string> = {
	'view.chat': 'Chat',
	'composer.placeholder': 'Send a message…',
};

function lookup(key: string): string {
	return FALLBACK[key] ?? key;
}

export function createLocaleStub(locale = 'en'): LocaleService {
	return {
		locale,
		t(key: string): string { return lookup(key); },
		bind(_ns: string): (key: string) => string {
			return (key: string) => lookup(key);
		},
	};
}
