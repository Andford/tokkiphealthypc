/**
 * What Tokkip Healthy PC tells Tokkip PC (the island app) about this PC,
 * written to %APPDATA%\Tokkip\shared\healthy-pc.json. Tokkip PC reads it and
 * says it in the island: a clean-up that freed space, or that the PC needs
 * a breather. Nothing leaves the computer.
 */
export interface TokkipNotice {
  /** 0…100. */
  score: number
  mood: 'happy' | 'calm' | 'tired' | 'dizzy' | 'worried' | 'party' | 'sleep'
  /** What Tokkip would say, already in the user's language. */
  message: string
  /** 'clean' after a clean-up, 'care' when the PC needs attention, 'status' otherwise. */
  kind: 'clean' | 'care' | 'status'
  /** Bytes freed, for 'clean'. */
  bytes?: number
}

const MOODS = new Set(['happy', 'calm', 'tired', 'dizzy', 'worried', 'party', 'sleep'])
const KINDS = new Set(['clean', 'care', 'status'])

export function validTokkipNotice(raw: unknown): TokkipNotice | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (typeof o.score !== 'number' || !Number.isFinite(o.score) || o.score < 0 || o.score > 100)
    return null
  if (typeof o.mood !== 'string' || !MOODS.has(o.mood)) return null
  if (typeof o.kind !== 'string' || !KINDS.has(o.kind)) return null
  if (typeof o.message !== 'string' || o.message.length > 300) return null
  if (
    o.bytes !== undefined &&
    (typeof o.bytes !== 'number' || !Number.isFinite(o.bytes) || o.bytes < 0)
  )
    return null
  return {
    score: Math.round(o.score),
    mood: o.mood as TokkipNotice['mood'],
    kind: o.kind as TokkipNotice['kind'],
    message: o.message,
    ...(typeof o.bytes === 'number' ? { bytes: o.bytes } : {})
  }
}
