import { describe, expect, it } from "vitest";
import { CONTAINER_KINDS, FRAME_HEADER, LANE_HEADER, PATH_KINDS, hitShape, laneCells, laneNames, legendRows, outlinePort, paraSkew, pointInPoly, polygonOf, rayPoly, shapeParts, type GeomEl } from "./shape-geom";

const g = (kind: string, p: Partial<GeomEl> = {}): GeomEl => ({ kind, x: 100, y: 200, w: 120, h: 100, edge: 1, radius: 8, o: 0, n: 3, text: "", ...p });
const inside = (e: GeomEl, fx: number, fy: number, slop = 0) => hitShape(e, e.x + e.w * fx, e.y + e.h * fy, slop);

describe("hit testing per shape", () => {
  it("triangle: apex column and base are inside, the empty top corners are not", () => {
    const e = g("triangle");
    expect(inside(e, 0.5, 0.5)).toBe(true);
    expect(inside(e, 0.5, 0.95)).toBe(true);
    expect(inside(e, 0.05, 0.05)).toBe(false);
    expect(inside(e, 0.95, 0.05)).toBe(false);
  });
  it("hexagon: centre inside, cut corners outside", () => {
    const e = g("hexagon");
    expect(inside(e, 0.5, 0.5)).toBe(true);
    expect(inside(e, 0.03, 0.05)).toBe(false);
    expect(inside(e, 0.97, 0.95)).toBe(false);
    expect(inside(e, 0.02, 0.5)).toBe(true);
  });
  it("parallelogram: leans — top-left and bottom-right corners are empty", () => {
    const e = g("parallelogram");
    expect(inside(e, 0.5, 0.5)).toBe(true);
    expect(inside(e, 0.02, 0.05)).toBe(false);
    expect(inside(e, 0.98, 0.95)).toBe(false);
    expect(inside(e, 0.9, 0.05)).toBe(true);
  });
  it("star and cloud: centre inside, bbox corners outside", () => {
    for (const k of ["star", "cloud"]) {
      const e = g(k);
      expect(inside(e, 0.5, 0.5), k).toBe(true);
      expect(inside(e, 0.01, 0.01), k).toBe(false);
      expect(inside(e, 0.99, 0.99), k).toBe(false);
    }
  });
  it("badge is a circle", () => {
    const e = g("badge", { w: 40, h: 40 });
    expect(inside(e, 0.5, 0.5)).toBe(true);
    expect(inside(e, 0.02, 0.02)).toBe(false);
    expect(hitShape(e, e.x + 41, e.y + 20, 4)).toBe(true); // slop widens it
  });
  it("cylinder, note, brace and legend hit anywhere in their box", () => {
    for (const k of ["cylinder", "note", "brace", "legend"]) expect(inside(g(k), 0.5, 0.5), k).toBe(true);
  });
  it("containers answer only on the header or the border: they never steal clicks from their contents", () => {
    const f = g("frame", { w: 400, h: 300 });
    expect(hitShape(f, f.x + 200, f.y + FRAME_HEADER - 4, 0)).toBe(true); // title band
    expect(hitShape(f, f.x + 200, f.y + 150, 0)).toBe(false); // empty interior
    expect(hitShape(f, f.x + 2, f.y + 150, 0)).toBe(true); // border
    const rows = g("lane", { w: 400, h: 300, o: 0 }), cols = g("lane", { w: 400, h: 300, o: 1 });
    expect(hitShape(rows, rows.x + LANE_HEADER - 4, rows.y + 150, 0)).toBe(true);
    expect(hitShape(rows, rows.x + 200, rows.y + 150, 0)).toBe(false);
    expect(hitShape(cols, cols.x + 200, cols.y + 10, 0)).toBe(true);
    expect(hitShape(cols, cols.x + 200, cols.y + 150, 0)).toBe(false);
    expect([...CONTAINER_KINDS].sort()).toEqual(["frame", "lane"]);
  });
  it("misses outside the box entirely", () => {
    for (const k of PATH_KINDS) expect(hitShape(g(k), 5, 5, 0), k).toBe(false);
  });
});

describe("polygons", () => {
  it("every polygon fills its bounding box exactly (touches all four sides, never leaves it)", () => {
    for (const k of ["hexagon", "triangle", "star", "cloud", "parallelogram"]) {
      const p = polygonOf(k, 10, 20, 200, 100)!;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]!); x1 = Math.max(x1, p[i]!); y0 = Math.min(y0, p[i + 1]!); y1 = Math.max(y1, p[i + 1]!); }
      expect([x0, y0, x1, y1].map((v) => Math.round(v * 1000) / 1000), k).toEqual([10, 20, 210, 120]);
    }
  });
  it("non-polygon kinds return null; pointInPoly / rayPoly agree", () => {
    expect(polygonOf("rect", 0, 0, 10, 10)).toBeNull();
    const sq = [0, 0, 10, 0, 10, 10, 0, 10];
    expect(pointInPoly(sq, 5, 5)).toBe(true);
    expect(pointInPoly(sq, 15, 5)).toBe(false);
    expect(rayPoly(sq, 5, 5, 1, 0)).toEqual([10, 5]);
    expect(rayPoly(sq, 5, 5, 0, -1)).toEqual([5, 0]);
    expect(rayPoly(sq, 50, 50, 1, 0)).toBeNull();
  });
});

