// Copied from Andford/tokkip (windows/src) by scripts/sync-tokkip.mjs — change it there.
// The shape behind Tokkip in the island: a soft Material Expressive shape that
// changes with what he's doing (a round cookie when he rests, a four-leaf
// clover spinning while he works, a sunburst when something needs you…) and
// melts from one into the next.

import type { BotStateName } from "../core/layout";

export interface ShapeSpec {
  /** Bumps around the edge (0 = a circle). */
  lobes: number;
  /** How deep they are, as a share of the radius. */
  depth: number;
  /** Turning speed, degrees a second. */
  spin: number;
}

export const STATE_SHAPES: Record<BotStateName, ShapeSpec> = {
  idle: { lobes: 9, depth: 0.05, spin: 0 },
  working: { lobes: 4, depth: 0.11, spin: 24 },
  thinking: { lobes: 6, depth: 0.09, spin: 10 },
  searching: { lobes: 8, depth: 0.08, spin: 40 },
  approval: { lobes: 12, depth: 0.08, spin: 14 },
  question: { lobes: 5, depth: 0.1, spin: 6 },
  error: { lobes: 3, depth: 0.1, spin: 0 },
  finished: { lobes: 10, depth: 0.09, spin: 30 },
  ratelimit: { lobes: 7, depth: 0.06, spin: 4 },
  sleeping: { lobes: 0, depth: 0, spin: 0 },
  dizzy: { lobes: 5, depth: 0.12, spin: 160 },
};

/**
 * The outline of a shape of radius `r` centred on (r, r), between `a` and `b`
 * (`k` = 0 … 1), turned by `turn` degrees, as SVG path data.
 */
export function shapePath(r: number, a: ShapeSpec, b: ShapeSpec, k: number, turn: number): string {
  const steps = 96;
  const rot = (turn * Math.PI) / 180;
  const depth = a.depth * (1 - k) + b.depth * k;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const fa = a.lobes ? a.depth * Math.cos(a.lobes * (t - rot)) : 0;
    const fb = b.lobes ? b.depth * Math.cos(b.lobes * (t - rot)) : 0;
    const rr = (r * (1 + fa * (1 - k) + fb * k)) / (1 + depth);
    const x = r + Math.cos(t) * rr;
    const y = r + Math.sin(t) * rr;
    d += `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d + "Z";
}
