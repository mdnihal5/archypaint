import { describe, expect, it } from "vitest";
import { buildLegend, frameChildren, nextBadgeNumber, renumberBadges } from "./edit-ops";
import { Scene, type El } from "./scene";

describe("step badges", () => {
  it("placing badges auto-increments: 1, 2, 3 …", () => {
    const sc = new Scene();
    const seq: number[] = [];
    for (let i = 0; i < 4; i++) { const n = nextBadgeNumber(sc.els.values()); seq.push(n); sc.add({ kind: "badge", n, w: 32, h: 32 }); }
    expect(seq).toEqual([1, 2, 3, 4]);
  });
  it("continues after the highest number, ignoring non-badges", () => {
    expect(nextBadgeNumber([{ kind: "rect", n: 99 }, { kind: "badge", n: 7 }, { kind: "badge", n: 3 }])).toBe(8);
    expect(nextBadgeNumber([])).toBe(1);
  });
  it("renumber closes gaps and duplicates but keeps the order (ties broken by creation order)", () => {
    const plan = renumberBadges([
      { id: "a", kind: "badge", n: 2, z: 1 }, { id: "b", kind: "badge", n: 5, z: 2 }, { id: "c", kind: "badge", n: 5, z: 3 },
      { id: "d", kind: "badge", n: 9, z: 4 }, { id: "x", kind: "rect", n: 0, z: 5 },
    ]);
    expect(Object.fromEntries(plan)).toEqual({ a: 1, b: 2, c: 3, d: 4 });
    expect(renumberBadges([{ id: "a", kind: "badge", n: 1, z: 1 }, { id: "b", kind: "badge", n: 2, z: 2 }]).size).toBe(0); // already 1..N
  });
});

describe("frame containment", () => {
  it("collects only elements FULLY inside, skipping locked ones and the frame itself", () => {
    const sc = new Scene();
    const f = sc.add({ kind: "frame", x: 0, y: 0, w: 400, h: 300 });
    const inside = sc.add({ kind: "rect", x: 20, y: 40, w: 100, h: 60 });
    sc.add({ kind: "rect", x: 350, y: 40, w: 100, h: 60 }); // sticks out
    sc.add({ kind: "rect", x: 1000, y: 1000, w: 10, h: 10 }); // far away
    sc.add({ kind: "rect", x: 30, y: 200, w: 40, h: 40, locked: true });
    const nested = sc.add({ kind: "frame", x: 200, y: 100, w: 150, h: 150 });
    const out: El[] = [];
    frameChildren(sc, f, out, []);
    expect(out.map((e) => e.id).sort()).toEqual([inside.id, nested.id].sort());
  });
});

describe("legend", () => {
  const names = ["data", "cache", "network", "compute", "queue", "security", "client", "external"];
  it("lists only the categories in use, plus the line styles that appear", () => {
    const l = buildLegend([{ kind: "rect", cat: 3, dash: 0 }, { kind: "icon", cat: 0, dash: 0 }, { kind: "arrow", cat: 6, dash: 1 }, { kind: "arrow", cat: 6, dash: 0 }, { kind: "legend", cat: 5, dash: 0 }], names);
    expect(l.text.split("\n")).toEqual(["c0|data", "c3|compute", "c6|client", "solid|solid = sync call", "dashed|dashed = async"]);
    expect(l.h).toBeGreaterThan(24 + 5 * 22);
  });
  it("an empty document lists every category", () => {
    expect(buildLegend([], names).text.split("\n")).toHaveLength(8);
  });
});
