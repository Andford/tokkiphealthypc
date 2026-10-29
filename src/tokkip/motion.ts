// Copied from Andford/tokkip (windows/src) by scripts/sync-tokkip.mjs — change it there.
// Tokkip's motion engine: how he moves, written for Tokkip.
//
// Every part of him that moves — where he sits, his squash and stretch, his
// lean, where he looks, how his ears hang, his paws, the hat on his head — is
// a spring chasing a target. The island's state is his *mood*: it sets those
// targets, his face and a gentle loop of its own (typing while he works,
// scanning while he searches, breathing while he sleeps). On top come *acts*:
// short choreographies written as functions of time (a hop, a spin, a wave, a
// sneeze, a dance move), added to the springs while they play. Emotes, pokes,
// greetings and the little things he does when nobody asks are all acts.
//
// The figure itself (body, face, paws, clothes) is drawn by figure.ts.

import { Sound } from "../core/sound";
import type { BotEmoteName, BotStateName } from "../core/layout";
import { DEFAULT_LOOK, pillLook, type TokkipLook } from "./tokkip";
import {
  drawFigure, figure, heartShape, restPaw, starShape, twinkleShape,
  type EyeShape, type FigMouth, type Figure, type Paw,
} from "./figure";
import type { Outfit } from "./wardrobe";

export type { EyeShape } from "./figure";

/** A colour as three components, 0…1. */
export type RGB = readonly [number, number, number];

export function hexToRGB(hex: string): RGB {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// ── Little maths ──────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** 0 before a, 1 after b, linear between. */
const seg = (u: number, a: number, b: number) => clamp((u - a) / (b - a), 0, 1);
/** A smooth bump: 0 at a, 1 halfway, 0 at b. */
const bump = (u: number, a: number, b: number) => {
  const k = seg(u, a, b);
  return k > 0 && k < 1 ? Math.sin(Math.PI * k) : 0;
};
/** A jump's height: a parabola from a to b peaking at 1. */
const arc = (u: number, a: number, b: number) => {
  const k = seg(u, a, b);
  return 4 * k * (1 - k);
};
const smooth = (k: number) => k * k * (3 - 2 * k);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const now = () => performance.now() / 1000;

/** A damped spring: `hz` how lively, `damp` how quickly it settles (1 = no overshoot). */
class Spring {
  v: number;
  vel = 0;
  target: number;
  hz: number;
  damp: number;

  constructor(v: number, hz = 3, damp = 0.7) {
    this.v = v;
    this.target = v;
    this.hz = hz;
    this.damp = damp;
  }

  step(dt: number) {
    const w = 2 * Math.PI * this.hz;
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 120);
      const a = w * w * (this.target - this.v) - 2 * this.damp * w * this.vel;
      this.vel += a * h;
      this.v += this.vel * h;
      left -= h;
    }
  }

  get moving(): boolean {
    return Math.abs(this.target - this.v) > 0.002 || Math.abs(this.vel) > 0.01;
  }

  snap(v: number) {
    this.v = v;
    this.target = v;
    this.vel = 0;
  }
}

// ── Acts ──────────────────────────────────────────────────────────────────────

/** What an act adds this frame. Positions are in body radii, angles in radians. */
interface Delta {
  x: number; y: number; sx: number; sy: number; lean: number; roll: number;
  turn: number; nod: number; earL: number; earR: number; droop: number; eyeScale: number;
  /** Paws: where the act wants them (studio units) and how much (0…1). */
  pawL: Paw | null; pawLw: number;
  pawR: Paw | null; pawRw: number;
}

function emptyDelta(): Delta {
  return {
    x: 0, y: 0, sx: 0, sy: 0, lean: 0, roll: 0, turn: 0, nod: 0, earL: 0, earR: 0, droop: 0, eyeScale: 0,
    pawL: null, pawLw: 0, pawR: null, pawRw: 0,
  };
}

interface Face {
  eye?: EyeShape;
  mouth?: FigMouth;
  brow?: number;
  browUp?: number;
  blush?: number;
}

interface Act {
  name: string;
  start: number;
  dur: number;
  /** Writes the act's additions at progress `u` (0…1), `s` seconds in. */
  play: (u: number, s: number, d: Delta) => void;
  /** His face while it plays (the last act started wins). */
  face?: Face;
  /** Things to do at given seconds into the act. */
  cues?: [number, () => void][];
  done?: () => void;
}

/** A paw position in studio units. */
const P = (x: number, y: number, a = 0): Paw => ({ x, y, a });

// ── Moods (the island's states) ───────────────────────────────────────────────

type BubbleKind = "dots" | "think" | "bang" | "question" | "check" | "cross" | "wait";

interface Mood {
  face: Required<Pick<Face, "eye" | "mouth">> & Face;
  droop: number;
  /** Where he looks on his own, [right, up], mixed with the pointer. */
  look: readonly [number, number] | null;
  bubble: BubbleKind | null;
  /** The bubble's colour. */
  color: string;
  /** Keeps moving on its own (so the island keeps its frames). */
  alive: boolean;
  /** The mood's own gentle loop. */
  loop?: (s: number, d: Delta, e: TokkipMotion) => void;
}

const MOODS: Record<BotStateName, Mood> = {
  idle: { face: { eye: "open", mouth: "smile" }, droop: 0, look: null, bubble: null, color: "#3F9E9A", alive: false },
  working: {
    face: { eye: "open", mouth: "smile", brow: 0.3 }, droop: -4, look: [0, -0.35], bubble: "dots", color: "#4C8DF6", alive: true,
    loop: (s, d) => {
      // Typing: paws tapping in front of him, a small nod with each burst.
      const tap = (ph: number) => Math.max(0, Math.sin(s * 15 + ph)) * 10;
      d.pawL = P(-44, 78 - tap(0)); d.pawLw = 1;
      d.pawR = P(44, 78 - tap(Math.PI)); d.pawRw = 1;
      d.y -= Math.abs(Math.sin(s * 7.5)) * 0.012;
      d.nod -= 0.05 + Math.sin(s * 1.3) * 0.03;
    },
  },
  thinking: {
    face: { eye: "open", mouth: "pout", brow: -0.25 }, droop: 0, look: [0.5, 0.55], bubble: "think", color: "#9B6CF0", alive: true,
    loop: (s, d) => {
      // A paw on his chin, tapping now and then; a slow tilt.
      const tapping = Math.sin(s * 0.9) > 0.55 ? Math.sin(s * 14) * 4 : 0;
      d.pawR = P(30, 52 + tapping, -0.6); d.pawRw = 1;
      d.lean += Math.sin(s * 1.2) * 0.05 + 0.04;
    },
  },
  searching: {
    face: { eye: "open", mouth: "o", browUp: 0.3 }, droop: -6, look: null, bubble: "dots", color: "#5B6CF2", alive: true,
    loop: (s, d) => {
      // A paw over his eyes like a visor, scanning left and right.
      d.pawR = P(18, -24, -0.35); d.pawRw = 1;
      d.turn += Math.sin(s * 2.1) * 0.6;
      d.nod += 0.08;
      d.lean += Math.sin(s * 2.1) * 0.04;
    },
  },
  approval: {
    face: { eye: "wide", mouth: "o", browUp: 0.7 }, droop: -14, look: null, bubble: "bang", color: "#F5A524", alive: true,
    loop: (s, d) => {
      // Bouncing on the spot, waving to get your attention.
      d.y -= Math.abs(Math.sin(s * 5.5)) * 0.07;
      d.pawR = P(112, -36, Math.sin(s * 11) * 0.45); d.pawRw = 1;
      d.earR += Math.sin(s * 11) * 8;
    },
  },
  question: {
    face: { eye: "open", mouth: "flat", brow: -0.45, browUp: 0.2 }, droop: -8, look: [0.15, 0.25], bubble: "question", color: "#22C3E6", alive: true,
    loop: (s, d) => {
      // Head on one side, scratching it every few seconds.
      d.lean += 0.16;
      const scratch = Math.sin(s * 0.8) > 0.3 ? 1 : 0;
      d.pawR = P(74, -64 + Math.sin(s * 16) * 5 * scratch, 0.4); d.pawRw = scratch;
    },
  },
  error: {
    face: { eye: "teary", mouth: "frown", brow: -0.85 }, droop: 26, look: [0, -0.2], bubble: "cross", color: "#EF5361", alive: true,
    loop: (s, d) => {
      d.sy += Math.sin(s * 2.4) * 0.012;
      d.pawL = P(-40, 84); d.pawLw = 0.7;
      d.pawR = P(40, 84); d.pawRw = 0.7;
    },
  },
  finished: { face: { eye: "smile", mouth: "grin", blush: 0.5 }, droop: -6, look: null, bubble: "check", color: "#2FBF8A", alive: false },
  ratelimit: {
    face: { eye: "sleepy", mouth: "flat", brow: -0.35 }, droop: 30, look: [0, -0.15], bubble: "wait", color: "#F7913D", alive: true,
    loop: (s, d) => {
      d.lean += Math.sin(s * 1.4) * 0.05;
      d.y += 0.03;
      d.sy -= 0.03;
    },
  },
  sleeping: {
    face: { eye: "closed", mouth: "sleepO" }, droop: 46, look: [0, -0.3], bubble: null, color: "#94A2B8", alive: true,
    loop: (s, d) => {
      const breath = Math.sin(s * 1.6);
      d.sy += breath * 0.035;
      d.sx -= breath * 0.02;
      d.lean += 0.06;
    },
  },
  dizzy: {
    face: { eye: "spiral", mouth: "wavy" }, droop: 30, look: null, bubble: null, color: "#F05FA8", alive: true,
    loop: (s, d) => {
      d.x += Math.sin(s * 5) * 0.05;
      d.lean += Math.sin(s * 5 + 1.2) * 0.12;
      d.turn += Math.sin(s * 9) * 0.25;
    },
  },
};

