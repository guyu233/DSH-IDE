/**
 * Locale seat for the sidecar chat-render bundle.
 *
 * The copied ui-chat leaves receive `t` as a plain prop. This module owns the
 * DEFAULT instance so the VS Code single seam in `chatListRenderer.ts` never
 * has to construct one (and never imports React/JSX or any DSH locale package).
 *
 * Dictionaries, in priority order:
 *   1. ../src/locale.ts  — the copied, unmodified ui-chat `zh` / `en`
 *      dictionaries (chat namespace, 196 keys each).
 *   2. A small bridge dictionary below for the ~10 primitive-level keys that
 *      originally lived in `@deepseek-ai/dsh-client-locale` (outside ui-chat)
 *      and are referenced by markdown-labels.ts / token-format.ts. Those
 *      strings are transcribed from
 *      E:/deepseek-harness/packages/client/locale/src/locales/{en,zh}.ts
 *      (authoritative source, read-only) — see PROVENANCE.md.
 *
 * Interpolation: `{name}` placeholders are replaced from `params`. Unknown
 * keys degrade to the key itself rather than throwing (streaming must never
 * break on a missing locale entry).
 */

import { en as chatEn, zh as chatZh } from '../src/locale.ts'

export type LocaleId = 'en' | 'zh'

export type TranslateParams = Record<string, string | number>

export interface Translate {
  (key: string, params?: TranslateParams): string
  /** Currently active locale id (read-only). */
  readonly locale: LocaleId
}

/** Primitive-level keys supplied by DSH's global locale package, not ui-chat. */
const PRIMITIVE_EN: Record<string, string> = {
  copy: 'Copy',
  copied: 'Copied',
  'codeBlock.title': 'Code block',
  'codeBlock.wrap': 'Wrap lines',
  'codeBlock.unwrap': 'Unwrap lines',
  'markdown.footnotes': 'Footnotes',
  'number.thousand': '{value}K',
  'number.million': '{value}M',
}

const PRIMITIVE_ZH: Record<string, string> = {
  copy: '复制',
  copied: '已复制',
  'codeBlock.title': '代码块',
  'codeBlock.wrap': '自动换行',
  'codeBlock.unwrap': '取消换行',
  'markdown.footnotes': '脚注',
  'number.thousand': '{value}K',
  'number.million': '{value}M',
}

const EN: Record<string, string> = { ...PRIMITIVE_EN, ...chatEn }
const ZH: Record<string, string> = { ...PRIMITIVE_ZH, ...chatZh }

const DICTIONARIES: Record<LocaleId, Record<string, string>> = { en: EN, zh: ZH }

/** VS Code's `vscode.env.language` values look like `zh-cn`, `en`, `fr`, ... */
export function normalizeLocale(value: string | undefined): LocaleId {
  const lower = (value ?? '').toLowerCase()
  return lower.startsWith('zh') ? 'zh' : 'en'
}

export function createTranslate(locale: LocaleId = 'en'): Translate {
  const dict = DICTIONARIES[locale] ?? EN
  const t = ((key: string, params?: TranslateParams): string => {
    const template = dict[key]
    if (template === undefined) return key
    if (params === undefined) return template
    return template.replace(/\{([A-Za-z_$][\w$]*)\}/g, (match, name: string) => {
      const value = params[name]
      return value === undefined ? match : String(value)
    })
  }) as Translate
  Object.defineProperty(t, 'locale', { value: locale, enumerable: true })
  return t
}

/** Default instance; `setLocale()` swaps it for all later mounts. */
let current: Translate = createTranslate('en')

export const t: Translate = ((key: string, params?: TranslateParams): string =>
  current(key, params)) as Translate

Object.defineProperty(t, 'locale', { enumerable: true, get: () => current.locale })

/** Switch the default locale. Existing mounted parts pick it up on next update(). */
export function setLocale(locale: LocaleId | string): LocaleId {
  const id = normalizeLocale(typeof locale === 'string' ? locale : locale)
  current = createTranslate(id)
  return id
}

export function getLocale(): LocaleId {
  return current.locale
}

export { EN as enDictionary, ZH as zhDictionary }
