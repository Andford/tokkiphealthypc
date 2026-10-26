// Tokkip, drawn: the five species (bunny, kitten, puppy, robot, raccoon) and
// the two skins — the same drawing as Tokkip on Android and on the PC. In
// "studio units": the body is about 200 wide, its top at y = −90 and its
// bottom at 120, centred on x = 0. Tokkip.tsx places it and draws the eyes.
//
// The look (species, skin, colours) is kept in localStorage ("tokkip.look").

export type Species = 'conejo' | 'gato' | 'perro' | 'robot' | 'mapache'
export type Skin = 'lisa' | 'ensueno'

export interface TokkipLook {
  species: Species
  skin: Skin
  /** Body colour, #RRGGBB. */
  body: string
  /** Ears, tail and (by default) the eyes and mouth. */
  accent: string
  /** Eyes and mouth; "" follows the species (accent, the robot's glow, the raccoon's black). */
  ink: string
  /** Cheeks; "" is the usual pink. */
  cheek: string
}

export const SPECIES: readonly { id: Species; label: string }[] = [
  { id: 'conejo', label: 'Conejito' },
  { id: 'gato', label: 'Gatito' },
  { id: 'perro', label: 'Perrito' },
  { id: 'robot', label: 'Robotito' },
  { id: 'mapache', label: 'Mapache' }
]

export const DEFAULT_LOOK: TokkipLook = {
  species: 'conejo',
  skin: 'lisa',
  body: '#F7EAD3',
  accent: '#3F9E9A',
  ink: '',
  cheek: ''
}

const KEY = 'tokkip.look'
const HEX = /^#[0-9a-f]{6}$/i
const SPECIES_IDS = new Set<string>(SPECIES.map((s) => s.id))

/** A stored look made safe: anything unknown or malformed falls back. */
export function parseLook(raw: unknown): TokkipLook {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const color = (v: unknown, fallback: string) =>
    typeof v === 'string' && HEX.test(v) ? v : fallback
  return {
    species:
      typeof o.species === 'string' && SPECIES_IDS.has(o.species)
        ? (o.species as Species)
        : DEFAULT_LOOK.species,
    skin: o.skin === 'ensueno' ? 'ensueno' : 'lisa',
    body: color(o.body, DEFAULT_LOOK.body),
    accent: color(o.accent, DEFAULT_LOOK.accent),
    ink: color(o.ink, ''),
    cheek: color(o.cheek, '')
  }
}

export function loadLook(): TokkipLook {
  try {
    return parseLook(JSON.parse(localStorage.getItem(KEY) ?? '{}'))
  } catch {
    return { ...DEFAULT_LOOK }
  }
}

let shared: TokkipLook | null = null

/** The look, read once and kept in step: for the many small pill Tokkips. */
export function sharedLook(): TokkipLook {
  if (!shared) {
    shared = loadLook()
    onLookChange((look) => {
      shared = look
    })
  }
  return shared
}

/** A pill's little Tokkip: the user's species in the pill's colour. */
export function pillLook(color: readonly [number, number, number]): TokkipLook {
  const hex = (k: number) =>
    '#' +
    color
      .map((c) =>
        Math.round(Math.max(0, Math.min(1, c)) * 255 * k)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  const base = sharedLook()
  return {
    species: base.species,
    skin: 'lisa',
    body: hex(1),
    accent: hex(0.78),
    ink: '#1A1412',
    cheek: ''
  }
}

export function saveLook(look: TokkipLook) {
  try {
    localStorage.setItem(KEY, JSON.stringify(look))
  } catch {
    /* private mode: the look just isn't kept */
  }
  window.dispatchEvent(new CustomEvent('tokkip-look'))
}

/** Runs `cb` whenever the look changes, here or in another window. Returns the way to stop. */
export function onLookChange(cb: (look: TokkipLook) => void): () => void {
  const mine = () => cb(loadLook())
  const other = (e: StorageEvent) => {
    if (e.key === KEY) cb(loadLook())
  }
  window.addEventListener('tokkip-look', mine)
  window.addEventListener('storage', other)
  return () => {
    window.removeEventListener('tokkip-look', mine)
    window.removeEventListener('storage', other)
  }
}

// ── Colour ────────────────────────────────────────────────────────────────────

function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Lighter (k > 0, towards white) or darker (k < 0). */
export function shade(hex: string, k: number): string {
  const [r, g, b] = rgbOf(hex)
  const f = (c: number) => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k)
  return `rgb(${f(r)},${f(g)},${f(b)})`
}