// ── Dancing ───────────────────────────────────────────────────────────────────

/** Tokkip's tempo. */
export const DANCE_BPM = 116;

/** The dance comes in over 0.25 s and goes over 0.4 s. */
export function stepDanceLevel(level: number, dancing: boolean, dt: number): number {
  return dancing ? Math.min(1, level + dt / 0.25) : Math.max(0, level - dt / 0.4);
}

export interface DanceMove {
  /** Body offsets (body radii) and turn (radians), scale. */
  dx: number; dy: number; rotate: number; sx: number; sy: number;
  /** How far each paw is up, 0…1, and how the ears swing (degrees). */
  pawL: number; pawR: number; ears: number;
}

/**
 * Tokkip's dance `seconds` into the song. Four moves, eight beats each, and he
 * blends from one into the next: bounce, sway, twist, pump.
 */
export function danceMove(seconds: number): DanceMove {
  const b = (seconds * DANCE_BPM) / 60;
  const moveAt = (i: number): DanceMove => {
    const ph = b % 1;
    const up = Math.sin(Math.PI * ph);
    const land = Math.pow(1 - up, 5);
    const odd = Math.floor(b) % 2 === 1;
    switch (i % 4) {
      case 0: // bounce, one paw up each beat
        return { dx: 0, dy: -0.15 * up, rotate: 0, sx: 1 + 0.05 * land, sy: 1 - 0.07 * land, pawL: odd ? 0 : up, pawR: odd ? up : 0, ears: odd ? 10 : -10 };
      case 1: { // side to side
        const sw = Math.sin(Math.PI * b);
        return { dx: 0.09 * sw, dy: -0.05 * Math.abs(Math.sin(Math.PI * b * 2)), rotate: 0.13 * sw, sx: 1, sy: 1, pawL: 0.5 + 0.5 * sw, pawR: 0.5 - 0.5 * sw, ears: 18 * sw };
      }
      case 2: { // twist
        const tw = Math.sin(2 * Math.PI * b);
        return { dx: 0, dy: -0.03 * up, rotate: 0.17 * tw, sx: 1 + 0.04 * tw, sy: 1 - 0.03 * tw, pawL: 0.7, pawR: 0.7, ears: -14 * tw };
      }
      default: { // pump both paws
        const pump = Math.max(0, Math.cos(2 * Math.PI * b));
        return { dx: 0, dy: -0.08 * up, rotate: 0, sx: 1 + 0.03 * land, sy: 1 - 0.05 * land, pawL: pump, pawR: pump, ears: 12 * pump };
      }
    }
  };
  const bar = Math.floor(b / 8);
  const into = b - bar * 8;
  const a = moveAt(bar);
  if (into < 7.5) return a;
  const next = moveAt(bar + 1);
  const k = smooth((into - 7.5) / 0.5);
  return {
    dx: lerp(a.dx, next.dx, k), dy: lerp(a.dy, next.dy, k), rotate: lerp(a.rotate, next.rotate, k),
    sx: lerp(a.sx, next.sx, k), sy: lerp(a.sy, next.sy, k), pawL: lerp(a.pawL, next.pawL, k),
    pawR: lerp(a.pawR, next.pawR, k), ears: lerp(a.ears, next.ears, k),
  };
}

/** The dance's body transform at `level` (0…1), for a body of radius R. */
export function danceTransform(seconds: number, level: number, R: number) {
  const m = danceMove(seconds);
  const l = clamp(level, 0, 1);
  return {
    dx: m.dx * R * l,
    dy: m.dy * R * l,
    rotate: m.rotate * l,
    sx: 1 + (m.sx - 1) * l,
    sy: 1 + (m.sy - 1) * l,
  };
}

/** How much he swells with a breath: `fill` 0…1, `level` fades the session in and out. */
export function breathTransform(fill: number, level: number) {
  const f = clamp(fill, 0, 1) * clamp(level, 0, 1);
  return { sx: 1 + 0.12 * f, sy: 1 + 0.18 * f };
}

// ── Particles ─────────────────────────────────────────────────────────────────

type ParticleKind = "heart" | "star" | "twinkle" | "note" | "z" | "drop" | "confetti" | "steam";

interface Particle {
  kind: ParticleKind;
  /** Position and speed in body radii from the centre of his head. */
  x: number; y: number; vx: number; vy: number;
  /** Pulled down (confetti, sweat) or not. */
  g: number;
  age: number; life: number; rot: number; spin: number; size: number; color: string;
}

const CONFETTI = ["#FF5C8A", "#FFD447", "#7C5CFF", "#2FBF8A", "#4C8DF6", "#F7913D"];

// ── The engine ────────────────────────────────────────────────────────────────

export class TokkipMotion {
  /** A pill's little Tokkip: simpler, in the pill's colour, wanders on its own. */
  isMini = false;
  /** A pill's colour (minis only; the main Tokkip keeps his own). */
  bodyColor: RGB | null = null;
  look: TokkipLook = DEFAULT_LOOK;
  /** Room above him in the canvas, for hearts and hats. */
  particleOverhang = 0;
  /** Where the pointer is, −1…1: he looks there. */
  lookX = 0;
  lookY = 0;
  /** Eye size he grows towards (a hover makes his eyes bigger). */
  tgEs = 1;

  state: BotStateName = "idle";
  private mood: Mood = MOODS.idle;
  private moodSince = now();

  /** An emote's eyes until a time; a pill's mini can keep one for good. */
  eyeOverride: EyeShape | null = null;
  eyeOverrideUntil = 0;
  permanentEye: EyeShape | null = null;
  permanentEmote: BotEmoteName | null = null;
  private emoteFace: Face | null = null;

