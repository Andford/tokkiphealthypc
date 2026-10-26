import { describe, expect, it } from 'vitest'
import { moveOldKeys } from './legacy'

function memory(init: Record<string, string>): Storage {
  const map = new Map(Object.entries(init))
  return {
    get length() {
      return map.size
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear()
  }
}

describe('moveOldKeys', () => {
  it('moves the first version’s keys and keeps newer values', () => {
    const s = memory({
      'kudu:excluded-subcategories': '["a"]',
      'kudu.contextMenu.win11Notice.dismissed': '1',
      'tokkip.contextMenu.win11Notice.dismissed': '0',
      kudunot: 'x',
      other: 'y'
    })
    moveOldKeys(s)
    expect(s.getItem('tokkip:excluded-subcategories')).toBe('["a"]')
    expect(s.getItem('tokkip.contextMenu.win11Notice.dismissed')).toBe('0')
    expect(s.getItem('kudu:excluded-subcategories')).toBeNull()
    expect(s.getItem('kudu.contextMenu.win11Notice.dismissed')).toBeNull()
    expect(s.getItem('kudunot')).toBe('x')
    expect(s.getItem('other')).toBe('y')
  })
})
