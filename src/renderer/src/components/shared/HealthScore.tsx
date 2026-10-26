import { TokkipRing } from '@/tokkip/TokkipHealthCard'
import { moodForScore } from '@/tokkip/Tokkip'
import { cn } from '@/lib/utils'

interface HealthScoreProps {
  score: number
  size?: 'sm' | 'md' | 'lg' | 'compact'
  className?: string
}

const SIZES = { compact: 112, sm: 84, md: 150, lg: 190 }

/** The health score, with Tokkip in the ring showing how the PC feels. */
export function HealthScore({ score, size = 'md', className }: HealthScoreProps) {
  const value = Number.isFinite(score) ? Math.round(Math.max(0, Math.min(100, score))) : 0
  return (
    <div className={cn('inline-flex', className)} role="img" aria-label={`Health: ${value} / 100`}>
      <TokkipRing
        health={{ score: value, mood: moodForScore(value), reasons: [] }}
        size={SIZES[size]}
      />
    </div>
  )
}