  /** Three pokes in a row make him dizzy. */
  onDizzy: (() => void) | null = null;
  private pokes: number[] = [];

  // Springs: position (body radii), squash, lean, gaze, ears, eyes, cheeks.
  private px = new Spring(0, 3.2, 0.7);
  private py = new Spring(0, 3.2, 0.62);
  private psx = new Spring(1, 4, 0.45);
  private psy = new Spring(1, 4, 0.45);
  private lean = new Spring(0, 2.6, 0.6);
  private turn = new Spring(0, 2.2, 0.8);
  private nod = new Spring(0, 2.2, 0.8);
  private droop = new Spring(0, 2, 0.6);
  private es = new Spring(1, 4, 0.55);
  private blush = new Spring(0, 1.5, 0.9);
  private sway = new Spring(0, 1.6, 0.35);
  private catchS = new Spring(0, 2.2, 0.72);
  private outfitK = new Spring(0, 2.6, 0.5);
  private bubbleS = new Spring(0, 3.5, 0.5);
  private pawL: Paw = { x: -80, y: 96, a: 0 };
  private pawR: Paw = { x: 80, y: 96, a: 0 };

  /** His mouth when something is coming his way (a dropped file), body radii. */
  slotH = 0;
  slotHTarget = 0;
  slotHVel = 0;
  private chewUntil = 0;

  // What he wears: `outfit` is on him now; `outfitTarget` is what he'll wear next.
  outfit: Outfit = "none";
  private outfitTarget: Outfit = "none";
  private outfitLanded = true;

  isDancing = false;
  dancingLevel = 0;
  private danceT0 = now();

  isBreathing = false;
  breathFill = 0;
  breathLevel = 0;

  private acts: Act[] = [];
  private particles: Particle[] = [];
  private bubble: BubbleKind | null = null;
  private bubbleColor = "#3F9E9A";
  private nextBubble: BubbleKind | null = null;

  private t0 = now() - Math.random() * 10;
  private blinkAt = -10;
  private nextBlink = now() + rand(1.5, 3.5);
  private nextFidget = now() + rand(5, 9);
  private nextAmbient = 0;
  private miniGaze = { x: 0, y: 0, until: 0 };
  private miniNext = now() + rand(1, 3);
  private lastFrame = { lean: 0, x: 0 };

  // ── States and emotes ───────────────────────────────────────────────────────

  setState(next: BotStateName, force = false) {
    if (next === this.state && !force) return;
    const prev = this.state;
    this.state = next;
    this.mood = MOODS[next];
    this.moodSince = now();
    this.setBubble(this.mood.bubble, this.mood.color);
    if (this.isMini) return;
    switch (next) {
      case "finished":
        this.play(this.actJumpSpin());
        break;
      case "error":
        this.play(this.actShake(0.9));
        break;
      case "approval":
        this.play(this.actHop(0.22, 0.45));
        break;
      case "dizzy":
        this.play(this.actSpin(1.1, 2));
        break;
      case "sleeping":
        this.play(this.actYawn(1.4));
        break;
      default:
        if (prev !== next) this.blink();
    }
  }

  /** A pill's mini keeps doing its emote's thing now and then. */
  setPermanentEmote(emote: BotEmoteName | null) {
    this.permanentEmote = emote;
    const eyes: Partial<Record<BotEmoteName, EyeShape>> = {
      love: "heart", surprised: "wide", proud: "star", yawn: "sleepy", happy: "smile", annoyed: "line",
    };
    this.permanentEye = emote ? eyes[emote] ?? null : null;
    this.eyeOverride = this.permanentEye;
    this.eyeOverrideUntil = this.permanentEye ? Number.POSITIVE_INFINITY : 0;
    this.miniNext = now() + rand(0.6, 2);
  }

  triggerEmote(emote: BotEmoteName, duration = 1.8) {
    const d = Math.max(0.8, duration);
    switch (emote) {
      case "love":
        this.emote({ eye: "heart", mouth: "cat", blush: 1 }, d);
        this.play(this.actLove(d));
        break;
      case "surprised":
        this.emote({ eye: "wide", mouth: "o", browUp: 1 }, d);
        this.play(this.actSurprise());
        break;
      case "proud":
        this.emote({ eye: "star", mouth: "grin", blush: 0.6 }, d);
        this.play(this.actProud(d));
        break;
      case "wink":
        this.emote({ eye: "wink", mouth: "tongue" }, Math.min(d, 1.2));
        this.play(this.actWink());
        break;
      case "yawn":
        this.play(this.actYawn(Math.max(1.6, d)));
        break;
      case "happy":
        this.emote({ eye: "smile", mouth: "grin", blush: 0.5 }, d);
        this.play(this.actHappy());
        break;
      case "annoyed":
        this.emote({ eye: "squint", mouth: "frown", brow: 1 }, Math.min(d, 1.2));
        this.play(this.actHuff());
        window.setTimeout(() => Sound.play("annoyed"), 60);
        break;
    }
  }

  private emote(face: Face, seconds: number) {
    this.emoteFace = face;
    this.eyeOverride = face.eye ?? null;
    this.eyeOverrideUntil = now() + seconds;
  }

  // ── Little reactions ────────────────────────────────────────────────────────

  blink() {
    if (now() - this.blinkAt < 0.2) return;
    this.blinkAt = now();
  }

  /** A quick squash, as when something lands on him. */
  squash(k = 1) {
    this.psy.vel -= 2.2 * k;
    this.psx.vel += 1.8 * k;
  }

  /** A poke (a click on him): he flinches; three in a row and he's dizzy. */
  slap() {
    this.interruptGreet();
    if (this.state === "dizzy") return;
    const t = now();
    this.pokes = this.pokes.filter((p) => t - p < 1.7);
    this.pokes.push(t);
    Sound.play("slap");
    this.squash(1.4);
    const side = Math.random() < 0.5 ? -1 : 1;
    this.lean.vel += side * 3;
    this.px.vel += side * 0.6;
    this.sway.vel += side * 4;
    this.emitAround("twinkle", 3, -0.2);
    if (this.pokes.length >= 3) {
      this.pokes = [];
      this.onDizzy?.();
    } else {
      this.emote({ eye: "squint", mouth: "o", brow: 0.6 }, 0.7);
      window.setTimeout(() => Sound.play("annoyed"), 60);
    }
  }

  /** Something dropped into his paws: he gobbles it up and chews, happily. */
  gulp() {
    this.slotHTarget = 0.42;
    window.setTimeout(() => {
      this.slotHTarget = 0;
      this.chewUntil = now() + 0.9;
    }, 380);
    this.play({
      name: "gulp", start: now(), dur: 1.3,
      play: (u, _s, d) => {
        d.sy += -0.2 * bump(u, 0, 0.12) + 0.16 * bump(u, 0.1, 0.3) - 0.05 * bump(u, 0.3, 0.45);
        d.sx += 0.22 * bump(u, 0, 0.12) - 0.1 * bump(u, 0.1, 0.3);
        d.y -= 0.12 * arc(u, 0.1, 0.32);
        d.lean += Math.sin(u * Math.PI * 6) * 0.05 * seg(u, 0.35, 0.5) * (1 - seg(u, 0.85, 1));
      },
      cues: [[0.35, () => this.emitAround("twinkle", 4, -0.3)]],
    });
  }

  /** "¡Hola!": he hops and waves. */
  greet() {
    Sound.play("greet");
    this.emote({ eye: "smile", mouth: "grin", blush: 0.4 }, 1.9);
    this.play(this.actWave(1.8));
  }

  /** Stops a wave halfway (he was poked). */
  interruptGreet() {
    this.acts = this.acts.filter((a) => a.name !== "wave");
  }