/** Eyes and mouth: the user's colour, else the species' own. */
export function inkOf(look: TokkipLook): string {
  if (look.ink) return look.ink
  if (look.species === 'robot') return shade(look.accent, 0.55)
  if (look.species === 'mapache') return '#1B1616'
  return shade(look.accent, -0.12)
}

export function cheekOf(look: TokkipLook, alpha: number): string {
  if (look.cheek) {
    const [r, g, b] = rgbOf(look.cheek)
    return `rgba(${r},${g},${b},${alpha})`
  }
  return `rgba(240,120,140,${alpha})`
}

// ── Shapes ────────────────────────────────────────────────────────────────────

function rrect(p: Path2D, x: number, y: number, w: number, h: number, r: number) {
  p.moveTo(x + r, y)
  p.arcTo(x + w, y, x + w, y + h, r)
  p.arcTo(x + w, y + h, x, y + h, r)
  p.arcTo(x, y + h, x, y, r)
  p.arcTo(x, y, x + w, y, r)
  p.closePath()
}

const BODIES = new Map<Species, Path2D>()

/** The body outline of a species, in studio units. */
export function bodyPath(species: Species): Path2D {
  let p = BODIES.get(species)
  if (p) return p
  p = new Path2D()
  switch (species) {
    case 'mapache':
      rrect(p, -108, -84, 216, 204, 92)
      break
    case 'robot':
      rrect(p, -104, -84, 208, 198, 62)
      break
    case 'perro':
      rrect(p, -106, -78, 212, 198, 90)
      break
    case 'gato':
      rrect(p, -108, -88, 216, 208, 94)
      break
    default:
      rrect(p, -100, -90, 200, 210, 54)
  }
  BODIES.set(species, p)
  return p
}

/** Where a hat sits (studio y of the head's top) — a little lower for the floppy ones. */
export function headTop(species: Species): number {
  return species === 'perro'
    ? -78
    : species === 'mapache' || species === 'robot'
      ? -84
      : species === 'gato'
        ? -88
        : -90
}

/** How a frame moves Tokkip's ears and tail. */
export interface TokkipPose {
  /** Seconds, for the idle sway. */
  t: number
  /** Extra ear angles in degrees (dance, wave, wiggle). */
  earL: number
  earR: number
  /** Ears drooping (sleepy, sad: positive) or perked up (surprised: negative), degrees. */
  droop: number
  /** Wagging fast: dancing, a happy emote. */
  happy: boolean
  /** Vertical offset this frame (for the puppy's swinging ears). */
  oy: number
  /** The robot's hands: 0 resting, 1 waving (right hand up). */
  wave: number
  /** Seconds into the wave, for its swing. */
  waveT: number
  /** Faded out while the body turns into the drop box. */
  alpha: number
}

// ── Behind the body: tail and ears ────────────────────────────────────────────

function bunnyEar(x: CanvasRenderingContext2D, fill: string, inner: string) {
  const draw = (len: number, w: number, col: string) => {
    x.beginPath()
    x.moveTo(-w * 0.45, 6)
    x.bezierCurveTo(-w * 1.05, -len * 0.45, -w * 0.65, -len, 0, -len)
    x.bezierCurveTo(w * 0.65, -len, w * 1.05, -len * 0.45, w * 0.45, 6)
    x.closePath()
    x.fillStyle = col
    x.fill()
  }
  const L = 128,
    W = 46
  draw(L, W, fill)
  x.save()
  x.translate(0, -8)
  draw(L * 0.78, W * 0.52, inner)
  x.restore()
}

function catEar(x: CanvasRenderingContext2D, fill: string, inner: string) {
  const shape = (k: number) => {
    x.beginPath()
    x.moveTo(-40 * k, 34)
    x.quadraticCurveTo(-30 * k, -40 * k, -2, -78 * k)
    x.quadraticCurveTo(6, -84 * k, 12 * k, -76 * k)
    x.quadraticCurveTo(36 * k, -36 * k, 42 * k, 34)
    x.closePath()
  }
  shape(1)
  x.fillStyle = fill
  x.fill()
  x.save()
  x.translate(2, 10)
  shape(0.6)
  x.fillStyle = inner
  x.fill()
  x.restore()
}

