// Squarified treemap (Bruls, Huizing, van Wijk): rectangles whose areas match
// the values and whose shapes stay close to squares, so sizes read at a glance.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Lays out `values` (biggest first works best) in `box`. Zero values get no room. */
export function squarify(values: number[], box: Rect): Rect[] {
  const out: Rect[] = values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (total <= 0 || box.w <= 0 || box.h <= 0) return out;
  const scale = (box.w * box.h) / total;
  const items = values.map((v, i) => ({ i, a: Math.max(0, v) * scale })).filter((it) => it.a > 0);
  let { x, y, w, h } = box;

  const worst = (row: number[], side: number) => {
    const s = row.reduce((a, b) => a + b, 0);
    const max = Math.max(...row);
    const min = Math.min(...row);
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };

  let row: typeof items = [];
  const place = () => {
    const s = row.reduce((a, it) => a + it.a, 0);
    if (w >= h) {
      // A column on the left.
      const cw = s / h;
      let cy = y;
      for (const it of row) {
        const ch = it.a / cw;
        out[it.i] = { x, y: cy, w: cw, h: ch };
        cy += ch;
      }
      x += cw;
      w -= cw;
    } else {
      // A row on top.
      const rh = s / w;
      let cx = x;
      for (const it of row) {
        const cw = it.a / rh;
        out[it.i] = { x: cx, y, w: cw, h: rh };
        cx += cw;
      }
      y += rh;
      h -= rh;
    }
    row = [];
  };

  for (const it of items) {
    const side = Math.min(w, h);
    if (row.length === 0 || worst([...row.map((r) => r.a), it.a], side) <= worst(row.map((r) => r.a), side)) {
      row.push(it);
    } else {
      place();
      row.push(it);
    }
  }
  if (row.length) place();
  return out;
}
