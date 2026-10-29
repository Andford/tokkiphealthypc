// Copied from Andford/tokkip (windows/src) by scripts/sync-tokkip.mjs — change it there.
// Tokkip's clothes, drawn: one function per outfit, in studio units (see
// tokkip.ts), with "back" pieces drawn before his body and "front" pieces
// after it. Hats sit on the top of his head (headTop), glasses follow his face.
// The list, the seasons and the stored choice are in wardrobe.ts.

import { headTop, shade, type TokkipLook } from "./tokkip";
import { heartShape, starShape } from "./figure";
import { SCRIPT_FONTS } from "../core/fonts";
import type { Outfit, OutfitSelection } from "./wardrobe";

type Ctx = CanvasRenderingContext2D;

export interface Wear {
  look: TokkipLook;
  /** Seconds, for whatever idles (a twinkle, a bobbing heart). */
  t: number;
  /** 0 = not on yet, 1 = on: hats drop in from above, glasses fade in. */
  k: number;
  /** How far the soft parts lag behind his moves, −1…1. */
  sway: number;
  /** Where his face is (glasses go with it), studio units. */
  fx?: number;
  fy?: number;
}

type Layer = "back" | "front";

// ── Helpers ───────────────────────────────────────────────────────────────────

function blob(x: Ctx, cx: number, cy: number, r: number, color: string) {
  x.fillStyle = color;
  x.beginPath();
  x.arc(cx, cy, r, 0, Math.PI * 2);
  x.fill();
}

/** A soft ball of yarn or fur, with a lighter top. */
function pompom(x: Ctx, cx: number, cy: number, r: number, color: string) {
  blob(x, cx, cy, r, color);
  x.fillStyle = "rgba(255,255,255,.35)";
  x.beginPath();
  x.arc(cx - r * 0.3, cy - r * 0.35, r * 0.45, 0, Math.PI * 2);
  x.fill();
}

function flower(x: Ctx, cx: number, cy: number, r: number, petal: string, heart: string, petals = 5, turn = 0) {
  x.fillStyle = petal;
  for (let i = 0; i < petals; i++) {
    const a = turn + (i * Math.PI * 2) / petals;
    x.beginPath();
    x.ellipse(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62, r * 0.55, r * 0.4, a, 0, Math.PI * 2);
    x.fill();
  }
  blob(x, cx, cy, r * 0.38, heart);
}

function leaf(x: Ctx, cx: number, cy: number, len: number, a: number, color: string) {
  x.save();
  x.translate(cx, cy);
  x.rotate(a);
  x.fillStyle = color;
  x.beginPath();
  x.moveTo(0, 0);
  x.quadraticCurveTo(len * 0.5, -len * 0.38, len, 0);
  x.quadraticCurveTo(len * 0.5, len * 0.38, 0, 0);
  x.fill();
  x.restore();
}

// ── Hats ──────────────────────────────────────────────────────────────────────

function partyHat(x: Ctx, w: Wear, top: number) {
  x.save();
  x.translate(-8, top + 10);
  x.rotate(-0.16 + w.sway * 0.12);
  const H = 82;
  const B = 36;
  const cone = new Path2D();
  cone.moveTo(-B, 0);
  cone.quadraticCurveTo(-B * 0.2, -H * 0.5, 0, -H);
  cone.quadraticCurveTo(B * 0.2, -H * 0.5, B, 0);
  cone.quadraticCurveTo(0, 9, -B, 0);
  x.fillStyle = "#7C5CFF";
  x.fill(cone);
  x.save();
  x.clip(cone);
  x.fillStyle = "#FFD447";
  for (let i = -4; i < 6; i++) {
    x.beginPath();
    x.moveTo(-60 + i * 22, 10);
    x.lineTo(-48 + i * 22, 10);
    x.lineTo(12 + i * 22, -H - 10);
    x.lineTo(0 + i * 22, -H - 10);
    x.fill();
  }
  x.fillStyle = "rgba(255,255,255,.18)";
  x.fillRect(-B, -H, B * 0.7, H);
  x.restore();
  // A frill of paper at the base.
  x.fillStyle = "#FF6FA8";
  for (let i = 0; i < 7; i++) {
    const px = -B + 4 + i * ((B * 2 - 8) / 6);
    x.beginPath();
    x.arc(px, 2, 6.5, 0, Math.PI * 2);
    x.fill();
  }
  const bob = Math.sin(w.t * 5) * 1.5 + w.sway * 5;
  pompom(x, bob, -H - 4, 11, "#FF6FA8");
  x.restore();
}

