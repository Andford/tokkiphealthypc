// Copied from Andford/tokkip (windows/src) by scripts/sync-tokkip.mjs — change it there.
// Tokkip in one pose: everything that makes up his figure (ears and tail, body,
// face, brows, eyes, mouth, paws and what he wears), drawn in studio units
// (tokkip.ts: the body is about 200 wide, its top at y = −90, its bottom at
// 120). Whoever moves him — the motion engine (motion.ts), the launch greeting
// (greeting.ts), the drop scene (upload/) — fills a Figure and calls
// drawFigure() after placing and scaling the canvas.

import {
  bodyPath, cheekOf, drawBack, drawBody, drawFaceUnder, drawMouth, drawNose, inkOf, mouthY, shade,
  type MouthKind, type TokkipLook, type TokkipPose,
} from "./tokkip";
import { drawOutfit } from "./ropa";
import type { Outfit } from "./wardrobe";

/** How his eyes look. */
export type EyeShape =
  | "open" | "wide" | "dot" | "smile" | "closed" | "line" | "squint" | "spiral"
  | "heart" | "star" | "sleepy" | "wink" | "sparkle" | "teary";

/** His mouth: the studio's shapes plus a few of the engine's own. */
export type FigMouth = MouthKind | "grin" | "gape" | "chew" | "pout";

export interface Paw {
  /** Where the paw is, studio units. */
  x: number;
  y: number;
  /** Turned, radians (a wave rocks it). */
  a: number;
}

export interface Figure {
  /** Seconds, for everything that idles on its own (tail, spirals, twinkles). */
  t: number;
  eye: EyeShape;
  /** Eyelids: 1 open, 0 shut (a blink). */
  open: number;
  /** Eye size: 1 usual, more when amazed. */
  eyeScale: number;
  /** Where his face points, −1…1 each: right and up are positive. */
  turn: number;
  nod: number;
  /** Brows: +1 cross, −1 worried, 0 none; `browUp` raises them (surprise), 0…1. */
  brow: number;
  browUp: number;
  mouth: FigMouth;
  /** How open a "gape" mouth is, 0…1. */
  gape: number;
  /** Rosy cheeks, 0…1 (they always show a little). */
  blush: number;
  /** Ear angles in degrees, and how much they hang (+) or perk up (−). */
  earL: number;
  earR: number;
  droop: number;
  /** Tail wagging fast. */
  happy: boolean;
  /** Vertical speed proxy for the puppy's swinging ears, studio units. */
  oy: number;
  pawL: Paw;
  pawR: Paw;
  /** Paws drawn at all (the pills' tiny Tokkips have none). */
  paws: boolean;
  outfit: Outfit;
  /** The outfit dropping on (0 → 1) or lifting off (1 → 0). */
  outfitIn: number;
  /** How far soft parts (a pompom, a scarf's end) lag behind, −1…1. */
  sway: number;
  /** Fades the details (ears, visor, paws) out, as when he turns into something else. */
  alpha: number;
  /** A pill's little Tokkip: no brows, no paws, no outfit. */
  mini: boolean;
}

/** The paws where they rest: low on his sides (the robot's float beside him). */
export function restPaw(look: TokkipLook, side: -1 | 1): Paw {
  return look.species === "robot" ? { x: side * 118, y: 14, a: 0 } : { x: side * 80, y: 96, a: side * 0.2 };
}

export function figure(look: TokkipLook, t = 0): Figure {
  return {
    t, eye: "open", open: 1, eyeScale: 1, turn: 0, nod: 0, brow: 0, browUp: 0,
    mouth: "smile", gape: 0, blush: 0, earL: 0, earR: 0, droop: 0, happy: false, oy: 0,
    pawL: restPaw(look, -1), pawR: restPaw(look, 1), paws: true,
    outfit: "none", outfitIn: 0, sway: 0, alpha: 1, mini: false,
  };
}

// ── Shapes ────────────────────────────────────────────────────────────────────