function catTail(x: CanvasRenderingContext2D, fill: string, t: number) {
  const w = Math.sin(t * 2.2) * 8
  x.save()
  x.lineCap = 'round'
  x.lineJoin = 'round'
  x.beginPath()
  x.moveTo(70, 104)
  x.bezierCurveTo(150, 110, 170 + w, 40, 150 + w, -6)
  x.bezierCurveTo(140 + w, -30, 116 + w, -24, 122 + w, -6)
  x.strokeStyle = fill
  x.lineWidth = 34
  x.stroke()
  x.restore()
}

function coonEars(x: CanvasRenderingContext2D, body: string, pose: TokkipPose) {
  for (const s of [-1, 1]) {
    x.save()
    x.translate(s * 64, -70)
    x.rotate(
      ((s * 6 + s * pose.droop * 0.3 + (s < 0 ? pose.earL : pose.earR) * 0.4) * Math.PI) / 180
    )
    const ear = (k: number, dy: number) => {
      x.beginPath()
      x.moveTo(-34 * k, 22 + dy)
      x.quadraticCurveTo(-30 * k, -26 * k + dy, -6 * k, -54 * k + dy)
      x.quadraticCurveTo(0, -60 * k + dy, 6 * k, -54 * k + dy)
      x.quadraticCurveTo(30 * k, -26 * k + dy, 34 * k, 22 + dy)
      x.closePath()
    }
    ear(1.06, 0)
    x.fillStyle = shade(body, 0.6)
    x.fill()
    ear(0.94, 4)
    x.fillStyle = shade(body, -0.18)
    x.fill()
    ear(0.56, 12)
    x.fillStyle = shade(body, -0.52)
    x.fill()
    x.restore()
  }
}

function coonTail(x: CanvasRenderingContext2D, body: string, pose: TokkipPose) {
  const w = Math.sin(pose.t * (pose.happy ? 7 : 2.2)) * (pose.happy ? 10 : 6)
  x.save()
  x.translate(76, 96)
  const n = 9
  for (let i = n - 1; i >= 0; i--) {
    const u = i / (n - 1)
    const cx = 22 + u * 74 + w * u * u
    const cy = -u * 96 - Math.sin(u * 2.4) * 10
    x.fillStyle = i % 2 ? shade(body, -0.5) : shade(body, -0.08)
    x.beginPath()
    x.ellipse(cx, cy, 24 - u * 4, 20 - u * 2, -0.9 + u * 0.5, 0, Math.PI * 2)
    x.fill()
  }
  x.restore()
}

function dogTail(x: CanvasRenderingContext2D, fill: string, pose: TokkipPose) {
  const a = Math.sin(pose.t * (pose.happy ? 18 : 5)) * (pose.happy ? 0.5 : 0.25)
  x.save()
  x.translate(92, 84)
  x.rotate(-0.7 + a)
  x.beginPath()
  x.ellipse(0, -26, 15, 30, 0, 0, Math.PI * 2)
  x.fillStyle = fill
  x.fill()
  x.restore()
}

/** Tail and ears, before the body. */
export function drawBack(x: CanvasRenderingContext2D, look: TokkipLook, pose: TokkipPose) {
  if (pose.alpha <= 0.01) return
  const dream = look.skin === 'ensueno'
  x.save()
  x.globalAlpha *= pose.alpha
  switch (look.species) {
    case 'mapache':
      coonTail(x, look.body, pose)
      coonEars(x, look.body, pose)
      break
    case 'perro':
      dogTail(x, dream ? '#F7D35B' : look.body, pose)
      break
    case 'robot':
      break
    case 'gato':
      catTail(x, look.body, pose.t)
      for (const s of [-1, 1]) {
        x.save()
        x.translate(s * 58, -72)
        const ang = s * 8 + s * pose.droop * 0.35 + (s < 0 ? pose.earL : pose.earR) * 0.45
        x.rotate((ang * Math.PI) / 180)
        catEar(x, look.body, dream ? (s < 0 ? '#F7B79E' : '#D9C2F0') : shade(look.accent, 0.55))
        x.restore()
      }
      break
    default: {
      // The bunny: a pompom tail and two long ears.
      x.fillStyle = dream ? '#E9B98F' : look.accent
      x.beginPath()
      x.arc(96 + Math.sin(pose.t * 3) * 2, 74, 26, 0, Math.PI * 2)
      x.fill()
      for (const s of [-1, 1]) {
        x.save()
        x.translate(s * 50, -84)
        const ang = s * 10 + s * pose.droop + (s < 0 ? pose.earL : pose.earR)
        x.rotate((ang * Math.PI) / 180)
        bunnyEar(
          x,
          dream ? (s < 0 ? '#F2906F' : '#F7D35B') : look.body,
          dream ? (s < 0 ? '#9FE0C2' : '#B98AD8') : look.accent
        )
        x.restore()
      }
    }
  }
  x.restore()
}

