/**
 * Canonical list of shipped UI languages.
 *
 * Lives in `shared` because both sides need it for different reasons: the
 * renderer renders the picker from it, and the main process maps the OS
 * locale onto it when picking a fresh install's default language.
 */
export const LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' }
] as const

export type LanguageCode = (typeof LANGUAGES)[number]['code']

export const RTL_LANGUAGES: readonly string[] = []

const CODES: readonly string[] = LANGUAGES.map((l) => l.code)

/**
 * Map an OS locale tag (`app.getLocale()`, e.g. "ru-RU", "pt-BR", "zh-Hant-TW")
 * onto a shipped language code, falling back to English when nothing matches.
 */
export function matchLocaleToLanguage(locale: string | undefined | null): LanguageCode {
  if (!locale) return 'en'
  const tag = locale.trim()
  if (!tag) return 'en'

  const base = tag.split(/[-_]/)[0].toLowerCase()
  const match = CODES.find((c) => c.toLowerCase() === base)
  return (match ?? 'en') as LanguageCode
}