describe("connector ports sit on the real outline", () => {
  it("triangle: left/right ports are inset to the slanted edges, top is the apex", () => {
    const r = { x: 0, y: 0, w: 100, h: 100, kind: "triangle" };
    const [tx, ty] = outlinePort(r, 0)!, [lx, ly] = outlinePort(r, 3)!, [rx] = outlinePort(r, 1)!, [, by] = outlinePort(r, 2)!;
    expect([tx, ty]).toEqual([50, 0]);
    expect(lx).toBeCloseTo(25, 5); expect(ly).toBeCloseTo(50, 5); expect(rx).toBeCloseTo(75, 5); expect(by).toBeCloseTo(100, 5);
  });
  it("parallelogram: side ports are inset by half the slant", () => {
    const r = { x: 0, y: 0, w: 100, h: 60, kind: "parallelogram" };
    const s = paraSkew(100);
    expect(outlinePort(r, 3)![0]).toBeCloseTo(s / 2, 5);
    expect(outlinePort(r, 1)![0]).toBeCloseTo(100 - s / 2, 5);
  });
  it("star: the top port is the upper tip; every port is on the polygon boundary", () => {
    const r = { x: 0, y: 0, w: 100, h: 100, kind: "star" };
    expect(outlinePort(r, 0)![1]).toBeCloseTo(0, 5);
    const poly = polygonOf("star", 0, 0, 100, 100)!;
    for (let s = 0; s < 4; s++) { const p = outlinePort(r, s)!; expect(rayPoly(poly, p[0], p[1], 0, 0)).toBeNull(); expect(p[0]).toBeGreaterThanOrEqual(0); expect(p[0]).toBeLessThanOrEqual(100); }
  });
  it("kinds whose outline touches the box midpoints defer to the plain port", () => {
    for (const k of ["rect", "ellipse", "diamond", "hexagon", "cylinder", "note", "badge"]) expect(outlinePort({ x: 0, y: 0, w: 10, h: 10, kind: k }, 1), k).toBeNull();
  });
});

describe("path data", () => {
  const num = /^[MLHVCQAZ0-9\s.\-e]+$/;
  it("every path shape yields a finite, well-formed body", () => {
    for (const k of PATH_KINDS) {
      for (const o of [0, 1, 2, 3] as const) {
        const p = shapeParts(g(k, { o, n: 4, text: "a\nb\nc" }))!;
        expect(p, k).not.toBeNull();
        expect(p.body.length, k).toBeGreaterThan(10);
        expect(p.body, k).toMatch(num); expect(p.body, k).not.toMatch(/NaN|Infinity|undefined/);
        expect(p.detail, k).not.toMatch(/NaN|Infinity|undefined/);
      }
    }
  });
  it("brace is an open stroke in all four directions", () => {
    for (const o of [0, 1, 2, 3] as const) expect(shapeParts(g("brace", { o, w: o < 2 ? 28 : 120, h: o < 2 ? 100 : 28 }))!.open).toBe(true);
    expect(shapeParts(g("rect"))).toBeNull();
  });
  it("cylinder and note carry stroke-only detail (lid rim, fold); lane carries its dividers", () => {
    expect(shapeParts(g("cylinder"))!.detail).toMatch(/^M/);
    expect(shapeParts(g("note"))!.detail).toMatch(/^M/);
    expect(shapeParts(g("lane", { text: "a\nb\nc", o: 0 }))!.detail.match(/M/g)!.length).toBe(3); // header rule + 2 dividers
    expect(shapeParts(g("lane", { text: "a\nb", o: 1 }))!.detail.match(/M/g)!.length).toBe(2);
  });
});

describe("lanes and legend text", () => {
  it("names come from the lines of text, padded to n, capped at 24", () => {
    expect(laneNames({ text: "a\nb", n: 2 })).toEqual(["a", "b"]);
    expect(laneNames({ text: "", n: 3 })).toEqual(["lane 1", "lane 2", "lane 3"]);
    expect(laneNames({ text: Array.from({ length: 40 }, (_, i) => `l${i}`).join("\n"), n: 40 }).length).toBe(24);
  });
  it("header cells: row lanes rotate their names; column lanes do not", () => {
    const rows = laneCells(g("lane", { text: "a\nb", o: 0, w: 400, h: 200 }));
    expect(rows).toHaveLength(2); expect(rows[0]!.rot).toBe(true);
    expect(rows[1]!.cy).toBeCloseTo(200 + 150, 5);
    const cols = laneCells(g("lane", { text: "a\nb", o: 1, w: 400, h: 200 }));
    expect(cols[0]!.rot).toBe(false); expect(cols[1]!.cx).toBeCloseTo(100 + 300, 5);
  });
  it("legend rows parse swatch|label and ignore junk", () => {
    expect(legendRows("c0|data\nsolid|sync\njunk\n|x")).toEqual([{ swatch: "c0", label: "data" }, { swatch: "solid", label: "sync" }]);
  });
});
