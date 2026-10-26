// Tokkip on screen: his drawing (art.ts) with a face that tells how the PC
// feels, a gentle idle (breathing, blinks, ears that sway), a dance when
// there's something to celebrate and a hop on `jump`. Drawn at up to 30 fps
// on a canvas; requestAnimationFrame stops when the window is hidden.

import { useEffect, useRef } from 'react'
import {
  bodyPath,
  cheekOf,
  drawBack,
  drawBody,
  drawFaceUnder,
  drawMouth,
  drawNose,
  drawRobotHands,
  inkOf,
  loadLook,
  mouthY,
  onLookChange,
  type MouthKind,
  type TokkipLook,
  type TokkipPose
} from './art'

/** How Tokkip feels: the PC's health, or a moment. */
export type TokkipMood = 'happy' | 'calm' | 'tired' | 'dizzy' | 'party' | 'sleep' | 'worried'

type Eye = 'pill' | 'happy' | 'star' | 'tired' | 'spiral' | 'closed' | 'wide'

const FACE: Record<TokkipMood, { eye: Eye; mouth: MouthKind }> = {
  happy: { eye: 'happy', mouth: 'big' },
  calm: { eye: 'pill', mouth: 'smile' },
  tired: { eye: 'tired', mouth: 'flat' },
  dizzy: { eye: 'spiral', mouth: 'wavy' },
  party: { eye: 'star', mouth: 'open' },
  sleep: { eye: 'closed', mouth: 'sleepO' },
  worried: { eye: 'wide', mouth: 'frown' }
}

/** The mood that goes with a health score (0…100). */
export function moodForScore(score: number): TokkipMood {
  if (score >= 80) return 'happy'
  if (score >= 60) return 'calm'
  if (score >= 40) return 'tired'
  return 'dizzy'
}

// Studio units shown: room for the tallest ears and the longest tail.
const VIEW_W = 360
const VIEW_H = 370
const ORIGIN_Y = 232

function drawEye(
  x: CanvasRenderingContext2D,
  eye: Eye,
  side: number,
  ink: string,
  t: number,
  blink: number
) {
  x.save()
  x.fillStyle = ink
  x.strokeStyle = ink
  x.lineCap = 'round'
  x.lineJoin = 'round'
  x.lineWidth = 6
  switch (eye) {
    case 'happy':
      x.beginPath()
      x.arc(0, 6, 13, Math.PI * 1.15, Math.PI * 1.85)
      x.stroke()
      break
    case 'closed':
      x.beginPath()
      x.arc(0, -2, 12, Math.PI * 0.15, Math.PI * 0.85)
      x.stroke()
      break
    case 'spiral': {
      x.lineWidth = 4
      x.beginPath()
      const turn = t * 5 * side
      for (let a = 0; a < Math.PI * 5; a += 0.2) {
        const r = 1 + a * 1.05
        x.lineTo(Math.cos(a + turn) * r, Math.sin(a + turn) * r)
      }
      x.stroke()
      break
    }
    case 'star': {
      const r = 15 + Math.sin(t * 8) * 1.5
      x.fillStyle = '#FBBF24'
      x.beginPath()
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        const rr = i % 2 ? r * 0.45 : r
        x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
      }
      x.closePath()
      x.fill()
      break
    }
    default: {
      // Pill eyes (wide for worried), with a little light; blinks squash them.
      const big = eye === 'wide' ? 1.25 : 1
      const h = 14 * big * Math.max(0.08, 1 - blink)
      x.beginPath()
      x.ellipse(0, 0, 9 * big, h, 0, 0, Math.PI * 2)
      x.fill()
      if (blink < 0.5) {
        x.fillStyle = 'rgba(255,255,255,.85)'
        x.beginPath()
        x.ellipse(-3 * big, -5 * big, 3 * big, 4 * big * (1 - blink), 0, 0, Math.PI * 2)
        x.fill()
      }
      if (eye === 'tired') {
        // A heavy lid over the top half.
        x.globalCompositeOperation = 'destination-out'
        x.fillRect(-14, -20, 28, 18)
        x.globalCompositeOperation = 'source-over'
        x.lineWidth = 5
        x.beginPath()
        x.moveTo(-11, -2)
        x.lineTo(11, -2)
        x.stroke()
      }
    }
  }
  x.restore()
}

export interface TokkipProps {
  mood?: TokkipMood
  /** Width in px; the height follows. */
  size?: number
  /** Change it to make him hop. */
  jump?: number
  className?: string
  title?: string
}