  // ── A dropped file (the "catch" pose) ───────────────────────────────────────

  /** 0 = himself, 1 = paws up and mouth ready for what you're dragging in. */
  get morph(): number {
    return this.catchS.v;
  }

  animateMorph(target: number) {
    this.catchS.target = clamp(target, 0, 1);
  }

  resetMorph() {
    this.catchS.snap(0);
  }

  // ── Clothes ─────────────────────────────────────────────────────────────────

  /**
   * Dresses him. Animated, what he wears lifts off and the new one drops on
   * with a little squash when it lands; otherwise it just changes.
   */
  setOutfit(next: Outfit, animated = true) {
    if (next === this.outfitTarget) return;
    this.outfitTarget = next;
    if (!animated) {
      this.outfit = next;
      this.outfitK.snap(next === "none" ? 0 : 1);
      this.outfitLanded = true;
      return;
    }
    this.outfitK.target = 0;
    if (this.outfit === "none") this.swapOutfit();
  }

  private swapOutfit() {
    this.outfit = this.outfitTarget;
    if (this.outfit !== "none") {
      this.outfitK.snap(0);
      this.outfitK.target = 1;
      this.outfitLanded = false;
    }
  }

  // ── Music and breathing ─────────────────────────────────────────────────────

  setDancing(dancing: boolean) {
    if (dancing && !this.isDancing && this.dancingLevel < 0.01) this.danceT0 = now();
    this.isDancing = dancing;
  }

  /** Bounces the canvas to the beat around his feet. Call on a saved context, before draw(). */
  applyDance(x: CanvasRenderingContext2D, W: number, H: number) {
    if (this.dancingLevel <= 0.001) return;
    const R = W * 0.3;
    const { cx, feet } = this.anchor(W, H);
    const d = danceTransform(now() - this.danceT0, this.dancingLevel, R);
    x.translate(cx + d.dx, feet + d.dy);
    x.rotate(d.rotate);
    x.scale(d.sx, d.sy);
    x.translate(-cx, -feet);
  }

  /** A guided breath: eyes closed, swelling with each inhale (`fill` 0…1). */
  setBreathing(on: boolean, fill = 0) {
    this.breathFill = clamp(fill, 0, 1);
    if (on === this.isBreathing) return;
    this.isBreathing = on;
    if (on) {
      this.eyeOverride = "closed";
      this.eyeOverrideUntil = Number.POSITIVE_INFINITY;
    } else if (this.eyeOverride === "closed") {
      this.eyeOverride = this.permanentEye;
      this.eyeOverrideUntil = this.permanentEye ? Number.POSITIVE_INFINITY : 0;
    }
  }

  /** Swells him from his feet with the breath. Call on a saved context, before draw(). */
  applyBreath(x: CanvasRenderingContext2D, W: number, H: number) {
    if (this.breathLevel <= 0.001) return;
    const { cx, feet } = this.anchor(W, H);
    const b = breathTransform(this.breathFill, this.breathLevel);
    x.translate(cx, feet);
    x.scale(b.sx, b.sy);
    x.translate(-cx, -feet);
  }

  // ── Acts ────────────────────────────────────────────────────────────────────

  private play(act: Act) {
    // One of each at a time: a new hop replaces the one in the air.
    this.acts = this.acts.filter((a) => a.name !== act.name);
    this.acts.push(act);
  }

  private actHop(h: number, dur: number): Act {
    return {
      name: "hop", start: now(), dur,
      play: (u, _s, d) => {
        d.y -= h * arc(u, 0.15, 0.85);
        d.sy += -0.14 * bump(u, 0, 0.18) + 0.1 * bump(u, 0.15, 0.5) - 0.12 * bump(u, 0.82, 1);
        d.sx += 0.12 * bump(u, 0, 0.18) - 0.06 * bump(u, 0.15, 0.5) + 0.1 * bump(u, 0.82, 1);
        d.earL -= 14 * bump(u, 0.15, 0.6);
        d.earR += 14 * bump(u, 0.15, 0.6);
      },
    };
  }

  private actSpin(dur: number, turns: number): Act {
    return {
      name: "spin", start: now(), dur,
      play: (u, _s, d) => {
        d.roll += Math.PI * 2 * turns * smooth(u);
      },
    };
  }

  private actJumpSpin(): Act {
    return {
      name: "jumpSpin", start: now(), dur: 1.1,
      face: { eye: "smile", mouth: "grin", blush: 0.5 },
      play: (u, _s, d) => {
        d.y -= 0.42 * arc(u, 0.12, 0.8);
        d.roll += Math.PI * 2 * smooth(seg(u, 0.2, 0.72));
        d.sy += -0.16 * bump(u, 0, 0.14) + 0.12 * bump(u, 0.12, 0.35) - 0.14 * bump(u, 0.78, 0.95);
        d.sx += 0.14 * bump(u, 0, 0.14) + 0.12 * bump(u, 0.78, 0.95);
        const up = bump(u, 0.1, 0.9);
        d.pawL = P(-104, -64); d.pawLw = up;
        d.pawR = P(104, -64); d.pawRw = up;
      },
      cues: [[0.5, () => this.emitAround("confetti", 14, -0.2)], [0.55, () => Sound.play("pop")]],
    };
  }

  private actShake(dur: number): Act {
    return {
      name: "shake", start: now(), dur,
      play: (u, _s, d) => {
        const fade = 1 - u;
        d.x += Math.sin(u * Math.PI * 9) * 0.06 * fade;
        d.lean += Math.sin(u * Math.PI * 9 + 0.6) * 0.08 * fade;
        d.turn += Math.sin(u * Math.PI * 9) * 0.3 * fade;
      },
    };
  }

  private actWave(dur: number): Act {
    return {
      name: "wave", start: now(), dur,
      play: (u, s, d) => {
        const up = seg(u, 0, 0.14) * (1 - seg(u, 0.86, 1));
        d.pawR = P(116, -48, -0.3 + Math.sin(s * 14) * 0.5); d.pawRw = up;
        d.lean -= 0.07 * up;
        d.y -= 0.1 * arc(u, 0, 0.22);
        d.earR += Math.sin(s * 14) * 10 * up;
        d.turn += 0.15 * up;
      },
    };
  }

  private actLove(dur: number): Act {
    return {
      name: "love", start: now(), dur,
      play: (u, s, d) => {
        const on = seg(u, 0, 0.1) * (1 - seg(u, 0.85, 1));
        d.lean += Math.sin(s * 3.2) * 0.08 * on;
        d.y -= 0.08 * arc(u, 0, 0.18);
        d.pawL = P(-30, 66, 0.5); d.pawLw = on;
        d.pawR = P(30, 66, -0.5); d.pawRw = on;
      },
      cues: [[0.05, () => this.emitAround("heart", 3, -0.1)], [0.7, () => this.emitAround("heart", 2, -0.1)]],
    };
  }

  private actSurprise(): Act {
    return {
      name: "surprise", start: now(), dur: 0.8,
      play: (u, _s, d) => {
        d.y -= 0.32 * arc(u, 0, 0.45);
        d.sy += 0.14 * bump(u, 0, 0.3) - 0.1 * bump(u, 0.4, 0.6);
        d.sx -= 0.08 * bump(u, 0, 0.3);
        d.droop -= 22 * bump(u, 0, 0.9);
        d.eyeScale += 0.25 * bump(u, 0, 0.7);
        const up = bump(u, 0, 0.6);
        d.pawL = P(-112, -20); d.pawLw = up;
        d.pawR = P(112, -20); d.pawRw = up;
      },
      cues: [[0.05, () => this.emitAround("twinkle", 3, -0.4)]],
    };
  }