// ── The body ──────────────────────────────────────────────────────────────────

function sparkle(
  x: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  col: string,
  t: number,
  ph: number
) {
  const k = 0.8 + 0.2 * Math.sin(t * 2.4 + ph)
  x.save()
  x.translate(cx, cy)
  x.scale(k, k)
  x.beginPath()
  x.moveTo(0, -r)
  x.quadraticCurveTo(0, 0, r, 0)
  x.quadraticCurveTo(0, 0, 0, r)
  x.quadraticCurveTo(0, 0, -r, 0)
  x.quadraticCurveTo(0, 0, 0, -r)
  x.fillStyle = col
  x.fill()
  x.restore()
}

function moon(
  x: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  col: string,
  bg: string
) {
  x.fillStyle = col
  x.beginPath()
  x.arc(cx, cy, r, 0, Math.PI * 2)
  x.fill()
  x.fillStyle = bg
  x.beginPath()
  x.arc(cx + r * 0.45, cy - r * 0.3, r * 0.85, 0, Math.PI * 2)
  x.fill()
}

function dreamPatches(x: CanvasRenderingContext2D, t: number) {
  const P = (c: string, f: () => void) => {
    x.fillStyle = c
    x.beginPath()
    f()
    x.fill()
  }
  P('rgba(249,214,176,.85)', () => x.arc(95, -95, 88, 0, Math.PI * 2))
  P('rgba(247,226,150,.75)', () => x.arc(-104, 30, 40, 0, Math.PI * 2))
  P('rgba(220,198,240,.9)', () => x.arc(98, 72, 40, 0, Math.PI * 2))
  P('rgba(220,198,240,.9)', () => x.arc(96, 14, 10, 0, Math.PI * 2))
  P('rgba(246,202,196,.85)', () => x.arc(12, 152, 56, 0, Math.PI * 2))
  P('rgba(248,214,165,.85)', () => {
    x.moveTo(-104, 42)
    x.lineTo(8, 42)
    x.lineTo(62, 92)
    x.lineTo(8, 142)
    x.lineTo(-104, 142)
    x.closePath()
  })
  P('rgba(255,255,255,.85)', () => x.arc(84, -24, 6, 0, Math.PI * 2))
  P('rgba(255,244,214,.9)', () => x.arc(-70, 70, 9, 0, Math.PI * 2))
  moon(x, 68, -58, 11, 'rgba(255,250,240,.95)', 'rgba(249,214,176,1)')
  moon(x, -24, 100, 12, 'rgba(246,200,150,.95)', 'rgba(248,214,165,1)')
  sparkle(x, -68, -48, 13, '#F2C59A', t, 0)
  sparkle(x, 56, 96, 12, '#BFA8EC', t, 2.1)
}

/** The puppy's ears swing like a little pendulum when he jumps. */
const dogEar = { a: 0, v: 0, prevOy: 0 }

function dogEars(x: CanvasRenderingContext2D, fill: string, inner: string, pose: TokkipPose) {
  const acc = pose.oy - dogEar.prevOy
  dogEar.prevOy = pose.oy
  dogEar.v += -0.12 * dogEar.a - 0.14 * dogEar.v + acc * 0.02
  dogEar.a += dogEar.v
  const perk = Math.max(-1, Math.min(1, -pose.droop / 20))
  for (const s of [-1, 1]) {
    x.save()
    x.translate(s * 96, -54)
    x.rotate(-s * (0.32 + perk * 0.5 + dogEar.a * 0.9) + Math.sin(pose.t * 1.6 + s) * 0.03)
    x.beginPath()
    x.moveTo(-22, 0)
    x.bezierCurveTo(-34, 50, -26, 118, 6, 122)
    x.bezierCurveTo(36, 120, 40, 50, 22, -4)
    x.quadraticCurveTo(0, -14, -22, 0)
    x.closePath()
    x.fillStyle = fill
    x.fill()
    x.beginPath()
    x.moveTo(-10, 20)
    x.bezierCurveTo(-16, 60, -10, 104, 6, 106)
    x.bezierCurveTo(22, 104, 24, 60, 14, 18)
    x.closePath()
    x.fillStyle = inner
    x.fill()
    x.restore()
  }
}

