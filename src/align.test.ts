import { describe, expect, it } from "vitest";
import { alignBoxes, distributeBoxes, insideBox, matchSizes, unionOf, type Box } from "./align";

const B = (id: string, x: number, y: number, w: number, h: number): Box => ({ id, x, y, w, h });
const boxes = [B("a", 0, 0, 40, 20), B("b", 100, 50, 60, 30), B("c", 300, 10, 20, 50)];

describe("align", () => {
  it("left/right/centre align to the selection bounds", () => {
    const u = unionOf(boxes)!;
    expect(u).toEqual({ x: 0, y: 0, w: 320, h: 80 });
    expect(alignBoxes(boxes, "left").get("b")).toEqual({ dx: -100, dy: 0 });
    expect(alignBoxes(boxes, "left").has("a")).toBe(false); // already there
    expect(alignBoxes(boxes, "right").get("a")).toEqual({ dx: 280, dy: 0 });
    expect(alignBoxes(boxes, "center").get("a")).toEqual({ dx: 140, dy: 0 });
  });
  it("top/middle/bottom", () => {
    expect(alignBoxes(boxes, "top").get("b")).toEqual({ dx: 0, dy: -50 });
    expect(alignBoxes(boxes, "bottom").get("a")).toEqual({ dx: 0, dy: 60 });
    expect(alignBoxes(boxes, "middle").get("a")).toEqual({ dx: 0, dy: 30 });
  });
  it("applying the deltas really aligns", () => {
    for (const mode of ["left", "center", "right", "top", "middle", "bottom"] as const) {
      const d = alignBoxes(boxes, mode);
      const moved = boxes.map((b) => ({ ...b, x: b.x + (d.get(b.id)?.dx ?? 0), y: b.y + (d.get(b.id)?.dy ?? 0) }));
      const key = mode === "left" ? (b: Box) => b.x : mode === "right" ? (b: Box) => b.x + b.w : mode === "center" ? (b: Box) => b.x + b.w / 2 : mode === "top" ? (b: Box) => b.y : mode === "bottom" ? (b: Box) => b.y + b.h : (b: Box) => b.y + b.h / 2;
      expect(new Set(moved.map((b) => Math.round(key(b) * 1e6))).size, mode).toBe(1);
    }
  });
  it("needs two blocks", () => { expect(alignBoxes([boxes[0]!], "left").size).toBe(0); expect(unionOf([])).toBeNull(); });
});

describe("distribute", () => {
  it("equalises the gaps; the outer two never move", () => {
    const d = distributeBoxes(boxes, "h");
    expect(d.has("a")).toBe(false); expect(d.has("c")).toBe(false);
    const b = boxes[1]!, nb = { ...b, x: b.x + d.get("b")!.dx };
    const gap1 = nb.x - (boxes[0]!.x + boxes[0]!.w), gap2 = boxes[2]!.x - (nb.x + nb.w);
    expect(gap1).toBeCloseTo(gap2, 9);
  });
  it("works on the vertical axis and ignores input order", () => {
    const v = [B("p", 0, 300, 10, 10), B("q", 0, 0, 10, 10), B("r", 0, 100, 10, 40)];
    const d = distributeBoxes(v, "v");
    expect(d.get("r")).toEqual({ dx: 0, dy: 35 }); // gap = (310 - 60) / 2 = 125; r moves from 100 to 135
    const r = v[2]!, ny = r.y + d.get("r")!.dy;
    expect(ny - 10).toBeCloseTo(300 - (ny + 40), 9);
  });
  it("needs three blocks", () => { expect(distributeBoxes(boxes.slice(0, 2), "h").size).toBe(0); });
});

describe("match size and containment", () => {
  it("everything becomes as large as the largest in that dimension; equal boxes are omitted", () => {
    const m = matchSizes(boxes, "both");
    expect(m.get("a")).toEqual({ w: 60, h: 50 });
    expect(matchSizes(boxes, "w").get("a")).toEqual({ w: 60, h: 20 });
    expect(matchSizes(boxes, "h").get("c")).toBeUndefined() ;
    expect(matchSizes([B("x", 0, 0, 5, 5), B("y", 9, 9, 5, 5)], "both").size).toBe(0);
  });
  it("insideBox is inclusive of the edges and false for partial overlap", () => {
    const o = { x: 0, y: 0, w: 100, h: 100 };
    expect(insideBox(o, { x: 0, y: 0, w: 100, h: 100 })).toBe(true);
    expect(insideBox(o, { x: 10, y: 10, w: 50, h: 50 })).toBe(true);
    expect(insideBox(o, { x: 60, y: 10, w: 50, h: 50 })).toBe(false);
  });
});
