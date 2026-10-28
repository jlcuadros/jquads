/**
 * Translations (José, 2026-10-25): Spanish, English, French, Italian, Russian,
 * German and Portuguese, selectable in ⚙ → language. Default: the device's
 * language if it is one of these, otherwise English.
 *
 * - Texts in the code: t('key', { placeholder: value }).
 * - Texts in index.html: elements carry data-i18n="key" (textContent),
 *   data-i18n-html="key" (innerHTML, for texts with markup), and
 *   data-i18n-title / data-i18n-aria (title / aria-label attributes);
 *   applyStaticTranslations() fills them in.
 * - Every language must define exactly the keys of the Spanish file (es.ts):
 *   the `Messages` type makes a missing or extra key a compile error.
 */
import { es } from './es'
import { en } from './en'
import { fr } from './fr'
import { it } from './it'
import { ru } from './ru'
import { de } from './de'
import { pt } from './pt'

export type MessageKey = keyof typeof es
export type Messages = Record<MessageKey, string>

export type Lang = 'es' | 'en' | 'fr' | 'it' | 'ru' | 'de' | 'pt'

/** Languages offered in ⚙, each written in its own language. */
/** Languages in ⚙, each with its flag (José, 2026-10-28). */
export const LANGUAGES: Array<{ code: Lang; name: string; flag: string }> = [
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
]

export const MESSAGES: Record<Lang, Messages> = { es, en, fr, it, ru, de, pt }

let current: Lang = 'es'

export function setLang(lang: Lang) {
  current = lang
  if (typeof document !== 'undefined') document.documentElement.lang = lang
}
export const getLang = () => current

/** First supported language among the device's preferred ones; English otherwise. */
export function detectLang(preferred: readonly string[] = typeof navigator !== 'undefined' ? navigator.languages : []): Lang {
  for (const tag of preferred) {
    const code = tag.toLowerCase().split('-')[0]
    if (code in MESSAGES) return code as Lang
  }
  return 'en'
}

/** Translated text for `key`, with {placeholders} replaced. */
export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  const text = MESSAGES[current][key] ?? es[key]
  return text.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`))
}

/** Fills every data-i18n* element of `root` with the current language. */
export function applyStaticTranslations(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n as MessageKey)))
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml as MessageKey)))
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle as MessageKey)))
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria as MessageKey)))
}
