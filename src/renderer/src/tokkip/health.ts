// How the PC feels, for Tokkip's face: a score out of 100 and the reasons,
// from what's already on this PC — when you last cleaned, how full the
// drives are, the last malware scan and any threat still active. Nothing
// leaves the computer.

import { useEffect, useState } from 'react'
import type { DriveInfo, ScanHistoryEntry } from '@shared/types'
import { useHistoryStore } from '@/stores/history-store'
import { useMalwareStore } from '@/stores/malware-store'
import { moodForScore, type TokkipMood } from './Tokkip'

/** One reason, as a translation key (namespace `tokkip`) with its values. */
export interface HealthReason {
  key: string
  values?: Record<string, string | number>
  /** How much it took off the score. */
  weight: number
}

export interface TokkipHealth {
  score: number
  mood: TokkipMood
  reasons: HealthReason[]
}

const DAY = 86_400_000

export function healthFrom(input: {
  history: ScanHistoryEntry[]
  drives: DriveInfo[]
  lastMalwareScan: { completedAt: string; unresolvedThreats: number } | null
  activeThreats: number
  now?: number
}): TokkipHealth {
  const now = input.now ?? Date.now()
  const reasons: HealthReason[] = []

  const cleans = input.history.filter((e) => e.type === 'cleaner' && e.totalItemsCleaned > 0)
  const lastClean = cleans.length
    ? Math.max(...cleans.map((e) => new Date(e.timestamp).getTime()))
    : 0
  const days = lastClean ? Math.floor((now - lastClean) / DAY) : -1
  if (days < 0) reasons.push({ key: 'reasonNeverCleaned', weight: 20 })
  else if (days > 14) reasons.push({ key: 'reasonCleanLongAgo', values: { days }, weight: 22 })
  else if (days > 7) reasons.push({ key: 'reasonCleanAWhile', values: { days }, weight: 10 })

  const worst = input.drives
    .filter((d) => d.totalSize > 0)
    .map((d) => ({ d, used: d.usedSpace / d.totalSize }))
    .sort((a, b) => b.used - a.used)[0]
  if (worst && worst.used > 0.9)
    reasons.push({
      key: 'reasonDiskFull',
      values: { drive: worst.d.letter, percent: Math.round(worst.used * 100) },
      weight: 28
    })
  else if (worst && worst.used > 0.78)
    reasons.push({
      key: 'reasonDiskFilling',
      values: { drive: worst.d.letter, percent: Math.round(worst.used * 100) },
      weight: 12
    })

  const threats = (input.lastMalwareScan?.unresolvedThreats ?? 0) + input.activeThreats
  if (threats > 0)
    reasons.push({
      key: 'reasonThreats',
      values: { count: threats },
      weight: Math.min(40, 20 + threats * 10)
    })
  else if (!input.lastMalwareScan) reasons.push({ key: 'reasonNeverScanned', weight: 8 })
  else {
    const since = Math.floor((now - new Date(input.lastMalwareScan.completedAt).getTime()) / DAY)
    if (since > 30) reasons.push({ key: 'reasonScanLongAgo', values: { days: since }, weight: 8 })
  }

  const score = Math.max(0, Math.min(100, 100 - reasons.reduce((s, r) => s + r.weight, 0)))
  reasons.sort((a, b) => b.weight - a.weight)
  return { score, mood: moodForScore(score), reasons }
}

/** The PC's health, kept up to date while the screen is open. */
export function useTokkipHealth(): TokkipHealth {
  const history = useHistoryStore((s) => s.entries)
  const loaded = useHistoryStore((s) => s.loaded)
  const load = useHistoryStore((s) => s.load)
  const lastMalwareScan = useMalwareStore((s) => s.lastCompletedScan)
  const activeThreats = useMalwareStore((s) => s.knownActiveThreats)
  const [drives, setDrives] = useState<DriveInfo[]>([])

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])
  useEffect(() => {
    let alive = true
    const read = () =>
      window.kudu
        ?.diskDrives?.()
        .then((d) => alive && setDrives(d))
        .catch(() => {})
    read()
    const timer = setInterval(read, 5 * 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  return healthFrom({ history, drives, lastMalwareScan, activeThreats })
}
