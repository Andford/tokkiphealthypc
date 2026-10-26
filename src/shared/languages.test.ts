import { describe, it, expect } from 'vitest'
import { LANGUAGES, matchLocaleToLanguage } from './languages'

describe('matchLocaleToLanguage', () => {
  it('matches Spanish from any region', () => {
    expect(matchLocaleToLanguage('es-MX')).toBe('es')
    expect(matchLocaleToLanguage('es_ES')).toBe('es')
    expect(matchLocaleToLanguage('ES')).toBe('es')
  })

  it('matches English from any region', () => {
    expect(matchLocaleToLanguage('en-US')).toBe('en')
    expect(matchLocaleToLanguage('en-GB')).toBe('en')
  })

  it('falls back to English for anything unshipped or absent', () => {
    expect(matchLocaleToLanguage('ru-RU')).toBe('en')
    expect(matchLocaleToLanguage('')).toBe('en')
    expect(matchLocaleToLanguage(undefined)).toBe('en')
    expect(matchLocaleToLanguage(null)).toBe('en')
  })

  it('resolves every shipped code back to itself', () => {
    for (const { code } of LANGUAGES) expect(matchLocaleToLanguage(code)).toBe(code)
  })
})