  private actProud(dur: number): Act {
    return {
      name: "proud", start: now(), dur,
      play: (u, _s, d) => {
        const on = smooth(seg(u, 0, 0.15)) * (1 - smooth(seg(u, 0.8, 1)));
        d.sy += 0.08 * on;
        d.sx += 0.04 * on;
        d.lean -= 0.1 * on;
        d.nod += 0.2 * on;
        d.pawL = P(-108, 44, 0.8); d.pawLw = on;
        d.pawR = P(108, 44, -0.8); d.pawRw = on;
      },
      cues: [[0.1, () => this.emitAround("star", 5, -0.2)]],
    };
  }

  private actWink(): Act {
    return {
      name: "wink", start: now(), dur: 1.0,
      play: (u, _s, d) => {
        const on = bump(u, 0, 1);
        d.lean += 0.12 * on;
        d.y -= 0.05 * arc(u, 0, 0.3);
        d.pawR = P(96, 10, -0.4); d.pawRw = on * 0.8;
      },
      cues: [[0.15, () => this.emitAround("twinkle", 1, 0.3)]],
    };
  }

  private actYawn(dur: number): Act {
    return {
      name: "yawn", start: now(), dur,
      face: { eye: "squint", mouth: "gape" },
      play: (u, _s, d) => {
        const st = bump(u, 0.05, 0.75);
        d.sy += 0.14 * st;
        d.sx -= 0.07 * st;
        d.nod += 0.25 * st;
        d.pawL = P(-64, -118, -0.3); d.pawLw = st;
        d.pawR = P(64, -118, 0.3); d.pawRw = st;
        d.droop += 20 * seg(u, 0.6, 1);
      },
      cues: [[0.75, () => this.emitAround("z", 2, 0.4)]],
      done: () => this.emote({ eye: "sleepy", mouth: "flat" }, 1.2),
    };
  }

  private actHappy(): Act {
    return {
      name: "happy", start: now(), dur: 1.0,
      play: (u, _s, d) => {
        d.y -= 0.16 * arc(u, 0, 0.4) + 0.12 * arc(u, 0.45, 0.8);
        d.sy += -0.1 * bump(u, 0.36, 0.48) - 0.1 * bump(u, 0.78, 0.92);
        d.sx += 0.08 * bump(u, 0.36, 0.48) + 0.08 * bump(u, 0.78, 0.92);
        d.lean += Math.sin(u * Math.PI * 4) * 0.08;
        const up = bump(u, 0, 1);
        d.pawL = P(-100, -40); d.pawLw = up;
        d.pawR = P(100, -40); d.pawRw = up;
      },
      cues: [[0.3, () => this.emitAround("twinkle", 3, -0.2)]],
    };
  }

  private actHuff(): Act {
    return {
      name: "huff", start: now(), dur: 1.1,
      play: (u, _s, d) => {
        d.sx += 0.07 * bump(u, 0, 0.35);
        d.sy -= 0.04 * bump(u, 0, 0.35);
        d.y += 0.04 * (bump(u, 0.4, 0.55) + bump(u, 0.65, 0.8));
        d.lean += 0.05 * Math.sin(u * Math.PI * 6) * seg(u, 0.35, 0.5);
        d.pawL = P(-100, 50, 1); d.pawLw = bump(u, 0, 1);
        d.pawR = P(100, 50, -1); d.pawRw = bump(u, 0, 1);
      },
      cues: [[0.2, () => this.emitAround("steam", 2, -0.6)]],
    };
  }

  // What he does when nobody asks anything of him.

  private fidget() {
    const late = new Date().getHours() >= 23 || new Date().getHours() < 6;
    const r = Math.random();
    if (late && r < 0.35) return this.play(this.actYawn(1.6));
    if (r < 0.2) return this.play(this.actLookAround());
    if (r < 0.36) return this.play(this.actEarFlick());
    if (r < 0.5) return this.play(this.actHop(0.12, 0.45));
    if (r < 0.64) return this.play(this.actHum());
    if (r < 0.76) return this.play(this.actStretch());
    if (r < 0.88) return this.play(this.actWiggle());
    return this.play(this.actSneeze());
  }

  private actLookAround(): Act {
    return {
      name: "lookAround", start: now(), dur: 2.4,
      play: (u, _s, d) => {
        d.turn += -0.7 * smooth(seg(u, 0, 0.15)) * (1 - smooth(seg(u, 0.35, 0.5))) + 0.7 * smooth(seg(u, 0.4, 0.55)) * (1 - smooth(seg(u, 0.8, 0.95)));
        d.nod += 0.1 * bump(u, 0, 1);
      },
    };
  }

  private actEarFlick(): Act {
    const side = Math.random() < 0.5 ? -1 : 1;
    return {
      name: "earFlick", start: now(), dur: 0.7,
      play: (u, _s, d) => {
        const k = 26 * (bump(u, 0, 0.25) + bump(u, 0.35, 0.6));
        if (side < 0) d.earL -= k;
        else d.earR += k;
      },
    };
  }

  private actHum(): Act {
    return {
      name: "hum", start: now(), dur: 2.6,
      face: { eye: "smile", mouth: "o" },
      play: (u, s, d) => {
        const on = seg(u, 0, 0.1) * (1 - seg(u, 0.9, 1));
        d.lean += Math.sin(s * 4) * 0.07 * on;
        d.y -= Math.abs(Math.sin(s * 4)) * 0.03 * on;
        d.earL += Math.sin(s * 4) * 10 * on;
        d.earR += Math.sin(s * 4) * 10 * on;
      },
      cues: [[0.15, () => this.emitAround("note", 1, 0.5)], [0.5, () => this.emitAround("note", 1, 0.5)], [0.8, () => this.emitAround("note", 1, 0.5)]],
    };
  }

  private actStretch(): Act {
    return {
      name: "stretch", start: now(), dur: 1.5,
      face: { eye: "squint", mouth: "smile" },
      play: (u, _s, d) => {
        const st = bump(u, 0, 0.85);
        d.sy += 0.1 * st;
        d.sx -= 0.05 * st;
        d.lean += Math.sin(u * Math.PI * 2) * 0.06 * st;
        d.pawL = P(-58, -116); d.pawLw = st;
        d.pawR = P(58, -116); d.pawRw = st;
      },
    };
  }

  private actWiggle(): Act {
    return {
      name: "wiggle", start: now(), dur: 1.2,
      face: { eye: "smile", mouth: "smile" },
      play: (u, _s, d) => {
        const on = bump(u, 0, 1);
        d.lean += Math.sin(u * Math.PI * 8) * 0.1 * on;
        d.sx += Math.sin(u * Math.PI * 16) * 0.03 * on;
        d.earL += Math.sin(u * Math.PI * 8) * 18 * on;
        d.earR += Math.sin(u * Math.PI * 8) * 18 * on;
      },
    };
  }

  private actSneeze(): Act {
    return {
      name: "sneeze", start: now(), dur: 1.7,
      play: (u, _s, d) => {
        // Ah… ah… (leaning back, nose up) — CHOO! (thrown forward) — a shake.
        const build = smooth(seg(u, 0, 0.45)) * (1 - seg(u, 0.5, 0.55));
        d.lean -= 0.12 * build;
        d.nod += 0.3 * build;
        d.sy += 0.07 * build;
        const choo = bump(u, 0.5, 0.68);
        d.lean += 0.16 * choo;
        d.sy -= 0.16 * choo;
        d.sx += 0.12 * choo;
        d.nod -= 0.3 * choo;
        d.turn += Math.sin(u * Math.PI * 14) * 0.25 * seg(u, 0.7, 0.75) * (1 - seg(u, 0.9, 1));
      },
      face: { eye: "squint", mouth: "o" },
      cues: [[0.52, () => { this.emitAround("twinkle", 4, 0.2); Sound.play("pop"); }]],
    };
  }