function crown(x: Ctx, w: Wear, top: number) {
  x.save();
  x.translate(0, top + 14);
  x.rotate(w.sway * 0.06);
  x.scale(1.25, 1.25);
  const W = 46;
  const H = 40;
  x.fillStyle = "#F5B83D";
  x.beginPath();
  x.moveTo(-W, 0);
  x.lineTo(-W - 4, -H);
  x.quadraticCurveTo(-W * 0.55, -H * 0.45, -W * 0.45, -H * 0.5);
  x.lineTo(-W * 0.22, -H - 6);
  x.quadraticCurveTo(0, -H * 0.4, W * 0.22, -H - 6);
  x.lineTo(W * 0.45, -H * 0.5);
  x.quadraticCurveTo(W * 0.55, -H * 0.45, W + 4, -H);
  x.lineTo(W, 0);
  x.quadraticCurveTo(0, 7, -W, 0);
  x.closePath();
  x.fill();
  x.fillStyle = "#E39A1B";
  x.fillRect(-W, -9, W * 2, 7);
  x.fillStyle = "rgba(255,255,255,.35)";
  x.beginPath();
  x.ellipse(-W * 0.55, -H * 0.55, 5, 12, 0.2, 0, Math.PI * 2);
  x.fill();
  const gems: [number, number, string][] = [[-W * 0.62, -5, "#4FC3F7"], [0, -5, "#E5486F"], [W * 0.62, -5, "#66D19E"]];
  for (const [gx, gy, c] of gems) {
    blob(x, gx, gy, 5.5, c);
    blob(x, gx - 1.6, gy - 1.6, 1.6, "rgba(255,255,255,.8)");
  }
  for (const px of [-W - 4, -W * 0.22, W * 0.22, W + 4]) {
    blob(x, px, px === -W - 4 || px === W + 4 ? -H : -H - 6, 4.5, "#FFE08A");
  }
  x.restore();
}

function beanie(x: Ctx, w: Wear, top: number) {
  x.save();
  x.translate(0, top + 30);
  x.rotate(w.sway * 0.05);
  const W = 90;
  const knit = "#E8574F";
  x.fillStyle = knit;
  x.beginPath();
  x.moveTo(-W, 0);
  x.bezierCurveTo(-W, -62, W, -62, W, 0);
  x.closePath();
  x.fill();
  // Ribs.
  x.strokeStyle = shade("#E8574F", -0.12);
  x.lineWidth = 3;
  for (let i = -3; i <= 3; i++) {
    x.beginPath();
    x.moveTo(i * 22, -2);
    x.quadraticCurveTo(i * 20, -26, i * 12, -44);
    x.stroke();
  }
  x.fillStyle = "#F48B85";
  x.beginPath();
  x.roundRect(-W - 4, -12, W * 2 + 8, 24, 12);
  x.fill();
  x.strokeStyle = "rgba(0,0,0,.08)";
  x.lineWidth = 2;
  for (let i = -W + 8; i < W; i += 10) {
    x.beginPath();
    x.moveTo(i, -9);
    x.lineTo(i, 9);
    x.stroke();
  }
  pompom(x, w.sway * 6, -50, 15, "#FFF4E6");
  x.restore();
}

