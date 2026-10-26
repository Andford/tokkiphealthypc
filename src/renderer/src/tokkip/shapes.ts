// Material 3 Expressive shapes (cookie, clover, sunny, flower…) as CSS
// clip-paths, so icons can sit in the same shapes as on Tokkip's phone and
// watch. Each is a polygon of 96 points in percentages, so it scales.

export type ExpressiveShape =
  'cookie9' | 'cookie12' | 'cookie6' | 'clover4' | 'sunny' | 'flower' | 'gem' | 'circle'

const RADIUS: Record<ExpressiveShape, (a: number) => number> = {
  cookie9: (a) => 1 + 0.07 * Math.cos(9 * a),
  cookie12: (a) => 1 + 0.05 * Math.cos(12 * a),
  cookie6: (a) => 1 + 0.09 * Math.cos(6 * a),
  clover4: (a) => 0.62 + 0.38 * Math.pow(Math.abs(Math.cos(2 * a)), 0.7),
  sunny: (a) => 1 + 0.06 * Math.cos(8 * a),
  flower: (a) => 0.78 + 0.22 * Math.pow(Math.abs(Math.cos(3 * a)), 1.2),
  gem: (a) =>
    (1 / Math.cos((((a % (Math.PI / 3)) + Math.PI * 2) % (Math.PI / 3)) - Math.PI / 6)) * 0.9,
  circle: () => 1
}

const cache = new Map<ExpressiveShape, string>()

/** `clip-path` value for a shape. */
export function clipFor(shape: ExpressiveShape): string {
  const hit = cache.get(shape)
  if (hit) return hit
  const r = RADIUS[shape]
  const n = 96
  const raw: [number, number][] = []
  let max = 0
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const k = r(a)
    raw.push([Math.cos(a - Math.PI / 2) * k, Math.sin(a - Math.PI / 2) * k])
    max = Math.max(max, Math.abs(raw[i][0]), Math.abs(raw[i][1]))
  }
  const pts = raw.map(
    ([x, y]) => `${(50 + (x / max) * 50).toFixed(2)}% ${(50 + (y / max) * 50).toFixed(2)}%`
  )
  const value = `polygon(${pts.join(', ')})`
  cache.set(shape, value)
  return value
}

/** A shape for each place, so the same icon always gets the same one. */
export function shapeForKey(key: string): ExpressiveShape {
  const all: ExpressiveShape[] = [
    'cookie9',
    'clover4',
    'sunny',
    'cookie6',
    'flower',
    'cookie12',
    'gem'
  ]
  let h = 0
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return all[h % all.length]
}
