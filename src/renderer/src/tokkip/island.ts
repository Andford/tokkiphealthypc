// Tells Tokkip PC (the island app) how this PC is doing: after a clean-up,
// and whenever Tokkip's mood here changes. See src/main/services/tokkip-notice.ts.

import i18next from 'i18next'
import { formatBytes } from '@/lib/utils'
import type { TokkipHealth } from './health'

let lastHealth: TokkipHealth | null = null

export function tellTokkipPc(event: { kind: 'clean'; bytes: number; items: number }) {
  const h = lastHealth
  void window.kudu
    ?.tokkipNotice?.({
      kind: 'clean',
      score: h?.score ?? 100,
      mood: 'party',
      bytes: event.bytes,
      message: i18next.t('tokkip:island.cleanDone', { size: formatBytes(event.bytes) })
    })
    .catch(() => {})
}

/** The PC's health changed: Tokkip PC hears about it (only when it needs care, or got better). */
export function reportHealth(h: TokkipHealth) {
  const before = lastHealth
  lastHealth = h
  if (before && before.mood === h.mood && before.reasons[0]?.key === h.reasons[0]?.key) return
  const top = h.reasons[0]
  const reason = top
    ? i18next.t(`tokkip:${top.key}`, top.values)
    : i18next.t('tokkip:reasonAllGood')
  const care = h.mood === 'tired' || h.mood === 'dizzy'
  void window.kudu
    ?.tokkipNotice?.({
      kind: care ? 'care' : 'status',
      score: h.score,
      mood: h.mood,
      message: care ? i18next.t('tokkip:island.needsCare', { reason }) : reason
    })
    .catch(() => {})
}