export function Tokkip({ mood = 'calm', size = 120, jump = 0, className, title }: TokkipProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const state = useRef({ mood, jump, hopAt: -10, look: loadLook() as TokkipLook })
  state.current.mood = mood
  useEffect(() => {
    if (jump !== state.current.jump) {
      state.current.jump = jump
      state.current.hopAt = performance.now() / 1000
    }
  }, [jump])

  useEffect(() => {
    const off = onLookChange((look) => (state.current.look = look))
    const c = canvas.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return off
    let raf = 0
    let last = 0
    const start = performance.now() / 1000
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const frame = (ms: number) => {
      raf = requestAnimationFrame(frame)
      if (ms - last < 33) return
      last = ms
      const now = ms / 1000
      const t = reduced ? 0 : now - start
      const { mood: m, look, hopAt } = state.current
      const face = FACE[m]
      const dpr = window.devicePixelRatio || 1
      const w = c.clientWidth
      const h = (w * VIEW_H) / VIEW_W
      if (c.width !== Math.round(w * dpr)) {
        c.width = Math.round(w * dpr)
        c.height = Math.round(h * dpr)
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, c.width, c.height)
      const u = (w * dpr) / VIEW_W
      ctx.scale(u, u)
      ctx.translate(VIEW_W / 2, ORIGIN_Y)

      // Motion: breathing, the party's bounce, a dizzy sway, a hop.
      const party = m === 'party'
      const hopT = now - hopAt
      const hop = hopT >= 0 && hopT < 0.55 ? Math.sin((hopT / 0.55) * Math.PI) : 0
      const bounce = party ? Math.abs(Math.sin(t * 6)) : 0
      const breathe = Math.sin(t * 2) * (m === 'sleep' ? 1.6 : 1)
      const y = -breathe * 3 - bounce * 22 - hop * 34
      const squash = 1 + breathe * 0.012 - (party ? (1 - bounce) * 0.06 : 0)
      const tilt = party ? Math.sin(t * 6) * 0.09 : m === 'dizzy' ? Math.sin(t * 3) * 0.08 : 0

      // A soft shadow on the floor.
      ctx.fillStyle = 'rgba(0,0,0,.16)'
      ctx.beginPath()
      ctx.ellipse(0, 128, 92 - bounce * 16 - hop * 20, 12, 0, 0, Math.PI * 2)
      ctx.fill()

      ctx.save()
      ctx.translate(0, y + 120)
      ctx.rotate(tilt)
      ctx.scale(1 / squash, squash)
      ctx.translate(0, -120)
      const pose: TokkipPose = {
        t,
        earL: party ? Math.sin(t * 6) * 14 : Math.sin(t * 1.3) * 3,
        earR: party ? -Math.sin(t * 6) * 14 : Math.sin(t * 1.3 + 1) * 3,
        droop: m === 'tired' || m === 'sleep' ? 14 : m === 'worried' ? 6 : m === 'happy' ? -4 : 0,
        happy: party || m === 'happy',
        oy: y,
        wave: 0,
        waveT: 0,
        alpha: 1
      }
      drawBack(ctx, look, pose)
      drawBody(ctx, look, pose)

      ctx.save()
      ctx.clip(bodyPath(look.species))
      ctx.translate(0, 20)
      drawFaceUnder(ctx, look)
      ctx.fillStyle = cheekOf(look, party || m === 'happy' ? 0.7 : 0.45)
      for (const sd of [-1, 1]) {
        ctx.beginPath()
        if (look.species === 'robot') ctx.roundRect(sd * 60 - 10, 22, 20, 8, 4)
        else ctx.ellipse(sd * 70, 18, 17, 9, 0, 0, Math.PI * 2)
        ctx.fill()
      }
      const ink = inkOf(look)
      // A blink every few seconds (not when the eyes are already closed).
      const cycle = t % 4.2
      const blink = cycle < 0.14 ? Math.sin((cycle / 0.14) * Math.PI) : 0
      for (const sd of [-1, 1]) {
        ctx.save()
        ctx.translate(sd * 46, -6)
        drawEye(ctx, face.eye, sd, ink, t, blink)
        ctx.restore()
      }
      drawNose(ctx, look)
      drawMouth(
        ctx,
        face.mouth,
        look.species === 'mapache' ? '#3A2E2C' : ink,
        t,
        mouthY(look.species)
      )
      ctx.restore()
      drawRobotHands(ctx, look, pose)
      ctx.restore()

      // Little z's while he sleeps.
      if (m === 'sleep' && !reduced) {
        ctx.fillStyle = ink
        ctx.font = '700 34px "Tokkip Round", sans-serif'
        const k = (t % 2.4) / 2.4
        ctx.globalAlpha = 1 - k
        ctx.fillText('z', 90 + k * 30, -120 - k * 60)
        ctx.globalAlpha = 1
      }
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      off()
    }
  }, [])

  return (
    <canvas
      ref={canvas}
      className={className}
      role="img"
      aria-label={title ?? 'Tokkip'}
      style={{ width: size, height: (size * VIEW_H) / VIEW_W, display: 'block' }}
    />
  )
}
