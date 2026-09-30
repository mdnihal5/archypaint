import { describe, expect, it } from "vitest";
import { gridLayout, layoutGraph, MAX_NODES, type LEdge, type LNode, type Pos } from "./layout";

const N = (id: string, w = 100, h = 60, cluster?: string): LNode => ({ id, w, h, ...(cluster ? { cluster } : {}) });
const E = (from: string, to: string): LEdge => ({ from, to });

function overlaps(nodes: readonly LNode[], pos: Map<string, Pos>): string[] {
  const bad: string[] = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i]!, b = nodes[j]!, pa = pos.get(a.id)!, pb = pos.get(b.id)!;
    if (pa.x < pb.x + b.w && pb.x < pa.x + a.w && pa.y < pb.y + b.h && pb.y < pa.y + a.h) bad.push(`${a.id}/${b.id}`);
  }
  return bad;
}
const cx = (n: LNode, p: Pos) => p.x + n.w / 2;
const cy = (n: LNode, p: Pos) => p.y + n.h / 2;

describe("layoutGraph: basics", () => {
  it("empty input", () => { expect(layoutGraph([], []).size).toBe(0); });
  it("one node sits at the origin", () => {
    expect(layoutGraph([N("a")], []).get("a")).toEqual({ x: 0, y: 0 });
  });
  it("a chain runs left to right, vertically aligned, without overlap", () => {
    const nodes = ["a", "b", "c", "d"].map((i) => N(i));
    const p = layoutGraph(nodes, [E("a", "b"), E("b", "c"), E("c", "d")]);
    const xs = nodes.map((n) => p.get(n.id)!.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs).size).toBe(4);
    expect(new Set(nodes.map((n) => cy(n, p.get(n.id)!))).size).toBe(1);
    expect(overlaps(nodes, p)).toEqual([]);
  });
  it("TB swaps the axes", () => {
    const nodes = ["a", "b", "c"].map((i) => N(i));
    const p = layoutGraph(nodes, [E("a", "b"), E("b", "c")], { direction: "TB" });
    const ys = nodes.map((n) => p.get(n.id)!.y);
    expect(ys[0]! < ys[1]! && ys[1]! < ys[2]!).toBe(true);
    expect(new Set(nodes.map((n) => cx(n, p.get(n.id)!))).size).toBe(1);
  });
  it("layer gap and node gap follow the options", () => {
    const nodes = [N("a"), N("b"), N("c")];
    const p = layoutGraph(nodes, [E("a", "b"), E("a", "c")], { gapX: 200, gapY: 30 });
    expect(p.get("b")!.x - (p.get("a")!.x + 100)).toBe(200);
    expect(Math.abs(p.get("b")!.y - p.get("c")!.y) - 60).toBeGreaterThanOrEqual(30 - 1e-6);
  });
  it("a fan-out is centred on its parent", () => {
    const nodes = ["r", "x", "y", "z"].map((i) => N(i));
    const p = layoutGraph(nodes, [E("r", "x"), E("r", "y"), E("r", "z")]);
    const mid = (cy(nodes[2]!, p.get("y")!));
    expect(Math.abs(cy(nodes[0]!, p.get("r")!) - mid)).toBeLessThan(1);
  });
  it("a diamond has a and d at the ends and b, c stacked between", () => {
    const nodes = ["a", "b", "c", "d"].map((i) => N(i));
    const p = layoutGraph(nodes, [E("a", "b"), E("a", "c"), E("b", "d"), E("c", "d")]);
    expect(p.get("b")!.x).toBe(p.get("c")!.x);
    expect(p.get("a")!.x < p.get("b")!.x && p.get("b")!.x < p.get("d")!.x).toBe(true);
    expect(p.get("b")!.y).not.toBe(p.get("c")!.y);
    expect(overlaps(nodes, p)).toEqual([]);
  });
  it("mixed node sizes never overlap", () => {
    const nodes = [N("a", 200, 40), N("b", 40, 200), N("c", 120, 120), N("d", 300, 30), N("e", 50, 50)];
    const p = layoutGraph(nodes, [E("a", "b"), E("a", "c"), E("b", "d"), E("c", "d"), E("d", "e")]);
    expect(overlaps(nodes, p)).toEqual([]);
  });
  it("a long edge is routed around the nodes in between (dummy nodes), not through them", () => {
    const nodes = ["a", "b", "c", "d"].map((i) => N(i));
    const p = layoutGraph(nodes, [E("a", "b"), E("b", "c"), E("c", "d"), E("a", "d")]);
    expect(overlaps(nodes, p)).toEqual([]);
    expect(p.get("d")!.x).toBeGreaterThan(p.get("c")!.x);
  });
});

