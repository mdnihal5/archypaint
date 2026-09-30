import { describe, expect, it } from "vitest";
import { fitMini, toMiniX, toMiniY, toWorldX, toWorldY } from "./minimap-model";

describe("minimap mapping", () => {
  const scene = { x: -500, y: -200, w: 3000, h: 1000 };
  const view = { x: 0, y: 0, w: 1440, h: 900 };
  it("world -> mini -> world is the identity", () => {
    const m = fitMini(scene, view, 200, 136);
    for (const [x, y] of [[-500, -200], [0, 0], [2500, 800], [1234.5, 321.25]] as const) {
      expect(toWorldX(m, toMiniX(m, x))).toBeCloseTo(x, 6);
      expect(toWorldY(m, toMiniY(m, y))).toBeCloseTo(y, 6);
    }
  });
  it("everything lands inside the canvas with the padding, scene and viewport included", () => {
    const m = fitMini(scene, view, 200, 136, 8);
    for (const [x, y] of [[-500, -200], [2500, 800], [0, 0], [1440, 900]] as const) {
      const px = toMiniX(m, x), py = toMiniY(m, y);
      expect(px).toBeGreaterThanOrEqual(8 - 1e-6); expect(px).toBeLessThanOrEqual(192 + 1e-6);
      expect(py).toBeGreaterThanOrEqual(8 - 1e-6); expect(py).toBeLessThanOrEqual(128 + 1e-6);
    }
  });
  it("the viewport is always visible even when it is far outside the scene", () => {
    const m = fitMini({ x: 0, y: 0, w: 100, h: 100 }, { x: 50000, y: 40000, w: 1000, h: 800 }, 200, 136);
    const px = toMiniX(m, 50000), py = toMiniY(m, 40000);
    expect(px).toBeLessThanOrEqual(200); expect(py).toBeLessThanOrEqual(136);
  });
  it("an empty scene falls back to the viewport alone; clicking the centre maps to the viewport centre", () => {
    const m = fitMini(null, view, 200, 136);
    expect(toWorldX(m, 100)).toBeCloseTo(720, 5); expect(toWorldY(m, 68)).toBeCloseTo(450, 5);
    expect(Number.isFinite(fitMini(null, { x: 0, y: 0, w: 0, h: 0 }, 200, 136).scale)).toBe(true);
  });
});
