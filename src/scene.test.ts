import { describe, expect, it } from "vitest";
import { Scene, type El } from "./scene";

function brute(s: Scene, x0: number, y0: number, x1: number, y1: number): string[] {
  return [...s.els.values()].filter((e) => e.x <= x1 && e.x + e.w >= x0 && e.y <= y1 && e.y + e.h >= y0).map((e) => e.id).sort();
}
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

describe("spatial grid stays consistent with a brute-force scan", () => {
  it("after random add / move / resize / remove / restore / replaceAll", () => {
    const r = rng(7), s = new Scene(), out: El[] = [];
    const live: El[] = [];
    for (let step = 0; step < 3000; step++) {
      const op = r();
      if (op < 0.4 || live.length < 5) live.push(s.add({ kind: "rect", x: r() * 4000 - 2000, y: r() * 4000 - 2000, w: 10 + r() * 600, h: 10 + r() * 400 }));
      else if (op < 0.7) { const e = live[Math.floor(r() * live.length)]!; s.set(e, r() * 4000 - 2000, r() * 4000 - 2000, 10 + r() * 500, 10 + r() * 300); }
      else if (op < 0.85) { const i = Math.floor(r() * live.length); s.remove(live[i]!); live.splice(i, 1); }
      else { const e = live[Math.floor(r() * live.length)]!; s.restoreEl(e, { ...s.snapshot(e), x: r() * 3000, y: r() * 3000 }); }
      if (step % 50 === 0) {
        const x0 = r() * 3000 - 1500, y0 = r() * 3000 - 1500, x1 = x0 + r() * 1500, y1 = y0 + r() * 1200;
        s.query(x0, y0, x1, y1, out);
        expect(out.map((e) => e.id).sort()).toEqual(brute(s, x0, y0, x1, y1));
      }
    }
    const snap = s.toJSON();
    s.replaceAll(snap);
    s.query(-1e5, -1e5, 1e5, 1e5, out);
    expect(out.length).toBe(live.length);
  });
  it("hit returns the topmost element and respects ellipse shape", () => {
    const s = new Scene();
    s.add({ kind: "rect", x: 0, y: 0, w: 100, h: 100 });
    const top = s.add({ kind: "ellipse", x: 0, y: 0, w: 100, h: 100 });
    expect(s.hit(50, 50)?.id).toBe(top.id);
    expect(s.hit(2, 2)?.kind).toBe("rect"); // corner is outside the ellipse, inside the rect
  });
  it("insertJSON / snapshot / replaceAll preserve ids and z", () => {
    const s = new Scene();
    const a = s.add({ kind: "rect" }), b = s.add({ kind: "rect" });
    const j = s.toJSON();
    const t = new Scene(); t.replaceAll(j);
    expect(t.els.get(a.id)?.z).toBe(a.z); expect(t.els.get(b.id)?.z).toBe(b.z);
    expect(t.newId()).not.toBe(a.id);
  });
});