/**
 * The body: its colour (or `flat`, a pill's colour), a soft top light, the
 * dream patches, the robot's visor, the puppy's patch and ears.
 */
export function drawBody(x: CanvasRenderingContext2D, look: TokkipLook, pose: TokkipPose) {
  const body = bodyPath(look.species)
  x.fillStyle = look.body
  x.fill(body)
  x.save()
  x.clip(body)
  const g = x.createLinearGradient(0, -90, 0, 120)
  g.addColorStop(0, 'rgba(255,255,255,.18)')
  g.addColorStop(1, 'rgba(0,0,0,.06)')
  x.fillStyle = g
  x.fillRect(-120, -100, 240, 230)
  if (look.skin === 'ensueno') dreamPatches(x, pose.t)
  if (look.species === 'perro' && look.skin !== 'ensueno') {
    x.fillStyle = shade(look.body, -0.2)
    x.beginPath()
    x.moveTo(18, 0)
    x.bezierCurveTo(14, -36, 64, -48, 84, -22)
    x.bezierCurveTo(100, 2, 86, 46, 54, 46)
    x.bezierCurveTo(26, 46, 20, 24, 18, 0)
    x.fill()
  }
  x.restore()

  if (pose.alpha <= 0.01) return
  x.save()
  x.globalAlpha *= pose.alpha
  if (look.species === 'robot') {
    // A smooth, dark visor: no lines, no screws.
    const visor = new Path2D()
    rrect(visor, -84, -48, 168, 116, 40)
    x.fillStyle = '#1C2230'
    x.fill(visor)
    x.save()
    x.clip(visor)
    x.fillStyle = `rgba(80,220,230,${0.08 + 0.05 * Math.sin(pose.t * 2)})`
    x.fillRect(-84, -48, 168, 116)
    x.fillStyle = 'rgba(255,255,255,.10)'
    x.beginPath()
    x.ellipse(-36, -34, 40, 12, -0.25, 0, Math.PI * 2)
    x.fill()
    x.restore()
  }
  if (look.species === 'perro') {
    const dream = look.skin === 'ensueno'
    dogEars(
      x,
      dream ? '#F2906F' : shade(look.body, -0.24),
      dream ? '#F7D35B' : shade(look.body, -0.12),
      pose
    )
  }
  x.restore()
}

/** In face space (eyes at ±46, −6): the raccoon's mask and muzzle, under the eyes. */
export function drawFaceUnder(x: CanvasRenderingContext2D, look: TokkipLook) {
  if (look.species !== 'mapache') return
  const dark = shade(look.body, -0.52)
  const light = shade(look.body, 0.65)
  x.fillStyle = dark
  x.beginPath()
  x.moveTo(-92, -2)
  x.bezierCurveTo(-90, -36, -58, -34, -30, -20)
  x.quadraticCurveTo(0, -8, 30, -20)
  x.bezierCurveTo(58, -34, 90, -36, 92, -2)
  x.bezierCurveTo(88, 22, 58, 26, 34, 14)
  x.quadraticCurveTo(0, 2, -34, 14)
  x.bezierCurveTo(-58, 26, -88, 22, -92, -2)
  x.closePath()
  x.fill()
  x.fillStyle = light
  x.beginPath()
  x.ellipse(0, 38, 46, 30, 0, 0, Math.PI * 2)
  x.fill()
}

/** The puppy's and the raccoon's nose, in face space. */
export function drawNose(x: CanvasRenderingContext2D, look: TokkipLook) {
  if (look.species !== 'perro' && look.species !== 'mapache') return
  x.fillStyle = look.species === 'mapache' ? '#2A2222' : inkOf(look)
  x.beginPath()
  x.moveTo(-13, 6)
  x.quadraticCurveTo(0, 0, 13, 6)
  x.quadraticCurveTo(12, 16, 0, 19)
  x.quadraticCurveTo(-12, 16, -13, 6)
  x.fill()
  x.fillStyle = 'rgba(255,255,255,.45)'
  x.beginPath()
  x.ellipse(-4, 7, 4, 2, -0.2, 0, Math.PI * 2)
  x.fill()
}

/** Where the mouth goes (face space y), under a nose when there is one. */
export function mouthY(species: Species): number {
  return species === 'mapache' ? 38 : species === 'perro' ? 34 : 30
}

