import { describe, expect, it } from "vitest";
import { listPorts, portInto, portPoint, routeArrow, sideDivs, type Rect } from "./connectors";
import { polygonOf } from "./shape-geom";
import { parseArch, serializeArch } from "./io/format";
import { fromExcalidraw, toExcalidraw } from "./io/excalidraw";
import { Scene, extraPort, isPort } from "./scene";

const R = (kind?: string, radius?: number): Rect => ({ x: 100, y: 200, w: 160, h: 80, ...(kind ? { kind } : {}), ...(radius ? { radius } : {}) });
const distToPoly = (poly: number[], px: number, py: number): number => {
  let best = Infinity;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const ax = poly[j]!, ay = poly[j + 1]!, bx = poly[i]!, by = poly[i + 1]!, ex = bx - ax, ey = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey)));
    best = Math.min(best, Math.hypot(px - (ax + t * ex), py - (ay + t * ey)));
  }
  return best;
};

const Q = (side: number, j: number) => extraPort(side, j);
describe("size-scaled connection ports", () => {
  it("the number of points follows the side length, always keeping corners and midpoints", () => {
    expect(sideDivs(96, 1)).toBe(2); // a small icon keeps today's count
    expect(sideDivs(160, 1)).toBe(4); expect(sideDivs(240, 1)).toBe(4); expect(sideDivs(256, 1)).toBe(8); expect(sideDivs(2000, 1)).toBe(16);
    const icon = listPorts({ x: 0, y: 0, w: 96, h: 114 }, 1, []), big = listPorts({ x: 0, y: 0, w: 400, h: 200 }, 1, []);
    expect(icon).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(big.length).toBeGreaterThan(16);
    for (let i = 0; i < 8; i++) expect(big).toContain(i);
    expect(new Set(big).size).toBe(big.length);
    for (const p of big) expect(isPort(p)).toBe(true);
  });
  it("fewer dots at low zoom", () => {
    const r = { x: 0, y: 0, w: 400, h: 200 };
    expect(listPorts(r, 1, []).length).toBeGreaterThan(listPorts(r, 0.2, []).length);
    expect(listPorts(r, 0.05, [])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it("0-7 keep their meaning; an extra port is a (side, fraction) on the box", () => {
    const r = R();
    expect(portPoint(r, 0)).toEqual([180, 200]); expect(portPoint(r, 1)).toEqual([260, 240]);
    expect(portPoint(r, Q(0, 16))).toEqual([140, 200]); expect(portPoint(r, Q(0, 48))).toEqual([220, 200]);
    expect(portPoint(r, Q(1, 16))).toEqual([260, 220]); expect(portPoint(r, Q(1, 48))).toEqual([260, 260]);
    expect(portPoint(r, Q(2, 16))).toEqual([140, 280]); expect(portPoint(r, Q(3, 48))).toEqual([100, 260]);
  });
  it("an extra port keeps its relative spot when the shape is resized", () => {
    const small = portPoint({ x: 0, y: 0, w: 160, h: 80 }, Q(0, 16)), big = portPoint({ x: 0, y: 0, w: 320, h: 160 }, Q(0, 16));
    expect(small[0] / 160).toBeCloseTo(big[0] / 320, 9);
  });
  it("isPort accepts old values and valid packed ones, rejects junk", () => {
    for (const v of [-1, 0, 7, Q(0, 1), Q(3, 63), 8 + 64 + 5]) expect(isPort(v)).toBe(true);
    for (const v of [-2, 8, 8 + 32, 8 + 64, 8 + 256, 1.5, "1", NaN, null]) expect(isPort(v)).toBe(false);
  });
  it("quarter ports lie on the real outline of an ellipse, a diamond and a cylinder", () => {
    const e = R("ellipse");
    for (let q = 0; q < 8; q++) {
      const [x, y] = portPoint(e, Q(q >> 1, q & 1 ? 48 : 16));
      expect(((x - 180) / 80) ** 2 + ((y - 240) / 40) ** 2).toBeCloseTo(1, 6);
    }
    const d = R("diamond");
    for (let q = 0; q < 8; q++) {
      const [x, y] = portPoint(d, Q(q >> 1, q & 1 ? 48 : 16));
      expect(Math.abs(x - 180) / 80 + Math.abs(y - 240) / 40).toBeCloseTo(1, 6);
    }
    const c = R("cylinder");
    expect(portPoint(c, Q(0, 16))[1]).toBeGreaterThan(200); // the lid curves down away from the middle
    expect(portPoint(c, Q(0, 16))[0]).toBe(140);
  });
  it("quarter ports of polygon shapes land on the polygon", () => {
    for (const k of ["hexagon", "triangle", "parallelogram", "star", "cloud"]) {
      const r = R(k), poly = polygonOf(k, r.x, r.y, r.w, r.h)!;
      for (let q = 0; q < 8; q++) expect(distToPoly(poly, ...portPoint(r, Q(q >> 1, q & 1 ? 48 : 16)))).toBeLessThan(1e-6);
    }
  });
  it("a rounded rectangle pulls quarter ports in only where the corner arc reaches", () => {
    expect(portPoint(R("rect", 10), Q(0, 16))).toEqual([140, 200]); // 40px from the corner, arc is 10px
    const p = portPoint({ ...R("rect", 60), h: 160 }, Q(0, 16));
    expect(p[0]).toBe(140); expect(p[1]).toBeGreaterThan(200);
  });
  it("portInto reuses the buffer for box shapes", () => {
    const out: [number, number] = [0, 0];
    expect(portInto(R("ellipse"), Q(1, 48), out)).toBe(out);
  });
  it("an elbow leaves a quarter port perpendicular to its side", () => {
    const rect = R();
    const away = { rect: null, pt: [500, 500] as const, port: -1 as const };
    // top quarter: first segment vertical, upward; right quarter: horizontal, rightward
    const top = routeArrow({ rect, pt: portPoint(rect, Q(0, 48)), port: Q(0, 48) }, away, 1);
    expect(top[0]).toBe(top[2]); expect(top[3]).toBeLessThan(top[1]!);
    const right = routeArrow({ rect, pt: portPoint(rect, Q(1, 48)), port: Q(1, 48) }, away, 1);
    expect(right[1]).toBe(right[3]); expect(right[2]).toBeGreaterThan(right[0]!);
    const left = routeArrow({ rect, pt: portPoint(rect, Q(3, 16)), port: Q(3, 16) }, away, 1);
    expect(left[1]).toBe(left[3]); expect(left[2]).toBeLessThan(left[0]!);
    const bottom = routeArrow({ rect, pt: portPoint(rect, Q(2, 16)), port: Q(2, 16) }, away, 1);
    expect(bottom[0]).toBe(bottom[2]); expect(bottom[3]).toBeGreaterThan(bottom[1]!);
  });
  it("save/load and the Excalidraw round trip keep ports 8-15; junk is dropped", () => {
    const s = new Scene();
    const a = s.add({ kind: "rect", x: 0, y: 0, w: 100, h: 60 }), b = s.add({ kind: "rect", x: 300, y: 0, w: 100, h: 60 });
    s.add({ kind: "arrow", x: 100, y: 0, w: 200, h: 0, pts: [100, 15, 300, 45], src: a.id, dst: b.id, sp: Q(1, 16), dp: Q(3, 48) });
    const json = s.toJSON();
    const meta = { name: "t", created: 1, updated: 1 };
    const p = parseArch(serializeArch({ meta, view: { x: 0, y: 0, zoom: 1 }, settings: {}, scene: json }));
    expect(p.ok).toBe(true);
    const ar = p.ok && p.value.scene.els.find((e) => e.kind === "arrow")!;
    expect(ar && [ar.sp, ar.dp]).toEqual([Q(1, 16), Q(3, 48)]);
    const back = fromExcalidraw(JSON.parse(JSON.stringify(toExcalidraw(json))));
    const ar2 = back.ok && back.scene.els.find((e) => e.kind === "arrow")!;
    expect(ar2 && [ar2.sp, ar2.dp]).toEqual([Q(1, 16), Q(3, 48)]);
        const bad = JSON.parse(serializeArch({ meta, view: { x: 0, y: 0, zoom: 1 }, settings: {}, scene: json }));
    expect(JSON.stringify(bad)).toContain("\"sp\":" + Q(1, 16));
  });
});