  // ── Bubble ──────────────────────────────────────────────────────────────────

  private setBubble(kind: BubbleKind | null, color: string) {
    if (kind === this.bubble && color === this.bubbleColor) return;
    this.nextBubble = kind;
    this.bubbleColor = color;
    if (this.bubble == null) {
      this.bubble = kind;
      this.bubbleS.v = 0;
      this.bubbleS.target = kind ? 1 : 0;
    } else {
      this.bubbleS.target = 0;
    }
  }

  // ── Particles ───────────────────────────────────────────────────────────────

  /** Sends `count` particles up from around his head; `side` leans them (−1 left … 1 right). */
  private emitAround(kind: ParticleKind, count: number, side = 0) {
    for (let i = 0; i < count; i++) {
      const fall = kind === "confetti";
      this.particles.push({
        kind,
        x: (Math.random() - 0.5) * 0.9 + side * 0.5,
        y: kind === "steam" ? -0.55 : -0.8 - Math.random() * 0.2,
        vx: (Math.random() - 0.5) * (fall ? 1.6 : 0.4) + side * 0.25 + (kind === "steam" ? (i % 2 ? 0.5 : -0.5) : 0),
        vy: fall ? -rand(1.2, 1.9) : -rand(0.4, 0.75),
        g: fall ? 2.6 : kind === "drop" ? 1.2 : 0,
        age: -i * (fall ? 0.02 : 0.13),
        life: fall ? rand(1.1, 1.6) : rand(1.1, 1.7),
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * (fall ? 12 : 2),
        size: kind === "confetti" ? rand(0.05, 0.08) : rand(0.13, 0.2),
        color: kind === "confetti" ? CONFETTI[Math.floor(Math.random() * CONFETTI.length)]! : "",
      });
    }
  }

  // ── Frame ───────────────────────────────────────────────────────────────────

  /** True while anything still moves: the island keeps its frames only then. */
  get busy(): boolean {
    const springs = [this.px, this.py, this.psx, this.psy, this.lean, this.turn, this.nod, this.droop, this.es,
      this.blush, this.catchS, this.outfitK, this.bubbleS];
    return (
      this.acts.length > 0 || this.particles.length > 0 || this.mood.alive || this.isMini ||
      this.isDancing || this.dancingLevel > 0.001 || this.isBreathing || this.breathLevel > 0.001 ||
      now() - this.blinkAt < 0.2 || now() < this.chewUntil || this.slotH > 0.001 || Math.abs(this.slotHVel) > 0.001 ||
      springs.some((s) => s.moving) ||
      (this.outfit !== "none" && this.sway.moving) ||
      this.outfit !== this.outfitTarget
    );
  }

  /** How long the island may sleep before he does something on his own (a blink, a fidget). */
  idleWaitMs(): number {
    const next = this.state === "idle" ? Math.min(this.nextBlink, this.nextFidget) : this.nextBlink;
    return Math.max(50, (next - now()) * 1000);
  }

  update(dt: number) {
    const t = now();

    // Blinks, now and then (twice in a row sometimes).
    if (t > this.nextBlink) {
      if (this.state !== "sleeping" && this.state !== "dizzy") {
        this.blink();
        if (Math.random() < 0.2) window.setTimeout(() => this.blink(), 260);
      }
      this.nextBlink = t + rand(2.4, 5.8);
    }

    // On his own: fidgets when idle, his mood's sprinkles otherwise.
    const free = this.acts.length === 0 && !this.isDancing && !this.isBreathing && this.catchS.target < 0.5;
    if (!this.isMini && this.state === "idle" && free && t > this.nextFidget) {
      this.fidget();
      this.nextFidget = t + rand(6, 12);
    } else if (this.state !== "idle" && t > this.nextFidget) {
      this.nextFidget = t + rand(6, 12);
    }
    if (t > this.nextAmbient) {
      this.nextAmbient = t + 1.4;
      if (this.state === "sleeping") this.emitAround("z", 1, 0.5);
      if (this.state === "ratelimit" && !this.isMini && Math.random() < 0.6) this.emitAround("drop", 1, 0.6);
      if (this.isDancing && this.dancingLevel > 0.5 && !this.isMini && Math.random() < 0.7) this.emitAround("note", 1, Math.random() - 0.5);
    }
    if (this.isMini && t > this.miniNext) this.miniBehaviour(t);

    // Emote faces run out.
    if (this.eyeOverride && t > this.eyeOverrideUntil) {
      this.eyeOverride = this.permanentEye;
      this.eyeOverrideUntil = this.permanentEye ? Number.POSITIVE_INFINITY : 0;
      this.emoteFace = null;
    }

    // Acts: cues, then the end.
    for (const a of [...this.acts]) {
      const el = t - a.start;
      if (a.cues) {
        for (const c of a.cues) {
          if (c[0] >= 0 && el >= c[0] * a.dur) {
            c[0] = -1;
            c[1]();
          }
        }
      }
      if (el >= a.dur) {
        this.acts = this.acts.filter((x) => x !== a);
        a.done?.();
      }
    }

    // Where he looks: the pointer, his mood, or (a mini) wherever he likes.
    let tx = this.lookX * 0.62;
    let ty = this.lookY * 0.5;
    if (this.mood.look) {
      tx = tx * 0.3 + this.mood.look[0];
      ty = ty * 0.3 + this.mood.look[1];
    }
    if (this.isMini && !this.mood.look) {
      if (t > this.miniGaze.until) this.miniGaze = { x: rand(-0.8, 0.8), y: rand(-0.4, 0.5), until: t + rand(0.6, 2) };
      tx = this.miniGaze.x * 0.6;
      ty = this.miniGaze.y * 0.5;
    }
    if (this.catchS.v > 0.05) {
      tx = lerp(tx, this.lookX * 0.7, this.catchS.v);
      ty = lerp(ty, Math.max(0.2, this.lookY * 0.6), this.catchS.v);
    }
    this.turn.target = tx;
    this.nod.target = ty;

    this.droop.target = this.mood.droop - 14 * this.catchS.v + (this.isBreathing ? 10 - this.breathFill * 18 : 0);
    this.es.target = this.tgEs + 0.1 * this.catchS.v;
    const face = this.faceNow();
    this.blush.target = Math.max(face.blush ?? 0, this.state === "finished" ? 0.4 : 0);
    this.py.target = 0;
    this.px.target = 0;
    this.psx.target = 1;
    this.psy.target = 1;
    this.lean.target = 0;

    // A dropped file's mouth: a spring of its own.
    const w = (2 * Math.PI) / 0.3;
    this.slotHVel += (w * w * (this.slotHTarget - this.slotH) - 2 * 0.62 * w * this.slotHVel) * dt;
    this.slotH = Math.max(0, this.slotH + this.slotHVel * dt);

    // What he wears changes once the old one has lifted off; a landing squashes him.
    if (this.outfit !== this.outfitTarget && this.outfitK.v < 0.05) this.swapOutfit();
    if (!this.outfitLanded && this.outfitK.v > 0.92) {
      this.outfitLanded = true;
      this.squash(0.8);
    }

    // Soft parts lag behind his moves.
    if (dt > 0) {
      const leanVel = (this.lean.v - this.lastFrame.lean) / dt;
      const xVel = (this.px.v - this.lastFrame.x) / dt;
      this.sway.target = clamp(-leanVel * 0.25 - xVel * 0.6 - this.lean.v * 1.5, -1, 1);
    }
    this.lastFrame = { lean: this.lean.v, x: this.px.v };

    for (const sp of [this.px, this.py, this.psx, this.psy, this.lean, this.turn, this.nod, this.droop, this.es,
      this.blush, this.sway, this.catchS, this.outfitK, this.bubbleS]) sp.step(dt);

    // The bubble changes once the old one has shrunk away.
    if (this.bubble !== this.nextBubble && this.bubbleS.v < 0.05) {
      this.bubble = this.nextBubble;
      if (this.bubble) this.bubbleS.target = 1;
    }

    for (const p of this.particles) {
      p.age += dt;
      if (p.age < 0) continue;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);

    this.dancingLevel = stepDanceLevel(this.dancingLevel, this.isDancing, dt);
    this.breathLevel = this.isBreathing ? Math.min(1, this.breathLevel + dt / 0.6) : Math.max(0, this.breathLevel - dt / 0.8);
  }