describe("layoutGraph: awkward input", () => {
  it("cycles are broken: every node is placed, none overlap", () => {
    const nodes = ["a", "b", "c"].map((i) => N(i));
    const p = layoutGraph(nodes, [E("a", "b"), E("b", "c"), E("c", "a")]);
    expect(p.size).toBe(3);
    expect(overlaps(nodes, p)).toEqual([]);
    const xs = nodes.map((n) => p.get(n.id)!.x);
    expect(new Set(xs).size).toBe(3); // a cycle still forms three tiers
  });
  it("a two-node cycle and a big cycle", () => {
    expect(layoutGraph([N("a"), N("b")], [E("a", "b"), E("b", "a")]).size).toBe(2);
    const ring = Array.from({ length: 300 }, (_, i) => N(`n${i}`));
    const edges = ring.map((_, i) => E(`n${i}`, `n${(i + 1) % 300}`));
    const p = layoutGraph(ring, edges);
    expect(p.size).toBe(300);
    expect(overlaps(ring, p)).toEqual([]);
  });
  it("self loops, duplicate edges and unknown endpoints are ignored", () => {
    const nodes = [N("a"), N("b")];
    const clean = layoutGraph(nodes, [E("a", "b")]);
    const messy = layoutGraph(nodes, [E("a", "a"), E("a", "b"), E("a", "b"), E("a", "ghost"), E("ghost", "b")]);
    expect([...messy]).toEqual([...clean]);
  });
  it("duplicate node ids: the first one wins, no crash", () => {
    const p = layoutGraph([N("a"), N("a", 10, 10), N("b")], [E("a", "b")]);
    expect(p.size).toBe(2);
  });
  it("zero, negative and non-finite sizes are treated as 1", () => {
    const nodes = [N("a", 0, 0), N("b", -5, NaN), N("c", Infinity, 10)];
    const p = layoutGraph(nodes, [E("a", "b"), E("b", "c")]);
    for (const v of p.values()) { expect(Number.isFinite(v.x)).toBe(true); expect(Number.isFinite(v.y)).toBe(true); }
  });
  it("disconnected components are stacked without overlap; isolated nodes go to a grid", () => {
    const nodes = ["a", "b", "c", "d", "i1", "i2", "i3", "i4", "i5"].map((i) => N(i));
    const p = layoutGraph(nodes, [E("a", "b"), E("c", "d")]);
    expect(p.size).toBe(9);
    expect(overlaps(nodes, p)).toEqual([]);
    expect(p.get("c")!.y).toBeGreaterThan(p.get("a")!.y); // component 2 sits below component 1 (LR)
    const iso = ["i1", "i2", "i3", "i4", "i5"].map((i) => p.get(i)!);
    expect(Math.min(...iso.map((q) => q.y))).toBeGreaterThan(Math.max(p.get("a")!.y, p.get("c")!.y));
  });
  it("only isolated nodes: a tidy grid starting at the origin", () => {
    const nodes = Array.from({ length: 10 }, (_, i) => N(`i${i}`));
    const p = layoutGraph(nodes, []);
    expect(overlaps(nodes, p)).toEqual([]);
    expect(Math.min(...[...p.values()].map((q) => q.x))).toBe(0);
    expect(Math.min(...[...p.values()].map((q) => q.y))).toBe(0);
  });
});

describe("layoutGraph: clusters (groups)", () => {
  it("members of a cluster end up adjacent within their layer", () => {
    const nodes = [N("r"), N("g1", 100, 60, "G"), N("x"), N("g2", 100, 60, "G"), N("y"), N("g3", 100, 60, "G")];
    const edges = ["g1", "x", "g2", "y", "g3"].map((t) => E("r", t));
    const p = layoutGraph(nodes, edges);
    const col = ["g1", "x", "g2", "y", "g3"].sort((a, b) => p.get(a)!.y - p.get(b)!.y);
    const inG = col.map((id) => id.startsWith("g"));
    const first = inG.indexOf(true), lastIdx = inG.lastIndexOf(true);
    expect(inG.slice(first, lastIdx + 1).every(Boolean)).toBe(true);
    expect(overlaps(nodes, p)).toEqual([]);
  });
  it("several clusters each stay contiguous", () => {
    const nodes: LNode[] = [N("r")];
    const edges: LEdge[] = [];
    for (let i = 0; i < 12; i++) { nodes.push(N(`m${i}`, 100, 60, i % 3 === 0 ? "A" : i % 3 === 1 ? "B" : "C")); edges.push(E("r", `m${i}`)); }
    const p = layoutGraph(nodes, edges);
    const col = nodes.slice(1).sort((a, b) => p.get(a.id)!.y - p.get(b.id)!.y).map((n) => n.cluster);
    for (const c of ["A", "B", "C"]) { const f = col.indexOf(c), l = col.lastIndexOf(c); expect(col.slice(f, l + 1).every((x) => x === c)).toBe(true); }
  });
});

