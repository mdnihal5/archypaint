// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { drawEl } from "./renderer";
import { Scene, type El } from "./scene";
import { LIGHT } from "./theme";

/** a recording 2D context: 6 units per character at any size, every call logged */
function rec() {
  const calls: { op: string; args: unknown[] }[] = [];
  let measures = 0;
  const st: Record<string, unknown> = { font: "13px x", textAlign: "center" };
  const ctx = new Proxy(st, {
    get: (t, k: string) => (k === "measureText" ? (s: string) => { measures++; return { width: s.length * 6 }; } : k in t ? t[k] : (...args: unknown[]) => { calls.push({ op: k, args }); }),
    set: (t, k: string, v) => { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, measures: () => measures, texts: () => calls.filter((c) => c.op === "fillText") };
}
const mk = (p: Partial<El>): El => new Scene().add({ kind: "rect", x: 0, y: 0, w: 100, h: 200, text: "", ...p });

describe("canvas label layout", () => {
  it("wraps a long label to the shape's inner width and centres the block vertically", () => {
    const e = mk({ w: 100, h: 200, text: "alpha beta gamma delta epsilon zeta" }); // inner width 84 = 14 chars
    const r = rec(); drawEl(r.ctx, e, LIGHT, 1, false, false);
    const t = r.texts();
    expect(t.length).toBeGreaterThan(2);
    for (const c of t) expect((c.args[0] as string).length * 6).toBeLessThanOrEqual(84);
    expect(t.map((c) => c.args[0]).join(" ")).toBe("alpha beta gamma delta epsilon zeta");
    const ys = t.map((c) => c.args[2] as number);
    expect((ys[0]! + ys[ys.length - 1]!) / 2).toBeCloseTo(100, 5); // centred on cy
    expect(r.calls.some((c) => c.op === "clip")).toBe(false); // fits: no clipping
  });
  it("text taller than the shape is never clipped: it is drawn whole, still centred, and the element is untouched", () => {
    const e = mk({ w: 60, h: 30, text: "one two three four five six seven eight nine ten eleven twelve" });
    const before = { w: e.w, h: e.h };
    const r = rec(); drawEl(r.ctx, e, LIGHT, 1, false, false);
    expect(r.calls.some((c) => c.op === "clip")).toBe(false);
    expect(r.texts().map((c) => c.args[0]).join(" ")).toBe("one two three four five six seven eight nine ten eleven twelve");
    const ys = r.texts().map((c) => c.args[2] as number);
    expect((ys[0]! + ys[ys.length - 1]!) / 2).toBeCloseTo(15, 5);
    expect({ w: e.w, h: e.h }).toEqual(before);
  });
  it("a long word with no spaces is broken instead of overflowing", () => {
    const e = mk({ w: 100, h: 300, text: "x".repeat(60) });
    const r = rec(); drawEl(r.ctx, e, LIGHT, 1, false, false);
    expect(r.texts().length).toBeGreaterThan(3);
    for (const c of r.texts()) expect((c.args[0] as string).length * 6).toBeLessThanOrEqual(84);
  });
  it("measuring is cached: drawing the same element again does not measure, a change does", () => {
    const e = mk({ w: 100, h: 200, text: "alpha beta gamma delta epsilon zeta" });
    const r = rec(); drawEl(r.ctx, e, LIGHT, 1, false, false);
    const m1 = r.measures(); expect(m1).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) drawEl(r.ctx, e, LIGHT, 1, false, false);
    expect(r.measures()).toBe(m1);
    e.text = "something else entirely and longer"; drawEl(r.ctx, e, LIGHT, 1, false, false);
    expect(r.measures()).toBeGreaterThan(m1);
  });
  it("alignment moves the text to the inner left / right edge (textAlign + x), then restores centre", () => {
    for (const [align, x, ta] of [["left", 12, "left"], ["right", 188, "right"]] as const) {
      const e = mk({ w: 200, h: 60, text: "hi", align });
      const r = rec(); let seen = "";
      const ctx = new Proxy(r.ctx as unknown as Record<string, unknown>, { get: (t, k: string) => (k === "fillText" ? (...a: unknown[]) => { seen = String((r.ctx as unknown as Record<string, unknown>).textAlign); (t[k] as (...a: unknown[]) => void)(...a); } : t[k]), set: (t, k: string, v) => { t[k] = v; return true; } }) as unknown as CanvasRenderingContext2D;
      drawEl(ctx, e, LIGHT, 1, false, false);
      expect(r.texts()[0]!.args[1]).toBe(x); expect(seen).toBe(ta);
      expect((r.ctx as unknown as Record<string, unknown>).textAlign).toBe("center");
    }
  });
  it("free text aligns inside its box and does not wrap", () => {
    const e = mk({ kind: "text", w: 200, h: 20, text: "a long line of free text that must stay on one line", align: "right" });
    const r = rec(); drawEl(r.ctx, e, LIGHT, 1, false, false);
    expect(r.texts().length).toBe(1); expect(r.texts()[0]!.args[1]).toBe(192);
  });
  it("an ellipse wraps narrower than a rectangle", () => {
    const t = "alpha beta gamma delta epsilon";
    const n = (kind: El["kind"]) => { const r = rec(); drawEl(r.ctx, mk({ kind, w: 120, h: 300, text: t }), LIGHT, 1, false, false); return r.texts().length; };
    expect(n("ellipse")).toBeGreaterThan(n("rect"));
  });
});