export function heartShape(x: CanvasRenderingContext2D, s: number) {
  x.beginPath();
  x.moveTo(0, s * 0.42);
  x.bezierCurveTo(-s * 0.2, s * 0.26, -s, -s * 0.02, -s * 0.62, -s * 0.5);
  x.bezierCurveTo(-s * 0.38, -s * 0.78, -s * 0.06, -s * 0.66, 0, -s * 0.36);
  x.bezierCurveTo(s * 0.06, -s * 0.66, s * 0.38, -s * 0.78, s * 0.62, -s * 0.5);
  x.bezierCurveTo(s, -s * 0.02, s * 0.2, s * 0.26, 0, s * 0.42);
  x.closePath();
}

export function starShape(x: CanvasRenderingContext2D, ro: number, ri: number, points = 5) {
  x.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? ri : ro;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  x.closePath();
}

/** A four-pointed twinkle. */
export function twinkleShape(x: CanvasRenderingContext2D, r: number) {
  x.beginPath();
  x.moveTo(0, -r);
  x.quadraticCurveTo(r * 0.16, -r * 0.16, r, 0);
  x.quadraticCurveTo(r * 0.16, r * 0.16, 0, r);
  x.quadraticCurveTo(-r * 0.16, r * 0.16, -r, 0);
  x.quadraticCurveTo(-r * 0.16, -r * 0.16, 0, -r);
  x.closePath();
}

// ── Eyes ──────────────────────────────────────────────────────────────────────

// Tokkip's first face, the one that is his: round ink eyes with no shine that
// blink to a line; happy and closed eyes are simple arcs. The few extras the
// motion engine asks for (sparkle, teary, squint) are drawn in the same style.
// No brows. The phone draws the same face (TokkipEngine.kt).

const HEART_RED = "#E2466E";
const STAR_GOLD = "#F2B42B";
const TEAR_BLUE = "rgba(120,190,255,.85)";
const EYE_LINE = 6;

function line(x: CanvasRenderingContext2D) {
  x.beginPath();
  x.moveTo(-12, 0);
  x.lineTo(12, 0);
  x.stroke();
}

/** A round eye of radius `r`; less than a third open, it is a line. */
function roundEye(x: CanvasRenderingContext2D, open: number, r = 12) {
  if (open < 0.35) return line(x);
  x.beginPath();
  x.ellipse(0, 0, r, r * Math.min(1, open), 0, 0, Math.PI * 2);
  x.fill();
}

/** A happy eye: an arc bent upwards (^). */
function happyArc(x: CanvasRenderingContext2D) {
  x.beginPath();
  x.arc(0, 8, 13, Math.PI * 1.15, Math.PI * 1.85);
  x.stroke();
}

function eyeHeart(x: CanvasRenderingContext2D) {
  x.beginPath();
  x.moveTo(0, 6);
  x.bezierCurveTo(-14, -4, -8, -16, 0, -8);
  x.bezierCurveTo(8, -16, 14, -4, 0, 6);
}