export type MouthKind =
  'smile' | 'big' | 'open' | 'o' | 'sleepO' | 'flat' | 'frown' | 'wavy' | 'cat' | 'tongue'

/** A mouth, in face space, centred on x = 0 at `y`. */
export function drawMouth(
  x: CanvasRenderingContext2D,
  kind: MouthKind,
  ink: string,
  t: number,
  y: number
) {
  x.save()
  x.strokeStyle = ink
  x.fillStyle = ink
  x.lineWidth = 5.5
  x.lineCap = 'round'
  x.lineJoin = 'round'
  switch (kind) {
    case 'smile':
      x.beginPath()
      x.arc(0, y - 12, 18, Math.PI * 0.2, Math.PI * 0.8)
      x.stroke()
      break
    case 'big':
      x.beginPath()
      x.arc(0, y - 14, 22, Math.PI * 0.12, Math.PI * 0.88)
      x.stroke()
      break
    case 'open':
      x.beginPath()
      x.moveTo(-18, y - 4)
      x.quadraticCurveTo(0, y + 26, 18, y - 4)
      x.closePath()
      x.fill()
      x.fillStyle = '#E98A97'
      x.beginPath()
      x.ellipse(0, y + 8, 8, 5, 0, 0, Math.PI * 2)
      x.fill()
      break
    case 'o':
      x.beginPath()
      x.ellipse(0, y, 8, 10, 0, 0, Math.PI * 2)
      x.fill()
      break
    case 'sleepO':
      x.beginPath()
      x.ellipse(0, y, 5, 5 + Math.sin(t * 1.4) * 1.5, 0, 0, Math.PI * 2)
      x.fill()
      break
    case 'flat':
      x.beginPath()
      x.moveTo(-12, y)
      x.lineTo(12, y)
      x.stroke()
      break
    case 'frown':
      x.beginPath()
      x.arc(0, y + 16, 16, Math.PI * 1.22, Math.PI * 1.78)
      x.stroke()
      break
    case 'wavy':
      x.beginPath()
      for (let i = -18; i <= 18; i += 2) x.lineTo(i, y + Math.sin(i * 0.45 + t * 9) * 3.5)
      x.stroke()
      break
    case 'cat':
      x.beginPath()
      x.moveTo(-14, y - 4)
      x.quadraticCurveTo(-7, y + 6, 0, y - 2)
      x.quadraticCurveTo(7, y + 6, 14, y - 4)
      x.stroke()
      break
    case 'tongue':
      x.beginPath()
      x.arc(0, y - 12, 18, Math.PI * 0.2, Math.PI * 0.8)
      x.stroke()
      x.fillStyle = '#E98A97'
      x.beginPath()
      x.ellipse(6, y + 7, 6, 7, 0.2, 0, Math.PI * 2)
      x.fill()
      break
  }
  x.restore()
}

/** The robot's little floating hands, in studio units, in front of everything. */
export function drawRobotHands(x: CanvasRenderingContext2D, look: TokkipLook, pose: TokkipPose) {
  if (look.species !== 'robot' || pose.alpha <= 0.01) return
  const t = pose.t
  const lx = -118
  let ly = 12 + Math.sin(t * 2) * 4
  let rx = 118
  let ry = 12 + Math.sin(t * 2 + 1.6) * 4
  if (pose.wave > 0) {
    const u = pose.waveT
    rx += (6 + Math.sin(u * 13) * 16) * pose.wave
    ry += (-92 + Math.cos(u * 13) * 4) * pose.wave
  }
  if (pose.happy) {
    ly -= Math.max(0, Math.sin(t * 6)) * 40
    ry -= Math.max(0, -Math.sin(t * 6)) * 40
  }
  x.save()
  x.globalAlpha *= pose.alpha
  for (const [hx, hy] of [
    [lx, ly],
    [rx, ry]
  ] as const) {
    x.fillStyle = 'rgba(0,0,0,.08)'
    x.beginPath()
    x.arc(hx + 2, hy + 3, 20, 0, Math.PI * 2)
    x.fill()
    x.fillStyle = shade(look.body, -0.16)
    x.beginPath()
    x.arc(hx, hy, 20, 0, Math.PI * 2)
    x.fill()
    x.fillStyle = shade(look.body, -0.1)
    x.beginPath()
    x.arc(hx, hy, 13, 0, Math.PI * 2)
    x.fill()
  }
  x.restore()
}
