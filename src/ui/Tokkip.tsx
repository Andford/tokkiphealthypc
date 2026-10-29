// Tokkip, alive in a <canvas>: Tokkip PC's own motion engine (src/tokkip/).
// His eyes follow the pointer, a poke makes him jump (three, and he gets
// dizzy), and the page sets what he is doing with `state`.

import { useEffect, useRef } from "preact/hooks";
import { TokkipMotion } from "../tokkip/motion";
import { loadLook, onLookChange } from "../tokkip/tokkip";
import type { BotStateName } from "../core/layout";
import { seasonalOutfit } from "../tokkip/wardrobe";
import { STATE_SHAPES, shapePath, type ShapeSpec } from "../tokkip/shapes";

const ASPECT = 190 / 150;
const OVERHANG = 40 / 150;
const REDUCED = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Props {
  size: number;
  state: BotStateName;
  dancing?: boolean;
  /** Called once with the engine, for one-off moments (greet, emotes). */
  onReady?: (e: TokkipMotion) => void;
  label: string;
  /** The Material Expressive shape behind him (as on the island): it melts into
   * another with what he's doing and spins while he works. On by default. */
  shape?: boolean;
}

export function Tokkip({ size, state, dancing = false, onReady, label, shape = true }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const backdrop = useRef<SVGPathElement>(null);
  const engine = useRef<TokkipMotion | null>(null);

  useEffect(() => {
    const c = canvas.current!;
    const e = new TokkipMotion();
    e.look = loadLook();
    e.setState(state, true);
    e.setOutfit(seasonalOutfit(new Date()), false);
    engine.current = e;
    onLookChange((look) => (e.look = look));
    let dizzyTimer = 0;
    e.onDizzy = () => {
      e.setState("dizzy", true);
      window.clearTimeout(dizzyTimer);
      dizzyTimer = window.setTimeout(() => e.setState(stateRef.current, true), 2600);
    };
    onReady?.(e);

    const pointer = { x: 0, y: 0, seen: false };
    const move = (ev: PointerEvent) => Object.assign(pointer, { x: ev.clientX, y: ev.clientY, seen: true });
    window.addEventListener("pointermove", move);

    let last = performance.now();
    let raf = 0;
    // The shape behind: melting from one state's shape to the next, turning as it goes.
    let from: ShapeSpec = STATE_SHAPES[stateRef.current] ?? STATE_SHAPES.idle;
    let to = from;
    let k = 1;
    let turn = 0;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const target = STATE_SHAPES[stateRef.current] ?? STATE_SHAPES.idle;
      if (target !== to) {
        from = k >= 1 ? to : from;
        to = target;
        k = 0;
      }
      k = Math.min(1, k + dt * 2.2);
      turn += (REDUCED ? 0 : to.spin * k + from.spin * (1 - k)) * dt;
      backdrop.current?.setAttribute("d", shapePath(50, from, to, 1 - Math.pow(1 - k, 3), turn));
      const w = c.clientWidth;
      const h = w * ASPECT;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (c.width !== Math.round(w * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      e.particleOverhang = OVERHANG * w;
      if (pointer.seen) {
        const r = c.getBoundingClientRect();
        e.lookX = Math.tanh((pointer.x - (r.left + r.width / 2)) / 260);
        e.lookY = -Math.tanh((pointer.y - (r.top + r.height * 0.55)) / 200);
      }
      e.update(REDUCED ? dt * 0.5 : dt);
      const x = c.getContext("2d");
      if (x) {
        x.setTransform(dpr, 0, 0, dpr, 0, 0);
        x.clearRect(0, 0, w, h);
        x.save();
        e.applyDance(x, w, h);
        e.draw(x, w, h);
        x.restore();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.clearTimeout(dizzyTimer);
    };
  }, []);

  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => engine.current?.setState(state), [state]);
  useEffect(() => engine.current?.setDancing(dancing), [dancing]);

  const poke = () => engine.current?.slap();
  return (
    <span class="tokkip-wrap" style={{ width: `${size}px`, height: `${size * ASPECT}px` }}>
      {shape && (
        <svg class="tokkip-shape" viewBox="0 0 100 100" aria-hidden="true">
          <path ref={backdrop} />
        </svg>
      )}
    <canvas
      ref={canvas}
      class="tokkip"
      style={{ width: `${size}px`, height: `${size * ASPECT}px` }}
      role="img"
      aria-label={label}
      tabIndex={0}
      onClick={poke}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          poke();
        }
      }}
    />
    </span>
  );
}
