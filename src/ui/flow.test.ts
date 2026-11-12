import { describe, expect, it } from "vitest";
import { flows, plateRects, clipOutPlates } from "./flow";
import { Scene } from "../scene";
import { sceneRectOf, labelBlock } from "../connectors";

describe("flow: which arrows animate", () => {
  const mk = () => {
    const s = new Scene();
    const a = s.add({ kind: "rect", x: 0, y: 0, w: 100, h: 60 }), b = s.add({ kind: "rect", x: 400, y: 0, w: 100, h: 60 }), m = s.add({ kind: "rect", x: 0, y: 200, w: 100, h: 60 });
    s.groups.set("g1", { id: "g1", name: "riders", cat: 0, collapsed: false, locked: false });
    s.groupRect = (id) => (id === "g1" ? { x: 0, y: 180, w: 120, h: 100 } : null);
    const arrow = (src: string, dst: string, head: 0 | 1 | 2 = 1) => s.add({ kind: "arrow", x: 0, y: 0, w: 1, h: 1, pts: [0, 0, 1, 1], src, dst, head });
    return { s, a, b, m, arrow };
  };
  it("shape to shape flows", () => { const { s, a, b, arrow } = mk(); expect(flows(sceneRectOf(s), arrow(a.id, b.id))).toBe(true); });
  it("a group on either end flows", () => {
    const { s, a, arrow } = mk();
    expect(flows(sceneRectOf(s), arrow("g1", a.id))).toBe(true); expect(flows(sceneRectOf(s), arrow(a.id, "g1"))).toBe(true); expect(flows(sceneRectOf(s), arrow("g1", "g1"))).toBe(true);
  });
  it("a branch end (host is another arrow) flows", () => { const { s, a, b, arrow } = mk(); const host = arrow(a.id, b.id); expect(flows(sceneRectOf(s), arrow(a.id, host.id))).toBe(true); });
  it("any element kind works as a target", () => {
    const { s, a, arrow } = mk();
    for (const kind of ["ellipse", "diamond", "text", "cylinder", "frame", "note", "image"] as const) {
      const t = s.add({ kind, x: 300, y: 300, w: 80, h: 60 });
      expect(flows(sceneRectOf(s), arrow(a.id, t.id))).toBe(true);
    }
  });
  it("open ends, deleted or empty groups, plain lines do not flow", () => {
    const { s, a, b, arrow } = mk();
    expect(flows(sceneRectOf(s), arrow(a.id, ""))).toBe(false); expect(flows(sceneRectOf(s), arrow(a.id, "gone"))).toBe(false);
    s.groups.set("g2", { id: "g2", name: "empty", cat: 0, collapsed: false, locked: false });
    expect(flows(sceneRectOf(s), arrow(a.id, "g2"))).toBe(false);
    expect(flows(sceneRectOf(s), arrow(a.id, b.id, 0))).toBe(false);
  });
});

describe("flow: label plates are kept clear of the dots", () => {
  const measure = (fs: number) => (t: string) => t.length * fs * 0.6;
  const arrow = (labels: { t: number; text: string }[], fs?: number) => {
    const s = new Scene();
    return s.add({ kind: "arrow", x: 0, y: 0, w: 200, h: 1, pts: [0, 0, 200, 0], src: "a", dst: "b", head: 1, route: 0, labels, ...(fs ? { fs } : {}) });
  };
  it("one rect per label, centred on its point, sized by labelBlock (single line)", () => {
    const out: number[] = [];
    plateRects(arrow([{ t: 0.5, text: "hello" }]), measure, out);
    const w = 5 * 13 * 0.6 + 10, h = Math.round(13 * 1.5);
    expect(out).toEqual([100 - w / 2, 0 - h / 2, w, h]);
  });
  it("a two-line label gets ONE plate covering the whole block", () => {
    const out: number[] = [];
    plateRects(arrow([{ t: 0.5, text: "ab\ncdefgh" }]), measure, out);
    const b = labelBlock("ab\ncdefgh", 13, measure(13));
    expect(out).toEqual([100 - b.w / 2, -b.h / 2, b.w, b.h]);
    expect(b.h).toBeGreaterThan(Math.round(13 * 1.5));
  });
  it("uses the arrow's own text size; empty labels and unlabeled arrows give none; out is reset", () => {
    const out: number[] = [9, 9, 9, 9];
    plateRects(arrow([{ t: 0, text: "x" }, { t: 1, text: "" }], 26), measure, out);
    expect(out.length).toBe(4);
    expect(out[3]).toBe(Math.round(26 * 1.5));
    plateRects(arrow([]), measure, out);
    expect(out.length).toBe(0);
  });
  it("clipOutPlates clips to the view MINUS every plate (even-odd): the view rect first, then one rect per plate", () => {
    const calls: unknown[][] = [];
    const g = { beginPath: () => { calls.push(["beginPath"]); }, rect: (...a: number[]) => { calls.push(["rect", ...a]); }, clip: (r: "evenodd") => { calls.push(["clip", r]); } };
    clipOutPlates(g, 0, 0, 800, 600, [10, 20, 30, 40, 100, 120, 60, 18]);
    expect(calls).toEqual([["beginPath"], ["rect", 0, 0, 800, 600], ["rect", 10, 20, 30, 40], ["rect", 100, 120, 60, 18], ["clip", "evenodd"]]);
  });
  it("a dot at a plate's centre is outside the clip region, one beside it inside (even-odd rule on the same rects)", () => {
    const out: number[] = [];
    plateRects(arrow([{ t: 0.5, text: "hello" }]), measure, out);
    // even-odd: a point is drawable when it is inside the view rect and inside an EVEN number of the other rects
    const drawable = (x: number, y: number) => { let n = 1; for (let i = 0; i < out.length; i += 4) if (x >= out[i]! && x <= out[i]! + out[i + 2]! && y >= out[i + 1]! && y <= out[i + 1]! + out[i + 3]!) n++; return n % 2 === 1; };
    expect(drawable(100, 0)).toBe(false);
    expect(drawable(100, 40)).toBe(true);
    expect(drawable(10, 0)).toBe(true);
  });
});