  private miniBehaviour(t: number) {
    switch (this.permanentEmote) {
      case "happy": this.play(this.actHop(0.25, 0.5)); this.miniNext = t + rand(1.8, 3); break;
      case "annoyed": this.play(this.actShake(0.6)); this.miniNext = t + rand(3, 5); break;
      case "wink":
        this.emote({ eye: "wink", mouth: "tongue" }, 0.6);
        this.play(this.actWink());
        this.miniNext = t + rand(2.2, 4);
        break;
      case "love": this.play(this.actLove(1.4)); this.miniNext = t + rand(2.6, 4); break;
      default:
        if (this.state === "idle" && Math.random() < 0.5) this.play(this.actHop(0.12, 0.45));
        this.miniNext = t + rand(3, 5);
    }
  }

  /** His face this frame, by priority. */
  private faceNow(): Face & { eye: EyeShape; mouth: FigMouth } {
    const mood = this.mood.face;
    if (this.isBreathing || this.breathLevel > 0.5) {
      return { eye: "closed", mouth: this.breathFill > 0.5 ? "o" : "flat", brow: 0, browUp: 0, blush: 0.2 };
    }
    if (now() < this.chewUntil) return { eye: "smile", mouth: "chew", blush: 0.5 };
    if (this.catchS.v > 0.4) return { eye: "sparkle", mouth: "gape", browUp: 0.6 };
    for (let i = this.acts.length - 1; i >= 0; i--) {
      const f = this.acts[i]!.face;
      if (f?.eye) return { mouth: mood.mouth, ...f, eye: f.eye };
    }
    if (this.eyeOverride) {
      const f = this.emoteFace ?? {};
      return { ...f, eye: this.eyeOverride, mouth: f.mouth ?? (this.permanentEye ? mood.mouth : "smile") };
    }
    if (this.dancingLevel > 0.2 && (this.state === "idle" || this.state === "finished")) {
      return { eye: "smile", mouth: "grin", blush: 0.3 };
    }
    return mood;
  }

  // ── Drawing ─────────────────────────────────────────────────────────────────

  /** His size and where he stands in a W×H canvas. */
  private anchor(W: number, H: number) {
    const R = W * 0.3;
    const cx = W / 2 + this.px.v * R;
    const cy = H / 2 + this.particleOverhang / 2 + this.py.v * R + R * 0.06;
    const u = this.isMini ? R * 0.0068 : R * 0.0095;
    const off = this.isMini ? 46 : -8;
    return { R, cx, cy, u, off, feet: cy + (120 + off) * u };
  }

  /** Draws him, his bubble and his particles in a W×H canvas (CSS pixels). */
  draw(x: CanvasRenderingContext2D, W: number, H: number) {
    const t = now();
    const s = t - this.t0;
    const d = emptyDelta();
    this.mood.loop?.(t - this.moodSince, d, this);
    for (const a of this.acts) {
      const el = Math.max(0, t - a.start);
      a.play(clamp(el / a.dur, 0, 1), el, d);
    }

    const { R, cx: cx0, cy: cy0, u, off } = this.anchor(W, H);
    const cx = cx0 + d.x * R;
    const cy = cy0 + d.y * R;
    const feet = cy + (120 + off) * u;
    const look = this.isMini && this.bodyColor ? pillLook(this.bodyColor) : this.look;
    const f = this.figureNow(look, s, d);

    x.save();
    if (Math.abs(d.roll) > 0.001) {
      x.translate(cx, cy);
      x.rotate(d.roll);
      x.translate(-cx, -cy);
    }
    x.translate(cx, feet);
    x.rotate(this.lean.v + d.lean);
    x.scale(this.psx.v + d.sx, this.psy.v + d.sy);
    x.translate(0, cy - feet);
    x.scale(u, u);
    x.translate(0, off);
    drawFigure(x, look, f);
    x.restore();

    if (!this.isMini && this.bubble && this.bubbleS.v > 0.01) this.drawBubble(x, R, cx, cy, s);
    if (this.state === "dizzy") this.drawOrbit(x, R, cx, cy, s);
    this.drawParticles(x, R, cx, cy);
  }

  private figureNow(look: TokkipLook, s: number, d: Delta): Figure {
    const f = figure(look, s);
    const face = this.faceNow();
    f.eye = face.eye;
    f.mouth = face.mouth;
    f.brow = face.brow ?? 0;
    f.browUp = face.browUp ?? 0;
    f.gape = face.mouth === "gape" ? (this.catchS.v > 0.4 ? 0.25 + this.slotH * 1.6 : 0.85) : 0;
    f.blush = this.blush.v;
    const bk = seg(now(), this.blinkAt, this.blinkAt + 0.16);
    f.open = bk > 0 && bk < 1 ? 1 - 0.95 * Math.sin(Math.PI * bk) : 1;
    f.eyeScale = this.es.v + d.eyeScale;
    f.turn = clamp(this.turn.v + d.turn, -1, 1);
    f.nod = clamp(this.nod.v + d.nod, -1, 1);
    const dance = this.isDancing || this.dancingLevel > 0.01 ? danceMove(now() - this.danceT0) : null;
    const lvl = this.dancingLevel;
    f.earL = d.earL + (dance ? dance.ears * lvl : 0);
    f.earR = d.earR - (dance ? dance.ears * lvl : 0);
    f.droop = this.droop.v + d.droop;
    f.happy = lvl > 0.15 || face.eye === "smile" || face.eye === "heart" || face.eye === "star";
    f.oy = (this.py.v + d.y) * 100;
    f.mini = this.isMini;
    f.paws = !this.isMini;
    f.outfit = this.isMini ? "none" : this.outfit;
    f.outfitIn = this.outfitK.v;
    f.sway = clamp(this.sway.v, -1, 1);

    // Paws: resting, then the mood's, the catch, the dance, and any act on top.
    const target = (side: -1 | 1): Paw => {
      let p = restPaw(look, side);
      const c = this.catchS.v;
      if (c > 0.001) p = mixPaw(p, P(side * 74, -52, side * -0.5), c);
      if (dance && lvl > 0.001) {
        const up = side < 0 ? dance.pawL : dance.pawR;
        p = mixPaw(p, P(side * 106, -46, side * 0.3), up * lvl);
      }
      const act = side < 0 ? d.pawL : d.pawR;
      const w = side < 0 ? d.pawLw : d.pawRw;
      if (act && w > 0) p = mixPaw(p, act, clamp(w, 0, 1));
      return p;
    };
    // Smoothed so paws never jump from one place to another.
    const k = 0.35;
    this.pawL = mixPaw(this.pawL, target(-1), k);
    this.pawR = mixPaw(this.pawR, target(1), k);
    f.pawL = this.pawL;
    f.pawR = this.pawR;
    return f;
  }

