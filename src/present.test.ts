import { describe, expect, it } from "vitest";
import { cameraFor, computeSteps, FAR, planHint, type PEl } from "./present";

let n = 0;
const el = (kind: string, x: number, y: number, o: Partial<PEl> = {}): PEl =>
  ({ id: o.id ?? `e${++n}`, kind, x, y, w: 80, h: 50, n: 0, groupIds: [], src: "", dst: "", ...o });
const arrow = (id: string, src: string, dst: string): PEl => el("arrow", 0, 0, { id, src, dst });
const flat = (p: { steps: string[][] }) => p.steps.flat();

describe("computeSteps", () => {
  it("an empty diagram has no steps", () => expect(computeSteps([])).toEqual({ steps: [], mode: "reading" }));

  it("every element appears exactly once, whatever the mode", () => {
    const els = [el("rect", 0, 0, { id: "a" }), el("rect", 300, 0, { id: "b" }), arrow("x", "a", "b"), arrow("loose", "", ""), el("text", 0, 400, { id: "t" })];
    const ids = flat(computeSteps(els));
    expect([...ids].sort()).toEqual(["a", "b", "loose", "t", "x"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe("reading order (no badges)", () => {
    it("loose shapes go top-to-bottom, left-to-right, one step each", () => {
      const p = computeSteps([el("rect", 400, 0, { id: "tr" }), el("rect", 0, 300, { id: "bl" }), el("rect", 0, 0, { id: "tl" }), el("rect", 400, 300, { id: "br" })]);
      expect(p.mode).toBe("reading");
      expect(p.steps).toEqual([["tl"], ["tr"], ["bl"], ["br"]]);
    });
    it("shapes whose centres sit in the same 100-unit row are ordered left to right even if slightly off", () => {
      const p = computeSteps([el("rect", 300, 12, { id: "right" }), el("rect", 0, 0, { id: "left" })]);
      expect(p.steps).toEqual([["left"], ["right"]]);
    });
    it("groups come first (one step per top-level group, members together), then loose shapes", () => {
      const p = computeSteps([
        el("rect", 0, 0, { id: "loose-first" }),
        el("rect", 0, 500, { id: "g1a", groupIds: ["g1"] }), el("rect", 200, 500, { id: "g1b", groupIds: ["g1"] }),
        el("rect", 0, 200, { id: "g2a", groupIds: ["inner", "g2"] }),
      ]);
      expect(p.steps).toEqual([["g2a"], ["g1a", "g1b"], ["loose-first"]]); // g2 is higher on the sheet than g1; both before the loose shape
    });
    it("an arrow joins the later of its two endpoints; one bound end follows that end", () => {
      const p = computeSteps([el("rect", 0, 0, { id: "a" }), el("rect", 300, 0, { id: "b" }), el("rect", 0, 300, { id: "c" }), arrow("ab", "a", "b"), arrow("ca", "c", "a"), arrow("half", "b", "")]);
      expect(p.steps).toEqual([["a"], ["b", "ab", "half"], ["c", "ca"]]);
    });
    it("unbound arrows are not covered: they form the last step", () => {
      const p = computeSteps([el("rect", 0, 0, { id: "a" }), arrow("free", "", "")]);
      expect(p.steps).toEqual([["a"], ["free"]]);
    });
    it("an arrow to a missing element is uncovered rather than crashing", () => {
      expect(computeSteps([el("rect", 0, 0, { id: "a" }), arrow("dangling", "a", "gone")]).steps).toEqual([["a"], ["dangling"]]);
    });
    it("a frame rides with the earliest thing it contains; an empty frame is an ordinary shape", () => {
      const p = computeSteps([
        el("frame", 0, 0, { id: "f", w: 600, h: 300 }), el("rect", 50, 50, { id: "in1" }), el("rect", 300, 150, { id: "in2" }),
        el("frame", 0, 800, { id: "empty", w: 100, h: 100 }), el("rect", 900, 60, { id: "out" }),
      ]);
      expect(p.steps).toEqual([["f", "in1"], ["out"], ["in2"], ["empty"]]); // in1 and out share a row (left to right), in2 is one row lower
    });
    it("ties (identical positions) break by id, so the plan is deterministic", () => {
      const a = computeSteps([el("rect", 0, 0, { id: "b" }), el("rect", 0, 0, { id: "a" })]);
      const b = computeSteps([el("rect", 0, 0, { id: "a" }), el("rect", 0, 0, { id: "b" })]);
      expect(a).toEqual(b);
      expect(a.steps).toEqual([["a"], ["b"]]);
    });
  });

  describe("numbered badges", () => {
    const badge = (id: string, x: number, y: number, num: number, o: Partial<PEl> = {}) => el("badge", x, y, { id, n: num, w: 30, h: 30, ...o });
    it("steps follow badge numbers, not positions; shapes join the nearest badge", () => {
      const p = computeSteps([
        badge("b2", 500, 0, 2), badge("b1", 0, 0, 1), badge("b3", 1000, 0, 3),
        el("rect", 40, 60, { id: "s1" }), el("rect", 540, 60, { id: "s2" }), el("rect", 1040, 60, { id: "s3" }),
      ]);
      expect(p.mode).toBe("badges");
      expect(p.steps).toEqual([["b1", "s1"], ["b2", "s2"], ["b3", "s3"]]);
    });
    it("a shape grouped with a badge joins that badge's step even if another badge is nearer", () => {
      const p = computeSteps([badge("b1", 0, 0, 1, { groupIds: ["g"] }), badge("b2", 400, 0, 2), el("rect", 380, 60, { id: "s", groupIds: ["g"] })]);
      expect(p.steps).toEqual([["b1", "s"], ["b2"]]);
    });
    it("equal badge numbers share a step", () => {
      const p = computeSteps([badge("x", 0, 0, 1), badge("y", 500, 0, 1), badge("z", 1000, 0, 2)]);
      expect(p.steps).toEqual([["x", "y"], ["z"]]);
    });
    it("arrows follow their later endpoint", () => {
      const p = computeSteps([badge("b1", 0, 0, 1), badge("b2", 500, 0, 2), el("rect", 0, 60, { id: "a" }), el("rect", 500, 60, { id: "b" }), arrow("ab", "a", "b")]);
      expect(p.steps).toEqual([["b1", "a"], ["b2", "b", "ab"]]);
    });
    it("shapes farther than FAR from every badge are not covered: they come last", () => {
      const p = computeSteps([badge("b1", 0, 0, 1), el("rect", FAR + 500, 0, { id: "far" }), el("rect", 50, 60, { id: "near" })]);
      expect(p.steps).toEqual([["b1", "near"], ["far"]]);
    });
    it("a badge with n = 0 is an ordinary shape and does not switch the plan to badge mode", () => {
      const p = computeSteps([badge("b", 0, 0, 0), el("rect", 300, 0, { id: "a" })]);
      expect(p.mode).toBe("reading");
    });
  });

  it("the hint says which rule is in force", () => {
    expect(planHint("badges")).toMatch(/badges/);
    expect(planHint("reading")).toMatch(/groups/);
  });
});

describe("cameraFor", () => {
  const view = { x: 0, y: 0, zoom: 1 };
  it("does nothing when the step is already in view", () => expect(cameraFor(view, 1000, 700, { x: 100, y: 100, w: 200, h: 100 })).toBeNull());
  it("pans (keeping the zoom) when the step is off screen but fits", () => {
    const c = cameraFor(view, 1000, 700, { x: 2000, y: 1000, w: 200, h: 100 })!;
    expect(c.zoom).toBe(1);
    expect(c.x + 500).toBeCloseTo(2100); expect(c.y + 350).toBeCloseTo(1050); // centred on the step
  });
  it("zooms out only as far as needed when the step is bigger than the screen, and never zooms in", () => {
    const c = cameraFor({ x: 0, y: 0, zoom: 0.5 }, 1000, 700, { x: 5000, y: 0, w: 4000, h: 100 })!;
    expect(c.zoom).toBeLessThan(0.5);
    expect(c.zoom).toBeCloseTo((1000 - 80) / 4000, 5);
    const small = cameraFor({ x: 0, y: 0, zoom: 0.2 }, 1000, 700, { x: 9000, y: 0, w: 10, h: 10 })!;
    expect(small.zoom).toBe(0.2); // a tiny step far away: pan, don't zoom in
  });
  it("respects the margin: a step touching the edge counts as out of view", () => {
    expect(cameraFor(view, 1000, 700, { x: 10, y: 100, w: 100, h: 100 })).not.toBeNull();
  });
});
