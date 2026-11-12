import { describe, expect, it } from "vitest";
import { Scene } from "./scene";
import { aabbInto, normAngle, snapAngle, toLocal, toWorld, SNAP, type Box } from "./rotate";

const D = Math.PI / 180;
const txt = (s: Scene, a?: number) => s.add({ kind: "text", text: "hello", x: 0, y: 0, w: 100, h: 20, ...(a !== undefined ? { angle: a } : {}) });

describe("rotate helpers", () => {
  it("normAngle folds into (-PI, PI]", () => {
    expect(normAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(normAngle(-Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(normAngle(2 * Math.PI)).toBeCloseTo(0, 9);
    expect(normAngle(-0.5)).toBeCloseTo(-0.5, 9);
  });
  it("snapAngle: 15 degree steps unless free", () => {
    expect(SNAP).toBeCloseTo(15 * D, 12);
    expect(snapAngle(44 * D, false)).toBeCloseTo(45 * D, 9);
    expect(snapAngle(7 * D, false)).toBeCloseTo(0, 9);
    expect(snapAngle(8 * D, false)).toBeCloseTo(15 * D, 9);
    expect(snapAngle(-31 * D, false)).toBeCloseTo(-30 * D, 9);
    expect(snapAngle(44 * D, true)).toBeCloseTo(44 * D, 9);
  });
  it("aabbInto: identity without an angle, swapped sides at 90 degrees, the diagonal box at 45", () => {
    const out: Box = { x: 0, y: 0, w: 0, h: 0 };
    aabbInto({ x: 10, y: 20, w: 100, h: 20 }, out);
    expect(out).toEqual({ x: 10, y: 20, w: 100, h: 20 });
    aabbInto({ x: 0, y: 0, w: 100, h: 20, angle: Math.PI / 2 }, out);
    expect(out.x).toBeCloseTo(40, 9); expect(out.y).toBeCloseTo(-40, 9); expect(out.w).toBeCloseTo(20, 9); expect(out.h).toBeCloseTo(100, 9);
    aabbInto({ x: 0, y: 0, w: 100, h: 20, angle: Math.PI / 4 }, out);
    expect(out.w).toBeCloseTo((100 + 20) * Math.SQRT1_2, 9);
  });
  it("toLocal / toWorld are inverse rotations about the centre", () => {
    const e = { x: 0, y: 0, w: 100, h: 20, angle: 30 * D }, p: [number, number] = [0, 0], q: [number, number] = [0, 0];
    toLocal(e, 77, -13, p); toWorld(e, p[0], p[1], q);
    expect(q[0]).toBeCloseTo(77, 9); expect(q[1]).toBeCloseTo(-13, 9);
    toLocal({ ...e, angle: Math.PI / 2 }, 50, 50, p); // 40 below the centre (50,10) -> local x = -40 ... rotated frame
    expect(p[0]).toBeCloseTo(50 + 40, 9); expect(p[1]).toBeCloseTo(10, 9);
  });
});

describe("scene: a rotated text", () => {
  it("hit-tests in the rotated frame: inside the turned box yes, inside the old box but outside the turned one no", () => {
    const s = new Scene(), t = txt(s, Math.PI / 2); // 100 x 20, centre (50, 10): now 20 wide, 100 tall
    expect(s.hit(50, 50)).toBe(t);   // 40 below the centre: inside only when rotated
    expect(s.hit(50, -30)).toBe(t);
    expect(s.hit(95, 10)).toBeNull(); // inside the unrotated box, outside the rotated one
    expect(s.hit(5, 10)).toBeNull();
  });
  it("an unrotated text still hits where it always did", () => {
    const s = new Scene(), t = txt(s);
    expect(s.hit(95, 10)).toBe(t); expect(s.hit(50, 50)).toBeNull();
  });
  it("the spatial index holds the rotated bounds: a query over the turned part finds it, and bounds() are the turned box", () => {
    const s = new Scene(), t = txt(s, Math.PI / 2), out: unknown[] = [];
    s.query(90, 5, 99, 15, out as never); // inside the old box, outside the turned one
    expect(out.length).toBe(0);
    s.query(45, 45, 55, 55, out as never);
    expect(out).toContain(t);
    const b = s.bounds([t.id])!;
    expect(b.x).toBeCloseTo(40, 9); expect(b.y).toBeCloseTo(-40, 9); expect(b.w).toBeCloseTo(20, 9); expect(b.h).toBeCloseTo(100, 9);
  });
  it("setAngle reindexes and bumps the version; clearing the angle restores the old bounds", () => {
    const s = new Scene(), t = txt(s), n = s.nonce, v = t.version;
    s.setAngle(t, Math.PI / 2);
    expect(t.angle).toBeCloseTo(Math.PI / 2, 9); expect(t.version).toBe(v + 1); expect(s.nonce).toBeGreaterThan(n);
    expect(s.hit(50, 50)).toBe(t);
    s.setAngle(t, 0);
    expect(t.angle).toBeUndefined();
    expect(s.hit(50, 50)).toBeNull(); expect(s.hit(95, 10)).toBe(t);
  });
  it("restoreEl / snapshot carry the angle both ways (undo of a rotation)", () => {
    const s = new Scene(), t = txt(s, 0.5), snap = s.snapshot(t);
    s.setAngle(t, 1.2);
    s.restoreEl(t, snap);
    expect(t.angle).toBeCloseTo(0.5, 12);
    const plain = s.snapshot(txt(s));
    s.restoreEl(t, plain);
    expect(t.angle).toBeUndefined();
  });
});