  private drawBubble(x: CanvasRenderingContext2D, R: number, cx: number, cy: number, s: number) {
    const k = this.bubbleS.v;
    const r = R * 0.3;
    const bx = cx + R * 0.95;
    const by = cy - R * 0.85;
    x.save();
    x.translate(bx, by);
    x.scale(k, k);
    x.fillStyle = "#FFFFFF";
    x.shadowColor = "rgba(0,0,0,.18)";
    x.shadowBlur = R * 0.08;
    if (this.bubble === "think") {
      for (const [ox, oy, rr] of [[-0.55, -0.1, 0.62], [0.05, -0.32, 0.72], [0.6, -0.05, 0.6], [0.05, 0.25, 0.65]] as const) {
        x.beginPath();
        x.arc(ox * r, oy * r, rr * r, 0, Math.PI * 2);
        x.fill();
      }
      x.beginPath();
      x.arc(-r * 0.9, r * 0.85, r * 0.18, 0, Math.PI * 2);
      x.arc(-r * 1.25, r * 1.2, r * 0.1, 0, Math.PI * 2);
      x.fill();
    } else {
      x.beginPath();
      x.arc(0, 0, r, 0, Math.PI * 2);
      x.moveTo(-r * 0.75, r * 0.45);
      x.lineTo(-r * 1.15, r * 1.05);
      x.lineTo(-r * 0.25, r * 0.85);
      x.fill();
    }
    x.shadowBlur = 0;
    const c = this.bubbleColor;
    x.fillStyle = c;
    x.strokeStyle = c;
    x.lineCap = "round";
    x.lineJoin = "round";
    x.lineWidth = r * 0.22;
    switch (this.bubble) {
      case "dots":
      case "think":
        for (let i = 0; i < 3; i++) {
          const jump = Math.max(0, Math.sin(s * 6 - i * 0.8)) * r * 0.18;
          x.beginPath();
          x.arc((i - 1) * r * 0.42, -jump, r * 0.15, 0, Math.PI * 2);
          x.fill();
        }
        break;
      case "bang":
        x.beginPath();
        x.moveTo(0, -r * 0.55);
        x.lineTo(0, r * 0.12);
        x.stroke();
        x.beginPath();
        x.arc(0, r * 0.48, r * 0.13, 0, Math.PI * 2);
        x.fill();
        break;
      case "question":
        x.beginPath();
        x.arc(0, -r * 0.2, r * 0.3, Math.PI * 1.1, Math.PI * 2.35);
        x.quadraticCurveTo(0, r * 0.05, 0, r * 0.18);
        x.stroke();
        x.beginPath();
        x.arc(0, r * 0.52, r * 0.12, 0, Math.PI * 2);
        x.fill();
        break;
      case "check":
        x.beginPath();
        x.moveTo(-r * 0.42, 0);
        x.lineTo(-r * 0.1, r * 0.32);
        x.lineTo(r * 0.45, -r * 0.3);
        x.stroke();
        break;
      case "cross":
        x.beginPath();
        x.moveTo(-r * 0.32, -r * 0.32);
        x.lineTo(r * 0.32, r * 0.32);
        x.moveTo(r * 0.32, -r * 0.32);
        x.lineTo(-r * 0.32, r * 0.32);
        x.stroke();
        break;
      case "wait": {
        // An hourglass that turns over.
        x.save();
        x.rotate(Math.floor(s / 1.5) % 2 ? Math.PI : 0);
        x.lineWidth = r * 0.14;
        x.beginPath();
        x.moveTo(-r * 0.32, -r * 0.48);
        x.lineTo(r * 0.32, -r * 0.48);
        x.lineTo(-r * 0.32, r * 0.48);
        x.lineTo(r * 0.32, r * 0.48);
        x.closePath();
        x.stroke();
        x.beginPath();
        x.moveTo(-r * 0.15, r * 0.4);
        x.lineTo(r * 0.15, r * 0.4);
        x.lineTo(0, r * 0.15);
        x.fill();
        x.restore();
        break;
      }
    }
    x.restore();
  }

  /** Little stars going round his head while he's dizzy. */
  private drawOrbit(x: CanvasRenderingContext2D, R: number, cx: number, cy: number, s: number) {
    for (let i = 0; i < 3; i++) {
      const a = s * 4 + (i * Math.PI * 2) / 3;
      const px = cx + Math.cos(a) * R * 0.6;
      const py = cy - R * 1.0 + Math.sin(a) * R * 0.14;
      x.save();
      x.translate(px, py);
      x.rotate(s * 3);
      x.globalAlpha = Math.sin(a) > -0.2 ? 1 : 0.55;
      x.fillStyle = "#F5B83D";
      starShape(x, R * 0.11, R * 0.05);
      x.fill();
      x.restore();
    }
  }

  private drawParticles(x: CanvasRenderingContext2D, R: number, cx: number, cy: number) {
    for (const p of this.particles) {
      if (p.age < 0) continue;
      const life = p.age / p.life;
      const alpha = Math.min(1, p.age / 0.12) * (1 - Math.pow(life, 2));
      const sz = p.size * R * (p.kind === "confetti" ? 1 : 0.8 + 0.4 * Math.min(1, p.age / 0.25));
      x.save();
      x.translate(cx + p.x * R, cy + p.y * R);
      x.rotate(p.kind === "note" || p.kind === "z" || p.kind === "steam" ? Math.sin(p.age * 4) * 0.2 : p.rot);
      x.globalAlpha = Math.max(0, alpha);
      switch (p.kind) {
        case "heart":
          x.fillStyle = "#FF5C8A";
          heartShape(x, sz);
          x.fill();
          break;
        case "star":
          x.fillStyle = "#F5B83D";
          starShape(x, sz, sz * 0.45);
          x.fill();
          break;
        case "twinkle":
          x.fillStyle = "#FFE08A";
          twinkleShape(x, sz * 0.9);
          x.fill();
          break;
        case "note": {
          x.fillStyle = "#7C5CFF";
          x.strokeStyle = "#7C5CFF";
          x.lineWidth = sz * 0.16;
          x.beginPath();
          x.ellipse(-sz * 0.2, sz * 0.4, sz * 0.32, sz * 0.24, -0.4, 0, Math.PI * 2);
          x.fill();
          x.beginPath();
          x.moveTo(sz * 0.1, sz * 0.38);
          x.lineTo(sz * 0.1, -sz * 0.6);
          x.quadraticCurveTo(sz * 0.5, -sz * 0.4, sz * 0.45, -sz * 0.05);
          x.stroke();
          break;
        }
        case "z":
          x.fillStyle = "#9AA7BD";
          x.font = `800 ${sz * 1.5}px system-ui, "Segoe UI", sans-serif`;
          x.textAlign = "center";
          x.textBaseline = "middle";
          x.fillText("z", 0, 0);
          break;
        case "drop":
          x.fillStyle = "#7EC8FF";
          x.beginPath();
          x.moveTo(0, -sz * 0.6);
          x.quadraticCurveTo(sz * 0.5, sz * 0.1, 0, sz * 0.45);
          x.quadraticCurveTo(-sz * 0.5, sz * 0.1, 0, -sz * 0.6);
          x.fill();
          break;
        case "confetti":
          x.fillStyle = p.color;
          x.fillRect(-sz, -sz * 0.45, sz * 2, sz * 0.9);
          break;
        case "steam":
          x.fillStyle = "rgba(255,255,255,.85)";
          x.strokeStyle = "rgba(120,130,150,.5)";
          x.lineWidth = sz * 0.08;
          x.beginPath();
          x.arc(-sz * 0.3, 0, sz * 0.38, 0, Math.PI * 2);
          x.arc(sz * 0.15, -sz * 0.18, sz * 0.42, 0, Math.PI * 2);
          x.arc(sz * 0.4, sz * 0.12, sz * 0.3, 0, Math.PI * 2);
          x.fill();
          x.stroke();
          break;
      }
      x.restore();
    }
  }
}

function mixPaw(a: Paw, b: Paw, k: number): Paw {
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), a: lerp(a.a, b.a, k) };
}