/** One eye, centred on (0, 0). `side` is −1 for his right (screen left), +1 for the other. */
function drawEye(x: CanvasRenderingContext2D, f: Figure, side: -1 | 1, ink: string, raccoon: boolean) {
  x.strokeStyle = ink;
  x.fillStyle = ink;
  x.lineCap = "round";
  x.lineJoin = "round";
  x.lineWidth = EYE_LINE;
  const t = f.t;
  switch (f.eye) {
    case "open":
      roundEye(x, f.open);
      // The raccoon's eyes sit in his dark mask: a dot of light keeps them there.
      if (raccoon && f.open >= 0.35) {
        x.fillStyle = "rgba(255,255,255,.9)";
        x.beginPath();
        x.arc(-4, -5, 3.6, 0, Math.PI * 2);
        x.fill();
      }
      return;
    case "wide":
    case "sparkle":
      if (f.open < 0.35) return line(x);
      x.beginPath();
      x.arc(0, 0, 15, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = "#fff";
      x.beginPath();
      x.arc(-4, -5, 5, 0, Math.PI * 2);
      x.fill();
      return;
    case "dot":
      roundEye(x, f.open, 10);
      return;
    case "smile":
      happyArc(x);
      return;
    case "closed":
      x.beginPath();
      x.arc(0, -2, 12, Math.PI * 0.15, Math.PI * 0.85);
      x.stroke();
      return;
    case "line":
    case "squint":
      line(x);
      return;
    case "spiral":
      x.lineWidth = 3.5;
      x.beginPath();
      for (let a = 0; a < 14; a += 0.25) {
        const r = a * 1.05;
        x.lineTo(Math.cos(a + t * 8 * side) * r, Math.sin(a + t * 8 * side) * r);
      }
      x.stroke();
      return;
    case "heart":
      x.save();
      x.fillStyle = HEART_RED;
      x.translate(0, 2);
      x.scale(1.35, 1.35);
      eyeHeart(x);
      x.fill();
      x.restore();
      return;
    case "star":
      x.save();
      x.fillStyle = STAR_GOLD;
      x.rotate(t * 2 * side);
      starShape(x, 15, 15 * 0.45);
      x.fill();
      x.restore();
      return;
    case "sleepy":
      x.beginPath();
      x.arc(0, 2, 11, 0, Math.PI);
      x.fill();
      x.lineWidth = 4;
      x.beginPath();
      x.moveTo(-13, 1);
      x.lineTo(13, 1);
      x.stroke();
      return;
    case "wink":
      if (side > 0) happyArc(x);
      else roundEye(x, 1);
      return;
    case "teary": {
      roundEye(x, f.open);
      // A tear runs down one side now and then.
      const k = (t * 0.7 + (side > 0 ? 0.5 : 0)) % 1;
      if (k < 0.6) {
        const y = 14 + k * 40;
        x.fillStyle = TEAR_BLUE;
        x.globalAlpha *= 1 - k / 0.6;
        x.beginPath();
        x.moveTo(side * 8, y - 6);
        x.quadraticCurveTo(side * 12, y + 2, side * 8, y + 4);
        x.quadraticCurveTo(side * 4, y + 2, side * 8, y - 6);
        x.fill();
      }
      return;
    }
  }
}

// ── Mouth ─────────────────────────────────────────────────────────────────────

function drawFigMouth(x: CanvasRenderingContext2D, f: Figure, ink: string, y: number) {
  const pink = "#E98A97";
  x.save();
  x.fillStyle = ink;
  x.strokeStyle = ink;
  x.lineWidth = 5.5;
  x.lineCap = "round";
  x.lineJoin = "round";
  switch (f.mouth) {
    case "grin":
      // His first face's big smile.
      x.restore();
      drawMouth(x, "big", ink, f.t, y);
      return;
    case "gape": {
      const g = Math.max(0, Math.min(1, f.gape));
      x.beginPath();
      x.ellipse(0, y + 2 + g * 6, 9 + g * 7, 4 + g * 15, 0, 0, Math.PI * 2);
      x.fill();
      if (g > 0.25) {
        x.fillStyle = pink;
        x.beginPath();
        x.ellipse(0, y + 6 + g * 15, 6 + g * 4, 3 + g * 3, 0, 0, Math.PI * 2);
        x.fill();
      }
      break;
    }
    case "chew":
      if (Math.sin(f.t * 22) > 0) {
        x.beginPath();
        x.ellipse(0, y + 1, 7, 6, 0, 0, Math.PI * 2);
        x.fill();
      } else {
        x.beginPath();
        x.moveTo(-10, y);
        x.quadraticCurveTo(0, y + 5, 10, y);
        x.stroke();
      }
      break;
    case "pout":
      x.beginPath();
      x.arc(5, y + 2, 5.5, 0, Math.PI * 2);
      x.fill();
      break;
    default:
      x.restore();
      drawMouth(x, f.mouth, ink, f.t, y);
      return;
  }
  x.restore();
}

// ── Paws ──────────────────────────────────────────────────────────────────────

export function drawPaw(x: CanvasRenderingContext2D, look: TokkipLook, p: Paw) {
  x.save();
  x.translate(p.x, p.y);
  x.rotate(p.a);
  if (look.species === "robot") {
    x.fillStyle = "rgba(0,0,0,.08)";
    x.beginPath(); x.arc(2, 3, 20, 0, Math.PI * 2); x.fill();
    x.fillStyle = shade(look.body, -0.18);
    x.beginPath(); x.arc(0, 0, 20, 0, Math.PI * 2); x.fill();
    x.fillStyle = shade(look.body, -0.06);
    x.beginPath(); x.arc(0, 0, 12, 0, Math.PI * 2); x.fill();
  } else {
    // A soft round paw in his own colour, with a darker rim and three toe lines.
    x.fillStyle = look.body;
    x.strokeStyle = shade(look.body, -0.2);
    x.lineWidth = 3.5;
    x.beginPath();
    x.ellipse(0, 0, 20, 18, 0, 0, Math.PI * 2);
    x.fill();
    x.stroke();
    x.lineWidth = 2.6;
    x.lineCap = "round";
    for (const tx of [-6, 0, 6]) {
      x.beginPath();
      x.moveTo(tx, -16);
      x.lineTo(tx * 0.9, -9);
      x.stroke();
    }
  }
  x.restore();
}

// ── The whole figure ──────────────────────────────────────────────────────────

/** Draws Tokkip in pose `f`, in studio units around (0, 0). */
export function drawFigure(x: CanvasRenderingContext2D, look: TokkipLook, f: Figure) {
  const pose: TokkipPose = {
    t: f.t, earL: f.earL, earR: f.earR, droop: f.droop, happy: f.happy, oy: f.oy,
    wave: 0, waveT: 0, alpha: f.alpha,
  };
  // The face follows where he looks; glasses go with it.
  const fx = Math.sin(f.turn) * 62;
  const fy = -Math.sin(f.nod) * 40;
  const dressed = !f.mini && f.outfit !== "none" && f.outfitIn > 0.01;
  const wear = { look, t: f.t, k: f.outfitIn, sway: f.sway, fx, fy };
  if (dressed) drawOutfit(x, f.outfit, "back", wear);

  drawBack(x, look, pose);
  drawBody(x, look, pose);

  x.save();
  x.clip(bodyPath(look.species));
  x.translate(fx, 20 + fy);
  drawFaceUnder(x, look);

  const robot = look.species === "robot";
  x.fillStyle = cheekOf(look, Math.min(0.8, 0.3 + f.blush * 0.5));
  if (robot) {
    x.shadowColor = "#F37A9A";
    x.shadowBlur = 10;
  }
  for (const sd of [-1, 1]) {
    x.beginPath();
    if (robot) x.roundRect(sd * 60 - 10, 22, 20, 8, 4);
    else x.ellipse(sd * 70, 18, 17, 9, 0, 0, Math.PI * 2);
    x.fill();
  }
  x.shadowBlur = 0;

  const ink = inkOf(look);
  if (robot) {
    x.shadowColor = ink;
    x.shadowBlur = 14;
  }
  for (const sd of [-1, 1] as const) {
    x.save();
    x.translate(sd * 46, -6);
    x.scale(f.eyeScale, f.eyeScale);
    drawEye(x, f, sd, ink, look.species === "mapache");
    x.restore();
  }
  drawNose(x, look);
  drawFigMouth(x, f, look.species === "mapache" ? "#3A2E2C" : ink, mouthY(look.species));
  x.shadowBlur = 0;
  x.restore();

  if (f.paws && !f.mini && f.alpha > 0.01) {
    x.save();
    x.globalAlpha *= f.alpha;
    drawPaw(x, look, f.pawL);
    drawPaw(x, look, f.pawR);
    x.restore();
  }
  if (dressed) drawOutfit(x, f.outfit, "front", wear);
}
