// A clean-up worth celebrating: Tokkip dances with starry eyes on a Material
// Expressive cookie that spins, confetti falls, and you see what you freed.
// Shown by `celebrate()` from anywhere (the cleaner, the one-click clean…).

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { create } from 'zustand'
import { formatBytes } from '@/lib/utils'
import { Tokkip } from './Tokkip'
import { clipFor } from './shapes'
import { play } from './sound'
import { tellTokkipPc } from './island'

interface PartyState {
  party: { bytes: number; items: number; at: number } | null
  close: () => void
}

export const usePartyStore = create<PartyState>((set) => ({
  party: null,
  close: () => set({ party: null })
}))

/** Celebrate a clean-up (only when something was really freed). */
export function celebrate(bytes: number, items: number) {
  if (bytes <= 0 && items <= 0) return
  usePartyStore.setState({ party: { bytes, items, at: Date.now() } })
  tellTokkipPc({ kind: 'clean', bytes, items })
}

const COLORS = ['#F472B6', '#FBBF24', '#34D399', '#60A5FA', '#A78BFA', '#F97316', '#22D3EE']

function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    const x = c?.getContext('2d')
    if (!c || !x) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const dpr = window.devicePixelRatio || 1
    c.width = c.clientWidth * dpr
    c.height = c.clientHeight * dpr
    const bits = Array.from({ length: 120 }, (_, i) => ({
      x: Math.random(),
      y: -0.1 - Math.random() * 0.7,
      vx: (Math.random() - 0.5) * 0.1,
      vy: 0.16 + Math.random() * 0.2,
      spin: Math.random() * 6,
      size: (6 + Math.random() * 8) * dpr,
      color: COLORS[i % COLORS.length],
      kind: i % 3
    }))
    const start = performance.now()
    let raf = 0
    const frame = (ms: number) => {
      const t = (ms - start) / 1000
      x.clearRect(0, 0, c.width, c.height)
      let alive = false
      for (const b of bits) {
        const y = (b.y + b.vy * t) * c.height
        if (y > c.height + 30) continue
        alive = true
        const px = (b.x + b.vx * t + 0.03 * Math.sin(t * 3 + b.spin)) * c.width
        x.save()
        x.translate(px, y)
        x.rotate(b.spin + t * 4)
        x.fillStyle = b.color
        if (b.kind === 0) x.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2)
        else if (b.kind === 1) {
          x.beginPath()
          x.arc(0, 0, b.size / 3, 0, Math.PI * 2)
          x.fill()
        } else {
          x.beginPath()
          for (let k = 0; k < 4; k++) {
            const a = (k * Math.PI) / 2
            x.ellipse(
              Math.cos(a) * b.size * 0.22,
              Math.sin(a) * b.size * 0.22,
              b.size * 0.24,
              b.size * 0.24,
              0,
              0,
              Math.PI * 2
            )
          }
          x.fill()
        }
        x.restore()
      }
      if (alive) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={ref} className="tokkip-confetti" style={{ width: '100%', height: '100%' }} />
}

export function TokkipParty() {
  const { t } = useTranslation('tokkip')
  const party = usePartyStore((s) => s.party)
  const close = usePartyStore((s) => s.close)
  useEffect(() => {
    if (!party) return
    play('level_up', 0.6)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [party, close])
  if (!party) return null
  return (
    <div
      className="tokkip-party"
      role="dialog"
      aria-modal="true"
      aria-label={t('party.title')}
      onClick={close}
    >
      <Confetti key={party.at} />
      <div className="tokkip-party-card" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            position: 'relative',
            width: 280,
            height: 250,
            display: 'flex',
            justifyContent: 'center'
          }}
        >
          <div className="tokkip-party-blob" style={{ clipPath: clipFor('cookie12') }} />
          <div style={{ position: 'relative', marginTop: 10 }}>
            <Tokkip mood="party" size={220} />
          </div>
        </div>
        <h2>{t('party.title')}</h2>
        {party.bytes > 0 && (
          <span className="tokkip-party-badge">
            {t('party.freed', { size: formatBytes(party.bytes) })}
          </span>
        )}
        <p>
          {party.items > 0 ? t('party.items', { count: party.items }) + ' · ' : ''}
          {t('party.body')}
        </p>
        <button onClick={close} autoFocus>
          {t('party.button')}
        </button>
      </div>
    </div>
  )
}
