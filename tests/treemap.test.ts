import { describe, expect, it } from "vitest";
import { squarify } from "../src/pages/storage/treemap";

describe("treemap", () => {
  it("gives each value its share of the box, inside it", () => {
    const values = [60, 25, 10, 5];
    const rects = squarify(values, { x: 0, y: 0, w: 200, h: 100 });
    const total = 200 * 100;
    rects.forEach((r, i) => {
      expect(r.w * r.h).toBeCloseTo((values[i] / 100) * total, 5);
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(200 + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(100 + 1e-9);
    });
  });

  it("keeps shapes reasonable", () => {
    const rects = squarify([10, 10, 10, 10], { x: 0, y: 0, w: 100, h: 100 });
    for (const r of rects) expect(Math.max(r.w / r.h, r.h / r.w)).toBeLessThanOrEqual(1.01);
  });

  it("skips zeros and empty boxes", () => {
    const rects = squarify([5, 0], { x: 0, y: 0, w: 10, h: 10 });
    expect(rects[1].w * rects[1].h).toBe(0);
    expect(squarify([1], { x: 0, y: 0, w: 0, h: 10 })[0].w).toBe(0);
  });
});