describe("layoutGraph: determinism and limits", () => {
  const rnd = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const randomGraph = (n: number, avgDeg: number, seed: number) => {
    const r = rnd(seed), nodes = Array.from({ length: n }, (_, i) => N(`n${i}`, 80 + Math.floor(r() * 60), 40 + Math.floor(r() * 40)));
    const edges: LEdge[] = [];
    for (let i = 0; i < n * avgDeg; i++) edges.push(E(`n${Math.floor(r() * n)}`, `n${Math.floor(r() * n)}`));
    return { nodes, edges };
  };
  it("same input gives identical output, every time", () => {
    const { nodes, edges } = randomGraph(120, 1.4, 5);
    const a = [...layoutGraph(nodes, edges)], b = [...layoutGraph(nodes, edges)];
    expect(b).toEqual(a);
  });
  it("random graphs (cycles, long edges, components) never overlap and stay finite", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { nodes, edges } = randomGraph(60 + seed * 7, 0.8 + (seed % 4) * 0.5, seed);
      for (const direction of ["LR", "TB"] as const) {
        const p = layoutGraph(nodes, edges, { direction });
        expect(p.size).toBe(nodes.length);
        for (const v of p.values()) { expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true); expect(v.x).toBeGreaterThanOrEqual(0); expect(v.y).toBeGreaterThanOrEqual(0); }
        expect(overlaps(nodes, p)).toEqual([]);
      }
    }
  });
  it("output does not depend on edge order within a node's edges being duplicated", () => {
    const { nodes, edges } = randomGraph(40, 1.2, 9);
    const a = [...layoutGraph(nodes, edges)];
    const b = [...layoutGraph(nodes, [...edges, ...edges])];
    expect(b).toEqual(a);
  });
  it("beyond maxNodes it degrades to a grid instantly", () => {
    const nodes = Array.from({ length: MAX_NODES + 5 }, (_, i) => N(`n${i}`));
    const t0 = performance.now();
    const p = layoutGraph(nodes, nodes.slice(1).map((n, i) => E(`n${i}`, n.id)));
    expect(p.size).toBe(nodes.length);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(overlaps(nodes.slice(0, 200), p)).toEqual([]);
  });
  it("gridLayout alone: row-major, no overlap, honours duplicate ids", () => {
    const nodes = [N("a"), N("b"), N("c"), N("a")];
    const p = gridLayout(nodes);
    expect(p.size).toBe(3);
    expect(overlaps(nodes.slice(0, 3), p)).toEqual([]);
  });
  it("a 2,000-node sparse graph and a 500-node graph lay out within budget", () => {
    const big = randomGraph(2000, 1.3, 11), mid = randomGraph(500, 1.3, 12);
    layoutGraph(mid.nodes, mid.edges); // warm the JIT
    const t1 = performance.now(); const pm = layoutGraph(mid.nodes, mid.edges); const tMid = performance.now() - t1;
    const t2 = performance.now(); const pb = layoutGraph(big.nodes, big.edges); const tBig = performance.now() - t2;
    // eslint-disable-next-line no-console
    console.log(`layout timing: 500 nodes ${tMid.toFixed(1)} ms, 2000 nodes ${tBig.toFixed(1)} ms`);
    expect(pm.size).toBe(500); expect(pb.size).toBe(2000);
    expect(tMid).toBeLessThan(120); // target < 50 ms; slack for a loaded CI machine
    expect(tBig).toBeLessThan(600); // target < 300 ms
  });
  it("a 2,000-node chain (deep DFS) does not overflow the stack", () => {
    const nodes = Array.from({ length: 2000 }, (_, i) => N(`n${i}`, 40, 20));
    const edges = nodes.slice(1).map((n, i) => E(`n${i}`, n.id));
    expect(layoutGraph(nodes, edges).size).toBe(2000);
  });
  it("edge flood beyond the cap falls back to a grid", () => {
    const nodes = Array.from({ length: 50 }, (_, i) => N(`n${i}`));
    const edges: LEdge[] = [];
    for (let i = 0; i < 9000; i++) edges.push(E(`n${i % 50}`, `n${(i * 7 + 1) % 50}`));
    expect(layoutGraph(nodes, edges).size).toBe(50);
  });
});
