import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createRequire } from 'module'
import { runInNewContext } from 'vm'
import i18next from 'i18next'
import { describe, expect, it } from 'vitest'
import { LANGUAGES } from '../../../shared/languages'

const families = ['reviewCount', 'selected', 'confirmTitle', 'outcome', 'skipped']
const counts = [0, 1, 2, 3, 5, 11, 21, 100, 1000000, 1.5]
const localePath = resolve('src/renderer/src/locales')
const readLocale = (code: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(localePath, code, 'downloads.json'), 'utf8'))

describe('Downloads localized file counts', () => {
  for (const { code } of LANGUAGES) {
    it(`resolves ${code} plural forms locally for every supported count family`, async () => {
      const translations = readLocale(code)
      const instance = i18next.createInstance()
      await instance.init({
        lng: code,
        fallbackLng: 'en',
        defaultNS: 'downloads',
        resources: {
          [code]: { downloads: translations },
          ...(code === 'en' ? {} : { en: { downloads: readLocale('en') } })
        }
      })
      const plurals = new Intl.PluralRules(code)
      for (const family of families) {
        for (const category of plurals.resolvedOptions().pluralCategories) {
          expect(translations[`${family}_${category}`], `${code}: ${family}_${category}`)
            .toContain('{{count}}')
        }
        for (const count of counts) {
          const suffix = count === 0 ? 'zero' : plurals.select(count)
          const key = `${family}_${suffix}`
          const resolved = instance.t(family, { count, returnDetails: true })
          expect(resolved.usedLng).toBe(code)
          expect(resolved.exactUsedKey).toBe(key)
          expect(resolved.res).toBe(translations[key].replaceAll('{{count}}', String(count)))
        }
      }
    })
  }

})
