import { describe, expect, it } from "vitest";
import { anchorsOf, arrowDist, bboxOfPts, computeArrowPts, effectiveRoute, nearestSide, portPoint, rerouteBound, routeArrow, sceneRectOf, type Anchor } from "./connectors";
import { Scene } from "./scene";

const A = (x: number, y: number, w: number, h: number, port: -1 | 0 | 1 | 2 | 3 = -1): Anchor => ({ rect: { x, y, w, h }, pt: [x + w / 2, y + h / 2], port });

function orthogonal(pts: number[]): boolean {
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const dx = Math.abs(pts[i + 2]! - pts[i]!), dy = Math.abs(pts[i + 3]! - pts[i + 1]!);
    if (dx > 0.01 && dy > 0.01) return false;
  }
  return true;
}
function crosses(pts: number[], r: { x: number; y: number; w: number; h: number }): boolean {
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const x0 = Math.min(pts[i]!, pts[i + 2]!), x1 = Math.max(pts[i]!, pts[i + 2]!), y0 = Math.min(pts[i + 1]!, pts[i + 3]!), y1 = Math.max(pts[i + 1]!, pts[i + 3]!);
    if (x1 > r.x + 1 && x0 < r.x + r.w - 1 && y1 > r.y + 1 && y0 < r.y + r.h - 1) return true;
  }
  return false;
}

describe("routing", () => {
  it("ports and nearest side", () => {
    const r = { x: 0, y: 0, w: 100, h: 50 };
    expect(portPoint(r, 1)).toEqual([100, 25]);
    expect(nearestSide(r, 300, 25)).toBe(1);
    expect(nearestSide(r, -300, 25)).toBe(3);
    expect(nearestSide(r, 50, 400)).toBe(2);
  });
  it("elbow between side-by-side boxes is orthogonal and avoids both boxes", () => {
    const a = A(0, 0, 100, 60), b = A(300, 100, 100, 60);
    const pts = routeArrow(a, b, 1);
    expect(orthogonal(pts)).toBe(true);
    expect(crosses(pts, a.rect!)).toBe(false);
    expect(crosses(pts, b.rect!)).toBe(false);
    expect(pts[0]).toBe(100); expect(pts[pts.length - 2]).toBe(300);
  });
  it("routes around when the target is behind the source", () => {
    const a = A(300, 0, 100, 60, 1), b = A(0, 0, 100, 60, 3); // out of a's right, into b's left, b is to the LEFT
    const pts = routeArrow(a, b, 1);
    expect(orthogonal(pts)).toBe(true);
    expect(crosses(pts, a.rect!)).toBe(false);
    expect(crosses(pts, b.rect!)).toBe(false);
  });
  it("vertical stacks and mixed sides are orthogonal", () => {
    expect(orthogonal(routeArrow(A(0, 0, 80, 40), A(0, 200, 80, 40), 1))).toBe(true);
    expect(orthogonal(routeArrow(A(0, 0, 80, 40, 1), A(300, 200, 80, 40, 0), 1))).toBe(true);
  });
  it("straight and curve shapes", () => {
    expect(routeArrow(A(0, 0, 10, 10), A(100, 0, 10, 10), 0).length).toBe(4);
    expect(routeArrow(A(0, 0, 10, 10), A(100, 0, 10, 10), 2).length).toBe(8);
  });
  it("degenerate input terminates with finite numbers (overlap, zero size, identical, huge)", () => {
    const cases: [Anchor, Anchor][] = [
      [A(0, 0, 100, 100), A(0, 0, 100, 100)],
      [A(0, 0, 100, 100), A(50, 50, 100, 100)],
      [A(0, 0, 0, 0), A(0, 0, 0, 0)],
      [A(0, 0, 1, 1), A(1e9, -1e9, 1, 1)],
      [{ rect: null, pt: [5, 5], port: -1 }, { rect: null, pt: [5, 5], port: -1 }],
    ];
    for (const [a, b] of cases) for (const route of [0, 1, 2] as const) {
      const t0 = performance.now();
      const pts = routeArrow(a, b, route);
      expect(performance.now() - t0).toBeLessThan(50);
      expect(pts.length).toBeGreaterThanOrEqual(4);
      expect(pts.every(Number.isFinite)).toBe(true);
    }
  });
  it("free ends: elbow between two loose points", () => {
    const pts = routeArrow({ rect: null, pt: [0, 0], port: -1 }, { rect: null, pt: [200, 100], port: -1 }, 1);
    expect(orthogonal(pts)).toBe(true);
    expect(pts.slice(0, 2)).toEqual([0, 0]);
    expect(pts.slice(-2)).toEqual([200, 100]);
  });
  it("soft edge turns an elbow into a curve, other combinations are unchanged", () => {
    expect(effectiveRoute(1, 2)).toBe(2);
    expect(effectiveRoute(1, 1)).toBe(1);
    expect(effectiveRoute(0, 2)).toBe(0);
  });
  it("bbox and distance", () => {
    expect(bboxOfPts([0, 0, 10, 20])).toEqual({ x: 0, y: 0, w: 10, h: 20 });
    const s = new Scene();
    const e = s.add({ kind: "arrow", pts: [0, 0, 100, 0], route: 0, x: 0, y: 0, w: 100, h: 1 });
    expect(arrowDist(e, 50, 3)).toBeCloseTo(3);
    expect(s.hit(50, 3, 4)?.id).toBe(e.id);
    expect(s.hit(50, 40, 4)).toBeNull();
  });
});

describe("batched reroute", () => {
  it("only arrows bound to moved ids are recomputed, in one pass", () => {
    const s = new Scene();
    const a = s.add({ kind: "rect", x: 0, y: 0, w: 100, h: 60 }), b = s.add({ kind: "rect", x: 300, y: 0, w: 100, h: 60 }), c = s.add({ kind: "rect", x: 0, y: 300, w: 100, h: 60 });
    const ar = s.add({ kind: "arrow", src: a.id, dst: b.id, pts: [0, 0, 1, 1], route: 1 });
    const other = s.add({ kind: "arrow", src: c.id, dst: "", pts: [0, 0, 5, 5], route: 0 });
    const out = rerouteBound(s, new Set([a.id]));
    expect(out.map((r) => r.id)).toEqual([ar.id]);
    expect(out[0]!.pts.slice(0, 2)).toEqual([100, 30]);
    expect(rerouteBound(s, new Set([c.id])).map((r) => r.id)).toEqual([other.id]);
    const [sa, da] = anchorsOf(ar, sceneRectOf(s));
    expect(sa.rect?.x).toBe(0); expect(da.rect?.x).toBe(300);
    expect(computeArrowPts(ar, sceneRectOf(s)).length).toBeGreaterThanOrEqual(4);
  });
});
