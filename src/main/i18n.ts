import { getSettings } from './services/settings-store'

import en from '../renderer/src/locales/en/tray.json'
import es from '../renderer/src/locales/es/tray.json'

const resources: Record<string, Record<string, string>> = {
  en,
  es
}

export function t(key: string, params?: Record<string, string | number>): string {
  let lang: string
  try {
    lang = getSettings().language || 'en'
  } catch {
    lang = 'en'
  }
  const str = resources[lang]?.[key] ?? resources.en[key] ?? key
  if (!params) return str
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => String(params[k] ?? ''))
}
