// Tokkip in a ring that fills with the PC's health, and what he'd tell you
// about it — the first thing on Inicio.

import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Tokkip } from './Tokkip'
import type { TokkipHealth } from './health'

export function healthColor(score: number): string {
  if (score >= 80) return 'var(--mint)'
  if (score >= 60) return 'var(--accent)'
  if (score >= 40) return 'var(--warning)'
  return 'var(--danger)'
}

/** Tokkip inside his health ring, with the score under him. */
export function TokkipRing({
  health,
  size = 170,
  jump = 0
}: {
  health: TokkipHealth
  size?: number
  jump?: number
}) {
  const stroke = Math.max(5, size * 0.045)
  const r = size / 2 - stroke
  const c = 2 * Math.PI * r
  const color = healthColor(health.score)
  return (
    <div className="tokkip-health" style={{ width: size, height: size }}>
      <svg className="tokkip-health-ring" width={size} height={size} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--gauge-track)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (health.score / 100) * c}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(.2,.8,.2,1)' }}
        />
      </svg>
      <Tokkip mood={health.mood} size={size * 0.62} jump={jump} />
      <span className="tokkip-health-score" style={{ background: color }}>
        {health.score}
      </span>
    </div>
  )
}

const ACTION: Record<string, string> = {
  reasonNeverCleaned: '/cleaner',
  reasonCleanLongAgo: '/cleaner',
  reasonCleanAWhile: '/cleaner',
  reasonDiskFull: '/disk',
  reasonDiskFilling: '/disk',
  reasonThreats: '/malware',
  reasonNeverScanned: '/malware',
  reasonScanLongAgo: '/malware'
}

export function TokkipHealthCard({ health }: { health: TokkipHealth }) {
  const { t } = useTranslation('tokkip')
  const navigate = useNavigate()
  const top = health.reasons[0]
  return (
    <section className="tokkip-hero" aria-label={t('heroLabel')}>
      <TokkipRing health={health} />
      <div className="tokkip-hero-copy">
        <span className="pulse-eyebrow">{t(`mood.${health.mood}.kicker`)}</span>
        <h1 className="tokkip-display">{t(`mood.${health.mood}.title`)}</h1>
        <div className="tokkip-bubble">{top ? t(top.key, top.values) : t('reasonAllGood')}</div>
        {top && ACTION[top.key] && (
          <button className="tokkip-hero-action" onClick={() => navigate(ACTION[top.key])}>
            {t(`${top.key}Action`)}
            <ArrowRight size={16} />
          </button>
        )}
      </div>
    </section>
  )
}