function strawHat(x: Ctx, w: Wear, top: number) {
  x.save();
  x.translate(0, top + 12);
  x.rotate(-0.06 + w.sway * 0.08);
  const straw = "#E9C46A";
  x.fillStyle = shade(straw, -0.08);
  x.beginPath();
  x.ellipse(0, 0, 112, 20, 0, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = straw;
  x.beginPath();
  x.moveTo(-50, 0);
  x.bezierCurveTo(-50, -52, 50, -52, 50, 0);
  x.closePath();
  x.fill();
  x.fillStyle = "#3F9E9A";
  x.beginPath();
  x.moveTo(-50, -2);
  x.quadraticCurveTo(0, 4, 50, -2);
  x.lineTo(48, -14);
  x.quadraticCurveTo(0, -8, -48, -14);
  x.closePath();
  x.fill();
  x.strokeStyle = "rgba(120,80,20,.25)";
  x.lineWidth = 2;
  for (let r = 64; r < 112; r += 12) {
    x.beginPath();
    x.ellipse(0, 0, r, r * 0.18, 0, Math.PI * 0.05, Math.PI * 0.95);
    x.stroke();
  }
  flower(x, 40, -12, 10, "#FF8FB1", "#FFD447");
  x.restore();
}

function witchHat(x: Ctx, w: Wear, top: number) {
  x.save();
  x.translate(4, top + 14);
  x.rotate(0.08 + w.sway * 0.1);
  const dark = "#3B2A55";
  x.fillStyle = shade(dark, -0.2);
  x.beginPath();
  x.ellipse(0, 0, 92, 15, 0, 0, Math.PI * 2);
  x.fill();
  const bend = w.sway * 10 + Math.sin(w.t * 1.7) * 3;
  x.fillStyle = dark;
  x.beginPath();
  x.moveTo(-46, -2);
  x.bezierCurveTo(-34, -50, -10, -86, 18 + bend, -112);
  x.quadraticCurveTo(40 + bend, -118, 48 + bend, -100);
  x.quadraticCurveTo(26, -92, 18, -70);
  x.bezierCurveTo(30, -40, 44, -16, 46, -2);
  x.quadraticCurveTo(0, 8, -46, -2);
  x.closePath();
  x.fill();
  x.fillStyle = "#F59E0B";
  x.beginPath();
  x.moveTo(-44, -6);
  x.quadraticCurveTo(0, 4, 44, -6);
  x.lineTo(40, -20);
  x.quadraticCurveTo(0, -10, -40, -20);
  x.closePath();
  x.fill();
  x.strokeStyle = "#FFE08A";
  x.lineWidth = 3;
  x.strokeRect(-8, -19, 16, 12);
  // A tiny star stuck to it.
  x.save();
  x.translate(-18, -44);
  x.rotate(Math.sin(w.t * 2) * 0.2);
  x.fillStyle = "#FFE08A";
  starShape(x, 8, 3.4);
  x.fill();
  x.restore();
  x.restore();
}

function santaHat(x: Ctx, w: Wear, top: number) {
  x.save();
  x.translate(0, top + 22);
  x.rotate(w.sway * 0.06);
  const red = "#D9363E";
  const flop = w.sway * 14 + Math.sin(w.t * 2.2) * 3;
  x.fillStyle = red;
  x.beginPath();
  x.moveTo(-74, 0);
  x.bezierCurveTo(-70, -64, 10, -86, 64 + flop, -52);
  x.quadraticCurveTo(84 + flop, -36, 80 + flop, -14);
  x.quadraticCurveTo(54, -40, 20, -46);
  x.bezierCurveTo(56, -30, 72, -14, 74, 0);
  x.closePath();
  x.fill();
  x.fillStyle = "rgba(255,255,255,.14)";
  x.beginPath();
  x.ellipse(-30, -40, 18, 8, -0.4, 0, Math.PI * 2);
  x.fill();
  // Fur band and pompom.
  x.fillStyle = "#FFF8F0";
  for (let i = -78; i <= 78; i += 13) {
    x.beginPath();
    x.arc(i, Math.sin(i * 0.3) * 1.5, 11, 0, Math.PI * 2);
    x.fill();
  }
  pompom(x, 82 + flop, -10, 14, "#FFF8F0");
  x.restore();
}

function antlers(x: Ctx, w: Wear, top: number) {
  const brown = "#9A6B45";
  for (const s of [-1, 1]) {
    x.save();
    x.translate(s * 30, top + 8);
    x.rotate(s * (0.22 + w.sway * 0.05 * s));
    x.strokeStyle = brown;
    x.lineCap = "round";
    x.lineJoin = "round";
    x.lineWidth = 10;
    x.beginPath();
    x.moveTo(0, 0);
    x.quadraticCurveTo(s * 4, -30, s * 2, -58);
    x.stroke();
    x.lineWidth = 8;
    x.beginPath();
    x.moveTo(s * 2, -26);
    x.quadraticCurveTo(s * 14, -34, s * 24, -48);
    x.moveTo(s * 2, -44);
    x.quadraticCurveTo(s * -10, -54, s * -14, -66);
    x.stroke();
    x.restore();
  }
  // A headband and a little bell in the middle.
  x.strokeStyle = "#2E7D5B";
  x.lineWidth = 7;
  x.beginPath();
  x.moveTo(-44, top + 16);
  x.quadraticCurveTo(0, top - 2, 44, top + 16);
  x.stroke();
  const ring = Math.sin(w.t * 6) * 0.3;
  x.save();
  x.translate(0, top + 8);
  x.rotate(ring * 0.4);
  x.fillStyle = "#F5B83D";
  x.beginPath();
  x.moveTo(-8, 8);
  x.quadraticCurveTo(-8, -6, 0, -7);
  x.quadraticCurveTo(8, -6, 8, 8);
  x.closePath();
  x.fill();
  blob(x, 0, 9, 2.6, "#B7791F");
  x.restore();
}

// ── Headwear that is not a hat ────────────────────────────────────────────────

function hearts(x: Ctx, w: Wear, top: number) {
  x.strokeStyle = "#E5486F";
  x.lineWidth = 6;
  x.lineCap = "round";
  x.beginPath();
  x.moveTo(-80, top + 30);
  x.quadraticCurveTo(0, top - 10, 80, top + 30);
  x.stroke();
  for (const s of [-1, 1]) {
    const bob = Math.sin(w.t * 6 + s) * 4 + w.sway * 8 * s;
    const bx = s * 30 + bob * 0.5;
    const by = top - 34 + Math.abs(bob) * 0.3;
    x.strokeStyle = "#B8344F";
    x.lineWidth = 2.5;
    x.beginPath();
    x.moveTo(s * 22, top + 10);
    x.quadraticCurveTo(s * 26, top - 10, bx, by + 10);
    x.stroke();
    x.save();
    x.translate(bx, by);
    x.rotate(bob * 0.03);
    x.fillStyle = "#FF5C8A";
    heartShape(x, 24);
    x.fill();
    x.fillStyle = "rgba(255,255,255,.6)";
    x.beginPath();
    x.ellipse(-5, -5, 3, 2, -0.5, 0, Math.PI * 2);
    x.fill();
    x.restore();
  }
}

function flowerCrown(x: Ctx, w: Wear, top: number) {
  const pts = [-70, -42, -14, 14, 42, 70];
  const colors = ["#FF8FB1", "#FFD447", "#B39DFF", "#FF8FB1", "#7FD1F7", "#FFD447"];
  x.strokeStyle = "#5DAA68";
  x.lineWidth = 5;
  x.beginPath();
  x.moveTo(-82, top + 30);
  x.quadraticCurveTo(0, top - 6, 82, top + 30);
  x.stroke();
  pts.forEach((px, i) => {
    const py = top + 22 - Math.cos((px / 82) * Math.PI * 0.5) * 22 + 6;
    leaf(x, px, py, 18, (i % 2 ? -0.6 : -2.5) + w.sway * 0.2, "#6CBF76");
  });
  pts.forEach((px, i) => {
    const py = top + 22 - Math.cos((px / 82) * Math.PI * 0.5) * 22 + 2;
    flower(x, px, py, 13 + (i % 2) * 2, colors[i]!, "#FFF4D6", 5, w.t * 0.3 + i);
  });
}

function marigolds(x: Ctx, w: Wear, top: number) {
  // Cempasúchil: round, ruffled, orange.
  const pts = [-76, -50, -24, 2, 28, 54, 78];
  x.strokeStyle = "#3E8E4A";
  x.lineWidth = 5;
  x.beginPath();
  x.moveTo(-88, top + 32);
  x.quadraticCurveTo(0, top - 6, 88, top + 32);
  x.stroke();
  pts.forEach((px, i) => {
    const py = top + 22 - Math.cos((px / 88) * Math.PI * 0.5) * 22 + 4;
    leaf(x, px - 6, py + 6, 16, 2.4 + i * 0.3, "#4FA35B");
  });
  pts.forEach((px, i) => {
    const py = top + 22 - Math.cos((px / 88) * Math.PI * 0.5) * 22;
    const r = 14 + (i % 3 === 1 ? 3 : 0);
    const bob = Math.sin(w.t * 2 + i) * 1.2;
    for (let ring = 0; ring < 3; ring++) {
      const rr = r * (1 - ring * 0.28);
      x.fillStyle = ring === 0 ? "#F28C18" : ring === 1 ? "#F9A826" : "#FFC24B";
      for (let p = 0; p < 9; p++) {
        const a = (p / 9) * Math.PI * 2 + ring * 0.35;
        x.beginPath();
        x.arc(px + Math.cos(a) * rr * 0.55, py + bob + Math.sin(a) * rr * 0.55, rr * 0.5, 0, Math.PI * 2);
        x.fill();
      }
    }
    blob(x, px, py + bob, r * 0.22, "#E06C00");
  });
}

function tricolor(x: Ctx, w: Wear, top: number) {
  // A tricolour rosette pinned to the side of his head, with two ribbons.
  x.save();
  x.translate(56, top + 26);
  x.rotate(0.2 + w.sway * 0.1);
  const tail = (dx: number, color: string, a: number) => {
    x.save();
    x.rotate(a + Math.sin(w.t * 2.4 + dx) * 0.06 + w.sway * 0.2);
    x.fillStyle = color;
    x.beginPath();
    x.moveTo(-6, 0);
    x.lineTo(6, 0);
    x.lineTo(8, 40);
    x.lineTo(0, 33);
    x.lineTo(-8, 40);
    x.closePath();
    x.fill();
    x.restore();
  };
  tail(-1, "#006847", 0.35);
  tail(1, "#CE1126", -0.35);
  const rings: [number, string][] = [[24, "#006847"], [17, "#FFFFFF"], [10, "#CE1126"]];
  for (const [r, c] of rings) {
    x.fillStyle = c;
    x.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const rr = r + (i % 2 ? 2 : 0);
      x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    x.closePath();
    x.fill();
  }
  blob(x, 0, 0, 4, "#F5B83D");
  x.restore();
}

function bow(x: Ctx, w: Wear, top: number) {
  x.save();
  x.translate(46, top + 18);
  x.rotate(0.3 + w.sway * 0.12);
  const pink = "#FF6FA8";
  for (const s of [-1, 1]) {
    x.fillStyle = pink;
    x.beginPath();
    x.moveTo(0, 0);
    x.bezierCurveTo(s * 20, -26, s * 44, -18, s * 40, 0);
    x.bezierCurveTo(s * 44, 18, s * 20, 26, 0, 0);
    x.fill();
    x.fillStyle = shade(pink, -0.18);
    x.beginPath();
    x.moveTo(s * 6, 0);
    x.quadraticCurveTo(s * 22, -10, s * 30, 0);
    x.quadraticCurveTo(s * 22, 8, s * 6, 0);
    x.fill();
  }
  x.fillStyle = shade(pink, -0.1);
  x.beginPath();
  x.roundRect(-9, -10, 18, 20, 7);
  x.fill();
  x.restore();
}

function headphones(x: Ctx, w: Wear, top: number, layer: Layer) {
  const band = "#2B2F3A";
  const cup = "#7C5CFF";
  if (layer === "back") {
    x.strokeStyle = band;
    x.lineWidth = 12;
    x.lineCap = "round";
    x.beginPath();
    x.moveTo(-100, 0);
    x.bezierCurveTo(-100, top - 40, 100, top - 40, 100, 0);
    x.stroke();
    return;
  }
  const beat = Math.max(0, Math.sin(w.t * 12)) * 1.5;
  for (const s of [-1, 1]) {
    x.save();
    x.translate(s * 102, 6);
    x.fillStyle = band;
    x.beginPath();
    x.roundRect(-16, -30, 32, 60, 14);
    x.fill();
    x.fillStyle = cup;
    x.beginPath();
    x.roundRect(-13 - beat, -26 - beat, 26 + beat * 2, 52 + beat * 2, 12);
    x.fill();
    x.fillStyle = "rgba(255,255,255,.25)";
    x.beginPath();
    x.ellipse(-4, -12, 4, 9, 0, 0, Math.PI * 2);
    x.fill();
    x.restore();
  }
}

function scarf(x: Ctx, w: Wear, layer: Layer) {
  const red = "#E0703A";
  const stripe = "#FFE3C2";
  if (layer === "back") return;
  x.save();
  x.translate(0, 66);
  // The band across him.
  x.fillStyle = red;
  x.beginPath();
  x.moveTo(-104, -14);
  x.quadraticCurveTo(0, 6, 104, -14);
  x.lineTo(104, 12);
  x.quadraticCurveTo(0, 32, -104, 12);
  x.closePath();
  x.fill();
  x.strokeStyle = stripe;
  x.lineWidth = 4;
  for (const dy of [-4, 6]) {
    x.beginPath();
    x.moveTo(-104, dy);
    x.quadraticCurveTo(0, dy + 20, 104, dy);
    x.stroke();
  }
  // The end that hangs and swings.
  x.save();
  x.translate(46, 14);
  x.rotate(0.12 + w.sway * 0.3 + Math.sin(w.t * 2) * 0.04);
  x.fillStyle = shade(red, -0.08);
  x.beginPath();
  x.roundRect(-14, 0, 28, 58, 6);
  x.fill();
  x.strokeStyle = stripe;
  x.lineWidth = 4;
  for (const sy of [16, 30]) {
    x.beginPath();
    x.moveTo(-14, sy);
    x.lineTo(14, sy);
    x.stroke();
  }
  x.strokeStyle = shade(red, -0.2);
  x.lineWidth = 3;
  for (let fx = -10; fx <= 10; fx += 5) {
    x.beginPath();
    x.moveTo(fx, 58);
    x.lineTo(fx, 66);
    x.stroke();
  }
  x.restore();
  x.restore();
}

// ── Glasses (on his face) ─────────────────────────────────────────────────────

function sunglasses(x: Ctx, w: Wear) {
  x.save();
  x.translate(w.fx ?? 0, 14 + (w.fy ?? 0));
  for (const s of [-1, 1]) {
    const g = x.createLinearGradient(0, -20, 0, 18);
    g.addColorStop(0, "#2A2F45");
    g.addColorStop(1, "#11131C");
    x.fillStyle = g;
    x.beginPath();
    x.roundRect(s * 46 - 27, -18, 54, 36, [12, 12, 18, 18]);
    x.fill();
    x.fillStyle = "rgba(255,255,255,.22)";
    x.beginPath();
    x.moveTo(s * 46 - 18, -12);
    x.lineTo(s * 46 - 6, -12);
    x.lineTo(s * 46 - 16, 6);
    x.lineTo(s * 46 - 24, 6);
    x.closePath();
    x.fill();
  }
  x.strokeStyle = "#11131C";
  x.lineWidth = 5;
  x.beginPath();
  x.moveTo(-19, -8);
  x.quadraticCurveTo(0, -14, 19, -8);
  x.moveTo(-73, -10);
  x.lineTo(-96, -16);
  x.moveTo(73, -10);
  x.lineTo(96, -16);
  x.stroke();
  x.restore();
}

function roundGlasses(x: Ctx, w: Wear) {
  x.save();
  x.translate(w.fx ?? 0, 14 + (w.fy ?? 0));
  x.strokeStyle = "#B7791F";
  x.lineWidth = 4;
  for (const s of [-1, 1]) {
    x.fillStyle = "rgba(200,230,255,.18)";
    x.beginPath();
    x.arc(s * 46, 0, 23, 0, Math.PI * 2);
    x.fill();
    x.stroke();
    x.strokeStyle = "rgba(255,255,255,.55)";
    x.lineWidth = 2.5;
    x.beginPath();
    x.arc(s * 46, 0, 16, Math.PI * 1.1, Math.PI * 1.45);
    x.stroke();
    x.strokeStyle = "#B7791F";
    x.lineWidth = 4;
  }
  x.beginPath();
  x.moveTo(-23, -2);
  x.quadraticCurveTo(0, -12, 23, -2);
  x.moveTo(-69, -4);
  x.lineTo(-94, -10);
  x.moveTo(69, -4);
  x.lineTo(94, -10);
  x.stroke();
  x.restore();
}

// ── Entry point ───────────────────────────────────────────────────────────────

const FACE_WORN: ReadonlySet<Outfit> = new Set<Outfit>(["sunglasses", "roundGlasses"]);
const HAS_BACK: ReadonlySet<Outfit> = new Set<Outfit>(["headphones"]);

/** Draws one layer of `outfit` on a Tokkip of `w.look`, in studio units. */
export function drawOutfit(x: Ctx, outfit: Outfit, layer: Layer, w: Wear) {
  if (outfit === "none" || w.k <= 0.01) return;
  if (layer === "back" && !HAS_BACK.has(outfit)) return;
  const top = headTop(w.look.species);
  x.save();
  const k = Math.min(1, w.k);
  if (FACE_WORN.has(outfit)) {
    x.globalAlpha *= k;
  } else {
    // Dropped on from above, settling with a little squash.
    x.translate(0, -(1 - k) * 90);
    x.globalAlpha *= Math.min(1, k * 1.6);
  }
  switch (outfit) {
    case "partyHat": partyHat(x, w, top); break;
    case "crown": crown(x, w, top); break;
    case "beanie": beanie(x, w, top); break;
    case "strawHat": strawHat(x, w, top); break;
    case "witchHat": witchHat(x, w, top); break;
    case "santaHat": santaHat(x, w, top); break;
    case "antlers": antlers(x, w, top); break;
    case "hearts": hearts(x, w, top); break;
    case "flowerCrown": flowerCrown(x, w, top); break;
    case "marigolds": marigolds(x, w, top); break;
    case "tricolor": tricolor(x, w, top); break;
    case "bow": bow(x, w, top); break;
    case "headphones": headphones(x, w, top, layer); break;
    case "scarf": scarf(x, w, layer); break;
    case "sunglasses": sunglasses(x, w); break;
    case "roundGlasses": roundGlasses(x, w); break;
  }
  x.restore();
}

// ── The wardrobe's buttons ────────────────────────────────────────────────────

/** A little Tokkip head wearing `outfit`, filling a `size` square. */
function iconHead(ctx: Ctx, size: number, look: TokkipLook, outfit: Outfit) {
  const u = size / 290;
  ctx.save();
  ctx.translate(size / 2, size * 0.72);
  ctx.scale(u, u);
  ctx.fillStyle = look.body;
  ctx.beginPath();
  ctx.roundRect(-100, -90, 200, 210, 70);
  ctx.fill();
  ctx.fillStyle = shade(look.accent, -0.12);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * 44, 8, 11, 13, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const w: Wear = { look: { ...look, species: "robot" }, t: 0, k: 1, sway: 0, fx: 0, fy: 0 };
  drawOutfit(ctx, outfit, "back", w);
  drawOutfit(ctx, outfit, "front", w);
  ctx.restore();
}

const ICON_LOOK: TokkipLook = { species: "robot", skin: "lisa", body: "#F7EAD3", accent: "#3F9E9A", ink: "", cheek: "" };

/**
 * One wardrobe button's picture: "none" is a crossed-out circle, "auto" the
 * season's outfit with a small AUTO tag, anything else that outfit.
 */
export function drawWardrobeIcon(ctx: Ctx, size: number, selection: OutfitSelection, seasonal: Outfit, autoLabel: string) {
  ctx.clearRect(0, 0, size, size);
  if (selection === "none") {
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.strokeStyle = "#5A5E68";
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.2, 0, Math.PI * 2);
    ctx.moveTo(-size * 0.14, size * 0.14);
    ctx.lineTo(size * 0.14, -size * 0.14);
    ctx.stroke();
    ctx.restore();
    return;
  }
  iconHead(ctx, size, ICON_LOOK, selection === "auto" ? seasonal : selection);
  if (selection !== "auto") return;
  const bw = size * 0.56;
  const bh = size * 0.24;
  ctx.save();
  ctx.translate(size / 2, size - bh / 2 - 1);
  ctx.fillStyle = "rgba(20,21,24,.75)";
  ctx.beginPath();
  ctx.roundRect(-bw / 2, -bh / 2, bw, bh, bh / 2);
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  let px = size * 0.17;
  const font = () => `700 ${px}px system-ui, "Segoe UI", ${SCRIPT_FONTS}, sans-serif`;
  ctx.font = font();
  while (ctx.measureText(autoLabel).width > bw - 3 && px > size * 0.1) {
    px -= 0.25;
    ctx.font = font();
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(autoLabel, 0, 0.3);
  ctx.restore();
}
